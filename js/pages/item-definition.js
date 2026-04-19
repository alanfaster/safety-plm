/**
 * Item Definition page renderer.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  Description (text editor, saved to vcycle_docs) │
 *   ├──────────────────────────────────────────────┤
 *   │  ★ Features  │  ⊙ Use Cases  │  λ Functions  │
 *   │  (column 1)  │  (column 2)   │  (column 3)   │
 *   └──────────────────────────────────────────────┘
 *
 * Selecting a Feature filters Use Cases; selecting a UC filters Functions.
 * All columns support create / inline-rename / reorder / delete.
 *
 * Exported:
 *   renderItemDefinition(container, ctx)   — main renderer
 *   getFeaturesTree(parentType, parentId, domain) — for safety analysis
 *   ICONS                                  — { feat, uc, fun } for consistency
 */

import { sb, nextIndex, nameInitials } from '../config.js';

/**
 * Build hierarchical codes:
 *   Feature  → FEAT-{PROJ}-{IDX}               e.g. FEAT-EPB-001
 *   Use Case → UC-{PROJ}-F{FEAT_IDX}-{IDX}     e.g. UC-EPB-F001-001
 *   Function → FUN-{PROJ}-F{FEAT_IDX}-U{UC_IDX}-{IDX}  e.g. FUN-EPB-F001-U001-001
 * Unique per project because PROJ initials are embedded.
 */
function codeLastIdx(code) {
  // Extract last numeric segment: "FEAT-EPB-003" → "003"
  const parts = (code || '').split('-');
  return parts[parts.length - 1] || '001';
}
function pad(n) { return String(n).padStart(3, '0'); }
function featCode(projName, idx)            { return `FEAT-${nameInitials(projName)}-${pad(idx)}`; }
function ucCode(projName, featC, ucIdx)     { return `UC-${nameInitials(projName)}-F${codeLastIdx(featC)}-${pad(ucIdx)}`; }
function funCode(projName, featC, ucC, fnIdx) {
  return `FUN-${nameInitials(projName)}-F${codeLastIdx(featC)}-U${codeLastIdx(ucC)}-${pad(fnIdx)}`;
}
import { t } from '../i18n/index.js';
import { toast } from '../toast.js';
import { confirmDialog } from '../components/modal.js';

// ── Consistent icons (import these in other modules for consistency) ──────────
export const ICONS = {
  feat: '★',
  uc:   '⊙',
  fun:  'λ',
};

