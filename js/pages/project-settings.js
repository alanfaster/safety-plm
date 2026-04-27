/**
 * Project Settings — PHA field configuration, Function Types (HAZOP), team members
 */
import { sb, DEFAULT_PHA_FIELDS, DEFAULT_FHA_FIELDS } from '../config.js';
import { t } from '../i18n/index.js';
import { navigate } from '../router.js';
import { toast } from '../toast.js';
import { setBreadcrumb } from '../components/topbar.js';
import { renderSidebar } from '../components/sidebar.js';
import { mountVmodelEditor, VMODEL_NODES as _VMODEL_NODES, PHASE_DB_SOURCE as _PHASE_DB_SOURCE } from '../components/vmodel-editor.js';
import { mountReviewTemplatesTab } from './review-templates.js';
export { _VMODEL_NODES as VMODEL_NODES, _PHASE_DB_SOURCE as PHASE_DB_SOURCE };

export async function renderProjectSettings(container, ctx) {
  const { project } = ctx;

  setBreadcrumb([
    { label: t('nav.projects'), path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: 'Settings' },
  ]);

  renderSidebar({ view: 'projects', activePage: '' });

  container.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

  // Load project config + function types from DB
  const [{ data: pcRow }, { data: ftRows }, { data: fcRows }] = await Promise.all([
    sb.from('project_config').select('*').eq('project_id', project.id).maybeSingle(),
    sb.from('function_types').select('*').eq('project_id', project.id).order('sort_order'),
    sb.from('function_type_fcs').select('*').order('sort_order'),
  ]);

  const config = pcRow?.config || {};
  const phaOverrides   = config.pha_fields      || {};
  const fhaOverrides   = config.fha_fields      || {};
  const reqCustomCols      = config.req_custom_cols       || [];
  const archSpecCustomCols = config.arch_spec_custom_cols || [];
  const testTypes           = config.test_types            || [];
  const traceFields         = config.traceability_fields   || [];
  const vmodelLinks         = config.vmodel_links          || [];
  const vmodelCanvasNodes   = config.vmodel_canvas_nodes   || [];

  // Build function types from DB rows (or defaults if none saved yet)
  let functionTypes;
  if (ftRows?.length) {
    functionTypes = ftRows.map(ft => ({
      id: ft.id,
      name: ft.name,
      sort_order: ft.sort_order,
      failure_conditions: (fcRows || []).filter(fc => fc.function_type_id === ft.id).sort((a,b) => a.sort_order - b.sort_order).map(fc => ({ id: fc.id, label: fc.label })),
    }));
  } else {
    functionTypes = DEFAULT_FUNCTION_TYPES.map((d, i) => ({
      id: null, name: d.name, sort_order: i,
      failure_conditions: d.failure_conditions.map((label, j) => ({ id: null, label, sort_order: j })),
    }));
  }

  render(container, project, phaOverrides, fhaOverrides, functionTypes, reqCustomCols, archSpecCustomCols, testTypes, traceFields, vmodelLinks, vmodelCanvasNodes, pcRow?.id, config, !ftRows?.length);
}


const TRACE_SOURCE_OPTIONS = [
  { value: 'requirements',           label: 'All Requirements' },
  { value: 'req:customer',           label: 'Customer Requirements' },
  { value: 'req:interface',          label: 'Interface Requirements' },
  { value: 'req:software',           label: 'SW Requirements' },
  { value: 'req:safety',             label: 'Safety Requirements' },
  { value: 'arch_spec_items',        label: 'Architecture Items' },
  { value: 'free_text',              label: 'Free text (no lookup)' },
];

const DEFAULT_TRACE_FIELDS = [
  { id: 'cust_reqs',   label: 'Customer Requirements', source: 'req:customer' },
  { id: 'sw_reqs',     label: 'SW Requirements',       source: 'req:software' },
  { id: 'arch_items',  label: 'Architecture Items',    source: 'arch_spec_items' },
  { id: 'functions',   label: 'Functions',             source: 'free_text' },
];

