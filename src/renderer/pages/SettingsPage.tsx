import React, { useEffect, useRef, useState } from 'react'
import {
  AppWindow,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Languages,
  Minimize2,
  Palette,
  Power,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { AlertBanner, Badge, Button, ProgressBar, Toggle } from '../components/ui'
import { getActiveLanguage } from '../localization'

type SettingsSectionId = 'appearance' | 'general' | 'updates'

interface SettingsPageProps {
  settings: AppSettingsView
  onSettingsChange: (
    patch: Partial<Omit<AppSettingsView, 'hasBackgroundImage' | 'backgroundImageUrl'>>,
  ) => Promise<AppSettingsView>
  onSettingsResolved: (settings: AppSettingsView) => void
}

const settingsSections: Array<{
  id: SettingsSectionId
  label: string
  icon: React.ReactNode
}> = [
  { id: 'appearance', label: '外观', icon: <Palette /> },
  { id: 'general', label: '通用', icon: <Settings2 /> },
  { id: 'updates', label: '更新', icon: <Download /> },
]

const accentColors = [
  { value: '#267654', label: '森林绿' },
  { value: '#2563a7', label: '湖蓝' },
  { value: '#8a5a13', label: '琥珀' },
  { value: '#a33f5d', label: '莓红' },
  { value: '#6d4ca5', label: '藤紫' },
  { value: '#3d6f75', label: '青灰' },
]

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

export function SettingsPage({ settings, onSettingsChange, onSettingsResolved }: SettingsPageProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<SettingsSectionId, HTMLElement | null>>({
    appearance: null,
    general: null,
    updates: null,
  })
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance')
  const [savingSetting, setSavingSetting] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [backgroundTransparency, setBackgroundTransparency] = useState(settings.backgroundTransparency)
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestInfo, setLatestInfo] = useState<LatestReleaseInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)

  useEffect(() => {
    setBackgroundTransparency(settings.backgroundTransparency)
  }, [settings.backgroundTransparency])

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setCurrentVersion).catch(() => setCurrentVersion('unknown'))
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return undefined

    let animationFrame = 0
    const updateActiveSection = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect()
        const triggerLine = containerRect.top + Math.min(120, container.clientHeight * 0.22)
        let nextSection: SettingsSectionId = 'appearance'

        for (const section of settingsSections) {
          const element = sectionRefs.current[section.id]
          if (element && element.getBoundingClientRect().top <= triggerLine) nextSection = section.id
        }

        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) nextSection = 'updates'
        setActiveSection(current => current === nextSection ? current : nextSection)
      })
    }

    container.addEventListener('scroll', updateActiveSection, { passive: true })
    updateActiveSection()
    return () => {
      container.removeEventListener('scroll', updateActiveSection)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  const hasUpdate = !!(latestInfo && currentVersion && compareVersions(currentVersion, latestInfo.version) < 0)

  function scrollToSection(sectionId: SettingsSectionId) {
    const container = scrollContainerRef.current
    const section = sectionRefs.current[sectionId]
    if (!container || !section) return
    const top = section.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    setActiveSection(sectionId)
    container.scrollTo({ top: Math.max(0, top - 28), behavior: 'smooth' })
  }

  async function persistSetting(
    key: string,
    patch: Partial<Omit<AppSettingsView, 'hasBackgroundImage' | 'backgroundImageUrl'>>,
  ) {
    setSavingSetting(key)
    setSettingsError('')
    try {
      await onSettingsChange(patch)
    } catch (saveError: any) {
      setSettingsError(saveError?.message || '保存设置失败')
    } finally {
      setSavingSetting('')
    }
  }

  async function handleSelectBackground() {
    setSavingSetting('background')
    setSettingsError('')
    try {
      const next = await window.electronAPI.selectBackgroundImage()
      if (next) onSettingsResolved(next)
    } catch (selectError: any) {
      setSettingsError(selectError?.message || '选择背景图片失败')
    } finally {
      setSavingSetting('')
    }
  }

  async function handleClearBackground() {
    setSavingSetting('background')
    setSettingsError('')
    try {
      onSettingsResolved(await window.electronAPI.clearBackgroundImage())
    } catch (clearError: any) {
      setSettingsError(clearError?.message || '清除背景图片失败')
    } finally {
      setSavingSetting('')
    }
  }

  async function handleCheckUpdate() {
    setLoading(true)
    setError('')
    try {
      const data = await window.electronAPI.checkForUpdates()
      setLatestInfo(data)
      setCheckedAt(new Date().toLocaleString(getActiveLanguage()))
    } catch (checkError: any) {
      setError(`检查更新失败: ${checkError.message || 'unknown error'}`)
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
    } catch (downloadError: any) {
      setError(`下载更新失败: ${downloadError.message || 'unknown error'}`)
    } finally {
      setDownloading(false)
    }
  }

  async function handleOpenReleasePage() {
    if (latestInfo?.url) await window.electronAPI.openExternal(latestInfo.url)
  }

  return (
    <div className="settings-page">
      <aside className="settings-page__sidebar">
        <nav className="settings-section-nav" aria-label="设置分类">
          {settingsSections.map(section => (
            <button
              key={section.id}
              type="button"
              className={`settings-section-nav__item${activeSection === section.id ? ' settings-section-nav__item--active' : ''}`}
              onClick={() => scrollToSection(section.id)}
              aria-current={activeSection === section.id ? 'location' : undefined}
            >
              <span className="settings-section-nav__icon" aria-hidden="true">{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-page__scroll" ref={scrollContainerRef}>
        <div className="settings-page__content">
          {settingsError ? <AlertBanner tone="danger">{settingsError}</AlertBanner> : null}

          <section
            id="settings-appearance"
            className="settings-section"
            ref={element => { sectionRefs.current.appearance = element }}
            aria-labelledby="settings-appearance-title"
          >
            <div className="settings-section__heading">
              <span className="settings-section__heading-icon" aria-hidden="true"><Palette /></span>
              <div>
                <h2 id="settings-appearance-title">外观</h2>
                <p>管理应用语言、主题色和背景图片。</p>
              </div>
            </div>

            <div className="settings-control-list">
              <div className="settings-control-row">
                <span className="settings-control-row__icon" aria-hidden="true"><Languages /></span>
                <div className="settings-control-row__copy">
                  <strong>语言</strong>
                  <span>切换后会立即应用到整个应用。</span>
                </div>
                <select
                  className="ui-select settings-language-select"
                  value={settings.language}
                  disabled={savingSetting === 'language'}
                  onChange={event => void persistSetting('language', { language: event.target.value as LanguagePreference })}
                  aria-label="语言"
                >
                  <option value="system">跟随系统</option>
                  <option value="zh-CN">简体中文</option>
                  <option value="zh-TW">繁体中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                </select>
              </div>

              <div className="settings-control-row settings-control-row--swatches">
                <span className="settings-control-row__icon" aria-hidden="true"><Palette /></span>
                <div className="settings-control-row__copy">
                  <strong>主题色</strong>
                  <span>用于导航、按钮和状态高亮。</span>
                </div>
                <div className="settings-color-swatches" role="group" aria-label="主题色">
                  {accentColors.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      className={`settings-color-swatch${settings.accentColor === color.value ? ' settings-color-swatch--active' : ''}`}
                      style={{ '--swatch-color': color.value } as React.CSSProperties}
                      onClick={() => void persistSetting('accentColor', { accentColor: color.value })}
                      disabled={savingSetting === 'accentColor'}
                      aria-label={color.label}
                      title={color.label}
                      aria-pressed={settings.accentColor === color.value}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-control-row settings-control-row--background">
                <span className="settings-control-row__icon" aria-hidden="true"><ImageIcon /></span>
                <div className="settings-control-row__copy">
                  <strong>自定义背景图</strong>
                  <span>支持 PNG、JPG、WEBP、GIF 和 BMP，最大 20 MB。</span>
                </div>
                <div className="settings-background-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    startIcon={<Upload />}
                    onClick={() => void handleSelectBackground()}
                    loading={savingSetting === 'background'}
                  >
                    {settings.hasBackgroundImage ? '更换图片' : '选择图片'}
                  </Button>
                  {settings.hasBackgroundImage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      startIcon={<Trash2 />}
                      onClick={() => void handleClearBackground()}
                      disabled={savingSetting === 'background'}
                    >
                      清除
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="settings-control-row settings-control-row--range">
                <span className="settings-control-row__icon" aria-hidden="true"><ImageIcon /></span>
                <div className="settings-control-row__copy">
                  <strong>背景透明度</strong>
                  <span>数值越高，背景图片越透明。</span>
                </div>
                <div className="settings-range-control">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={backgroundTransparency}
                    disabled={!settings.hasBackgroundImage || savingSetting === 'backgroundTransparency'}
                    onChange={event => setBackgroundTransparency(Number(event.target.value))}
                    onPointerUp={() => void persistSetting('backgroundTransparency', { backgroundTransparency })}
                    onKeyUp={() => void persistSetting('backgroundTransparency', { backgroundTransparency })}
                    onBlur={() => {
                      if (backgroundTransparency !== settings.backgroundTransparency) {
                        void persistSetting('backgroundTransparency', { backgroundTransparency })
                      }
                    }}
                    aria-label="背景透明度"
                  />
                  <output>{backgroundTransparency}%</output>
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-general"
            className="settings-section"
            ref={element => { sectionRefs.current.general = element }}
            aria-labelledby="settings-general-title"
          >
            <div className="settings-section__heading">
              <span className="settings-section__heading-icon" aria-hidden="true"><Settings2 /></span>
              <div>
                <h2 id="settings-general-title">通用</h2>
                <p>管理应用启动和窗口关闭行为。</p>
              </div>
            </div>

            <div className="settings-control-list">
              <div className="settings-control-row">
                <span className="settings-control-row__icon" aria-hidden="true"><Power /></span>
                <div className="settings-control-row__copy">
                  <strong>开机自启动</strong>
                  <span>登录系统后自动启动 MC Server Tools。</span>
                </div>
                <div className="settings-control-row__action">
                  <Toggle
                    checked={settings.autoLaunch}
                    onChange={enabled => void persistSetting('autoLaunch', { autoLaunch: enabled })}
                    label="开机自启动"
                    disabled={savingSetting === 'autoLaunch'}
                  />
                </div>
              </div>

              <div className="settings-control-row settings-control-row--close-behavior">
                <span className="settings-control-row__icon" aria-hidden="true"><AppWindow /></span>
                <div className="settings-control-row__copy">
                  <strong>关闭窗口行为</strong>
                  <span>决定点击窗口关闭按钮时应用如何处理。</span>
                </div>
                <div className="settings-close-control" role="group" aria-label="关闭窗口行为">
                  <button
                    type="button"
                    className={`settings-close-control__option${settings.closeBehavior === 'quit' ? ' settings-close-control__option--active' : ''}`}
                    onClick={() => void persistSetting('closeBehavior', { closeBehavior: 'quit' })}
                    disabled={savingSetting === 'closeBehavior'}
                    aria-pressed={settings.closeBehavior === 'quit'}
                  >
                    <AppWindow aria-hidden="true" />
                    <span>关闭应用</span>
                  </button>
                  <button
                    type="button"
                    className={`settings-close-control__option${settings.closeBehavior === 'tray' ? ' settings-close-control__option--active' : ''}`}
                    onClick={() => void persistSetting('closeBehavior', { closeBehavior: 'tray' })}
                    disabled={savingSetting === 'closeBehavior'}
                    aria-pressed={settings.closeBehavior === 'tray'}
                  >
                    <Minimize2 aria-hidden="true" />
                    <span>最小化到托盘</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-updates"
            className="settings-section"
            ref={element => { sectionRefs.current.updates = element }}
            aria-labelledby="settings-updates-title"
          >
            <div className="settings-section__heading settings-section__heading--with-badge">
              <span className="settings-section__heading-icon" aria-hidden="true"><Download /></span>
              <div>
                <h2 id="settings-updates-title">更新</h2>
                <p>检查新版本并管理启动时的更新提醒。</p>
              </div>
              <Badge tone={hasUpdate ? 'warning' : 'neutral'}>当前版本 {currentVersion || '...'}</Badge>
            </div>

            <div className="settings-control-list">
              <div className="settings-control-row">
                <span className="settings-control-row__icon" aria-hidden="true"><RefreshCw /></span>
                <div className="settings-control-row__copy">
                  <strong>启动时检查更新</strong>
                  <span>应用启动后自动检查新版本，并在有更新时提醒。</span>
                </div>
                <div className="settings-control-row__action">
                  <Toggle
                    checked={settings.checkUpdatesOnStartup}
                    onChange={enabled => void persistSetting('checkUpdatesOnStartup', { checkUpdatesOnStartup: enabled })}
                    label="启动时检查更新"
                    disabled={savingSetting === 'checkUpdatesOnStartup'}
                  />
                </div>
              </div>
            </div>

            <div className="settings-update-panel">
              <div className="toolbar">
                <div className="toolbar__group">
                  <Button startIcon={<RefreshCw />} onClick={handleCheckUpdate} loading={loading} disabled={downloading}>
                    {loading ? '检查中...' : '检查更新'}
                  </Button>
                  {latestInfo?.url ? (
                    <Button variant="secondary" startIcon={<ExternalLink />} onClick={handleOpenReleasePage} disabled={downloading}>
                      打开发布页
                    </Button>
                  ) : null}
                  {hasUpdate ? (
                    <Button startIcon={<Download />} onClick={handleDownloadAndInstall} loading={downloading} disabled={loading}>
                      {downloading ? '下载中...' : '下载并安装'}
                    </Button>
                  ) : null}
                </div>
                {checkedAt ? <span className="inline-meta">上次检查：{checkedAt}</span> : null}
              </div>

              {downloading ? (
                <div className="stack stack--compact">
                  <div className="summary-line">
                    <strong>{downloadProgress ? downloadProgress.fileName : '正在准备更新下载...'}</strong>
                    {downloadProgress ? <span>{downloadProgress.percent}% · {formatSpeed(downloadProgress.speed)}</span> : null}
                  </div>
                  <ProgressBar indeterminate={!downloadProgress?.total} value={downloadProgress?.percent} />
                </div>
              ) : null}

              {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

              {latestInfo && !error ? (
                <>
                  <AlertBanner tone={hasUpdate ? 'success' : 'info'}>
                    {hasUpdate ? `发现新版本 ${latestInfo.version}` : `当前已是最新版本 ${currentVersion}`}
                  </AlertBanner>
                  <div className="info-grid">
                    <div className="info-item"><span className="info-item__label">版本名称</span><span className="info-item__value">{latestInfo.title}</span></div>
                    <div className="info-item"><span className="info-item__label">最新版本</span><span className="info-item__value">{latestInfo.version}</span></div>
                    <div className="info-item"><span className="info-item__label">发布时间</span><span className="info-item__value">{latestInfo.publishedAt ? new Date(latestInfo.publishedAt).toLocaleString(getActiveLanguage()) : '-'}</span></div>
                    <div className="info-item"><span className="info-item__label">来源仓库</span><span className="info-item__value">{latestInfo.repo}</span></div>
                  </div>
                  {latestInfo.notes.length ? (
                    <div className="stack stack--compact">
                      <strong>更新内容</strong>
                      <ol className="ui-note-list">
                        {latestInfo.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
                      </ol>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
