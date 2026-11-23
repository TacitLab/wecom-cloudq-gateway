import { NAV_GROUPS } from '@/lib/navigation'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { VIEW_META, type ViewKey } from '@/lib/views'

export function QuickNavigation({ open, onOpenChange, onSwitch }: { open: boolean; onOpenChange: (open: boolean) => void; onSwitch: (view: ViewKey) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg" showCloseButton={false}>
      <DialogHeader><DialogTitle>跳转到工作区</DialogTitle><DialogDescription>搜索页面名称，使用 ↑ ↓ 选择，Enter 打开。</DialogDescription></DialogHeader>
      <Command><CommandInput placeholder="搜索架构、告警、Bot、凭证…" aria-label="搜索页面" />
        <CommandList><CommandEmpty>没有找到相关页面，请尝试其他关键词。</CommandEmpty>
          {NAV_GROUPS.map(group => <CommandGroup key={group.label} heading={group.label}>{group.items.map(item => <CommandItem key={item.key} value={`${item.label} ${item.key}`} onSelect={() => { onSwitch(item.key); onOpenChange(false) }} className="py-3"><item.icon /><span>{VIEW_META[item.key].title}</span></CommandItem>)}</CommandGroup>)}
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
}
