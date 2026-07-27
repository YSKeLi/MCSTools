import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { PersistentProcessController } from '../runtime/PersistentProcessController'
import { downloadFile } from '../utils/download'

export interface FrpConfig {
  serverAddr: string
  serverPort: number
  token: string
  localPort: number
  remotePort: number
  name?: string
}

export interface FrpConfigSummary {
  proxyName: string
  serverAddr: string
  serverPort: number
  localPort: number
  remotePort: number
  tokenConfigured: boolean
}

export interface ImportedFrpConfig {
  filePath: string
  fileName: string
  suggestedName: string
  summary: FrpConfigSummary
  warnings: string[]
}

const FRP_VERSION = '0.61.2'

const FRP_ARCHIVE_SHA256: Record<string, string> = {
  darwin_amd64: '77765c608c1e38122d2e0f39b73f093891b659b8cb52d09e3088d04fa6e3b73d',
  darwin_arm64: 'c70069876a72959daca6876a44255b65f0155b5ba54f918438a07b5db9d31cf2',
  linux_amd64: '4738edbd4bf88db5fe0ccee946d63da3b498c9cc50b0c7317d017fe7d28a05ea',
  linux_arm64: '6c80eb8549899e4a6f0d1c04cda58bfba47be949c308f6e55662f20b807296c2',
  windows_amd64: '5173739890fe7462eed6c9ca4e8ed2f98fca3604174bc596b0e955a4c58a50f2',
  windows_arm64: '6b1a374a95971911e0b7d962d3e6a879c45d6676e8b741f981c5759c892f0797',
}

export class FrpManager {
  private mainWindow: BrowserWindow | null = null
  private currentStatus = 'stopped'
  private readonly runtimeDirectory: string
  private readonly logPath: string
  private readonly controller: PersistentProcessController

  constructor() {
    this.runtimeDirectory = path.join(app.getPath('userData'), 'managed-processes', 'frp')
    this.logPath = path.join(this.runtimeDirectory, 'frp.log')
    this.controller = new PersistentProcessController({
      runtimeDirectory: this.runtimeDirectory,
      service: 'frp',
      onLog: line => this.emitLog(line, false),
      onState: state => this.emitStatus(state.status),
    })
    this.currentStatus = this.controller.getState()?.status || 'stopped'
  }

  setWindow(win: BrowserWindow) { this.mainWindow = win }

  get running() { return this.controller.isRunning() }
  get status() { return this.controller.getState()?.status || this.currentStatus }
  get logs() { return this.controller.getLogs(this.logPath) }

  private emitLog(line: string, persist = true) {
    if (persist) this.controller.appendLog(line, this.logPath)
    else this.mainWindow?.webContents.send('frp:log', line)
  }

  private emitStatus(s: string) {
    this.currentStatus = s
    this.mainWindow?.webContents.send('frp:status', s)
  }

  getFrpcDir() {
    const preferred = app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'runtime', 'frp')
      : path.join(app.getPath('userData'), 'runtime-dev', 'frp')
    if (this.isDirectoryWritable(preferred)) return preferred

