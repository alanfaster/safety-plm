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
import { loadColConfig, saveColConfig, applyColVisibility, wireColMgr } from '../components/col-mgr.js';

const SPEC_STATUSES = ['draft', 'review', 'approved'];
const SPEC_TYPES    = ['overview', 'component', 'interface', 'behavior', 'deployment', 'info'];
const UML_TYPES     = ['none', 'component', 'state', 'usecase', 'class'];

const SPEC_BUILTIN_COLS = [
  { id: 'drag',        name: '',            fixed: true,  visible: true },
  { id: 'id',          name: 'ID',          fixed: true,  visible: true },
  { id: 'description', name: 'Description', fixed: true,  visible: true },
  { id: 'system',      name: 'System',      visible: true },
  { id: 'type',        name: 'Type',        visible: true },
  { id: 'status',      name: 'Status',      visible: true },
  { id: 'actions',     name: '',            fixed: true,  visible: true },
];

// Module-level state
let _ctx       = null;   // { project, parentType, parentId }
let _items     = [];     // ordered array of spec items (in-memory cache)
let _umlOpenId = null;   // id of item whose UML editor is currently open
let _cols      = [];     // active column config
let _builtins  = SPEC_BUILTIN_COLS; // builtins + project custom cols
let _collapsed = new Set(); // collapsed section ids

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderArchSpec(container, { project, item, system, parentType, parentId }) {
  _ctx       = { project, parentType, parentId };
  _items     = [];
  _umlOpenId = null;
  _builtins  = SPEC_BUILTIN_COLS; // will be updated in loadSpec after project_config fetch
  _cols      = loadColConfig(`spec_${parentId}`, _builtins);
  _collapsed = new Set();

  // Remove any leftover insert pill from a previous render
  document.getElementById('spec-insert-pill')?.remove();

  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>Architecture Specification</h1>
          <p class="text-muted">${esc(parentName)}</p>
        </div>
        <div></div>
      </div>
    </div>
    <div class="page-body spec-page-body" id="spec-outer">
      <nav class="spec-nav" id="spec-nav">
        <button class="spec-nav-expand" id="spec-nav-expand" title="Open navigation">
          <span>❯</span>
          <span class="spec-nav-rail-label">Contents</span>
        </button>
        <div class="spec-nav-hdr">
          <span class="spec-nav-title">Contents</span>
          <button class="btn-icon spec-nav-close" id="spec-nav-close" title="Close">✕</button>
        </div>
        <div class="spec-nav-tree" id="spec-nav-tree"></div>
      </nav>
      <div class="spec-content" id="spec-body">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
    </div>
    <div class="spec-fab" id="spec-fab">
      <button class="btn btn-primary"   id="btn-new-spec">＋ New Item</button>
      <button class="btn btn-secondary" id="btn-new-spec-section">＋ Section</button>
    </div>
  `;

  document.getElementById('btn-new-spec').onclick         = () => addRow(null);
  document.getElementById('btn-new-spec-section').onclick  = () => addSection(null);
  document.getElementById('spec-nav-close').onclick        = () => toggleNav(false);
  document.getElementById('spec-nav-expand').onclick       = () => toggleNav(true);

  await loadSpec();
}

// ── Sync component spec items from architecture canvas ────────────────────────
// Called every time the arch-spec page opens so data stays fresh without needing
// to open the architecture canvas first.

async function syncComponentSpecItems() {
  const { parentType, parentId, project } = _ctx;

  // Fetch all components for this parent (include position columns for group reconciliation)
  const { data: components } = await sb.from('arch_components')
    .select('id,name,comp_type,data,x,y,width,height')
    .eq('parent_type', parentType)
    .eq('parent_id',   parentId);
  if (!components?.length) return;

  const specComponents = components.filter(c =>
    c.comp_type === 'HW' || c.comp_type === 'SW' || c.comp_type === 'Mechanical'
  );
  if (!specComponents.length) return;

  // Reconcile group membership from geometry (same logic as architecture canvas)
  const groups = components.filter(c => c.comp_type === 'Group');
  for (const c of components.filter(c => c.comp_type !== 'Group')) {
    const inside = groups.find(g =>
      c.x + c.width  / 2 > g.x && c.x + c.width  / 2 < g.x + g.width &&
      c.y + c.height / 2 > g.y && c.y + c.height / 2 < g.y + g.height
    );
    const correctGid = inside?.id || null;
    if ((c.data?.group_id || null) !== correctGid) {
      c.data = { ...(c.data || {}), group_id: correctGid };
    }
  }

  // Fetch systems linked to this item (for system name resolution)
  const itemId = parentType === 'item' ? parentId : null;
  const { data: systems } = itemId
    ? await sb.from('systems').select('id,name').eq('item_id', itemId)
    : { data: [] };
  const sysMap = Object.fromEntries((systems || []).map(s => [s.id, s]));

  // Existing spec items with component_ref_id
  const { data: existingSpec } = await sb.from('arch_spec_items')
    .select('id,title,system_name,component_ref_id,sort_order')
    .eq('parent_type', parentType)
    .eq('parent_id',   parentId)
    .not('component_ref_id', 'is', null);
  const specByCompId = Object.fromEntries((existingSpec || []).map(s => [s.component_ref_id, s]));

  // Find the "Architecture Components" section sort_order to place new items after it
  const compSection = _items.find(it => it.type === 'section' && it.custom_fields?.is_arch_components_section);
  let nextSortOrder = compSection ? (compSection.sort_order + 1) : _items.length;

  for (const c of specComponents) {
    const grp       = c.data?.group_id ? components.find(g => g.id === c.data.group_id) : null;
    const linkedSys = grp?.data?.system_id ? sysMap[grp.data.system_id] : null;
    const sysName   = linkedSys?.name || grp?.name || '';

    const existing = specByCompId[c.id];
    if (existing) {
      const patch = {};
      if (existing.title       !== c.name)  patch.title       = c.name;
      if (existing.system_name !== sysName) patch.system_name = sysName;
      if (Object.keys(patch).length) {
        await sb.from('arch_spec_items').update(patch).eq('id', existing.id);
        // Patch in _items memory so renderTable shows fresh data
        const mem = _items.find(it => it.id === existing.id);
        if (mem) Object.assign(mem, patch);
      }
    } else {
      const code = buildCode('AS', {
        domain:      parentType === 'item' ? 'ITEM' : 'SYS',
        projectName: project.name,
        index:       nextSortOrder,
      });
      const { data: newSpec } = await sb.from('arch_spec_items').insert({
        spec_code:        code,
        title:            c.name,
        type:             'component',
        status:           'draft',
        sort_order:       nextSortOrder++,
        parent_type:      parentType,
        parent_id:        parentId,
        project_id:       project.id,
        component_ref_id: c.id,
        system_name:      sysName,
        custom_fields:    {},
      }).select().single();
      if (newSpec) specByCompId[c.id] = newSpec;
    }
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadSpec() {
  // Load project custom column definitions from project_config
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', _ctx.project.id).maybeSingle();
  const archSpecCustomCols = (pcRow?.config?.arch_spec_custom_cols || []).map(c => ({
    id: c.id, name: c.name, type: c.type || 'text', custom: true, visible: true,
  }));
  // Rebuild builtins with custom cols appended (before the fixed 'actions' column)
  const actionCol = SPEC_BUILTIN_COLS.find(c => c.id === 'actions');
  _builtins = [
    ...SPEC_BUILTIN_COLS.filter(c => c.id !== 'actions'),
    ...archSpecCustomCols,
    ...(actionCol ? [actionCol] : []),
  ];
  _cols = loadColConfig(`spec_${_ctx.parentId}`, _builtins);

  const { data, error } = await sb.from('arch_spec_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true });

  const body = document.getElementById('spec-body');
  if (!body) return;

  if (error) {
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-danger)">
          <strong>Error loading arch_spec_items:</strong><br>
          <code>${esc(error.message || JSON.stringify(error))}</code><br>
          <span style="font-size:11px;color:var(--color-text-muted)">code: ${esc(error.code || '—')}</span>
        </p>
        <p style="margin-top:8px;font-size:13px">
          If the table does not exist, run <code>db/migration_arch_spec.sql</code> in Supabase SQL Editor.
        </p>
      </div></div>`;
    console.error('arch_spec_items load error:', error);
    return;
  }

  _items = data || [];

  // Sync component spec items from architecture canvas (upserts missing/stale rows)
  await syncComponentSpecItems();

  // Re-fetch after sync so newly created component rows appear
  const { data: refreshed } = await sb.from('arch_spec_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true });
  _items = refreshed || _items;

  // Auto-create "Architecture Components" section if missing
  const hasCompSection = _items.some(it =>
    it.type === 'section' && (it.custom_fields?.is_arch_components_section === true)
  );
  if (!hasCompSection) {
    const compItems = _items.filter(it => it.component_ref_id);
    const insertIdx = compItems.length ? _items.findIndex(it => it.id === compItems[0].id) : _items.length;
    const { data: sec } = await sb.from('arch_spec_items').insert({
      spec_code:   'SEC',
      title:       'Architecture Components',
      type:        'section',
      status:      'draft',
      sort_order:  insertIdx,
      parent_type: _ctx.parentType,
      parent_id:   _ctx.parentId,
      project_id:  _ctx.project.id,
      custom_fields: { section_level: 1, is_arch_components_section: true },
    }).select().single();
    if (sec) {
      _items.splice(insertIdx, 0, sec);
      // Re-assign sort_orders
      _items.forEach((it, i) => { it.sort_order = i; });
      await Promise.all(_items.map(it =>
        sb.from('arch_spec_items').update({ sort_order: it.sort_order }).eq('id', it.id)
      ));
    }
  }

  renderTable(body);
  buildNavTree();
}

