param(
    [switch]$AllowUnsigned,
    [switch]$UseCertificateStore
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}

if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

Write-Host "[1/3] Building code..." -ForegroundColor Cyan
npm run build

Write-Host "[2/3] Building Windows x64 installer..." -ForegroundColor Cyan
if ($AllowUnsigned) {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    Write-Warning "Building unsigned installers. Do not publish these artifacts."
} elseif (-not $UseCertificateStore -and -not $env:CSC_LINK -and -not $env:WIN_CSC_LINK) {
    throw "A code-signing certificate is required. Set CSC_LINK/CSC_KEY_PASSWORD, use -UseCertificateStore, or pass -AllowUnsigned for local testing only."
} else {
    Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue
}
node scripts/run-electron-builder.cjs --win --x64

Write-Host "[3/3] Building Windows arm64 installer..." -ForegroundColor Cyan
node scripts/run-electron-builder.cjs --win --arm64

Write-Host "Done! Installers are in release/ folder" -ForegroundColor Green
pause
