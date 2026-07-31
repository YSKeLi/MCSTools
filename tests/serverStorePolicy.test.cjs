const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { repairStoredServers } = require('../dist/main/serverStorePolicy.js')

function idGenerator() {
  let next = 0
  return () => `generated-${++next}`
}

test('repairs recoverable server records and isolates only unrecoverable records', () => {
  const result = repairStoredServers([
    {
      name: 'Recovered',
      path: path.join('offline', 'server'),
      jarName: path.join('downloads', 'server.jar'),
    },
    { id: 'broken', jarName: 'server.jar' },
    null,
  ], idGenerator(), () => '2026-07-24T00:00:00.000Z')

  assert.equal(result.servers.length, 1)
  assert.equal(result.servers[0].id, 'generated-1')
  assert.equal(result.servers[0].jarName, 'server.jar')
  assert.equal(result.servers[0].path, path.resolve('offline', 'server'))
  assert.equal(result.servers[0].maxRam, 2048)
  assert.equal(result.repairedCount, 1)
  assert.deepEqual(result.invalid.map(item => item.index), [1, 2])
})

test('keeps valid records even when their server directory is currently unavailable', () => {
  const record = {
    id: 'server-1',
    name: 'Offline server',
    path: path.resolve('definitely-not-mounted'),
    coreId: 'paper',
    coreName: 'Paper',
    version: '1.21',
    jarName: 'paper.jar',
    createdAt: '2026-07-24T00:00:00.000Z',
    maxRam: 4096,
    managedPath: false,
  }
  const result = repairStoredServers([record], idGenerator())

  assert.equal(result.servers.length, 1)
  assert.equal(result.servers[0].id, record.id)
  assert.equal(result.servers[0].path, record.path)
  assert.equal(result.repairedCount, 0)
  assert.equal(result.invalid.length, 0)
})

test('repairs legacy root-relative icon URLs for packaged file pages', () => {
  const record = {
    id: 'server-1',
    name: 'Paper',
    path: path.resolve('paper-server'),
    coreId: 'paper',
    coreName: 'Paper',
    version: '1.21',
    jarName: 'paper.jar',
    iconUrl: '/icons/paper.ico',
    createdAt: '2026-07-24T00:00:00.000Z',
    maxRam: 4096,
    managedPath: false,
  }

  const result = repairStoredServers([record], idGenerator())

  assert.equal(result.servers[0].iconUrl, './icons/paper.ico')
  assert.equal(result.repairedCount, 1)
})

test('repairs duplicate ids without discarding either server', () => {
  const base = {
    id: 'duplicate',
    name: 'Server',
    path: path.resolve('server-a'),
    coreId: 'unknown',
    coreName: '未知',
    version: '未知',
    jarName: 'server.jar',
    createdAt: '2026-07-24T00:00:00.000Z',
    maxRam: 2048,
    managedPath: false,
  }
  const result = repairStoredServers([
    base,
    { ...base, path: path.resolve('server-b') },
  ], idGenerator())

  assert.equal(result.servers.length, 2)
  assert.equal(result.servers[0].id, 'duplicate')
  assert.equal(result.servers[1].id, 'generated-1')
  assert.equal(result.repairedCount, 1)
})

test('returns an empty usable list when every record is invalid', () => {
  const result = repairStoredServers([
    { id: 'missing-path', jarName: 'server.jar' },
    { id: 'missing-jar', path: '/server' },
  ], idGenerator())

  assert.deepEqual(result.servers, [])
  assert.equal(result.invalid.length, 2)
})
