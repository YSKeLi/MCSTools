import { app, safeStorage, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Client, type ConnectConfig, type FileEntryWithStats, type SFTPWrapper } from 'ssh2'
import { getCoreDownloadArtifact, type CoreDownloadArtifact } from '../core'
import { detectServerFiles } from '../detect'
import { downloadFile } from '../utils/download'
import { readJsonStore, writeJsonStore } from '../utils/jsonStore'
import {
  type MinecraftControlDescriptor,
  createManagedControlRecord,
  parseMinecraftControlDescriptor,
} from '../server/minecraftControlProtocol'
import { normalizeRemotePath, parseRemoteServerProfile, remoteBaseName, remoteJoin, remoteParentPath, validateRemoteJarName, validateRemoteLaunchSpec } from './remoteMinecraftPolicy'
import {
  classifyRemoteCoreArtifact,
  deploymentRequiresJava,
  normalizeRemoteDeploymentInput,
  remoteArtifactCompatibilityWarning,
  requiredDeploymentJavaMajor,
  serializeRemoteDeploymentProfile,
} from './deploymentPolicy'
import {
  prepareRemoteDeploymentArchive,
  selectDeploymentLaunch,
  sha256File,
  type PreparedArchiveDeployment,
} from './deploymentArtifacts'
import { parsePosixMetrics } from './posixMetricsProtocol'
import { normalizeRemoteAuthInput } from './remoteAuthPolicy'
import type {
  RemoteDirectoryListing,
  RemoteDeploymentArtifactKind,
  RemoteDeploymentInput,
  RemoteDeploymentJob,
  RemoteDeploymentPhase,
  RemoteDeploymentPreflight,
  RemoteFileBrowserItem,
  RemoteMinecraftDirectory,
  RemoteMinecraftLaunchSpec,
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
  encryptedPassword?: string
  encryptedPrivateKey?: string
  encryptedPassphrase?: string
  minecraftServers: RemoteMinecraftServer[]
}

export type RemoteSshAuth = Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase' | 'tryKeyboard'>

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
const REMOTE_DEPLOYMENT_MARKER_FILE = '.mcstools-managed.json'
const MAX_REMOTE_FILE_BYTES = 2 * 1024 * 1024
const MAX_REMOTE_PROFILE_BYTES = 64 * 1024
const SFTP_OPERATION_TIMEOUT_MS = 20000
const SFTP_UPLOAD_INACTIVITY_TIMEOUT_MS = 45000
const TERMINAL_DEPLOYMENT_PHASES = new Set<RemoteDeploymentPhase>(['completed', 'failed', 'cancelled'])
const REMOTE_DEPLOYMENT_PHASES = new Set<RemoteDeploymentPhase>([
  'queued', 'preflight', 'downloading', 'uploading', 'verifying', 'installing',
  'configuring', 'registering', 'starting', 'completed', 'failed', 'cancelled',
])

