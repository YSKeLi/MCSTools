import { ChildProcess, spawn } from 'child_process'
import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { downloadFile } from '../utils/download'

export interface FrpConfig {
  serverAddr: string
  serverPort: number
  token: string
  localPort: number
  remotePort: number
  name?: string
}

export class FrpManager {
  private process: ChildProcess | null = null
  private mainWindow: BrowserWindow | null = null

  setWindow(win: BrowserWindow) { this.mainWindow = win }

  get running() { return this.process !== null && !this.process.killed }

  private emitLog(line: string) { this.mainWindow?.webContents.send('frp:log', line) }
  private emitStatus(s: string) { this.mainWindow?.webContents.send('frp:status', s) }

  getFrpcDir() {
    const dir = path.join(app.getPath('userData'), 'frp')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  getFrpcPath(): string {
    const platform = process.platform
    const ext = platform === 'win32' ? '.exe' : ''
    return path.join(this.getFrpcDir(), `frpc${ext}`)
  }

  getArchSuffix(): string {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
    return `${platform}_${arch}`
  }

  async ensureBinary(win?: BrowserWindow): Promise<string> {
    const frpcPath = this.getFrpcPath()
    if (fs.existsSync(frpcPath)) return frpcPath

    const version = '0.61.2'
    const suffix = this.getArchSuffix()
    const ext = process.platform === 'win32' ? '.zip' : '.tar.gz'
    const fileName = `frp_${version}_${suffix}${ext}`
    const downloadUrl = `https://github.com/fatedier/frp/releases/download/v${version}/${fileName}`
    const archivePath = path.join(this.getFrpcDir(), fileName)

    this.emitLog(`[FRP] 正在下载 frpc ${version} (${suffix})...`)
    this.emitLog(`[FRP] ${downloadUrl}`)

    await downloadFile(downloadUrl, archivePath, win || this.mainWindow || undefined)

    this.emitLog(`[FRP] 下载完成，正在解压...`)
    if (process.platform === 'win32') {
      await this.unzip(archivePath, this.getFrpcDir())
      const innerExe = path.join(this.getFrpcDir(), `frp_${version}_${suffix}`, 'frpc.exe')
      if (fs.existsSync(innerExe)) fs.renameSync(innerExe, frpcPath)
    } else {
      const { execSync } = require('child_process')
      execSync(`tar -xzf "${archivePath}" -C "${this.getFrpcDir()}"`)
      const innerBin = path.join(this.getFrpcDir(), `frp_${version}_${suffix}`, 'frpc')
      if (fs.existsSync(innerBin)) {
        fs.renameSync(innerBin, frpcPath)
        fs.chmodSync(frpcPath, 0o755)
      }
    }

    this.cleanupExtracted(version, suffix)
    if (!fs.existsSync(frpcPath)) throw new Error('frpc 解压后未找到可执行文件')
    this.emitLog(`[FRP] frpc 已就绪: ${frpcPath}`)
    return frpcPath
  }

  private async unzip(zipPath: string, destDir: string) {
    const { execSync } = require('child_process')
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { shell: true })
  }

  private cleanupExtracted(version: string, suffix: string) {
    const dir = path.join(this.getFrpcDir(), `frp_${version}_${suffix}`)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }

  generateConfig(config: FrpConfig): string {
    const name = config.name || 'minecraft-server'
    return `serverAddr = "${config.serverAddr}"
serverPort = ${config.serverPort || 7000}

[[proxies]]
name = "${name}"
type = "tcp"
localIP = "127.0.0.1"
localPort = ${config.localPort}
remotePort = ${config.remotePort || config.localPort}

${config.token ? `auth.token = "${config.token}"` : ''}
`
  }

  async start(config: FrpConfig) {
    if (this.running) return

    try {
      const frpcPath = await this.ensureBinary(this.mainWindow || undefined)
      const configPath = path.join(this.getFrpcDir(), 'frpc.toml')
      fs.writeFileSync(configPath, this.generateConfig(config), 'utf-8')

      this.emitStatus('starting')
      this.emitLog(`[FRP] 启动 frpc -> ${config.serverAddr}:${config.serverPort}`)

      this.process = spawn(frpcPath, ['-c', configPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.process.stdout?.on('data', (data: Buffer) => {
        data.toString().split('\n').filter(Boolean).forEach(l => this.emitLog(`[FRP] ${l}`))
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        data.toString().split('\n').filter(Boolean).forEach(l => this.emitLog(`[FRP] ${l}`))
      })

      this.process.on('close', (code) => {
        this.emitLog(`[FRP] 进程退出 (code: ${code})`)
        this.emitStatus('stopped')
        this.process = null
      })

      this.process.on('error', (err) => {
        this.emitLog(`[FRP] 启动失败: ${err.message}`)
        this.emitStatus('error')
        this.process = null
      })

      this.emitStatus('running')
    } catch (e: any) {
      this.emitLog(`[FRP] 错误: ${e.message}`)
      this.emitStatus('error')
    }
  }

  stop() {
    if (!this.running || !this.process) return
    this.emitLog('[FRP] 正在停止...')
    this.process.kill('SIGTERM')
    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL')
        this.emitLog('[FRP] 强制终止')
      }
    }, 5000)
  }
}
