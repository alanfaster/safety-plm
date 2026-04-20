/**
 * DFA — Dependent Failure Analysis
 *
 * Layout:
 *  - Top: scrollable table listing all safety-independency requirements + their DFA status
 *  - Bottom: bp-bar panel (collapsed by default) showing the full analysis form
 *    for the currently selected row
 */

import { sb }             from '../../config.js';
import { toast }          from '../../toast.js';
import { wireBottomPanel } from '../../utils/bottom-panel.js';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── DFA template field definitions ───────────────────────────────────────────
const TEMPLATE = [
  {
    section: 'Elements',
    fields: [
      { key: 'element_a',        label: 'Element A',        type: 'text',     placeholder: 'First independent element / failure source' },
      { key: 'element_b',        label: 'Element B',        type: 'text',     placeholder: 'Second independent element / failure source' },
      { key: 'failure_scenario', label: 'Failure scenario', type: 'textarea', placeholder: 'Describe how both elements could fail simultaneously…' },
    ],
  },
  {
    section: 'Dependent Failure Classification',
    fields: [
      {
        key: 'df_type', label: 'Dependent failure type', type: 'select',
        options: [
          { value: '',        label: '— select —' },
          { value: 'ccf',     label: 'Common Cause Failure (CCF) — same root cause' },
          { value: 'cmf',     label: 'Common Mode Failure (CMF) — same failure mode' },
          { value: 'cascade', label: 'Cascading Failure — failure of A causes failure of B' },
        ],
      },
      {
        key: 'mechanisms', label: 'Failure mechanism categories', type: 'checkgroup',
        options: [
          { value: 'emi',         label: 'Electromagnetic interference (EMI / EMC)' },
          { value: 'power',       label: 'Shared power supply / common voltage rail' },
          { value: 'ground',      label: 'Common ground / shared return path' },
          { value: 'thermal',     label: 'Thermal (heat, fire, coolant loss)' },
          { value: 'vibration',   label: 'Vibration / shock' },
          { value: 'moisture',    label: 'Moisture / corrosion / contamination' },
          { value: 'software',    label: 'Software / firmware (common code, shared OS)' },
          { value: 'mfg',         label: 'Manufacturing / production defect (same batch)' },
          { value: 'maintenance', label: 'Maintenance error (same technician / procedure)' },
          { value: 'proximity',   label: 'Physical proximity / shared mounting' },
        ],
      },
    ],
  },
  {
    section: 'Independence Means & Evidence',
    fields: [
      {
        key: 'independence_means', label: 'Independence means', type: 'checkgroup',
        options: [
          { value: 'phys_sep',      label: 'Physical separation / routing segregation' },
          { value: 'elec_isol',     label: 'Electrical isolation (opto-coupler, transformer, relay)' },
          { value: 'sep_power',     label: 'Separate / independent power supplies' },
          { value: 'sep_ground',    label: 'Separate ground paths' },
          { value: 'sw_partition',  label: 'Software partitioning (MMU, hypervisor, time partitioning)' },
          { value: 'diff_supplier', label: 'Different supplier / design diversity' },
          { value: 'temp_monitor',  label: 'Thermal monitoring / over-temperature protection' },
          { value: 'emi_shield',    label: 'EMC shielding / filtering' },
          { value: 'proc_sep',      label: 'Separate manufacturing / procurement process' },
        ],
      },
      { key: 'evidence', label: 'Evidence of independence', type: 'textarea', placeholder: 'Reference to drawings, test reports, analyses, standards compliance…' },
    ],
  },
  {
    section: 'Conclusion',
    fields: [
      { key: 'notes', label: 'Additional notes / open points', type: 'textarea', placeholder: 'Any open actions, caveats, or assumptions…' },
      {
        key: 'residual_risk', label: 'Residual dependent-failure risk', type: 'select',
        options: [
          { value: '',       label: '— select —' },
          { value: 'low',    label: 'Low — independence adequately demonstrated' },
          { value: 'medium', label: 'Medium — partially demonstrated, monitoring needed' },
          { value: 'high',   label: 'High — independence not yet fully demonstrated' },
        ],
      },
      {
        key: 'conclusion', label: 'Conclusion', type: 'select',
        options: [
          { value: '',                label: '— select —' },
          { value: 'independent',     label: 'Independent — requirement satisfied' },
          { value: 'partially',       label: 'Partially independent — conditions apply' },
          { value: 'not_independent', label: 'NOT independent — requirement NOT satisfied' },
          { value: 'not_applicable',  label: 'Not applicable' },
        ],
      },
      {
        key: 'status', label: 'Analysis status', type: 'select',
        options: [
          { value: 'open',   label: 'Open' },
          { value: 'closed', label: 'Closed' },
          { value: 'na',     label: 'N/A' },
        ],
      },
    ],
  },
];

