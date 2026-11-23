import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ArchitectureOverview } from '@/components/architecture-overview'
import { ArchitectureOriginalDiagram } from '@/components/architecture-original-diagram'
import { ArchitectureNodeInspector } from '@/components/architecture-node-inspector'
import { ArchitectureDutyHistory } from '@/components/architecture-duty-history'
import { ArchitectureDutyForm } from '@/components/forms/architecture-duty-form'
import { PanelCard } from '@/components/panel-card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import type { AdminState, ArchitectureDetail, ArchitectureDutySettings } from '@/lib/types'

export function ArchitectureDetailView({ id, state, reloadState, onBack }: {
  id: string; state: AdminState | null; reloadState: () => Promise<void>; onBack: () => void
}) {
  const [detail, setDetail] = useState<ArchitectureDetail | null>(null)
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  const [nodeId, setNodeId] = useState('')
  const [tab, setTab] = useState('diagram'), [toggling, setToggling] = useState(false)
  const shownWarning = useRef('')
  const warning = detail?.settings.lastError || ''
  useEffect(() => {
    const toastId = `architecture-check-${id}`
    if (!warning) { shownWarning.current = ''; toast.dismiss(toastId); return }
    const key = `${id}:${warning}`
    if (shownWarning.current === key) return
    shownWarning.current = key
    const messages = warning.split('；').filter(Boolean)
    const first = messages[0] || warning
    toast.warning(`最近检查有 ${messages.length} 项提示`, {
      id: toastId, position: 'top-center', duration: 6000, closeButton: true,
      description: `${first.length > 180 ? first.slice(0, 180) + '…' : first}${messages.length > 1 ? '；其余提示见历史记录。' : ''}`,
      action: { label: '查看记录', onClick: () => setTab('history') },
    })
  }, [id, warning])
  useEffect(() => () => { toast.dismiss(`architecture-check-${id}`) }, [id])

  useEffect(() => {
    const controller = new AbortController()
    api<ArchitectureDetail>(`/api/admin/architecture-watches/${id}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setDetail(result); setError(''); setNodeId(current => result.nodes?.some(n => n.id === current) ? current : '') } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => controller.abort()
  }, [id, refresh])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setInterval(() => {
      void api<ArchitectureDutySettings>(`/api/admin/architecture-watches/${id}/settings`, { signal: controller.signal })
        .then(settings => { if (!controller.signal.aborted) setDetail(current => current && settings.revision >= current.settings.revision ? { ...current, settings } : current) }).catch(() => {})
    }, 10000)
    return () => { clearInterval(timer); controller.abort() }
  }, [id])
  function settingsSaved(settings: ArchitectureDutySettings) {
    setDetail(current => current ? { ...current, settings } : current)
    void reloadState()
  }
  async function toggle(enabled: boolean) {
    if (enabled && (!detail?.settings.botConfigId || (!Object.values(detail.settings.products).some(p => p.enabled) && !detail.settings.apmApplications?.length))) {
      setTab('settings'); toast.info('请先配置推送 Bot 和产品或 APM 应用范围，再开启值守。'); return
    }
    setToggling(true)
    try {
      settingsSaved(await api<ArchitectureDutySettings>(`/api/admin/architecture-watches/${id}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) }))
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setToggling(false) }
  }
  return <div className="grid min-w-0 gap-6">
    <div className="detail-heading flex flex-wrap items-start justify-between gap-3">
      <div><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回架构值守</Button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{detail?.watch.archName || '架构详情'}</h1>
        {detail && <p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">{detail.watch.archId}</span> · {detail.watch.credentialName} · {detail.watch.versionName || '未标记版本'}</p>}
      </div>
      <div className="flex items-center gap-2">{detail && <a className={buttonVariants({ variant: 'outline', size: 'sm' })} target="_blank" rel="noopener noreferrer" href={`https://console.cloud.tencent.com/advisor?archId=${encodeURIComponent(detail.watch.archId)}`}><ExternalLink />腾讯云架构图</a>}
        <Button variant="outline" size="sm" onClick={() => { setError(''); setDetail(null); setRefresh(v => v + 1) }}><RefreshCw />刷新资源</Button></div>
    </div>
    {error && <div role="alert" className="rounded-lg border p-6 text-sm text-destructive">{error}<Button className="ml-3" variant="outline" size="sm" onClick={() => setRefresh(v => v + 1)}>重试</Button></div>}
    {!detail ? !error && <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground" role="status">正在读取架构图及绑定资源…</div> : <>
      <ArchitectureOverview detail={detail} busy={toggling} onEnabled={enabled => void toggle(enabled)} onSettings={() => setTab('settings')} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="diagram">架构图</TabsTrigger><TabsTrigger value="settings">值守设置</TabsTrigger><TabsTrigger value="history">历史记录</TabsTrigger></TabsList>
        <TabsContent value="diagram">
          <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_330px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <ArchitectureOriginalDiagram key={id} id={id} nodes={detail.nodes} selectedNodeId={nodeId} onNodeSelect={setNodeId} />
            <ArchitectureNodeInspector key={`${id}:${nodeId}`} id={id} detail={detail} nodeId={nodeId} />
          </div>
        </TabsContent>
        <TabsContent value="settings"><PanelCard className="panel-card-form" title="值守设置" hint="先配置统一的值守与推送方式，再分别选择云资源和 APM 应用范围。"><ArchitectureDutyForm detail={detail} state={state} onSaved={settingsSaved} /></PanelCard></TabsContent>
        <TabsContent value="history"><PanelCard title="值守历史"><ArchitectureDutyHistory id={id} /></PanelCard></TabsContent>
      </Tabs>
    </>}
  </div>
}
