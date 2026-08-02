export type ManagedService = 'server' | 'frp'
export type ManagedProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
export type ManagedStopMode = 'stdin' | 'signal'

export interface ManagedProcessSpec {
  service: ManagedService
  serviceId: string
  executable: string
  args: string[]
  cwd: string
  logPath: string
  stdoutPrefix: string
  stderrPrefix: string
  stopMode: ManagedStopMode
  stopTimeoutMs: number
  initialLogs: string[]
}

export interface ManagedRunnerConfig extends ManagedProcessSpec {
  sessionId: string
  statePath: string
  commandPath: string
}

export interface ManagedProcessState {
  version: 1
  service: ManagedService
  serviceId: string
  sessionId: string
  runnerPid: number
  childPid: number | null
  childExecutable?: string
  status: ManagedProcessStatus
  logPath: string
  commandPath: string
  startedAt: string
  updatedAt: string
  exitCode?: number | null
  error?: string
  players?: string[]
}

export interface ManagedCommand {
  id: string
  sessionId: string
  type: 'stdin' | 'stop' | 'kill'
  value?: string
}
