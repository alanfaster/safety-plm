// NEW FMEA Beta — functional dependency graph
// Nodes = functional elements  |  Edges = dependency/propagation paths
// Own data model, independent from arch_components

import { sb } from '../../config.js';

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  bg:        '#0f1117',
  surface:   '#1a1d27',
  surface2:  '#22263a',
  border:    '#2e3350',
  borderHov: '#4a5080',
  text:      '#e8eaf6',
  textMuted: '#6b7db3',
  textDim:   '#3d4a70',
  primary:   '#5c6bc0',
  accent:    '#00e5ff',
  green:     '#00e676',
  orange:    '#ff9100',
  red:       '#ff1744',
  yellow:    '#ffea00',
  purple:    '#d500f9',
};

const NODE_TYPES = {
  function:       { icon: 'λ',  label: 'Function',       color: C.accent  },
  sensor:         { icon: '◉',  label: 'Sensor',         color: C.green   },
  actuator:       { icon: '⬡',  label: 'Actuator',       color: C.orange  },
  controller:     { icon: '⬟',  label: 'Controller',     color: C.primary },
  bus:            { icon: '⇌',  label: 'Bus / Network',  color: C.purple  },
  power:          { icon: '⚡',  label: 'Power Supply',   color: C.yellow  },
  safety_monitor: { icon: '⊕',  label: 'Safety Monitor', color: C.red     },
  external:       { icon: '□',  label: 'External',       color: C.textMuted },
};

const EDGE_TYPES = {
  depends_on:       { label: 'Depends on',      dash: ''    },
  controls:         { label: 'Controls',         dash: ''    },
  monitors:         { label: 'Monitors',         dash: '6,3' },
  powers:           { label: 'Powers',           dash: ''    },
  communicates_with:{ label: 'Communicates',     dash: '3,3' },
  triggers:         { label: 'Triggers',         dash: '8,2,2,2' },
};

const NODE_W = 160;
const NODE_H = 80;

// ── State ──────────────────────────────────────────────────────────────────────
let _ctx = null;
let _s = {
  nodes: [],
  edges: [],
  fms: {},        // nodeId → [fm, ...]
  propRules: {},  // edgeId → [rule, ...]
  selectedId: null,
  selectedType: null,  // 'node' | 'edge'
  pan: { x: 80, y: 80 },
  zoom: 1,
  connecting: null,   // { fromId, fromX, fromY, curX, curY }
  draggingNode: null,
  injected: null,     // { nodeId, fmId }
  propagated: {},     // nodeId → { level, path, effects[] }
  activeTab: 'graph',
};

// ── Entry point ────────────────────────────────────────────────────────────────
export async function renderFmeaBeta(container, ctx) {
  _ctx = ctx;
  const { item, system } = ctx;
  const scope = system ? `${item?.name || ''} › ${system.name}` : (item?.name || '');

  container.innerHTML = `
    <div id="fb-root" style="display:flex;flex-direction:column;height:100%;
      background:${C.bg};color:${C.text};font-family:'Inter',system-ui,sans-serif;overflow:hidden;">
      ${topbar(scope)}
      <div style="display:flex;flex:1;overflow:hidden;">
        ${leftPanel()}
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          ${tabBar()}
          <div id="fb-center" style="flex:1;position:relative;overflow:hidden;">
            ${canvasHTML()}
            ${tableHTML()}
          </div>
        </div>
        ${rightPanel()}
      </div>
    </div>
  `;

  await load();
  wire();
  renderAll();
}

// ── Load ───────────────────────────────────────────────────────────────────────
async function load() {
  const { parentType, parentId } = _ctx;
  const [nRes, eRes, fRes, rRes] = await Promise.all([
    sb.from('fmea_nodes').select('*').eq('parent_type', parentType).eq('parent_id', parentId).order('created_at'),
    sb.from('fmea_edges').select('*').eq('project_id', _ctx.project.id),
    sb.from('fmea_failure_modes').select('*').eq('project_id', _ctx.project.id).order('sort_order'),
    sb.from('fmea_propagation_rules').select('*'),
  ]);
  _s.nodes = nRes.data || [];
  // filter edges to only those between our nodes
  const nids = new Set(_s.nodes.map(n => n.id));
  _s.edges = (eRes.data || []).filter(e => nids.has(e.source_id) && nids.has(e.target_id));
  _s.fms = {};
  (fRes.data || []).forEach(fm => { (_s.fms[fm.node_id] ||= []).push(fm); });
  _s.propRules = {};
  const eids = new Set(_s.edges.map(e => e.id));
  (rRes.data || []).filter(r => eids.has(r.edge_id)).forEach(r => { (_s.propRules[r.edge_id] ||= []).push(r); });
  _s.injected   = null;
  _s.propagated = {};
  log('Model loaded', `${_s.nodes.length} nodes · ${_s.edges.length} edges`);
}

