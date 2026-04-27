/**
 * Review Session Wizard — 3-step wizard to create a review session.
 * Step 1: Setup (title, type, template, date)
 * Step 2: Select artifacts (tabbed by type)
 * Step 3: Confirm & Start
 * Route: /project/:projectId/item/:itemId/reviews/new
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';

const ARTIFACT_TYPE_LABELS = {
  requirements:         'Requirements',
  arch_spec_items:      'Architecture Spec Items',
  test_specs:           'Test Specs',
  safety_analysis_rows: 'Safety Analysis',
};

const REVIEW_TYPE_LABELS = {
  inspection:        'Inspection (IEEE 1028)',
  walkthrough:       'Walkthrough',
  technical_review:  'Technical Review',
  audit:             'Audit',
  management_review: 'Management Review',
};

export async function renderReviewSessionWizard(container, ctx) {
  const { project, item } = ctx;
  const base = `/project/${project.id}/item/${item.id}`;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `${base}/vcycle/item_definition` },
    { label: 'Reviews', path: `${base}/reviews` },
    { label: 'New Session' },
  ]);

  // Wizard state
  const state = {
    step: 1,
    title: '',
    review_type: 'inspection',
    template_id: null,
    planned_date: new Date().toISOString().slice(0, 10),
    checklist_mode: 'individual', // 'individual' | 'shared'
    selected: {},  // { [artifactType]: Set<id> }
    artifacts: {}, // { [artifactType]: [] }  loaded lazily
  };

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>New Review Session</h1>
          <p class="page-subtitle">${escHtml(item.name)}</p>
        </div>
        <button class="btn btn-secondary" id="wiz-btn-cancel">Cancel</button>
      </div>
    </div>
    <div class="page-body">
      <div class="wiz-wrap">
        <div class="wiz-steps" id="wiz-steps">
          <div class="wiz-step active" data-step="1"><span class="wiz-step-num">1</span> Setup</div>
          <div class="wiz-step-sep">›</div>
          <div class="wiz-step" data-step="2"><span class="wiz-step-num">2</span> Select Artifacts</div>
          <div class="wiz-step-sep">›</div>
          <div class="wiz-step" data-step="3"><span class="wiz-step-num">3</span> Confirm &amp; Start</div>
        </div>
        <div class="wiz-body" id="wiz-body"></div>
        <div class="wiz-footer">
          <button class="btn btn-secondary" id="wiz-btn-back" style="display:none">◀ Back</button>
          <button class="btn btn-primary" id="wiz-btn-next">Next ▶</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('wiz-btn-cancel').onclick = () => navigate(`${base}/reviews`);

  // Load templates
  const { data: templates } = await sb.from('review_protocol_templates')
    .select('*').eq('project_id', project.id).eq('is_active', true).order('name');

  renderStep();

  document.getElementById('wiz-btn-next').onclick = () => advanceStep();
  document.getElementById('wiz-btn-back').onclick = () => retreatStep();

  function renderStep() {
    const body = document.getElementById('wiz-body');
    document.querySelectorAll('.wiz-step').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.step) === state.step);
      s.classList.toggle('done',   parseInt(s.dataset.step) < state.step);
    });
    document.getElementById('wiz-btn-back').style.display  = state.step > 1 ? '' : 'none';
    document.getElementById('wiz-btn-next').textContent = state.step === 3 ? '▶ Start Review' : 'Next ▶';

    if (state.step === 1) renderStep1(body);
    if (state.step === 2) renderStep2(body);
    if (state.step === 3) renderStep3(body);
  }

  function renderStep1(body) {
    body.innerHTML = `
      <div class="wiz-step-body">
        <h3>Session Setup</h3>
        <div class="form-grid cols-2">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Session Title *</label>
            <input class="form-input" id="wiz-title" value="${escHtml(state.title)}" placeholder="e.g. SW Requirements Review — Sprint 4"/>
          </div>
          <div class="form-group">
            <label class="form-label">Review Type</label>
            <select class="form-input form-select" id="wiz-rtype">
              ${Object.entries(REVIEW_TYPE_LABELS).map(([v, l]) =>
                `<option value="${v}" ${state.review_type === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </div>

          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Review Protocol / Checklist Template</label>
            <select class="form-input form-select" id="wiz-template">
              <option value="">— No template (free review) —</option>
              ${(templates || []).map(t => `
                <option value="${t.id}" ${state.template_id === t.id ? 'selected' : ''}>
                  ${escHtml(t.name)} (${escHtml(ARTIFACT_TYPE_LABELS[t.artifact_type] || t.artifact_type)})
                </option>`).join('')}
            </select>
            <p class="form-hint">Templates define the checklist criteria reviewers will evaluate. Managed in Project Settings → Review Protocols.</p>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Checklist Mode</label>
            <div class="wiz-checklist-mode-options">
              <label class="wiz-mode-option ${state.checklist_mode === 'individual' ? 'selected' : ''}">
                <input type="radio" name="wiz-cmode" value="individual" ${state.checklist_mode === 'individual' ? 'checked' : ''}/>
                <div>
                  <strong>Individual per artifact</strong>
                  <p>Each artifact is evaluated independently against the full checklist. Responses are saved per artifact.</p>
                </div>
              </label>
              <label class="wiz-mode-option ${state.checklist_mode === 'shared' ? 'selected' : ''}">
                <input type="radio" name="wiz-cmode" value="shared" ${state.checklist_mode === 'shared' ? 'checked' : ''}/>
                <div>
                  <strong>Shared — one checklist for all</strong>
                  <p>The checklist is filled in once and applies to all artifacts in the session. Useful for reviewing a set of artifacts as a whole.</p>
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('wiz-title').oninput = e => { state.title = e.target.value; };
    document.getElementById('wiz-rtype').onchange = e => { state.review_type = e.target.value; };

    document.getElementById('wiz-template').onchange = e => { state.template_id = e.target.value || null; };
    body.querySelectorAll('input[name="wiz-cmode"]').forEach(radio => {
      radio.onchange = e => {
        state.checklist_mode = e.target.value;
        body.querySelectorAll('.wiz-mode-option').forEach(opt =>
          opt.classList.toggle('selected', opt.querySelector('input').value === state.checklist_mode)
        );
      };
    });
  }

  async function renderStep2(body) {
    body.innerHTML = `
      <div class="wiz-step-body">
        <h3>Select Artifacts to Review</h3>
        <p class="form-hint">Select the artifacts you want to include. A snapshot will be taken of each at session start.</p>
        <div class="wiz-artifact-tabs">
          ${Object.entries(ARTIFACT_TYPE_LABELS).map(([type, label], i) =>
            `<button class="wiz-atab ${i === 0 ? 'active' : ''}" data-atype="${type}">${label}</button>`
          ).join('')}
        </div>
        <div id="wiz-artifact-panel">
          <div class="content-loading"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    const firstType = Object.keys(ARTIFACT_TYPE_LABELS)[0];
    await loadArtifactTab(firstType);

    body.querySelectorAll('.wiz-atab').forEach(btn => {
      btn.onclick = async () => {
        body.querySelectorAll('.wiz-atab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        await loadArtifactTab(btn.dataset.atype);
      };
    });
  }

  async function loadArtifactTab(type) {
    const panel = document.getElementById('wiz-artifact-panel');
    panel.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

    if (!state.artifacts[type]) {
      state.artifacts[type] = await fetchArtifacts(type, project.id, item.id);
    }
    if (!state.selected[type]) state.selected[type] = new Set();

    const arts = state.artifacts[type];
    if (!arts.length) {
      panel.innerHTML = `<p class="rv-empty" style="padding:24px 0">No ${ARTIFACT_TYPE_LABELS[type]} found for this item.</p>`;
      return;
    }

    const sel = state.selected[type];
    panel.innerHTML = `
      <div class="wiz-artifact-controls">
        <label class="wiz-check-all-label">
          <input type="checkbox" id="wiz-check-all" ${sel.size === arts.length ? 'checked' : ''}/>
          Select all (${arts.length})
        </label>
        <span class="wiz-selected-count">${sel.size} selected</span>
      </div>
      <div class="wiz-artifact-list">
        <table class="data-table">
          <thead><tr>
            <th style="width:36px"></th>
            <th>Code</th>
            <th>Title / Name</th>
            <th>Status</th>
            <th>Type</th>
          </tr></thead>
          <tbody>
            ${arts.map(a => `
              <tr>
                <td><input type="checkbox" class="wiz-art-chk" data-id="${a.id}" ${sel.has(a.id) ? 'checked' : ''}/></td>
                <td class="mono">${escHtml(a.code || '—')}</td>
                <td>${escHtml(a.title || a.name || '—')}</td>
                <td><span class="badge badge-${escHtml(a.status || 'draft')}">${escHtml(a.status || '—')}</span></td>
                <td class="text-muted">${escHtml(a.type || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    panel.querySelector('#wiz-check-all').onchange = e => {
      if (e.target.checked) arts.forEach(a => sel.add(a.id));
      else sel.clear();
      panel.querySelectorAll('.wiz-art-chk').forEach(chk => { chk.checked = sel.has(chk.dataset.id); });
      panel.querySelector('.wiz-selected-count').textContent = `${sel.size} selected`;
    };
    panel.querySelectorAll('.wiz-art-chk').forEach(chk => {
      chk.onchange = e => {
        if (e.target.checked) sel.add(chk.dataset.id);
        else sel.delete(chk.dataset.id);
        panel.querySelector('.wiz-selected-count').textContent = `${sel.size} selected`;
        panel.querySelector('#wiz-check-all').checked = sel.size === arts.length;
      };
    });
  }

  function renderStep3(body) {
    const totalSelected = Object.values(state.selected).reduce((sum, s) => sum + s.size, 0);
    const tpl = templates?.find(t => t.id === state.template_id);

    const rows = Object.entries(state.selected).flatMap(([type, ids]) => {
      const arts = state.artifacts[type] || [];
      return [...ids].map(id => {
        const a = arts.find(x => x.id === id);
        return a ? `<tr>
          <td class="mono">${escHtml(a.code || '—')}</td>
          <td>${escHtml(a.title || a.name || '—')}</td>
          <td class="text-muted">${escHtml(ARTIFACT_TYPE_LABELS[type] || type)}</td>
          <td><span class="badge badge-${escHtml(a.status || 'draft')}">${escHtml(a.status || '—')}</span></td>
        </tr>` : '';
      });
    }).join('');

    body.innerHTML = `
      <div class="wiz-step-body">
        <h3>Confirm &amp; Start</h3>
        <div class="wiz-summary">
          <div class="wiz-summary-row"><span>Title</span><strong>${escHtml(state.title)}</strong></div>
          <div class="wiz-summary-row"><span>Review Type</span><strong>${escHtml(REVIEW_TYPE_LABELS[state.review_type] || state.review_type)}</strong></div>
          <div class="wiz-summary-row"><span>Protocol</span><strong>${tpl ? escHtml(tpl.name) : 'None'}</strong></div>
          <div class="wiz-summary-row"><span>Date</span><strong>${escHtml(state.planned_date)}</strong></div>
          <div class="wiz-summary-row"><span>Artifacts</span><strong>${totalSelected} selected</strong></div>
        </div>
        ${totalSelected ? `
          <h4 style="margin:16px 0 8px">Selected Artifacts</h4>
          <table class="data-table">
            <thead><tr><th>Code</th><th>Title</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>` : `<p class="rv-empty" style="margin-top:16px">No artifacts selected. Go back and select at least one.</p>`}
        ${!totalSelected ? `<p style="color:var(--color-danger);margin-top:8px">⚠ Please select at least one artifact before starting the review.</p>` : ''}
      </div>
    `;
  }

  async function advanceStep() {
    if (state.step === 1) {
      state.title = document.getElementById('wiz-title')?.value.trim() || state.title;
      if (!state.title) { toast('Please enter a session title.', 'error'); return; }
      state.step = 2;
    } else if (state.step === 2) {
      state.step = 3;
    } else if (state.step === 3) {
      const totalSelected = Object.values(state.selected).reduce((sum, s) => sum + s.size, 0);
      if (!totalSelected) { toast('Select at least one artifact.', 'error'); return; }
      await createSession();
      return;
    }
    renderStep();
  }

  function retreatStep() {
    if (state.step > 1) { state.step--; renderStep(); }
  }

  async function createSession() {
    const btn = document.getElementById('wiz-btn-next');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    // 1. Create session
    const { data: session, error: se } = await sb.from('review_sessions').insert({
      project_id:      project.id,
      template_id:     state.template_id || null,
      title:           state.title,
      review_type:     state.review_type,
      status:          'in_progress',
      planned_date:    state.planned_date || null,
      checklist_mode:  state.checklist_mode,
    }).select().single();

    if (se || !session) {
      toast('Failed to create session: ' + (se?.message || 'unknown error'), 'error');
      btn.disabled = false; btn.textContent = '▶ Start Review'; return;
    }

    // 2. Take snapshots for each selected artifact
    const snapshotInserts = [];
    for (const [type, ids] of Object.entries(state.selected)) {
      for (const id of ids) {
        const art = (state.artifacts[type] || []).find(a => a.id === id);
        if (!art) continue;
        // Fetch full row for snapshot_data
        const fullRow = await fetchFullArtifact(type, id);
        snapshotInserts.push({
          session_id:          session.id,
          artifact_type:       type,
          artifact_id:         id,
          artifact_code:       art.code || art.req_code || art.spec_code || art.test_code || '',
          artifact_title:      art.title || art.name || '',
          snapshot_data:       fullRow || art,
          artifact_updated_at: art.updated_at || null,
          is_current:          true,
        });
      }
    }

    if (snapshotInserts.length) {
      const { error: snapErr } = await sb.from('review_artifact_snapshots').insert(snapshotInserts);
      if (snapErr) {
        toast('Session created but snapshots failed: ' + snapErr.message, 'error');
      }
    }

    toast('Review session started!', 'success');
    navigate(`${base}/reviews/${session.id}/execute`);
  }

  // ── Artifact fetchers ────────────────────────────────────────────────
  async function fetchArtifacts(type, projectId, itemId) {
    if (type === 'requirements') {
      const { data } = await sb.from('requirements')
        .select('id, req_code, title, status, type, updated_at')
        .eq('project_id', projectId).order('req_code');
      return (data || []).map(r => ({ ...r, code: r.req_code }));
    }
    if (type === 'arch_spec_items') {
      const { data } = await sb.from('arch_spec_items')
        .select('id, spec_code, title, status, type, updated_at')
        .eq('project_id', projectId).order('spec_code');
      return (data || []).map(r => ({ ...r, code: r.spec_code }));
    }
    if (type === 'test_specs') {
      const { data } = await sb.from('test_specs')
        .select('id, test_code, name, status, level, updated_at')
        .eq('project_id', projectId).order('test_code');
      return (data || []).map(r => ({ ...r, code: r.test_code, title: r.name }));
    }
    if (type === 'safety_analysis_rows') {
      const { data } = await sb.from('safety_analyses')
        .select('id, analysis_code, title, analysis_type, status, updated_at')
        .eq('project_id', projectId).order('analysis_code');
      return (data || []).map(r => ({ ...r, code: r.analysis_code, type: r.analysis_type }));
    }
    return [];
  }

  async function fetchFullArtifact(type, id) {
    const tableMap = {
      requirements:         'requirements',
      arch_spec_items:      'arch_spec_items',
      test_specs:           'test_specs',
      safety_analysis_rows: 'safety_analyses',
    };
    const table = tableMap[type];
    if (!table) return null;
    const { data } = await sb.from(table).select('*').eq('id', id).single();
    return data;
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
