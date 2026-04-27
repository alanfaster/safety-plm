import { sb, buildCode, nextIndex } from '../config.js';
import { t } from '../i18n/index.js';
import { showModal, hideModal } from '../components/modal.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';
import { loadColConfig, saveColConfig, wireColMgr } from '../components/col-mgr.js';
import { copyElementLink, scrollToAnchor } from '../deep-link.js';
import { VMODEL_NODES, PHASE_DB_SOURCE } from '../components/vmodel-editor.js';
import { buildFilterRowHTML, applyColFilters, wireColFilterIcons } from '../components/col-filter.js';

const REQ_TYPES      = ['functional','performance','safety','safety-independency','interface','constraint'];
const REQ_STATUSES   = ['draft','review','approved','deprecated'];
const REQ_PRIORITIES = ['critical','high','medium','low'];
const ASIL_LEVELS    = ['QM','ASIL-A','ASIL-B','ASIL-C','ASIL-D'];
const DAL_LEVELS     = ['DAL-E','DAL-D','DAL-C','DAL-B','DAL-A'];

const REQ_BUILTIN_COLS = [
  { id: 'drag',             name: '',                 fixed: true,  visible: true },
  { id: 'code',             name: 'Code',             fixed: true,  visible: true },
  { id: 'title',            name: 'Title',            fixed: true,  visible: true },
  { id: 'type',             name: 'Type',             visible: true },
  { id: 'priority',         name: 'Priority',         visible: true },
  { id: 'status',           name: 'Status',           visible: true },
  { id: 'asil',             name: 'ASIL',             visible: true, projectTypes: ['automotive'] },
  { id: 'dal',              name: 'DAL',              visible: true, projectTypes: ['aerospace','military'] },
  { id: 'verification',     name: 'Verification',     visible: true },
  { id: 'system_component', name: 'System Component', visible: true, parentTypes: ['item'] },
  { id: 'target_domain',    name: 'Target Domain',    visible: true, parentTypes: ['system'] },
  { id: 'actions',          name: '',                 fixed: true,  visible: true },
];

