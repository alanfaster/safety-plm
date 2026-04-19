/**
 * PHL / PHA — Preliminary Hazard List / Analysis (ARP4761)
 *
 * Tree layout: Feature ▶ Use Case ▶ Hazard
 * "+ Add Hazard" on a UC row inserts an inline editable row directly in the tree.
 * Edit mode turns an existing hazard row into inline editable fields.
 */
import { sb, effectivePHAFields, buildCode, nextIndex } from '../../config.js';
import { getFeaturesTree, ICONS } from '../item-definition.js';
import { t } from '../../i18n/index.js';
import { confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';
import { navigate } from '../../router.js';

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderPHA(container, ctx) {
  const { project, item, system, parentType, parentId } = ctx;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Load project config + hazards + feature/UC tree in parallel
  const [{ data: pcRow }, { data: hazards }, rawTree] = await Promise.all([
    sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle(),
    sb.from('hazards')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order'),
    loadTree(parentType, parentId),
  ]);

  const fields     = effectivePHAFields(pcRow || null);
  const allHazards = hazards || [];

  const scope = {
    container, project, item, system,
    parentType, parentId,
    fields, tree: rawTree, allHazards,
  };

  paint(scope);
}

// ── Load feature tree ─────────────────────────────────────────────────────────
// Strict single-level query: item-level data and system-level data are independent
// and must never be mixed. Queries exactly the level this safety page belongs to.

async function loadTree(parentType, parentId) {
  // No domain filter — features may be stored under any domain value depending
  // on which item-definition URL was used. Level (item vs system) is enforced
  // by parentType/parentId; domains within the same level are always included.
  return getFeaturesTree(parentType, parentId);
}

// ── Full paint ────────────────────────────────────────────────────────────────

function paint(scope) {
  const { container, project, fields, tree, allHazards } = scope;

  const hazByUC   = buildHazMap(allHazards);
  const sevField  = fields.find(f => f.key === 'severity');
  const settingsPath = `/project/${project.id}/settings`;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>PHL / PHA</h1>
          <p class="page-subtitle">Preliminary Hazard Analysis · ARP4761</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="btn-pha-cfg">⚙ Configure fields</button>
          <button class="btn btn-primary btn-sm"   id="btn-add-free-haz">＋ Add hazard (no UC)</button>
        </div>
      </div>
      ${allHazards.length ? summaryBar(allHazards, sevField) : ''}
    </div>
    <div class="page-body pha-body" id="pha-body">
      ${tree.length === 0
        ? noFeaturesHint(project, scope)
        : tree.map(feat => featSection(feat, hazByUC, scope)).join('')
      }
      ${orphanSection(hazByUC['__none__'] || [], scope)}
    </div>
  `;

  document.getElementById('btn-pha-cfg').onclick = () => navigate(settingsPath);

  document.getElementById('btn-add-free-haz').onclick = () => {
    const anchor = container.querySelector('#pha-free-anchor');
    if (anchor) openAddRow(anchor, null, scope);
  };

  wireRows(container, scope, hazByUC);
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function buildHazMap(hazards) {
  const m = {};
  hazards.forEach(h => {
    const key = h.use_case_id || '__none__';
    (m[key] = m[key] || []).push(h);
  });
  return m;
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function summaryBar(hazards, sevField) {
  if (!sevField?.colors) return '';
  const counts = {};
  hazards.forEach(h => {
    const s = h.data?.severity;
    if (s && s !== '—') counts[s] = (counts[s] || 0) + 1;
  });
  const pills = Object.entries(counts)
    .map(([s, n]) => {
      const c = sevField.colors[s] || '#6B778C';
      return `<span class="pha-sbar-pill" style="background:${c}20;color:${c}">${esc(s)} <b>${n}</b></span>`;
    }).join('');
  return pills ? `<div class="pha-sbar">${pills}</div>` : '';
}

// ── Feature section ───────────────────────────────────────────────────────────

function featSection(feat, hazByUC, scope) {
  const ucs = feat.use_cases || [];
  const totalHaz = ucs.reduce((s, uc) => s + (hazByUC[uc.id]?.length || 0), 0);
  const desc = feat.description ? `: <span class="pha-ctx-desc">${esc(feat.description)}</span>` : '';

  return `
    <div class="pha-feat">
      <div class="pha-feat-hdr">
        <span class="pha-feat-icon">${ICONS.feat}</span>
        <span class="pha-mono">${esc(feat.feat_code)}</span>
        <span class="pha-feat-name"><strong>${esc(feat.name)}</strong>${desc}</span>
        ${totalHaz ? `<span class="pha-cnt">${totalHaz} △</span>` : ''}
      </div>
      ${ucs.length === 0
        ? `<div class="pha-empty-row">No use cases for this feature yet.</div>`
        : ucs.map(uc => ucRow(uc, hazByUC[uc.id] || [], scope)).join('')
      }
    </div>`;
}

// ── UC row ────────────────────────────────────────────────────────────────────

function ucRow(uc, ucHazards, scope) {
  const sevField = scope.fields.find(f => f.key === 'severity');
  const mini = ucHazards.map(h => {
    const s = h.data?.severity;
    if (!s || s === '—' || !sevField?.colors) return '';
    const c = sevField.colors[s] || '#6B778C';
    return `<span class="pha-mini-badge" style="background:${c}20;color:${c}" title="${esc(h.haz_code)}: ${esc(s)}">${esc(s.split(' ')[0])}</span>`;
  }).join('');

  return `
    <div class="pha-uc-wrap" data-uc-id="${uc.id}">
      <div class="pha-uc-hdr">
        <span class="pha-uc-indent">├</span>
        <span class="pha-uc-icon">${ICONS.uc}</span>
        <span class="pha-mono pha-uc-code">${esc(uc.uc_code)}</span>
        <span class="pha-uc-name"><strong>${esc(uc.name)}</strong>${uc.description ? `: <span class="pha-ctx-desc">${esc(uc.description)}</span>` : ''}</span>
        <span class="pha-spacer"></span>
        ${mini}
        <button class="btn-ghost btn-sm btn-add-uc-haz"
          data-uc-id="${uc.id}" data-uc-code="${esc(uc.uc_code)}" data-uc-name="${esc(uc.name)}">
          ＋ Add hazard
        </button>
      </div>
      ${ucHazards.map(h => hazRow(h, scope)).join('')}
      <div class="pha-add-row-anchor" id="pha-anchor-${uc.id}"></div>
    </div>`;
}

// ── Hazard row ────────────────────────────────────────────────────────────────

function hazRow(h, scope) {
  const d = h.data || {};
  const sevField  = scope.fields.find(f => f.key === 'severity');
  const sev = d.severity && d.severity !== '—' ? d.severity : null;
  const sevColor  = sev && sevField?.colors ? (sevField.colors[sev] || '#6B778C') : null;
  const sc = { open:'#FF8B00', in_progress:'#0065FF', closed:'#00875A', 'n/a':'#97A0AF' }[h.status] || '#97A0AF';

  const nameStr = d.hazard_name ? `<strong>${esc(d.hazard_name)}</strong>` : '';
  const descStr = d.hazard_desc ? `<span class="pha-ctx-desc">${esc(d.hazard_desc)}</span>` : '';
  const nameDesc = nameStr && descStr ? `${nameStr}: ${descStr}` : nameStr || descStr || '<span style="color:var(--color-text-subtle)">—</span>';

  return `
    <div class="pha-haz-row" data-haz-id="${h.id}">
      <span class="pha-haz-tree-indent">│  └</span>
      <span class="pha-haz-icon">△</span>
      <span class="pha-mono pha-haz-code">${esc(h.haz_code)}</span>
      ${sevColor ? `<span class="pha-badge" style="background:${sevColor}20;color:${sevColor}">${esc(sev)}</span>` : ''}
      <span class="pha-haz-desc">${nameDesc}</span>
      ${d.phase_of_op && d.phase_of_op !== '—' ? `<span class="pha-meta">${esc(d.phase_of_op)}</span>` : ''}
      <span class="pha-spacer"></span>
      <span class="pha-status-chip" style="background:${sc}20;color:${sc}">${esc(h.status)}</span>
      <button class="btn-icon btn-edit-haz" data-id="${h.id}">✎</button>
      <button class="btn-icon btn-del-haz"  data-id="${h.id}">✕</button>
    </div>
    ${d.mitigation ? `
      <div class="pha-haz-mit-row">
        <span class="pha-haz-mit-indent">│     </span>
        <span class="pha-mit-label">↳ Mitigation:</span>
        <span class="pha-mit-text">${esc(d.mitigation)}</span>
      </div>` : ''}
    <div class="pha-add-row-anchor" id="pha-edit-anchor-${h.id}"></div>`;
}

// ── Orphan section ────────────────────────────────────────────────────────────

function orphanSection(orphans, scope) {
  return `
    <div class="pha-feat">
      <div class="pha-feat-hdr">
        <span class="pha-feat-icon">△</span>
        <span class="pha-feat-name" style="color:var(--color-text-muted)">Hazards without Use Case</span>
        ${orphans.length ? `<span class="pha-cnt">${orphans.length} △</span>` : ''}
      </div>
      ${orphans.length === 0
        ? `<div class="pha-empty-row">None yet. Use "＋ Add hazard (no UC)" above.</div>`
        : orphans.map(h => hazRow(h, scope)).join('')
      }
      <div class="pha-add-row-anchor" id="pha-free-anchor"></div>
    </div>`;
}

// ── No features hint ──────────────────────────────────────────────────────────

function noFeaturesHint(project, scope) {
  const { item, system } = scope;
  const defPath = system
    ? `/project/${project.id}/item/${item.id}/system/${system.id}/domain/system/vcycle/item_definition`
    : `/project/${project.id}/item/${item.id}/domain/system/vcycle/item_definition`;
  return `
    <div class="pha-empty-state">
      <div class="pha-empty-icon">⊙</div>
      <h3>No features found</h3>
      <p>No Features or Use Cases are defined at this level. Please check the
         <strong>Item / System Definition</strong> page and make sure Features and
         Use Cases are defined for this ${system ? 'system' : 'item'}.</p>
      <button class="btn btn-primary" onclick="window.location.hash='${defPath}'">
        Go to Item / System Definition →
      </button>
    </div>`;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireRows(container, scope, hazByUC) {
  // "+ Add hazard" on each UC
  container.querySelectorAll('.btn-add-uc-haz').forEach(btn => {
    btn.onclick = () => {
      const anchor = container.querySelector(`#pha-anchor-${btn.dataset.ucId}`);
      if (anchor) openAddRow(anchor, btn.dataset.ucId, scope, btn);
    };
  });

  // Edit hazard
  container.querySelectorAll('.btn-edit-haz').forEach(btn => {
    btn.onclick = () => {
      const haz    = scope.allHazards.find(h => h.id === btn.dataset.id);
      const anchor = container.querySelector(`#pha-edit-anchor-${haz.id}`);
      if (haz && anchor) openEditRow(anchor, haz, scope);
    };
  });

  // Delete hazard
  container.querySelectorAll('.btn-del-haz').forEach(btn => {
    btn.onclick = () => {
      const haz = scope.allHazards.find(h => h.id === btn.dataset.id);
      confirmDialog(`Delete ${haz?.haz_code || 'this hazard'}?`, async () => {
        const { error } = await sb.from('hazards').delete().eq('id', btn.dataset.id);
        if (error) { toast('Error deleting hazard.', 'error'); return; }
        toast('Hazard deleted.', 'success');
        await reload(scope);
      });
    };
  });
}

