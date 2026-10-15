export interface BotConfig {
  id: string
  name: string
  botId: string
  cloudAgentId: string
  cloudAgentName: string
  groupSessionScope: 'chat' | 'user'
  wsUrl?: string
  welcomeText: string
  placeholder: string
  enabled: boolean
}

export interface ConnectionStatus {
  status: string
  detail?: string
}

export interface AgentConfig {
  id: string
  name: string
  agentId: string
  apiKeyConfigId?: string | null
  apiKeyName?: string | null
  baseUrl: string
  sourceApp: string
  runtimeNamePrefix: string
  controlTimeoutMs: number
  promptTimeoutMs: number
  includeThinking: boolean
  manifest: Record<string, unknown>
  revision: number
}

export interface ApiKeyConfig {
  id: string
  name: string
  apiKeyMasked?: string
  baseUrl: string
  createdAt: string
}

export interface TencentCredentialConfig {
  id: string
  name: string
  secretIdMasked?: string
  createdAt: string
}

export interface TencentAlarmPolicy {
  id: string
  name: string
  namespace: string
  namespaceName: string
  monitorType: string
  enabled: boolean
}

export interface AlertIntegration {
  id: string
  name: string
  botConfigId: string
  botName: string
  cloudAgentName: string
  credentialId?: string | null
  credentialName?: string | null
  region?: string
  monitorType: string
  namespace: string
  pollIntervalSeconds: number
  policyIds: string[]
  initialLookbackSeconds: number
  overlapSeconds: number
  promptTemplate?: string
  includeRecovery: boolean
  enabled: boolean
  targetChatId?: string | null
  targetChatName?: string | null
  bindCode: string
  lastError?: string | null
  lastSuccessAt?: string | null
}

export type AlertJobStatus =
  | 'queued'
  | 'analyzing'
  | 'delivery_pending'
  | 'delivering'
  | 'delivered'
  | 'failed'

export interface AlertJob {
  id: string
  integrationName: string
  alarmId: string
  payload?: { AlarmObject?: string }
  status: AlertJobStatus
  error?: string | null
  createdAt: string
}

export interface AdminState {
  bots: BotConfig[]
  agents: AgentConfig[]
  apiKeys: ApiKeyConfig[]
  tencentCredentials: TencentCredentialConfig[]
  connections: Record<string, ConnectionStatus>
  alertIntegrations: AlertIntegration[]
  alertJobs: AlertJob[]
}

export interface RemoteAgent {
  agentId: string
  agentName?: string
  enabled: boolean
  existingConfigId?: string | null
}
