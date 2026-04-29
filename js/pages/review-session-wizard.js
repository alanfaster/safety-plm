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
    navPages: {},    // { [parentId]: [page, ...] }
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

  // ── Tree constants ────────────────────────────────────────────────────────────
  // Mirrors sidebar.js DOMAINS / ALL_PHASES / SUB_PHASES
  const WIZ_DOMAINS = [
    { key: 'system', label: 'System',  icon: '⬡', phases: ['item_definition','requirements','architecture','design','implementation','unit_testing','integration_testing','system_testing','validation'] },
    { key: 'sw',     label: 'SW',      icon: '◧', phases: ['item_definition','requirements','architecture','design','implementation','unit_testing'] },
    { key: 'hw',     label: 'HW',      icon: '◨', phases: ['item_definition','requirements','architecture','design','implementation','unit_testing'] },
    { key: 'mech',   label: 'MECH',    icon: '◎', phases: ['item_definition','requirements','architecture','design','implementation','unit_testing'] },
  ];
  const PHASE_ICONS = {
    item_definition:'▤', requirements:'≡', architecture:'◈', design:'◇',
    implementation:'◫', unit_testing:'◉', integration_testing:'⊕', system_testing:'▣', validation:'✓',
  };
  const PHASE_LABELS = {
    item_definition:'Definition', requirements:'Requirements', architecture:'Architecture',
    design:'Design', implementation:'Implementation', unit_testing:'Unit Testing',
    integration_testing:'Integration Testing', system_testing:'System Testing', validation:'Validation',
  };
  // Which artifact type belongs to which phase (only under 'system' domain to avoid duplication)
  const PHASE_ART_TYPE = {
    requirements: 'requirements',
    architecture: 'arch_spec_items',
    unit_testing: 'test_specs:unit',
    integration_testing: 'test_specs:integration',
    system_testing: 'test_specs:system',
    validation: 'test_specs:validation',
  };
  const SAFETY_ITEMS = ['HARA','FSC','TSC','FTA','DFA','FMEA','DFMEA'];

  async function renderStep2(body) {
    body.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

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
        // Systems + nav_pages in parallel for all items
        await Promise.all(state.items.map(async it => {
          const [{ data: syss }, { data: pages }] = await Promise.all([
            sb.from('systems').select('id, name, system_code').eq('item_id', it.id).order('created_at'),
            sb.from('nav_pages').select('*').eq('parent_type','item').eq('parent_id', it.id).order('sort_order'),
          ]);
          state.systems[it.id]  = syss  || [];
          state.navPages[it.id] = pages || [];
        }));
        // Nav pages for all systems
        const allSystems = Object.values(state.systems).flat();
        if (allSystems.length) {
          await Promise.all(allSystems.map(async sys => {
            const { data: pages } = await sb.from('nav_pages')
              .select('*').eq('parent_type','system').eq('parent_id', sys.id).order('sort_order');
            state.navPages[sys.id] = pages || [];
          }));
        }
      }
    }

    const typeKeys = Object.keys(ARTIFACT_TYPE_LABELS);
    typeKeys.forEach(k => { if (!state.selected[k]) state.selected[k] = new Set(); });
    if (!state.selected_pages) state.selected_pages = new Set();

    const totalAll = Object.values(state.artifacts).reduce((s, arr) => s + arr.length, 0);
    const totalPages = Object.values(state.navPages).reduce((s, arr) => s + arr.length, 0);
    if (!totalAll && !totalPages) {
      body.innerHTML = `<div class="wiz-step-body">
        <h3>Select Artifacts to Review</h3>
        <p class="rv-empty" style="padding:32px 0">No artifacts found for this project.</p>
      </div>`;
      return;
    }

    // artsByLeaf: 'art:{pType}:{pId}:{artType}' → [art,...]
    // test_specs split by level:  'art:{pType}:{pId}:test_specs:{level}'
    const artsByLeaf = {};
    typeKeys.forEach(artType => {
      (state.artifacts[artType] || []).forEach(art => {
        const pPrefix = art.parent_type === 'system' ? 'sys' : 'item';
        let key;
        if (artType === 'test_specs') {
          const lvl = art.level || 'unit';
          key = `art:${pPrefix}:${art.parent_id}:test_specs:${lvl}`;
        } else {
          key = `art:${pPrefix}:${art.parent_id}:${artType}`;
        }
        if (!artsByLeaf[key]) artsByLeaf[key] = [];
        artsByLeaf[key].push(art);
      });
    });

    // pagesByDomainPhase: { [parentId]: { [domain]: { [phase]: [page,...] } } }
    function getPagesFor(parentId) {
      const pages = state.navPages[parentId] || [];
      const map = {};
      pages.filter(p => !p.parent_page_id && !p.is_folder).forEach(p => {
        if (!map[p.domain]) map[p.domain] = {};
        if (!map[p.domain][p.phase]) map[p.domain][p.phase] = [];
        map[p.domain][p.phase].push(p);
      });
      // also include folders and their children as flat list
      pages.filter(p => p.is_folder).forEach(folder => {
        if (!map[folder.domain]) map[folder.domain] = {};
        if (!map[folder.domain][folder.phase]) map[folder.domain][folder.phase] = [];
        map[folder.domain][folder.phase].push(folder);
      });
      return map;
    }
    function getFolderChildren(parentId, folderId) {
      return (state.navPages[parentId] || []).filter(p => p.parent_page_id === folderId);
    }

    // Collapse state
    const _groupOpen = {};
    if (state.items.length) {
      _groupOpen[`item-${state.items[0].id}`] = true;
      _groupOpen[`item-${state.items[0].id}-system`] = true;
    }

    // Active leaf: pick the first art node that has data
    let _activeNode = null;
    outer: for (const it of state.items) {
      for (const ph of Object.keys(PHASE_ART_TYPE)) {
        const [baseType, lvl] = PHASE_ART_TYPE[ph].split(':');
        const key = lvl
          ? `art:item:${it.id}:${baseType}:${lvl}`
          : `art:item:${it.id}:${PHASE_ART_TYPE[ph]}`;
        if ((artsByLeaf[key] || []).length) { _activeNode = key; break outer; }
      }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function countSelected() {
      return Object.values(state.selected).reduce((s, set) => s + set.size, 0)
           + (state.selected_pages?.size || 0);
    }

    function artLeafSel(key) {
      const baseType = key.split(':')[3];
      return (artsByLeaf[key] || []).filter(a => state.selected[baseType]?.has(a.id)).length;
    }
    function artLeafTotal(key) { return (artsByLeaf[key] || []).length; }

    // Flat artifact counts per parent (domain-independent — artifacts don't have a domain field)
    function parentArtTotal(pPrefix, parentId) {
      let n = 0;
      Object.keys(PHASE_ART_TYPE).forEach(ph => {
        const [bt, lvl] = PHASE_ART_TYPE[ph].split(':');
        const key = lvl ? `art:${pPrefix}:${parentId}:${bt}:${lvl}` : `art:${pPrefix}:${parentId}:${PHASE_ART_TYPE[ph]}`;
        n += artLeafTotal(key);
      });
      n += artLeafTotal(`art:${pPrefix}:${parentId}:safety_analysis_rows`);
      return n;
    }
    function parentArtSel(pPrefix, parentId) {
      let n = 0;
      Object.keys(PHASE_ART_TYPE).forEach(ph => {
        const [bt, lvl] = PHASE_ART_TYPE[ph].split(':');
        const key = lvl ? `art:${pPrefix}:${parentId}:${bt}:${lvl}` : `art:${pPrefix}:${parentId}:${PHASE_ART_TYPE[ph]}`;
        n += artLeafSel(key);
      });
      n += artLeafSel(`art:${pPrefix}:${parentId}:safety_analysis_rows`);
      return n;
    }
    function parentPageTotal(parentId) {
      const pages = state.navPages[parentId] || [];
      return pages.filter(p => !p.parent_page_id).length;
    }
    function parentPageSel(parentId) {
      return (state.navPages[parentId] || []).filter(p => state.selected_pages?.has(p.id)).length;
    }
    function parentTotal(pPrefix, parentId) { return parentArtTotal(pPrefix, parentId) + parentPageTotal(parentId); }
    function parentSel(pPrefix, parentId)   { return parentArtSel(pPrefix, parentId)   + parentPageSel(parentId); }
    function itemTotal(it) {
      return parentTotal('item', it.id)
           + (state.systems[it.id] || []).reduce((s, sys) => s + parentTotal('sys', sys.id), 0);
    }
    function itemSel(it) {
      return parentSel('item', it.id)
           + (state.systems[it.id] || []).reduce((s, sys) => s + parentSel('sys', sys.id), 0);
    }

    function badge(sel, total) {
      if (!total) return '';
      if (sel > 0) return `<span class="wiz-tree-badge">${sel}/${total}</span>`;
      return `<span class="wiz-tree-total">${total}</span>`;
    }

    // ── Tree renderers ────────────────────────────────────────────────────────

    // Artifact leaves only shown under 'system' or 'item' domains (primary domains).
    // SW/HW/MECH only host nav_pages, not artifact rows.
    function isArtDomain(domKey) { return domKey === 'system' || domKey === 'item'; }

    function renderArtLeaf(pPrefix, parentId, phase, domKey) {
      if (!isArtDomain(domKey)) return '';
      const artType = PHASE_ART_TYPE[phase];
      if (!artType) return '';
      const [baseType, lvl] = artType.split(':');
      const nodeKey = lvl
        ? `art:${pPrefix}:${parentId}:${baseType}:${lvl}`
        : `art:${pPrefix}:${parentId}:${artType}`;
      const total = artLeafTotal(nodeKey);
      if (!total) return '';
      const sel    = artLeafSel(nodeKey);
      const active = _activeNode === nodeKey;
      const icon   = ARTIFACT_TYPE_ICONS[baseType] || '📄';
      const label  = lvl
        ? `${ARTIFACT_TYPE_LABELS[baseType]} (${PHASE_LABELS[phase]})`
        : ARTIFACT_TYPE_LABELS[baseType];
      return `<div class="wiz-tree-leaf ${active ? 'active' : ''}" data-node="${nodeKey}" data-leaf-type="art">
        <span class="wiz-tree-leaf-icon">${icon}</span>
        <span class="wiz-tree-label">${label}</span>
        ${badge(sel, total)}
      </div>`;
    }

    function renderPageLeaf(page) {
      const sel    = state.selected_pages?.has(page.id);
      const active = _activeNode === `page:${page.id}`;
      const icon   = page.is_folder ? '📁' : (page.page_type === 'wiki' ? '📄' : '╰');
      return `<div class="wiz-tree-leaf ${active ? 'active' : ''} ${page.is_folder ? 'wiz-tree-folder' : ''}"
        data-node="page:${page.id}" data-leaf-type="page" data-page-id="${page.id}">
        <span class="wiz-tree-leaf-icon">${icon}</span>
        <span class="wiz-tree-label">${escHtml(page.name)}</span>
        ${page.is_folder ? '' : (sel ? `<span class="wiz-tree-badge">✓</span>` : '')}
      </div>`;
    }

    // Always render phase rows (mirrors sidebar which shows all phases even when empty)
    function renderPhaseRow(pPrefix, parentId, phase, domKey, pageMap) {
      const artLeaf   = renderArtLeaf(pPrefix, parentId, phase, domKey);
      const phPages   = (pageMap[domKey] || {})[phase] || [];
      const pageLeaves = phPages.map(p => {
        if (p.is_folder) {
          const children = getFolderChildren(parentId, p.id);
          const gKey = `folder-${p.id}`;
          const open = _groupOpen[gKey] !== false;
          return `
            <div class="wiz-tree-group ${open ? 'open' : 'closed'}" data-group="${gKey}">
              <div class="wiz-tree-group-hdr wiz-tree-folder-hdr">
                <span class="wiz-tree-chevron">▶</span>
                <span class="wiz-tree-leaf-icon">📁</span>
                <span class="wiz-tree-label">${escHtml(p.name)}</span>
              </div>
              <div class="wiz-tree-group-body">
                ${children.map(c => renderPageLeaf(c)).join('')}
              </div>
            </div>`;
        }
        return renderPageLeaf(p);
      }).join('');

      const icon  = PHASE_ICONS[phase] || '•';
      const label = PHASE_LABELS[phase] || phase;

      if (!artLeaf && !pageLeaves) {
        // Empty phase: render as simple leaf (no expand arrow)
        return `<div class="wiz-tree-leaf wiz-tree-phase-leaf"
          data-node="phase:${pPrefix}:${parentId}:${domKey}:${phase}" data-leaf-type="phase">
          <span class="wiz-tree-leaf-icon">${icon}</span>
          <span class="wiz-tree-label">${label}</span>
        </div>`;
      }

      const phGKey = `ph-${pPrefix}-${parentId}-${domKey}-${phase}`;
      const phOpen = _groupOpen[phGKey] !== false;
      return `
        <div class="wiz-tree-group ${phOpen ? 'open' : 'closed'}" data-group="${phGKey}">
          <div class="wiz-tree-group-hdr wiz-tree-phase-hdr">
            <span class="wiz-tree-chevron">▶</span>
            <span class="wiz-tree-leaf-icon">${icon}</span>
            <span class="wiz-tree-label">${label}</span>
          </div>
          <div class="wiz-tree-group-body">
            ${artLeaf}${pageLeaves}
          </div>
        </div>`;
    }

    // Always render domain groups — never hide due to empty content
    function renderDomainGroup(pPrefix, parentId, dom) {
      const pageMap = getPagesFor(parentId);
      const gKey    = `${pPrefix}-${parentId}-${dom.key}`;
      const open    = _groupOpen[gKey] !== false;

      const phases = dom.phases.map(ph =>
        renderPhaseRow(pPrefix, parentId, ph, dom.key, pageMap)
      ).join('');

      // Count only for badge — don't use for visibility
      let artSel = 0, artTotal = 0;
      if (isArtDomain(dom.key)) {
        dom.phases.forEach(ph => {
          const artType = PHASE_ART_TYPE[ph];
          if (!artType) return;
          const [bt, lvl] = artType.split(':');
          const key = lvl ? `art:${pPrefix}:${parentId}:${bt}:${lvl}` : `art:${pPrefix}:${parentId}:${artType}`;
          artSel   += artLeafSel(key);
          artTotal += artLeafTotal(key);
        });
      }
      const pageSel   = (state.navPages[parentId] || []).filter(p => p.domain === dom.key && !p.parent_page_id && state.selected_pages?.has(p.id)).length;
      const pageTotal = (state.navPages[parentId] || []).filter(p => p.domain === dom.key && !p.parent_page_id).length;
      const sel = artSel + pageSel;
      const total = artTotal + pageTotal;

      return `
        <div class="wiz-tree-group ${open ? 'open' : 'closed'}" data-group="${gKey}">
          <div class="wiz-tree-group-hdr wiz-tree-domain-hdr">
            <span class="wiz-tree-chevron">▶</span>
            <span class="wiz-tree-group-icon">${dom.icon}</span>
            <span class="wiz-tree-label">${dom.label}</span>
            ${badge(sel, total)}
          </div>
          <div class="wiz-tree-group-body">${phases}</div>
        </div>`;
    }

    function renderSafetyGroup(pPrefix, parentId) {
      const safetyPages = (state.navPages[parentId] || []).filter(p => p.domain === 'safety' && !p.parent_page_id);
      const safetyArts  = (artsByLeaf[`art:${pPrefix}:${parentId}:safety_analysis_rows`] || []);
      const total = safetyArts.length + safetyPages.filter(p => !p.is_folder).length;
      if (!total) return '';
      const artKey = `art:${pPrefix}:${parentId}:safety_analysis_rows`;
      const sel    = artLeafSel(artKey) + safetyPages.filter(p => state.selected_pages?.has(p.id)).length;
      const gKey   = `safety-${pPrefix}-${parentId}`;
      const open   = _groupOpen[gKey] !== false;
      const artLeaf = safetyArts.length ? `
        <div class="wiz-tree-leaf ${_activeNode === artKey ? 'active' : ''}" data-node="${artKey}" data-leaf-type="art">
          <span class="wiz-tree-leaf-icon">⚠️</span>
          <span class="wiz-tree-label">Safety Analyses</span>
          ${badge(artLeafSel(artKey), safetyArts.length)}
        </div>` : '';
      const pageLeaves = safetyPages.map(p => renderPageLeaf(p)).join('');
      return `
        <div class="wiz-tree-group ${open ? 'open' : 'closed'}" data-group="${gKey}">
          <div class="wiz-tree-group-hdr wiz-tree-domain-hdr">
            <span class="wiz-tree-chevron">▶</span>
            <span class="wiz-tree-group-icon">△</span>
            <span class="wiz-tree-label">Safety</span>
            ${badge(sel, total)}
          </div>
          <div class="wiz-tree-group-body">${artLeaf}${pageLeaves}</div>
        </div>`;
    }

    // Render one system block — always show regardless of content count
    function renderSystemBlock(sys) {
      const label  = sys.system_code ? `${sys.system_code} · ${sys.name}` : sys.name;
      const gKey   = `sys-block-${sys.id}`;
      const open   = _groupOpen[gKey] !== false;
      const sel    = parentSel('sys', sys.id);
      const total  = parentTotal('sys', sys.id);

      const domGroups   = WIZ_DOMAINS.map(d => renderDomainGroup('sys', sys.id, d)).join('');
      const safetyGroup = renderSafetyGroup('sys', sys.id);

      return `
        <div class="wiz-tree-group ${open ? 'open' : 'closed'}" data-group="${gKey}">
          <div class="wiz-tree-group-hdr wiz-tree-parent-hdr">
            <span class="wiz-tree-chevron">▶</span>
            <span class="wiz-tree-group-icon">⚙</span>
            <span class="wiz-tree-label">${escHtml(label)}</span>
            ${badge(sel, total)}
          </div>
          <div class="wiz-tree-group-body">
            ${domGroups}${safetyGroup}
          </div>
        </div>`;
    }

    function renderItemNode(it) {
      const gKey   = `item-${it.id}`;
      const open   = _groupOpen[gKey] !== false;
      const systems = state.systems[it.id] || [];
      const sel    = itemSel(it);
      const total  = itemTotal(it);

      // Item level: when systems exist, sidebar uses a single 'item' domain group (V-cycle)
      //             when no systems, sidebar uses all 4 DOMAINS (system/sw/hw/mech)
      let itemContent;
      if (systems.length > 0) {
        const vcycleDom = { key: 'item', label: 'V-cycle', icon: '⬡',
          phases: Object.keys(PHASE_ICONS) };
        itemContent = renderDomainGroup('item', it.id, vcycleDom)
                    + renderSafetyGroup('item', it.id);
      } else {
        itemContent = WIZ_DOMAINS.map(d => renderDomainGroup('item', it.id, d)).join('')
                    + renderSafetyGroup('item', it.id);
      }

      const sysSection = systems.length ? `
        <div class="wiz-tree-section-label">Systems</div>
        ${systems.map(sys => renderSystemBlock(sys)).join('')}` : '';

      return `
        <div class="wiz-tree-group ${open ? 'open' : 'closed'}" data-group="${gKey}">
          <div class="wiz-tree-group-hdr wiz-tree-item-hdr">
            <span class="wiz-tree-chevron">▶</span>
            <span class="wiz-tree-group-icon">📁</span>
            <span class="wiz-tree-label">${escHtml(it.name)}</span>
            ${badge(sel, total)}
          </div>
          <div class="wiz-tree-group-body">
            ${itemContent}${sysSection}
          </div>
        </div>`;
    }

    function renderLeftTree() {
      return state.items.map(it => renderItemNode(it)).join('');
    }

    // ── Right panel ───────────────────────────────────────────────────────────

    function renderRightPanel(nodeKey) {
      if (!nodeKey) return `<p class="rv-empty" style="padding:32px">Select an element on the left.</p>`;

      if (nodeKey.startsWith('page:')) {
        const pageId = nodeKey.split(':')[1];
        const page   = Object.values(state.navPages).flat().find(p => p.id === pageId);
        if (!page) return `<p class="rv-empty" style="padding:32px">Page not found.</p>`;
        const sel = state.selected_pages?.has(pageId);
        return `
          <div class="wiz-rp-section">
            <div class="wiz-rp-section-hdr">
              <span class="wiz-rp-type-label">${page.page_type === 'wiki' ? '📄' : '╰'} Document page</span>
            </div>
            <div style="padding:20px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px">
                <input type="checkbox" class="wiz-page-chk" data-page-id="${pageId}" ${sel ? 'checked' : ''}
                  style="width:16px;height:16px"/>
                <span><strong>${escHtml(page.name)}</strong></span>
              </label>
              <p class="form-hint" style="margin-top:8px">Include this document page in the review snapshot.</p>
            </div>
          </div>`;
      }

      // art: node
      const parts    = nodeKey.split(':');  // ['art', pType, pId, baseType, lvl?]
      const baseType = parts[3];
      const list     = artsByLeaf[nodeKey] || [];
      if (!list.length) return `<p class="rv-empty" style="padding:32px">No artifacts here.</p>`;

      const sel      = state.selected[baseType];
      const selCount = list.filter(a => sel?.has(a.id)).length;

      const rows = list.map(a => `
        <tr class="wiz-art-row" data-type="${baseType}" data-id="${a.id}">
          <td style="width:28px"><input type="checkbox" class="wiz-art-chk"
            data-type="${baseType}" data-id="${a.id}" ${sel?.has(a.id) ? 'checked' : ''}/></td>
          <td class="mono" style="white-space:nowrap">${escHtml(a.code || '—')}</td>
          <td style="width:100%">${escHtml(a.title || a.name || '—')}</td>
          <td style="white-space:nowrap"><span class="badge badge-${escHtml(a.status || 'draft')}">${escHtml(a.status || '—')}</span></td>
        </tr>`).join('');

      return `
        <div class="wiz-rp-section">
          <div class="wiz-rp-section-hdr">
            <span class="wiz-rp-type-label">${ARTIFACT_TYPE_ICONS[baseType] || '📄'} ${ARTIFACT_TYPE_LABELS[baseType] || baseType}</span>
            <span class="wiz-rp-sel-count">${selCount}/${list.length}</span>
            <button type="button" class="btn btn-ghost btn-xs wiz-rp-sel-all" data-type="${baseType}">All</button>
            <button type="button" class="btn btn-ghost btn-xs wiz-rp-sel-none" data-type="${baseType}">None</button>
          </div>
          <table class="data-table wiz-art-table"><tbody>${rows}</tbody></table>
        </div>`;
    }

    // ── Layout + wiring ───────────────────────────────────────────────────────

    body.innerHTML = `
      <div class="wiz-step-body wiz-s2-layout">
        <div class="wiz-s2-topbar">
          <h3>Select Artifacts to Review</h3>
          <span class="wiz-total-selected" id="wiz-total-sel">${countSelected()} selected</span>
        </div>
        <div class="wiz-s2-split">
          <nav class="wiz-s2-tree" id="wiz-s2-tree">${renderLeftTree()}</nav>
          <div class="wiz-s2-panel" id="wiz-s2-panel">${renderRightPanel(_activeNode)}</div>
        </div>
      </div>`;

    wireStep2(body);

    function wireStep2(root) {
      root.querySelectorAll('.wiz-tree-group-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
          if (e.target.closest('.wiz-tree-leaf')) return;
          const group = hdr.closest('.wiz-tree-group');
          const gKey  = group?.dataset.group;
          if (!gKey) return;
          const open = group.classList.toggle('open');
          group.classList.toggle('closed', !open);
          _groupOpen[gKey] = open;
        });
      });
      root.querySelectorAll('.wiz-tree-leaf').forEach(leaf => {
        leaf.addEventListener('click', e => {
          e.stopPropagation();
          _activeNode = leaf.dataset.node;
          root.querySelectorAll('.wiz-tree-leaf').forEach(l =>
            l.classList.toggle('active', l.dataset.node === _activeNode));
          root.querySelector('#wiz-s2-panel').innerHTML = renderRightPanel(_activeNode);
          wireRightPanel(root);
        });
      });
      wireRightPanel(root);
    }

    function wireRightPanel(root) {
      root.querySelectorAll('.wiz-art-chk').forEach(chk => {
        chk.onchange = e => {
          if (e.target.checked) state.selected[chk.dataset.type].add(chk.dataset.id);
          else state.selected[chk.dataset.type].delete(chk.dataset.id);
          refreshTree(root);
        };
      });
      root.querySelectorAll('.wiz-page-chk').forEach(chk => {
        chk.onchange = e => {
          if (e.target.checked) state.selected_pages.add(chk.dataset.pageId);
          else state.selected_pages.delete(chk.dataset.pageId);
          refreshTree(root);
        };
      });
      root.querySelectorAll('.wiz-rp-sel-all, .wiz-rp-sel-none').forEach(btn => {
        btn.onclick = () => {
          const isAll = btn.classList.contains('wiz-rp-sel-all');
          const { type } = btn.dataset;
          const list  = artsByLeaf[_activeNode] || [];
          list.forEach(a => { if (isAll) state.selected[type].add(a.id); else state.selected[type].delete(a.id); });
          root.querySelector('#wiz-s2-panel').innerHTML = renderRightPanel(_activeNode);
          wireRightPanel(root);
          refreshTree(root);
        };
      });
    }

    function refreshTree(root) {
      root.querySelector('#wiz-total-sel').textContent = `${countSelected()} selected`;
      root.querySelector('#wiz-s2-tree').innerHTML = renderLeftTree();
      wireStep2(root);
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
