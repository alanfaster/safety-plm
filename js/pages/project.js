import { sb, genCode } from '../config.js';
import { t } from '../i18n/index.js';
import { navigate } from '../router.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';
import { toast } from '../toast.js';

export async function render(container, { projectId }) {
  // Load project
  const { data: project, error } = await sb.from('projects').select('*').eq('id', projectId).single();
  if (error || !project) { container.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  setBreadcrumb([
    { label: t('nav.projects'), path: '/projects' },
    { label: project.name },
  ]);
  renderSidebar({ view: 'project', projectId, projectType: project.type, activePage: 'project' });

  const typeLabel = t(`projects.type.${project.type}`);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${escHtml(project.name)}</h1>
          <p>
            <span class="badge badge-${project.type}">${typeLabel}</span>
            ${project.norm ? `<span style="margin-left:8px" class="text-muted">${escHtml(project.norm)}</span>` : ''}
            ${project.description ? `<span style="margin-left:8px" class="text-muted">${escHtml(project.description)}</span>` : ''}
          </p>
        </div>
        <button class="btn btn-primary" id="btn-new-item">＋ ${t('items.new')}</button>
      </div>
    </div>
    <div class="page-body">
      <div id="items-list"><div class="content-loading"><div class="spinner"></div></div></div>
    </div>
  `;

  document.getElementById('btn-new-item').onclick = () => openNewItemModal(project);
  await loadItems(project);
}

async function loadItems(project) {
  const { data, error } = await sb.from('items')
    .select('*')
    .eq('project_id', project.id)
    .order('created_at', { ascending: true });

  const list = document.getElementById('items-list');
  if (error) { list.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  if (!data.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <h3>${t('items.empty')}</h3>
        <p>${t('items.empty_desc')}</p>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('items.id')}</th>
              <th>${t('common.name')}</th>
              <th>${t('common.description')}</th>
              <th>${t('common.status')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(item => `
              <tr>
                <td class="code-cell">${item.item_code}</td>
                <td>
                  <a href="#" class="item-link" data-id="${item.id}">${escHtml(item.name)}</a>
                </td>
                <td class="text-muted">${escHtml(item.description || '')}</td>
                <td><span class="badge badge-${item.status}">${t(`common.${item.status}`) || item.status}</span></td>
                <td class="actions-cell">
                  <button class="btn btn-ghost btn-sm btn-delete" data-id="${item.id}" data-name="${escHtml(item.name)}">
                    ${t('common.delete')}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  list.querySelectorAll('.item-link').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); navigate(`/project/${project.id}/item/${a.dataset.id}/vcycle/item_definition`); };
  });

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = () => confirmDialog(
      `${t('common.confirm_delete')} "${btn.dataset.name}"?`,
      async () => {
        await sb.from('items').delete().eq('id', btn.dataset.id);
        await loadItems(project);
        toast(`Item deleted.`, 'success');
      }
    );
  });
}

function openNewItemModal(project) {
  showModal({
    title: t('items.new'),
    body: `
      <div class="form-grid cols-1">
        <div class="form-group">
          <label class="form-label">${t('items.name')} *</label>
          <input class="form-input" id="i-name" placeholder="e.g. Electric Parking Brake" maxlength="120"/>
        </div>
        <div class="form-group">
          <label class="form-label">Number of systems *</label>
          <select class="form-input form-select" id="i-numsys">
            ${[1,2,3,4,5,6,7,8].map(n =>
              `<option value="${n}">${n}${n===1 ? ' (item = single system)' : ''}</option>`
            ).join('')}
          </select>
          <span class="form-hint">1 = item acts as its own system (4 domain V-cycles). 2+ = item-level + per-system V-cycles.</span>
        </div>
        <div class="form-group">
          <label class="form-label">${t('items.description')}</label>
          <textarea class="form-input form-textarea" id="i-desc" rows="2"></textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-create">${t('items.create')}</button>
    `
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-create').onclick = async () => {
    const name = document.getElementById('i-name').value.trim();
    const desc = document.getElementById('i-desc').value.trim();
    const numSystems = parseInt(document.getElementById('i-numsys').value) || 1;
    if (!name) { document.getElementById('i-name').focus(); return; }

    const btn = document.getElementById('m-create');
    btn.disabled = true;

    const { data, error } = await sb.from('items').insert({
      project_id: project.id,
      item_code: genCode('ITM'),
      name, description: desc,
      num_systems: numSystems,
    }).select().single();

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    hideModal();
    toast(`Item "${name}" created.`, 'success');
    // Single-system → domain route; multi-system → item vcycle
    if (numSystems === 1) {
      navigate(`/project/${project.id}/item/${data.id}/domain/system/vcycle/item_definition`);
    } else {
      navigate(`/project/${project.id}/item/${data.id}/vcycle/item_definition`);
    }
  };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
