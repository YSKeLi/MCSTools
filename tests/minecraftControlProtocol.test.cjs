const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createManagedControlRecord,
  minecraftControlPath,
  minecraftPidPath,
  parseMinecraftControlDescriptor,
  readLocalMinecraftControl,
  removeLocalMinecraftControl,
  writeLocalMinecraftControl,
} = require('../dist/main/server/minecraftControlProtocol.js')

const commandFileControl = {
  version: 1,
  transport: 'command-file',
  logPath: 'C:\\runtime\\server.log',
  commandPath: 'C:\\runtime\\commands.ndjson',
  sessionId: 'session-1',
}

test('validates each supported Minecraft control transport', () => {
  assert.deepEqual(parseMinecraftControlDescriptor(commandFileControl), commandFileControl)
  assert.deepEqual(parseMinecraftControlDescriptor(JSON.stringify({
    version: 1,
    transport: 'fifo',
    logPath: '/srv/minecraft/.mcstools/server.log',
    inputPath: '/srv/minecraft/.mcstools/server.stdin',
  })), {
    version: 1,
    transport: 'fifo',
    logPath: '/srv/minecraft/.mcstools/server.log',
    inputPath: '/srv/minecraft/.mcstools/server.stdin',
  })
  assert.equal(parseMinecraftControlDescriptor({
    version: 1,
    transport: 'named-pipe',
    logPath: 'server.log',
    pipeName: '../unsafe',
  }), null)
})

test('publishes and removes local cross-entry control metadata by session', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-control-'))
  try {
    writeLocalMinecraftControl(directory, commandFileControl, process.pid)
    assert.deepEqual(readLocalMinecraftControl(directory), commandFileControl)
    assert.equal(fs.readFileSync(minecraftPidPath(directory), 'utf8'), String(process.pid))

    removeLocalMinecraftControl(directory, 'another-session')
    assert.equal(fs.existsSync(minecraftControlPath(directory)), true)
    removeLocalMinecraftControl(directory, commandFileControl.sessionId)
    assert.equal(fs.existsSync(minecraftControlPath(directory)), false)
    assert.equal(fs.existsSync(minecraftPidPath(directory)), false)
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

test('creates command records understood by the persistent process runner', () => {
  const record = JSON.parse(createManagedControlRecord(commandFileControl, 'stdin', 'list'))
  assert.equal(record.sessionId, commandFileControl.sessionId)
  assert.equal(record.type, 'stdin')
  assert.equal(record.value, 'list')
  assert.match(record.id, /^[0-9a-f-]{36}$/i)
})
