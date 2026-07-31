import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Play, Square, Trash2 } from 'lucide-react'
import { AlertBanner, Badge, Button, Dialog, Field } from '../components/ui'
import { getActiveLanguage } from '../localization'

function mergeLogHistory(history: string[], live: string[], limit = 500): string[] {
  let overlap = Math.min(history.length, live.length)
  while (overlap > 0) {
    const historyStart = history.length - overlap
    if (history.slice(historyStart).every((line, index) => line === live[index])) break
    overlap -= 1
  }
  return [...history, ...live.slice(overlap)].slice(-limit)
}

function formatDateTime(value?: string) {
  if (!value) return '未使用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(getActiveLanguage(), { hour12: false })
}

export function FrpPage() {
  const [status, setStatus] = useState('stopped')
  const [logs, setLogs] = useState<string[]>([])
  const [configs, setConfigs] = useState<FrpSavedConfig[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportedFrpConfig | null>(null)
  const [configName, setConfigName] = useState('')
  const [actionError, setActionError] = useState('')
  const terminalRef = useRef<HTMLDivElement>(null)
  const followLatestLogsRef = useRef(true)

  const selectedConfig = useMemo(() => configs.find(item => item.id === selectedId) || null, [configs, selectedId])

  useEffect(() => {
    const unsubLog = window.electronAPI.onFrpLog(line => setLogs(prev => [...prev.slice(-499), line]))
    const unsubStatus = window.electronAPI.onFrpStatus(setStatus)
    const unsubConfigs = window.electronAPI.onFrpConfigsChanged(() => { void loadConfigs() })
    void window.electronAPI.frpStatus().then(setStatus).catch(() => undefined)
    void window.electronAPI.frpLogs().then(history => setLogs(live => mergeLogHistory(history, live))).catch(() => undefined)
    void loadConfigs()
    return () => { unsubLog(); unsubStatus(); unsubConfigs() }
  }, [])

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

  async function loadConfigs() {
    const list = await window.electronAPI.frpConfigsList()
    setConfigs(list)
    setSelectedId(current => current && list.some(item => item.id === current) ? current : (list[0]?.id || ''))
  }

  async function handlePickConfig() {
    setActionError('')
    const preview = await window.electronAPI.frpConfigsPickFile()
    if (!preview) return
    setImportPreview(preview)
    setConfigName(preview.suggestedName)
    setImportDialogOpen(true)
  }

  async function handleSaveImportedConfig() {
    if (!importPreview) return
    try {
      const saved = await window.electronAPI.frpConfigsAdd(configName, importPreview.filePath)
      setImportDialogOpen(false)
      setImportPreview(null)
      setConfigName('')
      setSelectedId(saved.id)
      await loadConfigs()
    } catch (error: any) {
      setActionError(error?.message || '保存配置失败')
    }
  }

  async function handleStartOrStop() {
    setActionError('')
    try {
      if (['running', 'starting', 'stopping'].includes(status)) {
        await window.electronAPI.frpStop()
      } else if (selectedConfig) {
        await window.electronAPI.frpConfigsStart(selectedConfig.id)
        await loadConfigs()
      }
    } catch (error: any) {
      setActionError(error?.message || '启动失败')
    }
  }

  async function handleRemoveConfig() {
    if (!selectedConfig) return
    setActionError('')
    try {
      await window.electronAPI.frpConfigsRemove(selectedConfig.id)
      await loadConfigs()
    } catch (error: any) {
      setActionError(error?.message || '删除配置失败')
    }
  }

  const running = ['running', 'starting', 'stopping'].includes(status)
  const statusLabel = status === 'running' ? '运行中' : status === 'starting' ? '启动中' : status === 'stopping' ? '停止中' : status === 'error' ? '错误' : '未运行'

  function summaryBadges(summary: ImportedFrpConfig['summary']) {
    return (
      <div className="config-summary__meta">
        <Badge>代理 {summary.proxyName}</Badge>
        <Badge>服务端 {summary.serverAddr || '未识别'}:{summary.serverPort}</Badge>
        <Badge>本地 {summary.localPort}</Badge>
        <Badge>远程 {summary.remotePort}</Badge>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy"><h1 className="page-heading__title">FRP 内网穿透</h1></div>
        <Badge tone={status === 'running' ? 'success' : status === 'error' ? 'danger' : 'neutral'}>{statusLabel}</Badge>
      </section>

      {actionError ? <AlertBanner tone="danger">{actionError}</AlertBanner> : null}

      <section className="section-stack">
        <div className="toolbar">
          <div className="toolbar__group">
            <Button variant="secondary" startIcon={<FolderOpen />} onClick={handlePickConfig}>导入配置</Button>
            <Button variant={running ? 'danger' : 'primary'} startIcon={running ? <Square /> : <Play />} onClick={handleStartOrStop} disabled={!running && !selectedConfig}>{running ? '停止' : '启动'}</Button>
            <Button variant="ghost" startIcon={<Trash2 />} onClick={handleRemoveConfig} disabled={!selectedConfig || running}>删除配置</Button>
          </div>
        </div>

        <Field label="当前配置">
          <select className="ui-select" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={!configs.length}>
            {!configs.length ? <option value="">暂无已导入配置</option> : null}
            {configs.map(item => <option key={item.id} value={item.id}>{item.name} ({item.fileName})</option>)}
          </select>
        </Field>

        {selectedConfig ? (
          <div className="config-summary stack stack--compact">
            <div className="config-summary__header">
              <div><strong>{selectedConfig.name}</strong><p className="config-summary__path">{selectedConfig.filePath}</p></div>
              {summaryBadges(selectedConfig.summary)}
            </div>
            <div className="summary-line"><span>导入于 {formatDateTime(selectedConfig.importedAt)}</span><span>最近使用 {formatDateTime(selectedConfig.lastUsedAt)}</span></div>
            {selectedConfig.warnings.map(warning => <AlertBanner key={warning} tone="warning">{warning}</AlertBanner>)}
          </div>
        ) : <AlertBanner tone="warning">暂无已导入配置。</AlertBanner>}
      </section>

      <section className="section-stack">
        <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">运行日志</h2></div></div>
        <div className="terminal terminal--large" ref={terminalRef} onScroll={handleTerminalScroll}>
          {logs.map((line, index) => <div className="terminal__line" key={index}>{line}</div>)}
        </div>
      </section>

      <Dialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        title="保存导入的配置"
        width="sm"
        footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setImportDialogOpen(false)}>取消</Button><Button onClick={handleSaveImportedConfig} disabled={!configName.trim()}>保存到列表</Button></div>}
      >
        {importPreview ? (
          <div className="stack">
            <Field label="配置名称"><input className="ui-input" value={configName} onChange={event => setConfigName(event.target.value)} autoFocus /></Field>
            <Field label="配置文件路径"><input className="ui-input" value={importPreview.filePath} readOnly /></Field>
            {summaryBadges(importPreview.summary)}
            {importPreview.warnings.map(warning => <AlertBanner key={warning} tone="warning">{warning}</AlertBanner>)}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