// ── Module-level state ────────────────────────────────────────────────────────
let _ctx        = null;  // { project, item, system, parentType, parentId, typeFilter, pageId, domain }
let _data       = [];    // all rows in order (requirements + title/info structural)
let _cols       = [];
let _builtins   = REQ_BUILTIN_COLS;
let _collapsed  = new Set();
let _colKey     = '';
let _showAsil   = false;
let _showDal    = false;
let _traceFields   = [];   // derived from vmodel_links for this node
let _traceData     = {};   // { [nodeId]: [{code, label}] } — cached lookup data
let _tracePanelId  = null; // currently open req id in trace panel
let _colFilters    = {};   // { [colId]: string } — active column filter values
let _systems       = [];   // systems for the current item (used by system_component column)

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderRequirements(container, { project, item, system, parentType, parentId, domain = null, pageId = null }) {
  // Resolve sub-page filter
  let typeFilter = null;
  let subPageName = null;
  if (pageId) {
    const { data: pg } = await sb.from('nav_pages').select('name').eq('id', pageId).maybeSingle();
    if (pg) {
      subPageName = pg.name;
      if (pg.name.toLowerCase().includes('interface')) typeFilter = ['interface'];
      else if (pg.name.toLowerCase().includes('safety')) typeFilter = ['safety', 'safety-independency'];
    }
  }

  // Normalise domain key: system-level pages use the actual domain ('system','sw','hw','mech')
  // item-level pages use 'item'
  const domainKey = parentType === 'system' ? (domain || 'system') : 'item';
  _ctx = { project, item, system, parentType, parentId, typeFilter, pageId, domain: domainKey };
  _data          = [];
  _traceFields   = [];
  _traceData     = {};
  _tracePanelId  = null;
  _colFilters    = {};
  _collapsed   = new Set(JSON.parse(sessionStorage.getItem(`req_collapsed_${parentId}`) || '[]'));
  _showAsil    = project.type === 'automotive';
  _showDal     = project.type === 'aerospace' || project.type === 'military';

  // Load vmodel config and derive traceability fields for this node
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const vmodelLinks = pcRow?.config?.vmodel_links || [];
  _traceFields = deriveReqTraceFields(domainKey, vmodelLinks);
  await loadReqTraceSourceData(item, system);

  document.getElementById('req-insert-pill')?.remove();

  const baseTitle  = t('vcycle.requirements');
  const pageTitle  = subPageName || baseTitle;
  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${pageTitle}</h1>
          <p class="text-muted">${esc(parentName)}</p>
        </div>
        <div></div>
      </div>
      ${!typeFilter ? `
      <div class="page-tabs">
        <button class="page-tab active" data-tab="list">All Requirements</button>
        <button class="page-tab" data-tab="matrix">Traceability</button>
      </div>` : ''}
    </div>
    <div class="page-body spec-page-body" id="req-outer">
      <nav class="spec-nav" id="req-nav">
        <button class="spec-nav-expand" id="req-nav-expand" title="Open navigation">
          <span>❯</span>
          <span class="spec-nav-rail-label">Contents</span>
        </button>
        <div class="spec-nav-hdr">
          <span class="spec-nav-title">Contents</span>
          <button class="btn-icon spec-nav-close" id="req-nav-close" title="Close">✕</button>
        </div>
        <div class="spec-nav-tree" id="req-nav-tree"></div>
      </nav>
      <div class="spec-content" id="req-body">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <aside class="req-trace-panel" id="req-trace-panel">
        <div class="req-trace-panel-hdr">
          <span class="req-trace-panel-title">Traceability</span>
          <button class="btn-icon" id="req-trace-panel-close" title="Close">✕</button>
        </div>
        <div class="req-trace-panel-body" id="req-trace-panel-body">
          <p style="padding:16px;font-size:13px;color:var(--color-text-muted)">
            Click 🔗 on any requirement to view its V-Model trace links.
          </p>
        </div>
      </aside>
    </div>
    <div class="spec-fab" id="req-fab">
      <button class="btn btn-primary"   id="btn-new-req">＋ ${t('req.new')}</button>
      <button class="btn btn-secondary" id="btn-new-section">＋ Section</button>
    </div>
  `;

  document.getElementById('btn-new-req').onclick = () =>
    openReqModal({ project, parentType, parentId, projectType: project.type,
      defaultType: Array.isArray(typeFilter) ? typeFilter[0] : undefined });
  document.getElementById('btn-new-section').onclick    = () => addReqSection(null);
  document.getElementById('req-nav-close').onclick      = () => toggleReqNav(false);
  document.getElementById('req-nav-expand').onclick     = () => toggleReqNav(true);
  document.getElementById('req-trace-panel-close').onclick = () => closeTracePanel();

  if (!typeFilter) {
    container.querySelectorAll('.page-tab').forEach(tab => {
      tab.onclick = () => {
        container.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isMatrix = tab.dataset.tab === 'matrix';
        document.getElementById('req-nav')?.classList.toggle('spec-nav--hidden', isMatrix);
        const fab = document.getElementById('req-fab');
        if (fab) fab.style.display = isMatrix ? 'none' : '';
        if (isMatrix) renderTraceability();
        else loadData();
      };
    });
  }

  await loadData();
  applyGotoTarget();
}

function applyGotoTarget() {
  const raw = sessionStorage.getItem('tdb_goto');
  if (!raw) return;
  try {
    const { code } = JSON.parse(raw);
    sessionStorage.removeItem('tdb_goto');
    if (!code) return;
    // Wait for table to render, then find and open the row
    setTimeout(() => {
      const row = document.querySelector(`tr[data-rid]`);
      if (!row) return;
      // Find the req whose req_code matches
      const req = _data.find(r => r.req_code === code);
      if (req) {
        const tr = document.querySelector(`tr[data-rid="${req.id}"]`);
        if (tr) {
          tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          tr.classList.add('req-row--goto-highlight');
          setTimeout(() => tr.classList.remove('req-row--goto-highlight'), 5000);
        }
        openTracePanel(req.id, true);
      }
    }, 400);
  } catch {}
}

// ── Nav helpers ───────────────────────────────────────────────────────────────

function toggleReqNav(open) {
  const nav = document.getElementById('req-nav');
  if (!nav) return;
  if (open === undefined) nav.classList.toggle('spec-nav--hidden');
  else if (open) nav.classList.remove('spec-nav--hidden');
  else nav.classList.add('spec-nav--hidden');
}

function buildReqNavTree() {
  const tree = document.getElementById('req-nav-tree');
  if (!tree) return;
  const nums = computeReqSectionNumbers();
  const titleRows = _data.filter(r => r.type === 'title');
  if (!titleRows.length) {
    tree.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--color-text-muted)">No sections yet</div>`;
    return;
  }
  tree.innerHTML = titleRows.map(r => {
    const lvl = r.level || 1;
    const num = nums[r.id] ? `<span class="spec-nav-num">${esc(nums[r.id])}</span> ` : '';
    return `<div class="spec-nav-item spec-nav-item--l${lvl}" data-rid="${r.id}" title="${esc(r.title || '')}">${num}${esc(r.title || 'Untitled')}</div>`;
  }).join('');
  tree.querySelectorAll('.spec-nav-item').forEach(btn => {
    btn.onclick = () => {
      const tr = document.querySelector(`tr[data-rid="${btn.dataset.rid}"]`);
      if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function computeReqSectionNumbers() {
  const counters = [0, 0, 0];
  const map = {};
  for (const r of _data) {
    if (r.type !== 'title') continue;
    const lvl = (r.level || 1) - 1; // 0-based
    counters[lvl]++;
    for (let i = lvl + 1; i < 3; i++) counters[i] = 0;
    map[r.id] = counters.slice(0, lvl + 1).join('.');
  }
  return map;
}

// ── Data load & render ────────────────────────────────────────────────────────

async function loadData() {
  const { project, item, system, parentType, parentId, typeFilter, pageId, domain: domainKey } = _ctx;
  const excludeInterface = typeFilter == null;

  const base = () => {
    return sb.from('requirements').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', domainKey);
  };

  let contentQ = base();
  if (Array.isArray(typeFilter) && typeFilter.length) contentQ = contentQ.in('type', typeFilter);
  else if (typeFilter)       contentQ = contentQ.eq('type', typeFilter);
  else if (excludeInterface) contentQ = contentQ.not('type', 'in', '("interface","safety-independency","title","info")');
  else                       contentQ = contentQ.not('type', 'in', '("title","info")');

  let structQ = base().in('type', ['title', 'info']);
  if (pageId) structQ = structQ.eq('page_id', pageId);
  else        structQ = structQ.is('page_id', null);

  const [{ data: content, error: e1 }, { data: structural, error: e2 }] =
    await Promise.all([
      contentQ.order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      structQ .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ]);

  const body = document.getElementById('req-body');
  if (!body) return;
  if (e1 || e2) { body.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  _data = [...(content || []), ...(structural || [])].sort((a, b) =>
    a.sort_order !== b.sort_order
      ? a.sort_order - b.sort_order
      : new Date(a.created_at) - new Date(b.created_at)
  );
  _data.forEach((r, i) => { if (!r.sort_order) r.sort_order = i; });

  // Load custom cols from project_config
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const projectCustomCols = (pcRow?.config?.req_custom_cols || [])
    .map(c => ({ ...c, custom: true, visible: true }));

  // Load systems for system_component column (item-level pages only)
  if (parentType === 'item') {
    const { data: sysData } = await sb.from('systems')
      .select('id, name').eq('item_id', item.id).order('created_at', { ascending: true });
    _systems = sysData || [];
  } else {
    _systems = [];
  }

  _colKey   = pageId ? `req_${parentId}_${pageId}` : `req_${parentId}`;
  _builtins = [
    ...REQ_BUILTIN_COLS.filter(c => {
      if (c.projectTypes && !c.projectTypes.includes(project.type)) return false;
      if (c.parentTypes && !c.parentTypes.includes(parentType)) return false;
      return true;
    }),
    ...projectCustomCols,
  ];
  _cols = loadColConfig(_colKey, _builtins);

  renderTable(body);
  buildReqNavTree();
}

function renderTable(body) {
  if (!body) return;

  if (!_data.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <h3>No requirements yet</h3>
        <p>Click <strong>＋ ${t('req.new')}</strong> to add the first requirement.</p>
      </div>`;
    return;
  }

  const visCols = _cols.filter(c => c.visible);
  const { project, item, system, parentType, parentId, typeFilter } = _ctx;

  const SKIP_FILTER  = new Set(['drag', 'actions']);
  const COL_OPTIONS  = {
    type:     REQ_TYPES,
    priority: REQ_PRIORITIES,
    status:   REQ_STATUSES,
    asil:     ASIL_LEVELS,
    dal:      DAL_LEVELS,
  };
  const filterRowHTML = buildFilterRowHTML(visCols, SKIP_FILTER, COL_OPTIONS);

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table req-reorder-table" id="req-table">
          <thead>
            <tr id="req-thead-row">
              ${visCols.map(c => reqTh(c)).join('')}
            </tr>
            ${filterRowHTML}
          </thead>
          <tbody id="req-tbody">
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = document.getElementById('req-tbody');

  // Delegate multi-select toggle clicks for system_component / target_domain
  wireMultiselCells(tbody);

  function reqFilterValue(r, colId) {
    switch (colId) {
      case 'code':         return r.req_code || '';
      case 'title':        return r.title || '';
      case 'type':         return r.type || '';
      case 'priority':     return r.priority || '';
      case 'status':       return r.status || '';
      case 'asil':         return r.asil || '';
      case 'dal':          return r.dal || '';
      case 'verification': return r.verification_criteria || '';
      default:             return r.custom_fields?.[colId] || '';
    }
  }

  function rerenderTbody() {
    const filtered = applyColFilters(
      _data.filter(r => r.type !== 'title' && r.type !== 'info'),
      _colFilters,
      reqFilterValue
    );
    // Keep structural rows (title/info) always visible; filter only data rows
    const visibleIds = new Set(filtered.map(r => r.id));
    tbody.innerHTML = '';
    _data.forEach(r => {
      if (r.type === 'title' || r.type === 'info' || visibleIds.has(r.id)) {
        appendReqRow(tbody, r);
      }
    });
    applyCollapseState(tbody);
    wireAllRows(tbody);
    wireReqDragDrop(tbody);
    const customCols = visCols.filter(c => c.custom);
    if (customCols.length) wireCustomCols(tbody);
    wireInsertHover(tbody);
  }

  rerenderTbody();

  // Wire filter icons into column headers
  const theadEl = body.querySelector('#req-table thead');
  wireColFilterIcons(theadEl, _colFilters, () => rerenderTbody(), SKIP_FILTER);

  // Column manager
  const tableEl  = body.querySelector('#req-table');
  const theadRow = body.querySelector('#req-thead-row');
  if (tableEl && theadRow) {
    wireColMgr(theadRow, tableEl, _colKey, _cols, (updatedCols) => {
      _cols = updatedCols;
      renderTable(body);
    });
  }

  scrollToAnchor();
}

// ── Row building ──────────────────────────────────────────────────────────────

function appendReqRow(tbody, r) {
  const tr = document.createElement('tr');
  tr.dataset.rid = r.id;
  tr.dataset.sortOrder = r.sort_order ?? 0;
  if (r.type === 'title') {
    tr.className = 'req-section-row spec-section-row';
    tr.innerHTML = reqSectionRowHTML(r);
  } else if (r.type === 'info') {
    tr.className = 'req-info-row';
    tr.draggable = true;
    tr.innerHTML = infoRowHTML(r);
  } else {
    tr.className = '';
    tr.draggable = true;
    tr.id = `req-${r.id}`;
    const visCols = _cols.filter(c => c.visible);
    tr.innerHTML = visCols.map(c => reqTd(c, r)).join('');
  }
  tbody.appendChild(tr);
}

function reqSectionRowHTML(r) {
  const lvl       = r.level || 1;
  const collapsed = _collapsed.has(r.id);
  const nums      = computeReqSectionNumbers();
  const num       = nums[r.id] || '';
  return `
    <td class="spec-section-cell" colspan="20">
      <div class="spec-section-inner spec-section-inner--l${lvl}">
        <button class="spec-section-toggle${collapsed ? ' collapsed' : ''}"
          data-rid="${r.id}" title="Expand/Collapse">▼</button>
        <span class="spec-section-num spec-section-num--l${lvl}">${esc(num)}</span>
        <input class="spec-section-title spec-section-title--l${lvl}"
          value="${esc(r.title || '')}" placeholder="Section title…" />
        <div class="spec-section-actions">
          <button class="btn btn-ghost btn-xs req-sec-level-up"
            title="Promote to H${Math.max((lvl),1)}">◀</button>
          <button class="btn btn-ghost btn-xs req-sec-level-dn"
            title="Demote to H${Math.min((lvl+1),3)}">▶</button>
          <span style="width:1px;height:14px;background:var(--color-border);display:inline-block;margin:0 2px"></span>
          <button class="btn btn-ghost btn-xs req-sec-move-up" title="Move section up (with contents)">↑</button>
          <button class="btn btn-ghost btn-xs req-sec-move-dn" title="Move section down (with contents)">↓</button>
          <button class="btn btn-ghost btn-xs req-sec-del"
            style="color:var(--color-danger)" title="Delete section">✕</button>
        </div>
      </div>
    </td>
  `;
}

function infoRowHTML(r) {
  return `
    <td class="req-drag-handle" title="Drag to reorder">⠿</td>
    <td colspan="100" style="padding:6px 8px 6px 20px;background:#fafbfc;border-bottom:1px solid #eee">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="color:#aaa;font-size:11px;margin-top:2px">ℹ</span>
        <span class="req-editable req-title-cell" data-rid="${r.id}" data-field="title"
          style="font-size:13px;color:#555;flex:1;font-style:italic">${esc(r.title || 'Info text...')}</span>
        <button class="btn btn-ghost btn-xs req-info-del" data-id="${r.id}"
          style="color:var(--color-danger);font-size:10px">✕</button>
      </div>
    </td>
  `;
}

// ── Wire all rows after render ────────────────────────────────────────────────

function wireAllRows(tbody) {
  const { project, item, system, parentType, parentId, typeFilter } = _ctx;

  // Section rows
  tbody.querySelectorAll('.req-section-row').forEach(tr => {
    wireReqSectionRow(tr);
  });

  // Info row delete
  tbody.querySelectorAll('.req-info-del').forEach(btn => {
    btn.onclick = async () => {
      await sb.from('requirements').delete().eq('id', btn.dataset.id);
      _data.splice(_data.findIndex(r => r.id === btn.dataset.id), 1);
      tr_of(btn)?.remove();
      buildReqNavTree();
      toast('Deleted.', 'success');
    };
  });

  // Inline selects (type, priority, status, asil, dal, verification)
  tbody.querySelectorAll('.req-inline-sel').forEach(sel => {
    sel.addEventListener('mouseenter', () => { sel.style.borderColor = '#ccc'; });
    sel.addEventListener('mouseleave', () => { if (document.activeElement !== sel) sel.style.borderColor = 'transparent'; });
    sel.addEventListener('focus',      () => { sel.style.borderColor = '#1A73E8'; sel.style.background = '#fff'; });
    sel.addEventListener('blur',       () => { sel.style.borderColor = 'transparent'; sel.style.background = 'transparent'; });
    sel.addEventListener('change', async () => {
      const r = _data.find(r => r.id === sel.dataset.rid);
      const { error } = await sb.from('requirements')
        .update({ [sel.dataset.field]: sel.value || null, updated_at: new Date().toISOString() })
        .eq('id', sel.dataset.rid);
      if (error) { toast(t('common.error'), 'error'); return; }
      if (r) r[sel.dataset.field] = sel.value;
      toast('Saved.', 'success');
    });
  });

  // Inline editable cells (title, description)
  wireEditableCells(tbody);

  // DFA links
  tbody.querySelectorAll('.req-dfa-link').forEach(btn => {
    btn.onclick = () => {
      sessionStorage.setItem('dfa_target_req', btn.dataset.id);
      navigate(dfaUrl(project, item, system));
    };
  });

  // Move up/down arrows (non-section rows)
  tbody.querySelectorAll('.btn-move-up, .btn-move-dn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dir = btn.classList.contains('btn-move-up') ? -1 : 1;
      moveReq(btn.dataset.id, dir, tbody);
    });
  });

  // Traceability panel
  tbody.querySelectorAll('.btn-trace-req').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openTracePanel(btn.dataset.id); };
  });

  // Detail/view modal
  tbody.querySelectorAll('.btn-view-req').forEach(btn => {
    btn.onclick = () => openReqModal({
      project, parentType, parentId, projectType: project.type,
      existing: _data.find(r => r.id === btn.dataset.id),
    });
  });

  // Copy link
  tbody.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      copyElementLink(`req-${btn.dataset.id}`);
    };
  });

  // Delete requirement (with connection check)
  tbody.querySelectorAll('.btn-del-req').forEach(btn => {
    btn.onclick = async () => {
      const req = _data.find(r => r.id === btn.dataset.id);
      if (!req) return;
      await handleReqDelete(req);
    };
  });
}

function wireEditableCells(root) {
  root.querySelectorAll('.req-editable').forEach(cell => {
    cell.style.cursor = 'text';
    cell.style.borderRadius = '3px';
    cell.style.padding = '1px 3px';
    cell.style.transition = 'background .15s';
    cell.addEventListener('mouseenter', () => { cell.style.background = '#f4f5f7'; });
    cell.addEventListener('mouseleave', () => { if (!cell.classList.contains('editing')) cell.style.background = ''; });
    cell.addEventListener('click', () => {
      if (cell.classList.contains('editing')) return;
      cell.classList.add('editing');
      const field = cell.dataset.field;
      const rid   = cell.dataset.rid;
      const r     = _data.find(r => r.id === rid);
      const cur   = r?.[field] || '';
      cell.style.background = '#EEF4FF';
      const isMulti = field === 'description';
      const inp = document.createElement(isMulti ? 'textarea' : 'input');
      inp.value = cur;
      inp.style.cssText = `width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:${isMulti?'12':'13'}px;font-family:inherit;background:#EEF4FF;resize:${isMulti?'vertical':'none'}`;
      if (isMulti) inp.rows = 3;
      cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); inp.select();
      const commit = async () => {
        const val = inp.value.trim();
        cell.classList.remove('editing'); cell.style.background = '';
        if (!r || val === (r[field] || '')) {
          cell.textContent = field === 'description' ? (cur || '+ description') : cur;
          return;
        }
        const { error } = await sb.from('requirements')
          .update({ [field]: val || null, updated_at: new Date().toISOString() }).eq('id', rid);
        if (error) { toast(t('common.error'), 'error'); cell.textContent = r[field] || ''; return; }
        r[field] = val;
        cell.textContent = field === 'description'
          ? (val ? val.slice(0,80) + (val.length>80?'…':'') : '+ description')
          : val;
        toast('Saved.', 'success');
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !isMulti) { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') {
          cell.classList.remove('editing'); cell.style.background = '';
          cell.textContent = field === 'description' ? (cur || '+ description') : cur;
        }
      });
    });
  });
}

