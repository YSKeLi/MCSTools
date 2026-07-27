const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createLocalSystemMetricsService,
  LOCAL_DISK_CACHE_TTL_MS,
} = require('../dist/main/system/SystemMetricsService.js')

test('caches static system information and refreshes disk metrics every 30 seconds', async () => {
  let now = 0
  let processUptime = 20
  let staticReads = 0
  let usageReads = 0
  let memoryReads = 0
  let diskReads = 0

  const staticRead = (value) => async () => {
    staticReads += 1
    return value
  }

  const service = createLocalSystemMetricsService({
    bios: staticRead({ vendor: 'Firmware Inc.', version: '1.2.3', releaseDate: '2026-01-02' }),
    cpu: staticRead({ manufacturer: 'Example', brand: 'Processor', cores: 8, physicalCores: 4 }),
    osInfo: staticRead({ hostname: 'test-host', arch: 'x64', distro: 'Test OS', release: '1', platform: 'test', kernel: '1.0' }),
    system: staticRead({ manufacturer: 'Device Inc.', model: 'Model One' }),
    currentLoad: async () => {
      usageReads += 1
      return { currentLoad: usageReads * 10 }
    },
    fsSize: async () => {
      diskReads += 1
      return [{ fs: 'C:', type: 'NTFS', mount: 'C:', size: 1000, used: 400 + diskReads, available: 599 - diskReads }]
    },
    hostname: () => 'fallback-host',
    architecture: () => 'fallback-arch',
    memory: () => {
      memoryReads += 1
      return { total: 1000, available: 250 }
    },
    systemUptime: () => 100,
    processUptime: () => processUptime,
    now: () => now,
  })

  const first = await service.getMetrics()
  assert.equal(first.cpu.model, 'Example Processor')
  assert.deepEqual(first.bios, { vendor: 'Firmware Inc.', version: '1.2.3', releaseDate: '2026-01-02' })
  assert.equal(first.uptimeSeconds, 100)
  assert.equal(first.disk.usedBytes, 401)
  assert.equal('uptimeAnchor' in first, false)

  now = LOCAL_DISK_CACHE_TTL_MS - 1
  processUptime = 25
  const cached = await service.getMetrics()
  assert.equal(cached.uptimeSeconds, 105)
  assert.equal(cached.disk.usedBytes, 401)

  now = LOCAL_DISK_CACHE_TTL_MS
  const refreshed = await service.getMetrics()
  assert.equal(refreshed.disk.usedBytes, 402)

  const forced = await service.getMetrics(true)
  assert.equal(forced.disk.usedBytes, 403)

  assert.equal(staticReads, 4)
  assert.equal(usageReads, 4)
  assert.equal(memoryReads, 4)
  assert.equal(diskReads, 3)
})
