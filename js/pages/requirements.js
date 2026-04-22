import { sb, buildCode, nextIndex } from '../config.js';
import { t } from '../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';
import { loadColConfig, saveColConfig, wireColMgr } from '../components/col-mgr.js';
import { copyElementLink, scrollToAnchor } from '../deep-link.js';

const REQ_TYPES     = ['functional','performance','safety','safety-independency','interface','constraint'];
const REQ_CONTENT_TYPES = ['title','info']; // structural rows, not selectable via type dropdown

// Built-in column definitions for requirements tables
const REQ_BUILTIN_COLS = [
  { id: 'drag',         name: '',             fixed: true,  visible: true },
  { id: 'code',         name: 'Code',         fixed: true,  visible: true },
  { id: 'title',        name: 'Title',        fixed: true,  visible: true },
  { id: 'type',         name: 'Type',         visible: true },
  { id: 'priority',     name: 'Priority',     visible: true },
  { id: 'status',       name: 'Status',       visible: true },
  { id: 'asil',         name: 'ASIL',         visible: true,  projectTypes: ['automotive'] },
  { id: 'dal',          name: 'DAL',          visible: true,  projectTypes: ['aerospace','military'] },
  { id: 'verification', name: 'Verification', visible: true },
  { id: 'actions',      name: '',             fixed: true,  visible: true },
];
const REQ_STATUSES  = ['draft','review','approved','deprecated'];
const REQ_PRIORITIES= ['critical','high','medium','low'];
const ASIL_LEVELS   = ['QM','ASIL-A','ASIL-B','ASIL-C','ASIL-D'];
const DAL_LEVELS    = ['DAL-E','DAL-D','DAL-C','DAL-B','DAL-A'];

