/**
 * DFMEA — Design Failure Mode and Effects Analysis (VDA DFMEA 2019)
 *
 * Layout:
 *  • Scrollable VDA table with inline editing and autosave
 *  • Resizable bottom panel: Structure Map (live-synced two-way with table)
 *  • Resizable bottom panel: Structure–Function–Failure chain
 *  • "Sync from System" auto-imports components/functions from Architecture + FHA
 *
 * VDA 2019 columns:
 *  ID | Structure Element | Function | Failure Mode | Effect (Higher) | Effect (Local)
 *  | Failure Cause | S | Prevention Controls | O | Detection Controls | D | AP
 *  | Actions | Responsible | Target Date | Action Status
 *
 * Two-way live sync:
 *  - Any edit in the table immediately refreshes the affected component card in the map
 *  - Any edit in the map (dblclick FM row) immediately refreshes the table row
 */

import { sb, buildCode, nextIndex } from '../../config.js';
import { toast } from '../../toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STATUSES = ['open', 'in_progress', 'closed'];
const ITEM_STATUSES   = ['draft', 'review', 'approved'];

// VDA 2019 AP matrix (simplified)
function calcAP(s, o, d) {
  s = +s; o = +o; d = +d;
  if (!s || !o || !d) return '-';
  if (s >= 9) return 'H';
  if (s >= 7) {
    if (o === 1 && d <= 3) return 'L';
    if (o === 1)           return 'M';
    return 'H';
  }
  if (s >= 4) {
    if (o <= 2 && d <= 3) return 'L';
    if (o <= 2)           return 'M';
    if (d <= 3)           return 'M';
    return 'H';
  }
  if (s >= 2) {
    if (o <= 2 && d <= 3) return 'N';
    if (o <= 2)           return 'L';
    return 'M';
  }
  return 'N';
}

const AP_COLORS  = { H: '#C5221F', M: '#E65100', L: '#1E8E3E', N: '#6B778C', '-': '#9AA0A6' };
const IFACE_COLORS = { Data:'#1A73E8', Electrical:'#E37400', Mechanical:'#5D4037', Thermal:'#C5221F', Power:'#7B1FA2' };
const COMP_COLORS  = {
  HW:         { border: '#1A73E8', badge: '#E8F0FE', badgeText: '#1A73E8' },
  SW:         { border: '#1E8E3E', badge: '#E6F4EA', badgeText: '#1E8E3E' },
  Mechanical: { border: '#E37400', badge: '#FEF3E2', badgeText: '#E37400' },
  Group:      { border: '#9AA0A6', badge: '#F8F9FA', badgeText: '#6B778C' },
  Port:       { border: '#212121', badge: '#EEE',    badgeText: '#333'    },
};

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx    = null;   // { project, parentType, parentId }
let _items  = [];     // ordered dfmea rows
let _selId  = null;   // selected row id

// Chain panel state
let _chain = {
  components: [],
  functions:  [],
  selCompId:  null,
  selFuncId:  null,
};

// Structure Map state
let _map        = { components: [], connections: [], functions: [] };
let _mapLoaded  = false;
let _netVisible = true;

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, { project, item, system, parentType, parentId }) {
  _ctx       = { project, parentType, parentId };
  _items     = [];
  _selId     = null;
  _mapLoaded = false;
  _netVisible = true;
  _chain     = { components: [], functions: [], selCompId: null, selFuncId: null };
  _map       = { components: [], connections: [], functions: [] };

  const parentName = system?.name || item?.name || '';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>DFMEA</h1>
          <p class="page-subtitle">Design FMEA · VDA 2019 · ${esc(parentName)}</p>
        </div>
        <div class="dfmea-toolbar">
          <button class="dfmea-tb-btn" id="btn-dfmea-map"   title="Toggle Structure Map">◈ Structure</button>
          <button class="dfmea-tb-btn" id="btn-dfmea-chain" title="Toggle Structure–Function–Failure chain">⬡ Chain</button>
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-dfmea-sync">⟳ Sync from System</button>
          <button class="btn btn-primary   btn-sm" id="btn-dfmea-new" >＋ New Row</button>
        </div>
      </div>
    </div>
    <div class="dfmea-layout" id="dfmea-layout">
      <div class="dfmea-table-area" id="dfmea-table-area">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>

      <!-- Structure Map panel — hidden by default, toggleable -->
      <div class="dfmea-bottom-panel" id="dfmea-map-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-map-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">◈ Structure Map</span>
          <span class="dfmea-panel-hint">Live view — dblclick a failure mode to edit inline</span>
          <button class="dfmea-tb-btn dfmea-net-toggle" id="btn-dfmea-net" title="Show/hide connections">⇄ Net</button>
          <button class="dfmea-tb-btn" id="dfmea-map-close" title="Close">✕</button>
        </div>
        <div class="dfmea-map-body" id="dfmea-map-body">
          <div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Chain panel — hidden by default, toggleable -->
      <div class="dfmea-bottom-panel" id="dfmea-chain-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-chain-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">⬡ Structure — Function — Failure Chain</span>
          <span class="dfmea-panel-hint">Click a component to explore its functions and failure modes</span>
          <button class="dfmea-tb-btn" id="dfmea-chain-close" title="Close">✕</button>
        </div>
        <div class="dfmea-chain-body" id="dfmea-chain-body">
          <div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  wirePanelToggles();
  document.getElementById('btn-dfmea-new').onclick  = () => addRow();
  document.getElementById('btn-dfmea-sync').onclick = () => syncFromSystem();

  await Promise.all([loadItems(), loadChainData()]);
}

