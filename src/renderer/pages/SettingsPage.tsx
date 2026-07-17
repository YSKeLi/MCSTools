import React, { useEffect, useState } from 'react'
import { Download, OpenInNew, SystemUpdateAlt } from '@mui/icons-material'
import { Alert, Box, Button, CircularProgress, LinearProgress, Paper, Stack, Typography } from '@mui/material'

function compareVersions(currentVersion: string, latestVersion: string): number {
  const current = currentVersion.split('.').map(part => parseInt(part, 10) || 0)
  const latest = latestVersion.split('.').map(part => parseInt(part, 10) || 0)
  const length = Math.max(current.length, latest.length)

  for (let i = 0; i < length; i += 1) {
    const left = current[i] || 0
    const right = latest[i] || 0
    if (left !== right) return left - right
  }

  return 0
}

function formatSpeed(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / 1048576).toFixed(1)} MB/s`
}

export function SettingsPage() {
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestInfo, setLatestInfo] = useState<LatestReleaseInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setCurrentVersion).catch(() => setCurrentVersion('unknown'))
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })

    return unsubscribe
  }, [])

  const hasUpdate = !!(latestInfo && currentVersion && compareVersions(currentVersion, latestInfo.version) < 0)

  async function handleCheckUpdate() {
    setLoading(true)
    setError('')
    try {
      const data = await window.electronAPI.checkForUpdates()
      setLatestInfo(data)
      setCheckedAt(new Date().toLocaleString())
    } catch (err: any) {
      setError(`检查更新失败: ${err.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadAndInstall() {
    setDownloading(true)
    setError('')
    setDownloadProgress(null)

    try {
      await window.electronAPI.downloadAndInstallUpdate()
    } catch (err: any) {
      setError(`下载更新失败: ${err.message || 'unknown error'}`)
    } finally {
      setDownloading(false)
    }
  }

  async function handleOpenReleasePage() {
    if (!latestInfo?.url) return
    await window.electronAPI.openExternal(latestInfo.url)
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        设置
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 860 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6" gutterBottom>
              版本
            </Typography>
            <Typography variant="body1">当前版本: {currentVersion || '...'}</Typography>
          </Box>

          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SystemUpdateAlt />}
              onClick={handleCheckUpdate}
              disabled={loading || downloading}
            >
              {loading ? '检查中...' : '检查更新'}
            </Button>

            {latestInfo?.url && (
              <Button variant="outlined" startIcon={<OpenInNew />} onClick={handleOpenReleasePage} disabled={downloading}>
                打开发布页
              </Button>
            )}

            {hasUpdate && (
              <Button
                variant="contained"
                color="success"
                startIcon={downloading ? <CircularProgress size={18} color="inherit" /> : <Download />}
                onClick={handleDownloadAndInstall}
                disabled={loading || downloading}
              >
                {downloading ? '下载中...' : '下载并安装更新'}
              </Button>
            )}
          </Stack>

          {checkedAt && (
            <Typography variant="caption" color="text.secondary">
              上次检查时间: {checkedAt}
            </Typography>
          )}

          {downloading && downloadProgress && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="body2" fontWeight={600}>
                  正在下载更新: {downloadProgress.fileName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {downloadProgress.percent}% · {formatSpeed(downloadProgress.speed)}
                </Typography>
                <LinearProgress variant="determinate" value={downloadProgress.percent} />
              </Stack>
            </Paper>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {latestInfo && !error && (
            <Stack spacing={2}>
              <Alert severity={hasUpdate ? 'success' : 'info'}>
                {hasUpdate
                  ? `发现新版本: ${latestInfo.version}`
                  : `当前已经是最新版本: ${currentVersion}`}
              </Alert>

              <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {latestInfo.title}
                  </Typography>
                  <Typography variant="body2">最新版本: {latestInfo.version}</Typography>
                  {latestInfo.publishedAt && (
                    <Typography variant="body2">
                      发布时间: {new Date(latestInfo.publishedAt).toLocaleString()}
                    </Typography>
                  )}
                  <Typography variant="body2">来源仓库: {latestInfo.repo}</Typography>
                </Stack>
              </Paper>

              <Box>
                <Typography variant="h6" gutterBottom>
                  更新内容
                </Typography>
                <Stack spacing={1}>
                  {latestInfo.notes.map((note, index) => (
                    <Typography key={`${index}-${note}`} variant="body2">
                      {index + 1}. {note}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Box>
  )
}
