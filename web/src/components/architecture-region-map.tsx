import { useEffect, useRef, useState } from 'react'
import { regionMapLayout } from '@/lib/architecture-map'
import { tencentRegionName } from '@/lib/tencent-regions'
import type { ArchitectureRegion } from '@/lib/types'


type Geometry = { type: string; coordinates: number[][][] | number[][][][] }
function paths(geometry: Geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][]
  return polygons.map(polygon => polygon.map(ring => ring.map(([lon, lat], index) => `${index ? 'L' : 'M'}${(lon + 180).toFixed(2)},${(90 - lat).toFixed(2)}`).join(' ') + 'Z').join(' '))
}

export function ArchitectureRegionMap({ regions, compact = false }: { regions: ArchitectureRegion[]; compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 480, height: compact ? 176 : 256 })
  const [land, setLand] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}maps/world-land.geojson`, { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error('Map unavailable')
      return r.json() as Promise<{ features: { geometry: Geometry }[] }>
    }).then(data => { if (!controller.signal.aborted) setLand(data.features.flatMap(f => paths(f.geometry))) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [])
  const { points, viewBox, unit } = regionMapLayout(regions, size.width, size.height)
  return <div ref={container} className={`relative overflow-hidden rounded-lg border bg-sky-50/60 dark:bg-slate-950 ${compact ? 'h-44' : 'h-64'}`}>
    <svg viewBox={viewBox.join(' ')} className="h-full w-full" role="img" aria-label="架构图资源地域分布；自动适应资源地域范围">
      <title>资源地域分布 · 底图 Natural Earth，点位表示云地域所在城市</title>
      <g fill="currentColor" className="text-slate-200 dark:text-slate-800" stroke="currentColor" strokeWidth="0.1">
        {[-360, 0, 360].map(shift => <g key={shift} transform={`translate(${shift} 0)`}>{land.map((path, index) => <path key={index} d={path} />)}</g>)}
      </g>
      {points.map(region => <g key={region.id} className="text-primary">
        <title>{tencentRegionName(region.id) || region.id} · {region.resourceCount} 个资源</title>
        <circle cx={region.x} cy={region.y} r={14 * unit} fill="currentColor" opacity="0.16" />
        <circle cx={region.x} cy={region.y} r={6 * unit} fill="currentColor" stroke="white" strokeWidth={2 * unit} />
        <text x={region.x} y={region.y - 21 * unit} textAnchor="middle" fontSize={12 * unit} fill="currentColor" fontWeight="600"
          stroke="var(--background, white)" strokeWidth={3 * unit} paintOrder="stroke">{tencentRegionName(region.id) || region.id} · {region.resourceCount}</text>
      </g>)}
    </svg>
    {!points.length && <p className="absolute inset-x-0 top-1/2 text-center text-xs text-muted-foreground">暂无可定位的资源地域</p>}
    {failed && <p className="absolute bottom-2 left-3 text-xs text-muted-foreground">地图底图暂不可用</p>}
  </div>
}
