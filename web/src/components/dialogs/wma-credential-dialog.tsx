import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WmaCredentialForm } from '@/components/forms/wma-credential-form'
import type { WmaCredentialConfig } from '@/lib/types'

export function WmaCredentialDialog({
  open,
  record,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: WmaCredentialConfig
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record ? '编辑 WMA 凭证' : '新增 WMA 凭证'}</DialogTitle>
          <DialogDescription>
            录入具有 WMA 访问权限的腾讯云 SecretId / SecretKey，用于拉取 Agent 列表和执行对话。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <WmaCredentialForm
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
