// NEW FMEA Beta v2
// Nodes   = arch_functions (grouped by arch_components)
// Edges   = fmea_function_edges (functional dependencies)
// FMs     = arch_function_fms (reused)
// Rules   = fmea_propagation_rules (auto-inferred, editable)
// Config  = fmea_node_config (canvas pos + cut mechanisms)

import { sb } from '../../config.js';

// ── Light palette ──────────────────────────────────────────────────────────────
const C = {
  bg:          '#f5f6fa',
  canvas:      '#ffffff',
  surface:     '#ffffff',
  surface2:    '#f0f2f8',
  border:      '#dde1f0',
  borderHov:   '#9099c8',
  text:        '#1a1f3a',
  textMuted:   '#5a6490',
  textDim:     '#9aa3c8',
  primary:     '#4f5fc4',
  primaryLight:'#eef0fb',
  accent:      '#0090d4',
  accentLight: '#e6f4fc',
  green:       '#1a8f5c',
  greenLight:  '#e6f6ee',
  orange:      '#c45f00',
  orangeLight: '#fff3e6',
  red:         '#c4002a',
  redLight:    '#fde8ed',
  yellow:      '#9a7400',
  yellowLight: '#fffbe6',
  purple:      '#7c3dc4',
  purpleLight: '#f3ecfb',
  shadow:      '0 2px 8px rgba(79,95,196,.10)',
  shadowHov:   '0 4px 16px rgba(79,95,196,.18)',
};

// ── Constants ──────────────────────────────────────────────────────────────────
const EDGE_TYPES = {
  depends_on:        { label: 'Depends on',    dash: '',        color: C.primary },
  controls:          { label: 'Controls',      dash: '',        color: C.orange  },
  monitors:          { label: 'Monitors',      dash: '6,3',     color: C.green   },
  powers:            { label: 'Powers',        dash: '',        color: C.yellow  },
  communicates_with: { label: 'Communicates',  dash: '3,3',     color: C.purple  },
  triggers:          { label: 'Triggers',      dash: '8,2,2,2', color: C.accent  },
};

// Inference table: FM keyword × edge_type → effect template
const INFER = {
  missing: {
    depends_on:        'Missing input → function cannot execute',
    controls:          'Loss of control signal → uncontrolled behavior',
    monitors:          'Loss of monitoring → fault goes undetected',
    powers:            'Loss of power → function unavailable',
    communicates_with: 'Communication loss → missing data at receiver',
    triggers:          'Missing trigger → function not activated',
  },
  incorrect: {
    depends_on:        'Incorrect input → incorrect output produced',
    controls:          'Incorrect control → erroneous behavior',
    monitors:          'Incorrect monitoring → wrong diagnostic result',
    powers:            'Incorrect voltage/current → degraded operation',
    communicates_with: 'Corrupted data → incorrect processing at receiver',
    triggers:          'Incorrect trigger → wrong activation sequence',
  },
  delayed: {
    depends_on:        'Delayed input → delayed output',
    controls:          'Delayed control → late system response',
    monitors:          'Delayed monitoring → late fault detection',
    powers:            'Power delay → startup failure',
    communicates_with: 'Communication delay → timing violation',
    triggers:          'Delayed trigger → late activation',
  },
  intermittent: {
    depends_on:        'Intermittent input → sporadic failure of function',
    controls:          'Intermittent control → unstable behavior',
    monitors:          'Intermittent monitoring → unreliable diagnostics',
    powers:            'Intermittent power → repeated restarts',
    communicates_with: 'Intermittent communication → sporadic data loss',
    triggers:          'Intermittent trigger → sporadic activation failures',
  },
  unstable: {
    depends_on:        'Unstable input → unstable output',
    controls:          'Unstable control → oscillation or instability',
    monitors:          'Unstable monitoring → fluctuating diagnostics',
    powers:            'Unstable power → erratic operation',
    communicates_with: 'Unstable communication → intermittent data errors',
    triggers:          'Unstable trigger → repeated unintended activations',
  },
};

function inferEffect(fmText, edgeType) {
  const fm = (fmText || '').toLowerCase();
  const key = fm.includes('miss') || fm.includes('absent') || fm.includes('loss') ? 'missing'
    : fm.includes('incorrect') || fm.includes('wrong') || fm.includes('erron') ? 'incorrect'
    : fm.includes('delay') || fm.includes('late') || fm.includes('slow') ? 'delayed'
    : fm.includes('intermit') || fm.includes('sporadic') ? 'intermittent'
    : fm.includes('unstable') || fm.includes('oscillat') ? 'unstable'
    : 'incorrect';
  return (INFER[key] || INFER.incorrect)[edgeType] || 'Failure propagated to dependent function';
}

// ── Layout constants ───────────────────────────────────────────────────────────
const FN_W  = 152;
const FN_H  = 68;
const COMP_PAD = 14;
const COMP_HEADER = 28;
const COL_W = 220;
const ROW_H = 100;

// ── State ──────────────────────────────────────────────────────────────────────
let _ctx = null;
let _s = {
  comps:      [],   // arch_components
  fns:        [],   // arch_functions enriched with _fms, _cfg
  edges:      [],   // fmea_function_edges enriched with _rules
  cfgMap:     {},   // fnId → fmea_node_config row
  selectedId: null,
  selType:    null, // 'fn' | 'edge'
  pan:        { x: 40, y: 40 },
  zoom:       1,
  connecting: null,
  injected:   null,   // { fnId, fmId }
  propagated: {},     // fnId → { level, cut, cutReason, path, effects }
  activeTab:  'graph',
};

// ── Entry ──────────────────────────────────────────────────────────────────────
export async function renderFmeaBeta(container, ctx) {
  _ctx = ctx;
  const { item, system } = ctx;
  const scope = system ? `${item?.name || ''} › ${system.name}` : (item?.name || '');

  container.innerHTML = `
    <div id="fb-root" style="display:flex;flex-direction:column;height:100%;
      background:${C.bg};color:${C.text};font-family:'Inter',system-ui,sans-serif;overflow:hidden;
      font-size:13px;">
      ${buildTopbar(scope)}
      <div style="display:flex;flex:1;overflow:hidden;">
        ${buildLeft()}
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          ${buildTabBar()}
          <div id="fb-center" style="flex:1;position:relative;overflow:hidden;">
            ${buildCanvas()}
            ${buildTableWrap()}
          </div>
        </div>
        ${buildRight()}
      </div>
    </div>`;

  await loadData();
  autoLayout();
  wire();
  renderAll();
}

// ── Load ───────────────────────────────────────────────────────────────────────
async function loadData() {
  const { parentType, parentId, project } = _ctx;

  const [cRes, fmRes, cfgRes, edgeRes, ruleRes] = await Promise.all([
    sb.from('arch_components').select('*').eq('parent_type', parentType).eq('parent_id', parentId).order('sort_order'),
    sb.from('arch_function_fms').select('*').eq('project_id', project.id),
    sb.from('fmea_node_config').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('fmea_function_edges').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('fmea_propagation_rules').select('*'),
  ]);

  _s.comps = cRes.data || [];
  const compIds = _s.comps.map(c => c.id);

  let allFns = [];
  if (compIds.length) {
    const { data } = await sb.from('arch_functions').select('*').in('component_id', compIds).order('sort_order');
    allFns = data || [];
  }

  // Build maps
  const fmsByFn = {};
  (fmRes.data || []).forEach(fm => { (fmsByFn[fm.function_id] ||= []).push(fm); });

  _s.cfgMap = {};
  (cfgRes.data || []).forEach(c => { _s.cfgMap[c.fn_id] = c; });

  const rulesByEdge = {};
  (ruleRes.data || []).forEach(r => { (rulesByEdge[r.edge_id] ||= []).push(r); });

  _s.fns = allFns.map(f => ({
    ...f,
    _fms: fmsByFn[f.id] || [],
    _cfg: _s.cfgMap[f.id] || null,
  }));

  const fnIds = new Set(_s.fns.map(f => f.id));
  _s.edges = (edgeRes.data || [])
    .filter(e => fnIds.has(e.source_fn_id) && fnIds.has(e.target_fn_id))
    .map(e => ({ ...e, _rules: rulesByEdge[e.id] || [] }));

  _s.injected   = null;
  _s.propagated = {};
}

