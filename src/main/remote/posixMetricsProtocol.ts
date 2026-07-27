import type { RemoteServerMetrics } from './types'

function numberField(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function percentage(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

export function parsePosixMetrics(output: string, os: 'linux' | 'macos'): RemoteServerMetrics {
  const fields: Record<string, string> = {}
  output.split(/\r?\n/).forEach(line => {
    const separator = line.indexOf('=')
    if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1).trim()
  })
  const memoryTotal = numberField(fields.memory_total_kb) * 1024
  const memoryAvailable = numberField(fields.memory_available_kb) * 1024
  const diskTotal = numberField(fields.disk_total_kb) * 1024
  const diskUsed = numberField(fields.disk_used_kb) * 1024
  const diskAvailable = numberField(fields.disk_available_kb) * 1024
  const osLabel = os === 'macos' ? 'macOS' : 'Linux'
  if (!fields.hostname || memoryTotal <= 0 || diskTotal <= 0) {
    throw new Error(`无法解析 ${osLabel} 服务器指标，请确认所选系统正确`)
  }
  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable)
  return {
    fetchedAt: new Date().toISOString(),
    hostname: fields.hostname,
    osName: fields.os_name || osLabel,
    kernel: fields.kernel || '',
    uptimeSeconds: numberField(fields.uptime_seconds),
    cpu: {
      model: fields.cpu_model || 'Unknown CPU',
      cores: numberField(fields.cpu_cores, 1),
      usagePercent: numberField(fields.cpu_usage_tenths) / 10,
      loadAverage: numberField(fields.load_average),
    },
    memory: {
      totalBytes: memoryTotal,
      usedBytes: memoryUsed,
      availableBytes: memoryAvailable,
      usagePercent: percentage(memoryUsed, memoryTotal),
    },
    disk: {
      filesystem: fields.disk_filesystem || '',
      mount: fields.disk_mount || '/',
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      usagePercent: percentage(diskUsed, diskTotal),
    },
  }
}
