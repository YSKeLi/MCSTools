import React from 'react'
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
} from '@mui/material'
import {
  DarkMode,
  Dashboard as ServerIcon,
  Dns as CoreIcon,
  Home as HomeIcon,
  Info as InfoIcon,
  LightMode,
  Settings as SettingsIcon,
  SettingsEthernet as FrpIcon,
} from '@mui/icons-material'
import { Page } from '../App'

const DRAWER_WIDTH = 220

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: '首页', icon: <HomeIcon /> },
  { id: 'cores', label: '核心选择', icon: <CoreIcon /> },
  { id: 'server', label: '服务器管理', icon: <ServerIcon /> },
  { id: 'frp', label: 'FRP 设置', icon: <FrpIcon /> },
  { id: 'settings', label: '设置', icon: <SettingsIcon /> },
  { id: 'about', label: '关于', icon: <InfoIcon /> },
]

interface Props {
  page: Page
  onPageChange: (page: Page) => void
  darkMode: boolean
  onToggleDark: () => void
  children: React.ReactNode
}

export function Layout({ page, onPageChange, darkMode, onToggleDark, children }: Props) {
  const theme = useTheme()

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: theme.palette.background.paper,
          color: theme.palette.text.primary,
          boxShadow: theme.shadows[4],
        }}
        elevation={0}
      >
        <Toolbar>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Minecraft 服务器搭建工具
          </Typography>
          <IconButton color="inherit" onClick={onToggleDark}>
            {darkMode ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <List sx={{ pt: 1 }}>
          {navItems.map(item => (
            <ListItem key={item.id} disablePadding>
              <ListItemButton selected={page === item.id} onClick={() => onPageChange(item.id)}>
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  )
}
