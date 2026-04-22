/**
 * V-Model Graph Editor
 *
 * Two link types:
 *   'trace'      — bidirectional traceability (dashed blue ↔)
 *                  drives the traceability fields in test-specs / requirements
 *   'sequential' — development flow (solid gray →)
 *                  purely visual; documents refinement / decomposition order
 *
 * Usage: mountVmodelEditor(container, { links, canvasNodes, … })
 */

// ── Node definitions ──────────────────────────────────────────────────────────

export const VMODEL_NODES = [
  { id: 'sys_req',     domain: 'system', phase: 'requirements',        label: 'System Requirements' },
  { id: 'sys_arch',    domain: 'system', phase: 'architecture',        label: 'System Architecture' },
  { id: 'sys_it',      domain: 'system', phase: 'integration_testing', label: 'System Integration Test' },
  { id: 'sys_qt',      domain: 'system', phase: 'system_testing',      label: 'System Qualification Test' },
  { id: 'sw_req',      domain: 'sw',     phase: 'requirements',        label: 'SW Requirements' },
  { id: 'sw_arch',     domain: 'sw',     phase: 'architecture',        label: 'SW Architecture' },
  { id: 'sw_design',   domain: 'sw',     phase: 'design',              label: 'SW Detailed Design' },
  { id: 'sw_impl',     domain: 'sw',     phase: 'implementation',      label: 'SW Units' },
  { id: 'sw_ut',       domain: 'sw',     phase: 'unit_testing',        label: 'Unit Test Spec' },
  { id: 'sw_it',       domain: 'sw',     phase: 'integration_testing', label: 'SW Integration Test Spec' },
  { id: 'sw_qt',       domain: 'sw',     phase: 'system_testing',      label: 'SW Qualification Test Spec' },
  { id: 'hw_req',      domain: 'hw',     phase: 'requirements',        label: 'HW Requirements' },
  { id: 'hw_arch',     domain: 'hw',     phase: 'architecture',        label: 'HW Architecture' },
  { id: 'hw_design',   domain: 'hw',     phase: 'design',              label: 'HW Detailed Design' },
  { id: 'hw_ut',       domain: 'hw',     phase: 'unit_testing',        label: 'HW Test Spec' },
  { id: 'mech_req',    domain: 'mech',   phase: 'requirements',        label: 'MECH Requirements' },
  { id: 'mech_design', domain: 'mech',   phase: 'design',              label: 'MECH Detailed Design' },
];

export const PHASE_DB_SOURCE = {
  requirements:        'requirements',
  architecture:        'arch_spec_items',
  unit_testing:        'test_specs',
  integration_testing: 'test_specs',
  system_testing:      'test_specs',
};

// ── ASPICE SW default ─────────────────────────────────────────────────────────
// Left arm (top-left → bottom-centre): sys_req → sys_arch → sw_req → sw_arch → sw_design → sw_impl
// Right arm (bottom-centre → top-right): sw_ut → sw_it → sw_qt → sys_it → sys_qt
// Horizontal traceability (V-links): sys_req↔sys_qt, sys_arch↔sys_it, sw_req↔sw_qt, sw_arch↔sw_it, sw_design↔sw_ut

const ASPICE_NODES = [
  { nodeId: 'sys_req',    x: 20,  y: 20  },
  { nodeId: 'sys_arch',   x: 90,  y: 95  },
  { nodeId: 'sw_req',     x: 160, y: 170 },
  { nodeId: 'sw_arch',    x: 230, y: 245 },
  { nodeId: 'sw_design',  x: 300, y: 320 },
  { nodeId: 'sw_impl',    x: 390, y: 400 },
  { nodeId: 'sw_ut',      x: 490, y: 320 },
  { nodeId: 'sw_it',      x: 560, y: 245 },
  { nodeId: 'sw_qt',      x: 630, y: 170 },
  { nodeId: 'sys_it',     x: 700, y: 95  },
  { nodeId: 'sys_qt',     x: 770, y: 20  },
];

