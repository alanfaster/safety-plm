/**
 * V-Model Graph Editor
 * Visual canvas for defining bidirectional traceability links between project pages.
 *
 * Usage: mountVmodelEditor(container, { links, canvasNodes, configId, fullConfig, project, sb, toast, onSave })
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

// DB source per phase
export const PHASE_DB_SOURCE = {
  requirements:        'requirements',
  architecture:        'arch_spec_items',
  unit_testing:        'test_specs',
  integration_testing: 'test_specs',
  system_testing:      'test_specs',
};

// ── ASPICE SW default layout ──────────────────────────────────────────────────

const ASPICE_NODES = [
  { nodeId: 'sys_req',   x: 20,  y: 20  },
  { nodeId: 'sw_req',    x: 100, y: 110 },
  { nodeId: 'sw_arch',   x: 180, y: 200 },
  { nodeId: 'sw_design', x: 260, y: 290 },
  { nodeId: 'sw_impl',   x: 370, y: 370 },
  { nodeId: 'sw_ut',     x: 490, y: 290 },
  { nodeId: 'sw_it',     x: 570, y: 200 },
  { nodeId: 'sw_qt',     x: 650, y: 110 },
  { nodeId: 'sys_qt',    x: 730, y: 20  },
];

const ASPICE_LINKS = [
  { from: 'sys_req',   to: 'sys_qt'   },
  { from: 'sw_req',    to: 'sw_qt'    },
  { from: 'sw_arch',   to: 'sw_it'    },
  { from: 'sw_design', to: 'sw_ut'    },
];

// ── Node dimensions ───────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 36;

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountVmodelEditor(wrapper, { links = [], canvasNodes = [], configId, fullConfig, project, sb, toast, onSave }) {

  // ── State ──────────────────────────────────────────────────────────────────
  let _nodes = [];   // { id, domain, phase, label, x, y }
  let _links = [];   // { id, from, to }
  let _mode  = 'select'; // 'select' | 'connect' | 'delete'
  let _connectFrom = null;
  let _drag  = null;     // { nodeId, offX, offY }
  let _dirty = false;

  // Init from saved state
  if (canvasNodes.length) {
    _nodes = canvasNodes.map(cn => {
      const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
      return def ? { ...def, x: cn.x, y: cn.y } : null;
    }).filter(Boolean);
  }
  _links = links.map(l => ({ ...l }));

  // ── HTML ───────────────────────────────────────────────────────────────────
  wrapper.innerHTML = `
    <div class="vme-wrap">
      <div class="vme-toolbar">
        <div class="vme-toolbar-left">
          <button class="btn btn-secondary btn-sm" id="vme-load-aspice">↺ Load ASPICE default</button>
          <button class="btn btn-ghost btn-sm" id="vme-clear">Clear canvas</button>
        </div>
        <div class="vme-mode-group" id="vme-modes">
          <button class="vme-mode-btn active" data-mode="select" title="Drag nodes to reposition">↖ Select</button>
          <button class="vme-mode-btn" data-mode="connect" title="Click a node then another to connect">↝ Connect</button>
          <button class="vme-mode-btn" data-mode="delete" title="Click a node or link to remove">✕ Delete</button>
        </div>
        <div class="vme-toolbar-right">
          <span class="vme-hint" id="vme-hint">Drag from palette · Select mode active</span>
          <button class="btn btn-primary btn-sm" id="vme-save">Save</button>
        </div>
      </div>
      <div class="vme-body">
        <div class="vme-palette" id="vme-palette">
          <div class="vme-palette-title">Available nodes</div>
          <div id="vme-pal-list"></div>
        </div>
        <div class="vme-canvas-scroll">
          <div class="vme-canvas" id="vme-canvas">
            <svg class="vme-svg" id="vme-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.7"/>
                </marker>
                <marker id="arrowhead-del" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
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

  // ── Palette ────────────────────────────────────────────────────────────────
  function refreshPalette() {
    const placed = new Set(_nodes.map(n => n.id));
    const list   = wrapper.querySelector('#vme-pal-list');
    const avail  = VMODEL_NODES.filter(n => !placed.has(n.id));

    if (!avail.length) {
      list.innerHTML = `<p class="vme-pal-empty">All nodes are on the canvas.</p>`;
      return;
    }

    // Group by domain
    const groups = {};
    avail.forEach(n => { (groups[n.domain] = groups[n.domain] || []).push(n); });
    const domainOrder = ['system','sw','hw','mech'];
    const domainLabel = { system:'System', sw:'SW', hw:'HW', mech:'MECH' };

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

  // ── Canvas drop ────────────────────────────────────────────────────────────
  canvas.addEventListener('dragover',  e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('text/plain');
    const def    = VMODEL_NODES.find(n => n.id === nodeId);
    if (!def) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - NODE_W / 2);
    const y = Math.max(0, e.clientY - rect.top  - NODE_H / 2);
    _nodes.push({ ...def, x, y });
    _dirty = true;
    render();
  });

  // ── Render ─────────────────────────────────────────────────────────────────
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

    } else if (_mode === 'connect') {
      div.style.cursor = 'crosshair';
      div.addEventListener('click', e => {
        e.stopPropagation();
        if (!_connectFrom) {
          _connectFrom = node.id;
          setHint(`Now click the target node to connect to <strong>${node.label}</strong> — or press Esc to cancel`);
          render();
        } else if (_connectFrom === node.id) {
          _connectFrom = null;
          setHint('Click source node to start a connection');
          render();
        } else {
          const from = _connectFrom, to = node.id;
          const dup  = _links.some(l =>
            (l.from === from && l.to === to) || (l.from === to && l.to === from));
          if (!dup) { _links.push({ id: uid(), from, to }); _dirty = true; }
          _connectFrom = null;
          setHint('Click source node to start a connection');
          render();
        }
      });

    } else if (_mode === 'delete') {
      div.style.cursor = 'pointer';
      div.classList.add('vme-node--deletable');
      div.addEventListener('click', e => {
        e.stopPropagation();
        _nodes  = _nodes.filter(n => n.id !== node.id);
        _links  = _links.filter(l => l.from !== node.id && l.to !== node.id);
        _dirty  = true;
        render();
      });
    }
  }

  // ── SVG connections ────────────────────────────────────────────────────────
  function renderSVG() {
    // Remove old paths + labels (keep defs)
    svg.querySelectorAll('.vme-link, .vme-link-hit, .vme-link-label').forEach(el => el.remove());

    const nodeMap = Object.fromEntries(_nodes.map(n => [n.id, n]));

    _links.forEach(link => {
      const a = nodeMap[link.from];
      const b = nodeMap[link.to];
      if (!a || !b) return;

      // Connection points: center right of a, center left of b (or nearest edge)
      const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
      const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;

      // Bezier control points
      const dx   = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      const bend = Math.min(dist * 0.4, 120);
      const c1x  = ax + bend * Math.sign(dx || 1);
      const c1y  = ay;
      const c2x  = bx - bend * Math.sign(dx || 1);
      const c2y  = by;
      const d    = `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`;

      const isDel = _mode === 'delete';
      const color = isDel ? '#EA4335' : '#1A73E8';
      const marker = isDel ? 'arrowhead-del' : 'arrowhead';

      // Visible path
      const path = mkSVG('path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', isDel ? '3' : '2');
      path.setAttribute('stroke-dasharray', '7 4');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', isDel ? '1' : '0.75');
      path.setAttribute('marker-end', `url(#${marker})`);
      path.setAttribute('marker-start', `url(#${marker})`);
      path.classList.add('vme-link');

      // Wider invisible hit area
      const hit = mkSVG('path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.style.cursor = isDel ? 'pointer' : 'default';
      hit.classList.add('vme-link-hit');

      if (isDel) {
        hit.addEventListener('click', () => {
          _links = _links.filter(l => l.id !== link.id);
          _dirty = true;
          render();
        });
        path.addEventListener('click', () => {
          _links = _links.filter(l => l.id !== link.id);
          _dirty = true;
          render();
        });
      }

      // Midpoint label for non-select mode
      const mx   = (ax + bx) / 2, my = (ay + by) / 2;
      const from = VMODEL_NODES.find(n => n.id === link.from);
      const to   = VMODEL_NODES.find(n => n.id === link.to);
      if (from && to) {
        const lbl = mkSVG('text');
        lbl.setAttribute('x', mx);
        lbl.setAttribute('y', my - 6);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('font-size', '10');
        lbl.setAttribute('fill', '#888');
        lbl.classList.add('vme-link-label');
      }

      svg.appendChild(hit);
      svg.appendChild(path);
    });
  }

  // ── Global drag ────────────────────────────────────────────────────────────
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

  // Click on canvas background cancels connect
  canvas.addEventListener('click', e => {
    if (_mode === 'connect' && e.target === canvas || e.target === svg) {
      _connectFrom = null;
      render();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _connectFrom) {
      _connectFrom = null;
      setHint('Click source node to start a connection');
      render();
    }
  });

  // ── Mode buttons ───────────────────────────────────────────────────────────
  wrapper.querySelectorAll('.vme-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _mode = btn.dataset.mode;
      _connectFrom = null;
      wrapper.querySelectorAll('.vme-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hints = {
        select:  'Drag nodes to reposition them on the canvas',
        connect: 'Click a source node, then click the target node to add a link',
        delete:  'Click a node or a connection line to remove it',
      };
      setHint(hints[_mode]);
      render();
    });
  });

  function setHint(html) { if (hint) hint.innerHTML = html; }

  // ── Load ASPICE default ────────────────────────────────────────────────────
  wrapper.querySelector('#vme-load-aspice').addEventListener('click', () => {
    if (_nodes.length && !confirm('Replace the current canvas with the ASPICE SW default?')) return;
    _nodes = ASPICE_NODES.map(cn => {
      const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
      return def ? { ...def, x: cn.x, y: cn.y } : null;
    }).filter(Boolean);
    _links = ASPICE_LINKS.map(l => ({ id: uid(), ...l }));
    _connectFrom = null;
    _dirty = true;
    render();
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-clear').addEventListener('click', () => {
    if (!confirm('Clear all nodes and links from the canvas?')) return;
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  function mkSVG(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function uid()      { return crypto.randomUUID(); }

  // ── Initial render ─────────────────────────────────────────────────────────
  render();

  // Cleanup listeners when navigating away
  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  };
}
