import type { BotConfig, ConnectionStatus } from '@/lib/types'

export function matchesSearch(query: string, ...values: Array<string | null | undefined>) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const text = values.filter(Boolean).join(' ').toLocaleLowerCase()
  return terms.every(term => text.includes(term))
}


export function botConnectionState(bot: BotConfig, connection?: ConnectionStatus): 'online' | 'attention' | 'disabled' {
  if (!bot.enabled) return 'disabled'
  return bot.agentConfigId && connection?.status === 'authenticated' ? 'online' : 'attention'
}