// ── Section row wiring ────────────────────────────────────────────────────────

function wireReqSectionRow(tr) {
  const rid = tr.dataset.rid;
  const r   = _data.find(d => d.id === rid);
  if (!r) return;

  // Collapse toggle
  const toggle = tr.querySelector('.spec-section-toggle');
  if (toggle) {
    toggle.onclick = (e) => {
      e.stopPropagation();
      if (_collapsed.has(rid)) _collapsed.delete(rid);
      else                     _collapsed.add(rid);
      sessionStorage.setItem(`req_collapsed_${_ctx.parentId}`, JSON.stringify([..._collapsed]));
      const tbody = tr.closest('tbody');
      applyCollapseState(tbody);
    };
  }

  // Title inline edit
  const titleInp = tr.querySelector('.spec-section-title');
  if (titleInp) {
    titleInp.addEventListener('change', async () => {
      const val = titleInp.value.trim();
      if (!val || val === (r.title || '')) return;
      await sb.from('requirements').update({ title: val }).eq('id', rid);
      r.title = val;
      buildReqNavTree();
    });
  }

  // Level up (promote: H2→H1)
  tr.querySelector('.req-sec-level-up')?.addEventListener('click', async () => {
    const lvl = r.level || 1;
    if (lvl <= 1) return;
    const newLvl = lvl - 1;
    await sb.from('requirements').update({ level: newLvl }).eq('id', rid);
    r.level = newLvl;
    refreshAllReqSectionRows();
    buildReqNavTree();
  });

  // Level down (demote: H1→H2)
  tr.querySelector('.req-sec-level-dn')?.addEventListener('click', async () => {
    const lvl = r.level || 1;
    if (lvl >= 3) return;
    const newLvl = lvl + 1;
    await sb.from('requirements').update({ level: newLvl }).eq('id', rid);
    r.level = newLvl;
    refreshAllReqSectionRows();
    buildReqNavTree();
  });

  // Move up / down (block move)
  tr.querySelector('.req-sec-move-up')?.addEventListener('click', () => {
    moveReqSectionBlock(rid, -1);
  });
  tr.querySelector('.req-sec-move-dn')?.addEventListener('click', () => {
    moveReqSectionBlock(rid, 1);
  });

  // Delete section
  tr.querySelector('.req-sec-del')?.addEventListener('click', async () => {
    if (!confirm(`Delete section "${r.title || 'Untitled'}"? The section heading will be removed but its contents will remain.`)) return;
    await sb.from('requirements').delete().eq('id', rid);
    _data.splice(_data.findIndex(d => d.id === rid), 1);
    tr.remove();
    buildReqNavTree();
    toast('Section deleted.', 'success');
  });
}

function refreshAllReqSectionRows() {
  const tbody = document.getElementById('req-tbody');
  if (!tbody) return;
  const nums = computeReqSectionNumbers();
  tbody.querySelectorAll('.req-section-row').forEach(tr => {
    const rid = tr.dataset.rid;
    const r   = _data.find(d => d.id === rid);
    if (!r) return;
    tr.innerHTML = reqSectionRowHTML(r);
    wireReqSectionRow(tr);
  });
}

// ── Section block move ────────────────────────────────────────────────────────

async function moveReqSectionBlock(sectionId, dir) {
  const tbody = document.getElementById('req-tbody');
  if (!tbody) return;

  const idx = _data.findIndex(d => d.id === sectionId);
  if (idx < 0) return;

  // Find the block: this section + all following rows until next title
  const block = [_data[idx]];
  let end = idx + 1;
  while (end < _data.length && _data[end].type !== 'title') {
    block.push(_data[end]);
    end++;
  }

  if (dir === -1) {
    // Move up: find previous block end (the section above and its contents)
    if (idx === 0) return;
    let prevSectionIdx = idx - 1;
    while (prevSectionIdx > 0 && _data[prevSectionIdx].type !== 'title') prevSectionIdx--;
    if (_data[prevSectionIdx].type !== 'title' && prevSectionIdx !== 0) return;
    // Previous block: from prevSectionIdx to idx-1
    const prevBlock = _data.slice(prevSectionIdx, idx);
    // New order: block + prevBlock
    const newOrder = [...block, ...prevBlock];
    _data.splice(prevSectionIdx, newOrder.length, ...newOrder);
  } else {
    // Move down: find next section (at end)
    if (end >= _data.length) return;
    // Next block: from end until the section after that
    const nextSectionIdx = end;
    let nextEnd = nextSectionIdx + 1;
    while (nextEnd < _data.length && _data[nextEnd].type !== 'title') nextEnd++;
    const nextBlock = _data.slice(nextSectionIdx, nextEnd);
    const newOrder = [...nextBlock, ...block];
    _data.splice(nextSectionIdx - block.length, newOrder.length, ...newOrder);
  }

  // Re-assign sort_orders
  _data.forEach((r, i) => { r.sort_order = i; });
  await Promise.all(_data.map(r =>
    sb.from('requirements').update({ sort_order: r.sort_order }).eq('id', r.id)
  ));

  // Rebuild DOM in new order
  _data.forEach(r => {
    const tr = tbody.querySelector(`tr[data-rid="${r.id}"]`);
    if (tr) tbody.appendChild(tr);
  });

  refreshAllReqSectionRows();
  buildReqNavTree();
  applyCollapseState(tbody);
}

// ── Single-row move (non-section rows) ───────────────────────────────────────

async function moveReq(id, dir, tbody) {
  const idx     = _data.findIndex(r => r.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= _data.length) return;

  [_data[idx], _data[swapIdx]] = [_data[swapIdx], _data[idx]];
  const aId = _data[idx].id,    aOrd = idx;
  const bId = _data[swapIdx].id, bOrd = swapIdx;
  _data[idx].sort_order    = aOrd;
  _data[swapIdx].sort_order = bOrd;

  await Promise.all([
    sb.from('requirements').update({ sort_order: aOrd }).eq('id', aId),
    sb.from('requirements').update({ sort_order: bOrd }).eq('id', bId),
  ]);

  const rows = Array.from(tbody.querySelectorAll('tr'));
  const byId = Object.fromEntries(rows.map(tr => [tr.dataset.rid, tr]));
  _data.forEach(r => { const tr = byId[r.id]; if (tr) tbody.appendChild(tr); });
  applyCollapseState(tbody);
}

// ── Collapse state ────────────────────────────────────────────────────────────

function applyCollapseState(tbody) {
  if (!tbody) return;
  const hiddenSet    = new Set();
  const sectionStack = [];

  for (const r of _data) {
    if (r.type === 'title') {
      const lvl = r.level || 1;
      while (sectionStack.length && sectionStack[sectionStack.length - 1].level >= lvl) {
        sectionStack.pop();
      }
      if (sectionStack.some(s => _collapsed.has(s.id))) hiddenSet.add(r.id);
      sectionStack.push({ id: r.id, level: lvl });
    } else {
      if (sectionStack.some(s => _collapsed.has(s.id))) hiddenSet.add(r.id);
    }
  }

  tbody.querySelectorAll('tr[data-rid]').forEach(tr => {
    tr.style.display = hiddenSet.has(tr.dataset.rid) ? 'none' : '';
  });

  tbody.querySelectorAll('.spec-section-toggle').forEach(btn => {
    const isCollapsed = _collapsed.has(btn.dataset.rid);
    btn.textContent = isCollapsed ? '▶' : '▼';
    btn.title = isCollapsed ? 'Expand section' : 'Collapse section';
    btn.classList.toggle('collapsed', isCollapsed);
  });
}

// ── Insert pill ───────────────────────────────────────────────────────────────

function wireInsertHover(tbody) {
  let pill = document.getElementById('req-insert-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'req-insert-pill';
    pill.className = 'spec-insert-pill';
    pill.innerHTML = `
      <div class="spec-insert-line"></div>
      <button class="spec-insert-plus spec-insert-item"  id="req-insert-req-btn"     title="Insert requirement here">＋ Req</button>
      <button class="spec-insert-plus spec-insert-section" id="req-insert-sec-btn"   title="Insert section here">＋ Section</button>
      <div class="spec-insert-line"></div>
    `;
    document.body.appendChild(pill);
  }

  let activeRid = null;
  let pillVisible = false;

  const showPill = (tr) => {
    const rect = tr.getBoundingClientRect();
    pill.style.display = 'flex';
    pill.style.top  = (rect.bottom - 11 + window.scrollY) + 'px';
    pill.style.left = rect.left + 'px';
    pill.style.width = rect.width + 'px';
    activeRid = tr.dataset.rid;
    pillVisible = true;
  };

  const hidePill = () => {
    pill.style.display = 'none';
    pillVisible = false;
    activeRid = null;
  };

  tbody.addEventListener('mousemove', e => {
    const tr = e.target.closest('tr[data-rid]');
    if (!tr) return;
    const rect = tr.getBoundingClientRect();
    const inBottomThird = e.clientY > rect.top + rect.height * 0.6;
    if (inBottomThird) showPill(tr);
    else if (pillVisible && tr.dataset.rid === activeRid) hidePill();
  });

  tbody.addEventListener('mouseleave', () => {
    setTimeout(() => { if (!pill.matches(':hover')) hidePill(); }, 80);
  });

  pill.addEventListener('mouseleave', () => hidePill());

  // + Req button
  document.getElementById('req-insert-req-btn').onclick = () => {
    const rid = activeRid;
    hidePill();
    if (!rid) return;
    showInlineInsertForm(rid, tbody);
  };

  // + Section button
  document.getElementById('req-insert-sec-btn').onclick = async () => {
    const rid = activeRid;
    hidePill();
    await addReqSection(rid);
  };
}

