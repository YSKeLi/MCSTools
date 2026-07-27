import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Client, type FileEntryWithStats, type SFTPWrapper } from 'ssh2'
import { detectServerFiles } from '../detect'
import {
  type MinecraftControlDescriptor,
  createManagedControlRecord,
  parseMinecraftControlDescriptor,
} from '../server/minecraftControlProtocol'
import { normalizeRemotePath, parseRemoteServerProfile, remoteBaseName, remoteJoin, remoteParentPath, validateRemoteJarName } from './remoteMinecraftPolicy'
import { parsePosixMetrics } from './posixMetricsProtocol'
import type {
  RemoteDirectoryListing,
  RemoteFileBrowserItem,
  RemoteMinecraftDirectory,
  RemoteMinecraftServer,
  RemoteMinecraftServerInput,
  RemoteMinecraftServerStatus,
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
  minecraftServers: RemoteMinecraftServer[]
}

interface CommandResult {
  stdout: string
  fingerprint: string
}

const REMOTE_RUNTIME_DIRECTORY = '.mcstools'
const REMOTE_LOG_FILE = 'server.log'
const REMOTE_PID_FILE = 'server.pid'
const REMOTE_INPUT_FILE = 'server.stdin'
const REMOTE_CONTROL_FILE = 'control.json'
const SERVER_PROFILE_FILE = 'profilemcsrv.toml'
const MAX_REMOTE_FILE_BYTES = 2 * 1024 * 1024
const MAX_REMOTE_PROFILE_BYTES = 64 * 1024
const SFTP_OPERATION_TIMEOUT_MS = 20000

const WINDOWS_RUNNER_SCRIPT = String.raw`param(
  [Parameter(Mandatory=$true)][string]$WorkingDirectory,
  [Parameter(Mandatory=$true)][string]$JarName,
  [Parameter(Mandatory=$true)][int]$MaxRam,
  [Parameter(Mandatory=$true)][string]$PipeName,
  [Parameter(Mandatory=$true)][string]$LogPath,
  [Parameter(Mandatory=$true)][string]$PidPath
)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
function Write-Log([string]$Line) {
  [System.IO.File]::AppendAllText($LogPath, $Line + [Environment]::NewLine, $utf8)
}
try {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = 'java.exe'
  $psi.WorkingDirectory = $WorkingDirectory
  $escapedJar = $JarName.Replace('"', '\"')
  $psi.Arguments = ('-Xmx{0}M -jar "{1}" nogui' -f $MaxRam, $escapedJar)
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $process.EnableRaisingEvents = $true
  $process.add_OutputDataReceived({ param($sender, $eventArgs) if ($null -ne $eventArgs.Data) { Write-Log $eventArgs.Data } })
  $process.add_ErrorDataReceived({ param($sender, $eventArgs) if ($null -ne $eventArgs.Data) { Write-Log ('[ERR] ' + $eventArgs.Data) } })
  if (-not $process.Start()) { throw 'Java process did not start' }
  [System.IO.File]::WriteAllText($PidPath, [string]$process.Id, $utf8)
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  while (-not $process.HasExited) {
    $pipe = [System.IO.Pipes.NamedPipeServerStream]::new($PipeName, [System.IO.Pipes.PipeDirection]::In, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous)
    try {
      $waiting = $pipe.BeginWaitForConnection($null, $null)
      while (-not $waiting.AsyncWaitHandle.WaitOne(250) -and -not $process.HasExited) {}
      if ($process.HasExited) { break }
      $pipe.EndWaitForConnection($waiting)
      $reader = [System.IO.StreamReader]::new($pipe, $utf8)
      try {
        $command = $reader.ReadToEnd()
        if ($command) {
          $process.StandardInput.WriteLine($command.TrimEnd([char]13, [char]10))
          $process.StandardInput.Flush()
        }
      } finally { $reader.Dispose() }
    } finally { $pipe.Dispose() }
  }
  $process.WaitForExit()
  Write-Log ("[MST] Java 进程已退出，代码 " + $process.ExitCode)
} catch {
  Write-Log ('[MST] 远程运行器出错: ' + $_.Exception.Message)
} finally {
  [System.IO.File]::Delete($PidPath)
}
`

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

