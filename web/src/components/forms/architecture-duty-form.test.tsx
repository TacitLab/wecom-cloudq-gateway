import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchitectureDutyForm } from '@/components/forms/architecture-duty-form'
import { api } from '@/lib/api'
import type { AdminState, ArchitectureDetail } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)
export function detailFixture(): ArchitectureDetail {
  return {
    watch: { id: 'watch-one', archId: 'arch-one', archName: '游戏服务', credentialId: 'cloud-one', credentialName: 'Cloud', versionName: 'v1', description: '', createdAt: 0 },
    products: [{ id: 'tencent:CVM', product: 'CVM', name: '云服务器', cloudProvider: 'tencent', resourceCount: 1, regions: ['ap-guangzhou'], capacitySupported: true },
      { id: 'tencent:TKE', product: 'TKE', name: '容器服务', cloudProvider: 'tencent', resourceCount: 1, regions: ['ap-shanghai'], capacitySupported: false }],
    resources: [{ id: 'ins-one', name: '业务主机', productKey: 'tencent:CVM', product: 'CVM', cloudProvider: 'tencent', region: 'ap-guangzhou', zone: 'ap-guangzhou-6', status: '运行中', nodeNames: ['核心服务'], url: '', privateIp: '', publicIp: '' }],
    regions: [{ id: 'ap-guangzhou', resourceCount: 1, products: ['CVM'] }], fetchedAt: 0,
    settings: { enabled: false, botConfigId: 'bot-one', targetChatId: '', targetChatName: '', bindCode: 'DUTYCODE', revision: 1,
      updatedAt: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: '', pollIntervalSeconds: 60,
      rcaEnabled: false, schedule: { allDay: true, start: '09:00', end: '18:00', days: [0, 1, 2, 3, 4, 5, 6] }, products: {} },
  }
}
const state: AdminState = { architectureWatches: [], agents: [], wmaCredentials: [], connections: {}, alertIntegrations: [], alertJobs: [],
  tencentCredentials: [{ id: 'cloud-one', name: 'Cloud', createdAt: '' }],
  bots: [{ id: 'bot-one', name: '运维 Bot', botId: 'remote-bot', agentConfigId: 'agent-one', agentName: 'SRE', enabled: true, showThinking: false, groupSessionScope: 'chat', welcomeText: '', placeholder: '' }] }
beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockImplementation(async (_url, options) => options?.method === 'PUT' ? { ...JSON.parse(String(options.body)), revision: 2 } : {})
})
describe('duty settings', () => {
  it('provides defaults, independent product switches and a group binding command', () => {
    render(<ArchitectureDutyForm detail={detailFixture()} state={state} onSaved={vi.fn()} />)
    expect((screen.getByLabelText('检查间隔（秒）') as HTMLInputElement).value).toBe('60')
    expect(screen.queryByRole('switch', { name: '启用架构值守' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'CVM 容量监测' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('switch', { name: 'TKE 容量监测' })).toBeNull()
    expect((screen.getByLabelText('值守群绑定指令') as HTMLInputElement).value).toBe('/bind-watch DUTYCODE')
    const common = within(screen.getByRole('region', { name: '统一值守设置' }))
    const cloud = within(screen.getByRole('region', { name: '云资源监测' }))
    const apm = within(screen.getByRole('region', { name: 'APM 应用告警' }))
    expect(common.getByRole('switch', { name: '全天值守' })).toBeTruthy()
    expect(cloud.getByRole('table', { name: '云资源监测范围' })).toBeTruthy()
    expect(apm.getByRole('button', { name: '添加 APM 应用' })).toBeTruthy()
    fireEvent.click(cloud.getByRole('switch', { name: 'CVM 纳入值守' }))
    expect((cloud.getByRole('switch', { name: 'CVM 告警推送' }) as HTMLButtonElement).disabled).toBe(true)
    expect((cloud.getByRole('switch', { name: 'CVM 容量监测' }) as HTMLButtonElement).disabled).toBe(true)
    expect((apm.getByRole('button', { name: '添加 APM 应用' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('saves schedules, product scope and RCA without local capacity thresholds', async () => {
    const onSaved = vi.fn()
    render(<ArchitectureDutyForm detail={detailFixture()} state={state} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('检查间隔（秒）'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: '配置 CVM 资源范围' }))
    fireEvent.change(screen.getByLabelText(/指定资源 ID/), { target: { value: 'ins-one' } })
    fireEvent.click(screen.getByRole('button', { name: '应用到设置' }))
    fireEvent.click(screen.getByRole('switch', { name: '全天值守' }))
    fireEvent.change(screen.getByLabelText('值守开始时间'), { target: { value: '22:30' } })
    fireEvent.change(screen.getByLabelText('值守结束时间'), { target: { value: '06:45' } })
    fireEvent.click(screen.getByRole('switch', { name: '开启 RCA 分析' }))
    expect(screen.queryByLabelText('RCA 诊断凭证（可选）')).toBeNull()
    fireEvent.click(screen.getByText('RCA 运行环境与凭证说明'))
    expect(screen.getByText(/RCA 使用所选 Bot 绑定 Agent 的使用版本和运行环境/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存值守设置' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const call = mockedApi.mock.calls.find(([, options]) => options?.method === 'PUT')
    const body = JSON.parse(String(call?.[1]?.body))
    expect(body.cpuThreshold).toBeUndefined()
    expect(body.memoryThreshold).toBeUndefined()
    expect(body.pollIntervalSeconds).toBe(75)
    expect(body.products['tencent:CVM']).toMatchObject({ metrics: true, resourceIds: ['ins-one'] })
    expect(body.schedule).toMatchObject({ allDay: false, start: '22:30', end: '06:45' })
    expect(body.rcaEnabled).toBe(true)
  })
  it('keeps unsaved choices when binding and poll status update', () => {
    const detail = detailFixture(), props = { state, onSaved: vi.fn() }
    const { rerender } = render(<ArchitectureDutyForm {...props} detail={detail} />)
    fireEvent.change(screen.getByLabelText('检查间隔（秒）'), { target: { value: '68' } })
    fireEvent.click(screen.getByRole('button', { name: '配置 CVM 资源范围' }))
    fireEvent.change(screen.getByLabelText(/指定资源 ID/), { target: { value: 'ins-one, ' } })
    rerender(<ArchitectureDutyForm {...props} detail={{ ...detail, settings: { ...detail.settings, targetChatId: 'group-live', updatedAt: 10, lastSuccessAt: 10 } }} />)
    expect((screen.getByLabelText('检查间隔（秒）') as HTMLInputElement).value).toBe('68')
    expect((screen.getAllByLabelText(/指定资源 ID/)[0] as HTMLInputElement).value).toBe('ins-one, ')
    expect(screen.getByText('group-live')).toBeTruthy()
  })
  it('cancels precision changes and rejects resources outside the selected product', async () => {
    const onSaved = vi.fn()
    render(<ArchitectureDutyForm detail={detailFixture()} state={state} onSaved={onSaved} />)
    expect(screen.queryByLabelText(/指定资源 ID/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '配置 CVM 资源范围' }))
    fireEvent.change(screen.getByLabelText(/指定资源 ID/), { target: { value: 'ins-foreign' } })
    fireEvent.click(screen.getByRole('button', { name: '应用到设置' }))
    expect(screen.getByRole('alert').textContent).toContain('当前产品绑定')
    fireEvent.change(screen.getByLabelText(/指定资源 ID/), { target: { value: 'ins-one' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '保存值守设置' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onSaved.mock.calls[0][0].products['tencent:CVM'].resourceIds).toEqual([])
  })
  it('keeps the draft and form available after save failure', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Invalid 检查间隔'))
    const onSaved = vi.fn()
    render(<ArchitectureDutyForm detail={detailFixture()} state={state} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('检查间隔（秒）'), { target: { value: '62' } })
    fireEvent.click(screen.getByRole('button', { name: '保存值守设置' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '保存值守设置' }) as HTMLButtonElement).disabled).toBe(false))
    expect(onSaved).not.toHaveBeenCalled()
    expect((screen.getByLabelText('检查间隔（秒）') as HTMLInputElement).value).toBe('62')
  })
})
