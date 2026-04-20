/**
 * FHA — Functional Hazard Assessment (ARP4761)
 *
 * Tree layout: Feature ▶ Use Case ▶ Function ▶ FHA Entry
 * "+ Add FHA" on a Function row opens an inline form.
 * If the function has a type with HAZOP failure conditions defined,
 * a HAZOP panel shows checkboxes for bulk FHA entry generation.
 */
import { sb, effectiveFHAFields, buildCode } from '../../config.js';
import { getFeaturesTree, ICONS } from '../item-definition.js';
import { t } from '../../i18n/index.js';
import { confirmDialog } from '../../components/modal.js';
import { toast } from '../../toast.js';
import { navigate } from '../../router.js';
import { exportFHApdf } from '../../utils/export-pdf.js';

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderFHA(container, ctx) {
  const { project, item, system, parentType, parentId } = ctx;

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  const [{ data: pcRow }, { data: hazards }, rawTree] = await Promise.all([
    sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle(),
    sb.from('hazards')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('analysis_type', 'FHA')
      .order('sort_order'),
    loadTree(parentType, parentId),
  ]);

  const fields      = effectiveFHAFields(pcRow || null);
  const allHazards  = hazards || [];
  const funcTypes   = pcRow?.config?.function_types || [];

  const scope = {
    container, project, item, system,
    parentType, parentId,
    fields, tree: rawTree, allHazards, funcTypes,
  };

  paint(scope);
}

// ── Load tree ─────────────────────────────────────────────────────────────────
// Strict single-level query: item-level data and system-level data are independent
// and must never be mixed. Queries exactly the level this safety page belongs to.

async function loadTree(parentType, parentId) {
  return getFeaturesTree(parentType, parentId);
}

// ── Full paint ────────────────────────────────────────────────────────────────

