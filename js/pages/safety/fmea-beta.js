// NEW FMEA Beta v3
// Layout: identical shell to Architecture (arch-shell, spec-nav, arch-workspace,
//         arch-viewport, req-trace-panel, bp-bar) — reuses all existing CSS.
// Data:   arch_components + arch_functions (read-only structural context)
//         fmea_function_edges + fmea_node_config + fmea_propagation_rules (FMEA layer)
// Canvas: arch blocks + connections rendered identically to architecture.js,
//         with a FMEA SVG layer on top for functional dependency edges + propagation glow.

import { sb } from '../../config.js';
import { wireBottomPanel } from '../../utils/bottom-panel.js';

// ── Arch style constants (mirrors architecture.js) ─────────────────────────────
const STYLES = {
  HW:         { border: '#2563EB' },
  SW:         { border: '#16A34A' },
  Mechanical: { border: '#D97706' },
  Group:      { border: '#6B7280' },
  Port:       { border: '#374151' },
};

// ── FMEA edge types ────────────────────────────────────────────────────────────
const EDGE_TYPES = {
  depends_on:        { label: 'Depends on',   dash: '',        color: '#4f5fc4' },
  controls:          { label: 'Controls',     dash: '',        color: '#c45f00' },
  monitors:          { label: 'Monitors',     dash: '6,3',     color: '#1a8f5c' },
  powers:            { label: 'Powers',       dash: '',        color: '#9a7400' },
  communicates_with: { label: 'Communicates', dash: '3,3',     color: '#7c3dc4' },
  triggers:          { label: 'Triggers',     dash: '8,2,2,2', color: '#0090d4' },
};

// ── Inference table ────────────────────────────────────────────────────────────
const INFER = {
  missing:      { depends_on:'Missing input → function cannot execute', controls:'Loss of control → uncontrolled behavior', monitors:'Loss of monitoring → fault undetected', powers:'Loss of power → function unavailable', communicates_with:'Communication loss → missing data', triggers:'Missing trigger → function not activated' },
  incorrect:    { depends_on:'Incorrect input → incorrect output', controls:'Incorrect control → erroneous behavior', monitors:'Incorrect monitoring → wrong diagnostic', powers:'Incorrect voltage → degraded operation', communicates_with:'Corrupted data → incorrect processing', triggers:'Incorrect trigger → wrong activation' },
  delayed:      { depends_on:'Delayed input → delayed output', controls:'Delayed control → late response', monitors:'Delayed monitoring → late fault detection', powers:'Power delay → startup failure', communicates_with:'Communication delay → timing violation', triggers:'Delayed trigger → late activation' },
  intermittent: { depends_on:'Intermittent input → sporadic failure', controls:'Intermittent control → unstable behavior', monitors:'Intermittent monitoring → unreliable', powers:'Intermittent power → repeated restarts', communicates_with:'Intermittent comm → sporadic data loss', triggers:'Intermittent trigger → sporadic activation' },
  unstable:     { depends_on:'Unstable input → unstable output', controls:'Unstable control → oscillation', monitors:'Unstable monitoring → fluctuating', powers:'Unstable power → erratic operation', communicates_with:'Unstable comm → intermittent errors', triggers:'Unstable trigger → repeated activations' },
};

function inferEffect(fmText, edgeType) {
  const f = (fmText || '').toLowerCase();
  const k = f.includes('miss')||f.includes('loss')||f.includes('absent') ? 'missing'
    : f.includes('incorr')||f.includes('wrong')||f.includes('erron') ? 'incorrect'
    : f.includes('delay')||f.includes('late')||f.includes('slow') ? 'delayed'
    : f.includes('intermi')||f.includes('sporadic') ? 'intermittent'
    : f.includes('unstable')||f.includes('oscillat') ? 'unstable'
    : 'incorrect';
  return (INFER[k]||INFER.incorrect)[edgeType] || 'Failure propagated to dependent function';
}

// ── Propagation colours ────────────────────────────────────────────────────────
const PROP_GLOW = {
  0: null,          // injection source: orange
  1: '#f59e0b',     // local effect: amber
  2: '#f97316',     // propagated: orange
  3: '#ef4444',     // critical: red
};

// ── State ──────────────────────────────────────────────────────────────────────
let _ctx  = null;
let _s    = {
  comps:   [],   // arch_components
  conns:   [],   // arch_connections
  fns:     [],   // arch_functions (enriched _fms, _cfg)
  edges:   [],   // fmea_function_edges (enriched _rules)
  cfgMap:  {},   // fnId → fmea_node_config
  panX: 20, panY: 20, zoom: 1,
  dragging: null,
  selectedFnId:   null,
  selectedEdgeId: null,
  connecting: null,
  injected:   null,   // {fnId, fmId}
  propagated: {},     // fnId → {level, cut, cutReason, path, effects}
  activeTab: 'graph',
};

// ── Entry ──────────────────────────────────────────────────────────────────────
export async function renderFmeaBeta(container, ctx) {
  _ctx = ctx;
  const { item, system } = ctx;
  const title = system ? `${system.name}` : (item?.name || '');

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';
  await loadData();
  buildShell(container, title);
  renderAll();
  wireCanvas();
  wireTree();
  wireProps();
  wireToolbar();
  wireFmeaLayer();
  requestAnimationFrame(fitView);
}

// ── Load ───────────────────────────────────────────────────────────────────────
async function loadData() {
  const { parentType, parentId, project } = _ctx;

  const [cRes, cnRes, fmRes, cfgRes, edgeRes, ruleRes] = await Promise.all([
    sb.from('arch_components').select('*').eq('parent_type', parentType).eq('parent_id', parentId).order('sort_order'),
    sb.from('arch_connections').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('arch_function_fms').select('*').eq('project_id', project.id),
    sb.from('fmea_node_config').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('fmea_function_edges').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
    sb.from('fmea_propagation_rules').select('*'),
  ]);

  _s.comps = cRes.data  || [];
  _s.conns = cnRes.data || [];

  let allFns = [];
  const compIds = _s.comps.map(c => c.id);
  if (compIds.length) {
    const { data } = await sb.from('arch_functions').select('*').in('component_id', compIds).order('sort_order');
    allFns = data || [];
  }

  const fmsByFn = {};
  (fmRes.data || []).forEach(fm => { (fmsByFn[fm.function_id] ||= []).push(fm); });

  _s.cfgMap = {};
  (cfgRes.data || []).forEach(c => { _s.cfgMap[c.fn_id] = c; });

  const rulesByEdge = {};
  (ruleRes.data || []).forEach(r => { (rulesByEdge[r.edge_id] ||= []).push(r); });

  _s.fns = allFns.map(f => ({ ...f, _fms: fmsByFn[f.id] || [] }));

  const fnIds = new Set(_s.fns.map(f => f.id));
  _s.edges = (edgeRes.data || [])
    .filter(e => fnIds.has(e.source_fn_id) && fnIds.has(e.target_fn_id))
    .map(e => ({ ...e, _rules: rulesByEdge[e.id] || [] }));

  // Attach fns + fms to their parent components
  _s.comps.forEach(c => {
    c.functions = _s.fns.filter(f => f.component_id === c.id);
  });

  _s.injected   = null;
  _s.propagated = {};
}

