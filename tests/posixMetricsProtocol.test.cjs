const assert = require('node:assert/strict')
const test = require('node:test')

const { parsePosixMetrics } = require('../dist/main/remote/posixMetricsProtocol.js')

test('parses macOS system metrics', () => {
  const metrics = parsePosixMetrics(`
hostname=mac-mini
os_name=macOS 15.5
kernel=Darwin 24.5.0
uptime_seconds=7200
cpu_model=Apple M4
cpu_cores=10
cpu_usage_tenths=187
load_average=1.25
memory_total_kb=16777216
memory_available_kb=6291456
disk_filesystem=/dev/disk3s1s1
disk_mount=/
disk_total_kb=479000000
disk_used_kb=125000000
disk_available_kb=354000000
`, 'macos')

  assert.equal(metrics.hostname, 'mac-mini')
  assert.equal(metrics.osName, 'macOS 15.5')
  assert.equal(metrics.cpu.model, 'Apple M4')
  assert.equal(metrics.cpu.cores, 10)
  assert.equal(metrics.cpu.usagePercent, 18.7)
  assert.equal(metrics.memory.totalBytes, 16777216 * 1024)
  assert.equal(metrics.disk.mount, '/')
})

test('rejects incomplete macOS system metrics', () => {
  assert.throws(() => parsePosixMetrics('hostname=mac-mini\n', 'macos'), /macOS/)
})
