# Runs Impeccable's generate-image with credentials from .impeccable/image.env
# Usage:  powershell -NoProfile -File tools\impeccable-image.ps1 generate-image --prompt "..." --out path.png
#
# The key never appears on the command line, in shell history, or in this script.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".impeccable\image.env"

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: missing $envFile"
    exit 2
}

$count = 0
foreach ($line in @(Get-Content -LiteralPath $envFile)) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }
    if ($trimmed.StartsWith("#")) { continue }
    $idx = $trimmed.IndexOf([char]61)
    if ($idx -lt 1) { continue }
    $name = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()
    if ($value.Length -eq 0) { continue }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    $count = $count + 1
}

if ($count -eq 0) {
    Write-Host "ERROR: no values found in $envFile"
    exit 2
}

$key = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "Process")
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host "ERROR: OPENAI_API_KEY is empty in $envFile"
    exit 2
}

$launcher = Join-Path $env:USERPROFILE ".agents\skills\impeccable\scripts\impeccable.cmd"
if (-not (Test-Path $launcher)) {
    Write-Host "ERROR: Impeccable launcher not found at $launcher"
    exit 2
}

& $launcher @args
exit $LASTEXITCODE
