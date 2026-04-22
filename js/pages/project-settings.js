/**
 * Project Settings — PHA field configuration, Function Types (HAZOP), team members
 */
import { sb, DEFAULT_PHA_FIELDS, DEFAULT_FHA_FIELDS } from '../config.js';
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
  const phaOverrides   = config.pha_fields      || {};
  const fhaOverrides   = config.fha_fields      || {};
  const functionTypes  = config.function_types  || [];
  const reqCustomCols      = config.req_custom_cols       || [];
  const archSpecCustomCols = config.arch_spec_custom_cols || [];

  render(container, project, phaOverrides, fhaOverrides, functionTypes, reqCustomCols, archSpecCustomCols, pcRow?.id, config);
}

function render(container, project, phaOverrides, fhaOverrides, functionTypes, reqCustomCols, archSpecCustomCols, configId, fullConfig = {}) {
  const fields    = DEFAULT_PHA_FIELDS.map(f => ({ ...f, ...(phaOverrides[f.key] || {}) }));
  const fhaFields = DEFAULT_FHA_FIELDS.map(f => ({ ...f, ...(fhaOverrides[f.key] || {}) }));

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
        <button class="settings-tab" data-tab="fha">FHA Fields</button>
        <button class="settings-tab" data-tab="funtypes">Function Types</button>
        <button class="settings-tab" data-tab="reqcols">Req Columns</button>
        <button class="settings-tab" data-tab="archspeccols">Arch Spec Columns</button>
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

      <div id="tab-fha" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Configure which columns are shown in the FHA table for this project.
            Label changes only affect this project.
          </p>
          <div class="settings-row" style="margin-bottom:16px;display:flex;align-items:center;gap:12px">
            <label style="font-weight:600;font-size:var(--text-sm);white-space:nowrap">FTA Top Event column:</label>
            <select class="form-input" id="fha-top-event-select" style="max-width:260px">
              ${DEFAULT_FHA_FIELDS.map(f => `<option value="${escHtml(f.key)}" ${(fullConfig.fha_top_event_field||'effect_item')===f.key?'selected':''}>${escHtml(f.label)}</option>`).join('')}
            </select>
            <span style="font-size:var(--text-xs);color:var(--color-text-muted)">One FTA tree created per unique value. Default: Item Effect.</span>
          </div>
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
              ${fhaFields.map(f => `
                <tr data-fha-field-key="${f.key}">
                  <td><code class="field-key">${escHtml(f.key)}</code></td>
                  <td style="color:var(--color-text-muted)">${escHtml(DEFAULT_FHA_FIELDS.find(x=>x.key===f.key)?.label || f.label)}</td>
                  <td>
                    <input class="form-input fha-field-label-input" data-key="${f.key}"
                      value="${escHtml(f.label !== DEFAULT_FHA_FIELDS.find(x=>x.key===f.key)?.label ? f.label : '')}"
                      placeholder="${escHtml(DEFAULT_FHA_FIELDS.find(x=>x.key===f.key)?.label || f.label)}"/>
                  </td>
                  <td style="text-align:center">
                    <label class="toggle-switch">
                      <input type="checkbox" class="fha-field-visible-check" data-key="${f.key}" ${f.visible ? 'checked' : ''}/>
                      <span class="toggle-slider"></span>
                    </label>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="btn btn-primary" id="btn-save-fha-config">Save FHA Field Settings</button>
            <button class="btn btn-secondary" id="btn-reset-fha-config">Reset to Defaults</button>
          </div>
        </div>
      </div>

      <div id="tab-funtypes" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Define function types and their HAZOP failure conditions.
            In the FHA analysis, selecting a function type will offer these failure conditions as checkboxes for bulk entry.
          </p>
          <div id="funtypes-list">
            ${functionTypes.map((ft, i) => renderFunTypeRow(ft, i)).join('')}
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-add-funtype" style="margin-top:12px">＋ Add Function Type</button>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="btn-save-funtypes">Save Function Types</button>
          </div>
        </div>
      </div>

      <div id="tab-reqcols" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Define custom columns that appear in <strong>all requirements pages</strong> of this project.
            Built-in columns (Code, Title, Type, Priority, Status, ASIL/DAL, Verification) are always available.
            Visibility and order can be adjusted per subpage from the requirements table itself.
          </p>
          <table class="settings-table" id="reqcols-table">
            <thead>
              <tr>
                <th>Column Name</th>
                <th style="width:140px">Type</th>
                <th style="width:60px;text-align:center">Delete</th>
              </tr>
            </thead>
            <tbody id="reqcols-tbody">
            </tbody>
          </table>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <input class="form-input" id="reqcols-new-name" placeholder="New column name…" style="max-width:220px"/>
            <select class="form-input form-select" id="reqcols-new-type" style="width:120px">
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="btn-add-reqcol">＋ Add Column</button>
          </div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="btn-save-reqcols">Save Columns</button>
          </div>
        </div>
      </div>

      <div id="tab-archspeccols" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Define custom columns that appear in the <strong>Architecture Specification</strong> table for this project.
            Built-in columns (ID, Description, System, Type, Status) are always available.
            Visibility and order can be adjusted from the table itself.
          </p>
          <table class="settings-table" id="archspeccols-table">
            <thead>
              <tr>
                <th>Column Name</th>
                <th style="width:140px">Type</th>
                <th style="width:60px;text-align:center">Delete</th>
              </tr>
            </thead>
            <tbody id="archspeccols-tbody">
            </tbody>
          </table>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <input class="form-input" id="archspeccols-new-name" placeholder="New column name…" style="max-width:220px"/>
            <select class="form-input form-select" id="archspeccols-new-type" style="width:120px">
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="btn-add-archspeccol">＋ Add Column</button>
          </div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="btn-save-archspeccols">Save Columns</button>
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

    const newConfig = { ...fullConfig, pha_fields };

    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Settings saved.', 'success');
  };

  document.getElementById('btn-reset-pha-config').onclick = async () => {
    if (!confirm('Reset all PHA field settings to defaults?')) return;
    if (configId) {
      await sb.from('project_config').update({ config: { ...fullConfig, pha_fields: {} }, updated_at: new Date().toISOString() }).eq('id', configId);
    }
    toast('Reset to defaults.', 'success');
    container.querySelectorAll('.field-label-input').forEach(el => { el.value = ''; });
    container.querySelectorAll('.field-visible-check').forEach((el, i) => {
      el.checked = DEFAULT_PHA_FIELDS[i]?.visible ?? true;
    });
  };

  // ── FHA Fields tab ─────────────────────────────────────────────────────────

  document.getElementById('btn-save-fha-config').onclick = async () => {
    const btn = document.getElementById('btn-save-fha-config');
    btn.disabled = true;

    const fha_fields = {};
    container.querySelectorAll('[data-fha-field-key]').forEach(row => {
      const key          = row.dataset.fhaFieldKey;
      const labelEl      = row.querySelector('.fha-field-label-input');
      const visEl        = row.querySelector('.fha-field-visible-check');
      const defaultLabel = DEFAULT_FHA_FIELDS.find(f => f.key === key)?.label || '';
      const customLabel  = labelEl.value.trim();
      const patch = {};
      if (customLabel && customLabel !== defaultLabel) patch.label = customLabel;
      patch.visible = visEl.checked;
      fha_fields[key] = patch;
    });

    const fha_top_event_field = document.getElementById('fha-top-event-select')?.value || 'effect_item';
    const newConfig = { ...fullConfig, fha_fields, fha_top_event_field };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('FHA field settings saved.', 'success');
  };

  document.getElementById('btn-reset-fha-config').onclick = async () => {
    if (!confirm('Reset all FHA field settings to defaults?')) return;
    if (configId) {
      await sb.from('project_config').update({ config: { ...fullConfig, fha_fields: {} }, updated_at: new Date().toISOString() }).eq('id', configId);
    }
    toast('Reset to defaults.', 'success');
    container.querySelectorAll('.fha-field-label-input').forEach(el => { el.value = ''; });
    container.querySelectorAll('.fha-field-visible-check').forEach((el, i) => {
      el.checked = DEFAULT_FHA_FIELDS[i]?.visible ?? true;
    });
  };

  // ── Req Columns tab ────────────────────────────────────────────────────────
  let _reqCols = reqCustomCols.map(c => ({ ...c }));

  function renderReqColsTable() {
    const tbody = document.getElementById('reqcols-tbody');
    if (!tbody) return;
    tbody.innerHTML = _reqCols.length
      ? _reqCols.map((c, i) => `
          <tr data-rc-idx="${i}">
            <td>
              <input class="form-input rc-name-input" data-idx="${i}" value="${escHtml(c.name)}"
                placeholder="Column name" style="max-width:300px"/>
            </td>
            <td>
              <select class="form-input form-select rc-type-sel" data-idx="${i}">
                <option value="text"   ${c.type === 'text'   ? 'selected' : ''}>Text</option>
                <option value="number" ${c.type === 'number' ? 'selected' : ''}>Number</option>
              </select>
            </td>
            <td style="text-align:center">
              <button class="btn btn-ghost btn-sm btn-del-reqcol" data-idx="${i}"
                style="color:var(--color-danger)" title="Delete column">✕</button>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--color-text-muted);font-size:13px;padding:12px 8px">No custom columns defined yet.</td></tr>`;

    // Wire inputs
    tbody.querySelectorAll('.rc-name-input').forEach(inp => {
      inp.oninput = () => { _reqCols[parseInt(inp.dataset.idx)].name = inp.value; };
    });
    tbody.querySelectorAll('.rc-type-sel').forEach(sel => {
      sel.onchange = () => { _reqCols[parseInt(sel.dataset.idx)].type = sel.value; };
    });
    tbody.querySelectorAll('.btn-del-reqcol').forEach(btn => {
      btn.onclick = () => {
        _reqCols.splice(parseInt(btn.dataset.idx), 1);
        renderReqColsTable();
      };
    });
  }

  renderReqColsTable();

  document.getElementById('btn-add-reqcol').onclick = () => {
    const nameEl = document.getElementById('reqcols-new-name');
    const typeEl = document.getElementById('reqcols-new-type');
    const name   = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    _reqCols.push({ id: 'custom_' + Date.now(), name, type: typeEl.value || 'text' });
    nameEl.value = '';
    renderReqColsTable();
  };
  document.getElementById('reqcols-new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-reqcol').click(); }
  });

  document.getElementById('btn-save-reqcols').onclick = async () => {
    const btn = document.getElementById('btn-save-reqcols');
    btn.disabled = true;

    // Read any unsaved name inputs
    document.querySelectorAll('.rc-name-input').forEach(inp => {
      const i = parseInt(inp.dataset.idx);
      if (_reqCols[i]) _reqCols[i].name = inp.value.trim() || _reqCols[i].name;
    });

    const newConfig = { ...fullConfig, req_custom_cols: _reqCols };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Requirement columns saved.', 'success');
  };

  // ── Arch Spec Columns tab ─────────────────────────────────────────────────
  let _archSpecCols = archSpecCustomCols.map(c => ({ ...c }));

  function renderArchSpecColsTable() {
    const tbody = document.getElementById('archspeccols-tbody');
    if (!tbody) return;
    tbody.innerHTML = _archSpecCols.length
      ? _archSpecCols.map((c, i) => `
          <tr data-asc-idx="${i}">
            <td>
              <input class="form-input asc-name-input" data-idx="${i}" value="${escHtml(c.name)}"
                placeholder="Column name" style="max-width:300px"/>
            </td>
            <td>
              <select class="form-input form-select asc-type-sel" data-idx="${i}">
                <option value="text"   ${c.type === 'text'   ? 'selected' : ''}>Text</option>
                <option value="number" ${c.type === 'number' ? 'selected' : ''}>Number</option>
              </select>
            </td>
            <td style="text-align:center">
              <button class="btn btn-ghost btn-sm btn-del-archspeccol" data-idx="${i}"
                style="color:var(--color-danger)" title="Delete column">✕</button>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--color-text-muted);font-size:13px;padding:12px 8px">No custom columns defined yet.</td></tr>`;

    tbody.querySelectorAll('.asc-name-input').forEach(inp => {
      inp.oninput = () => { _archSpecCols[parseInt(inp.dataset.idx)].name = inp.value; };
    });
    tbody.querySelectorAll('.asc-type-sel').forEach(sel => {
      sel.onchange = () => { _archSpecCols[parseInt(sel.dataset.idx)].type = sel.value; };
    });
    tbody.querySelectorAll('.btn-del-archspeccol').forEach(btn => {
      btn.onclick = () => {
        _archSpecCols.splice(parseInt(btn.dataset.idx), 1);
        renderArchSpecColsTable();
      };
    });
  }

  renderArchSpecColsTable();

  document.getElementById('btn-add-archspeccol').onclick = () => {
    const nameEl = document.getElementById('archspeccols-new-name');
    const typeEl = document.getElementById('archspeccols-new-type');
    const name   = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    _archSpecCols.push({ id: 'custom_' + Date.now(), name, type: typeEl.value || 'text' });
    nameEl.value = '';
    renderArchSpecColsTable();
  };
  document.getElementById('archspeccols-new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-archspeccol').click(); }
  });

  document.getElementById('btn-save-archspeccols').onclick = async () => {
    const btn = document.getElementById('btn-save-archspeccols');
    btn.disabled = true;

    document.querySelectorAll('.asc-name-input').forEach(inp => {
      const i = parseInt(inp.dataset.idx);
      if (_archSpecCols[i]) _archSpecCols[i].name = inp.value.trim() || _archSpecCols[i].name;
    });

    const newConfig = { ...fullConfig, arch_spec_custom_cols: _archSpecCols };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Arch spec columns saved.', 'success');
  };

  // ── Function Types tab ─────────────────────────────────────────────────────
  let _funTypes = functionTypes.map(ft => ({ ...ft, failure_conditions: [...(ft.failure_conditions || [])] }));

  function refreshFunTypesList() {
    document.getElementById('funtypes-list').innerHTML =
      _funTypes.map((ft, i) => renderFunTypeRow(ft, i)).join('');
    wireFunTypeRows();
  }

  function wireFunTypeRows() {
    // Delete type
    container.querySelectorAll('.btn-del-funtype').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        _funTypes.splice(idx, 1);
        refreshFunTypesList();
      };
    });
    // Add failure condition
    container.querySelectorAll('.btn-add-fc').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        const inputEl = container.querySelector(`.fc-new-input[data-idx="${idx}"]`);
        const val = inputEl?.value.trim();
        if (!val) return;
        _funTypes[idx].failure_conditions.push(val);
        inputEl.value = '';
        refreshFunTypesList();
      };
    });
    // Delete failure condition
    container.querySelectorAll('.btn-del-fc').forEach(btn => {
      btn.onclick = () => {
        const { idx, fc } = btn.dataset;
        _funTypes[idx].failure_conditions = _funTypes[idx].failure_conditions.filter((_, i) => i !== parseInt(fc));
        refreshFunTypesList();
      };
    });
    // Name input live update
    container.querySelectorAll('.funtype-name-input').forEach(inp => {
      inp.oninput = () => {
        _funTypes[parseInt(inp.dataset.idx)].name = inp.value;
      };
    });
    // FC new input enter key
    container.querySelectorAll('.fc-new-input').forEach(inp => {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); container.querySelector(`.btn-add-fc[data-idx="${inp.dataset.idx}"]`)?.click(); }
      };
    });
  }

  wireFunTypeRows();

  document.getElementById('btn-add-funtype').onclick = () => {
    _funTypes.push({ id: crypto.randomUUID(), name: 'New Type', failure_conditions: [] });
    refreshFunTypesList();
  };

  document.getElementById('btn-save-funtypes').onclick = async () => {
    const btn = document.getElementById('btn-save-funtypes');
    btn.disabled = true;

    // Read current name inputs
    container.querySelectorAll('.funtype-name-input').forEach(inp => {
      _funTypes[parseInt(inp.dataset.idx)].name = inp.value.trim() || 'Unnamed';
    });

    const newConfig = { ...fullConfig, function_types: _funTypes };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Function types saved.', 'success');
  };
}

