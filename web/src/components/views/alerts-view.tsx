import { matchesSearch } from '@/lib/list-filters'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
import { JobStatusBadge, StatusBadge } from '@/components/status-badges'
import { TableSkeleton } from '@/components/table-skeleton'
import { BellRing, History, Plus } from 'lucide-react'
import { EmptyState, FilterPills, ListToolbar, NoResults } from '@/components/list-toolbar'
import { RowActions } from '@/components/row-actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import { alertSourceName } from '@/lib/alert-sources'
import { copyText } from '@/lib/clipboard'
import { toastTask } from '@/lib/toast-task'
import type { AdminState } from '@/lib/types'

function time(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function AlertsView({
  state,
  reload,
  onEdit,
  onSetupCredential,
}: {
  state: AdminState | null
  reload: () => Promise<void>
  onEdit: (id?: string) => void
  onSetupCredential: () => void
}) {
  const [manualCopyCommand, setManualCopyCommand] = useState('')
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const [jobQuery, setJobQuery] = useState(''), [jobFilter, setJobFilter] = useState('all')
  const items = (state?.alertIntegrations ?? []).filter(a => matchesSearch(query, a.name, a.botName, a.agentName, a.credentialName, a.region) && (filter === 'all' || (filter === 'attention' ? a.lastError || !a.targetChatId : filter === 'enabled' ? a.enabled : !a.enabled)))
  const jobs = (state?.alertJobs ?? []).filter(j => matchesSearch(jobQuery, j.integrationName, j.alarmId, j.payload?.AlarmObject, j.error) && (jobFilter === 'all' || (jobFilter === 'pending' ? !['delivered', 'failed'].includes(j.status) : j.status === jobFilter)))

  async function copyBindCode(bindCode: string) {
    const command = `/bind-alert ${bindCode}`
    if (await copyText(command)) {
      toast.success('绑定指令已复制，请在目标企业微信群发送')
    } else {
      setManualCopyCommand(command)
    }
  }

  async function run<T>(task: Promise<T>, loading: string, success: (r: T) => string) {
    try {
      await toastTask(task, loading, success)
      await reload()
    } catch {
      // 错误已由 toastTask 提示
    }
  }

  const setEnabled = (id: string, enabled: boolean) =>
    run(
      api(`/api/admin/alerts/${id}/${enabled ? 'resume' : 'pause'}`, { method: 'POST', body: '{}' }),
      enabled ? '启用中…' : '暂停中…',
      () => (enabled ? '告警轮询已启用' : '告警轮询已暂停'),
    )

  const poll = (id: string) =>
    run(
      api<{ discovered: number; claimed: number }>(`/api/admin/alerts/${id}/poll`, { method: 'POST', body: '{}' }),
      '正在拉取告警历史…',
      (r) => `轮询完成：发现 ${r.discovered} 条，新增 ${r.claimed} 条`,
    )

  const testPush = (id: string) =>
    run(
      api(`/api/admin/alerts/${id}/test-push`, { method: 'POST', body: '{}' }),
      '正在推送测试消息…',
      () => '测试消息已主动推送到绑定群聊',
    )

  const unbind = (id: string) =>
    run(
      api(`/api/admin/alerts/${id}/unbind`, { method: 'POST', body: '{}' }),
      '解绑中…',
      () => '已解除目标群绑定',
    )

  const remove = (id: string) =>
    run(
      api(`/api/admin/alerts/${id}`, { method: 'DELETE' }),
      '删除中…',
      () => '告警配置已删除',
    )

  const retryJob = (id: string) =>
    run(
      api(`/api/admin/alert-jobs/${id}/retry`, { method: 'POST', body: '{}' }),
      '重新入队中…',
      () => '任务已重新入队',
    )

  return (
    <div className="flex flex-col gap-6">
      <Dialog open={Boolean(manualCopyCommand)} onOpenChange={(open) => { if (!open) setManualCopyCommand('') }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动复制绑定指令</DialogTitle>
            <DialogDescription>浏览器未允许自动复制。请复制下方指令，在目标企业微信群中 @所选机器人后发送。</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="绑定指令"
            className="font-mono"
            value={manualCopyCommand}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-muted-foreground">电脑可按 Ctrl+C（Mac 为 ⌘C），手机可长按复制。</p>
        </DialogContent>
      </Dialog>
      <PanelCard
        title="告警自动诊断"
        hint="定时轮询腾讯云告警历史，使用 Bot 当前绑定的 Agent 诊断，并主动推送到固定群聊。"
        toolbar={state && state.alertIntegrations.length > 0 && <ListToolbar query={query} onQueryChange={setQuery} placeholder="搜索配置、Bot 或凭证" count={items.length} total={state.alertIntegrations.length}><FilterPills value={filter} onChange={setFilter} options={[{value:'all',label:'全部'}, {value:'enabled',label:'已启用'}, {value:'paused',label:'已暂停'}, {value:'attention',label:'待处理'}]} /></ListToolbar>}
        action={state && state.alertIntegrations.length === 0 ? null : state && state.tencentCredentials.length === 0
          ? <Button variant="outline" onClick={onSetupCredential}>先配置腾讯云凭证</Button>
          : <Button disabled={!state} onClick={() => onEdit()}><Plus />新增告警配置</Button>}
      >
        {!state ? (
          <TableSkeleton rows={3} />
        ) : state.alertIntegrations.length === 0 ? (
          <EmptyState icon={BellRing} title="让告警自动找到解决思路" description={state.tencentCredentials.length === 0 ? '先配置腾讯云凭证，再选择告警来源和执行 Bot，连接自动诊断与群推送。' : '选择告警来源和执行 Bot，绑定团队群聊。新的告警将自动触发根因分析并推送结果。'} action={<Button onClick={state.tencentCredentials.length ? () => onEdit() : onSetupCredential}><Plus />{state.tencentCredentials.length ? '创建告警配置' : '先配置腾讯云凭证'}</Button>} />
        ) : !items.length ? <NoResults onReset={() => { setQuery(''); setFilter('all') }} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>配置</TableHead>
                <TableHead>执行链路</TableHead>
                <TableHead>目标群</TableHead>
                <TableHead>轮询状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {alertSourceName(a.monitorType)} · {a.region || '未选择地域'} · {a.policyIds.length ? `${a.policyIds.length} 个策略` : a.namespace ? `策略类型：${a.namespace}` : '全部策略'}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.credentialName || '未关联凭证'}</div>
                  </TableCell>
                  <TableCell>
                    {a.botName} → {a.agentName || '待绑定 WMA Agent（轮询暂停）'}
                  </TableCell>
                  <TableCell>
                    {a.targetChatId ? (
                      <>
                        <StatusBadge tone="success">已绑定</StatusBadge>
                        <div className="mt-1 text-xs text-muted-foreground">{a.targetChatName}</div>
                      </>
                    ) : (
                      <>
                        <StatusBadge tone="warning">
                          等待绑定
                        </StatusBadge>
                        <div>
                          <code className="mt-1 inline-block rounded-sm bg-amber-100 px-1 py-0.5 font-mono text-xs text-amber-800">
                            /bind-alert {a.bindCode}
                          </code>
                          <Button variant="ghost" size="xs" onClick={() => copyBindCode(a.bindCode)}>复制指令</Button>
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.enabled ? (
                      <StatusBadge tone={a.lastError ? 'error' : a.targetChatId ? 'success' : 'warning'}>
                        {a.lastError ? '轮询异常' : a.targetChatId ? '已启用' : '等待绑定'}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">
                        已暂停
                      </StatusBadge>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">{time(a.lastSuccessAt)}</div>
                    {a.lastError && <div className="mt-1 max-w-64 break-words text-xs text-destructive">{a.lastError}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">                      <Button variant="outline" size="sm" onClick={() => onEdit(a.id)}>
                        编辑
                      </Button>                      <Button variant="outline" size="sm" disabled={!a.targetChatId} onClick={() => poll(a.id)}>
                        立即轮询
                      </Button><RowActions label={a.name}>
                      <Button variant="outline" size="sm" onClick={() => setEnabled(a.id, !a.enabled)}>
                        {a.enabled ? '暂停' : '启用'}
                      </Button>

                      <Button variant="outline" size="sm" disabled={!a.targetChatId} onClick={() => testPush(a.id)}>
                        测试推送
                      </Button>

                      {a.targetChatId && (
                        <ConfirmButton
                          trigger={
                            <Button variant="outline" size="sm">
                              解绑群聊
                            </Button>
                          }
                          title="确认解除当前目标群绑定？"
                          actionLabel="确认解绑"
                          onConfirm={() => unbind(a.id)}
                        />
                      )}
                      <ConfirmButton
                        trigger={
                          <Button variant="outline" size="sm" className="text-destructive">
                            删除
                          </Button>
                        }
                        title="确认删除该告警配置及执行历史？"
                        onConfirm={() => remove(a.id)}
                      />
                    </RowActions></div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PanelCard>

      <PanelCard title="最近执行" hint="追踪最近 50 条告警，从发现、诊断到推送的完整进展。"
        toolbar={state && state.alertJobs.length > 0 && <ListToolbar query={jobQuery} onQueryChange={setJobQuery} placeholder="搜索告警对象、配置或错误" count={jobs.length} total={state.alertJobs.length}><FilterPills value={jobFilter} onChange={setJobFilter} options={[{value:'all',label:'全部'}, {value:'pending',label:'处理中'}, {value:'delivered',label:'已推送'}, {value:'failed',label:'失败'}]} /></ListToolbar>}>
        {!state ? (
          <TableSkeleton rows={3} />
        ) : state.alertJobs.length === 0 ? (
          <EmptyState icon={History} title="暂无执行记录" description="告警配置启用并绑定群聊后，新的诊断与推送记录会出现在这里。" />
        ) : !jobs.length ? <NoResults onReset={() => { setJobQuery(''); setJobFilter('all') }} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>配置</TableHead>
                <TableHead>告警对象</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>错误</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell>{time(j.createdAt)}</TableCell>
                  <TableCell>{j.integrationName}</TableCell>
                  <TableCell>
                    <div className="font-medium">{j.payload?.AlarmObject || '—'}</div>
                    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                      {j.alarmId}
                    </code>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.error || '—'}</TableCell>
                  <TableCell>
                    {j.status === 'failed' ? (
                      <Button variant="outline" size="sm" onClick={() => retryJob(j.id)}>
                        重试
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PanelCard>
    </div>
  )
}
