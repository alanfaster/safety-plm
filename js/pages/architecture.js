/**
 * Architecture Canvas — v2
 *
 * SysML-inspired block diagram canvas:
 * - System Group boxes (containers that group components)
 * - Component blocks: HW / SW / Mechanical, with SysML stereotype notation
 * - Functions inside blocks, safety-flagged
 * - SVG connections with interface type (Electrical/Data/Mechanical/Thermal/Power)
 * - Connection popover with auto-generated interface requirement
 * - Pan (drag empty canvas) + Zoom (Ctrl+wheel / buttons)
 * - Right palette panel for adding components and editing selection
 *
 * DB tables: arch_components (groups + blocks), arch_functions, arch_connections
 * comp_type: 'Group' | 'HW' | 'SW' | 'Mechanical'
 * data.group_id: UUID of parent group (optional)
 */

import { sb } from '../config.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../components/modal.js';

// ── Visual constants ──────────────────────────────────────────────────────────

const STYLES = {
  HW:         { bg:'#E8F0FE', border:'#1A73E8', hdr:'#1A73E8', text:'#174EA6', stereotype:'block' },
  SW:         { bg:'#E6F4EA', border:'#1E8E3E', hdr:'#1E8E3E', text:'#137333', stereotype:'block' },
  Mechanical: { bg:'#FEF3E2', border:'#E37400', hdr:'#E37400', text:'#B06000', stereotype:'block' },
  Group:      { bg:'#F8F9FA', border:'#9AA0A6', hdr:'transparent', text:'#3C4043', stereotype:'system' },
};

const IFACE = {
  Data:       { stroke:'#1A73E8', dash:'',    icon:'⇄', weight:2   },
  Electrical: { stroke:'#E37400', dash:'',    icon:'⚡', weight:2   },
  Mechanical: { stroke:'#5D4037', dash:'6,3', icon:'⚙', weight:2.5 },
  Thermal:    { stroke:'#C5221F', dash:'4,3', icon:'🌡', weight:2   },
  Power:      { stroke:'#7B1FA2', dash:'',    icon:'⏻', weight:2.5 },
};

const PORTS = {
  top:    (w,h)=>[w/2, 0],
  right:  (w,h)=>[w,   h/2],
  bottom: (w,h)=>[w/2, h],
  left:   (w,h)=>[0,   h/2],
};
const PORT_SIDES = Object.keys(PORTS);

const GRID = 20;
const MIN_W = 140, MIN_H = 90;
const GROUP_MIN_W = 240, GROUP_MIN_H = 160;

// ── State ─────────────────────────────────────────────────────────────────────

let _s = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderArchitecture(container, { project, item, system }) {
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  const [{ data: comps }, { data: conns }] = await Promise.all([
    sb.from('arch_components').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId).order('sort_order'),
    sb.from('arch_connections').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId),
  ]);

  const compList = comps || [];
  const compIds  = compList.map(c => c.id);
  let funs = [];
  if (compIds.length) {
    const { data } = await sb.from('arch_functions').select('*')
      .in('component_id', compIds).order('sort_order');
    funs = data || [];
  }

  const components = compList.map(c => ({
    ...c, functions: funs.filter(f => f.component_id === c.id),
  }));

  _s = {
    container, project, item, system,
    parentType, parentId,
    components,
    connections: conns || [],
    panX: 20, panY: 20, zoom: 1,
    dragging: null, resizing: null,
    connecting: null,
    selected: null,
  };

  // Clean up old global listeners if re-rendered
  if (window._archCleanup) window._archCleanup();

  buildShell(container, system ? system.name : item.name);
  renderAll();
  wireCanvas();
  wireGlobal();
}

// ── Shell HTML ────────────────────────────────────────────────────────────────