// ── Module-level state ────────────────────────────────────────────────────────
let _state = {
  parentType: null, parentId: null, domain: null,
  project: null, item: null, system: null,
  features: [], useCases: [], functions: [],
  selFeatId: null, selUCId: null,
  doc: null,
  functionTypes: [],   // [{id, name, failure_conditions:[]}] from project_config
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Context-aware title for the item_definition phase */
export function getDefinitionTitle(domain, parentType) {
  if (domain === 'sw')   return 'SW Definition';
  if (domain === 'hw')   return 'HW Definition';
  if (domain === 'mech') return 'MECH Definition';
  if (parentType === 'system') return 'System Definition';
  return 'Item Definition';
}

function getDefinitionHint(domain, parentType) {
  if (domain === 'sw')   return 'Define the SW scope, decomposition, allocated requirements, and interfaces.';
  if (domain === 'hw')   return 'Define the HW scope, components, environmental conditions, and constraints.';
  if (domain === 'mech') return 'Define the mechanical scope, structural elements, tolerances, and interfaces.';
  if (parentType === 'system') return 'Define the system scope, boundaries, interfaces, and operating conditions.';
  return 'Define the item scope, purpose, boundaries, and operating environment.';
}

export async function renderItemDefinition(container, { project, item, system, domain = 'system', pageId = null }) {
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;

  _state = {
    parentType, parentId, domain,
    project, item, system,
    features: [], useCases: [], functions: [],
    selFeatId: null, selUCId: null,
    doc: null,
  };

  // Load doc, features, and project config in parallel
  const [docResult, featResult, pcResult] = await Promise.all([
    loadDoc(parentType, parentId, domain, pageId, project.id),
    sb.from('features')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .eq('domain', domain)
      .order('sort_order')
      .order('created_at'),
    sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle(),
  ]);

  _state.doc           = docResult;
  _state.features      = featResult.data || [];
  _state.functionTypes = pcResult?.data?.config?.function_types || [];

  const status    = _state.doc?.status || 'draft';
  const textContent = _state.doc?.content?.text || '';
  const parentName  = system?.name || item?.name || '';
  const defTitle    = getDefinitionTitle(domain, parentType);
  const defHint     = getDefinitionHint(domain, parentType);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${escHtml(defTitle)}</h1>
          <p class="text-muted">${escHtml(parentName)} · ${escHtml(defTitle)}</p>
        </div>
        <div class="flex gap-2 items-center">
          <select class="form-input form-select" id="doc-status" style="width:140px">
            ${['draft','review','approved'].map(s =>
              `<option value="${s}" ${status === s ? 'selected' : ''}>${t(`common.${s}`)}</option>`
            ).join('')}
          </select>
          <button class="btn btn-primary" id="btn-save-doc">💾 ${t('common.save')}</button>
        </div>
      </div>
    </div>

    <div class="page-body idef-page-body">

      <!-- Description card -->
      <div class="card">
        <div class="card-header">
          <h3>${escHtml(defTitle)} — Description</h3>
          <div style="color:var(--color-primary);font-size:var(--text-sm)">ℹ️ ${escHtml(defHint)}</div>
        </div>
        <div class="card-body">
          <textarea class="form-input form-textarea" id="doc-text" rows="7"
            style="font-family:var(--font-mono);font-size:13px;resize:vertical"
            placeholder="Enter item definition content here...">${escHtml(textContent)}</textarea>
        </div>
      </div>

      <!-- Features / Use Cases / Functions panel -->
      <div class="card mt-4" id="fuf-card">
        <div class="card-header">
          <h3>Features · Use Cases · Functions</h3>
          <div class="flex items-center gap-2">
            <span class="text-muted" style="font-size:var(--text-xs)" id="fuf-hint">
              Select a Feature to see its Use Cases · Select a Use Case to see its Functions
            </span>
            <div class="fuf-view-toggle">
              <button class="fuf-toggle-btn active" id="btn-view-cols" title="Column view">⊞ Columns</button>
              <button class="fuf-toggle-btn"        id="btn-view-graph" title="Graph view">⬡ Graph</button>
            </div>
          </div>
        </div>
        <div id="fuf-panel">
          <div class="idef-fuf-wrap">
            <div class="idef-fuf-cols" id="fuf-cols">
              ${buildFeatCol(_state.features, _state.selFeatId)}
              ${buildUCCol([], _state.selFeatId, _state.selUCId)}
              ${buildFunCol([], _state.selUCId)}
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Save description
  document.getElementById('btn-save-doc').onclick = () => saveDoc(project, parentType, parentId, domain, pageId);

  // View toggle
  document.getElementById('btn-view-cols').onclick  = () => switchView('cols');
  document.getElementById('btn-view-graph').onclick = () => switchView('graph');

  // Wire FUF panel
  wireFUF();
}

/**
 * Returns the full feature tree for a given parent.
 * domain is optional — when omitted or null all domains are returned.
 * Used by safety analysis to access features/UC/functions.
 */
export async function getFeaturesTree(parentType, parentId, domain = null) {
  let q = sb.from('features')
    .select('*').eq('parent_type', parentType).eq('parent_id', parentId);
  if (domain) q = q.eq('domain', domain);
  const { data: features } = await q.order('sort_order').order('created_at');

  if (!features?.length) return [];

  const { data: useCases } = await sb.from('use_cases')
    .select('*').in('feature_id', features.map(f => f.id)).order('sort_order');

  const ucIds = (useCases || []).map(u => u.id);
  let functions = [];
  if (ucIds.length) {
    const { data: fns } = await sb.from('functions')
      .select('*').in('use_case_id', ucIds).order('sort_order');
    functions = fns || [];
  }

  return features.map(f => ({
    ...f,
    use_cases: (useCases || [])
      .filter(u => u.feature_id === f.id)
      .map(u => ({ ...u, functions: functions.filter(fn => fn.use_case_id === u.id) })),
  }));
}

// ── Column builders ───────────────────────────────────────────────────────────

function buildFeatCol(features, selId) {
  return `
    <div class="fuf-col" id="col-feat">
      <div class="fuf-col-header">
        <span class="fuf-col-icon feat-icon">${ICONS.feat}</span>
        <span class="fuf-col-title">Features</span>
        <button class="fuf-add-btn" id="btn-add-feat" title="Add Feature">＋</button>
      </div>
      <div class="fuf-col-body" id="list-feat">
        ${features.length
          ? features.map((f, i) => fufRow('feat', f, i, features.length, selId === f.id)).join('')
          : `<div class="fuf-empty">No features yet</div>`}
      </div>
    </div>`;
}

function buildUCCol(ucs, selFeatId, selId) {
  const empty = !selFeatId
    ? `<div class="fuf-empty fuf-hint">← Select a Feature</div>`
    : `<div class="fuf-empty">No use cases yet</div>`;
  return `
    <div class="fuf-col" id="col-uc">
      <div class="fuf-col-header">
        <span class="fuf-col-icon uc-icon">${ICONS.uc}</span>
        <span class="fuf-col-title">Use Cases</span>
        ${selFeatId ? `<button class="fuf-add-btn" id="btn-add-uc" title="Add Use Case">＋</button>` : ''}
      </div>
      <div class="fuf-col-body" id="list-uc">
        ${ucs.length ? ucs.map((u, i) => fufRow('uc', u, i, ucs.length, selId === u.id)).join('') : empty}
      </div>
    </div>`;
}

function buildFunCol(fns, selUCId) {
  const empty = !selUCId
    ? `<div class="fuf-empty fuf-hint">← Select a Use Case</div>`
    : `<div class="fuf-empty">No functions yet</div>`;
  return `
    <div class="fuf-col" id="col-fun">
      <div class="fuf-col-header">
        <span class="fuf-col-icon fun-icon">${ICONS.fun}</span>
        <span class="fuf-col-title">Functions</span>
        ${selUCId ? `<button class="fuf-add-btn" id="btn-add-fun" title="Add Function">＋</button>` : ''}
      </div>
      <div class="fuf-col-body" id="list-fun">
        ${fns.length ? fns.map((fn, i) => fufRow('fun', fn, i, fns.length, false)).join('') : empty}
      </div>
    </div>`;
}

function fufRow(type, item, idx, total, selected) {
  const code = item.feat_code || item.uc_code || item.func_code || '';
  const icon = ICONS[type === 'feat' ? 'feat' : type === 'uc' ? 'uc' : 'fun'];
  const upBtn   = idx > 0         ? `<button class="fuf-act fuf-up"  data-id="${item.id}" data-type="${type}" title="Move up">▲</button>` : '';
  const dnBtn   = idx < total - 1 ? `<button class="fuf-act fuf-dn"  data-id="${item.id}" data-type="${type}" title="Move down">▼</button>` : '';

  // Function type badge
  let ftBadge = '';
  if (type === 'fun' && item.function_type) {
    ftBadge = `<span class="fun-type-badge">${escHtml(item.function_type)}</span>`;
  }

  return `
    <div class="fuf-row ${selected ? 'selected' : ''}" data-id="${item.id}" data-type="${type}">
      <div class="fuf-row-main">
        <span class="fuf-icon ${type}-icon">${icon}</span>
        <div class="fuf-row-text">
          <span class="fuf-code">${escHtml(code)}</span>
          <span class="fuf-name">${escHtml(item.name)}</span>${ftBadge}
          ${item.description ? `<span class="fuf-desc">${escHtml(item.description)}</span>` : ''}
        </div>
      </div>
      <div class="fuf-actions">
        ${upBtn}${dnBtn}
        <button class="fuf-act fuf-edit" data-id="${item.id}" data-type="${type}" title="Edit">✎</button>
        <button class="fuf-act fuf-del"  data-id="${item.id}" data-type="${type}" data-name="${escHtml(item.name)}" title="Delete">✕</button>
      </div>
    </div>`;
}

// ── Wire panel events ─────────────────────────────────────────────────────────

function wireFUF() {
  const cols = document.getElementById('fuf-cols');
  if (!cols) return;

  // Select feature
  cols.addEventListener('click', async (e) => {
    const row = e.target.closest('.fuf-row');
    if (!row || e.target.closest('.fuf-actions')) return;

    const { id, type } = row.dataset;

    if (type === 'feat') {
      if (_state.selFeatId === id) return;
      _state.selFeatId = id;
      _state.selUCId   = null;
      _state.useCases  = [];
      _state.functions = [];
      refreshFeatCol();
      refreshFunCol();          // clear Functions column immediately
      await loadAndRenderUCs(id);
    } else if (type === 'uc') {
      if (_state.selUCId === id) return;
      _state.selUCId   = id;
      _state.functions = [];
      refreshUCCol();
      await loadAndRenderFuns(id);
    }
  });

  // Add buttons
  cols.addEventListener('click', async (e) => {
    const btn = e.target.closest('#btn-add-feat, #btn-add-uc, #btn-add-fun');
    if (!btn) return;
    e.stopPropagation();
    if (btn.id === 'btn-add-feat') await addItem('feat');
    else if (btn.id === 'btn-add-uc')  await addItem('uc');
    else if (btn.id === 'btn-add-fun') await addItem('fun');
  });

  // Reorder
  cols.addEventListener('click', async (e) => {
    const btn = e.target.closest('.fuf-up, .fuf-dn');
    if (!btn) return;
    e.stopPropagation();
    const { id, type } = btn.dataset;
    const dir = btn.classList.contains('fuf-up') ? -1 : 1;
    await reorderItem(type, id, dir);
  });

  // Edit (inline)
  cols.addEventListener('click', (e) => {
    const btn = e.target.closest('.fuf-edit');
    if (!btn) return;
    e.stopPropagation();
    const { id, type } = btn.dataset;
    openInlineEdit(type, id);
  });

  // Delete
  cols.addEventListener('click', async (e) => {
    const btn = e.target.closest('.fuf-del');
    if (!btn) return;
    e.stopPropagation();
    const { id, type, name } = btn.dataset;
    const typeLabel = type === 'feat' ? 'Feature' : type === 'uc' ? 'Use Case' : 'Function';
    confirmDialog(`Delete ${typeLabel} "${name}"?`, async () => {
      await deleteItem(type, id);
    });
  });
}

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadAndRenderUCs(featId) {
  const { data } = await sb.from('use_cases')
    .select('*').eq('feature_id', featId)
    .order('sort_order').order('created_at');
  _state.useCases = data || [];
  refreshUCCol();
}

async function loadAndRenderFuns(ucId) {
  const { data } = await sb.from('functions')
    .select('*').eq('use_case_id', ucId)
    .order('sort_order').order('created_at');
  _state.functions = data || [];
  refreshFunCol();
}

// ── Column refreshers ─────────────────────────────────────────────────────────

function refreshFeatCol() {
  document.getElementById('col-feat').outerHTML = buildFeatCol(_state.features, _state.selFeatId);
}
function refreshUCCol() {
  document.getElementById('col-uc').outerHTML = buildUCCol(_state.useCases, _state.selFeatId, _state.selUCId);
}
function refreshFunCol() {
  document.getElementById('col-fun').outerHTML = buildFunCol(_state.functions, _state.selUCId);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addItem(type) {
  const { parentType, parentId, domain, project } = _state;
  const projName = project?.name || '';

  if (type === 'feat') {
    const idx  = await nextIndex('features', { parent_id: parentId });
    const code = featCode(projName, idx);
    const { data, error } = await sb.from('features').insert({
      feat_code: code, parent_type: parentType, parent_id: parentId,
      domain, project_id: project.id,
      name: `Feature ${idx}`, sort_order: _state.features.length,
    }).select().single();
    if (error) { toast(t('common.error'), 'error'); return; }
    _state.features.push(data);
    refreshFeatCol();
    setTimeout(() => openInlineEdit('feat', data.id), 50);

  } else if (type === 'uc') {
    if (!_state.selFeatId) return;
    const parentFeat = _state.features.find(f => f.id === _state.selFeatId);
    const idx  = await nextIndex('use_cases', { feature_id: _state.selFeatId });
    const code = ucCode(projName, parentFeat?.feat_code || '', idx);
    const { data, error } = await sb.from('use_cases').insert({
      uc_code: code, feature_id: _state.selFeatId,
      name: `Use Case ${idx}`, sort_order: _state.useCases.length,
    }).select().single();
    if (error) { toast(t('common.error'), 'error'); return; }
    _state.useCases.push(data);
    refreshUCCol();
    setTimeout(() => openInlineEdit('uc', data.id), 50);

  } else if (type === 'fun') {
    if (!_state.selUCId) return;
    const parentFeat = _state.features.find(f => f.id === _state.selFeatId);
    const parentUC   = _state.useCases.find(u => u.id === _state.selUCId);
    const idx  = await nextIndex('functions', { use_case_id: _state.selUCId });
    const code = funCode(projName, parentFeat?.feat_code || '', parentUC?.uc_code || '', idx);
    const { data, error } = await sb.from('functions').insert({
      func_code: code, use_case_id: _state.selUCId,
      name: `Function ${idx}`, sort_order: _state.functions.length,
    }).select().single();
    if (error) { toast(t('common.error'), 'error'); return; }
    _state.functions.push(data);
    refreshFunCol();
    setTimeout(() => openInlineEdit('fun', data.id), 50);
  }
}

async function deleteItem(type, id) {
  if (type === 'feat') {
    await sb.from('features').delete().eq('id', id);
    _state.features = _state.features.filter(f => f.id !== id);
    if (_state.selFeatId === id) { _state.selFeatId = null; _state.useCases = []; _state.selUCId = null; _state.functions = []; }
    refreshFeatCol(); refreshUCCol(); refreshFunCol();
  } else if (type === 'uc') {
    await sb.from('use_cases').delete().eq('id', id);
    _state.useCases = _state.useCases.filter(u => u.id !== id);
    if (_state.selUCId === id) { _state.selUCId = null; _state.functions = []; }
    refreshUCCol(); refreshFunCol();
  } else if (type === 'fun') {
    await sb.from('functions').delete().eq('id', id);
    _state.functions = _state.functions.filter(fn => fn.id !== id);
    refreshFunCol();
  }
  toast('Deleted.', 'success');
}

async function reorderItem(type, id, dir) {
  const list = type === 'feat' ? _state.features : type === 'uc' ? _state.useCases : _state.functions;
  const idx  = list.findIndex(x => x.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= list.length) return;

  const a = list[idx], b = list[swapIdx];
  [list[idx], list[swapIdx]] = [b, a];

  const table = type === 'feat' ? 'features' : type === 'uc' ? 'use_cases' : 'functions';
  await Promise.all([
    sb.from(table).update({ sort_order: swapIdx }).eq('id', a.id),
    sb.from(table).update({ sort_order: idx     }).eq('id', b.id),
  ]);

  if (type === 'feat') refreshFeatCol();
  else if (type === 'uc')  refreshUCCol();
  else refreshFunCol();
}

// ── Inline edit ───────────────────────────────────────────────────────────────

function openInlineEdit(type, id) {
  const row = document.querySelector(`.fuf-row[data-id="${id}"][data-type="${type}"]`);
  if (!row) return;

  const list = type === 'feat' ? _state.features : type === 'uc' ? _state.useCases : _state.functions;
  const item = list.find(x => x.id === id);
  if (!item) return;

  const mainEl = row.querySelector('.fuf-row-main');

  // Build function type selector (only for functions)
  let ftSelect = '';
  if (type === 'fun' && _state.functionTypes.length) {
    const opts = _state.functionTypes.map(ft =>
      `<option value="${escHtml(ft.name)}" ${item.function_type === ft.name ? 'selected' : ''}>${escHtml(ft.name)}</option>`
    ).join('');
    ftSelect = `
      <select class="fuf-input fuf-input-type" id="fuf-edit-type">
        <option value="">— Function Type —</option>
        ${opts}
      </select>`;
  }

  mainEl.innerHTML = `
    <div class="fuf-edit-form">
      <input  class="fuf-input fuf-input-name" id="fuf-edit-name" value="${escHtml(item.name)}" placeholder="Name *" autocomplete="off"/>
      ${ftSelect}
      <textarea class="fuf-input fuf-input-desc" id="fuf-edit-desc" rows="2" placeholder="Description (optional)">${escHtml(item.description || '')}</textarea>
      <div class="fuf-edit-btns">
        <button class="btn btn-primary btn-sm" id="fuf-save">✓ Save</button>
        <button class="btn btn-secondary btn-sm" id="fuf-cancel">✗</button>
      </div>
    </div>`;

  const nameInput = row.querySelector('#fuf-edit-name');
  nameInput.focus();
  nameInput.select();

  const save = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const description = row.querySelector('#fuf-edit-desc').value.trim();
    const ftEl = row.querySelector('#fuf-edit-type');
    const function_type = ftEl ? ftEl.value || null : undefined;

    const table = type === 'feat' ? 'features' : type === 'uc' ? 'use_cases' : 'functions';
    const patch = { name, description, updated_at: new Date().toISOString() };
    if (function_type !== undefined) patch.function_type = function_type;

    const { error } = await sb.from(table).update(patch).eq('id', id);
    if (error) { toast(t('common.error'), 'error'); return; }

    // Update local state
    Object.assign(item, { name, description, ...(function_type !== undefined ? { function_type } : {}) });
    toast('Saved.', 'success');

    if (type === 'feat') refreshFeatCol();
    else if (type === 'uc')  refreshUCCol();
    else refreshFunCol();
  };

  row.querySelector('#fuf-save').onclick   = save;
  row.querySelector('#fuf-cancel').onclick = () => {
    if (type === 'feat') refreshFeatCol();
    else if (type === 'uc') refreshUCCol();
    else refreshFunCol();
  };
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') row.querySelector('#fuf-cancel').click();
  };
}

