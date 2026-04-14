/**
 * Project Settings — PHA field configuration + team members
 */
import { sb, DEFAULT_PHA_FIELDS } from '../config.js';
import { t } from '../i18n/index.js';
import { navigate } from '../router.js';
import { toast } from '../toast.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';

export async function renderProjectSettings(container, ctx) {
  const { project } = ctx;

  setBreadcrumb([
    { label: t('nav.projects'), path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: 'Settings' },
  ]);

  renderSidebar({ view: 'projects', activePage: '' });

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Load project config
  const { data: pcRow } = await sb.from('project_config')
    .select('*').eq('project_id', project.id).maybeSingle();

  const config = pcRow?.config || {};
  const phaOverrides = config.pha_fields || {};

  render(container, project, phaOverrides, pcRow?.id);
}

function render(container, project, phaOverrides, configId) {
  const fields = DEFAULT_PHA_FIELDS.map(f => ({ ...f, ...(phaOverrides[f.key] || {}) }));

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>Project Settings</h1>
          <p class="page-subtitle">${escHtml(project.name)}</p>
        </div>
        <button class="btn btn-secondary" id="btn-back-project">◀ Back to Project</button>
      </div>
    </div>
    <div class="page-body">
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="pha">PHA Fields</button>
        <button class="settings-tab" data-tab="members">Members <span class="badge-soon">soon</span></button>
      </div>

      <div id="tab-pha" class="settings-tab-panel">
        <div class="settings-section">
          <p class="settings-section-desc">
            Configure which fields are shown in the PHL/PHA table and form for this project.
            Label changes only affect this project.
          </p>
          <table class="settings-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Default Label</th>
                <th>Custom Label</th>
                <th style="text-align:center">Visible</th>
              </tr>
            </thead>
            <tbody>
              ${fields.map(f => `
                <tr data-field-key="${f.key}">
                  <td><code class="field-key">${escHtml(f.key)}</code></td>
                  <td style="color:var(--color-text-muted)">${escHtml(DEFAULT_PHA_FIELDS.find(x=>x.key===f.key)?.label || f.label)}</td>
                  <td>
                    <input class="form-input field-label-input" data-key="${f.key}"
                      value="${escHtml(f.label !== DEFAULT_PHA_FIELDS.find(x=>x.key===f.key)?.label ? f.label : '')}"
                      placeholder="${escHtml(DEFAULT_PHA_FIELDS.find(x=>x.key===f.key)?.label || f.label)}"/>
                  </td>
                  <td style="text-align:center">
                    <label class="toggle-switch">
                      <input type="checkbox" class="field-visible-check" data-key="${f.key}" ${f.visible ? 'checked' : ''}/>
                      <span class="toggle-slider"></span>
                    </label>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="btn btn-primary" id="btn-save-pha-config">Save Field Settings</button>
            <button class="btn btn-secondary" id="btn-reset-pha-config">Reset to Defaults</button>
          </div>
        </div>
      </div>

      <div id="tab-members" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">Team member management coming soon.</p>
        </div>
      </div>
    </div>
  `;

  // Tabs
  container.querySelectorAll('.settings-tab').forEach(tab => {
    tab.onclick = () => {
      container.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('.settings-tab-panel').forEach(p => p.style.display = 'none');
      container.querySelector(`#tab-${tab.dataset.tab}`).style.display = '';
    };
  });

  document.getElementById('btn-back-project').onclick = () => navigate(`/project/${project.id}`);

  document.getElementById('btn-save-pha-config').onclick = async () => {
    const btn = document.getElementById('btn-save-pha-config');
    btn.disabled = true;

    const pha_fields = {};
    container.querySelectorAll('[data-field-key]').forEach(row => {
      const key     = row.dataset.fieldKey;
      const labelEl = row.querySelector('.field-label-input');
      const visEl   = row.querySelector('.field-visible-check');
      const defaultLabel = DEFAULT_PHA_FIELDS.find(f => f.key === key)?.label || '';
      const customLabel  = labelEl.value.trim();
      const patch = {};
      if (customLabel && customLabel !== defaultLabel) patch.label = customLabel;
      patch.visible = visEl.checked;
      pha_fields[key] = patch;
    });

    const newConfig = { pha_fields };

    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    toast('Settings saved.', 'success');
  };

  document.getElementById('btn-reset-pha-config').onclick = async () => {
    if (!confirm('Reset all PHA field settings to defaults?')) return;
    if (configId) {
      await sb.from('project_config').update({ config: {}, updated_at: new Date().toISOString() }).eq('id', configId);
    }
    toast('Reset to defaults.', 'success');
    // Reload
    container.querySelectorAll('.field-label-input').forEach(el => { el.value = ''; });
    container.querySelectorAll('.field-visible-check').forEach((el, i) => {
      el.checked = DEFAULT_PHA_FIELDS[i]?.visible ?? true;
    });
  };
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
