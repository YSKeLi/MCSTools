import { BrowserWindow } from 'electron'
import * as path from 'path'
import { downloadFile, fetchJson } from '../utils/download'
import type { CoreInfo, CoreVersion } from './CoreProvider'

interface MirrorsResponse {
  code: number
  message: string
  data: Record<string, string[]>
}

interface VersionsResponse {
  code: number
  message: string
  data: {
    description?: string
    versions: string[]
  }
}

interface DownloadResponse {
  code: number
  message: string
  data: {
    url: string
    sha256?: string
  }
}

const MIRRORS_API = 'https://api.mslmc.cn/v4/mirrors'
const DOWNLOAD_API = 'https://api.mslmc.cn/v4/download/server'

const CATEGORY_ORDER = [
  'pluginsCore',
  'pluginsAndModsCore_Forge',
  'pluginsAndModsCore_Fabric',
  'modsCore_Forge',
  'modsCore_Fabric',
  'vanillaCore',
  'bedrockCore',
  'proxyCore',
] as const

const CATEGORY_META: Record<string, { type: CoreInfo['type']; color: string; label: string; description: string }> = {
  pluginsCore: {
    type: 'bukkit',
    color: '#10B981',
    label: '插件服务端',
    description: '支持 Bukkit、Spigot、Paper 等插件生态的服务端核心。',
  },
  pluginsAndModsCore_Forge: {
    type: 'hybrid',
    color: '#F97316',
    label: 'NeoForge 系混合服务端',
    description: '同时支持 NeoForge 或 Forge 模组与插件的混合核心。',
  },
  pluginsAndModsCore_Fabric: {
    type: 'hybrid',
    color: '#EC4899',
    label: 'Fabric 混合服务端',
    description: '同时支持 Fabric 模组与插件的混合核心。',
  },
  modsCore_Forge: {
    type: 'modded',
    color: '#3B82F6',
    label: 'NeoForge 系模组服务端',
    description: '专门用于运行 NeoForge 或 Forge 模组的核心。',
  },
  modsCore_Fabric: {
    type: 'modded',
    color: '#6366F1',
    label: 'Fabric 模组服务端',
    description: '专门用于运行 Fabric 或 Quilt 模组的核心。',
  },
  vanillaCore: {
    type: 'vanilla',
    color: '#22C55E',
    label: '原版服务端',
    description: 'Minecraft 官方原版服务端核心。',
  },
  bedrockCore: {
    type: 'vanilla',
    color: '#14B8A6',
    label: '基岩版服务端',
    description: '用于基岩版的服务端核心，部分版本为压缩包。',
  },
  proxyCore: {
    type: 'hybrid',
    color: '#8B5CF6',
    label: '代理服务端',
    description: '用于连接多个服务器实例的代理核心。',
  },
}

const CORE_NAME_MAP: Record<string, string> = {
  paper: 'Paper',
  purpur: 'Purpur',
  leaf: 'Leaf',
  spigot: 'Spigot',
  bukkit: 'CraftBukkit',
  folia: 'Folia',
  leaves: 'Leaves',
  pufferfish: 'Pufferfish',
  pufferfish_purpur: 'Pufferfish Purpur',
  spongevanilla: 'SpongeVanilla',
  'arclight-forge': 'Arclight Forge',
  'arclight-neoforge': 'Arclight NeoForge',
  youer: 'Youer',
  mohist: 'Mohist',
  catserver: 'CatServer',
  spongeforge: 'SpongeForge',
  'arclight-fabric': 'Arclight Fabric',
  banner: 'Banner',
  neoforge: 'NeoForge',
  forge: 'Forge',
  fabric: 'Fabric',
  quilt: 'Quilt',
  vanilla: 'Vanilla',
  'vanilla-snapshot': 'Vanilla Snapshot',
  'bedrock-server': 'Bedrock Server',
  nukkitx: 'NukkitX',
  velocity: 'Velocity',
  bungeecord: 'BungeeCord',
  lightfall: 'Lightfall',
  travertine: 'Travertine',
}

function prettifyCoreName(id: string): string {
  if (CORE_NAME_MAP[id]) return CORE_NAME_MAP[id]

  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferVersionType(version: string): CoreVersion['type'] {
  const lower = version.toLowerCase()
  if (lower.includes('snapshot') || lower.includes('pre') || lower.includes('rc')) return 'snapshot'
  if (lower.includes('beta')) return 'beta'
  if (lower.includes('alpha')) return 'alpha'
  return 'release'
}

function getCoreIconUrl(coreId: string): string | undefined {
  const iconMap: Record<string, string> = {
    vanilla: '/icons/vanilla.ico',
    paper: '/icons/paper.ico',
    purpur: '/icons/purpur.ico',
    forge: '/icons/forge.ico',
    fabric: '/icons/fabric.svg',
    neoforge: '/icons/neoforge.ico',
    mohist: '/icons/mohist.png',
    spongevanilla: '/icons/sponge.ico',
    bukkit: '/icons/craftbukkit.ico',
    spigot: '/icons/spigot.svg',
  }

  return iconMap[coreId]
}

function getDownloadFileName(coreId: string, version: string, downloadUrl: string): string {
  try {
    const parsed = new URL(downloadUrl)
    const pathname = parsed.pathname
    const basename = path.basename(pathname)

    if (basename && basename.includes('.') && basename !== 'download') {
      return basename
    }

    const format = parsed.searchParams.get('format')
    if (format) return `${coreId}-${version}.${format}`
    if (pathname.endsWith('/jar')) return `${coreId}-${version}.jar`
  } catch {
    // ignore
  }

  return `${coreId}-${version}.jar`
}

export async function getAllProviders(): Promise<CoreInfo[]> {
  const mirrors = await fetchJson<MirrorsResponse>(MIRRORS_API)
  if (mirrors.code !== 200 || !mirrors.data) {
    throw new Error(mirrors.message || '获取服务端列表失败')
  }

  return CATEGORY_ORDER.flatMap((categoryKey) => {
    const category = CATEGORY_META[categoryKey]
    const cores = mirrors.data[categoryKey] || []

    return cores.map((coreId) => ({
      id: coreId,
      name: prettifyCoreName(coreId),
      type: category.type,
      categoryKey,
      categoryName: category.label,
      categoryDescription: category.description,
      description: category.description,
      iconUrl: getCoreIconUrl(coreId),
      color: category.color,
    }))
  })
}

export async function getVersions(id: string): Promise<CoreVersion[]> {
  const response = await fetchJson<VersionsResponse>(`${MIRRORS_API}/${id}`)
  if (response.code !== 200 || !response.data) {
    throw new Error(response.message || `获取 ${id} 版本列表失败`)
  }

  return response.data.versions.map(version => ({
    id: version,
    type: inferVersionType(version),
  }))
}

export async function downloadCore(id: string, version: string, destDir: string, win?: BrowserWindow): Promise<string> {
  const response = await fetchJson<DownloadResponse>(`${DOWNLOAD_API}/${id}/${encodeURIComponent(version)}`)
  if (response.code !== 200 || !response.data?.url) {
    throw new Error(response.message || `获取 ${id} ${version} 下载地址失败`)
  }

  const fileName = getDownloadFileName(id, version, response.data.url)
  const filePath = path.join(destDir, fileName)
  const expectedSha256 = response.data.sha256?.replace(/^sha256:/i, '').trim().toLowerCase()
  if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('下载源未提供有效的 SHA-256 校验值，已拒绝下载')
  }
  await downloadFile(response.data.url, filePath, win, {
    expectedSha256,
  })
  return filePath
}