function renderFunTypeRow(ft, i) {
  const fcList = (ft.failure_conditions || []).map((fc, fi) => `
    <div class="fc-item">
      <span class="fc-text">${escHtml(fc)}</span>
      <button class="btn-icon btn-del-fc" data-idx="${i}" data-fc="${fi}" title="Remove">✕</button>
    </div>`).join('');

  return `
    <div class="funtype-row" data-idx="${i}">
      <div class="funtype-header">
        <input class="form-input funtype-name-input" data-idx="${i}" value="${escHtml(ft.name)}" placeholder="Type name *" style="max-width:280px"/>
        <button class="btn btn-danger btn-sm btn-del-funtype" data-idx="${i}">✕ Remove type</button>
      </div>
      <div class="funtype-fcs">
        <div class="fc-label">HAZOP Failure Conditions:</div>
        <div class="fc-list" id="fc-list-${i}">
          ${fcList || `<span class="text-muted" style="font-size:var(--text-xs)">No conditions yet</span>`}
        </div>
        <div class="fc-add-row">
          <input class="form-input fc-new-input" data-idx="${i}" placeholder="Add failure condition…" style="flex:1"/>
          <button class="btn btn-secondary btn-sm btn-add-fc" data-idx="${i}">＋ Add</button>
        </div>
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
