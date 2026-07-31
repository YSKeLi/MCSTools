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

  type RemoteServerOs = 'linux' | 'windows' | 'macos'
  type RemoteServerAuthType = 'password' | 'private-key'

  interface RemoteServerInput {
    name: string
    host: string
    port: number
    username: string
    authType: RemoteServerAuthType
    password?: string
    privateKey?: string
    privateKeyName?: string
    passphrase?: string
    os: RemoteServerOs
    expectedFingerprint?: string
  }

  interface RemotePrivateKeySelection {
    name: string
    content: string
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
    authType: RemoteServerAuthType
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
    bios: {
      vendor: string
      version: string
      releaseDate: string
    }
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

  type ServerProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'external'

  interface ServerRuntimeState {
    serverId: string | null
    status: ServerProcessStatus
  }

  interface ServerLogEvent {
    serverId: string | null
    line: string
  }

  interface RemoteMinecraftDirectory {
    path: string
    name: string
    jarFiles: string[]
    suggestedJar: string
    suggestedType: string
    suggestedVersion: string
    suggestedRemark: string
  }

  interface RemoteFileBrowserItem {
    name: string
    path: string
    type: 'directory' | 'file' | 'drive'
    size: number
  }

  interface RemoteDirectoryListing {
    path: string
    parentPath: string | null
    items: RemoteFileBrowserItem[]
    containsServerProperties: boolean
  }

  interface RemoteMinecraftServer {
    id: string
    name: string
    path: string
    jarName: string
    launch: RemoteMinecraftLaunchSpec
    coreType: string
    version: string
    remark: string
    maxRam: number
    createdAt: string
  }

  type RemoteMinecraftLaunchKind = 'jar' | 'java-args' | 'native'

  interface RemoteMinecraftLaunchSpec {
    kind: RemoteMinecraftLaunchKind
    target: string
  }

  interface RemoteMinecraftServerInput {
    path: string
    jarName?: string
    coreType: string
    version: string
    remark: string
    maxRam?: number
    launch?: RemoteMinecraftLaunchSpec
  }

  type RemoteMinecraftServerStatus = 'running' | 'external' | 'stopped' | 'error'

  type RemoteDeploymentArtifactKind = 'direct-jar' | 'java-installer' | 'archive' | 'unsupported'

  type RemoteDeploymentPhase = 'queued' | 'preflight' | 'downloading' | 'uploading' | 'verifying' | 'installing' | 'configuring' | 'registering' | 'starting' | 'completed' | 'failed' | 'cancelled'

  interface RemoteDeploymentInput {
    name: string
    targetPath: string
    coreId: string
    coreName: string
    version: string
    remark: string
    maxRam: number
    serverPort: number
    eulaAccepted: boolean
    startAfterDeploy?: boolean
  }

  interface RemoteDeploymentPreflight {
    targetPath: string
    artifactName: string
    artifactKind: RemoteDeploymentArtifactKind
    requiredJavaMajor: number
    javaMajor: number | null
    architecture: string
    availableBytes: number
    targetExists: boolean
    parentWritable: boolean
    portAvailable: boolean
    canDeploy: boolean
    warnings: string[]
  }

  interface RemoteDeploymentJob {
    id: string
    remoteServerId: string
    input: RemoteDeploymentInput
    phase: RemoteDeploymentPhase
    progress: number
    message: string
    createdAt: string
    updatedAt: string
    error?: string
    minecraftServerId?: string
    launch?: RemoteMinecraftLaunchSpec
  }

  interface ServerPlayerSnapshot {
    serverId: string | null
    players: string[]
  }

  interface PlayerSkinInfo {
    playerName: string
    premium: boolean
    skinUrl: string | null
    model: 'classic' | 'slim'
  }

  type LanguagePreference = 'system' | 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
  type CloseBehavior = 'quit' | 'tray'

  interface AppSettingsView {
    language: LanguagePreference
    accentColor: string
    backgroundTransparency: number
    autoLaunch: boolean
    closeBehavior: CloseBehavior
    checkUpdatesOnStartup: boolean
    hasBackgroundImage: boolean
    backgroundImageUrl: string | null
  }

  interface ElectronAPI {
    getCores: () => Promise<CoreInfo[]>
    getVersions: (coreId: string) => Promise<CoreVersion[]>
    downloadCore: (coreId: string, version: string, destDir: string) => Promise<string>
    startServer: (serverId: string, maxRam: number) => Promise<void>
    stopServer: (serverId: string) => Promise<void>
    forceStopServer: (serverId: string) => Promise<void>
    getServerStatus: (serverId?: string) => Promise<ServerRuntimeState>
    getServerLogs: (serverId: string) => Promise<string[]>
    getServerPlayers: () => Promise<ServerPlayerSnapshot>
    getPlayerSkin: (playerName: string) => Promise<PlayerSkinInfo>
    sendServerCommand: (serverId: string, cmd: string) => Promise<void>
    getLocalSystemMetrics: (options?: { refreshDisk?: boolean }) => Promise<LocalSystemMetrics>
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
    selectPrivateKey: () => Promise<RemotePrivateKeySelection | null>
    detectJava: () => Promise<JavaInfo | null>
    getJavaSystemProfile: () => Promise<JavaSystemProfile>
    getJavaPackages: () => Promise<JavaDownloadPackage[]>
    getJavaOfficialPage: () => Promise<string>
    downloadJavaPackage: (packageId: string) => Promise<{ filePath: string; packageInfo: JavaDownloadPackage }>
    detectServer: (dir: string) => Promise<ServerDetection>
    getAppVersion: () => Promise<string>
    getAppSettings: () => Promise<AppSettingsView>
    updateAppSettings: (patch: Partial<Omit<AppSettingsView, 'hasBackgroundImage' | 'backgroundImageUrl'>>) => Promise<AppSettingsView>
    selectBackgroundImage: () => Promise<AppSettingsView | null>
    clearBackgroundImage: () => Promise<AppSettingsView>
    checkForUpdates: () => Promise<LatestReleaseInfo>
    downloadAndInstallUpdate: () => Promise<{ filePath: string; assetName: string }>
    openExternal: (url: string) => Promise<void>
    remoteServersList: () => Promise<RemoteServerSummary[]>
    remoteServerFingerprint: (input: RemoteServerFingerprintInput) => Promise<string>
    remoteServersAdd: (input: RemoteServerInput) => Promise<RemoteServerAddResult>
    remoteServersRemove: (id: string) => Promise<void>
    remoteServerGetMetrics: (id: string) => Promise<RemoteServerMetrics>
    remoteMinecraftServersList: (remoteServerId: string) => Promise<RemoteMinecraftServer[]>
    remoteMinecraftFindDirectories: (remoteServerId: string) => Promise<RemoteMinecraftDirectory[]>
    remoteMinecraftInspectDirectory: (remoteServerId: string, remotePath: string) => Promise<RemoteMinecraftDirectory>
    remoteMinecraftBrowseDirectory: (remoteServerId: string, remotePath?: string) => Promise<RemoteDirectoryListing>
    remoteMinecraftServersAdd: (remoteServerId: string, input: RemoteMinecraftServerInput) => Promise<RemoteMinecraftServer>
    remoteMinecraftServersRemove: (remoteServerId: string, minecraftServerId: string) => Promise<void>
    remoteMinecraftServerUpdate: (remoteServerId: string, minecraftServerId: string, maxRam: number) => Promise<RemoteMinecraftServer>
    remoteMinecraftServerStatus: (remoteServerId: string, minecraftServerId: string) => Promise<RemoteMinecraftServerStatus>
    remoteMinecraftServerLogs: (remoteServerId: string, minecraftServerId: string) => Promise<string[]>
    remoteMinecraftServerStart: (remoteServerId: string, minecraftServerId: string, maxRam: number) => Promise<void>
    remoteMinecraftServerStop: (remoteServerId: string, minecraftServerId: string, force?: boolean) => Promise<void>
    remoteMinecraftServerCommand: (remoteServerId: string, minecraftServerId: string, command: string) => Promise<void>
    remoteMinecraftServerReadProperties: (remoteServerId: string, minecraftServerId: string) => Promise<string>
    remoteMinecraftServerWriteProperties: (remoteServerId: string, minecraftServerId: string, content: string) => Promise<void>
    remoteDeploymentPreflight: (remoteServerId: string, input: RemoteDeploymentInput) => Promise<RemoteDeploymentPreflight>
    remoteDeploymentStart: (remoteServerId: string, input: RemoteDeploymentInput) => Promise<RemoteDeploymentJob>
    remoteDeploymentJobs: (remoteServerId: string) => Promise<RemoteDeploymentJob[]>
    remoteDeploymentCancel: (remoteServerId: string, jobId: string) => Promise<RemoteDeploymentJob>
    onRemoteDeploymentProgress: (callback: (job: RemoteDeploymentJob) => void) => () => void
    onServerLog: (callback: (event: ServerLogEvent) => void) => () => void
    onServerStatus: (callback: (state: ServerRuntimeState) => void) => () => void
    onServerPlayers: (callback: (snapshot: ServerPlayerSnapshot) => void) => () => void
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    onJavaDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    frpStop: () => Promise<void>
    frpStatus: () => Promise<string>
    frpLogs: () => Promise<string[]>
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
