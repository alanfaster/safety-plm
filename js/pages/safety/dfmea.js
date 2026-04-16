/**
 * DFMEA — Design Failure Mode and Effects Analysis (VDA DFMEA 2019)
 *
 * Row hierarchy:
 *   FM row    (row_type='fm')     : component, function, failure_mode, max_severity (computed), status
 *   Effect row (row_type='effect'): effect_higher, effect_local, severity   — children of FM
 *   Cause row  (row_type='cause') : failure_cause, prevention_controls, O,
 *                                   detection_controls, D, AP, actions …    — children of Effect or FM
 *
 * AP = calcAP(max_severity_of_fm, cause.O, cause.D)
 */

import { sb, buildCode, nextIndex } from '../../config.js';
import { toast } from '../../toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STATUSES = ['open', 'in_progress', 'closed'];
const ITEM_STATUSES   = ['draft', 'review', 'approved'];

function calcAP(s, o, d) {
  s = +s; o = +o; d = +d;
  if (!s || !o || !d) return '-';
  if (s >= 9) return 'H';
  if (s >= 7) { if (o === 1 && d <= 3) return 'L'; if (o === 1) return 'M'; return 'H'; }
  if (s >= 4) { if (o <= 2 && d <= 3) return 'L'; if (o <= 2) return 'M'; if (d <= 3) return 'M'; return 'H'; }
  if (s >= 2) { if (o <= 2 && d <= 3) return 'N'; if (o <= 2) return 'L'; return 'M'; }
  return 'N';
}

const AP_COLORS    = { H:'#C5221F', M:'#E65100', L:'#1E8E3E', N:'#6B778C', '-':'#9AA0A6' };
const IFACE_COLORS = { Data:'#1A73E8', Electrical:'#E37400', Mechanical:'#5D4037', Thermal:'#C5221F', Power:'#7B1FA2' };
const COMP_COLORS  = {
  HW:         { border:'#1A73E8', badge:'#E8F0FE', badgeText:'#1A73E8' },
  SW:         { border:'#1E8E3E', badge:'#E6F4EA', badgeText:'#1E8E3E' },
  Mechanical: { border:'#E37400', badge:'#FEF3E2', badgeText:'#E37400' },
  Group:      { border:'#9AA0A6', badge:'#F8F9FA', badgeText:'#6B778C' },
  Port:       { border:'#212121', badge:'#EEE',    badgeText:'#333'    },
};

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx   = null;
let _items = [];     // flat array of all rows (fm + effect + cause)
let _selId = null;

let _chain = { components:[], functions:[], selCompId:null, selFuncId:null };
let _map   = { components:[], connections:[], functions:[] };
let _mapLoaded  = false;
let _netVisible = true;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function cellText(val) {
  if (!val) return `<span class="dfmea-placeholder">—</span>`;
  return `<span class="dfmea-cell-text">${esc(val)}</span>`;
}
function rowType(it) { return it.row_type || 'fm'; }

/** Max severity for an FM = max of its effect rows' severity (or own severity for legacy rows). */
function maxSevForFm(fm) {
  const effs = _items.filter(i => rowType(i) === 'effect' && i.parent_row_id === fm.id);
  if (!effs.length) return fm.severity || 0;
  return Math.max(...effs.map(e => +e.severity || 0), 0);
}

