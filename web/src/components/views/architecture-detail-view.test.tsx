import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ArchitectureDetailView } from '@/components/views/architecture-detail-view'
import { ArchitectureWatchesView } from '@/components/views/architecture-watches-view'
import { api } from '@/lib/api'
import { parseView, parseWatchId } from '@/lib/views'
import type { AdminState, ArchitectureDetail } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/components/architecture-original-diagram', () => ({ ArchitectureOriginalDiagram: ({ onNodeSelect }: { onNodeSelect: (id: string) => void }) => <div><button onClick={() => onNodeSelect('node-one')}>图中服务节点</button></div> }))
vi.mock('@/components/architecture-capacity', () => ({ ArchitectureCapacity: () => <div>云端容量组件</div> }))
vi.mock('@/components/architecture-region-map', () => ({ ArchitectureRegionMap: () => <div>自适应地域地图</div> }))
const settings = { enabled: false, botConfigId: '', targetChatId: '', targetChatName: '', bindCode: 'CODE', revision: 1, updatedAt: 0,
  lastAttemptAt: null, lastSuccessAt: null, lastError: '', pollIntervalSeconds: 60,
  rcaEnabled: false, schedule: { allDay: true, start: '09:00', end: '18:00', days: [0, 1, 2, 3, 4, 5, 6] }, products: {} }
const detail: ArchitectureDetail = { watch: { id: 'watch-one', archId: 'arch-one', archName: '游戏服务', credentialId: 'key', credentialName: 'Cloud', description: '', versionName: 'v1', createdAt: 0 },
  products: [{ id: 'tencent:CVM', product: 'CVM', name: '云服务器', cloudProvider: 'tencent', resourceCount: 1, regions: ['ap-guangzhou'], capacitySupported: true }],
  resources: [{ id: 'ins-one', name: '业务主机', productKey: 'tencent:CVM', product: 'CVM', cloudProvider: 'tencent', region: 'ap-guangzhou', zone: '', status: '运行中', nodeNames: ['服务'], url: '', privateIp: '', publicIp: '' }],
  nodes: [{ id: 'node-one', name: '服务', product: 'CVM', bindingNodeIds: ['node-one'], resourceKeys: ['tencent:CVM:ap-guangzhou:ins-one'], resourceCount: 1 }],
  regions: [{ id: 'ap-guangzhou', resourceCount: 1, products: ['CVM'] }], settings, fetchedAt: 0 }
