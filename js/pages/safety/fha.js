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
    loadTree(parentType, parentId, item),
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

// ── Load tree (with item-level fallback to child systems) ─────────────────────

async function loadTree(parentType, parentId, item) {
  let tree = await getFeaturesTree(parentType, parentId, 'system');
  if (tree.length) return tree;

  if (parentType === 'item' && item?.id) {
    const { data: systems } = await sb.from('systems').select('id,name').eq('item_id', item.id);
    if (systems?.length) {
      const trees = await Promise.all(systems.map(s => getFeaturesTree('system', s.id, 'system')));
      tree = trees.flat();
    }
  }
  return tree;
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

// ── Function section ──────────────────────────────────────────────────────────

function funSection(fn, funHazards, scope) {
  const clsField = scope.fields.find(f => f.key === 'classification');
  const mini = funHazards.map(h => {
    const s = h.data?.classification;
    if (!s || s === '—' || !clsField?.colors) return '';
    const c = clsField.colors[s] || '#6B778C';
    return `<span class="pha-mini-badge" style="background:${c}20;color:${c}" title="${esc(h.haz_code)}: ${esc(s)}">${esc(s.split(' ')[0])}</span>`;
  }).join('');

  // HAZOP trigger: does this function's type have failure conditions?
  const funcType = fn.function_type
    ? scope.funcTypes.find(ft => ft.name === fn.function_type)
    : null;
  const hasHazop = funcType?.failure_conditions?.length > 0;

  const ftBadge = fn.function_type
    ? `<span class="fun-type-badge">${esc(fn.function_type)}</span>`
    : '';

  return `
    <div class="fha-fun-wrap" data-fn-id="${fn.id}">
      <div class="fha-fun-hdr">
        <span class="fha-fun-indent">│  ├</span>
        <span class="fha-fun-icon">${ICONS.fun}</span>
        <span class="pha-mono fha-fun-code">${esc(fn.func_code)}</span>
        <span class="fha-fun-name"><strong>${esc(fn.name)}</strong>${ftBadge}${fn.description ? `: <span class="pha-ctx-desc">${esc(fn.description)}</span>` : ''}</span>
        <span class="pha-spacer"></span>
        ${mini}
        ${hasHazop ? `
          <button class="btn-ghost btn-sm btn-fha-hazop"
            data-fn-id="${fn.id}" data-fn-type="${esc(fn.function_type || '')}">
            ⚡ HAZOP
          </button>` : ''}
        <button class="btn-ghost btn-sm btn-add-fn-fha"
          data-fn-id="${fn.id}" data-fn-code="${esc(fn.func_code)}" data-fn-name="${esc(fn.name)}">
          ＋ Add FHA
        </button>
      </div>
      ${funHazards.map(h => hazRow(h, scope)).join('')}
      <div class="pha-add-row-anchor" id="fha-anchor-${fn.id}"></div>
      <div class="fha-hazop-panel" id="fha-hazop-${fn.id}" style="display:none"></div>
    </div>`;
}

// ── FHA hazard row ────────────────────────────────────────────────────────────

function hazRow(h, scope) {
  const d = h.data || {};
  const clsField = scope.fields.find(f => f.key === 'classification');
  const cls = d.classification && d.classification !== '—' ? d.classification : null;
  const clsColor = cls && clsField?.colors ? (clsField.colors[cls] || '#6B778C') : null;
  const sc = { open:'#FF8B00', in_progress:'#0065FF', closed:'#00875A', 'n/a':'#97A0AF' }[h.status] || '#97A0AF';

  const fc = d.failure_condition ? `<strong>${esc(d.failure_condition)}</strong>` : '';
  const effectStr = d.effect_system ? `<span class="pha-ctx-desc">${esc(d.effect_system)}</span>` : '';
  const main = fc && effectStr ? `${fc}: ${effectStr}` : fc || effectStr || '<span style="color:var(--color-text-subtle)">—</span>';

  return `
    <div class="pha-haz-row" data-haz-id="${h.id}">
      <span class="pha-haz-tree-indent">│     └</span>
      <span class="pha-haz-icon">⚡</span>
      <span class="pha-mono pha-haz-code">${esc(h.haz_code)}</span>
      ${clsColor ? `<span class="pha-badge" style="background:${clsColor}20;color:${clsColor}">${esc(cls)}</span>` : ''}
      ${d.dal && d.dal !== '—' ? `<span class="pha-badge" style="background:#6554C020;color:#6554C0">${esc(d.dal)}</span>` : ''}
      <span class="pha-haz-desc">${main}</span>
      ${d.phase_of_op && d.phase_of_op !== '—' ? `<span class="pha-meta">${esc(d.phase_of_op)}</span>` : ''}
      <span class="pha-spacer"></span>
      <span class="pha-status-chip" style="background:${sc}20;color:${sc}">${esc(h.status)}</span>
      <button class="btn-icon btn-edit-fha" data-id="${h.id}">✎</button>
      <button class="btn-icon btn-del-fha"  data-id="${h.id}">✕</button>
    </div>
    ${(d.mitigation_avoid || d.safety_measures || d.requirements) ? `
      <div class="pha-haz-mit-row">
        <span class="pha-haz-mit-indent">│        </span>
        ${d.mitigation_avoid ? `<span class="pha-mit-label">↳ Mitigation:</span><span class="pha-mit-text">${esc(d.mitigation_avoid)}</span>` : ''}
        ${d.safety_measures  ? `<span class="pha-mit-label" style="margin-left:12px">🛡 Measures:</span><span class="pha-mit-text">${esc(d.safety_measures)}</span>` : ''}
        ${d.requirements     ? `<span class="pha-mit-label" style="margin-left:12px">📋 Req:</span><span class="pha-mit-text">${esc(d.requirements)}</span>` : ''}
      </div>` : ''}
    <div class="pha-add-row-anchor" id="fha-edit-anchor-${h.id}"></div>`;
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
      <h3>No Functions defined yet</h3>
      <p>FHA links failure conditions to Functions. First define Features, Use Cases and Functions in
         <strong>System Definition</strong>, then return here to record functional hazards.</p>
      <button class="btn btn-primary" onclick="window.location.hash='${defPath}'">
        Go to System Definition →
      </button>
    </div>`;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireRows(container, scope, hazByFun) {
  // "+ Add FHA" on each function
  container.querySelectorAll('.btn-add-fn-fha').forEach(btn => {
    btn.onclick = () => {
      const anchor = container.querySelector(`#fha-anchor-${btn.dataset.fnId}`);
      if (anchor) openAddRow(anchor, btn.dataset.fnId, scope, btn);
    };
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

  // Edit
  container.querySelectorAll('.btn-edit-fha').forEach(btn => {
    btn.onclick = () => {
      const haz    = scope.allHazards.find(h => h.id === btn.dataset.id);
      const anchor = container.querySelector(`#fha-edit-anchor-${haz.id}`);
      if (haz && anchor) openEditRow(anchor, haz, scope);
    };
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

function openAddRow(anchor, fnId, scope, triggerBtn) {
  if (anchor.firstChild) {
    anchor.innerHTML = '';
    if (triggerBtn) triggerBtn.textContent = '＋ Add FHA';
    return;
  }

  scope.container.querySelectorAll('.pha-inline-row').forEach(el => el.remove());
  scope.container.querySelectorAll('.btn-add-fn-fha').forEach(b => b.textContent = '＋ Add FHA');

  if (triggerBtn) triggerBtn.textContent = '✕ Cancel';

  const row = document.createElement('div');
  row.className = 'pha-inline-row';
  row.innerHTML = inlineRowHTML(null, fnId, scope);
  anchor.appendChild(row);

  row.querySelector('.pha-ir-cancel').onclick = () => {
    row.remove();
    if (triggerBtn) triggerBtn.textContent = '＋ Add FHA';
  };
  row.querySelector('.pha-ir-save').onclick = () => saveRow(row, null, fnId, scope, () => {
    if (triggerBtn) triggerBtn.textContent = '＋ Add FHA';
  });

  row.querySelectorAll('input, select').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); row.querySelector('.pha-ir-save').click(); }
      if (e.key === 'Escape') { e.preventDefault(); row.querySelector('.pha-ir-cancel').click(); }
    };
  });

  const first = row.querySelector('input, textarea');
  if (first) first.focus();
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function openEditRow(anchor, haz, scope) {
  if (anchor.firstChild) { anchor.innerHTML = ''; return; }

  scope.container.querySelectorAll('.pha-inline-row').forEach(el => el.remove());

  const row = document.createElement('div');
  row.className = 'pha-inline-row pha-inline-row--edit';
  row.innerHTML = inlineRowHTML(haz, haz.function_id, scope);
  anchor.appendChild(row);

  row.querySelector('.pha-ir-cancel').onclick = () => row.remove();
  row.querySelector('.pha-ir-save').onclick   = () => saveRow(row, haz, haz.function_id, scope);

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

function inlineRowHTML(haz, fnId, scope) {
  const d   = haz?.data || {};
  const fld = (key) => scope.fields.find(f => f.key === key);

  const fcF      = fld('failure_condition');
  const phaseF   = fld('phase_of_op');
  const effLocF  = fld('effect_local');
  const effSysF  = fld('effect_system');
  const clsF     = fld('classification');
  const dalF     = fld('dal');
  const mitAvF   = fld('mitigation_avoid');
  const measF    = fld('safety_measures');
  const reqF     = fld('requirements');
  const statusVal = haz?.status || 'open';

  const selOpts = (opts, val) => (opts || []).map(o =>
    `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('');

  return `
    <div class="pha-ir-tree">│     └</div>
    <div class="pha-ir-body">
      <div class="pha-ir-row1">
        ${fcF ? `
          <div class="pha-ir-field pha-ir-fc">
            <label>Failure Condition *</label>
            <input class="form-input" id="fha-ir-fc" value="${esc(d.failure_condition || '')}" placeholder="e.g. Loss of function"/>
          </div>` : ''}
        ${clsF ? `
          <div class="pha-ir-field pha-ir-cls">
            <label>${esc(clsF.label)}</label>
            <select class="form-input" id="fha-ir-cls">
              ${selOpts(clsF.options, d.classification)}
            </select>
          </div>` : ''}
        ${dalF ? `
          <div class="pha-ir-field pha-ir-dal">
            <label>${esc(dalF.label)}</label>
            <select class="form-input" id="fha-ir-dal">
              ${selOpts(dalF.options, d.dal)}
            </select>
          </div>` : ''}
        ${phaseF ? `
          <div class="pha-ir-field pha-ir-phase">
            <label>${esc(phaseF.label)}</label>
            <select class="form-input" id="fha-ir-phase">
              ${selOpts(phaseF.options, d.phase_of_op)}
            </select>
          </div>` : ''}
        <div class="pha-ir-field pha-ir-status">
          <label>Status</label>
          <select class="form-input" id="fha-ir-status">
            ${['open','in_progress','closed','n/a'].map(s =>
              `<option value="${s}" ${statusVal === s ? 'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pha-ir-row2">
        ${effLocF ? `
          <div class="pha-ir-field" style="flex:1">
            <label>${esc(effLocF.label)}</label>
            <input class="form-input" id="fha-ir-eff-loc" value="${esc(d.effect_local || '')}" placeholder="Local effect…"/>
          </div>` : ''}
        ${effSysF ? `
          <div class="pha-ir-field" style="flex:1">
            <label>${esc(effSysF.label)}</label>
            <input class="form-input" id="fha-ir-eff-sys" value="${esc(d.effect_system || '')}" placeholder="System level effect…"/>
          </div>` : ''}
      </div>
      <div class="pha-ir-row3">
        ${mitAvF ? `
          <div class="pha-ir-field" style="flex:1">
            <label>${esc(mitAvF.label)}</label>
            <textarea class="form-input form-textarea" id="fha-ir-mit" rows="2" placeholder="Mitigation/avoidance measures…">${esc(d.mitigation_avoid || '')}</textarea>
          </div>` : ''}
        ${measF ? `
          <div class="pha-ir-field" style="flex:1">
            <label>${esc(measF.label)}</label>
            <textarea class="form-input form-textarea" id="fha-ir-meas" rows="2" placeholder="Safety measures…">${esc(d.safety_measures || '')}</textarea>
          </div>` : ''}
        ${reqF ? `
          <div class="pha-ir-field" style="flex:1">
            <label>${esc(reqF.label)}</label>
            <input class="form-input" id="fha-ir-req" value="${esc(d.requirements || '')}" placeholder="Requirement ref…"/>
          </div>` : ''}
      </div>
      <div class="pha-ir-actions">
        <button class="btn btn-primary btn-sm pha-ir-save">✓ Save</button>
        <button class="btn btn-secondary btn-sm pha-ir-cancel">✗ Cancel</button>
      </div>
    </div>`;
}

// ── Save row ──────────────────────────────────────────────────────────────────

async function saveRow(row, existingHaz, fnId, scope, onDone) {
  const v  = id => row.querySelector(id)?.value?.trim() || '';
  const fc = v('#fha-ir-fc');
  const fcEl = row.querySelector('#fha-ir-fc');
  if (!fc && fcEl) { fcEl.style.borderColor = 'var(--color-danger)'; fcEl.focus(); return; }
  if (fcEl) fcEl.style.borderColor = '';

  const data = {
    failure_condition: fc,
    phase_of_op:       v('#fha-ir-phase')   || null,
    effect_local:      v('#fha-ir-eff-loc') || null,
    effect_system:     v('#fha-ir-eff-sys') || null,
    classification:    v('#fha-ir-cls')     || null,
    dal:               v('#fha-ir-dal')     || null,
    mitigation_avoid:  v('#fha-ir-mit')     || null,
    safety_measures:   v('#fha-ir-meas')    || null,
    requirements:      v('#fha-ir-req')     || null,
  };
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
    loadTree(scope.parentType, scope.parentId, scope.item),
  ]);
  scope.allHazards = hazards || [];
  scope.tree       = rawTree;
  paint(scope);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
