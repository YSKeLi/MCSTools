import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { ArrowBack, CheckCircle, CloudDownload, Refresh, Search } from '@mui/icons-material'
import { SERVER_PROFILE_FILE, serializeServerProfile } from '../serverProfile'

type Step = 'category' | 'core' | 'version'
const MSL_LOGO_URL = 'https://www.mslmc.cn/logo.png'
const MSL_WEBSITE_URL = 'https://www.mslmc.cn/'

const typeColors: Record<string, string> = {
  vanilla: '#22C55E',
  bukkit: '#10B981',
  modded: '#3B82F6',
  hybrid: '#F97316',
}

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

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .join('/')
}

function shouldAutoRegisterDownloadedFile(filePath: string): boolean {
  const fileName = getBaseName(filePath).toLowerCase()
  if (!fileName.endsWith('.jar')) return false
  if (fileName.includes('installer')) return false
  return true
}

function inferArtifactHint(coreId: string, versionId: string): string {
  const lowerCoreId = coreId.toLowerCase()
  const lowerVersionId = versionId.toLowerCase()

  if (lowerCoreId.includes('bedrock')) return 'ZIP'
  if (['velocity', 'bungeecord', 'travertine', 'lightfall'].includes(lowerCoreId)) return 'JAR'
  if (lowerCoreId === 'forge' || lowerCoreId === 'neoforge') return 'Installer'
  if (lowerVersionId.includes('installer')) return 'Installer'
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
  const [pickDirOpen, setPickDirOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const versionRequestRef = useRef(0)

  useEffect(() => {
    window.electronAPI.getCores()
      .then((list) => {
        setCores(list)
      })
      .catch((err) => setError(`获取服务端列表失败: ${err.message || 'unknown error'}`))
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onDownloadProgress) return
    const unsub = window.electronAPI.onDownloadProgress((p) => {
      setProgress(p.percent)
      setSpeed(p.speed)
      setFileName(p.fileName)
    })
    return unsub
  }, [])

  const categories = useMemo(() => {
    const map = new Map<string, { key: string; name: string; description?: string; count: number }>()
    for (const core of cores) {
      const categoryKey = core.categoryKey || 'uncategorized'
      const categoryName = core.categoryName || '未分类'

      if (!map.has(categoryKey)) {
        map.set(categoryKey, {
          key: categoryKey,
          name: categoryName,
          description: core.categoryDescription,
          count: 0,
        })
      }
      map.get(categoryKey)!.count += 1
    }
    return Array.from(map.values())
  }, [cores])

  const filteredCategories = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    if (!normalized) return categories
    return categories.filter((category) =>
      category.name.toLowerCase().includes(normalized) ||
      category.key.toLowerCase().includes(normalized) ||
      (category.description || '').toLowerCase().includes(normalized),
    )
  }, [categories, keyword])

  const filteredCores = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return cores.filter((core) => {
      if ((core.categoryKey || 'uncategorized') !== selectedCategoryKey) return false
      if (!normalized) return true
      return (
        core.name.toLowerCase().includes(normalized) ||
        core.id.toLowerCase().includes(normalized) ||
        core.description.toLowerCase().includes(normalized)
      )
    })
  }, [cores, keyword, selectedCategoryKey])

  const filteredVersions = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    if (!normalized) return versions
    return versions.filter((version) => version.id.toLowerCase().includes(normalized))
  }, [versions, keyword])

  const selectedCategory = useMemo(
    () => categories.find((category) => category.key === selectedCategoryKey),
    [categories, selectedCategoryKey],
  )

  const selectedCore = useMemo(
    () => cores.find((core) => core.id === selectedCoreId),
    [cores, selectedCoreId],
  )

  const searchPlaceholder = step === 'category'
    ? '搜索服务端分类'
    : step === 'core'
      ? '搜索当前分类下的核心'
      : '搜索版本号'

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
      setVersionMessage(list.length > 0 ? '请选择版本' : '该核心当前没有可下载版本')
    } catch (err: any) {
      if (requestId !== versionRequestRef.current) return
      setVersions([])
      setVersionMessage('版本列表获取失败，请稍后重试')
      setError(`获取版本失败: ${err.message || 'unknown error'}`)
    } finally {
      if (requestId === versionRequestRef.current) {
        setLoadingVersions(false)
      }
    }
  }

  function handleBack() {
    if (step === 'version') {
      setStep('core')
      setSelectedCoreId('')
      setVersions([])
      setKeyword('')
      resetDownloadState()
      setVersionMessage('请选择版本')
      return
    }

    if (step === 'core') {
      setStep('category')
      setSelectedCategoryKey('')
      setSelectedCoreId('')
      setVersions([])
      setKeyword('')
      resetDownloadState()
      setVersionMessage('请选择版本')
    }
  }

  async function handlePickDir() {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) setDestDir(dir)
    setPickDirOpen(false)
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

    try {
      const downloadedPath = await window.electronAPI.downloadCore(selectedCoreId, chosenVersion, destDir)
      const downloadedName = getBaseName(downloadedPath)

      if (selectedCore && shouldAutoRegisterDownloadedFile(downloadedPath)) {
        await window.electronAPI.writeFile(
          joinPath(destDir, SERVER_PROFILE_FILE),
          serializeServerProfile({
            serverName: serverName.trim(),
            gameVersion: chosenVersion,
            coreType: selectedCoreId,
            coreName: selectedCore.name,
          }),
        )

        await window.electronAPI.serversAdd({
          id: `${Date.now()}`,
          name: serverName.trim(),
          path: destDir,
          coreId: selectedCoreId,
          coreName: selectedCore.name,
          version: chosenVersion,
          jarName: downloadedName,
          iconUrl: selectedCore.iconUrl,
          createdAt: new Date().toISOString(),
          maxRam: 2048,
        })

        setDoneMessage(`下载完成，已自动加入服务器列表：${serverName.trim()}`)
      } else {
        setDoneMessage(`下载完成：${downloadedName}。该文件不会自动加入服务器列表，请手动处理后再导入。`)
      }

      setDone(true)
    } catch (err: any) {
      setError(err.message || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Box sx={{ height: 'calc(100vh - 150px)', minHeight: 620, display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        服务端核心下载
      </Typography>

      <Paper
        elevation={0}
        sx={{
          mb: 2,
          px: 2.5,
          py: 2,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          background: 'linear-gradient(135deg, rgba(25,118,210,0.08), rgba(25,118,210,0.02))',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              component="img"
              src={MSL_LOGO_URL}
              alt="MSL 开服器 Logo"
              sx={{
                width: 42,
                height: 42,
                borderRadius: 1.5,
                objectFit: 'cover',
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
              }}
            />
            <Box>
              <Typography variant="body1" fontWeight={700}>
                本服务由 MSL 开服器提供
              </Typography>
              <Typography variant="body2" color="text.secondary">
                当前页面已接入其服务端镜像源，请遵循其使用规范。
              </Typography>
            </Box>
          </Stack>

          <Button variant="outlined" onClick={() => window.electronAPI.openExternal(MSL_WEBSITE_URL)}>
            打开官网
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
        <TextField
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={searchPlaceholder}
          size="small"
          sx={{ width: '100%', maxWidth: 520 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {error && step !== 'version' && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper
        elevation={0}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.08)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))',
        }}
      >
        <Box
          sx={{
            px: 2.5,
            py: 1.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              {step === 'category' && '选择服务端分类'}
              {step === 'core' && `选择服务端核心${selectedCategory ? ` · ${selectedCategory.name}` : ''}`}
              {step === 'version' && `选择版本并下载${selectedCore ? ` · ${selectedCore.name}` : ''}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {step === 'category' && '先选择分类，再逐步进入核心和版本。'}
              {step === 'core' && (selectedCategory?.description || '当前只显示所选分类下的核心。')}
              {step === 'version' && (selectedCore?.description || '选择版本后下载到本地目录。')}
            </Typography>
          </Box>

          {step !== 'category' && (
            <Button variant="text" startIcon={<ArrowBack />} onClick={handleBack}>
              返回
            </Button>
          )}
        </Box>

        {step === 'category' && (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <List disablePadding>
              {filteredCategories.map((category) => (
                <ListItemButton
                  key={category.key}
                  onClick={() => handleSelectCategory(category.key)}
                  sx={{ py: 1.75, px: 2.5, alignItems: 'flex-start' }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
                        <Typography variant="body1" fontWeight={600}>{category.name}</Typography>
                        <Chip label={`${category.count} 个核心`} size="small" variant="outlined" />
                      </Box>
                    }
                    secondary={
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {category.description || '暂无分类说明'}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
            {filteredCategories.length === 0 && (
              <Box sx={{ px: 2.5, py: 4 }}>
                <Typography variant="body2" color="text.secondary">没有匹配的分类。</Typography>
              </Box>
            )}
          </Box>
        )}

        {step === 'core' && (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <List disablePadding>
              {filteredCores.map((core) => (
                <ListItemButton
                  key={core.id}
                  onClick={() => loadVersions(core.id)}
                  sx={{ py: 1.75, px: 2.5, alignItems: 'flex-start' }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                        <Typography variant="body1" fontWeight={600}>{core.name}</Typography>
                        <Chip
                          label={typeLabels[core.type] || core.type}
                          size="small"
                          sx={{ height: 22, bgcolor: typeColors[core.type] || '#607D8B', color: '#fff' }}
                        />
                      </Box>
                    }
                    secondary={
                      <Stack spacing={0.35} sx={{ mt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">{core.description}</Typography>
                        <Typography variant="caption" color="text.secondary">核心 ID: {core.id}</Typography>
                      </Stack>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
            {filteredCores.length === 0 && (
              <Box sx={{ px: 2.5, py: 4 }}>
                <Typography variant="body2" color="text.secondary">当前分类下没有匹配的核心。</Typography>
              </Box>
            )}
          </Box>
        )}

        {step === 'version' && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                <Box>
                  <Typography variant="body1" fontWeight={600}>版本列表</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedCore ? `${selectedCore.name} · ${selectedCore.categoryName || '未分类'}` : '未选择核心'}
                  </Typography>
                </Box>
                <Button
                  variant="text"
                  size="small"
                  startIcon={<Refresh />}
                  onClick={() => selectedCoreId && loadVersions(selectedCoreId)}
                  disabled={!selectedCoreId || loadingVersions || downloading}
                >
                  刷新
                </Button>
              </Stack>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2.5, py: 2 }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                    版本
                  </Typography>
                  <Select
                    fullWidth
                    value={chosenVersion}
                    onChange={e => setChosenVersion(e.target.value)}
                    disabled={loadingVersions || downloading}
                    displayEmpty
                    renderValue={(value) => value || versionMessage}
                  >
                    {loadingVersions && <MenuItem disabled value="">正在读取版本...</MenuItem>}
                    {filteredVersions.map(version => (
                      <MenuItem key={version.id} value={version.id}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                          <span>{version.id}</span>
                          <Typography variant="caption" color="text.secondary">
                            {inferArtifactHint(selectedCoreId, version.id)}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                    {!loadingVersions && filteredVersions.length === 0 && <MenuItem disabled>{versionMessage}</MenuItem>}
                  </Select>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                      服务端名称
                    </Typography>
                    <TextField
                      fullWidth
                      placeholder="例如：我的生存服"
                      value={serverName}
                      onChange={e => setServerName(e.target.value)}
                      disabled={downloading}
                    />
                  </Box>

                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                      保存目录
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <TextField value={destDir} size="small" fullWidth InputProps={{ readOnly: true }} />
                      <Button variant="outlined" onClick={() => setPickDirOpen(true)} disabled={downloading}>
                        选择
                      </Button>
                    </Stack>
                  </Box>
                </Box>

                <Divider />

                <Stack spacing={0.75}>
                  <Typography variant="body2" fontWeight={600}>下载策略</Typography>
                  <Typography variant="body2" color="text.secondary">
                    当前选中版本预计文件类型: {chosenVersion ? inferArtifactHint(selectedCoreId, chosenVersion) : '未选择'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    可直接运行的 JAR 会自动加入服务器列表；Installer、ZIP 等文件只下载，不自动导入。
                  </Typography>
                </Stack>

                {downloading && (
                  <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">{fileName || '下载中...'}</Typography>
                      <Typography variant="body2">{progress}% | {formatSpeed(speed)}</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={progress} />
                  </Box>
                )}

                {done && <Alert severity="success">{doneMessage}</Alert>}
                {error && <Alert severity="error">{error}</Alert>}

                <Button
                  variant="contained"
                  startIcon={done ? <CheckCircle /> : <CloudDownload />}
                  onClick={handleDownload}
                  disabled={!chosenVersion || !destDir || !serverName.trim() || downloading || done}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {done ? '已完成' : downloading ? '下载中...' : '下载'}
                </Button>
              </Stack>
            </Box>
          </Box>
        )}
      </Paper>

      <Dialog open={pickDirOpen} onClose={() => setPickDirOpen(false)}>
        <DialogTitle>选择保存目录</DialogTitle>
        <DialogContent>
          <Typography>请选择一个文件夹用于保存服务端文件。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickDirOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handlePickDir}>选择文件夹</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
