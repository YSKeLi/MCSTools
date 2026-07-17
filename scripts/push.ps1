param(
  [string]$Message = "update",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "错误: 未找到 git，请先安装 https://git-scm.com" -ForegroundColor Red
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

$remote = git remote -v
if (-not $remote) {
  Write-Host "未检测到远程仓库，请选择操作:" -ForegroundColor Yellow
  Write-Host "1. 推送到 https://github.com/YSKeLi/MCSTools.git"
  Write-Host "2. 输入自定义远程地址"
  $choice = Read-Host "请输入 (1 或 2)"

  if ($choice -eq "1") {
    git remote add origin "https://github.com/YSKeLi/MCSTools.git"
  } elseif ($choice -eq "2") {
    $url = Read-Host "请输入远程仓库 URL"
    git remote add origin $url
  } else {
    Write-Host "已取消" -ForegroundColor Red
    exit 1
  }
}

$current = git branch --show-current
if ($current -ne $Branch) {
  $exists = git show-ref --verify --quiet "refs/heads/$Branch"
  if ($?) {
    git checkout $Branch
  } else {
    git checkout -b $Branch
  }
}

$status = git status --porcelain
if ($status) {
  git add -A
  git commit -m "$Message"
  Write-Host "已提交: $Message" -ForegroundColor Green
} else {
  Write-Host "没有需要提交的更改" -ForegroundColor Yellow
}

Write-Host "正在推送到 origin/$Branch ..." -ForegroundColor Cyan
git push -u origin $Branch

if ($?) {
  Write-Host "推送成功!" -ForegroundColor Green
} else {
  Write-Host "推送失败，请检查网络或仓库权限" -ForegroundColor Red
}
