import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { resolveJava } from '../java'
import {
  managedLogFileName,
  PersistentProcessController,
  readRecentLogLines,
} from '../runtime/PersistentProcessController'
import type { ManagedProcessState } from '../runtime/types'
import { getServer } from '../store'
import { hasLiveRemoteMinecraftMarker, isExternalMinecraftProcess, readLiveRemoteMinecraftPid } from './externalMinecraftProcess'
import { requiredJavaMajor } from './javaPolicy'
import {
  type MinecraftControlDescriptor,
  createManagedControlRecord,
  readLocalMinecraftControl,
  removeLocalMinecraftControl,
  writeLocalMinecraftControl,
} from './minecraftControlProtocol'
import { parsePlayerConnectionEvent } from './playerTracking'

interface ServerConfig {
  serverId: string
  serverDir: string
  jarPath: string
  jarName: string
  version: string
  maxRam: number
  javaPath?: string
  extraArgs?: string[]
}

export type ServerProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'external'

export interface ServerRuntimeState {
  serverId: string | null
  status: ServerProcessStatus
}

export interface ServerPlayerSnapshot {
  serverId: string | null
  players: string[]
}

function writeNamedPipe(pipeName: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(`\\\\.\\pipe\\${pipeName}`)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('连接服务器控制通道超时'))
    }, 5000)
    socket.once('connect', () => socket.end(value))
    socket.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    socket.once('close', hadError => {
      clearTimeout(timer)
      if (!hadError) resolve()
    })
  })
}