const WINDOWS_RUNNER_SCRIPT = String.raw`param(
  [Parameter(Mandatory=$true)][string]$WorkingDirectory,
  [Parameter(Mandatory=$true)][ValidateSet('jar','java-args','native')][string]$LaunchKind,
  [Parameter(Mandatory=$true)][string]$LaunchTarget,
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
function Resolve-JavaExecutable {
  if ($env:JAVA_HOME) {
    $javaHomeCandidate = Join-Path $env:JAVA_HOME 'bin\java.exe'
    if (Test-Path -LiteralPath $javaHomeCandidate -PathType Leaf) {
      return [System.IO.Path]::GetFullPath($javaHomeCandidate)
    }
  }
  $javaCommand = Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($javaCommand) { return $javaCommand.Source }
  throw '未找到 Java。请将 java.exe 加入 PATH，或在远程主机上正确设置 JAVA_HOME。'
}
try {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.WorkingDirectory = $WorkingDirectory
  $escapedTarget = $LaunchTarget.Replace('"', '\"')
  if ($LaunchKind -eq 'jar') {
    $psi.FileName = Resolve-JavaExecutable
    $psi.Arguments = ('-Xmx{0}M -jar "{1}" nogui' -f $MaxRam, $escapedTarget)
  } elseif ($LaunchKind -eq 'java-args') {
    $psi.FileName = Resolve-JavaExecutable
    $psi.Arguments = ('-Xmx{0}M "@{1}" nogui' -f $MaxRam, $escapedTarget)
  } else {
    $psi.FileName = Join-Path $WorkingDirectory $LaunchTarget
    $psi.Arguments = ''
  }
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

function deploymentStorePath(): string {
  return path.join(app.getPath('userData'), 'remote-deployments.json')
}

function normalizeMinecraftServer(item: any): RemoteMinecraftServer | null {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null
  const remotePath = typeof item.path === 'string' ? item.path.trim() : ''
  const jarName = typeof item.jarName === 'string' ? item.jarName.trim() : ''
  if (!remotePath || !jarName) return null
  let launch: RemoteMinecraftLaunchSpec
  try {
    launch = validateRemoteLaunchSpec(item.launch, jarName)
  } catch {
    return null
  }
  const maxRam = Number(item.maxRam)
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : remoteBaseName(remotePath),
    path: remotePath,
    jarName,
    launch,
    coreType: typeof item.coreType === 'string' && item.coreType.trim() ? item.coreType.trim() : '未知',
    version: typeof item.version === 'string' && item.version.trim() ? item.version.trim() : '未知',
    remark: typeof item.remark === 'string' ? item.remark.trim() : '',
    maxRam: Number.isInteger(maxRam) && maxRam >= 512 && maxRam <= 131072 ? maxRam : 2048,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
  }
}

function normalizeStoredServer(item: any): StoredRemoteServer | null {
  if (!item || typeof item !== 'object') return null
  if (typeof item.id !== 'string') return null
  if (item.os !== 'linux' && item.os !== 'windows' && item.os !== 'macos') return null
  const hasPassword = typeof item.encryptedPassword === 'string' && item.encryptedPassword.length > 0
  const hasPrivateKey = typeof item.encryptedPrivateKey === 'string' && item.encryptedPrivateKey.length > 0
  if (!hasPassword && !hasPrivateKey) return null
  const authType = item.authType === 'private-key' && hasPrivateKey ? 'private-key' : (hasPassword ? 'password' : 'private-key')
  const isLegacyWinRm = item.transport === 'winrm'
  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name : item.host || '未命名服务器',
    host: typeof item.host === 'string' ? item.host : '',
    port: isLegacyWinRm ? 22 : (Number.isInteger(Number(item.port)) ? Number(item.port) : 22),
    username: typeof item.username === 'string' ? item.username : '',
    os: item.os,
    authType,
    hostFingerprint: isLegacyWinRm ? '' : (typeof item.hostFingerprint === 'string' ? item.hostFingerprint : ''),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
    ...(hasPassword ? { encryptedPassword: item.encryptedPassword } : {}),
    ...(hasPrivateKey ? { encryptedPrivateKey: item.encryptedPrivateKey } : {}),
    ...(typeof item.encryptedPassphrase === 'string' && item.encryptedPassphrase
      ? { encryptedPassphrase: item.encryptedPassphrase }
      : {}),
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
  const {
    encryptedPassword: _encryptedPassword,
    encryptedPrivateKey: _encryptedPrivateKey,
    encryptedPassphrase: _encryptedPassphrase,
    minecraftServers: _minecraftServers,
    ...safeServer
  } = server
  return safeServer
}

function assertSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全凭据存储，无法保存服务器登录凭据')
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('当前 Linux 系统未配置安全密钥环，无法保存服务器登录凭据')
  }
}

function validateInput(input: RemoteServerInput): RemoteServerInput {
  const value = {
    name: typeof input?.name === 'string' ? input.name.trim() : '',
    host: typeof input?.host === 'string' ? input.host.trim() : '',
    port: Number(input?.port),
    username: typeof input?.username === 'string' ? input.username.trim() : '',
    ...normalizeRemoteAuthInput(input),
    os: input?.os,
    expectedFingerprint: typeof input?.expectedFingerprint === 'string' ? input.expectedFingerprint : '',
  }
  if (!value.name || value.name.length > 100) throw new Error('请输入有效的服务器名称')
  if (!value.host || value.host.length > 255 || /\s/.test(value.host)) throw new Error('请输入有效的服务器地址')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('SSH 端口无效')
  if (!value.username || value.username.length > 128 || /[\r\n]/.test(value.username)) throw new Error('请输入有效的登录账户')
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

function decryptSecret(value: string | undefined, errorMessage: string): string {
  assertSafeStorage()
  if (!value) throw new Error(errorMessage)
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    throw new Error(errorMessage)
  }
}

function storedSshAuth(server: StoredRemoteServer): RemoteSshAuth {
  if (server.authType === 'private-key') {
    const passphrase = server.encryptedPassphrase
      ? decryptSecret(server.encryptedPassphrase, '私钥口令无法解密，请删除后重新添加该服务器')
      : undefined
    return {
      privateKey: decryptSecret(server.encryptedPrivateKey, '服务器私钥无法解密，请删除后重新添加该服务器'),
      ...(passphrase ? { passphrase } : {}),
      tryKeyboard: false,
    }
  }
  return {
    password: decryptSecret(server.encryptedPassword, '服务器密码无法解密，请删除后重新添加该服务器'),
    tryKeyboard: true,
  }
}

function inputSshAuth(input: RemoteServerInput): RemoteSshAuth {
  if (input.authType === 'private-key') {
    return {
      privateKey: input.privateKey,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
      tryKeyboard: false,
    }
  }
  return { password: input.password, tryKeyboard: true }
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

export function executeRemote(
  target: Pick<RemoteServerSummary, 'host' | 'port' | 'username' | 'os'>,
  auth: RemoteSshAuth,
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
        complete(prompts.map(() => auth.password || ''))
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
        ...auth,
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
    const auth = storedSshAuth(server)
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
        complete(prompts.map(() => auth.password || ''))
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
        ...auth,
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
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('写入远程文件超时'))
    }, SFTP_OPERATION_TIMEOUT_MS)
    sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpAppendText(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('追加远程文件超时'))
    }, SFTP_OPERATION_TIMEOUT_MS)
    sftp.appendFile(remotePath, Buffer.from(content, 'utf8'), error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error('创建远程目录超时')), SFTP_OPERATION_TIMEOUT_MS)
    sftp.mkdir(remotePath, error => {
      if (settled) return
      if (!error) return finish()
      sftp.stat(remotePath, (statError, stats) => {
        if (settled) return
        if (!statError && stats.isDirectory()) finish()
        else finish(error)
      })
    })
  })
}

function sftpUploadFile(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  onProgress: (transferred: number, total: number) => void,
): Promise<void> {
  const total = fs.statSync(localPath).size
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const armTimeout = () => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('上传远程文件超时')), SFTP_UPLOAD_INACTIVITY_TIMEOUT_MS)
    }
    armTimeout()
    sftp.fastPut(localPath, remotePath, {
      step: (transferred) => {
        if (settled) return
        armTimeout()
        onProgress(transferred, total)
      },
    }, error => error ? finish(error) : finish())
  })
}

function sftpStatFile(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('检查远程文件超时'))
    }, SFTP_OPERATION_TIMEOUT_MS)
    sftp.stat(remotePath, (error, stats) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) return reject(error)
      if (!stats.isFile()) return reject(new Error('远程启动目标不是文件'))
      resolve()
    })
  })
}

async function uploadPreparedArchive(
  server: StoredRemoteServer,
  stagingPath: string,
  payload: PreparedArchiveDeployment,
  onProgress: (transferred: number, total: number) => void,
  assertNotCancelled: () => void,
): Promise<void> {
  const total = payload.files.reduce((sum, file) => sum + file.size, 0)
  let completed = 0
  await withSftp(server, async sftp => {
    for (const relativePath of payload.directories) {
      assertNotCancelled()
      await sftpMkdir(sftp, remoteJoin(stagingPath, relativePath))
    }
    for (const file of payload.files) {
      assertNotCancelled()
      await sftpUploadFile(sftp, file.localPath, remoteJoin(stagingPath, file.relativePath), transferred => {
        onProgress(completed + transferred, total)
      })
      completed += file.size
      onProgress(completed, total)
    }
  })
}

async function verifyRemoteDeploymentPayload(
  server: StoredRemoteServer,
  stagingPath: string,
  payload: PreparedArchiveDeployment,
  localDirectory: string,
): Promise<void> {
  const rows: string[] = []
  for (const file of payload.files) rows.push(`${await sha256File(file.localPath)}\t${file.relativePath}`)
  const localManifestPath = path.join(localDirectory, 'upload-manifest.tsv')
  const remoteManifestPath = remoteJoin(stagingPath, '.mcstools-upload-manifest.tsv')
  fs.writeFileSync(localManifestPath, `${rows.join('\n')}\n`, 'utf8')
  await withSftp(server, sftp => sftpUploadFile(sftp, localManifestPath, remoteManifestPath, () => undefined))

  if (server.os === 'windows') {
    const script = `$root=${powerShellQuote(stagingPath)}
$manifest=${powerShellQuote(remoteManifestPath)}
foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
  if (-not $line) { continue }
  $parts=$line -split "\`t",2
  if ($parts.Count -ne 2) { throw '部署校验清单格式无效' }
  $file=Join-Path $root ($parts[1].Replace('/','\\'))
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('远程文件缺失: ' + $parts[1]) }
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
  if ($actual -ne $parts[0]) { throw ('远程文件校验失败: ' + $parts[1]) }
}
Remove-Item -LiteralPath $manifest -Force`
    await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 10 * 60 * 1000)
    return
  }

  const script = `set -eu
