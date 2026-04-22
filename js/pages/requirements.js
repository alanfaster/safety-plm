import { sb, buildCode, nextIndex } from '../config.js';
import { t } from '../i18n/index.js';
import { showModal, hideModal } from '../components/modal.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';
import { loadColConfig, saveColConfig, wireColMgr } from '../components/col-mgr.js';
import { copyElementLink, scrollToAnchor } from '../deep-link.js';

const REQ_TYPES      = ['functional','performance','safety','safety-independency','interface','constraint'];
const REQ_STATUSES   = ['draft','review','approved','deprecated'];
const REQ_PRIORITIES = ['critical','high','medium','low'];
const ASIL_LEVELS    = ['QM','ASIL-A','ASIL-B','ASIL-C','ASIL-D'];
const DAL_LEVELS     = ['DAL-E','DAL-D','DAL-C','DAL-B','DAL-A'];

const REQ_BUILTIN_COLS = [
  { id: 'drag',         name: '',             fixed: true,  visible: true },
  { id: 'code',         name: 'Code',         fixed: true,  visible: true },
  { id: 'title',        name: 'Title',        fixed: true,  visible: true },
  { id: 'type',         name: 'Type',         visible: true },
  { id: 'priority',     name: 'Priority',     visible: true },
  { id: 'status',       name: 'Status',       visible: true },
  { id: 'asil',         name: 'ASIL',         visible: true, projectTypes: ['automotive'] },
  { id: 'dal',          name: 'DAL',          visible: true, projectTypes: ['aerospace','military'] },
  { id: 'verification', name: 'Verification', visible: true },
  { id: 'actions',      name: '',             fixed: true,  visible: true },
];

// ── Module-level state ────────────────────────────────────────────────────────
let _ctx      = null;  // { project, item, system, parentType, parentId, typeFilter, pageId }
let _data     = [];    // all rows in order (requirements + title/info structural)
let _cols     = [];
let _builtins = REQ_BUILTIN_COLS;
let _collapsed = new Set();
let _colKey   = '';
let _showAsil = false;
let _showDal  = false;

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
  _data      = [];
  _collapsed = new Set(JSON.parse(sessionStorage.getItem(`req_collapsed_${parentId}`) || '[]'));
  _showAsil  = project.type === 'automotive';
  _showDal   = project.type === 'aerospace' || project.type === 'military';

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
    </div>
    <div class="spec-fab" id="req-fab">
      <button class="btn btn-primary"   id="btn-new-req">＋ ${t('req.new')}</button>
      <button class="btn btn-secondary" id="btn-new-section">＋ Section</button>
    </div>
  `;

  document.getElementById('btn-new-req').onclick = () =>
    openReqModal({ project, parentType, parentId, projectType: project.type,
      defaultType: Array.isArray(typeFilter) ? typeFilter[0] : undefined });
  document.getElementById('btn-new-section').onclick = () => addReqSection(null);
  document.getElementById('req-nav-close').onclick   = () => toggleReqNav(false);
  document.getElementById('req-nav-expand').onclick  = () => toggleReqNav(true);

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
    let q = sb.from('requirements').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId);
    if (parentType === 'system') q = q.eq('domain', domainKey);
    return q;
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

  _colKey   = pageId ? `req_${parentId}_${pageId}` : `req_${parentId}`;
  _builtins = [
    ...REQ_BUILTIN_COLS.filter(c => !c.projectTypes || c.projectTypes.includes(project.type)),
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

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table req-reorder-table" id="req-table">
          <thead>
            <tr id="req-thead-row">
              ${visCols.map(c => reqTh(c)).join('')}
            </tr>
          </thead>
          <tbody id="req-tbody">
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = document.getElementById('req-tbody');
  _data.forEach(r => appendReqRow(tbody, r));
  applyCollapseState(tbody);

  // Column manager
  const tableEl  = body.querySelector('#req-table');
  const theadRow = body.querySelector('#req-thead-row');
  if (tableEl && theadRow) {
    wireColMgr(theadRow, tableEl, _colKey, _cols, (updatedCols) => {
      _cols = updatedCols;
      renderTable(body);
    });
  }

  // Wire all rows
  wireAllRows(tbody);

  // Drag-drop row reorder
  wireReqDragDrop(tbody);

  // Custom column inline editing
  const customCols = visCols.filter(c => c.custom);
  if (customCols.length) wireCustomCols(tbody);

  // Insert pill
  wireInsertHover(tbody);

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
      </td>`;
    }
    case 'title':
      return `<td data-col="title">
        <div class="req-editable req-title-cell" data-rid="${r.id}" data-field="title" title="Click to edit">${esc(r.title)}</div>
        ${r.description
          ? `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to edit" style="font-size:12px;margin-top:2px">${esc(r.description.slice(0,80))}${r.description.length>80?'…':''}</div>`
          : `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to add description" style="font-size:11px;color:#aaa">+ description</div>`}
      </td>`;
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
        <button class="btn btn-ghost btn-xs btn-view-req"  data-id="${r.id}" title="View detail">👁</button>
        <button class="btn btn-ghost btn-xs btn-copy-link" data-id="${r.id}" title="Copy link">🔗</button>
        <button class="btn btn-ghost btn-xs btn-del-req"   data-id="${r.id}" data-title="${esc(r.title)}" style="color:var(--color-danger)" title="Delete">✕</button>
      </td>`;
    default:
      if (c.custom) return `<td data-col="${c.id}" class="req-custom-cell" data-rid="${r.id}" data-custom-col="${c.id}"
        title="Click to edit" style="cursor:text;font-size:12px;color:#444;min-width:80px">
        ${esc((r.custom_fields || {})[c.id] || '')}
      </td>`;
      return '';
  }
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
      </div>`,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${isEdit ? t('common.save') : t('req.create')}</button>`,
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('r-title').value.trim();
    if (!title) { document.getElementById('r-title').focus(); return; }
    const payload = {
      title,
      description: document.getElementById('r-desc').value.trim(),
      type:     document.getElementById('r-type').value,
      priority: document.getElementById('r-priority').value,
      status:   document.getElementById('r-status').value,
      source:   document.getElementById('r-source').value.trim(),
      asil: showAsil ? (document.getElementById('r-asil')?.value || null) : null,
      dal:  showDal  ? (document.getElementById('r-dal')?.value  || null) : null,
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
      }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
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
