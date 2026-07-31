const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MAX_REMOTE_PRIVATE_KEY_BYTES,
  normalizeRemoteAuthInput,
} = require('../dist/main/remote/remoteAuthPolicy.js')

test('normalizes password authentication and legacy inputs', () => {
  assert.deepEqual(normalizeRemoteAuthInput({ password: 'secret' }), {
    authType: 'password',
    password: 'secret',
    privateKey: '',
    privateKeyName: '',
    passphrase: '',
  })
  assert.throws(() => normalizeRemoteAuthInput({ authType: 'password', password: '' }), /登录密码/)
  assert.throws(() => normalizeRemoteAuthInput({ authType: 'password', password: 'bad\nvalue' }), /登录密码/)
})

test('accepts supported private key containers and optional passphrases', () => {
  const openSshKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n'
  assert.deepEqual(normalizeRemoteAuthInput({
    authType: 'private-key',
    privateKey: openSshKey,
    privateKeyName: 'cloud.pem',
    passphrase: 'secret',
  }), {
    authType: 'private-key',
    password: '',
    privateKey: openSshKey,
    privateKeyName: 'cloud.pem',
    passphrase: 'secret',
  })

  assert.equal(normalizeRemoteAuthInput({
    authType: 'private-key',
    privateKey: 'PuTTY-User-Key-File-3: ssh-rsa\nEncryption: none\n',
  }).authType, 'private-key')
})

test('rejects malformed and oversized private keys', () => {
  assert.throws(() => normalizeRemoteAuthInput({ authType: 'private-key', privateKey: 'not a key' }), /私钥文件/)
  assert.throws(() => normalizeRemoteAuthInput({
    authType: 'private-key',
    privateKey: `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(MAX_REMOTE_PRIVATE_KEY_BYTES)}\n`,
  }), /私钥文件/)
  assert.throws(() => normalizeRemoteAuthInput({
    authType: 'private-key',
    privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n',
    passphrase: 'bad\nvalue',
  }), /私钥口令/)
})
