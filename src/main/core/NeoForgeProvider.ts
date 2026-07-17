import { CoreProvider, CoreInfo, CoreVersion } from './CoreProvider'
import { fetchJson, fetchText, downloadFile } from '../utils/download'
import * as path from 'path'
import { BrowserWindow } from 'electron'

interface NeoVersion { version: string; latest: boolean }
type VersionSource = Promise<string[]>

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 请求超时`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export class NeoForgeProvider implements CoreProvider {
  info: CoreInfo = {
    id: 'neoforge', name: 'NeoForge', type: 'modded',
    description: 'Forge 的下一代分支，社区驱动开发',
    color: '#00BCD4', iconUrl: '/icons/neoforge.ico',
  }

  async fetchVersions(): Promise<CoreVersion[]> {
    const sources: VersionSource[] = [
      withTimeout(this.fetchFromApi(), 4000, 'NeoForge API'),
      withTimeout(this.fetchFromMetadataXml(), 4000, 'NeoForge metadata.xml'),
      withTimeout(this.fetchFromDirectoryIndex(), 4000, 'NeoForge directory index'),
    ]

    const firstAvailable = await this.getFirstNonEmptySource(sources)
    if (firstAvailable.length > 0) {
      return firstAvailable
        .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
        .map((v: string) => ({ id: v, type: 'release' as const }))
    }

    const settled = await Promise.allSettled(sources)
    const versions = new Set<string>()
    for (const source of settled) {
      if (source.status !== 'fulfilled') continue
      source.value.forEach(version => versions.add(version))
    }

    return Array.from(versions)
      .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .map((v: string) => ({ id: v, type: 'release' as const }))
  }

  private async getFirstNonEmptySource(sources: VersionSource[]): Promise<string[]> {
    return new Promise((resolve) => {
      if (sources.length === 0) {
        resolve([])
        return
      }

      let settledCount = 0
      let resolved = false

      const finish = (versions: string[]) => {
        if (resolved) return
        resolved = true
        resolve(versions)
      }

      for (const source of sources) {
        source.then(
          (versions) => {
            if (versions.length > 0) {
              finish(versions)
              return
            }
            settledCount += 1
            if (settledCount === sources.length) {
              finish([])
            }
          },
          () => {
            settledCount += 1
            if (settledCount === sources.length) {
              finish([])
            }
          }
        )
      }
    })
  }

  private async fetchFromApi(): Promise<string[]> {
    const data = await fetchJson<NeoVersion[] | { versions?: NeoVersion[] }>('https://api.neoforged.net/api/v1/versions')
    if (Array.isArray(data)) return data.map(v => v.version).filter(Boolean)
    return (data.versions || []).map(v => v.version).filter(Boolean)
  }

  private async fetchFromMetadataXml(): Promise<string[]> {
    const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml')
    return Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map(match => match[1]).filter(Boolean)
  }

  private async fetchFromDirectoryIndex(): Promise<string[]> {
    const html = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/')
    return Array.from(html.matchAll(/href="\.\/([^"/]+)\/"/g)).map(match => match[1]).filter(Boolean)
  }

  async download(version: string, destDir: string, win?: BrowserWindow): Promise<string> {
    const jarPath = path.join(destDir, 'neoforge.jar')
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-server.jar`
    await downloadFile(url, jarPath, win)
    return jarPath
  }

  getLaunchJar(serverDir: string) { return path.join(serverDir, 'neoforge.jar') }
  getDefaultArgs() { return [] }
}