function paint(scope) {
  const { container, project, fields, tree, allHazards } = scope;
  const hazByFun   = buildHazMap(allHazards);
  const clsField   = fields.find(f => f.key === 'classification');
  const settingsPath = `/project/${project.id}/settings`;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>FHA</h1>
          <p class="page-subtitle">Functional Hazard Assessment · ARP4761</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="btn-fha-pdf" title="Export to PDF">📄 PDF</button>
          <button class="btn btn-secondary btn-sm" id="btn-fha-cfg">⚙ Configure</button>
        </div>
      </div>
      ${allHazards.length ? summaryBar(allHazards, clsField) : ''}
    </div>
    <div class="page-body pha-body" id="fha-body">
      ${tree.length === 0
        ? noFunctionsHint(project, scope)
        : tree.map(feat => featSection(feat, hazByFun, scope)).join('')
      }
    </div>
  `;

  container.querySelector('#btn-fha-cfg').onclick = () => navigate(settingsPath);
  const _pdfTitle = `${project.name}${(scope.item?.name || scope.system?.name) ? ' — ' + (scope.item?.name || scope.system?.name) : ''}`;
  container.querySelector('#btn-fha-pdf').onclick = () => exportFHApdf(container, _pdfTitle);
  wireRows(container, scope, hazByFun);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildHazMap(hazards) {
  const m = {};
  hazards.forEach(h => {
    const key = h.function_id || '__none__';
    (m[key] = m[key] || []).push(h);
  });
  return m;
}

function summaryBar(hazards, clsField) {
  if (!clsField?.colors) return '';
  const counts = {};
  hazards.forEach(h => {
    const s = h.data?.classification;
    if (s && s !== '—') counts[s] = (counts[s] || 0) + 1;
  });
  const pills = Object.entries(counts)
    .map(([s, n]) => {
      const c = clsField.colors[s] || '#6B778C';
      return `<span class="pha-sbar-pill" style="background:${c}20;color:${c}">${esc(s)} <b>${n}</b></span>`;
    }).join('');
  return pills ? `<div class="pha-sbar">${pills}</div>` : '';
}

// ── Feature section ───────────────────────────────────────────────────────────

function featSection(feat, hazByFun, scope) {
  const ucs = feat.use_cases || [];
  const totalHaz = ucs.reduce((s, uc) =>
    s + uc.functions.reduce((ss, fn) => ss + (hazByFun[fn.id]?.length || 0), 0), 0);
  const desc = feat.description ? `: <span class="pha-ctx-desc">${esc(feat.description)}</span>` : '';

  return `
    <div class="pha-feat">
      <div class="pha-feat-hdr">
        <span class="pha-feat-icon">${ICONS.feat}</span>
        <span class="pha-mono">${esc(feat.feat_code)}</span>
        <span class="pha-feat-name"><strong>${esc(feat.name)}</strong>${desc}</span>
        ${totalHaz ? `<span class="pha-cnt">${totalHaz} ⚡</span>` : ''}
      </div>
      ${ucs.length === 0
        ? `<div class="pha-empty-row">No use cases for this feature yet.</div>`
        : ucs.map(uc => ucSection(uc, hazByFun, scope)).join('')
      }
    </div>`;
}

// ── UC section ────────────────────────────────────────────────────────────────

function ucSection(uc, hazByFun, scope) {
  const fns = uc.functions || [];
  const totalHaz = fns.reduce((s, fn) => s + (hazByFun[fn.id]?.length || 0), 0);
  const desc = uc.description ? `: <span class="pha-ctx-desc">${esc(uc.description)}</span>` : '';

  return `
    <div class="pha-uc-wrap" data-uc-id="${uc.id}">
      <div class="pha-uc-hdr">
        <span class="pha-uc-indent">├</span>
        <span class="pha-uc-icon">${ICONS.uc}</span>
        <span class="pha-mono pha-uc-code">${esc(uc.uc_code)}</span>
        <span class="pha-uc-name"><strong>${esc(uc.name)}</strong>${desc}</span>
        <span class="pha-spacer"></span>
        ${totalHaz ? `<span class="pha-cnt">${totalHaz} ⚡</span>` : ''}
      </div>
      ${fns.length === 0
        ? `<div class="pha-empty-row" style="padding-left:56px">No functions for this use case yet.</div>`
        : fns.map(fn => funSection(fn, hazByFun[fn.id] || [], scope)).join('')
      }
    </div>`;
}

// ── Visible columns helper ────────────────────────────────────────────────────

// Columns always present regardless of config
const FIXED_COLS = ['failure_condition'];

function visibleCols(fields) {
  return fields.filter(f => f.visible || FIXED_COLS.includes(f.key));
}

// ── Function section (table layout) ──────────────────────────────────────────

function funSection(fn, funHazards, scope) {
  const clsField = scope.fields.find(f => f.key === 'classification');
  const mini = funHazards.map(h => {
    const s = h.data?.classification;
    if (!s || s === '—' || !clsField?.colors) return '';
    const c = clsField.colors[s] || '#6B778C';
    return `<span class="pha-mini-badge" style="background:${c}20;color:${c}" title="${esc(h.haz_code)}: ${esc(s)}">${esc(s.split(' ')[0])}</span>`;
  }).join('');

  const funcType = fn.function_type ? scope.funcTypes.find(ft => ft.name === fn.function_type) : null;
  const hasHazop = funcType?.failure_conditions?.length > 0;
  const ftBadge  = fn.function_type ? `<span class="fun-type-badge">${esc(fn.function_type)}</span>` : '';
  const cols     = visibleCols(scope.fields);

  return `
    <div class="fha-fun-wrap" data-fn-id="${fn.id}">
      <div class="fha-fun-hdr">
        <span class="fha-fun-indent">│  ├</span>
        <span class="fha-fun-icon">${ICONS.fun}</span>
        <span class="pha-mono fha-fun-code">${esc(fn.func_code)}</span>
        <span class="fha-fun-name"><strong>${esc(fn.name)}</strong>${ftBadge}${fn.description ? `: <span class="pha-ctx-desc">${esc(fn.description)}</span>` : ''}</span>
        <span class="pha-spacer"></span>
        ${mini}
        ${hasHazop ? `<button class="btn-ghost btn-sm btn-fha-hazop" data-fn-id="${fn.id}" data-fn-type="${esc(fn.function_type || '')}">⚡ HAZOP</button>` : ''}
        <button class="btn-ghost btn-sm btn-add-fn-fha" data-fn-id="${fn.id}">＋ Add FHA</button>
      </div>
      <div class="fha-table-wrap">
        <table class="fha-table" data-fn-id="${fn.id}">
          <thead><tr>
            <th class="fha-th-code">ID</th>
            ${cols.map(f => `<th class="fha-th-${f.key}">${esc(f.label)}</th>`).join('')}
            <th class="fha-th-status">Status</th>
            <th class="fha-th-actions"></th>
          </tr></thead>
          <tbody id="fha-tbody-${fn.id}">
            ${funHazards.map(h => hazRow(h, cols, scope)).join('')}
          </tbody>
        </table>
      </div>
      <div class="fha-hazop-panel" id="fha-hazop-${fn.id}" style="display:none"></div>
    </div>`;
}

// ── FHA hazard row (table row) ────────────────────────────────────────────────

function hazRow(h, cols, scope) {
  const d = h.data || {};
  const clsField = scope.fields.find(f => f.key === 'classification');
  const dalField = scope.fields.find(f => f.key === 'dal');
  const sc = { open:'#FF8B00', in_progress:'#0065FF', closed:'#00875A', 'n/a':'#97A0AF' }[h.status] || '#97A0AF';

  const cellContent = (f) => {
    const v = d[f.key];
    if (!v || v === '—') return '<span class="fha-cell-empty">—</span>';
    if (f.key === 'classification' && clsField?.colors) {
      const c = clsField.colors[v] || '#6B778C';
      return `<span class="pha-badge" style="background:${c}20;color:${c}">${esc(v)}</span>`;
    }
    if (f.key === 'dal' && dalField?.colors) {
      const c = dalField.colors[v] || '#6554C0';
      return `<span class="pha-badge" style="background:${c}20;color:${c}">${esc(v)}</span>`;
    }
    return `<span class="fha-cell-text">${esc(v)}</span>`;
  };

  return `
    <tr class="fha-haz-row" data-haz-id="${h.id}" title="Double-click to edit">
      <td class="fha-td-code"><span class="pha-mono">${esc(h.haz_code)}</span></td>
      ${cols.map(f => `<td class="fha-td-${f.key}">${cellContent(f)}</td>`).join('')}
      <td class="fha-td-status"><span class="pha-status-chip" style="background:${sc}20;color:${sc}">${esc(h.status)}</span></td>
      <td class="fha-td-actions">
        <button class="btn-icon btn-edit-fha" data-id="${h.id}" title="Edit">✎</button>
        <button class="btn-icon btn-del-fha"  data-id="${h.id}" title="Delete">✕</button>
      </td>
    </tr>`;
}

// ── No functions hint ─────────────────────────────────────────────────────────

function noFunctionsHint(project, scope) {
  const { item, system } = scope;
  const defPath = system
    ? `/project/${project.id}/item/${item.id}/system/${system.id}/domain/system/vcycle/item_definition`
    : `/project/${project.id}/item/${item.id}/domain/system/vcycle/item_definition`;
  return `
    <div class="pha-empty-state">
      <div class="pha-empty-icon">λ</div>
      <h3>No features found</h3>
      <p>No Features, Use Cases or Functions are defined at this level. Please check the
         <strong>Item / System Definition</strong> page and make sure they are defined
         for this ${system ? 'system' : 'item'}.</p>
      <button class="btn btn-primary" onclick="window.location.hash='${defPath}'">
        Go to Item / System Definition →
      </button>
    </div>`;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireRows(container, scope, hazByFun) {
  // "+ Add FHA" on each function
  container.querySelectorAll('.btn-add-fn-fha').forEach(btn => {
    btn.onclick = () => openAddRow(btn.dataset.fnId, scope, btn);
  });

  // HAZOP panel toggle
  container.querySelectorAll('.btn-fha-hazop').forEach(btn => {
    btn.onclick = () => {
      const panel = container.querySelector(`#fha-hazop-${btn.dataset.fnId}`);
      if (!panel) return;
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
      const funcType = scope.funcTypes.find(ft => ft.name === btn.dataset.fnType);
      if (!funcType) return;
      panel.style.display = '';
      panel.innerHTML = hazopPanelHTML(funcType, btn.dataset.fnId);
      panel.querySelector('.btn-fha-hazop-gen')?.addEventListener('click', async () => {
        await generateHazopEntries(panel, btn.dataset.fnId, funcType, scope);
        panel.style.display = 'none';
      });
    };
  });

  // Edit button
  container.querySelectorAll('.btn-edit-fha').forEach(btn => {
    btn.onclick = () => {
      const haz = scope.allHazards.find(h => h.id === btn.dataset.id);
      if (haz) openEditRow(haz, scope);
    };
  });

  // Double-click any data cell to edit
  container.querySelectorAll('.fha-haz-row').forEach(tr => {
    tr.addEventListener('dblclick', e => {
      if (e.target.closest('.fha-td-actions')) return;
      const haz = scope.allHazards.find(h => h.id === tr.dataset.hazId);
      if (haz && !tr.classList.contains('fha-row-editing')) openEditRow(haz, scope);
    });
  });

  // Delete
  container.querySelectorAll('.btn-del-fha').forEach(btn => {
    btn.onclick = async () => {
      const haz = scope.allHazards.find(h => h.id === btn.dataset.id);
      if (!haz) return;

      // Check if this FC has an associated FTA tree
      const { data: ftaCheck } = await sb.from('fta_nodes').select('id').eq('hazard_id', haz.id).limit(1);
      const hasFTA = (ftaCheck?.length || 0) > 0;

      if (!hasFTA) {
        // No FTA — simple single confirm
        confirmDialog(`Delete ${haz.haz_code}?`, async () => {
          const { error } = await sb.from('hazards').delete().eq('id', haz.id);
          if (error) { toast('Error deleting.', 'error'); return; }
          toast('FC deleted.', 'success');
          await reload(scope);
        });
        return;
      }

      // FTA exists — show double-confirm dialog
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center';
      const fc_label = haz.data?.failure_condition ? `"${haz.data.failure_condition}"` : haz.haz_code;
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">Delete ${esc(haz.haz_code)}?</div>
          <div style="font-size:13px;color:#555;margin-bottom:6px">Failure Condition: <strong>${esc(fc_label)}</strong></div>
          <div style="font-size:13px;color:#888;margin-bottom:20px">This entry has an associated FTA tree. What should be deleted?</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button id="dfc-cancel" style="padding:6px 14px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
            <button id="dfc-only"   style="padding:6px 14px;border:1px solid #d93025;border-radius:4px;background:#fff;color:#d93025;cursor:pointer;font-size:13px">Delete FC only</button>
            <button id="dfc-all"    style="padding:6px 14px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Delete FC + FTA ⚠</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#dfc-cancel').onclick = close;
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

      overlay.querySelector('#dfc-only').onclick = async () => {
        close();
        // Unlink FTA nodes FIRST — must succeed before we delete the hazard,
        // otherwise the DB-level CASCADE would delete them too.
        const { error: unlinkErr } = await sb.from('fta_nodes')
          .update({ hazard_id: null })
          .eq('hazard_id', haz.id);
        if (unlinkErr) {
          toast('Could not unlink FTA nodes: ' + unlinkErr.message, 'error');
          return; // do NOT delete the FC if unlink failed
        }
        const { error } = await sb.from('hazards').delete().eq('id', haz.id);
        if (error) { toast('Error deleting FC: ' + error.message, 'error'); return; }
        toast('FC deleted. FTA tree preserved (now unlinked).', 'success');
        await reload(scope);
      };

      overlay.querySelector('#dfc-all').onclick = () => {
        close();
        // Second confirmation for the destructive combined delete
        const overlay2 = document.createElement('div');
        overlay2.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
        overlay2.innerHTML = `
          <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25);font-family:inherit;border-top:4px solid #d93025">
            <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:#d93025">⚠ Confirm permanent deletion</div>
            <div style="font-size:13px;color:#555;margin-bottom:20px">This will permanently delete <strong>${esc(haz.haz_code)}</strong> and its entire FTA tree. This cannot be undone.</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="dfc2-cancel"  style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
              <button id="dfc2-confirm" style="padding:6px 16px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Yes, delete everything</button>
            </div>
          </div>`;
        document.body.appendChild(overlay2);
        overlay2.querySelector('#dfc2-cancel').onclick = () => overlay2.remove();
        overlay2.addEventListener('click', e => { if (e.target === overlay2) overlay2.remove(); });
        overlay2.querySelector('#dfc2-confirm').onclick = async () => {
          overlay2.remove();
          // Delete FTA nodes first, then hazard
          await sb.from('fta_nodes').delete().eq('hazard_id', haz.id);
          const { error } = await sb.from('hazards').delete().eq('id', haz.id);
          if (error) { toast('Error deleting.', 'error'); return; }
          toast('FC and FTA deleted.', 'success');
          await reload(scope);
        };
      };
    };
  });
}

