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
import { toast, toastPersist, toastDismiss } from '../toast.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { getFeaturesTree, ICONS as IDEF_ICONS } from './item-definition.js';
import { nextIndex, buildCode, nameInitials } from '../config.js';

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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
const CONN_EP_SIZE = 18; // port square size at connection endpoints

// ── State ─────────────────────────────────────────────────────────────────────

let _s = null;

// ── Undo stack ────────────────────────────────────────────────────────────────
const _undoStack = [];
const MAX_UNDO   = 10;

function captureUndo() {
  if (!_s) return;
  _undoStack.push({
    components:  _s.components.map(c => ({ ...c, functions: [...(c.functions||[])] })),
    connections: _s.connections.map(cn => ({ ...cn })),
  });
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
}

async function undoLast() {
  if (!_undoStack.length) { toast('Nothing to undo.','info'); return; }
  toastPersist('Undoing…', 'info');
  const snap = _undoStack.pop();

  const snapCompIds = new Set(snap.components.map(c => c.id));
  const currCompIds = new Set(_s.components.map(c => c.id));
  const snapConnIds = new Set(snap.connections.map(c => c.id));
  const currConnIds = new Set(_s.connections.map(c => c.id));

  // Delete items that didn't exist in the snapshot
  const delComps = [...currCompIds].filter(id => !snapCompIds.has(id));
  const delConns = [...currConnIds].filter(id => !snapConnIds.has(id));
  if (delComps.length) await sb.from('arch_components').delete().in('id', delComps);
  if (delConns.length) await sb.from('arch_connections').delete().in('id', delConns);

  // Upsert all snapshot components (restores position, name, data, type, etc.)
  for (const c of snap.components) {
    const { functions: _f, ...row } = c;
    await sb.from('arch_components').upsert({ ...row, updated_at: new Date().toISOString() });
  }
  // Upsert all snapshot connections
  for (const cn of snap.connections) {
    await sb.from('arch_connections').upsert({ ...cn, updated_at: new Date().toISOString() });
  }

  _s.components  = snap.components;
  _s.connections = snap.connections;
  selectComp(null, true);
  _selectedConnId = null;
  renderAll();
  showPropsEmpty();
  toastDismiss();
  toast('Undo complete.', 'success');
}

// ── Item Definition panel state ───────────────────────────────────────────────
let _idef = { loaded: false, parentType: 'item', parentId: null,
              features: [], useCases: [], functions: [],
              selFeatId: null, selUCId: null };

// ── Architecture Landing ──────────────────────────────────────────────────────

function renderArchLanding(container, { item, system, pages = [] }) {
  const parentName = system?.name || item?.name;
  const getHref = name => {
    const pg = pages.find(p => p.name === name);
    return pg ? `${window.location.hash.replace(/#/, '').replace(/\/page\/[^/]+$/, '')}/page/${pg.id}` : '#';
  };
  const conceptHref = getHref('Architecture Concept');
  const specHref    = getHref('Architecture Specification');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>Architecture</h1>
          <p class="text-muted">${parentName}</p>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="arch-landing">
        <a class="arch-landing-card" href="#${conceptHref}">
          <div class="arch-landing-icon">◈</div>
          <div class="arch-landing-title">Architecture Concept</div>
          <div class="arch-landing-desc">Visual block diagram canvas with drag-and-drop components, system groups, connections and interface allocation.</div>
          <div class="arch-landing-arrow">Open →</div>
        </a>
        <a class="arch-landing-card" href="#${specHref}">
          <div class="arch-landing-icon">📐</div>
          <div class="arch-landing-title">Architecture Specification</div>
          <div class="arch-landing-desc">Formal specification items with natural language descriptions and lightweight UML diagrams (component, state, use case, class).</div>
          <div class="arch-landing-arrow">Open →</div>
        </a>
      </div>
    </div>
  `;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderArchitecture(container, { project, item, system, domain = 'default', pageId = null }) {
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;

  // ── No sub-page selected → show landing + auto-create sub-pages ─────────────
  if (!pageId) {
    container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';
    const navDomain = parentType === 'item' ? 'item' : 'system';

    // Ensure both sub-pages exist
    const { data: existing } = await sb.from('nav_pages').select('id,name')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', navDomain).eq('phase', 'architecture');

    const names   = (existing || []).map(p => p.name);
    const inserts = [];
    if (!names.includes('Architecture Concept'))       inserts.push({ name: 'Architecture Concept',       sort_order: 0 });
    if (!names.includes('Architecture Specification')) inserts.push({ name: 'Architecture Specification', sort_order: 1 });

    if (inserts.length) {
      await sb.from('nav_pages').insert(inserts.map((p, i) => ({
        parent_type: parentType, parent_id: parentId,
        domain: navDomain, phase: 'architecture',
        name: p.name, sort_order: p.sort_order,
      })));
      window.dispatchEvent(new Event('hashchange'));
    }

    // Fetch final page list for link building
    const { data: pages } = await sb.from('nav_pages').select('id,name')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', navDomain).eq('phase', 'architecture')
      .order('sort_order');

    renderArchLanding(container, { item, system, pages });
    return;
  }

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
    dragging: null, resizing: null, connecting: null, draggingEndpoint: null,
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
  const ifaceLegendRows = Object.entries(IFACE).map(([k,v]) => `
    <div class="arch-iface-legend-row">
      <svg width="28" height="10" style="flex-shrink:0">
        <line x1="0" y1="5" x2="28" y2="5" stroke="${v.stroke}"
              stroke-width="${v.weight}" stroke-dasharray="${v.dash}"/>
      </svg>
      <span class="arch-iface-legend-icon">${v.icon}</span>
      <span class="arch-iface-legend-label">${k}</span>
    </div>`).join('');

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
          <button class="arch-tb-btn" id="btn-arch-frame" title="Architecture Frame tree">🗂 Frame</button>
          <button class="arch-tb-btn" id="btn-arch-idef" title="Item Definition panel">★ Item Def</button>
          <button class="arch-tb-btn" id="btn-arch-ifreqs" title="Interface Requirements panel">⇄ Interfaces</button>
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

          <!-- Floating legend widget -->
          <div class="arch-iface-widget" id="arch-iface-widget">
            <div class="arch-iface-widget-hdr" id="arch-iface-drag-hdr" style="cursor:move">
              <button class="arch-iface-widget-toggle" id="arch-iface-toggle" title="Toggle legend">?</button>
              <span class="arch-iface-widget-title">Legend</span>
            </div>
            <div class="arch-iface-widget-body" id="arch-iface-body">${ifaceLegendRows}</div>
          </div>
        </div>

        <!-- Right palette -->
        <div class="arch-palette" id="arch-palette">
        <div class="arch-palette-resize-handle" id="arch-pal-resize"></div>

          <!-- ── Add Block section ── -->
          <div class="arch-pal-sec">
            <button class="arch-pal-sec-hdr" data-target="pal-body-add" data-arrow="pal-arrow-add">
              <span>Add Block</span>
              <span class="arch-pal-arrow" id="pal-arrow-add">▾</span>
            </button>
            <div class="arch-pal-sec-body" id="pal-body-add">
              <div class="arch-palette-items" style="padding:8px">
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
          </div>

          <!-- ── Properties section ── -->
          <div class="arch-pal-sec arch-pal-sec--props">
            <button class="arch-pal-sec-hdr" data-target="pal-body-props" data-arrow="pal-arrow-props">
              <span>Properties</span>
              <span class="arch-pal-arrow" id="pal-arrow-props">▾</span>
            </button>
            <div class="arch-pal-sec-body arch-pal-sec-body--props" id="pal-body-props">
              <div id="arch-props-body">
                <div class="arch-props-empty">↖ Select an element</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div class="arch-conn-popover" id="arch-sys-pop" style="display:none"></div>
      <div class="arch-fun-tooltip" id="arch-fun-tooltip" style="display:none"></div>

      <!-- Frame tree panel -->
      <div class="arch-frame-panel" id="arch-frame-panel" style="display:none">
        <div class="arch-frame-hdr">
          <span class="arch-frame-title">🗂 Architecture Frame</span>
          <button class="arch-tb-btn" id="arch-frame-close">✕</button>
        </div>
        <div class="arch-frame-body" id="arch-frame-body"></div>
      </div>

      <!-- Interface Requirements panel (bottom) -->
      <div class="arch-idef-panel arch-ifreqs-panel" id="arch-ifreqs-panel" style="display:none">
        <div class="arch-idef-resize-bar" id="arch-ifreqs-resize-bar" title="Drag to resize"></div>
        <div class="arch-idef-hdr">
          <span class="arch-idef-title">⇄ Interface Requirements</span>
          <button class="arch-tb-btn" id="arch-ifreqs-close" title="Close">✕</button>
        </div>
        <div class="arch-idef-body" id="arch-ifreqs-body">
          <div class="arch-idef-loading">Loading…</div>
        </div>
      </div>

      <!-- Item Definition panel (bottom) -->
      <div class="arch-idef-panel" id="arch-idef-panel">
        <div class="arch-idef-resize-bar" id="arch-idef-resize-bar" title="Drag to resize"></div>
        <div class="arch-idef-hdr">
          <span class="arch-idef-title">★ Item Definition <span class="arch-idef-hint">— drag a function onto a component to assign it</span></span>
          <button class="arch-tb-btn" id="arch-idef-close" title="Close">✕</button>
        </div>
        <div class="arch-idef-body" id="arch-idef-body">
          <div class="arch-idef-loading">Loading…</div>
        </div>
      </div>
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
      ?.addEventListener('click', e => { e.stopPropagation(); selectConn(cn.id); });
    document.getElementById(`conn-del-${cn.id}`)
      ?.addEventListener('click', async e => { e.stopPropagation(); await deleteConn(cn.id); });
  });
  // Wire endpoint drag handles
  g.querySelectorAll('.arch-conn-ep').forEach(ep => {
    ep.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const cn = _s.connections.find(c => c.id === ep.dataset.connId); if (!cn) return;
      const compId = ep.dataset.endpoint === 'source' ? cn.source_id : cn.target_id;
      captureUndo();
      _s.draggingEndpoint = { connId: cn.id, endpoint: ep.dataset.endpoint, compId };
    });
  });
  // Re-apply selection highlight
  if (_selectedConnId) {
    document.getElementById(`conn-${_selectedConnId}`)?.classList.add('arch-conn-g--sel');
  }
}

// ── Group HTML ────────────────────────────────────────────────────────────────

function groupHTML(g) {
  const linkedSys = g.data?.system_id
    ? _s.projectSystems.find(s => s.id === g.data.system_id) : null;
  const sysLabel = linkedSys
    ? `<span class="arch-group-sysref" title="Linked system">${escH(linkedSys.system_code)}</span>` : '';
  const funs = g.functions || [];
  const funStrip = `
    <div class="arch-group-funs" id="funlist-${g.id}">
      ${funs.map(f => `
        <div class="arch-fun-box arch-fun-box--group ${f.is_safety_related ? 'arch-fun-box--safe' : ''}"
             data-fun-id="${f.id}" data-comp-id="${g.id}"${funTooltipAttrs(f)}>
          <span class="arch-fun-box-label">f</span>
          <span class="arch-fun-box-name">${escH(f.name)}</span>
          ${f.is_safety_related ? '<span class="arch-fun-box-warn">⚠</span>' : ''}
          <button class="arch-fun-del" data-fun-id="${f.id}" data-comp-id="${g.id}" title="Remove">✕</button>
        </div>`).join('')}
      <button class="arch-addfun-btn" data-comp-id="${g.id}">+ Add function</button>
    </div>`;

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
      ${funStrip}
      <button class="arch-del-badge" data-del-id="${g.id}" title="Delete (Del)">✕</button>
      <div class="arch-resize-handle arch-resize-handle--se" data-corner="se" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--sw" data-corner="sw" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--ne" data-corner="ne" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--nw" data-corner="nw" data-comp-id="${g.id}"></div>
      <div class="arch-port arch-port--top"    data-comp-id="${g.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${g.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${g.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${g.id}" data-port="left"></div>
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
      <button class="arch-del-badge arch-del-badge--port" data-del-id="${c.id}" title="Delete (Del)">✕</button>
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

  const funItems = `
    ${funs.map(f => `
        <div class="arch-fun-box ${f.is_safety_related ? 'arch-fun-box--safe' : ''}"
             data-fun-id="${f.id}" data-comp-id="${c.id}"${funTooltipAttrs(f)}>
          <span class="arch-fun-box-label">f</span>
          <span class="arch-fun-box-name">${escH(f.name)}</span>
          ${f.is_safety_related ? '<span class="arch-fun-box-warn">⚠</span>' : ''}
          <button class="arch-fun-del" data-fun-id="${f.id}" data-comp-id="${c.id}" title="Remove">✕</button>
        </div>`).join('')}
    <button class="arch-addfun-btn" data-comp-id="${c.id}">+ Add function</button>`;

  return `
    <div class="arch-block ${sel ? 'arch-block--sel' : ''} ${safe ? 'arch-block--safe' : ''}"
         id="comp-${c.id}" data-id="${c.id}" data-type="${c.comp_type}"
         style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;
                border-color:${safe ? '#C5221F' : st.border}">
      <div class="arch-block-hdr" data-drag-id="${c.id}" style="background:${st.hdr}">
        <span class="arch-block-stereo">«${st.stereotype}»</span>
        <span class="arch-block-name" id="cname-${c.id}">${escH(c.name)}</span>
        ${safe ? '<span class="arch-block-safe-ico">⚠</span>' : ''}
      </div>
      <button class="arch-del-badge" data-del-id="${c.id}" title="Delete (Del)">✕</button>
      <div class="arch-block-type-row" style="background:${st.bg}">
        <span class="arch-block-type-badge" style="color:${st.border}">${c.comp_type}</span>
      </div>
      <div class="arch-block-funs" id="funlist-${c.id}">${funItems}</div>
      <div class="arch-port arch-port--top"    data-comp-id="${c.id}" data-port="top"></div>
      <div class="arch-port arch-port--right"  data-comp-id="${c.id}" data-port="right"></div>
      <div class="arch-port arch-port--bottom" data-comp-id="${c.id}" data-port="bottom"></div>
      <div class="arch-port arch-port--left"   data-comp-id="${c.id}" data-port="left"></div>
      <div class="arch-resize-handle arch-resize-handle--se" data-corner="se" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--sw" data-corner="sw" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--ne" data-corner="ne" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--nw" data-corner="nw" data-comp-id="${c.id}"></div>
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
  // No arrowheads on lines — direction is shown by the port squares
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

  // Port squares at BOTH endpoints, always visible
  // Arrow direction depends on SIDE of the component and whether this endpoint sends or receives.
  // Input  → arrow tip points INTO the component: top=↓  bottom=↑  left=→  right=←
  // Output → arrow tip points OUT OF component:   top=↑  bottom=↓  left=←  right=→
  // Bidirectional: top/bottom=↕  left/right=↔
  const ps = CONN_EP_SIZE;
  const fs = 11;
  const ARROW_IN  = { top:'↓', bottom:'↑', left:'→', right:'←' };
  const ARROW_OUT = { top:'↑', bottom:'↓', left:'←', right:'→' };
  const ARROW_BI  = { top:'↕', bottom:'↕', left:'↔', right:'↔' };
  function epArrow(isSrcSide, portStr) {
    const side = portSide(portStr) || 'right';
    if (cn.direction === 'bidirectional') return ARROW_BI[side] || '↔';
    const srcSends = cn.direction === 'A_to_B';
    const thisSends = isSrcSide ? srcSends : !srcSends;
    return (thisSends ? ARROW_OUT : ARROW_IN)[side] || (thisSends ? '→' : '←');
  }
  // Offset square outward from component edge so it sits ON the border, not inside
  function squareOffset(portStr) {
    const side = portSide(portStr);
    const h = ps / 2;
    if (side === 'top')    return [0, -h];
    if (side === 'bottom') return [0,  h];
    if (side === 'left')   return [-h, 0];
    return [h, 0]; // right
  }
  function portSquare(px, py, portStr, arrowChar) {
    const [ox, oy] = squareOffset(portStr);
    const cx = px + ox, cy = py + oy;
    return `
      <rect x="${cx - ps/2}" y="${cy - ps/2}" width="${ps}" height="${ps}" rx="3"
            fill="#212121" stroke="#fff" stroke-width="1.5" style="pointer-events:none"/>
      <text x="${cx}" y="${cy + fs*0.38}" text-anchor="middle" font-size="${fs}" fill="#fff"
            font-family="system-ui" font-weight="bold" style="pointer-events:none">${arrowChar}</text>`;
  }
  const portIcon = portSquare(sx, sy, cn.source_port, epArrow(true, cn.source_port))
                 + portSquare(tx, ty, cn.target_port, epArrow(false, cn.target_port));

  const isSel = _selectedConnId === cn.id;
  // Draggable endpoint handles (visible only when selected, overlay on port squares)
  function epRect(px, py, portStr, epEndpoint) {
    const [ox, oy] = squareOffset(portStr);
    const cx = px + ox, cy = py + oy;
    return `<rect class="arch-conn-ep" x="${cx-ps/2}" y="${cy-ps/2}"
      width="${ps}" height="${ps}" rx="3" fill="rgba(26,115,232,0.35)" stroke="#1A73E8" stroke-width="2"
      data-conn-id="${cn.id}" data-endpoint="${epEndpoint}" style="pointer-events:all;cursor:grab"/>`;
  }
  const epSrc = epRect(sx, sy, cn.source_port, 'source');
  const epTgt = epRect(tx, ty, cn.target_port, 'target');
  return `
    <g id="conn-${cn.id}" class="arch-conn-g${isSel?' arch-conn-g--sel':''}">
      <path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
      <path d="${d}" fill="none" stroke="${iv.stroke}" stroke-width="${iv.weight}"
            stroke-dasharray="${iv.dash}"/>
      <circle cx="${mx}" cy="${my}" r="9" fill="${iv.stroke}" opacity="0.18"/>
      <text x="${mx}" y="${my+4}" text-anchor="middle" class="arch-conn-icon">${iv.icon}</text>
      ${label}
      ${ext}
      ${portIcon}
      ${epSrc}${epTgt}
      <g class="arch-conn-del-btn" id="conn-del-${cn.id}">
        <circle cx="${mx+18}" cy="${my-18}" r="8" fill="#C5221F" stroke="#fff" stroke-width="1.5"/>
        <text x="${mx+18}" y="${my-14}" text-anchor="middle" font-size="11" fill="#fff"
              font-weight="bold" style="pointer-events:none">×</text>
      </g>
    </g>`;
}

