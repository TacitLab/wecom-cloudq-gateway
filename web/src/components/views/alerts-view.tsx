import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
import { JobStatusBadge } from '@/components/status-badges'
import { TableSkeleton } from '@/components/table-skeleton'
import { Badge } from '@/components/ui/badge'
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
    <div className="flex flex-col gap-4">
      <PanelCard
        title="告警 RCA"
        hint="定时轮询腾讯云告警历史，使用 Bot 当前绑定的 CloudAgent 诊断，并主动推送到固定群聊。"
        action={state && state.tencentCredentials.length === 0
          ? <Button variant="outline" onClick={onSetupCredential}>先配置腾讯云凭证</Button>
          : <Button onClick={() => onEdit()}>新增告警配置</Button>}
      >
        {!state ? (
          <TableSkeleton rows={3} />
        ) : state.alertIntegrations.length === 0 ? (
          <div className="border-t py-8 text-center text-sm text-muted-foreground">
            {state.tencentCredentials.length === 0
              ? '告警 RCA 需要腾讯云凭证。请先录入凭证，再创建 RCA 配置。'
              : '尚未配置告警轮询。请选择凭证、地域和告警策略开始配置。'}
          </div>
        ) : (
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
              {state.alertIntegrations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.credentialName || '未关联凭证'} · {a.region || '未选择地域'} · {a.policyIds.length ? `${a.policyIds.length} 个策略` : '全部策略'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {a.botName} → {a.cloudAgentName}
                  </TableCell>
                  <TableCell>
                    {a.targetChatId ? (
                      <>
                        <Badge className="bg-green-600">已绑定</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">{a.targetChatName}</div>
                      </>
                    ) : (
                      <>
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                          等待绑定
                        </Badge>
                        <div>
                          <code className="mt-1 inline-block rounded-sm bg-amber-100 px-1 py-0.5 font-mono text-xs text-amber-800">
                            /bind-alert {a.bindCode}
                          </code>
                        </div>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.enabled ? (
                      <Badge variant={a.lastError ? 'destructive' : 'default'} className={a.lastError ? undefined : 'bg-green-600'}>
                        {a.lastError ? '轮询异常' : '已启用'}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                        已暂停
                      </Badge>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">{time(a.lastSuccessAt)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEnabled(a.id, !a.enabled)}>
                        {a.enabled ? '暂停' : '启用'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => poll(a.id)}>
                        立即轮询
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => testPush(a.id)}>
                        测试推送
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => onEdit(a.id)}>
                        编辑
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PanelCard>

      <PanelCard title="最近执行" hint="展示最近 50 条告警的发现、诊断和主动推送状态。">
        {!state ? (
          <TableSkeleton rows={3} />
        ) : state.alertJobs.length === 0 ? (
          <div className="border-t py-8 text-center text-sm text-muted-foreground">
            暂无告警执行记录。
          </div>
        ) : (
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
              {state.alertJobs.map((j) => (
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
