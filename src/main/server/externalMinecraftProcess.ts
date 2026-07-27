import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { minecraftPidPath } from './minecraftControlProtocol'

const POWERSHELL_TIMEOUT_MS = 8000

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readPid(filePath: string): number | null {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim()
    if (!/^\d+$/.test(value)) return null
    const pid = Number(value)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function hasLiveRemoteMinecraftMarker(serverDirectory: string): boolean {
  return readLiveRemoteMinecraftPid(serverDirectory) !== null
}

export function readLiveRemoteMinecraftPid(serverDirectory: string): number | null {
  const pid = readPid(minecraftPidPath(serverDirectory))
  return pid !== null && isProcessAlive(pid) ? pid : null
}

function readServerPort(serverDirectory: string): number {
  try {
    const content = fs.readFileSync(path.join(serverDirectory, 'server.properties'), 'utf8')
    let port = 25565
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*server-port\s*=\s*(\d+)\s*$/)
      if (match) port = Number(match[1])
    }
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 25565
  } catch {
    return 25565
  }
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise(resolve => {
    execFile('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encoded,
    ], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: POWERSHELL_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

async function detectWindowsProcess(serverDirectory: string, jarName: string): Promise<boolean> {
  const jarPath = path.join(serverDirectory, jarName)
  const serverPort = readServerPort(serverDirectory)
  const script = String.raw`$jarName=${powerShellQuote(jarName)}
$jarPath=${powerShellQuote(jarPath.replace(/\\/g, '/'))}
$jarPattern='(?i)(?:^|\s)-jar\s+(?:"[^"]*[\\/]|[^\s"]*[\\/])?' + [regex]::Escape($jarName) + '(?:"|\s|$)'
$candidates=@(Get-CimInstance Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match $jarPattern })
if ($candidates.Count -eq 0) {
  [Console]::Out.Write('stopped')
  exit 0
}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${serverPort} -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $listenerPids=@($listeners | ForEach-Object { [int]$_.OwningProcess })
  $portCandidates=@($candidates | Where-Object { $listenerPids -contains [int]$_.ProcessId })
  if ($portCandidates.Count -eq 1) {
    [Console]::Out.Write('external')
    exit 0
  }
}
$pathCandidates=@($candidates | Where-Object { $_.CommandLine.Replace('\','/') -match [regex]::Escape($jarPath) })
[Console]::Out.Write($(if ($pathCandidates.Count -eq 1) { 'external' } else { 'stopped' }))`
  return (await runPowerShell(script)).replace(/\0/g, '').trim() === 'external'
}

function detectLinuxProcess(serverDirectory: string, jarName: string): boolean {
  let targetDirectory: string
  try {
    targetDirectory = fs.realpathSync(serverDirectory)
  } catch {
    return false
  }

  let processIds: string[]
  try {
    processIds = fs.readdirSync('/proc').filter(entry => /^\d+$/.test(entry))
  } catch {
    return false
  }

  for (const pid of processIds) {
    const processDirectory = path.join('/proc', pid)
    try {
      if (fs.realpathSync(path.join(processDirectory, 'cwd')) !== targetDirectory) continue
      const executable = path.basename(fs.realpathSync(path.join(processDirectory, 'exe')))
      if (executable !== 'java' && executable !== 'javaw') continue
      const args = fs.readFileSync(path.join(processDirectory, 'cmdline'), 'utf8').split('\0').filter(Boolean)
      const jarArgument = args.findIndex(argument => argument === '-jar')
      if (jarArgument >= 0 && path.basename(args[jarArgument + 1] || '') === jarName) return true
    } catch {
      // Processes can exit, or be hidden by permissions, while /proc is being read.
    }
  }
  return false
}

export async function isExternalMinecraftProcess(serverDirectory: string, jarName: string): Promise<boolean> {
  if (hasLiveRemoteMinecraftMarker(serverDirectory)) return true
  if (process.platform === 'win32') return detectWindowsProcess(serverDirectory, jarName)
  if (process.platform === 'linux') return detectLinuxProcess(serverDirectory, jarName)
  return false
}
