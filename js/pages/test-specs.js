/**
 * Test Specifications — unit_testing, integration_testing, system_testing
 *
 * Layout : spec-nav (Contents) | table | detail panel (right slide-in)
 * Sections, column manager, column filters, drag-to-reorder rows.
 */

import { sb, buildCode, nextIndex } from '../config.js';
import { toast } from '../toast.js';
import { loadColConfig, saveColConfig, applyColVisibility, wireColMgr } from '../components/col-mgr.js';
import { buildFilterRowHTML, applyColFilters, wireColFilterIcons } from '../components/col-filter.js';
import { VMODEL_NODES, PHASE_DB_SOURCE } from '../components/vmodel-editor.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE_META = {
  unit_testing:        { label: 'Unit Testing',        prefix: 'UT' },
  integration_testing: { label: 'Integration Testing', prefix: 'IT' },
  system_testing:      { label: 'System Testing',      prefix: 'ST' },
};

const STATUSES     = ['draft', 'review', 'approved', 'active', 'deprecated'];
const LEVELS       = [
  { value: 'unit_test',        label: 'Unit Test' },
  { value: 'integration_test', label: 'Integration Test' },
  { value: 'item_test',        label: 'Item Test' },
];
const ENVIRONMENTS = ['simulation', 'lab', 'field'];
const RESULTS      = ['pass', 'fail', 'blocked'];

const TEST_METHODS = [
  { id: 'req_based',         label: 'Requirements-based' },
  { id: 'equivalence',       label: 'Equivalence class' },
  { id: 'boundary',          label: 'Boundary value' },
  { id: 'error_guessing',    label: 'Error guessing' },
  { id: 'state_based',       label: 'State-based' },
  { id: 'decision_table',    label: 'Decision table' },
  { id: 'structural_stmt',   label: 'Coverage — Statement' },
  { id: 'structural_branch', label: 'Coverage — Branch' },
  { id: 'structural_mcdc',   label: 'Coverage — MC/DC' },
  { id: 'back_to_back',      label: 'Back-to-back' },
  { id: 'fault_injection',   label: 'Fault injection' },
  { id: 'interface_testing', label: 'Interface' },
  { id: 'performance',       label: 'Performance' },
  { id: 'regression',        label: 'Regression' },
  { id: 'inspection',        label: 'Inspection' },
  { id: 'walkthrough',       label: 'Walk-through / Review' },
];

const STATUS_COLORS = {
  draft: '#9AA0A6', review: '#F29900', approved: '#34A853',
  active: '#1A73E8', deprecated: '#EA4335',
};
const RESULT_COLORS = { pass: '#34A853', fail: '#EA4335', blocked: '#F29900' };
const RESULT_LABELS = { pass: '✓ PASS', fail: '✗ FAIL', blocked: '⊘ BLOCKED' };

const BUILTIN_COLS = [
  { id: 'drag',    name: '',             fixed: true,  visible: true },
  { id: 'code',    name: 'ID',           fixed: true,  visible: true },
  { id: 'name',    name: 'Name',         fixed: true,  visible: true },
  { id: 'type',    name: 'Type',         visible: true },
  { id: 'level',   name: 'Level',        visible: true },
  { id: 'trace',   name: 'Traced to',    visible: true },
  { id: 'status',  name: 'Status',       visible: true },
  { id: 'result',  name: 'Result',       visible: true },
  { id: 'actions', name: '',             fixed: true,  visible: true },
];