function showInlineInsertForm(afterRid, tbody) {
  const { project, parentType, parentId, typeFilter } = _ctx;
  // Remove any existing form
  tbody.querySelectorAll('.req-inline-new-row').forEach(r => r.remove());

  const defaultType = Array.isArray(typeFilter) ? typeFilter[0] : 'functional';
  const afterTr = tbody.querySelector(`tr[data-rid="${afterRid}"]`);
  if (!afterTr) return;

  const formRow = document.createElement('tr');
  formRow.className = 'req-inline-new-row';
  formRow.innerHTML = `
    <td></td>
    <td></td>
    <td colspan="98" style="padding:4px 6px;background:#EEF4FF;border-bottom:2px solid #1A73E8">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input class="form-input req-inline-title-inp" placeholder="Requirement title…"
          style="flex:1;min-width:200px;font-size:13px;padding:4px 8px;height:28px"/>
        <select class="form-input req-inline-type-sel"
          style="font-size:12px;padding:3px 6px;height:28px;width:150px">
          ${REQ_TYPES.map(v => `<option value="${v}" ${v === defaultType ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm req-inline-save"   style="height:28px;padding:0 10px">Add</button>
        <button class="btn btn-secondary btn-sm req-inline-cancel" style="height:28px;padding:0 8px">✕</button>
      </div>
    </td>`;

  afterTr.after(formRow);
  formRow.querySelector('.req-inline-title-inp').focus();

  const cancel = () => formRow.remove();

  const save = async () => {
    const title = formRow.querySelector('.req-inline-title-inp').value.trim();
    if (!title) { formRow.querySelector('.req-inline-title-inp').focus(); return; }
    const type  = formRow.querySelector('.req-inline-type-sel').value;
    const saveBtn = formRow.querySelector('.req-inline-save');
    saveBtn.disabled = true;

    const reqIdx  = await nextIndex('requirements', { parent_id: parentId });
    const reqCode = buildCode('REQ', {
      domain: _ctx.domain,
      projectName: project.name,
      index:       reqIdx,
    });

    const afterIdx  = _data.findIndex(r => r.id === afterRid);
    const insertAt  = afterIdx >= 0 ? afterIdx + 1 : _data.length;
    const sortOrder = insertAt;

    const toShift = _data.slice(insertAt).filter(r => r.sort_order >= insertAt);
    if (toShift.length) {
      await Promise.all(toShift.map(r =>
        sb.from('requirements').update({ sort_order: r.sort_order + 1 }).eq('id', r.id)
      ));
      toShift.forEach(r => { r.sort_order += 1; });
    }

    const { data: newReq, error } = await sb.from('requirements').insert({
      req_code: reqCode, title, type,
      parent_type: parentType, parent_id: parentId,
      project_id: project.id,
      domain: _ctx.domain,
      status: 'draft', priority: 'medium',
      sort_order: sortOrder,
    }).select().single();

    if (error) { toast(error.message || t('common.error'), 'error'); saveBtn.disabled = false; return; }

    newReq.sort_order = sortOrder;
    _data.splice(insertAt, 0, newReq);
    formRow.remove();

    // Build and insert DOM row
    const newTr = document.createElement('tr');
    newTr.dataset.rid = newReq.id;
    newTr.dataset.sortOrder = newReq.sort_order;
    newTr.id = `req-${newReq.id}`;
    newTr.draggable = true;
    const visCols = _cols.filter(c => c.visible);
    newTr.innerHTML = visCols.map(c => reqTd(c, newReq)).join('');
    afterTr.after(newTr);

    // Wire the new row
    wireNewRow(newTr, newReq, tbody);
    toast(`${reqCode} added.`, 'success');
  };

  formRow.querySelector('.req-inline-cancel').onclick = cancel;
  formRow.querySelector('.req-inline-save').onclick   = save;
  formRow.querySelector('.req-inline-title-inp').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
}

function wireNewRow(tr, req, tbody) {
  const { project, parentType, parentId, typeFilter } = _ctx;
  tr.querySelectorAll('.req-inline-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = _data.find(r => r.id === req.id);
      await sb.from('requirements').update({ [sel.dataset.field]: sel.value || null }).eq('id', req.id);
      if (r) r[sel.dataset.field] = sel.value;
    });
  });
  wireEditableCells(tr);
  tr.querySelectorAll('.btn-move-up, .btn-move-dn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      moveReq(btn.dataset.id, btn.classList.contains('btn-move-up') ? -1 : 1, tbody);
    });
  });
  tr.querySelectorAll('.btn-del-req').forEach(btn => {
    btn.onclick = async () => {
      const r = _data.find(d => d.id === req.id);
      if (r) await handleReqDelete(r);
    };
  });
  tr.querySelectorAll('.btn-trace-req').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openTracePanel(btn.dataset.id); };
  });
  tr.querySelectorAll('.btn-view-req').forEach(btn => {
    btn.onclick = () => openReqModal({ project, parentType, parentId,
      projectType: project.type, existing: req });
  });
  tr.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); copyElementLink(`req-${btn.dataset.id}`); };
  });
  tr.querySelectorAll('.req-dfa-link').forEach(btn => {
    btn.onclick = () => {
      sessionStorage.setItem('dfa_target_req', btn.dataset.id);
      navigate(dfaUrl(project, _ctx.item, _ctx.system));
    };
  });
}

// ── Add section ───────────────────────────────────────────────────────────────

async function addReqSection(afterRid) {
  const { project, parentType, parentId, pageId } = _ctx;
  const afterIdx  = afterRid ? _data.findIndex(r => r.id === afterRid) : _data.length - 1;
  const insertAt  = afterIdx >= 0 ? afterIdx + 1 : _data.length;
  const sortOrder = insertAt;

  const toShift = _data.slice(insertAt).filter(r => r.sort_order >= insertAt);
  if (toShift.length) {
    await Promise.all(toShift.map(r =>
      sb.from('requirements').update({ sort_order: r.sort_order + 1 }).eq('id', r.id)
    ));
    toShift.forEach(r => { r.sort_order += 1; });
  }

  const reqIdx  = await nextIndex('requirements', { parent_id: parentId });
  const reqCode = buildCode('REQ', {
    domain: _ctx.domain,
    projectName: project.name,
    index: reqIdx,
  });

  const { data: newSec, error } = await sb.from('requirements').insert({
    req_code: reqCode,
    title: 'New Section',
    type: 'title',
    level: 1,
    status: 'draft',
    priority: 'medium',
    sort_order: sortOrder,
    parent_type: parentType,
    parent_id:   parentId,
    project_id:  project.id,
    domain:      _ctx.domain,
    page_id:     pageId || null,
  }).select().single();

  if (error) { toast(error.message || t('common.error'), 'error'); return; }

  newSec.sort_order = sortOrder;
  _data.splice(insertAt, 0, newSec);

  const tbody = document.getElementById('req-tbody');
  if (tbody) {
    const newTr = document.createElement('tr');
    newTr.dataset.rid = newSec.id;
    newTr.className = 'req-section-row spec-section-row';
    newTr.innerHTML = reqSectionRowHTML(newSec);
    if (afterRid) {
      const afterTr = tbody.querySelector(`tr[data-rid="${afterRid}"]`);
      afterTr ? afterTr.after(newTr) : tbody.appendChild(newTr);
    } else {
      tbody.appendChild(newTr);
    }
    wireReqSectionRow(newTr);
    refreshAllReqSectionRows();
    buildReqNavTree();
    // Focus title input
    newTr.querySelector('.spec-section-title')?.focus();
  }
  toast('Section added.', 'success');
}

// ── Delete requirement (with linked connection check) ─────────────────────────

async function handleReqDelete(req) {
  const { project, item, system, parentType, parentId, typeFilter, pageId } = _ctx;

  let linkedConn = null;
  if (req.type === 'interface' && req.req_code) {
    const { data: conns } = await sb.from('arch_connections')
      .select('id').eq('requirement', req.req_code).maybeSingle();
    linkedConn = conns;
  }

  const doDelete = async (alsoConn) => {
    await sb.from('requirements').delete().eq('id', req.id);
    if (alsoConn && linkedConn) {
      await sb.from('arch_connections').delete().eq('id', linkedConn.id);
    }
    _data.splice(_data.findIndex(r => r.id === req.id), 1);
    const tr = document.querySelector(`tr[data-rid="${req.id}"]`);
    tr?.remove();
    buildReqNavTree();
    toast(alsoConn ? 'Requirement and connection deleted.' : 'Requirement deleted.', 'success');
    // If nothing left, show empty state
    if (!_data.length) renderTable(document.getElementById('req-body'));
  };

  const isFtaLinked = req.source?.startsWith('FTA-AND:');
  if (!linkedConn && !isFtaLinked) { await doDelete(false); return; }

  if (!linkedConn && isFtaLinked) {
    showModal({
      title: 'Delete Safety Requirement',
      body: `<p style="margin-bottom:8px">Requirement <strong>${esc(req.req_code)}</strong> was generated from an FTA AND gate.</p>
        <div class="modal-warn-box">⚠ Deleting this requirement will create an inconsistency between the FTA and the Requirements. The AND gate that generated it will no longer have a corresponding safety requirement.</div>`,
      footer: `
        <button class="btn btn-secondary" id="fta-del-cancel2">Cancel</button>
        <button class="btn btn-danger"    id="fta-del-ok2">Delete anyway</button>`,
    });
    document.getElementById('fta-del-cancel2').onclick = () => hideModal();
    document.getElementById('fta-del-ok2').onclick = () => { hideModal(); doDelete(false); };
    return;
  }

  showModal({
    title: 'Delete Requirement',
    body: `
      <p style="margin-bottom:8px">Requirement <strong>${esc(req.req_code)}</strong> is linked to a connection in the Architecture canvas.</p>
      <p style="margin-bottom:12px">What would you like to do?</p>
      <div class="modal-warn-box">
        ⚠ Deleting the requirement without removing the connection may create inconsistencies.
      </div>`,
    footer: `
      <button class="btn btn-secondary" id="dr-cancel">Cancel</button>
      <button class="btn btn-secondary" id="dr-req-only">Delete requirement only</button>
      <button class="btn btn-danger"    id="dr-both">Delete requirement + connection</button>
    `,
  });
  document.getElementById('dr-cancel').onclick   = () => hideModal();
  document.getElementById('dr-req-only').onclick = () => { hideModal(); doDelete(false); };
  document.getElementById('dr-both').onclick     = () => { hideModal(); doDelete(true); };
}

// ── Drag-drop reorder (rows) ──────────────────────────────────────────────────

function wireReqDragDrop(tbody) {
  let dragId = null;
  let dragTr = null;

  tbody.querySelectorAll('tr[draggable]').forEach(tr => {
    tr.addEventListener('dragstart', e => {
      if (!e.target.closest('.req-drag-handle') && e.target !== tr) { e.preventDefault(); return; }
      dragId = tr.dataset.rid;
      dragTr = tr;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => tr.classList.add('req-row-dragging'), 0);
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('req-row-dragging');
      clearDropLine();
      dragId = null; dragTr = null;
    });
  });

  function clearDropLine() {
    tbody.querySelectorAll('.req-drop-above,.req-drop-below').forEach(el =>
      el.classList.remove('req-drop-above','req-drop-below'));
  }

  tbody.addEventListener('dragover', e => {
    if (!dragId) return;
    const tr = e.target.closest('tr[data-rid]');
    if (!tr || tr.dataset.rid === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropLine();
    const rect = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < rect.top + rect.height / 2 ? 'req-drop-above' : 'req-drop-below');
  });

  tbody.addEventListener('dragleave', e => {
    const tr = e.target.closest('tr[data-rid]');
    if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('req-drop-above','req-drop-below');
  });

  tbody.addEventListener('drop', async e => {
    const tr = e.target.closest('tr[data-rid]');
    if (!tr || !dragId || !dragTr) return;
    e.preventDefault();
    clearDropLine();
    const targetId = tr.dataset.rid;
    if (targetId === dragId) return;
    const rect   = tr.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const capturedDragId = dragId;

    const fromIdx = _data.findIndex(r => r.id === capturedDragId);
    const [moved] = _data.splice(fromIdx, 1);
    let toIdx = _data.findIndex(r => r.id === targetId);
    if (!before) toIdx += 1;
    _data.splice(toIdx, 0, moved);
    _data.forEach((r, i) => { r.sort_order = i; });

    await Promise.all(_data.map(r =>
      sb.from('requirements').update({ sort_order: r.sort_order }).eq('id', r.id)
    ));

    _data.forEach(r => {
      const row = tbody.querySelector(`tr[data-rid="${r.id}"]`);
      if (row) tbody.appendChild(row);
    });
    applyCollapseState(tbody);
    buildReqNavTree();
  });
}

// ── Custom column inline editing ──────────────────────────────────────────────

function wireCustomCols(tbody) {
  tbody.querySelectorAll('.req-custom-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (cell.querySelector('input')) return;
      const rid    = cell.dataset.rid;
      const colId  = cell.dataset.customCol;
      const r      = _data.find(d => d.id === rid);
      const cur    = (r?.custom_fields || {})[colId] || '';
      const inp    = document.createElement('input');
      inp.value    = cur;
      inp.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:12px;font-family:inherit;background:#EEF4FF';
      cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); inp.select();
      const commit = async () => {
        const val = inp.value.trim();
        cell.textContent = val;
        if (!r) return;
        const fields = { ...(r.custom_fields || {}), [colId]: val };
        r.custom_fields = fields;
        await sb.from('requirements').update({ custom_fields: fields }).eq('id', rid);
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { cell.textContent = cur; }
      });
    });
  });
}

// ── Multi-select toggle cells (system_component / target_domain) ─────────────

function wireMultiselCells(container) {
  // Use event delegation so draggable rows never interfere with button clicks
  container.addEventListener('click', async e => {
    const btn = e.target.closest('.req-mtog');
    if (!btn || btn.classList.contains('req-mtog--fixed')) return;
    e.stopPropagation();

    const rid   = btn.dataset.rid;
    const field = btn.dataset.field;  // 'system_components' | 'target_domains'
    const val   = btn.dataset.val;
    const r     = _data.find(d => d.id === rid);
    if (!r) return;

    const cur  = Array.isArray(r.custom_fields?.[field]) ? [...r.custom_fields[field]] : [];
    const idx  = cur.indexOf(val);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(val);

    const fields = { ...(r.custom_fields || {}), [field]: cur };
    r.custom_fields = fields;
    const { error } = await sb.from('requirements').update({ custom_fields: fields }).eq('id', rid);
    if (error) { toast(t('common.error'), 'error'); return; }

    btn.classList.toggle('req-mtog--on', cur.includes(val));
  });
}

// ── Column header / cell builders ─────────────────────────────────────────────

function reqTh(c) {
  const labels = {
    drag: '', code: 'Code', title: 'Title', type: 'Type',
    priority: 'Priority', status: 'Status', asil: 'ASIL', dal: 'DAL',
    verification: 'Verification', actions: '',
  };
  const widths = {
    drag: 'style="width:18px;padding:0"',
    code: 'style="width:90px"',
    actions: 'style="width:160px"',
  };
  if (c.id === 'asil' && !_showAsil) return '';
  if (c.id === 'dal'  && !_showDal)  return '';
  const label = c.custom ? esc(c.name) : (labels[c.id] ?? esc(c.name));
  const cls   = c.fixed ? '' : ' class="col-managed"';
  const width = widths[c.id] ? ` ${widths[c.id]}` : '';
  return `<th data-col="${c.id}"${cls}${width}>${label}</th>`;
}

function reqTd(c, r) {
  if (c.id === 'asil' && !_showAsil) return '';
  if (c.id === 'dal'  && !_showDal)  return '';
  const sel = (field, opts, cur, blank) => `
    <select class="req-inline-sel" data-rid="${r.id}" data-field="${field}"
      style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
      ${blank ? '<option value="">—</option>' : ''}
      ${opts.map(v => `<option value="${v}" ${cur===v?'selected':''}>${v}</option>`).join('')}
    </select>`;
  switch (c.id) {
    case 'drag':
      return `<td data-col="drag" class="req-drag-handle" title="Drag to reorder">⠿</td>`;
    case 'code': {
      const ftaLinked = r.source?.startsWith('FTA-AND:');
      return `<td data-col="code" class="code-cell" style="white-space:nowrap">
        ${esc(r.req_code)}
        ${ftaLinked ? '<span title="Linked to FTA AND gate" style="margin-left:4px;font-size:10px;color:#1A73E8">⚡</span>' : ''}
        ${r.version > 1 ? `<span class="artifact-version-badge">v${r.version}</span>` : ''}
      </td>`;
    }
    case 'title': {
      const traceCount = _traceFields.reduce((sum, f) => sum + ((r.traceability?.[f.id]?.length) || 0), 0);
      return `<td data-col="title">
        <div style="display:flex;align-items:baseline;gap:6px">
          <div class="req-editable req-title-cell" data-rid="${r.id}" data-field="title" title="Click to edit">${esc(r.title)}</div>
          ${traceCount ? `<span title="${traceCount} trace link(s)" style="font-size:10px;background:#E8F0FE;color:#1A73E8;border-radius:3px;padding:1px 5px;white-space:nowrap">🔗 ${traceCount}</span>` : ''}
        </div>
        ${r.description
          ? `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to edit" style="font-size:12px;margin-top:2px">${esc(r.description.slice(0,80))}${r.description.length>80?'…':''}</div>`
          : `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to add description" style="font-size:11px;color:#aaa">+ description</div>`}
      </td>`;
    }
    case 'type':
      return `<td data-col="type">${sel('type', REQ_TYPES, r.type, false)}</td>`;
    case 'priority':
      return `<td data-col="priority">${sel('priority', REQ_PRIORITIES, r.priority, false)}</td>`;
    case 'status':
      return `<td data-col="status">${sel('status', REQ_STATUSES, r.status, false)}</td>`;
    case 'asil':
      return `<td data-col="asil">${sel('asil', ASIL_LEVELS, r.asil, true)}</td>`;
    case 'dal':
      return `<td data-col="dal">${sel('dal', DAL_LEVELS, r.dal, true)}</td>`;
    case 'verification':
      return `<td data-col="verification" class="req-verification-cell">
        <select class="req-inline-sel req-verification-sel" data-rid="${r.id}" data-field="verification_type"
          style="font-size:11px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer;min-width:72px">
          <option value="">—</option>
          <option value="static"  ${r.verification_type==='static' ?'selected':''}>Static</option>
          <option value="dynamic" ${r.verification_type==='dynamic'?'selected':''}>Dynamic</option>
          <option value="na"      ${r.verification_type==='na'     ?'selected':''}>N/A</option>
        </select>
        ${r.type === 'safety-independency'
          ? `<button class="btn btn-ghost btn-sm req-dfa-link" data-id="${r.id}"
               title="Open DFA analysis for this requirement"
               style="font-size:10px;padding:1px 6px;margin-left:4px;color:#1A73E8">🔍 DFA</button>`
          : (r.verification_type === 'dynamic'
              ? `<span style="font-size:10px;color:#aaa;margin-left:4px">→ test spec</span>`
              : r.verification_type === 'static'
                ? `<span style="font-size:10px;color:#aaa;margin-left:4px">→ analysis</span>`
                : '')
        }
      </td>`;
    case 'actions':
      return `<td data-col="actions" class="actions-cell">
        <button class="btn btn-ghost btn-xs btn-move-up"   data-id="${r.id}" title="Move up">↑</button>
        <button class="btn btn-ghost btn-xs btn-move-dn"   data-id="${r.id}" title="Move down">↓</button>
        <button class="btn btn-ghost btn-xs btn-trace-req" data-id="${r.id}" title="Traceability" style="${_traceFields.length ? '' : 'opacity:0.35'}">⛓</button>
        <button class="btn btn-ghost btn-xs btn-view-req"  data-id="${r.id}" title="View detail">👁</button>
        <button class="btn btn-ghost btn-xs btn-copy-link" data-id="${r.id}" title="Copy link">🔗</button>
        <button class="btn btn-ghost btn-xs btn-del-req"   data-id="${r.id}" data-title="${esc(r.title)}" style="color:var(--color-danger)" title="Delete">✕</button>
      </td>`;
    case 'system_component': {
      const selected = (r.custom_fields?.system_components) || [];
      const btns = _systems.map(s =>
        `<button class="req-mtog${selected.includes(s.id) ? ' req-mtog--on' : ''}"
          data-rid="${r.id}" data-field="system_components" data-val="${esc(s.id)}"
          title="${esc(s.name)}">${esc(s.name.slice(0,12))}</button>`
      ).join('');
      return `<td data-col="system_component"><div class="req-mtog-wrap">${btns || '<span style="color:#ccc;font-size:11px">—</span>'}</div></td>`;
    }
    case 'target_domain': {
      const selected = (r.custom_fields?.target_domains) || [];
      const SUB_DOMAINS = ['sw','hw','mech'];
      const currentDomain = _ctx.domain;
      // Domain-specific pages: show only the current domain as a fixed badge
      if (SUB_DOMAINS.includes(currentDomain)) {
        return `<td data-col="target_domain"><div class="req-mtog-wrap">
          <button class="req-mtog req-mtog--${currentDomain} req-mtog--on req-mtog--fixed"
            data-rid="${r.id}" data-field="target_domains" data-val="${currentDomain}"
            title="Domain fixed for this page">${currentDomain.toUpperCase()}</button>
        </div></td>`;
      }
      const btns = SUB_DOMAINS.map(d =>
        `<button class="req-mtog req-mtog--${d}${selected.includes(d) ? ' req-mtog--on' : ''}"
          data-rid="${r.id}" data-field="target_domains" data-val="${d}">${d.toUpperCase()}</button>`
      ).join('');
      return `<td data-col="target_domain"><div class="req-mtog-wrap">${btns}</div></td>`;
    }
    default:
      if (c.custom) return `<td data-col="${c.id}" class="req-custom-cell" data-rid="${r.id}" data-custom-col="${c.id}"
        title="Click to edit" style="cursor:text;font-size:12px;color:#444;min-width:80px">
        ${esc((r.custom_fields || {})[c.id] || '')}
      </td>`;
      return '';
  }
}

// ── Trace panel ───────────────────────────────────────────────────────────────

function closeTracePanel() {
  const panel = document.getElementById('req-trace-panel');
  panel?.classList.remove('open');
  _tracePanelId = null;
  document.querySelectorAll('.req-row-trace-active').forEach(r => r.classList.remove('req-row-trace-active'));
}

async function openTracePanel(reqId, force = false) {
  const panel    = document.getElementById('req-trace-panel');
  const body     = document.getElementById('req-trace-panel-body');
  if (!panel || !body) return;

  // Toggle off if same req (unless forced refresh)
  if (!force && _tracePanelId === reqId) { closeTracePanel(); return; }
  _tracePanelId = reqId;

  // Highlight row
  document.querySelectorAll('.req-row-trace-active').forEach(r => r.classList.remove('req-row-trace-active'));
  document.querySelector(`tr[data-rid="${reqId}"]`)?.classList.add('req-row-trace-active');

  panel.classList.add('open');
  body.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  const req = _data.find(r => r.id === reqId);
  if (!req) { body.innerHTML = '<p style="padding:16px">Not found.</p>'; return; }

  // Get current node info
  const { item, system } = _ctx;
  const myNode = VMODEL_NODES.find(n => n.domain === _ctx.domain && n.phase === 'requirements');
  const traceability = req.traceability || {};

  // Also load reverse links: other requirements/items that link TO this req
  const reverseLinks = await loadReverseLinks(req.req_code);

  // Split fields: test phases → right arm of V; development/arch/design → left arm
  const TEST_PHASES = new Set(['unit_testing', 'integration_testing', 'system_testing']);
  const testFields = [];
  const devFields  = [];
  for (const field of _traceFields) {
    const linked    = traceability[field.id] || [];
    const revLinked = reverseLinks[field.id] || [];
    const entry = { field, linked, revLinked };
    if (TEST_PHASES.has(field.node.phase)) testFields.push(entry);
    else                                   devFields.push(entry);
  }
  // Sort dev fields by their position in VMODEL_NODES (V-model order)
  const nodeOrder = VMODEL_NODES.map(n => n.id);
  devFields.sort((a, b) => {
    const ai = nodeOrder.indexOf(a.field.id);
    const bi = nodeOrder.indexOf(b.field.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Split into upstream (above current node in V-model) and downstream (below)
  const myNodeIdx      = nodeOrder.indexOf(myNode?.id);
  const upstreamFields   = devFields.filter(e => nodeOrder.indexOf(e.field.id) < myNodeIdx);
  const downstreamFields = devFields.filter(e => nodeOrder.indexOf(e.field.id) > myNodeIdx);

  body.innerHTML = `
    <div class="rtrace-chain">
      ${!_traceFields.length ? `
        <div class="rtrace-no-config">
          <p>No V-Model links configured for this node.</p>
          <p style="margin-top:4px">Go to <strong>Project Settings → V-Model</strong> to define connections.</p>
        </div>
      ` : ''}
      ${buildChainHTML(req, myNode, upstreamFields, downstreamFields, testFields)}
    </div>
  `;

  // Wire add/remove links inline in panel
  wireTracePanelLinks(body, req);
}

async function loadReverseLinks(reqCode) {
  // Find other requirements that link TO this req code
  // We check: which field IDs in _traceFields could have a reverse link?
  // A reverse link means: a req in another node has this req's code in its traceability
  const result = {};
  if (!reqCode) return result;

  // Query requirements where traceability contains this code
  // Using Supabase JSONB: we look for any requirement that has our code in any trace field
  const { item, system } = _ctx;
  for (const field of _traceFields) {
    const node = field.node;
    if (!node || field.source !== 'requirements') { result[field.id] = []; continue; }
    const isItemDomain = node.domain === 'item';
    const parentType   = isItemDomain ? 'item' : 'system';
    const parentId     = isItemDomain ? item?.id : system?.id;
    if (!parentId) { result[field.id] = []; continue; }

    // Find reqs in the other node that link back to this req_code
    const { data } = await sb.from('requirements')
      .select('req_code, title, traceability')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', node.domain)
      .not('type', 'in', '("title","info")');

    const myNodeId = VMODEL_NODES.find(n => n.domain === _ctx.domain && n.phase === 'requirements')?.id;
    result[field.id] = (data || []).filter(r => {
      const t = r.traceability || {};
      return myNodeId && Array.isArray(t[myNodeId]) && t[myNodeId].includes(reqCode);
    }).map(r => ({ code: r.req_code, label: r.title || '' }));
  }
  return result;
}

function buildNodeCardHTML({ field, linked, revLinked }, arrowDir) {
  const nodeIcon = { system: '⬡', sw: '◧', hw: '◨', mech: '◎', item: '⬡' };
  const node       = field.node;
  const options    = _traceData[field.id] || [];
  const icon       = nodeIcon[node.domain] || '◈';
  const totalLinks = linked.length + revLinked.length;

  const linkedItems = linked.map(code => {
    const opt = options.find(o => o.code === code);
    return `<div class="rtrace-item rtrace-item--linked" data-code="${esc(code)}" data-field="${field.id}">
      <div class="rtrace-item-main rtrace-item-expandable" data-code="${esc(code)}" data-field="${field.id}" title="Click to expand">
        <span class="rtrace-item-code">${esc(code)}</span>
        <span class="rtrace-item-label">${esc((opt?.label || '').slice(0,46))}</span>
        <span class="rtrace-item-chevron">▶</span>
      </div>
      <div class="rtrace-item-detail" id="rtrace-detail-${esc(code)}" style="display:none"></div>
      <button class="rtrace-unlink" data-code="${esc(code)}" data-field="${field.id}" title="Remove link">✕</button>
    </div>`;
  }).join('');

  const revItems = revLinked.map(item => `
    <div class="rtrace-item rtrace-item--reverse">
      <div class="rtrace-item-main rtrace-item-expandable" data-code="${esc(item.code)}" data-field="${field.id}" title="Click to expand">
        <span class="rtrace-item-code">${esc(item.code)}</span>
        <span class="rtrace-item-label">${esc(item.label.slice(0,46))}</span>
        <span class="rtrace-item-badge">↩</span>
        <span class="rtrace-item-chevron">▶</span>
      </div>
      <div class="rtrace-item-detail" id="rtrace-detail-${esc(item.code)}" style="display:none"></div>
    </div>`).join('');

  const unlinked = options.filter(o => !linked.includes(o.code));
  const fieldId  = field.id;
  const hasMany  = totalLinks > 3;

  return `
    <div class="rtrace-node rtrace-node--${arrowDir}">
      <div class="rtrace-node-hdr">
        <span class="rtrace-node-icon">${icon}</span>
        <span class="rtrace-node-name">${esc(field.label)}</span>
        <span class="rtrace-node-count ${totalLinks ? 'has-links' : ''}">${totalLinks}</span>
        <div class="rtrace-hdr-actions">
          ${totalLinks > 0 ? `
            <button class="rtrace-filter-btn" data-field="${fieldId}" title="Filter linked items">🔍</button>` : ''}
          ${hasMany ? `
            <button class="rtrace-expand-btn" data-field="${fieldId}" data-expanded="0"
              title="Expand list">⤢</button>` : ''}
        </div>
      </div>
      <div class="rtrace-node-filter" id="rtrace-filter-${fieldId}" style="display:none">
        <input type="text" class="rtrace-filter-inp" data-field="${fieldId}"
          placeholder="Filter…" autocomplete="off"/>
      </div>
      <div class="rtrace-node-body" id="rtrace-nbody-${fieldId}">
        ${linkedItems}${revItems}
        ${!linkedItems && !revItems ? `<div class="rtrace-empty">No links yet</div>` : ''}
      </div>
      <div class="rtrace-add-row">
        <div class="rtrace-search-wrap">
          <input type="text" class="rtrace-search-inp" data-field="${fieldId}"
            placeholder="＋ Search to add link…" autocomplete="off"/>
          <div class="rtrace-search-list" id="rtrace-sl-${fieldId}" style="display:none">
            ${unlinked.map(o =>
              `<div class="rtrace-search-opt" data-field="${fieldId}" data-code="${esc(o.code)}"
                data-label="${esc(o.label)}">
                <span class="rtrace-search-opt-code">${esc(o.code)}</span>
                <span class="rtrace-search-opt-label">${esc(o.label.slice(0,50))}</span>
              </div>`
            ).join('')}
            ${!unlinked.length
              ? `<div class="rtrace-search-empty">All items linked</div>`
              : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function buildChainHTML(req, myNode, upstreamFields, downstreamFields, testFields) {
  const nodeIcon = { system: '⬡', sw: '◧', hw: '◨', mech: '◎', item: '⬡' };

  // Test column (right arm)
  const testColumn = testFields.length
    ? testFields.map(entry => buildNodeCardHTML(entry, 'right')).join(
        `<div class="rtrace-v-spacer"></div>`)
    : '';

  // Helper: render a sequence of node cards — each connected to the CURRENT node only.
  // The connector goes BELOW each card (except the last) and references THAT card's label,
  // so it's clear the link is between the current req and that specific node.
  function renderNodeSequence(fields) {
    return fields.map((entry, i) => {
      const isLast = i === fields.length - 1;
      const connector = isLast ? '' : `
        <div class="rtrace-bidir-arrow">
          <span class="rtrace-bidir-up">↑</span>
          <span class="rtrace-bidir-label">${esc(req.req_code)} ↔ ${esc(entry.field.label)}</span>
          <span class="rtrace-bidir-down">↓</span>
        </div>`;
      return buildNodeCardHTML(entry, 'down') + connector;
    }).join('');
  }

  const upstreamColumn   = upstreamFields.length   ? renderNodeSequence(upstreamFields)   : '';
  const downstreamColumn = downstreamFields.length ? renderNodeSequence(downstreamFields) : '';

  return `
    <div class="rtrace-v-layout">

      <!-- UPSTREAM: nodes above current in V-model -->
      ${upstreamColumn ? `
        <div class="rtrace-dev-chain rtrace-upstream">${upstreamColumn}</div>
        <div class="rtrace-bidir-arrow">
          <span class="rtrace-bidir-up">↑</span>
          <span class="rtrace-bidir-label">${esc(req.req_code)} ↔ ${esc(upstreamFields[upstreamFields.length - 1]?.field.label || '')}</span>
          <span class="rtrace-bidir-down">↓</span>
        </div>
      ` : ''}

      <!-- MIDDLE ROW: current node ←→ test nodes -->
      <div class="rtrace-top-row">
        <div class="rtrace-top-left">
          <div class="rtrace-current">
            <div class="rtrace-current-icon">${nodeIcon[myNode?.domain] || '◈'}</div>
            <div class="rtrace-current-body">
              <div class="rtrace-current-code">${esc(req.req_code)}</div>
              <div class="rtrace-current-title">${esc(req.title)}</div>
              ${req.type ? `<span class="rtrace-current-type">${esc(req.type)}</span>` : ''}
            </div>
          </div>
          ${downstreamFields.length ? `
          <div class="rtrace-bidir-arrow">
            <span class="rtrace-bidir-up">↑</span>
            <span class="rtrace-bidir-label">${esc(req.req_code)} ↔ ${esc(downstreamFields[0]?.field.label || '')}</span>
            <span class="rtrace-bidir-down">↓</span>
          </div>` : ''}
        </div>

        ${testColumn ? `
        <div class="rtrace-top-right">
          <div class="rtrace-horiz-arrow">
            <span class="rtrace-horiz-line"></span>
            <span class="rtrace-horiz-label">↔ test</span>
          </div>
          <div class="rtrace-test-stack">
            ${testColumn}
          </div>
        </div>` : ''}
      </div>

      <!-- DOWNSTREAM: nodes below current in V-model -->
      ${downstreamColumn ? `<div class="rtrace-dev-chain">${downstreamColumn}</div>` : ''}

    </div>
  `;
}

function wireTracePanelLinks(body, req) {
  // Expand item detail on click
  body.querySelectorAll('.rtrace-item-expandable').forEach(el => {
    el.addEventListener('click', async () => {
      const code    = el.dataset.code;
      const fieldId = el.dataset.field;
      const detail  = document.getElementById(`rtrace-detail-${code}`);
      const chevron = el.querySelector('.rtrace-item-chevron');
      if (!detail) return;

      if (detail.style.display !== 'none') {
        detail.style.display = 'none';
        if (chevron) chevron.textContent = '▶';
        return;
      }

      if (chevron) chevron.textContent = '▼';
      detail.style.display = 'block';

      if (detail.dataset.loaded) return; // already fetched
      detail.innerHTML = '<span style="font-size:11px;color:var(--color-text-muted)">Loading…</span>';
      detail.dataset.loaded = '1';

      // Fetch full record based on source type
      const field  = _traceFields.find(f => f.id === fieldId);
      if (!field) { detail.innerHTML = ''; return; }
      const source = field.source;

      let html = '';
      if (source === 'requirements') {
        const { data } = await sb.from('requirements')
          .select('req_code, title, description, type, priority, status')
          .eq('req_code', code).maybeSingle();
        if (data) html = buildItemDetailHTML({
          code: data.req_code, title: data.title, description: data.description,
          badges: [data.type, data.priority, data.status].filter(Boolean),
        });

      } else if (source === 'arch_spec_items') {
        const { data } = await sb.from('arch_spec_items')
          .select('spec_code, title, description, type, status')
          .eq('spec_code', code).maybeSingle();
        if (data) html = buildItemDetailHTML({
          code: data.spec_code, title: data.title, description: data.description,
          badges: [data.type, data.status].filter(Boolean),
        });

      } else if (source === 'test_specs') {
        const { data } = await sb.from('test_specs')
          .select('test_code, name, description, type, status, result')
          .eq('test_code', code).maybeSingle();
        if (data) html = buildItemDetailHTML({
          code: data.test_code, title: data.name, description: data.description,
          badges: [data.type, data.status, data.result].filter(Boolean),
        });
      }

      detail.innerHTML = html || '<span style="font-size:11px;color:var(--color-text-muted)">No details available.</span>';
    });
  });

  // 🔍 Filter button: show/hide inline filter input
  body.querySelectorAll('.rtrace-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId   = btn.dataset.field;
      const filterRow = document.getElementById(`rtrace-filter-${fieldId}`);
      if (!filterRow) return;
      const visible = filterRow.style.display !== 'none';
      filterRow.style.display = visible ? 'none' : 'block';
      if (!visible) filterRow.querySelector('.rtrace-filter-inp')?.focus();
    });
  });

  // Inline filter input: hide non-matching items
  body.querySelectorAll('.rtrace-filter-inp').forEach(inp => {
    inp.addEventListener('input', () => {
      const q     = inp.value.toLowerCase();
      const nbody = document.getElementById(`rtrace-nbody-${inp.dataset.field}`);
      nbody?.querySelectorAll('.rtrace-item').forEach(item => {
        const code  = item.querySelector('.rtrace-item-code')?.textContent.toLowerCase() || '';
        const label = item.querySelector('.rtrace-item-label')?.textContent.toLowerCase() || '';
        item.style.display = (!q || code.includes(q) || label.includes(q)) ? '' : 'none';
      });
    });
  });

  // ⤢ Expand button: toggle expanded class on node body (removes max-height cap)
  body.querySelectorAll('.rtrace-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId  = btn.dataset.field;
      const nbody    = document.getElementById(`rtrace-nbody-${fieldId}`);
      if (!nbody) return;
      const expanded = btn.dataset.expanded === '1';
      nbody.classList.toggle('rtrace-node-body--expanded', !expanded);
      btn.dataset.expanded = expanded ? '0' : '1';
      btn.title   = expanded ? 'Expand list' : 'Collapse list';
      btn.textContent = expanded ? '⤢' : '⤡';
    });
  });

  // Searchable add-link
  body.querySelectorAll('.rtrace-search-inp').forEach(inp => {
    const fieldId = inp.dataset.field;
    const list    = document.getElementById(`rtrace-sl-${fieldId}`);
    if (!list) return;

    const allOpts = Array.from(list.querySelectorAll('.rtrace-search-opt'));

    inp.addEventListener('focus', () => { list.style.display = 'block'; });
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase();
      allOpts.forEach(opt => {
        const match = opt.dataset.code.toLowerCase().includes(q)
                   || opt.dataset.label.toLowerCase().includes(q);
        opt.style.display = match ? '' : 'none';
      });
    });

    // Close on outside click
    document.addEventListener('mousedown', function hide(e) {
      if (!inp.closest('.rtrace-search-wrap').contains(e.target)) {
        list.style.display = 'none';
        inp.value = '';
        allOpts.forEach(o => o.style.display = '');
        document.removeEventListener('mousedown', hide);
      }
    });

    // Pick option
    list.querySelectorAll('.rtrace-search-opt').forEach(opt => {
      opt.addEventListener('mousedown', async (e) => {
        e.preventDefault(); // prevent blur before click
        const code    = opt.dataset.code;
        list.style.display = 'none';
        inp.value = '';
        allOpts.forEach(o => o.style.display = '');

        const updated = { ...(req.traceability || {}) };
        updated[fieldId] = [...(updated[fieldId] || []), code];
        const { error } = await sb.from('requirements')
          .update({ traceability: updated }).eq('id', req.id);
        if (error) { toast('Save failed', 'error'); return; }
        req.traceability = updated;
        const r = _data.find(d => d.id === req.id);
        if (r) r.traceability = updated;
        openTracePanel(req.id, true);
        refreshTraceBadge(req.id);
      });
    });
  });

  // Remove link
  body.querySelectorAll('.rtrace-unlink').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code    = btn.dataset.code;
      const fieldId = btn.dataset.field;

      const updated = { ...(req.traceability || {}) };
      updated[fieldId] = (updated[fieldId] || []).filter(c => c !== code);

      const { error } = await sb.from('requirements')
        .update({ traceability: updated }).eq('id', req.id);
      if (error) { toast('Save failed', 'error'); return; }

      req.traceability = updated;
      const r = _data.find(d => d.id === req.id);
      if (r) r.traceability = updated;

      openTracePanel(req.id, true);
      refreshTraceBadge(req.id);
    });
  });
}

