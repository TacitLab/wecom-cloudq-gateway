import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArchitectureApmField } from './architecture-apm-field'
import { api } from '@/lib/api'
import type { ApmApplication } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)
const app: ApmApplication = { region: 'ap-guangzhou', instanceId: 'apm-test', instanceName: '生产系统', serviceName: 'checkout' }
function Harness({ initial = [] }: { initial?: ApmApplication[] }) {
  const [value, onChange] = useState(initial)
  return <ArchitectureApmField watchId="watch" value={value} onChange={onChange} />
}
beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockImplementation(async (url) => {
    if (url.endsWith('apm-instances')) return { items: [app] }
    if (url.includes('apm-applications')) return { items: [app] }
    return { items: [{ ...app, policies: [{ id: 'policy-one', name: '全应用错误率', namespace: 'performance_metric', enabled: false,
      match: 'conditional', reason: '另有接口条件', filter: {}, condition: {}, groupBy: [] }] }], complete: true }
  })
})

it('selects a cloud application, discovers its policies, and removes it without changing cloud configuration', async () => {
  render(<Harness />)
  expect(mockedApi).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '添加 APM 应用' }))
  await screen.findByRole('option', { name: /生产系统/ })
  fireEvent.change(screen.getByLabelText('APM 业务系统'), { target: { value: JSON.stringify([app.region, app.instanceId]) } })
  fireEvent.click(await screen.findByRole('checkbox', { name: '关联 checkout' }))
  const strategies = await screen.findByText('关联策略：1 条')
  expect(strategies.closest('details')?.open).toBe(false)
  fireEvent.click(strategies)
  expect(strategies.closest('details')?.open).toBe(true)
  expect(screen.getByText('全应用错误率')).toBeTruthy()
  expect(screen.getByText('已停用')).toBeTruthy()
  expect(mockedApi.mock.calls.find(([url]) => url.endsWith('/apm-policies'))?.[1]?.body).toBe(JSON.stringify({ applications: [app] }))
  fireEvent.click(screen.getByRole('button', { name: '移除 checkout' }))
  expect(screen.getByText('未关联 APM 应用。')).toBeTruthy()
  expect((screen.getByRole('checkbox', { name: '关联 checkout' }) as HTMLInputElement).checked).toBe(false)
})

it('retains existing selections and displays discovery errors instead of a false zero-policy result', async () => {
  mockedApi.mockRejectedValue(new Error('APM permission denied'))
  render(<Harness initial={[app]} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('permission denied'))
  expect(screen.getByRole('button', { name: '移除 checkout' })).toBeTruthy()
  expect(screen.queryByText(/发现 0 条/)).toBeNull()
})

it('shows undecidable strategy coverage explicitly', async () => {
  mockedApi.mockResolvedValue({ items: [{ ...app, policies: [{ id: 'unknown', name: '复杂策略', enabled: true, match: 'unknown', reason: '范围待核对' }] }], complete: false })
  render(<Harness initial={[app]} />)
  await screen.findByText('复杂策略')
  expect(screen.getByRole('alert').textContent).toContain('暂无法判定')
})
