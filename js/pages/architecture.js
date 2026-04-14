/**
 * Architecture Canvas Page
 *
 * Provides a Figma/Miro-style canvas to define system/item architecture:
 * - Components (HW / SW / Mechanical) as draggable, resizable boxes
 * - Functions inside each component, with safety marking (⚠)
 * - SVG connections between components with interface type + direction
 * - Auto-generated editable interface requirements
 * - Internal vs External interface detection via system_group
 *
 * Stored in: arch_components, arch_functions, arch_connections
 */

import { sb } from '../config.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../components/modal.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const COMP_COLORS = {
  HW:         { bg: '#E3F2FD', border: '#1565C0', text: '#0D47A1', label: '#1565C0' },
  SW:         { bg: '#E8F5E9', border: '#2E7D32', text: '#1B5E20', label: '#2E7D32' },
  Mechanical: { bg: '#FFF3E0', border: '#E65100', text: '#BF360C', label: '#E65100' },
};
const SAFETY_BORDER = '#BF2600';

const IFACE_STYLES = {
  Electrical: { stroke: '#F9A825', dash: '',       label: '⚡' },
  Data:       { stroke: '#1565C0', dash: '',       label: '⇄' },
  Mechanical: { stroke: '#4E342E', dash: '8,4',   label: '⚙' },
  Thermal:    { stroke: '#E65100', dash: '4,4',   label: '🌡' },
};

const PORT_POSITIONS = {
  top:    (w, h) => [w / 2, 0],
  right:  (w, h) => [w,     h / 2],
  bottom: (w, h) => [w / 2, h],
  left:   (w, h) => [0,     h / 2],
};

const GRID = 20;

// ── Module state ──────────────────────────────────────────────────────────────

let _s = null; // active canvas state

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderArchitecture(container, { project, item, system, domain }) {
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const title      = system ? `${system.name} — Architecture` : `${item.name} — Architecture`;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  const [{ data: comps }, { data: conns }] = await Promise.all([
    sb.from('arch_components')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order'),
    sb.from('arch_connections')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId),
  ]);

  // Load functions for each component
  const compIds = (comps || []).map(c => c.id);
  let funs = [];
  if (compIds.length) {
    const { data } = await sb.from('arch_functions')
      .select('*').in('component_id', compIds).order('sort_order');
    funs = data || [];
  }

  // Attach functions to components
  const components = (comps || []).map(c => ({
    ...c,
    functions: funs.filter(f => f.component_id === c.id),
  }));

  _s = {
    container, project, item, system,
    parentType, parentId, domain,
    components,
    connections: conns || [],
    // viewport
    panX: 0, panY: 0, zoom: 1,
    // interaction
    dragging: null,       // { id, startX, startY, origX, origY }
    resizing: null,       // { id, startX, startY, origW, origH }
    connecting: null,     // { sourceId, sourcePort, curX, curY }
    selected: null,       // component id
    // pending connection endpoint display
    tempPath: null,
  };

  container.innerHTML = `
    <div class="arch-shell">
      <div class="arch-toolbar" id="arch-toolbar">
        <span class="arch-toolbar-title">${escH(title)}</span>
        <div class="arch-toolbar-sep"></div>
        <button class="arch-tb-btn" id="btn-add-hw"   title="Add HW component">＋ HW</button>
        <button class="arch-tb-btn" id="btn-add-sw"   title="Add SW component">＋ SW</button>
        <button class="arch-tb-btn" id="btn-add-mech" title="Add Mech component">＋ Mech</button>
        <div class="arch-toolbar-sep"></div>
        <button class="arch-tb-btn arch-tb-danger" id="btn-del-comp" title="Delete selected" disabled>🗑 Delete</button>
        <div class="arch-toolbar-spacer"></div>
        <span class="arch-zoom-label" id="arch-zoom-label">100%</span>
        <button class="arch-tb-btn" id="btn-zoom-out">−</button>
        <button class="arch-tb-btn" id="btn-zoom-in">＋</button>
        <button class="arch-tb-btn" id="btn-zoom-fit">Fit</button>
        <div class="arch-toolbar-sep"></div>
        <button class="btn btn-primary btn-sm" id="btn-arch-save">💾 Save</button>
      </div>

      <div class="arch-workspace">
        <!-- Canvas -->
        <div class="arch-canvas-outer" id="arch-canvas-outer">
          <div class="arch-canvas-viewport" id="arch-viewport">
            <!-- SVG connection layer -->
            <svg class="arch-svg-layer" id="arch-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arrow-end"  markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"/>
                </marker>
                <marker id="arrow-start" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto">
                  <polygon points="10 0, 0 3.5, 10 7" fill="currentColor"/>
                </marker>
              </defs>
              <g id="arch-conn-layer"></g>
              <path id="arch-temp-path" fill="none" stroke="var(--color-primary)"
                stroke-width="2" stroke-dasharray="6,3" style="pointer-events:none;display:none"/>
            </svg>
            <!-- Components -->
            <div class="arch-comp-layer" id="arch-comp-layer"></div>
          </div>
        </div>

        <!-- Properties panel (right) -->
        <div class="arch-props-panel" id="arch-props-panel" style="display:none">
          <div class="arch-props-hdr" id="arch-props-hdr"></div>
          <div class="arch-props-body" id="arch-props-body"></div>
        </div>
      </div>

      <!-- Connection popover (hidden by default) -->
      <div class="arch-conn-popover" id="arch-conn-popover" style="display:none"></div>
    </div>
  `;

  renderComponents();
  renderConnections();
  wireCanvas();
  wireToolbar();
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderComponents() {
  const layer = document.getElementById('arch-comp-layer');
  if (!layer) return;
  layer.innerHTML = _s.components.map(c => compHTML(c)).join('');
  // Wire per-component events
  _s.components.forEach(c => wireComponent(c.id));
}

