const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_APP_SETTINGS,
  applyAppSettingsPatch,
  sanitizeAppSettings,
} = require('../dist/main/settings/settingsPolicy.js')

test('defaults window closing to minimizing into the tray', () => {
  assert.equal(DEFAULT_APP_SETTINGS.closeBehavior, 'tray')
  assert.equal(DEFAULT_APP_SETTINGS.autoLaunch, false)
  assert.equal(DEFAULT_APP_SETTINGS.language, 'system')
})

test('repairs invalid application settings without trusting stored values', () => {
  const repaired = sanitizeAppSettings({
    language: 'invalid',
    accentColor: 'red',
    backgroundTransparency: 250,
    autoLaunch: 'yes',
    closeBehavior: 'hide',
    checkUpdatesOnStartup: false,
  })

  assert.equal(repaired.language, 'system')
  assert.equal(repaired.accentColor, '#267654')
  assert.equal(repaired.backgroundTransparency, 100)
  assert.equal(repaired.autoLaunch, false)
  assert.equal(repaired.closeBehavior, 'tray')
  assert.equal(repaired.checkUpdatesOnStartup, false)
})

test('applies supported application setting changes', () => {
  const updated = applyAppSettingsPatch(DEFAULT_APP_SETTINGS, {
    language: 'ja',
    accentColor: '#2563a7',
    backgroundTransparency: 62,
    autoLaunch: true,
    closeBehavior: 'quit',
  })

  assert.equal(updated.language, 'ja')
  assert.equal(updated.accentColor, '#2563a7')
  assert.equal(updated.backgroundTransparency, 62)
  assert.equal(updated.autoLaunch, true)
  assert.equal(updated.closeBehavior, 'quit')
})

test('rejects unsupported application setting patches', () => {
  assert.throws(
    () => applyAppSettingsPatch(DEFAULT_APP_SETTINGS, { closeBehavior: 'hide' }),
    /关闭窗口行为设置无效/,
  )
  assert.throws(
    () => applyAppSettingsPatch(DEFAULT_APP_SETTINGS, { unknownSetting: true }),
    /不支持的字段/,
  )
})
