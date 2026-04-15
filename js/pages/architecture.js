/**
 * Architecture Canvas — v3
 *
 * Changes from v2:
 * - Port blocks: UML-style black squares, represent external interface points
 * - System Group creation: links to existing project system or creates a new one
 * - Fix arch_connections insert: better error handling + migration hint
 * - System-level external interfaces via ports
 *
 * comp_type: 'Group' | 'HW' | 'SW' | 'Mechanical' | 'Port'
 * data.group_id:   UUID → parent group (blocks)
 * data.system_id:  UUID → linked project system (Group)
 * data.port_dir:   'in' | 'out' | 'inout'  (Port)
 */

import { sb } from '../config.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../components/modal.js';

// ── Visual constants ──────────────────────────────────────────────────────────

const STYLES = {
  HW:         { bg:'#E8F0FE', border:'#1A73E8', hdr:'#1A73E8', stereotype:'block'  },
  SW:         { bg:'#E6F4EA', border:'#1E8E3E', hdr:'#1E8E3E', stereotype:'block'  },
  Mechanical: { bg:'#FEF3E2', border:'#E37400', hdr:'#E37400', stereotype:'block'  },
  Group:      { bg:'#F8F9FA', border:'#9AA0A6', hdr:'transparent', stereotype:'system' },
  Port:       { bg:'#212121', border:'#212121', hdr:'#212121', stereotype:'port'   },
};

const IFACE = {
  Data:       { stroke:'#1A73E8', dash:'',    icon:'⇄', weight:2   },
  Electrical: { stroke:'#E37400', dash:'',    icon:'⚡', weight:2   },
  Mechanical: { stroke:'#5D4037', dash:'6,3', icon:'⚙', weight:2.5 },
  Thermal:    { stroke:'#C5221F', dash:'4,3', icon:'🌡', weight:2   },
  Power:      { stroke:'#7B1FA2', dash:'',    icon:'⏻', weight:2.5 },
};

const PORTS = {
  top:    (w,h)=>[w/2,  0  ],
  right:  (w,h)=>[w,    h/2],
  bottom: (w,h)=>[w/2,  h  ],
  left:   (w,h)=>[0,    h/2],
};

const GRID = 20;
const MIN_W = 140, MIN_H = 90;
const GROUP_MIN_W = 240, GROUP_MIN_H = 160;
const PORT_SIZE = 20;

// ── State ─────────────────────────────────────────────────────────────────────