export async function renderRequirements(container, { project, item, system, parentType, parentId, pageId = null }) {
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

  const baseTitle = t('vcycle.requirements');
  const pageTitle = subPageName ? subPageName : baseTitle;
  const parentName = system?.name || item?.name;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${pageTitle}</h1>
          <p class="text-muted">${parentName}</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-secondary" id="btn-new-section">＋ Section</button>
          <button class="btn btn-primary" id="btn-new-req">＋ ${t('req.new')}</button>
        </div>
      </div>
      ${!typeFilter ? `
      <div class="page-tabs">
        <button class="page-tab active" data-tab="list">All Requirements</button>
        <button class="page-tab" data-tab="matrix">Traceability</button>
      </div>` : ''}
    </div>
    <div class="page-body" id="req-body">
      <div class="content-loading"><div class="spinner"></div></div>
    </div>
  `;

  // defaultType for new requirements: use first type in filter array, or null
  const defaultType = Array.isArray(typeFilter) ? typeFilter[0] : (typeFilter || undefined);
  document.getElementById('btn-new-req').onclick = () =>
    openReqModal({ project, parentType, parentId, projectType: project.type,
      defaultType });

  document.getElementById('btn-new-section').onclick = () =>
    openSectionModal({ project, parentType, parentId, pageId });

  if (!typeFilter) {
    container.querySelectorAll('.page-tab').forEach(tab => {
      tab.onclick = () => {
        container.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'matrix') renderTraceability(project, parentType, parentId);
        else loadRequirements(project, item, system, parentType, parentId, null, true, null);
      };
    });
  }

  await loadRequirements(project, item, system, parentType, parentId, typeFilter, typeFilter == null, pageId);
}

async function loadRequirements(project, item, system, parentType, parentId, typeFilter = null, excludeInterface = false, pageId = null) {
  const base = () => sb.from('requirements').select('*')
    .eq('parent_type', parentType).eq('parent_id', parentId);

  // ── Content rows (actual requirements, NOT structural) ─────────────────────
  let contentQ = base();
  if (Array.isArray(typeFilter) && typeFilter.length) contentQ = contentQ.in('type', typeFilter);
  else if (typeFilter)       contentQ = contentQ.eq('type', typeFilter);
  else if (excludeInterface) contentQ = contentQ.not('type', 'in', '("interface","safety-independency","title","info")');
  else                       contentQ = contentQ.not('type', 'in', '("title","info")');

  // ── Structural rows (title/info) scoped to this exact page ─────────────────
  let structQ = base().in('type', ['title', 'info']);
  if (pageId) structQ = structQ.eq('page_id', pageId);
  else        structQ = structQ.is('page_id', null);

  const [{ data: content, error: e1 }, { data: structural, error: e2 }] =
    await Promise.all([
      contentQ.order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      structQ .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    ]);

  const body = document.getElementById('req-body');
  if (e1 || e2) { body.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  // Merge and sort by sort_order, then created_at
  const data = [...(content || []), ...(structural || [])].sort((a, b) =>
    a.sort_order !== b.sort_order
      ? a.sort_order - b.sort_order
      : new Date(a.created_at) - new Date(b.created_at)
  );

  if (!data.length) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <h3>No requirements yet</h3>
        <p>Add the first requirement to define what this ${parentType} must do.</p>
      </div>
    `;
    return;
  }

  // Normalize sort_order so rows that were created before this feature have distinct values
  data.forEach((r, i) => { if (!r.sort_order) r.sort_order = i; });

  const showAsil   = project.type === 'automotive';
  const showDal    = project.type === 'aerospace' || project.type === 'military';

  // Load project-level custom column definitions from project_config
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const projectCustomCols = (pcRow?.config?.req_custom_cols || [])
    .map(c => ({ ...c, custom: true, visible: true }));

  // Load column config (visibility + order per subpage — pageId makes it subpage-specific)
  const colKey   = pageId ? `req_${parentId}_${pageId}` : `req_${parentId}`;
  const builtins = [
    ...REQ_BUILTIN_COLS.filter(c => (!c.projectTypes || c.projectTypes.includes(project.type))),
    ...projectCustomCols,
  ];
  const cols      = loadColConfig(colKey, builtins);
  // Only the visible cols, in their saved order
  const visCols   = cols.filter(c => c.visible);

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table req-reorder-table" id="req-table">
          <thead>
            <tr id="req-thead-row">
              ${visCols.map(c => reqTh(c, showAsil, showDal)).join('')}
            </tr>
          </thead>
          <tbody id="req-tbody">
            ${data.map(r => {
              const row = r.type === 'title' ? titleRow(r)
                        : r.type === 'info'  ? infoRow(r)
                        : reqRow(r, project, item, system, showAsil, showDal, visCols);
              return row + insertTriggerRow(r.id);
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  body.querySelectorAll('.btn-view-req').forEach(btn => {
    btn.onclick = () => openReqModal({
      project, parentType, parentId, projectType: project.type,
      existing: data.find(r => r.id === btn.dataset.id)
    });
  });

  // ── Inline editing ─────────────────────────────────────────────────────────
  wireInlineReqEditing(body, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal);

  // ── Column manager ─────────────────────────────────────────────────────────
  const tableEl  = body.querySelector('#req-table');
  const theadRow = body.querySelector('#req-thead-row');
  if (tableEl && theadRow) {
    // No applyColVisibility needed — we only render visible cols now
    wireColMgr(theadRow, tableEl, colKey, cols, () => {
      window.dispatchEvent(new Event('hashchange'));
    });
  }
  // Wire custom column inline editing
  const customCols = visCols.filter(c => c.custom);
  if (customCols.length) wireCustomCols(body, data);

  // ── Section collapse ───────────────────────────────────────────────────────
  const tbody       = body.querySelector('#req-tbody');
  const collapseKey = `req_collapsed_${parentId}`;
  const collapsed   = new Set(JSON.parse(sessionStorage.getItem(collapseKey) || '[]'));
  if (tbody) {
    applyCollapseState(tbody, data, collapsed);
    wireCollapseSections(tbody, data, collapsed, collapseKey);
  }

  // ── Inline insert triggers ─────────────────────────────────────────────────
  if (tbody) wireInsertTriggers(tbody, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal, visCols, collapsed);

  // ── Reorder: arrows ────────────────────────────────────────────────────────
  body.querySelectorAll('.btn-move-up, .btn-move-dn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const dir = btn.classList.contains('btn-move-up') ? -1 : 1;
      moveReq(btn.dataset.id, dir, data, tbody, parentType, parentId);
    });
  });

  // ── Reorder: drag-and-drop ─────────────────────────────────────────────────
  if (tbody) wireReqDragDrop(tbody, data, parentType, parentId, collapsed);

  // ── Deep-link: scroll to anchor if navigated via a copied link ────────────
  scrollToAnchor();

  body.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      copyElementLink(`req-${btn.dataset.id}`);
    };
  });

  body.querySelectorAll('.btn-del-req').forEach(btn => {
    btn.onclick = async () => {
      const req = data.find(r => r.id === btn.dataset.id);
      if (!req) return;

      // Check if there's a linked arch_connection
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
        await loadRequirements(project, item, system, parentType, parentId, typeFilter, false, pageId);
        toast(alsoConn ? 'Requirement and connection deleted.' : 'Requirement deleted.', 'success');
      };

      // Check if linked to an FTA AND gate
      const isFtaLinked = req.source?.startsWith('FTA-AND:');
      if (!linkedConn && !isFtaLinked) { await doDelete(false); return; }
      if (!linkedConn && isFtaLinked) {
        showModal({
          title: 'Delete Safety Requirement',
          body: `<p style="margin-bottom:8px">Requirement <strong>${escHtml(req.req_code)}</strong> was generated from an FTA AND gate.</p>
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
          <p style="margin-bottom:8px">Requirement <strong>${escHtml(req.req_code)}</strong> is linked to a connection in the Architecture canvas.</p>
          <p style="margin-bottom:12px">What would you like to do?</p>
          <div class="modal-warn-box">
            ⚠ Deleting the requirement without removing the connection may create inconsistencies between the Architecture and other documents (Requirements, Traceability).
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
    };
  });
}

function dfaUrl(project, item, system) {
  if (system) return `/project/${project.id}/item/${item.id}/system/${system.id}/safety/DFA`;
  return `/project/${project.id}/item/${item.id}/safety/DFA`;
}

// ── Structural rows (Title / Info) ────────────────────────────────────────────

function titleRow(r) {
  const lvl = r.level || 1;
  const fontSizes = ['18px', '15px', '13px'];
  const fs = fontSizes[Math.min(lvl - 1, 2)];
  const padding = ['14px 8px 6px', '10px 8px 4px', '8px 8px 2px'][Math.min(lvl - 1, 2)];
  const indent = (lvl - 1) * 14;
  return `
    <tr class="req-title-row" data-rid="${r.id}" data-level="${lvl}" data-sort-order="${r.sort_order ?? 0}" data-type="title" draggable="true">
      <td class="req-drag-handle" title="Drag to reorder">⠿</td>
      <td colspan="100" style="padding:${padding};padding-left:${8 + indent}px;border-bottom:1px solid #e0e0e0;background:#f8f9fa">
        <div style="display:flex;align-items:center;gap:6px">
          <button class="req-section-toggle" data-rid="${r.id}" title="Collapse / expand section"
            style="background:none;border:none;cursor:pointer;padding:0 2px;font-size:11px;color:#888;line-height:1;flex-shrink:0">▼</button>
          <span style="color:#bbb;font-size:10px;flex-shrink:0">H${lvl + 1}</span>
          <span class="req-editable req-title-cell" data-rid="${r.id}" data-field="title"
            style="font-size:${fs};font-weight:600;color:#1a1a2e;flex:1">${escHtml(r.title || 'Untitled Section')}</span>
          <button class="btn btn-ghost btn-sm btn-move-up" data-id="${r.id}" title="Move up" style="opacity:0.5">▲</button>
          <button class="btn btn-ghost btn-sm btn-move-dn" data-id="${r.id}" title="Move down" style="opacity:0.5">▼</button>
          <button class="btn btn-ghost btn-sm btn-del-req" data-id="${r.id}" data-title="${escHtml(r.title)}"
            style="opacity:0.4;font-size:10px">✕</button>
        </div>
      </td>
    </tr>`;
}

function infoRow(r) {
  return `
    <tr class="req-info-row" data-rid="${r.id}" data-sort-order="${r.sort_order ?? 0}" data-type="info" draggable="true">
      <td class="req-drag-handle" title="Drag to reorder">⠿</td>
      <td colspan="100" style="padding:6px 8px 6px 20px;background:#fafbfc;border-bottom:1px solid #eee">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <span style="color:#aaa;font-size:11px;margin-top:2px">ℹ</span>
          <span class="req-editable req-title-cell" data-rid="${r.id}" data-field="title"
            style="font-size:13px;color:#555;flex:1;font-style:italic">${escHtml(r.title || 'Info text...')}</span>
          <button class="btn btn-ghost btn-sm btn-move-up" data-id="${r.id}" title="Move up" style="opacity:0.5">▲</button>
          <button class="btn btn-ghost btn-sm btn-move-dn" data-id="${r.id}" title="Move down" style="opacity:0.5">▼</button>
          <button class="btn btn-ghost btn-sm btn-del-req" data-id="${r.id}" data-title="${escHtml(r.title)}"
            style="opacity:0.4;font-size:10px">✕</button>
        </div>
      </td>
    </tr>`;
}

async function openSectionModal({ project, parentType, parentId, pageId }) {
  showModal({
    title: 'Add Section Row',
    body: `
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Row type</label>
          <select class="form-input form-select" id="sec-type">
            <option value="title">Title (heading)</option>
            <option value="info">Info (text block)</option>
          </select>
        </div>
        <div class="form-group full">
          <label class="form-label">Text</label>
          <input class="form-input" id="sec-text" placeholder="Section heading or info text..." />
        </div>
        <div class="form-group" id="sec-level-group">
          <label class="form-label">Heading level</label>
          <select class="form-input form-select" id="sec-level">
            <option value="1">H2 (large)</option>
            <option value="2">H3 (medium)</option>
            <option value="3">H4 (small)</option>
          </select>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-secondary" id="sec-cancel">Cancel</button>
      <button class="btn btn-primary" id="sec-save">Add</button>`,
  });

  document.getElementById('sec-type').onchange = (e) => {
    document.getElementById('sec-level-group').style.display = e.target.value === 'title' ? '' : 'none';
  };
  document.getElementById('sec-cancel').onclick = () => hideModal();
  document.getElementById('sec-save').onclick = async () => {
    const type  = document.getElementById('sec-type').value;
    const text  = document.getElementById('sec-text').value.trim();
    const level = parseInt(document.getElementById('sec-level').value) || 1;

    const reqIdx  = await nextIndex('requirements', { parent_id: parentId });
    const reqCode = buildCode('REQ', {
      domain: parentType === 'item' ? 'ITEM' : 'SYS',
      projectName: project.name,
      index: reqIdx,
    });

    const payload = {
      parent_type: parentType, parent_id: parentId,
      req_code: reqCode,
      type, title: text || (type === 'title' ? 'Section' : 'Info'),
      level: type === 'title' ? level : null,
      status: 'draft', priority: 'medium',
      page_id: pageId || null,
    };
    const { error } = await sb.from('requirements').insert(payload);
    if (error) { toast(error.message || t('common.error'), 'error'); return; }
    hideModal();
    toast('Row added.', 'success');
    // Reload the requirements list
    window.dispatchEvent(new Event('hashchange'));
  };
}

// ── Dynamic column header ─────────────────────────────────────────────────────

function reqTh(c, showAsil, showDal) {
  if (c.id === 'asil' && !showAsil) return '';
  if (c.id === 'dal'  && !showDal)  return '';
  const labels = {
    drag: '', code: 'Code', title: 'Title', type: 'Type',
    priority: 'Priority', status: 'Status', asil: 'ASIL', dal: 'DAL',
    verification: 'Verification', actions: '',
  };
  const widths = {
    drag: 'style="width:18px;padding:0"',
    code: 'style="width:90px"', actions: 'style="width:160px"',
  };
  const label  = c.custom ? escHtml(c.name) : (labels[c.id] ?? escHtml(c.name));
  const fixed  = c.fixed;
  const cls    = fixed ? '' : ' class="col-managed"';
  const width  = widths[c.id] || '';
  return `<th data-col="${c.id}"${cls}${width ? ' ' + width : ''}>${label}</th>`;
}

// ── Dynamic row cell ──────────────────────────────────────────────────────────

function reqTd(c, r, showAsil, showDal) {
  if (c.id === 'asil' && !showAsil) return '';
  if (c.id === 'dal'  && !showDal)  return '';
  const sel = (id, field, opts, cur, blank) => `
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
        ${escHtml(r.req_code)}
        ${ftaLinked ? '<span title="Linked to FTA AND gate" style="margin-left:4px;font-size:10px;color:#1A73E8">⚡</span>' : ''}
      </td>`;
    }
    case 'title':
      return `<td data-col="title">
        <div class="req-editable req-title-cell" data-rid="${r.id}" data-field="title" title="Click to edit">${escHtml(r.title)}</div>
        ${r.description
          ? `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to edit" style="font-size:12px;margin-top:2px">${escHtml(r.description.slice(0,80))}${r.description.length>80?'…':''}</div>`
          : `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to add description" style="font-size:11px;color:#aaa">+ description</div>`}
      </td>`;
    case 'type':
      return `<td data-col="type">${sel('type','type',REQ_TYPES,r.type,false)}</td>`;
    case 'priority':
      return `<td data-col="priority">${sel('pri','priority',REQ_PRIORITIES,r.priority,false)}</td>`;
    case 'status':
      return `<td data-col="status">${sel('sta','status',REQ_STATUSES,r.status,false)}</td>`;
    case 'asil':
      return `<td data-col="asil">${sel('asil','asil',ASIL_LEVELS,r.asil,true)}</td>`;
    case 'dal':
      return `<td data-col="dal">${sel('dal','dal',DAL_LEVELS,r.dal,true)}</td>`;
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
              ? `<span class="req-verif-link-hint" style="font-size:10px;color:#aaa;margin-left:4px">→ test spec</span>`
              : r.verification_type === 'static'
                ? `<span class="req-verif-link-hint" style="font-size:10px;color:#aaa;margin-left:4px">→ analysis</span>`
                : '')
        }
      </td>`;
    case 'actions':
      return `<td data-col="actions" class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-move-up" data-id="${r.id}" title="Move up">▲</button>
        <button class="btn btn-ghost btn-sm btn-move-dn" data-id="${r.id}" title="Move down">▼</button>
        <button class="btn btn-ghost btn-sm btn-view-req" data-id="${r.id}">Detail</button>
        <button class="btn btn-ghost btn-sm btn-copy-link" data-id="${r.id}" title="Copy link to this requirement">🔗</button>
        <button class="btn btn-ghost btn-sm btn-del-req" data-id="${r.id}" data-title="${escHtml(r.title)}">${t('common.delete')}</button>
      </td>`;
    default:
      if (c.custom) return `<td data-col="${c.id}" class="req-custom-cell" data-rid="${r.id}" data-custom-col="${c.id}"
        title="Click to edit" style="cursor:text;font-size:12px;color:#444;min-width:80px">
        ${escHtml((r.custom_fields || {})[c.id] || '')}
      </td>`;
      return '';
  }
}

function reqRow(r, project, item, system, showAsil, showDal, visCols) {
  return `
    <tr id="req-${r.id}" data-rid="${r.id}" data-sort-order="${r.sort_order ?? 0}" draggable="true">
      ${visCols.map(c => reqTd(c, r, showAsil, showDal)).join('')}
    </tr>
  `;
}

function wireInlineReqEditing(body, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal) {
  // Select dropdowns — save on change
  body.querySelectorAll('.req-inline-sel').forEach(sel => {
    sel.addEventListener('mouseenter', () => { sel.style.borderColor = '#ccc'; });
    sel.addEventListener('mouseleave', () => { if (document.activeElement !== sel) sel.style.borderColor = 'transparent'; });
    sel.addEventListener('focus',      () => { sel.style.borderColor = '#1A73E8'; sel.style.background = '#fff'; });
    sel.addEventListener('blur',       () => { sel.style.borderColor = 'transparent'; sel.style.background = 'transparent'; });
    sel.addEventListener('change', async () => {
      const rid = sel.dataset.rid;
      const field = sel.dataset.field;
      const val = sel.value || null;
      const { error } = await sb.from('requirements').update({ [field]: val, updated_at: new Date().toISOString() }).eq('id', rid);
      if (error) { toast(t('common.error'), 'error'); return; }
      // update local cache
      const r = data.find(r => r.id === rid); if (r) r[field] = val;
      toast('Saved.', 'success');
    });
  });

  // Title / description — click to edit inline
  body.querySelectorAll('.req-editable').forEach(cell => {
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
      const r = data.find(r => r.id === rid);
      const curVal = r?.[field] || '';
      cell.style.background = '#EEF4FF';

      const isMultiline = field === 'description';
      const inp = document.createElement(isMultiline ? 'textarea' : 'input');
      inp.value = curVal;
      inp.style.cssText = `width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:${isMultiline?'12':'13'}px;font-family:inherit;background:#EEF4FF;resize:${isMultiline?'vertical':'none'}`;
      if (isMultiline) inp.rows = 3;
      cell.innerHTML = '';
      cell.appendChild(inp);
      inp.focus();
      inp.select();

      const commit = async () => {
        const val = inp.value.trim();
        cell.classList.remove('editing');
        cell.style.background = '';

        if (!r || val === (r[field] || '')) {
          // No change — restore display
          cell.textContent = r?.[field] || (field === 'description' ? '' : '');
          if (field === 'description' && !val) cell.textContent = '+ description';
          return;
        }

        const { error } = await sb.from('requirements').update({ [field]: val || null, updated_at: new Date().toISOString() }).eq('id', rid);
        if (error) { toast(t('common.error'), 'error'); cell.textContent = r[field] || ''; return; }
        r[field] = val;
        if (field === 'description') {
          cell.textContent = val ? (val.slice(0, 80) + (val.length > 80 ? '…' : '')) : '+ description';
        } else {
          cell.textContent = val;
        }
        toast('Saved.', 'success');
      };

      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !isMultiline) { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { cell.classList.remove('editing'); cell.style.background = ''; cell.textContent = r?.[field] || (field === 'description' ? '+ description' : ''); }
      });
    });
  });

  // DFA link buttons — navigate to DFA page with this requirement pre-selected
  body.querySelectorAll('.req-dfa-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.id;
      sessionStorage.setItem('dfa_target_req', rid);
      navigate(dfaUrl(project, item, system));
    });
  });
}