function buildItemDetailHTML({ code, title, description, badges }) {
  return `
    <div class="rtrace-detail-card">
      ${badges.length ? `<div class="rtrace-detail-badges">${badges.map(b =>
        `<span class="rtrace-detail-badge">${esc(b)}</span>`).join('')}</div>` : ''}
      ${description
        ? `<div class="rtrace-detail-desc">${esc(description)}</div>`
        : `<div class="rtrace-detail-desc rtrace-detail-desc--empty">No description</div>`}
    </div>`;
}

function refreshTraceBadge(reqId) {
  const r = _data.find(d => d.id === reqId);
  if (!r) return;
  const tr = document.querySelector(`tr[data-rid="${reqId}"]`);
  if (!tr) return;
  const count = _traceFields.reduce((s, f) => s + ((r.traceability?.[f.id]?.length) || 0), 0);
  const badgeEl = tr.querySelector('[title$="trace link(s)"]');
  if (count && !badgeEl) {
    const titleDiv = tr.querySelector('.req-title-cell')?.closest('div');
    if (titleDiv) {
      const badge = document.createElement('span');
      badge.title = `${count} trace link(s)`;
      badge.style.cssText = 'font-size:10px;background:#E8F0FE;color:#1A73E8;border-radius:3px;padding:1px 5px;white-space:nowrap';
      badge.textContent = `🔗 ${count}`;
      titleDiv.appendChild(badge);
    }
  } else if (badgeEl) {
    if (count) badgeEl.textContent = `🔗 ${count}`;
    else       badgeEl.remove();
  }
}