// ── Section numbering ─────────────────────────────────────────────────────────

function computeSectionNumbers() {
  const counters = [0, 0, 0]; // H1, H2, H3
  const map = {};
  for (const it of _items) {
    if (it.type !== 'section') continue;
    const lvl = (it.custom_fields?.section_level || 1) - 1; // 0-based
    counters[lvl]++;
    // Reset deeper levels
    for (let i = lvl + 1; i < 3; i++) counters[i] = 0;
    map[it.id] = counters.slice(0, lvl + 1).join('.');
  }
  return map;
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

  // Build thead in _cols order (only visible cols)
  const TH_META = {
    drag:        { style: 'width:18px;padding:0', label: '' },
    id:          { style: 'width:88px',            label: 'ID' },
    description: { style: '',                      label: 'Description' },
    system:      { style: 'width:120px',           label: 'System',  managed: true },
    type:        { style: 'width:130px',           label: 'Type',    managed: true },
    status:      { style: 'width:120px',           label: 'Status',  managed: true },
    actions:     { style: 'width:120px',           label: '' },
  };
  const visibleCols = _cols.filter(c => c.visible);
  const theadHtml = visibleCols.map(c => {
    const meta = TH_META[c.id] || { style: '', label: esc(c.name), managed: true };
    const managed = (meta.managed || c.custom) ? ' class="col-managed"' : '';
    const style   = meta.style ? ` style="${meta.style}"` : '';
    return `<th data-col="${esc(c.id)}"${style}${managed}>${c.custom ? esc(c.name) : meta.label}</th>`;
  }).join('');

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table spec-table" id="spec-table">
          <thead>
            <tr id="spec-thead-row">${theadHtml}</tr>
          </thead>
          <tbody id="spec-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody   = document.getElementById('spec-tbody');
  const tableEl = document.getElementById('spec-table');
  const theadRow = document.getElementById('spec-thead-row');
  _items.forEach(it => appendRowToTbody(tbody, it));
  applyCollapsed();
  wireSpecDragDrop(tbody);

  if (tableEl && theadRow) {
    applyColVisibility(tableEl, _cols);
    wireColMgr(theadRow, tableEl, `spec_${_ctx.parentId}`, _cols, (updatedCols) => {
      _cols = updatedCols;
      renderTable(body);
    });
  }
  wireSpecCustomCols(tbody);
  wireInsertHover(tbody);
}

