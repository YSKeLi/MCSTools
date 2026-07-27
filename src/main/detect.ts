import * as fs from 'fs'
import * as path from 'path'

export interface ServerDetection {
  jarName: string
  coreId: string
  coreName: string
  version: string
  jarFiles: string[]
}

export interface ServerJarFile {
  name: string
  size: number
}

const patterns: Array<{ regex: RegExp; id: string; name: string }> = [
  { regex: /^paper-?(\d[\d.]*)?/i, id: 'paper', name: 'Paper' },
  { regex: /^purpur-?(\d[\d.]*)?/i, id: 'purpur', name: 'Purpur' },
  { regex: /^leaf-?(\d[\d.]*)?/i, id: 'leaf', name: 'Leaf' },
  { regex: /^folia-?(\d[\d.]*)?/i, id: 'folia', name: 'Folia' },
  { regex: /^leaves-?(\d[\d.]*)?/i, id: 'leaves', name: 'Leaves' },
  { regex: /^pufferfish-?(\d[\d.]*)?/i, id: 'pufferfish', name: 'Pufferfish' },
  { regex: /^forge-?(\d[\d.]*)?/i, id: 'forge', name: 'Forge' },
  { regex: /^fabric-?(\d[\d.]*)?/i, id: 'fabric', name: 'Fabric' },
  { regex: /^quilt-?(\d[\d.]*)?/i, id: 'quilt', name: 'Quilt' },
  { regex: /^neoforge-?(\d[\d.]*)?/i, id: 'neoforge', name: 'NeoForge' },
  { regex: /^spongevanilla-?(\d[\d.]*)?/i, id: 'sponge', name: 'Sponge' },
  { regex: /^spongeforge-?(\d[\d.]*)?/i, id: 'spongeforge', name: 'SpongeForge' },
  { regex: /^mohist-?(\d[\d.]*)?/i, id: 'mohist', name: 'Mohist' },
  { regex: /^catserver-?(\d[\d.]*)?/i, id: 'catserver', name: 'CatServer' },
  { regex: /^arclight(?:-forge|-neoforge|-fabric)?-?(\d[\d.]*)?/i, id: 'arclight', name: 'Arclight' },
  { regex: /^banner-?(\d[\d.]*)?/i, id: 'banner', name: 'Banner' },
  { regex: /^craftbukkit-?(\d[\d.]*)?/i, id: 'craftbukkit', name: 'CraftBukkit' },
  { regex: /^spigot-?(\d[\d.]*)?/i, id: 'spigot', name: 'Spigot' },
  { regex: /^velocity-?(\d[\d.]*)?/i, id: 'velocity', name: 'Velocity' },
  { regex: /^bungeecord-?(\d[\d.]*)?/i, id: 'bungeecord', name: 'BungeeCord' },
  { regex: /^travertine-?(\d[\d.]*)?/i, id: 'travertine', name: 'Travertine' },
  { regex: /^lightfall-?(\d[\d.]*)?/i, id: 'lightfall', name: 'Lightfall' },
  { regex: /^nukkitx-?(\d[\d.]*)?/i, id: 'nukkitx', name: 'NukkitX' },
  { regex: /^server\.jar$/i, id: 'vanilla', name: 'Vanilla' },
]

export function detectServerFiles(jarFiles: ServerJarFile[]): ServerDetection {
  const files = jarFiles.map(file => file.name)

  for (const file of files) {
    for (const p of patterns) {
      const m = file.match(p.regex)
      if (m) {
        return { jarName: file, coreId: p.id, coreName: p.name, version: m[1]?.replace(/\.+$/, '') || '未知', jarFiles: files }
      }
    }
  }

  const largest = [...jarFiles].sort((a, b) => b.size - a.size)

  return {
    jarName: largest[0]?.name || 'server.jar',
    coreId: 'unknown',
    coreName: largest[0]?.name?.replace(/\.jar$/i, '') || '未知',
    version: '未知',
    jarFiles: files,
  }
}

export function detectServer(dir: string): ServerDetection {
  let files: ServerJarFile[] = []
  try {
    files = fs.readdirSync(dir)
      .filter(file => file.toLowerCase().endsWith('.jar'))
      .map(file => ({ name: file, size: fs.statSync(path.join(dir, file)).size }))
  } catch { /* ignore */ }
  return detectServerFiles(files)
}
