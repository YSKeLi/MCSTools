import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'ssh2'
import type {
  RemoteServerAddResult,
  RemoteServerFingerprintInput,
  RemoteServerInput,
  RemoteServerMetrics,
  RemoteServerOs,
  RemoteServerSummary,
} from './types'
import {
  decodeWindowsMetricsJson,
  encodeWindowsPowerShellCommand,
  WINDOWS_METRICS_MARKER,
} from './windowsMetricsProtocol'

const CONNECTION_TIMEOUT_MS = 12000
const COMMAND_TIMEOUT_MS = 20000
const MAX_OUTPUT_BYTES = 1024 * 1024

interface StoredRemoteServer extends RemoteServerSummary {
  encryptedPassword: string
}

interface CommandResult {
  stdout: string
  fingerprint: string
}

const LINUX_METRICS_SCRIPT = String.raw`set -eu
read _ user1 nice1 system1 idle1 iowait1 irq1 softirq1 steal1 _ < /proc/stat
total1=$((user1 + nice1 + system1 + idle1 + iowait1 + irq1 + softirq1 + steal1))
idle_total1=$((idle1 + iowait1))
sleep 1
read _ user2 nice2 system2 idle2 iowait2 irq2 softirq2 steal2 _ < /proc/stat
total2=$((user2 + nice2 + system2 + idle2 + iowait2 + irq2 + softirq2 + steal2))
idle_total2=$((idle2 + iowait2))
total_delta=$((total2 - total1))
idle_delta=$((idle_total2 - idle_total1))
if [ "$total_delta" -gt 0 ]; then
  cpu_usage_tenths=$(((1000 * (total_delta - idle_delta) + total_delta / 2) / total_delta))
else
  cpu_usage_tenths=0
fi
cpu_model=$(awk -F: '/model name|Hardware|Processor/ { value=$2; sub(/^[[:space:]]+/, "", value); print value; exit }' /proc/cpuinfo)
cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c '^processor' /proc/cpuinfo)
mem_total_kb=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
mem_available_kb=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
if [ -z "$mem_available_kb" ]; then
  mem_available_kb=$(awk '/^MemFree:|^Buffers:|^Cached:/ { sum += $2 } END { print sum }' /proc/meminfo)
fi
set -- $(df -Pk / | tail -n 1)
disk_filesystem=$1
disk_total_kb=$2
disk_used_kb=$3
disk_available_kb=$4
disk_mount=$6
os_name=$(if [ -r /etc/os-release ]; then . /etc/os-release; if [ -n "$PRETTY_NAME" ]; then printf '%s' "$PRETTY_NAME"; else printf '%s' "$NAME"; fi; else uname -s; fi)
printf 'hostname=%s\n' "$(hostname)"
printf 'os_name=%s\n' "$os_name"
printf 'kernel=%s\n' "$(uname -sr)"
printf 'uptime_seconds=%s\n' "$(cut -d. -f1 /proc/uptime)"
printf 'cpu_model=%s\n' "$cpu_model"
printf 'cpu_cores=%s\n' "$cpu_cores"
printf 'cpu_usage_tenths=%s\n' "$cpu_usage_tenths"
printf 'load_average=%s\n' "$(cut -d' ' -f1 /proc/loadavg)"
printf 'memory_total_kb=%s\n' "$mem_total_kb"
printf 'memory_available_kb=%s\n' "$mem_available_kb"
printf 'disk_filesystem=%s\n' "$disk_filesystem"
printf 'disk_mount=%s\n' "$disk_mount"
printf 'disk_total_kb=%s\n' "$disk_total_kb"
printf 'disk_used_kb=%s\n' "$disk_used_kb"
printf 'disk_available_kb=%s\n' "$disk_available_kb"
`