function appendRowToTbody(tbody, it) {
  const tr = buildRowEl(it);
  tbody.appendChild(tr);
  wireRow(tr, it);
}

function buildRowEl(it) {
  const tr = document.createElement('tr');
  tr.dataset.id    = it.id;
  tr.dataset.order = it.sort_order ?? 0;
  if (it.type === 'section') {
    tr.className = 'spec-section-row';
    tr.draggable = false;
    tr.innerHTML = sectionRowHTML(it);
  } else {
    tr.className = 'spec-row';
    tr.draggable = true;
    tr.innerHTML = rowHTML(it);
  }
  return tr;
}

function sectionRowHTML(it) {
  const level     = it.custom_fields?.section_level || 1;
  const collapsed = _collapsed.has(it.id);
  const nums      = computeSectionNumbers();
  const num       = nums[it.id] || '';
  return `
    <td class="spec-section-cell" colspan="20">
      <div class="spec-section-inner spec-section-inner--l${level}">
        <button class="spec-section-toggle${collapsed ? ' collapsed' : ''}" title="Expand/Collapse">▼</button>
        <span class="spec-section-num spec-section-num--l${level}">${esc(num)}</span>
        <input class="spec-section-title spec-section-title--l${level}" value="${esc(it.title || '')}" placeholder="Section title…" />
        <div class="spec-section-actions">
          <button class="btn btn-ghost btn-xs spec-sec-level-up"   title="Promote to H${Math.max(level-1,1)}">◀</button>
          <button class="btn btn-ghost btn-xs spec-sec-level-down" title="Demote to H${Math.min(level+1,3)}">▶</button>
          <span style="width:1px;height:14px;background:var(--color-border);display:inline-block;margin:0 2px"></span>
          <button class="btn btn-ghost btn-xs spec-sec-move-up"    title="Move section up (with contents)">↑</button>
          <button class="btn btn-ghost btn-xs spec-sec-move-dn"    title="Move section down (with contents)">↓</button>
          <button class="btn btn-ghost btn-xs spec-sec-del"        title="Delete section" style="color:var(--color-danger)">✕</button>
        </div>
      </div>
    </td>
  `;
}