const MACOS_METRICS_SCRIPT = String.raw`set -eu
cpu_model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null || uname -m)
cpu_cores=$(sysctl -n hw.logicalcpu 2>/dev/null || getconf _NPROCESSORS_ONLN)
cpu_usage_tenths=$(LC_ALL=C top -l 2 -n 0 2>/dev/null | awk '/CPU usage/ { idle=$7; gsub(/%/, "", idle); usage=(100-idle)*10 } END { if (usage < 0) usage=0; if (usage > 1000) usage=1000; printf "%.0f", usage }')
mem_total_bytes=$(sysctl -n hw.memsize)
page_size=$(vm_stat | awk '/page size of/ { for (i=1; i<=NF; i++) if ($i == "of") { print $(i+1); exit } }')
memory_available_bytes=$(vm_stat | awk -F: -v page_size="$page_size" '/Pages free|Pages inactive|Pages speculative/ { value=$2; gsub(/[^0-9]/, "", value); pages += value } END { printf "%.0f", pages * page_size }')
memory_total_kb=$((mem_total_bytes / 1024))
memory_available_kb=$((memory_available_bytes / 1024))
disk_line=$(df -Pk / | tail -n 1)
disk_filesystem=$(printf '%s\n' "$disk_line" | awk '{ print $1 }')
disk_total_kb=$(printf '%s\n' "$disk_line" | awk '{ print $2 }')
disk_used_kb=$(printf '%s\n' "$disk_line" | awk '{ print $3 }')
disk_available_kb=$(printf '%s\n' "$disk_line" | awk '{ print $4 }')
disk_mount=$(printf '%s\n' "$disk_line" | awk '{ print $NF }')
boot_seconds=$(sysctl -n kern.boottime | awk -F'[=,]' '{ value=$2; gsub(/[^0-9]/, "", value); print value }')
now_seconds=$(date +%s)
uptime_seconds=$((now_seconds - boot_seconds))
load_average=$(sysctl -n vm.loadavg | awk '{ gsub(/[{}]/, ""); print $1 }')
os_name="$(sw_vers -productName) $(sw_vers -productVersion)"
printf 'hostname=%s\n' "$(hostname)"
printf 'os_name=%s\n' "$os_name"
printf 'kernel=%s\n' "$(uname -sr)"
printf 'uptime_seconds=%s\n' "$uptime_seconds"
printf 'cpu_model=%s\n' "$cpu_model"
printf 'cpu_cores=%s\n' "$cpu_cores"
printf 'cpu_usage_tenths=%s\n' "$cpu_usage_tenths"
printf 'load_average=%s\n' "$load_average"
printf 'memory_total_kb=%s\n' "$memory_total_kb"
printf 'memory_available_kb=%s\n' "$memory_available_kb"
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

function normalizeMinecraftServer(item: any): RemoteMinecraftServer | null {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null
  const remotePath = typeof item.path === 'string' ? item.path.trim() : ''
  const jarName = typeof item.jarName === 'string' ? item.jarName.trim() : ''
  if (!remotePath || !jarName) return null
  const maxRam = Number(item.maxRam)
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : remoteBaseName(remotePath),
    path: remotePath,
    jarName,
    coreType: typeof item.coreType === 'string' && item.coreType.trim() ? item.coreType.trim() : '未知',
    version: typeof item.version === 'string' && item.version.trim() ? item.version.trim() : '未知',
    remark: typeof item.remark === 'string' ? item.remark.trim() : '',
    maxRam: Number.isInteger(maxRam) && maxRam >= 512 && maxRam <= 131072 ? maxRam : 2048,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
  }
}

function normalizeStoredServer(item: any): StoredRemoteServer | null {
  if (!item || typeof item !== 'object') return null
  if (typeof item.id !== 'string' || typeof item.encryptedPassword !== 'string') return null
  if (item.os !== 'linux' && item.os !== 'windows' && item.os !== 'macos') return null
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
    minecraftServers: Array.isArray(item.minecraftServers)
      ? item.minecraftServers.map(normalizeMinecraftServer).filter((server: RemoteMinecraftServer | null): server is RemoteMinecraftServer => server !== null)
      : [],
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
  const { encryptedPassword: _encryptedPassword, minecraftServers: _minecraftServers, ...safeServer } = server
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
  if (value.os !== 'linux' && value.os !== 'windows' && value.os !== 'macos') throw new Error('请选择服务器系统')
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
  timeoutMs = COMMAND_TIMEOUT_MS,
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
          }, timeoutMs)
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

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function findStoredServer(id: string): StoredRemoteServer {
  const server = readStoredServers().find(item => item.id === id)
  if (!server) throw new Error('云服务器不存在或已被删除')
  return server
}

function findMinecraftServer(remoteServerId: string, minecraftServerId: string): {
  host: StoredRemoteServer
  minecraftServer: RemoteMinecraftServer
} {
  const host = findStoredServer(remoteServerId)
  const minecraftServer = host.minecraftServers.find(item => item.id === minecraftServerId)
  if (!minecraftServer) throw new Error('Minecraft 服务器不存在或已被移除')
  return { host, minecraftServer }
}

function connectSftp(server: StoredRemoteServer): Promise<{ client: Client; sftp: SFTPWrapper }> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const password = decryptPassword(server)
    let fingerprintMismatch = false
    let authenticated = false
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      client.end()
      reject(friendlyConnectionError(error, fingerprintMismatch, authenticated, server.os))
    }
    client
      .on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
        complete(prompts.map(() => password))
      })
      .on('ready', () => {
        authenticated = true
        client.sftp((error, sftp) => {
          if (error) return fail(error)
          settled = true
          resolve({ client, sftp })
        })
      })
      .on('error', fail)
      .connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password,
        tryKeyboard: true,
        readyTimeout: CONNECTION_TIMEOUT_MS,
        keepaliveInterval: 5000,
        keepaliveCountMax: 2,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => {
          fingerprintMismatch = Boolean(server.hostFingerprint && fingerprint !== server.hostFingerprint)
          return !fingerprintMismatch
        },
      })
  })
}

async function withSftp<T>(server: StoredRemoteServer, action: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const connection = await connectSftp(server)
  try {
    return await action(connection.sftp)
  } finally {
    connection.client.end()
  }
}

function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('读取远程目录超时'))
    }, SFTP_OPERATION_TIMEOUT_MS)
    sftp.readdir(remotePath, (error, list) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(list)
    })
  })
}

function sftpReadText(sftp: SFTPWrapper, remotePath: string, maxBytes = MAX_REMOTE_FILE_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('读取远程文件超时'))
    }, SFTP_OPERATION_TIMEOUT_MS)
    sftp.readFile(remotePath, (error, data) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) return reject(error)
      if (data.byteLength > maxBytes) return reject(new Error('远程文件过大，无法在应用中打开'))
      resolve(data.toString('utf8'))
    })
  })
}

function sftpWriteText(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), error => error ? reject(error) : resolve())
  })
}

function sftpAppendText(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.appendFile(remotePath, Buffer.from(content, 'utf8'), error => error ? reject(error) : resolve())
  })
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, error => {
      if (!error) return resolve()
      sftp.stat(remotePath, (statError, stats) => {
        if (!statError && stats.isDirectory()) resolve()
        else reject(error)
      })
    })
  })
}

async function inspectMinecraftDirectory(
  sftp: SFTPWrapper,
  os: RemoteServerOs,
  rawPath: string,
): Promise<RemoteMinecraftDirectory> {
  const remotePath = normalizeRemotePath(os, rawPath)
  let entries: FileEntryWithStats[]
  try {
    entries = await sftpReaddir(sftp, remotePath)
  } catch {
    throw new Error(`无法读取远程目录：${remotePath}`)
  }
  if (!entries.some(entry => entry.filename.toLowerCase() === 'server.properties' && entry.attrs.isFile())) {
    throw new Error('所选目录中没有 server.properties 文件')
  }
  const jars = entries
    .filter(entry => entry.attrs.isFile() && entry.filename.toLowerCase().endsWith('.jar'))
    .map(entry => ({ name: entry.filename, size: entry.attrs.size }))
  const detected = detectServerFiles(jars)
  const profileEntry = entries.find(entry => (
    entry.attrs.isFile() && entry.filename.toLowerCase() === SERVER_PROFILE_FILE
  ))
  let profile = parseRemoteServerProfile('')
  if (profileEntry) {
    try {
      profile = parseRemoteServerProfile(await sftpReadText(
        sftp,
        remoteJoin(remotePath, profileEntry.filename),
        MAX_REMOTE_PROFILE_BYTES,
      ))
    } catch {
      // A missing or malformed optional profile must not prevent importing the server.
    }
  }
  const profileType = profile.coreName?.trim() || profile.coreType?.trim() || ''
  const profileVersion = profile.gameVersion?.trim() || ''
  const profileRemark = profile.serverName?.trim() || ''
  return {
    path: remotePath,
    name: remoteBaseName(remotePath),
    jarFiles: detected.jarFiles,
    suggestedJar: detected.jarName,
    suggestedType: profileType && profileType.length <= 100 ? profileType : detected.coreName,
    suggestedVersion: profileVersion && profileVersion.length <= 100 ? profileVersion : detected.version,
    suggestedRemark: profileRemark.length <= 500 ? profileRemark : '',
  }
}

function runtimePaths(minecraftServer: RemoteMinecraftServer) {
  const runtimeDirectory = remoteJoin(minecraftServer.path, REMOTE_RUNTIME_DIRECTORY)
  return {
    runtimeDirectory,
    logPath: remoteJoin(runtimeDirectory, REMOTE_LOG_FILE),
    pidPath: remoteJoin(runtimeDirectory, REMOTE_PID_FILE),
    inputPath: remoteJoin(runtimeDirectory, REMOTE_INPUT_FILE),
    controlPath: remoteJoin(runtimeDirectory, REMOTE_CONTROL_FILE),
    runnerPath: remoteJoin(runtimeDirectory, 'runner.ps1'),
    pipeName: `mcstools_${minecraftServer.id.replace(/[^a-z0-9]/gi, '')}`,
  }
}

const remoteControlCache = new Map<string, { expiresAt: number; value: MinecraftControlDescriptor | null }>()

function remoteControlCacheKey(server: StoredRemoteServer, minecraftServer: RemoteMinecraftServer): string {
  return `${server.id}:${minecraftServer.id}`
}

async function readRemoteMinecraftControl(
  server: StoredRemoteServer,
  minecraftServer: RemoteMinecraftServer,
): Promise<MinecraftControlDescriptor | null> {
  const key = remoteControlCacheKey(server, minecraftServer)
  const cached = remoteControlCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  let value: MinecraftControlDescriptor | null = null
  try {
    value = await withSftp(server, async sftp => parseMinecraftControlDescriptor(
      await sftpReadText(sftp, runtimePaths(minecraftServer).controlPath, 64 * 1024),
    ))
  } catch {
    value = null
  }
  remoteControlCache.set(key, { expiresAt: Date.now() + 5000, value })
  return value
}

async function runStoredCommand(
  server: StoredRemoteServer,
  command: string,
  input = '',
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<string> {
  const result = await executeRemote(
    server,
    decryptPassword(server),
    server.hostFingerprint || undefined,
    command,
    input,
    timeoutMs,
  )
  return result.stdout
}

async function findMinecraftDirectories(server: StoredRemoteServer): Promise<RemoteMinecraftDirectory[]> {
  let paths: string[] = []
  if (server.os === 'linux') {
    const script = String.raw`if [ -n "$HOME" ] && [ -d "$HOME" ]; then set -- "$HOME"; else set --; fi
