import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Cloud, Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import type { AdminState, ArchitectureDetail, ArchitectureDutySettings, ProductDuty } from '@/lib/types'
import { ArchitectureApmField } from '@/components/forms/architecture-apm-field'
import { CloudProductIcon } from '@/components/resource-icon'

export function DutySwitch({ checked, onChange, label, disabled = false }: {
  checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
    <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : ''}`} />
  </button>
}

function initialSettings(detail: ArchitectureDetail): ArchitectureDutySettings {
  const settings = structuredClone(detail.settings)
  for (const product of detail.products) settings.products[product.id] ??= {
    enabled: true, alarms: true, metrics: product.capacitySupported, resourceIds: [],
  }
  return settings
}

export function ArchitectureDutyForm({ detail, state, onSaved }: {
  detail: ArchitectureDetail; state: AdminState | null; onSaved: (settings: ArchitectureDutySettings) => void
}) {
  const [draft, setDraft] = useState(() => initialSettings(detail))
  const [editing, setEditing] = useState<string | null>(null)
  const [scopeInput, setScopeInput] = useState('')
  const [scopeError, setScopeError] = useState('')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)
  const base = `/api/admin/architecture-watches/${detail.watch.id}`
  const actual = detail.settings
  const botChanged = draft.botConfigId !== actual.botConfigId
  function patchProduct(id: string, patch: Partial<ProductDuty>) {
    setDraft(current => ({ ...current, products: { ...current.products, [id]: { ...current.products[id], ...patch } } }))
  }
  async function action(path: string, success: string) {
    setActing(true)
    try {
      const result = await api<{ skipped?: boolean; reason?: string }>(`${base}/${path}`, { method: 'POST', body: '{}' })
      if (result.skipped) toast.info(result.reason)
      else toast.success(success)
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setActing(false) }
  }
  return (
    <form className="flex flex-col gap-6" onSubmit={async e => {
      e.preventDefault(); setSaving(true)
      try {
        const next = await api<ArchitectureDutySettings>(`${base}/settings`, { method: 'PUT', body: JSON.stringify({ ...draft, enabled: actual.enabled }) })
        setDraft(next); onSaved(next); toast.success(next.enabled && !next.targetChatId ? '设置已保存，请到目标群发送绑定指令后开始值守' : '值守设置已保存')
      } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
      finally { setSaving(false) }
    }}>
      <fieldset disabled={saving} className="flex flex-col gap-6 disabled:opacity-60">
        <section aria-labelledby="duty-common-title" className="min-w-0 rounded-lg border">
          <div className="border-b bg-muted/30 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2"><h3 id="duty-common-title" className="font-semibold">统一值守设置</h3><Badge variant="secondary">云资源与 APM 共用</Badge></div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">两类监测范围共用以下时间、推送群和 RCA 设置。整体启停由页面上方的「架构值守」开关控制。</p>
          </div>
          <div className="grid min-w-0 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="grid min-w-0 content-start gap-4 p-4 sm:p-5">
          <h4 className="text-sm font-medium">群推送与 RCA 分析</h4>
          <div className="grid gap-2"><Label htmlFor="duty-bot">推送 Bot</Label>
            <Select value={draft.botConfigId || '__none__'} onValueChange={value => setDraft({ ...draft, botConfigId: value === '__none__' ? '' : value ?? '' })}>
              <SelectTrigger id="duty-bot"><SelectValue>{value => state?.bots.find(b => b.id === value)?.name || '请选择推送 Bot'}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="__none__">请选择推送 Bot</SelectItem>{state?.bots.filter(b => b.enabled && b.agentConfigId).map(bot => <SelectItem key={bot.id} value={bot.id}>{bot.name} · {bot.agentName}</SelectItem>)}</SelectContent>
            </Select>
            {!state?.bots.some(b => b.enabled && b.agentConfigId) && <p className="text-xs text-muted-foreground">请先配置已启用且绑定 Agent 的企业微信 Bot。</p>}
          </div>
          <div className="flex items-center justify-between gap-3"><div><Label>开启 RCA 分析</Label><p className="mt-1 text-xs text-muted-foreground">先推送事件，再由所选 Bot 绑定的 Agent 分析并推送结论。恢复事件仅推送恢复通知。</p></div>
            <DutySwitch label="开启 RCA 分析" checked={draft.rcaEnabled} onChange={rcaEnabled => setDraft({ ...draft, rcaEnabled })} /></div>
          {draft.rcaEnabled && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">RCA 运行环境与凭证说明</summary><p className="mt-2 leading-relaxed">RCA 使用所选 Bot 绑定 Agent 的使用版本和运行环境；云资源凭证请在 WMA Agent 的凭证注入版中配置。</p></details>}
          <div className="min-w-0 rounded-md bg-muted/40 p-3 text-sm">
            {botChanged ? <p>保存新 Bot 后生成群绑定指令。</p> : actual.targetChatId ? <div className="grid gap-3"><div><p className="text-xs text-muted-foreground">已绑定推送群</p><p className="mt-1 break-all">{actual.targetChatName || actual.targetChatId}</p></div>
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={acting} onClick={() => void action('test-push', '测试消息已推送到值守群')}>测试群推送</Button>
                <Button type="button" variant="outline" size="sm" disabled={acting || !actual.enabled} onClick={() => void action('check', '检查已完成，请在历史记录查看结果')}>立即检查</Button>
                <Button type="button" variant="ghost" size="sm" disabled={acting} onClick={async () => {
                  try { const next = await api<ArchitectureDutySettings>(`${base}/unbind`, { method: 'POST', body: '{}' }); setDraft(next); onSaved(next); toast.success('已解除群绑定并暂停值守') }
                  catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
                }}>解除群绑定</Button></div>
            </div> : actual.botConfigId ? <div className="grid gap-2"><p>将所选 Bot 加入目标企业微信群，@Bot 并发送：</p>
              <div className="flex gap-2"><Input readOnly aria-label="值守群绑定指令" className="font-mono" value={`/bind-watch ${actual.bindCode}`} onFocus={e => e.target.select()} />
                <Button type="button" variant="outline" onClick={async () => { if (await copyText(`/bind-watch ${actual.bindCode}`)) toast.success('绑定指令已复制'); else toast.info('请手动选择并复制绑定指令') }}>复制</Button></div>
              <p className="text-xs text-muted-foreground">群绑定成功后本页会自动更新。开启值守且在值守时段内时开始检查。</p>
            </div> : <p>选择 Bot 并保存后，生成目标群绑定指令。</p>}
          </div>
          </div>
          <div className="grid min-w-0 content-start gap-4 p-4 sm:p-5">
          <div><h4 className="text-sm font-medium">值守时间与检查间隔</h4><p className="mt-1 text-xs text-muted-foreground">北京时间（Asia/Shanghai）</p></div>
          <div className="flex flex-wrap items-center gap-3"><DutySwitch label="全天值守" checked={draft.schedule.allDay} onChange={allDay => setDraft({ ...draft, schedule: { ...draft.schedule, allDay } })} /><span className="text-sm">全天值守</span>
            {!draft.schedule.allDay && <><Input className="w-32" type="time" aria-label="值守开始时间" value={draft.schedule.start} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, start: e.target.value } })} />
              <span>至</span><Input className="w-32" type="time" aria-label="值守结束时间" value={draft.schedule.end} onChange={e => setDraft({ ...draft, schedule: { ...draft.schedule, end: e.target.value } })} /><span className="text-xs text-muted-foreground">支持跨午夜</span></>}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="值守星期">{['日', '一', '二', '三', '四', '五', '六'].map((day, index) => <button key={day} type="button" aria-pressed={draft.schedule.days.includes(index)} className={`cursor-pointer rounded border px-3 py-1.5 text-sm ${draft.schedule.days.includes(index) ? 'border-primary bg-primary/10 text-primary' : ''}`}
            onClick={() => setDraft({ ...draft, schedule: { ...draft.schedule, days: draft.schedule.days.includes(index) ? draft.schedule.days.filter(d => d !== index) : [...draft.schedule.days, index] } })}>周{day}</button>)}</div>
          <div className="max-w-48">
            <div className="grid gap-2"><Label htmlFor="duty-interval">检查间隔（秒）</Label><Input id="duty-interval" type="number" min={30} max={3600} required value={draft.pollIntervalSeconds} onChange={e => setDraft({ ...draft, pollIntervalSeconds: Number(e.target.value) })} /></div>
          </div>
          </div>
          </div>
        </section>
        <div className="grid min-w-0 gap-4">
          <div><h3 className="font-semibold">监测范围</h3><p className="mt-1 text-xs text-muted-foreground">云资源与 APM 应用分别配置，可只启用其中一类，也可同时值守。</p></div>
        <section aria-labelledby="duty-cloud-title" className="min-w-0 rounded-lg border">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
            <div className="flex min-w-0 gap-3"><span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><Cloud className="size-5" /></span><div>
              <div className="flex flex-wrap items-center gap-2"><h4 id="duty-cloud-title" className="text-sm font-semibold">云资源监测</h4><Badge variant="outline">来自架构图</Badge></div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">下表仅控制云资源。每行先选择资源范围、纳入值守，再设置告警推送与容量监测。</p>
            </div></div>
            <p className="text-xs text-muted-foreground">{detail.products.length} 种产品 · {detail.products.reduce((sum, product) => sum + product.resourceCount, 0)} 个资源</p>
          </div>
          <Table aria-label="云资源监测范围" className="min-w-[600px]">
            <TableHeader className="bg-muted/40"><TableRow><TableHead className="pl-4 sm:pl-5">云产品</TableHead><TableHead>资源范围</TableHead><TableHead className="text-center">纳入值守</TableHead><TableHead className="text-center">告警推送</TableHead><TableHead className="pr-4 text-center sm:pr-5">容量监测</TableHead></TableRow></TableHeader>
            <TableBody>{detail.products.map(product => {
              const config = draft.products[product.id]
              if (!config) return null
              return <TableRow key={product.id} className={!config.enabled ? 'bg-muted/20 text-muted-foreground' : ''}>
                <TableCell className="py-3 pl-4 sm:pl-5"><div className="flex items-center gap-3"><CloudProductIcon product={product.product} cloudProvider={product.cloudProvider} /><div><div className="font-medium">{product.product}</div><div className="text-xs text-muted-foreground">{product.name}</div></div></div></TableCell>
                <TableCell><Button type="button" variant="ghost" size="sm" aria-label={`配置 ${product.product} 资源范围`} onClick={() => {
                  setEditing(product.id); setScopeInput(config.resourceIds.join(', ')); setScopeError('')
                }}>{config.resourceIds.length ? `已选 ${config.resourceIds.length} / ${product.resourceCount} 个` : `全部 ${product.resourceCount} 个`}<Settings2 className="size-3.5 text-muted-foreground" /></Button></TableCell>
                <TableCell className="text-center"><DutySwitch label={`${product.product} 纳入值守`} checked={config.enabled} onChange={enabled => patchProduct(product.id, { enabled })} /></TableCell>
                <TableCell className="text-center"><DutySwitch label={`${product.product} 告警推送`} checked={config.alarms} disabled={!config.enabled} onChange={alarms => patchProduct(product.id, { alarms })} /></TableCell>
                <TableCell className="pr-4 text-center sm:pr-5">{product.capacitySupported ? <DutySwitch label={`${product.product} 容量监测`} checked={config.metrics} disabled={!config.enabled} onChange={metrics => patchProduct(product.id, { metrics })} /> : <span className="text-xs text-muted-foreground">暂不支持</span>}</TableCell>
              </TableRow>
            })}
            {!detail.products.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">架构图中暂无绑定的云资源，可在下方关联 APM 应用。</TableCell></TableRow>}
            </TableBody>
          </Table>
          <details className="group border-t px-4 py-3 text-xs sm:px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-muted-foreground [&::-webkit-details-marker]:hidden">云资源扫描与容量监测规则<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" /></summary>
            <div className="mt-3 grid gap-2 leading-relaxed text-muted-foreground">
              <p>纳入值守后检查所选资源的状态；「告警推送」控制这些资源的告警推送及 RCA，「容量监测」控制容量检查。以上开关均不影响 APM 应用告警。</p>
              <p>告警查询覆盖架构图全部云资源，推送与 RCA 按上表选择的范围执行。</p>
              <p>容量监测沿用智能顾问的指标、算法、分析周期和阈值。只有本次有效的云端高负载判定才触发容量事件，任务未完成或数据无效时不使用历史结果判断高负载或恢复。</p>
              <p>高负载提醒：首次、持续 1 小时、6 小时、1 天、3 天、1 周，此后每周；恢复后重置。</p>
            </div>
          </details>
        </section>
        <ArchitectureApmField watchId={detail.watch.id} value={draft.apmApplications || []} onChange={apmApplications => setDraft(current => ({ ...current, apmApplications }))} />
        </div>
        <div className="form-save-bar"><p className="text-xs text-muted-foreground">统一保存公共设置、云资源范围与 APM 应用关联，保存后生效。</p>
          <Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存值守设置'}</Button></div>
      </fieldset>
      <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle className="flex items-center gap-3"><CloudProductIcon product={detail.products.find(p => p.id === editing)?.product || ''} cloudProvider={detail.products.find(p => p.id === editing)?.cloudProvider} />{detail.products.find(p => p.id === editing)?.product} 资源范围</DialogTitle>
            <DialogDescription>选择该云产品参与值守的资源，应用于资源状态检查、告警推送与容量监测。</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <Label htmlFor="product-scope-resources">指定资源 ID（逗号分隔，留空则值守该产品全部绑定资源）</Label>
            <Input id="product-scope-resources" value={scopeInput} onChange={e => { setScopeInput(e.target.value); setScopeError('') }} />
            <div className="max-h-64 overflow-y-auto rounded-lg border p-3">
              {detail.resources.filter(r => r.productKey === editing).map(r => <label key={`${r.region}:${r.id}`} className="flex cursor-pointer items-center gap-3 py-2">
                <input type="checkbox" checked={scopeInput.split(/[,，\s]+/).includes(r.id)} onChange={e => {
                  const ids = scopeInput.split(/[,，\s]+/).filter(Boolean)
                  setScopeInput((e.target.checked ? [...new Set([...ids, r.id])] : ids.filter(id => id !== r.id)).join(', ')); setScopeError('')
                }} /><span className="min-w-0 text-sm">{r.name}<span className="ml-2 break-all font-mono text-xs text-muted-foreground">{r.id}</span></span>
              </label>)}
            </div>
            <p className="text-xs text-muted-foreground">留空表示全部资源；点击资源可填入指定范围。应用后需保存值守设置才会生效。</p>
            {scopeError && <p role="alert" className="text-sm text-destructive">{scopeError}</p>}
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button type="button" onClick={() => {
              if (!editing) return
              const ids = [...new Set(scopeInput.split(/[,，\s]+/).filter(Boolean))]
              if (ids.some(id => !detail.resources.some(r => r.productKey === editing && r.id === id))) {
                setScopeError('请仅选择当前产品绑定的资源 ID。'); return
              }
              patchProduct(editing, { resourceIds: ids }); setEditing(null)
            }}>应用到设置</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