    const fallback = path.join(app.getPath('userData'), 'runtime', 'frp')
    if (!this.isDirectoryWritable(fallback)) throw new Error('FRP 运行目录不可写')
    return fallback
  }

  private isDirectoryWritable(directory: string): boolean {
    const probe = path.join(directory, `.write-test-${process.pid}`)
    try {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(probe, 'ok', 'utf8')
      fs.rmSync(probe, { force: true })
      return true
    } catch {
      try { fs.rmSync(probe, { force: true }) } catch {}
      return false
    }
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
    const existingBinary = await this.validateBinaryUsable(frpcPath, { retries: 2, timeoutMs: 5000 })
    if (existingBinary.ok) return frpcPath

    if (fs.existsSync(frpcPath)) {
      const reason = existingBinary.error ? ` (${existingBinary.error.message})` : ''
      this.emitLog(`[FRP] 现有 frpc 文件无效，正在重新下载...${reason}`)
      this.tryRemovePath(frpcPath)
    }

    const suffix = this.getArchSuffix()
    const ext = process.platform === 'win32' ? '.zip' : '.tar.gz'
    const fileName = `frp_${FRP_VERSION}_${suffix}${ext}`
    const archivePath = path.join(this.getFrpcDir(), fileName)
    const extractDir = path.join(this.getFrpcDir(), `.extract-${FRP_VERSION}-${suffix}`)
    const downloadSources = this.getDownloadSources(fileName)

    this.emitLog(`[FRP] 正在下载 frpc ${FRP_VERSION} (${suffix})...`)

    let lastDownloadError: Error | null = null
    for (const source of downloadSources) {
      this.emitLog(`[FRP] 下载源: ${source.label}`)
      this.emitLog(`[FRP] ${source.url}`)
      try {
        await downloadFile(source.url, archivePath, win || this.mainWindow || undefined)
        lastDownloadError = null
        break
      } catch (error) {
        lastDownloadError = this.normalizeError(error)
        this.emitLog(`[FRP] ${source.label} 下载失败: ${lastDownloadError.message}`)
      }
    }

    if (lastDownloadError) throw lastDownloadError
    if (fs.statSync(archivePath).size <= 0) throw new Error('frpc 下载结果为空')

    try {
      this.emitLog('[FRP] 下载完成，正在校验...')
      this.verifyArchiveIntegrity(archivePath, suffix)

      this.emitLog('[FRP] 下载完成，正在解压...')
      this.tryRemovePath(extractDir, true)
      fs.mkdirSync(extractDir, { recursive: true })
      const args = process.platform === 'win32'
        ? ['-xf', archivePath, '-C', extractDir]
        : ['-xzf', archivePath, '-C', extractDir]
      execFileSync('tar', args, { windowsHide: true, stdio: 'ignore' })

      const executableName = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
      const extractedBinary = this.findExtractedBinary(extractDir, executableName)
      if (!extractedBinary) throw new Error('frpc 解压后未找到可执行文件')

      fs.copyFileSync(extractedBinary, frpcPath)
      if (process.platform !== 'win32') fs.chmodSync(frpcPath, 0o755)
      await this.assertBinaryUsable(frpcPath)
    } catch (error) {
      this.tryRemovePath(frpcPath)
      throw error
    } finally {
      this.tryRemovePath(extractDir, true)
      this.tryRemovePath(archivePath)
    }

    this.emitLog(`[FRP] frpc 已就绪: ${frpcPath}`)
    return frpcPath
  }

  private async assertBinaryUsable(filePath: string) {
    const result = await this.validateBinaryUsable(filePath)
    if (result.ok) return

    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`frpc 可执行文件验证失败${reason}`)
  }

  private async validateBinaryUsable(
    filePath: string,
    options: { retries?: number, retryDelayMs?: number, timeoutMs?: number } = {},
  ): Promise<{ ok: boolean, error?: Error }> {
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) return { ok: false }
    } catch (error) {
      return { ok: false, error: this.normalizeError(error) }
    }

    const retries = options.retries ?? (process.platform === 'win32' ? 4 : 1)
    const retryDelayMs = options.retryDelayMs ?? 1200
    const timeoutMs = options.timeoutMs ?? (process.platform === 'win32' ? 8000 : 5000)
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        execFileSync(filePath, ['-v'], { timeout: timeoutMs, windowsHide: true, stdio: 'ignore' })
        return { ok: true }
      } catch (error) {
        lastError = this.normalizeBinaryValidationError(error, filePath)
        if (attempt >= retries || !this.shouldRetryBinaryValidation(lastError)) break
        if (attempt === 1) {
          this.emitLog('[FRP] frpc 刚解压完成，可能仍在被 Windows 扫描，正在等待后重试...')
        }
        await this.delay(retryDelayMs * attempt)
      }
    }

    return { ok: false, error: lastError }
  }

  private shouldRetryBinaryValidation(error: Error): boolean {
    if (process.platform !== 'win32') return false
    return /ETIMEDOUT|EPERM|EACCES|UNKNOWN|busy|used by another process|resource busy|拒绝访问|不允许访问|超时/i.test(error.message)
  }

  private normalizeBinaryValidationError(error: unknown, filePath: string): Error {
    if (this.isWindowsFileBlocked(error, filePath)) {
      return new Error('Windows 拦截或占用了 frpc 可执行文件，常见原因是安全中心将隧道程序标记为风险项。请在 Windows 安全中心查看检测记录后重试，应用不会绕过系统安全策略。')
    }
    return this.normalizeError(error)
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error
    return new Error(String(error))
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private findExtractedBinary(dir: string, executableName: string): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) return entryPath
      if (entry.isDirectory()) {
        const nested = this.findExtractedBinary(entryPath, executableName)
        if (nested) return nested
      }
    }
    return null
  }

  private getDownloadSources(fileName: string) {
    const officialUrl = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${fileName}`
    return [
      { label: 'GitHub 加速镜像', url: `https://gh-proxy.com/${officialUrl}` },
      { label: 'GitHub 官方', url: officialUrl },
    ]
  }

  private verifyArchiveIntegrity(archivePath: string, suffix: string) {
    const expectedHash = FRP_ARCHIVE_SHA256[suffix]
    if (!expectedHash) throw new Error(`当前平台暂未配置 frpc 校验值: ${suffix}`)

    try {
      const actualHash = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error('frpc 安装包完整性校验失败')
      }
      this.emitLog('[FRP] 安装包 SHA-256 校验通过')
    } catch (error) {
      if (this.isWindowsFileBlocked(error, archivePath)) {
        throw new Error('Windows 拦截或占用了 frpc 安装包，常见原因是安全中心将隧道程序标记为风险项。请在 Windows 安全中心查看检测记录后重试，应用不会绕过系统安全策略。')
      }
      throw error
    }
  }

  private isWindowsFileBlocked(error: unknown, filePath: string): boolean {
    if (process.platform !== 'win32') return false
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
    const syscall = typeof error === 'object' && error && 'syscall' in error ? String((error as { syscall?: unknown }).syscall || '') : ''
    const errorPath = typeof error === 'object' && error && 'path' in error ? String((error as { path?: unknown }).path || '') : ''
    const message = error instanceof Error ? error.message : String(error)
    if (/virus|potentially unwanted software|病毒|不需要的软件/i.test(message)) return true
    return ['EPERM', 'EACCES', 'UNKNOWN'].includes(code)
      && ['open', 'read', 'spawn', 'spawnsync'].some((name) => syscall.toLowerCase().includes(name))
      && (errorPath === filePath || message.includes(filePath))
  }

  private tryRemovePath(targetPath: string, recursive = false) {
    try {
      fs.rmSync(targetPath, { recursive, force: true })
    } catch {}
  }

  generateConfig(config: FrpConfig): string {
    const name = config.name || 'minecraft-server'
    return `serverAddr = "${config.serverAddr}"
serverPort = ${config.serverPort || 7000}
${config.token ? `auth.method = "token"
auth.token = "${config.token}"
` : ''}

[[proxies]]
name = "${name}"
type = "tcp"
localIP = "127.0.0.1"
localPort = ${config.localPort}
remotePort = ${config.remotePort || config.localPort}
`
  }

  async start(config: FrpConfig) {
    if (this.running) return

    try {
      const frpcPath = await this.ensureBinary(this.mainWindow || undefined)
      const configPath = path.join(this.getFrpcDir(), 'managed.frpc.toml')
      fs.writeFileSync(configPath, this.generateConfig(config), 'utf-8')
      await this.spawnProcess(frpcPath, configPath, `启动 frpc -> ${config.serverAddr}:${config.serverPort}`)
    } catch (e: any) {
      this.emitLog(`[FRP] 错误: ${e.message}`)
      this.emitStatus('error')
      throw e
    }
  }

  async startFromFile(configFilePath: string, serviceId = configFilePath) {
    if (this.running) return

    try {
      if (!fs.existsSync(configFilePath)) throw new Error('导入的配置文件不存在')
      const frpcPath = await this.ensureBinary(this.mainWindow || undefined)
      await this.spawnProcess(frpcPath, configFilePath, `使用导入配置启动 -> ${configFilePath}`, serviceId)
    } catch (e: any) {
      this.emitLog(`[FRP] 错误: ${e.message}`)
      this.emitStatus('error')
      throw e
    }
  }

  importConfig(filePath: string): ImportedFrpConfig {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = this.parseConfigContent(content)
    return {
      filePath,
      fileName: path.basename(filePath),
      suggestedName: parsed.name || path.parse(filePath).name,
      summary: this.buildConfigSummary(parsed),
      warnings: this.collectImportWarnings(content),
    }
  }

  private async spawnProcess(frpcPath: string, configPath: string, message: string, serviceId = configPath) {
    await this.controller.start({
      service: 'frp',
      serviceId,
      executable: frpcPath,
      args: ['-c', configPath],
      cwd: path.dirname(configPath),
      logPath: this.logPath,
      stdoutPrefix: '[FRP] ',
      stderrPrefix: '[FRP] ',
      stopMode: 'signal',
      stopTimeoutMs: 5000,
      initialLogs: [
        '',
        `[FRP] ===== 新会话 ${new Date().toLocaleString('zh-CN', { hour12: false })} =====`,
        `[FRP] ${message}`,
        `[FRP] frpc 目录: ${this.getFrpcDir()}`,
      ],
    })
  }

  private parseConfigContent(content: string): FrpConfig {
    const globalValues = new Map<string, string>()
    const proxyValues = new Map<string, string>()
    let section = ''
    let inFirstProxy = false

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '').trim()
      if (!line) continue

      if (line.startsWith('[[') && line.endsWith(']]')) {
        inFirstProxy = line.slice(2, -2).trim() === 'proxies' && proxyValues.size === 0
        section = ''
        continue
      }

      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1).trim()
        inFirstProxy = false
        continue
      }

      const divider = line.indexOf('=')
      if (divider === -1) continue

      const key = line.slice(0, divider).trim()
      const value = this.parseTomlValue(line.slice(divider + 1).trim())

      if (inFirstProxy) {
        proxyValues.set(key, value)
        continue
      }

      if (section === 'auth') {
        globalValues.set(`auth.${key}`, value)
        continue
      }

      if (!section) {
        globalValues.set(key, value)
      }
    }

    return {
      name: proxyValues.get('name') || 'minecraft-server',
      serverAddr: globalValues.get('serverAddr') || '',
      serverPort: this.parseNumber(globalValues.get('serverPort'), 7000),
      token: globalValues.get('auth.token') || '',
      localPort: this.parseNumber(proxyValues.get('localPort'), 25565),
      remotePort: this.parseNumber(proxyValues.get('remotePort'), this.parseNumber(proxyValues.get('localPort'), 25565)),
    }
  }

  private collectImportWarnings(content: string): string[] {
    const warnings: string[] = []
    const parsed = this.parseConfigContent(content)

    if (!parsed.serverAddr) warnings.push('未识别到 serverAddr，将按原文件启动。')
    if (!parsed.name) warnings.push('未识别到代理名称，列表中将使用文件名或你填写的名称。')
    if (!/\[\[proxies\]\]/.test(content)) warnings.push('未检测到 [[proxies]] 段，界面只能展示部分字段。')
    return warnings
  }

  private buildConfigSummary(config: FrpConfig): FrpConfigSummary {
    return {
      proxyName: config.name || 'minecraft-server',
      serverAddr: config.serverAddr,
      serverPort: config.serverPort || 7000,
      localPort: config.localPort || 25565,
      remotePort: config.remotePort || config.localPort || 25565,
      tokenConfigured: Boolean(config.token),
    }
  }

  private parseTomlValue(raw: string): string {
    const value = raw.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }
    return value
  }

  private parseNumber(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  stop() {
    if (!this.running) return
    this.controller.stop(false)
  }

  async shutdown(): Promise<void> {
    this.controller.dispose()
  }
}