for root in /home /root /opt /srv /var/lib /mnt /data /minecraft /mc; do
  [ -d "$root" ] && set -- "$@" "$root"
done
if command -v timeout >/dev/null 2>&1; then
  timeout 40 find "$@" -maxdepth 6 \( -path '*/node_modules' -o -path '*/.git' -o -path '*/.cache' -o -path '*/docker/overlay2' \) -prune -o -type f -name server.properties -print
else
  find "$@" -maxdepth 6 \( -path '*/node_modules' -o -path '*/.git' -o -path '*/.cache' -o -path '*/docker/overlay2' \) -prune -o -type f -name server.properties -print
fi 2>/dev/null | sed 's#/server\.properties$##' | awk '!seen[$0]++' | head -n 100`
    const output = await runStoredCommand(server, 'sh -c ' + posixQuote(script), '', 60000)
    paths = output.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  } else if (server.os === 'macos') {
    const script = String.raw`if [ -n "$HOME" ] && [ -d "$HOME" ]; then set -- "$HOME"; else set --; fi
for root in /Users/Shared /opt /srv /Volumes /minecraft /mc; do
  [ -d "$root" ] && set -- "$@" "$root"
done
result_file=$(mktemp -t mcstools-find)
find "$@" \( -path '*/node_modules' -o -path '*/.git' -o -path '*/Library/Caches' -o -path '*/.Trash' \) -prune -o -type f -name server.properties -print > "$result_file" 2>/dev/null &
search_pid=$!
( sleep 40; kill "$search_pid" 2>/dev/null || true ) &
watchdog_pid=$!
wait "$search_pid" 2>/dev/null || true
kill "$watchdog_pid" 2>/dev/null || true
sed 's#/server\.properties$##' "$result_file" | awk '!seen[$0]++' | head -n 100
rm -f "$result_file"`
    const output = await runStoredCommand(server, 'sh -c ' + posixQuote(script), '', 60000)
    paths = output.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
  } else {
    const script = String.raw`$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$queue = [System.Collections.Generic.Queue[object]]::new()