// ── HAZOP panel ───────────────────────────────────────────────────────────────

function hazopPanelHTML(funcType, fnId) {
  const checks = (funcType.failure_conditions || []).map((fc, i) => `
    <label class="hazop-check-label">
      <input type="checkbox" class="hazop-fc-check" value="${esc(fc)}" checked/>
      <span>${esc(fc)}</span>
    </label>`).join('');

  return `
    <div class="hazop-panel">
      <div class="hazop-panel-hdr">
        <span class="hazop-panel-title">⚡ HAZOP — ${esc(funcType.name)}</span>
        <span class="hazop-panel-hint">Select failure conditions to generate FHA entries</span>
      </div>
      <div class="hazop-checks">${checks}</div>
      <div class="hazop-panel-actions">
        <button class="btn btn-primary btn-sm btn-fha-hazop-gen">Generate FHA entries</button>
      </div>
    </div>`;
}

async function generateHazopEntries(panel, fnId, funcType, scope) {
  const checks = [...panel.querySelectorAll('.hazop-fc-check:checked')].map(el => el.value);
  if (!checks.length) { toast('No failure conditions selected.', 'error'); return; }

  const { data: existing } = await sb.from('hazards')
    .select('id', { count: 'exact', head: false })
    .eq('parent_type', scope.parentType).eq('parent_id', scope.parentId)
    .eq('analysis_type', 'FHA');

  let idx = (existing?.length || 0) + 1;
  const proj = scope.project;
  const records = checks.map(fc => ({
    parent_type:   scope.parentType,
    parent_id:     scope.parentId,
    analysis_type: 'FHA',
    function_id:   fnId,
    haz_code:      buildCode('FHA', { projectName: proj.name, index: idx++ }),
    data:          { failure_condition: fc },
    status:        'open',
    sort_order:    0,
  }));

  const { data: newHazards, error } = await sb.from('hazards').insert(records).select();
  if (error) { toast('Error generating entries: ' + error.message, 'error'); return; }

  // Auto-seed an FTA tree for each new Failure Condition
  if (newHazards?.length) {
    const ftaSeeds = newHazards.map(h => ({
      parent_type: scope.parentType,
      parent_id:   scope.parentId,
      project_id:  scope.project.id,
      hazard_id:   h.id,
      type:        'top_event',
      label:       h.data?.failure_condition || h.haz_code,
      component:   '',
      fta_code:    'TE-01',
      x: 400, y: 100, sort_order: 0, color: '',
    }));
    await sb.from('fta_nodes').insert(ftaSeeds);
  }

  toast(`${records.length} FHA entr${records.length === 1 ? 'y' : 'ies'} + FTAs created.`, 'success');
  await reload(scope);
}

