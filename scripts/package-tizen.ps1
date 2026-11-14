# Builds and signs the Samsung package with the local Tizen tools and author certificate.
# The certificate lives outside the repository: an update must be signed by the same one.
# -Target tizen-native packs the native interface (LG-C built with its build.sh tizen).
param([string]$Target = 'tizen-armv7')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tizen = 'C:\tizen-studio\tools\ide\bin\tizen.bat'
if (-not (Test-Path $tizen)) { throw "Tizen CLI not found at $tizen" }

Push-Location $projectRoot
try {
    & node .\scripts\build-ui.js
    if ($LASTEXITCODE -ne 0) { throw 'build-ui failed' }
    & node .\scripts\build-tizen.js $Target
    if ($LASTEXITCODE -ne 0) { throw 'build-tizen failed' }

    $stage = Join-Path $projectRoot ".build\$Target"
    $version = (Get-Content (Join-Path $projectRoot "profiles\$Target.json") -Raw | ConvertFrom-Json).version
    & $tizen package -t wgt -s stremcompat -- $stage | Out-Null
    $built = Get-ChildItem $stage -Filter '*.wgt' | Select-Object -First 1
    if (-not $built) { throw 'tizen package did not produce a .wgt' }

    $dist = Join-Path $projectRoot 'dist\tizen'
    New-Item -ItemType Directory -Force $dist | Out-Null
    $wgt = Join-Path $dist "StremCompat-Tizen-$($Target -replace '^tizen-', '')-$version.wgt"
    Move-Item -LiteralPath $built.FullName -Destination $wgt -Force
    $sizeMb = [math]::Round((Get-Item $wgt).Length / 1MB, 2)
    "Package ready: $wgt ($sizeMb MB)"
} finally {
    Pop-Location
}
