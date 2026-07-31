import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import extractZip from 'extract-zip'
import * as tar from 'tar'
import type { RemoteMinecraftLaunchSpec, RemoteServerOs } from './types'

const MAX_ARCHIVE_FILES = 50_000
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024

function validateArchiveEntryPath(entryPath: string): void {
  const normalized = entryPath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    throw new Error('压缩包包含绝对路径')
  }
  if (normalized.split('/').includes('..')) throw new Error('压缩包包含越界路径')
  if (/[\0\r\n\t]/.test(normalized)) throw new Error('压缩包包含不支持的文件名')
}

function createArchiveLimitTracker(): (size: number, isFile: boolean) => void {
  let fileCount = 0
  let totalBytes = 0
  return (size, isFile) => {
    if (!isFile) return
    fileCount += 1
    totalBytes += size
    if (fileCount > MAX_ARCHIVE_FILES) throw new Error(`压缩包文件数超过 ${MAX_ARCHIVE_FILES}`)
    if (!Number.isSafeInteger(size) || size < 0 || totalBytes > MAX_ARCHIVE_BYTES) {
      throw new Error('压缩包解压后超过 16 GB')
    }
  }
}

async function validateTarArchive(archivePath: string): Promise<void> {
  const track = createArchiveLimitTracker()
  await tar.list({
    file: archivePath,
    strict: true,
    onReadEntry: entry => {
      validateArchiveEntryPath(entry.path)
      if (entry.meta) return
      if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'Directory') {
        throw new Error('压缩包包含链接或特殊文件，已拒绝部署')
      }
      track(entry.size, entry.type !== 'Directory')
    },
  })
}

export interface LocalDeploymentFile {
  localPath: string
  relativePath: string
  size: number
}

export interface PreparedArchiveDeployment {
  rootPath: string
  directories: string[]
  files: LocalDeploymentFile[]
  launch: RemoteMinecraftLaunchSpec
}

function normalizedRelativePath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath).split(path.sep).join('/')
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new Error('压缩包包含越界路径')
  }
  if (/[\0\r\n\t]/.test(relativePath)) throw new Error('压缩包包含不支持的文件名')
  return relativePath
}

function deploymentRoot(extractedPath: string): string {
  const entries = fs.readdirSync(extractedPath, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) return path.join(extractedPath, entries[0].name)
  return extractedPath
}

function collectDeploymentTree(rootPath: string): { directories: string[]; files: LocalDeploymentFile[] } {
  const directories: string[] = []
  const files: LocalDeploymentFile[] = []
  const pending = [rootPath]
  let totalBytes = 0

  while (pending.length > 0) {
    const directoryPath = pending.pop()!
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name)
      const stats = fs.lstatSync(entryPath)
      if (stats.isSymbolicLink()) throw new Error('压缩包包含符号链接，已拒绝部署')
      if (stats.isDirectory()) {
        const relativePath = normalizedRelativePath(rootPath, entryPath)
        directories.push(relativePath)
        pending.push(entryPath)
        continue
      }
      if (!stats.isFile()) throw new Error('压缩包包含不支持的特殊文件')
      const relativePath = normalizedRelativePath(rootPath, entryPath)
      totalBytes += stats.size
      if (files.length >= MAX_ARCHIVE_FILES) throw new Error(`压缩包文件数超过 ${MAX_ARCHIVE_FILES}`)
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('压缩包解压后超过 16 GB')
      files.push({ localPath: entryPath, relativePath, size: stats.size })
    }
  }

  directories.sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return { directories, files }
}

