import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import { parsePlayerConnectionEvent } from '../server/playerTracking'
import type { ManagedCommand, ManagedProcessState, ManagedRunnerConfig } from './types'

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function readConfig(): ManagedRunnerConfig {
  const configPath = process.argv[2]
  if (!configPath) throw new Error('缺少托管运行器配置')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ManagedRunnerConfig
  if (!config.sessionId || !config.executable || !config.statePath || !config.commandPath || !config.logPath) {
    throw new Error('托管运行器配置无效')
  }
  try { fs.rmSync(configPath, { force: true }) } catch {}
  return config
}

const config = readConfig()
fs.mkdirSync(path.dirname(config.logPath), { recursive: true })

function appendLog(line: string) {
  fs.appendFileSync(config.logPath, `${line.replace(/[\r\n]+$/g, '')}\n`, 'utf8')
}

const now = new Date().toISOString()
let state: ManagedProcessState = {
  version: 1,
  service: config.service,
  serviceId: config.serviceId,
  sessionId: config.sessionId,
  runnerPid: process.pid,
  childPid: null,
  childExecutable: config.executable,
  status: 'starting',
  logPath: config.logPath,
  commandPath: config.commandPath,
  startedAt: now,
  updatedAt: now,
  players: config.service === 'server' ? [] : undefined,
}

function updateState(updates: Partial<ManagedProcessState>) {
  state = { ...state, ...updates, updatedAt: new Date().toISOString() }
  writeJsonAtomic(config.statePath, state)
}

writeJsonAtomic(config.statePath, state)
config.initialLogs.forEach(appendLog)

const child = spawn(config.executable, config.args, {
  cwd: config.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

let commandOffset = 0
let pendingCommandText = ''
let stdoutText = ''
let stderrText = ''
let forceStopTimer: NodeJS.Timeout | null = null
let closing = false
const stdoutDecoder = new StringDecoder('utf8')
const stderrDecoder = new StringDecoder('utf8')
const onlinePlayers = new Map<string, string>()

function trackPlayer(line: string) {
  if (config.service !== 'server') return
  const event = parsePlayerConnectionEvent(line)
  if (!event) return
  const key = event.playerName.toLowerCase()
  if (event.action === 'join') onlinePlayers.set(key, event.playerName)
  else onlinePlayers.delete(key)
  updateState({ players: [...onlinePlayers.values()] })
}

function consumeOutput(data: Buffer, prefix: string, stream: 'stdout' | 'stderr') {
  const previous = stream === 'stdout' ? stdoutText : stderrText
  const decoder = stream === 'stdout' ? stdoutDecoder : stderrDecoder
  const lines = `${previous}${decoder.write(data)}`.split(/\r?\n/)
  const pending = lines.pop() || ''
  if (stream === 'stdout') stdoutText = pending
  else stderrText = pending
  lines.filter(Boolean).forEach(line => {
    trackPlayer(line)
    appendLog(`${prefix}${line}`)
  })
}

function flushOutput() {
  const finalStdout = `${stdoutText}${stdoutDecoder.end()}`
  const finalStderr = `${stderrText}${stderrDecoder.end()}`
  if (finalStdout) {
    trackPlayer(finalStdout)
    appendLog(`${config.stdoutPrefix}${finalStdout}`)
  }
  if (finalStderr) {
    trackPlayer(finalStderr)
    appendLog(`${config.stderrPrefix}${finalStderr}`)
  }
  stdoutText = ''
  stderrText = ''
}

child.stdout?.on('data', (data: Buffer) => consumeOutput(data, config.stdoutPrefix, 'stdout'))
child.stderr?.on('data', (data: Buffer) => consumeOutput(data, config.stderrPrefix, 'stderr'))

child.once('spawn', () => {
  updateState({ childPid: child.pid || null, status: 'running' })
})

child.on('error', error => {
  appendLog(config.service === 'server' ? `[MST] 进程错误: ${error.message}` : `[FRP] 进程错误: ${error.message}`)
  updateState({ status: 'error', error: error.message })
})

child.on('close', code => {
  if (closing) return
  closing = true
  if (forceStopTimer) clearTimeout(forceStopTimer)
  flushOutput()
  appendLog(config.service === 'server'
    ? `[MST] 服务端进程已退出 (code: ${code})`
    : `[FRP] 进程退出 (code: ${code})`)
  updateState({ childPid: null, status: 'stopped', exitCode: code, players: config.service === 'server' ? [] : undefined })
  clearInterval(commandTimer)
  setTimeout(() => process.exit(0), 50)
})

function stopChild(force: boolean) {
  if (closing) return
  if (force) {
    appendLog(config.service === 'server' ? '[MST] 强制关闭服务端进程' : '[FRP] 强制终止')
    child.kill('SIGKILL')
    return
  }

  updateState({ status: 'stopping' })
  appendLog(config.service === 'server' ? '[MST] 正在关闭服务端...' : '[FRP] 正在停止...')
  if (config.stopMode === 'stdin' && child.stdin?.writable) child.stdin.write('stop\n')
  else child.kill('SIGTERM')

  if (forceStopTimer) clearTimeout(forceStopTimer)
  forceStopTimer = setTimeout(() => {
    if (!closing) stopChild(true)
  }, config.stopTimeoutMs)
}

function handleCommand(command: ManagedCommand) {
  if (command.sessionId !== config.sessionId) return
  if (command.type === 'stop') {
    stopChild(false)
    return
  }
  if (command.type === 'kill') {
    stopChild(true)
    return
  }
  if (command.type === 'stdin' && config.service === 'server' && child.stdin?.writable) {
    const value = typeof command.value === 'string' ? command.value.trim() : ''
    if (!value || /[\r\n]/.test(value) || value.length > 4096) return
    appendLog(`> ${value}`)
    child.stdin.write(`${value}\n`)
  }
}

function pollCommands() {
  let size: number
  try {
    size = fs.statSync(config.commandPath).size
  } catch {
    return
  }
  if (size < commandOffset) {
    commandOffset = 0
    pendingCommandText = ''
  }
  if (size === commandOffset) return

  const handle = fs.openSync(config.commandPath, 'r')
  try {
    const buffer = Buffer.alloc(size - commandOffset)
    fs.readSync(handle, buffer, 0, buffer.length, commandOffset)
    commandOffset = size
    const lines = `${pendingCommandText}${buffer.toString('utf8')}`.split(/\r?\n/)
    pendingCommandText = lines.pop() || ''
    for (const line of lines) {
      if (!line) continue
      try { handleCommand(JSON.parse(line) as ManagedCommand) } catch {}
    }
  } finally {
    fs.closeSync(handle)
  }
}

const commandTimer = setInterval(pollCommands, 100)

process.on('uncaughtException', error => {
  appendLog(`[Runtime] 托管运行器异常: ${error.message}`)
  updateState({ status: 'error', error: error.message })
})

process.on('unhandledRejection', error => {
  const message = error instanceof Error ? error.message : String(error)
  appendLog(`[Runtime] 托管运行器异常: ${message}`)
  updateState({ status: 'error', error: message })
})
