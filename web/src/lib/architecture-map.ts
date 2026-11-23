import type { ArchitectureRegion } from '@/lib/types'

const COORDINATES: Record<string, [number, number]> = {
  'ap-beijing': [116.4, 39.9], 'ap-shanghai': [121.47, 31.23], 'ap-nanjing': [118.8, 32.06], 'ap-guangzhou': [113.26, 23.13],
  'ap-chengdu': [104.07, 30.67], 'ap-chongqing': [106.55, 29.56], 'ap-zhongwei': [105.2, 37.5], 'ap-hongkong': [114.17, 22.3],
  'ap-beijing-fsi': [116.4, 39.9], 'ap-shanghai-fsi': [121.47, 31.23], 'ap-shenzhen-fsi': [114.06, 22.55], 'ap-shanghai-adc': [121.47, 31.23],
  'ap-singapore': [103.82, 1.35], 'ap-jakarta': [106.85, -6.21], 'ap-seoul': [126.98, 37.56], 'ap-tokyo': [139.69, 35.69],
  'ap-bangkok': [100.5, 13.76], 'me-saudi-arabia': [46.72, 24.71], 'sa-saopaulo': [-46.63, -23.55],
  'na-siliconvalley': [-121.89, 37.34], 'na-ashburn': [-77.49, 39.04], 'eu-frankfurt': [8.68, 50.11],
}


export function regionMapLayout(regions: ArchitectureRegion[], width: number, height: number) {
  const located = regions.filter(r => COORDINATES[r.id]).map(r => ({ ...r, x: COORDINATES[r.id][0] + 180, y: 90 - COORDINATES[r.id][1] }))
  if (!located.length) return { points: [], viewBox: [0, 0, 360, 180], unit: Math.max(360 / width, 180 / height) }
  // Fit the shortest longitude arc, including resources on both sides of the date line.
  const xs = located.map(p => p.x).sort((a, b) => a - b)
  const gaps = xs.map((x, i) => (xs[(i + 1) % xs.length] + (i === xs.length - 1 ? 360 : 0)) - x)
  const start = xs[(gaps.indexOf(Math.max(...gaps)) + 1) % xs.length]
  const points = located.map(p => ({ ...p, x: p.x < start ? p.x + 360 : p.x }))
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
  const spanX = Math.max(16, (maxX - minX) * 1.35 + 4), spanY = Math.max(10, (maxY - minY) * 1.4 + 4)
  const unit = Math.max(spanX / width, spanY / height)
  const w = unit * width, h = unit * height
  return { points, viewBox: [(minX + maxX - w) / 2, (minY + maxY - h) / 2, w, h], unit }
}
