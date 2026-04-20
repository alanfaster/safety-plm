import { sb, buildCode, nextIndex } from '../config.js';
import { t } from '../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { toast } from '../toast.js';

const REQ_TYPES     = ['functional','performance','safety','safety-independency','interface','constraint'];
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
        <button class="btn btn-primary" id="btn-new-req">＋ ${t('req.new')}</button>
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

  if (!typeFilter) {
    container.querySelectorAll('.page-tab').forEach(tab => {
      tab.onclick = () => {
        container.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'matrix') renderTraceability(project, parentType, parentId);
        else loadRequirements(project, parentType, parentId, null, true);
      };
    });
  }

  await loadRequirements(project, parentType, parentId, typeFilter, typeFilter == null);
}

async function loadRequirements(project, parentType, parentId, typeFilter = null, excludeInterface = false) {
  let q = sb.from('requirements')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true });
  if (Array.isArray(typeFilter) && typeFilter.length) q = q.in('type', typeFilter);
  else if (typeFilter) q = q.eq('type', typeFilter);
  else if (excludeInterface) q = q.not('type', 'in', '("interface","safety-independency")');
  const { data, error } = await q;

  const body = document.getElementById('req-body');
  if (error) { body.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

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

  const showAsil = project.type === 'automotive';
  const showDal  = project.type === 'aerospace' || project.type === 'military';

  body.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('req.code')}</th>
              <th>${t('req.title')}</th>
              <th>${t('req.type')}</th>
              <th>${t('req.priority')}</th>
              <th>${t('req.status')}</th>
              ${showAsil ? `<th>${t('req.asil')}</th>` : ''}
              ${showDal  ? `<th>${t('req.dal')}</th>`  : ''}
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => reqRow(r, project.type, showAsil, showDal)).join('')}
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
  wireInlineReqEditing(body, data, project, parentType, parentId, typeFilter, showAsil, showDal);

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
        await loadRequirements(project, parentType, parentId, typeFilter);
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

function reqRow(r, projectType, showAsil, showDal) {
  const ftaLinked = r.source?.startsWith('FTA-AND:');
  return `
    <tr data-rid="${r.id}">
      <td class="code-cell" style="white-space:nowrap">
        ${r.req_code}
        ${ftaLinked ? '<span title="Linked to FTA AND gate" style="margin-left:4px;font-size:10px;color:#1A73E8">⚡</span>' : ''}
      </td>
      <td>
        <div class="req-editable req-title-cell" data-rid="${r.id}" data-field="title" title="Click to edit">${escHtml(r.title)}</div>
        ${r.description ? `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to edit" style="font-size:12px;margin-top:2px">${escHtml(r.description.slice(0, 80))}${r.description.length > 80 ? '…' : ''}</div>` : `<div class="text-muted req-editable req-desc-cell" data-rid="${r.id}" data-field="description" title="Click to add description" style="font-size:11px;color:#aaa">+ description</div>`}
      </td>
      <td>
        <select class="req-inline-sel" data-rid="${r.id}" data-field="type" style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
          ${REQ_TYPES.map(v => `<option value="${v}" ${r.type===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="req-inline-sel" data-rid="${r.id}" data-field="priority" style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
          ${REQ_PRIORITIES.map(v => `<option value="${v}" ${r.priority===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="req-inline-sel" data-rid="${r.id}" data-field="status" style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
          ${REQ_STATUSES.map(v => `<option value="${v}" ${r.status===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      ${showAsil ? `<td>
        <select class="req-inline-sel" data-rid="${r.id}" data-field="asil" style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
          <option value="">—</option>
          ${ASIL_LEVELS.map(v => `<option value="${v}" ${r.asil===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>` : ''}
      ${showDal ? `<td>
        <select class="req-inline-sel" data-rid="${r.id}" data-field="dal" style="font-size:12px;border:1px solid transparent;border-radius:4px;padding:1px 3px;background:transparent;cursor:pointer">
          <option value="">—</option>
          ${DAL_LEVELS.map(v => `<option value="${v}" ${r.dal===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>` : ''}
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-view-req" data-id="${r.id}">Detail</button>
        <button class="btn btn-ghost btn-sm btn-del-req" data-id="${r.id}" data-title="${escHtml(r.title)}">${t('common.delete')}</button>
      </td>
    </tr>
  `;
}

function wireInlineReqEditing(body, data, project, parentType, parentId, typeFilter, showAsil, showDal) {
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
    await loadRequirements(project, parentType, parentId);
  };
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
