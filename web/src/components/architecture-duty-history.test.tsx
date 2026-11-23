import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ArchitectureDutyHistory } from '@/components/architecture-duty-history'
import { api } from '@/lib/api'
vi.mock('@/lib/api', () => ({ api: vi.fn() }))

it('distinguishes alarm coverage from capacity coverage and distinguishes failed queries from zero alarms', async () => {
  vi.mocked(api).mockResolvedValue({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, checks: [{
    id: 'check-one', createdAt: 1, resources: 2, capacityResources: 0, highLoadResources: 0, events: 0,
    warnings: [], errors: ['上海告警查询权限不足'], error: '上海告警查询权限不足',
    alarms: { resourceCount: 2, queriedResources: 1, activeCount: 0, totalCount: 0, requests: 2, complete: false, lookbackDays: 30,
      resources: [
        { resourceId: 'prom-one', resourceName: 'Prometheus 实例', product: 'Prometheus', region: 'ap-guangzhou', status: 'checked', pushEnabled: true, activeCount: 0, totalCount: 0 },
        { resourceId: 'cls-one', resourceName: 'TKE 实例', product: 'TKE', region: 'ap-shanghai', status: 'failed', pushEnabled: true, activeCount: 0, totalCount: 0 },
      ] },
  }] })
  render(<ArchitectureDutyHistory id="watch-one" />)
  const summary = await screen.findByText(/告警已查 1\/2 个资源/)
  expect(summary.textContent).toContain('0 个容量结果')
  expect(summary.textContent).toContain('0 条未恢复告警')
  fireEvent.click(summary.closest('summary')!)
  expect(screen.getByRole('row', { name: /Prometheus 实例/ }).textContent).toContain('已查询0 / 0')
  const failed = screen.getByRole('row', { name: /TKE 实例/ })
  expect(failed.textContent).toContain('查询失败—')
  expect(screen.getByText('上海告警查询权限不足')).toBeTruthy()
})
