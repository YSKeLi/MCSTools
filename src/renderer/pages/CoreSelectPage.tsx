import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleCheck, Download, RefreshCw, Search } from 'lucide-react'
import { AlertBanner, Badge, Button, Field, ProgressBar, Surface } from '../components/ui'
import { serializeServerProfile } from '../serverProfile'

type Step = 'category' | 'core' | 'version'
const MSL_LOGO_URL = 'https://www.mslmc.cn/logo.png'
const MSL_WEBSITE_URL = 'https://www.mslmc.cn/'

const typeLabels: Record<string, string> = {
  vanilla: '原版',
  bukkit: '插件',
  modded: '模组',
  hybrid: '混合',
}

function formatSpeed(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / 1048576).toFixed(1)} MB/s`
}

function getBaseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || 'server.jar'
}

function shouldAutoRegisterDownloadedFile(filePath: string): boolean {
  const fileName = getBaseName(filePath).toLowerCase()
  return fileName.endsWith('.jar') && !fileName.includes('installer')
}

function inferArtifactHint(coreId: string, versionId: string): string {
  const lowerCoreId = coreId.toLowerCase()
  const lowerVersionId = versionId.toLowerCase()
  if (lowerCoreId.includes('bedrock')) return 'ZIP'
  if (['velocity', 'bungeecord', 'travertine', 'lightfall'].includes(lowerCoreId)) return 'JAR'
  if (lowerCoreId === 'forge' || lowerCoreId === 'neoforge' || lowerVersionId.includes('installer')) return 'Installer'
  return 'JAR'
}

export function CoreSelectPage() {
  const [step, setStep] = useState<Step>('category')
  const [cores, setCores] = useState<CoreInfo[]>([])
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('')
  const [selectedCoreId, setSelectedCoreId] = useState('')
  const [versions, setVersions] = useState<CoreVersion[]>([])
  const [chosenVersion, setChosenVersion] = useState('')
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionMessage, setVersionMessage] = useState('请选择版本')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [fileName, setFileName] = useState('')
  const [destDir, setDestDir] = useState('')
  const [serverName, setServerName] = useState('')
  const [done, setDone] = useState(false)
  const [doneMessage, setDoneMessage] = useState('')
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const versionRequestRef = useRef(0)

  useEffect(() => {
    window.electronAPI.getCores().then(setCores).catch(err => setError(`获取服务端列表失败: ${err.message || 'unknown error'}`))
  }, [])

  useEffect(() => window.electronAPI.onDownloadProgress(item => {
    setProgress(item.percent)
    setSpeed(item.speed)
    setFileName(item.fileName)
  }), [])

  const categories = useMemo(() => {
    const map = new Map<string, { key: string; name: string; description?: string; count: number }>()
    for (const core of cores) {
      const key = core.categoryKey || 'uncategorized'
      if (!map.has(key)) map.set(key, { key, name: core.categoryName || '未分类', description: core.categoryDescription, count: 0 })
      map.get(key)!.count += 1
    }
    return Array.from(map.values())
  }, [cores])

  const filteredCategories = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return categories.filter(category => !normalized || category.name.toLowerCase().includes(normalized) || category.key.toLowerCase().includes(normalized) || (category.description || '').toLowerCase().includes(normalized))
  }, [categories, keyword])

  const filteredCores = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return cores.filter(core => (core.categoryKey || 'uncategorized') === selectedCategoryKey && (!normalized || core.name.toLowerCase().includes(normalized) || core.id.toLowerCase().includes(normalized) || core.description.toLowerCase().includes(normalized)))
  }, [cores, keyword, selectedCategoryKey])

  const filteredVersions = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return versions.filter(version => !normalized || version.id.toLowerCase().includes(normalized))
  }, [versions, keyword])

  const selectedCategory = useMemo(() => categories.find(category => category.key === selectedCategoryKey), [categories, selectedCategoryKey])
  const selectedCore = useMemo(() => cores.find(core => core.id === selectedCoreId), [cores, selectedCoreId])
  const searchPlaceholder = step === 'category' ? '搜索服务端分类' : step === 'core' ? '搜索当前分类下的核心' : '搜索版本号'

  function resetDownloadState() {
    setDone(false)
    setDoneMessage('')
    setError('')
    setChosenVersion('')
    setProgress(0)
    setSpeed(0)
    setFileName('')
  }

  function handleSelectCategory(categoryKey: string) {
    setSelectedCategoryKey(categoryKey)
    setSelectedCoreId('')
    setVersions([])
    setKeyword('')
    resetDownloadState()
    setVersionMessage('请选择版本')
    setStep('core')
  }

  async function loadVersions(coreId: string) {
    const requestId = ++versionRequestRef.current
    setSelectedCoreId(coreId)
    setVersions([])
    setKeyword('')
    resetDownloadState()
    setVersionMessage('正在读取版本...')
    setLoadingVersions(true)
    setStep('version')
    try {
      const list = await window.electronAPI.getVersions(coreId)
      if (requestId !== versionRequestRef.current) return
      setVersions(list)
      setVersionMessage(list.length ? '请选择版本' : '该核心当前没有可下载版本')
    } catch (err: any) {
      if (requestId !== versionRequestRef.current) return
      setVersions([])
      setVersionMessage('版本列表获取失败')
      setError(`获取版本失败: ${err.message || 'unknown error'}`)
    } finally {
      if (requestId === versionRequestRef.current) setLoadingVersions(false)
    }
  }

  function handleBack() {
    resetDownloadState()
    setKeyword('')
    setVersionMessage('请选择版本')
    if (step === 'version') {
      setStep('core')
      setSelectedCoreId('')
      setVersions([])
    } else if (step === 'core') {
      setStep('category')
      setSelectedCategoryKey('')
      setSelectedCoreId('')
      setVersions([])
    }
  }

  async function handlePickDir() {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setDestDir(dir)
  }

  async function handleDownload() {
    if (!selectedCoreId || !chosenVersion || !destDir) return
    if (!serverName.trim()) {
      setError('请输入服务端名称')
      return
    }
    setDownloading(true)
    setError('')
    setDone(false)
    setDoneMessage('')
    setProgress(0)
    setSpeed(0)
    let serverDirectory = ''
    try {
      serverDirectory = await window.electronAPI.createManagedServerDirectory(destDir, serverName.trim())
      const downloadedPath = await window.electronAPI.downloadCore(selectedCoreId, chosenVersion, serverDirectory)
      const downloadedName = getBaseName(downloadedPath)
      if (selectedCore && shouldAutoRegisterDownloadedFile(downloadedPath)) {
        await window.electronAPI.writeServerProfile(serverDirectory, serializeServerProfile({ serverName: serverName.trim(), gameVersion: chosenVersion, coreType: selectedCoreId, coreName: selectedCore.name }))
        await window.electronAPI.serversAdd({ name: serverName.trim(), path: serverDirectory, coreId: selectedCoreId, coreName: selectedCore.name, version: chosenVersion, jarName: downloadedName, iconUrl: selectedCore.iconUrl, maxRam: 2048, managedPath: true })
        setDoneMessage(`下载完成，已加入服务器列表：${serverName.trim()}`)
      } else {
        setDoneMessage(`下载完成：${downloadedName}。该文件需要手动处理后再导入。`)
      }
      setDone(true)
    } catch (err: any) {
      if (serverDirectory) await window.electronAPI.discardManagedServerDirectory(serverDirectory).catch(() => undefined)
      setError(err.message || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  const catalogTitle = step === 'category' ? '选择服务端分类' : step === 'core' ? `选择服务端核心${selectedCategory ? ` · ${selectedCategory.name}` : ''}` : `选择版本并下载${selectedCore ? ` · ${selectedCore.name}` : ''}`

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy"><h1 className="page-heading__title">服务端核心下载</h1></div>
      </section>

      <div className="provider-strip">
        <div className="provider-strip__identity">
          <img className="provider-strip__logo" src={MSL_LOGO_URL} alt="MSL 开服器" />
          <div><p className="provider-strip__title">MSL 开服器</p></div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.electronAPI.openExternal(MSL_WEBSITE_URL)}>打开官网</Button>
      </div>

      {error && step !== 'version' ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      <Surface className="catalog">
        <div className="catalog__toolbar">
          <div className="input-with-icon catalog__search">
            <Search />
            <input className="ui-input" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={searchPlaceholder} />
          </div>
        </div>
        <div className="catalog__header">
          <div><p className="catalog__title">{catalogTitle}</p></div>
          {step !== 'category' ? <Button variant="ghost" size="sm" startIcon={<ArrowLeft />} onClick={handleBack}>返回</Button> : null}
        </div>

        {step === 'category' ? (
          <div className="catalog__body">
            {filteredCategories.map(category => (
              <button className="catalog-row" key={category.key} onClick={() => handleSelectCategory(category.key)}>
                <div className="catalog-row__main"><p className="catalog-row__title">{category.name}</p></div>
                <Badge>{category.count} 个核心</Badge>
              </button>
            ))}
            {!filteredCategories.length ? <div className="empty-state"><div className="empty-state__content"><p className="empty-state__message">没有匹配的分类。</p></div></div> : null}
          </div>
        ) : null}

        {step === 'core' ? (
          <div className="catalog__body">
            {filteredCores.map(core => (
              <button className="catalog-row" key={core.id} onClick={() => void loadVersions(core.id)}>
                <div className="catalog-row__main"><div className="toolbar__group"><p className="catalog-row__title">{core.name}</p><Badge tone="accent">{typeLabels[core.type] || core.type}</Badge></div><p className="catalog-row__meta">{core.id}</p></div>
              </button>
            ))}
            {!filteredCores.length ? <div className="empty-state"><div className="empty-state__content"><p className="empty-state__message">当前分类下没有匹配的核心。</p></div></div> : null}
          </div>
        ) : null}

        {step === 'version' ? (
          <div className="catalog__body catalog-form">
            <div className="toolbar">
              <div className="summary-line"><strong>版本与保存位置</strong><span>{selectedCore?.categoryName || '未分类'}</span></div>
              <Button variant="ghost" size="sm" startIcon={<RefreshCw />} onClick={() => selectedCoreId && loadVersions(selectedCoreId)} disabled={!selectedCoreId || loadingVersions || downloading}>刷新版本</Button>
            </div>
            <div className="form-grid">
              <Field label="版本">
                <select className="ui-select" value={chosenVersion} onChange={event => setChosenVersion(event.target.value)} disabled={loadingVersions || downloading}>
                  <option value="">{versionMessage}</option>
                  {filteredVersions.map(version => <option key={version.id} value={version.id}>{version.id} · {inferArtifactHint(selectedCoreId, version.id)}</option>)}
                </select>
              </Field>
              <Field label="服务器名称"><input className="ui-input" value={serverName} onChange={event => setServerName(event.target.value)} disabled={downloading} /></Field>
              <Field label="保存目录" className="form-span-full">
                <div className="input-group"><input className="ui-input" value={destDir} readOnly /><Button variant="secondary" onClick={() => void handlePickDir()} disabled={downloading}>选择目录</Button></div>
              </Field>
            </div>
            {downloading ? <div className="stack stack--compact"><div className="summary-line"><strong>{fileName || '下载中...'}</strong><span>{progress}% · {formatSpeed(speed)}</span></div><ProgressBar value={progress} /></div> : null}
            {done ? <AlertBanner tone="success">{doneMessage}</AlertBanner> : null}
            {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
            <div className="toolbar__group"><Button startIcon={done ? <CircleCheck /> : <Download />} onClick={handleDownload} loading={downloading} disabled={!chosenVersion || !destDir || !serverName.trim() || done}>{done ? '已完成' : downloading ? '下载中...' : '下载'}</Button></div>
          </div>
        ) : null}
      </Surface>

    </div>
  )
}
