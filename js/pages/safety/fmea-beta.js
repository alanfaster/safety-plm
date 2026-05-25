// NEW FMEA Beta — graph-based functional failure modeling
// Prototype: interactive node graph with failure injection simulation

import { getSupabase } from '../../supabase.js';

const sb = getSupabase();

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  bg:         '#0f1117',
  surface:    '#1a1d27',
  surface2:   '#22263a',
  border:     '#2e3350',
  borderHov:  '#4a5080',
  text:       '#e8eaf6',
  textMuted:  '#6b7db3',
  textDim:    '#3d4a70',
  primary:    '#5c6bc0',
  primaryHov: '#7986cb',
  accent:     '#00e5ff',
  accentDim:  '#00e5ff22',
  green:      '#00e676',
  greenDim:   '#00e67622',
  orange:     '#ff9100',
  orangeDim:  '#ff910022',
  red:        '#ff1744',
  redDim:     '#ff174422',
  yellow:     '#ffea00',
  purple:     '#d500f9',
  purpleDim:  '#d500f922',
};

// ── FM injection types ─────────────────────────────────────────────────────────
const FM_TYPES = [
  { key: 'incorrect_output',    label: 'Incorrect output',    color: C.orange },
  { key: 'missing_output',      label: 'Missing output',      color: C.red    },
  { key: 'delayed_output',      label: 'Delayed output',      color: C.yellow },
  { key: 'intermittent_output', label: 'Intermittent output', color: C.purple },
  { key: 'unstable_output',     label: 'Unstable output',     color: C.primaryHov },
];

// ── State ──────────────────────────────────────────────────────────────────────
let _s = {
  nodes: [],          // arch_components enriched with functions + fms
  edges: [],          // arch_connections
  selectedNodeId: null,
  injectedFmKey: null,
  injectedNodeId: null,
  propagated: {},     // nodeId → { level, path }
  pan: { x: 0, y: 0 },
  zoom: 1,
  dragging: null,     // { nodeId, ox, oy }
  connecting: null,   // null | { fromId }
  canvasW: 0,
  canvasH: 0,
  activeTab: 'graph', // 'graph' | 'table'
  tableRows: [],
};

