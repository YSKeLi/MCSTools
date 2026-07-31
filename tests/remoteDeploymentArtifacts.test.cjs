const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tar = require('tar')
const { prepareRemoteDeploymentArchive, selectDeploymentLaunch } = require('../dist/main/remote/deploymentArtifacts.js')

test('selects Java launch targets from deployment payloads', () => {
  assert.deepEqual(selectDeploymentLaunch(['server.jar'], 'linux', 'paper'), {
    kind: 'jar',
    target: 'server.jar',
  })
  assert.deepEqual(selectDeploymentLaunch([
    'libraries/net/minecraftforge/forge/1.21.1/unix_args.txt',
    'libraries/net/minecraftforge/forge/1.21.1/win_args.txt',
  ], 'linux', 'forge'), {
    kind: 'java-args',
    target: 'libraries/net/minecraftforge/forge/1.21.1/unix_args.txt',
  })
  assert.deepEqual(selectDeploymentLaunch(['quilt-server-launch.jar', 'server.jar'], 'windows', 'quilt'), {
    kind: 'jar',
    target: 'quilt-server-launch.jar',
  })
  assert.deepEqual(selectDeploymentLaunch([
    'forge-1.12.2-14.23.5.2860-universal.jar',
    'minecraft_server.1.12.2.jar',
  ], 'linux', 'forge'), {
    kind: 'jar',
    target: 'forge-1.12.2-14.23.5.2860-universal.jar',
  })
})

test('selects only the matching Bedrock native executable', () => {
  assert.deepEqual(selectDeploymentLaunch(['bedrock_server.exe', 'bedrock_server_how_to.html'], 'windows', 'bedrock-server'), {
    kind: 'native',
    target: 'bedrock_server.exe',
  })
  assert.deepEqual(selectDeploymentLaunch(['bedrock_server'], 'linux', 'bedrock-server'), {
    kind: 'native',
    target: 'bedrock_server',
  })
  assert.throws(() => selectDeploymentLaunch(['bedrock_server.exe'], 'linux', 'bedrock-server'))
})

test('rejects ambiguous archives instead of guessing a launch jar', () => {
  assert.throws(() => selectDeploymentLaunch(['one.jar', 'two.jar'], 'linux', 'custom'))
})

test('validates and extracts a tar deployment before selecting its launch target', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstools-deployment-artifact-'))
  try {
    const source = path.join(root, 'source')
    const payload = path.join(source, 'payload')
    fs.mkdirSync(payload, { recursive: true })
    fs.writeFileSync(path.join(payload, 'server.jar'), 'server')
    fs.writeFileSync(path.join(payload, 'server.properties'), 'server-port=25565\n')
    const archive = path.join(root, 'server.tar.gz')
    await tar.create({ cwd: source, file: archive, gzip: true }, ['payload'])

    const prepared = await prepareRemoteDeploymentArchive(archive, path.join(root, 'extracted'), 'linux', 'paper')
    assert.deepEqual(prepared.launch, { kind: 'jar', target: 'server.jar' })
    assert.deepEqual(prepared.files.map(file => file.relativePath), ['server.jar', 'server.properties'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