function compHTML(c) {
  const col  = COMP_COLORS[c.comp_type] || COMP_COLORS.HW;
  const safe = c.is_safety_critical;
  const funs = c.functions || [];
  const funChips = funs.map(f => `
    <div class="arch-fun-chip ${f.is_safety_related ? 'arch-fun-safe' : ''}"
         data-fun-id="${f.id}" data-comp-id="${c.id}">
      ${f.is_safety_related ? '<span class="arch-fun-warn">⚠</span>' : ''}
      <span class="arch-fun-name">${escH(f.name)}</span>
      <button class="arch-fun-del" data-fun-id="${f.id}" data-comp-id="${c.id}" title="Remove function">✕</button>
    </div>`).join('');

  const sel = _s.selected === c.id;
  return `
    <div class="arch-comp ${sel ? 'arch-comp--selected' : ''}"
         id="comp-${c.id}" data-id="${c.id}"
         style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;
                background:${col.bg};
                border-color:${safe ? SAFETY_BORDER : col.border};
                ${safe ? 'border-style:dashed;border-width:2px;' : ''}">
      <div class="arch-comp-hdr" data-drag-id="${c.id}"
           style="background:${col.border};color:#fff">
        <span class="arch-comp-type-badge">${escH(c.comp_type)}</span>
        <span class="arch-comp-name" id="cname-${c.id}">${escH(c.name)}</span>
        ${safe ? '<span class="arch-comp-safe-icon" title="Safety Critical">⚠</span>' : ''}
        <button class="arch-comp-info-btn" data-comp-id="${c.id}" title="Edit / Functions">≡</button>
      </div>
      <div class="arch-comp-body">
        <div class="arch-fun-list" id="funlist-${c.id}">${funChips}</div>
      </div>
      <!-- Port handles -->
      <div class="arch-port arch-port--top"    data-comp-id="${c.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${c.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${c.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${c.id}" data-port="left"></div>
      <!-- Resize handle -->
      <div class="arch-resize-handle" data-comp-id="${c.id}"></div>
    </div>`;
}

function renderConnections() {
  const g = document.getElementById('arch-conn-layer');
  if (!g) return;
  g.innerHTML = _s.connections.map(cn => connSVG(cn)).join('');
  // Wire connection clicks
  _s.connections.forEach(cn => {
    const el = document.getElementById(`conn-${cn.id}`);
    if (el) {
      el.addEventListener('click', (e) => { e.stopPropagation(); openConnEditor(cn.id); });
    }
  });
}

function connSVG(cn) {
  const src = _s.components.find(c => c.id === cn.source_id);
  const tgt = _s.components.find(c => c.id === cn.target_id);
  if (!src || !tgt) return '';

  const [sx, sy] = portAbsPos(src, cn.source_port);
  const [tx, ty] = portAbsPos(tgt, cn.target_port);
  const path     = bezierPath(sx, sy, cn.source_port, tx, ty, cn.target_port);
  const style    = IFACE_STYLES[cn.interface_type] || IFACE_STYLES.Data;
  const mid      = pathMidpoint(sx, sy, tx, ty);

  let markerStart = '', markerEnd = '';
  if (cn.direction === 'A_to_B')        { markerEnd   = `url(#arrow-end)`;  }
  else if (cn.direction === 'B_to_A')   { markerStart = `url(#arrow-start)`;}
  else                                  { markerEnd = `url(#arrow-end)`; markerStart = `url(#arrow-start)`; }

  const extBadge = cn.is_external ? `
    <text x="${mid[0]}" y="${mid[1] - 12}" text-anchor="middle" class="arch-conn-ext-label">EXT</text>` : '';

  return `
    <g id="conn-${cn.id}" class="arch-conn-group" style="cursor:pointer">
      <!-- Wider invisible hit area -->
      <path d="${path}" fill="none" stroke="transparent" stroke-width="12"/>
      <path d="${path}" fill="none" stroke="${style.stroke}"
            stroke-width="2" stroke-dasharray="${style.dash}"
            marker-start="${markerStart}" marker-end="${markerEnd}"
            style="color:${style.stroke}"/>
      <text x="${mid[0]}" y="${mid[1]}" text-anchor="middle" class="arch-conn-label"
            style="fill:${style.stroke}">${style.label} ${escH(cn.name || cn.interface_type)}</text>
      ${extBadge}
    </g>`;
}

