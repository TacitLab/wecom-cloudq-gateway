import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { OverviewView } from '@/components/views/overview-view'
import { getOverviewChecks } from '@/lib/overview'
import { parseView } from '@/lib/views'
import type { AdminState, AgentConfig, AlertIntegration, BotConfig } from '@/lib/types'

const empty: AdminState = {
  bots: [], agents: [], connections: {}, architectureWatches: [],
  alertIntegrations: [], alertJobs: [], wmaCredentials: [], tencentCredentials: [],
}
const bot: BotConfig = {
  id: 'bot', name: '生产 Bot', botId: 'external-bot', agentConfigId: 'agent', agentName: 'Agent',
  groupSessionScope: 'chat', welcomeText: '', placeholder: '', enabled: true, showThinking: false,
}
const agent: AgentConfig = {
  id: 'agent', name: 'Agent', agentId: 'remote-agent', credentialConfigId: 'key', credentialName: 'WMA',
  controlTimeoutMs: 1000, promptTimeoutMs: 1000, includeThinking: false, revision: 1,
  runtimeCredentialId: null, runtimeCredentialName: null, runtimeRegion: null, wmaVersionId: null,
  wmaVersionName: null, runtimeCredentialOutdated: false,
}
const integration: AlertIntegration = {
  id: 'alerts', name: '生产告警', botConfigId: 'bot', botName: '生产 Bot', agentName: 'Agent', credentialName: 'Cloud',
  monitorType: 'MT_QCE', namespace: '', pollIntervalSeconds: 60, policyIds: [], initialLookbackSeconds: 600,
  overlapSeconds: 300, includeRecovery: true, enabled: true, targetChatId: 'chat', bindCode: '',
}

it('keeps missing setup and deliberately disabled resources neutral', () => {
  const checks = getOverviewChecks({ ...empty, bots: [{ ...bot, enabled: false }], alertIntegrations: [{ ...integration, enabled: false, lastError: 'old error' }],
    architectureWatches: [{ id: 'watch', credentialId: 'cloud', credentialName: 'Cloud', archId: 'arch', archName: '测试架构', description: '', versionName: '', createdAt: 0, dutyEnabled: false, dutyError: 'old error' }],
  })
  expect(checks.every(check => check.tone === 'neutral')).toBe(true)
  render(<OverviewView state={empty} onSwitch={vi.fn()} />)
  expect(screen.getAllByText('未配置')).toHaveLength(3)
  expect(screen.queryByText('已连接')).toBeNull()
})

it('prioritizes check failures and flags incomplete alert delivery even when the Bot is online', () => {
  const checks = getOverviewChecks({ ...empty, bots: [bot], connections: { bot: { status: 'authenticated' } },
    alertIntegrations: [{ ...integration, targetChatId: null }],
    architectureWatches: [{ id: 'watch', credentialId: 'cloud', credentialName: 'Cloud', archId: 'arch', archName: '生产架构', description: '', versionName: '', createdAt: 0, dutyEnabled: true, dutyError: 'timeout' }],
  })
  expect(checks.map(check => check.view)).toEqual(['architecture-watches', 'alerts', 'pairings'])
  expect(checks.map(check => check.tone)).toEqual(['error', 'warning', 'success'])
  expect(getOverviewChecks({ ...empty, bots: [{ ...bot, agentConfigId: null }], connections: { bot: { status: 'authenticated' } } })[0].tone).toBe('warning')
})

it('continues from the first missing step and routes alert setup through its prerequisite', () => {
  const navigate = vi.fn()
  render(<OverviewView state={{ ...empty, wmaCredentials: [{ id: 'key', name: 'WMA', createdAt: '' }] }} onSwitch={navigate} />)
  fireEvent.click(screen.getByRole('button', { name: '继续配置' }))
  expect(navigate).toHaveBeenLastCalledWith('agents')
  fireEvent.click(screen.getByRole('button', { name: '配置腾讯云凭证' }))
  expect(navigate).toHaveBeenLastCalledWith('tencent-credentials')
})

it('hides the guide after setup completes and keeps it hidden during disconnection or deliberate suspension', () => {
  const configured = { ...empty, wmaCredentials: [{ id: 'key', name: 'WMA', createdAt: '' }], agents: [agent] }
  const { rerender } = render(<OverviewView state={configured} onSwitch={vi.fn()} />)
  expect(screen.getByRole('heading', { name: '接入链路' })).toBeTruthy()
  rerender(<OverviewView state={{ ...configured, bots: [bot], connections: { bot: { status: 'authenticated' } } }} onSwitch={vi.fn()} />)
  expect(screen.queryByRole('heading', { name: '接入链路' })).toBeNull()
  rerender(<OverviewView state={{ ...configured, bots: [bot], connections: { bot: { status: 'disconnected' } } }} onSwitch={vi.fn()} />)
  expect(screen.queryByRole('heading', { name: '接入链路' })).toBeNull()
  rerender(<OverviewView state={{ ...configured, bots: [{ ...bot, enabled: false }] }} onSwitch={vi.fn()} />)
  expect(screen.queryByRole('heading', { name: '接入链路' })).toBeNull()
})

it('does not treat an unbound Bot as completed setup or flash the guide while loading', () => {
  const navigate = vi.fn()
  const { rerender } = render(<OverviewView state={null} onSwitch={navigate} />)
  expect(screen.queryByRole('heading', { name: '接入链路' })).toBeNull()
  rerender(<OverviewView state={{ ...empty, wmaCredentials: [{ id: 'key', name: 'WMA', createdAt: '' }], agents: [agent], bots: [{ ...bot, agentConfigId: null }] }} onSwitch={navigate} />)
  expect(screen.getByRole('heading', { name: '接入链路' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '继续配置' }))
  expect(navigate).toHaveBeenLastCalledWith('pairings')
})

it('shows the four newest RCA jobs and preserves the source history order', () => {
  const jobs = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, integrationName: `任务 ${i}`, alarmId: `alarm-${i}`, status: 'delivered' as const, createdAt: `2026-11-${10 + i}T08:00:00Z` }))
  const navigate = vi.fn()
  render(<OverviewView state={{ ...empty, alertJobs: jobs }} onSwitch={navigate} />)
  const recent = screen.getAllByRole('button', { name: /^任务 \d/ })
  expect(recent).toHaveLength(4)
  expect(within(recent[0]).getByText('任务 5')).toBeTruthy()
  expect(screen.queryByText('任务 0')).toBeNull()
  expect(jobs[0].id).toBe('0')
  fireEvent.click(recent[0])
  expect(navigate).toHaveBeenLastCalledWith('alerts')
})

it('recognizes the overview route while rejecting non-page object keys', () => {
  expect(parseView('#overview')).toBe('overview')
  expect(parseView('#constructor')).toBeNull()
})
