import { matchesSearch } from '@/lib/list-filters'
import { useState } from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import { EmptyState, ListToolbar, NoResults } from '@/components/list-toolbar'
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
  const [query, setQuery] = useState('')
  const items = (state?.tencentCredentials ?? []).filter(c => matchesSearch(query, c.name, c.secretIdMasked))

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
      title="云账号凭证"
      hint="保存腾讯云 SecretId / SecretKey，供 Agent 运行时云认证和告警 RCA 使用。"
      toolbar={state && state.tencentCredentials.length > 0 && <ListToolbar query={query} onQueryChange={setQuery} placeholder="搜索凭证名称或 SecretId" count={items.length} total={state.tencentCredentials.length} />}
      action={(!state || state.tencentCredentials.length > 0) && <Button disabled={!state} onClick={() => onEdit()}><Plus />新增凭证</Button>}
    >
      {!state ? (
        <TableSkeleton rows={3} />
      ) : state.tencentCredentials.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="添加你的第一个云凭证" description="保存腾讯云 AK/SK，为架构值守、告警诊断与智能体运行提供云资源访问能力。" action={<Button onClick={() => onEdit()}><Plus />新增凭证</Button>} />
      ) : items.length === 0 ? <NoResults onReset={() => { setQuery('');  }} /> : (
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
            {items.map((c) => (
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
                    <Button variant="ghost" size="sm" onClick={() => testCredential(c.id)}>
                      测试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEdit(c.id)}>
                      编辑
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
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
