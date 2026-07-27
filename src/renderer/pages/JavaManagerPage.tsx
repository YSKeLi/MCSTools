import React, { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'
import { AlertBanner, Badge, Button, ProgressBar } from '../components/ui'

function formatSpeed(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / 1048576).toFixed(1)} MB/s`
}

export function JavaManagerPage() {
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null)
  const [packages, setPackages] = useState<JavaDownloadPackage[]>([])
  const [officialPage, setOfficialPage] = useState('')
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const primaryPackage = useMemo(() => packages.find(item => item.recommended) || null, [packages])
  const secondaryPackages = useMemo(() => packages.filter(item => !item.recommended), [packages])

  useEffect(() => window.electronAPI.onJavaDownloadProgress(setDownloadProgress), [])
  useEffect(() => { void loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [info, javaPackages, pageUrl] = await Promise.all([
        window.electronAPI.detectJava(),
        window.electronAPI.getJavaPackages(),
        window.electronAPI.getJavaOfficialPage(),
      ])
      setJavaInfo(info)
      setPackages(javaPackages)
      setOfficialPage(pageUrl)
    } catch (loadError: any) {
      setError(loadError?.message || '加载 Java 信息失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(packageId: string) {
    setError('')
    setSuccessMessage('')
    setDownloadingId(packageId)
    setDownloadProgress(null)
    try {
      const result = await window.electronAPI.downloadJavaPackage(packageId)
      setSuccessMessage(`下载完成，已打开安装包：${result.filePath}`)
      setJavaInfo(await window.electronAPI.detectJava())
    } catch (downloadError: any) {
      setError(downloadError?.message || '下载 Java 失败')
    } finally {
      setDownloadingId('')
      setDownloadProgress(null)
    }
  }

  function packageBadges(item: JavaDownloadPackage) {
    return (
      <div className="config-summary__meta">
        <Badge>{item.format}</Badge>
        <Badge>{item.architecture}</Badge>
        <Badge tone={item.native ? 'success' : 'warning'}>{item.native ? '原生架构' : '兼容模式'}</Badge>
        <Badge>{item.fileName}</Badge>
      </div>
    )
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy">
          <h1 className="page-heading__title">Java 环境</h1>
        </div>
        <div className="toolbar__group">
          <Button variant="secondary" startIcon={<RefreshCw />} onClick={() => void loadData()} loading={loading}>重新检测</Button>
          <Button variant="ghost" startIcon={<ExternalLink />} onClick={() => void window.electronAPI.openExternal(officialPage)} disabled={!officialPage}>官方页面</Button>
        </div>
      </section>

      <div className="home-status">
        <div className="summary-line">
          <span>当前环境</span>
          <Badge tone={javaInfo ? 'success' : 'warning'}>{loading ? '检测中' : javaInfo ? javaInfo.version : '未检测到'}</Badge>
        </div>
        <span className="inline-meta mono">{javaInfo?.path || '未配置 Java 路径'}</span>
      </div>

      {!loading && !javaInfo ? <AlertBanner tone="warning">未检测到 Java 21</AlertBanner> : null}
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      {successMessage ? <AlertBanner tone="success">{successMessage}</AlertBanner> : null}

      {downloadingId ? (
        <section className="stack stack--compact">
          <div className="summary-line">
            <strong>{downloadProgress?.fileName || '正在准备下载...'}</strong>
            {downloadProgress ? <span>{downloadProgress.percent}% · {formatSpeed(downloadProgress.speed)}</span> : null}
          </div>
          <ProgressBar indeterminate={!downloadProgress} value={downloadProgress?.percent} />
        </section>
      ) : null}

      {primaryPackage ? (
        <section className="section-stack">
          <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">推荐下载</h2></div></div>
          <div className="list-section">
            <div className="list-row">
              <div className="list-row__main stack stack--compact">
                <div><strong>{primaryPackage.title}</strong></div>
                {packageBadges(primaryPackage)}
              </div>
              <Button startIcon={<Download />} onClick={() => void handleDownload(primaryPackage.id)} loading={downloadingId === primaryPackage.id} disabled={Boolean(downloadingId) && downloadingId !== primaryPackage.id}>下载并打开</Button>
            </div>
          </div>
        </section>
      ) : null}

      {secondaryPackages.length ? (
        <section className="section-stack">
          <div className="section-heading"><div className="section-heading__copy"><h2 className="section-title">其他下载方式</h2></div></div>
          <div className="list-section">
            {secondaryPackages.map(item => (
              <div className="list-row" key={item.id}>
                <div className="list-row__main stack stack--compact">
                  <div><strong>{item.title}</strong></div>
                  {packageBadges(item)}
                </div>
                <Button variant="secondary" startIcon={<Download />} onClick={() => void handleDownload(item.id)} loading={downloadingId === item.id} disabled={Boolean(downloadingId) && downloadingId !== item.id}>下载</Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && packages.length === 0 ? <AlertBanner tone="warning">没有匹配的安装包</AlertBanner> : null}
    </div>
  )
}
