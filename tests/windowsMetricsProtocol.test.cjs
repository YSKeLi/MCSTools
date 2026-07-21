const assert = require('node:assert/strict')
const test = require('node:test')

const {
  decodeWindowsMetricsJson,
  encodeWindowsPowerShellCommand,
  WINDOWS_METRICS_MARKER,
} = require('../dist/main/remote/windowsMetricsProtocol.js')

test('decodes marked Windows metrics with surrounding output', () => {
  const metrics = { hostname: 'ATRI-PC', osName: 'Windows 11 专业版' }
  const payload = Buffer.from(JSON.stringify(metrics), 'utf8').toString('base64')
  const output = `PowerShell banner\r\n${WINDOWS_METRICS_MARKER}${payload}\r\n`

  assert.deepEqual(decodeWindowsMetricsJson(output), metrics)
})

test('decodes null-padded Windows metrics output', () => {
  const metrics = { hostname: 'SERVER-01' }
  const payload = Buffer.from(JSON.stringify(metrics), 'utf8').toString('base64')
  const output = `${WINDOWS_METRICS_MARKER}${payload}`.split('').join('\u0000')

  assert.deepEqual(decodeWindowsMetricsJson(output), metrics)
})

test('keeps compatibility with plain JSON output', () => {
  assert.deepEqual(
    decodeWindowsMetricsJson('notice\r\n{"hostname":"SERVER-02"}\r\n'),
    { hostname: 'SERVER-02' },
  )
})

test('encodes PowerShell commands as UTF-16LE', () => {
  const script = 'Write-Output "测试"'
  const command = encodeWindowsPowerShellCommand(script)
  const encoded = command.split(' ').at(-1)

  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), script)
})
