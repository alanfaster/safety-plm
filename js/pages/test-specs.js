/**
 * Test Specifications — unit_testing, integration_testing, system_testing
 *
 * Layout  : table (left) + sliding detail panel (right)
 * Sections: Basic Info · Test Definition · Test Steps · Criteria · Traceability · Execution
 * Auto-save on every field change (1.5 s debounce)
 */

import { sb } from '../config.js';
import { toast } from '../toast.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';
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

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx          = null;
let _tests        = [];
let _selectedId   = null;
let _testTypes    = [];   // from project_config.test_types
let _traceFields  = [];   // derived from vmodel_links for this page
let _traceData    = {};   // { [fieldId]: [{code, label}] } — cached lookup data
let _saveTimer    = null;
let _currentUser  = null; // { email }


// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderTestSpecs(container, { project, item, system, phase, domain, pageId }) {
  const meta       = PHASE_META[phase] || { label: phase, prefix: 'TS' };
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const parentName = system?.name || item?.name;

  const domainKey = parentType === 'system' ? (domain || 'system') : 'item';
  _ctx          = { project, item, system, phase, domain: domainKey, parentType, parentId, meta };
  _tests        = [];
  _selectedId   = null;
  _saveTimer    = null;
  _traceData    = {};

  // Get current user for last-modified tracking
  const { data: { user } } = await sb.auth.getUser();
  _currentUser = user;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: parentName },
    { label: meta.label },
  ]);
  renderSidebar({ view: 'item', project, item, system, activePage: phase });

  // Load project config
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const cfg = pcRow?.config || {};
  _testTypes  = cfg.test_types || ['test', 'inspection', 'analysis', 'demonstration'];

  // Derive traceability fields from V-Model links
  const vmodelLinks = cfg.vmodel_links || [];
  _traceFields = deriveTraceFields(domain, phase, vmodelLinks);

  // Pre-fetch data for each traceability field
  await loadTraceSourceData(item, system);

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

  await loadTests();
}

// ── V-Model helpers ────────────────────────────────────────────────────────────

/** Derive traceability fields for this page from vmodel_links config */
function deriveTraceFields(domain, phase, vmodelLinks) {
  const myNodeId = VMODEL_NODES.find(n => n.domain === domain && n.phase === phase)?.id;
  if (!myNodeId || !vmodelLinks.length) return [];

  const fields = [];
  for (const link of vmodelLinks) {
    // Only traceability links drive fields; sequential links are visual-only
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

// ── Traceability source loader ────────────────────────────────────────────────

async function loadTraceSourceData(item, system) {
  for (const field of _traceFields) {
    if (_traceData[field.id]) continue;
    const node = field.node;
    if (!node) continue;

    // Resolve parent for this node's domain
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

// ── Load & render table ───────────────────────────────────────────────────────

async function loadTests() {
  const { parentType, parentId, phase, domain } = _ctx;
  let q = sb.from('test_specs')
    .select('*')
    .eq('parent_type', parentType).eq('parent_id', parentId).eq('phase', phase);
  q = q.eq('domain', domain);
  const { data, error } = await q
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });

  const pane = document.getElementById('ts-list-pane');
  if (!pane) return;
  if (error) { pane.innerHTML = `<p class="text-muted">Error: ${esc(error.message)}</p>`; return; }

  _tests = data || [];
  renderTestTable(pane);

  if (_selectedId && _tests.find(t => t.id === _selectedId)) openDetail(_selectedId);
  else { _selectedId = null; closeDetail(); }
}

function renderTestTable(pane) {
  if (!_tests.length) {
    pane.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧪</div>
        <h3>No test specifications yet</h3>
        <p>Click <strong>＋ New Test</strong> to create the first specification.</p>
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
              <th style="width:100px">Type</th>
              <th style="width:110px">Level</th>
              <th style="width:130px">${esc(_traceFields.find(f => f.source !== 'free_text')?.label || 'Traceability')}</th>
              <th style="width:90px">Spec Status</th>
              <th style="width:90px">Result</th>
              <th style="width:40px"></th>
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
      const t = _tests.find(t => t.id === tr.dataset.id);
      if (!confirm(`Delete "${t?.name || 'this test'}"?`)) return;
      await sb.from('test_specs').delete().eq('id', tr.dataset.id);
      if (_selectedId === tr.dataset.id) closeDetail();
      _tests.splice(_tests.findIndex(t => t.id === tr.dataset.id), 1);
      renderTestTable(document.getElementById('ts-list-pane'));
      toast('Deleted.', 'success');
    });
  });
}

