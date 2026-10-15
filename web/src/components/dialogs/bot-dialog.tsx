import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BotForm } from '@/components/forms/bot-form'
import { BotScanForm } from '@/components/forms/bot-scan-form'
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
  const saved = async () => {
    onOpenChange(false)
    await onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>企业微信 Bot 配对</DialogTitle>
        </DialogHeader>
        {open && record && (
          <BotForm
            key={record.id}
            record={record}
            state={state}
            onCancel={() => onOpenChange(false)}
            onSaved={saved}
          />
        )}
        {open && !record && (
          <Tabs defaultValue="scan">
            <TabsList>
              <TabsTrigger value="scan">扫码创建</TabsTrigger>
              <TabsTrigger value="manual">绑定已有机器人</TabsTrigger>
            </TabsList>
            <TabsContent value="scan">
              <BotScanForm state={state} onCancel={() => onOpenChange(false)} onSaved={saved} />
            </TabsContent>
            <TabsContent value="manual">
              <BotForm
                key="new"
                state={state}
                onCancel={() => onOpenChange(false)}
                onSaved={saved}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