const SKIP_FILTER = new Set(['drag', 'actions']);

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx          = null;
let _rows         = [];     // tests + section rows, ordered
let _cols         = [];
let _selectedId   = null;
let _testTypes    = [];
let _traceFields  = [];
let _traceData    = {};
let _saveTimer    = null;
let _currentUser  = null;
let _colFilters   = {};
let _colKey       = '';

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderTestSpecs(container, { project, item, system, phase, domain, pageId }) {
  const meta       = PHASE_META[phase] || { label: phase, prefix: 'TS' };
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const parentName = system?.name || item?.name;
  const domainKey  = parentType === 'system' ? (domain || 'system') : 'item';

  _ctx         = { project, item, system, phase, domain: domainKey, parentType, parentId, meta };
  _rows        = [];
  _selectedId  = null;
  _saveTimer   = null;
  _traceData   = {};
  _colFilters  = {};
  _colKey      = `ts_${parentId}_${phase}`;
  _cols        = loadColConfig(_colKey, BUILTIN_COLS);

  const { data: { user } } = await sb.auth.getUser();
  _currentUser = user;

  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const cfg = pcRow?.config || {};
  _testTypes   = cfg.test_types || ['test', 'inspection', 'analysis', 'demonstration'];
  _traceFields = deriveTraceFields(domainKey, phase, cfg.vmodel_links || []);
  await loadTraceSourceData(item, system);

  // Remove any leftover insert pill from a previous render
  document.getElementById('ts-insert-pill')?.remove();

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${meta.label}</h1>
          <p class="text-muted">${esc(parentName)}</p>
        </div>
        <div></div>
      </div>
    </div>
    <div class="page-body spec-page-body" id="ts-outer">
      <nav class="spec-nav" id="ts-nav">
        <button class="spec-nav-expand" id="ts-nav-expand" title="Open navigation">
          <span>❯</span>
          <span class="spec-nav-rail-label">Contents</span>
        </button>
        <div class="spec-nav-hdr">
          <span class="spec-nav-title">Contents</span>
          <button class="btn-icon spec-nav-close" id="ts-nav-close" title="Close">✕</button>
        </div>
        <div class="spec-nav-tree" id="ts-nav-tree"></div>
      </nav>
      <div class="spec-content" id="ts-body">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <aside class="req-trace-panel" id="ts-detail-panel">
        <div class="req-trace-panel-hdr">
          <span class="req-trace-panel-title" id="ts-panel-title">Test Detail</span>
          <button class="btn-icon" id="ts-panel-close" title="Close">✕</button>
        </div>
        <div class="req-trace-panel-body" id="ts-panel-body">
          <p style="padding:16px;font-size:13px;color:var(--color-text-muted)">
            Click any test row to view and edit its details.
          </p>
        </div>
      </aside>
    </div>
    <div class="spec-fab" id="ts-fab">
      <button class="btn btn-primary"   id="btn-new-test">＋ New Test</button>
      <button class="btn btn-secondary" id="btn-new-section">＋ Section</button>
    </div>
  `;

  document.getElementById('btn-new-test').onclick    = () => createTest();
  document.getElementById('btn-new-section').onclick = () => addSection(null);
  document.getElementById('ts-nav-close').onclick    = () => toggleNav(false);
  document.getElementById('ts-nav-expand').onclick   = () => toggleNav(true);
  document.getElementById('ts-panel-close').onclick  = () => closeDetail();

  await loadTests();
  applyGotoTarget();
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function toggleNav(open) {
  const nav = document.getElementById('ts-nav');
  if (!nav) return;
  if (open === undefined) nav.classList.toggle('spec-nav--hidden');
  else nav.classList.toggle('spec-nav--hidden', !open);
}

function buildNavTree() {
  const tree = document.getElementById('ts-nav-tree');
  if (!tree) return;
  const sections = _rows.filter(r => r.type === 'section');
  if (!sections.length) {
    tree.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--color-text-muted)">No sections yet</div>`;
    return;
  }
  tree.innerHTML = sections.map(r =>
    `<div class="spec-nav-item spec-nav-item--l1" data-sid="${r.id}" title="${esc(r.name || '')}">
      ${esc(r.name || 'Untitled section')}
    </div>`
  ).join('');
  tree.querySelectorAll('.spec-nav-item').forEach(el => {
    el.onclick = () => {
      const tr = document.querySelector(`tr[data-id="${el.dataset.sid}"]`);
      if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function applyGotoTarget() {
  const raw = sessionStorage.getItem('tdb_goto');
  if (!raw) return;
  try {
    const { code } = JSON.parse(raw);
    sessionStorage.removeItem('tdb_goto');
    if (!code) return;
    setTimeout(() => {
      const row = _rows.find(r => r.test_code === code);
      if (!row) return;
      const tr = document.querySelector(`tr[data-id="${row.id}"]`);
      if (tr) {
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        tr.classList.add('req-row--goto-highlight');
        setTimeout(() => tr.classList.remove('req-row--goto-highlight'), 5000);
      }
      openDetail(row.id);
    }, 400);
  } catch {}
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadTests() {
  const { parentType, parentId, phase, domain } = _ctx;
  const { data, error } = await sb.from('test_specs')
    .select('*')
    .eq('parent_type', parentType).eq('parent_id', parentId)
    .eq('phase', phase).eq('domain', domain)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });

  const body = document.getElementById('ts-body');
  if (!body) return;
  if (error) { body.innerHTML = `<p class="text-muted" style="padding:24px">Error: ${esc(error.message)}</p>`; return; }

  _rows = data || [];
  renderTable(body);

  if (_selectedId && _rows.find(r => r.id === _selectedId)) openDetail(_selectedId);
  else { _selectedId = null; resetDetailPanel(); }
}

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable(body) {
  if (!_rows.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧪</div>
        <h3>No test specifications yet</h3>
        <p>Click <strong>＋ New Test</strong> to create the first specification.</p>
      </div>`;
    buildNavTree();
    return;
  }

  const traceLabel = esc(_traceFields.find(f => f.source !== 'free_text')?.label || 'Traced to');
  const COL_OPTIONS = {
    type:   _testTypes.length ? _testTypes.map(t => t.name || t) : undefined,
    level:  LEVELS.map(l => l.label),
    status: STATUSES,
    result: RESULTS,
  };
  Object.keys(COL_OPTIONS).forEach(k => { if (!COL_OPTIONS[k]) delete COL_OPTIONS[k]; });

  // Build visible cols list using current _cols config, mapping col ids to header labels
  const COL_LABELS = {
    drag: '', code: 'ID', name: 'Name', type: 'Type', level: 'Level',
    trace: traceLabel, status: 'Status', result: 'Result', actions: '',
  };
  const COL_WIDTHS = {
    drag: '20px', code: '110px', name: '', type: '100px', level: '110px',
    trace: '130px', status: '90px', result: '90px', actions: '100px',
  };

  const filterRowHTML = buildFilterRowHTML(
    _cols.filter(c => c.visible),
    SKIP_FILTER,
    COL_OPTIONS
  );

  const theadCells = _cols.filter(c => c.visible).map(c => {
    const w = COL_WIDTHS[c.id] ? ` style="width:${COL_WIDTHS[c.id]}"` : '';
    return `<th data-col="${c.id}"${w}>${COL_LABELS[c.id] ?? esc(c.name)}</th>`;
  }).join('');

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table ts-table" id="ts-table">
          <thead>
            <tr id="ts-thead-row">${theadCells}</tr>
            ${filterRowHTML}
          </thead>
          <tbody id="ts-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  const tableEl  = body.querySelector('#ts-table');
  const theadRow = body.querySelector('#ts-thead-row');

  applyColVisibility(tableEl, _cols);
  wireColMgr(theadRow, tableEl, _colKey, _cols, updated => {
    _cols = updated;
    renderTable(body);
  });

  function colVal(r, colId) {
    const traceability = r.traceability || {};
    const firstField   = _traceFields.find(f => f.source !== 'free_text');
    const firstVals    = firstField ? (traceability[firstField.id] || []) : [];
    switch (colId) {
      case 'code':   return r.test_code || '';
      case 'name':   return r.name || '';
      case 'type':   return r.type || '';
      case 'level':  return LEVELS.find(l => l.value === r.level)?.label || r.level || '';
      case 'trace':  return firstVals.join(' ');
      case 'status': return r.status || '';
      case 'result': return r.result || '';
      default:       return '';
    }
  }

  function rerenderTbody() {
    const tests    = _rows.filter(r => r.type !== 'section');
    const filtered = applyColFilters(tests, _colFilters, colVal);
    const filteredIds = new Set(filtered.map(r => r.id));

    const tbody = document.getElementById('ts-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const r of _rows) {
      if (r.type === 'section' || filteredIds.has(r.id)) {
        const tr = buildRowEl(r);
        tbody.appendChild(tr);
        wireRow(tr, r);
      }
    }
    wireDragDrop(tbody);
    wireInsertHover(tbody);
  }

  rerenderTbody();

  const theadEl = body.querySelector('#ts-table thead');
  wireColFilterIcons(theadEl, _colFilters, () => rerenderTbody(), SKIP_FILTER);

  buildNavTree();
}

function buildRowEl(r) {
  const tr = document.createElement('tr');
  tr.dataset.id    = r.id;
  tr.dataset.order = r.sort_order ?? 0;
  if (r.type === 'section') {
    tr.className = 'spec-section-row';
    tr.draggable = false;
    tr.innerHTML = sectionRowHTML(r);
  } else {
    tr.className = `spec-row ts-row${r.id === _selectedId ? ' ts-row--selected' : ''}`;
    tr.draggable = true;
    tr.innerHTML = testRowHTML(r);
  }
  return tr;
}

function sectionRowHTML(r) {
  return `
    <td colspan="20" class="spec-section-cell">
      <div class="spec-section-inner">
        <span class="spec-section-drag spec-drag-handle" title="Drag">⠿</span>
        <span class="spec-section-title" contenteditable="true" spellcheck="false">${esc(r.name || 'Untitled section')}</span>
        <div class="spec-section-actions">
          <button class="btn btn-ghost btn-xs spec-sec-move-up" title="Move section up">↑</button>
          <button class="btn btn-ghost btn-xs spec-sec-move-dn" title="Move section down">↓</button>
          <button class="btn btn-ghost btn-xs spec-add-below"   title="Add test below">+</button>
          <button class="btn btn-ghost btn-xs spec-sec-del"     title="Delete section" style="color:var(--color-danger)">✕</button>
        </div>
      </div>
    </td>`;
}

function testRowHTML(r) {
  const traceability = r.traceability || {};
  const firstField   = _traceFields.find(f => f.source !== 'free_text');
  const firstVals    = firstField ? (traceability[firstField.id] || []) : [];
  const traceStr     = firstVals.slice(0, 2).join(', ') + (firstVals.length > 2 ? '…' : '');
  const sColor       = STATUS_COLORS[r.status] || '#9AA0A6';
  const lvlLabel     = LEVELS.find(l => l.value === r.level)?.label || r.level || '—';

  return _cols.filter(c => c.visible).map(c => {
    switch (c.id) {
      case 'drag':
        return `<td data-col="drag" class="spec-drag-cell"><span class="spec-drag-handle" title="Drag">⠿</span></td>`;
      case 'code':
        return `<td data-col="code" class="code-cell" style="white-space:nowrap">${esc(r.test_code || '—')}</td>`;
      case 'name':
        return `<td data-col="name"><strong style="font-size:13px">${esc(r.name || 'Untitled')}</strong></td>`;
      case 'type':
        return `<td data-col="type"><span class="ts-badge ts-badge--type">${esc(r.type || '—')}</span></td>`;
      case 'level':
        return `<td data-col="level" style="font-size:12px;color:var(--color-text-muted)">${esc(lvlLabel)}</td>`;
      case 'trace':
        return `<td data-col="trace" style="font-size:11px;color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(traceStr || '—')}</td>`;
      case 'status':
        return `<td data-col="status"><span class="ts-badge" style="background:${sColor}20;color:${sColor};border:1px solid ${sColor}40">${esc(r.status || 'draft')}</span></td>`;
      case 'result':
        return r.result
          ? `<td data-col="result"><span class="ts-badge ts-result--${r.result}">${RESULT_LABELS[r.result] || r.result}</span></td>`
          : `<td data-col="result" style="color:#ccc;font-size:11px">not run</td>`;
      case 'actions':
        return `<td data-col="actions" class="spec-row-actions">
          <button class="btn btn-ghost btn-xs spec-move-up"   title="Move up">↑</button>
          <button class="btn btn-ghost btn-xs spec-move-dn"   title="Move down">↓</button>
          <button class="btn btn-ghost btn-xs spec-add-below" title="Add test below">+</button>
          <button class="btn btn-ghost btn-xs spec-del-btn"   title="Delete" style="color:var(--color-danger)">✕</button>
        </td>`;
      default:
        return `<td data-col="${c.id}"></td>`;
    }
  }).join('');
}

