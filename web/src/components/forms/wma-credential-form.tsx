import { useEffect, useState } from 'react'

import { AdvancedSection } from '@/components/advanced-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { WmaCredentialConfig } from '@/lib/types'

export function WmaCredentialForm({
  record,
  onSaved,
  onCancel,
  submitLabel = '保存',
  formId,
  hideFooter,
}: {
  record?: WmaCredentialConfig
  onSaved: () => Promise<void>
  onCancel?: () => void
  submitLabel?: string
  formId?: string
  hideFooter?: boolean
}) {
  const [name, setName] = useState('')
  const [secretId, setSecretId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [region, setRegion] = useState('ap-guangzhou')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(record?.name ?? '')
    setSecretId('')
    setSecretKey('')
    setRegion(record?.region ?? 'ap-guangzhou')
  }, [record])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/wma-credentials${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({ id, name, secretId, secretKey, region }),
        }),
        '保存中…',
        'WMA 凭证已保存',
      )
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="key-name">名称</Label>
        <Input
          id="key-name"
          required
          maxLength={100}
          placeholder="生产环境 WMA 凭证"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <>
        <div className="grid gap-2">
          <Label htmlFor="wma-secret-id">SecretId（AK）</Label>
          <Input id="wma-secret-id" type="password" autoComplete="new-password"
            required={!record} maxLength={256}
            placeholder={record ? '留空保留原 SecretId' : '腾讯云 SecretId，AKID 开头'}
            value={secretId} onChange={(e) => setSecretId(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="wma-secret-key">SecretKey（SK）</Label>
          <Input id="wma-secret-key" type="password" autoComplete="new-password"
            required={!record} maxLength={256}
            placeholder={record ? '留空保留原 SecretKey' : '腾讯云 SecretKey'}
            value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          在 <a className="underline" href="https://console.cloud.tencent.com/cam/capi" target="_blank" rel="noreferrer">腾讯云 API 密钥管理</a> 获取凭证。
          账号需关联 WorkBuddy 企业身份，并具备 WMA 的 Agent 查询、会话创建和访问令牌权限。
        </p>
        <AdvancedSection>
          <div className="grid gap-2">
            <Label htmlFor="wma-region">API 接入地域</Label>
            <Input id="wma-region" required value={region} placeholder="ap-guangzhou"
              onChange={(e) => setRegion(e.target.value)} />
          </div>
        </AdvancedSection>
      </>
      {!hideFooter && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? '保存中…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