const state: AdminState = { architectureWatches: [detail.watch], bots: [], agents: [], wmaCredentials: [], tencentCredentials: [{ id: 'key', name: 'Cloud', createdAt: '' }], connections: {}, alertIntegrations: [], alertJobs: [] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api).mockImplementation(async url => url.includes('/nodes/') ? { node: detail.nodes![0], fetchedAt: 0, alarmWindowHours: 24, warnings: [], errors: [], resources: [{ ...detail.resources[0], capacity: { riskLevel: 3, stale: false, updatedAt: 1, periodDays: 14, metrics: [{ name: 'CPU利用率', value: 93, riskLevel: 3 }] }, alarms: { complete: true, errors: [], warnings: [], items: [{ id: 'alarm-1', status: 'ALARM', title: '主机告警', content: 'CPU高负载', firstOccurTime: 1, lastOccurTime: 1 }] } }] } : url.includes('/history') ? { items: [], checks: [], totalCount: 0, pageNumber: 1, pageSize: 20 } : detail)
})
it('opens architecture details while the external link stays independent', async () => {
  const onOpen = vi.fn()
  render(<ArchitectureWatchesView state={state} reload={vi.fn()} onOpen={onOpen} onSetupCredential={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '游戏服务' }))
  expect(onOpen).toHaveBeenCalledWith('watch-one')
  onOpen.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '游戏服务的更多操作' }))
  const link = await screen.findByRole('link', { name: '腾讯云架构图' })
  expect(link.getAttribute('href')).toBe('https://console.cloud.tencent.com/advisor?archId=arch-one')
  fireEvent.click(link)
  expect(onOpen).not.toHaveBeenCalled()
  expect(parseView('#architecture-watches/watch-one')).toBe('architecture-watches')
  expect(parseWatchId('#architecture-watches/watch-one')).toBe('watch-one')
})
it('shows the original diagram first and reads resources, metrics and alarms only for the selected node', async () => {
  render(<ArchitectureDetailView id="watch-one" state={state} reloadState={vi.fn()} onBack={vi.fn()} />)
  await screen.findByRole('heading', { name: '游戏服务' })
  expect(screen.getByRole('tab', { name: '架构图' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('业务主机')).toBeNull()
  expect(screen.queryByText('资源清单')).toBeNull()
  expect(screen.queryByText('云端容量组件')).toBeNull()
  expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('/nodes/'))).toBe(false)
  expect(screen.queryByRole('combobox', { name: '选择架构节点' })).toBeNull()
  expect(screen.queryByText(/智能顾问原始架构图 ·/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '图中服务节点' }))
  await screen.findByText('CPU高负载')
  expect(screen.getByText('业务主机')).toBeTruthy()
  expect(screen.getByText('CPU利用率')).toBeTruthy()
  expect(screen.getByText('93 · 高负载')).toBeTruthy()
  expect(screen.getByText('主机告警')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '值守设置' }))
  expect(await screen.findByRole('button', { name: '配置 CVM 资源范围' })).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '历史记录' }))
  await waitFor(() => expect(screen.getByText(/尚无值守事件/)).toBeTruthy())
})
it('keeps the two content blocks and routes an unconfigured enable to settings', async () => {
  render(<ArchitectureDetailView id="watch-one" state={state} reloadState={vi.fn()} onBack={vi.fn()} />)
  await screen.findByRole('heading', { name: '游戏服务' })
  expect(screen.getByText('自适应地域地图')).toBeTruthy()
  expect(screen.queryByText('清除节点筛选')).toBeNull()
  fireEvent.click(screen.getByRole('switch', { name: '快捷启用架构值守' }))
  expect(await screen.findByRole('button', { name: '保存值守设置' })).toBeTruthy()
  expect(screen.queryByRole('switch', { name: '启用架构值守' })).toBeNull()
  expect(vi.mocked(api).mock.calls.some(([url]) => url.endsWith('/enabled'))).toBe(false)
})

it('allows enabling an APM-only watch from the overview', async () => {
  const configured = { ...settings, botConfigId: 'bot-one', apmApplications: [{ region: 'ap-guangzhou', instanceId: 'apm-one', instanceName: '生产', serviceName: 'checkout' }] }
  vi.mocked(api).mockImplementation(async url => url.endsWith('/enabled') ? { ...configured, enabled: true } : { ...detail, settings: configured })
  render(<ArchitectureDetailView id="watch-one" state={state} reloadState={vi.fn()} onBack={vi.fn()} />)
  await screen.findByRole('heading', { name: '游戏服务' })
  fireEvent.click(screen.getByRole('switch', { name: '快捷启用架构值守' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.endsWith('/enabled'))).toBe(true))
})

it('shows check warnings at the top with auto-close and does not replay identical warnings on polling', async () => {
  vi.useFakeTimers()
  const warn = vi.spyOn(toast, 'warning'), dismiss = vi.spyOn(toast, 'dismiss')
  const lastError = 'ins-one：容量结果不可用；ins-two：容量任务尚未完成'
  const settingsWithWarning = { ...detail.settings, lastError }
  vi.mocked(api).mockImplementation(async url => url.endsWith('/settings') ? settingsWithWarning : { ...detail, settings: settingsWithWarning })
  const rendered = render(<ArchitectureDetailView id="watch-one" state={state} reloadState={vi.fn()} onBack={vi.fn()} />)
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('最近检查有 2 项提示', expect.objectContaining({ position: 'top-center', duration: 6000, closeButton: true }))
    expect(screen.queryByText(lastError)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(warn).toHaveBeenCalledOnce()
    const options = warn.mock.calls[0][1]!
    expect(options.action && typeof options.action === 'object' && 'label' in options.action && options.action.label).toBe('查看记录')
  } finally {
    rendered.unmount(); warn.mockRestore(); dismiss.mockRestore(); vi.useRealTimers()
  }
})
