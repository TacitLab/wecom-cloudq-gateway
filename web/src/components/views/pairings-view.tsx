import { matchesSearch, botConnectionState } from '@/lib/list-filters'
import { useState } from 'react'
import { Plus, MessagesSquare } from 'lucide-react'
import { EmptyState, ListToolbar, NoResults, FilterPills } from '@/components/list-toolbar'
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
  onSetupAgent,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onSetupAgent: () => void
  onEdit: (id?: string) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const items = (state?.bots ?? []).filter(b => matchesSearch(query, b.name, b.botId, b.agentName) && (filter === 'all' || botConnectionState(b, state?.connections[b.id]) === filter))

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
      title="Bot 配对列表"
      hint="每个 Bot 只能选择一个 Agent；修改配对后，新消息自动进入新 Agent。"
      toolbar={state && state.bots.length > 0 && <ListToolbar query={query} onQueryChange={setQuery} placeholder="搜索 Bot 名称、ID 或 Agent" count={items.length} total={state.bots.length}><FilterPills value={filter} onChange={setFilter} options={[{value:'all',label:'全部'}, {value:'online',label:'在线'}, {value:'attention',label:'待处理'}, {value:'disabled',label:'已停用'}]} /></ListToolbar>}
      action={(!state || state.bots.length > 0) && <Button disabled={!state} onClick={() => onEdit()}><Plus />新增配对</Button>}
    >
      {!state ? (
        <TableSkeleton />
      ) : state.bots.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="还没有 Bot 配对" description="先连接一个 WMA Agent，再创建 Bot 配对，让团队可以在企业微信中直接发起运维对话。" action={<Button onClick={state.agents.length ? () => onEdit() : onSetupAgent}><Plus />{state.agents.length ? '新增配对' : '先连接 Agent'}</Button>} />
      ) : items.length === 0 ? <NoResults onReset={() => { setQuery(''); setFilter('all') }} /> : (
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
            {items.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="font-medium">{b.name}</div>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                    {b.botId}
                  </code>
                </TableCell>
                <TableCell>{b.agentName || '待绑定 WMA Agent'}</TableCell>
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
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
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
