import React, { useEffect, useState } from 'react'
import { ArrowRight, Boxes, Cloud, HardDrive, Network } from 'lucide-react'
import { Page } from '../App'
import { Badge, Button } from '../components/ui'

interface Props {
  onNavigate: (page: Page) => void
  active: boolean
}

export function HomePage({ onNavigate, active }: Props) {
  const [javaInfo, setJavaInfo] = useState<string>('检测中...')

  useEffect(() => {
    if (!active) return
    window.electronAPI.detectJava()
      .then(info => setJavaInfo(info ? `Java ${info.version}` : '未检测到 Java'))
      .catch(() => setJavaInfo('检测失败'))
  }, [active])

  const actions = [
    { page: 'cores' as Page, icon: <Boxes />, title: '选择核心' },
    { page: 'cloud' as Page, icon: <Cloud />, title: '连接云服务器' },
    { page: 'server' as Page, icon: <HardDrive />, title: '本地服务器' },
    { page: 'frp' as Page, icon: <Network />, title: 'FRP 穿透' },
  ]

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy">
          <h1 className="page-heading__title">服务器工作台</h1>
        </div>
      </section>

      <div className="home-status">
        <div className="summary-line">
          <span>Java 环境</span>
          <Badge tone={javaInfo.startsWith('Java') ? 'success' : 'warning'}>{javaInfo}</Badge>
        </div>
        <Button variant="link" size="sm" onClick={() => onNavigate('java')}>管理 Java</Button>
      </div>

      <section className="section-stack">
        <div className="section-heading">
          <div className="section-heading__copy">
            <h2 className="section-title">常用入口</h2>
          </div>
        </div>
        <div className="home-actions">
          {actions.map(action => (
            <button key={action.page} type="button" className="home-action" onClick={() => onNavigate(action.page)}>
              <span className="home-action__icon" aria-hidden="true">{action.icon}</span>
              <span>
                <strong className="home-action__title">{action.title}</strong>
              </span>
              <ArrowRight className="home-action__arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
