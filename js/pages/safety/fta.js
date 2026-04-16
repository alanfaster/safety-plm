/**
 * FTA — Fault Tree Analysis
 *
 * SVG canvas editor:
 *  • Drag nodes to reposition (auto-saved on drop)
 *  • Pan by dragging the background; zoom with scroll wheel
 *  • Toolbar: add node types, connect mode, delete, auto-layout
 *  • Connect mode: click child node → click parent node → edge created
 *  • Double-click any node to edit its label in-place
 *
 * DB table: fta_nodes (id, parent_type, parent_id, project_id,
 *            type, label, x, y, parent_node_id)
 */

import { sb } from '../../config.js';
import { toast } from '../../toast.js';

// ── Node type config ───────────────────────────────────────────────────────────
const T = {
  top_event:    { label:'Top Event',    fill:'#FFEBE6', stroke:'#DE350B', sw:3, shape:'rect',    tw:160, th:56 },
  intermediate: { label:'Intermediate', fill:'#FFFAE6', stroke:'#E37400', sw:2, shape:'rect',    tw:148, th:50 },
  gate_and:     { label:'AND',          fill:'#E3FCEF', stroke:'#1E8E3E', sw:2, shape:'gate_and',tw:72,  th:58 },
  gate_or:      { label:'OR',           fill:'#DEEBFF', stroke:'#1A73E8', sw:2, shape:'gate_or', tw:72,  th:58 },
  gate_not:     { label:'NOT',          fill:'#F3F0FF', stroke:'#8B00D0', sw:2, shape:'circle',  tw:64,  th:64 },
  gate_inhibit: { label:'INHIBIT',      fill:'#FEF3E2', stroke:'#E37400', sw:2, shape:'hexagon', tw:80,  th:58 },
  basic:        { label:'Basic Event',  fill:'#E3FCEF', stroke:'#1E8E3E', sw:2, shape:'circle',  tw:100, th:56 },
  undeveloped:  { label:'Undeveloped',  fill:'#F4F5F7', stroke:'#6B778C', sw:2, shape:'diamond', tw:80,  th:56 },
  transfer:     { label:'Transfer',     fill:'#DEEBFF', stroke:'#1A73E8', sw:2, shape:'triangle',tw:68,  th:60 },
};

// SVG shape path helpers (centered at 0,0)
function gateAndPath(hw, hh) {
  return `M ${-hw},${hh} L ${hw},${hh} L ${hw},0 Q ${hw},${-hh} 0,${-hh} Q ${-hw},${-hh} ${-hw},0 Z`;
}
function gateOrPath(hw, hh) {
  return `M ${-hw},${hh} Q 0,${hh*0.4} ${hw},${hh} Q ${hw*0.7},0 ${hw},${-hh} Q 0,${-hh*0.5} ${-hw},${-hh} Q ${-hw*0.7},0 ${-hw},${hh} Z`;
}
function diamondPath(hw, hh) {
  return `M 0,${-hh} L ${hw},0 L 0,${hh} L ${-hw},0 Z`;
}
function hexagonPath(hw, hh) {
  const f = hw * 0.35;
  return `M ${-f},${-hh} L ${f},${-hh} L ${hw},0 L ${f},${hh} L ${-f},${hh} L ${-hw},0 Z`;
}
function trianglePath(hw, hh) {
  return `M 0,${-hh} L ${hw},${hh} L ${-hw},${hh} Z`;
}

// ── Layout constants ───────────────────────────────────────────────────────────
const LEVEL_H = 130;
const H_GAP   = 55;
const NODE_W  = 140;