// ── Panel toggles & resize ────────────────────────────────────────────────────

function wirePanelToggles() {
  document.getElementById('btn-dfmea-map')?.addEventListener('click', () => {
    const wasHidden = document.getElementById('dfmea-map-panel').style.display === 'none';
    togglePanel('dfmea-map-panel', 'btn-dfmea-map');
    if (wasHidden && !_mapLoaded) { _mapLoaded = true; loadAndRenderMap(); }
    else if (wasHidden)           { renderMap(); }
  });
  document.getElementById('dfmea-map-close')?.addEventListener('click', () => {
    closePanel('dfmea-map-panel', 'btn-dfmea-map');
  });
  document.getElementById('btn-dfmea-net')?.addEventListener('click', () => {
    _netVisible = !_netVisible;
    document.getElementById('btn-dfmea-net')?.classList.toggle('active', _netVisible);
    document.querySelectorAll('.dmap-net-legend').forEach(s => {
      s.style.display = _netVisible ? '' : 'none';
    });
  });
  wireResizeBar('dfmea-map-resize', 'dfmea-map-panel');

  document.getElementById('btn-dfmea-chain')?.addEventListener('click', () => {
    togglePanel('dfmea-chain-panel', 'btn-dfmea-chain');
  });
  document.getElementById('dfmea-chain-close')?.addEventListener('click', () => {
    closePanel('dfmea-chain-panel', 'btn-dfmea-chain');
  });
  wireResizeBar('dfmea-chain-resize', 'dfmea-chain-panel');
}

function togglePanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  document.getElementById(btnId)?.classList.toggle('active', opening);
}

function closePanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = 'none';
  document.getElementById(btnId)?.classList.remove('active');
}

