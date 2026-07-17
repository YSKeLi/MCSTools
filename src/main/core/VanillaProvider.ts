import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; url: string }>
}

interface VersionDetail {
  downloads: {
    server: { url: string }
  }
}

export class VanillaProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'vanilla',
    name: 'Vanilla',
    type: 'vanilla',
    description: 'Mojang 官方原版服务端，最纯净的 Minecraft 体验',
    color: '#4CAF50',
    iconUrl: '/icons/vanilla.ico',
  }

  private manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest.json'

  async fetchVersions(): Promise<CoreVersion[]> {
    const manifests = await Promise.allSettled([
      fetchJson<Manifest>(this.manifestUrl),
      fetchJson<Manifest>('https://launchermeta.mojang.com/mc/game/version_manifest.json'),
    ])

    const versions = new Set<string>()
    for (const manifest of manifests) {
      if (manifest.status !== 'fulfilled') continue
      manifest.value.versions
        .filter(v => v.type === 'release')
        .forEach(v => versions.add(v.id))
    }

    return Array.from(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .map(v => ({ id: v, type: 'release' as const }))
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const manifest = await fetchJson<Manifest>(this.manifestUrl)
    const entry = manifest.versions.find(v => v.id === version)
    if (!entry) throw new Error(`版本 ${version} 未找到`)

    const detail = await fetchJson<VersionDetail>(entry.url)
    if (!detail.downloads?.server?.url) throw new Error(`版本 ${version} 无服务端下载链接`)

    const jarPath = path.join(destDir, 'server.jar')
    await downloadFile(detail.downloads.server.url, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string): string {
    return path.join(serverDir, 'server.jar')
  }

  getDefaultArgs(): string[] {
    return []
  }
}