const DEFAULT_FUNCTION_TYPES = [
  { name: 'Communication',            failure_conditions: ['No communication', 'Delayed communication', 'Erroneous communication', 'Unintended communication', 'Interrupted communication'] },
  { name: 'Control',                  failure_conditions: ['No control output', 'Delayed control output', 'Erroneous control output', 'Unintended control output', 'Control output out of range', 'Stuck control output'] },
  { name: 'Sensing / Measurement',    failure_conditions: ['No signal', 'Signal too high', 'Signal too low', 'Intermittent signal', 'Erroneous signal', 'Delayed signal', 'Signal drift'] },
  { name: 'Actuation',                failure_conditions: ['No actuation', 'Unintended actuation', 'Delayed actuation', 'Actuation out of range', 'Stuck in active state', 'Stuck in inactive state'] },
  { name: 'Power Supply',             failure_conditions: ['No power', 'Undervoltage', 'Overvoltage', 'Power interruption', 'Reverse polarity', 'Excessive ripple'] },
  { name: 'Processing / Computation', failure_conditions: ['No output', 'Erroneous output', 'Delayed output', 'Unexpected output', 'Processing freeze / hang', 'Data corruption'] },
  { name: 'Memory / Storage',         failure_conditions: ['Data loss', 'Data corruption', 'Read failure', 'Write failure', 'Unintended data modification', 'Memory overflow'] },
  { name: 'Monitoring / Diagnostics', failure_conditions: ['No detection of fault', 'False positive detection', 'Delayed fault detection', 'Incorrect fault classification', 'Monitoring disabled unintentionally'] },
  { name: 'Protection / Safety Function', failure_conditions: ['Failure to activate', 'Unintended activation', 'Delayed activation', 'Partial activation', 'Protection disabled'] },
  { name: 'Interlocking / Inhibit',   failure_conditions: ['Interlock not triggered', 'Interlock triggered incorrectly', 'Interlock delayed', 'Interlock stuck active', 'Interlock stuck inactive'] },
  { name: 'Mechanical Function',      failure_conditions: ['No movement', 'Movement in wrong direction', 'Movement out of range', 'Stuck', 'Excessive vibration', 'Mechanical failure / fracture'] },
  { name: 'Thermal Management',       failure_conditions: ['Overheating', 'Undercooling', 'Thermal runaway', 'Cooling failure', 'Uneven temperature distribution'] },
];

