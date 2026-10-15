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
import type { AdminState } from '@/lib/types'

export function TencentCredentialsView({
  state,
  reload,
  onEdit,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onEdit: (id?: string) => void
}) {
  async function testCredential(id: string) {
    try {
      await toastTask(
        api(`/api/admin/tencent-credentials/${id}/test`, { method: 'POST', body: '{}' }),
        '正在验证腾讯云 AK/SK…',
        'AK/SK 验证通过',
      )
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function removeCredential(id: string) {
    try {
      await toastTask(
        api(`/api/admin/tencent-credentials/${id}`, { method: 'DELETE' }),
        '删除中…',
        '腾讯云凭证已删除',
      )
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="腾讯云凭证"
      hint="保存腾讯云 SecretId / SecretKey；告警 RCA 配置选择凭证即可轮询腾讯云监控。"
      action={<Button onClick={() => onEdit()}>新增凭证</Button>}
    >
      {!state ? (
        <TableSkeleton rows={3} />
      ) : state.tencentCredentials.length === 0 ? (
        <div className="border-t py-8 text-center text-sm text-muted-foreground">
          尚未配置腾讯云凭证。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>SecretId</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.tencentCredentials.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {c.secretIdMasked || '****'}
                  </code>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => testCredential(c.id)}>
                      测试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEdit(c.id)}>
                      编辑
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm" className="text-destructive">
                          删除
                        </Button>
                      }
                      title="确认删除这个腾讯云凭证？"
                      onConfirm={() => removeCredential(c.id)}
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
