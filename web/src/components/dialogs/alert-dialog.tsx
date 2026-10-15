import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, Search } from 'lucide-react'

import { AdvancedSection } from '@/components/advanced-section'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { TENCENT_REGIONS, tencentRegionName } from '@/lib/tencent-regions'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, AlertIntegration, TencentAlarmPolicy } from '@/lib/types'

export function AlertDialogForm({
  open,
  record,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: AlertIntegration
  state: AdminState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [botConfigId, setBotConfigId] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const [namespace, setNamespace] = useState('cvm_device')
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState('60')
  const [policyIds, setPolicyIds] = useState<string[]>([])
  const [enabled, setEnabled] = useState(true)
  const [region, setRegion] = useState('')
  const [monitorType, setMonitorType] = useState('MT_QCE')
  const [initialLookbackSeconds, setInitialLookbackSeconds] = useState('600')
  const [overlapSeconds, setOverlapSeconds] = useState('300')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [includeRecovery, setIncludeRecovery] = useState(false)
  const [policies, setPolicies] = useState<TencentAlarmPolicy[]>([])
  const [policyQuery, setPolicyQuery] = useState('')
  const [policiesLoading, setPoliciesLoading] = useState(false)
  const [policiesError, setPoliciesError] = useState('')
  const [policyReload, setPolicyReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const initializedRecordRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      initializedRecordRef.current = null
      return
    }
    if (!state) return
    const initializationKey = record?.id ?? 'new'
    if (initializedRecordRef.current === initializationKey) return
    initializedRecordRef.current = initializationKey
    setName(record?.name ?? '')
    setBotConfigId(record?.botConfigId ?? state?.bots[0]?.id ?? '')
    setCredentialId(record?.credentialId ?? state?.tencentCredentials[0]?.id ?? '')
    setNamespace(record?.namespace ?? 'cvm_device')
    setPollIntervalSeconds(String(record?.pollIntervalSeconds ?? 60))
    setPolicyIds(record?.policyIds ?? [])
    setEnabled(record ? Boolean(record.enabled) : true)
    setRegion(record?.region ?? '')
    setMonitorType(record?.monitorType ?? 'MT_QCE')
    setInitialLookbackSeconds(String(record?.initialLookbackSeconds ?? 600))
    setOverlapSeconds(String(record?.overlapSeconds ?? 300))
    setPromptTemplate(record?.promptTemplate ?? '')
    setIncludeRecovery(Boolean(record?.includeRecovery))
    setPolicyQuery('')
  }, [open, record, state])

  useEffect(() => {
    if (!open || !credentialId || !region) {
      setPolicies([])
      setPoliciesError('')
      setPoliciesLoading(false)
      return
    }
    const controller = new AbortController()
    setPolicies([])
    setPoliciesError('')
    setPoliciesLoading(true)
    api<{ items: TencentAlarmPolicy[] }>(
      `/api/admin/tencent-credentials/${encodeURIComponent(credentialId)}/alarm-policies?region=${encodeURIComponent(region)}`,
      { signal: controller.signal },
    )
      .then((result) => setPolicies(result.items))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPoliciesError(error instanceof Error ? error.message : '告警策略加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setPoliciesLoading(false)
      })
    return () => controller.abort()
  }, [open, credentialId, region, policyReload])

  const visiblePolicies = useMemo(() => {
    const query = policyQuery.trim().toLocaleLowerCase()
    if (!query) return policies
    return policies.filter((policy) =>
      [policy.name, policy.id, policy.namespace, policy.namespaceName]
        .some((value) => value.toLocaleLowerCase().includes(query)),
    )
  }, [policies, policyQuery])

  const missingPolicyIds = policyIds.filter((id) => !policies.some((policy) => policy.id === id))

  function togglePolicy(id: string, checked: boolean) {
    setPolicyIds((current) => checked
      ? current.includes(id) || current.length >= 100 ? current : [...current, id]
      : current.filter((value) => value !== id))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/alerts${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({
            id,
            name,
            botConfigId,
            credentialId,
            namespace,
            pollIntervalSeconds: Number(pollIntervalSeconds),
            policyIds,
            enabled,
            region,
            monitorType,
            initialLookbackSeconds: Number(initialLookbackSeconds),
            overlapSeconds: Number(overlapSeconds),
            promptTemplate,
            includeRecovery,
          }),
        }),
        '保存中…',
        '告警配置已保存，请按绑定码在目标群完成绑定',
      )
      onOpenChange(false)
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>告警 RCA 配置</DialogTitle>
          <DialogDescription>
            保存后，在目标企业微信群发送页面显示的绑定指令，即可记录固定群聊。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>配置名称</Label>
              <Input required maxLength={100} placeholder="生产环境 CVM 告警" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>执行 Bot</Label>
              <Select required value={botConfigId} onValueChange={(v) => setBotConfigId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue>
                    {(v) => state?.bots.find((b) => b.id === v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(state?.bots ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>腾讯云凭证</Label>
              <Select
                required
                value={credentialId}
                onValueChange={(v) => {
                  setCredentialId(v ?? '')
                  setPolicyIds([])
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v) => state?.tencentCredentials.find((c) => c.id === v)?.name ?? '请选择凭证'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(state?.tencentCredentials ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>地域</Label>
              <Select
                required
                value={region}
                onValueChange={(v) => {
                  setRegion(v ?? '')
                  setPolicyIds([])
                }}
              >
                <SelectTrigger disabled={!credentialId}>
                  <SelectValue>
                    {(v) => v
                      ? `${tencentRegionName(String(v)) ?? '其他地域'} · ${v}`
                      : credentialId ? '请选择地域' : '请先选择凭证'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {region && !tencentRegionName(region) && (
                    <SelectItem value={region}>{region}</SelectItem>
                  )}
                  {TENCENT_REGIONS.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {item.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <Label>告警策略（可选）</Label>
                <p className="mt-1 text-xs text-muted-foreground">未选择时监控该地域下符合高级过滤条件的全部告警。</p>
              </div>
              {policyIds.length > 0 && (
                <Button type="button" variant="ghost" size="xs" onClick={() => setPolicyIds([])}>
                  清空已选（{policyIds.length}）
                </Button>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="size-4 text-muted-foreground" />
                <Input
                  className="border-0 px-0 shadow-none focus-visible:ring-0"
                  placeholder="搜索策略名称、ID 或类型"
                  value={policyQuery}
                  onChange={(e) => setPolicyQuery(e.target.value)}
                  disabled={!credentialId || !region || policiesLoading}
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {!credentialId || !region ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">选择凭证和地域后加载告警策略</div>
                ) : policiesLoading ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />正在加载告警策略…
                  </div>
                ) : policiesError ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-destructive">
                    <span>{policiesError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPolicyReload((value) => value + 1)}>
                      <RefreshCw />重试
                    </Button>
                  </div>
                ) : visiblePolicies.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {policies.length === 0 ? '该地域暂无告警策略' : '没有匹配的告警策略'}
                  </div>
                ) : (
                  visiblePolicies.map((policy) => (
                    <label key={policy.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                      <Checkbox
                        className="mt-0.5"
                        checked={policyIds.includes(policy.id)}
                        onCheckedChange={(value) => togglePolicy(policy.id, value === true)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{policy.name}</span>
                          {!policy.enabled && <span className="shrink-0 text-xs font-normal text-muted-foreground">已停用</span>}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{policy.id}</span>
                        <span className="block truncate text-xs text-muted-foreground">{policy.namespaceName}</span>
                      </span>
                    </label>
                  ))
                )}
                {!policiesLoading && missingPolicyIds.map((id) => (
                  <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted">
                    <Checkbox checked onCheckedChange={(value) => togglePolicy(id, value === true)} />
                    <span className="font-mono text-xs text-muted-foreground">{id}（当前列表中不可用）</span>
                  </label>
                ))}
              </div>
              {!policiesLoading && !policiesError && policies.length > 0 && (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  共 {policies.length} 个策略，已选择 {policyIds.length} 个（最多 100 个）
                </div>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用轮询（绑定目标群后开始执行）
          </label>

          <AdvancedSection>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Monitor Type</Label>
                  <Input value={monitorType} onChange={(e) => setMonitorType(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>策略类型 Namespace</Label>
                  <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>轮询间隔（秒）</Label>
                  <Input type="number" min={30} value={pollIntervalSeconds} onChange={(e) => setPollIntervalSeconds(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>首次回溯（秒）</Label>
                  <Input type="number" min={60} value={initialLookbackSeconds} onChange={(e) => setInitialLookbackSeconds(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>重叠窗口（秒）</Label>
                  <Input type="number" min={0} value={overlapSeconds} onChange={(e) => setOverlapSeconds(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>自定义 Prompt 模板（可选）</Label>
                <Textarea
                  placeholder="可用变量：{{alarm_json}}、{{alarm_id}}、{{alarm_object}}、{{alarm_content}}、{{policy_name}}、{{region}}"
                  value={promptTemplate}
                  onChange={(e) => setPromptTemplate(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={includeRecovery} onCheckedChange={(v) => setIncludeRecovery(v === true)} />
                同时查询恢复状态（历史接口存在时间窗口限制）
              </label>
            </div>
          </AdvancedSection>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !credentialId || !region || policiesLoading}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
