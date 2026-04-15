/**
 * Architecture Specification — arch-spec.js
 *
 * Each spec item = text description (informal) + optional UML diagram (semi-formal).
 * UML editor: lightweight SVG drag-and-drop canvas.
 *
 * UX:
 *   - Table of spec items (Code, Title, Type, Status, Has-text, Has-UML, Actions)
 *   - Click ▶ to expand row → inline text editor + UML canvas
 *   - Click a shape in the palette to add it to the canvas
 *   - Drag shapes to reposition; click to select; click selected again to enter connect mode
 *   - Click target node to create an edge; select edge + choose style from palette
 *   - Double-click node to rename; Delete key removes selected node/edge
 *   - Save stores text + UML JSON to `arch_spec_items` table
 */

import { sb, buildCode, nextIndex } from '../config.js';
import { toast } from '../toast.js';
import { showModal, hideModal } from '../components/modal.js';

const SPEC_STATUSES = ['draft', 'review', 'approved'];
const SPEC_TYPES    = ['overview', 'component', 'interface', 'behavior', 'deployment'];
const UML_TYPES     = ['none', 'component', 'state', 'usecase', 'class'];

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderArchSpec(container, { project, item, system, parentType, parentId }) {
  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>Architecture Specification</h1>
          <p class="text-muted">${esc(parentName)}</p>
        </div>
        <button class="btn btn-primary" id="btn-new-spec">＋ New Item</button>
      </div>
    </div>
    <div class="page-body" id="spec-body">
      <div class="content-loading"><div class="spinner"></div></div>
    </div>
  `;

  const ctx = { project, parentType, parentId };
  document.getElementById('btn-new-spec').onclick = () => openSpecForm(null, ctx);
  await loadSpec(ctx);
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadSpec(ctx) {
  const { data, error } = await sb.from('arch_spec_items')
    .select('*')
    .eq('parent_type', ctx.parentType)
    .eq('parent_id', ctx.parentId)
    .order('created_at', { ascending: true });

  const body = document.getElementById('spec-body');
  if (!body) return;

  if (error) {
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-danger)">
          <strong>Table not found.</strong><br>
          Please run <code>db/migration_arch_spec.sql</code> in your Supabase SQL Editor.
        </p>
      </div></div>`;
    return;
  }

  if (!data.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📐</div>
        <h3>No specification items yet</h3>
        <p>Create items to formally document architecture elements with text and UML diagrams.</p>
      </div>`;
    return;
  }

  renderSpecTable(data, ctx);
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderSpecTable(items, ctx) {
  const body = document.getElementById('spec-body');
  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>Code</th>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th style="width:48px;text-align:center" title="Has text description">T</th>
              <th style="width:48px;text-align:center" title="Has UML diagram">◈</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(specRow).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  items.forEach(it => {
    body.querySelector(`.spec-expand-btn[data-id="${it.id}"]`).onclick =
      () => toggleExpand(it, ctx);
    body.querySelector(`.btn-edit-spec[data-id="${it.id}"]`).onclick =
      () => openSpecForm(it, ctx);
    body.querySelector(`.btn-del-spec[data-id="${it.id}"]`).onclick =
      () => deleteSpec(it, ctx);
  });
}

function specRow(it) {
  const hasText = !!(it.description?.trim());
  const hasUml  = !!(it.uml_data?.nodes?.length);
  return `
    <tr class="spec-row">
      <td>
        <button class="spec-expand-btn btn btn-ghost btn-sm" data-id="${it.id}">▶</button>
      </td>
      <td class="code-cell">${esc(it.spec_code)}</td>
      <td><strong>${esc(it.title)}</strong></td>
      <td><span class="badge">${it.type}</span></td>
      <td>
        <span class="status-dot ${it.status}"></span>
        <span style="margin-left:4px">${it.status}</span>
      </td>
      <td style="text-align:center;color:${hasText ? 'var(--color-success)' : 'var(--color-text-muted)'}">
        ${hasText ? '✓' : '—'}
      </td>
      <td style="text-align:center;color:${hasUml ? 'var(--color-primary)' : 'var(--color-text-muted)'}">
        ${hasUml ? '◈' : '—'}
      </td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-edit-spec" data-id="${it.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-del-spec"  data-id="${it.id}">Delete</button>
      </td>
    </tr>
    <tr class="spec-exp-row hidden" id="spec-exp-${it.id}">
      <td colspan="8" style="padding:0;border-top:none">
        <div id="spec-exp-content-${it.id}"></div>
      </td>
    </tr>
  `;
}

// ── Expand / Inline Editor ────────────────────────────────────────────────────

let _expandedId = null;

function toggleExpand(it, ctx) {
  const row = document.getElementById(`spec-exp-${it.id}`);
  const btn = document.querySelector(`.spec-expand-btn[data-id="${it.id}"]`);
  const isOpen = !row.classList.contains('hidden');

  // Close currently open row
  if (_expandedId && _expandedId !== it.id) {
    const oldRow = document.getElementById(`spec-exp-${_expandedId}`);
    const oldBtn = document.querySelector(`.spec-expand-btn[data-id="${_expandedId}"]`);
    if (oldRow) oldRow.classList.add('hidden');
    if (oldBtn) oldBtn.textContent = '▶';
    _expandedId = null;
  }

  if (isOpen) {
    row.classList.add('hidden');
    btn.textContent = '▶';
    _expandedId = null;
  } else {
    row.classList.remove('hidden');
    btn.textContent = '▼';
    _expandedId = it.id;
    mountExpandEditor(it, ctx);
  }
}

function mountExpandEditor(it, ctx) {
  const el = document.getElementById(`spec-exp-content-${it.id}`);
  el.innerHTML = `
    <div class="spec-expand-body">

      <div class="spec-expand-text">
        <div class="spec-section-label">TEXT DESCRIPTION</div>
        <textarea class="form-input form-textarea" id="se-desc-${it.id}" rows="10"
          placeholder="Describe this architectural element in natural language…">${esc(it.description || '')}</textarea>
      </div>

      <div class="spec-expand-uml">
        <div class="spec-uml-toolbar">
          <div class="spec-section-label">UML DIAGRAM</div>
          <select class="form-input form-select" id="se-utype-${it.id}" style="width:160px">
            ${UML_TYPES.map(u => `<option value="${u}" ${(it.uml_type || 'none') === u ? 'selected' : ''}>${umlLabel(u)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="se-clear-${it.id}">Clear</button>
        </div>
        <div id="se-editor-${it.id}" class="spec-uml-slot"></div>
      </div>

    </div>
    <div class="spec-expand-footer">
      <span class="text-muted" style="font-size:11px">At least one of text or UML is required to save.</span>
      <button class="btn btn-secondary btn-sm" id="se-cancel-${it.id}">Cancel</button>
      <button class="btn btn-primary   btn-sm" id="se-save-${it.id}">Save</button>
    </div>
  `;

  const slot   = document.getElementById(`se-editor-${it.id}`);
  const editor = new UMLEditor(slot, it.uml_type || 'component', it.uml_data || null);

  document.getElementById(`se-utype-${it.id}`).onchange  = e => editor.setType(e.target.value);
  document.getElementById(`se-clear-${it.id}`).onclick   = () => editor.clear();

  document.getElementById(`se-cancel-${it.id}`).onclick  = () => {
    document.getElementById(`spec-exp-${it.id}`).classList.add('hidden');
    const btn = document.querySelector(`.spec-expand-btn[data-id="${it.id}"]`);
    if (btn) btn.textContent = '▶';
    _expandedId = null;
    editor.destroy();
  };

  document.getElementById(`se-save-${it.id}`).onclick = async () => {
    const desc    = document.getElementById(`se-desc-${it.id}`).value.trim();
    const umlType = document.getElementById(`se-utype-${it.id}`).value;
    const umlData = editor.getData();
    const hasUml  = umlData.nodes.length > 0;

    if (!desc && !hasUml) {
      toast('Add at least a text description or a UML diagram.', 'error');
      return;
    }

    const btn = document.getElementById(`se-save-${it.id}`);
    btn.disabled = true;
    const { error } = await sb.from('arch_spec_items').update({
      description: desc || null,
      uml_type:    (umlType !== 'none' && hasUml) ? umlType : null,
      uml_data:    hasUml ? umlData : null,
      updated_at:  new Date().toISOString(),
    }).eq('id', it.id);
    btn.disabled = false;

    if (error) { toast('Error saving.', 'error'); return; }
    toast('Saved.', 'success');
    editor.destroy();
    await loadSpec(ctx);
  };
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function openSpecForm(existing, ctx) {
  const isEdit = !!existing;
  const it = existing || {};

  showModal({
    title: isEdit ? `Edit: ${esc(it.spec_code)}` : 'New Specification Item',
    body: `
      <div class="form-grid">
        <div class="form-group full">
          <label class="form-label">Title *</label>
          <input class="form-input" id="sf-title" value="${esc(it.title || '')}"
            placeholder="e.g. Top-level system decomposition"/>
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-input form-select" id="sf-type">
            ${SPEC_TYPES.map(v => `<option value="${v}" ${it.type === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="sf-status">
            ${SPEC_STATUSES.map(v => `<option value="${v}" ${it.status === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="sf-cancel">Cancel</button>
      <button class="btn btn-primary"   id="sf-save">${isEdit ? 'Save' : 'Create'}</button>
    `
  });

  document.getElementById('sf-cancel').onclick = hideModal;
  document.getElementById('sf-save').onclick   = async () => {
    const title = document.getElementById('sf-title').value.trim();
    if (!title) { document.getElementById('sf-title').focus(); return; }

    const payload = {
      title,
      type:   document.getElementById('sf-type').value,
      status: document.getElementById('sf-status').value,
    };

    const btn = document.getElementById('sf-save');
    btn.disabled = true;
    let error;

    if (isEdit) {
      ({ error } = await sb.from('arch_spec_items')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', it.id));
    } else {
      const idx  = await nextIndex('arch_spec_items', { parent_id: ctx.parentId });
      const code = buildCode('AS', {
        domain:      ctx.parentType === 'item' ? 'ITEM' : 'SYS',
        projectName: ctx.project.name,
        index: idx,
      });
      ({ error } = await sb.from('arch_spec_items').insert({
        ...payload,
        spec_code:   code,
        parent_type: ctx.parentType,
        parent_id:   ctx.parentId,
        project_id:  ctx.project.id,
      }));
    }

    btn.disabled = false;
    if (error) { toast('Error saving.', 'error'); return; }

    hideModal();
    toast(isEdit ? 'Item updated.' : 'Item created.', 'success');
    await loadSpec(ctx);
  };
}

async function deleteSpec(it, ctx) {
  if (!confirm(`Delete "${it.title}"? This cannot be undone.`)) return;
  const { error } = await sb.from('arch_spec_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }
  toast('Deleted.', 'success');
  await loadSpec(ctx);
}

// ── UML Editor ────────────────────────────────────────────────────────────────
//
// Interactions:
//   • Click palette shape   → add node to canvas (staggered position)
//   • Drag node             → move
//   • Click node            → select (orange outline)
//   • Click selected node   → enter connect mode (dashed orange border + hint)
//   • Click another node    → create edge (association by default)
//   • Click palette edge    → change style of selected edge
//   • Double-click node     → rename label (prompt)
//   • Delete/Backspace      → remove selected node or edge
//   • Click empty canvas    → deselect / cancel connect mode
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE_SHAPES = {
  component: [
    { type: 'component', label: 'Component', fill: '#E8F0FE', stroke: '#1A73E8', w: 120, h: 60 },
    { type: 'box',       label: 'Interface', fill: '#E6F4EA', stroke: '#1E8E3E', w: 100, h: 50 },
    { type: 'note',      label: 'Note',      fill: '#FFFDE7', stroke: '#F9A825', w: 110, h: 55 },
  ],
  state: [
    { type: 'rounded',   label: 'State',     fill: '#E8F0FE', stroke: '#1A73E8', w: 110, h: 52 },
    { type: 'diamond',   label: 'Decision',  fill: '#FFF3E0', stroke: '#E65100', w: 90,  h: 56 },
    { type: 'circle',    label: 'Initial',   fill: '#212121', stroke: '#212121', w: 36,  h: 36 },
    { type: 'ring',      label: 'Final',     fill: 'white',   stroke: '#212121', w: 40,  h: 40 },
    { type: 'note',      label: 'Note',      fill: '#FFFDE7', stroke: '#F9A825', w: 110, h: 50 },
  ],
  usecase: [
    { type: 'actor',     label: 'Actor',     fill: 'white',   stroke: '#333',    w: 60,  h: 80 },
    { type: 'ellipse',   label: 'Use Case',  fill: '#E8F0FE', stroke: '#1A73E8', w: 130, h: 60 },
    { type: 'sysbound',  label: 'System',    fill: '#F8F9FA', stroke: '#9AA0A6', w: 180, h: 120 },
    { type: 'note',      label: 'Note',      fill: '#FFFDE7', stroke: '#F9A825', w: 110, h: 50 },
  ],
  class: [
    { type: 'class',     label: 'Class',     fill: '#F3E5F5', stroke: '#7B1FA2', w: 140, h: 90 },
    { type: 'iface',     label: 'Interface', fill: '#FFF9C4', stroke: '#F57F17', w: 130, h: 80 },
    { type: 'box',       label: 'Package',   fill: '#E8F5E9', stroke: '#2E7D32', w: 130, h: 60 },
    { type: 'note',      label: 'Note',      fill: '#FFFDE7', stroke: '#F9A825', w: 110, h: 50 },
  ],
  none: [],
};

const EDGE_STYLES = [
  { id: 'association',    label: 'Association',    dash: '',    arrowId: 'open',  color: '#555' },
  { id: 'dependency',     label: 'Dependency',     dash: '6,3', arrowId: 'dep',   color: '#1A73E8' },
  { id: 'generalization', label: 'Generalization', dash: '',    arrowId: 'tri',   color: '#333' },
  { id: 'realization',    label: 'Realization',    dash: '6,3', arrowId: 'tri',   color: '#333' },
  { id: 'composition',    label: 'Composition',    dash: '',    arrowId: 'open',  color: '#C5221F' },
];

let _ueSeq = 0;

class UMLEditor {
  constructor(container, umlType, initData) {
    this._id         = ++_ueSeq;
    this.container   = container;
    this.umlType     = umlType || 'component';
    this.data        = initData
      ? JSON.parse(JSON.stringify(initData))
      : { nodes: [], edges: [] };
    this._ns         = this.data.nodes.length;   // node id counter
    this._es         = this.data.edges.length;   // edge id counter
    this._selected   = null;    // { kind:'node'|'edge', id }
    this._connecting = null;    // node id of source when in connect mode
    this._dragState  = null;    // { nodeId, offX, offY }
    this._abortCtrl  = new AbortController();
    this._render();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setType(type) {
    this.umlType = type;
    this._renderPalette();
  }

  clear() {
    this.data = { nodes: [], edges: [] };
    this._selected   = null;
    this._connecting = null;
    this._dragState  = null;
    this._renderCanvas();
    this._showHint(true);
  }

  getData() {
    return JSON.parse(JSON.stringify(this.data));
  }

  destroy() {
    this._abortCtrl.abort();
  }

  // ── Build DOM ───────────────────────────────────────────────────────────────

  _render() {
    const id = this._id;
    this.container.innerHTML = `
      <div class="uml-editor">
        <div class="uml-palette" id="ue-pal-${id}"></div>
        <div class="uml-canvas-wrap">
          <svg class="uml-svg" id="ue-svg-${id}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="ue-arr-open-${id}" markerWidth="10" markerHeight="8"
                refX="9" refY="4" orient="auto">
                <path d="M0,0 L9,4 L0,8" fill="none" stroke="#555" stroke-width="1.5"/>
              </marker>
              <marker id="ue-arr-dep-${id}" markerWidth="10" markerHeight="8"
                refX="9" refY="4" orient="auto">
                <path d="M0,0 L9,4 L0,8" fill="none" stroke="#1A73E8" stroke-width="1.5"/>
              </marker>
              <marker id="ue-arr-tri-${id}" markerWidth="12" markerHeight="10"
                refX="10" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 Z" fill="white" stroke="#333" stroke-width="1.5"/>
              </marker>
            </defs>
            <g id="ue-edges-${id}"></g>
            <g id="ue-nodes-${id}"></g>
            <line id="ue-tmp-${id}" stroke="#F57C00" stroke-width="1.5"
              stroke-dasharray="5,3" display="none" pointer-events="none"/>
          </svg>
          <div class="uml-hint" id="ue-hint-${id}">
            Click a shape in the palette to add it to the canvas
          </div>
        </div>
      </div>
    `;

    this._svg      = document.getElementById(`ue-svg-${id}`);
    this._nodesG   = document.getElementById(`ue-nodes-${id}`);
    this._edgesG   = document.getElementById(`ue-edges-${id}`);
    this._tmpLine  = document.getElementById(`ue-tmp-${id}`);

    if (this.data.nodes.length > 0) this._showHint(false);

    this._renderPalette();
    this._renderCanvas();
    this._wireSvg();
    this._wireKeys();
  }

  // ── Palette ─────────────────────────────────────────────────────────────────

  _renderPalette() {
    const pal    = document.getElementById(`ue-pal-${this._id}`);
    if (!pal) return;
    const shapes = PALETTE_SHAPES[this.umlType] || [];

    if (!shapes.length) {
      pal.innerHTML = '<div class="uml-pal-hint">Select a UML type above to see shapes.</div>';
      return;
    }

    pal.innerHTML = `
      <div class="uml-pal-section">SHAPES</div>
      ${shapes.map((s, i) => `
        <button class="uml-pal-btn" data-idx="${i}" title="Add ${s.label}">
          <span class="uml-pal-icon">${this._miniSvg(s)}</span>
          <span class="uml-pal-lbl">${s.label}</span>
        </button>
      `).join('')}

      <div class="uml-pal-section" style="margin-top:10px">EDGES</div>
      ${EDGE_STYLES.map(e => `
        <button class="uml-pal-edge-btn" data-edge="${e.id}" title="${e.label}"
          style="color:${e.color}">
          <span class="uml-pal-icon">
            <svg width="36" height="12">
              <line x1="2" y1="6" x2="28" y2="6" stroke="${e.color}" stroke-width="1.5"
                ${e.dash ? `stroke-dasharray="${e.dash}"` : ''}
                marker-end="url(#ue-arr-open-${this._id})"/>
            </svg>
          </span>
          <span class="uml-pal-lbl">${e.label}</span>
        </button>
      `).join('')}

      <div class="uml-pal-hint" style="margin-top:12px">
        Click node to select.<br>Click selected node to connect.<br>
        Double-click to rename.<br>Delete to remove.
      </div>
    `;

    pal.querySelectorAll('.uml-pal-btn').forEach(btn => {
      btn.onclick = () => this._addNode(parseInt(btn.dataset.idx));
    });
    pal.querySelectorAll('.uml-pal-edge-btn').forEach(btn => {
      btn.onclick = () => this._setEdgeStyle(btn.dataset.edge);
    });
  }

  _miniSvg(s) {
    const w = 32, h = 18;
    switch (s.type) {
      case 'ellipse':
        return `<svg width="${w}" height="${h}"><ellipse cx="${w/2}" cy="${h/2}" rx="${w/2-1}" ry="${h/2-1}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'diamond': {
        const cx = w/2, cy = h/2;
        return `<svg width="${w}" height="${h}"><polygon points="${cx},1 ${w-1},${cy} ${cx},${h-1} 1,${cy}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      }
      case 'circle':
        return `<svg width="${w}" height="${h}"><circle cx="${w/2}" cy="${h/2}" r="${h/2-1}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'ring':
        return `<svg width="${w}" height="${h}">
          <circle cx="${w/2}" cy="${h/2}" r="${h/2-1}" fill="white" stroke="${s.stroke}" stroke-width="1.5"/>
          <circle cx="${w/2}" cy="${h/2}" r="${h/2-5}" fill="${s.stroke}"/>
        </svg>`;
      case 'rounded':
        return `<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="8" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'actor':
        return `<svg width="${w}" height="${h}">
          <circle cx="${w/2}" cy="5" r="4" fill="none" stroke="${s.stroke}" stroke-width="1.5"/>
          <line x1="${w/2}" y1="9" x2="${w/2}" y2="${h-2}" stroke="${s.stroke}" stroke-width="1.5"/>
          <line x1="${w/2-6}" y1="13" x2="${w/2+6}" y2="13" stroke="${s.stroke}" stroke-width="1.5"/>
        </svg>`;
      default:
        return `<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
    }
  }

  // ── Canvas Rendering ─────────────────────────────────────────────────────────

  _renderCanvas() {
    this._renderEdges();
    this._renderNodes();
  }

  _renderNodes() {
    this._nodesG.innerHTML = this.data.nodes.map(n => this._nodeSVG(n)).join('');

    this._nodesG.querySelectorAll('.ue-node').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('mousedown', e => this._onNodeDown(e, id));
      el.addEventListener('dblclick',  e => this._onNodeDblclick(e, id));
    });
  }

  _nodeSVG(n) {
    const sel  = this._selected?.kind === 'node' && this._selected.id === n.id;
    const conn = this._connecting === n.id;
    return `
      <g class="ue-node" data-id="${n.id}" style="cursor:move">
        ${this._nodeShape(n, sel, conn)}
        ${this._nodeLabel(n)}
        ${sel ? this._selHandles(n) : ''}
      </g>`;
  }

  _nodeShape(n, sel, conn) {
    const { type: t, x, y, w, h, fill, stroke } = n;
    const s = conn ? '#F57C00' : sel ? '#F57C00' : stroke;
    const sw = (sel || conn) ? 2.5 : 1.5;
    const dash = conn ? 'stroke-dasharray="5,3"' : '';

    switch (t) {
      case 'ellipse':
        return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>`;
      case 'diamond': {
        const cx = x+w/2, cy = y+h/2;
        return `<polygon points="${cx},${y} ${x+w},${cy} ${cx},${y+h} ${x},${cy}"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>`;
      }
      case 'circle':
        return `<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-1}"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>`;
      case 'ring':
        return `<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-1}"
            fill="white" stroke="${s}" stroke-width="${sw}" ${dash}/>
          <circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-5}" fill="${stroke}"/>`;
      case 'rounded':
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>`;
      case 'actor':
        return `<circle cx="${x+w/2}" cy="${y+8}" r="8" fill="none" stroke="${s}" stroke-width="${sw}" ${dash}/>
          <line x1="${x+w/2}" y1="${y+16}" x2="${x+w/2}" y2="${y+h-14}" stroke="${s}" stroke-width="${sw}"/>
          <line x1="${x+4}" y1="${y+28}" x2="${x+w-4}" y2="${y+28}" stroke="${s}" stroke-width="${sw}"/>
          <line x1="${x+w/2}" y1="${y+h-14}" x2="${x+6}" y2="${y+h-1}" stroke="${s}" stroke-width="${sw}"/>
          <line x1="${x+w/2}" y1="${y+h-14}" x2="${x+w-6}" y2="${y+h-1}" stroke="${s}" stroke-width="${sw}"/>`;
      case 'sysbound':
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" stroke-dasharray="6,3" ${dash}/>`;
      case 'component':
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
            fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>
          <rect x="${x-8}" y="${y+12}" width="16" height="10" rx="2" fill="white" stroke="${s}" stroke-width="1"/>
          <rect x="${x-8}" y="${y+26}" width="16" height="10" rx="2" fill="white" stroke="${s}" stroke-width="1"/>`;
      case 'note':
        return `<polygon points="${x},${y} ${x+w-12},${y} ${x+w},${y+12} ${x+w},${y+h} ${x},${y+h}"
            fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>
          <polyline points="${x+w-12},${y} ${x+w-12},${y+12} ${x+w},${y+12}"
            fill="none" stroke="${s}" stroke-width="${sw}"/>`;
      case 'class':
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"
            fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>
          <line x1="${x}" y1="${y+24}" x2="${x+w}" y2="${y+24}" stroke="${s}" stroke-width="1"/>
          <line x1="${x}" y1="${y+h-22}" x2="${x+w}" y2="${y+h-22}" stroke="${s}" stroke-width="1"/>`;
      case 'iface':
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"
            fill="${fill}" stroke="${s}" stroke-width="${sw}" stroke-dasharray="4,2" ${dash}/>
          <line x1="${x}" y1="${y+24}" x2="${x+w}" y2="${y+24}" stroke="${s}" stroke-width="1"/>`;
      default:
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
          fill="${fill}" stroke="${s}" stroke-width="${sw}" ${dash}/>`;
    }
  }

  _nodeLabel(n) {
    const cx = n.x + n.w / 2;
    if (n.type === 'actor') {
      return `<text x="${cx}" y="${n.y + n.h + 13}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
    }
    if (n.type === 'class' || n.type === 'iface') {
      const stereotype = n.type === 'iface' ? `<tspan x="${cx}" dy="0" font-size="9" fill="#777">«interface»</tspan><tspan x="${cx}" dy="13" font-weight="600">` : `<tspan x="${cx}" dy="0" font-weight="600">`;
      return `<text x="${cx}" y="${n.y + 15}" text-anchor="middle" font-size="11" fill="#333">
        ${n.type === 'iface' ? `<tspan x="${cx}" dy="0" font-size="9" fill="#777">«interface»</tspan><tspan x="${cx}" dy="13" font-weight="600" fill="#333">${esc(n.label)}</tspan>` : `<tspan font-weight="600" fill="#333">${esc(n.label)}</tspan>`}
      </text>`;
    }
    if (n.type === 'component') {
      return `<text x="${cx + 4}" y="${n.y + n.h/2 + 4}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
    }
    if (n.type === 'diamond' || n.type === 'circle' || n.type === 'ring') {
      return `<text x="${cx}" y="${n.y + n.h + 13}" text-anchor="middle" font-size="10" fill="#555">${esc(n.label)}</text>`;
    }
    const cy = n.y + n.h / 2 + 4;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
  }

  _selHandles(n) {
    return `<rect x="${n.x + n.w - 7}" y="${n.y + n.h - 7}" width="12" height="12"
      fill="#F57C00" rx="2" style="cursor:se-resize" class="ue-resize" data-id="${n.id}"/>`;
  }

  // ── Edges ───────────────────────────────────────────────────────────────────

  _renderEdges() {
    this._edgesG.innerHTML = this.data.edges.map(e => this._edgeSVG(e)).join('');
    this._edgesG.querySelectorAll('.ue-edge').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        this._selected = { kind: 'edge', id: el.dataset.id };
        this._renderCanvas();
      });
    });
  }

  _edgeSVG(e) {
    const fromN = this.data.nodes.find(n => n.id === e.from);
    const toN   = this.data.nodes.find(n => n.id === e.to);
    if (!fromN || !toN) return '';

    const pts = this._edgePoints(fromN, toN);
    const style = EDGE_STYLES.find(s => s.id === (e.style || 'association')) || EDGE_STYLES[0];
    const sel   = this._selected?.kind === 'edge' && this._selected.id === e.id;
    const color = sel ? '#F57C00' : style.color;
    const marker = `url(#ue-arr-${style.arrowId}-${this._id})`;
    const dash   = style.dash ? `stroke-dasharray="${style.dash}"` : '';
    const mx = (pts.x1 + pts.x2) / 2, my = (pts.y1 + pts.y2) / 2 - 5;

    return `<g class="ue-edge" data-id="${e.id}" style="cursor:pointer">
      <line x1="${pts.x1}" y1="${pts.y1}" x2="${pts.x2}" y2="${pts.y2}"
        stroke="transparent" stroke-width="10"/>
      <line x1="${pts.x1}" y1="${pts.y1}" x2="${pts.x2}" y2="${pts.y2}"
        stroke="${color}" stroke-width="1.5" ${dash} marker-end="${marker}"/>
      ${e.label ? `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10" fill="${color}">${esc(e.label)}</text>` : ''}
    </g>`;
  }

  _edgePoints(fromN, toN) {
    const fx = fromN.x + fromN.w / 2, fy = fromN.y + fromN.h / 2;
    const tx = toN.x  + toN.w  / 2,  ty = toN.y  + toN.h  / 2;
    const out = this._borderPt(fromN, tx - fx, ty - fy);
    const inp = this._borderPt(toN,   fx - tx, fy - ty);
    return { x1: out.x, y1: out.y, x2: inp.x, y2: inp.y };
  }

  _borderPt(n, dx, dy) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const hw = n.w / 2 + 2, hh = n.h / 2 + 2;
    if (!dx && !dy) return { x: cx, y: cy };
    const scale = Math.min(Math.abs(hw / (dx || 1e-9)), Math.abs(hh / (dy || 1e-9)));
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  // ── Mouse Events ─────────────────────────────────────────────────────────────

  _wireSvg() {
    this._svg.addEventListener('mousemove', e => this._onSvgMove(e));
    this._svg.addEventListener('mouseup',   () => { this._dragState = null; });
    this._svg.addEventListener('click',     e => this._onSvgClick(e));
  }

  _wireKeys() {
    const handler = e => {
      if (document.activeElement?.tagName === 'TEXTAREA' ||
          document.activeElement?.tagName === 'INPUT') return;
      if (!this.container.isConnected) { this._abortCtrl.abort(); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected) {
        if (this._selected.kind === 'node') {
          this.data.nodes = this.data.nodes.filter(n => n.id !== this._selected.id);
          this.data.edges = this.data.edges.filter(
            e => e.from !== this._selected.id && e.to !== this._selected.id);
        } else {
          this.data.edges = this.data.edges.filter(e => e.id !== this._selected.id);
        }
        this._selected = null;
        this._renderCanvas();
        if (!this.data.nodes.length) this._showHint(true);
      }
    };
    document.addEventListener('keydown', handler, { signal: this._abortCtrl.signal });
  }

  _svgPt(e) {
    const r = this._svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onNodeDown(e, id) {
    e.stopPropagation();

    // In connect mode → complete connection
    if (this._connecting) {
      if (this._connecting !== id) {
        this._addEdge(this._connecting, id);
      }
      this._connecting = null;
      this._tmpLine.setAttribute('display', 'none');
      this._renderCanvas();
      return;
    }

    // Already selected → enter connect mode
    if (this._selected?.kind === 'node' && this._selected.id === id) {
      this._connecting = id;
      this._renderCanvas();
      return;
    }

    // Select + start drag
    this._selected = { kind: 'node', id };
    const node = this.data.nodes.find(n => n.id === id);
    const pt   = this._svgPt(e);
    this._dragState = { nodeId: id, offX: pt.x - node.x, offY: pt.y - node.y };
    this._renderCanvas();
  }

  _onNodeDblclick(e, id) {
    e.stopPropagation();
    const node = this.data.nodes.find(n => n.id === id);
    if (!node) return;
    const label = prompt('Label:', node.label);
    if (label !== null) { node.label = label; this._renderCanvas(); }
  }

  _onSvgMove(e) {
    const pt = this._svgPt(e);

    if (this._dragState) {
      const node = this.data.nodes.find(n => n.id === this._dragState.nodeId);
      if (node) {
        node.x = Math.max(0, pt.x - this._dragState.offX);
        node.y = Math.max(0, pt.y - this._dragState.offY);
        this._renderCanvas();
      }
      return;
    }

    if (this._connecting) {
      const fromN = this.data.nodes.find(n => n.id === this._connecting);
      if (fromN) {
        const out = this._borderPt(fromN,
          pt.x - (fromN.x + fromN.w / 2),
          pt.y - (fromN.y + fromN.h / 2));
        this._tmpLine.setAttribute('x1', out.x);
        this._tmpLine.setAttribute('y1', out.y);
        this._tmpLine.setAttribute('x2', pt.x);
        this._tmpLine.setAttribute('y2', pt.y);
        this._tmpLine.setAttribute('display', '');
      }
    }
  }

  _onSvgClick(e) {
    if (this._connecting) {
      this._connecting = null;
      this._tmpLine.setAttribute('display', 'none');
      this._renderCanvas();
      return;
    }
    this._selected = null;
    this._renderCanvas();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _addNode(shapeIdx) {
    const shapes = PALETTE_SHAPES[this.umlType] || [];
    const shape  = shapes[shapeIdx];
    if (!shape) return;

    const count = this.data.nodes.length;
    const col   = count % 3;
    const row   = Math.floor(count / 3);

    this.data.nodes.push({
      id:     `n${++this._ns}`,
      type:   shape.type,
      label:  shape.label,
      fill:   shape.fill,
      stroke: shape.stroke,
      x: 30 + col * (shape.w + 40),
      y: 20 + row * (shape.h + 50),
      w: shape.w,
      h: shape.h,
    });

    this._renderCanvas();
    this._showHint(false);
  }

  _addEdge(fromId, toId) {
    this.data.edges.push({
      id:    `e${++this._es}`,
      from:  fromId,
      to:    toId,
      label: '',
      style: 'association',
    });
  }

  _setEdgeStyle(style) {
    if (this._selected?.kind === 'edge') {
      const e = this.data.edges.find(e => e.id === this._selected.id);
      if (e) { e.style = style; this._renderCanvas(); }
    }
  }

  _showHint(show) {
    const hint = document.getElementById(`ue-hint-${this._id}`);
    if (hint) hint.style.display = show ? '' : 'none';
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function umlLabel(type) {
  return {
    none:      '— None —',
    component: 'Component Diagram',
    state:     'State Machine',
    usecase:   'Use Case Diagram',
    class:     'Class Diagram',
  }[type] || type;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
