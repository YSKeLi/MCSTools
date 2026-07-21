import { app, BrowserWindow, Menu, shell } from 'electron'
import * as path from 'path'
import { registerIpcHandlers, shutdownServices } from './ipc'

let mainWindow: BrowserWindow | null = null
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
    registerIpcHandlers(mainWindow)
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
  void createWindow()
})

app.on('window-all-closed', () => {
  log('all windows closed')
  app.quit()
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
