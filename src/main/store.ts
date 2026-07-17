import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

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
}

const STORE_PATH = path.join(app.getPath('userData'), 'servers.json')

function readStore(): ServerEntry[] {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'))
    }
  } catch { /* ignore */ }
  return []
}

function writeStore(list: ServerEntry[]) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(list, null, 2), 'utf-8')
}

export function getServers(): ServerEntry[] { return readStore() }

export function addServer(s: ServerEntry) {
  const list = readStore()
  list.push(s)
  writeStore(list)
}

export function removeServer(id: string) {
  writeStore(readStore().filter(s => s.id !== id))
}

export function updateServer(id: string, u: Partial<ServerEntry>) {
  const list = readStore()
  const idx = list.findIndex(s => s.id === id)
  if (idx !== -1) { list[idx] = { ...list[idx], ...u }; writeStore(list) }
}