function writeFifo(inputPath: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(inputPath, { flags: 'a' })
    const timer = setTimeout(() => {
      stream.destroy()
      reject(new Error('连接服务器控制通道超时'))
    }, 5000)
    stream.once('open', () => stream.end(`${value}\n`))
    stream.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    stream.once('finish', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function sendControlCommand(
  descriptor: MinecraftControlDescriptor,
  type: 'stdin' | 'stop' | 'kill',
  value?: string,
): Promise<void> {
  if (descriptor.transport === 'command-file') {
    fs.appendFileSync(descriptor.commandPath!, createManagedControlRecord(descriptor, type, value), 'utf8')
    return
  }
  if (type === 'kill') throw new Error('该控制通道不支持强制停止命令')
  const command = type === 'stop' ? 'stop' : value || ''
  if (descriptor.transport === 'fifo') await writeFifo(descriptor.inputPath!, command)
  else await writeNamedPipe(descriptor.pipeName!, command)
}

export class ServerManager {
  private mainWindow: BrowserWindow | null = null
  private readonly runtimeDirectory: string
  private readonly controller: PersistentProcessController
  private onlinePlayers = new Map<string, string>()

  constructor() {
    this.runtimeDirectory = path.join(app.getPath('userData'), 'managed-processes', 'server')
    this.controller = new PersistentProcessController({
      runtimeDirectory: this.runtimeDirectory,
      service: 'server',
      onLog: line => this.handleLog(line),
      onState: state => this.handleState(state),
    })
    this.restorePlayers()
    const restoredState = this.controller.getState()
    if (restoredState) this.publishManagedControl(restoredState)
  }

  setWindow(win: BrowserWindow) { this.mainWindow = win }
  get running() { return this.controller.isRunning() }

  getState(): ServerRuntimeState {
    const state = this.controller.getState()
    return {
      serverId: state?.serviceId || null,
      status: state?.status || 'stopped',
    }
  }

  async getStateForServer(serverId: string): Promise<ServerRuntimeState> {
    const state = this.controller.getState()
    if (state?.serviceId === serverId && (state.status === 'starting' || this.controller.isRunning())) {
      return { serverId, status: state.status }
    }

    const server = getServer(serverId)
    if (server && await isExternalMinecraftProcess(server.path, server.jarName)) {
      return { serverId, status: 'external' }
    }

    return {
      serverId,
      status: state?.serviceId === serverId && state.status === 'error' ? 'error' : 'stopped',
    }
  }

  getLogs(serverId: string): string[] {
    const managedLogPath = this.getLogPath(serverId)
    const state = this.controller.getState()
    if (state?.serviceId === serverId && this.controller.isRunning()) {
      return this.controller.getLogs(managedLogPath)
    }

    const server = getServer(serverId)
    if (!server) return this.controller.getLogs(managedLogPath)
    const remoteManagedLogPath = path.join(server.path, '.mcstools', 'server.log')
    const sharedControl = readLocalMinecraftControl(server.path)
    const sharedLogPath = sharedControl?.logPath || remoteManagedLogPath
    if (hasLiveRemoteMinecraftMarker(server.path) && fs.existsSync(sharedLogPath)) {
      return readRecentLogLines(sharedLogPath)
    }

    const candidates = [managedLogPath, remoteManagedLogPath, path.join(server.path, 'logs', 'latest.log')]
      .map(filePath => {
        try {
          return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs }
        } catch {
          return null
        }
      })
      .filter((candidate): candidate is { filePath: string; modifiedAt: number } => candidate !== null)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
    return candidates[0] ? readRecentLogLines(candidates[0].filePath) : []
  }

  getPlayerSnapshot(): ServerPlayerSnapshot {
    const state = this.controller.getState()
    return {
      serverId: state?.serviceId || null,
      players: state?.players || [...this.onlinePlayers.values()],
    }
  }

  async start(config: ServerConfig): Promise<void> {
    const currentState = this.controller.getState()
    if (this.controller.isRunning()) {
      if (currentState?.serviceId === config.serverId) return
      throw new Error('已有其他服务器正在运行，请先停止后再启动')
    }
    if (await isExternalMinecraftProcess(config.serverDir, config.jarName)) {
      throw new Error('检测到该目录的 Minecraft 服务器已由外部进程启动')
    }
    if (!fs.existsSync(config.jarPath) || !fs.statSync(config.jarPath).isFile()) {
      throw new Error(`找不到服务端 JAR: ${config.jarPath}`)
    }

    const minimumJava = requiredJavaMajor(config.version)
    const javaInfo = resolveJava(config.javaPath, minimumJava)
    if (!javaInfo) throw new Error(`当前服务器需要 Java ${minimumJava} 或更高版本，请在 Java 管理中安装或重新选择`)

    const initialLogs = [
      '',
      `[MST] ===== 新会话 ${new Date().toLocaleString('zh-CN', { hour12: false })} =====`,
      ...this.ensureEulaAccepted(config.serverDir),
    ]
    const args = [
      `-Xmx${config.maxRam}M`,
      '-jar',
      config.jarPath,
      'nogui',
      ...(config.extraArgs || []),
    ]
    initialLogs.push(`[MST] 使用 Java: ${javaInfo.path} (${javaInfo.version})`)
    initialLogs.push(`[MST] 启动命令: ${javaInfo.path} ${args.join(' ')}`)

    this.resetPlayers(config.serverId)
    const state = await this.controller.start({
      service: 'server',
      serviceId: config.serverId,
      executable: javaInfo.path,
      args,
      cwd: config.serverDir,
      logPath: this.getLogPath(config.serverId),
      stdoutPrefix: '',
      stderrPrefix: '[ERR] ',
      stopMode: 'stdin',
      stopTimeoutMs: 10000,
      initialLogs,
    })
    this.publishManagedControl(state)
  }

  async stop(serverId: string): Promise<void> {
    if (this.isManagedServerActive(serverId)) {
      this.controller.stop(false)
      return
    }
    await sendControlCommand(this.getExternalControl(serverId), 'stop')
  }

  async forceStop(serverId: string): Promise<void> {
    if (this.isManagedServerActive(serverId)) {
      this.controller.stop(true)
      return
    }
    const server = getServer(serverId)
    if (!server) throw new Error('服务器不存在')
    const descriptor = this.getExternalControl(serverId)
    if (descriptor.transport === 'command-file') {
      await sendControlCommand(descriptor, 'kill')
      return
    }
    const pid = readLiveRemoteMinecraftPid(server.path)
    if (!pid) throw new Error('服务器进程已经停止')
    try {
      if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL')
      else process.kill(pid, 'SIGKILL')
    } catch {
      process.kill(pid, 'SIGKILL')
    }
  }

  async sendCommand(serverId: string, command: string): Promise<void> {
    const value = typeof command === 'string' ? command.trim() : ''
    if (!value || /[\r\n]/.test(value) || value.length > 4096) throw new Error('服务器命令无效')
    if (this.isManagedServerActive(serverId)) {
      this.controller.sendStdin(value)
      return
    }
    await sendControlCommand(this.getExternalControl(serverId), 'stdin', value)
  }

  async shutdown(): Promise<void> {
    this.controller.dispose()
  }

  private getLogPath(serverId: string): string {
    return path.join(this.runtimeDirectory, 'logs', managedLogFileName(serverId))
  }

  private ensureEulaAccepted(serverDir: string): string[] {
    const messages: string[] = []
    const eulaPath = path.join(serverDir, 'eula.txt')
    const eulaContent = [
      '# Generated by Minecraft Server Tools',
      '# By changing the setting below to TRUE you are indicating your agreement to the EULA.',
      '# https://aka.ms/MinecraftEULA',
      'eula=true',
      '',
    ].join('\n')

    fs.mkdirSync(serverDir, { recursive: true })
    try {
      if (!fs.existsSync(eulaPath) || !/^\s*eula\s*=\s*true\s*$/im.test(fs.readFileSync(eulaPath, 'utf8'))) {
        fs.writeFileSync(eulaPath, eulaContent, 'utf8')
        messages.push('[MST] 已自动写入 eula.txt 并同意 EULA')
      }
    } catch (error) {
      messages.push(`[MST] 写入 eula.txt 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    return messages
  }

  private isManagedServerActive(serverId: string): boolean {
    const state = this.controller.getState()
    return Boolean(state?.serviceId === serverId && this.controller.isRunning())
  }

  private getExternalControl(serverId: string): MinecraftControlDescriptor {
    const server = getServer(serverId)
    if (!server) throw new Error('服务器不存在')
    if (!hasLiveRemoteMinecraftMarker(server.path)) throw new Error('所选服务器当前没有运行')
    const descriptor = readLocalMinecraftControl(server.path)
    if (!descriptor) throw new Error('该服务器没有可用的控制通道，请通过本工具重新启动后再操作')
    return descriptor
  }

  private publishManagedControl(state: ManagedProcessState) {
    if (state.status !== 'running' || !state.childPid) return
    const server = getServer(state.serviceId)
    if (!server) return
    try {
      writeLocalMinecraftControl(server.path, {
        version: 1,
        transport: 'command-file',
        logPath: state.logPath,
        commandPath: state.commandPath,
        sessionId: state.sessionId,
      }, state.childPid)
    } catch (error) {
      console.warn('无法发布 Minecraft 跨入口控制信息:', error)
    }
  }

  private handleLog(line: string) {
    const serverId = this.controller?.getState()?.serviceId || null
    this.trackPlayerConnection(line, serverId)
    this.mainWindow?.webContents.send('server:log', { serverId, line })
  }

  private handleState(state: ManagedProcessState) {
    if (state.status === 'stopped' || state.status === 'error') {
      const server = getServer(state.serviceId)
      const processStillAlive = server ? hasLiveRemoteMinecraftMarker(server.path) : false
      if (server && !processStillAlive) removeLocalMinecraftControl(server.path, state.sessionId)
      this.resetPlayers(state.serviceId)
    } else if (state.players) {
      this.publishManagedControl(state)
      this.onlinePlayers = new Map(state.players.map(player => [player.toLowerCase(), player]))
      this.emitPlayers(state.serviceId)
    }
    this.mainWindow?.webContents.send('server:status', {
      serverId: state.serviceId,
      status: state.status,
    } satisfies ServerRuntimeState)
  }

  private emitPlayers(serverId: string | null) {
    this.mainWindow?.webContents.send('server:players', {
      serverId,
      players: [...this.onlinePlayers.values()],
    } satisfies ServerPlayerSnapshot)
  }

  private resetPlayers(serverId: string | null) {
    this.onlinePlayers.clear()
    this.emitPlayers(serverId)
  }

  private trackPlayerConnection(line: string, serverId: string | null, emit = true) {
    if (!serverId) return
    const event = parsePlayerConnectionEvent(line)
    if (!event) return

    const key = event.playerName.toLowerCase()
    if (event.action === 'join') {
      if (this.onlinePlayers.get(key) === event.playerName) return
      this.onlinePlayers.set(key, event.playerName)
      if (emit) this.emitPlayers(serverId)
      return
    }

    if (this.onlinePlayers.delete(key) && emit) this.emitPlayers(serverId)
  }

  private restorePlayers() {
    const state = this.controller.getState()
    if (!state || state.status !== 'running') return
    this.onlinePlayers.clear()
    if (state.players) {
      state.players.forEach(player => this.onlinePlayers.set(player.toLowerCase(), player))
      return
    }
    this.getLogs(state.serviceId).forEach(line => this.trackPlayerConnection(line, state.serviceId, false))
  }
}