// ── Inline add row ────────────────────────────────────────────────────────────

function openAddRow(anchor, ucId, scope, triggerBtn) {
  // Toggle: if this anchor already has a row open, close it
  if (anchor.firstChild) {
    anchor.innerHTML = '';
    if (triggerBtn) triggerBtn.textContent = '＋ Add hazard';
    return;
  }

  // Close any other open inline rows
  scope.container.querySelectorAll('.pha-inline-row').forEach(el => el.remove());
  scope.container.querySelectorAll('.btn-add-uc-haz').forEach(b => b.textContent = '＋ Add hazard');

  if (triggerBtn) triggerBtn.textContent = '✕ Cancel';

  const row = document.createElement('div');
  row.className = 'pha-inline-row';
  row.innerHTML = inlineRowHTML(null, ucId, scope);
  anchor.appendChild(row);

  row.querySelector('.pha-ir-cancel').onclick = () => {
    row.remove();
    if (triggerBtn) triggerBtn.textContent = '＋ Add hazard';
  };

  row.querySelector('.pha-ir-save').onclick = () => saveRow(row, null, ucId, scope, () => {
    if (triggerBtn) triggerBtn.textContent = '＋ Add hazard';
  });

  // Enter on any single-line input saves
  row.querySelectorAll('input, select').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); row.querySelector('.pha-ir-save').click(); }
      if (e.key === 'Escape') { e.preventDefault(); row.querySelector('.pha-ir-cancel').click(); }
    };
  });

  // Focus first input
  const first = row.querySelector('input, textarea');
  if (first) first.focus();
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function openEditRow(anchor, haz, scope) {
  if (anchor.firstChild) { anchor.innerHTML = ''; return; }

  scope.container.querySelectorAll('.pha-inline-row').forEach(el => el.remove());
  scope.container.querySelectorAll('.btn-add-uc-haz').forEach(b => b.textContent = '＋ Add hazard');

  const row = document.createElement('div');
  row.className = 'pha-inline-row pha-inline-row--edit';
  row.innerHTML = inlineRowHTML(haz, haz.use_case_id, scope);
  anchor.appendChild(row);

  row.querySelector('.pha-ir-cancel').onclick = () => row.remove();
  row.querySelector('.pha-ir-save').onclick   = () => saveRow(row, haz, haz.use_case_id, scope);

  row.querySelectorAll('input, select').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); row.querySelector('.pha-ir-save').click(); }
      if (e.key === 'Escape') { e.preventDefault(); row.querySelector('.pha-ir-cancel').click(); }
    };
  });

  const first = row.querySelector('input, textarea');
  if (first) { first.focus(); first.select(); }
}

