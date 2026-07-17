import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export class PurpurProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'purpur', name: 'Purpur', type: 'bukkit',
    description: 'Paper 分支，提供更多自定义配置选项',
    color: '#9C27B0', iconUrl: '/icons/purpur.ico',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    const data: any = await fetchJson('https://api.purpurmc.org/v2/purpur')
    return (data.versions || []).map((v: string) => ({ id: v, type: 'release' as const }))
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const url = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`
    const jarPath = path.join(destDir, 'purpur.jar')
    await downloadFile(url, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'purpur.jar') }
  getDefaultArgs() { return [] }
}