let _s = null;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderArchitecture(container, { project, item, system }) {
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Load all arch data + project systems in parallel
  const [compRes, connRes, sysRes] = await Promise.all([
    sb.from('arch_components').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId).order('sort_order'),
    sb.from('arch_connections').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('systems').select('id,name,system_code').eq('item_id', item?.id || '').order('created_at'),
  ]);

  if (compRes.error) {
    container.innerHTML = `<div style="padding:40px;color:var(--color-danger)">
      <strong>Architecture tables not found.</strong><br>
      Please run <code>db/migration_005_architecture.sql</code> in your Supabase SQL Editor.</div>`;
    return;
  }

  const compList = compRes.data || [];
  let funs = [];
  if (compList.length) {
    const { data } = await sb.from('arch_functions').select('*')
      .in('component_id', compList.map(c => c.id)).order('sort_order');
    funs = data || [];
  }

  const components = compList.map(c => ({
    ...c, functions: funs.filter(f => f.component_id === c.id),
  }));

  _s = {
    container, project, item, system,
    parentType, parentId,
    components,
    connections: connRes.data || [],
    projectSystems: sysRes.data || [],
    panX: 20, panY: 20, zoom: 1,
    dragging: null, resizing: null, connecting: null,
    selected: null,
  };

  if (window._archCleanup) window._archCleanup();
  buildShell(container, system ? system.name : item.name);
  renderAll();
  wireCanvas();
  wireGlobal();
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function buildShell(container, title) {
  container.innerHTML = `
    <div class="arch-shell">
      <div class="arch-topbar">
        <span class="arch-topbar-title">◈ ${escH(title)} — Architecture</span>
        <div class="arch-topbar-right">
          <button class="arch-tb-btn" id="btn-zoom-out">−</button>
          <span class="arch-zoom-lbl" id="arch-zoom-lbl">100%</span>
          <button class="arch-tb-btn" id="btn-zoom-in">＋</button>
          <button class="arch-tb-btn" id="btn-zoom-fit">⊞ Fit</button>
          <div class="arch-sep"></div>
          <button class="btn btn-primary btn-sm" id="btn-arch-save">💾 Save</button>
        </div>
      </div>
      <div class="arch-workspace">
        <div class="arch-canvas-outer" id="arch-outer">
          <div class="arch-viewport" id="arch-vp">
            <div class="arch-group-layer" id="arch-group-layer"></div>
            <svg class="arch-svg" id="arch-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-e" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0,8 3,0 6" class="arr-poly"/>
                </marker>
                <marker id="arr-s" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0,8 3,0 6" class="arr-poly"/>
                </marker>
              </defs>
              <g id="arch-conn-g"></g>
              <path id="arch-temp" fill="none" stroke="#1A73E8" stroke-width="2"
                    stroke-dasharray="6,3" style="pointer-events:none;display:none"/>
            </svg>
            <div class="arch-comp-layer" id="arch-comp-layer"></div>
          </div>
        </div>

        <!-- Right palette -->
        <div class="arch-palette" id="arch-palette">
          <div class="arch-palette-section">
            <div class="arch-palette-hdr">Add Block</div>
            <div class="arch-palette-items">
              <button class="arch-pal-item" data-type="HW">
                <span class="arch-pal-icon" style="background:#1A73E8">HW</span>HW Block
              </button>
              <button class="arch-pal-item" data-type="SW">
                <span class="arch-pal-icon" style="background:#1E8E3E">SW</span>SW Block
              </button>
              <button class="arch-pal-item" data-type="Mechanical">
                <span class="arch-pal-icon" style="background:#E37400">ME</span>Mech Block
              </button>
              <button class="arch-pal-item pal-item-group" data-type="Group">
                <span class="arch-pal-icon arch-pal-icon-group">⬜</span>System Group
              </button>
              <button class="arch-pal-item pal-item-port" data-type="Port" title="UML port — external interface point">
                <span class="arch-pal-icon arch-pal-icon-port">■</span>Port
              </button>
            </div>
          </div>

          <div class="arch-palette-section">
            <div class="arch-palette-hdr">Interface Types</div>
            ${Object.entries(IFACE).map(([k,v]) => `
              <div class="arch-iface-legend-row">
                <svg width="28" height="10" style="flex-shrink:0">
                  <line x1="0" y1="5" x2="28" y2="5" stroke="${v.stroke}"
                        stroke-width="${v.weight}" stroke-dasharray="${v.dash}"/>
                </svg>
                <span class="arch-iface-legend-icon">${v.icon}</span>
                <span class="arch-iface-legend-label">${k}</span>
              </div>`).join('')}
          </div>

          <div class="arch-palette-section arch-props-section" id="arch-props-section" style="display:none">
            <div class="arch-palette-hdr">
              Properties
              <button class="arch-props-close" id="props-close">✕</button>
            </div>
            <div id="arch-props-body"></div>
          </div>
        </div>
      </div>

      <div class="arch-conn-popover" id="arch-conn-pop" style="display:none"></div>
      <div class="arch-conn-popover" id="arch-sys-pop"  style="display:none"></div>
    </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  renderGroups();
  renderComponents();
  renderConnections();
  applyViewport();
}

function renderGroups() {
  const layer = document.getElementById('arch-group-layer');
  if (!layer) return;
  layer.innerHTML = _s.components.filter(c => c.comp_type === 'Group').map(g => groupHTML(g)).join('');
  _s.components.filter(c => c.comp_type === 'Group').forEach(g => wireGroup(g.id));
}

function renderComponents() {
  const layer = document.getElementById('arch-comp-layer');
  if (!layer) return;
  layer.innerHTML = _s.components
    .filter(c => c.comp_type !== 'Group')
    .map(c => c.comp_type === 'Port' ? portHTML(c) : blockHTML(c))
    .join('');
  _s.components.filter(c => c.comp_type !== 'Group').forEach(c => wireBlock(c.id));
}

function renderConnections() {
  const g = document.getElementById('arch-conn-g');
  if (!g) return;
  g.innerHTML = _s.connections.map(cn => connSVG(cn)).join('');
  _s.connections.forEach(cn => {
    document.getElementById(`conn-${cn.id}`)
      ?.addEventListener('click', e => { e.stopPropagation(); openConnEditor(cn.id); });
  });
}

// ── Group HTML ────────────────────────────────────────────────────────────────

function groupHTML(g) {
  const linkedSys = g.data?.system_id
    ? _s.projectSystems.find(s => s.id === g.data.system_id) : null;
  const sysLabel = linkedSys
    ? `<span class="arch-group-sysref" title="Linked system">${escH(linkedSys.system_code)}</span>` : '';

  return `
    <div class="arch-group ${_s.selected === g.id ? 'arch-group--sel' : ''}"
         id="comp-${g.id}" data-id="${g.id}" data-type="Group"
         style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px">
      <div class="arch-group-hdr" data-drag-id="${g.id}">
        <span class="arch-group-stereo">«system»</span>
        <span class="arch-group-name" id="cname-${g.id}">${escH(g.name)}</span>
        ${sysLabel}
        <button class="arch-group-info-btn" data-comp-id="${g.id}">≡</button>
      </div>
      <div class="arch-resize-handle" data-comp-id="${g.id}"></div>
    </div>`;
}

// ── Port HTML (UML square) ────────────────────────────────────────────────────

function portHTML(c) {
  const dir = c.data?.port_dir || 'inout';
  const dirIcon = { in:'▶', out:'◀', inout:'◆' }[dir] || '◆';
  const sel = _s.selected === c.id;
  return `
    <div class="arch-port-block ${sel ? 'arch-port-block--sel' : ''}"
         id="comp-${c.id}" data-id="${c.id}" data-type="Port"
         style="left:${c.x}px;top:${c.y}px;width:${PORT_SIZE}px;height:${PORT_SIZE}px"
         title="${escH(c.name)} (${dir})">
      <span class="arch-port-block-dir">${dirIcon}</span>
      <span class="arch-port-block-label">${escH(c.name)}</span>
      <!-- Connection ports -->
      <div class="arch-port arch-port--top"    data-comp-id="${c.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${c.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${c.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${c.id}" data-port="left"></div>
      <div class="arch-resize-handle" data-comp-id="${c.id}" style="display:none"></div>
    </div>`;
}

// ── Block HTML (SysML) ────────────────────────────────────────────────────────

function blockHTML(c) {
  const st   = STYLES[c.comp_type] || STYLES.HW;
  const safe = c.is_safety_critical;
  const funs = c.functions || [];
  const sel  = _s.selected === c.id;

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
      <div class="arch-block-hdr" data-drag-id="${c.id}" style="background:${st.hdr}">
        <span class="arch-block-stereo">«${st.stereotype}»</span>
        <span class="arch-block-name" id="cname-${c.id}">${escH(c.name)}</span>
        ${safe ? '<span class="arch-block-safe-ico">⚠</span>' : ''}
        <button class="arch-block-info-btn" data-comp-id="${c.id}">≡</button>
      </div>
      <div class="arch-block-type-row" style="background:${st.bg}">
        <span class="arch-block-type-badge" style="color:${st.border}">${c.comp_type}</span>
      </div>
      <div class="arch-block-funs-hdr">λ functions</div>
      <div class="arch-block-funs" id="funlist-${c.id}">${funItems}</div>
      <div class="arch-port arch-port--top"    data-comp-id="${c.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${c.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${c.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${c.id}" data-port="left"></div>
      <div class="arch-resize-handle" data-comp-id="${c.id}"></div>
    </div>`;
}

// ── SVG connection ────────────────────────────────────────────────────────────

