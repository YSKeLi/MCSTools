export type RemoteServerOs = 'linux' | 'windows'

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
