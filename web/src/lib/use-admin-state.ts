import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { AdminState } from '@/lib/types'

export function useAdminState() {
  const [state, setState] = useState<AdminState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedOnce = useRef(false)

  const reload = useCallback(async () => {
    try {
      const next = await api<AdminState>('/api/admin/state')
      loadedOnce.current = true
      setState(next)
      setError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!loadedOnce.current) setError(message)
      else toast.error(message)
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), 10000)
    return () => clearInterval(timer)
  }, [reload])

  return { state, error, reload }
}