function buildShell(container, title) {
  container.innerHTML = `
    <div class="arch-shell">

      <!-- Minimal top bar -->
      <div class="arch-topbar">
        <span class="arch-topbar-title">◈ ${escH(title)} — Architecture</span>
        <div class="arch-topbar-right">
          <button class="arch-tb-btn" id="btn-zoom-out" title="Zoom out">−</button>
          <span class="arch-zoom-lbl" id="arch-zoom-lbl">100%</span>
          <button class="arch-tb-btn" id="btn-zoom-in"  title="Zoom in">＋</button>
          <button class="arch-tb-btn" id="btn-zoom-fit" title="Fit">⊞ Fit</button>
          <div class="arch-sep"></div>
          <button class="btn btn-primary btn-sm" id="btn-arch-save">💾 Save</button>
        </div>
      </div>

      <div class="arch-workspace">

        <!-- Canvas -->
        <div class="arch-canvas-outer" id="arch-outer">
          <div class="arch-viewport" id="arch-vp">
            <!-- Group layer (behind components) -->
            <div class="arch-group-layer" id="arch-group-layer"></div>
            <!-- SVG connections -->
            <svg class="arch-svg" id="arch-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-e"  markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" class="arr-poly"/></marker>
                <marker id="arr-s"  markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse"><polygon points="0 0,8 3,0 6" class="arr-poly"/></marker>
              </defs>
              <g id="arch-conn-g"></g>
              <path id="arch-temp" fill="none" stroke="#1A73E8" stroke-width="2" stroke-dasharray="6,3" style="pointer-events:none;display:none"/>
            </svg>
            <!-- Component layer -->
            <div class="arch-comp-layer" id="arch-comp-layer"></div>
          </div>
        </div>

        <!-- Right palette / properties panel -->
        <div class="arch-palette" id="arch-palette">
          <div class="arch-palette-section">
            <div class="arch-palette-hdr">Add Block</div>
            <div class="arch-palette-items">
              <button class="arch-pal-item" data-type="HW"         title="Hardware block">
                <span class="arch-pal-icon" style="background:#1A73E8">HW</span>
                <span>HW Block</span>
              </button>
              <button class="arch-pal-item" data-type="SW"         title="Software block">
                <span class="arch-pal-icon" style="background:#1E8E3E">SW</span>
                <span>SW Block</span>
              </button>
              <button class="arch-pal-item" data-type="Mechanical" title="Mechanical block">
                <span class="arch-pal-icon" style="background:#E37400">ME</span>
                <span>Mech Block</span>
              </button>
              <button class="arch-pal-item pal-item-group" data-type="Group" title="System group container">
                <span class="arch-pal-icon arch-pal-icon-group">⬜</span>
                <span>System Group</span>
              </button>
            </div>
          </div>

          <div class="arch-palette-section arch-palette-iface-legend">
            <div class="arch-palette-hdr">Interface Types</div>
            ${Object.entries(IFACE).map(([k,v]) => `
              <div class="arch-iface-legend-row">
                <svg width="32" height="12" style="flex-shrink:0">
                  <line x1="0" y1="6" x2="32" y2="6" stroke="${v.stroke}" stroke-width="${v.weight}" stroke-dasharray="${v.dash}"/>
                </svg>
                <span class="arch-iface-legend-icon">${v.icon}</span>
                <span class="arch-iface-legend-label">${k}</span>
              </div>`).join('')}
          </div>

          <!-- Selection properties (shown when something is selected) -->
          <div class="arch-palette-section arch-props-section" id="arch-props-section" style="display:none">
            <div class="arch-palette-hdr">Properties <button class="arch-props-close" id="props-close">✕</button></div>
            <div id="arch-props-body"></div>
          </div>
        </div>

      </div>

      <!-- Connection popover -->
      <div class="arch-conn-popover" id="arch-conn-pop" style="display:none"></div>
    </div>
  `;
}

// ── Render all ────────────────────────────────────────────────────────────────

function renderAll() {
  renderGroups();
  renderComponents();
  renderConnections();
  applyViewport();
}

function renderGroups() {
  const layer = document.getElementById('arch-group-layer');
  if (!layer) return;
  const groups = _s.components.filter(c => c.comp_type === 'Group');
  layer.innerHTML = groups.map(g => groupHTML(g)).join('');
  groups.forEach(g => wireGroup(g.id));
}

function renderComponents() {
  const layer = document.getElementById('arch-comp-layer');
  if (!layer) return;
  const blocks = _s.components.filter(c => c.comp_type !== 'Group');
  layer.innerHTML = blocks.map(c => blockHTML(c)).join('');
  blocks.forEach(c => wireBlock(c.id));
}

function renderConnections() {
  const g = document.getElementById('arch-conn-g');
  if (!g) return;
  g.innerHTML = _s.connections.map(cn => connSVG(cn)).join('');
  _s.connections.forEach(cn => {
    const el = document.getElementById(`conn-${cn.id}`);
    if (el) el.addEventListener('click', e => { e.stopPropagation(); openConnEditor(cn.id); });
  });
}

// ── Group HTML ────────────────────────────────────────────────────────────────

function groupHTML(g) {
  const sel = _s.selected === g.id;
  return `
    <div class="arch-group ${sel ? 'arch-group--sel' : ''}"
         id="comp-${g.id}" data-id="${g.id}" data-type="Group"
         style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px">
      <div class="arch-group-hdr" data-drag-id="${g.id}">
        <span class="arch-group-stereo">«system»</span>
        <span class="arch-group-name" id="cname-${g.id}">${escH(g.name)}</span>
        <button class="arch-group-info-btn" data-comp-id="${g.id}">≡</button>
      </div>
      <div class="arch-resize-handle" data-comp-id="${g.id}"></div>
    </div>`;
}

// ── Block HTML (SysML-style) ──────────────────────────────────────────────────

function blockHTML(c) {
  const st    = STYLES[c.comp_type] || STYLES.HW;
  const safe  = c.is_safety_critical;
  const funs  = c.functions || [];
  const sel   = _s.selected === c.id;

  const funItems = funs.length
    ? funs.map(f => `
        <div class="arch-fun-chip ${f.is_safety_related ? 'arch-fun-safe' : ''}"
             data-fun-id="${f.id}" data-comp-id="${c.id}">
          ${f.is_safety_related ? '<span class="arch-fun-warn">⚠</span>' : '<span class="arch-fun-dot">⬥</span>'}
          <span class="arch-fun-name">${escH(f.name)}</span>
          <button class="arch-fun-del" data-fun-id="${f.id}" data-comp-id="${c.id}">✕</button>
        </div>`).join('')
    : `<div class="arch-fun-empty">no functions</div>`;

  return `
    <div class="arch-block ${sel ? 'arch-block--sel' : ''} ${safe ? 'arch-block--safe' : ''}"
         id="comp-${c.id}" data-id="${c.id}" data-type="${c.comp_type}"
         style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;
                border-color:${safe ? '#C5221F' : st.border}">
      <!-- Stereotype + name compartment -->
      <div class="arch-block-hdr" data-drag-id="${c.id}"
           style="background:${st.hdr};color:#fff">
        <span class="arch-block-stereo">«${st.stereotype}»</span>
        <span class="arch-block-name" id="cname-${c.id}">${escH(c.name)}</span>
        ${safe ? '<span class="arch-block-safe-ico" title="Safety Critical">⚠</span>' : ''}
        <button class="arch-block-info-btn" data-comp-id="${c.id}">≡</button>
      </div>
      <!-- Type label -->
      <div class="arch-block-type-row" style="background:${st.bg}">
        <span class="arch-block-type-badge" style="color:${st.border}">${c.comp_type}</span>
      </div>
      <!-- Functions compartment -->
      <div class="arch-block-funs-hdr">λ functions</div>
      <div class="arch-block-funs" id="funlist-${c.id}">${funItems}</div>
      <!-- Ports -->
      <div class="arch-port arch-port--top"    data-comp-id="${c.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${c.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${c.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${c.id}" data-port="left"></div>
      <!-- Resize -->
      <div class="arch-resize-handle" data-comp-id="${c.id}"></div>
    </div>`;
}