// ── Shell (mirrors architecture.js buildShell exactly) ────────────────────────
function buildShell(container, title) {
  container.innerHTML = `
    <div class="arch-shell">
      <div class="arch-topbar">
        <span class="arch-topbar-title">⬡ ${escH(title)} — NEW FMEA Beta</span>
        <div class="arch-topbar-right">
          <span id="fb-prop-status" style="font-size:11px;color:#c45f00;font-weight:600;margin-right:8px;"></span>
          <button id="fb-clear-btn" class="arch-tb-zoom" style="display:none;color:#c45f00;border-color:#c45f00;">✕ Clear injection</button>
          <div class="arch-sep"></div>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="arch-toolbar">
        <span style="font-size:11px;font-weight:700;color:var(--color-text-muted);letter-spacing:.5px;margin-right:4px;">FMEA</span>
        <button id="fb-gen-btn" class="arch-tb-item" title="Generate DFMEA table">⚡ Generate DFMEA</button>
        <div class="arch-tb-sep"></div>
        <span style="font-size:10px;color:var(--color-text-muted);">
          Drag ● on function → connect · Click edge → configure · Click function → inject failure
        </span>
        <div class="arch-tb-sep" style="margin-left:auto;"></div>
        <button class="arch-tb-zoom" id="btn-zoom-in"  title="Zoom in">＋</button>
        <button class="arch-tb-zoom" id="btn-zoom-out" title="Zoom out">－</button>
        <button class="arch-tb-zoom" id="btn-zoom-fit" title="Fit all">⊡</button>
        <span class="arch-tb-zoom-lbl" id="arch-zoom-lbl">100%</span>
      </div>

      <div class="arch-workspace">
        <!-- Left tree — spec-nav pattern identical to architecture.js -->
        <nav class="spec-nav spec-nav--hidden" id="arch-tree-wrap">
          <button class="spec-nav-expand" id="arch-tree-tab" title="Open tree">
            <span>❯</span>
            <span class="spec-nav-rail-label">Tree</span>
          </button>
          <div class="spec-nav-hdr">
            <span class="spec-nav-title">Functional Tree</span>
            <button class="btn-icon spec-nav-close" id="arch-tree-close" title="Close">✕</button>
          </div>
          <div class="arch-tree-body" id="arch-tree-body"></div>
        </nav>

        <div class="arch-canvas-outer" id="arch-outer">
          <div class="arch-viewport" id="arch-vp">
            <div class="arch-group-layer" id="arch-group-layer"></div>
            <svg class="arch-svg" id="arch-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-e" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0,8 3,0 6" class="arr-poly"/>
                </marker>
                ${Object.entries(EDGE_TYPES).map(([k,v]) => `
                  <marker id="fmea-arr-${k}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="${v.color}"/>
                  </marker>
                  <marker id="fmea-arr-${k}-prop" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="#ef4444"/>
                  </marker>`).join('')}
                <marker id="fmea-arr-drag" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0,8 3,0 6" fill="#0090d4"/>
                </marker>
                <filter id="fmea-glow-red" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="4" result="b"/>
                  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
                <filter id="fmea-glow-orange" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="3" result="b"/>
                  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>
              <g id="arch-conn-g"></g>
              <g id="fmea-edge-g"></g>
              <g id="fmea-drag-g"></g>
            </svg>
            <div class="arch-comp-layer" id="arch-comp-layer"></div>
            <!-- FMEA connection handles layer (above blocks) -->
            <div id="fmea-handles-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
          </div>
        </div>

        <!-- Right properties panel — req-trace-panel pattern -->
        <aside class="req-trace-panel arch-pal-wrap" id="arch-pal-wrap" style="border-right:none;">
          <div class="swu-rail-tabs">
            <button class="swu-rail-btn swu-rail-btn--active" id="fb-tab-graph">Graph</button>
            <button class="swu-rail-btn" id="fb-tab-table">DFMEA</button>
          </div>
          <div class="req-trace-panel-hdr">
            <span class="req-trace-panel-title" id="fb-props-title">Properties</span>
            <button class="btn-icon" id="arch-pal-close" title="Collapse">✕</button>
          </div>
          <div class="arch-props-scroll" id="pal-body-props">
            <div id="fb-props-body">
              <div class="arch-props-empty">↖ Select a function or FMEA edge</div>
            </div>
          </div>
          <!-- DFMEA table view inside right panel -->
          <div id="fb-table-body" style="display:none;flex:1;overflow:auto;padding:12px;font-size:12px;"></div>
        </aside>
      </div>

      <!-- Bottom log panel -->
      <div class="bp-bar bp-collapsed" id="fb-log-panel">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title">⚡ FMEA Event Log</span>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body" id="fb-log-body" style="font-family:monospace;font-size:11px;padding:6px 14px;overflow-y:auto;"></div>
      </div>
    </div>`;

  wireBottomPanel(document.getElementById('fb-log-panel'));
}

// ── Render all ─────────────────────────────────────────────────────────────────
function renderAll() {
  renderBlocks();
  renderArchConns();
  renderFmeaEdges();
  applyViewport();
  renderTree();
}

// ── Arch blocks (read context — no editing, no ports) ─────────────────────────
function renderBlocks() {
  const groupLayer = document.getElementById('arch-group-layer');
  const compLayer  = document.getElementById('arch-comp-layer');
  if (!groupLayer || !compLayer) return;

  groupLayer.innerHTML = _s.comps.filter(c => c.comp_type === 'Group').map(g => {
    const sel = _s.selectedFnId && g.functions?.some(f => f.id === _s.selectedFnId);
    return `<div class="arch-group ${sel ? 'arch-group--sel' : ''}"
      id="comp-${g.id}" data-id="${g.id}"
      style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px">
      <div class="arch-group-hdr" data-drag-id="${g.id}">
        <span class="arch-group-stereo">«system»</span>
        <span class="arch-group-name">${escH(g.name)}</span>
      </div>
      ${fnStrip(g)}
      <div class="arch-resize-handle arch-resize-handle--se" data-corner="se" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--sw" data-corner="sw" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--ne" data-corner="ne" data-comp-id="${g.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--nw" data-corner="nw" data-comp-id="${g.id}"></div>
    </div>`;
  }).join('');

  compLayer.innerHTML = _s.comps.filter(c => c.comp_type !== 'Group' && c.comp_type !== 'Port').map(c => {
    const st  = STYLES[c.comp_type] || STYLES.HW;
    const sel = _s.selectedFnId && c.functions?.some(f => f.id === _s.selectedFnId);
    return `<div class="arch-block ${sel ? 'arch-block--sel' : ''} ${c.is_safety_critical ? 'arch-block--safe' : ''}"
      id="comp-${c.id}" data-id="${c.id}" data-type="${c.comp_type}"
      style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;
             border-color:${c.is_safety_critical ? '#C5221F' : st.border}">
      <div class="arch-block-hdr" data-drag-id="${c.id}">
        <span class="arch-block-type-badge" style="color:${c.is_safety_critical ? '#C5221F' : st.border}">${c.comp_type}</span>
        <span class="arch-block-name">${escH(c.name)}</span>
        ${c.is_safety_critical ? '<span class="arch-block-safe-ico">⚠</span>' : ''}
      </div>
      ${fnStrip(c)}
      <div class="arch-resize-handle arch-resize-handle--se" data-corner="se" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--sw" data-corner="sw" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--ne" data-corner="ne" data-comp-id="${c.id}"></div>
      <div class="arch-resize-handle arch-resize-handle--nw" data-corner="nw" data-comp-id="${c.id}"></div>
    </div>`;
  }).join('');

  // Wire block drag (position only — no delete/resize)
  compLayer.querySelectorAll('[data-drag-id]').forEach(hdr => wireBlockDrag(hdr.dataset.dragId));
  groupLayer.querySelectorAll('[data-drag-id]').forEach(hdr => wireBlockDrag(hdr.dataset.dragId));
  compLayer.querySelectorAll('.arch-resize-handle').forEach(h => wireBlockResize(h));
  groupLayer.querySelectorAll('.arch-resize-handle').forEach(h => wireBlockResize(h));

  // Wire function clicks
  document.querySelectorAll('.fb-fn-box').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      selectFn(el.dataset.fnId);
    });
  });

  // Wire connection handles (shown on hover)
  updateHandles();
}

