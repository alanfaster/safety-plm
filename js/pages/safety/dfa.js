/**
 * DFA — Dependent Failure Analysis
 *
 * Loads all safety-independency requirements for the current parent
 * and provides a structured ARP4761/ISO-26262-style analysis form for each.
 * DFA analysis records are stored in the `dfa_analyses` table.
 */

import { sb }    from '../../config.js';
import { toast } from '../../toast.js';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── DFA template field definitions ──────────────────────────────────────────
// Each entry is rendered as a labelled input/textarea/select inside the accordion
const TEMPLATE = [
  {
    section: 'Elements',
    fields: [
      { key: 'element_a',    label: 'Element A',           type: 'text',     placeholder: 'First independent element / failure source' },
      { key: 'element_b',    label: 'Element B',           type: 'text',     placeholder: 'Second independent element / failure source' },
      { key: 'failure_scenario', label: 'Failure scenario', type: 'textarea', placeholder: 'Describe how both elements could fail simultaneously…' },
    ],
  },
  {
    section: 'Dependent Failure Classification',
    fields: [
      {
        key: 'df_type', label: 'Dependent failure type', type: 'select',
        options: [
          { value: '',    label: '— select —' },
          { value: 'ccf', label: 'Common Cause Failure (CCF) — same root cause triggers both' },
          { value: 'cmf', label: 'Common Mode Failure (CMF) — same failure mode in both' },
          { value: 'cascade', label: 'Cascading Failure — failure of A causes failure of B' },
        ],
      },
      {
        key: 'mechanisms', label: 'Failure mechanism categories (check all that apply)', type: 'checkgroup',
        options: [
          { value: 'emi',    label: 'Electromagnetic interference (EMI / EMC)' },
          { value: 'power',  label: 'Shared power supply / common voltage rail' },
          { value: 'ground', label: 'Common ground / shared return path' },
          { value: 'thermal',label: 'Thermal (heat, fire, coolant loss)' },
          { value: 'vibration', label: 'Vibration / shock' },
          { value: 'moisture', label: 'Moisture / corrosion / contamination' },
          { value: 'software', label: 'Software / firmware (common code, shared OS)' },
          { value: 'mfg',    label: 'Manufacturing / production defect (same batch)' },
          { value: 'maintenance', label: 'Maintenance error (same technician / procedure)' },
          { value: 'proximity', label: 'Physical proximity / shared mounting' },
        ],
      },
    ],
  },
  {
    section: 'Independence Means & Evidence',
    fields: [
      {
        key: 'independence_means', label: 'Independence means (check all that apply)', type: 'checkgroup',
        options: [
          { value: 'phys_sep',   label: 'Physical separation / routing segregation' },
          { value: 'elec_isol',  label: 'Electrical isolation (opto-coupler, transformer, relay)' },
          { value: 'sep_power',  label: 'Separate / independent power supplies' },
          { value: 'sep_ground', label: 'Separate ground paths' },
          { value: 'sw_partition', label: 'Software partitioning (MMU, hypervisor, time partitioning)' },
          { value: 'diff_supplier', label: 'Different supplier / design diversity' },
          { value: 'temp_monitor', label: 'Thermal monitoring / over-temperature protection' },
          { value: 'emi_shield',  label: 'EMC shielding / filtering' },
          { value: 'proc_sep',   label: 'Separate manufacturing / procurement process' },
        ],
      },
      { key: 'evidence',   label: 'Evidence of independence',  type: 'textarea', placeholder: 'Reference to drawings, test reports, analyses, standards compliance…' },
    ],
  },
  {
    section: 'Conclusion',
    fields: [
      { key: 'notes',          label: 'Additional notes / open points', type: 'textarea', placeholder: 'Any open actions, caveats, or assumptions…' },
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
          { value: '',                   label: '— select —' },
          { value: 'independent',        label: 'Independent — requirement satisfied' },
          { value: 'partially',          label: 'Partially independent — conditions apply' },
          { value: 'not_independent',    label: 'NOT independent — requirement NOT satisfied' },
          { value: 'not_applicable',     label: 'Not applicable' },
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
      <div class="dfa-body" id="dfa-body">
        <div class="dfa-loading">Loading…</div>
      </div>
    </div>`;

  const body = container.querySelector('#dfa-body');

  // Load independence requirements + existing analyses in parallel
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
    body.innerHTML = `
      <div class="dfa-empty">
        <div class="dfa-empty-icon">🔗</div>
        <div class="dfa-empty-title">No independence requirements yet</div>
        <div class="dfa-empty-sub">
          Independence requirements are automatically created when you add an AND gate in the FTA.<br>
          Each AND gate with ≥ 2 inputs generates one <em>safety-independency</em> requirement
          and a corresponding DFA entry here.
        </div>
      </div>`;
    return;
  }

  body.innerHTML = reqList.map(req => {
    const a = analysisByReqId[req.id] || {};
    const d = a.data || {};
    const conclusion = d.conclusion || '';
    const status     = d.status     || 'open';
    const riskColor  = CONCLUSION_COLOR[conclusion] || '#aaa';
    return buildCard(req, a, d, riskColor);
  }).join('');

  // Wire all save buttons and auto-save inputs
  body.querySelectorAll('.dfa-card').forEach(card => {
    const reqId  = card.dataset.reqId;
    const anaId  = card.dataset.anaId || null;
    wireCard(card, reqId, anaId, analysisByReqId, parentType, parentId, project.id);
  });

  // Wire accordion toggles
  body.querySelectorAll('.dfa-card-hdr').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('button, input, select, textarea, a')) return;
      const card = hdr.closest('.dfa-card');
      card.classList.toggle('dfa-card-collapsed');
    });
  });

  // Auto-expand and scroll to a requirement if navigated from the Requirements page
  const targetReqId = sessionStorage.getItem('dfa_target_req');
  if (targetReqId) {
    sessionStorage.removeItem('dfa_target_req');
    const targetCard = body.querySelector(`.dfa-card[data-req-id="${CSS.escape(targetReqId)}"]`);
    if (targetCard) {
      targetCard.classList.remove('dfa-card-collapsed');
      // Highlight briefly
      targetCard.style.transition = 'box-shadow 0.3s';
      targetCard.style.boxShadow = '0 0 0 3px #1A73E8, 0 2px 12px rgba(26,115,232,.25)';
      setTimeout(() => { targetCard.style.boxShadow = ''; }, 2000);
      requestAnimationFrame(() => targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
}

// ── Build card HTML ──────────────────────────────────────────────────────────
function buildCard(req, analysis, data, riskColor) {
  const statusBadge = {
    open:   '<span class="dfa-badge dfa-badge-open">Open</span>',
    closed: '<span class="dfa-badge dfa-badge-closed">Closed</span>',
    na:     '<span class="dfa-badge dfa-badge-na">N/A</span>',
  }[data.status || 'open'] || '';

  const conclusionText = {
    independent:     'Independent',
    partially:       'Partially independent',
    not_independent: 'NOT independent',
    not_applicable:  'N/A',
    '':              'Pending analysis',
  }[data.conclusion || ''] || 'Pending analysis';

  const sectionsHtml = TEMPLATE.map(section => `
    <div class="dfa-section">
      <div class="dfa-section-title">${esc(section.section)}</div>
      <div class="dfa-section-fields">
        ${section.fields.map(f => buildField(f, data)).join('')}
      </div>
    </div>`).join('');

  return `
    <div class="dfa-card dfa-card-collapsed" data-req-id="${esc(req.id)}" data-ana-id="${esc(analysis.id || '')}">
      <div class="dfa-card-hdr">
        <span class="dfa-card-code">${esc(req.req_code || '')}</span>
        <span class="dfa-card-title">${esc(req.title || '')}</span>
        <span class="dfa-card-conclusion" style="color:${riskColor}">${esc(conclusionText)}</span>
        ${statusBadge}
        <span class="dfa-card-toggle">▼</span>
      </div>
      <div class="dfa-card-body">
        <div class="dfa-req-desc">${esc(req.description || '')}</div>
        ${sectionsHtml}
        <div class="dfa-card-footer">
          <button class="btn btn-sm dfa-btn-save">💾 Save analysis</button>
          <span class="dfa-save-status"></span>
        </div>
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

// ── Wire card save ───────────────────────────────────────────────────────────
function wireCard(card, reqId, anaId, analysisByReqId, parentType, parentId, projectId) {
  const saveBtn  = card.querySelector('.dfa-btn-save');
  const statusEl = card.querySelector('.dfa-save-status');

  async function save() {
    const data = collectData(card);
    const conclusion = data.conclusion || '';
    const riskColor  = CONCLUSION_COLOR[conclusion] || '#aaa';

    // Update header badge + conclusion label immediately
    const conclusionEl = card.querySelector('.dfa-card-conclusion');
    if (conclusionEl) {
      conclusionEl.style.color = riskColor;
      conclusionEl.textContent = {
        independent: 'Independent', partially: 'Partially independent',
        not_independent: 'NOT independent', not_applicable: 'N/A', '': 'Pending analysis',
      }[conclusion] || 'Pending analysis';
    }

    const currentAnaId = card.dataset.anaId || '';
    if (currentAnaId) {
      const { error } = await sb.from('dfa_analyses')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', currentAnaId);
      if (error) { statusEl.textContent = '✗ Error saving'; statusEl.style.color = '#d93025'; return; }
    } else {
      const { data: inserted, error } = await sb.from('dfa_analyses').insert({
        requirement_id: reqId, req_code: card.querySelector('.dfa-card-code')?.textContent || '',
        project_id: projectId, parent_type: parentType, parent_id: parentId, data,
      }).select('id').single();
      if (error) { statusEl.textContent = '✗ Error saving'; statusEl.style.color = '#d93025'; return; }
      card.dataset.anaId = inserted.id;
      // Update analysisByReqId so other refreshes work
      analysisByReqId[reqId] = { id: inserted.id, data };
    }
    statusEl.textContent = '✓ Saved';
    statusEl.style.color = '#1E8E3E';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  }

  saveBtn.addEventListener('click', save);
}

function collectData(card) {
  const data = {};
  card.querySelectorAll('[data-key]').forEach(el => {
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
