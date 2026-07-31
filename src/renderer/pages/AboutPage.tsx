import React, { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { Button } from '../components/ui'

export function AboutPage() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setVersion).catch(() => setVersion('unknown'))
  }, [])

  return (
    <div className="about-page">
      <div className="about-page__content">
        <img className="about-page__icon" src="./icons/app-icon.ico" alt="" />
        <h1 className="about-page__title">Minecraft 服务器搭建工具</h1>
        <p className="about-page__meta">版本 {version || '...'}</p>
        <p className="about-page__meta">制作者：小亚</p>
        <Button
          variant="secondary"
          startIcon={<GitBranch />}
          onClick={() => void window.electronAPI.openExternal('https://github.com/YSKeLi/MCSTools')}
        >
          YSKeLi/MCSTools
        </Button>
      </div>
    </div>
  )
}
