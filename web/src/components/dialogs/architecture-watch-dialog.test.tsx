import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchitectureWatchDialog } from '@/components/dialogs/architecture-watch-dialog'
import { api } from '@/lib/api'
import type { AdminState, TencentArchitecture } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)
const arch: TencentArchitecture = { archId: 'arch-production', archName: '生产架构', description: '核心业务', versionName: 'v1', updatedAt: '' }
function state(): AdminState {
  return { agents: [], bots: [], connections: {}, alertIntegrations: [], alertJobs: [], architectureWatches: [], wmaCredentials: [],
    tencentCredentials: [{ id: 'key-one', name: '生产凭证', createdAt: '' }, { id: 'key-two', name: '测试凭证', createdAt: '' }] }
}
beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockImplementation(async url => url.includes('/architectures?') ? { items: [arch], totalCount: 41 } : {})
})
describe('architecture selection', () => {
  it('adds only the selected credential and architecture ID, then refreshes and closes', async () => {
    const onSaved = vi.fn(), onOpenChange = vi.fn()
    render(<ArchitectureWatchDialog state={state()} onSaved={onSaved} onOpenChange={onOpenChange} />)
    expect((screen.getByRole('button', { name: '添加到值守列表' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(await screen.findByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '添加到值守列表' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const save = mockedApi.mock.calls.find(([url]) => url === '/api/admin/architecture-watches')
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({ credentialId: 'key-one', archId: arch.archId })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
  it('clears selection on paging and uses server-side name search from page one', async () => {
    render(<ArchitectureWatchDialog state={state()} onSaved={vi.fn()} onOpenChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => url.includes('pageNumber=2'))).toBe(true))
    expect((screen.getByRole('button', { name: '添加到值守列表' }) as HTMLButtonElement).disabled).toBe(true)
    await screen.findByRole('radio')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索架构图名称' }), { target: { value: '业务' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => url.includes('pageNumber=1') && new URL(url, 'http://test').searchParams.get('search') === '业务')).toBe(true))
  })
  it('disables an already added diagram for its credential', async () => {
    const current = state()
    current.architectureWatches.push({ ...arch, id: 'saved', credentialId: 'key-one', credentialName: '生产凭证', createdAt: 0 })
    render(<ArchitectureWatchDialog state={current} onSaved={vi.fn()} onOpenChange={vi.fn()} />)
    expect((await screen.findByRole('radio') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '添加到值守列表' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not show stale results from a previous credential', async () => {
    let release!: (value: unknown) => void
    const old = new Promise(resolve => { release = resolve })
    mockedApi.mockImplementation(async url => url.includes('/key-one/') ? old : { items: [{ ...arch, archName: '测试账号架构' }], totalCount: 1 })
    render(<ArchitectureWatchDialog state={state()} onSaved={vi.fn()} onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox', { name: '腾讯云凭证' }))
    const option = await screen.findByRole('option', { name: '测试凭证' })
    fireEvent.pointerDown(option, { pointerType: 'mouse' }); fireEvent.click(option)
    await screen.findByText('测试账号架构')
    await act(async () => release({ items: [{ ...arch, archName: '过期账号架构' }], totalCount: 1 }))
    expect(screen.queryByText('过期账号架构')).toBeNull()
    expect((screen.getByRole('button', { name: '添加到值守列表' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows query failures with a retry and keeps failed additions open', async () => {
    mockedApi.mockRejectedValueOnce(new Error('无读取权限'))
    const onOpenChange = vi.fn(), onSaved = vi.fn()
    render(<ArchitectureWatchDialog state={state()} onSaved={onSaved} onOpenChange={onOpenChange} />)
    expect((await screen.findByRole('alert')).textContent).toContain('无读取权限')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    fireEvent.click(await screen.findByRole('radio'))
    mockedApi.mockRejectedValueOnce(new Error('架构图已被删除'))
    fireEvent.click(screen.getByRole('button', { name: '添加到值守列表' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '添加到值守列表' }) as HTMLButtonElement).disabled).toBe(false))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