// ── Math ──────────────────────────────────────────────────────────────────────

// port string: "side" (legacy) or "side:fraction" (0.0–1.0 along that edge)
function portAbs(comp, portStr) {
  const sz = comp.comp_type === 'Port' ? PORT_SIZE : null;
  const w = sz || comp.width, h = sz || comp.height;
  const [side, fracStr] = portStr?.includes(':') ? portStr.split(':') : [portStr, '0.5'];
  const f = Math.max(0, Math.min(1, parseFloat(fracStr ?? 0.5) || 0.5));
  switch (side) {
    case 'top':    return [comp.x + w * f, comp.y];
    case 'bottom': return [comp.x + w * f, comp.y + h];
    case 'left':   return [comp.x,          comp.y + h * f];
    case 'right':  return [comp.x + w,      comp.y + h * f];
    default:       return [comp.x + w,      comp.y + h * 0.5];
  }
}

function portSide(portStr) { return portStr?.split(':')[0] || 'right'; }

function bezier(x1,y1,p1,x2,y2,p2) {
  const s1 = portSide(p1), s2 = portSide(p2);
  const len = Math.max(50, Math.hypot(x2-x1,y2-y1)*0.4);
  const off = {top:[0,-len],right:[len,0],bottom:[0,len],left:[-len,0]};
  const [cx1,cy1] = [x1+(off[s1]?.[0]??len), y1+(off[s1]?.[1]??0)];
  const [cx2,cy2] = [x2+(off[s2]?.[0]??-len), y2+(off[s2]?.[1]??0)];
  return `M${x1} ${y1} C${cx1} ${cy1},${cx2} ${cy2},${x2} ${y2}`;
}

function snap(v) { return Math.round(v/GRID)*GRID; }

// Returns "side:fraction" for the perimeter point closest to (cx,cy) in canvas coords
function nearestPerimeterPoint(comp, cx, cy) {
  const w = comp.comp_type==='Port' ? PORT_SIZE : comp.width;
  const h = comp.comp_type==='Port' ? PORT_SIZE : comp.height;
  const rx = cx - comp.x, ry = cy - comp.y;
  const c01 = v => Math.max(0.001, Math.min(0.999, v));
  const dTop = Math.abs(ry), dBottom = Math.abs(ry - h);
  const dLeft = Math.abs(rx), dRight = Math.abs(rx - w);
  const mn = Math.min(dTop, dBottom, dLeft, dRight);
  if (mn === dTop)    return `top:${c01(rx/w).toFixed(3)}`;
  if (mn === dBottom) return `bottom:${c01(rx/w).toFixed(3)}`;
  if (mn === dLeft)   return `left:${c01(ry/h).toFixed(3)}`;
  return `right:${c01(ry/h).toFixed(3)}`;
}

function canvasPos(e) {
  const r = document.getElementById('arch-outer').getBoundingClientRect();
  return { x:(e.clientX-r.left-_s.panX)/_s.zoom, y:(e.clientY-r.top-_s.panY)/_s.zoom };
}

// ── Properties panel helpers ──────────────────────────────────────────────────

function showPropsPanel(html) {
  const body = document.getElementById('arch-props-body');
  if (!body) return;
  body.innerHTML = html;
  // Auto-expand props section
  const wrap = document.getElementById('pal-body-props');
  if (wrap && wrap.style.display === 'none') {
    wrap.style.display = '';
    const arrow = document.getElementById('pal-arrow-props');
    if (arrow) arrow.textContent = '▾';
  }
}

function showPropsEmpty() {
  const body = document.getElementById('arch-props-body');
  if (body) body.innerHTML = `<div class="arch-props-empty">↖ Select an element</div>`;
}

// ── Auto port creation ────────────────────────────────────────────────────────

