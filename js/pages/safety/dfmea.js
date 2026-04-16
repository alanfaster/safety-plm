/**
 * DFMEA — Design Failure Mode and Effects Analysis (VDA DFMEA 2019)
 *
 * Layout:
 *  • Scrollable VDA table with inline editing and autosave
 *  • Resizable bottom panel: Structure → Function → Failure chain (APIS IQ-SW style)
 *  • "Sync from System" auto-imports components/functions from Architecture + FHA
 *
 * VDA 2019 columns:
 *  ID | Structure Element | Function | Failure Mode | Effect (Higher) | Effect (Local)
 *  | Failure Cause | S | Prevention Controls | O | Detection Controls | D | AP
 *  | Actions | Responsible | Target Date | Action Status
 */

import { sb, buildCode, nextIndex } from '../../config.js';
import { toast } from '../../toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STATUSES = ['open', 'in_progress', 'closed'];
const ITEM_STATUSES   = ['draft', 'review', 'approved'];

// VDA 2019 AP matrix (simplified)
function calcAP(s, o, d) {
  s = +s; o = +o; d = +d;
  if (!s || !o || !d) return '-';
  if (s >= 9) return 'H';
  if (s >= 7) {
    if (o === 1 && d <= 3) return 'L';
    if (o === 1)           return 'M';
    return 'H';
  }
  if (s >= 4) {
    if (o <= 2 && d <= 3) return 'L';
    if (o <= 2)           return 'M';
    if (d <= 3)           return 'M';
    return 'H';
  }
  if (s >= 2) {
    if (o <= 2 && d <= 3) return 'N';
    if (o <= 2)           return 'L';
    return 'M';
  }
  return 'N';
}

const AP_COLORS = { H: '#C5221F', M: '#E65100', L: '#1E8E3E', N: '#6B778C', '-': '#9AA0A6' };

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx    = null;   // { project, parentType, parentId }
let _items  = [];     // ordered dfmea rows
let _selId  = null;   // selected row id (highlights chain)

// Chain panel state
let _chain = {
  components: [],   // arch_components for this parent
  functions:  [],   // arch_functions for all components: { id, component_id, name, ... }
  selCompId:  null,
  selFuncId:  null,
};

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, { project, item, system, parentType, parentId }) {
  _ctx   = { project, parentType, parentId };
  _items = [];
  _selId = null;
  _chain = { components: [], functions: [], selCompId: null, selFuncId: null };

  const parentName = system?.name || item?.name || '';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>DFMEA</h1>
          <p class="page-subtitle">Design FMEA · VDA 2019 · ${esc(parentName)}</p>
        </div>
        <div class="dfmea-toolbar">
          <button class="dfmea-tb-btn" id="btn-dfmea-chain" title="Toggle Structure–Function–Failure chain">⬡ Chain</button>
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-dfmea-sync">⟳ Sync from System</button>
          <button class="btn btn-primary   btn-sm" id="btn-dfmea-new" >＋ New Row</button>
        </div>
      </div>
    </div>
    <div class="dfmea-layout" id="dfmea-layout">
      <div class="dfmea-table-area" id="dfmea-table-area">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>

      <!-- Chain panel — hidden by default, toggleable -->
      <div class="dfmea-bottom-panel" id="dfmea-chain-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-chain-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">⬡ Structure — Function — Failure Chain</span>
          <span class="dfmea-panel-hint">Click a component to explore its functions and failure modes</span>
          <button class="dfmea-tb-btn" id="dfmea-chain-close" title="Close">✕</button>
        </div>
        <div class="dfmea-chain-body" id="dfmea-chain-body">
          <div class="content-loading" style="padding:24px 0"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  wirePanelToggles();
  document.getElementById('btn-dfmea-new').onclick  = () => addRow();
  document.getElementById('btn-dfmea-sync').onclick = () => syncFromSystem();

  await Promise.all([loadItems(), loadChainData()]);
}

// ── Panel toggles & resize ────────────────────────────────────────────────────

