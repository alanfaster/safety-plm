/**
 * Projects list — one item per project, created at project creation time.
 */
import { sb, genCode } from '../config.js';
import { t } from '../i18n/index.js';
import { navigate } from '../router.js';
import { showModal, hideModal, confirmDialog } from '../components/modal.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';
import { toast } from '../toast.js';

const PROJECT_TYPES = ['automotive', 'aerospace', 'military'];

const NORMS = {
  automotive: ['ISO 26262', 'ISO 21434', 'SOTIF (ISO 21448)'],
  aerospace:  ['ARP4761', 'DO-178C', 'DO-254', 'ARP4754A'],
  military:   ['MIL-STD-882', 'DEF STAN 00-56', 'MIL-STD-461'],
};

export async function render(container) {
  setBreadcrumb([{ label: t('nav.projects') }]);
  renderSidebar({ view: 'projects', activePage: 'projects' });

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div><h1>${t('projects.title')}</h1></div>
        <button class="btn btn-primary" id="btn-new-project">＋ ${t('projects.new')}</button>
      </div>
    </div>
    <div class="page-body">
      <div id="projects-list"><div class="content-loading"><div class="spinner"></div></div></div>
    </div>
  `;

  document.getElementById('btn-new-project').onclick = openNewProjectModal;
  await loadProjects();
}

async function loadProjects() {
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: false });
  const list = document.getElementById('projects-list');

  if (error) { list.innerHTML = `<p class="text-muted">${t('common.error')}</p>`; return; }

  if (!data.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>${t('projects.empty')}</h3>
        <p>${t('projects.empty_desc')}</p>
        <button class="btn btn-primary" onclick="document.getElementById('btn-new-project').click()">
          ＋ ${t('projects.new')}
        </button>
      </div>
    `;
    return;
  }

  list.innerHTML = `<div class="projects-grid">${data.map(projectCard).join('')}</div>`;
  list.querySelectorAll('[data-project-id]').forEach(card => {
    card.onclick = () => navigate(`/project/${card.dataset.projectId}`);
  });
}

function projectCard(p) {
  const typeLabel = t(`projects.type.${p.type}`);
  return `
    <div class="project-card" data-project-id="${p.id}">
      <div class="project-card-title">${escHtml(p.name)}</div>
      <div class="project-card-desc">${escHtml(p.item_name || '')}</div>
      <div class="project-card-footer">
        <span class="badge badge-${p.type}">${typeLabel}</span>
        ${p.norm ? `<span class="text-muted">${escHtml(p.norm)}</span>` : ''}
      </div>
    </div>
  `;
}

function openNewProjectModal() {
  showModal({
    title: t('projects.new'),
    large: true,
    body: `
      <div class="form-grid cols-1">
        <div class="form-group">
          <label class="form-label">${t('projects.name')} *</label>
          <input class="form-input" id="p-name" placeholder="e.g. Brake Control System" maxlength="120"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('projects.type')} *</label>
          <select class="form-input form-select" id="p-type">
            ${PROJECT_TYPES.map(k => `<option value="${k}">${t(`projects.type.${k}`)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('projects.norm')}</label>
          <select class="form-input form-select" id="p-norm">
            <option value="">— Select —</option>
            ${NORMS.automotive.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('projects.description')}</label>
          <textarea class="form-input form-textarea" id="p-desc" rows="2" placeholder="Brief description..."></textarea>
        </div>
      </div>
      <div class="form-grid cols-1" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border)">
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:8px">Item / Top-Level System</p>
        <div class="form-group">
          <label class="form-label">${t('items.name')} *</label>
          <input class="form-input" id="i-name" placeholder="e.g. Electric Parking Brake ECU" maxlength="120"/>
        </div>
        <div class="form-group">
          <label class="form-label">Number of systems *</label>
          <select class="form-input form-select" id="i-numsys">
            ${[1,2,3,4,5,6,7,8].map(n =>
              `<option value="${n}">${n}${n===1 ? ' — item is the system (4-domain V-cycle)' : ''}</option>`
            ).join('')}
          </select>
          <span class="form-hint">1 = single system with Sys/SW/HW/MECH domains. 2+ = item-level + per-system V-cycles.</span>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-create">${t('projects.create')}</button>
    `
  });

  document.getElementById('m-cancel').onclick = hideModal;

  // Update norm options when type changes
  const typeEl = document.getElementById('p-type');
  typeEl.onchange = () => {
    const normSel = document.getElementById('p-norm');
    normSel.innerHTML = '<option value="">— Select —</option>' +
      (NORMS[typeEl.value] || []).map(n => `<option value="${n}">${n}</option>`).join('');
  };

  document.getElementById('m-create').onclick = async () => {
    const name     = document.getElementById('p-name').value.trim();
    const itemName = document.getElementById('i-name').value.trim();
    const type     = document.getElementById('p-type').value;
    const norm     = document.getElementById('p-norm').value;
    const desc     = document.getElementById('p-desc').value.trim();
    const numSystems = parseInt(document.getElementById('i-numsys').value) || 1;

    if (!name)     { document.getElementById('p-name').focus(); return; }
    if (!itemName) { document.getElementById('i-name').focus(); return; }

    const btn = document.getElementById('m-create');
    btn.disabled = true; btn.textContent = '...';

    // 1. Create project
    const { data: project, error: pErr } = await sb.from('projects')
      .insert({ name, type, norm, description: desc, item_name: itemName })
      .select().single();

    if (pErr) {
      btn.disabled = false; btn.textContent = t('projects.create');
      toast(t('common.error'), 'error'); return;
    }

    // 2. Create the single item
    const { data: item, error: iErr } = await sb.from('items').insert({
      project_id: project.id,
      item_code: genCode('ITM'),
      name: itemName,
      num_systems: numSystems,
    }).select().single();

    btn.disabled = false; btn.textContent = t('projects.create');

    if (iErr) { toast(t('common.error'), 'error'); return; }

    hideModal();
    toast(`Project "${name}" created.`, 'success');

    // Navigate directly to the item
    if (numSystems === 1) {
      navigate(`/project/${project.id}/item/${item.id}/domain/system/vcycle/item_definition`);
    } else {
      navigate(`/project/${project.id}/item/${item.id}/vcycle/item_definition`);
    }
  };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
