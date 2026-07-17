import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchText, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export class SpongeProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'sponge', name: 'Sponge', type: 'modded',
    description: '全新架构的 Mod API，稳定且高性能',
    color: '#FFD700', iconUrl: '/icons/sponge.ico',
  }

  private browseBaseUrl = 'https://repo.spongepowered.org/service/rest/repository/browse/maven-releases/org/spongepowered/spongevanilla'

  async fetchVersions(): Promise<CoreVersion[]> {
    const html = await fetchText(`${this.browseBaseUrl}/`)
    const versions = new Set<string>()
    for (const match of html.matchAll(/href="([^"]+)\/"/g)) {
      const value = match[1]
      if (!value || value === '..' || value.includes('static/')) continue
      if (value.includes('Parent Directory')) continue
      versions.add(value.replace(/\/$/, ''))
    }

    return Array.from(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .map(v => ({ id: v, type: 'release' as const }))
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const html = await fetchText(`${this.browseBaseUrl}/${version}/`)
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const primaryJarMatch = html.match(new RegExp(`href="(https://repo\\.spongepowered\\.org/repository/maven-releases/org/spongepowered/spongevanilla/${escapedVersion}/spongevanilla-${escapedVersion}\\.jar)"`))
    const fallbackJarMatch = html.match(new RegExp(`href="(https://repo\\.spongepowered\\.org/repository/maven-releases/org/spongepowered/spongevanilla/${escapedVersion}/spongevanilla-${escapedVersion}(?!-sources|-dev)[^"]*\\.jar)"`))
    const url = primaryJarMatch?.[1] || fallbackJarMatch?.[1]
    if (!url) throw new Error(`Sponge 版本 ${version} 无下载链接`)

    const jarPath = path.join(destDir, 'sponge.jar')
    await downloadFile(url, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'sponge.jar') }
  getDefaultArgs() { return [] }
}
