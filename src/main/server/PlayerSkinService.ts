export type PlayerSkinModel = 'classic' | 'slim'

export interface PlayerSkinInfo {
  playerName: string
  premium: boolean
  skinUrl: string | null
  model: PlayerSkinModel
}

interface JsonResponse {
  status: number
  body: unknown
}

export type PlayerSkinJsonRequest = (url: string) => Promise<JsonResponse>

interface CacheEntry {
  expiresAt: number
  value: Promise<PlayerSkinInfo>
}

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/
const PROFILE_ID_PATTERN = /^[a-f0-9]{32}$/i
const TEXTURE_PATH_PATTERN = /^\/texture\/[a-f0-9]+$/i
const PREMIUM_CACHE_MS = 6 * 60 * 60 * 1000
const FALLBACK_CACHE_MS = 10 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function defaultModel(seed: string): PlayerSkinModel {
  let hash = 0
  for (const character of seed) hash = ((hash * 31) + character.charCodeAt(0)) | 0
  return (hash & 1) === 0 ? 'classic' : 'slim'
}

function fallback(playerName: string, seed = playerName): PlayerSkinInfo {
  return {
    playerName,
    premium: false,
    skinUrl: null,
    model: defaultModel(seed),
  }
}

function parseTextureProperty(value: unknown): { skinUrl: string | null; model: PlayerSkinModel } {
  if (typeof value !== 'string' || value.length > 16 * 1024) return { skinUrl: null, model: 'classic' }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown
    if (!isRecord(decoded) || !isRecord(decoded.textures) || !isRecord(decoded.textures.SKIN)) {
      return { skinUrl: null, model: 'classic' }
    }

    const skin = decoded.textures.SKIN
    if (typeof skin.url !== 'string') return { skinUrl: null, model: 'classic' }
    const parsedUrl = new URL(skin.url)
    const validProtocol = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:'
    const validHost = parsedUrl.hostname === 'textures.minecraft.net' && parsedUrl.port === ''
    const validPath = TEXTURE_PATH_PATTERN.test(parsedUrl.pathname)
    const hasCredentials = parsedUrl.username !== '' || parsedUrl.password !== ''
    if (!validProtocol || !validHost || !validPath || hasCredentials || parsedUrl.search || parsedUrl.hash) {
      return { skinUrl: null, model: 'classic' }
    }

    const metadata = isRecord(skin.metadata) ? skin.metadata : null
    return {
      skinUrl: `https://textures.minecraft.net${parsedUrl.pathname}`,
      model: metadata?.model === 'slim' ? 'slim' : 'classic',
    }
  } catch {
    return { skinUrl: null, model: 'classic' }
  }
}

async function requestJson(url: string): Promise<JsonResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const body = response.status === 204 ? null : await response.json().catch(() => null)
    return { status: response.status, body }
  } finally {
    clearTimeout(timeout)
  }
}

export class PlayerSkinService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly request: PlayerSkinJsonRequest = requestJson) {}

  get(playerName: string): Promise<PlayerSkinInfo> {
    const normalizedName = String(playerName || '').trim()
    if (!PLAYER_NAME_PATTERN.test(normalizedName)) return Promise.resolve(fallback(normalizedName))

    const cacheKey = normalizedName.toLowerCase()
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const value = this.resolve(normalizedName).catch(() => fallback(normalizedName))
    const entry: CacheEntry = { expiresAt: Date.now() + FALLBACK_CACHE_MS, value }
    this.cache.set(cacheKey, entry)
    void value.then(result => {
      if (this.cache.get(cacheKey) === entry) {
        entry.expiresAt = Date.now() + (result.premium ? PREMIUM_CACHE_MS : FALLBACK_CACHE_MS)
      }
    })
    return value
  }

  private async resolve(playerName: string): Promise<PlayerSkinInfo> {
    const profileResponse = await this.request(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(playerName)}`,
    )
    if (profileResponse.status !== 200 || !isRecord(profileResponse.body)) return fallback(playerName)

    const profileId = profileResponse.body.id
    if (typeof profileId !== 'string' || !PROFILE_ID_PATTERN.test(profileId)) return fallback(playerName)

    const sessionResponse = await this.request(
      `https://sessionserver.mojang.com/session/minecraft/profile/${profileId}`,
    )
    if (sessionResponse.status !== 200 || !isRecord(sessionResponse.body)) return fallback(playerName, profileId)

    const properties = Array.isArray(sessionResponse.body.properties) ? sessionResponse.body.properties : []
    const texturesProperty = properties.find(property => (
      isRecord(property) && property.name === 'textures' && typeof property.value === 'string'
    ))
    const texture = parseTextureProperty(isRecord(texturesProperty) ? texturesProperty.value : null)

    return {
      playerName,
      premium: true,
      skinUrl: texture.skinUrl,
      model: texture.skinUrl ? texture.model : defaultModel(profileId),
    }
  }
}
