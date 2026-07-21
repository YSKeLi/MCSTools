import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getCores: () => ipcRenderer.invoke('core:getCores'),
  getVersions: (coreId: string) => ipcRenderer.invoke('core:getVersions', coreId),
  downloadCore: (coreId: string, version: string, destDir: string) =>
    ipcRenderer.invoke('core:download', coreId, version, destDir),

  startServer: (serverId: string, maxRam: number) => ipcRenderer.invoke('server:start', serverId, maxRam),
  stopServer: (serverId: string) => ipcRenderer.invoke('server:stop', serverId),
  forceStopServer: (serverId: string) => ipcRenderer.invoke('server:forceStop', serverId),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  sendServerCommand: (serverId: string, cmd: string) => ipcRenderer.invoke('server:command', serverId, cmd),
  getLocalSystemMetrics: () => ipcRenderer.invoke('system:getMetrics'),

  serversList: () => ipcRenderer.invoke('servers:list'),
  serversAdd: (s: any) => ipcRenderer.invoke('servers:add', s),
  serversRemove: (id: string, options?: { deleteFiles?: boolean }) => ipcRenderer.invoke('servers:remove', id, options),
  serversUpdate: (id: string, u: any) => ipcRenderer.invoke('servers:update', id, u),
  onServersChanged: (callback: () => void) => {
    const h = () => callback()
    ipcRenderer.on('servers:changed', h)
    return () => { ipcRenderer.removeListener('servers:changed', h) }
  },

  readServerProperties: (serverId: string) => ipcRenderer.invoke('serverFiles:readProperties', serverId),
  writeServerProperties: (serverId: string, content: string) => ipcRenderer.invoke('serverFiles:writeProperties', serverId, content),
  readServerProfile: (directory: string) => ipcRenderer.invoke('serverFiles:readProfile', directory),
  writeServerProfile: (directory: string, content: string) => ipcRenderer.invoke('serverFiles:writeProfile', directory, content),
  createManagedServerDirectory: (parentDirectory: string, serverName: string) => ipcRenderer.invoke('serverFiles:createManagedDirectory', parentDirectory, serverName),
  discardManagedServerDirectory: (directory: string) => ipcRenderer.invoke('serverFiles:discardManagedDirectory', directory),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectJavaExecutable: () => ipcRenderer.invoke('dialog:selectJavaExecutable'),

  detectJava: () => ipcRenderer.invoke('java:detect'),
  getJavaSystemProfile: () => ipcRenderer.invoke('java:getSystemProfile'),
  getJavaPackages: () => ipcRenderer.invoke('java:getPackages'),
  getJavaOfficialPage: () => ipcRenderer.invoke('java:getOfficialPage'),
  downloadJavaPackage: (packageId: string) => ipcRenderer.invoke('java:downloadPackage', packageId),
  detectServer: (dir: string) => ipcRenderer.invoke('server:detect', dir),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('app:downloadAndInstallUpdate'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  remoteServersList: () => ipcRenderer.invoke('remoteServers:list'),
  remoteServerFingerprint: (input: any) => ipcRenderer.invoke('remoteServers:fingerprint', input),
  remoteServersAdd: (input: any) => ipcRenderer.invoke('remoteServers:add', input),
  remoteServersRemove: (id: string) => ipcRenderer.invoke('remoteServers:remove', id),
  remoteServerGetMetrics: (id: string) => ipcRenderer.invoke('remoteServers:getMetrics', id),

  onServerLog: (callback: (event: any) => void) => {
    const h = (_: any, event: any) => callback(event)
    ipcRenderer.on('server:log', h)
    return () => { ipcRenderer.removeListener('server:log', h) }
  },
  onServerStatus: (callback: (state: any) => void) => {
    const h = (_: any, state: any) => callback(state)
    ipcRenderer.on('server:status', h)
    return () => { ipcRenderer.removeListener('server:status', h) }
  },
  onDownloadProgress: (callback: (p: any) => void) => {
    const h = (_: any, p: any) => callback(p)
    ipcRenderer.on('download:progress', h)
    return () => { ipcRenderer.removeListener('download:progress', h) }
  },
  onUpdateDownloadProgress: (callback: (p: any) => void) => {
    const h = (_: any, p: any) => callback(p)
    ipcRenderer.on('update:downloadProgress', h)
    return () => { ipcRenderer.removeListener('update:downloadProgress', h) }
  },
  onJavaDownloadProgress: (callback: (p: any) => void) => {
    const h = (_: any, p: any) => callback(p)
    ipcRenderer.on('java:downloadProgress', h)
    return () => { ipcRenderer.removeListener('java:downloadProgress', h) }
  },

  frpStop: () => ipcRenderer.invoke('frp:stop'),
  frpStatus: () => ipcRenderer.invoke('frp:status'),
  frpConfigsList: () => ipcRenderer.invoke('frpConfigs:list'),
  frpConfigsPickFile: () => ipcRenderer.invoke('frpConfigs:pickFile'),
  frpConfigsAdd: (name: string, filePath: string) => ipcRenderer.invoke('frpConfigs:add', name, filePath),
  frpConfigsRemove: (id: string) => ipcRenderer.invoke('frpConfigs:remove', id),
  frpConfigsStart: (id: string) => ipcRenderer.invoke('frpConfigs:start', id),
  onFrpConfigsChanged: (callback: () => void) => {
    const h = () => callback()
    ipcRenderer.on('frpConfigs:changed', h)
    return () => { ipcRenderer.removeListener('frpConfigs:changed', h) }
  },
  onFrpLog: (callback: (log: string) => void) => {
    const h = (_: any, log: string) => callback(log)
    ipcRenderer.on('frp:log', h)
    return () => { ipcRenderer.removeListener('frp:log', h) }
  },
  onFrpStatus: (callback: (status: string) => void) => {
    const h = (_: any, status: string) => callback(status)
    ipcRenderer.on('frp:status', h)
    return () => { ipcRenderer.removeListener('frp:status', h) }
  },
})
