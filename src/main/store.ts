import { randomUUID } from 'crypto'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeFsPath } from './security/pathPolicy'
import { readJsonStore, writeJsonStore } from './utils/jsonStore'

export interface ServerEntry {
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

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeStoredServer(value: unknown): ServerEntry | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ServerEntry>
  const id = text(item.id)
  const directory = text(item.path)
  const jarName = text(item.jarName)
  if (!id || !directory || !jarName || path.basename(jarName) !== jarName) return null
  return {
    id,
    name: text(item.name, '未命名服务器'),
    path: path.resolve(directory),
    coreId: text(item.coreId, 'unknown'),
    coreName: text(item.coreName, '未知'),
    version: text(item.version, '未知'),
    jarName,
    iconUrl: text(item.iconUrl) || undefined,
    createdAt: text(item.createdAt, new Date(0).toISOString()),
    maxRam: Number.isFinite(Number(item.maxRam)) ? Math.max(512, Math.min(131072, Number(item.maxRam))) : 2048,
    javaPath: text(item.javaPath) || undefined,
    managedPath: item.managedPath === true,
  }
}

function readStore(): ServerEntry[] {
  const raw = readJsonStore<unknown[]>(STORE_PATH, [], Array.isArray, '本地服务器')
  const servers = raw.map(normalizeStoredServer)
  if (servers.some(server => server === null)) throw new Error('本地服务器数据包含无效记录')
  return servers as ServerEntry[]
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
