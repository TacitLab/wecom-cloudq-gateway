import { ChevronRight, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { VIEW_META, type ViewKey } from '@/lib/views'

export function SiteHeader({ view, refreshing, updatedAt, error, onRefresh, onSearch, detail }: {
  view: ViewKey; refreshing: boolean; updatedAt: Date | null; error: string | null
  onRefresh: () => void; onSearch: () => void; detail: boolean
}) {
  const meta = VIEW_META[view]
  return <header className="site-header">
    <SidebarTrigger className="-ml-1" />
    <div className="mx-1 h-4 w-px bg-border" />
    <nav aria-label="当前位置" className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="hidden text-muted-foreground sm:inline">{meta.group}</span>
      <ChevronRight aria-hidden="true" className="hidden size-3 text-muted-foreground sm:block" />
      <span className="truncate font-medium">{meta.title}</span>
      {detail && <><ChevronRight className="size-3 text-muted-foreground" /><span className="whitespace-nowrap text-muted-foreground">架构详情</span></>}
    </nav>
    <span className={`hidden items-center gap-2 text-xs sm:flex ${error ? 'text-amber-700' : 'text-muted-foreground'}`} title={error || (updatedAt ? `最近同步 ${updatedAt.toLocaleTimeString()}` : '正在获取数据')}>
      <span className={`size-1.5 rounded-full ${error ? 'bg-amber-500' : updatedAt ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {error ? '同步异常' : updatedAt ? '每 10 秒自动同步' : '正在连接'}
    </span>
    <Button variant="ghost" size="icon" aria-label="刷新数据" title="刷新数据" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? 'animate-spin' : ''} /></Button>
    <Button variant="outline" size="sm" aria-label="快速跳转" onClick={onSearch}><Search /><span className="hidden md:inline">快速跳转</span></Button>
  </header>
}