function openReqModal({ project, parentType, parentId, projectType, existing, defaultType }) {
  const isEdit = !!existing;
  const r = existing || {};
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
          <input class="form-input" id="r-title" value="${escHtml(r.title||'')}" placeholder="The system shall..."/>
        </div>
        <div class="form-group full">
          <label class="form-label">${t('req.description')}</label>
          <textarea class="form-input form-textarea" id="r-desc" rows="3">${escHtml(r.description||'')}</textarea>
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
          <input class="form-input" id="r-source" value="${escHtml(r.source||'')}" placeholder="e.g. Customer spec §3.2"/>
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
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-save">${isEdit ? t('common.save') : t('req.create')}</button>
    `
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
      ({ error } = await sb.from('requirements').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', r.id));
    } else {
      const reqIdx = await nextIndex('requirements', { parent_id: parentId });
      const reqCode = buildCode('REQ', {
        domain: parentType === 'item' ? 'ITEM' : 'SYS',
        projectName: project.name,
        systemName: parentType === 'system' ? (project.item_name || '') : undefined,
        index: reqIdx,
      });
      ({ error } = await sb.from('requirements').insert({
        ...payload,
        req_code: reqCode,
        parent_type: parentType,
        parent_id: parentId,
        project_id: project.id,
      }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }

    hideModal();
    toast(isEdit ? 'Requirement updated.' : 'Requirement created.', 'success');
    window.dispatchEvent(new Event('hashchange'));
  };
}

// ── Requirement row reordering ────────────────────────────────────────────────

async function moveReq(id, dir, data, tbody, parentType, parentId) {
  const idx     = data.findIndex(r => r.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= data.length) return;

  // Swap in memory
  [data[idx], data[swapIdx]] = [data[swapIdx], data[idx]];

  // Assign sort_orders equal to their new indices
  const aId = data[idx].id,    aOrd = idx;
  const bId = data[swapIdx].id, bOrd = swapIdx;
  data[idx].sort_order    = aOrd;
  data[swapIdx].sort_order = bOrd;

  await Promise.all([
    sb.from('requirements').update({ sort_order: aOrd }).eq('id', aId),
    sb.from('requirements').update({ sort_order: bOrd }).eq('id', bId),
  ]);

  // Re-render tbody rows in new order (keep existing tr elements, just reorder)
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const byId = Object.fromEntries(rows.map(tr => [tr.dataset.rid, tr]));
  data.forEach(r => { const tr = byId[r.id]; if (tr) tbody.appendChild(tr); });

  // Re-apply collapse visibility
  const collapseKey = `req_collapsed_${parentId}`;
  const collapsed   = new Set(JSON.parse(sessionStorage.getItem(collapseKey) || '[]'));
  applyCollapseState(tbody, data, collapsed);
}

function wireReqDragDrop(tbody, data, parentType, parentId, collapsed) {
  let dragId  = null;
  let dragTr  = null;

  tbody.querySelectorAll('tr[draggable]').forEach(tr => {
    tr.addEventListener('dragstart', e => {
      // Only allow drag when starting on the handle cell
      if (!e.target.closest('.req-drag-handle') && e.target !== tr) {
        e.preventDefault(); return;
      }
      dragId = tr.dataset.rid;
      dragTr = tr;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => tr.classList.add('req-row-dragging'), 0);
    });

    tr.addEventListener('dragend', () => {
      tr.classList.remove('req-row-dragging');
      clearReqDropLine();
      dragId = null; dragTr = null;
    });
  });

  function clearReqDropLine() {
    tbody.querySelectorAll('.req-drop-above, .req-drop-below').forEach(el => {
      el.classList.remove('req-drop-above', 'req-drop-below');
    });
  }

  tbody.addEventListener('dragover', e => {
    if (!dragId) return;
    const tr = e.target.closest('tr[data-rid]');
    if (!tr || tr.dataset.rid === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearReqDropLine();
    // Determine if cursor is in top or bottom half to show drop line
    const rect = tr.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    tr.classList.add(e.clientY < mid ? 'req-drop-above' : 'req-drop-below');
  });

  tbody.addEventListener('dragleave', e => {
    const tr = e.target.closest('tr[data-rid]');
    if (tr && !tr.contains(e.relatedTarget)) {
      tr.classList.remove('req-drop-above', 'req-drop-below');
    }
  });

  tbody.addEventListener('drop', async e => {
    const tr = e.target.closest('tr[data-rid]');
    if (!tr || !dragId || !dragTr) return;
    e.preventDefault();
    clearReqDropLine();

    const targetId = tr.dataset.rid;
    if (targetId === dragId) return;

    // Determine insert position (above or below target)
    const rect   = tr.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;

    const capturedDragId = dragId;
    const capturedDragTr = dragTr;

    // Remove dragged item from data array
    const fromIdx = data.findIndex(r => r.id === capturedDragId);
    const [moved] = data.splice(fromIdx, 1);

    // Find new insert position
    let toIdx = data.findIndex(r => r.id === targetId);
    if (!before) toIdx += 1;
    data.splice(toIdx, 0, moved);

    // Reassign sort_orders to 0..n-1 for clean ordering
    data.forEach((r, i) => { r.sort_order = i; });

    // Update DB in batch
    await Promise.all(data.map(r =>
      sb.from('requirements').update({ sort_order: r.sort_order }).eq('id', r.id)
    ));

    // Reorder DOM rows
    data.forEach(r => {
      const row = tbody.querySelector(`tr[data-rid="${r.id}"]`);
      if (row) tbody.appendChild(row);
    });

    // Update data-sort-order attributes
    tbody.querySelectorAll('tr[data-rid]').forEach(row => {
      const r = data.find(d => d.id === row.dataset.rid);
      if (r) row.dataset.sortOrder = r.sort_order;
    });

    // Re-apply collapse visibility after reorder
    if (collapsed) applyCollapseState(tbody, data, collapsed);
  });
}

// ── Inline insert-below trigger ──────────────────────────────────────────────

function insertTriggerRow(afterRid) {
  return `<tr class="req-insert-trigger" data-after-rid="${afterRid}">
    <td colspan="100" class="req-insert-cell">
      <button class="req-insert-btn" title="Add requirement here">＋</button>
    </td>
  </tr>`;
}

function wireInsertTriggers(tbody, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal, visCols, collapsed) {
  tbody.querySelectorAll('.req-insert-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const triggerRow = btn.closest('.req-insert-trigger');
      if (!triggerRow) return;
      // Only one inline form open at a time
      tbody.querySelectorAll('.req-inline-new-row').forEach(r => r.remove());
      // Restore any previously open trigger
      tbody.querySelectorAll('.req-insert-trigger.open').forEach(r => r.classList.remove('open'));

      const afterRid   = triggerRow.dataset.afterRid;
      const defaultType = Array.isArray(typeFilter) ? typeFilter[0] : (typeFilter || 'functional');

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
            <button class="btn btn-primary btn-sm req-inline-save" style="height:28px;padding:0 10px">Add</button>
            <button class="btn btn-secondary btn-sm req-inline-cancel" style="height:28px;padding:0 8px">✕</button>
          </div>
        </td>`;

      // Insert form row after the trigger row
      triggerRow.after(formRow);
      triggerRow.classList.add('open');
      formRow.querySelector('.req-inline-title-inp').focus();

      const cancel = () => {
        formRow.remove();
        triggerRow.classList.remove('open');
      };

      const save = async () => {
        const title = formRow.querySelector('.req-inline-title-inp').value.trim();
        if (!title) { formRow.querySelector('.req-inline-title-inp').focus(); return; }
        const type  = formRow.querySelector('.req-inline-type-sel').value;

        const saveBtn = formRow.querySelector('.req-inline-save');
        saveBtn.disabled = true;

        const reqIdx  = await nextIndex('requirements', { parent_id: parentId });
        const reqCode = buildCode('REQ', {
          domain:      parentType === 'item' ? 'ITEM' : 'SYS',
          projectName: project.name,
          index:       reqIdx,
        });

        // Compute sort_order: right after the afterRid row
        const afterIdx = data.findIndex(r => r.id === afterRid);
        const insertAt = afterIdx >= 0 ? afterIdx + 1 : data.length;
        const sortOrder = insertAt;

        // Shift existing rows sort_orders >= insertAt
        const toShift = data.slice(insertAt).filter(r => r.sort_order >= insertAt);
        if (toShift.length) {
          await Promise.all(toShift.map(r =>
            sb.from('requirements').update({ sort_order: r.sort_order + 1 }).eq('id', r.id)
          ));
          toShift.forEach(r => { r.sort_order += 1; });
        }

        const { data: newReq, error } = await sb.from('requirements').insert({
          req_code: reqCode, title, type,
          parent_type: parentType, parent_id: parentId,
          status: 'draft', priority: 'medium',
          sort_order: sortOrder,
        }).select().single();

        if (error) { toast(error.message || t('common.error'), 'error'); saveBtn.disabled = false; return; }

        // Insert into data array
        newReq.sort_order = sortOrder;
        data.splice(insertAt, 0, newReq);

        // Build and inject the new row + its trigger into DOM
        const html = reqRow(newReq, project, item, system, showAsil, showDal, visCols)
                   + insertTriggerRow(newReq.id);
        formRow.remove();
        triggerRow.classList.remove('open');

        const tmp = document.createElement('tbody');
        tmp.innerHTML = html;
        const [newTr, newTrigger] = [...tmp.children];
        triggerRow.after(newTr, newTrigger);

        // Wire the new row
        wireNewReqRow(newTr, newTrigger, newReq, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal, visCols, collapsed);

        toast(`${reqCode} added.`, 'success');
      };

      formRow.querySelector('.req-inline-cancel').addEventListener('click', cancel);
      formRow.querySelector('.req-inline-save').addEventListener('click', save);
      formRow.querySelector('.req-inline-title-inp').addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); save(); }
        if (e.key === 'Escape') { cancel(); }
      });
    });
  });
}

