/**
 * V-Model Graph Editor — context-driven UX
 *
 * Interaction model (no mode toolbar):
 *   • Click node (no drag)  → context menu: Add Traceability link / Add Sequential link / Delete node
 *   • After choosing a link type → rubber-band line follows mouse; click target to confirm, Esc/click bg to cancel
 *   • Click connection line → context menu: Delete link
 *   • Drag node             → reposition
 *   • Drag bend handle      → reshape connection curve
 *
 * Link types:
 *   'trace'      — bidirectional traceability (dashed blue ↔) — drives traceability fields in pages
 *   'sequential' — bidirectional sequential flow (solid gray ↔) — visual only
 */

export const VMODEL_NODES = [
  { id: 'sys_req',     domain: 'system', phase: 'requirements',        label: 'System Requirements' },
  { id: 'sys_arch',    domain: 'system', phase: 'architecture',        label: 'System Architecture' },
  { id: 'sys_it',      domain: 'system', phase: 'integration_testing', label: 'System Integration Test' },
  { id: 'sys_qt',      domain: 'system', phase: 'system_testing',      label: 'System Qualification Test' },
  { id: 'sw_req',      domain: 'sw',     phase: 'requirements',        label: 'SW Requirements' },
  { id: 'sw_arch',     domain: 'sw',     phase: 'architecture',        label: 'SW Architecture' },
  { id: 'sw_design',   domain: 'sw',     phase: 'design',              label: 'SW Detailed Design' },
  { id: 'sw_impl',     domain: 'sw',     phase: 'implementation',      label: 'SW Units' },
  { id: 'sw_ut',       domain: 'sw',     phase: 'unit_testing',        label: 'Unit Test Spec' },
  { id: 'sw_it',       domain: 'sw',     phase: 'integration_testing', label: 'SW Integration Test Spec' },
  { id: 'sw_qt',       domain: 'sw',     phase: 'system_testing',      label: 'SW Qualification Test Spec' },
  { id: 'hw_req',      domain: 'hw',     phase: 'requirements',        label: 'HW Requirements' },
  { id: 'hw_arch',     domain: 'hw',     phase: 'architecture',        label: 'HW Architecture' },
  { id: 'hw_design',   domain: 'hw',     phase: 'design',              label: 'HW Detailed Design' },
  { id: 'hw_ut',       domain: 'hw',     phase: 'unit_testing',        label: 'HW Test Spec' },
  { id: 'mech_req',    domain: 'mech',   phase: 'requirements',        label: 'MECH Requirements' },
  { id: 'mech_design', domain: 'mech',   phase: 'design',              label: 'MECH Detailed Design' },
];

export const PHASE_DB_SOURCE = {
  requirements:        'requirements',
  architecture:        'arch_spec_items',
  unit_testing:        'test_specs',
  integration_testing: 'test_specs',
  system_testing:      'test_specs',
};

// ── ASPICE SW default ─────────────────────────────────────────────────────────

const ASPICE_NODES = [
  { nodeId: 'sys_req',   x: 20,  y: 20  },
  { nodeId: 'sys_arch',  x: 90,  y: 95  },
  { nodeId: 'sw_req',    x: 160, y: 170 },
  { nodeId: 'sw_arch',   x: 230, y: 245 },
  { nodeId: 'sw_design', x: 300, y: 320 },
  { nodeId: 'sw_impl',   x: 390, y: 400 },
  { nodeId: 'sw_ut',     x: 490, y: 320 },
  { nodeId: 'sw_it',     x: 560, y: 245 },
  { nodeId: 'sw_qt',     x: 630, y: 170 },
  { nodeId: 'sys_it',    x: 700, y: 95  },
  { nodeId: 'sys_qt',    x: 770, y: 20  },
];

const ASPICE_LINKS = [
  { from: 'sys_req',   to: 'sys_qt',  type: 'trace' },
  { from: 'sys_arch',  to: 'sys_it',  type: 'trace' },
  { from: 'sw_req',    to: 'sw_qt',   type: 'trace' },
  { from: 'sw_arch',   to: 'sw_it',   type: 'trace' },
  { from: 'sw_design', to: 'sw_ut',   type: 'trace' },
];

