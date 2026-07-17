import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, fetchText, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

interface ForgePromo { latest?: string; recommended?: string }
interface ForgePromos { promos: Record<string, string> }

export class ForgeProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'forge', name: 'Forge', type: 'modded',
    description: '最流行的 Mod 加载器，支持大量 Mod',
    color: '#E65100', iconUrl: '/icons/forge.ico',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    const sources = await Promise.allSettled([
      this.fetchFromPromotions(),
      this.fetchFromMetadataXml(),
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

  private async fetchFromPromotions(): Promise<string[]> {
    const data = await fetchJson<ForgePromos>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
    const versions = new Set<string>()
    for (const key of Object.keys(data.promos)) {
      const mcVer = key.split('-')[0]
      if (mcVer && /^\d+\.\d+/.test(mcVer)) versions.add(mcVer)
    }
    return Array.from(versions)
  }

  private async fetchFromMetadataXml(): Promise<string[]> {
    const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml')
    const versions = new Set<string>()
    for (const match of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
      const fullVersion = match[1]
      const mcVer = fullVersion.split('-')[0]
      if (mcVer && /^\d+\.\d+/.test(mcVer)) versions.add(mcVer)
    }
    return Array.from(versions)
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const data = await fetchJson<ForgePromos>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
    let forgeVersion = data.promos[`${version}-recommended`] || data.promos[`${version}-latest`]
    if (!forgeVersion) throw new Error(`Forge 版本 ${version} 未找到`)

    const jarPath = path.join(destDir, 'forge-server.jar')
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-server.jar`
    try {
      await downloadFile(url, jarPath, win)
    } catch {
      const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`
      const installerPath = path.join(destDir, 'forge-installer.jar')
      await downloadFile(installerUrl, installerPath, win)
      throw new Error(`Forge 安装器已下载到 ${installerPath}，请在服务端目录运行: java -jar forge-installer.jar --installServer`)
    }
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'forge-server.jar') }
  getDefaultArgs() { return [] }
}
