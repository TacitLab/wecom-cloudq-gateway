import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toastTask } from '@/lib/toast-task'
import type { TencentCredentialConfig } from '@/lib/types'

export function TencentCredentialForm({
  record,
  onSaved,
  onCancel,
}: {
  record?: TencentCredentialConfig
  onSaved: () => Promise<void>
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [secretId, setSecretId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(record?.name ?? '')
    setSecretId('')
    setSecretKey('')
  }, [record])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = record?.id
      await toastTask(
        api(`/api/admin/tencent-credentials${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify({ id, name, secretId, secretKey }),
        }),
        '保存中…',
        '腾讯云凭证已保存',
      )
      await onSaved()
    } catch {
      // 错误已由 toastTask 提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="tc-name">名称</Label>
        <Input
          id="tc-name"
          required
          maxLength={100}
          placeholder="生产环境腾讯云账号"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tc-secret-id">SecretId</Label>
        <Input
          id="tc-secret-id"
          type="password"
          autoComplete="new-password"
          placeholder="编辑时留空表示不修改"
          value={secretId}
          onChange={(e) => setSecretId(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tc-secret-key">SecretKey</Label>
        <Input
          id="tc-secret-key"
          type="password"
          autoComplete="new-password"
          placeholder="编辑时留空表示不修改"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </form>
  )
}
