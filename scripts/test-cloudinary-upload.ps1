$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

$baseUrl = 'https://aquaku-backend-staging.up.railway.app/api/v1'
$samplePath = Join-Path $PSScriptRoot 'sample.png'

function Read-AccessToken([string] $Prompt) {
  $secureToken = Read-Host -Prompt $Prompt -AsSecureString
  if ($secureToken.Length -eq 0) {
    throw 'Token tidak boleh kosong.'
  }

  $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    $secureToken.Dispose()
  }
}

try {
  if (-not (Test-Path -LiteralPath $samplePath -PathType Leaf)) {
    throw "File sample.png tidak ditemukan di $PSScriptRoot."
  }

  $fileInfo = Get-Item -LiteralPath $samplePath
  if ($fileInfo.Length -gt 5MB) {
    throw 'sample.png melebihi batas upload 5 MB.'
  }

  Write-Host 'Memeriksa health staging...' -ForegroundColor Cyan
  $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/health/ready"
  if (
    $health.data.status -ne 'ready' -or
    $health.data.checks.database -ne 'up' -or
    $health.data.checks.forum_database -ne 'up'
  ) {
    throw 'Staging belum ready. Pastikan PostgreSQL dan MongoDB sama-sama up.'
  }

  $accessToken = Read-AccessToken 'Masukkan access token user terverifikasi (input disembunyikan)'
  $headers = @{ Authorization = "Bearer $accessToken" }

  Write-Host 'Meminta signed upload untuk foto forum...' -ForegroundColor Cyan
  $signatureResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/forum/media/upload-signatures" `
    -Headers $headers
  $signature = $signatureResponse.data

  if (-not $signature.asset_folder) {
    if ($signature.folder) {
      throw "Backend staging masih mengembalikan field 'folder', bukan 'asset_folder'. Deploy versi backend terbaru sebelum mencoba upload lagi."
    }
    throw 'Respons signed upload tidak menyertakan asset_folder. Pastikan backend staging sudah diperbarui.'
  }
  if ($signature.asset_folder -ne 'aquaku/forum') {
    throw "asset_folder tidak sesuai: diharapkan 'aquaku/forum', diterima '$($signature.asset_folder)'."
  }
  if (-not $signature.asset_id -or -not $signature.cloud_name -or -not $signature.api_key -or -not $signature.timestamp -or -not $signature.public_id -or -not $signature.signature) {
    throw 'Respons signed upload tidak lengkap.'
  }

  Write-Host 'Mengunggah sample.png ke Cloudinary...' -ForegroundColor Cyan
  $httpClient = [System.Net.Http.HttpClient]::new()
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $fileStream = [System.IO.File]::OpenRead($samplePath)
  $fileContent = [System.Net.Http.StreamContent]::new($fileStream)
  $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('image/png')

  foreach ($fieldName in @('api_key', 'timestamp', 'public_id', 'asset_folder', 'allowed_formats', 'upload_preset', 'overwrite', 'signature')) {
    $fieldValue = [string] $signature.$fieldName
    $fieldContent = [System.Net.Http.StringContent]::new($fieldValue, [System.Text.Encoding]::UTF8)
    $multipart.Add($fieldContent, $fieldName)
  }
  $multipart.Add($fileContent, 'file', [System.IO.Path]::GetFileName($samplePath))

  $cloudinaryUri = "https://api.cloudinary.com/v1_1/$($signature.cloud_name)/image/upload"
  $uploadResponse = $httpClient.PostAsync($cloudinaryUri, $multipart).GetAwaiter().GetResult()
  $uploadResponseBody = $uploadResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $uploadResponse.IsSuccessStatusCode) {
    $cloudinaryErrorMessage = 'Periksa upload preset dan konfigurasi Cloudinary staging.'
    try {
      $cloudinaryError = $uploadResponseBody | ConvertFrom-Json
      if ($cloudinaryError.error.message) {
        $cloudinaryErrorMessage = [string] $cloudinaryError.error.message
      }
    }
    catch {
      # Keep the generic message if Cloudinary did not return JSON.
    }
    throw "Cloudinary menolak upload (HTTP $([int] $uploadResponse.StatusCode)): $cloudinaryErrorMessage"
  }

  $cloudinaryResult = $uploadResponseBody | ConvertFrom-Json
  if ($cloudinaryResult.public_id -ne $signature.public_id -or -not $cloudinaryResult.secure_url) {
    $actualPublicId = if ($cloudinaryResult.public_id) { [string] $cloudinaryResult.public_id } else { '(tidak ada)' }
    $secureUrlStatus = if ($cloudinaryResult.secure_url) { 'tersedia' } else { 'tidak tersedia' }
    throw "Respons upload tidak sesuai: public_id yang diharapkan '$($signature.public_id)', yang dikembalikan '$actualPublicId'; secure_url $secureUrlStatus."
  }

  Write-Host 'Mengonfirmasi upload ke backend...' -ForegroundColor Cyan
  $confirmBody = @{ asset_id = $signature.asset_id } | ConvertTo-Json -Compress
  $confirmed = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/forum/media/confirm-upload" `
    -Headers $headers `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($confirmBody))

  Write-Host ''
  Write-Host 'Upload Cloudinary berhasil dan aset terkonfirmasi.' -ForegroundColor Green
  Write-Host "Asset ID : $($confirmed.data.id)"
  Write-Host "Format   : $($confirmed.data.format)"
  Write-Host "Ukuran   : $($confirmed.data.bytes) bytes"
  Write-Host "URL      : $($confirmed.data.url)"
  Write-Host ''
  Write-Host "Asset ID dapat dipakai pada photo_ids saat membuat posting forum." -ForegroundColor Cyan
  $headers = $null
  $accessToken = $null
}
catch {
  Write-Host ''
  Write-Host "Gagal: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Pastikan token milik akun dengan HP terverifikasi dan Cloudinary staging sudah dikonfigurasi.' -ForegroundColor Yellow
  exit 1
}
finally {
  if ($fileStream) { $fileStream.Dispose() }
  if ($multipart) { $multipart.Dispose() }
  if ($httpClient) { $httpClient.Dispose() }
}
