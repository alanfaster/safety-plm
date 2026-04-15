/**
 * Architecture Specification — arch-spec.js (v2)
 *
 * UX:
 *  • Table: ID | Description | Type | Status | Actions
 *  • Inline editing: Type/Status select → autosave on change
 *  • Description text: double-click to edit, blur = autosave
 *  • UML diagram: shown inline as scalable SVG preview, click to expand,
 *    double-click to open the UML editor (replaces preview in-place)
 *  • New Item: appends an empty row directly — no modal
 *  • Row actions: ↑ move up, ↓ move down, + add below, 🗑 delete
 */

import { sb, buildCode, nextIndex } from '../config.js';
import { toast } from '../toast.js';

const SPEC_STATUSES = ['draft', 'review', 'approved'];
const SPEC_TYPES    = ['overview', 'component', 'interface', 'behavior', 'deployment', 'info'];
const UML_TYPES     = ['none', 'component', 'state', 'usecase', 'class'];

// Module-level state
let _ctx   = null;   // { project, parentType, parentId }
let _items = [];     // ordered array of spec items (in-memory cache)
let _umlOpenId = null; // id of item whose UML editor is currently open

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderArchSpec(container, { project, item, system, parentType, parentId }) {
  _ctx  = { project, parentType, parentId };
  _items = [];
  _umlOpenId = null;

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

  document.getElementById('btn-new-spec').onclick = () => addRow(null); // null = append at end
  await loadSpec();
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadSpec() {
  const { data, error } = await sb.from('arch_spec_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true });

  const body = document.getElementById('spec-body');
  if (!body) return;

  if (error) {
    const isNoTable = error.code === '42P01' || error.message?.includes('does not exist');
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-danger)">
          ${isNoTable
            ? '<strong>Table not found.</strong><br>Please run <code>db/migration_arch_spec.sql</code> in Supabase SQL Editor.'
            : `<strong>Error loading data:</strong><br><code>${esc(error.message || JSON.stringify(error))}</code>`}
        </p>
      </div></div>`;
    console.error('arch_spec_items load error:', error);
    return;
  }

  _items = data || [];
  renderTable(body);
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderTable(body) {
  if (!_items.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📐</div>
        <h3>No specification items yet</h3>
        <p>Click <strong>＋ New Item</strong> to add the first specification element.</p>
      </div>`;
    // Re-wire new item button (body was replaced)
    return;
  }

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table spec-table">
          <thead>
            <tr>
              <th style="width:88px">ID</th>
              <th>Description</th>
              <th style="width:130px">Type</th>
              <th style="width:120px">Status</th>
              <th style="width:120px"></th>
            </tr>
          </thead>
          <tbody id="spec-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = document.getElementById('spec-tbody');
  _items.forEach(it => appendRowToTbody(tbody, it));
}

function appendRowToTbody(tbody, it) {
  const tr = buildRowEl(it);
  tbody.appendChild(tr);
  wireRow(tr, it);

  // UML editor row (hidden by default)
  const umlTr = document.createElement('tr');
  umlTr.id        = `spec-uml-row-${it.id}`;
  umlTr.className = 'spec-uml-edit-row hidden';
  umlTr.innerHTML = `<td colspan="5" style="padding:0"><div id="spec-uml-slot-${it.id}"></div></td>`;
  tbody.appendChild(umlTr);
}

function buildRowEl(it) {
  const tr = document.createElement('tr');
  tr.dataset.id  = it.id;
  tr.className   = 'spec-row';
  tr.innerHTML   = rowHTML(it);
  return tr;
}

function rowHTML(it) {
  const hasUml = !!(it.uml_data?.nodes?.length);
  return `
    <td class="spec-id-cell code-cell">${esc(it.spec_code)}</td>

    <td class="spec-desc-cell">
      <div class="spec-text-view" data-field="title"
        title="Double-click to edit">${esc(it.title || '')}<span class="spec-placeholder ${it.title ? 'hidden' : ''}">Double-click to add description…</span></div>
      ${hasUml ? `
      <div class="spec-uml-inline">
        <div class="spec-uml-inline-header">
          <span class="spec-uml-badge">◈ ${umlLabel(it.uml_type)}</span>
          <button class="spec-uml-expand-btn" title="Expand / collapse diagram">▼</button>
        </div>
        <div class="spec-uml-preview collapsed" title="Double-click to edit diagram">
          ${umlPreviewSVG(it.uml_data, false)}
        </div>
      </div>` : `
      <div class="spec-no-uml">
        <button class="spec-add-uml-btn btn btn-ghost btn-xs">◈ Add diagram</button>
      </div>`}
    </td>

    <td>
      <select class="form-input form-select spec-type-sel" data-field="type">
        ${SPEC_TYPES.map(v => `<option value="${v}" ${it.type === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </td>
    <td>
      <select class="form-input form-select spec-status-sel" data-field="status">
        ${SPEC_STATUSES.map(v => `<option value="${v}" ${it.status === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </td>

    <td class="spec-row-actions">
      <button class="btn btn-ghost btn-xs spec-move-up"  title="Move up">↑</button>
      <button class="btn btn-ghost btn-xs spec-move-dn"  title="Move down">↓</button>
      <button class="btn btn-ghost btn-xs spec-add-below" title="Add row below">+</button>
      <button class="btn btn-ghost btn-xs spec-del-btn"   title="Delete row" style="color:var(--color-danger)">✕</button>
    </td>
  `;
}

// ── Row Wiring ────────────────────────────────────────────────────────────────

function wireRow(tr, it) {
  // ── Text description: double-click to edit, blur to save ─────────────────
  const textView = tr.querySelector('.spec-text-view');
  const placeholder = tr.querySelector('.spec-placeholder');

  textView.addEventListener('dblclick', () => {
    textView.contentEditable = 'true';
    textView.classList.add('editing');
    if (placeholder) placeholder.classList.add('hidden');
    // Position cursor at end
    textView.focus();
    const range = document.createRange();
    range.selectNodeContents(textView);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });

  textView.addEventListener('blur', async () => {
    if (textView.contentEditable !== 'true') return;
    textView.contentEditable = 'false';
    textView.classList.remove('editing');
    const newVal = textView.textContent.trim();
    if (placeholder) placeholder.classList.toggle('hidden', !!newVal);
    if (newVal === (it.title || '')) return;
    it.title = newVal;
    await autosave(it.id, { title: newVal });
  });

  textView.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      textView.textContent = it.title || '';
      textView.blur();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textView.blur();
    }
  });

  // ── Type / Status selects ─────────────────────────────────────────────────
  tr.querySelectorAll('select[data-field]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      it[field] = sel.value;
      await autosave(it.id, { [field]: sel.value });
    });
  });

  // ── UML expand/collapse toggle ────────────────────────────────────────────
  const expandBtn = tr.querySelector('.spec-uml-expand-btn');
  const preview   = tr.querySelector('.spec-uml-preview');
  if (expandBtn && preview) {
    expandBtn.addEventListener('click', () => {
      preview.classList.toggle('collapsed');
      expandBtn.textContent = preview.classList.contains('collapsed') ? '▼' : '▲';
    });

    // Double-click on preview → open UML editor
    preview.addEventListener('dblclick', () => openUmlEditor(it));
  }

  // ── Add diagram button (when no UML yet) ─────────────────────────────────
  const addUmlBtn = tr.querySelector('.spec-add-uml-btn');
  if (addUmlBtn) {
    addUmlBtn.addEventListener('click', () => openUmlEditor(it));
  }

  // ── Row actions ───────────────────────────────────────────────────────────
  tr.querySelector('.spec-move-up').addEventListener('click',   () => moveRow(it.id, -1));
  tr.querySelector('.spec-move-dn').addEventListener('click',   () => moveRow(it.id,  1));
  tr.querySelector('.spec-add-below').addEventListener('click', () => addRow(it.id));
  tr.querySelector('.spec-del-btn').addEventListener('click',   () => deleteRow(it));
}