async function createAttachedPort(blockId, portSide, dir) {
  const blk = compById(blockId); if (!blk) return null;
  const [px, py] = portAbs(blk, portSide);
  const { data, error } = await sb.from('arch_components').insert({
    parent_type: _s.parentType, parent_id: _s.parentId, project_id: _s.project.id,
    name: `${blk.name.substring(0,4)}.${portSide[0].toUpperCase()}`,
    comp_type: 'Port',
    x: Math.round(px - PORT_SIZE / 2),
    y: Math.round(py - PORT_SIZE / 2),
    width: PORT_SIZE, height: PORT_SIZE,
    sort_order: _s.components.length,
    data: { parent_block_id: blockId, attached_side: portSide, port_dir: dir },
  }).select().single();
  if (error || !data) return null;
  data.functions = [];
  _s.components.push(data);
  const layer = document.getElementById('arch-comp-layer');
  if (layer) { layer.insertAdjacentHTML('beforeend', portHTML(data)); wireBlock(data.id); }
  return data;
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
  // Frame tree toggle
  document.getElementById('btn-arch-frame')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-frame-panel');
    if (!panel) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : '';
    if (!open) renderFrameTree();
  });
  document.getElementById('arch-frame-close')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-frame-panel');
    if (panel) panel.style.display = 'none';
  });

  // Interface Requirements panel toggle + resize
  document.getElementById('btn-arch-ifreqs')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-ifreqs-panel');
    if (!panel) return;
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? '' : 'none';
    if (opening) loadIfaceReqs();
  });
  document.getElementById('arch-ifreqs-close')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-ifreqs-panel');
    if (panel) panel.style.display = 'none';
  });
  const ifreqsPanel = document.getElementById('arch-ifreqs-panel');
  const ifreqsResizeBar = document.getElementById('arch-ifreqs-resize-bar');
  if (ifreqsPanel && ifreqsResizeBar) {
    let drag = null;
    ifreqsResizeBar.addEventListener('pointerdown', e => {
      e.preventDefault();
      drag = { startY: e.clientY, origH: ifreqsPanel.offsetHeight };
      ifreqsResizeBar.setPointerCapture(e.pointerId);
    });
    ifreqsResizeBar.addEventListener('pointermove', e => {
      if (!drag) return;
      const h = Math.max(100, Math.min(600, drag.origH - (e.clientY - drag.startY)));
      ifreqsPanel.style.height = h + 'px';
    });
    ifreqsResizeBar.addEventListener('pointerup', () => { drag = null; });
  }

  // Item Definition panel toggle
  document.getElementById('btn-arch-idef')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-idef-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('arch-idef-close')?.addEventListener('click', () => {
    const panel = document.getElementById('arch-idef-panel');
    if (panel) panel.style.display = 'none';
  });

  // Idef panel vertical resize via top drag bar
  const idefPanel = document.getElementById('arch-idef-panel');
  const idefResizeBar = document.getElementById('arch-idef-resize-bar');
  if (idefPanel && idefResizeBar) {
    let idefDrag = null;
    idefResizeBar.addEventListener('pointerdown', e => {
      e.preventDefault();
      idefDrag = { startY: e.clientY, origH: idefPanel.offsetHeight };
      idefResizeBar.setPointerCapture(e.pointerId);
    });
    idefResizeBar.addEventListener('pointermove', e => {
      if (!idefDrag) return;
      const h = Math.max(100, Math.min(600, idefDrag.origH - (e.clientY - idefDrag.startY)));
      idefPanel.style.height = h + 'px';
    });
    idefResizeBar.addEventListener('pointerup', () => { idefDrag = null; });
  }

  // Load idef data
  loadIdefData();

  // Drop target: assign idef function to component by dragging from bottom panel
  const canvasOuter = document.getElementById('arch-outer');
  if (canvasOuter) {
    let _dragHoverEl = null;
    const clearDragHover = () => {
      if (_dragHoverEl) { _dragHoverEl.classList.remove('arch-fn-drop-hover'); _dragHoverEl = null; }
    };
    canvasOuter.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      // Find the specific component under cursor
      const under = document.elementsFromPoint(e.clientX, e.clientY);
      const tComp = under.find(el =>
        (el.classList?.contains('arch-block') || el.classList?.contains('arch-group') ||
         el.classList?.contains('arch-port-block')) && el.dataset.id);
      if (tComp !== _dragHoverEl) {
        clearDragHover();
        if (tComp) { tComp.classList.add('arch-fn-drop-hover'); _dragHoverEl = tComp; }
      }
    });
    canvasOuter.addEventListener('dragleave', e => {
      // Only clear if leaving the canvas entirely
      if (!canvasOuter.contains(e.relatedTarget)) clearDragHover();
    });
    canvasOuter.addEventListener('drop', e => {
      clearDragHover();
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch(_) { return; }
      if (payload.type !== 'idef-fn') return;
      // Find component under drop point
      const under = document.elementsFromPoint(e.clientX, e.clientY);
      const tComp = under.find(el =>
        (el.classList?.contains('arch-block') || el.classList?.contains('arch-group') ||
         el.classList?.contains('arch-port-block')) && el.dataset.id);
      if (!tComp) { toast('Drop onto a component or system block.', 'info'); return; }
      idefAssignFn(payload.fnId, payload.fnName, payload.ucId, tComp.dataset.id);
    });

    // Fun-box tooltip (event delegation on canvas)
    const funTip = document.getElementById('arch-fun-tooltip');
    if (funTip) {
      canvasOuter.addEventListener('mouseover', e => {
        const box = e.target.closest('.arch-fun-box');
        if (!box || !box.dataset.funtip) { funTip.style.display = 'none'; return; }
        let tip; try { tip = JSON.parse(box.dataset.funtip); } catch(_) { return; }
        const rows = [
          tip.feat ? `<div class="arch-funtip-row"><span class="arch-funtip-lbl">Feature</span><span class="arch-funtip-val">${escH(tip.feat)}</span></div>` : '',
          tip.uc   ? `<div class="arch-funtip-row"><span class="arch-funtip-lbl">Use Case</span><span class="arch-funtip-val">${escH(tip.uc)}</span></div>` : '',
          tip.desc ? `<div class="arch-funtip-row arch-funtip-desc"><span class="arch-funtip-lbl">Description</span><span class="arch-funtip-val">${escH(tip.desc)}</span></div>` : '',
        ].filter(Boolean).join('');
        if (!rows) return;
        funTip.innerHTML = rows;
        const r = box.getBoundingClientRect();
        const cr = canvasOuter.getBoundingClientRect();
        funTip.style.display = 'block';
        funTip.style.left = (r.left - cr.left) + 'px';
        funTip.style.top  = (r.bottom - cr.top + 6) + 'px';
      });
      canvasOuter.addEventListener('mouseout', e => {
        if (!e.relatedTarget?.closest('.arch-fun-box')) funTip.style.display = 'none';
      });
    }
  }

  // Palette resize handle
  const pal = document.getElementById('arch-palette');
  const palHandle = document.getElementById('arch-pal-resize');
  if (pal && palHandle) {
    let presize = null;
    palHandle.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      presize = { startX: e.clientX, origW: pal.offsetWidth };
      palHandle.setPointerCapture(e.pointerId);
    });
    palHandle.addEventListener('pointermove', e => {
      if (!presize) return;
      const w = Math.max(180, Math.min(420, presize.origW - (e.clientX - presize.startX)));
      pal.style.width = w + 'px';
    });
    palHandle.addEventListener('pointerup', () => { presize = null; });
  }

  document.querySelectorAll('.arch-pal-item').forEach(btn => {
    btn.addEventListener('click', () => addComp(btn.dataset.type));
  });

  // Collapsible palette sections
  document.querySelectorAll('.arch-pal-sec-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const bodyId  = hdr.dataset.target;
      const arrowId = hdr.dataset.arrow;
      const body  = document.getElementById(bodyId);
      const arrow = document.getElementById(arrowId);
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display  = open ? 'none' : '';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
    });
  });

  // Floating legend toggle
  document.getElementById('arch-iface-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('arch-iface-body');
    const widget = document.getElementById('arch-iface-widget');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    widget?.classList.toggle('arch-iface-widget--collapsed', open);
  });

  // Legend widget drag
  const legendWidget = document.getElementById('arch-iface-widget');
  const legendHdr    = document.getElementById('arch-iface-drag-hdr');
  if (legendWidget && legendHdr) {
    let ldrag = null;
    legendHdr.addEventListener('pointerdown', e => {
      if (e.target.id === 'arch-iface-toggle') return;
      e.preventDefault(); e.stopPropagation();
      const r = legendWidget.getBoundingClientRect();
      const outerR = document.getElementById('arch-outer').getBoundingClientRect();
      ldrag = { startX: e.clientX, startY: e.clientY,
                origLeft: r.left - outerR.left, origTop: r.top - outerR.top };
      legendHdr.setPointerCapture(e.pointerId);
    });
    legendHdr.addEventListener('pointermove', e => {
      if (!ldrag) return;
      const dx = e.clientX - ldrag.startX, dy = e.clientY - ldrag.startY;
      legendWidget.style.left   = Math.max(4, ldrag.origLeft + dx) + 'px';
      legendWidget.style.top    = Math.max(4, ldrag.origTop  + dy) + 'px';
      legendWidget.style.bottom = 'auto';
    });
    legendHdr.addEventListener('pointerup', () => { ldrag = null; });
  }
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
    if (_s?.dragging)         handleDragMove(e);
    if (_s?.resizing)         handleResizeMove(e);
    if (_s?.draggingEndpoint) handleEndpointMove(e);
  };
  const onUp = e => {
    if (_s?.dragging)   handleDragEnd(e);
    if (_s?.resizing) {
      const { id } = _s.resizing;
      _s.resizing = null;
      const c = compById(id);
      const now = new Date().toISOString();
      if (c) sb.from('arch_components').update({ x:c.x, y:c.y, width:c.width, height:c.height, updated_at:now }).eq('id', id);
      // Also save group if it was auto-expanded
      if (c && !c.comp_type?.includes('Group') && c.data?.group_id) {
        const grp = compById(c.data.group_id);
        if (grp) sb.from('arch_components').update({ x:grp.x, y:grp.y, width:grp.width, height:grp.height, updated_at:now }).eq('id', grp.id);
      }
      document.querySelectorAll('.arch-group--expand-hint').forEach(el => el.classList.remove('arch-group--expand-hint'));
    }
    if (_s?.draggingEndpoint) handleEndpointEnd(e);
    if (_s?.connecting)       handleConnectEnd(e);
  };
  const onKey = e => {
    if (!_s) return;
    const active = document.activeElement;
    const notInput = active === document.body || active?.tagName === 'SVG' ||
                     active?.closest?.('.arch-canvas-outer');
    if ((e.key==='Delete'||e.key==='Backspace') && notInput) {
      if (_selectedConnId) deleteConn(_selectedConnId);
      else if (_s.selected) deleteComp(_s.selected);
    }
    if (e.key==='Escape') { cancelConnect(); selectComp(null); showPropsEmpty(); }
    if ((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z')) { e.preventDefault(); undoLast(); }
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
    if (e.target.closest('.arch-resize-handle,.arch-group-info-btn,.arch-port,.arch-fun-del,.arch-addfun-btn')) return;
    selectComp(id);
  });
  el.querySelector('[data-drag-id]')?.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-group-info-btn,.arch-addfun-btn')) return;
    e.stopPropagation(); e.preventDefault();
    const g = compById(id); if (!g) return;
    captureUndo();
    selectComp(id);
    const pos = canvasPos(e);
    // Include all non-group components that either:
    //   a) already have group_id pointing to this group, OR
    //   b) are geometrically inside this group's bounds (orphaned / never individually moved)
    const childrenForDrag = _s.components.filter(c =>
      c.comp_type !== 'Group' && (
        c.data?.group_id === id ||
        (c.x + c.width/2  > g.x && c.x + c.width/2  < g.x + g.width &&
         c.y + c.height/2 > g.y && c.y + c.height/2 < g.y + g.height)
      )
    );
    _s.dragging = { id, startX:pos.x, startY:pos.y, origX:g.x, origY:g.y, isGroup:true,
      childOffsets: childrenForDrag.map(c => ({ id:c.id, dx:c.x-g.x, dy:c.y-g.y }))
    };
  });
  el.querySelector('.arch-group-info-btn')?.addEventListener('click', e => {
    e.stopPropagation(); selectComp(id); openProps(id);
  });
  el.querySelector('.arch-del-badge')?.addEventListener('click', e => {
    e.stopPropagation(); deleteComp(id);
  });
  el.querySelector('.arch-group-name')?.addEventListener('dblclick', e => {
    e.stopPropagation(); startRename(id);
  });
  el.querySelectorAll('.arch-port').forEach(port => {
    port.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const pos = canvasPos(e);
      const c = compById(id);
      const portStr = c ? nearestPerimeterPoint(c, pos.x, pos.y) : (port.dataset.port + ':0.5');
      _s.connecting = { sourceId:id, sourcePort:portStr, curX:pos.x, curY:pos.y };
      const tp = document.getElementById('arch-temp');
      if (tp) tp.style.display = '';
    });
  });
  el.querySelectorAll('.arch-fun-del').forEach(btn => {
    btn.addEventListener('click', async e => { e.stopPropagation(); await deleteFun(btn.dataset.funId, btn.dataset.compId); });
  });
  el.querySelector('.arch-addfun-btn')?.addEventListener('click', e => {
    e.stopPropagation(); openIdefPanel();
  });
  wireResizeHandle(el, id);
}

