/**
 * Async collapsible tree sidebar.
 *
 * Features:
 * - Dark VS Code-style theme (subdued default, bright on hover)
 * - 4 domain groups per item/system; HW/SW/MECH limited to unit_testing
 * - Sub-pages per phase (nav_pages table)
 * - Phase rename / delete / add sub-page on hover
 * - System rename / delete / reorder on hover
 * - Always-visible "Add System" button
 */
import { t } from '../i18n/index.js';
import { navigate } from '../router.js';
import { sb } from '../config.js';
import { showModal, hideModal, confirmDialog } from './modal.js';
import { toast } from '../toast.js';

// ── Phase definitions ─────────────────────────────────────────────────────────

const ALL_PHASES = [
  { key: 'item_definition',     icon: '▤' },
  { key: 'requirements',        icon: '≡' },
  { key: 'architecture',        icon: '◈' },
  { key: 'design',              icon: '◇' },
  { key: 'implementation',      icon: '◫' },
  { key: 'unit_testing',        icon: '◉' },
  { key: 'integration_testing', icon: '⊕' },
  { key: 'system_testing',      icon: '▣' },
  { key: 'validation',          icon: '✓' },
];

// HW/SW/MECH only up to unit_testing
const SUB_PHASES = ALL_PHASES.slice(0, 6);

export const VCYCLE_PHASES = ALL_PHASES; // exported for compatibility

export const SAFETY_MENU = {
  automotive: ['HARA', 'FSC', 'TSC', 'FTA', 'FMEA'],
  aerospace:  ['PHL_PHA', 'FHA', 'FMEA'],
  military:   ['PHL_PHA', 'FHA', 'FTA', 'FMEA'],
};

const DOMAINS = [
  { key: 'system', icon: '⬡', phases: ALL_PHASES },
  { key: 'sw',     icon: '◧', phases: SUB_PHASES },
  { key: 'hw',     icon: '◨', phases: SUB_PHASES },
  { key: 'mech',   icon: '◎', phases: SUB_PHASES },
];

// ── Collapse state ────────────────────────────────────────────────────────────

function getOpenGroups() {
  try { return JSON.parse(sessionStorage.getItem('alm_sb_open') || '{}'); } catch { return {}; }
}
function setGroupOpen(key, open) {
  const s = getOpenGroups();
  s[key] = open;
  sessionStorage.setItem('alm_sb_open', JSON.stringify(s));
}
function isOpen(key, def = false) {
  const s = getOpenGroups(); return key in s ? s[key] : def;
}

// ── Main async render ─────────────────────────────────────────────────────────

