const test = require('node:test')
const assert = require('node:assert/strict')
const {
  classifyRemoteDeploymentArtifact,
  classifyRemoteCoreArtifact,
  deploymentRequiresJava,
  normalizeRemoteDeploymentInput,
  remoteArtifactCompatibilityWarning,
  requiredDeploymentJavaMajor,
  serializeRemoteDeploymentProfile,
} = require('../dist/main/remote/deploymentPolicy.js')

function validInput(overrides = {}) {
  return {
    name: 'Survival',
    targetPath: '/srv/minecraft/survival',
    coreId: 'paper',
    coreName: 'Paper',
    version: '1.21.1',
    remark: 'Main server',
    maxRam: 4096,
    serverPort: 25565,
    eulaAccepted: true,
    startAfterDeploy: true,
    ...overrides,
  }
}

test('classifies remote deployment artifacts explicitly', () => {
  assert.equal(classifyRemoteDeploymentArtifact('paper-1.21.1.jar'), 'direct-jar')
  assert.equal(classifyRemoteDeploymentArtifact('forge-1.21.1-installer.jar'), 'java-installer')
  assert.equal(classifyRemoteDeploymentArtifact('bedrock-server.zip'), 'archive')
  assert.equal(classifyRemoteDeploymentArtifact('README.txt'), 'unsupported')
  assert.equal(classifyRemoteCoreArtifact('forge', 'forge-26.2.jar', 'https://example.test/download?category=installer&format=jar'), 'java-installer')
  assert.equal(classifyRemoteCoreArtifact('quilt', 'quilt-latest.jar'), 'java-installer')
  assert.equal(classifyRemoteCoreArtifact('paper', 'paper-1.21.1.jar'), 'direct-jar')
})

test('validates OS-specific Bedrock artifacts without requiring Java', () => {
  assert.equal(deploymentRequiresJava('bedrock-server'), false)
  assert.equal(deploymentRequiresJava('paper'), true)
  assert.equal(remoteArtifactCompatibilityWarning('windows', 'bedrock-server', 'win-release-1.21.1'), null)
  assert.match(remoteArtifactCompatibilityWarning('linux', 'bedrock-server', 'win-release-1.21.1'), /Windows/)
})

test('normalizes a safe Linux deployment request', () => {
  assert.deepEqual(normalizeRemoteDeploymentInput('linux', validInput()), validInput())
})

test('normalizes Windows deployment paths and rejects disk roots', () => {
  const normalized = normalizeRemoteDeploymentInput('windows', validInput({ targetPath: 'D:\\Minecraft\\Survival' }))
  assert.equal(normalized.targetPath, 'D:/Minecraft/Survival')
  assert.throws(() => normalizeRemoteDeploymentInput('windows', validInput({ targetPath: 'D:\\' })), /根目录/)
})

test('requires explicit EULA acceptance and safe identifiers', () => {
  assert.throws(() => normalizeRemoteDeploymentInput('linux', validInput({ eulaAccepted: false })), /EULA/)
  assert.throws(() => normalizeRemoteDeploymentInput('linux', validInput({ coreId: 'paper; rm -rf' })), /不安全字符/)
})

test('serializes deployment metadata and maps the required Java version', () => {
  const profile = serializeRemoteDeploymentProfile(validInput({ name: 'A "quoted" server' }))
  assert.match(profile, /server_name = "A \\"quoted\\" server"/)
  assert.equal(requiredDeploymentJavaMajor('1.21.1'), 21)
  assert.equal(requiredDeploymentJavaMajor('26.1'), 25)
  assert.equal(requiredDeploymentJavaMajor('1.16.5'), 8)
})
