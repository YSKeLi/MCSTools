import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Add,
  CloudQueue,
  DeleteOutline,
  Memory,
  Refresh,
  Speed,
  Storage,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

interface Props {
  active: boolean
}

const EMPTY_FORM: RemoteServerInput = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  password: '',
  os: 'linux',
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim() || '操作失败，请稍后重试'
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

function percent(value: number): string {
  return `${Math.min(100, Math.max(0, value || 0)).toFixed(1)}%`
}

interface MetricPanelProps {
  icon: React.ReactNode
  label: string
  value: number
  detail: string
  secondary: string
  color: 'primary' | 'success' | 'warning'
}

function MetricPanel({ icon, label, value, detail, secondary, color }: MetricPanelProps) {
  const safeValue = Math.min(100, Math.max(0, value || 0))
  return (
    <Paper variant="outlined" sx={{ p: 2.25, height: '100%', minHeight: 156 }}>
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: `${color}.main` }}>
          {icon}
          <Typography variant="subtitle2" color="text.primary">{label}</Typography>
          <Typography variant="h6" sx={{ ml: 'auto', fontWeight: 700 }}>{percent(safeValue)}</Typography>
        </Box>
        <LinearProgress variant="determinate" value={safeValue} color={color} sx={{ height: 7, borderRadius: 1 }} />
        <Box sx={{ mt: 'auto' }}>
          <Typography variant="body2" fontWeight={600}>{detail}</Typography>
          <Typography variant="caption" color="text.secondary">{secondary}</Typography>
        </Box>
      </Stack>
    </Paper>
  )
}

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ py: 1.25, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography
        variant="body2"
        sx={{ mt: 0.25, fontFamily: mono ? 'Consolas, monospace' : undefined, wordBreak: 'break-word' }}
      >
        {value || '-'}
      </Typography>
    </Box>
  )
}

