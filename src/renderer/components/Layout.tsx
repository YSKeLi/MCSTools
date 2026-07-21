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
  CloudQueue as CloudIcon,
  DarkMode,
  Dashboard as ServerIcon,
  Memory as JavaIcon,
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
  { id: 'home', label: '\u9996\u9875', icon: <HomeIcon /> },
  { id: 'cores', label: '\u6838\u5FC3\u9009\u62E9', icon: <CoreIcon /> },
  { id: 'cloud', label: '\u4E91\u670D\u52A1\u5668\u7BA1\u7406', icon: <CloudIcon /> },
  { id: 'server', label: '\u672C\u5730\u670D\u52A1\u5668\u7BA1\u7406', icon: <ServerIcon /> },
  { id: 'frp', label: 'FRP \u8BBE\u7F6E', icon: <FrpIcon /> },
  { id: 'java', label: 'Java \u7BA1\u7406', icon: <JavaIcon /> },
  { id: 'settings', label: '\u8BBE\u7F6E', icon: <SettingsIcon /> },
  { id: 'about', label: '\u5173\u4E8E', icon: <InfoIcon /> },
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
            {'Minecraft \u670D\u52A1\u5668\u642D\u5EFA\u5DE5\u5177'}
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