// ── V-Model traceability helpers ──────────────────────────────────────────────

function deriveReqTraceFields(domainKey, vmodelLinks) {
  const myNodeId = VMODEL_NODES.find(n => n.domain === domainKey && n.phase === 'requirements')?.id;
  if (!myNodeId || !vmodelLinks.length) return [];
  const fields = [];
  for (const link of vmodelLinks) {
    if (link.type && link.type !== 'trace') continue;
    const otherNodeId = link.from === myNodeId ? link.to : link.to === myNodeId ? link.from : null;
    if (!otherNodeId) continue;
    const node = VMODEL_NODES.find(n => n.id === otherNodeId);
    if (!node) continue;
    const source = PHASE_DB_SOURCE[node.phase] || 'free_text';
    fields.push({ id: otherNodeId, label: node.label, source, node });
  }
  return fields;
}

async function loadReqTraceSourceData(item, system) {
  const { project } = _ctx;
  for (const field of _traceFields) {
    if (_traceData[field.id]) continue;
    const node = field.node;
    if (!node) continue;

    // All sub-domains of a system share the same parentId (the system)
    const isItemDomain = node.domain === 'item';
    const parentType   = isItemDomain ? 'item' : 'system';
    const parentId     = isItemDomain ? item?.id : system?.id;
    if (!parentId) { _traceData[field.id] = []; continue; }

    const dbSource = PHASE_DB_SOURCE[node.phase];
    if (dbSource === 'requirements') {
      const q = sb.from('requirements').select('req_code, title')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain)
        .not('type', 'in', '("title","info")')
        .order('sort_order', { ascending: true });
      const { data } = await q;
      _traceData[field.id] = (data || []).map(r => ({ code: r.req_code, label: r.title || '' }));

    } else if (dbSource === 'arch_spec_items') {
      const { data } = await sb.from('arch_spec_items').select('spec_code, title')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain)
        .neq('type', 'section')
        .order('sort_order', { ascending: true });
      _traceData[field.id] = (data || []).map(r => ({ code: r.spec_code || r.id, label: r.title || '' }));

    } else if (dbSource === 'test_specs') {
      const { data } = await sb.from('test_specs').select('test_code, name')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain).eq('phase', node.phase)
        .order('sort_order', { ascending: true });
      _traceData[field.id] = (data || []).map(r => ({ code: r.test_code, label: r.name || '' }));

    } else {
      _traceData[field.id] = [];
    }
  }
}

