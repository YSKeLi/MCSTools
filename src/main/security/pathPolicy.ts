import * as fs from 'fs'
import * as path from 'path'

export const SERVER_MARKER_FILE = '.mcservertools-server.json'

interface ServerMarker {
  id: string
  createdAt: string
}
export function normalizeFsPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = normalizeFsPath(parentPath)
  const candidate = normalizeFsPath(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertSafeDirectory(directory: string): string {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('目录无效')
  const resolved = path.resolve(directory)
  if (resolved === path.parse(resolved).root) throw new Error('禁止使用磁盘根目录')
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('目录不存在')
  return resolved
}

export function writeServerMarker(directory: string, serverId: string): void {
  const safeDirectory = assertSafeDirectory(directory)
  const marker: ServerMarker = { id: serverId, createdAt: new Date().toISOString() }
  fs.writeFileSync(path.join(safeDirectory, SERVER_MARKER_FILE), JSON.stringify(marker, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export function assertManagedServerDirectory(directory: string, serverId: string): string {
  const safeDirectory = assertSafeDirectory(directory)
  const markerPath = path.join(safeDirectory, SERVER_MARKER_FILE)
  let marker: ServerMarker
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as ServerMarker
  } catch {
    throw new Error('该目录不是由软件创建的服务器目录，只能从列表移除，不能删除文件')
  }
  if (marker.id !== serverId) throw new Error('服务器目录安全标记不匹配，已拒绝删除')
  return safeDirectory
}
