import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'

export interface DownloadProgress {
  percent: number
  loaded: number
  total: number
  speed: number
  fileName: string
}

export function downloadFile(url: string, destPath: string, mainWindow?: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(destPath)
    let loaded = 0
    let lastChecked = Date.now()
    let lastLoaded = 0
    const fileName = path.basename(destPath)

    function emit() {
      if (!mainWindow) return
      const now = Date.now()
      const elapsed = (now - lastChecked) / 1000
      let speed = 0
      if (elapsed > 0) {
        speed = Math.round((loaded - lastLoaded) / elapsed)
      }
      lastChecked = now
      lastLoaded = loaded
    }

    protocol.get(url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10)

      res.on('data', (chunk: Buffer) => {
        file.write(chunk)
        loaded += chunk.length
        if (total && mainWindow) {
          const now = Date.now()
          const elapsed = (now - lastChecked) / 1000
          let speed = 0
          if (elapsed > 0) { speed = Math.round((loaded - lastLoaded) / elapsed) }
          lastChecked = now
          lastLoaded = loaded
          mainWindow.webContents.send('download:progress', {
            percent: Math.round((loaded / total) * 100),
            loaded,
            total,
            speed,
            fileName,
          } satisfies DownloadProgress)
        }
      })

      res.on('end', () => { file.end(); resolve() })
      res.on('error', (err) => { file.close(); if (fs.existsSync(destPath)) fs.unlinkSync(destPath); reject(err) })
    }).on('error', (err) => {
      file.close()
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      reject(err)
    })
  })
}

export function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, { headers: { 'User-Agent': 'MinecraftServerTools/0.1.0' } }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T) }
        catch (e) { reject(new Error(`JSON 解析失败: ${e}`)) }
      })
    }).on('error', reject)
  })
}

export function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, { headers: { 'User-Agent': 'MinecraftServerTools/0.1.0' } }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => { resolve(data) })
    }).on('error', reject)
  })
}
