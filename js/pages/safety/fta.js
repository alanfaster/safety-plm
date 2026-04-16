/**
 * FTA — Fault Tree Analysis  (v3)
 *
 * Features:
 *  • Box nodes (code / component / failure) + optional probability / FR / MTTR rows
 *  • IEC 61025 gate shapes
 *  • Multi-select: rubber-band drag on empty canvas; Shift+click to add/remove
 *  • Move: drag any selected node → all selected move together
 *  • Delete: Delete/Backspace key, or toolbar button
 *  • Port-drag connections: hover → green ● at bottom, drag to target
 *  • Pan: Space + drag  |  Zoom: scroll wheel
 *  • Manual colour per node: colour picker in toolbar (applies to selection)
 *  • Config panel: choose which optional fields to show
 */

import { sb } from '../../config.js';
import { toast } from '../../toast.js';

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Node config ────────────────────────────────────────────────────────────────
const ROW_CODE  = 22;   // code row height
const ROW_STD   = 28;   // component / label row height
const ROW_EXTRA = 22;   // probability / FR / MTTR row height
const BOX_W     = 188;

const NT = {
  top_event:    { label:'Top Event',    stroke:'#C5221F', sw:3, fill:'#FFF5F5', codeColor:'#FDE8E8', indicator:null    },
  intermediate: { label:'Intermediate', stroke:'#E37400', sw:2, fill:'#FFFBF0', codeColor:'#FEF3E2', indicator:null    },
  basic:        { label:'Basic Event',  stroke:'#1E8E3E', sw:2, fill:'#F0FBF4', codeColor:'#E3FCEF', indicator:'circle'  },
  undeveloped:  { label:'Undeveloped',  stroke:'#6B778C', sw:2, fill:'#F4F5F7', codeColor:'#ECEFF4', indicator:'diamond' },
  transfer:     { label:'Transfer',     stroke:'#1A73E8', sw:2, fill:'#EEF4FF', codeColor:'#DEEBFF', indicator:'triangle'},
  gate_and:     { label:'AND',          stroke:'#1E8E3E', sw:2, fill:'#E3FCEF', gw:74, gh:62 },
  gate_or:      { label:'OR',           stroke:'#1A73E8', sw:2, fill:'#DEEBFF', gw:74, gh:62 },
  gate_not:     { label:'NOT',          stroke:'#8B00D0', sw:2, fill:'#F3F0FF', gw:60, gh:60 },
  gate_inhibit: { label:'INHIBIT',      stroke:'#E37400', sw:2, fill:'#FEF3E2', gw:74, gh:58 },
};

const CODE_PFX = {
  top_event:'TE', intermediate:'IE', basic:'BE', undeveloped:'UE',
  transfer:'TR', gate_and:'G', gate_or:'G', gate_not:'G', gate_inhibit:'G',
};

function isGate(type)  { return type?.startsWith('gate'); }
function svgEl(tag)    { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// IEC gate paths (centred at 0,0)
function andPath(hw,hh){ return `M ${-hw},${hh} L ${hw},${hh} L ${hw},0 A ${hw},${hw} 0 0,0 ${-hw},0 Z`; }
function orPath(hw,hh) { return `M ${-hw},${hh} Q 0,${hh*.3} ${hw},${hh} Q ${hw*.85},0 0,${-hh} Q ${-hw*.85},0 ${-hw},${hh} Z`; }
function hexPath(hw,hh){ const f=hw*.38; return `M ${-f},${-hh} L ${f},${-hh} L ${hw},0 L ${f},${hh} L ${-f},${hh} L ${-hw},0 Z`; }

// Lighten a hex colour for fill / code-row bg
function lighten(hex, pct=0.88) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const l=(c)=>Math.round(Math.min(255, c+(255-c)*pct));
  return `rgb(${l(r)},${l(g)},${l(b)})`;
}
function semiLighten(hex){ return lighten(hex, 0.68); }

const LEVEL_H=150, H_GAP=65;

