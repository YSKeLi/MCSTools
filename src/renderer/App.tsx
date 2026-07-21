import React, { Component, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  ThemeProvider,
  Typography,
} from '@mui/material'
import { Layout } from './components/Layout'
import { AboutPage } from './pages/AboutPage'
import { RemoteServerPage } from './pages/RemoteServerPage'
import { CoreSelectPage } from './pages/CoreSelectPage'
import { FrpPage } from './pages/FrpPage'
import { HomePage } from './pages/HomePage'
import { JavaManagerPage } from './pages/JavaManagerPage'
import { ServerPage } from './pages/ServerPage'
import { SettingsPage } from './pages/SettingsPage'
import { darkTheme, lightTheme } from './theme'

export type Page = 'home' | 'cores' | 'cloud' | 'server' | 'frp' | 'java' | 'settings' | 'about'

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

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" color="error" gutterBottom>
            渲染出错
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </Typography>
          <Button variant="outlined" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        </Box>
      )
    }

    return this.props.children
  }
}

export function App() {
  const [darkMode, setDarkMode] = useState(false)
  const [page, setPage] = useState<Page>('home')
  const [currentVersion, setCurrentVersion] = useState('')
  const [startupUpdateInfo, setStartupUpdateInfo] = useState<LatestReleaseInfo | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<DownloadProgress | null>(null)
  const [updateError, setUpdateError] = useState('')
  const theme = useMemo(() => (darkMode ? darkTheme : lightTheme), [darkMode])

  useEffect(() => {
    let active = true

    window.electronAPI.getAppVersion()
      .then((version) => {
        if (!active) return
        setCurrentVersion(version)
        return window.electronAPI.checkForUpdates().then((latest) => {
          if (!active) return
          if (compareVersions(version, latest.version) < 0) {
            setStartupUpdateInfo(latest)
            setUpdateDialogOpen(true)
          }
        })
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateDownloadProgress(progress)
    })

    return unsubscribe
  }, [])

  async function handleUpdateNow() {
    setUpdateDownloading(true)
    setUpdateError('')
    setUpdateDownloadProgress(null)

    try {
      await window.electronAPI.downloadAndInstallUpdate()
    } catch (err: any) {
      setUpdateError(`下载更新失败: ${err.message || 'unknown error'}`)
      setUpdateDownloading(false)
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <Layout
          page={page}
          onPageChange={setPage}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(value => !value)}
        >
          <Box sx={{ display: page === 'home' ? '' : 'none' }}>
            <HomePage onNavigate={setPage} active={page === 'home'} />
          </Box>
          <Box sx={{ display: page === 'cores' ? '' : 'none' }}>
            <CoreSelectPage />
          </Box>
          <Box sx={{ display: page === 'cloud' ? '' : 'none' }}>
            <RemoteServerPage active={page === 'cloud'} />
          </Box>
          <Box sx={{ display: page === 'server' ? '' : 'none' }}>
            <ServerPage active={page === 'server'} />
          </Box>
          <Box sx={{ display: page === 'frp' ? '' : 'none' }}>
            <FrpPage />
          </Box>
          <Box sx={{ display: page === 'java' ? '' : 'none' }}>
            <JavaManagerPage />
          </Box>
          <Box sx={{ display: page === 'settings' ? '' : 'none' }}>
            <SettingsPage />
          </Box>
          <Box sx={{ display: page === 'about' ? '' : 'none' }}>
            <AboutPage />
          </Box>
        </Layout>

        <Dialog open={updateDialogOpen} onClose={() => !updateDownloading && setUpdateDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>发现新版本</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body1">
                当前版本: {currentVersion || '...'}
              </Typography>
              <Typography variant="body1">
                最新版本: {startupUpdateInfo?.version || '...'}
              </Typography>

              {startupUpdateInfo?.notes?.length ? (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>更新内容</Typography>
                  <Stack spacing={0.75}>
                    {startupUpdateInfo.notes.map((note, index) => (
                      <Typography key={`${index}-${note}`} variant="body2">
                        {index + 1}. {note}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {updateDownloading && updateDownloadProgress && (
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    正在下载更新: {updateDownloadProgress.fileName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {updateDownloadProgress.percent}% · {formatSpeed(updateDownloadProgress.speed)}
                  </Typography>
                  <LinearProgress variant="determinate" value={updateDownloadProgress.percent} />
                </Box>
              )}

              {updateError && <Alert severity="error">{updateError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setUpdateDialogOpen(false)} disabled={updateDownloading}>
              稍后
            </Button>
            <Button variant="contained" onClick={handleUpdateNow} disabled={updateDownloading}>
              {updateDownloading ? '下载中...' : '下载并安装'}
            </Button>
          </DialogActions>
        </Dialog>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