// ── HTML builders ──────────────────────────────────────────────────────────────
function topbar(scope) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:0 16px;height:48px;
    flex-shrink:0;background:${C.surface};border-bottom:1px solid ${C.border};">
    <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:${C.accent};text-transform:uppercase;">NEW FMEA</span>
    <span style="color:${C.border};font-size:16px;">|</span>
    <span style="font-size:11px;font-weight:600;letter-spacing:1px;color:${C.primary};text-transform:uppercase;opacity:.7;">Beta</span>
    <span style="flex:1;"></span>
    <span style="font-size:12px;color:${C.textMuted};">${escH(scope)}</span>
    <span id="fb-prop-status" style="font-size:11px;color:${C.textMuted};"></span>
    <button id="fb-clear-btn" style="${btnS(C.surface2)};display:none;">✕ Clear</button>
    <button id="fb-gen-btn"   style="${btnS(C.primary)};">⚡ Generate DFMEA</button>
  </div>`;
}

function leftPanel() {
  return `<div style="width:220px;flex-shrink:0;background:${C.surface};border-right:1px solid ${C.border};
    display:flex;flex-direction:column;overflow:hidden;">
    <div style="${sectionHeader()}">Add Node</div>
    <div style="padding:6px 8px;display:flex;flex-direction:column;gap:3px;">
      ${Object.entries(NODE_TYPES).map(([k, v]) => `
        <button class="fb-add-node-btn" data-type="${k}" style="
          display:flex;align-items:center;gap:8px;
          background:${C.surface2};border:1px solid ${C.border};border-radius:5px;
          color:${C.text};font-size:11px;padding:5px 8px;cursor:pointer;text-align:left;
          transition:border-color .15s;">
          <span style="color:${v.color};font-size:13px;width:16px;text-align:center;">${v.icon}</span>
          <span>${v.label}</span>
        </button>`).join('')}
    </div>
    <div style="${sectionHeader()};margin-top:auto;">System Explorer</div>
    <div id="fb-node-list" style="flex:1;overflow-y:auto;padding:0 6px 8px;min-height:0;"></div>
  </div>`;
}

function tabBar() {
  return `<div style="display:flex;align-items:center;background:${C.surface};
    border-bottom:1px solid ${C.border};padding:0 16px;height:38px;flex-shrink:0;">
    <button class="fb-tab active" data-tab="graph" style="${tabS(true)}">⬡ Graph</button>
    <button class="fb-tab" data-tab="table" style="${tabS(false)}">⊞ DFMEA Table</button>
    <span style="flex:1;"></span>
    <span style="font-size:11px;color:${C.textDim};">Double-click canvas to add node · Drag node border to connect</span>
  </div>`;
}

function canvasHTML() {
  return `<div id="fb-canvas" style="position:absolute;inset:0;
    background:${C.bg};
    background-image:radial-gradient(${C.border} 1px,transparent 1px);
    background-size:28px 28px;
    overflow:hidden;cursor:default;">
    <svg id="fb-svg" style="position:absolute;inset:0;width:100%;height:100%;
      pointer-events:none;overflow:visible;">
      <defs>
        <marker id="fb-arrow"        markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${C.textMuted}"/></marker>
        <marker id="fb-arrow-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${C.accent}"/></marker>
        <marker id="fb-arrow-danger" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${C.red}"/></marker>
        <filter id="fb-glow-a"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="fb-glow-r"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <g id="fb-edges-g"></g>
      <g id="fb-drag-edge-g"></g>
    </svg>
    <div id="fb-nodes-g" style="position:absolute;inset:0;pointer-events:none;"></div>
    <div id="fb-empty" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;
      color:${C.textDim};font-size:13px;pointer-events:none;">
      <div style="font-size:40px;opacity:.2;">λ</div>
      <div>No functional nodes yet.</div>
      <div style="font-size:11px;">Click a node type on the left, then click on the canvas to place it.</div>
    </div>
  </div>`;
}

function tableHTML() {
  return `<div id="fb-table-wrap" style="position:absolute;inset:0;display:none;
    background:${C.bg};overflow:auto;padding:20px;">
    <div id="fb-table-inner"></div>
  </div>`;
}

function rightPanel() {
  return `<div style="width:280px;flex-shrink:0;background:${C.surface};
    border-left:1px solid ${C.border};display:flex;flex-direction:column;overflow:hidden;">
    <div style="${sectionHeader()}">Properties</div>
    <div id="fb-props" style="flex:1;overflow-y:auto;padding:12px 14px;">
      <div style="color:${C.textDim};font-size:12px;padding-top:8px;">
        Select a node or edge to inspect.<br><br>
        <span style="color:${C.textDim};font-size:11px;line-height:1.8;">
          • Click node → inspect / add FMs<br>
          • Drag from node edge → create connection<br>
          • Double-click canvas → add node<br>
          • Delete key → remove selected
        </span>
      </div>
    </div>
  </div>`;
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderAll() {
  renderNodeList();
  renderGraph();
  renderProps();
}

function renderNodeList() {
  const el = document.getElementById('fb-node-list');
  if (!el) return;
  if (!_s.nodes.length) {
    el.innerHTML = `<div style="padding:8px 6px;color:${C.textDim};font-size:11px;">No nodes yet</div>`;
    return;
  }
  el.innerHTML = _s.nodes.map(n => {
    const nt   = NODE_TYPES[n.node_type] || NODE_TYPES.function;
    const prop = _s.propagated[n.id];
    const isInj = _s.injected?.nodeId === n.id;
    const dotC = isInj ? C.orange : prop?.level === 3 ? C.red : prop?.level === 2 ? C.orange : prop?.level === 1 ? C.yellow : C.textDim;
    const isSel = _s.selectedId === n.id && _s.selectedType === 'node';
    return `<div class="fb-nl-item" data-id="${n.id}" style="
      display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:5px;
      cursor:pointer;margin-bottom:2px;
      background:${isSel ? C.surface2 : 'transparent'};
      border:1px solid ${isSel ? C.primary : 'transparent'};transition:background .1s;">
      <span style="width:7px;height:7px;border-radius:50%;background:${dotC};flex-shrink:0;"></span>
      <span style="color:${nt.color};font-size:11px;width:14px;text-align:center;">${nt.icon}</span>
      <span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(n.name)}</span>
    </div>`;
  }).join('');
}

function renderGraph() {
  const nodesG = document.getElementById('fb-nodes-g');
  const edgesG = document.getElementById('fb-edges-g');
  const empty  = document.getElementById('fb-empty');
  if (!nodesG) return;

  empty.style.display = _s.nodes.length ? 'none' : 'flex';
  edgesG.innerHTML = '';
  nodesG.innerHTML = '';

  const { x: px, y: py } = _s.pan;
  const z = _s.zoom;

  // Edges
  _s.edges.forEach(e => {
    const src = _s.nodes.find(n => n.id === e.source_id);
    const tgt = _s.nodes.find(n => n.id === e.target_id);
    if (!src || !tgt) return;

    const sx = src.x * z + px + (NODE_W * z) / 2;
    const sy = src.y * z + py + (NODE_H * z) / 2;
    const tx = tgt.x * z + px + (NODE_W * z) / 2;
    const ty = tgt.y * z + py + (NODE_H * z) / 2;

    const propTgt = _s.propagated[tgt.id];
    const propSrc = _s.propagated[src.id];
    const isActive = !!(propSrc && propTgt);
    const isCrit   = propTgt?.level === 3;
    const isSel    = _s.selectedId === e.id && _s.selectedType === 'edge';

    const color  = isCrit ? C.red : isActive ? C.accent : isSel ? C.primary : C.border;
    const marker = isCrit ? 'fb-arrow-danger' : isActive ? 'fb-arrow-active' : 'fb-arrow';
    const width  = isActive || isSel ? 2 : 1.5;
    const et     = EDGE_TYPES[e.edge_type] || EDGE_TYPES.depends_on;
    const dash   = et.dash ? `stroke-dasharray="${et.dash}"` : '';
    const filter = isCrit ? 'filter="url(#fb-glow-r)"' : isActive ? 'filter="url(#fb-glow-a)"' : '';
    const cx1 = sx + (tx - sx) * 0.45;
    const cx2 = tx - (tx - sx) * 0.45;

    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const hasEffect = _s.propRules[e.id]?.length > 0;

    edgesG.innerHTML += `
      <g class="fb-edge-hit" data-eid="${e.id}" style="cursor:pointer;pointer-events:stroke;">
        <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
          stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>
        <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
          stroke="${color}" stroke-width="${width}" fill="none"
          ${dash} ${filter} marker-end="url(#${marker})"
          style="${isActive ? 'animation:fmea-pulse 1.2s ease-in-out infinite;' : ''}"/>
        ${e.label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="9"
          font-family="Inter,sans-serif" fill="${C.textMuted}">${escH(e.label)}</text>` : ''}
        ${hasEffect && _s.injected ? `
          <g transform="translate(${mx},${my+8})">
            <rect x="-28" y="-8" width="56" height="16" rx="3" fill="${C.surface}" stroke="${color}" stroke-width="1" opacity=".9"/>
            <text x="0" y="4" text-anchor="middle" font-size="9" font-family="monospace" fill="${color}">⚡ effect</text>
          </g>` : ''}
      </g>`;
  });

  // Nodes
  _s.nodes.forEach(n => {
    const nt   = NODE_TYPES[n.node_type] || NODE_TYPES.function;
    const prop = _s.propagated[n.id];
    const isInj = _s.injected?.nodeId === n.id;
    const isSel = _s.selectedId === n.id && _s.selectedType === 'node';
    const fms   = _s.fms[n.id] || [];

    const nx = n.x * z + px;
    const ny = n.y * z + py;
    const nw = NODE_W * z;
    const nh = NODE_H * z;

    let borderColor = isSel ? C.primary : C.border;
    let bgColor     = C.surface;
    let glow        = '';

    if (isInj)            { borderColor = C.orange; bgColor = '#1f1500'; glow = `box-shadow:0 0 18px ${C.orange}66;`; }
    else if (prop?.level === 3) { borderColor = C.red;    bgColor = '#1a0008'; glow = `box-shadow:0 0 20px ${C.red}55;`; }
    else if (prop?.level === 2) { borderColor = C.orange; bgColor = '#1a0e00'; glow = `box-shadow:0 0 14px ${C.orange}44;`; }
    else if (prop?.level === 1) { borderColor = C.yellow; bgColor = '#191600'; glow = `box-shadow:0 0 10px ${C.yellow}33;`; }

    const fmBadge  = fms.length ? `<div style="font-size:${Math.max(9,10*z)}px;color:${isInj||prop?C.red:C.textMuted};">⚠ ${fms.length} FM${fms.length!==1?'s':''}</div>` : '';
    const safetyDot = n.is_safety_critical ? `<span style="color:${C.red};font-size:10px;" title="Safety critical">⬟</span>` : '';
    const injLabel  = isInj && _s.injected?.fmId
      ? `<div style="margin-top:3px;padding:2px 5px;border-radius:3px;background:#ff910022;border:1px solid ${C.orange};font-size:${Math.max(8,9*z)}px;color:${C.orange};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
           ⚡ ${escH(fms.find(f=>f.id===_s.injected.fmId)?.failure_mode||'')}
         </div>` : '';

    const el = document.createElement('div');
    el.className   = 'fb-node';
    el.dataset.id  = n.id;
    el.style.cssText = `
      position:absolute;left:${nx}px;top:${ny}px;width:${nw}px;height:${nh}px;
      background:${bgColor};border:1.5px solid ${borderColor};border-radius:8px;
      padding:8px 10px;box-sizing:border-box;cursor:pointer;pointer-events:all;
      transition:border-color .2s,background .2s;${glow}
      display:flex;flex-direction:column;gap:3px;user-select:none;`;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:${nt.color};font-size:${Math.max(11,14*z)}px;flex-shrink:0;">${nt.icon}</span>
        <span style="font-size:${Math.max(10,12*z)}px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escH(n.name)}</span>
        ${safetyDot}
      </div>
      <div style="font-size:${Math.max(9,10*z)}px;color:${C.textMuted};">${nt.label}</div>
      ${fmBadge}${injLabel}
      <div class="fb-conn-handle" data-id="${n.id}" style="
        position:absolute;right:-6px;top:50%;transform:translateY(-50%);
        width:12px;height:12px;border-radius:50%;
        background:${C.accent};border:2px solid ${C.bg};
        cursor:crosshair;pointer-events:all;opacity:0;transition:opacity .15s;"></div>`;
    nodesG.appendChild(el);
  });
}

