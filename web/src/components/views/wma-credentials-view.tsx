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

export function WmaCredentialsView({
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
        api<{ items: RemoteAgent[] }>(`/api/admin/wma-credentials/${id}/agents`, { method: 'POST', body: '{}' }),
        '正在验证 WMA 凭证…',
        (r) => `验证通过，该凭证可见 ${r.items?.length ?? 0} 个 Agent`,
      )
      if (!(r.items?.length ?? 0))
        toast.warning('未发现 Agent，请检查账号的 WMA 权限、企业身份及 Agent 归属')
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function removeKey(id: string) {
    try {
      await toastTask(api(`/api/admin/wma-credentials/${id}`, { method: 'DELETE' }), '删除中…', 'WMA 凭证已删除')
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="WMA 凭证设置"
      hint="录入腾讯云 AK/SK；新增 Agent 时选择凭证，自动拉取可访问的 WMA 智能体。"
      action={<Button onClick={() => onEdit()}>新增凭证</Button>}
    >
      {!state ? (
        <TableSkeleton rows={3} />
      ) : state.wmaCredentials.length === 0 ? (
        <div className="border-t py-8 text-center text-sm text-muted-foreground">
          尚未配置 WMA 凭证。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>SecretId（AK）</TableHead>
              <TableHead>接入地域 / 来源</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.wmaCredentials.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {k.secretIdMasked}
                  </code>
                </TableCell>
                <TableCell>{k.region}</TableCell>
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
                      title="确认删除这个 WMA 凭证？"
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