function wireNewReqRow(tr, triggerTr, req, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal, visCols, collapsed) {
  // Wire inline selects
  tr.querySelectorAll('.req-inline-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      const { error } = await sb.from('requirements').update({ [sel.dataset.field]: sel.value || null }).eq('id', req.id);
      if (error) toast(t('common.error'), 'error');
      else { const r = data.find(r => r.id === req.id); if (r) r[sel.dataset.field] = sel.value; }
    });
  });
  // Wire inline editable cells
  tr.querySelectorAll('.req-editable').forEach(cell => {
    cell.style.cursor = 'text';
    cell.addEventListener('click', () => {
      if (cell.classList.contains('editing')) return;
      cell.classList.add('editing');
      cell.style.background = '#EEF4FF';
      const inp = document.createElement('input');
      inp.value = data.find(r => r.id === req.id)?.[cell.dataset.field] || '';
      inp.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:13px;font-family:inherit;background:#EEF4FF';
      cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); inp.select();
      const commit = async () => {
        const val = inp.value.trim();
        cell.classList.remove('editing'); cell.style.background = '';
        const r = data.find(r => r.id === req.id);
        if (r && val !== (r[cell.dataset.field] || '')) {
          await sb.from('requirements').update({ [cell.dataset.field]: val || null }).eq('id', req.id);
          if (r) r[cell.dataset.field] = val;
        }
        cell.textContent = val || (cell.dataset.field === 'description' ? '+ description' : '');
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { cell.classList.remove('editing'); cell.textContent = data.find(r => r.id === req.id)?.[cell.dataset.field] || ''; } });
    });
  });
  // Wire up/down arrows
  tr.querySelectorAll('.btn-move-up, .btn-move-dn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tbody = tr.closest('tbody');
      moveReq(btn.dataset.id, btn.classList.contains('btn-move-up') ? -1 : 1, data, tbody, parentType, parentId);
    });
  });
  // Wire delete
  tr.querySelectorAll('.btn-del-req').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sb.from('requirements').delete().eq('id', req.id);
      data.splice(data.findIndex(r => r.id === req.id), 1);
      tr.remove(); triggerTr?.remove();
      toast('Deleted.', 'success');
    });
  });
  // Wire view (open modal)
  tr.querySelectorAll('.btn-view-req').forEach(btn => {
    btn.onclick = () => openReqModal({ project, parentType, parentId, projectType: project.type, existing: req });
  });
  // Wire new insert trigger on the newly added trigger row
  if (triggerTr) {
    const innerBtn = triggerTr.querySelector('.req-insert-btn');
    if (innerBtn) {
      // Re-use same logic by delegating to the tbody handler
      const tbody = tr.closest('tbody');
      if (tbody) wireInsertTriggers(tbody, data, project, item, system, parentType, parentId, typeFilter, showAsil, showDal, visCols, collapsed);
    }
  }
}

