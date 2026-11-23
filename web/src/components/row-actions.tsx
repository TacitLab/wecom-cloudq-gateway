import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'

export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${label}的更多操作`} title="更多操作" />}><MoreHorizontal /></PopoverTrigger>
    <PopoverContent align="end" className="w-44 gap-1 p-2 [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start [&_[data-slot=button]]:border-transparent [&_[data-slot=button]]:shadow-none">
      <PopoverTitle className="truncate px-2 py-1.5 text-xs text-muted-foreground">{label}</PopoverTitle>
      {children}
    </PopoverContent>
  </Popover>
}