function fnStrip(c) {
  const fns = c.functions || [];
  if (!fns.length) return '<div style="padding:4px 8px;font-size:10px;color:var(--color-text-muted);">No functions</div>';
  return `<div class="arch-block-funs" id="funlist-${c.id}">
    ${fns.map(f => {
      const prop  = _s.propagated[f.id];
      const isInj = _s.injected?.fnId === f.id;
      const isSel = _s.selectedFnId === f.id;
      const glowColor = isInj ? '#c45f00' : prop?.cut ? '#1a8f5c' : PROP_GLOW[prop?.level];
      const borderStyle = glowColor ? `border:1.5px solid ${glowColor};box-shadow:0 0 6px ${glowColor}44;` : '';
      const bgStyle = isInj ? 'background:#fff3e6;' : prop?.cut ? 'background:#e6f6ee;' : prop?.level === 3 ? 'background:#fde8ed;' : prop?.level ? 'background:#fff8e6;' : '';
      return `<div class="arch-fun-box fb-fn-box ${f.is_safety_related ? 'arch-fun-box--safe' : ''} ${isSel ? 'arch-fun-box--sel' : ''}"
        data-fn-id="${f.id}" data-comp-id="${c.id}"
        style="${borderStyle}${bgStyle}cursor:pointer;position:relative;"
        title="${escH(f.name)}${f.description ? '\n'+f.description : ''}">
        <span class="arch-fun-box-label">f</span>
        <span class="arch-fun-box-name" style="flex:1;">${escH(f.name)}</span>
        ${isInj ? '<span style="font-size:9px;color:#c45f00;margin-left:2px;">⚡</span>' : ''}
        ${prop?.cut ? '<span style="font-size:9px;color:#1a8f5c;margin-left:2px;">✓</span>' : ''}
        ${prop?.level === 3 ? '<span style="font-size:9px;color:#ef4444;margin-left:2px;">⚠</span>' : ''}
        ${f.is_safety_related ? '<span class="arch-fun-box-warn">⚠</span>' : ''}
        <!-- FMEA connection handle -->
        <span class="fmea-fn-handle" data-fn-id="${f.id}"
          style="position:absolute;right:-6px;top:50%;transform:translateY(-50%);
          width:10px;height:10px;border-radius:50%;background:#0090d4;border:2px solid white;
          cursor:crosshair;pointer-events:all;opacity:0;transition:opacity .15s;
          box-shadow:0 1px 3px rgba(0,0,0,.3);z-index:10;"></span>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Arch connections (read-only simplified render) ────────────────────────────
function renderArchConns() {
  const g = document.getElementById('arch-conn-g');
  if (!g) return;
  g.innerHTML = _s.conns.map(cn => {
    const src = _s.comps.find(c => c.id === cn.source_id);
    const tgt = _s.comps.find(c => c.id === cn.target_id);
    if (!src || !tgt) return '';
    const sx = src.x + src.width, sy = src.y + src.height / 2;
    const tx = tgt.x,             ty = tgt.y + tgt.height / 2;
    const cx1 = sx + Math.abs(tx-sx)*0.4, cx2 = tx - Math.abs(tx-sx)*0.4;
    return `<path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
      stroke="#9aa3c8" stroke-width="1.5" fill="none" stroke-dasharray="4,3"
      marker-end="url(#arr-e)" opacity=".5"/>`;
  }).join('');
}

// ── FMEA edges ─────────────────────────────────────────────────────────────────
function renderFmeaEdges() {
  const g = document.getElementById('fmea-edge-g');
  if (!g) return;
  g.innerHTML = _s.edges.map(e => {
    const srcFn = _s.fns.find(f => f.id === e.source_fn_id);
    const tgtFn = _s.fns.find(f => f.id === e.target_fn_id);
    if (!srcFn || !tgtFn) return '';
    const srcComp = _s.comps.find(c => c.id === srcFn.component_id);
    const tgtComp = _s.comps.find(c => c.id === tgtFn.component_id);
    if (!srcComp || !tgtComp) return '';

    const srcFnEl = document.querySelector(`.fb-fn-box[data-fn-id="${srcFn.id}"]`);
    const tgtFnEl = document.querySelector(`.fb-fn-box[data-fn-id="${tgtFn.id}"]`);
    let sx, sy, tx, ty;
    if (srcFnEl && tgtFnEl) {
      const sr = srcFnEl.getBoundingClientRect();
      const tr = tgtFnEl.getBoundingClientRect();
      const vp = document.getElementById('arch-outer').getBoundingClientRect();
      const z  = _s.zoom;
      sx = (sr.right  - vp.left - _s.panX) / z;
      sy = (sr.top + sr.height/2 - vp.top - _s.panY) / z;
      tx = (tr.left   - vp.left - _s.panX) / z;
      ty = (tr.top + tr.height/2 - vp.top - _s.panY) / z;
    } else {
      sx = srcComp.x + srcComp.width;  sy = srcComp.y + srcComp.height / 2;
      tx = tgtComp.x;                   ty = tgtComp.y + tgtComp.height / 2;
    }

    const prop    = _s.propagated[tgtFn.id];
    const propSrc = _s.propagated[srcFn.id] || _s.injected?.fnId === srcFn.id;
    const isActive = !!(propSrc && prop);
    const isCut    = prop?.cut;
    const isCrit   = prop?.level === 3;
    const isSel    = _s.selectedEdgeId === e.id;

    const et     = EDGE_TYPES[e.edge_type] || EDGE_TYPES.depends_on;
    const color  = isCrit ? '#ef4444' : isCut ? '#1a8f5c' : isActive ? '#f97316' : isSel ? '#4f5fc4' : et.color;
    const dash   = isCut ? '5,4' : et.dash;
    const width  = isActive || isSel ? 2.5 : 1.5;
    const marker = `fmea-arr-${isCrit && isActive ? e.edge_type+'-prop' : e.edge_type}`;
    const filter = isCrit ? 'filter="url(#fmea-glow-red)"' : isActive && !isCut ? 'filter="url(#fmea-glow-orange)"' : '';

    const cx1 = sx + Math.abs(tx-sx)*0.45;
    const cx2 = tx - Math.abs(tx-sx)*0.45;
    const mx  = (sx+tx)/2, my = (sy+ty)/2 - 12;

    return `<g class="fmea-edge-hit" data-eid="${e.id}" style="cursor:pointer;pointer-events:stroke;">
      <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
        stroke="transparent" stroke-width="14" fill="none" pointer-events="stroke"/>
      <path d="M${sx},${sy} C${cx1},${sy} ${cx2},${ty} ${tx},${ty}"
        stroke="${color}" stroke-width="${width}" fill="none"
        ${dash ? `stroke-dasharray="${dash}"` : ''} ${filter}
        marker-end="url(#${marker})"
        style="${isActive && !isCut ? 'animation:fmea-pulse 1.4s ease-in-out infinite;' : ''}"/>
      ${(e.label || isSel || isActive) ? `
        <rect x="${mx-28}" y="${my-9}" width="56" height="17" rx="3"
          fill="white" stroke="${color}" stroke-width="1" opacity=".95"/>
        <text x="${mx}" y="${my+4}" text-anchor="middle" font-size="9"
          font-family="Inter,system-ui,sans-serif" fill="${color}" font-weight="600">
          ${isCut ? '✓ Cut' : escH(e.label||et.label)}
        </text>` : ''}
      ${e.diagnostic_coverage > 0 ? `
        <text x="${mx}" y="${my+20}" text-anchor="middle" font-size="9"
          font-family="system-ui" fill="#1a8f5c">Diag ${e.diagnostic_coverage}%</text>` : ''}
    </g>`;
  }).join('');

  // Wire edge clicks
  g.querySelectorAll('.fmea-edge-hit').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      _s.selectedEdgeId = el.dataset.eid;
      _s.selectedFnId   = null;
      showEdgeProps(_s.edges.find(x => x.id === el.dataset.eid));
      renderFmeaEdges();
    });
  });
}

