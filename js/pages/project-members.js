/**
 * Project Members & Roles tab — mounted from project-settings.js
 * mountMembersTab(container, project, sb, toast)
 *
 * Left panel:  Role definitions (ASPICE defaults + custom)
 * Right panel: Member assignments (user → role)
 */

const ASPICE_DEFAULT_ROLES = [
  // Development
  { name: 'Requirements Engineer',   code: 'REQ',  category: 'development', description: 'Responsible for eliciting, documenting and managing requirements (ASPICE SYS.2 / SWE.1)', sort_order: 10 },
  { name: 'Systems Engineer',        code: 'SYS',  category: 'development', description: 'Responsible for system architecture and system requirements (ASPICE SYS.3)', sort_order: 20 },
  { name: 'Software Architect',      code: 'ARCH', category: 'development', description: 'Responsible for software architectural design (ASPICE SWE.2)', sort_order: 30 },
  { name: 'Software Developer',      code: 'SWE',  category: 'development', description: 'Responsible for detailed design and implementation (ASPICE SWE.3/4)', sort_order: 40 },
  { name: 'Integration Engineer',    code: 'INT',  category: 'development', description: 'Responsible for software integration and integration testing (ASPICE SWE.5)', sort_order: 50 },
  { name: 'Test Engineer',           code: 'TST',  category: 'development', description: 'Responsible for verification and validation activities (ASPICE SWE.6 / SYS.5)', sort_order: 60 },
  { name: 'Safety Manager',          code: 'SAF',  category: 'development', description: 'Responsible for functional safety activities (ISO 26262 / DO-178C safety processes)', sort_order: 70 },
  // Quality & Process
  { name: 'Quality Assurance Engineer', code: 'QA',  category: 'quality', description: 'Ensures process and product quality (ASPICE SUP.1)', sort_order: 80 },
  { name: 'Configuration Manager',   code: 'CM',   category: 'quality', description: 'Manages configuration items and change control (ASPICE SUP.8)', sort_order: 90 },
  { name: 'Problem Resolution Manager', code: 'PRM', category: 'quality', description: 'Manages problem and change requests (ASPICE SUP.9 / SUP.10)', sort_order: 100 },
  // Management
  { name: 'Project Manager',         code: 'PM',   category: 'management', description: 'Plans and monitors the project (ASPICE MAN.3)', sort_order: 110 },
  { name: 'Technical Lead',          code: 'TL',   category: 'management', description: 'Technical leadership and decision-making authority', sort_order: 120 },
  // Review (IEEE 1028 / ASPICE MAN.5)
  { name: 'Review Moderator',        code: 'MOD',  category: 'review', description: 'Plans and leads the review meeting; enforces the process (IEEE 1028 §4.1.4)', sort_order: 130 },
  { name: 'Review Author',           code: 'AUT',  category: 'review', description: 'Owner of the artifact under review; presents the work product', sort_order: 140 },
  { name: 'Reviewer',                code: 'REV',  category: 'review', description: 'Performs the review and records findings (IEEE 1028 §4.1.4)', sort_order: 150 },
  { name: 'Scribe / Recorder',       code: 'SCR',  category: 'review', description: 'Records defects and action items during the review meeting', sort_order: 160 },
];

