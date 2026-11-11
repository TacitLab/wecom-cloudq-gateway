import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentForm } from '@/components/forms/agent-form'
import { api } from '@/lib/api'
import type { AdminState, AgentConfig, RemoteAgent, RemoteAgentVersion } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/lib/toast-task', () => ({ toastTask: (task: Promise<unknown>) => task }))
const record: AgentConfig = {
  id: 'local-agent', name: 'SRE', agentId: 'remote-agent', credentialConfigId: 'wma-key', credentialName: 'WMA',
  controlTimeoutMs: 30000, promptTimeoutMs: 1200000, includeThinking: false, revision: 1,
  runtimeCredentialId: null, runtimeCredentialName: null, runtimeRegion: null,
  wmaVersionId: 'base-version', wmaVersionName: 'default', runtimeCredentialOutdated: false,
}
function state(): AdminState {
  return { agents: [{ ...record }], bots: [], connections: {}, alertIntegrations: [], alertJobs: [],
    wmaCredentials: [{ id: 'wma-key', name: 'WMA', createdAt: '' }],
    tencentCredentials: [{ id: 'cloud-key', name: '生产只读凭证', createdAt: '' }] }
}
const remoteAgent: RemoteAgent = { agentId: record.agentId, agentName: record.name, enabled: true, existingConfigId: record.id }
const versions: RemoteAgentVersion[] = [
  { versionId: 'base-version', versionName: 'default', versionType: 'DEFAULT', status: 'ENABLED' },
  { versionId: 'latest-source', versionName: 'prod-latest', versionType: 'PROD', status: 'ENABLED' },
]
const injected: RemoteAgentVersion = { versionId: 'injected-version', versionName: 'prod-injected', versionType: 'PROD', status: 'ENABLED', injected: true,
  sourceVersionId: 'latest-source', sourceVersionName: 'prod-latest', runtimeCredentialId: 'cloud-key', runtimeCredentialName: '生产只读凭证', runtimeRegion: 'ap-shanghai' }