// ── Connection handles layer (above blocks) ────────────────────────────────────
function updateHandles() {
  // Handles are embedded inside each fn-box; show on hover
  document.querySelectorAll('.fmea-fn-handle').forEach(h => {
    const box = h.closest('.fb-fn-box');
    box?.addEventListener('mouseenter', () => h.style.opacity = '1');
    box?.addEventListener('mouseleave', () => h.style.opacity = '0');
  });
}

// ── Viewport / zoom ────────────────────────────────────────────────────────────
function applyViewport() {
  const vp = document.getElementById('arch-vp');
  if (vp) vp.style.transform = `translate(${_s.panX}px,${_s.panY}px) scale(${_s.zoom})`;
  const lbl = document.getElementById('arch-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(_s.zoom * 100) + '%';
}

function fitView() {
  if (!_s.comps.length) return;
  const outer = document.getElementById('arch-outer');
  if (!outer) return;
  const r    = outer.getBoundingClientRect();
  const pad  = 40;
  const minX = Math.min(..._s.comps.map(c => c.x));
  const minY = Math.min(..._s.comps.map(c => c.y));
  const maxX = Math.max(..._s.comps.map(c => c.x + (c.width  || 180)));
  const maxY = Math.max(..._s.comps.map(c => c.y + (c.height || 120)));
  const cw   = maxX - minX + pad * 2;
  const ch   = maxY - minY + pad * 2;
  const z    = Math.min(1, (r.width - pad) / cw, (r.height - pad) / ch);
  _s.zoom  = z;
  _s.panX  = pad - minX * z;
  _s.panY  = pad - minY * z;
  applyViewport();
}

// ── Block drag (same as arch) ──────────────────────────────────────────────────
function wireBlockDrag(compId) {
  const hdr = document.querySelector(`#comp-${compId} [data-drag-id="${compId}"]`);
  if (!hdr) return;
  hdr.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const comp = _s.comps.find(c => c.id === compId); if (!comp) return;
    const startX = e.clientX, startY = e.clientY;
    const ox = comp.x, oy = comp.y;
    let moved = false;
    const onMove = mv => {
      moved = true;
      comp.x = ox + (mv.clientX - startX) / _s.zoom;
      comp.y = oy + (mv.clientY - startY) / _s.zoom;
      const el = document.getElementById(`comp-${compId}`);
      if (el) { el.style.left = comp.x + 'px'; el.style.top = comp.y + 'px'; }
      renderFmeaEdges();
    };
    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      if (moved) {
        await sb.from('arch_components').update({ x: comp.x, y: comp.y }).eq('id', comp.id);
        renderAll();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

function wireBlockResize(handleEl) {
  handleEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const compId = handleEl.dataset.compId;
    const corner = handleEl.dataset.corner;
    const comp   = _s.comps.find(c => c.id === compId); if (!comp) return;
    const startX = e.clientX, startY = e.clientY;
    const ox = comp.x, oy = comp.y, ow = comp.width, oh = comp.height;
    const MIN = comp.comp_type === 'Group' ? 160 : 100;
    const onMove = mv => {
      const dx = (mv.clientX - startX) / _s.zoom;
      const dy = (mv.clientY - startY) / _s.zoom;
      if (corner.includes('e')) comp.width  = Math.max(MIN, ow + dx);
      if (corner.includes('s')) comp.height = Math.max(60,  oh + dy);
      if (corner.includes('w')) { comp.width = Math.max(MIN, ow - dx); comp.x = ox + ow - comp.width; }
      if (corner.includes('n')) { comp.height= Math.max(60,  oh - dy); comp.y = oy + oh - comp.height; }
      const el = document.getElementById(`comp-${compId}`);
      if (el) { el.style.left=comp.x+'px'; el.style.top=comp.y+'px'; el.style.width=comp.width+'px'; el.style.height=comp.height+'px'; }
    };
    const onUp = async () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      await sb.from('arch_components').update({ x:comp.x, y:comp.y, width:comp.width, height:comp.height }).eq('id', comp.id);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

// ── Canvas wiring (pan/zoom) ───────────────────────────────────────────────────
function wireCanvas() {
  const outer = document.getElementById('arch-outer');
  if (!outer) return;

  // Pan
  let panStart = null;
  outer.addEventListener('pointerdown', e => {
    if (e.target.closest('.fb-fn-box') || e.target.closest('.fmea-fn-handle') ||
        e.target.closest('[data-drag-id]') || e.target.closest('.arch-resize-handle') ||
        e.target.closest('.fmea-edge-hit')) return;
    if (e.button !== 0) return;
    panStart = { mx: e.clientX, my: e.clientY, px: _s.panX, py: _s.panY };
    outer.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!panStart) return;
    _s.panX = panStart.px + (e.clientX - panStart.mx);
    _s.panY = panStart.py + (e.clientY - panStart.my);
    applyViewport();
  });
  document.addEventListener('pointerup', () => { panStart = null; outer.style.cursor = ''; });

  // Zoom wheel
  outer.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.08 : 0.92;
    const r = outer.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    _s.panX = mx - (mx - _s.panX) * f;
    _s.panY = my - (my - _s.panY) * f;
    _s.zoom = Math.max(0.2, Math.min(3, _s.zoom * f));
    applyViewport();
  }, { passive: false });

  // Zoom buttons
  document.getElementById('btn-zoom-in')?.addEventListener('click',  () => { _s.zoom = Math.min(3, _s.zoom * 1.2); applyViewport(); });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => { _s.zoom = Math.max(0.2, _s.zoom / 1.2); applyViewport(); });
  document.getElementById('btn-zoom-fit')?.addEventListener('click', fitView);

  // Deselect on canvas click
  outer.addEventListener('click', e => {
    if (!e.target.closest('.fb-fn-box') && !e.target.closest('.fmea-edge-hit')) {
      _s.selectedFnId   = null;
      _s.selectedEdgeId = null;
      showEmptyProps();
      renderBlocks();
      renderFmeaEdges();
    }
  });
}

