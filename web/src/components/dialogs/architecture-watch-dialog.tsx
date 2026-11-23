import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { AdminState, TencentArchitecture } from '@/lib/types'

export function ArchitectureWatchDialog({ state, onOpenChange, onSaved }: {
  state: AdminState
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [credentialId, setCredentialId] = useState(state.tencentCredentials[0]?.id ?? '')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [items, setItems] = useState<TencentArchitecture[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<TencentArchitecture | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const pageSize = 20
  const added = new Set((state.architectureWatches ?? []).filter(w => w.credentialId === credentialId).map(w => w.archId))

  function resetList() {
    setLoading(true)
    setError('')
    setItems([])
    setSelected(null)
  }

  function refreshList() {
    resetList()
    setRefresh(v => v + 1)
  }

  useEffect(() => {
    if (!credentialId) return
    const controller = new AbortController()
    const query = new URLSearchParams({ pageNumber: String(page), pageSize: String(pageSize), search })
    api<{ items: TencentArchitecture[]; totalCount: number }>(
      `/api/admin/tencent-credentials/${encodeURIComponent(credentialId)}/architectures?${query}`,
      { signal: controller.signal },
    ).then(result => {
      if (controller.signal.aborted) return
      setItems(result.items)
      setTotal(result.totalCount)
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [credentialId, page, search, refresh])

  async function save() {
    if (!selected || loading || added.has(selected.archId) || submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      await api('/api/admin/architecture-watches', {
        method: 'POST', body: JSON.stringify({ credentialId, archId: selected.archId }),
      })
      toast.success('架构图已添加')
      onOpenChange(false)
      await onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!saving) onOpenChange(open) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>添加架构图</DialogTitle>
          <DialogDescription>从当前凭证可访问的腾讯云智能顾问架构图中选择一张，添加到值守列表。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="architecture-credential">腾讯云凭证</Label>
          <Select value={credentialId} disabled={saving} onValueChange={value => {
            resetList(); setCredentialId(value ?? ''); setPage(1); setSearch(''); setSearchDraft('')
          }}>
            <SelectTrigger id="architecture-credential"><SelectValue>{value => state.tencentCredentials.find(c => c.id === value)?.name ?? '请选择凭证'}</SelectValue></SelectTrigger>
            <SelectContent>{state.tencentCredentials.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">仅显示所选凭证所属账号可访问的架构图。</p>
        </div>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(searchDraft.trim()); refreshList() }}>
          <Input aria-label="搜索架构图名称" placeholder="搜索架构图名称" maxLength={100} value={searchDraft} disabled={saving}
            onChange={e => setSearchDraft(e.target.value)} />
          <Button type="submit" variant="outline" disabled={saving || !credentialId}><Search /><span className="sr-only sm:not-sr-only">搜索</span></Button>
          <Button type="button" variant="outline" aria-label="刷新架构图" disabled={loading || saving || !credentialId} onClick={refreshList}><RefreshCw /></Button>
        </form>
        <div className="max-h-80 min-h-40 overflow-y-auto rounded-lg border" aria-busy={loading}>
          {loading ? <p className="p-8 text-center text-sm text-muted-foreground" role="status">正在查询架构图…</p>
            : error ? <div className="p-6 text-center"><p role="alert" className="text-sm text-destructive">{error}</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={refreshList}>重试</Button></div>
            : !items.length ? <p className="p-8 text-center text-sm text-muted-foreground">{search ? '没有匹配的架构图，请调整搜索名称。' : '当前账号暂无可访问的架构图，请检查凭证权限或前往腾讯云智能顾问创建。'}</p>
            : <div role="radiogroup" aria-label="选择架构图">{items.map(arch => (
              <label key={arch.archId} className={`flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0 hover:bg-muted/50 ${selected?.archId === arch.archId ? 'bg-muted' : ''} ${added.has(arch.archId) ? 'opacity-60' : ''}`}>
                <input type="radio" name="architecture" className="mt-1" value={arch.archId} checked={selected?.archId === arch.archId}
                  disabled={saving || added.has(arch.archId)} onChange={() => setSelected(arch)} />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-medium">{arch.archName} {added.has(arch.archId) && <Badge variant="secondary">已添加</Badge>}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{arch.archId}{arch.versionName && ` · ${arch.versionName}`}</div>
                  {arch.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{arch.description}</p>}
                </div>
              </label>
            ))}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{!loading && !error ? `共 ${total} 张 · 第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页` : '架构图列表'}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={loading || saving || page <= 1} onClick={() => { resetList(); setPage(p => p - 1) }}>上一页</Button>
            <Button variant="outline" size="sm" disabled={loading || saving || Boolean(error) || page * pageSize >= total} onClick={() => { resetList(); setPage(p => p + 1) }}>下一页</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!selected || loading || saving || added.has(selected.archId)} onClick={() => void save()}>{saving ? '添加中…' : '添加到值守列表'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
