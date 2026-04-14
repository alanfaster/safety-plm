/**
 * HARA — Hazard Analysis and Risk Assessment (ISO 26262)
 */
import { sb } from '../../config.js';
import { t } from '../../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';

const SEVERITY_OPTS      = ['S0','S1','S2','S3'];
const EXPOSURE_OPTS      = ['E0','E1','E2','E3','E4'];
const CONTROLLABILITY_OPTS = ['C0','C1','C2','C3'];
const ASIL_OPTS          = ['QM','ASIL-A','ASIL-B','ASIL-C','ASIL-D'];

/** ASIL determination table [S][E][C] = ASIL */
const ASIL_TABLE = {
  S1: { E1:{ C1:'QM',C2:'QM',C3:'QM' }, E2:{ C1:'QM',C2:'QM',C3:'QM' }, E3:{ C1:'QM',C2:'QM',C3:'A'  }, E4:{ C1:'QM',C2:'A', C3:'B'  } },
  S2: { E1:{ C1:'QM',C2:'QM',C3:'QM' }, E2:{ C1:'QM',C2:'QM',C3:'A'  }, E3:{ C1:'QM',C2:'A', C3:'B'  }, E4:{ C1:'A', C2:'B', C3:'C'  } },
  S3: { E1:{ C1:'QM',C2:'QM',C3:'A'  }, E2:{ C1:'QM',C2:'A', C3:'B'  }, E3:{ C1:'A', C2:'B', C3:'C'  }, E4:{ C1:'B', C2:'C', C3:'D'  } },
};

function calcAsil(s, e, c) {
  return ASIL_TABLE[s]?.[e]?.[c] ?? '—';
}

export async function renderHara(container, { project, item, system, parentType, parentId }) {
  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>HARA <span style="font-weight:400;font-size:16px;color:var(--color-text-muted)">Hazard Analysis and Risk Assessment</span></h1>
          <p class="text-muted">${parentName} · ISO 26262</p>
        </div>
        <div class="flex gap-2 items-center">
          <button class="btn btn-primary" id="btn-new-hara">＋ ${t('safety.new_row')}</button>
        </div>
      </div>
    </div>
    <div class="page-body" id="hara-body">
      <div class="content-loading"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('btn-new-hara').onclick = () =>
    openHaraModal({ project, parentType, parentId });

  await loadHara(project, parentType, parentId);
}