function renderProps() {
  const el = document.getElementById('fb-props');
  if (!el) return;

  if (!_s.selectedId) {
    el.innerHTML = `<div style="color:${C.textDim};font-size:12px;padding-top:8px;">
      Select a node or edge to inspect.<br><br>
      <span style="color:${C.textDim};font-size:11px;line-height:1.8;">
        • Click node → inspect / add FMs<br>
        • Drag from ● handle → create connection<br>
        • Double-click canvas → add node<br>
        • Delete key → remove selected
      </span></div>`;
    return;
  }

  if (_s.selectedType === 'node') renderNodeProps();
  else renderEdgeProps();
}

function renderNodeProps() {
  const el   = document.getElementById('fb-props');
  const node = _s.nodes.find(n => n.id === _s.selectedId);
  if (!el || !node) return;
  const nt   = NODE_TYPES[node.node_type] || NODE_TYPES.function;
  const fms  = _s.fms[node.id] || [];
  const prop = _s.propagated[node.id];
  const isInj = _s.injected?.nodeId === node.id;

  const propBadge = isInj
    ? pill('⚡ INJECTION', C.orange)
    : prop?.level === 3 ? pill('⚠ CRITICAL', C.red)
    : prop?.level === 2 ? pill('⚡ PROPAGATED', C.orange)
    : prop?.level === 1 ? pill('→ LOCAL EFFECT', C.yellow)
    : '';

  const fmRows = fms.map(fm => {
    const rules = Object.values(_s.propRules).flat().filter(r => r.source_fm_id === fm.id);
    return `<div class="fb-fm-row" data-fmid="${fm.id}" style="
      padding:6px 8px;border-radius:4px;background:${C.surface2};border:1px solid ${C.border};
      margin-bottom:4px;cursor:pointer;transition:border-color .15s;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:${C.red};font-size:10px;">⚠</span>
        <span style="font-size:12px;flex:1;">${escH(fm.failure_mode)}</span>
        <button class="fb-del-fm" data-fmid="${fm.id}" style="background:none;border:none;
          color:${C.textDim};cursor:pointer;font-size:12px;padding:0 2px;" title="Delete FM">✕</button>
      </div>
      ${fm.local_effect ? `<div style="font-size:11px;color:${C.textMuted};margin-top:3px;margin-left:16px;">${escH(fm.local_effect)}</div>` : ''}
      ${rules.length ? `<div style="font-size:10px;color:${C.textDim};margin-top:3px;margin-left:16px;">→ ${rules.length} propagation rule${rules.length!==1?'s':''}</div>` : ''}
      <button class="fb-inject-fm" data-nodeid="${node.id}" data-fmid="${fm.id}" style="
        margin-top:5px;width:100%;${btnS(C.surface)};font-size:10px;border-color:${C.primary};">
        ⚡ Inject this failure
      </button>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
    <div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="color:${nt.color};font-size:16px;">${nt.icon}</span>
        <span style="font-size:14px;font-weight:700;">${escH(node.name)}</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${pill(nt.label, nt.color)}
        ${node.is_safety_critical ? pill('Safety Critical', C.red) : ''}
        ${propBadge}
      </div>
    </div>
    ${node.description ? `<div style="font-size:12px;color:${C.textMuted};line-height:1.5;">${escH(node.description)}</div>` : ''}

    <div>
      <div style="${sectionLabel()}">Failure Modes</div>
      ${fmRows || `<div style="font-size:11px;color:${C.textDim};margin-bottom:6px;">No FMs defined yet.</div>`}
      <div id="fb-fm-add-area">
        <button id="fb-add-fm-btn" data-nodeid="${node.id}" style="${btnS(C.surface2)};width:100%;font-size:11px;">＋ Add Failure Mode</button>
      </div>
    </div>

    ${prop?.effects?.length ? `
      <div>
        <div style="${sectionLabel()}">Propagation Effects</div>
        ${prop.effects.map(e => `<div style="font-size:11px;color:${C.textMuted};padding:4px 0;border-bottom:1px solid ${C.border};">${escH(e)}</div>`).join('')}
      </div>` : ''}

    <div style="margin-top:4px;display:flex;flex-direction:column;gap:4px;">
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
        <input type="checkbox" id="fb-sc-check" ${node.is_safety_critical?'checked':''} style="accent-color:${C.red};">
        Safety critical node
      </label>
      <button id="fb-del-node-btn" data-nodeid="${node.id}" style="${btnS(C.surface2)};color:${C.red};border-color:${C.red}33;font-size:11px;width:100%;margin-top:4px;">
        🗑 Delete node
      </button>
    </div>
  </div>`;

  document.getElementById('fb-sc-check')?.addEventListener('change', async e => {
    node.is_safety_critical = e.target.checked;
    await sb.from('fmea_nodes').update({ is_safety_critical: node.is_safety_critical }).eq('id', node.id);
    renderGraph(); renderNodeList();
  });

  document.getElementById('fb-add-fm-btn')?.addEventListener('click', () => showAddFmForm(node.id));

  el.querySelectorAll('.fb-inject-fm').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      injectFailure(btn.dataset.nodeid, btn.dataset.fmid);
    });
  });

  el.querySelectorAll('.fb-del-fm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const fmid = btn.dataset.fmid;
      await sb.from('fmea_failure_modes').delete().eq('id', fmid);
      _s.fms[node.id] = (_s.fms[node.id] || []).filter(f => f.id !== fmid);
      renderAll();
    });
  });

  document.getElementById('fb-del-node-btn')?.addEventListener('click', () => deleteNode(node.id));
}