function rowHTML(it) {
  const visibleCols = _cols.filter(c => c.visible);
  return visibleCols.map(c => {
    switch (c.id) {
      case 'drag':
        return `<td data-col="drag" class="req-drag-handle spec-drag-handle" title="Drag to reorder">⠿</td>`;
      case 'id':
        return `<td data-col="id" class="spec-id-cell code-cell">${esc(it.spec_code)}</td>`;
      case 'description':
        return `<td data-col="description" class="spec-desc-cell">
          ${it.component_ref_id ? '<span class="spec-auto-badge" title="Name synced from Architecture Concept (read-only)">AUTO</span>' : ''}
          <div class="spec-text-view" title="${it.component_ref_id ? 'Name synced from Architecture Concept — read only' : 'Double-click to edit'}"
            >${esc(it.title || '')}<span class="spec-placeholder ${it.title ? 'hidden' : ''}">Double-click to add description…</span></div>
          <div class="spec-uml-area" id="uml-area-${it.id}">${umlAreaPreviewHTML(it)}</div>
        </td>`;
      case 'system':
        return `<td data-col="system" style="font-size:12px;color:var(--color-text-muted);white-space:nowrap">${esc(it.system_name || '—')}</td>`;
      case 'type':
        return `<td data-col="type">
          <select class="form-input form-select spec-type-sel" data-field="type">
            ${SPEC_TYPES.map(v => `<option value="${v}" ${it.type === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </td>`;
      case 'status':
        return `<td data-col="status">
          <select class="form-input form-select spec-status-sel" data-field="status">
            ${SPEC_STATUSES.map(v => `<option value="${v}" ${it.status === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </td>`;
      case 'actions':
        return `<td data-col="actions" class="spec-row-actions">
          <button class="btn btn-ghost btn-xs spec-move-up"   title="Move up">↑</button>
          <button class="btn btn-ghost btn-xs spec-move-dn"   title="Move down">↓</button>
          <button class="btn btn-ghost btn-xs spec-add-below" title="Add row below">+</button>
          <button class="btn btn-ghost btn-xs spec-del-btn"   title="Delete row" style="color:var(--color-danger)">✕</button>
        </td>`;
      default:
        if (c.custom) {
          return `<td data-col="${esc(c.id)}" class="spec-custom-cell" data-item-id="${it.id}" data-custom-col="${esc(c.id)}"
            title="Click to edit" style="cursor:text;font-size:12px;color:#444;min-width:80px">
            ${esc((it.custom_fields || {})[c.id] || '')}
          </td>`;
        }
        return '';
    }
  }).join('');
}

function umlAreaPreviewHTML(it) {
  const hasUml = !!(it.uml_data?.nodes?.length);
  if (!hasUml) {
    return `<button class="spec-add-uml-btn btn btn-ghost btn-xs">◈ Add diagram</button>`;
  }
  return `
    <div class="spec-uml-inline">
      <div class="spec-uml-inline-header">
        <span class="spec-uml-badge">◈ ${umlLabel(it.uml_type)}</span>
        <button class="spec-uml-expand-btn" title="Expand / collapse">▼</button>
      </div>
      <div class="spec-uml-thumb collapsed" title="Double-click to edit diagram">
        ${umlPreviewSVG(it.uml_data)}
      </div>
    </div>`;
}

// ── Row Wiring ────────────────────────────────────────────────────────────────

function wireRow(tr, it) {
  if (it.type === 'section') { wireSectionRow(tr, it); return; }

  // ── Text description: double-click to edit, blur to save ─────────────────
  const textView = tr.querySelector('.spec-text-view');
  const placeholder = tr.querySelector('.spec-placeholder');

  textView.addEventListener('dblclick', () => {
    if (it.component_ref_id) return; // read-only: name comes from architecture
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

  // ── UML area ──────────────────────────────────────────────────────────────
  wireUmlArea(it);

  // ── Row actions ───────────────────────────────────────────────────────────
  tr.querySelector('.spec-move-up').addEventListener('click',   () => moveRow(it.id, -1));
  tr.querySelector('.spec-move-dn').addEventListener('click',   () => moveRow(it.id,  1));
  tr.querySelector('.spec-add-below').addEventListener('click', () => addRow(it.id));
  tr.querySelector('.spec-del-btn').addEventListener('click',   () => deleteRow(it));
}

// ── Section row wiring ────────────────────────────────────────────────────────

function wireSectionRow(tr, it) {
  const toggle = tr.querySelector('.spec-section-toggle');
  toggle.addEventListener('click', () => {
    const isCollapsed = _collapsed.has(it.id);
    if (isCollapsed) _collapsed.delete(it.id); else _collapsed.add(it.id);
    toggle.classList.toggle('collapsed', !isCollapsed);
    applyCollapsed();
  });

  const titleInput = tr.querySelector('.spec-section-title');
  titleInput.addEventListener('change', async () => {
    const val = titleInput.value.trim();
    if (val === (it.title || '')) return;
    it.title = val;
    await autosave(it.id, { title: val });
    buildNavTree();
  });
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    if (e.key === 'Escape') { titleInput.value = it.title || ''; titleInput.blur(); }
  });

  const levelUp = tr.querySelector('.spec-sec-level-up');
  const levelDown = tr.querySelector('.spec-sec-level-down');

  levelUp.addEventListener('click', async () => {
    const level = it.custom_fields?.section_level || 1;
    if (level <= 1) return;
    it.custom_fields = { ...(it.custom_fields || {}), section_level: level - 1 };
    await autosave(it.id, { custom_fields: it.custom_fields });
    refreshAllSectionRows();
    buildNavTree();
  });

  levelDown.addEventListener('click', async () => {
    const level = it.custom_fields?.section_level || 1;
    if (level >= 3) return;
    it.custom_fields = { ...(it.custom_fields || {}), section_level: level + 1 };
    await autosave(it.id, { custom_fields: it.custom_fields });
    refreshAllSectionRows();
    buildNavTree();
  });

  tr.querySelector('.spec-sec-move-up').addEventListener('click', () => moveSectionBlock(it.id, -1));
  tr.querySelector('.spec-sec-move-dn').addEventListener('click', () => moveSectionBlock(it.id,  1));
  tr.querySelector('.spec-sec-del').addEventListener('click', () => deleteRow(it));
}

function applyCollapsed() {
  const tbody = document.getElementById('spec-tbody');
  if (!tbody) return;
  let currentSectionCollapsed = false;
  _items.forEach(it => {
    const tr = tbody.querySelector(`[data-id="${it.id}"]`);
    if (!tr) return;
    if (it.type === 'section') {
      currentSectionCollapsed = _collapsed.has(it.id);
      tr.classList.remove('spec-row--hidden');
    } else {
      tr.classList.toggle('spec-row--hidden', currentSectionCollapsed);
    }
  });
}

// Re-render all section rows in place (refreshes indices after level/order change)
function refreshAllSectionRows() {
  const tbody = document.getElementById('spec-tbody');
  if (!tbody) return;
  _items.filter(it => it.type === 'section').forEach(it => {
    const tr = tbody.querySelector(`[data-id="${it.id}"]`);
    if (!tr) return;
    tr.innerHTML = sectionRowHTML(it);
    wireSectionRow(tr, it);
  });
}

// ── Section block move (section + all its children together) ──────────────────

async function moveSectionBlock(sectionId, dir) {
  const secIdx = _items.findIndex(it => it.id === sectionId);
  if (secIdx < 0) return;

  // Collect this block: section + following non-section items
  let blockEnd = secIdx + 1;
  while (blockEnd < _items.length && _items[blockEnd].type !== 'section') blockEnd++;
  const blockSize = blockEnd - secIdx; // items in this block

  if (dir === -1) {
    // Move up: find start of previous block
    if (secIdx === 0) return; // already first
    let prevSecIdx = secIdx - 1;
    while (prevSecIdx > 0 && _items[prevSecIdx].type !== 'section') prevSecIdx--;
    // If prevSecIdx is not a section, items above are headerless — swap block one position up
    if (_items[prevSecIdx].type !== 'section') {
      if (secIdx === 0) return;
      const block = _items.splice(secIdx, blockSize);
      _items.splice(Math.max(0, secIdx - 1), 0, ...block);
    } else {
      // prevSecIdx is a section — swap this block with the previous block
      const prevBlockSize = secIdx - prevSecIdx;
      const thisBlock = _items.splice(secIdx, blockSize);
      const prevBlock = _items.splice(prevSecIdx, prevBlockSize);
      _items.splice(prevSecIdx,              0, ...thisBlock);
      _items.splice(prevSecIdx + blockSize,  0, ...prevBlock);
    }
  } else {
    // Move down: swap with the next block
    if (blockEnd >= _items.length) return; // already last block
    let nextBlockEnd = blockEnd + 1;
    while (nextBlockEnd < _items.length && _items[nextBlockEnd].type !== 'section') nextBlockEnd++;
    const nextBlockSize = nextBlockEnd - blockEnd;

    const thisBlock = _items.splice(secIdx, blockSize);
    const nextBlock = _items.splice(secIdx, nextBlockSize); // indices shifted after splice
    _items.splice(secIdx,              0, ...nextBlock);
    _items.splice(secIdx + nextBlockSize, 0, ...thisBlock);
  }

  // Re-assign sort_orders
  _items.forEach((it, i) => { it.sort_order = i; });
  await Promise.all(_items.map(it =>
    sb.from('arch_spec_items').update({ sort_order: it.sort_order }).eq('id', it.id)
  ));

  // Rebuild DOM
  const tbody = document.getElementById('spec-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  _items.forEach(it => appendRowToTbody(tbody, it));
  applyCollapsed();
  buildNavTree();
}

// ── Nav Tree ──────────────────────────────────────────────────────────────────

function buildNavTree() {
  const tree = document.getElementById('spec-nav-tree');
  if (!tree) return;
  const sections = _items.filter(it => it.type === 'section');
  if (!sections.length) {
    tree.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:var(--color-text-muted);font-style:italic">No sections</div>';
    return;
  }
  const nums = computeSectionNumbers();
  tree.innerHTML = sections.map(sec => {
    const level = sec.custom_fields?.section_level || 1;
    const num   = nums[sec.id] || '';
    return `<div class="spec-nav-item spec-nav-item--l${level}" data-sec-id="${sec.id}">
      <span class="spec-nav-num">${esc(num)}</span> ${esc(sec.title || 'Untitled section')}
    </div>`;
  }).join('');

  tree.querySelectorAll('.spec-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const tr = document.querySelector(`[data-id="${el.dataset.secId}"]`);
      if (!tr) return;
      tr.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tr.style.outline = '2px solid var(--color-primary)';
      setTimeout(() => { tr.style.outline = ''; }, 1800);
    });
  });
}

function toggleNav(force) {
  const nav = document.getElementById('spec-nav');
  if (!nav) return;
  const makeVisible = force !== undefined ? force : nav.classList.contains('spec-nav--hidden');
  nav.classList.toggle('spec-nav--hidden', !makeVisible);
}

// ── Add Section ───────────────────────────────────────────────────────────────

async function addSection(afterId) {
  let sortOrder;
  if (afterId === null) {
    sortOrder = _items.length;
  } else {
    const pos = _items.findIndex(it => it.id === afterId);
    sortOrder = pos >= 0 ? pos + 1 : _items.length;
    await Promise.all(
      _items.slice(sortOrder).map((it, i) =>
        sb.from('arch_spec_items').update({ sort_order: sortOrder + 1 + i }).eq('id', it.id)
      )
    );
  }

  const { data: newSec, error } = await sb.from('arch_spec_items').insert({
    spec_code:     'SEC',
    title:         'New Section',
    type:          'section',
    status:        'draft',
    sort_order:    sortOrder,
    parent_type:   _ctx.parentType,
    parent_id:     _ctx.parentId,
    project_id:    _ctx.project.id,
    custom_fields: { section_level: 1 },
  }).select().single();

  if (error) { toast('Error creating section.', 'error'); return; }

  if (afterId === null) {
    _items.push(newSec);
  } else {
    const pos = _items.findIndex(it => it.id === afterId);
    _items.splice(pos >= 0 ? pos + 1 : _items.length, 0, newSec);
  }

  if (!document.getElementById('spec-tbody')) {
    renderTable(document.getElementById('spec-body'));
    return;
  }

  const tbody = document.getElementById('spec-tbody');
  const tr = buildRowEl(newSec);
  if (afterId === null) {
    tbody.appendChild(tr);
  } else {
    const refRow = tbody.querySelector(`[data-id="${afterId}"]`);
    refRow ? refRow.after(tr) : tbody.appendChild(tr);
  }
  wireRow(tr, newSec);
  buildNavTree();

  // Focus the title input so user can rename immediately
  tr.querySelector('.spec-section-title')?.select();
}

// ── UML Area wiring (preview ↔ editor) ───────────────────────────────────────

function wireUmlArea(it) {
  const area = document.getElementById(`uml-area-${it.id}`);
  if (!area) return;

  // Expand / collapse thumb
  const expandBtn = area.querySelector('.spec-uml-expand-btn');
  const thumb     = area.querySelector('.spec-uml-thumb');
  if (expandBtn && thumb) {
    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      thumb.classList.toggle('collapsed');
      const isCollapsed = thumb.classList.contains('collapsed');
      expandBtn.textContent = isCollapsed ? '▼' : '▲';
      // When expanding, fit SVG to full viewBox height
      if (!isCollapsed) {
        const svg = thumb.querySelector('.uml-prev-svg');
        if (svg) {
          const vb = svg.getAttribute('viewBox');
          if (vb) {
            const parts = vb.split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts[3] > 0) {
              // Set height so the full diagram is visible at 100% width
              const w = thumb.clientWidth || 600;
              const ratio = parts[3] / parts[2];
              svg.style.height = `${Math.max(120, Math.round(w * ratio))}px`;
            }
          }
        }
      } else {
        const svg = thumb.querySelector('.uml-prev-svg');
        if (svg) svg.style.height = '';
      }
    });
    // Double-click on thumb → open inline editor
    thumb.addEventListener('dblclick', () => openUmlEditor(it));
  }

  // "Add diagram" button when no UML yet
  const addBtn = area.querySelector('.spec-add-uml-btn');
  if (addBtn) addBtn.addEventListener('click', () => openUmlEditor(it));
}

