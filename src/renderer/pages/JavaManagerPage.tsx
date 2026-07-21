import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { Download, OpenInNew, Refresh } from '@mui/icons-material'

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

  const primaryPackage = useMemo(() => packages.find((item) => item.recommended) || null, [packages])
  const secondaryPackages = useMemo(() => packages.filter((item) => !item.recommended), [packages])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onJavaDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    void loadData()
  }, [])

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
      const latestJava = await window.electronAPI.detectJava()
      setJavaInfo(latestJava)
    } catch (downloadError: any) {
      setError(downloadError?.message || '下载 Java 失败')
    } finally {
      setDownloadingId('')
      setDownloadProgress(null)
    }
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Java 管理
      </Typography>

      <Stack spacing={3}>
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Box>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                当前 Java 环境
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {loading
                  ? '检测中...'
                  : javaInfo
                    ? `${javaInfo.version} · ${javaInfo.path}`
                    : '未检测到 Java'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<Refresh />} onClick={() => void loadData()}>
                重新检测
              </Button>
              <Button
                variant="text"
                startIcon={<OpenInNew />}
                onClick={() => void window.electronAPI.openExternal(officialPage)}
                disabled={!officialPage}
              >
                打开官方页
              </Button>
            </Box>
          </Box>

          {!loading && !javaInfo && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              当前未检测到 Java。你可以先下载并安装 Java 21，安装完成后回到这里点击“重新检测”。
            </Alert>
          )}
        </Paper>

        {error && <Alert severity="error">{error}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}

        {downloadingId && downloadProgress && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              正在下载
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {downloadProgress.fileName} · {downloadProgress.percent}% · {formatSpeed(downloadProgress.speed)}
            </Typography>
            <LinearProgress variant="determinate" value={downloadProgress.percent} />
          </Paper>
        )}

        {primaryPackage && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              推荐下载
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <Box>
                <Typography variant="h6">{primaryPackage.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {primaryPackage.description}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" color="primary" label="Java 21 LTS" />
                  <Chip size="small" label={primaryPackage.format} />
                  <Chip size="small" label={primaryPackage.architecture} />
                  <Chip size="small" color="success" variant="outlined" label="原生架构" />
                  <Chip size="small" label={primaryPackage.fileName} />
                </Box>
              </Box>
              <Button
                variant="contained"
                size="large"
                startIcon={<Download />}
                onClick={() => void handleDownload(primaryPackage.id)}
                disabled={Boolean(downloadingId)}
              >
                {downloadingId === primaryPackage.id ? '下载中...' : '下载并打开'}
              </Button>
            </Box>
          </Paper>
        )}

        {secondaryPackages.length > 0 && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              {primaryPackage ? '其他下载方式' : '兼容下载方式'}
            </Typography>
            <Stack spacing={2}>
              {secondaryPackages.map((item) => (
                <Box key={item.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>{item.title}</Typography>
                    <Typography variant="body2" color="text.secondary">{item.description}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                      <Chip size="small" label={item.format} />
                      <Chip size="small" label={item.architecture} />
                      <Chip
                        size="small"
                        color={item.native ? 'success' : 'warning'}
                        variant="outlined"
                        label={item.native ? '原生架构' : '兼容模式'}
                      />
                      <Chip size="small" label={item.fileName} />
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={() => void handleDownload(item.id)}
                    disabled={Boolean(downloadingId)}
                  >
                    {downloadingId === item.id ? '下载中...' : item.native ? '下载' : '下载兼容包'}
                  </Button>
                </Box>
              ))}
            </Stack>
          </Paper>
        )}

        {!loading && packages.length === 0 && (
          <Alert severity="warning">
            当前系统或处理器架构没有可自动匹配的 Oracle Java 21 安装包，请使用“打开官方页”查看支持情况。
          </Alert>
        )}
      </Stack>
    </Box>
  )
}
