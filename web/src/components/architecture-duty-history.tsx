import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { tencentRegionName } from '@/lib/tencent-regions'
import type { ArchitectureDutyEvent, ArchitectureDutyHistory as History } from '@/lib/types'
import { ApmPolicies } from '@/components/forms/architecture-apm-field'

const TYPE_NAMES: Record<string, string> = { alarm: '产品告警', high_load: '水位超限', resource_status: '资源异常', recovery: '恢复' }
const ANALYSIS_NAMES: Record<string, string> = { pending: '等待分析', running: '分析中', ready: '分析完成 · 待推送', completed: '分析已推送', failed: '分析失败', skipped: '未开启 RCA', cancelled: '已取消' }
const QUERY_NAMES = { pending: '尚未查询', checked: '已查询', partial: '结果不完整', failed: '查询失败', unsupported: '暂不支持' }
const time = (value: number) => new Date(value).toLocaleString()

function status(event: ArchitectureDutyEvent) {
  if (event.analysisStatus === 'cancelled') return '已取消'
  if (!event.notifiedAt) return event.attempts >= 5 ? '事件推送失败' : '等待事件推送'
  return event.rcaEnabled ? ANALYSIS_NAMES[event.analysisStatus] || event.analysisStatus : '事件已推送'
}

export function ArchitectureDutyHistory({ id }: { id: string }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const load = () => api<History>(`/api/admin/architecture-watches/${id}/history?page=${page}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setHistory(result); setError('') } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    void load()
    const timer = setInterval(() => void load(), 10000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [id, page, refresh])
  return <div className="grid gap-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">值守事件</h3><p className="mt-1 text-xs text-muted-foreground">记录事件推送、RCA 分析和恢复通知，自动刷新；保留最近 30 天的已完成记录。</p></div>
      <Button variant="outline" size="sm" onClick={() => setRefresh(v => v + 1)}>刷新记录</Button></div>
    {error && <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{error}</p>}
    {!history ? <p className="py-8 text-center text-sm text-muted-foreground">正在加载记录…</p> : <>
      {!history.items.length ? <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">尚无值守事件。启用并绑定群后，告警、持续高负载及恢复会记录在这里。</div>
        : <div className="grid gap-3">{history.items.map(event => <details key={event.id} className="rounded-lg border p-4">
          <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2">
            <Badge variant={event.type === 'recovery' ? 'secondary' : 'outline'}>{event.product === 'APM' && event.type === 'alarm' ? 'APM 告警' : TYPE_NAMES[event.type] || event.type}</Badge>
            <span className="break-words text-sm font-medium">{event.title}</span></div>
            <p className="mt-2 text-xs text-muted-foreground">{time(event.createdAt)} · {event.product} · {tencentRegionName(event.region) || event.region} · {event.resourceId}</p></div>
            <Badge variant={event.error ? 'destructive' : 'secondary'}>{status(event)}</Badge></div></summary>
          <div className="mt-4 grid gap-3 border-t pt-4 text-sm">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span>事件推送：{event.notifiedAt ? time(event.notifiedAt) : '待推送'}</span><span>完成：{event.completedAt ? time(event.completedAt) : '未完成'}</span></div>
            {event.error && <p className="break-words text-destructive">{event.error}</p>}
            {event.analysis && <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 leading-relaxed">{event.analysis}</div>}
            <details><summary className="cursor-pointer text-xs text-muted-foreground">查看事件原始数据</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-3 text-xs">{JSON.stringify(event.payload, null, 2)}</pre></details>
            {!event.completedAt && (event.analysisStatus === 'failed' || event.attempts >= 5) && <div><Button variant="outline" size="sm" disabled={busy === event.id} onClick={async () => {
              setBusy(event.id)
              try { await api(`/api/admin/architecture-watches/${id}/events/${event.id}/retry`, { method: 'POST', body: '{}' }); toast.success('事件已重新入队'); setRefresh(v => v + 1) }
              catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
              finally { setBusy('') }
            }}>重试未完成步骤</Button></div>}
          </div>
        </details>)}</div>}
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>共 {history.totalCount} 条 · 第 {page} / {Math.max(1, Math.ceil(history.totalCount / 20))} 页</span><div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setHistory(null); setPage(v => v - 1) }}>上一页</Button>
        <Button variant="outline" size="sm" disabled={page * 20 >= history.totalCount} onClick={() => { setHistory(null); setPage(v => v + 1) }}>下一页</Button></div></div>
      <div className="border-t pt-5"><h3 className="font-semibold">最近检查记录</h3>
        {!history.checks.length ? <p className="py-6 text-sm text-muted-foreground">尚未执行检查。可在值守设置中绑定群、启用后点击“立即检查”。</p>
          : <div className="mt-3 grid gap-2">{history.checks.map(check => <details key={check.id} className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer"><span>{time(check.createdAt)}</span><span className="ml-3 text-xs text-muted-foreground">{check.resources} 个资源 · {check.capacityResources ?? 0} 个容量结果 · {check.highLoadResources ?? 0} 个高负载资源 · {check.alarms ? `告警已查 ${check.alarms.queriedResources}/${check.alarms.resourceCount} 个资源 · ${check.alarms.activeCount} 条未恢复告警` : '未记录告警统计'} · {check.events} 个新事件</span>
              <Badge className="ml-2" variant={check.error ? 'outline' : 'secondary'}>{check.errors.length ? '检查失败或部分失败' : check.warnings.length ? '数据不完整' : '检查完成'}</Badge></summary>
            {check.alarms && <div className="mt-3 grid gap-3 border-t pt-3">
              <h4 className="text-xs font-semibold">告警查询明细</h4>
              <p className="text-xs text-muted-foreground">架构图全部资源均纳入告警查询，与容量是否支持无关。读取近 {check.alarms.lookbackDays} 天首次发生的腾讯云监控告警，共匹配 {check.alarms.totalCount} 条，其中 {check.alarms.activeCount} 条未恢复；本次请求 {check.alarms.requests} 次。推送及 RCA 遵循产品告警开关与指定资源范围。</p>
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead>资源</TableHead><TableHead>产品 / 地域</TableHead><TableHead>告警查询</TableHead><TableHead>未恢复 / 总数</TableHead><TableHead>事件推送</TableHead></TableRow></TableHeader>
                <TableBody>{check.alarms.resources.map(resource => <TableRow key={`${resource.product}:${resource.region}:${resource.resourceId}`}>
                  <TableCell><div>{resource.resourceName}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{resource.resourceId}</div></TableCell>
                  <TableCell>{resource.product}<p className="mt-1 text-xs text-muted-foreground">{tencentRegionName(resource.region) || resource.region || '未知'}</p></TableCell>
                  <TableCell><Badge variant={resource.status === 'checked' ? 'secondary' : 'outline'}>{QUERY_NAMES[resource.status]}</Badge></TableCell>
                  <TableCell>{resource.status === 'checked' || resource.status === 'partial' ? `${resource.activeCount} / ${resource.totalCount}` : '—'}</TableCell>
                  <TableCell className="text-xs">{resource.pushEnabled ? '已开启' : '未开启'}</TableCell>
                </TableRow>)}</TableBody>
              </Table></div>
            </div>}
            {check.apm && <div className="mt-3 grid gap-3 border-t pt-3"><h4 className="text-xs font-semibold">APM 应用告警</h4>
              <p className="text-xs text-muted-foreground">{check.apm.applications.length} 个应用 · {check.apm.activeCount} 条未恢复 / {check.apm.totalCount} 条告警 · {check.apm.unresolvedCount} 条归属待核对。读取近 {check.apm.lookbackDays} 天首次发生的告警。</p>
              {check.apm.applications.map(app => <details key={`${app.region}/${app.instanceId}/${app.serviceName}`} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm">{app.serviceName} · {app.instanceName || app.instanceId} · {tencentRegionName(app.region) || app.region} · {app.policies.length} 条相关策略 · {app.activeCount} 条未恢复
                  <Badge className="ml-2" variant={app.status === 'checked' ? 'secondary' : 'outline'}>{app.status === 'checked' ? '已查询' : app.status === 'failed' ? '查询失败' : '结果不完整'}</Badge></summary>
                <div className="mt-3"><ApmPolicies policies={app.policies} /></div>
              </details>)}
            </div>}
            {check.errors.map((message, index) => <p key={`error-${index}`} className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">{message}</p>)}
            {check.warnings.map((message, index) => <p key={`warning-${index}`} className="mt-3 whitespace-pre-wrap break-words text-xs text-amber-700 dark:text-amber-300">{message}</p>)}
            {!check.errors.length && !check.warnings.length && check.error && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">{check.error}</p>}
          </details>)}</div>}
      </div>
    </>}
  </div>
}
