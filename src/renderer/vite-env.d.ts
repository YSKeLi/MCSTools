/// <reference types="vite/client" />

export {}

declare global {
  interface CoreInfo {
    id: string
    name: string
    type: 'vanilla' | 'bukkit' | 'modded' | 'hybrid'
    categoryKey?: string
    categoryName?: string
    categoryDescription?: string
    description: string
    iconUrl?: string
    color: string
  }

  interface CoreVersion {
    id: string
    type: 'release' | 'snapshot' | 'beta' | 'alpha'
  }

  interface JavaInfo {
    path: string
    version: string
    majorVersion: number
  }

  interface JavaDownloadPackage {
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

  interface JavaSystemProfile {
    platform: 'windows' | 'macos' | 'linux' | 'unsupported'
    platformLabel: string
    architecture: 'x64' | 'arm64' | 'ia32' | 'unknown'
    architectureLabel: string
    distribution?: string
    preferredFormat: string
    nativePackageAvailable: boolean
    recommendation: string
  }

  interface DownloadProgress {
    percent: number
    loaded: number
    total: number
    speed: number
    fileName: string
  }

  interface ReleaseAssetInfo {
    name: string
    url: string
    size?: number
    sha256?: string
  }

  interface LatestReleaseInfo {
    repo: string
    source: string
    version: string
    tag: string
    title: string
    publishedAt?: string | null
    url: string
    notes: string[]
    assets?: ReleaseAssetInfo[]
    assetsCount?: number
  }

  type RemoteServerOs = 'linux' | 'windows'

  interface RemoteServerInput {
    name: string
    host: string
    port: number
    username: string
    password: string
    os: RemoteServerOs
    expectedFingerprint?: string
  }

  interface RemoteServerFingerprintInput {
    host: string
    port: number
    username: string
  }

  interface RemoteServerSummary {
    id: string
    name: string
    host: string
    port: number
    username: string
    os: RemoteServerOs
    hostFingerprint: string
    createdAt: string
  }

  interface RemoteServerMetrics {
    fetchedAt: string
    hostname: string
    osName: string
    kernel: string
    uptimeSeconds: number
    cpu: {
      model: string
      cores: number
      usagePercent: number
      loadAverage?: number
    }
    memory: {
      totalBytes: number
      usedBytes: number
      availableBytes: number
      usagePercent: number
    }
    disk: {
      filesystem: string
      mount: string
      totalBytes: number
      usedBytes: number
      availableBytes: number
      usagePercent: number
    }
  }

  interface RemoteServerAddResult {
    server: RemoteServerSummary
    metrics: RemoteServerMetrics
  }

  interface FrpConfigSummary {
    proxyName: string
    serverAddr: string
    serverPort: number
    localPort: number
    remotePort: number
    tokenConfigured: boolean
  }

  interface ImportedFrpConfig {
    filePath: string
    fileName: string
    suggestedName: string
    summary: FrpConfigSummary
    warnings: string[]
  }

  interface FrpSavedConfig {
    id: string
    name: string
    filePath: string
    fileName: string
    summary: FrpConfigSummary
    warnings: string[]
    importedAt: string
    lastUsedAt?: string
  }

  interface LocalSystemMetrics {
    fetchedAt: string
    hostname: string
    manufacturer: string
    model: string
    architecture: string
    osName: string
    kernel: string
    uptimeSeconds: number
    cpu: {
      model: string
      cores: number
      physicalCores: number
      usagePercent: number
    }
    memory: {
      totalBytes: number
      usedBytes: number
      availableBytes: number
      usagePercent: number
    }
    disk: {
      filesystem: string
      mount: string
      totalBytes: number
      usedBytes: number
      availableBytes: number
      usagePercent: number
    }
  }

  interface ServerDetection {
    jarName: string
    coreId: string
    coreName: string
    version: string
    jarFiles: string[]
  }

  interface ServerEntry {
    id: string
    name: string
    path: string
    coreId: string
    coreName: string
    version: string
    jarName: string
    iconUrl?: string
    createdAt: string
    maxRam: number
    javaPath?: string
    managedPath: boolean
  }

  interface ServerEntryInput {
    name: string
    path: string
    coreId: string
    coreName: string
    version: string
    jarName: string
    iconUrl?: string
    maxRam?: number
    javaPath?: string
    managedPath?: boolean
  }

  type ServerProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

  interface ServerRuntimeState {
    serverId: string | null
    status: ServerProcessStatus
  }

  interface ServerLogEvent {
    serverId: string | null
    line: string
  }

  interface ElectronAPI {
    getCores: () => Promise<CoreInfo[]>
    getVersions: (coreId: string) => Promise<CoreVersion[]>
    downloadCore: (coreId: string, version: string, destDir: string) => Promise<string>
    startServer: (serverId: string, maxRam: number) => Promise<void>
    stopServer: (serverId: string) => Promise<void>
    forceStopServer: (serverId: string) => Promise<void>
    getServerStatus: () => Promise<ServerRuntimeState>
    sendServerCommand: (serverId: string, cmd: string) => Promise<void>
    getLocalSystemMetrics: () => Promise<LocalSystemMetrics>
    serversList: () => Promise<ServerEntry[]>
    serversAdd: (s: ServerEntryInput) => Promise<ServerEntry>
    serversRemove: (id: string, options?: { deleteFiles?: boolean }) => Promise<void>
    serversUpdate: (id: string, u: Pick<Partial<ServerEntry>, 'name' | 'maxRam' | 'javaPath'>) => Promise<ServerEntry>
    onServersChanged: (callback: () => void) => () => void
    readServerProperties: (serverId: string) => Promise<string>
    writeServerProperties: (serverId: string, content: string) => Promise<void>
    readServerProfile: (directory: string) => Promise<string>
    writeServerProfile: (directory: string, content: string) => Promise<void>
    createManagedServerDirectory: (parentDirectory: string, serverName: string) => Promise<string>
    discardManagedServerDirectory: (directory: string) => Promise<void>
    selectDirectory: () => Promise<string | null>
    selectJavaExecutable: () => Promise<string | null>
    detectJava: () => Promise<JavaInfo | null>
    getJavaSystemProfile: () => Promise<JavaSystemProfile>
    getJavaPackages: () => Promise<JavaDownloadPackage[]>
    getJavaOfficialPage: () => Promise<string>
    downloadJavaPackage: (packageId: string) => Promise<{ filePath: string; packageInfo: JavaDownloadPackage }>
    detectServer: (dir: string) => Promise<ServerDetection>
    getAppVersion: () => Promise<string>
    checkForUpdates: () => Promise<LatestReleaseInfo>
    downloadAndInstallUpdate: () => Promise<{ filePath: string; assetName: string }>
    openExternal: (url: string) => Promise<void>
    remoteServersList: () => Promise<RemoteServerSummary[]>
    remoteServerFingerprint: (input: RemoteServerFingerprintInput) => Promise<string>
    remoteServersAdd: (input: RemoteServerInput) => Promise<RemoteServerAddResult>
    remoteServersRemove: (id: string) => Promise<void>
    remoteServerGetMetrics: (id: string) => Promise<RemoteServerMetrics>
    onServerLog: (callback: (event: ServerLogEvent) => void) => () => void
    onServerStatus: (callback: (state: ServerRuntimeState) => void) => () => void
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    onJavaDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    frpStop: () => Promise<void>
    frpStatus: () => Promise<string>
    frpConfigsList: () => Promise<FrpSavedConfig[]>
    frpConfigsPickFile: () => Promise<ImportedFrpConfig | null>
    frpConfigsAdd: (name: string, filePath: string) => Promise<FrpSavedConfig>
    frpConfigsRemove: (id: string) => Promise<void>
    frpConfigsStart: (id: string) => Promise<void>
    onFrpConfigsChanged: (callback: () => void) => () => void
    onFrpLog: (callback: (log: string) => void) => () => void
    onFrpStatus: (callback: (status: string) => void) => () => void
  }

  interface FrpConfig {
    serverAddr: string
    serverPort: number
    token: string
    localPort: number
    remotePort: number
    name?: string
  }

  interface Window {
    electronAPI: ElectronAPI
  }
}
