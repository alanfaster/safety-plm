/**
 * DFMEA — Design Failure Mode and Effects Analysis (VDA DFMEA 2019)
 *
 * Layout:
 *  • Scrollable VDA table with inline editing and autosave
 *  • Resizable bottom panel: Structure → Function → Failure chain (APIS IQ-SW style)
 *  • "Sync from System" auto-imports components/functions from Architecture + FHA
 *
 * VDA 2019 columns:
 *  ID | Structure Element | Function | Failure Mode | Effect (Higher) | Effect (Local)
 *  | Failure Cause | S | Prevention Controls | O | Detection Controls | D | AP
 *  | Actions | Responsible | Target Date | Action Status
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

const AP_COLORS = { H: '#C5221F', M: '#E65100', L: '#1E8E3E', N: '#6B778C', '-': '#9AA0A6' };

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx    = null;   // { project, parentType, parentId }
let _items  = [];     // ordered dfmea rows
let _selId  = null;   // selected row id (highlights chain)

// Chain panel state
let _chain = {
  components: [],   // arch_components for this parent
  functions:  [],   // arch_functions for all components: { id, component_id, name, ... }
  selCompId:  null,
  selFuncId:  null,
};

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, { project, item, system, parentType, parentId }) {
  _ctx   = { project, parentType, parentId };
  _items = [];
  _selId = null;
  _chain = { components: [], functions: [], selCompId: null, selFuncId: null };

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
          <span class="dfmea-panel-hint">Components, functions and DFMEA data from Architecture Concept</span>
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

let _mapLoaded = false;
let _netVisible = true;

function wirePanelToggles() {
  // Structure Map panel
  document.getElementById('btn-dfmea-map')?.addEventListener('click', () => {
    const wasHidden = document.getElementById('dfmea-map-panel').style.display === 'none';
    togglePanel('dfmea-map-panel', 'btn-dfmea-map');
    if (wasHidden && !_mapLoaded) { _mapLoaded = true; loadAndRenderMap(); }
    else if (wasHidden)           { renderMap(); } // refresh if data changed
  });
  document.getElementById('dfmea-map-close')?.addEventListener('click', () => {
    closePanel('dfmea-map-panel', 'btn-dfmea-map');
  });
  document.getElementById('btn-dfmea-net')?.addEventListener('click', () => {
    _netVisible = !_netVisible;
    document.getElementById('btn-dfmea-net')?.classList.toggle('active', _netVisible);
    document.querySelectorAll('.dmap-net-svg').forEach(s => {
      s.style.display = _netVisible ? '' : 'none';
    });
  });
  wireResizeBar('dfmea-map-resize', 'dfmea-map-panel');

  // Chain panel toggle button
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
    const onMove = mv => {
      panel.style.height = `${Math.max(120, startH - (mv.clientY - startY))}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
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

  // Filter functions to only those belonging to our components
  const compIds = new Set((comps || []).map(c => c.id));
  _chain.components = comps || [];
  _chain.functions  = (fns || []).filter(f => compIds.has(f.component_id));

  renderChain();
}

// ── Structure Map ─────────────────────────────────────────────────────────────

let _map = { systems: [], components: [], connections: [], functions: [] };

const COMP_COLORS = {
  HW:         { border: '#1A73E8', hdr: '#1A73E8', badge: '#E8F0FE', badgeText: '#1A73E8' },
  SW:         { border: '#1E8E3E', hdr: '#1E8E3E', badge: '#E6F4EA', badgeText: '#1E8E3E' },
  Mechanical: { border: '#E37400', hdr: '#E37400', badge: '#FEF3E2', badgeText: '#E37400' },
  Group:      { border: '#9AA0A6', hdr: '#9AA0A6', badge: '#F8F9FA', badgeText: '#6B778C' },
  Port:       { border: '#212121', hdr: '#212121', badge: '#EEE',    badgeText: '#333'    },
};

async function loadAndRenderMap() {
  const body = document.getElementById('dfmea-map-body');
  if (!body) return;
  body.innerHTML = '<div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>';

  // Load all components across systems (if item-level, also fetch child systems)
  let systemList = [];
  let allComps   = [];

  if (_ctx.parentType === 'item') {
    const { data: syss } = await sb.from('systems')
      .select('id,name').eq('item_id', _ctx.parentId).order('created_at');
    systemList = syss || [];

    if (systemList.length) {
      const sysIds = systemList.map(s => s.id);
      const { data: comps } = await sb.from('arch_components')
        .select('id,name,comp_type,data,parent_type,parent_id')
        .eq('parent_type', 'system').in('parent_id', sysIds);
      allComps = comps || [];
    }
    // Also item-direct components
    const { data: itemComps } = await sb.from('arch_components')
      .select('id,name,comp_type,data,parent_type,parent_id')
      .eq('parent_type', 'item').eq('parent_id', _ctx.parentId);
    allComps = [...allComps, ...(itemComps || [])];
  } else {
    const { data: comps } = await sb.from('arch_components')
      .select('id,name,comp_type,data,parent_type,parent_id')
      .eq('parent_type', _ctx.parentType).eq('parent_id', _ctx.parentId);
    allComps = comps || [];
  }

  // Load connections + functions for all relevant components
  const compIds = allComps.map(c => c.id);
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

  _map.systems     = systemList;
  _map.components  = allComps;
  _map.connections = conns || [];
  _map.functions   = fns  || [];

  renderMap();
}

function renderMap() {
  const body = document.getElementById('dfmea-map-body');
  if (!body) return;
  if (!_map.components.length) {
    body.innerHTML = '<div class="dfmea-chain-empty" style="padding:32px">No components found in Architecture Concept. Build the architecture first.</div>';
    return;
  }

  // Build hierarchy:
  // item-level: systems → [groups →] components
  // system-level: [groups →] components

  const nonPortComps = _map.components.filter(c => c.comp_type !== 'Port');
  const groups       = nonPortComps.filter(c => c.comp_type === 'Group');
  const leafComps    = nonPortComps.filter(c => c.comp_type !== 'Group');

  // Get group label for a component
  const groupOf = c => {
    const gid = c.data?.group_id;
    return gid ? groups.find(g => g.id === gid) : null;
  };

  // Build system → group → component tree
  const buildSystemNode = (sysId, sysName) => {
    const sysComps   = sysId
      ? nonPortComps.filter(c => c.parent_id === sysId)
      : nonPortComps;
    const sysGroups  = sysComps.filter(c => c.comp_type === 'Group');
    const sysLeaves  = sysComps.filter(c => c.comp_type !== 'Group');

    // ungrouped leaves
    const ungrouped  = sysLeaves.filter(c => !c.data?.group_id);
    // grouped leaves per group
    const grouped    = sysGroups.map(g => ({
      group:    g,
      children: sysLeaves.filter(c => c.data?.group_id === g.id),
    }));

    return { sysId, sysName, grouped, ungrouped };
  };

  let treeNodes;
  if (_ctx.parentType === 'item' && _map.systems.length) {
    treeNodes = _map.systems.map(s => buildSystemNode(s.id, s.name));
    // ungrouped item-direct comps
    const itemDirect = buildSystemNode(null, null).ungrouped
      .filter(c => c.parent_type === 'item');
    if (itemDirect.length) treeNodes.push({ sysId: null, sysName: 'Item-level', grouped: [], ungrouped: itemDirect });
  } else {
    treeNodes = [buildSystemNode(_ctx.parentId, null)];
  }

  // Render tree
  const connSet = new Set(_map.connections.map(cn => `${cn.source_id}→${cn.target_id}`));

  const renderComp = (c) => {
    const style   = COMP_COLORS[c.comp_type] || COMP_COLORS.HW;
    const fns     = _map.functions.filter(f => f.component_id === c.id);
    const dItems  = _items.filter(it => it.component_id === c.id || it.component_name === c.name);
    const apH     = dItems.filter(it => calcAP(it.severity,it.occurrence,it.detection)==='H').length;
    const apM     = dItems.filter(it => calcAP(it.severity,it.occurrence,it.detection)==='M').length;

    // Group DFMEA items by function name
    const dfmeaByFn = {};
    dItems.forEach(it => {
      const key = it.function_name || '(no function)';
      if (!dfmeaByFn[key]) dfmeaByFn[key] = [];
      dfmeaByFn[key].push(it);
    });

    // Merge functions list: arch_functions + any fn names in DFMEA not in arch
    const fnNames = new Set(fns.map(f => f.name));
    Object.keys(dfmeaByFn).forEach(k => { if (k !== '(no function)') fnNames.delete(k); });

    const fnRowsHTML = fns.map(f => {
      const safetyClass = f.is_safety_related ? 'safety' : '';
      const items = dfmeaByFn[f.name] || [];
      const fmRows = items.map(it => {
        const ap    = calcAP(it.severity, it.occurrence, it.detection);
        const apClr = AP_COLORS[ap] || '#9AA0A6';
        const label = it.failure_mode || it.effect_local || '—';
        return `<div class="dmap-fm-row" data-dfmea-id="${it.id}">
          <span class="dmap-fm-icon">⚡</span>
          <span class="dmap-fm-label">${esc(label)}</span>
          <span class="dmap-sod">S:${it.severity} O:${it.occurrence} D:${it.detection}</span>
          <span class="dfmea-ap-badge sm" style="background:${apClr}">${ap}</span>
        </div>`;
      }).join('');
      return `
        <div class="dmap-fn-entry ${safetyClass}">
          <div class="dmap-fn-hdr">
            <span class="dmap-fn-ico">${f.is_safety_related ? '🔗' : '⚙'}</span>
            <span class="dmap-fn-name">${esc(f.name)}</span>
            ${items.length ? `<span class="dmap-fn-count">${items.length} FM</span>` : ''}
          </div>
          ${fmRows}
        </div>`;
    }).join('');

    // DFMEA items with no matching arch_function
    const orphanItems = dfmeaByFn['(no function)'] || [];
    const orphanHTML  = orphanItems.map(it => {
      const ap    = calcAP(it.severity, it.occurrence, it.detection);
      const apClr = AP_COLORS[ap] || '#9AA0A6';
      return `<div class="dmap-fm-row" data-dfmea-id="${it.id}">
        <span class="dmap-fm-icon">⚡</span>
        <span class="dmap-fm-label">${esc(it.failure_mode || it.effect_local || '—')}</span>
        <span class="dmap-sod">S:${it.severity} O:${it.occurrence} D:${it.detection}</span>
        <span class="dfmea-ap-badge sm" style="background:${apClr}">${ap}</span>
      </div>`;
    }).join('');

    const riskBadges = [
      apH ? `<span class="dmap-risk-badge H">H:${apH}</span>` : '',
      apM ? `<span class="dmap-risk-badge M">M:${apM}</span>` : '',
    ].join('');

    const nodeId = `dmap-comp-${c.id}`;
    return `
      <div class="dmap-comp-node" id="${nodeId}" data-comp-id="${c.id}">
        <div class="dmap-comp-hdr" style="border-left:4px solid ${style.border}">
          <span class="dmap-comp-type-badge" style="background:${style.badge};color:${style.badgeText}">${esc(c.comp_type)}</span>
          <span class="dmap-comp-name">${esc(c.name)}</span>
          <span class="dmap-risk-badges">${riskBadges}</span>
          <button class="dmap-collapse-btn" data-target="${nodeId}-body" title="Expand / collapse">▼</button>
        </div>
        <div class="dmap-comp-body" id="${nodeId}-body">
          ${fnRowsHTML || orphanHTML
            ? (fnRowsHTML + (orphanHTML ? `<div class="dmap-fn-entry"><div class="dmap-fn-hdr"><span class="dmap-fn-ico">⚙</span><span class="dmap-fn-name" style="color:var(--color-text-muted)">(unassigned)</span></div>${orphanHTML}</div>` : ''))
            : '<div class="dmap-empty-hint" style="padding:8px 12px">No functions or DFMEA data yet</div>'
          }
        </div>
      </div>`;
  };

  // children wrapped in a branch: vertical line + children column
  const branchWrap = (id, childrenHTML) => `
    <span class="dmap-arrow">→</span>
    <div class="dmap-tree-branch">
      <div class="dmap-tree-branch-line"></div>
      <div class="dmap-tree-branch-children" id="${id}">
        ${childrenHTML}
      </div>
    </div>`;

  const renderGroupNode = ({ group, children }) => {
    const bid = `dmap-grp-${group.id}-body`;
    return `
    <div class="dmap-group-node">
      <div class="dmap-group-hdr">
        <span class="dmap-group-name">⬡ ${esc(group.name)}</span>
        <button class="dmap-collapse-btn" data-target="${bid}">▼</button>
      </div>
      ${branchWrap(bid, children.map(renderComp).join(''))}
    </div>`;
  };

  const renderSystemNode = (node) => {
    if (!node.sysName) {
      return [
        ...node.grouped.map(renderGroupNode),
        ...node.ungrouped.map(renderComp),
      ].join('');
    }
    const bid = `dmap-sys-${node.sysId || 'item'}-body`;
    const childrenHTML = [
      ...node.grouped.map(renderGroupNode),
      ...node.ungrouped.map(renderComp),
    ].join('');
    return `
      <div class="dmap-sys-node">
        <div class="dmap-sys-hdr">
          <span class="dmap-sys-icon">⬡</span>
          <span class="dmap-sys-name">${esc(node.sysName)}</span>
          <button class="dmap-collapse-btn" data-target="${bid}">▼</button>
        </div>
        ${branchWrap(bid, childrenHTML)}
      </div>`;
  };

  // Connection net (hidden toggleable)
  const connLines = buildConnLines(nonPortComps);

  body.innerHTML = `
    <div class="dmap-tree-wrap">
      ${_netVisible && connLines ? `<div class="dmap-net-legend">${connLines.legend}</div>` : ''}
      <div class="dmap-tree">
        ${treeNodes.map(renderSystemNode).join('')}
      </div>
    </div>`;

  // Wire collapse buttons (toggle .collapsed on target element)
  body.querySelectorAll('.dmap-collapse-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const nowCollapsed = target.classList.toggle('collapsed');
      btn.textContent = nowCollapsed ? '▶' : '▼';
    });
  });

  // Wire FM rows → select table row + scroll
  body.querySelectorAll('[data-dfmea-id]').forEach(el => {
    el.addEventListener('click', () => {
      selectRow(el.dataset.dfmeaId);
      const tr = document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`);
      tr?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

const IFACE_COLORS = { Data:'#1A73E8', Electrical:'#E37400', Mechanical:'#5D4037', Thermal:'#C5221F', Power:'#7B1FA2' };

function buildConnLines(comps) {
  // Returns a small legend of connections, shown in net-toggle mode
  if (!_map.connections.length) return null;
  const compMap = Object.fromEntries(comps.map(c => [c.id, c]));
  const items   = _map.connections.slice(0, 12).map(cn => {
    const src = compMap[cn.source_id];
    const tgt = compMap[cn.target_id];
    if (!src || !tgt) return '';
    const clr = IFACE_COLORS[cn.interface_type] || '#9AA0A6';
    return `<span class="dmap-conn-chip" style="border-color:${clr}">
      <span style="color:${clr}">→</span>
      ${esc(src.name)} → ${esc(tgt.name)}
      ${cn.interface_type ? `<span class="dmap-conn-type" style="color:${clr}">${esc(cn.interface_type)}</span>` : ''}
    </span>`;
  }).filter(Boolean).join('');
  return { legend: items };
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
  // Click row → select + highlight chain
  tr.addEventListener('click', e => {
    if (e.target.closest('input,select,button')) return;
    selectRow(it.id);
  });

  // Text cells — double-click to edit
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
        // Refresh chain if component/function name changed
        if (field === 'component_name' || field === 'function_name') renderChain();
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
      // Refresh AP badge
      const apCell = tr.querySelector('.dfmea-col-ap');
      if (apCell) {
        const ap    = calcAP(it.severity, it.occurrence, it.detection);
        const apClr = AP_COLORS[ap] || '#9AA0A6';
        apCell.innerHTML = `<span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>`;
      }
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

// ── Row selection ─────────────────────────────────────────────────────────────

function selectRow(id) {
  _selId = id;
  document.querySelectorAll('.dfmea-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.id === id);
  });
  // Sync chain selection to the component of this row
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

  const comps = _chain.components;
  const fns   = _chain.functions;

  // Functions for selected component
  const selFns = _chain.selCompId
    ? fns.filter(f => f.component_id === _chain.selCompId)
    : [];

  // Failure modes from DFMEA items for selected function
  const selFMs = _chain.selFuncId
    ? _items.filter(it => it.function_name === selFns.find(f => f.id === _chain.selFuncId)?.name
                        || it.component_id  === _chain.selCompId)
            .filter(it => {
              const fn = selFns.find(f => f.id === _chain.selFuncId);
              return fn && it.function_name === fn.name;
            })
    : (_chain.selCompId
        ? _items.filter(it => it.component_id === _chain.selCompId || it.component_name === comps.find(c=>c.id===_chain.selCompId)?.name)
        : []);

  body.innerHTML = `
    <div class="dfmea-chain">
      <!-- Column 1: Structure Elements -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⬡</span> Structure Element
        </div>
        <div class="dfmea-chain-cards" id="chain-col-comp">
          ${comps.length
            ? comps.map(c => `
              <div class="dfmea-chain-card ${_chain.selCompId===c.id?'active':''}"
                   data-comp-id="${c.id}">
                <div class="dfmea-chain-card-type">${esc(c.comp_type || '')}</div>
                <div class="dfmea-chain-card-name">${esc(c.name)}</div>
                <div class="dfmea-chain-card-count">${countItems('component', c)}</div>
              </div>`).join('')
            : '<div class="dfmea-chain-empty">No components in Architecture Concept.<br>Add components there first.</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <!-- Column 2: Functions -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⚙</span> Function
        </div>
        <div class="dfmea-chain-cards" id="chain-col-func">
          ${!_chain.selCompId
            ? '<div class="dfmea-chain-empty">← Select a component</div>'
            : selFns.length
              ? selFns.map(f => `
                <div class="dfmea-chain-card ${_chain.selFuncId===f.id?'active':''} ${f.is_safety_related?'safety':''}
                     data-func-id="${f.id}">
                  ${f.is_safety_related ? '<span class="dfmea-chain-safety-tag">Safety</span>' : ''}
                  <div class="dfmea-chain-card-name">${esc(f.name)}</div>
                  <div class="dfmea-chain-card-count">${countFMsForFunc(f)} FM</div>
                </div>`).join('')
              : '<div class="dfmea-chain-empty">No functions for this component</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <!-- Column 3: Failure Modes -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⚠</span> Failure Mode
        </div>
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
                    <div class="dfmea-chain-card fm-card ${_selId===it.id?'active':''}"
                         data-dfmea-id="${it.id}">
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

  // Wire component cards
  body.querySelectorAll('[data-comp-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selCompId = el.dataset.compId;
      _chain.selFuncId = null;
      renderChain();
    });
  });

  // Wire function cards
  body.querySelectorAll('[data-func-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selFuncId = el.dataset.funcId;
      renderChain();
    });
  });

  // Wire failure mode cards → select table row
  body.querySelectorAll('[data-dfmea-id]').forEach(el => {
    el.addEventListener('click', () => {
      selectRow(el.dataset.dfmeaId);
      // Scroll table row into view
      const tr = document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`);
      tr?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

function countItems(type, comp) {
  const n = _items.filter(it =>
    it.component_id === comp.id || it.component_name === comp.name
  ).length;
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
    dfmea_code:   code,
    parent_type:  _ctx.parentType,
    parent_id:    _ctx.parentId,
    project_id:   _ctx.project.id,
    sort_order:   _items.length,
    severity:     5,
    occurrence:   5,
    detection:    5,
    action_status:'open',
    status:       'draft',
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
    // Focus first editable cell
    const tr = document.querySelector(`.dfmea-row[data-id="${newItem.id}"]`);
    tr?.querySelector('.dfmea-editable')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  renderChain();
  return newItem;
}

async function deleteRow(it) {
  if (!confirm(`Delete DFMEA entry "${it.dfmea_code}"?`)) return;
  const { error } = await sb.from('dfmea_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }

  _items = _items.filter(i => i.id !== it.id);
  document.querySelector(`.dfmea-row[data-id="${it.id}"]`)?.remove();

  if (!_items.length) {
    renderTable(document.getElementById('dfmea-table-area'));
  }
  renderChain();
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
    // 1. Load arch_components
    const { data: comps } = await sb.from('arch_components')
      .select('id,name,comp_type')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId);

    if (!comps?.length) {
      toast('No components found in Architecture Concept. Add components there first.', 'warning');
      return;
    }

    const compIds = comps.map(c => c.id);

    // 2. Load arch_functions for those components
    const { data: archFns } = await sb.from('arch_functions')
      .select('id,component_id,name,function_ref_id,is_safety_related')
      .in('component_id', compIds);

    // 3. Load FHA hazards for this parent
    const { data: hazards } = await sb.from('hazards')
      .select('id,data,function_id,status')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId)
      .eq('analysis_type', 'FHA');

    // 4. Load functions table (for name matching)
    let fnRefs = {};
    if (hazards?.some(h => h.function_id)) {
      const fnIds = [...new Set(hazards.filter(h => h.function_id).map(h => h.function_id))];
      const { data: fns } = await sb.from('functions').select('id,name').in('id', fnIds);
      (fns || []).forEach(f => { fnRefs[f.id] = f; });
    }

    // 5. Build set of already-imported hazard IDs
    const importedHazIds = new Set(_items.filter(i => i.hazard_id).map(i => i.hazard_id));

    let created = 0;

    // 6. For each hazard, find matching arch_function via function_ref_id or name
    for (const haz of (hazards || [])) {
      if (importedHazIds.has(haz.id)) continue; // already synced

      const d   = haz.data || {};
      // FHA mapping → DFMEA:
      //   failure_condition (FC) → effect_local  (local failure effect)
      //   effect_system          → effect_higher (system-level effect)
      //   effect_local           → failure_cause (contributing cause)
      //   failure_mode           left blank (to be filled manually per VDA)
      const efL  = d.failure_condition || '';
      const efH  = d.effect_system     || d.effect || '';
      const fcause = d.effect_local    || '';

      // Try to match arch_function
      let matchedComp = null;
      let matchedFn   = null;

      if (haz.function_id) {
        const fnRef = fnRefs[haz.function_id];
        if (fnRef) {
          // Find arch_function by function_ref_id or by name
          matchedFn   = (archFns || []).find(af => af.function_ref_id === haz.function_id
                                               || af.name === fnRef.name);
          if (matchedFn) {
            matchedComp = comps.find(c => c.id === matchedFn.component_id);
          }
        }
      }

      const prefill = {
        component_id:    matchedComp?.id   || null,
        component_name:  matchedComp?.name || '',
        function_name:   matchedFn?.name   || (fnRefs[haz.function_id]?.name || ''),
        failure_mode:    '',      // to be filled manually in DFMEA
        effect_higher:   efH,
        effect_local:    efL,
        failure_cause:   fcause,
        hazard_id:       haz.id,
      };

      await addRow(prefill);
      created++;
    }

    // 7. Also create skeleton rows for components/functions with no FHA link
    for (const comp of comps) {
      const compFns = (archFns || []).filter(f => f.component_id === comp.id);
      for (const fn of compFns) {
        // Check if a row already exists for this component+function with no hazard
        const exists = _items.some(it => it.component_id === comp.id && it.function_name === fn.name);
        if (!exists) {
          await addRow({
            component_id:   comp.id,
            component_name: comp.name,
            function_name:  fn.name,
          });
          created++;
        }
      }
    }

    if (created > 0) {
      toast(`Synced ${created} new row(s) from Architecture & FHA.`, 'success');
    } else {
      toast('Everything already up to date — no new rows added.', 'info');
    }
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