function buildTraceHTML(existingTraceability) {
  if (!_traceFields.length) return '';
  const traceability = existingTraceability || {};
  return `
    <div class="form-group full" style="margin-top:8px;border-top:1px solid var(--color-border);padding-top:12px">
      <label class="form-label" style="font-weight:600;color:var(--color-text)">Traceability Links</label>
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px">
        Links configured in the V-Model. Select all applicable items.
      </p>
      ${_traceFields.map(field => {
        const selected = traceability[field.id] || [];
        const options  = _traceData[field.id] || [];
        return `
          <div style="margin-bottom:12px">
            <label class="form-label" style="font-size:12px;color:var(--color-text-muted)">${esc(field.label)}</label>
            ${options.length === 0 ? `
              <p style="font-size:12px;color:var(--color-text-muted);font-style:italic">No items found in this node.</p>
            ` : `
              <div class="req-trace-tags" id="trace-tags-${field.id}">
                ${selected.map(code => {
                  const opt = options.find(o => o.code === code);
                  return `<span class="req-trace-tag" data-code="${esc(code)}">
                    ${esc(code)}${opt ? ` — ${esc(opt.label.slice(0,40))}` : ''}
                    <button class="req-trace-tag-rm" data-field="${field.id}" data-code="${esc(code)}" title="Remove">✕</button>
                  </span>`;
                }).join('')}
              </div>
              <div style="display:flex;gap:6px;margin-top:4px">
                <select class="form-input form-select req-trace-picker" id="trace-pick-${field.id}"
                  style="font-size:12px;height:28px;flex:1">
                  <option value="">— add link —</option>
                  ${options.filter(o => !selected.includes(o.code)).map(o =>
                    `<option value="${esc(o.code)}">${esc(o.code)} — ${esc(o.label.slice(0,50))}</option>`
                  ).join('')}
                </select>
              </div>
            `}
          </div>`;
      }).join('')}
    </div>`;
}

