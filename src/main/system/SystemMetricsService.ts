import * as os from 'os'
import { cpu, currentLoad, fsSize, mem, osInfo, system } from 'systeminformation'
import type { LocalSystemMetrics } from './types'

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

export async function getLocalSystemMetrics(): Promise<LocalSystemMetrics> {
  const [cpuInfo, loadInfo, memoryInfo, disks, operatingSystem, device] = await Promise.all([
    cpu(),
    currentLoad(),
    mem(),
    fsSize(),
    osInfo(),
    system(),
  ])
  const disk = selectSystemDisk(disks)
  if (!disk) throw new Error('未检测到可用磁盘')

  const memoryUsed = Math.max(0, memoryInfo.total - memoryInfo.available)
  const diskAvailable = Math.max(0, disk.available)
  const diskUsed = Math.max(0, disk.used)
  const cpuModel = [cpuInfo.manufacturer, cpuInfo.brand].filter(Boolean).join(' ').trim()

  return {
    fetchedAt: new Date().toISOString(),
    hostname: operatingSystem.hostname || os.hostname(),
    manufacturer: device.manufacturer || '',
    model: device.model || '',
    architecture: operatingSystem.arch || os.arch(),
    osName: [operatingSystem.distro, operatingSystem.release].filter(Boolean).join(' ').trim() || operatingSystem.platform,
    kernel: operatingSystem.kernel || '',
    uptimeSeconds: Math.max(0, Math.floor(os.uptime())),
    cpu: {
      model: cpuModel || 'Unknown CPU',
      cores: cpuInfo.cores || os.cpus().length,
      physicalCores: cpuInfo.physicalCores || cpuInfo.cores || os.cpus().length,
      usagePercent: Math.min(100, Math.max(0, loadInfo.currentLoad || 0)),
    },
    memory: {
      totalBytes: memoryInfo.total,
      usedBytes: memoryUsed,
      availableBytes: memoryInfo.available,
      usagePercent: percentage(memoryUsed, memoryInfo.total),
    },
    disk: {
      filesystem: disk.fs || '',
      mount: disk.mount || '',
      totalBytes: disk.size,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      usagePercent: percentage(diskUsed, disk.size),
    },
  }
}