// ── FMEA layer wiring (connection drawing) ────────────────────────────────────
function wireFmeaLayer() {
  const outer = document.getElementById('arch-outer');
  if (!outer) return;

  // Delegate pointerdown on .fmea-fn-handle (inside arch-comp-layer)
  document.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.fmea-fn-handle');
    if (!handle) return;
    e.stopPropagation(); e.preventDefault();
    const fromId = handle.dataset.fnId;
    const fromFn = _s.fns.find(f => f.id === fromId); if (!fromFn) return;
    const rect   = outer.getBoundingClientRect();
    const dragG  = document.getElementById('fmea-drag-g');

    const getCoords = ev => ({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    const getSvgCoords = ev => ({
      x: (ev.clientX - rect.left - _s.panX) / _s.zoom,
      y: (ev.clientY - rect.top  - _s.panY) / _s.zoom,
    });

    const srcEl = handle.closest('.fb-fn-box');
    const srcR  = srcEl?.getBoundingClientRect();
    const srcX  = srcR ? (srcR.right - rect.left) : 0;
    const srcY  = srcR ? (srcR.top + srcR.height/2 - rect.top) : 0;

    const onMove = mv => {
      const { x, y } = getCoords(mv);
      dragG.innerHTML = `<line x1="${(srcX-_s.panX)/_s.zoom}" y1="${(srcY-_s.panY)/_s.zoom}"
        x2="${(x-_s.panX)/_s.zoom}" y2="${(y-_s.panY)/_s.zoom}"
        stroke="#0090d4" stroke-width="2" stroke-dasharray="6,3"
        marker-end="url(#fmea-arr-drag)"/>`;
    };
    const onUp = async mv => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
      dragG.innerHTML = '';
      const tgtEl = document.elementFromPoint(mv.clientX, mv.clientY)?.closest('.fb-fn-box');
      const toId  = tgtEl?.dataset.fnId;
      if (toId && toId !== fromId) {
        const exists = _s.edges.find(x => x.source_fn_id === fromId && x.target_fn_id === toId);
        if (!exists) await createEdge(fromId, toId);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  });
}

async function createEdge(fromId, toId) {
  const { data: edgeData } = await sb.from('fmea_function_edges').insert({
    project_id:  _ctx.project.id,
    parent_type: _ctx.parentType, parent_id: _ctx.parentId,
    source_fn_id: fromId, target_fn_id: toId,
    edge_type: 'depends_on',
  }).select().single();
  if (!edgeData) return;

  // Auto-infer rules for all source FMs
  const fromFn  = _s.fns.find(f => f.id === fromId);
  const rules   = [];
  for (const fm of fromFn?._fms || []) {
    const { data: r } = await sb.from('fmea_propagation_rules').insert({
      edge_id: edgeData.id, source_fm_id: fm.id,
      effect_at_target: inferEffect(fm.failure_mode, 'depends_on'),
      severity: 5, is_inferred: true,
    }).select().single();
    if (r) rules.push(r);
  }
  edgeData._rules = rules;
  _s.edges.push(edgeData);
  _s.selectedEdgeId = edgeData.id;
  _s.selectedFnId   = null;
  log('Edge created', `${fromFn?.name} → ${_s.fns.find(f=>f.id===toId)?.name} (${rules.length} rules inferred)`);
  renderAll();
  showEdgeProps(edgeData);
}

// ── Left tree ──────────────────────────────────────────────────────────────────
function wireTree() {
  const tab   = document.getElementById('arch-tree-tab');
  const close = document.getElementById('arch-tree-close');
  const wrap  = document.getElementById('arch-tree-wrap');
  tab?.addEventListener('click',   () => wrap?.classList.toggle('spec-nav--hidden'));
  close?.addEventListener('click', () => wrap?.classList.add('spec-nav--hidden'));
}

function renderTree() {
  const body = document.getElementById('arch-tree-body');
  if (!body) return;

  body.innerHTML = _s.comps.filter(c => c.comp_type !== 'Port').map(c => {
    const fns  = c.functions || [];
    const fnRows = fns.map(fn => {
      const prop  = _s.propagated[fn.id];
      const isInj = _s.injected?.fnId === fn.id;
      const isSel = _s.selectedFnId === fn.id;
      const fmCount = fn._fms.length;
      let dot = '';
      if (isInj)          dot = `<span style="color:#c45f00;font-size:10px;">⚡</span>`;
      else if (prop?.cut) dot = `<span style="color:#1a8f5c;font-size:10px;">✓</span>`;
      else if (prop?.level === 3) dot = `<span style="color:#ef4444;font-size:10px;">⚠</span>`;
      else if (prop?.level)       dot = `<span style="color:#f97316;font-size:10px;">→</span>`;

      return `<div class="arch-tree-fn-entry arch-tree-row ${isSel ? 'arch-tree-node--sel' : ''}"
        style="padding-left:24px;" data-select-fn="${fn.id}">
        <span class="arch-tree-sym" style="color:#4f5fc4;font-size:10px;">λ</span>
        <span class="arch-tree-leaf-label" style="flex:1;">${escH(fn.name)}</span>
        ${dot}
        ${fmCount ? `<span style="font-size:10px;color:var(--color-text-muted);">⚠${fmCount}</span>` : ''}
      </div>`;
    }).join('');

    const isGroup = c.comp_type === 'Group';
    return `<div class="arch-tree-node arch-tree-row" data-comp-id="${c.id}">
      <span class="arch-tree-sym" style="color:${STYLES[c.comp_type]?.border||'#6B7280'};">◈</span>
      <span class="arch-tree-leaf-label">${escH(c.name)}</span>
      <span style="font-size:10px;color:var(--color-text-muted);">${c.comp_type}</span>
    </div>
    ${fnRows}`;
  }).join('');

  body.querySelectorAll('[data-select-fn]').forEach(el => {
    el.addEventListener('click', () => {
      selectFn(el.dataset.selectFn);
      // Pan to function
      const fn   = _s.fns.find(f => f.id === el.dataset.selectFn);
      const comp = fn ? _s.comps.find(c => c.id === fn.component_id) : null;
      if (comp) {
        const outer = document.getElementById('arch-outer');
        if (outer) {
          const r  = outer.getBoundingClientRect();
          _s.panX  = r.width  / 2 - (comp.x + comp.width  / 2) * _s.zoom;
          _s.panY  = r.height / 2 - (comp.y + comp.height / 2) * _s.zoom;
          applyViewport();
        }
      }
    });
  });
}

// ── Select function ────────────────────────────────────────────────────────────
function selectFn(fnId) {
  _s.selectedFnId   = fnId;
  _s.selectedEdgeId = null;
  const fn = _s.fns.find(f => f.id === fnId);
  if (fn) showFnProps(fn);
  renderBlocks();
  renderFmeaEdges();
  renderTree();
}

// ── Right panel ────────────────────────────────────────────────────────────────
function wireProps() {
  document.getElementById('arch-pal-close')?.addEventListener('click', () => {
    document.getElementById('arch-pal-wrap')?.classList.remove('open');
  });
  document.getElementById('fb-tab-graph')?.addEventListener('click', () => {
    switchPanelTab('graph');
  });
  document.getElementById('fb-tab-table')?.addEventListener('click', () => {
    generateTable();
    switchPanelTab('table');
  });
}

function switchPanelTab(tab) {
  const propsBody = document.getElementById('pal-body-props');
  const tableBody = document.getElementById('fb-table-body');
  const tabGraph  = document.getElementById('fb-tab-graph');
  const tabTable  = document.getElementById('fb-tab-table');
  if (tab === 'graph') {
    propsBody.style.display = ''; tableBody.style.display = 'none';
    tabGraph?.classList.add('swu-rail-btn--active');
    tabTable?.classList.remove('swu-rail-btn--active');
  } else {
    propsBody.style.display = 'none'; tableBody.style.display = '';
    tabGraph?.classList.remove('swu-rail-btn--active');
    tabTable?.classList.add('swu-rail-btn--active');
  }
  const panel = document.getElementById('arch-pal-wrap');
  panel?.classList.add('open');
}

function openPanel() {
  document.getElementById('arch-pal-wrap')?.classList.add('open');
  switchPanelTab('graph');
}

function showEmptyProps() {
  document.getElementById('fb-props-body').innerHTML =
    '<div class="arch-props-empty">↖ Select a function or FMEA edge</div>';
}

function showFnProps(fn) {
  openPanel();
  document.getElementById('fb-props-title').textContent = fn.name;
  const cfg  = _s.cfgMap[fn.id];
  const prop = _s.propagated[fn.id];
  const isInj = _s.injected?.fnId === fn.id;

  const propBadge = isInj
    ? badge('⚡ INJECTION POINT', '#c45f00')
    : prop?.cut     ? badge('✓ ' + prop.cutReason,   '#1a8f5c')
    : prop?.level===3 ? badge('⚠ CRITICAL EFFECT', '#ef4444')
    : prop?.level===2 ? badge('⚡ PROPAGATED',      '#f97316')
    : prop?.level===1 ? badge('→ LOCAL EFFECT',      '#f59e0b')
    : '';

  const fmRows = fn._fms.map(fm => `
    <div style="padding:6px 8px;border-radius:4px;background:var(--bg-hover);border:1px solid var(--color-border);margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:var(--color-danger);font-size:11px;">⚠</span>
        <span style="font-size:12px;flex:1;">${escH(fm.failure_mode)}</span>
        <button class="fb-inject-btn btn-sm" data-fnid="${fn.id}" data-fmid="${fm.id}"
          style="font-size:10px;padding:2px 8px;">⚡ Inject</button>
      </div>
      ${fm.local_effect ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;margin-left:17px;">${escH(fm.local_effect)}</div>` : ''}
    </div>`).join('');

  document.getElementById('fb-props-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
      <div>
        ${propBadge ? `<div style="margin-bottom:6px;">${propBadge}</div>` : ''}
        ${fn.is_safety_related ? `<div style="margin-bottom:4px;">${badge('Safety Related','#ef4444')}</div>` : ''}
        ${fn.description ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;line-height:1.5;">${escH(fn.description)}</div>` : ''}
      </div>

      <div>
        <div class="arch-props-section-label">Failure Modes</div>
        ${fmRows || `<div style="font-size:11px;color:var(--color-text-muted);">No FMs — add in Architecture Specification.</div>`}
      </div>

      <div style="border-top:1px solid var(--color-border);padding-top:10px;">
        <div class="arch-props-section-label">Cut Mechanisms</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="fb-has-red" ${cfg?.has_redundancy?'checked':''}>
            Redundancy
          </label>
          ${cfg?.has_redundancy ? `<input id="fb-red-desc" class="form-input" value="${escH(cfg.redundancy_desc||'')}" placeholder="e.g. dual channel…" style="margin-left:20px;">` : ''}
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="fb-has-ss" ${cfg?.has_safe_state?'checked':''}>
            Safe state
          </label>
          ${cfg?.has_safe_state ? `<input id="fb-ss-desc" class="form-input" value="${escH(cfg.safe_state_desc||'')}" placeholder="e.g. motor stops…" style="margin-left:20px;">` : ''}
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
            <span>Fault tolerance</span>
            <select id="fb-ft" class="form-select" style="flex:1;">
              <option value="none"    ${(cfg?.fault_tolerance||'none')==='none'?'selected':''}>None</option>
              <option value="partial" ${cfg?.fault_tolerance==='partial'?'selected':''}>Partial</option>
              <option value="full"    ${cfg?.fault_tolerance==='full'?'selected':''}>Full</option>
            </select>
          </div>
        </div>
        <button id="fb-save-cfg" class="btn btn-primary btn-sm" style="width:100%;margin-top:8px;">Save config</button>
      </div>

      ${prop?.effects?.length ? `
        <div>
          <div class="arch-props-section-label">Propagated Effects</div>
          ${prop.effects.map(e => `<div style="font-size:11px;color:var(--color-text-muted);padding:3px 0;border-bottom:1px solid var(--color-border);">→ ${escH(e)}</div>`).join('')}
        </div>` : ''}
    </div>`;

  // Wire checkboxes
  document.getElementById('fb-has-red')?.addEventListener('change', () => showFnProps(fn));
  document.getElementById('fb-has-ss')?.addEventListener('change',  () => showFnProps(fn));

  document.getElementById('fb-save-cfg')?.addEventListener('click', async () => {
    const payload = {
      fn_id: fn.id, project_id: _ctx.project.id,
      parent_type: _ctx.parentType, parent_id: _ctx.parentId,
      has_redundancy: document.getElementById('fb-has-red')?.checked || false,
      redundancy_desc: document.getElementById('fb-red-desc')?.value.trim() || null,
      has_safe_state:  document.getElementById('fb-has-ss')?.checked  || false,
      safe_state_desc: document.getElementById('fb-ss-desc')?.value.trim()  || null,
      fault_tolerance: document.getElementById('fb-ft')?.value || 'none',
    };
    const { data } = await sb.from('fmea_node_config')
      .upsert(payload, { onConflict: 'fn_id,parent_type,parent_id' }).select().single();
    if (data) { _s.cfgMap[fn.id] = data; }
    renderAll();
  });

  document.querySelectorAll('.fb-inject-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); inject(btn.dataset.fnid, btn.dataset.fmid); });
  });
}

function showEdgeProps(edge) {
  if (!edge) return;
  openPanel();
  const srcFn = _s.fns.find(f => f.id === edge.source_fn_id);
  const tgtFn = _s.fns.find(f => f.id === edge.target_fn_id);
  const et    = EDGE_TYPES[edge.edge_type] || EDGE_TYPES.depends_on;
  const rules = edge._rules || [];
  const srcFms = srcFn?._fms || [];

  document.getElementById('fb-props-title').textContent = 'FMEA Connection';

  const rulesHtml = rules.map(r => {
    const fm = srcFms.find(f => f.id === r.source_fm_id);
    return `<div style="padding:5px 8px;border-radius:4px;background:var(--bg-hover);border:1px solid var(--color-border);margin-bottom:4px;font-size:11px;">
      <div style="color:var(--color-warning);font-weight:600;">⚠ ${escH(fm?.failure_mode||'?')}</div>
      <div style="color:var(--color-text-muted);margin-top:2px;">→ ${escH(r.effect_at_target)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <span style="color:var(--color-text-muted);font-size:10px;">Sev ${r.severity}/10${r.is_inferred ? ' (inferred)':''}</span>
        <button class="fb-edit-rule btn-sm" data-rid="${r.id}" style="margin-left:auto;font-size:10px;">Edit</button>
        <button class="fb-del-rule btn-sm" data-rid="${r.id}" style="font-size:10px;color:var(--color-danger);">✕</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('fb-props-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">
      <div style="font-size:12px;color:var(--color-text-muted);display:flex;align-items:center;gap:6px;">
        <strong style="color:var(--color-text);">${escH(srcFn?.name||'?')}</strong>
        <span style="color:${et.color};">→</span>
        <strong style="color:var(--color-text);">${escH(tgtFn?.name||'?')}</strong>
      </div>

      <div>
        <div class="arch-props-section-label">Edge type</div>
        <select id="fb-etype" class="form-select" style="width:100%;">
          ${Object.entries(EDGE_TYPES).map(([k,v])=>`<option value="${k}" ${k===edge.edge_type?'selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <div class="arch-props-section-label">Signal / Label</div>
        <input id="fb-elabel" class="form-input" value="${escH(edge.label||'')}" placeholder="e.g. CAN signal, PWM…" style="width:100%;">
      </div>
      <div>
        <div class="arch-props-section-label">Diagnostic coverage</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="fb-diag" type="range" min="0" max="100" step="10" value="${edge.diagnostic_coverage||0}" style="flex:1;accent-color:#1a8f5c;">
          <span id="fb-diag-val" style="font-size:12px;font-weight:600;min-width:36px;">${edge.diagnostic_coverage||0}%</span>
        </div>
        <input id="fb-diag-mech" class="form-input" value="${escH(edge.diagnostic_mechanism||'')}" placeholder="e.g. CRC, watchdog, E2E…" style="width:100%;margin-top:4px;">
      </div>
      <button id="fb-save-edge" class="btn btn-primary btn-sm" style="width:100%;">Save connection</button>

      <div>
        <div class="arch-props-section-label">Propagation Rules</div>
        <div id="fb-rules-list">${rulesHtml || `<div style="font-size:11px;color:var(--color-text-muted);">${srcFms.length?'No rules yet.':'Add FMs to source function in Architecture.'}</div>`}</div>
        ${srcFms.length ? `<button id="fb-add-rule" class="btn btn-sm" style="width:100%;margin-top:4px;">＋ Add rule</button>` : ''}
      </div>

      <button id="fb-del-edge" class="btn btn-sm" style="width:100%;color:var(--color-danger);border-color:var(--color-danger);">🗑 Delete connection</button>
    </div>`;

  document.getElementById('fb-diag')?.addEventListener('input', e => {
    document.getElementById('fb-diag-val').textContent = e.target.value + '%';
  });
  document.getElementById('fb-save-edge')?.addEventListener('click', async () => {
    edge.edge_type           = document.getElementById('fb-etype')?.value || edge.edge_type;
    edge.label               = document.getElementById('fb-elabel')?.value.trim() || null;
    edge.diagnostic_coverage = parseInt(document.getElementById('fb-diag')?.value) || 0;
    edge.diagnostic_mechanism= document.getElementById('fb-diag-mech')?.value.trim() || null;
    await sb.from('fmea_function_edges').update({
      edge_type: edge.edge_type, label: edge.label,
      diagnostic_coverage: edge.diagnostic_coverage,
      diagnostic_mechanism: edge.diagnostic_mechanism,
    }).eq('id', edge.id);
    renderAll();
  });
  document.getElementById('fb-add-rule')?.addEventListener('click', () => showRuleForm(edge, srcFms, null));
  document.querySelectorAll('.fb-del-rule').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sb.from('fmea_propagation_rules').delete().eq('id', btn.dataset.rid);
      edge._rules = edge._rules.filter(r => r.id !== btn.dataset.rid);
      showEdgeProps(edge);
    });
  });
  document.querySelectorAll('.fb-edit-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const rule = edge._rules.find(r => r.id === btn.dataset.rid);
      if (rule) showRuleForm(edge, srcFms, rule);
    });
  });
  document.getElementById('fb-del-edge')?.addEventListener('click', async () => {
    await sb.from('fmea_function_edges').delete().eq('id', edge.id);
    _s.edges = _s.edges.filter(e => e.id !== edge.id);
    _s.selectedEdgeId = null;
    showEmptyProps();
    renderAll();
  });
}