function wireTraceModal() {
  // Add button via select change
  _traceFields.forEach(field => {
    const picker = document.getElementById(`trace-pick-${field.id}`);
    if (!picker) return;
    picker.addEventListener('change', () => {
      const code = picker.value;
      if (!code) return;
      picker.value = '';
      // Add tag
      const tagsEl = document.getElementById(`trace-tags-${field.id}`);
      if (!tagsEl) return;
      const options = _traceData[field.id] || [];
      const opt = options.find(o => o.code === code);
      const tag = document.createElement('span');
      tag.className = 'req-trace-tag';
      tag.dataset.code = code;
      tag.innerHTML = `${esc(code)}${opt ? ` — ${esc(opt.label.slice(0,40))}` : ''}
        <button class="req-trace-tag-rm" data-field="${field.id}" data-code="${esc(code)}" title="Remove">✕</button>`;
      tagsEl.appendChild(tag);
      // Remove from picker
      const opt2 = picker.querySelector(`option[value="${CSS.escape(code)}"]`);
      opt2?.remove();
      // Wire remove on new tag
      tag.querySelector('.req-trace-tag-rm').addEventListener('click', () => removeTraceTag(field.id, code, picker));
    });
    // Wire existing remove buttons
    document.querySelectorAll(`.req-trace-tag-rm[data-field="${field.id}"]`).forEach(btn => {
      btn.addEventListener('click', () => removeTraceTag(field.id, btn.dataset.code, picker));
    });
  });
}

function removeTraceTag(fieldId, code, picker) {
  const tagsEl = document.getElementById(`trace-tags-${fieldId}`);
  tagsEl?.querySelector(`span[data-code="${CSS.escape(code)}"]`)?.remove();
  // Re-add to picker
  const options = _traceData[fieldId] || [];
  const opt = options.find(o => o.code === code);
  const optEl = document.createElement('option');
  optEl.value = code;
  optEl.textContent = `${code}${opt ? ` — ${opt.label.slice(0,50)}` : ''}`;
  picker?.appendChild(optEl);
}

function collectTraceability() {
  const traceability = {};
  _traceFields.forEach(field => {
    const tagsEl = document.getElementById(`trace-tags-${field.id}`);
    if (!tagsEl) return;
    traceability[field.id] = Array.from(tagsEl.querySelectorAll('.req-trace-tag[data-code]'))
      .map(tag => tag.dataset.code);
  });
  return traceability;
}

// ── Requirement modal (create / edit) ─────────────────────────────────────────

function openReqModal({ project, parentType, parentId, projectType, existing, defaultType }) {
  const isEdit   = !!existing;
  const r        = existing || {};
  if (!isEdit && defaultType) r.type = defaultType;
  const showAsil = projectType === 'automotive';
  const showDal  = projectType === 'aerospace' || projectType === 'military';

  showModal({
    title: isEdit ? `Edit: ${r.req_code}` : t('req.new'),
    large: true,
    body: `
      <div class="form-grid">
        <div class="form-group full">
          <label class="form-label">${t('req.title')} *</label>
          <input class="form-input" id="r-title" value="${esc(r.title||'')}" placeholder="The system shall..."/>
        </div>
        <div class="form-group full">
          <label class="form-label">${t('req.description')}</label>
          <textarea class="form-input form-textarea" id="r-desc" rows="3">${esc(r.description||'')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">${t('req.type')}</label>
          <select class="form-input form-select" id="r-type">
            ${REQ_TYPES.map(v => `<option value="${v}" ${r.type===v?'selected':''}>${t(`req.type.${v}`)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('req.priority')}</label>
          <select class="form-input form-select" id="r-priority">
            ${REQ_PRIORITIES.map(v => `<option value="${v}" ${r.priority===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('req.status')}</label>
          <select class="form-input form-select" id="r-status">
            ${REQ_STATUSES.map(v => `<option value="${v}" ${r.status===v?'selected':''}>${t(`common.${v}`)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('req.source')}</label>
          <input class="form-input" id="r-source" value="${esc(r.source||'')}" placeholder="e.g. Customer spec §3.2"/>
        </div>
        ${showAsil ? `
        <div class="form-group">
          <label class="form-label">${t('req.asil')}</label>
          <select class="form-input form-select" id="r-asil">
            <option value="">—</option>
            ${ASIL_LEVELS.map(v => `<option value="${v}" ${r.asil===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>` : ''}
        ${showDal ? `
        <div class="form-group">
          <label class="form-label">${t('req.dal')}</label>
          <select class="form-input form-select" id="r-dal">
            <option value="">—</option>
            ${DAL_LEVELS.map(v => `<option value="${v}" ${r.dal===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>` : ''}
        ${buildTraceHTML(r.traceability)}
      </div>`,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${isEdit ? t('common.save') : t('req.create')}</button>`,
  });

  wireTraceModal();
  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('r-title').value.trim();
    if (!title) { document.getElementById('r-title').focus(); return; }
    const payload = {
      title,
      description:  document.getElementById('r-desc').value.trim(),
      type:         document.getElementById('r-type').value,
      priority:     document.getElementById('r-priority').value,
      status:       document.getElementById('r-status').value,
      source:       document.getElementById('r-source').value.trim(),
      asil:         showAsil ? (document.getElementById('r-asil')?.value || null) : null,
      dal:          showDal  ? (document.getElementById('r-dal')?.value  || null) : null,
      traceability: collectTraceability(),
    };
    const btn = document.getElementById('m-save');
    btn.disabled = true;
    let error;
    if (isEdit) {
      ({ error } = await sb.from('requirements')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', r.id));
    } else {
      const reqIdx  = await nextIndex('requirements', { parent_id: parentId });
      const reqCode = buildCode('REQ', {
        domain: _ctx.domain,
        projectName: project.name,
        systemName:  parentType === 'system' ? (project.item_name || '') : undefined,
        index:       reqIdx,
      });
      ({ error } = await sb.from('requirements').insert({
        ...payload, req_code: reqCode,
        parent_type: parentType, parent_id: parentId, project_id: project.id,
        domain: _ctx.domain,
      }));
    }
    btn.disabled = false;
    if (error) { toast(error.message || t('common.error'), 'error'); console.error('req save error', error); return; }
    hideModal();
    toast(isEdit ? 'Requirement updated.' : 'Requirement created.', 'success');
    await loadData();
  };
}

// ── Traceability placeholder ──────────────────────────────────────────────────

function renderTraceability() {
  const body = document.getElementById('req-body');
  if (!body) return;
  body.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="diagram-area">
          <div class="diagram-area-icon">🔗</div>
          <p>Traceability matrix — coming in next version.</p>
          <p class="text-muted" style="font-size:12px">Links requirements to test cases, architecture elements, and safety goals.</p>
        </div>
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dfaUrl(project, item, system) {
  if (system) return `/project/${project.id}/item/${item.id}/system/${system.id}/safety/DFA`;
  return `/project/${project.id}/item/${item.id}/safety/DFA`;
}

function tr_of(el) {
  return el?.closest('tr');
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Keep backward compat alias used in some places
function escHtml(str) { return esc(str); }