root=${posixQuote(stagingPath)}
manifest=${posixQuote(remoteManifestPath)}
tab=$(printf '\\t')
while IFS="$tab" read -r expected relative; do
  [ -n "$expected" ] || continue
  file="$root/$relative"
  [ -f "$file" ] || { printf '远程文件缺失: %s\\n' "$relative" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum -- "$file" | awk '{print $1}'); else actual=$(shasum -a 256 -- "$file" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { printf '远程文件校验失败: %s\\n' "$relative" >&2; exit 1; }
done < "$manifest"
rm -f -- "$manifest"`
  await runStoredCommand(server, 'sh -s', script, 10 * 60 * 1000)
}

async function discoverRemoteDeploymentLaunch(
  server: StoredRemoteServer,
  stagingPath: string,
  coreId: string,
): Promise<RemoteMinecraftLaunchSpec> {
  let output: string
  if (server.os === 'windows') {
    const script = `$root=[System.IO.Path]::GetFullPath(${powerShellQuote(stagingPath)}).TrimEnd('\\')
$paths=[System.Collections.Generic.List[string]]::new()
Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'win_args.txt' | ForEach-Object { $paths.Add($_.FullName.Substring($root.Length).TrimStart('\\').Replace('\\','/')) }
Get-ChildItem -LiteralPath $root -File -Filter '*.jar' | ForEach-Object { $paths.Add($_.Name) }
$paths | Select-Object -Unique | ForEach-Object { [Console]::Out.WriteLine($_) }`
    output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 60000)
  } else {
    const argsName = 'unix_args.txt'
    const script = `set -eu
cd ${posixQuote(stagingPath)}
find . -type f -name ${posixQuote(argsName)} -print
find . -maxdepth 2 -type f -name '*.jar' -print`
    output = await runStoredCommand(server, 'sh -s', script, 60000)
  }
  const relativePaths = [...new Set(output.split(/\r?\n/)
    .map(value => value.trim().replace(/^\.\//, '').replace(/\\/g, '/'))
    .filter(Boolean))]
  return validateRemoteLaunchSpec(selectDeploymentLaunch(relativePaths, server.os, coreId))
}

async function runRemoteCoreInstaller(
  server: StoredRemoteServer,
  stagingPath: string,
  installerName: string,
  coreId: string,
  version: string,
): Promise<RemoteMinecraftLaunchSpec> {
  const installerPath = remoteJoin(stagingPath, installerName)
  const isQuilt = coreId.trim().toLowerCase() === 'quilt'
  if (server.os === 'windows') {
    const installerArguments = isQuilt
      ? `@('-jar',${powerShellQuote(installerPath)},'install','server',${powerShellQuote(version)},'--install-dir=.','--download-server','--create-scripts')`
      : `@('-jar',${powerShellQuote(installerPath)},'--installServer')`
    const script = `$javaPath=$null
if ($env:JAVA_HOME) { $candidate=Join-Path $env:JAVA_HOME 'bin\\java.exe'; if (Test-Path -LiteralPath $candidate -PathType Leaf) { $javaPath=$candidate } }
if (-not $javaPath) { $javaCommand=Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($javaCommand) { $javaPath=$javaCommand.Source } }
if (-not $javaPath) { throw '未找到 Java' }
Set-Location -LiteralPath ${powerShellQuote(stagingPath)}
$arguments=${installerArguments}
& $javaPath @arguments
if ($LASTEXITCODE -ne 0) { throw ('核心安装器退出，代码 ' + $LASTEXITCODE) }`
    await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 15 * 60 * 1000)
  } else {
    const installCommand = isQuilt
      ? `java -jar ${posixQuote(installerName)} install server ${posixQuote(version)} --install-dir=. --download-server --create-scripts`
      : `java -jar ${posixQuote(installerName)} --installServer`
    const script = `set -eu
cd ${posixQuote(stagingPath)}
${installCommand}`
    await runStoredCommand(server, 'sh -s', script, 15 * 60 * 1000)
  }
  const launch = await discoverRemoteDeploymentLaunch(server, stagingPath, coreId)
  if (server.os === 'windows') {
    await runStoredCommand(server, encodeWindowsPowerShellCommand(`Remove-Item -LiteralPath ${powerShellQuote(installerPath)} -Force -ErrorAction SilentlyContinue`))
  } else {
    await runStoredCommand(server, 'sh -s', `rm -f -- ${posixQuote(installerPath)}`)
  }
  return launch
}

async function makeRemoteLaunchExecutable(
  server: StoredRemoteServer,
  stagingPath: string,
  launch: RemoteMinecraftLaunchSpec,
): Promise<void> {
  if (launch.kind !== 'native' || server.os === 'windows') return
  await runStoredCommand(server, 'sh -s', `chmod u+x -- ${posixQuote(remoteJoin(stagingPath, launch.target))}`)
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

function posixMinecraftLaunchCommand(minecraftServer: RemoteMinecraftServer): string {
  const maxRam = posixQuote(`-Xmx${minecraftServer.maxRam}M`)
  if (minecraftServer.launch.kind === 'jar') {
    return `java ${maxRam} -jar ${posixQuote(minecraftServer.launch.target)} nogui`
  }
  if (minecraftServer.launch.kind === 'java-args') {
    return `java ${maxRam} ${posixQuote(`@${minecraftServer.launch.target}`)} nogui`
  }
  return posixQuote(`./${minecraftServer.launch.target}`)
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
    storedSshAuth(server),
    server.hostFingerprint || undefined,
    command,
    input,
    timeoutMs,
  )
  return result.stdout
}

function deploymentJavaMajor(versionLine: string): number | null {
  const match = versionLine.match(/version\s+"(?:1\.)?(\d+)/i)
    || versionLine.match(/(?:^|\s)(?:1\.)?(\d+)(?:[._+-]|$)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizedRemoteArchitecture(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (['x86_64', 'amd64', 'x64'].includes(normalized)) return 'x64'
  if (['aarch64', 'arm64'].includes(normalized)) return 'arm64'
  return normalized || 'unknown'
}

function parseDeploymentProbe(output: string): {
  architecture: string
  availableBytes: number
  targetExists: boolean
  parentWritable: boolean
  portInUse: boolean
  javaMajor: number | null
} {
  const values = new Map<string, string>()
  for (const line of output.replace(/\0/g, '').split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const booleanValue = (key: string) => values.get(key)?.toLowerCase() === 'true'
  const availableBytes = Number(values.get('available_bytes'))
  return {
    architecture: normalizedRemoteArchitecture(values.get('architecture') || ''),
    availableBytes: Number.isSafeInteger(availableBytes) && availableBytes >= 0 ? availableBytes : 0,
    targetExists: booleanValue('target_exists'),
    parentWritable: booleanValue('parent_writable'),
    portInUse: booleanValue('port_in_use'),
    javaMajor: deploymentJavaMajor(values.get('java_version') || ''),
  }
}

async function probeRemoteDeployment(
  server: StoredRemoteServer,
  input: RemoteDeploymentInput,
  artifact: CoreDownloadArtifact,
): Promise<RemoteDeploymentPreflight> {
  let output: string
  if (server.os === 'windows') {
    const script = String.raw`$target=${powerShellQuote(input.targetPath)}
$port=${input.serverPort}
$parent=[System.IO.Path]::GetDirectoryName($target)
$probe=$parent
while ($probe -and -not (Test-Path -LiteralPath $probe)) { $next=[System.IO.Path]::GetDirectoryName($probe); if ($next -eq $probe) { break }; $probe=$next }
$targetExists=Test-Path -LiteralPath $target
$parentWritable=$false
if ($probe -and (Test-Path -LiteralPath $probe -PathType Container)) {
  $probeFile=Join-Path $probe ('.mcstools-write-test-' + [guid]::NewGuid().ToString('N'))
  try { [System.IO.File]::WriteAllText($probeFile,'ok'); Remove-Item -LiteralPath $probeFile -Force; $parentWritable=$true } catch { Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue }
}
$available=0
try { $root=[System.IO.Path]::GetPathRoot($probe); $available=[System.IO.DriveInfo]::new($root).AvailableFreeSpace } catch {}
$javaPath=$null
if ($env:JAVA_HOME) { $candidate=Join-Path $env:JAVA_HOME 'bin\java.exe'; if (Test-Path -LiteralPath $candidate -PathType Leaf) { $javaPath=$candidate } }
if (-not $javaPath) { $javaCommand=Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($javaCommand) { $javaPath=$javaCommand.Source } }
$javaVersion=''
if ($javaPath) { $javaVersion=((& $javaPath -version 2>&1 | Select-Object -First 1) -join '').Replace([char]13,'').Replace([char]10,'') }
$portInUse=$null -ne (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1)
[Console]::Out.WriteLine('architecture=' + $env:PROCESSOR_ARCHITECTURE)
[Console]::Out.WriteLine('available_bytes=' + $available)
[Console]::Out.WriteLine('target_exists=' + $targetExists.ToString().ToLowerInvariant())
[Console]::Out.WriteLine('parent_writable=' + $parentWritable.ToString().ToLowerInvariant())
[Console]::Out.WriteLine('port_in_use=' + $portInUse.ToString().ToLowerInvariant())
[Console]::Out.WriteLine('java_version=' + $javaVersion)`
    output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
  } else {
    const script = String.raw`set -u
target=${posixQuote(input.targetPath)}
port=${input.serverPort}
parent=$(dirname -- "$target")
probe=$parent
while [ ! -e "$probe" ] && [ "$probe" != "/" ]; do probe=$(dirname -- "$probe"); done
target_exists=false
[ -e "$target" ] && target_exists=true
parent_writable=false
[ -d "$probe" ] && [ -w "$probe" ] && parent_writable=true
available_bytes=$(df -Pk "$probe" 2>/dev/null | awk 'NR==2 { printf "%.0f", $4 * 1024 }')
[ -n "$available_bytes" ] || available_bytes=0
java_version=''
if command -v java >/dev/null 2>&1; then java_version=$(java -version 2>&1 | sed -n '1p' | tr -d '\r\n'); fi
port_in_use=false
if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk -v suffix=":$port" 'NR > 1 { address=$4; if (length(address) >= length(suffix) && substr(address, length(address) - length(suffix) + 1) == suffix) found=1 } END { exit(found ? 0 : 1) }'; then port_in_use=true; fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then port_in_use=true; fi
fi
printf 'architecture=%s\n' "$(uname -m 2>/dev/null || printf unknown)"
printf 'available_bytes=%s\n' "$available_bytes"
printf 'target_exists=%s\n' "$target_exists"
printf 'parent_writable=%s\n' "$parent_writable"
printf 'port_in_use=%s\n' "$port_in_use"
printf 'java_version=%s\n' "$java_version"`
    output = await runStoredCommand(server, 'sh -s', script, 30000)
  }

  const probe = parseDeploymentProbe(output)
  const artifactKind = classifyRemoteCoreArtifact(artifact.coreId, artifact.fileName, artifact.url)
  const requiresJava = deploymentRequiresJava(input.coreId)
  const requiredJava = requiresJava ? requiredDeploymentJavaMajor(input.version) : 0
  const warnings: string[] = []
  if (probe.targetExists) warnings.push('目标目录已经存在')
  if (!probe.parentWritable) warnings.push('登录账户无法写入目标目录的上级位置')
  if (probe.availableBytes < 256 * 1024 * 1024) warnings.push('目标磁盘可用空间不足 256 MB')
  if (probe.portInUse) warnings.push(`端口 ${input.serverPort} 已被占用`)
  if (requiresJava && probe.javaMajor === null) warnings.push(`未找到 Java ${requiredJava} 或更高版本`)
  else if (requiresJava && probe.javaMajor !== null && probe.javaMajor < requiredJava) warnings.push(`当前 Java ${probe.javaMajor} 低于所需的 Java ${requiredJava}`)
  const compatibilityWarning = remoteArtifactCompatibilityWarning(server.os, input.coreId, input.version)
  if (compatibilityWarning) warnings.push(compatibilityWarning)
  if (artifactKind === 'unsupported') warnings.push('该核心返回了不支持的部署文件格式')

  return {
    targetPath: input.targetPath,
    artifactName: artifact.fileName,
    artifactKind,
    requiredJavaMajor: requiredJava,
    javaMajor: probe.javaMajor,
    architecture: probe.architecture,
    availableBytes: probe.availableBytes,
    targetExists: probe.targetExists,
    parentWritable: probe.parentWritable,
    portAvailable: !probe.portInUse,
    canDeploy: warnings.length === 0,
    warnings,
  }
}

function deploymentStagingPath(targetPath: string, jobId: string): string {
  return `${targetPath}.mcstools-deploy-${jobId.replace(/[^a-z0-9]/gi, '')}`
}

async function createRemoteDeploymentStaging(
  server: StoredRemoteServer,
  targetPath: string,
  stagingPath: string,
): Promise<void> {
  const parentPath = remoteParentPath(server.os, targetPath)
  if (!parentPath) throw new Error('部署目录缺少有效的上级目录')
  if (server.os === 'windows') {
    const script = `$target=${powerShellQuote(targetPath)}; $staging=${powerShellQuote(stagingPath)}; $parent=${powerShellQuote(parentPath)}; if (Test-Path -LiteralPath $target) { throw '目标目录已经存在' }; New-Item -ItemType Directory -Path $parent -Force | Out-Null; if (Test-Path -LiteralPath $staging) { throw '部署临时目录已经存在' }; New-Item -ItemType Directory -Path $staging | Out-Null`
    await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
    return
  }
  const script = `set -eu\ntarget=${posixQuote(targetPath)}\nstaging=${posixQuote(stagingPath)}\nparent=${posixQuote(parentPath)}\n[ ! -e "$target" ] || { printf '目标目录已经存在' >&2; exit 1; }\nmkdir -p -- "$parent"\n[ ! -e "$staging" ] || { printf '部署临时目录已经存在' >&2; exit 1; }\nmkdir -- "$staging"`
  await runStoredCommand(server, 'sh -s', script, 30000)
}

async function verifyRemoteDeploymentArtifact(
  server: StoredRemoteServer,
  remotePath: string,
  expectedSha256: string,
): Promise<void> {
  let output: string
  if (server.os === 'windows') {
    const script = `$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath ${powerShellQuote(remotePath)}).Hash.ToLowerInvariant(); [Console]::Out.Write($hash)`
    output = await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
  } else {
    const script = `set -eu\nfile=${posixQuote(remotePath)}\nif command -v sha256sum >/dev/null 2>&1; then sha256sum -- "$file" | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -- "$file" | awk '{print $1}'; else printf '远程主机缺少 SHA-256 校验工具' >&2; exit 1; fi`
    output = await runStoredCommand(server, 'sh -s', script, 30000)
  }
  if (output.trim().toLowerCase() !== expectedSha256.toLowerCase()) throw new Error('远程核心文件 SHA-256 校验失败')
}

async function commitRemoteDeployment(
  server: StoredRemoteServer,
  targetPath: string,
  stagingPath: string,
): Promise<void> {
  if (server.os === 'windows') {
    const script = `$target=${powerShellQuote(targetPath)}; $staging=${powerShellQuote(stagingPath)}; if (Test-Path -LiteralPath $target) { throw '目标目录已经存在' }; Move-Item -LiteralPath $staging -Destination $target`
    await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
    return
  }
  const script = `set -eu\ntarget=${posixQuote(targetPath)}\nstaging=${posixQuote(stagingPath)}\n[ ! -e "$target" ] || { printf '目标目录已经存在' >&2; exit 1; }\nmv -- "$staging" "$target"`
  await runStoredCommand(server, 'sh -s', script, 30000)
}

async function removeRemoteDeploymentPath(server: StoredRemoteServer, targetPath: string): Promise<void> {
  if (server.os === 'windows') {
    const script = `$target=${powerShellQuote(targetPath)}; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }`
    await runStoredCommand(server, encodeWindowsPowerShellCommand(script), '', 30000)
    return
  }
  await runStoredCommand(server, 'sh -s', `set -eu\ntarget=${posixQuote(targetPath)}\nrm -rf -- "$target"`, 30000)
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
launch_kind=${posixQuote(minecraftServer.launch.kind)}
launch_target=${posixQuote(minecraftServer.launch.target)}
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
  if [ "$launch_kind" = native ]; then
    [ "$executable" = "$(basename "$launch_target")" ] || continue
    printf external
    exit 0
  fi
  case "$executable" in java|javaw) ;; *) continue ;; esac
  if tr '\0' '\n' < "$process_directory/cmdline" | awk -v kind="$launch_kind" -v target="$launch_target" '
    kind == "jar" && previous == "-jar" {
      argument=$0
      sub(/^\.\//, "", argument)
      if (argument == target) found=1
    }
    kind == "java-args" && $0 == "@" target { found=1 }
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
launch_kind=${posixQuote(minecraftServer.launch.kind)}
launch_target=${posixQuote(minecraftServer.launch.target)}
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
launch_path="$target/$launch_target"
for pid in $(ps -axo pid=); do
  command_line=$(ps -p "$pid" -o command= 2>/dev/null || true)
  if [ "$launch_kind" = native ]; then
    case "$command_line" in *"$launch_target"*|*"$launch_path"*) ;; *) continue ;; esac
  elif [ "$launch_kind" = jar ]; then
    case "$command_line" in *"-jar $launch_target"*|*"-jar \"$launch_target\""*|*"$launch_path"*) ;; *) continue ;; esac
  else
    case "$command_line" in *"@$launch_target"*|*"@$launch_path"*) ;; *) continue ;; esac
  fi
  process_cwd=$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
  if [ "$process_cwd" = "$target" ] || printf '%s' "$command_line" | grep -F -- "$launch_path" >/dev/null 2>&1; then
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
$launchKind=${powerShellQuote(minecraftServer.launch.kind)}
$launchTarget=${powerShellQuote(minecraftServer.launch.target)}
$allProcesses=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
if ($launchKind -eq 'native') {
  $nativeName=[System.IO.Path]::GetFileName($launchTarget)
  $candidates=@($allProcesses | Where-Object { $_.Name -eq $nativeName })
} elseif ($launchKind -eq 'jar') {
  $launchPattern='(?i)(?:^|\s)-jar\s+"?(?:[^"\s]*[\\/])?' + [regex]::Escape($launchTarget) + '(?:"|\s|$)'
  $candidates=@($allProcesses | Where-Object { ($_.Name -eq 'java.exe' -or $_.Name -eq 'javaw.exe') -and $_.CommandLine -and $_.CommandLine -match $launchPattern })
} else {
  $launchPattern='(?i)(?:^|\s)"?@' + [regex]::Escape($launchTarget) + '(?:"|\s|$)'
  $candidates=@($allProcesses | Where-Object { ($_.Name -eq 'java.exe' -or $_.Name -eq 'javaw.exe') -and $_.CommandLine -and $_.CommandLine -match $launchPattern })
}
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
    await sftpStatFile(sftp, remoteJoin(minecraftServer.path, minecraftServer.launch.target))
    await sftpMkdir(sftp, paths.runtimeDirectory)
    await sftpWriteText(sftp, paths.controlPath, `${JSON.stringify(control, null, 2)}\n`)
    await sftpWriteText(sftp, remoteJoin(minecraftServer.path, 'eula.txt'), [
      '# Generated by Minecraft Server Tools',
      '# https://aka.ms/MinecraftEULA',
      'eula=true',
      '',
    ].join('\n'))
    const marker = `\n[MST] ===== 远程会话 ${new Date().toISOString()} =====\n[MST] 启动 ${minecraftServer.launch.target}，最大内存 ${minecraftServer.maxRam} MB\n`
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
  const launchCommand = posixMinecraftLaunchCommand(minecraftServer)
  if (server.os === 'linux') {
    const script = `set -eu
