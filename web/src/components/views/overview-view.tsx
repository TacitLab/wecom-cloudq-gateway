import { ArrowRight, ArrowUpRight, BellRing, Bot, Check, ChevronRight, CloudCog, History, KeyRound, MessagesSquare, Network, Radio } from 'lucide-react'
import { PanelCard } from '@/components/panel-card'
import { StatCards } from '@/components/stat-cards'
import { ArchitecturePreviews } from '@/components/architecture-previews'
import { JobStatusBadge, StatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getOverviewChecks } from '@/lib/overview'
import type { AdminState } from '@/lib/types'
import type { ViewKey } from '@/lib/views'

const CHECK_ICONS = { pairings: Radio, 'architecture-watches': Network, alerts: BellRing, agents: Bot }

function jobTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function OverviewView({ state, onSwitch }: { state: AdminState | null; onSwitch: (view: ViewKey) => void }) {
  const checks = state ? getOverviewChecks(state) : []
  const attention = checks.filter(check => check.tone === 'warning' || check.tone === 'error').length
  const credentialIds = new Set(state?.wmaCredentials.map(credential => credential.id))
  const configuredAgentIds = new Set(state?.agents.filter(agent => credentialIds.has(agent.credentialConfigId)).map(agent => agent.id))
  const steps = [
    { view: 'wma-credentials' as const, label: '接入凭证', detail: '授权 WMA 智能体能力', icon: KeyRound, count: state?.wmaCredentials.length ?? 0, unit: '个凭证' },
    { view: 'agents' as const, label: '连接智能体', detail: '选择团队需要的运维 Agent', icon: Bot, count: configuredAgentIds.size, unit: '个智能体' },
    { view: 'pairings' as const, label: '配对企业微信 Bot', detail: '连接团队与智能体', icon: MessagesSquare, count: state?.bots.filter(bot => configuredAgentIds.has(bot.agentConfigId ?? '')).length ?? 0, unit: '个配对' },
  ]
  const completed = steps.filter(step => step.count > 0).length
  const nextStep = steps.find(step => step.count === 0)
  const jobs = [...(state?.alertJobs ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4)
  const pendingJobs = state?.alertJobs.filter(job => !['delivered', 'failed'].includes(job.status)).length ?? 0
  const failedJobs = state?.alertJobs.filter(job => job.status === 'failed').length ?? 0
  const alertSetupView: ViewKey = !state?.tencentCredentials.length ? 'tencent-credentials'
    : !state.bots.some(bot => bot.enabled && bot.agentConfigId) ? 'pairings' : 'alerts'
  const alertSetupLabel = alertSetupView === 'tencent-credentials' ? '配置腾讯云凭证'
    : alertSetupView === 'pairings' ? '管理 Bot 配对' : '配置告警自动诊断'

  return <div className="overview-layout">
    <StatCards state={state} onSwitch={onSwitch} />

    <div className="overview-main-grid">
      <PanelCard title="运行状态" hint="聚焦连接、架构值守与告警轮询。异常事项优先展示。"
        action={state && <StatusBadge tone={attention ? 'warning' : 'neutral'}>{attention ? `${attention} 项待关注` : '暂无待关注项'}</StatusBadge>}>
        {!state ? <div className="grid gap-3" aria-label="正在加载运行状态">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
          : <div className="overview-checks">{checks.map(check => {
            const Icon = CHECK_ICONS[check.view as keyof typeof CHECK_ICONS] ?? Radio
            return <button key={check.view} type="button" className={`overview-check overview-check-${check.tone}`} onClick={() => onSwitch(check.view)}>
              <span className="overview-row-icon"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{check.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{check.detail}</span></span>
              <StatusBadge tone={check.tone}>{check.status}</StatusBadge><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          })}</div>}
        <div className="overview-shortcuts" aria-label="常用入口">
          <button type="button" onClick={() => onSwitch('architecture-watches')}><Network className="size-4" /><span>查看业务架构</span><ArrowUpRight className="size-3.5" /></button>
          <button type="button" onClick={() => onSwitch('tencent-credentials')}><CloudCog className="size-4" /><span>管理云凭证</span><ArrowUpRight className="size-3.5" /></button>
        </div>
      </PanelCard>

      <PanelCard className="overview-recent-tasks" title="最近 RCA 任务" hint="查看最近的告警诊断与群推送进展。"
        action={<Button variant="ghost" size="sm" onClick={() => onSwitch('alerts')}>查看全部<ArrowRight /></Button>}>
        {!state ? <Skeleton className="h-28 w-full" aria-label="正在加载最近任务" />
          : jobs.length ? <>
            <div className="overview-job-summary"><span>最近 {state.alertJobs.length} 条记录</span><span>{pendingJobs} 条处理中</span><span className={failedJobs ? 'text-destructive' : ''}>{failedJobs} 条失败</span></div>
            <div className="overview-jobs">{jobs.map(job => <button type="button" className="overview-job" key={job.id} onClick={() => onSwitch('alerts')}>
              <span className="overview-row-icon"><History className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{job.integrationName}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{job.payload?.AlarmObject || job.alarmId}</span></span>
              <time className="text-xs text-muted-foreground">{jobTime(job.createdAt)}</time><JobStatusBadge status={job.status} /><ChevronRight className="size-3.5 text-muted-foreground" />
            </button>)}</div>
          </> : <div className="overview-empty-jobs">
            <span className="overview-empty-icon"><History className="size-6" /></span>
            <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{state.alertIntegrations.length ? '暂时还没有诊断任务' : '让下一条告警，自带排查思路'}</h3><p className="mt-2 max-w-xl text-xs leading-6 text-muted-foreground">{state.alertIntegrations.length ? '告警配置发现新事件后，诊断进度和推送结果会汇总在这里。' : '接入告警来源后，由 Agent 分析根因，并将诊断结果送达企业微信群。'}</p></div>
            <Button variant="outline" size="sm" onClick={() => onSwitch(state.alertIntegrations.length ? 'alerts' : alertSetupView)}>{state.alertIntegrations.length ? '查看告警配置' : alertSetupLabel}<ArrowRight /></Button>
          </div>}
      </PanelCard>
    </div>

    {state && nextStep && (
      <PanelCard className="overview-setup" title="接入链路" hint="凭证 → 智能体 → 团队协作"
        action={<span className="overview-progress-count">{completed}<span> / 3</span></span>}>
            <ol className="overview-steps" aria-label="接入进度">{steps.map((step, index) => <li key={step.view}>
              <button type="button" className="overview-step" onClick={() => onSwitch(step.view)}>
                <span className={`overview-step-marker ${step.count ? 'is-complete' : ''}`}>{step.count ? <Check className="size-4" /> : <span>{index + 1}</span>}</span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{step.label}</span><span className="mt-1 block text-xs text-muted-foreground">{step.count ? `${step.count} ${step.unit}已配置` : step.detail}</span></span>
                <step.icon className="size-4 text-muted-foreground" />
              </button>
            </li>)}</ol>
            <div className="overview-setup-note">
              <span className="text-xs leading-5">完成基础接入后，这份指引会自动收起。</span>
              <Button variant="outline" size="sm" onClick={() => onSwitch(nextStep.view)}>继续配置<ArrowRight /></Button>
            </div>
      </PanelCard>
    )}

    {state && <ArchitecturePreviews watches={state.architectureWatches ?? []} onBrowse={() => onSwitch('architecture-watches')} />}
  </div>
}
