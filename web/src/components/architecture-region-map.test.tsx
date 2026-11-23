import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ArchitectureRegionMap } from '@/components/architecture-region-map'
import { regionMapLayout } from '@/lib/architecture-map'
const region = (id: string) => ({ id, resourceCount: 12, products: ['CVM'] })
afterEach(() => vi.restoreAllMocks())

it('automatically enlarges one region while keeping its label and marker readable', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ features: [] }) } as unknown as Response)
  const { container } = render(<ArchitectureRegionMap compact regions={[region('ap-guangzhou')]} />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  const svg = screen.getByRole('img', { name: /自动适应资源地域范围/ })
  const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number)
  expect(w).toBeLessThan(30)
  expect(h).toBeLessThan(15)
  expect(293.26).toBeGreaterThan(x)
  expect(293.26).toBeLessThan(x + w)
  expect(66.87).toBeGreaterThan(y)
  expect(66.87).toBeLessThan(y + h)
  expect(Number(container.querySelectorAll('circle')[1].getAttribute('r')) * 480 / w).toBeCloseTo(6)
  expect(Number(container.querySelector('text')!.getAttribute('font-size')) * 480 / w).toBeCloseTo(12)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('全部地域')).toBeNull()
  expect(screen.getByText('广州 · 12')).toBeTruthy()
})

it('fits all regions, including locations across the date line, and adapts to container shape', () => {
  for (const [width, height] of [[480, 176], [300, 256]]) {
    const fit = regionMapLayout(['ap-guangzhou', 'ap-tokyo', 'na-siliconvalley'].map(region), width, height)
    const [x, y, w, h] = fit.viewBox
    expect(w / h).toBeCloseTo(width / height)
    for (const p of fit.points) {
      expect(p.x).toBeGreaterThan(x); expect(p.x).toBeLessThan(x + w)
      expect(p.y).toBeGreaterThan(y); expect(p.y).toBeLessThan(y + h)
    }
  }
  const pacific = regionMapLayout(['ap-tokyo', 'na-siliconvalley'].map(region), 480, 176)
  expect(pacific.viewBox[2]).toBeLessThan(150)
  const unknown = regionMapLayout([region('unknown')], 480, 176)
  expect(unknown.points).toEqual([])
  expect(unknown.viewBox.every(Number.isFinite)).toBe(true)
})