function showRuleForm(edge, srcFms, existingRule) {
  const list = document.getElementById('fb-rules-list');
  if (!list) return;
  const formHtml = `<div id="fb-rule-form" style="padding:8px;background:var(--bg-hover);border:1px solid var(--color-border);border-radius:5px;margin-top:4px;">
    <select id="fb-rf-fm" class="form-select" style="width:100%;margin-bottom:4px;">
      <option value="">— Source failure mode —</option>
      ${srcFms.map(f=>`<option value="${f.id}" ${existingRule?.source_fm_id===f.id?'selected':''}>${escH(f.failure_mode)}</option>`).join('')}
    </select>
    <textarea id="fb-rf-eff" class="form-input" rows="2" placeholder="Effect at target…" style="width:100%;resize:vertical;margin-bottom:4px;">${escH(existingRule?.effect_at_target||'')}</textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <label style="font-size:11px;">Severity</label>
      <input id="fb-rf-sev" type="number" min="1" max="10" value="${existingRule?.severity||5}" class="form-input" style="width:52px;">
      <span style="font-size:10px;color:var(--color-text-muted);">/10</span>
    </div>
    <div style="display:flex;gap:4px;">
      <button id="fb-rf-save" class="btn btn-primary btn-sm" style="flex:1;">Save</button>
      <button id="fb-rf-cancel" class="btn btn-sm">Cancel</button>
    </div>
  </div>`;
  list.insertAdjacentHTML('beforeend', formHtml);
  document.getElementById('fb-add-rule').style.display = 'none';

  document.getElementById('fb-rf-fm')?.addEventListener('change', e => {
    const fm  = srcFms.find(f => f.id === e.target.value);
    const eff = document.getElementById('fb-rf-eff');
    if (eff && fm && !existingRule) eff.value = inferEffect(fm.failure_mode, edge.edge_type);
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
      if (data) { const i = edge._rules.findIndex(r=>r.id===existingRule.id); if(i>=0) edge._rules[i]=data; }
    } else {
      const { data } = await sb.from('fmea_propagation_rules')
        .insert({ edge_id: edge.id, source_fm_id: fmId, effect_at_target: eff, severity: sev, is_inferred: false })
        .select().single();
      if (data) edge._rules.push(data);
    }
    showEdgeProps(edge);
  });
  document.getElementById('fb-rf-cancel')?.addEventListener('click', () => showEdgeProps(edge));
}

