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
    <div class="page-body">
      <div id="swu-list-wrap">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
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

  document.getElementById('swu-btn-new').onclick    = () => openForm(null);
  document.getElementById('swu-form-close').onclick  = closeForm;
  document.getElementById('swu-form-cancel').onclick = closeForm;
  document.getElementById('swu-btn-upload').onclick  = () => openUploadModal();

  // ── Column definitions ───────────────────────────────────────────────────────
  const ALL_COLS = [
    { id:'unit_code',   label:'Code',    render: u => `<span class="mono">${escHtml(u.unit_code)}</span>` },
    { id:'name',        label:'Name',    render: u => escHtml(u.name) },
    { id:'unit_type',   label:'Type',    render: u => `<span class="badge badge-draft" style="font-size:10px">${escHtml(allUnitTypes.find(t=>t.id===u.unit_type)?.label||u.unit_type||'—')}</span>` },
    { id:'file_path',   label:'File',    render: u => `<span class="mono text-muted" style="font-size:11px">${escHtml(u.file_path||'—')}</span>` },
    { id:'language',    label:'Lang',    render: u => escHtml(LANGUAGE_LABELS[u.language]||u.language||'—') },
    { id:'version',     label:'Version', render: u => `<span class="text-muted">v${u.version}</span>` },
    { id:'status',      label:'Status',  render: u => `<span class="badge ${STATUS_CLASSES[u.status]||'badge-draft'}">${STATUS_LABELS[u.status]||u.status}</span>` },
    { id:'needs_review',label:'Review',  render: u => u.needs_review
        ? `<span class="badge badge-review swu-needs-review-badge" data-id="${u.id}" style="cursor:pointer">⚠ Changed</span>`
        : '<span class="text-muted">—</span>' },
  ];

  const STORAGE_KEY = `swu_cols_${project.id}`;
  function loadColState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }
  function saveColState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: _colOrder, hidden: [..._hiddenCols] }));
  }

  const saved = loadColState();
  let _colOrder  = saved?.order  || ALL_COLS.map(c => c.id);
  let _hiddenCols = new Set(saved?.hidden || []);
  let _filters   = {};   // colId → filter string
  let _allUnits  = [];   // full dataset for client-side filtering

  function visibleCols() {
    return _colOrder.map(id => ALL_COLS.find(c => c.id === id)).filter(c => c && !_hiddenCols.has(c.id));
  }

  function filteredUnits() {
    return _allUnits.filter(u => {
      for (const [colId, val] of Object.entries(_filters)) {
        if (!val) continue;
        const col = ALL_COLS.find(c => c.id === colId);
        if (!col) continue;
        const text = col.render(u).replace(/<[^>]+>/g, '').toLowerCase();
        if (!text.includes(val.toLowerCase())) return false;
      }
      return true;
    });
  }

  function renderTable() {
    const wrap = document.getElementById('swu-list-wrap');
    if (!wrap) return;
    const cols  = visibleCols();
    const units = filteredUnits();

    let html = `
      <div class="swu-table-toolbar">
        <span class="text-muted" style="font-size:12px">${units.length} of ${_allUnits.length} units</span>
        <button class="btn btn-ghost btn-sm" id="swu-col-menu-btn">⊞ Columns</button>
      </div>
      <div id="swu-col-menu" style="display:none;right:0;top:32px" class="swu-col-menu">
        ${ALL_COLS.map(c => `
          <label class="swu-col-check">
            <input type="checkbox" data-col="${c.id}" ${_hiddenCols.has(c.id) ? '' : 'checked'}/>
            ${escHtml(c.label)}
          </label>`).join('')}
      </div>
      <table class="data-table">
        <thead>
          <tr>
            ${cols.map(c => `
              <th draggable="true" data-col="${c.id}" class="swu-th-drag" title="Drag to reorder">
                ${escHtml(c.label)}
              </th>`).join('')}
            <th style="width:100px"></th>
          </tr>
          <tr class="swu-filter-row">
            ${cols.map(c => `
              <th>
                <input class="swu-filter-input" data-col="${c.id}"
                  value="${escHtml(_filters[c.id]||'')}"
                  placeholder="Filter…"/>
              </th>`).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${units.length ? units.map(u => `
            <tr data-id="${u.id}" id="swu-row-${u.id}">
              ${cols.map(c => `<td>${c.render(u)}</td>`).join('')}
              <td class="rv-actions">
                <button class="btn btn-ghost btn-xs btn-copy-link swu-link-btn" data-id="${u.id}" title="Copy link to this unit">🔗</button>
                <button class="btn btn-secondary btn-sm swu-edit-btn" data-id="${u.id}">Edit</button>
                <button class="btn btn-ghost btn-sm swu-del-btn" data-id="${u.id}">Delete</button>
              </td>
            </tr>`).join('')
          : `<tr><td colspan="${cols.length + 1}" class="text-muted" style="text-align:center;padding:24px">No units match the current filter.</td></tr>`}
        </tbody>
      </table>`;

    wrap.innerHTML = html;

    // Column menu toggle
    const menuBtn = document.getElementById('swu-col-menu-btn');
    const menu    = document.getElementById('swu-col-menu');
    menuBtn.onclick = (e) => { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? '' : 'none'; };
    document.addEventListener('click', () => { if (menu) menu.style.display = 'none'; }, { once: false });
    menu.querySelectorAll('input[data-col]').forEach(cb => {
      cb.onchange = () => {
        if (cb.checked) _hiddenCols.delete(cb.dataset.col);
        else            _hiddenCols.add(cb.dataset.col);
        saveColState();
        renderTable();
      };
    });

    // Filter inputs
    wrap.querySelectorAll('.swu-filter-input').forEach(inp => {
      inp.oninput = () => {
        _filters[inp.dataset.col] = inp.value;
        renderTable();
      };
    });

    // Drag-to-reorder headers
    let _dragCol = null;
    wrap.querySelectorAll('.swu-th-drag').forEach(th => {
      th.ondragstart = (e) => { _dragCol = th.dataset.col; e.dataTransfer.effectAllowed = 'move'; th.classList.add('dragging'); };
      th.ondragend   = ()  => { wrap.querySelectorAll('.swu-th-drag').forEach(t => { t.classList.remove('dragging','drag-over'); }); };
      th.ondragover  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; th.classList.add('drag-over'); };
      th.ondragleave = ()  => { th.classList.remove('drag-over'); };
      th.ondrop      = (e) => {
        e.preventDefault();
        th.classList.remove('drag-over');
        if (!_dragCol || _dragCol === th.dataset.col) return;
        const from = _colOrder.indexOf(_dragCol);
        const to   = _colOrder.indexOf(th.dataset.col);
        if (from === -1 || to === -1) return;
        _colOrder.splice(from, 1);
        _colOrder.splice(to, 0, _dragCol);
        saveColState();
        renderTable();
      };
    });

    // Row actions
    wrap.querySelectorAll('.swu-edit-btn').forEach(btn => {
      btn.onclick = () => openForm(_allUnits.find(u => u.id === btn.dataset.id));
    });
    wrap.querySelectorAll('.swu-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this SW unit? This cannot be undone.')) return;
        const { error } = await sb.from('sw_units').delete().eq('id', btn.dataset.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('SW unit deleted.', 'success');
        await loadList();
      };
    });
    wrap.querySelectorAll('.swu-needs-review-badge').forEach(badge => {
      badge.onclick = () => navigate(`${base}/reviews/new?artifact_type=sw_units&artifact_id=${badge.dataset.id}`);
    });
    wrap.querySelectorAll('.swu-link-btn').forEach(btn => {
      btn.onclick = () => copyElementLink(`swu-row-${btn.dataset.id}`);
    });

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
      .order('unit_code');

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
        needs_review_update = { needs_review: true, version: (existing.version || 1) + 1 };
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
              version: (existing.version || 1) + 1,
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
