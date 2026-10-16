import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, BotConfig } from '@/lib/types'

export function BotForm({
  record,
  state,
  onSaved,
  onCancel,
  submitLabel = '保存并同步连接',
  formId,
  hideFooter,
}: {
  record?: BotConfig
  state: AdminState | null
  onSaved: () => Promise<void>
  onCancel?: () => void
  submitLabel?: string
  formId?: string
  hideFooter?: boolean
}) {
  const [name, setName] = useState('')
  const [cloudAgentId, setCloudAgentId] = useState('')
  const [botId, setBotId] = useState('')
  const [secret, setSecret] = useState('')
  const [groupSessionScope, setGroupSessionScope] = useState<'chat' | 'user'>('chat')
  const [wsUrl, setWsUrl] = useState('')
  const [welcomeText, setWelcomeText] = useState('')
  const [placeholder, setPlaceholder] = useState('正在处理…')
  const [enabled, setEnabled] = useState(true)
  const [showThinking, setShowThinking] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(record?.name ?? '')
    setCloudAgentId(record?.cloudAgentId ?? state?.agents[0]?.id ?? '')
    setBotId(record?.botId ?? '')
    setSecret('')
    setGroupSessionScope(record?.groupSessionScope ?? 'chat')
    setWsUrl(record?.wsUrl ?? '')
    setWelcomeText(record?.welcomeText ?? '你好，我是企业智能助手。发送 /new 可以开始一个新会话。')
    setPlaceholder(record?.placeholder ?? '正在处理…')
    setEnabled(record ? Boolean(record.enabled) : true)
    setShowThinking(record?.showThinking ?? true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/bots${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({
            id,
            name,
            cloudAgentId,
            botId,
            secret,
            groupSessionScope,
            wsUrl,
            welcomeText,
            placeholder,
            enabled,
            showThinking,
          }),
        }),
        '保存并同步连接中…',
        'Bot 配对已保存，连接正在同步',
      )
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <form id={formId} onSubmit={submit} className="grid grid-cols-2 gap-4">
      <div className="grid gap-2">
        <Label>Bot 显示名称</Label>
        <Input required maxLength={100} placeholder="运维助手" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>绑定 CloudAgent</Label>
        <Select value={cloudAgentId} onValueChange={(v) => setCloudAgentId(v ?? '')}>
          <SelectTrigger>
            <SelectValue>
              {(v) => state?.agents.find((a) => a.id === v)?.name ?? v}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(state?.agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 grid gap-2">
        <Label>企业微信 Bot ID</Label>
        <Input required value={botId} onChange={(e) => setBotId(e.target.value)} />
      </div>
      <div className="col-span-2 grid gap-2">
        <Label>企业微信 Bot Secret</Label>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="编辑时留空表示不修改"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label>群聊 Session 范围</Label>
        <Select value={groupSessionScope} onValueChange={(v) => setGroupSessionScope(v === 'user' ? 'user' : 'chat')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chat">整个群共用</SelectItem>
            <SelectItem value="user">群内按用户隔离</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>私有部署 WebSocket 地址（可选）</Label>
        <Input placeholder="默认使用企微公网地址" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
      </div>
      <div className="col-span-2 grid gap-2">
        <Label>欢迎语</Label>
        <Textarea value={welcomeText} onChange={(e) => setWelcomeText(e.target.value)} />
      </div>
      <div className="col-span-2 grid gap-2">
        <Label>处理中提示</Label>
        <Input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
      </div>
      <label className="col-span-2 flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={showThinking} onCheckedChange={(v) => setShowThinking(v === true)} />
        显示思考过程
        <span className="text-xs font-normal text-muted-foreground">取消勾选后，仅推送最终回复</span>
      </label>
      <label className="col-span-2 flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
        启用该 Bot 长连接
      </label>
      {!hideFooter && (
        <div className="col-span-2 flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? '保存中…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