// ── Inline row HTML ───────────────────────────────────────────────────────────

function inlineRowHTML(haz, ucId, scope) {
  const d   = haz?.data || {};
  const fld = (key) => scope.fields.find(f => f.key === key);

  const hazNameF  = fld('hazard_name');
  const hazDescF  = fld('hazard_desc');
  const sevF      = fld('severity');
  const phaseF    = fld('phase_of_op');
  const dalF      = fld('dal');
  const mitF      = fld('mitigation');
  const statusVal = haz?.status || 'open';

  return `
    <div class="pha-ir-tree">│  └</div>
    <div class="pha-ir-body">
      <div class="pha-ir-row1">
        ${hazNameF ? `
          <div class="pha-ir-field pha-ir-name">
            <label>Hazard Name *</label>
            <input id="ir-hazard_name" class="form-input" value="${esc(d.hazard_name || '')}"
              placeholder="Short name for this hazard..."/>
          </div>` : ''}
        ${sevF ? `
          <div class="pha-ir-field pha-ir-narrow">
            <label>Severity</label>
            <select id="ir-severity" class="form-input form-select">
              ${(sevF.options || []).map(o => `<option value="${esc(o)}" ${(d.severity||'—')===o?'selected':''}>${esc(o)}</option>`).join('')}
            </select>
          </div>` : ''}
        ${dalF ? `
          <div class="pha-ir-field pha-ir-narrow">
            <label>DAL</label>
            <select id="ir-dal" class="form-input form-select">
              ${(dalF.options || []).map(o => `<option value="${esc(o)}" ${(d.dal||'—')===o?'selected':''}>${esc(o)}</option>`).join('')}
            </select>
          </div>` : ''}
        ${phaseF ? `
          <div class="pha-ir-field pha-ir-narrow">
            <label>Phase</label>
            <select id="ir-phase_of_op" class="form-input form-select">
              ${(phaseF.options || []).map(o => `<option value="${esc(o)}" ${(d.phase_of_op||'—')===o?'selected':''}>${esc(o)}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="pha-ir-field pha-ir-narrow">
          <label>Status</label>
          <select id="ir-status" class="form-input form-select">
            ${['open','in_progress','closed','n/a'].map(s => `<option value="${s}" ${statusVal===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      ${hazDescF ? `
        <div class="pha-ir-row2">
          <div class="pha-ir-field pha-ir-full">
            <label>Hazard Description *</label>
            <textarea id="ir-hazard_desc" class="form-input form-textarea ir-textarea" rows="2"
              placeholder="Describe the hazard condition in detail...">${esc(d.hazard_desc || '')}</textarea>
          </div>
        </div>` : ''}
      ${mitF ? `
        <div class="pha-ir-row2">
          <div class="pha-ir-field pha-ir-full">
            <label>Mitigation / Action</label>
            <input id="ir-mitigation" class="form-input" value="${esc(d.mitigation || '')}"
              placeholder="Mitigation or corrective action..."/>
          </div>
        </div>` : ''}
      <div class="pha-ir-actions">
        <button class="btn btn-secondary btn-sm pha-ir-cancel">Cancel</button>
        <button class="btn btn-primary   btn-sm pha-ir-save">${haz ? 'Save changes' : '＋ Add hazard'}</button>
      </div>
    </div>`;
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveRow(row, existing, ucId, scope, onDone) {
  const saveBtn = row.querySelector('.pha-ir-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '...';

  const get = id => row.querySelector(`#ir-${id}`)?.value ?? null;

  const status = get('status') || 'open';
  const data   = {};
  // Collect all field values that have an element in the row
  for (const f of scope.fields) {
    if (f.key === 'use_case_id') continue;
    const el = row.querySelector(`#ir-${f.key}`);
    if (el) data[f.key] = el.value || null;
  }

  // Validate required fields
  if (!data.hazard_name?.trim()) {
    const el = row.querySelector('#ir-hazard_name');
    if (el) { el.focus(); el.style.borderColor = 'var(--color-error)'; }
    saveBtn.disabled = false;
    saveBtn.textContent = existing ? 'Save changes' : '＋ Add hazard';
    return;
  }
  if (!data.hazard_desc?.trim()) {
    const el = row.querySelector('#ir-hazard_desc');
    if (el) { el.focus(); el.style.borderColor = 'var(--color-error)'; }
    saveBtn.disabled = false;
    saveBtn.textContent = existing ? 'Save changes' : '＋ Add hazard';
    return;
  }

  let error;
  if (existing) {
    ({ error } = await sb.from('hazards').update({
      use_case_id: ucId || null,
      status,
      data,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id));
  } else {
    // Count existing hazards for this parent to generate index
    const { count } = await sb
      .from('hazards')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', scope.parentType)
      .eq('parent_id', scope.parentId);

    const idx      = (count || 0) + 1;
    const haz_code = buildCode('HAZ', { projectName: scope.project.name, index: idx });

    ({ error } = await sb.from('hazards').insert({
      haz_code,
      project_id:  scope.project.id,
      parent_type: scope.parentType,
      parent_id:   scope.parentId,
      use_case_id: ucId || null,
      status,
      data,
      sort_order: idx,
    }));
  }

  if (error) {
    console.error('Hazard save error:', error);
    toast(`Error: ${error.message || 'Could not save hazard.'}`, 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = existing ? 'Save changes' : '＋ Add hazard';
    return;
  }

  toast(existing ? 'Hazard updated.' : 'Hazard added.', 'success');
  if (onDone) onDone();
  await reload(scope);
}

// ── Reload ────────────────────────────────────────────────────────────────────

async function reload(scope) {
  const [{ data: hazards }, newTree] = await Promise.all([
    sb.from('hazards')
      .select('*').eq('parent_type', scope.parentType).eq('parent_id', scope.parentId)
      .order('sort_order'),
    loadTree(scope.parentType, scope.parentId, scope.item),
  ]);
  scope.allHazards = hazards || [];
  scope.tree       = newTree;
  paint(scope);
}

// ── Util ──────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
