/**
 * FTA — Fault Tree Analysis  (v2)
 *
 * Node layout:
 *   Event nodes (top_event, intermediate, basic, undeveloped):
 *     ┌──────────────────┐
 *     │ BE-01            │  ← fta_code  (editable, dblclick)
 *     ├──────────────────┤
 *     │ ECU              │  ← component (editable, dblclick)
 *     ├──────────────────┤
 *     │ Signal loss      │  ← label     (editable, dblclick)
 *     └──────────────────┘
 *           ●  or ◇       ← shape indicator below box (basic/undeveloped)
 *
 *   Gate nodes (gate_and, gate_or, gate_not, gate_inhibit):
 *     Standard IEC 61025 gate shapes.
 *
 * Connections:
 *   Hover a node → green port dot appears at bottom centre.
 *   Drag from port to another node → child.parent_node_id = parent.id.
 *   No "Connect" button needed.
 */

import { sb } from '../../config.js';
import { toast } from '../../toast.js';

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Node config ────────────────────────────────────────────────────────────────
const BOX_W = 186, BOX_H = 81;       // event box
const ROW1  = 21;                     // code row height
const ROW2  = 30;                     // component row height
// ROW3 = BOX_H - ROW1 - ROW2 = 30   // label/failure row height

const NT = {
  top_event:    { label:'Top Event',    stroke:'#C5221F', sw:3, fill:'#FFF5F5', codeColor:'#FDE8E8', indicator:null   },
  intermediate: { label:'Intermediate', stroke:'#E37400', sw:2, fill:'#FFFBF0', codeColor:'#FEF3E2', indicator:null   },
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

function isGate(type) { return type?.startsWith('gate'); }
function nw(n) { return isGate(n.type) ? (NT[n.type]?.gw||74) : BOX_W; }
function nh(n) { return isGate(n.type) ? (NT[n.type]?.gh||62) : BOX_H; }

// IEC 61025 gate path helpers (centred at 0,0)
function andPath(hw, hh) {
  // flat bottom, semicircular dome top
  return `M ${-hw},${hh} L ${hw},${hh} L ${hw},0 A ${hw},${hw} 0 0,0 ${-hw},0 Z`;
}
function orPath(hw, hh) {
  // concave base, curved pointed top
  return `M ${-hw},${hh} Q 0,${hh*0.3} ${hw},${hh} Q ${hw*0.85},0 0,${-hh} Q ${-hw*0.85},0 ${-hw},${hh} Z`;
}
function hexPath(hw, hh) {
  const f = hw*0.38;
  return `M ${-f},${-hh} L ${f},${-hh} L ${hw},0 L ${f},${hh} L ${-f},${hh} L ${-hw},0 Z`;
}
function triPath(hw, hh) {
  return `M 0,${-hh} L ${hw},${hh} L ${-hw},${hh} Z`;
}

// ── Layout ────────────────────────────────────────────────────────────────────
const LEVEL_H = 150, H_GAP = 60;

// ── Main ──────────────────────────────────────────────────────────────────────
export async function renderFTA(container, { project, item, system, parentType, parentId }) {

  let _nodes    = [];
  let _sel      = null;
  let _drag     = null;  // { id, ox, oy, mx, my }
  let _conn     = null;  // { fromId, curX, curY }   pending-connection drag
  let _pan      = { x:100, y:70 };
  let _zoom     = 1;
  let _panDrag  = false;
  let _panStart = null;

  // ── Shell ──────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="fta-wrap">
      <div class="fta-toolbar">
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
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_inhibit">⊘ INHIBIT</button>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm btn-danger" id="fta-btn-del" disabled>✕ Delete</button>
        <button class="btn btn-sm"            id="fta-btn-layout">⟳ Layout</button>
        <button class="btn btn-sm"            id="fta-btn-zi">＋</button>
        <button class="btn btn-sm"            id="fta-btn-zo">－</button>
        <button class="btn btn-sm"            id="fta-btn-zr">⊡</button>
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
            <g id="fta-nodes-g"></g>
          </g>
        </svg>
        <div class="fta-hint" id="fta-hint">Click a node type above to start · Drag from the <span style="color:#1E8E3E">●</span> port to connect</div>
      </div>
    </div>`;

  await loadNodes();
  render();
  wireToolbar();
  wireCanvas();

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadNodes() {
    const { data, error } = await sb.from('fta_nodes')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order', { ascending: true });
    if (error) { toast('Error loading FTA.', 'error'); return; }
    _nodes = data || [];
    if (_nodes.length) document.getElementById('fta-hint').style.display = 'none';
  }

  function byId(id) { return _nodes.find(n => n.id === id); }

  function nextCode(type) {
    const pfx = CODE_PFX[type] || 'N';
    const existing = _nodes.filter(n => n.type === type && n.fta_code?.startsWith(pfx+'-'));
    const nums = existing.map(n => parseInt(n.fta_code.split('-')[1]||'0')).filter(Boolean);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `${pfx}-${String(next).padStart(2,'0')}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    renderConns();
    renderNodeEls();
    applyTransform();
    document.getElementById('fta-hint').style.display = _nodes.length ? 'none' : '';
  }

  function applyTransform() {
    const g = document.getElementById('fta-root');
    if (g) g.setAttribute('transform', `translate(${_pan.x},${_pan.y}) scale(${_zoom})`);
  }

  function renderConns() {
    const layer = document.getElementById('fta-conns');
    layer.innerHTML = '';
    _nodes.forEach(n => {
      if (!n.parent_node_id) return;
      const p = byId(n.parent_node_id); if (!p) return;
      const x1 = p.x, y1 = p.y + nh(p)/2;
      const x2 = n.x, y2 = n.y - nh(n)/2;
      const my = (y1 + y2) / 2;
      const sel = _sel === n.id || _sel === p.id;
      const el = svgEl('path');
      el.setAttribute('d', `M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', sel ? '#1A73E8' : '#97A0AF');
      el.setAttribute('stroke-width', sel ? '2.5' : '1.8');
      el.setAttribute('marker-end', sel ? 'url(#farrh)' : 'url(#farr)');
      layer.appendChild(el);
    });
  }

  function renderNodeEls() {
    const layer = document.getElementById('fta-nodes-g');
    layer.innerHTML = '';
    _nodes.forEach(n => layer.appendChild(isGate(n.type) ? buildGateNode(n) : buildBoxNode(n)));
  }

  // ── Box node (event types) ────────────────────────────────────────────────
  function buildBoxNode(n) {
    const t  = NT[n.type] || NT.basic;
    const hw = BOX_W/2, hh = BOX_H/2;
    const sel = _sel === n.id;

    const g = svgEl('g');
    g.dataset.id = n.id;
    g.setAttribute('class', `fta-node${sel?' fta-sel':''}`);
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    // Drop shadow for selected
    if (sel) {
      const sh = svgEl('rect');
      sh.setAttribute('x', -hw+2); sh.setAttribute('y', -hh+2);
      sh.setAttribute('width', BOX_W); sh.setAttribute('height', BOX_H);
      sh.setAttribute('rx', '5'); sh.setAttribute('fill', 'rgba(0,0,0,0.12)');
      g.appendChild(sh);
    }

    // Main box
    const box = svgEl('rect');
    box.setAttribute('x', -hw); box.setAttribute('y', -hh);
    box.setAttribute('width', BOX_W); box.setAttribute('height', BOX_H);
    box.setAttribute('rx', '5');
    box.setAttribute('fill', t.fill);
    box.setAttribute('stroke', t.stroke);
    box.setAttribute('stroke-width', sel ? t.sw+1 : t.sw);
    g.appendChild(box);

    // Top event: double border
    if (n.type === 'top_event') {
      const outer = svgEl('rect');
      outer.setAttribute('x', -(hw+4)); outer.setAttribute('y', -(hh+4));
      outer.setAttribute('width', BOX_W+8); outer.setAttribute('height', BOX_H+8);
      outer.setAttribute('rx', '7'); outer.setAttribute('fill', 'none');
      outer.setAttribute('stroke', t.stroke); outer.setAttribute('stroke-width', '1.5');
      g.insertBefore(outer, box);
    }

    // Row 1 background (code row)
    const r1bg = svgEl('rect');
    r1bg.setAttribute('x', -hw+t.sw/2); r1bg.setAttribute('y', -hh+t.sw/2);
    r1bg.setAttribute('width', BOX_W-t.sw); r1bg.setAttribute('height', ROW1-t.sw/2);
    r1bg.setAttribute('rx', '4'); r1bg.setAttribute('ry', '4');
    r1bg.setAttribute('fill', t.codeColor);
    r1bg.setAttribute('pointer-events', 'none');
    g.appendChild(r1bg);
    // clip top-only corners via second rect to cover bottom corners
    const r1bgClip = svgEl('rect');
    r1bgClip.setAttribute('x', -hw+t.sw/2); r1bgClip.setAttribute('y', -hh+t.sw/2 + ROW1-8);
    r1bgClip.setAttribute('width', BOX_W-t.sw); r1bgClip.setAttribute('height', 8);
    r1bgClip.setAttribute('fill', t.codeColor); r1bgClip.setAttribute('pointer-events','none');
    g.appendChild(r1bgClip);

    // Dividers
    [-hh+ROW1, -hh+ROW1+ROW2].forEach(dy => {
      const line = svgEl('line');
      line.setAttribute('x1', -hw); line.setAttribute('y1', dy);
      line.setAttribute('x2',  hw); line.setAttribute('y2', dy);
      line.setAttribute('stroke', t.stroke); line.setAttribute('stroke-width', '0.8');
      line.setAttribute('opacity', '0.4'); line.setAttribute('pointer-events','none');
      g.appendChild(line);
    });

    // Row texts — each row is a separate clickable zone
    addRowText(g, n.fta_code || (n.type === 'top_event' ? 'TE-01' : '?'), -hh + ROW1/2, 10, 700, t.stroke, 'fta_code', -hh, ROW1);
    addRowText(g, n.component || '', -hh + ROW1 + ROW2/2, 11, 400, '#6B778C', 'component', -hh+ROW1, ROW2);
    addRowText(g, n.label || '', -hh + ROW1 + ROW2 + (BOX_H-ROW1-ROW2)/2, 11, 500, '#172B4D', 'label', -hh+ROW1+ROW2, BOX_H-ROW1-ROW2);

    // Shape indicator below box
    if (t.indicator) {
      const ind = buildIndicator(t.indicator, t.stroke);
      ind.setAttribute('transform', `translate(0, ${hh+12})`);
      g.appendChild(ind);
    }

    // Output port (bottom centre)
    g.appendChild(buildPort(n.id, 0, hh + (t.indicator ? 24 : 0), t.stroke));

    return g;
  }

  function addRowText(g, value, cy, fontSize, fontWeight, fill, field, rowY, rowH) {
    // Invisible hit rect for the row
    const hit = svgEl('rect');
    hit.setAttribute('x', -BOX_W/2); hit.setAttribute('y', rowY);
    hit.setAttribute('width', BOX_W); hit.setAttribute('height', rowH);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'fta-row-hit');
    hit.dataset.field = field;
    g.appendChild(hit);

    const text = svgEl('text');
    text.setAttribute('x', 0); text.setAttribute('y', cy);
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', fontSize); text.setAttribute('font-weight', fontWeight);
    text.setAttribute('fill', fill);
    text.setAttribute('font-family', '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
    text.setAttribute('pointer-events', 'none');
    // Truncate if too long
    const maxChars = Math.floor((BOX_W - 16) / (fontSize * 0.58));
    const display = (value && value.length > maxChars) ? value.slice(0, maxChars-1)+'…' : (value || '—');
    text.textContent = display;
    g.appendChild(text);
  }

  function buildIndicator(shape, stroke) {
    const g = svgEl('g');
    g.setAttribute('pointer-events', 'none');
    if (shape === 'circle') {
      const c = svgEl('circle');
      c.setAttribute('cx', 0); c.setAttribute('cy', 0); c.setAttribute('r', 10);
      c.setAttribute('fill', 'white'); c.setAttribute('stroke', stroke); c.setAttribute('stroke-width', '2');
      g.appendChild(c);
    } else if (shape === 'diamond') {
      const p = svgEl('path');
      p.setAttribute('d', `M 0,-10 L 10,0 L 0,10 L -10,0 Z`);
      p.setAttribute('fill', 'white'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', '2');
      g.appendChild(p);
    } else if (shape === 'triangle') {
      const p = svgEl('path');
      p.setAttribute('d', `M 0,-10 L 11,10 L -11,10 Z`);
      p.setAttribute('fill', 'white'); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', '2');
      g.appendChild(p);
    }
    return g;
  }

  // ── Gate node ─────────────────────────────────────────────────────────────
  function buildGateNode(n) {
    const t  = NT[n.type] || NT.gate_and;
    const hw = (t.gw||74)/2, hh = (t.gh||62)/2;
    const sel = _sel === n.id;

    const g = svgEl('g');
    g.dataset.id = n.id;
    g.setAttribute('class', `fta-node fta-gate-node${sel?' fta-sel':''}`);
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    let shape;
    if (n.type === 'gate_and') {
      shape = svgEl('path'); shape.setAttribute('d', andPath(hw, hh));
    } else if (n.type === 'gate_or') {
      shape = svgEl('path'); shape.setAttribute('d', orPath(hw, hh));
    } else if (n.type === 'gate_not') {
      shape = svgEl('ellipse');
      shape.setAttribute('cx', 0); shape.setAttribute('cy', 0);
      shape.setAttribute('rx', hw); shape.setAttribute('ry', hh);
    } else if (n.type === 'gate_inhibit') {
      shape = svgEl('path'); shape.setAttribute('d', hexPath(hw, hh));
    } else {
      shape = svgEl('rect');
      shape.setAttribute('x', -hw); shape.setAttribute('y', -hh);
      shape.setAttribute('width', t.gw); shape.setAttribute('height', t.gh);
      shape.setAttribute('rx', '4');
    }
    shape.setAttribute('fill', t.fill);
    shape.setAttribute('stroke', t.stroke);
    shape.setAttribute('stroke-width', sel ? t.sw+1 : t.sw);
    if (sel) shape.setAttribute('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))');
    g.appendChild(shape);

    const label = svgEl('text');
    label.setAttribute('x', 0); label.setAttribute('y', 2);
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', '13'); label.setAttribute('font-weight', '700');
    label.setAttribute('fill', t.stroke);
    label.setAttribute('font-family', '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
    label.setAttribute('pointer-events', 'none');
    label.textContent = n.label || t.label;
    g.appendChild(label);

    // Output port
    g.appendChild(buildPort(n.id, 0, hh));

    return g;
  }

  // ── Port ──────────────────────────────────────────────────────────────────
  function buildPort(nodeId, px, py, stroke = '#1E8E3E') {
    const g = svgEl('g');
    g.setAttribute('class', 'fta-port');
    g.setAttribute('transform', `translate(${px},${py})`);
    g.dataset.portFor = nodeId;

    const hit = svgEl('circle');
    hit.setAttribute('r', '12'); hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'fta-port-hit');
    g.appendChild(hit);

    const vis = svgEl('circle');
    vis.setAttribute('r', '5');
    vis.setAttribute('fill', '#1E8E3E');
    vis.setAttribute('stroke', '#fff');
    vis.setAttribute('stroke-width', '1.5');
    vis.setAttribute('class', 'fta-port-vis');
    vis.setAttribute('pointer-events', 'none');
    g.appendChild(vis);

    return g;
  }

  // ── Pending connection rubber-band ────────────────────────────────────────
  function renderPendingConn() {
    const layer = document.getElementById('fta-pending');
    layer.innerHTML = '';
    if (!_conn) return;
    const n = byId(_conn.fromId); if (!n) return;
    const x1 = n.x, y1 = n.y + nh(n)/2;
    const x2 = _conn.curX, y2 = _conn.curY;
    const my = (y1 + y2) / 2;
    const line = svgEl('path');
    line.setAttribute('d', `M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#1E8E3E');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6,4');
    line.setAttribute('pointer-events', 'none');
    layer.appendChild(line);

    // Arrow tip
    const tip = svgEl('circle');
    tip.setAttribute('cx', x2); tip.setAttribute('cy', y2);
    tip.setAttribute('r', '4'); tip.setAttribute('fill', '#1E8E3E');
    tip.setAttribute('pointer-events', 'none');
    layer.appendChild(tip);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  function wireToolbar() {
    container.querySelectorAll('.fta-add-btn').forEach(btn =>
      btn.addEventListener('click', () => addNode(btn.dataset.type)));
    document.getElementById('fta-btn-del').addEventListener('click', deleteSelected);
    document.getElementById('fta-btn-layout').addEventListener('click', autoLayout);
    document.getElementById('fta-btn-zi').addEventListener('click', () => setZoom(_zoom * 1.2));
    document.getElementById('fta-btn-zo').addEventListener('click', () => setZoom(_zoom / 1.2));
    document.getElementById('fta-btn-zr').addEventListener('click', () => { _zoom=1; _pan={x:100,y:70}; applyTransform(); });
  }

  // ── Canvas events ─────────────────────────────────────────────────────────
  function wireCanvas() {
    const wrap = document.getElementById('fta-cw');
    const svg  = document.getElementById('fta-svg');

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const bef = { x:(mx-_pan.x)/_zoom, y:(my-_pan.y)/_zoom };
      _zoom = Math.min(3, Math.max(0.15, _zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      _pan.x = mx - bef.x*_zoom; _pan.y = my - bef.y*_zoom;
      applyTransform();
    }, { passive:false });

    svg.addEventListener('mousedown', e => {
      // Port drag → start connection
      const portEl = e.target.closest('.fta-port');
      if (portEl) {
        e.stopPropagation();
        const pt = toSvg(e);
        _conn = { fromId: portEl.dataset.portFor, curX: pt.x, curY: pt.y };
        return;
      }

      // Node → select + drag
      const nodeEl = e.target.closest('.fta-node');
      if (nodeEl) {
        e.stopPropagation();
        const id = nodeEl.dataset.id;
        const n  = byId(id); if (!n) return;
        _sel = id;
        const pt = toSvg(e);
        _drag = { id, ox: n.x, oy: n.y, mx: pt.x, my: pt.y };
        render(); updateDelBtn();
        return;
      }

      // Background → pan + deselect
      _panDrag  = true;
      _panStart = { x: e.clientX - _pan.x, y: e.clientY - _pan.y };
      _sel = null;
      render(); updateDelBtn();
    });

    svg.addEventListener('mousemove', e => {
      if (_conn) {
        const pt = toSvg(e);
        _conn.curX = pt.x; _conn.curY = pt.y;
        renderPendingConn();
        return;
      }
      if (_drag) {
        const pt = toSvg(e);
        const n  = byId(_drag.id); if (!n) return;
        n.x = _drag.ox + (pt.x - _drag.mx);
        n.y = _drag.oy + (pt.y - _drag.my);
        render();
        return;
      }
      if (_panDrag) {
        _pan.x = e.clientX - _panStart.x;
        _pan.y = e.clientY - _panStart.y;
        applyTransform();
      }
    });

    svg.addEventListener('mouseup', async e => {
      if (_conn) {
        const nodeEl = e.target.closest('.fta-node');
        const fromId = _conn.fromId;
        _conn = null;
        renderPendingConn();
        if (nodeEl && nodeEl.dataset.id !== fromId) {
          await createConn(fromId, nodeEl.dataset.id);
        }
        return;
      }
      if (_drag) {
        const n = byId(_drag.id);
        if (n) await autosave(n.id, { x: n.x, y: n.y });
        _drag = null;
      }
      _panDrag = false;
    });

    // Double-click on a row → edit that field
    svg.addEventListener('dblclick', e => {
      const rowHit = e.target.closest('.fta-row-hit');
      if (rowHit) {
        const nodeEl = rowHit.closest('.fta-node');
        if (nodeEl) { e.stopPropagation(); editField(nodeEl.dataset.id, rowHit.dataset.field); }
        return;
      }
      const nodeEl = e.target.closest('.fta-gate-node');
      if (nodeEl) { e.stopPropagation(); editGateLabel(nodeEl.dataset.id); }
    });
  }

  // ── Create connection ─────────────────────────────────────────────────────
  async function createConn(parentId, childId) {
    // parentId = node the port was dragged FROM (the output)
    // childId  = node dropped ON (becomes the child)
    if (isDescendant(parentId, childId)) {
      toast('Cannot connect: would create a cycle.', 'error'); return;
    }
    const child = byId(childId); if (!child) return;
    child.parent_node_id = parentId;
    await autosave(childId, { parent_node_id: parentId });
    render();
    toast('Connected.', 'success');
  }

  function isDescendant(nodeId, ancestorId) {
    let cur = byId(nodeId);
    const seen = new Set();
    while (cur?.parent_node_id) {
      if (seen.has(cur.id)) break; seen.add(cur.id);
      if (cur.parent_node_id === ancestorId) return true;
      cur = byId(cur.parent_node_id);
    }
    return false;
  }

  // ── Add node ──────────────────────────────────────────────────────────────
  async function addNode(type) {
    const t   = NT[type] || NT.basic;
    const wrap = document.getElementById('fta-cw');
    const cx  = (wrap.offsetWidth/2  - _pan.x) / _zoom;
    const cy  = (wrap.offsetHeight/2 - _pan.y) / _zoom + (_nodes.length % 5) * 20 - 40;
    const code = nextCode(type);
    const { data, error } = await sb.from('fta_nodes').insert({
      parent_type: parentType, parent_id: parentId, project_id: project.id,
      type, label: t.label, component: '', fta_code: code,
      x: cx, y: cy, sort_order: _nodes.length,
    }).select().single();
    if (error) { toast('Error adding node.', 'error'); return; }
    _nodes.push(data);
    _sel = data.id;
    render(); updateDelBtn();
  }

  // ── Edit field (box node) ─────────────────────────────────────────────────
  function editField(id, field) {
    const n = byId(id); if (!n) return;
    const wrap = document.getElementById('fta-cw');
    wrap.querySelector('.fta-label-input')?.remove();

    // Compute row Y in screen coords
    const hw = BOX_W/2, hh = BOX_H/2;
    let rowY, rowH;
    if (field === 'fta_code')  { rowY = n.y - hh;          rowH = ROW1; }
    else if (field === 'component') { rowY = n.y - hh + ROW1; rowH = ROW2; }
    else                        { rowY = n.y - hh + ROW1 + ROW2; rowH = BOX_H - ROW1 - ROW2; }

    const sx = (n.x - hw) * _zoom + _pan.x;
    const sy = rowY * _zoom + _pan.y;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = n[field] || '';
    inp.className = 'fta-label-input';
    inp.style.cssText = `left:${sx}px;top:${sy}px;width:${BOX_W*_zoom}px;height:${rowH*_zoom}px;font-size:${Math.max(10,11*_zoom)}px`;
    wrap.appendChild(inp);
    inp.focus(); inp.select();

    const commit = async () => {
      const v = inp.value.trim();
      inp.remove();
      if (v === (n[field]||'')) { render(); return; }
      n[field] = v;
      await autosave(id, { [field]: v });
      render();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') { inp.value = n[field]||''; inp.blur(); }
    });
  }

  function editGateLabel(id) {
    const n = byId(id); if (!n) return;
    const t = NT[n.type]; if (!t) return;
    const wrap = document.getElementById('fta-cw');
    wrap.querySelector('.fta-label-input')?.remove();
    const gw = t.gw||74, gh = t.gh||62;
    const sx = (n.x - gw/2)*_zoom + _pan.x;
    const sy = (n.y - gh/2)*_zoom + _pan.y;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = n.label || t.label;
    inp.className = 'fta-label-input';
    inp.style.cssText = `left:${sx}px;top:${sy}px;width:${gw*_zoom}px;height:${gh*_zoom}px;font-size:${Math.max(10,13*_zoom)}px;font-weight:700`;
    wrap.appendChild(inp);
    inp.focus(); inp.select();
    const commit = async () => {
      const v = inp.value.trim() || t.label;
      inp.remove();
      if (v === n.label) return;
      n.label = v;
      await autosave(id, { label: v });
      render();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') { inp.value = n.label||t.label; inp.blur(); }
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function deleteSelected() {
    if (!_sel) return;
    const n = byId(_sel); if (!n) return;
    const kids = _nodes.filter(c => c.parent_node_id === _sel);
    if (!confirm(`Delete "${n.fta_code || n.label}"${kids.length?` and detach ${kids.length} child(ren)`:''}?`)) return;
    for (const c of kids) { c.parent_node_id = null; await autosave(c.id, { parent_node_id: null }); }
    await sb.from('fta_nodes').delete().eq('id', _sel);
    _nodes = _nodes.filter(x => x.id !== _sel);
    _sel = null; render(); updateDelBtn();
  }

  function updateDelBtn() {
    const b = document.getElementById('fta-btn-del');
    if (b) b.disabled = !_sel;
  }

  // ── Auto layout ───────────────────────────────────────────────────────────
  async function autoLayout() {
    if (!_nodes.length) return;
    const ch = Object.fromEntries(_nodes.map(n=>[n.id,[]]));
    _nodes.forEach(n=>{ if(n.parent_node_id && ch[n.parent_node_id]) ch[n.parent_node_id].push(n); });
    const ids = new Set(_nodes.map(n=>n.id));
    const roots = _nodes.filter(n => !n.parent_node_id || !ids.has(n.parent_node_id));
    if (!roots.length) roots.push(_nodes[0]);
    const NW = 200, GAP = 60;
    function layout(n, startX, depth) {
      n.y = 80 + depth * LEVEL_H;
      const kids = ch[n.id]||[];
      if (!kids.length) { n.x = startX + NW/2; return NW; }
      let curX = startX;
      kids.forEach((k,i) => { const w = layout(k, curX, depth+1); curX += w + (i<kids.length-1?GAP:0); });
      n.x = (kids[0].x + kids[kids.length-1].x) / 2;
      return Math.max(NW, curX - startX);
    }
    let cx = 80;
    roots.forEach(r => { const w = layout(r, cx, 0); cx += w + GAP*2; });
    await Promise.all(_nodes.map(n => autosave(n.id, { x:n.x, y:n.y })));
    render(); toast('Layout applied.', 'success');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function toSvg(e) {
    const wrap = document.getElementById('fta-cw');
    const rect = wrap.getBoundingClientRect();
    return { x:(e.clientX-rect.left-_pan.x)/_zoom, y:(e.clientY-rect.top-_pan.y)/_zoom };
  }
  function setZoom(z) { _zoom = Math.min(3,Math.max(0.15,z)); applyTransform(); }
  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

  async function autosave(id, fields) {
    const { error } = await sb.from('fta_nodes')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) toast('Autosave failed.', 'error');
  }
}