// ── Port / bezier math ────────────────────────────────────────────────────────

function portAbsPos(comp, port) {
  const fn = PORT_POSITIONS[port] || PORT_POSITIONS.right;
  const [dx, dy] = fn(comp.width, comp.height);
  return [comp.x + dx, comp.y + dy];
}

function bezierPath(x1, y1, p1, x2, y2, p2) {
  const d = 80;
  const offsets = { top: [0, -d], right: [d, 0], bottom: [0, d], left: [-d, 0] };
  const [cx1, cy1] = [x1 + (offsets[p1]?.[0] ?? d), y1 + (offsets[p1]?.[1] ?? 0)];
  const [cx2, cy2] = [x2 + (offsets[p2]?.[0] ?? -d), y2 + (offsets[p2]?.[1] ?? 0)];
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

function pathMidpoint(x1, y1, x2, y2) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

// ── Wire canvas (pan, zoom, global pointer events) ────────────────────────────

function wireCanvas() {
  const outer    = document.getElementById('arch-canvas-outer');
  const viewport = document.getElementById('arch-viewport');
  const svg      = document.getElementById('arch-svg');

  if (!outer || !viewport || !svg) return;

  applyViewport();

  // ── Pan (pointerdown on canvas bg / svg) ──────────────────────────────────
  let panStart = null;
  outer.addEventListener('pointerdown', (e) => {
    if (e.target !== outer && e.target !== viewport &&
        e.target !== svg && !e.target.closest('#arch-svg > g:not(.arch-conn-group)')) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    panStart = { x: e.clientX - _s.panX, y: e.clientY - _s.panY };
    outer.setPointerCapture(e.pointerId);
    selectComp(null);
  });
  outer.addEventListener('pointermove', (e) => {
    if (!panStart) return;
    _s.panX = e.clientX - panStart.x;
    _s.panY = e.clientY - panStart.y;
    applyViewport();
  });
  outer.addEventListener('pointerup', () => { panStart = null; });

  // ── Zoom (wheel) ──────────────────────────────────────────────────────────
  outer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect   = outer.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;

    // Zoom towards cursor
    _s.panX = mx - (mx - _s.panX) * factor;
    _s.panY = my - (my - _s.panY) * factor;
    _s.zoom = Math.min(2, Math.max(0.2, _s.zoom * factor));
    applyViewport();
  }, { passive: false });

  // ── Global drag (move components) ─────────────────────────────────────────
  document.addEventListener('pointermove', onGlobalPointerMove);
  document.addEventListener('pointerup',   onGlobalPointerUp);

  // ── Connection temp path ──────────────────────────────────────────────────
  outer.addEventListener('pointermove', (e) => {
    if (!_s.connecting) return;
    const pos = canvasPos(e, outer);
    _s.connecting.curX = pos.x;
    _s.connecting.curY = pos.y;
    updateTempPath();
  });
}

function applyViewport() {
  const vp = document.getElementById('arch-viewport');
  if (vp) vp.style.transform = `translate(${_s.panX}px, ${_s.panY}px) scale(${_s.zoom})`;
  const label = document.getElementById('arch-zoom-label');
  if (label) label.textContent = `${Math.round(_s.zoom * 100)}%`;
}

function canvasPos(e, outer) {
  const rect = outer.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - _s.panX) / _s.zoom,
    y: (e.clientY - rect.top  - _s.panY) / _s.zoom,
  };
}

// ── Wire individual component ─────────────────────────────────────────────────