// ── Entry point ────────────────────────────────────────────────────────────────
export async function renderFmeaBeta(container, ctx) {
  const { project, item, system, parentType, parentId } = ctx;

  container.innerHTML = `
    <div id="fmea-beta-root" style="
      display:flex; flex-direction:column; height:100%;
      background:${C.bg}; color:${C.text}; font-family:'Inter',system-ui,sans-serif;
      overflow:hidden;
    ">
      ${buildTopbar(item, system)}
      <div style="display:flex; flex:1; overflow:hidden;">
        ${buildLeftPanel()}
        <div style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
          ${buildTabBar()}
          <div id="fmea-beta-center" style="flex:1; position:relative; overflow:hidden;">
            ${buildCanvas()}
            ${buildTableView()}
          </div>
        </div>
        ${buildRightPanel()}
      </div>
      ${buildBottomLog()}
    </div>
  `;

  await loadData(parentType, parentId, project.id);
  wireCanvas();
  wireLeftPanel();
  wireTabBar();
  renderAll();
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadData(parentType, parentId, projectId) {
  const [compRes, connRes] = await Promise.all([
    sb.from('arch_components').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('arch_connections').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
  ]);
  const comps = compRes.data || [];
  const conns = connRes.data || [];

  // Load functions + FMs per component
  const compIds = comps.map(c => c.id);
  let fnsByComp = {};
  let fmsByFn   = {};
  let fmsByComp = {};

  if (compIds.length) {
    const [fnRes, fmRes] = await Promise.all([
      sb.from('arch_functions').select('*').in('component_id', compIds).order('sort_order'),
      sb.from('arch_function_fms').select('*').in('component_id', compIds),
    ]);
    (fnRes.data || []).forEach(f => { (fnsByComp[f.component_id] ||= []).push(f); });
    (fmRes.data || []).forEach(fm => {
      if (fm.function_id) (fmsByFn[fm.function_id]   ||= []).push(fm);
      else                (fmsByComp[fm.component_id] ||= []).push(fm);
    });
  }

  _s.nodes = comps.map(c => ({
    ...c,
    _fns: (fnsByComp[c.id] || []).map(f => ({
      ...f,
      _fms: fmsByFn[f.id] || [],
    })),
    _compFms: fmsByComp[c.id] || [],
    _glowLevel: 0,  // 0=none 1=direct 2=propagated 3=critical
  }));

  _s.edges = conns;
  _s.selectedNodeId = null;
  _s.injectedFmKey  = null;
  _s.injectedNodeId = null;
  _s.propagated     = {};
  logEvent('System loaded', `${_s.nodes.length} nodes, ${_s.edges.length} connections`);
}

// ── Top bar ────────────────────────────────────────────────────────────────────
function buildTopbar(item, system) {
  const ctx = system ? `${item?.name || ''} / ${system.name}` : (item?.name || '');
  return `
    <div style="
      display:flex; align-items:center; gap:12px;
      padding:0 16px; height:48px; flex-shrink:0;
      background:${C.surface}; border-bottom:1px solid ${C.border};
    ">
      <span style="font-size:11px; font-weight:700; letter-spacing:2px; color:${C.accent}; text-transform:uppercase;">NEW FMEA</span>
      <span style="color:${C.border}; font-size:16px;">|</span>
      <span style="font-size:11px; font-weight:600; letter-spacing:1px; color:${C.primary}; text-transform:uppercase; opacity:.7;">Beta</span>
      <span style="flex:1;"></span>
      <span style="font-size:12px; color:${C.textMuted};">${escH(ctx)}</span>
      <button id="fmea-beta-clear-inject" style="${btnStyle(C.surface2)} display:none;" title="Clear injection">✕ Clear injection</button>
      <button id="fmea-beta-gen-table" style="${btnStyle(C.primary)};">⚡ Generate DFMEA table</button>
    </div>
  `;
}

// ── Left panel ─────────────────────────────────────────────────────────────────
function buildLeftPanel() {
  return `
    <div id="fmea-beta-left" style="
      width:220px; flex-shrink:0;
      background:${C.surface}; border-right:1px solid ${C.border};
      display:flex; flex-direction:column; overflow:hidden;
    ">
      <div style="padding:12px 14px 8px; font-size:10px; font-weight:700; letter-spacing:1.5px; color:${C.textMuted}; text-transform:uppercase;">System Explorer</div>
      <div id="fmea-beta-node-list" style="flex:1; overflow-y:auto; padding:0 6px 8px;"></div>
      <div style="border-top:1px solid ${C.border}; padding:10px 14px;">
        <div style="font-size:10px; font-weight:700; letter-spacing:1.5px; color:${C.textMuted}; text-transform:uppercase; margin-bottom:8px;">Inject Failure</div>
        <div id="fmea-beta-fm-palette" style="display:flex; flex-direction:column; gap:4px;">
          ${FM_TYPES.map(fm => `
            <button class="fmea-fm-pill" data-fm="${fm.key}" style="
              background:${C.surface2}; border:1px solid ${C.border}; border-radius:4px;
              color:${fm.color}; font-size:11px; font-weight:600;
              padding:5px 8px; text-align:left; cursor:pointer;
              transition:background .15s, border-color .15s;
            ">${fm.label}</button>
          `).join('')}
        </div>
        <div style="font-size:10px; color:${C.textDim}; margin-top:8px; line-height:1.5;">
          Select a node, then click a failure type to inject.
        </div>
      </div>
    </div>
  `;
}

// ── Tab bar ────────────────────────────────────────────────────────────────────
function buildTabBar() {
  return `
    <div style="
      display:flex; align-items:center; gap:0;
      background:${C.surface}; border-bottom:1px solid ${C.border};
      padding:0 16px; height:38px; flex-shrink:0;
    ">
      <button class="fmea-tab active" data-tab="graph" style="${tabStyle(true)}">⬡ Graph</button>
      <button class="fmea-tab" data-tab="table" style="${tabStyle(false)}">⊞ DFMEA Table</button>
      <span style="flex:1;"></span>
      <span id="fmea-beta-prop-status" style="font-size:11px; color:${C.textMuted};"></span>
    </div>
  `;
}

// ── Canvas ─────────────────────────────────────────────────────────────────────
function buildCanvas() {
  return `
    <div id="fmea-canvas-wrap" style="
      position:absolute; inset:0;
      background:${C.bg};
      background-image: radial-gradient(${C.border} 1px, transparent 1px);
      background-size: 24px 24px;
      overflow:hidden; cursor:default;
    ">
      <svg id="fmea-canvas-svg" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible;">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="${C.textMuted}" />
          </marker>
          <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="${C.accent}" />
          </marker>
          <marker id="arrowhead-danger" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="${C.red}" />
          </marker>
          <filter id="glow-accent">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="glow-red">
            <feGaussianBlur stdDeviation="5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <g id="fmea-edges-layer"></g>
        <g id="fmea-prop-layer"></g>
      </svg>
      <div id="fmea-nodes-layer" style="position:absolute; inset:0; pointer-events:none;"></div>
      <div id="fmea-empty-hint" style="
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:8px;
        color:${C.textDim}; font-size:13px; pointer-events:none;
      ">
        <div style="font-size:32px; opacity:.3;">⬡</div>
        <div>No components in this scope yet.</div>
        <div style="font-size:11px;">Add components in the Architecture page.</div>
      </div>
    </div>
  `;
}

// ── Table view ─────────────────────────────────────────────────────────────────
function buildTableView() {
  return `
    <div id="fmea-table-wrap" style="
      position:absolute; inset:0; display:none;
      background:${C.bg}; overflow:auto; padding:16px;
    ">
      <div id="fmea-table-inner"></div>
    </div>
  `;
}

// ── Right panel ────────────────────────────────────────────────────────────────
function buildRightPanel() {
  return `
    <div id="fmea-beta-right" style="
      width:280px; flex-shrink:0;
      background:${C.surface}; border-left:1px solid ${C.border};
      display:flex; flex-direction:column; overflow:hidden;
    ">
      <div style="padding:12px 14px 8px; font-size:10px; font-weight:700; letter-spacing:1.5px; color:${C.textMuted}; text-transform:uppercase; border-bottom:1px solid ${C.border};">Properties</div>
      <div id="fmea-beta-props" style="flex:1; overflow-y:auto; padding:12px 14px;">
        <div style="color:${C.textDim}; font-size:12px; padding-top:8px;">Select a node to inspect.</div>
      </div>
    </div>
  `;
}

// ── Bottom log ─────────────────────────────────────────────────────────────────
function buildBottomLog() {
  return `
    <div id="fmea-beta-log" style="
      height:80px; flex-shrink:0;
      background:${C.surface}; border-top:1px solid ${C.border};
      display:flex; flex-direction:column; overflow:hidden;
    ">
      <div style="padding:4px 14px 2px; font-size:10px; font-weight:700; letter-spacing:1.5px; color:${C.textMuted}; text-transform:uppercase;">Event Log</div>
      <div id="fmea-log-entries" style="flex:1; overflow-y:auto; padding:0 14px 6px; font-size:11px; font-family:monospace; color:${C.textMuted};"></div>
    </div>
  `;
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderAll() {
  renderNodeList();
  renderGraph();
  renderProps();
}

function renderNodeList() {
  const el = document.getElementById('fmea-beta-node-list');
  if (!el) return;
  if (!_s.nodes.length) { el.innerHTML = `<div style="padding:8px; color:${C.textDim}; font-size:11px;">No nodes</div>`; return; }

  el.innerHTML = _s.nodes.map(n => {
    const prop = _s.propagated[n.id];
    const isSelected = n.id === _s.selectedNodeId;
    const isInjected = n.id === _s.injectedNodeId;
    let dotColor = C.textDim;
    if (isInjected)       dotColor = C.orange;
    else if (prop?.level === 3) dotColor = C.red;
    else if (prop?.level === 2) dotColor = C.orange;
    else if (prop?.level === 1) dotColor = C.yellow;

    return `
      <div class="fmea-node-item" data-id="${n.id}" style="
        display:flex; align-items:center; gap:8px;
        padding:6px 8px; border-radius:5px; cursor:pointer;
        background:${isSelected ? C.surface2 : 'transparent'};
        border:1px solid ${isSelected ? C.primary : 'transparent'};
        margin-bottom:2px; transition:background .1s;
      ">
        <span style="width:7px; height:7px; border-radius:50%; background:${dotColor}; flex-shrink:0;"></span>
        <span style="font-size:12px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escH(n.name)}</span>
        <span style="font-size:10px; color:${C.textDim}; background:${C.surface2}; border-radius:3px; padding:1px 4px;">${n.comp_type}</span>
      </div>
    `;
  }).join('');
}

function renderGraph() {
  const nodesLayer  = document.getElementById('fmea-nodes-layer');
  const edgesLayer  = document.getElementById('fmea-edges-layer');
  const propLayer   = document.getElementById('fmea-prop-layer');
  const emptyHint   = document.getElementById('fmea-empty-hint');
  if (!nodesLayer) return;

  emptyHint.style.display = _s.nodes.length ? 'none' : 'flex';

  // Wrap renders nodes/edges inside a transform group
  nodesLayer.innerHTML = '';
  edgesLayer.innerHTML = '';
  propLayer.innerHTML  = '';

  const { x: px, y: py } = _s.pan;
  const z = _s.zoom;

  // Edges
  _s.edges.forEach(e => {
    const src = _s.nodes.find(n => n.id === e.source_id);
    const tgt = _s.nodes.find(n => n.id === e.target_id);
    if (!src || !tgt) return;
    const sx = src.x * z + px + (src.width  * z) / 2;
    const sy = src.y * z + py + (src.height * z) / 2;
    const tx = tgt.x * z + px + (tgt.width  * z) / 2;
    const ty = tgt.y * z + py + (tgt.height * z) / 2;
    const propSrc = _s.propagated[src.id];
    const propTgt = _s.propagated[tgt.id];
    const isActive = propSrc && propTgt;
    const isCrit   = propTgt?.level === 3;
    const color  = isCrit ? C.red : isActive ? C.accent : C.border;
    const marker = isCrit ? 'arrowhead-danger' : isActive ? 'arrowhead-active' : 'arrowhead';
    const width  = isActive ? 2 : 1;
    const filter = isCrit ? 'url(#glow-red)' : isActive ? 'url(#glow-accent)' : '';
    const cx1 = sx + (tx - sx) * 0.4;
    const cx2 = tx - (tx - sx) * 0.4;
    edgesLayer.innerHTML += `
      <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
        stroke="${color}" stroke-width="${width}" fill="none"
        marker-end="url(#${marker})" ${filter ? `filter="${filter}"` : ''}
        style="${isActive ? 'animation:fmea-pulse 1.2s ease-in-out infinite;' : ''}"
      />
    `;
  });

  // Propagation level badges on edges
  if (_s.injectedNodeId) {
    _s.edges.forEach(e => {
      const src = _s.nodes.find(n => n.id === e.source_id);
      const tgt = _s.nodes.find(n => n.id === e.target_id);
      if (!src || !tgt) return;
      const propTgt = _s.propagated[tgt.id];
      if (!propTgt) return;
      const sx = src.x * z + px + (src.width  * z) / 2;
      const sy = src.y * z + py + (src.height * z) / 2;
      const tx = tgt.x * z + px + (tgt.width  * z) / 2;
      const ty = tgt.y * z + py + (tgt.height * z) / 2;
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const label = propTgt.level === 3 ? '⚠ Critical' : propTgt.level === 2 ? '⚡ Propagated' : '→ Effect';
      const lc = propTgt.level === 3 ? C.red : propTgt.level === 2 ? C.orange : C.yellow;
      propLayer.innerHTML += `
        <g transform="translate(${mx},${my})">
          <rect x="-32" y="-9" width="64" height="18" rx="3" fill="${C.surface}" stroke="${lc}" stroke-width="1" opacity=".9"/>
          <text x="0" y="5" text-anchor="middle" font-size="9" font-family="monospace" fill="${lc}">${label}</text>
        </g>
      `;
    });
  }

  // Nodes
  _s.nodes.forEach(n => {
    const prop = _s.propagated[n.id];
    const isSelected = n.id === _s.selectedNodeId;
    const isInjected = n.id === _s.injectedNodeId;
    const nx = n.x * z + px;
    const ny = n.y * z + py;
    const nw = n.width  * z;
    const nh = n.height * z;

    let borderColor = C.border;
    let bgColor     = C.surface;
    let glowFilter  = '';
    let glowOpacity = 0;
    let glowColor   = C.accent;

    if (isInjected) {
      borderColor = C.orange;
      bgColor     = '#1f1500';
      glowFilter  = 'url(#glow-accent)';
      glowColor   = C.orange;
      glowOpacity = .4;
    } else if (prop?.level === 3) {
      borderColor = C.red;
      bgColor     = '#1a0008';
      glowFilter  = 'url(#glow-red)';
      glowColor   = C.red;
      glowOpacity = .5;
    } else if (prop?.level === 2) {
      borderColor = C.orange;
      bgColor     = '#1a0e00';
      glowColor   = C.orange;
      glowOpacity = .3;
    } else if (prop?.level === 1) {
      borderColor = C.yellow;
      bgColor     = '#191600';
      glowColor   = C.yellow;
      glowOpacity = .2;
    } else if (isSelected) {
      borderColor = C.primary;
      bgColor     = '#141828';
    }

    const typeIcon = n.comp_type === 'SW' ? '◧' : n.comp_type === 'Mechanical' ? '◎' : '◨';
    const fnCount  = n._fns?.length || 0;
    const fmCount  = (n._fns?.reduce((a, f) => a + f._fms.length, 0) || 0) + (n._compFms?.length || 0);
    const safetyDot = n.is_safety_critical ? `<span style="color:${C.red}; font-size:10px;" title="Safety critical">⬟</span>` : '';

    const el = document.createElement('div');
    el.className = 'fmea-graph-node';
    el.dataset.id = n.id;
    el.style.cssText = `
      position:absolute;
      left:${nx}px; top:${ny}px;
      width:${nw}px; height:${nh}px;
      background:${bgColor};
      border:1.5px solid ${borderColor};
      border-radius:8px;
      padding:10px 12px;
      box-sizing:border-box;
      cursor:pointer;
      pointer-events:all;
      transition:border-color .2s, background .2s;
      ${glowOpacity ? `box-shadow:0 0 ${12 + glowOpacity * 20}px ${glowColor}${Math.round(glowOpacity * 255).toString(16).padStart(2,'0')};` : ''}
      display:flex; flex-direction:column; gap:4px;
      user-select:none;
    `;

    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:${C.textMuted}; font-size:12px;">${typeIcon}</span>
        <span style="font-size:${Math.max(10, 13 * z)}px; font-weight:600; color:${C.text}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${escH(n.name)}</span>
        ${safetyDot}
      </div>
      ${fnCount ? `<div style="font-size:${Math.max(9, 11 * z)}px; color:${C.textMuted};">λ ${fnCount} function${fnCount !== 1 ? 's' : ''}</div>` : ''}
      ${fmCount ? `<div style="font-size:${Math.max(9, 11 * z)}px; color:${isInjected ? C.orange : prop ? C.red : C.textMuted};">⚠ ${fmCount} FM${fmCount !== 1 ? 's' : ''}</div>` : ''}
      ${isInjected && _s.injectedFmKey ? `
        <div style="
          margin-top:4px; padding:3px 6px; border-radius:3px;
          background:${C.orangeDim}; border:1px solid ${C.orange};
          font-size:${Math.max(9, 10 * z)}px; color:${C.orange}; font-weight:600;
        ">⚡ ${FM_TYPES.find(f => f.key === _s.injectedFmKey)?.label || _s.injectedFmKey}</div>
      ` : ''}
    `;

    nodesLayer.appendChild(el);
  });
}

function renderProps() {
  const el = document.getElementById('fmea-beta-props');
  if (!el) return;

  if (!_s.selectedNodeId) {
    el.innerHTML = `<div style="color:${C.textDim}; font-size:12px; padding-top:8px;">Select a node to inspect.</div>`;
    return;
  }
  const node = _s.nodes.find(n => n.id === _s.selectedNodeId);
  if (!node) return;

  const prop = _s.propagated[node.id];
  const isInjected = node.id === _s.injectedNodeId;
  const propBadge = isInjected
    ? `<span style="background:${C.orangeDim}; border:1px solid ${C.orange}; color:${C.orange}; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600;">⚡ INJECTION POINT</span>`
    : prop?.level === 3
      ? `<span style="background:${C.redDim}; border:1px solid ${C.red}; color:${C.red}; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600;">⚠ CRITICAL EFFECT</span>`
      : prop?.level === 2
        ? `<span style="background:${C.orangeDim}; border:1px solid ${C.orange}; color:${C.orange}; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600;">⚡ PROPAGATED EFFECT</span>`
        : prop?.level === 1
          ? `<span style="background:#191600; border:1px solid ${C.yellow}; color:${C.yellow}; padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600;">→ LOCAL EFFECT</span>`
          : '';

  const fnRows = (node._fns || []).map(f => {
    const fms = f._fms.map(fm => `
      <div style="margin:2px 0 2px 12px; display:flex; align-items:center; gap:6px;">
        <span style="color:${C.red}; font-size:10px;">⚠</span>
        <span style="font-size:11px; color:${C.textMuted};">${escH(fm.failure_mode)}</span>
      </div>
    `).join('');
    return `
      <div style="margin:4px 0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:${C.accent}; font-size:10px;">λ</span>
          <span style="font-size:12px;">${escH(f.name)}</span>
          ${f.is_safety_related ? `<span style="color:${C.red}; font-size:9px;" title="Safety related">FS</span>` : ''}
        </div>
        ${fms}
      </div>
    `;
  }).join('');

  const compFmRows = (node._compFms || []).map(fm => `
    <div style="margin:2px 0; display:flex; align-items:center; gap:6px;">
      <span style="color:${C.orange}; font-size:10px;">⚠</span>
      <span style="font-size:11px; color:${C.textMuted};">${escH(fm.failure_mode)}</span>
    </div>
  `).join('');

  const connectedTo = _s.edges.filter(e => e.source_id === node.id || e.target_id === node.id);

  el.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div>
        <div style="font-size:14px; font-weight:700; margin-bottom:4px;">${escH(node.name)}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <span style="background:${C.surface2}; border:1px solid ${C.border}; border-radius:3px; padding:2px 6px; font-size:10px; color:${C.textMuted};">${node.comp_type}</span>
          ${node.is_safety_critical ? `<span style="background:${C.redDim}; border:1px solid ${C.red}; border-radius:3px; padding:2px 6px; font-size:10px; color:${C.red};">Safety Critical</span>` : ''}
          ${propBadge}
        </div>
      </div>

      ${fnRows || compFmRows ? `
        <div>
          <div style="font-size:10px; font-weight:700; letter-spacing:1px; color:${C.textMuted}; text-transform:uppercase; margin-bottom:6px;">Functions & Failure Modes</div>
          ${fnRows}
          ${compFmRows ? `<div style="margin-top:4px; font-size:10px; color:${C.textDim}; text-transform:uppercase; letter-spacing:.8px; margin-bottom:2px;">Component FMs</div>${compFmRows}` : ''}
        </div>
      ` : `<div style="font-size:11px; color:${C.textDim};">No functions or FMs defined.</div>`}

      ${connectedTo.length ? `
        <div>
          <div style="font-size:10px; font-weight:700; letter-spacing:1px; color:${C.textMuted}; text-transform:uppercase; margin-bottom:6px;">Connections (${connectedTo.length})</div>
          ${connectedTo.map(e => {
            const other = _s.nodes.find(n => n.id === (e.source_id === node.id ? e.target_id : e.source_id));
            const dir = e.source_id === node.id ? '→' : '←';
            return `
              <div style="font-size:11px; color:${C.textMuted}; margin-bottom:3px; display:flex; gap:6px; align-items:center;">
                <span style="color:${C.accent};">${dir}</span>
                <span>${escH(other?.name || '?')}</span>
                <span style="color:${C.textDim}; font-size:10px;">${e.interface_type}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${prop ? `
        <div>
          <div style="font-size:10px; font-weight:700; letter-spacing:1px; color:${C.textMuted}; text-transform:uppercase; margin-bottom:6px;">Propagation Path</div>
          <div style="font-size:11px; color:${C.textMuted}; font-family:monospace;">
            ${(prop.path || []).map((id, i) => {
              const n = _s.nodes.find(x => x.id === id);
              return `${i > 0 ? ' → ' : ''}${escH(n?.name || id)}`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ── Propagation engine ─────────────────────────────────────────────────────────
function propagate(startNodeId, fmKey) {
  _s.propagated = {};
  _s.injectedNodeId = startNodeId;
  _s.injectedFmKey  = fmKey;

  // BFS through connection graph
  const queue = [{ id: startNodeId, level: 1, path: [startNodeId] }];
  const visited = new Set([startNodeId]);
  _s.propagated[startNodeId] = { level: 1, path: [startNodeId] };

  while (queue.length) {
    const { id, level, path } = queue.shift();
    const nextLevel = Math.min(level + 1, 3);

    _s.edges.forEach(e => {
      let nextId = null;
      if (e.source_id === id) nextId = e.target_id;
      else if (e.target_id === id && e.direction === 'bidirectional') nextId = e.source_id;
      if (!nextId || visited.has(nextId)) return;
      visited.add(nextId);
      const newPath = [...path, nextId];
      // Mark safety critical nodes as level 3
      const nextNode = _s.nodes.find(n => n.id === nextId);
      const assignedLevel = (nextNode?.is_safety_critical && nextLevel >= 2) ? 3 : nextLevel;
      _s.propagated[nextId] = { level: assignedLevel, path: newPath };
      queue.push({ id: nextId, level: nextLevel, path: newPath });
    });
  }

  const affectedCount = Object.keys(_s.propagated).length - 1;
  const critCount = Object.values(_s.propagated).filter(p => p.level === 3).length;
  document.getElementById('fmea-beta-prop-status').textContent =
    `⚡ ${affectedCount} node${affectedCount !== 1 ? 's' : ''} affected${critCount ? ` · ⚠ ${critCount} critical` : ''}`;
  document.getElementById('fmea-beta-clear-inject').style.display = '';

  const fm = FM_TYPES.find(f => f.key === fmKey);
  logEvent('Failure injected', `${_s.nodes.find(n => n.id === startNodeId)?.name} → ${fm?.label} → ${affectedCount} nodes affected`);
}

function clearInjection() {
  _s.propagated     = {};
  _s.injectedNodeId = null;
  _s.injectedFmKey  = null;
  document.getElementById('fmea-beta-prop-status').textContent = '';
  document.getElementById('fmea-beta-clear-inject').style.display = 'none';
  logEvent('Injection cleared', '');
  renderAll();
}

// ── DFMEA table generation ─────────────────────────────────────────────────────
function generateTable() {
  const rows = [];

  _s.nodes.forEach(node => {
    const allFms = [
      ...(node._fns || []).flatMap(f => f._fms.map(fm => ({ fn: f, fm }))),
      ...(node._compFms || []).map(fm => ({ fn: null, fm })),
    ];

    allFms.forEach(({ fn, fm }) => {
      // Find downstream effects via edges
      const downstreamIds = _s.edges
        .filter(e => e.source_id === node.id)
        .map(e => e.target_id);
      const localEffect = fn ? `Failure of function "${fn.name}"` : `Component failure`;
      const nextHigherEffect = downstreamIds.length
        ? downstreamIds.map(id => _s.nodes.find(n => n.id === id)?.name || '').filter(Boolean).join(', ')
        : '—';
      const endEffects = downstreamIds
        .map(id => _s.nodes.find(n => n.id === id))
        .filter(n => n?.is_safety_critical)
        .map(n => n.name);
      const endEffect = endEffects.length ? endEffects.join(', ') : nextHigherEffect || '—';

      rows.push({
        component:       node.name,
        function:        fn?.name || '—',
        failureMode:     fm.failure_mode,
        localEffect,
        nextHigherEffect,
        endEffect,
        severity:        endEffects.length ? '⚠ High' : downstreamIds.length ? 'Medium' : 'Low',
        safetyRelated:   fn?.is_safety_related || node.is_safety_critical,
      });
    });
  });

  _s.tableRows = rows;
  renderTable();
  logEvent('DFMEA table generated', `${rows.length} rows from ${_s.nodes.length} nodes`);
}

function renderTable() {
  const el = document.getElementById('fmea-table-inner');
  if (!el) return;

  if (!_s.tableRows.length) {
    el.innerHTML = `<div style="color:${C.textDim}; font-size:13px; padding:24px;">No failure modes defined. Add FMs in the Architecture page first.</div>`;
    return;
  }

  const cols = ['Component', 'Function', 'Failure Mode', 'Local Effect', 'Next Higher Effect', 'End Effect', 'Severity'];
  const thStyle = `padding:8px 12px; text-align:left; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:${C.textMuted}; border-bottom:1px solid ${C.border}; white-space:nowrap;`;
  const tdStyle = `padding:8px 12px; font-size:12px; border-bottom:1px solid ${C.border}; vertical-align:top;`;

  el.innerHTML = `
    <table style="width:100%; border-collapse:collapse; color:${C.text};">
      <thead>
        <tr style="background:${C.surface};">
          ${cols.map(c => `<th style="${thStyle}">${c}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${_s.tableRows.map((r, i) => {
          const rowBg = i % 2 === 0 ? C.bg : C.surface;
          const sevColor = r.severity.includes('High') ? C.red : r.severity === 'Medium' ? C.orange : C.textMuted;
          return `
            <tr style="background:${rowBg};">
              <td style="${tdStyle}">${escH(r.component)}${r.safetyRelated ? ` <span style="color:${C.red};font-size:9px;">FS</span>` : ''}</td>
              <td style="${tdStyle}">${escH(r.function)}</td>
              <td style="${tdStyle}; color:${C.orange};">${escH(r.failureMode)}</td>
              <td style="${tdStyle}; color:${C.textMuted};">${escH(r.localEffect)}</td>
              <td style="${tdStyle}; color:${C.textMuted};">${escH(r.nextHigherEffect)}</td>
              <td style="${tdStyle}; color:${C.textMuted};">${escH(r.endEffect)}</td>
              <td style="${tdStyle}; color:${sevColor}; font-weight:600;">${r.severity}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px; font-size:11px; color:${C.textDim};">${_s.tableRows.length} rows auto-generated · ${_s.tableRows.filter(r => r.safetyRelated).length} safety-related</div>
  `;
}

// ── Wiring ─────────────────────────────────────────────────────────────────────
function wireCanvas() {
  const wrap = document.getElementById('fmea-canvas-wrap');
  if (!wrap) return;

  // Pan
  let panStart = null;
  wrap.addEventListener('mousedown', e => {
    if (e.target.closest('.fmea-graph-node')) return;
    panStart = { mx: e.clientX, my: e.clientY, px: _s.pan.x, py: _s.pan.y };
    wrap.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!panStart) return;
    _s.pan.x = panStart.px + (e.clientX - panStart.mx);
    _s.pan.y = panStart.py + (e.clientY - panStart.my);
    renderGraph();
  });
  window.addEventListener('mouseup', () => { panStart = null; wrap.style.cursor = 'default'; });

  // Zoom
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    _s.zoom = Math.max(0.3, Math.min(3, _s.zoom * factor));
    renderGraph();
  }, { passive: false });

  // Node click + drag
  wrap.addEventListener('mousedown', e => {
    const nodeEl = e.target.closest('.fmea-graph-node');
    if (!nodeEl) return;
    const id = nodeEl.dataset.id;
    _s.selectedNodeId = id;
    renderAll();

    const node = _s.nodes.find(n => n.id === id);
    if (!node) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX  = node.x;
    const origY  = node.y;
    let moved = false;

    const onMove = mv => {
      moved = true;
      node.x = origX + (mv.clientX - startX) / _s.zoom;
      node.y = origY + (mv.clientY - startY) / _s.zoom;
      renderGraph();
    };
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moved) {
        await sb.from('arch_components').update({ x: node.x, y: node.y }).eq('id', node.id);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Topbar buttons
  document.getElementById('fmea-beta-clear-inject')?.addEventListener('click', clearInjection);
  document.getElementById('fmea-beta-gen-table')?.addEventListener('click', () => {
    generateTable();
    switchTab('table');
  });
}

function wireLeftPanel() {
  const el = document.getElementById('fmea-beta-left');
  if (!el) return;

  // Node list click
  el.addEventListener('click', e => {
    const item = e.target.closest('.fmea-node-item');
    if (!item) return;
    _s.selectedNodeId = item.dataset.id;
    renderAll();
  });

  // FM injection pills
  el.addEventListener('click', e => {
    const pill = e.target.closest('.fmea-fm-pill');
    if (!pill) return;
    if (!_s.selectedNodeId) {
      logEvent('No node selected', 'Select a node first, then click a failure type.');
      return;
    }
    propagate(_s.selectedNodeId, pill.dataset.fm);
    renderAll();
  });

  // FM pill hover style
  el.addEventListener('mouseover', e => {
    const pill = e.target.closest('.fmea-fm-pill');
    if (pill) { pill.style.background = C.surface2; pill.style.borderColor = C.borderHov; }
  });
  el.addEventListener('mouseout', e => {
    const pill = e.target.closest('.fmea-fm-pill');
    if (pill) { pill.style.background = C.surface2; pill.style.borderColor = C.border; }
  });
}

function wireTabBar() {
  const bar = document.querySelector('[data-tab]')?.closest('div');
  document.querySelectorAll('.fmea-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  _s.activeTab = tab;
  document.getElementById('fmea-canvas-wrap').style.display  = tab === 'graph' ? '' : 'none';
  document.getElementById('fmea-table-wrap').style.display   = tab === 'table' ? '' : 'none';
  document.querySelectorAll('.fmea-tab').forEach(b => {
    const active = b.dataset.tab === tab;
    b.style.cssText = tabStyle(active);
    b.classList.toggle('active', active);
  });
  if (tab === 'table' && !_s.tableRows.length) generateTable();
}

// ── Log ────────────────────────────────────────────────────────────────────────
function logEvent(title, detail) {
  const el = document.getElementById('fmea-log-entries');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.style.cssText = `padding:1px 0; border-bottom:1px solid ${C.border};`;
  div.innerHTML = `<span style="color:${C.textDim};">[${time}]</span> <span style="color:${C.accent};">${escH(title)}</span>${detail ? ` <span style="color:${C.textDim};">— ${escH(detail)}</span>` : ''}`;
  el.prepend(div);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escH(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function btnStyle(bg) {
  return `background:${bg}; border:1px solid ${C.border}; border-radius:5px; color:${C.text}; font-size:12px; font-weight:600; padding:6px 12px; cursor:pointer;`;
}

function tabStyle(active) {
  return `background:transparent; border:none; border-bottom:2px solid ${active ? C.accent : 'transparent'}; color:${active ? C.accent : C.textMuted}; font-size:12px; font-weight:${active ? '700' : '500'}; padding:0 14px; height:38px; cursor:pointer; transition:color .15s;`;
}
