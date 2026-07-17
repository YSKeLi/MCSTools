import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

interface GhRelease { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> }
interface GhTag { name: string }
interface MohistProjectVersions { versions?: string[] }

export class MohistProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'mohist', name: 'Mohist', type: 'hybrid',
    description: '混合核心，同时支持 Forge Mod 和 Bukkit 插件',
    color: '#F44336', iconUrl: '/icons/mohist.png',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    const sources = await Promise.allSettled([
      this.fetchFromOfficialApi(),
      this.fetchFromReleases(),
      this.fetchFromTags(),
    ])

    const versions = new Set<string>()
    for (const source of sources) {
      if (source.status !== 'fulfilled') continue
      source.value.forEach(version => versions.add(version))
    }

    return Array.from(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .map(v => ({ id: v, type: 'release' as const }))
  }

  private async fetchFromOfficialApi(): Promise<string[]> {
    const data = await fetchJson<MohistProjectVersions>('https://mohistmc.com/api/v2/projects/mohist')
    return (data.versions || []).filter(Boolean)
  }

  private async fetchFromReleases(): Promise<string[]> {
    const releases = await fetchJson<GhRelease[]>('https://api.github.com/repos/mohistmc/mohist/releases?per_page=20')
    return releases
      .filter(r => !/beta|alpha/i.test(r.tag_name))
      .map(r => r.tag_name.replace(/^v/i, ''))
  }

  private async fetchFromTags(): Promise<string[]> {
    const tags = await fetchJson<GhTag[]>('https://api.github.com/repos/mohistmc/mohist/tags?per_page=50')
    return tags
      .map(tag => tag.name.replace(/^v/i, ''))
      .filter(name => !/beta|alpha/i.test(name))
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const releases = await fetchJson<GhRelease[]>(`https://api.github.com/repos/mohistmc/mohist/releases?per_page=20`)
    const tag = `v${version}`
    const release = releases.find(r => r.tag_name === tag || r.tag_name === version)
    if (!release) throw new Error(`Mohist 版本 ${version} 未找到`)

    const asset = release.assets.find(a => a.name.endsWith('.jar') && !a.name.includes('installer'))
    if (!asset) throw new Error(`版本 ${version} 无可用服务端 JAR`)

    const jarPath = path.join(destDir, 'mohist.jar')
    await downloadFile(asset.browser_download_url, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'mohist.jar') }
  getDefaultArgs() { return [] }
}
