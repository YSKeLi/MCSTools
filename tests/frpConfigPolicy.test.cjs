const test = require('node:test')
const assert = require('node:assert/strict')
const { withPersistentFrpLogin } = require('../dist/main/frp/configPolicy.js')

test('adds persistent FRP login retries before proxy tables', () => {
  const source = [
    'serverAddr = "frp.example.com"',
    'serverPort = 7000',
    '',
    '[[proxies]]',
    'name = "minecraft"',
  ].join('\n')

  const result = withPersistentFrpLogin(source)
  assert.match(result, /serverPort = 7000\n\nloginFailExit = false\n\n\[\[proxies\]\]/)
})

test('overrides loginFailExit only in the global FRP section', () => {
  const source = [
    'loginFailExit = true',
    'serverAddr = "frp.example.com"',
    '',
    '[[proxies]]',
    'loginFailExit = true',
  ].join('\r\n')

  const result = withPersistentFrpLogin(source)
  assert.equal((result.match(/loginFailExit = false/g) || []).length, 1)
  assert.equal((result.match(/loginFailExit = true/g) || []).length, 1)
  assert.ok(result.includes('\r\n'))
})

test('keeps an existing persistent login setting stable', () => {
  const source = 'serverAddr = "frp.example.com"\nloginFailExit = false\n'
  const result = withPersistentFrpLogin(source)
  assert.equal((result.match(/loginFailExit/g) || []).length, 1)
  assert.ok(result.endsWith('\n'))
})
