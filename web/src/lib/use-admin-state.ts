import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AdminState } from '@/lib/types'

export function useAdminState() {
  const [state, setState] = useState<AdminState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    // An explicit reload after saving must supersede any older background read.
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setRefreshing(true)
    try {
      const next = await api<AdminState>('/api/admin/state', { signal: controller.signal })
      if (!controller.signal.aborted) { setState(next); setError(null); setUpdatedAt(new Date()) }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setRefreshing(false) }
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = setInterval(() => { if (!activeRequest.current) void reload() }, 10000)
    return () => { clearInterval(timer); activeRequest.current?.abort() }
  }, [reload])

  return { state, error, reload, refreshing, updatedAt }
}
