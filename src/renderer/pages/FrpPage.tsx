import React, { useEffect, useState, useRef } from 'react'
import {
  Box, Typography, Paper, TextField, Button, Chip, Alert,
} from '@mui/material'
import { PlayArrow, Stop } from '@mui/icons-material'

export function FrpPage() {
  const [serverAddr, setServerAddr] = useState('')
  const [serverPort, setServerPort] = useState('7000')
  const [token, setToken] = useState('')
  const [localPort, setLocalPort] = useState('25565')
  const [remotePort, setRemotePort] = useState('25565')
  const [status, setStatus] = useState('stopped')
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window.electronAPI?.onFrpLog) return
    const unsubLog = window.electronAPI.onFrpLog(line => setLogs(prev => [...prev.slice(-200), line]))
    const unsubStatus = window.electronAPI.onFrpStatus(s => setStatus(s))
    return () => { unsubLog(); unsubStatus() }
  }, [])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  async function handleToggle() {
    if (status === 'running') {
      await window.electronAPI.frpStop()
    } else {
      if (!serverAddr.trim()) return
      await window.electronAPI.frpStart({
        serverAddr: serverAddr.trim(),
        serverPort: parseInt(serverPort) || 7000,
        token,
        localPort: parseInt(localPort) || 25565,
        remotePort: parseInt(remotePort) || 25565,
      })
    }
  }

  const connected = status === 'running'

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        FRP 内网穿透
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        将本地 Minecraft 服务器暴露到公网。首次启动会自动下载 frpc 二进制（约 10MB）
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 700 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="服务器地址" placeholder="frp.example.com" value={serverAddr} onChange={e => setServerAddr(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="端口" value={serverPort} onChange={e => setServerPort(e.target.value)} sx={{ width: 120 }} type="number" />
          </Box>
          <TextField label="Token" type="password" value={token} onChange={e => setToken(e.target.value)} />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="本地端口" value={localPort} onChange={e => setLocalPort(e.target.value)} type="number" sx={{ flex: 1 }} helperText="Minecraft 服务器端口" />
            <TextField label="远程端口" value={remotePort} onChange={e => setRemotePort(e.target.value)} type="number" sx={{ flex: 1 }} helperText="公网访问端口" />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, mb: 2 }}>
          <Button
            variant="contained"
            color={connected ? 'error' : 'primary'}
            startIcon={connected ? <Stop /> : <PlayArrow />}
            onClick={handleToggle}
            disabled={!serverAddr.trim()}
          >
            {connected ? '停止' : status === 'starting' ? '启动中...' : '启动'}
          </Button>
          <Chip
            label={connected ? '已连接' : status === 'error' ? '错误' : '未连接'}
            color={connected ? 'success' : status === 'error' ? 'error' : 'default'}
          />
        </Box>

        <Paper
          sx={{
            height: 200, overflow: 'auto', p: 1.5, fontFamily: 'Consolas, monospace',
            fontSize: 12, bgcolor: '#1a1a1a', color: '#e0e0e0',
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': { bgcolor: '#555', borderRadius: 4 },
          }}
        >
          {logs.length === 0 && <Typography sx={{ color: '#888' }}>启动后日志将显示在此处</Typography>}
          {logs.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>)}
          <div ref={logEndRef} />
        </Paper>
      </Paper>
    </Box>
  )
}
