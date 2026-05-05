/**
 * SW Units — CRUD + code upload for software unit artifacts.
 * Route: /project/:projectId/item/:itemId/sw-units
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';
import { showModal, hideModal } from '../components/modal.js';
import { copyElementLink, scrollToAnchor } from '../deep-link.js';
import { loadColConfig, saveColConfig, wireColMgr } from '../components/col-mgr.js';
import { buildFilterRowHTML, applyColFilters, wireColFilterIcons } from '../components/col-filter.js';
import { showVersionHistory } from '../components/version-history.js';
import { createTracePanel } from '../components/trace-panel.js';
import { VMODEL_NODES } from '../components/vmodel-editor.js';

const STATUS_LABELS  = { draft:'Draft', in_review:'In Review', approved:'Approved', deprecated:'Deprecated' };
const STATUS_CLASSES = { draft:'badge-draft', in_review:'badge-review', approved:'badge-approved', deprecated:'badge-deprecated' };
const LANGUAGE_LABELS = { c:'C', cpp:'C++', python:'Python', java:'Java', js:'JavaScript', ts:'TypeScript', rust:'Rust', other:'Other' };

const BUILTIN_UNIT_TYPES = [
  { id: 'function',      label: 'Function / Method' },
  { id: 'class',         label: 'Class' },
  { id: 'isr',           label: 'Interrupt (ISR)' },
  { id: 'task',          label: 'RTOS Task' },
  { id: 'state_machine', label: 'State Machine' },
  { id: 'calibration',   label: 'Calibration / Config' },
  { id: 'general',       label: 'General Code' },
];

export async function renderSwUnits(container, ctx) {
  const { project, item, system } = ctx;

  // If navigating under a system, scope SW units to that system
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const parentName = system ? `${system.system_code} · ${system.name}` : item.name;
  const base = system
    ? `/project/${project.id}/item/${item.id}/system/${system.id}`
    : `/project/${project.id}/item/${item.id}`;

  // Load project config to get custom unit types and header keywords
  const { data: pcRow } = await sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle();
  const customUnitTypes = pcRow?.config?.sw_unit_types || [];
  const allUnitTypes = [...BUILTIN_UNIT_TYPES, ...customUnitTypes];
  // Build active keyword list from config (array format) or legacy object format
  const savedKeywords = pcRow?.config?.header_keywords;
  const ACTIVE_KW = []; // [{ id, label, kw }] — only enabled
  const HDR_KW    = {}; // { id: kw } — for parser
  const DEFAULT_HDR_KEYS = [
    { id:'unit',   label:'Unit Code',    kw:'@unit'   },
    { id:'name',   label:'Name',         kw:'@name'   },
    { id:'type',   label:'Unit Type',    kw:'@type'   },
    { id:'sdd',    label:'SDD Ref',      kw:'@sdd'    },
    { id:'req',    label:'Requirements', kw:'@req'    },
    { id:'author', label:'Author',       kw:'@author' },
    { id:'date',   label:'Date',         kw:'@date'   },
    { id:'status', label:'Status',       kw:'@status' },
  ];
  if (Array.isArray(savedKeywords) && savedKeywords.length) {
    savedKeywords.filter(k => k.enabled !== false).forEach(k => {
      ACTIVE_KW.push(k);
      HDR_KW[k.id] = k.kw;
    });
  } else {
    DEFAULT_HDR_KEYS.forEach(k => { ACTIVE_KW.push(k); HDR_KW[k.id] = k.kw; });
    if (savedKeywords && !Array.isArray(savedKeywords)) Object.assign(HDR_KW, savedKeywords);
  }

  // Build header example string from active keywords
  const EXAMPLE_VALS = { unit:'SWU-001', name:'Motor Control', type:'function', asil:'B',
    sdd:'SDD-MOT-001', req:'SWR-001, SWR-002', author:'Your Name',
    date:new Date().toISOString().slice(0,10), status:'draft' };
  function buildHeaderExample() {
    const maxKw = Math.max(...ACTIVE_KW.map(k => k.kw.length));
    const lines = ACTIVE_KW.map(k => ' * ' + k.kw.padEnd(maxKw + 2) + (EXAMPLE_VALS[k.id] || 'value'));
    return '/**\n' + lines.join('\n') + '\n */';
  }

  const crumbs = [
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `/project/${project.id}/item/${item.id}/vcycle/item_definition` },
  ];
  if (system) crumbs.push({ label: parentName });
  crumbs.push({ label: 'SW Units' });
  setBreadcrumb(crumbs);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>SW Units</h1>
          <p class="page-subtitle">${escHtml(parentName)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="swu-btn-upload">⬆ Upload Code (ZIP)</button>
          <button class="btn btn-primary" id="swu-btn-new">＋ New SW Unit</button>
        </div>
      </div>
    </div>
    <div class="page-body spec-page-body" id="swu-outer">
      <div class="spec-content" id="swu-list-wrap">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <aside class="req-trace-panel" id="swu-props-panel">
        <div class="swu-rail-tabs">
          <button class="swu-rail-btn swu-rail-btn--active" id="swu-rail-props" title="Properties">Properties</button>
          <button class="swu-rail-btn" id="swu-rail-trace" title="Traceability">Traceability</button>
        </div>
        <div class="req-trace-panel-hdr">
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-xs swu-panel-tab swu-panel-tab--active" id="swu-tab-props" data-tab="props">Properties</button>
            <button class="btn btn-ghost btn-xs swu-panel-tab" id="swu-tab-trace" data-tab="trace">⛓ Trace</button>
          </div>
          <button class="btn-icon" id="swu-props-close" title="Collapse">✕</button>
        </div>
        <div class="req-trace-panel-body" id="swu-props-body">
          <p style="padding:8px 4px;font-size:13px;color:var(--color-text-muted)">
            Click on a SW unit row to see its properties.
          </p>
        </div>
        <div class="req-trace-panel-body" id="swu-trace-body" style="display:none">
          <p style="padding:8px 4px;font-size:13px;color:var(--color-text-muted)">
            Click ⛓ on a SW unit to view its V-Model trace links.
          </p>
        </div>
      </aside>
    </div>

    <div class="req-bulk-bar" id="swu-bulk-bar">
      <span class="req-bulk-count" id="swu-bulk-count">0 selected</span>
      <div class="req-bulk-actions">
        <button class="btn btn-primary btn-sm"   id="swu-bulk-review">✓ Review</button>
        <button class="btn btn-secondary btn-sm" id="swu-bulk-status">✏ Edit Status</button>
        <button class="btn btn-danger btn-sm"    id="swu-bulk-delete">🗑 Delete</button>
      </div>
      <button class="btn btn-ghost btn-sm" id="swu-bulk-cancel">✕ Cancel</button>
    </div>

    <!-- Edit/Create panel (hidden by default) -->
    <div id="swu-form-panel" style="display:none" class="swu-form-panel">
      <div class="swu-form-header">
        <span id="swu-form-title">New SW Unit</span>
        <button class="btn btn-ghost btn-sm" id="swu-form-close">✕</button>
      </div>
      <div class="swu-form-body">
        <div class="form-group">
          <label class="form-label">Unit Code *</label>
          <input class="form-input" id="swu-field-code" placeholder="e.g. SWU-001"/>
        </div>
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" id="swu-field-name" placeholder="Short descriptive name"/>
        </div>
        <div class="form-grid cols-2">
          <div class="form-group">
            <label class="form-label">Unit Type</label>
            <select class="form-input form-select" id="swu-field-unittype">
              ${allUnitTypes.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Language</label>
            <select class="form-input form-select" id="swu-field-language">
              <option value="">— select —</option>
              ${Object.entries(LANGUAGE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="swu-field-status">
            ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">File Path</label>
          <input class="form-input" id="swu-field-filepath" placeholder="e.g. src/motor/control.c"/>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="swu-field-desc" rows="2" placeholder="Brief description of this unit's responsibility"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Source Code</label>
          <textarea class="form-input swu-code-editor" id="swu-field-code-src" rows="12" placeholder="Paste source code here…" spellcheck="false"></textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="swu-form-save">Save</button>
          <button class="btn btn-ghost" id="swu-form-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  // Initialise trace panel
  const vmodelLinks = pcRow?.config?.vmodel_links || [];
  const swImplNodeId = VMODEL_NODES.find(n => n.domain === 'sw' && n.phase === 'implementation')?.id;
  const _tp = createTracePanel({
    sb, vmodelLinks, nodeId: swImplNodeId,
    item, system, project,
    table: 'sw_units',
    getCode:  u => u.unit_code,
    getTitle: u => u.name,
    getData:  () => _allUnits,
    panelEl:     document.getElementById('swu-props-panel'),
    panelBodyEl: document.getElementById('swu-trace-body'),
    rowSelector: 'tr[data-id]',
    rowActiveClass: 'req-row-trace-active',
  });
  _tp.deriveFields();
  await _tp.loadSourceData();

  let _activeTab = 'props';

  function switchPanelTab(tab) {
    _activeTab = tab;
    document.getElementById('swu-props-body').style.display = tab === 'props' ? '' : 'none';
    document.getElementById('swu-trace-body').style.display = tab === 'trace' ? '' : 'none';
    document.querySelectorAll('.swu-panel-tab').forEach(b =>
      b.classList.toggle('swu-panel-tab--active', b.dataset.tab === tab));
    document.getElementById('swu-rail-props')?.classList.toggle('swu-rail-btn--active', tab === 'props');
    document.getElementById('swu-rail-trace')?.classList.toggle('swu-rail-btn--active', tab === 'trace');
  }

  document.getElementById('swu-tab-props').onclick = () => switchPanelTab('props');
  document.getElementById('swu-tab-trace').onclick = () => {
    switchPanelTab('trace');
    if (_selectedUnitId) _tp.openPanel(_selectedUnitId);
  };

  document.getElementById('swu-rail-props').onclick = e => {
    e.stopPropagation();
    switchPanelTab('props');
    document.getElementById('swu-props-panel').classList.add('open');
  };
  document.getElementById('swu-rail-trace').onclick = e => {
    e.stopPropagation();
    switchPanelTab('trace');
    document.getElementById('swu-props-panel').classList.add('open');
    if (_selectedUnitId) _tp.openPanel(_selectedUnitId);
  };

  document.getElementById('swu-btn-new').onclick    = () => openForm(null);
  document.getElementById('swu-form-close').onclick  = closeForm;
  document.getElementById('swu-form-cancel').onclick = closeForm;
  document.getElementById('swu-btn-upload').onclick  = () => openUploadModal();
  document.getElementById('swu-props-close').onclick = e => { e.stopPropagation(); closePropsPanel(); };
  document.getElementById('swu-props-panel').addEventListener('click', e => {
    const panel = document.getElementById('swu-props-panel');
    if (!panel.classList.contains('open') && !e.target.closest('button')) panel.classList.add('open');
  });

  document.getElementById('swu-bulk-cancel').onclick = () => {
    _selection.clear();
    syncBulkBar();
    renderTable();
  };

  const reviewBase = `/project/${project.id}/item/${item.id}`;
  const scopeParams = system ? `&scope_system_id=${system.id}&scope_domain=sw` : '&scope_domain=sw';
  document.getElementById('swu-bulk-review').onclick = () => {
    if (!_selection.size) return;
    sessionStorage.setItem('wiz_preselected_sw_units', JSON.stringify([..._selection]));
    const parentTypePfx = system ? 'system' : 'item';
    const parentIdCtx   = system ? system.id : item.id;
    navigate(`${reviewBase}/reviews/new?artifact_type=sw_units&phase=implementation&domain=sw&parentType=${parentTypePfx}&parentId=${parentIdCtx}&preselected=1${scopeParams}`);
  };

  document.getElementById('swu-bulk-status').onclick = () => {
    const existing = document.getElementById('swu-bulk-status-picker');
    if (existing) { existing.remove(); return; }
    const btn     = document.getElementById('swu-bulk-status');
    const picker  = document.createElement('div');
    picker.id     = 'swu-bulk-status-picker';
    picker.className = 'req-bulk-status-picker';
    picker.innerHTML = Object.entries(STATUS_LABELS).map(([v,l]) =>
      `<button class="req-bulk-status-opt" data-status="${v}">${l}</button>`).join('');
    document.body.appendChild(picker);
    const rect = btn.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top  = (rect.top - picker.offsetHeight - 6) + 'px';
    picker.querySelectorAll('.req-bulk-status-opt').forEach(opt => {
      opt.onclick = async () => {
        picker.remove();
        const ids = [..._selection];
        await Promise.all(ids.map(id => sb.from('sw_units').update({ status: opt.dataset.status, updated_at: new Date().toISOString() }).eq('id', id)));
        toast(`${ids.length} unit${ids.length > 1 ? 's' : ''} set to "${STATUS_LABELS[opt.dataset.status]}".`, 'success');
        await loadList();
      };
    });
    setTimeout(() => document.addEventListener('click', function close(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); }
    }), 0);
  };

  document.getElementById('swu-bulk-delete').onclick = async () => {
    const n = _selection.size;
    if (!confirm(`Delete ${n} SW unit${n > 1 ? 's' : ''}?\n\nThis cannot be undone.`)) return;
    const fromFile = [..._selection].some(id => _allUnits.find(u => u.id === id)?.source_code);
    if (fromFile && !confirm(
      `⚠ Inconsistency warning\n\n` +
      `One or more selected units were imported from source code.\n` +
      `Deleting them here does NOT remove them from the codebase.\n\n` +
      `If you re-upload the same ZIP, they will be recreated.\n\n` +
      `Confirm deletion of all ${n} unit${n > 1 ? 's' : ''}?`
    )) return;
    await Promise.all([..._selection].map(id => sb.from('sw_units').delete().eq('id', id)));
    _selection.clear();
    syncBulkBar();
    toast(`${n} unit${n > 1 ? 's' : ''} deleted.`, 'success');
    await loadList();
  };

  // ── Properties panel ─────────────────────────────────────────────────────────
  let _selectedUnitId = null;

  function openPropsPanel(unit) {
    _selectedUnitId = unit.id;
    const panel = document.getElementById('swu-props-panel');
    const body  = document.getElementById('swu-props-body');
    if (!panel || !body) return;
    panel.classList.add('open');

    const fromFile = !!unit.source_code; // fields locked if unit came from a source file
    const ro = fromFile ? ' disabled' : '';
    const roClass = fromFile ? ' swup-readonly' : '';

    body.innerHTML = `
      ${fromFile ? `<div class="swup-from-file-notice">⛓ Fields sourced from file — edit the source file and re-upload to change them.</div>` : ''}
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Unit Code</label>
        <input class="form-input${roClass}" id="swup-code" value="${escHtml(unit.unit_code)}"${ro}/>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Name</label>
        <input class="form-input${roClass}" id="swup-name" value="${escHtml(unit.name)}"${ro}/>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Unit Type</label>
        <select class="form-input form-select${roClass}" id="swup-type"${ro}>
          ${allUnitTypes.map(t => `<option value="${escHtml(t.id)}"${unit.unit_type===t.id?' selected':''}>${escHtml(t.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Status</label>
        <select class="form-input form-select" id="swup-status">
          ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}"${unit.status===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Language</label>
        <select class="form-input form-select${roClass}" id="swup-lang"${ro}>
          <option value="">— select —</option>
          ${Object.entries(LANGUAGE_LABELS).map(([v,l]) => `<option value="${v}"${unit.language===v?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">File Path</label>
        <input class="form-input mono${roClass}" id="swup-filepath" style="font-size:11px" value="${escHtml(unit.file_path||'')}"${ro}/>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Description</label>
        <textarea class="form-input${roClass}" id="swup-desc" rows="2"${ro}>${escHtml(unit.description||'')}</textarea>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label">Source Code</label>
        <textarea class="form-input swu-code-editor${roClass}" id="swup-src" rows="10" spellcheck="false"${ro}>${escHtml(unit.source_code||'')}</textarea>
      </div>
      ${unit.needs_review ? `<div style="margin-bottom:10px"><span class="badge badge-review">⚠ Changed — review pending</span></div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <button class="btn btn-ghost btn-xs" id="swup-link" title="Copy link">🔗</button>
        <span class="text-muted" style="font-size:11px">v${unit.version}</span>
        <span id="swup-saving" style="font-size:11px;color:var(--color-text-muted);display:none">Saving…</span>
      </div>`;

    document.getElementById('swup-link').onclick = () => copyElementLink(`swu-row-${unit.id}`);

    async function autosave() {
      const unit_code   = document.getElementById('swup-code')?.value.trim();
      const name        = document.getElementById('swup-name')?.value.trim();
      if (!unit_code || !name) return;

      const unit_type   = document.getElementById('swup-type').value || 'general';
      const status      = document.getElementById('swup-status').value;
      const language    = document.getElementById('swup-lang').value;
      const file_path   = document.getElementById('swup-filepath').value.trim();
      const description = document.getElementById('swup-desc').value.trim();
      const source_code = document.getElementById('swup-src').value;

      const saving = document.getElementById('swup-saving');
      if (saving) saving.style.display = '';

      let content_hash = unit.content_hash;
      let extra = {};
      if (source_code && !fromFile) {
        content_hash = await hashContent(source_code);
        if (content_hash !== unit.content_hash) {
          await sb.from('sw_unit_versions').insert({
            sw_unit_id: unit.id, version: unit.version,
            source_code: unit.source_code, content_hash: unit.content_hash,
            file_path: unit.file_path, uploaded_by: currentUserId,
          });
          extra = { needs_review: true };
          unit.content_hash = content_hash;
        }
      }

      const { error } = await sb.from('sw_units').update({
        unit_code, name, unit_type, status,
        language: language || null,
        file_path: file_path || null,
        description: description || null,
        source_code: source_code || null,
        content_hash,
        ...extra,
        updated_at: new Date().toISOString(),
      }).eq('id', unit.id);

      if (saving) saving.style.display = 'none';
      if (error) { toast('Error: ' + error.message, 'error'); return; }
      // Update local cache without re-rendering the panel
      const cached = _allUnits.find(u => u.id === unit.id);
      if (cached) Object.assign(cached, { unit_code, name, unit_type, status, language: language||null, file_path: file_path||null, description: description||null, source_code: source_code||null, content_hash, ...extra });
      // Refresh row in table
      const tr = document.getElementById(`swu-row-${unit.id}`);
      if (tr) {
        _cols.filter(c => c.visible).forEach(c => {
          const td = tr.querySelector(`td[data-col="${c.id}"]`);
          if (td) td.outerHTML = renderTd(c.id, cached || unit);
        });
      }
    }

    // Debounce for text inputs
    let _saveTimer = null;
    function debouncedSave() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(autosave, 800);
    }

    body.querySelectorAll('select:not(:disabled)').forEach(el => el.addEventListener('change', autosave));
    body.querySelectorAll('input:not(:disabled)').forEach(el => el.addEventListener('input', debouncedSave));
    body.querySelectorAll('textarea:not(:disabled)').forEach(el => el.addEventListener('input', debouncedSave));

    // Highlight selected row
    document.querySelectorAll('#swu-list-wrap tr[data-id]').forEach(r =>
      r.classList.toggle('row-selected', r.dataset.id === unit.id));
  }

  function closePropsPanel() {
    _selectedUnitId = null;
    document.getElementById('swu-props-panel')?.classList.remove('open');
    document.querySelectorAll('#swu-list-wrap tr[data-id]').forEach(r =>
      r.classList.remove('row-selected', 'req-row-selected'));
  }

  // ── Column definitions ───────────────────────────────────────────────────────
  const COL_KEY = `swu_${project.id}_${parentId}`;
  const SKIP_FILTER = new Set(['drag', 'select', 'actions']);

  const BUILTIN_COLS = [
    { id:'drag',         name:'',        visible:true,  fixed:true  },
    { id:'select',       name:'',        visible:true,  fixed:true  },
    { id:'unit_code',    name:'Code',    visible:true,  fixed:false },
    { id:'name',         name:'Name',    visible:true,  fixed:false },
    { id:'unit_type',    name:'Type',    visible:true,  fixed:false },
    { id:'file_path',    name:'File',    visible:true,  fixed:false },
    { id:'language',     name:'Lang',    visible:true,  fixed:false },
    { id:'version',      name:'Version', visible:true,  fixed:false },
    { id:'status',       name:'Status',  visible:true,  fixed:false },
    { id:'needs_review', name:'Review',  visible:true,  fixed:false },
    { id:'actions',      name:'',        visible:true,  fixed:true  },
  ];

  let _cols = loadColConfig(COL_KEY, BUILTIN_COLS);
  _cols = [
    ..._cols.filter(c => c.id === 'drag'),
    ..._cols.filter(c => c.id === 'select'),
    ..._cols.filter(c => c.id !== 'drag' && c.id !== 'select' && c.id !== 'actions'),
    ..._cols.filter(c => c.id === 'actions'),
  ];
  let _filters   = {};
  let _allUnits  = [];
  let _selection = new Set(); // selected unit IDs

  function syncBulkBar() {
    const bar   = document.getElementById('swu-bulk-bar');
    const count = document.getElementById('swu-bulk-count');
    if (!bar) return;
    bar.classList.toggle('req-bulk-bar--visible', _selection.size > 0);
    if (count) count.textContent = `${_selection.size} selected`;
  }

  function getFilterValue(u, colId) {
    switch (colId) {
      case 'unit_code':    return u.unit_code || '';
      case 'name':         return u.name || '';
      case 'unit_type':    return allUnitTypes.find(t => t.id === u.unit_type)?.label || u.unit_type || '';
      case 'file_path':    return u.file_path || '';
      case 'language':     return LANGUAGE_LABELS[u.language] || u.language || '';
      case 'version':      return `v${u.version}`;
      case 'status':       return STATUS_LABELS[u.status] || u.status || '';
      case 'needs_review': return u.needs_review ? 'changed' : '';
      default:             return '';
    }
  }

  function renderTd(colId, u) {
    switch (colId) {
      case 'drag':         return `<td data-col="drag" class="req-drag-cell" style="vertical-align:top;padding-top:6px"><span class="req-drag-handle" title="Drag to reorder">⠿</span></td>`;
      case 'select':       return `<td data-col="select" style="width:28px;padding:10px 6px 0;text-align:center;vertical-align:top"><input type="checkbox" class="swu-row-chk" data-id="${u.id}" ${_selection.has(u.id)?'checked':''} title="Select"/></td>`;
      case 'unit_code':    return `<td data-col="unit_code"><span class="mono">${escHtml(u.unit_code)}</span></td>`;
      case 'name':         return `<td data-col="name">${escHtml(u.name)}</td>`;
      case 'unit_type':    return `<td data-col="unit_type"><span class="badge badge-draft" style="font-size:10px">${escHtml(allUnitTypes.find(t=>t.id===u.unit_type)?.label||u.unit_type||'—')}</span></td>`;
      case 'file_path':    return `<td data-col="file_path" class="mono text-muted" style="font-size:11px">${escHtml(u.file_path||'—')}</td>`;
      case 'language':     return `<td data-col="language">${escHtml(LANGUAGE_LABELS[u.language]||u.language||'—')}</td>`;
      case 'version':      return `<td data-col="version" class="text-muted">v${u.version}</td>`;
      case 'status':       return `<td data-col="status"><span class="badge ${STATUS_CLASSES[u.status]||'badge-draft'}">${STATUS_LABELS[u.status]||u.status}</span></td>`;
      case 'needs_review': return `<td data-col="needs_review">${u.needs_review
        ? `<span class="badge badge-review swu-needs-review-badge" data-id="${u.id}" style="cursor:pointer">⚠ Changed</span>`
        : '<span class="text-muted">—</span>'}</td>`;
      case 'actions':      return `<td data-col="actions" class="actions-cell">
        <button class="btn btn-ghost btn-xs btn-link-swu"  data-id="${u.id}" title="Copy link">🔗</button>
        <button class="btn btn-ghost btn-xs btn-hist-swu"  data-id="${u.id}" title="Version history">🕐</button>
        <button class="btn btn-ghost btn-xs btn-del-swu"   data-id="${u.id}" title="Delete" style="color:var(--color-danger)">✕</button>
      </td>`;
      default: return `<td data-col="${escHtml(colId)}"></td>`;
    }
  }

  function renderTable() {
    const wrap = document.getElementById('swu-list-wrap');
    if (!wrap) return;

    const visCols  = _cols.filter(c => c.visible);

    const filtered = applyColFilters(_allUnits, _filters, getFilterValue);
    const allChecked = filtered.length > 0 && filtered.every(u => _selection.has(u.id));
    const theadRow = visCols.map(c => {
      if (c.id === 'select') return `<th data-col="select" style="width:28px;padding:0 6px;text-align:center"><input type="checkbox" id="swu-chk-all" ${allChecked?'checked':''} title="Select all"/></th>`;
      return `<th data-col="${c.id}"${c.fixed ? '' : ' class="col-managed"'}>${escHtml(c.name)}</th>`;
    }).join('');
    const filterRow = buildFilterRowHTML(_cols, SKIP_FILTER);

    wrap.innerHTML = `
      <div class="swu-table-toolbar">
        <span class="text-muted" style="font-size:12px">${filtered.length} of ${_allUnits.length} units</span>
      </div>
      <table class="data-table" id="swu-table">
        <thead>
          <tr id="swu-thead-row">${theadRow}</tr>
          ${filterRow}
        </thead>
        <tbody>
          ${filtered.length
            ? filtered.map(u => `<tr id="swu-row-${u.id}" data-id="${u.id}" data-sort-order="${u.sort_order??0}" draggable="true"${_selection.has(u.id)?' class="req-row-selected"':''}>${visCols.map(c => renderTd(c.id, u)).join('')}</tr>`).join('')
            : `<tr><td colspan="${visCols.length}" class="text-muted" style="text-align:center;padding:24px">No units match the current filter.</td></tr>`}
        </tbody>
      </table>`;

    const tableEl  = wrap.querySelector('#swu-table');
    const theadEl  = tableEl.querySelector('thead');
    const theadRowEl = wrap.querySelector('#swu-thead-row');

    wireColFilterIcons(theadEl, _filters, () => {
      renderTable();
    }, SKIP_FILTER);

    wireColMgr(theadRowEl, tableEl, COL_KEY, _cols, updatedCols => {
      _cols = updatedCols;
      renderTable();
    });

    // Action buttons via event delegation
    const tbody = tableEl.querySelector('tbody');
    tbody.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const id = btn.dataset.id;
      const unit = _allUnits.find(u => u.id === id);

      if (btn.classList.contains('btn-view-swu')) {
        if (unit) { switchPanelTab('props'); openPropsPanel(unit); }
      } else if (btn.classList.contains('btn-trace-swu')) {
        if (unit) { switchPanelTab('trace'); _tp.openPanel(unit.id); }
      } else if (btn.classList.contains('btn-link-swu')) {
        e.stopPropagation();
        copyElementLink(`swu-row-${id}`);
      } else if (btn.classList.contains('btn-hist-swu')) {
        if (unit) showVersionHistory(sb, { artifactType: 'sw_units', artifactId: unit.id, artifactCode: unit.unit_code, currentData: unit });
      } else if (btn.classList.contains('btn-del-swu')) {
        if (!confirm(`Delete SW unit "${unit?.unit_code}"?\n\nThis cannot be undone.`)) return;
        if (unit?.source_code && !confirm(
          `⚠ Inconsistency warning\n\n` +
          `This unit was imported from source code (${unit.file_path || 'unknown file'}).\n` +
          `Deleting it here does NOT remove it from the codebase.\n\n` +
          `If you re-upload the same ZIP, it will be recreated.\n\n` +
          `Confirm deletion anyway?`
        )) return;
        const { error } = await sb.from('sw_units').delete().eq('id', id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('SW unit deleted.', 'success');
        if (_selectedUnitId === id) closePropsPanel();
        await loadList();
      } else if (btn.classList.contains('btn-move-up') || btn.classList.contains('btn-move-dn')) {
        const dir = btn.classList.contains('btn-move-up') ? -1 : 1;
        await moveUnit(id, dir);
      }
    });

    wrap.querySelectorAll('.swu-needs-review-badge').forEach(badge => {
      badge.onclick = () => {
        sessionStorage.setItem('wiz_preselected_sw_units', JSON.stringify([badge.dataset.id]));
        const parentTypePfx = system ? 'system' : 'item';
        const parentIdCtx   = system ? system.id : item.id;
        navigate(`${reviewBase}/reviews/new?artifact_type=sw_units&phase=implementation&domain=sw&parentType=${parentTypePfx}&parentId=${parentIdCtx}&preselected=1${scopeParams}`);
      };
    });

    // Drag-drop reorder
    wireDragDrop(tbody);

    // Select-all checkbox
    const chkAll = wrap.querySelector('#swu-chk-all');
    if (chkAll) {
      chkAll.onchange = () => {
        filtered.forEach(u => { if (chkAll.checked) _selection.add(u.id); else _selection.delete(u.id); });
        syncBulkBar();
        renderTable();
      };
    }

    // Row checkboxes
    wrap.querySelectorAll('.swu-row-chk').forEach(cb => {
      cb.onchange = (e) => {
        e.stopPropagation();
        if (cb.checked) _selection.add(cb.dataset.id); else _selection.delete(cb.dataset.id);
        syncBulkBar();
        // Update row highlight without full re-render
        const tr = document.getElementById(`swu-row-${cb.dataset.id}`);
        if (tr) tr.classList.toggle('req-row-selected', cb.checked);
        // Update select-all state
        const allChk = wrap.querySelector('#swu-chk-all');
        if (allChk) allChk.checked = filtered.length > 0 && filtered.every(u => _selection.has(u.id));
      };
    });

    // Row click → open props panel
    wrap.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.onclick = (e) => {
        if (e.target.closest('button,a,input,select')) return;
        const unit = _allUnits.find(u => u.id === tr.dataset.id);
        if (unit) {
          const panel = document.getElementById('swu-props-panel');
          const isOpen = panel.classList.contains('open');
          if (!isOpen) switchPanelTab('props');
          if (_activeTab === 'trace') {
            openPropsPanel(unit); // still highlights row + sets _selectedUnitId
            _tp.openPanel(unit.id);
          } else {
            openPropsPanel(unit);
          }
        }
      };
    });

    // Re-highlight if a unit was already selected
    if (_selectedUnitId) {
      document.querySelectorAll('#swu-list-wrap tr[data-id]').forEach(r =>
        r.classList.toggle('row-selected', r.dataset.id === _selectedUnitId));
    }

    scrollToAnchor();
  }

  await loadList();

  // ── List ─────────────────────────────────────────────────────────────────────

  async function loadList() {
    const { data: units, error } = await sb.from('sw_units')
      .select('*')
      .eq('project_id', project.id)
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('sort_order', { ascending: true })
      .order('unit_code', { ascending: true });

    const wrap = document.getElementById('swu-list-wrap');
    if (error) { wrap.innerHTML = `<p class="text-muted">${escHtml(error.message)}</p>`; return; }

    if (!units?.length) {
      wrap.innerHTML = `
        <div class="swu-onboarding">
          <div class="swu-onboarding-hero">
            <div class="swu-onboarding-icon">⌨</div>
            <h2>No SW Units yet</h2>
            <p class="text-muted">SW Units represent the individual software elements that make up this ${parentType === 'system' ? 'system' : 'item'} — functions, ISRs, tasks, state machines, etc.</p>
          </div>

          <div class="swu-onboarding-steps">
            <div class="swu-onboarding-step">
              <div class="swu-step-num">1</div>
              <div class="swu-step-body">
                <strong>Prepare your source files</strong>
                <p>Add a traceability header to each file so the tool can auto-populate unit code, name, type, ASIL level, and requirement links on import.</p>
                <pre class="swu-header-example">${escHtml(buildHeaderExample())}</pre>
                <p style="margin-top:6px">
                  <a href="docs/sw-unit-coding-guidelines.md" target="_blank" class="swu-link">📄 Read the full coding guidelines</a>
                  &nbsp;·&nbsp;
                  <a href="#" class="swu-link" id="swu-link-settings">⚙ Customize keywords in Project Settings</a>
                </p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">2</div>
              <div class="swu-step-body">
                <strong>Pack your source files into a ZIP</strong>
                <p>Zip the project folder keeping relative paths. Supported extensions: <code>.c .cpp .h .hpp .py .js .ts .java .rs .go</code></p>
                <p>You can strip a common prefix (e.g. <code>src/</code>) during import if needed.</p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">3</div>
              <div class="swu-step-body">
                <strong>Upload the ZIP</strong>
                <p>Click <strong>⬆ Upload Code (ZIP)</strong> above. The tool will:</p>
                <ul class="swu-onboarding-list">
                  <li>Parse headers and create one SW unit per file</li>
                  <li>Compute a SHA-256 hash per file for drift detection</li>
                  <li>Show a summary: <em>X new · Y changed · Z unchanged</em></li>
                </ul>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">4</div>
              <div class="swu-step-body">
                <strong>Or create units manually</strong>
                <p>Click <strong>＋ New SW Unit</strong> to define a unit without source code — useful for units that are not yet implemented.</p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">5</div>
              <div class="swu-step-body">
                <strong>Review changed units</strong>
                <p>When you upload a new version of the ZIP, files whose content changed are flagged <span class="swu-needs-review-badge" style="cursor:default">⚠ Changed</span>. Click the badge to start a peer review session for those units.</p>
              </div>
            </div>
          </div>

          <div class="swu-onboarding-actions">
            <button class="btn btn-primary" id="swu-ob-upload">⬆ Upload Code (ZIP)</button>
            <button class="btn btn-secondary" id="swu-ob-new">＋ New SW Unit manually</button>
          </div>
        </div>`;

      document.getElementById('swu-ob-upload').onclick = () => openUploadModal();
      document.getElementById('swu-ob-new').onclick    = () => openForm(null);
      document.getElementById('swu-link-settings')?.addEventListener('click', e => {
        e.preventDefault();
        navigate(`/project/${project.id}/settings`);
      });
      return;
    }

    _allUnits = units;
    _allUnits.forEach((u, i) => { if (u.sort_order == null) u.sort_order = i; });
    renderTable();
  }

  // ── Form ─────────────────────────────────────────────────────────────────────

  let _editingId = null;

  function openForm(unit) {
    _editingId = unit?.id || null;
    document.getElementById('swu-form-title').textContent = unit ? 'Edit SW Unit' : 'New SW Unit';
    document.getElementById('swu-field-code').value      = unit?.unit_code || '';
    document.getElementById('swu-field-name').value      = unit?.name || '';
    document.getElementById('swu-field-unittype').value = unit?.unit_type || 'general';
    document.getElementById('swu-field-language').value  = unit?.language || '';
    document.getElementById('swu-field-status').value    = unit?.status || 'draft';
    document.getElementById('swu-field-filepath').value  = unit?.file_path || '';
    document.getElementById('swu-field-desc').value      = unit?.description || '';
    document.getElementById('swu-field-code-src').value  = unit?.source_code || '';
    document.getElementById('swu-form-panel').style.display = '';
    document.getElementById('swu-field-code').focus();

    document.getElementById('swu-form-save').onclick = saveForm;
  }

  function closeForm() {
    document.getElementById('swu-form-panel').style.display = 'none';
    _editingId = null;
  }

  async function saveForm() {
    const unit_code   = document.getElementById('swu-field-code').value.trim();
    const name        = document.getElementById('swu-field-name').value.trim();
    const unit_type   = document.getElementById('swu-field-unittype').value || 'general';
    const language    = document.getElementById('swu-field-language').value;
    const status      = document.getElementById('swu-field-status').value;
    const file_path   = document.getElementById('swu-field-filepath').value.trim();
    const description = document.getElementById('swu-field-desc').value.trim();
    const source_code = document.getElementById('swu-field-code-src').value;

    if (!unit_code) { document.getElementById('swu-field-code').focus(); toast('Enter a unit code.', 'error'); return; }
    if (!name)      { document.getElementById('swu-field-name').focus(); toast('Enter a name.', 'error'); return; }

    const saveBtn = document.getElementById('swu-form-save');
    saveBtn.disabled = true;

    let content_hash = null;
    let needs_review_update = {};

    if (source_code) {
      content_hash = await hashContent(source_code);
    }

    if (_editingId) {
      // Check if source code changed
      const { data: existing } = await sb.from('sw_units').select('content_hash, version, source_code').eq('id', _editingId).single();
      const codeChanged = source_code && existing?.content_hash && existing.content_hash !== content_hash;

      if (codeChanged) {
        // Save version snapshot before updating
        await sb.from('sw_unit_versions').insert({
          sw_unit_id: _editingId, version: existing.version,
          source_code: existing.source_code, content_hash: existing.content_hash,
          file_path, uploaded_by: currentUserId,
        });
        needs_review_update = { needs_review: true };
      }

      const { error } = await sb.from('sw_units').update({
        unit_code, name, unit_type, language: language || null, status,
        file_path: file_path || null, description: description || null,
        source_code: source_code || null, content_hash,
        ...needs_review_update,
        updated_at: new Date().toISOString(),
      }).eq('id', _editingId);

      saveBtn.disabled = false;
      if (error) { toast('Error: ' + error.message, 'error'); return; }
    } else {
      const { error } = await sb.from('sw_units').insert({
        project_id: project.id, parent_type: parentType, parent_id: parentId,
        unit_code, name, unit_type, language: language || null, status,
        file_path: file_path || null, description: description || null,
        source_code: source_code || null, content_hash,
        needs_review: false, version: 1, created_by: currentUserId,
      });

      saveBtn.disabled = false;
      if (error) { toast('Error: ' + error.message, 'error'); return; }
    }

    toast(_editingId ? 'SW unit updated.' : 'SW unit created.', 'success');
    closeForm();
    await loadList();
  }

  // ── Move up/down ─────────────────────────────────────────────────────────────

  async function moveUnit(id, dir) {
    const idx     = _allUnits.findIndex(u => u.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= _allUnits.length) return;
    const a = _allUnits[idx];
    const b = _allUnits[swapIdx];
    const aOrd = a.sort_order ?? idx;
    const bOrd = b.sort_order ?? swapIdx;
    _allUnits[idx]    = b;
    _allUnits[swapIdx] = a;
    a.sort_order = bOrd;
    b.sort_order = aOrd;
    await Promise.all([
      sb.from('sw_units').update({ sort_order: bOrd }).eq('id', a.id),
      sb.from('sw_units').update({ sort_order: aOrd }).eq('id', b.id),
    ]);
    renderTable();
  }

  // ── Drag-drop reorder ─────────────────────────────────────────────────────────

  function wireDragDrop(tbody) {
    let dragId = null, dragTr = null;

    tbody.querySelectorAll('tr[draggable]').forEach(tr => {
      tr.addEventListener('dragstart', e => {
        if (!e.target.closest('.req-drag-handle') && e.target !== tr) { e.preventDefault(); return; }
        dragId = tr.dataset.id;
        dragTr = tr;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
        setTimeout(() => tr.classList.add('req-row-dragging'), 0);
      });
      tr.addEventListener('dragend', () => {
        tr.classList.remove('req-row-dragging');
        tbody.querySelectorAll('.req-drop-above,.req-drop-below').forEach(el =>
          el.classList.remove('req-drop-above','req-drop-below'));
        dragId = null; dragTr = null;
      });
    });

    tbody.addEventListener('dragover', e => {
      if (!dragId) return;
      const tr = e.target.closest('tr[data-id]');
      if (!tr || tr.dataset.id === dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tbody.querySelectorAll('.req-drop-above,.req-drop-below').forEach(el =>
        el.classList.remove('req-drop-above','req-drop-below'));
      const rect = tr.getBoundingClientRect();
      tr.classList.add(e.clientY < rect.top + rect.height / 2 ? 'req-drop-above' : 'req-drop-below');
    });

    tbody.addEventListener('dragleave', e => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('req-drop-above','req-drop-below');
    });

    tbody.addEventListener('drop', async e => {
      e.preventDefault();
      const targetTr = e.target.closest('tr[data-id]');
      if (!targetTr || !dragId || !dragTr) return;
      tbody.querySelectorAll('.req-drop-above,.req-drop-below').forEach(el =>
        el.classList.remove('req-drop-above','req-drop-below'));
      const targetId = targetTr.dataset.id;
      if (targetId === dragId) return;

      const fromIdx  = _allUnits.findIndex(u => u.id === dragId);
      const toIdx    = _allUnits.findIndex(u => u.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const rect      = targetTr.getBoundingClientRect();
      const insertIdx = e.clientY < rect.top + rect.height / 2 ? toIdx : toIdx + 1;
      const [removed] = _allUnits.splice(fromIdx, 1);
      const adjusted  = insertIdx > fromIdx ? insertIdx - 1 : insertIdx;
      _allUnits.splice(adjusted, 0, removed);
      _allUnits.forEach((u, i) => { u.sort_order = i; });
      await Promise.all(_allUnits.map(u =>
        sb.from('sw_units').update({ sort_order: u.sort_order }).eq('id', u.id)
      ));
      renderTable();
    });
  }

  // ── ZIP Upload Modal ──────────────────────────────────────────────────────────

  function openUploadModal() {
    showModal({
      title: '⬆ Upload Project Code (ZIP)',
      body: `
        <div class="form-grid cols-1">
          <div class="form-group">
            <label class="form-label">ZIP file</label>
            <input type="file" class="form-input" id="swu-zip-input" accept=".zip"/>
          </div>
          <div class="form-group">
            <label class="form-label">Strip path prefix <span class="text-muted">(optional)</span></label>
            <input class="form-input" id="swu-zip-prefix" placeholder="e.g. src/ — leave empty to keep full paths"/>
          </div>
          <div id="swu-zip-preview" style="display:none">
            <div class="form-label">Files detected</div>
            <div id="swu-zip-file-list" style="max-height:200px;overflow-y:auto;font-size:12px;font-family:monospace;background:#f8f9fa;padding:8px;border-radius:4px;border:1px solid var(--border)"></div>
          </div>
          <div id="swu-zip-result" style="display:none"></div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" id="swu-zip-cancel">Cancel</button>
        <button class="btn btn-primary" id="swu-zip-import" disabled>Import</button>`,
    });

    document.getElementById('swu-zip-cancel').onclick = hideModal;

    let _zipFiles = [];

    document.getElementById('swu-zip-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Load JSZip dynamically if not present
      if (!window.JSZip) {
        await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
      }

      try {
        const zip = await window.JSZip.loadAsync(file);
        _zipFiles = [];
        const preview = document.getElementById('swu-zip-preview');
        const fileList = document.getElementById('swu-zip-file-list');
        const codeExts = /\.(c|cpp|h|hpp|py|js|ts|java|cs|rs|go|rb|swift|kt|m|asm|s)$/i;

        zip.forEach((path, entry) => {
          if (!entry.dir && codeExts.test(path)) {
            _zipFiles.push({ path, entry });
          }
        });

        fileList.innerHTML = _zipFiles.length
          ? _zipFiles.map(f => `<div>${escHtml(f.path)}</div>`).join('')
          : '<div class="text-muted">No source files detected.</div>';

        preview.style.display = '';
        document.getElementById('swu-zip-import').disabled = _zipFiles.length === 0;
      } catch (err) {
        toast('Failed to read ZIP: ' + err.message, 'error');
      }
    };

    document.getElementById('swu-zip-import').onclick = async () => {
      const prefix   = document.getElementById('swu-zip-prefix').value.trim();
      const btn      = document.getElementById('swu-zip-import');
      btn.disabled   = true;
      btn.textContent = '…';

      let added = 0, changed = 0, unchanged = 0;
      const warnings = [];

      // Pre-load all existing units to match by unit_code
      const { data: existingUnits } = await sb.from('sw_units')
        .select('id, unit_code, file_path, version, content_hash, source_code')
        .eq('project_id', project.id)
        .eq('parent_type', parentType)
        .eq('parent_id', parentId);
      const byCode = {}; // unit_code → existing row
      (existingUnits || []).forEach(u => { byCode[u.unit_code] = u; });
      const seenThisRun = {}; // unit_code → filePath (duplicate detection within batch)

      for (const { path, entry } of _zipFiles) {
        const content  = await entry.async('string');
        const filePath = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
        const lang     = detectLanguage(filePath);

        // Parse ALL @unit blocks in this file
        const unitBlocks = parseAllUnits(content);

        // Fallback: if no @unit blocks found, treat whole file as one unit
        if (!unitBlocks.length) {
          const autoCode = 'SWU-' + filePath.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase().slice(0, 20);
          unitBlocks.push({ fields: { unit: autoCode, name: filePath.split('/').pop() }, code: content });
        }

        for (const { fields: hdr, code } of unitBlocks) {
          const unitCode = hdr.unit;
          const hash     = await hashContent(code);

          // Duplicate check within this import run
          if (seenThisRun[unitCode] && seenThisRun[unitCode] !== filePath) {
            warnings.push({ unitCode, filePath, conflict: { file_path: seenThisRun[unitCode] } });
            continue;
          }
          seenThisRun[unitCode] = filePath;

          const existing = byCode[unitCode];

          if (!existing) {
            const descParts = [];
            if (hdr.asil)   descParts.push(`ASIL: ${hdr.asil}`);
            if (hdr.sdd)    descParts.push(`SDD: ${hdr.sdd}`);
            if (hdr.req)    descParts.push(`Req: ${hdr.req}`);
            if (hdr.author) descParts.push(`Author: ${hdr.author}`);
            const validStatuses = ['draft','in_review','approved','deprecated'];
            const unitStatus = (hdr.status && validStatuses.includes(hdr.status)) ? hdr.status : 'draft';

            const { error: insErr } = await sb.from('sw_units').insert({
              project_id: project.id, parent_type: parentType, parent_id: parentId,
              unit_code: unitCode,
              name: hdr.name || filePath.split('/').pop(),
              unit_type: hdr.type || 'general',
              file_path: filePath, language: lang,
              description: descParts.length ? descParts.join(' | ') : null,
              source_code: code, content_hash: hash,
              needs_review: false, version: 1, status: unitStatus,
              created_by: currentUserId,
            });
            if (insErr) {
              warnings.push({ unitCode, filePath, conflict: { file_path: `DB error: ${insErr.message}` } });
            } else {
              byCode[unitCode] = { unit_code: unitCode, file_path: filePath };
              added++;
            }
          } else if (existing.content_hash !== hash) {
            await sb.from('sw_unit_versions').insert({
              sw_unit_id: existing.id, version: existing.version,
              source_code: existing.source_code, content_hash: existing.content_hash,
              file_path: filePath, uploaded_by: currentUserId,
            });
            const { error: updErr } = await sb.from('sw_units').update({
              source_code: code, content_hash: hash,
              file_path: filePath,
              needs_review: true, updated_at: new Date().toISOString(),
            }).eq('id', existing.id);
            if (!updErr) changed++;
          } else {
            unchanged++;
          }
        }
      }

      const result = document.getElementById('swu-zip-result');
      result.style.display = '';
      let html = `<div class="swu-upload-summary">
        <span class="badge badge-approved">✓ ${added} new</span>
        <span class="badge badge-review">⚠ ${changed} changed</span>
        <span class="badge badge-draft">${unchanged} unchanged</span>
      </div>`;
      if (warnings.length) {
        html += `<div class="swu-upload-warnings">
          <div class="swu-warn-title">⚠ ${warnings.length} issue(s) during import</div>
          <div class="swu-warn-desc">These files could not be imported or have duplicate unit codes. Fix the <code>@unit</code> header and re-upload.</div>
          <table class="swu-warn-table">
            <thead><tr><th>Unit Code</th><th>File</th><th>Issue</th></tr></thead>
            <tbody>${warnings.map(w => `
              <tr>
                <td class="mono">${escHtml(w.unitCode)}</td>
                <td class="mono text-muted">${escHtml(w.filePath)}</td>
                <td style="color:var(--color-danger);font-size:12px">${escHtml(w.conflict.file_path)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }
      result.innerHTML = html;
      btn.textContent = 'Close';
      btn.disabled = false;
      btn.onclick = async () => { hideModal(); await loadList(); };

      if (warnings.length) {
        toast(`Import done — ${added} new, ${changed} changed, ${warnings.length} error(s). Check the report.`, 'error');
      } else {
        toast(`Import done — ${added} new · ${changed} changed · ${unchanged} unchanged`, 'success');
      }
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  // Parse ALL /** @unit ... */ blocks in a file — returns array of unit definitions
  // Each block spans from /** to */ and the code that follows until the next /** or EOF
  function parseAllUnits(content) {
    const units = [];
    // Split on comment block openings, keeping the delimiter
    const blocks = content.split(/(\/\*\*)/);
    // blocks: ['before', '/**', 'content1', '/**', 'content2', ...]
    for (let i = 1; i < blocks.length; i += 2) {
      const commentAndRest = blocks[i + 1] || '';
      // Find end of comment block
      const closeIdx = commentAndRest.indexOf('*/');
      if (closeIdx === -1) continue;
      const commentBody = commentAndRest.slice(0, closeIdx);
      const codeAfter   = commentAndRest.slice(closeIdx + 2);

      // Parse keyword fields from comment lines
      const fields = {};
      for (const line of commentBody.split('\n')) {
        const trimmed = line.replace(/^[\s*/]+/, '').trim();
        for (const [field, kw] of Object.entries(HDR_KW)) {
          if (trimmed.startsWith(kw)) {
            fields[field] = trimmed.slice(kw.length).trim().replace(/^[:\s]+/, '');
          }
        }
      }

      // Only keep blocks that have a @unit keyword
      if (!fields.unit) continue;

      // Code body = everything after */ until the next /** (or EOF)
      const nextBlockIdx = codeAfter.indexOf('/**');
      const codeBody = nextBlockIdx === -1 ? codeAfter : codeAfter.slice(0, nextBlockIdx);

      units.push({ fields, code: codeBody.trim() });
    }
    return units;
  }

  // Legacy single-header parser (kept for onboarding example)
  function parseFileHeader(content) {
    const all = parseAllUnits(content);
    return all.length ? all[0].fields : {};
  }

  async function hashContent(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function detectLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const map = { c:'c', cpp:'cpp', h:'c', hpp:'cpp', py:'python', js:'js', ts:'ts', java:'java', cs:'other', rs:'rust', go:'other' };
    return map[ext] || 'other';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
