const test = require('node:test')
const assert = require('node:assert/strict')
const { parsePlayerConnectionEvent } = require('../dist/main/server/playerTracking.js')

test('parses vanilla player join and leave messages', () => {
  assert.deepEqual(
    parsePlayerConnectionEvent('[12:34:56] [Server thread/INFO]: Steve joined the game'),
    { action: 'join', playerName: 'Steve' },
  )
  assert.deepEqual(
    parsePlayerConnectionEvent('[12:35:10] [Server thread/INFO]: Steve left the game'),
    { action: 'leave', playerName: 'Steve' },
  )
})

test('parses names from namespaced and formatted log messages', () => {
  assert.deepEqual(
    parsePlayerConnectionEvent('[Server thread/INFO] [minecraft/MinecraftServer]: .Bedrock_User joined the game'),
    { action: 'join', playerName: '.Bedrock_User' },
  )
  assert.deepEqual(
    parsePlayerConnectionEvent('\u001b[32m[INFO]: \u00a7aAlex left the game\u001b[0m'),
    { action: 'leave', playerName: 'Alex' },
  )
})

test('ignores unrelated server output', () => {
  assert.equal(parsePlayerConnectionEvent('[INFO]: Done (1.23s)! For help, type "help"'), null)
  assert.equal(parsePlayerConnectionEvent('[INFO]: Player connected'), null)
})
