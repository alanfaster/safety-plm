/**
 * Safety ALM — Main Application Controller
 * Bootstraps auth, routing, and page rendering.
 */
import { sb, buildCode, nextIndex } from './config.js';
import { requireAuth } from './auth.js';
import { route, navigate, init as initRouter } from './router.js';
import { t } from './i18n/index.js';
import { initTopbar, setBreadcrumb } from './components/topbar.js';
import { renderSidebar } from './components/sidebar.js';
import { showModal, hideModal } from './components/modal.js';
import { toast } from './toast.js';

import { render as renderProjects }    from './pages/projects.js';
import { render as renderProject  }    from './pages/project.js';
import { renderVcycle }                from './pages/vcycle.js';
import { renderHara }                  from './pages/safety/hara.js';
import { renderFmea }                  from './pages/safety/fmea.js';
import { renderPHA }                   from './pages/safety/pha.js';
import { renderFHA }                   from './pages/safety/fha.js';
import { renderSafetyGeneric }         from './pages/safety/generic.js';
import { renderProjectSettings }       from './pages/project-settings.js';

// ── Shared state ──────────────────────────────────────────────────────
const state = {
  user: null,
  projectCache: {},
  itemCache: {},
  systemCache: {},
};

// ── Data helpers ──────────────────────────────────────────────────────
async function getProject(id) {
  if (state.projectCache[id]) return state.projectCache[id];
  const { data } = await sb.from('projects').select('*').eq('id', id).single();
  if (data) state.projectCache[id] = data;
  return data;
}

async function getItem(id) {
  if (state.itemCache[id]) return state.itemCache[id];
  const { data } = await sb.from('items').select('*').eq('id', id).single();
  if (data) state.itemCache[id] = data;
  return data;
}

async function getSystem(id) {
  if (state.systemCache[id]) return state.systemCache[id];
  const { data } = await sb.from('systems').select('*').eq('id', id).single();
  if (data) state.systemCache[id] = data;
  return data;
}

async function getSystems(itemId) {
  const { data } = await sb.from('systems').select('*').eq('item_id', itemId).order('created_at');
  return data || [];
}

// ── Content area helpers ──────────────────────────────────────────────
function setLoading() {
  document.getElementById('content').innerHTML =
    '<div class="content-loading"><div class="spinner"></div></div>';
}

function getContent() { return document.getElementById('content'); }

// ── Add System Modal ──────────────────────────────────────────────────
function openAddSystemModal(project, item, onDone) {
  showModal({
    title: t('systems.new'),
    body: `
      <div class="form-grid cols-1">
        <div class="form-group">
          <label class="form-label">${t('systems.name')} *</label>
          <input class="form-input" id="s-name" placeholder="e.g. Electronic Control Unit"/>
        </div>
        <div class="form-group">
          <label class="form-label">${t('systems.description')}</label>
          <textarea class="form-input form-textarea" id="s-desc" rows="2"></textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary"   id="m-create">${t('systems.create')}</button>
    `
  });

  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-create').onclick = async () => {
    const name = document.getElementById('s-name').value.trim();
    if (!name) { document.getElementById('s-name').focus(); return; }
    const desc = document.getElementById('s-desc').value.trim();

    const btn = document.getElementById('m-create');
    btn.disabled = true;

    const sysIdx = await nextIndex('systems', { item_id: item.id });
    const sysCode = buildCode('SYS', { projectName: project.name, systemName: name, index: sysIdx });

    const { data, error } = await sb.from('systems').insert({
      item_id: item.id,
      system_code: sysCode,
      name, description: desc,
    }).select().single();

    btn.disabled = false;
    if (error) { toast(t('common.error'), 'error'); return; }
    hideModal();
    toast(`System "${name}" (${data.system_code}) created.`, 'success');
    delete state.itemCache[item.id];
    if (typeof onDone === 'function') onDone(data);
  };
}

