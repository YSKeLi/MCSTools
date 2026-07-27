export type RemoteServerOs = 'linux' | 'windows' | 'macos'

export interface RemoteServerInput {
  name: string
  host: string
  port: number
  username: string
  password: string
  os: RemoteServerOs
  expectedFingerprint?: string
}

export interface RemoteServerFingerprintInput {
  host: string
  port: number
  username: string
}

export interface RemoteServerSummary {
  id: string
  name: string
  host: string
  port: number
  username: string
  os: RemoteServerOs
  hostFingerprint: string
  createdAt: string
}

export interface RemoteServerMetrics {
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

export interface RemoteServerAddResult {
  server: RemoteServerSummary
  metrics: RemoteServerMetrics
}

export interface RemoteMinecraftDirectory {
  path: string
  name: string
  jarFiles: string[]
  suggestedJar: string
  suggestedType: string
  suggestedVersion: string
  suggestedRemark: string
}

export interface RemoteFileBrowserItem {
  name: string
  path: string
  type: 'directory' | 'file' | 'drive'
  size: number
}

export interface RemoteDirectoryListing {
  path: string
  parentPath: string | null
  items: RemoteFileBrowserItem[]
  containsServerProperties: boolean
}

export interface RemoteMinecraftServer {
  id: string
  name: string
  path: string
  jarName: string
  coreType: string
  version: string
  remark: string
  maxRam: number
  createdAt: string
}

export interface RemoteMinecraftServerInput {
  path: string
  jarName?: string
  coreType: string
  version: string
  remark: string
  maxRam?: number
}

export type RemoteMinecraftServerStatus = 'running' | 'external' | 'stopped' | 'error'
