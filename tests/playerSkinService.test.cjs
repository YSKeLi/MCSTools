const test = require('node:test')
const assert = require('node:assert/strict')
const { PlayerSkinService } = require('../dist/main/server/PlayerSkinService.js')

const PROFILE_ID = '069a79f444e94726a5befca90e38aaf5'

function textureValue(url, model) {
  return Buffer.from(JSON.stringify({
    textures: {
      SKIN: {
        url,
        ...(model ? { metadata: { model } } : {}),
      },
    },
  }), 'utf8').toString('base64')
}

test('resolves and caches an official slim player skin', async () => {
  const requests = []
  const service = new PlayerSkinService(async url => {
    requests.push(url)
    if (url.startsWith('https://api.mojang.com/')) {
      return { status: 200, body: { id: PROFILE_ID, name: 'Notch' } }
    }
    return {
      status: 200,
      body: {
        properties: [{
          name: 'textures',
          value: textureValue('http://textures.minecraft.net/texture/abcdef0123456789', 'slim'),
        }],
      },
    }
  })

  const first = await service.get('Notch')
  const second = await service.get('Notch')

  assert.deepEqual(first, {
    playerName: 'Notch',
    premium: true,
    skinUrl: 'https://textures.minecraft.net/texture/abcdef0123456789',
    model: 'slim',
  })
  assert.deepEqual(second, first)
  assert.equal(requests.length, 2)
})

test('uses a local default for offline and non-Java player names', async () => {
  let requests = 0
  const service = new PlayerSkinService(async () => {
    requests += 1
    return { status: 204, body: null }
  })

  const offline = await service.get('Offline_User')
  assert.equal(offline.premium, false)
  assert.equal(offline.skinUrl, null)
  assert.ok(offline.model === 'classic' || offline.model === 'slim')

  const bedrock = await service.get('.Bedrock_User')
  assert.equal(bedrock.premium, false)
  assert.equal(bedrock.skinUrl, null)
  assert.equal(requests, 1)
})

test('rejects texture URLs outside the official Minecraft texture host', async () => {
  const service = new PlayerSkinService(async url => {
    if (url.startsWith('https://api.mojang.com/')) {
      return { status: 200, body: { id: PROFILE_ID, name: 'Notch' } }
    }
    return {
      status: 200,
      body: {
        properties: [{
          name: 'textures',
          value: textureValue('https://example.com/texture/abcdef0123456789'),
        }],
      },
    }
  })

  const result = await service.get('Notch')
  assert.equal(result.premium, true)
  assert.equal(result.skinUrl, null)
})