function connSVG(cn) {
  const src = compById(cn.source_id), tgt = compById(cn.target_id);
  if (!src || !tgt) return '';
  const [sx,sy] = portAbs(src, cn.source_port);
  const [tx,ty] = portAbs(tgt, cn.target_port);
  const d = bezier(sx,sy,cn.source_port,tx,ty,cn.target_port);
  const iv = IFACE[cn.interface_type] || IFACE.Data;
  const [mx,my] = [(sx+tx)/2,(sy+ty)/2];
  const ms = cn.direction === 'B_to_A' ? `marker-start="url(#arr-s)"` : '';
  const me = cn.direction !== 'B_to_A' ? `marker-end="url(#arr-e)"` : '';
  const ext = cn.is_external
    ? `<text x="${mx}" y="${my-24}" text-anchor="middle" class="arch-conn-ext">EXT</text>` : '';

  // Label just above the midpoint badge, with background
  const labelTxt = escH(cn.name || cn.interface_type);
  const labelW   = Math.max(44, labelTxt.length * 6 + 12);
  const labelY   = my - 14;
  const label = `
    <rect x="${mx - labelW/2}" y="${labelY - 11}" width="${labelW}" height="13" rx="3"
          fill="rgba(255,255,255,0.92)" stroke="${iv.stroke}" stroke-width="0.8"/>
    <text x="${mx}" y="${labelY}" text-anchor="middle" class="arch-conn-label"
          style="fill:${iv.stroke}">${labelTxt}</text>`;

  // Port icon at group border when one endpoint is a Group
  let portIcon = '';
  const srcIsGroup = src.comp_type === 'Group';
  const tgtIsGroup = tgt.comp_type === 'Group';
  if (srcIsGroup || tgtIsGroup) {
    const grp     = srcIsGroup ? src : tgt;
    const blk     = srcIsGroup ? tgt : src;
    const [gpx, gpy] = srcIsGroup ? [sx, sy] : [tx, ty];
    // Determine port flow direction from the group boundary's perspective
    const blkInsideGrp = blk.data?.group_id === grp.id;
    let portDir;
    if (cn.direction === 'bidirectional') {
      portDir = 'inout';
    } else {
      // A_to_B: flow goes src→tgt.
      // If blk is inside grp and blk is the src (A_to_B, !srcIsGroup) → exits grp → out
      // If blk is inside grp and blk is the tgt (B_to_A, !srcIsGroup) → enters grp → in
      const blkIsSrc = !srcIsGroup; // blk = src means !srcIsGroup
      const flowsOut = blkInsideGrp
        ? (blkIsSrc ? cn.direction === 'A_to_B' : cn.direction === 'B_to_A')
        : (blkIsSrc ? cn.direction === 'B_to_A' : cn.direction === 'A_to_B');
      portDir = flowsOut ? 'out' : 'in';
    }
    const dirArrow = { in:'▶', out:'◀', inout:'◆' }[portDir];
    const ps = 14;
    portIcon = `
      <rect x="${gpx - ps/2}" y="${gpy - ps/2}" width="${ps}" height="${ps}" rx="2"
            fill="#212121" stroke="#fff" stroke-width="1.5"/>
      <text x="${gpx}" y="${gpy + 4}" text-anchor="middle" font-size="8" fill="#fff"
            style="pointer-events:none;font-family:system-ui;font-weight:bold">${dirArrow}</text>`;
  }

  return `
    <g id="conn-${cn.id}" class="arch-conn-g">
      <path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
      <path d="${d}" fill="none" stroke="${iv.stroke}" stroke-width="${iv.weight}"
            stroke-dasharray="${iv.dash}" ${ms} ${me}/>
      <circle cx="${mx}" cy="${my}" r="9" fill="${iv.stroke}" opacity="0.18"/>
      <text x="${mx}" y="${my+4}" text-anchor="middle" class="arch-conn-icon">${iv.icon}</text>
      ${label}
      ${ext}
      ${portIcon}
    </g>`;
}

// ── Math ──────────────────────────────────────────────────────────────────────

function portAbs(comp, port) {
  const sz = comp.comp_type === 'Port' ? PORT_SIZE : null;
  const w = sz || comp.width, h = sz || comp.height;
  const fn = PORTS[port] || PORTS.right;
  const [dx,dy] = fn(w,h);
  return [comp.x+dx, comp.y+dy];
}

function bezier(x1,y1,p1,x2,y2,p2) {
  const len = Math.max(50, Math.hypot(x2-x1,y2-y1)*0.4);
  const off = {top:[0,-len],right:[len,0],bottom:[0,len],left:[-len,0]};
  const [cx1,cy1] = [x1+(off[p1]?.[0]??len), y1+(off[p1]?.[1]??0)];
  const [cx2,cy2] = [x2+(off[p2]?.[0]??-len), y2+(off[p2]?.[1]??0)];
  return `M${x1} ${y1} C${cx1} ${cy1},${cx2} ${cy2},${x2} ${y2}`;
}

function snap(v) { return Math.round(v/GRID)*GRID; }

function canvasPos(e) {
  const r = document.getElementById('arch-outer').getBoundingClientRect();
  return { x:(e.clientX-r.left-_s.panX)/_s.zoom, y:(e.clientY-r.top-_s.panY)/_s.zoom };
}

function applyViewport() {
  const vp = document.getElementById('arch-vp');
  if (vp) vp.style.transform = `translate(${_s.panX}px,${_s.panY}px) scale(${_s.zoom})`;
  const lbl = document.getElementById('arch-zoom-lbl');
  if (lbl) lbl.textContent = `${Math.round(_s.zoom*100)}%`;
}

// ── Canvas wire ───────────────────────────────────────────────────────────────

function wireCanvas() {
  const outer = document.getElementById('arch-outer');
  if (!outer) return;

  let panStart = null;
  outer.addEventListener('pointerdown', e => {
    const t = e.target;
    const empty = t===outer || t.id==='arch-vp' || t.id==='arch-svg' ||
      t.id==='arch-conn-g' || t.classList?.contains('arch-group-layer') ||
      t.classList?.contains('arch-comp-layer');
    if (!empty || e.button!==0) return;
    e.preventDefault();
    panStart = { cx:e.clientX-_s.panX, cy:e.clientY-_s.panY };
    selectComp(null);
    outer.style.cursor = 'grabbing';
  });
  outer.addEventListener('pointermove', e => {
    if (!panStart) return;
    _s.panX = e.clientX-panStart.cx; _s.panY = e.clientY-panStart.cy;
    applyViewport();
    // Update temp connection path
    if (_s.connecting) updateTempPath(e);
  });
  outer.addEventListener('pointerup', () => { panStart=null; outer.style.cursor=''; });

  outer.addEventListener('pointermove', e => { if (_s.connecting && !panStart) updateTempPath(e); });

  outer.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY<0 ? 1.12 : 0.89;
    const r = outer.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    _s.panX = mx-(mx-_s.panX)*f; _s.panY = my-(my-_s.panY)*f;
    _s.zoom = Math.min(2.5, Math.max(0.2, _s.zoom*f));
    applyViewport();
  }, { passive:false });

  document.getElementById('btn-zoom-in').onclick  = () => { _s.zoom=Math.min(2.5,_s.zoom*1.2); applyViewport(); };
  document.getElementById('btn-zoom-out').onclick = () => { _s.zoom=Math.max(0.2,_s.zoom*0.8); applyViewport(); };
  document.getElementById('btn-zoom-fit').onclick = fitView;
  document.getElementById('btn-arch-save').onclick = savePositions;

  document.querySelectorAll('.arch-pal-item').forEach(btn => {
    btn.addEventListener('click', () => addComp(btn.dataset.type));
  });
}

