/**
 * Projects list — one item per project, created at project creation time.
 */
import { sb, buildCode, nameInitials, nextIndex } from '../config.js';
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

export async function render(container, { user } = {}) {
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
  await loadProjects(user);
}

async function loadProjects(user) {
  const userId = user?.id;
  const [
    { data, error },
    { data: memberships },
    { data: profile },
  ] = await Promise.all([
    sb.from('projects').select('*').order('created_at', { ascending: false }),
    userId ? sb.from('project_members').select('project_id,role').eq('user_id', userId) : Promise.resolve({ data: [] }),
    userId ? sb.from('user_profiles').select('is_app_admin').eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

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

  const isAppAdmin = profile?.is_app_admin || false;
  const roleMap = {};
  (memberships || []).forEach(m => { roleMap[m.project_id] = m.role; });

  // Determine effective role per project
  function roleFor(pid) {
    if (isAppAdmin) return 'admin';
    return roleMap[pid] || null;
  }

  list.innerHTML = `<div class="projects-grid">${data.map(p => projectCard(p, roleFor(p.id))).join('')}</div>`;

  // Wire navigate on card body (not on action buttons)
  list.querySelectorAll('.project-card-body').forEach(body => {
    body.onclick = () => navigate(`/project/${body.dataset.projectId}`);
  });

  // Wire settings button
  list.querySelectorAll('.btn-project-settings').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigate(`/project/${btn.dataset.id}/settings`);
    };
  });

  // Wire rename (admin only)
  list.querySelectorAll('.btn-rename-project').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const card = btn.closest('.project-card');
      const titleEl = card.querySelector('.project-card-title');
      const currentName = btn.dataset.name;
      const input = document.createElement('input');
      input.className = 'form-input project-inline-input';
      input.value = currentName;
      titleEl.style.display = 'none';
      titleEl.parentNode.insertBefore(input, titleEl);
      input.focus(); input.select();
      let done = false;
      async function save() {
        if (done) return; done = true;
        const newName = input.value.trim();
        input.remove(); titleEl.style.display = '';
        if (newName && newName !== currentName) {
          const { error } = await sb.from('projects').update({ name: newName }).eq('id', btn.dataset.id);
          if (error) { toast(t('common.error'), 'error'); return; }
          titleEl.textContent = newName;
          toast('Project renamed.', 'success');
        }
      }
      input.onblur = save;
      input.onkeydown = (ev) => {
        if (ev.key === 'Enter') save();
        if (ev.key === 'Escape') { done = true; input.remove(); titleEl.style.display = ''; }
      };
    };
  });

  // Wire delete (admin only)
  list.querySelectorAll('.btn-delete-project').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      confirmDialog(`Delete project "${btn.dataset.name}"? This cannot be undone.`, async () => {
        const { error } = await sb.from('projects').delete().eq('id', btn.dataset.id);
        if (error) { toast(t('common.error'), 'error'); return; }
        toast('Project deleted.', 'success');
        await loadProjects(user);
      });
    };
  });
}

function projectCard(p, role) {
  const typeLabel = t(`projects.type.${p.type}`);
  const isAdmin = role === 'admin';
  const roleLabel = role ? `<span class="role-badge role-${role}">${role}</span>` : '';
  return `
    <div class="project-card">
      <div class="project-card-body" data-project-id="${p.id}">
        <div class="project-card-title-row">
          <div class="project-card-title">${escHtml(p.name)}</div>
          ${roleLabel}
        </div>
        <div class="project-card-desc">${escHtml(p.item_name || '')}</div>
        <div class="project-card-footer">
          <span class="badge badge-${p.type}">${typeLabel}</span>
          ${p.norm ? `<span class="text-muted">${escHtml(p.norm)}</span>` : ''}
        </div>
      </div>
      <div class="project-card-actions">
        <button class="btn-icon btn-project-settings" data-id="${p.id}" title="Settings">⚙</button>
        ${isAdmin ? `
          <button class="btn-icon btn-rename-project" data-id="${p.id}" data-name="${escHtml(p.name)}" title="Rename">✎</button>
          <button class="btn-icon btn-delete-project" data-id="${p.id}" data-name="${escHtml(p.name)}" title="Delete">✕</button>
        ` : ''}
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
    const itmIdx = await nextIndex('items', { project_id: project.id });
    const { data: item, error: iErr } = await sb.from('items').insert({
      project_id: project.id,
      item_code: buildCode('ITM', { projectName: name, index: itmIdx }),
      name: itemName,
      num_systems: numSystems,
    }).select().single();

    if (iErr) {
      btn.disabled = false; btn.textContent = t('projects.create');
      toast(t('common.error'), 'error'); return;
    }

    // 3. Auto-create systems when numSystems > 1
    if (numSystems > 1) {
      const sysInserts = Array.from({ length: numSystems }, (_, i) => ({
        item_id: item.id,
        system_code: buildCode('SYS', { projectName: name, index: i + 1 }),
        name: `System ${i + 1}`,
      }));
      await sb.from('systems').insert(sysInserts);
    }

    // 4. Assign creator as project admin
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      await sb.from('project_members').insert({
        project_id: project.id,
        user_id: user.id,
        role: 'admin',
      }).onConflict('project_id,user_id').ignore();
    }

    btn.disabled = false; btn.textContent = t('projects.create');
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
