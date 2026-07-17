#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

NPM_CANDIDATES=(
  "https://registry.npmjs.org"
  "https://registry.npmmirror.com"
  "https://mirrors.cloud.tencent.com/npm/"
  "https://repo.huaweicloud.com/repository/npm/"
)

ELECTRON_CANDIDATES=(
  "https://github.com/electron/electron/releases/download/"
  "https://npmmirror.com/mirrors/electron/"
  "https://mirrors.huaweicloud.com/electron/"
)

CURRENT_ELECTRON_VERSION=""
BEST_NPM_REGISTRY=""
BEST_ELECTRON_MIRROR=""

usage() {
  cat <<'EOF'
用法：
  bash mcsrv-doctor.sh

功能：
  - 检查 node
  - 检查 npm
  - 检查 curl
  - 检查 package.json
  - 测试 npm 源
  - 如果项目依赖 electron，则测试 electron 镜像源
  - 将最快的源写入当前项目的 .npmrc
  - 执行 npm install
EOF
}

log() {
  printf '%s\n' "$1"
}

trim_trailing_slash() {
  local value="$1"
  value="${value%/}"
  printf '%s' "$value"
}

normalize_with_trailing_slash() {
  local value="$1"
  value="$(trim_trailing_slash "$value")"
  printf '%s/' "$value"
}

read_electron_version() {
  CURRENT_ELECTRON_VERSION="$(
    node -p "const pkg=require('./package.json'); (pkg.devDependencies&&pkg.devDependencies.electron)||(pkg.dependencies&&pkg.dependencies.electron)||''" 2>/dev/null || true
  )"
  CURRENT_ELECTRON_VERSION="${CURRENT_ELECTRON_VERSION#^}"
  CURRENT_ELECTRON_VERSION="${CURRENT_ELECTRON_VERSION#~}"
}

probe_url_time() {
  local url="$1"
  local result

  if ! result="$(
    curl -L --silent --show-error \
      --output /dev/null \
      --connect-timeout 4 \
      --max-time 12 \
      --write-out '%{http_code} %{time_total}' \
      "$url" 2>/dev/null
  )"; then
    return 1
  fi

  local http_code total_time
  http_code="$(printf '%s' "$result" | awk '{print $1}')"
  total_time="$(printf '%s' "$result" | awk '{print $2}')"

  if [[ "$http_code" != "200" && "$http_code" != "204" ]]; then
    return 1
  fi

  printf '%s' "$total_time"
}

probe_npm_registry() {
  local base_url="$1"
  local normalized
  normalized="$(normalize_with_trailing_slash "$base_url")"
  probe_url_time "${normalized}-/ping?write=true"
}

probe_electron_mirror() {
  local base_url="$1"
  local normalized
  normalized="$(normalize_with_trailing_slash "$base_url")"

  if [[ -z "$CURRENT_ELECTRON_VERSION" ]]; then
    return 1
  fi

  if [[ "$normalized" == "https://github.com/electron/electron/releases/download/" ]]; then
    probe_url_time "${normalized}v${CURRENT_ELECTRON_VERSION}/SHASUMS256.txt"
    return 0
  fi

  probe_url_time "${normalized}${CURRENT_ELECTRON_VERSION}/SHASUMS256.txt"
}

pick_fastest_npm_registry() {
  local best_time=""
  local candidate result

  log "正在测试 npm 源..."
  for candidate in "${NPM_CANDIDATES[@]}"; do
    printf '  %s ... ' "$candidate"
    if result="$(probe_npm_registry "$candidate")"; then
      printf '%s秒\n' "$result"
      if [[ -z "$best_time" ]] || awk "BEGIN {exit !($result < $best_time)}"; then
        best_time="$result"
        BEST_NPM_REGISTRY="$(trim_trailing_slash "$candidate")"
      fi
    else
      printf '失败\n'
    fi
  done

  if [[ -z "$BEST_NPM_REGISTRY" ]]; then
    log "没有找到可用的 npm 源。"
    exit 1
  fi

  log "最快的 npm 源：$BEST_NPM_REGISTRY"
}

pick_fastest_electron_mirror() {
  local best_time=""
  local candidate result

  if [[ -z "$CURRENT_ELECTRON_VERSION" ]]; then
    log "没有检测到 electron 依赖，跳过 electron 镜像测试。"
    return 0
  fi

  log "正在测试 electron 镜像源，版本：$CURRENT_ELECTRON_VERSION ..."
  for candidate in "${ELECTRON_CANDIDATES[@]}"; do
    printf '  %s ... ' "$candidate"
    if result="$(probe_electron_mirror "$candidate")"; then
      printf '%s秒\n' "$result"
      if [[ -z "$best_time" ]] || awk "BEGIN {exit !($result < $best_time)}"; then
        best_time="$result"
        BEST_ELECTRON_MIRROR="$(normalize_with_trailing_slash "$candidate")"
      fi
    else
      printf '失败\n'
    fi
  done

  if [[ -z "$BEST_ELECTRON_MIRROR" ]]; then
    log "没有找到可用的 electron 镜像源。接下来会继续使用当前或默认的 electron 下载源执行 npm install。"
    return 0
  fi

  log "最快的 electron 镜像源：$BEST_ELECTRON_MIRROR"
}

write_project_npmrc() {
  local npmrc_path="$ROOT_DIR/.npmrc"
  local temp_path
  temp_path="$(mktemp)"

  if [[ -f "$npmrc_path" ]]; then
    grep -Ev '^(registry|electron_mirror)=' "$npmrc_path" >"$temp_path" || true
  fi

  printf 'registry=%s\n' "$BEST_NPM_REGISTRY" >>"$temp_path"
  if [[ -n "$BEST_ELECTRON_MIRROR" ]]; then
    printf 'electron_mirror=%s\n' "$BEST_ELECTRON_MIRROR" >>"$temp_path"
  fi

  mv "$temp_path" "$npmrc_path"
  log "已将源配置写入：$npmrc_path"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

log "当前目录：$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  log "未找到 node，请先安装 Node.js。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  log "未找到 npm，请先安装 Node.js。"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  log "未找到 curl，请先安装 curl。"
  exit 1
fi

if [[ ! -f "$ROOT_DIR/package.json" ]]; then
  log "在以下目录没有找到 package.json：$ROOT_DIR"
  exit 1
fi

read_electron_version
pick_fastest_npm_registry
pick_fastest_electron_mirror
write_project_npmrc

log "正在执行 npm install..."
npm install

log "完成。"
