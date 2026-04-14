/**
 * PHL / PHA — Preliminary Hazard List / Analysis (ARP4761)
 *
 * Layout: structured Feature → Use Case breakdown.
 * Each UC shows its hazards inline; "+ Add" opens an inline form per UC.
 * Hazards not linked to any UC appear in a separate section at the bottom.
 */
import { sb, effectivePHAFields, buildCode, nextIndex } from '../../config.js';
import { getFeaturesTree } from '../item-definition.js';
import { ICONS } from '../item-definition.js';
import { t } from '../../i18n/index.js';
import { confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';
import { navigate } from '../../router.js';

// ── Public entry point ────────────────────────────────────────────────────────

export async function renderPHA(container, ctx) {
  const { project, item, system, parentType, parentId } = ctx;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Determine domain: for item-level, features live under domain='system';
  // for system-level, they also live under domain='system'.
  const domain = 'system';

  // Parallel load: project config, hazards, feature/UC tree
  const [
    { data: pcRow },
    { data: hazards },
    tree,
  ] = await Promise.all([
    sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle(),
    sb.from('hazards')
      .select('*')
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('sort_order'),
    getFeaturesTree(parentType, parentId, domain),
  ]);

  const fields       = effectivePHAFields(pcRow || null);
  const allHazards   = hazards || [];
  const settingsPath = `/project/${project.id}/settings`;

  // Scope for inline re-renders
  const scope = { container, project, item, system, parentType, parentId, fields, tree, allHazards };

  renderPage(scope, settingsPath);
}

// ── Full page render ──────────────────────────────────────────────────────────

function renderPage(scope, settingsPath) {
  const { container, project, fields, tree, allHazards } = scope;

  // Index hazards by use_case_id
  const hazsByUC  = {};
  const hazOrphan = [];
  allHazards.forEach(h => {
    if (h.use_case_id) {
      (hazsByUC[h.use_case_id] = hazsByUC[h.use_case_id] || []).push(h);
    } else {
      hazOrphan.push(h);
    }
  });

  const totalHaz = allHazards.length;
  const defTitle = scope.system ? scope.system.name : (scope.item?.name || 'Item');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>PHL / PHA</h1>
          <p class="page-subtitle">Preliminary Hazard Analysis · ARP4761 · ${escHtml(defTitle)}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="btn-pha-settings" title="Configure PHA fields">⚙ Configure</button>
          <button class="btn btn-primary" id="btn-add-orphan-haz">＋ Add Hazard</button>
        </div>
      </div>
      ${totalHaz > 0 ? renderSummaryBar(allHazards, fields) : ''}
    </div>
    <div class="page-body pha-body" id="pha-body">
      ${tree.length === 0
        ? renderNoFeaturesHint(project, scope)
        : tree.map(feat => renderFeatureSection(feat, hazsByUC, fields, scope)).join('')
      }
      ${renderOrphanSection(hazOrphan, fields, scope)}
    </div>
  `;

  document.getElementById('btn-pha-settings').onclick = () => navigate(`#${settingsPath}`);
  document.getElementById('btn-add-orphan-haz').onclick = () => {
    const orphanWrap = container.querySelector('#pha-orphan-form');
    if (orphanWrap) toggleInlineForm(orphanWrap, null, null, scope);
  };

  wireSection(container, scope);
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function renderSummaryBar(hazards, fields) {
  const sevField = fields.find(f => f.key === 'severity');
  if (!sevField?.colors) return '';
  const counts = {};
  hazards.forEach(h => {
    const sev = h.data?.severity;
    if (sev && sev !== '—') counts[sev] = (counts[sev] || 0) + 1;
  });
  const pills = Object.entries(counts).map(([sev, n]) => {
    const c = sevField.colors[sev] || '#6B778C';
    return `<span class="pha-summary-pill" style="background:${c}20;color:${c}">${escHtml(sev)} <strong>${n}</strong></span>`;
  }).join('');
  return pills ? `<div class="pha-summary-bar">${pills}</div>` : '';
}

// ── Feature section ───────────────────────────────────────────────────────────

function renderFeatureSection(feat, hazsByUC, fields, scope) {
  const ucRows  = feat.use_cases || [];
  const featHazCount = ucRows.reduce((s, uc) => s + (hazsByUC[uc.id]?.length || 0), 0);

  return `
    <div class="pha-feat-section" data-feat-id="${feat.id}">
      <div class="pha-feat-header">
        <span class="pha-feat-icon">${ICONS.feat}</span>
        <span class="pha-feat-code">${escHtml(feat.feat_code)}</span>
        <span class="pha-feat-name">${escHtml(feat.name)}</span>
        ${featHazCount > 0
          ? `<span class="pha-haz-count" title="${featHazCount} hazard(s)">${featHazCount} △</span>`
          : ''}
      </div>
      <div class="pha-feat-body">
        ${ucRows.length === 0
          ? `<div class="pha-no-uc">No use cases defined for this feature yet.</div>`
          : ucRows.map(uc => renderUCRow(uc, hazsByUC[uc.id] || [], fields, scope)).join('')
        }
      </div>
    </div>
  `;
}

// ── UC row ────────────────────────────────────────────────────────────────────

function renderUCRow(uc, ucHazards, fields, scope) {
  return `
    <div class="pha-uc-row" data-uc-id="${uc.id}">
      <div class="pha-uc-header">
        <span class="pha-uc-icon">${ICONS.uc}</span>
        <span class="pha-uc-code">${escHtml(uc.uc_code)}</span>
        <span class="pha-uc-name">${escHtml(uc.name)}</span>
        <span class="pha-uc-spacer"></span>
        ${ucHazards.map(h => renderMiniSeverityBadge(h, fields)).join('')}
        <button class="btn btn-ghost btn-sm btn-add-uc-haz" data-uc-id="${uc.id}" data-uc-label="${escHtml(uc.uc_code + ' · ' + uc.name)}">
          ＋ Add Hazard
        </button>
      </div>
      ${ucHazards.map(h => renderHazardRow(h, fields, scope)).join('')}
      <div class="pha-inline-form" id="pha-form-uc-${uc.id}" style="display:none"></div>
    </div>
  `;
}

function renderMiniSeverityBadge(haz, fields) {
  const sevField = fields.find(f => f.key === 'severity');
  const sev = haz.data?.severity;
  if (!sev || sev === '—' || !sevField?.colors) return '';
  const c = sevField.colors[sev] || '#6B778C';
  return `<span class="pha-mini-badge" style="background:${c}20;color:${c}" title="${escHtml(haz.haz_code + ': ' + sev)}">${escHtml(sev.split(' ')[0])}</span>`;
}

// ── Hazard row ────────────────────────────────────────────────────────────────

function renderHazardRow(h, fields, scope) {
  const d = h.data || {};
  const sevField = fields.find(f => f.key === 'severity');
  const sev = d.severity && d.severity !== '—' ? d.severity : null;
  const sevColor = sev && sevField?.colors ? (sevField.colors[sev] || '#6B778C') : '#6B778C';

  const hazDesc = d.hazard_desc || '—';
  const phase   = d.phase_of_op && d.phase_of_op !== '—' ? d.phase_of_op : null;
  const mit     = d.mitigation || null;

  const statusColors = { open: '#FF8B00', in_progress: '#0065FF', closed: '#00875A', 'n/a': '#97A0AF' };
  const sc = statusColors[h.status] || '#97A0AF';

  return `
    <div class="pha-haz-row" data-haz-id="${h.id}">
      <div class="pha-haz-main">
        <span class="pha-code">${escHtml(h.haz_code)}</span>
        ${sev ? `<span class="pha-badge" style="background:${sevColor}20;color:${sevColor}">${escHtml(sev)}</span>` : ''}
        <span class="pha-haz-desc">${escHtml(hazDesc)}</span>
        ${phase ? `<span class="pha-haz-meta">${escHtml(phase)}</span>` : ''}
      </div>
      ${mit ? `<div class="pha-haz-mit">↳ ${escHtml(mit)}</div>` : ''}
      <div class="pha-haz-actions">
        <span class="pha-status-badge" style="background:${sc}20;color:${sc}">${escHtml(h.status)}</span>
        <button class="btn-icon btn-edit-haz" data-id="${h.id}" title="Edit">✎</button>
        <button class="btn-icon btn-del-haz"  data-id="${h.id}" title="Delete">✕</button>
      </div>
      <div class="pha-inline-form" id="pha-edit-${h.id}" style="display:none"></div>
    </div>
  `;
}

// ── Orphan section (hazards without UC) ───────────────────────────────────────

function renderOrphanSection(orphans, fields, scope) {
  return `
    <div class="pha-feat-section pha-orphan-section" id="pha-orphan-section">
      <div class="pha-feat-header">
        <span class="pha-feat-icon">△</span>
        <span class="pha-feat-name">Hazards (no Use Case)</span>
        ${orphans.length > 0 ? `<span class="pha-haz-count">${orphans.length} △</span>` : ''}
      </div>
      <div class="pha-feat-body" id="pha-orphan-rows">
        ${orphans.length === 0
          ? `<div class="pha-no-uc">No standalone hazards. Use "＋ Add Hazard" to add one not linked to a UC.</div>`
          : orphans.map(h => renderHazardRow(h, fields, scope)).join('')}
        <div class="pha-inline-form" id="pha-orphan-form" style="display:none"></div>
      </div>
    </div>
  `;
}

// ── No features hint ──────────────────────────────────────────────────────────

function renderNoFeaturesHint(project, scope) {
  const { item, system, parentType, parentId } = scope;
  // Build link back to item definition
  const defPath = system
    ? `/project/${project.id}/item/${item.id}/system/${system.id}/domain/system/vcycle/item_definition`
    : `/project/${project.id}/item/${item.id}/domain/system/vcycle/item_definition`;

  return `
    <div class="pha-no-features">
      <div class="pha-no-features-icon">⊙</div>
      <h3>No Features or Use Cases defined yet</h3>
      <p>
        PHL/PHA links hazards to Use Cases. Start by defining Features and Use Cases
        in the <strong>System Definition</strong> page, then come back here to record hazards.
      </p>
      <a class="btn btn-primary" href="#${defPath}">Go to System Definition →</a>
    </div>
  `;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireSection(container, scope) {
  // "+ Add Hazard" buttons on UC rows
  container.querySelectorAll('.btn-add-uc-haz').forEach(btn => {
    btn.onclick = () => {
      const ucId    = btn.dataset.ucId;
      const ucLabel = btn.dataset.ucLabel;
      const formDiv = container.querySelector(`#pha-form-uc-${ucId}`);
      if (formDiv) toggleInlineForm(formDiv, ucId, ucLabel, scope);
    };
  });

  // Edit hazard buttons
  container.querySelectorAll('.btn-edit-haz').forEach(btn => {
    btn.onclick = () => {
      const haz = scope.allHazards.find(h => h.id === btn.dataset.id);
      if (!haz) return;
      const formDiv = container.querySelector(`#pha-edit-${haz.id}`);
      if (formDiv) toggleInlineForm(formDiv, haz.use_case_id || null, null, scope, haz);
    };
  });

  // Delete hazard buttons
  container.querySelectorAll('.btn-del-haz').forEach(btn => {
    btn.onclick = () => {
      const haz = scope.allHazards.find(h => h.id === btn.dataset.id);
      const label = haz?.haz_code || 'this hazard';
      confirmDialog(`Delete ${label}?`, async () => {
        const { error } = await sb.from('hazards').delete().eq('id', btn.dataset.id);
        if (error) { toast(t('common.error'), 'error'); return; }
        toast('Hazard deleted.', 'success');
        await reloadPHA(scope);
      });
    };
  });
}

// ── Inline form ───────────────────────────────────────────────────────────────

function toggleInlineForm(formDiv, ucId, ucLabel, scope, existing) {
  // If already open, close it
  if (formDiv.style.display !== 'none') {
    formDiv.style.display = 'none';
    formDiv.innerHTML = '';
    return;
  }

  // Close any other open form
  scope.container.querySelectorAll('.pha-inline-form').forEach(el => {
    el.style.display = 'none';
    el.innerHTML = '';
  });

  const { fields } = scope;
  const d = existing?.data || {};
  const visFields = fields.filter(f => f.key !== 'use_case_id' && f.visible);

  formDiv.style.display = 'block';
  formDiv.innerHTML = `
    <div class="pha-inline-form-inner">
      ${ucLabel ? `<div class="pha-form-uc-label">${ICONS.uc} ${escHtml(ucLabel)}</div>` : ''}
      <div class="pha-form-grid">
        ${visFields.map(f => renderFormField(f, d[f.key])).join('')}
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="hf-status">
            ${['open','in_progress','closed','n/a'].map(s =>
              `<option value="${s}" ${(existing?.status||'open')===s?'selected':''}>${s}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="pha-form-footer">
        <button class="btn btn-secondary btn-sm" id="hf-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm"   id="hf-save">${existing ? 'Save changes' : '+ Add Hazard'}</button>
      </div>
    </div>
  `;

  // Focus first visible field
  const firstInput = formDiv.querySelector('input, textarea, select');
  if (firstInput) firstInput.focus();

  formDiv.querySelector('#hf-cancel').onclick = () => {
    formDiv.style.display = 'none';
    formDiv.innerHTML = '';
  };

  formDiv.querySelector('#hf-save').onclick = async () => {
    const btn = formDiv.querySelector('#hf-save');
    btn.disabled = true;

    const status = formDiv.querySelector('#hf-status').value;
    const data   = {};
    for (const f of fields) {
      if (f.key === 'use_case_id') continue;
      const el = formDiv.querySelector(`#hf-${f.key}`);
      if (el) data[f.key] = el.value || null;
    }

    let error;
    if (existing) {
      ({ error } = await sb.from('hazards').update({
        use_case_id: ucId || null,
        status, data,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id));
    } else {
      const idx      = await nextIndex('hazards', { parent_id: scope.parentId });
      const haz_code = buildCode('HAZ', { projectName: scope.project.name, index: idx });
      ({ error } = await sb.from('hazards').insert({
        haz_code,
        project_id:  scope.project.id,
        parent_type: scope.parentType,
        parent_id:   scope.parentId,
        use_case_id: ucId || null,
        status, data,
        sort_order: idx,
      }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    toast(existing ? 'Hazard updated.' : 'Hazard added.', 'success');
    await reloadPHA(scope);
  };
}

// ── Form field renderer ───────────────────────────────────────────────────────

function renderFormField(field, currentVal) {
  const id  = `hf-${field.key}`;
  const val = currentVal || '';
  let input = '';

  if (field.type === 'textarea') {
    input = `<textarea class="form-input form-textarea" id="${id}" rows="2" placeholder="${escHtml(field.label)}">${escHtml(val)}</textarea>`;
  } else if (field.type === 'select' || field.type === 'badge_select') {
    const opts = (field.options || []).map(o =>
      `<option value="${escHtml(o)}" ${val === o ? 'selected' : ''}>${escHtml(o)}</option>`
    ).join('');
    input = `<select class="form-input form-select" id="${id}">${opts}</select>`;
  } else {
    input = `<input class="form-input" id="${id}" value="${escHtml(val)}" placeholder="${escHtml(field.label)}"/>`;
  }

  return `<div class="form-group">
    <label class="form-label">${escHtml(field.label)}${field.required ? ' <span style="color:var(--color-error)">*</span>' : ''}</label>
    ${input}
  </div>`;
}

// ── Reload ────────────────────────────────────────────────────────────────────

async function reloadPHA(scope) {
  const [{ data: hazards }, tree] = await Promise.all([
    sb.from('hazards')
      .select('*')
      .eq('parent_type', scope.parentType)
      .eq('parent_id', scope.parentId)
      .order('sort_order'),
    getFeaturesTree(scope.parentType, scope.parentId, 'system'),
  ]);
  scope.allHazards = hazards || [];
  scope.tree = tree;
  const settingsPath = `/project/${scope.project.id}/settings`;
  renderPage(scope, settingsPath);
}

// ── Util ──────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
