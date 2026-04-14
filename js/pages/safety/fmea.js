/**
 * FMEA — Failure Mode and Effects Analysis
 * Used across automotive, aerospace, and military project types.
 */
import { sb } from '../../config.js';
import { t } from '../../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';

export async function renderFmea(container, { project, item, system, parentType, parentId }) {
  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>FMEA <span style="font-weight:400;font-size:16px;color:var(--color-text-muted)">Failure Mode and Effects Analysis</span></h1>
          <p class="text-muted">${parentName}</p>
        </div>
        <button class="btn btn-primary" id="btn-new-fmea">＋ ${t('safety.new_row')}</button>
      </div>
    </div>
    <div class="page-body" id="fmea-body">
      <div class="content-loading"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('btn-new-fmea').onclick = () =>
    openFmeaModal({ project, parentType, parentId });

  await loadFmea(project, parentType, parentId);
}

async function getOrCreateAnalysis(project, parentType, parentId) {
  let { data } = await sb.from('safety_analyses')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .eq('analysis_type', 'FMEA')
    .maybeSingle();

  if (!data) {
    const { data: created } = await sb.from('safety_analyses').insert({
      analysis_code: `SAF-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      parent_type: parentType,
      parent_id: parentId,
      project_id: project.id,
      analysis_type: 'FMEA',
      title: 'FMEA',
    }).select().single();
    data = created;
  }
  return data;
}

async function loadFmea(project, parentType, parentId) {
  const analysis = await getOrCreateAnalysis(project, parentType, parentId);
  if (!analysis) return;

  const { data: rows, error } = await sb.from('safety_analysis_rows')
    .select('*')
    .eq('analysis_id', analysis.id)
    .order('row_order', { ascending: true });

  const body = document.getElementById('fmea-body');
  if (error) { body.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  if (!rows.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <h3>No FMEA rows yet</h3>
        <p>Add failure modes to analyze their effects and calculate Risk Priority Numbers.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${t('fmea.function')}</th>
              <th>${t('fmea.failure_mode')}</th>
              <th>${t('fmea.effect')}</th>
              <th>${t('fmea.severity')}</th>
              <th>${t('fmea.cause')}</th>
              <th>${t('fmea.occurrence')}</th>
              <th>${t('fmea.controls')}</th>
              <th>${t('fmea.detection')}</th>
              <th>${t('fmea.rpn')}</th>
              <th>${t('fmea.actions')}</th>
              <th>${t('fmea.responsible')}</th>
              <th>${t('fmea.status')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => fmeaRow(row, i + 1)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  body.querySelectorAll('.btn-edit-row').forEach(btn => {
    const row = rows.find(r => r.id === btn.dataset.id);
    btn.onclick = () => openFmeaModal({ project, parentType, parentId, existing: row, analysisId: analysis.id });
  });

  body.querySelectorAll('.btn-del-row').forEach(btn => {
    btn.onclick = () => confirmDialog('Delete this FMEA row?', async () => {
      await sb.from('safety_analysis_rows').delete().eq('id', btn.dataset.id);
      await loadFmea(project, parentType, parentId);
      toast('Row deleted.', 'success');
    });
  });
}

function rpnColor(rpn) {
  if (rpn >= 200) return 'color:var(--color-error);font-weight:700';
  if (rpn >= 100) return 'color:var(--color-warning);font-weight:700';
  return '';
}

function fmeaRow(row, idx) {
  const d = row.data || {};
  const rpn = (parseInt(d.severity)||0) * (parseInt(d.occurrence)||0) * (parseInt(d.detection)||0);
  const statusBadge = d.status === 'closed'
    ? 'badge-approved' : d.status === 'in_progress' ? 'badge-review' : 'badge-draft';
  return `
    <tr>
      <td class="code-cell">${idx}</td>
      <td>${escHtml(d.function || '')}</td>
      <td><strong>${escHtml(d.failure_mode || '')}</strong></td>
      <td>${escHtml(d.effect || '')}</td>
      <td style="text-align:center"><strong>${d.severity || '—'}</strong></td>
      <td>${escHtml(d.cause || '')}</td>
      <td style="text-align:center">${d.occurrence || '—'}</td>
      <td>${escHtml(d.controls || '')}</td>
      <td style="text-align:center">${d.detection || '—'}</td>
      <td style="text-align:center;${rpn ? rpnColor(rpn) : ''}">${rpn || '—'}</td>
      <td>${escHtml(d.actions || '')}</td>
      <td>${escHtml(d.responsible || '')}</td>
      <td><span class="badge ${statusBadge}">${d.status || 'open'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-edit-row" data-id="${row.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-del-row"  data-id="${row.id}">✕</button>
      </td>
    </tr>
  `;
}

function openFmeaModal({ project, parentType, parentId, existing }) {
  const isEdit = !!existing;
  const d = existing?.data || {};

  showModal({
    title: isEdit ? 'Edit FMEA Row' : 'New FMEA Row',
    large: true,
    body: `
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">${t('fmea.function')} *</label>
          <input class="form-input" id="f-function" value="${escHtml(d.function||'')}" placeholder="e.g. Apply braking force"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.failure_mode')} *</label>
          <input class="form-input" id="f-mode" value="${escHtml(d.failure_mode||'')}" placeholder="e.g. No braking force applied"/>
        </div>
        <div class="form-group full">
          <label class="form-label">${t('fmea.effect')}</label>
          <input class="form-input" id="f-effect" value="${escHtml(d.effect||'')}" placeholder="Effect on system/end user"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.cause')}</label>
          <input class="form-input" id="f-cause" value="${escHtml(d.cause||'')}" placeholder="Root cause of failure mode"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.controls')}</label>
          <input class="form-input" id="f-controls" value="${escHtml(d.controls||'')}" placeholder="Existing prevention/detection controls"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.severity')} (1–10)</label>
          <input class="form-input" id="f-s" type="number" min="1" max="10" value="${d.severity||''}"/>
          <span class="form-hint">1=No effect · 10=Hazardous without warning</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.occurrence')} (1–10)</label>
          <input class="form-input" id="f-o" type="number" min="1" max="10" value="${d.occurrence||''}"/>
          <span class="form-hint">1=Almost impossible · 10=Almost certain</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.detection')} (1–10)</label>
          <input class="form-input" id="f-d" type="number" min="1" max="10" value="${d.detection||''}"/>
          <span class="form-hint">1=Always detected · 10=Cannot be detected</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.rpn')} (auto)</label>
          <input class="form-input" id="f-rpn" readonly value="${(d.severity||0)*(d.occurrence||0)*(d.detection||0)||''}" placeholder="S × O × D"/>
        </div>
        <div class="form-group full">
          <label class="form-label">${t('fmea.actions')}</label>
          <textarea class="form-input form-textarea" id="f-actions" rows="2">${escHtml(d.actions||'')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.responsible')}</label>
          <input class="form-input" id="f-resp" value="${escHtml(d.responsible||'')}"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('fmea.status')}</label>
          <select class="form-input form-select" id="f-status">
            ${['open','in_progress','closed'].map(v=>`<option value="${v}" ${d.status===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${t('common.save')}</button>
    `
  });

  // Auto RPN
  ['f-s','f-o','f-d'].forEach(id => {
    document.getElementById(id).oninput = () => {
      const s = parseInt(document.getElementById('f-s').value)||0;
      const o = parseInt(document.getElementById('f-o').value)||0;
      const d = parseInt(document.getElementById('f-d').value)||0;
      document.getElementById('f-rpn').value = s*o*d || '';
    };
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const fn = document.getElementById('f-function').value.trim();
    const fm = document.getElementById('f-mode').value.trim();
    if (!fn || !fm) return;

    const s = parseInt(document.getElementById('f-s').value)||0;
    const o = parseInt(document.getElementById('f-o').value)||0;
    const det = parseInt(document.getElementById('f-d').value)||0;

    const data = {
      function: fn,
      failure_mode: fm,
      effect:      document.getElementById('f-effect').value.trim(),
      cause:       document.getElementById('f-cause').value.trim(),
      controls:    document.getElementById('f-controls').value.trim(),
      severity:    s, occurrence: o, detection: det,
      rpn:         s * o * det,
      actions:     document.getElementById('f-actions').value.trim(),
      responsible: document.getElementById('f-resp').value.trim(),
      status:      document.getElementById('f-status').value,
    };

    const btn = document.getElementById('m-save');
    btn.disabled = true;

    let error;
    if (isEdit) {
      ({ error } = await sb.from('safety_analysis_rows').update({ data, updated_at: new Date().toISOString() }).eq('id', existing.id));
    } else {
      const analysis = await getOrCreateAnalysis(project, parentType, parentId);
      const { count } = await sb.from('safety_analysis_rows').select('id', { count: 'exact', head: true }).eq('analysis_id', analysis.id);
      ({ error } = await sb.from('safety_analysis_rows').insert({ analysis_id: analysis.id, row_order: count || 0, data }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    hideModal();
    toast('FMEA row saved.', 'success');
    await loadFmea(project, parentType, parentId);
  };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