function renderEdgeProps() {
  const el   = document.getElementById('fb-props');
  const edge = _s.edges.find(e => e.id === _s.selectedId);
  if (!el || !edge) return;
  const src  = _s.nodes.find(n => n.id === edge.source_id);
  const tgt  = _s.nodes.find(n => n.id === edge.target_id);
  const et   = EDGE_TYPES[edge.edge_type] || EDGE_TYPES.depends_on;
  const rules = _s.propRules[edge.id] || [];
  const srcFms = _s.fms[edge.source_id] || [];

  const rulesHtml = rules.map(r => {
    const fm = srcFms.find(f => f.id === r.source_fm_id);
    return `<div style="padding:6px 8px;border-radius:4px;background:${C.surface2};
      border:1px solid ${C.border};margin-bottom:4px;font-size:11px;">
      <div style="color:${C.orange};">⚠ ${escH(fm?.failure_mode || '?')}</div>
      <div style="color:${C.textMuted};margin-top:2px;">→ ${escH(r.effect_at_target)}</div>
      <div style="color:${C.textDim};margin-top:1px;font-size:10px;">Severity ${r.severity}/10</div>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
    <div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">Connection</div>
      <div style="font-size:12px;color:${C.textMuted};">
        <span style="color:${C.text};">${escH(src?.name||'?')}</span>
        <span style="color:${C.accent};margin:0 6px;">→</span>
        <span style="color:${C.text};">${escH(tgt?.name||'?')}</span>
      </div>
      <div style="margin-top:6px;">${pill(et.label, C.primary)}</div>
    </div>

    <div>
      <div style="${sectionLabel()}">Edge type</div>
      <select id="fb-edge-type-sel" style="width:100%;background:${C.surface2};border:1px solid ${C.border};
        border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;cursor:pointer;">
        ${Object.entries(EDGE_TYPES).map(([k,v])=>`<option value="${k}" ${k===edge.edge_type?'selected':''}>${v.label}</option>`).join('')}
      </select>
    </div>

    <div>
      <div style="${sectionLabel()}">Label (signal name)</div>
      <input id="fb-edge-label" value="${escH(edge.label||'')}" placeholder="e.g. CAN signal, PWM…"
        style="width:100%;box-sizing:border-box;background:${C.surface2};border:1px solid ${C.border};
        border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;outline:none;">
    </div>

    <div>
      <div style="${sectionLabel()}">Propagation Rules <span style="color:${C.textDim};font-weight:400;">(if FM occurs at source, effect at target is…)</span></div>
      ${rulesHtml || `<div style="font-size:11px;color:${C.textDim};margin-bottom:6px;">No rules yet.</div>`}
      ${srcFms.length ? `
        <div id="fb-rule-add-area">
          <button id="fb-add-rule-btn" style="${btnS(C.surface2)};width:100%;font-size:11px;">＋ Add propagation rule</button>
        </div>` : `<div style="font-size:11px;color:${C.textDim};">Add FMs to source node first.</div>`}
    </div>

    <button id="fb-del-edge-btn" style="${btnS(C.surface2)};color:${C.red};border-color:${C.red}33;font-size:11px;width:100%;">
      🗑 Delete connection
    </button>
  </div>`;

  document.getElementById('fb-edge-type-sel')?.addEventListener('change', async e => {
    edge.edge_type = e.target.value;
    await sb.from('fmea_edges').update({ edge_type: edge.edge_type }).eq('id', edge.id);
    renderGraph();
  });

  document.getElementById('fb-edge-label')?.addEventListener('blur', async e => {
    edge.label = e.target.value.trim();
    await sb.from('fmea_edges').update({ label: edge.label }).eq('id', edge.id);
    renderGraph();
  });

  document.getElementById('fb-add-rule-btn')?.addEventListener('click', () => showAddRuleForm(edge, srcFms));

  document.getElementById('fb-del-edge-btn')?.addEventListener('click', async () => {
    await sb.from('fmea_edges').delete().eq('id', edge.id);
    _s.edges = _s.edges.filter(e => e.id !== edge.id);
    _s.selectedId = null;
    renderAll();
  });
}

// ── Add FM form ────────────────────────────────────────────────────────────────
function showAddFmForm(nodeId) {
  const area = document.getElementById('fb-fm-add-area');
  if (!area) return;
  area.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;padding:6px;background:${C.surface2};border:1px solid ${C.border};border-radius:5px;">
      <input id="fb-fm-inp" placeholder="Failure mode…" style="background:${C.bg};border:1px solid ${C.border};
        border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;outline:none;width:100%;box-sizing:border-box;">
      <input id="fb-fe-inp" placeholder="Local effect (optional)…" style="background:${C.bg};border:1px solid ${C.border};
        border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;outline:none;width:100%;box-sizing:border-box;">
      <div style="display:flex;gap:4px;">
        <button id="fb-fm-save" style="${btnS(C.primary)};flex:1;font-size:11px;">Save</button>
        <button id="fb-fm-cancel" style="${btnS(C.surface)};font-size:11px;">Cancel</button>
      </div>
    </div>`;
  document.getElementById('fb-fm-inp')?.focus();

  const save = async () => {
    const fm   = document.getElementById('fb-fm-inp')?.value.trim();
    const fe   = document.getElementById('fb-fe-inp')?.value.trim();
    if (!fm) return;
    const { data } = await sb.from('fmea_failure_modes').insert({
      node_id: nodeId, project_id: _ctx.project.id,
      failure_mode: fm, local_effect: fe || null,
      sort_order: (_s.fms[nodeId] || []).length,
    }).select().single();
    if (data) { (_s.fms[nodeId] ||= []).push(data); }
    renderProps();
    log('FM added', fm);
  };

  document.getElementById('fb-fm-save')?.addEventListener('click', save);
  document.getElementById('fb-fm-cancel')?.addEventListener('click', renderProps);
  document.getElementById('fb-fm-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('fb-fe-inp')?.focus(); });
  document.getElementById('fb-fe-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// ── Add propagation rule form ──────────────────────────────────────────────────
function showAddRuleForm(edge, srcFms) {
  const area = document.getElementById('fb-rule-add-area');
  if (!area) return;
  area.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:4px;padding:6px;background:${C.surface2};border:1px solid ${C.border};border-radius:5px;">
      <select id="fb-rule-fm-sel" style="background:${C.bg};border:1px solid ${C.border};border-radius:4px;
        color:${C.text};font-size:12px;padding:5px 8px;width:100%;box-sizing:border-box;">
        <option value="">— Select source FM —</option>
        ${srcFms.map(f => `<option value="${f.id}">${escH(f.failure_mode)}</option>`).join('')}
      </select>
      <input id="fb-rule-eff" placeholder="Effect at target node…" style="background:${C.bg};border:1px solid ${C.border};
        border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;outline:none;width:100%;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:11px;color:${C.textMuted};">Severity</label>
        <input id="fb-rule-sev" type="number" min="1" max="10" value="5" style="width:50px;background:${C.bg};
          border:1px solid ${C.border};border-radius:4px;color:${C.text};font-size:12px;padding:4px 6px;outline:none;">
        <span style="font-size:10px;color:${C.textDim};">/10</span>
      </div>
      <div style="display:flex;gap:4px;">
        <button id="fb-rule-save" style="${btnS(C.primary)};flex:1;font-size:11px;">Save</button>
        <button id="fb-rule-cancel" style="${btnS(C.surface)};font-size:11px;">Cancel</button>
      </div>
    </div>`;

  const save = async () => {
    const fmId  = document.getElementById('fb-rule-fm-sel')?.value;
    const eff   = document.getElementById('fb-rule-eff')?.value.trim();
    const sev   = parseInt(document.getElementById('fb-rule-sev')?.value) || 5;
    if (!fmId || !eff) return;
    const { data } = await sb.from('fmea_propagation_rules').insert({
      edge_id: edge.id, source_fm_id: fmId,
      effect_at_target: eff, severity: sev,
    }).select().single();
    if (data) { (_s.propRules[edge.id] ||= []).push(data); }
    renderEdgeProps();
    log('Propagation rule added', eff);
  };

  document.getElementById('fb-rule-save')?.addEventListener('click', save);
  document.getElementById('fb-rule-cancel')?.addEventListener('click', renderEdgeProps);
}

// ── Propagation engine ─────────────────────────────────────────────────────────
function injectFailure(nodeId, fmId) {
  _s.injected   = { nodeId, fmId };
  _s.propagated = {};

  // BFS
  const queue   = [{ id: nodeId, level: 0, path: [nodeId], effects: [] }];
  const visited = new Set([nodeId]);
  _s.propagated[nodeId] = { level: 0, path: [nodeId], effects: [] };

  let currentFmIds = new Set([fmId]);

  while (queue.length) {
    const { id, level, path } = queue.shift();

    _s.edges.forEach(e => {
      if (e.source_id !== id) return;
      const nextId = e.target_id;
      if (visited.has(nextId)) return;

      // Check if any propagation rules match current active FMs on this edge
      const rules = (_s.propRules[e.id] || []).filter(r => currentFmIds.has(r.source_fm_id));
      const hasSemanticRule = rules.length > 0;

      // Always propagate topologically, but semantic rules give us effects + severity
      visited.add(nextId);
      const nextNode   = _s.nodes.find(n => n.id === nextId);
      const maxSev     = rules.length ? Math.max(...rules.map(r => r.severity)) : 5;
      const isCritical = nextNode?.is_safety_critical || maxSev >= 8;
      const newLevel   = isCritical ? 3 : level + 1 >= 2 ? 2 : 1;
      const effects    = rules.map(r => r.effect_at_target);
      const newPath    = [...path, nextId];

      _s.propagated[nextId] = { level: newLevel, path: newPath, effects, hasSemanticRule };
      queue.push({ id: nextId, level: level + 1, path: newPath, effects });

      // Next hop FMs: use target node's FMs if they were triggered
      if (hasSemanticRule) {
        (_s.fms[nextId] || []).forEach(f => currentFmIds.add(f.id));
      }
    });
  }

  const affected = Object.keys(_s.propagated).length - 1;
  const critical = Object.values(_s.propagated).filter(p => p.level === 3).length;
  const fm       = (_s.fms[nodeId] || []).find(f => f.id === fmId);
  const node     = _s.nodes.find(n => n.id === nodeId);

  document.getElementById('fb-prop-status').textContent =
    `⚡ ${affected} affected${critical ? ` · ⚠ ${critical} critical` : ''}`;
  document.getElementById('fb-clear-btn').style.display = '';

  log('Failure injected', `${node?.name} → "${fm?.failure_mode}" → ${affected} nodes affected`);
  renderAll();
}

function clearInjection() {
  _s.injected   = null;
  _s.propagated = {};
  document.getElementById('fb-prop-status').textContent = '';
  document.getElementById('fb-clear-btn').style.display = 'none';
  log('Injection cleared', '');
  renderAll();
}

// ── DFMEA table generation ─────────────────────────────────────────────────────
function generateTable() {
  const rows = [];
  _s.nodes.forEach(node => {
    const fms = _s.fms[node.id] || [];
    fms.forEach(fm => {
      const outEdges = _s.edges.filter(e => e.source_id === node.id);
      const rules    = outEdges.flatMap(e => (_s.propRules[e.id] || []).filter(r => r.source_fm_id === fm.id));
      const nextNodes = [...new Set(outEdges.map(e => _s.nodes.find(n => n.id === e.target_id)?.name).filter(Boolean))];
      const endNodes  = [...new Set(outEdges.map(e => e.target_id).flatMap(tid => {
        const n = _s.nodes.find(x => x.id === tid);
        return n?.is_safety_critical ? [n.name] : [];
      }))];
      const maxSev   = rules.length ? Math.max(...rules.map(r => r.severity)) : null;
      const sevLabel = maxSev ? (maxSev >= 8 ? `⚠ ${maxSev}` : `${maxSev}`) : '—';
      const sevColor = maxSev >= 8 ? C.red : maxSev >= 5 ? C.orange : C.textMuted;

      rows.push({
        node:        node.name,
        nodeType:    NODE_TYPES[node.node_type]?.label || node.node_type,
        fm:          fm.failure_mode,
        localEffect: fm.local_effect || '—',
        effects:     rules.map(r => r.effect_at_target),
        nextHigher:  nextNodes.join(', ') || '—',
        endEffect:   endNodes.join(', ')  || nextNodes[0] || '—',
        severity:    sevLabel,
        sevColor,
        safety:      node.is_safety_critical || (maxSev >= 8),
      });
    });
  });

  renderTableView(rows);
  log('DFMEA generated', `${rows.length} rows from ${_s.nodes.length} nodes`);
}

function renderTableView(rows) {
  const el = document.getElementById('fb-table-inner');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div style="color:${C.textDim};font-size:13px;padding:24px;">No failure modes defined yet. Add FMs to nodes first.</div>`;
    return;
  }
  const th = s => `<th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.textMuted};border-bottom:1px solid ${C.border};white-space:nowrap;">${s}</th>`;
  const td = (s, color) => `<td style="padding:8px 12px;font-size:12px;border-bottom:1px solid ${C.border};vertical-align:top;${color?`color:${color};`:'color:${C.text};'}">${s}</td>`;

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;color:${C.text};">
      <thead><tr style="background:${C.surface};">
        ${['Node','Type','Failure Mode','Local Effect','Propagated Effects','Next Higher','End Effect','Severity'].map(th).join('')}
      </tr></thead>
      <tbody>
        ${rows.map((r,i) => `<tr style="background:${i%2===0?C.bg:C.surface};">
          ${td(escH(r.node) + (r.safety ? ` <span style="color:${C.red};font-size:9px;">FS</span>` : ''))}
          ${td(escH(r.nodeType), C.textMuted)}
          ${td(escH(r.fm), C.orange)}
          ${td(escH(r.localEffect), C.textMuted)}
          ${td(r.effects.map(e => `<div>→ ${escH(e)}</div>`).join('') || '<span style="color:'+C.textDim+';">—</span>')}
          ${td(escH(r.nextHigher), C.textMuted)}
          ${td(escH(r.endEffect), C.textMuted)}
          ${td(r.severity, r.sevColor)}
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px;font-size:11px;color:${C.textDim};">${rows.length} rows · ${rows.filter(r=>r.safety).length} safety-related</div>`;
}

// ── Node CRUD ──────────────────────────────────────────────────────────────────
async function addNode(type, canvasX, canvasY) {
  const name = `${NODE_TYPES[type]?.label || 'Node'} ${_s.nodes.length + 1}`;
  const { data } = await sb.from('fmea_nodes').insert({
    project_id:  _ctx.project.id,
    parent_type: _ctx.parentType,
    parent_id:   _ctx.parentId,
    name, node_type: type,
    x: canvasX, y: canvasY,
  }).select().single();
  if (!data) return;
  _s.nodes.push(data);
  _s.selectedId   = data.id;
  _s.selectedType = 'node';
  log('Node added', name);
  renderAll();
  // Start inline rename immediately
  scheduleRename(data.id);
}

async function deleteNode(nodeId) {
  await sb.from('fmea_nodes').delete().eq('id', nodeId);
  _s.nodes  = _s.nodes.filter(n => n.id !== nodeId);
  _s.edges  = _s.edges.filter(e => e.source_id !== nodeId && e.target_id !== nodeId);
  delete _s.fms[nodeId];
  if (_s.selectedId === nodeId) _s.selectedId = null;
  if (_s.injected?.nodeId === nodeId) clearInjection();
  log('Node deleted', nodeId);
  renderAll();
}

function scheduleRename(nodeId) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.fb-node[data-id="${nodeId}"] span:nth-child(2)`);
    if (!el) return;
    const cur = _s.nodes.find(n => n.id === nodeId);
    if (!cur) return;
    const inp = document.createElement('input');
    inp.value = cur.name;
    inp.style.cssText = `background:transparent;border:none;border-bottom:1px solid ${C.accent};
      outline:none;color:${C.text};font-size:inherit;font-weight:inherit;width:100%;padding:0;`;
    el.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const name = inp.value.trim() || cur.name;
      cur.name = name;
      await sb.from('fmea_nodes').update({ name }).eq('id', nodeId);
      renderAll();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { done = true; renderAll(); }
    });
  });
}

// ── Wiring ─────────────────────────────────────────────────────────────────────
function wire() {
  const canvas = document.getElementById('fb-canvas');
  const svg    = document.getElementById('fb-svg');
  if (!canvas) return;

  // ── Pan ──
  let panStart = null;
  canvas.addEventListener('mousedown', e => {
    if (e.target.closest('.fb-node') || e.target.closest('.fb-conn-handle') || e.target.closest('.fb-edge-hit')) return;
    panStart = { mx: e.clientX, my: e.clientY, px: _s.pan.x, py: _s.pan.y };
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!panStart) return;
    _s.pan.x = panStart.px + (e.clientX - panStart.mx);
    _s.pan.y = panStart.py + (e.clientY - panStart.my);
    renderGraph();
  });
  window.addEventListener('mouseup', () => { panStart = null; canvas.style.cursor = 'default'; });

  // ── Zoom ──
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.92 : 1.08;
    _s.zoom = Math.max(0.25, Math.min(3, _s.zoom * f));
    renderGraph();
  }, { passive: false });

  // ── Double-click canvas → add node ──
  let pendingNodeType = null;
  document.getElementById('fb-root').addEventListener('click', e => {
    const btn = e.target.closest('.fb-add-node-btn');
    if (btn) {
      pendingNodeType = btn.dataset.type;
      canvas.style.cursor = 'crosshair';
      document.getElementById('fb-empty').querySelector('div:last-child').textContent = `Click on the canvas to place ${NODE_TYPES[pendingNodeType]?.label}`;
    }
  });

  canvas.addEventListener('click', async e => {
    if (e.target.closest('.fb-node') || e.target.closest('.fb-edge-hit') || _s.connecting) return;
    if (!pendingNodeType) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left - _s.pan.x) / _s.zoom - NODE_W / 2;
    const cy = (e.clientY - rect.top  - _s.pan.y) / _s.zoom - NODE_H / 2;
    const type = pendingNodeType;
    pendingNodeType = null;
    canvas.style.cursor = 'default';
    await addNode(type, cx, cy);
  });

  // ── Node drag + select ──
  const nodesG = document.getElementById('fb-nodes-g');
  nodesG.addEventListener('mousedown', e => {
    // Connection handle drag
    const handle = e.target.closest('.fb-conn-handle');
    if (handle) {
      e.stopPropagation();
      const fromId = handle.dataset.id;
      const fromNode = _s.nodes.find(n => n.id === fromId);
      if (!fromNode) return;
      const rect = canvas.getBoundingClientRect();
      _s.connecting = {
        fromId,
        curX: e.clientX - rect.left,
        curY: e.clientY - rect.top,
      };
      const dragG = document.getElementById('fb-drag-edge-g');

      const onMove = mv => {
        const cx = mv.clientX - rect.left;
        const cy = mv.clientY - rect.top;
        _s.connecting.curX = cx;
        _s.connecting.curY = cy;
        const sx = fromNode.x * _s.zoom + _s.pan.x + (NODE_W * _s.zoom);
        const sy = fromNode.y * _s.zoom + _s.pan.y + (NODE_H * _s.zoom) / 2;
        dragG.innerHTML = `<line x1="${sx}" y1="${sy}" x2="${cx}" y2="${cy}"
          stroke="${C.accent}" stroke-width="2" stroke-dasharray="6,3"
          marker-end="url(#fb-arrow-active)"/>`;
      };
      const onUp = async mv => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        dragG.innerHTML = '';
        const cx = mv.clientX - rect.left;
        const cy = mv.clientY - rect.top;
        // Find target node under cursor
        const targetEl = document.elementFromPoint(mv.clientX, mv.clientY)?.closest('.fb-node');
        const toId = targetEl?.dataset.id;
        _s.connecting = null;
        if (toId && toId !== fromId) {
          const exists = _s.edges.find(e => e.source_id === fromId && e.target_id === toId);
          if (!exists) {
            const { data } = await sb.from('fmea_edges').insert({
              project_id: _ctx.project.id,
              source_id: fromId, target_id: toId,
              edge_type: 'depends_on',
            }).select().single();
            if (data) {
              _s.edges.push(data);
              _s.selectedId   = data.id;
              _s.selectedType = 'edge';
              log('Edge created', `${fromNode.name} → ${_s.nodes.find(n=>n.id===toId)?.name}`);
            }
          }
        }
        renderAll();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    // Node drag + select
    const nodeEl = e.target.closest('.fb-node');
    if (!nodeEl) return;
    const id = nodeEl.dataset.id;
    _s.selectedId   = id;
    _s.selectedType = 'node';
    renderNodeList();
    renderProps();

    const node = _s.nodes.find(n => n.id === id);
    if (!node) return;
    const startX = e.clientX, startY = e.clientY;
    const origX = node.x, origY = node.y;
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
      if (moved) await sb.from('fmea_nodes').update({ x: node.x, y: node.y }).eq('id', node.id);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Show/hide connection handles on node hover
  nodesG.addEventListener('mouseover', e => {
    const nodeEl = e.target.closest('.fb-node');
    if (nodeEl) nodeEl.querySelector('.fb-conn-handle')?.style.setProperty('opacity','1');
  });
  nodesG.addEventListener('mouseout', e => {
    const nodeEl = e.target.closest('.fb-node');
    if (nodeEl) nodeEl.querySelector('.fb-conn-handle')?.style.setProperty('opacity','0');
  });

  // Double-click node → rename
  nodesG.addEventListener('dblclick', e => {
    const nodeEl = e.target.closest('.fb-node');
    if (nodeEl) scheduleRename(nodeEl.dataset.id);
  });

  // Edge click
  document.getElementById('fb-svg').addEventListener('click', e => {
    const hit = e.target.closest('.fb-edge-hit');
    if (!hit) return;
    _s.selectedId   = hit.dataset.eid;
    _s.selectedType = 'edge';
    renderProps();
  });

  // Left panel node list click
  document.getElementById('fb-node-list')?.addEventListener('click', e => {
    const item = e.target.closest('.fb-nl-item');
    if (!item) return;
    _s.selectedId   = item.dataset.id;
    _s.selectedType = 'node';
    renderAll();
  });

  // Delete key
  window.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (!_s.selectedId) return;
    if (_s.selectedType === 'node') deleteNode(_s.selectedId);
    else if (_s.selectedType === 'edge') {
      const edge = _s.edges.find(e => e.id === _s.selectedId);
      if (edge) { sb.from('fmea_edges').delete().eq('id', edge.id); _s.edges = _s.edges.filter(e2 => e2.id !== edge.id); _s.selectedId = null; renderAll(); }
    }
  });

  // Topbar buttons
  document.getElementById('fb-clear-btn')?.addEventListener('click', clearInjection);
  document.getElementById('fb-gen-btn')?.addEventListener('click', () => { generateTable(); switchTab('table'); });

  // Tabs
  document.querySelectorAll('.fb-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
}

function switchTab(tab) {
  _s.activeTab = tab;
  document.getElementById('fb-canvas').style.display     = tab === 'graph' ? '' : 'none';
  document.getElementById('fb-table-wrap').style.display = tab === 'table' ? '' : 'none';
  document.querySelectorAll('.fb-tab').forEach(b => {
    const a = b.dataset.tab === tab;
    b.style.cssText = tabS(a);
    b.classList.toggle('active', a);
  });
  if (tab === 'table') generateTable();
}

// ── Log ────────────────────────────────────────────────────────────────────────
function log(title, detail) {
  // Minimal console log — no bottom panel in this prototype
  console.log(`[FMEA Beta] ${title}${detail ? ' — ' + detail : ''}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function btnS(bg) {
  return `background:${bg};border:1px solid ${C.border};border-radius:5px;color:${C.text};font-size:12px;font-weight:600;padding:6px 10px;cursor:pointer;`;
}
function tabS(active) {
  return `background:transparent;border:none;border-bottom:2px solid ${active?C.accent:'transparent'};color:${active?C.accent:C.textMuted};font-size:12px;font-weight:${active?'700':'500'};padding:0 14px;height:38px;cursor:pointer;`;
}
function sectionHeader() {
  return `padding:10px 14px 6px;font-size:10px;font-weight:700;letter-spacing:1.5px;color:${C.textMuted};text-transform:uppercase;`;
}
function sectionLabel() {
  return `font-size:10px;font-weight:700;letter-spacing:1px;color:${C.textMuted};text-transform:uppercase;margin-bottom:6px;`;
}
function pill(text, color) {
  return `<span style="background:${color}22;border:1px solid ${color}55;color:${color};padding:2px 7px;border-radius:3px;font-size:10px;font-weight:600;">${text}</span>`;
}
