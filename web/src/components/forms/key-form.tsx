import { useEffect, useState } from 'react'

import { AdvancedSection } from '@/components/advanced-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { ApiKeyConfig } from '@/lib/types'

export function KeyForm({
  record,
  onSaved,
  onCancel,
  submitLabel = '保存',
  formId,
  hideFooter,
}: {
  record?: ApiKeyConfig
  onSaved: () => Promise<void>
  onCancel?: () => void
  submitLabel?: string
  formId?: string
  hideFooter?: boolean
}) {
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://www.codebuddy.cn/v2/agentos')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(record?.name ?? '')
    setApiKey('')
    setBaseUrl(record?.baseUrl ?? 'https://www.codebuddy.cn/v2/agentos')
  }, [record])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/keys${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({ id, name, apiKey, baseUrl }),
        }),
        '保存中…',
        'API Key 已保存',
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
          placeholder="生产环境企业 Key"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="key-secret">API Key</Label>
        <Input
          id="key-secret"
          type="password"
          autoComplete="new-password"
          placeholder="编辑时留空表示不修改"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <AdvancedSection>
        <div className="grid gap-2">
          <Label htmlFor="key-baseurl">AgentOS Base URL</Label>
          <Input id="key-baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      </AdvancedSection>
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
