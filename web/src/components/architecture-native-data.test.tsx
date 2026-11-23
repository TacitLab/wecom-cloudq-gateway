import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArchitectureOriginalDiagram } from '@/components/architecture-original-diagram'
import { ArchitectureCapacity } from '@/components/architecture-capacity'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('displays the exact Tencent SVG as an isolated image without redrawing', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L50 50"/><text>腾讯云原始图</text></svg>'
  vi.mocked(api).mockResolvedValue({ svg, fetchedAt: 0, view: '3d' })
  const { container } = render(<ArchitectureOriginalDiagram id="watch-one" />)
  const image = await screen.findByRole('img', { name: '腾讯云智能顾问 3D 原始架构图' })
  expect(decodeURIComponent(image.getAttribute('src')!.split(',').slice(1).join(','))).toBe(svg)
  expect(container.querySelector('svg:not(.lucide)')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '放大原图' }))
  expect((image as HTMLElement).style.width).toBe('125%')
})

it('switches between real server variants, resets zoom and caches each view separately', async () => {
  vi.mocked(api).mockImplementation(async url => {
    const view = new URL(url, 'http://test').searchParams.get('view')
    return { view, svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${view}</text></svg>`, fetchedAt: 0 }
  })
  render(<ArchitectureOriginalDiagram id="watch-one" />)
  const threeD = await screen.findByRole('img', { name: /3D 原始架构图/ })
  fireEvent.click(screen.getByRole('button', { name: '放大原图' }))
  expect(threeD.style.width).toBe('125%')
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  const twoD = await screen.findByRole('img', { name: /2D 原始架构图/ })
  expect(twoD.style.width).toBe('100%')
  expect(decodeURIComponent(twoD.getAttribute('src')!)).toContain('<text>2d</text>')
  expect(screen.getByRole('button', { name: '2D' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '3D' }))
  await screen.findByRole('img', { name: /3D 原始架构图/ })
  expect(vi.mocked(api)).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '刷新原图' }))
  await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(3))
  await screen.findByRole('img', { name: /3D 原始架构图/ })
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(4))
})

it('ignores a late response from the view that was switched away from', async () => {
  let release!: (value: unknown) => void
  const delayed = new Promise(resolve => { release = resolve })
  vi.mocked(api).mockImplementation(async url => url.endsWith('view=3d') ? delayed : { svg: '<svg/>', fetchedAt: 0, view: '2d' })
  render(<ArchitectureOriginalDiagram id="watch-one" />)
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  await screen.findByRole('img', { name: /2D 原始架构图/ })
  await act(async () => release({ svg: '<svg/>', fetchedAt: 0, view: '3d' }))
  expect(screen.queryByRole('img', { name: /3D 原始架构图/ })).toBeNull()
  expect(screen.getByRole('button', { name: '2D' }).getAttribute('aria-pressed')).toBe('true')
})

it('reports unavailable originals without creating a substitute topology', async () => {
  vi.mocked(api).mockRejectedValue(new Error('原图权限不足'))
  const { container } = render(<ArchitectureOriginalDiagram id="watch-one" />)
  expect((await screen.findByRole('alert')).textContent).toContain('原图权限不足')
  expect(container.querySelector('svg:not(.lucide)')).toBeNull()
})

it('shows authoritative cloud capacity levels and stale report status', async () => {
  vi.mocked(api).mockResolvedValue({ source: 'advisor', complete: true, fetchedAt: 0, finishedAt: 0, warnings: [], errors: [], resources: [
    { resourceId: 'ins-one', resourceName: '当前高负载实例', product: 'CVM', region: 'ap-guangzhou', riskLevel: 3, stale: false, supported: true, updatedAt: 1, periodDays: 14,
      metrics: [{ name: '内存利用率', riskLevel: 3, value: 92 }] },
    { resourceId: 'ins-old', resourceName: '过期报告实例', product: 'CVM', region: 'ap-guangzhou', riskLevel: 2, stale: true, supported: true, updatedAt: 1, periodDays: 7, metrics: [] },
  ] })
  render(<ArchitectureCapacity id="watch-one" />)
  await screen.findByText('当前高负载实例')
  expect(screen.getByText('高负载')).toBeTruthy()
  expect(screen.getByText('中负载')).toBeTruthy()
  expect(screen.getByText('历史结果 · 暂停播报')).toBeTruthy()
})

it('accepts node selection only from its own sandboxed frame and known node IDs', async () => {
  vi.mocked(api).mockResolvedValue({ svg: '<svg/>', fetchedAt: 0, view: '3d' })
  const onNodeSelect = vi.fn()
  render(<ArchitectureOriginalDiagram id="watch-one" nodes={[{ id: 'node-one', name: '登录服务', product: 'CVM', bindingNodeIds: ['node-one'], resourceKeys: [], resourceCount: 0 }]} onNodeSelect={onNodeSelect} />)
  const frame = await screen.findByTitle('腾讯云智能顾问 3D 原始架构图') as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  fireEvent.load(frame)
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'architecture-diagram-render', svg: '<svg/>' }), '*')
  fireEvent(window, new MessageEvent('message', { source: window, data: { type: 'architecture-node-selected', nodeId: 'node-one' } }))
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: 'architecture-node-selected', nodeId: 'node-foreign' } }))
  expect(onNodeSelect).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: 'architecture-node-selected', nodeId: 'node-one' } }))
  expect(onNodeSelect).toHaveBeenCalledWith('node-one')
})

it('floats tools over the diagram and sends camera commands without reloading the SVG', async () => {
  vi.mocked(api).mockResolvedValue({ svg: '<svg/>', fetchedAt: 0, view: '3d' })
  render(<ArchitectureOriginalDiagram id="watch-one" onNodeSelect={vi.fn()} />)
  const frame = await screen.findByTitle('腾讯云智能顾问 3D 原始架构图') as HTMLIFrameElement
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  expect(screen.getByRole('toolbar', { name: '架构图工具' }).className).toContain('absolute')
  for (const [label, command] of [['放大原图', 'zoom-in'], ['缩小原图', 'zoom-out'], ['适应画布', 'fit']]) {
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(post).toHaveBeenCalledWith({ type: 'architecture-diagram-command', command }, '*')
  }
  expect(api).toHaveBeenCalledOnce()
})
