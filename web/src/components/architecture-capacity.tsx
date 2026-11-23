import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { tencentRegionName } from '@/lib/tencent-regions'

interface CapacitySnapshot {
  source: string; fetchedAt: number; finishedAt: number | null; complete: boolean; warnings: string[]; errors: string[]
  resources: { resourceId: string; resourceName: string; product: string; region: string; riskLevel: number | null
    stale: boolean; supported: boolean; updatedAt: number | null; periodDays: number | null
    metrics: { name: string; riskLevel: number | null; value: number | null }[] }[]
}
const LEVELS: Record<number, string> = { 0: '正常', 1: '低利用率', 2: '中负载', 3: '高负载' }

export function ArchitectureCapacity({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<CapacitySnapshot | null>(null)
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<CapacitySnapshot>(`/api/admin/architecture-watches/${id}/capacity`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setSnapshot(result); setError('') } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => controller.abort()
  }, [id, refresh])
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">按智能顾问现有配置刷新监测数据，高负载判定由云端生成，更新时间见各资源。</p>
      <Button variant="outline" size="sm" onClick={() => { setError(''); setSnapshot(null); setRefresh(v => v + 1) }}>读取最新结果</Button></div>
    {error ? <p role="alert" className="break-words rounded-lg border p-4 text-sm text-destructive">{error}</p> : !snapshot ? <p className="py-8 text-center text-sm text-muted-foreground" role="status">正在读取智能顾问容量结果…</p> : <>
      {!snapshot.complete && <p className="rounded-lg border p-3 text-sm text-muted-foreground">云端任务尚未全部完成，仅展示已完成节点的结果。</p>}
      {!snapshot.resources.length ? <p className="py-8 text-center text-sm text-muted-foreground">暂无可读取的实例容量结果，请在智能顾问中确认该架构图已开启容量监测。</p> : <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>资源</TableHead><TableHead>产品 / 地域</TableHead><TableHead>云端负载判定</TableHead><TableHead>指标</TableHead><TableHead>结果更新时间</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.resources.map(resource => <TableRow key={`${resource.product}:${resource.region}:${resource.resourceId}`}>
          <TableCell><div className="font-medium">{resource.resourceName}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{resource.resourceId}</div></TableCell>
          <TableCell>{resource.product}<p className="mt-1 text-xs text-muted-foreground">{tencentRegionName(resource.region) || resource.region}</p></TableCell>
          <TableCell><Badge variant={!resource.stale && resource.riskLevel === 3 ? 'destructive' : 'secondary'}>{resource.riskLevel === null ? '未判定' : LEVELS[resource.riskLevel] || '未知'}</Badge>
            {resource.stale && resource.supported && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">历史结果 · 暂停播报</p>}
            {resource.periodDays && <p className="mt-1 text-xs text-muted-foreground">分析周期 {resource.periodDays} 天</p>}</TableCell>
          <TableCell><div className="grid gap-1">{resource.metrics.map(metric => <span key={metric.name} className={`text-xs ${metric.riskLevel === 3 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
            {metric.name}：{metric.value ?? '—'} · {metric.riskLevel === null ? '未判定' : LEVELS[metric.riskLevel] || '未知'}</span>)}</div></TableCell>
          <TableCell className="text-xs">{resource.updatedAt ? new Date(resource.updatedAt).toLocaleString() : '未知'}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
      {(snapshot.warnings.length > 0 || snapshot.errors.length > 0) && <details className="rounded-lg border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer">查看数据说明（{snapshot.warnings.length + snapshot.errors.length}）</summary>
        <div className="mt-2 grid gap-2 break-words">{[...snapshot.errors, ...snapshot.warnings].map((message, index) => <p key={index}>{message}</p>)}</div>
      </details>}
      <p className="text-xs text-muted-foreground">高负载仅使用智能顾问等级 3；中负载不当作高负载推送。超过 24 小时的结果不用于持续播报或恢复判断。</p>
    </>}
  </div>
}
