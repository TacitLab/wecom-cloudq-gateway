import { ChevronsUpDown, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AdvancedSection } from '@/components/advanced-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, AgentConfig, RemoteAgent } from '@/lib/types'

export function AgentForm({
  record,
  state,
  onSaved,
  onCancel,
  submitLabel = '保存',
  formId,
  hideFooter,
}: {
  record?: AgentConfig
  state: AdminState | null
  onSaved: () => Promise<void>
  onCancel?: () => void
  submitLabel?: string
  formId?: string
  hideFooter?: boolean
}) {
  const keys = state?.wmaCredentials ?? []
  const [credentialConfigId, setCredentialConfigId] = useState('')
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgent[]>([])
  const [agentId, setAgentId] = useState('')
  const [name, setName] = useState('')
  const [controlTimeoutMs, setControlTimeoutMs] = useState('30000')
  const [promptTimeoutMs, setPromptTimeoutMs] = useState('1200000')
  const [includeThinking, setIncludeThinking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const requestVersion = useRef(0)
  const selectedKey = keys.find((key) => key.id === credentialConfigId)

  useEffect(() => {
    requestVersion.current += 1
    setCredentialConfigId(record ? record.credentialConfigId ?? '' : state?.wmaCredentials[0]?.id ?? '')
    setRemoteAgents([])
    setAgentId(record?.agentId ?? '')
    setName(record?.name ?? '')
    setControlTimeoutMs(String(record?.controlTimeoutMs ?? 30000))
    setPromptTimeoutMs(String(record?.promptTimeoutMs ?? 1200000))
    setIncludeThinking(Boolean(record?.includeThinking))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  async function pullAgents() {
    if (!credentialConfigId) return
    const version = ++requestVersion.current
    setRemoteAgents([])
    setPulling(true)
    try {
      const r = await toastTask(
        api<{ items: RemoteAgent[] }>(`/api/admin/wma-credentials/${credentialConfigId}/agents`, {
          method: 'POST',
          body: '{}',
        }),
        '正在拉取 Agent 列表…',
        (r) => `已拉取 ${(r.items ?? []).filter((x) => x.enabled).length} 个可用 Agent`,
      )
      if (version !== requestVersion.current) return
      const items = (r.items ?? []).filter((x) => x.enabled)
      if (!items.length) {
        setRemoteAgents([])
        toast.warning('未发现可用 Agent，请检查腾讯云凭证的 WMA 权限及 Agent 的公网 API 设置')
        return
      }
      setRemoteAgents(items)
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      if (version === requestVersion.current) setPulling(false)
    }
  }

  // Editing and changing keys both refresh the list in the selected tenant.
  useEffect(() => {
    if (credentialConfigId) void pullAgents()
    return () => { requestVersion.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialConfigId])

  function pickRemote(value: string) {
    const picked = remoteAgents.find((x) => x.agentId === value)
    if (!picked) return
    setAgentId(picked.agentId)
    if (picked.agentName) setName(picked.agentName)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pulling || saving) return
    if (!agentId) return toast.error('请先从 Agent 列表中选择要绑定的 Agent')
    if (!remoteAgents.some((agent) => agent.agentId === agentId)) return toast.error('请从当前凭证的 Agent 列表重新选择')
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/agents${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({
            id,
            credentialConfigId,
            agentId,
            name,
            controlTimeoutMs: Number(controlTimeoutMs),
            promptTimeoutMs: Number(promptTimeoutMs),
            includeThinking,
          }),
        }),
        '保存中…',
        'Agent 已保存',
      )
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  if (!keys.length && !record) {
    return (
      <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        尚未配置 WMA 凭证，请先在「WMA 凭证设置」中录入腾讯云 AK/SK。
      </div>
    )
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>WMA 凭证</Label>
        <Select value={credentialConfigId} onValueChange={(v) => {
          requestVersion.current += 1
          setRemoteAgents([])
          setAgentId('')
          setName('')
          setCredentialConfigId(v ?? '')
        }}>
          <SelectTrigger>
            <SelectValue>
              {(v) => keys.find((k) => k.id === v)?.name ?? v}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {keys.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedKey && <p className="text-xs text-muted-foreground">腾讯云 API 接入地域：{selectedKey.region}</p>}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-1.5">
          <Label>Agent 列表</Label>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={pullAgents}
            disabled={pulling || !credentialConfigId}
            aria-label="刷新 Agent 列表"
          >
            <RefreshCw className={pulling ? 'animate-spin' : undefined} />
          </Button>
        </div>
        <Popover open={pickerOpen} onOpenChange={(o) => setPickerOpen(o)}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
                disabled={pulling || !credentialConfigId}
              />
            }
          >
            <span className="min-w-0 truncate">
              {(() => {
                if (!agentId)
                  return (
                    <span className="text-muted-foreground">
                      {pulling ? '正在拉取…' : '选择要绑定的 Agent'}
                    </span>
                  )
                const picked = remoteAgents.find((x) => x.agentId === agentId)
                const label = picked?.agentName || record?.name || agentId
                return (
                  <>
                    {label}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{agentId}</span>
                  </>
                )
              })()}
            </span>
            <ChevronsUpDown className="shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--anchor-width) p-0">
            <Command>
              <CommandInput placeholder="搜索名称或 Agent ID…" />
              <CommandList>
                <CommandEmpty>无匹配的 Agent</CommandEmpty>
                <CommandGroup>
                  {remoteAgents.map((x) => (
                    <CommandItem
                      key={x.agentId}
                      value={`${x.agentName || ''} ${x.agentId}`}
                      disabled={Boolean(x.existingConfigId && x.existingConfigId !== record?.id)}
                      onSelect={() => {
                        pickRemote(x.agentId)
                        setPickerOpen(false)
                      }}
                    >
                      <span className="min-w-0 truncate">{x.agentName || x.agentId}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {x.agentId}
                      </span>
                      {x.existingConfigId && x.existingConfigId !== record?.id && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          已添加
                        </Badge>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="agent-name">显示名称（可选）</Label>
        <Input
          id="agent-name"
          maxLength={100}
          placeholder="默认使用 Agent ID"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <AdvancedSection>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>控制超时（毫秒）</Label>
              <Input type="number" value={controlTimeoutMs} onChange={(e) => setControlTimeoutMs(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>对话超时（毫秒）</Label>
              <Input type="number" value={promptTimeoutMs} onChange={(e) => setPromptTimeoutMs(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={includeThinking} onCheckedChange={(v) => setIncludeThinking(v === true)} />
            包含 thinking 流（通常关闭）
          </label>
        </div>
      </AdvancedSection>

      {!hideFooter && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="submit" disabled={saving || pulling || !agentId || (!remoteAgents.some((agent) => agent.agentId === agentId))}>
            {saving ? '保存中…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