function testRowHTML(t) {
  const traceability  = t.traceability || {};
  const firstField    = _traceFields.find(f => f.source !== 'free_text');
  const firstVals     = firstField ? (traceability[firstField.id] || []) : [];
  const reqs          = firstVals.slice(0, 2).join(', ') + (firstVals.length > 2 ? '…' : '');
  const sColor  = STATUS_COLORS[t.status] || '#9AA0A6';
  const rColor  = RESULT_COLORS[t.result] || '';
  const lvlLabel = LEVELS.find(l => l.value === t.level)?.label || t.level || '—';
  const sel     = t.id === _selectedId;
  return `
    <tr data-id="${t.id}" class="ts-row${sel ? ' ts-row--selected' : ''}" style="cursor:pointer">
      <td class="code-cell" style="white-space:nowrap">${esc(t.test_code || '—')}</td>
      <td><strong style="font-size:13px">${esc(t.name || 'Untitled')}</strong></td>
      <td><span class="ts-badge ts-badge--type">${esc(t.type || '—')}</span></td>
      <td style="font-size:12px;color:var(--color-text-muted)">${esc(lvlLabel)}</td>
      <td style="font-size:11px;color:var(--color-text-muted);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(reqs || '—')}</td>
      <td><span class="ts-badge" style="background:${sColor}20;color:${sColor};border:1px solid ${sColor}40">${esc(t.status || 'draft')}</span></td>
      <td>${t.result
        ? `<span class="ts-badge ts-result--${t.result}">${RESULT_LABELS[t.result] || t.result}</span>`
        : '<span style="color:#ccc;font-size:11px">not run</span>'}</td>
      <td><button class="btn btn-ghost btn-xs ts-row-del" style="color:var(--color-danger)" title="Delete">✕</button></td>
    </tr>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openDetail(testId) {
  _selectedId = testId;
  const test  = _tests.find(t => t.id === testId);
  if (!test) return;

  document.querySelectorAll('.ts-row').forEach(tr =>
    tr.classList.toggle('ts-row--selected', tr.dataset.id === testId));

  const panel = document.getElementById('ts-detail-pane');
  panel.classList.add('open');
  panel.innerHTML = buildDetailHTML(test);
  wireDetail(test);
  document.getElementById('ts-list-pane').classList.add('ts-list-pane--narrow');
}

function closeDetail() {
  clearTimeout(_saveTimer);
  _selectedId = null;
  document.querySelectorAll('.ts-row').forEach(tr => tr.classList.remove('ts-row--selected'));
  document.getElementById('ts-detail-pane')?.classList.remove('open');
  if (document.getElementById('ts-detail-pane')) document.getElementById('ts-detail-pane').innerHTML = '';
  document.getElementById('ts-list-pane')?.classList.remove('ts-list-pane--narrow');
}

function buildDetailHTML(t) {
  const steps    = t.steps || [];
  const methods  = Array.isArray(t.method) ? t.method : (t.method ? [t.method] : []);
  const lvlLabel = LEVELS.find(l => l.value === t.level)?.label || t.level || '—';
  const sColor   = STATUS_COLORS[t.status] || '#9AA0A6';
  const modDate  = t.updated_at ? new Date(t.updated_at).toLocaleString() : '—';
  const modBy    = t.last_modified_by || '—';

  return `
    <div class="ts-detail-inner">
      <!-- Header -->
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
                placeholder="• Initial system state&#10;• HW/SW configuration&#10;• Required conditions&#10;• Dependencies">${esc(t.preconditions || '')}</textarea>
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

      <!-- ④ Expected Results & Acceptance Criteria -->
      <div class="ts-section">
        <div class="ts-section-hdr" data-sec="criteria">
          <span class="ts-section-chevron">▶</span> Results &amp; Acceptance Criteria
        </div>
        <div class="ts-section-body" id="sec-criteria" style="display:none">
          <div class="ts-field-grid">
            <div class="ts-field">
              <label>Expected Results <span style="color:var(--color-text-muted);font-size:11px">(per-step summary)</span></label>
              <textarea id="td-expected-results" class="form-input form-textarea" rows="3"
                placeholder="Summarise the expected system behaviour after all steps.">${esc(t.expected_results || '')}</textarea>
            </div>
            <div class="ts-field">
              <label>Acceptance Criteria <span style="color:var(--color-text-muted);font-size:11px">(global Pass/Fail definition)</span></label>
              <textarea id="td-acceptance-criteria" class="form-input form-textarea" rows="4"
                placeholder="• Metric A ≥ threshold X&#10;• No errors of type Y&#10;• Response time &lt; Z ms">${esc(t.acceptance_criteria || '')}</textarea>
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

      <!-- Footer: duplicate only (no save — auto-save) -->
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

function reqTagHTML(code) {
  return `<span class="ts-req-tag" data-code="${esc(code)}">${esc(code)}<button class="ts-req-tag-del" title="Remove">×</button></span>`;
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
      No traceability links configured for this page. Go to
      <strong>Project Settings → V-Model Links</strong> to define connections.
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
  document.getElementById('ts-close-btn').onclick = () => closeDetail();

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

  // Result buttons — trigger auto-save
  document.getElementById('ts-result-btns').querySelectorAll('.ts-result-btn').forEach(btn => {
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

  // Free text traceability fields
  document.querySelectorAll('.ts-trace-free').forEach(inp => {
    inp.addEventListener('input', () => scheduleSave(test));
  });

  // Steps
  document.getElementById('ts-add-step').onclick = () => {
    addStep({ action: '', input: '', expected_result: '' }, test);
  };
  document.querySelectorAll('.ts-step-row').forEach(tr => wireStepRow(tr, test));
  wireStepsDnD(document.getElementById('ts-steps-tbody'), test);

  // Evidence
  document.getElementById('ts-add-evidence').onclick = () => {
    const name = document.getElementById('ts-evidence-name').value.trim();
    const url  = document.getElementById('ts-evidence-url').value.trim();
    if (!name && !url) return;
    const list = document.getElementById('ts-evidence-list');
    const idx  = list.querySelectorAll('.ts-evidence-item').length;
    const div  = document.createElement('div');
    div.className   = 'ts-evidence-item';
    div.dataset.idx = idx;
    div.innerHTML   = `<span class="ts-evidence-icon">📎</span>
      <span class="ts-evidence-name">${esc(name)}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" class="ts-evidence-url">↗</a>` : ''}
      <button class="ts-evidence-del btn btn-ghost btn-xs" style="color:var(--color-danger);margin-left:auto">✕</button>`;
    div.querySelector('.ts-evidence-del').onclick = () => { div.remove(); scheduleSave(test); };
    list.appendChild(div);
    document.getElementById('ts-evidence-name').value = '';
    document.getElementById('ts-evidence-url').value  = '';
    scheduleSave(test);
  };
  document.querySelectorAll('.ts-evidence-del').forEach(btn => {
    btn.onclick = () => { btn.closest('.ts-evidence-item').remove(); scheduleSave(test); };
  });

  // Duplicate
  document.getElementById('ts-btn-duplicate').onclick = () => duplicateTest(test);

  // Auto-save on all scalar inputs
  const autoFields = ['td-name','td-description','td-type','td-level','td-status','td-version',
    'td-impl-ticket','td-environment','td-preconditions','td-expected-results',
    'td-acceptance-criteria','td-executor','td-execution-date','td-notes'];
  autoFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  () => scheduleSave(test));
    el.addEventListener('change', () => scheduleSave(test));
  });

  // Auto-save on method checkboxes
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
  tr.querySelector('.ts-step-del').onclick = () => {
    tr.remove(); renumberSteps(); scheduleSave(test);
  };
  tr.querySelector('.ts-step-dup').onclick = () => {
    const s = {
      action:          tr.querySelector('.ts-step-action')?.value  || '',
      input:           tr.querySelector('.ts-step-input')?.value   || '',
      expected_result: tr.querySelector('.ts-step-expected')?.value || '',
    };
    // Insert duplicate right after this row
    const tbody = tr.closest('tbody');
    const idx   = [...tbody.querySelectorAll('.ts-step-row')].indexOf(tr) + 1;
    const newTr = document.createElement('tr');
    newTr.className = 'ts-step-row';
    newTr.draggable = true;
    newTr.dataset.stepIdx = idx;
    newTr.innerHTML = stepRowHTML(s, idx).replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
    tr.after(newTr);
    wireStepRow(newTr, test);
    renumberSteps();
    scheduleSave(test);
  };
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

  // Refresh table row
  const tr = document.querySelector(`tr[data-id="${test.id}"]`);
  if (tr) {
    const tmp = document.createElement('tbody');
    tmp.innerHTML = testRowHTML(test);
    const newTr = tmp.firstElementChild;
    tr.replaceWith(newTr);
    newTr.addEventListener('click', e => {
      if (e.target.closest('.ts-row-del')) return;
      openDetail(newTr.dataset.id);
    });
    newTr.querySelector('.ts-row-del')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete "${test.name}"?`)) return;
      await sb.from('test_specs').delete().eq('id', test.id);
      closeDetail();
      _tests.splice(_tests.findIndex(t => t.id === test.id), 1);
      renderTestTable(document.getElementById('ts-list-pane'));
    });
  }

  // Update status badges in header
  const sColor = STATUS_COLORS[test.status] || '#9AA0A6';
  const statusBadge = document.querySelector('.ts-detail-header .ts-badge');
  if (statusBadge && !statusBadge.classList.contains('ts-result--pass') &&
      !statusBadge.classList.contains('ts-result--fail') &&
      !statusBadge.classList.contains('ts-result--blocked')) {
    statusBadge.textContent = test.status;
    statusBadge.style.cssText = `background:${sColor}20;color:${sColor};border:1px solid ${sColor}40;font-size:10px`;
  }
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

  // Dynamic traceability fields
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
  const result    = resultBtn?.dataset.result || null;

  return {
    name:                 document.getElementById('td-name')?.value.trim()               || test.name,
    description:          document.getElementById('td-description')?.value.trim()         || null,
    type:                 document.getElementById('td-type')?.value                       || test.type,
    level:                document.getElementById('td-level')?.value                      || test.level,
    status:               document.getElementById('td-status')?.value                     || test.status,
    version:              document.getElementById('td-version')?.value.trim()             || '1.0',
    implementation_ticket:document.getElementById('td-impl-ticket')?.value.trim()         || null,
    method:               methods,
    environment:          document.getElementById('td-environment')?.value                || test.environment,
    preconditions:        document.getElementById('td-preconditions')?.value.trim()       || null,
    expected_results:     document.getElementById('td-expected-results')?.value.trim()    || null,
    acceptance_criteria:  document.getElementById('td-acceptance-criteria')?.value.trim() || null,
    executor:             document.getElementById('td-executor')?.value.trim()            || null,
    execution_date:       document.getElementById('td-execution-date')?.value             || null,
    notes:                document.getElementById('td-notes')?.value.trim()               || null,
    traceability,
    steps,
    evidence,
    result:               result || null,
    last_modified_by:     _currentUser?.email || _currentUser?.id || null,
    updated_at:           new Date().toISOString(),
  };
}