function wirePanelToggles() {
  // Chain panel toggle button
  document.getElementById('btn-dfmea-chain')?.addEventListener('click', () => {
    togglePanel('dfmea-chain-panel', 'btn-dfmea-chain');
  });
  document.getElementById('dfmea-chain-close')?.addEventListener('click', () => {
    closePanel('dfmea-chain-panel', 'btn-dfmea-chain');
  });

  // Resize bar for chain panel
  wireResizeBar('dfmea-chain-resize', 'dfmea-chain-panel');
}

function togglePanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  document.getElementById(btnId)?.classList.toggle('active', opening);
}

function closePanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  if (panel) panel.style.display = 'none';
  document.getElementById(btnId)?.classList.remove('active');
}

function wireResizeBar(barId, panelId) {
  const bar   = document.getElementById(barId);
  const panel = document.getElementById(panelId);
  if (!bar || !panel) return;

  bar.addEventListener('mousedown', e => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    const onMove = mv => {
      panel.style.height = `${Math.max(120, startH - (mv.clientY - startY))}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Load items ────────────────────────────────────────────────────────────────

async function loadItems() {
  const tableArea = document.getElementById('dfmea-table-area');
  if (!tableArea) return;

  const { data, error } = await sb.from('dfmea_items')
    .select('*')
    .eq('parent_type', _ctx.parentType)
    .eq('parent_id',   _ctx.parentId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    tableArea.innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-danger)">
          <strong>Error loading dfmea_items:</strong><br>
          <code>${esc(error.message)}</code><br>
          <span style="font-size:11px;color:var(--color-text-muted)">code: ${esc(error.code || '—')}</span>
        </p>
        <p style="margin-top:8px;font-size:13px">
          Run <code>db/migration_dfmea.sql</code> in Supabase SQL Editor.
        </p>
      </div></div>`;
    return;
  }

  _items = data || [];
  renderTable(tableArea);
}

// ── Load architecture data for chain panel ────────────────────────────────────

async function loadChainData() {
  const [{ data: comps }, { data: fns }] = await Promise.all([
    sb.from('arch_components')
      .select('id,name,comp_type')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId)
      .order('sort_order', { ascending: true }),
    sb.from('arch_functions')
      .select('id,component_id,name,is_safety_related')
      .order('sort_order', { ascending: true }),
  ]);

  // Filter functions to only those belonging to our components
  const compIds = new Set((comps || []).map(c => c.id));
  _chain.components = comps || [];
  _chain.functions  = (fns || []).filter(f => compIds.has(f.component_id));

  renderChain();
}

// ── Table render ──────────────────────────────────────────────────────────────

