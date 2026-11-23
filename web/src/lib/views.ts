export type ViewKey = 'overview' | 'pairings' | 'agents' | 'wma-credentials' | 'tencent-credentials' | 'alerts' | 'architecture-watches'

export const VIEW_META: Record<ViewKey, { title: string; description: string; group: string; eyebrow: string }> = {
  overview: {
    group: '运维工作台', eyebrow: 'WORKSPACE OVERVIEW',
    title: '工作区概览',
    description: '一眼掌握连接与值守状态，从这里开始今天的运维工作。',
  },
  'architecture-watches': {
    group: '运维工作台', eyebrow: 'ARCHITECTURE WATCH',
    title: '架构值守',
    description: '让业务架构持续可见，让资源异常及时被发现。',
  },
  pairings: {
    group: '连接与智能体', eyebrow: 'BOT CONNECTIONS',
    title: '企业微信 Bot 配对',
    description: '连接团队与智能体，让每一条运维消息都有回应。',
  },
  agents: {
    group: '连接与智能体', eyebrow: 'AGENT WORKSPACE',
    title: 'WMA Agent',
    description: '集中管理智能体、运行版本与凭证，为团队提供可靠的运维能力。',
  },
  'wma-credentials': {
    group: '凭证与访问', eyebrow: 'WMA CREDENTIALS',
    title: 'WMA 凭证设置',
    description: '管理智能体接入凭证，用于发现和调用 WMA Agent。',
  },
  'tencent-credentials': {
    group: '凭证与访问', eyebrow: 'CLOUD CREDENTIALS',
    title: '腾讯云凭证',
    description: '统一管理云资源访问，为架构值守、告警分析和 Agent 运行提供认证。',
  },
  alerts: {
    group: '运维工作台', eyebrow: 'ALERT INTELLIGENCE',
    title: '告警 RCA',
    description: '从告警发现到根因分析，将诊断结果直接送达团队。',
  },
}

export function parseView(hash: string): ViewKey | null {
  const key = hash.replace(/^#/, '').split('/')[0] as ViewKey
  return Object.hasOwn(VIEW_META, key) ? key : null
}

export function parseWatchId(hash: string): string | null {
  const match = hash.match(/^#architecture-watches\/([a-zA-Z0-9-]+)$/)
  return match?.[1] ?? null
}

export function isEmptyState(state: { bots: unknown[]; agents: unknown[]; wmaCredentials: unknown[]; tencentCredentials?: unknown[]; architectureWatches?: unknown[] }) {
  return state.bots.length === 0 && state.agents.length === 0 && state.wmaCredentials.length === 0
    && !state.tencentCredentials?.length && !state.architectureWatches?.length
}