$found = [System.Collections.Generic.List[string]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$deadline = [DateTime]::UtcNow.AddSeconds(40)
$skip = @('Windows', '$Recycle.Bin', 'System Volume Information', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Recovery', 'node_modules', '.git')
if ($env:USERPROFILE -and (Test-Path -LiteralPath $env:USERPROFILE -PathType Container)) { $queue.Enqueue(@($env:USERPROFILE, 0)) }
Get-PSDrive -PSProvider FileSystem | Where-Object { -not $_.DisplayRoot } | ForEach-Object {
  if (Test-Path -LiteralPath (Join-Path $_.Root 'server.properties') -PathType Leaf) { $found.Add($_.Root) }
  Get-ChildItem -LiteralPath $_.Root -Directory -Force | Where-Object { $_.Name -notin $skip } | ForEach-Object { $queue.Enqueue(@($_.FullName, 0)) }
}
while ($queue.Count -gt 0 -and $found.Count -lt 100 -and $seen.Count -lt 20000 -and [DateTime]::UtcNow -lt $deadline) {
  $item = $queue.Dequeue()
  $directory = [string]$item[0]
  $depth = [int]$item[1]
  if (-not $seen.Add($directory)) { continue }
  if (Test-Path -LiteralPath (Join-Path $directory 'server.properties') -PathType Leaf) { $found.Add($directory) }
  if ($depth -ge 5) { continue }
  Get-ChildItem -LiteralPath $directory -Directory -Force | Where-Object { $_.Name -notin $skip } | ForEach-Object { $queue.Enqueue(@($_.FullName, $depth + 1)) }
}
$json = ConvertTo-Json -Compress -InputObject @($found)
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
[Console]::Out.WriteLine('${WINDOWS_METRICS_MARKER}' + $payload)`
    const output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 60000)
    const decoded = decodeWindowsMetricsJson(output) as unknown
    paths = Array.isArray(decoded) ? decoded.filter((item): item is string => typeof item === 'string') : []
  }
  const uniquePaths = [...new Set(paths.map(item => normalizeRemotePath(server.os, item)))]
  return withSftp(server, async sftp => {
    const results: RemoteMinecraftDirectory[] = []
    for (const remotePath of uniquePaths) {
      try { results.push(await inspectMinecraftDirectory(sftp, server.os, remotePath)) } catch { /* directory changed while scanning */ }
    }
    return results
  })
}

async function browseRemoteDirectory(server: StoredRemoteServer, requestedPath?: string): Promise<RemoteDirectoryListing> {
  if (server.os === 'windows' && !requestedPath) {
    const script = String.raw`$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$roots = @(Get-PSDrive -PSProvider FileSystem | Where-Object { -not $_.DisplayRoot } | ForEach-Object { $_.Root })
$json = ConvertTo-Json -Compress -InputObject $roots
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
[Console]::Out.WriteLine('${WINDOWS_METRICS_MARKER}' + $payload)`
    const output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script))
    const decoded = decodeWindowsMetricsJson(output) as unknown
    const roots = Array.isArray(decoded) ? decoded : (typeof decoded === 'string' ? [decoded] : [])
    const items: RemoteFileBrowserItem[] = roots
      .filter((item): item is string => typeof item === 'string')
      .map(root => {
        const remotePath = normalizeRemotePath('windows', root)
        return { name: remotePath, path: remotePath, type: 'drive' as const, size: 0 }
      })
    return { path: '', parentPath: null, items, containsServerProperties: false }
  }

  const remotePath = normalizeRemotePath(server.os, requestedPath || '/')
  try {
    return await withSftp(server, async sftp => {
      const entries = await sftpReaddir(sftp, remotePath)
      const containsServerProperties = entries.some(entry => (
        entry.attrs.isFile() && entry.filename.toLowerCase() === 'server.properties'
      ))
      const items: RemoteFileBrowserItem[] = entries
        .filter(entry => entry.filename !== '.' && entry.filename !== '..')
        .map(entry => ({
          name: entry.filename,
          path: remoteJoin(remotePath, entry.filename),
          type: entry.attrs.isDirectory() ? 'directory' as const : 'file' as const,
          size: entry.attrs.size,
        }))
        .sort((left, right) => {
          if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
          return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
        })
        .slice(0, 500)
      return {
        path: remotePath,
        parentPath: remoteParentPath(server.os, remotePath),
        items,
        containsServerProperties,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    throw new Error(`无法读取远程目录 ${remotePath}${message ? `：${message}` : ''}`)
  }
}

async function getMinecraftStatus(
  server: StoredRemoteServer,
  minecraftServer: RemoteMinecraftServer,
): Promise<RemoteMinecraftServerStatus> {
  const paths = runtimePaths(minecraftServer)
  if (server.os === 'linux') {
    const script = String.raw`pid_file=${posixQuote(paths.pidPath)}
directory=${posixQuote(minecraftServer.path)}
jar_name=${posixQuote(minecraftServer.jarName)}
if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf running
    exit 0
  fi
  rm -f "$pid_file"
fi
target=$(readlink -f -- "$directory" 2>/dev/null || printf '%s' "$directory")
for process_directory in /proc/[0-9]*; do
  [ -r "$process_directory/cmdline" ] || continue
  process_cwd=$(readlink -f -- "$process_directory/cwd" 2>/dev/null || true)
  [ "$process_cwd" = "$target" ] || continue
  executable=$(basename "$(readlink -f -- "$process_directory/exe" 2>/dev/null || true)")
  case "$executable" in java|javaw) ;; *) continue ;; esac
  if tr '\0' '\n' < "$process_directory/cmdline" | awk -v jar="$jar_name" '
    previous == "-jar" {
      argument=$0
      sub(/^.*\//, "", argument)
      if (argument == jar) found=1
    }
    { previous=$0 }
    END { exit(found ? 0 : 1) }
  '; then
    printf external
    exit 0
  fi
done
printf stopped`
    const output = await runStoredCommand(server, 'sh -s', script)
    const state = output.trim()
    return state === 'running' || state === 'external' ? state : 'stopped'
  }
  if (server.os === 'macos') {
    const script = String.raw`pid_file=${posixQuote(paths.pidPath)}
directory=${posixQuote(minecraftServer.path)}
jar_name=${posixQuote(minecraftServer.jarName)}
input_file=${posixQuote(paths.inputPath)}
if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf running
    exit 0
  fi
  rm -f "$pid_file" "$input_file"
fi
target=$(cd "$directory" 2>/dev/null && pwd -P)
jar_path="$target/$jar_name"
for pid in $(ps -axo pid=,comm= | awk '$2 ~ /(^|\/)java(w)?$/ { print $1 }'); do
  command_line=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$command_line" in
    *"-jar $jar_name"*|*"-jar \"$jar_name\""*|*"$jar_path"*) ;;
    *) continue ;;
  esac
  process_cwd=$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
  if [ "$process_cwd" = "$target" ] || printf '%s' "$command_line" | grep -F -- "$jar_path" >/dev/null 2>&1; then
    printf external
    exit 0
  fi
