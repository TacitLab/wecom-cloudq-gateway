import { matchesSearch } from '@/lib/list-filters'
import { RowActions } from '@/components/row-actions'
import { useState } from 'react'
import { Plus, Bot } from 'lucide-react'
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

export function AgentsView({
  state,
  reload,
  onEdit,
  onSetupCredential,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onSetupCredential: () => void
  onEdit: (id?: string) => void
}) {
  const [query, setQuery] = useState('')
  const items = (state?.agents ?? []).filter(a => matchesSearch(query, a.name, a.agentId, a.credentialName, a.wmaVersionName))

  async function testAgent(id: string) {
    try {
      await toastTask(
        api<{ agentId: string }>(`/api/admin/agents/${id}/test`, { method: 'POST', body: '{}' }),
        '正在验证 Agent ID 与接入凭证…',
        (r) => `连接成功，Agent ID：${r.agentId}`,
      )
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function removeAgent(id: string) {
    try {
      await toastTask(api(`/api/admin/agents/${id}`, { method: 'DELETE' }), '删除中…', 'Agent 已删除')
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function resetSessions(id: string) {
    try {
      await toastTask(
        api<{ cleared: number; revision: number }>(`/api/admin/agents/${id}/reset-sessions`, { method: 'POST', body: '{}' }),
        '正在重置会话…',
        (r) => `已清理 ${r.cleared} 个会话，下一条消息将创建新会话`,
      )
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="智能体列表"
      hint="同一 Agent 配置可以被多个企业微信 Bot 复用。"
      toolbar={state && state.agents.length > 0 && <ListToolbar query={query} onQueryChange={setQuery} placeholder="搜索名称、Agent ID 或凭证" count={items.length} total={state.agents.length} />}
      action={(!state || state.agents.length > 0) && <Button disabled={!state} onClick={() => onEdit()}><Plus />新增 Agent</Button>}
    >
      {!state ? (
        <TableSkeleton />
      ) : state.agents.length === 0 ? (
        <EmptyState icon={Bot} title="连接你的第一个智能体" description="选择 WMA 凭证后，可以获取可用的智能体，并为它设置运行版本。" action={<Button onClick={state.wmaCredentials.length ? () => onEdit() : onSetupCredential}><Plus />{state.wmaCredentials.length ? '新增 Agent' : '先添加 WMA 凭证'}</Button>} />
      ) : items.length === 0 ? <NoResults onReset={() => { setQuery('');  }} /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>Agent ID</TableHead>
              <TableHead>凭据</TableHead>
              <TableHead>接入来源</TableHead>
              <TableHead>WMA 版本</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {a.agentId}
                  </code>
                </TableCell>
                <TableCell>
                  {a.credentialName ?? <span className="text-muted-foreground">手动</span>}
                </TableCell>
                <TableCell>WMA · 腾讯云 AK/SK</TableCell>
                <TableCell>
                  {a.wmaVersionId ? (
                    <div className="grid gap-1 text-xs">
                      <span>{a.wmaVersionName || '固定版本'}</span>
                      <span className="font-mono text-muted-foreground">{a.wmaVersionId}</span>
                      {a.runtimeCredentialName && <span className="text-muted-foreground">{a.runtimeCredentialName} · {a.runtimeRegion}</span>}
                      {a.runtimeCredentialOutdated && <span className="text-amber-700 dark:text-amber-400">凭证待同步</span>}
                    </div>
                  ) : <span className="text-xs text-muted-foreground">跟随 WMA 路由</span>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => testAgent(a.id)}>
                      测试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEdit(a.id)}>
                      编辑
                    </Button>
                    <RowActions label={a.name}>
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm">
                          重置会话
                        </Button>
                      }
                      title="确认重置该 Agent 的全部会话？"
                      description="将清理本地会话缓存并提升版本号，下一条消息会在新会话中开始。云端已有会话仍保留。"
                      actionLabel="确认重置"
                      onConfirm={() => resetSessions(a.id)}
                    />
                    <ConfirmButton
                      trigger={
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                          删除
                        </Button>
                      }
                      title="确认删除这个 Agent 配置？"
                      onConfirm={() => removeAgent(a.id)}
                    />
                    </RowActions>
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
