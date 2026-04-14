/**
 * Generic safety page for:
 * - FSC (Functional Safety Concept)
 * - TSC (Technical Safety Concept)
 * - FTA (Fault Tree Analysis)
 * - FHA (Functional Hazard Assessment - aerospace)
 * - PHL_PHA (Preliminary Hazard List / Analysis)
 */
import { sb } from '../../config.js';
import { t } from '../../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';

// Column definitions per analysis type
const SCHEMAS = {
  FHA: [
    { key: 'function',          label: () => t('fha.function'),          type: 'text', required: true },
    { key: 'failure_condition', label: () => t('fha.failure_condition'),  type: 'text' },
    { key: 'phase',             label: () => t('fha.phase'),              type: 'text' },
    { key: 'effects',           label: () => t('fha.effects'),            type: 'textarea' },
    { key: 'classification',    label: () => t('fha.classification'),     type: 'select',
      options: ['—','Catastrophic','Hazardous','Major','Minor','No Safety Effect'] },
    { key: 'dal',               label: () => t('fha.dal'),                type: 'select',
      options: ['—','DAL-A','DAL-B','DAL-C','DAL-D','DAL-E'] },
    { key: 'verification',      label: () => t('fha.verification'),       type: 'text' },
  ],
  PHL_PHA: [
    { key: 'hazard',       label: () => t('phl_pha.hazard'),       type: 'text', required: true },
    { key: 'cause',        label: () => t('phl_pha.cause'),        type: 'text' },
    { key: 'effect',       label: () => t('phl_pha.effect'),       type: 'textarea' },
    { key: 'risk_before',  label: () => t('phl_pha.risk_before'),  type: 'select',
      options: ['—','Negligible','Low','Medium','High','Critical'] },
    { key: 'mitigation',   label: () => t('phl_pha.mitigation'),   type: 'textarea' },
    { key: 'risk_after',   label: () => t('phl_pha.risk_after'),   type: 'select',
      options: ['—','Negligible','Low','Medium','High','Critical'] },
    { key: 'status',       label: () => t('phl_pha.status'),       type: 'select',
      options: ['open','in_progress','closed'] },
  ],
};

const DOCUMENT_TYPES = ['FSC', 'TSC'];
const FTA_TYPE = 'FTA';
const TABLE_TYPES = ['FHA', 'PHL_PHA'];

export async function renderSafetyGeneric(container, { project, item, system, parentType, parentId, analysisType }) {
  const parentName = system?.name || item?.name;
  const label = t(`safety.${analysisType}`);

  if (TABLE_TYPES.includes(analysisType)) {
    await renderTableAnalysis(container, { project, item, system, parentType, parentId, analysisType, label, parentName });
  } else if (DOCUMENT_TYPES.includes(analysisType)) {
    await renderDocumentAnalysis(container, { project, parentType, parentId, analysisType, label, parentName });
  } else if (analysisType === FTA_TYPE) {
    await renderFta(container, { project, parentType, parentId, label, parentName });
  }
}

// ── TABLE-BASED ANALYSES (FHA, PHL_PHA) ──────────────────────────────

async function renderTableAnalysis(container, { project, parentType, parentId, analysisType, label, parentName }) {
  const schema = SCHEMAS[analysisType];

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${label}</h1>
          <p class="text-muted">${parentName}</p>
        </div>
        <button class="btn btn-primary" id="btn-new-row">＋ ${t('safety.new_row')}</button>
      </div>
    </div>
    <div class="page-body" id="analysis-body">
      <div class="content-loading"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('btn-new-row').onclick = () =>
    openRowModal({ project, parentType, parentId, analysisType, schema });

  await loadTableRows(project, parentType, parentId, analysisType, schema);
}

