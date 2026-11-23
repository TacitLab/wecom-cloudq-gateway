import { useState } from 'react'
import { ExternalLink, Network, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { ArchitectureWatchDialog } from '@/components/dialogs/architecture-watch-dialog'
import { ConfirmButton } from '@/components/confirm-button'
import { PanelCard } from '@/components/panel-card'
import { TableSkeleton } from '@/components/table-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import type { AdminState } from '@/lib/types'

export function ArchitectureWatchesView({ state, reload, onSetupCredential, onOpen }: {
  state: AdminState | null
  reload: () => Promise<void>
  onSetupCredential: () => void
  onOpen: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const watches = state?.architectureWatches ?? []
  async function remove(id: string) {
    try {
      await api(`/api/admin/architecture-watches/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success('架构图已移除')
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <>
      <PanelCard title="架构值守" hint="选择架构图查看产品、资源与地域分布，配置值守、群推送及 RCA。"
        action={state && !state.tencentCredentials.length
          ? <Button variant="outline" onClick={onSetupCredential}>先配置腾讯云凭证</Button>
          : <Button disabled={!state} onClick={() => setAdding(true)}><Plus />添加架构图</Button>}>
        {!state ? <TableSkeleton rows={3} /> : !watches.length ? (
          <div className="flex flex-col items-center gap-3 border-t px-4 py-12 text-center">
            <Network className="size-8 text-muted-foreground" />
            <p className="font-medium">尚未添加架构图</p>
            <p className="max-w-md text-sm text-muted-foreground">选择腾讯云凭证，查询智能顾问中已有的架构图，再手动添加到这里。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>架构图</TableHead><TableHead>腾讯云凭证</TableHead><TableHead>版本</TableHead>
                <TableHead>状态</TableHead><TableHead>添加时间</TableHead><TableHead className="text-right">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>{watches.map(watch => (
                <TableRow key={watch.id} className="cursor-pointer" onClick={() => onOpen(watch.id)}>
                  <TableCell><button className="max-w-sm cursor-pointer whitespace-normal text-left font-medium hover:underline" onClick={e => { e.stopPropagation(); onOpen(watch.id) }}>{watch.archName}</button>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{watch.archId}</div>
                  </TableCell>
                  <TableCell>{watch.credentialName}</TableCell>
                  <TableCell>{watch.versionName || '—'}</TableCell>
                  <TableCell><Badge variant={watch.dutyEnabled ? 'default' : 'secondary'}>{watch.dutyEnabled ? '值守已启用' : '待配置值守'}</Badge>
                    {watch.dutyError && <p className="mt-1 max-w-sm truncate text-xs text-destructive" title={watch.dutyError}>最近检查有异常</p>}</TableCell>
                  <TableCell>{new Date(watch.createdAt).toLocaleString()}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><div className="flex justify-end gap-1">
                    <a className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      href={`https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(watch.archId)}`}
                      target="_blank" rel="noopener noreferrer">
                      <ExternalLink />查看架构图
                    </a>
                    <ConfirmButton trigger={<Button variant="ghost" size="sm">移除</Button>} title="移除这个架构图？"
                      description="仅从本地值守列表移除，腾讯云中的原始架构图将保留。" actionLabel="确认移除" onConfirm={() => remove(watch.id)} />
                  </div></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </PanelCard>
      {adding && state && <ArchitectureWatchDialog state={state} onOpenChange={setAdding} onSaved={reload} />}
    </>
  )
}
