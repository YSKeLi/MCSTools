const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tar = require('tar')
const { extractFrpArchive } = require('../dist/main/frp/archive.js')

const ZIP_FIXTURE = 'UEsDBBQAAAAIAAoA/VwXnWeFCwAAAAkAAAAhAAAAZnJwXzAuNjEuMl93aW5kb3dzX2FtZDY0L2ZycGMuZXhlSysqSNYtSS0uAQBQSwECFAAUAAAACAAKAP1cF51nhQsAAAAJAAAAIQAAAAAAAAAAAAAAAAAAAAAAZnJwXzAuNjEuMl93aW5kb3dzX2FtZDY0L2ZycGMuZXhlUEsFBgAAAAABAAEATwAAAEoAAAAAAA=='

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-frp-archive-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('extracts FRP zip archives without a system tar command', async t => {
  const directory = tempDirectory(t)
  const archivePath = path.join(directory, 'frp.zip')
  const extractDirectory = path.join(directory, 'zip-output')
  fs.writeFileSync(archivePath, Buffer.from(ZIP_FIXTURE, 'base64'))
  fs.mkdirSync(extractDirectory)

  await extractFrpArchive(archivePath, extractDirectory)

  const binary = path.join(extractDirectory, 'frp_0.61.2_windows_amd64', 'frpc.exe')
  assert.equal(fs.readFileSync(binary, 'utf8'), 'frpc-test')
})

test('extracts FRP tar.gz archives without a system tar command', async t => {
  const directory = tempDirectory(t)
  const sourceDirectory = path.join(directory, 'source')
  const extractDirectory = path.join(directory, 'tar-output')
  const binaryDirectory = path.join(sourceDirectory, 'frp_0.61.2_linux_amd64')
  const archivePath = path.join(directory, 'frp.tar.gz')
  fs.mkdirSync(binaryDirectory, { recursive: true })
  fs.mkdirSync(extractDirectory)
  fs.writeFileSync(path.join(binaryDirectory, 'frpc'), 'frpc-test')
  await tar.create({ cwd: sourceDirectory, file: archivePath, gzip: true }, ['frp_0.61.2_linux_amd64'])

  await extractFrpArchive(archivePath, extractDirectory)

  const binary = path.join(extractDirectory, 'frp_0.61.2_linux_amd64', 'frpc')
  assert.equal(fs.readFileSync(binary, 'utf8'), 'frpc-test')
})

test('rejects unknown FRP archive formats', async t => {
  const directory = tempDirectory(t)
  await assert.rejects(
    extractFrpArchive(path.join(directory, 'frp.rar'), directory),
    /不支持的 FRP 压缩包格式/,
  )
})