async function getOrCreateAnalysis(project, parentType, parentId, analysisType) {
  let { data } = await sb.from('safety_analyses')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .eq('analysis_type', analysisType)
    .maybeSingle();

  if (!data) {
    const { data: created } = await sb.from('safety_analyses').insert({
      analysis_code: `SAF-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      parent_type: parentType, parent_id: parentId,
      project_id: project.id, analysis_type: analysisType, title: analysisType,
    }).select().single();
    data = created;
  }
  return data;
}

async function loadTableRows(project, parentType, parentId, analysisType, schema) {
  const analysis = await getOrCreateAnalysis(project, parentType, parentId, analysisType);
  const { data: rows, error } = await sb.from('safety_analysis_rows')
    .select('*').eq('analysis_id', analysis.id).order('row_order');

  const body = document.getElementById('analysis-body');
  if (error || !rows) { body.innerHTML = `<p>${t('common.error')}</p>`; return; }

  if (!rows.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛡</div><h3>No rows yet</h3><p>Add the first row to this ${analysisType} analysis.</p></div>`;
    return;
  }

  body.innerHTML = `
    <div class="card"><div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>#</th>
          ${schema.map(col => `<th>${col.label()}</th>`).join('')}
          <th>${t('common.actions')}</th>
        </tr></thead>
        <tbody>
          ${rows.map((row, i) => `
            <tr>
              <td class="code-cell">${i+1}</td>
              ${schema.map(col => `<td>${escHtml(row.data?.[col.key] || '—')}</td>`).join('')}
              <td class="actions-cell">
                <button class="btn btn-ghost btn-sm btn-edit" data-id="${row.id}">Edit</button>
                <button class="btn btn-ghost btn-sm btn-del"  data-id="${row.id}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div></div>
  `;

  body.querySelectorAll('.btn-edit').forEach(btn => {
    const row = rows.find(r => r.id === btn.dataset.id);
    btn.onclick = () => openRowModal({ project, parentType, parentId, analysisType, schema, existing: row });
  });
  body.querySelectorAll('.btn-del').forEach(btn => {
    btn.onclick = () => confirmDialog('Delete this row?', async () => {
      await sb.from('safety_analysis_rows').delete().eq('id', btn.dataset.id);
      await loadTableRows(project, parentType, parentId, analysisType, schema);
      toast('Row deleted.', 'success');
    });
  });
}

function openRowModal({ project, parentType, parentId, analysisType, schema, existing }) {
  const isEdit = !!existing;
  const d = existing?.data || {};

  showModal({
    title: isEdit ? `Edit ${analysisType} Row` : `New ${analysisType} Row`,
    large: true,
    body: `
      <div class="form-grid cols-1">
        ${schema.map(col => `
          <div class="form-group">
            <label class="form-label">${col.label()}${col.required ? ' *' : ''}</label>
            ${col.type === 'select' ? `
              <select class="form-input form-select" id="col-${col.key}">
                ${col.options.map(o => `<option value="${o}" ${d[col.key]===o?'selected':''}>${o}</option>`).join('')}
              </select>
            ` : col.type === 'textarea' ? `
              <textarea class="form-input form-textarea" id="col-${col.key}" rows="2">${escHtml(d[col.key]||'')}</textarea>
            ` : `
              <input class="form-input" id="col-${col.key}" value="${escHtml(d[col.key]||'')}"/>
            `}
          </div>
        `).join('')}
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${t('common.save')}</button>
    `
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const firstRequired = schema.find(c => c.required);
    if (firstRequired && !document.getElementById(`col-${firstRequired.key}`).value.trim()) return;

    const data = {};
    schema.forEach(col => {
      data[col.key] = document.getElementById(`col-${col.key}`).value.trim();
    });

    const btn = document.getElementById('m-save');
    btn.disabled = true;

    let error;
    if (isEdit) {
      ({ error } = await sb.from('safety_analysis_rows').update({ data }).eq('id', existing.id));
    } else {
      const analysis = await getOrCreateAnalysis(project, parentType, parentId, analysisType);
      const { count } = await sb.from('safety_analysis_rows').select('id', { count: 'exact', head: true }).eq('analysis_id', analysis.id);
      ({ error } = await sb.from('safety_analysis_rows').insert({ analysis_id: analysis.id, row_order: count || 0, data }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    hideModal();
    toast('Row saved.', 'success');
    await loadTableRows(project, parentType, parentId, analysisType, SCHEMAS[analysisType]);
  };
}

// ── DOCUMENT-BASED ANALYSES (FSC, TSC) ────────────────────────────────

async function renderDocumentAnalysis(container, { project, parentType, parentId, analysisType, label, parentName }) {
  const analysis = await getOrCreateAnalysis(project, parentType, parentId, analysisType);
  const content = analysis?.content || {};

  const hints = {
    FSC: 'The Functional Safety Concept defines the functional safety requirements and their allocation derived from the safety goals identified in the HARA.',
    TSC: 'The Technical Safety Concept defines the technical safety requirements and their allocation to system elements, derived from the FSC.',
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${label}</h1>
          <p class="text-muted">${parentName}</p>
        </div>
        <button class="btn btn-primary" id="btn-save-doc">💾 ${t('common.save')}</button>
      </div>
    </div>
    <div class="page-body">
      <div class="card" style="background:var(--color-info-bg);border-color:var(--color-primary-light)">
        <div class="card-body" style="color:var(--color-primary);font-size:var(--text-sm)">ℹ️ ${hints[analysisType]}</div>
      </div>
      <div class="card mt-4">
        <div class="card-body">
          <textarea class="form-input form-textarea" id="doc-text" rows="24"
            style="font-family:var(--font-mono);font-size:13px;resize:vertical"
            placeholder="Enter ${label} content...">${escHtml(content.text || '')}</textarea>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-save-doc').onclick = async () => {
    const text = document.getElementById('doc-text').value;
    const { error } = await sb.from('safety_analyses')
      .update({ content: { text }, updated_at: new Date().toISOString() })
      .eq('id', analysis.id);
    if (error) { toast(t('common.error'), 'error'); return; }
    toast(`${label} saved.`, 'success');
  };
}

// ── FTA (Fault Tree Analysis) ─────────────────────────────────────────

async function renderFta(container, { project, parentType, parentId, label, parentName }) {
  const analysis = await getOrCreateAnalysis(project, parentType, parentId, 'FTA');
  const content = analysis?.content || {};

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>FTA <span style="font-weight:400;font-size:16px;color:var(--color-text-muted)">Fault Tree Analysis</span></h1>
          <p class="text-muted">${parentName}</p>
        </div>
        <button class="btn btn-primary" id="btn-save-fta">💾 ${t('common.save')}</button>
      </div>
      <div class="page-tabs">
        <button class="page-tab active" data-tab="diagram">Diagram</button>
        <button class="page-tab" data-tab="text">Textual / Import</button>
      </div>
    </div>
    <div class="page-body">
      <div id="fta-diagram-tab">
        <div class="diagram-area">
          <div class="diagram-area-icon">🌳</div>
          <p style="font-weight:600">FTA Diagram Editor</p>
          <p class="text-muted" style="font-size:13px;max-width:400px;text-align:center">
            Interactive fault tree diagram coming in next version.<br/>
            Uses a gate-based notation (AND/OR/INHIBIT) with cut-set calculation.
          </p>
          <button class="btn btn-secondary mt-4" style="margin-top:16px"
            onclick="document.querySelector('[data-tab=text]').click()">
            ↓ Use Textual Description for now
          </button>
        </div>
      </div>
      <div id="fta-text-tab" style="display:none">
        <div class="card">
          <div class="card-body">
            <textarea class="form-input form-textarea" id="fta-text" rows="20"
              style="font-family:var(--font-mono);font-size:13px"
              placeholder="Describe the fault tree structure or paste import data...">${escHtml(content.text||'')}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('.page-tab').forEach(tab => {
    tab.onclick = () => {
      container.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('fta-diagram-tab').style.display = tab.dataset.tab === 'diagram' ? '' : 'none';
      document.getElementById('fta-text-tab').style.display    = tab.dataset.tab === 'text' ? '' : 'none';
    };
  });

  document.getElementById('btn-save-fta').onclick = async () => {
    const text = document.getElementById('fta-text').value;
    const { error } = await sb.from('safety_analyses')
      .update({ content: { text }, updated_at: new Date().toISOString() })
      .eq('id', analysis.id);
    if (error) { toast(t('common.error'), 'error'); return; }
    toast('FTA saved.', 'success');
  };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
