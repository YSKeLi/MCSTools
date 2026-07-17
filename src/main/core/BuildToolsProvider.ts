import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export class CraftBukkitProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'craftbukkit', name: 'CraftBukkit', type: 'bukkit',
    description: '最早的 Bukkit 服务端实现，需通过 BuildTools 编译',
    color: '#FF9800', iconUrl: '/icons/craftbukkit.ico',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    return [{ id: 'latest', type: 'release' }]
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const btUrl = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar'
    const btPath = path.join(destDir, 'BuildTools.jar')
    await downloadFile(btUrl, btPath, win)
    throw new Error(`BuildTools 已下载到 ${btPath}。请在服务端目录运行: java -jar BuildTools.jar --rev ${version}，编译完成后将 craftbukkit-*.jar 放入服务端目录`)
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'craftbukkit.jar') }
  getDefaultArgs() { return [] }
}

export class SpigotProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'spigot', name: 'Spigot', type: 'bukkit',
    description: 'CraftBukkit 优化版，性能更好，插件兼容',
    color: '#FFB74D', iconUrl: '/icons/spigot.svg',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    return [{ id: 'latest', type: 'release' }]
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const btUrl = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar'
    const btPath = path.join(destDir, 'BuildTools.jar')
    await downloadFile(btUrl, btPath, win)
    throw new Error(`BuildTools 已下载到 ${btPath}。请在服务端目录运行: java -jar BuildTools.jar --rev ${version}，编译完成后将 spigot-*.jar 放入服务端目录`)
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'spigot.jar') }
  getDefaultArgs() { return [] }
}
