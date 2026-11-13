$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$folderPath = 'aquaku/forum'
$roleId = 'cld::role::folder::contributor'
$apiHost = 'https://api.cloudinary.com/v1_1'
$currentStep = 'input'

function Read-SecretText([string] $Prompt) {
  $secureValue = Read-Host -Prompt $Prompt -AsSecureString
  if ($secureValue.Length -eq 0) {
    throw 'Nilai tidak boleh kosong.'
  }

  $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer)
    $secureValue.Dispose()
  }
}

try {
  $cloudName = (Read-Host 'Cloudinary cloud name').Trim()
  $adminApiKey = (Read-Host 'Admin API caller key dengan izin melihat/mengelola folder').Trim()
  $adminApiSecret = Read-SecretText 'Admin API caller secret (input disembunyikan)'
  $targetApiKey = (Read-Host 'API key target dari CLOUDINARY_URL backend staging (Media Library User)').Trim()
  if (-not $cloudName -or -not $adminApiKey -or -not $targetApiKey) {
    throw 'Cloud name, Admin API caller key, dan API key target wajib diisi.'
  }

  Write-Host "Target: $cloudName / $folderPath; role folder: Contributor" -ForegroundColor Cyan
  $confirmation = Read-Host 'Ketik GRANT untuk melanjutkan'
  if ($confirmation -cne 'GRANT') {
    Write-Host 'Dibatalkan; tidak ada perubahan.' -ForegroundColor Yellow
    exit 0
  }

  $basicAuth = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes(('{0}:{1}' -f $adminApiKey, $adminApiSecret))
  )
  $headers = @{ Authorization = "Basic $basicAuth" }
  $baseUri = "$apiHost/$cloudName"

  Write-Host 'Mencari folder dan external_id...' -ForegroundColor Cyan
  $currentStep = 'membaca daftar root folders Cloudinary'
  $rootFolders = Invoke-RestMethod -Method Get -Uri "$baseUri/folders" -Headers $headers
  $aquakuFolder = $rootFolders.folders |
    Where-Object { $_.path -eq 'aquaku' } |
    Select-Object -First 1
  if (-not $aquakuFolder) {
    throw "Root folder 'aquaku' belum ada. Buat folder aquaku dan subfolder forum di Cloudinary Console, lalu jalankan ulang."
  }

  $currentStep = "membaca subfolder dari '$($aquakuFolder.path)'"
  $parentFolders = Invoke-RestMethod -Method Get -Uri "$baseUri/folders/aquaku" -Headers $headers
  $folder = $parentFolders.folders |
    Where-Object { $_.path -eq $folderPath } |
    Select-Object -First 1
  if (-not $folder -or -not $folder.external_id) {
    throw "Subfolder '$folderPath' belum ada. Buat subfolder forum di dalam aquaku pada Cloudinary Console, lalu jalankan ulang."
  }

  $folderId = [Uri]::EscapeDataString([string] $folder.external_id)
  $inviteUri = "$baseUri/folder_operations/invite/$folderId"
  $currentStep = 'memeriksa role folder yang sudah ada'
  $currentRoles = Invoke-RestMethod -Method Get -Uri $inviteUri -Headers $headers
  $keyAssignment = $currentRoles.shared_with |
    Where-Object { $_.type -eq 'apiKey' -and $_.id -eq $targetApiKey } |
    Select-Object -First 1
  $alreadyGranted = $false
  if ($keyAssignment) {
    $alreadyGranted = @($keyAssignment.roles | Where-Object { $_.id -eq $roleId }).Count -gt 0
  }

  if ($alreadyGranted) {
    Write-Host "Role Contributor sudah ada untuk API key pada '$folderPath'; tidak ada perubahan." -ForegroundColor Green
  }
  else {
    $body = @{
      principal = @{ id = $targetApiKey; type = 'apiKey' }
      operation = 'add'
      roles = @($roleId)
    } | ConvertTo-Json -Depth 4 -Compress

    $currentStep = 'menambahkan role Contributor untuk API key'
    $result = Invoke-RestMethod `
      -Method Post `
      -Uri $inviteUri `
      -Headers $headers `
      -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($body))

    if (-not $result.success) {
      throw 'Cloudinary tidak mengonfirmasi pemberian folder role.'
    }
    Write-Host "Role Contributor berhasil ditambahkan untuk '$folderPath'." -ForegroundColor Green
  }

  Write-Host 'Role global API key tidak diubah.' -ForegroundColor Cyan
  Write-Host 'Berikutnya jalankan scripts\test-cloudinary-upload.bat untuk mencoba upload.'
}
catch {
  Write-Host ''
  Write-Host "Gagal saat $currentStep`: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Pastikan kredensial berasal dari product environment staging yang sama dengan CLOUDINARY_URL backend.' -ForegroundColor Yellow
  exit 1
}
finally {
  $headers = $null
  $basicAuth = $null
  $adminApiSecret = $null
}
