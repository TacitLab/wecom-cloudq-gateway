import { useEffect, useId, useState } from 'react'
import { ChevronDown, RefreshCw, MousePointer2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { tencentRegionName } from '@/lib/tencent-regions'
import type { ArchitectureDetail, ArchitectureNodeDetail } from '@/lib/types'

const LEVELS: Record<number, string> = { 0: '正常', 1: '低利用率', 2: '中负载', 3: '高负载' }
const ALARMS: Record<string, string> = { ALARM: '未恢复', OK: '已恢复', NO_CONF: '已失效', NO_DATA: '数据不足' }
export function ArchitectureNodeInspector({ id, detail, nodeId }: { id: string; detail: ArchitectureDetail; nodeId: string }) {
  const [result, setResult] = useState<ArchitectureNodeDetail | null>(null)
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  const [expandedResource, setExpandedResource] = useState<string | null | undefined>(undefined)
  const panelId = useId()
  useEffect(() => {
    const controller = new AbortController()
    if (nodeId) void api<ArchitectureNodeDetail>(`/api/admin/architecture-watches/${id}/nodes/${encodeURIComponent(nodeId)}`, { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) { setResult(next); setError('') } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => controller.abort()
  }, [id, nodeId, refresh])
  const node = detail.nodes?.find(n => n.id === nodeId)
  const current = result?.node.id === nodeId ? result : null
  const resources = detail.resources.filter(r => node?.resourceKeys.includes(`${r.productKey}:${r.region}:${r.id}`))
  if (!node) return <aside className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-6 text-center lg:h-[540px] xl:h-[640px]">
    <MousePointer2 className="mb-3 size-6 text-muted-foreground" /><h3 className="font-medium">选择架构节点</h3>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">点击图中的节点，查看绑定资源、智能顾问监测结果和产品告警。</p>
  </aside>
  return <aside aria-label="节点资源详情" className="max-h-[640px] overflow-y-auto rounded-xl border bg-card lg:h-[540px] xl:h-[640px]">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b bg-background p-4"><div><h3 className="font-semibold">{node.name}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{node.product} · {resources.length} 个绑定资源</p></div>
      <Button size="icon-sm" variant="ghost" aria-label="刷新节点数据" onClick={() => { setResult(null); setError(''); setRefresh(v => v + 1) }}><RefreshCw /></Button>
    </div>
    <div className="grid gap-3 p-3">
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {!error && !current && resources.length > 0 && <p role="status" className="text-xs text-muted-foreground">正在读取节点监测与告警…</p>}
      {!resources.length && <p className="p-3 text-sm text-muted-foreground">此节点没有绑定云资源。</p>}
      {resources.map(resource => {
        const data = current?.resources.find(r => r.id === resource.id && r.region === resource.region && r.productKey === resource.productKey)
        const capacity = data?.capacity
        const key = `${resource.productKey}:${resource.region}:${resource.id}`
        const first = resources[0]
        const activeKey = expandedResource === undefined ? `${first.productKey}:${first.region}:${first.id}` : expandedResource
        const expanded = resources.length === 1 || activeKey === key
        const contentId = `${panelId}-${key}`
        const summary = <>
          <span className="min-w-0 flex-1 text-left"><span className="block break-words text-sm font-medium">{resource.name}</span>
            <span className="mt-1 block break-all font-mono text-xs font-normal text-muted-foreground">{resource.id}</span></span>
          <Badge variant="outline">{resource.status}</Badge>
        </>
        return <section key={key} className="min-w-0 overflow-hidden rounded-lg border bg-background">
          <h4>{resources.length > 1 ? <button type="button" aria-expanded={expanded} aria-controls={contentId}
            aria-label={`${resource.name}（${resource.id}）资源详情`}
            className="flex w-full cursor-pointer items-start gap-2 p-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            onClick={() => setExpandedResource(expanded ? null : key)}>
            {summary}<ChevronDown aria-hidden="true" className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button> : <div className="flex items-start gap-2 p-3">{summary}</div>}</h4>
          <div id={contentId} hidden={!expanded} className="px-3 pb-3">
          <p className="mt-2 text-xs text-muted-foreground">{resource.product} · {tencentRegionName(resource.region) || resource.region || '地域未知'}{resource.zone ? ` / ${resource.zone}` : ''}</p>
          {(resource.privateIp || resource.publicIp) && <p className="mt-1 break-all text-xs text-muted-foreground">{[resource.privateIp && `内网 ${resource.privateIp}`, resource.publicIp && `公网 ${resource.publicIp}`].filter(Boolean).join(' · ')}</p>}
          {resource.url && <a className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={resource.url} target="_blank" rel="noopener noreferrer">资源控制台<ExternalLink className="size-3" /></a>}
          <div className="mt-3 border-t pt-3"><h5 className="mb-2 text-xs font-semibold">容量监测</h5>
            {capacity && capacity.supported !== false ? <>
              <div className="flex flex-wrap items-center gap-2"><Badge variant={!capacity.stale && capacity.riskLevel === 3 ? 'destructive' : 'secondary'}>{capacity.riskLevel === null ? '未判定' : LEVELS[capacity.riskLevel] || '未知'}</Badge>
                {capacity.stale && <span className="text-xs text-amber-700 dark:text-amber-300">历史结果 · 暂停播报</span>}</div>
              <dl className="mt-2 grid gap-2 text-xs">{capacity.metrics.map(metric => <div key={metric.name} className="flex justify-between gap-2"><dt className="text-muted-foreground">{metric.name}</dt>
                <dd className={metric.riskLevel === 3 ? 'text-destructive' : ''}>{metric.value ?? '—'} · {metric.riskLevel === null ? '未判定' : LEVELS[metric.riskLevel] || '未知'}</dd></div>)}</dl>
              <p className="mt-2 text-[11px] text-muted-foreground">{capacity.periodDays ? `分析周期 ${capacity.periodDays} 天 · ` : ''}{capacity.updatedAt ? new Date(capacity.updatedAt).toLocaleString() : '更新时间未知'}</p>
            </> : <p className="text-xs text-muted-foreground">{capacity?.supported === false ? '云端暂未提供有效容量指标，可能不支持该资源。' : current ? current.errors.length ? '容量结果读取失败，见下方说明。' : '暂无已完成的容量结果，可能未开启或暂不支持。' : error ? '未能读取' : '读取中…'}</p>}
          </div>
          <div className="mt-3 border-t pt-3"><h5 className="mb-2 text-xs font-semibold">产品告警</h5>
            {data ? <>
              {data.alarms.errors.map((message, i) => <p key={i} className="break-words text-xs text-destructive">{message}</p>)}
              {data.alarms.warnings.map((message, i) => <p key={i} className="break-words text-xs text-amber-700">{message}</p>)}
              {!data.alarms.items.length && <p className="text-xs text-muted-foreground">{data.alarms.complete ? '近 30 天无未恢复告警，近 24 小时无其他告警。' : '暂无可展示告警，读取结果不完整。'}</p>}
              <div className="grid gap-2">{data.alarms.items.map(alarm => <div key={alarm.id} className="rounded bg-muted/40 p-2 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{alarm.title}</span><Badge variant={alarm.status === 'ALARM' ? 'destructive' : 'outline'}>{ALARMS[alarm.status] || alarm.status}</Badge></div>
                <p className="mt-1 break-words leading-relaxed">{alarm.content}</p><p className="mt-1 text-muted-foreground">{new Date(alarm.lastOccurTime).toLocaleString()}</p>
              </div>)}</div>
            </> : <p className="text-xs text-muted-foreground">{error ? '未能读取' : '读取中…'}</p>}
          </div>
          </div>
        </section>
      })}
      {current && <><p className="text-[11px] leading-relaxed text-muted-foreground">容量按智能顾问配置刷新；告警包含近 30 天首次发生的未恢复告警，以及近 24 小时首次发生的其他告警。读取于 {new Date(current.fetchedAt).toLocaleString()}。</p>
        {(current.errors.length > 0 || current.warnings.length > 0) && <details className="rounded border p-2 text-xs"><summary className="cursor-pointer">数据说明（{current.errors.length + current.warnings.length}）</summary>
          {[...current.errors, ...current.warnings].map((message, i) => <p key={i} className="mt-2 break-words text-muted-foreground">{message}</p>)}</details>}</>}
    </div>
  </aside>
}
