import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

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
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState } from '@/lib/types'

type ScanSession = {
  pairingId: string
  authUrl: string
  expiresAt: number
}

type ScanStatus = 'pending' | 'paired' | 'expired' | 'failed'

export function BotScanForm({
  state,
  onSaved,
  onCancel,
}: {
  state: AdminState | null
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState('智能助手')
  const [agentConfigId, setAgentConfigId] = useState('')
  const [showThinking, setShowThinking] = useState(true)
  const [session, setSession] = useState<ScanSession | null>(null)
  const [status, setStatus] = useState<ScanStatus>('pending')
  const [pairedBotId, setPairedBotId] = useState('')
  const [pairedBotName, setPairedBotName] = useState('')
  const [busy, setBusy] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!agentConfigId && state?.agents[0]?.id) setAgentConfigId(state.agents[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    if (!session || status !== 'pending') return
    pollTimer.current = setInterval(async () => {
      try {
        const r = await api<{ status: ScanStatus; botId?: string; botName?: string }>(
          `/api/admin/wecom-pairing/${session.pairingId}`,
        )
        if (r.status === 'paired') {
          setStatus('paired')
          setPairedBotId(r.botId ?? '')
          setPairedBotName(r.botName ?? '')
          if (r.botName && name === '智能助手') setName(r.botName)
        } else if (r.status !== 'pending') {
          setStatus(r.status)
        }
      } catch {
        // 单次轮询失败不打断，下个周期重试
      }
    }, 3000)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status])

  async function generate() {
    setBusy(true)
    try {
      const s = await toastTask(
        api<ScanSession>('/api/admin/wecom-pairing', { method: 'POST', body: '{}' }),
        '正在创建扫码会话…',
        '请使用企业微信扫码',
      )
      setSession(s)
      setStatus('pending')
      setPairedBotId('')
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    if (!session) return
    setBusy(true)
    try {
      await toastTask(
        api(`/api/admin/wecom-pairing/${session.pairingId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ name, agentConfigId, showThinking }),
        }),
        '正在完成配对…',
        'Bot 配对已创建，连接正在同步',
      )
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Bot 显示名称</Label>
          <Input required maxLength={100} placeholder="运维助手" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label>绑定 Agent</Label>
          <Select value={agentConfigId} onValueChange={(v) => setAgentConfigId(v ?? '')}>
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
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={showThinking} onCheckedChange={(v) => setShowThinking(v === true)} />
        显示思考过程
        <span className="text-xs font-normal text-muted-foreground">取消勾选后，仅推送最终回复</span>
      </label>

      {!session || status === 'expired' || status === 'failed' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
          {status === 'expired' && <span>二维码已过期，请重新生成。</span>}
          {status === 'failed' && <span>扫码授权失败，请重新生成。</span>}
          {!session && <span>生成二维码后，使用企业微信扫码即可一键创建机器人。</span>}
          <Button onClick={generate} disabled={busy}>
            {busy ? '生成中…' : session ? '重新生成二维码' : '生成二维码'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-6 rounded-lg border p-4">
          <div className="rounded-lg bg-white p-2">
            <QRCodeSVG value={session.authUrl} size={144} />
          </div>
          <div className="flex flex-col gap-2 text-sm">
            {status === 'pending' ? (
              <>
                <span className="font-medium">等待扫码确认…</span>
                <span className="text-muted-foreground">
                  打开企业微信「扫一扫」，确认“一键创建机器人”。二维码约 5 分钟内有效。
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-green-600">已创建机器人{pairedBotName ? `「${pairedBotName}」` : ''}</span>
                <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">{pairedBotId}</code>
                <span className="text-muted-foreground">确认上方名称与绑定的 Agent 后，点击“完成配对”。</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        {status === 'paired' && (
          <Button onClick={complete} disabled={busy || !name || !agentConfigId}>
            {busy ? '配对中…' : '完成配对'}
          </Button>
        )}
      </div>
    </div>
  )
}
