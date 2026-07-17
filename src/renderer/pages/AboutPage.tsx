import React, { useEffect, useState } from 'react'
import { GitHub } from '@mui/icons-material'
import { Avatar, Box, Link, Typography } from '@mui/material'

export function AboutPage() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => setVersion('unknown'))
  }, [])

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        textAlign: 'center',
        gap: 2,
      }}
    >
      <Avatar src="/icons/app-icon.ico" sx={{ width: 80, height: 80 }} />
      <Typography variant="h5" fontWeight={700}>
        Minecraft 服务器搭建工具
      </Typography>
      <Typography variant="body2" color="text.secondary">
        版本 {version || '...'}
      </Typography>
      <Typography variant="body1">
        制作者：<strong>小亚</strong>
      </Typography>
      <Link
        href="https://github.com/aaatri/MCServerTools"
        target="_blank"
        rel="noopener noreferrer"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        <GitHub fontSize="small" /> MCServerTools
      </Link>
    </Box>
  )
}