// ── SVG connection ────────────────────────────────────────────────────────────

function connSVG(cn) {
  const src = _s.components.find(c => c.id === cn.source_id);
  const tgt = _s.components.find(c => c.id === cn.target_id);
  if (!src || !tgt) return '';

  const [sx, sy] = portAbs(src, cn.source_port);
  const [tx, ty] = portAbs(tgt, cn.target_port);
  const d        = bezier(sx, sy, cn.source_port, tx, ty, cn.target_port);
  const iv       = IFACE[cn.interface_type] || IFACE.Data;
  const [mx, my] = [(sx+tx)/2, (sy+ty)/2];

  const ms = cn.direction === 'B_to_A' ? `marker-start="url(#arr-s)"` : '';
  const me = cn.direction !== 'B_to_A' ? `marker-end="url(#arr-e)"`   : '';
  const ext = cn.is_external
    ? `<text x="${mx}" y="${my - 14}" text-anchor="middle" class="arch-conn-ext">EXT</text>` : '';

  return `
    <g id="conn-${cn.id}" class="arch-conn-g" style="--cs:${iv.stroke}">
      <path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
      <path d="${d}" fill="none" stroke="${iv.stroke}" stroke-width="${iv.weight}"
            stroke-dasharray="${iv.dash}" ${ms} ${me}/>
      <circle cx="${mx}" cy="${my}" r="9" fill="${iv.stroke}" opacity="0.15"/>
      <text x="${mx}" y="${my+4}" text-anchor="middle" class="arch-conn-icon">${iv.icon}</text>
      <text x="${mx}" y="${my+17}" text-anchor="middle" class="arch-conn-label"
            style="fill:${iv.stroke}">${escH(cn.name || cn.interface_type)}</text>
      ${ext}
    </g>`;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function portAbs(comp, port) {
  const fn = PORTS[port] || PORTS.right;
  const [dx, dy] = fn(comp.width, comp.height);
  return [comp.x + dx, comp.y + dy];
}

function bezier(x1, y1, p1, x2, y2, p2) {
  const len = Math.max(60, Math.hypot(x2-x1, y2-y1) * 0.45);
  const off = { top:[0,-len], right:[len,0], bottom:[0,len], left:[-len,0] };
  const [cx1,cy1] = [x1+(off[p1]?.[0]??len), y1+(off[p1]?.[1]??0)];
  const [cx2,cy2] = [x2+(off[p2]?.[0]??-len), y2+(off[p2]?.[1]??0)];
  return `M${x1} ${y1} C${cx1} ${cy1},${cx2} ${cy2},${x2} ${y2}`;
}

function snap(v) { return Math.round(v / GRID) * GRID; }

function canvasPos(e) {
  const outer = document.getElementById('arch-outer');
  const rect  = outer.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - _s.panX) / _s.zoom,
    y: (e.clientY - rect.top  - _s.panY) / _s.zoom,
  };
}

function applyViewport() {
  const vp = document.getElementById('arch-vp');
  if (vp) vp.style.transform = `translate(${_s.panX}px,${_s.panY}px) scale(${_s.zoom})`;
  const lbl = document.getElementById('arch-zoom-lbl');
  if (lbl) lbl.textContent = `${Math.round(_s.zoom*100)}%`;
}

// ── Wire canvas (pan, zoom) ───────────────────────────────────────────────────

