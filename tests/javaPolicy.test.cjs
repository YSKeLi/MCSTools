const test = require('node:test')
const assert = require('node:assert/strict')
const { requiredJavaMajor } = require('../dist/main/server/javaPolicy.js')

test('maps Minecraft versions to the required Java major', () => {
  assert.equal(requiredJavaMajor('1.21.4'), 21)
  assert.equal(requiredJavaMajor('1.20.4'), 17)
  assert.equal(requiredJavaMajor('1.20.5'), 21)
  assert.equal(requiredJavaMajor('1.17.1'), 16)
  assert.equal(requiredJavaMajor('unknown'), 17)
})
