$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1/3] Building code..." -ForegroundColor Cyan
npm run build

Write-Host "[2/3] Building Windows x64 installer..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npx electron-builder --win --x64

Write-Host "[3/3] Building Windows arm64 installer..." -ForegroundColor Cyan
npx electron-builder --win --arm64

Write-Host "Done! Installers are in release/ folder" -ForegroundColor Green
pause