// ── Main render function ───────────────────────────────────────────────────────
export async function renderFTA(container, { project, item, system, parentType, parentId }) {

  // Module state
  let _nodes     = [];
  let _sel       = null;   // selected node id
  let _drag      = null;   // { id, ox, oy, mx, my }
  let _pan       = { x: 80, y: 60 };
  let _zoom      = 1;
  let _panDrag   = false;
  let _panStart  = null;
  let _connMode  = false;
  let _connFrom  = null;   // first-clicked node in connect mode

  // ── Shell ────────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="fta-wrap">
      <div class="fta-toolbar">
        <span class="fta-toolbar-section">Events</span>
        <button class="btn btn-sm fta-add-btn" data-type="top_event"   title="Top undesired event">⬛ Top Event</button>
        <button class="btn btn-sm fta-add-btn" data-type="intermediate" title="Intermediate event">▭ Intermediate</button>
        <button class="btn btn-sm fta-add-btn" data-type="basic"       title="Basic causal event">● Basic</button>
        <button class="btn btn-sm fta-add-btn" data-type="undeveloped" title="Event not further developed">◇ Undeveloped</button>
        <button class="btn btn-sm fta-add-btn" data-type="transfer"    title="Transfer to sub-tree">△ Transfer</button>
        <span class="fta-toolbar-sep"></span>
        <span class="fta-toolbar-section">Gates</span>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_and"    title="AND gate — all inputs must occur">∧ AND</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_or"     title="OR gate — any input triggers output">∨ OR</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_not"    title="NOT gate">¬ NOT</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_inhibit" title="INHIBIT gate">⌀ INHIBIT</button>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm fta-btn-conn" id="fta-btn-conn" title="Connect: click child then parent">⤳ Connect</button>
        <button class="btn btn-sm btn-danger"   id="fta-btn-del"  title="Delete selected node" disabled>✕ Delete</button>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm"              id="fta-btn-layout" title="Auto-layout tree">⟳ Layout</button>
        <button class="btn btn-sm"              id="fta-btn-zi"  title="Zoom in">＋</button>
        <button class="btn btn-sm"              id="fta-btn-zo"  title="Zoom out">－</button>
        <button class="btn btn-sm"              id="fta-btn-zr"  title="Reset view">⊡</button>
      </div>
      <div class="fta-canvas-wrap" id="fta-canvas-wrap">
        <svg id="fta-svg" class="fta-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 Z" fill="#97A0AF"/>
            </marker>
            <marker id="arr-sel" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 Z" fill="#1A73E8"/>
            </marker>
          </defs>
          <g id="fta-root">
            <g id="fta-conns"></g>
            <g id="fta-nodes-g"></g>
          </g>
        </svg>
        <div class="fta-hint" id="fta-hint">
          Click <strong>⬛ Top Event</strong> to start · Drag nodes · Double-click to edit · <strong>⤳ Connect</strong> to link
        </div>
      </div>
    </div>`;

  await loadNodes();
  render();
  wireToolbar();
  wireCanvas();

  // ── Data ─────────────────────────────────────────────────────────────────────
  async function loadNodes() {
    const { data, error } = await sb.from('fta_nodes')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('sort_order', { ascending: true });
    if (error) { toast('Error loading FTA.', 'error'); return; }
    _nodes = data || [];
    if (_nodes.length) document.getElementById('fta-hint').style.display = 'none';
  }

  function byId(id) { return _nodes.find(n => n.id === id); }

  // ── Render ────────────────────────────────────────────────────────────────────
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
      const tp = T[p.type] || T.basic;
      const tc = T[n.type]  || T.basic;
      const x1 = p.x, y1 = p.y + tp.th / 2;
      const x2 = n.x, y2 = n.y - tc.th / 2;
      const mid = (y1 + y2) / 2;
      const isSel = (_sel === n.id || _sel === p.id);
      const path = svgEl('path');
      path.setAttribute('d', `M ${x1},${y1} C ${x1},${mid} ${x2},${mid} ${x2},${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', isSel ? '#1A73E8' : '#97A0AF');
      path.setAttribute('stroke-width', isSel ? '2.5' : '1.8');
      path.setAttribute('marker-end', isSel ? 'url(#arr-sel)' : 'url(#arr)');
      layer.appendChild(path);
    });
  }

  function renderNodeEls() {
    const layer = document.getElementById('fta-nodes-g');
    layer.innerHTML = '';
    _nodes.forEach(n => layer.appendChild(buildNode(n)));
  }

  function buildNode(n) {
    const t = T[n.type] || T.basic;
    const sel = _sel === n.id;
    const connSrc = _connMode && _connFrom === n.id;
    const hw = t.tw / 2, hh = t.th / 2;

    const g = svgEl('g');
    g.setAttribute('class', `fta-node${sel ? ' fta-sel' : ''}${_connMode ? ' fta-conn-mode' : ''}`);
    g.setAttribute('data-id', n.id);
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.style.cursor = _connMode ? 'crosshair' : 'grab';

    // Outer glow for selected or connect source
    if (sel || connSrc) {
      const glow = svgShape(t.shape, hw + 5, hh + 5);
      glow.setAttribute('fill', 'none');
      glow.setAttribute('stroke', connSrc ? '#FF8B00' : '#1A73E8');
      glow.setAttribute('stroke-width', '3');
      glow.setAttribute('opacity', '0.5');
      if (connSrc) glow.setAttribute('stroke-dasharray', '6,3');
      g.appendChild(glow);
    }

    // Double border for top_event
    if (n.type === 'top_event') {
      const outer = svgShape('rect', hw + 6, hh + 6);
      outer.setAttribute('fill', 'none');
      outer.setAttribute('stroke', t.stroke);
      outer.setAttribute('stroke-width', '1.5');
      g.appendChild(outer);
    }

    // Main shape
    const shape = svgShape(t.shape, hw, hh);
    shape.setAttribute('fill', t.fill);
    shape.setAttribute('stroke', t.stroke);
    shape.setAttribute('stroke-width', sel ? t.sw + 1 : t.sw);
    shape.setAttribute('filter', sel ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))' : '');
    g.appendChild(shape);

    // Label text
    const label = n.label || t.label;
    const lines = wrapText(label, t.tw - 12, n.type.startsWith('gate') ? 13 : 12);
    const textEl = svgEl('text');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'middle');
    textEl.setAttribute('font-size', n.type.startsWith('gate') ? '13' : '11.5');
    textEl.setAttribute('font-weight', n.type.startsWith('gate') ? '700' : '500');
    textEl.setAttribute('font-family', '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
    textEl.setAttribute('fill', '#172B4D');
    textEl.setAttribute('pointer-events', 'none');
    if (lines.length === 1) {
      textEl.setAttribute('y', 0);
      textEl.textContent = lines[0];
    } else {
      const lineH = 13;
      const startY = -((lines.length - 1) * lineH) / 2;
      lines.forEach((l, i) => {
        const ts = svgEl('tspan');
        ts.setAttribute('x', 0);
        ts.setAttribute('y', startY + i * lineH);
        ts.textContent = l;
        textEl.appendChild(ts);
      });
    }
    g.appendChild(textEl);

    return g;
  }

  function svgShape(shape, hw, hh) {
    let el;
    if (shape === 'rect') {
      el = svgEl('rect');
      el.setAttribute('x', -hw); el.setAttribute('y', -hh);
      el.setAttribute('width', hw * 2); el.setAttribute('height', hh * 2);
      el.setAttribute('rx', '5');
    } else if (shape === 'circle') {
      el = svgEl('ellipse');
      el.setAttribute('cx', 0); el.setAttribute('cy', 0);
      el.setAttribute('rx', hw); el.setAttribute('ry', hh);
    } else if (shape === 'gate_and') {
      el = svgEl('path');
      el.setAttribute('d', gateAndPath(hw, hh));
    } else if (shape === 'gate_or') {
      el = svgEl('path');
      el.setAttribute('d', gateOrPath(hw, hh));
    } else if (shape === 'diamond') {
      el = svgEl('path');
      el.setAttribute('d', diamondPath(hw, hh));
    } else if (shape === 'hexagon') {
      el = svgEl('path');
      el.setAttribute('d', hexagonPath(hw, hh));
    } else if (shape === 'triangle') {
      el = svgEl('path');
      el.setAttribute('d', trianglePath(hw, hh));
    } else {
      el = svgEl('rect');
      el.setAttribute('x', -hw); el.setAttribute('y', -hh);
      el.setAttribute('width', hw * 2); el.setAttribute('height', hh * 2);
      el.setAttribute('rx', '5');
    }
    return el;
  }

  function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  // Simple text wrapper: splits label into lines that fit within maxW px
  function wrapText(text, maxW, fontSize) {
    const approxCharW = fontSize * 0.58;
    const charsPerLine = Math.floor(maxW / approxCharW);
    if (text.length <= charsPerLine) return [text];
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
      if ((cur + ' ' + w).trim().length > charsPerLine && cur) {
        lines.push(cur.trim()); cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    });
    if (cur) lines.push(cur.trim());
    return lines.slice(0, 3); // max 3 lines
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────────
  function wireToolbar() {
    container.querySelectorAll('.fta-add-btn').forEach(btn =>
      btn.addEventListener('click', () => addNode(btn.dataset.type)));

    document.getElementById('fta-btn-del').addEventListener('click', deleteSelected);
    document.getElementById('fta-btn-layout').addEventListener('click', autoLayout);
    document.getElementById('fta-btn-zi').addEventListener('click', () => adjustZoom(1.2));
    document.getElementById('fta-btn-zo').addEventListener('click', () => adjustZoom(0.83));
    document.getElementById('fta-btn-zr').addEventListener('click', resetView);

    document.getElementById('fta-btn-conn').addEventListener('click', toggleConnMode);
  }

  function toggleConnMode() {
    _connMode = !_connMode;
    _connFrom = null;
    const btn = document.getElementById('fta-btn-conn');
    btn.classList.toggle('active', _connMode);
    btn.textContent = _connMode ? '✕ Cancel' : '⤳ Connect';
    if (_connMode) toast('Click the CHILD node first, then the PARENT.', 'info');
    render();
  }

  // ── Canvas events ─────────────────────────────────────────────────────────────
  function wireCanvas() {
    const wrap = document.getElementById('fta-canvas-wrap');
    const svg  = document.getElementById('fta-svg');

    // Zoom on wheel
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = { x: (mx - _pan.x) / _zoom, y: (my - _pan.y) / _zoom };
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      _zoom = clampZoom(_zoom * factor);
      _pan.x = mx - before.x * _zoom;
      _pan.y = my - before.y * _zoom;
      applyTransform();
    }, { passive: false });

    svg.addEventListener('mousedown', e => {
      const nodeEl = e.target.closest('.fta-node');
      if (nodeEl) {
        const id = nodeEl.dataset.id;
        if (_connMode) {
          handleConnect(id);
        } else {
          const n = byId(id); if (!n) return;
          _sel = id;
          const pt = toSvgCoords(e);
          _drag = { id, ox: n.x, oy: n.y, mx: pt.x, my: pt.y };
          render();
          updateDelBtn();
        }
        e.stopPropagation();
      } else {
        // Background pan
        if (!_connMode) {
          _panDrag = true;
          _panStart = { x: e.clientX - _pan.x, y: e.clientY - _pan.y };
          _sel = null;
          render();
          updateDelBtn();
        }
      }
    });

    svg.addEventListener('mousemove', e => {
      if (_drag) {
        const pt = toSvgCoords(e);
        const n = byId(_drag.id); if (!n) return;
        n.x = _drag.ox + (pt.x - _drag.mx);
        n.y = _drag.oy + (pt.y - _drag.my);
        render();
      } else if (_panDrag) {
        _pan.x = e.clientX - _panStart.x;
        _pan.y = e.clientY - _panStart.y;
        applyTransform();
      }
    });

    svg.addEventListener('mouseup', async () => {
      if (_drag) {
        const n = byId(_drag.id);
        if (n) await autosave(n.id, { x: n.x, y: n.y });
        _drag = null;
      }
      _panDrag = false;
    });

    svg.addEventListener('dblclick', e => {
      const nodeEl = e.target.closest('.fta-node');
      if (nodeEl) { editLabel(nodeEl.dataset.id); e.stopPropagation(); }
    });

    // Touch support — pan only
    let lastTouch = null;
    wrap.addEventListener('touchstart', e => {
      if (e.touches.length === 1) lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    wrap.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && lastTouch) {
        const dx = e.touches[0].clientX - lastTouch.x;
        const dy = e.touches[0].clientY - lastTouch.y;
        _pan.x += dx; _pan.y += dy;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        applyTransform();
      }
    }, { passive: true });
  }

  function toSvgCoords(e) {
    const wrap = document.getElementById('fta-canvas-wrap');
    const rect = wrap.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - _pan.x) / _zoom,
      y: (e.clientY - rect.top  - _pan.y) / _zoom,
    };
  }

  function clampZoom(z) { return Math.min(3, Math.max(0.15, z)); }
  function adjustZoom(factor) { _zoom = clampZoom(_zoom * factor); applyTransform(); }
  function resetView() { _zoom = 1; _pan = { x: 80, y: 60 }; applyTransform(); }

  // ── Connect mode ──────────────────────────────────────────────────────────────
  async function handleConnect(id) {
    if (!_connFrom) {
      _connFrom = id;
      render();
      toast('Now click the PARENT node.', 'info');
    } else {
      if (_connFrom === id) { _connFrom = null; render(); return; }
      const child = byId(_connFrom);
      if (!child) return;
      // Prevent cycles: parent cannot be a descendant of child
      if (isDescendant(id, _connFrom)) {
        toast('Cannot connect: would create a cycle.', 'error');
        _connFrom = null; render(); return;
      }
      child.parent_node_id = id;
      await autosave(child.id, { parent_node_id: id });
      toast('Connected.', 'success');
      // Exit connect mode
      _connMode = false; _connFrom = null;
      const btn = document.getElementById('fta-btn-conn');
      btn.classList.remove('active');
      btn.textContent = '⤳ Connect';
      render();
    }
  }

  // Returns true if `candidateId` is a descendant of `ancestorId`
  function isDescendant(candidateId, ancestorId) {
    let cur = byId(candidateId);
    const visited = new Set();
    while (cur && cur.parent_node_id) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      if (cur.parent_node_id === ancestorId) return true;
      cur = byId(cur.parent_node_id);
    }
    return false;
  }

  // ── Add node ──────────────────────────────────────────────────────────────────
  async function addNode(type) {
    const t = T[type] || T.basic;
    const wrap = document.getElementById('fta-canvas-wrap');
    const cx = (wrap.offsetWidth  / 2 - _pan.x) / _zoom;
    const cy = (wrap.offsetHeight / 2 - _pan.y) / _zoom;
    // Spread new nodes so they don't all pile on top of each other
    const offset = (_nodes.length % 6) * 30 - 75;
    const { data, error } = await sb.from('fta_nodes').insert({
      parent_type: parentType, parent_id: parentId, project_id: project.id,
      type, label: t.label,
      x: cx + offset, y: cy + offset,
      sort_order: _nodes.length,
    }).select().single();
    if (error) { toast('Error adding node.', 'error'); return; }
    _nodes.push(data);
    _sel = data.id;
    render();
    updateDelBtn();
    // Open label editor immediately
    setTimeout(() => editLabel(data.id), 80);
  }

  // ── Edit label ────────────────────────────────────────────────────────────────
  function editLabel(id) {
    const n = byId(id); if (!n) return;
    const t = T[n.type] || T.basic;
    const wrap = document.getElementById('fta-canvas-wrap');
    // Remove any existing editor
    wrap.querySelector('.fta-label-input')?.remove();

    const sx = n.x * _zoom + _pan.x;
    const sy = n.y * _zoom + _pan.y;
    const w  = t.tw * _zoom;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = n.label;
    inp.className = 'fta-label-input';
    inp.style.cssText = `left:${sx - w/2}px;top:${sy - 15}px;width:${w}px;font-size:${Math.max(11, 12 * _zoom)}px`;
    wrap.appendChild(inp);
    inp.focus(); inp.select();

    const commit = async () => {
      const v = inp.value.trim() || n.label;
      inp.remove();
      if (v === n.label) return;
      n.label = v;
      await autosave(id, { label: v });
      render();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') { inp.value = n.label; inp.blur(); }
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function deleteSelected() {
    if (!_sel) return;
    const n = byId(_sel); if (!n) return;
    const childCount = _nodes.filter(c => c.parent_node_id === _sel).length;
    if (!confirm(`Delete "${n.label}"${childCount ? ` and detach ${childCount} child(ren)?` : ''}?`)) return;
    // Detach children
    for (const c of _nodes.filter(x => x.parent_node_id === _sel)) {
      c.parent_node_id = null;
      await autosave(c.id, { parent_node_id: null });
    }
    await sb.from('fta_nodes').delete().eq('id', _sel);
    _nodes = _nodes.filter(x => x.id !== _sel);
    _sel = null;
    render(); updateDelBtn();
    toast('Node deleted.', 'success');
  }

  function updateDelBtn() {
    const btn = document.getElementById('fta-btn-del');
    if (btn) btn.disabled = !_sel;
  }

  // ── Auto layout ───────────────────────────────────────────────────────────────
  async function autoLayout() {
    if (!_nodes.length) return;

    // Build children map
    const children = Object.fromEntries(_nodes.map(n => [n.id, []]));
    _nodes.forEach(n => { if (n.parent_node_id && children[n.parent_node_id]) children[n.parent_node_id].push(n); });

    // Find roots (no parent, or parent not in this tree)
    const ids = new Set(_nodes.map(n => n.id));
    const roots = _nodes.filter(n => !n.parent_node_id || !ids.has(n.parent_node_id));
    if (!roots.length) roots.push(_nodes[0]);

    // Recursive subtree layout — returns width used
    function layoutTree(n, startX, depth) {
      const kids = children[n.id] || [];
      n.y = 80 + depth * LEVEL_H;
      if (!kids.length) {
        n.x = startX + NODE_W / 2;
        return NODE_W;
      }
      let curX = startX;
      kids.forEach((k, i) => {
        const w = layoutTree(k, curX, depth + 1);
        curX += w + (i < kids.length - 1 ? H_GAP : 0);
      });
      const span = curX - startX;
      n.x = kids[0].x + (kids[kids.length - 1].x - kids[0].x) / 2;
      return Math.max(NODE_W, span);
    }

    let curX = 80;
    roots.forEach((r, i) => {
      const w = layoutTree(r, curX, 0);
      curX += w + H_GAP * 2;
    });

    await Promise.all(_nodes.map(n => autosave(n.id, { x: n.x, y: n.y })));
    render();
    toast('Layout applied.', 'success');
  }

  // ── Persistence ───────────────────────────────────────────────────────────────
  async function autosave(id, fields) {
    const { error } = await sb.from('fta_nodes')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast('Autosave failed.', 'error');
  }
}