function render(container, project, phaOverrides, fhaOverrides, functionTypes, reqCustomCols, archSpecCustomCols, testTypes, traceFields, vmodelLinks, vmodelCanvasNodes, configId, fullConfig = {}, ftFirstLoad = false) {
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
        <button class="settings-tab" data-tab="testtypes">Test Types</button>
        <button class="settings-tab" data-tab="vmodel">V-Model Links</button>
        <button class="settings-tab" data-tab="reviews">Review Protocols</button>
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
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center">
            <button class="btn btn-secondary btn-sm" id="btn-add-funtype">＋ Add Function Type</button>
            <button class="btn btn-ghost btn-sm" id="btn-load-funtype-defaults">↺ Reset to defaults</button>
            <span id="funtypes-autosave-indicator" style="font-size:var(--text-xs);color:var(--color-text-muted);margin-left:4px"></span>
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

      <div id="tab-testtypes" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Define the <strong>Type</strong> options available in Test Specifications for this project.
            Each type has a label and an optional short key used internally.
          </p>
          <table class="settings-table" id="testtypes-table">
            <thead>
              <tr>
                <th>Label</th>
                <th style="width:160px">Key / ID</th>
                <th style="width:60px;text-align:center">Delete</th>
              </tr>
            </thead>
            <tbody id="testtypes-tbody">
            </tbody>
          </table>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <input class="form-input" id="testtypes-new-label" placeholder="Label (e.g. Test, Inspection)…" style="max-width:260px"/>
            <input class="form-input" id="testtypes-new-key" placeholder="Key (optional, e.g. test)…" style="max-width:180px"/>
            <button class="btn btn-secondary btn-sm" id="btn-add-testtype">＋ Add Type</button>
          </div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="btn-save-testtypes">Save Test Types</button>
          </div>
        </div>
      </div>

      <div id="tab-vmodel" class="settings-tab-panel" style="display:none">
        <div id="vme-mount"></div>
      </div>

      <div id="tab-tracefields" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">
            Define the <strong>Traceability</strong> fields shown in Test Specifications.
            Each field can pull its options from a DB table (Requirements, Architecture Items) or accept free text.
          </p>
          <table class="settings-table" id="tracefields-table">
            <thead>
              <tr>
                <th>Label</th>
                <th style="width:220px">Source</th>
                <th style="width:60px;text-align:center">Delete</th>
              </tr>
            </thead>
            <tbody id="tracefields-tbody">
            </tbody>
          </table>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="form-input" id="tracefields-new-label" placeholder="Field label (e.g. Detail Design)…" style="max-width:260px"/>
            <select class="form-input form-select" id="tracefields-new-source" style="width:200px">
              ${TRACE_SOURCE_OPTIONS.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="btn-add-tracefield">＋ Add Field</button>
          </div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="btn-save-tracefields">Save Traceability Fields</button>
          </div>
        </div>
      </div>

      <div id="tab-reviews" class="settings-tab-panel" style="display:none">
        <div class="settings-section" id="tab-reviews-inner"></div>
      </div>

      <div id="tab-members" class="settings-tab-panel" style="display:none">
        <div class="settings-section">
          <p class="settings-section-desc">Team member management coming soon.</p>
        </div>
      </div>
    </div>
  `;

  // Tabs
  let _reviewsMounted = false;
  container.querySelectorAll('.settings-tab').forEach(tab => {
    tab.onclick = () => {
      container.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('.settings-tab-panel').forEach(p => p.style.display = 'none');
      container.querySelector(`#tab-${tab.dataset.tab}`).style.display = '';
      // Lazy-mount review templates tab on first activation
      if (tab.dataset.tab === 'reviews' && !_reviewsMounted) {
        _reviewsMounted = true;
        const reviewContainer = container.querySelector('#tab-reviews-inner');
        mountReviewTemplatesTab(reviewContainer, project, sb, toast);
      }
    };
  });

  document.getElementById('btn-back-project').onclick = () => {
    const returnHash = sessionStorage.getItem('settings_return_hash');
    sessionStorage.removeItem('settings_return_hash');
    if (returnHash && returnHash !== window.location.hash) {
      window.location.hash = returnHash;
    } else {
      navigate(`/project/${project.id}`);
    }
  };

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

  // ── Test Types tab ────────────────────────────────────────────────────────
  const DEFAULT_TEST_TYPES = [
    { id: 'test',       label: 'Test' },
    { id: 'inspection', label: 'Inspection' },
    { id: 'review',     label: 'Review' },
    { id: 'analysis',   label: 'Analysis' },
  ];
  let _testTypes = testTypes.length ? testTypes.map(t => ({ ...t })) : DEFAULT_TEST_TYPES.map(t => ({ ...t }));

  function renderTestTypesTable() {
    const tbody = document.getElementById('testtypes-tbody');
    if (!tbody) return;
    tbody.innerHTML = _testTypes.length
      ? _testTypes.map((tt, i) => `
          <tr data-tt-idx="${i}">
            <td>
              <input class="form-input tt-label-input" data-idx="${i}" value="${escHtml(tt.label)}"
                placeholder="Label" style="max-width:300px"/>
            </td>
            <td>
              <input class="form-input tt-key-input" data-idx="${i}" value="${escHtml(tt.id)}"
                placeholder="key" style="max-width:140px;font-family:monospace;font-size:12px"/>
            </td>
            <td style="text-align:center">
              <button class="btn btn-ghost btn-sm btn-del-testtype" data-idx="${i}"
                style="color:var(--color-danger)" title="Delete">✕</button>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--color-text-muted);font-size:13px;padding:12px 8px">No test types defined yet.</td></tr>`;

    tbody.querySelectorAll('.tt-label-input').forEach(inp => {
      inp.oninput = () => { _testTypes[parseInt(inp.dataset.idx)].label = inp.value; };
    });
    tbody.querySelectorAll('.tt-key-input').forEach(inp => {
      inp.oninput = () => { _testTypes[parseInt(inp.dataset.idx)].id = inp.value.trim().replace(/\s+/g,'_').toLowerCase(); inp.value = _testTypes[parseInt(inp.dataset.idx)].id; };
    });
    tbody.querySelectorAll('.btn-del-testtype').forEach(btn => {
      btn.onclick = () => {
        _testTypes.splice(parseInt(btn.dataset.idx), 1);
        renderTestTypesTable();
      };
    });
  }

  renderTestTypesTable();

  document.getElementById('btn-add-testtype').onclick = () => {
    const labelEl = document.getElementById('testtypes-new-label');
    const keyEl   = document.getElementById('testtypes-new-key');
    const label   = labelEl.value.trim();
    if (!label) { labelEl.focus(); return; }
    const id = keyEl.value.trim().replace(/\s+/g,'_').toLowerCase() || label.toLowerCase().replace(/\s+/g,'_');
    _testTypes.push({ id, label });
    labelEl.value = '';
    keyEl.value = '';
    renderTestTypesTable();
  };
  document.getElementById('testtypes-new-label').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-testtype').click(); }
  });

  document.getElementById('btn-save-testtypes').onclick = async () => {
    const btn = document.getElementById('btn-save-testtypes');
    btn.disabled = true;
    // flush any unsaved inputs
    document.querySelectorAll('.tt-label-input').forEach(inp => {
      const i = parseInt(inp.dataset.idx);
      if (_testTypes[i]) _testTypes[i].label = inp.value.trim() || _testTypes[i].label;
    });
    const newConfig = { ...fullConfig, test_types: _testTypes };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Test types saved.', 'success');
  };

  // ── V-Model Links tab ─────────────────────────────────────────────────────
  mountVmodelEditor(document.getElementById('vme-mount'), {
    links:       vmodelLinks,
    canvasNodes: vmodelCanvasNodes,
    configId,
    fullConfig,
    project,
    sb,
    toast,
    onSave: (savedLinks, savedCanvas) => {
      fullConfig.vmodel_links        = savedLinks;
      fullConfig.vmodel_canvas_nodes = savedCanvas;
    },
  });

  // ── Traceability Fields tab ───────────────────────────────────────────────
  let _traceFields = (traceFields.length ? traceFields : DEFAULT_TRACE_FIELDS).map(f => ({ ...f }));

  function renderTraceFieldsTable() {
    const tbody = document.getElementById('tracefields-tbody');
    if (!tbody) return;
    tbody.innerHTML = _traceFields.length
      ? _traceFields.map((f, i) => `
          <tr data-tf-idx="${i}">
            <td>
              <input class="form-input tf-label-input" data-idx="${i}" value="${escHtml(f.label)}"
                placeholder="Field label" style="max-width:300px"/>
            </td>
            <td>
              <select class="form-input form-select tf-source-sel" data-idx="${i}">
                ${TRACE_SOURCE_OPTIONS.map(o => `<option value="${escHtml(o.value)}" ${f.source===o.value?'selected':''}>${escHtml(o.label)}</option>`).join('')}
              </select>
            </td>
            <td style="text-align:center">
              <button class="btn btn-ghost btn-sm btn-del-tracefield" data-idx="${i}"
                style="color:var(--color-danger)" title="Delete">✕</button>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--color-text-muted);font-size:13px;padding:12px 8px">No traceability fields defined yet.</td></tr>`;

    tbody.querySelectorAll('.tf-label-input').forEach(inp => {
      inp.oninput = () => { _traceFields[parseInt(inp.dataset.idx)].label = inp.value; };
    });
    tbody.querySelectorAll('.tf-source-sel').forEach(sel => {
      sel.onchange = () => { _traceFields[parseInt(sel.dataset.idx)].source = sel.value; };
    });
    tbody.querySelectorAll('.btn-del-tracefield').forEach(btn => {
      btn.onclick = () => {
        _traceFields.splice(parseInt(btn.dataset.idx), 1);
        renderTraceFieldsTable();
      };
    });
  }

  renderTraceFieldsTable();

  document.getElementById('btn-add-tracefield').onclick = () => {
    const labelEl  = document.getElementById('tracefields-new-label');
    const sourceEl = document.getElementById('tracefields-new-source');
    const label    = labelEl.value.trim();
    if (!label) { labelEl.focus(); return; }
    const id = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    _traceFields.push({ id: id + '_' + Date.now().toString(36), label, source: sourceEl.value });
    labelEl.value = '';
    renderTraceFieldsTable();
  };
  document.getElementById('tracefields-new-label').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-tracefield').click(); }
  });

  document.getElementById('btn-save-tracefields').onclick = async () => {
    const btn = document.getElementById('btn-save-tracefields');
    btn.disabled = true;
    document.querySelectorAll('.tf-label-input').forEach(inp => {
      const i = parseInt(inp.dataset.idx);
      if (_traceFields[i]) _traceFields[i].label = inp.value.trim() || _traceFields[i].label;
    });
    const newConfig = { ...fullConfig, traceability_fields: _traceFields };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    fullConfig = newConfig;
    toast('Traceability fields saved.', 'success');
  };

  // ── Function Types tab ─────────────────────────────────────────────────────
  let _funTypes = functionTypes.map(ft => ({
    id: ft.id,
    name: ft.name,
    sort_order: ft.sort_order ?? 0,
    failure_conditions: (ft.failure_conditions || []).map(fc =>
      typeof fc === 'string' ? { id: null, label: fc } : { ...fc }
    ),
    _deleted: false,
  }));

  let _ftSaveTimer = null;
  const _ftIndicator = () => document.getElementById('funtypes-autosave-indicator');

  async function saveFunTypes() {
    const ind = _ftIndicator();
    if (ind) ind.textContent = 'Saving…';
    try {
      const toDelete = _funTypes.filter(ft => ft._deleted && ft.id);
      if (toDelete.length) {
        const { error } = await sb.from('function_types').delete().in('id', toDelete.map(ft => ft.id));
        if (error) throw error;
      }

      const active = _funTypes.filter(ft => !ft._deleted);
      for (let i = 0; i < active.length; i++) {
        const ft = active[i];
        ft.sort_order = i;
        let typeId = ft.id;
        if (!typeId) {
          const { data, error } = await sb.from('function_types')
            .insert({ project_id: project.id, name: ft.name, sort_order: i })
            .select('id').single();
          if (error) throw error;
          typeId = data.id;
          ft.id = typeId;
        } else {
          const { error } = await sb.from('function_types')
            .update({ name: ft.name, sort_order: i }).eq('id', typeId);
          if (error) throw error;
        }
        await sb.from('function_type_fcs').delete().eq('function_type_id', typeId);
        if (ft.failure_conditions.length) {
          const { error } = await sb.from('function_type_fcs').insert(
            ft.failure_conditions.map((fc, j) => ({ function_type_id: typeId, label: fc.label, sort_order: j }))
          );
          if (error) throw error;
        }
      }
      _funTypes = _funTypes.filter(ft => !ft._deleted);
      if (ind) { ind.textContent = 'Saved'; setTimeout(() => { if (_ftIndicator()) _ftIndicator().textContent = ''; }, 1500); }
    } catch (err) {
      if (ind) ind.textContent = 'Error saving';
      console.error(err);
    }
  }

  function scheduleSave() {
    clearTimeout(_ftSaveTimer);
    _ftSaveTimer = setTimeout(saveFunTypes, 600);
  }

  function refreshFunTypesList() {
    document.getElementById('funtypes-list').innerHTML =
      _funTypes.filter(ft => !ft._deleted).map((ft, i) => renderFunTypeRow(ft, i)).join('');
    wireFunTypeRows();
  }

  function wireFunTypeRows() {
    container.querySelectorAll('.btn-del-funtype').forEach(btn => {
      btn.onclick = () => {
        const visible = _funTypes.filter(ft => !ft._deleted);
        visible[parseInt(btn.dataset.idx)]._deleted = true;
        refreshFunTypesList();
        scheduleSave();
      };
    });
    container.querySelectorAll('.btn-add-fc').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        const inputEl = container.querySelector(`.fc-new-input[data-idx="${idx}"]`);
        const val = inputEl?.value.trim();
        if (!val) return;
        const visible = _funTypes.filter(ft => !ft._deleted);
        visible[idx].failure_conditions.push({ id: null, label: val });
        inputEl.value = '';
        refreshFunTypesList();
        scheduleSave();
      };
    });
    container.querySelectorAll('.btn-del-fc').forEach(btn => {
      btn.onclick = () => {
        const { idx, fc } = btn.dataset;
        const visible = _funTypes.filter(ft => !ft._deleted);
        visible[idx].failure_conditions.splice(parseInt(fc), 1);
        refreshFunTypesList();
        scheduleSave();
      };
    });
    container.querySelectorAll('.funtype-name-input').forEach(inp => {
      inp.oninput = () => {
        const visible = _funTypes.filter(ft => !ft._deleted);
        visible[parseInt(inp.dataset.idx)].name = inp.value;
        scheduleSave();
      };
    });
    container.querySelectorAll('.fc-new-input').forEach(inp => {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); container.querySelector(`.btn-add-fc[data-idx="${inp.dataset.idx}"]`)?.click(); }
      };
    });
  }

  // Auto-save defaults on first load (no DB records yet)
  if (ftFirstLoad) scheduleSave();

  wireFunTypeRows();

  document.getElementById('btn-add-funtype').onclick = () => {
    _funTypes.push({ id: null, name: 'New Type', sort_order: _funTypes.length, failure_conditions: [], _deleted: false });
    refreshFunTypesList();
    scheduleSave();
  };

  document.getElementById('btn-load-funtype-defaults').onclick = () => {
    if (!confirm('Reset all function types to defaults? This will discard your current configuration.')) return;
    _funTypes.forEach(ft => ft._deleted = true);
    DEFAULT_FUNCTION_TYPES.forEach((d, i) => _funTypes.push({
      id: null, name: d.name, sort_order: i, _deleted: false,
      failure_conditions: d.failure_conditions.map(label => ({ id: null, label })),
    }));
    refreshFunTypesList();
    scheduleSave();
  };
}

function renderFunTypeRow(ft, i) {
  const fcList = (ft.failure_conditions || []).map((fc, fi) => `
    <div class="fc-item">
      <span class="fc-text">${escHtml(fc.label ?? fc)}</span>
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
