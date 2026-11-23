import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useAdminState } from '@/lib/use-admin-state'
import type { AdminState } from '@/lib/types'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const empty: AdminState = { bots: [], agents: [], wmaCredentials: [], tencentCredentials: [], architectureWatches: [], connections: {}, alertIntegrations: [], alertJobs: [] }
beforeEach(() => vi.clearAllMocks())

it('retains the last good data and reports a failed refresh, then clears the error on recovery', async () => {
  vi.mocked(api).mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(empty)
  const { result } = renderHook(() => useAdminState())
  await waitFor(() => expect(result.current.state).toEqual(empty))
  const updatedAt = result.current.updatedAt
  await act(() => result.current.reload())
  expect(result.current.state).toEqual(empty)
  expect(result.current.error).toBe('网络暂不可用')
  expect(result.current.updatedAt).toBe(updatedAt)
  expect(result.current.refreshing).toBe(false)
  await act(() => result.current.reload())
  expect(result.current.error).toBeNull()
})

it('does not let an older background response replace data refreshed after saving', async () => {
  let resolveOld!: (state: AdminState) => void
  const old = new Promise<AdminState>(resolve => { resolveOld = resolve })
  const fresh = { ...empty, connections: { bot: { status: 'authenticated' } } }
  vi.mocked(api).mockReturnValueOnce(old).mockResolvedValueOnce(fresh)
  const { result, unmount } = renderHook(() => useAdminState())
  const oldSignal = vi.mocked(api).mock.calls[0][1]?.signal
  await act(() => result.current.reload())
  expect(oldSignal?.aborted).toBe(true)
  expect(result.current.state).toEqual(fresh)
  await act(async () => { resolveOld(empty); await old })
  expect(result.current.state).toEqual(fresh)
  unmount()
})