// ── Section collapse / expand ─────────────────────────────────────────────────

/**
 * Walk data array and compute which rows should be hidden based on which
 * title sections are in the `collapsed` Set. Supports nested heading levels:
 * collapsing an H2 hides everything until the next H2 (including child H3/H4).
 */
function applyCollapseState(tbody, data, collapsed) {
  const hiddenSet    = new Set();
  const sectionStack = []; // [{id, level}] outermost → innermost

  for (const r of data) {
    if (r.type === 'title') {
      const lvl = r.level || 1;
      // Close sections at same or deeper level — they no longer wrap this title
      while (sectionStack.length && sectionStack[sectionStack.length - 1].level >= lvl) {
        sectionStack.pop();
      }
      // Title itself is hidden if a parent section is collapsed
      if (sectionStack.some(s => collapsed.has(s.id))) hiddenSet.add(r.id);
      // Push this section
      sectionStack.push({ id: r.id, level: lvl });
    } else {
      // Non-title row: hidden if any enclosing section is collapsed
      if (sectionStack.some(s => collapsed.has(s.id))) hiddenSet.add(r.id);
    }
  }

  // Apply visibility to DOM rows
  tbody.querySelectorAll('tr[data-rid]').forEach(tr => {
    const rid  = tr.dataset.rid;
    tr.style.display = hiddenSet.has(rid) ? 'none' : '';
  });

  // Update chevron direction on title rows
  tbody.querySelectorAll('tr.req-title-row').forEach(tr => {
    const btn = tr.querySelector('.req-section-toggle');
    if (!btn) return;
    const isCollapsed = collapsed.has(tr.dataset.rid);
    btn.textContent   = isCollapsed ? '▶' : '▼';
    btn.title         = isCollapsed ? 'Expand section' : 'Collapse section';
  });
}

