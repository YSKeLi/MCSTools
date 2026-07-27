export type LanguagePreference = 'system' | 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
export type CloseBehavior = 'quit' | 'tray'

export interface AppSettings {
  language: LanguagePreference
  accentColor: string
  backgroundImagePath: string | null
  backgroundTransparency: number
  autoLaunch: boolean
  closeBehavior: CloseBehavior
  checkUpdatesOnStartup: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'system',
  accentColor: '#267654',
  backgroundImagePath: null,
  backgroundTransparency: 35,
  autoLaunch: false,
  closeBehavior: 'tray',
  checkUpdatesOnStartup: true,
}

const languages = new Set<LanguagePreference>(['system', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko'])
const closeBehaviors = new Set<CloseBehavior>(['quit', 'tray'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampTransparency(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(Math.max(0, Math.min(100, parsed)))
}

function accentColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

export function sanitizeAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return { ...DEFAULT_APP_SETTINGS }

  return {
    language: languages.has(value.language as LanguagePreference)
      ? value.language as LanguagePreference
      : DEFAULT_APP_SETTINGS.language,
    accentColor: accentColor(value.accentColor, DEFAULT_APP_SETTINGS.accentColor),
    backgroundImagePath: typeof value.backgroundImagePath === 'string' && value.backgroundImagePath.trim()
      ? value.backgroundImagePath
      : null,
    backgroundTransparency: clampTransparency(
      value.backgroundTransparency,
      DEFAULT_APP_SETTINGS.backgroundTransparency,
    ),
    autoLaunch: typeof value.autoLaunch === 'boolean' ? value.autoLaunch : DEFAULT_APP_SETTINGS.autoLaunch,
    closeBehavior: closeBehaviors.has(value.closeBehavior as CloseBehavior)
      ? value.closeBehavior as CloseBehavior
      : DEFAULT_APP_SETTINGS.closeBehavior,
    checkUpdatesOnStartup: typeof value.checkUpdatesOnStartup === 'boolean'
      ? value.checkUpdatesOnStartup
      : DEFAULT_APP_SETTINGS.checkUpdatesOnStartup,
  }
}

export function applyAppSettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  if (!isRecord(patch)) throw new Error('应用设置无效')
  const supportedKeys = new Set<keyof AppSettings>([
    'language',
    'accentColor',
    'backgroundImagePath',
    'backgroundTransparency',
    'autoLaunch',
    'closeBehavior',
    'checkUpdatesOnStartup',
  ])
  for (const key of Object.keys(patch)) {
    if (!supportedKeys.has(key as keyof AppSettings)) throw new Error('应用设置包含不支持的字段')
  }
  if ('language' in patch && !languages.has(patch.language as LanguagePreference)) throw new Error('语言设置无效')
  if ('accentColor' in patch && accentColor(patch.accentColor, '') === '') throw new Error('主题色设置无效')
  if ('backgroundImagePath' in patch && patch.backgroundImagePath !== null && typeof patch.backgroundImagePath !== 'string') {
    throw new Error('背景图片设置无效')
  }
  if ('backgroundTransparency' in patch) {
    const value = Number(patch.backgroundTransparency)
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('背景透明度设置无效')
  }
  if ('autoLaunch' in patch && typeof patch.autoLaunch !== 'boolean') throw new Error('开机启动设置无效')
  if ('closeBehavior' in patch && !closeBehaviors.has(patch.closeBehavior as CloseBehavior)) throw new Error('关闭窗口行为设置无效')
  if ('checkUpdatesOnStartup' in patch && typeof patch.checkUpdatesOnStartup !== 'boolean') throw new Error('更新设置无效')
  return sanitizeAppSettings({ ...current, ...patch })
}