const ASPICE_LINKS = [
  // ── Traceability (horizontal V-connections) ──
  { from: 'sys_req',   to: 'sys_qt',  type: 'trace' },
  { from: 'sys_arch',  to: 'sys_it',  type: 'trace' },
  { from: 'sw_req',    to: 'sw_qt',   type: 'trace' },
  { from: 'sw_arch',   to: 'sw_it',   type: 'trace' },
  { from: 'sw_design', to: 'sw_ut',   type: 'trace' },
  // ── Sequential (development flow) ──
  { from: 'sys_req',   to: 'sys_arch',  type: 'sequential' },
  { from: 'sys_arch',  to: 'sw_req',    type: 'sequential' },
  { from: 'sw_req',    to: 'sw_arch',   type: 'sequential' },
  { from: 'sw_arch',   to: 'sw_design', type: 'sequential' },
  { from: 'sw_design', to: 'sw_impl',   type: 'sequential' },
  { from: 'sw_impl',   to: 'sw_ut',     type: 'sequential' },
  { from: 'sw_ut',     to: 'sw_it',     type: 'sequential' },
  { from: 'sw_it',     to: 'sw_qt',     type: 'sequential' },
  { from: 'sw_qt',     to: 'sys_it',    type: 'sequential' },
  { from: 'sys_it',    to: 'sys_qt',    type: 'sequential' },
];

