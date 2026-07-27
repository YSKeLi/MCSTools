import React, { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import { Play, Plus, Power, Send, Square, Trash2 } from 'lucide-react'
import { LocalSystemMetrics } from '../components/LocalSystemMetrics'
import { OnlinePlayers } from '../components/OnlinePlayers'
import { AlertBanner, Badge, Button, Dialog, Field, IconButton, Toggle } from '../components/ui'
import { PROP_MAP, parseProperties, serializeProperties } from '../propertiesMapping'
import { parseServerProfile } from '../serverProfile'
import type { PropField } from '../propertiesMapping'

function PropFieldWidget({ propKey, value, field, onChange }: {
  propKey: string; value: string; field: PropField; onChange: (key: string, val: string) => void
}) {
  if (field.type === 'bool') {
    return <Toggle checked={value === 'true'} onChange={checked => onChange(propKey, checked ? 'true' : 'false')} label={field.label} />
  }
  if (field.type === 'enum') {
    return (
      <Field label={field.label}>
        <select className="ui-select" value={value} onChange={event => onChange(propKey, event.target.value)}>
          {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
    )
  }
  return (
    <Field label={field.label}>
      <input className="ui-input" type={field.type === 'number' ? 'number' : 'text'} value={value} onChange={event => onChange(propKey, event.target.value)} />
    </Field>
  )
}

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .join('/')
}

function mergeLogHistory(history: string[], live: string[], limit = 500): string[] {
  if (!live.length) return history.slice(-limit)
  if (!history.length) return live.slice(-limit)

  const findOverlap = (older: string[], newer: string[]) => {
    let overlap = Math.min(older.length, newer.length)
    while (overlap > 0) {
      const olderStart = older.length - overlap
      if (older.slice(olderStart).every((line, index) => line === newer[index])) return overlap
      overlap -= 1
    }
    return 0
  }

  const historyThenLive = findOverlap(history, live)
  const liveThenHistory = findOverlap(live, history)
  if (liveThenHistory > historyThenLive) {
    return [...live, ...history.slice(liveThenHistory)].slice(-limit)
  }
  if (historyThenLive > 0) {
    return [...history, ...live.slice(historyThenLive)].slice(-limit)
  }
  return history.slice(-limit)
}

export function ServerPage({ active }: { active: boolean }) {
  const [runtimeState, setRuntimeState] = useState<ServerRuntimeState>({ serverId: null, status: 'stopped' })
  const [playerSnapshot, setPlayerSnapshot] = useState<ServerPlayerSnapshot>({ serverId: null, players: [] })
  const [logsByServer, setLogsByServer] = useState<Record<string, string[]>>({})
  const [cmd, setCmd] = useState('')
  const [tab, setTab] = useState(0)
  const [maxRam, setMaxRam] = useState(2048)
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  const terminalRef = useRef<HTMLDivElement>(null)
  const followLatestLogsRef = useRef(true)

  const [propsText, setPropsText] = useState('')
  const [propsMap, setPropsMap] = useState<Record<string, string>>({})
  const [propsPath, setPropsPath] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [addDir, setAddDir] = useState('')
  const [addName, setAddName] = useState('')
  const [addJar, setAddJar] = useState('server.jar')
  const [addCoreId, setAddCoreId] = useState('unknown')
  const [addCoreName, setAddCoreName] = useState('unknown')
  const [addVersion, setAddVersion] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [javaError, setJavaError] = useState('')
  const refreshTimerRef = useRef<number | null>(null)

  const current = servers.find(s => s.id === currentId)
  const status = runtimeState.serverId === currentId ? runtimeState.status : 'stopped'
  const managedProcessActive = ['starting', 'running', 'stopping'].includes(status)
  const externalRunning = status === 'external'
  const processActive = managedProcessActive || externalRunning
  const statusLabel = status === 'running'
    ? '运行中'
    : status === 'external'
      ? '运行中'
      : status === 'starting'
        ? '启动中'
        : status === 'stopping'
          ? '停止中'
          : status === 'error'
            ? '错误'
            : '未运行'
  const logs = currentId ? logsByServer[currentId] || [] : []
  const onlinePlayers = playerSnapshot.serverId === currentId ? playerSnapshot.players : []

  useEffect(() => {
    if (!window.electronAPI?.onServerLog) return
    const unsubLog = window.electronAPI.onServerLog(event => {
      if (!event.serverId) return
      const serverId = event.serverId
      setLogsByServer(previous => ({
        ...previous,
        [serverId]: [...(previous[serverId] || []).slice(-500), event.line],
      }))
    })
    const unsubStatus = window.electronAPI.onServerStatus(setRuntimeState)
    const unsubPlayers = window.electronAPI.onServerPlayers(setPlayerSnapshot)
    const unsubServersChanged = window.electronAPI.onServersChanged(() => { loadServers() })
    void window.electronAPI.getServerStatus().then(setRuntimeState)
    void window.electronAPI.getServerPlayers().then(setPlayerSnapshot)
    loadServers()
    return () => { unsubLog(); unsubStatus(); unsubPlayers(); unsubServersChanged() }
  }, [])

  useEffect(() => {
    if (!active) return
    loadServers()
  }, [active])

  useEffect(() => {
    if (
      runtimeState.serverId
      && ['starting', 'running', 'stopping', 'external'].includes(runtimeState.status)
      && servers.some(server => server.id === runtimeState.serverId)
    ) setCurrentId(runtimeState.serverId)
  }, [runtimeState.serverId, runtimeState.status, servers])

  useLayoutEffect(() => {
    followLatestLogsRef.current = true
    const terminal = terminalRef.current
    if (!terminal) return undefined
    const scrollToLatest = () => { terminal.scrollTop = terminal.scrollHeight }
    scrollToLatest()
    const frame = window.requestAnimationFrame(scrollToLatest)
    return () => window.cancelAnimationFrame(frame)
  }, [currentId, tab])

  useLayoutEffect(() => {
    if (!followLatestLogsRef.current) return undefined
    const terminal = terminalRef.current
    if (!terminal) return undefined
    const scrollToLatest = () => { terminal.scrollTop = terminal.scrollHeight }
    scrollToLatest()
    const frame = window.requestAnimationFrame(scrollToLatest)
    return () => window.cancelAnimationFrame(frame)
  }, [logs])

  function handleTerminalScroll(event: React.UIEvent<HTMLDivElement>) {
    const terminal = event.currentTarget
    followLatestLogsRef.current = terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop <= 32
  }

  async function loadServers() {
    const list = await window.electronAPI.serversList()
    setServers(list)
    if (list.length === 0) {
      setCurrentId('')
      return
    }
    if (!currentId || !list.some(server => server.id === currentId)) {
      setCurrentId(list[0].id)
    }
  }

  useEffect(() => {
    if (!current) return
    setMaxRam(current.maxRam)
    void loadProperties()
  }, [currentId])

  useEffect(() => {
    if (!active || !currentId) return undefined
    const serverId = currentId
    let disposed = false
    let timer: number | undefined

    const refreshRuntime = async () => {
      try {
        const [state, history] = await Promise.all([
          window.electronAPI.getServerStatus(serverId),
          window.electronAPI.getServerLogs(serverId),
        ])
        if (disposed) return
        setRuntimeState(state)
        setLogsByServer(previous => ({
          ...previous,
          [serverId]: mergeLogHistory(history, previous[serverId] || []),
        }))
      } catch {
        // Keep the last known state during a transient process-query failure.
      } finally {
        if (!disposed) timer = window.setTimeout(refreshRuntime, 3000)
      }
    }

    void refreshRuntime()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [active, currentId])

  const loadProperties = useCallback(async () => {
    if (!current) return
    setPropsPath(joinPath(current.path, 'server.properties'))
    try {
      const text = await window.electronAPI.readServerProperties(current.id)
      setPropsText(text)
      setPropsMap(parseProperties(text))
    } catch {
      setPropsText('')
      setPropsMap({})
    }
  }, [current])

  useEffect(() => {
    if (!current || tab !== 2) return
    void loadProperties()
  }, [current, tab, loadProperties])

  useEffect(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    if (!current || tab !== 2 || status !== 'running') return

    // Server may generate server.properties shortly after startup.
    refreshTimerRef.current = window.setTimeout(() => {
      void loadProperties()
      refreshTimerRef.current = null
    }, 1200)

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [current, tab, status, loadProperties])

  function handlePropChange(key: string, val: string) {
    setPropsMap(prev => ({ ...prev, [key]: val }))
  }

  async function handleSaveProperties() {
    if (!propsPath) return
    const text = serializeProperties(propsMap, propsText)
    if (!current) return
    await window.electronAPI.writeServerProperties(current.id, text)
    setPropsText(text)
  }

  const handleStart = useCallback(async () => {
    if (!current) return
    setJavaError('')
    try {
      await window.electronAPI.startServer(current.id, maxRam)
    } catch (error: any) {
      setJavaError(error?.message || '服务器启动失败')
    }
  }, [current, maxRam])

  const handleStop = useCallback(async () => {
    if (!current) return
    setJavaError('')
    try { await window.electronAPI.stopServer(current.id) }
    catch (error: any) { setJavaError(error?.message || '服务器停止失败') }
  }, [current])
  const handleForceStop = useCallback(async () => {
    if (!current) return
    setJavaError('')
    try { await window.electronAPI.forceStopServer(current.id) }
    catch (error: any) { setJavaError(error?.message || '服务器强制停止失败') }
  }, [current])

  const handleCommand = useCallback(async () => {
    if (!cmd.trim()) return
    if (!current) return
    setJavaError('')
    try {
      await window.electronAPI.sendServerCommand(current.id, cmd.trim())
      setCmd('')
    } catch (error: any) {
      setJavaError(error?.message || '服务器命令发送失败')
    }
  }, [cmd, current])

  const handleDeleteOpen = useCallback(() => {
    if (!current) return
    setDeleteError('')
    setDeleteOpen(true)
  }, [current])

  const handleDeleteAction = useCallback(async (deleteFiles: boolean) => {
    if (!current) return
    try {
      await window.electronAPI.serversRemove(current.id, { deleteFiles })
      setDeleteOpen(false)
      setDeleteError('')
      await loadServers()
    } catch (e: any) {
      setDeleteError(e?.message || '删除失败')
    }
  }, [current])

  const handleSelectJava = useCallback(async () => {
    if (!current) return
    const selectedPath = await window.electronAPI.selectJavaExecutable()
    if (!selectedPath) return
    setJavaError('')
    await window.electronAPI.serversUpdate(current.id, { javaPath: selectedPath })
    await loadServers()
  }, [current])

  const handleClearJava = useCallback(async () => {
    if (!current) return
    setJavaError('')
    await window.electronAPI.serversUpdate(current.id, { javaPath: undefined })
    await loadServers()
  }, [current])

  const handleAddOpen = async () => {
    setAddDir(''); setAddName(''); setAddJar('server.jar'); setAddCoreId('unknown'); setAddCoreName('unknown'); setAddVersion('')
    setAddOpen(true)
  }

  const handleAddPickDir = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (!dir) return
    setAddDir(dir)

    try {
      const profileText = await window.electronAPI.readServerProfile(dir)
      const profile = parseServerProfile(profileText)
      if (profile.serverName) setAddName(profile.serverName)
      if (profile.coreType) setAddCoreId(profile.coreType)
      if (profile.coreName || profile.coreType) setAddCoreName(profile.coreName || profile.coreType || 'unknown')
      if (profile.gameVersion) setAddVersion(profile.gameVersion)
    } catch {
      /* ignore */
    }

    try {
      const info = await window.electronAPI.detectServer(dir)
      setAddJar(info.jarName)
      setAddCoreId(prev => prev === 'unknown' ? info.coreId : prev)
      setAddCoreName(prev => prev === 'unknown' ? info.coreName : prev)
      setAddVersion(prev => prev ? prev : info.version)
      setAddName(prev => prev.trim() ? prev : info.coreName)
    } catch { /* ignore */ }
  }

  const handleAddConfirm = async () => {
    if (!addDir || !addName.trim()) return
    await window.electronAPI.serversAdd({
      name: addName.trim(),
      path: addDir,
      coreId: addCoreId,
      coreName: addCoreName,
      version: addVersion || '未知',
      jarName: addJar,
      maxRam: 2048,
      managedPath: false,
    })
    setAddOpen(false)
    loadServers()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleCommand() }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy"><h1 className="page-heading__title">本地服务器</h1></div>
        <Button variant="secondary" startIcon={<Plus />} onClick={handleAddOpen}>添加已有服务器</Button>
      </section>

      <section className="section-stack">
        <div className="toolbar">
          <div className="toolbar__group">
            <select className="ui-select server-picker" value={currentId} onChange={event => setCurrentId(event.target.value)}>
              {!servers.length ? <option value="">暂无已保存的服务器</option> : null}
              {servers.map(server => <option key={server.id} value={server.id}>{server.name} ({server.coreName} {server.version})</option>)}
            </select>
            {current ? <Badge tone={status === 'running' || status === 'external' ? 'success' : status === 'starting' ? 'warning' : status === 'error' ? 'danger' : 'neutral'}>{statusLabel}</Badge> : null}
          </div>
          {current ? (
            <div className="toolbar__group">
              <div className="range-control">
                <span className="range-control__value">内存 {maxRam} MB</span>
                <input type="range" value={maxRam} onChange={event => setMaxRam(Number(event.target.value))} onMouseUp={event => void window.electronAPI.serversUpdate(current.id, { maxRam: Number(event.currentTarget.value) })} min={512} max={16384} step={256} />
              </div>
              {processActive ? <Button variant="danger" size="sm" startIcon={<Square />} onClick={handleStop} disabled={status === 'stopping'}>{status === 'stopping' ? '停止中' : '停止'}</Button> : <Button size="sm" startIcon={<Play />} onClick={handleStart}>启动</Button>}
              {processActive ? <IconButton tone="danger" onClick={handleForceStop} title="强制结束进程" aria-label="强制结束进程"><Power /></IconButton> : null}
              <IconButton tone="danger" onClick={handleDeleteOpen} disabled={processActive} title={processActive ? '请先停止服务器' : '移除服务器'} aria-label="移除服务器"><Trash2 /></IconButton>
            </div>
          ) : null}
        </div>

        {current ? (
          <div className="config-summary stack stack--compact">
            <p className="config-summary__path">{current.path}</p>
            <div className="toolbar__group"><span className="inline-meta">Java: {current.javaPath || '自动检测'}</span><Button variant="link" size="sm" onClick={handleSelectJava}>选择 Java</Button>{current.javaPath ? <Button variant="link" size="sm" onClick={handleClearJava}>恢复自动检测</Button> : null}</div>
            {javaError ? <AlertBanner tone="warning">{javaError}</AlertBanner> : null}
          </div>
        ) : null}
      </section>

      {!current ? <div className="empty-state"><div className="empty-state__content"><h2 className="empty-state__title">还没有本地服务器</h2><Button startIcon={<Plus />} onClick={handleAddOpen}>添加已有服务器</Button></div></div> : null}

      {current ? (
        <section className="section-stack">
          <div className="ui-tabs" role="tablist">
            {['日志', '控制台', '配置'].map((label, index) => <button key={label} className={`ui-tab${tab === index ? ' ui-tab--active' : ''}`} onClick={() => setTab(index)} role="tab" aria-selected={tab === index}>{label}</button>)}
          </div>

          {tab === 0 ? (
            <div className="terminal terminal--large" ref={terminalRef} onScroll={handleTerminalScroll}>
              {logs.map((line, index) => <div className="terminal__line" key={index}>{line}</div>)}
            </div>
          ) : null}

          {tab === 1 ? (
            <div className="stack stack--compact">
              <div className="terminal" style={{ height: 330 }} ref={terminalRef} onScroll={handleTerminalScroll}>
                {logs.map((line, index) => <div className="terminal__line" key={index}>{line}</div>)}
              </div>
              <div className="input-group"><input className="ui-input" placeholder="Minecraft 命令" value={cmd} onChange={event => setCmd(event.target.value)} onKeyDown={handleKeyDown} disabled={status !== 'running' && !externalRunning} /><IconButton tone="accent" onClick={handleCommand} disabled={status !== 'running' && !externalRunning} title="发送命令" aria-label="发送命令"><Send /></IconButton></div>
            </div>
          ) : null}

          {tab === 2 ? (
            <div className="section-stack">
              <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">服务器配置</h2><p className="section-heading__subtitle mono">{propsPath}</p></div>{Object.keys(propsMap).length ? <Button size="sm" onClick={handleSaveProperties}>保存配置</Button> : null}</div>
              {!Object.keys(propsMap).length ? <AlertBanner tone="info">server.properties 文件未找到或为空</AlertBanner> : null}
              <div className="properties-grid">
                {Object.entries(propsMap).map(([key, val]) => {
                  const field = PROP_MAP[key as keyof typeof PROP_MAP]
                  if (!field) return null
                  return <div className="property-field" key={key}><PropFieldWidget propKey={key} value={val} field={field} onChange={handlePropChange} /></div>
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <OnlinePlayers hasServer={Boolean(current)} status={externalRunning ? 'running' : status} players={onlinePlayers} />

      <LocalSystemMetrics active={active} />

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="添加已有服务器" width="sm" footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button><Button onClick={handleAddConfirm} disabled={!addDir || !addName.trim()}>添加</Button></div>}>
        <div className="stack">
          <Field label="服务器名称"><input className="ui-input" value={addName} onChange={event => setAddName(event.target.value)} /></Field>
          <Field label="服务端目录"><div className="input-group"><input className="ui-input" value={addDir} readOnly /><Button variant="secondary" onClick={handleAddPickDir}>选择目录</Button></div></Field>
          <Field label="JAR 文件名"><input className="ui-input" value={addJar} onChange={event => setAddJar(event.target.value)} /></Field>
          <Field label="核心类型（可选）"><input className="ui-input" value={addCoreName} onChange={event => setAddCoreName(event.target.value)} /></Field>
          <Field label="版本（可选）"><input className="ui-input" value={addVersion} onChange={event => setAddVersion(event.target.value)} /></Field>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="移除服务器" width="md" footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="secondary" onClick={() => void handleDeleteAction(false)}>仅从列表移除</Button><Button variant="danger" onClick={() => void handleDeleteAction(true)} disabled={!current?.managedPath}>移除并删除文件</Button></div>}>
        <div className="stack stack--compact"><p className="muted mono">{current?.path || '-'}</p>{deleteError ? <AlertBanner tone="danger">{deleteError}</AlertBanner> : null}{!current?.managedPath ? <AlertBanner tone="info">仅可从列表移除</AlertBanner> : null}</div>
      </Dialog>
    </div>
  )
}
