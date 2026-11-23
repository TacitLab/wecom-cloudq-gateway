/* The frame has an opaque sandbox origin. No cloud script or link is executed. */
(() => {
  'use strict';
  const canvas = document.getElementById('canvas');
  let source = '', root = null, selected = '', allowed = new Set(), preview = false;
  let nativeBox = [0, 0, 1000, 700], camera = null, fitBox = null, drag = null, skipClick = false;
  function viewport() {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width || 640, height: rect.height || 480 };
  }
  function fittedBox() {
    const { width, height } = viewport(), [x, y, w, h] = nativeBox;
    const scale = Math.min(Math.max(1, width - (preview ? 32 : 48)) / w, Math.max(1, height - (preview ? 48 : 100)) / h);
    return { x: x + w / 2 - width / scale / 2, y: y + h / 2 - height / scale / 2, w: width / scale, h: height / scale };
  }
  function paintCamera() {
    if (!root || !camera) return;
    root.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
    // Extend only the exported background grid; native architecture paths stay intact.
    const extent = Math.max(300000, Math.abs(camera.x) + camera.w, Math.abs(camera.y) + camera.h) * 4;
    for (const grid of root.querySelectorAll('polygon.entire-grid,polygon.quarter-grid')) {
      grid.setAttribute('points', `${-extent} ${-extent}, ${extent} ${-extent}, ${extent} ${extent}, ${-extent} ${extent}`);
    }
  }
  function fit() { if (root) { fitBox = fittedBox(); camera = { ...fitBox }; paintCamera(); } }
  function zoomBy(factor, px, py) {
    if (!camera || !fitBox) return;
    const { width, height } = viewport(), old = camera;
    const zoom = Math.min(12, Math.max(.1, fitBox.w / old.w * factor));
    const w = fitBox.w / zoom, h = fitBox.h / zoom;
    const fx = px === undefined ? .5 : px / width, fy = py === undefined ? .5 : py / height;
    camera = { x: old.x + (old.w - w) * fx, y: old.y + (old.h - h) * fy, w, h };
    paintCamera();
  }
  function panBy(dx, dy) {
    if (!camera) return;
    const { width, height } = viewport();
    camera.x -= dx * camera.w / width; camera.y -= dy * camera.h / height;
    paintCamera();
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
    if (!camera || !fitBox) return;
    if (preview) { fit(); return; }
    const zoom = fitBox.w / camera.w, cx = camera.x + camera.w / 2, cy = camera.y + camera.h / 2;
    fitBox = fittedBox();
    camera = { x: cx - fitBox.w / zoom / 2, y: cy - fitBox.h / zoom / 2, w: fitBox.w / zoom, h: fitBox.h / zoom };
    paintCamera();
  }).observe(canvas);

  function highlight(id) {
    selected = id;
    canvas.querySelectorAll('.gateway-selection').forEach(el => el.remove());
    for (const el of canvas.querySelectorAll('[data-gateway-node]')) {
      el.setAttribute('aria-pressed', String(el.dataset.gatewayNode === selected));
      if (el.dataset.gatewayNode !== selected) continue;
      const box = el.getBBox();
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      mark.setAttribute('class', 'gateway-selection');
      for (const [attr, value] of Object.entries({ x: box.x - 7, y: box.y - 7, width: box.width + 14, height: box.height + 14, rx: 5 })) mark.setAttribute(attr, String(value));
      el.append(mark);
    }
  }
  function choose(id) {
    if (preview) return;
    if (id && !allowed.has(id)) return;
    highlight(id);
    window.parent.postMessage({ type: 'architecture-node-selected', nodeId: id }, '*');
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (data?.type === 'architecture-diagram-command') {
      if (preview) return;
      if (data.command === 'fit') fit();
      if (data.command === 'zoom-in') zoomBy(1.25);
      if (data.command === 'zoom-out') zoomBy(.8);
      return;
    }
    if (data?.type !== 'architecture-diagram-render') return;
    if (typeof data.svg !== 'string' || data.svg.length > 10 * 1024 * 1024 || !Array.isArray(data.nodes)) return;
    const modeChanged = preview !== (data.preview === true);
    preview = data.preview === true;
    canvas.classList.toggle('preview', preview);
    if (preview) { canvas.removeAttribute('tabindex'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '业务架构缩略图'); }
    else { canvas.setAttribute('tabindex', '0'); canvas.setAttribute('role', 'application'); canvas.setAttribute('aria-label', '智能顾问原始架构图，拖动平移，滚轮缩放，按 0 适应画布'); }
    const nodes = preview ? [] : data.nodes.filter(node => typeof node.id === 'string' && typeof node.name === 'string');
    allowed = new Set(nodes.map(node => node.id));
    try {
      if (source !== data.svg || modeChanged) {
        const parsed = new DOMParser().parseFromString(data.svg, 'image/svg+xml');
        if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Invalid SVG');
        root = document.importNode(parsed.documentElement, true);
        // Preserve the native paths, layout and foreignObject labels, remove active content.
        root.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,button,video,audio,animate,animateMotion,animateTransform,set,discard').forEach(el => el.remove());
        for (const el of [root, ...root.querySelectorAll('*')]) for (const attr of [...el.attributes]) {
          const name = attr.localName.toLowerCase(), value = attr.value.trim();
          if (name.startsWith('on') || name === 'srcdoc' || name === 'tabindex' || name.startsWith('data-gateway-')
            || ((name === 'href' || name === 'src') && !value.startsWith('#') && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value))) el.removeAttributeNode(attr);
        }
        canvas.replaceChildren(root); source = data.svg;
        const bounds = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        nativeBox = bounds.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0 ? bounds : [0, 0, 1000, 700];
        drag = null; canvas.classList.remove('panning'); fit();
      }
      for (const node of nodes) {
        // SVG node keys are the DiagramId from DescribeArch, identical in both views.
        const el = [...root.querySelectorAll('g[key],g[id]')].find(g => g.getAttribute('key') === node.id || g.id === node.id);
        if (!el) continue;
        el.dataset.gatewayNode = node.id;
        el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', node.name);
      }
      highlight(allowed.has(data.selectedNodeId) ? data.selectedNodeId : '');
    } catch {
      window.parent.postMessage({ type: 'architecture-diagram-error' }, '*');
    }
  });
  canvas.addEventListener('click', event => {
    event.preventDefault();
    if (skipClick) { skipClick = false; return; }
    const node = event.target.closest('[data-gateway-node]');
    choose(node?.dataset.gatewayNode || '');
  });
  canvas.addEventListener('pointerdown', event => {
    if (preview || !root || event.button !== 0 || drag) return;
    skipClick = false;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      moved: false, nodeId: event.target.closest('[data-gateway-node]')?.dataset.gatewayNode || '' };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 4) return;
    drag.moved = true; canvas.classList.add('panning');
    panBy(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const ended = drag; drag = null; skipClick = true;
    canvas.classList.remove('panning');
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!ended.moved) choose(ended.nodeId);
  });
  function cancelDrag() { drag = null; canvas.classList.remove('panning'); }
  canvas.addEventListener('pointercancel', cancelDrag);
  canvas.addEventListener('lostpointercapture', cancelDrag);
  canvas.addEventListener('dragstart', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    if (preview || !root) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport().height : 1);
    zoomBy(Math.exp(-Math.max(-200, Math.min(200, delta)) * .003), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    if (preview) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const step = event.shiftKey ? 160 : 40;
      panBy(event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0, event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); }
    if (event.key === '-') { event.preventDefault(); zoomBy(.8); }
    if (event.key === '0') { event.preventDefault(); fit(); }
    if (event.key === 'Escape') { event.preventDefault(); choose(''); }
    if (event.key === 'Enter' || event.key === ' ') {
      const node = event.target.closest('[data-gateway-node]');
      if (node) { event.preventDefault(); choose(node.dataset.gatewayNode); }
    }
  });
})();
