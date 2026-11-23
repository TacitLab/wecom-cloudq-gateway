import { ArrowRight, Check, KeyRound, Bot, MessagesSquare, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { AgentForm } from '@/components/forms/agent-form'
import { BotForm } from '@/components/forms/bot-form'
import { WmaCredentialForm } from '@/components/forms/wma-credential-form'
import { Button } from '@/components/ui/button'
import type { AdminState } from '@/lib/types'

const STEPS = [
  { key: 'wma-credential', title: '添加 WMA 凭证', description: '录入具备 WMA 权限的腾讯云 SecretId / SecretKey。', icon: KeyRound, done: (s: AdminState) => s.wmaCredentials.length > 0 },
  { key: 'agent', title: '连接 WMA Agent', description: '选择保存的 WMA 凭证，获取并连接团队需要的智能体。', icon: Bot, done: (s: AdminState) => s.agents.length > 0 },
  { key: 'bot', title: '创建 Bot 配对', description: '填入企业微信 Bot 的 ID 与 Secret 并绑定 Agent，保存后将自动建立连接。', icon: MessagesSquare, done: (s: AdminState) => s.bots.length > 0 },
]

export function OnboardingPage({ state, onSaved, onExit }: { state: AdminState; onSaved: () => Promise<void>; onExit: () => void }) {
  const doneFlags = STEPS.map(s => s.done(state))
  const allDone = doneFlags.every(Boolean)
  const [stepIndex, setStepIndex] = useState(() => Math.max(0, doneFlags.findIndex(d => !d)))
  async function handleSaved() { await onSaved(); setStepIndex(i => Math.min(i + 1, STEPS.length - 1)) }
  function skip() { if (stepIndex === STEPS.length - 1) onExit(); else setStepIndex(stepIndex + 1) }
  return <div className="onboarding-shell">
    <aside className="onboarding-aside">
      <img src={`${import.meta.env.BASE_URL}brand/logo-lockup-inverse.svg`} alt="CloudQ Gateway" className="w-56 max-w-full" />
      <div className="my-10 lg:my-16"><p className="text-[10px] tracking-[.2em] text-[#6de2cf]">WELCOME ABOARD</p><h1 className="mt-4 text-3xl font-semibold leading-snug tracking-tight">让智能运维，<br />走进团队的日常。</h1><p className="mt-5 max-w-xs text-sm leading-7 text-slate-400">连接云端智能体与企业微信，<br />从一次配置，开启持续协作。</p></div>
      <ol className="grid gap-3" aria-label="配置进度">
        {STEPS.map((step, index) => <li key={step.key}><button type="button" className="onboarding-step" aria-current={!allDone && index === stepIndex ? 'step' : undefined} onClick={() => setStepIndex(index)}><span className={`onboarding-step-number ${doneFlags[index] ? 'is-complete' : ''}`}>{doneFlags[index] ? <Check className="size-4" /> : `0${index + 1}`}</span><span className="flex-1 text-left text-sm">{step.title}</span><span className="text-[10px] opacity-60">{doneFlags[index] ? '已完成' : index === stepIndex ? '当前步骤' : '待配置'}</span></button></li>)}
      </ol>
      <p className="mt-auto pt-10 text-xs text-slate-500">凭证 → 智能体 → 团队协作</p>
    </aside>
    <main className="onboarding-main">
      <div className="mb-10 flex items-center justify-between gap-4"><span className="text-xs text-muted-foreground">首次配置向导 · {doneFlags.filter(Boolean).length} / 3 已完成</span><Button variant="ghost" size="sm" onClick={onExit}>稍后配置<ArrowRight /></Button></div>
      {allDone ? <div className="onboarding-form flex flex-col items-center gap-5 py-16 text-center"><div className="grid size-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-8" /></div><h2 className="text-2xl font-semibold">准备就绪</h2><p className="max-w-sm text-sm leading-7 text-muted-foreground">凭证、Agent 和 Bot 配对已保存。进入控制台查看连接状态，确认在线后即可在企业微信中开始对话。</p><Button onClick={onExit}>进入控制台<ArrowRight /></Button></div>
        : <div className="onboarding-form"><div className="mb-7 border-b pb-6"><span className="page-eyebrow">STEP 0{stepIndex + 1} / 03</span><h2 className="mt-2 text-2xl font-semibold tracking-tight">{STEPS[stepIndex].title}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{STEPS[stepIndex].description}</p></div>
          {STEPS[stepIndex].key === 'wma-credential' && <WmaCredentialForm formId="wizard-step-form" hideFooter onSaved={handleSaved} />}
          {STEPS[stepIndex].key === 'agent' && <AgentForm formId="wizard-step-form" hideFooter state={state} onSaved={handleSaved} />}
          {STEPS[stepIndex].key === 'bot' && <BotForm formId="wizard-step-form" hideFooter state={state} onSaved={handleSaved} />}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5"><Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)}>上一步</Button><div className="flex gap-2"><Button type="button" variant="ghost" onClick={skip}>{stepIndex === STEPS.length - 1 ? '跳过并进入控制台' : '跳过'}</Button><Button type="submit" form="wizard-step-form">{stepIndex === STEPS.length - 1 ? '完成配置' : '保存并继续'}<ArrowRight /></Button></div></div>
        </div>}
      <p className="mt-6 text-center text-xs text-muted-foreground">所有配置都可以在控制台中继续管理与调整。</p>
    </main>
  </div>
}
