$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$apiHost = 'https://api.cloudinary.com/v1_1'
$targetFolderPath = 'aquaku/forum'
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

function Get-EncodedFolderPath([string] $Path) {
  return (($Path -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
}

try {
  $cloudName = (Read-Host 'Cloudinary cloud name').Trim()
  $adminApiKey = (Read-Host 'Admin API caller key dengan izin melihat folder').Trim()
  $adminApiSecret = Read-SecretText 'Admin API caller secret (input disembunyikan)'
  if (-not $cloudName -or -not $adminApiKey) {
    throw 'Cloud name dan Admin API caller key wajib diisi.'
  }

  $basicAuth = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes(('{0}:{1}' -f $adminApiKey, $adminApiSecret))
  )
  $headers = @{ Authorization = "Basic $basicAuth" }
  $baseUri = "$apiHost/$cloudName"
  $allFolders = New-Object 'System.Collections.Generic.List[object]'
  $queue = New-Object System.Collections.Queue
  $visited = @{}

  Write-Host 'Membaca root folders memakai Admin API caller...' -ForegroundColor Cyan
  $currentStep = 'membaca root folders'
  $rootUri = "$baseUri/folders?max_results=500"
  do {
    $rootPage = Invoke-RestMethod -Method Get -Uri $rootUri -Headers $headers
    foreach ($folder in $rootPage.folders) {
      if ($folder.path) {
        $allFolders.Add($folder)
        $queue.Enqueue([string] $folder.path)
      }
    }
    if ($rootPage.next_cursor) {
      $rootUri = "$baseUri/folders?max_results=500&next_cursor=$([Uri]::EscapeDataString([string] $rootPage.next_cursor))"
    }
  } while ($rootPage.next_cursor)

  while ($queue.Count -gt 0) {
    $parentPath = [string] $queue.Dequeue()
    if ($visited.ContainsKey($parentPath)) { continue }
    $visited[$parentPath] = $true

    $currentStep = "membaca subfolder '$parentPath'"
    $encodedPath = Get-EncodedFolderPath $parentPath
    $childrenUri = "$baseUri/folders/$encodedPath`?max_results=500"
    do {
      $childrenPage = Invoke-RestMethod -Method Get -Uri $childrenUri -Headers $headers
      foreach ($child in $childrenPage.folders) {
        if ($child.path -and -not $visited.ContainsKey([string] $child.path)) {
          $allFolders.Add($child)
          $queue.Enqueue([string] $child.path)
        }
      }
      if ($childrenPage.next_cursor) {
        $childrenUri = "$baseUri/folders/$encodedPath`?max_results=500&next_cursor=$([Uri]::EscapeDataString([string] $childrenPage.next_cursor))"
      }
    } while ($childrenPage.next_cursor)
  }

  Write-Host ''
  if ($allFolders.Count -eq 0) {
    Write-Host 'Cloudinary tidak mengembalikan folder apa pun.' -ForegroundColor Yellow
  }
  else {
    Write-Host 'Folder yang ditemukan (path | external_id):' -ForegroundColor Cyan
    $allFolders |
      Sort-Object -Property path -Unique |
      ForEach-Object { Write-Host "$($_.path) | $($_.external_id)" }
  }

  $target = $allFolders | Where-Object { $_.path -eq $targetFolderPath } | Select-Object -First 1
  Write-Host ''
  if ($target) {
    Write-Host "Target '$targetFolderPath' TERDETEKSI. external_id: $($target.external_id)" -ForegroundColor Green
  }
  else {
    Write-Host "Target '$targetFolderPath' TIDAK terdeteksi oleh Admin API." -ForegroundColor Yellow
    Write-Host 'Periksa Cloudinary cloud name/product environment dan pastikan folder tersebut benar-benar dibuat di Media Library.' -ForegroundColor Yellow
  }
}
catch {
  Write-Host ''
  Write-Host "Gagal saat $currentStep`: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Admin API caller harus dapat melihat folder pada product environment ini; gunakan cloud name yang sama dengan staging.' -ForegroundColor Yellow
  exit 1
}
finally {
  $headers = $null
  $basicAuth = $null
  $adminApiSecret = $null
}