function wireComponent(id) {
  const el = document.getElementById(`comp-${id}`);
  if (!el) return;

  // Select on click
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.arch-port, .arch-resize-handle, .arch-comp-info-btn, .arch-fun-del')) return;
    selectComp(id);
  });

  // Drag (header)
  const hdr = el.querySelector('[data-drag-id]');
  if (hdr) {
    hdr.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.arch-comp-info-btn')) return;
      e.stopPropagation();
      e.preventDefault();
      const comp = _s.components.find(c => c.id === id);
      if (!comp) return;
      selectComp(id);
      const outer = document.getElementById('arch-canvas-outer');
      const pos   = canvasPos(e, outer);
      _s.dragging = { id, startX: pos.x, startY: pos.y, origX: comp.x, origY: comp.y };
      hdr.setPointerCapture(e.pointerId);
    });
  }

  // Double-click name → inline rename
  const nameEl = el.querySelector('.arch-comp-name');
  if (nameEl) {
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(id, nameEl);
    });
  }

  // Info/edit button
  const infoBtn = el.querySelector('.arch-comp-info-btn');
  if (infoBtn) {
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectComp(id);
      openPropsPanel(id);
    });
  }

  // Delete function chips
  el.querySelectorAll('.arch-fun-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteFun(btn.dataset.funId, btn.dataset.compId);
    });
  });

  // Resize handle
  const resizeHandle = el.querySelector('.arch-resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const comp = _s.components.find(c => c.id === id);
      if (!comp) return;
      const outer = document.getElementById('arch-canvas-outer');
      const pos   = canvasPos(e, outer);
      _s.resizing = { id, startX: pos.x, startY: pos.y, origW: comp.width, origH: comp.height };
      resizeHandle.setPointerCapture(e.pointerId);
    });
  }

  // Port drag → start connection
  el.querySelectorAll('.arch-port').forEach(port => {
    port.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const outer = document.getElementById('arch-canvas-outer');
      const pos   = canvasPos(e, outer);
      _s.connecting = { sourceId: id, sourcePort: port.dataset.port, curX: pos.x, curY: pos.y };
      const tempPath = document.getElementById('arch-temp-path');
      if (tempPath) tempPath.style.display = '';
      port.setPointerCapture(e.pointerId);
    });
    port.addEventListener('pointerup', (e) => {
      if (!_s.connecting || _s.connecting.sourceId === id) return;
      finishConnection(id, port.dataset.port);
    });
  });

  // Drop on component body to finish connection
  el.addEventListener('pointerup', (e) => {
    if (!_s.connecting || _s.connecting.sourceId === id) return;
    finishConnection(id, nearestPort(id, _s.connecting.curX, _s.connecting.curY));
  });
}

// ── Global pointer handlers ───────────────────────────────────────────────────

function onGlobalPointerMove(e) {
  if (_s?.dragging) {
    const { id, startX, startY, origX, origY } = _s.dragging;
    const outer = document.getElementById('arch-canvas-outer');
    if (!outer) return;
    const pos  = canvasPos(e, outer);
    const comp = _s.components.find(c => c.id === id);
    if (!comp) return;
    comp.x = snap(origX + pos.x - startX);
    comp.y = snap(origY + pos.y - startY);
    const el = document.getElementById(`comp-${id}`);
    if (el) { el.style.left = comp.x + 'px'; el.style.top = comp.y + 'px'; }
    renderConnections();
  }
  if (_s?.resizing) {
    const { id, startX, startY, origW, origH } = _s.resizing;
    const outer = document.getElementById('arch-canvas-outer');
    if (!outer) return;
    const pos  = canvasPos(e, outer);
    const comp = _s.components.find(c => c.id === id);
    if (!comp) return;
    comp.width  = Math.max(120, snap(origW + pos.x - startX));
    comp.height = Math.max(80,  snap(origH + pos.y - startY));
    const el = document.getElementById(`comp-${id}`);
    if (el) { el.style.width = comp.width + 'px'; el.style.height = comp.height + 'px'; }
    renderConnections();
  }
}

function onGlobalPointerUp(e) {
  if (_s?.dragging) {
    _s.dragging = null;
    // Cancel any connection-in-progress if mouse released on empty space
  }
  if (_s?.resizing) { _s.resizing = null; }
  if (_s?.connecting) {
    // Released on empty space — cancel
    const tempPath = document.getElementById('arch-temp-path');
    if (tempPath) tempPath.style.display = 'none';
    _s.connecting = null;
  }
}

// ── Connection helpers ────────────────────────────────────────────────────────

function updateTempPath() {
  const { sourceId, sourcePort, curX, curY } = _s.connecting;
  const src = _s.components.find(c => c.id === sourceId);
  if (!src) return;
  const [sx, sy] = portAbsPos(src, sourcePort);
  const path = bezierPath(sx, sy, sourcePort, curX, curY, 'left');
  const el = document.getElementById('arch-temp-path');
  if (el) el.setAttribute('d', path);
}

function nearestPort(compId, cx, cy) {
  const comp = _s.components.find(c => c.id === compId);
  if (!comp) return 'left';
  let best = 'left', bestDist = Infinity;
  for (const [port, fn] of Object.entries(PORT_POSITIONS)) {
    const [px, py] = fn(comp.width, comp.height);
    const d = Math.hypot(cx - (comp.x + px), cy - (comp.y + py));
    if (d < bestDist) { bestDist = d; best = port; }
  }
  return best;
}

function finishConnection(targetId, targetPort) {
  const tempPath = document.getElementById('arch-temp-path');
  if (tempPath) tempPath.style.display = 'none';

  if (!_s.connecting) return;
  const { sourceId, sourcePort } = _s.connecting;
  _s.connecting = null;

  if (sourceId === targetId) return;

  // Check if already connected
  const dup = _s.connections.find(cn =>
    (cn.source_id === sourceId && cn.target_id === targetId) ||
    (cn.source_id === targetId && cn.target_id === sourceId));
  if (dup) { openConnEditor(dup.id); return; }

  showConnPopover(sourceId, sourcePort, targetId, targetPort);
}