done
printf stopped`
    const output = await runStoredCommand(server, 'sh -s', script)
    const state = output.trim()
    return state === 'running' || state === 'external' ? state : 'stopped'
  }
  const script = String.raw`$pidPath=${powerShellQuote(paths.pidPath)}
if (Test-Path -LiteralPath $pidPath) {
  $pidValue=Get-Content -LiteralPath $pidPath -Raw
  if ($pidValue -match '^\d+$' -and (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue)) {
    [Console]::Out.Write('running')
    exit 0
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}
$jarName=${powerShellQuote(minecraftServer.jarName)}
$jarPattern='(?i)(?:^|\s)-jar\s+(?:"[^"]*[\\/]|[^\s"]*[\\/])?' + [regex]::Escape($jarName) + '(?:"|\s|$)'
$candidates=@(Get-CimInstance Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match $jarPattern })
if ($candidates.Count -eq 0) {
  [Console]::Out.Write('stopped')
  exit 0
}
$serverPort=25565
$propertiesPath=${powerShellQuote(remoteJoin(minecraftServer.path, 'server.properties'))}
if (Test-Path -LiteralPath $propertiesPath) {
  $portLine=Get-Content -LiteralPath $propertiesPath -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*server-port\s*=' } | Select-Object -Last 1
  if ($portLine -match '=\s*(\d+)\s*$') { $serverPort=[int]$matches[1] }
}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $serverPort -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $listenerPids=@($listeners | ForEach-Object { [int]$_.OwningProcess })
  $candidates=@($candidates | Where-Object { $listenerPids -contains [int]$_.ProcessId })
}
[Console]::Out.Write($(if ($candidates.Count -eq 1) { 'external' } else { 'stopped' }))`
  const output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script))
  const state = output.replace(/\0/g, '').trim()
  return state === 'running' || state === 'external' ? state : 'stopped'
}

async function prepareRemoteRuntime(server: StoredRemoteServer, minecraftServer: RemoteMinecraftServer): Promise<void> {
  const paths = runtimePaths(minecraftServer)
  const control: MinecraftControlDescriptor = server.os !== 'windows'
    ? { version: 1, transport: 'fifo', logPath: paths.logPath, inputPath: paths.inputPath }
    : { version: 1, transport: 'named-pipe', logPath: paths.logPath, pipeName: paths.pipeName }
  await withSftp(server, async sftp => {
    const directory = await inspectMinecraftDirectory(sftp, server.os, minecraftServer.path)
    if (!directory.jarFiles.includes(minecraftServer.jarName)) throw new Error(`找不到服务端 JAR：${minecraftServer.jarName}`)
    await sftpMkdir(sftp, paths.runtimeDirectory)
    await sftpWriteText(sftp, paths.controlPath, `${JSON.stringify(control, null, 2)}\n`)
    await sftpWriteText(sftp, remoteJoin(minecraftServer.path, 'eula.txt'), [
      '# Generated by Minecraft Server Tools',
      '# https://aka.ms/MinecraftEULA',
      'eula=true',
      '',
    ].join('\n'))
    const marker = `\n[MST] ===== 远程会话 ${new Date().toISOString()} =====\n[MST] 启动 ${minecraftServer.jarName}，最大内存 ${minecraftServer.maxRam} MB\n`
    await sftpAppendText(sftp, paths.logPath, marker)
    if (server.os === 'windows') await sftpWriteText(sftp, paths.runnerPath, WINDOWS_RUNNER_SCRIPT)
  })
  remoteControlCache.set(remoteControlCacheKey(server, minecraftServer), {
    expiresAt: Date.now() + 5000,
    value: control,
  })
}

async function startMinecraftServer(server: StoredRemoteServer, minecraftServer: RemoteMinecraftServer): Promise<void> {
  const currentStatus = await getMinecraftStatus(server, minecraftServer)
  if (currentStatus === 'running') return
  if (currentStatus === 'external') throw new Error('检测到该目录的 Minecraft 服务器已由外部进程启动')
  await prepareRemoteRuntime(server, minecraftServer)
  const paths = runtimePaths(minecraftServer)
  if (server.os === 'linux') {
    const script = `set -eu