function wireResizeBar(barId, panelId) {
  const bar   = document.getElementById(barId);
  const panel = document.getElementById(panelId);
  if (!bar || !panel) return;
  bar.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    const onMove = mv => { panel.style.height = `${Math.max(120, startH - (mv.clientY - startY))}px`; };
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Load items ────────────────────────────────────────────────────────────────

async function loadItems() {
  const tableArea = document.getElementById('dfmea-table-area');
  if (!tableArea) return;

  const { data, error } = await sb.from('dfmea_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    tableArea.innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-danger)">
          <strong>Error loading dfmea_items:</strong><br>
          <code>${esc(error.message)}</code><br>
          <span style="font-size:11px;color:var(--color-text-muted)">code: ${esc(error.code || '—')}</span>
        </p>
        <p style="margin-top:8px;font-size:13px">
          Run <code>db/migration_dfmea.sql</code> in Supabase SQL Editor.
        </p>
      </div></div>`;
    return;
  }

  _items = data || [];
  renderTable(tableArea);
}

// ── Load architecture data for chain panel ────────────────────────────────────

async function loadChainData() {
  const [{ data: comps }, { data: fns }] = await Promise.all([
    sb.from('arch_components')
      .select('id,name,comp_type')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId)
      .order('sort_order', { ascending: true }),
    sb.from('arch_functions')
      .select('id,component_id,name,is_safety_related')
      .order('sort_order', { ascending: true }),
  ]);

  const compIds = new Set((comps || []).map(c => c.id));
  _chain.components = comps || [];
  _chain.functions  = (fns  || []).filter(f => compIds.has(f.component_id));

  renderChain();
}

// ── Structure Map — data loading ──────────────────────────────────────────────

async function loadAndRenderMap() {
  const body = document.getElementById('dfmea-map-body');
  if (!body) return;
  body.innerHTML = '<div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>';

  const { data: comps } = await sb.from('arch_components')
    .select('id,name,comp_type,data,sort_order')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true });

  const allComps = (comps || []).filter(c => c.comp_type !== 'Port');
  const compIds  = allComps.map(c => c.id);

  const [{ data: conns }, { data: fns }] = await Promise.all([
    compIds.length
      ? sb.from('arch_connections')
          .select('id,source_id,target_id,interface_type,name')
          .in('source_id', compIds)
      : Promise.resolve({ data: [] }),
    compIds.length
      ? sb.from('arch_functions')
          .select('id,component_id,name,is_safety_related')
          .in('component_id', compIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  _map.components  = allComps;
  _map.connections = conns || [];
  _map.functions   = fns  || [];

  renderMap();
}

// ── Structure Map — rendering (module-level so refresh works) ─────────────────

/**
 * Build the HTML string for one component card.
 * Pure function — reads from _items and _map.functions.
 */
function buildMapCompHTML(c) {
  const style  = COMP_COLORS[c.comp_type] || COMP_COLORS.HW;
  const fns    = _map.functions.filter(f => f.component_id === c.id);
  const dItems = _items.filter(it => it.component_id === c.id || it.component_name === c.name);
  const apH    = dItems.filter(it => calcAP(it.severity,it.occurrence,it.detection)==='H').length;
  const apM    = dItems.filter(it => calcAP(it.severity,it.occurrence,it.detection)==='M').length;

  const byFn = {};
  dItems.forEach(it => { const k = it.function_name||''; (byFn[k]||(byFn[k]=[])).push(it); });

  const buildFmRow = it => {
    const ap = calcAP(it.severity,it.occurrence,it.detection);
    return `<div class="dmap-fm-row" data-dfmea-id="${it.id}">
      <span class="dmap-fm-icon">⚡</span>
      <span class="dmap-fm-label" data-edit-field="failure_mode">${esc(it.failure_mode||'—')}</span>
      <span class="dmap-sod">
        <span class="dmap-sod-val" data-edit-field="severity"   title="Severity">S:${it.severity}</span>
        <span class="dmap-sod-val" data-edit-field="occurrence" title="Occurrence">O:${it.occurrence}</span>
        <span class="dmap-sod-val" data-edit-field="detection"  title="Detection">D:${it.detection}</span>
      </span>
      <span class="dfmea-ap-badge sm" style="background:${AP_COLORS[ap]||'#9AA0A6'}">${ap}</span>
    </div>`;
  };

  const fnRows = fns.map(f => {
    const items  = byFn[f.name] || [];
    const fmRows = items.map(buildFmRow).join('');
    return `<div class="dmap-fn-entry${f.is_safety_related?' safety':''}">
      <div class="dmap-fn-hdr">
        <span class="dmap-fn-ico">${f.is_safety_related?'🔗':'⚙'}</span>
        <span class="dmap-fn-name">${esc(f.name)}</span>
        ${items.length?`<span class="dmap-fn-count">${items.length} FM</span>`:''}
      </div>${fmRows}</div>`;
  }).join('');

  const orphans = (byFn['']||[]).map(buildFmRow).join('');
  const nid     = `dmap-c-${c.id}`;

  return `<div class="dmap-comp-node" id="${nid}" data-comp-id="${c.id}">
    <div class="dmap-comp-hdr" style="border-left:4px solid ${style.border}">
      <span class="dmap-comp-type-badge" style="background:${style.badge};color:${style.badgeText}">${esc(c.comp_type)}</span>
      <span class="dmap-comp-name">${esc(c.name)}</span>
      <span class="dmap-risk-badges">
        ${apH?`<span class="dmap-risk-badge H">H:${apH}</span>`:''}
        ${apM?`<span class="dmap-risk-badge M">M:${apM}</span>`:''}
      </span>
      <button class="dmap-collapse-btn" data-target="${nid}-body">▼</button>
    </div>
    <div class="dmap-comp-body" id="${nid}-body">
      ${fnRows||orphans
        ? fnRows+(orphans?`<div class="dmap-fn-entry"><div class="dmap-fn-hdr"><span class="dmap-fn-ico">⚙</span><span class="dmap-fn-name" style="color:var(--color-text-muted)">unassigned</span></div>${orphans}</div>`:'')
        : '<div class="dmap-empty-hint" style="padding:6px 10px">No functions or DFMEA data yet</div>'}
    </div>
  </div>`;
}

/**
 * Wire all interactive behaviours on a rendered component card node.
 */
function wireMapCompNode(node, c) {
  // Collapse toggle
  node.querySelectorAll('.dmap-collapse-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = document.getElementById(btn.dataset.target);
      if (!t) return;
      btn.textContent = t.classList.toggle('collapsed') ? '▶' : '▼';
    });
  });

  // FM rows — click = select + scroll table; dblclick on label/SOD = inline edit
  node.querySelectorAll('.dmap-fm-row').forEach(row => {
    const id = row.dataset.dfmeaId;
    const it = _items.find(i => i.id === id);
    if (!it) return;

    // Single click → select + scroll table
    row.addEventListener('click', e => {
      if (e.target.closest('.dmap-sod-val,.dmap-fm-label')) return; // handled below
      selectRow(id);
      document.querySelector(`.dfmea-row[data-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    // Dblclick on FM label → edit failure_mode
    row.querySelector('.dmap-fm-label')?.addEventListener('dblclick', e => {
      e.stopPropagation();
      openMapInlineText(e.target, it, 'failure_mode', c);
    });

    // Dblclick on S/O/D values → edit numeric field
    row.querySelectorAll('.dmap-sod-val').forEach(span => {
      span.addEventListener('dblclick', e => {
        e.stopPropagation();
        const field = span.dataset.editField;
        openMapInlineNum(span, it, field, c);
      });
    });
  });
}

/**
 * Inline text edit for a map element (failure_mode etc.)
 */
function openMapInlineText(el, it, field, comp) {
  if (el.querySelector('input,textarea')) return;
  const cur = it[field] || '';
  const w   = Math.max(el.offsetWidth, 120);
  el.innerHTML = `<input class="dmap-inline-input" value="${esc(cur)}" style="width:${w}px">`;
  const inp = el.querySelector('input');
  inp.focus();
  inp.select();

  const commit = async () => {
    const newVal = inp.value.trim();
    it[field] = newVal;
    el.textContent = newVal || '—';
    await autosave(it.id, { [field]: newVal });
    refreshTableRow(it);
    refreshMapComp(comp.id);
  };

  inp.addEventListener('blur',    commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { el.textContent = cur || '—'; }
  });
}

