import type { ReactNode } from 'react'
import type { AlertJobStatus, BotConfig, ConnectionStatus } from '@/lib/types'

export function StatusBadge({ tone = 'neutral', children, title }: {
  tone?: 'success' | 'warning' | 'error' | 'neutral' | 'info'; children: ReactNode; title?: string
}) {
  return <span className={`status-badge status-${tone}`} title={title}>{children}</span>
}


const CONNECTION_LABELS: Record<string, string> = {
  authenticated: '已连接', connecting: '连接中', connected: '认证中', authenticating: '认证中',
  disconnected: '已断开', reconnecting: '重连中', error: '连接异常', stopped: '已停止',
}
export function BotStatusBadge({ bot, connection }: { bot: BotConfig; connection?: ConnectionStatus }) {
  if (!bot.agentConfigId) return <StatusBadge tone="warning">待绑定 Agent</StatusBadge>
  if (!bot.enabled) return <StatusBadge>已停用</StatusBadge>
  if (!connection) return <StatusBadge tone="error">未连接</StatusBadge>
  const ok = connection.status === 'authenticated'
  const pending = ['connecting', 'connected', 'authenticating', 'reconnecting'].includes(connection.status)
  return <StatusBadge tone={ok ? 'success' : pending ? 'warning' : 'error'} title={[connection.status, connection.detail].filter(Boolean).join(' · ')}>{CONNECTION_LABELS[connection.status] || '连接状态待确认'}</StatusBadge>
}

const JOB_LABELS: Record<AlertJobStatus, string> = {
  queued: '等待诊断', analyzing: '诊断中', delivery_pending: '等待推送', delivering: '推送中', delivered: '已推送', failed: '失败',
}
export function JobStatusBadge({ status }: { status: AlertJobStatus }) {
  return <StatusBadge tone={status === 'delivered' ? 'success' : status === 'failed' ? 'error' : 'warning'}>{JOB_LABELS[status] ?? status}</StatusBadge>
}