function preferredJar(relativePaths: string[], coreId: string): string | null {
  const jars = relativePaths.filter(relativePath => {
    const lower = relativePath.toLowerCase()
    return lower.endsWith('.jar')
      && !lower.includes('/libraries/')
      && !lower.startsWith('libraries/')
      && !lower.includes('installer')
      && !lower.endsWith('-sources.jar')
  })
  const preferredNames = [
    'quilt-server-launch.jar',
    'fabric-server-launch.jar',
    'server.jar',
  ]
  for (const preferred of preferredNames) {
    const match = jars.find(relativePath => path.posix.basename(relativePath).toLowerCase() === preferred)
    if (match) return match
  }
  const normalizedCoreId = coreId.trim().toLowerCase()
  if (normalizedCoreId === 'forge' || normalizedCoreId === 'neoforge') {
    const coreJars = jars.filter(relativePath => path.posix.basename(relativePath).toLowerCase().startsWith(`${normalizedCoreId}-`))
    const universal = coreJars.find(relativePath => path.posix.basename(relativePath).toLowerCase().endsWith('-universal.jar'))
    if (universal) return universal
    if (coreJars.length === 1) return coreJars[0]
  }
  return jars.length === 1 ? jars[0] : null
}

export function selectDeploymentLaunch(
  relativePaths: string[],
  os: RemoteServerOs,
  coreId: string,
): RemoteMinecraftLaunchSpec {
  const normalizedPaths = relativePaths.map(relativePath => relativePath.replace(/\\/g, '/'))
  if (coreId.trim().toLowerCase() === 'bedrock-server') {
    const expectedName = os === 'windows' ? 'bedrock_server.exe' : 'bedrock_server'
    const nativeTarget = normalizedPaths.find(relativePath => path.posix.basename(relativePath).toLowerCase() === expectedName)
    if (!nativeTarget) throw new Error(`压缩包中没有找到 ${expectedName}`)
    return { kind: 'native', target: nativeTarget }
  }

  const argsName = os === 'windows' ? 'win_args.txt' : 'unix_args.txt'
  const argsTargets = normalizedPaths.filter(relativePath => path.posix.basename(relativePath).toLowerCase() === argsName)
  if (argsTargets.length === 1) return { kind: 'java-args', target: argsTargets[0] }

  const jarTarget = preferredJar(normalizedPaths, coreId)
  if (jarTarget) return { kind: 'jar', target: jarTarget }
  throw new Error('无法从部署产物中确定唯一的服务端启动文件')
}

export async function prepareRemoteDeploymentArchive(
  archivePath: string,
  extractedPath: string,
  os: RemoteServerOs,
  coreId: string,
): Promise<PreparedArchiveDeployment> {
  fs.mkdirSync(extractedPath, { recursive: true })
  const lowerName = archivePath.toLowerCase()
  if (lowerName.endsWith('.zip')) {
    const track = createArchiveLimitTracker()
    await extractZip(archivePath, {
      dir: path.resolve(extractedPath),
      onEntry: entry => {
        validateArchiveEntryPath(entry.fileName)
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff
        const fileType = mode & 0o170000
        if (fileType === 0o120000) throw new Error('压缩包包含符号链接，已拒绝部署')
        if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
          throw new Error('压缩包包含不支持的特殊文件')
        }
        const isDirectory = fileType === 0o040000 || entry.fileName.endsWith('/')
        track(entry.uncompressedSize, !isDirectory)
      },
    })
  } else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
    await validateTarArchive(archivePath)
    await tar.extract({
      cwd: extractedPath,
      file: archivePath,
      preservePaths: false,
      strict: true,
      filter: entryPath => {
        const normalized = entryPath.replace(/\\/g, '/')
        return !normalized.startsWith('/') && !normalized.split('/').includes('..')
      },
    })
  } else {
    throw new Error('不支持的服务端压缩包格式')
  }

  const rootPath = deploymentRoot(extractedPath)
  const tree = collectDeploymentTree(rootPath)
  if (tree.files.length === 0) throw new Error('服务端压缩包为空')
  return {
    rootPath,
    ...tree,
    launch: selectDeploymentLaunch(tree.files.map(file => file.relativePath), os, coreId),
  }
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = fs.createReadStream(filePath)
    input.on('error', reject)
    input.on('data', chunk => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}
