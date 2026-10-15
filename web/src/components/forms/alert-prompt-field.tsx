import { useEffect, useState } from 'react'
import { CircleHelp, LoaderCircle, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { alertSourceName } from '@/lib/alert-sources'

interface PromptReference {
  defaultTemplate: string
  variables: { key: string; label: string }[]
  sourceNotes: Record<string, string>
}

export function AlertPromptField({ monitorType, value, useDefault, onChange, onRestore }: {
  monitorType: string
  value: string
  useDefault: boolean
  onChange: (value: string) => void
  onRestore: () => void
}) {
  const [reference, setReference] = useState<PromptReference | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api<PromptReference>('/api/admin/alert-prompt', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setReference(result) })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '默认模板加载失败')
      })
    return () => controller.abort()
  }, [reload])

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="alert-prompt">自定义诊断 Prompt（可选）</Label>
          <TooltipProvider delay={150}>
            <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
              <TooltipTrigger
                aria-label="查看 Prompt 变量与来源字段参考"
                disabled={!reference}
                closeOnClick={false}
                closeDelay={150}
                render={<Button type="button" variant="ghost" size="icon-sm" disabled={!reference} onClick={() => setHelpOpen(true)} />}
              >
                <CircleHelp className="size-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="block max-h-[min(28rem,70vh,var(--available-height))] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-4 leading-relaxed">
                <p className="font-medium">变量参考 · {alertSourceName(monitorType)}</p>
                <p className="mt-1 opacity-80">所有来源共用以下变量名，运行时替换为当前告警数据。缺失字段为空；具体内容随来源而异。</p>
                <p className="mt-3 font-medium">当前来源的字段说明</p>
                <p className="mt-1 opacity-80">{reference?.sourceNotes[monitorType] ?? '字段以告警历史接口实际返回为准，使用 {{alarm_json}} 查看完整数据。'}</p>
                <p className="mt-3 opacity-80">可滚动查看全部 {reference?.variables.length} 个变量及填写示例。</p>
                <dl className="my-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5">
                  {reference?.variables.map((variable) => (
                    <div key={variable.key} className="contents">
                      <dt className="font-mono">{`{{${variable.key}}}`}</dt>
                      <dd className="opacity-80">{variable.label}</dd>
                    </div>
                  ))}
                </dl>
                <p className="border-t border-current/20 pt-2 font-medium">填写示例</p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-80">{'请分析 {{region}} 的告警：{{alarm_content}}。\n策略：{{policy_name}}；对象：{{alarm_object}}。\n结合真实数据给出根因、证据和处置建议。\n完整告警：{{alarm_json}}'}</pre>
                <p className="mt-2 opacity-80">变量使用双花括号；不支持点路径表达式。使用完整 JSON 获取来源特有字段。</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{useDefault ? '系统默认' : '自定义'}</span>
          {!useDefault && <Button type="button" variant="ghost" size="xs" onClick={onRestore} disabled={!reference}><RotateCcw className="size-3" />恢复默认</Button>}
        </div>
      </div>
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
        默认模板加载失败：{error}
        <Button type="button" variant="outline" size="xs" onClick={() => { setError(''); setReload((current) => current + 1) }}>重试</Button>
      </div>}
      {!reference && !error && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />正在加载系统默认模板与变量参考…</p>}
      <Textarea
        id="alert-prompt"
        className="h-64 min-h-40 max-h-[60vh] resize-y [field-sizing:fixed] leading-relaxed"
        value={useDefault ? reference?.defaultTemplate ?? '' : value}
        readOnly={useDefault && !reference}
        maxLength={20000}
        aria-describedby="alert-prompt-hint"
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="alert-prompt-hint" className="text-xs leading-relaxed text-muted-foreground">
        {useDefault ? '当前显示系统默认模板，可直接编辑；未修改时保存仍使用系统默认。' : '修改仅作用于本条配置。留空保存时使用系统默认模板。'}
        悬停或点击问号查看变量与来源字段说明。
      </p>
    </div>
  )
}
