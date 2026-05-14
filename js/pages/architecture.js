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
import { wireBottomPanel } from '../utils/bottom-panel.js';
import { toast, toastPersist, toastDismiss } from '../toast.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { getFeaturesTree, ICONS as IDEF_ICONS } from './item-definition.js';
import { nextIndex, buildCode, nameInitials } from '../config.js';

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ── Visual constants ──────────────────────────────────────────────────────────

const STYLES = {
  HW:         { bg:'#ffffff', border:'#2563EB', hdr:'transparent', stereotype:'block'      },
  SW:         { bg:'#ffffff', border:'#16A34A', hdr:'transparent', stereotype:'block'      },
  Mechanical: { bg:'#ffffff', border:'#D97706', hdr:'transparent', stereotype:'block'      },
  Group:      { bg:'rgba(248,249,250,0.5)', border:'#6B7280', hdr:'transparent', stereotype:'system' },
  Port:       { bg:'#374151', border:'#374151', hdr:'#374151', stereotype:'port'           },
};

const IFACE = {
  Data:       { stroke:'#1F2937', dash:'',    icon:'⇄', weight:1.5 },
  Electrical: { stroke:'#B45309', dash:'',    icon:'⚡', weight:1.5 },
  Mechanical: { stroke:'#6B7280', dash:'6,3', icon:'⚙', weight:1.5 },
  Thermal:    { stroke:'#9B1C1C', dash:'4,3', icon:'🌡', weight:1.5 },
  Power:      { stroke:'#6D28D9', dash:'',    icon:'⏻', weight:1.5 },
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

  // Sync names from Item Definition: any arch_function with a function_ref_id
  // takes its display name from the live functions table, not the stored snapshot.
  const refIds = [...new Set(funs.map(f => f.function_ref_id).filter(Boolean))];
  if (refIds.length) {
    const { data: liveFns } = await sb.from('functions').select('id,name').in('id', refIds);
    if (liveFns?.length) {
      const nameMap = Object.fromEntries(liveFns.map(f => [f.id, f.name]));
      funs.forEach(f => {
        if (f.function_ref_id && nameMap[f.function_ref_id] !== undefined) {
          f.name = nameMap[f.function_ref_id];
        }
      });
      // Persist updated names back to DB in one go (fire-and-forget)
      for (const f of funs) {
        if (f.function_ref_id && nameMap[f.function_ref_id] !== undefined) {
          sb.from('arch_functions').update({ name: nameMap[f.function_ref_id] }).eq('id', f.id).then();
        }
      }
    }
  }

  const components = compList.map(c => ({
    ...c, functions: funs.filter(f => f.component_id === c.id),
  }));

  // ── Single source of truth: reconcile group_id from geometry ─────────────
  // Any non-Group component whose center is inside a Group's bounds must have
  // data.group_id pointing to that group.  Components outside every group get
  // data.group_id = null.  This fixes stale/missing group_id values so that
  // the tree and the canvas always agree on membership.
  {
    const groups   = components.filter(c => c.comp_type === 'Group');
    const nonGroups = components.filter(c => c.comp_type !== 'Group');
    const now = new Date().toISOString();
    for (const c of nonGroups) {
      const inside = groups.find(g =>
        c.x + c.width  / 2 > g.x && c.x + c.width  / 2 < g.x + g.width &&
        c.y + c.height / 2 > g.y && c.y + c.height / 2 < g.y + g.height
      );
      const correctGid = inside?.id || null;
      const storedGid  = c.data?.group_id || null;
      if (correctGid !== storedGid) {
        c.data = { ...(c.data || {}), group_id: correctGid };
        // Fire-and-forget — update DB silently
        sb.from('arch_components').update({ data: c.data, updated_at: now }).eq('id', c.id).then();
      }
    }
  }

  // ── Sync arch_spec_items for each HW/SW/Mechanical component ───────────────
  // Each such component must have exactly one 'component' spec item linked by
  // component_ref_id.  We upsert missing ones and update system_name if the
  // component moved between groups.
  const specComponents = components.filter(c =>
    c.comp_type === 'HW' || c.comp_type === 'SW' || c.comp_type === 'Mechanical'
  );
  let specItems = [];
  if (specComponents.length) {
    const { data: existingSpec } = await sb.from('arch_spec_items')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .not('component_ref_id', 'is', null);
    specItems = existingSpec || [];

    const specByCompId = Object.fromEntries(specItems.map(s => [s.component_ref_id, s]));
    const sysResData   = sysRes.data || [];

    for (const c of specComponents) {
      // Resolve system name from the group the component belongs to
      const grp        = c.data?.group_id ? components.find(g => g.id === c.data.group_id) : null;
      const linkedSys  = grp?.data?.system_id ? sysResData.find(s => s.id === grp.data.system_id) : null;
      const systemName = linkedSys?.name || grp?.name || '';

      if (specByCompId[c.id]) {
        // Update system_name if it changed
        const existing = specByCompId[c.id];
        if (existing.system_name !== systemName || existing.title !== c.name) {
          const patch = {};
          if (existing.system_name !== systemName) patch.system_name = systemName;
          if (existing.title       !== c.name)     patch.title       = c.name;
          if (Object.keys(patch).length) {
            await sb.from('arch_spec_items').update(patch).eq('id', existing.id).then();
            Object.assign(existing, patch);
          }
        }
      } else {
        // Create missing spec item
        const idx  = await nextIndex('arch_spec_items', { parent_id: parentId });
        const code = buildCode('AS', {
          domain:      parentType === 'item' ? 'ITEM' : 'SYS',
          projectName: project.name,
          index:       idx,
        });
        const { data: newSpec } = await sb.from('arch_spec_items').insert({
          spec_code:        code,
          title:            c.name,
          type:             'component',
          status:           'draft',
          sort_order:       specItems.length,
          parent_type:      parentType,
          parent_id:        parentId,
          project_id:       project.id,
          component_ref_id: c.id,
          system_name:      systemName,
          custom_fields:    {},
        }).select().single();
        if (newSpec) { specItems.push(newSpec); specByCompId[c.id] = newSpec; }
      }
    }
  }

  _s = {
    container, project, item, system,
    parentType, parentId,
    components,
    connections: connRes.data || [],
    projectSystems: sysRes.data || [],
    specItems,
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
          <div class="arch-sep"></div>
        </div>
      </div>
      <div class="arch-workspace">
        <!-- Left component tree with vertical tab -->
        <div class="arch-tree-wrap" id="arch-tree-wrap">
          <div class="arch-side-tab arch-tree-tab" id="arch-tree-tab" title="Toggle component tree">Tree</div>
          <div class="arch-tree-panel" id="arch-tree-panel">
            <div class="arch-tree-hdr">
              <span class="arch-tree-title">Components</span>
              <button class="arch-tb-btn arch-tree-close-btn" id="arch-tree-close" title="Close tree">✕</button>
            </div>
            <div class="arch-tree-body" id="arch-tree-body"></div>
          </div>
        </div>

        <div class="arch-canvas-outer" id="arch-outer">
          <div class="canvas-zoom-fab" id="arch-zoom-fab">
            <button class="czf-btn" id="btn-zoom-in"  title="Zoom in">＋</button>
            <button class="czf-btn" id="btn-zoom-out" title="Zoom out">－</button>
            <button class="czf-btn" id="btn-zoom-fit" title="Fit all">⊡</button>
          </div>
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

        <!-- Right palette with vertical tab -->
        <div class="arch-pal-wrap" id="arch-pal-wrap">
          <div class="arch-side-tab arch-pal-tab" id="arch-pal-tab" title="Toggle panel">Properties</div>
          <div class="arch-palette" id="arch-palette">
          <div class="arch-palette-resize-handle" id="arch-pal-resize"></div>

          <!-- ── Add Block section ── -->
          <div class="arch-pal-sec">
            <button class="arch-pal-sec-hdr" data-target="pal-body-add" data-arrow="pal-arrow-add">
              <span>Add Block</span>
              <span class="arch-pal-arrow" id="pal-arrow-add">▾</span>
            </button>
            <div class="arch-pal-sec-body" id="pal-body-add">
              <div class="arch-palette-items" style="padding:5px">
                <button class="arch-pal-item pal-item-group" data-type="Group">
                  <span class="arch-pal-icon arch-pal-icon-group">⬜</span>System
                </button>
                <button class="arch-pal-item pal-item-assembly" data-type="Assembly">
                  <span class="arch-pal-icon arch-pal-icon-assembly">▭</span>Assembly
                </button>
                <button class="arch-pal-item" data-type="HW">
                  <span class="arch-pal-icon" style="background:#4A6FA5">HW</span>HW Block
                </button>
                <button class="arch-pal-item" data-type="SW">
                  <span class="arch-pal-icon" style="background:#3A7D5C">SW</span>SW Block
                </button>
                <button class="arch-pal-item" data-type="Mechanical">
                  <span class="arch-pal-icon" style="background:#7A5C2E">ME</span>Mech Block
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

          </div><!-- end arch-palette -->
        </div><!-- end arch-pal-wrap -->
      </div>

      <div class="arch-conn-popover" id="arch-sys-pop" style="display:none"></div>
      <div class="arch-fun-tooltip" id="arch-fun-tooltip" style="display:none"></div>


      <!-- Interface Requirements panel (bottom) -->
      <div class="bp-bar bp-collapsed arch-bp-ifreqs" id="arch-ifreqs-panel">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title">⇄ Interface Requirements</span>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body arch-idef-body" id="arch-ifreqs-body">
          <div class="arch-idef-loading">Loading…</div>
        </div>
      </div>

      <!-- Item Definition panel (bottom) -->
      <div class="bp-bar bp-collapsed arch-bp-idef" id="arch-idef-panel">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title">★ Item Definition</span>
          <span class="bp-subtitle">drag a function onto a component to assign it</span>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body arch-idef-body" id="arch-idef-body">
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
  refreshArchTree();
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
  // Ports are rendered as SVG squares in renderConnections — not as HTML elements
  layer.innerHTML = _s.components
    .filter(c => c.comp_type !== 'Group' && c.comp_type !== 'Port')
    .map(c => blockHTML(c))
    .join('');
  _s.components
    .filter(c => c.comp_type !== 'Group' && c.comp_type !== 'Port')
    .forEach(c => wireBlock(c.id));
}

function renderConnections() {
  const g = document.getElementById('arch-conn-g');
  if (!g) return;

  // Connected port IDs (already rendered as endpoint squares by connSVG)
  const connectedPortIds = new Set(_s.connections.flatMap(cn => [cn.source_id, cn.target_id]));

  // Standalone ports (attached to a block but no connection yet) — render as SVG square
  const standalonePorts = _s.components.filter(p =>
    p.comp_type === 'Port' && p.data?.parent_block_id && !connectedPortIds.has(p.id));

  const standaloneSVG = standalonePorts.map(p => {
    const parent = compById(p.data.parent_block_id); if (!parent) return '';
    const portStr = p.data?.attached_side || 'right:0.5';
    const [px, py] = portAbs(parent, portStr);
    const side = portStr.split(':')[0];
    const dir  = p.data?.port_dir || 'inout';
    const ARROW_MAP = { in: { top:'↓', bottom:'↑', left:'→', right:'←' },
                        out:{ top:'↑', bottom:'↓', left:'←', right:'→' },
                        inout:{ top:'↕', bottom:'↕', left:'↔', right:'↔' } };
    const arrow = ARROW_MAP[dir]?.[side] || '◆';
    const ps = CONN_EP_SIZE, fs = 11;
    const offMap = { top:[0,-ps/2], bottom:[0,ps/2], left:[-ps/2,0], right:[ps/2,0] };
    const [ox, oy] = offMap[side] || [ps/2, 0];
    const cx = px + ox, cy = py + oy;
    const isSel = _s.selected === p.id;
    const nameY = side === 'top' ? cy - ps/2 - 4 : cy + ps/2 + 11;
    const nameAnchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
    const nameX = side === 'left' ? cx - ps/2 - 4 : side === 'right' ? cx + ps/2 + 4 : cx;
    return `
      <g class="arch-standalone-port${isSel ? ' arch-standalone-port--sel' : ''}"
         id="sport-${p.id}" data-port-id="${p.id}" style="cursor:pointer;pointer-events:all">
        <rect x="${cx-ps/2}" y="${cy-ps/2}" width="${ps}" height="${ps}" rx="3"
              fill="${isSel ? '#1A73E8' : '#212121'}" stroke="#fff" stroke-width="1.5"
              style="pointer-events:all"/>
        <text x="${cx}" y="${cy + fs*0.38}" text-anchor="middle" font-size="${fs}"
              fill="#fff" font-family="system-ui" font-weight="bold"
              style="pointer-events:none">${arrow}</text>
        <text x="${nameX}" y="${nameY}" text-anchor="${nameAnchor}" font-size="10"
              fill="#444" font-family="system-ui"
              style="pointer-events:none">${escH(p.name)}</text>
        <rect class="arch-sport-drag" x="${cx-ps/2-4}" y="${cy-ps/2-4}"
              width="${ps+8}" height="${ps+8}" rx="4"
              fill="transparent" stroke="${isSel ? '#1A73E8' : 'transparent'}" stroke-width="1.5"
              data-port-id="${p.id}"/>
      </g>`;
  }).join('');

  let bridgesSVG = '';
  try { bridgesSVG = buildBridgesSVG(); } catch(_e) { /* non-critical */ }
  const connsSVG = _s.connections.map(cn => { try { return connSVG(cn); } catch(_){ return ''; } }).join('');
  g.innerHTML = connsSVG + standaloneSVG + bridgesSVG;

  _s.connections.forEach(cn => {
    document.getElementById(`conn-${cn.id}`)
      ?.addEventListener('click', e => { e.stopPropagation(); selectConn(cn.id); });
    document.getElementById(`conn-del-${cn.id}`)
      ?.addEventListener('click', async e => { e.stopPropagation(); await deleteConn(cn.id); });
  });

  // Wire standalone port interactions
  g.querySelectorAll('.arch-standalone-port').forEach(el => {
    const portId = el.dataset.portId;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; // right-click handled by outer right-drag handler
      e.stopPropagation(); e.preventDefault();
      const p = compById(portId); if (!p) return;
      const alreadySelected = _s.selected === portId;
      selectStandalonePort(portId);
      const pos = canvasPos(e);
      if (alreadySelected) {
        captureUndo();
        _s.dragging = { id: portId, startX: pos.x, startY: pos.y, origX: p.x, origY: p.y, isPortSVG: true };
      } else {
        _s.connecting = { sourceId: portId, sourcePort: p.data?.attached_side || 'right:0.5', curX: pos.x, curY: pos.y };
        const tp = document.getElementById('arch-temp');
        if (tp) tp.style.display = '';
      }
    });
    el.addEventListener('click', e => { e.stopPropagation(); });
  });

  // Wire endpoint drag handles
  g.querySelectorAll('.arch-conn-ep').forEach(ep => {
    ep.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; // right-click falls through to outer for port drag
      e.stopPropagation(); e.preventDefault();
      const cn = _s.connections.find(c => c.id === ep.dataset.connId); if (!cn) return;
      const compId = ep.dataset.endpoint === 'source' ? cn.source_id : cn.target_id;
      captureUndo();
      _s.draggingEndpoint = { connId: cn.id, endpoint: ep.dataset.endpoint, compId };
    });
  });
  if (_selectedConnId) {
    document.getElementById(`conn-${_selectedConnId}`)?.classList.add('arch-conn-g--sel');
  }

  // Wire label drag
  g.querySelectorAll('.arch-conn-label-drag').forEach(el => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const cn = _s.connections.find(c => c.id === el.dataset.connId); if (!cn) return;
      const startPos = canvasPos(e);
      const origDx = cn.label_dx || 0, origDy = cn.label_dy || 0;
      const onMove = ev => {
        const p = canvasPos(ev);
        cn.label_dx = origDx + (p.x - startPos.x);
        cn.label_dy = origDy + (p.y - startPos.y);
        renderConnections();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        cn.data = { ...(cn.data||{}), label_dx: cn.label_dx, label_dy: cn.label_dy };
        sb.from('arch_connections').update({ data: cn.data, updated_at: new Date().toISOString() }).eq('id', cn.id).then();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

function selectStandalonePort(portId) {
  _s.selected = portId;
  _selectedConnId = null;
  renderConnections();
  openProps(portId);
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

  const isAssembly = g.data?.subtype === 'assembly';
  return `
    <div class="arch-group ${isAssembly ? 'arch-group--assembly' : ''} ${_s.selected === g.id ? 'arch-group--sel' : ''}"
         id="comp-${g.id}" data-id="${g.id}" data-type="Group"
         style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px">
      <div class="arch-group-hdr" data-drag-id="${g.id}">
        <span class="arch-group-stereo">«${isAssembly ? 'assembly' : 'system'}»</span>
        <span class="arch-group-name" id="cname-${g.id}">${escH(g.name)}</span>
        ${sysLabel}
        ${!isAssembly ? `<button class="arch-group-info-btn" data-comp-id="${g.id}">≡</button>` : ''}
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
      <div class="arch-block-hdr" data-drag-id="${c.id}">
        <span class="arch-block-type-badge" style="color:${safe ? '#C5221F' : st.border}">${c.comp_type}</span>
        <span class="arch-block-name" id="cname-${c.id}">${escH(c.name)}</span>
        ${safe ? '<span class="arch-block-safe-ico">⚠</span>' : ''}
      </div>
      <button class="arch-del-badge" data-del-id="${c.id}" title="Delete (Del)">✕</button>
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
  let d, _opts = null;
  if (ORTHO_ROUTING) {
    _opts = orthoPoints(sx,sy,cn.source_port,tx,ty,cn.target_port);
    d = _orthoD(_opts, 5);
  } else {
    d = bezier(sx,sy,cn.source_port,tx,ty,cn.target_port);
  }
  const iv = IFACE[cn.interface_type] || IFACE.Data;
  // Midpoint for label — on the actual path
  let mx, my;
  if (ORTHO_ROUTING && _opts) {
    [mx,my] = orthoPointAt(_opts, 0.5);
  } else {
    const bd2 = getBezierCtrlPts(cn);
    if (bd2) { const t=0.5,mt=0.5; mx=mt*mt*mt*bd2.x1+3*mt*mt*t*bd2.cx1+3*mt*t*t*bd2.cx2+t*t*t*bd2.x2; my=mt*mt*mt*bd2.y1+3*mt*mt*t*bd2.cy1+3*mt*t*t*bd2.cy2+t*t*t*bd2.y2; }
    else { mx=(sx+tx)/2; my=(sy+ty)/2; }
  }
  const bd = getBezierCtrlPts(cn);

  // EXT label: placed along the bezier ~15% from the system-border port, inside the line
  let ext = '';
  if (cn.is_external && bd) {
    const srcParent = src.comp_type === 'Port' ? compById(src.data?.parent_block_id) : src;
    const tgtParent = tgt.comp_type === 'Port' ? compById(tgt.data?.parent_block_id) : tgt;
    const sysIsSrc = srcParent?.comp_type === 'Group';
    const tExt = sysIsSrc ? 0.15 : 0.85;
    let ex, ey;
    if (ORTHO_ROUTING && _opts) {
      [ex,ey] = orthoPointAt(_opts, tExt);
    } else if (bd) {
      const mt=1-tExt; ex=mt*mt*mt*bd.x1+3*mt*mt*tExt*bd.cx1+3*mt*tExt*tExt*bd.cx2+tExt*tExt*tExt*bd.x2; ey=mt*mt*mt*bd.y1+3*mt*mt*tExt*bd.cy1+3*mt*tExt*tExt*bd.cy2+tExt*tExt*tExt*bd.y2;
    } else { ex=sysIsSrc?sx:tx; ey=sysIsSrc?sy:ty; }
    ext = `<text x="${ex.toFixed(1)}" y="${(ey - 6).toFixed(1)}" text-anchor="middle" class="arch-conn-ext">EXT</text>`;
  }

  // Label — draggable offset (in-memory or persisted in cn.data)
  if (cn.label_dx == null && cn.data?.label_dx != null) cn.label_dx = cn.data.label_dx;
  if (cn.label_dy == null && cn.data?.label_dy != null) cn.label_dy = cn.data.label_dy;
  const lx = mx + (cn.label_dx || 0);
  const ly = my + (cn.label_dy || 0) - 6;
  const labelTxt = escH(cn.name || cn.interface_type);
  const label = `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle"
    class="arch-conn-label arch-conn-label-drag" data-conn-id="${cn.id}"
    style="fill:${iv.stroke};font-size:11px;font-family:system-ui,sans-serif;cursor:move">${labelTxt}</text>`;

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
    const compId = isSrcSide ? cn.source_id : cn.target_id;
    const comp = compById(compId);
    const dir = comp?.data?.port_dir || 'inout';
    if (dir === 'inout') return ARROW_BI[side] || '↔';
    if (dir === 'out')   return ARROW_OUT[side] || '→';
    return ARROW_IN[side] || '←';
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
      ${label}
      ${ext}
      ${portIcon}
      ${epSrc}${epTgt}
      <g class="arch-conn-del-btn" id="conn-del-${cn.id}">
        <circle cx="${(mx+14).toFixed(1)}" cy="${(my-14).toFixed(1)}" r="8" fill="#C5221F" stroke="#fff" stroke-width="1.5"/>
        <text x="${(mx+14).toFixed(1)}" y="${(my-10).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff"
              font-weight="bold" style="pointer-events:none">×</text>
      </g>
    </g>`;
}

// ── Math ──────────────────────────────────────────────────────────────────────

// port string: "side" (legacy) or "side:fraction" (0.0–1.0 along that edge)
function portAbs(comp, portStr) {
  // For attached ports, resolve position from parent block + attached_side
  if (comp.comp_type === 'Port' && comp.data?.parent_block_id) {
    const parent = compById(comp.data.parent_block_id);
    if (parent) return portAbs(parent, comp.data.attached_side || 'right:0.5');
  }
  const w = comp.width || PORT_SIZE, h = comp.height || PORT_SIZE;
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
  const nat = {top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
  const dx = x2-x1, dy = y2-y1;
  // Flip control if target is behind the port's natural exit direction
  const flipSrc = (dx*(nat[s1]?.[0]??1) + dy*(nat[s1]?.[1]??0)) < 0;
  const flipTgt = ((-dx)*(nat[s2]?.[0]??1) + (-dy)*(nat[s2]?.[1]??0)) < 0;
  const o1 = off[s1] ?? [len,0];
  const o2 = off[s2] ?? [-len,0];
  const [cx1,cy1] = [x1 + (flipSrc ? -o1[0] : o1[0]), y1 + (flipSrc ? -o1[1] : o1[1])];
  const [cx2,cy2] = [x2 + (flipTgt ? -o2[0] : o2[0]), y2 + (flipTgt ? -o2[1] : o2[1])];
  return `M${x1} ${y1} C${cx1} ${cy1},${cx2} ${cy2},${x2} ${y2}`;
}

// ── Orthogonal routing (set false to revert to bezier) ────────────────────────
const ORTHO_ROUTING = true;

function orthoPoints(x1, y1, p1, x2, y2, p2) {
  const s1 = portSide(p1) || 'right', s2 = portSide(p2) || 'left';
  const PAD = 24;
  const ex  = { top:[0,-1], right:[1,0], bottom:[0,1], left:[-1,0] };
  const dx = x2-x1, dy = y2-y1;
  const flipSrc = (dx*(ex[s1]?.[0]??1) + dy*(ex[s1]?.[1]??0)) < 0;
  const flipTgt = ((-dx)*(ex[s2]?.[0]??1) + (-dy)*(ex[s2]?.[1]??0)) < 0;
  const raw1 = ex[s1]||[1,0], raw2 = ex[s2]||[-1,0];
  const [e1x,e1y] = flipSrc ? [-raw1[0],-raw1[1]] : raw1;
  const [e2x,e2y] = flipTgt ? [-raw2[0],-raw2[1]] : raw2;
  const ax = x1+e1x*PAD, ay = y1+e1y*PAD;
  const bx = x2+e2x*PAD, by = y2+e2y*PAD;
  const opp = { top:'bottom', bottom:'top', left:'right', right:'left' };
  const eff1 = flipSrc ? (opp[s1]||s1) : s1;
  const eff2 = flipTgt ? (opp[s2]||s2) : s2;
  const h1 = eff1==='right'||eff1==='left', h2 = eff2==='right'||eff2==='left';
  const pts = [[x1,y1],[ax,ay]];
  if (Math.abs(ax-bx)<1 && Math.abs(ay-by)<1) {
    // aligned
  } else if (eff1===eff2) {
    const pad2 = Math.max(Math.abs(ax-bx),Math.abs(ay-by))/2+PAD;
    if (h1) { const mx=eff1==='right'?Math.max(ax,bx)+pad2:Math.min(ax,bx)-pad2; pts.push([mx,ay],[mx,by]); }
    else    { const my=eff1==='bottom'?Math.max(ay,by)+pad2:Math.min(ay,by)-pad2; pts.push([ax,my],[bx,my]); }
  } else if (h1&&h2) { const mx=(ax+bx)/2; pts.push([mx,ay],[mx,by]); }
  else if (!h1&&!h2) { const my=(ay+by)/2; pts.push([ax,my],[bx,my]); }
  else if (h1) { pts.push([bx,ay]); }
  else         { pts.push([ax,by]); }
  pts.push([bx,by],[x2,y2]);
  return pts;
}

function orthoPath(x1, y1, p1, x2, y2, p2) {
  return _orthoD(orthoPoints(x1,y1,p1,x2,y2,p2), 5);
}

// Point at fractional length t (0–1) along an ortho polyline
function orthoPointAt(pts, t) {
  const segs = [];
  let total = 0;
  for (let i=1;i<pts.length;i++) { const l=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]); segs.push(l); total+=l; }
  if (total===0) return pts[0];
  let rem = t * total;
  for (let i=0;i<segs.length;i++) {
    if (rem<=segs[i]) { const f=rem/segs[i]; return [pts[i][0]+(pts[i+1][0]-pts[i][0])*f, pts[i][1]+(pts[i+1][1]-pts[i][1])*f]; }
    rem -= segs[i];
  }
  return pts[pts.length-1];
}

function _orthoD(pts, r) {
  // Remove duplicate consecutive points
  const p = [pts[0]];
  for (let i=1;i<pts.length;i++) {
    if (Math.hypot(pts[i][0]-p[p.length-1][0],pts[i][1]-p[p.length-1][1])>0.5) p.push(pts[i]);
  }
  if (p.length<2) return `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i=1;i<p.length-1;i++) {
    const [px,py]=p[i-1],[cx,cy]=p[i],[nx,ny]=p[i+1];
    const d1=Math.hypot(cx-px,cy-py), d2=Math.hypot(nx-cx,ny-cy);
    if (d1<0.5||d2<0.5){d+=` L${cx.toFixed(1)} ${cy.toFixed(1)}`;continue;}
    const rc=Math.min(r,d1/2,d2/2);
    const t1x=cx-(cx-px)/d1*rc, t1y=cy-(cy-py)/d1*rc;
    const t2x=cx+(nx-cx)/d2*rc, t2y=cy+(ny-cy)/d2*rc;
    d+=` L${t1x.toFixed(1)} ${t1y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${t2x.toFixed(1)} ${t2y.toFixed(1)}`;
  }
  const lp=p[p.length-1];
  return d+` L${lp[0].toFixed(1)} ${lp[1].toFixed(1)}`;
}


function snap(v) { return Math.round(v/GRID)*GRID; }

// ── Crossing detection helpers ────────────────────────────────────────────────

function getBezierCtrlPts(cn) {
  const src = compById(cn.source_id), tgt = compById(cn.target_id);
  if (!src || !tgt) return null;
  const [x1,y1] = portAbs(src, cn.source_port);
  const [x2,y2] = portAbs(tgt, cn.target_port);
  const s1 = portSide(cn.source_port), s2 = portSide(cn.target_port);
  const len = Math.max(50, Math.hypot(x2-x1,y2-y1)*0.4);
  const off = {top:[0,-len],right:[len,0],bottom:[0,len],left:[-len,0]};
  const nat = {top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
  const dx = x2-x1, dy = y2-y1;
  const flipSrc = (dx*(nat[s1]?.[0]??1)+dy*(nat[s1]?.[1]??0)) < 0;
  const flipTgt = ((-dx)*(nat[s2]?.[0]??1)+(-dy)*(nat[s2]?.[1]??0)) < 0;
  const o1 = off[s1]??[len,0], o2 = off[s2]??[-len,0];
  return {
    x1,y1, x2,y2,
    cx1: x1+(flipSrc?-o1[0]:o1[0]), cy1: y1+(flipSrc?-o1[1]:o1[1]),
    cx2: x2+(flipTgt?-o2[0]:o2[0]), cy2: y2+(flipTgt?-o2[1]:o2[1]),
  };
}

function sampleBezierCtrl(bd, n=60) {
  if (!bd) return [];
  const {x1,y1,cx1,cy1,cx2,cy2,x2,y2} = bd;
  const pts = [];
  for (let i=0; i<=n; i++) {
    const t=i/n, mt=1-t;
    pts.push([
      mt*mt*mt*x1+3*mt*mt*t*cx1+3*mt*t*t*cx2+t*t*t*x2,
      mt*mt*mt*y1+3*mt*mt*t*cy1+3*mt*t*t*cy2+t*t*t*y2,
    ]);
  }
  return pts;
}

function segIntersect(p1,p2,p3,p4) {
  const d1x=p2[0]-p1[0], d1y=p2[1]-p1[1];
  const d2x=p4[0]-p3[0], d2y=p4[1]-p3[1];
  const cross = d1x*d2y - d1y*d2x;
  if (!isFinite(cross) || Math.abs(cross) < 1e-8) return null;
  const dx=p3[0]-p1[0], dy=p3[1]-p1[1];
  const t=(dx*d2y-dy*d2x)/cross, u=(dx*d1y-dy*d1x)/cross;
  if (!isFinite(t)||!isFinite(u)||t<0.01||t>0.99||u<0.01||u>0.99) return null;
  return [p1[0]+t*d1x, p1[1]+t*d1y];
}

function findCrossingsBetween(ptsA, ptsB) {
  const hits = [];
  for (let a=0; a<ptsA.length-1; a++) {
    for (let b=0; b<ptsB.length-1; b++) {
      const pt = segIntersect(ptsA[a],ptsA[a+1],ptsB[b],ptsB[b+1]);
      if (!pt) continue;
      // tangent of ptsB at crossing (for bridge orientation)
      const tx=ptsB[b+1][0]-ptsB[b][0], ty=ptsB[b+1][1]-ptsB[b][1];
      const tl=Math.hypot(tx,ty)||1;
      hits.push({ px:pt[0], py:pt[1], tx:tx/tl, ty:ty/tl });
    }
  }
  // Deduplicate crossings that are very close together
  return hits.filter((h,i) => !hits.slice(0,i).some(prev =>
    Math.hypot(h.px-prev.px, h.py-prev.py) < 10));
}

function sampleOrthoPath(cn) {
  const src = compById(cn.source_id), tgt = compById(cn.target_id); if (!src||!tgt) return [];
  const [sx,sy] = portAbs(src, cn.source_port), [tx,ty] = portAbs(tgt, cn.target_port);
  return orthoPoints(sx,sy,cn.source_port,tx,ty,cn.target_port);
}

function buildBridgesSVG() {
  const cns = _s.connections.filter(cn => compById(cn.source_id) && compById(cn.target_id));
  if (cns.length < 2) return '';
  const samples = cns.map(cn => ({ cn, pts: ORTHO_ROUTING ? sampleOrthoPath(cn) : sampleBezierCtrl(getBezierCtrlPts(cn)) }));
  const R = 6;
  let svg = '';
  for (let i=0; i<samples.length; i++) {
    for (let j=i+1; j<samples.length; j++) {
      const crossings = findCrossingsBetween(samples[i].pts, samples[j].pts);
      const color = (IFACE[samples[j].cn.interface_type] || IFACE.Data).stroke;
      const weight = (IFACE[samples[j].cn.interface_type] || IFACE.Data).weight;
      crossings.forEach(({px,py,tx,ty}) => {
        const ax=px-tx*R, ay=py-ty*R, bx=px+tx*R, by=py+ty*R;
        svg += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${R+1}" ry="${R-1}"
          transform="rotate(${(Math.atan2(ty,tx)*180/Math.PI).toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})"
          fill="var(--color-bg, #fff)" stroke="none"/>`;
        svg += `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)} A${(R*1.3).toFixed(1)} ${(R*1.3).toFixed(1)} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}"
          fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round"/>`;
      });
    }
  }
  return svg;
}

