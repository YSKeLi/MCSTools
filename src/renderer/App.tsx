import React, { Component, useEffect, useRef, useState } from 'react'
import { Layout } from './components/Layout'
import { AlertBanner, Button, Dialog, ProgressBar } from './components/ui'
import { AboutPage } from './pages/AboutPage'
import { RemoteServerPage } from './pages/RemoteServerPage'
import { RemoteServerDetailPage } from './pages/RemoteServerDetailPage'
import { CoreSelectPage } from './pages/CoreSelectPage'
import { FrpPage } from './pages/FrpPage'
import { HomePage } from './pages/HomePage'
import { JavaManagerPage } from './pages/JavaManagerPage'
import { ServerPage } from './pages/ServerPage'
import { SettingsPage } from './pages/SettingsPage'
import { LocalizedDocument } from './localization'

export type Page = 'home' | 'cores' | 'cloud' | 'cloud-detail' | 'server' | 'frp' | 'java' | 'settings' | 'about'

const THEME_STORAGE_KEY = 'mcst-theme'
const DEFAULT_APP_SETTINGS: AppSettingsView = {
  language: 'system',
  accentColor: '#267654',
  backgroundTransparency: 35,
  autoLaunch: false,
  closeBehavior: 'tray',
  checkUpdatesOnStartup: true,
  hasBackgroundImage: false,
  backgroundImageUrl: null,
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key)
    return stored === null ? fallback : stored === 'true'
  } catch {
    return fallback
  }
}

function storeBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Preferences remain active for the current session when storage is unavailable.
  }
}

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
        <div className="empty-state">
          <div className="empty-state__content">
            <h2 className="empty-state__title">{'\u6E32\u67D3\u51FA\u9519'}</h2>
            <p className="empty-state__message">{this.state.error.message}</p>
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              {'\u91CD\u8BD5'}
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    return readStoredBoolean(THEME_STORAGE_KEY, systemPrefersDark)
  })
  const [appSettings, setAppSettings] = useState<AppSettingsView>(DEFAULT_APP_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const startupUpdateCheckAttempted = useRef(false)
  const [page, setPage] = useState<Page>('home')
  const [pageBeforeSettings, setPageBeforeSettings] = useState<Page>('home')
  const [remoteServerId, setRemoteServerId] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const [startupUpdateInfo, setStartupUpdateInfo] = useState<LatestReleaseInfo | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<DownloadProgress | null>(null)
  const [updateError, setUpdateError] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  useEffect(() => {
    let active = true
    Promise.allSettled([
      window.electronAPI.getAppVersion(),
      window.electronAPI.getAppSettings(),
    ]).then(([versionResult, settingsResult]) => {
      if (!active) return
      if (versionResult.status === 'fulfilled') setCurrentVersion(versionResult.value)
      if (settingsResult.status === 'fulfilled') setAppSettings(settingsResult.value)
      setSettingsLoaded(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', appSettings.accentColor)
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${appSettings.accentColor} 82%, black)`)
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${appSettings.accentColor} 18%, transparent)`)
    root.dataset.customBackground = appSettings.backgroundImageUrl ? 'true' : 'false'
    root.style.setProperty('--app-background-opacity', String((100 - appSettings.backgroundTransparency) / 100))
    if (appSettings.backgroundImageUrl) {
      root.style.setProperty('--app-background-image', `url(${JSON.stringify(appSettings.backgroundImageUrl)})`)
    } else {
      root.style.removeProperty('--app-background-image')
    }
  }, [appSettings.accentColor, appSettings.backgroundImageUrl, appSettings.backgroundTransparency])

  useEffect(() => {
    if (!settingsLoaded || !currentVersion || startupUpdateCheckAttempted.current) return undefined
    startupUpdateCheckAttempted.current = true
    if (!appSettings.checkUpdatesOnStartup) return undefined

    let active = true
    window.electronAPI.checkForUpdates()
      .then((latest) => {
        if (active && compareVersions(currentVersion, latest.version) < 0) {
          setStartupUpdateInfo(latest)
          setUpdateDialogOpen(true)
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [appSettings.checkUpdatesOnStartup, currentVersion, settingsLoaded])

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

  function handlePageChange(nextPage: Page) {
    if (nextPage === 'settings' && page !== 'settings') {
      setPageBeforeSettings(page)
    }
    setPage(nextPage)
  }

  function handleDarkModeChange(nextDarkMode: boolean) {
    setDarkMode(nextDarkMode)
    storeBoolean(THEME_STORAGE_KEY, nextDarkMode)
  }

  async function handleAppSettingsChange(
    patch: Partial<Omit<AppSettingsView, 'hasBackgroundImage' | 'backgroundImageUrl'>>,
  ) {
    const next = await window.electronAPI.updateAppSettings(patch)
    setAppSettings(next)
    return next
  }

  return (
    <>
      <LocalizedDocument preference={appSettings.language} />
      <ErrorBoundary>
        <Layout
          page={page}
          onPageChange={handlePageChange}
          onExitSettings={() => setPage(pageBeforeSettings)}
          onExitCloudServer={() => setPage('cloud')}
          darkMode={darkMode}
          onToggleDark={() => handleDarkModeChange(!darkMode)}
        >
          <section className="page-panel" hidden={page !== 'home'}>
            <HomePage onNavigate={setPage} active={page === 'home'} />
          </section>
          <section className="page-panel" hidden={page !== 'cores'}>
            <CoreSelectPage />
          </section>
          <section className="page-panel" hidden={page !== 'cloud'}>
            <RemoteServerPage active={page === 'cloud'} onOpenServer={(serverId) => { setRemoteServerId(serverId); setPage('cloud-detail') }} />
          </section>
          <section className="page-panel remote-detail-panel" hidden={page !== 'cloud-detail'}>
            <RemoteServerDetailPage active={page === 'cloud-detail'} remoteServerId={remoteServerId} />
          </section>
          <section className="page-panel" hidden={page !== 'server'}>
            <ServerPage active={page === 'server'} />
          </section>
          <section className="page-panel" hidden={page !== 'frp'}>
            <FrpPage />
          </section>
          <section className="page-panel" hidden={page !== 'java'}>
            <JavaManagerPage />
          </section>
          <section className="page-panel" hidden={page !== 'settings'}>
            <SettingsPage
              settings={appSettings}
              onSettingsChange={handleAppSettingsChange}
              onSettingsResolved={setAppSettings}
            />
          </section>
          <section className="page-panel" hidden={page !== 'about'}>
            <AboutPage />
          </section>
        </Layout>

        <Dialog
          open={updateDialogOpen}
          onClose={() => !updateDownloading && setUpdateDialogOpen(false)}
          dismissible={!updateDownloading}
          width="sm"
          title={'\u53D1\u73B0\u65B0\u7248\u672C'}
          footer={(
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setUpdateDialogOpen(false)} disabled={updateDownloading}>
                {'\u7A0D\u540E'}
              </Button>
              <Button variant="primary" onClick={handleUpdateNow} loading={updateDownloading}>
                {updateDownloading ? '\u4E0B\u8F7D\u4E2D...' : '\u4E0B\u8F7D\u5E76\u5B89\u88C5'}
              </Button>
            </div>
          )}
        >
          <div className="stack">
            <div className="summary-line">
              <span className="inline-meta">{`\u5F53\u524D\u7248\u672C: ${currentVersion || '...'}`}</span>
              <strong>{`\u6700\u65B0\u7248\u672C: ${startupUpdateInfo?.version || '...'}`}</strong>
            </div>

            {startupUpdateInfo?.notes?.length ? (
              <div className="stack stack--compact">
                <strong>{'\u66F4\u65B0\u5185\u5BB9'}</strong>
                <ol className="ui-note-list">
                  {startupUpdateInfo.notes.map((note, index) => (
                    <li key={`${index}-${note}`}>{note}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {updateDownloading ? (
              <div className="stack stack--compact">
                  <strong>
                    {updateDownloadProgress
                      ? `\u6B63\u5728\u4E0B\u8F7D\u66F4\u65B0: ${updateDownloadProgress.fileName}`
                      : '\u6B63\u5728\u51C6\u5907\u66F4\u65B0\u4E0B\u8F7D...'}
                  </strong>
                  {updateDownloadProgress ? (
                    <span className="inline-meta">
                      {`${updateDownloadProgress.percent}% \u00B7 ${formatSpeed(updateDownloadProgress.speed)}`}
                    </span>
                  ) : null}
                  <ProgressBar
                    indeterminate={!updateDownloadProgress?.total}
                    value={updateDownloadProgress?.percent}
                  />
              </div>
            ) : null}

            {updateError ? <AlertBanner tone="danger">{updateError}</AlertBanner> : null}
          </div>
        </Dialog>
      </ErrorBoundary>
    </>
  )
}