async function getOrCreateAnalysis(project, parentType, parentId) {
  let { data } = await sb.from('safety_analyses')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .eq('analysis_type', 'HARA')
    .maybeSingle();

  if (!data) {
    const { data: created } = await sb.from('safety_analyses').insert({
      analysis_code: `SAF-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      parent_type: parentType,
      parent_id: parentId,
      project_id: project.id,
      analysis_type: 'HARA',
      title: 'HARA',
    }).select().single();
    data = created;
  }
  return data;
}

async function loadHara(project, parentType, parentId) {
  const analysis = await getOrCreateAnalysis(project, parentType, parentId);
  if (!analysis) return;

  const { data: rows, error } = await sb.from('safety_analysis_rows')
    .select('*')
    .eq('analysis_id', analysis.id)
    .order('row_order', { ascending: true });

  const body = document.getElementById('hara-body');
  if (error) { body.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  if (!rows.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛡</div>
        <h3>No HARA rows yet</h3>
        <p>Identify hazards and operational situations to determine ASIL levels.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table" id="hara-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${t('hara.hazard')}</th>
              <th>${t('hara.op_situation')}</th>
              <th>${t('hara.hazardous_event')}</th>
              <th>${t('hara.severity')}</th>
              <th>${t('hara.exposure')}</th>
              <th>${t('hara.controllability')}</th>
              <th>${t('hara.asil')}</th>
              <th>${t('hara.safety_goal')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => haraRow(row, i + 1)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  body.querySelectorAll('.btn-edit-row').forEach(btn => {
    const row = rows.find(r => r.id === btn.dataset.id);
    btn.onclick = () => openHaraModal({ project, parentType, parentId, existing: row, analysisId: analysis.id });
  });

  body.querySelectorAll('.btn-del-row').forEach(btn => {
    btn.onclick = () => confirmDialog('Delete this HARA row?', async () => {
      await sb.from('safety_analysis_rows').delete().eq('id', btn.dataset.id);
      await loadHara(project, parentType, parentId);
      toast('Row deleted.', 'success');
    });
  });
}

function haraRow(row, idx) {
  const d = row.data || {};
  const asil = d.asil || calcAsil(d.severity, d.exposure, d.controllability);
  const asilClass = asil.replace('ASIL-','').replace('QM','QM');
  return `
    <tr>
      <td class="code-cell">${idx}</td>
      <td>${escHtml(d.hazard || '')}</td>
      <td>${escHtml(d.op_situation || '')}</td>
      <td>${escHtml(d.hazardous_event || '')}</td>
      <td><span class="asil-badge asil-${d.severity?.slice(1)}">${d.severity || '—'}</span></td>
      <td>${d.exposure || '—'}</td>
      <td>${d.controllability || '—'}</td>
      <td><span class="asil-badge asil-${asilClass}">${asil}</span></td>
      <td>${escHtml(d.safety_goal || '')}</td>
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-edit-row" data-id="${row.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-del-row"  data-id="${row.id}">✕</button>
      </td>
    </tr>
  `;
}

function openHaraModal({ project, parentType, parentId, existing, analysisId }) {
  const isEdit = !!existing;
  const d = existing?.data || {};

  showModal({
    title: isEdit ? 'Edit HARA Row' : 'New HARA Row',
    large: true,
    body: `
      <div class="form-grid cols-1">
        <div class="form-group">
          <label class="form-label">${t('hara.hazard')} *</label>
          <input class="form-input" id="h-hazard" value="${escHtml(d.hazard||'')}" placeholder="e.g. Loss of braking"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('hara.op_situation')}</label>
          <input class="form-input" id="h-op" value="${escHtml(d.op_situation||'')}" placeholder="e.g. Highway driving at >120 km/h"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('hara.hazardous_event')}</label>
          <input class="form-input" id="h-event" value="${escHtml(d.hazardous_event||'')}" placeholder="e.g. Vehicle cannot stop when brakes applied"/>
        </div>
      </div>
      <div class="form-grid" style="margin-top:12px">
        <div class="form-group">
          <label class="form-label">${t('hara.severity')}</label>
          <select class="form-input form-select" id="h-s">
            <option value="">—</option>
            ${SEVERITY_OPTS.map(v=>`<option value="${v}" ${d.severity===v?'selected':''}>${v}</option>`).join('')}
          </select>
          <span class="form-hint">S0=No injuries · S1=Light · S2=Serious · S3=Life-threatening</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('hara.exposure')}</label>
          <select class="form-input form-select" id="h-e">
            <option value="">—</option>
            ${EXPOSURE_OPTS.map(v=>`<option value="${v}" ${d.exposure===v?'selected':''}>${v}</option>`).join('')}
          </select>
          <span class="form-hint">E0=Incredible · E1=Very low · E2=Low · E3=Medium · E4=High</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('hara.controllability')}</label>
          <select class="form-input form-select" id="h-c">
            <option value="">—</option>
            ${CONTROLLABILITY_OPTS.map(v=>`<option value="${v}" ${d.controllability===v?'selected':''}>${v}</option>`).join('')}
          </select>
          <span class="form-hint">C0=Controllable · C1=Simply · C2=Normally · C3=Difficult</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('hara.asil')} (auto-calculated)</label>
          <input class="form-input" id="h-asil" value="${escHtml(d.asil||'')}" placeholder="Auto from S/E/C"/>
        </div>
      </div>
      <div class="form-grid cols-1" style="margin-top:12px">
        <div class="form-group">
          <label class="form-label">${t('hara.safety_goal')}</label>
          <textarea class="form-input form-textarea" id="h-sg" rows="2">${escHtml(d.safety_goal||'')}</textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${t('common.save')}</button>
    `
  });

  // Auto-calculate ASIL when S/E/C change
  ['h-s','h-e','h-c'].forEach(id => {
    document.getElementById(id).onchange = () => {
      const s = document.getElementById('h-s').value;
      const e = document.getElementById('h-e').value;
      const c = document.getElementById('h-c').value;
      if (s && e && c) document.getElementById('h-asil').value = calcAsil(s, e, c);
    };
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const hazard = document.getElementById('h-hazard').value.trim();
    if (!hazard) { document.getElementById('h-hazard').focus(); return; }

    const data = {
      hazard,
      op_situation:    document.getElementById('h-op').value.trim(),
      hazardous_event: document.getElementById('h-event').value.trim(),
      severity:        document.getElementById('h-s').value,
      exposure:        document.getElementById('h-e').value,
      controllability: document.getElementById('h-c').value,
      asil:            document.getElementById('h-asil').value,
      safety_goal:     document.getElementById('h-sg').value.trim(),
    };

    const btn = document.getElementById('m-save');
    btn.disabled = true;

    let error;
    if (isEdit) {
      ({ error } = await sb.from('safety_analysis_rows').update({ data, updated_at: new Date().toISOString() }).eq('id', existing.id));
    } else {
      // Ensure analysis exists
      const analysis = await getOrCreateAnalysis({ id: project.id }, parentType, parentId);
      const count = await sb.from('safety_analysis_rows').select('id', { count: 'exact', head: true }).eq('analysis_id', analysis.id);
      ({ error } = await sb.from('safety_analysis_rows').insert({
        analysis_id: analysis.id,
        row_order: (count.count || 0),
        data,
      }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    hideModal();
    toast('HARA row saved.', 'success');

    await loadHara(project, parentType, parentId);
  };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
