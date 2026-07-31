import React, { useCallback, useEffect, useState } from 'react'
import { Cloud, Eye, EyeOff, FileKey2, KeyRound, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import { AlertBanner, Badge, Button, Dialog, Field, IconButton, Spinner } from '../components/ui'

interface Props {
  active: boolean
  onOpenServer: (serverId: string) => void
}

const EMPTY_FORM: RemoteServerInput = { name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', os: 'linux' }

function remoteOsLabel(os: RemoteServerOs): string {
  if (os === 'windows') return 'Windows'
  if (os === 'macos') return 'macOS'
  return 'Linux'
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '').trim() || '操作失败，请稍后重试'
}

export function RemoteServerPage({ active, onOpenServer }: Props) {
  const [servers, setServers] = useState<RemoteServerSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState<RemoteServerInput>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<RemoteServerSummary | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const loadServers = useCallback(async () => {
    setListLoading(true)
    try {
      setServers(await window.electronAPI.remoteServersList())
      setError('')
    } catch (loadError) {
      setError(cleanError(loadError))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { if (active) void loadServers() }, [active, loadServers])

  function openAddDialog() {
    setForm(EMPTY_FORM)
    setAddError('')
    setShowPassword(false)
    setAddOpen(true)
  }

  function updateForm<Key extends keyof RemoteServerInput>(key: Key, value: RemoteServerInput[Key]) {
    setForm(current => ({
      ...current,
      [key]: value,
      ...(['host', 'port', 'username'].includes(String(key)) ? { expectedFingerprint: undefined } : {}),
    }))
  }

  async function handleAdd() {
    setAddLoading(true)
    setAddError('')
    try {
      if (!form.expectedFingerprint) {
        const fingerprint = await window.electronAPI.remoteServerFingerprint({ host: form.host, port: form.port, username: form.username })
        setForm(current => ({ ...current, expectedFingerprint: fingerprint }))
        return
      }
      const result = await window.electronAPI.remoteServersAdd(form)
      setServers(current => [...current, result.server])
      setAddOpen(false)
      setForm(EMPTY_FORM)
      onOpenServer(result.server.id)
    } catch (addServerError) {
      setAddError(cleanError(addServerError))
    } finally {
      setAddLoading(false)
    }
  }

  async function handleSelectPrivateKey() {
    setAddError('')
    try {
      const selected = await window.electronAPI.selectPrivateKey()
      if (selected) setForm(current => ({ ...current, privateKey: selected.content, privateKeyName: selected.name }))
    } catch (selectError) {
      setAddError(cleanError(selectError))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await window.electronAPI.remoteServersRemove(deleteTarget.id)
      setServers(current => current.filter(server => server.id !== deleteTarget.id))
      setDeleteTarget(null)
      setError('')
    } catch (removeError) {
      setError(cleanError(removeError))
      setDeleteTarget(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  const hasCredential = form.authType === 'private-key' ? Boolean(form.privateKey) : Boolean(form.password)
  const canAdd = Boolean(form.name.trim() && form.host.trim() && form.username.trim() && hasCredential && Number.isInteger(Number(form.port)) && Number(form.port) >= 1 && Number(form.port) <= 65535)

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="page-heading__copy"><h1 className="page-heading__title">云服务器</h1>{servers.length ? <p className="page-heading__subtitle">{servers.length} 台已连接</p> : null}</div>
        <div className="toolbar__group"><IconButton onClick={() => void loadServers()} loading={listLoading} title="刷新服务器列表" aria-label="刷新服务器列表"><RefreshCw /></IconButton><Button startIcon={<Plus />} onClick={openAddDialog}>连接云服务器</Button></div>
      </section>

      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      {listLoading && !servers.length ? <div className="empty-state"><div className="empty-state__content"><Spinner size={28} /><p className="empty-state__message">正在读取服务器列表...</p></div></div> : null}
      {!listLoading && !servers.length ? <div className="empty-state"><div className="empty-state__content"><span className="empty-state__icon"><Cloud /></span><h2 className="empty-state__title">你还没有云服务器，快添加吧</h2><Button startIcon={<Plus />} onClick={openAddDialog}>连接云服务器</Button></div></div> : null}

      {servers.length ? (
        <div className="remote-host-list">
          {servers.map(server => (
            <article className="remote-host-row" key={server.id}>
              <button type="button" className="remote-host-row__main" onClick={() => onOpenServer(server.id)}>
                <span className="remote-host-row__icon"><Server /></span>
                <span className="remote-host-row__copy">
                  <strong>{server.name}</strong>
                  <span className="mono">{server.username}@{server.host}:{server.port}</span>
                </span>
                <Badge>{remoteOsLabel(server.os)} / {server.authType === 'private-key' ? '私钥' : '密码'}</Badge>
                <span className="remote-host-row__open">打开管理</span>
              </button>
              <IconButton tone="danger" onClick={() => setDeleteTarget(server)} title="删除连接" aria-label={`删除 ${server.name}`}><Trash2 /></IconButton>
            </article>
          ))}
        </div>
      ) : null}

      <Dialog open={addOpen} onClose={() => !addLoading && setAddOpen(false)} dismissible={!addLoading} title="连接云服务器" width="sm" footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addLoading}>取消</Button><Button startIcon={<Plus />} onClick={() => void handleAdd()} loading={addLoading} disabled={!canAdd}>{form.expectedFingerprint ? '确认指纹并连接' : '验证主机指纹'}</Button></div>}>
        <div className="stack">
          {addError ? <AlertBanner tone="danger">{addError}</AlertBanner> : null}
          {form.expectedFingerprint ? <AlertBanner tone="warning">请确认主机指纹后继续：<span className="mono">{form.expectedFingerprint}</span></AlertBanner> : null}
          <Field label="服务器名称"><input className="ui-input" value={form.name} onChange={event => updateForm('name', event.target.value)} autoFocus disabled={addLoading} /></Field>
          <Field label="服务器系统"><select className="ui-select" value={form.os} disabled={addLoading} onChange={event => {
            const os = event.target.value as RemoteServerOs
            setForm(current => ({ ...current, os, expectedFingerprint: undefined, username: current.username === 'root' || current.username === 'Administrator' ? (os === 'linux' ? 'root' : '') : current.username }))
          }}><option value="linux">Linux</option><option value="windows">Windows Server</option><option value="macos">macOS</option></select></Field>
          <div className="form-grid"><Field label="服务器地址"><input className="ui-input" placeholder="IP 地址或域名" value={form.host} onChange={event => updateForm('host', event.target.value)} disabled={addLoading} /></Field><Field label="SSH 端口"><input className="ui-input" type="number" min={1} max={65535} value={form.port} onChange={event => updateForm('port', Number(event.target.value))} disabled={addLoading} /></Field></div>
          <Field label="账户名"><input className="ui-input" value={form.username} onChange={event => updateForm('username', event.target.value)} disabled={addLoading} /></Field>
          <Field label="认证方式">
            <div className="remote-auth-switch" role="radiogroup" aria-label="SSH 认证方式">
              <button type="button" role="radio" aria-checked={form.authType === 'password'} className={form.authType === 'password' ? 'is-active' : ''} onClick={() => setForm(current => ({ ...current, authType: 'password', privateKey: undefined, privateKeyName: undefined, passphrase: undefined }))} disabled={addLoading}><KeyRound />密码</button>
              <button type="button" role="radio" aria-checked={form.authType === 'private-key'} className={form.authType === 'private-key' ? 'is-active' : ''} onClick={() => setForm(current => ({ ...current, authType: 'private-key', password: '' }))} disabled={addLoading}><FileKey2 />私钥</button>
            </div>
          </Field>
          {form.authType === 'password' ? (
            <Field label="密码"><div className="input-with-action"><input className="ui-input" type={showPassword ? 'text' : 'password'} value={form.password || ''} onChange={event => updateForm('password', event.target.value)} disabled={addLoading} /><IconButton onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff /> : <Eye />}</IconButton></div></Field>
          ) : (
            <>
              <Field label="私钥文件"><Button className="remote-key-picker" variant="secondary" startIcon={<FileKey2 />} onClick={() => void handleSelectPrivateKey()} disabled={addLoading}>{form.privateKeyName || '选择私钥文件'}</Button></Field>
              <Field label="私钥口令（可选）"><div className="input-with-action"><input className="ui-input" type={showPassword ? 'text' : 'password'} value={form.passphrase || ''} onChange={event => updateForm('passphrase', event.target.value)} disabled={addLoading} /><IconButton onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏口令' : '显示口令'}>{showPassword ? <EyeOff /> : <Eye />}</IconButton></div></Field>
            </>
          )}
        </div>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleteLoading && setDeleteTarget(null)} dismissible={!deleteLoading} title="删除服务器连接" width="sm" footer={<div className="dialog-actions"><Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>取消</Button><Button variant="danger" onClick={() => void handleDelete()} loading={deleteLoading}>删除</Button></div>}>
        <div className="stack stack--compact"><p>确定删除「{deleteTarget?.name}」吗？</p><p className="muted">只会删除本机保存的连接和实例信息，不会修改远程服务器文件。</p></div>
      </Dialog>
    </div>
  )
}