directory=${posixQuote(minecraftServer.path)}
runtime=${posixQuote(paths.runtimeDirectory)}
pid_file=${posixQuote(paths.pidPath)}
input_file=${posixQuote(paths.inputPath)}
log_file=${posixQuote(paths.logPath)}
jar_name=${posixQuote(minecraftServer.jarName)}
rm -f "$input_file"
mkfifo "$input_file"
cd "$directory"
nohup setsid sh -c 'fifo=$1; shift; exec 3<> "$fifo"; "$@" <&3; result=$?; exec 3>&-; rm -f "$fifo"; exit "$result"' mcstools "$input_file" java ${posixQuote(`-Xmx${minecraftServer.maxRam}M`)} -jar "$jar_name" nogui >> "$log_file" 2>&1 &
pid=$!
printf '%s' "$pid" > "$pid_file"
sleep 1
kill -0 "$pid" 2>/dev/null`
    await runStoredCommand(server, 'sh -s', script)
    return
  }
  if (server.os === 'macos') {
    const script = `set -eu
directory=${posixQuote(minecraftServer.path)}
pid_file=${posixQuote(paths.pidPath)}
input_file=${posixQuote(paths.inputPath)}
log_file=${posixQuote(paths.logPath)}
jar_name=${posixQuote(minecraftServer.jarName)}
rm -f "$pid_file" "$input_file"
mkfifo "$input_file"
cd "$directory"
nohup sh -c 'fifo=$1; shift; exec 3<> "$fifo"; exec "$@" <&3' mcstools "$input_file" java ${posixQuote(`-Xmx${minecraftServer.maxRam}M`)} -jar "$jar_name" nogui >> "$log_file" 2>&1 &
pid=$!
printf '%s' "$pid" > "$pid_file"
sleep 1
kill -0 "$pid" 2>/dev/null`
    await runStoredCommand(server, 'sh -s', script)
    return
  }
  const runnerInvocation = `& ${powerShellQuote(paths.runnerPath)} -WorkingDirectory ${powerShellQuote(minecraftServer.path)} -JarName ${powerShellQuote(minecraftServer.jarName)} -MaxRam ${minecraftServer.maxRam} -PipeName ${powerShellQuote(paths.pipeName)} -LogPath ${powerShellQuote(paths.logPath)} -PidPath ${powerShellQuote(paths.pidPath)}`
  const encodedInvocation = Buffer.from(runnerInvocation, 'utf16le').toString('base64')
  const script = `$pidPath=${powerShellQuote(paths.pidPath)}; Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue; Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedInvocation}') -WindowStyle Hidden; for ($i=0; $i -lt 30 -and -not (Test-Path -LiteralPath $pidPath); $i++) { Start-Sleep -Milliseconds 200 }; if (-not (Test-Path -LiteralPath $pidPath)) { throw 'Java 进程未能启动，请检查远程日志和 Java 环境' }`
  await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
}

async function sendMinecraftCommand(
  server: StoredRemoteServer,
  minecraftServer: RemoteMinecraftServer,
  rawCommand: string,
): Promise<void> {
  const command = typeof rawCommand === 'string' ? rawCommand.trim() : ''
  if (!command || command.length > 4096 || /[\r\n]/.test(command)) throw new Error('Minecraft 命令无效')
  if (await getMinecraftStatus(server, minecraftServer) !== 'running') throw new Error('远程 Minecraft 服务器当前没有可用的控制通道')
  const paths = runtimePaths(minecraftServer)
  const control = await readRemoteMinecraftControl(server, minecraftServer)
  if (control?.transport === 'command-file') {
    await withSftp(server, sftp => sftpAppendText(
      sftp,
      control.commandPath!,
      createManagedControlRecord(control, 'stdin', command),
    ))
    return
  }
  if (server.os !== 'windows') {
    const inputPath = control?.transport === 'fifo' ? control.inputPath! : paths.inputPath
    const script = `printf '%s\\n' ${posixQuote(command)} > ${posixQuote(inputPath)}`
    await runStoredCommand(server, 'sh -c ' + posixQuote(script), '', 10000)
    return
  }
  const pipeName = control?.transport === 'named-pipe' ? control.pipeName! : paths.pipeName
  const script = `$pipe=[System.IO.Pipes.NamedPipeClientStream]::new('.',${powerShellQuote(pipeName)},[System.IO.Pipes.PipeDirection]::Out); try { $pipe.Connect(5000); $writer=[System.IO.StreamWriter]::new($pipe,[System.Text.UTF8Encoding]::new($false)); $writer.Write(${powerShellQuote(command)}); $writer.Flush(); $writer.Dispose() } finally { $pipe.Dispose() }`
  await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 10000)
}

