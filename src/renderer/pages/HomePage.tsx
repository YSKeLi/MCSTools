import React, { useEffect, useState } from 'react'
import {
  Box, Typography, Button, Paper, Grid,
} from '@mui/material'
import { Dns, Storage, SettingsEthernet } from '@mui/icons-material'
import { Page } from '../App'

interface Props {
  onNavigate: (page: Page) => void
}

export function HomePage({ onNavigate }: Props) {
  const [javaInfo, setJavaInfo] = useState<string>('检测中...')

  useEffect(() => {
    if (window.electronAPI?.detectJava) {
      window.electronAPI.detectJava().then(info => {
        setJavaInfo(info ? `Java ${info.version}` : '未检测到 Java')
      }).catch(() => setJavaInfo('检测失败'))
    }
  }, [])

  const actions = [
    { page: 'cores' as Page, icon: <Dns sx={{ fontSize: 40 }} />, title: '选择核心', desc: '浏览并下载服务端核心' },
    { page: 'server' as Page, icon: <Storage sx={{ fontSize: 40 }} />, title: '管理服务器', desc: '启动、停止、配置服务器' },
    { page: 'frp' as Page, icon: <SettingsEthernet sx={{ fontSize: 40 }} />, title: 'FRP 穿透', desc: '配置内网穿透' },
  ]

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        欢迎使用 Minecraft 服务器搭建工具
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        当前 Java 环境: {javaInfo}
      </Typography>

      <Grid container spacing={3}>
        {actions.map(a => (
          <Grid item xs={12} sm={4} key={a.page}>
            <Paper
              sx={{
                p: 3, cursor: 'pointer', textAlign: 'center',
                transition: '0.2s', '&:hover': { transform: 'translateY(-4px)' },
              }}
              elevation={1}
              onClick={() => onNavigate(a.page)}
            >
              <Box sx={{ color: 'primary.main', mb: 1 }}>{a.icon}</Box>
              <Typography variant="h6">{a.title}</Typography>
              <Typography variant="body2" color="text.secondary">{a.desc}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}