function wireCanvas() {
  const outer = document.getElementById('arch-outer');
  if (!outer) return;

  // Pan: drag on empty canvas
  let panStart = null;
  outer.addEventListener('pointerdown', e => {
    const hit = e.target;
    const isEmpty = hit === outer ||
      hit.id === 'arch-vp' ||
      hit.id === 'arch-svg' ||
      hit.id === 'arch-conn-g' ||
      hit.classList?.contains('arch-group-layer') ||
      hit.classList?.contains('arch-comp-layer');
    if (!isEmpty || e.button !== 0) return;
    e.preventDefault();
    panStart = { cx: e.clientX - _s.panX, cy: e.clientY - _s.panY };
    selectComp(null);
    outer.style.cursor = 'grabbing';
  });
  outer.addEventListener('pointermove', e => {
    if (!panStart) return;
    _s.panX = e.clientX - panStart.cx;
    _s.panY = e.clientY - panStart.cy;
    applyViewport();
  });
  outer.addEventListener('pointerup', () => {
    panStart = null;
    outer.style.cursor = '';
  });

  // Zoom (Ctrl+wheel OR plain wheel)
  outer.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const rect   = outer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    _s.panX  = mx - (mx - _s.panX) * factor;
    _s.panY  = my - (my - _s.panY) * factor;
    _s.zoom  = Math.min(2.5, Math.max(0.2, _s.zoom * factor));
    applyViewport();
  }, { passive: false });

  // Update temp connection path on canvas mousemove
  outer.addEventListener('pointermove', e => {
    if (!_s.connecting) return;
    const pos = canvasPos(e);
    _s.connecting.curX = pos.x;
    _s.connecting.curY = pos.y;
    const src = _s.components.find(c => c.id === _s.connecting.sourceId);
    if (src) {
      const [sx,sy] = portAbs(src, _s.connecting.sourcePort);
      const tp = document.getElementById('arch-temp');
      if (tp) tp.setAttribute('d', bezier(sx,sy,_s.connecting.sourcePort,pos.x,pos.y,'left'));
    }
  });

  // Toolbar
  document.getElementById('btn-zoom-in').onclick  = () => { _s.zoom = Math.min(2.5,_s.zoom*1.2); applyViewport(); };
  document.getElementById('btn-zoom-out').onclick = () => { _s.zoom = Math.max(0.2,_s.zoom*0.8); applyViewport(); };
  document.getElementById('btn-zoom-fit').onclick = fitView;
  document.getElementById('btn-arch-save').onclick = savePositions;

  // Palette: add blocks
  document.querySelectorAll('.arch-pal-item').forEach(btn => {
    btn.addEventListener('click', () => addComp(btn.dataset.type));
  });
}

// ── Global pointer events (drag, resize, connection finish) ───────────────────

function wireGlobal() {
  const onMove = e => {
    if (_s?.dragging) handleDragMove(e);
    if (_s?.resizing) handleResizeMove(e);
  };
  const onUp = e => {
    if (_s?.dragging)   handleDragEnd(e);
    if (_s?.resizing)   { _s.resizing = null; }
    if (_s?.connecting) handleConnectEnd(e);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup',   onUp);

  // Keyboard
  const onKey = e => {
    if (!_s) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        document.activeElement === document.body && _s.selected) {
      deleteComp(_s.selected);
    }
    if (e.key === 'Escape') {
      cancelConnect();
      selectComp(null);
      const pop = document.getElementById('arch-conn-pop');
      if (pop) pop.style.display = 'none';
    }
  };
  document.addEventListener('keydown', onKey);

  window._archCleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('keydown',     onKey);
    window._archCleanup = null;
  };
}

// ── Wire group ────────────────────────────────────────────────────────────────

function wireGroup(id) {
  const el = document.getElementById(`comp-${id}`);
  if (!el) return;

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-resize-handle,.arch-group-info-btn')) return;
    selectComp(id);
  });

  const hdr = el.querySelector('[data-drag-id]');
  if (hdr) {
    hdr.addEventListener('pointerdown', e => {
      if (e.target.closest('.arch-group-info-btn')) return;
      e.stopPropagation(); e.preventDefault();
      const g = _s.components.find(c => c.id === id);
      if (!g) return;
      selectComp(id);
      const pos = canvasPos(e);
      _s.dragging = { id, startX:pos.x, startY:pos.y, origX:g.x, origY:g.y, isGroup:true,
        // capture child offsets so they move together
        childOffsets: _s.components
          .filter(c => c.comp_type !== 'Group' && c.data?.group_id === id)
          .map(c => ({ id:c.id, dx:c.x-g.x, dy:c.y-g.y }))
      };
    });
  }

  el.querySelector('.arch-group-info-btn')?.addEventListener('click', e => {
    e.stopPropagation(); selectComp(id); openProps(id);
  });

  const nameEl = el.querySelector('.arch-group-name');
  if (nameEl) nameEl.addEventListener('dblclick', e => { e.stopPropagation(); startRename(id); });

  wireResizeHandle(el, id);
}

// ── Wire block ────────────────────────────────────────────────────────────────

function wireBlock(id) {
  const el = document.getElementById(`comp-${id}`);
  if (!el) return;

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-port,.arch-resize-handle,.arch-block-info-btn,.arch-fun-del')) return;
    selectComp(id);
  });

  const hdr = el.querySelector('[data-drag-id]');
  if (hdr) {
    hdr.addEventListener('pointerdown', e => {
      if (e.target.closest('.arch-block-info-btn')) return;
      e.stopPropagation(); e.preventDefault();
      const c = compById(id); if (!c) return;
      selectComp(id);
      const pos = canvasPos(e);
      _s.dragging = { id, startX:pos.x, startY:pos.y, origX:c.x, origY:c.y };
    });
  }

  // Double-click rename
  el.querySelector('.arch-block-name')?.addEventListener('dblclick', e => {
    e.stopPropagation(); startRename(id);
  });

  // Info/props button
  el.querySelector('.arch-block-info-btn')?.addEventListener('click', e => {
    e.stopPropagation(); selectComp(id); openProps(id);
  });

  // Function delete chips
  el.querySelectorAll('.arch-fun-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await deleteFun(btn.dataset.funId, btn.dataset.compId);
    });
  });

  // Ports: start connection (NO pointer capture — use global pointerup + elementsFromPoint)
  el.querySelectorAll('.arch-port').forEach(port => {
    port.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const pos = canvasPos(e);
      _s.connecting = { sourceId:id, sourcePort:port.dataset.port, curX:pos.x, curY:pos.y };
      const tp = document.getElementById('arch-temp');
      if (tp) { tp.style.display = ''; tp.style.stroke = IFACE.Data.stroke; }
    });
  });

  wireResizeHandle(el, id);
}

