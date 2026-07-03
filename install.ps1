# enx installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/enowdev/enowx/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "enowdev/enowx"
$Bin = "enx"
$InstallDir = if ($env:ENX_INSTALL_DIR) { $env:ENX_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\enx" }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "amd64" }
  "ARM64" { "arm64" }
  default { throw "unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
}

$asset = "$Bin-windows-$arch.exe"
$tag = if ($env:ENX_VERSION) { $env:ENX_VERSION } else {
  (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest").tag_name
}
if (-not $tag) { throw "could not determine latest release tag" }

$url = "https://github.com/$Repo/releases/download/$tag/$asset"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$dest = Join-Path $InstallDir "$Bin.exe"

Write-Host "Downloading $Bin $tag (windows/$arch)..."
Invoke-WebRequest -Uri $url -OutFile $dest

# Verify checksum when published alongside the asset.
try {
  $shaRaw = (Invoke-WebRequest -Uri "$url.sha256" -UseBasicParsing).Content
  # .Content can come back as a byte array (no charset on the response); coerce
  # to text before splitting, and use the -split operator so it works either way.
  if ($shaRaw -is [byte[]]) { $shaRaw = [System.Text.Encoding]::UTF8.GetString($shaRaw) }
  $sha = ([string]$shaRaw -split '\s+')[0].Trim().ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
  if ($sha -and $sha -ne $actual) { throw "checksum mismatch" }
} catch {
  Write-Host "checksum skipped: $($_.Exception.Message)"
}

# Add install dir to the user PATH if missing.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to your PATH (restart the terminal to use 'enx')."
}

Write-Host "Installed $Bin to $dest"
& $dest version