const mockedApi = vi.mocked(api)
function response(url: string): unknown {
  if (url.endsWith('/versions')) return { items: versions }
  if (url.endsWith('/credential-versions')) return injected
  if (url.includes('/wma-credentials/') && url.endsWith('/agents')) return { items: [remoteAgent] }
  return {}
}
beforeEach(() => { vi.clearAllMocks(); mockedApi.mockImplementation(async url => response(url)) })
async function choose(label: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.pointerDown(option, { pointerType: 'mouse' }); fireEvent.click(option)
}
async function prepareCreation() {
  fireEvent.click(screen.getByRole('button', { name: '高级配置（一般无需修改）' }))
  await choose('源版本', /prod-latest/)
  await choose('注入凭证', '生产只读凭证')
  fireEvent.change(screen.getByLabelText('云资源地域'), { target: { value: 'ap-shanghai' } })
}
describe('Agent versions and edit draft', () => {
  it('keeps all unsaved choices across admin polling and saves only the chosen usage version', async () => {
    const onSaved = vi.fn(), props = { record: { ...record }, state: state(), onSaved }
    const { rerender } = render(<StrictMode><AgentForm {...props} /></StrictMode>)
    await prepareCreation()
    await choose('使用版本', /prod-latest/)
    fireEvent.change(screen.getByLabelText('显示名称（可选）'), { target: { value: 'Edited SRE' } })
    for (let i = 0; i < 3; i++) {
      rerender(<StrictMode><AgentForm record={{ ...record }} state={state()} onSaved={onSaved} /></StrictMode>)
      expect(screen.getByRole('combobox', { name: '注入凭证' }).textContent).toContain('生产只读凭证')
      expect(screen.getByRole('combobox', { name: '源版本' }).textContent).toContain('prod-latest')
      expect(screen.getByRole('combobox', { name: '使用版本' }).textContent).toContain('prod-latest')
      expect((screen.getByLabelText('云资源地域') as HTMLInputElement).value).toBe('ap-shanghai')
      expect((screen.getByLabelText('显示名称（可选）') as HTMLInputElement).value).toBe('Edited SRE')
      expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
    }
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const save = mockedApi.mock.calls.find(([url]) => url === '/api/admin/agents/local-agent')
    expect(JSON.parse(String(save?.[1]?.body))).toMatchObject({ wmaVersionId: 'latest-source', name: 'Edited SRE' })
    expect(JSON.parse(String(save?.[1]?.body))).not.toHaveProperty('runtimeCredentialId')
    expect(mockedApi.mock.calls.some(([url]) => url.endsWith('/credential-versions'))).toBe(false)
  })
  it('creates from an explicit source, leaves the usage version unchanged, and requires selection plus save', async () => {
    const onSaved = vi.fn()
    render(<AgentForm record={record} state={state()} onSaved={onSaved} />)
    await prepareCreation()
    fireEvent.click(screen.getByRole('button', { name: '创建凭证注入版' }))
    await screen.findByRole('button', { name: '选择此注入版' })
    expect(screen.getByRole('combobox', { name: '使用版本' }).textContent).toContain('default')
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockedApi.mock.calls.some(([url]) => url === '/api/admin/agents/local-agent')).toBe(false)
    const creation = mockedApi.mock.calls.find(([url]) => url.endsWith('/credential-versions'))
    expect(JSON.parse(String(creation?.[1]?.body))).toEqual({ agentId: 'remote-agent', sourceVersionId: 'latest-source', runtimeCredentialId: 'cloud-key', runtimeRegion: 'ap-shanghai' })
    fireEvent.click(screen.getByRole('button', { name: '选择此注入版' }))
    expect(screen.getByRole('combobox', { name: '使用版本' }).textContent).toContain('prod-injected')
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const save = mockedApi.mock.calls.find(([url]) => url === '/api/admin/agents/local-agent')
    expect(JSON.parse(String(save?.[1]?.body)).wmaVersionId).toBe('injected-version')
  })
  it('retains the usage version when injection creation fails', async () => {
    mockedApi.mockImplementation(url => url.endsWith('/credential-versions') ? Promise.reject(new Error('creation failed')) : Promise.resolve(response(url)))
    const onSaved = vi.fn()
    render(<AgentForm record={record} state={state()} onSaved={onSaved} />)
    await prepareCreation()
    fireEvent.click(screen.getByRole('button', { name: '创建凭证注入版' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '创建凭证注入版' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('combobox', { name: '使用版本' }).textContent).toContain('default')
    expect(onSaved).not.toHaveBeenCalled()
  })
  it('does not lock saving an existing Agent while remote discovery is pending across a poll', async () => {
    let resolveAgents!: (value: { items: RemoteAgent[] }) => void
    const pending = new Promise<{ items: RemoteAgent[] }>(resolve => { resolveAgents = resolve })
    mockedApi.mockImplementation(url => url.includes('/wma-credentials/') && url.endsWith('/agents') ? pending : Promise.resolve(response(url)))
    const onSaved = vi.fn(), { rerender } = render(<AgentForm record={{ ...record }} state={state()} onSaved={onSaved} />)
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(<AgentForm record={{ ...record }} state={state()} onSaved={onSaved} />)
    await act(async () => { resolveAgents({ items: [remoteAgent] }) })
    expect((screen.getByRole('button', { name: '刷新 Agent 列表' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('still allows saving the existing choice when remote discovery fails', async () => {
    mockedApi.mockImplementation(url => url.includes('/wma-credentials/') && url.endsWith('/agents') ? Promise.reject(new Error('unavailable')) : Promise.resolve(response(url)))
    const onSaved = vi.fn()
    render(<AgentForm record={record} state={state()} onSaved={onSaved} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新 Agent 列表' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
  it('requires selecting an Agent for new configurations', async () => {
    render(<AgentForm state={state()} onSaved={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '刷新 Agent 列表' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