function wireResizeHandle(el, id) {
  const handle = el.querySelector('.arch-resize-handle');
  if (!handle) return;
  handle.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const c = compById(id); if (!c) return;
    const pos = canvasPos(e);
    _s.resizing = { id, startX:pos.x, startY:pos.y, origW:c.width, origH:c.height };
  });
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function handleDragMove(e) {
  const { id, startX, startY, origX, origY, isGroup, childOffsets } = _s.dragging;
  const c = compById(id); if (!c) return;
  const pos = canvasPos(e);
  c.x = snap(origX + pos.x - startX);
  c.y = snap(origY + pos.y - startY);
  const el = document.getElementById(`comp-${id}`);
  if (el) { el.style.left = c.x+'px'; el.style.top = c.y+'px'; }

  // Move children with group
  if (isGroup && childOffsets) {
    childOffsets.forEach(({ id:cid, dx, dy }) => {
      const cc = compById(cid); if (!cc) return;
      cc.x = c.x + dx; cc.y = c.y + dy;
      const cel = document.getElementById(`comp-${cid}`);
      if (cel) { cel.style.left = cc.x+'px'; cel.style.top = cc.y+'px'; }
    });
  }
  renderConnections();
}

function handleDragEnd(e) {
  const { id } = _s.dragging;
  _s.dragging = null;
  const c = compById(id); if (!c) return;
  // Auto-assign to group if dropped inside one
  if (c.comp_type !== 'Group') {
    const groups = _s.components.filter(g => g.comp_type === 'Group');
    const hit = groups.find(g =>
      c.x + c.width/2 > g.x && c.x + c.width/2 < g.x + g.width &&
      c.y + c.height/2 > g.y && c.y + c.height/2 < g.y + g.height);
    const newGid = hit?.id || null;
    if ((c.data?.group_id || null) !== newGid) {
      c.data = { ...(c.data||{}), group_id: newGid };
      sb.from('arch_components').update({ data: c.data }).eq('id', id);
    }
  }
}

// ── Resize ────────────────────────────────────────────────────────────────────

function handleResizeMove(e) {
  const { id, startX, startY, origW, origH } = _s.resizing;
  const c = compById(id); if (!c) return;
  const pos = canvasPos(e);
  const minW = c.comp_type === 'Group' ? GROUP_MIN_W : MIN_W;
  const minH = c.comp_type === 'Group' ? GROUP_MIN_H : MIN_H;
  c.width  = Math.max(minW, snap(origW + pos.x - startX));
  c.height = Math.max(minH, snap(origH + pos.y - startY));
  const el = document.getElementById(`comp-${id}`);
  if (el) { el.style.width = c.width+'px'; el.style.height = c.height+'px'; }
  renderConnections();
}

// ── Connection ────────────────────────────────────────────────────────────────

function handleConnectEnd(e) {
  const tp = document.getElementById('arch-temp');
  if (tp) tp.style.display = 'none';

  // Find what element is under pointer using elementsFromPoint
  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const targetPort = under.find(el => el.classList?.contains('arch-port'));
  const targetComp = under.find(el =>
    (el.classList?.contains('arch-block') || el.classList?.contains('arch-group')) &&
    el.dataset.id !== _s.connecting.sourceId);

  const { sourceId, sourcePort, curX, curY } = _s.connecting;
  _s.connecting = null;

  let targetId = null, targetPortName = null;
  if (targetPort && targetPort.dataset.compId !== sourceId) {
    targetId = targetPort.dataset.compId;
    targetPortName = targetPort.dataset.port;
  } else if (targetComp) {
    targetId = targetComp.dataset.id;
    targetPortName = nearestPort(targetId, curX, curY);
  }

  if (!targetId || targetId === sourceId) return;

  // Dedup
  const dup = _s.connections.find(cn =>
    (cn.source_id === sourceId && cn.target_id === targetId) ||
    (cn.source_id === targetId && cn.target_id === sourceId));
  if (dup) { openConnEditor(dup.id); return; }

  showConnPopover(sourceId, sourcePort, targetId, targetPortName || 'left');
}

function cancelConnect() {
  _s.connecting = null;
  const tp = document.getElementById('arch-temp');
  if (tp) tp.style.display = 'none';
}

function nearestPort(compId, cx, cy) {
  const c = compById(compId); if (!c) return 'left';
  let best = 'left', dist = Infinity;
  for (const [p, fn] of Object.entries(PORTS)) {
    const [px,py] = fn(c.width, c.height);
    const d = Math.hypot(cx - (c.x+px), cy - (c.y+py));
    if (d < dist) { dist = d; best = p; }
  }
  return best;
}

// ── Connection popover ────────────────────────────────────────────────────────

