import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { VIEW_META, type ViewKey } from '@/lib/views'

export function SiteHeader({
  view,
  onlineCount,
}: {
  view: ViewKey
  onlineCount: number
}) {
  const meta = VIEW_META[view]
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight">{meta.title}</h1>
        <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
      </div>
      {view === 'pairings' && (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          <strong className="font-semibold text-green-600">{onlineCount}</strong> 个长连接已认证
        </span>
      )}
    </header>
  )
}