/** Find the FM ancestor of a cause or effect row. */
function fmOf(it) {
  if (rowType(it) === 'fm') return it;
  if (rowType(it) === 'effect') return _items.find(i => i.id === it.parent_row_id) || null;
  if (rowType(it) === 'cause') {
    const parent = _items.find(i => i.id === it.parent_row_id);
    if (!parent) return null;
    if (rowType(parent) === 'fm') return parent;
    return _items.find(i => i.id === parent.parent_row_id) || null;
  }
  return null;
}

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, { project, item, system, parentType, parentId }) {
  _ctx        = { project, parentType, parentId };
  _items      = [];
  _selId      = null;
  _mapLoaded  = false;
  _netVisible = true;
  _chain      = { components:[], functions:[], selCompId:null, selFuncId:null };
  _map        = { components:[], connections:[], functions:[] };

  const parentName = system?.name || item?.name || '';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>DFMEA</h1>
          <p class="page-subtitle">Design FMEA · VDA 2019 · ${esc(parentName)}</p>
        </div>
        <div class="dfmea-toolbar">
          <button class="dfmea-tb-btn" id="btn-dfmea-map"   title="Toggle Structure Map">◈ Structure</button>
          <button class="dfmea-tb-btn" id="btn-dfmea-chain" title="Toggle chain">⬡ Chain</button>
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-dfmea-sync">⟳ Sync from System</button>
          <button class="btn btn-primary   btn-sm" id="btn-dfmea-new" >＋ New FM</button>
        </div>
      </div>
    </div>
    <div class="dfmea-layout" id="dfmea-layout">
      <div class="dfmea-table-area" id="dfmea-table-area">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <div class="dfmea-bottom-panel" id="dfmea-map-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-map-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">◈ Structure Map</span>
          <span class="dfmea-panel-hint">Live view — dblclick to edit inline</span>
          <button class="dfmea-tb-btn" id="btn-dfmea-net" title="Show/hide connections">⇄ Net</button>
          <button class="dfmea-tb-btn" id="dfmea-map-close">✕</button>
        </div>
        <div class="dfmea-map-body" id="dfmea-map-body"></div>
      </div>
      <div class="dfmea-bottom-panel" id="dfmea-chain-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-chain-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">⬡ Structure — Function — Failure Chain</span>
          <button class="dfmea-tb-btn" id="dfmea-chain-close">✕</button>
        </div>
        <div class="dfmea-chain-body" id="dfmea-chain-body"></div>
      </div>
    </div>`;

  wirePanelToggles();
  document.getElementById('btn-dfmea-new').onclick  = () => addFmRow();
  document.getElementById('btn-dfmea-sync').onclick = () => syncFromSystem();

  await Promise.all([loadItems(), loadChainData(), loadMapData()]);
}

// ── Panel toggles ─────────────────────────────────────────────────────────────

function wirePanelToggles() {
  document.getElementById('btn-dfmea-map')?.addEventListener('click', () => {
    const panel = document.getElementById('dfmea-map-panel');
    const wasHidden = panel.style.display === 'none';
    togglePanel('dfmea-map-panel', 'btn-dfmea-map');
    if (wasHidden) { renderMap(); } else { renderMap(); panel.style.display=''; document.getElementById('btn-dfmea-map')?.classList.add('active'); }
  });
  document.getElementById('dfmea-map-close')?.addEventListener('click', () => closePanel('dfmea-map-panel','btn-dfmea-map'));
  document.getElementById('btn-dfmea-net')?.addEventListener('click', () => {
    _netVisible = !_netVisible;
    document.getElementById('btn-dfmea-net')?.classList.toggle('active', _netVisible);
    document.querySelectorAll('.dmap-net-legend').forEach(s => { s.style.display = _netVisible?'':'none'; });
  });
  wireResizeBar('dfmea-map-resize','dfmea-map-panel');
  document.getElementById('btn-dfmea-chain')?.addEventListener('click', () => togglePanel('dfmea-chain-panel','btn-dfmea-chain'));
  document.getElementById('dfmea-chain-close')?.addEventListener('click', () => closePanel('dfmea-chain-panel','btn-dfmea-chain'));
  wireResizeBar('dfmea-chain-resize','dfmea-chain-panel');
}
function togglePanel(pid,bid){const p=document.getElementById(pid);if(!p)return;const op=p.style.display==='none';p.style.display=op?'':'none';document.getElementById(bid)?.classList.toggle('active',op);}
function closePanel(pid,bid){const p=document.getElementById(pid);if(p)p.style.display='none';document.getElementById(bid)?.classList.remove('active');}
function wireResizeBar(barId, panelId) {
  const bar=document.getElementById(barId), panel=document.getElementById(panelId);
  if(!bar||!panel)return;
  bar.addEventListener('mousedown',e=>{
    e.preventDefault();
    const sy=e.clientY,sh=panel.offsetHeight;
    const mv=m=>{panel.style.height=`${Math.max(120,sh-(m.clientY-sy))}px`;};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}

// ── Load items ────────────────────────────────────────────────────────────────

async function loadItems() {
  const area = document.getElementById('dfmea-table-area');
  if (!area) return;

  const { data, error } = await sb.from('dfmea_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending:true })
    .order('created_at', { ascending:true });

  if (error) {
    area.innerHTML = `<div class="card"><div class="card-body">
      <p style="color:var(--color-danger)"><strong>Error loading dfmea_items:</strong><br>
      <code>${esc(error.message)}</code></p>
      <p style="margin-top:8px;font-size:13px">Run <code>db/migration_dfmea.sql</code> and <code>db/migration_dfmea_v2.sql</code> in Supabase SQL Editor.</p>
    </div></div>`;
    return;
  }
  _items = data || [];
  renderTable(area);
}

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable(area) {
  const fms = _items.filter(i => rowType(i) === 'fm');

  if (!fms.length) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠</div>
        <h3>No DFMEA entries yet</h3>
        <p>Click <strong>＋ New FM</strong> to add a Failure Mode, or <strong>⟳ Sync from System</strong> to import from Architecture and FHA.</p>
      </div>`;
    return;
  }

  area.innerHTML = `
    <div class="dfmea-table-wrap">
      <table class="dfmea-table">
        <thead>
          <tr>
            <th class="dfmea-col-id">ID</th>
            <th class="dfmea-col-comp">Structure Element</th>
            <th class="dfmea-col-func">Function</th>
            <th class="dfmea-col-fm">Failure Mode</th>
            <th class="dfmea-col-maxs" title="Max Severity across all effects">Max S</th>
            <th class="dfmea-col-eff">Effect — Higher Level</th>
            <th class="dfmea-col-eff">Effect — Local</th>
            <th class="dfmea-col-sod" title="Severity">S</th>
            <th class="dfmea-col-fc">Failure Cause</th>
            <th class="dfmea-col-ctrl">Prevention Controls</th>
            <th class="dfmea-col-sod" title="Occurrence">O</th>
            <th class="dfmea-col-ctrl">Detection Controls</th>
            <th class="dfmea-col-sod" title="Detection">D</th>
            <th class="dfmea-col-ap" title="Action Priority">AP</th>
            <th class="dfmea-col-actions">Recommended Actions</th>
            <th class="dfmea-col-resp">Responsible</th>
            <th class="dfmea-col-date">Target Date</th>
            <th class="dfmea-col-astatus">Action Status</th>
            <th class="dfmea-col-status">Status</th>
            <th class="dfmea-col-add"></th>
          </tr>
        </thead>
        <tbody id="dfmea-tbody"></tbody>
      </table>
    </div>`;

  const tbody = document.getElementById('dfmea-tbody');
  fms.forEach(fm => appendFmBlock(tbody, fm));
}

// ── FM block (FM row + its effects + their causes) ────────────────────────────

function appendFmBlock(tbody, fm) {
  // FM row
  const fmTr = buildFmRow(fm);
  tbody.appendChild(fmTr);
  wireFmRow(fmTr, fm);

  // Effect rows
  const effects = _items.filter(i => rowType(i)==='effect' && i.parent_row_id===fm.id);
  effects.forEach(eff => appendEffectBlock(tbody, eff, fm));

  // Direct causes (parent = FM, no effect)
  const directCauses = _items.filter(i => rowType(i)==='cause' && i.parent_row_id===fm.id);
  directCauses.forEach(c => appendCauseRow(tbody, c, fm));
}

function appendEffectBlock(tbody, eff, fm) {
  const tr = buildEffectRow(eff, fm);
  tbody.appendChild(tr);
  wireEffectRow(tr, eff, fm);
  // Causes under this effect
  const causes = _items.filter(i => rowType(i)==='cause' && i.parent_row_id===eff.id);
  causes.forEach(c => appendCauseRow(tbody, c, fm));
}

function appendCauseRow(tbody, cause, fm) {
  const tr = buildCauseRow(cause, fm);
  tbody.appendChild(tr);
  wireCauseRow(tr, cause, fm);
}

// ── Row builders ──────────────────────────────────────────────────────────────

