import { app, BrowserWindow, Menu, protocol, shell, Tray } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { registerIpcHandlers, shutdownServices } from './ipc'
import { getAppSettings, getBackgroundImageResource } from './settings/AppSettingsStore'
import type { AppSettings, LanguagePreference } from './settings/settingsPolicy'

const BACKGROUND_SCHEME = 'mcst-background'

protocol.registerSchemesAsPrivileged([{
  scheme: BACKGROUND_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function log(message: string, extra?: unknown) {
  if (extra === undefined) {
    console.log(`[main] ${message}`)
    return
  }
  console.log(`[main] ${message}`, extra)
}

type SupportedLanguage = Exclude<LanguagePreference, 'system'>

function resolveLanguage(preference: LanguagePreference): SupportedLanguage {
  if (preference !== 'system') return preference
  const locale = app.getLocale().toLowerCase()
  if (locale.startsWith('zh-tw') || locale.startsWith('zh-hk') || locale.startsWith('zh-hant')) return 'zh-TW'
  if (locale.startsWith('zh')) return 'zh-CN'
  if (locale.startsWith('ja')) return 'ja'
  if (locale.startsWith('ko')) return 'ko'
  return 'en'
}

function trayLabels(language: SupportedLanguage) {
  const labels: Record<SupportedLanguage, { open: string; quit: string; tooltip: string }> = {
    'zh-CN': { open: '打开主窗口', quit: '退出', tooltip: 'Minecraft 服务器搭建工具' },
    'zh-TW': { open: '開啟主視窗', quit: '結束', tooltip: 'Minecraft 伺服器架設工具' },
    en: { open: 'Open main window', quit: 'Exit', tooltip: 'Minecraft Server Tools' },
    ja: { open: 'メイン画面を開く', quit: '終了', tooltip: 'Minecraft サーバーツール' },
    ko: { open: '메인 창 열기', quit: '종료', tooltip: 'Minecraft 서버 도구' },
  }
  return labels[language]
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(__dirname, '..', '..', 'public', 'icons', 'app-icon.png')
}

function refreshTrayMenu() {
  if (!tray) return
  const labels = trayLabels(resolveLanguage(getAppSettings().language))
  tray.setToolTip(labels.tooltip)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.open, click: showMainWindow },
    { type: 'separator' },
    { label: labels.quit, click: () => app.quit() },
  ]))
}

function ensureTray() {
  if (!tray) {
    tray = new Tray(trayIconPath())
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
  }
  refreshTrayMenu()
}

function applyAutoLaunchSetting(enabled: boolean) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: app.isPackaged || !process.argv[1] ? [] : [path.resolve(process.argv[1])],
    })
  } catch (error) {
    console.warn('[main] failed to update login item settings', error)
  }
}

function handleSettingsUpdated(settings: AppSettings) {
  applyAutoLaunchSetting(settings.autoLaunch)
  if (settings.closeBehavior === 'tray') {
    ensureTray()
  } else if (tray) {
    tray.destroy()
    tray = null
  }
}

function registerBackgroundProtocol() {
  protocol.handle(BACKGROUND_SCHEME, (request) => {
    const requestUrl = new URL(request.url)
    if (requestUrl.host !== 'current' || requestUrl.pathname !== '/image') {
      return new Response(null, { status: 404 })
    }

    const background = getBackgroundImageResource()
    if (!background) return new Response(null, { status: 404 })

    try {
      return new Response(fs.readFileSync(background.filePath), {
        headers: {
          'Content-Type': background.mimeType,
          'Cache-Control': 'no-store',
        },
      })
    } catch (error) {
      console.error('[main] failed to serve background image', error)
      return new Response(null, { status: 500 })
    }
  })
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const preloadPath = path.join(__dirname, 'preload.js')
  const isDev = !app.isPackaged
  const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Minecraft 服务器搭建工具',
    show: false,
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  log('creating window', { isDev, preloadPath })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(rendererUrl) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  mainWindow.once('ready-to-show', () => {
    log('window ready-to-show')
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('closed', () => {
    log('window closed')
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    if (getAppSettings().closeBehavior === 'tray') {
      event.preventDefault()
      mainWindow?.hide()
      ensureTray()
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    log('renderer loaded')
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[main] failed to load renderer', { code, description, url })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone', details)
  })

  if (mainWindow) {
    registerIpcHandlers(mainWindow, { onSettingsUpdated: handleSettingsUpdated })
  }

  try {
    if (isDev) {
      await mainWindow.loadURL(rendererUrl)
    } else {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  } catch (error) {
    console.error('[main] window bootstrap failed', error)
    mainWindow.show()
  }
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  void shutdownServices().finally(() => app.exit(0))
})

if (hasSingleInstanceLock) app.whenReady().then(() => {
  log('app ready')
  Menu.setApplicationMenu(null)
  registerBackgroundProtocol()
  const settings = getAppSettings()
  applyAutoLaunchSetting(settings.autoLaunch)
  if (settings.closeBehavior === 'tray') ensureTray()
  void createWindow()
})

app.on('window-all-closed', () => {
  log('all windows closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  log('app activate')
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  } else {
    mainWindow?.show()
    mainWindow?.focus()
  }
})
