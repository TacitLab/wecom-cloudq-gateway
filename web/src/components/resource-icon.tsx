import { AppWindow, Boxes } from 'lucide-react'
import cvm from '@/assets/tencent-products/cvm.svg'
import clb from '@/assets/tencent-products/clb.svg'
import redis from '@/assets/tencent-products/redis.svg'
import prometheus from '@/assets/tencent-products/prometheus.svg'
import cdb from '@/assets/tencent-products/cdb.svg'
import tke from '@/assets/tencent-products/tke.svg'
import ckafka from '@/assets/tencent-products/ckafka.svg'
import apm from '@/assets/tencent-products/apm.svg'

const tencentIcons: Record<string, string> = { cvm, clb, redis, prometheus, tmp: prometheus, cdb, mysql: cdb, tke, ckafka, apm }

// Decorative: the adjacent product/application name supplies the accessible label.
export function CloudProductIcon({ product, cloudProvider = 'tencent' }: { product: string; cloudProvider?: string }) {
  const src = cloudProvider === 'tencent' ? tencentIcons[product.toLowerCase()] : undefined
  return <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
    {src ? <img src={src} alt="" width={24} height={24} className="size-6 object-contain" /> : <Boxes className="size-5" />}
  </span>
}

export function ApplicationIcon({ compact = false }: { compact?: boolean }) {
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 ${compact ? 'size-7' : 'size-9'}`}>
    <AppWindow className={compact ? 'size-4' : 'size-5'} />
  </span>
}
