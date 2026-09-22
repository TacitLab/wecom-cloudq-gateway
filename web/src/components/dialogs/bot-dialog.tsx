import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BotForm } from '@/components/forms/bot-form'
import type { AdminState, BotConfig } from '@/lib/types'

export function BotDialog({
  open,
  record,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: BotConfig
  state: AdminState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>企业微信 Bot 配对</DialogTitle>
        </DialogHeader>
        {open && (
          <BotForm
            key={record?.id ?? 'new'}
            record={record}
            state={state}
            onCancel={() => onOpenChange(false)}
            onSaved={async () => {
              onOpenChange(false)
              await onSaved()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
