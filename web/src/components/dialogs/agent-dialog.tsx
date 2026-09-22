import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AgentForm } from '@/components/forms/agent-form'
import type { AdminState, AgentConfig } from '@/lib/types'

export function AgentDialog({
  open,
  record,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: AgentConfig
  state: AdminState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>连接 CloudAgent</DialogTitle>
          <DialogDescription>
            选择企业 API Key，从拉取的 Agent 列表中选择要绑定的 Agent。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AgentForm
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
