import React, { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import alexHead from '../assets/alex-head.svg'
import steveHead from '../assets/steve-head.svg'
import { Badge } from './ui'

interface Props {
  hasServer: boolean
  status: ServerProcessStatus
  players: string[]
}

function defaultModel(playerName: string): PlayerSkinInfo['model'] {
  let hash = 0
  for (const character of playerName) hash = ((hash * 31) + character.charCodeAt(0)) | 0
  return (hash & 1) === 0 ? 'classic' : 'slim'
}

function PlayerAvatar({ playerName }: { playerName: string }) {
  const [skin, setSkin] = useState<PlayerSkinInfo | null>(null)
  const [skinFailed, setSkinFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    setSkin(null)
    setSkinFailed(false)
    void window.electronAPI.getPlayerSkin(playerName)
      .then(result => { if (!disposed) setSkin(result) })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [playerName])

  const model = skin?.model ?? defaultModel(playerName)
  const skinUrl = skinFailed ? null : skin?.skinUrl
  const fallbackName = model === 'slim' ? 'Alex' : 'Steve'
  const avatarLabel = skinUrl ? `${playerName} 的正版皮肤头像` : `${playerName} 的${fallbackName}默认头像`

  return (
    <span className="online-player__avatar" role="img" aria-label={avatarLabel} title={avatarLabel}>
      {skinUrl ? (
        <>
          <img
            className="online-player__skin online-player__skin--face"
            src={skinUrl}
            alt=""
            aria-hidden="true"
            draggable="false"
            referrerPolicy="no-referrer"
            onError={() => setSkinFailed(true)}
          />
          <img
            className="online-player__skin online-player__skin--hat"
            src={skinUrl}
            alt=""
            aria-hidden="true"
            draggable="false"
            referrerPolicy="no-referrer"
          />
        </>
      ) : (
        <img
          className="online-player__fallback-avatar"
          src={model === 'slim' ? alexHead : steveHead}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      )}
    </span>
  )
}

function emptyMessage(hasServer: boolean, status: ServerProcessStatus): string {
  if (!hasServer) return '选择服务器后可查看在线玩家'
  if (status === 'starting') return '服务器正在启动'
  if (status === 'stopping') return '服务器正在停止'
  if (status !== 'running') return '服务器未运行'
  return '暂无玩家在线'
}

export function OnlinePlayers({ hasServer, status, players }: Props) {
  const running = hasServer && status === 'running'

  return (
    <section className="section-stack" aria-labelledby="online-players-title">
      <div className="section-heading online-players__heading">
        <div className="section-heading__copy">
          <h2 className="section-title" id="online-players-title">在线玩家</h2>
        </div>
        <Badge tone={running ? 'success' : 'neutral'}>{running ? `${players.length} 人在线` : '离线'}</Badge>
      </div>

      <div className={`online-players${running && players.length > 0 ? ' online-players--populated' : ''}`} aria-live="polite">
        {running && players.length > 0 ? players.map(player => (
          <div className="online-player" key={player}>
            <PlayerAvatar playerName={player} />
            <span className="online-player__name" title={player}>{player}</span>
            <span className="online-player__status" aria-label="在线" title="在线"><span aria-hidden="true" /></span>
          </div>
        )) : (
          <div className="online-players__empty">
            <Users aria-hidden="true" />
            <span>{emptyMessage(hasServer, status)}</span>
          </div>
        )}
      </div>
    </section>
  )
}