const CATEGORY_LABELS = {
  development: 'Development',
  quality:     'Quality & Process',
  management:  'Management',
  review:      'Review (IEEE 1028)',
};

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function mountMembersTab(container, project, sb, toast) {
  container.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

  // Load roles, members and all user profiles in parallel
  const [
    { data: rolesRaw },
    { data: membersRaw },
    { data: profiles },
  ] = await Promise.all([
    sb.from('project_roles').select('*').eq('project_id', project.id).order('sort_order'),
    sb.from('project_members').select('*, user_profiles(display_name)').eq('project_id', project.id),
    sb.from('user_profiles').select('user_id, display_name'),
  ]);

  let roles   = rolesRaw   || [];
  let members = membersRaw || [];
  const allUsers = profiles || [];

  // Auto-seed ASPICE defaults if no roles yet
  if (!roles.length) {
    const inserts = ASPICE_DEFAULT_ROLES.map(r => ({ ...r, project_id: project.id }));
    const { data: seeded } = await sb.from('project_roles').insert(inserts).select();
    roles = seeded || [];
    toast('ASPICE default roles seeded.', 'success');
  }

  render();

  function render() {
    container.innerHTML = `
      <div class="members-wrap">

        <!-- LEFT: Roles -->
        <div class="members-roles-col">
          <div class="members-col-header">
            <span class="members-col-title">Project Roles</span>
            <button class="btn btn-primary btn-sm" id="mem-add-role-btn">+ Add Role</button>
          </div>
          <div class="members-roles-list" id="members-roles-list">
            ${renderRolesList()}
          </div>
        </div>

        <!-- RIGHT: Members -->
        <div class="members-people-col">
          <div class="members-col-header">
            <span class="members-col-title">Team Members</span>
            <button class="btn btn-primary btn-sm" id="mem-add-member-btn">+ Add Member</button>
          </div>

          <div id="mem-add-member-form" style="display:none" class="members-add-form">
            <select class="form-input form-select" id="mem-user-select">
              <option value="">— Select user —</option>
              ${allUsers.map(u => `<option value="${u.user_id}">${escHtml(u.display_name || u.user_id.slice(0,8))}</option>`).join('')}
            </select>
            <select class="form-input form-select" id="mem-role-select">
              <option value="">— Select role —</option>
              ${roles.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="mem-save-member-btn">Add</button>
            <button class="btn btn-ghost btn-sm" id="mem-cancel-member-btn">Cancel</button>
          </div>

          <table class="data-table members-table" id="members-table">
            <thead><tr>
              <th>Member</th><th>Role</th><th>Category</th><th style="width:48px"></th>
            </tr></thead>
            <tbody>${renderMembersRows()}</tbody>
          </table>
          ${!members.length ? `<p class="members-empty text-muted">No members assigned yet. Add team members above.</p>` : ''}
        </div>

      </div>
    `;

    wireMembersTab();
  }

  function renderRolesList() {
    const byCategory = {};
    roles.forEach(r => {
      if (!byCategory[r.category]) byCategory[r.category] = [];
      byCategory[r.category].push(r);
    });
    return Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
      const catRoles = byCategory[cat] || [];
      if (!catRoles.length) return '';
      return `
        <div class="members-role-category">
          <div class="members-role-cat-label">${escHtml(label)}</div>
          ${catRoles.map(r => `
            <div class="members-role-item" data-role-id="${r.id}">
              <span class="members-role-code">${escHtml(r.code || '')}</span>
              <span class="members-role-name">${escHtml(r.name)}</span>
              <span class="members-role-actions">
                <button class="btn btn-ghost btn-xs mem-del-role-btn" data-role-id="${r.id}" title="Delete role">✕</button>
              </span>
            </div>`).join('')}
        </div>`;
    }).join('');
  }

  function renderMembersRows() {
    return members.map(m => {
      const role = roles.find(r => r.id === m.role_id);
      const name = m.user_profiles?.display_name || m.user_id?.slice(0,8) || '?';
      return `<tr data-member-id="${m.id}">
        <td>${escHtml(name)}</td>
        <td>${role ? `<span class="members-role-pill">${escHtml(role.code || '')} ${escHtml(role.name)}</span>` : '—'}</td>
        <td class="text-muted">${role ? escHtml(CATEGORY_LABELS[role.category] || role.category) : '—'}</td>
        <td><button class="btn btn-ghost btn-xs mem-del-member-btn" data-member-id="${m.id}" title="Remove">✕</button></td>
      </tr>`;
    }).join('');
  }

  function wireMembersTab() {
    // Add role — show picker with ASPICE suggestions + custom form
    container.querySelector('#mem-add-role-btn').onclick = () => {
      const existing = container.querySelector('#mem-new-role-form');
      if (existing) { existing.remove(); return; }

      const existingNames = new Set(roles.map(r => r.name));
      const suggestions = ASPICE_DEFAULT_ROLES.filter(r => !existingNames.has(r.name));

      const form = document.createElement('div');
      form.id = 'mem-new-role-form';
      form.className = 'members-new-role-panel';
      form.innerHTML = `
        ${suggestions.length ? `
          <div class="members-suggestions-label">Add a standard ASPICE role:</div>
          <div class="members-suggestions-grid">
            ${suggestions.map(r => `
              <button class="members-suggestion-chip" data-name="${escHtml(r.name)}" data-code="${escHtml(r.code)}" data-cat="${escHtml(r.category)}" data-sort="${r.sort_order}" title="${escHtml(r.description || '')}">
                <span class="members-role-code">${escHtml(r.code)}</span> ${escHtml(r.name)}
              </button>`).join('')}
          </div>
          <div class="members-suggestions-sep">or add a custom role:</div>
        ` : ''}
        <div class="members-add-form" style="margin-top:0">
          <input class="form-input" id="mem-new-role-name" placeholder="Role name *" style="flex:1"/>
          <input class="form-input" id="mem-new-role-code" placeholder="Code (e.g. SWE)" style="width:100px"/>
          <select class="form-input form-select" id="mem-new-role-cat">
            ${Object.entries(CATEGORY_LABELS).map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" id="mem-new-role-save">Add</button>
          <button class="btn btn-ghost btn-sm" id="mem-new-role-cancel">Cancel</button>
        </div>
      `;
      container.querySelector('#members-roles-list').before(form);

      // Click on suggestion chip → fill form fields
      form.querySelectorAll('.members-suggestion-chip').forEach(chip => {
        chip.onclick = async () => {
          const sort_order = (roles[roles.length - 1]?.sort_order || 0) + 10;
          const def = ASPICE_DEFAULT_ROLES.find(r => r.name === chip.dataset.name);
          const { data, error } = await sb.from('project_roles')
            .insert({ project_id: project.id, name: def.name, code: def.code,
                      category: def.category, description: def.description, sort_order }).select().single();
          if (error) { toast('Error: ' + error.message, 'error'); return; }
          roles.push(data);
          form.remove();
          render();
        };
      });

      form.querySelector('#mem-new-role-cancel').onclick = () => form.remove();
      form.querySelector('#mem-new-role-save').onclick = async () => {
        const name = form.querySelector('#mem-new-role-name').value.trim();
        if (!name) { form.querySelector('#mem-new-role-name').focus(); return; }
        const code     = form.querySelector('#mem-new-role-code').value.trim().toUpperCase();
        const category = form.querySelector('#mem-new-role-cat').value;
        const sort_order = (roles[roles.length - 1]?.sort_order || 0) + 10;
        const { data, error } = await sb.from('project_roles')
          .insert({ project_id: project.id, name, code, category, sort_order }).select().single();
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        roles.push(data);
        form.remove();
        render();
      };
    };

    // Delete role
    container.querySelectorAll('.mem-del-role-btn').forEach(btn => {
      btn.onclick = async () => {
        const roleId = btn.dataset.roleId;
        const role = roles.find(r => r.id === roleId);
        const inUse = members.some(m => m.role_id === roleId);
        if (inUse && !confirm(`Role "${role?.name}" is assigned to ${members.filter(m => m.role_id === roleId).length} member(s). Delete anyway?`)) return;
        if (!inUse && !confirm(`Delete role "${role?.name}"?`)) return;
        const { error } = await sb.from('project_roles').delete().eq('id', roleId);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        roles = roles.filter(r => r.id !== roleId);
        members = members.filter(m => m.role_id !== roleId);
        render();
      };
    });

    // Show add member form
    container.querySelector('#mem-add-member-btn').onclick = () => {
      const form = container.querySelector('#mem-add-member-form');
      form.style.display = form.style.display === 'none' ? '' : 'none';
    };
    container.querySelector('#mem-cancel-member-btn').onclick = () => {
      container.querySelector('#mem-add-member-form').style.display = 'none';
    };

    // Save new member
    container.querySelector('#mem-save-member-btn').onclick = async () => {
      const userId = container.querySelector('#mem-user-select').value;
      const roleId = container.querySelector('#mem-role-select').value;
      if (!userId || !roleId) { toast('Select a user and a role.', 'error'); return; }
      const already = members.find(m => m.user_id === userId && m.role_id === roleId);
      if (already) { toast('This user already has this role.', 'error'); return; }
      const { data, error } = await sb.from('project_members')
        .insert({ project_id: project.id, user_id: userId, role_id: roleId })
        .select('*, user_profiles(display_name)').single();
      if (error) { toast('Error: ' + error.message, 'error'); return; }
      members.push(data);
      render();
    };

    // Delete member
    container.querySelectorAll('.mem-del-member-btn').forEach(btn => {
      btn.onclick = async () => {
        const memberId = btn.dataset.memberId;
        const { error } = await sb.from('project_members').delete().eq('id', memberId);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        members = members.filter(m => m.id !== memberId);
        render();
      };
    });
  }
}