function showConnPopover(srcId, srcPort, tgtId, tgtPort) {
  const src = _s.components.find(c => c.id === srcId);
  const tgt = _s.components.find(c => c.id === tgtId);
  if (!src || !tgt) return;

  const popover = document.getElementById('arch-conn-popover');
  if (!popover) return;

  const defaultReq = buildDefaultReq(src, tgt, 'Data');

  popover.style.display = '';
  popover.innerHTML = `
    <div class="arch-popover-hdr">
      <strong>New Connection</strong>
      <button class="arch-popover-close" id="pop-close">✕</button>
    </div>
    <div class="arch-popover-body">
      <div class="arch-popover-row">
        <span class="arch-popover-from">${escH(src.name)}</span>
        <span class="arch-popover-arrow">→</span>
        <span class="arch-popover-to">${escH(tgt.name)}</span>
      </div>
      <label class="arch-form-label">Interface Type</label>
      <select class="form-input" id="pop-itype">
        ${['Electrical','Data','Mechanical','Thermal'].map(t =>
          `<option value="${t}">${t}</option>`).join('')}
      </select>
      <label class="arch-form-label">Direction</label>
      <select class="form-input" id="pop-dir">
        <option value="A_to_B">${escH(src.name)} → ${escH(tgt.name)}</option>
        <option value="B_to_A">${escH(tgt.name)} → ${escH(src.name)}</option>
        <option value="bidirectional" selected>Bidirectional ↔</option>
      </select>
      <label class="arch-form-label">Name (optional)</label>
      <input class="form-input" id="pop-name" placeholder="e.g. CAN Bus"/>
      <label class="arch-form-label">Interface Requirement</label>
      <textarea class="form-input form-textarea" id="pop-req" rows="3">${escH(defaultReq)}</textarea>
    </div>
    <div class="arch-popover-footer">
      <button class="btn btn-secondary btn-sm" id="pop-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm"   id="pop-create">Create</button>
    </div>
  `;

  // Update requirement text when interface type changes
  document.getElementById('pop-itype').onchange = () => {
    const newReq = buildDefaultReq(src, tgt, document.getElementById('pop-itype').value);
    document.getElementById('pop-req').value = newReq;
  };

  document.getElementById('pop-close').onclick  = () => { popover.style.display = 'none'; };
  document.getElementById('pop-cancel').onclick = () => { popover.style.display = 'none'; };
  document.getElementById('pop-create').onclick = async () => {
    const interfaceType = document.getElementById('pop-itype').value;
    const direction     = document.getElementById('pop-dir').value;
    const name          = document.getElementById('pop-name').value.trim();
    const requirement   = document.getElementById('pop-req').value.trim();

    const srcGroup = src.system_group || '';
    const tgtGroup = tgt.system_group || '';
    const isExt    = !!(srcGroup && tgtGroup && srcGroup !== tgtGroup);

    const { data, error } = await sb.from('arch_connections').insert({
      parent_type: _s.parentType,
      parent_id:   _s.parentId,
      project_id:  _s.project.id,
      source_id:   srcId,
      target_id:   tgtId,
      source_port: srcPort,
      target_port: tgtPort,
      interface_type: interfaceType,
      direction, name: name || null,
      requirement: requirement || null,
      is_external: isExt,
    }).select().single();

    popover.style.display = 'none';
    if (error) { toast('Error creating connection: ' + error.message, 'error'); return; }
    _s.connections.push(data);
    renderConnections();
    toast('Connection created.', 'success');
  };
}

function buildDefaultReq(src, tgt, type) {
  const verbs = { Electrical: 'exchange electrical power', Data: 'exchange data', Mechanical: 'interface mechanically', Thermal: 'exchange thermal energy' };
  return `${src.name} shall ${verbs[type] || 'interface'} with ${tgt.name} via ${type} interface.`;
}

