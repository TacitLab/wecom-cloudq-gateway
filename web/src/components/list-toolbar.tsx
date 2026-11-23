import type { ReactNode } from 'react'
import { Search, SearchX, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'


export function ListToolbar({ query, onQueryChange, placeholder, count, total, children }: {
  query: string; onQueryChange: (value: string) => void; placeholder: string
  count: number; total: number; children?: ReactNode
}) {
  return <div className="list-toolbar">
    <div className="relative w-full sm:max-w-72">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" aria-label={placeholder} placeholder={placeholder} value={query} onChange={e => onQueryChange(e.target.value)} className="h-9 bg-card pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none" />
      {query && <Button variant="ghost" size="icon-sm" aria-label="清空搜索" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => onQueryChange('')}><X /></Button>}
    </div>
    {children}
    <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground" role="status">{count === total ? `共 ${total} 项` : `${count} / ${total} 项`}</span>
  </div>
}

export function FilterPills({ value, onChange, options, label = '状态筛选' }: {
  value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label?: string
}) {
  return <div className="filter-pills" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon; title: string; description: string; action?: ReactNode
}) {
  return <div className="empty-state">
    <div className="empty-state-icon"><Icon aria-hidden="true" className="size-6" /></div>
    <h3 className="text-base font-semibold">{title}</h3>
    <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
    {action && <div className="mt-2">{action}</div>}
  </div>
}

export function NoResults({ onReset }: { onReset: () => void }) {
  return <EmptyState icon={SearchX} title="没有匹配的结果" description="试试其他关键词，或清除筛选查看全部内容。" action={<Button variant="outline" size="sm" onClick={onReset}>清除筛选</Button>} />
}
