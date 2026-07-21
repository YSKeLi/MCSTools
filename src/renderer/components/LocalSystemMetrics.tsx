import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Memory, Refresh, Speed, Storage } from '@mui/icons-material'
import {
  Alert,
  Box,
  CircularProgress,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'

interface Props {
  active: boolean
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim() || '读取设备信息失败'
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

function formatPercent(value: number): string {
  return `${Math.min(100, Math.max(0, value || 0)).toFixed(1)}%`
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  secondary,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  detail: string
  secondary: string
  color: 'primary' | 'success' | 'warning'
}) {
  const safeValue = Math.min(100, Math.max(0, value || 0))
  return (
    <Paper variant="outlined" sx={{ p: 2, minHeight: 142, height: '100%' }}>
      <Stack spacing={1.25} sx={{ height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: `${color}.main` }}>
          {icon}
          <Typography variant="subtitle2" color="text.primary">{label}</Typography>
          <Typography variant="h6" fontWeight={700} sx={{ ml: 'auto' }}>{formatPercent(safeValue)}</Typography>
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

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ py: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.25, wordBreak: 'break-word' }}>{value || '-'}</Typography>
    </Box>
  )
}

export function LocalSystemMetrics({ active }: Props) {
  const [metrics, setMetrics] = useState<LocalSystemMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestInFlight = useRef(false)

  const loadMetrics = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setLoading(true)
    try {
      setMetrics(await window.electronAPI.getLocalSystemMetrics())
      setError('')
    } catch (loadError) {
      setError(cleanError(loadError))
    } finally {
      requestInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void loadMetrics()
    const timer = window.setInterval(() => void loadMetrics(), 5000)
    return () => window.clearInterval(timer)
  }, [active, loadMetrics])

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700}>本机设备状态</Typography>
        <Box sx={{ flexGrow: 1 }} />
        {metrics && (
          <Typography variant="caption" color="text.secondary">
            {new Date(metrics.fetchedAt).toLocaleTimeString('zh-CN')}
          </Typography>
        )}
        <Tooltip title="刷新设备状态">
          <span>
            <IconButton size="small" onClick={() => void loadMetrics()} disabled={loading} aria-label="刷新设备状态">
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {!metrics ? (
        <Paper variant="outlined" sx={{ minHeight: 150, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={30} />
        </Paper>
      ) : (
        <>
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={4}>
              <MetricCard
                icon={<Speed fontSize="small" />}
                label="CPU"
                value={metrics.cpu.usagePercent}
                detail={`${metrics.cpu.physicalCores} 个物理核心 · ${metrics.cpu.cores} 个逻辑核心`}
                secondary={metrics.cpu.model}
                color="primary"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricCard
                icon={<Memory fontSize="small" />}
                label="内存"
                value={metrics.memory.usagePercent}
                detail={`${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`}
                secondary={`可用 ${formatBytes(metrics.memory.availableBytes)}`}
                color="success"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <MetricCard
                icon={<Storage fontSize="small" />}
                label="系统盘"
                value={metrics.disk.usagePercent}
                detail={`${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`}
                secondary={`可用 ${formatBytes(metrics.disk.availableBytes)}`}
                color="warning"
              />
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ px: 2, py: 0.5, mt: 1.5 }}>
            <Grid container columnSpacing={3}>
              <Grid item xs={12} sm={4}><InfoItem label="设备" value={[metrics.manufacturer, metrics.model].filter(Boolean).join(' ')} /></Grid>
              <Grid item xs={12} sm={4}><InfoItem label="主机名" value={metrics.hostname} /></Grid>
              <Grid item xs={12} sm={4}><InfoItem label="运行时间" value={formatUptime(metrics.uptimeSeconds)} /></Grid>
              <Grid item xs={12} sm={4}><InfoItem label="操作系统" value={metrics.osName} /></Grid>
              <Grid item xs={12} sm={4}><InfoItem label="内核与架构" value={`${metrics.kernel} · ${metrics.architecture}`} /></Grid>
              <Grid item xs={12} sm={4}><InfoItem label="系统盘" value={`${metrics.disk.mount} · ${metrics.disk.filesystem || '-'}`} /></Grid>
            </Grid>
          </Paper>
        </>
      )}
    </Box>
  )
}
