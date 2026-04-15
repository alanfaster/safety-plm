import { sb, buildCode, nextIndex } from '../config.js';
import { t } from '../i18n/index.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { toast } from '../toast.js';

const REQ_TYPES     = ['functional','performance','safety','interface','constraint'];
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
      if (pg.name.toLowerCase().includes('interface')) typeFilter = 'interface';
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

  document.getElementById('btn-new-req').onclick = () =>
    openReqModal({ project, parentType, parentId, projectType: project.type,
      defaultType: typeFilter || undefined });

  if (!typeFilter) {
    container.querySelectorAll('.page-tab').forEach(tab => {
      tab.onclick = () => {
        container.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'matrix') renderTraceability(project, parentType, parentId);
        else loadRequirements(project, parentType, parentId, null);
      };
    });
  }

  await loadRequirements(project, parentType, parentId, typeFilter);
}

async function loadRequirements(project, parentType, parentId, typeFilter = null) {
  let q = sb.from('requirements')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true });
  if (typeFilter) q = q.eq('type', typeFilter);
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

  body.querySelectorAll('.btn-del-req').forEach(btn => {
    btn.onclick = () => confirmDialog(
      `${t('common.confirm_delete')} "${btn.dataset.title}"?`,
      async () => {
        await sb.from('requirements').delete().eq('id', btn.dataset.id);
        await loadRequirements(project, parentType, parentId);
        toast('Requirement deleted.', 'success');
      }
    );
  });
}

function reqRow(r, projectType, showAsil, showDal) {
  return `
    <tr>
      <td class="code-cell">${r.req_code}</td>
      <td><strong>${escHtml(r.title)}</strong>
        ${r.description ? `<div class="text-muted" style="font-size:12px;margin-top:2px">${escHtml(r.description.slice(0, 80))}${r.description.length > 80 ? '…' : ''}</div>` : ''}
      </td>
      <td><span class="badge badge-${r.priority}">${r.type}</span></td>
      <td><span class="badge badge-${r.priority}">${r.priority}</span></td>
      <td>
        <span class="status-dot ${r.status}"></span>
        <span style="margin-left:4px">${t(`common.${r.status}`) || r.status}</span>
      </td>
      ${showAsil ? `<td>${r.asil ? `<span class="asil-badge asil-${r.asil.replace('ASIL-','')}">${r.asil}</span>` : '—'}</td>` : ''}
      ${showDal  ? `<td>${r.dal  ? `<span class="asil-badge dal-${r.dal.replace('DAL-','')}">${r.dal}</span>` : '—'}</td>` : ''}
      <td class="actions-cell">
        <button class="btn btn-ghost btn-sm btn-view-req" data-id="${r.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-del-req" data-id="${r.id}" data-title="${escHtml(r.title)}">${t('common.delete')}</button>
      </td>
    </tr>
  `;
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
