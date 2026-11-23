import { useEffect, useState } from 'react'
import { ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { ApplicationIcon, CloudProductIcon } from '@/components/resource-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { tencentRegionName } from '@/lib/tencent-regions'
import type { ApmApplication, ApmPolicy, ApmPolicyDiscovery } from '@/lib/types'

const keyFor = (app: ApmApplication) => JSON.stringify([app.region, app.instanceId, app.serviceName])
type Instance = Omit<ApmApplication, 'serviceName' | 'serviceId'>

export function ApmPolicies({ policies }: { policies: ApmPolicy[] }) {
  return <div className="grid gap-2">{policies.map(policy => <details key={policy.id} className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer"><span className="font-medium">{policy.name}</span>
      <Badge variant={policy.enabled ? 'secondary' : 'outline'} className="ml-2">{policy.enabled ? '已启用' : '已停用'}</Badge>
      <span className={`ml-2 text-xs ${policy.match === 'unknown' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{policy.reason}</span>
    </summary>
    <p className="mt-2 text-xs text-muted-foreground">{policy.id} · {policy.namespace}</p>
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-3 text-xs">{JSON.stringify({ 筛选条件: policy.filter, 指标触发条件: policy.condition, 事件触发条件: policy.eventCondition, 告警对象维度: policy.groupBy }, null, 2)}</pre>
  </details>)}</div>
}

export function ArchitectureApmField({ watchId, value, onChange }: {
  watchId: string; value: ApmApplication[]; onChange: (apps: ApmApplication[]) => void
}) {
  const base = `/api/admin/architecture-watches/${watchId}`
  const [browsing, setBrowsing] = useState(false)
  const [reload, setReload] = useState(0)
  const [instance, setInstance] = useState('')
  const [search, setSearch] = useState('')
  const selection = JSON.stringify(value)
  const instanceQuery = `${base}:${reload}`, appQuery = `${instanceQuery}:${instance}`, previewQuery = `${instanceQuery}:${selection}`
  const [instanceResult, setInstanceResult] = useState<{ key: string; items: Instance[]; error: string } | null>(null)
  const [appResult, setAppResult] = useState<{ key: string; items: ApmApplication[]; error: string } | null>(null)
  const [previewResult, setPreviewResult] = useState<{ key: string; data: ApmPolicyDiscovery | null; error: string } | null>(null)
  const instances = instanceResult?.key === instanceQuery ? instanceResult.items : []
  const apps = appResult?.key === appQuery ? appResult.items : []
  const loading = browsing && (instanceResult?.key !== instanceQuery || (!!instance && appResult?.key !== appQuery))
  const error = (instanceResult?.key === instanceQuery ? instanceResult.error : '') || (appResult?.key === appQuery ? appResult.error : '')
  const preview = previewResult?.key === previewQuery ? previewResult.data : null
  const previewError = previewResult?.key === previewQuery ? previewResult.error : ''
  const previewBusy = value.length > 0 && previewResult?.key !== previewQuery
  useEffect(() => {
    if (!browsing) return
    const controller = new AbortController()
    api<{ items: Instance[] }>(`${base}/apm-instances`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setInstanceResult({ key: instanceQuery, items: result.items, error: '' }) })
      .catch(e => { if (!controller.signal.aborted) setInstanceResult({ key: instanceQuery, items: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => controller.abort()
  }, [base, browsing, instanceQuery])
  useEffect(() => {
    if (!instance) return
    const [region, instanceId] = JSON.parse(instance) as string[]
    const controller = new AbortController()
    api<{ items: ApmApplication[] }>(`${base}/apm-applications?region=${encodeURIComponent(region)}&instanceId=${encodeURIComponent(instanceId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setAppResult({ key: appQuery, items: result.items, error: '' }) })
      .catch(e => { if (!controller.signal.aborted) setAppResult({ key: appQuery, items: [], error: e instanceof Error ? e.message : String(e) }) })
    return () => controller.abort()
  }, [base, instance, appQuery])
  useEffect(() => {
    const applications = JSON.parse(selection) as ApmApplication[]
    if (!applications.length) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api<ApmPolicyDiscovery>(`${base}/apm-policies`, { method: 'POST', body: JSON.stringify({ applications }), signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setPreviewResult({ key: previewQuery, data: result, error: '' }) })
        .catch(e => { if (!controller.signal.aborted) setPreviewResult({ key: previewQuery, data: null, error: e instanceof Error ? e.message : String(e) }) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [base, selection, previewQuery])
  const selected = new Set(value.map(keyFor))
  return <section aria-labelledby="duty-apm-title" className="grid min-w-0 gap-4 rounded-lg border p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 gap-3"><CloudProductIcon product="apm" /><div>
        <div className="flex flex-wrap items-center gap-2"><h4 id="duty-apm-title" className="text-sm font-semibold">APM 应用告警</h4><Badge variant="outline">手动关联</Badge><span className="text-xs text-muted-foreground">已关联 {value.length} 个应用</span></div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">扫描所选应用的告警，独立于云资源开关；每次检查自动更新关联策略。</p>
      </div></div>
      <div className="flex gap-2"><Button type="button" size="sm" variant="outline" aria-expanded={browsing} aria-controls="duty-apm-picker" onClick={() => { setBrowsing(v => !v); setInstance(''); setSearch(''); setReload(v => v + 1) }}>{browsing ? <ChevronDown /> : <Plus />}{browsing ? '收起应用选择' : '添加 APM 应用'}</Button>
        {(browsing || value.length > 0) && <Button type="button" size="sm" variant="ghost" onClick={() => { setReload(v => v + 1); setInstance(''); setSearch('') }}><RefreshCw />刷新 APM</Button>}</div>
    </div>
    {browsing && <div id="duty-apm-picker" className="grid gap-3 rounded-md bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">使用当前架构图的腾讯云凭证，先选择业务系统，再勾选应用。</p>
      <label className="grid gap-2 text-sm">APM 业务系统
        <select aria-label="APM 业务系统" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={instance} onChange={e => { setInstance(e.target.value); setSearch('') }}>
          <option value="">请选择业务系统</option>{instances.map(item => <option key={`${item.region}/${item.instanceId}`} value={JSON.stringify([item.region, item.instanceId])}>{item.instanceName} · {tencentRegionName(item.region) || item.region} · {item.instanceId}</option>)}
        </select>
      </label>
      {loading && <p role="status" className="text-sm text-muted-foreground">正在读取 APM…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && !instances.length && <p className="text-sm text-muted-foreground">此凭证下没有可访问的 APM 业务系统。</p>}
      {instance && !loading && !error && <>
        <Input aria-label="搜索 APM 应用" placeholder="搜索应用名称" value={search} onChange={e => setSearch(e.target.value)} />
        <p className="text-xs text-muted-foreground">按近 7 天的应用维度读取；已保存的关联会继续保留。</p>
        {!apps.length ? <p className="text-sm text-muted-foreground">该业务系统暂未返回应用，请确认应用接入和上报情况。</p> : <div className="grid max-h-60 gap-2 overflow-y-auto">
          {apps.filter(app => app.serviceName.toLowerCase().includes(search.toLowerCase())).map(app => <label key={keyFor(app)} className="flex cursor-pointer items-center gap-3 rounded p-2 text-sm hover:bg-muted">
            <input type="checkbox" aria-label={`关联 ${app.serviceName}`} checked={selected.has(keyFor(app))} disabled={!selected.has(keyFor(app)) && value.length >= 100}
              onChange={e => onChange(e.target.checked ? [...value, app] : value.filter(item => keyFor(item) !== keyFor(app)))} />
            <ApplicationIcon compact /><span className="break-all">{app.serviceName}</span>
          </label>)}
        </div>}
      </>}
    </div>}
    {!value.length ? <div className="rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground"><p>未关联 APM 应用。</p><p className="mt-1 text-xs">添加应用后，其告警将按统一值守设置检查并推送。</p></div> : <div className="grid gap-3">
      {value.map(app => {
        const policies = preview?.items.find(item => keyFor(item) === keyFor(app))?.policies || []
        const enabled = policies.filter(policy => policy.enabled).length
        const unknown = policies.filter(policy => policy.match === 'unknown').length
        return <div key={keyFor(app)} className="min-w-0 rounded-md border">
        <div className="flex items-start justify-between gap-3 p-3"><div className="flex min-w-0 items-start gap-3"><ApplicationIcon /><div className="min-w-0"><p className="break-all text-sm font-medium">{app.serviceName}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{app.instanceName || app.instanceId} · {app.instanceId} · {tencentRegionName(app.region) || app.region}</p></div></div>
          <Button type="button" variant="ghost" size="sm" aria-label={`移除 ${app.serviceName}`} onClick={() => onChange(value.filter(item => keyFor(item) !== keyFor(app)))}>移除</Button></div>
        {preview && <details className="group border-t">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
            <span className="font-medium">关联策略：{policies.length} 条</span>
            <span className="text-muted-foreground">已启用 {enabled} · 已停用 {policies.length - enabled}</span>
            {unknown > 0 && <span className="text-amber-700 dark:text-amber-300">{unknown} 条待核对</span>}
            <ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-3 border-t p-3">
            <p className="text-xs text-muted-foreground">以下为腾讯云策略配置，仅供查看。策略启停与条件需在腾讯云修改。</p>
            {policies.length ? <ApmPolicies policies={policies} /> : <p className="text-xs text-muted-foreground">暂未发现相关策略；每次检查会重新查询。</p>}
          </div>
        </details>}
      </div>})}
      {previewBusy && <p role="status" className="text-sm text-muted-foreground">正在查找应用关联的告警策略…</p>}
      {previewError && <p role="alert" className="text-sm text-destructive">策略查询失败，无法确认覆盖范围：{previewError}</p>}
      {preview && !preview.complete && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">部分策略包含暂无法判定的条件，已列出供核对。告警仍按实际业务系统和应用标识匹配。</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">仅纳入能确认属于所选应用的告警，无法确定归属的记录会在检查结果中提示。</p>
    </div>}
  </section>
}
