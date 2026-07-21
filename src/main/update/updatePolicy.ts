import * as path from 'path'

export interface UpdateAsset {
  name: string
  url: string
  size?: number
  sha256?: string
}
export interface UpdateInfo {
  repo: string
  source: string
  version: string
  tag: string
  title: string
  publishedAt?: string | null
  url: string
  notes: string[]
  assets: UpdateAsset[]
  assetsCount: number
}

export function compareVersions(currentVersion: string, latestVersion: string): number {
  const current = currentVersion.split('.').map(part => Number.parseInt(part, 10) || 0)
  const latest = latestVersion.split('.').map(part => Number.parseInt(part, 10) || 0)
  const length = Math.max(current.length, latest.length)

  for (let index = 0; index < length; index += 1) {
    const left = current[index] || 0
    const right = latest[index] || 0
    if (left !== right) return left - right
  }

  return 0
}

export function selectUpdateAsset(
  assets: UpdateAsset[],
  platform: NodeJS.Platform,
  architecture: string,
): UpdateAsset | null {
  const platformKey = platform === 'win32'
    ? 'Windows'
    : platform === 'darwin'
      ? 'macOS'
      : platform === 'linux'
        ? 'Linux'
        : ''
  if (!platformKey) return null

  const archKey = architecture === 'arm64' ? 'arm64' : architecture === 'x64' ? 'x64' : ''
  if (!archKey) return null

  const suffix = `${platformKey}-${archKey}`
  const preferredExtensions = platform === 'win32'
    ? ['.exe', '.msi']
    : platform === 'darwin'
      ? ['.dmg']
      : ['.AppImage', '.deb', '.rpm']

  for (const extension of preferredExtensions) {
    const exact = assets.find(asset => asset.name === `MCServerTools-${suffix}${extension}`)
    if (exact) return exact
  }

  return null
}

export function normalizeSha256(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase().replace(/^sha256:/, '').trim()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined
}

export function assertTrustedUpdateAsset(asset: UpdateAsset): UpdateAsset & { sha256: string } {
  if (!asset || typeof asset !== 'object') throw new Error('更新资源信息无效')
  if (!asset.name || path.basename(asset.name) !== asset.name || !/^[A-Za-z0-9._-]+$/.test(asset.name)) {
    throw new Error('更新资源文件名无效')
  }

  let parsed: URL
  try {
    parsed = new URL(asset.url)
  } catch {
    throw new Error('更新资源地址无效')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('更新资源必须来自 GitHub 官方发布页')
  }
  if (!/^\/YSKeLi\/MCSTools\/releases\/download\//.test(parsed.pathname)) {
    throw new Error('更新资源不属于 MCServerTools 官方仓库')
  }

  const sha256 = normalizeSha256(asset.sha256)
  if (!sha256) throw new Error('更新资源缺少有效的 SHA-256 校验值')
  if (asset.size !== undefined && (!Number.isSafeInteger(asset.size) || asset.size <= 0)) {
    throw new Error('更新资源大小无效')
  }

  return { ...asset, sha256 }
}
