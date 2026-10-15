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
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onEdit: (id?: string) => void
}) {
  async function testAgent(id: string) {
    try {
      await toastTask(
        api<{ internalAgentId: string }>(`/api/admin/agents/${id}/test`, { method: 'POST', body: '{}' }),
        '正在验证 Agent ID 与 API Key…',
        (r) => `连接成功，内部 Agent ID：${r.internalAgentId}`,
      )
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  async function removeAgent(id: string) {
    try {
      await toastTask(api(`/api/admin/agents/${id}`, { method: 'DELETE' }), '删除中…', 'CloudAgent 已删除')
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
        (r) => `已清理 ${r.cleared} 个会话，下一条消息将创建全新运行时`,
      )
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  return (
    <PanelCard
      title="Cloud Agent"
      hint="同一 CloudAgent 配置可以被多个企业微信 Bot 复用。"
      action={<Button onClick={() => onEdit()}>新增 Agent</Button>}
    >
      {!state ? (
        <TableSkeleton />
      ) : state.agents.length === 0 ? (
        <div className="border-t py-8 text-center text-sm text-muted-foreground">
          尚未配置 CloudAgent。可先在“WorkBuddy API Key”添加 Key，新增 Agent 时自动拉取列表。
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>Agent ID</TableHead>
              <TableHead>凭据</TableHead>
              <TableHead>Source App</TableHead>
              <TableHead>版本</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {a.agentId}
                  </code>
                </TableCell>
                <TableCell>
                  {a.apiKeyName ?? <span className="text-muted-foreground">手动</span>}
                </TableCell>
                <TableCell>{a.sourceApp}</TableCell>
                <TableCell>r{a.revision}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => testAgent(a.id)}>
                      测试
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEdit(a.id)}>
                      编辑
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm">
                          重置会话
                        </Button>
                      }
                      title="确认重置该 Agent 的全部会话？"
                      description="将清理本地会话缓存并提升版本号，下一条消息会在全新运行时中开始。用于运行时故障恢复。"
                      actionLabel="确认重置"
                      onConfirm={() => resetSessions(a.id)}
                    />
                    <ConfirmButton
                      trigger={
                        <Button variant="outline" size="sm" className="text-destructive">
                          删除
                        </Button>
                      }
                      title="确认删除这个 CloudAgent 配置？"
                      onConfirm={() => removeAgent(a.id)}
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
