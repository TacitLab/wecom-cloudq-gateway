export interface BotConfig {
  id: string
  name: string
  botId: string
  agentConfigId: string | null
  agentName: string
  groupSessionScope: 'chat' | 'user'
  wsUrl?: string
  welcomeText: string
  placeholder: string
  enabled: boolean
  showThinking: boolean
}

export interface ConnectionStatus {
  status: string
  detail?: string
}

export interface AgentConfig {
  id: string
  name: string
  agentId: string
  credentialConfigId: string
  credentialName: string
  controlTimeoutMs: number
  promptTimeoutMs: number
  includeThinking: boolean
  revision: number
  runtimeCredentialId: string | null
  runtimeCredentialName: string | null
  runtimeRegion: string | null
  wmaVersionId: string | null
  wmaVersionName: string | null
  runtimeCredentialOutdated: boolean
}

export interface WmaCredentialConfig {
  id: string
  name: string
  region?: string
  secretIdMasked?: string
  secretKeyConfigured?: boolean
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
  agentName: string
  credentialId?: string | null
  credentialName: string
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
  architectureWatches: ArchitectureWatch[]
  bots: BotConfig[]
  agents: AgentConfig[]
  wmaCredentials: WmaCredentialConfig[]
  tencentCredentials: TencentCredentialConfig[]
  connections: Record<string, ConnectionStatus>
  alertIntegrations: AlertIntegration[]
  alertJobs: AlertJob[]
}

export interface TencentArchitecture {
  archId: string
  archName: string
  description: string
  versionName: string
  updatedAt: string
}

export interface ArchitectureWatch {
  id: string
  credentialId: string
  credentialName: string
  archId: string
  archName: string
  description: string
  versionName: string
  createdAt: number
  dutyEnabled?: boolean
  dutyError?: string
}

export interface ArchitectureResource {
  id: string; name: string; productKey: string; product: string; cloudProvider: string
  region: string; zone: string; status: string; nodeNames: string[]; nodeIds?: string[]; url: string; privateIp: string; publicIp: string
}
export interface ArchitectureProduct {
  id: string; product: string; name: string; cloudProvider: string; resourceCount: number; regions: string[]; capacitySupported: boolean
}
export interface ProductDuty {
  enabled: boolean; alarms: boolean; metrics: boolean; resourceIds: string[]
}
export interface ApmApplication {
  region: string; instanceId: string; instanceName: string; serviceName: string; serviceId?: string
}
export interface ApmPolicy {
  id: string; name: string; namespace: string; enabled: boolean; match: 'matched' | 'conditional' | 'unknown'; reason: string
  filter: unknown; condition: unknown; eventCondition: unknown; groupBy: unknown[]
}
export interface ApmPolicyDiscovery {
  items: (ApmApplication & { policies: ApmPolicy[] })[]; complete: boolean; fetchedAt: number
}
export interface ArchitectureDutySettings {
  enabled: boolean; botConfigId: string; targetChatId: string; targetChatName: string; bindCode: string
  revision: number; updatedAt: number; lastAttemptAt: number | null; lastSuccessAt: number | null; lastError: string
  pollIntervalSeconds: number; rcaEnabled: boolean
  apmApplications?: ApmApplication[]
  schedule: { allDay: boolean; start: string; end: string; days: number[] }; products: Record<string, ProductDuty>
}
export interface ArchitectureRegion { id: string; resourceCount: number; products: string[] }
export interface ArchitectureNode {
  id: string; name: string; product: string; bindingNodeIds: string[]; resourceKeys: string[]; resourceCount: number
}
export interface ArchitectureNodeDetail {
  node: ArchitectureNode; fetchedAt: number; alarmWindowHours: number; activeAlarmWindowDays?: number; warnings: string[]; errors: string[]
  resources: (ArchitectureResource & {
    capacity: { riskLevel: number | null; supported?: boolean; stale: boolean; updatedAt: number | null; periodDays: number | null
      metrics: { name: string; value: number | null; riskLevel: number | null }[] } | null
    alarms: { complete: boolean; errors: string[]; warnings: string[]
      items: { id: string; title: string; content: string; status: string; firstOccurTime: number; lastOccurTime: number }[] }
  })[]
}
export interface ArchitectureDetail {
  watch: ArchitectureWatch; resources: ArchitectureResource[]; products: ArchitectureProduct[]; regions: ArchitectureRegion[]
  settings: ArchitectureDutySettings; fetchedAt: number; nodes?: ArchitectureNode[]
}
export interface ArchitectureDutyEvent {
  id: string; watchId: string; type: string; title: string; resourceId: string; product: string; region: string
  payload: Record<string, unknown>; notifiedAt: number | null; rcaEnabled: boolean; analysisStatus: string; analysis: string
  completedAt: number | null; attempts: number; error: string; createdAt: number
}
export interface ArchitectureDutyHistory {
  items: ArchitectureDutyEvent[]; totalCount: number; pageNumber: number; pageSize: number
  checks: { id: string; resources: number; capacityResources?: number; highLoadResources?: number; metricSamples?: number; events: number; warnings: string[]; errors: string[]; error: string; createdAt: number
    apm?: { complete: boolean; lookbackDays: number; totalCount: number; activeCount: number; unresolvedCount: number
      applications: (ApmApplication & { policies: ApmPolicy[]; status: string; totalCount: number; activeCount: number })[] }
    alarms?: { resourceCount: number; queriedResources: number; activeCount: number; totalCount: number; requests: number; complete: boolean; lookbackDays: number
      resources: { resourceId: string; resourceName: string; product: string; region: string; status: 'pending' | 'checked' | 'partial' | 'failed' | 'unsupported'
        pushEnabled: boolean; activeCount: number; totalCount: number }[] }
  }[]
}

export interface RemoteAgent {
  agentId: string
  agentName?: string
  enabled: boolean
  existingConfigId?: string | null
}

export interface RemoteAgentVersion {
  versionId: string
  versionName: string
  versionType: string
  status: string
  model?: string
  createdTime?: string | null
  injected?: boolean
  sourceVersionId?: string | null
  sourceVersionName?: string | null
  runtimeCredentialId?: string | null
  runtimeCredentialName?: string | null
  runtimeRegion?: string | null
  runtimeCredentialOutdated?: boolean
}