const NA = `<td class="dfmea-cell-na"></td>`;

function buildFmRow(fm) {
  const tr = document.createElement('tr');
  tr.dataset.id   = fm.id;
  tr.dataset.type = 'fm';
  tr.className    = `dfmea-row dfmea-row-fm${_selId===fm.id?' selected':''}`;
  const maxS = maxSevForFm(fm);
  tr.innerHTML = `
    <td class="dfmea-col-id code-cell">${esc(fm.dfmea_code)}</td>
    <td class="dfmea-col-comp dfmea-editable" data-field="component_name">${cellText(fm.component_name)}</td>
    <td class="dfmea-col-func dfmea-editable" data-field="function_name">${cellText(fm.function_name)}</td>
    <td class="dfmea-col-fm   dfmea-editable" data-field="failure_mode">${cellText(fm.failure_mode)}</td>
    <td class="dfmea-col-maxs">${maxS ? `<span class="dfmea-maxs-badge">${maxS}</span>` : '<span class="dfmea-placeholder">—</span>'}</td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-col-status">
      <select class="dfmea-sel" data-field="status">
        ${ITEM_STATUSES.map(s=>`<option value="${s}" ${fm.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-col-add dfmea-add-cell">
      <button class="dfmea-add-btn" title="Add Effect" data-action="add-effect">＋ Effect</button>
      <button class="dfmea-add-btn" title="Add Cause (direct)" data-action="add-cause">＋ Cause</button>
      <button class="dfmea-del-row-btn" title="Delete FM" data-action="del">✕</button>
    </td>`;
  return tr;
}

function buildEffectRow(eff, fm) {
  const tr = document.createElement('tr');
  tr.dataset.id     = eff.id;
  tr.dataset.type   = 'effect';
  tr.dataset.fmId   = fm.id;
  tr.className      = `dfmea-row dfmea-row-effect`;
  tr.innerHTML = `
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na dfmea-indent-eff" colspan="3"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-col-eff dfmea-editable" data-field="effect_higher">${cellText(eff.effect_higher)}</td>
    <td class="dfmea-col-eff dfmea-editable" data-field="effect_local">${cellText(eff.effect_local)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${eff.severity||5}" data-field="severity">
    </td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-col-add dfmea-add-cell">
      <button class="dfmea-add-btn" title="Add Cause for this effect" data-action="add-cause">＋ Cause</button>
      <button class="dfmea-del-row-btn" title="Delete Effect" data-action="del">✕</button>
    </td>`;
  return tr;
}

function buildCauseRow(cause, fm) {
  const maxS = maxSevForFm(fm);
  const ap   = calcAP(maxS, cause.occurrence, cause.detection);
  const apClr = AP_COLORS[ap] || '#9AA0A6';
  const tr = document.createElement('tr');
  tr.dataset.id   = cause.id;
  tr.dataset.type = 'cause';
  tr.dataset.fmId = fm.id;
  tr.className    = `dfmea-row dfmea-row-cause${_selId===cause.id?' selected':''}`;
  tr.innerHTML = `
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-cell-na dfmea-indent-cause" colspan="7"></td>
    <td class="dfmea-col-fc   dfmea-editable" data-field="failure_cause">${cellText(cause.failure_cause)}</td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="prevention_controls">${cellText(cause.prevention_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.occurrence||5}" data-field="occurrence">
    </td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="detection_controls">${cellText(cause.detection_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.detection||5}" data-field="detection">
    </td>
    <td class="dfmea-col-ap">
      <span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>
    </td>
    <td class="dfmea-col-actions dfmea-editable" data-field="actions">${cellText(cause.actions)}</td>
    <td class="dfmea-col-resp   dfmea-editable" data-field="responsible">${cellText(cause.responsible)}</td>
    <td class="dfmea-col-date   dfmea-editable" data-field="target_date">${cellText(cause.target_date)}</td>
    <td class="dfmea-col-astatus">
      <select class="dfmea-sel" data-field="action_status">
        ${ACTION_STATUSES.map(s=>`<option value="${s}" ${cause.action_status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-cell-na"></td>
    <td class="dfmea-col-add dfmea-add-cell">
      <button class="dfmea-del-row-btn" title="Delete Cause" data-action="del">✕</button>
    </td>`;
  return tr;
}

// ── Row wiring ────────────────────────────────────────────────────────────────

function wireEditable(tr, it, onSaveExtra) {
  tr.querySelectorAll('.dfmea-editable').forEach(td => {
    const field = td.dataset.field;
    td.addEventListener('dblclick', () => {
      if (td.querySelector('textarea')) return;
      const cur = it[field] || '';
      td.innerHTML = `<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea>`;
      const ta = td.querySelector('textarea');
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.addEventListener('blur', async () => {
        const v = ta.value.trim(); td.innerHTML = cellText(v);
        if (v === (it[field]||'')) return;
        it[field] = v;
        await autosave(it.id, { [field]: v });
        if (onSaveExtra) onSaveExtra(field, v);
      });
      ta.addEventListener('keydown', e => {
        if (e.key==='Escape') td.innerHTML = cellText(it[field]||'');
        if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
      });
    });
  });
}

function wireSodInputs(tr, it, onSaveExtra) {
  tr.querySelectorAll('.dfmea-sod-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const field = inp.dataset.field;
      const val   = Math.min(10, Math.max(1, +inp.value || 5));
      inp.value = val; it[field] = val;
      await autosave(it.id, { [field]: val });
      if (onSaveExtra) onSaveExtra(field, val);
    });
  });
}

function wireSelects(tr, it) {
  tr.querySelectorAll('.dfmea-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      it[sel.dataset.field] = sel.value;
      await autosave(it.id, { [sel.dataset.field]: sel.value });
    });
  });
}

function wireFmRow(tr, fm) {
  tr.addEventListener('click', e => { if (!e.target.closest('input,select,button')) selectRow(fm.id); });
  wireEditable(tr, fm, (field) => {
    if (field==='component_name'||field==='function_name') renderChain();
    refreshMapComp(fm.component_id || fm.component_name);
  });
  wireSelects(tr, fm);

  tr.querySelector('[data-action="add-effect"]')?.addEventListener('click', () => addEffectRow(fm));
  tr.querySelector('[data-action="add-cause"]')?.addEventListener('click', () => addCauseRow(fm.id, fm));
  tr.querySelector('[data-action="del"]')?.addEventListener('click', () => deleteFm(fm));
}

