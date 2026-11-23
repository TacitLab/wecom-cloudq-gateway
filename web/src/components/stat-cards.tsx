import { ArrowUpRight, BellRing, Bot, Network, Radio } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminState } from '@/lib/types'
import type { ViewKey } from '@/lib/views'

export function StatCards({ state, onSwitch }: { state: AdminState | null; onSwitch: (view: ViewKey) => void }) {
  const online = state?.bots.filter(b => b.enabled && b.agentConfigId && state.connections[b.id]?.status === 'authenticated').length ?? 0
  const items = [
    { label: '在线 Bot', value: state ? online : undefined, hint: state ? `${state.bots.length} 个配对 · 已认证连接` : '正在读取连接状态', icon: Radio, view: 'pairings' as const, featured: true },
    { label: '智能体', value: state?.agents.length, hint: '为 Bot 提供智能运维能力', icon: Bot, view: 'agents' as const },
    { label: '值守架构', value: state?.architectureWatches?.length, hint: `${state?.architectureWatches?.filter(w => w.dutyEnabled).length ?? 0} 个已启用值守`, icon: Network, view: 'architecture-watches' as const },
    { label: '告警配置', value: state?.alertIntegrations.length, hint: `${state?.alertIntegrations.filter(a => a.enabled).length ?? 0} 个已启用轮询`, icon: BellRing, view: 'alerts' as const },
  ]
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
    {items.map(item => <button key={item.label} type="button" className={`metric-card ${item.featured ? 'metric-card-featured' : ''}`} onClick={() => onSwitch(item.view)}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{item.label}</span><item.icon className="size-4 opacity-70" /></div>
      {item.value === undefined ? <Skeleton className="my-3 h-9 w-12" /> : <div className="mb-2 mt-3 text-4xl font-semibold tabular-nums tracking-tight">{item.value.toString().padStart(2, '0')}</div>}
      <div className="flex items-center justify-between gap-2 text-[11px] opacity-75"><span>{item.hint}</span><ArrowUpRight className="size-3.5 shrink-0" /></div>
    </button>)}
  </div>
}
