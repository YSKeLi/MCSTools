import * as path from 'path'

export interface StoredServerEntry {
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

export interface InvalidStoredServer {
  index: number
  reason: string
  record: unknown
}

export interface StoredServerRepairResult {
  servers: StoredServerEntry[]
  invalid: InvalidStoredServer[]
  repairedCount: number
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function textOr(value: unknown, fallback: string): string {
  return text(value) || fallback
}

function normalizedJarName(value: unknown): string {
  const raw = text(value)
  return raw.replace(/\\/g, '/').split('/').pop() || ''
}

function normalizedMaxRam(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 2048
  return Math.max(512, Math.min(131072, Math.round(parsed)))
}

function normalizeStoredServer(
  value: unknown,
  generateId: () => string,
  now: () => string,
): { server: StoredServerEntry; repaired: boolean } | { reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { reason: '记录不是对象' }
  }

  const item = value as Partial<StoredServerEntry>
  const directory = text(item.path)
  if (!directory) return { reason: '缺少服务器目录 path' }

  const jarName = normalizedJarName(item.jarName)
  if (!jarName || !jarName.toLowerCase().endsWith('.jar')) {
    return { reason: '缺少有效的 JAR 文件名 jarName' }
  }

  const server: StoredServerEntry = {
    id: text(item.id) || generateId(),
    name: textOr(item.name, '未命名服务器'),
    path: path.resolve(directory),
    coreId: textOr(item.coreId, 'unknown'),
    coreName: textOr(item.coreName, '未知'),
    version: textOr(item.version, '未知'),
    jarName,
    iconUrl: text(item.iconUrl) || undefined,
    createdAt: text(item.createdAt) || now(),
    maxRam: normalizedMaxRam(item.maxRam),
    javaPath: text(item.javaPath) || undefined,
    managedPath: item.managedPath === true,
  }

  return {
    server,
    repaired: JSON.stringify(value) !== JSON.stringify(server),
  }
}

function uniqueId(generateId: () => string, usedIds: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = text(generateId())
    if (candidate && !usedIds.has(candidate)) return candidate
  }
  return `${Date.now()}-${usedIds.size + 1}`
}

export function repairStoredServers(
  records: unknown[],
  generateId: () => string,
  now: () => string = () => new Date().toISOString(),
): StoredServerRepairResult {
  const servers: StoredServerEntry[] = []
  const invalid: InvalidStoredServer[] = []
  const usedIds = new Set<string>()
  let repairedCount = 0

  records.forEach((record, index) => {
    const normalized = normalizeStoredServer(record, generateId, now)
    if ('reason' in normalized) {
      invalid.push({ index, reason: normalized.reason, record })
      return
    }

    let { server, repaired } = normalized
    if (usedIds.has(server.id)) {
      server = { ...server, id: uniqueId(generateId, usedIds) }
      repaired = true
    }
    usedIds.add(server.id)
    servers.push(server)
    if (repaired) repairedCount += 1
  })

  return { servers, invalid, repairedCount }
}
