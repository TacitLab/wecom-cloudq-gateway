import { useEffect, useState } from 'react'
import { ArrowRight, Box, Clock3, CloudCog, RefreshCw } from 'lucide-react'
import { PanelCard } from '@/components/panel-card'
import { StatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { ArchitectureThumbnail } from '@/components/architecture-thumbnail'
import { api } from '@/lib/api'
import type { ArchitectureDutySettings, ArchitectureWatch } from '@/lib/types'

function cacheKey(watch: ArchitectureWatch) {
  return `${watch.id}:${watch.credentialId}:${watch.versionName}`
}

function previewPriority(watch: ArchitectureWatch) {
  return watch.dutyEnabled ? watch.dutyError ? 0 : 1 : 2
}

function checkTime(value: number | null) {
  if (!value) return '尚无成功记录'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function ArchitecturePreviewCard({ watch, refresh }: { watch: ArchitectureWatch; refresh: number }) {
  const [settings, setSettings] = useState<ArchitectureDutySettings | null>(null)
  const [settingsError, setSettingsError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function load() {
      if (pending) return
      pending = true
      try {
        const result = await api<ArchitectureDutySettings>(`/api/admin/architecture-watches/${encodeURIComponent(watch.id)}/settings`, { signal: controller.signal })
        if (!controller.signal.aborted) { setSettings(result); setSettingsError(false) }
      } catch { if (!controller.signal.aborted) setSettingsError(true) }
      finally { pending = false }
    }
    void load()
    // Settings are a lightweight local read; refresh check timestamps without
    // reloading the remote SVG or the full cloud resource inventory.
    const timer = setInterval(() => void load(), 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [watch.id, watch.dutyEnabled, watch.dutyError, refresh])

  const enabled = settings?.enabled ?? watch.dutyEnabled
  const issue = enabled && (settings?.lastError || watch.dutyError)
  const waitingForChat = enabled && settings && !settings.targetChatId
  return <a className="architecture-preview-card" href={`#architecture-watches/${encodeURIComponent(watch.id)}`} aria-label={`查看${watch.archName}的架构和值守详情`}>
    <div className="architecture-preview-canvas">
      <span className="architecture-preview-label"><Box className="size-3" />3D 架构</span>
      <ArchitectureThumbnail watch={watch} refresh={refresh} />
      <span className="architecture-preview-open"><ArrowRight className="size-4" /></span>
    </div>
    <div className="architecture-preview-info">
      <div className="architecture-preview-heading"><h3>{watch.archName}</h3><StatusBadge tone={issue ? 'error' : waitingForChat ? 'warning' : enabled ? 'success' : 'neutral'}>{issue ? '检查异常' : waitingForChat ? '待绑定群' : enabled ? '值守中' : '未启用'}</StatusBadge></div>
      <p className="architecture-preview-description">{watch.description || '查看业务拓扑、资源分布与持续值守记录。'}</p>
      <div className="architecture-preview-meta"><span><CloudCog className="size-3.5" />{watch.credentialName}</span>{watch.versionName && <span>{watch.versionName}</span>}</div>
      <dl className="architecture-preview-facts">
        <div><dt>检查计划</dt><dd>{settingsError ? '暂不可用' : settings ? `${settings.schedule.allDay ? '全天' : '按时段'} · 每 ${settings.pollIntervalSeconds} 秒` : '读取中…'}</dd></div>
        <div><dt>最近成功检查</dt><dd>{settingsError ? '暂不可用' : settings ? checkTime(settings.lastSuccessAt) : '读取中…'}</dd></div>
      </dl>
      <div className="architecture-preview-footer"><span><Clock3 className="size-3.5" />{issue ? '最近检查有异常，进入详情查看' : enabled ? '持续关注资源与告警变化' : '进入详情配置值守范围'}</span><span>查看详情<ArrowRight className="size-3.5" /></span></div>
    </div>
  </a>
}

export function ArchitecturePreviews({ watches, onBrowse }: { watches: ArchitectureWatch[]; onBrowse: () => void }) {
  const [refresh, setRefresh] = useState(0)
  const featured = [...watches].sort((a, b) => previewPriority(a) - previewPriority(b) || b.createdAt - a.createdAt).slice(0, 3)
  if (!featured.length) return null
  return <PanelCard className="architecture-previews" title="值守架构" hint="从业务拓扑进入值守现场，优先展示异常与已启用的架构。"
    action={<div className="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label="刷新架构预览" title="刷新架构预览" onClick={() => {
      setRefresh(value => value + 1)
    }}><RefreshCw /></Button><Button variant="ghost" size="sm" onClick={onBrowse}>全部架构 · {watches.length}<ArrowRight /></Button></div>}>
    <div className={`architecture-preview-grid ${featured.length === 1 ? 'is-single' : ''}`}>{featured.map(watch => <ArchitecturePreviewCard key={cacheKey(watch)} watch={watch} refresh={refresh} />)}</div>
  </PanelCard>
}