// ── Doc (description) helpers ────────────────────────────────────────────────

async function loadDoc(parentType, parentId, domain, pageId, projectId) {
  let q = sb.from('vcycle_docs').select('*')
    .eq('parent_type', parentType).eq('parent_id', parentId)
    .eq('domain', domain).eq('phase', 'item_definition');
  q = pageId ? q.eq('nav_page_id', pageId) : q.is('nav_page_id', null);
  const { data } = await q.maybeSingle();
  return data || null;
}

async function saveDoc(project, parentType, parentId, domain, pageId) {
  const text      = document.getElementById('doc-text')?.value || '';
  const newStatus = document.getElementById('doc-status')?.value || 'draft';
  const payload   = {
    parent_type: parentType, parent_id: parentId,
    project_id: project.id, phase: 'item_definition',
    domain, nav_page_id: pageId || null,
    content: { text }, status: newStatus,
    updated_at: new Date().toISOString(),
  };

  const { error } = _state.doc
    ? await sb.from('vcycle_docs').update(payload).eq('id', _state.doc.id)
    : await sb.from('vcycle_docs').insert(payload);

  if (error) { toast(t('common.error'), 'error'); return; }
  toast('Document saved.', 'success');

  // Refresh doc reference if newly inserted
  if (!_state.doc) {
    let q = sb.from('vcycle_docs').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', domain).eq('phase', 'item_definition');
    q = pageId ? q.eq('nav_page_id', pageId) : q.is('nav_page_id', null);
    const { data } = await q.maybeSingle();
    _state.doc = data;
  }
}

