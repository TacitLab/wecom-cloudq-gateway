import { useEffect, useState } from 'react'

import { AdvancedSection } from '@/components/advanced-section'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { AdminState, AlertIntegration } from '@/lib/types'

export function AlertDialogForm({
  open,
  record,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  record?: AlertIntegration
  state: AdminState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [botConfigId, setBotConfigId] = useState('')
  const [secretId, setSecretId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [namespace, setNamespace] = useState('cvm_device')
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState('60')
  const [policyIds, setPolicyIds] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [region, setRegion] = useState('')
  const [monitorType, setMonitorType] = useState('MT_QCE')
  const [initialLookbackSeconds, setInitialLookbackSeconds] = useState('600')
  const [overlapSeconds, setOverlapSeconds] = useState('300')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [includeRecovery, setIncludeRecovery] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(record?.name ?? '')
    setBotConfigId(record?.botConfigId ?? state?.bots[0]?.id ?? '')
    setSecretId('')
    setSecretKey('')
    setNamespace(record?.namespace ?? 'cvm_device')
    setPollIntervalSeconds(String(record?.pollIntervalSeconds ?? 60))
    setPolicyIds((record?.policyIds ?? []).join(', '))
    setEnabled(record ? Boolean(record.enabled) : true)
    setRegion(record?.region ?? '')
    setMonitorType(record?.monitorType ?? 'MT_QCE')
    setInitialLookbackSeconds(String(record?.initialLookbackSeconds ?? 600))
    setOverlapSeconds(String(record?.overlapSeconds ?? 300))
    setPromptTemplate(record?.promptTemplate ?? '')
    setIncludeRecovery(Boolean(record?.includeRecovery))
  }, [open, record, state])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/alerts${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({
            id,
            name,
            botConfigId,
            secretId,
            secretKey,
            namespace,
            pollIntervalSeconds: Number(pollIntervalSeconds),
            policyIds: policyIds
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            enabled,
            region,
            monitorType,
            initialLookbackSeconds: Number(initialLookbackSeconds),
            overlapSeconds: Number(overlapSeconds),
            promptTemplate,
            includeRecovery,
          }),
        }),
        '保存中…',
        '告警配置已保存，请按绑定码在目标群完成绑定',
      )
      onOpenChange(false)
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>告警 RCA 配置</DialogTitle>
          <DialogDescription>
            保存后，在目标企业微信群发送页面显示的绑定指令，即可记录固定群聊。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>配置名称</Label>
              <Input required maxLength={100} placeholder="生产环境 CVM 告警" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>执行 Bot</Label>
              <Select value={botConfigId} onValueChange={(v) => setBotConfigId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue>
                    {(v) => state?.bots.find((b) => b.id === v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(state?.bots ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>腾讯云 SecretId</Label>
              <Input type="password" autoComplete="new-password" placeholder="编辑时留空表示不修改" value={secretId} onChange={(e) => setSecretId(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>腾讯云 SecretKey</Label>
              <Input type="password" autoComplete="new-password" placeholder="编辑时留空表示不修改" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>策略类型 Namespace</Label>
              <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>轮询间隔（秒）</Label>
              <Input type="number" min={30} value={pollIntervalSeconds} onChange={(e) => setPollIntervalSeconds(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>策略 ID（可选，逗号分隔）</Label>
            <Input placeholder="policy-xxx, policy-yyy" value={policyIds} onChange={(e) => setPolicyIds(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            启用轮询（绑定目标群后开始执行）
          </label>

          <AdvancedSection>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>腾讯云 API Region（可选）</Label>
                  <Input placeholder="ap-guangzhou" value={region} onChange={(e) => setRegion(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Monitor Type</Label>
                  <Input value={monitorType} onChange={(e) => setMonitorType(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>首次回溯（秒）</Label>
                  <Input type="number" min={60} value={initialLookbackSeconds} onChange={(e) => setInitialLookbackSeconds(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>重叠窗口（秒）</Label>
                  <Input type="number" min={0} value={overlapSeconds} onChange={(e) => setOverlapSeconds(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>自定义 Prompt 模板（可选）</Label>
                <Textarea
                  placeholder="可用变量：{{alarm_json}}、{{alarm_id}}、{{alarm_object}}、{{alarm_content}}、{{policy_name}}、{{region}}"
                  value={promptTemplate}
                  onChange={(e) => setPromptTemplate(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={includeRecovery} onCheckedChange={(v) => setIncludeRecovery(v === true)} />
                同时查询恢复状态（历史接口存在时间窗口限制）
              </label>
            </div>
          </AdvancedSection>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