function openUmlEditor(it) {
  // Close any other open editor first
  if (_umlOpenId && _umlOpenId !== it.id) {
    const other = _items.find(i => i.id === _umlOpenId);
    if (other) restoreUmlPreview(other);
  }
  _umlOpenId = it.id;

  const area = document.getElementById(`uml-area-${it.id}`);
  if (!area) return;

  // Replace area content with inline editor
  area.innerHTML = `
    <div class="spec-uml-editor-inline">
      <div class="spec-uml-edit-bar">
        <select class="form-input form-select form-select-sm" id="ue-type-${it.id}" style="width:150px">
          ${UML_TYPES.map(u => `<option value="${u}" ${(it.uml_type || 'component') === u ? 'selected' : ''}>${umlLabel(u)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-xs" id="ue-clear-${it.id}">Clear</button>
        <div class="uml-zoom-bar">
          <button class="btn btn-ghost btn-xs" id="ue-zout-${it.id}" title="Zoom out">−</button>
          <span class="uml-zoom-lbl" id="ue-zlbl-${it.id}">100%</span>
          <button class="btn btn-ghost btn-xs" id="ue-zin-${it.id}"  title="Zoom in">+</button>
          <button class="btn btn-ghost btn-xs" id="ue-fit-${it.id}"  title="Fit all">⊡</button>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-xs"    id="ue-cancel-${it.id}">Cancel</button>
        <button class="btn btn-primary btn-xs"  id="ue-save-${it.id}">Save</button>
      </div>
      <div id="ue-canvas-${it.id}"></div>
      <div class="spec-uml-resize-handle" id="ue-resize-${it.id}" title="Drag to resize">⋯</div>
    </div>
  `;

  const editor = new UMLEditor(
    document.getElementById(`ue-canvas-${it.id}`),
    it.uml_type || 'component',
    it.uml_data || null,
    `ue-zlbl-${it.id}`
  );

  document.getElementById(`ue-type-${it.id}`).onchange   = e => editor.setType(e.target.value);
  document.getElementById(`ue-clear-${it.id}`).onclick   = () => editor.clear();
  document.getElementById(`ue-zout-${it.id}`).onclick    = () => editor.zoomOut();
  document.getElementById(`ue-zin-${it.id}`).onclick     = () => editor.zoomIn();
  document.getElementById(`ue-fit-${it.id}`).onclick     = () => editor.autofit();

  // Resize handle
  const resizeHandle = document.getElementById(`ue-resize-${it.id}`);
  const canvasDiv    = document.getElementById(`ue-canvas-${it.id}`);
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY  = e.clientY;
    const umlEl   = canvasDiv.querySelector('.uml-editor');
    const startH  = umlEl ? umlEl.offsetHeight : 340;
    const onMove  = mv => {
      const newH = Math.max(200, startH + (mv.clientY - startY));
      if (umlEl) umlEl.style.height = `${newH}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  document.getElementById(`ue-cancel-${it.id}`).onclick  = () => {
    editor.destroy();
    _umlOpenId = null;
    restoreUmlPreview(it);
  };

  document.getElementById(`ue-save-${it.id}`).onclick    = async () => {
    const umlType = document.getElementById(`ue-type-${it.id}`).value;
    const umlData = editor.getData();
    const hasUml  = umlData.nodes.length > 0;

    const btn = document.getElementById(`ue-save-${it.id}`);
    btn.disabled = true;
    const { error } = await sb.from('arch_spec_items').update({
      uml_type:   hasUml && umlType !== 'none' ? umlType : null,
      uml_data:   hasUml ? umlData : null,
      updated_at: new Date().toISOString(),
    }).eq('id', it.id);
    btn.disabled = false;

    if (error) { toast('Error saving diagram.', 'error'); return; }

    it.uml_type = hasUml && umlType !== 'none' ? umlType : null;
    it.uml_data = hasUml ? umlData : null;
    toast('Diagram saved.', 'success');
    editor.destroy();
    _umlOpenId = null;
    restoreUmlPreview(it);
  };
}

function restoreUmlPreview(it) {
  const area = document.getElementById(`uml-area-${it.id}`);
  if (!area) return;
  area.innerHTML = umlAreaPreviewHTML(it);
  wireUmlArea(it);
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
  const tr = buildRowEl(newItem);
  if (afterId === null) {
    tbody.appendChild(tr);
  } else {
    const refRow = document.querySelector(`tr.spec-row[data-id="${afterId}"]`);
    refRow ? refRow.after(tr) : tbody.appendChild(tr);
  }
  wireRow(tr, newItem);

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
  applyCollapsed();
  buildNavTree();
}

async function deleteRow(it) {
  const label = it.type === 'section' ? `section "${it.title || 'Untitled'}"` : `item "${it.spec_code}"`;
  if (!confirm(`Delete ${label}?`)) return;

  // Close UML editor if open
  if (_umlOpenId === it.id) closeUmlEditor(it.id);

  const { error } = await sb.from('arch_spec_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }

  _items = _items.filter(i => i.id !== it.id);
  if (it.type === 'section') _collapsed.delete(it.id);

  // Remove row from DOM (section rows and regular rows have different classes)
  document.querySelector(`[data-id="${it.id}"]`)?.remove();
  applyCollapsed();

  if (it.type === 'section') buildNavTree();

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

// ── Custom column inline editing ─────────────────────────────────────────────

function wireSpecCustomCols(tbody) {
  tbody.querySelectorAll('.spec-custom-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (cell.querySelector('input')) return;
      const itemId  = cell.dataset.itemId;
      const colId   = cell.dataset.customCol;
      const it      = _items.find(i => i.id === itemId);
      const current = (it?.custom_fields || {})[colId] || '';

      const inp = document.createElement('input');
      inp.value = current;
      inp.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:12px;font-family:inherit;background:#EEF4FF';
      cell.innerHTML = '';
      cell.appendChild(inp);
      inp.focus(); inp.select();

      const commit = async () => {
        const val = inp.value.trim();
        cell.textContent = val;
        if (!it) return;
        const fields = { ...(it.custom_fields || {}), [colId]: val };
        it.custom_fields = fields;
        await autosave(itemId, { custom_fields: fields });
      };

      inp.addEventListener('blur',    commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { cell.textContent = current; }
      });
    });
  });
}