// ── Inline add row ────────────────────────────────────────────────────────────

function openAddRow(fnId, scope, triggerBtn) {
  const alreadyOpen = triggerBtn && triggerBtn.textContent.includes('Cancel');
  cancelAllEdits(scope);
  if (alreadyOpen) return; // toggle off

  const tbody = scope.container.querySelector(`#fha-tbody-${fnId}`);
  if (!tbody) return;

  if (triggerBtn) triggerBtn.textContent = '✕ Cancel';

  const tr = document.createElement('tr');
  tr.className = 'fha-inline-tr';
  tr.innerHTML = inlineRowHTML(null, fnId, scope);
  tbody.appendChild(tr);

  tr.querySelector('.pha-ir-cancel').onclick = () => {
    tr.remove();
    if (triggerBtn) triggerBtn.textContent = '＋ Add FHA';
  };
  tr.querySelector('.pha-ir-save').onclick = () => saveRow(tr, null, fnId, scope, () => {
    if (triggerBtn) triggerBtn.textContent = '＋ Add FHA';
  });

  tr.querySelectorAll('input, select, textarea').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); tr.querySelector('.pha-ir-save').click(); }
      if (e.key === 'Escape') { e.preventDefault(); tr.querySelector('.pha-ir-cancel').click(); }
    };
  });

  const first = tr.querySelector('input, textarea');
  if (first) first.focus();
}

