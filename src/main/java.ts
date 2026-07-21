import { spawnSync } from 'child_process'
import { app, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { downloadFile, fetchText } from './utils/download'

export interface JavaInfo {
  path: string
  version: string
  majorVersion: number
}

export interface JavaDownloadPackage {
  id: string
  title: string
  fileName: string
  url: string
  sha256Url: string
  format: string
  architecture: string
  recommended: boolean
  native: boolean
  description: string
}

export interface JavaSystemProfile {
  platform: 'windows' | 'macos' | 'linux' | 'unsupported'
  platformLabel: string
  architecture: 'x64' | 'arm64' | 'ia32' | 'unknown'
  architectureLabel: string
  distribution?: string
  preferredFormat: string
  nativePackageAvailable: boolean
  recommendation: string
}

export function detectJava(): JavaInfo | null {
  return resolveJava()
}

export function resolveJava(preferredPath?: string, minimumMajor = 0): JavaInfo | null {
  for (const candidate of getJavaCandidates(preferredPath)) {
    const info = inspectJavaCandidate(candidate)
    if (info && info.majorVersion >= minimumMajor) return info
  }
  return null
}

export function getJava21Packages(): JavaDownloadPackage[] {
  const profile = getJavaSystemProfile()

  if (profile.platform === 'windows' && profile.architecture === 'x64') {
    return [
      {
        id: 'win-x64-exe',
        title: 'Windows x64 安装程序',
        fileName: 'jdk-21_windows-x64_bin.exe',
        url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.exe',
        sha256Url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.exe.sha256',
        format: 'EXE',
        architecture: 'x64',
        recommended: true,
        native: true,
        description: '适合普通用户，下载后按安装向导完成安装。',
      },
      {
        id: 'win-x64-msi',
        title: 'Windows x64 MSI 安装包',
        fileName: 'jdk-21_windows-x64_bin.msi',
        url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.msi',
        sha256Url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.msi.sha256',
        format: 'MSI',
        architecture: 'x64',
        recommended: false,
        native: true,
        description: '适合企业部署、静默安装或由管理员统一分发。',
      },
      {
        id: 'win-x64-zip',
        title: 'Windows x64 压缩包',
        fileName: 'jdk-21_windows-x64_bin.zip',
        url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.zip',
        sha256Url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.zip.sha256',
        format: 'ZIP',
        architecture: 'x64',
        recommended: false,
        native: true,
        description: '免安装版本，适合手动管理 Java 目录。',
      },
    ]
  }

  if (profile.platform === 'windows' && profile.architecture === 'arm64') {
    return [
      {
        id: 'win-arm64-x64-exe',
        title: 'Windows x64 兼容安装程序',
        fileName: 'jdk-21_windows-x64_bin.exe',
        url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.exe',
        sha256Url: 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.exe.sha256',
        format: 'EXE',
        architecture: 'x64',
        recommended: false,
        native: false,
        description: 'Oracle 未提供 Windows ARM64 原生 Java 21；仅在系统支持 x64 仿真时使用。',
      },
    ]
  }

  if (profile.platform === 'macos' && (profile.architecture === 'x64' || profile.architecture === 'arm64')) {
    const isArm64 = profile.architecture === 'arm64'
    const oracleArch = isArm64 ? 'aarch64' : 'x64'
    return [{
      id: `mac-${profile.architecture}-dmg`,
      title: `macOS ${profile.architecture} 安装包`,
      fileName: `jdk-21_macos-${oracleArch}_bin.dmg`,
      url: `https://download.oracle.com/java/21/latest/jdk-21_macos-${oracleArch}_bin.dmg`,
      sha256Url: `https://download.oracle.com/java/21/latest/jdk-21_macos-${oracleArch}_bin.dmg.sha256`,
      format: 'DMG',
      architecture: profile.architecture,
      recommended: true,
      native: true,
      description: isArm64 ? '适用于 Apple Silicon 芯片的 Mac。' : '适用于 Intel 芯片的 Mac。',
    }]
  }

  if (profile.platform === 'linux' && (profile.architecture === 'x64' || profile.architecture === 'arm64')) {
    return getLinuxPackages(profile)
  }

  return []
}

export function getJavaSystemProfile(): JavaSystemProfile {
  const architecture = detectNativeArchitecture()
  const architectureLabel = architecture === 'arm64'
    ? 'ARM64'
    : architecture === 'x64'
      ? 'x64 / AMD64'
      : architecture === 'ia32'
        ? '32 位 x86'
        : '未知架构'

  if (process.platform === 'win32') {
    if (architecture === 'x64') {
      return {
        platform: 'windows',
        platformLabel: os.version(),
        architecture,
        architectureLabel,
        preferredFormat: 'EXE',
        nativePackageAvailable: true,
        recommendation: '已匹配 Windows x64，普通安装推荐 EXE；企业部署可选择 MSI。',
      }
    }

    if (architecture === 'arm64') {
      return {
        platform: 'windows',
        platformLabel: os.version(),
        architecture,
        architectureLabel,
        preferredFormat: '无原生安装包',
        nativePackageAvailable: false,
        recommendation: 'Oracle 未提供 Windows ARM64 原生 Java 21。下方仅提供依赖系统 x64 仿真的兼容方案。',
      }
    }

    return {
      platform: 'windows',
      platformLabel: os.version(),
      architecture,
      architectureLabel,
      preferredFormat: '无可用安装包',
      nativePackageAvailable: false,
      recommendation: 'Oracle Java 21 不支持当前 Windows 架构，请打开官方页面确认可用版本。',
    }
  }

  if (process.platform === 'darwin') {
    const supported = architecture === 'x64' || architecture === 'arm64'
    return {
      platform: 'macos',
      platformLabel: `macOS ${os.release()}`,
      architecture,
      architectureLabel,
      preferredFormat: supported ? 'DMG' : '无可用安装包',
      nativePackageAvailable: supported,
      recommendation: supported
        ? `已匹配 ${architecture === 'arm64' ? 'Apple Silicon' : 'Intel'} Mac，推荐 DMG 安装包。`
        : 'Oracle Java 21 不支持当前 macOS 架构，请打开官方页面确认可用版本。',
    }
  }

  if (process.platform === 'linux') {
    const distro = readLinuxDistribution()
    const supported = architecture === 'x64' || architecture === 'arm64'
    const preferredFormat = !supported
      ? '无可用安装包'
      : distro.family === 'debian' && architecture === 'x64'
        ? 'DEB'
        : distro.family === 'rpm'
          ? 'RPM'
          : 'TAR.GZ'
    return {
      platform: 'linux',
      platformLabel: 'Linux',
      architecture,
      architectureLabel,
      distribution: distro.name,
      preferredFormat,
      nativePackageAvailable: supported,
      recommendation: supported
        ? `已识别 ${distro.name}，推荐 ${preferredFormat} 格式。`
        : 'Oracle Java 21 不支持当前 Linux 架构，请打开官方页面确认可用版本。',
    }
  }

  return {
    platform: 'unsupported',
    platformLabel: process.platform,
    architecture,
    architectureLabel,
    preferredFormat: '无可用安装包',
    nativePackageAvailable: false,
    recommendation: '当前操作系统没有可自动匹配的 Oracle Java 21 安装包。',
  }
}

export function getJava21OfficialPage() {
  return 'https://www.oracle.com/java/technologies/downloads/#java21'
}

export async function downloadJavaPackage(
  packageId: string,
  mainWindow?: BrowserWindow,
): Promise<{ filePath: string; packageInfo: JavaDownloadPackage }> {
  const packageInfo = getJava21Packages().find((item) => item.id === packageId)
  if (!packageInfo) throw new Error('未找到对应的 Java 21 下载包')

  const downloadDir = path.join(app.getPath('downloads'), 'MCServerTools', 'java')
  fs.mkdirSync(downloadDir, { recursive: true })

  const filePath = path.join(downloadDir, packageInfo.fileName)
  const checksum = (await fetchText(packageInfo.sha256Url)).trim().split(/\s+/)[0].toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('无法读取 Java 官方校验值')
  await downloadFile(packageInfo.url, filePath, mainWindow, {
    progressChannel: 'java:downloadProgress',
    expectedSha256: checksum,
    allowedHosts: ['download.oracle.com'],
  })
  return { filePath, packageInfo }
}

export async function openJavaDownload(filePath: string) {
  const error = await shell.openPath(filePath)
  if (error) throw new Error(error)
}

function getLinuxPackages(profile: JavaSystemProfile): JavaDownloadPackage[] {
  const isArm64 = profile.architecture === 'arm64'
  const oracleArch = isArm64 ? 'aarch64' : 'x64'
  const architecture = isArm64 ? 'ARM64' : 'x64'
  const archivePackage: JavaDownloadPackage = {
    id: `linux-${profile.architecture}-tgz`,
    title: `Linux ${architecture} 通用压缩包`,
    fileName: `jdk-21_linux-${oracleArch}_bin.tar.gz`,
    url: `https://download.oracle.com/java/21/latest/jdk-21_linux-${oracleArch}_bin.tar.gz`,
    sha256Url: `https://download.oracle.com/java/21/latest/jdk-21_linux-${oracleArch}_bin.tar.gz.sha256`,
    format: 'TAR.GZ',
    architecture: profile.architecture,
    recommended: profile.preferredFormat === 'TAR.GZ',
    native: true,
    description: '适用于多数 Linux 发行版，需要手动解压并配置 Java 路径。',
  }

  if (profile.preferredFormat === 'DEB') {
    return [
      {
        id: 'linux-x64-deb',
        title: 'Linux x64 DEB 安装包',
        fileName: 'jdk-21_linux-x64_bin.deb',
        url: 'https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.deb',
        sha256Url: 'https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.deb.sha256',
        format: 'DEB',
        architecture: 'x64',
        recommended: true,
        native: true,
        description: '适用于 Debian、Ubuntu 及其衍生发行版，可由系统包管理器安装。',
      },
      archivePackage,
    ]
  }

  if (profile.preferredFormat === 'RPM') {
    return [
      {
        id: `linux-${profile.architecture}-rpm`,
        title: `Linux ${architecture} RPM 安装包`,
        fileName: `jdk-21_linux-${oracleArch}_bin.rpm`,
        url: `https://download.oracle.com/java/21/latest/jdk-21_linux-${oracleArch}_bin.rpm`,
        sha256Url: `https://download.oracle.com/java/21/latest/jdk-21_linux-${oracleArch}_bin.rpm.sha256`,
        format: 'RPM',
        architecture: profile.architecture,
        recommended: true,
        native: true,
        description: '适用于 Fedora、RHEL、CentOS、Rocky Linux、Oracle Linux 等 RPM 系发行版。',
      },
      archivePackage,
    ]
  }

  return [archivePackage]
}

function detectNativeArchitecture(): JavaSystemProfile['architecture'] {
  if (process.platform === 'win32') {
    return normalizeArchitecture(
      process.env.PROCESSOR_ARCHITEW6432
      || process.env.PROCESSOR_ARCHITECTURE
      || process.arch,
    )
  }

  if (process.platform === 'darwin' && process.arch === 'x64') {
    const appleSilicon = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (appleSilicon.status === 0 && appleSilicon.stdout.trim() === '1') return 'arm64'
  }

  if (process.platform === 'linux') {
    const uname = spawnSync('uname', ['-m'], { encoding: 'utf8', windowsHide: true })
    if (uname.status === 0) return normalizeArchitecture(uname.stdout.trim())
  }

  return normalizeArchitecture(process.arch)
}

function normalizeArchitecture(value?: string): JavaSystemProfile['architecture'] {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'amd64' || normalized === 'x64' || normalized === 'x86_64') return 'x64'
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64'
  if (normalized === 'x86' || normalized === 'ia32' || normalized === 'i386' || normalized === 'i686') return 'ia32'
  return 'unknown'
}