// ── UML Editor ────────────────────────────────────────────────────────────────

function openUmlEditor(it) {
  const umlRow  = document.getElementById(`spec-uml-row-${it.id}`);
  const umlSlot = document.getElementById(`spec-uml-slot-${it.id}`);
  if (!umlRow || !umlSlot) return;

  // Close any other open editor
  if (_umlOpenId && _umlOpenId !== it.id) closeUmlEditor(_umlOpenId);

  if (_umlOpenId === it.id) { closeUmlEditor(it.id); return; }

  _umlOpenId = it.id;
  umlRow.classList.remove('hidden');

  umlSlot.innerHTML = `
    <div class="spec-uml-edit-wrap">
      <div class="spec-uml-edit-toolbar">
        <label class="form-label" style="margin:0;font-size:11px;font-weight:700">UML TYPE</label>
        <select class="form-input form-select" id="uml-type-sel-${it.id}" style="width:160px">
          ${UML_TYPES.map(u => `<option value="${u}" ${(it.uml_type || 'none') === u ? 'selected' : ''}>${umlLabel(u)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="uml-clear-${it.id}">Clear</button>
        <div style="flex:1"></div>
        <button class="btn btn-secondary btn-sm" id="uml-cancel-${it.id}">Cancel</button>
        <button class="btn btn-primary   btn-sm" id="uml-save-${it.id}">Save diagram</button>
      </div>
      <div id="uml-editor-slot-${it.id}"></div>
    </div>
  `;

  const editor = new UMLEditor(
    document.getElementById(`uml-editor-slot-${it.id}`),
    it.uml_type || 'component',
    it.uml_data || null
  );

  document.getElementById(`uml-type-sel-${it.id}`).onchange = e => editor.setType(e.target.value);
  document.getElementById(`uml-clear-${it.id}`).onclick     = () => editor.clear();

  document.getElementById(`uml-cancel-${it.id}`).onclick = () => {
    editor.destroy();
    closeUmlEditor(it.id);
  };

  document.getElementById(`uml-save-${it.id}`).onclick = async () => {
    const umlType = document.getElementById(`uml-type-sel-${it.id}`).value;
    const umlData = editor.getData();
    const hasUml  = umlData.nodes.length > 0;

    const saveBtn = document.getElementById(`uml-save-${it.id}`);
    saveBtn.disabled = true;
    const { error } = await sb.from('arch_spec_items').update({
      uml_type:    hasUml && umlType !== 'none' ? umlType : null,
      uml_data:    hasUml ? umlData : null,
      updated_at:  new Date().toISOString(),
    }).eq('id', it.id);
    saveBtn.disabled = false;

    if (error) { toast('Error saving diagram.', 'error'); return; }

    it.uml_type = hasUml ? umlType : null;
    it.uml_data = hasUml ? umlData : null;
    toast('Diagram saved.', 'success');
    editor.destroy();
    closeUmlEditor(it.id);
    refreshRow(it);
  };

  // Scroll into view
  umlRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeUmlEditor(id) {
  const umlRow = document.getElementById(`spec-uml-row-${id}`);
  if (umlRow) umlRow.classList.add('hidden');
  if (_umlOpenId === id) _umlOpenId = null;
}

function refreshRow(it) {
  const tr = document.querySelector(`tr.spec-row[data-id="${it.id}"]`);
  if (!tr) return;
  tr.innerHTML = rowHTML(it);
  wireRow(tr, it);
}

// ── Row CRUD & Reorder ────────────────────────────────────────────────────────

async function addRow(afterId) {
  const idx  = await nextIndex('arch_spec_items', { parent_id: _ctx.parentId });
  const code = buildCode('AS', {
    domain:      _ctx.parentType === 'item' ? 'ITEM' : 'SYS',
    projectName: _ctx.project.name,
    index:       idx,
  });

  // Compute sort_order: after the referenced row, or at end
  let sortOrder;
  if (afterId === null) {
    sortOrder = _items.length;
  } else {
    const pos = _items.findIndex(it => it.id === afterId);
    sortOrder = pos >= 0 ? pos + 1 : _items.length;
    // Shift subsequent items
    await Promise.all(
      _items.slice(sortOrder).map((it, i) =>
        sb.from('arch_spec_items').update({ sort_order: sortOrder + 1 + i }).eq('id', it.id)
      )
    );
  }

  const { data: newItem, error } = await sb.from('arch_spec_items').insert({
    spec_code:   code,
    title:       '',
    type:        'overview',
    status:      'draft',
    sort_order:  sortOrder,
    parent_type: _ctx.parentType,
    parent_id:   _ctx.parentId,
    project_id:  _ctx.project.id,
  }).select().single();

  if (error) { toast('Error creating item.', 'error'); return; }

  // Insert into _items at the right position
  if (afterId === null) {
    _items.push(newItem);
  } else {
    const pos = _items.findIndex(it => it.id === afterId);
    _items.splice(pos >= 0 ? pos + 1 : _items.length, 0, newItem);
  }

  // If table not yet rendered, render full
  if (!document.getElementById('spec-tbody')) {
    renderTable(document.getElementById('spec-body'));
    return;
  }

  // Otherwise inject row
  const tbody = document.getElementById('spec-tbody');
  if (afterId === null) {
    const tr = buildRowEl(newItem);
    tbody.appendChild(tr);
    wireRow(tr, newItem);
    const umlTr = document.createElement('tr');
    umlTr.id        = `spec-uml-row-${newItem.id}`;
    umlTr.className = 'spec-uml-edit-row hidden';
    umlTr.innerHTML = `<td colspan="5" style="padding:0"><div id="spec-uml-slot-${newItem.id}"></div></td>`;
    tbody.appendChild(umlTr);
  } else {
    const refUmlRow = document.getElementById(`spec-uml-row-${afterId}`);
    const tr = buildRowEl(newItem);
    refUmlRow?.after(tr);
    const umlTr = document.createElement('tr');
    umlTr.id        = `spec-uml-row-${newItem.id}`;
    umlTr.className = 'spec-uml-edit-row hidden';
    umlTr.innerHTML = `<td colspan="5" style="padding:0"><div id="spec-uml-slot-${newItem.id}"></div></td>`;
    tr.after(umlTr);
    wireRow(tr, newItem);
  }

  // Focus the new row's text field
  const newTr = document.querySelector(`tr.spec-row[data-id="${newItem.id}"]`);
  if (newTr) {
    const textView = newTr.querySelector('.spec-text-view');
    if (textView) {
      textView.contentEditable = 'true';
      textView.classList.add('editing');
      textView.focus();
    }
  }
}

async function moveRow(id, dir) {
  const idx = _items.findIndex(it => it.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= _items.length) return;

  // Swap in memory
  [_items[idx], _items[swapIdx]] = [_items[swapIdx], _items[idx]];

  // Update sort_orders in DB
  await Promise.all([
    sb.from('arch_spec_items').update({ sort_order: idx    }).eq('id', _items[idx].id),
    sb.from('arch_spec_items').update({ sort_order: swapIdx}).eq('id', _items[swapIdx].id),
  ]);

  // Re-order in DOM
  const tbody = document.getElementById('spec-tbody');
  if (!tbody) return;

  // Rebuild tbody content from _items order
  tbody.innerHTML = '';
  _items.forEach(it => appendRowToTbody(tbody, it));
}

async function deleteRow(it) {
  if (!confirm(`Delete specification item "${it.spec_code}"?`)) return;

  // Close UML editor if open
  if (_umlOpenId === it.id) closeUmlEditor(it.id);

  const { error } = await sb.from('arch_spec_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }

  _items = _items.filter(i => i.id !== it.id);

  // Remove rows from DOM
  document.querySelector(`tr.spec-row[data-id="${it.id}"]`)?.remove();
  document.getElementById(`spec-uml-row-${it.id}`)?.remove();

  // Show empty state if no items left
  if (!_items.length) {
    renderTable(document.getElementById('spec-body'));
  }

  toast('Item deleted.', 'success');
}

// ── Autosave ──────────────────────────────────────────────────────────────────

async function autosave(id, fields) {
  const { error } = await sb.from('arch_spec_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) toast('Autosave failed.', 'error');
}

// ── UML Preview SVG ───────────────────────────────────────────────────────────

function umlPreviewSVG(umlData, expanded) {
  if (!umlData?.nodes?.length) return '';

  const nodes = umlData.nodes;
  const edges = umlData.edges || [];

  // Compute viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x - 10);
    minY = Math.min(minY, n.y - 10);
    maxX = Math.max(maxX, n.x + n.w + 24); // room for labels
    maxY = Math.max(maxY, n.y + n.h + 24);
  });

  const vw = Math.max(maxX - minX, 80);
  const vh = Math.max(maxY - minY, 40);

  const edgesSVG = edges.map(e => {
    const fromN = nodes.find(n => n.id === e.from);
    const toN   = nodes.find(n => n.id === e.to);
    if (!fromN || !toN) return '';
    const fx = fromN.x + fromN.w/2, fy = fromN.y + fromN.h/2;
    const tx = toN.x + toN.w/2,    ty = toN.y + toN.h/2;
    const style = EDGE_STYLES.find(s => s.id === (e.style || 'association')) || EDGE_STYLES[0];
    return `<line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}"
      stroke="${style.color}" stroke-width="1.2"
      ${style.dash ? `stroke-dasharray="${style.dash}"` : ''}
      marker-end="url(#prev-arr)"/>`;
  }).join('');

  const nodesSVG = nodes.map(n => {
    const cx = n.x + n.w/2, cy = n.y + n.h/2;
    let shape = '';
    switch (n.type) {
      case 'ellipse':
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.w/2}" ry="${n.h/2}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.2"/>`;
        break;
      case 'diamond': {
        const px = cx, py = n.y + n.h/2;
        shape = `<polygon points="${cx},${n.y} ${n.x+n.w},${py} ${cx},${n.y+n.h} ${n.x},${py}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.2"/>`;
        break;
      }
      case 'circle':
        shape = `<circle cx="${cx}" cy="${cy}" r="${Math.min(n.w,n.h)/2-1}" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.2"/>`;
        break;
      case 'ring':
        shape = `<circle cx="${cx}" cy="${cy}" r="${Math.min(n.w,n.h)/2-1}" fill="white" stroke="${n.stroke}" stroke-width="1.2"/>
                 <circle cx="${cx}" cy="${cy}" r="${Math.min(n.w,n.h)/2-5}" fill="${n.stroke}"/>`;
        break;
      case 'rounded':
        shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="14" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.2"/>`;
        break;
      case 'actor':
        shape = `<circle cx="${cx}" cy="${n.y+8}" r="7" fill="none" stroke="${n.stroke}" stroke-width="1.2"/>
                 <line x1="${cx}" y1="${n.y+15}" x2="${cx}" y2="${n.y+n.h-10}" stroke="${n.stroke}" stroke-width="1.2"/>
                 <line x1="${n.x+6}" y1="${n.y+24}" x2="${n.x+n.w-6}" y2="${n.y+24}" stroke="${n.stroke}" stroke-width="1.2"/>`;
        break;
      default:
        shape = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="3" fill="${n.fill}" stroke="${n.stroke}" stroke-width="1.2"/>`;
    }
    const lblY = n.type === 'actor'    ? n.y + n.h + 12
               : n.type === 'diamond'  ? n.y + n.h + 12
               : n.type === 'circle'   ? n.y + n.h + 12
               : n.type === 'ring'     ? n.y + n.h + 12
               : cy + 4;
    return `${shape}<text x="${cx}" y="${lblY}" text-anchor="middle" font-size="10" fill="#333">${esc(n.label)}</text>`;
  }).join('');

  return `
    <svg class="uml-prev-svg" viewBox="${minX} ${minY} ${vw} ${vh}"
      preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="prev-arr" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#555" stroke-width="1.2"/>
        </marker>
      </defs>
      ${edgesSVG}
      ${nodesSVG}
    </svg>`;
}

// ── UML Editor ────────────────────────────────────────────────────────────────

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
  { id: 'association',    label: 'Association',    dash: '',    arrowId: 'open', color: '#555' },
  { id: 'dependency',     label: 'Dependency',     dash: '6,3', arrowId: 'dep',  color: '#1A73E8' },
  { id: 'generalization', label: 'Generalization', dash: '',    arrowId: 'tri',  color: '#333' },
  { id: 'realization',    label: 'Realization',    dash: '6,3', arrowId: 'tri',  color: '#333' },
  { id: 'composition',    label: 'Composition',    dash: '',    arrowId: 'open', color: '#C5221F' },
];

let _ueSeq = 0;

class UMLEditor {
  constructor(container, umlType, initData) {
    this._id         = ++_ueSeq;
    this.container   = container;
    this.umlType     = umlType || 'component';
    this.data        = initData ? JSON.parse(JSON.stringify(initData)) : { nodes: [], edges: [] };
    this._ns         = this.data.nodes.length;
    this._es         = this.data.edges.length;
    this._selected   = null;
    this._connecting = null;
    this._dragState  = null;
    this._abortCtrl  = new AbortController();
    this._build();
  }

  setType(t)  { this.umlType = t; this._pal(); }
  clear()     { this.data = { nodes: [], edges: [] }; this._selected = null; this._connecting = null; this._rc(); this._showHint(true); }
  getData()   { return JSON.parse(JSON.stringify(this.data)); }
  destroy()   { this._abortCtrl.abort(); }

  _build() {
    const id = this._id;
    this.container.innerHTML = `
      <div class="uml-editor">
        <div class="uml-palette" id="ue-pal-${id}"></div>
        <div class="uml-canvas-wrap">
          <svg class="uml-svg" id="ue-svg-${id}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="ue-arr-open-${id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                <path d="M0,0 L9,4 L0,8" fill="none" stroke="#555" stroke-width="1.5"/>
              </marker>
              <marker id="ue-arr-dep-${id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                <path d="M0,0 L9,4 L0,8" fill="none" stroke="#1A73E8" stroke-width="1.5"/>
              </marker>
              <marker id="ue-arr-tri-${id}" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 Z" fill="white" stroke="#333" stroke-width="1.5"/>
              </marker>
            </defs>
            <g id="ue-eg-${id}"></g>
            <g id="ue-ng-${id}"></g>
            <line id="ue-tmp-${id}" stroke="#F57C00" stroke-width="1.5"
              stroke-dasharray="5,3" display="none" pointer-events="none"/>
          </svg>
          <div class="uml-hint" id="ue-hint-${id}">Click a shape in the palette to add it</div>
        </div>
      </div>`;

    this._svg    = document.getElementById(`ue-svg-${id}`);
    this._ng     = document.getElementById(`ue-ng-${id}`);
    this._eg     = document.getElementById(`ue-eg-${id}`);
    this._tmp    = document.getElementById(`ue-tmp-${id}`);

    if (this.data.nodes.length) this._showHint(false);
    this._pal();
    this._rc();
    this._wireSvg();
    this._wireKeys();
  }

  _pal() {
    const pal = document.getElementById(`ue-pal-${this._id}`);
    if (!pal) return;
    const shapes = PALETTE_SHAPES[this.umlType] || [];
    if (!shapes.length) {
      pal.innerHTML = '<div class="uml-pal-hint">Select a UML type to see shapes.</div>';
      return;
    }
    pal.innerHTML = `
      <div class="uml-pal-section">SHAPES</div>
      ${shapes.map((s, i) => `
        <button class="uml-pal-btn" data-idx="${i}" title="Add ${s.label}">
          <span class="uml-pal-icon">${this._ms(s)}</span>
          <span class="uml-pal-lbl">${s.label}</span>
        </button>`).join('')}
      <div class="uml-pal-section" style="margin-top:8px">EDGES</div>
      ${EDGE_STYLES.map(e => `
        <button class="uml-pal-edge-btn" data-edge="${e.id}" title="${e.label}">
          <span class="uml-pal-icon">
            <svg width="36" height="12">
              <line x1="2" y1="6" x2="27" y2="6" stroke="${e.color}" stroke-width="1.5"
                ${e.dash ? `stroke-dasharray="${e.dash}"` : ''}
                marker-end="url(#ue-arr-open-${this._id})"/>
            </svg>
          </span>
          <span class="uml-pal-lbl">${e.label}</span>
        </button>`).join('')}
      <div class="uml-pal-hint" style="margin-top:10px">
        Click shape → place.<br>Click node → select.<br>Click selected → connect.<br>
        Dbl-click → rename.<br>Delete → remove.
      </div>`;
    pal.querySelectorAll('.uml-pal-btn').forEach(b => {
      b.onclick = () => this._addN(parseInt(b.dataset.idx));
    });
    pal.querySelectorAll('.uml-pal-edge-btn').forEach(b => {
      b.onclick = () => this._setEdge(b.dataset.edge);
    });
  }

  _ms(s) {
    const w = 32, h = 18;
    switch (s.type) {
      case 'ellipse': return `<svg width="${w}" height="${h}"><ellipse cx="${w/2}" cy="${h/2}" rx="${w/2-1}" ry="${h/2-1}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'diamond': return `<svg width="${w}" height="${h}"><polygon points="${w/2},1 ${w-1},${h/2} ${w/2},${h-1} 1,${h/2}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'circle':  return `<svg width="${w}" height="${h}"><circle cx="${w/2}" cy="${h/2}" r="${h/2-1}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'ring':    return `<svg width="${w}" height="${h}"><circle cx="${w/2}" cy="${h/2}" r="${h/2-1}" fill="white" stroke="${s.stroke}" stroke-width="1.5"/><circle cx="${w/2}" cy="${h/2}" r="${h/2-5}" fill="${s.stroke}"/></svg>`;
      case 'rounded': return `<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="8" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      case 'actor':   return `<svg width="${w}" height="${h}"><circle cx="${w/2}" cy="5" r="4" fill="none" stroke="${s.stroke}" stroke-width="1.5"/><line x1="${w/2}" y1="9" x2="${w/2}" y2="${h-2}" stroke="${s.stroke}" stroke-width="1.5"/><line x1="${w/2-6}" y1="13" x2="${w/2+6}" y2="13" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
      default:        return `<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w-2}" height="${h-2}" rx="2" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.5"/></svg>`;
    }
  }

  _rc() { this._re(); this._rn(); }

  _rn() {
    this._ng.innerHTML = this.data.nodes.map(n => this._nsvg(n)).join('');
    this._ng.querySelectorAll('.ue-node').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('mousedown', e => this._onNDown(e, id));
      el.addEventListener('dblclick',  e => this._onNDbl(e, id));
    });
  }

  _nsvg(n) {
    const sel  = this._selected?.kind === 'node' && this._selected.id === n.id;
    const conn = this._connecting === n.id;
    return `<g class="ue-node" data-id="${n.id}" style="cursor:move">
      ${this._nshape(n, sel, conn)}
      ${this._nlabel(n)}
      ${sel ? `<rect x="${n.x+n.w-7}" y="${n.y+n.h-7}" width="12" height="12" fill="#F57C00" rx="2" style="cursor:se-resize"/>` : ''}
    </g>`;
  }

  _nshape(n, sel, conn) {
    const { type: t, x, y, w, h, fill, stroke } = n;
    const s = (sel || conn) ? '#F57C00' : stroke;
    const sw = (sel || conn) ? 2.5 : 1.5;
    const da = conn ? 'stroke-dasharray="5,3"' : '';
    switch (t) {
      case 'ellipse': return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
      case 'diamond': return `<polygon points="${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
      case 'circle':  return `<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-1}" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
      case 'ring':    return `<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-1}" fill="white" stroke="${s}" stroke-width="${sw}"/><circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2-5}" fill="${stroke}"/>`;
      case 'rounded': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
      case 'actor':   return `<circle cx="${x+w/2}" cy="${y+8}" r="8" fill="none" stroke="${s}" stroke-width="${sw}" ${da}/><line x1="${x+w/2}" y1="${y+16}" x2="${x+w/2}" y2="${y+h-14}" stroke="${s}" stroke-width="${sw}"/><line x1="${x+4}" y1="${y+28}" x2="${x+w-4}" y2="${y+28}" stroke="${s}" stroke-width="${sw}"/><line x1="${x+w/2}" y1="${y+h-14}" x2="${x+6}" y2="${y+h-1}" stroke="${s}" stroke-width="${sw}"/><line x1="${x+w/2}" y1="${y+h-14}" x2="${x+w-6}" y2="${y+h-1}" stroke="${s}" stroke-width="${sw}"/>`;
      case 'sysbound':return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${s}" stroke-width="${sw}" stroke-dasharray="6,3" ${da}/>`;
      case 'component':return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/><rect x="${x-8}" y="${y+12}" width="16" height="10" rx="2" fill="white" stroke="${s}" stroke-width="1"/><rect x="${x-8}" y="${y+26}" width="16" height="10" rx="2" fill="white" stroke="${s}" stroke-width="1"/>`;
      case 'note':    return `<polygon points="${x},${y} ${x+w-12},${y} ${x+w},${y+12} ${x+w},${y+h} ${x},${y+h}" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/><polyline points="${x+w-12},${y} ${x+w-12},${y+12} ${x+w},${y+12}" fill="none" stroke="${s}" stroke-width="${sw}"/>`;
      case 'class':   return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/><line x1="${x}" y1="${y+24}" x2="${x+w}" y2="${y+24}" stroke="${s}" stroke-width="1"/><line x1="${x}" y1="${y+h-22}" x2="${x+w}" y2="${y+h-22}" stroke="${s}" stroke-width="1"/>`;
      case 'iface':   return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${s}" stroke-width="${sw}" stroke-dasharray="4,2" ${da}/><line x1="${x}" y1="${y+24}" x2="${x+w}" y2="${y+24}" stroke="${s}" stroke-width="1"/>`;
      default:        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
    }
  }

  _nlabel(n) {
    const cx = n.x + n.w/2;
    if (n.type === 'actor')   return `<text x="${cx}" y="${n.y+n.h+13}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
    if (n.type === 'diamond' || n.type === 'circle' || n.type === 'ring') return `<text x="${cx}" y="${n.y+n.h+13}" text-anchor="middle" font-size="10" fill="#555">${esc(n.label)}</text>`;
    if (n.type === 'class')   return `<text x="${cx}" y="${n.y+15}" text-anchor="middle" font-size="11" font-weight="600" fill="#333">${esc(n.label)}</text>`;
    if (n.type === 'iface')   return `<text x="${cx}" y="${n.y+15}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
    if (n.type === 'component') return `<text x="${cx+4}" y="${n.y+n.h/2+4}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
    return `<text x="${cx}" y="${n.y+n.h/2+4}" text-anchor="middle" font-size="11" fill="#333">${esc(n.label)}</text>`;
  }

  _re() {
    this._eg.innerHTML = this.data.edges.map(e => this._esvg(e)).join('');
    this._eg.querySelectorAll('.ue-edge').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        this._selected = { kind: 'edge', id: el.dataset.id };
        this._rc();
      });
    });
  }

  _esvg(e) {
    const fN = this.data.nodes.find(n => n.id === e.from);
    const tN = this.data.nodes.find(n => n.id === e.to);
    if (!fN || !tN) return '';
    const p = this._ep(fN, tN);
    const st = EDGE_STYLES.find(s => s.id === (e.style || 'association')) || EDGE_STYLES[0];
    const sel = this._selected?.kind === 'edge' && this._selected.id === e.id;
    const clr = sel ? '#F57C00' : st.color;
    const mk  = `url(#ue-arr-${st.arrowId}-${this._id})`;
    const da  = st.dash ? `stroke-dasharray="${st.dash}"` : '';
    return `<g class="ue-edge" data-id="${e.id}" style="cursor:pointer">
      <line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="transparent" stroke-width="10"/>
      <line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${clr}" stroke-width="1.5" ${da} marker-end="${mk}"/>
      ${e.label ? `<text x="${(p.x1+p.x2)/2}" y="${(p.y1+p.y2)/2-4}" text-anchor="middle" font-size="10" fill="${clr}">${esc(e.label)}</text>` : ''}
    </g>`;
  }

  _ep(fN, tN) {
    const fx = fN.x+fN.w/2, fy = fN.y+fN.h/2;
    const tx = tN.x+tN.w/2, ty = tN.y+tN.h/2;
    const o = this._bp(fN, tx-fx, ty-fy);
    const i = this._bp(tN, fx-tx, fy-ty);
    return { x1: o.x, y1: o.y, x2: i.x, y2: i.y };
  }

  _bp(n, dx, dy) {
    const cx = n.x+n.w/2, cy = n.y+n.h/2;
    const hw = n.w/2+2, hh = n.h/2+2;
    if (!dx && !dy) return { x: cx, y: cy };
    const sc = Math.min(Math.abs(hw/(dx||1e-9)), Math.abs(hh/(dy||1e-9)));
    return { x: cx+dx*sc, y: cy+dy*sc };
  }

  _wireSvg() {
    this._svg.addEventListener('mousemove', e => {
      const pt = this._pt(e);
      if (this._dragState) {
        const n = this.data.nodes.find(n => n.id === this._dragState.nodeId);
        if (n) { n.x = Math.max(0, pt.x - this._dragState.offX); n.y = Math.max(0, pt.y - this._dragState.offY); this._rc(); }
        return;
      }
      if (this._connecting) {
        const fN = this.data.nodes.find(n => n.id === this._connecting);
        if (fN) {
          const o = this._bp(fN, pt.x-(fN.x+fN.w/2), pt.y-(fN.y+fN.h/2));
          this._tmp.setAttribute('x1', o.x); this._tmp.setAttribute('y1', o.y);
          this._tmp.setAttribute('x2', pt.x); this._tmp.setAttribute('y2', pt.y);
          this._tmp.setAttribute('display', '');
        }
      }
    });
    this._svg.addEventListener('mouseup',   () => { this._dragState = null; });
    this._svg.addEventListener('click',     e => {
      if (this._connecting) {
        this._connecting = null; this._tmp.setAttribute('display', 'none'); this._rc(); return;
      }
      this._selected = null; this._rc();
    });
  }

  _wireKeys() {
    const h = e => {
      if (!this.container.isConnected) { this._abortCtrl.abort(); return; }
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this._selected) {
        if (this._selected.kind === 'node') {
          this.data.nodes = this.data.nodes.filter(n => n.id !== this._selected.id);
          this.data.edges = this.data.edges.filter(e => e.from !== this._selected.id && e.to !== this._selected.id);
        } else {
          this.data.edges = this.data.edges.filter(e => e.id !== this._selected.id);
        }
        this._selected = null; this._rc();
        if (!this.data.nodes.length) this._showHint(true);
      }
    };
    document.addEventListener('keydown', h, { signal: this._abortCtrl.signal });
  }

  _pt(e) {
    const r = this._svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onNDown(e, id) {
    e.stopPropagation();
    if (this._connecting) {
      if (this._connecting !== id) this._addEdge(this._connecting, id);
      this._connecting = null; this._tmp.setAttribute('display', 'none'); this._rc(); return;
    }
    if (this._selected?.kind === 'node' && this._selected.id === id) {
      this._connecting = id; this._rc(); return;
    }
    this._selected = { kind: 'node', id };
    const n = this.data.nodes.find(n => n.id === id);
    const pt = this._pt(e);
    this._dragState = { nodeId: id, offX: pt.x - n.x, offY: pt.y - n.y };
    this._rc();
  }

  _onNDbl(e, id) {
    e.stopPropagation();
    const n = this.data.nodes.find(n => n.id === id);
    if (!n) return;
    const lbl = prompt('Label:', n.label);
    if (lbl !== null) { n.label = lbl; this._rc(); }
  }

  _addN(idx) {
    const shapes = PALETTE_SHAPES[this.umlType] || [];
    const s = shapes[idx]; if (!s) return;
    const c = this.data.nodes.length;
    this.data.nodes.push({ id:`n${++this._ns}`, type:s.type, label:s.label,
      fill:s.fill, stroke:s.stroke, x:30+(c%3)*(s.w+40), y:20+Math.floor(c/3)*(s.h+50), w:s.w, h:s.h });
    this._rc(); this._showHint(false);
  }

  _addEdge(from, to) {
    this.data.edges.push({ id:`e${++this._es}`, from, to, label:'', style:'association' });
  }

  _setEdge(style) {
    if (this._selected?.kind === 'edge') {
      const e = this.data.edges.find(e => e.id === this._selected.id);
      if (e) { e.style = style; this._rc(); }
    }
  }

  _showHint(show) {
    const h = document.getElementById(`ue-hint-${this._id}`);
    if (h) h.style.display = show ? '' : 'none';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function umlLabel(type) {
  return { none:'— None —', component:'Component', state:'State Machine',
           usecase:'Use Case', class:'Class Diagram' }[type] || type;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
