import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, AgentConfig, RemoteAgentVersion } from '@/lib/types'

function versionLabel(version: RemoteAgentVersion) {
  return `${version.versionName} · ${version.versionType} · ${version.versionId}${version.injected ? ' · 凭证注入版' : ''}${version.status !== 'ENABLED' ? '（不可用）' : ''}`
}

export function AgentVersionSettings({ credentialConfigId, agentId, state, record, value, onChange, disabled, onCreatingChange }: {
  credentialConfigId: string
  agentId: string
  state: AdminState | null
  record?: AgentConfig
  value: string
  onChange: (versionId: string) => void
  disabled: boolean
  onCreatingChange: (creating: boolean) => void
}) {
  const [versions, setVersions] = useState<RemoteAgentVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [sourceVersionId, setSourceVersionId] = useState('')
  const [runtimeCredentialId, setRuntimeCredentialId] = useState(() => record?.runtimeCredentialId ?? '')
  const [runtimeRegion, setRuntimeRegion] = useState(() => record?.runtimeRegion ?? 'ap-guangzhou')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<RemoteAgentVersion | null>(null)
  const requestVersion = useRef(0)
  const ready = Boolean(credentialConfigId && agentId)
  const selected = versions.find(version => version.versionId === value)
  const selectedSource = versions.find(version => version.versionId === sourceVersionId)

  const loadVersions = useCallback(async () => {
    if (!credentialConfigId || !agentId) return
    const request = ++requestVersion.current
    setLoading(true)
    setLoadError('')
    try {
      const result = await api<{ items: RemoteAgentVersion[] }>(`/api/admin/wma-credentials/${credentialConfigId}/versions`, {
        method: 'POST', body: JSON.stringify({ agentId }),
      })
      if (request === requestVersion.current) setVersions(result.items)
    } catch (error) {
      if (request === requestVersion.current) setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      if (request === requestVersion.current) setLoading(false)
    }
  }, [credentialConfigId, agentId])

  useEffect(() => {
    void loadVersions()
    return () => { requestVersion.current += 1 }
  }, [loadVersions])

  async function createVersion() {
    if (creating || disabled || !selectedSource || !runtimeCredentialId) return
    setCreating(true)
    onCreatingChange(true)
    try {
      const result = await toastTask(api<RemoteAgentVersion>(`/api/admin/wma-credentials/${credentialConfigId}/credential-versions`, {
        method: 'POST', body: JSON.stringify({ agentId, sourceVersionId, runtimeCredentialId, runtimeRegion }),
      }), '正在从所选源版本创建凭证注入版…', '注入版已创建，请选择使用版本并保存')
      // Invalidate any older list request that could hide the newly created entry.
      requestVersion.current += 1
      setLoading(false)
      setLoadError('')
      setVersions(previous => [result, ...previous.filter(version => version.versionId !== result.versionId)])
      setCreated(result)
    } catch {
      // toastTask displays the error. Existing selection remains intact.
    } finally {
      setCreating(false)
      onCreatingChange(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="agent-use-version">使用版本</Label>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="刷新 WMA 版本" disabled={!ready || loading || disabled} onClick={() => void loadVersions()}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} />
          </Button>
        </div>
        <Select value={value || '__route__'} disabled={!ready || disabled} onValueChange={versionId => onChange(versionId === '__route__' ? '' : versionId ?? '')}>
          <SelectTrigger id="agent-use-version"><SelectValue>{versionId => versionId === '__route__' ? '跟随 WMA 路由' : versions.find(version => version.versionId === versionId) ? versionLabel(versions.find(version => version.versionId === versionId)!) : `${record?.wmaVersionName || '固定版本'} · ${versionId}`}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="__route__">跟随 WMA 路由</SelectItem>
            {value && !selected && <SelectItem value={value}>{record?.wmaVersionName || '当前版本'} · {value}</SelectItem>}
            {versions.map(version => <SelectItem key={version.versionId} value={version.versionId} disabled={version.status !== 'ENABLED'}>{versionLabel(version)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">保存后新会话使用此版本。创建注入版不会自动切换当前使用版本。</p>
        {!ready && <p className="text-xs text-muted-foreground">请先选择 WMA Agent。</p>}
        {loadError && <p role="alert" className="text-xs text-destructive">版本加载失败：{loadError}。可点击刷新重试，已有版本选择会保留。</p>}
        {selected?.injected && <p className="text-xs text-muted-foreground">凭证：{selected.runtimeCredentialName} · {selected.runtimeRegion}{selected.sourceVersionId ? `；源版本：${selected.sourceVersionName || ''} ${selected.sourceVersionId}` : '；历史注入版'}</p>}
        {(selected?.runtimeCredentialOutdated || (value === record?.wmaVersionId && record?.runtimeCredentialOutdated)) && <p className="text-xs text-amber-700 dark:text-amber-400">该注入版的凭证已更新或删除。请创建新注入版，选择后保存。</p>}
      </div>

      <div className="grid gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">创建凭证注入版</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">选择源版本及云凭证，创建保留其提示词和技能的新版本。AK/SK 将写入 WMA 云端版本的环境配置。</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="agent-source-version">源版本</Label>
          <Select value={sourceVersionId || '__none__'} disabled={!ready || disabled || creating} onValueChange={versionId => setSourceVersionId(versionId === '__none__' ? '' : versionId ?? '')}>
            <SelectTrigger id="agent-source-version"><SelectValue>{versionId => versions.find(version => version.versionId === versionId) ? versionLabel(versions.find(version => version.versionId === versionId)!) : '选择要复制的源版本'}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">选择要复制的源版本</SelectItem>
              {versions.map(version => <SelectItem key={version.versionId} value={version.versionId} disabled={version.status !== 'ENABLED'}>{versionLabel(version)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="agent-runtime-credential">注入凭证</Label>
          <Select disabled={disabled || creating} value={runtimeCredentialId || '__none__'} onValueChange={credentialId => setRuntimeCredentialId(credentialId === '__none__' ? '' : credentialId ?? '')}>
            <SelectTrigger id="agent-runtime-credential"><SelectValue>{credentialId => state?.tencentCredentials.find(credential => credential.id === credentialId)?.name ?? '选择腾讯云凭证'}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">选择腾讯云凭证</SelectItem>
              {(state?.tencentCredentials ?? []).map(credential => <SelectItem key={credential.id} value={credential.id}>{credential.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {!state?.tencentCredentials.length && <p className="text-xs text-muted-foreground">请先在左侧「腾讯云凭证」中添加云账号凭证。</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="agent-runtime-region">云资源地域</Label>
          <Input id="agent-runtime-region" disabled={disabled || creating} value={runtimeRegion} placeholder="ap-guangzhou" onChange={event => setRuntimeRegion(event.target.value)} />
        </div>
        <Button type="button" variant="outline" disabled={!ready || disabled || creating || !selectedSource || selectedSource.status !== 'ENABLED' || !runtimeCredentialId || !/^[a-z]+-[a-z]+(?:-\d+)?$/.test(runtimeRegion)} onClick={() => void createVersion()}>
          {creating ? '创建注入版中…' : '创建凭证注入版'}
        </Button>
        {created && <div role="status" className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs">
          <p>已创建：{created.versionName} · <span className="break-all font-mono">{created.versionId}</span></p>
          <p>源版本：{created.sourceVersionName || created.sourceVersionId}；凭证：{created.runtimeCredentialName}</p>
          <p>{created.versionId === value ? '已选为待保存版本，点击保存后生效。' : '尚未切换使用版本。'}</p>
          <Button type="button" size="sm" disabled={disabled || creating || value === created.versionId} onClick={() => { onChange(created.versionId); toast.info('已选择注入版，保存后生效') }}>选择此注入版</Button>
        </div>}
      </div>
    </div>
  )
}