function readLinuxDistribution(): { name: string; family: 'debian' | 'rpm' | 'other' } {
  try {
    const values: Record<string, string> = {}
    const content = fs.readFileSync('/etc/os-release', 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const separator = line.indexOf('=')
      if (separator <= 0) continue
      const key = line.slice(0, separator)
      const value = line.slice(separator + 1).replace(/^["']|["']$/g, '')
      values[key] = value
    }

    const familyText = `${values.ID || ''} ${values.ID_LIKE || ''}`.toLowerCase()
    const family = /(?:^|\s)(?:debian|ubuntu|linuxmint|pop)(?:\s|$)/.test(familyText)
      ? 'debian'
      : /(?:^|\s)(?:rhel|fedora|centos|rocky|almalinux|ol|opensuse|sles|suse)(?:\s|$)/.test(familyText)
        ? 'rpm'
        : 'other'

    return {
      name: values.PRETTY_NAME || values.NAME || values.ID || 'Linux',
      family,
    }
  } catch {
    return { name: 'Linux', family: 'other' }
  }
}

function inspectJavaCandidate(candidate: string): JavaInfo | null {
  if (!candidate) return null

  const result = spawnSync(candidate, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const match = output.match(/(?:openjdk|java) version "(\d+)(?:\.(\d+))?/i)
  if (!match) return null

  const majorVersion = match[1] === '1' && match[2]
    ? parseInt(match[2], 10)
    : parseInt(match[1], 10)

  return {
    path: candidate,
    version: match[0],
    majorVersion,
  }
}

function getJavaCandidates(preferredPath?: string): string[] {
  const values = process.platform === 'win32'
    ? [
      preferredPath,
      'java',
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : '',
      ...collectWindowsJavaCandidates(),
    ]
    : [
      preferredPath,
      'java',
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : '',
      '/usr/bin/java',
      '/opt/homebrew/opt/openjdk/bin/java',
      '/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home/bin/java',
      '/usr/lib/jvm/default-java/bin/java',
    ]

  const seen = new Set<string>()
  return values.filter((value): value is string => {
    if (!value) return false
    const normalized = process.platform === 'win32' ? value.toLowerCase() : value
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function collectWindowsJavaCandidates(): string[] {
  const candidates: string[] = []
  const baseDirs = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files (x86)\\Java',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.jdks') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'scoop', 'apps') : '',
  ].filter((value): value is string => Boolean(value))

  for (const baseDir of baseDirs) {
    if (!fs.existsSync(baseDir)) continue

    const directJava = path.join(baseDir, 'bin', 'java.exe')
    if (fs.existsSync(directJava)) {
      candidates.push(directJava)
    }

    try {
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const nestedJava = path.join(baseDir, entry.name, 'bin', 'java.exe')
        if (fs.existsSync(nestedJava)) candidates.push(nestedJava)

        const currentJava = path.join(baseDir, entry.name, 'current', 'bin', 'java.exe')
        if (fs.existsSync(currentJava)) candidates.push(currentJava)
      }
    } catch {
      // ignore
    }
  }

  return candidates
}