const WINDOWS_METRICS_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$os = Get-CimInstance Win32_OperatingSystem
$cpus = @(Get-CimInstance Win32_Processor)
$systemDrive = $os.SystemDrive
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'"
$cpuUsage = ($cpus | Measure-Object -Property LoadPercentage -Average).Average
$cpuCores = ($cpus | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$cpuModel = ($cpus | Select-Object -First 1).Name
$result = [ordered]@{
  hostname = $env:COMPUTERNAME
  osName = $os.Caption
  kernel = $os.Version
  uptimeSeconds = [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
  cpuModel = $cpuModel
  cpuCores = [int]$cpuCores
  cpuUsagePercent = [double]$cpuUsage
  memoryTotalBytes = [double]$os.TotalVisibleMemorySize * 1KB
  memoryAvailableBytes = [double]$os.FreePhysicalMemory * 1KB
  diskFilesystem = $disk.FileSystem
  diskMount = $systemDrive
  diskTotalBytes = [double]$disk.Size
  diskAvailableBytes = [double]$disk.FreeSpace
}
$json = $result | ConvertTo-Json -Compress
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
[Console]::Out.WriteLine('${WINDOWS_METRICS_MARKER}' + $payload)
`

function storePath(): string {
  return path.join(app.getPath('userData'), 'remote-servers.json')
}

function normalizeStoredServer(item: any): StoredRemoteServer | null {
  if (!item || typeof item !== 'object') return null
  if (typeof item.id !== 'string' || typeof item.encryptedPassword !== 'string') return null
  if (item.os !== 'linux' && item.os !== 'windows') return null
  const isLegacyWinRm = item.transport === 'winrm'
  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name : item.host || '未命名服务器',
    host: typeof item.host === 'string' ? item.host : '',
    port: isLegacyWinRm ? 22 : (Number.isInteger(Number(item.port)) ? Number(item.port) : 22),
    username: typeof item.username === 'string' ? item.username : '',
    os: item.os,
    hostFingerprint: isLegacyWinRm ? '' : (typeof item.hostFingerprint === 'string' ? item.hostFingerprint : ''),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
    encryptedPassword: item.encryptedPassword,
  }
}

function readStoredServers(): StoredRemoteServer[] {
  const file = storePath()
  const backupFile = `${file}.bak`
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(backupFile)) return []
    try {
      fs.renameSync(backupFile, file)
    } catch {
      throw new Error('无法恢复云服务器连接数据，请检查应用数据目录权限')
    }
  }
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (!Array.isArray(value)) throw new Error('invalid store')
    return value.map(normalizeStoredServer).filter((item): item is StoredRemoteServer => item !== null)
  } catch {
    throw new Error('云服务器连接数据已损坏，请备份后重新添加服务器')
  }
}

function writeStoredServers(servers: StoredRemoteServer[]): void {
  const file = storePath()
  const tempFile = `${file}.tmp`
  const backupFile = `${file}.bak`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tempFile, JSON.stringify(servers, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    fs.rmSync(backupFile, { force: true })
    if (fs.existsSync(file)) fs.renameSync(file, backupFile)
    fs.renameSync(tempFile, file)
    fs.rmSync(backupFile, { force: true })
  } catch {
    if (!fs.existsSync(file) && fs.existsSync(backupFile)) fs.renameSync(backupFile, file)
    fs.rmSync(tempFile, { force: true })
    throw new Error('保存云服务器连接失败，请检查应用数据目录权限')
  }
}

function summary(server: StoredRemoteServer): RemoteServerSummary {
  const { encryptedPassword: _encryptedPassword, ...safeServer } = server
  return safeServer
}

function assertSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全凭据存储，无法保存服务器密码')
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('当前 Linux 系统未配置安全密钥环，无法保存服务器密码')
  }
}

function validateInput(input: RemoteServerInput): RemoteServerInput {
  const value = {
    name: typeof input?.name === 'string' ? input.name.trim() : '',
    host: typeof input?.host === 'string' ? input.host.trim() : '',
    port: Number(input?.port),
    username: typeof input?.username === 'string' ? input.username.trim() : '',
    password: typeof input?.password === 'string' ? input.password : '',
    os: input?.os,
    expectedFingerprint: typeof input?.expectedFingerprint === 'string' ? input.expectedFingerprint : '',
  }
  if (!value.name || value.name.length > 100) throw new Error('请输入有效的服务器名称')
  if (!value.host || value.host.length > 255 || /\s/.test(value.host)) throw new Error('请输入有效的服务器地址')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('SSH 端口无效')
  if (!value.username || value.username.length > 128 || /[\r\n]/.test(value.username)) throw new Error('请输入有效的登录账户')
  if (!value.password || value.password.length > 4096 || /[\r\n]/.test(value.password)) throw new Error('请输入有效的登录密码')
  if (value.os !== 'linux' && value.os !== 'windows') throw new Error('请选择服务器系统')
  if (!value.expectedFingerprint || !/^[a-f0-9]{64}$/i.test(value.expectedFingerprint)) {
    throw new Error('请先确认 SSH 主机指纹')
  }
  return value as RemoteServerInput
}

function validateFingerprintInput(input: RemoteServerFingerprintInput): RemoteServerFingerprintInput {
  const value = {
    host: typeof input?.host === 'string' ? input.host.trim() : '',
    port: Number(input?.port),
    username: typeof input?.username === 'string' ? input.username.trim() : '',
  }
  if (!value.host || value.host.length > 255 || /\s/.test(value.host)) throw new Error('请输入有效的服务器地址')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('SSH 端口无效')
  if (!value.username || value.username.length > 128 || /[\r\n]/.test(value.username)) throw new Error('请输入有效的登录账户')
  return value
}

function decryptPassword(server: StoredRemoteServer): string {
  assertSafeStorage()
  try {
    return safeStorage.decryptString(Buffer.from(server.encryptedPassword, 'base64'))
  } catch {
    throw new Error('服务器密码无法解密，请删除后重新添加该服务器')
  }
}

function friendlyConnectionError(
  error: unknown,
  fingerprintMismatch: boolean,
  authenticated = false,
  os?: RemoteServerOs,
): Error {
  if (fingerprintMismatch) return new Error('SSH 主机指纹已变化，为保护账户密码已拒绝连接')
  const message = error instanceof Error ? error.message : String(error || '')
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ECONNREFUSED') return new Error('SSH 连接被拒绝，请检查地址、端口和 SSH 服务状态')
  if (code === 'ETIMEDOUT' || /timed out|timeout/i.test(message)) return new Error('SSH 连接超时，请检查地址、防火墙和安全组')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new Error('无法解析服务器地址')
  const credentialHint = os === 'windows'
    ? '请检查账户名和账户密码；Windows Hello PIN 不能用于 SSH 登录'
    : '请检查账户名和密码'
  if (/authentication methods failed|authentication failure/i.test(message)) return new Error(`SSH 登录失败，${credentialHint}`)
  if (code === 'ECONNRESET' || /ECONNRESET|connection reset/i.test(message)) {
    return authenticated
      ? new Error('SSH 连接在读取服务器信息时被远程主机中断，请稍后重试')
      : new Error(`SSH 服务器在登录阶段断开了连接，${credentialHint}`)
  }
  return new Error(message || 'SSH 连接失败')
}

function executeRemote(
  target: Pick<RemoteServerSummary, 'host' | 'port' | 'username' | 'os'>,
  password: string,
  expectedFingerprint: string | undefined,
  command: string,
  input: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    let observedFingerprint = ''
    let fingerprintMismatch = false
    let authenticated = false
    let commandTimer: NodeJS.Timeout | undefined

    const finish = (error?: unknown, stdout = '') => {
      if (settled) return
      settled = true
      if (commandTimer) clearTimeout(commandTimer)
      client.end()
      if (error) reject(friendlyConnectionError(error, fingerprintMismatch, authenticated, target.os))
      else resolve({ stdout, fingerprint: observedFingerprint })
    }

    client
      .on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
        complete(prompts.map(() => password))
      })
      .on('ready', () => {
        authenticated = true
        client.exec(command, (error, stream) => {
          if (error) {
            finish(error)
            return
          }
          let stdout = ''
          let stderr = ''
          const append = (current: string, chunk: Buffer): string => {
            const next = current + chunk.toString('utf8')
            if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
              stream.close()
              finish(new Error('服务器返回的数据过大'))
            }
            return next
          }
          stream.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
          stream.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
          stream.on('close', (code: number | undefined) => {
            if (code !== undefined && code !== 0) {
              finish(new Error(stderr.trim() || `远程命令执行失败（${code}）`))
              return
            }
            finish(undefined, stdout)
          })
          commandTimer = setTimeout(() => {
            stream.close()
            finish(new Error('读取服务器信息超时'))
          }, COMMAND_TIMEOUT_MS)
          stream.end(input)
        })
      })
      .on('error', error => finish(error))
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password,
        tryKeyboard: true,
        readyTimeout: CONNECTION_TIMEOUT_MS,
        keepaliveInterval: 5000,
        keepaliveCountMax: 2,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => {
          observedFingerprint = fingerprint
          fingerprintMismatch = Boolean(expectedFingerprint && fingerprint !== expectedFingerprint)
          return !fingerprintMismatch
        },
      })
  })
}

function inspectHostFingerprint(input: RemoteServerFingerprintInput): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let observed = ''
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      client.end()
      if (observed) resolve(observed)
      else reject(friendlyConnectionError(error, false))
    }

    client
      .on('error', error => finish(error))
      .on('close', () => finish(new Error('未读取到 SSH 主机指纹')))
      .connect({
        host: input.host,
        port: input.port,
        username: input.username,
        readyTimeout: CONNECTION_TIMEOUT_MS,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => {
          observed = fingerprint
          return false
        },
      })
  })
}

function numberField(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function percentage(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function parseLinuxMetrics(output: string): RemoteServerMetrics {
  const fields: Record<string, string> = {}
  output.split(/\r?\n/).forEach(line => {
    const separator = line.indexOf('=')
    if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1).trim()
  })
  const memoryTotal = numberField(fields.memory_total_kb) * 1024
  const memoryAvailable = numberField(fields.memory_available_kb) * 1024
  const diskTotal = numberField(fields.disk_total_kb) * 1024
  const diskUsed = numberField(fields.disk_used_kb) * 1024
  const diskAvailable = numberField(fields.disk_available_kb) * 1024
  if (!fields.hostname || memoryTotal <= 0 || diskTotal <= 0) throw new Error('无法解析 Linux 服务器指标，请确认所选系统正确')
  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable)
  return {
    fetchedAt: new Date().toISOString(),
    hostname: fields.hostname,
    osName: fields.os_name || 'Linux',
    kernel: fields.kernel || '',
    uptimeSeconds: numberField(fields.uptime_seconds),
    cpu: {
      model: fields.cpu_model || 'Unknown CPU',
      cores: numberField(fields.cpu_cores, 1),
      usagePercent: numberField(fields.cpu_usage_tenths) / 10,
      loadAverage: numberField(fields.load_average),
    },
    memory: {
      totalBytes: memoryTotal,
      usedBytes: memoryUsed,
      availableBytes: memoryAvailable,
      usagePercent: percentage(memoryUsed, memoryTotal),
    },
    disk: {
      filesystem: fields.disk_filesystem || '',
      mount: fields.disk_mount || '/',
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      usagePercent: percentage(diskUsed, diskTotal),
    },
  }
}

function parseWindowsMetrics(output: string): RemoteServerMetrics {
  let value: Record<string, unknown>
  try {
    value = decodeWindowsMetricsJson(output)
  } catch {
    throw new Error('无法解析 Windows Server 指标，请确认所选系统正确且 PowerShell 可用')
  }
  const memoryTotal = numberField(value.memoryTotalBytes)
  const memoryAvailable = numberField(value.memoryAvailableBytes)
  const diskTotal = numberField(value.diskTotalBytes)
  const diskAvailable = numberField(value.diskAvailableBytes)
  if (!value.hostname || memoryTotal <= 0 || diskTotal <= 0) throw new Error('Windows Server 返回的系统指标不完整')
  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable)
  const diskUsed = Math.max(0, diskTotal - diskAvailable)
  return {
    fetchedAt: new Date().toISOString(),
    hostname: String(value.hostname),
    osName: String(value.osName || 'Windows Server'),
    kernel: String(value.kernel || ''),
    uptimeSeconds: numberField(value.uptimeSeconds),
    cpu: {
      model: String(value.cpuModel || 'Unknown CPU'),
      cores: numberField(value.cpuCores, 1),
      usagePercent: Math.min(100, Math.max(0, numberField(value.cpuUsagePercent))),
    },
    memory: {
      totalBytes: memoryTotal,
      usedBytes: memoryUsed,
      availableBytes: memoryAvailable,
      usagePercent: percentage(memoryUsed, memoryTotal),
    },
    disk: {
      filesystem: String(value.diskFilesystem || ''),
      mount: String(value.diskMount || 'C:'),
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      usagePercent: percentage(diskUsed, diskTotal),
    },
  }
}

async function collectMetrics(
  target: Pick<RemoteServerSummary, 'host' | 'port' | 'username' | 'os'>,
  password: string,
  expectedFingerprint?: string,
): Promise<{ metrics: RemoteServerMetrics; fingerprint: string }> {
  const isWindows = target.os === 'windows'
  const result = await executeRemote(
    target,
    password,
    expectedFingerprint,
    isWindows ? encodeWindowsPowerShellCommand(WINDOWS_METRICS_SCRIPT) : 'sh -s',
    isWindows ? '' : LINUX_METRICS_SCRIPT,
  )
  return {
    metrics: isWindows ? parseWindowsMetrics(result.stdout) : parseLinuxMetrics(result.stdout),
    fingerprint: result.fingerprint,
  }
}

export class RemoteServerService {
  list(): RemoteServerSummary[] {
    return readStoredServers().map(summary)
  }

  async getFingerprint(rawInput: RemoteServerFingerprintInput): Promise<string> {
    return inspectHostFingerprint(validateFingerprintInput(rawInput))
  }

  async add(rawInput: RemoteServerInput): Promise<RemoteServerAddResult> {
    assertSafeStorage()
    const input = validateInput(rawInput)
    const existing = readStoredServers()
    if (existing.some(server => server.host === input.host && server.port === input.port && server.username === input.username)) {
      throw new Error('该服务器账户已经添加')
    }

    const collected = await collectMetrics(input, input.password, input.expectedFingerprint)
    const current = readStoredServers()
    if (current.some(server => server.host === input.host && server.port === input.port && server.username === input.username)) {
      throw new Error('该服务器账户已经添加')
    }
    const server: StoredRemoteServer = {
      id: randomUUID(),
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      os: input.os,
      hostFingerprint: collected.fingerprint,
      createdAt: new Date().toISOString(),
      encryptedPassword: safeStorage.encryptString(input.password).toString('base64'),
    }
    writeStoredServers([...current, server])
    return { server: summary(server), metrics: collected.metrics }
  }

  remove(id: string): void {
    if (typeof id !== 'string' || !id) throw new Error('服务器信息无效')
    const existing = readStoredServers()
    if (!existing.some(server => server.id === id)) return
    writeStoredServers(existing.filter(server => server.id !== id))
  }

  async getMetrics(id: string): Promise<RemoteServerMetrics> {
    const server = readStoredServers().find(item => item.id === id)
    if (!server) throw new Error('服务器不存在或已被删除')
    const result = await collectMetrics(server, decryptPassword(server), server.hostFingerprint || undefined)
    if (!server.hostFingerprint && result.fingerprint) {
      const current = readStoredServers()
      writeStoredServers(current.map(item => item.id === id ? { ...item, hostFingerprint: result.fingerprint } : item))
    }
    return result.metrics
  }
}
