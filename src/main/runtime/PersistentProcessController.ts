import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import type {
  ManagedCommand,
  ManagedProcessSpec,
  ManagedProcessState,
  ManagedProcessStatus,
  ManagedService,
} from './types'

const ACTIVE_STATUSES = new Set<ManagedProcessStatus>(['starting', 'running', 'stopping'])
const VALID_STATUSES = new Set<ManagedProcessStatus>(['starting', 'running', 'stopping', 'stopped', 'error'])

function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function readState(filePath: string, service: ManagedService): ManagedProcessState | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ManagedProcessState>
    if (
      value.version !== 1
      || value.service !== service
      || typeof value.serviceId !== 'string'
      || typeof value.sessionId !== 'string'
      || typeof value.runnerPid !== 'number'
      || !VALID_STATUSES.has(value.status as ManagedProcessStatus)
      || typeof value.logPath !== 'string'
      || typeof value.commandPath !== 'string'
    ) return null
    return value as ManagedProcessState
  } catch {
    return null
  }
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

export function managedLogFileName(serviceId: string): string {
  const safe = serviceId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return `${safe || 'default'}.log`
}

export function readRecentLogLines(logPath: string, limit = 500): string[] {
  try {
    const stat = fs.statSync(logPath)
    const maxBytes = 1024 * 1024
    const start = Math.max(0, stat.size - maxBytes)
    const size = stat.size - start
    if (size <= 0) return []
    const handle = fs.openSync(logPath, 'r')
    try {
      const buffer = Buffer.alloc(size)
      fs.readSync(handle, buffer, 0, size, start)
      const lines = buffer.toString('utf8').split(/\r?\n/)
      if (start > 0) lines.shift()
      return lines.filter(Boolean).slice(-limit)
    } finally {
      fs.closeSync(handle)
    }
  } catch {
    return []
  }
}

interface ControllerOptions {
  runtimeDirectory: string
  service: ManagedService
  onLog: (line: string) => void
  onState: (state: ManagedProcessState) => void
}

export class PersistentProcessController {
  private readonly runtimeDirectory: string
  private readonly service: ManagedService
  private readonly statePath: string
  private readonly onLog: (line: string) => void
  private readonly onState: (state: ManagedProcessState) => void
  private state: ManagedProcessState | null
  private monitor: NodeJS.Timeout
  private logPath = ''
  private logOffset = 0
  private pendingLogText = ''
  private logDecoder = new StringDecoder('utf8')
  private lastStateSignature = ''

  constructor(options: ControllerOptions) {
    this.runtimeDirectory = options.runtimeDirectory
    this.service = options.service
    this.statePath = path.join(this.runtimeDirectory, 'state.json')
    this.onLog = options.onLog
    this.onState = options.onState
    fs.mkdirSync(this.runtimeDirectory, { recursive: true })
    this.state = readState(this.statePath, this.service)
    this.repairStaleState()
    this.logPath = this.state?.logPath || ''
    this.logOffset = this.logPath ? fileSize(this.logPath) : 0
    this.lastStateSignature = this.state ? JSON.stringify(this.state) : ''
    this.monitor = setInterval(() => this.poll(), 250)
    this.monitor.unref()
  }

  getState(): ManagedProcessState | null {
    this.pollState()
    return this.state
  }

  isRunning(): boolean {
    return Boolean(this.state && ACTIVE_STATUSES.has(this.state.status) && isProcessAlive(this.state.runnerPid))
  }

  getLogs(logPath: string, limit = 500): string[] {
    return readRecentLogLines(logPath, limit)
  }

