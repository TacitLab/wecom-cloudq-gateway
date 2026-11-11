import { ArrowRight, Check, PartyPopper } from 'lucide-react'
import { useState } from 'react'

import { AgentForm } from '@/components/forms/agent-form'
import { BotForm } from '@/components/forms/bot-form'
import { WmaCredentialForm } from '@/components/forms/wma-credential-form'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AdminState } from '@/lib/types'

const STEPS = [
  {
    key: 'wma-credential' as const,
    title: '添加 WMA 凭证',
    description: '录入具备 WMA 权限的腾讯云 SecretId / SecretKey。',
    done: (s: AdminState) => s.wmaCredentials.length > 0,
  },
  {
    key: 'agent' as const,
    title: '连接 WMA Agent',
    description: '选择上一步保存的 WMA 凭证，从拉取的 WMA Agent 列表中选择要绑定的 Agent。',
    done: (s: AdminState) => s.agents.length > 0,
  },
  {
    key: 'bot' as const,
    title: '创建 Bot 配对',
    description: '填入企业微信 Bot 的 ID 与 Secret 并绑定 WMA Agent，保存后长连接自动建立。',
    done: (s: AdminState) => s.bots.length > 0,
  },
]

export function OnboardingPage({
  state,
  onSaved,
  onExit,
}: {
  state: AdminState
  onSaved: () => Promise<void>
  onExit: () => void
}) {
  const doneFlags = STEPS.map((s) => s.done(state))
  const allDone = doneFlags.every(Boolean)
  // 当前步骤由用户导航决定；初始为第一个未完成步骤
  const [stepIndex, setStepIndex] = useState(() => {
    const first = doneFlags.findIndex((d) => !d)
    return first === -1 ? 0 : first
  })

  async function handleSaved() {
    await onSaved()
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  }

  function skip() {
    if (stepIndex === STEPS.length - 1) onExit()
    else setStepIndex(stepIndex + 1)
  }

  return (
    <div className="min-h-svh bg-muted/40">
      <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-extrabold tracking-tighter text-primary-foreground">
            CA
          </div>
          <div>
            <div className="font-semibold leading-tight">Agent 消息网关</div>
            <div className="text-xs text-muted-foreground">首次配置向导</div>
          </div>
        </div>

        {allDone ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border bg-card py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <PartyPopper className="size-6" />
            </div>
            <h1 className="text-xl font-semibold">配置完成</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              WMA 凭证、WMA Agent 和 Bot 配对都已就绪。Bot 长连接正在运行，现在可以去企业微信群里和它对话了。
            </p>
            <Button onClick={onExit}>
              进入控制台
              <ArrowRight />
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">快速开始</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              按顺序完成以下 {STEPS.length} 步，即可让企业微信 Bot 接入 WMA Agent。
            </p>

            {/* 步骤进度条 */}
            <ol className="my-8 flex items-center">
              {STEPS.map((step, index) => {
                const done = doneFlags[index]
                const active = index === stepIndex
                return (
                  <li key={step.key} className={cn('flex items-center', index > 0 && 'flex-1')}>
                    {index > 0 && (
                      <div
                        className={cn(
                          'mx-3 h-px flex-1',
                          doneFlags[index - 1] ? 'bg-primary' : 'bg-border',
                        )}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setStepIndex(index)}
                      className="flex items-center gap-2.5 rounded-md text-left"
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                          done
                            ? 'border-primary bg-primary text-primary-foreground'
                            : active
                              ? 'border-primary text-primary'
                              : 'text-muted-foreground',
                        )}
                      >
                        {done ? <Check className="size-4" /> : index + 1}
                      </span>
                      <span
                        className={cn(
                          'text-sm whitespace-nowrap',
                          active ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {step.title}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>

            {/* 当前步骤表单 */}
            <div className="rounded-xl border bg-card p-6">
              <h2 className="font-semibold">
                第 {stepIndex + 1} 步 · {STEPS[stepIndex].title}
              </h2>
              <p className="mt-1 mb-5 text-sm text-muted-foreground">
                {STEPS[stepIndex].description}
              </p>
              {STEPS[stepIndex].key === 'wma-credential' && (
                <WmaCredentialForm formId="wizard-step-form" hideFooter onSaved={handleSaved} />
              )}
              {STEPS[stepIndex].key === 'agent' && (
                <AgentForm formId="wizard-step-form" hideFooter state={state} onSaved={handleSaved} />
              )}
              {STEPS[stepIndex].key === 'bot' && (
                <BotForm formId="wizard-step-form" hideFooter state={state} onSaved={handleSaved} />
              )}
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex(stepIndex - 1)}
                >
                  上一步
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={skip}>
                    {stepIndex === STEPS.length - 1 ? '跳过并进入控制台' : '跳过'}
                  </Button>
                  <Button type="submit" form="wizard-step-form">
                    {stepIndex === STEPS.length - 1 ? '完成' : '下一步'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