function wireEffectRow(tr, eff, fm) {
  wireEditable(tr, eff, () => refreshMapComp(fm.component_id || fm.component_name));
  wireSodInputs(tr, eff, () => {
    refreshMaxSCell(fm);
    refreshMapComp(fm.component_id || fm.component_name);
    refreshCauseAPs(fm);
  });
  tr.querySelector('[data-action="add-cause"]')?.addEventListener('click', () => addCauseRow(eff.id, fm));
  tr.querySelector('[data-action="del"]')?.addEventListener('click', () => deleteEffect(eff, fm));
}

function wireCauseRow(tr, cause, fm) {
  tr.addEventListener('click', e => { if (!e.target.closest('input,select,button')) selectRow(cause.id); });
  wireEditable(tr, cause, () => refreshMapComp(fm.component_id || fm.component_name));
  wireSodInputs(tr, cause, () => {
    refreshCauseAP(tr, cause, fm);
    refreshMapComp(fm.component_id || fm.component_name);
  });
  wireSelects(tr, cause);
  tr.querySelector('[data-action="del"]')?.addEventListener('click', () => deleteCause(cause, fm));
}

// ── Refresh helpers ───────────────────────────────────────────────────────────

/** Re-render the Max S cell for an FM row after its effects change. */
function refreshMaxSCell(fm) {
  const tr = document.querySelector(`.dfmea-row-fm[data-id="${fm.id}"]`);
  if (!tr) return;
  const maxS = maxSevForFm(fm);
  const cell = tr.querySelector('.dfmea-col-maxs');
  if (cell) cell.innerHTML = maxS ? `<span class="dfmea-maxs-badge">${maxS}</span>` : '<span class="dfmea-placeholder">—</span>';
}

/** Re-render AP badge on a single cause row after S/O/D changes. */
function refreshCauseAP(tr, cause, fm) {
  const maxS = maxSevForFm(fm);
  const ap   = calcAP(maxS, cause.occurrence, cause.detection);
  const cell = tr.querySelector('.dfmea-col-ap');
  if (cell) cell.innerHTML = `<span class="dfmea-ap-badge" style="background:${AP_COLORS[ap]||'#9AA0A6'}">${ap}</span>`;
}

/** Re-render AP on all cause rows under an FM (called when an effect's S changes). */
function refreshCauseAPs(fm) {
  const causes = _items.filter(i => rowType(i)==='cause' && fmOf(i)?.id===fm.id);
  causes.forEach(c => {
    const tr = document.querySelector(`.dfmea-row-cause[data-id="${c.id}"]`);
    if (tr) refreshCauseAP(tr, c, fm);
  });
}

// ── Row selection ─────────────────────────────────────────────────────────────

function selectRow(id) {
  _selId = id;
  document.querySelectorAll('.dfmea-row').forEach(r => r.classList.toggle('selected', r.dataset.id===id));
}

// ── CRUD: add rows ────────────────────────────────────────────────────────────

async function addFmRow(prefill = {}) {
  const idx  = await nextIndex('dfmea_items', { parent_id: _ctx.parentId });
  const code = buildCode('DFM', { domain: _ctx.parentType==='item'?'ITEM':'SYS', projectName: _ctx.project.name, index: idx });

  const { data: fm, error } = await sb.from('dfmea_items').insert({
    dfmea_code:   code,
    parent_type:  _ctx.parentType,
    parent_id:    _ctx.parentId,
    project_id:   _ctx.project.id,
    row_type:     'fm',
    sort_order:   _items.filter(i=>rowType(i)==='fm').length,
    severity:     0,
    occurrence:   5,
    detection:    5,
    action_status:'open',
    status:       'draft',
    ...prefill,
  }).select().single();

  if (error) { toast('Error creating FM row.', 'error'); return null; }
  _items.push(fm);

  const tbody = document.getElementById('dfmea-tbody');
  if (!tbody) { renderTable(document.getElementById('dfmea-table-area')); return fm; }
  appendFmBlock(tbody, fm);
  // Focus failure mode cell
  document.querySelector(`.dfmea-row-fm[data-id="${fm.id}"] .dfmea-col-fm`)
    ?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  renderChain();
  return fm;
}

async function addEffectRow(fm) {
  const { data: eff, error } = await sb.from('dfmea_items').insert({
    dfmea_code:   fm.dfmea_code + '-E' + (_items.filter(i=>rowType(i)==='effect'&&i.parent_row_id===fm.id).length+1),
    parent_type:  _ctx.parentType,
    parent_id:    _ctx.parentId,
    project_id:   _ctx.project.id,
    row_type:     'effect',
    parent_row_id: fm.id,
    sort_order:   _items.filter(i=>rowType(i)==='effect'&&i.parent_row_id===fm.id).length,
    severity:     5,
    occurrence:   5,
    detection:    5,
    action_status:'open',
    status:       'draft',
  }).select().single();

  if (error) { toast('Error creating Effect row.', 'error'); return; }
  _items.push(eff);

  // Insert after the last effect/cause of this FM, before the next FM
  const tbody = document.getElementById('dfmea-tbody');
  if (!tbody) { renderTable(document.getElementById('dfmea-table-area')); return; }

  const insertRef = lastRowOfFmBlock(fm.id, tbody);
  const tr = buildEffectRow(eff, fm);
  if (insertRef) insertRef.after(tr);
  else tbody.appendChild(tr);
  wireEffectRow(tr, eff, fm);

  refreshMaxSCell(fm);
  refreshCauseAPs(fm);
  // Focus effect_higher cell
  tr.querySelector('.dfmea-col-eff')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
}

