const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const test = require('node:test')
const { Server } = require('ssh2')

const { executeRemote } = require('../dist/main/remote/RemoteServerService.js')

function privateKeyPem() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    format: 'pem',
    type: 'pkcs1',
  })
}

async function startSshServer() {
  const server = new Server({ hostKeys: [privateKeyPem()] }, client => {
    client
      .on('error', () => undefined)
      .on('authentication', context => {
        if (context.username !== 'mcstools') return context.reject()
        if (context.method === 'password' && context.password === 'test-password') return context.accept()
        if (context.method === 'publickey') return context.accept()
        context.reject()
      })
      .on('ready', () => {
        client.on('session', acceptSession => {
          const session = acceptSession()
          session.on('exec', (accept, _reject, info) => {
            const stream = accept()
            stream.write(`executed:${info.command}`)
            stream.exit(0)
            stream.end()
          })
        })
      })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('SSH test server did not bind a TCP port')
  return { server, port: address.port }
}

test('executes commands over password and private-key SSH with pinned host verification', { timeout: 20_000 }, async () => {
  const { server, port } = await startSshServer()
  const target = { host: '127.0.0.1', port, username: 'mcstools', os: 'linux' }
  try {
    const passwordResult = await executeRemote(
      target,
      { password: 'test-password', tryKeyboard: true },
      undefined,
      'password-command',
      '',
    )
    assert.equal(passwordResult.stdout, 'executed:password-command')
    assert.match(passwordResult.fingerprint, /^[a-f0-9]{64}$/)

    const keyResult = await executeRemote(
      target,
      { privateKey: privateKeyPem(), tryKeyboard: false },
      passwordResult.fingerprint,
      'key-command',
      '',
    )
    assert.equal(keyResult.stdout, 'executed:key-command')
    assert.equal(keyResult.fingerprint, passwordResult.fingerprint)

    await assert.rejects(() => executeRemote(
      target,
      { password: 'test-password', tryKeyboard: true },
      '0'.repeat(64),
      'rejected-command',
      '',
    ), /主机指纹已变化/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
