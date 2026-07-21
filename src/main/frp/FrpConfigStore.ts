import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { FrpConfigSummary, ImportedFrpConfig } from './FrpManager'
import { readJsonStore, writeJsonStore } from '../utils/jsonStore'

export interface FrpSavedConfig {
  id: string
  name: string
  filePath: string
  fileName: string
  summary: FrpConfigSummary
  warnings: string[]
  importedAt: string
  lastUsedAt?: string
}

const STORE_PATH = path.join(app.getPath('userData'), 'frp-configs.json')

function readStore(): FrpSavedConfig[] {
  return readJsonStore<FrpSavedConfig[]>(
    STORE_PATH,
    [],
    (value): value is FrpSavedConfig[] => Array.isArray(value) && value.every(item => (
      item
      && typeof item === 'object'
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.filePath === 'string'
      && typeof item.importedAt === 'string'
    )),
    'FRP 配置',
  )
}

function writeStore(list: FrpSavedConfig[]) {
  writeJsonStore(STORE_PATH, list)
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase()
}

function normalizePath(filePath: string) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
}

export function listFrpConfigs(): FrpSavedConfig[] {
  return readStore().sort((left, right) => {
    const leftTime = left.lastUsedAt || left.importedAt
    const rightTime = right.lastUsedAt || right.importedAt
    return rightTime.localeCompare(leftTime)
  })
}

export function saveFrpConfig(name: string, imported: ImportedFrpConfig): FrpSavedConfig {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('请输入配置名称')
  if (!fs.existsSync(imported.filePath)) throw new Error('配置文件不存在，无法保存')

  const list = readStore()
  const normalizedName = normalizeName(trimmedName)
  const normalizedFilePath = normalizePath(imported.filePath)

  const duplicateName = list.find((item) => normalizeName(item.name) === normalizedName && normalizePath(item.filePath) !== normalizedFilePath)
  if (duplicateName) throw new Error('该配置名称已存在，请更换一个名称')

  const now = new Date().toISOString()
  const existingIndex = list.findIndex((item) => normalizePath(item.filePath) === normalizedFilePath)

  const entry: FrpSavedConfig = existingIndex >= 0
    ? {
      ...list[existingIndex],
      name: trimmedName,
      filePath: imported.filePath,
      fileName: imported.fileName,
      summary: imported.summary,
      warnings: imported.warnings,
    }
    : {
      id: `frp-${Date.now()}`,
      name: trimmedName,
      filePath: imported.filePath,
      fileName: imported.fileName,
      summary: imported.summary,
      warnings: imported.warnings,
      importedAt: now,
    }

  if (existingIndex >= 0) {
    list[existingIndex] = entry
  } else {
    list.push(entry)
  }

  writeStore(list)
  return entry
}

export function removeFrpConfig(id: string) {
  writeStore(readStore().filter((item) => item.id !== id))
}

export function getFrpConfig(id: string): FrpSavedConfig | undefined {
  return readStore().find((item) => item.id === id)
}

export function markFrpConfigUsed(id: string) {
  const list = readStore()
  const index = list.findIndex((item) => item.id === id)
  if (index === -1) return
  list[index] = {
    ...list[index],
    lastUsedAt: new Date().toISOString(),
  }
  writeStore(list)
}
