import { botConnectionState } from '@/lib/list-filters'
import type { AdminState } from '@/lib/types'
import type { ViewKey } from '@/lib/views'

export interface OverviewCheck {
  view: ViewKey
  label: string
  detail: string
  status: string
  tone: 'success' | 'warning' | 'error' | 'neutral'
}

export function getOverviewChecks(state: AdminState): OverviewCheck[] {
  const enabledBots = state.bots.filter(bot => bot.enabled)
  const pendingBots = enabledBots.filter(bot => botConnectionState(bot, state.connections[bot.id]) !== 'online')
  const watches = state.architectureWatches ?? []
  const activeWatches = watches.filter(watch => watch.dutyEnabled)
  const watchErrors = activeWatches.filter(watch => watch.dutyError)
  const integrations = state.alertIntegrations.filter(item => item.enabled)
  const pollErrors = integrations.filter(item => item.lastError)
  const pendingIntegrations = integrations.filter(item => {
    const bot = state.bots.find(bot => bot.id === item.botConfigId)
    return !item.targetChatId || !bot?.enabled || !bot.agentConfigId
  })
  const outdatedAgents = state.agents.filter(agent => agent.runtimeCredentialOutdated)

  const checks: OverviewCheck[] = [
    {
      view: 'pairings', label: 'Bot 连接',
      detail: pendingBots.length ? `${pendingBots.map(bot => bot.name).slice(0, 2).join('、')}：请检查连接与 Agent 绑定`
        : enabledBots.length ? `${enabledBots.length} 个已启用 Bot 均已完成连接认证`
          : state.bots.length ? '现有 Bot 均已停用，可在配对列表中管理' : '连接企业微信 Bot，让团队开始与智能体协作',
      status: pendingBots.length ? `${pendingBots.length} 个待连接` : enabledBots.length ? '已连接' : state.bots.length ? '已停用' : '未配置',
      tone: pendingBots.length ? 'warning' : enabledBots.length ? 'success' : 'neutral',
    },
    {
      view: 'architecture-watches', label: '架构值守',
      detail: watchErrors.length ? `${watchErrors.map(watch => watch.archName).slice(0, 2).join('、')}：最近检查返回异常`
        : activeWatches.length ? `${watches.length} 个架构中，${activeWatches.length} 个已开启持续值守`
          : watches.length ? '已关联架构，进入详情开启资源监测与群推送' : '关联业务架构，持续关注资源与告警变化',
      status: watchErrors.length ? `${watchErrors.length} 个检查异常` : activeWatches.length ? '已启用' : watches.length ? '未启用' : '未配置',
      tone: watchErrors.length ? 'error' : activeWatches.length ? 'success' : 'neutral',
    },
    {
      view: 'alerts', label: '告警自动诊断',
      detail: pollErrors.length ? `${pollErrors.map(item => item.name).slice(0, 2).join('、')}：最近轮询返回异常`
        : pendingIntegrations.length ? '检查目标群绑定，以及执行 Bot 的启用状态和 Agent 配对'
          : integrations.length ? `${integrations.length} 个配置已启用，诊断结果将推送至绑定群`
            : state.alertIntegrations.length ? '现有告警配置均已暂停，可按需恢复轮询' : '接入告警来源，自动分析根因并推送结果',
      status: pollErrors.length ? `${pollErrors.length} 个轮询异常` : pendingIntegrations.length ? `${pendingIntegrations.length} 个待完善`
        : integrations.length ? '已启用' : state.alertIntegrations.length ? '已暂停' : '未配置',
      tone: pollErrors.length ? 'error' : pendingIntegrations.length ? 'warning' : integrations.length ? 'success' : 'neutral',
    },
  ]
  if (outdatedAgents.length) checks.push({
    view: 'agents', label: 'Agent 运行凭证',
    detail: `${outdatedAgents.map(agent => agent.name).slice(0, 2).join('、')}：运行版本中的凭证需要更新`,
    status: `${outdatedAgents.length} 个待更新`, tone: 'warning',
  })
  const priority = { error: 0, warning: 1, success: 2, neutral: 3 }
  return checks.sort((a, b) => priority[a.tone] - priority[b.tone])
}