/**
 * Inline numeric edit for S/O/D in a map FM row.
 */
function openMapInlineNum(el, it, field, comp) {
  if (el.querySelector('input')) return;
  const cur    = it[field] || 5;
  const prefix = field === 'severity' ? 'S' : field === 'occurrence' ? 'O' : 'D';
  el.innerHTML = `<input class="dmap-inline-num" type="number" min="1" max="10" value="${cur}" style="width:38px">`;
  const inp = el.querySelector('input');
  inp.focus();
  inp.select();

  const commit = async () => {
    const val = Math.min(10, Math.max(1, +inp.value || cur));
    it[field]    = val;
    el.textContent = `${prefix}:${val}`;
    await autosave(it.id, { [field]: val });
    refreshTableRow(it);
    refreshMapComp(comp.id);
  };

  inp.addEventListener('blur',    commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { el.textContent = `${prefix}:${cur}`; }
  });
}

/**
 * Re-render a single component card in the map (after any change).
 * Preserves collapse state.
 */
function refreshMapComp(compIdOrName) {
  const map = document.getElementById('dfmea-map-body');
  if (!map) return;
  const comp = _map.components.find(c => c.id === compIdOrName || c.name === compIdOrName);
  if (!comp) return;
  const nid = `dmap-c-${comp.id}`;
  const existing = document.getElementById(nid);
  if (!existing) return;

  // Preserve collapse state
  const bodyCollapsed = document.getElementById(`${nid}-body`)?.classList.contains('collapsed');

  // Replace element
  const tmp = document.createElement('div');
  tmp.innerHTML = buildMapCompHTML(comp);
  const newNode = tmp.firstElementChild;
  existing.replaceWith(newNode);

  // Restore collapse state
  if (bodyCollapsed) {
    document.getElementById(`${nid}-body`)?.classList.add('collapsed');
    newNode.querySelector('.dmap-collapse-btn')?.textContent === '▼' &&
      (newNode.querySelector('.dmap-collapse-btn').textContent = '▶');
  }

  wireMapCompNode(newNode, comp);
}

/**
 * Full map re-render (used on open/toggle).
 */