  appendLog(line: string, logPath: string) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `${line}\n`, 'utf8')
    if (this.logPath === logPath) this.logOffset = fileSize(logPath)
    this.onLog(line)
  }

  async start(spec: ManagedProcessSpec): Promise<ManagedProcessState> {
    this.pollState()
    if (this.state && ACTIVE_STATUSES.has(this.state.status) && isProcessAlive(this.state.runnerPid)) {
      throw new Error('已有托管进程正在运行')
    }
    if (this.state?.childPid && isProcessAlive(this.state.childPid)) {
      throw new Error('检测到上次运行的子进程仍存在，但托管连接已丢失；请先在系统中结束该进程')
    }

    const sessionId = randomUUID()
    const commandPath = path.join(this.runtimeDirectory, `commands-${sessionId}.ndjson`)
    const configPath = path.join(this.runtimeDirectory, `runner-${sessionId}.json`)
    fs.mkdirSync(path.dirname(spec.logPath), { recursive: true })
    fs.writeFileSync(commandPath, '', 'utf8')

    this.logPath = spec.logPath
    this.logOffset = fileSize(spec.logPath)
    this.pendingLogText = ''
    this.logDecoder = new StringDecoder('utf8')

    const now = new Date().toISOString()
    const startingState: ManagedProcessState = {
      version: 1,
      service: this.service,
      serviceId: spec.serviceId,
      sessionId,
      runnerPid: 0,
      childPid: null,
      status: 'starting',
      logPath: spec.logPath,
      commandPath,
      startedAt: now,
      updatedAt: now,
    }
    this.state = startingState
    this.emitState(startingState)
    writeJsonAtomic(this.statePath, startingState)
    writeJsonAtomic(configPath, {
      ...spec,
      sessionId,
      statePath: this.statePath,
      commandPath,
    })

    const runnerPath = path.join(__dirname, 'ProcessRunner.js')
    const environment = { ...process.env }
    if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = '1'

    const runner = spawn(process.execPath, [runnerPath, configPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: environment,
    })

    await new Promise<void>((resolve, reject) => {
      runner.once('spawn', resolve)
      runner.once('error', reject)
    })
    runner.unref()

    return this.waitForStarted(sessionId)
  }

  sendStdin(value: string) {
    this.sendCommand({ type: 'stdin', value })
  }

  stop(force = false) {
    this.sendCommand({ type: force ? 'kill' : 'stop' })
  }

  dispose() {
    clearInterval(this.monitor)
  }

  private sendCommand(command: Pick<ManagedCommand, 'type' | 'value'>) {
    this.pollState()
    if (!this.state || !ACTIVE_STATUSES.has(this.state.status) || !isProcessAlive(this.state.runnerPid)) {
      throw new Error('托管进程当前未运行')
    }
    const record: ManagedCommand = {
      id: randomUUID(),
      sessionId: this.state.sessionId,
      ...command,
    }
    fs.appendFileSync(this.state.commandPath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  private waitForStarted(sessionId: string): Promise<ManagedProcessState> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        this.poll()
        if (!this.state || this.state.sessionId !== sessionId) return
        if (this.state.status === 'running') {
          clearInterval(timer)
          resolve(this.state)
          return
        }
        if (this.state.status === 'error' || this.state.status === 'stopped') {
          clearInterval(timer)
          reject(new Error(this.state.error || '托管进程启动失败'))
          return
        }
        if (Date.now() - startedAt > 15000) {
          clearInterval(timer)
          reject(new Error('托管进程启动超时'))
        }
      }, 50)
    })
  }

  private poll() {
    this.pollState()
    this.pollLogs()
  }

  private pollState() {
    const next = readState(this.statePath, this.service)
    if (!next) return
    this.state = next
    if (ACTIVE_STATUSES.has(next.status) && next.runnerPid > 0 && !isProcessAlive(next.runnerPid)) {
      this.repairStaleState()
    }
    if (this.logPath !== next.logPath) {
      this.logPath = next.logPath
      this.logOffset = fileSize(next.logPath)
      this.pendingLogText = ''
      this.logDecoder = new StringDecoder('utf8')
    }
    const signature = JSON.stringify(this.state)
    if (signature !== this.lastStateSignature) {
      this.lastStateSignature = signature
      this.onState(this.state)
    }
  }

  private pollLogs() {
    if (!this.logPath) return
    let size: number
    try {
      size = fs.statSync(this.logPath).size
    } catch {
      return
    }
    if (size < this.logOffset) {
      this.logOffset = 0
      this.pendingLogText = ''
      this.logDecoder = new StringDecoder('utf8')
    }
    if (size === this.logOffset) return

    const length = size - this.logOffset
    const handle = fs.openSync(this.logPath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      fs.readSync(handle, buffer, 0, length, this.logOffset)
      this.logOffset = size
      const lines = `${this.pendingLogText}${this.logDecoder.write(buffer)}`.split(/\r?\n/)
      this.pendingLogText = lines.pop() || ''
      lines.filter(Boolean).forEach(this.onLog)
    } finally {
      fs.closeSync(handle)
    }
  }

  private emitState(state: ManagedProcessState) {
    this.lastStateSignature = JSON.stringify(state)
    this.onState(state)
  }

  private repairStaleState() {
    if (!this.state || !ACTIVE_STATUSES.has(this.state.status) || isProcessAlive(this.state.runnerPid)) return
    const wasOrphaned = isProcessAlive(this.state.childPid)
    this.state = {
      ...this.state,
      status: 'error',
      updatedAt: new Date().toISOString(),
      error: wasOrphaned ? '托管运行器已断开，但子进程可能仍在运行' : '上次运行未正常结束',
    }
    writeJsonAtomic(this.statePath, this.state)
  }
}
