import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export class FabricProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'fabric', name: 'Fabric', type: 'modded',
    description: '轻量级 Mod 加载器，加载快，版本更新迅速',
    color: '#2196F3', iconUrl: '/icons/fabric.svg',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    const sources = await Promise.allSettled([
      fetchJson<any[]>('https://meta.fabricmc.net/v2/versions/game'),
      fetchJson<any[]>('https://meta.fabricmc.net/v1/versions/game'),
    ])

    const versions = new Set<string>()
    for (const source of sources) {
      if (source.status !== 'fulfilled') continue
      source.value
        .filter((v: any) => v.stable)
        .forEach((v: any) => versions.add(v.version))
    }

    return Array.from(versions)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .map(v => ({ id: v, type: 'release' as const }))
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const loaders = await fetchJson<any[]>(`https://meta.fabricmc.net/v2/versions/loader/${version}`)
    const loader = loaders.find((l: any) => l.loader?.version)
    if (!loader) throw new Error(`Fabric 版本 ${version} 无可用加载器`)

    const jarUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader.loader.version}/server/jar`
    const jarPath = path.join(destDir, 'fabric-server.jar')
    await downloadFile(jarUrl, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'fabric-server.jar') }
  getDefaultArgs() { return [] }
}
