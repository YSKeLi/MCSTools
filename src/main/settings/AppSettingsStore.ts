import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { readJsonStore, writeJsonStore } from '../utils/jsonStore'
import {
  AppSettings,
  applyAppSettingsPatch,
  DEFAULT_APP_SETTINGS,
  sanitizeAppSettings,
} from './settingsPolicy'

export interface AppSettingsView extends Omit<AppSettings, 'backgroundImagePath'> {
  hasBackgroundImage: boolean
  backgroundImageUrl: string | null
}

export interface BackgroundImageResource {
  filePath: string
  mimeType: string
  modifiedAt: number
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')
const BACKGROUND_PREFIX = 'custom-background'
const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024
const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function removeStoredBackgrounds(exceptPath?: string): void {
  const userData = app.getPath('userData')
  if (!fs.existsSync(userData)) return
  const keep = exceptPath ? path.resolve(exceptPath) : null
  for (const entry of fs.readdirSync(userData, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(BACKGROUND_PREFIX)) continue
    if (!imageTypes[path.extname(entry.name).toLowerCase()]) continue
    const candidate = path.resolve(userData, entry.name)
    if (candidate !== keep) fs.rmSync(candidate, { force: true })
  }
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAppSettings(): AppSettings {
  const stored = readJsonStore<Record<string, unknown>>(
    SETTINGS_PATH,
    { ...DEFAULT_APP_SETTINGS },
    isSettingsRecord,
    '应用设置',
  )
  return sanitizeAppSettings(stored)
}

export function updateAppSettings(patch: unknown): AppSettings {
  const next = applyAppSettingsPatch(getAppSettings(), patch)
  writeJsonStore(SETTINGS_PATH, next)
  return next
}

function safeBackgroundPath(filePath: string | null): string | null {
  if (!filePath) return null
  const resolved = path.resolve(filePath)
  const userData = path.resolve(app.getPath('userData'))
  if (path.dirname(resolved) !== userData) return null
  if (!path.basename(resolved).startsWith(BACKGROUND_PREFIX)) return null
  if (!imageTypes[path.extname(resolved).toLowerCase()]) return null
  return resolved
}

export function getBackgroundImageResource(filePath = getAppSettings().backgroundImagePath): BackgroundImageResource | null {
  const safePath = safeBackgroundPath(filePath)
  if (!safePath || !fs.existsSync(safePath)) return null
  try {
    const stat = fs.statSync(safePath)
    if (!stat.isFile() || stat.size > MAX_BACKGROUND_BYTES) return null
    return {
      filePath: safePath,
      mimeType: imageTypes[path.extname(safePath).toLowerCase()],
      modifiedAt: stat.mtimeMs,
    }
  } catch {
    return null
  }
}

export function getAppSettingsView(settings = getAppSettings()): AppSettingsView {
  const background = getBackgroundImageResource(settings.backgroundImagePath)
  return {
    language: settings.language,
    accentColor: settings.accentColor,
    backgroundTransparency: settings.backgroundTransparency,
    autoLaunch: settings.autoLaunch,
    closeBehavior: settings.closeBehavior,
    checkUpdatesOnStartup: settings.checkUpdatesOnStartup,
    hasBackgroundImage: background !== null,
    backgroundImageUrl: background
      ? `mcst-background://current/image?v=${encodeURIComponent(String(background.modifiedAt))}`
      : null,
  }
}

export function saveBackgroundImage(sourcePath: string): AppSettings {
  const resolved = path.resolve(sourcePath)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('背景图片不存在')
  if (fs.statSync(resolved).size > MAX_BACKGROUND_BYTES) throw new Error('背景图片不能超过 20 MB')

  const extension = path.extname(resolved).toLowerCase()
  if (!imageTypes[extension]) throw new Error('仅支持 PNG、JPG、WEBP、GIF 或 BMP 图片')

  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const destination = path.join(userData, `${BACKGROUND_PREFIX}-${Date.now()}${extension}`)
  fs.copyFileSync(resolved, destination)
  try {
    const currentSettings = getAppSettings()
    const settings = updateAppSettings({
      backgroundImagePath: destination,
      backgroundTransparency: currentSettings.backgroundTransparency === 100
        ? DEFAULT_APP_SETTINGS.backgroundTransparency
        : currentSettings.backgroundTransparency,
    })
    removeStoredBackgrounds(destination)
    return settings
  } catch (error) {
    fs.rmSync(destination, { force: true })
    throw error
  }
}

export function clearBackgroundImage(): AppSettings {
  const settings = updateAppSettings({ backgroundImagePath: null })
  removeStoredBackgrounds()
  return settings
}
