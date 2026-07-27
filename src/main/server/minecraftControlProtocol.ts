import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const MINECRAFT_RUNTIME_DIRECTORY = '.mcstools'
export const MINECRAFT_CONTROL_FILE = 'control.json'
export const MINECRAFT_PID_FILE = 'server.pid'

export type MinecraftControlTransport = 'command-file' | 'fifo' | 'named-pipe'

export interface MinecraftControlDescriptor {
  version: 1
  transport: MinecraftControlTransport
  logPath: string
  commandPath?: string
  sessionId?: string
  inputPath?: string
  pipeName?: string
}

export function createManagedControlRecord(
  descriptor: MinecraftControlDescriptor,
  type: 'stdin' | 'stop' | 'kill',
  value?: string,
): string {
  if (descriptor.transport !== 'command-file' || !descriptor.sessionId) {
    throw new Error('当前控制通道不是命令文件')
  }
  return `${JSON.stringify({ id: randomUUID(), sessionId: descriptor.sessionId, type, value })}\n`
}

function safeText(value: unknown, maxLength = 4096): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text && text.length <= maxLength && !/[\0\r\n]/.test(text) ? text : undefined
}

export function parseMinecraftControlDescriptor(value: unknown): MinecraftControlDescriptor | null {
  let candidate = value
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  if (record.version !== 1) return null
  const transport = record.transport
  if (transport !== 'command-file' && transport !== 'fifo' && transport !== 'named-pipe') return null
  const logPath = safeText(record.logPath)
  if (!logPath) return null

  if (transport === 'command-file') {
    const commandPath = safeText(record.commandPath)
    const sessionId = safeText(record.sessionId, 200)
    return commandPath && sessionId ? { version: 1, transport, logPath, commandPath, sessionId } : null
  }
  if (transport === 'fifo') {
    const inputPath = safeText(record.inputPath)
    return inputPath ? { version: 1, transport, logPath, inputPath } : null
  }
  const pipeName = safeText(record.pipeName, 200)
  if (!pipeName || !/^[a-zA-Z0-9._-]+$/.test(pipeName)) return null
  return { version: 1, transport, logPath, pipeName }
}

export function minecraftControlPath(serverDirectory: string): string {
  return path.join(serverDirectory, MINECRAFT_RUNTIME_DIRECTORY, MINECRAFT_CONTROL_FILE)
}

export function minecraftPidPath(serverDirectory: string): string {
  return path.join(serverDirectory, MINECRAFT_RUNTIME_DIRECTORY, MINECRAFT_PID_FILE)
}

export function readLocalMinecraftControl(serverDirectory: string): MinecraftControlDescriptor | null {
  try {
    return parseMinecraftControlDescriptor(fs.readFileSync(minecraftControlPath(serverDirectory), 'utf8'))
  } catch {
    return null
  }
}

export function writeLocalMinecraftControl(
  serverDirectory: string,
  descriptor: MinecraftControlDescriptor,
  pid: number,
): void {
  const runtimeDirectory = path.join(serverDirectory, MINECRAFT_RUNTIME_DIRECTORY)
  fs.mkdirSync(runtimeDirectory, { recursive: true })
  const controlPath = minecraftControlPath(serverDirectory)
  const temporaryPath = `${controlPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, controlPath)
  fs.writeFileSync(minecraftPidPath(serverDirectory), String(pid), 'utf8')
}

export function removeLocalMinecraftControl(serverDirectory: string, sessionId: string): void {
  const descriptor = readLocalMinecraftControl(serverDirectory)
  if (descriptor?.transport !== 'command-file' || descriptor.sessionId !== sessionId) return
  try { fs.rmSync(minecraftControlPath(serverDirectory), { force: true }) } catch {}
  try { fs.rmSync(minecraftPidPath(serverDirectory), { force: true }) } catch {}
}
