import React, { useEffect, useState } from 'react'
import {
  Box,
  Grid,
  Link,
  Paper,
  Typography,
} from '@mui/material'
import {
  CloudQueue,
  Dns,
  SettingsEthernet,
  Storage,
} from '@mui/icons-material'
import { Page } from '../App'

interface Props {
  onNavigate: (page: Page) => void
  active: boolean
}

export function HomePage({ onNavigate, active }: Props) {
  const [javaInfo, setJavaInfo] = useState<string>('\u68C0\u6D4B\u4E2D...')

  useEffect(() => {
    if (window.electronAPI?.detectJava) {
      window.electronAPI.detectJava()
        .then(info => {
          setJavaInfo(info ? `Java ${info.version}` : '\u672A\u68C0\u6D4B\u5230 Java')
        })
        .catch(() => setJavaInfo('\u68C0\u6D4B\u5931\u8D25'))
    }
  }, [active])

  const actions = [
    {
      page: 'cores' as Page,
      icon: <Dns sx={{ fontSize: 40 }} />,
      title: '\u9009\u62E9\u6838\u5FC3',
      desc: '\u6D4F\u89C8\u5E76\u4E0B\u8F7D\u670D\u52A1\u7AEF\u6838\u5FC3',
    },
    {
      page: 'cloud' as Page,
      icon: <CloudQueue sx={{ fontSize: 40 }} />,
      title: '\u4E91\u670D\u52A1\u5668\u7BA1\u7406',
      desc: '\u8FDE\u63A5\u5E76\u76D1\u63A7\u8FDC\u7A0B\u4E91\u670D\u52A1\u5668',
    },
    {
      page: 'server' as Page,
      icon: <Storage sx={{ fontSize: 40 }} />,
      title: '\u672C\u5730\u670D\u52A1\u5668\u7BA1\u7406',
      desc: '\u542F\u52A8\u3001\u505C\u6B62\u3001\u914D\u7F6E\u670D\u52A1\u5668',
    },
    {
      page: 'frp' as Page,
      icon: <SettingsEthernet sx={{ fontSize: 40 }} />,
      title: 'FRP \u7A7F\u900F',
      desc: '\u914D\u7F6E\u5185\u7F51\u7A7F\u900F',
    },
  ]

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        {'\u6B22\u8FCE\u4F7F\u7528 Minecraft \u670D\u52A1\u5668\u642D\u5EFA\u5DE5\u5177'}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {'\u5F53\u524D Java \u73AF\u5883: '}
        {javaInfo}
        {' · '}
        <Link
          component="button"
          type="button"
          underline="hover"
          onClick={() => onNavigate('java')}
          sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}
        >
          Java管理
        </Link>
      </Typography>

      <Grid container spacing={3}>
        {actions.map(action => (
          <Grid item xs={12} sm={6} md={3} key={action.page}>
            <Paper
              sx={{
                p: 3,
                cursor: 'pointer',
                textAlign: 'center',
                transition: '0.2s',
                '&:hover': { transform: 'translateY(-4px)' },
              }}
              elevation={1}
              onClick={() => onNavigate(action.page)}
            >
              <Box sx={{ color: 'primary.main', mb: 1 }}>{action.icon}</Box>
              <Typography variant="h6">{action.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {action.desc}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}