// Returns "side:fraction" for the perimeter point closest to (cx,cy) in canvas coords
function nearestPerimeterPoint(comp, cx, cy) {
  // Attached ports: delegate to parent block
  if (comp.comp_type === 'Port' && comp.data?.parent_block_id) {
    const parent = compById(comp.data.parent_block_id);
    if (parent) return comp.data.attached_side || 'right:0.5';
  }
  const w = comp.width || PORT_SIZE;
  const h = comp.height || PORT_SIZE;
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

async function createAttachedPort(blockId, portStr, dir, customName) {
  const blk = compById(blockId); if (!blk) return null;
  // portStr can be 'side' or 'side:fraction' — normalize to side:fraction
  const normStr = portStr?.includes(':') ? portStr : `${portStr}:0.5`;
  const side = normStr.split(':')[0];
  const [px, py] = portAbs(blk, normStr);
  const portCount = _s.components.filter(p => p.comp_type === 'Port' && p.data?.parent_block_id === blockId).length;
  const autoName = customName || `P-${blk.name.substring(0,4).toUpperCase()}-${String(portCount + 1).padStart(2,'0')}`;
  const { data, error } = await sb.from('arch_components').insert({
    parent_type: _s.parentType, parent_id: _s.parentId, project_id: _s.project.id,
    name: autoName,
    comp_type: 'Port',
    x: Math.round(px - PORT_SIZE / 2),
    y: Math.round(py - PORT_SIZE / 2),
    width: PORT_SIZE, height: PORT_SIZE,
    sort_order: _s.components.length,
    data: { parent_block_id: blockId, attached_side: normStr, port_dir: dir },
  }).select().single();
  if (error || !data) { toast('Error creating port: ' + error?.message, 'error'); return null; }
  data.functions = [];
  _s.components.push(data);
  // Ports render as SVG squares via renderConnections — no HTML element needed
  renderConnections();
  return data;
}

// Open a small modal to add a port manually to a block
async function showAddPortModal(blockId, portStr) {
  const blk = compById(blockId); if (!blk) return;
  const normStr = portStr?.includes(':') ? portStr : `${portStr}:0.5`;
  const sideLabels = { top:'Top', right:'Right', bottom:'Bottom', left:'Left' };
  const curSide = normStr.split(':')[0];

  showModal({
    title: `⬡ Add Port — ${escH(blk.name)}`,
    body: `
      <div class="form-grid cols-1">
        <div class="form-group">
          <label class="form-label">Port Name</label>
          <input class="form-input" id="ap-name" placeholder="e.g. P-SYS-01"/>
        </div>
        <div class="form-group">
          <label class="form-label">Direction</label>
          <select class="form-input" id="ap-dir">
            <option value="inout">inout ◆ (bidirectional)</option>
            <option value="in">in ▶ (input)</option>
            <option value="out">out ◀ (output)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Side</label>
          <select class="form-input" id="ap-side">
            ${Object.entries(sideLabels).map(([v,l]) =>
              `<option value="${v}" ${v === curSide ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>`,
    footer: `<button class="btn btn-secondary" id="ap-cancel">Cancel</button>
             <button class="btn btn-primary" id="ap-ok">Add Port</button>`,
  });

  const nameInput = document.getElementById('ap-name');
  const portCount = _s.components.filter(p => p.comp_type === 'Port' && p.data?.parent_block_id === blockId).length;
  nameInput.value = `P-${blk.name.substring(0,4).toUpperCase()}-${String(portCount + 1).padStart(2,'0')}`;
  nameInput.focus(); nameInput.select();

  document.getElementById('ap-cancel').onclick = hideModal;
  document.getElementById('ap-ok').onclick = async () => {
    const name = document.getElementById('ap-name').value.trim();
    const dir  = document.getElementById('ap-dir').value;
    const side = document.getElementById('ap-side').value;
    if (!name) { document.getElementById('ap-name').focus(); return; }
    hideModal();
    // Keep exact fraction from ghost click if side unchanged; otherwise center of chosen side
    const finalPortStr = side === curSide ? normStr : `${side}:0.5`;
    const port = await createAttachedPort(blockId, finalPortStr, dir, name);
    if (!port) return;
    // Standalone port → create external interface requirement
    await createExternalIfaceReq(port, blk);
    selectComp(port.id);
    openProps(port.id);
    toast(`Port "${name}" added.`, 'success');
  };
}

async function createExternalIfaceReq(port, parentBlk) {
  const reqIdx = await nextIndex('requirements', { parent_id: _s.parentId });
  const reqCode = buildCode('REQ', {
    domain: _s.parentType === 'item' ? 'ITEM' : 'SYS',
    projectName: _s.project.name,
    systemName: _s.parentType === 'system' ? (_s.item?.name || '') : undefined,
    index: reqIdx,
  });
  const domain = _s.parentType === 'item' ? 'item' : 'system';
  const { data: existingPage } = await sb.from('nav_pages')
    .select('id').eq('parent_type', _s.parentType).eq('parent_id', _s.parentId)
    .eq('domain', domain).eq('phase', 'requirements').eq('name', 'Interface Requirements')
    .maybeSingle();
  if (!existingPage) {
    const { count } = await sb.from('nav_pages')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId)
      .eq('domain', domain).eq('phase', 'requirements');
    await sb.from('nav_pages').insert({
      parent_type: _s.parentType, parent_id: _s.parentId,
      domain, phase: 'requirements', name: 'Interface Requirements', sort_order: count || 0,
    });
    window.dispatchEvent(new Event('hashchange'));
  }
  const { data: req } = await sb.from('requirements').insert({
    req_code: reqCode,
    parent_type: _s.parentType,
    parent_id: _s.parentId,
    project_id: _s.project.id,
    domain,
    title: `External Interface: ${parentBlk.name} — ${port.name}`,
    type: 'interface_external',
    status: 'draft',
    priority: 'medium',
  }).select().single();
  if (req) {
    // Link req code back to port so we can find it later
    port.data = { ...(port.data || {}), requirement: reqCode };
    await sb.from('arch_components').update({ data: port.data }).eq('id', port.id).then();
    _ifreqs.push(req);
    renderIfaceReqs();
  }
  return reqCode;
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

  // Right-click drag: move any element under cursor regardless of hit zone
  outer.addEventListener('contextmenu', e => e.preventDefault());
  outer.addEventListener('pointerdown', e => {
    if (e.button !== 2) return;
    e.preventDefault(); e.stopPropagation();
    cancelConnect();
    const pos = canvasPos(e);

    // Priority: any port (connected or standalone) by canvas proximity → block → group
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const HIT = CONN_EP_SIZE + 4;
    const nearPort = _s.components.find(p => {
      if (p.comp_type !== 'Port' || !p.data?.parent_block_id) return false;
      const parent = compById(p.data.parent_block_id); if (!parent) return false;
      const [px, py] = portAbs(parent, p.data.attached_side || 'right:0.5');
      return Math.abs(pos.x - px) <= HIT && Math.abs(pos.y - py) <= HIT;
    });
    if (nearPort) {
      captureUndo(); selectStandalonePort(nearPort.id);
      _s.dragging = { id: nearPort.id, startX: pos.x, startY: pos.y, origX: nearPort.x, origY: nearPort.y, isPortSVG: true };
      return;
    }

    // Connection line proximity check (before block so thin lines are reachable)
    const CONN_HIT = 8; // px in canvas coords
    const nearConn = _s.connections.find(cn => {
      const src = compById(cn.source_id), tgt = compById(cn.target_id); if (!src||!tgt) return false;
      const [sx,sy] = portAbs(src, cn.source_port||'right:0.5');
      const [tx,ty] = portAbs(tgt, cn.target_port||'left:0.5');
      const pts = orthoPoints(sx,sy,cn.source_port||'right:0.5',tx,ty,cn.target_port||'left:0.5');
      for (let i=0;i<pts.length-1;i++) {
        const [ax,ay]=pts[i],[bx,by]=pts[i+1];
        const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy); if(len<0.1) continue;
        const t=((pos.x-ax)*dx+(pos.y-ay)*dy)/(len*len);
        const tc=Math.max(0,Math.min(1,t));
        const nx=ax+tc*dx,ny=ay+tc*dy;
        if (Math.hypot(pos.x-nx,pos.y-ny)<=CONN_HIT) return true;
      }
      return false;
    });
    if (nearConn) {
      captureUndo(); selectConn(nearConn.id);
      // Collect both Port endpoints (SVG ports) to drag together
      const srcComp = compById(nearConn.source_id);
      const tgtComp = compById(nearConn.target_id);
      const endpoints = [];
      if (srcComp?.comp_type==='Port' && srcComp.data?.parent_block_id)
        endpoints.push({ id: srcComp.id, origX: srcComp.x, origY: srcComp.y });
      if (tgtComp?.comp_type==='Port' && tgtComp.data?.parent_block_id)
        endpoints.push({ id: tgtComp.id, origX: tgtComp.x, origY: tgtComp.y });
      if (endpoints.length > 0) {
        _s.dragging = { id: endpoints[0].id, startX: pos.x, startY: pos.y,
          origX: endpoints[0].origX, origY: endpoints[0].origY,
          isPortSVG: true, isConnDrag: true, connEndpoints: endpoints };
      }
      return;
    }

    const blockEl = under.find(el => el.classList?.contains('arch-block') && el.dataset.id);
    if (blockEl) {
      const id = blockEl.dataset.id;
      const c = compById(id); if (!c) return;
      captureUndo(); selectComp(id);
      _s.dragging = { id, startX: pos.x, startY: pos.y, origX: c.x, origY: c.y };
      return;
    }

    // Pick the smallest (most specific) group under cursor to avoid moving parents
    const groupEls = under.filter(el => el.classList?.contains('arch-group') && el.dataset.id);
    const groupEl = groupEls.map(el => compById(el.dataset.id)).filter(Boolean)
      .sort((a,b) => (a.width*a.height)-(b.width*b.height))[0];
    if (groupEl) {
      const g = groupEl;
      const id = g.id;
      captureUndo(); selectComp(id);
      const isAssembly = g.data?.subtype === 'assembly';
      const collectGroupDescendants = (gid) => {
        const direct = _s.components.filter(cc => cc.id !== id && cc.data?.group_id === gid);
        const deeper = direct.filter(cc => cc.comp_type === 'Group').flatMap(cc => collectGroupDescendants(cc.id));
        return [...direct, ...deeper];
      };
      const childrenForDrag = isAssembly
        ? [...new Map(collectGroupDescendants(id).map(c=>[c.id,c])).values()]
        : _s.components.filter(cc =>
            cc.id !== id &&
            cc.x+cc.width/2 > g.x && cc.x+cc.width/2 < g.x+g.width &&
            cc.y+cc.height/2 > g.y && cc.y+cc.height/2 < g.y+g.height);
      _s.dragging = { id, startX: pos.x, startY: pos.y, origX: g.x, origY: g.y, isGroup: true,
        childOffsets: childrenForDrag.map(c => ({ id: c.id, dx: c.x-g.x, dy: c.y-g.y })) };
    }
  });

  outer.addEventListener('pointermove', e => { if (_s.connecting && !panStart) updateTempPath(e); });

  // Port placement mode: ghost preview + click to place
  outer.addEventListener('pointermove', e => {
    if (!_s?.portPlacing) return;
    document.querySelectorAll('.arch-port-ghost').forEach(el => el.remove());
    const pos = canvasPos(e);
    const hovComp = _s.components.find(c =>
      c.comp_type !== 'Port' &&
      pos.x >= c.x && pos.x <= c.x + (c.comp_type === 'Port' ? PORT_SIZE : c.width) &&
      pos.y >= c.y && pos.y <= c.y + (c.comp_type === 'Port' ? PORT_SIZE : c.height));
    if (!hovComp) return;
    const portStr = nearestPerimeterPoint(hovComp, pos.x, pos.y);
    const [gx, gy] = portAbs(hovComp, portStr);
    const layer = document.getElementById('arch-comp-layer');
    if (!layer) return;
    const ghost = document.createElement('div');
    ghost.className = 'arch-port-ghost';
    ghost.style.cssText = `left:${Math.round(gx - PORT_SIZE/2)}px;top:${Math.round(gy - PORT_SIZE/2)}px;width:${PORT_SIZE}px;height:${PORT_SIZE}px;`;
    ghost.dataset.blockId = hovComp.id;
    ghost.dataset.portStr = portStr;
    layer.appendChild(ghost);
  });

  outer.addEventListener('click', async e => {
    if (!_s?.portPlacing) return;
    const ghost = document.querySelector('.arch-port-ghost');
    if (!ghost) return;
    const blockId = ghost.dataset.blockId;
    const portStr = ghost.dataset.portStr;
    deactivatePortPlacementMode();
    const blk = compById(blockId); if (!blk) return;
    const port = await createAttachedPort(blockId, portStr, 'inout');
    if (!port) return;
    await createExternalIfaceReq(port, blk);
    selectStandalonePort(port.id);
  });

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
  // Component tree toggle via side tab
  const openTree  = () => { document.getElementById('arch-tree-wrap')?.classList.add('arch-tree-open'); renderArchTree(); };
  const closeTree = () => document.getElementById('arch-tree-wrap')?.classList.remove('arch-tree-open');
  document.getElementById('arch-tree-tab')?.addEventListener('click', () =>
    document.getElementById('arch-tree-wrap')?.classList.contains('arch-tree-open') ? closeTree() : openTree());
  document.getElementById('arch-tree-close')?.addEventListener('click', closeTree);

  // Right palette toggle via side tab (initially open)
  document.getElementById('arch-pal-wrap')?.classList.add('arch-pal-open');
  document.getElementById('arch-pal-tab')?.addEventListener('click', () => {
    const wrap = document.getElementById('arch-pal-wrap');
    wrap?.classList.toggle('arch-pal-open');
  });


  // Interface Requirements panel — bp-bar (lazy load on first expand)
  wireBottomPanel(document.getElementById('arch-ifreqs-panel'), {
    key: 'arch_ifreqs_h',
    defaultH: 220,
    onExpand: () => loadIfaceReqs(),
  });

  // Item Definition panel — bp-bar (load eagerly, content ready when expanded)
  wireBottomPanel(document.getElementById('arch-idef-panel'), {
    key: 'arch_idef_h',
    defaultH: 200,
  });

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
  // Shift: snap cursor to axis perpendicular to exit port direction
  if (e.shiftKey) {
    const side = portSide(_s.connecting.sourcePort);
    if (side === 'left' || side === 'right') pos.y = sy;
    else pos.x = sx;
    _s.connecting.curX = pos.x; _s.connecting.curY = pos.y;
  }
  const tp = document.getElementById('arch-temp');
  // For group source: if cursor is inside the group the curve goes inward — flip source control
  let srcPortForBezier = _s.connecting.sourcePort;
  if (src.comp_type === 'Group') {
    const insideGroup = pos.x > src.x && pos.x < src.x + src.width &&
                        pos.y > src.y && pos.y < src.y + src.height;
    if (insideGroup) {
      const side = portSide(_s.connecting.sourcePort);
      const flipped = { top:'bottom', bottom:'top', left:'right', right:'left' };
      const frac = _s.connecting.sourcePort.includes(':') ? _s.connecting.sourcePort.split(':')[1] : '0.5';
      srcPortForBezier = `${flipped[side] || side}:${frac}`;
    }
  }
  if (tp) tp.setAttribute('d', ORTHO_ROUTING
    ? orthoPath(sx,sy,srcPortForBezier,pos.x,pos.y,'left')
    : bezier(sx,sy,srcPortForBezier,pos.x,pos.y,'left'));

  // Clear previous highlights
  document.querySelectorAll('.arch-group--conn-target,.arch-block--conn-target').forEach(el =>
    el.classList.remove('arch-group--conn-target','arch-block--conn-target'));
  document.querySelectorAll('.arch-standalone-port--conn-target').forEach(el =>
    el.classList.remove('arch-standalone-port--conn-target'));

  // Standalone port hover: check proximity to port center in canvas coords
  const connectedPortIds = new Set(_s.connections.flatMap(cn => [cn.source_id, cn.target_id]));
  const HIT = CONN_EP_SIZE;
  const hovPort = _s.components.find(p => {
    if (p.comp_type !== 'Port' || !p.data?.parent_block_id) return false;
    if (connectedPortIds.has(p.id)) return false;
    if (p.id === _s.connecting.sourceId) return false;
    const parent = compById(p.data.parent_block_id); if (!parent) return false;
    const [px, py] = portAbs(parent, p.data.attached_side || 'right:0.5');
    return Math.abs(pos.x - px) <= HIT && Math.abs(pos.y - py) <= HIT;
  });
  if (hovPort) {
    document.getElementById(`sport-${hovPort.id}`)?.classList.add('arch-standalone-port--conn-target');
    return; // port takes priority — skip block/group highlight
  }

  // Group hover: check canvas coords against group bounds
  const hovGroup = _s.components.find(g =>
    g.comp_type==='Group' && g.id!==_s.connecting.sourceId &&
    pos.x>=g.x && pos.x<=g.x+g.width && pos.y>=g.y && pos.y<=g.y+g.height);
  if (hovGroup) {
    document.getElementById(`comp-${hovGroup.id}`)?.classList.add('arch-group--conn-target');
  } else {
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const hovBlock = under.find(el =>
      el.classList?.contains('arch-block') &&
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
      if (c) sb.from('arch_components').update({ x:c.x, y:c.y, width:c.width, height:c.height, updated_at:now }).eq('id', id).then();
      // Also save group if it was auto-expanded
      if (c && !c.comp_type?.includes('Group') && c.data?.group_id) {
        const grp = compById(c.data.group_id);
        if (grp) sb.from('arch_components').update({ x:grp.x, y:grp.y, width:grp.width, height:grp.height, updated_at:now }).eq('id', grp.id).then();
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
    if (e.key==='Escape') { cancelConnect(); if (_s.portPlacing) deactivatePortPlacementMode(); selectComp(null); showPropsEmpty(); }

    if ((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z')) { e.preventDefault(); undoLast(); }
  };
  const onKeyUp = e => { void e; };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup',   onUp);
  document.addEventListener('keydown',     onKey);
  document.addEventListener('keyup',       onKeyUp);
  window._archCleanup = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('keydown',     onKey);
    document.removeEventListener('keyup',       onKeyUp);
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
    // System groups: geometric containment (always correct regardless of group_id state)
    // Assembly groups: group_id membership (explicit, set when components are dropped inside)
    const isAssembly = g.data?.subtype === 'assembly';
    const collectGroupDescendants = (gid) => {
      const direct = _s.components.filter(cc => cc.id !== id && cc.data?.group_id === gid);
      const deeper = direct.filter(cc => cc.comp_type === 'Group').flatMap(cc => collectGroupDescendants(cc.id));
      return [...direct, ...deeper];
    };
    const childrenForDrag = isAssembly
      ? [...new Map(collectGroupDescendants(id).map(c => [c.id, c])).values()]
      : _s.components.filter(cc =>
          cc.id !== id &&
          cc.x + cc.width/2  > g.x && cc.x + cc.width/2  < g.x + g.width &&
          cc.y + cc.height/2 > g.y && cc.y + cc.height/2 < g.y + g.height
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
  const { id, startX, startY, origX, origY, isGroup, childOffsets, isPortSVG, isConnDrag, connEndpoints } = _s.dragging;
  const c = compById(id); if (!c) return;
  const pos = canvasPos(e);

  // Connection drag: move all Port endpoints together maintaining relative positions
  if (isConnDrag && connEndpoints) {
    const dx = pos.x - startX, dy = pos.y - startY;
    connEndpoints.forEach(ep => {
      const p = compById(ep.id); if (!p?.data?.parent_block_id) return;
      const parent = compById(p.data.parent_block_id); if (!parent) return;
      const portStr = nearestPerimeterPoint(parent, ep.origX + PORT_SIZE/2 + dx, ep.origY + PORT_SIZE/2 + dy);
      const [px,py] = portAbs(parent, portStr);
      p.x = Math.round(px - PORT_SIZE/2);
      p.y = Math.round(py - PORT_SIZE/2);
      p.data = { ...p.data, attached_side: portStr };
    });
    renderConnections();
    return;
  }

  // SVG-rendered port: snap along parent block perimeter, no HTML element to update
  if (isPortSVG && c.comp_type === 'Port' && c.data?.parent_block_id) {
    const parent = compById(c.data.parent_block_id);
    if (parent) {
      let targetPos = { x: pos.x, y: pos.y };
      // Shift: align with the other end of any connection on this port
      if (e.shiftKey) {
        const conn = _s.connections.find(cn => cn.source_id === id || cn.target_id === id);
        if (conn) {
          const otherId = conn.source_id === id ? conn.target_id : conn.source_id;
          const other = compById(otherId);
          if (other) {
            const otherPort = conn.source_id === id ? conn.target_port : conn.source_port;
            const [ox, oy] = portAbs(other, otherPort || 'left:0.5');
            // Snap to whichever axis keeps it closer to cursor
            const dh = Math.abs(pos.y - oy); // distance to go horizontal
            const dv = Math.abs(pos.x - ox); // distance to go vertical
            if (dh <= dv) targetPos = { x: pos.x, y: oy }; // horizontal line
            else          targetPos = { x: ox,    y: pos.y }; // vertical line
          }
        }
      }
      const portStr = nearestPerimeterPoint(parent, targetPos.x, targetPos.y);
      const [px, py] = portAbs(parent, portStr);
      c.x = Math.round(px - PORT_SIZE/2);
      c.y = Math.round(py - PORT_SIZE/2);
      c.data = { ...c.data, attached_side: portStr };
    }
    renderConnections();
    return;
  }

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
  // Reposition ports attached to this block
  if (!isGroup) {
    _s.components
      .filter(p => p.comp_type==='Port' && p.data?.parent_block_id===id)
      .forEach(p => {
        const portStr = p.data?.attached_side || 'right:0.5';
        const [px, py] = portAbs(c, portStr);
        p.x = Math.round(px - PORT_SIZE/2);
        p.y = Math.round(py - PORT_SIZE/2);
      });
  }

  // Auto-expand parent group if component is dragged outside its bounds
  const PAD = 16;
  const grpId = c.data?.group_id;
  if (grpId && !isGroup) {
    const grp = compById(grpId);
    if (grp) {
      let changed = false;
      if (c.x < grp.x + PAD)               { grp.width += grp.x + PAD - c.x; grp.x = c.x - PAD; changed = true; }
      if (c.y < grp.y + PAD)               { grp.height += grp.y + PAD - c.y; grp.y = c.y - PAD; changed = true; }
      if (c.x + c.width > grp.x + grp.width - PAD)  { grp.width = c.x + c.width - grp.x + PAD; changed = true; }
      if (c.y + c.height > grp.y + grp.height - PAD) { grp.height = c.y + c.height - grp.y + PAD; changed = true; }
      if (changed) {
        const gel = document.getElementById(`comp-${grpId}`);
        if (gel) { gel.style.left=grp.x+'px'; gel.style.top=grp.y+'px'; gel.style.width=grp.width+'px'; gel.style.height=grp.height+'px'; }
      }
    }
  }

  renderConnections();
}

function resyncGroupIds(now) {
  const ts = now || new Date().toISOString();
  // System groups (non-assembly Groups) are always top-level — never assign group_id to them
  _s.components.filter(cc => !(cc.comp_type === 'Group' && !cc.data?.subtype)).forEach(cc => {
    const ccx = cc.x + cc.width/2, ccy = cc.y + cc.height/2;
    const containers = _s.components.filter(g =>
      g.comp_type === 'Group' && g.id !== cc.id &&
      ccx > g.x && ccx < g.x+g.width && ccy > g.y && ccy < g.y+g.height);
    const best = containers.sort((a,b) => (a.width*a.height)-(b.width*b.height))[0] || null;
    const newGid = best?.id || null;
    if ((cc.data?.group_id||null) !== newGid) {
      cc.data = { ...(cc.data||{}), group_id: newGid };
      if (!newGid) delete cc.data.group_id;
      sb.from('arch_components').update({ data:cc.data, updated_at:ts }).eq('id', cc.id).then();
    }
  });
}

function handleDragEnd() {
  const { id, isGroup, childOffsets, isConnDrag, connEndpoints } = _s.dragging;
  _s.dragging = null;
  // Connection drag: save all moved Port endpoints
  if (isConnDrag && connEndpoints) {
    const now = new Date().toISOString();
    connEndpoints.forEach(ep => {
      const p = compById(ep.id); if (!p) return;
      sb.from('arch_components').update({ x:p.x, y:p.y, data:p.data, updated_at:now }).eq('id', p.id).then();
    });
    return;
  }
  const c = compById(id); if (!c) return;
  const now = new Date().toISOString();

  if (c.comp_type === 'Group') {
    // Assembly: update system_id based on which system group contains it now
    if (c.data?.subtype === 'assembly') {
      const parentSys = _s.components.find(g =>
        g.comp_type === 'Group' && !g.data?.subtype && g.data?.system_id && g.id !== id &&
        c.x >= g.x && c.x + c.width <= g.x + g.width &&
        c.y >= g.y && c.y + c.height <= g.y + g.height);
      const newSysId = parentSys?.data?.system_id || null;
      const oldSysId = c.data?.system_id || null;
      if (newSysId !== oldSysId) {
        c.data = { ...c.data, system_id: newSysId || undefined };
        if (!newSysId) delete c.data.system_id;
      }
    }
    // Save group position
    sb.from('arch_components').update({ x:c.x, y:c.y, data:c.data, updated_at:now }).eq('id', id).then();
    // Save all child/descendant positions — only assign group_id for direct children (not nested)
    if (childOffsets) {
      childOffsets.forEach(({ id:cid }) => {
        const cc = compById(cid); if (!cc) return;
        const currentGid = cc.data?.group_id || null;
        // Only set group_id=id for direct children (not for nested descendants that belong to a sub-group)
        const isDirectChild = currentGid === null || currentGid === id;
        if (isDirectChild && currentGid !== id) {
          cc.data = { ...(cc.data || {}), group_id: id };
          sb.from('arch_components').update({ x:cc.x, y:cc.y, data:cc.data, updated_at:now }).eq('id', cid).then();
        } else {
          sb.from('arch_components').update({ x:cc.x, y:cc.y, updated_at:now }).eq('id', cid).then();
        }
      });
    }
    resyncGroupIds(new Date().toISOString());
    return;
  }

  // Auto-assign to most specific (smallest area) containing group
  const cx2 = c.x+c.width/2, cy2 = c.y+c.height/2;
  const containingGroups = _s.components.filter(g =>
    g.comp_type==='Group' && g.id!==id &&
    cx2>g.x && cx2<g.x+g.width && cy2>g.y && cy2<g.y+g.height);
  const grp = containingGroups.sort((a,b)=>(a.width*a.height)-(b.width*b.height))[0] || null;
  const gid = grp?.id||null;
  const dataChanged = (c.data?.group_id||null)!==gid;
  if (dataChanged) {
    c.data = {...(c.data||{}), group_id:gid};
    sb.from('arch_components').update({ x:c.x, y:c.y, data:c.data, updated_at:now }).eq('id', id).then();
  } else {
    sb.from('arch_components').update({ x:c.x, y:c.y, updated_at:now }).eq('id', id).then();
  }
  // Save attached ports that moved with this block
  _s.components
    .filter(p => p.comp_type==='Port' && p.data?.parent_block_id===id)
    .forEach(p => {
      sb.from('arch_components').update({ x:p.x, y:p.y, updated_at:now }).eq('id', p.id).then();
    });

  // Save parent group if it was auto-expanded during drag
  const expandedGrp = compById(c.data?.group_id);
  if (expandedGrp) {
    sb.from('arch_components').update({ x:expandedGrp.x, y:expandedGrp.y, width:expandedGrp.width, height:expandedGrp.height, updated_at:now }).eq('id', expandedGrp.id).then();
  }

  // If this IS a port being dragged along its parent edge, save updated attached_side
  if (c.comp_type === 'Port' && c.data?.parent_block_id) {
    sb.from('arch_components').update({ x:c.x, y:c.y, data:c.data, updated_at:now }).eq('id', id).then();
    renderConnections();
  }
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
  // Standalone SVG port (highest priority — explicit port-to-port connection)
  const tSvgPort = under.find(el =>
    (el.classList?.contains('arch-standalone-port') || el.closest?.('.arch-standalone-port')) &&
    el.dataset.portId !== _s.connecting.sourceId);
  const tPort = under.find(el => el.classList?.contains('arch-port'));
  const tComp = under.find(el =>
    el.classList?.contains('arch-block') &&
    el.dataset.id !== _s.connecting.sourceId);
  const tGroup = under.find(el =>
    el.classList?.contains('arch-group') && el.dataset.id !== _s.connecting.sourceId);

  const { sourceId, sourcePort, curX, curY } = _s.connecting;
  _s.connecting = null;

  let targetId=null, targetPort=null;
  const svgPortEl = tSvgPort?.classList?.contains('arch-standalone-port')
    ? tSvgPort : tSvgPort?.closest?.('.arch-standalone-port');
  if (svgPortEl) {
    // Drop on existing standalone port — use it directly
    targetId = svgPortEl.dataset.portId;
    const tc = compById(targetId);
    targetPort = tc?.data?.attached_side || 'left:0.5';
  } else if (tPort && tPort.dataset.compId !== sourceId) {
    targetId = tPort.dataset.compId;
    const tc = compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'left:0.5';
  } else if (tComp) {
    targetId = tComp.dataset.id;
    const tc = compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'left:0.5';
  } else if (tGroup && tGroup.classList.contains('arch-group--conn-target')) {
    targetId = tGroup.dataset.id;
    const tc = compById(targetId);
    targetPort = tc ? nearestPerimeterPoint(tc, curX, curY) : 'right:0.5';
  }

  // Dropped in empty space — cancel silently
  if (!targetId) return;

  const src = compById(sourceId), tgt = compById(targetId);
  const dup = _s.connections.find(cn =>
    (cn.source_id===sourceId&&cn.target_id===targetId)||(cn.source_id===targetId&&cn.target_id===sourceId));
  if (dup) { selectConn(dup.id); return; }

  // Auto-create attached ports when connecting two regular blocks
  showConnPanel(sourceId, sourcePort||'right:0.5', targetId, targetPort||'left:0.5');
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

async function showConnPanel(srcId, srcPort, tgtId, tgtPort) {
  const src=compById(srcId), tgt=compById(tgtId);
  if (!src||!tgt) return;
  const srcGrp = src.data?.group_id||''; const tgtGrp = tgt.data?.group_id||'';
  const isExt  = !!(srcGrp && tgtGrp && srcGrp!==tgtGrp) ||
                  src.comp_type==='Group' || tgt.comp_type==='Group';
  // Internal = both ends in the same group; External = crosses group boundary or group involved
  const reqType = isExt ? 'interface_external' : 'interface_internal';

  captureUndo();

  let finalSrcId = srcId, finalSrcPort = srcPort;
  let finalTgtId = tgtId, finalTgtPort = tgtPort;

  // If endpoint is already an attached Port, use its attached_side as the port string
  if (src.comp_type === 'Port' && src.data?.attached_side) finalSrcPort = src.data.attached_side;
  if (tgt.comp_type === 'Port' && tgt.data?.attached_side) finalTgtPort = tgt.data.attached_side;

  // Topology-based direction: must be defined before autoDir
  const srcInsideTgt = tgt.comp_type === 'Group' && src.data?.group_id === tgt.id;
  const tgtInsideSrc = src.comp_type === 'Group' && tgt.data?.group_id === src.id;
  let srcDir, tgtDir;
  if (srcInsideTgt) {
    srcDir = 'out'; tgtDir = 'out';
  } else if (tgtInsideSrc) {
    srcDir = 'in';  tgtDir = 'in';
  } else {
    srcDir = 'out'; tgtDir = 'in';
  }

  const autoDir = 'A_to_B'; // source always sends to target regardless of topology

  const srcNeedsPort = src.comp_type !== 'Port';
  const tgtNeedsPort = tgt.comp_type !== 'Port';
  if (srcNeedsPort) {
    const p = await createAttachedPort(srcId, srcPort, srcDir);
    if (p) { finalSrcId = p.id; finalSrcPort = p.data.attached_side || 'right:0.5'; }
  }
  if (tgtNeedsPort) {
    const p = await createAttachedPort(tgtId, tgtPort, tgtDir);
    if (p) { finalTgtId = p.id; finalTgtPort = p.data.attached_side || 'left:0.5'; }
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
  const finalSrc = compById(finalSrcId), finalTgt = compById(finalTgtId);
  const srcName = (finalSrc?.comp_type==='Port'&&finalSrc.data?.parent_block_id)
    ? (compById(finalSrc.data.parent_block_id)?.name ?? finalSrc.name) : (finalSrc?.name ?? src.name);
  const tgtName = (finalTgt?.comp_type==='Port'&&finalTgt.data?.parent_block_id)
    ? (compById(finalTgt.data.parent_block_id)?.name ?? finalTgt.name) : (finalTgt?.name ?? tgt.name);

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

  const { data: newReq, error: reqErr } = await sb.from('requirements').insert({
    req_code: reqCode,
    parent_type: _s.parentType,
    parent_id: _s.parentId,
    project_id: _s.project.id,
    domain: _s.parentType === 'item' ? 'item' : 'system',
    title: `${isExt ? 'External' : 'Internal'} Interface: ${srcName} ↔ ${tgtName}`,
    type: reqType,
    status: 'draft',
    priority: 'medium',
  }).select().single();

  if (reqErr) {
    console.error('[arch] requirement insert failed:', reqErr);
    toast(`⚠ Interface created but requirement failed: ${reqErr.message}`, 'error');
  } else {
    console.log('[arch] requirement created:', reqCode, 'type:', reqType, 'parent_id:', _s.parentId);
  }

  await sb.from('arch_connections').update({ requirement: reqCode }).eq('id', data.id).then();
  data.requirement = reqCode;
  if (newReq) _ifreqs.push(newReq);

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
    const { error } = await sb.from('arch_connections').update(patch).eq('id', cn.id).then();
    if (error) { toast('Error: '+error.message,'error'); return; }
    Object.assign(cn, patch); renderConnections();
  }, 600);
  body.querySelector('#pop-itype')?.addEventListener('change', saveConn);
  body.querySelector('#pop-dir')?.addEventListener('change', saveConn);
  body.querySelector('#pop-name')?.addEventListener('input', saveConn);
  body.querySelector('#pop-req')?.addEventListener('input', saveConn);
  body.querySelector('#pop-ext')?.addEventListener('change', saveConn);
}

// ── System Group creation (auto-creates linked system) ────────────────────────

async function showGroupCreationPopover() {
  const { count } = await sb.from('systems')
    .select('id',{count:'exact',head:true}).eq('item_id', _s.item.id);
  const idx = (count||0)+1;
  const sysCode = `SYS-${String(idx).padStart(3,'0')}`;
  const name = sysCode;

  const { data:newSys, error:sysErr } = await sb.from('systems').insert({
    item_id: _s.item.id,
    system_code: sysCode,
    name,
  }).select().single();
  if (sysErr) { toast('Error creating system: '+sysErr.message,'error'); return; }
  _s.projectSystems.push(newSys);
  await createGroup(name, newSys.id);
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

async function createAssembly() {
  captureUndo();
  const count = _s.components.filter(c=>c.comp_type==='Group').length;
  const name = `Assembly-${String(count+1).padStart(2,'0')}`;
  const ax = snap(40+(count%3)*340), ay = snap(40+Math.floor(count/3)*280);
  const aw = 280, ah = 200;
  // Auto-detect parent system group
  const parentSysGrp = _s.components.find(g =>
    g.comp_type === 'Group' && !g.data?.subtype && g.data?.system_id &&
    ax >= g.x && ax + aw <= g.x + g.width &&
    ay >= g.y && ay + ah <= g.y + g.height);
  const assemblyData = { subtype:'assembly', ...(parentSysGrp?.data?.system_id ? { system_id: parentSysGrp.data.system_id } : {}) };
  const { data, error } = await sb.from('arch_components').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    name, comp_type:'Group',
    x:ax, y:ay, width:aw, height:ah, sort_order:_s.components.length,
    data: assemblyData,
  }).select().single();
  if (error) { toast('Error: '+error.message,'error'); return; }
  data.functions=[];
  _s.components.push(data);
  resyncGroupIds();
  renderGroups();
  selectComp(data.id);
  setTimeout(() => startRename(data.id), 60);
}

// ── Properties panel ──────────────────────────────────────────────────────────

function propsPortSection(blockId) {
  const ports = _s.components.filter(p => p.comp_type === 'Port' && p.data?.parent_block_id === blockId);
  const dirIcon = { in:'▶', out:'◀', inout:'◆' };
  const portRows = ports.map(p => `
    <div class="arch-props-port-row" data-port-id="${p.id}">
      <span class="arch-props-port-icon">${dirIcon[p.data?.port_dir||'inout']||'◆'}</span>
      <span class="arch-props-port-name">${escH(p.name)}</span>
      <span class="arch-props-port-side" style="font-size:10px;color:var(--color-text-muted)">${(p.data?.attached_side||'').split(':')[0]}</span>
      <button class="btn-icon arch-pp-select" data-port-id="${p.id}" title="Select">↗</button>
      <button class="btn-icon arch-pp-del" data-port-id="${p.id}" title="Delete" style="color:var(--color-danger)">✕</button>
    </div>`).join('');
  return `
    <div class="arch-props-sep"></div>
    <div class="arch-props-fun-hdr">
      <span>⬡ Ports (${ports.length})</span>
      <button class="arch-tb-btn" id="props-add-port" data-block-id="${blockId}" title="Add port to this block">＋</button>
    </div>
    <div id="props-port-list">${portRows || '<div class="arch-props-note" style="font-size:11px">No ports yet.</div>'}</div>`;
}

function wirePropsPortSection(blockId) {
  const body = document.getElementById('arch-props-body'); if (!body) return;
  body.querySelector('#props-add-port')?.addEventListener('click', async () => {
    const blk = compById(blockId); if (!blk) return;
    const port = await createAttachedPort(blockId, 'right:0.5', 'inout');
    if (!port) return;
    await createExternalIfaceReq(port, blk);
    selectStandalonePort(port.id);
  });
  body.querySelectorAll('.arch-pp-select').forEach(btn => {
    btn.addEventListener('click', () => { selectComp(btn.dataset.portId); openProps(btn.dataset.portId); });
  });
  body.querySelectorAll('.arch-pp-del').forEach(btn => {
    btn.addEventListener('click', () => deleteComp(btn.dataset.portId));
  });
}

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
            <span class="arch-props-fun-name" id="pfn-${f.id}"
              title="${f.function_ref_id ? 'Name managed in Item Definition' : ''}"
            >${escH(f.name)}</span>
            ${f.function_ref_id ? '' : `<button class="btn-icon pf-ren" data-fid="${f.id}" title="Rename">✎</button>`}
            <button class="btn-icon pf-del" data-fid="${f.id}">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
}

function openProps(id) {
  const c = compById(id); if (!c) return;

  const saveComp = async (patch) => {
    Object.assign(c, patch);
    await sb.from('arch_components').update({...patch, updated_at:new Date().toISOString()}).eq('id',id).then();
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
      await sb.from('arch_components').update({ data:c.data, updated_at:new Date().toISOString() }).eq('id',id).then();
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
      ${propsPortSection(id)}
      ${propseFunSection(c)}`);
    document.getElementById('props-name').addEventListener('input', debName);
    document.getElementById('props-sys-link').addEventListener('change', async () => {
      const sysId = document.getElementById('props-sys-link').value||null;
      c.data = {...(c.data||{}), system_id:sysId||undefined};
      if (!sysId) delete c.data.system_id;
      await sb.from('arch_components').update({ data:c.data, updated_at:new Date().toISOString() }).eq('id',id).then();
      refreshComp(id);
    });
    document.getElementById('props-add-fun').onclick = () => openIdefPanel();
    wirePropsPortSection(id);
    wirePropsF(c, id);
    return;
  }

  // ── Block (HW / SW / Mechanical) — show arch-spec fields ────────────────
  const st      = STYLES[c.comp_type] || STYLES.HW;
  const specItem = (_s.specItems || []).find(s => s.component_ref_id === id);

  // Resolve system name
  const grp       = c.data?.group_id ? compById(c.data.group_id) : null;
  const linkedSys = grp?.data?.system_id ? _s.projectSystems.find(s => s.id === grp.data.system_id) : null;
  const sysName   = linkedSys?.name || grp?.name || '—';

  const specStatuses = ['draft', 'review', 'approved'];

  showPropsPanel(`
    <div class="arch-props-hdr" style="border-left:3px solid ${st.border};padding-left:8px">
      ${escH(c.comp_type)} · ${escH(c.name)}
    </div>

    <label class="arch-form-lbl">Name</label>
    <input class="form-input" id="props-name" value="${escH(c.name)}"/>

    <label class="arch-form-lbl">Block type</label>
    <select class="form-input" id="props-type">
      ${['HW','SW','Mechanical'].map(t=>`<option value="${t}" ${c.comp_type===t?'selected':''}>${t}</option>`).join('')}
    </select>

    <label class="arch-form-lbl" style="display:flex;align-items:center;gap:6px;margin-top:6px">
      <input type="checkbox" id="props-safe" ${c.is_safety_critical?'checked':''}/> Safety Critical
    </label>

    <div class="arch-props-sep"></div>

    <div class="arch-props-spec-hdr">📐 Specification</div>

    <label class="arch-form-lbl">Type</label>
    <input class="form-input" value="Component" disabled style="background:#F1F3F4;color:#888"/>

    <label class="arch-form-lbl">System</label>
    <input class="form-input" value="${escH(sysName)}" disabled style="background:#F1F3F4;color:#888"/>

    <label class="arch-form-lbl">Description</label>
    <textarea class="form-input" id="props-spec-desc" rows="4"
      style="font-size:12px;resize:vertical">${escH(specItem?.title || '')}</textarea>

    <label class="arch-form-lbl">Status</label>
    <div class="arch-props-note" style="margin:2px 0 6px">
      <span class="badge badge-${specItem?.status||'draft'}" style="font-size:11px">${specItem?.status||'draft'}</span>
      <span style="font-size:10px;color:var(--color-text-muted);margin-left:6px">Edit in Architecture Specification</span>
    </div>

    ${propsPortSection(id)}
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
  wirePropsPortSection(id);

  // Spec fields — autosave on change/blur
  const saveSpec = debounce(async () => {
    if (!specItem) return;
    const desc = document.getElementById('props-spec-desc')?.value ?? specItem.title;
    if (desc !== specItem.title) {
      specItem.title = desc;
      await sb.from('arch_spec_items').update({ title: desc, updated_at: new Date().toISOString() }).eq('id', specItem.id).then();
    }
  }, 600);

  document.getElementById('props-spec-desc')?.addEventListener('input', saveSpec);

  document.getElementById('props-add-fun').onclick = () => openIdefPanel();
  wirePropsF(c, id);
}

function wirePropsF(c, id) {
  const body = document.getElementById('arch-props-body');
  body?.querySelectorAll('.pf-safe').forEach(chk => {
    chk.onchange = async () => {
      const f=c.functions.find(fn=>fn.id===chk.dataset.fid); if(!f) return;
      f.is_safety_related=chk.checked;
      await sb.from('arch_functions').update({ is_safety_related:chk.checked }).eq('id',f.id).then();
      const anySafe=c.functions.some(fn=>fn.is_safety_related);
      if (anySafe!==c.is_safety_critical) {
        c.is_safety_critical=anySafe;
        await sb.from('arch_components').update({ is_safety_critical:anySafe }).eq('id',id).then();
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
  if (type === 'Group')    { await showGroupCreationPopover(); return; }
  if (type === 'Assembly') { await createAssembly(); return; }
  if (type === 'Port')     { activatePortPlacementMode(); return; }

  const count  = _s.components.length;

  captureUndo();
  const { data, error } = await sb.from('arch_components').insert({
    parent_type:_s.parentType, parent_id:_s.parentId, project_id:_s.project.id,
    name: `${type==='Mechanical'?'MECH':type}-${String(_s.components.filter(x=>x.comp_type===type).length+1).padStart(3,'0')}`,
    comp_type:type,
    x: snap(60+(count%5)*210), y: snap(60+Math.floor(count/5)*180),
    width: 180, height: 130,
    sort_order: count,
    data: {},
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
  if (layer) { layer.insertAdjacentHTML('beforeend', blockHTML(data)); wireBlock(data.id); }
  selectComp(data.id);
  setTimeout(()=>startRename(data.id),60);
}

function activatePortPlacementMode() {
  _s.portPlacing = true;
  const outer = document.getElementById('arch-outer');
  if (outer) outer.classList.add('arch-port-placing');
  toast('Click on a block or system edge to place a port. Press Esc to cancel.', 'info');
}

function deactivatePortPlacementMode() {
  _s.portPlacing = false;
  const outer = document.getElementById('arch-outer');
  if (outer) outer.classList.remove('arch-port-placing');
  document.querySelectorAll('.arch-port-ghost').forEach(el => el.remove());
}

async function deleteComp(id) {
  const c = compById(id); if (!c) return;

  // ── Assembly: offer delete-frame-only vs delete-all ──────────────────────────
  if (c.comp_type === 'Group' && c.data?.subtype === 'assembly') {
    const children = _s.components.filter(b => b.data?.group_id === id);
    const ports    = _s.components.filter(b => b.comp_type === 'Port' &&
      children.some(ch => ch.id === b.data?.parent_block_id));

    const deleteFrameOnly = async () => {
      captureUndo();
      children.forEach(b => {
        b.data = { ...(b.data||{}) }; delete b.data.group_id;
        sb.from('arch_components').update({ data:b.data }).eq('id', b.id).then();
      });
      await sb.from('arch_components').delete().eq('id', id);
      _s.components = _s.components.filter(x => x.id !== id);
      selectComp(null); renderGroups(); renderConnections();
      toast(`Assembly "${c.name}" removed.`, 'success');
    };

    const deleteAll = async () => {
      const allIds = new Set([id, ...children.map(b=>b.id), ...ports.map(p=>p.id)]);
      const affConns = _s.connections.filter(cn => allIds.has(cn.source_id)||allIds.has(cn.target_id));
      captureUndo();
      if (affConns.length) await sb.from('arch_connections').delete().in('id', affConns.map(cn=>cn.id));
      await sb.from('arch_components').delete().in('id', [...allIds]);
      _s.components  = _s.components.filter(x => !allIds.has(x.id));
      _s.connections = _s.connections.filter(cn => !allIds.has(cn.source_id)&&!allIds.has(cn.target_id));
      selectComp(null); renderGroups(); renderConnections();
      toast(`Assembly "${c.name}" and contents deleted.`, 'success');
    };

    showModal({
      title: `Delete Assembly "${escH(c.name)}"`,
      body: `<p>How do you want to delete this assembly?</p>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
            <input type="radio" name="del-asm" value="frame" checked style="margin-top:3px"/>
            <span><strong>Delete assembly frame only</strong><br>
              <span style="font-size:12px;color:var(--color-text-muted)">Components inside remain untouched, just lose their grouping.</span></span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
            <input type="radio" name="del-asm" value="all" style="margin-top:3px"/>
            <span><strong>Delete assembly and all contents</strong><br>
              <span style="font-size:12px;color:var(--color-text-muted)">${children.length} component(s), ${ports.length} port(s) and their connections will be removed.</span></span>
          </label>
        </div>`,
      footer: `
        <button class="btn btn-secondary" id="da-cancel">Cancel</button>
        <button class="btn btn-danger"    id="da-confirm">Delete</button>`,
    });
    document.getElementById('da-cancel').onclick = () => hideModal();
    document.getElementById('da-confirm').onclick = async () => {
      const choice = document.querySelector('input[name="del-asm"]:checked')?.value;
      if (choice === 'all') {
        // Show summary before final confirm
        const children2 = _s.components.filter(b => b.data?.group_id === id);
        const ports2 = _s.components.filter(b => b.comp_type==='Port' &&
          children2.some(ch => ch.id === b.data?.parent_block_id));
        const allIds2 = new Set([id, ...children2.map(b=>b.id), ...ports2.map(p=>p.id)]);
        const affConns2 = _s.connections.filter(cn => allIds2.has(cn.source_id)||allIds2.has(cn.target_id));
        hideModal();
        showModal({
          title: '⚠ Confirm delete all contents',
          body: `<p>The following will be <strong>permanently deleted</strong>:</p>
            <ul style="margin-top:8px;font-size:13px;line-height:1.8">
              ${children2.map(b=>`<li>Block: <strong>${escH(b.name)}</strong></li>`).join('')}
              ${ports2.map(p=>`<li>Port: <strong>${escH(p.name)}</strong></li>`).join('')}
              ${affConns2.map(cn=>{const s=compById(cn.source_id),t=compById(cn.target_id);return`<li>Connection: ${escH(s?.name||'?')} ↔ ${escH(t?.name||'?')}</li>`;}).join('')}
            </ul>`,
          footer: `
            <button class="btn btn-secondary" id="da2-cancel">Cancel</button>
            <button class="btn btn-danger"    id="da2-confirm">Yes, delete everything</button>`,
        });
        document.getElementById('da2-cancel').onclick  = () => hideModal();
        document.getElementById('da2-confirm').onclick = () => { hideModal(); deleteAll(); };
      } else {
        hideModal(); deleteFrameOnly();
      }
    };
    return;
  }

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
        sb.from('arch_components').update({ data: b.data }).eq('id', b.id).then();
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
  if (!cn) return;
  const reqCode = cn?.requirement;

  // Ports attached to each endpoint (only those whose sole connection is this one)
  const endpointIds = [cn.source_id, cn.target_id];
  const attachedPorts = _s.components.filter(p => {
    if (p.comp_type !== 'Port' || !endpointIds.includes(p.id)) return false;
    // Keep port if it has other connections besides this one
    const otherConns = _s.connections.filter(c =>
      c.id !== connId && (c.source_id === p.id || c.target_id === p.id));
    return otherConns.length === 0;
  });

  const doDelete = async (alsoReq, alsoPorts) => {
    captureUndo();
    const { error } = await sb.from('arch_connections').delete().eq('id', connId);
    if (error) { toast('Error: '+error.message,'error'); return; }
    if (alsoReq && reqCode) {
      await sb.from('requirements').delete().eq('req_code', reqCode)
        .eq('parent_type', _s.parentType).eq('parent_id', _s.parentId);
      _ifreqs = _ifreqs.filter(r => r.req_code !== reqCode);
      renderIfaceReqs();
    }
    if (alsoPorts && attachedPorts.length) {
      const portIds = attachedPorts.map(p => p.id);
      await sb.from('arch_components').delete().in('id', portIds);
      _s.components = _s.components.filter(p => !portIds.includes(p.id));
    }
    _s.connections = _s.connections.filter(c => c.id !== connId);
    _selectedConnId = null;
    renderConnections(); showPropsEmpty();
    toast('Connection deleted.', 'success');
  };

  const portNames = attachedPorts.map(p => escH(p.name)).join(', ');
  const portsRow = attachedPorts.length ? `
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer">
      <input type="checkbox" id="dc-del-ports" checked/>
      <span style="font-size:13px">Also delete associated port${attachedPorts.length > 1 ? 's' : ''}: <strong>${portNames}</strong></span>
    </label>` : '';
  const reqRow = reqCode ? `
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer">
      <input type="checkbox" id="dc-del-req" checked/>
      <span style="font-size:13px">Also delete interface requirement: <strong>${escH(reqCode)}</strong></span>
    </label>` : '';

  showModal({
    title: 'Delete Connection',
    body: `
      <p style="margin-bottom:12px">Are you sure you want to delete this connection?</p>
      ${portsRow}${reqRow}
      ${(portsRow || reqRow) ? `<div class="modal-warn-box" style="margin-top:12px">⚠ Deleted items cannot be recovered.</div>` : ''}`,
    footer: `
      <button class="btn btn-secondary" id="dc-cancel">Cancel</button>
      <button class="btn btn-danger" id="dc-confirm">Delete</button>`,
  });
  document.getElementById('dc-cancel').onclick  = () => hideModal();
  document.getElementById('dc-confirm').onclick = () => {
    const alsoPorts = document.getElementById('dc-del-ports')?.checked ?? true;
    const alsoReq   = document.getElementById('dc-del-req')?.checked   ?? true;
    hideModal();
    doDelete(alsoReq, alsoPorts);
  };
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
  // Highlight in tree
  document.querySelectorAll('.arch-tree-node').forEach(el => {
    el.classList.toggle('arch-tree-selected', el.dataset.cid === id);
  });
}

function refreshComp(id) {
  const c=compById(id); if(!c) return;
  const el=document.getElementById(`comp-${id}`); if(!el) return;
  if (c.comp_type==='Group') { el.outerHTML=groupHTML(c); wireGroup(id); }
  else if (c.comp_type==='Port') { el.outerHTML=portHTML(c); wireBlock(id); }
  else { el.outerHTML=blockHTML(c); wireBlock(id); }
  refreshArchTree();
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

// ── Component Tree (left sidebar) ────────────────────────────────────────────

function renderArchTree() {
  const body = document.getElementById('arch-tree-body');
  if (!body) return;

  const TYPE_ICON = { HW: '🔧', SW: '💾', Mechanical: '⚙️', Port: '■', Group: '⬜' };
  const TYPE_COLOR = { HW: '#1A73E8', SW: '#1E8E3E', Mechanical: '#E37400', Port: '#555', Group: '#777' };

  const groups    = _s.components.filter(c => c.comp_type === 'Group');
  const blocks    = _s.components.filter(c => c.comp_type !== 'Group' && c.comp_type !== 'Port');
  const conns     = _s.connections || [];

  // collapsed state persists across re-renders
  if (!renderArchTree._collapsed) renderArchTree._collapsed = new Set();
  const col = renderArchTree._collapsed;

  function nodeId(id) { return `atree-${id}`; }

  function connLabel(cn) {
    const src = _s.components.find(c => c.id === cn.source_id);
    const tgt = _s.components.find(c => c.id === cn.target_id);
    const srcName = src?.name || '?';
    const tgtName = tgt?.name || '?';
    const itype = cn.data?.iface_type || '';
    return `${itype ? itype + ': ' : ''}${srcName} → ${tgtName}`;
  }

  function blockNode(c, depth = 0) {
    const icon  = TYPE_ICON[c.comp_type]  || '▪';
    const color = TYPE_COLOR[c.comp_type] || '#555';
    const fns   = c.functions || [];
    const myConns = conns.filter(cn => cn.source_id === c.id || cn.target_id === c.id);
    const hasChildren = fns.length > 0 || myConns.length > 0;
    const isCol = col.has(c.id);
    const pad   = depth * 14;

    let children = '';
    if (!isCol && hasChildren) {
      const fnRows = fns.map(f =>
        `<div class="arch-tree-leaf" style="padding-left:${pad + 28}px">
          <span class="arch-tree-leaf-icon">λ</span>
          <span class="arch-tree-leaf-label">${escH(f.name)}</span>
        </div>`
      ).join('');
      const cnRows = myConns.map(cn => {
        const other = _s.components.find(cc => cc.id === (cn.source_id === c.id ? cn.target_id : cn.source_id));
        const dir   = cn.source_id === c.id ? '→' : '←';
        const itype = cn.data?.iface_type || 'Link';
        return `<div class="arch-tree-leaf arch-tree-conn-leaf" style="padding-left:${pad + 28}px"
            data-conn-id="${cn.id}" title="Click to select connection">
            <span class="arch-tree-leaf-icon" style="color:#666">${dir}</span>
            <span class="arch-tree-leaf-label" style="color:#555">${escH(itype)}: ${escH(other?.name || '?')}</span>
          </div>`;
      }).join('');
      children = fnRows + cnRows;
    }

    return `<div class="arch-tree-node" id="${nodeId(c.id)}" data-cid="${c.id}"
        style="padding-left:${pad}px">
        <button class="arch-tree-chevron ${hasChildren ? '' : 'arch-tree-chevron-empty'} ${isCol ? 'arch-tree-chevron-col' : ''}"
          data-toggle="${c.id}">▾</button>
        <span class="arch-tree-node-icon" style="color:${color}">${icon}</span>
        <span class="arch-tree-node-label" data-focus="${c.id}">${escH(c.name)}</span>
      </div>${children}`;
  }

  function groupSubtree(g, depth = 0) {
    const isAssembly  = g.data?.subtype === 'assembly';
    const directBlocks = blocks.filter(c => c.data?.group_id === g.id);
    const directAssemblies = _s.components.filter(c => c.comp_type === 'Group' && c.data?.group_id === g.id);
    const myConns  = conns.filter(cn => cn.source_id === g.id || cn.target_id === g.id);
    const isCol    = col.has(g.id);
    const hasKids  = directBlocks.length > 0 || directAssemblies.length > 0 || myConns.length > 0;
    const pad      = depth * 14;
    const icon     = isAssembly ? '▭' : '⬜';
    const color    = isAssembly ? '#6B7280' : '#777';

    let inner = '';
    if (!isCol) {
      inner += directAssemblies.map(a => groupSubtree(a, depth + 1)).join('');
      inner += directBlocks.map(c => blockNode(c, depth + 1)).join('');
      if (myConns.length) {
        inner += myConns.map(cn => {
          const other = _s.components.find(cc => cc.id === (cn.source_id === g.id ? cn.target_id : cn.source_id));
          const dir   = cn.source_id === g.id ? '→' : '←';
          const itype = cn.data?.iface_type || 'Link';
          return `<div class="arch-tree-leaf arch-tree-conn-leaf" style="padding-left:${pad + 14}px"
              data-conn-id="${cn.id}" title="Click to select connection">
              <span class="arch-tree-leaf-icon" style="color:#666">${dir}</span>
              <span class="arch-tree-leaf-label" style="color:#555">${escH(itype)}: ${escH(other?.name || '?')}</span>
            </div>`;
        }).join('');
      }
    }

    return `<div class="arch-tree-node arch-tree-group-node" id="${nodeId(g.id)}" data-cid="${g.id}" style="padding-left:${pad}px">
        <button class="arch-tree-chevron ${hasKids ? '' : 'arch-tree-chevron-empty'} ${isCol ? 'arch-tree-chevron-col' : ''}"
          data-toggle="${g.id}">▾</button>
        <span class="arch-tree-node-icon" style="color:${color}">${icon}</span>
        <span class="arch-tree-node-label" data-focus="${g.id}">${escH(g.name)}</span>
      </div>${inner}`;
  }

  // Only top-level groups (no parent group)
  const topGroups = groups.filter(g => !g.data?.group_id);
  // Ungrouped blocks (not inside any group)
  const ungrouped = blocks.filter(c => !c.data?.group_id);
  const ports     = _s.components.filter(c => c.comp_type === 'Port');

  let html = '';

  if (topGroups.length) {
    html += topGroups.map(g => groupSubtree(g)).join('');
  }
  const freeBlocks = ungrouped.filter(c => c.comp_type !== 'Port');
  if (freeBlocks.length) {
    if (html) html += `<div class="arch-tree-section-sep">Ungrouped</div>`;
    html += freeBlocks.map(c => blockNode(c, 0)).join('');
  }
  if (ports.length) {
    html += `<div class="arch-tree-section-sep">Ports</div>`;
    html += ports.map(c => blockNode(c, 0)).join('');
  }
  if (!html) {
    html = `<div class="arch-tree-empty">No components yet</div>`;
  }

  body.innerHTML = html;

  // Toggle collapse
  body.querySelectorAll('.arch-tree-chevron[data-toggle]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.toggle;
      if (col.has(id)) col.delete(id); else col.add(id);
      renderArchTree();
    });
  });

  // Click label → select + focus component on canvas
  body.querySelectorAll('[data-focus]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const cid = el.dataset.focus;
      selectComp(cid);
      focusComp(cid);
    });
  });

  // Click connection leaf → select connection
  body.querySelectorAll('.arch-tree-conn-leaf[data-conn-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      selectConn(el.dataset.connId);
    });
  });
}

/** Pan + zoom so a component is centered in the viewport. */
function focusComp(cid) {
  const c = compById(cid);
  if (!c) return;
  const outer = document.getElementById('arch-outer');
  if (!outer) return;
  const vw = outer.clientWidth;
  const vh = outer.clientHeight;
  _s.panX = vw / 2 - (c.x + c.width  / 2) * _s.zoom;
  _s.panY = vh / 2 - (c.y + c.height / 2) * _s.zoom;
  applyViewport();
}

/** Refresh tree if it is open (call after any structural change). */
function refreshArchTree() {
  if (document.getElementById('arch-tree-wrap')?.classList.contains('arch-tree-open')) renderArchTree();
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
    await sb.from(table).update({name, description:desc, updated_at:new Date().toISOString()}).eq('id',id).then();
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
    .in('type', ['interface', 'interface_internal', 'interface_external'])
    .order('created_at', { ascending: true });
  _ifreqs = data || [];
  renderIfaceReqs();
}

function _ifreqSystemName(r) {
  // Find the connection linked to this requirement
  const cn = (_s?.connections || []).find(c => c.requirement === r.req_code);
  if (!cn) return '—';
  const src = compById(cn.source_id);
  if (!src) return '—';
  const grp = src.data?.group_id ? compById(src.data.group_id) : null;
  if (!grp) return '—';
  const linkedSys = grp.data?.system_id
    ? (_s.projectSystems || []).find(s => s.id === grp.data.system_id)
    : null;
  return linkedSys?.name || grp.name || '—';
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
            <th>Type</th>
            <th>System</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${_ifreqs.map(r => {
            const ifaceType = r.type === 'interface_external' ? 'External' : r.type === 'interface_internal' ? 'Internal' : '—';
            const ifaceClass = r.type === 'interface_external' ? 'arch-ifreqs-badge--ext' : 'arch-ifreqs-badge--int';
            return `
            <tr class="arch-ifreqs-row" data-req-code="${escH(r.req_code)}" id="ifreq-row-${escH(r.req_code)}">
              <td class="arch-ifreqs-code">${escH(r.req_code)}</td>
              <td class="arch-ifreqs-title">${escH(r.title)}</td>
              <td><span class="arch-ifreqs-badge ${ifaceClass}">${ifaceType}</span></td>
              <td style="font-size:11px;color:var(--color-text-muted);white-space:nowrap">${escH(_ifreqSystemName(r))}</td>
              <td><span class="arch-ifreqs-badge arch-ifreqs-badge--${r.status}">${r.status}</span></td>
            </tr>`; }).join('')}
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
