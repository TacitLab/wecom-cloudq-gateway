import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArchitecturePreviews } from '@/components/architecture-previews'
import { ArchitectureThumbnail } from '@/components/architecture-thumbnail'
import { api } from '@/lib/api'
import type { ArchitectureDutySettings, ArchitectureWatch } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const settings: ArchitectureDutySettings = {
  enabled: true, botConfigId: 'bot', targetChatId: 'chat', targetChatName: '运维群', bindCode: '', revision: 1,
  updatedAt: 0, lastAttemptAt: 1, lastSuccessAt: Date.parse('2026-11-23T08:00:00Z'), lastError: '',
  pollIntervalSeconds: 60, rcaEnabled: false, schedule: { allDay: true, start: '', end: '', days: [] }, products: {},
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M0 0L50 50"/><text>原始架构</text></svg>'
const diagram = { svg, view: '3d', fetchedAt: 1 }
function watch(id: string, extra: Partial<ArchitectureWatch> = {}): ArchitectureWatch {
  return { id, archId: `arch-${id}`, archName: `架构 ${id}`, credentialId: 'cloud', credentialName: '生产云',
    description: '业务架构', versionName: '1.0', createdAt: 0, dutyEnabled: true, ...extra }
}
function servePreviews() {
  vi.mocked(api).mockImplementation(async url => url.endsWith('/settings') ? settings : diagram)
}

it('renders the original SVG in an isolated preview frame and avoids refetching on state polling', async () => {
  servePreviews()
  const current = watch('native')
  const { rerender, container, unmount } = render(<ArchitecturePreviews watches={[current]} onBrowse={vi.fn()} />)
  const frame = await screen.findByTitle('架构 native的原始 3D 架构图') as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.tabIndex).toBe(-1)
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  fireEvent.load(frame)
  expect(post).toHaveBeenCalledWith({ type: 'architecture-diagram-render', svg, nodes: [], preview: true }, '*')
  expect(container.querySelector('svg:not(.lucide)')).toBeNull()
  expect(screen.getByRole('link').getAttribute('href')).toBe('#architecture-watches/native')
  expect(await screen.findByText('全天 · 每 60 秒')).toBeTruthy()
  rerender(<ArchitecturePreviews watches={[{ ...current, credentialName: '更新的云账号' }]} onBrowse={vi.fn()} />)
  expect(screen.getByText('更新的云账号')).toBeTruthy()
  expect(api).toHaveBeenCalledTimes(2)
  unmount()
  render(<ArchitecturePreviews watches={[current]} onBrowse={vi.fn()} />)
  await screen.findByTitle(/的原始 3D 架构图/)
  expect(vi.mocked(api).mock.calls.filter(([url]) => url.includes('/diagram'))).toHaveLength(1)
})

it('keeps duty information and detail navigation available when the SVG fails, and supports retry', async () => {
  vi.mocked(api).mockImplementation(async url => {
    if (url.endsWith('/settings')) return settings
    throw new Error('diagram unavailable')
  })
  render(<ArchitecturePreviews watches={[watch('retry')]} onBrowse={vi.fn()} />)
  await screen.findByText('缩略图暂不可用')
  expect(screen.getByText('全天 · 每 60 秒')).toBeTruthy()
  expect(screen.getByRole('link').getAttribute('href')).toBe('#architecture-watches/retry')
  servePreviews()
  fireEvent.click(screen.getByRole('button', { name: '刷新架构预览' }))
  await screen.findByTitle(/的原始 3D 架构图/)
  expect(screen.queryByText('缩略图暂不可用')).toBeNull()
})

it('limits cloud diagram reads to three previews with active errors first', async () => {
  servePreviews()
  const items = [watch('disabled', { dutyEnabled: false, createdAt: 100 }), watch('older', { createdAt: 1 }),
    watch('newer', { createdAt: 2 }), watch('issue', { dutyError: 'timeout' }), watch('fourth')]
  const browse = vi.fn()
  render(<ArchitecturePreviews watches={items} onBrowse={browse} />)
  await waitFor(() => expect(screen.getAllByTitle(/的原始 3D 架构图/)).toHaveLength(3))
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
    '#architecture-watches/issue', '#architecture-watches/newer', '#architecture-watches/older',
  ])
  expect(vi.mocked(api).mock.calls.filter(([url]) => url.includes('/diagram'))).toHaveLength(3)
  expect(items[0].id).toBe('disabled')
  fireEvent.click(screen.getByRole('button', { name: '全部架构 · 5' }))
  expect(browse).toHaveBeenCalledOnce()
})

it('does not allow a removed preview request to replace the current architecture', async () => {
  let release!: (value: unknown) => void
  const pending = new Promise(resolve => { release = resolve })
  vi.mocked(api).mockImplementation(async url => url.endsWith('/settings') ? settings
    : url.includes('/slow/') ? pending : diagram)
  const { rerender } = render(<ArchitecturePreviews watches={[watch('slow')]} onBrowse={vi.fn()} />)
  rerender(<ArchitecturePreviews watches={[watch('current')]} onBrowse={vi.fn()} />)
  await screen.findByTitle('架构 current的原始 3D 架构图')
  await act(async () => release(diagram))
  expect(screen.queryByTitle('架构 slow的原始 3D 架构图')).toBeNull()
  const slowRequest = vi.mocked(api).mock.calls.find(([url]) => url.includes('/slow/diagram'))
  expect(slowRequest?.[1]?.signal?.aborted).toBe(true)
})

it('still shows the diagram when the lightweight settings read is unavailable', async () => {
  vi.mocked(api).mockImplementation(async url => {
    if (url.endsWith('/settings')) throw new Error('settings unavailable')
    return diagram
  })
  render(<ArchitecturePreviews watches={[watch('settings-failure')]} onBrowse={vi.fn()} />)
  await screen.findByTitle(/的原始 3D 架构图/)
  expect(screen.getAllByText('暂不可用')).toHaveLength(2)
  expect(screen.getByText('值守中')).toBeTruthy()
})

it('loads decorative card backgrounds only near the viewport and does not read duty settings', async () => {
  const originalObserver = globalThis.IntersectionObserver
  let reveal!: () => void
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { reveal = () => callback([{ isIntersecting: true }]) }
    observe() {}
    disconnect() {}
  })
  servePreviews()
  try {
    render(<ArchitectureThumbnail watch={watch('lazy-background')} decorative />)
    expect(api).not.toHaveBeenCalled()
    act(() => reveal())
    await screen.findByTitle('架构 lazy-background的原始 3D 架构图')
    expect(api).toHaveBeenCalledOnce()
    expect(vi.mocked(api).mock.calls[0][0]).toContain('/diagram?view=3d')
  } finally {
    vi.stubGlobal('IntersectionObserver', originalObserver)
  }
})