function updateTempPath(e) {
  const src = compById(_s.connecting.sourceId); if (!src) return;
  const pos = canvasPos(e);
  _s.connecting.curX = pos.x; _s.connecting.curY = pos.y;
  const [sx,sy] = portAbs(src, _s.connecting.sourcePort);
  const tp = document.getElementById('arch-temp');
  if (tp) tp.setAttribute('d', bezier(sx,sy,_s.connecting.sourcePort,pos.x,pos.y,'left'));

  // Highlight potential connection targets
  document.querySelectorAll('.arch-group--conn-target,.arch-block--conn-target').forEach(el =>
    el.classList.remove('arch-group--conn-target','arch-block--conn-target'));

  // Group hover: check canvas coords against group bounds
  const hovGroup = _s.components.find(g =>
    g.comp_type==='Group' && g.id!==_s.connecting.sourceId &&
    pos.x>=g.x && pos.x<=g.x+g.width && pos.y>=g.y && pos.y<=g.y+g.height);
  if (hovGroup) {
    document.getElementById(`comp-${hovGroup.id}`)?.classList.add('arch-group--conn-target');
  } else {
    // Block hover via DOM hit test
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const hovBlock = under.find(el =>
      (el.classList?.contains('arch-block')||el.classList?.contains('arch-port-block')) &&
      el.dataset.id !== _s.connecting.sourceId);
    if (hovBlock) hovBlock.classList.add('arch-block--conn-target');
  }
}

// ── Global events ─────────────────────────────────────────────────────────────

function wireGlobal() {
  const onMove = e => {
    if (_s?.dragging)  handleDragMove(e);
    if (_s?.resizing)  handleResizeMove(e);
  };
  const onUp = e => {
    if (_s?.dragging)   handleDragEnd(e);
    if (_s?.resizing)   { _s.resizing=null; }
    if (_s?.connecting) handleConnectEnd(e);
  };
  const onKey = e => {
    if (!_s) return;
    if ((e.key==='Delete'||e.key==='Backspace') && document.activeElement===document.body && _s.selected)
      deleteComp(_s.selected);
    if (e.key==='Escape') { cancelConnect(); selectComp(null); }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup',   onUp);
  document.addEventListener('keydown',     onKey);
  window._archCleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('keydown',     onKey);
    window._archCleanup = null;
  };
}

// ── Wire group ────────────────────────────────────────────────────────────────

function wireGroup(id) {
  const el = document.getElementById(`comp-${id}`); if (!el) return;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-resize-handle,.arch-group-info-btn')) return;
    selectComp(id);
  });
  el.querySelector('[data-drag-id]')?.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-group-info-btn')) return;
    e.stopPropagation(); e.preventDefault();
    const g = compById(id); if (!g) return;
    selectComp(id);
    const pos = canvasPos(e);
    _s.dragging = { id, startX:pos.x, startY:pos.y, origX:g.x, origY:g.y, isGroup:true,
      childOffsets: _s.components
        .filter(c => c.comp_type!=='Group' && c.data?.group_id===id)
        .map(c => ({ id:c.id, dx:c.x-g.x, dy:c.y-g.y }))
    };
  });
  el.querySelector('.arch-group-info-btn')?.addEventListener('click', e => {
    e.stopPropagation(); selectComp(id); openProps(id);
  });
  el.querySelector('.arch-group-name')?.addEventListener('dblclick', e => {
    e.stopPropagation(); startRename(id);
  });
  wireResizeHandle(el, id);
}

// ── Wire block / port ─────────────────────────────────────────────────────────

function wireBlock(id) {
  const el = document.getElementById(`comp-${id}`); if (!el) return;
  const c  = compById(id);

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-port,.arch-resize-handle,.arch-block-info-btn,.arch-fun-del')) return;
    selectComp(id);
  });

  el.querySelector('[data-drag-id]')?.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-block-info-btn')) return;
    e.stopPropagation(); e.preventDefault();
    selectComp(id);
    const pos = canvasPos(e);
    _s.dragging = { id, startX:pos.x, startY:pos.y, origX:c.x, origY:c.y };
  });

  // Port blocks: drag from anywhere in the block body (no header)
  if (c?.comp_type === 'Port') {
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.arch-port,.arch-resize-handle')) return;
      e.stopPropagation(); e.preventDefault();
      selectComp(id);
      const pos = canvasPos(e);
      _s.dragging = { id, startX:pos.x, startY:pos.y, origX:c.x, origY:c.y };
    });
  }

  el.querySelector('.arch-block-name')?.addEventListener('dblclick', e => {
    e.stopPropagation(); startRename(id);
  });
  el.querySelector('.arch-block-info-btn')?.addEventListener('click', e => {
    e.stopPropagation(); selectComp(id); openProps(id);
  });
  el.querySelectorAll('.arch-fun-del').forEach(btn => {
    btn.addEventListener('click', async e => { e.stopPropagation(); await deleteFun(btn.dataset.funId, btn.dataset.compId); });
  });
  el.querySelectorAll('.arch-port').forEach(port => {
    port.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const pos = canvasPos(e);
      _s.connecting = { sourceId:id, sourcePort:port.dataset.port, curX:pos.x, curY:pos.y };
      const tp = document.getElementById('arch-temp');
      if (tp) tp.style.display = '';
    });
  });
  wireResizeHandle(el, id);
}

