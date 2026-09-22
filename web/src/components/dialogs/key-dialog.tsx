import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KeyForm } from '@/components/forms/key-form'
import type { ApiKeyConfig } from '@/lib/types'

export function KeyDialog({
  open,
  record,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: ApiKeyConfig
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>企业 API Key</DialogTitle>
          <DialogDescription>
            在 WorkBuddy 企业后台（企业智能体 → Agent → 接入 → 开发集成-API集成）获取企业 API
            Key；个人 PAT（pt_ 开头）无法看到企业智能体。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <KeyForm
            key={record?.id ?? 'new'}
            record={record}
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