// ── Dimensions ────────────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 36;
const DRAG_THRESHOLD = 5; // px before mousedown→move is treated as drag

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountVmodelEditor(wrapper, { links = [], canvasNodes = [], configId, fullConfig, project, sb, toast, onSave }) {

  // ── State ─────────────────────────────────────────────────────────────────
  let _nodes        = [];
  let _links        = [];
  let _connectFrom  = null;  // nodeId being connected from
  let _connectType  = null;  // 'trace' | 'sequential'
  let _drag         = null;  // { nodeId, offX, offY, moved }
  let _bendDrag     = null;  // { linkId, startMX, startMY, startBX, startBY }
  let _popover      = null;  // current floating menu element
  let _mouseX       = 0;     // mouse pos relative to canvas (for rubber-band)
  let _mouseY       = 0;
  let _dirty        = false;

  // Init from saved
  if (canvasNodes.length) {
    _nodes = canvasNodes.map(cn => {
      const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
      return def ? { ...def, x: cn.x, y: cn.y } : null;
    }).filter(Boolean);
  }
  _links = links.map(l => ({ ...l, type: l.type || 'trace' }));

  // ── HTML ──────────────────────────────────────────────────────────────────
  wrapper.innerHTML = `
    <div class="vme-wrap">
      <div class="vme-toolbar">
        <div class="vme-toolbar-left">
          <button class="btn btn-secondary btn-sm" id="vme-load-aspice"
            title="Adds ASPICE SW nodes and links — keeps your existing content">↺ Add ASPICE base</button>
          <button class="btn btn-ghost btn-sm" id="vme-clear">Clear</button>
        </div>
        <div class="vme-toolbar-right">
          <div class="vme-legend">
            <span class="vme-legend-trace">↔ Traceability</span>
            <span class="vme-legend-seq">↔ Sequential</span>
          </div>
          <button class="btn btn-primary btn-sm" id="vme-save">Save</button>
        </div>
      </div>
      <div class="vme-hint-bar" id="vme-hint">
        Click a node to connect or delete · Drag to reposition · Drag the midpoint dot to reroute a connection
      </div>
      <div class="vme-body">
        <div class="vme-palette" id="vme-palette">
          <div class="vme-palette-title">Palette</div>
          <div id="vme-pal-list"></div>
        </div>
        <div class="vme-canvas-scroll">
          <div class="vme-canvas" id="vme-canvas">
            <svg class="vme-svg" id="vme-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-trace" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-trace-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-seq" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#666"/>
                </marker>
                <marker id="arr-seq-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#666"/>
                </marker>
                <marker id="arr-rubber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#F29900"/>
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = wrapper.querySelector('#vme-canvas');
  const svg    = wrapper.querySelector('#vme-svg');
  const hint   = wrapper.querySelector('#vme-hint');

  // ── Palette ───────────────────────────────────────────────────────────────
  function refreshPalette() {
    const placed = new Set(_nodes.map(n => n.id));
    const list   = wrapper.querySelector('#vme-pal-list');
    const avail  = VMODEL_NODES.filter(n => !placed.has(n.id));
    if (!avail.length) { list.innerHTML = `<p class="vme-pal-empty">All nodes placed.</p>`; return; }
    const groups = {};
    avail.forEach(n => (groups[n.domain] = groups[n.domain] || []).push(n));
    const dOrder = ['system','sw','hw','mech'];
    const dLabel = { system:'System', sw:'SW', hw:'HW', mech:'MECH' };
    list.innerHTML = dOrder.filter(d => groups[d]).map(d => `
      <div class="vme-pal-group">
        <div class="vme-pal-group-label">${dLabel[d]}</div>
        ${groups[d].map(n => `<div class="vme-pal-item vme-nd--${n.domain}" draggable="true" data-nodeid="${n.id}">${n.label}</div>`).join('')}
      </div>`).join('');
    list.querySelectorAll('.vme-pal-item').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.nodeid); e.dataTransfer.effectAllowed = 'copy'; });
    });
  }

  // ── Canvas drop ───────────────────────────────────────────────────────────
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('text/plain');
    const def    = VMODEL_NODES.find(n => n.id === nodeId);
    if (!def) return;
    const rect = canvas.getBoundingClientRect();
    _nodes.push({ ...def, x: Math.max(0, e.clientX - rect.left - NODE_W / 2), y: Math.max(0, e.clientY - rect.top - NODE_H / 2) });
    _dirty = true; render();
  });

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    closePopover();
    refreshPalette();
    renderNodes();
    renderSVG();
  }

  function renderNodes() {
    canvas.querySelectorAll('.vme-node').forEach(el => el.remove());
    _nodes.forEach(node => {
      const div = document.createElement('div');
      div.className   = `vme-node vme-nd--${node.domain}`;
      div.style.left  = node.x + 'px';
      div.style.top   = node.y + 'px';
      div.dataset.nid = node.id;
      div.textContent = node.label;
      if (_connectFrom === node.id) div.classList.add('vme-node--source');
      else if (_connectFrom)        div.classList.add('vme-node--target-hint');
      canvas.appendChild(div);
      wireNode(div, node);
    });
  }

  function wireNode(div, node) {
    // If we're in connect mode, clicking any other node completes the link
    if (_connectFrom && _connectFrom !== node.id) {
      div.style.cursor = 'crosshair';
      div.addEventListener('click', e => {
        e.stopPropagation();
        const from = _connectFrom, to = node.id, type = _connectType;
        const dup  = _links.some(l => l.type === type && ((l.from === from && l.to === to) || (l.from === to && l.to === from)));
        if (!dup) { _links.push({ id: uid(), from, to, type }); _dirty = true; }
        _connectFrom = null; _connectType = null;
        setHint('Click a node to connect or delete · Drag to reposition');
        render();
      });
      return;
    }

    // Normal: drag or click for context menu
    div.style.cursor = 'grab';

    div.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      closePopover();
      const rect = canvas.getBoundingClientRect();
      _drag = {
        nodeId: node.id,
        offX: e.clientX - rect.left - node.x,
        offY: e.clientY - rect.top  - node.y,
        moved: false,
        startX: e.clientX, startY: e.clientY,
      };
      div.style.cursor = 'grabbing';
      div.classList.add('vme-node--dragging');
    });

    div.addEventListener('click', e => {
      if (_drag?.moved) return; // was a drag, not a click
      e.stopPropagation();
      showNodeMenu(node, div);
    });
  }

  // ── Context menus ─────────────────────────────────────────────────────────
  function showNodeMenu(node, div) {
    closePopover();
    const menu = document.createElement('div');
    menu.className = 'vme-menu';

    // Position to the right of the node, or left if too close to edge
    const nx = node.x + NODE_W + 6;
    const ny = node.y;
    menu.style.left = nx + 'px';
    menu.style.top  = ny + 'px';

    menu.innerHTML = `
      <div class="vme-menu-title">${node.label}</div>
      <button class="vme-menu-item vme-menu-trace" data-action="trace">↔ Add Traceability link</button>
      <button class="vme-menu-item vme-menu-seq"   data-action="seq">↔ Add Sequential link</button>
      <div class="vme-menu-sep"></div>
      <button class="vme-menu-item vme-menu-del"   data-action="del">✕ Delete node</button>
    `;
    canvas.appendChild(menu);
    _popover = menu;

    menu.querySelector('[data-action="trace"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _connectFrom = node.id; _connectType = 'trace';
      setHint(`<span style="color:#1A73E8">↔ Traceability</span> from <strong>${node.label}</strong> — click the target node · Esc to cancel`);
      renderNodes(); renderSVG();
    });
    menu.querySelector('[data-action="seq"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _connectFrom = node.id; _connectType = 'sequential';
      setHint(`<span style="color:#666">↔ Sequential</span> from <strong>${node.label}</strong> — click the target node · Esc to cancel`);
      renderNodes(); renderSVG();
    });
    menu.querySelector('[data-action="del"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _nodes = _nodes.filter(n => n.id !== node.id);
      _links = _links.filter(l => l.from !== node.id && l.to !== node.id);
      _dirty = true; render();
    });
  }

  function showLinkMenu(link, x, y) {
    closePopover();
    const menu = document.createElement('div');
    menu.className = 'vme-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    const isTrace = link.type === 'trace';
    menu.innerHTML = `
      <div class="vme-menu-title" style="color:${isTrace?'#1A73E8':'#666'}">${isTrace ? '↔ Traceability link' : '↔ Sequential link'}</div>
      <button class="vme-menu-item vme-menu-del" data-action="del">✕ Delete link</button>
    `;
    canvas.appendChild(menu);
    _popover = menu;
    menu.querySelector('[data-action="del"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _links = _links.filter(l => l.id !== link.id);
      _dirty = true; renderSVG();
    });
  }

  function closePopover() {
    _popover?.remove();
    _popover = null;
  }

  // ── SVG ───────────────────────────────────────────────────────────────────
  function renderSVG() {
    svg.querySelectorAll('.vme-link, .vme-link-hit, .vme-bend-handle, .vme-rubber').forEach(el => el.remove());

    const nodeMap = Object.fromEntries(_nodes.map(n => [n.id, n]));

    _links.forEach(link => {
      const a = nodeMap[link.from], b = nodeMap[link.to];
      if (!a || !b) return;
      drawLink(link, a, b);
    });

    renderRubberBand();
  }

  function drawLink(link, a, b) {
    const isTrace = (link.type || 'trace') === 'trace';

    const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
    const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
    const mx = (ax + bx) / 2,    my = (ay + by) / 2;

    // Control point
    let defBY = 0;
    if (isTrace && !link.bend) {
      const sign = ay <= by ? -1 : 1;
      defBY = sign * Math.max(45, Math.abs(by - ay) * 0.45);
    }
    const cpx = mx + (link.bend?.x || 0);
    const cpy = my + (link.bend?.y !== undefined ? link.bend.y : defBY);
    const d = `M${ax},${ay} Q${cpx},${cpy} ${bx},${by}`;

    // Visual midpoint of quadratic bezier (t=0.5)
    const vmx = (ax + 2 * cpx + bx) / 4;
    const vmy = (ay + 2 * cpy + by) / 4;

    const stroke = isTrace ? '#1A73E8' : '#888';
    const dash   = isTrace ? '7 4' : 'none';
    const mEnd   = isTrace ? 'url(#arr-trace)'     : 'url(#arr-seq)';
    const mStart = isTrace ? 'url(#arr-trace-start)' : 'url(#arr-seq-start)';
    const op     = isTrace ? '0.8' : '0.55';

    // Wide hit area for clicking
    const hit = mkSVG('path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.setAttribute('fill', 'none');
    hit.classList.add('vme-link-hit');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', e => {
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      showLinkMenu(link, e.clientX - rect.left, e.clientY - rect.top);
    });

    // Visible path
    const path = mkSVG('path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', isTrace ? '2' : '1.5');
    path.setAttribute('stroke-dasharray', dash);
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', op);
    path.setAttribute('marker-end',   mEnd);
    path.setAttribute('marker-start', mStart);
    path.classList.add('vme-link');

    svg.appendChild(hit);
    svg.appendChild(path);

    // Bend handle (always visible)
    const ring = mkSVG('circle');
    ring.setAttribute('cx', vmx); ring.setAttribute('cy', vmy); ring.setAttribute('r', '8');
    ring.setAttribute('fill', 'transparent');
    ring.setAttribute('stroke', stroke);
    ring.setAttribute('stroke-width', '1.5');
    ring.setAttribute('opacity', '0.35');
    ring.style.cursor = 'move';
    ring.style.pointerEvents = 'all';
    ring.classList.add('vme-bend-handle');

    const dot = mkSVG('circle');
    dot.setAttribute('cx', vmx); dot.setAttribute('cy', vmy); dot.setAttribute('r', '4');
    dot.setAttribute('fill', stroke);
    dot.setAttribute('opacity', '0.55');
    dot.style.cursor = 'move';
    dot.style.pointerEvents = 'all';
    dot.classList.add('vme-bend-handle');

    const isTrace2 = isTrace; // capture for closure
    const startBend = e => {
      e.stopPropagation(); e.preventDefault();
      closePopover();
      _bendDrag = {
        linkId:  link.id,
        startMX: e.clientX, startMY: e.clientY,
        startBX: link.bend?.x || 0,
        startBY: link.bend?.y !== undefined ? link.bend.y : defBY,
      };
    };
    ring.addEventListener('mousedown', startBend);
    dot.addEventListener('mousedown', startBend);

    svg.appendChild(ring);
    svg.appendChild(dot);
  }

  function renderRubberBand() {
    svg.querySelectorAll('.vme-rubber').forEach(el => el.remove());
    if (!_connectFrom) return;
    const src = _nodes.find(n => n.id === _connectFrom);
    if (!src) return;

    const ax = src.x + NODE_W / 2, ay = src.y + NODE_H / 2;
    const isTrace = _connectType === 'trace';

    // Rubber-band line from source to mouse
    const line = mkSVG('line');
    line.setAttribute('x1', ax);   line.setAttribute('y1', ay);
    line.setAttribute('x2', _mouseX); line.setAttribute('y2', _mouseY);
    line.setAttribute('stroke', '#F29900');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', isTrace ? '6 3' : 'none');
    line.setAttribute('opacity', '0.75');
    line.setAttribute('marker-end', 'url(#arr-rubber)');
    line.classList.add('vme-rubber');
    line.style.pointerEvents = 'none';
    svg.appendChild(line);

    // Pulsing circle on source
    const pulse = mkSVG('circle');
    pulse.setAttribute('cx', ax); pulse.setAttribute('cy', ay); pulse.setAttribute('r', '10');
    pulse.setAttribute('fill', 'none');
    pulse.setAttribute('stroke', '#F29900');
    pulse.setAttribute('stroke-width', '2');
    pulse.setAttribute('opacity', '0.5');
    pulse.classList.add('vme-rubber');
    svg.appendChild(pulse);
  }

  // ── Global mouse events ───────────────────────────────────────────────────
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);

  function onMouseMove(e) {
    // Update mouse coords for rubber-band
    const rect = canvas.getBoundingClientRect();
    _mouseX = e.clientX - rect.left;
    _mouseY = e.clientY - rect.top;

    if (_connectFrom) { renderRubberBand(); return; }

    if (_bendDrag) {
      const link = _links.find(l => l.id === _bendDrag.linkId);
      if (link) {
        link.bend = {
          x: _bendDrag.startBX + (e.clientX - _bendDrag.startMX),
          y: _bendDrag.startBY + (e.clientY - _bendDrag.startMY),
        };
        renderSVG(); _dirty = true;
      }
      return;
    }

    if (_drag) {
      const dx = e.clientX - _drag.startX, dy = e.clientY - _drag.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) _drag.moved = true;
      if (_drag.moved) {
        const node = _nodes.find(n => n.id === _drag.nodeId);
        if (node) {
          node.x = Math.max(0, Math.min(e.clientX - rect.left - _drag.offX, canvas.scrollWidth  - NODE_W));
          node.y = Math.max(0, Math.min(e.clientY - rect.top  - _drag.offY, canvas.scrollHeight - NODE_H));
          const div = canvas.querySelector(`[data-nid="${node.id}"]`);
          if (div) { div.style.left = node.x + 'px'; div.style.top = node.y + 'px'; }
          renderSVG(); _dirty = true;
        }
      }
    }
  }

  function onMouseUp() {
    if (_bendDrag) { _bendDrag = null; return; }
    if (_drag) {
      const div = canvas.querySelector(`[data-nid="${_drag.nodeId}"]`);
      if (div) { div.style.cursor = 'grab'; div.classList.remove('vme-node--dragging'); }
      _drag = null;
    }
  }

  // ── Canvas click (cancel connect / close popover) ─────────────────────────
  canvas.addEventListener('click', e => {
    if (e.target !== canvas && e.target !== svg) return;
    if (_connectFrom) {
      _connectFrom = null; _connectType = null;
      setHint('Click a node to connect or delete · Drag to reposition');
      renderNodes(); renderSVG();
    }
    closePopover();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (_connectFrom) {
        _connectFrom = null; _connectType = null;
        setHint('Click a node to connect or delete · Drag to reposition');
        renderNodes(); renderSVG();
      }
      closePopover();
    }
  });

  // ── ASPICE default (merge) ────────────────────────────────────────────────
  wrapper.querySelector('#vme-load-aspice').addEventListener('click', () => {
    const placedIds = new Set(_nodes.map(n => n.id));
    ASPICE_NODES.forEach(cn => {
      if (!placedIds.has(cn.nodeId)) {
        const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
        if (def) _nodes.push({ ...def, x: cn.x, y: cn.y });
      }
    });
    ASPICE_LINKS.forEach(al => {
      const dup = _links.some(l => l.type === al.type && ((l.from === al.from && l.to === al.to) || (l.from === al.to && l.to === al.from)));
      if (!dup) _links.push({ id: uid(), ...al });
    });
    _dirty = true; render();
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-clear').addEventListener('click', () => {
    if (!confirm('Clear all nodes and links?')) return;
    _nodes = []; _links = []; _connectFrom = null; _dirty = true;
    render();
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-save').addEventListener('click', async () => {
    const btn = wrapper.querySelector('#vme-save');
    btn.disabled = true;
    const canvasNodesSave = _nodes.map(n => ({ nodeId: n.id, x: n.x, y: n.y }));
    const newConfig = { ...fullConfig, vmodel_links: _links, vmodel_canvas_nodes: canvasNodesSave };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    Object.assign(fullConfig, newConfig);
    _dirty = false;
    toast('V-Model saved.', 'success');
    if (onSave) onSave(_links, canvasNodesSave);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function mkSVG(tag)  { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function uid()       { return crypto.randomUUID(); }
  function setHint(h)  { if (hint) hint.innerHTML = h; }

  render();

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  };
}