function showConnPopover(srcId, srcPort, tgtId, tgtPort) {
  const src = compById(srcId), tgt = compById(tgtId);
  if (!src || !tgt) return;
  const pop = document.getElementById('arch-conn-pop');
  if (!pop) return;

  const srcGroup = src.data?.group_id || src.system_group || '';
  const tgtGroup = tgt.data?.group_id || tgt.system_group || '';
  const isExt    = !!(srcGroup && tgtGroup && srcGroup !== tgtGroup);

  pop.style.display = '';
  pop.innerHTML = connPopoverHTML(src.name, tgt.name, null, isExt);
  wireConnPopover(pop, null, { srcId, srcPort, tgtId, tgtPort, isExt, srcName:src.name, tgtName:tgt.name });
}

function openConnEditor(connId) {
  const cn = _s.connections.find(c => c.id === connId);
  if (!cn) return;
  const src = compById(cn.source_id), tgt = compById(cn.target_id);
  if (!src || !tgt) return;
  const pop = document.getElementById('arch-conn-pop');
  if (!pop) return;
  pop.style.display = '';
  pop.innerHTML = connPopoverHTML(src.name, tgt.name, cn, cn.is_external);
  wireConnPopover(pop, cn, { srcId:cn.source_id, tgtId:cn.target_id, srcName:src.name, tgtName:tgt.name });
}

function connPopoverHTML(srcName, tgtName, cn, isExt) {
  const ifaceOpts = Object.keys(IFACE).map(k =>
    `<option value="${k}" ${cn?.interface_type===k?'selected':''}>${k}</option>`).join('');
  const dirOpts = [
    ['A_to_B',`${srcName} → ${tgtName}`],
    ['B_to_A',`${tgtName} → ${srcName}`],
    ['bidirectional','Bidirectional ↔'],
  ].map(([v,l]) => `<option value="${v}" ${(cn?.direction||'bidirectional')===v?'selected':''}>${escH(l)}</option>`).join('');

  const defaultReq = cn
    ? (cn.requirement || '')
    : `${srcName} shall interface with ${tgtName} via [Data] interface.`;

  return `
    <div class="arch-popover-hdr">
      <strong>${cn ? 'Edit' : 'New'} Interface</strong>
      <button class="arch-popover-close" id="pop-x">✕</button>
    </div>
    <div class="arch-popover-body">
      <div class="arch-popover-row">
        <span class="arch-popover-chip">${escH(srcName)}</span>
        <span class="arch-popover-arr">⇄</span>
        <span class="arch-popover-chip">${escH(tgtName)}</span>
      </div>
      <label class="arch-form-lbl">Interface Type</label>
      <select class="form-input" id="pop-itype" style="margin-bottom:0">${ifaceOpts}</select>
      <label class="arch-form-lbl">Direction</label>
      <select class="form-input" id="pop-dir">${dirOpts}</select>
      <label class="arch-form-lbl">Name (optional)</label>
      <input class="form-input" id="pop-name" value="${escH(cn?.name||'')}" placeholder="e.g. CAN Bus"/>
      <label class="arch-form-lbl">Interface Requirement</label>
      <textarea class="form-input form-textarea" id="pop-req" rows="3">${escH(defaultReq)}</textarea>
      <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:10px">
        <input type="checkbox" id="pop-ext" ${isExt?'checked':''}/> External interface
      </label>
    </div>
    <div class="arch-popover-footer">
      ${cn ? '<button class="btn btn-danger btn-sm" id="pop-del">Delete</button>' : ''}
      <button class="btn btn-secondary btn-sm" id="pop-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm"   id="pop-ok">${cn ? 'Save' : 'Create'}</button>
    </div>`;
}

function wireConnPopover(pop, existingCn, ctx) {
  // Auto-update requirement when type changes
  pop.querySelector('#pop-itype')?.addEventListener('change', () => {
    const type = pop.querySelector('#pop-itype').value;
    if (!existingCn) {
      pop.querySelector('#pop-req').value =
        `${ctx.srcName} shall interface with ${ctx.tgtName} via ${type} interface.`;
    }
  });

  pop.querySelector('#pop-x').onclick      = () => { pop.style.display = 'none'; };
  pop.querySelector('#pop-cancel').onclick = () => { pop.style.display = 'none'; };

  pop.querySelector('#pop-del')?.addEventListener('click', async () => {
    await sb.from('arch_connections').delete().eq('id', existingCn.id);
    _s.connections = _s.connections.filter(c => c.id !== existingCn.id);
    pop.style.display = 'none';
    renderConnections();
    toast('Deleted.', 'success');
  });

  pop.querySelector('#pop-ok').onclick = async () => {
    const itype = pop.querySelector('#pop-itype').value;
    const dir   = pop.querySelector('#pop-dir').value;
    const name  = pop.querySelector('#pop-name').value.trim() || null;
    const req   = pop.querySelector('#pop-req').value.trim() || null;
    const ext   = pop.querySelector('#pop-ext').checked;

    if (existingCn) {
      const patch = { interface_type:itype, direction:dir, name, requirement:req, is_external:ext, updated_at:new Date().toISOString() };
      const { error } = await sb.from('arch_connections').update(patch).eq('id', existingCn.id);
      if (error) { toast('Error: '+error.message,'error'); return; }
      Object.assign(existingCn, patch);
    } else {
      const { data, error } = await sb.from('arch_connections').insert({
        parent_type: _s.parentType, parent_id: _s.parentId, project_id: _s.project.id,
        source_id: ctx.srcId, target_id: ctx.tgtId,
        source_port: ctx.srcPort, target_port: ctx.tgtPort,
        interface_type: itype, direction: dir, name, requirement: req, is_external: ext,
      }).select().single();
      if (error) { toast('Error: '+error.message,'error'); return; }
      _s.connections.push(data);
    }
    pop.style.display = 'none';
    renderConnections();
    toast(existingCn ? 'Updated.' : 'Interface created.', 'success');
  };
}

