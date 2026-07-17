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
  }

  interface ElectronAPI {
    getCores: () => Promise<CoreInfo[]>
    getVersions: (coreId: string) => Promise<CoreVersion[]>
    downloadCore: (coreId: string, version: string, destDir: string) => Promise<string>
    startServer: (serverDir: string, jarName: string, maxRam: number, javaPath?: string) => Promise<void>
    stopServer: () => Promise<void>
    getServerStatus: () => Promise<string>
    sendServerCommand: (cmd: string) => Promise<void>
    serversList: () => Promise<ServerEntry[]>
    serversAdd: (s: ServerEntry) => Promise<void>
    serversRemove: (id: string, options?: { deleteFiles?: boolean }) => Promise<void>
    serversUpdate: (id: string, u: Partial<ServerEntry>) => Promise<void>
    onServersChanged: (callback: () => void) => () => void
    readFile: (filePath: string) => Promise<string>
    writeFile: (filePath: string, content: string) => Promise<void>
    selectDirectory: () => Promise<string | null>
    detectJava: () => Promise<JavaInfo | null>
    detectServer: (dir: string) => Promise<ServerDetection>
    getAppVersion: () => Promise<string>
    checkForUpdates: () => Promise<LatestReleaseInfo>
    downloadAndInstallUpdate: () => Promise<{ filePath: string; assetName: string }>
    openExternal: (url: string) => Promise<void>
    onServerLog: (callback: (log: string) => void) => () => void
    onServerStatus: (callback: (status: string) => void) => () => void
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
    frpStart: (config: FrpConfig) => Promise<void>
    frpStop: () => Promise<void>
    frpStatus: () => Promise<string>
    onFrpLog: (callback: (log: string) => void) => () => void
    onFrpStatus: (callback: (status: string) => void) => () => void
  }

  interface FrpConfig {
    serverAddr: string
    serverPort: number
    token: string
    localPort: number
    remotePort: number
  }

  interface Window {
    electronAPI: ElectronAPI
  }
}
