import { Badge } from '@/components/ui/badge'
import type { AlertJobStatus, BotConfig, ConnectionStatus } from '@/lib/types'

export function BotStatusBadge({
  bot,
  connection,
}: {
  bot: BotConfig
  connection?: ConnectionStatus
}) {
  if (!bot.agentConfigId) return <Badge variant="secondary">待绑定 WMA Agent</Badge>
  if (!bot.enabled) return <Badge variant="secondary">已停用</Badge>
  if (!connection) return <Badge variant="destructive">未连接</Badge>
  const ok = connection.status === 'authenticated'
  return (
    <Badge variant={ok ? 'default' : 'destructive'} className={ok ? 'bg-green-600' : undefined}>
      {connection.status}
      {connection.detail ? ` · ${connection.detail}` : ''}
    </Badge>
  )
}

const JOB_LABELS: Record<AlertJobStatus, string> = {
  queued: '等待诊断',
  analyzing: '诊断中',
  delivery_pending: '等待推送',
  delivering: '推送中',
  delivered: '已推送',
  failed: '失败',
}

export function JobStatusBadge({ status }: { status: AlertJobStatus }) {
  if (status === 'delivered')
    return <Badge className="bg-green-600">{JOB_LABELS[status]}</Badge>
  if (status === 'failed') return <Badge variant="destructive">{JOB_LABELS[status]}</Badge>
  return (
    <Badge variant="secondary" className="bg-amber-100 text-amber-800">
      {JOB_LABELS[status] ?? status}
    </Badge>
  )
}