// ── View toggle (columns ↔ graph) ─────────────────────────────────────────────

async function switchView(mode) {
  document.getElementById('btn-view-cols').classList.toggle('active',  mode === 'cols');
  document.getElementById('btn-view-graph').classList.toggle('active', mode === 'graph');

  const panel = document.getElementById('fuf-panel');
  const hint  = document.getElementById('fuf-hint');

  if (mode === 'cols') {
    hint.style.display = '';
    panel.innerHTML = `
      <div class="idef-fuf-wrap">
        <div class="idef-fuf-cols" id="fuf-cols">
          ${buildFeatCol(_state.features, _state.selFeatId)}
          ${buildUCCol(_state.useCases, _state.selFeatId, _state.selUCId)}
          ${buildFunCol(_state.functions, _state.selUCId)}
        </div>
      </div>`;
    wireFUF();
  } else {
    hint.style.display = 'none';
    panel.innerHTML = `<div class="fuf-graph-loading"><div class="spinner"></div></div>`;
    const tree = await getFeaturesTree(_state.parentType, _state.parentId, _state.domain);
    panel.innerHTML = buildGraphView(tree);
  }
}

function buildGraphView(tree) {
  if (!tree.length) {
    return `<div class="fuf-empty" style="padding:40px">No features defined yet. Switch to Column view to add some.</div>`;
  }

  const rows = tree.map(feat => {
    const ucNodes = feat.use_cases.map(uc => {
      const funNodes = uc.functions.map(fn => `
        <div class="fuf-graph-node fun-node">
          <div class="fuf-graph-node-inner">
            <span class="fuf-graph-icon fun-icon">${ICONS.fun}</span>
            <div class="fuf-graph-node-text">
              <span class="fuf-graph-code">${escHtml(fn.func_code)}</span>
              <span class="fuf-graph-name">${escHtml(fn.name)}</span>
              ${fn.description ? `<span class="fuf-graph-desc">${escHtml(fn.description)}</span>` : ''}
            </div>
          </div>
        </div>`).join('');

      return `
        <div class="fuf-graph-branch">
          <div class="fuf-graph-node uc-node">
            <div class="fuf-graph-node-inner">
              <span class="fuf-graph-icon uc-icon">${ICONS.uc}</span>
              <div class="fuf-graph-node-text">
                <span class="fuf-graph-code">${escHtml(uc.uc_code)}</span>
                <span class="fuf-graph-name">${escHtml(uc.name)}</span>
                ${uc.description ? `<span class="fuf-graph-desc">${escHtml(uc.description)}</span>` : ''}
              </div>
            </div>
          </div>
          ${funNodes ? `<div class="fuf-graph-children fuf-graph-fun-children">${funNodes}</div>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="fuf-graph-feat-block">
        <div class="fuf-graph-node feat-node">
          <div class="fuf-graph-node-inner">
            <span class="fuf-graph-icon feat-icon">${ICONS.feat}</span>
            <div class="fuf-graph-node-text">
              <span class="fuf-graph-code">${escHtml(feat.feat_code)}</span>
              <span class="fuf-graph-name">${escHtml(feat.name)}</span>
              ${feat.description ? `<span class="fuf-graph-desc">${escHtml(feat.description)}</span>` : ''}
            </div>
          </div>
        </div>
        ${ucNodes ? `<div class="fuf-graph-children fuf-graph-uc-children">${ucNodes}</div>` : ''}
      </div>`;
  }).join('');

  return `<div class="fuf-graph-wrap">${rows}</div>`;
}

// ── Doc (description) helpers ────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
