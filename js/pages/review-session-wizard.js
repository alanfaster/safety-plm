/**
 * Review Session Wizard — 4-step wizard to create a review session.
 * Step 1: Setup (title, type, template, date)
 * Step 2: Select artifacts (item-tree accordion)
 * Step 3: Assign reviewers (with review_role)
 * Step 4: Confirm & Start
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

const ARTIFACT_TYPE_ICONS = {
  requirements:         '📋',
  arch_spec_items:      '🏗',
  test_specs:           '🧪',
  safety_analysis_rows: '⚠️',
};

const REVIEW_TYPES = [
  { value: 'inspection',        label: 'Inspection',        subtitle: 'IEEE 1028 — formal, moderator-led', icon: '🔍', color: '#1a73e8' },
  { value: 'walkthrough',       label: 'Walkthrough',       subtitle: 'Author-led informal presentation',  icon: '👥', color: '#34a853' },
  { value: 'technical_review',  label: 'Technical Review',  subtitle: 'Peer technical evaluation',         icon: '⚙️',  color: '#7c3aed' },
  { value: 'audit',             label: 'Audit',             subtitle: 'Independent process verification',  icon: '📋', color: '#ea8600' },
  { value: 'management_review', label: 'Management Review', subtitle: 'Management oversight & approval',   icon: '📊', color: '#5f6368' },
];

const REVIEW_ROLES = [
  { value: 'author',    label: 'Author',    desc: 'Artifact owner, presents the work' },
  { value: 'moderator', label: 'Moderator', desc: 'Leads and controls the review' },
  { value: 'reviewer',  label: 'Reviewer',  desc: 'Evaluates and raises findings' },
  { value: 'scribe',    label: 'Scribe',    desc: 'Records findings and decisions' },
];

const ROLE_BADGE_COLORS = {
  author:    '#34a853',
  moderator: '#1a73e8',
  reviewer:  '#5f6368',
  scribe:    '#ea8600',
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

  const { data: { user: currentUser } } = await sb.auth.getUser();

  // Wizard state
  const state = {
    step: 1,
    title: '',
    review_type: 'inspection',
    template_id: null,
    planned_date: new Date().toISOString().slice(0, 10),
    selected: {},    // { [artifactType]: Set<id> }
    artifacts: {},   // { [artifactType]: [] }  all project artifacts loaded once
    items: [],       // project items
    systems: {},     // { [itemId]: [system, ...] }
    reviewers: [],   // [{ user_id, role_id, role_name, role_code, display_name, review_role }]
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
          <div class="wiz-step active" data-step="1"><span class="wiz-step-num">1</span><span class="wiz-step-label">Setup</span></div>
          <div class="wiz-step-sep">›</div>
          <div class="wiz-step" data-step="2"><span class="wiz-step-num">2</span><span class="wiz-step-label">Artifacts</span></div>
          <div class="wiz-step-sep">›</div>
          <div class="wiz-step" data-step="3"><span class="wiz-step-num">3</span><span class="wiz-step-label">Reviewers</span></div>
          <div class="wiz-step-sep">›</div>
          <div class="wiz-step" data-step="4"><span class="wiz-step-num">4</span><span class="wiz-step-label">Confirm</span></div>
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

  // Load templates upfront
  const { data: templates } = await sb.from('review_protocol_templates')
    .select('*').eq('project_id', project.id).eq('is_active', true).order('name');

  renderStep();

  document.getElementById('wiz-btn-next').onclick = () => advanceStep();
  document.getElementById('wiz-btn-back').onclick  = () => retreatStep();

  // ── Steps rendering ──────────────────────────────────────────────────

  function renderStep() {
    const body = document.getElementById('wiz-body');
    document.querySelectorAll('.wiz-step').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.step) === state.step);
      s.classList.toggle('done',   parseInt(s.dataset.step) < state.step);
    });
    document.getElementById('wiz-btn-back').style.display = state.step > 1 ? '' : 'none';
    document.getElementById('wiz-btn-next').textContent   = state.step === 4 ? '▶ Start Review' : 'Next ▶';

    if (state.step === 1) renderStep1(body);
    if (state.step === 2) renderStep2(body);
    if (state.step === 3) renderStep3(body);
    if (state.step === 4) renderStep4(body);
  }

  function renderStep1(body) {
    const tpl = (templates || []).find(t => t.id === state.template_id);

    body.innerHTML = `
      <div class="wiz-step-body">
        <div class="wiz-s1-top">
          <div class="form-group wiz-title-group">
            <label class="form-label wiz-label-lg">Session Title *</label>
            <input class="form-input wiz-title-input" id="wiz-title"
              value="${escHtml(state.title)}"
              placeholder="e.g. SW Requirements Review — Sprint 4"/>
          </div>
          <div class="form-group">
            <label class="form-label wiz-label-lg">Planned Date</label>
            <input class="form-input" id="wiz-date" type="date" value="${escHtml(state.planned_date)}"/>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:24px">
          <label class="form-label wiz-label-lg">Review Type</label>
          <div class="wiz-type-cards" id="wiz-type-cards">
            ${REVIEW_TYPES.map(rt => `
              <button type="button" class="wiz-type-card ${state.review_type === rt.value ? 'selected' : ''}"
                data-value="${rt.value}" style="--card-color:${rt.color}">
                <span class="wiz-type-icon">${rt.icon}</span>
                <span class="wiz-type-name">${rt.label}</span>
                <span class="wiz-type-sub">${rt.subtitle}</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label wiz-label-lg">Review Protocol / Checklist Template</label>
          <select class="form-input form-select" id="wiz-template">
            <option value="">— No template (free review) —</option>
            ${(templates || []).map(t => `
              <option value="${t.id}" ${state.template_id === t.id ? 'selected' : ''}>
                ${escHtml(t.name)} (${escHtml(ARTIFACT_TYPE_LABELS[t.artifact_type] || t.artifact_type)})${t.current_version ? ' · v' + t.current_version : ' · draft'}
              </option>`).join('')}
          </select>
          <p class="form-hint">Templates define checklist criteria. Managed in Project Settings → Review Protocols.</p>
        </div>
      </div>
    `;

    document.getElementById('wiz-title').oninput    = e => { state.title = e.target.value; };
    document.getElementById('wiz-date').onchange     = e => { state.planned_date = e.target.value; };
    document.getElementById('wiz-template').onchange = e => { state.template_id = e.target.value || null; };

    body.querySelectorAll('.wiz-type-card').forEach(card => {
      card.onclick = () => {
        state.review_type = card.dataset.value;
        body.querySelectorAll('.wiz-type-card').forEach(c => c.classList.toggle('selected', c.dataset.value === state.review_type));
      };
    });
  }

  async function renderStep2(body) {
    body.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

    // Load items, systems, and all artifact types for the project once
    if (!state.items.length) {
      const [{ data: itemsData }, ...artResults] = await Promise.all([
        sb.from('items').select('id, name').eq('project_id', project.id).order('created_at'),
        fetchArtifacts('requirements', project.id),
        fetchArtifacts('arch_spec_items', project.id),
        fetchArtifacts('test_specs', project.id),
        fetchArtifacts('safety_analysis_rows', project.id),
      ]);
      state.items = itemsData || [];
      const typeKeys = Object.keys(ARTIFACT_TYPE_LABELS);
      typeKeys.forEach((k, i) => { state.artifacts[k] = artResults[i]; });
      if (state.items.length) {
        await Promise.all(state.items.map(async it => {
          const { data: syss } = await sb.from('systems')
            .select('id, name, system_code').eq('item_id', it.id).order('created_at');
          state.systems[it.id] = syss || [];
        }));
      }
    }

    Object.keys(ARTIFACT_TYPE_LABELS).forEach(k => { if (!state.selected[k]) state.selected[k] = new Set(); });

    const typeKeys = Object.keys(ARTIFACT_TYPE_LABELS);
    const totalAll = Object.values(state.artifacts).reduce((s, arr) => s + arr.length, 0);

    if (!totalAll) {
      body.innerHTML = `<div class="wiz-step-body">
        <h3>Select Artifacts to Review</h3>
        <p class="rv-empty" style="padding:32px 0">No artifacts found for this project.</p>
      </div>`;
      return;
    }

    // Build lookup maps
    const systemToItem = {};
    state.items.forEach(it => {
      (state.systems[it.id] || []).forEach(sys => { systemToItem[sys.id] = it.id; });
    });

    // artsByNode: { 'item:{id}': { type:[art] }, 'sys:{id}': { type:[art] }, 'other': { type:[art] } }
    const artsByNode = {};
    typeKeys.forEach(type => {
      (state.artifacts[type] || []).forEach(art => {
        let key;
        if (art.parent_type === 'item')   key = `item:${art.parent_id}`;
        else if (art.parent_type === 'system') key = `sys:${art.parent_id}`;
        else key = 'other';
        if (!artsByNode[key]) artsByNode[key] = {};
        if (!artsByNode[key][type]) artsByNode[key][type] = [];
        artsByNode[key][type].push(art);
      });
    });

    // Selected tree node — default to first item that has artifacts
    let _activeNode = null;
    for (const it of state.items) {
      if (artsByNode[`item:${it.id}`] || (state.systems[it.id] || []).some(s => artsByNode[`sys:${s.id}`])) {
        _activeNode = `item:${it.id}`;
        break;
      }
    }
    if (!_activeNode) _activeNode = 'other';

    function countSelected() {
      return Object.values(state.selected).reduce((s, set) => s + set.size, 0);
    }

    function nodeSelectedCount(nodeKey) {
      if (nodeKey === 'all') return countSelected();
      const arts = artsByNode[nodeKey] || {};
      return typeKeys.reduce((s, t) => s + (arts[t] || []).filter(a => state.selected[t].has(a.id)).length, 0);
    }

    function nodeTotalCount(nodeKey) {
      if (nodeKey === 'all') return totalAll;
      const arts = artsByNode[nodeKey] || {};
      return typeKeys.reduce((s, t) => s + (arts[t] || []).length, 0);
    }

    // ── Left tree ─────────────────────────────────────────────────────────

    function renderLeftTree() {
      const itemNodes = state.items.map(it => {
        const itemKey  = `item:${it.id}`;
        const systems  = state.systems[it.id] || [];
        // total artifacts for this item = direct + all its systems
        const relatedKeys = [itemKey, ...systems.map(s => `sys:${s.id}`)];
        const total = relatedKeys.reduce((s, k) => s + nodeTotalCount(k), 0);
        if (!total) return '';

        const selCount = relatedKeys.reduce((s, k) => s + nodeSelectedCount(k), 0);

        const sysNodes = systems.map(sys => {
          const sysKey = `sys:${sys.id}`;
          if (!nodeTotalCount(sysKey)) return '';
          const sSel = nodeSelectedCount(sysKey);
          const sTotal = nodeTotalCount(sysKey);
          return `<div class="wiz-tree-node wiz-tree-sys ${_activeNode === sysKey ? 'active' : ''}"
                      data-node="${sysKey}">
            <span class="wiz-tree-icon">⚙</span>
            <span class="wiz-tree-label">${escHtml(sys.system_code ? sys.system_code + ' · ' + sys.name : sys.name)}</span>
            ${sSel ? `<span class="wiz-tree-badge">${sSel}</span>` : `<span class="wiz-tree-total">${sTotal}</span>`}
          </div>`;
        }).join('');

        const directTotal = nodeTotalCount(itemKey);
        const directSel   = nodeSelectedCount(itemKey);
        const directNode  = directTotal ? `
          <div class="wiz-tree-node wiz-tree-direct ${_activeNode === itemKey ? 'active' : ''}"
               data-node="${itemKey}">
            <span class="wiz-tree-icon">📄</span>
            <span class="wiz-tree-label">Direct artifacts</span>
            ${directSel ? `<span class="wiz-tree-badge">${directSel}</span>` : `<span class="wiz-tree-total">${directTotal}</span>`}
          </div>` : '';

        return `
          <div class="wiz-tree-item-group">
            <div class="wiz-tree-item-header">
              <span class="wiz-tree-icon">📁</span>
              <span class="wiz-tree-label">${escHtml(it.name)}</span>
              ${selCount ? `<span class="wiz-tree-badge">${selCount}</span>` : `<span class="wiz-tree-total">${total}</span>`}
            </div>
            <div class="wiz-tree-item-children">
              ${directNode}
              ${sysNodes}
            </div>
          </div>`;
      }).join('');

      const otherTotal = nodeTotalCount('other');
      const otherNode  = otherTotal ? `
        <div class="wiz-tree-item-group">
          <div class="wiz-tree-node ${_activeNode === 'other' ? 'active' : ''}" data-node="other">
            <span class="wiz-tree-icon">📁</span>
            <span class="wiz-tree-label">Other</span>
            <span class="wiz-tree-total">${otherTotal}</span>
          </div>
        </div>` : '';

      return itemNodes + otherNode;
    }

    // ── Right artifacts panel ──────────────────────────────────────────────

    function renderRightPanel(nodeKey) {
      const arts = artsByNode[nodeKey] || {};
      const hasSomething = typeKeys.some(t => (arts[t] || []).length);
      if (!hasSomething) return `<p class="rv-empty" style="padding:32px">No artifacts in this node.</p>`;

      return typeKeys.map(type => {
        const list = arts[type] || [];
        if (!list.length) return '';
        const sel   = state.selected[type];
        const allSel = list.every(a => sel.has(a.id));
        const noneSel = list.every(a => !sel.has(a.id));

        const rows = list.map(a => `
          <tr class="wiz-art-row" data-type="${type}" data-id="${a.id}">
            <td style="width:28px"><input type="checkbox" class="wiz-art-chk"
              data-type="${type}" data-id="${a.id}" ${sel.has(a.id) ? 'checked' : ''}/></td>
            <td class="mono" style="white-space:nowrap">${escHtml(a.code || '—')}</td>
            <td style="width:100%">${escHtml(a.title || a.name || '—')}</td>
            <td style="white-space:nowrap"><span class="badge badge-${escHtml(a.status || 'draft')}">${escHtml(a.status || '—')}</span></td>
          </tr>`).join('');

        const selCount = list.filter(a => sel.has(a.id)).length;
        return `
          <div class="wiz-rp-section">
            <div class="wiz-rp-section-hdr">
              <span class="wiz-rp-type-label">${ARTIFACT_TYPE_ICONS[type]} ${ARTIFACT_TYPE_LABELS[type]}</span>
              <span class="wiz-rp-sel-count">${selCount}/${list.length}</span>
              <button type="button" class="btn btn-ghost btn-xs wiz-rp-sel-all"
                data-node="${nodeKey}" data-type="${type}">All</button>
              <button type="button" class="btn btn-ghost btn-xs wiz-rp-sel-none"
                data-node="${nodeKey}" data-type="${type}">None</button>
            </div>
            <table class="data-table wiz-art-table">
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      }).join('');
    }

    // ── Full layout ────────────────────────────────────────────────────────

    function renderLayout() {
      return `
        <div class="wiz-step-body wiz-s2-layout">
          <div class="wiz-s2-topbar">
            <h3>Select Artifacts to Review</h3>
            <span class="wiz-total-selected" id="wiz-total-sel">${countSelected()} selected</span>
          </div>
          <div class="wiz-s2-split">
            <nav class="wiz-s2-tree" id="wiz-s2-tree">
              ${renderLeftTree()}
            </nav>
            <div class="wiz-s2-panel" id="wiz-s2-panel">
              ${renderRightPanel(_activeNode)}
            </div>
          </div>
        </div>`;
    }

    body.innerHTML = renderLayout();
    wireStep2(body);

    function wireStep2(root) {
      // Tree node clicks
      root.querySelectorAll('[data-node]').forEach(el => {
        el.addEventListener('click', () => {
          _activeNode = el.dataset.node;
          root.querySelectorAll('[data-node]').forEach(n => n.classList.toggle('active', n.dataset.node === _activeNode));
          root.querySelector('#wiz-s2-panel').innerHTML = renderRightPanel(_activeNode);
          wireCheckboxes(root);
          wireSelectButtons(root);
        });
      });
      wireCheckboxes(root);
      wireSelectButtons(root);
    }

    function wireCheckboxes(root) {
      root.querySelectorAll('.wiz-art-chk').forEach(chk => {
        chk.onchange = e => {
          if (e.target.checked) state.selected[chk.dataset.type].add(chk.dataset.id);
          else state.selected[chk.dataset.type].delete(chk.dataset.id);
          refreshStep2(root);
        };
      });
    }

    function wireSelectButtons(root) {
      root.querySelectorAll('.wiz-rp-sel-all, .wiz-rp-sel-none').forEach(btn => {
        btn.onclick = () => {
          const isAll  = btn.classList.contains('wiz-rp-sel-all');
          const { node, type } = btn.dataset;
          const arts   = (artsByNode[node] || {})[type] || [];
          arts.forEach(a => {
            if (isAll) state.selected[type].add(a.id);
            else state.selected[type].delete(a.id);
          });
          // Rebuild only the panel
          root.querySelector('#wiz-s2-panel').innerHTML = renderRightPanel(_activeNode);
          wireCheckboxes(root);
          wireSelectButtons(root);
          refreshStep2(root);
        };
      });
    }

    function refreshStep2(root) {
      // Total badge
      const totalEl = root.querySelector('#wiz-total-sel');
      if (totalEl) totalEl.textContent = `${countSelected()} selected`;
      // Rebuild left tree badges without re-rendering the whole tree (preserve active state)
      root.querySelector('#wiz-s2-tree').innerHTML = renderLeftTree();
      root.querySelectorAll('[data-node]').forEach(el => {
        el.addEventListener('click', () => {
          _activeNode = el.dataset.node;
          root.querySelectorAll('[data-node]').forEach(n => n.classList.toggle('active', n.dataset.node === _activeNode));
          root.querySelector('#wiz-s2-panel').innerHTML = renderRightPanel(_activeNode);
          wireCheckboxes(root);
          wireSelectButtons(root);
        });
      });
    }
  }

  async function renderStep3(body) {
    body.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

    const [
      { data: membersRaw },
      { data: profilesRaw },
    ] = await Promise.all([
      sb.from('project_members').select('*, project_roles(id,name,code,category)').eq('project_id', project.id),
      sb.from('user_profiles').select('user_id, display_name'),
    ]);
    const profileMap = Object.fromEntries((profilesRaw || []).map(p => [p.user_id, p.display_name]));
    const members = (membersRaw || []).map(m => ({
      ...m,
      display_name: profileMap[m.user_id] || m.user_id?.slice(0, 8),
    }));

    // Auto-assign creator as Author if reviewers list is empty
    if (!state.reviewers.length && currentUser) {
      const selfMember = members.find(m => m.user_id === currentUser.id);
      state.reviewers.push({
        user_id:      currentUser.id,
        role_id:      selfMember?.role_id || null,
        role_name:    selfMember?.project_roles?.name || 'Project Member',
        role_code:    selfMember?.project_roles?.code || '',
        display_name: profileMap[currentUser.id] || currentUser.email?.split('@')[0] || currentUser.id.slice(0, 8),
        review_role:  'author',
      });
    }

    const memberOptions = members.map(m =>
      `<option value="${m.user_id}|${m.role_id || ''}">
        ${escHtml(m.display_name)} — ${escHtml(m.project_roles?.name || '?')}
       </option>`
    ).join('');

    const isInspection = state.review_type === 'inspection';

    function hasModerator() {
      return state.reviewers.some(r => r.review_role === 'moderator');
    }

    function renderReviewerRows() {
      if (!state.reviewers.length) return `<p class="text-muted" style="padding:12px 0">No reviewers assigned yet.</p>`;
      return `<div class="wiz-reviewer-cards">
        ${state.reviewers.map((rv, i) => `
          <div class="wiz-reviewer-card">
            <div class="wiz-reviewer-identity">
              <span class="wiz-reviewer-name">${escHtml(rv.display_name)}</span>
              ${rv.role_code ? `<span class="members-role-pill" style="font-size:11px">${escHtml(rv.role_code)}</span>` : ''}
            </div>
            <select class="form-input form-select wiz-review-role-sel" data-idx="${i}" style="width:140px">
              ${REVIEW_ROLES.map(rr => `
                <option value="${rr.value}" ${rv.review_role === rr.value ? 'selected' : ''}>${rr.label}</option>
              `).join('')}
            </select>
            <button class="btn btn-ghost btn-xs wiz-del-reviewer" data-idx="${i}" title="Remove">✕</button>
          </div>`).join('')}
      </div>`;
    }

    function reRenderReviewers() {
      body.querySelector('#wiz-reviewers-list').innerHTML = renderReviewerRows();
      const modWarn = body.querySelector('#wiz-mod-warn');
      if (modWarn) modWarn.style.display = (isInspection && !hasModerator()) ? '' : 'none';
      wireReviewerRows();
    }

    body.innerHTML = `
      <div class="wiz-step-body">
        <h3>Assign Review Team</h3>
        <p class="form-hint">Select participants and assign their review role. The creator is pre-assigned as Author.</p>

        ${isInspection ? `
          <div class="wiz-mod-banner" id="wiz-mod-warn" style="${hasModerator() ? 'display:none' : ''}">
            ⚠️ <strong>Inspection requires a Moderator.</strong> Please assign at least one reviewer with the Moderator role.
          </div>` : ''}

        <div class="wiz-reviewer-add-row">
          <select class="form-input form-select" id="wiz-reviewer-select" style="flex:1">
            <option value="">— Add a team member —</option>
            ${memberOptions}
          </select>
          <button class="btn btn-primary btn-sm" id="wiz-add-reviewer-btn">+ Add</button>
        </div>

        ${!members.length ? `
          <div class="wiz-no-members-hint">
            ⚠ No project members defined yet.
            <a href="/project/${project.id}/settings" target="_blank">Go to Project Settings → Team &amp; Roles</a> to add team members first.
          </div>` : ''}

        <div class="wiz-role-legend">
          ${REVIEW_ROLES.map(rr => `
            <span class="wiz-role-legend-item">
              <span class="wiz-role-dot" style="background:${ROLE_BADGE_COLORS[rr.value]}"></span>
              <strong>${rr.label}</strong> — ${rr.desc}
            </span>`).join('')}
        </div>

        <div id="wiz-reviewers-list" style="margin-top:16px">
          ${renderReviewerRows()}
        </div>
      </div>
    `;

    function wireReviewerRows() {
      body.querySelectorAll('.wiz-del-reviewer').forEach(btn => {
        btn.onclick = () => {
          state.reviewers.splice(parseInt(btn.dataset.idx), 1);
          reRenderReviewers();
        };
      });
      body.querySelectorAll('.wiz-review-role-sel').forEach(sel => {
        sel.onchange = e => {
          state.reviewers[parseInt(sel.dataset.idx)].review_role = e.target.value;
          const modWarn = body.querySelector('#wiz-mod-warn');
          if (modWarn) modWarn.style.display = (isInspection && !hasModerator()) ? '' : 'none';
        };
      });
    }
    wireReviewerRows();

    body.querySelector('#wiz-add-reviewer-btn').onclick = () => {
      const val = body.querySelector('#wiz-reviewer-select').value;
      if (!val) return;
      const [userId, roleId] = val.split('|');
      const member = members.find(m => m.user_id === userId && (m.role_id || '') === roleId);
      if (!member) return;
      if (state.reviewers.find(r => r.user_id === userId)) return;
      state.reviewers.push({
        user_id:      userId,
        role_id:      roleId || null,
        role_name:    member.project_roles?.name || 'Member',
        role_code:    member.project_roles?.code || '',
        display_name: member.display_name,
        review_role:  'reviewer',
      });
      reRenderReviewers();
    };
  }

  function renderStep4(body) {
    const totalSelected = Object.values(state.selected).reduce((sum, s) => sum + s.size, 0);
    const tpl = templates?.find(t => t.id === state.template_id);
    const reviewTypeInfo = REVIEW_TYPES.find(rt => rt.value === state.review_type);

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

    const noMod = state.review_type === 'inspection' && !state.reviewers.some(r => r.review_role === 'moderator');

    body.innerHTML = `
      <div class="wiz-step-body">
        <h3>Confirm &amp; Start</h3>

        <div class="wiz-confirm-cards">
          <div class="wiz-confirm-card">
            <div class="wiz-confirm-card-label">Session</div>
            <div class="wiz-confirm-card-value">${escHtml(state.title)}</div>
          </div>
          <div class="wiz-confirm-card" style="--cc-color:${reviewTypeInfo?.color || '#5f6368'}">
            <div class="wiz-confirm-card-label">Type</div>
            <div class="wiz-confirm-card-value">${reviewTypeInfo?.icon || ''} ${escHtml(reviewTypeInfo?.label || state.review_type)}</div>
          </div>
          <div class="wiz-confirm-card">
            <div class="wiz-confirm-card-label">Protocol</div>
            <div class="wiz-confirm-card-value">${tpl ? escHtml(tpl.name) + (tpl.current_version ? ' v' + tpl.current_version : ' (draft)') : 'None'}</div>
          </div>
          <div class="wiz-confirm-card">
            <div class="wiz-confirm-card-label">Date</div>
            <div class="wiz-confirm-card-value">${escHtml(state.planned_date)}</div>
          </div>
          <div class="wiz-confirm-card" style="--cc-color:#1a73e8">
            <div class="wiz-confirm-card-label">Artifacts</div>
            <div class="wiz-confirm-card-value">${totalSelected}</div>
          </div>
          <div class="wiz-confirm-card" style="--cc-color:#34a853">
            <div class="wiz-confirm-card-label">Reviewers</div>
            <div class="wiz-confirm-card-value">${state.reviewers.length}</div>
          </div>
        </div>

        ${noMod ? `<div class="wiz-mod-banner" style="margin-bottom:16px">⚠️ <strong>Warning:</strong> Inspection type requires a Moderator. Go back to assign one.</div>` : ''}
        ${!totalSelected ? `<div class="wiz-mod-banner" style="margin-bottom:16px">⚠️ No artifacts selected. Go back and select at least one.</div>` : ''}

        <div class="wiz-confirm-sections">
          ${state.reviewers.length ? `
            <div class="wiz-confirm-section">
              <h4>Review Team (${state.reviewers.length})</h4>
              <div class="wiz-reviewer-cards">
                ${state.reviewers.map(r => `
                  <div class="wiz-reviewer-card wiz-reviewer-card--readonly">
                    <span class="wiz-reviewer-name">${escHtml(r.display_name)}</span>
                    ${r.role_code ? `<span class="members-role-pill" style="font-size:11px">${escHtml(r.role_code)}</span>` : ''}
                    <span class="wiz-review-role-badge" style="background:${ROLE_BADGE_COLORS[r.review_role] || '#5f6368'}">${r.review_role}</span>
                  </div>`).join('')}
              </div>
            </div>` : ''}

          ${totalSelected ? `
            <div class="wiz-confirm-section">
              <h4>Selected Artifacts (${totalSelected})</h4>
              <table class="data-table">
                <thead><tr><th>Code</th><th>Title</th><th>Type</th><th>Status</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Navigation ───────────────────────────────────────────────────────

  async function advanceStep() {
    if (state.step === 1) {
      state.title = document.getElementById('wiz-title')?.value.trim() || state.title;
      if (!state.title) { toast('Please enter a session title.', 'error'); return; }
      if (state.template_id) {
        const { data: secs } = await sb.from('review_template_sections')
          .select('id').eq('template_id', state.template_id).limit(1);
        if (!secs?.length) {
          toast('The selected protocol has no checklist sections. Add criteria in Project Settings → Review Protocols first.', 'error');
          return;
        }
      }
      state.step = 2;
    } else if (state.step === 2) {
      state.step = 3;
    } else if (state.step === 3) {
      state.step = 4;
    } else if (state.step === 4) {
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

  // ── Session creation ─────────────────────────────────────────────────

  async function createSession() {
    const btn = document.getElementById('wiz-btn-next');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const tpl = (templates || []).find(t => t.id === state.template_id);

    const { data: session, error: se } = await sb.from('review_sessions').insert({
      project_id:       project.id,
      template_id:      state.template_id || null,
      template_version: tpl?.current_version || null,
      created_by:       currentUser?.id || null,
      title:            state.title,
      review_type:      state.review_type,
      status:           'in_progress',
      planned_date:     state.planned_date || null,
    }).select().single();

    if (se || !session) {
      toast('Failed to create session: ' + (se?.message || 'unknown error'), 'error');
      btn.disabled = false; btn.textContent = '▶ Start Review'; return;
    }

    // Take snapshots
    const snapshotInserts = [];
    for (const [type, ids] of Object.entries(state.selected)) {
      for (const id of ids) {
        const art = (state.artifacts[type] || []).find(a => a.id === id);
        if (!art) continue;
        const fullRow = await fetchFullArtifact(type, id);
        const row = fullRow || art;
        snapshotInserts.push({
          session_id:          session.id,
          artifact_type:       type,
          artifact_id:         id,
          artifact_code:       art.code || '',
          artifact_title:      art.title || art.name || '',
          snapshot_data:       row,
          artifact_updated_at: art.updated_at || null,
          artifact_version:    row.version ?? null,
          is_current:          true,
        });
      }
    }

    if (snapshotInserts.length) {
      const { error: snapErr } = await sb.from('review_artifact_snapshots').insert(snapshotInserts);
      if (snapErr) toast('Session created but snapshots failed: ' + snapErr.message, 'error');
    }

    // Assign reviewers
    if (state.reviewers.length) {
      const reviewerInserts = state.reviewers.map(r => ({
        session_id:  session.id,
        user_id:     r.user_id,
        role:        r.role_code || r.role_name,
        review_role: r.review_role || 'reviewer',
      }));
      const { error: rvErr } = await sb.from('review_session_reviewers').insert(reviewerInserts);
      if (rvErr) toast('Session created but reviewer assignments failed: ' + rvErr.message, 'error');
    }

    toast('Review session started!', 'success');
    navigate(`${base}/reviews/${session.id}/execute`);
  }

  // ── Artifact fetchers ────────────────────────────────────────────────

  async function fetchArtifacts(type, projectId) {
    if (type === 'requirements') {
      const { data } = await sb.from('requirements')
        .select('id, req_code, title, status, type, parent_type, parent_id, updated_at')
        .eq('project_id', projectId).order('req_code');
      return (data || []).map(r => ({ ...r, code: r.req_code }));
    }
    if (type === 'arch_spec_items') {
      const { data } = await sb.from('arch_spec_items')
        .select('id, spec_code, title, status, type, parent_type, parent_id, updated_at')
        .eq('project_id', projectId).order('spec_code');
      return (data || []).map(r => ({ ...r, code: r.spec_code }));
    }
    if (type === 'test_specs') {
      const { data } = await sb.from('test_specs')
        .select('id, test_code, name, status, level, parent_type, parent_id, updated_at')
        .eq('project_id', projectId).order('test_code');
      return (data || []).map(r => ({ ...r, code: r.test_code, title: r.name }));
    }
    if (type === 'safety_analysis_rows') {
      const { data } = await sb.from('safety_analyses')
        .select('id, analysis_code, title, analysis_type, status, parent_type, parent_id, updated_at')
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
