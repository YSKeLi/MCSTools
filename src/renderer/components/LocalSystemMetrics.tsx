import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Gauge, HardDrive, MemoryStick, RefreshCw } from 'lucide-react'
import { AlertBanner, IconButton, ProgressBar, Spinner } from './ui'
import { getActiveLanguage } from '../localization'

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

function MetricItem({
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
    <div className="metric-item">
      <div className="metric-item__header">
        <span className="metric-item__icon" aria-hidden="true">{icon}</span>
        <span className="metric-item__label">{label}</span>
        <span className="metric-item__value">{formatPercent(safeValue)}</span>
      </div>
      <ProgressBar value={safeValue} tone={color === 'primary' ? 'accent' : color} />
      <p className="metric-item__detail">{detail}</p>
      <p className="metric-item__secondary" title={secondary}>{secondary}</p>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span className="info-item__label">{label}</span>
      <span className="info-item__value">{value || '-'}</span>
    </div>
  )
}

export function LocalSystemMetrics({ active }: Props) {
  const [metrics, setMetrics] = useState<LocalSystemMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sessionRef = useRef(0)
  const requestInFlight = useRef<Promise<LocalSystemMetrics> | null>(null)

  const loadMetrics = useCallback(async (session: number, refreshDisk = false) => {
    setLoading(true)
    try {
      let request = requestInFlight.current
      if (!request) {
        request = window.electronAPI.getLocalSystemMetrics({ refreshDisk })
        requestInFlight.current = request
        void request.finally(() => {
          if (requestInFlight.current === request) requestInFlight.current = null
        }).catch(() => undefined)
      }

      const nextMetrics = await request
      if (sessionRef.current !== session) return
      setMetrics(nextMetrics)
      setError('')
    } catch (loadError) {
      if (sessionRef.current !== session) return
      setError(cleanError(loadError))
    } finally {
      if (sessionRef.current === session) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const session = ++sessionRef.current
    void loadMetrics(session)
    const timer = window.setInterval(() => void loadMetrics(session), 5000)
    return () => {
      window.clearInterval(timer)
      if (sessionRef.current === session) sessionRef.current += 1
    }
  }, [active, loadMetrics])

  return (
    <section className="section-stack">
      <div className="section-heading">
        <div className="section-heading__copy">
          <h2 className="section-title">{'\u672C\u673A\u8BBE\u5907\u72B6\u6001'}</h2>
        </div>
        <div className="toolbar__group">
          {metrics ? (
            <span className="inline-meta">
              {new Date(metrics.fetchedAt).toLocaleTimeString(getActiveLanguage())}
            </span>
          ) : null}
          <IconButton
            onClick={() => void loadMetrics(sessionRef.current, true)}
            disabled={loading || !active}
            loading={loading}
            title={'\u5237\u65B0\u8BBE\u5907\u72B6\u6001'}
            aria-label={'\u5237\u65B0\u8BBE\u5907\u72B6\u6001'}
          >
            <RefreshCw />
          </IconButton>
        </div>
      </div>

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      {!metrics ? (
        <div className="empty-state"><div className="empty-state__content">
          <Spinner size={26} />
          <p className="empty-state__message">{'\u6B63\u5728\u8BFB\u53D6\u8BBE\u5907\u72B6\u6001...'}</p>
        </div></div>
      ) : (
        <>
          <div className="metrics-block">
          <div className="metrics-grid">
            <MetricItem
              icon={<Gauge />}
              label="CPU"
              value={metrics.cpu.usagePercent}
              detail={`${metrics.cpu.physicalCores} \u4E2A\u7269\u7406\u6838\u5FC3 \u00B7 ${metrics.cpu.cores} \u4E2A\u903B\u8F91\u6838\u5FC3`}
              secondary={metrics.cpu.model}
              color="primary"
            />
            <MetricItem
              icon={<MemoryStick />}
              label={'\u5185\u5B58'}
              value={metrics.memory.usagePercent}
              detail={`${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`}
              secondary={`${'\u53EF\u7528'} ${formatBytes(metrics.memory.availableBytes)}`}
              color="success"
            />
            <MetricItem
              icon={<HardDrive />}
              label={'\u7CFB\u7EDF\u76D8'}
              value={metrics.disk.usagePercent}
              detail={`${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}`}
              secondary={`${'\u53EF\u7528'} ${formatBytes(metrics.disk.availableBytes)}`}
              color="warning"
            />
          </div></div>

          <div className="info-grid">
              <InfoItem label={'\u8BBE\u5907'} value={[metrics.manufacturer, metrics.model].filter(Boolean).join(' ')} />
              <InfoItem label={'\u4E3B\u673A\u540D'} value={metrics.hostname} />
              <InfoItem label={'\u8FD0\u884C\u65F6\u95F4'} value={formatUptime(metrics.uptimeSeconds)} />
              <InfoItem label={'\u64CD\u4F5C\u7CFB\u7EDF'} value={metrics.osName} />
              <InfoItem label={'\u5185\u6838\u4E0E\u67B6\u6784'} value={`${metrics.kernel} \u00B7 ${metrics.architecture}`} />
              <InfoItem label={'\u7CFB\u7EDF\u76D8'} value={`${metrics.disk.mount} \u00B7 ${metrics.disk.filesystem || '-'}`} />
              <InfoItem label="BIOS" value={[metrics.bios.vendor, metrics.bios.version, metrics.bios.releaseDate].filter(Boolean).join(' \u00B7 ')} />
          </div>
        </>
      )}
    </section>
  )
}