async function addCauseRow(parentId, fm) {
  const { data: cause, error } = await sb.from('dfmea_items').insert({
    dfmea_code:   fm.dfmea_code + '-C' + (_items.filter(i=>rowType(i)==='cause'&&fmOf(i)?.id===fm.id).length+1),
    parent_type:  _ctx.parentType,
    parent_id:    _ctx.parentId,
    project_id:   _ctx.project.id,
    row_type:     'cause',
    parent_row_id: parentId,
    sort_order:   _items.filter(i=>rowType(i)==='cause'&&i.parent_row_id===parentId).length,
    severity:     5,
    occurrence:   5,
    detection:    5,
    action_status:'open',
    status:       'draft',
  }).select().single();

  if (error) { toast('Error creating Cause row.', 'error'); return; }
  _items.push(cause);

  const tbody = document.getElementById('dfmea-tbody');
  if (!tbody) { renderTable(document.getElementById('dfmea-table-area')); return; }

  // Insert after the last cause of this parent (effect or FM)
  const insertRef = lastRowOfParent(parentId, tbody) || lastRowOfFmBlock(fm.id, tbody);
  const tr = buildCauseRow(cause, fm);
  if (insertRef) insertRef.after(tr);
  else tbody.appendChild(tr);
  wireCauseRow(tr, cause, fm);

  // Focus failure_cause cell
  tr.querySelector('.dfmea-col-fc')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
}

/** Last <tr> in tbody belonging to this FM's block. */
function lastRowOfFmBlock(fmId, tbody) {
  const allIds = new Set([fmId, ..._items.filter(i=>fmOf(i)?.id===fmId).map(i=>i.id)]);
  let last = null;
  tbody.querySelectorAll('tr[data-id]').forEach(tr => { if (allIds.has(tr.dataset.id)) last = tr; });
  return last;
}

/** Last <tr> with data-parent = parentId (effect or FM direct). */
function lastRowOfParent(parentId, tbody) {
  const ids = new Set(_items.filter(i=>i.parent_row_id===parentId).map(i=>i.id));
  let last = null;
  tbody.querySelectorAll('tr[data-id]').forEach(tr => { if (ids.has(tr.dataset.id)) last = tr; });
  return last;
}

// ── CRUD: delete rows ─────────────────────────────────────────────────────────

async function deleteFm(fm) {
  const childCount = _items.filter(i => fmOf(i)?.id===fm.id && i.id!==fm.id).length;
  const msg = childCount
    ? `Delete FM "${fm.dfmea_code}" and its ${childCount} effect/cause row(s)?`
    : `Delete FM "${fm.dfmea_code}"?`;
  if (!confirm(msg)) return;

  // Delete all children first (cascade), then FM
  const toDelete = [fm.id, ..._items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id).map(i=>i.id)];
  await sb.from('dfmea_items').delete().in('id', toDelete);

  toDelete.forEach(id => {
    _items = _items.filter(i=>i.id!==id);
    document.querySelector(`tr[data-id="${id}"]`)?.remove();
  });
  if (!_items.filter(i=>rowType(i)==='fm').length) renderTable(document.getElementById('dfmea-table-area'));
  renderChain();
  refreshMapComp(fm.component_id || fm.component_name);
  toast('FM deleted.', 'success');
}

async function deleteEffect(eff, fm) {
  const causes = _items.filter(i=>rowType(i)==='cause'&&i.parent_row_id===eff.id);
  const msg    = causes.length ? `Delete effect and its ${causes.length} cause(s)?` : 'Delete this effect?';
  if (!confirm(msg)) return;

  const toDelete = [eff.id, ...causes.map(c=>c.id)];
  await sb.from('dfmea_items').delete().in('id', toDelete);
  toDelete.forEach(id => {
    _items = _items.filter(i=>i.id!==id);
    document.querySelector(`tr[data-id="${id}"]`)?.remove();
  });
  refreshMaxSCell(fm);
  refreshCauseAPs(fm);
  refreshMapComp(fm.component_id || fm.component_name);
}

async function deleteCause(cause, fm) {
  if (!confirm('Delete this cause?')) return;
  await sb.from('dfmea_items').delete().eq('id', cause.id);
  _items = _items.filter(i=>i.id!==cause.id);
  document.querySelector(`tr[data-id="${cause.id}"]`)?.remove();
  refreshMapComp(fm.component_id || fm.component_name);
}

// ── Autosave ──────────────────────────────────────────────────────────────────

async function autosave(id, fields) {
  const { error } = await sb.from('dfmea_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) toast('Autosave failed.', 'error');
}

// ── Chain panel ───────────────────────────────────────────────────────────────

async function loadChainData() {
  const [{ data: comps }, { data: fns }] = await Promise.all([
    sb.from('arch_components').select('id,name,comp_type').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId).order('sort_order',{ascending:true}),
    sb.from('arch_functions').select('id,component_id,name,is_safety_related').order('sort_order',{ascending:true}),
  ]);
  const ids = new Set((comps||[]).map(c=>c.id));
  _chain.components = comps||[];
  _chain.functions  = (fns||[]).filter(f=>ids.has(f.component_id));
  renderChain();
}