const CONCLUSION_LABEL = {
  independent:     'Independent',
  partially:       'Partially independent',
  not_independent: 'NOT independent',
  not_applicable:  'N/A',
  '':              '—',
};
const CONCLUSION_COLOR = {
  independent:     '#1E8E3E',
  partially:       '#E37400',
  not_independent: '#d93025',
  not_applicable:  '#888',
  '':              '#aaa',
};

// ── Main ─────────────────────────────────────────────────────────────────────
export async function renderDFA(container, { project, item, system, parentType, parentId }) {
  container.innerHTML = `
    <div class="dfa-wrap">
      <div class="dfa-topbar">
        <h2 class="dfa-title">Dependent Failure Analysis</h2>
        <span class="dfa-subtitle">Independence requirements derived from FTA AND gates</span>
      </div>
      <div class="dfa-table-area" id="dfa-table-area">
        <div class="dfa-loading">Loading…</div>
      </div>

      <!-- Bottom panel — DFA analysis form -->
      <div class="bp-bar bp-collapsed dfa-detail-bar" id="dfa-detail-bar">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title" id="dfa-detail-title">DFA Analysis</span>
          <span class="bp-subtitle" id="dfa-detail-subtitle" style="margin-left:8px;font-size:11px;color:#aaa">— select a row above —</span>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body dfa-detail-body" id="dfa-detail-body">
          <div class="dfa-detail-empty">Select a requirement row above to open its DFA analysis here.</div>
        </div>
      </div>
    </div>`;

  const tableArea = container.querySelector('#dfa-table-area');
  const bar       = container.querySelector('#dfa-detail-bar');
  const detailTitle    = container.querySelector('#dfa-detail-title');
  const detailSubtitle = container.querySelector('#dfa-detail-subtitle');
  const detailBody     = container.querySelector('#dfa-detail-body');

  wireBottomPanel(bar, {
    key: `dfa_detail_h_${parentType}_${parentId}`,
    defaultH: 380,
  });

  // Load data
  const [{ data: reqs }, { data: analyses }] = await Promise.all([
    sb.from('requirements')
      .select('id, req_code, title, description, status, source')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('type', 'safety-independency')
      .order('req_code', { ascending: true }),
    sb.from('dfa_analyses')
      .select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId),
  ]);

  const reqList = reqs || [];
  const analysisByReqId = {};
  (analyses || []).forEach(a => { analysisByReqId[a.requirement_id] = a; });

  if (!reqList.length) {
    tableArea.innerHTML = `
      <div class="dfa-empty">
        <div class="dfa-empty-icon">🔗</div>
        <div class="dfa-empty-title">No independence requirements yet</div>
        <div class="dfa-empty-sub">
          Independence requirements are created automatically when you add an AND gate in the FTA.<br>
          Each AND gate with ≥ 2 inputs generates one <em>safety-independency</em> requirement
          and a corresponding DFA entry here.
        </div>
      </div>`;
    return;
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  tableArea.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table dfa-table">
          <thead>
            <tr>
              <th>Req Code</th>
              <th>Independence Requirement</th>
              <th>Element A</th>
              <th>Element B</th>
              <th>DF Type</th>
              <th>Conclusion</th>
              <th>Risk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${reqList.map(req => tableRow(req, analysisByReqId[req.id])).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // ── Row selection ──────────────────────────────────────────────────────────
  let activeReqId = null;

  function selectRow(reqId) {
    activeReqId = reqId;
    tableArea.querySelectorAll('tr[data-req-id]').forEach(tr =>
      tr.classList.toggle('dfa-row-active', tr.dataset.reqId === reqId));

    const req = reqList.find(r => r.id === reqId);
    if (!req) return;

    detailTitle.textContent = `DFA — ${req.req_code}`;
    detailSubtitle.textContent = req.title || '';

    const ana = analysisByReqId[reqId] || {};
    detailBody.innerHTML = buildDetailForm(req, ana);
    wireDetailForm(detailBody, req, ana, analysisByReqId, parentType, parentId, project.id,
      // onSave callback: refresh the table row
      (newData) => {
        const tr = tableArea.querySelector(`tr[data-req-id="${CSS.escape(reqId)}"]`);
        if (tr) tr.outerHTML = tableRow(req, analysisByReqId[reqId]);
        // re-wire the new row click
        const newTr = tableArea.querySelector(`tr[data-req-id="${CSS.escape(reqId)}"]`);
        if (newTr) newTr.addEventListener('click', () => selectRow(reqId));
        newTr?.classList.add('dfa-row-active');
      });

    bar._bp?.expand();
  }

  tableArea.querySelectorAll('tr[data-req-id]').forEach(tr => {
    tr.addEventListener('click', () => selectRow(tr.dataset.reqId));
  });

  // ── Auto-select from Requirements page deep-link ───────────────────────────
  const targetReqId = sessionStorage.getItem('dfa_target_req');
  if (targetReqId) {
    sessionStorage.removeItem('dfa_target_req');
    if (reqList.find(r => r.id === targetReqId)) {
      selectRow(targetReqId);
      requestAnimationFrame(() => {
        const tr = tableArea.querySelector(`tr[data-req-id="${CSS.escape(targetReqId)}"]`);
        if (tr) {
          tr.style.transition = 'background 0.3s';
          tr.style.background = '#E8F0FE';
          setTimeout(() => { tr.style.background = ''; }, 2000);
          tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }
}

// ── Table row ─────────────────────────────────────────────────────────────────
function tableRow(req, ana) {
  const d = ana?.data || {};
  const conclusion  = d.conclusion    || '';
  const risk        = d.residual_risk || '';
  const status      = d.status        || 'open';
  const dfType      = { ccf: 'CCF', cmf: 'CMF', cascade: 'Cascade', '': '—' }[d.df_type || ''] || '—';
  const conclusionLabel = CONCLUSION_LABEL[conclusion] || '—';
  const conclusionColor = CONCLUSION_COLOR[conclusion] || '#aaa';
  const riskBadge = { low: '🟢', medium: '🟡', high: '🔴', '': '' }[risk] || '';
  const statusBadge = {
    open:   '<span class="dfa-badge dfa-badge-open">Open</span>',
    closed: '<span class="dfa-badge dfa-badge-closed">Closed</span>',
    na:     '<span class="dfa-badge dfa-badge-na">N/A</span>',
  }[status] || '';

  return `<tr data-req-id="${esc(req.id)}" style="cursor:pointer">
    <td class="code-cell" style="white-space:nowrap;font-weight:700">${esc(req.req_code || '')}</td>
    <td>
      <div style="font-size:12px;font-weight:600;color:var(--color-text)">${esc(req.title || '')}</div>
      ${req.description ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:2px">${esc(req.description.slice(0, 80))}${req.description.length > 80 ? '…' : ''}</div>` : ''}
    </td>
    <td style="font-size:12px">${esc(d.element_a || '—')}</td>
    <td style="font-size:12px">${esc(d.element_b || '—')}</td>
    <td style="font-size:12px">${esc(dfType)}</td>
    <td style="font-size:12px;font-weight:600;color:${conclusionColor}">${esc(conclusionLabel)}</td>
    <td style="font-size:13px;text-align:center">${riskBadge}</td>
    <td>${statusBadge}</td>
  </tr>`;
}

// ── Detail form ───────────────────────────────────────────────────────────────
function buildDetailForm(req, ana) {
  const d = ana.data || {};
  const sectionsHtml = TEMPLATE.map(section => `
    <div class="dfa-section">
      <div class="dfa-section-title">${esc(section.section)}</div>
      <div class="dfa-section-fields">
        ${section.fields.map(f => buildField(f, d)).join('')}
      </div>
    </div>`).join('');

  return `
    <div class="dfa-detail-form">
      <div class="dfa-req-desc">${esc(req.description || '')}</div>
      ${sectionsHtml}
      <div class="dfa-card-footer">
        <button class="btn btn-sm btn-primary dfa-btn-save">💾 Save analysis</button>
        <span class="dfa-save-status"></span>
      </div>
    </div>`;
}

function buildField(f, data) {
  const val = data[f.key];
  if (f.type === 'text') {
    return `<div class="dfa-field">
      <label class="dfa-field-label">${esc(f.label)}</label>
      <input class="dfa-field-input" data-key="${esc(f.key)}" type="text"
        placeholder="${esc(f.placeholder || '')}" value="${esc(val || '')}">
    </div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="dfa-field dfa-field-full">
      <label class="dfa-field-label">${esc(f.label)}</label>
      <textarea class="dfa-field-textarea" data-key="${esc(f.key)}"
        rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val || '')}</textarea>
    </div>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map(o =>
      `<option value="${esc(o.value)}" ${(val || '') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
    ).join('');
    return `<div class="dfa-field">
      <label class="dfa-field-label">${esc(f.label)}</label>
      <select class="dfa-field-select" data-key="${esc(f.key)}">${opts}</select>
    </div>`;
  }
  if (f.type === 'checkgroup') {
    const checked = Array.isArray(val) ? val : [];
    const boxes = f.options.map(o => `
      <label class="dfa-check-label">
        <input type="checkbox" class="dfa-check" data-key="${esc(f.key)}" data-val="${esc(o.value)}"
          ${checked.includes(o.value) ? 'checked' : ''}>
        ${esc(o.label)}
      </label>`).join('');
    return `<div class="dfa-field dfa-field-full">
      <label class="dfa-field-label">${esc(f.label)}</label>
      <div class="dfa-check-group">${boxes}</div>
    </div>`;
  }
  return '';
}

function wireDetailForm(body, req, ana, analysisByReqId, parentType, parentId, projectId, onSave) {
  const saveBtn  = body.querySelector('.dfa-btn-save');
  const statusEl = body.querySelector('.dfa-save-status');

  saveBtn.addEventListener('click', async () => {
    const data = collectData(body);
    const currentAnaId = analysisByReqId[req.id]?.id || '';

    if (currentAnaId) {
      const { error } = await sb.from('dfa_analyses')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', currentAnaId);
      if (error) {
        console.error('DFA update error:', error);
        statusEl.textContent = '✗ ' + (error.message || error.code || 'Error saving');
        statusEl.style.color = '#d93025'; return;
      }
      analysisByReqId[req.id] = { ...analysisByReqId[req.id], data };
    } else {
      const { data: inserted, error } = await sb.from('dfa_analyses').insert({
        requirement_id: req.id,
        req_code: req.req_code || '',
        project_id: projectId,
        parent_type: parentType,
        parent_id: parentId,
        data,
      }).select('id').single();
      if (error) {
        console.error('DFA insert error:', error);
        statusEl.textContent = '✗ ' + (error.message || error.code || 'Error saving');
        statusEl.style.color = '#d93025'; return;
      }
      analysisByReqId[req.id] = { id: inserted.id, data };
    }

    statusEl.textContent = '✓ Saved';
    statusEl.style.color = '#1E8E3E';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
    onSave(data);
  });
}

function collectData(scope) {
  const data = {};
  scope.querySelectorAll('[data-key]').forEach(el => {
    const key = el.dataset.key;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      if (!Array.isArray(data[key])) data[key] = [];
      if (el.checked) data[key].push(el.dataset.val);
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (!(key in data)) data[key] = el.value;
    }
  });
  return data;
}
