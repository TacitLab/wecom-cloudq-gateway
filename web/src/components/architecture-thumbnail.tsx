import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { ArchitectureWatch } from '@/lib/types'

interface DiagramPreview { svg: string; view: '3d'; fetchedAt: number }
// Share a bounded, short-lived cache between the homepage and architecture list.
const diagrams = new Map<string, { data: DiagramPreview; cachedAt: number }>()
const CACHE_TTL = 5 * 60 * 1000

export function ArchitectureThumbnail({ watch, refresh = 0, decorative = false }: {
  watch: ArchitectureWatch; refresh?: number; decorative?: boolean
}) {
  const key = `${watch.id}:${watch.credentialId}:${watch.versionName}`
  const [diagram, setDiagram] = useState<DiagramPreview | null>(null)
  const [imageError, setImageError] = useState(false)
  const [visible, setVisible] = useState(!decorative || typeof IntersectionObserver === 'undefined')
  const container = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const lastRefresh = useRef(refresh)

  useEffect(() => {
    if (visible || !container.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [visible])

  function renderPreview() {
    if (diagram) frame.current?.contentWindow?.postMessage({
      type: 'architecture-diagram-render', svg: diagram.svg, nodes: [], preview: true,
    }, '*')
  }
  useEffect(renderPreview, [diagram])
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (frame.current?.contentWindow && event.source === frame.current.contentWindow && event.data?.type === 'architecture-diagram-error') {
        diagrams.delete(key); setImageError(true)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [key])

  useEffect(() => {
    if (!visible) return
    if (lastRefresh.current !== refresh) { diagrams.delete(key); lastRefresh.current = refresh }
    const controller = new AbortController()
    const cached = diagrams.get(key)
    const request = cached && Date.now() - cached.cachedAt < CACHE_TTL
      ? Promise.resolve(cached.data)
      : api<DiagramPreview>(`/api/admin/architecture-watches/${encodeURIComponent(watch.id)}/diagram?view=3d`, { signal: controller.signal })
    request.then(result => {
      if (controller.signal.aborted) return
      if (result.view !== '3d' || typeof result.svg !== 'string' || !/<svg[\s>]/i.test(result.svg)) throw new Error('Invalid diagram preview')
      if (!diagrams.has(key) && diagrams.size >= 6) diagrams.delete(diagrams.keys().next().value!)
      diagrams.set(key, { data: result, cachedAt: cached?.data === result ? cached.cachedAt : Date.now() })
      setDiagram(result); setImageError(false)
    }).catch(() => { if (!controller.signal.aborted) setImageError(true) })
    return () => controller.abort()
  }, [key, watch.id, refresh, visible])

  return <div ref={container} className="architecture-thumbnail" aria-hidden={decorative || undefined}>
    {imageError ? !decorative && <div className="architecture-preview-unavailable"><ImageOff className="size-6" /><span>缩略图暂不可用</span><span className="text-[11px]">仍可进入详情查看值守状态</span></div>
      : diagram ? <iframe ref={frame} src={`${import.meta.env.BASE_URL}diagram-frame.html`} sandbox="allow-scripts"
        title={`${watch.archName}的原始 3D 架构图`} tabIndex={-1} aria-hidden="true" onLoad={renderPreview}
        onError={() => { diagrams.delete(key); setImageError(true) }} />
        : !decorative && <div className="architecture-preview-loading" role="status" aria-label={`正在加载${watch.archName}的架构缩略图`}><Skeleton className="h-full w-full" /><span>正在读取架构图…</span></div>}
  </div>
}