// ── Inline edit row — transforms cells in-place ───────────────────────────────

function openEditRow(haz, scope) {
  // Cancel any other row being edited
  cancelAllEdits(scope);

  const tr = scope.container.querySelector(`.fha-haz-row[data-haz-id="${haz.id}"]`);
  if (!tr) return;

  tr.classList.add('fha-row-editing');

  const cols = visibleCols(scope.fields);
  const d    = haz.data || {};

  const selOpts = (opts, val) => (opts || []).map(o =>
    `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('');

  // Transform each data cell into an input
  cols.forEach(f => {
    const td = tr.querySelector(`.fha-td-${f.key}`);
    if (!td) return;
    td.dataset.origHtml = td.innerHTML;
    const val = d[f.key] || '';
    if (f.type === 'select' || f.type === 'badge_select') {
      td.innerHTML = `<select class="form-input fha-ir-input" id="fha-ir-${f.key}">${selOpts(f.options, val)}</select>`;
    } else if (f.type === 'textarea') {
      td.innerHTML = `<textarea class="form-input fha-ir-input" id="fha-ir-${f.key}" rows="2">${esc(val)}</textarea>`;
    } else {
      td.innerHTML = `<input class="form-input fha-ir-input" id="fha-ir-${f.key}" value="${esc(val)}"/>`;
    }
  });

  // Status cell
  const statusTd = tr.querySelector('.fha-td-status');
  if (statusTd) {
    statusTd.dataset.origHtml = statusTd.innerHTML;
    statusTd.innerHTML = `<select class="form-input fha-ir-input" id="fha-ir-status">
      ${['open','in_progress','closed','n/a'].map(s =>
        `<option value="${s}" ${(haz.status||'open') === s ? 'selected':''}>${s}</option>`).join('')}
    </select>`;
  }

  // Actions cell — show discard button; save fires on blur automatically
  const actionsTd = tr.querySelector('.fha-td-actions');
  if (actionsTd) {
    actionsTd.dataset.origHtml = actionsTd.innerHTML;
    actionsTd.innerHTML = `<button class="btn-icon fha-discard-btn" title="Discard (Esc)">✗</button>`;
    actionsTd.querySelector('.fha-discard-btn').onmousedown = e => {
      e.preventDefault(); // prevent blur from firing first
      restoreRow(tr);
    };
  }

  // Auto-save on blur (when focus leaves the row entirely)
  let _blurTimer;
  tr.querySelectorAll('.fha-ir-input').forEach(el => {
    el.addEventListener('blur', () => {
      _blurTimer = setTimeout(() => {
        if (tr.classList.contains('fha-row-editing') && !tr.contains(document.activeElement)) {
          saveRow(tr, haz, haz.function_id, scope);
        }
      }, 180);
    });
    el.addEventListener('focus', () => clearTimeout(_blurTimer));
    el.onkeydown = e => {
      if (e.key === 'Escape') { e.preventDefault(); clearTimeout(_blurTimer); restoreRow(tr); }
      // Enter on non-textarea: move to next input, auto-save will fire on final blur
      if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const inputs = [...tr.querySelectorAll('.fha-ir-input')];
        const next = inputs[inputs.indexOf(el) + 1];
        if (next) next.focus(); else el.blur();
      }
    };
  });

  const first = tr.querySelector('.fha-ir-input');
  if (first) { first.focus(); first.select?.(); }
}

function restoreRow(tr) {
  tr.classList.remove('fha-row-editing');
  tr.querySelectorAll('[data-orig-html]').forEach(td => {
    td.innerHTML = td.dataset.origHtml;
    delete td.dataset.origHtml;
  });
}

function cancelAllEdits(scope) {
  scope.container.querySelectorAll('.fha-row-editing').forEach(tr => restoreRow(tr));
  scope.container.querySelectorAll('.fha-inline-tr').forEach(el => el.remove());
  scope.container.querySelectorAll('.btn-add-fn-fha').forEach(b => b.textContent = '＋ Add FHA');
}

// ── Inline row HTML (returns <td> cells, inserted into a <tr>) ───────────────

function inlineRowHTML(haz, fnId, scope) {
  const d      = haz?.data || {};
  const cols   = visibleCols(scope.fields);
  const statusVal = haz?.status || 'open';

  const selOpts = (opts, val) => (opts || []).map(o =>
    `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('');

  const inputFor = (f) => {
    const val = d[f.key] || '';
    if (f.type === 'select' || f.type === 'badge_select') {
      return `<select class="form-input fha-ir-input" id="fha-ir-${f.key}">${selOpts(f.options, val)}</select>`;
    }
    if (f.type === 'textarea') {
      return `<textarea class="form-input fha-ir-input" id="fha-ir-${f.key}" rows="2">${esc(val)}</textarea>`;
    }
    return `<input class="form-input fha-ir-input" id="fha-ir-${f.key}" value="${esc(val)}" placeholder="${esc(f.label)}"/>`;
  };

  return `
    <td class="fha-td-code"><span class="pha-mono fha-ir-newlabel">${haz ? esc(haz.haz_code) : 'new'}</span></td>
    ${cols.map(f => `<td class="fha-td-${f.key} fha-td-input">${inputFor(f)}</td>`).join('')}
    <td class="fha-td-status fha-td-input">
      <select class="form-input fha-ir-input" id="fha-ir-status">
        ${['open','in_progress','closed','n/a'].map(s =>
          `<option value="${s}" ${statusVal === s ? 'selected':''}>${s}</option>`).join('')}
      </select>
    </td>
    <td class="fha-td-actions fha-td-input">
      <button class="btn btn-primary btn-sm pha-ir-save" title="Save">✓</button>
      <button class="btn btn-secondary btn-sm pha-ir-cancel" title="Cancel">✗</button>
    </td>`;
}

// ── Save row ──────────────────────────────────────────────────────────────────

async function saveRow(row, existingHaz, fnId, scope, onDone) {
  const v    = id => row.querySelector(id)?.value?.trim() || '';
  const fcEl = row.querySelector('#fha-ir-failure_condition');
  const fc   = fcEl?.value?.trim() || '';
  if (!fc && fcEl) { fcEl.style.borderColor = 'var(--color-danger)'; fcEl.focus(); return; }
  if (fcEl) fcEl.style.borderColor = '';

  // Start from existing data (preserves hidden fields on edit)
  const data = existingHaz ? { ...(existingHaz.data || {}) } : {};
  visibleCols(scope.fields).forEach(f => {
    data[f.key] = row.querySelector(`#fha-ir-${f.key}`)?.value?.trim() || null;
  });
  if (!data.failure_condition) data.failure_condition = fc || null;

  const status = v('#fha-ir-status') || 'open';

  let error;
  if (existingHaz) {
    ({ error } = await sb.from('hazards').update({
      data, status, function_id: fnId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', existingHaz.id));
  } else {
    // Get next index for code
    const { data: existing } = await sb.from('hazards')
      .select('id').eq('parent_type', scope.parentType).eq('parent_id', scope.parentId)
      .eq('analysis_type', 'FHA');
    const idx = (existing?.length || 0) + 1;
    const haz_code = buildCode('FHA', { projectName: scope.project.name, index: idx });

    let newHaz;
    ({ data: newHaz, error } = await sb.from('hazards').insert({
      parent_type:   scope.parentType,
      parent_id:     scope.parentId,
      analysis_type: 'FHA',
      function_id:   fnId || null,
      haz_code,
      data, status, sort_order: idx,
    }).select().single());

    // Auto-seed an FTA tree for this new Failure Condition
    if (!error && newHaz) {
      await sb.from('fta_nodes').insert({
        parent_type: scope.parentType,
        parent_id:   scope.parentId,
        project_id:  scope.project.id,
        hazard_id:   newHaz.id,
        type:        'top_event',
        label:       data.failure_condition,
        component:   '',
        fta_code:    'TE-01',
        x: 400, y: 100, sort_order: 0, color: '',
      });
    }
  }

  if (error) { toast('Error saving: ' + error.message, 'error'); console.error(error); return; }
  toast(existingHaz ? 'Updated.' : 'FHA entry added. FTA created.', 'success');
  row.remove();
  if (onDone) onDone();
  await reload(scope);
}

// ── Reload ────────────────────────────────────────────────────────────────────

async function reload(scope) {
  const [{ data: hazards }, rawTree] = await Promise.all([
    sb.from('hazards')
      .select('*').eq('parent_type', scope.parentType).eq('parent_id', scope.parentId)
      .eq('analysis_type', 'FHA')
      .order('sort_order'),
    loadTree(scope.parentType, scope.parentId),
  ]);
  scope.allHazards = hazards || [];
  scope.tree       = rawTree;
  paint(scope);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
