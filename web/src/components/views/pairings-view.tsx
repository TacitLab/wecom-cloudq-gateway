import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
import { BotStatusBadge } from '@/components/status-badges'
import { TableSkeleton } from '@/components/table-skeleton'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState } from '@/lib/types'

export function PairingsView({
  state,
  reload,
  onEdit,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onEdit: (id?: string) => void
}) {
  async function removeBot(id: string) {
    try {
      await toastTask(api(`/api/admin/bots/${id}`, { method: 'DELETE' }), '删除中…', 'Bot 配对已删除')
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="企业微信 Bot 配对"
      hint="每个 Bot 只能选择一个 CloudAgent；修改配对后，新消息自动进入新 Agent。"
      action={<Button onClick={() => onEdit()}>新增配对</Button>}
    >
      {!state ? (
        <TableSkeleton />
      ) : state.bots.length === 0 ? (
        <div className="border-t py-8 text-center text-sm text-muted-foreground">
          请先创建 CloudAgent，再新增 Bot 配对。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bot</TableHead>
              <TableHead>唯一绑定</TableHead>
              <TableHead>长连接</TableHead>
              <TableHead>群聊会话</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.bots.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="font-medium">{b.name}</div>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {b.botId}
                  </code>
                </TableCell>
                <TableCell>{b.cloudAgentName}</TableCell>
                <TableCell>
                  <BotStatusBadge bot={b} connection={state.connections[b.id]} />
                </TableCell>
                <TableCell>{b.groupSessionScope === 'user' ? '按用户' : '整个群'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => onEdit(b.id)}>
                      编辑
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm" className="text-destructive">
                          删除
                        </Button>
                      }
                      title="确认删除这个 Bot 配对？"
                      description="删除后该 Bot 的长连接会断开。"
                      onConfirm={() => removeBot(b.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PanelCard>
  )
}
