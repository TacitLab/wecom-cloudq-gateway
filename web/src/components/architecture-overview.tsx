import { ArchitectureRegionMap } from '@/components/architecture-region-map'
import { DutySwitch } from '@/components/forms/architecture-duty-form'
import { Button } from '@/components/ui/button'
import type { ArchitectureDetail } from '@/lib/types'

const COLORS = ['#2456df', '#13a68d', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b', '#06b6d4']
export function ArchitectureOverview({ detail, busy, onEnabled, onSettings }: {
  detail: ArchitectureDetail
  busy: boolean; onEnabled: (enabled: boolean) => void; onSettings: () => void
}) {
  const total = detail.resources.length
  return <div className="architecture-overview grid gap-4 xl:grid-cols-[1.05fr_1.3fr_.75fr]">
    <section aria-label="资源分布概览" className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between"><h2 className="text-sm font-medium">资源分布</h2><span className="text-xs text-muted-foreground">{detail.products.length} 种云产品</span></div>
      <div className="mt-3 flex min-h-40 flex-1 items-center gap-4">
        <svg viewBox="0 0 120 120" className="aspect-square w-[40%] max-w-48 shrink-0" role="img" aria-label={`共 ${total} 个资源，按产品分布`}>
          <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeWidth="13" className="text-muted" />
          {detail.products.map((p, index) => {
            const fraction = total ? p.resourceCount / total : 0
            const start = total ? detail.products.slice(0, index).reduce((sum, p) => sum + p.resourceCount, 0) / total : 0
            return <circle key={p.id} cx="60" cy="60" r="46" pathLength="100" fill="none" stroke={COLORS[index % COLORS.length]} strokeWidth="13"
              strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 60 60)"><title>{p.product}：{p.resourceCount} 个</title></circle>
          })}
          <text x="60" y="59" textAnchor="middle" className="fill-foreground text-2xl font-semibold">{total}</text><text x="60" y="77" textAnchor="middle" className="fill-muted-foreground text-[10px]">绑定资源</text>
        </svg>
        <div className="grid max-h-44 min-w-0 flex-1 grid-cols-2 items-center gap-x-3 gap-y-1 self-stretch overflow-y-auto">{detail.products.map((p, index) => <div key={p.id} className="flex min-w-0 items-center gap-1.5 px-1 py-1 text-xs">
          <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} /><span className="truncate">{p.product}</span><span className="ml-auto font-medium">{p.resourceCount}</span>
        </div>)}</div>
      </div>
    </section>
    <section aria-label="地域分布概览" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between"><h2 className="text-sm font-medium">地域分布</h2><span className="text-xs text-muted-foreground">覆盖 <strong className="text-base text-foreground">{detail.regions.filter(r => r.id !== 'unknown').length}</strong> 个地域</span></div>
      <ArchitectureRegionMap compact regions={detail.regions} />
    </section>
    <section aria-label="值守控制" className="duty-control flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">架构值守</h2><DutySwitch label="快捷启用架构值守" checked={detail.settings.enabled} disabled={busy} onChange={onEnabled} /></div>
      <p className="mt-4 text-xl font-semibold">{detail.settings.enabled ? detail.settings.targetChatId ? '已启用' : '等待群绑定' : '未启用'}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail.settings.schedule.allDay ? '全天值守' : `${detail.settings.schedule.start} — ${detail.settings.schedule.end}`} · 每 {detail.settings.pollIntervalSeconds} 秒检查</p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail.settings.targetChatId ? `推送群：${detail.settings.targetChatName || detail.settings.targetChatId}` : '请在值守设置中配置范围和推送群'}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail.settings.lastSuccessAt ? `最近检查 ${new Date(detail.settings.lastSuccessAt).toLocaleString()}` : '尚无成功检查记录'}</p>
      <Button variant="link" size="sm" className="mt-auto self-start px-0 pt-3" onClick={onSettings}>值守设置 →</Button>
    </section>
  </div>
}
