import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, TextField, Chip, Select, MenuItem,
  Tabs, Tab, Slider, Alert, IconButton, FormControl, InputLabel, Switch,
  FormControlLabel, Grid, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import { PlayArrow, Stop, Send, Delete, Add, PowerSettingsNew } from '@mui/icons-material'
import { LocalSystemMetrics } from '../components/LocalSystemMetrics'
import { PROP_MAP, parseProperties, serializeProperties } from '../propertiesMapping'
import { parseServerProfile } from '../serverProfile'
import type { PropField } from '../propertiesMapping'

function PropFieldWidget({ key: propKey, value, field, onChange }: {
  key: string; value: string; field: PropField; onChange: (key: string, val: string) => void
}) {
  if (field.type === 'bool') {
    return (
      <FormControlLabel
        control={<Switch checked={value === 'true'} onChange={(e) => onChange(propKey, e.target.checked ? 'true' : 'false')} />}
        label={field.label}
      />
    )
  }
  if (field.type === 'enum') {
    return (
      <FormControl fullWidth size="small">
        <InputLabel>{field.label}</InputLabel>
        <Select value={value} label={field.label} onChange={e => onChange(propKey, e.target.value)}>
          {field.options?.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
        </Select>
      </FormControl>
    )
  }
  if (field.type === 'number') {
    return (
      <TextField
        label={field.label} type="number" value={value} size="small" fullWidth
        onChange={e => onChange(propKey, e.target.value)}
      />
    )
  }
  return (
    <TextField
      label={field.label} value={value} size="small" fullWidth
      onChange={e => onChange(propKey, e.target.value)}
    />
  )
}

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .join('/')
}

