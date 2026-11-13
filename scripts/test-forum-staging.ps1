$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$baseUrl = 'https://aquaku-backend-staging.up.railway.app/api/v1'
$testCategoryName = 'Kategori Uji Bruno'
$testCategorySlug = 'kategori-uji-bruno'

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
  Write-Host 'Memeriksa health staging...' -ForegroundColor Cyan
  $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/health/ready"
  if (
    $health.data.status -ne 'ready' -or
    $health.data.checks.database -ne 'up' -or
    $health.data.checks.forum_database -ne 'up'
  ) {
    throw 'Staging belum ready. Pastikan PostgreSQL dan MongoDB sama-sama up.'
  }
  Write-Host 'Health OK: PostgreSQL dan MongoDB up.' -ForegroundColor Green

  Write-Host 'Memeriksa kategori forum...' -ForegroundColor Cyan
  $categoryResponse = Invoke-RestMethod -Method Get -Uri "$baseUrl/forum/categories"
  $category = $categoryResponse.data |
    Where-Object { $_.slug -eq $testCategorySlug -or $_.name -eq $testCategoryName } |
    Select-Object -First 1

  if (-not $category) {
    Write-Host "Kategori '$testCategoryName' belum ada; membuatnya (butuh token admin)." -ForegroundColor Yellow
    $adminToken = Read-AccessToken 'Masukkan access token ADMIN (input disembunyikan)'
    $adminHeaders = @{ Authorization = "Bearer $adminToken" }
    $categoryBody = @{
      name = $testCategoryName
      description = 'Kategori sementara untuk menguji posting forum di staging.'
    } | ConvertTo-Json

    $createdCategory = Invoke-RestMethod `
      -Method Post `
      -Uri "$baseUrl/forum/admin/categories" `
      -Headers $adminHeaders `
      -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($categoryBody))

    $category = $createdCategory.data
    $adminHeaders = $null
    $adminToken = $null
    Write-Host "Kategori dummy dibuat: $($category.id)" -ForegroundColor Green
  }
  else {
    Write-Host "Menggunakan kategori dummy yang sudah ada: $($category.id)" -ForegroundColor Green
  }

  if (-not $category.id) {
    throw 'ID kategori tidak ditemukan dari respons API.'
  }

  Write-Host 'Menyiapkan posting dummy...' -ForegroundColor Cyan
  $userToken = Read-AccessToken 'Masukkan access token USER (login dan HP sudah terverifikasi; input disembunyikan)'
  $userHeaders = @{ Authorization = "Bearer $userToken" }
  $runId = Get-Date -Format 'yyyyMMdd-HHmmss'
  $postTitle = "Posting Uji Bruno $runId"
  $postBody = @{
    category_id = [string] $category.id
    title = $postTitle
    body = "Posting dummy untuk memastikan API menyimpan data ke MongoDB staging. ID pengujian: $runId."
  } | ConvertTo-Json

  $createdPost = Invoke-RestMethod `
    -Method Post `
    -Uri "$baseUrl/forum/posts" `
    -Headers $userHeaders `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($postBody))

  $userHeaders = $null
  $userToken = $null
  Write-Host ''
  Write-Host 'Posting dummy berhasil dibuat di MongoDB staging.' -ForegroundColor Green
  Write-Host "Post ID    : $($createdPost.data.id)"
  Write-Host "Kategori   : $($category.name) ($($category.id))"
  Write-Host "Judul      : $($createdPost.data.title)"
  Write-Host "Verifikasi : GET $baseUrl/forum/posts/$($createdPost.data.id)"
  Write-Host ''
  Write-Host 'Setiap eksekusi membuat satu posting baru. Hapus lewat Bruno bila sudah selesai.' -ForegroundColor Yellow
}
catch {
  Write-Host ''
  Write-Host "Gagal: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Pastikan token admin punya role admin, dan token user milik akun dengan HP terverifikasi.' -ForegroundColor Yellow
  exit 1
}
