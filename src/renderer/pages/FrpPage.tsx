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
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { DeleteOutline, FileOpen, PlayArrow, Stop } from '@mui/icons-material'

function formatDateTime(value?: string) {
  if (!value) return '未使用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function FrpPage() {
  const [status, setStatus] = useState('stopped')
  const [logs, setLogs] = useState<string[]>([])
  const [configs, setConfigs] = useState<FrpSavedConfig[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportedFrpConfig | null>(null)
  const [configName, setConfigName] = useState('')
  const [actionError, setActionError] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)

  const selectedConfig = useMemo(
    () => configs.find((item) => item.id === selectedId) || null,
    [configs, selectedId],
  )

  useEffect(() => {
    if (!window.electronAPI?.onFrpLog) return
    const unsubLog = window.electronAPI.onFrpLog((line) => setLogs((prev) => [...prev.slice(-200), line]))
    const unsubStatus = window.electronAPI.onFrpStatus((value) => setStatus(value))
    const unsubConfigs = window.electronAPI.onFrpConfigsChanged(() => { void loadConfigs() })
    void window.electronAPI.frpStatus().then(setStatus).catch(() => undefined)
    void loadConfigs()
    return () => { unsubLog(); unsubStatus(); unsubConfigs() }
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  async function loadConfigs() {
    const list = await window.electronAPI.frpConfigsList()
    setConfigs(list)
    setSelectedId((current) => {
      if (current && list.some((item) => item.id === current)) return current
      return list[0]?.id || ''
    })
  }

  async function handlePickConfig() {
    setActionError('')
    const preview = await window.electronAPI.frpConfigsPickFile()
    if (!preview) return
    setImportPreview(preview)
    setConfigName(preview.suggestedName)
    setImportDialogOpen(true)
  }

  async function handleSaveImportedConfig() {
    if (!importPreview) return
    try {
      const saved = await window.electronAPI.frpConfigsAdd(configName, importPreview.filePath)
      setImportDialogOpen(false)
      setImportPreview(null)
      setConfigName('')
      setSelectedId(saved.id)
      await loadConfigs()
    } catch (error: any) {
      setActionError(error?.message || '保存配置失败')
    }
  }

  async function handleStartOrStop() {
    setActionError('')
    try {
      if (status === 'running' || status === 'starting' || status === 'stopping') {
        await window.electronAPI.frpStop()
        return
      }
      if (!selectedConfig) return
      await window.electronAPI.frpConfigsStart(selectedConfig.id)
      await loadConfigs()
    } catch (error: any) {
      setActionError(error?.message || '启动失败')
    }
  }

  async function handleRemoveConfig() {
    if (!selectedConfig) return
    setActionError('')
    try {
      await window.electronAPI.frpConfigsRemove(selectedConfig.id)
      await loadConfigs()
    } catch (error: any) {
      setActionError(error?.message || '删除配置失败')
    }
  }

  const running = status === 'running' || status === 'starting' || status === 'stopping'

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        FRP 内网穿透
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 860, mb: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {actionError && <Alert severity="error">{actionError}</Alert>}

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<FileOpen />} onClick={handlePickConfig}>
              导入配置文件
            </Button>
            <Button
              variant="contained"
              color={running ? 'error' : 'primary'}
              startIcon={running ? <Stop /> : <PlayArrow />}
              onClick={handleStartOrStop}
              disabled={!running && !selectedConfig}
            >
              {running ? '停止' : '启动所选配置'}
            </Button>
            <Button
              variant="text"
              color="error"
              startIcon={<DeleteOutline />}
              onClick={handleRemoveConfig}
              disabled={!selectedConfig || running}
            >
              删除所选配置
            </Button>
            <Chip
              label={status === 'running' ? '运行中' : status === 'starting' ? '启动中' : status === 'stopping' ? '停止中' : status === 'error' ? '错误' : '未运行'}
              color={status === 'running' ? 'success' : status === 'error' ? 'error' : 'default'}
            />
          </Box>

          <FormControl size="small" fullWidth disabled={configs.length === 0}>
            <InputLabel>选择配置</InputLabel>
            <Select
              value={selectedId}
              label="选择配置"
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {configs.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.name} ({item.fileName})
                </MenuItem>
              ))}
              {configs.length === 0 && <MenuItem disabled value="">暂无已导入配置</MenuItem>}
            </Select>
          </FormControl>

          {selectedConfig ? (
            <Paper variant="outlined" sx={{ p: 2.5, bgcolor: '#fafafa' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>
                    {selectedConfig.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedConfig.filePath}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <Chip size="small" label={`代理: ${selectedConfig.summary.proxyName}`} />
                  <Chip size="small" label={`服务端: ${selectedConfig.summary.serverAddr || '未识别'}:${selectedConfig.summary.serverPort}`} />
                  <Chip size="small" label={`本地: ${selectedConfig.summary.localPort}`} />
                  <Chip size="small" label={`远程: ${selectedConfig.summary.remotePort}`} />
                  <Chip size="small" color={selectedConfig.summary.tokenConfigured ? 'success' : 'default'} label={selectedConfig.summary.tokenConfigured ? '已配置 Token' : '未识别 Token'} />
                </Box>
              </Box>

              <Typography variant="body2" color="text.secondary">
                导入时间：{formatDateTime(selectedConfig.importedAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: selectedConfig.warnings.length ? 2 : 0 }}>
                最近使用：{formatDateTime(selectedConfig.lastUsedAt)}
              </Typography>

              {selectedConfig.warnings.map((warning) => (
                <Alert key={warning} severity="warning" sx={{ mt: 1 }}>
                  {warning}
                </Alert>
              ))}
            </Paper>
          ) : (
            <Alert severity="warning">
              暂无已导入配置
            </Alert>
          )}
        </Box>
      </Paper>

      <Paper
        sx={{
          maxWidth: 860,
          height: 240,
          overflow: 'auto',
          p: 1.5,
          fontFamily: 'Consolas, monospace',
          fontSize: 12,
          bgcolor: '#1a1a1a',
          color: '#e0e0e0',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
        }}
      >
        {logs.length === 0 && <Typography sx={{ color: '#888' }}>启动后日志将显示在此处</Typography>}
        {logs.map((line, index) => <div key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>)}
        <div ref={logEndRef} />
      </Paper>

      <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>保存导入的配置</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {importPreview && (
              <>
                <TextField
                  label="配置名称"
                  value={configName}
                  onChange={(event) => setConfigName(event.target.value)}
                  autoFocus
                  fullWidth
                />
                <TextField
                  label="配置文件路径"
                  value={importPreview.filePath}
                  InputProps={{ readOnly: true }}
                  fullWidth
                />
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" label={`代理: ${importPreview.summary.proxyName}`} />
                  <Chip size="small" label={`服务端: ${importPreview.summary.serverAddr || '未识别'}:${importPreview.summary.serverPort}`} />
                  <Chip size="small" label={`本地: ${importPreview.summary.localPort}`} />
                  <Chip size="small" label={`远程: ${importPreview.summary.remotePort}`} />
                </Box>
                {importPreview.warnings.map((warning) => (
                  <Alert key={warning} severity="warning">
                    {warning}
                  </Alert>
                ))}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveImportedConfig} disabled={!configName.trim()}>
            保存到配置列表
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
