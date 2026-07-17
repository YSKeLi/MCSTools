param(
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "错误: 未找到 git" -ForegroundColor Red
  exit 1
}

try {
  $null = git rev-parse --is-inside-work-tree 2>$null
} catch {
  Write-Host "错误: 当前目录不是 git 仓库" -ForegroundColor Red
  exit 1
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "正在拉取 origin/$Branch ..." -ForegroundColor Cyan
git pull origin $Branch

if ($?) {
  Write-Host "拉取成功!" -ForegroundColor Green
} else {
  Write-Host "拉取失败，请检查网络连接" -ForegroundColor Red
}
