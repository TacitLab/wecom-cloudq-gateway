import { Skeleton } from '@/components/ui/skeleton'

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  const widths = ['42%', '78%', '63%', '86%', '54%', '71%']
  return (
    <div className="px-2 py-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="my-4 h-4" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  )
}