// ── Toolbar ────────────────────────────────────────────────────────────────────
function wireToolbar() {
  document.getElementById('fb-clear-btn')?.addEventListener('click', clearInjection);
  document.getElementById('fb-gen-btn')?.addEventListener('click',   () => { generateTable(); switchPanelTab('table'); });
}

// ── Propagation engine ────────────────────────────────────────────────────────
function inject(fnId, fmId) {
  _s.injected   = { fnId, fmId };
  _s.propagated = {};
  const startFm  = _s.fns.find(f=>f.id===fnId)?._fms.find(f=>f.id===fmId);
  const queue    = [{ id: fnId, level: 0, path: [fnId], effects: [] }];
  const visited  = new Set([fnId]);
  _s.propagated[fnId] = { level: 0, path: [fnId], effects: [] };
  const activeFmIds = new Set([fmId]);

  while (queue.length) {
    const { id, level, path } = queue.shift();
    _s.edges.forEach(e => {
      if (e.source_fn_id !== id) return;
      const nextId = e.target_fn_id;
      if (visited.has(nextId)) return;

      // Diagnostic cut check
      if (e.diagnostic_coverage === 100) {
        visited.add(nextId);
        _s.propagated[nextId] = { level: 0, cut: true, cutReason: 'Diagnostic 100%', path: [...path, nextId], effects: [] };
        return;
      }

      const matchRules = (e._rules||[]).filter(r => activeFmIds.has(r.source_fm_id));
      const effects    = matchRules.length ? matchRules.map(r=>r.effect_at_target) : startFm ? [inferEffect(startFm.failure_mode, e.edge_type)] : ['Failure propagated'];
      let maxSev       = matchRules.length ? Math.max(...matchRules.map(r=>r.severity)) : 5;
      if (e.diagnostic_coverage > 0) maxSev *= (1 - e.diagnostic_coverage/100);

      const tgtFn  = _s.fns.find(f=>f.id===nextId);
      const tgtCfg = _s.cfgMap[nextId];
      let cut = false, cutReason = '';
      if      (tgtCfg?.fault_tolerance === 'full') { cut = true; cutReason = 'Full fault tolerance'; }
      else if (tgtCfg?.has_redundancy)              { cut = true; cutReason = 'Redundancy'; }

      if (cut) {
        visited.add(nextId);
        _s.propagated[nextId] = { level: 0, cut: true, cutReason, path: [...path, nextId], effects };
        return;
      }

      if (tgtCfg?.fault_tolerance === 'partial') maxSev *= 0.6;
      const isCrit   = !tgtCfg?.has_safe_state && (tgtFn?.is_safety_related || maxSev >= 8);
      const newLevel = isCrit ? 3 : level+1 >= 2 ? 2 : 1;
      visited.add(nextId);
      _s.propagated[nextId] = { level: newLevel, path: [...path, nextId], effects };
      queue.push({ id: nextId, level: level+1, path: [...path, nextId], effects });
      (tgtFn?._fms||[]).forEach(f => activeFmIds.add(f.id));
    });
  }

  const affected = Object.keys(_s.propagated).length - 1;
  const critical = Object.values(_s.propagated).filter(p=>p.level===3).length;
  const cut      = Object.values(_s.propagated).filter(p=>p.cut).length;
  document.getElementById('fb-prop-status').textContent =
    `⚡ ${affected} affected${critical?` · ⚠ ${critical} critical`:''}${cut?` · ✓ ${cut} cut`:''}`;
  document.getElementById('fb-clear-btn').style.display = '';
  log('Failure injected', `${_s.fns.find(f=>f.id===fnId)?.name} → "${startFm?.failure_mode}" → ${affected} nodes`);
  renderAll();
  showFnProps(_s.fns.find(f=>f.id===fnId));
}

