/// <reference types="node" />
// @vitest-environment node
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
const script = readFileSync(new URL('../../public/diagram-frame.js', import.meta.url), 'utf8')

it('fits a noninteractive thumbnail and extends the native grid without changing the architecture paths', () => {
  const dom = new JSDOM('<div id="canvas" tabindex="0"></div>', { runScripts: 'outside-only', url: 'https://gateway.test/admin/diagram-frame.html' })
  const w = dom.window, messages: unknown[] = []
  const parent = { postMessage: (value: unknown) => messages.push(value) }
  Object.defineProperty(w, 'parent', { value: parent })
  w.eval(script)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon class="entire-grid" points="0 0,100 100"/><g key="node"><path d="M1 2L3 4"/></g></svg>'
  const render = { type: 'architecture-diagram-render', svg, nodes: [] }
  w.dispatchEvent(new w.MessageEvent('message', { source: parent, data: render }))
  const fullBounds = w.document.querySelector('svg').getAttribute('viewBox').split(' ').map(Number)
  w.dispatchEvent(new w.MessageEvent('message', { source: parent, data: { ...render, preview: true } }))
  const root = w.document.querySelector('svg'), canvas = w.document.getElementById('canvas')
  const previewBounds = root.getAttribute('viewBox').split(' ').map(Number)
  expect(previewBounds[2]).toBeLessThan(fullBounds[2])
  expect(Number(root.querySelector('.entire-grid').getAttribute('points').split(' ')[0])).toBeLessThan(previewBounds[0])
  expect(root.querySelector('path').getAttribute('d')).toBe('M1 2L3 4')
  expect(canvas.hasAttribute('tabindex')).toBe(false)
  const initial = root.getAttribute('viewBox')
  const wheel = new w.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
  canvas.dispatchEvent(wheel)
  canvas.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  canvas.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  expect(wheel.defaultPrevented).toBe(false)
  expect(root.getAttribute('viewBox')).toBe(initial)
  expect(messages).toEqual([])
  dom.window.close()
})