// ── Wire row events ───────────────────────────────────────────────────────────

function wireRow(tr, r) {
  if (r.type === 'section') {
    wireSectionRow(tr, r);
  } else {
    wireTestRow(tr, r);
  }
}

function wireTestRow(tr, r) {
  tr.addEventListener('click', e => {
    if (e.target.closest('.spec-row-actions')) return;
    openDetail(r.id);
  });

  tr.querySelector('.spec-move-up')?.addEventListener('click', e => {
    e.stopPropagation(); moveRow(r, -1);
  });
  tr.querySelector('.spec-move-dn')?.addEventListener('click', e => {
    e.stopPropagation(); moveRow(r, 1);
  });
  tr.querySelector('.spec-add-below')?.addEventListener('click', e => {
    e.stopPropagation(); createTest(r);
  });
  tr.querySelector('.spec-del-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${r.name || 'this test'}"?`)) return;
    await sb.from('test_specs').delete().eq('id', r.id);
    if (_selectedId === r.id) closeDetail();
    _rows.splice(_rows.findIndex(x => x.id === r.id), 1);
    renderTable(document.getElementById('ts-body'));
    toast('Deleted.', 'success');
  });
}

function wireSectionRow(tr, r) {
  const titleEl = tr.querySelector('.spec-section-title');
  if (titleEl) {
    titleEl.addEventListener('blur', async () => {
      const newName = titleEl.textContent.trim();
      if (newName === (r.name || '')) return;
      r.name = newName;
      await sb.from('test_specs').update({ name: newName }).eq('id', r.id);
      buildNavTree();
    });
    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    });
  }
  tr.querySelector('.spec-sec-move-up')?.addEventListener('click', () => moveRow(r, -1));
  tr.querySelector('.spec-sec-move-dn')?.addEventListener('click', () => moveRow(r, 1));
  tr.querySelector('.spec-add-below')?.addEventListener('click', () => createTest(r));
  tr.querySelector('.spec-sec-del')?.addEventListener('click', async () => {
    if (!confirm('Delete this section?')) return;
    await sb.from('test_specs').delete().eq('id', r.id);
    _rows.splice(_rows.findIndex(x => x.id === r.id), 1);
    renderTable(document.getElementById('ts-body'));
  });
}

// ── Drag & drop reorder ───────────────────────────────────────────────────────

function wireDragDrop(tbody) {
  if (!tbody) return;
  let dragEl = null;
  tbody.addEventListener('dragstart', e => {
    const tr = e.target.closest('tr[draggable="true"]');
    if (!tr || !e.target.closest('.spec-drag-handle')) { e.preventDefault(); return; }
    dragEl = tr;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => tr.classList.add('ts-step-dragging'), 0);
  });
  tbody.addEventListener('dragend', () => {
    dragEl?.classList.remove('ts-step-dragging');
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    dragEl = null;
  });
  tbody.addEventListener('dragover', e => {
    if (!dragEl) return;
    const tr = e.target.closest('tr');
    if (!tr || tr === dragEl || tr.draggable === false) return;
    e.preventDefault();
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    tr.classList.add('ts-step-drop');
  });
  tbody.addEventListener('drop', async e => {
    e.preventDefault();
    if (!dragEl) return;
    const tr = e.target.closest('tr');
    if (!tr || tr === dragEl) return;
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    const before = e.clientY < tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
    before ? tr.before(dragEl) : tr.after(dragEl);
    await persistOrder(tbody);
  });
}