// ── Create & duplicate ────────────────────────────────────────────────────────

async function createTest() {
  const { project, parentType, parentId, phase, domain, meta } = _ctx;
  const count     = _tests.length + 1;
  const domainCode = domain.toUpperCase().slice(0, 3);
  const proj      = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode  = `${meta.prefix}-${domainCode}-${proj}-${String(count).padStart(3, '0')}`;
  const defType   = _testTypes[0] || 'test';

  const { data: newTest, error } = await sb.from('test_specs').insert({
    project_id:   project.id, parent_type: parentType, parent_id: parentId,
    phase, domain, test_code: testCode, name: 'New Test',
    type: defType, level: 'unit_test', status: 'draft',
    method: [], environment: 'lab', sort_order: _tests.length,
    steps: [], linked_requirements: [], evidence: [],
    last_modified_by: _currentUser?.email || null,
  }).select().single();

  if (error) { toast('Failed to create test: ' + error.message, 'error'); return; }
  _tests.push(newTest);
  renderTestTable(document.getElementById('ts-list-pane'));
  openDetail(newTest.id);
  toast(`${testCode} created.`, 'success');
}

async function duplicateTest(test) {
  const { project, parentType, parentId, phase, domain, meta } = _ctx;
  const count    = _tests.length + 1;
  const domainCode = domain.toUpperCase().slice(0, 3);
  const proj     = project.name.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  const testCode = `${meta.prefix}-${domainCode}-${proj}-${String(count).padStart(3, '0')}`;

  const { data: newTest, error } = await sb.from('test_specs').insert({
    ...test, id: undefined, test_code: testCode, domain,
    name: test.name + ' (copy)', result: null,
    execution_date: null, executor: null, notes: null, evidence: [],
    sort_order: _tests.length, created_at: undefined, updated_at: undefined,
    last_modified_by: _currentUser?.email || null,
  }).select().single();

  if (error) { toast('Failed to duplicate: ' + error.message, 'error'); return; }
  _tests.push(newTest);
  renderTestTable(document.getElementById('ts-list-pane'));
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