function openConnEditor(connId) {
  const cn  = _s.connections.find(c => c.id === connId);
  if (!cn) return;
  const src = _s.components.find(c => c.id === cn.source_id);
  const tgt = _s.components.find(c => c.id === cn.target_id);
  if (!src || !tgt) return;

  const popover = document.getElementById('arch-conn-popover');
  if (!popover) return;

  popover.style.display = '';
  popover.innerHTML = `
    <div class="arch-popover-hdr">
      <strong>Edit Connection</strong>
      <button class="arch-popover-close" id="pop-close">✕</button>
    </div>
    <div class="arch-popover-body">
      <div class="arch-popover-row">
        <span class="arch-popover-from">${escH(src.name)}</span>
        <span class="arch-popover-arrow">→</span>
        <span class="arch-popover-to">${escH(tgt.name)}</span>
      </div>
      <label class="arch-form-label">Interface Type</label>
      <select class="form-input" id="pop-itype">
        ${['Electrical','Data','Mechanical','Thermal'].map(t =>
          `<option value="${t}" ${cn.interface_type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <label class="arch-form-label">Direction</label>
      <select class="form-input" id="pop-dir">
        <option value="A_to_B"    ${cn.direction === 'A_to_B'        ? 'selected' : ''}>${escH(src.name)} → ${escH(tgt.name)}</option>
        <option value="B_to_A"    ${cn.direction === 'B_to_A'        ? 'selected' : ''}>${escH(tgt.name)} → ${escH(src.name)}</option>
        <option value="bidirectional" ${cn.direction === 'bidirectional' ? 'selected' : ''}>Bidirectional ↔</option>
      </select>
      <label class="arch-form-label">Name</label>
      <input class="form-input" id="pop-name" value="${escH(cn.name || '')}"/>
      <label class="arch-form-label">Interface Requirement</label>
      <textarea class="form-input form-textarea" id="pop-req" rows="3">${escH(cn.requirement || '')}</textarea>
      <label class="arch-form-label" style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="pop-ext" ${cn.is_external ? 'checked' : ''}/>
        External interface
      </label>
    </div>
    <div class="arch-popover-footer">
      <button class="btn btn-danger  btn-sm" id="pop-del">Delete</button>
      <button class="btn btn-secondary btn-sm" id="pop-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm"   id="pop-save">Save</button>
    </div>
  `;

  document.getElementById('pop-close').onclick  = () => { popover.style.display = 'none'; };
  document.getElementById('pop-cancel').onclick = () => { popover.style.display = 'none'; };

  document.getElementById('pop-del').onclick = async () => {
    const { error } = await sb.from('arch_connections').delete().eq('id', connId);
    popover.style.display = 'none';
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    _s.connections = _s.connections.filter(c => c.id !== connId);
    renderConnections();
    toast('Connection deleted.', 'success');
  };

  document.getElementById('pop-save').onclick = async () => {
    const patch = {
      interface_type: document.getElementById('pop-itype').value,
      direction:      document.getElementById('pop-dir').value,
      name:           document.getElementById('pop-name').value.trim() || null,
      requirement:    document.getElementById('pop-req').value.trim() || null,
      is_external:    document.getElementById('pop-ext').checked,
      updated_at:     new Date().toISOString(),
    };
    const { error } = await sb.from('arch_connections').update(patch).eq('id', connId);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    Object.assign(cn, patch);
    popover.style.display = 'none';
    renderConnections();
    toast('Connection updated.', 'success');
  };
}

// ── Properties panel ──────────────────────────────────────────────────────────

function openPropsPanel(compId) {
  const comp  = _s.components.find(c => c.id === compId);
  if (!comp) return;
  const panel = document.getElementById('arch-props-panel');
  const hdr   = document.getElementById('arch-props-hdr');
  const body  = document.getElementById('arch-props-body');
  if (!panel) return;

  panel.style.display = '';
  const col = COMP_COLORS[comp.comp_type] || COMP_COLORS.HW;

  hdr.innerHTML = `
    <span class="arch-props-title" style="color:${col.label}">≡ ${escH(comp.name)}</span>
    <button class="arch-props-close" id="props-close">✕</button>
  `;
  body.innerHTML = `
    <div class="arch-props-section">
      <label class="arch-form-label">Name</label>
      <input class="form-input" id="props-name" value="${escH(comp.name)}"/>

      <label class="arch-form-label" style="margin-top:10px">Type</label>
      <select class="form-input" id="props-type">
        ${['HW','SW','Mechanical'].map(t =>
          `<option value="${t}" ${comp.comp_type === t ? 'selected':''}>${t}</option>`).join('')}
      </select>

      <label class="arch-form-label" style="margin-top:10px">System Group</label>
      <input class="form-input" id="props-group" value="${escH(comp.system_group || '')}"
             placeholder="e.g. System 1 (for external iface detection)"/>

      <label class="arch-form-label" style="margin-top:10px;display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="props-safe" ${comp.is_safety_critical ? 'checked':''}/> Safety Critical
      </label>
    </div>

    <div class="arch-props-section">
      <div class="arch-props-section-hdr">
        <span>λ Functions</span>
        <button class="arch-tb-btn" id="props-add-fun">＋ Add</button>
      </div>
      <div id="props-fun-list">
        ${comp.functions.map(f => `
          <div class="props-fun-row">
            <label class="arch-form-label props-fun-safe-lbl" title="Safety related">
              <input type="checkbox" class="props-fun-safe-chk" data-fid="${f.id}" ${f.is_safety_related ? 'checked' : ''}/>
              <span class="props-fun-safe-icon" title="Mark safety-related">⚠</span>
            </label>
            <span class="props-fun-name" id="pfname-${f.id}">${escH(f.name)}</span>
            <button class="btn-icon props-fun-rename" data-fid="${f.id}" title="Rename">✎</button>
            <button class="btn-icon props-fun-del"    data-fid="${f.id}" title="Delete">✕</button>
          </div>`).join('')}
      </div>
      <div id="props-add-fun-row" style="display:none;margin-top:8px">
        <input class="form-input" id="props-new-fun-name" placeholder="Function name"/>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn btn-primary btn-sm" id="props-new-fun-save">Add</button>
          <button class="btn btn-secondary btn-sm" id="props-new-fun-cancel">Cancel</button>
        </div>
      </div>
    </div>

    <div class="arch-props-section arch-props-actions">
      <button class="btn btn-primary   btn-sm" id="props-apply">Apply</button>
      <button class="btn btn-danger    btn-sm" id="props-del-comp">Delete Component</button>
    </div>
  `;

  document.getElementById('props-close').onclick = () => { panel.style.display = 'none'; };

  document.getElementById('props-apply').onclick = async () => {
    const name  = document.getElementById('props-name').value.trim() || comp.name;
    const type  = document.getElementById('props-type').value;
    const group = document.getElementById('props-group').value.trim() || null;
    const safe  = document.getElementById('props-safe').checked;

    const { error } = await sb.from('arch_components').update({
      name, comp_type: type, system_group: group,
      is_safety_critical: safe, updated_at: new Date().toISOString(),
    }).eq('id', compId);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    Object.assign(comp, { name, comp_type: type, system_group: group, is_safety_critical: safe });
    refreshComp(compId);
    panel.style.display = 'none';
    toast('Updated.', 'success');
  };

  document.getElementById('props-del-comp').onclick = () => {
    confirmDialog(`Delete component "${comp.name}"?`, async () => {
      await deleteComp(compId);
      panel.style.display = 'none';
    });
  };

  // Add function
  document.getElementById('props-add-fun').onclick = () => {
    const row = document.getElementById('props-add-fun-row');
    row.style.display = '';
    document.getElementById('props-new-fun-name').focus();
  };
  document.getElementById('props-new-fun-cancel').onclick = () => {
    document.getElementById('props-add-fun-row').style.display = 'none';
  };
  document.getElementById('props-new-fun-save').onclick = async () => {
    const name = document.getElementById('props-new-fun-name').value.trim();
    if (!name) return;
    const { data, error } = await sb.from('arch_functions').insert({
      component_id: compId, name, is_safety_related: false,
      sort_order: comp.functions.length,
    }).select().single();
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    comp.functions.push(data);
    refreshComp(compId);
    openPropsPanel(compId);
  };
  document.getElementById('props-new-fun-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('props-new-fun-save').click();
  });

  // Toggle safety on function
  body.querySelectorAll('.props-fun-safe-chk').forEach(chk => {
    chk.onchange = async () => {
      const f = comp.functions.find(fn => fn.id === chk.dataset.fid);
      if (!f) return;
      f.is_safety_related = chk.checked;
      await sb.from('arch_functions').update({ is_safety_related: chk.checked }).eq('id', f.id);
      // If any function is safety-related → mark comp as safety critical
      const anySafe = comp.functions.some(fn => fn.is_safety_related);
      if (anySafe !== comp.is_safety_critical) {
        comp.is_safety_critical = anySafe;
        await sb.from('arch_components').update({ is_safety_critical: anySafe }).eq('id', compId);
      }
      refreshComp(compId);
    };
  });

  // Rename function
  body.querySelectorAll('.props-fun-rename').forEach(btn => {
    btn.onclick = () => {
      const f = comp.functions.find(fn => fn.id === btn.dataset.fid);
      if (!f) return;
      const span = document.getElementById(`pfname-${f.id}`);
      if (!span) return;
      const inp = document.createElement('input');
      inp.className = 'form-input'; inp.value = f.name; inp.style.flex = '1';
      span.replaceWith(inp); inp.focus(); inp.select();
      const save = async () => {
        const n = inp.value.trim() || f.name;
        await sb.from('arch_functions').update({ name: n }).eq('id', f.id);
        f.name = n;
        openPropsPanel(compId);
        refreshComp(compId);
      };
      inp.onblur = save;
      inp.onkeydown = e => { if (e.key === 'Enter') save(); };
    };
  });

  // Delete function
  body.querySelectorAll('.props-fun-del').forEach(btn => {
    btn.onclick = async () => {
      await deleteFun(btn.dataset.fid, compId);
      openPropsPanel(compId);
    };
  });
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function wireToolbar() {
  document.getElementById('btn-add-hw').onclick   = () => addComp('HW');
  document.getElementById('btn-add-sw').onclick   = () => addComp('SW');
  document.getElementById('btn-add-mech').onclick = () => addComp('Mechanical');

  document.getElementById('btn-del-comp').onclick = async () => {
    if (_s.selected) await deleteComp(_s.selected);
  };

  document.getElementById('btn-zoom-in').onclick  = () => { _s.zoom = Math.min(2, _s.zoom * 1.2);  applyViewport(); };
  document.getElementById('btn-zoom-out').onclick = () => { _s.zoom = Math.max(0.2, _s.zoom * 0.8); applyViewport(); };
  document.getElementById('btn-zoom-fit').onclick = () => {
    _s.zoom = 1; _s.panX = 40; _s.panY = 40;
    applyViewport();
  };

  document.getElementById('btn-arch-save').onclick = saveAll;

  // Keyboard: Delete key
  document.addEventListener('keydown', (e) => {
    if (!_s) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        document.activeElement === document.body && _s.selected) {
      deleteComp(_s.selected);
    }
    if (e.key === 'Escape') {
      selectComp(null);
      const pop = document.getElementById('arch-conn-popover');
      if (pop) pop.style.display = 'none';
      if (_s.connecting) {
        _s.connecting = null;
        const tp = document.getElementById('arch-temp-path');
        if (tp) tp.style.display = 'none';
      }
    }
  });
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

async function addComp(type) {
  const count = _s.components.length;
  const { data, error } = await sb.from('arch_components').insert({
    parent_type: _s.parentType,
    parent_id:   _s.parentId,
    project_id:  _s.project.id,
    name:        `${type} Component ${count + 1}`,
    comp_type:   type,
    x:   snap(80 + (count % 5) * 220),
    y:   snap(80 + Math.floor(count / 5) * 180),
    width: 180, height: 120,
    sort_order: count,
  }).select().single();
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  data.functions = [];
  _s.components.push(data);
  const layer = document.getElementById('arch-comp-layer');
  if (layer) { layer.insertAdjacentHTML('beforeend', compHTML(data)); wireComponent(data.id); }
  selectComp(data.id);
  // Auto-open rename
  setTimeout(() => {
    const nameEl = document.querySelector(`#comp-${data.id} .arch-comp-name`);
    if (nameEl) startRename(data.id, nameEl);
  }, 80);
}