function clearInjection() {
  _s.injected   = null;
  _s.propagated = {};
  document.getElementById('fb-prop-status').textContent = '';
  document.getElementById('fb-clear-btn').style.display = 'none';
  renderAll();
  showEmptyProps();
}

// ── DFMEA table ────────────────────────────────────────────────────────────────
function generateTable() {
  const rows = [];
  _s.fns.forEach(fn => {
    fn._fms.forEach(fm => {
      const outEdges  = _s.edges.filter(e => e.source_fn_id === fn.id);
      const rules     = outEdges.flatMap(e => (e._rules||[]).filter(r => r.source_fm_id === fm.id));
      const effects   = rules.length ? rules.map(r=>r.effect_at_target) : outEdges.map(e=>inferEffect(fm.failure_mode, e.edge_type));
      const nextFns   = [...new Set(outEdges.map(e=>_s.fns.find(f=>f.id===e.target_fn_id)?.name).filter(Boolean))];
      const endFns    = outEdges.map(e=>_s.fns.find(f=>f.id===e.target_fn_id)).filter(f=>f?.is_safety_related).map(f=>f.name);
      const maxSev    = rules.length ? Math.max(...rules.map(r=>r.severity)) : outEdges.length ? 5 : null;
      const cutCount  = outEdges.filter(e => e.diagnostic_coverage===100 || _s.cfgMap[e.target_fn_id]?.has_redundancy || _s.cfgMap[e.target_fn_id]?.fault_tolerance==='full').length;
      const comp      = _s.comps.find(c => c.id === fn.component_id);
      rows.push({ comp: comp?.name||'—', fn: fn.name, fm: fm.failure_mode, localEff: fm.local_effect||'—',
        effects, nextHigher: nextFns.join(', ')||'—', endEffect: endFns.join(', ')||nextFns[0]||'—',
        severity: maxSev, cutCount, isInferred: !rules.length && outEdges.length > 0, safety: fn.is_safety_related });
    });
  });

  const el = document.getElementById('fb-table-body');
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div style="padding:16px;color:var(--color-text-muted);">No failure modes found. Add FMs in Architecture Specification.</div>'; return; }

  const thS = `padding:8px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--color-text-muted);border-bottom:2px solid var(--color-border);white-space:nowrap;`;
  const tdS = `padding:7px 12px;font-size:11px;border-bottom:1px solid var(--color-border);vertical-align:top;`;

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:var(--bg-hover);">
      <th style="${thS}">Component</th><th style="${thS}">Function</th>
      <th style="${thS}">Failure Mode</th><th style="${thS}">Local Effect</th>
      <th style="${thS}">Propagated Effects</th><th style="${thS}">End Effect</th>
      <th style="${thS}">Sev</th><th style="${thS}">Mitigations</th>
    </tr></thead>
    <tbody>
      ${rows.map((r,i)=>`<tr style="background:${i%2===0?'var(--bg-card)':'var(--bg-hover)'};">
        <td style="${tdS}">${escH(r.comp)}</td>
        <td style="${tdS}">${escH(r.fn)}${r.safety?` <span style="color:var(--color-danger);font-size:9px;font-weight:700;">FS</span>`:''}${r.isInferred?` <span style="color:var(--color-text-muted);font-size:9px;" title="Inferred">~</span>`:''}</td>
        <td style="${tdS};color:var(--color-warning);font-weight:600;">${escH(r.fm)}</td>
        <td style="${tdS};color:var(--color-text-muted);">${escH(r.localEff)}</td>
        <td style="${tdS}">${r.effects.map(e=>`<div style="font-size:10px;color:var(--color-text-muted);">→ ${escH(e)}</div>`).join('')||'—'}</td>
        <td style="${tdS};color:var(--color-text-muted);">${escH(r.endEffect)}</td>
        <td style="${tdS};font-weight:700;color:${!r.severity?'var(--color-text-muted)':r.severity>=8?'var(--color-danger)':r.severity>=5?'var(--color-warning)':'var(--color-success)'};">${r.severity||'—'}</td>
        <td style="${tdS};color:${r.cutCount?'var(--color-success)':'var(--color-text-muted)'};">${r.cutCount?`✓ ${r.cutCount}`:'—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="margin-top:8px;font-size:11px;color:var(--color-text-muted);">${rows.length} rows · ${rows.filter(r=>r.safety).length} FS · ${rows.filter(r=>r.isInferred).length} inferred (~) · ${rows.filter(r=>r.cutCount>0).length} with mitigations</div>`;
}

// ── Log ────────────────────────────────────────────────────────────────────────
function log(title, detail) {
  const el = document.getElementById('fb-log-body');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  const div  = document.createElement('div');
  div.style.cssText = 'padding:2px 0;border-bottom:1px solid var(--color-border);';
  div.innerHTML = `<span style="color:var(--color-text-muted);">[${time}]</span> <strong>${escH(title)}</strong>${detail ? ` — <span style="color:var(--color-text-muted);">${escH(detail)}</span>` : ''}`;
  el.prepend(div);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function badge(text, color) { return `<span style="display:inline-block;background:${color}18;border:1px solid ${color}55;color:${color};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">${text}</span>`; }
