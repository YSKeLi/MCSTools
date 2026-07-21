import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { net, session } from 'electron'
import type { BrowserWindow, Session } from 'electron'

export interface DownloadProgress {
  percent: number
  loaded: number
  total: number
  speed: number
  fileName: string
}

export interface DownloadFileOptions {
  progressChannel?: string
  expectedSha256?: string
  expectedSize?: number
  allowedHosts?: string[]
}

export async function downloadFile(
  url: string,
  destPath: string,
  mainWindow?: BrowserWindow,
  options: DownloadFileOptions = {},
): Promise<void> {
  const tempPath = `${destPath}.part`
  const fileName = path.basename(destPath)
  const progressChannel = options.progressChannel || 'download:progress'
  assertAllowedDownloadUrl(url, options.allowedHosts)

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  removeFileIfExists(tempPath, '临时下载文件')

  try {
    await downloadAttempt(url, destPath, fileName, mainWindow, undefined, progressChannel, options)
  } catch (systemError) {
    const directSession = session.fromPartition('mcstools-download-direct', { cache: false })
    await directSession.setProxy({ mode: 'direct' })
    try {
      await downloadAttempt(url, destPath, fileName, mainWindow, directSession, progressChannel, options)
    } catch (directError) {
      const systemMessage = systemError instanceof Error ? systemError.message : String(systemError)
      const directMessage = directError instanceof Error ? directError.message : String(directError)
      throw new Error(`下载失败：系统网络 ${systemMessage}；直连 ${directMessage}`)
    }
  }
}

function downloadAttempt(
  url: string,
  destPath: string,
  fileName: string,
  mainWindow?: BrowserWindow,
  requestSession?: Session,
  progressChannel = 'download:progress',
  options: DownloadFileOptions = {},
): Promise<void> {
  const tempPath = `${destPath}.part`

  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      redirect: 'manual',
      ...(requestSession ? { session: requestSession } : {}),
    })
    let timeout: NodeJS.Timeout | undefined
    let file: fs.WriteStream | null = null
    let settled = false
    let loaded = 0
    let lastChecked = Date.now()
    let lastLoaded = 0
    let redirectCount = 0
    const hash = createHash('sha256')

    const clearInactivityTimeout = () => {
      if (timeout) clearTimeout(timeout)
      timeout = undefined
    }

    const rejectWithCleanup = (error: Error) => {
      try {
        removeFileIfExists(tempPath, '临时下载文件')
        reject(error)
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        reject(new Error(`${error.message}；${cleanupMessage}`))
      }
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearInactivityTimeout()
      request.abort()
      const output = file
      file = null

      if (output) {
        const finalize = () => rejectWithCleanup(error)
        if (output.closed) {
          finalize()
          return
        }
        output.once('close', finalize)
        output.destroy()
        return
      }

      rejectWithCleanup(error)
    }

    const resetInactivityTimeout = () => {
      clearInactivityTimeout()
      timeout = setTimeout(() => fail(new Error('下载连接超时')), 30000)
    }

    request.setHeader('User-Agent', 'MCServerTools/1.0')
    request.setHeader('Accept', '*/*')
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      try {
        redirectCount += 1
        if (redirectCount > 5) throw new Error('下载重定向次数过多')
        assertAllowedDownloadUrl(redirectUrl, options.allowedHosts)
        request.followRedirect()
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    request.on('error', (error) => fail(error))
    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        fail(new Error(`下载失败（HTTP ${response.statusCode}）`))
        return
      }

      const contentLength = response.headers['content-length']
      const rawTotal = Array.isArray(contentLength) ? contentLength[0] : contentLength
      const total = Number.parseInt(rawTotal || '0', 10) || 0
      file = fs.createWriteStream(tempPath)
      file.on('error', (error) => fail(error))

      response.on('error', (error) => fail(error))
      response.on('data', (chunk: Buffer) => {
        if (settled || !file) return
        resetInactivityTimeout()
        loaded += chunk.length
        hash.update(chunk)
        file.write(chunk)

        const now = Date.now()
        if (total > 0 && now - lastChecked >= 250 && mainWindow && !mainWindow.isDestroyed()) {
          const elapsed = (now - lastChecked) / 1000
          const speed = elapsed > 0 ? Math.round((loaded - lastLoaded) / elapsed) : 0
          lastChecked = now
          lastLoaded = loaded
          mainWindow.webContents.send(progressChannel, {
            percent: Math.min(100, Math.round((loaded / total) * 100)),
            loaded,
            total,
            speed,
            fileName,
          } satisfies DownloadProgress)
        }
      })

      response.on('end', () => {
        if (settled || !file) return
        clearInactivityTimeout()
        const output = file
        output.once('close', () => {
          if (settled) return
          try {
            if (loaded <= 0) throw new Error('下载结果为空')
            if (total > 0 && loaded !== total) throw new Error(`下载不完整（${loaded}/${total} 字节）`)
            if (options.expectedSize && loaded !== options.expectedSize) {
              throw new Error(`下载文件大小不匹配（${loaded}/${options.expectedSize} 字节）`)
            }
            if (options.expectedSha256) {
              const actualHash = hash.digest('hex')
              if (actualHash.toLowerCase() !== options.expectedSha256.toLowerCase()) {
                throw new Error('下载文件 SHA-256 校验失败')
              }
            }
            removeFileIfExists(destPath, '目标文件')
            fs.renameSync(tempPath, destPath)
            settled = true
            resolve()
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        })
        output.end()
      })
    })

    resetInactivityTimeout()
    request.end()
  })
}

function assertAllowedDownloadUrl(url: string, allowedHosts?: string[]) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('下载地址无效')
  }
  if (parsed.protocol !== 'https:') throw new Error('下载地址必须使用 HTTPS')
  if (!allowedHosts?.length) return

  const hostname = parsed.hostname.toLowerCase()
  const allowed = allowedHosts.some((entry) => {
    const expected = entry.toLowerCase()
    return expected.startsWith('.') ? hostname.endsWith(expected) : hostname === expected
  })
  if (!allowed) throw new Error(`下载重定向到了未授权域名：${hostname}`)
}

function removeFileIfExists(filePath: string, label: string) {
  try {
    fs.rmSync(filePath, { force: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}清理失败：${message}`)
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const data = await fetchText(url)
  try {
    return JSON.parse(data) as T
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function fetchText(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('请求地址无效'))
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('不支持的请求协议'))
      return
    }

    const protocol = parsed.protocol === 'https:' ? https : http
    const request = protocol.get(url, { headers: { 'User-Agent': 'MCServerTools' } }, (res) => {
      const statusCode = res.statusCode || 0
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirectCount >= 5) {
          reject(new Error('请求重定向次数过多'))
          return
        }
        const redirectUrl = new URL(res.headers.location, parsed).toString()
        fetchText(redirectUrl, redirectCount + 1).then(resolve, reject)
        return
      }
      if (statusCode < 200 || statusCode >= 300) {
        res.resume()
        reject(new Error(`请求失败（HTTP ${statusCode}）`))
        return
      }

      let data = ''
      let size = 0
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk)
        if (size > 10 * 1024 * 1024) {
          res.destroy(new Error('响应数据过大'))
          return
        }
        data += chunk
      })
      res.on('end', () => { resolve(data) })
      res.on('error', reject)
    })
    request.setTimeout(20000, () => request.destroy(new Error('请求超时')))
    request.on('error', reject)
  })
}
