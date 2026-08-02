const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PersistentProcessController } = require('../dist/main/runtime/PersistentProcessController.js')
const { createManagedControlRecord } = require('../dist/main/server/minecraftControlProtocol.js')

async function waitFor(predicate, message, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

test('restores a managed process and its logs after the controller restarts', async () => {
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcst-runtime-'))
  const logPath = path.join(runtimeDirectory, 'test.log')
  const childScript = [
    'console.log("child-ready")',
    'process.stdin.setEncoding("utf8")',
    'process.stdin.on("data", value => {',
    '  const command = value.trim()',
    '  if (command === "stop") process.exit(0)',
    '  else console.log(`received:${command}`)',
    '})',
    'setInterval(() => {}, 1000)',
  ].join(';')

  let firstController
  let restoredController
  try {
    firstController = new PersistentProcessController({
      runtimeDirectory,
      service: 'server',
      onLog: () => undefined,
      onState: () => undefined,
    })
    const started = await firstController.start({
      service: 'server',
      serviceId: 'test-server',
      executable: process.execPath,
      args: ['-e', childScript],
      cwd: runtimeDirectory,
      logPath,
      stdoutPrefix: '',
      stderrPrefix: '[ERR] ',
      stopMode: 'stdin',
      stopTimeoutMs: 1000,
      initialLogs: ['session-started'],
    })
    assert.equal(started.status, 'running')

    await waitFor(
      () => firstController.getLogs(logPath).includes('child-ready'),
      'child output was not persisted',
    )
    firstController.dispose()

    restoredController = new PersistentProcessController({
      runtimeDirectory,
      service: 'server',
      onLog: () => undefined,
      onState: () => undefined,
    })
    assert.equal(restoredController.getState().status, 'running')
    assert.equal(restoredController.getState().serviceId, 'test-server')
    assert.ok(restoredController.getLogs(logPath).includes('session-started'))

    restoredController.sendStdin('ping')
    await waitFor(
      () => restoredController.getLogs(logPath).includes('received:ping'),
      'restored controller could not send input',
    )

    const restoredState = restoredController.getState()
    const sharedControl = {
      version: 1,
      transport: 'command-file',
      logPath: restoredState.logPath,
      commandPath: restoredState.commandPath,
      sessionId: restoredState.sessionId,
    }
    fs.appendFileSync(restoredState.commandPath, createManagedControlRecord(sharedControl, 'stdin', 'bridge'))
    await waitFor(
      () => restoredController.getLogs(logPath).includes('received:bridge'),
      'shared control record could not send input',
    )

    fs.appendFileSync(restoredState.commandPath, createManagedControlRecord(sharedControl, 'stop'))
    await waitFor(
      () => restoredController.getState()?.status === 'stopped',
      'shared control record could not stop the process',
    )
  } finally {
    try {
      if (restoredController?.isRunning()) restoredController.stop(true)
    } catch {}
    firstController?.dispose()
    restoredController?.dispose()
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.rmSync(runtimeDirectory, { recursive: true, force: true })
  }
})

test('ignores a stale FRP child PID that was reused by another executable', async () => {
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcst-runtime-reused-pid-'))
  const logPath = path.join(runtimeDirectory, 'frp.log')
  const statePath = path.join(runtimeDirectory, 'state.json')
  fs.writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    service: 'frp',
    serviceId: 'stale-frp',
    sessionId: 'stale-session',
    runnerPid: 2147483647,
    childPid: process.pid,
    status: 'error',
    logPath,
    commandPath: path.join(runtimeDirectory, 'stale-commands.ndjson'),
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }, null, 2)}\n`, 'utf8')

  const controller = new PersistentProcessController({
    runtimeDirectory,
    service: 'frp',
    onLog: () => undefined,
    onState: () => undefined,
  })

  try {
    const started = await controller.start({
      service: 'frp',
      serviceId: 'replacement-frp',
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: runtimeDirectory,
      logPath,
      stdoutPrefix: '',
      stderrPrefix: '[ERR] ',
      stopMode: 'signal',
      stopTimeoutMs: 1000,
      initialLogs: [],
    })
    assert.equal(started.status, 'running')
    assert.equal(started.serviceId, 'replacement-frp')
    assert.equal(started.childExecutable, process.execPath)
    controller.stop(true)
    await waitFor(() => controller.getState()?.status === 'stopped', 'replacement process did not stop')
  } finally {
    try {
      if (controller.isRunning()) controller.stop(true)
    } catch {}
    controller.dispose()
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.rmSync(runtimeDirectory, { recursive: true, force: true })
  }
})