// ── Wire block / port ─────────────────────────────────────────────────────────

function wireBlock(id) {
  const el = document.getElementById(`comp-${id}`); if (!el) return;
  const c  = compById(id);

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-port,.arch-resize-handle,.arch-fun-del,.arch-addfun-btn')) return;
    selectComp(id);
  });

  el.querySelector('[data-drag-id]')?.addEventListener('pointerdown', e => {
    if (e.target.closest('.arch-addfun-btn')) return;
    e.stopPropagation(); e.preventDefault();
    captureUndo();
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
  el.querySelector('.arch-del-badge')?.addEventListener('click', e => {
    e.stopPropagation(); deleteComp(id);
  });
  el.querySelector('.arch-addfun-btn')?.addEventListener('click', e => {
    e.stopPropagation(); openIdefPanel();
  });
  el.querySelectorAll('.arch-fun-del').forEach(btn => {
    btn.addEventListener('click', async e => { e.stopPropagation(); await deleteFun(btn.dataset.funId, btn.dataset.compId); });
  });
  el.querySelectorAll('.arch-port').forEach(port => {
    port.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const pos = canvasPos(e);
      const c = compById(id);
      const portStr = c ? nearestPerimeterPoint(c, pos.x, pos.y) : (port.dataset.port + ':0.5');
      _s.connecting = { sourceId:id, sourcePort:portStr, curX:pos.x, curY:pos.y };
      const tp = document.getElementById('arch-temp');
      if (tp) tp.style.display = '';
    });
  });
  wireResizeHandle(el, id);
}

function wireResizeHandle(el, id) {
  el.querySelectorAll('.arch-resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const c = compById(id); if (!c) return;
      captureUndo();
      const pos = canvasPos(e);
      const corner = handle.dataset.corner || 'se';
      _s.resizing = { id, corner, startX:pos.x, startY:pos.y,
        origX:c.x, origY:c.y, origW:c.width, origH:c.height };
    });
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
  // Move any ports attached to this block
  if (!isGroup) {
    _s.components
      .filter(p => p.comp_type==='Port' && p.data?.parent_block_id===id)
      .forEach(p => {
        const side = p.data?.attached_side || 'right';
        const [px, py] = portAbs(c, side);
        p.x = Math.round(px - PORT_SIZE/2);
        p.y = Math.round(py - PORT_SIZE/2);
        const pel = document.getElementById(`comp-${p.id}`);
        if (pel) { pel.style.left=p.x+'px'; pel.style.top=p.y+'px'; }
      });
  }
  renderConnections();
}

function handleDragEnd() {
  const { id, isGroup, childOffsets } = _s.dragging;
  _s.dragging = null;
  const c = compById(id); if (!c) return;
  const now = new Date().toISOString();

  if (c.comp_type === 'Group') {
    // Save group position
    sb.from('arch_components').update({ x:c.x, y:c.y, updated_at:now }).eq('id', id);
    // Save all child positions and ensure group_id is assigned in data
    if (childOffsets) {
      childOffsets.forEach(({ id:cid }) => {
        const cc = compById(cid); if (!cc) return;
        const dataChanged = (cc.data?.group_id || null) !== id;
        if (dataChanged) {
          cc.data = { ...(cc.data || {}), group_id: id };
          sb.from('arch_components').update({ x:cc.x, y:cc.y, data:cc.data, updated_at:now }).eq('id', cid);
        } else {
          sb.from('arch_components').update({ x:cc.x, y:cc.y, updated_at:now }).eq('id', cid);
        }
      });
    }
    // Also clear group_id for any non-group component that is no longer inside this group
    _s.components.filter(cc =>
      cc.comp_type !== 'Group' &&
      (cc.data?.group_id || null) === id &&
      !(cc.x + cc.width/2  > c.x && cc.x + cc.width/2  < c.x + c.width &&
        cc.y + cc.height/2 > c.y && cc.y + cc.height/2 < c.y + c.height)
    ).forEach(cc => {
      cc.data = { ...(cc.data || {}), group_id: null };
      sb.from('arch_components').update({ data: cc.data, updated_at: now }).eq('id', cc.id);
    });
    return;
  }

  // Auto-assign to group
  const grp = _s.components.find(g =>
    g.comp_type==='Group' &&
    c.x+c.width/2>g.x && c.x+c.width/2<g.x+g.width &&
    c.y+c.height/2>g.y && c.y+c.height/2<g.y+g.height);
  const gid = grp?.id||null;
  const dataChanged = (c.data?.group_id||null)!==gid;
  if (dataChanged) {
    c.data = {...(c.data||{}), group_id:gid};
    sb.from('arch_components').update({ x:c.x, y:c.y, data:c.data, updated_at:now }).eq('id', id);
  } else {
    sb.from('arch_components').update({ x:c.x, y:c.y, updated_at:now }).eq('id', id);
  }
  // Also save any attached ports that moved with this block
  _s.components
    .filter(p => p.comp_type==='Port' && p.data?.parent_block_id===id)
    .forEach(p => {
      sb.from('arch_components').update({ x:p.x, y:p.y, updated_at:now }).eq('id', p.id);
    });
}

// ── Connection endpoint drag ──────────────────────────────────────────────────

function handleEndpointMove(e) {
  const { connId, endpoint, compId } = _s.draggingEndpoint;
  const cn = _s.connections.find(c => c.id === connId); if (!cn) return;
  const comp = compById(compId); if (!comp) return;
  const pos = canvasPos(e);
  const portStr = nearestPerimeterPoint(comp, pos.x, pos.y);
  if (endpoint === 'source') cn.source_port = portStr;
  else cn.target_port = portStr;
  // Live re-render only the path (update SVG in place)
  const grpEl = document.getElementById(`conn-${connId}`);
  if (grpEl) {
    const [sx,sy] = portAbs(compById(cn.source_id), cn.source_port);
    const [tx,ty] = portAbs(compById(cn.target_id), cn.target_port);
    const d = bezier(sx,sy,cn.source_port,tx,ty,cn.target_port);
    grpEl.querySelectorAll('path').forEach(p => { if (p.getAttribute('d')) p.setAttribute('d', d); });
    const ep = grpEl.querySelector(`.arch-conn-ep[data-endpoint="${endpoint}"]`);
    const epx = endpoint==='source'?sx:tx, epy = endpoint==='source'?sy:ty;
    const epPort = endpoint==='source'?cn.source_port:cn.target_port;
    const epSide = epPort?.split(':')[0] || 'right';
    const half = CONN_EP_SIZE/2;
    const offMap = {top:[0,-half],bottom:[0,half],left:[-half,0],right:[half,0]};
    const [eox,eoy] = offMap[epSide]||[half,0];
    if (ep) { ep.setAttribute('x', epx+eox-half); ep.setAttribute('y', epy+eoy-half); }
  }
}

async function handleEndpointEnd(e) {
  const { connId, endpoint, compId } = _s.draggingEndpoint;
  _s.draggingEndpoint = null;
  const cn = _s.connections.find(c => c.id === connId); if (!cn) return;
  const pos = canvasPos(e);
  const comp = compById(compId); if (!comp) return;
  const portStr = nearestPerimeterPoint(comp, pos.x, pos.y);
  if (endpoint === 'source') cn.source_port = portStr;
  else cn.target_port = portStr;
  await sb.from('arch_connections').update({
    source_port: cn.source_port, target_port: cn.target_port,
    updated_at: new Date().toISOString(),
  }).eq('id', connId);
  renderConnections();
}

// ── Resize ────────────────────────────────────────────────────────────────────

