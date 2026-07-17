export interface CoreVersion {
  id: string
  type: 'release' | 'snapshot' | 'beta' | 'alpha'
}

export interface CoreInfo {
  id: string
  name: string
  type: 'vanilla' | 'bukkit' | 'modded' | 'hybrid'
  categoryKey?: string
  categoryName?: string
  categoryDescription?: string
  description: string
  iconUrl?: string
  color: string
}

import { BrowserWindow } from 'electron'

export interface CoreProvider {
  info: CoreInfo
  fetchVersions(): Promise<CoreVersion[]>
  download(version: string, destDir: string, win?: BrowserWindow): Promise<string>
  getLaunchJar(serverDir: string): string
  getDefaultArgs(): string[]
}

export class StubProvider implements CoreProvider {
  info: CoreInfo
  constructor(info: CoreInfo) { this.info = info }
  async fetchVersions(): Promise<CoreVersion[]> { return [] }
  async download(_version: string, _destDir: string, _win?: BrowserWindow): Promise<string> {
    throw new Error(`${this.info.name} 下载功能尚未实现`)
  }
  getLaunchJar(_serverDir: string): string { return 'server.jar' }
  getDefaultArgs(): string[] { return [] }
}
