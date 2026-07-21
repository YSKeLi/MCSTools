export interface LocalSystemMetrics {
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