function handleResizeMove(e) {
  const { id, corner, startX, startY, origX, origY, origW, origH } = _s.resizing;
  const c = compById(id); if (!c) return;
  const pos = canvasPos(e);
  const isGrp = c.comp_type==='Group';
  const minW = isGrp ? GROUP_MIN_W : MIN_W;
  const minH = isGrp ? GROUP_MIN_H : MIN_H;
  const dx = pos.x - startX, dy = pos.y - startY;

  // SE: grow right+down (default)
  // SW: grow left+down (x moves, width shrinks from right)
  // NE: grow right+up
  // NW: grow left+up
  if (corner === 'se' || corner === 'ne') {
    c.width = Math.max(minW, snap(origW + dx));
  } else {
    const newW = Math.max(minW, snap(origW - dx));
    c.x = snap(origX + origW - newW);
    c.width = newW;
  }
  if (corner === 'se' || corner === 'sw') {
    c.height = Math.max(minH, snap(origH + dy));
  } else {
    const newH = Math.max(minH, snap(origH - dy));
    c.y = snap(origY + origH - newH);
    c.height = newH;
  }

  const el = document.getElementById(`comp-${id}`);
  if (el) {
    el.style.left=c.x+'px'; el.style.top=c.y+'px';
    el.style.width=c.width+'px'; el.style.height=c.height+'px';
  }

  // Auto-expand parent group if child block overflows
  if (!isGrp) {
    const PAD = 20;
    const grp = _s.components.find(g => g.comp_type==='Group' && g.id===c.data?.group_id);
    if (grp) {
      let changed = false;
      // right edge
      if (c.x + c.width + PAD > grp.x + grp.width) {
        grp.width = snap(c.x + c.width + PAD - grp.x);
        changed = true;
      }
      // bottom edge
      if (c.y + c.height + PAD > grp.y + grp.height) {
        grp.height = snap(c.y + c.height + PAD - grp.y);
        changed = true;
      }
      // left edge
      if (c.x - PAD < grp.x) {
        const delta = snap(grp.x - (c.x - PAD));
        grp.x -= delta; grp.width += delta;
        changed = true;
      }
      // top edge
      if (c.y - PAD < grp.y) {
        const delta = snap(grp.y - (c.y - PAD));
        grp.y -= delta; grp.height += delta;
        changed = true;
      }
      if (changed) {
        const gel = document.getElementById(`comp-${grp.id}`);
        if (gel) {
          gel.style.left=grp.x+'px'; gel.style.top=grp.y+'px';
          gel.style.width=grp.width+'px'; gel.style.height=grp.height+'px';
          gel.classList.add('arch-group--expand-hint');
        }
      }
    }
  }

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
  if (tPort && tPort.dataset.compId!==sourceId) {
    targetId=tPort.dataset.compId;
    const tc=compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'left:0.5';
  } else if (tComp) {
    targetId=tComp.dataset.id;
    const tc=compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'left:0.5';
  } else if (tGroup) {
    targetId=tGroup.dataset.id;
    const tc=compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'right:0.5';
  }

  if (!targetId) return;

  const src = compById(sourceId), tgt = compById(targetId);
  const dup = _s.connections.find(cn =>
    (cn.source_id===sourceId&&cn.target_id===targetId)||(cn.source_id===targetId&&cn.target_id===sourceId));
  if (dup) { selectConn(dup.id); return; }

  // Auto-create attached ports when connecting two regular blocks
  const needSrcPort = src && src.comp_type !== 'Port' && src.comp_type !== 'Group';
  const needTgtPort = tgt && tgt.comp_type !== 'Port' && tgt.comp_type !== 'Group';

  showConnPanel(sourceId, sourcePort||'right:0.5', targetId, targetPort||'left:0.5', needSrcPort, needTgtPort);
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

// ── Connection panel ──────────────────────────────────────────────────────────

let _selectedConnId = null;

function selectConn(connId) {
  _selectedConnId = connId;
  // Deselect any component
  selectComp(null, true);
  // Highlight the SVG connection
  document.querySelectorAll('.arch-conn-g').forEach(g =>
    g.classList.toggle('arch-conn-g--sel', g.id === `conn-${connId}`));
  const cn = _s.connections.find(c => c.id === connId); if (!cn) return;
  const src = compById(cn.source_id), tgt = compById(cn.target_id); if (!src||!tgt) return;
  // If endpoint is an auto-attached Port, use the parent block's name for display
  const srcName = (src.comp_type==='Port' && src.data?.parent_block_id)
    ? (compById(src.data.parent_block_id)?.name ?? src.name) : src.name;
  const tgtName = (tgt.comp_type==='Port' && tgt.data?.parent_block_id)
    ? (compById(tgt.data.parent_block_id)?.name ?? tgt.name) : tgt.name;
  showPropsPanel(connPropsHTML(srcName, tgtName, cn));
  wireConnProps(cn);
  // Sync Interface Requirements panel if open
  const ifreqsPanel = document.getElementById('arch-ifreqs-panel');
  if (ifreqsPanel && ifreqsPanel.style.display !== 'none' && cn.requirement) {
    highlightIfaceReqRow(cn.requirement);
  }
}

async function showConnPanel(srcId, srcPort, tgtId, tgtPort, needSrcPort, needTgtPort) {
  const src=compById(srcId), tgt=compById(tgtId);
  if (!src||!tgt) return;
  const srcGrp = src.data?.group_id||''; const tgtGrp = tgt.data?.group_id||'';
  const isExt  = !!(srcGrp && tgtGrp && srcGrp!==tgtGrp) ||
                  src.comp_type==='Port' || tgt.comp_type==='Port' ||
                  src.comp_type==='Group' || tgt.comp_type==='Group';
  let autoDir = 'bidirectional';
  if (tgt.comp_type==='Group' && src.data?.group_id===tgt.id) autoDir = 'A_to_B';
  else if (src.comp_type==='Group' && tgt.data?.group_id===src.id) autoDir = 'B_to_A';

  captureUndo();

  let finalSrcId = srcId, finalSrcPort = srcPort;
  let finalTgtId = tgtId, finalTgtPort = tgtPort;

  // Auto-create attached ports when connecting two regular blocks
  if (needSrcPort) {
    const p = await createAttachedPort(srcId, srcPort, autoDir === 'B_to_A' ? 'in' : 'out');
    if (p) { finalSrcId = p.id; finalSrcPort = 'right'; }
  }
  if (needTgtPort) {
    const p = await createAttachedPort(tgtId, tgtPort, autoDir === 'A_to_B' ? 'in' : 'out');
    if (p) { finalTgtId = p.id; finalTgtPort = 'left'; }
  }

  const { data, error } = await sb.from('arch_connections').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    source_id:finalSrcId, target_id:finalTgtId,
    source_port:finalSrcPort, target_port:finalTgtPort,
    interface_type:'Data', direction:autoDir, name:null, requirement:null, is_external:isExt,
  }).select().single();

  if (error) {
    const msg = error.message?.includes('does not exist')
      ? 'Table not found — run migration_005_architecture.sql in Supabase.'
      : 'Error: '+error.message;
    toast(msg,'error'); return;
  }

  // Auto-create an Interface requirement linked to this connection
  const reqIdx = await nextIndex('requirements', { parent_id: _s.parentId });
  const reqCode = buildCode('REQ', {
    domain: _s.parentType === 'item' ? 'ITEM' : 'SYS',
    projectName: _s.project.name,
    systemName: _s.parentType === 'system' ? (_s.item?.name || '') : undefined,
    index: reqIdx,
  });
  const srcName = (src.comp_type==='Port'&&src.data?.parent_block_id)
    ? (compById(src.data.parent_block_id)?.name ?? src.name) : src.name;
  const tgtName = (tgt.comp_type==='Port'&&tgt.data?.parent_block_id)
    ? (compById(tgt.data.parent_block_id)?.name ?? tgt.name) : tgt.name;

  // Ensure the "Interface Requirements" nav sub-page exists under the requirements phase
  const domain = _s.parentType === 'item' ? 'item' : 'system';
  const { data: existingPage } = await sb.from('nav_pages')
    .select('id').eq('parent_type', _s.parentType).eq('parent_id', _s.parentId)
    .eq('domain', domain).eq('phase', 'requirements').eq('name', 'Interface Requirements')
    .maybeSingle();
  let sidebarNeedsRefresh = false;
  if (!existingPage) {
    const { count } = await sb.from('nav_pages')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId)
      .eq('domain', domain).eq('phase', 'requirements');
    await sb.from('nav_pages').insert({
      parent_type: _s.parentType, parent_id: _s.parentId,
      domain, phase: 'requirements', name: 'Interface Requirements', sort_order: count || 0,
    });
    sidebarNeedsRefresh = true;
  }

  await sb.from('requirements').insert({
    req_code: reqCode,
    parent_type: _s.parentType,
    parent_id: _s.parentId,
    project_id: _s.project.id,
    title: `Interface: ${srcName} ↔ ${tgtName}`,
    type: 'interface',
    status: 'draft',
    priority: 'medium',
  });

  // Link the requirement code back to the connection
  await sb.from('arch_connections').update({ requirement: reqCode }).eq('id', data.id);
  data.requirement = reqCode;

  _s.connections.push(data);
  renderConnections(); selectConn(data.id); toast('Interface created + requirement ' + reqCode + '.', 'success');
  openIfaceReqsPanel(reqCode);
  if (sidebarNeedsRefresh) window.dispatchEvent(new Event('hashchange'));
}

function _ifaceOpts(sel) {
  return Object.keys(IFACE).map(k=>`<option value="${k}" ${sel===k?'selected':''}>${k}</option>`).join('');
}
function _dirOpts(srcN, tgtN, sel) {
  return [['A_to_B',`${srcN} → ${tgtN}`],['B_to_A',`${tgtN} → ${srcN}`],['bidirectional','Bidirectional ↔']]
    .map(([v,l])=>`<option value="${v}" ${sel===v?'selected':''}>${escH(l)}</option>`).join('');
}


function connPropsHTML(srcName, tgtName, cn) {
  return `
    <div class="arch-props-hdr">Interface</div>
    <div class="arch-props-chips">
      <span class="arch-popover-chip">${escH(srcName)}</span>
      <span style="color:var(--color-text-muted)">⇄</span>
      <span class="arch-popover-chip">${escH(tgtName)}</span>
    </div>
    <label class="arch-form-lbl">Interface Type</label>
    <select class="form-input" id="pop-itype">${_ifaceOpts(cn.interface_type)}</select>
    <label class="arch-form-lbl">Direction</label>
    <select class="form-input" id="pop-dir">${_dirOpts(srcName,tgtName,cn.direction||'bidirectional')}</select>
    <label class="arch-form-lbl">Name</label>
    <input class="form-input" id="pop-name" value="${escH(cn.name||'')}"/>
    <label class="arch-form-lbl">Requirement</label>
    <textarea class="form-input form-textarea" id="pop-req" rows="3">${escH(cn.requirement||'')}</textarea>
    <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:6px">
      <input type="checkbox" id="pop-ext" ${cn.is_external?'checked':''}/> External interface
    </label>`;
}