// ── Context loader ────────────────────────────────────────────────────
// activePage: plain phase key | 'domain:<domain>:<phase>' | safety type | system id
async function loadItemContext(projectId, itemId, systemId, activePage, activeDomain = null, activePageId = null) {
  const [project, item] = await Promise.all([getProject(projectId), getItem(itemId)]);
  if (!project || !item) return null;

  let system = null;
  if (systemId) system = await getSystem(systemId);

  const systems = await getSystems(itemId);
  const numSystems = item.num_systems ?? 1;

  const crumbs = [
    { label: t('nav.projects'), path: '/projects' },
    { label: project.name,      path: `/project/${projectId}` },
    { label: item.name,         path: `/project/${projectId}/item/${itemId}/vcycle/item_definition` },
  ];
  if (system) crumbs.push({ label: `${system.system_code} · ${system.name}` });
  if (activeDomain) crumbs.push({ label: activeDomain.toUpperCase() });

  setBreadcrumb(crumbs);

  // Build the active page key for sidebar highlighting.
  // When inside a system, prefix with sys:{id}: so only that system's items highlight.
  let sidebarActivePage = activePage;
  if (system) {
    sidebarActivePage = activeDomain
      ? `sys:${system.id}:domain:${activeDomain}:${activePage}`
      : `sys:${system.id}:${activePage}`;
  } else if (activeDomain) {
    sidebarActivePage = `domain:${activeDomain}:${activePage}`;
  }

  await renderSidebar({
    view: system ? 'system' : 'item',
    projectId,
    projectType: project.type,
    itemId,
    itemName: item.name,
    numSystems,
    systemId: system?.id,
    systemName: system?.name,
    activePage: sidebarActivePage,
    activePageId,
    systems,
    onAddSystem: () => openAddSystemModal(project, item, () => {
      delete state.itemCache[item.id];
      window.dispatchEvent(new Event('hashchange'));
    }),
    onReload: () => {
      delete state.itemCache[itemId];
      if (system) delete state.systemCache[system.id];
      window.dispatchEvent(new Event('hashchange'));
    },
  });

  return { project, item, system };
}

// ── Routes ────────────────────────────────────────────────────────────

route('/projects', async () => {
  setLoading();
  try {
    await renderProjects(getContent(), { user: state.user });
  } catch(e) {
    getContent().innerHTML = `<div style="padding:40px;color:red;font-family:monospace;font-size:13px"><strong>ERROR /projects:</strong>\n${e.message}</div>`;
  }
});

route('/project/:projectId', async ({ projectId }) => {
  setLoading();
  const project = await getProject(projectId);
  if (!project) { navigate('/projects'); return; }
  // One item per project — fetch it and navigate directly
  const { data: item } = await sb.from('items').select('*').eq('project_id', projectId).maybeSingle();
  if (!item) {
    // No item yet (legacy / error) — show project page
    await renderProject(getContent(), { projectId });
    return;
  }
  const numSystems = item.num_systems ?? 1;
  if (numSystems === 1) {
    navigate(`/project/${projectId}/item/${item.id}/domain/system/vcycle/item_definition`);
  } else {
    navigate(`/project/${projectId}/item/${item.id}/vcycle/item_definition`);
  }
});

// Item-level V-cycle sub-page (multi-system items)
route('/project/:projectId/item/:itemId/vcycle/:phase/page/:pageId', async ({ projectId, itemId, phase, pageId }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, null, phase, null, pageId);
  if (!ctx) { navigate('/projects'); return; }
  await renderVcycle(getContent(), { ...ctx, phase, domain: 'default', pageId });
});

// Item-level V-cycle (multi-system items)
route('/project/:projectId/item/:itemId/vcycle/:phase', async ({ projectId, itemId, phase }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, null, phase);
  if (!ctx) { navigate('/projects'); return; }
  // If single-system, redirect to domain route
  if ((ctx.item.num_systems ?? 1) === 1) {
    navigate(`/project/${projectId}/item/${itemId}/domain/system/vcycle/${phase}`);
    return;
  }
  await renderVcycle(getContent(), { ...ctx, phase, domain: 'default' });
});

// Item-level domain V-cycle (single-system items)
route('/project/:projectId/item/:itemId/domain/:domain/vcycle/:phase', async ({ projectId, itemId, domain, phase }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, null, phase, domain);
  if (!ctx) { navigate('/projects'); return; }
  await renderVcycle(getContent(), { ...ctx, phase, domain });
});