function renderMap() {
  const body = document.getElementById('dfmea-map-body');
  if (!body) return;

  const allComps = _map.components;
  if (!allComps.length) {
    body.innerHTML = '<div class="dfmea-chain-empty" style="padding:32px">No components found in Architecture Concept. Build the architecture first.</div>';
    return;
  }

  const groups    = allComps.filter(c => c.comp_type === 'Group');
  const leafComps = allComps.filter(c => c.comp_type !== 'Group');

  const branch = (id, children) => `
    <div class="dmap-connector"><div class="dmap-conn-h"></div></div>
    <div class="dmap-tree-branch">
      <div class="dmap-tree-branch-line"></div>
      <div class="dmap-tree-branch-children" id="${id}">${children}</div>
    </div>`;

  const renderGroup = g => {
    const children = leafComps.filter(c => c.data?.group_id === g.id);
    const bid = `dmap-g-${g.id}`;
    return `<div class="dmap-sys-row">
      <div class="dmap-sys-card">
        <span class="dmap-sys-icon">⬡</span>
        <span class="dmap-sys-name">${esc(g.name)}</span>
        <button class="dmap-collapse-btn" data-target="${bid}">▼</button>
      </div>
      ${branch(bid, children.map(c => buildMapCompHTML(c)).join('') || '<div class="dmap-empty-hint" style="padding:6px 10px">No components</div>')}
    </div>`;
  };

  const ungrouped  = leafComps.filter(c => !c.data?.group_id);
  const rootId     = 'dmap-root-body';
  const systemsHTML = groups.map(renderGroup).join('') + ungrouped.map(c => buildMapCompHTML(c)).join('');

  const compMap  = Object.fromEntries(allComps.map(c=>[c.id,c]));
  const netChips = _netVisible ? _map.connections.slice(0,15).map(cn => {
    const s = compMap[cn.source_id], t = compMap[cn.target_id];
    if (!s||!t) return '';
    const clr = IFACE_COLORS[cn.interface_type]||'#9AA0A6';
    return `<span class="dmap-conn-chip" style="border-color:${clr}">
      <span style="color:${clr}">→</span>${esc(s.name)} → ${esc(t.name)}
      ${cn.interface_type?`<span class="dmap-conn-type" style="color:${clr}">${esc(cn.interface_type)}</span>`:''}
    </span>`;
  }).filter(Boolean).join('') : '';

  body.innerHTML = `
    ${netChips ? `<div class="dmap-net-legend">${netChips}</div>` : ''}
    <div class="dmap-root-row">
      <div class="dmap-root-card">
        <span class="dmap-root-icon">◈</span>
        <span class="dmap-root-name">${esc(_ctx.parentType === 'item' ? (_ctx.project?.name||'Item') : 'System')}</span>
        <button class="dmap-collapse-btn" data-target="${rootId}">▼</button>
      </div>
      <div class="dmap-connector"><div class="dmap-conn-h"></div></div>
      <div class="dmap-tree-branch">
        <div class="dmap-tree-branch-line"></div>
        <div class="dmap-tree-branch-children" id="${rootId}">
          ${systemsHTML || '<div class="dmap-empty-hint" style="padding:8px 12px">No systems or components in Architecture Concept yet</div>'}
        </div>
      </div>
    </div>`;

  // Wire collapse buttons on root + group nodes (comp nodes wired via wireMapCompNode)
  body.querySelectorAll('.dmap-root-card .dmap-collapse-btn, .dmap-sys-card .dmap-collapse-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = document.getElementById(btn.dataset.target);
      if (!t) return;
      btn.textContent = t.classList.toggle('collapsed') ? '▶' : '▼';
    });
  });

  // Wire all component cards
  leafComps.forEach(c => {
    const node = document.getElementById(`dmap-c-${c.id}`);
    if (node) wireMapCompNode(node, c);
  });
}

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable(tableArea) {
  if (!_items.length) {
    tableArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠</div>
        <h3>No DFMEA entries yet</h3>
        <p>Click <strong>＋ New Row</strong> to add manually, or <strong>⟳ Sync from System</strong> to auto-import from Architecture and FHA.</p>
      </div>`;
    return;
  }

  tableArea.innerHTML = `
    <div class="dfmea-table-wrap">
      <table class="dfmea-table">
        <thead>
          <tr>
            <th class="dfmea-col-id">ID</th>
            <th class="dfmea-col-comp">Structure Element</th>
            <th class="dfmea-col-func">Function</th>
            <th class="dfmea-col-fm">Failure Mode</th>
            <th class="dfmea-col-eff">Effect — Higher Level</th>
            <th class="dfmea-col-eff">Effect — Local</th>
            <th class="dfmea-col-fc">Failure Cause</th>
            <th class="dfmea-col-sod" title="Severity">S</th>
            <th class="dfmea-col-ctrl">Prevention Controls</th>
            <th class="dfmea-col-sod" title="Occurrence">O</th>
            <th class="dfmea-col-ctrl">Detection Controls</th>
            <th class="dfmea-col-sod" title="Detection">D</th>
            <th class="dfmea-col-ap"  title="Action Priority">AP</th>
            <th class="dfmea-col-actions">Recommended Actions</th>
            <th class="dfmea-col-resp">Responsible</th>
            <th class="dfmea-col-date">Target Date</th>
            <th class="dfmea-col-astatus">Action Status</th>
            <th class="dfmea-col-status">Status</th>
            <th class="dfmea-col-del"></th>
          </tr>
        </thead>
        <tbody id="dfmea-tbody"></tbody>
      </table>
    </div>`;

  const tbody = document.getElementById('dfmea-tbody');
  _items.forEach(it => appendRow(tbody, it));
}

function appendRow(tbody, it) {
  const tr = buildRowEl(it);
  tbody.appendChild(tr);
  wireRow(tr, it);
}

function buildRowEl(it) {
  const tr = document.createElement('tr');
  tr.dataset.id = it.id;
  tr.className  = `dfmea-row${_selId === it.id ? ' selected' : ''}`;
  tr.innerHTML  = rowHTML(it);
  return tr;
}

function rowHTML(it) {
  const ap    = calcAP(it.severity, it.occurrence, it.detection);
  const apClr = AP_COLORS[ap] || '#9AA0A6';
  return `
    <td class="dfmea-col-id code-cell">${esc(it.dfmea_code)}</td>
    <td class="dfmea-col-comp dfmea-editable" data-field="component_name">${cellText(it.component_name)}</td>
    <td class="dfmea-col-func dfmea-editable" data-field="function_name">${cellText(it.function_name)}</td>
    <td class="dfmea-col-fm   dfmea-editable" data-field="failure_mode">${cellText(it.failure_mode)}</td>
    <td class="dfmea-col-eff  dfmea-editable" data-field="effect_higher">${cellText(it.effect_higher)}</td>
    <td class="dfmea-col-eff  dfmea-editable" data-field="effect_local">${cellText(it.effect_local)}</td>
    <td class="dfmea-col-fc   dfmea-editable" data-field="failure_cause">${cellText(it.failure_cause)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.severity}"   data-field="severity">
    </td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="prevention_controls">${cellText(it.prevention_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.occurrence}" data-field="occurrence">
    </td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="detection_controls">${cellText(it.detection_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.detection}"  data-field="detection">
    </td>
    <td class="dfmea-col-ap">
      <span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>
    </td>
    <td class="dfmea-col-actions dfmea-editable" data-field="actions">${cellText(it.actions)}</td>
    <td class="dfmea-col-resp   dfmea-editable" data-field="responsible">${cellText(it.responsible)}</td>
    <td class="dfmea-col-date   dfmea-editable" data-field="target_date">${cellText(it.target_date)}</td>
    <td class="dfmea-col-astatus">
      <select class="dfmea-sel" data-field="action_status">
        ${ACTION_STATUSES.map(s => `<option value="${s}" ${it.action_status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-col-status">
      <select class="dfmea-sel" data-field="status">
        ${ITEM_STATUSES.map(s => `<option value="${s}" ${it.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-col-del">
      <button class="btn btn-ghost btn-xs dfmea-del-btn" title="Delete" style="color:var(--color-danger)">✕</button>
    </td>
  `;
}

function cellText(val) {
  if (!val) return `<span class="dfmea-placeholder">—</span>`;
  return `<span class="dfmea-cell-text">${esc(val)}</span>`;
}

// ── Row wiring ────────────────────────────────────────────────────────────────

function wireRow(tr, it) {
  tr.addEventListener('click', e => {
    if (e.target.closest('input,select,button')) return;
    selectRow(it.id);
  });

  // Text cells — dblclick to edit
  tr.querySelectorAll('.dfmea-editable').forEach(td => {
    const field = td.dataset.field;

    td.addEventListener('dblclick', () => {
      if (td.querySelector('textarea')) return;
      const cur = it[field] || '';
      td.innerHTML = `<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea>`;
      const ta = td.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      ta.addEventListener('blur', async () => {
        const newVal = ta.value.trim();
        td.innerHTML = cellText(newVal);
        if (newVal === (it[field] || '')) return;
        it[field] = newVal;
        await autosave(it.id, { [field]: newVal });
        if (field === 'component_name' || field === 'function_name') renderChain();
        refreshMapComp(it.component_id || it.component_name);
      });

      ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { td.innerHTML = cellText(it[field] || ''); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
      });
    });
  });

  // S/O/D numeric inputs
  tr.querySelectorAll('.dfmea-sod-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const field = inp.dataset.field;
      const val   = Math.min(10, Math.max(1, +inp.value || 5));
      inp.value = val;
      it[field] = val;
      await autosave(it.id, { [field]: val });
      // Refresh AP badge in table
      const apCell = tr.querySelector('.dfmea-col-ap');
      if (apCell) {
        const ap    = calcAP(it.severity, it.occurrence, it.detection);
        const apClr = AP_COLORS[ap] || '#9AA0A6';
        apCell.innerHTML = `<span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>`;
      }
      // Refresh map card
      refreshMapComp(it.component_id || it.component_name);
    });
  });

  // Select fields
  tr.querySelectorAll('.dfmea-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      it[field] = sel.value;
      await autosave(it.id, { [field]: sel.value });
    });
  });

  // Delete button
  tr.querySelector('.dfmea-del-btn').addEventListener('click', () => deleteRow(it));
}

// ── Refresh a single table row from _items ────────────────────────────────────

function refreshTableRow(it) {
  const tr = document.querySelector(`.dfmea-row[data-id="${it.id}"]`);
  if (!tr) return;
  tr.innerHTML = rowHTML(it);
  wireRow(tr, it);
}

// ── Row selection ─────────────────────────────────────────────────────────────

function selectRow(id) {
  _selId = id;
  document.querySelectorAll('.dfmea-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.id === id);
  });
  const it = _items.find(i => i.id === id);
  if (it?.component_id) {
    _chain.selCompId = it.component_id;
    _chain.selFuncId = null;
    renderChain();
  }
}

// ── Chain panel ───────────────────────────────────────────────────────────────

function renderChain() {
  const body = document.getElementById('dfmea-chain-body');
  if (!body) return;

  const comps  = _chain.components;
  const fns    = _chain.functions;

  const selFns = _chain.selCompId
    ? fns.filter(f => f.component_id === _chain.selCompId)
    : [];

  const selFMs = _chain.selFuncId
    ? _items.filter(it => {
        const fn = selFns.find(f => f.id === _chain.selFuncId);
        return fn && it.function_name === fn.name;
      })
    : (_chain.selCompId
        ? _items.filter(it => it.component_id === _chain.selCompId || it.component_name === comps.find(c=>c.id===_chain.selCompId)?.name)
        : []);

  body.innerHTML = `
    <div class="dfmea-chain">
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⬡</span> Structure Element</div>
        <div class="dfmea-chain-cards" id="chain-col-comp">
          ${comps.length
            ? comps.map(c => `
              <div class="dfmea-chain-card ${_chain.selCompId===c.id?'active':''}" data-comp-id="${c.id}">
                <div class="dfmea-chain-card-type">${esc(c.comp_type||'')}</div>
                <div class="dfmea-chain-card-name">${esc(c.name)}</div>
                <div class="dfmea-chain-card-count">${countItems(c)}</div>
              </div>`).join('')
            : '<div class="dfmea-chain-empty">No components in Architecture Concept.<br>Add components there first.</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚙</span> Function</div>
        <div class="dfmea-chain-cards" id="chain-col-func">
          ${!_chain.selCompId
            ? '<div class="dfmea-chain-empty">← Select a component</div>'
            : selFns.length
              ? selFns.map(f => `
                <div class="dfmea-chain-card ${_chain.selFuncId===f.id?'active':''} ${f.is_safety_related?'safety':''}" data-func-id="${f.id}">
                  ${f.is_safety_related ? '<span class="dfmea-chain-safety-tag">Safety</span>' : ''}
                  <div class="dfmea-chain-card-name">${esc(f.name)}</div>
                  <div class="dfmea-chain-card-count">${countFMsForFunc(f)} FM</div>
                </div>`).join('')
              : '<div class="dfmea-chain-empty">No functions for this component</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚠</span> Failure Mode</div>
        <div class="dfmea-chain-cards" id="chain-col-fm">
          ${!_chain.selCompId
            ? '<div class="dfmea-chain-empty">← Select a component</div>'
            : !_chain.selFuncId
              ? '<div class="dfmea-chain-empty">← Select a function</div>'
              : selFMs.length
                ? selFMs.map(it => {
                    const ap    = calcAP(it.severity, it.occurrence, it.detection);
                    const apClr = AP_COLORS[ap] || '#9AA0A6';
                    return `
                    <div class="dfmea-chain-card fm-card ${_selId===it.id?'active':''}" data-dfmea-id="${it.id}">
                      <div class="dfmea-chain-card-name">${esc(it.failure_mode || '—')}</div>
                      <div class="dfmea-chain-card-meta">
                        <span>S:${it.severity} O:${it.occurrence} D:${it.detection}</span>
                        <span class="dfmea-ap-badge sm" style="background:${apClr}">${ap}</span>
                      </div>
                    </div>`;
                  }).join('')
                : '<div class="dfmea-chain-empty">No failure modes yet for this function</div>'
          }
        </div>
      </div>
    </div>
  `;

  body.querySelectorAll('[data-comp-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selCompId = el.dataset.compId;
      _chain.selFuncId = null;
      renderChain();
    });
  });

  body.querySelectorAll('[data-func-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selFuncId = el.dataset.funcId;
      renderChain();
    });
  });

  body.querySelectorAll('[data-dfmea-id]').forEach(el => {
    el.addEventListener('click', () => {
      selectRow(el.dataset.dfmeaId);
      document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

function countItems(comp) {
  const n = _items.filter(it => it.component_id === comp.id || it.component_name === comp.name).length;
  return n ? `${n} FM` : '';
}

function countFMsForFunc(fn) {
  return _items.filter(it => it.function_name === fn.name).length;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addRow(prefill = {}) {
  const idx  = await nextIndex('dfmea_items', { parent_id: _ctx.parentId });
  const code = buildCode('DFM', {
    domain:      _ctx.parentType === 'item' ? 'ITEM' : 'SYS',
    projectName: _ctx.project.name,
    index:       idx,
  });

  const payload = {
    dfmea_code:    code,
    parent_type:   _ctx.parentType,
    parent_id:     _ctx.parentId,
    project_id:    _ctx.project.id,
    sort_order:    _items.length,
    severity:      5,
    occurrence:    5,
    detection:     5,
    action_status: 'open',
    status:        'draft',
    ...prefill,
  };

  const { data: newItem, error } = await sb.from('dfmea_items').insert(payload).select().single();
  if (error) { toast('Error creating DFMEA row.', 'error'); return null; }

  _items.push(newItem);

  const tableArea = document.getElementById('dfmea-table-area');
  if (!document.getElementById('dfmea-tbody')) {
    renderTable(tableArea);
  } else {
    const tbody = document.getElementById('dfmea-tbody');
    appendRow(tbody, newItem);
    const tr = document.querySelector(`.dfmea-row[data-id="${newItem.id}"]`);
    tr?.querySelector('.dfmea-editable')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  renderChain();
  // Refresh map card if visible
  if (newItem.component_id || newItem.component_name) {
    refreshMapComp(newItem.component_id || newItem.component_name);
  }
  return newItem;
}

async function deleteRow(it) {
  if (!confirm(`Delete DFMEA entry "${it.dfmea_code}"?`)) return;
  const { error } = await sb.from('dfmea_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }

  _items = _items.filter(i => i.id !== it.id);
  document.querySelector(`.dfmea-row[data-id="${it.id}"]`)?.remove();

  if (!_items.length) renderTable(document.getElementById('dfmea-table-area'));
  renderChain();
  refreshMapComp(it.component_id || it.component_name);
  toast('Entry deleted.', 'success');
}

async function autosave(id, fields) {
  const { error } = await sb.from('dfmea_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) toast('Autosave failed.', 'error');
}

// ── Sync from System (Architecture + FHA) ────────────────────────────────────

async function syncFromSystem() {
  const btn = document.getElementById('btn-dfmea-sync');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Syncing…'; }

  try {
    const { data: comps } = await sb.from('arch_components')
      .select('id,name,comp_type')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId);

    if (!comps?.length) {
      toast('No components found in Architecture Concept. Add components there first.', 'warning');
      return;
    }

    const compIds = comps.map(c => c.id);

    const { data: archFns } = await sb.from('arch_functions')
      .select('id,component_id,name,function_ref_id,is_safety_related')
      .in('component_id', compIds);

    const { data: hazards } = await sb.from('hazards')
      .select('id,data,function_id,status')
      .eq('parent_type',    _ctx.parentType)
      .eq('parent_id',      _ctx.parentId)
      .eq('analysis_type',  'FHA');

    let fnRefs = {};
    if (hazards?.some(h => h.function_id)) {
      const fnIds = [...new Set(hazards.filter(h => h.function_id).map(h => h.function_id))];
      const { data: fns } = await sb.from('functions').select('id,name').in('id', fnIds);
      (fns || []).forEach(f => { fnRefs[f.id] = f; });
    }

    const importedHazIds = new Set(_items.filter(i => i.hazard_id).map(i => i.hazard_id));
    let created = 0;

    for (const haz of (hazards || [])) {
      if (importedHazIds.has(haz.id)) continue;
      const d      = haz.data || {};
      const efL    = d.failure_condition || '';
      const efH    = d.effect_system     || d.effect || '';
      const fcause = d.effect_local      || '';

      let matchedComp = null;
      let matchedFn   = null;

      if (haz.function_id) {
        const fnRef = fnRefs[haz.function_id];
        if (fnRef) {
          matchedFn   = (archFns || []).find(af => af.function_ref_id === haz.function_id || af.name === fnRef.name);
          if (matchedFn) matchedComp = comps.find(c => c.id === matchedFn.component_id);
        }
      }

      await addRow({
        component_id:   matchedComp?.id   || null,
        component_name: matchedComp?.name || '',
        function_name:  matchedFn?.name   || (fnRefs[haz.function_id]?.name || ''),
        failure_mode:   '',
        effect_higher:  efH,
        effect_local:   efL,
        failure_cause:  fcause,
        hazard_id:      haz.id,
      });
      created++;
    }

    for (const comp of comps) {
      const compFns = (archFns || []).filter(f => f.component_id === comp.id);
      for (const fn of compFns) {
        const exists = _items.some(it => it.component_id === comp.id && it.function_name === fn.name);
        if (!exists) {
          await addRow({ component_id: comp.id, component_name: comp.name, function_name: fn.name });
          created++;
        }
      }
    }

    if (created > 0) toast(`Synced ${created} new row(s) from Architecture & FHA.`, 'success');
    else             toast('Everything already up to date — no new rows added.', 'info');
  } catch (e) {
    toast('Sync error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync from System'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
