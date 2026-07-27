import { randomUUID } from 'crypto'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeFsPath } from './security/pathPolicy'
import { repairStoredServers, type InvalidStoredServer, type StoredServerEntry } from './serverStorePolicy'
import { readJsonStore, writeJsonStore } from './utils/jsonStore'

export type ServerEntry = StoredServerEntry

export interface ServerEntryInput {
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

export interface ServerEntryUpdate {
  name?: string
  maxRam?: number
  javaPath?: string
}

const STORE_PATH = path.join(app.getPath('userData'), 'servers.json')
const INVALID_STORE_PATH = path.join(app.getPath('userData'), 'servers.invalid.json')

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function writeInvalidRecords(records: InvalidStoredServer[]): void {
  if (!records.length) return

  try {
    if (fs.existsSync(INVALID_STORE_PATH)) {
      const existing = JSON.parse(fs.readFileSync(INVALID_STORE_PATH, 'utf8')) as { records?: unknown }
      if (JSON.stringify(existing.records) === JSON.stringify(records)) return
    }
  } catch {
    // Replace an unreadable previous report with the current one.
  }

  writeJsonStore(INVALID_STORE_PATH, {
    generatedAt: new Date().toISOString(),
    source: STORE_PATH,
    records,
  })
}

function readStore(): ServerEntry[] {
  const raw = readJsonStore<unknown[]>(STORE_PATH, [], Array.isArray, '本地服务器')
  const result = repairStoredServers(raw, randomUUID)
  if (!result.repairedCount && !result.invalid.length) return result.servers

  try {
    writeInvalidRecords(result.invalid)
  } catch (error) {
    console.warn('无法写入本地服务器坏记录报告:', error)
  }

  // If every record is invalid, keep the original file untouched. A later add still
  // writes a valid list and the normal .bak mechanism preserves that original file.
  if (result.servers.length > 0) {
    try {
      writeStore(result.servers)
    } catch (error) {
      console.warn('无法写回修复后的本地服务器数据:', error)
    }
  }

  console.warn(
    `本地服务器数据已容错处理：修复 ${result.repairedCount} 条，隔离 ${result.invalid.length} 条`,
  )
  return result.servers
}

function writeStore(list: ServerEntry[]) {
  writeJsonStore(STORE_PATH, list)
}

function validateInput(input: ServerEntryInput): Omit<ServerEntry, 'id' | 'createdAt'> {
  const name = text(input?.name)
  const directoryText = text(input?.path)
  const directory = path.resolve(directoryText)
  const jarName = text(input?.jarName)
  const maxRam = Number(input?.maxRam ?? 2048)
  if (!name || name.length > 100) throw new Error('服务器名称无效')
  if (!directoryText || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('服务器目录不存在')
  if (!jarName || path.basename(jarName) !== jarName || !jarName.toLowerCase().endsWith('.jar')) {
    throw new Error('JAR 文件名无效')
  }
  if (!Number.isInteger(maxRam) || maxRam < 512 || maxRam > 131072) throw new Error('服务器内存设置无效')
  const javaPath = text(input.javaPath) || undefined
  if (javaPath && (!fs.existsSync(javaPath) || !fs.statSync(javaPath).isFile())) throw new Error('Java 路径无效')
  return {
    name,
    path: directory,
    coreId: text(input.coreId, 'unknown'),
    coreName: text(input.coreName, '未知'),
    version: text(input.version, '未知'),
    jarName,
    iconUrl: text(input.iconUrl) || undefined,
    maxRam,
    javaPath,
    managedPath: input.managedPath === true,
  }
}

export function getServers(): ServerEntry[] {
  return readStore()
}

export function getServer(id: string): ServerEntry | undefined {
  return readStore().find(server => server.id === id)
}

export function addServer(input: ServerEntryInput): ServerEntry {
  const value = validateInput(input)
  const list = readStore()
  const normalizedPath = normalizeFsPath(value.path)
  if (list.some(server => normalizeFsPath(server.path) === normalizedPath)) {
    throw new Error('该服务器目录已经添加')
  }
  const entry: ServerEntry = {
    ...value,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  writeStore([...list, entry])
  return entry
}

export function removeServer(id: string): void {
  const list = readStore()
  if (!list.some(server => server.id === id)) return
  writeStore(list.filter(server => server.id !== id))
}

export function updateServer(id: string, updates: ServerEntryUpdate): ServerEntry {
  const list = readStore()
  const index = list.findIndex(server => server.id === id)
  if (index === -1) throw new Error('服务器不存在')

  const next = { ...list[index] }
  if (updates.name !== undefined) {
    const name = text(updates.name)
    if (!name || name.length > 100) throw new Error('服务器名称无效')
    next.name = name
  }
  if (updates.maxRam !== undefined) {
    const maxRam = Number(updates.maxRam)
    if (!Number.isInteger(maxRam) || maxRam < 512 || maxRam > 131072) throw new Error('服务器内存设置无效')
    next.maxRam = maxRam
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'javaPath')) {
    const javaPath = text(updates.javaPath) || undefined
    if (javaPath && (!fs.existsSync(javaPath) || !fs.statSync(javaPath).isFile())) throw new Error('Java 路径无效')
    next.javaPath = javaPath
  }

  list[index] = next
  writeStore(list)
  return next
}