// Item-level safety
route('/project/:projectId/item/:itemId/safety/:analysisType', async ({ projectId, itemId, analysisType }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, null, analysisType);
  if (!ctx) { navigate('/projects'); return; }
  await renderSafetyPage(getContent(), ctx, 'item', ctx.item.id, analysisType);
});

// Item domain sub-page
route('/project/:projectId/item/:itemId/domain/:domain/vcycle/:phase/page/:pageId', async ({ projectId, itemId, domain, phase, pageId }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, null, phase, domain, pageId);
  if (!ctx) { navigate('/projects'); return; }
  await renderVcycle(getContent(), { ...ctx, phase, domain, pageId });
});

// System domain V-cycle
route('/project/:projectId/item/:itemId/system/:systemId/domain/:domain/vcycle/:phase', async ({ projectId, itemId, systemId, domain, phase }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, systemId, phase, domain);
  if (!ctx) { navigate('/projects'); return; }
  await renderVcycle(getContent(), { ...ctx, phase, domain });
});

// System domain sub-page
route('/project/:projectId/item/:itemId/system/:systemId/domain/:domain/vcycle/:phase/page/:pageId', async ({ projectId, itemId, systemId, domain, phase, pageId }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, systemId, phase, domain, pageId);
  if (!ctx) { navigate('/projects'); return; }
  await renderVcycle(getContent(), { ...ctx, phase, domain, pageId });
});

// System safety
route('/project/:projectId/item/:itemId/system/:systemId/safety/:analysisType', async ({ projectId, itemId, systemId, analysisType }) => {
  setLoading();
  const ctx = await loadItemContext(projectId, itemId, systemId, analysisType);
  if (!ctx) { navigate('/projects'); return; }
  await renderSafetyPage(getContent(), ctx, 'system', ctx.system.id, analysisType);
});

// Legacy system redirect → domain route
route('/project/:projectId/item/:itemId/system/:systemId/vcycle/:phase', async ({ projectId, itemId, systemId, phase }) => {
  navigate(`/project/${projectId}/item/${itemId}/system/${systemId}/domain/system/vcycle/${phase}`);
});

route('/project/:projectId/item/:itemId/system/:systemId', async ({ projectId, itemId, systemId }) => {
  navigate(`/project/${projectId}/item/${itemId}/system/${systemId}/domain/system/vcycle/item_definition`);
});

// ── Project settings route ────────────────────────────────────────────
route('/project/:projectId/settings', async ({ projectId }) => {
  setLoading();
  const project = await getProject(projectId);
  if (!project) { navigate('/projects'); return; }
  await renderProjectSettings(getContent(), { project });
});

// ── Safety dispatcher ─────────────────────────────────────────────────
async function renderSafetyPage(container, ctx, parentType, parentId, analysisType) {
  if (analysisType === 'HARA') {
    await renderHara(container, { ...ctx, parentType, parentId });
  } else if (analysisType === 'FMEA') {
    await renderFmea(container, { ...ctx, parentType, parentId });
  } else if (analysisType === 'PHL_PHA') {
    await renderPHA(container, { ...ctx, parentType, parentId });
  } else if (analysisType === 'FHA') {
    await renderFHA(container, { ...ctx, parentType, parentId });
  } else {
    await renderSafetyGeneric(container, { ...ctx, parentType, parentId, analysisType });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────
function showBootError(msg) {
  document.getElementById('content').innerHTML =
    `<div style="padding:40px;color:red;font-family:monospace;white-space:pre-wrap;font-size:13px">
      <strong>BOOT ERROR:</strong>\n\n${msg}
    </div>`;
}

async function boot() {
  try {
    state.user = await requireAuth();
    if (!state.user) return;
  } catch(e) { showBootError('requireAuth: ' + e.message); return; }

  try { initTopbar(state.user); } catch(e) { showBootError('initTopbar: ' + e.message); return; }
  try { initRouter(); } catch(e) { showBootError('initRouter: ' + e.message); return; }

  document.addEventListener('langchange', () => {
    state.projectCache = {};
    state.itemCache = {};
    state.systemCache = {};
    window.dispatchEvent(new Event('hashchange'));
  });
}

boot();