directory=${posixQuote(minecraftServer.path)}
runtime=${posixQuote(paths.runtimeDirectory)}
pid_file=${posixQuote(paths.pidPath)}
input_file=${posixQuote(paths.inputPath)}
log_file=${posixQuote(paths.logPath)}
rm -f "$input_file"
mkfifo "$input_file"
cd "$directory"
nohup setsid sh -c 'fifo=$1; shift; exec 3<> "$fifo"; "$@" <&3; result=$?; exec 3>&-; rm -f "$fifo"; exit "$result"' mcstools "$input_file" ${launchCommand} >> "$log_file" 2>&1 &
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
rm -f "$pid_file" "$input_file"
mkfifo "$input_file"
cd "$directory"
nohup sh -c 'fifo=$1; shift; exec 3<> "$fifo"; exec "$@" <&3' mcstools "$input_file" ${launchCommand} >> "$log_file" 2>&1 &
pid=$!
printf '%s' "$pid" > "$pid_file"
sleep 1
kill -0 "$pid" 2>/dev/null`
    await runStoredCommand(server, 'sh -s', script)
    return
  }
  const runnerInvocation = `& ${powerShellQuote(paths.runnerPath)} -WorkingDirectory ${powerShellQuote(minecraftServer.path)} -LaunchKind ${powerShellQuote(minecraftServer.launch.kind)} -LaunchTarget ${powerShellQuote(minecraftServer.launch.target)} -MaxRam ${minecraftServer.maxRam} -PipeName ${powerShellQuote(paths.pipeName)} -LogPath ${powerShellQuote(paths.logPath)} -PidPath ${powerShellQuote(paths.pidPath)}`
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
  const script = `$pidPath=${powerShellQuote(paths.pidPath)}; if (Test-Path -LiteralPath $pidPath) { $pidValue=Get-Content -LiteralPath $pidPath -Raw; if ($pidValue -match '^\\d+$') { $taskkill=Get-Command taskkill.exe -CommandType Application -ErrorAction SilentlyContinue; if ($taskkill) { & $taskkill.Source /PID $pidValue /T /F | Out-Null } else { Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue } }; Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue }`
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
  auth: RemoteSshAuth,
  expectedFingerprint?: string,
): Promise<{ metrics: RemoteServerMetrics; fingerprint: string }> {
  const isWindows = target.os === 'windows'
  const metricsScript = target.os === 'macos' ? MACOS_METRICS_SCRIPT : LINUX_METRICS_SCRIPT
  const result = await executeRemote(
    target,
    auth,
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
  private mainWindow: BrowserWindow | null = null
  private readonly deploymentJobs = new Map<string, RemoteDeploymentJob>()
  private readonly deploymentCancelRequests = new Set<string>()
  private deploymentJobsLoaded = false
  private deploymentPersistTimer: NodeJS.Timeout | null = null

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.ensureDeploymentJobsLoaded()
  }

  private ensureDeploymentJobsLoaded(): void {
    if (this.deploymentJobsLoaded) return
    this.deploymentJobsLoaded = true
    let values: unknown[] = []
    try {
      values = readJsonStore<unknown[]>(deploymentStorePath(), [], Array.isArray, '远程部署任务')
    } catch (error) {
      console.error('Failed to read remote deployment jobs:', error)
    }
    const servers = readStoredServers()
    const interrupted: Array<{ job: RemoteDeploymentJob; phase: RemoteDeploymentPhase }> = []
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Partial<RemoteDeploymentJob>
      const server = servers.find(candidate => candidate.id === item.remoteServerId)
      if (!server || typeof item.id !== 'string' || !REMOTE_DEPLOYMENT_PHASES.has(item.phase as RemoteDeploymentPhase)) continue
      let input: RemoteDeploymentInput
      let launch: RemoteMinecraftLaunchSpec | undefined
      try {
        input = normalizeRemoteDeploymentInput(server.os, item.input)
        launch = item.launch ? validateRemoteLaunchSpec(item.launch) : undefined
      } catch {
        continue
      }
      const createdAt = typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
        ? item.createdAt
        : new Date(0).toISOString()
      const updatedAt = typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
        ? item.updatedAt
        : createdAt
      const phase = item.phase as RemoteDeploymentPhase
      const job: RemoteDeploymentJob = {
        id: item.id,
        remoteServerId: server.id,
        input,
        phase,
        progress: Math.max(0, Math.min(100, Math.round(Number(item.progress) || 0))),
        message: typeof item.message === 'string' ? item.message : '',
        createdAt,
        updatedAt,
        ...(typeof item.error === 'string' ? { error: item.error } : {}),
        ...(typeof item.minecraftServerId === 'string' ? { minecraftServerId: item.minecraftServerId } : {}),
        ...(launch ? { launch } : {}),
      }
      if (!TERMINAL_DEPLOYMENT_PHASES.has(phase)) {
        job.phase = 'failed'
        job.message = '应用退出导致部署中断，正在核对远程状态...'
        job.error = '部署任务未正常结束'
        job.updatedAt = new Date().toISOString()
        interrupted.push({ job, phase })
      }
      this.deploymentJobs.set(job.id, job)
    }
    this.pruneDeploymentJobs()
    this.persistDeploymentJobsNow()
    for (const item of interrupted) void this.reconcileInterruptedDeployment(item.job, item.phase)
  }

  private persistDeploymentJobsNow(): void {
    if (!this.deploymentJobsLoaded) return
    if (this.deploymentPersistTimer) {
      clearTimeout(this.deploymentPersistTimer)
      this.deploymentPersistTimer = null
    }
    try {
      writeJsonStore(deploymentStorePath(), [...this.deploymentJobs.values()].map(job => this.deploymentJobSnapshot(job)))
    } catch (error) {
      console.error('Failed to persist remote deployment jobs:', error)
    }
  }

  private scheduleDeploymentJobsPersist(immediate = false): void {
    if (immediate) {
      this.persistDeploymentJobsNow()
      return
    }
    if (this.deploymentPersistTimer) return
    this.deploymentPersistTimer = setTimeout(() => this.persistDeploymentJobsNow(), 250)
  }

  private async reconcileInterruptedDeployment(job: RemoteDeploymentJob, previousPhase: RemoteDeploymentPhase): Promise<void> {
    let server: StoredRemoteServer
    try {
      server = findStoredServer(job.remoteServerId)
    } catch (error) {
      this.updateDeploymentJob(job, 'failed', job.progress, '部署恢复失败', error instanceof Error ? error.message : String(error))
      return
    }
    const stagingPath = deploymentStagingPath(job.input.targetPath, job.id)
    if ((previousPhase === 'registering' || previousPhase === 'starting') && job.launch) {
      try {
        const existing = server.minecraftServers.find(item => item.path.toLowerCase() === job.input.targetPath.toLowerCase())
        const minecraftServer = existing || await this.addMinecraftServer(job.remoteServerId, {
          path: job.input.targetPath,
          jarName: job.launch.target,
          launch: job.launch,
          coreType: job.input.coreId,
          version: job.input.version,
          remark: job.input.remark,
          maxRam: job.input.maxRam,
        })
        job.minecraftServerId = minecraftServer.id
        this.updateDeploymentJob(job, 'completed', 100, '已恢复中断部署；为避免重复启动，服务端保持停止')
        return
      } catch (error) {
        try { await removeRemoteDeploymentPath(server, stagingPath) } catch {}
        this.updateDeploymentJob(job, 'failed', job.progress, '无法恢复已中断的部署', error instanceof Error ? error.message : String(error))
        return
      }
    }
    try {
      await removeRemoteDeploymentPath(server, stagingPath)
      this.updateDeploymentJob(job, 'failed', job.progress, '部署已中断，远程临时目录已清理', '部署任务未正常结束')
    } catch (error) {
      this.updateDeploymentJob(job, 'failed', job.progress, '部署已中断，远程临时目录清理失败', error instanceof Error ? error.message : String(error))
    }
  }

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

    const collected = await collectMetrics(input, inputSshAuth(input), input.expectedFingerprint)
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
      authType: input.authType,
      hostFingerprint: collected.fingerprint,
      createdAt: new Date().toISOString(),
      ...(input.authType === 'password'
        ? { encryptedPassword: safeStorage.encryptString(input.password || '').toString('base64') }
        : {
          encryptedPrivateKey: safeStorage.encryptString(input.privateKey || '').toString('base64'),
          ...(input.passphrase
            ? { encryptedPassphrase: safeStorage.encryptString(input.passphrase).toString('base64') }
            : {}),
        }),
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
    const result = await collectMetrics(server, storedSshAuth(server), server.hostFingerprint || undefined)
    if (!server.hostFingerprint && result.fingerprint) {
      const current = readStoredServers()
      writeStoredServers(current.map(item => item.id === id ? { ...item, hostFingerprint: result.fingerprint } : item))
    }
    return result.metrics
  }

  async preflightDeployment(remoteServerId: string, rawInput: unknown): Promise<RemoteDeploymentPreflight> {
    const server = findStoredServer(remoteServerId)
    const input = normalizeRemoteDeploymentInput(server.os, rawInput)
    const artifact = await getCoreDownloadArtifact(input.coreId, input.version)
    return probeRemoteDeployment(server, input, artifact)
  }

  startDeployment(remoteServerId: string, rawInput: unknown): RemoteDeploymentJob {
    this.ensureDeploymentJobsLoaded()
    const server = findStoredServer(remoteServerId)
    const input = normalizeRemoteDeploymentInput(server.os, rawInput)
    const activeForTarget = [...this.deploymentJobs.values()].some(job => (
      job.remoteServerId === remoteServerId
      && job.input.targetPath.toLowerCase() === input.targetPath.toLowerCase()
      && !TERMINAL_DEPLOYMENT_PHASES.has(job.phase)
    ))
    if (activeForTarget) throw new Error('该目标目录已有部署任务正在进行')

    const now = new Date().toISOString()
    const job: RemoteDeploymentJob = {
      id: randomUUID(),
      remoteServerId,
      input,
      phase: 'queued',
      progress: 0,
      message: '部署任务已创建',
      createdAt: now,
      updatedAt: now,
    }
    this.deploymentJobs.set(job.id, job)
    this.pruneDeploymentJobs()
    this.persistDeploymentJobsNow()
    this.emitDeploymentJob(job)
    void this.executeDeployment(server, job)
    return this.deploymentJobSnapshot(job)
  }

  listDeploymentJobs(remoteServerId: string): RemoteDeploymentJob[] {
    this.ensureDeploymentJobsLoaded()
    findStoredServer(remoteServerId)
    return [...this.deploymentJobs.values()]
      .filter(job => job.remoteServerId === remoteServerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(job => this.deploymentJobSnapshot(job))
  }

  cancelDeployment(remoteServerId: string, jobId: string): RemoteDeploymentJob {
    this.ensureDeploymentJobsLoaded()
    findStoredServer(remoteServerId)
    const job = this.deploymentJobs.get(jobId)
    if (!job || job.remoteServerId !== remoteServerId) throw new Error('部署任务不存在')
    if (TERMINAL_DEPLOYMENT_PHASES.has(job.phase)) return this.deploymentJobSnapshot(job)
    if (job.phase === 'registering' || job.phase === 'starting') throw new Error('部署已经提交，当前阶段不能取消')
    this.deploymentCancelRequests.add(job.id)
    this.updateDeploymentJob(job, job.phase, job.progress, '正在取消并清理部署任务...')
    return this.deploymentJobSnapshot(job)
  }

  private deploymentJobSnapshot(job: RemoteDeploymentJob): RemoteDeploymentJob {
    return { ...job, input: { ...job.input } }
  }

  private emitDeploymentJob(job: RemoteDeploymentJob): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('remoteDeployment:progress', this.deploymentJobSnapshot(job))
  }

  private updateDeploymentJob(
    job: RemoteDeploymentJob,
    phase: RemoteDeploymentPhase,
    progress: number,
    message: string,
    error?: string,
  ): void {
    const previousPhase = job.phase
    const previousProgress = job.progress
    job.phase = phase
    job.progress = Math.max(0, Math.min(100, Math.round(progress)))
    job.message = message
    job.updatedAt = new Date().toISOString()
    if (error) job.error = error
    else delete job.error
    this.scheduleDeploymentJobsPersist(
      TERMINAL_DEPLOYMENT_PHASES.has(phase) || phase !== previousPhase || Math.abs(job.progress - previousProgress) >= 5,
    )
    this.emitDeploymentJob(job)
  }

  private assertDeploymentNotCancelled(job: RemoteDeploymentJob): void {
    if (!this.deploymentCancelRequests.has(job.id)) return
    const error = new Error('部署已取消')
    error.name = 'RemoteDeploymentCancelled'
    throw error
  }

  private pruneDeploymentJobs(): void {
    const terminal = [...this.deploymentJobs.values()]
      .filter(job => TERMINAL_DEPLOYMENT_PHASES.has(job.phase))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    let changed = false
    for (const job of terminal.slice(50)) changed = this.deploymentJobs.delete(job.id) || changed
    if (changed) this.scheduleDeploymentJobsPersist()
  }

  private async executeDeployment(server: StoredRemoteServer, job: RemoteDeploymentJob): Promise<void> {
    const localDirectory = path.join(app.getPath('temp'), 'MCServerTools-deployments', job.id)
    const stagingPath = deploymentStagingPath(job.input.targetPath, job.id)
    let stagingCreated = false
    let committed = false
    let registered = false

    try {
      this.updateDeploymentJob(job, 'preflight', 2, '正在检查远程环境...')
      const artifact = await getCoreDownloadArtifact(job.input.coreId, job.input.version)
      const preflight = await probeRemoteDeployment(server, job.input, artifact)
      if (!preflight.canDeploy) throw new Error(preflight.warnings.join('；'))
      this.assertDeploymentNotCancelled(job)

      await createRemoteDeploymentStaging(server, job.input.targetPath, stagingPath)
      stagingCreated = true

      this.updateDeploymentJob(job, 'downloading', 10, `正在下载 ${artifact.fileName}...`)
      fs.mkdirSync(localDirectory, { recursive: true })
      const localArtifactPath = path.join(localDirectory, artifact.fileName)
      await downloadFile(artifact.url, localArtifactPath, this.mainWindow || undefined, {
        expectedSha256: artifact.sha256,
        progressChannel: 'remoteDeployment:downloadProgress',
      })
      this.assertDeploymentNotCancelled(job)

      const artifactSha256 = await sha256File(localArtifactPath)
      let launch: RemoteMinecraftLaunchSpec
      if (preflight.artifactKind === 'direct-jar') {
        const remoteArtifactPath = remoteJoin(stagingPath, 'server.jar')
        this.updateDeploymentJob(job, 'uploading', 45, '正在上传核心到云服务器...')
        await withSftp(server, sftp => sftpUploadFile(sftp, localArtifactPath, remoteArtifactPath, (transferred, total) => {
          const ratio = total > 0 ? transferred / total : 0
          this.updateDeploymentJob(job, 'uploading', 45 + ratio * 30, `正在上传核心 ${Math.min(100, Math.round(ratio * 100))}%`)
        }))
        this.assertDeploymentNotCancelled(job)
        this.updateDeploymentJob(job, 'verifying', 77, '正在校验远程核心文件...')
        await verifyRemoteDeploymentArtifact(server, remoteArtifactPath, artifactSha256)
        launch = { kind: 'jar', target: 'server.jar' }
      } else if (preflight.artifactKind === 'java-installer') {
        const installerName = '.mcstools-installer.jar'
        const remoteArtifactPath = remoteJoin(stagingPath, installerName)
        this.updateDeploymentJob(job, 'uploading', 45, '正在上传核心安装器...')
        await withSftp(server, sftp => sftpUploadFile(sftp, localArtifactPath, remoteArtifactPath, (transferred, total) => {
          const ratio = total > 0 ? transferred / total : 0
          this.updateDeploymentJob(job, 'uploading', 45 + ratio * 20, `正在上传安装器 ${Math.min(100, Math.round(ratio * 100))}%`)
        }))
        this.updateDeploymentJob(job, 'verifying', 67, '正在校验远程安装器...')
        await verifyRemoteDeploymentArtifact(server, remoteArtifactPath, artifactSha256)
        this.assertDeploymentNotCancelled(job)
        this.updateDeploymentJob(job, 'installing', 70, '正在远程安装核心及依赖...')
        launch = await runRemoteCoreInstaller(server, stagingPath, installerName, job.input.coreId, job.input.version)
      } else if (preflight.artifactKind === 'archive') {
        this.updateDeploymentJob(job, 'installing', 42, '正在安全解压服务端文件...')
        const payload = await prepareRemoteDeploymentArchive(
          localArtifactPath,
          path.join(localDirectory, 'payload'),
          server.os,
          job.input.coreId,
        )
        launch = validateRemoteLaunchSpec(payload.launch)
        this.assertDeploymentNotCancelled(job)
        this.updateDeploymentJob(job, 'uploading', 48, '正在上传服务端文件...')
        await uploadPreparedArchive(server, stagingPath, payload, (transferred, total) => {
          const ratio = total > 0 ? transferred / total : 0
          this.updateDeploymentJob(job, 'uploading', 48 + ratio * 24, `正在上传服务端文件 ${Math.min(100, Math.round(ratio * 100))}%`)
        }, () => this.assertDeploymentNotCancelled(job))
        this.updateDeploymentJob(job, 'verifying', 74, '正在逐文件校验远程部署结果...')
        await verifyRemoteDeploymentPayload(server, stagingPath, payload, localDirectory)
      } else {
        throw new Error('该核心返回了不支持的部署文件格式')
      }
      this.assertDeploymentNotCancelled(job)
      await makeRemoteLaunchExecutable(server, stagingPath, launch)
      job.launch = launch
      this.persistDeploymentJobsNow()

      this.updateDeploymentJob(job, 'configuring', 82, '正在写入服务器配置...')
      const marker = {
        version: 1,
        deploymentId: job.id,
        createdAt: new Date().toISOString(),
        coreId: job.input.coreId,
        coreVersion: job.input.version,
        artifactSha256,
        sourceSha256Provided: Boolean(artifact.sha256),
        launch,
      }
      const properties = [
        '# Generated by MCServerTools',
        `server-port=${job.input.serverPort}`,
        `motd=${job.input.name.replace(/[\\:=]/g, value => `\\${value}`)}`,
        'online-mode=true',
        '',
      ].join('\n')
      await withSftp(server, async sftp => {
        await sftpWriteText(sftp, remoteJoin(stagingPath, 'eula.txt'), 'eula=true\n')
        await sftpWriteText(sftp, remoteJoin(stagingPath, 'server.properties'), properties)
        await sftpWriteText(sftp, remoteJoin(stagingPath, SERVER_PROFILE_FILE), serializeRemoteDeploymentProfile(job.input))
        await sftpWriteText(sftp, remoteJoin(stagingPath, REMOTE_DEPLOYMENT_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`)
      })
      this.assertDeploymentNotCancelled(job)

      this.updateDeploymentJob(job, 'registering', 88, '正在原子提交远程部署目录...')
      await commitRemoteDeployment(server, job.input.targetPath, stagingPath)
      committed = true
      stagingCreated = false

      this.updateDeploymentJob(job, 'registering', 90, '正在注册远程 Minecraft 服务器...')
      const minecraftServer = await this.addMinecraftServer(job.remoteServerId, {
        path: job.input.targetPath,
        jarName: launch.target,
        launch,
        coreType: job.input.coreId,
        version: job.input.version,
        remark: job.input.remark,
        maxRam: job.input.maxRam,
      })
      registered = true
      job.minecraftServerId = minecraftServer.id
      this.persistDeploymentJobsNow()

      if (job.input.startAfterDeploy) {
        this.updateDeploymentJob(job, 'starting', 96, '部署完成，正在启动服务器...')
        await this.startMinecraftServer(job.remoteServerId, minecraftServer.id, job.input.maxRam)
      }

      this.updateDeploymentJob(job, 'completed', 100, job.input.startAfterDeploy ? '部署并启动完成' : '部署完成')
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      let cleanupError = ''
      if (!registered) {
        const cleanupTarget = committed ? job.input.targetPath : stagingCreated ? stagingPath : ''
        if (cleanupTarget) {
          try { await removeRemoteDeploymentPath(server, cleanupTarget) } catch (cleanup) {
            cleanupError = cleanup instanceof Error ? cleanup.message : String(cleanup)
          }
        }
      }
      const cancelled = normalized.name === 'RemoteDeploymentCancelled' || this.deploymentCancelRequests.has(job.id)
      const message = cleanupError ? `${normalized.message}；清理失败：${cleanupError}` : normalized.message
      this.updateDeploymentJob(job, cancelled ? 'cancelled' : 'failed', job.progress, cancelled ? '部署已取消' : '部署失败', message)
    } finally {
      this.deploymentCancelRequests.delete(job.id)
      try { fs.rmSync(localDirectory, { recursive: true, force: true }) } catch {}
      this.pruneDeploymentJobs()
    }
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
    const launch = rawInput?.launch
      ? validateRemoteLaunchSpec(rawInput.launch)
      : validateRemoteLaunchSpec(undefined, validateRemoteJarName(rawInput?.jarName || inspected.suggestedJar))
    const jarName = launch.target
    if (!rawInput?.launch && !inspected.jarFiles.includes(jarName)) throw new Error(`所选目录中没有 ${jarName}`)
    await withSftp(host, sftp => sftpStatFile(sftp, remoteJoin(inspected.path, launch.target)))
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
      launch,
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