// ── Auto-layout: arrange fns inside component boxes ───────────────────────────
function autoLayout() {
  // Only position fns that have no saved config yet
  const needsPos = _s.fns.filter(f => !_s.cfgMap[f.id]);
  if (!needsPos.length) return;

  // Group by component
  const byComp = {};
  _s.comps.forEach(c => { byComp[c.id] = []; });
  _s.fns.forEach(f => { (byComp[f.component_id] ||= []).push(f); });

  let cx = COMP_PAD, cy = COMP_PAD;
  const colLimit = 4;
  let col = 0;

  _s.comps.forEach(comp => {
    const fns = byComp[comp.id] || [];
    const cols = Math.min(fns.length, 2);
    const rows = Math.ceil(fns.length / cols);
    const boxW = COMP_PAD * 2 + cols * FN_W + (cols - 1) * 12;
    const boxH = COMP_HEADER + COMP_PAD + rows * FN_H + (rows - 1) * 10 + COMP_PAD;

    comp._bx = cx;
    comp._by = cy;
    comp._bw = Math.max(boxW, 160);
    comp._bh = Math.max(boxH, 80);

    fns.forEach((fn, i) => {
      const col2 = i % cols;
      const row  = Math.floor(i / cols);
      fn._x = cx + COMP_PAD + col2 * (FN_W + 12);
      fn._y = cy + COMP_HEADER + COMP_PAD + row * (FN_H + 10);
    });

    col++;
    if (col >= colLimit) {
      col = 0;
      cx  = COMP_PAD;
      cy += comp._bh + 32;
    } else {
      cx += comp._bw + 32;
    }
  });
}

function fnPos(fn) {
  const cfg = _s.cfgMap[fn.id];
  return cfg ? { x: cfg.x, y: cfg.y } : { x: fn._x || 0, y: fn._y || 0 };
}

