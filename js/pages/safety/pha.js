/**
 * PHL / PHA — Preliminary Hazard List / Preliminary Hazard Analysis (ARP4761)
 * Linked to Use Cases; configurable fields per project via project_config.
 */
import { sb, effectivePHAFields, buildCode, nextIndex } from '../../config.js';
import { getFeaturesTree } from '../item-definition.js';
import { t } from '../../i18n/index.js';
import { confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';

export async function renderPHA(container, ctx) {
  const { project, item, system, parentType, parentId } = ctx;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Load project config + hazards + features tree in parallel
  const [
    { data: pcRows },
    { data: hazards },
    tree,
  ] = await Promise.all([
    sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle(),
    sb.from('hazards')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('sort_order'),
    getFeaturesTree(parentType, parentId, 'system'),
  ]);

  const projectConfig = pcRows || null;
  const fields = effectivePHAFields(projectConfig);
  const visibleFields = fields.filter(f => f.key !== 'use_case_id' && f.visible);

  // Build UC options list for selector
  const ucOptions = buildUCOptions(tree);

  const settingsPath = `/project/${project.id}/settings`;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>PHL / PHA</h1>
          <p class="page-subtitle">Preliminary Hazard List &amp; Analysis · ARP4761</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="btn-pha-settings" title="Configure visible fields">⚙ Configure</button>
          <button class="btn btn-primary" id="btn-add-hazard">＋ Add Hazard</button>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div id="pha-table-wrap">
        ${renderHazardTable(hazards || [], visibleFields, ucOptions)}
      </div>
      <div id="pha-form-wrap" style="display:none"></div>
    </div>
  `;

  // Wire settings button
  document.getElementById('btn-pha-settings').onclick = () => {
    window.location.hash = `#${settingsPath}`;
  };

  // Wire add hazard button
  document.getElementById('btn-add-hazard').onclick = () => {
    showHazardForm(container, null, { project, item, system, parentType, parentId, fields, ucOptions }, () => reload());
  };

  // Wire edit / delete on table rows
  wireTable(container, hazards || [], { project, item, system, parentType, parentId, fields, ucOptions }, () => reload());

  async function reload() {
    const { data: updated } = await sb.from('hazards')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('sort_order');
    document.getElementById('pha-table-wrap').innerHTML = renderHazardTable(updated || [], visibleFields, ucOptions);
    document.getElementById('pha-form-wrap').style.display = 'none';
    document.getElementById('pha-form-wrap').innerHTML = '';
    wireTable(container, updated || [], { project, item, system, parentType, parentId, fields, ucOptions }, () => reload());
  }
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderHazardTable(hazards, visibleFields, ucOptions) {
  if (!hazards.length) {
    return `<div class="empty-state" style="padding:40px 0">
      <div class="empty-state-icon">△</div>
      <h3>No hazards yet</h3>
      <p>Click "＋ Add Hazard" to record the first hazard or failure condition.</p>
    </div>`;
  }

  const ucMap = buildUCMap(ucOptions);

  return `
    <div class="pha-table-container">
      <table class="pha-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Use Case</th>
            ${visibleFields.map(f => `<th>${escHtml(f.label)}</th>`).join('')}
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${hazards.map(h => renderHazardRow(h, visibleFields, ucMap)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHazardRow(h, visibleFields, ucMap) {
  const d = h.data || {};
  const statusColors = { open: '#FF8B00', in_progress: '#0065FF', closed: '#00875A', 'n/a': '#6B778C' };
  const sc = statusColors[h.status] || '#6B778C';
  const ucLabel = h.use_case_id ? (ucMap[h.use_case_id] || h.use_case_id) : '—';

  return `
    <tr data-haz-id="${h.id}">
      <td><span class="pha-code">${escHtml(h.haz_code)}</span></td>
      <td class="pha-uc-cell">${escHtml(ucLabel)}</td>
      ${visibleFields.map(f => `<td>${renderFieldValue(f, d[f.key])}</td>`).join('')}
      <td><span class="pha-status-badge" style="background:${sc}20;color:${sc}">${escHtml(h.status)}</span></td>
      <td class="pha-actions-cell">
        <button class="btn-icon btn-edit-haz" data-id="${h.id}" title="Edit">✎</button>
        <button class="btn-icon btn-del-haz"  data-id="${h.id}" title="Delete">✕</button>
      </td>
    </tr>
  `;
}

function renderFieldValue(field, val) {
  if (!val || val === '—') return '<span style="color:var(--color-text-muted)">—</span>';
  if (field.type === 'badge_select' && field.colors && field.colors[val]) {
    const c = field.colors[val];
    return `<span class="pha-badge" style="background:${c}20;color:${c}">${escHtml(val)}</span>`;
  }
  return escHtml(String(val));
}

function wireTable(container, hazards, ctx, onReload) {
  const wrap = container.querySelector('#pha-table-wrap');
  if (!wrap) return;

  wrap.querySelectorAll('.btn-edit-haz').forEach(btn => {
    btn.onclick = () => {
      const h = hazards.find(x => x.id === btn.dataset.id);
      if (h) showHazardForm(container, h, ctx, onReload);
    };
  });

  wrap.querySelectorAll('.btn-del-haz').forEach(btn => {
    btn.onclick = () => {
      confirmDialog('Delete this hazard?', async () => {
        const { error } = await sb.from('hazards').delete().eq('id', btn.dataset.id);
        if (error) { toast(t('common.error'), 'error'); return; }
        toast('Hazard deleted.', 'success');
        onReload();
      });
    };
  });
}

// ── Add / Edit form ───────────────────────────────────────────────────────────

function showHazardForm(container, existing, ctx, onReload) {
  const { project, parentType, parentId, fields, ucOptions } = ctx;
  const d = existing?.data || {};

  const formWrap = container.querySelector('#pha-form-wrap');
  formWrap.style.display = 'block';
  formWrap.innerHTML = `
    <div class="pha-form-panel">
      <div class="pha-form-header">
        <h3>${existing ? 'Edit Hazard' : 'New Hazard'}</h3>
        <button class="btn-icon" id="btn-close-pha-form">✕</button>
      </div>
      <div class="pha-form-body">
        <div class="form-group">
          <label class="form-label">Use Case</label>
          <select class="form-input form-select" id="hf-uc">
            <option value="">— None —</option>
            ${ucOptions.map(g => `
              <optgroup label="${escHtml(g.featLabel)}">
                ${g.ucs.map(u => `<option value="${u.id}" ${existing?.use_case_id === u.id ? 'selected' : ''}>${escHtml(u.label)}</option>`).join('')}
              </optgroup>`).join('')}
          </select>
        </div>
        ${fields.filter(f => f.key !== 'use_case_id' && f.visible).map(f => renderFormField(f, d[f.key])).join('')}
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="hf-status">
            ${['open','in_progress','closed','n/a'].map(s => `<option value="${s}" ${(existing?.status||'open')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pha-form-footer">
        <button class="btn btn-secondary" id="btn-cancel-pha">Cancel</button>
        <button class="btn btn-primary"   id="btn-save-pha">${existing ? 'Save' : 'Add Hazard'}</button>
      </div>
    </div>
  `;

  formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('btn-close-pha-form').onclick = () => {
    formWrap.style.display = 'none';
    formWrap.innerHTML = '';
  };
  document.getElementById('btn-cancel-pha').onclick = () => {
    formWrap.style.display = 'none';
    formWrap.innerHTML = '';
  };

  document.getElementById('btn-save-pha').onclick = async () => {
    const btn = document.getElementById('btn-save-pha');
    btn.disabled = true;

    const ucId = document.getElementById('hf-uc').value || null;
    const status = document.getElementById('hf-status').value;
    const data = {};
    for (const f of fields) {
      if (f.key === 'use_case_id') continue;
      const el = document.getElementById(`hf-${f.key}`);
      if (el) data[f.key] = el.value || null;
    }

    let error;
    if (existing) {
      ({ error } = await sb.from('hazards').update({
        use_case_id: ucId, status, data, updated_at: new Date().toISOString(),
      }).eq('id', existing.id));
    } else {
      const idx = await nextIndex('hazards', { parent_id: parentId });
      const haz_code = buildCode('HAZ', { projectName: project.name, index: idx });
      ({ error } = await sb.from('hazards').insert({
        haz_code, project_id: project.id,
        parent_type: parentType, parent_id: parentId,
        use_case_id: ucId, status, data,
        sort_order: idx,
      }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    toast(existing ? 'Hazard updated.' : 'Hazard added.', 'success');
    onReload();
  };
}

function renderFormField(field, currentVal) {
  const id = `hf-${field.key}`;
  const val = currentVal || '';
  let input = '';

  if (field.type === 'textarea') {
    input = `<textarea class="form-input form-textarea" id="${id}" rows="2">${escHtml(val)}</textarea>`;
  } else if (field.type === 'select' || field.type === 'badge_select') {
    const opts = (field.options || []).map(o =>
      `<option value="${escHtml(o)}" ${val === o ? 'selected' : ''}>${escHtml(o)}</option>`
    ).join('');
    input = `<select class="form-input form-select" id="${id}">${opts}</select>`;
  } else {
    input = `<input class="form-input" id="${id}" value="${escHtml(val)}"/>`;
  }

  return `<div class="form-group">
    <label class="form-label">${escHtml(field.label)}${field.required ? ' *' : ''}</label>
    ${input}
  </div>`;
}

// ── UC helpers ────────────────────────────────────────────────────────────────

function buildUCOptions(tree) {
  return (tree || []).map(feat => ({
    featLabel: `${feat.feat_code} · ${feat.name}`,
    ucs: (feat.use_cases || []).map(uc => ({
      id: uc.id,
      label: `${uc.uc_code} · ${uc.name}`,
    })),
  })).filter(g => g.ucs.length > 0);
}

function buildUCMap(ucOptions) {
  const map = {};
  ucOptions.forEach(g => g.ucs.forEach(u => { map[u.id] = u.label; }));
  return map;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
