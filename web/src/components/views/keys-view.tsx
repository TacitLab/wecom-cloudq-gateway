import { toast } from 'sonner'

import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
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
import type { AdminState, RemoteAgent } from '@/lib/types'

export function KeysView({
  state,
  reload,
  onEdit,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onEdit: (id?: string) => void
}) {
  async function testKey(id: string) {
    try {
      const r = await toastTask(
        api<{ items: RemoteAgent[] }>(`/api/admin/keys/${id}/agents`, { method: 'POST', body: '{}' }),
        '正在验证 API Key…',
        (r) => `验证通过，该 Key 可见 ${r.items?.length ?? 0} 个 Agent`,
      )
      if (!(r.items?.length ?? 0))
        toast.warning('未拉到任何 Agent——请确认是 WorkBuddy API Key，而非个人 PAT（pt_ 开头）')
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function removeKey(id: string) {
    try {
      await toastTask(api(`/api/admin/keys/${id}`, { method: 'DELETE' }), '删除中…', 'API Key 已删除')
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="WorkBuddy API Key"
      hint="保存 WorkBuddy 企业后台的 API 集成 Key；新增 CloudAgent 时选择 Key 即可自动拉取 Agent 列表。"
      action={<Button onClick={() => onEdit()}>新增 Key</Button>}
    >
      {!state ? (
        <TableSkeleton rows={3} />
      ) : state.apiKeys.length === 0 ? (
        <div className="border-t py-8 text-center text-sm text-muted-foreground">
          尚未配置 WorkBuddy API Key。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.apiKeys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {k.apiKeyMasked || '****'}
                  </code>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(k.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => testKey(k.id)}>
                      测试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEdit(k.id)}>
                      编辑
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm" className="text-destructive">
                          删除
                        </Button>
                      }
                      title="确认删除这个 WorkBuddy API Key？"
                      onConfirm={() => removeKey(k.id)}
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