function wireCollapseSections(tbody, data, collapsed, collapseKey) {
  tbody.querySelectorAll('.req-section-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const rid = btn.dataset.rid;
      if (collapsed.has(rid)) collapsed.delete(rid);
      else                     collapsed.add(rid);
      // Persist
      sessionStorage.setItem(collapseKey, JSON.stringify([...collapsed]));
      applyCollapseState(tbody, data, collapsed);
    });
  });
}

// ── Custom column inline editing ──────────────────────────────────────────────

function wireCustomCols(body, data) {
  body.querySelectorAll('.req-custom-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (cell.querySelector('input')) return;
      const rid       = cell.dataset.rid;
      const colId     = cell.dataset.customCol;
      const r         = data.find(d => d.id === rid);
      const current   = (r?.custom_fields || {})[colId] || '';

      const inp = document.createElement('input');
      inp.value    = current;
      inp.style.cssText = 'width:100%;box-sizing:border-box;border:none;outline:2px solid #1A73E8;border-radius:3px;padding:2px 4px;font-size:12px;font-family:inherit;background:#EEF4FF';
      cell.innerHTML = '';
      cell.appendChild(inp);
      inp.focus(); inp.select();

      const commit = async () => {
        const val = inp.value.trim();
        cell.textContent = val;
        if (!r) return;
        const fields = { ...(r.custom_fields || {}), [colId]: val };
        r.custom_fields = fields;
        await sb.from('requirements').update({ custom_fields: fields }).eq('id', rid);
      };

      inp.addEventListener('blur',    commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { cell.textContent = current; }
      });
    });
  });
}

function renderTraceability(project, parentType, parentId) {
  const body = document.getElementById('req-body');
  body.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="diagram-area">
          <div class="diagram-area-icon">🔗</div>
          <p>Traceability matrix — coming in next version.</p>
          <p class="text-muted" style="font-size:12px">Links requirements to test cases, architecture elements, and safety goals.</p>
        </div>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