it('selects native SVG nodes, preserves their shapes and labels, and removes active cloud content', () => {
  const dom = new JSDOM('<div id="canvas"></div>', { runScripts: 'outside-only', url: 'https://gateway.test/admin/diagram-frame.html' })
  const w = dom.window
  const messages: unknown[] = []
  const parent = { postMessage: (value: unknown) => messages.push(value) }
  Object.defineProperty(w, 'parent', { value: parent })
  w.SVGElement.prototype.getBBox = () => ({ x: 10, y: 20, width: 50, height: 40 })
  w.eval(script)
  const native = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="window.bad=true"><script>window.bad=true</script><g key="node-one"><path d="M1 2L3 4"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">原始标签</div></foreignObject></g><g key="foreign"><path d="M5 6L7 8"/></g></svg>'
  function render(source: unknown, svg = native, selectedNodeId = '') {
    w.dispatchEvent(new w.MessageEvent('message', { source, data: { type: 'architecture-diagram-render', svg, nodes: [{ id: 'node-one', name: '服务' }], selectedNodeId, zoom: 1 } }))
  }
  render({})
  expect(w.document.querySelector('svg')).toBeNull()
  render(parent)
  expect(w.document.querySelector('script')).toBeNull()
  expect(w.document.querySelector('svg').hasAttribute('onload')).toBe(false)
  expect(w.document.querySelector('path').getAttribute('d')).toBe('M1 2L3 4')
  expect(w.document.querySelector('foreignObject').textContent).toBe('原始标签')
  expect(w.document.querySelector('g[key="foreign"]').hasAttribute('role')).toBe(false)
  w.document.querySelector('path').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  expect(messages).toContainEqual({ type: 'architecture-node-selected', nodeId: 'node-one' })
  expect(w.document.querySelector('.gateway-selection')).toBeTruthy()
  const node = w.document.querySelector('g[key="node-one"]')
  expect(node.getAttribute('aria-pressed')).toBe('true')
  render(parent, native.replace('M1 2L3 4', 'M9 8L7 6'), 'node-one')
  expect(w.document.querySelector('path').getAttribute('d')).toBe('M9 8L7 6')
  expect(w.document.querySelector('g[key="node-one"]').getAttribute('aria-pressed')).toBe('true')
  w.document.querySelector('g[key="node-one"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(messages.at(-1)).toEqual({ type: 'architecture-node-selected', nodeId: '' })
  dom.window.close()
})

it('pans beyond the original bounds, anchors wheel zoom and keeps drag separate from node selection', () => {
  const dom = new JSDOM('<div id="canvas"></div>', { runScripts: 'outside-only', url: 'https://gateway.test/admin/diagram-frame.html' })
  const w = dom.window, messages: unknown[] = []
  const parent = { postMessage: (value: unknown) => messages.push(value) }
  Object.defineProperty(w, 'parent', { value: parent })
  w.SVGElement.prototype.getBBox = () => ({ x: 10, y: 20, width: 50, height: 40 })
  w.eval(script)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon class="entire-grid" points="-300000 -300000,300000 300000"/><g key="node-one"><path d="M1 2L3 4"/></g></svg>'
  function message(data: unknown, source: unknown = parent) { w.dispatchEvent(new w.MessageEvent('message', { source, data })) }
  const render = { type: 'architecture-diagram-render', svg, nodes: [{ id: 'node-one', name: '服务' }], selectedNodeId: 'node-one' }
  message(render)
  const root = w.document.querySelector('svg'), canvas = w.document.getElementById('canvas'), path = w.document.querySelector('path')
  const bounds = () => root.getAttribute('viewBox').split(' ').map(Number)
  const initial = root.getAttribute('viewBox')
  function pointer(target: typeof canvas, type: string, x: number, y: number) {
    target.dispatchEvent(new w.PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }))
  }
  pointer(path, 'pointerdown', 20, 30)
  pointer(canvas, 'pointermove', 10000000, 10000000)
  pointer(canvas, 'pointerup', 10000000, 10000000)
  canvas.dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(bounds()[0]).toBeLessThan(-1000000)
  expect(bounds()[1]).toBeLessThan(-1000000)
  expect(messages).toEqual([])
  expect(w.document.querySelector('[data-gateway-node]').getAttribute('aria-pressed')).toBe('true')
  const extent = Number(root.querySelector('.entire-grid').getAttribute('points').split(' ')[0])
  expect(extent).toBeLessThan(bounds()[0])
  const [x, y, width, height] = bounds(), anchorX = x + 200 / 640 * width, anchorY = y + 150 / 480 * height
  const wheel = new w.WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 150, bubbles: true, cancelable: true })
  canvas.dispatchEvent(wheel)
  const next = bounds()
  expect(wheel.defaultPrevented).toBe(true)
  expect(next[2]).toBeLessThan(width)
  expect(next[0] + 200 / 640 * next[2]).toBeCloseTo(anchorX)
  expect(next[1] + 150 / 480 * next[3]).toBeCloseTo(anchorY)
  const panned = root.getAttribute('viewBox')
  message(render)
  expect(root.getAttribute('viewBox')).toBe(panned)
  message({ type: 'architecture-diagram-command', command: 'fit' }, { postMessage() {} })
  expect(root.getAttribute('viewBox')).toBe(panned)
  message({ type: 'architecture-diagram-command', command: 'fit' })
  expect(root.getAttribute('viewBox')).toBe(initial)
  pointer(path, 'pointerdown', 20, 30)
  pointer(canvas, 'pointerup', 20, 30)
  canvas.dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 }))
  expect(messages).toEqual([{ type: 'architecture-node-selected', nodeId: 'node-one' }])
  canvas.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(root.getAttribute('viewBox')).not.toBe(initial)
  canvas.dispatchEvent(new w.KeyboardEvent('keydown', { key: '0', bubbles: true }))
  expect(root.getAttribute('viewBox')).toBe(initial)
  expect(path.getAttribute('d')).toBe('M1 2L3 4')
  dom.window.close()
})