// ── Properties panel ──────────────────────────────────────────────────────────

function openProps(id) {
  const c = compById(id); if (!c) return;
  const section = document.getElementById('arch-props-section');
  const body    = document.getElementById('arch-props-body');
  if (!section) return;

  section.style.display = '';
  const st = STYLES[c.comp_type] || STYLES.HW;

  body.innerHTML = `
    <label class="arch-form-lbl">Name</label>
    <input class="form-input" id="props-name" value="${escH(c.name)}" style="margin-bottom:6px"/>

    ${c.comp_type !== 'Group' ? `
    <label class="arch-form-lbl">Type</label>
    <select class="form-input" id="props-type" style="margin-bottom:6px">
      ${['HW','SW','Mechanical'].map(t=>`<option value="${t}" ${c.comp_type===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="props-safe" ${c.is_safety_critical?'checked':''}/> Safety Critical
    </label>` : ''}

    ${c.comp_type !== 'Group' ? `
    <div style="margin-top:14px">
      <div class="arch-props-fun-hdr">
        <span>λ Functions</span>
        <button class="arch-tb-btn" id="props-add-fun" style="font-size:11px;padding:2px 7px">＋ Add</button>
      </div>
      <div id="props-fun-list">
        ${(c.functions||[]).map(f => `
          <div class="arch-props-fun-row">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
              <input type="checkbox" class="pf-safe" data-fid="${f.id}" ${f.is_safety_related?'checked':''}/>
              <span style="font-size:11px;color:#BF2600">⚠</span>
            </label>
            <span class="arch-props-fun-name" id="pfn-${f.id}">${escH(f.name)}</span>
            <button class="btn-icon pf-ren" data-fid="${f.id}">✎</button>
            <button class="btn-icon pf-del" data-fid="${f.id}">✕</button>
          </div>`).join('')}
      </div>
      <div id="props-addfun-row" style="display:none;margin-top:6px;display:flex;gap:6px">
        <input class="form-input" id="props-new-fun" placeholder="Function name…" style="flex:1"/>
        <button class="btn btn-primary btn-sm" id="props-new-fun-ok">Add</button>
      </div>
    </div>` : ''}

    <div style="display:flex;gap:6px;margin-top:16px">
      <button class="btn btn-primary btn-sm" id="props-apply">Apply</button>
      <button class="btn btn-danger  btn-sm" id="props-del">Delete</button>
    </div>
  `;

  document.getElementById('props-close').onclick = () => { section.style.display = 'none'; };

  document.getElementById('props-apply').onclick = async () => {
    const name = document.getElementById('props-name').value.trim() || c.name;
    const type = document.getElementById('props-type')?.value || c.comp_type;
    const safe = document.getElementById('props-safe')?.checked ?? c.is_safety_critical;
    const { error } = await sb.from('arch_components')
      .update({ name, comp_type:type, is_safety_critical:safe, updated_at:new Date().toISOString() })
      .eq('id', id);
    if (error) { toast('Error: '+error.message,'error'); return; }
    Object.assign(c, { name, comp_type:type, is_safety_critical:safe });
    refreshComp(id);
    section.style.display = 'none';
    toast('Updated.', 'success');
  };

  document.getElementById('props-del').onclick = () => {
    confirmDialog(`Delete "${c.name}"?`, async () => { await deleteComp(id); section.style.display = 'none'; });
  };

  // Add function
  document.getElementById('props-add-fun')?.addEventListener('click', () => {
    document.getElementById('props-addfun-row').style.display = 'flex';
    document.getElementById('props-new-fun').focus();
  });
  document.getElementById('props-new-fun-ok')?.addEventListener('click', async () => {
    const name = document.getElementById('props-new-fun').value.trim(); if (!name) return;
    const { data, error } = await sb.from('arch_functions').insert({
      component_id:id, name, is_safety_related:false, sort_order:c.functions.length,
    }).select().single();
    if (error) { toast('Error: '+error.message,'error'); return; }
    c.functions.push(data);
    refreshComp(id);
    openProps(id);
  });
  document.getElementById('props-new-fun')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('props-new-fun-ok')?.click();
  });

  // Safety toggle on function
  body.querySelectorAll('.pf-safe').forEach(chk => {
    chk.onchange = async () => {
      const f = c.functions.find(fn => fn.id === chk.dataset.fid); if (!f) return;
      f.is_safety_related = chk.checked;
      await sb.from('arch_functions').update({ is_safety_related:chk.checked }).eq('id', f.id);
      const anySafe = c.functions.some(fn => fn.is_safety_related);
      if (anySafe !== c.is_safety_critical) {
        c.is_safety_critical = anySafe;
        await sb.from('arch_components').update({ is_safety_critical:anySafe }).eq('id', id);
      }
      refreshComp(id);
    };
  });

  // Rename function
  body.querySelectorAll('.pf-ren').forEach(btn => {
    btn.onclick = () => {
      const f = c.functions.find(fn => fn.id === btn.dataset.fid); if (!f) return;
      const span = document.getElementById(`pfn-${f.id}`); if (!span) return;
      const inp = document.createElement('input');
      inp.className = 'form-input'; inp.value = f.name; inp.style.flex = '1';
      span.replaceWith(inp); inp.focus(); inp.select();
      const save = async () => {
        const n = inp.value.trim() || f.name;
        await sb.from('arch_functions').update({ name:n }).eq('id', f.id);
        f.name = n; refreshComp(id); openProps(id);
      };
      inp.onblur = save; inp.onkeydown = e => { if (e.key==='Enter') save(); };
    };
  });

  // Delete function
  body.querySelectorAll('.pf-del').forEach(btn => {
    btn.onclick = async () => { await deleteFun(btn.dataset.fid, id); openProps(id); };
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addComp(type) {
  const count  = _s.components.length;
  const isGrp  = type === 'Group';
  const w = isGrp ? 300 : 180;
  const h = isGrp ? 220 : 130;
  const x = snap(60 + (count % 4) * 220);
  const y = snap(60 + Math.floor(count / 4) * 200);

  const { data, error } = await sb.from('arch_components').insert({
    parent_type: _s.parentType, parent_id: _s.parentId, project_id: _s.project.id,
    name: isGrp ? `System ${count+1}` : `${type} Block ${count+1}`,
    comp_type: type, x, y, width: w, height: h, sort_order: count,
  }).select().single();
  if (error) { toast('Error: '+error.message,'error'); return; }
  data.functions = [];
  _s.components.push(data);

  if (isGrp) {
    renderGroups();
  } else {
    const layer = document.getElementById('arch-comp-layer');
    if (layer) { layer.insertAdjacentHTML('beforeend', blockHTML(data)); wireBlock(data.id); }
  }
  selectComp(data.id);
  setTimeout(() => startRename(data.id), 60);
}

async function deleteComp(id) {
  await sb.from('arch_components').delete().eq('id', id);
  _s.components  = _s.components.filter(c => c.id !== id);
  _s.connections = _s.connections.filter(cn => cn.source_id !== id && cn.target_id !== id);
  document.getElementById(`comp-${id}`)?.remove();
  selectComp(null);
  renderConnections();
  toast('Deleted.', 'success');
}

async function deleteFun(funId, compId) {
  await sb.from('arch_functions').delete().eq('id', funId);
  const c = compById(compId);
  if (c) c.functions = c.functions.filter(f => f.id !== funId);
  refreshComp(compId);
}

async function savePositions() {
  const btn = document.getElementById('btn-arch-save');
  if (btn) btn.disabled = true;
  await Promise.all(_s.components.map(c =>
    sb.from('arch_components').update({ x:c.x, y:c.y, width:c.width, height:c.height, updated_at:new Date().toISOString() }).eq('id', c.id)
  ));
  if (btn) btn.disabled = false;
  toast('Saved.', 'success');
}

// ── Selection & refresh ───────────────────────────────────────────────────────

function selectComp(id) {
  _s.selected = id;
  document.querySelectorAll('.arch-block,.arch-group').forEach(el => {
    el.classList.toggle('arch-block--sel',  el.dataset.id === id && el.classList.contains('arch-block'));
    el.classList.toggle('arch-group--sel',  el.dataset.id === id && el.classList.contains('arch-group'));
  });
  const btn = document.getElementById('btn-del-comp');
  if (btn) btn.disabled = !id;
}

function refreshComp(id) {
  const c = compById(id); if (!c) return;
  const el = document.getElementById(`comp-${id}`); if (!el) return;
  if (c.comp_type === 'Group') {
    el.outerHTML = groupHTML(c);
    wireGroup(id);
  } else {
    el.outerHTML = blockHTML(c);
    wireBlock(id);
  }
}

function startRename(id) {
  const c = compById(id); if (!c) return;
  const nameEl = document.getElementById(`cname-${id}`); if (!nameEl) return;
  const inp = document.createElement('input');
  inp.className = 'arch-rename-input'; inp.value = c.name;
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  const save = async () => {
    const n = inp.value.trim() || c.name;
    c.name = n;
    await sb.from('arch_components').update({ name:n, updated_at:new Date().toISOString() }).eq('id', id);
    refreshComp(id);
  };
  inp.onblur = save;
  inp.onkeydown = e => { if (e.key==='Enter') inp.blur(); if (e.key==='Escape') refreshComp(id); };
}

function fitView() {
  if (!_s.components.length) { _s.zoom=1; _s.panX=20; _s.panY=20; applyViewport(); return; }
  const outer = document.getElementById('arch-outer');
  if (!outer) return;
  const ow = outer.clientWidth, oh = outer.clientHeight;
  const xs = _s.components.map(c=>c.x), ys = _s.components.map(c=>c.y);
  const xe = _s.components.map(c=>c.x+c.width), ye = _s.components.map(c=>c.y+c.height);
  const minX=Math.min(...xs), minY=Math.min(...ys), maxX=Math.max(...xe), maxY=Math.max(...ye);
  const pad = 60;
  _s.zoom = Math.min(2, Math.min((ow-pad*2)/(maxX-minX||1), (oh-pad*2)/(maxY-minY||1)));
  _s.panX = pad - minX*_s.zoom;
  _s.panY = pad - minY*_s.zoom;
  applyViewport();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function compById(id) { return _s.components.find(c => c.id === id); }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
