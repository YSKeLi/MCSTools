import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { downloadCore, getAllProviders, getVersions } from './core'
import { detectServer } from './detect'
import { getFrpConfig, listFrpConfigs, markFrpConfigUsed, removeFrpConfig, saveFrpConfig } from './frp/FrpConfigStore'
import { FrpManager } from './frp/FrpManager'
import { detectJava, downloadJavaPackage, getJava21OfficialPage, getJava21Packages, getJavaSystemProfile, openJavaDownload } from './java'
import { RemoteServerService } from './remote/RemoteServerService'
import { assertManagedServerDirectory, normalizeFsPath, writeServerMarker } from './security/pathPolicy'
import { ServerManager } from './server/ServerManager'
import { getLocalSystemMetrics } from './system/SystemMetricsService'
import { addServer, getServer, getServers, removeServer, updateServer } from './store'
import { checkForUpdates, downloadAndInstallUpdate, getProjectVersion } from './update/UpdateService'

const serverManager = new ServerManager()
const frpManager = new FrpManager()
const remoteServerService = new RemoteServerService()
const approvedDirectories = new Set<string>()
const pendingManagedDirectories = new Set<string>()
const approvedFrpFiles = new Set<string>()
const SERVER_PROFILE_FILE = 'profilemcsrv.toml'
let currentWindow: BrowserWindow | null = null
let ipcRegistered = false

function windowOrThrow(): BrowserWindow {
  if (!currentWindow || currentWindow.isDestroyed()) throw new Error('应用窗口不可用')
  return currentWindow
}

function emit(channel: string, ...args: unknown[]) {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send(channel, ...args)
}

function approveDirectory(directory: string): string {
  const resolved = path.resolve(directory)
  approvedDirectories.add(normalizeFsPath(resolved))
  return resolved
}

function assertApprovedDirectory(directory: string): string {
  const resolved = path.resolve(directory)
  if (!approvedDirectories.has(normalizeFsPath(resolved))) throw new Error('请先通过目录选择器选择该文件夹')
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('所选目录不存在')
  return resolved
}

function getServerFile(id: string, fileName: string): string {
  const server = getServer(id)
  if (!server) throw new Error('服务器不存在')
  return path.join(server.path, fileName)
}

function validateExternalUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('外部链接无效')
  }
  if (parsed.protocol !== 'https:') throw new Error('仅允许打开 HTTPS 链接')
  return parsed.toString()
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  currentWindow = mainWindow
  serverManager.setWindow(mainWindow)
  frpManager.setWindow(mainWindow)
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('core:getCores', () => getAllProviders())
  ipcMain.handle('core:getVersions', (_event, coreId: string) => getVersions(coreId))
  ipcMain.handle('core:download', (_event, coreId: string, version: string, directory: string) => {
    const destination = assertApprovedDirectory(directory)
    return downloadCore(coreId, version, destination, windowOrThrow())
  })

  ipcMain.handle('server:start', async (_event, id: string, maxRam: number) => {
    const server = updateServer(id, { maxRam })
    await serverManager.start({
      serverId: server.id,
      serverDir: server.path,
      jarPath: path.join(server.path, server.jarName),
      jarName: server.jarName,
      version: server.version,
      maxRam: server.maxRam,
      javaPath: server.javaPath,
    })
    emit('servers:changed')
  })
  ipcMain.handle('server:stop', (_event, id: string) => serverManager.stop(id))
  ipcMain.handle('server:forceStop', (_event, id: string) => serverManager.forceStop(id))
  ipcMain.handle('server:status', () => serverManager.getState())
  ipcMain.handle('server:command', (_event, id: string, command: string) => serverManager.sendCommand(id, command))
  ipcMain.handle('system:getMetrics', () => getLocalSystemMetrics())

  ipcMain.handle('servers:list', () => getServers())
  ipcMain.handle('servers:add', (_event, input) => {
    const directory = assertApprovedDirectory(input?.path)
    const normalizedDirectory = normalizeFsPath(directory)
    if (input?.managedPath === true && !pendingManagedDirectories.has(normalizedDirectory)) {
      throw new Error('托管服务器目录必须由软件创建')
    }
    const server = addServer({ ...input, path: directory })
    try {
      if (server.managedPath) {
        writeServerMarker(server.path, server.id)
        pendingManagedDirectories.delete(normalizedDirectory)
      }
    } catch (error) {
      removeServer(server.id)
      throw error
    }
    emit('servers:changed')
    return server
  })
  ipcMain.handle('servers:remove', (_event, id: string, options?: { deleteFiles?: boolean }) => {
    const server = getServer(id)
    if (!server) return
    const state = serverManager.getState()
    if (state.serverId === id && state.status !== 'stopped' && state.status !== 'error') {
      throw new Error('请先停止该服务器')
    }

    if (options?.deleteFiles === true) {
      if (!server.managedPath) throw new Error('该目录不是由软件创建，只能从列表移除')
      const safeDirectory = assertManagedServerDirectory(server.path, server.id)
      fs.rmSync(safeDirectory, { recursive: true, force: false })
    }
    removeServer(id)
    emit('servers:changed')
  })
  ipcMain.handle('servers:update', (_event, id: string, updates) => {
    const server = updateServer(id, updates || {})
    emit('servers:changed')
    return server
  })

  ipcMain.handle('serverFiles:readProperties', (_event, id: string) => {
    return fs.readFileSync(getServerFile(id, 'server.properties'), 'utf8')
  })
  ipcMain.handle('serverFiles:writeProperties', (_event, id: string, content: string) => {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new Error('服务器配置内容无效')
    fs.writeFileSync(getServerFile(id, 'server.properties'), content, 'utf8')
  })
  ipcMain.handle('serverFiles:readProfile', (_event, directory: string) => {
    return fs.readFileSync(path.join(assertApprovedDirectory(directory), SERVER_PROFILE_FILE), 'utf8')
  })
  ipcMain.handle('serverFiles:writeProfile', (_event, directory: string, content: string) => {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 64 * 1024) throw new Error('服务器资料内容无效')
    fs.writeFileSync(path.join(assertApprovedDirectory(directory), SERVER_PROFILE_FILE), content, 'utf8')
  })
  ipcMain.handle('serverFiles:createManagedDirectory', (_event, parentDirectory: string, serverName: string) => {
    const parent = assertApprovedDirectory(parentDirectory)
    const safeName = String(serverName || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, 80)
    if (!safeName) throw new Error('服务器名称无法用于创建目录')
    const directory = path.join(parent, safeName)
    if (fs.existsSync(directory)) throw new Error(`服务器目录已存在：${directory}`)
    fs.mkdirSync(directory)
    approveDirectory(directory)
    pendingManagedDirectories.add(normalizeFsPath(directory))
    return directory
  })
  ipcMain.handle('serverFiles:discardManagedDirectory', (_event, directory: string) => {
    const resolved = path.resolve(directory)
    const normalized = normalizeFsPath(resolved)
    if (!pendingManagedDirectories.has(normalized)) return
    pendingManagedDirectories.delete(normalized)
    fs.rmSync(resolved, { recursive: true, force: true })
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(windowOrThrow(), { properties: ['openDirectory'] })
    return result.canceled || !result.filePaths[0] ? null : approveDirectory(result.filePaths[0])
  })
  ipcMain.handle('dialog:selectJavaExecutable', async () => {
    const result = await dialog.showOpenDialog(windowOrThrow(), {
      properties: ['openFile'],
      filters: process.platform === 'win32'
        ? [
          { name: 'Java 可执行文件', extensions: ['exe'] },
          { name: '所有文件', extensions: ['*'] },
        ]
        : [{ name: '所有文件', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('server:detect', (_event, directory: string) => detectServer(assertApprovedDirectory(directory)))

  ipcMain.handle('frp:stop', () => frpManager.stop())
  ipcMain.handle('frp:status', () => frpManager.status)
  ipcMain.handle('frpConfigs:list', () => listFrpConfigs())
  ipcMain.handle('frpConfigs:pickFile', async () => {
    const result = await dialog.showOpenDialog(windowOrThrow(), {
      properties: ['openFile'],
      filters: [
        { name: 'FRP 配置', extensions: ['toml', 'ini', 'conf'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = path.resolve(result.filePaths[0])
    approvedFrpFiles.add(normalizeFsPath(filePath))
    return frpManager.importConfig(filePath)
  })
  ipcMain.handle('frpConfigs:add', (_event, name: string, filePath: string) => {
    const resolved = path.resolve(filePath)
    if (!approvedFrpFiles.has(normalizeFsPath(resolved))) throw new Error('请重新选择需要导入的 FRP 配置')
    const saved = saveFrpConfig(name, frpManager.importConfig(resolved))
    approvedFrpFiles.delete(normalizeFsPath(resolved))
    emit('frpConfigs:changed')
    return saved
  })
  ipcMain.handle('frpConfigs:remove', (_event, id: string) => {
    removeFrpConfig(id)
    emit('frpConfigs:changed')
  })
  ipcMain.handle('frpConfigs:start', async (_event, id: string) => {
    const config = getFrpConfig(id)
    if (!config) throw new Error('所选配置不存在')
    if (!fs.existsSync(config.filePath)) throw new Error('配置文件已不存在，请重新导入')
    await frpManager.startFromFile(config.filePath)
    markFrpConfigUsed(id)
    emit('frpConfigs:changed')
  })

  ipcMain.handle('java:detect', () => detectJava())
  ipcMain.handle('java:getSystemProfile', () => getJavaSystemProfile())
  ipcMain.handle('java:getPackages', () => getJava21Packages())
  ipcMain.handle('java:getOfficialPage', () => getJava21OfficialPage())
  ipcMain.handle('java:downloadPackage', async (_event, packageId: string) => {
    const result = await downloadJavaPackage(packageId, windowOrThrow())
    await openJavaDownload(result.filePath)
    return result
  })

  ipcMain.handle('app:getVersion', () => getProjectVersion())
  ipcMain.handle('app:checkForUpdates', () => checkForUpdates())
  ipcMain.handle('app:downloadAndInstallUpdate', () => downloadAndInstallUpdate(windowOrThrow()))
  ipcMain.handle('app:openExternal', (_event, url: string) => shell.openExternal(validateExternalUrl(url)))

  ipcMain.handle('remoteServers:list', () => remoteServerService.list())
  ipcMain.handle('remoteServers:fingerprint', (_event, input) => remoteServerService.getFingerprint(input))
  ipcMain.handle('remoteServers:add', (_event, input) => remoteServerService.add(input))
  ipcMain.handle('remoteServers:remove', (_event, id: string) => remoteServerService.remove(id))
  ipcMain.handle('remoteServers:getMetrics', (_event, id: string) => remoteServerService.getMetrics(id))
}

export async function shutdownServices(): Promise<void> {
  await Promise.allSettled([
    serverManager.shutdown(),
    frpManager.shutdown(),
  ])
}