function wireResizeHandle(el, id) {
  el.querySelector('.arch-resize-handle')?.addEventListener('pointerdown', e => {
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
  c.x = snap(origX+pos.x-startX); c.y = snap(origY+pos.y-startY);
  const el = document.getElementById(`comp-${id}`);
  if (el) { el.style.left=c.x+'px'; el.style.top=c.y+'px'; }
  if (isGroup && childOffsets) {
    childOffsets.forEach(({ id:cid, dx, dy }) => {
      const cc = compById(cid); if (!cc) return;
      cc.x=c.x+dx; cc.y=c.y+dy;
      const cel = document.getElementById(`comp-${cid}`);
      if (cel) { cel.style.left=cc.x+'px'; cel.style.top=cc.y+'px'; }
    });
  }
  renderConnections();
}

function handleDragEnd() {
  const { id } = _s.dragging;
  _s.dragging = null;
  const c = compById(id); if (!c || c.comp_type==='Group') return;
  // Auto-assign to group
  const grp = _s.components.find(g =>
    g.comp_type==='Group' &&
    c.x+c.width/2>g.x && c.x+c.width/2<g.x+g.width &&
    c.y+c.height/2>g.y && c.y+c.height/2<g.y+g.height);
  const gid = grp?.id||null;
  if ((c.data?.group_id||null)!==gid) {
    c.data = {...(c.data||{}), group_id:gid};
    sb.from('arch_components').update({ data:c.data }).eq('id', id);
  }
}

// ── Resize ────────────────────────────────────────────────────────────────────

function handleResizeMove(e) {
  const { id, startX, startY, origW, origH } = _s.resizing;
  const c = compById(id); if (!c) return;
  const pos = canvasPos(e);
  const isGrp = c.comp_type==='Group';
  c.width  = Math.max(isGrp?GROUP_MIN_W:MIN_W, snap(origW+pos.x-startX));
  c.height = Math.max(isGrp?GROUP_MIN_H:MIN_H, snap(origH+pos.y-startY));
  const el = document.getElementById(`comp-${id}`);
  if (el) { el.style.width=c.width+'px'; el.style.height=c.height+'px'; }
  renderConnections();
}

// ── Connection ────────────────────────────────────────────────────────────────

function handleConnectEnd(e) {
  const tp = document.getElementById('arch-temp');
  if (tp) tp.style.display='none';
  document.querySelectorAll('.arch-group--conn-target,.arch-block--conn-target').forEach(el =>
    el.classList.remove('arch-group--conn-target','arch-block--conn-target'));

  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const tPort = under.find(el => el.classList?.contains('arch-port'));
  const tComp = under.find(el =>
    (el.classList?.contains('arch-block')||el.classList?.contains('arch-port-block')) &&
    el.dataset.id !== _s.connecting.sourceId);
  const tGroup = under.find(el =>
    el.classList?.contains('arch-group') && el.dataset.id !== _s.connecting.sourceId);

  const { sourceId, sourcePort, curX, curY } = _s.connecting;
  _s.connecting = null;

  let targetId=null, targetPort=null;
  if (tPort && tPort.dataset.compId!==sourceId) { targetId=tPort.dataset.compId; targetPort=tPort.dataset.port; }
  else if (tComp) { targetId=tComp.dataset.id; targetPort=nearestPort(tComp.dataset.id,curX,curY); }
  else if (tGroup) { targetId=tGroup.dataset.id; targetPort=nearestGroupBorderPort(tGroup.dataset.id,curX,curY); }

  if (!targetId) return;

  const dup = _s.connections.find(cn =>
    (cn.source_id===sourceId&&cn.target_id===targetId)||(cn.source_id===targetId&&cn.target_id===sourceId));
  if (dup) { openConnEditor(dup.id); return; }

  showConnPopover(sourceId, sourcePort, targetId, targetPort||'left');
}

function cancelConnect() {
  _s.connecting=null;
  const tp = document.getElementById('arch-temp');
  if (tp) tp.style.display='none';
  document.querySelectorAll('.arch-group--conn-target,.arch-block--conn-target').forEach(el =>
    el.classList.remove('arch-group--conn-target','arch-block--conn-target'));
}

function nearestGroupBorderPort(groupId, cx, cy) {
  const g = compById(groupId); if (!g) return 'right';
  const dTop    = Math.abs(cy - g.y);
  const dBottom = Math.abs(cy - (g.y + g.height));
  const dLeft   = Math.abs(cx - g.x);
  const dRight  = Math.abs(cx - (g.x + g.width));
  const mn = Math.min(dTop, dBottom, dLeft, dRight);
  if (mn === dTop)    return 'top';
  if (mn === dBottom) return 'bottom';
  if (mn === dLeft)   return 'left';
  return 'right';
}

function nearestPort(compId, cx, cy) {
  const c = compById(compId); if (!c) return 'left';
  const w = c.comp_type==='Port'?PORT_SIZE:c.width;
  const h = c.comp_type==='Port'?PORT_SIZE:c.height;
  let best='left', dist=Infinity;
  for (const [p,fn] of Object.entries(PORTS)) {
    const [px,py]=fn(w,h);
    const d=Math.hypot(cx-(c.x+px),cy-(c.y+py));
    if (d<dist){dist=d;best=p;}
  }
  return best;
}

// ── Connection popover ────────────────────────────────────────────────────────

function showConnPopover(srcId, srcPort, tgtId, tgtPort) {
  const src=compById(srcId), tgt=compById(tgtId);
  if (!src||!tgt) return;
  const srcGrp = src.data?.group_id||''; const tgtGrp = tgt.data?.group_id||'';
  const isExt  = !!(srcGrp && tgtGrp && srcGrp!==tgtGrp) ||
                  src.comp_type==='Port' || tgt.comp_type==='Port' ||
                  src.comp_type==='Group' || tgt.comp_type==='Group';

  // Auto-detect direction when block connects to its parent group border
  let autoDir = null;
  if (tgt.comp_type==='Group' && src.data?.group_id===tgt.id) autoDir = 'A_to_B'; // block→group = outgoing
  else if (src.comp_type==='Group' && tgt.data?.group_id===src.id) autoDir = 'B_to_A'; // group→block = incoming

  const pop = document.getElementById('arch-conn-pop');
  pop.style.display='';
  pop.innerHTML = connPopHTML(src.name, tgt.name, null, isExt, autoDir);
  wireConnPop(pop, null, { srcId, srcPort, tgtId, tgtPort, isExt, srcName:src.name, tgtName:tgt.name });
}

function openConnEditor(connId) {
  const cn=_s.connections.find(c=>c.id===connId); if (!cn) return;
  const src=compById(cn.source_id), tgt=compById(cn.target_id); if (!src||!tgt) return;
  const pop = document.getElementById('arch-conn-pop');
  pop.style.display='';
  pop.innerHTML = connPopHTML(src.name, tgt.name, cn, cn.is_external);
  wireConnPop(pop, cn, { srcId:cn.source_id, tgtId:cn.target_id, srcName:src.name, tgtName:tgt.name });
}

function connPopHTML(srcName, tgtName, cn, isExt, autoDir=null) {
  const ifOpts = Object.keys(IFACE).map(k=>
    `<option value="${k}" ${cn?.interface_type===k?'selected':''}>${k}</option>`).join('');
  const defaultDir = cn?.direction || autoDir || 'bidirectional';
  const dirOpts = [
    ['A_to_B',`${srcName} → ${tgtName}`],
    ['B_to_A',`${tgtName} → ${srcName}`],
    ['bidirectional','Bidirectional ↔'],
  ].map(([v,l])=>`<option value="${v}" ${defaultDir===v?'selected':''}>${escH(l)}</option>`).join('');
  const defReq = cn ? (cn.requirement||'') : `${srcName} shall interface with ${tgtName} via [Data] interface.`;

  return `
    <div class="arch-popover-hdr">
      <strong>${cn?'Edit':'New'} Interface</strong>
      <button class="arch-popover-close" id="pop-x">✕</button>
    </div>
    <div class="arch-popover-body">
      <div class="arch-popover-row">
        <span class="arch-popover-chip">${escH(srcName)}</span>
        <span class="arch-popover-arr">⇄</span>
        <span class="arch-popover-chip">${escH(tgtName)}</span>
      </div>
      <label class="arch-form-lbl">Interface Type</label>
      <select class="form-input" id="pop-itype">${ifOpts}</select>
      <label class="arch-form-lbl">Direction</label>
      <select class="form-input" id="pop-dir">${dirOpts}</select>
      <label class="arch-form-lbl">Name (optional)</label>
      <input class="form-input" id="pop-name" value="${escH(cn?.name||'')}" placeholder="e.g. CAN Bus"/>
      <label class="arch-form-lbl">Interface Requirement</label>
      <textarea class="form-input form-textarea" id="pop-req" rows="3">${escH(defReq)}</textarea>
      <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:8px">
        <input type="checkbox" id="pop-ext" ${isExt?'checked':''}/> External interface
      </label>
    </div>
    <div class="arch-popover-footer">
      ${cn?'<button class="btn btn-danger btn-sm" id="pop-del">Delete</button>':''}
      <button class="btn btn-secondary btn-sm" id="pop-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="pop-ok">${cn?'Save':'Create'}</button>
    </div>`;
}

function wireConnPop(pop, existingCn, ctx) {
  pop.querySelector('#pop-itype')?.addEventListener('change', () => {
    if (!existingCn) {
      const t = pop.querySelector('#pop-itype').value;
      pop.querySelector('#pop-req').value = `${ctx.srcName} shall interface with ${ctx.tgtName} via ${t} interface.`;
    }
  });

  const close = () => { pop.style.display='none'; };
  pop.querySelector('#pop-x').onclick      = close;
  pop.querySelector('#pop-cancel').onclick = close;

  pop.querySelector('#pop-del')?.addEventListener('click', async () => {
    const { error } = await sb.from('arch_connections').delete().eq('id', existingCn.id);
    if (error) { toast('Error: '+error.message, 'error'); return; }
    _s.connections = _s.connections.filter(c=>c.id!==existingCn.id);
    close(); renderConnections(); toast('Deleted.','success');
  });

  pop.querySelector('#pop-ok').onclick = async () => {
    const btn = pop.querySelector('#pop-ok');
    btn.disabled = true;
    const itype = pop.querySelector('#pop-itype').value;
    const dir   = pop.querySelector('#pop-dir').value;
    const name  = pop.querySelector('#pop-name').value.trim()||null;
    const req   = pop.querySelector('#pop-req').value.trim()||null;
    const ext   = pop.querySelector('#pop-ext').checked;

    let error;
    if (existingCn) {
      const patch = { interface_type:itype, direction:dir, name, requirement:req, is_external:ext, updated_at:new Date().toISOString() };
      ({ error } = await sb.from('arch_connections').update(patch).eq('id', existingCn.id));
      if (!error) Object.assign(existingCn, patch);
    } else {
      const { data, error:e } = await sb.from('arch_connections').insert({
        parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
        source_id:ctx.srcId, target_id:ctx.tgtId,
        source_port:ctx.srcPort||'right', target_port:ctx.tgtPort||'left',
        interface_type:itype, direction:dir, name, requirement:req, is_external:ext,
      }).select().single();
      error = e;
      if (!error && data) _s.connections.push(data);
    }
    btn.disabled = false;
    if (error) {
      const msg = error.message?.includes('does not exist')
        ? 'Table not found — run migration_005_architecture.sql in Supabase.'
        : 'Error: '+error.message;
      toast(msg, 'error'); return;
    }
    close(); renderConnections(); toast(existingCn?'Updated.':'Interface created.','success');
  };
}

// ── System Group creation popover ─────────────────────────────────────────────

async function showGroupCreationPopover() {
  const pop = document.getElementById('arch-sys-pop');
  if (!pop) return;

  const sysOpts = _s.projectSystems.map(s =>
    `<option value="${s.id}">${escH(s.system_code)} — ${escH(s.name)}</option>`).join('');

  pop.style.display = '';
  pop.innerHTML = `
    <div class="arch-popover-hdr">
      <strong>Add System Group</strong>
      <button class="arch-popover-close" id="syspop-x">✕</button>
    </div>
    <div class="arch-popover-body">
      <label class="arch-form-lbl">Link to existing system?</label>
      <select class="form-input" id="syspop-existing">
        <option value="">— New system (define below) —</option>
        ${sysOpts}
      </select>

      <div id="syspop-new-section">
        <label class="arch-form-lbl" style="margin-top:12px">System Name</label>
        <input class="form-input" id="syspop-name" placeholder="e.g. Braking System"/>
        <label class="arch-form-lbl">Description</label>
        <textarea class="form-input form-textarea" id="syspop-desc" rows="2" placeholder="Optional…"></textarea>
      </div>
    </div>
    <div class="arch-popover-footer">
      <button class="btn btn-secondary btn-sm" id="syspop-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="syspop-ok">Add Group</button>
    </div>`;

  const existingSel = pop.querySelector('#syspop-existing');
  const newSection  = pop.querySelector('#syspop-new-section');
  const nameInput   = pop.querySelector('#syspop-name');

  existingSel.onchange = () => {
    newSection.style.display = existingSel.value ? 'none' : '';
  };

  const close = () => { pop.style.display='none'; };
  pop.querySelector('#syspop-x').onclick      = close;
  pop.querySelector('#syspop-cancel').onclick = close;

  pop.querySelector('#syspop-ok').onclick = async () => {
    const btn = pop.querySelector('#syspop-ok');
    btn.disabled = true;

    let systemId = existingSel.value || null;
    let groupName;

    if (systemId) {
      // Link to existing system
      const sys = _s.projectSystems.find(s => s.id === systemId);
      groupName = sys?.name || 'System';
    } else {
      // Create new system in DB
      const sysName = nameInput.value.trim();
      if (!sysName) { nameInput.focus(); btn.disabled=false; return; }
      const sysDesc = pop.querySelector('#syspop-desc').value.trim();

      // Get next system code
      const { count } = await sb.from('systems')
        .select('id',{count:'exact',head:true}).eq('item_id', _s.item.id);
      const idx = (count||0)+1;
      const sysCode = `SYS-${String(idx).padStart(3,'0')}`;

      const { data:newSys, error:sysErr } = await sb.from('systems').insert({
        item_id: _s.item.id,
        system_code: sysCode,
        name: sysName,
        description: sysDesc||null,
      }).select().single();

      if (sysErr) { toast('Error creating system: '+sysErr.message,'error'); btn.disabled=false; return; }
      systemId = newSys.id;
      groupName = sysName;
      _s.projectSystems.push(newSys);
      toast(`System "${sysName}" created.`, 'success');
    }

    close();
    await createGroup(groupName, systemId);
    btn.disabled = false;
  };
}

async function createGroup(name, systemId) {
  const count = _s.components.filter(c=>c.comp_type==='Group').length;
  const { data, error } = await sb.from('arch_components').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    name, comp_type:'Group',
    x:snap(40+(count%3)*340), y:snap(40+Math.floor(count/3)*280),
    width:300, height:240, sort_order:_s.components.length,
    data: systemId ? { system_id:systemId } : {},
  }).select().single();
  if (error) { toast('Error: '+error.message,'error'); return; }
  data.functions=[];
  _s.components.push(data);
  renderGroups();
  selectComp(data.id);
  setTimeout(()=>startRename(data.id),60);
}

