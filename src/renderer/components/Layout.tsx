import React from 'react'
import { ArrowLeft, Boxes, ChevronRight, Cloud, Coffee, Home, Info, Moon, Network, Server, Settings, Sun } from 'lucide-react'
import { Page } from '../App'

type NavItem = { id: Page; label: string; icon: React.ReactNode }

const workspaceItems: NavItem[] = [
  { id: 'home', label: '首页', icon: <Home /> },
  { id: 'cores', label: '核心下载', icon: <Boxes /> },
  { id: 'cloud', label: '云服务器', icon: <Cloud /> },
  { id: 'server', label: '本地服务器', icon: <Server /> },
  { id: 'frp', label: 'FRP 穿透', icon: <Network /> },
  { id: 'java', label: 'Java 管理', icon: <Coffee /> },
]

const systemItems: NavItem[] = [
  { id: 'settings', label: '设置', icon: <Settings /> },
  { id: 'about', label: '关于', icon: <Info /> },
]

const navItems = [...workspaceItems, ...systemItems]

interface Props {
  page: Page
  onPageChange: (page: Page) => void
  onExitSettings: () => void
  onExitCloudServer: () => void
  darkMode: boolean
  onToggleDark: () => void
  children: React.ReactNode
}

function NavGroup({ label, items, page, onPageChange }: { label: string; items: NavItem[]; page: Page; onPageChange: (page: Page) => void }) {
  return (
    <div className="app-nav__group">
      <span className="app-nav__group-label">{label}</span>
      <div className="app-nav__items">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className={`app-nav__button${page === item.id ? ' app-nav__button--active' : ''}`}
            onClick={() => onPageChange(item.id)}
            title={item.label}
          >
            <span className="app-nav__icon" aria-hidden="true">{item.icon}</span>
            <span className="app-nav__label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function Layout({ page, onPageChange, onExitSettings, onExitCloudServer, darkMode, onToggleDark, children }: Props) {
  const currentItem = navItems.find(item => item.id === page)

  if (page === 'settings' || page === 'cloud-detail') {
    const isSettings = page === 'settings'
    return (
      <div className="settings-shell">
        <header className="settings-shell__header">
          <button
            type="button"
            className="settings-shell__back"
            onClick={isSettings ? onExitSettings : onExitCloudServer}
            aria-label="返回"
            title="返回"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <h1 className="settings-shell__title">{isSettings ? '设置' : '云服务器管理'}</h1>
        </header>
        <main className="settings-shell__main">{children}</main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <img className="app-brand__logo" src="./icons/app-icon.png" alt="" />
          <div className="app-brand__copy">
            <h1 className="app-brand__title">MC Server Tools</h1>
          </div>
        </div>

        <nav className="app-nav" aria-label="主导航">
          <NavGroup label="工作台" items={workspaceItems} page={page} onPageChange={onPageChange} />
          <NavGroup label="系统" items={systemItems} page={page} onPageChange={onPageChange} />
        </nav>

        <div className="app-sidebar__footer">
          <div className="app-theme-switch" aria-label="外观模式">
            <button
              type="button"
              className={!darkMode ? 'app-theme-switch__button app-theme-switch__button--active' : 'app-theme-switch__button'}
              onClick={() => darkMode && onToggleDark()}
              aria-label="浅色模式"
              title="浅色模式"
            >
              <Sun />
            </button>
            <button
              type="button"
              className={darkMode ? 'app-theme-switch__button app-theme-switch__button--active' : 'app-theme-switch__button'}
              onClick={() => !darkMode && onToggleDark()}
              aria-label="深色模式"
              title="深色模式"
            >
              <Moon />
            </button>
          </div>
          <span className="app-sidebar__mode">Local</span>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-topbar">
          <div className="app-topbar__breadcrumb">
            <span className="app-topbar__dot" aria-hidden="true" />
            <span>MCST</span>
            <ChevronRight aria-hidden="true" />
            <strong>{currentItem?.label || '控制台'}</strong>
          </div>
        </header>
        {children}
      </main>
    </div>
  )
}
