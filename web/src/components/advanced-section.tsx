import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export function AdvancedSection({ children }: { children: ReactNode }) {
  return (
    <Collapsible className="rounded-lg border border-dashed px-4 py-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-aria-expanded:rotate-90" />
        高级配置（一般无需修改）
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}
