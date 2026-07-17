import { app, BrowserWindow, Menu } from 'electron'
import * as path from 'path'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

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

app.whenReady().then(() => {
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