function renderChain() {
  const body = document.getElementById('dfmea-chain-body');
  if (!body) return;
  const comps = _chain.components, fns = _chain.functions;
  const selFns = _chain.selCompId ? fns.filter(f=>f.component_id===_chain.selCompId) : [];
  const fmItems = _items.filter(i=>rowType(i)==='fm');

  body.innerHTML = `
    <div class="dfmea-chain">
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⬡</span> Structure Element</div>
        <div class="dfmea-chain-cards">
          ${comps.length ? comps.map(c=>`
            <div class="dfmea-chain-card ${_chain.selCompId===c.id?'active':''}" data-comp-id="${c.id}">
              <div class="dfmea-chain-card-type">${esc(c.comp_type||'')}</div>
              <div class="dfmea-chain-card-name">${esc(c.name)}</div>
              <div class="dfmea-chain-card-count">${fmItems.filter(i=>i.component_id===c.id||i.component_name===c.name).length||''} FM</div>
            </div>`).join('')
          : '<div class="dfmea-chain-empty">No components in Architecture Concept.</div>'}
        </div>
      </div>
      <div class="dfmea-chain-arrow">▶</div>
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚙</span> Function</div>
        <div class="dfmea-chain-cards">
          ${!_chain.selCompId ? '<div class="dfmea-chain-empty">← Select a component</div>'
          : selFns.length ? selFns.map(f=>`
            <div class="dfmea-chain-card ${_chain.selFuncId===f.id?'active':''} ${f.is_safety_related?'safety':''}" data-func-id="${f.id}">
              ${f.is_safety_related?'<span class="dfmea-chain-safety-tag">Safety</span>':''}
              <div class="dfmea-chain-card-name">${esc(f.name)}</div>
            </div>`).join('')
          : '<div class="dfmea-chain-empty">No functions.</div>'}
        </div>
      </div>
      <div class="dfmea-chain-arrow">▶</div>
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚠</span> Failure Mode</div>
        <div class="dfmea-chain-cards">
          ${!_chain.selCompId ? '<div class="dfmea-chain-empty">← Select a component</div>'
          : fmItems.filter(i=>i.component_id===(_chain.selCompId)||i.component_name===comps.find(c=>c.id===_chain.selCompId)?.name)
              .map(fm=>{
                const maxS = maxSevForFm(fm);
                return `<div class="dfmea-chain-card fm-card" data-dfmea-id="${fm.id}">
                  <div class="dfmea-chain-card-name">${esc(fm.failure_mode||'—')}</div>
                  <div class="dfmea-chain-card-meta"><span>Max S: ${maxS||'—'}</span></div>
                </div>`;}).join('')
          || '<div class="dfmea-chain-empty">No FMs for this component.</div>'}
        </div>
      </div>
    </div>`;

  body.querySelectorAll('[data-comp-id]').forEach(el=>el.addEventListener('click',()=>{_chain.selCompId=el.dataset.compId;_chain.selFuncId=null;renderChain();}));
  body.querySelectorAll('[data-func-id]').forEach(el=>el.addEventListener('click',()=>{_chain.selFuncId=el.dataset.funcId;renderChain();}));
  body.querySelectorAll('[data-dfmea-id]').forEach(el=>el.addEventListener('click',()=>{
    selectRow(el.dataset.dfmeaId);
    document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }));
}

// ── Structure Map ─────────────────────────────────────────────────────────────

async function loadMapData() {
  const { data: comps } = await sb.from('arch_components')
    .select('id,name,comp_type,data,sort_order,x,y,width,height')
    .eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId)
    .order('sort_order',{ascending:true});

  const allComps = (comps||[]).filter(c=>c.comp_type!=='Port');
  const compIds  = allComps.map(c=>c.id);

  const [{ data: conns },{ data: fns }] = await Promise.all([
    compIds.length ? sb.from('arch_connections').select('id,source_id,target_id,interface_type,name').in('source_id',compIds) : Promise.resolve({data:[]}),
    compIds.length ? sb.from('arch_functions').select('id,component_id,name,is_safety_related').in('component_id',compIds).order('sort_order',{ascending:true}) : Promise.resolve({data:[]}),
  ]);

  // Geo-based group fallback for components missing group_id
  const groups = allComps.filter(c=>c.comp_type==='Group');
  allComps.filter(c=>c.comp_type!=='Group'&&!c.data?.group_id).forEach(c=>{
    const grp = groups.find(g=>g.x!=null&&
      c.x+(c.width||0)/2>g.x && c.x+(c.width||0)/2<g.x+(g.width||0) &&
      c.y+(c.height||0)/2>g.y && c.y+(c.height||0)/2<g.y+(g.height||0));
    if (grp) c.data={...(c.data||{}),group_id:grp.id};
  });

  _map.components  = allComps;
  _map.connections = conns||[];
  _map.functions   = fns||[];
}

async function loadAndRenderMap() {
  const body = document.getElementById('dfmea-map-body');
  if (body) body.innerHTML = '<div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>';
  await loadMapData();
  renderMap();
}

function buildMapCompHTML(c) {
  const style   = COMP_COLORS[c.comp_type]||COMP_COLORS.HW;
  const compFns = _map.functions.filter(f=>f.component_id===c.id);
  const fmRows  = _items.filter(i=>rowType(i)==='fm'&&(i.component_id===c.id||i.component_name===c.name));

  const apH = fmRows.filter(fm=>{ const s=maxSevForFm(fm); const causes=_items.filter(i=>rowType(i)==='cause'&&fmOf(i)?.id===fm.id); return causes.some(ca=>calcAP(s,ca.occurrence,ca.detection)==='H'); }).length;
  const apM = fmRows.filter(fm=>{ const s=maxSevForFm(fm); const causes=_items.filter(i=>rowType(i)==='cause'&&fmOf(i)?.id===fm.id); return !causes.some(ca=>calcAP(s,ca.occurrence,ca.detection)==='H') && causes.some(ca=>calcAP(s,ca.occurrence,ca.detection)==='M'); }).length;

  const byFn = {};
  fmRows.forEach(fm=>{const k=fm.function_name||'';(byFn[k]||(byFn[k]=[])).push(fm);});

  const fnRows = compFns.map(f=>{
    const fms = byFn[f.name]||[];
    const fmHtml = fms.map(fm=>{
      const maxS   = maxSevForFm(fm);
      const causes = _items.filter(i=>rowType(i)==='cause'&&fmOf(i)?.id===fm.id);
      const worstAP = causes.reduce((best,ca)=>{
        const ap = calcAP(maxS,ca.occurrence,ca.detection);
        const rank = {H:0,M:1,L:2,N:3,'-':4};
        return rank[ap]<rank[best]?ap:best;
      }, '-');
      return `<div class="dmap-fm-row" data-dfmea-id="${fm.id}">
        <span class="dmap-fm-icon">⚡</span>
        <span class="dmap-fm-label" data-edit-field="failure_mode">${esc(fm.failure_mode||'—')}</span>
        <span class="dmap-sod">
          <span class="dmap-sod-val" title="Max Severity">S:${maxS||'—'}</span>
          <span class="dmap-sod-val" title="Causes">${causes.length} cause${causes.length!==1?'s':''}</span>
        </span>
        ${worstAP!=='-'?`<span class="dfmea-ap-badge sm" style="background:${AP_COLORS[worstAP]}">${worstAP}</span>`:''}
      </div>`;
    }).join('');
    return `<div class="dmap-fn-entry${f.is_safety_related?' safety':''}">
      <div class="dmap-fn-hdr">
        <span class="dmap-fn-ico">${f.is_safety_related?'🔗':'⚙'}</span>
        <span class="dmap-fn-name">${esc(f.name)}</span>
        ${fms.length?`<span class="dmap-fn-count">${fms.length} FM</span>`:''}
      </div>${fmHtml}</div>`;
  }).join('');

  const orphans = (byFn['']||[]).map(fm=>{
    const maxS = maxSevForFm(fm);
    return `<div class="dmap-fm-row" data-dfmea-id="${fm.id}">
      <span class="dmap-fm-icon">⚡</span>
      <span class="dmap-fm-label">${esc(fm.failure_mode||'—')}</span>
      <span class="dmap-sod"><span class="dmap-sod-val">S:${maxS||'—'}</span></span>
    </div>`;
  }).join('');

  const nid = `dmap-c-${c.id}`;
  return `<div class="dmap-comp-node" id="${nid}" data-comp-id="${c.id}">
    <div class="dmap-comp-hdr" style="border-left:4px solid ${style.border}">
      <span class="dmap-comp-type-badge" style="background:${style.badge};color:${style.badgeText}">${esc(c.comp_type)}</span>
      <span class="dmap-comp-name">${esc(c.name)}</span>
      <span class="dmap-risk-badges">
        ${apH?`<span class="dmap-risk-badge H">H:${apH}</span>`:''}
        ${apM?`<span class="dmap-risk-badge M">M:${apM}</span>`:''}
      </span>
      <button class="dmap-collapse-btn" data-target="${nid}-body">▼</button>
    </div>
    <div class="dmap-comp-body" id="${nid}-body">
      ${fnRows||orphans
        ? fnRows+(orphans?`<div class="dmap-fn-entry"><div class="dmap-fn-hdr"><span class="dmap-fn-ico">⚙</span><span class="dmap-fn-name" style="color:var(--color-text-muted)">unassigned</span></div>${orphans}</div>`:'')
        : '<div class="dmap-empty-hint" style="padding:6px 10px">No functions or DFMEA data yet</div>'}
    </div>
  </div>`;
}

