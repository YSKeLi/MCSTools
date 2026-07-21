const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  assertManagedServerDirectory,
  isPathInside,
  writeServerMarker,
} = require('../dist/main/security/pathPolicy.js')

test('server deletion requires a matching software marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-policy-'))
  const server = path.join(root, 'server')
  fs.mkdirSync(server)
  writeServerMarker(server, 'server-1')
  assert.equal(assertManagedServerDirectory(server, 'server-1'), path.resolve(server))
  assert.throws(() => assertManagedServerDirectory(server, 'server-2'))
  assert.equal(isPathInside(root, server), true)
  assert.equal(isPathInside(server, path.join(root, 'other')), false)
  fs.rmSync(root, { recursive: true, force: true })
})
