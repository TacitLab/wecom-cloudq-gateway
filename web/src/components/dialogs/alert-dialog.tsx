import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, ArrowRight, Check, FileText, LoaderCircle, RefreshCw, Search, Server } from 'lucide-react'

import { AdvancedSection } from '@/components/advanced-section'
import { AlertPromptField } from '@/components/forms/alert-prompt-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { ALERT_SOURCES, alertSourceName } from '@/lib/alert-sources'
import { TENCENT_REGIONS, tencentRegionName } from '@/lib/tencent-regions'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, AlertIntegration, TencentAlarmPolicy } from '@/lib/types'

const steps = ['告警来源', '监控范围', '诊断与推送', '确认配置']
const sourceIcons = [Server, Activity, FileText]

export function AlertDialogForm({ open, record, state, onOpenChange, onSaved }: {
  open: boolean
  record?: AlertIntegration
  state: AdminState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [botConfigId, setBotConfigId] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const [diagnosticCredentialId, setDiagnosticCredentialId] = useState('')
  const [namespace, setNamespace] = useState('')
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState('60')
  const [policyIds, setPolicyIds] = useState<string[]>([])
  const [policyScope, setPolicyScope] = useState<'selected' | 'all'>('selected')
  const [enabled, setEnabled] = useState(true)
  const [region, setRegion] = useState('')
  const [monitorType, setMonitorType] = useState('MT_QCE')
  const [initialLookbackSeconds, setInitialLookbackSeconds] = useState('600')
  const [overlapSeconds, setOverlapSeconds] = useState('300')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [promptCustomized, setPromptCustomized] = useState(false)
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
    setStep(0)
    setName(record?.name ?? '')
    setBotConfigId(record?.botConfigId ?? state.bots[0]?.id ?? '')
    setCredentialId(record?.credentialId ?? state.tencentCredentials[0]?.id ?? '')
    setDiagnosticCredentialId(record?.diagnosticCredentialId ?? '')
    setNamespace(record?.namespace ?? '')
    setPollIntervalSeconds(String(record?.pollIntervalSeconds ?? 60))
    setPolicyIds(record?.policyIds ?? [])
    setPolicyScope(record && !record.policyIds.length ? 'all' : 'selected')
    setEnabled(record ? Boolean(record.enabled) : true)
    setRegion(record?.region ?? '')
    setMonitorType(record?.monitorType ?? 'MT_QCE')
    setInitialLookbackSeconds(String(record?.initialLookbackSeconds ?? 600))
    setOverlapSeconds(String(record?.overlapSeconds ?? 300))
    setPromptTemplate(record?.promptTemplate ?? '')
    setPromptCustomized(Boolean(record?.promptTemplate))
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
    const query = new URLSearchParams({ region, monitorType })
    api<{ items: TencentAlarmPolicy[] }>(
      `/api/admin/tencent-credentials/${encodeURIComponent(credentialId)}/alarm-policies?${query}`,
      { signal: controller.signal },
    )
      .then((result) => { if (!controller.signal.aborted) setPolicies(result.items) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPoliciesError(error instanceof Error ? error.message : '告警策略加载失败')
      })
      .finally(() => { if (!controller.signal.aborted) setPoliciesLoading(false) })
    return () => controller.abort()
  }, [open, credentialId, region, monitorType, policyReload])

  const visiblePolicies = useMemo(() => {
    const query = policyQuery.trim().toLocaleLowerCase()
    return policies.filter((policy) => !query || [policy.name, policy.id, policy.namespace, policy.namespaceName]
      .some((value) => value.toLocaleLowerCase().includes(query)))
  }, [policies, policyQuery])
  const namespaces = useMemo(() => [...new Map(policies.filter((p) => p.namespace)
    .map((p) => [p.namespace, p.namespaceName])).entries()], [policies])
  const missingPolicyIds = policyIds.filter((id) => !policies.some((policy) => policy.id === id))
  const sourceName = alertSourceName(monitorType)
  const selectedBot = state?.bots.find((bot) => bot.id === botConfigId)
  const keepsBinding = Boolean(record?.targetChatId && record.botConfigId === botConfigId)
  const scopeSummary = policyScope === 'selected' ? `指定 ${policyIds.length} 个策略` : namespace
    ? `全部策略 · ${namespaces.find(([id]) => id === namespace)?.[1] ?? namespace}` : '该来源下的全部策略'
  const timingSettingsValid = [[pollIntervalSeconds, 30], [initialLookbackSeconds, 60], [overlapSeconds, 0]]
    .every(([value, minimum]) => String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= Number(minimum))
  const settingsValid = Boolean(name.trim() && botConfigId && timingSettingsValid)
  const canContinue = step === 0 ? Boolean(credentialId && region) : step === 1
    ? policyScope === 'all' || policyIds.length > 0 : settingsValid
  const diagnosticCredentialName = diagnosticCredentialId
    ? state?.tencentCredentials.find((credential) => credential.id === diagnosticCredentialId)?.name ?? record?.diagnosticCredentialName ?? '所选凭证不可用'
    : '不嵌入，使用 Agent 已有环境'
  const customPromptActive = Boolean(promptTemplate.trim())

  function resetPolicies() {
    setPolicyIds([])
    setNamespace('')
    setPolicyQuery('')
    setPolicies([])
    setPoliciesError('')
  }

  function togglePolicy(id: string, checked: boolean) {
    setPolicyIds((current) => checked
      ? current.includes(id) || current.length >= 100 ? current : [...current, id]
      : current.filter((value) => value !== id))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canContinue || saving) return
    if (step < steps.length - 1) {
      setStep(step + 1)
      return
    }
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(api(`/api/admin/alerts${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          id, name, botConfigId, credentialId, diagnosticCredentialId: diagnosticCredentialId || null, region, monitorType, policyScope,
          namespace: policyScope === 'all' ? namespace : '',
          policyIds: policyScope === 'selected' ? policyIds : [],
          pollIntervalSeconds: Number(pollIntervalSeconds), enabled,
          initialLookbackSeconds: Number(initialLookbackSeconds), overlapSeconds: Number(overlapSeconds),
          promptTemplate, includeRecovery,
        }),
      }), '保存中…', keepsBinding ? '告警配置已更新' : '配置已保存，请在目标群发送绑定指令')
      onOpenChange(false)
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value) }}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{record ? '编辑告警 RCA' : '新增告警 RCA'}</DialogTitle>
          <DialogDescription>选择需要诊断的告警，由 Bot 绑定的 Agent 分析并推送到企业微信群。</DialogDescription>
        </DialogHeader>
        <ol aria-label="配置步骤" className="grid grid-cols-4 gap-1 border-b pb-4 sm:gap-2">
          {steps.map((label, index) => (
            <li key={label}>
              <button type="button" disabled={index > step || saving} onClick={() => setStep(index)}
                aria-current={index === step ? 'step' : undefined}
                className={`flex w-full flex-col items-center gap-1.5 text-[11px] disabled:cursor-default sm:flex-row sm:gap-2 sm:text-sm ${index === step ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${index === step ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {index < step ? <Check className="size-3.5" /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 overflow-y-auto px-0.5" key={step}>
            <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5 pb-1">
              {step === 0 && <>
                <div>
                  <h3 className="text-base font-medium">先选择告警来自哪里</h3>
                  <p className="mt-1 text-sm text-muted-foreground">一条配置对应一种告警来源，策略列表和轮询范围会随之切换。</p>
                </div>
                <div role="radiogroup" aria-label="告警来源" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {ALERT_SOURCES.map((source, index) => {
                    const Icon = sourceIcons[index]
                    return <label key={source.id} className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 has-focus-visible:ring-2 has-focus-visible:ring-ring ${monitorType === source.id ? 'border-primary bg-muted/60' : 'hover:bg-muted/40'}`}>
                      <input type="radio" name="alert-source" value={source.id} checked={monitorType === source.id}
                        className="sr-only" onChange={() => { setMonitorType(source.id); resetPolicies() }} />
                      <div className="flex items-center justify-between"><Icon className="size-4 text-muted-foreground" />
                        {monitorType === source.id && <Check className="size-4" />}</div>
                      <span className="text-sm font-medium">{source.name}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">{source.description}</span>
                    </label>
                  })}
                </div>
                {!ALERT_SOURCES.some((source) => source.id === monitorType) && <p className="text-sm text-muted-foreground">当前配置使用其他来源：{monitorType}。保留此来源，或选择上方来源重新配置。</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="alert-credential">腾讯云凭证</Label>
                    <Select required value={credentialId} onValueChange={(value) => { setCredentialId(value ?? ''); resetPolicies() }}>
                      <SelectTrigger id="alert-credential"><SelectValue>{(v) => state?.tencentCredentials.find((c) => c.id === v)?.name ?? '请选择凭证'}</SelectValue></SelectTrigger>
                      <SelectContent>{(state?.tencentCredentials ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="alert-region">地域</Label>
                    <Select required value={region} onValueChange={(value) => { setRegion(value ?? ''); resetPolicies() }}>
                      <SelectTrigger id="alert-region" disabled={!credentialId}><SelectValue>{(v) => v ? `${tencentRegionName(String(v)) ?? '其他地域'} · ${v}` : '请选择告警所在地域'}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {region && !tencentRegionName(region) && <SelectItem value={region}>{region}</SelectItem>}
                        {TENCENT_REGIONS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.id}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{monitorType === 'MT_CLS'
                  ? '凭证需具备 CLS 告警策略及告警历史读取权限。选择日志主题所在地域。'
                  : '凭证需具备 Monitor 告警策略及告警历史读取权限。选择监控资源所在地域。'}</p>
              </>}

              {step === 1 && <>
                <div>
                  <h3 className="text-base font-medium">哪些告警需要自动诊断？</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{sourceName} · {tencentRegionName(region) ?? region}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="监控范围">
                  {(['selected', 'all'] as const).map((scope) => <label key={scope} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${policyScope === scope ? 'border-primary bg-muted/60' : ''}`}>
                    <input type="radio" name="policy-scope" className="mt-1 accent-current" checked={policyScope === scope}
                      onChange={() => { setPolicyScope(scope); setPolicyIds([]) }} />
                    <span><span className="block text-sm font-medium">{scope === 'selected' ? '指定告警策略' : '全部符合条件的策略'}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{scope === 'selected' ? '只处理选中策略产生的告警。' : '包含以后新增的策略，按来源和地域持续监控。'}</span></span>
                  </label>)}
                </div>
                {policyScope === 'all' ? <div className="grid gap-3">
                  {monitorType !== 'MT_CLS' && <div className="grid gap-2">
                    <Label htmlFor="alert-namespace">策略类型</Label>
                    <Select value={namespace || '__all__'} onValueChange={(v) => setNamespace(v === '__all__' ? '' : v ?? '')}>
                      <SelectTrigger id="alert-namespace"><SelectValue>{(v) => v === '__all__' ? '全部策略类型' : namespaces.find(([id]) => id === v)?.[1] ?? v}</SelectValue></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部策略类型</SelectItem>
                        {namespace && !namespaces.some(([id]) => id === namespace) && <SelectItem value={namespace}>{namespace}</SelectItem>}
                        {namespaces.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>}
                  <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">
                    将处理{tencentRegionName(region) ?? region}的{sourceName}告警{namespace ? `（${namespaces.find(([id]) => id === namespace)?.[1] ?? namespace}）` : '，包含所有策略类型'}。每条新告警都会触发一次独立 RCA。
                  </div>
                  {policiesError && <p role="status" className="text-xs text-muted-foreground">策略预览加载失败，仍可保存全部策略范围。{policiesError}</p>}
                </div> : <div className="overflow-hidden rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <Input aria-label="搜索告警策略" className="border-0 px-0 shadow-none focus-visible:ring-0" placeholder="搜索策略名称、ID 或类型" value={policyQuery} onChange={(e) => setPolicyQuery(e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" aria-label="刷新告警策略" disabled={policiesLoading} onClick={() => setPolicyReload((v) => v + 1)}><RefreshCw className={policiesLoading ? 'animate-spin' : ''} /></Button>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1" aria-busy={policiesLoading}>
                    {policiesLoading ? <div role="status" className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载{sourceName}策略…</div>
                      : policiesError ? <div role="alert" className="px-3 py-6 text-sm text-destructive">{policiesError}</div>
                      : visiblePolicies.length === 0 ? <div className="px-3 py-8 text-center text-sm text-muted-foreground">{policies.length ? '没有匹配的告警策略' : '当前来源和地域下暂无策略，请检查地域、凭证权限或先在腾讯云创建策略。'}</div>
                      : visiblePolicies.map((policy) => <label key={policy.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                        <Checkbox className="mt-0.5" checked={policyIds.includes(policy.id)} disabled={!policyIds.includes(policy.id) && policyIds.length >= 100} onCheckedChange={(v) => togglePolicy(policy.id, v === true)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{policy.name}</span>{!policy.enabled && <span className="shrink-0 text-xs font-normal text-muted-foreground">已停用</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">{policy.namespaceName}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">{policy.id}</span>
                        </span>
                      </label>)}
                    {!policiesLoading && missingPolicyIds.map((id) => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted">
                      <Checkbox checked onCheckedChange={(v) => togglePolicy(id, v === true)} />
                      <span className="break-all text-xs text-muted-foreground">{id}（当前列表中不可用，可取消选择）</span>
                    </label>)}
                  </div>
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <span>共 {policies.length} 个策略 · 已选 {policyIds.length} / 100</span>
                    {policyIds.length > 0 && <Button type="button" variant="ghost" size="xs" onClick={() => setPolicyIds([])}>清空已选</Button>}
                  </div>
                </div>}
                {policyScope === 'selected' && policyIds.length === 0 && <p role="status" className="text-xs text-muted-foreground">请至少选择一个策略，或切换为“全部符合条件的策略”。</p>}
              </>}

              {step === 2 && <>
                <div>
                  <h3 className="text-base font-medium">设置诊断与结果推送</h3>
                  <p className="mt-1 text-sm text-muted-foreground">每条新告警创建独立诊断会话，结果推送到绑定的企业微信群。</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2"><Label htmlFor="alert-name">配置名称</Label><Input id="alert-name" required maxLength={100} placeholder={`生产环境 · ${sourceName}`} value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="grid gap-2"><Label htmlFor="alert-bot">执行 Bot</Label>
                    <Select required value={botConfigId} onValueChange={(v) => setBotConfigId(v ?? '')}>
                      <SelectTrigger id="alert-bot"><SelectValue>{(v) => state?.bots.find((b) => b.id === v)?.name ?? '请选择 Bot'}</SelectValue></SelectTrigger>
                      <SelectContent>{(state?.bots ?? []).map((bot) => <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2"><Label htmlFor="alert-interval">轮询间隔（秒）</Label><Input id="alert-interval" type="number" required min={30} value={pollIntervalSeconds} onChange={(e) => setPollIntervalSeconds(e.target.value)} /><p className="text-xs text-muted-foreground">默认每 60 秒检查一次，只对未处理的新告警执行 RCA。</p></div>
                <div className="grid gap-2">
                  <Label htmlFor="alert-diagnostic-credential">CloudQ 诊断凭证（可选）</Label>
                  <Select value={diagnosticCredentialId || '__none__'} onValueChange={(value) => setDiagnosticCredentialId(value === '__none__' ? '' : value ?? '')}>
                    <SelectTrigger id="alert-diagnostic-credential" aria-describedby="alert-diagnostic-credential-hint">
                      <SelectValue>{(value) => value === '__none__' ? '不嵌入凭证，使用 Agent 已有环境'
                        : state?.tencentCredentials.find((credential) => credential.id === value)?.name ?? record?.diagnosticCredentialName ?? '请选择凭证'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">不嵌入凭证，使用 Agent 已有环境</SelectItem>
                      {(state?.tencentCredentials ?? []).map((credential) => <SelectItem key={credential.id} value={credential.id}>{credential.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p id="alert-diagnostic-credential-hint" className="text-xs leading-relaxed text-muted-foreground">
                    可与拉取告警的凭证不同。仅在实际执行时追加凭证，供 CloudQ 设置环境变量；Prompt 编辑框和本地诊断记录不包含追加的密钥正文。
                  </p>
                  {diagnosticCredentialId && <p className="text-xs leading-relaxed text-muted-foreground">
                    所选凭证将随诊断请求发送给 Agent，可能保留在云端会话中。每次诊断读取凭证的最新值。
                  </p>}
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />{keepsBinding ? '启用自动轮询' : '绑定目标群后启用自动轮询'}</label>
                <p className="text-xs leading-relaxed text-muted-foreground">{keepsBinding
                  ? `推送到 ${record?.targetChatName || '已绑定企业微信群'}。`
                  : `${record?.targetChatId ? '更换 Bot 后需重新绑定目标群。' : ''}保存后获取绑定指令，在目标企业微信群发送后才会开始自动轮询。`}</p>
                {!timingSettingsValid && <p role="alert" className="text-xs text-destructive">请检查轮询间隔、首次回溯和重叠窗口，分别填写不小于 30、60、0 的整数。</p>}
                <AdvancedSection>
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2"><Label htmlFor="alert-lookback">首次回溯（秒）</Label><Input id="alert-lookback" type="number" required min={60} value={initialLookbackSeconds} onChange={(e) => setInitialLookbackSeconds(e.target.value)} /></div>
                      <div className="grid gap-2"><Label htmlFor="alert-overlap">重叠窗口（秒）</Label><Input id="alert-overlap" type="number" required min={0} value={overlapSeconds} onChange={(e) => setOverlapSeconds(e.target.value)} /></div>
                    </div>
                    <p className="text-xs text-muted-foreground">首次启用或更改监控范围后，默认回溯最近 10 分钟。重叠窗口内的重复告警会自动去重。</p>
                    <AlertPromptField
                      monitorType={monitorType}
                      value={promptTemplate}
                      useDefault={!promptCustomized}
                      onChange={(value) => { setPromptTemplate(value); setPromptCustomized(true) }}
                      onRestore={() => { setPromptTemplate(''); setPromptCustomized(false) }}
                    />
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeRecovery} onCheckedChange={(v) => setIncludeRecovery(v === true)} />同时处理恢复状态</label>
                    <p className="text-xs text-muted-foreground">历史查询受时间窗口限制，较早发生、近期恢复的告警可能无法覆盖。</p>
                  </div>
                </AdvancedSection>
              </>}
              {step === 3 && <>
                <div>
                  <h3 className="text-base font-medium">确认配置后保存</h3>
                  <p className="mt-1 text-sm text-muted-foreground">核对告警范围、诊断与推送设置。需要调整时，可返回对应步骤修改。</p>
                </div>
                <section aria-label="告警来源与范围预览" className="rounded-lg border p-4 text-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-medium">告警来源与范围</h4>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="xs" onClick={() => setStep(0)}>修改告警来源</Button>
                      <Button type="button" variant="ghost" size="xs" onClick={() => setStep(1)}>修改监控范围</Button>
                    </div>
                  </div>
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt className="text-muted-foreground">告警来源</dt><dd>{sourceName}</dd>
                    <dt className="text-muted-foreground">查询凭证</dt><dd>{state?.tencentCredentials.find((credential) => credential.id === credentialId)?.name ?? record?.credentialName ?? '所选凭证不可用'}</dd>
                    <dt className="text-muted-foreground">地域</dt><dd>{tencentRegionName(region) ?? region} · {region}</dd>
                    <dt className="text-muted-foreground">监控范围</dt><dd>{scopeSummary}</dd>
                  </dl>
                  {policyScope === 'selected' && <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto border-t pt-3">
                    {policyIds.map((id) => <li key={id}>
                      <span className="block">{policies.find((policy) => policy.id === id)?.name ?? '策略名称暂不可用'}</span>
                      <span className="break-all font-mono text-xs text-muted-foreground">{id}</span>
                    </li>)}
                  </ul>}
                </section>
                <section aria-label="诊断与推送预览" className="rounded-lg border p-4 text-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="font-medium">诊断与推送</h4>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setStep(2)}>修改诊断与推送</Button>
                  </div>
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt className="text-muted-foreground">配置名称</dt><dd className="break-words">{name}</dd>
                    <dt className="text-muted-foreground">执行 Bot</dt><dd>{selectedBot?.name}</dd>
                    <dt className="text-muted-foreground">诊断 Agent</dt><dd>{selectedBot?.agentName}</dd>
                    <dt className="text-muted-foreground">轮询间隔</dt><dd>每 {pollIntervalSeconds} 秒</dd>
                    <dt className="text-muted-foreground">运行状态</dt><dd>{enabled ? keepsBinding ? '保存后启用自动轮询' : '绑定目标群后启用自动轮询' : '已暂停自动轮询'}</dd>
                    <dt className="text-muted-foreground">推送目标</dt><dd>{keepsBinding ? record?.targetChatName || '已绑定企业微信群' : '保存后绑定企业微信群'}</dd>
                    <dt className="text-muted-foreground">CloudQ 凭证</dt><dd>{diagnosticCredentialName}</dd>
                  </dl>
                  {!keepsBinding && <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">{record?.targetChatId ? '更换 Bot 后需重新绑定目标群。' : ''}保存后，将所选 Bot 加入目标群并发送页面上的 /bind-alert 指令完成绑定。</p>}
                  {diagnosticCredentialId && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">诊断凭证仅在执行时追加到 Agent 请求中，预览不显示密钥。凭证可能保留在云端会话中。</p>}
                </section>
                <section aria-label="高级设置预览" className="rounded-lg border p-4 text-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="font-medium">高级设置</h4>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setStep(2)}>修改高级设置</Button>
                  </div>
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt className="text-muted-foreground">首次回溯</dt><dd>{initialLookbackSeconds} 秒</dd>
                    <dt className="text-muted-foreground">重叠窗口</dt><dd>{overlapSeconds} 秒</dd>
                    <dt className="text-muted-foreground">恢复状态</dt><dd>{includeRecovery ? '同时处理' : '仅处理告警状态'}</dd>
                    <dt className="text-muted-foreground">诊断 Prompt</dt><dd>{customPromptActive ? '自定义模板' : '系统默认模板'}</dd>
                  </dl>
                  {customPromptActive && <details className="mt-3 border-t pt-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">查看自定义 Prompt</summary>
                    <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">{promptTemplate}</pre>
                  </details>}
                </section>
              </>}
            </fieldset>
          </div>
          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" disabled={saving} onClick={() => step > 0 ? setStep(step - 1) : onOpenChange(false)}>{step > 0 && <ArrowLeft />}{step > 0 ? '上一步' : '取消'}</Button>
            <Button type="submit" disabled={saving || !canContinue}>{saving ? <><LoaderCircle className="animate-spin" />保存中…</> : step < steps.length - 1 ? <>{step === 2 ? '预览配置' : '下一步'}<ArrowRight /></> : keepsBinding ? '保存配置' : '保存并获取绑定指令'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
