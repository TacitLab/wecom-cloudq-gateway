export type ViewKey = 'pairings' | 'agents' | 'wma-credentials' | 'tencent-credentials' | 'alerts'

export const VIEW_META: Record<ViewKey, { title: string; description: string }> = {
  pairings: {
    title: '企业微信 Bot 配对',
    description: '管理企业微信 Bot 与 WMA Agent 的唯一绑定关系',
  },
  agents: {
    title: 'WMA Agent',
    description: '维护可被企业微信 Bot 绑定的企业智能体配置',
  },
  'wma-credentials': {
    title: 'WMA 凭证设置',
    description: '维护用于拉取和调用 WMA 智能体的腾讯云 AK/SK 凭证',
  },
  'tencent-credentials': {
    title: '腾讯云凭证',
    description: '维护告警 RCA 轮询腾讯云监控所需的 SecretId / SecretKey',
  },
  alerts: {
    title: '告警 RCA',
    description: '轮询可观测告警并主动推送 WMA Agent 根因分析',
  },
}

export function parseView(hash: string): ViewKey | null {
  const key = hash.replace(/^#/, '') as ViewKey
  return key in VIEW_META ? key : null
}

export function isEmptyState(state: { bots: unknown[]; agents: unknown[]; wmaCredentials: unknown[] }) {
  return state.bots.length === 0 && state.agents.length === 0 && state.wmaCredentials.length === 0
}