export async function renderSidebar(ctx) {
  const container = document.getElementById('sidebar-content');
  const { view, projectId, projectType, itemId, systemId,
          activePage = '', activePageId = null, systems = [],
          onAddSystem, onReload, itemName = '', systemName = '' } = ctx;

  // Simple views
  if (view === 'projects' || !projectId) {
    container.innerHTML = buildProjectsNav(activePage);
    wireNav(container); return;
  }

  const safetyItems = SAFETY_MENU[projectType] || [];
  const parentType  = systemId ? 'system' : 'item';
  const parentId    = systemId || itemId;

  // Fetch sub-pages and phase config for current parent
  const [{ data: navPages }, { data: phaseConfigs }] = await Promise.all([
    sb.from('nav_pages').select('*').eq('parent_type', parentType).eq('parent_id', parentId).order('sort_order'),
    sb.from('nav_phase_config').select('*').eq('parent_type', parentType).eq('parent_id', parentId),
  ]);

  const pages    = navPages    || [];
  const pConfig  = phaseConfigs || [];

  // Helper: get custom name for a phase+domain
  const phaseName = (domain, phaseKey) => {
    const cfg = pConfig.find(c => c.domain === domain && c.phase === phaseKey);
    return cfg?.custom_name || t(`vcycle.${phaseKey}`);
  };
  const phaseHidden = (domain, phaseKey) => {
    const cfg = pConfig.find(c => c.domain === domain && c.phase === phaseKey);
    return cfg?.is_hidden || false;
  };
  // Sub-pages for a given domain+phase
  const subPages = (domain, phaseKey) =>
    pages.filter(p => p.domain === domain && p.phase === phaseKey);

  if (systemId) {
    // System view
    container.innerHTML = buildSystemSidebar({
      projectId, itemId, systemId, systemName, activePage, activePageId,
      safetyItems, phaseName, phaseHidden, subPages,
    });
  } else if (systems.length > 0) {
    // Multi-system item view
    container.innerHTML = buildMultiSystemSidebar({
      projectId, itemId, itemName, activePage, activePageId,
      safetyItems, systems, phaseName, phaseHidden, subPages,
    });
  } else {
    // Single-system: item IS the system
    container.innerHTML = buildSingleSystemSidebar({
      projectId, itemId, itemName, activePage, activePageId,
      safetyItems, phaseName, phaseHidden, subPages,
    });
  }

  wireCollapse(container);
  wireNav(container);
  wirePhaseActions(container, parentType, parentId, onReload || (() => window.dispatchEvent(new Event('hashchange'))));
  wireSystemActions(container, systems, projectId, itemId, onReload || (() => window.dispatchEvent(new Event('hashchange'))));

  // Add system button
  const addBtn = container.querySelector('#sidebar-add-system');
  if (addBtn && typeof onAddSystem === 'function') addBtn.onclick = onAddSystem;
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function buildProjectsNav(activePage) {
  return `<button class="sb-top-item ${activePage === 'projects' ? 'active' : ''}" data-nav="/projects">
    <span style="margin-right:6px">🗂</span>${t('nav.projects')}
  </button>`;
}

function buildSingleSystemSidebar({ projectId, itemId, itemName, activePage, activePageId, safetyItems, phaseName, phaseHidden, subPages }) {
  const base = `/project/${projectId}/item/${itemId}`;
  let html = entityHeader(itemName, base, projectId);

  for (const domain of DOMAINS) {
    html += buildDomainGroup({
      groupKey: `item-${itemId}-${domain.key}`,
      domain: domain.key, icon: domain.icon,
      phases: domain.phases,
      getPath: (ph) => `${base}/domain/${domain.key}/vcycle/${ph}`,
      activePage, activePageId, activeDomainPrefix: `domain:${domain.key}:`,
      phaseName, phaseHidden, subPages,
    });
  }

  html += sectionLabel(t('safety.title'));
  html += buildSafetyGroup({ groupKey: `item-${itemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });
  html += addSystemBtn();
  return html;
}

function buildMultiSystemSidebar({ projectId, itemId, itemName, activePage, activePageId, safetyItems, systems, phaseName, phaseHidden, subPages }) {
  const base = `/project/${projectId}/item/${itemId}`;
  let html = entityHeader(itemName, base, projectId);

  // Item-level dev group
  html += buildDomainGroup({
    groupKey: `item-${itemId}-dev`,
    domain: 'item', icon: '⬡',
    phases: ALL_PHASES,
    getPath: (ph) => `${base}/vcycle/${ph}`,
    activePage, activePageId, activeDomainPrefix: '',
    phaseName, phaseHidden, subPages,
  });

  html += sectionLabel(t('safety.title'));
  html += buildSafetyGroup({ groupKey: `item-${itemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });

  html += sectionLabel(t('systems.title'), true, 'sidebar-add-system');
  for (let i = 0; i < systems.length; i++) {
    html += systemItem(systems[i], i, systems.length, projectId, itemId, activePage);
  }
  if (!systems.length) {
    html += `<div class="sb-empty-hint">No systems yet</div>`;
  }
  return html;
}

function buildSystemSidebar({ projectId, itemId, systemId, systemName, activePage, activePageId, safetyItems, phaseName, phaseHidden, subPages }) {
  const base = `/project/${projectId}/item/${itemId}/system/${systemId}`;
  let html = `<button class="sb-back" data-nav="/project/${projectId}/item/${itemId}/vcycle/item_definition">◀ Item</button>`;
  html += entityHeader(systemName, null, null);

  for (const domain of DOMAINS) {
    html += buildDomainGroup({
      groupKey: `sys-${systemId}-${domain.key}`,
      domain: domain.key, icon: domain.icon,
      phases: domain.phases,
      getPath: (ph) => `${base}/domain/${domain.key}/vcycle/${ph}`,
      activePage, activePageId, activeDomainPrefix: `domain:${domain.key}:`,
      phaseName, phaseHidden, subPages,
    });
  }

  html += sectionLabel(t('safety.title'));
  html += buildSafetyGroup({ groupKey: `sys-${systemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });
  return html;
}

// ── Group builders ────────────────────────────────────────────────────────────

function buildDomainGroup({ groupKey, domain, icon, phases, getPath, activePage, activePageId, activeDomainPrefix, phaseName, phaseHidden, subPages }) {
  const visiblePhases = phases.filter(p => !phaseHidden(domain, p.key));
  const anyActive = visiblePhases.some(p => {
    const key = `${activeDomainPrefix}${p.key}`;
    return activePage === key || subPages(domain, p.key).some(sp => sp.id === activePageId);
  });
  const open = anyActive ? true : isOpen(groupKey, false);
  const domainLabel = domain === 'item' ? t('vcycle.title') : t(`domain.${domain}`);

  return `
    <div class="sb-group ${open ? 'open' : 'closed'}" data-group="${groupKey}">
      <button class="sb-group-header">
        <span class="sb-chevron">▶</span>
        <span class="sb-group-icon">${icon}</span>
        ${escHtml(domainLabel)}
      </button>
      <div class="sb-group-body">
        ${visiblePhases.map(p => {
          const phKey = `${activeDomainPrefix}${p.key}`;
          const isAct = activePage === phKey && !activePageId;
          const subs  = subPages(domain, p.key);
          const label = phaseName(domain, p.key);
          return `
            <div class="sb-phase-row" data-domain="${domain}" data-phase="${p.key}" data-path="${getPath(p.key)}">
              <button class="sb-item ${isAct ? 'active' : ''}" data-nav="${getPath(p.key)}">
                <span class="sb-item-icon">${p.icon}</span>
                <span class="sb-item-label">${escHtml(label)}</span>
              </button>
              <span class="sb-phase-actions">
                <button class="sb-act-btn btn-rename-phase" data-domain="${domain}" data-phase="${p.key}" title="Rename">✎</button>
                <button class="sb-act-btn btn-hide-phase"   data-domain="${domain}" data-phase="${p.key}" title="Delete">✕</button>
                <button class="sb-act-btn btn-add-subpage"  data-domain="${domain}" data-phase="${p.key}" data-path="${getPath(p.key)}" title="Add sub-page">⊕</button>
              </span>
            </div>
            ${subs.map(sp => {
              const isSpAct = activePageId === sp.id;
              return `
                <div class="sb-subpage-row" data-subpage-id="${sp.id}">
                  <button class="sb-subitem ${isSpAct ? 'active' : ''}" data-nav="${getPath(p.key)}/page/${sp.id}">
                    <span class="sb-item-icon" style="opacity:0.4">╰</span>
                    <span class="sb-item-label">${escHtml(sp.name)}</span>
                  </button>
                  <span class="sb-phase-actions">
                    <button class="sb-act-btn btn-rename-subpage" data-id="${sp.id}" data-name="${escHtml(sp.name)}" title="Rename">✎</button>
                    <button class="sb-act-btn btn-del-subpage"    data-id="${sp.id}" data-name="${escHtml(sp.name)}" title="Delete">✕</button>
                  </span>
                </div>`;
            }).join('')}
          `;
        }).join('')}
      </div>
    </div>`;
}

function buildSafetyGroup({ groupKey, safetyItems, activePage, routePrefix }) {
  const anyActive = safetyItems.some(k => activePage === k);
  const open = anyActive ? true : isOpen(groupKey, false);
  return `
    <div class="sb-group ${open ? 'open' : 'closed'}" data-group="${groupKey}">
      <button class="sb-group-header">
        <span class="sb-chevron">▶</span>
        <span class="sb-group-icon">△</span>
        ${t('safety.title')}
      </button>
      <div class="sb-group-body">
        ${safetyItems.map(key => `
          <div class="sb-phase-row">
            <button class="sb-item ${activePage === key ? 'active' : ''}" data-nav="${routePrefix}/${key}">
              <span class="sb-item-icon">△</span>
              <span class="sb-item-label">${t(`safety.${key}`)}</span>
            </button>
          </div>`).join('')}
      </div>
    </div>`;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function entityHeader(name, navPath, projectId) {
  if (!name) return '';
  const backBtn = projectId
    ? `<button class="sb-back" data-nav="/projects">◀ ${t('nav.projects')}</button>`
    : '';
  return `${backBtn}<div class="sb-entity-header"><span class="sb-entity-icon">⬡</span><span class="sb-entity-name">${escHtml(name)}</span></div>`;
}

function sectionLabel(label, withAdd = false, addId = '') {
  return `<div class="sb-section-label">
    ${escHtml(label)}
    ${withAdd ? `<button class="sb-section-add" id="${addId}" title="Add">＋</button>` : ''}
  </div>`;
}

function addSystemBtn() {
  return `<div class="sb-section-label">
    ${t('systems.title')}
    <button class="sb-section-add" id="sidebar-add-system" title="${t('systems.new')}">＋</button>
  </div>`;
}

function systemItem(s, i, total, projectId, itemId, activePage) {
  return `
    <div class="sb-system-item ${activePage === s.id ? 'active' : ''}"
         data-nav="/project/${projectId}/item/${itemId}/system/${s.id}/domain/system/vcycle/item_definition">
      <span class="sb-system-dot">⬡</span>
      <span class="sb-system-name" title="${escHtml(s.name)}">${escHtml(s.name)}</span>
      <span class="sb-system-code">${s.system_code}</span>
      <span class="sb-system-actions">
        ${i > 0         ? `<button class="btn-up-sys" data-id="${s.id}" title="Up">▲</button>` : ''}
        ${i < total - 1 ? `<button class="btn-dn-sys" data-id="${s.id}" title="Down">▼</button>` : ''}
        <button class="btn-edit-sys" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Rename">✎</button>
        <button class="btn-del-sys"  data-id="${s.id}" data-name="${escHtml(s.name)}" title="Delete">✕</button>
      </span>
    </div>`;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireCollapse(container) {
  container.querySelectorAll('.sb-group-header').forEach(header => {
    header.onclick = (e) => {
      e.stopPropagation();
      const group = header.closest('.sb-group');
      const key   = group.dataset.group;
      const open  = group.classList.toggle('open');
      group.classList.toggle('closed', !open);
      setGroupOpen(key, open);
    };
  });
}

function wireNav(container) {
  container.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); navigate(el.dataset.nav); });
  });
}

function wirePhaseActions(container, parentType, parentId, onReload) {
  // Rename phase label
  container.querySelectorAll('.btn-rename-phase').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase } = btn.dataset;
      const current = btn.closest('.sb-phase-row').querySelector('.sb-item-label').textContent.trim();
      openNameModal('Rename phase', current, async (newName) => {
        await upsertPhaseConfig(parentType, parentId, domain, phase, { custom_name: newName });
        onReload();
      });
    };
  });

  // Hide/delete phase
  container.querySelectorAll('.btn-hide-phase').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase } = btn.dataset;
      confirmDialog(`Hide "${t(`vcycle.${phase}`)}" from this sidebar?`, async () => {
        await upsertPhaseConfig(parentType, parentId, domain, phase, { is_hidden: true });
        onReload();
      });
    };
  });

  // Add sub-page
  container.querySelectorAll('.btn-add-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase, path } = btn.dataset;
      openNameModal('New sub-page name', '', async (name) => {
        const count = (await sb.from('nav_pages').select('id', { count: 'exact', head: true })
          .eq('parent_type', parentType).eq('parent_id', parentId)
          .eq('domain', domain).eq('phase', phase)).count || 0;

        const { data: pg, error } = await sb.from('nav_pages').insert({
          parent_type: parentType, parent_id: parentId,
          domain, phase, name, sort_order: count,
        }).select().single();

        if (error) { toast(t('common.error'), 'error'); return; }
        toast(`Sub-page "${name}" created.`, 'success');
        onReload();
        // Navigate to new sub-page
        navigate(`${path}/page/${pg.id}`);
      });
    };
  });

  // Rename sub-page
  container.querySelectorAll('.btn-rename-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      openNameModal('Rename sub-page', btn.dataset.name, async (newName) => {
        const { error } = await sb.from('nav_pages').update({ name: newName }).eq('id', btn.dataset.id);
        if (error) { toast(t('common.error'), 'error'); return; }
        toast('Renamed.', 'success');
        onReload();
      });
    };
  });

  // Delete sub-page
  container.querySelectorAll('.btn-del-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      confirmDialog(`Delete sub-page "${btn.dataset.name}"?`, async () => {
        await sb.from('nav_pages').delete().eq('id', btn.dataset.id);
        toast('Sub-page deleted.', 'success');
        onReload();
      });
    };
  });
}

function wireSystemActions(container, systems, projectId, itemId, onReload) {
  container.querySelectorAll('.btn-edit-sys').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openNameModal('Rename system', btn.dataset.name, async (name) => {
      const { error } = await sb.from('systems').update({ name }).eq('id', btn.dataset.id);
      if (error) { toast(t('common.error'), 'error'); return; }
      toast('Renamed.', 'success'); onReload();
    }); };
  });

  container.querySelectorAll('.btn-del-sys').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation();
      confirmDialog(`Delete system "${btn.dataset.name}"?`, async () => {
        await sb.from('systems').delete().eq('id', btn.dataset.id);
        toast('System deleted.', 'success');
        navigate(`/project/${projectId}/item/${itemId}/domain/system/vcycle/item_definition`);
      });
    };
  });

  container.querySelectorAll('.btn-up-sys').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); reorderSystem(btn.dataset.id, systems, -1, onReload); };
  });
  container.querySelectorAll('.btn-dn-sys').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); reorderSystem(btn.dataset.id, systems, +1, onReload); };
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertPhaseConfig(parentType, parentId, domain, phase, patch) {
  const { data: existing } = await sb.from('nav_phase_config').select('id')
    .eq('parent_type', parentType).eq('parent_id', parentId)
    .eq('domain', domain).eq('phase', phase).maybeSingle();

  if (existing) {
    await sb.from('nav_phase_config').update(patch).eq('id', existing.id);
  } else {
    await sb.from('nav_phase_config').insert({ parent_type: parentType, parent_id: parentId, domain, phase, ...patch });
  }
}

async function reorderSystem(id, systems, dir, onReload) {
  const idx = systems.findIndex(s => s.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= systems.length) return;
  const a = systems[idx], b = systems[swapIdx];
  await sb.from('systems').update({ created_at: b.created_at }).eq('id', a.id);
  await sb.from('systems').update({ created_at: a.created_at }).eq('id', b.id);
  onReload();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function openNameModal(title, current, onSave) {
  showModal({
    title,
    body: `<div class="form-group">
      <label class="form-label">Name *</label>
      <input class="form-input" id="name-input" value="${escHtml(current)}" autocomplete="off"/>
    </div>`,
    footer: `
      <button class="btn btn-secondary" id="m-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="m-save">${t('common.save')}</button>
    `,
  });
  const input = document.getElementById('name-input');
  input.select();
  document.getElementById('m-cancel').onclick = hideModal;
  document.getElementById('m-save').onclick = async () => {
    const val = input.value.trim();
    if (!val) { input.focus(); return; }
    const btn = document.getElementById('m-save');
    btn.disabled = true;
    await onSave(val);
    btn.disabled = false;
    hideModal();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('m-save').click(); };
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
