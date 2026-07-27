const { spawnSync } = require('node:child_process')
const path = require('node:path')

const electronInstallScript = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js')

const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
}

const result = spawnSync(process.execPath, [electronInstallScript], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env,
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
