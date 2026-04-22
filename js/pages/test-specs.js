/**
 * Test Specifications — unit_testing, integration_testing, system_testing
 *
 * Layout: table on left + sliding detail panel on right.
 * Detail panel sections: Basic Info · Traceability · Definition · Preconditions
 *                        Test Steps · Criteria · Execution
 */

import { sb } from '../config.js';
import { toast } from '../toast.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE_META = {
  unit_testing:        { label: 'Unit Testing',        prefix: 'UT' },
  integration_testing: { label: 'Integration Testing', prefix: 'IT' },
  system_testing:      { label: 'System Testing',      prefix: 'ST' },
};

const STATUSES     = ['draft', 'review', 'approved', 'active', 'deprecated'];
const TYPES        = ['verification', 'validation'];
const LEVELS       = ['system', 'subsystem', 'component'];
const METHODS      = ['test', 'analysis', 'inspection', 'demonstration'];
const ENVIRONMENTS = ['simulation', 'lab', 'field'];
const RESULTS      = ['pass', 'fail', 'blocked'];

const STATUS_COLORS = {
  draft: '#9AA0A6', review: '#F29900', approved: '#34A853',
  active: '#1A73E8', deprecated: '#EA4335',
};
const RESULT_COLORS = { pass: '#34A853', fail: '#EA4335', blocked: '#F29900' };

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx        = null;   // { project, item, system, phase, parentType, parentId }
let _tests      = [];
let _selectedId = null;
let _reqs       = [];     // cached requirements for autocomplete

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderTestSpecs(container, { project, item, system, phase, domain, pageId }) {
  const meta = PHASE_META[phase] || { label: phase, prefix: 'TS' };
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const parentName = system?.name || item?.name;

  _ctx = { project, item, system, phase, parentType, parentId, meta };
  _tests      = [];
  _selectedId = null;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: parentName },
    { label: meta.label },
  ]);
  renderSidebar({ view: 'item', project, item, system, activePage: phase });

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
    <div class="ts-page-body" id="ts-page-body">
      <div class="ts-list-pane" id="ts-list-pane">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <div class="ts-detail-pane" id="ts-detail-pane"></div>
    </div>
    <div class="spec-fab" id="ts-fab">
      <button class="btn btn-primary" id="btn-new-test">＋ New Test</button>
    </div>
  `;

  document.getElementById('btn-new-test').onclick = () => createTest();

  // Cache requirements for traceability autocomplete
  const { data: reqs } = await sb.from('requirements')
    .select('id, req_code, title, type')
    .eq('parent_type', parentType).eq('parent_id', parentId)
    .not('type', 'in', '("title","info")')
    .order('sort_order', { ascending: true });
  _reqs = reqs || [];

  await loadTests();
}

// ── Load & render table ───────────────────────────────────────────────────────

async function loadTests() {
  const { parentType, parentId, phase } = _ctx;
  const { data, error } = await sb.from('test_specs')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .eq('phase', phase)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true });

  const pane = document.getElementById('ts-list-pane');
  if (!pane) return;
  if (error) { pane.innerHTML = `<p class="text-muted">Error loading tests: ${esc(error.message)}</p>`; return; }

  _tests = data || [];
  renderTestTable(pane);

  // Re-open selected test if any
  if (_selectedId && _tests.find(t => t.id === _selectedId)) {
    openDetail(_selectedId);
  } else {
    _selectedId = null;
    closeDetail();
  }
}

function renderTestTable(pane) {
  if (!_tests.length) {
    pane.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧪</div>
        <h3>No test specifications yet</h3>
        <p>Click <strong>＋ New Test</strong> to create the first test specification.</p>
      </div>`;
    return;
  }

  pane.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table ts-table" id="ts-table">
          <thead>
            <tr>
              <th style="width:110px">ID</th>
              <th>Name</th>
              <th style="width:110px">Type</th>
              <th style="width:100px">Level</th>
              <th style="width:100px">Method</th>
              <th style="width:120px">Requirement(s)</th>
              <th style="width:90px">Status</th>
              <th style="width:80px">Result</th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody id="ts-tbody">
            ${_tests.map(t => testRowHTML(t)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('ts-tbody').querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.ts-row-del')) return;
      openDetail(tr.dataset.id);
    });
    tr.querySelector('.ts-row-del')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete test "${_tests.find(t => t.id === tr.dataset.id)?.name || tr.dataset.id}"?`)) return;
      await sb.from('test_specs').delete().eq('id', tr.dataset.id);
      if (_selectedId === tr.dataset.id) closeDetail();
      _tests.splice(_tests.findIndex(t => t.id === tr.dataset.id), 1);
      tr.remove();
      if (!_tests.length) renderTestTable(document.getElementById('ts-list-pane'));
      toast('Test deleted.', 'success');
    });
  });
}

function testRowHTML(t) {
  const reqs  = (t.linked_requirements || []).slice(0, 3).join(', ') + (t.linked_requirements?.length > 3 ? '…' : '');
  const sColor = STATUS_COLORS[t.status]  || '#9AA0A6';
  const rColor = RESULT_COLORS[t.result] || '';
  const isSelected = t.id === _selectedId;
  return `
    <tr data-id="${t.id}" class="ts-row${isSelected ? ' ts-row--selected' : ''}" style="cursor:pointer">
      <td class="code-cell" style="white-space:nowrap">${esc(t.test_code || '—')}</td>
      <td><strong style="font-size:13px">${esc(t.name || 'Untitled')}</strong></td>
      <td><span class="ts-badge ts-badge--type">${esc(t.type || '—')}</span></td>
      <td style="font-size:12px;color:var(--color-text-muted)">${esc(t.level || '—')}</td>
      <td style="font-size:12px">${esc(t.method || '—')}</td>
      <td style="font-size:11px;color:var(--color-text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(reqs || '—')}</td>
      <td><span class="ts-badge" style="background:${sColor}20;color:${sColor};border:1px solid ${sColor}40">${esc(t.status || 'draft')}</span></td>
      <td>${t.result ? `<span class="ts-badge ts-badge--result ts-result--${t.result}">${t.result.toUpperCase()}</span>` : '<span style="color:#ccc;font-size:11px">—</span>'}</td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-xs ts-row-del" style="color:var(--color-danger)" title="Delete">✕</button>
      </td>
    </tr>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openDetail(testId) {
  _selectedId = testId;
  const test = _tests.find(t => t.id === testId);
  if (!test) return;

  // Highlight selected row
  document.querySelectorAll('.ts-row').forEach(tr =>
    tr.classList.toggle('ts-row--selected', tr.dataset.id === testId));

  const panel = document.getElementById('ts-detail-pane');
  panel.classList.add('open');
  panel.innerHTML = buildDetailHTML(test);
  wireDetail(test);

  // Narrow the list pane
  document.getElementById('ts-list-pane').classList.add('ts-list-pane--narrow');
}

