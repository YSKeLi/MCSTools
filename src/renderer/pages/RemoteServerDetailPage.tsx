import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, File, Folder, FolderSearch, Gauge, HardDrive, MemoryStick, Play, Plus, Power, RefreshCw, Send, Square, Trash2 } from 'lucide-react'
import { AlertBanner, Badge, Button, Dialog, Field, IconButton, ProgressBar, Spinner, Toggle } from '../components/ui'
import { OnlinePlayers } from '../components/OnlinePlayers'
import { getActiveLanguage } from '../localization'
import { PROP_MAP, parseProperties, serializeProperties } from '../propertiesMapping'

interface Props {
  active: boolean
  remoteServerId: string
}

type AddMode = 'auto' | 'manual'

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '').trim() || '操作失败，请稍后重试'
}

function remoteOsLabel(os: RemoteServerOs | undefined): string {
  if (os === 'windows') return 'Windows'
  if (os === 'macos') return 'macOS'
  return 'Linux'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** index)
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function formatUptime(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function MetricItem({ icon, label, value, detail, secondary, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; secondary: string; tone: 'accent' | 'success' | 'warning' }) {
  const safeValue = Math.min(100, Math.max(0, value || 0))
  return <div className="metric-item"><div className="metric-item__header"><span className="metric-item__icon">{icon}</span><span className="metric-item__label">{label}</span><span className="metric-item__value">{safeValue.toFixed(1)}%</span></div><ProgressBar value={safeValue} tone={tone} /><p className="metric-item__detail">{detail}</p><p className="metric-item__secondary" title={secondary}>{secondary}</p></div>
}

function InfoItem({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return <div className={`info-item${full ? ' info-item--full' : ''}`}><span className="info-item__label">{label}</span><span className="info-item__value">{value || '-'}</span></div>
}

function PropFieldWidget({ propKey, value, onChange }: { propKey: string; value: string; onChange: (key: string, value: string) => void }) {
  const field = PROP_MAP[propKey]
  if (!field) return null
  if (field.type === 'bool') return <Toggle checked={value === 'true'} onChange={checked => onChange(propKey, checked ? 'true' : 'false')} label={field.label} />
  if (field.type === 'enum') return <Field label={field.label}><select className="ui-select" value={value} onChange={event => onChange(propKey, event.target.value)}>{field.options?.map(option => <option key={option}>{option}</option>)}</select></Field>
  return <Field label={field.label}><input className="ui-input" type={field.type === 'number' ? 'number' : 'text'} value={value} onChange={event => onChange(propKey, event.target.value)} /></Field>
}

function inferOnlinePlayers(logs: string[]): string[] {
  const players = new Map<string, string>()
  logs.forEach(line => {
    const joined = line.match(/\b([A-Za-z0-9_]{1,16}) joined the game\b/)
    if (joined) players.set(joined[1].toLowerCase(), joined[1])
    const left = line.match(/\b([A-Za-z0-9_]{1,16}) left the game\b/)
    if (left) players.delete(left[1].toLowerCase())
  })
  return [...players.values()]
}

export function RemoteServerDetailPage({ active, remoteServerId }: Props) {
  const [host, setHost] = useState<RemoteServerSummary | null>(null)
  const [metrics, setMetrics] = useState<RemoteServerMetrics | null>(null)
  const [instances, setInstances] = useState<RemoteMinecraftServer[]>([])
  const [currentId, setCurrentId] = useState('')
  const [status, setStatus] = useState<RemoteMinecraftServerStatus>('stopped')
  const [logs, setLogs] = useState<string[]>([])
  const [tab, setTab] = useState(0)
  const [maxRam, setMaxRam] = useState(2048)
  const [cmd, setCmd] = useState('')
  const [error, setError] = useState('')
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [propsText, setPropsText] = useState('')
  const [propsMap, setPropsMap] = useState<Record<string, string>>({})
  const [propsLoading, setPropsLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('auto')
  const [scanLoading, setScanLoading] = useState(false)
  const [directories, setDirectories] = useState<RemoteMinecraftDirectory[]>([])
  const [manualPath, setManualPath] = useState('')
  const [selectedDirectory, setSelectedDirectory] = useState<RemoteMinecraftDirectory | null>(null)
  const [addType, setAddType] = useState('')
  const [addVersion, setAddVersion] = useState('')
  const [addRemark, setAddRemark] = useState('')
  const [addJar, setAddJar] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserListing, setBrowserListing] = useState<RemoteDirectoryListing | null>(null)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserError, setBrowserError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const followLatestLogsRef = useRef(true)
  const pollInFlight = useRef(false)

  const current = instances.find(instance => instance.id === currentId) || null
  const managedRunning = status === 'running'
  const externalRunning = status === 'external'
  const processActive = managedRunning || externalRunning
  const statusLabel = managedRunning || externalRunning ? '运行中' : status === 'error' ? '错误' : '未运行'
  const onlinePlayers = inferOnlinePlayers(logs)

  const loadHost = useCallback(async () => {
    const nextHost = (await window.electronAPI.remoteServersList()).find(item => item.id === remoteServerId) || null
    setHost(nextHost)
    if (!nextHost) setError('云服务器不存在或已被删除')
  }, [remoteServerId])

  const loadInstances = useCallback(async () => {
    const next = await window.electronAPI.remoteMinecraftServersList(remoteServerId)
    setInstances(next)
    setCurrentId(value => next.some(item => item.id === value) ? value : (next[0]?.id || ''))
  }, [remoteServerId])

  const loadMetrics = useCallback(async (quiet = false) => {
    if (!quiet) setMetricsLoading(true)
    try {
      setMetrics(await window.electronAPI.remoteServerGetMetrics(remoteServerId))
      setError('')
    } catch (loadError) {
      setError(cleanError(loadError))
    } finally {
      if (!quiet) setMetricsLoading(false)
    }
  }, [remoteServerId])

  const loadRuntime = useCallback(async (instanceId: string, quiet = false) => {
    if (!instanceId || pollInFlight.current) return
    pollInFlight.current = true
    if (!quiet) setRuntimeLoading(true)
    try {
      const [nextStatus, nextLogs] = await Promise.all([
        window.electronAPI.remoteMinecraftServerStatus(remoteServerId, instanceId),
        window.electronAPI.remoteMinecraftServerLogs(remoteServerId, instanceId),
      ])
      setStatus(nextStatus)
      setLogs(nextLogs)
      setError('')
    } catch (loadError) {
      setError(cleanError(loadError))
      setStatus('error')
    } finally {
      pollInFlight.current = false
      if (!quiet) setRuntimeLoading(false)
    }
  }, [remoteServerId])

  const loadProperties = useCallback(async () => {
    if (!currentId) return
    setPropsLoading(true)
    try {
      const text = await window.electronAPI.remoteMinecraftServerReadProperties(remoteServerId, currentId)
      setPropsText(text)
      setPropsMap(parseProperties(text))
    } catch (loadError) {
      setPropsText('')
      setPropsMap({})
      setError(cleanError(loadError))
    } finally {
      setPropsLoading(false)
    }
  }, [currentId, remoteServerId])

  useEffect(() => {
    if (!active || !remoteServerId) return
    void loadHost()
    void loadInstances().catch(loadError => setError(cleanError(loadError)))
    void loadMetrics()
    const timer = window.setInterval(() => void loadMetrics(true), 10000)
    return () => window.clearInterval(timer)
  }, [active, remoteServerId, loadHost, loadInstances, loadMetrics])

  useEffect(() => {
    setLogs([])
    setStatus('stopped')
    if (!active || !currentId) return
    void loadRuntime(currentId)
    const timer = window.setInterval(() => void loadRuntime(currentId, true), 3000)
    return () => window.clearInterval(timer)
  }, [active, currentId, loadRuntime])

  useEffect(() => { if (current) setMaxRam(current.maxRam) }, [current])
  useEffect(() => { if (tab === 2 && currentId) void loadProperties() }, [tab, currentId, loadProperties])
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

  function openAddDialog() {
    setAddMode('auto'); setDirectories([]); setManualPath(''); setSelectedDirectory(null)
    setAddType(''); setAddVersion(''); setAddRemark(''); setAddJar(''); setAddError(''); setBrowserOpen(false); setAddOpen(true)
  }

  function chooseDirectory(directory: RemoteMinecraftDirectory) {
    setSelectedDirectory(directory)
    setAddType(directory.suggestedType === '未知' ? '' : directory.suggestedType)
    setAddVersion(directory.suggestedVersion === '未知' ? '' : directory.suggestedVersion)
    setAddRemark(directory.suggestedRemark || '')
    setAddJar(directory.jarFiles.includes(directory.suggestedJar) ? directory.suggestedJar : (directory.jarFiles[0] || ''))
    setAddError(directory.jarFiles.length ? '' : '该目录中没有可启动的 JAR 文件')
  }

  async function scanDirectories() {
    setScanLoading(true); setAddError(''); setSelectedDirectory(null)
    try {
      const found = await window.electronAPI.remoteMinecraftFindDirectories(remoteServerId)
      setDirectories(found)
      if (!found.length) setAddError('没有自动找到包含 server.properties 的目录，请改用手动添加')
    } catch (scanError) { setAddError(cleanError(scanError)) } finally { setScanLoading(false) }
  }

  async function loadBrowserDirectory(remotePath?: string) {
    setBrowserLoading(true)
    setBrowserError('')
    try {
      setBrowserListing(await window.electronAPI.remoteMinecraftBrowseDirectory(remoteServerId, remotePath))
    } catch (browseError) {
      setBrowserError(cleanError(browseError))
    } finally {
      setBrowserLoading(false)
    }
  }

  function openDirectoryBrowser() {
    setBrowserOpen(true)
    setBrowserListing(null)
    setBrowserError('')
    void loadBrowserDirectory(manualPath.trim() || undefined)
  }

  async function selectBrowserDirectory() {
    if (!browserListing?.containsServerProperties || !browserListing.path) return
    const remotePath = browserListing.path
    setBrowserOpen(false)
    setManualPath(remotePath)
    setScanLoading(true)
    setAddError('')
    try {
      chooseDirectory(await window.electronAPI.remoteMinecraftInspectDirectory(remoteServerId, remotePath))
    } catch (inspectError) {
      setSelectedDirectory(null)
      setAddError(cleanError(inspectError))
    } finally {
      setScanLoading(false)
    }
  }

  async function addInstance() {
    if (!selectedDirectory) return
    setAddLoading(true); setAddError('')
    try {
      const added = await window.electronAPI.remoteMinecraftServersAdd(remoteServerId, {
        path: selectedDirectory.path,
        jarName: addJar,
        coreType: addType,
        version: addVersion,
        remark: addRemark,
        maxRam: 2048,
      })
      setInstances(value => [...value, added]); setCurrentId(added.id); setAddOpen(false); setTab(0)
    } catch (addInstanceError) { setAddError(cleanError(addInstanceError)) }
    finally { setAddLoading(false) }
  }

  async function handleStart() {
    if (!current) return
    setRuntimeLoading(true); setError('')
    try { await window.electronAPI.remoteMinecraftServerStart(remoteServerId, current.id, maxRam); await loadInstances(); await loadRuntime(current.id) }
    catch (startError) { setError(cleanError(startError)) }
    finally { setRuntimeLoading(false) }
  }

  async function handleStop(force = false) {
    if (!current) return
    setRuntimeLoading(true); setError('')
    try { await window.electronAPI.remoteMinecraftServerStop(remoteServerId, current.id, force); await loadRuntime(current.id) }
    catch (stopError) { setError(cleanError(stopError)) }
    finally { setRuntimeLoading(false) }
  }

  async function handleCommand() {
    if (!current || !cmd.trim()) return
    try { await window.electronAPI.remoteMinecraftServerCommand(remoteServerId, current.id, cmd.trim()); setCmd(''); window.setTimeout(() => void loadRuntime(current.id, true), 500) }
    catch (commandError) { setError(cleanError(commandError)) }
  }

  async function handleSaveProperties() {
    if (!current) return
    const text = serializeProperties(propsMap, propsText)
    try { await window.electronAPI.remoteMinecraftServerWriteProperties(remoteServerId, current.id, text); setPropsText(text) }
    catch (saveError) { setError(cleanError(saveError)) }
  }

  async function handleRemove() {
    if (!current) return
    try { await window.electronAPI.remoteMinecraftServersRemove(remoteServerId, current.id); setDeleteOpen(false); await loadInstances() }
    catch (removeError) { setDeleteOpen(false); setError(cleanError(removeError)) }
  }

  if (!host && !error) return <div className="empty-state"><div className="empty-state__content"><Spinner size={28} /><p className="empty-state__message">正在连接云服务器...</p></div></div>

  return (
    <div className="page-stack remote-detail">
      <section className="page-heading">
        <div className="page-heading__copy"><div className="toolbar__group"><h1 className="page-heading__title">{host?.name || '云服务器'}</h1><Badge>{remoteOsLabel(host?.os)}</Badge><Badge tone={metrics ? 'success' : 'neutral'}>{metrics ? '已连接' : '未连接'}</Badge></div><p className="page-heading__subtitle mono">{host ? `${host.username}@${host.host}:${host.port}` : '-'}</p></div>
        <IconButton onClick={() => void loadMetrics()} loading={metricsLoading} title="刷新系统信息" aria-label="刷新系统信息"><RefreshCw /></IconButton>
      </section>

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      <section className="section-stack">
        <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">远程系统状态</h2></div>{metrics ? <span className="inline-meta">更新于 {new Date(metrics.fetchedAt).toLocaleTimeString(getActiveLanguage())}</span> : null}</div>
        {!metrics ? <div className="empty-state"><div className="empty-state__content"><Spinner size={26} /><p className="empty-state__message">正在读取设备状态...</p></div></div> : (
          <><div className="metrics-block"><div className="metrics-grid"><MetricItem icon={<Gauge />} label="CPU" value={metrics.cpu.usagePercent} detail={`${metrics.cpu.cores} 个逻辑核心`} secondary={metrics.cpu.loadAverage === undefined ? metrics.cpu.model : `负载 ${metrics.cpu.loadAverage.toFixed(2)}`} tone="accent" /><MetricItem icon={<MemoryStick />} label="内存" value={metrics.memory.usagePercent} detail={`${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`} secondary={`可用 ${formatBytes(metrics.memory.availableBytes)}`} tone="success" /><MetricItem icon={<HardDrive />} label="系统盘" value={metrics.disk.usagePercent} detail={`${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`} secondary={`可用 ${formatBytes(metrics.disk.availableBytes)}`} tone="warning" /></div></div><div className="info-grid"><InfoItem label="主机名" value={metrics.hostname} /><InfoItem label="运行时间" value={formatUptime(metrics.uptimeSeconds)} /><InfoItem label="操作系统" value={metrics.osName} /><InfoItem label="内核版本" value={metrics.kernel} /><InfoItem label="处理器" value={metrics.cpu.model} /><InfoItem label="文件系统" value={`${metrics.disk.mount} · ${metrics.disk.filesystem || '-'}`} /><InfoItem label="SSH 主机指纹 (SHA-256)" value={host?.hostFingerprint || ''} full /></div></>
        )}
      </section>

      <section className="section-stack">
        <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">Minecraft 服务器</h2></div><Button startIcon={<Plus />} onClick={openAddDialog}>添加服务器目录</Button></div>
        {instances.length ? <div className="toolbar"><div className="toolbar__group"><select className="ui-select server-picker" value={currentId} onChange={event => { setCurrentId(event.target.value); setTab(0) }}>{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.name} ({instance.coreType} {instance.version})</option>)}</select><Badge tone={managedRunning || externalRunning ? 'success' : status === 'error' ? 'danger' : 'neutral'}>{statusLabel}</Badge></div>{current ? <div className="toolbar__group"><div className="range-control"><span className="range-control__value">内存 {maxRam} MB</span><input type="range" value={maxRam} onChange={event => setMaxRam(Number(event.target.value))} onMouseUp={event => { const value = Number(event.currentTarget.value); void window.electronAPI.remoteMinecraftServerUpdate(remoteServerId, current.id, value).then(updated => setInstances(items => items.map(item => item.id === updated.id ? updated : item))).catch(updateError => setError(cleanError(updateError))) }} min={512} max={16384} step={256} /></div>{processActive ? <Button variant="danger" size="sm" startIcon={<Square />} onClick={() => void handleStop()} loading={runtimeLoading}>停止</Button> : <Button size="sm" startIcon={<Play />} onClick={() => void handleStart()} loading={runtimeLoading}>启动</Button>}{processActive ? <IconButton tone="danger" onClick={() => void handleStop(true)} title="强制结束进程" aria-label="强制结束进程"><Power /></IconButton> : null}<IconButton tone="danger" onClick={() => setDeleteOpen(true)} disabled={processActive} title={processActive ? '请先停止服务器' : '移除服务器'} aria-label="移除服务器"><Trash2 /></IconButton></div> : null}</div> : null}
        {current ? <div className="config-summary stack stack--compact"><p className="config-summary__path">{current.path}</p><div className="toolbar__group"><span className="inline-meta">{current.jarName}</span>{current.remark ? <span className="inline-meta">备注：{current.remark}</span> : null}</div></div> : null}
        {!instances.length ? <div className="empty-state"><div className="empty-state__content"><FolderSearch className="empty-state__icon" /><h2 className="empty-state__title">还没有添加 Minecraft 服务器目录</h2><Button startIcon={<Plus />} onClick={openAddDialog}>自动查找或手动添加</Button></div></div> : null}
      </section>

      {current ? <section className="section-stack"><div className="ui-tabs" role="tablist">{['日志', '控制台', '配置'].map((label, index) => <button key={label} className={`ui-tab${tab === index ? ' ui-tab--active' : ''}`} onClick={() => setTab(index)} role="tab" aria-selected={tab === index}>{label}</button>)}</div>{tab === 0 ? <div className="terminal terminal--large" ref={terminalRef} onScroll={handleTerminalScroll}>{logs.map((line, index) => <div className="terminal__line" key={`${index}-${line}`}>{line}</div>)}</div> : null}{tab === 1 ? <div className="stack stack--compact"><div className="terminal" style={{ height: 330 }} ref={terminalRef} onScroll={handleTerminalScroll}>{logs.map((line, index) => <div className="terminal__line" key={`${index}-${line}`}>{line}</div>)}</div><div className="input-group"><input className="ui-input" placeholder="Minecraft 命令" value={cmd} onChange={event => setCmd(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void handleCommand() }} disabled={!processActive} /><IconButton tone="accent" onClick={() => void handleCommand()} disabled={!processActive} title="发送命令" aria-label="发送命令"><Send /></IconButton></div></div> : null}{tab === 2 ? <div className="section-stack"><div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">服务器配置</h2><p className="section-heading__subtitle mono">{current.path}/server.properties</p></div>{Object.keys(propsMap).length ? <Button size="sm" onClick={() => void handleSaveProperties()}>保存配置</Button> : null}</div>{propsLoading ? <Spinner size={24} /> : null}{!propsLoading && !Object.keys(propsMap).length ? <AlertBanner tone="info">server.properties 文件未找到或为空</AlertBanner> : null}<div className="properties-grid">{Object.entries(propsMap).map(([key, value]) => PROP_MAP[key] ? <div className="property-field" key={key}><PropFieldWidget propKey={key} value={value} onChange={(propKey, propValue) => setPropsMap(previous => ({ ...previous, [propKey]: propValue }))} /></div> : null)}</div></div> : null}</section> : null}

      <OnlinePlayers hasServer={Boolean(current)} status={managedRunning || externalRunning ? 'running' : status === 'error' ? 'error' : 'stopped'} players={onlinePlayers} />

      <Dialog
        open={addOpen}
        onClose={() => !addLoading && !scanLoading && !browserOpen && setAddOpen(false)}
        dismissible={!addLoading && !scanLoading && !browserOpen}
        title="添加远程 Minecraft 服务器"
        width="lg"
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addLoading || scanLoading}>取消</Button><Button onClick={() => void addInstance()} loading={addLoading} disabled={!selectedDirectory || !addType.trim() || !addVersion.trim() || !addRemark.trim() || !addJar}>添加</Button></div>}
      >
        <div className="stack">
          <div className="ui-tabs remote-add-tabs" role="tablist">
            <button className={`ui-tab${addMode === 'auto' ? ' ui-tab--active' : ''}`} onClick={() => { setAddMode('auto'); setSelectedDirectory(null); setAddError('') }}>自动查找</button>
            <button className={`ui-tab${addMode === 'manual' ? ' ui-tab--active' : ''}`} onClick={() => { setAddMode('manual'); setSelectedDirectory(null); setAddError('') }}>手动添加</button>
          </div>
          {addError ? <AlertBanner tone={directories.length ? 'warning' : 'danger'}>{addError}</AlertBanner> : null}
          {addMode === 'auto' ? (
            <div className="stack stack--compact">
              <Button variant="secondary" startIcon={<FolderSearch />} onClick={() => void scanDirectories()} loading={scanLoading}>查找 server.properties</Button>
              {directories.length ? <div className="remote-directory-list">{directories.map(directory => <button type="button" key={directory.path} className={`remote-directory-item${selectedDirectory?.path === directory.path ? ' remote-directory-item--active' : ''}`} onClick={() => chooseDirectory(directory)}><strong>{directory.name}</strong><span className="mono">{directory.path}</span><span>{directory.suggestedType} · {directory.suggestedVersion}</span></button>)}</div> : null}
            </div>
          ) : (
            <div className="input-group">
              <input className="ui-input" value={manualPath} readOnly placeholder="请从远程文件列表选择目录" />
              <Button variant="secondary" startIcon={<Folder />} onClick={openDirectoryBrowser} loading={scanLoading}>浏览远程目录</Button>
            </div>
          )}
          {selectedDirectory ? <div className="remote-directory-selection"><p className="mono">{selectedDirectory.path}</p><div className="form-grid"><Field label="版本"><input className="ui-input" value={addVersion} onChange={event => setAddVersion(event.target.value)} placeholder="例如 1.21.1" /></Field><Field label="类型"><input className="ui-input" value={addType} onChange={event => setAddType(event.target.value)} placeholder="例如 Paper" /></Field></div><Field label="服务端 JAR"><select className="ui-select" value={addJar} onChange={event => setAddJar(event.target.value)}>{selectedDirectory.jarFiles.map(file => <option key={file}>{file}</option>)}</select></Field><Field label="备注"><textarea className="ui-textarea" value={addRemark} onChange={event => setAddRemark(event.target.value)} maxLength={500} rows={3} placeholder="例如：生存主服" /></Field></div> : null}
        </div>
      </Dialog>

      <Dialog
        open={browserOpen}
        onClose={() => !browserLoading && setBrowserOpen(false)}
        dismissible={!browserLoading}
        title="选择远程服务器目录"
        width="lg"
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setBrowserOpen(false)} disabled={browserLoading}>取消</Button><Button onClick={() => void selectBrowserDirectory()} disabled={!browserListing?.containsServerProperties || browserLoading}>选择当前目录</Button></div>}
      >
        <div className="remote-file-browser">
          <div className="remote-file-browser__toolbar">
            <IconButton onClick={() => void loadBrowserDirectory(browserListing?.parentPath ?? undefined)} disabled={browserLoading || !browserListing || browserListing.parentPath === null} title="返回上级目录" aria-label="返回上级目录"><ArrowUp /></IconButton>
            <p className="remote-file-browser__path mono" title={browserListing?.path || '远程磁盘'}>{browserListing?.path || '远程磁盘'}</p>
            <IconButton onClick={() => void loadBrowserDirectory(browserListing?.path || undefined)} loading={browserLoading} title="刷新目录" aria-label="刷新目录"><RefreshCw /></IconButton>
          </div>
          {browserError ? <AlertBanner tone="danger">{browserError}</AlertBanner> : null}
          {browserListing?.containsServerProperties ? <AlertBanner tone="success">当前目录包含 server.properties，可以选择</AlertBanner> : null}
          <div className="remote-file-browser__list">
            {browserLoading && !browserListing ? <div className="remote-file-browser__loading"><Spinner size={26} /><span>正在读取远程文件...</span></div> : null}
            {!browserLoading && browserListing && !browserListing.items.length ? <div className="remote-file-browser__loading"><span>此目录为空</span></div> : null}
            {browserListing?.items.map(item => item.type === 'file' ? (
              <div className={`remote-file-row${item.name.toLowerCase() === 'server.properties' ? ' remote-file-row--highlight' : ''}`} key={item.path}>
                <span className="remote-file-row__icon"><File /></span><span className="remote-file-row__name">{item.name}</span><span className="remote-file-row__meta">{formatBytes(item.size)}</span>
              </div>
            ) : (
              <button type="button" className="remote-file-row remote-file-row--directory" key={item.path} onClick={() => void loadBrowserDirectory(item.path)} disabled={browserLoading}>
                <span className="remote-file-row__icon">{item.type === 'drive' ? <HardDrive /> : <Folder />}</span><span className="remote-file-row__name">{item.name}</span><span className="remote-file-row__meta">打开</span>
              </button>
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="移除远程服务器" width="sm" footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" onClick={() => void handleRemove()}>移除</Button></div>}><div className="stack stack--compact"><p>确定从列表移除「{current?.name}」吗？</p><p className="muted">运行状态、日志和服务器文件仍保留在远程目录中。</p></div></Dialog>
    </div>
  )
}
