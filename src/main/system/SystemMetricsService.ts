import * as os from 'os'
import { bios, cpu, currentLoad, fsSize, osInfo, system } from 'systeminformation'
import type { LocalSystemMetrics } from './types'

export const LOCAL_DISK_CACHE_TTL_MS = 30_000

interface SystemMetricsDependencies {
  bios: typeof bios
  cpu: typeof cpu
  currentLoad: typeof currentLoad
  fsSize: typeof fsSize
  osInfo: typeof osInfo
  system: typeof system
  hostname: () => string
  architecture: () => string
  memory: () => { total: number; available: number }
  systemUptime: () => number
  processUptime: () => number
  now: () => number
}

type StaticMetrics = Omit<LocalSystemMetrics, 'fetchedAt' | 'uptimeSeconds' | 'memory' | 'disk'> & {
  uptimeAnchor: {
    systemSeconds: number
    processSeconds: number
  }
}

type DiskMetrics = LocalSystemMetrics['disk']

const defaultDependencies: SystemMetricsDependencies = {
  bios,
  cpu,
  currentLoad,
  fsSize,
  osInfo,
  system,
  hostname: os.hostname,
  architecture: os.arch,
  memory: () => ({ total: os.totalmem(), available: os.freemem() }),
  systemUptime: os.uptime,
  processUptime: process.uptime,
  now: Date.now,
}

function percentage(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function selectSystemDisk(disks: Awaited<ReturnType<typeof fsSize>>) {
  const systemDrive = (process.env.SystemDrive || '').toUpperCase()
  const preferred = systemDrive
    ? disks.find(disk => disk.mount.toUpperCase().startsWith(systemDrive))
    : disks.find(disk => disk.mount === '/')
  return preferred || [...disks].sort((left, right) => right.size - left.size)[0]
}

export function createLocalSystemMetricsService(
  overrides: Partial<SystemMetricsDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides }
  let staticMetricsPromise: Promise<StaticMetrics> | null = null
  let diskCache: { metrics: DiskMetrics; cachedAt: number } | null = null
  let diskRequest: Promise<DiskMetrics> | null = null

  function getStaticMetrics(): Promise<StaticMetrics> {
    if (!staticMetricsPromise) {
      const uptimeAnchor = {
        systemSeconds: dependencies.systemUptime(),
        processSeconds: dependencies.processUptime(),
      }

      staticMetricsPromise = Promise.all([
        dependencies.cpu(),
        dependencies.osInfo(),
        dependencies.system(),
        dependencies.bios(),
      ]).then(([cpuInfo, operatingSystem, device, biosInfo]) => {
        const fallbackCores = os.cpus().length
        const cpuModel = [cpuInfo.manufacturer, cpuInfo.brand].filter(Boolean).join(' ').trim()

        return {
          hostname: operatingSystem.hostname || dependencies.hostname(),
          manufacturer: device.manufacturer || '',
          model: device.model || '',
          architecture: operatingSystem.arch || dependencies.architecture(),
          osName: [operatingSystem.distro, operatingSystem.release].filter(Boolean).join(' ').trim() || operatingSystem.platform,
          kernel: operatingSystem.kernel || '',
          bios: {
            vendor: biosInfo.vendor || '',
            version: biosInfo.version || '',
            releaseDate: biosInfo.releaseDate || '',
          },
          cpu: {
            model: cpuModel || 'Unknown CPU',
            cores: cpuInfo.cores || fallbackCores,
            physicalCores: cpuInfo.physicalCores || cpuInfo.cores || fallbackCores,
            usagePercent: 0,
          },
          uptimeAnchor,
        }
      })
    }

    return staticMetricsPromise
  }

  async function readDiskMetrics(forceRefresh: boolean): Promise<DiskMetrics> {
    const now = dependencies.now()
    if (!forceRefresh && diskCache && now - diskCache.cachedAt < LOCAL_DISK_CACHE_TTL_MS) {
      return diskCache.metrics
    }
    if (diskRequest) return diskRequest

    diskRequest = dependencies.fsSize().then((disks) => {
      const disk = selectSystemDisk(disks)
      if (!disk) throw new Error('未检测到可用磁盘')

      const diskUsed = Math.max(0, disk.used)
      const metrics = {
        filesystem: disk.fs || '',
        mount: disk.mount || '',
        totalBytes: disk.size,
        usedBytes: diskUsed,
        availableBytes: Math.max(0, disk.available),
        usagePercent: percentage(diskUsed, disk.size),
      }
      diskCache = { metrics, cachedAt: dependencies.now() }
      return metrics
    })

    try {
      return await diskRequest
    } finally {
      diskRequest = null
    }
  }

  async function getMetrics(forceDiskRefresh = false): Promise<LocalSystemMetrics> {
    const memoryInfo = dependencies.memory()
    const [staticMetrics, loadInfo, disk] = await Promise.all([
      getStaticMetrics(),
      dependencies.currentLoad(),
      readDiskMetrics(forceDiskRefresh),
    ])
    const memoryUsed = Math.max(0, memoryInfo.total - memoryInfo.available)
    const elapsedProcessSeconds = Math.max(0, dependencies.processUptime() - staticMetrics.uptimeAnchor.processSeconds)
    const { uptimeAnchor, ...cachedStaticMetrics } = staticMetrics

    return {
      ...cachedStaticMetrics,
      fetchedAt: new Date(dependencies.now()).toISOString(),
      uptimeSeconds: Math.max(0, Math.floor(uptimeAnchor.systemSeconds + elapsedProcessSeconds)),
      cpu: {
        ...staticMetrics.cpu,
        usagePercent: Math.min(100, Math.max(0, loadInfo.currentLoad || 0)),
      },
      memory: {
        totalBytes: memoryInfo.total,
        usedBytes: memoryUsed,
        availableBytes: memoryInfo.available,
        usagePercent: percentage(memoryUsed, memoryInfo.total),
      },
      disk,
    }
  }

  return { getMetrics }
}

const localSystemMetricsService = createLocalSystemMetricsService()

export function getLocalSystemMetrics(forceDiskRefresh = false): Promise<LocalSystemMetrics> {
  return localSystemMetricsService.getMetrics(forceDiskRefresh)
}