// ── Main ──────────────────────────────────────────────────────────────────────
export async function renderFTA(container, { project, parentType, parentId }) {

  // ── Config (persisted in localStorage) ────────────────────────────────────
  const CFG_KEY = `fta_cfg_${parentType}_${parentId}`;
  let _cfg = { showProbability:false, showFR:false, showMTTR:false };
  try { Object.assign(_cfg, JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); } catch{}
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(_cfg)); }

  // ── State ──────────────────────────────────────────────────────────────────
  let _nodes   = [];
  let _selSet  = new Set();      // selected node ids
  let _drag    = null;           // { origins:[{id,ox,oy}], mx, my }
  let _conn    = null;           // { fromId, curX, curY }
  let _lasso   = null;           // { x1,y1,x2,y2 } rubber-band
  let _pan     = { x:100, y:70 };
  let _zoom    = 1;
  let _panDrag = false;
  let _panStart= null;
  let _space   = false;

  // ── Shell ──────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="fta-wrap">
      <div class="fta-toolbar" id="fta-tb">
        <span class="fta-toolbar-section">Events</span>
        <button class="btn btn-sm fta-add-btn" data-type="top_event">⬛ Top Event</button>
        <button class="btn btn-sm fta-add-btn" data-type="intermediate">▭ Intermediate</button>
        <button class="btn btn-sm fta-add-btn" data-type="basic">● Basic</button>
        <button class="btn btn-sm fta-add-btn" data-type="undeveloped">◇ Undeveloped</button>
        <button class="btn btn-sm fta-add-btn" data-type="transfer">△ Transfer</button>
        <span class="fta-toolbar-sep"></span>
        <span class="fta-toolbar-section">Gates</span>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_and">∧ AND</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_or">∨ OR</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_not">¬ NOT</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_inhibit">⊘ INH</button>
        <span class="fta-toolbar-sep"></span>
        <label class="fta-color-label" title="Node colour">
          <span>🎨</span>
          <input type="color" id="fta-color-inp" value="#1E8E3E" style="width:28px;height:22px;border:none;padding:0;cursor:pointer;background:none">
        </label>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm btn-danger" id="fta-btn-del" disabled>✕ Delete</button>
        <button class="btn btn-sm"            id="fta-btn-layout">⟳ Layout</button>
        <button class="btn btn-sm"            id="fta-btn-cfg" title="Display settings">⚙ Config</button>
        <button class="btn btn-sm"            id="fta-btn-zi">＋</button>
        <button class="btn btn-sm"            id="fta-btn-zo">－</button>
        <button class="btn btn-sm"            id="fta-btn-zr">⊡</button>
      </div>

      <!-- Config panel -->
      <div class="fta-cfg-panel" id="fta-cfg-panel" style="display:none">
        <div class="fta-cfg-title">Display fields</div>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-prob" ${_cfg.showProbability?'checked':''}> Probability (P)</label>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-fr"   ${_cfg.showFR?'checked':''}> Failure Rate (FR)</label>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-mttr" ${_cfg.showMTTR?'checked':''}> MTTR</label>
      </div>

      <div class="fta-canvas-wrap" id="fta-cw">
        <svg id="fta-svg" class="fta-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="farr"  markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 Z" fill="#97A0AF"/></marker>
            <marker id="farrh" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 Z" fill="#1A73E8"/></marker>
          </defs>
          <g id="fta-root">
            <g id="fta-conns"></g>
            <g id="fta-pending"></g>
            <g id="fta-lasso-g"></g>
            <g id="fta-nodes-g"></g>
          </g>
        </svg>
        <div class="fta-hint" id="fta-hint">
          Add a node above · Hover node → drag <span style="color:#1E8E3E">●</span> to connect ·
          Drag empty area to multi-select · Space+drag to pan
        </div>
      </div>
    </div>`;

  await loadNodes();
  render();
  wireToolbar();
  wireCanvas();
  wireKeyboard();

  // ── Data ───────────────────────────────────────────────────────────────────
  async function loadNodes() {
    const { data, error } = await sb.from('fta_nodes')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order', { ascending:true });
    if (error) { toast('Error loading FTA.', 'error'); return; }
    _nodes = data || [];
    if (_nodes.length) document.getElementById('fta-hint').style.display='none';
  }

  function byId(id) { return _nodes.find(n=>n.id===id); }

  function nextCode(type) {
    const pfx = CODE_PFX[type]||'N';
    const nums = _nodes.filter(n=>n.type===type&&n.fta_code?.startsWith(pfx+'-'))
                       .map(n=>parseInt(n.fta_code.split('-')[1])||0);
    return `${pfx}-${String((nums.length?Math.max(...nums):0)+1).padStart(2,'0')}`;
  }

  // Dynamic box height based on config
  function boxH() {
    return ROW_CODE + ROW_STD*2
      + (_cfg.showProbability ? ROW_EXTRA : 0)
      + (_cfg.showFR          ? ROW_EXTRA : 0)
      + (_cfg.showMTTR        ? ROW_EXTRA : 0);
  }

  function nw(n){ return isGate(n.type) ? (NT[n.type]?.gw||74) : BOX_W; }
  function nh(n){ return isGate(n.type) ? (NT[n.type]?.gh||62) : boxH(); }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    renderConns();
    renderNodeEls();
    renderPendingConn();
    renderLasso();
    applyTransform();
    document.getElementById('fta-hint').style.display = _nodes.length ? 'none' : '';
    updateDelBtn();
  }

  function applyTransform() {
    const g=document.getElementById('fta-root');
    if (g) g.setAttribute('transform',`translate(${_pan.x},${_pan.y}) scale(${_zoom})`);
  }

  function renderConns() {
    const layer=document.getElementById('fta-conns');
    layer.innerHTML='';
    _nodes.forEach(n=>{
      if (!n.parent_node_id) return;
      const p=byId(n.parent_node_id); if(!p) return;
      const x1=p.x, y1=p.y+nh(p)/2, x2=n.x, y2=n.y-nh(n)/2;
      const my=(y1+y2)/2;
      const sel=_selSet.has(n.id)||_selSet.has(p.id);
      const el=svgEl('path');
      el.setAttribute('d',`M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`);
      el.setAttribute('fill','none');
      el.setAttribute('stroke', sel?'#1A73E8':'#97A0AF');
      el.setAttribute('stroke-width', sel?'2.5':'1.8');
      el.setAttribute('marker-end', sel?'url(#farrh)':'url(#farr)');
      layer.appendChild(el);
    });
  }

  function renderNodeEls() {
    const layer=document.getElementById('fta-nodes-g');
    layer.innerHTML='';
    _nodes.forEach(n=>layer.appendChild(isGate(n.type)?buildGateNode(n):buildBoxNode(n)));
  }

  // ── Box node ────────────────────────────────────────────────────────────────
  function buildBoxNode(n) {
    const base = NT[n.type]||NT.basic;
    const userColor = n.color&&n.color.startsWith('#') ? n.color : null;
    const stroke    = userColor || base.stroke;
    const fill      = userColor ? lighten(userColor) : base.fill;
    const codeColor = userColor ? semiLighten(userColor) : base.codeColor;
    const sw        = base.sw;
    const sel       = _selSet.has(n.id);
    const BH        = boxH();
    const hw        = BOX_W/2, hh = BH/2;

    const g = svgEl('g');
    g.dataset.id = n.id;
    g.setAttribute('class',`fta-node${sel?' fta-sel':''}`);
    g.setAttribute('transform',`translate(${n.x},${n.y})`);

    // Selection glow
    if (sel) {
      const sh=svgEl('rect');
      sh.setAttribute('x',-hw+3); sh.setAttribute('y',-hh+3);
      sh.setAttribute('width',BOX_W); sh.setAttribute('height',BH);
      sh.setAttribute('rx','6'); sh.setAttribute('fill','rgba(26,115,232,0.18)');
      g.appendChild(sh);
    }

    // Top-event double border
    if (n.type==='top_event') {
      const ob=svgEl('rect');
      ob.setAttribute('x',-(hw+4)); ob.setAttribute('y',-(hh+4));
      ob.setAttribute('width',BOX_W+8); ob.setAttribute('height',BH+8);
      ob.setAttribute('rx','8'); ob.setAttribute('fill','none');
      ob.setAttribute('stroke',stroke); ob.setAttribute('stroke-width','1.5');
      g.appendChild(ob);
    }

    // Main box
    const box=svgEl('rect');
    box.setAttribute('x',-hw); box.setAttribute('y',-hh);
    box.setAttribute('width',BOX_W); box.setAttribute('height',BH);
    box.setAttribute('rx','5'); box.setAttribute('fill',fill);
    box.setAttribute('stroke',stroke); box.setAttribute('stroke-width',sel?sw+1:sw);
    g.appendChild(box);

    // Code row background
    appendCodeBg(g, -hw, -hh, BOX_W, ROW_CODE, sw, codeColor, stroke);

    // Build rows list
    const rows = [
      { field:'fta_code',  value: n.fta_code||'',   y:-hh+ROW_CODE/2,   fs:10, fw:700, fill:stroke  },
      { field:'component', value: n.component||'',  y:-hh+ROW_CODE+ROW_STD/2, fs:11, fw:400, fill:'#6B778C' },
      { field:'label',     value: n.label||'',      y:-hh+ROW_CODE+ROW_STD+ROW_STD/2, fs:11, fw:500, fill:'#172B4D' },
    ];
    let extraY = -hh+ROW_CODE+ROW_STD*2;
    if (_cfg.showProbability) {
      rows.push({ field:'probability', value:fmtNum(n.probability), y:extraY+ROW_EXTRA/2, fs:10, fw:400, fill:'#253858', prefix:'P = ' });
      extraY+=ROW_EXTRA;
    }
    if (_cfg.showFR) {
      rows.push({ field:'failure_rate', value:fmtNum(n.failure_rate), y:extraY+ROW_EXTRA/2, fs:10, fw:400, fill:'#253858', prefix:'FR = ' });
      extraY+=ROW_EXTRA;
    }
    if (_cfg.showMTTR) {
      rows.push({ field:'mttr', value:fmtNum(n.mttr), y:extraY+ROW_EXTRA/2, fs:10, fw:400, fill:'#253858', prefix:'MTTR = ' });
      extraY+=ROW_EXTRA;
    }

    // Dividers + rows
    const divY = [-hh+ROW_CODE];
    if (rows.length>2) divY.push(-hh+ROW_CODE+ROW_STD);
    if (_cfg.showProbability||_cfg.showFR||_cfg.showMTTR) divY.push(-hh+ROW_CODE+ROW_STD*2);
    if (_cfg.showProbability&&(_cfg.showFR||_cfg.showMTTR)) divY.push(-hh+ROW_CODE+ROW_STD*2+ROW_EXTRA);
    if (_cfg.showFR&&_cfg.showMTTR) divY.push(-hh+ROW_CODE+ROW_STD*2+ROW_EXTRA*(_cfg.showProbability?2:1));

    divY.forEach(dy=>{
      const line=svgEl('line');
      line.setAttribute('x1',-hw); line.setAttribute('y1',dy);
      line.setAttribute('x2', hw); line.setAttribute('y2',dy);
      line.setAttribute('stroke',stroke); line.setAttribute('stroke-width','0.7');
      line.setAttribute('opacity','0.35'); line.setAttribute('pointer-events','none');
      g.appendChild(line);
    });

    rows.forEach(r=>{
      // hit rect
      const rh=svgEl('rect');
      const rowTop = r.y - (r.fs===10&&r.prefix ? ROW_EXTRA/2 : (r.field==='fta_code'?ROW_CODE/2:ROW_STD/2));
      const rHeight= r.fs===10&&r.prefix ? ROW_EXTRA : (r.field==='fta_code'?ROW_CODE:ROW_STD);
      rh.setAttribute('x',-hw); rh.setAttribute('y', r.y - rHeight/2);
      rh.setAttribute('width',BOX_W); rh.setAttribute('height',rHeight);
      rh.setAttribute('fill','transparent'); rh.setAttribute('class','fta-row-hit');
      rh.dataset.field=r.field;
      g.appendChild(rh);
      // text
      const txt=svgEl('text');
      txt.setAttribute('x',r.field==='fta_code'?-(hw-8):-(hw-6));
      txt.setAttribute('y',r.y);
      txt.setAttribute('dominant-baseline','middle');
      txt.setAttribute('font-size',r.fs);
      txt.setAttribute('font-weight',r.fw);
      txt.setAttribute('fill',r.fill);
      txt.setAttribute('font-family','-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
      txt.setAttribute('pointer-events','none');
      const maxCh=Math.floor((BOX_W-16)/(r.fs*.58));
      const raw=(r.prefix||'')+(r.value||'—');
      txt.textContent=raw.length>maxCh?raw.slice(0,maxCh-1)+'…':raw;
      g.appendChild(txt);
    });

    // Shape indicator below box
    if (base.indicator) {
      const ind=buildIndicator(base.indicator, stroke);
      ind.setAttribute('transform',`translate(0,${hh+13})`);
      g.appendChild(ind);
    }

    // Output port
    g.appendChild(buildPort(n.id, 0, hh+(base.indicator?26:0)));
    return g;
  }

  function appendCodeBg(g, x, y, w, h, sw, color, stroke) {
    const r1=svgEl('rect');
    r1.setAttribute('x',x+sw/2); r1.setAttribute('y',y+sw/2);
    r1.setAttribute('width',w-sw); r1.setAttribute('height',h);
    r1.setAttribute('rx','4'); r1.setAttribute('fill',color); r1.setAttribute('pointer-events','none');
    g.appendChild(r1);
    const r2=svgEl('rect'); // cover bottom rounded corners
    r2.setAttribute('x',x+sw/2); r2.setAttribute('y',y+sw/2+h-6);
    r2.setAttribute('width',w-sw); r2.setAttribute('height',6);
    r2.setAttribute('fill',color); r2.setAttribute('pointer-events','none');
    g.appendChild(r2);
  }

  function fmtNum(v) {
    if (v==null||v==='') return '';
    const n=parseFloat(v);
    if (isNaN(n)) return String(v);
    if (n>0&&n<0.001) return n.toExponential(2);
    return String(parseFloat(n.toPrecision(4)));
  }

  function buildIndicator(shape, stroke) {
    const g=svgEl('g'); g.setAttribute('pointer-events','none');
    if (shape==='circle')  { const c=svgEl('circle'); c.setAttribute('cx',0);c.setAttribute('cy',0);c.setAttribute('r',10);c.setAttribute('fill','white');c.setAttribute('stroke',stroke);c.setAttribute('stroke-width','2');g.appendChild(c); }
    else if (shape==='diamond') { const p=svgEl('path'); p.setAttribute('d','M 0,-10 L 10,0 L 0,10 L -10,0 Z');p.setAttribute('fill','white');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width','2');g.appendChild(p); }
    else if (shape==='triangle') { const p=svgEl('path'); p.setAttribute('d','M 0,-10 L 11,10 L -11,10 Z');p.setAttribute('fill','white');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width','2');g.appendChild(p); }
    return g;
  }

  // ── Gate node ───────────────────────────────────────────────────────────────
  function buildGateNode(n) {
    const t=NT[n.type]||NT.gate_and;
    const userColor=n.color&&n.color.startsWith('#')?n.color:null;
    const stroke=userColor||t.stroke, fill=userColor?lighten(userColor):t.fill;
    const hw=(t.gw||74)/2, hh=(t.gh||62)/2;
    const sel=_selSet.has(n.id);

    const g=svgEl('g');
    g.dataset.id=n.id;
    g.setAttribute('class',`fta-node fta-gate-node${sel?' fta-sel':''}`);
    g.setAttribute('transform',`translate(${n.x},${n.y})`);

    let shape;
    if (n.type==='gate_and')     { shape=svgEl('path'); shape.setAttribute('d',andPath(hw,hh)); }
    else if (n.type==='gate_or') { shape=svgEl('path'); shape.setAttribute('d',orPath(hw,hh)); }
    else if (n.type==='gate_not'){ shape=svgEl('ellipse'); shape.setAttribute('cx',0); shape.setAttribute('cy',0); shape.setAttribute('rx',hw); shape.setAttribute('ry',hh); }
    else                         { shape=svgEl('path'); shape.setAttribute('d',hexPath(hw,hh)); }
    shape.setAttribute('fill',fill); shape.setAttribute('stroke',stroke);
    shape.setAttribute('stroke-width',sel?t.sw+1:t.sw);
    if (sel) shape.setAttribute('filter','drop-shadow(0 2px 6px rgba(26,115,232,.35))');
    g.appendChild(shape);

    const lbl=svgEl('text');
    lbl.setAttribute('x',0); lbl.setAttribute('y',2);
    lbl.setAttribute('text-anchor','middle'); lbl.setAttribute('dominant-baseline','middle');
    lbl.setAttribute('font-size','13'); lbl.setAttribute('font-weight','700');
    lbl.setAttribute('fill',stroke);
    lbl.setAttribute('font-family','-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
    lbl.setAttribute('pointer-events','none');
    lbl.textContent=n.label||t.label;
    g.appendChild(lbl);

    g.appendChild(buildPort(n.id,0,hh));
    return g;
  }

  // ── Port ────────────────────────────────────────────────────────────────────
  function buildPort(nodeId, px, py) {
    const g=svgEl('g');
    g.setAttribute('class','fta-port');
    g.setAttribute('transform',`translate(${px},${py})`);
    g.dataset.portFor=nodeId;
    const hit=svgEl('circle'); hit.setAttribute('r','12'); hit.setAttribute('fill','transparent'); hit.setAttribute('class','fta-port-hit');
    const vis=svgEl('circle'); vis.setAttribute('r','5'); vis.setAttribute('fill','#1E8E3E'); vis.setAttribute('stroke','#fff'); vis.setAttribute('stroke-width','1.5'); vis.setAttribute('pointer-events','none');
    g.appendChild(hit); g.appendChild(vis);
    return g;
  }

  // ── Pending connection ──────────────────────────────────────────────────────
  function renderPendingConn() {
    const layer=document.getElementById('fta-pending'); layer.innerHTML='';
    if (!_conn) return;
    const n=byId(_conn.fromId); if(!n) return;
    const x1=n.x, y1=n.y+nh(n)/2, x2=_conn.curX, y2=_conn.curY, my=(y1+y2)/2;
    const line=svgEl('path');
    line.setAttribute('d',`M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`);
    line.setAttribute('fill','none'); line.setAttribute('stroke','#1E8E3E');
    line.setAttribute('stroke-width','2'); line.setAttribute('stroke-dasharray','6,4');
    line.setAttribute('pointer-events','none');
    layer.appendChild(line);
    const tip=svgEl('circle'); tip.setAttribute('cx',x2); tip.setAttribute('cy',y2);
    tip.setAttribute('r','4'); tip.setAttribute('fill','#1E8E3E'); tip.setAttribute('pointer-events','none');
    layer.appendChild(tip);
  }

  // ── Rubber-band lasso ───────────────────────────────────────────────────────
  function renderLasso() {
    const layer=document.getElementById('fta-lasso-g'); layer.innerHTML='';
    if (!_lasso) return;
    const x=Math.min(_lasso.x1,_lasso.x2), y=Math.min(_lasso.y1,_lasso.y2);
    const w=Math.abs(_lasso.x2-_lasso.x1), h=Math.abs(_lasso.y2-_lasso.y1);
    const rect=svgEl('rect');
    rect.setAttribute('x',x); rect.setAttribute('y',y);
    rect.setAttribute('width',w); rect.setAttribute('height',h);
    rect.setAttribute('fill','rgba(26,115,232,.1)'); rect.setAttribute('stroke','#1A73E8');
    rect.setAttribute('stroke-width','1.5'); rect.setAttribute('stroke-dasharray','5,3');
    rect.setAttribute('pointer-events','none');
    layer.appendChild(rect);
  }

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  function wireToolbar() {
    container.querySelectorAll('.fta-add-btn').forEach(btn=>btn.addEventListener('click',()=>addNode(btn.dataset.type)));
    document.getElementById('fta-btn-del').addEventListener('click', deleteSelected);
    document.getElementById('fta-btn-layout').addEventListener('click', autoLayout);
    document.getElementById('fta-btn-zi').addEventListener('click',()=>setZoom(_zoom*1.2));
    document.getElementById('fta-btn-zo').addEventListener('click',()=>setZoom(_zoom/1.2));
    document.getElementById('fta-btn-zr').addEventListener('click',()=>{_zoom=1;_pan={x:100,y:70};applyTransform();});

    // Config toggle
    const cfgBtn=document.getElementById('fta-btn-cfg');
    const cfgPanel=document.getElementById('fta-cfg-panel');
    cfgBtn.addEventListener('click',()=>{
      cfgPanel.style.display=cfgPanel.style.display==='none'?'':'none';
    });
    ['cfg-prob','cfg-fr','cfg-mttr'].forEach((id,i)=>{
      const key=['showProbability','showFR','showMTTR'][i];
      document.getElementById(id).addEventListener('change',e=>{
        _cfg[key]=e.target.checked; saveCfg(); render();
      });
    });

    // Colour picker
    document.getElementById('fta-color-inp').addEventListener('input',async e=>{
      const col=e.target.value;
      for (const id of _selSet) {
        const n=byId(id); if(!n) continue;
        n.color=col;
        await autosave(id,{color:col});
      }
      render();
    });
  }

  // ── Canvas events ────────────────────────────────────────────────────────────
  function wireCanvas() {
    const wrap=document.getElementById('fta-cw');
    const svg =document.getElementById('fta-svg');

    wrap.addEventListener('wheel',e=>{
      e.preventDefault();
      const rect=wrap.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const bef={x:(mx-_pan.x)/_zoom,y:(my-_pan.y)/_zoom};
      _zoom=Math.min(3,Math.max(0.15,_zoom*(e.deltaY<0?1.1:0.9)));
      _pan.x=mx-bef.x*_zoom; _pan.y=my-bef.y*_zoom;
      applyTransform();
    },{passive:false});

    svg.addEventListener('mousedown',e=>{
      if (e.button===1){ e.preventDefault(); _panDrag=true; _panStart={x:e.clientX-_pan.x,y:e.clientY-_pan.y}; return; }

      // Port drag → connection
      const portEl=e.target.closest('.fta-port');
      if (portEl){ e.stopPropagation(); const pt=toSvg(e); _conn={fromId:portEl.dataset.portFor,curX:pt.x,curY:pt.y}; return; }

      const nodeEl=e.target.closest('.fta-node');
      if (nodeEl) {
        e.stopPropagation();
        const id=nodeEl.dataset.id;
        if (e.shiftKey) {
          // Toggle selection
          _selSet.has(id)?_selSet.delete(id):_selSet.add(id);
          render(); return;
        }
        if (!_selSet.has(id)) { _selSet.clear(); _selSet.add(id); }
        // Start drag for all selected
        const pt=toSvg(e);
        _drag={ origins:[..._selSet].map(sid=>{const sn=byId(sid);return{id:sid,ox:sn.x,oy:sn.y};}), mx:pt.x, my:pt.y };
        render(); return;
      }

      // Empty canvas
      if (_space) {
        _panDrag=true; _panStart={x:e.clientX-_pan.x,y:e.clientY-_pan.y};
      } else {
        if (!e.shiftKey) _selSet.clear();
        const pt=toSvg(e);
        _lasso={x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y};
      }
      render();
    });

    svg.addEventListener('mousemove',e=>{
      if (_conn) { const pt=toSvg(e); _conn.curX=pt.x; _conn.curY=pt.y; renderPendingConn(); return; }
      if (_drag) {
        const pt=toSvg(e); const dx=pt.x-_drag.mx, dy=pt.y-_drag.my;
        _drag.origins.forEach(({id,ox,oy})=>{ const n=byId(id); if(n){n.x=ox+dx;n.y=oy+dy;} });
        render(); return;
      }
      if (_lasso) { const pt=toSvg(e); _lasso.x2=pt.x; _lasso.y2=pt.y; renderLasso(); return; }
      if (_panDrag) { _pan.x=e.clientX-_panStart.x; _pan.y=e.clientY-_panStart.y; applyTransform(); }
    });

    svg.addEventListener('mouseup',async e=>{
      if (_conn) {
        const nodeEl=e.target.closest('.fta-node');
        const fromId=_conn.fromId; _conn=null; renderPendingConn();
        if (nodeEl&&nodeEl.dataset.id!==fromId) await createConn(fromId,nodeEl.dataset.id);
        return;
      }
      if (_drag) {
        await Promise.all(_drag.origins.map(async({id})=>{ const n=byId(id); if(n) await autosave(id,{x:n.x,y:n.y}); }));
        _drag=null;
      }
      if (_lasso) {
        const lx1=Math.min(_lasso.x1,_lasso.x2), lx2=Math.max(_lasso.x1,_lasso.x2);
        const ly1=Math.min(_lasso.y1,_lasso.y2), ly2=Math.max(_lasso.y1,_lasso.y2);
        if (lx2-lx1>5||ly2-ly1>5) {
          _nodes.forEach(n=>{ if(n.x>=lx1&&n.x<=lx2&&n.y>=ly1&&n.y<=ly2) _selSet.add(n.id); });
        }
        _lasso=null; render();
      }
      _panDrag=false;
    });

    // Dblclick: edit field
    svg.addEventListener('dblclick',e=>{
      const rh=e.target.closest('.fta-row-hit');
      if (rh) { const ne=rh.closest('.fta-node'); if(ne){e.stopPropagation();editField(ne.dataset.id,rh.dataset.field);} return; }
      const gate=e.target.closest('.fta-gate-node');
      if (gate) { e.stopPropagation(); editGate(gate.dataset.id); }
    });
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  function wireKeyboard() {
    const onKey=e=>{
      if (e.target.closest('input,textarea,select')) return;
      if (e.key===' ') { e.preventDefault(); _space=true; document.getElementById('fta-cw').style.cursor='grab'; }
      if (e.key==='Delete'||e.key==='Backspace') deleteSelected();
      if (e.key==='Escape') { _selSet.clear(); render(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==='a') { e.preventDefault(); _nodes.forEach(n=>_selSet.add(n.id)); render(); }
    };
    const onKeyUp=e=>{
      if (e.key===' ') { _space=false; document.getElementById('fta-cw').style.cursor='default'; }
    };
    document.addEventListener('keydown',onKey);
    document.addEventListener('keyup',onKeyUp);
    // Cleanup when container is replaced
    const observer=new MutationObserver(()=>{
      if (!document.contains(container)) { document.removeEventListener('keydown',onKey); document.removeEventListener('keyup',onKeyUp); observer.disconnect(); }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  // ── Connect ──────────────────────────────────────────────────────────────────
  async function createConn(parentId,childId) {
    if (isDescendant(parentId,childId)) { toast('Cycle detected — not connected.','error'); return; }
    const child=byId(childId); if(!child) return;
    child.parent_node_id=parentId;
    await autosave(childId,{parent_node_id:parentId});
    render();
  }
  function isDescendant(nid,ancId) {
    let c=byId(nid); const seen=new Set();
    while(c?.parent_node_id){ if(seen.has(c.id))break; seen.add(c.id); if(c.parent_node_id===ancId)return true; c=byId(c.parent_node_id); }
    return false;
  }

  // ── Add node ─────────────────────────────────────────────────────────────────
  async function addNode(type) {
    const t=NT[type]||NT.basic;
    const wrap=document.getElementById('fta-cw');
    const cx=(wrap.offsetWidth/2-_pan.x)/_zoom + (_nodes.length%5)*18-36;
    const cy=(wrap.offsetHeight/2-_pan.y)/_zoom + (_nodes.length%5)*18-36;
    const code=nextCode(type);
    const {data,error}=await sb.from('fta_nodes').insert({
      parent_type:parentType, parent_id:parentId, project_id:project.id,
      type, label:t.label, component:'', fta_code:code,
      x:cx, y:cy, sort_order:_nodes.length, color:'',
    }).select().single();
    if (error){toast('Error adding node.','error');return;}
    _nodes.push(data);
    _selSet.clear(); _selSet.add(data.id);
    render();
    document.getElementById('fta-hint').style.display='none';
  }

  // ── Edit field ───────────────────────────────────────────────────────────────
  function editField(id, field) {
    const n=byId(id); if(!n) return;
    const wrap=document.getElementById('fta-cw');
    wrap.querySelector('.fta-label-input')?.remove();
    const BH=boxH(), hw=BOX_W/2, hh=BH/2;
    let rowY, rowH;
    if (field==='fta_code')   { rowY=-hh; rowH=ROW_CODE; }
    else if (field==='component') { rowY=-hh+ROW_CODE; rowH=ROW_STD; }
    else if (field==='label') { rowY=-hh+ROW_CODE+ROW_STD; rowH=ROW_STD; }
    else { // numeric fields
      const rowDefs=[
        _cfg.showProbability&&{f:'probability', y:-hh+ROW_CODE+ROW_STD*2,            h:ROW_EXTRA},
        _cfg.showFR         &&{f:'failure_rate', y:-hh+ROW_CODE+ROW_STD*2+ROW_EXTRA*(_cfg.showProbability?1:0), h:ROW_EXTRA},
        _cfg.showMTTR       &&{f:'mttr',         y:-hh+ROW_CODE+ROW_STD*2+ROW_EXTRA*((_cfg.showProbability?1:0)+(_cfg.showFR?1:0)), h:ROW_EXTRA},
      ].filter(Boolean);
      const rd=rowDefs.find(r=>r.f===field);
      if (!rd) return;
      rowY=rd.y; rowH=rd.h;
    }
    const sx=(n.x-hw)*_zoom+_pan.x, sy=(n.y+rowY)*_zoom+_pan.y;
    const inp=document.createElement('input');
    inp.type=field==='probability'||field==='failure_rate'||field==='mttr'?'number':'text';
    if (inp.type==='number'){inp.step='any';inp.min='0';}
    inp.value=n[field]||'';
    inp.className='fta-label-input';
    inp.style.cssText=`left:${sx}px;top:${sy}px;width:${BOX_W*_zoom}px;height:${rowH*_zoom}px;font-size:${Math.max(9,10*_zoom)}px`;
    wrap.appendChild(inp); inp.focus(); inp.select();
    const commit=async()=>{
      let v=inp.value.trim(); inp.remove();
      if (inp.type==='number') v=v===''?null:parseFloat(v);
      if (v===(n[field]??'')) {render();return;}
      n[field]=v; await autosave(id,{[field]:v}); render();
    };
    inp.addEventListener('blur',commit);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter')inp.blur(); if(e.key==='Escape'){inp.value=n[field]||'';inp.blur();} });
  }

  function editGate(id) {
    const n=byId(id);if(!n)return;
    const t=NT[n.type];if(!t)return;
    const wrap=document.getElementById('fta-cw');
    wrap.querySelector('.fta-label-input')?.remove();
    const gw=t.gw||74,gh=t.gh||62;
    const sx=(n.x-gw/2)*_zoom+_pan.x, sy=(n.y-gh/2)*_zoom+_pan.y;
    const inp=document.createElement('input'); inp.type='text'; inp.value=n.label||t.label;
    inp.className='fta-label-input';
    inp.style.cssText=`left:${sx}px;top:${sy}px;width:${gw*_zoom}px;height:${gh*_zoom}px;font-size:${Math.max(10,13*_zoom)}px;font-weight:700`;
    wrap.appendChild(inp); inp.focus(); inp.select();
    const commit=async()=>{const v=inp.value.trim()||t.label;inp.remove();if(v===n.label)return;n.label=v;await autosave(id,{label:v});render();};
    inp.addEventListener('blur',commit);
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=n.label||t.label;inp.blur();}});
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteSelected() {
    if (!_selSet.size) return;
    const ids=[..._selSet];
    const names=ids.map(id=>byId(id)?.fta_code||'node').join(', ');
    if (!confirm(`Delete ${ids.length} node(s): ${names}?`)) return;
    for (const id of ids) {
      _nodes.filter(c=>c.parent_node_id===id).forEach(c=>{c.parent_node_id=null; autosave(c.id,{parent_node_id:null});});
      await sb.from('fta_nodes').delete().eq('id',id);
    }
    _nodes=_nodes.filter(n=>!ids.includes(n.id));
    _selSet.clear(); render();
  }

  function updateDelBtn() {
    const b=document.getElementById('fta-btn-del'); if(b) b.disabled=!_selSet.size;
    // Sync colour picker to first selected
    const inp=document.getElementById('fta-color-inp');
    if (inp&&_selSet.size) { const n=byId([..._selSet][0]); if(n?.color?.startsWith('#')) inp.value=n.color; }
  }

  // ── Auto layout ───────────────────────────────────────────────────────────────
  async function autoLayout() {
    if (!_nodes.length) return;
    const ch=Object.fromEntries(_nodes.map(n=>[n.id,[]]));
    _nodes.forEach(n=>{if(n.parent_node_id&&ch[n.parent_node_id])ch[n.parent_node_id].push(n);});
    const ids=new Set(_nodes.map(n=>n.id));
    const roots=_nodes.filter(n=>!n.parent_node_id||!ids.has(n.parent_node_id));
    if (!roots.length) roots.push(_nodes[0]);
    const NW=220,GAP=70;
    function lay(n,sx,d){ n.y=80+d*LEVEL_H; const kids=ch[n.id]||[]; if(!kids.length){n.x=sx+NW/2;return NW;} let cx=sx; kids.forEach((k,i)=>{const w=lay(k,cx,d+1);cx+=w+(i<kids.length-1?GAP:0);}); n.x=(kids[0].x+kids[kids.length-1].x)/2; return Math.max(NW,cx-sx); }
    let cx=80; roots.forEach(r=>{const w=lay(r,cx,0);cx+=w+GAP*2;});
    await Promise.all(_nodes.map(n=>autosave(n.id,{x:n.x,y:n.y})));
    render(); toast('Layout applied.','success');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function toSvg(e){ const wrap=document.getElementById('fta-cw'),rect=wrap.getBoundingClientRect(); return{x:(e.clientX-rect.left-_pan.x)/_zoom,y:(e.clientY-rect.top-_pan.y)/_zoom}; }
  function setZoom(z){ _zoom=Math.min(3,Math.max(0.15,z));applyTransform(); }

  async function autosave(id,fields){
    const{error}=await sb.from('fta_nodes').update({...fields,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)toast('Autosave failed.','error');
  }
}