export function RemoteServerPage({ active }: Props) {
  const [servers, setServers] = useState<RemoteServerSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [metrics, setMetrics] = useState<RemoteServerMetrics | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState<RemoteServerInput>(EMPTY_FORM)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const metricsRequest = useRef(0)
  const metricsInFlight = useRef(false)

  const selected = servers.find(server => server.id === selectedId) || null

  const loadServers = useCallback(async () => {
    setListLoading(true)
    try {
      const items = await window.electronAPI.remoteServersList()
      setServers(items)
      setSelectedId(current => items.some(item => item.id === current) ? current : (items[0]?.id || ''))
      setError('')
    } catch (loadError) {
      setError(cleanError(loadError))
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadMetrics = useCallback(async (id: string, quiet = false) => {
    if (!id || metricsInFlight.current) return
    metricsInFlight.current = true
    const requestId = ++metricsRequest.current
    if (!quiet) setMetricsLoading(true)
    try {
      const nextMetrics = await window.electronAPI.remoteServerGetMetrics(id)
      if (metricsRequest.current !== requestId) return
      setMetrics(nextMetrics)
      setError('')
    } catch (loadError) {
      if (metricsRequest.current !== requestId) return
      setError(cleanError(loadError))
    } finally {
      metricsInFlight.current = false
      if (metricsRequest.current === requestId) setMetricsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  useEffect(() => {
    metricsRequest.current += 1
    setMetrics(null)
    setError('')
    if (!active || !selectedId) return

    void loadMetrics(selectedId)
    const timer = window.setInterval(() => void loadMetrics(selectedId, true), 10000)
    return () => window.clearInterval(timer)
  }, [active, selectedId, loadMetrics])

  function openAddDialog() {
    setForm(EMPTY_FORM)
    setAddError('')
    setShowPassword(false)
    setAddOpen(true)
  }

  function updateForm<Key extends keyof RemoteServerInput>(key: Key, value: RemoteServerInput[Key]) {
    setForm(current => ({
      ...current,
      [key]: value,
      ...(['host', 'port', 'username'].includes(String(key)) ? { expectedFingerprint: undefined } : {}),
    }))
  }

  async function handleAdd() {
    setAddLoading(true)
    setAddError('')
    try {
      if (!form.expectedFingerprint) {
        const fingerprint = await window.electronAPI.remoteServerFingerprint({
          host: form.host,
          port: form.port,
          username: form.username,
        })
        setForm(current => ({ ...current, expectedFingerprint: fingerprint }))
        return
      }
      const result = await window.electronAPI.remoteServersAdd(form)
      setServers(current => [...current, result.server])
      setSelectedId(result.server.id)
      setMetrics(result.metrics)
      setAddOpen(false)
      setForm(EMPTY_FORM)
      setError('')
    } catch (addServerError) {
      setAddError(cleanError(addServerError))
    } finally {
      setAddLoading(false)
    }
  }

  async function handleDelete() {
    if (!selected) return
    setDeleteLoading(true)
    try {
      await window.electronAPI.remoteServersRemove(selected.id)
      const remaining = servers.filter(server => server.id !== selected.id)
      setServers(remaining)
      setSelectedId(remaining[0]?.id || '')
      setMetrics(null)
      setDeleteOpen(false)
      setError('')
    } catch (removeError) {
      setError(cleanError(removeError))
      setDeleteOpen(false)
    } finally {
      setDeleteLoading(false)
    }
  }

  const canAdd = Boolean(
    form.name.trim()
    && form.host.trim()
    && form.username.trim()
    && form.password
    && Number.isInteger(Number(form.port))
    && Number(form.port) >= 1
    && Number(form.port) <= 65535,
  )

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" fontWeight={700}>云服务器管理</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {servers.length > 0 ? `${servers.length} 台服务器` : '暂无服务器'}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="刷新服务器列表">
          <span>
            <IconButton onClick={() => void loadServers()} disabled={listLoading} aria-label="刷新服务器列表">
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
        <Button variant="contained" startIcon={<Add />} onClick={openAddDialog}>添加服务器</Button>
      </Box>

      {listLoading && servers.length === 0 ? (
        <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
      ) : servers.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{ minHeight: 360, display: 'grid', placeItems: 'center', borderStyle: 'dashed', p: 3 }}
        >
          <Stack alignItems="center" spacing={2}>
            <CloudQueue sx={{ fontSize: 52, color: 'text.disabled' }} />
            <Typography variant="h6">还没有云服务器</Typography>
            <Button variant="contained" startIcon={<Add />} onClick={openAddDialog}>添加服务器</Button>
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={2.5} alignItems="stretch">
          <Grid item xs={12} md={4} lg={3}>
            <Paper variant="outlined" sx={{ overflow: 'hidden', height: '100%', minHeight: 470 }}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="subtitle2">服务器列表</Typography>
              </Box>
              <Divider />
              <List disablePadding>
                {servers.map(server => (
                  <ListItemButton
                    key={server.id}
                    selected={server.id === selectedId}
                    onClick={() => setSelectedId(server.id)}
                    sx={{ py: 1.5, alignItems: 'flex-start' }}
                  >
                    <ListItemIcon sx={{ minWidth: 38, mt: 0.25 }}><CloudQueue fontSize="small" /></ListItemIcon>
                    <ListItemText
                      primary={server.name}
                      secondary={`${server.username}@${server.host}:${server.port}`}
                      primaryTypographyProps={{ fontWeight: server.id === selectedId ? 700 : 500, noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true, sx: { mt: 0.35, fontFamily: 'Consolas, monospace', fontSize: 12 } }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          </Grid>

          <Grid item xs={12} md={8} lg={9}>
            {selected && (
              <Stack spacing={2.5}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 42 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" fontWeight={700} noWrap>{selected.name}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {selected.username}@{selected.host}:{selected.port}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color={metrics ? 'success' : 'default'}
                    label={metrics ? '在线' : metricsLoading ? '连接中' : '未连接'}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label="SSH"
                  />
                  <Box sx={{ flexGrow: 1 }} />
                  <Tooltip title="刷新监控数据">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => void loadMetrics(selected.id)}
                        disabled={metricsLoading}
                        aria-label="刷新监控数据"
                      >
                        <Refresh />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="删除连接">
                    <IconButton size="small" color="error" onClick={() => setDeleteOpen(true)} aria-label="删除连接">
                      <DeleteOutline />
                    </IconButton>
                  </Tooltip>
                </Box>

                {error && (
                  <Alert
                    severity="error"
                    action={<Button color="inherit" size="small" onClick={() => void loadMetrics(selected.id)}>重试</Button>}
                  >
                    {error}
                  </Alert>
                )}

                {metricsLoading && !metrics ? (
                  <Paper variant="outlined" sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <Stack alignItems="center" spacing={1.5}>
                      <CircularProgress size={32} />
                      <Typography variant="body2" color="text.secondary">正在连接服务器</Typography>
                    </Stack>
                  </Paper>
                ) : metrics ? (
                  <>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={4}>
                        <MetricPanel
                          icon={<Speed fontSize="small" />}
                          label="CPU"
                          value={metrics.cpu.usagePercent}
                          detail={`${metrics.cpu.cores} 个逻辑核心`}
                          secondary={metrics.cpu.loadAverage === undefined ? metrics.cpu.model : `负载 ${metrics.cpu.loadAverage.toFixed(2)}`}
                          color="primary"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <MetricPanel
                          icon={<Memory fontSize="small" />}
                          label="内存"
                          value={metrics.memory.usagePercent}
                          detail={`${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`}
                          secondary={`可用 ${formatBytes(metrics.memory.availableBytes)}`}
                          color="success"
                        />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <MetricPanel
                          icon={<Storage fontSize="small" />}
                          label="系统盘"
                          value={metrics.disk.usagePercent}
                          detail={`${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`}
                          secondary={`可用 ${formatBytes(metrics.disk.availableBytes)}`}
                          color="warning"
                        />
                      </Grid>
                    </Grid>

                    <Paper variant="outlined" sx={{ px: 2.5, py: 1 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ pt: 1 }}>基本信息</Typography>
                      <Grid container columnSpacing={3}>
                        <Grid item xs={12} sm={6}><InfoItem label="主机名" value={metrics.hostname} /></Grid>
                        <Grid item xs={12} sm={6}><InfoItem label="运行时间" value={formatUptime(metrics.uptimeSeconds)} /></Grid>
                        <Grid item xs={12} sm={6}><InfoItem label="操作系统" value={metrics.osName} /></Grid>
                        <Grid item xs={12} sm={6}><InfoItem label="内核版本" value={metrics.kernel} /></Grid>
                        <Grid item xs={12} sm={6}><InfoItem label="处理器" value={metrics.cpu.model} /></Grid>
                        <Grid item xs={12} sm={6}><InfoItem label="文件系统" value={`${metrics.disk.mount} · ${metrics.disk.filesystem || '-'}`} /></Grid>
                        <Grid item xs={12}>
                          <InfoItem
                            label="SSH 主机指纹 (SHA-256)"
                            value={selected.hostFingerprint}
                            mono
                          />
                        </Grid>
                      </Grid>
                      <Divider />
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1.25 }}>
                        更新于 {new Date(metrics.fetchedAt).toLocaleString('zh-CN')}
                      </Typography>
                    </Paper>
                  </>
                ) : !error ? (
                  <Paper variant="outlined" sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <Button variant="outlined" startIcon={<Refresh />} onClick={() => void loadMetrics(selected.id)}>读取服务器状态</Button>
                  </Paper>
                ) : null}
              </Stack>
            )}
          </Grid>
        </Grid>
      )}

      <Dialog open={addOpen} onClose={() => !addLoading && setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>添加云服务器</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {addError && <Alert severity="error">{addError}</Alert>}
            {form.expectedFingerprint && (
              <Alert severity="warning">
                请确认主机指纹后继续：<Typography component="span" sx={{ fontFamily: 'Consolas, monospace', wordBreak: 'break-all' }}>{form.expectedFingerprint}</Typography>
              </Alert>
            )}
            <TextField
              label="服务器名称"
              value={form.name}
              onChange={event => updateForm('name', event.target.value)}
              autoFocus
              fullWidth
              disabled={addLoading}
            />
            <FormControl fullWidth disabled={addLoading}>
              <InputLabel>服务器系统</InputLabel>
              <Select
                value={form.os}
                label="服务器系统"
                onChange={event => {
                  const os = event.target.value as RemoteServerOs
                  setForm(current => ({
                    ...current,
                    os,
                    expectedFingerprint: undefined,
                    username: current.username === 'root' || current.username === 'Administrator'
                      ? (os === 'windows' ? '' : 'root')
                      : current.username,
                  }))
                }}
              >
                <MenuItem value="linux">Linux</MenuItem>
                <MenuItem value="windows">Windows Server</MenuItem>
              </Select>
            </FormControl>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={8}>
                <TextField
                  label="服务器地址"
                  placeholder="IP 地址或域名"
                  value={form.host}
                  onChange={event => updateForm('host', event.target.value)}
                  fullWidth
                  disabled={addLoading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="SSH 端口"
                  type="number"
                  value={form.port}
                  onChange={event => updateForm('port', Number(event.target.value))}
                  inputProps={{ min: 1, max: 65535 }}
                  fullWidth
                  disabled={addLoading}
                  helperText="默认端口 22"
                />
              </Grid>
            </Grid>
            <TextField
              label="账户名"
              value={form.username}
              onChange={event => updateForm('username', event.target.value)}
              fullWidth
              disabled={addLoading}
            />
            <TextField
              label="密码"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={event => updateForm('password', event.target.value)}
              fullWidth
              disabled={addLoading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(value => !value)}
                      edge="end"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              helperText="密码由系统安全存储加密保存"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setAddOpen(false)} disabled={addLoading}>取消</Button>
             <Button
            variant="contained"
            onClick={() => void handleAdd()}
            disabled={!canAdd || addLoading}
            startIcon={addLoading ? <CircularProgress size={16} color="inherit" /> : <Add />}
          >
             {addLoading ? '正在连接' : form.expectedFingerprint ? '确认指纹并连接' : '验证主机指纹'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => !deleteLoading && setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>删除服务器连接</DialogTitle>
        <DialogContent>
          <Typography sx={{ pt: 0.5 }}>确定删除「{selected?.name}」吗？</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            仅删除本机保存的连接信息，不会操作远程服务器。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>取消</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={deleteLoading}>删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