// ── Node dimensions ───────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 36;

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountVmodelEditor(wrapper, { links = [], canvasNodes = [], configId, fullConfig, project, sb, toast, onSave }) {

  // ── State ─────────────────────────────────────────────────────────────────
  let _nodes       = [];
  let _links       = [];
  let _mode        = 'select';   // 'select' | 'connect-trace' | 'connect-seq' | 'delete'
  let _connectFrom = null;
  let _drag        = null;
  let _dirty       = false;

  // Init from saved state
  if (canvasNodes.length) {
    _nodes = canvasNodes.map(cn => {
      const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
      return def ? { ...def, x: cn.x, y: cn.y } : null;
    }).filter(Boolean);
  }
  // Backcompat: old links had no `type` — treat as trace
  _links = links.map(l => ({ ...l, type: l.type || 'trace' }));

  // ── HTML ──────────────────────────────────────────────────────────────────
  wrapper.innerHTML = `
    <div class="vme-wrap">
      <div class="vme-toolbar">
        <div class="vme-toolbar-left">
          <button class="btn btn-secondary btn-sm" id="vme-load-aspice" title="Adds ASPICE SW nodes and links — keeps your existing content">↺ Add ASPICE base</button>
          <button class="btn btn-ghost btn-sm" id="vme-clear">Clear</button>
        </div>
        <div class="vme-mode-group" id="vme-modes">
          <button class="vme-mode-btn active" data-mode="select"       title="Drag nodes">↖ Select</button>
          <button class="vme-mode-btn vme-mode-trace" data-mode="connect-trace" title="Add bidirectional traceability link">↔ Traceability</button>
          <button class="vme-mode-btn vme-mode-seq"   data-mode="connect-seq"   title="Add bidirectional sequential link">↔ Sequential</button>
          <button class="vme-mode-btn vme-mode-del"   data-mode="delete"        title="Remove node or link">✕ Delete</button>
        </div>
        <div class="vme-toolbar-right">
          <div class="vme-legend">
            <span class="vme-legend-trace">↔ Traceability</span>
            <span class="vme-legend-seq">↔ Sequential</span>
          </div>
          <button class="btn btn-primary btn-sm" id="vme-save">Save</button>
        </div>
      </div>
      <div class="vme-hint-bar" id="vme-hint">
        Drag nodes from the palette onto the canvas · Select mode active
      </div>
      <div class="vme-body">
        <div class="vme-palette" id="vme-palette">
          <div class="vme-palette-title">Palette</div>
          <div id="vme-pal-list"></div>
        </div>
        <div class="vme-canvas-scroll">
          <div class="vme-canvas" id="vme-canvas">
            <svg class="vme-svg" id="vme-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-trace" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-trace-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-seq" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#666"/>
                </marker>
                <marker id="arr-seq-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#666"/>
                </marker>
                <marker id="arr-del" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#EA4335"/>
                </marker>
                <marker id="arr-del-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#EA4335"/>
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = wrapper.querySelector('#vme-canvas');
  const svg    = wrapper.querySelector('#vme-svg');
  const hint   = wrapper.querySelector('#vme-hint');

  // ── Palette ───────────────────────────────────────────────────────────────
  function refreshPalette() {
    const placed = new Set(_nodes.map(n => n.id));
    const list   = wrapper.querySelector('#vme-pal-list');
    const avail  = VMODEL_NODES.filter(n => !placed.has(n.id));

    if (!avail.length) {
      list.innerHTML = `<p class="vme-pal-empty">All nodes placed.</p>`;
      return;
    }

    const groups = {};
    avail.forEach(n => (groups[n.domain] = groups[n.domain] || []).push(n));
    const domainOrder = ['system', 'sw', 'hw', 'mech'];
    const domainLabel = { system: 'System', sw: 'SW', hw: 'HW', mech: 'MECH' };

    list.innerHTML = domainOrder.filter(d => groups[d]).map(d => `
      <div class="vme-pal-group">
        <div class="vme-pal-group-label">${domainLabel[d]}</div>
        ${groups[d].map(n => `
          <div class="vme-pal-item vme-nd--${n.domain}" draggable="true" data-nodeid="${n.id}">
            ${n.label}
          </div>`).join('')}
      </div>`).join('');

    list.querySelectorAll('.vme-pal-item').forEach(el => {
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', el.dataset.nodeid);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  // ── Canvas drop ───────────────────────────────────────────────────────────
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('text/plain');
    const def    = VMODEL_NODES.find(n => n.id === nodeId);
    if (!def) return;
    const rect = canvas.getBoundingClientRect();
    _nodes.push({ ...def,
      x: Math.max(0, e.clientX - rect.left - NODE_W / 2),
      y: Math.max(0, e.clientY - rect.top  - NODE_H / 2),
    });
    _dirty = true;
    render();
  });

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    refreshPalette();
    renderNodes();
    renderSVG();
  }

  function renderNodes() {
    canvas.querySelectorAll('.vme-node').forEach(el => el.remove());
    _nodes.forEach(node => {
      const div = document.createElement('div');
      div.className   = `vme-node vme-nd--${node.domain}`;
      div.style.left  = node.x + 'px';
      div.style.top   = node.y + 'px';
      div.dataset.nid = node.id;
      div.textContent = node.label;
      if (_connectFrom === node.id) div.classList.add('vme-node--source');
      canvas.appendChild(div);
      wireNode(div, node);
    });
  }

  function wireNode(div, node) {
    const isConnectMode = _mode === 'connect-trace' || _mode === 'connect-seq';

    if (_mode === 'select') {
      div.style.cursor = 'grab';
      div.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        _drag = { nodeId: node.id, offX: e.clientX - rect.left - node.x, offY: e.clientY - rect.top - node.y };
        div.style.cursor = 'grabbing';
        div.classList.add('vme-node--dragging');
      });

    } else if (isConnectMode) {
      div.style.cursor = 'crosshair';
      div.addEventListener('click', e => {
        e.stopPropagation();
        if (!_connectFrom) {
          _connectFrom = node.id;
          setHint(`Source: <strong>${node.label}</strong> — now click the target node · Esc to cancel`);
          render();
        } else if (_connectFrom === node.id) {
          _connectFrom = null;
          setHint(connectHint());
          render();
        } else {
          const linkType = _mode === 'connect-trace' ? 'trace' : 'sequential';
          const from = _connectFrom, to = node.id;
          const dup  = _links.some(l =>
            l.type === linkType &&
            ((l.from === from && l.to === to) || (l.from === to && l.to === from)));
          if (!dup) { _links.push({ id: uid(), from, to, type: linkType }); _dirty = true; }
          _connectFrom = null;
          setHint(connectHint());
          render();
        }
      });

    } else if (_mode === 'delete') {
      div.style.cursor = 'pointer';
      div.classList.add('vme-node--deletable');
      div.addEventListener('click', e => {
        e.stopPropagation();
        _nodes = _nodes.filter(n => n.id !== node.id);
        _links = _links.filter(l => l.from !== node.id && l.to !== node.id);
        _dirty = true;
        render();
      });
    }
  }

  // ── SVG connections ───────────────────────────────────────────────────────
  function renderSVG() {
    svg.querySelectorAll('.vme-link, .vme-link-hit').forEach(el => el.remove());

    const nodeMap = Object.fromEntries(_nodes.map(n => [n.id, n]));
    const isDel   = _mode === 'delete';

    _links.forEach(link => {
      const a = nodeMap[link.from];
      const b = nodeMap[link.to];
      if (!a || !b) return;

      const isTrace = (link.type || 'trace') === 'trace';

      // Centre points
      const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
      const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;

      // Bezier — horizontal bend for trace links, diagonal follow for sequential
      const dx   = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      let d;
      if (isTrace) {
        // Arch outward so horizontal links don't overlap sequential ones
        const mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
        const bend = Math.max(40, Math.abs(dy) * 0.5);
        const sign = ay <= by ? -1 : 1;  // arch upward
        d = `M${ax},${ay} Q${mid.x},${mid.y + sign * bend} ${bx},${by}`;
      } else {
        // Sequential: gentle cubic following the arm direction
        const bend = Math.min(dist * 0.35, 80);
        const normX = dx / (dist || 1), normY = dy / (dist || 1);
        const c1x = ax + normX * bend, c1y = ay + normY * bend;
        const c2x = bx - normX * bend, c2y = by - normY * bend;
        d = `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`;
      }

      // Choose colours / markers
      let stroke, strokeDash, markerEnd, markerStart, strokeW;
      if (isDel) {
        stroke = '#EA4335'; strokeDash = isTrace ? '7 4' : 'none';
        strokeW = 2.5;
        markerEnd   = 'url(#arr-del)';
        markerStart = 'url(#arr-del-start)';  // both types get start arrow in delete mode
      } else if (isTrace) {
        stroke = '#1A73E8'; strokeDash = '7 4'; strokeW = 2;
        markerEnd   = 'url(#arr-trace)';
        markerStart = 'url(#arr-trace-start)';
      } else {
        // Sequential is also bidirectional — arrows on both ends
        stroke = '#888'; strokeDash = 'none'; strokeW = 1.5;
        markerEnd   = 'url(#arr-seq)';
        markerStart = 'url(#arr-seq-start)';
      }

      // Hit area (wide, transparent)
      const hit = mkSVG('path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.classList.add('vme-link-hit');
      if (isDel) {
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => {
          _links = _links.filter(l => l.id !== link.id);
          _dirty = true; render();
        });
      }

      // Visible path
      const path = mkSVG('path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeW);
      path.setAttribute('stroke-dasharray', strokeDash);
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', isDel ? '1' : isTrace ? '0.8' : '0.55');
      if (markerEnd   !== 'none') path.setAttribute('marker-end',   markerEnd);
      if (markerStart !== 'none') path.setAttribute('marker-start', markerStart);
      path.classList.add('vme-link');
      if (isDel) {
        path.style.cursor = 'pointer';
        path.addEventListener('click', () => {
          _links = _links.filter(l => l.id !== link.id);
          _dirty = true; render();
        });
      }

      svg.appendChild(hit);
      svg.appendChild(path);
    });
  }

  // ── Global drag ───────────────────────────────────────────────────────────
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);

  function onMouseMove(e) {
    if (!_drag) return;
    const rect = canvas.getBoundingClientRect();
    const node = _nodes.find(n => n.id === _drag.nodeId);
    if (!node) return;
    node.x = Math.max(0, Math.min(e.clientX - rect.left - _drag.offX, canvas.scrollWidth  - NODE_W));
    node.y = Math.max(0, Math.min(e.clientY - rect.top  - _drag.offY, canvas.scrollHeight - NODE_H));
    const div = canvas.querySelector(`[data-nid="${node.id}"]`);
    if (div) { div.style.left = node.x + 'px'; div.style.top = node.y + 'px'; }
    renderSVG();
    _dirty = true;
  }

  function onMouseUp() {
    if (_drag) {
      const div = canvas.querySelector(`[data-nid="${_drag.nodeId}"]`);
      if (div) { div.style.cursor = 'grab'; div.classList.remove('vme-node--dragging'); }
      _drag = null;
    }
  }

  // Cancel connect on background click or Esc
  canvas.addEventListener('click', e => {
    if ((e.target === canvas || e.target === svg) && _connectFrom) {
      _connectFrom = null;
      setHint(connectHint());
      render();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _connectFrom) {
      _connectFrom = null;
      setHint(connectHint());
      render();
    }
  });

  // ── Mode buttons ──────────────────────────────────────────────────────────
  wrapper.querySelectorAll('.vme-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _mode = btn.dataset.mode;
      _connectFrom = null;
      wrapper.querySelectorAll('.vme-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setHint({
        'select':        'Drag nodes to reposition them on the canvas',
        'connect-trace': 'Click source node, then target — creates a bidirectional <strong>traceability</strong> link (dashed blue ↔)',
        'connect-seq':   'Click source node, then target — creates a <strong>sequential</strong> flow link (solid gray →)',
        'delete':        'Click a node or a connection line to remove it',
      }[_mode]);
      render();
    });
  });

  function connectHint() {
    if (_mode === 'connect-trace') return 'Click source node to start a <strong>traceability</strong> link';
    if (_mode === 'connect-seq')   return 'Click source node to start a <strong>sequential</strong> link';
    return '';
  }

  // ── ASPICE default — merge (add missing nodes/links, keep existing custom ones) ──
  wrapper.querySelector('#vme-load-aspice').addEventListener('click', () => {
    const placedIds = new Set(_nodes.map(n => n.id));

    // Add missing ASPICE nodes (keep positions of already-placed ones)
    ASPICE_NODES.forEach(cn => {
      if (!placedIds.has(cn.nodeId)) {
        const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
        if (def) _nodes.push({ ...def, x: cn.x, y: cn.y });
      }
    });

    // Add missing ASPICE links (skip duplicates regardless of direction)
    ASPICE_LINKS.forEach(al => {
      const dup = _links.some(l =>
        l.type === al.type &&
        ((l.from === al.from && l.to === al.to) || (l.from === al.to && l.to === al.from)));
      if (!dup) _links.push({ id: uid(), ...al });
    });

    _connectFrom = null;
    _dirty = true;
    render();
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-clear').addEventListener('click', () => {
    if (!confirm('Clear all nodes and links?')) return;
    _nodes = []; _links = []; _connectFrom = null; _dirty = true;
    render();
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-save').addEventListener('click', async () => {
    const btn = wrapper.querySelector('#vme-save');
    btn.disabled = true;
    const canvasNodesSave = _nodes.map(n => ({ nodeId: n.id, x: n.x, y: n.y }));
    const newConfig = { ...fullConfig, vmodel_links: _links, vmodel_canvas_nodes: canvasNodesSave };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config')
        .update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config')
        .insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    Object.assign(fullConfig, newConfig);
    _dirty = false;
    toast('V-Model saved.', 'success');
    if (onSave) onSave(_links, canvasNodesSave);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function mkSVG(tag)  { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function uid()       { return crypto.randomUUID(); }
  function setHint(h)  { if (hint) hint.innerHTML = h; }

  render();

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  };
}
