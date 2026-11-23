import { useEffect, useRef, useState } from 'react'
import { Maximize, Minus, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ArchitectureNode } from '@/lib/types'

type DiagramView = '2d' | '3d'
interface OriginalDiagram { svg: string; fetchedAt: number; view: DiagramView }

export function ArchitectureOriginalDiagram({ id, nodes = [], selectedNodeId = '', onNodeSelect }: {
  id: string; nodes?: ArchitectureNode[]; selectedNodeId?: string; onNodeSelect?: (id: string) => void
}) {
  const [diagram, setDiagram] = useState<OriginalDiagram | null>(null)
  const [view, setView] = useState<DiagramView>('3d')
  const cache = useRef<Record<string, OriginalDiagram>>({})
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [zoom, setZoom] = useState(1)
  const frame = useRef<HTMLIFrameElement>(null)
  function renderFrame() {
    if (diagram) frame.current?.contentWindow?.postMessage({ type: 'architecture-diagram-render', svg: diagram.svg,
      nodes: nodes.map(node => ({ id: node.id, name: node.name })), selectedNodeId }, '*')
  }
  useEffect(renderFrame, [diagram, nodes, selectedNodeId])
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return
      if (event.data?.type === 'architecture-node-selected' && typeof event.data.nodeId === 'string'
        && (!event.data.nodeId || nodes.some(node => node.id === event.data.nodeId))) onNodeSelect?.(event.data.nodeId)
      if (event.data?.type === 'architecture-diagram-error') setError('智能顾问原图无法显示，请刷新原图后重试。')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [nodes, onNodeSelect])
  useEffect(() => {
    const controller = new AbortController()
    const key = `${id}:${view}`
    const request = cache.current[key] ? Promise.resolve(cache.current[key])
      : api<OriginalDiagram>(`/api/admin/architecture-watches/${id}/diagram?view=${view}`, { signal: controller.signal })
    request.then(result => {
      if (controller.signal.aborted) return
      if (result.view !== view) throw new Error('原图视图与请求不一致，请刷新后重试。')
      cache.current[key] = result
      setDiagram(result); setError('')
    })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => controller.abort()
  }, [id, view, refresh])
  function changeView(next: DiagramView) {
    if (view === next) return
    setError(''); setDiagram(cache.current[`${id}:${next}`] ?? null); setZoom(1); setView(next)
  }
  function command(action: 'fit' | 'zoom-in' | 'zoom-out') {
    if (onNodeSelect) frame.current?.contentWindow?.postMessage({ type: 'architecture-diagram-command', command: action }, '*')
    else setZoom(value => action === 'fit' ? 1 : Math.min(12, Math.max(.1, value + (action === 'zoom-in' ? .25 : -.25))))
  }
  return <div className="relative h-[540px] min-w-0 overflow-hidden rounded-xl border bg-white xl:h-[640px]">
    <div role="toolbar" aria-label="架构图工具" className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur-sm">
      <div className="flex gap-1 border-r pr-1" role="group" aria-label="架构图视图">
        <Button size="sm" variant={view === '2d' ? 'default' : 'ghost'} aria-pressed={view === '2d'} onClick={() => changeView('2d')}>2D</Button>
        <Button size="sm" variant={view === '3d' ? 'default' : 'ghost'} aria-pressed={view === '3d'} onClick={() => changeView('3d')}>3D</Button>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="缩小原图" title="缩小" disabled={!diagram} onClick={() => command('zoom-out')}><Minus /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="适应画布" title="适应画布，重置缩放和平移" disabled={!diagram} onClick={() => command('fit')}><Maximize /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="放大原图" title="放大" disabled={!diagram} onClick={() => command('zoom-in')}><Plus /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="刷新原图" title={diagram ? `刷新原图，读取于 ${new Date(diagram.fetchedAt).toLocaleString()}` : '刷新原图'} onClick={() => {
        delete cache.current[`${id}:2d`]; delete cache.current[`${id}:3d`]; setError(''); setDiagram(null); setZoom(1); setRefresh(v => v + 1)
      }}><RefreshCw /></Button>
    </div>
    {error ? <p role="alert" className="grid h-full place-content-center break-words p-6 text-sm text-destructive">{error}</p>
      : !diagram ? <p role="status" className="grid h-full place-content-center text-center text-sm text-muted-foreground">正在读取智能顾问 {view.toUpperCase()} 原图…</p>
        : onNodeSelect ? <iframe ref={frame} src={`${import.meta.env.BASE_URL}diagram-frame.html`} sandbox="allow-scripts"
          title={`腾讯云智能顾问 ${view.toUpperCase()} 原始架构图`} className="h-full w-full border-0" onLoad={renderFrame} />
          : <div className="h-full overflow-auto">
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`} alt={`腾讯云智能顾问 ${view.toUpperCase()} 原始架构图`}
              className="block max-w-none" style={{ width: `${zoom * 100}%`, minHeight: 300 }}
              onError={() => setError('智能顾问原图无法显示，请从页面右上角打开腾讯云架构图。')} />
          </div>}
  </div>
}
