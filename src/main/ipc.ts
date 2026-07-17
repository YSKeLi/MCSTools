import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import { downloadCore, getAllProviders, getVersions } from './core'
import { detectServer } from './detect'
import { FrpManager } from './frp/FrpManager'
import { detectJava } from './java'
import { ServerManager } from './server/ServerManager'
import { addServer, getServers, removeServer, updateServer } from './store'

const serverManager = new ServerManager()
const frpManager = new FrpManager()
let ipcRegistered = false

interface ReleaseAssetInfo {
  name: string
  url: string
  size?: number
}

interface LatestReleaseInfo {
  repo: string
  source: string
  version: string
  tag: string
  title: string
  publishedAt?: string | null
  url: string
  notes: string[]
  assets?: ReleaseAssetInfo[]
  assetsCount?: number
}

const UPDATE_INFO_URLS = [
  'https://raw.githubusercontent.com/aaatri/MCServerTools/master/public/latest.json',
  'https://cdn.jsdelivr.net/gh/aaatri/MCServerTools@master/public/latest.json',
]

function getProjectVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(app.getAppPath(), 'package.json'),
    path.join(app.getAppPath(), '..', 'package.json'),
  ]

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf-8')
      const match = content.match(/"version"\s*:\s*"([^"]+)"/)
      if (match?.[1]) return match[1]
    } catch {
      // continue
    }
  }

  return app.getVersion()
}

function compareVersions(currentVersion: string, latestVersion: string): number {
  const current = currentVersion.split('.').map(part => parseInt(part, 10) || 0)
  const latest = latestVersion.split('.').map(part => parseInt(part, 10) || 0)
  const length = Math.max(current.length, latest.length)

  for (let i = 0; i < length; i += 1) {
    const left = current[i] || 0
    const right = latest[i] || 0
    if (left !== right) return left - right
  }

  return 0
}

function requestJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: {
          'User-Agent': 'MCServerTools-Updater',
          Accept: 'application/json',
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}`))
          res.resume()
          return
        }

        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T)
          } catch (error: any) {
            reject(new Error(`Invalid JSON: ${error.message}`))
          }
        })
      },
    ).on('error', reject)
  })
}

async function checkForUpdates(): Promise<LatestReleaseInfo> {
  let lastError: Error | null = null

  for (const url of UPDATE_INFO_URLS) {
    try {
      return await requestJson<LatestReleaseInfo>(`${url}?t=${Date.now()}`)
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError || new Error('Unable to load latest.json')
}

function getPreferredUpdateAsset(latestInfo: LatestReleaseInfo): ReleaseAssetInfo | null {
  const assets = latestInfo.assets || []
  if (assets.length === 0) return null

  const platformKey = process.platform === 'win32'
    ? 'Windows'
    : process.platform === 'darwin'
      ? 'macOS'
      : 'Linux'

  const archKey = process.arch === 'arm64' ? 'arm64' : 'x64'
  const suffix = `${platformKey}-${archKey}`
  const preferredExtensions = process.platform === 'win32'
    ? ['.exe', '.zip']
    : process.platform === 'darwin'
      ? ['.dmg', '.zip']
      : ['.AppImage', '.zip']

  for (const extension of preferredExtensions) {
    const exact = assets.find(asset => asset.name === `MCServerTools-${suffix}${extension}`)
    if (exact) return exact
  }

  return assets.find(asset => asset.name.includes(suffix)) || assets[0] || null
}

function downloadUpdateAsset(url: string, destPath: string, mainWindow: BrowserWindow): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destPath)
    let loaded = 0
    let lastChecked = Date.now()
    let lastLoaded = 0

    protocol.get(url, { headers: { 'User-Agent': 'MCServerTools-Updater' } }, (res) => {
      const statusCode = res.statusCode || 0
      if (statusCode < 200 || statusCode >= 300) {
        file.close()
        fs.unlink(destPath, () => undefined)
        reject(new Error(`HTTP ${statusCode}`))
        res.resume()
        return
      }

      const total = parseInt(res.headers['content-length'] || '0', 10)

      res.on('data', (chunk: Buffer) => {
        file.write(chunk)
        loaded += chunk.length

        if (mainWindow && total > 0) {
          const now = Date.now()
          const elapsed = (now - lastChecked) / 1000
          const speed = elapsed > 0 ? Math.round((loaded - lastLoaded) / elapsed) : 0
          lastChecked = now
          lastLoaded = loaded

          mainWindow.webContents.send('update:downloadProgress', {
            percent: Math.round((loaded / total) * 100),
            loaded,
            total,
            speed,
            fileName: path.basename(destPath),
          })
        }
      })

      res.on('end', () => {
        file.end()
        resolve(destPath)
      })

      res.on('error', (error) => {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(error)
      })
    }).on('error', (error) => {
      file.close()
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      reject(error)
    })
  })
}

async function installUpdate(filePath: string): Promise<void> {
  const lowerFilePath = filePath.toLowerCase()

  if (process.platform === 'win32' && lowerFilePath.endsWith('.exe')) {
    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
    return
  }

  if (process.platform === 'linux' && lowerFilePath.endsWith('.appimage')) {
    fs.chmodSync(filePath, 0o755)
    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
    return
  }

  const openError = await shell.openPath(filePath)
  if (openError) {
    throw new Error(openError)
  }
}

async function downloadAndInstallUpdate(mainWindow: BrowserWindow): Promise<{ filePath: string; assetName: string }> {
  const latestInfo = await checkForUpdates()
  const currentVersion = getProjectVersion()
  if (compareVersions(currentVersion, latestInfo.version) >= 0) {
    throw new Error('当前已经是最新版本')
  }

  const asset = getPreferredUpdateAsset(latestInfo)
  if (!asset) {
    throw new Error('当前版本未提供适用于此系统的安装包')
  }

  const updateDir = path.join(app.getPath('temp'), 'MCServerTools-updates')
  fs.mkdirSync(updateDir, { recursive: true })

  const filePath = path.join(updateDir, asset.name)
  await downloadUpdateAsset(asset.url, filePath, mainWindow)
  await installUpdate(filePath)

  return { filePath, assetName: asset.name }
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  serverManager.setWindow(mainWindow)
  frpManager.setWindow(mainWindow)

  if (ipcRegistered) return
  ipcRegistered = true

  const emitServersChanged = () => {
    mainWindow.webContents.send('servers:changed')
  }

  ipcMain.handle('core:getCores', () => getAllProviders())
  ipcMain.handle('core:getVersions', (_e, coreId: string) => getVersions(coreId))
  ipcMain.handle('core:download', (_e, coreId: string, version: string, destDir: string) =>
    downloadCore(coreId, version, destDir, mainWindow),
  )

  ipcMain.handle('server:start', async (_e, serverDir: string, jarName: string, maxRam: number, javaPath?: string) => {
    serverManager.start({ serverDir, jarPath: path.join(serverDir, jarName), jarName, maxRam, javaPath })
  })
  ipcMain.handle('server:stop', () => serverManager.stop())
  ipcMain.handle('server:status', () => (serverManager.running ? 'running' : 'stopped'))
  ipcMain.handle('server:command', (_e, cmd: string) => serverManager.sendCommand(cmd))

  ipcMain.handle('servers:list', () => getServers())
  ipcMain.handle('servers:add', (_e, server) => { addServer(server); emitServersChanged() })
  ipcMain.handle('servers:remove', (_e, id: string, options?: { deleteFiles?: boolean }) => {
    const server = getServers().find(item => item.id === id)
    if (!server) return

    const shouldDeleteFiles = options?.deleteFiles === true
    const runningConfig = serverManager.getConfig()
    if (shouldDeleteFiles && serverManager.running && runningConfig?.serverDir === server.path) {
      throw new Error('请先停止该服务器，再删除文件')
    }

    removeServer(id)

    if (shouldDeleteFiles && fs.existsSync(server.path)) {
      fs.rmSync(server.path, { recursive: true, force: true })
    }

    emitServersChanged()
  })
  ipcMain.handle('servers:update', (_e, id: string, updates) => { updateServer(id, updates); emitServersChanged() })

  ipcMain.handle('frp:start', async (_e, config) => { await frpManager.start(config) })
  ipcMain.handle('frp:stop', () => { frpManager.stop() })
  ipcMain.handle('frp:status', () => (frpManager.running ? 'running' : 'stopped'))

  ipcMain.handle('file:read', async (_e, filePath: string) => fs.readFileSync(filePath, 'utf-8'))
  ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8')
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('java:detect', () => detectJava())
  ipcMain.handle('server:detect', (_e, dir: string) => detectServer(dir))
  ipcMain.handle('app:getVersion', () => getProjectVersion())
  ipcMain.handle('app:checkForUpdates', () => checkForUpdates())
  ipcMain.handle('app:downloadAndInstallUpdate', () => downloadAndInstallUpdate(mainWindow))
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
}