function wireMapCompNode(node, c) {
  node.querySelectorAll('.dmap-collapse-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const t=document.getElementById(btn.dataset.target);
      if(t) btn.textContent=t.classList.toggle('collapsed')?'▶':'▼';
    });
  });
  node.querySelectorAll('.dmap-fm-row').forEach(row=>{
    const id=row.dataset.dfmeaId;
    const fm=_items.find(i=>i.id===id); if(!fm) return;
    row.addEventListener('click',e=>{
      if(e.target.closest('.dmap-fm-label')) return;
      selectRow(id);
      document.querySelector(`.dfmea-row[data-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
    });
    row.querySelector('.dmap-fm-label')?.addEventListener('dblclick',e=>{
      e.stopPropagation();
      openMapInlineText(e.target,fm,'failure_mode',c);
    });
  });
}

function openMapInlineText(el,it,field,comp){
  if(el.querySelector('input,textarea'))return;
  const cur=it[field]||'';
  const w=Math.max(el.offsetWidth,120);
  el.innerHTML=`<input class="dmap-inline-input" value="${esc(cur)}" style="width:${w}px">`;
  const inp=el.querySelector('input');
  inp.focus();inp.select();
  const commit=async()=>{
    const v=inp.value.trim();
    it[field]=v;el.textContent=v||'—';
    await autosave(it.id,{[field]:v});
    refreshTableRowFm(it);
    refreshMapComp(comp.id);
  };
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();inp.blur();}
    if(e.key==='Escape')el.textContent=cur||'—';
  });
}

function refreshTableRowFm(fm) {
  const tr = document.querySelector(`.dfmea-row-fm[data-id="${fm.id}"]`);
  if (!tr) return;
  tr.replaceWith(buildFmRow(fm));
  const newTr = document.querySelector(`.dfmea-row-fm[data-id="${fm.id}"]`);
  if (newTr) wireFmRow(newTr, fm);
}

function refreshMapComp(compIdOrName) {
  const panel = document.getElementById('dfmea-map-panel');
  if (!panel || panel.style.display==='none') return;
  const map = document.getElementById('dfmea-map-body'); if(!map) return;
  if (!compIdOrName) { renderMap(); return; }
  const comp = _map.components.find(c=>c.id===compIdOrName||c.name===compIdOrName);
  if (!comp) { renderMap(); return; }
  const nid = `dmap-c-${comp.id}`;
  const existing = document.getElementById(nid); if(!existing) return;
  const bodyCollapsed = document.getElementById(`${nid}-body`)?.classList.contains('collapsed');
  const tmp = document.createElement('div');
  tmp.innerHTML = buildMapCompHTML(comp);
  const newNode = tmp.firstElementChild;
  existing.replaceWith(newNode);
  if (bodyCollapsed) { document.getElementById(`${nid}-body`)?.classList.add('collapsed'); newNode.querySelector('.dmap-collapse-btn').textContent='▶'; }
  wireMapCompNode(newNode, comp);
}

function renderMap() {
  const body=document.getElementById('dfmea-map-body'); if(!body) return;
  const allComps=_map.components;
  if(!allComps.length){body.innerHTML='<div class="dfmea-chain-empty" style="padding:32px">No components found in Architecture Concept.</div>';return;}

  const groups   =allComps.filter(c=>c.comp_type==='Group');
  const leafComps=allComps.filter(c=>c.comp_type!=='Group');
  const groupIds =new Set(groups.map(g=>g.id));

  const branch=(id,children)=>`
    <div class="dmap-connector"><div class="dmap-conn-h"></div></div>
    <div class="dmap-tree-branch">
      <div class="dmap-tree-branch-line"></div>
      <div class="dmap-tree-branch-children" id="${id}">${children}</div>
    </div>`;

  const renderGroup=g=>{
    const children=leafComps.filter(c=>c.data?.group_id===g.id);
    const bid=`dmap-g-${g.id}`;
    return `<div class="dmap-sys-row">
      <div class="dmap-sys-card">
        <span class="dmap-sys-icon">⬡</span>
        <span class="dmap-sys-name">${esc(g.name)}</span>
        <button class="dmap-collapse-btn" data-target="${bid}">▼</button>
      </div>
      ${branch(bid,children.map(c=>buildMapCompHTML(c)).join('')||'<div class="dmap-empty-hint" style="padding:6px 10px">No components</div>')}
    </div>`;
  };

  const ungrouped=leafComps.filter(c=>!c.data?.group_id||!groupIds.has(c.data.group_id));
  const rootId='dmap-root-body';

  const compMap=Object.fromEntries(allComps.map(c=>[c.id,c]));
  const netChips=_netVisible?_map.connections.slice(0,15).map(cn=>{
    const s=compMap[cn.source_id],t=compMap[cn.target_id];if(!s||!t)return'';
    const clr=IFACE_COLORS[cn.interface_type]||'#9AA0A6';
    return `<span class="dmap-conn-chip" style="border-color:${clr}"><span style="color:${clr}">→</span>${esc(s.name)} → ${esc(t.name)}${cn.interface_type?`<span class="dmap-conn-type" style="color:${clr}">${esc(cn.interface_type)}</span>`:''}</span>`;
  }).filter(Boolean).join(''):'';

  body.innerHTML=`
    ${netChips?`<div class="dmap-net-legend">${netChips}</div>`:''}
    <div class="dmap-root-row">
      <div class="dmap-root-card">
        <span class="dmap-root-icon">◈</span>
        <span class="dmap-root-name">${esc(_ctx.parentType==='item'?(_ctx.project?.name||'Item'):'System')}</span>
        <button class="dmap-collapse-btn" data-target="${rootId}">▼</button>
      </div>
      <div class="dmap-connector"><div class="dmap-conn-h"></div></div>
      <div class="dmap-tree-branch">
        <div class="dmap-tree-branch-line"></div>
        <div class="dmap-tree-branch-children" id="${rootId}">
          ${groups.map(renderGroup).join('')+ungrouped.map(c=>buildMapCompHTML(c)).join('')||'<div class="dmap-empty-hint" style="padding:8px 12px">No components yet</div>'}
        </div>
      </div>
    </div>`;

  body.querySelectorAll('.dmap-root-card .dmap-collapse-btn,.dmap-sys-card .dmap-collapse-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();const t=document.getElementById(btn.dataset.target);if(t)btn.textContent=t.classList.toggle('collapsed')?'▶':'▼';});
  });
  leafComps.forEach(c=>{const node=document.getElementById(`dmap-c-${c.id}`);if(node)wireMapCompNode(node,c);});
}

// ── Sync from System ──────────────────────────────────────────────────────────

async function syncFromSystem() {
  const btn=document.getElementById('btn-dfmea-sync');
  if(btn){btn.disabled=true;btn.textContent='⟳ Syncing…';}
  try {
    const {data:comps}=await sb.from('arch_components').select('id,name,comp_type').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId);
    if(!comps?.length){toast('No components found in Architecture Concept.','warning');return;}
    const compIds=comps.map(c=>c.id);
    const {data:archFns}=await sb.from('arch_functions').select('id,component_id,name,function_ref_id,is_safety_related').in('component_id',compIds);
    const {data:hazards}=await sb.from('hazards').select('id,data,function_id,status').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId).eq('analysis_type','FHA');
    let fnRefs={};
    if(hazards?.some(h=>h.function_id)){
      const fnIds=[...new Set(hazards.filter(h=>h.function_id).map(h=>h.function_id))];
      const {data:fns}=await sb.from('functions').select('id,name').in('id',fnIds);
      (fns||[]).forEach(f=>{fnRefs[f.id]=f;});
    }
    const importedHazIds=new Set(_items.filter(i=>i.hazard_id).map(i=>i.hazard_id));
    let created=0;

    for(const haz of(hazards||[])){
      if(importedHazIds.has(haz.id))continue;
      const d=haz.data||{};
      let matchedComp=null,matchedFn=null;
      if(haz.function_id){
        const fnRef=fnRefs[haz.function_id];
        if(fnRef){
          matchedFn=(archFns||[]).find(af=>af.function_ref_id===haz.function_id||af.name===fnRef.name);
          if(matchedFn)matchedComp=comps.find(c=>c.id===matchedFn.component_id);
        }
      }
      // Create FM row
      const fm=await addFmRow({component_id:matchedComp?.id||null,component_name:matchedComp?.name||'',function_name:matchedFn?.name||(fnRefs[haz.function_id]?.name||''),failure_mode:'',hazard_id:haz.id});
      if(!fm)continue;
      // Create Effect row from FHA data
      const efL=d.failure_condition||'',efH=d.effect_system||d.effect||'';
      if(efL||efH){
        await addEffectRow(fm);
        const newEff=_items.filter(i=>rowType(i)==='effect'&&i.parent_row_id===fm.id).at(-1);
        if(newEff){
          newEff.effect_higher=efH;newEff.effect_local=efL;newEff.severity=5;
          await autosave(newEff.id,{effect_higher:efH,effect_local:efL,severity:5});
        }
      }
      // Create Cause row from FHA data
      const fcause=d.effect_local||'';
      if(fcause){
        await addCauseRow(fm.id,fm);
        const newCause=_items.filter(i=>rowType(i)==='cause'&&i.parent_row_id===fm.id).at(-1);
        if(newCause){
          newCause.failure_cause=fcause;
          await autosave(newCause.id,{failure_cause:fcause});
        }
      }
      created++;
    }

    for(const comp of comps){
      const compFns=(archFns||[]).filter(f=>f.component_id===comp.id);
      for(const fn of compFns){
        const exists=_items.some(i=>rowType(i)==='fm'&&i.component_id===comp.id&&i.function_name===fn.name);
        if(!exists){await addFmRow({component_id:comp.id,component_name:comp.name,function_name:fn.name});created++;}
      }
    }
    toast(created>0?`Synced ${created} new FM(s) from Architecture & FHA.`:'Everything already up to date.','success'+(created>0?'':''));
  }catch(e){toast('Sync error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='⟳ Sync from System';}}
}