function renderTable(tableArea) {
  if (!_items.length) {
    tableArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠</div>
        <h3>No DFMEA entries yet</h3>
        <p>Click <strong>＋ New Row</strong> to add manually, or <strong>⟳ Sync from System</strong> to auto-import from Architecture and FHA.</p>
      </div>`;
    return;
  }

  tableArea.innerHTML = `
    <div class="dfmea-table-wrap">
      <table class="dfmea-table">
        <thead>
          <tr>
            <th class="dfmea-col-id">ID</th>
            <th class="dfmea-col-comp">Structure Element</th>
            <th class="dfmea-col-func">Function</th>
            <th class="dfmea-col-fm">Failure Mode</th>
            <th class="dfmea-col-eff">Effect — Higher Level</th>
            <th class="dfmea-col-eff">Effect — Local</th>
            <th class="dfmea-col-fc">Failure Cause</th>
            <th class="dfmea-col-sod" title="Severity">S</th>
            <th class="dfmea-col-ctrl">Prevention Controls</th>
            <th class="dfmea-col-sod" title="Occurrence">O</th>
            <th class="dfmea-col-ctrl">Detection Controls</th>
            <th class="dfmea-col-sod" title="Detection">D</th>
            <th class="dfmea-col-ap"  title="Action Priority">AP</th>
            <th class="dfmea-col-actions">Recommended Actions</th>
            <th class="dfmea-col-resp">Responsible</th>
            <th class="dfmea-col-date">Target Date</th>
            <th class="dfmea-col-astatus">Action Status</th>
            <th class="dfmea-col-status">Status</th>
            <th class="dfmea-col-del"></th>
          </tr>
        </thead>
        <tbody id="dfmea-tbody"></tbody>
      </table>
    </div>`;

  const tbody = document.getElementById('dfmea-tbody');
  _items.forEach(it => appendRow(tbody, it));
}

function appendRow(tbody, it) {
  const tr = buildRowEl(it);
  tbody.appendChild(tr);
  wireRow(tr, it);
}

function buildRowEl(it) {
  const tr = document.createElement('tr');
  tr.dataset.id = it.id;
  tr.className  = `dfmea-row${_selId === it.id ? ' selected' : ''}`;
  tr.innerHTML  = rowHTML(it);
  return tr;
}

function rowHTML(it) {
  const ap    = calcAP(it.severity, it.occurrence, it.detection);
  const apClr = AP_COLORS[ap] || '#9AA0A6';
  return `
    <td class="dfmea-col-id code-cell">${esc(it.dfmea_code)}</td>
    <td class="dfmea-col-comp dfmea-editable" data-field="component_name">${cellText(it.component_name)}</td>
    <td class="dfmea-col-func dfmea-editable" data-field="function_name">${cellText(it.function_name)}</td>
    <td class="dfmea-col-fm   dfmea-editable" data-field="failure_mode">${cellText(it.failure_mode)}</td>
    <td class="dfmea-col-eff  dfmea-editable" data-field="effect_higher">${cellText(it.effect_higher)}</td>
    <td class="dfmea-col-eff  dfmea-editable" data-field="effect_local">${cellText(it.effect_local)}</td>
    <td class="dfmea-col-fc   dfmea-editable" data-field="failure_cause">${cellText(it.failure_cause)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.severity}"   data-field="severity">
    </td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="prevention_controls">${cellText(it.prevention_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.occurrence}" data-field="occurrence">
    </td>
    <td class="dfmea-col-ctrl dfmea-editable" data-field="detection_controls">${cellText(it.detection_controls)}</td>
    <td class="dfmea-col-sod">
      <input class="dfmea-sod-input" type="number" min="1" max="10" value="${it.detection}"  data-field="detection">
    </td>
    <td class="dfmea-col-ap">
      <span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>
    </td>
    <td class="dfmea-col-actions dfmea-editable" data-field="actions">${cellText(it.actions)}</td>
    <td class="dfmea-col-resp   dfmea-editable" data-field="responsible">${cellText(it.responsible)}</td>
    <td class="dfmea-col-date   dfmea-editable" data-field="target_date">${cellText(it.target_date)}</td>
    <td class="dfmea-col-astatus">
      <select class="dfmea-sel" data-field="action_status">
        ${ACTION_STATUSES.map(s => `<option value="${s}" ${it.action_status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-col-status">
      <select class="dfmea-sel" data-field="status">
        ${ITEM_STATUSES.map(s => `<option value="${s}" ${it.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </td>
    <td class="dfmea-col-del">
      <button class="btn btn-ghost btn-xs dfmea-del-btn" title="Delete" style="color:var(--color-danger)">✕</button>
    </td>
  `;
}

function cellText(val) {
  if (!val) return `<span class="dfmea-placeholder">—</span>`;
  return `<span class="dfmea-cell-text">${esc(val)}</span>`;
}

// ── Row wiring ────────────────────────────────────────────────────────────────

function wireRow(tr, it) {
  // Click row → select + highlight chain
  tr.addEventListener('click', e => {
    if (e.target.closest('input,select,button')) return;
    selectRow(it.id);
  });

  // Text cells — double-click to edit
  tr.querySelectorAll('.dfmea-editable').forEach(td => {
    const field = td.dataset.field;

    td.addEventListener('dblclick', () => {
      if (td.querySelector('textarea')) return;
      const cur = it[field] || '';
      td.innerHTML = `<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea>`;
      const ta = td.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      ta.addEventListener('blur', async () => {
        const newVal = ta.value.trim();
        td.innerHTML = cellText(newVal);
        if (newVal === (it[field] || '')) return;
        it[field] = newVal;
        await autosave(it.id, { [field]: newVal });
        // Refresh chain if component/function name changed
        if (field === 'component_name' || field === 'function_name') renderChain();
      });

      ta.addEventListener('keydown', e => {
        if (e.key === 'Escape') { td.innerHTML = cellText(it[field] || ''); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
      });
    });
  });

  // S/O/D numeric inputs
  tr.querySelectorAll('.dfmea-sod-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const field = inp.dataset.field;
      const val   = Math.min(10, Math.max(1, +inp.value || 5));
      inp.value = val;
      it[field] = val;
      await autosave(it.id, { [field]: val });
      // Refresh AP badge
      const apCell = tr.querySelector('.dfmea-col-ap');
      if (apCell) {
        const ap    = calcAP(it.severity, it.occurrence, it.detection);
        const apClr = AP_COLORS[ap] || '#9AA0A6';
        apCell.innerHTML = `<span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>`;
      }
    });
  });

  // Select fields
  tr.querySelectorAll('.dfmea-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      it[field] = sel.value;
      await autosave(it.id, { [field]: sel.value });
    });
  });

  // Delete button
  tr.querySelector('.dfmea-del-btn').addEventListener('click', () => deleteRow(it));
}

// ── Row selection ─────────────────────────────────────────────────────────────

function selectRow(id) {
  _selId = id;
  document.querySelectorAll('.dfmea-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.id === id);
  });
  // Sync chain selection to the component of this row
  const it = _items.find(i => i.id === id);
  if (it?.component_id) {
    _chain.selCompId = it.component_id;
    _chain.selFuncId = null;
    renderChain();
  }
}

// ── Chain panel ───────────────────────────────────────────────────────────────

function renderChain() {
  const body = document.getElementById('dfmea-chain-body');
  if (!body) return;

  const comps = _chain.components;
  const fns   = _chain.functions;

  // Functions for selected component
  const selFns = _chain.selCompId
    ? fns.filter(f => f.component_id === _chain.selCompId)
    : [];

  // Failure modes from DFMEA items for selected function
  const selFMs = _chain.selFuncId
    ? _items.filter(it => it.function_name === selFns.find(f => f.id === _chain.selFuncId)?.name
                        || it.component_id  === _chain.selCompId)
            .filter(it => {
              const fn = selFns.find(f => f.id === _chain.selFuncId);
              return fn && it.function_name === fn.name;
            })
    : (_chain.selCompId
        ? _items.filter(it => it.component_id === _chain.selCompId || it.component_name === comps.find(c=>c.id===_chain.selCompId)?.name)
        : []);

  body.innerHTML = `
    <div class="dfmea-chain">
      <!-- Column 1: Structure Elements -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⬡</span> Structure Element
        </div>
        <div class="dfmea-chain-cards" id="chain-col-comp">
          ${comps.length
            ? comps.map(c => `
              <div class="dfmea-chain-card ${_chain.selCompId===c.id?'active':''}"
                   data-comp-id="${c.id}">
                <div class="dfmea-chain-card-type">${esc(c.comp_type || '')}</div>
                <div class="dfmea-chain-card-name">${esc(c.name)}</div>
                <div class="dfmea-chain-card-count">${countItems('component', c)}</div>
              </div>`).join('')
            : '<div class="dfmea-chain-empty">No components in Architecture Concept.<br>Add components there first.</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <!-- Column 2: Functions -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⚙</span> Function
        </div>
        <div class="dfmea-chain-cards" id="chain-col-func">
          ${!_chain.selCompId
            ? '<div class="dfmea-chain-empty">← Select a component</div>'
            : selFns.length
              ? selFns.map(f => `
                <div class="dfmea-chain-card ${_chain.selFuncId===f.id?'active':''} ${f.is_safety_related?'safety':''}
                     data-func-id="${f.id}">
                  ${f.is_safety_related ? '<span class="dfmea-chain-safety-tag">Safety</span>' : ''}
                  <div class="dfmea-chain-card-name">${esc(f.name)}</div>
                  <div class="dfmea-chain-card-count">${countFMsForFunc(f)} FM</div>
                </div>`).join('')
              : '<div class="dfmea-chain-empty">No functions for this component</div>'
          }
        </div>
      </div>

      <div class="dfmea-chain-arrow">▶</div>

      <!-- Column 3: Failure Modes -->
      <div class="dfmea-chain-col">
        <div class="dfmea-chain-col-hdr">
          <span class="dfmea-chain-col-icon">⚠</span> Failure Mode
        </div>
        <div class="dfmea-chain-cards" id="chain-col-fm">
          ${!_chain.selCompId
            ? '<div class="dfmea-chain-empty">← Select a component</div>'
            : !_chain.selFuncId
              ? '<div class="dfmea-chain-empty">← Select a function</div>'
              : selFMs.length
                ? selFMs.map(it => {
                    const ap    = calcAP(it.severity, it.occurrence, it.detection);
                    const apClr = AP_COLORS[ap] || '#9AA0A6';
                    return `
                    <div class="dfmea-chain-card fm-card ${_selId===it.id?'active':''}"
                         data-dfmea-id="${it.id}">
                      <div class="dfmea-chain-card-name">${esc(it.failure_mode || '—')}</div>
                      <div class="dfmea-chain-card-meta">
                        <span>S:${it.severity} O:${it.occurrence} D:${it.detection}</span>
                        <span class="dfmea-ap-badge sm" style="background:${apClr}">${ap}</span>
                      </div>
                    </div>`;
                  }).join('')
                : '<div class="dfmea-chain-empty">No failure modes yet for this function</div>'
          }
        </div>
      </div>
    </div>
  `;

  // Wire component cards
  body.querySelectorAll('[data-comp-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selCompId = el.dataset.compId;
      _chain.selFuncId = null;
      renderChain();
    });
  });

  // Wire function cards
  body.querySelectorAll('[data-func-id]').forEach(el => {
    el.addEventListener('click', () => {
      _chain.selFuncId = el.dataset.funcId;
      renderChain();
    });
  });

  // Wire failure mode cards → select table row
  body.querySelectorAll('[data-dfmea-id]').forEach(el => {
    el.addEventListener('click', () => {
      selectRow(el.dataset.dfmeaId);
      // Scroll table row into view
      const tr = document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`);
      tr?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}

function countItems(type, comp) {
  const n = _items.filter(it =>
    it.component_id === comp.id || it.component_name === comp.name
  ).length;
  return n ? `${n} FM` : '';
}

function countFMsForFunc(fn) {
  return _items.filter(it => it.function_name === fn.name).length;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addRow(prefill = {}) {
  const idx  = await nextIndex('dfmea_items', { parent_id: _ctx.parentId });
  const code = buildCode('DFM', {
    domain:      _ctx.parentType === 'item' ? 'ITEM' : 'SYS',
    projectName: _ctx.project.name,
    index:       idx,
  });

  const payload = {
    dfmea_code:   code,
    parent_type:  _ctx.parentType,
    parent_id:    _ctx.parentId,
    project_id:   _ctx.project.id,
    sort_order:   _items.length,
    severity:     5,
    occurrence:   5,
    detection:    5,
    action_status:'open',
    status:       'draft',
    ...prefill,
  };

  const { data: newItem, error } = await sb.from('dfmea_items').insert(payload).select().single();
  if (error) { toast('Error creating DFMEA row.', 'error'); return null; }

  _items.push(newItem);

  const tableArea = document.getElementById('dfmea-table-area');
  if (!document.getElementById('dfmea-tbody')) {
    renderTable(tableArea);
  } else {
    const tbody = document.getElementById('dfmea-tbody');
    appendRow(tbody, newItem);
    // Focus first editable cell
    const tr = document.querySelector(`.dfmea-row[data-id="${newItem.id}"]`);
    tr?.querySelector('.dfmea-editable')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  renderChain();
  return newItem;
}

async function deleteRow(it) {
  if (!confirm(`Delete DFMEA entry "${it.dfmea_code}"?`)) return;
  const { error } = await sb.from('dfmea_items').delete().eq('id', it.id);
  if (error) { toast('Error deleting.', 'error'); return; }

  _items = _items.filter(i => i.id !== it.id);
  document.querySelector(`.dfmea-row[data-id="${it.id}"]`)?.remove();

  if (!_items.length) {
    renderTable(document.getElementById('dfmea-table-area'));
  }
  renderChain();
  toast('Entry deleted.', 'success');
}

async function autosave(id, fields) {
  const { error } = await sb.from('dfmea_items')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) toast('Autosave failed.', 'error');
}

// ── Sync from System (Architecture + FHA) ────────────────────────────────────

async function syncFromSystem() {
  const btn = document.getElementById('btn-dfmea-sync');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Syncing…'; }

  try {
    // 1. Load arch_components
    const { data: comps } = await sb.from('arch_components')
      .select('id,name,comp_type')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId);

    if (!comps?.length) {
      toast('No components found in Architecture Concept. Add components there first.', 'warning');
      return;
    }

    const compIds = comps.map(c => c.id);

    // 2. Load arch_functions for those components
    const { data: archFns } = await sb.from('arch_functions')
      .select('id,component_id,name,function_ref_id,is_safety_related')
      .in('component_id', compIds);

    // 3. Load FHA hazards for this parent
    const { data: hazards } = await sb.from('hazards')
      .select('id,data,function_id,status')
      .eq('parent_type', _ctx.parentType)
      .eq('parent_id',   _ctx.parentId)
      .eq('analysis_type', 'FHA');

    // 4. Load functions table (for name matching)
    let fnRefs = {};
    if (hazards?.some(h => h.function_id)) {
      const fnIds = [...new Set(hazards.filter(h => h.function_id).map(h => h.function_id))];
      const { data: fns } = await sb.from('functions').select('id,name').in('id', fnIds);
      (fns || []).forEach(f => { fnRefs[f.id] = f; });
    }

    // 5. Build set of already-imported hazard IDs
    const importedHazIds = new Set(_items.filter(i => i.hazard_id).map(i => i.hazard_id));

    let created = 0;

    // 6. For each hazard, find matching arch_function via function_ref_id or name
    for (const haz of (hazards || [])) {
      if (importedHazIds.has(haz.id)) continue; // already synced

      const d   = haz.data || {};
      // FHA mapping → DFMEA:
      //   failure_condition (FC) → effect_local  (local failure effect)
      //   effect_system          → effect_higher (system-level effect)
      //   effect_local           → failure_cause (contributing cause)
      //   failure_mode           left blank (to be filled manually per VDA)
      const efL  = d.failure_condition || '';
      const efH  = d.effect_system     || d.effect || '';
      const fcause = d.effect_local    || '';

      // Try to match arch_function
      let matchedComp = null;
      let matchedFn   = null;

      if (haz.function_id) {
        const fnRef = fnRefs[haz.function_id];
        if (fnRef) {
          // Find arch_function by function_ref_id or by name
          matchedFn   = (archFns || []).find(af => af.function_ref_id === haz.function_id
                                               || af.name === fnRef.name);
          if (matchedFn) {
            matchedComp = comps.find(c => c.id === matchedFn.component_id);
          }
        }
      }

      const prefill = {
        component_id:    matchedComp?.id   || null,
        component_name:  matchedComp?.name || '',
        function_name:   matchedFn?.name   || (fnRefs[haz.function_id]?.name || ''),
        failure_mode:    '',      // to be filled manually in DFMEA
        effect_higher:   efH,
        effect_local:    efL,
        failure_cause:   fcause,
        hazard_id:       haz.id,
      };

      await addRow(prefill);
      created++;
    }

    // 7. Also create skeleton rows for components/functions with no FHA link
    for (const comp of comps) {
      const compFns = (archFns || []).filter(f => f.component_id === comp.id);
      for (const fn of compFns) {
        // Check if a row already exists for this component+function with no hazard
        const exists = _items.some(it => it.component_id === comp.id && it.function_name === fn.name);
        if (!exists) {
          await addRow({
            component_id:   comp.id,
            component_name: comp.name,
            function_name:  fn.name,
          });
          created++;
        }
      }
    }

    if (created > 0) {
      toast(`Synced ${created} new row(s) from Architecture & FHA.`, 'success');
    } else {
      toast('Everything already up to date — no new rows added.', 'info');
    }
  } catch (e) {
    toast('Sync error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sync from System'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
