import * as fs from 'fs'
import * as path from 'path'

export function readJsonStore<T>(
  filePath: string,
  fallback: T,
  validate: (value: unknown) => value is T,
  label: string,
): T {
  const backupPath = `${filePath}.bak`
  if (!fs.existsSync(filePath) && !fs.existsSync(backupPath)) return fallback

  const read = (candidate: string): T | null => {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      return validate(value) ? value : null
    } catch {
      return null
    }
  }

  const primary = fs.existsSync(filePath) ? read(filePath) : null
  if (primary !== null) return primary

  const backup = fs.existsSync(backupPath) ? read(backupPath) : null
  if (backup !== null) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.copyFileSync(backupPath, filePath)
    return backup
  }

  throw new Error(`${label}数据已损坏，且备份无法恢复`)
}

export function writeJsonStore(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath)
  const tempPath = `${filePath}.${process.pid}.tmp`
  const backupPath = `${filePath}.bak`
  fs.mkdirSync(directory, { recursive: true })

  const descriptor = fs.openSync(tempPath, 'w', 0o600)
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }

  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath)
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}
