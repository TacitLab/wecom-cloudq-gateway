import { matchesSearch } from '@/lib/list-filters'
import { useState } from 'react'
import { ArrowRight, ExternalLink, Network, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ArchitectureWatchDialog } from '@/components/dialogs/architecture-watch-dialog'
import { ArchitectureThumbnail } from '@/components/architecture-thumbnail'
import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
import { TableSkeleton } from '@/components/table-skeleton'
import { StatusBadge } from '@/components/status-badges'
import { EmptyState, FilterPills, ListToolbar, NoResults } from '@/components/list-toolbar'
import { RowActions } from '@/components/row-actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { AdminState } from '@/lib/types'

export function ArchitectureWatchesView({ state, reload, onSetupCredential, onOpen }: {
  state: AdminState | null; reload: () => Promise<void>; onSetupCredential: () => void; onOpen: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const watches = state?.architectureWatches ?? []
  const items = watches.filter(w => matchesSearch(query, w.archName, w.archId, w.credentialName, w.description) && (filter === 'all' || (filter === 'enabled' ? w.dutyEnabled : filter === 'attention' ? w.dutyError : !w.dutyEnabled)))
  async function remove(id: string) {
    try {
      await api(`/api/admin/architecture-watches/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success('架构图已移除'); await reload()
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }
  const add = () => state?.tencentCredentials.length ? setAdding(true) : onSetupCredential()
  return <>
    <PanelCard title="架构列表"
      action={(!state || watches.length > 0) && <Button disabled={!state} onClick={add}><Plus />{state && !state.tencentCredentials.length ? '配置腾讯云凭证' : '添加架构图'}</Button>}
      toolbar={state && watches.length > 0 && <ListToolbar query={query} onQueryChange={setQuery} placeholder="搜索架构名称、ID 或凭证" count={items.length} total={watches.length}>
        <FilterPills value={filter} onChange={setFilter} options={[{value:'all',label:'全部'}, {value:'enabled',label:'值守中'}, {value:'disabled',label:'未启用'}, {value:'attention',label:'有异常'}]} />
      </ListToolbar>}>
      {!state ? <TableSkeleton rows={3} /> : !watches.length ? <EmptyState icon={Network} title="从一张架构图开始值守" description="关联腾讯云智能顾问中的业务架构，集中查看资源、监测容量与告警，并将异常推送到团队群。" action={<Button onClick={add}><Plus />{state.tencentCredentials.length ? '添加架构图' : '先配置腾讯云凭证'}</Button>} />
        : !items.length ? <NoResults onReset={() => { setQuery(''); setFilter('all') }} />
        : <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{items.map(watch => <article className="architecture-card" key={watch.id}>
          <div className="architecture-card-art" aria-hidden="true"><ArchitectureThumbnail key={`${watch.id}:${watch.credentialId}:${watch.versionName}`} watch={watch} decorative /></div>
          <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-primary"><Network className="size-5" /></div>
            <StatusBadge tone={watch.dutyError ? 'error' : watch.dutyEnabled ? 'success' : 'neutral'}>{watch.dutyError ? '检查异常' : watch.dutyEnabled ? '值守中' : '未启用值守'}</StatusBadge>
          </div>
          <div><h3><button type="button" className="text-left hover:text-primary" onClick={() => onOpen(watch.id)}>{watch.archName}</button></h3><p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{watch.archId}</p><p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{watch.description || '查看架构资源与地域分布，配置监测范围和群推送。'}</p></div>
          <dl><div><dt>云账号凭证</dt><dd>{watch.credentialName}</dd></div><div><dt>架构版本</dt><dd>{watch.versionName || '未标记版本'}</dd></div></dl>
          {watch.dutyError && <p className="line-clamp-2 text-xs text-destructive" title={watch.dutyError}>最近检查有异常，可在详情中查看记录。</p>}
          <div className="mt-auto flex items-center justify-between gap-2 border-t pt-4"><Button size="sm" variant="outline" onClick={() => onOpen(watch.id)}>查看值守<ArrowRight /></Button>
            <RowActions label={watch.archName}>
              <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(watch.archId)}`} target="_blank" rel="noopener noreferrer"><ExternalLink />腾讯云架构图</a>
              <ConfirmButton trigger={<Button variant="ghost" size="sm" className="text-destructive">移除架构</Button>} title="移除这个架构图？" description="仅从本地值守列表移除，腾讯云中的原始架构图将保留。" actionLabel="确认移除" onConfirm={() => remove(watch.id)} />
            </RowActions>
          </div>
        </article>)}</div>}
    </PanelCard>
    {adding && state && <ArchitectureWatchDialog state={state} onOpenChange={setAdding} onSaved={reload} />}
  </>
}
