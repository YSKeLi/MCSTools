export type RemoteServerOs = 'linux' | 'windows' | 'macos'
export type RemoteServerAuthType = 'password' | 'private-key'

export interface RemoteServerInput {
  name: string
  host: string
  port: number
  username: string
  authType: RemoteServerAuthType
  password?: string
  privateKey?: string
  privateKeyName?: string
  passphrase?: string
  os: RemoteServerOs
  expectedFingerprint?: string
}

export interface RemotePrivateKeySelection {
  name: string
  content: string
}

export interface RemoteServerFingerprintInput {
  host: string
  port: number
  username: string
}

export interface RemoteServerSummary {
  id: string
  name: string
  host: string
  port: number
  username: string
  os: RemoteServerOs
  authType: RemoteServerAuthType
  hostFingerprint: string
  createdAt: string
}

export interface RemoteServerMetrics {
  fetchedAt: string
  hostname: string
  osName: string
  kernel: string
  uptimeSeconds: number
  cpu: {
    model: string
    cores: number
    usagePercent: number
    loadAverage?: number
  }
  memory: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
  }
  disk: {
    filesystem: string
    mount: string
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usagePercent: number
  }
}

export interface RemoteServerAddResult {
  server: RemoteServerSummary
  metrics: RemoteServerMetrics
}

export interface RemoteMinecraftDirectory {
  path: string
  name: string
  jarFiles: string[]
  suggestedJar: string
  suggestedType: string
  suggestedVersion: string
  suggestedRemark: string
}

export interface RemoteFileBrowserItem {
  name: string
  path: string
  type: 'directory' | 'file' | 'drive'
  size: number
}

export interface RemoteDirectoryListing {
  path: string
  parentPath: string | null
  items: RemoteFileBrowserItem[]
  containsServerProperties: boolean
}

export interface RemoteMinecraftServer {
  id: string
  name: string
  path: string
  jarName: string
  launch: RemoteMinecraftLaunchSpec
  coreType: string
  version: string
  remark: string
  maxRam: number
  createdAt: string
}

export type RemoteMinecraftLaunchKind = 'jar' | 'java-args' | 'native'

export interface RemoteMinecraftLaunchSpec {
  kind: RemoteMinecraftLaunchKind
  target: string
}

export interface RemoteMinecraftServerInput {
  path: string
  jarName?: string
  coreType: string
  version: string
  remark: string
  maxRam?: number
  launch?: RemoteMinecraftLaunchSpec
}

export type RemoteMinecraftServerStatus = 'running' | 'external' | 'stopped' | 'error'

export type RemoteDeploymentArtifactKind = 'direct-jar' | 'java-installer' | 'archive' | 'unsupported'

export type RemoteDeploymentPhase =
  | 'queued'
  | 'preflight'
  | 'downloading'
  | 'uploading'
  | 'verifying'
  | 'installing'
  | 'configuring'
  | 'registering'
  | 'starting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RemoteDeploymentInput {
  name: string
  targetPath: string
  coreId: string
  coreName: string
  version: string
  remark: string
  maxRam: number
  serverPort: number
  eulaAccepted: boolean
  startAfterDeploy?: boolean
}

export interface RemoteDeploymentPreflight {
  targetPath: string
  artifactName: string
  artifactKind: RemoteDeploymentArtifactKind
  requiredJavaMajor: number
  javaMajor: number | null
  architecture: string
  availableBytes: number
  targetExists: boolean
  parentWritable: boolean
  portAvailable: boolean
  canDeploy: boolean
  warnings: string[]
}

export interface RemoteDeploymentJob {
  id: string
  remoteServerId: string
  input: RemoteDeploymentInput
  phase: RemoteDeploymentPhase
  progress: number
  message: string
  createdAt: string
  updatedAt: string
  error?: string
  minecraftServerId?: string
  launch?: RemoteMinecraftLaunchSpec
}
