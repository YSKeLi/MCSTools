import type { RemoteServerAuthType, RemoteServerInput } from './types'

export const MAX_REMOTE_PRIVATE_KEY_BYTES = 256 * 1024

export interface NormalizedRemoteAuthInput {
  authType: RemoteServerAuthType
  password: string
  privateKey: string
  privateKeyName: string
  passphrase: string
}

function looksLikePrivateKey(value: string): boolean {
  return /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\r?$/m.test(value)
    || /^PuTTY-User-Key-File-\d+:/m.test(value)
}

export function normalizeRemoteAuthInput(input: Partial<RemoteServerInput> | null | undefined): NormalizedRemoteAuthInput {
  const authType: RemoteServerAuthType = input?.authType === 'private-key' ? 'private-key' : 'password'
  const password = typeof input?.password === 'string' ? input.password : ''
  const privateKey = typeof input?.privateKey === 'string' ? input.privateKey : ''
  const privateKeyName = typeof input?.privateKeyName === 'string' ? input.privateKeyName.trim() : ''
  const passphrase = typeof input?.passphrase === 'string' ? input.passphrase : ''

  if (authType === 'password') {
    if (!password || password.length > 4096 || /[\r\n]/.test(password)) throw new Error('请输入有效的登录密码')
  } else {
    const keyBytes = Buffer.byteLength(privateKey, 'utf8')
    if (!keyBytes || keyBytes > MAX_REMOTE_PRIVATE_KEY_BYTES || !looksLikePrivateKey(privateKey)) {
      throw new Error('请选择有效的 OpenSSH、PEM 或 PuTTY 私钥文件')
    }
    if (privateKeyName.length > 255 || /[\r\n]/.test(privateKeyName)) throw new Error('私钥文件名无效')
    if (passphrase.length > 4096 || /[\r\n]/.test(passphrase)) throw new Error('私钥口令无效')
  }

  return { authType, password, privateKey, privateKeyName, passphrase }
}
