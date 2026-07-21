const test = require('node:test')
const assert = require('node:assert/strict')
const {
  assertTrustedUpdateAsset,
  compareVersions,
  normalizeSha256,
  selectUpdateAsset,
} = require('../dist/main/update/updatePolicy.js')

const hash = 'a'.repeat(64)

test('selects only the exact current platform asset', () => {
  const assets = [
    { name: 'MCServerTools-Linux-x64.AppImage', url: 'https://github.com/YSKeLi/MCSTools/releases/download/v2.0.0/linux', sha256: hash },
    { name: 'MCServerTools-Windows-x64.exe', url: 'https://github.com/YSKeLi/MCSTools/releases/download/v2.0.0/windows', sha256: hash },
  ]
  assert.equal(selectUpdateAsset(assets, 'win32', 'x64').name, 'MCServerTools-Windows-x64.exe')
  assert.equal(selectUpdateAsset(assets, 'darwin', 'arm64'), null)
})
test('rejects untrusted update URLs and missing hashes', () => {
  assert.throws(() => assertTrustedUpdateAsset({
    name: 'MCServerTools-Windows-x64.exe',
    url: 'http://example.com/update.exe',
    sha256: hash,
  }))
  assert.throws(() => assertTrustedUpdateAsset({
    name: 'MCServerTools-Windows-x64.exe',
    url: 'https://github.com/YSKeLi/MCSTools/releases/download/v2.0.0/update.exe',
  }))
  assert.equal(normalizeSha256(`sha256:${hash}`), hash)
})

test('compares semantic numeric versions', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0') < 0, true)
  assert.equal(compareVersions('2.0.0', '1.10.0') > 0, true)
})