async function deleteComp(id) {
  const { error } = await sb.from('arch_components').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  _s.components  = _s.components.filter(c => c.id !== id);
  _s.connections = _s.connections.filter(cn => cn.source_id !== id && cn.target_id !== id);
  document.getElementById(`comp-${id}`)?.remove();
  selectComp(null);
  renderConnections();
  toast('Deleted.', 'success');
}

async function deleteFun(funId, compId) {
  const { error } = await sb.from('arch_functions').delete().eq('id', funId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  const comp = _s.components.find(c => c.id === compId);
  if (comp) comp.functions = comp.functions.filter(f => f.id !== funId);
  refreshComp(compId);
}

async function saveAll() {
  const btn = document.getElementById('btn-arch-save');
  if (btn) btn.disabled = true;

  const updates = _s.components.map(c =>
    sb.from('arch_components').update({
      x: c.x, y: c.y, width: c.width, height: c.height, updated_at: new Date().toISOString(),
    }).eq('id', c.id)
  );
  await Promise.all(updates);

  if (btn) { btn.disabled = false; }
  toast('Architecture saved.', 'success');
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectComp(id) {
  _s.selected = id;
  document.querySelectorAll('.arch-comp').forEach(el => {
    el.classList.toggle('arch-comp--selected', el.dataset.id === id);
  });
  const btn = document.getElementById('btn-del-comp');
  if (btn) btn.disabled = !id;

  // Close props panel if deselecting
  if (!id) {
    const panel = document.getElementById('arch-props-panel');
    if (panel) panel.style.display = 'none';
  }
}

function refreshComp(id) {
  const comp = _s.components.find(c => c.id === id);
  if (!comp) return;
  const existing = document.getElementById(`comp-${id}`);
  if (!existing) return;
  existing.outerHTML = compHTML(comp);
  wireComponent(id);
}

function startRename(id, nameEl) {
  const comp = _s.components.find(c => c.id === id);
  if (!comp) return;
  const inp = document.createElement('input');
  inp.className = 'arch-rename-input';
  inp.value = comp.name;
  inp.style.cssText = 'flex:1;background:transparent;border:none;outline:none;color:#fff;font-weight:600;font-size:inherit;min-width:60px';
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
  const save = async () => {
    const n = inp.value.trim() || comp.name;
    comp.name = n;
    const { error } = await sb.from('arch_components').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Error: ' + error.message, 'error'); }
    refreshComp(id);
  };
  inp.onblur = save;
  inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { comp.name = comp.name; refreshComp(id); } };
}

// ── Snap to grid ──────────────────────────────────────────────────────────────
function snap(v) { return Math.round(v / GRID) * GRID; }

function escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