async function persistOrder(tbody) {
  const trs = [...tbody.querySelectorAll('tr[data-id]')];
  const updates = trs.map((tr, i) => ({ id: tr.dataset.id, sort_order: i }));
  updates.forEach(u => {
    const row = _rows.find(r => r.id === u.id);
    if (row) row.sort_order = u.sort_order;
  });
  _rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  await Promise.all(updates.map(u => sb.from('test_specs').update({ sort_order: u.sort_order }).eq('id', u.id)));
}

async function moveRow(r, dir) {
  const idx    = _rows.findIndex(x => x.id === r.id);
  const target = _rows[idx + dir];
  if (!target) return;
  const tmp         = r.sort_order;
  r.sort_order      = target.sort_order;
  target.sort_order = tmp;
  _rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  await Promise.all([
    sb.from('test_specs').update({ sort_order: r.sort_order }).eq('id', r.id),
    sb.from('test_specs').update({ sort_order: target.sort_order }).eq('id', target.id),
  ]);
  renderTable(document.getElementById('ts-body'));
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function resetDetailPanel() {
  document.getElementById('ts-detail-panel')?.classList.remove('open');
}

function openDetail(testId) {
  _selectedId = testId;
  const test  = _rows.find(r => r.id === testId);
  if (!test) return;

  // Highlight selected row
  document.querySelectorAll('.ts-row').forEach(tr =>
    tr.classList.toggle('ts-row--selected', tr.dataset.id === testId));

  const panel  = document.getElementById('ts-detail-panel');
  const title  = document.getElementById('ts-panel-title');
  const body   = document.getElementById('ts-panel-body');
  if (!panel || !body) return;

  if (title) title.textContent = test.test_code || 'Test Detail';
  panel.classList.add('open');
  body.innerHTML = buildDetailHTML(test);
  wireDetail(test);

  // Narrow the table area
  document.getElementById('ts-body')?.classList.add('spec-content--narrow');
}

function closeDetail() {
  clearTimeout(_saveTimer);
  _selectedId = null;
  document.querySelectorAll('.ts-row').forEach(tr => tr.classList.remove('ts-row--selected'));
  document.getElementById('ts-detail-panel')?.classList.remove('open');
  document.getElementById('ts-body')?.classList.remove('spec-content--narrow');
}

// ── Detail HTML ───────────────────────────────────────────────────────────────

function buildDetailHTML(t) {
  const steps   = t.steps || [];
  const methods = Array.isArray(t.method) ? t.method : (t.method ? [t.method] : []);
  const sColor  = STATUS_COLORS[t.status] || '#9AA0A6';
  const modDate = t.updated_at ? new Date(t.updated_at).toLocaleString() : '—';
  const modBy   = t.last_modified_by || '—';

  return `
    <div class="ts-detail-inner">
      <div class="ts-detail-header">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="ts-detail-code">${esc(t.test_code || '—')}</span>
            <span class="ts-badge" style="background:${sColor}20;color:${sColor};border:1px solid ${sColor}40;font-size:10px">${esc(t.status)}</span>
            ${t.result ? `<span class="ts-badge ts-result--${t.result}" style="font-size:10px">${RESULT_LABELS[t.result]}</span>` : ''}
          </div>
          <input class="ts-detail-title-inp" id="td-name" value="${esc(t.name || '')}" placeholder="Test name…"/>
          <div class="ts-last-modified">
            Last modified: <strong>${esc(modDate)}</strong> by <strong>${esc(modBy)}</strong>
            <span class="ts-autosave-indicator" id="ts-autosave-ind"></span>
          </div>
        </div>
      </div>

      <!-- ① Basic Information -->
      <div class="ts-section">
        <div class="ts-section-hdr ts-section-hdr--open" data-sec="basic">
          <span class="ts-section-chevron">▼</span> Basic Information
        </div>
        <div class="ts-section-body" id="sec-basic">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Description</label>
              <textarea id="td-description" class="form-input form-textarea" rows="3"
                placeholder="What does this test verify?">${esc(t.description || '')}</textarea>
            </div>
            <div class="ts-field-row">
              <div class="ts-field">
                <label>Type</label>
                <select id="td-type" class="form-input form-select">
                  ${_testTypes.map(v => `<option value="${esc(v)}" ${t.type===v?'selected':''}>${esc(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field">
                <label>Level</label>
                <select id="td-level" class="form-input form-select">
                  ${LEVELS.map(l => `<option value="${l.value}" ${t.level===l.value?'selected':''}>${l.label}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field">
                <label>Spec Status</label>
                <select id="td-status" class="form-input form-select">
                  ${STATUSES.map(v => `<option value="${v}" ${t.status===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field" style="max-width:80px">
                <label>Version</label>
                <input id="td-version" class="form-input" value="${esc(t.version || '1.0')}"/>
              </div>
            </div>
            <div class="ts-field">
              <label>Implementation Ticket</label>
              <input id="td-impl-ticket" class="form-input"
                value="${esc(t.implementation_ticket || '')}"
                placeholder="e.g. JIRA-123 or GitHub #456"/>
            </div>
          </div>
        </div>
      </div>

      <!-- ② Test Definition -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="defn">
          <span class="ts-section-chevron">▶</span> Test Definition
        </div>
        <div class="ts-section-body" id="sec-defn" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Environment</label>
              <select id="td-environment" class="form-input form-select" style="max-width:200px">
                ${ENVIRONMENTS.map(v => `<option value="${v}" ${t.environment===v?'selected':''}>${cap(v)}</option>`).join('')}
              </select>
            </div>
            <div class="ts-field">
              <label>Method — select all that apply</label>
              <div class="ts-method-grid" id="ts-method-grid">
                ${TEST_METHODS.map(m => `
                  <label class="ts-method-item">
                    <input type="checkbox" class="ts-method-chk" value="${m.id}"
                      ${methods.includes(m.id) ? 'checked' : ''}/>
                    <span>${esc(m.label)}</span>
                  </label>`).join('')}
              </div>
            </div>
            <div class="ts-field">
              <label>Preconditions</label>
              <textarea id="td-preconditions" class="form-input form-textarea" rows="4"
                placeholder="• Initial system state&#10;• HW/SW configuration&#10;• Required conditions">${esc(t.preconditions || '')}</textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- ③ Test Steps -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="steps">
          <span class="ts-section-chevron">▶</span> Test Steps
        </div>
        <div class="ts-section-body" id="sec-steps" style="display:none">
          <table class="ts-steps-table" id="ts-steps-table">
            <thead>
              <tr>
                <th style="width:18px"></th>
                <th style="width:30px">#</th>
                <th>Action</th>
                <th>Input / Data</th>
                <th>Expected Result</th>
                <th style="width:52px"></th>
              </tr>
            </thead>
            <tbody id="ts-steps-tbody">
              ${steps.map((s, i) => stepRowHTML(s, i)).join('')}
            </tbody>
          </table>
          <button class="btn btn-secondary btn-sm" id="ts-add-step" style="margin-top:8px">＋ Add Step</button>
        </div>
      </div>

      <!-- ④ Results & Acceptance Criteria -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="criteria">
          <span class="ts-section-chevron">▶</span> Results &amp; Acceptance Criteria
        </div>
        <div class="ts-section-body" id="sec-criteria" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Expected Results</label>
              <textarea id="td-expected-results" class="form-input form-textarea" rows="3"
                placeholder="Summarise the expected system behaviour after all steps.">${esc(t.expected_results || '')}</textarea>
            </div>
            <div class="ts-field">
              <label>Acceptance Criteria</label>
              <textarea id="td-acceptance-criteria" class="form-input form-textarea" rows="4"
                placeholder="• Metric A ≥ threshold X&#10;• No errors of type Y">${esc(t.acceptance_criteria || '')}</textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- ⑤ Traceability -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="trace">
          <span class="ts-section-chevron">▶</span> Traceability
        </div>
        <div class="ts-section-body" id="sec-trace" style="display:none">
          <div class="ts-field-grid">
            ${buildTraceFieldsHTML(t)}
          </div>
        </div>
      </div>

      <!-- ⑥ Execution -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="exec">
          <span class="ts-section-chevron">▶</span> Execution
        </div>
        <div class="ts-section-body" id="sec-exec" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Execution Result</label>
              <div class="ts-result-btns" id="ts-result-btns">
                ${RESULTS.map(r => `
                  <button class="ts-result-btn ts-result-btn--${r}${t.result===r?' active':''}" data-result="${r}">
                    ${r==='pass'?'✓':r==='fail'?'✗':'⊘'} ${r.toUpperCase()}
                  </button>`).join('')}
                <button class="ts-result-btn ts-result-btn--clear${!t.result?' active':''}" data-result="">— Not run</button>
              </div>
            </div>
            <div class="ts-field-row">
              <div class="ts-field">
                <label>Executor</label>
                <input id="td-executor" class="form-input" value="${esc(t.executor || '')}" placeholder="Name or team"/>
              </div>
              <div class="ts-field">
                <label>Execution Date</label>
                <input id="td-execution-date" class="form-input" type="date"
                  value="${t.execution_date ? t.execution_date.slice(0,10) : ''}"/>
              </div>
            </div>
            <div class="ts-field">
              <label>Notes / Observations</label>
              <textarea id="td-notes" class="form-input form-textarea" rows="3"
                placeholder="Execution notes, anomalies, blockers…">${esc(t.notes || '')}</textarea>
            </div>
            <div class="ts-field">
              <label>Evidence</label>
              <div id="ts-evidence-list" class="ts-evidence-list">
                ${(t.evidence || []).map((e, i) => evidenceItemHTML(e, i)).join('')}
              </div>
              <div style="display:flex;gap:6px;margin-top:6px">
                <input id="ts-evidence-name" class="form-input" placeholder="Description" style="flex:1;font-size:12px"/>
                <input id="ts-evidence-url"  class="form-input" placeholder="URL or path"  style="flex:2;font-size:12px"/>
                <button class="btn btn-secondary btn-sm" id="ts-add-evidence">＋ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ts-detail-footer">
        <button class="btn btn-secondary btn-sm" id="ts-btn-duplicate">⊕ Duplicate</button>
        <span style="font-size:11px;color:var(--color-text-muted)">Auto-saved</span>
      </div>
    </div>
  `;
}

function stepRowHTML(s, i) {
  return `
    <tr class="ts-step-row" data-step-idx="${i}" draggable="true">
      <td class="ts-step-drag" title="Drag to reorder">⠿</td>
      <td class="ts-step-num" style="text-align:center;color:var(--color-text-muted);font-size:11px">${i + 1}</td>
      <td><textarea class="ts-step-inp ts-step-action"   rows="2" placeholder="Action…">${esc(s.action || '')}</textarea></td>
      <td><textarea class="ts-step-inp ts-step-input"    rows="2" placeholder="Input / data…">${esc(s.input || '')}</textarea></td>
      <td><textarea class="ts-step-inp ts-step-expected" rows="2" placeholder="Expected result…">${esc(s.expected_result || '')}</textarea></td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn btn-ghost btn-xs ts-step-dup" title="Duplicate step">⊕</button>
        <button class="btn btn-ghost btn-xs ts-step-del" style="color:var(--color-danger)" title="Remove">✕</button>
      </td>
    </tr>`;
}

function evidenceItemHTML(e, i) {
  return `<div class="ts-evidence-item" data-idx="${i}">
    <span class="ts-evidence-icon">📎</span>
    <span class="ts-evidence-name">${esc(e.name || '')}</span>
    ${e.url ? `<a href="${esc(e.url)}" target="_blank" class="ts-evidence-url" title="${esc(e.url)}">↗</a>` : ''}
    <button class="ts-evidence-del btn btn-ghost btn-xs" style="color:var(--color-danger);margin-left:auto">✕</button>
  </div>`;
}

function buildTraceFieldsHTML(t) {
  const traceability = t.traceability || {};
  if (!_traceFields.length) {
    return `<p style="color:var(--color-text-muted);font-size:13px">
      No traceability links configured. Go to <strong>Project Settings → V-Model Links</strong>.
    </p>`;
  }
  return _traceFields.map(field => {
    const values  = traceability[field.id] || [];
    const isFree  = field.source === 'free_text';
    const options = isFree ? [] : (_traceData[field.id] || []);

    if (isFree) {
      return `
        <div class="ts-field">
          <label>${esc(field.label)}</label>
          <input id="td-trace-free-${esc(field.id)}" class="form-input ts-trace-free"
            data-field="${esc(field.id)}"
            value="${esc(values.join(', '))}"
            placeholder="Comma-separated…"/>
        </div>`;
    }
    return `
      <div class="ts-field">
        <label>${esc(field.label)}</label>
        <div class="ts-req-tags ts-trace-tags" id="ts-trace-tags-${esc(field.id)}" data-field="${esc(field.id)}">
          ${values.map(c => traceTagHTML(c, field.id)).join('')}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input class="form-input ts-trace-inp" data-field="${esc(field.id)}"
            id="ts-trace-inp-${esc(field.id)}"
            placeholder="Type code + Enter…"
            style="flex:1;font-size:12px"
            list="ts-trace-dl-${esc(field.id)}"/>
          <datalist id="ts-trace-dl-${esc(field.id)}">
            ${options.map(o => `<option value="${esc(o.code)}">${esc(o.code)}${o.label ? ' — ' + esc(o.label) : ''}</option>`).join('')}
          </datalist>
        </div>
      </div>`;
  }).join('');
}

function traceTagHTML(code, fieldId) {
  return `<span class="ts-req-tag" data-code="${esc(code)}" data-field="${esc(fieldId)}">${esc(code)}<button class="ts-req-tag-del" title="Remove">×</button></span>`;
}

// ── Wire detail ───────────────────────────────────────────────────────────────

function wireDetail(test) {
  // Accordion sections
  document.querySelectorAll('.ts-section-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const sec  = document.getElementById(`sec-${hdr.dataset.sec}`);
      const chev = hdr.querySelector('.ts-section-chevron');
      const open = sec.style.display !== 'none';
      sec.style.display = open ? 'none' : '';
      chev.textContent  = open ? '▶' : '▼';
      hdr.classList.toggle('ts-section-hdr--open', !open);
    });
  });

  // Result buttons
  document.getElementById('ts-result-btns')?.querySelectorAll('.ts-result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ts-result-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scheduleSave(test);
    });
  });

  // Traceability tag pickers
  document.querySelectorAll('.ts-trace-tags').forEach(tagsDiv => {
    const fieldId = tagsDiv.dataset.field;
    tagsDiv.querySelectorAll('.ts-req-tag-del').forEach(btn => {
      btn.onclick = () => { btn.closest('.ts-req-tag').remove(); scheduleSave(test); };
    });
    const inp = document.getElementById(`ts-trace-inp-${fieldId}`);
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const code = inp.value.trim();
      if (!code || tagsDiv.querySelector(`[data-code="${CSS.escape(code)}"]`)) { inp.value = ''; return; }
      const span = document.createElement('span');
      span.className = 'ts-req-tag';
      span.dataset.code  = code;
      span.dataset.field = fieldId;
      span.innerHTML = `${esc(code)}<button class="ts-req-tag-del" title="Remove">×</button>`;
      span.querySelector('.ts-req-tag-del').onclick = () => { span.remove(); scheduleSave(test); };
      tagsDiv.appendChild(span);
      inp.value = '';
      scheduleSave(test);
    });
  });

  document.querySelectorAll('.ts-trace-free').forEach(inp => {
    inp.addEventListener('input', () => scheduleSave(test));
  });

  // Steps
  document.getElementById('ts-add-step')?.addEventListener('click', () => {
    addStep({ action: '', input: '', expected_result: '' }, test);
  });
  document.querySelectorAll('.ts-step-row').forEach(tr => wireStepRow(tr, test));
  wireStepsDnD(document.getElementById('ts-steps-tbody'), test);

  // Evidence
  document.getElementById('ts-add-evidence')?.addEventListener('click', () => {
    const name = document.getElementById('ts-evidence-name').value.trim();
    const url  = document.getElementById('ts-evidence-url').value.trim();
    if (!name && !url) return;
    const list = document.getElementById('ts-evidence-list');
    const idx  = list.querySelectorAll('.ts-evidence-item').length;
    const div  = document.createElement('div');
    div.className = 'ts-evidence-item';
    div.dataset.idx = idx;
    div.innerHTML = `<span class="ts-evidence-icon">📎</span>
      <span class="ts-evidence-name">${esc(name)}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" class="ts-evidence-url">↗</a>` : ''}
      <button class="ts-evidence-del btn btn-ghost btn-xs" style="color:var(--color-danger);margin-left:auto">✕</button>`;
    div.querySelector('.ts-evidence-del').onclick = () => { div.remove(); scheduleSave(test); };
    list.appendChild(div);
    document.getElementById('ts-evidence-name').value = '';
    document.getElementById('ts-evidence-url').value  = '';
    scheduleSave(test);
  });
  document.querySelectorAll('.ts-evidence-del').forEach(btn => {
    btn.onclick = () => { btn.closest('.ts-evidence-item').remove(); scheduleSave(test); };
  });

  // Duplicate
  document.getElementById('ts-btn-duplicate')?.addEventListener('click', () => duplicateTest(test));

  // Auto-save scalar fields
  ['td-name','td-description','td-type','td-level','td-status','td-version',
   'td-impl-ticket','td-environment','td-preconditions','td-expected-results',
   'td-acceptance-criteria','td-executor','td-execution-date','td-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  () => scheduleSave(test));
    el.addEventListener('change', () => scheduleSave(test));
  });

  document.querySelectorAll('.ts-method-chk').forEach(chk => {
    chk.addEventListener('change', () => scheduleSave(test));
  });
}

function addStep(s, test) {
  const tbody = document.getElementById('ts-steps-tbody');
  const idx   = tbody.querySelectorAll('.ts-step-row').length;
  const tr    = document.createElement('tr');
  tr.className    = 'ts-step-row';
  tr.draggable    = true;
  tr.dataset.stepIdx = idx;
  tr.innerHTML    = stepRowHTML(s, idx).replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
  tbody.appendChild(tr);
  wireStepRow(tr, test);
  renumberSteps();
  tr.querySelector('.ts-step-action')?.focus();
  scheduleSave(test);
}

function wireStepRow(tr, test) {
  tr.querySelectorAll('.ts-step-inp').forEach(inp => {
    inp.addEventListener('input', () => scheduleSave(test));
  });
  tr.querySelector('.ts-step-del')?.addEventListener('click', () => {
    tr.remove(); renumberSteps(); scheduleSave(test);
  });
  tr.querySelector('.ts-step-dup')?.addEventListener('click', () => {
    const s = {
      action:          tr.querySelector('.ts-step-action')?.value  || '',
      input:           tr.querySelector('.ts-step-input')?.value   || '',
      expected_result: tr.querySelector('.ts-step-expected')?.value || '',
    };
    const tbody = tr.closest('tbody');
    const newTr = document.createElement('tr');
    newTr.className = 'ts-step-row';
    newTr.draggable = true;
    const idx = [...tbody.querySelectorAll('.ts-step-row')].indexOf(tr) + 1;
    newTr.dataset.stepIdx = idx;
    newTr.innerHTML = stepRowHTML(s, idx).replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
    tr.after(newTr);
    wireStepRow(newTr, test);
    renumberSteps();
    scheduleSave(test);
  });
}

function renumberSteps() {
  document.querySelectorAll('#ts-steps-tbody .ts-step-row').forEach((tr, i) => {
    tr.dataset.stepIdx = i;
    const num = tr.querySelector('.ts-step-num');
    if (num) num.textContent = i + 1;
  });
}

function wireStepsDnD(tbody, test) {
  if (!tbody) return;
  let dragTr = null;
  tbody.addEventListener('dragstart', e => {
    const tr = e.target.closest('.ts-step-row');
    if (!tr || !e.target.closest('.ts-step-drag')) { e.preventDefault(); return; }
    dragTr = tr;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => tr.classList.add('ts-step-dragging'), 0);
  });
  tbody.addEventListener('dragend', () => {
    dragTr?.classList.remove('ts-step-dragging');
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    dragTr = null;
  });
  tbody.addEventListener('dragover', e => {
    if (!dragTr) return;
    const tr = e.target.closest('.ts-step-row');
    if (!tr || tr === dragTr) return;
    e.preventDefault();
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    tr.classList.add('ts-step-drop');
  });
  tbody.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragTr) return;
    const tr = e.target.closest('.ts-step-row');
    if (!tr || tr === dragTr) return;
    tbody.querySelectorAll('.ts-step-drop').forEach(x => x.classList.remove('ts-step-drop'));
    const before = e.clientY < tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
    before ? tr.before(dragTr) : tr.after(dragTr);
    renumberSteps();
    scheduleSave(test);
  });
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

function scheduleSave(test) {
  const ind = document.getElementById('ts-autosave-ind');
  if (ind) { ind.textContent = '· saving…'; ind.style.color = 'var(--color-text-muted)'; }
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => doSave(test), 1500);
}

async function doSave(test) {
  const patch = collectPatch(test);
  const { error } = await sb.from('test_specs').update(patch).eq('id', test.id);
  const ind = document.getElementById('ts-autosave-ind');
  if (error) {
    if (ind) { ind.textContent = '· save failed'; ind.style.color = 'var(--color-danger)'; }
    return;
  }
  Object.assign(test, patch);
  if (ind) { ind.textContent = '· saved'; ind.style.color = '#34A853'; setTimeout(() => { if (ind) ind.textContent = ''; }, 2000); }

  // Refresh table row in-place
  const tr = document.querySelector(`tr[data-id="${test.id}"]`);
  if (tr) {
    tr.innerHTML = testRowHTML(test);
    tr.className = `spec-row ts-row ts-row--selected`;
    wireTestRow(tr, test);
  }

  // Update header badges
  const sColor = STATUS_COLORS[test.status] || '#9AA0A6';
  document.querySelector('.ts-detail-header .ts-badge')?.style &&
    Object.assign(document.querySelector('.ts-detail-header .ts-badge').style, {
      background: `${sColor}20`, color: sColor, border: `1px solid ${sColor}40`
    });
}

function collectPatch(test) {
  const methods = [...document.querySelectorAll('.ts-method-chk:checked')].map(c => c.value);

  const steps = [];
  document.querySelectorAll('#ts-steps-tbody .ts-step-row').forEach((tr, i) => {
    steps.push({
      id:              i,
      action:          tr.querySelector('.ts-step-action')?.value.trim()   || '',
      input:           tr.querySelector('.ts-step-input')?.value.trim()    || '',
      expected_result: tr.querySelector('.ts-step-expected')?.value.trim() || '',
    });
  });

  const traceability = {};
  _traceFields.forEach(field => {
    if (field.source === 'free_text') {
      const inp = document.getElementById(`td-trace-free-${field.id}`);
      if (inp) traceability[field.id] = splitCsv(inp.value);
    } else {
      const tagsDiv = document.getElementById(`ts-trace-tags-${field.id}`);
      if (tagsDiv) {
        traceability[field.id] = [...tagsDiv.querySelectorAll('.ts-req-tag')]
          .map(t => t.dataset.code).filter(Boolean);
      }
    }
  });

  const evidence = [];
  document.querySelectorAll('#ts-evidence-list .ts-evidence-item').forEach(div => {
    const name = div.querySelector('.ts-evidence-name')?.textContent.trim() || '';
    const aEl  = div.querySelector('.ts-evidence-url');
    const url  = aEl?.href || '';
    if (name || url) evidence.push({ name, url });
  });

  const resultBtn = document.querySelector('.ts-result-btn.active');

  return {
    name:                  document.getElementById('td-name')?.value.trim()               || test.name,
    description:           document.getElementById('td-description')?.value.trim()         || null,
    type:                  document.getElementById('td-type')?.value                       || test.type,
    level:                 document.getElementById('td-level')?.value                      || test.level,
    status:                document.getElementById('td-status')?.value                     || test.status,
    version:               document.getElementById('td-version')?.value.trim()             || '1.0',
    implementation_ticket: document.getElementById('td-impl-ticket')?.value.trim()         || null,
    method:                methods,
    environment:           document.getElementById('td-environment')?.value                || test.environment,
    preconditions:         document.getElementById('td-preconditions')?.value.trim()       || null,
    expected_results:      document.getElementById('td-expected-results')?.value.trim()    || null,
    acceptance_criteria:   document.getElementById('td-acceptance-criteria')?.value.trim() || null,
    executor:              document.getElementById('td-executor')?.value.trim()            || null,
    execution_date:        document.getElementById('td-execution-date')?.value             || null,
    notes:                 document.getElementById('td-notes')?.value.trim()               || null,
    traceability,
    steps,
    evidence,
    result:                resultBtn?.dataset.result || null,
    last_modified_by:      _currentUser?.email || _currentUser?.id || null,
    updated_at:            new Date().toISOString(),
  };
}

// ── Create / duplicate ────────────────────────────────────────────────────────

async function createTest(afterRow = null) {
  const { project, parentType, parentId, phase, domain, meta } = _ctx;
  const count      = _rows.filter(r => r.type !== 'section').length + 1;
  const domainCode = domain.toUpperCase().slice(0, 3);
  const proj       = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode   = `${meta.prefix}-${domainCode}-${proj}-${String(count).padStart(3, '0')}`;
  const defType    = _testTypes[0] || 'test';

  const insertIdx = afterRow
    ? _rows.findIndex(r => r.id === afterRow.id) + 1
    : _rows.length;
  const sortOrder = afterRow ? (afterRow.sort_order ?? 0) + 0.5 : _rows.length;

  const { data: newTest, error } = await sb.from('test_specs').insert({
    project_id: project.id, parent_type: parentType, parent_id: parentId,
    phase, domain, test_code: testCode, name: 'New Test',
    type: defType, level: 'unit_test', status: 'draft',
    method: [], environment: 'lab', sort_order: sortOrder,
    steps: [], evidence: [],
    last_modified_by: _currentUser?.email || null,
  }).select().single();

  if (error) { toast('Failed to create test: ' + error.message, 'error'); return; }
  _rows.splice(insertIdx, 0, newTest);
  renderTable(document.getElementById('ts-body'));
  openDetail(newTest.id);
  toast(`${testCode} created.`, 'success');
}

async function addSection(afterRow) {
  const { parentType, parentId, phase, domain } = _ctx;
  const sortOrder = afterRow ? (afterRow.sort_order ?? 0) + 0.5 : _rows.length;

  const { data: sec, error } = await sb.from('test_specs').insert({
    project_id: _ctx.project.id,
    parent_type: parentType, parent_id: parentId,
    phase, domain,
    type: 'section', name: 'New Section',
    test_code: null, status: 'draft',
    sort_order: sortOrder,
    steps: [], evidence: [],
  }).select().single();

  if (error) { toast('Failed to create section: ' + error.message, 'error'); return; }
  const insertIdx = afterRow ? _rows.findIndex(r => r.id === afterRow.id) + 1 : _rows.length;
  _rows.splice(insertIdx, 0, sec);
  renderTable(document.getElementById('ts-body'));
  // Focus the section title inline
  setTimeout(() => {
    const tr = document.querySelector(`tr[data-id="${sec.id}"]`);
    tr?.querySelector('.spec-section-title')?.focus();
  }, 50);
}

async function duplicateTest(test) {
  const { project, parentType, parentId, phase, domain, meta } = _ctx;
  const count    = _rows.filter(r => r.type !== 'section').length + 1;
  const domainCode = domain.toUpperCase().slice(0, 3);
  const proj     = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode = `${meta.prefix}-${domainCode}-${proj}-${String(count).padStart(3, '0')}`;

  const { data: newTest, error } = await sb.from('test_specs').insert({
    ...test, id: undefined, test_code: testCode, domain,
    name: test.name + ' (copy)', result: null,
    execution_date: null, executor: null, notes: null, evidence: [],
    sort_order: _rows.length, created_at: undefined, updated_at: undefined,
    last_modified_by: _currentUser?.email || null,
  }).select().single();

  if (error) { toast('Failed to duplicate: ' + error.message, 'error'); return; }
  _rows.push(newTest);
  renderTable(document.getElementById('ts-body'));
  openDetail(newTest.id);
  toast(`${testCode} created as duplicate.`, 'success');
}

// ── Hover insert pill ─────────────────────────────────────────────────────────

function wireInsertHover(tbody) {
  let pill = document.getElementById('ts-insert-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id        = 'ts-insert-pill';
    pill.className = 'spec-insert-pill';
    pill.innerHTML = `
      <span class="spec-insert-line"></span>
      <button class="spec-insert-plus spec-insert-item"    tabindex="-1" title="Add test here">＋ Test</button>
      <button class="spec-insert-plus spec-insert-section" tabindex="-1" title="Add section here">＋ Section</button>
      <span class="spec-insert-line"></span>`;
    document.body.appendChild(pill);
  }

  let afterId   = null;
  let hideTimer = null;

  function showPill(tr) {
    const r = _rows.find(x => x.id === tr.dataset.id);
    if (!r) return;
    afterId = r.id;
    const rect = tr.getBoundingClientRect();
    pill.style.top     = (rect.bottom - 9) + 'px';
    pill.style.left    = rect.left + 'px';
    pill.style.width   = rect.width + 'px';
    pill.style.display = 'flex';
    clearTimeout(hideTimer);
  }

  function hidePill() {
    hideTimer = setTimeout(() => { pill.style.display = 'none'; afterId = null; }, 120);
  }

  tbody.addEventListener('mousemove', e => {
    const tr = e.target.closest('tr');
    if (!tr) { hidePill(); return; }
    const rect = tr.getBoundingClientRect();
    if (e.clientY > rect.bottom - rect.height * 0.35) showPill(tr);
    else hidePill();
  });
  tbody.addEventListener('mouseleave', hidePill);
  pill.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pill.addEventListener('mouseleave', hidePill);

  pill.querySelector('.spec-insert-item').addEventListener('click', () => {
    pill.style.display = 'none';
    if (afterId) createTest(_rows.find(r => r.id === afterId));
  });
  pill.querySelector('.spec-insert-section').addEventListener('click', () => {
    pill.style.display = 'none';
    if (afterId) addSection(_rows.find(r => r.id === afterId));
  });
}

// ── V-Model helpers ───────────────────────────────────────────────────────────

function deriveTraceFields(domain, phase, vmodelLinks) {
  const myNodeId = VMODEL_NODES.find(n => n.domain === domain && n.phase === phase)?.id;
  if (!myNodeId || !vmodelLinks.length) return [];
  const fields = [];
  for (const link of vmodelLinks) {
    if (link.type && link.type !== 'trace') continue;
    const otherNodeId = link.from === myNodeId ? link.to : link.to === myNodeId ? link.from : null;
    if (!otherNodeId) continue;
    const node = VMODEL_NODES.find(n => n.id === otherNodeId);
    if (!node) continue;
    const source = PHASE_DB_SOURCE[node.phase] || 'free_text';
    fields.push({ id: otherNodeId, label: node.label, source, node });
  }
  return fields;
}

async function loadTraceSourceData(item, system) {
  for (const field of _traceFields) {
    if (_traceData[field.id]) continue;
    const node = field.node;
    if (!node) continue;
    const isSystemDomain = node.domain === 'system';
    const parentType     = isSystemDomain ? 'system' : 'item';
    const parentId       = isSystemDomain ? system?.id : item?.id;
    if (!parentId) { _traceData[field.id] = []; continue; }

    const dbSource = PHASE_DB_SOURCE[node.phase];
    if (dbSource === 'requirements') {
      const { data } = await sb.from('requirements')
        .select('req_code, title')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .not('type', 'in', '("title","info")')
        .order('sort_order', { ascending: true });
      _traceData[field.id] = (data || []).map(r => ({ code: r.req_code, label: r.title || '' }));
    } else if (dbSource === 'arch_spec_items') {
      const { data } = await sb.from('arch_spec_items')
        .select('spec_code, title')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .neq('type', 'section')
        .order('sort_order', { ascending: true });
      _traceData[field.id] = (data || []).map(r => ({ code: r.spec_code || r.id, label: r.title || '' }));
    } else if (dbSource === 'test_specs') {
      const { data } = await sb.from('test_specs')
        .select('test_code, name, phase')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('phase', node.phase)
        .order('sort_order', { ascending: true });
      _traceData[field.id] = (data || []).map(r => ({ code: r.test_code, label: r.name || '' }));
    } else {
      _traceData[field.id] = [];
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitCsv(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}
function cap(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