// ── Properties panel ──────────────────────────────────────────────────────────

function openProps(id) {
  const c = compById(id); if (!c) return;
  const section = document.getElementById('arch-props-section');
  const body    = document.getElementById('arch-props-body');
  if (!section) return;
  section.style.display='';

  // ── Port properties ───────────────────────────────────────────────────────
  if (c.comp_type === 'Port') {
    body.innerHTML = `
      <label class="arch-form-lbl">Port Name</label>
      <input class="form-input" id="props-name" value="${escH(c.name)}" style="margin-bottom:6px"/>
      <label class="arch-form-lbl">Direction</label>
      <select class="form-input" id="props-port-dir" style="margin-bottom:10px">
        <option value="in"    ${c.data?.port_dir==='in'   ?'selected':''}>in  ▶ (input)</option>
        <option value="out"   ${c.data?.port_dir==='out'  ?'selected':''}>out ◀ (output)</option>
        <option value="inout" ${(c.data?.port_dir||'inout')==='inout'?'selected':''}>inout ◆ (bidirectional)</option>
      </select>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="props-apply">Apply</button>
        <button class="btn btn-danger  btn-sm" id="props-del">Delete</button>
      </div>`;

    document.getElementById('props-close').onclick = () => { section.style.display='none'; };
    document.getElementById('props-apply').onclick = async () => {
      const name = document.getElementById('props-name').value.trim()||c.name;
      const dir  = document.getElementById('props-port-dir').value;
      c.name = name; c.data = {...(c.data||{}), port_dir:dir};
      await sb.from('arch_components').update({ name, data:c.data, updated_at:new Date().toISOString() }).eq('id',id);
      refreshComp(id); section.style.display='none'; toast('Updated.','success');
    };
    document.getElementById('props-del').onclick = () => {
      confirmDialog(`Delete port "${c.name}"?`, async () => { await deleteComp(id); section.style.display='none'; });
    };
    return;
  }

  // ── Group properties ──────────────────────────────────────────────────────
  if (c.comp_type === 'Group') {
    const linkedSys = c.data?.system_id ? _s.projectSystems.find(s=>s.id===c.data.system_id) : null;
    const sysOpts = _s.projectSystems.map(s =>
      `<option value="${s.id}" ${c.data?.system_id===s.id?'selected':''}>${escH(s.system_code)} — ${escH(s.name)}</option>`).join('');

    body.innerHTML = `
      <label class="arch-form-lbl">Name</label>
      <input class="form-input" id="props-name" value="${escH(c.name)}" style="margin-bottom:6px"/>
      <label class="arch-form-lbl">Linked System</label>
      <select class="form-input" id="props-sys-link" style="margin-bottom:10px">
        <option value="">— None —</option>
        ${sysOpts}
      </select>
      ${linkedSys ? `<div class="arch-props-sys-info">🔗 ${escH(linkedSys.system_code)} · ${escH(linkedSys.name)}</div>` : ''}
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="props-apply">Apply</button>
        <button class="btn btn-danger  btn-sm" id="props-del">Delete</button>
      </div>`;

    document.getElementById('props-close').onclick = () => { section.style.display='none'; };
    document.getElementById('props-apply').onclick = async () => {
      const name  = document.getElementById('props-name').value.trim()||c.name;
      const sysId = document.getElementById('props-sys-link').value||null;
      c.name = name; c.data = {...(c.data||{}), system_id:sysId||undefined};
      if (!sysId) delete c.data.system_id;
      await sb.from('arch_components').update({ name, data:c.data, updated_at:new Date().toISOString() }).eq('id',id);
      refreshComp(id); section.style.display='none'; toast('Updated.','success');
    };
    document.getElementById('props-del').onclick = () => {
      confirmDialog(`Delete group "${c.name}"?`, async () => { await deleteComp(id); section.style.display='none'; });
    };
    return;
  }

  // ── Block properties ──────────────────────────────────────────────────────
  body.innerHTML = `
    <label class="arch-form-lbl">Name</label>
    <input class="form-input" id="props-name" value="${escH(c.name)}" style="margin-bottom:6px"/>
    <label class="arch-form-lbl">Type</label>
    <select class="form-input" id="props-type" style="margin-bottom:6px">
      ${['HW','SW','Mechanical'].map(t=>`<option value="${t}" ${c.comp_type===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:4px">
      <input type="checkbox" id="props-safe" ${c.is_safety_critical?'checked':''}/> Safety Critical
    </label>
    <div style="margin-top:12px">
      <div class="arch-props-fun-hdr">
        <span>λ Functions</span>
        <button class="arch-tb-btn" id="props-add-fun">＋</button>
      </div>
      <div id="props-fun-list">
        ${(c.functions||[]).map(f=>`
          <div class="arch-props-fun-row">
            <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
              <input type="checkbox" class="pf-safe" data-fid="${f.id}" ${f.is_safety_related?'checked':''}/>
              <span style="font-size:11px;color:#C5221F">⚠</span>
            </label>
            <span class="arch-props-fun-name" id="pfn-${f.id}">${escH(f.name)}</span>
            <button class="btn-icon pf-ren" data-fid="${f.id}">✎</button>
            <button class="btn-icon pf-del" data-fid="${f.id}">✕</button>
          </div>`).join('')}
      </div>
      <div id="props-addfun-row" style="display:none;gap:6px;margin-top:6px">
        <input class="form-input" id="props-new-fun" placeholder="Function name…" style="flex:1"/>
        <button class="btn btn-primary btn-sm" id="props-new-fun-ok">Add</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-top:14px">
      <button class="btn btn-primary btn-sm" id="props-apply">Apply</button>
      <button class="btn btn-danger  btn-sm" id="props-del">Delete</button>
    </div>`;

  document.getElementById('props-close').onclick = () => { section.style.display='none'; };

  document.getElementById('props-apply').onclick = async () => {
    const name = document.getElementById('props-name').value.trim()||c.name;
    const type = document.getElementById('props-type').value;
    const safe = document.getElementById('props-safe').checked;
    await sb.from('arch_components').update({ name, comp_type:type, is_safety_critical:safe, updated_at:new Date().toISOString() }).eq('id',id);
    Object.assign(c, { name, comp_type:type, is_safety_critical:safe });
    refreshComp(id); section.style.display='none'; toast('Updated.','success');
  };
  document.getElementById('props-del').onclick = () => {
    confirmDialog(`Delete "${c.name}"?`, async () => { await deleteComp(id); section.style.display='none'; });
  };

  // Functions
  document.getElementById('props-add-fun').onclick = () => {
    const r = document.getElementById('props-addfun-row');
    r.style.display='flex'; document.getElementById('props-new-fun').focus();
  };
  document.getElementById('props-new-fun-ok').onclick = async () => {
    const name=document.getElementById('props-new-fun').value.trim(); if(!name) return;
    const { data, error } = await sb.from('arch_functions').insert({
      component_id:id, name, is_safety_related:false, sort_order:c.functions.length,
    }).select().single();
    if (error) { toast('Error: '+error.message,'error'); return; }
    c.functions.push(data); refreshComp(id); openProps(id);
  };
  document.getElementById('props-new-fun')?.addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('props-new-fun-ok').click();
  });
  body.querySelectorAll('.pf-safe').forEach(chk => {
    chk.onchange = async () => {
      const f=c.functions.find(fn=>fn.id===chk.dataset.fid); if(!f) return;
      f.is_safety_related=chk.checked;
      await sb.from('arch_functions').update({ is_safety_related:chk.checked }).eq('id',f.id);
      const anySafe=c.functions.some(fn=>fn.is_safety_related);
      if (anySafe!==c.is_safety_critical) {
        c.is_safety_critical=anySafe;
        await sb.from('arch_components').update({ is_safety_critical:anySafe }).eq('id',id);
      }
      refreshComp(id);
    };
  });
  body.querySelectorAll('.pf-ren').forEach(btn => {
    btn.onclick = () => {
      const f=c.functions.find(fn=>fn.id===btn.dataset.fid); if(!f) return;
      const span=document.getElementById(`pfn-${f.id}`); if(!span) return;
      const inp=document.createElement('input');
      inp.className='form-input'; inp.value=f.name; inp.style.flex='1';
      span.replaceWith(inp); inp.focus(); inp.select();
      const save=async()=>{ const n=inp.value.trim()||f.name; await sb.from('arch_functions').update({name:n}).eq('id',f.id); f.name=n; openProps(id); refreshComp(id); };
      inp.onblur=save; inp.onkeydown=e=>{if(e.key==='Enter')save();};
    };
  });
  body.querySelectorAll('.pf-del').forEach(btn => {
    btn.onclick = async () => { await deleteFun(btn.dataset.fid, id); openProps(id); };
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addComp(type) {
  if (type === 'Group') { await showGroupCreationPopover(); return; }

  const isPort = type === 'Port';
  const count  = _s.components.length;
  const w = isPort ? PORT_SIZE : 180;
  const h = isPort ? PORT_SIZE : 130;
  const x = snap(60+(count%5)*210);
  const y = snap(60+Math.floor(count/5)*180);

  const { data, error } = await sb.from('arch_components').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    name: isPort ? `P${count+1}` : `${type} Block ${count+1}`,
    comp_type:type, x, y, width:w, height:h,
    sort_order:count,
    data: isPort ? { port_dir:'inout' } : {},
  }).select().single();
  if (error) {
    const msg = error.message?.includes('does not exist')
      ? 'Table not found — run migration_005_architecture.sql in Supabase.'
      : 'Error: '+error.message;
    toast(msg,'error'); return;
  }
  data.functions=[];
  _s.components.push(data);
  const layer=document.getElementById('arch-comp-layer');
  if (layer) {
    layer.insertAdjacentHTML('beforeend', isPort ? portHTML(data) : blockHTML(data));
    wireBlock(data.id);
  }
  selectComp(data.id);
  if (!isPort) setTimeout(()=>startRename(data.id),60);
}

async function deleteComp(id) {
  await sb.from('arch_components').delete().eq('id',id);
  _s.components  = _s.components.filter(c=>c.id!==id);
  _s.connections = _s.connections.filter(cn=>cn.source_id!==id&&cn.target_id!==id);
  document.getElementById(`comp-${id}`)?.remove();
  selectComp(null); renderConnections(); toast('Deleted.','success');
}

async function deleteFun(funId, compId) {
  await sb.from('arch_functions').delete().eq('id',funId);
  const c=compById(compId); if(c) c.functions=c.functions.filter(f=>f.id!==funId);
  refreshComp(compId);
}

async function savePositions() {
  const btn=document.getElementById('btn-arch-save'); if(btn) btn.disabled=true;
  await Promise.all(_s.components.map(c=>
    sb.from('arch_components').update({ x:c.x,y:c.y,width:c.width,height:c.height,updated_at:new Date().toISOString() }).eq('id',c.id)
  ));
  if(btn) btn.disabled=false; toast('Saved.','success');
}

// ── Selection / refresh ───────────────────────────────────────────────────────

function selectComp(id) {
  _s.selected=id;
  document.querySelectorAll('.arch-block,.arch-group,.arch-port-block').forEach(el=>{
    const cls = el.classList.contains('arch-block') ? 'arch-block--sel'
              : el.classList.contains('arch-group')  ? 'arch-group--sel'
              : 'arch-port-block--sel';
    el.classList.toggle(cls, el.dataset.id===id);
  });
}

function refreshComp(id) {
  const c=compById(id); if(!c) return;
  const el=document.getElementById(`comp-${id}`); if(!el) return;
  if (c.comp_type==='Group') { el.outerHTML=groupHTML(c); wireGroup(id); }
  else if (c.comp_type==='Port') { el.outerHTML=portHTML(c); wireBlock(id); }
  else { el.outerHTML=blockHTML(c); wireBlock(id); }
}

function startRename(id) {
  const c=compById(id); if(!c) return;
  const nameEl=document.getElementById(`cname-${id}`); if(!nameEl) return;
  const inp=document.createElement('input');
  inp.className='arch-rename-input'; inp.value=c.name;
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  const save=async()=>{ const n=inp.value.trim()||c.name; c.name=n; await sb.from('arch_components').update({name:n,updated_at:new Date().toISOString()}).eq('id',id); refreshComp(id); };
  inp.onblur=save; inp.onkeydown=e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')refreshComp(id);};
}

function fitView() {
  if(!_s.components.length){_s.zoom=1;_s.panX=20;_s.panY=20;applyViewport();return;}
  const outer=document.getElementById('arch-outer'); if(!outer) return;
  const ow=outer.clientWidth, oh=outer.clientHeight;
  const xs=_s.components.map(c=>c.x), ys=_s.components.map(c=>c.y);
  const xe=_s.components.map(c=>c.x+c.width), ye=_s.components.map(c=>c.y+c.height);
  const pad=60;
  _s.zoom=Math.min(2,Math.min((ow-pad*2)/(Math.max(...xe)-Math.min(...xs)||1),(oh-pad*2)/(Math.max(...ye)-Math.min(...ys)||1)));
  _s.panX=pad-Math.min(...xs)*_s.zoom; _s.panY=pad-Math.min(...ys)*_s.zoom;
  applyViewport();
}

function compById(id) { return _s.components.find(c=>c.id===id); }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