// ── HTML builders ──────────────────────────────────────────────────────────────
function buildTopbar(scope) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:0 16px;height:46px;
    flex-shrink:0;background:${C.surface};border-bottom:1px solid ${C.border};box-shadow:0 1px 4px rgba(0,0,0,.06);">
    <span style="font-size:12px;font-weight:800;letter-spacing:2px;color:${C.primary};text-transform:uppercase;">NEW FMEA</span>
    <span style="color:${C.border};font-size:16px;">|</span>
    <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:${C.textDim};text-transform:uppercase;">Beta</span>
    <span style="flex:1;"></span>
    <span style="font-size:12px;color:${C.textMuted};">${escH(scope)}</span>
    <span id="fb-prop-status" style="font-size:11px;color:${C.orange};font-weight:600;"></span>
    <button id="fb-clear-btn" style="${btnS('white',C.border)};display:none;color:${C.textMuted};">✕ Clear injection</button>
    <button id="fb-gen-btn"   style="${btnS(C.primary,'transparent')};color:white;">⚡ Generate DFMEA</button>
  </div>`;
}

function buildLeft() {
  return `<div style="width:220px;flex-shrink:0;background:${C.surface};border-right:1px solid ${C.border};
    display:flex;flex-direction:column;overflow:hidden;">
    <div style="${secHead()}">System Explorer</div>
    <div id="fb-fn-list" style="flex:1;overflow-y:auto;padding:4px 6px 8px;"></div>
    <div style="border-top:1px solid ${C.border};padding:10px 12px;">
      <div style="${secHead()};padding:0 0 8px;">Inject Failure Mode</div>
      <div style="font-size:11px;color:${C.textDim};line-height:1.6;">
        1. Click a function node<br>
        2. Click a failure mode below its panel<br>
        3. View propagation on graph
      </div>
    </div>
  </div>`;
}

function buildTabBar() {
  return `<div style="display:flex;align-items:center;background:${C.surface};
    border-bottom:1px solid ${C.border};padding:0 16px;height:38px;flex-shrink:0;">
    <button class="fb-tab active" data-tab="graph" style="${tabS(true)}">⬡ Graph</button>
    <button class="fb-tab" data-tab="table" style="${tabS(false)}">⊞ DFMEA Table</button>
    <span style="flex:1;"></span>
    <span style="font-size:11px;color:${C.textDim};">Drag ● on node edge to connect · Click edge to configure · Delete key removes selection</span>
  </div>`;
}

function buildCanvas() {
  return `<div id="fb-canvas" style="position:absolute;inset:0;
    background:${C.canvas};
    background-image:radial-gradient(${C.border} 1px,transparent 1px);
    background-size:24px 24px;overflow:hidden;cursor:default;">
    <svg id="fb-svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
      <defs>
        ${Object.entries(EDGE_TYPES).map(([k,v]) => `
          <marker id="arr-${k}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="${v.color}"/>
          </marker>
          <marker id="arr-${k}-prop" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill="${C.red}"/>
          </marker>`).join('')}
        <marker id="arr-drag" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0,8 3,0 6" fill="${C.accent}"/>
        </marker>
        <filter id="fb-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${C.primary}" flood-opacity=".12"/>
        </filter>
        <filter id="fb-glow-red" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="fb-comp-boxes-g"></g>
      <g id="fb-edges-g"></g>
      <g id="fb-drag-edge-g"></g>
    </svg>
    <div id="fb-nodes-g" style="position:absolute;inset:0;pointer-events:none;"></div>
    <div id="fb-empty" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:10px;
      color:${C.textDim};font-size:13px;pointer-events:none;">
      <div style="font-size:40px;opacity:.25;">⬡</div>
      <div style="font-weight:600;">No functions found in this scope.</div>
      <div style="font-size:11px;">Add components and functions in Architecture Specification first.</div>
    </div>
  </div>`;
}

function buildTableWrap() {
  return `<div id="fb-table-wrap" style="position:absolute;inset:0;display:none;
    background:${C.bg};overflow:auto;padding:20px 24px;">
    <div id="fb-table-inner"></div>
  </div>`;
}

function buildRight() {
  return `<div style="width:288px;flex-shrink:0;background:${C.surface};
    border-left:1px solid ${C.border};display:flex;flex-direction:column;overflow:hidden;">
    <div style="${secHead()}">Properties</div>
    <div id="fb-props" style="flex:1;overflow-y:auto;padding:12px 14px;">
      ${emptyProps()}
    </div>
  </div>`;
}

function emptyProps() {
  return `<div style="color:${C.textDim};font-size:12px;padding-top:8px;line-height:1.9;">
    Select a node or edge.<br>
    <span style="font-size:11px;">
      • Click node → inspect / add FMs / inject<br>
      • Drag ● handle → connect functions<br>
      • Click edge → configure type + rules<br>
      • Delete → remove selection
    </span></div>`;
}

// ── Render all ─────────────────────────────────────────────────────────────────
function renderAll() {
  renderFnList();
  renderGraph();
  renderProps();
}

// ── Left panel fn list ─────────────────────────────────────────────────────────
function renderFnList() {
  const el = document.getElementById('fb-fn-list');
  if (!el) return;
  if (!_s.fns.length) { el.innerHTML = `<div style="padding:8px;color:${C.textDim};font-size:11px;">No functions found.</div>`; return; }

  const byComp = {};
  _s.comps.forEach(c => { byComp[c.id] = { comp: c, fns: [] }; });
  _s.fns.forEach(f => { (byComp[f.component_id] ||= { comp: null, fns: [] }).fns.push(f); });

  el.innerHTML = Object.values(byComp).filter(g => g.fns.length).map(({ comp, fns }) => {
    const fnRows = fns.map(fn => {
      const prop  = _s.propagated[fn.id];
      const isInj = _s.injected?.fnId === fn.id;
      const isSel = _s.selectedId === fn.id && _s.selType === 'fn';
      const dotC  = isInj ? C.orange : prop?.cut ? C.green : prop?.level === 3 ? C.red : prop?.level >= 1 ? C.orange : C.textDim;
      return `<div class="fb-fn-item" data-id="${fn.id}" style="
        display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;
        cursor:pointer;margin-bottom:1px;font-size:11px;
        background:${isSel ? C.primaryLight : 'transparent'};
        color:${isSel ? C.primary : C.text};">
        <span style="width:7px;height:7px;border-radius:50%;background:${dotC};flex-shrink:0;"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(fn.name)}</span>
        ${fn._fms.length ? `<span style="font-size:10px;color:${C.textDim};">⚠${fn._fms.length}</span>` : ''}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:6px;">
      <div style="font-size:10px;font-weight:700;color:${C.textMuted};text-transform:uppercase;
        letter-spacing:.8px;padding:4px 8px 2px;">${escH(comp?.name || '?')}</div>
      ${fnRows}
    </div>`;
  }).join('');
}

// ── Graph ──────────────────────────────────────────────────────────────────────
function renderGraph() {
  const nodesG   = document.getElementById('fb-nodes-g');
  const edgesG   = document.getElementById('fb-edges-g');
  const compBoxG = document.getElementById('fb-comp-boxes-g');
  const empty    = document.getElementById('fb-empty');
  if (!nodesG) return;

  empty.style.display = _s.fns.length ? 'none' : 'flex';
  edgesG.innerHTML = '';
  compBoxG.innerHTML = '';
  nodesG.innerHTML = '';

  const { x: px, y: py } = _s.pan;
  const z = _s.zoom;

  // ── Component bounding boxes ──
  const byComp = {};
  _s.comps.forEach(c => { byComp[c.id] = { comp: c, fns: [] }; });
  _s.fns.forEach(f => {
    const pos = fnPos(f);
    (byComp[f.component_id] ||= { comp: null, fns: [] }).fns.push({ f, pos });
  });

  Object.values(byComp).forEach(({ comp, fns }) => {
    if (!fns.length || !comp) return;
    const xs = fns.map(({ pos }) => pos.x);
    const ys = fns.map(({ pos }) => pos.y);
    const minX = Math.min(...xs) - COMP_PAD;
    const minY = Math.min(...ys) - COMP_HEADER - 4;
    const maxX = Math.max(...xs) + FN_W + COMP_PAD;
    const maxY = Math.max(...ys) + FN_H + COMP_PAD;

    const bx = minX * z + px;
    const by = minY * z + py;
    const bw = (maxX - minX) * z;
    const bh = (maxY - minY) * z;
    const isInj = fns.some(({ f }) => _s.injected?.fnId === f.id);
    const hasProp = fns.some(({ f }) => _s.propagated[f.id]);
    const hasCrit = fns.some(({ f }) => _s.propagated[f.id]?.level === 3);

    const stroke = hasCrit ? C.red : hasProp ? C.orange : isInj ? C.orange : C.border;
    const fill   = hasCrit ? '#fff8f9' : hasProp ? '#fffaf5' : '#fafbff';

    compBoxG.innerHTML += `
      <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${8*z}"
        fill="${fill}" stroke="${stroke}" stroke-width="${hasProp||hasCrit?1.5:1}" opacity=".9"/>
      <text x="${bx + 10*z}" y="${by + 18*z}" font-size="${Math.max(9,11*z)}"
        font-family="Inter,sans-serif" font-weight="700" fill="${C.textMuted}"
        text-transform="uppercase" letter-spacing="1">${escH(comp.name.toUpperCase())}</text>`;
  });

  // ── Edges ──
  _s.edges.forEach(e => {
    const srcFn = _s.fns.find(f => f.id === e.source_fn_id);
    const tgtFn = _s.fns.find(f => f.id === e.target_fn_id);
    if (!srcFn || !tgtFn) return;

    const sp = fnPos(srcFn);
    const tp = fnPos(tgtFn);

    const sx = (sp.x + FN_W) * z + px;
    const sy = (sp.y + FN_H / 2) * z + py;
    const tx = tp.x * z + px;
    const ty = (tp.y + FN_H / 2) * z + py;

    const prop    = _s.propagated[tgtFn.id];
    const propSrc = _s.propagated[srcFn.id] || _s.injected?.fnId === srcFn.id;
    const isActive = !!(propSrc && prop);
    const isCut    = prop?.cut && isActive;
    const isCrit   = prop?.level === 3 && isActive;
    const isSel    = _s.selectedId === e.id && _s.selType === 'edge';

    const et     = EDGE_TYPES[e.edge_type] || EDGE_TYPES.depends_on;
    const color  = isCrit ? C.red : isCut ? C.green : isActive ? C.orange : isSel ? C.primary : et.color;
    const marker = `arr-${isCrit||isActive ? e.edge_type+'-prop' : e.edge_type}`;
    const dash   = isCut ? '5,4' : et.dash;
    const width  = isActive || isSel ? 2.5 : 1.5;
    const filter = isCrit ? 'filter="url(#fb-glow-red)"' : '';

    const cx1 = sx + Math.abs(tx - sx) * 0.45;
    const cx2 = tx - Math.abs(tx - sx) * 0.45;
    const mx  = (sx + tx) / 2;
    const my  = (sy + ty) / 2 - 10;

    edgesG.innerHTML += `
      <g class="fb-edge-g" data-eid="${e.id}" style="pointer-events:stroke;cursor:pointer;">
        <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
          stroke="transparent" stroke-width="14" fill="none" pointer-events="stroke"/>
        <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
          stroke="${color}" stroke-width="${width}" fill="none"
          ${dash ? `stroke-dasharray="${dash}"` : ''} ${filter}
          marker-end="url(#${marker})"
          style="${isActive && !isCut ? 'animation:fmea-pulse 1.4s ease-in-out infinite;' : ''}"/>
        ${e.label || isSel || (isActive && !isCut) ? `
          <rect x="${mx - 30}" y="${my - 9}" width="60" height="16" rx="3"
            fill="${C.surface}" stroke="${color}" stroke-width="1" opacity=".95"/>
          <text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="9"
            font-family="Inter,sans-serif" fill="${color}" font-weight="600">
            ${isCut ? '✓ Cut' : escH(e.label || et.label)}
          </text>` : ''}
        ${e.diagnostic_coverage > 0 ? `
          <text x="${mx}" y="${my + 18}" text-anchor="middle" font-size="9"
            font-family="Inter,sans-serif" fill="${C.green}">
            Diag ${e.diagnostic_coverage}%
          </text>` : ''}
      </g>`;
  });

  // ── Function nodes ──
  _s.fns.forEach(fn => {
    const pos   = fnPos(fn);
    const prop  = _s.propagated[fn.id];
    const isInj = _s.injected?.fnId === fn.id;
    const isSel = _s.selectedId === fn.id && _s.selType === 'fn';

    const nx = pos.x * z + px;
    const ny = pos.y * z + py;
    const nw = FN_W * z;
    const nh = FN_H * z;

    let borderColor = isSel ? C.primary : C.border;
    let bgColor     = C.surface;
    let glow        = '';
    let topBar      = '';

    if (prop?.cut) {
      borderColor = C.green;
      bgColor     = C.greenLight;
      topBar      = C.green;
    } else if (isInj) {
      borderColor = C.orange;
      bgColor     = C.orangeLight;
      topBar      = C.orange;
    } else if (prop?.level === 3) {
      borderColor = C.red;
      bgColor     = C.redLight;
      topBar      = C.red;
      glow        = `filter:url(#fb-glow-red);`;
    } else if (prop?.level === 2) {
      borderColor = C.orange;
      bgColor     = C.orangeLight;
      topBar      = C.orange;
    } else if (prop?.level === 1) {
      borderColor = C.yellow;
      bgColor     = C.yellowLight;
      topBar      = C.yellow;
    } else if (isSel) {
      bgColor = C.primaryLight;
    }

    const cfg      = _s.cfgMap[fn.id];
    const hasCuts  = cfg && (cfg.has_redundancy || cfg.has_safe_state || cfg.fault_tolerance !== 'none');
    const fmCount  = fn._fms.length;
    const safetyDot = fn.is_safety_related ? `<span style="color:${C.red};font-size:9px;margin-left:2px;" title="Safety related">FS</span>` : '';

    const statusLabel = prop?.cut
      ? `<div style="font-size:9px;color:${C.green};font-weight:600;">✓ ${escH(prop.cutReason)}</div>`
      : isInj && _s.injected?.fmId
        ? `<div style="font-size:9px;color:${C.orange};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚡ ${escH(fn._fms.find(f=>f.id===_s.injected.fmId)?.failure_mode||'')}</div>`
        : prop?.level === 3 ? `<div style="font-size:9px;color:${C.red};font-weight:600;">⚠ Critical effect</div>`
        : prop?.level === 2 ? `<div style="font-size:9px;color:${C.orange};font-weight:600;">⚡ Propagated</div>`
        : prop?.level === 1 ? `<div style="font-size:9px;color:${C.yellow};font-weight:600;">→ Local effect</div>`
        : fmCount ? `<div style="font-size:9px;color:${C.textDim};">⚠ ${fmCount} FM${fmCount!==1?'s':''}</div>` : '';

    const el = document.createElement('div');
    el.className   = 'fb-fn-node';
    el.dataset.id  = fn.id;
    el.style.cssText = `
      position:absolute;left:${nx}px;top:${ny}px;width:${nw}px;height:${nh}px;
      background:${bgColor};border:1.5px solid ${borderColor};border-radius:${6*z}px;
      box-sizing:border-box;cursor:pointer;pointer-events:all;
      box-shadow:${isSel ? C.shadowHov : C.shadow};${glow}
      display:flex;flex-direction:column;user-select:none;overflow:hidden;
      transition:box-shadow .15s,border-color .2s;`;

    el.innerHTML = `
      ${topBar ? `<div style="height:${3*z}px;background:${topBar};flex-shrink:0;"></div>` : ''}
      <div style="flex:1;padding:${6*z}px ${8*z}px;display:flex;flex-direction:column;gap:${2*z}px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:4px;overflow:hidden;">
          <span style="font-size:${Math.max(11,12*z)}px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:${C.text};">${escH(fn.name)}</span>
          ${safetyDot}
          ${hasCuts ? `<span style="font-size:9px;color:${C.green};" title="Has cut mechanism">✓</span>` : ''}
        </div>
        ${statusLabel}
      </div>
      <div class="fb-conn-handle" data-id="${fn.id}" style="
        position:absolute;right:-6px;top:50%;transform:translateY(-50%);
        width:12px;height:12px;border-radius:50%;
        background:${C.accent};border:2px solid white;
        cursor:crosshair;pointer-events:all;opacity:0;transition:opacity .15s;
        box-shadow:0 1px 4px rgba(0,0,0,.2);"></div>`;

    nodesG.appendChild(el);
  });
}