async function stopMinecraftServer(
  server: StoredRemoteServer,
  minecraftServer: RemoteMinecraftServer,
  force: boolean,
): Promise<void> {
  if (await getMinecraftStatus(server, minecraftServer) !== 'running') return
  if (!force) {
    const control = await readRemoteMinecraftControl(server, minecraftServer)
    if (control?.transport === 'command-file') {
      await withSftp(server, sftp => sftpAppendText(
        sftp,
        control.commandPath!,
        createManagedControlRecord(control, 'stop'),
      ))
    } else {
      await sendMinecraftCommand(server, minecraftServer, 'stop')
    }
    return
  }
  const paths = runtimePaths(minecraftServer)
  if (server.os === 'linux') {
    const script = `pid_file=${posixQuote(paths.pidPath)}\npid=$(cat "$pid_file" 2>/dev/null || true)\nif [ -n "$pid" ] && [ "$pid" -eq "$pid" ] 2>/dev/null; then kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; sleep 2; kill -KILL -- -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true; fi\nrm -f "$pid_file" ${posixQuote(paths.inputPath)}`
    await runStoredCommand(server, 'sh -s', script)
    return
  }
  if (server.os === 'macos') {
    const script = `pid_file=${posixQuote(paths.pidPath)}
input_file=${posixQuote(paths.inputPath)}
pid=$(cat "$pid_file" 2>/dev/null || true)
if [ -n "$pid" ] && [ "$pid" -eq "$pid" ] 2>/dev/null; then
  kill -TERM "$pid" 2>/dev/null || true
  attempts=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do sleep 0.1; attempts=$((attempts + 1)); done
  kill -KILL "$pid" 2>/dev/null || true
fi
rm -f "$pid_file" "$input_file"`
    await runStoredCommand(server, 'sh -s', script)
    return
  }
  const script = `$pidPath=${powerShellQuote(paths.pidPath)}; if (Test-Path -LiteralPath $pidPath) { $pidValue=Get-Content -LiteralPath $pidPath -Raw; if ($pidValue -match '^\\d+$') { & taskkill.exe /PID $pidValue /T /F | Out-Null }; Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue }`
  await runStoredCommand(server, encodeWindowsPowerShellCommand(script))
}

async function readMinecraftLogs(server: StoredRemoteServer, minecraftServer: RemoteMinecraftServer): Promise<string[]> {
  const paths = runtimePaths(minecraftServer)
  const control = await readRemoteMinecraftControl(server, minecraftServer)
  const managedLogPath = control?.logPath || paths.logPath
  const latestLogPath = remoteJoin(minecraftServer.path, 'logs', 'latest.log')
  try {
    let output: string
    if (server.os !== 'windows') {
      const script = String.raw`pid_file=${posixQuote(paths.pidPath)}
managed_log=${posixQuote(managedLogPath)}
latest_log=${posixQuote(latestLogPath)}
selected_log="$managed_log"
managed_running=false
if [ -f "$pid_file" ]; then
  pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then managed_running=true; fi
fi
if [ "$managed_running" = true ] && [ -f "$managed_log" ]; then
  selected_log="$managed_log"
elif [ -f "$latest_log" ] && { [ ! -f "$managed_log" ] || [ "$latest_log" -nt "$managed_log" ]; }; then
  selected_log="$latest_log"
fi
if [ -f "$selected_log" ]; then tail -n 500 "$selected_log"; fi`
      output = await runStoredCommand(server, 'sh -s', script)
    } else {
      const script = String.raw`$pidPath=${powerShellQuote(paths.pidPath)}
$managedLog=${powerShellQuote(managedLogPath)}
$latestLog=${powerShellQuote(latestLogPath)}
$managedRunning=$false
if (Test-Path -LiteralPath $pidPath) {
  $pidValue=Get-Content -LiteralPath $pidPath -Raw -ErrorAction SilentlyContinue
  $managedRunning=$pidValue -match '^\d+$' -and $null -ne (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue)
}
$selectedLog=$managedLog
if (-not ($managedRunning -and (Test-Path -LiteralPath $managedLog)) -and (Test-Path -LiteralPath $latestLog)) {
  if (-not (Test-Path -LiteralPath $managedLog) -or (Get-Item -LiteralPath $latestLog).LastWriteTimeUtc -gt (Get-Item -LiteralPath $managedLog).LastWriteTimeUtc) { $selectedLog=$latestLog }
}
if (Test-Path -LiteralPath $selectedLog) { Get-Content -LiteralPath $selectedLog -Tail 500 -Encoding UTF8 }`
      output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script))
    }
    return output.replace(/\0/g, '').split(/\r?\n/).filter(Boolean).slice(-500)
  } catch {
    return []
  }
}

