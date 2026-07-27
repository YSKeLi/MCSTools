const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  hasLiveRemoteMinecraftMarker,
  isExternalMinecraftProcess,
} = require('../dist/main/server/externalMinecraftProcess.js')

test('recognizes a live remote Minecraft PID marker on the local machine', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-external-process-'))
  try {
    const runtimeDirectory = path.join(directory, '.mcstools')
    fs.mkdirSync(runtimeDirectory)
    fs.writeFileSync(path.join(runtimeDirectory, 'server.pid'), String(process.pid), 'utf8')

    assert.equal(hasLiveRemoteMinecraftMarker(directory), true)
    assert.equal(await isExternalMinecraftProcess(directory, 'server.jar'), true)
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

test('ignores malformed remote Minecraft PID markers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-invalid-process-'))
  try {
    const runtimeDirectory = path.join(directory, '.mcstools')
    fs.mkdirSync(runtimeDirectory)
    fs.writeFileSync(path.join(runtimeDirectory, 'server.pid'), 'not-a-pid', 'utf8')

    assert.equal(hasLiveRemoteMinecraftMarker(directory), false)
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})