function closeDetail() {
  _selectedId = null;
  document.querySelectorAll('.ts-row').forEach(tr => tr.classList.remove('ts-row--selected'));
  const panel = document.getElementById('ts-detail-pane');
  panel.classList.remove('open');
  panel.innerHTML = '';
  document.getElementById('ts-list-pane')?.classList.remove('ts-list-pane--narrow');
}

function buildDetailHTML(t) {
  const steps = t.steps || [];
  const linkedReqs = (t.linked_requirements || []).join(', ');

  return `
    <div class="ts-detail-inner">
      <!-- Header -->
      <div class="ts-detail-header">
        <div>
          <div class="ts-detail-code">${esc(t.test_code || '—')}</div>
          <input class="ts-detail-title-inp" id="td-name" value="${esc(t.name || '')}" placeholder="Test name…"/>
        </div>
        <button class="btn-icon ts-detail-close" id="ts-close-btn" title="Close">✕</button>
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
                  ${TYPES.map(v => `<option value="${v}" ${t.type===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field">
                <label>Level</label>
                <select id="td-level" class="form-input form-select">
                  ${LEVELS.map(v => `<option value="${v}" ${t.level===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field">
                <label>Status</label>
                <select id="td-status" class="form-input form-select">
                  ${STATUSES.map(v => `<option value="${v}" ${t.status===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field" style="max-width:80px">
                <label>Version</label>
                <input id="td-version" class="form-input" value="${esc(t.version || '1.0')}" placeholder="1.0"/>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ② Traceability -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="trace">
          <span class="ts-section-chevron">▶</span> Traceability
        </div>
        <div class="ts-section-body" id="sec-trace" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Linked Requirements <span style="color:var(--color-danger)">*</span></label>
              <div class="ts-req-tags" id="ts-req-tags">
                ${(t.linked_requirements || []).map(rc => reqTagHTML(rc)).join('')}
              </div>
              <div style="display:flex;gap:6px;margin-top:6px">
                <input id="ts-req-inp" class="form-input" placeholder="Type req code and press Enter…"
                  style="flex:1;font-size:12px"
                  list="ts-req-datalist"/>
                <datalist id="ts-req-datalist">
                  ${_reqs.map(r => `<option value="${esc(r.req_code)}">${esc(r.req_code)} — ${esc(r.title || '')}</option>`).join('')}
                </datalist>
              </div>
            </div>
            <div class="ts-field">
              <label>Linked Functions (optional)</label>
              <input id="td-linked-functions" class="form-input"
                value="${esc((t.linked_functions || []).join(', '))}"
                placeholder="Function names, comma-separated"/>
            </div>
            <div class="ts-field">
              <label>Linked Components (optional)</label>
              <input id="td-linked-components" class="form-input"
                value="${esc((t.linked_components || []).join(', '))}"
                placeholder="Component names, comma-separated"/>
            </div>
            <div class="ts-field">
              <label>Linked Safety Items (FHA/FMEA, optional)</label>
              <input id="td-linked-safety" class="form-input"
                value="${esc((t.linked_safety || []).join(', '))}"
                placeholder="Safety item codes, comma-separated"/>
            </div>
          </div>
        </div>
      </div>

      <!-- ③ Test Definition -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="defn">
          <span class="ts-section-chevron">▶</span> Test Definition
        </div>
        <div class="ts-section-body" id="sec-defn" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field-row">
              <div class="ts-field">
                <label>Method</label>
                <select id="td-method" class="form-input form-select">
                  ${METHODS.map(v => `<option value="${v}" ${t.method===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
              <div class="ts-field">
                <label>Environment</label>
                <select id="td-environment" class="form-input form-select">
                  ${ENVIRONMENTS.map(v => `<option value="${v}" ${t.environment===v?'selected':''}>${cap(v)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="ts-field">
              <label>Preconditions</label>
              <textarea id="td-preconditions" class="form-input form-textarea" rows="4"
                placeholder="• Initial system state&#10;• HW/SW configuration&#10;• Required conditions&#10;• Dependencies">${esc(t.preconditions || '')}</textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- ④ Test Steps -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="steps">
          <span class="ts-section-chevron">▶</span> Test Steps
        </div>
        <div class="ts-section-body" id="sec-steps" style="display:none">
          <table class="ts-steps-table" id="ts-steps-table">
            <thead>
              <tr>
                <th style="width:18px"></th>
                <th style="width:36px">#</th>
                <th>Action</th>
                <th>Input / Data</th>
                <th>Expected Result</th>
                <th style="width:30px"></th>
              </tr>
            </thead>
            <tbody id="ts-steps-tbody">
              ${steps.map((s, i) => stepRowHTML(s, i)).join('')}
            </tbody>
          </table>
          <button class="btn btn-secondary btn-sm" id="ts-add-step" style="margin-top:8px">＋ Add Step</button>
        </div>
      </div>

      <!-- ⑤ Expected Results & Acceptance Criteria -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="criteria">
          <span class="ts-section-chevron">▶</span> Results &amp; Acceptance Criteria
        </div>
        <div class="ts-section-body" id="sec-criteria" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Expected Results <span style="color:var(--color-text-muted);font-size:11px">(per-step summary)</span></label>
              <textarea id="td-expected-results" class="form-input form-textarea" rows="3"
                placeholder="Summarise the expected system behaviour after all steps are executed.">${esc(t.expected_results || '')}</textarea>
            </div>
            <div class="ts-field">
              <label>Acceptance Criteria <span style="color:var(--color-text-muted);font-size:11px">(global Pass/Fail definition)</span></label>
              <textarea id="td-acceptance-criteria" class="form-input form-textarea" rows="4"
                placeholder="• Metric A ≥ threshold X&#10;• No errors of type Y during execution&#10;• Response time &lt; Z ms">${esc(t.acceptance_criteria || '')}</textarea>
            </div>
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
            <div class="ts-field-row" style="align-items:center;gap:10px">
              <div class="ts-field">
                <label>Result</label>
                <div class="ts-result-btns" id="ts-result-btns">
                  ${RESULTS.map(r => `
                    <button class="ts-result-btn ts-result-btn--${r}${t.result===r?' active':''}" data-result="${r}">
                      ${r === 'pass' ? '✓' : r === 'fail' ? '✗' : '⊘'} ${r.toUpperCase()}
                    </button>`).join('')}
                  <button class="ts-result-btn ts-result-btn--clear${!t.result?' active':''}" data-result="">— Clear</button>
                </div>
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
                <input id="ts-evidence-url"  class="form-input" placeholder="URL or path" style="flex:2;font-size:12px"/>
                <button class="btn btn-secondary btn-sm" id="ts-add-evidence">＋ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Save button -->
      <div class="ts-detail-footer">
        <button class="btn btn-secondary btn-sm" id="ts-btn-duplicate" title="Duplicate this test">⊕ Duplicate</button>
        <button class="btn btn-primary" id="ts-btn-save">Save</button>
      </div>
    </div>
  `;
}

function stepRowHTML(s, i) {
  return `
    <tr class="ts-step-row" data-step-idx="${i}" draggable="true">
      <td class="ts-step-drag" title="Drag to reorder">⠿</td>
      <td class="ts-step-num" style="text-align:center;color:var(--color-text-muted);font-size:11px">${i + 1}</td>
      <td><textarea class="ts-step-inp ts-step-action" rows="2" placeholder="Action…">${esc(s.action || '')}</textarea></td>
      <td><textarea class="ts-step-inp ts-step-input"  rows="2" placeholder="Input / data…">${esc(s.input || '')}</textarea></td>
      <td><textarea class="ts-step-inp ts-step-expected" rows="2" placeholder="Expected result…">${esc(s.expected_result || '')}</textarea></td>
      <td style="text-align:center">
        <button class="btn btn-ghost btn-xs ts-step-del" style="color:var(--color-danger)" title="Remove step">✕</button>
      </td>
    </tr>`;
}

function reqTagHTML(code) {
  return `<span class="ts-req-tag" data-code="${esc(code)}">${esc(code)}<button class="ts-req-tag-del" data-code="${esc(code)}" title="Remove">×</button></span>`;
}

function evidenceItemHTML(e, i) {
  return `<div class="ts-evidence-item" data-idx="${i}">
    <span class="ts-evidence-icon">📎</span>
    <span class="ts-evidence-name">${esc(e.name || '')}</span>
    ${e.url ? `<a href="${esc(e.url)}" target="_blank" class="ts-evidence-url" title="${esc(e.url)}">↗</a>` : ''}
    <button class="ts-evidence-del btn btn-ghost btn-xs" data-idx="${i}" style="color:var(--color-danger);margin-left:auto">✕</button>
  </div>`;
}

// ── Wire detail panel interactions ────────────────────────────────────────────

function wireDetail(test) {
  // Close
  document.getElementById('ts-close-btn').onclick = () => closeDetail();

  // Section accordion
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
  document.getElementById('ts-result-btns').querySelectorAll('.ts-result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ts-result-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Requirement tag input
  const reqInp  = document.getElementById('ts-req-inp');
  const reqTags = document.getElementById('ts-req-tags');
  const addReqTag = (code) => {
    code = code.trim().toUpperCase();
    if (!code) return;
    if (reqTags.querySelector(`[data-code="${code}"]`)) return;
    const span = document.createElement('span');
    span.className = 'ts-req-tag';
    span.dataset.code = code;
    span.innerHTML = `${esc(code)}<button class="ts-req-tag-del" data-code="${esc(code)}" title="Remove">×</button>`;
    span.querySelector('.ts-req-tag-del').onclick = () => span.remove();
    reqTags.appendChild(span);
  };
  reqTags.querySelectorAll('.ts-req-tag-del').forEach(btn => {
    btn.onclick = () => btn.closest('.ts-req-tag').remove();
  });
  reqInp.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addReqTag(reqInp.value);
      reqInp.value = '';
    }
  });

  // Steps: add
  document.getElementById('ts-add-step').onclick = () => {
    const tbody = document.getElementById('ts-steps-tbody');
    const idx   = tbody.querySelectorAll('.ts-step-row').length;
    const tr    = document.createElement('tr');
    tr.className = 'ts-step-row';
    tr.draggable = true;
    tr.dataset.stepIdx = idx;
    tr.innerHTML = stepRowHTML({ action: '', input: '', expected_result: '' }, idx).match(/<tr[^>]*>([\s\S]*)<\/tr>/)?.[1] || '';
    tbody.appendChild(tr);
    wireStepRow(tr);
    renumberSteps();
    tr.querySelector('.ts-step-action')?.focus();
  };

  // Steps: wire existing rows
  document.querySelectorAll('.ts-step-row').forEach(tr => wireStepRow(tr));
  wireStepsDnD(document.getElementById('ts-steps-tbody'));

  // Evidence: add
  document.getElementById('ts-add-evidence').onclick = () => {
    const name = document.getElementById('ts-evidence-name').value.trim();
    const url  = document.getElementById('ts-evidence-url').value.trim();
    if (!name && !url) return;
    const list = document.getElementById('ts-evidence-list');
    const idx  = list.querySelectorAll('.ts-evidence-item').length;
    const div  = document.createElement('div');
    div.className = 'ts-evidence-item';
    div.dataset.idx = idx;
    div.innerHTML = evidenceItemHTML({ name, url }, idx).replace(/<div[^>]*>|<\/div>/g, '');
    div.querySelector('.ts-evidence-del').onclick = () => div.remove();
    list.appendChild(div);
    document.getElementById('ts-evidence-name').value = '';
    document.getElementById('ts-evidence-url').value  = '';
  };
  document.querySelectorAll('.ts-evidence-del').forEach(btn => {
    btn.onclick = () => btn.closest('.ts-evidence-item').remove();
  });

  // Save
  document.getElementById('ts-btn-save').onclick = () => saveDetail(test);

  // Duplicate
  document.getElementById('ts-btn-duplicate').onclick = () => duplicateTest(test);
}

function wireStepRow(tr) {
  tr.querySelector('.ts-step-del').onclick = () => {
    tr.remove();
    renumberSteps();
  };
}

function renumberSteps() {
  document.querySelectorAll('#ts-steps-tbody .ts-step-row').forEach((tr, i) => {
    tr.dataset.stepIdx = i;
    const num = tr.querySelector('.ts-step-num');
    if (num) num.textContent = i + 1;
  });
}

function wireStepsDnD(tbody) {
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
    tbody.querySelectorAll('.ts-step-drop').forEach(t => t.classList.remove('ts-step-drop'));
    dragTr = null;
  });

  tbody.addEventListener('dragover', e => {
    if (!dragTr) return;
    const tr = e.target.closest('.ts-step-row');
    if (!tr || tr === dragTr) return;
    e.preventDefault();
    tbody.querySelectorAll('.ts-step-drop').forEach(t => t.classList.remove('ts-step-drop'));
    tr.classList.add('ts-step-drop');
  });

  tbody.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragTr) return;
    const tr = e.target.closest('.ts-step-row');
    if (!tr || tr === dragTr) return;
    tbody.querySelectorAll('.ts-step-drop').forEach(t => t.classList.remove('ts-step-drop'));
    const rect   = tr.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    before ? tr.before(dragTr) : tr.after(dragTr);
    renumberSteps();
  });
}

// ── Save detail ───────────────────────────────────────────────────────────────

async function saveDetail(test) {
  const btn = document.getElementById('ts-btn-save');
  btn.disabled = true;

  // Collect steps
  const steps = [];
  document.querySelectorAll('#ts-steps-tbody .ts-step-row').forEach((tr, i) => {
    steps.push({
      id:              i,
      action:          tr.querySelector('.ts-step-action')?.value.trim()   || '',
      input:           tr.querySelector('.ts-step-input')?.value.trim()    || '',
      expected_result: tr.querySelector('.ts-step-expected')?.value.trim() || '',
    });
  });

  // Collect req tags
  const linkedRequirements = [...document.querySelectorAll('#ts-req-tags .ts-req-tag')]
    .map(t => t.dataset.code).filter(Boolean);

  // Collect evidence
  const evidence = [];
  document.querySelectorAll('#ts-evidence-list .ts-evidence-item').forEach(div => {
    const name = div.querySelector('.ts-evidence-name')?.textContent.trim();
    const url  = div.querySelector('.ts-evidence-url')?.href || '';
    if (name || url) evidence.push({ name: name || '', url });
  });

  // Active result button
  const resultBtn = document.querySelector('.ts-result-btn.active');
  const result    = resultBtn?.dataset.result || null;

  const patch = {
    name:                document.getElementById('td-name')?.value.trim()               || test.name,
    description:         document.getElementById('td-description')?.value.trim()         || null,
    type:                document.getElementById('td-type')?.value                       || test.type,
    level:               document.getElementById('td-level')?.value                      || test.level,
    status:              document.getElementById('td-status')?.value                     || test.status,
    version:             document.getElementById('td-version')?.value.trim()             || '1.0',
    method:              document.getElementById('td-method')?.value                     || test.method,
    environment:         document.getElementById('td-environment')?.value                || test.environment,
    preconditions:       document.getElementById('td-preconditions')?.value.trim()       || null,
    expected_results:    document.getElementById('td-expected-results')?.value.trim()    || null,
    acceptance_criteria: document.getElementById('td-acceptance-criteria')?.value.trim() || null,
    executor:            document.getElementById('td-executor')?.value.trim()            || null,
    execution_date:      document.getElementById('td-execution-date')?.value             || null,
    notes:               document.getElementById('td-notes')?.value.trim()               || null,
    linked_requirements: linkedRequirements,
    linked_functions:    splitCsv(document.getElementById('td-linked-functions')?.value),
    linked_components:   splitCsv(document.getElementById('td-linked-components')?.value),
    linked_safety:       splitCsv(document.getElementById('td-linked-safety')?.value),
    steps,
    evidence,
    result:              result || null,
    updated_at:          new Date().toISOString(),
  };

  const { error } = await sb.from('test_specs').update(patch).eq('id', test.id);
  btn.disabled = false;

  if (error) { toast('Save failed: ' + error.message, 'error'); return; }

  // Update local cache
  Object.assign(test, patch);
  // Refresh the table row
  const tr = document.querySelector(`tr[data-id="${test.id}"]`);
  if (tr) tr.outerHTML = testRowHTML(test);
  // Re-highlight
  document.querySelectorAll('.ts-row').forEach(r =>
    r.classList.toggle('ts-row--selected', r.dataset.id === test.id));

  toast('Test saved.', 'success');
}

// ── Create & duplicate ────────────────────────────────────────────────────────

async function createTest() {
  const { project, parentType, parentId, phase, meta } = _ctx;

  const count = _tests.length + 1;
  const domain = parentType === 'item' ? 'ITEM' : 'SYS';
  const projShort = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode  = `${meta.prefix}-${domain}-${projShort}-${String(count).padStart(3, '0')}`;

  const { data: newTest, error } = await sb.from('test_specs').insert({
    project_id:  project.id,
    parent_type: parentType,
    parent_id:   parentId,
    phase,
    test_code:   testCode,
    name:        'New Test',
    type:        'verification',
    level:       'system',
    status:      'draft',
    method:      'test',
    environment: 'lab',
    sort_order:  _tests.length,
    steps:       [],
    linked_requirements: [],
    evidence:    [],
  }).select().single();

  if (error) { toast('Failed to create test: ' + error.message, 'error'); return; }
  _tests.push(newTest);

  const pane = document.getElementById('ts-list-pane');
  renderTestTable(pane);
  openDetail(newTest.id);
  toast(`${testCode} created.`, 'success');
}

async function duplicateTest(test) {
  const { project, parentType, parentId, phase, meta } = _ctx;
  const count    = _tests.length + 1;
  const domain   = parentType === 'item' ? 'ITEM' : 'SYS';
  const projShort = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode  = `${meta.prefix}-${domain}-${projShort}-${String(count).padStart(3, '0')}`;

  const { data: newTest, error } = await sb.from('test_specs').insert({
    ...test,
    id: undefined,
    test_code:  testCode,
    name:       test.name + ' (copy)',
    result:     null,
    execution_date: null,
    executor:   null,
    notes:      null,
    evidence:   [],
    sort_order: _tests.length,
    created_at: undefined,
    updated_at: undefined,
  }).select().single();

  if (error) { toast('Failed to duplicate: ' + error.message, 'error'); return; }
  _tests.push(newTest);
  const pane = document.getElementById('ts-list-pane');
  renderTestTable(pane);
  openDetail(newTest.id);
  toast(`${testCode} created as duplicate.`, 'success');
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