function wireConnProps(cn) {
  const body = document.getElementById('arch-props-body'); if (!body) return;
  const saveConn = debounce(async () => {
    const itype = body.querySelector('#pop-itype')?.value;
    const dir   = body.querySelector('#pop-dir')?.value;
    const name  = body.querySelector('#pop-name')?.value.trim()||null;
    const req   = body.querySelector('#pop-req')?.value.trim()||null;
    const ext   = body.querySelector('#pop-ext')?.checked ?? false;
    if (itype === undefined) return;
    const patch = { interface_type:itype, direction:dir, name, requirement:req, is_external:ext, updated_at:new Date().toISOString() };
    const { error } = await sb.from('arch_connections').update(patch).eq('id', cn.id);
    if (error) { toast('Error: '+error.message,'error'); return; }
    Object.assign(cn, patch); renderConnections();
  }, 600);
  body.querySelector('#pop-itype')?.addEventListener('change', saveConn);
  body.querySelector('#pop-dir')?.addEventListener('change', saveConn);
  body.querySelector('#pop-name')?.addEventListener('input', saveConn);
  body.querySelector('#pop-req')?.addEventListener('input', saveConn);
  body.querySelector('#pop-ext')?.addEventListener('change', saveConn);
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

function propseFunSection(c) {
  return `
    <div style="margin-top:10px">
      <div class="arch-props-fun-hdr">
        <span>λ Functions</span>
        <button class="arch-tb-btn" id="props-add-fun" title="Open Item Definition to assign a function">＋</button>
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
    </div>`;
}

function openProps(id) {
  const c = compById(id); if (!c) return;

  const saveComp = async (patch) => {
    Object.assign(c, patch);
    await sb.from('arch_components').update({...patch, updated_at:new Date().toISOString()}).eq('id',id);
  };
  const debName = debounce(async () => {
    const v = document.getElementById('props-name')?.value.trim(); if (!v||v===c.name) return;
    await saveComp({name:v}); refreshComp(id); if (c.comp_type!=='Port') renderConnections();
  }, 700);

  // ── Port ─────────────────────────────────────────────────────────────────
  if (c.comp_type === 'Port') {
    const parentBlk = c.data?.parent_block_id ? compById(c.data.parent_block_id) : null;
    showPropsPanel(`
      <div class="arch-props-hdr">Port · ${escH(c.name)}</div>
      ${parentBlk ? `<div class="arch-props-note">⬡ Attached to: ${escH(parentBlk.name)}</div>` : ''}
      <label class="arch-form-lbl">Port Name</label>
      <input class="form-input" id="props-name" value="${escH(c.name)}"/>
      <label class="arch-form-lbl">Direction</label>
      <select class="form-input" id="props-port-dir">
        <option value="in"    ${c.data?.port_dir==='in'   ?'selected':''}>in  ▶ (input)</option>
        <option value="out"   ${c.data?.port_dir==='out'  ?'selected':''}>out ◀ (output)</option>
        <option value="inout" ${(c.data?.port_dir||'inout')==='inout'?'selected':''}>inout ◆ (bidirectional)</option>
      </select>`);
    document.getElementById('props-name').addEventListener('input', debName);
    document.getElementById('props-port-dir').addEventListener('change', async () => {
      const dir = document.getElementById('props-port-dir').value;
      c.data = {...(c.data||{}), port_dir:dir};
      await sb.from('arch_components').update({ data:c.data, updated_at:new Date().toISOString() }).eq('id',id);
      refreshComp(id); renderConnections();
    });
    return;
  }

  // ── Group ─────────────────────────────────────────────────────────────────
  if (c.comp_type === 'Group') {
    const linkedSys = c.data?.system_id ? _s.projectSystems.find(s=>s.id===c.data.system_id) : null;
    const sysOpts = _s.projectSystems.map(s =>
      `<option value="${s.id}" ${c.data?.system_id===s.id?'selected':''}>${escH(s.system_code)} — ${escH(s.name)}</option>`).join('');
    showPropsPanel(`
      <div class="arch-props-hdr">System Group · ${escH(c.name)}</div>
      <label class="arch-form-lbl">Name</label>
      <input class="form-input" id="props-name" value="${escH(c.name)}"/>
      <label class="arch-form-lbl">Linked System</label>
      <select class="form-input" id="props-sys-link">
        <option value="">— None —</option>
        ${sysOpts}
      </select>
      ${linkedSys ? `<div class="arch-props-note" style="margin-top:6px">🔗 ${escH(linkedSys.system_code)} · ${escH(linkedSys.name)}</div>` : ''}
      ${propseFunSection(c)}`);
    document.getElementById('props-name').addEventListener('input', debName);
    document.getElementById('props-sys-link').addEventListener('change', async () => {
      const sysId = document.getElementById('props-sys-link').value||null;
      c.data = {...(c.data||{}), system_id:sysId||undefined};
      if (!sysId) delete c.data.system_id;
      await sb.from('arch_components').update({ data:c.data, updated_at:new Date().toISOString() }).eq('id',id);
      refreshComp(id);
    });
    document.getElementById('props-add-fun').onclick = () => openIdefPanel();
    wirePropsF(c, id);
    return;
  }

  // ── Block ─────────────────────────────────────────────────────────────────
  const st = STYLES[c.comp_type] || STYLES.HW;
  showPropsPanel(`
    <div class="arch-props-hdr" style="border-left:3px solid ${st.border};padding-left:8px">${escH(c.comp_type)} · ${escH(c.name)}</div>
    <label class="arch-form-lbl">Name</label>
    <input class="form-input" id="props-name" value="${escH(c.name)}"/>
    <label class="arch-form-lbl">Type</label>
    <select class="form-input" id="props-type">
      ${['HW','SW','Mechanical'].map(t=>`<option value="${t}" ${c.comp_type===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:6px">
      <input type="checkbox" id="props-safe" ${c.is_safety_critical?'checked':''}/> Safety Critical
    </label>
    ${propseFunSection(c)}`);


  document.getElementById('props-name').addEventListener('input', debName);
  document.getElementById('props-type').addEventListener('change', async () => {
    const type = document.getElementById('props-type').value;
    await saveComp({comp_type:type}); refreshComp(id);
  });
  document.getElementById('props-safe').addEventListener('change', async () => {
    const safe = document.getElementById('props-safe').checked;
    await saveComp({is_safety_critical:safe}); refreshComp(id);
  });

  document.getElementById('props-add-fun').onclick = () => openIdefPanel();
  wirePropsF(c, id);
}

function wirePropsF(c, id) {
  const body = document.getElementById('arch-props-body');
  body?.querySelectorAll('.pf-safe').forEach(chk => {
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
  body?.querySelectorAll('.pf-ren').forEach(btn => {
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
  body?.querySelectorAll('.pf-del').forEach(btn => {
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

  captureUndo();
  const { data, error } = await sb.from('arch_components').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    name: isPort ? `P-${String(_s.components.filter(x=>x.comp_type==='Port').length+1).padStart(3,'0')}`
                 : `${type==='Mechanical'?'MECH':type}-${String(_s.components.filter(x=>x.comp_type===type).length+1).padStart(3,'0')}`,
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
  const c = compById(id); if (!c) return;

  // Collect all component IDs affected (self + group children + attached ports)
  const affectedIds = new Set([id]);
  if (c.comp_type === 'Group') {
    _s.components.filter(b => b.data?.group_id === id).forEach(b => affectedIds.add(b.id));
  }
  // Include auto-attached Port components (their connections belong to this block)
  _s.components.filter(b => b.comp_type === 'Port' && b.data?.parent_block_id === id)
    .forEach(b => affectedIds.add(b.id));

  // Connections that touch any affected component
  const affectedConns = _s.connections.filter(cn =>
    affectedIds.has(cn.source_id) || affectedIds.has(cn.target_id));

  // Interface requirements linked to those connections
  const linkedReqCodes = [...new Set(affectedConns.map(cn => cn.requirement).filter(Boolean))];
  let linkedReqs = [];
  if (linkedReqCodes.length) {
    const { data: rdata } = await sb.from('requirements')
      .select('req_code, title')
      .in('req_code', linkedReqCodes)
      .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId);
    linkedReqs = rdata || [];
  }

  // Build first dialog content
  const isGroup = c.comp_type === 'Group';
  const linkedSys = isGroup && c.data?.system_id
    ? _s.projectSystems.find(s => s.id === c.data.system_id) : null;
  const childCount = isGroup ? _s.components.filter(b => b.data?.group_id === id).length : 0;

  const connList = affectedConns.length ? `
    <div class="del-comp-section">
      <div class="del-comp-section-title">Connections that will be removed (${affectedConns.length})</div>
      <ul class="del-comp-list">
        ${affectedConns.map(cn => {
          const s = compById(cn.source_id), t2 = compById(cn.target_id);
          const sn = s ? escH(s.name) : '?', tn = t2 ? escH(t2.name) : '?';
          return `<li>${sn} ↔ ${tn}${cn.requirement ? ` <span class="del-comp-req-code">${escH(cn.requirement)}</span>` : ''}</li>`;
        }).join('')}
      </ul>
    </div>` : '';

  const reqList = linkedReqs.length ? `
    <div class="del-comp-section">
      <div class="del-comp-section-title">Interface requirements that will be deleted (${linkedReqs.length})</div>
      <ul class="del-comp-list">
        ${linkedReqs.map(r => `<li><span class="del-comp-req-code">${escH(r.req_code)}</span> ${escH(r.title)}</li>`).join('')}
      </ul>
    </div>` : '';

  const sysNote = linkedSys
    ? `<p style="margin-top:8px;font-size:12px;color:var(--color-text-muted)">Linked system <strong>${escH(linkedSys.system_code)}</strong> will be unlinked but NOT deleted.</p>` : '';
  const childNote = childCount
    ? `<p style="margin-top:4px;font-size:12px;color:var(--color-text-muted)">${childCount} block(s) inside will be unlinked from this group.</p>` : '';

  const warnBox = (affectedConns.length || linkedReqs.length) ? `
    <div class="modal-warn-box" style="margin-top:12px">
      ⚠ Deleting this component will permanently remove ${affectedConns.length} connection(s) and ${linkedReqs.length} interface requirement(s). This may create inconsistencies between the Architecture canvas and Requirements, Traceability, and other documents.
    </div>` : '';

  const execDelete = async () => {
    captureUndo();
    // Delete linked requirements
    if (linkedReqCodes.length) {
      await sb.from('requirements').delete().in('req_code', linkedReqCodes)
        .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId);
      _ifreqs = _ifreqs.filter(r => !linkedReqCodes.includes(r.req_code));
      renderIfaceReqs();
    }
    // Delete connections
    if (affectedConns.length) {
      await sb.from('arch_connections').delete().in('id', affectedConns.map(cn => cn.id));
    }
    // Unlink group children
    if (isGroup) {
      _s.components.filter(b => b.data?.group_id === id).forEach(b => {
        b.data = { ...(b.data || {}) }; delete b.data.group_id;
        sb.from('arch_components').update({ data: b.data }).eq('id', b.id);
      });
    }
    await sb.from('arch_components').delete().eq('id', id);
    _s.components  = _s.components.filter(x => x.id !== id);
    _s.connections = _s.connections.filter(cn => !affectedIds.has(cn.source_id) && !affectedIds.has(cn.target_id));
    document.getElementById(`comp-${id}`)?.remove();
    selectComp(null);
    renderConnections();
    if (isGroup) renderGroups();
    toast(`"${c.name}" deleted.`, 'success');
  };

  const showSecondConfirm = () => {
    showModal({
      title: '⚠ Final Confirmation',
      body: `<p>This action <strong>cannot be undone</strong>.</p>
             <p style="margin-top:8px">Are you sure you want to permanently delete <strong>"${escH(c.name)}"</strong>${linkedReqs.length ? ` along with ${linkedReqs.length} interface requirement(s)` : ''}?</p>`,
      footer: `
        <button class="btn btn-secondary" id="dc2-cancel">Cancel</button>
        <button class="btn btn-danger"    id="dc2-confirm">Yes, delete everything</button>
      `,
    });
    document.getElementById('dc2-cancel').onclick  = () => hideModal();
    document.getElementById('dc2-confirm').onclick = () => { hideModal(); execDelete(); };
  };

  if (!affectedConns.length && !linkedReqs.length) {
    // No connections — simple single confirm
    confirmDialog(`Delete "${c.name}"?${childCount ? ` (${childCount} block(s) will be unlinked)` : ''}`, execDelete);
    return;
  }

  showModal({
    title: `Delete "${escH(c.name)}"`,
    body: `
      <p style="margin-bottom:10px">Deleting this ${isGroup ? 'system group' : 'component'} will also remove the following:</p>
      ${connList}${reqList}${sysNote}${childNote}${warnBox}`,
    footer: `
      <button class="btn btn-secondary" id="dc1-cancel">Cancel</button>
      <button class="btn btn-danger"    id="dc1-confirm">Continue →</button>
    `,
  });
  document.getElementById('dc1-cancel').onclick  = () => hideModal();
  document.getElementById('dc1-confirm').onclick = () => { hideModal(); showSecondConfirm(); };
}

async function deleteConn(connId) {
  const cn = _s.connections.find(c => c.id === connId);
  const reqCode = cn?.requirement;

  const doDelete = async (alsoReq) => {
    captureUndo();
    const { error } = await sb.from('arch_connections').delete().eq('id', connId);
    if (error) { toast('Error: '+error.message,'error'); return; }
    if (alsoReq && reqCode) {
      await sb.from('requirements').delete().eq('req_code', reqCode)
        .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId);
      _ifreqs = _ifreqs.filter(r => r.req_code !== reqCode);
      renderIfaceReqs();
    }
    _s.connections = _s.connections.filter(c => c.id !== connId);
    _selectedConnId = null;
    renderConnections(); showPropsEmpty();
    toast(alsoReq ? 'Connection and requirement deleted.' : 'Connection deleted.', 'success');
  };

  if (!reqCode) { await doDelete(false); return; }

  showModal({
    title: 'Delete Connection',
    body: `
      <p style="margin-bottom:8px">This connection is linked to requirement <strong>${escH(reqCode)}</strong>.</p>
      <p style="margin-bottom:12px">What would you like to do?</p>
      <div class="modal-warn-box">
        ⚠ Deleting the connection without removing the requirement may create inconsistencies between the Architecture and other documents (Requirements, Traceability).
      </div>`,
    footer: `
      <button class="btn btn-secondary" id="dc-cancel">Cancel</button>
      <button class="btn btn-secondary" id="dc-conn-only">Delete connection only</button>
      <button class="btn btn-danger"    id="dc-both">Delete connection + requirement</button>
    `,
  });
  document.getElementById('dc-cancel').onclick    = () => hideModal();
  document.getElementById('dc-conn-only').onclick = () => { hideModal(); doDelete(false); };
  document.getElementById('dc-both').onclick      = () => { hideModal(); doDelete(true); };
}

async function deleteFun(funId, compId) {
  await sb.from('arch_functions').delete().eq('id',funId);
  const c=compById(compId); if(c) c.functions=c.functions.filter(f=>f.id!==funId);
  refreshComp(compId);
}


// ── Selection / refresh ───────────────────────────────────────────────────────

function selectComp(id, skipProps=false) {
  _s.selected = id;
  // Clear connection selection
  if (id) {
    _selectedConnId = null;
    document.querySelectorAll('.arch-conn-g--sel').forEach(el => el.classList.remove('arch-conn-g--sel'));
  }
  document.querySelectorAll('.arch-block,.arch-group,.arch-port-block').forEach(el=>{
    const cls = el.classList.contains('arch-block') ? 'arch-block--sel'
              : el.classList.contains('arch-group')  ? 'arch-group--sel'
              : 'arch-port-block--sel';
    el.classList.toggle(cls, el.dataset.id===id);
  });
  if (!skipProps) {
    if (id) openProps(id);
    else showPropsEmpty();
  }
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

// ── Architecture Frame Tree ───────────────────────────────────────────────────

function renderFrameTree() {
  const body = document.getElementById('arch-frame-body'); if (!body) return;
  const groups    = _s.components.filter(c => c.comp_type === 'Group');
  const allBlocks = _s.components.filter(c => c.comp_type !== 'Group' && c.comp_type !== 'Port');
  const ports     = _s.components.filter(c => c.comp_type === 'Port');
  const typeIcon  = { HW:'🔧', SW:'💾', Mechanical:'⚙' };

  function blockTree(blk) {
    const blkPorts = ports.filter(p => p.data?.parent_block_id === blk.id);
    const funs = blk.functions || [];
    const safeTag = blk.is_safety_critical ? `<span class="ft-safe-tag">SC</span>` : '';
    const portItems = blkPorts.map(p => `
      <div class="ft-row ft-port">
        <span class="ft-icon">■</span>
        <span class="ft-label">${escH(p.name)}</span>
        <span class="ft-muted">${{in:'▶',out:'◀',inout:'◆'}[p.data?.port_dir||'inout']||'◆'}</span>
      </div>`).join('');
    const funItems = funs.map(f => `
      <div class="ft-row ft-fun ${f.is_safety_related?'ft-fun--safe':''}">
        <span class="ft-icon">${f.is_safety_related?'⚠':'⬥'}</span>
        <span class="ft-label">${escH(f.name)}</span>
      </div>`).join('');
    const hasChildren = funs.length || blkPorts.length;
    return `
      <details class="ft-details" open>
        <summary class="ft-row ft-block">
          <span class="ft-icon">${typeIcon[blk.comp_type]||'□'}</span>
          <span class="ft-label ft-label--block">${escH(blk.name)}</span>
          <span class="ft-badge ft-badge--${blk.comp_type.toLowerCase()}">${blk.comp_type}</span>
          ${safeTag}
        </summary>
        <div class="ft-children">
          ${portItems}${funItems}
          ${!hasChildren?'<div class="ft-row ft-empty">no functions</div>':''}
        </div>
      </details>`;
  }

  const groupSections = groups.map(g => {
    const linkedSys = g.data?.system_id ? _s.projectSystems.find(s=>s.id===g.data.system_id) : null;
    const children  = allBlocks.filter(b => b.data?.group_id === g.id);
    return `
      <details class="ft-details ft-details--group" open>
        <summary class="ft-row ft-group">
          <span class="ft-icon">⬡</span>
          <span class="ft-label ft-label--group">${escH(g.name)}</span>
          ${linkedSys ? `<span class="ft-muted">🔗 ${escH(linkedSys.system_code)}</span>` : ''}
        </summary>
        <div class="ft-children">
          ${children.length ? children.map(blockTree).join('') : '<div class="ft-row ft-empty">empty group</div>'}
        </div>
      </details>`;
  }).join('');

  const groupIds = new Set(groups.map(g => g.id));
  const ungrouped = allBlocks.filter(b => !b.data?.group_id || !groupIds.has(b.data.group_id));
  const ungroupedSection = ungrouped.length ? `
    <details class="ft-details ft-details--loose" open>
      <summary class="ft-row ft-group">
        <span class="ft-icon">◌</span>
        <span class="ft-label ft-label--group" style="color:var(--color-text-muted)">Ungrouped</span>
      </summary>
      <div class="ft-children">${ungrouped.map(blockTree).join('')}</div>
    </details>` : '';

  body.innerHTML = (groupSections + ungroupedSection) ||
    `<div style="padding:12px;color:var(--color-text-muted);font-size:var(--text-sm)">No components yet.</div>`;
}

function compById(id) { return _s.components.find(c=>c.id===id); }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Returns tooltip data for an arch_function record (looks up Feature/UC/Description from _idef)
function funTooltipAttrs(f) {
  let feat = '', uc = '', desc = f.description || '';
  if (f.function_ref_id && _idef.loaded) {
    const fn = _idef.functions.find(x => x.id === f.function_ref_id);
    if (fn) {
      desc = fn.description || desc;
      const ucObj = _idef.useCases.find(x => x.id === fn.use_case_id);
      if (ucObj) {
        uc = ucObj.name || '';
        const featObj = _idef.features.find(x => x.id === ucObj.feature_id);
        if (featObj) feat = featObj.name || '';
      }
    }
  }
  if (!feat && !uc && !desc) return '';
  return ` data-funtip="${escH(JSON.stringify({feat, uc, desc}))}"`;
}

// ── Item Definition panel ─────────────────────────────────────────────────────

function openIdefPanel() {
  const panel = document.getElementById('arch-idef-panel');
  if (panel && panel.style.display === 'none') panel.style.display = '';
  toast('📎 Select a function from the list', 'idef-hint');
}

async function loadIdefData() {
  if (!_s) return;
  const itemId = _s.item?.id || _s.parentId;
  _idef.parentType = 'item';
  _idef.parentId   = itemId;
  try {
    const { data: feats } = await sb.from('features')
      .select('*').eq('parent_type','item').eq('parent_id', itemId)
      .order('sort_order').order('created_at');
    _idef.features = feats || [];
  } catch(_) { _idef.features = []; }
  _idef.loaded = true;
  renderIdefCols();
}

// ─── Idef column builders (mirrors item-definition.js style) ──────────────────

function idefFeatColHTML() {
  const feats = _idef.features;
  const rows = feats.length
    ? feats.map((f,i) => idefRow('feat', f, i, feats.length)).join('')
    : `<div class="fuf-empty">No features yet</div>`;
  return `<div class="fuf-col idef-col" id="idef-col-feat">
    <div class="fuf-col-header">
      <span class="fuf-col-icon feat-icon">${IDEF_ICONS.feat}</span>
      <span class="fuf-col-title">Features</span>
      <button class="fuf-add-btn" id="idef-add-feat">＋</button>
    </div>
    <div class="fuf-col-body" id="idef-list-feat">${rows}</div>
  </div>`;
}

function idefUCColHTML() {
  const ucs = _idef.useCases || [];
  const empty = !_idef.selFeatId
    ? `<div class="fuf-empty fuf-hint">← Select a Feature</div>`
    : `<div class="fuf-empty">No use cases yet</div>`;
  const rows = ucs.length ? ucs.map((u,i) => idefRow('uc', u, i, ucs.length)).join('') : empty;
  return `<div class="fuf-col idef-col" id="idef-col-uc">
    <div class="fuf-col-header">
      <span class="fuf-col-icon uc-icon">${IDEF_ICONS.uc}</span>
      <span class="fuf-col-title">Use Cases</span>
      ${_idef.selFeatId ? `<button class="fuf-add-btn" id="idef-add-uc">＋</button>` : ''}
    </div>
    <div class="fuf-col-body" id="idef-list-uc">${rows}</div>
  </div>`;
}

function idefFunColHTML() {
  const fns = _idef.functions || [];
  const empty = !_idef.selUCId
    ? `<div class="fuf-empty fuf-hint">← Select a Use Case</div>`
    : `<div class="fuf-empty">No functions yet</div>`;
  const rows = fns.length ? fns.map((fn,i) => idefFunRow(fn, i, fns.length)).join('') : empty;
  return `<div class="fuf-col idef-col" id="idef-col-fun">
    <div class="fuf-col-header">
      <span class="fuf-col-icon fun-icon">${IDEF_ICONS.fun}</span>
      <span class="fuf-col-title">Functions</span>
      ${_idef.selUCId ? `<button class="fuf-add-btn" id="idef-add-fun">＋</button>` : ''}
    </div>
    <div class="fuf-col-body" id="idef-list-fun">${rows}</div>
  </div>`;
}

function idefRow(type, item, idx, total) {
  const code = item.feat_code || item.uc_code || '';
  const icon = IDEF_ICONS[type === 'feat' ? 'feat' : 'uc'];
  const sel  = (type==='feat' && _idef.selFeatId===item.id) || (type==='uc' && _idef.selUCId===item.id);
  return `<div class="fuf-row ${sel?'selected':''}" data-id="${item.id}" data-idef-type="${type}">
    <div class="fuf-row-main">
      <span class="fuf-icon ${type}-icon">${icon}</span>
      <div class="fuf-row-text">
        <span class="fuf-code">${escH(code)}</span>
        <span class="fuf-name">${escH(item.name)}</span>
        ${item.description ? `<span class="fuf-desc">${escH(item.description)}</span>` : ''}
      </div>
    </div>
    <div class="fuf-actions">
      ${idx>0 ? `<button class="fuf-act fuf-up" data-id="${item.id}" data-idef-type="${type}">▲</button>` : ''}
      ${idx<total-1 ? `<button class="fuf-act fuf-dn" data-id="${item.id}" data-idef-type="${type}">▼</button>` : ''}
      <button class="fuf-act fuf-edit" data-id="${item.id}" data-idef-type="${type}">✎</button>
      <button class="fuf-act fuf-del"  data-id="${item.id}" data-idef-type="${type}" data-name="${escH(item.name)}">✕</button>
    </div>
  </div>`;
}

function idefFunRow(fn, idx, total) {
  const assigned = _s?.components.some(c => (c.functions||[]).some(af => af.function_ref_id === fn.id));
  return `<div class="fuf-row idef-fn-row ${assigned?'idef-fn--assigned':''}"
      draggable="true" data-id="${fn.id}" data-idef-type="fun"
      data-fn-name="${escH(fn.name)}" data-uc-id="${fn.use_case_id}"
      title="Drag onto a component to assign">
    <div class="fuf-row-main">
      <span class="fuf-icon fun-icon">${IDEF_ICONS.fun}</span>
      <div class="fuf-row-text">
        <span class="fuf-code">${escH(fn.func_code||'')}</span>
        <span class="fuf-name">${escH(fn.name)}</span>
        ${fn.description ? `<span class="fuf-desc">${escH(fn.description)}</span>` : ''}
        ${assigned ? '<span class="idef-fn-assigned-badge">✓ assigned</span>' : ''}
      </div>
    </div>
    <div class="fuf-actions">
      ${idx>0 ? `<button class="fuf-act fuf-up" data-id="${fn.id}" data-idef-type="fun">▲</button>` : ''}
      ${idx<total-1 ? `<button class="fuf-act fuf-dn" data-id="${fn.id}" data-idef-type="fun">▼</button>` : ''}
      <button class="fuf-act fuf-edit" data-id="${fn.id}" data-idef-type="fun">✎</button>
      <button class="fuf-act fuf-del"  data-id="${fn.id}" data-idef-type="fun" data-name="${escH(fn.name)}">✕</button>
    </div>
  </div>`;
}

function renderIdefCols() {
  const body = document.getElementById('arch-idef-body'); if (!body) return;
  if (!_idef.loaded) { body.innerHTML = '<div class="arch-idef-loading">Loading…</div>'; return; }
  body.innerHTML = `<div class="arch-idef-cols" id="arch-idef-cols">
    ${idefFeatColHTML()}${idefUCColHTML()}${idefFunColHTML()}
  </div>`;
  wireIdefCols();
}

function wireIdefCols() {
  const cols = document.getElementById('arch-idef-cols'); if (!cols) return;

  // Row selection (feat / uc)
  cols.addEventListener('click', async e => {
    const row = e.target.closest('.fuf-row[data-idef-type]');
    if (!row || e.target.closest('.fuf-actions')) return;
    const { id, idefType } = row.dataset;
    if (idefType === 'feat') {
      if (_idef.selFeatId === id) return;
      _idef.selFeatId = id; _idef.selUCId = null;
      _idef.useCases = []; _idef.functions = [];
      document.getElementById('idef-col-feat').outerHTML = idefFeatColHTML();
      document.getElementById('idef-col-uc').outerHTML   = idefUCColHTML();
      document.getElementById('idef-col-fun').outerHTML  = idefFunColHTML();
      wireIdefCols();
      const { data } = await sb.from('use_cases').select('*')
        .eq('feature_id', id).order('sort_order').order('created_at');
      _idef.useCases = data || [];
      document.getElementById('idef-col-uc').outerHTML = idefUCColHTML();
      wireIdefCols();
    } else if (idefType === 'uc') {
      if (_idef.selUCId === id) return;
      _idef.selUCId = id; _idef.functions = [];
      document.getElementById('idef-col-uc').outerHTML  = idefUCColHTML();
      document.getElementById('idef-col-fun').outerHTML = idefFunColHTML();
      wireIdefCols();
      const { data } = await sb.from('functions').select('*')
        .eq('use_case_id', id).order('sort_order').order('created_at');
      _idef.functions = data || [];
      document.getElementById('idef-col-fun').outerHTML = idefFunColHTML();
      wireIdefCols();
    }
  });

  // Add buttons
  cols.addEventListener('click', async e => {
    const btn = e.target.closest('#idef-add-feat,#idef-add-uc,#idef-add-fun');
    if (!btn) return; e.stopPropagation();
    await idefAddItem(btn.id.replace('idef-add-',''));
  });

  // Reorder
  cols.addEventListener('click', async e => {
    const btn = e.target.closest('.fuf-up,.fuf-dn');
    if (!btn || !btn.dataset.idefType) return; e.stopPropagation();
    await idefReorder(btn.dataset.idefType, btn.dataset.id, btn.classList.contains('fuf-up') ? -1 : 1);
  });

  // Edit
  cols.addEventListener('click', e => {
    const btn = e.target.closest('.fuf-edit[data-idef-type]');
    if (!btn) return; e.stopPropagation();
    idefInlineEdit(btn.dataset.idefType, btn.dataset.id);
  });

  // Delete
  cols.addEventListener('click', async e => {
    const btn = e.target.closest('.fuf-del[data-idef-type]');
    if (!btn) return; e.stopPropagation();
    const label = {feat:'Feature',uc:'Use Case',fun:'Function'}[btn.dataset.idefType] || 'Item';
    confirmDialog(`Delete ${label} "${btn.dataset.name}"?`, async () => {
      await idefDeleteItem(btn.dataset.idefType, btn.dataset.id);
    });
  });

  // Drag (functions only)
  cols.querySelectorAll('.idef-fn-row[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type:'idef-fn', fnId:row.dataset.id, fnName:row.dataset.fnName, ucId:row.dataset.ucId,
      }));
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
}

async function idefAddItem(type) {
  const projName = _s?.project?.name || '';
  if (type === 'feat') {
    const idx  = await nextIndex('features', { parent_id: _idef.parentId });
    const code = `FEAT-${nameInitials(projName)}-${String(idx).padStart(3,'0')}`;
    const { data, error } = await sb.from('features').insert({
      feat_code: code, parent_type: _idef.parentType, parent_id: _idef.parentId,
      domain: 'system', project_id: _s.project.id,
      name: `Feature ${idx}`, sort_order: _idef.features.length,
    }).select().single();
    if (error) { toast('Error: '+error.message,'error'); return; }
    _idef.features.push(data);
    document.getElementById('idef-col-feat').outerHTML = idefFeatColHTML(); wireIdefCols();
  } else if (type === 'uc') {
    const feat = _idef.features.find(f=>f.id===_idef.selFeatId); if (!feat) return;
    const idx  = await nextIndex('use_cases', { feature_id: _idef.selFeatId });
    const code = `UC-${nameInitials(projName)}-F${feat.feat_code?.split('-').pop()}-${String(idx).padStart(3,'0')}`;
    const { data, error } = await sb.from('use_cases').insert({
      uc_code: code, feature_id: _idef.selFeatId,
      name: `Use Case ${idx}`, sort_order: _idef.useCases.length,
    }).select().single();
    if (error) { toast('Error: '+error.message,'error'); return; }
    _idef.useCases.push(data);
    document.getElementById('idef-col-uc').outerHTML = idefUCColHTML(); wireIdefCols();
  } else if (type === 'fun') {
    const uc = (_idef.useCases||[]).find(u=>u.id===_idef.selUCId); if (!uc) return;
    const feat = _idef.features.find(f=>f.id===_idef.selFeatId);
    const idx  = await nextIndex('functions', { use_case_id: _idef.selUCId });
    const fp = feat?.feat_code?.split('-').pop()||'001', up = uc.uc_code?.split('-').pop()||'001';
    const code = `FUN-${nameInitials(projName)}-F${fp}-U${up}-${String(idx).padStart(3,'0')}`;
    const { data, error } = await sb.from('functions').insert({
      func_code: code, use_case_id: _idef.selUCId,
      name: `Function ${idx}`, sort_order: (_idef.functions||[]).length,
    }).select().single();
    if (error) { toast('Error: '+error.message,'error'); return; }
    if (!_idef.functions) _idef.functions = [];
    _idef.functions.push(data);
    document.getElementById('idef-col-fun').outerHTML = idefFunColHTML(); wireIdefCols();
  }
}

async function idefReorder(type, id, dir) {
  const list = type==='feat'?_idef.features : type==='uc'?_idef.useCases : _idef.functions;
  const idx = list.findIndex(x=>x.id===id), swapIdx = idx+dir;
  if (swapIdx<0||swapIdx>=list.length) return;
  [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
  const table = type==='feat'?'features':type==='uc'?'use_cases':'functions';
  await Promise.all([
    sb.from(table).update({sort_order:swapIdx}).eq('id',list[idx].id),
    sb.from(table).update({sort_order:idx}).eq('id',list[swapIdx].id),
  ]);
  const col = type==='feat'?idefFeatColHTML():type==='uc'?idefUCColHTML():idefFunColHTML();
  const colId = type==='feat'?'idef-col-feat':type==='uc'?'idef-col-uc':'idef-col-fun';
  document.getElementById(colId).outerHTML = col; wireIdefCols();
}

function idefInlineEdit(type, id) {
  const row = document.querySelector(`.fuf-row[data-id="${id}"][data-idef-type="${type}"]`); if (!row) return;
  const list = type==='feat'?_idef.features:type==='uc'?_idef.useCases:_idef.functions;
  const item = list.find(x=>x.id===id); if (!item) return;
  const main = row.querySelector('.fuf-row-main');
  main.innerHTML = `<div class="fuf-edit-form">
    <input class="fuf-input fuf-input-name" id="idef-edit-name" value="${escH(item.name)}" placeholder="Name" autocomplete="off"/>
    <textarea class="fuf-input fuf-input-desc" id="idef-edit-desc" rows="2" placeholder="Description">${escH(item.description||'')}</textarea>
    <div class="fuf-edit-btns">
      <button class="btn btn-primary btn-sm" id="idef-edit-save">✓</button>
      <button class="btn btn-secondary btn-sm" id="idef-edit-cancel">✗</button>
    </div>
  </div>`;
  const inp = row.querySelector('#idef-edit-name'); inp.focus(); inp.select();
  const save = async () => {
    const name = inp.value.trim(); if (!name) return;
    const desc = row.querySelector('#idef-edit-desc').value.trim();
    const table = type==='feat'?'features':type==='uc'?'use_cases':'functions';
    await sb.from(table).update({name, description:desc, updated_at:new Date().toISOString()}).eq('id',id);
    item.name = name; item.description = desc;
    const col = type==='feat'?idefFeatColHTML():type==='uc'?idefUCColHTML():idefFunColHTML();
    const colId = type==='feat'?'idef-col-feat':type==='uc'?'idef-col-uc':'idef-col-fun';
    document.getElementById(colId).outerHTML = col; wireIdefCols();
  };
  row.querySelector('#idef-edit-save').onclick = save;
  row.querySelector('#idef-edit-cancel').onclick = () => {
    const col = type==='feat'?idefFeatColHTML():type==='uc'?idefUCColHTML():idefFunColHTML();
    const colId = type==='feat'?'idef-col-feat':type==='uc'?'idef-col-uc':'idef-col-fun';
    document.getElementById(colId).outerHTML = col; wireIdefCols();
  };
  inp.addEventListener('keydown', e => { if(e.key==='Enter') save(); if(e.key==='Escape') row.querySelector('#idef-edit-cancel').click(); });
}

async function idefDeleteItem(type, id) {
  const table = type==='feat'?'features':type==='uc'?'use_cases':'functions';
  await sb.from(table).delete().eq('id',id);
  if (type==='feat') { _idef.features=_idef.features.filter(x=>x.id!==id); if(_idef.selFeatId===id){_idef.selFeatId=null;_idef.useCases=[];_idef.selUCId=null;_idef.functions=[];} }
  else if (type==='uc') { _idef.useCases=_idef.useCases.filter(x=>x.id!==id); if(_idef.selUCId===id){_idef.selUCId=null;_idef.functions=[];} }
  else { _idef.functions=_idef.functions.filter(x=>x.id!==id); }
  renderIdefCols();
}

async function idefAssignFn(fnId, fnName, ucId, compId) {
  const c = compById(compId); if (!c) return;
  if ((c.functions||[]).some(af => af.function_ref_id === fnId)) {
    toast('Already assigned to this component.', 'info'); return;
  }
  captureUndo();
  const { data, error } = await sb.from('arch_functions').insert({
    component_id: compId, name: fnName, is_safety_related: false,
    sort_order: c.functions?.length || 0, function_ref_id: fnId,
  }).select().single();
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  if (!c.functions) c.functions = [];
  c.functions.push(data);
  refreshComp(compId);
  renderIdefCols();
  toast(`"${fnName}" → ${c.name}`, 'success');
}

// ── Interface Requirements panel ───────────────────────────────────────────────

let _ifreqs = [];

async function loadIfaceReqs() {
  const body = document.getElementById('arch-ifreqs-body');
  if (!body || !_s) return;
  body.innerHTML = '<div class="arch-idef-loading">Loading…</div>';
  const { data, error } = await sb.from('requirements')
    .select('*')
    .eq('parent_type', _s.parentType)
    .eq('parent_id', _s.parentId)
    .eq('type', 'interface')
    .order('created_at', { ascending: true });
  _ifreqs = data || [];
  renderIfaceReqs();
}

function renderIfaceReqs() {
  const body = document.getElementById('arch-ifreqs-body');
  if (!body) return;
  if (!_ifreqs.length) {
    body.innerHTML = '<div class="arch-idef-loading" style="font-style:italic">No interface requirements yet — create a connection to generate one.</div>';
    return;
  }
  body.innerHTML = `
    <div class="arch-ifreqs-table-wrap">
      <table class="arch-ifreqs-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          ${_ifreqs.map(r => `
            <tr class="arch-ifreqs-row" data-req-code="${escH(r.req_code)}" id="ifreq-row-${escH(r.req_code)}">
              <td class="arch-ifreqs-code">${escH(r.req_code)}</td>
              <td class="arch-ifreqs-title">${escH(r.title)}</td>
              <td><span class="arch-ifreqs-badge arch-ifreqs-badge--${r.status}">${r.status}</span></td>
              <td><span class="arch-ifreqs-badge arch-ifreqs-badge--${r.priority}">${r.priority}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function openIfaceReqsPanel(highlightCode) {
  const panel = document.getElementById('arch-ifreqs-panel');
  if (!panel) return;
  panel.style.display = '';
  loadIfaceReqs().then(() => {
    if (highlightCode) highlightIfaceReqRow(highlightCode);
  });
}

function highlightIfaceReqRow(reqCode) {
  const body = document.getElementById('arch-ifreqs-body');
  if (!body) return;
  body.querySelectorAll('.arch-ifreqs-row').forEach(r => r.classList.remove('arch-ifreqs-row--sel'));
  if (!reqCode) return;
  const row = document.getElementById(`ifreq-row-${CSS.escape(reqCode)}`);
  if (row) {
    row.classList.add('arch-ifreqs-row--sel');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