async function collectMetrics(
  target: Pick<RemoteServerSummary, 'host' | 'port' | 'username' | 'os'>,
  password: string,
  expectedFingerprint?: string,
): Promise<{ metrics: RemoteServerMetrics; fingerprint: string }> {
  const isWindows = target.os === 'windows'
  const metricsScript = target.os === 'macos' ? MACOS_METRICS_SCRIPT : LINUX_METRICS_SCRIPT
  const result = await executeRemote(
    target,
    password,
    expectedFingerprint,
    isWindows ? encodeWindowsPowerShellCommand(WINDOWS_METRICS_SCRIPT) : 'sh -s',
    isWindows ? '' : metricsScript,
  )
  return {
    metrics: isWindows ? parseWindowsMetrics(result.stdout) : parsePosixMetrics(result.stdout, target.os === 'macos' ? 'macos' : 'linux'),
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
      minecraftServers: [],
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

  listMinecraftServers(remoteServerId: string): RemoteMinecraftServer[] {
    return findStoredServer(remoteServerId).minecraftServers
  }

  async findMinecraftDirectories(remoteServerId: string): Promise<RemoteMinecraftDirectory[]> {
    return findMinecraftDirectories(findStoredServer(remoteServerId))
  }

  async inspectMinecraftDirectory(remoteServerId: string, remotePath: string): Promise<RemoteMinecraftDirectory> {
    const server = findStoredServer(remoteServerId)
    return withSftp(server, sftp => inspectMinecraftDirectory(sftp, server.os, remotePath))
  }

  async browseDirectory(remoteServerId: string, remotePath?: string): Promise<RemoteDirectoryListing> {
    return browseRemoteDirectory(findStoredServer(remoteServerId), remotePath)
  }

  async addMinecraftServer(
    remoteServerId: string,
    rawInput: RemoteMinecraftServerInput,
  ): Promise<RemoteMinecraftServer> {
    const host = findStoredServer(remoteServerId)
    const inspected = await withSftp(host, sftp => inspectMinecraftDirectory(sftp, host.os, String(rawInput?.path || '')))
    const jarName = validateRemoteJarName(rawInput?.jarName || inspected.suggestedJar)
    if (!inspected.jarFiles.includes(jarName)) throw new Error(`所选目录中没有 ${jarName}`)
    const coreType = typeof rawInput?.coreType === 'string' ? rawInput.coreType.trim() : ''
    const version = typeof rawInput?.version === 'string' ? rawInput.version.trim() : ''
    const remark = typeof rawInput?.remark === 'string' ? rawInput.remark.trim() : ''
    const maxRam = Number(rawInput?.maxRam ?? 2048)
    if (!coreType || coreType.length > 100) throw new Error('请填写有效的服务端类型')
    if (!version || version.length > 100) throw new Error('请填写有效的 Minecraft 版本')
    if (!remark || remark.length > 500) throw new Error('请填写 1 至 500 个字符的备注')
    if (!Number.isInteger(maxRam) || maxRam < 512 || maxRam > 131072) throw new Error('服务器内存设置无效')
    const normalizedPath = inspected.path.toLowerCase()
    if (host.minecraftServers.some(item => item.path.toLowerCase() === normalizedPath)) throw new Error('该 Minecraft 服务器目录已经添加')
    const minecraftServer: RemoteMinecraftServer = {
      id: randomUUID(),
      name: inspected.name,
      path: inspected.path,
      jarName,
      coreType,
      version,
      remark,
      maxRam,
      createdAt: new Date().toISOString(),
    }
    const current = readStoredServers()
    writeStoredServers(current.map(item => item.id === remoteServerId
      ? { ...item, minecraftServers: [...item.minecraftServers, minecraftServer] }
      : item))
    return minecraftServer
  }

  removeMinecraftServer(remoteServerId: string, minecraftServerId: string): void {
    const host = findStoredServer(remoteServerId)
    if (!host.minecraftServers.some(item => item.id === minecraftServerId)) return
    const current = readStoredServers()
    writeStoredServers(current.map(item => item.id === remoteServerId
      ? { ...item, minecraftServers: item.minecraftServers.filter(server => server.id !== minecraftServerId) }
      : item))
  }

  updateMinecraftServer(remoteServerId: string, minecraftServerId: string, maxRam: number): RemoteMinecraftServer {
    const host = findStoredServer(remoteServerId)
    const existing = host.minecraftServers.find(item => item.id === minecraftServerId)
    if (!existing) throw new Error('Minecraft 服务器不存在或已被移除')
    const normalizedMaxRam = Number(maxRam)
    if (!Number.isInteger(normalizedMaxRam) || normalizedMaxRam < 512 || normalizedMaxRam > 131072) {
      throw new Error('服务器内存设置无效')
    }
    const updated = { ...existing, maxRam: normalizedMaxRam }
    const current = readStoredServers()
    writeStoredServers(current.map(item => item.id === remoteServerId
      ? { ...item, minecraftServers: item.minecraftServers.map(server => server.id === minecraftServerId ? updated : server) }
      : item))
    return updated
  }

  async getMinecraftServerStatus(remoteServerId: string, minecraftServerId: string): Promise<RemoteMinecraftServerStatus> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    return getMinecraftStatus(host, minecraftServer)
  }

  async getMinecraftServerLogs(remoteServerId: string, minecraftServerId: string): Promise<string[]> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    return readMinecraftLogs(host, minecraftServer)
  }

  async startMinecraftServer(remoteServerId: string, minecraftServerId: string, maxRam: number): Promise<void> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    const normalizedMaxRam = Number(maxRam)
    if (!Number.isInteger(normalizedMaxRam) || normalizedMaxRam < 512 || normalizedMaxRam > 131072) {
      throw new Error('服务器内存设置无效')
    }
    const updated = { ...minecraftServer, maxRam: normalizedMaxRam }
    await startMinecraftServer(host, updated)
    const current = readStoredServers()
    writeStoredServers(current.map(item => item.id === remoteServerId
      ? { ...item, minecraftServers: item.minecraftServers.map(server => server.id === minecraftServerId ? updated : server) }
      : item))
  }

  async stopMinecraftServer(remoteServerId: string, minecraftServerId: string, force = false): Promise<void> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    await stopMinecraftServer(host, minecraftServer, force)
  }

  async sendMinecraftServerCommand(remoteServerId: string, minecraftServerId: string, command: string): Promise<void> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    await sendMinecraftCommand(host, minecraftServer, command)
  }

  async readMinecraftServerProperties(remoteServerId: string, minecraftServerId: string): Promise<string> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    return withSftp(host, sftp => sftpReadText(sftp, remoteJoin(minecraftServer.path, 'server.properties')))
  }

  async writeMinecraftServerProperties(remoteServerId: string, minecraftServerId: string, content: string): Promise<void> {
    const { host, minecraftServer } = findMinecraftServer(remoteServerId, minecraftServerId)
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_REMOTE_FILE_BYTES) {
      throw new Error('server.properties 内容无效或过大')
    }
    await withSftp(host, sftp => sftpWriteText(sftp, remoteJoin(minecraftServer.path, 'server.properties'), content))
  }
}
