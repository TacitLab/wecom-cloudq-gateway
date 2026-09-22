import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminState } from '@/lib/types'

export function StatCards({ state }: { state: AdminState | null }) {
  const online = state
    ? Object.values(state.connections).filter((c) => c.status === 'authenticated').length
    : 0
  const items = [
    { label: '企业微信 Bot', value: state?.bots.length },
    { label: 'CloudAgent 配置', value: state?.agents.length },
    { label: '已认证长连接', value: state ? online : undefined },
    { label: '告警轮询配置', value: state?.alertIntegrations.length },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
      {items.map((item) => (
        <Card key={item.label} className="py-4">
          <CardContent className="px-4">
            {item.value === undefined ? (
              <Skeleton className="mb-1 h-8 w-14" />
            ) : (
              <div className="text-2xl font-bold tabular-nums tracking-tight">{item.value}</div>
            )}
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
