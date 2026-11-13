$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$baseUrl = 'https://aquaku-backend-staging.up.railway.app/api/v1'
$categoriesToEnsure = @(
  @{
    name = 'Panduan Pemula'
    description = 'Tempat bertanya dan berbagi panduan dasar untuk memulai akuarium dan aquascape.'
  },
  @{
    name = 'Aquascape & Hardscape'
    description = 'Ide desain, tata letak, batu, kayu, dan pembangunan lanskap akuarium.'
  },
  @{
    name = 'Tanaman Air'
    description = 'Diskusi tanaman air, pemilihan jenis, penanaman, nutrisi, dan pertumbuhannya.'
  },
  @{
    name = 'Ikan & Biota Air'
    description = 'Diskusi ikan, udang, keong, dan biota air lainnya beserta perawatannya.'
  },
  @{
    name = 'Perawatan Akuarium'
    description = 'Berbagi pengalaman tentang kualitas air, alga, penyakit, dan perawatan rutin.'
  },
  @{
    name = 'Peralatan & Teknologi'
    description = 'Diskusi filter, lampu, CO2, pompa, sensor, dan peralatan akuarium lainnya.'
  },
  @{
    name = 'Showcase Aquascape'
    description = 'Pamerkan hasil aquascape dan ceritakan proses pembuatannya.'
  },
  @{
    name = 'Diskusi Umum'
    description = 'Obrolan komunitas seputar akuarium dan hobi aquascape.'
  }
)

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

  $categoryResponse = Invoke-RestMethod -Method Get -Uri "$baseUrl/forum/categories"
  $currentCategories = @($categoryResponse.data)
  $missingCategories = @(
    foreach ($candidate in $categoriesToEnsure) {
      $slug = $candidate.name.Normalize([Text.NormalizationForm]::FormKD) `
        -replace '[\u0300-\u036f]', '' `
        -replace '[^a-zA-Z0-9]+', '-'
      $slug = $slug.Trim('-').ToLowerInvariant()
      $existing = $currentCategories | Where-Object { $_.slug -eq $slug } | Select-Object -First 1
      if (-not $existing) {
        [PSCustomObject]@{ name = $candidate.name; slug = $slug; description = $candidate.description }
      }
    }
  )

  if ($missingCategories.Count -eq 0) {
    Write-Host 'Semua kategori yang disiapkan sudah tersedia; tidak ada perubahan.' -ForegroundColor Green
    exit 0
  }

  Write-Host "Akan memastikan $($categoriesToEnsure.Count) kategori; $($missingCategories.Count) perlu dibuat." -ForegroundColor Cyan
  $adminToken = Read-AccessToken 'Masukkan access token ADMIN staging (input disembunyikan)'
  $adminHeaders = @{ Authorization = "Bearer $adminToken" }
  $createdCount = 0
  $skippedCount = 0

  foreach ($candidate in $categoriesToEnsure) {
    $slug = $candidate.name.Normalize([Text.NormalizationForm]::FormKD) `
      -replace '[\u0300-\u036f]', '' `
      -replace '[^a-zA-Z0-9]+', '-'
    $slug = $slug.Trim('-').ToLowerInvariant()
    $existing = $currentCategories | Where-Object { $_.slug -eq $slug } | Select-Object -First 1

    if ($existing) {
      Write-Host "Lewati (sudah ada): $($existing.name) [$($existing.id)]" -ForegroundColor DarkGray
      $skippedCount++
      continue
    }

    $requestBody = @{
      name = $candidate.name
      description = $candidate.description
    } | ConvertTo-Json

    $created = Invoke-RestMethod `
      -Method Post `
      -Uri "$baseUrl/forum/admin/categories" `
      -Headers $adminHeaders `
      -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($requestBody))

    $currentCategories += $created.data
    Write-Host "Dibuat: $($created.data.name) [$($created.data.id)]" -ForegroundColor Green
    $createdCount++
  }

  $adminHeaders = $null
  $adminToken = $null
  Write-Host ''
  Write-Host "Selesai. Dibuat: $createdCount; dilewati: $skippedCount." -ForegroundColor Green
  Write-Host "Periksa hasilnya dengan GET $baseUrl/forum/categories"
}
catch {
  Write-Host ''
  Write-Host "Gagal: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Pastikan token memiliki role admin di staging dan kategori tidak sedang dinonaktifkan.' -ForegroundColor Yellow
  exit 1
}