// ── Hover insert button ───────────────────────────────────────────────────────

function wireInsertHover(tbody) {
  // Single floating pill reused across all rows
  let pill = document.getElementById('spec-insert-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id        = 'spec-insert-pill';
    pill.className = 'spec-insert-pill';
    pill.innerHTML = `
      <span class="spec-insert-line"></span>
      <button class="spec-insert-plus spec-insert-item" tabindex="-1" title="Add specification item here">＋ Item</button>
      <button class="spec-insert-plus spec-insert-section" tabindex="-1" title="Add section here">＋ Section</button>
      <span class="spec-insert-line"></span>`;
    document.body.appendChild(pill);
  }

  let afterId   = null;
  let afterType = null;
  let hideTimer = null;

  function showPill(tr) {
    const it = _items.find(i => i.id === tr.dataset.id);
    if (!it) return;
    afterId   = it.id;
    afterType = it.type === 'section' ? 'section' : 'item';

    const rect = tr.getBoundingClientRect();
    pill.style.top   = (rect.bottom - 9) + 'px';
    pill.style.left  = rect.left + 'px';
    pill.style.width = rect.width + 'px';
    pill.setAttribute('data-type', afterType);
    pill.style.display = 'flex';
    clearTimeout(hideTimer);
  }

  function hidePill() {
    hideTimer = setTimeout(() => { pill.style.display = 'none'; afterId = null; }, 120);
  }

  tbody.addEventListener('mousemove', e => {
    const tr = e.target.closest('tr');
    if (!tr || tr.classList.contains('spec-row--hidden')) { hidePill(); return; }
    const rect = tr.getBoundingClientRect();
    // Only activate in the bottom 35% of the row
    if (e.clientY > rect.bottom - rect.height * 0.35) {
      showPill(tr);
    } else {
      hidePill();
    }
  });

  tbody.addEventListener('mouseleave', hidePill);

  // Keep pill alive when hovering over it
  pill.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pill.addEventListener('mouseleave', hidePill);

  pill.querySelector('.spec-insert-item').addEventListener('click', () => {
    pill.style.display = 'none';
    if (afterId) addRow(afterId);
  });
  pill.querySelector('.spec-insert-section').addEventListener('click', () => {
    pill.style.display = 'none';
    if (afterId) addSection(afterId);
  });
}