// ── Props panel ────────────────────────────────────────────────────────────────
function renderProps() {
  const el = document.getElementById('fb-props');
  if (!el) return;
  if (!_s.selectedId) { el.innerHTML = emptyProps(); return; }
  if (_s.selType === 'fn') renderFnProps();
  else renderEdgeProps();
}

function renderFnProps() {
  const el = document.getElementById('fb-props');
  const fn = _s.fns.find(f => f.id === _s.selectedId);
  if (!el || !fn) return;
  const cfg  = _s.cfgMap[fn.id];
  const prop = _s.propagated[fn.id];
  const isInj = _s.injected?.fnId === fn.id;

  const badge = isInj ? pill('⚡ INJECTION', C.orange)
    : prop?.cut ? pill('✓ ' + prop.cutReason, C.green)
    : prop?.level === 3 ? pill('⚠ CRITICAL', C.red)
    : prop?.level === 2 ? pill('⚡ PROPAGATED', C.orange)
    : prop?.level === 1 ? pill('→ LOCAL EFFECT', C.yellow)
    : '';

  const fmRows = fn._fms.map(fm => `
    <div style="padding:6px 8px;border-radius:5px;background:${C.surface2};border:1px solid ${C.border};margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:${C.red};font-size:11px;">⚠</span>
        <span style="font-size:12px;flex:1;">${escH(fm.failure_mode)}</span>
        <button class="fb-inject-btn" data-fnid="${fn.id}" data-fmid="${fm.id}"
          style="${btnS(C.primaryLight,C.primary)};color:${C.primary};font-size:10px;padding:3px 8px;">
          ⚡ Inject
        </button>
      </div>
      ${fm.local_effect ? `<div style="font-size:11px;color:${C.textMuted};margin-top:3px;margin-left:17px;">${escH(fm.local_effect)}</div>` : ''}
    </div>`).join('');

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">
    <div>
      <div style="font-size:14px;font-weight:700;margin-bottom:5px;">${escH(fn.name)}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        ${fn.is_safety_related ? pill('Safety Related', C.red) : ''}
        ${badge}
      </div>
    </div>

    <div>
      <div style="${secLabel()}">Failure Modes</div>
      ${fmRows || `<div style="font-size:11px;color:${C.textDim};margin-bottom:6px;">No FMs — add them in Architecture Specification.</div>`}
    </div>

    <div style="border-top:1px solid ${C.border};padding-top:10px;">
      <div style="${secLabel()}">Cut Mechanisms</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="fb-redundancy" ${cfg?.has_redundancy?'checked':''} style="accent-color:${C.green};">
          <span>Redundancy</span>
        </label>
        ${cfg?.has_redundancy ? `<input id="fb-redundancy-desc" value="${escH(cfg.redundancy_desc||'')}" placeholder="e.g. dual channel sensor…"
          style="${inpS()};margin-left:24px;">` : ''}
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
          <input type="checkbox" id="fb-safestate" ${cfg?.has_safe_state?'checked':''} style="accent-color:${C.green};">
          <span>Safe state</span>
        </label>
        ${cfg?.has_safe_state ? `<input id="fb-safestate-desc" value="${escH(cfg.safe_state_desc||'')}" placeholder="e.g. motor stops, default value…"
          style="${inpS()};margin-left:24px;">` : ''}
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="font-size:12px;">Fault tolerance</label>
          <select id="fb-ft-sel" style="background:${C.surface2};border:1px solid ${C.border};border-radius:4px;
            color:${C.text};font-size:12px;padding:3px 6px;cursor:pointer;">
            <option value="none"    ${(cfg?.fault_tolerance||'none')==='none'?'selected':''}>None</option>
            <option value="partial" ${cfg?.fault_tolerance==='partial'?'selected':''}>Partial</option>
            <option value="full"    ${cfg?.fault_tolerance==='full'?'selected':''}>Full</option>
          </select>
        </div>
      </div>
      <button id="fb-save-cfg" style="${btnS(C.primary,'transparent')};color:white;width:100%;margin-top:8px;font-size:11px;">Save cut config</button>
    </div>

    ${prop?.effects?.length ? `
      <div>
        <div style="${secLabel()}">Propagated Effects</div>
        ${prop.effects.map(e=>`<div style="font-size:11px;color:${C.textMuted};padding:3px 0;border-bottom:1px solid ${C.border};">→ ${escH(e)}</div>`).join('')}
      </div>` : ''}
  </div>`;

  // Wire cut config
  document.getElementById('fb-redundancy')?.addEventListener('change', () => renderFnProps());
  document.getElementById('fb-safestate')?.addEventListener('change',  () => renderFnProps());

  document.getElementById('fb-save-cfg')?.addEventListener('click', async () => {
    const hasRed = document.getElementById('fb-redundancy')?.checked || false;
    const hasSSt = document.getElementById('fb-safestate')?.checked  || false;
    const redDesc = document.getElementById('fb-redundancy-desc')?.value.trim() || null;
    const sstDesc = document.getElementById('fb-safestate-desc')?.value.trim()  || null;
    const ft      = document.getElementById('fb-ft-sel')?.value || 'none';
    const payload = {
      fn_id: fn.id, project_id: _ctx.project.id,
      parent_type: _ctx.parentType, parent_id: _ctx.parentId,
      has_redundancy: hasRed, redundancy_desc: redDesc,
      has_safe_state: hasSSt, safe_state_desc: sstDesc,
      fault_tolerance: ft,
      x: fnPos(fn).x, y: fnPos(fn).y,
    };
    const { data } = await sb.from('fmea_node_config')
      .upsert(payload, { onConflict: 'fn_id,parent_type,parent_id' })
      .select().single();
    if (data) { _s.cfgMap[fn.id] = data; fn._cfg = data; }
    renderAll();
  });

  el.querySelectorAll('.fb-inject-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); inject(btn.dataset.fnid, btn.dataset.fmid); });
  });
}

function renderEdgeProps() {
  const el   = document.getElementById('fb-props');
  const edge = _s.edges.find(e => e.id === _s.selectedId);
  if (!el || !edge) return;
  const srcFn = _s.fns.find(f => f.id === edge.source_fn_id);
  const tgtFn = _s.fns.find(f => f.id === edge.target_fn_id);
  const et    = EDGE_TYPES[edge.edge_type] || EDGE_TYPES.depends_on;
  const rules = edge._rules || [];
  const srcFms = srcFn?._fms || [];

  const rulesHtml = rules.map(r => {
    const fm = srcFms.find(f => f.id === r.source_fm_id);
    return `<div style="padding:6px 8px;border-radius:5px;background:${C.surface2};border:1px solid ${C.border};margin-bottom:4px;font-size:11px;">
      <div style="color:${C.orange};font-weight:600;">⚠ ${escH(fm?.failure_mode||'?')}</div>
      <div style="color:${C.textMuted};margin-top:2px;">→ ${escH(r.effect_at_target)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="color:${C.textDim};font-size:10px;">Severity ${r.severity}/10</span>
        ${r.is_inferred ? `<span style="color:${C.textDim};font-size:10px;">(inferred)</span>` : ''}
        <button class="fb-edit-rule" data-rid="${r.id}" style="${btnS(C.surface,'transparent')};border-color:${C.border};font-size:10px;padding:2px 6px;margin-left:auto;">Edit</button>
        <button class="fb-del-rule" data-rid="${r.id}" style="${btnS(C.surface,'transparent')};border-color:${C.border};font-size:10px;padding:2px 6px;color:${C.red};">✕</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
    <div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">Connection</div>
      <div style="font-size:12px;color:${C.textMuted};display:flex;align-items:center;gap:6px;">
        <span style="color:${C.text};font-weight:600;">${escH(srcFn?.name||'?')}</span>
        <span style="color:${et.color};">→</span>
        <span style="color:${C.text};font-weight:600;">${escH(tgtFn?.name||'?')}</span>
      </div>
    </div>

    <div>
      <div style="${secLabel()}">Edge type</div>
      <select id="fb-etype-sel" style="width:100%;${inpS()}">
        ${Object.entries(EDGE_TYPES).map(([k,v])=>`<option value="${k}" ${k===edge.edge_type?'selected':''}>${v.label}</option>`).join('')}
      </select>
    </div>

    <div>
      <div style="${secLabel()}">Signal / Interface label</div>
      <input id="fb-elabel" value="${escH(edge.label||'')}" placeholder="e.g. CAN signal, PWM, voltage…" style="width:100%;box-sizing:border-box;${inpS()}">
    </div>

    <div>
      <div style="${secLabel()}">Diagnostic coverage</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input id="fb-diag-cov" type="range" min="0" max="100" step="10"
          value="${edge.diagnostic_coverage||0}" style="flex:1;accent-color:${C.green};">
        <span id="fb-diag-cov-val" style="font-size:12px;font-weight:600;color:${edge.diagnostic_coverage>0?C.green:C.textMuted};min-width:36px;">${edge.diagnostic_coverage||0}%</span>
      </div>
      <input id="fb-diag-mech" value="${escH(edge.diagnostic_mechanism||'')}" placeholder="e.g. CRC, watchdog, E2E…" style="width:100%;box-sizing:border-box;${inpS()};margin-top:4px;">
    </div>
    <button id="fb-save-edge" style="${btnS(C.primary,'transparent')};color:white;width:100%;font-size:11px;">Save connection config</button>

    <div>
      <div style="${secLabel()}">Propagation Rules</div>
      ${rulesHtml || `<div style="font-size:11px;color:${C.textDim};margin-bottom:6px;">No rules. ${srcFms.length?'Click below to add.':'Add FMs to source node in Architecture Specification.'}</div>`}
      ${srcFms.length ? `<button id="fb-add-rule-btn" style="${btnS(C.surface2,C.border)};width:100%;font-size:11px;">＋ Add propagation rule</button>` : ''}
    </div>

    <button id="fb-del-edge-btn" style="${btnS('white',C.border)};color:${C.red};width:100%;font-size:11px;border-color:${C.red}44;">🗑 Delete connection</button>
  </div>`;

  // Diagnostic range live update
  document.getElementById('fb-diag-cov')?.addEventListener('input', e => {
    const v = e.target.value;
    const valEl = document.getElementById('fb-diag-cov-val');
    if (valEl) { valEl.textContent = v + '%'; valEl.style.color = v > 0 ? C.green : C.textMuted; }
  });

  document.getElementById('fb-save-edge')?.addEventListener('click', async () => {
    edge.edge_type            = document.getElementById('fb-etype-sel')?.value || edge.edge_type;
    edge.label                = document.getElementById('fb-elabel')?.value.trim() || null;
    edge.diagnostic_coverage  = parseInt(document.getElementById('fb-diag-cov')?.value) || 0;
    edge.diagnostic_mechanism = document.getElementById('fb-diag-mech')?.value.trim() || null;
    await sb.from('fmea_function_edges').update({
      edge_type: edge.edge_type, label: edge.label,
      diagnostic_coverage: edge.diagnostic_coverage,
      diagnostic_mechanism: edge.diagnostic_mechanism,
    }).eq('id', edge.id);
    renderAll();
  });

  document.getElementById('fb-add-rule-btn')?.addEventListener('click', () => showAddRuleForm(edge, srcFms));

  el.querySelectorAll('.fb-del-rule').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.dataset.rid;
      await sb.from('fmea_propagation_rules').delete().eq('id', rid);
      edge._rules = edge._rules.filter(r => r.id !== rid);
      renderEdgeProps();
    });
  });

  el.querySelectorAll('.fb-edit-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const rule = edge._rules.find(r => r.id === btn.dataset.rid);
      if (rule) showEditRuleForm(edge, srcFms, rule);
    });
  });

  document.getElementById('fb-del-edge-btn')?.addEventListener('click', async () => {
    await sb.from('fmea_function_edges').delete().eq('id', edge.id);
    _s.edges = _s.edges.filter(e => e.id !== edge.id);
    _s.selectedId = null;
    renderAll();
  });
}

// ── Rule forms ─────────────────────────────────────────────────────────────────
function showAddRuleForm(edge, srcFms) {
  const area = document.getElementById('fb-add-rule-btn');
  if (!area) return;
  area.outerHTML; // keep reference via selector below
  document.getElementById('fb-add-rule-btn').replaceWith(ruleFormEl(edge, srcFms, null));
  wireRuleForm(edge, srcFms, null);
}

function showEditRuleForm(edge, srcFms, rule) {
  const btn = document.querySelector(`.fb-edit-rule[data-rid="${rule.id}"]`);
  if (!btn) return;
  const row = btn.closest('div[style*="padding:6px"]');
  if (row) row.replaceWith(ruleFormEl(edge, srcFms, rule));
  wireRuleForm(edge, srcFms, rule);
}

function ruleFormEl(edge, srcFms, rule) {
  const el = document.createElement('div');
  el.id = 'fb-rule-form';
  el.style.cssText = `padding:8px;background:${C.surface2};border:1px solid ${C.border};border-radius:5px;margin-bottom:6px;`;
  el.innerHTML = `
    <select id="fb-rf-fm" style="width:100%;box-sizing:border-box;${inpS()};margin-bottom:4px;">
      <option value="">— Source failure mode —</option>
      ${srcFms.map(f=>`<option value="${f.id}" ${rule?.source_fm_id===f.id?'selected':''}>${escH(f.failure_mode)}</option>`).join('')}
    </select>
    <textarea id="fb-rf-eff" rows="2" placeholder="Effect at target node…"
      style="width:100%;box-sizing:border-box;${inpS()};resize:vertical;margin-bottom:4px;">${escH(rule?.effect_at_target||'')}</textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <label style="font-size:11px;color:${C.textMuted};">Severity</label>
      <input id="fb-rf-sev" type="number" min="1" max="10" value="${rule?.severity||5}"
        style="width:52px;${inpS()}">
      <span style="font-size:10px;color:${C.textDim};">/10</span>
    </div>
    <div style="display:flex;gap:4px;">
      <button id="fb-rf-save" style="${btnS(C.primary,'transparent')};color:white;flex:1;font-size:11px;">Save</button>
      <button id="fb-rf-cancel" style="${btnS('white',C.border)};font-size:11px;">Cancel</button>
    </div>`;
  return el;
}

function wireRuleForm(edge, srcFms, existingRule) {
  // auto-fill effect when FM selected
  document.getElementById('fb-rf-fm')?.addEventListener('change', e => {
    const fm   = srcFms.find(f => f.id === e.target.value);
    const eff  = document.getElementById('fb-rf-eff');
    if (eff && fm && (!eff.value.trim() || existingRule?.is_inferred !== false)) {
      eff.value = inferEffect(fm.failure_mode, edge.edge_type);
    }
  });

  document.getElementById('fb-rf-save')?.addEventListener('click', async () => {
    const fmId = document.getElementById('fb-rf-fm')?.value;
    const eff  = document.getElementById('fb-rf-eff')?.value.trim();
    const sev  = parseInt(document.getElementById('fb-rf-sev')?.value) || 5;
    if (!fmId || !eff) return;

    if (existingRule) {
      const { data } = await sb.from('fmea_propagation_rules')
        .update({ source_fm_id: fmId, effect_at_target: eff, severity: sev, is_inferred: false })
        .eq('id', existingRule.id).select().single();
      if (data) { const i = edge._rules.findIndex(r => r.id === existingRule.id); if (i>=0) edge._rules[i] = data; }
    } else {
      const { data } = await sb.from('fmea_propagation_rules')
        .insert({ edge_id: edge.id, source_fm_id: fmId, effect_at_target: eff, severity: sev, is_inferred: false })
        .select().single();
      if (data) edge._rules.push(data);
    }
    renderEdgeProps();
  });

  document.getElementById('fb-rf-cancel')?.addEventListener('click', renderEdgeProps);
}

// ── Propagation engine ─────────────────────────────────────────────────────────
function inject(fnId, fmId) {
  _s.injected   = { fnId, fmId };
  _s.propagated = {};

  const startFm = _s.fns.find(f => f.id === fnId)?._fms.find(f => f.id === fmId);
  const queue   = [{ id: fnId, level: 0, path: [fnId], effects: [] }];
  const visited = new Set([fnId]);
  _s.propagated[fnId] = { level: 0, path: [fnId], effects: [] };

  const activeFmIds = new Set([fmId]);

  while (queue.length) {
    const { id, level, path } = queue.shift();
    const srcFn = _s.fns.find(f => f.id === id);

    _s.edges.forEach(e => {
      if (e.source_fn_id !== id) return;
      const nextId = e.target_fn_id;
      if (visited.has(nextId)) return;

      // Check diagnostic cut
      if (e.diagnostic_coverage === 100) {
        // Full coverage — propagation stopped
        visited.add(nextId);
        _s.propagated[nextId] = { level: 0, cut: true, cutReason: 'Diagnostic 100%', path: [...path, nextId], effects: [] };
        return;
      }

      // Find semantic rules for active FMs on this edge
      const matchingRules = (e._rules || []).filter(r => activeFmIds.has(r.source_fm_id));

      // If no rules defined, generate inferred effect
      const effects = matchingRules.length
        ? matchingRules.map(r => r.effect_at_target)
        : startFm ? [inferEffect(startFm.failure_mode, e.edge_type)] : ['Failure propagated'];

      // Severity: max from rules, adjusted by diagnostic coverage
      let maxSev = matchingRules.length ? Math.max(...matchingRules.map(r => r.severity)) : 5;
      if (e.diagnostic_coverage > 0) maxSev = maxSev * (1 - e.diagnostic_coverage / 100);

      const tgtFn  = _s.fns.find(f => f.id === nextId);
      const tgtCfg = _s.cfgMap[nextId];

      // Check node-level cut mechanisms
      let cut = false; let cutReason = '';
      if (tgtCfg?.fault_tolerance === 'full') {
        cut = true; cutReason = 'Full fault tolerance';
      } else if (tgtCfg?.has_redundancy) {
        cut = true; cutReason = 'Redundancy';
      }

      if (cut) {
        visited.add(nextId);
        _s.propagated[nextId] = { level: 0, cut: true, cutReason, path: [...path, nextId], effects };
        return;
      }

      // Severity reduction for partial tolerance / safe state
      if (tgtCfg?.fault_tolerance === 'partial') maxSev *= 0.6;
      const cappedBySafeState = tgtCfg?.has_safe_state;

      const isCritical = !cappedBySafeState && (tgtFn?.is_safety_related || maxSev >= 8);
      const newLevel   = isCritical ? 3 : level + 1 >= 2 ? 2 : 1;
      const newPath    = [...path, nextId];

      visited.add(nextId);
      _s.propagated[nextId] = { level: newLevel, path: newPath, effects, cut: false };
      queue.push({ id: nextId, level: level + 1, path: newPath, effects });

      // Propagate FMs of target node onwards
      (tgtFn?._fms || []).forEach(f => activeFmIds.add(f.id));
    });
  }

  const affected  = Object.keys(_s.propagated).length - 1;
  const critical  = Object.values(_s.propagated).filter(p => p.level === 3).length;
  const cut       = Object.values(_s.propagated).filter(p => p.cut).length;
  const srcNode   = _s.fns.find(f => f.id === fnId);

  document.getElementById('fb-prop-status').textContent =
    `⚡ ${affected} affected${critical?` · ⚠ ${critical} critical`:''}${cut?` · ✓ ${cut} cut`:''}`;
  document.getElementById('fb-clear-btn').style.display = '';

  console.log(`[FMEA Beta] Inject: ${srcNode?.name} — "${startFm?.failure_mode}" → ${affected} nodes`);
  renderAll();
}

function clearInjection() {
  _s.injected   = null;
  _s.propagated = {};
  document.getElementById('fb-prop-status').textContent = '';
  document.getElementById('fb-clear-btn').style.display = 'none';
  renderAll();
}

// ── DFMEA table ────────────────────────────────────────────────────────────────
function generateTable() {
  const rows = [];
  _s.fns.forEach(fn => {
    fn._fms.forEach(fm => {
      const outEdges = _s.edges.filter(e => e.source_fn_id === fn.id);
      const rules    = outEdges.flatMap(e => (e._rules||[]).filter(r => r.source_fm_id === fm.id));
      const inferred = outEdges.length && !rules.length
        ? outEdges.map(e => inferEffect(fm.failure_mode, e.edge_type))
        : rules.map(r => r.effect_at_target);

      const nextFns  = [...new Set(outEdges.map(e => _s.fns.find(f=>f.id===e.target_fn_id)?.name).filter(Boolean))];
      const endFns   = outEdges.map(e => _s.fns.find(f=>f.id===e.target_fn_id)).filter(f=>f?.is_safety_related).map(f=>f.name);
      const cuts     = outEdges.filter(e => e.diagnostic_coverage === 100 || _s.cfgMap[e.target_fn_id]?.has_redundancy || _s.cfgMap[e.target_fn_id]?.fault_tolerance === 'full');
      const maxSev   = rules.length ? Math.max(...rules.map(r=>r.severity)) : outEdges.length ? 5 : null;
      const comp     = _s.comps.find(c => c.id === fn.component_id);

      rows.push({
        comp:      comp?.name || '—',
        fn:        fn.name,
        fm:        fm.failure_mode,
        localEff:  fm.local_effect || '—',
        effects:   inferred,
        nextHigher:nextFns.join(', ') || '—',
        endEffect: endFns.join(', ') || nextFns[0] || '—',
        severity:  maxSev,
        cutCount:  cuts.length,
        isInferred:!rules.length && outEdges.length > 0,
        safety:    fn.is_safety_related,
      });
    });
  });

  renderTable(rows);
}

function renderTable(rows) {
  const el = document.getElementById('fb-table-inner');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div style="color:${C.textDim};font-size:13px;padding:24px;">No failure modes found. Add FMs in Architecture Specification.</div>`;
    return;
  }

  const thS = `padding:10px 14px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.textMuted};border-bottom:2px solid ${C.border};white-space:nowrap;background:${C.surface};`;
  const tdS = (color='') => `padding:8px 14px;font-size:12px;border-bottom:1px solid ${C.border};vertical-align:top;${color?`color:${color};`:''}`;

  el.innerHTML = `
    <h3 style="font-size:15px;font-weight:700;margin:0 0 16px;color:${C.text};">DFMEA — Auto-generated</h3>
    <table style="width:100%;border-collapse:collapse;background:${C.surface};border-radius:8px;overflow:hidden;box-shadow:${C.shadow};">
      <thead><tr>
        <th style="${thS}">Component</th>
        <th style="${thS}">Function</th>
        <th style="${thS}">Failure Mode</th>
        <th style="${thS}">Local Effect</th>
        <th style="${thS}">Propagated Effects</th>
        <th style="${thS}">Next Higher</th>
        <th style="${thS}">End Effect</th>
        <th style="${thS}">Sev</th>
        <th style="${thS}">Mitigations</th>
      </tr></thead>
      <tbody>
        ${rows.map((r,i) => `<tr style="background:${i%2===0?C.surface:C.surface2};">
          <td style="${tdS()}">${escH(r.comp)}</td>
          <td style="${tdS()}">${escH(r.fn)}${r.safety?` <span style="color:${C.red};font-size:9px;font-weight:700;">FS</span>`:''}${r.isInferred?` <span style="font-size:9px;color:${C.textDim};" title="Effects inferred automatically">~</span>`:''}</td>
          <td style="${tdS(C.orange)};font-weight:600;">${escH(r.fm)}</td>
          <td style="${tdS(C.textMuted)}">${escH(r.localEff)}</td>
          <td style="${tdS()}">${r.effects.map(e=>`<div style="font-size:11px;color:${C.textMuted};">→ ${escH(e)}</div>`).join('')||'<span style="color:'+C.textDim+';">—</span>'}</td>
          <td style="${tdS(C.textMuted)}">${escH(r.nextHigher)}</td>
          <td style="${tdS(C.textMuted)}">${escH(r.endEffect)}</td>
          <td style="${tdS()};font-weight:700;color:${!r.severity?C.textDim:r.severity>=8?C.red:r.severity>=5?C.orange:C.green};">${r.severity||'—'}</td>
          <td style="${tdS()};color:${r.cutCount?C.green:C.textDim};">${r.cutCount?`✓ ${r.cutCount} mechanism${r.cutCount>1?'s':''}` : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px;font-size:11px;color:${C.textDim};">
      ${rows.length} rows · ${rows.filter(r=>r.safety).length} safety-related ·
      ${rows.filter(r=>r.isInferred).length} with inferred effects (marked ~) ·
      ${rows.filter(r=>r.cutCount>0).length} with mitigations
    </div>`;
}

// ── Wiring ─────────────────────────────────────────────────────────────────────
function wire() {
  const canvas = document.getElementById('fb-canvas');
  const svg    = document.getElementById('fb-svg');
  const nodesG = document.getElementById('fb-nodes-g');
  if (!canvas) return;

  // Pan
  let panStart = null;
  canvas.addEventListener('mousedown', e => {
    if (e.target.closest('.fb-fn-node') || e.target.closest('.fb-conn-handle') || e.target.closest('.fb-edge-g')) return;
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

  // Zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    _s.zoom = Math.max(0.25, Math.min(3, _s.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    renderGraph();
  }, { passive: false });

  // Node interaction
  nodesG.addEventListener('mousedown', e => {
    // Connection handle drag
    const handle = e.target.closest('.fb-conn-handle');
    if (handle) {
      e.stopPropagation();
      const fromId = handle.dataset.id;
      const fromFn = _s.fns.find(f => f.id === fromId);
      if (!fromFn) return;
      const rect  = canvas.getBoundingClientRect();
      const dragG = document.getElementById('fb-drag-edge-g');

      const onMove = mv => {
        const cx = mv.clientX - rect.left;
        const cy = mv.clientY - rect.top;
        const pos = fnPos(fromFn);
        const sx  = (pos.x + FN_W) * _s.zoom + _s.pan.x;
        const sy  = (pos.y + FN_H / 2) * _s.zoom + _s.pan.y;
        dragG.innerHTML = `<line x1="${sx}" y1="${sy}" x2="${cx}" y2="${cy}"
          stroke="${C.accent}" stroke-width="2" stroke-dasharray="6,3"
          marker-end="url(#arr-drag)"/>`;
      };

      const onUp = async mv => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        dragG.innerHTML = '';
        const tgtEl = document.elementFromPoint(mv.clientX, mv.clientY)?.closest('.fb-fn-node');
        const toId  = tgtEl?.dataset.id;
        if (toId && toId !== fromId) {
          const exists = _s.edges.find(e => e.source_fn_id === fromId && e.target_fn_id === toId);
          if (!exists) {
            const { data: edgeData } = await sb.from('fmea_function_edges').insert({
              project_id: _ctx.project.id,
              parent_type: _ctx.parentType, parent_id: _ctx.parentId,
              source_fn_id: fromId, target_fn_id: toId,
              edge_type: 'depends_on',
            }).select().single();
            if (edgeData) {
              // Auto-infer rules for all source FMs
              const toFn   = _s.fns.find(f => f.id === toId);
              const srcFms = fromFn._fms || [];
              const inferredRules = [];
              for (const fm of srcFms) {
                const effect = inferEffect(fm.failure_mode, 'depends_on');
                const { data: ruleData } = await sb.from('fmea_propagation_rules').insert({
                  edge_id: edgeData.id, source_fm_id: fm.id,
                  effect_at_target: effect, severity: 5, is_inferred: true,
                }).select().single();
                if (ruleData) inferredRules.push(ruleData);
              }
              edgeData._rules = inferredRules;
              _s.edges.push(edgeData);
              _s.selectedId = edgeData.id;
              _s.selType    = 'edge';
              console.log(`[FMEA Beta] Edge created: ${fromFn.name} → ${toFn?.name} (${inferredRules.length} rules inferred)`);
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
    const nodeEl = e.target.closest('.fb-fn-node');
    if (!nodeEl) return;
    const id = nodeEl.dataset.id;
    _s.selectedId = id;
    _s.selType    = 'fn';
    renderFnList();
    renderProps();

    const fn = _s.fns.find(f => f.id === id);
    if (!fn) return;
    const startX = e.clientX, startY = e.clientY;
    const pos0   = fnPos(fn);
    let moved    = false;

    const onMove = mv => {
      moved = true;
      const nx = pos0.x + (mv.clientX - startX) / _s.zoom;
      const ny = pos0.y + (mv.clientY - startY) / _s.zoom;
      if (!_s.cfgMap[fn.id]) {
        fn._x = nx; fn._y = ny;
      } else {
        _s.cfgMap[fn.id].x = nx;
        _s.cfgMap[fn.id].y = ny;
      }
      renderGraph();
    };
    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) return;
      const newPos = fnPos(fn);
      if (_s.cfgMap[fn.id]) {
        await sb.from('fmea_node_config').update({ x: newPos.x, y: newPos.y }).eq('id', _s.cfgMap[fn.id].id);
      } else {
        const { data } = await sb.from('fmea_node_config').upsert({
          fn_id: fn.id, project_id: _ctx.project.id,
          parent_type: _ctx.parentType, parent_id: _ctx.parentId,
          x: newPos.x, y: newPos.y,
        }, { onConflict: 'fn_id,parent_type,parent_id' }).select().single();
        if (data) { _s.cfgMap[fn.id] = data; fn._cfg = data; }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Show/hide handles on hover
  nodesG.addEventListener('mouseover', e => {
    e.target.closest('.fb-fn-node')?.querySelector('.fb-conn-handle')?.style.setProperty('opacity','1');
  });
  nodesG.addEventListener('mouseout', e => {
    e.target.closest('.fb-fn-node')?.querySelector('.fb-conn-handle')?.style.setProperty('opacity','0');
  });

  // Edge click (SVG delegate)
  svg.addEventListener('click', e => {
    const hit = e.target.closest('.fb-edge-g');
    if (!hit) return;
    _s.selectedId = hit.dataset.eid;
    _s.selType    = 'edge';
    renderProps();
    renderGraph();
  });

  // Left panel fn list click
  document.getElementById('fb-fn-list')?.addEventListener('click', e => {
    const item = e.target.closest('.fb-fn-item');
    if (!item) return;
    _s.selectedId = item.dataset.id;
    _s.selType    = 'fn';
    // Pan to node
    const fn = _s.fns.find(f => f.id === item.dataset.id);
    if (fn) {
      const pos = fnPos(fn);
      const canvas = document.getElementById('fb-canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        _s.pan.x = rect.width  / 2 - (pos.x + FN_W / 2) * _s.zoom;
        _s.pan.y = rect.height / 2 - (pos.y + FN_H / 2) * _s.zoom;
      }
    }
    renderAll();
  });

  // Delete key
  window.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (!_s.selectedId) return;
    if (_s.selType === 'edge') {
      const edge = _s.edges.find(x => x.id === _s.selectedId);
      if (edge) {
        sb.from('fmea_function_edges').delete().eq('id', edge.id);
        _s.edges = _s.edges.filter(x => x.id !== edge.id);
        _s.selectedId = null;
        renderAll();
      }
    }
  });

  // Topbar
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
    b.style.cssText = tabS(b.dataset.tab === tab);
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'table') generateTable();
}

// ── Style helpers ──────────────────────────────────────────────────────────────
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function btnS(bg, border) { return `background:${bg};border:1px solid ${border||C.border};border-radius:5px;color:${C.text};font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;`; }
function tabS(active) { return `background:transparent;border:none;border-bottom:2px solid ${active?C.primary:'transparent'};color:${active?C.primary:C.textMuted};font-size:12px;font-weight:${active?'700':'500'};padding:0 14px;height:38px;cursor:pointer;`; }
function secHead() { return `padding:10px 14px 6px;font-size:10px;font-weight:700;letter-spacing:1.5px;color:${C.textMuted};text-transform:uppercase;flex-shrink:0;`; }
function secLabel() { return `font-size:10px;font-weight:700;letter-spacing:1px;color:${C.textMuted};text-transform:uppercase;margin-bottom:6px;display:block;`; }
function inpS() { return `background:${C.surface2};border:1px solid ${C.border};border-radius:4px;color:${C.text};font-size:12px;padding:5px 8px;outline:none;`; }
function pill(text, color) { return `<span style="display:inline-block;background:${color}18;border:1px solid ${color}55;color:${color};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">${text}</span>`; }
