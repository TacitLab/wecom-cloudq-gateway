import { ChevronsUpDown, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
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
  const keys = state?.apiKeys ?? []
  const [apiKeyConfigId, setApiKeyConfigId] = useState('')
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgent[]>([])
  const [agentId, setAgentId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://www.codebuddy.cn/v2/agentos')
  const [sourceApp, setSourceApp] = useState('wecom-cloudagent-gateway')
  const [runtimeNamePrefix, setRuntimeNamePrefix] = useState('wecom')
  const [controlTimeoutMs, setControlTimeoutMs] = useState('1200000')
  const [promptTimeoutMs, setPromptTimeoutMs] = useState('1200000')
  const [manifest, setManifest] = useState('{}')
  const [includeThinking, setIncludeThinking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setApiKeyConfigId(record?.apiKeyConfigId ?? state?.apiKeys[0]?.id ?? '')
    setRemoteAgents([])
    setAgentId(record?.agentId ?? '')
    setName(record?.name ?? '')
    setBaseUrl(record?.baseUrl ?? 'https://www.codebuddy.cn/v2/agentos')
    setSourceApp(record?.sourceApp ?? 'wecom-cloudagent-gateway')
    setRuntimeNamePrefix(record?.runtimeNamePrefix ?? 'wecom')
    setControlTimeoutMs(String(record?.controlTimeoutMs ?? 1200000))
    setPromptTimeoutMs(String(record?.promptTimeoutMs ?? 1200000))
    setManifest(JSON.stringify(record?.manifest ?? {}, null, 2))
    setIncludeThinking(Boolean(record?.includeThinking))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  async function pullAgents() {
    if (!apiKeyConfigId) return
    setPulling(true)
    try {
      const r = await toastTask(
        api<{ items: RemoteAgent[] }>(`/api/admin/keys/${apiKeyConfigId}/agents`, {
          method: 'POST',
          body: '{}',
        }),
        '正在拉取 Agent 列表…',
        (r) => `已拉取 ${(r.items ?? []).filter((x) => x.enabled).length} 个可用 Agent`,
      )
      const items = (r.items ?? []).filter((x) => x.enabled)
      if (!items.length) {
        setRemoteAgents([])
        toast.warning('未拉到任何可用 Agent——请确认使用的是 WorkBuddy API Key，而非个人 PAT（pt_ 开头）')
        return
      }
      setRemoteAgents(items)
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setPulling(false)
    }
  }

  // 选中企业 Key 后自动拉取一次（编辑已有配置时不自动拉）
  useEffect(() => {
    if (apiKeyConfigId && !record) void pullAgents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeyConfigId])

  function pickRemote(value: string) {
    const picked = remoteAgents.find((x) => x.agentId === value)
    if (!picked) return
    setAgentId(picked.agentId)
    if (picked.agentName) setName(picked.agentName)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!agentId) return toast.error('请先从 Agent 列表中选择要绑定的 Agent')
    let parsedManifest: Record<string, unknown>
    try {
      parsedManifest = JSON.parse(manifest || '{}')
    } catch {
      return toast.error('启动 Manifest 不是合法 JSON')
    }
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/agents${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({
            id,
            apiKeyConfigId,
            agentId,
            name,
            baseUrl,
            sourceApp,
            runtimeNamePrefix,
            controlTimeoutMs: Number(controlTimeoutMs),
            promptTimeoutMs: Number(promptTimeoutMs),
            manifest: parsedManifest,
            includeThinking,
          }),
        }),
        '保存中…',
        'CloudAgent 已保存',
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
        尚未配置 WorkBuddy API Key，请先在「凭证管理」中添加后再来连接 Cloud Agent。
      </div>
    )
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>WorkBuddy API Key</Label>
        <Select value={apiKeyConfigId} onValueChange={(v) => setApiKeyConfigId(v ?? '')}>
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
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-1.5">
          <Label>Agent 列表</Label>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={pullAgents}
            disabled={pulling || !apiKeyConfigId}
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
                      disabled={Boolean(x.existingConfigId)}
                      onSelect={() => {
                        pickRemote(x.agentId)
                        setPickerOpen(false)
                      }}
                    >
                      <span className="min-w-0 truncate">{x.agentName || x.agentId}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {x.agentId}
                      </span>
                      {x.existingConfigId && (
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
          <div className="grid gap-2">
            <Label>AgentOS Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Source App</Label>
              <Input value={sourceApp} onChange={(e) => setSourceApp(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Runtime 前缀</Label>
              <Input value={runtimeNamePrefix} onChange={(e) => setRuntimeNamePrefix(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>控制超时（毫秒）</Label>
              <Input type="number" value={controlTimeoutMs} onChange={(e) => setControlTimeoutMs(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>对话超时（毫秒）</Label>
              <Input type="number" value={promptTimeoutMs} onChange={(e) => setPromptTimeoutMs(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>启动 Manifest JSON</Label>
            <Textarea
              className="min-h-24 font-mono text-xs"
              value={manifest}
              onChange={(e) => setManifest(e.target.value)}
            />
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
          <Button type="submit" disabled={saving}>
            {saving ? '保存中…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
