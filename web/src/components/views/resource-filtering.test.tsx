import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PairingsView } from '@/components/views/pairings-view'
import { ArchitectureWatchesView } from '@/components/views/architecture-watches-view'
import type { AdminState, BotConfig } from '@/lib/types'

const bot: BotConfig = { id: 'online', name: '生产巡检', botId: 'bot-prod', agentConfigId: 'agent-1', agentName: 'SRE Agent', enabled: true, groupSessionScope: 'chat', welcomeText: '', placeholder: '', showThinking: false }
const state: AdminState = { bots: [bot, { ...bot, id: 'disabled', name: '测试 Bot', botId: 'bot-test', enabled: false }], agents: [], wmaCredentials: [], tencentCredentials: [], architectureWatches: [], connections: { online: { status: 'authenticated' }, disabled: { status: 'authenticated' } }, alertIntegrations: [], alertJobs: [] }

it('combines search and connection filters and restores the list on reset', () => {
  render(<PairingsView state={state} reload={vi.fn()} onEdit={vi.fn()} onSetupAgent={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '在线' }))
  expect(screen.queryByText('测试 Bot')).toBeNull()
  expect(screen.getByText('生产巡检')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
  expect(screen.getByRole('heading', { name: '没有匹配的结果' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(screen.getByText('测试 Bot')).toBeTruthy()
  expect(screen.getByText('生产巡检')).toBeTruthy()
})

it('takes an empty architecture workspace to credentials before adding a watch', () => {
  const setup = vi.fn()
  render(<ArchitectureWatchesView state={state} reload={vi.fn()} onOpen={vi.fn()} onSetupCredential={setup} />)
  fireEvent.click(screen.getByRole('button', { name: '先配置腾讯云凭证' }))
  expect(setup).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).toBeNull()
})
