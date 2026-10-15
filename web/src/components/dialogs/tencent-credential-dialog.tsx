import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TencentCredentialForm } from '@/components/forms/tencent-credential-form'
import type { TencentCredentialConfig } from '@/lib/types'

export function TencentCredentialDialog({
  open,
  record,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: TencentCredentialConfig
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>腾讯云凭证</DialogTitle>
          <DialogDescription>
            在腾讯云控制台（访问管理 → API 密钥管理）获取 SecretId / SecretKey，用于告警 RCA
            轮询腾讯云监控。
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TencentCredentialForm
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