// ── Drag-and-drop reorder ─────────────────────────────────────────────────────

function wireSpecDragDrop(tbody) {
  let dragId = null;
  let dragTr = null;

  function clearLines() {
    tbody.querySelectorAll('.req-drop-above, .req-drop-below').forEach(el =>
      el.classList.remove('req-drop-above', 'req-drop-below')
    );
  }

  tbody.querySelectorAll('tr.spec-row').forEach(tr => {
    tr.addEventListener('dragstart', e => {
      if (!e.target.closest('.spec-drag-handle') && e.target !== tr) {
        e.preventDefault(); return;
      }
      dragId = tr.dataset.id;
      dragTr = tr;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => tr.classList.add('req-row-dragging'), 0);
    });

    tr.addEventListener('dragend', () => {
      tr.classList.remove('req-row-dragging');
      clearLines();
      dragId = null; dragTr = null;
    });
  });

  tbody.addEventListener('dragover', e => {
    if (!dragId) return;
    const tr = e.target.closest('tr.spec-row');
    if (!tr || tr.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearLines();
    const rect = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < rect.top + rect.height / 2 ? 'req-drop-above' : 'req-drop-below');
  });

  tbody.addEventListener('dragleave', e => {
    const tr = e.target.closest('tr.spec-row');
    if (tr && !tr.contains(e.relatedTarget)) {
      tr.classList.remove('req-drop-above', 'req-drop-below');
    }
  });

  tbody.addEventListener('drop', async e => {
    const tr = e.target.closest('tr.spec-row');
    if (!tr || !dragId || !dragTr) return;
    e.preventDefault();
    clearLines();

    const targetId = tr.dataset.id;
    if (targetId === dragId) return;

    const capturedDragId = dragId;

    const rect   = tr.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;

    const fromIdx = _items.findIndex(it => it.id === capturedDragId);
    const [moved] = _items.splice(fromIdx, 1);
    let toIdx = _items.findIndex(it => it.id === targetId);
    if (!before) toIdx += 1;
    _items.splice(toIdx, 0, moved);

    _items.forEach((it, i) => { it.sort_order = i; });

    await Promise.all(_items.map(it =>
      sb.from('arch_spec_items').update({ sort_order: it.sort_order }).eq('id', it.id)
    ));

    // Reorder DOM
    _items.forEach(it => {
      const row = tbody.querySelector(`[data-id="${it.id}"]`);
      if (row) tbody.appendChild(row);
    });
    applyCollapsed();
    buildNavTree();
  });
}

