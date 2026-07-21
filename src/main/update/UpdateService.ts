import { spawn, spawnSync } from 'child_process'
import { app, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { downloadFile, fetchJson } from '../utils/download'
import {
  assertTrustedUpdateAsset,
  compareVersions,
  normalizeSha256,
  selectUpdateAsset,
  type UpdateAsset,
  type UpdateInfo,
} from './updatePolicy'

const REPOSITORY = 'YSKeLi/MCSTools'
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const FALLBACK_INFO_URLS = [
  'https://raw.githubusercontent.com/YSKeLi/MCSTools/main/public/latest.json',
  'https://cdn.jsdelivr.net/gh/YSKeLi/MCSTools@main/public/latest.json',
]
const UPDATE_DOWNLOAD_HOSTS = ['github.com', 'release-assets.githubusercontent.com']

interface GitHubReleaseAsset {
  name?: string
  size?: number
  digest?: string | null
  browser_download_url?: string
}

interface GitHubRelease {
  tag_name?: string
  name?: string | null
  html_url?: string
  published_at?: string | null
  body?: string | null
  assets?: GitHubReleaseAsset[]
}

function releaseNotes(body?: string | null): string[] {
  return (body || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*#]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 30)
}

function normalizeGitHubRelease(release: GitHubRelease): UpdateInfo {
  const tag = String(release.tag_name || '').trim()
  const version = tag.replace(/^v/i, '')
  if (!/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('GitHub 发布版本号无效')
  }

  const assets: UpdateAsset[] = (release.assets || []).flatMap((asset) => {
    if (!asset.name || !asset.browser_download_url) return []
    return [{
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: normalizeSha256(asset.digest || undefined),
    }]
  })

  return {
    repo: REPOSITORY,
    source: 'github-release-api',
    version,
    tag,
    title: release.name || tag,
    publishedAt: release.published_at,
    url: release.html_url || `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
    notes: releaseNotes(release.body),
    assets,
    assetsCount: assets.length,
  }
}

function validateFallbackInfo(value: unknown): UpdateInfo {
  if (!value || typeof value !== 'object') throw new Error('更新信息格式无效')
  const raw = value as Partial<UpdateInfo>
  if (raw.repo !== REPOSITORY || typeof raw.version !== 'string' || typeof raw.tag !== 'string') {
    throw new Error('更新信息来源无效')
  }
  if (!Array.isArray(raw.assets)) throw new Error('更新资源列表无效')
  const assets = raw.assets.flatMap((asset) => {
    if (!asset || typeof asset.name !== 'string' || typeof asset.url !== 'string') return []
    return [{
      name: asset.name,
      url: asset.url,
      size: asset.size,
      sha256: normalizeSha256(asset.sha256),
    }]
  })
  return {
    repo: REPOSITORY,
    source: String(raw.source || 'fallback'),
    version: raw.version,
    tag: raw.tag,
    title: String(raw.title || raw.tag),
    publishedAt: raw.publishedAt || null,
    url: typeof raw.url === 'string' ? raw.url : `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(raw.tag)}`,
    notes: Array.isArray(raw.notes) ? raw.notes.filter(note => typeof note === 'string').slice(0, 30) : [],
    assets,
    assetsCount: assets.length,
  }
}

export function getProjectVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(app.getAppPath(), 'package.json'),
    path.join(app.getAppPath(), '..', 'package.json'),
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version?: unknown }
      if (typeof value.version === 'string') return value.version
    } catch {
      // Try the next packaged location.
    }
  }

  return app.getVersion()
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    return normalizeGitHubRelease(await fetchJson<GitHubRelease>(RELEASE_API))
  } catch (primaryError) {
    let lastError = primaryError instanceof Error ? primaryError : new Error(String(primaryError))
    for (const url of FALLBACK_INFO_URLS) {
      try {
        return validateFallbackInfo(await fetchJson<unknown>(`${url}?t=${Date.now()}`))
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    throw lastError
  }
}

async function installUpdate(filePath: string): Promise<void> {
  const extension = path.extname(filePath).toLowerCase()
  if (process.platform === 'win32') {
    if (extension === '.exe') {
      spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
      return
    }
    if (extension === '.msi') {
      spawn('msiexec.exe', ['/i', filePath], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
      return
    }
  }

  if (process.platform === 'linux' && extension === '.appimage') {
    fs.chmodSync(filePath, 0o755)
    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
    return
  }

  const openError = await shell.openPath(filePath)
  if (openError) throw new Error(openError)
}

function verifyPlatformSignature(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase()
  if (process.platform === 'win32' && (extension === '.exe' || extension === '.msi')) {
    const escapedPath = filePath.replace(/'/g, "''")
    const command = `$ProgressPreference = 'SilentlyContinue'; $signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; [Console]::Out.Write($signature.Status.ToString())`
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
    const result = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedCommand,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    if (result.status !== 0 || result.stdout.trim() !== 'Valid') {
      throw new Error('更新安装包数字签名无效，已拒绝执行')
    }
  }

  if (process.platform === 'darwin' && extension === '.dmg') {
    const result = spawnSync('codesign', ['--verify', '--deep', '--strict', filePath], {
      encoding: 'utf8',
      timeout: 15000,
    })
    if (result.status !== 0) throw new Error('更新安装包代码签名无效，已拒绝打开')
  }
}

export async function downloadAndInstallUpdate(
  mainWindow: BrowserWindow,
): Promise<{ filePath: string; assetName: string }> {
  const latestInfo = await checkForUpdates()
  const currentVersion = getProjectVersion()
  if (compareVersions(currentVersion, latestInfo.version) >= 0) throw new Error('当前已经是最新版本')

  const selected = selectUpdateAsset(latestInfo.assets, process.platform, process.arch)
  if (!selected) throw new Error('当前版本未提供适用于此系统和架构的安装包')
  const asset = assertTrustedUpdateAsset(selected)

  const updateDir = path.join(app.getPath('temp'), 'MCServerTools-updates', latestInfo.version)
  fs.mkdirSync(updateDir, { recursive: true })
  const filePath = path.join(updateDir, asset.name)
  await downloadFile(asset.url, filePath, mainWindow, {
    progressChannel: 'update:downloadProgress',
    expectedSha256: asset.sha256,
    expectedSize: asset.size,
    allowedHosts: UPDATE_DOWNLOAD_HOSTS,
  })
  verifyPlatformSignature(filePath)
  await installUpdate(filePath)
  return { filePath, assetName: asset.name }
}
