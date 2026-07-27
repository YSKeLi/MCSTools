import type { RemoteServerOs } from './types'

export interface RemoteServerProfile {
  serverName?: string
  gameVersion?: string
  coreType?: string
  coreName?: string
}

function unquoteToml(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return trimmed
}

export function parseRemoteServerProfile(text: string): RemoteServerProfile {
  const result: RemoteServerProfile = {}

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = unquoteToml(trimmed.slice(separator + 1))
    if (key === 'server_name') result.serverName = value
    if (key === 'game_version') result.gameVersion = value
    if (key === 'core_type') result.coreType = value
    if (key === 'core_name') result.coreName = value
  }

  return result
}

export function remoteBaseName(remotePath: string): string {
  const normalized = remotePath.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || remotePath
}

export function normalizeRemotePath(os: RemoteServerOs, value: unknown): string {
  const remotePath = typeof value === 'string' ? value.trim() : ''
  if (!remotePath || remotePath.length > 4096 || /[\0\r\n]/.test(remotePath)) throw new Error('远程服务器目录无效')
  if (os !== 'windows') {
    if (!remotePath.startsWith('/')) throw new Error(`${os === 'macos' ? 'macOS' : 'Linux'} 服务器目录必须使用绝对路径`)
    return remotePath.length > 1 ? remotePath.replace(/\/+$/, '') : remotePath
  }
  if (!/^[a-z]:[\\/]/i.test(remotePath)) throw new Error('Windows Server 目录必须使用完整盘符路径')
  const normalized = remotePath.replace(/\\/g, '/')
  return /^[a-z]:\/$/i.test(normalized) ? normalized : normalized.replace(/\/+$/, '')
}

export function remoteParentPath(os: RemoteServerOs, value: string): string | null {
  const remotePath = normalizeRemotePath(os, value)
  if (os !== 'windows') {
    if (remotePath === '/') return null
    const separator = remotePath.lastIndexOf('/')
    return separator <= 0 ? '/' : remotePath.slice(0, separator)
  }
  if (/^[a-z]:\/$/i.test(remotePath)) return ''
  const separator = remotePath.lastIndexOf('/')
  return separator <= 2 ? `${remotePath.slice(0, 2)}/` : remotePath.slice(0, separator)
}

export function remoteJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .join('/')
}

export function validateRemoteJarName(value: unknown): string {
  const jarName = typeof value === 'string' ? value.trim() : ''
  if (!jarName || jarName.length > 255 || /[\\/\0\r\n]/.test(jarName) || !jarName.toLowerCase().endsWith('.jar')) {
    throw new Error('远程服务端 JAR 文件名无效')
  }
  return jarName
}