// ── UML Preview SVG ───────────────────────────────────────────────────────────

function umlPreviewSVG(umlData) {
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
  constructor(container, umlType, initData, zoomLabelId) {
    this._id         = ++_ueSeq;
    this.container   = container;
    this.umlType     = umlType || 'component';
    this.data        = initData ? JSON.parse(JSON.stringify(initData)) : { nodes: [], edges: [] };
    this._ns         = this.data.nodes.length;
    this._es         = this.data.edges.length;
    this._selected   = null;
    this._connecting = null;
    this._dragState  = null;
    this._panState   = null;
    this._zoom       = 1;
    this._panX       = 20;
    this._panY       = 20;
    this._zoomLblId  = zoomLabelId || null;
    this._abortCtrl  = new AbortController();
    this._build();
  }

  setType(t)  { this.umlType = t; this._pal(); }
  clear()     { this.data = { nodes: [], edges: [] }; this._selected = null; this._connecting = null; this._rc(); this._showHint(true); }
  getData()   { return JSON.parse(JSON.stringify(this.data)); }
  destroy()   { this._abortCtrl.abort(); }

  zoomIn()    { this._zoomAt(1.25, this._svgW()/2, this._svgH()/2); }
  zoomOut()   { this._zoomAt(0.8,  this._svgW()/2, this._svgH()/2); }
  autofit()   {
    if (!this.data.nodes.length) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    this.data.nodes.forEach(n => { minX=Math.min(minX,n.x); minY=Math.min(minY,n.y); maxX=Math.max(maxX,n.x+n.w); maxY=Math.max(maxY,n.y+n.h); });
    const pad = 32;
    const W = this._svgW(), H = this._svgH();
    const scX = (W - pad*2) / (maxX - minX || 1);
    const scY = (H - pad*2) / (maxY - minY || 1);
    this._zoom = Math.min(scX, scY, 2);
    this._panX = pad - minX * this._zoom;
    this._panY = pad - minY * this._zoom;
    this._applyVp();
  }

  _svgW() { return this._svg.clientWidth  || 600; }
  _svgH() { return this._svg.clientHeight || 340; }

  _zoomAt(factor, cx, cy) {
    const nz = Math.min(Math.max(this._zoom * factor, 0.2), 4);
    this._panX = cx - (cx - this._panX) * (nz / this._zoom);
    this._panY = cy - (cy - this._panY) * (nz / this._zoom);
    this._zoom = nz;
    this._applyVp();
  }

  _applyVp() {
    if (this._vp) this._vp.setAttribute('transform', `translate(${this._panX},${this._panY}) scale(${this._zoom})`);
    if (this._zoomLblId) {
      const lbl = document.getElementById(this._zoomLblId);
      if (lbl) lbl.textContent = `${Math.round(this._zoom * 100)}%`;
    }
  }

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
            <g id="ue-vp-${id}" transform="translate(20,20) scale(1)">
              <g id="ue-eg-${id}"></g>
              <g id="ue-ng-${id}"></g>
              <line id="ue-tmp-${id}" stroke="#F57C00" stroke-width="1.5"
                stroke-dasharray="5,3" display="none" pointer-events="none"/>
            </g>
          </svg>
          <div class="uml-hint" id="ue-hint-${id}">Click a shape in the palette to add it</div>
        </div>
      </div>`;

    this._svg    = document.getElementById(`ue-svg-${id}`);
    this._vp     = document.getElementById(`ue-vp-${id}`);
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
      const pt = this._worldPt(e);
      if (this._dragState) {
        const n = this.data.nodes.find(n => n.id === this._dragState.nodeId);
        if (n) { n.x = Math.max(0, pt.x - this._dragState.offX); n.y = Math.max(0, pt.y - this._dragState.offY); this._rc(); }
        return;
      }
      if (this._panState) {
        const sp = this._svgPt(e);
        this._panX = sp.x - this._panState.offX;
        this._panY = sp.y - this._panState.offY;
        this._applyVp();
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
    this._svg.addEventListener('mousedown', e => {
      if (e.target === this._svg || e.target === this._vp) {
        if (!this._connecting && !this._dragState) {
          const sp = this._svgPt(e);
          this._panState = { offX: sp.x - this._panX, offY: sp.y - this._panY };
        }
      }
    });
    this._svg.addEventListener('mouseup',   () => { this._dragState = null; this._panState = null; });
    this._svg.addEventListener('click',     e => {
      if (this._connecting) {
        this._connecting = null; this._tmp.setAttribute('display', 'none'); this._rc(); return;
      }
      this._selected = null; this._rc();
    });
    this._svg.addEventListener('wheel', e => {
      e.preventDefault();
      const sp = this._svgPt(e);
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      this._zoomAt(factor, sp.x, sp.y);
    }, { passive: false });
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

  _svgPt(e) {
    const r = this._svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _worldPt(e) {
    const p = this._svgPt(e);
    return { x: (p.x - this._panX) / this._zoom, y: (p.y - this._panY) / this._zoom };
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
    const pt = this._worldPt(e);
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