export function ServerPage({ active }: { active: boolean }) {
  const [runtimeState, setRuntimeState] = useState<ServerRuntimeState>({ serverId: null, status: 'stopped' })
  const [logsByServer, setLogsByServer] = useState<Record<string, string[]>>({})
  const [cmd, setCmd] = useState('')
  const [tab, setTab] = useState(0)
  const [maxRam, setMaxRam] = useState(2048)
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
  const logs = currentId ? logsByServer[currentId] || [] : []

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
    const unsubServersChanged = window.electronAPI.onServersChanged(() => { loadServers() })
    void window.electronAPI.getServerStatus().then(setRuntimeState)
    loadServers()
    return () => { unsubLog(); unsubStatus(); unsubServersChanged() }
  }, [])

  useEffect(() => {
    if (!active) return
    loadServers()
  }, [active])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

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
    if (current) await window.electronAPI.stopServer(current.id)
  }, [current])
  const handleForceStop = useCallback(async () => {
    if (current) await window.electronAPI.forceStopServer(current.id)
  }, [current])

  const handleCommand = useCallback(async () => {
    if (!cmd.trim()) return
    if (!current) return
    await window.electronAPI.sendServerCommand(current.id, cmd.trim())
    setLogsByServer(previous => ({
      ...previous,
      [current.id]: [...(previous[current.id] || []).slice(-500), `> ${cmd}`],
    }))
    setCmd('')
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

  const statusColor = { running: 'success', starting: 'warning', stopped: 'default', error: 'error' } as const

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>本地服务器管理</Typography>

      <LocalSystemMetrics active={active} />

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>选择服务器</InputLabel>
            <Select value={currentId} label="选择服务器" onChange={e => setCurrentId(e.target.value)}>
              {servers.map(s => <MenuItem key={s.id} value={s.id}>{s.name} ({s.coreName} {s.version})</MenuItem>)}
              {servers.length === 0 && <MenuItem disabled>暂无已保存的服务器</MenuItem>}
            </Select>
          </FormControl>
          <Button variant="outlined" size="small" startIcon={<Add />} onClick={handleAddOpen}>添加已有服务器</Button>

          {current && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                {current.path}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>内存: {maxRam} MB</Typography>
                <Slider
                  value={maxRam}
                  onChange={(_, value) => setMaxRam(value as number)}
                  onChangeCommitted={(_, value) => current && void window.electronAPI.serversUpdate(current.id, { maxRam: value as number })}
                  min={512}
                  max={16384}
                  step={256}
                  sx={{ width: 120 }}
                />
              </Box>
              <Chip label={`状态: ${status}`} size="small" color={statusColor[status as keyof typeof statusColor] || 'default'} />
              {status === 'running' ? (
                <>
                  <Button variant="contained" color="error" size="small" startIcon={<Stop />} onClick={handleStop}>停止</Button>
                  <Tooltip title="强制结束进程">
                    <IconButton color="error" size="small" onClick={handleForceStop}><PowerSettingsNew /></IconButton>
                  </Tooltip>
                </>
              ) : (
                <Button variant="contained" size="small" startIcon={<PlayArrow />} onClick={handleStart}>启动</Button>
              )}
              <Tooltip title="移除服务器">
                <IconButton color="error" size="small" onClick={handleDeleteOpen}><Delete /></IconButton>
              </Tooltip>
            </>
          )}
        </Box>
        {current && (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Java: {current.javaPath || '自动检测'}
              </Typography>
              <Button variant="text" size="small" onClick={handleSelectJava}>选择 Java</Button>
              {current.javaPath && <Button variant="text" size="small" color="inherit" onClick={handleClearJava}>恢复自动检测</Button>}
            </Box>
            {javaError && <Alert severity="warning">{javaError}</Alert>}
          </Box>
        )}
      </Paper>

      {current && (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
            <Tab label="日志" />
            <Tab label="控制台" />
            <Tab label="配置" />
          </Tabs>

          {tab === 0 && (
            <Paper
              ref={containerRef}
              sx={{
                height: 400, overflow: 'auto', p: 2, fontFamily: 'Consolas, monospace',
                fontSize: 13, bgcolor: '#1a1a1a', color: '#e0e0e0',
                '&::-webkit-scrollbar': { width: 8 },
                '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
              }}
            >
              {logs.length === 0 && <Typography sx={{ color: '#888' }}>启动服务器后日志将显示在此处</Typography>}
              {logs.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </Paper>
          )}

          {tab === 1 && (
            <Box>
              <Paper
                sx={{
                  height: 340, overflow: 'auto', mb: 1, p: 2, fontFamily: 'Consolas, monospace',
                  fontSize: 13, bgcolor: '#1a1a1a', color: '#e0e0e0',
                  '&::-webkit-scrollbar': { width: 8 },
                  '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
                }}
              >
                {logs.length === 0 && <Typography sx={{ color: '#888' }}>启动服务器后在此输入命令</Typography>}
                {logs.map((line, i) => (
                  <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
                ))}
                <div ref={logEndRef} />
              </Paper>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth size="small"
                  placeholder={status === 'running' ? '输入 Minecraft 命令...' : '等待服务器启动后可输入命令'}
                  value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={handleKeyDown}
                />
                <IconButton color="primary" onClick={handleCommand} disabled={status !== 'running'}><Send /></IconButton>
              </Box>
            </Box>
          )}

          {tab === 2 && (
            <Paper sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">服务器配置</Typography>
                <Button variant="contained" size="small" onClick={handleSaveProperties}>保存配置</Button>
              </Box>

              {Object.keys(propsMap).length === 0 && (
                <Alert severity="info">server.properties 文件未找到或为空，启动服务器后会自动生成。</Alert>
              )}

              <Grid container spacing={2}>
                {Object.entries(propsMap).map(([key, val]) => {
                  const field = PROP_MAP[key as keyof typeof PROP_MAP]
                  if (!field) return null
                  return (
                    <Grid item xs={12} sm={6} md={4} key={key}>
                      <Box sx={{ position: 'relative' }}>
                        <PropFieldWidget key={key} value={val} field={field} onChange={handlePropChange} />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                          {field.desc} ({key})
                        </Typography>
                      </Box>
                    </Grid>
                  )
                })}
              </Grid>

              {Object.keys(propsMap).length > 0 && (
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="contained" onClick={handleSaveProperties}>保存配置</Button>
                </Box>
              )}
            </Paper>
          )}
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>添加已有服务器</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="服务器名称" value={addName} onChange={e => setAddName(e.target.value)} fullWidth />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField label="服务端目录" value={addDir} size="small" sx={{ flexGrow: 1 }} InputProps={{ readOnly: true }} />
              <Button variant="outlined" onClick={handleAddPickDir}>选择目录</Button>
            </Box>
            <TextField label="JAR 文件名" value={addJar} onChange={e => setAddJar(e.target.value)} fullWidth size="small" helperText="服务端核心文件名称，如 server.jar 或 paper.jar" />
            <TextField label="核心类型（可选）" value={addCoreName} onChange={e => setAddCoreName(e.target.value)} fullWidth size="small" helperText="如 Paper、Vanilla、Forge" />
            <TextField label="版本（可选）" value={addVersion} onChange={e => setAddVersion(e.target.value)} fullWidth size="small" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleAddConfirm} disabled={!addDir || !addName.trim()}>添加</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>移除服务器</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography>
              请选择如何处理「{current?.name || '当前服务器'}」。
            </Typography>
            <Typography variant="body2" color="text.secondary">
              服务器目录: {current?.path || '-'}
            </Typography>
            {deleteError && <Alert severity="error">{deleteError}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, justifyContent: 'space-between' }}>
          <Button onClick={() => setDeleteOpen(false)}>取消</Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" color="warning" onClick={() => void handleDeleteAction(false)}>
              从列表中移除（不删除文件）
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={() => void handleDeleteAction(true)}
              disabled={!current?.managedPath}
            >
              从列表中移除并删除文件
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
