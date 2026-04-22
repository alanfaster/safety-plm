/**
 * Async collapsible tree sidebar.
 *
 * Features:
 * - Dark VS Code-style theme
 * - 4 domain groups per item/system; HW/SW/MECH limited to unit_testing
 * - Sub-pages per phase (nav_pages table)
 * - Phase rename (inline) / hide / add sub-page on hover
 * - Domain hide / restore
 * - System rename (inline) / delete / reorder on hover
 * - Always-visible "Add System" button
 * - Resizable sidebar via drag handle
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

export const VCYCLE_PHASES = ALL_PHASES;

export const SAFETY_MENU = {
  automotive: ['HARA', 'FSC', 'TSC', 'FTA', 'DFA', 'FMEA', 'DFMEA'],
  aerospace:  ['PHL_PHA', 'FHA', 'FTA', 'DFA', 'FMEA', 'DFMEA'],
  military:   ['PHL_PHA', 'FHA', 'FTA', 'DFA', 'FMEA', 'DFMEA'],
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

  // Collect all parent IDs to fetch nav data for.
  // Always include the item itself so item-level helpers are correct
  // even when navigating inside a system.
  const allParentIds = [];
  if (systems.length > 0 || systemId) {
    allParentIds.push({ type: 'item', id: itemId });
  }
  if (systemId) {
    allParentIds.push({ type: 'system', id: systemId });
  } else if (systems.length > 0) {
    systems.forEach(s => allParentIds.push({ type: 'system', id: s.id }));
  }
  if (!allParentIds.length) {
    allParentIds.push({ type: parentType, id: parentId });
  }

  // Fetch nav_pages + nav_phase_config for all relevant parents in parallel
  const fetchResults = await Promise.all(
    allParentIds.flatMap(p => [
      sb.from('nav_pages').select('*').eq('parent_type', p.type).eq('parent_id', p.id).order('sort_order'),
      sb.from('nav_phase_config').select('*').eq('parent_type', p.type).eq('parent_id', p.id),
    ])
  );

  // Build per-parentId lookup maps
  const pagesMap  = {};
  const configMap = {};
  allParentIds.forEach((p, i) => {
    pagesMap[p.id]  = fetchResults[i * 2].data     || [];
    configMap[p.id] = fetchResults[i * 2 + 1].data || [];
  });

  // Helpers scoped to a parentId
  function makeHelpers(pid, pType) {
    const cfg   = configMap[pid] || [];
    const pages = pagesMap[pid]  || [];
    return {
      phaseName: (domain, phaseKey) => {
        const custom = cfg.find(c => c.domain === domain && c.phase === phaseKey)?.custom_name;
        if (custom) return custom;
        if (phaseKey === 'item_definition') {
          if (domain === 'sw')   return 'SW Definition';
          if (domain === 'hw')   return 'HW Definition';
          if (domain === 'mech') return 'MECH Definition';
          if (domain === 'system' || pType === 'system') return 'System Definition';
          return 'Item Definition';
        }
        return t(`vcycle.${phaseKey}`);
      },
      phaseHidden:  (domain, phaseKey) => cfg.find(c => c.domain === domain && c.phase === phaseKey)?.is_hidden || false,
      domainHidden: (domain)           => cfg.find(c => c.domain === domain && c.phase === '__domain__')?.is_hidden || false,
      subPages:     (domain, phaseKey) => pages.filter(p => p.domain === domain && p.phase === phaseKey && !p.parent_page_id),
      childPages:   (parentPageId)     => pages.filter(p => p.parent_page_id === parentPageId),
    };
  }

  // Item-level helpers always use itemId so the item section is never
  // overwritten by system-level nav config when navigating inside a system.
  const itemHelpers   = makeHelpers(itemId, 'item');
  const helpers       = systemId ? makeHelpers(systemId, 'system') : itemHelpers;

  // Always show the full tree.
  // Never collapse into a system-only sidebar when navigating into a system.
  if (systems.length > 0) {
    container.innerHTML = buildMultiSystemSidebar({
      projectId, itemId, itemName, activePage, activePageId,
      safetyItems, systems, makeHelpers, ...itemHelpers,
    });
  } else {
    container.innerHTML = buildSingleSystemSidebar({
      projectId, itemId, itemName, activePage, activePageId,
      safetyItems, ...helpers,
    });
  }

  wireCollapse(container);
  wireNav(container);

  const onReloadFn = onReload || (() => window.dispatchEvent(new Event('hashchange')));
  wirePhaseActions(container, parentType, parentId, onReloadFn, configMap[parentId] || []);
  wireSystemActions(container, systems, projectId, itemId, onReloadFn);
  wireDomainActions(container, parentType, parentId, onReloadFn, configMap[parentId] || []);

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

function buildSingleSystemSidebar({ projectId, itemId, itemName, activePage, activePageId, safetyItems, phaseName, phaseHidden, domainHidden, subPages, childPages }) {
  const base = `/project/${projectId}/item/${itemId}`;
  let html = entityHeader(itemName, base, projectId);

  // Hidden domains banner
  const hiddenDomains = DOMAINS.filter(d => domainHidden(d.key));
  if (hiddenDomains.length) {
    html += buildHiddenDomainsBanner(hiddenDomains);
  }

  for (const domain of DOMAINS) {
    if (domainHidden(domain.key)) continue;
    html += buildDomainGroup({
      groupKey: `item-${itemId}-${domain.key}`,
      domain: domain.key, icon: domain.icon,
      phases: domain.phases,
      getPath: (ph) => `${base}/domain/${domain.key}/vcycle/${ph}`,
      activePage, activePageId, activeDomainPrefix: `domain:${domain.key}:`,
      phaseName, phaseHidden, subPages, childPages,
      parentType: 'item', parentId: itemId,
    });
  }

  html += buildSafetyGroup({ groupKey: `item-${itemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });
  html += addSystemBtn();
  return html;
}

function buildMultiSystemSidebar({ projectId, itemId, itemName, activePage, activePageId, safetyItems, systems, phaseName, phaseHidden, domainHidden, subPages, childPages, makeHelpers }) {
  const base = `/project/${projectId}/item/${itemId}`;
  let html = entityHeader(itemName, base, projectId);

  // Item-level dev group
  html += buildDomainGroup({
    groupKey: `item-${itemId}-dev`,
    domain: 'item', icon: '⬡',
    phases: ALL_PHASES,
    getPath: (ph) => `${base}/vcycle/${ph}`,
    activePage, activePageId, activeDomainPrefix: '',
    phaseName, phaseHidden, subPages, childPages,
    parentType: 'item', parentId: itemId,
  });

  html += buildSafetyGroup({ groupKey: `item-${itemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });

  // Systems section
  html += `<div class="sb-section-label" style="margin-top:6px">
    ${escHtml(t('systems.title'))}
    <button class="sb-section-add" id="sidebar-add-system" title="${t('systems.new')}">＋</button>
  </div>`;

  if (!systems.length) {
    html += `<div class="sb-empty-hint">No systems yet</div>`;
  } else {
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      const h = makeHelpers ? makeHelpers(s.id, 'system') : { phaseName, phaseHidden, domainHidden, subPages, childPages };
      html += systemBlock({ s, i, total: systems.length, projectId, itemId, activePage, activePageId, safetyItems, ...h });
    }
  }
  return html;
}

function buildSystemSidebar({ projectId, itemId, systemId, systemName, activePage, activePageId, safetyItems, phaseName, phaseHidden, domainHidden, subPages, childPages }) {
  const base = `/project/${projectId}/item/${itemId}/system/${systemId}`;
  let html = `<button class="sb-back" data-nav="/project/${projectId}/item/${itemId}/vcycle/item_definition">◀ Item</button>`;
  html += entityHeader(systemName, null, null);

  const hiddenDomains = DOMAINS.filter(d => domainHidden(d.key));
  if (hiddenDomains.length) html += buildHiddenDomainsBanner(hiddenDomains);

  for (const domain of DOMAINS) {
    if (domainHidden(domain.key)) continue;
    html += buildDomainGroup({
      groupKey: `sys-${systemId}-${domain.key}`,
      domain: domain.key, icon: domain.icon,
      phases: domain.phases,
      getPath: (ph) => `${base}/domain/${domain.key}/vcycle/${ph}`,
      activePage, activePageId, activeDomainPrefix: `domain:${domain.key}:`,
      phaseName, phaseHidden, subPages, childPages,
    });
  }

  html += buildSafetyGroup({ groupKey: `sys-${systemId}-safety`, safetyItems, activePage, routePrefix: `${base}/safety` });
  return html;
}

function systemBlock({ s, i, total, projectId, itemId, activePage, activePageId, safetyItems, phaseName, phaseHidden, domainHidden, subPages, childPages }) {
  const base     = `/project/${projectId}/item/${itemId}/system/${s.id}`;
  const blockKey = `sys-block-${s.id}`;
  const open     = isOpen(blockKey, true); // default expanded

  let body = '';
  for (const domain of DOMAINS) {
    if (domainHidden(domain.key)) continue;
    body += buildDomainGroup({
      groupKey: `sys-${s.id}-${domain.key}`,
      domain: domain.key, icon: domain.icon,
      phases: domain.phases,
      getPath: (ph) => `${base}/domain/${domain.key}/vcycle/${ph}`,
      activePage, activePageId, activeDomainPrefix: `sys:${s.id}:domain:${domain.key}:`,
      phaseName, phaseHidden, subPages, childPages,
      parentType: 'system', parentId: s.id,
    });
  }
  body += buildSafetyGroup({ groupKey: `sys-${s.id}-safety`, safetyItems, activePage, routePrefix: `${base}/safety`, sysId: s.id });

  return `
    <div class="sb-sys-block ${open ? 'open' : 'closed'}" data-sys-block="${blockKey}">
      <div class="sb-system-title" data-system-id="${s.id}">
        <button class="sb-sys-toggle" data-block="${blockKey}" title="${open ? 'Collapse' : 'Expand'}">
          <span class="sb-chevron">▶</span>
        </button>
        <span class="sb-system-title-name">${escHtml(s.name)}</span>
        <span class="sb-system-title-code">${escHtml(s.system_code)}</span>
        <span class="sb-system-title-actions">
          ${i > 0         ? `<button class="btn-up-sys" data-id="${s.id}" title="Up">▲</button>` : ''}
          ${i < total - 1 ? `<button class="btn-dn-sys" data-id="${s.id}" title="Down">▼</button>` : ''}
          <button class="btn-edit-sys" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Rename">✎</button>
          <button class="btn-del-sys"  data-id="${s.id}" data-name="${escHtml(s.name)}" title="Delete">✕</button>
        </span>
      </div>
      <div class="sb-sys-body">
        ${body}
      </div>
    </div>`;
}

// ── Group builders ────────────────────────────────────────────────────────────

function buildDomainGroup({ groupKey, domain, icon, phases, getPath, activePage, activePageId, activeDomainPrefix, phaseName, phaseHidden, subPages, childPages, parentType, parentId }) {
  const safeChildPages = childPages || (() => []);
  const visiblePhases = phases.filter(p => !phaseHidden(domain, p.key));
  const anyActive = visiblePhases.some(p => {
    const key = `${activeDomainPrefix}${p.key}`;
    const allSubs = subPages(domain, p.key);
    const anySubActive = allSubs.some(sp => sp.id === activePageId ||
      safeChildPages(sp.id).some(c => c.id === activePageId));
    return activePage === key || anySubActive;
  });
  const open = anyActive ? true : isOpen(groupKey, false);
  const domainLabel = domain === 'item' ? t('vcycle.title') : t(`domain.${domain}`);

  function renderSubpageRow(sp, getPath, phaseKey, depth = 1) {
    const isSpAct    = activePageId === sp.id;
    const indent     = depth * 12;
    const kids       = safeChildPages(sp.id).filter(c => !c.is_folder);
    const folderOpen = isOpen(`folder-${sp.id}`, false);
    return `
      <div class="sb-subpage-row" draggable="true"
        data-subpage-id="${sp.id}"
        data-sort-order="${sp.sort_order ?? 0}"
        data-domain="${domain}"
        data-phase="${phaseKey}"
        data-parent-page-id="${sp.parent_page_id || ''}"
        data-parent-type="${parentType}"
        data-parent-id="${parentId}"
        data-is-folder="${sp.is_folder ? '1' : ''}">
        ${sp.is_folder ? `
          <button class="sb-subitem sb-folder-toggle ${folderOpen ? 'folder-open' : ''}" data-folder-id="${sp.id}">
            <span class="sb-item-icon" style="opacity:0.6;padding-left:${indent}px">${folderOpen ? '📂' : '📁'}</span>
            <span class="sb-item-label">${escHtml(sp.name)}</span>
          </button>` : `
          <button class="sb-subitem ${isSpAct ? 'active' : ''}" data-nav="${getPath(phaseKey)}/page/${sp.id}">
            <span class="sb-item-icon" style="opacity:0.4;padding-left:${indent}px">${sp.page_type === 'wiki' ? '📄' : '╰'}</span>
            <span class="sb-item-label">${escHtml(sp.name)}</span>
          </button>`}
        <span class="sb-phase-actions">
          <button class="sb-act-btn btn-up-subpage"   data-id="${sp.id}" title="Move up">▲</button>
          <button class="sb-act-btn btn-dn-subpage"   data-id="${sp.id}" title="Move down">▼</button>
          <button class="sb-act-btn btn-add-child-page" data-parent-page-id="${sp.id}"
            data-domain="${domain}" data-phase="${phaseKey}"
            data-parent-type="${parentType}" data-parent-id="${parentId}"
            data-path="${getPath(phaseKey)}" title="Add sub-page here">＋</button>
          <button class="sb-act-btn btn-rename-subpage" data-id="${sp.id}" data-name="${escHtml(sp.name)}" title="Rename">✎</button>
          <button class="sb-act-btn btn-del-subpage"    data-id="${sp.id}" data-name="${escHtml(sp.name)}" title="Delete">✕</button>
        </span>
      </div>
      ${sp.is_folder && folderOpen ? kids.map(c => renderSubpageRow(c, getPath, phaseKey, depth + 1)).join('') : ''}
      ${!sp.is_folder ? kids.map(c => renderSubpageRow(c, getPath, phaseKey, depth + 1)).join('') : ''}
    `;
  }

  return `
    <div class="sb-group ${open ? 'open' : 'closed'}" data-group="${groupKey}">
      <div class="sb-group-header-row">
        <button class="sb-group-header" title="${escHtml(domainLabel)}">
          <span class="sb-chevron">▶</span>
          <span class="sb-group-icon">${icon}</span>
          ${escHtml(domainLabel)}
        </button>
        ${domain !== 'item' ? `
        <span class="sb-domain-actions">
          <button class="sb-act-btn btn-hide-domain" data-domain="${domain}"
            data-parent-type="${parentType}" data-parent-id="${parentId}"
            title="Hide ${escHtml(domainLabel)}">✕</button>
        </span>` : ''}
      </div>
      <div class="sb-group-body">
        ${visiblePhases.map(p => {
          const phKey = `${activeDomainPrefix}${p.key}`;
          const isAct = activePage === phKey && !activePageId;
          const subs  = subPages(domain, p.key);
          const label = phaseName(domain, p.key);
          return `
            <div class="sb-phase-row" data-domain="${domain}" data-phase="${p.key}" data-path="${getPath(p.key)}"
              data-parent-type="${parentType}" data-parent-id="${parentId}">
              <button class="sb-item ${isAct ? 'active' : ''}" data-nav="${getPath(p.key)}" title="${escHtml(label)}">
                <span class="sb-item-icon">${p.icon}</span>
                <span class="sb-item-label">${escHtml(label)}</span>
              </button>
              <span class="sb-phase-actions">
                <button class="sb-act-btn btn-rename-phase" data-domain="${domain}" data-phase="${p.key}"
                  data-parent-type="${parentType}" data-parent-id="${parentId}" title="Rename">✎</button>
                <button class="sb-act-btn btn-hide-phase"   data-domain="${domain}" data-phase="${p.key}"
                  data-parent-type="${parentType}" data-parent-id="${parentId}" title="Hide">✕</button>
                <button class="sb-act-btn btn-add-subpage sb-add-always"  data-domain="${domain}" data-phase="${p.key}"
                  data-parent-type="${parentType}" data-parent-id="${parentId}" data-path="${getPath(p.key)}" title="Add page">↳</button>
                <button class="sb-act-btn btn-add-folder sb-add-always"  data-domain="${domain}" data-phase="${p.key}"
                  data-parent-type="${parentType}" data-parent-id="${parentId}" data-path="${getPath(p.key)}" title="Add folder">📁</button>
              </span>
            </div>
            ${subs.filter(sp => !sp.parent_page_id).map(sp => renderSubpageRow(sp, getPath, p.key, 1)).join('')}
          `;
        }).join('')}
      </div>
    </div>`;
}

function buildSafetyGroup({ groupKey, safetyItems, activePage, routePrefix, sysId = null }) {
  const pfx = sysId ? `sys:${sysId}:` : '';
  const anyActive = safetyItems.some(k => activePage === `${pfx}${k}`);
  const open = anyActive ? true : isOpen(groupKey, false);
  return `
    <div class="sb-group ${open ? 'open' : 'closed'}" data-group="${groupKey}">
      <div class="sb-group-header-row">
        <button class="sb-group-header">
          <span class="sb-chevron">▶</span>
          <span class="sb-group-icon">△</span>
          ${t('safety.title')}
        </button>
      </div>
      <div class="sb-group-body">
        ${safetyItems.map(key => `
          <div class="sb-phase-row">
            <button class="sb-item ${activePage === `${pfx}${key}` ? 'active' : ''}" data-nav="${routePrefix}/${key}" title="${t(`safety.${key}`)}">
              <span class="sb-item-icon">△</span>
              <span class="sb-item-label">${t(`safety.${key}`)}</span>
            </button>
          </div>`).join('')}
      </div>
    </div>`;
}

function buildHiddenDomainsBanner(hiddenDomains) {
  return `<div class="sb-hidden-domains">
    <span class="sb-hidden-domains-label">Hidden:</span>
    ${hiddenDomains.map(d => `
      <button class="sb-hidden-domain-pill btn-restore-domain" data-domain="${d.key}" title="Restore ${t(`domain.${d.key}`)}">
        ${d.icon} ${t(`domain.${d.key}`)} ＋
      </button>`).join('')}
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

function addSystemBtn() {
  return `<div class="sb-section-label">
    ${t('systems.title')}
    <button class="sb-section-add" id="sidebar-add-system" title="${t('systems.new')}">＋</button>
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

function wirePhaseActions(container, _parentType, _parentId, onReload) {
  // Each button carries data-parent-type / data-parent-id so multi-system sidebars
  // operate on the correct parent instead of a shared closure value.
  function ctx(btn) {
    return {
      pType: btn.dataset.parentType || _parentType,
      pId:   btn.dataset.parentId   || _parentId,
    };
  }

  // Rename phase label — inline
  container.querySelectorAll('.btn-rename-phase').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase } = btn.dataset;
      const { pType, pId } = ctx(btn);
      const row = btn.closest('.sb-phase-row');
      const labelSpan = row.querySelector('.sb-item-label');
      const navBtn    = row.querySelector('.sb-item');
      inlineRenameEl(navBtn, labelSpan, async (newName) => {
        await upsertPhaseConfig(pType, pId, domain, phase, { custom_name: newName });
        onReload();
      });
    };
  });

  // Hide phase
  container.querySelectorAll('.btn-hide-phase').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase } = btn.dataset;
      const { pType, pId } = ctx(btn);
      confirmDialog(`Hide "${t(`vcycle.${phase}`)}" from this sidebar?`, async () => {
        await upsertPhaseConfig(pType, pId, domain, phase, { is_hidden: true });
        onReload();
      });
    };
  });

  // Add sub-page — shows type picker first
  container.querySelectorAll('.btn-add-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase, path } = btn.dataset;
      const { pType, pId } = ctx(btn);
      openPageTypeMenu(btn, (pageType) => {
        const label = pageType === 'wiki' ? 'New wiki page name' : 'New page name';
        openNameModal(label, '', async (name) => {
          const count = (await sb.from('nav_pages').select('id', { count: 'exact', head: true })
            .eq('parent_type', pType).eq('parent_id', pId)
            .eq('domain', domain).eq('phase', phase)).count || 0;

          const { data: pg, error } = await sb.from('nav_pages').insert({
            parent_type: pType, parent_id: pId,
            domain, phase, name, sort_order: count,
            page_type: pageType,
          }).select().single();

          if (error) { toast(t('common.error'), 'error'); return; }
          toast(`Page "${name}" created.`, 'success');
          onReload();
          navigate(`${path}/page/${pg.id}`);
        });
      });
    };
  });

  // Rename sub-page — inline
  container.querySelectorAll('.btn-rename-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const row = btn.closest('.sb-subpage-row');
      const labelSpan = row.querySelector('.sb-item-label');
      const navBtn    = row.querySelector('.sb-subitem');
      inlineRenameEl(navBtn, labelSpan, async (newName) => {
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
      confirmDialog(`Delete page "${btn.dataset.name}"?`, async () => {
        await sb.from('nav_pages').delete().eq('id', btn.dataset.id);
        toast('Page deleted.', 'success');
        onReload();
      });
    };
  });

  // Add child sub-page (+ button on each subpage row) — shows type picker first
  container.querySelectorAll('.btn-add-child-page').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase, path } = btn.dataset;
      const parentPageId = btn.dataset.parentPageId;
      const { pType, pId } = ctx(btn);
      openPageTypeMenu(btn, (pageType) => {
        const label = pageType === 'wiki' ? 'New wiki page name' : 'New sub-page name';
        openNameModal(label, '', async (name) => {
          const count = (await sb.from('nav_pages').select('id', { count: 'exact', head: true })
            .eq('parent_page_id', parentPageId)).count || 0;

          const { data: pg, error } = await sb.from('nav_pages').insert({
            parent_type: pType, parent_id: pId,
            domain, phase, name,
            parent_page_id: parentPageId,
            sort_order: count,
            page_type: pageType,
          }).select().single();

          if (error) { toast(t('common.error'), 'error'); return; }
          toast(`Page "${name}" created.`, 'success');
          onReload();
          navigate(`${path}/page/${pg.id}`);
        });
      });
    };
  });

  // Add folder at phase level
  container.querySelectorAll('.btn-add-folder').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain, phase } = btn.dataset;
      const { pType, pId } = ctx(btn);
      openNameModal('Folder name', '', async (name) => {
        const count = (await sb.from('nav_pages').select('id', { count: 'exact', head: true })
          .eq('parent_type', pType).eq('parent_id', pId)
          .eq('domain', domain).eq('phase', phase)).count || 0;

        const { error } = await sb.from('nav_pages').insert({
          parent_type: pType, parent_id: pId,
          domain, phase, name,
          is_folder: true,
          sort_order: count,
        });

        if (error) { toast(t('common.error'), 'error'); return; }
        toast(`Folder "${name}" created.`, 'success');
        onReload();
      });
    };
  });

  // Folder toggle expand/collapse
  container.querySelectorAll('.sb-folder-toggle').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      const key = `folder-${folderId}`;
      const open = !isOpen(key, false);
      setGroupOpen(key, open);
      onReload();
    };
  });

  // Up / Down arrows on subpage rows
  container.querySelectorAll('.btn-up-subpage, .btn-dn-subpage').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const row = btn.closest('.sb-subpage-row');
      const dir = btn.classList.contains('btn-up-subpage') ? -1 : 1;
      await reorderSubpage(row, dir);
      onReload();
    };
  });

  // Drag-and-drop reorder + move into folder
  wireSubpageDragDrop(container, onReload);
}

// ── Subpage reorder helpers ───────────────────────────────────────────────────

async function reorderSubpage(row, dir) {
  const id           = row.dataset.subpageId;
  const domain       = row.dataset.domain;
  const phase        = row.dataset.phase;
  const parentPageId = row.dataset.parentPageId || null;
  const parentType   = row.dataset.parentType;
  const parentId     = row.dataset.parentId;

  // Fetch all siblings from DB (same parent group, ordered by sort_order)
  let q = sb.from('nav_pages')
    .select('id, sort_order')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .eq('domain', domain)
    .eq('phase', phase)
    .order('sort_order');
  if (parentPageId) q = q.eq('parent_page_id', parentPageId);
  else              q = q.is('parent_page_id', null);

  const { data: siblings } = await q;
  if (!siblings) return;

  const idx     = siblings.findIndex(s => s.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx], b = siblings[swapIdx];
  const aOrd = a.sort_order, bOrd = b.sort_order;

  // If sort_orders are equal, assign distinct values first
  if (aOrd === bOrd) {
    await Promise.all(siblings.map((s, i) =>
      sb.from('nav_pages').update({ sort_order: i }).eq('id', s.id)
    ));
    const newA = idx, newB = swapIdx;
    await sb.from('nav_pages').update({ sort_order: newB }).eq('id', a.id);
    await sb.from('nav_pages').update({ sort_order: newA }).eq('id', b.id);
  } else {
    await sb.from('nav_pages').update({ sort_order: bOrd }).eq('id', a.id);
    await sb.from('nav_pages').update({ sort_order: aOrd }).eq('id', b.id);
  }
}

function wireSubpageDragDrop(container, onReload) {
  let dragId  = null;
  let dragRow = null;

  // ── dragstart / dragend — per source row ────────────────────────────────────
  container.querySelectorAll('.sb-subpage-row[draggable]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragId  = row.dataset.subpageId;
      dragRow = row;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => row.classList.add('sb-dragging'), 0);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('sb-dragging');
      clearDropHighlights();
      dragId = null; dragRow = null;
    });
  });

  function clearDropHighlights() {
    container.querySelectorAll('.sb-drop-target, .sb-drop-folder')
      .forEach(el => el.classList.remove('sb-drop-target', 'sb-drop-folder'));
  }

  function targetRow(e) {
    return e.target.closest('.sb-subpage-row');
  }

  // ── dragover / dragleave / drop — delegated on container ────────────────────
  container.addEventListener('dragover', e => {
    if (!dragId) return;
    const row = targetRow(e);
    if (!row || row.dataset.subpageId === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropHighlights();
    if (row.dataset.isFolder === '1') {
      row.classList.add('sb-drop-folder');
    } else {
      row.classList.add('sb-drop-target');
    }
  });

  container.addEventListener('dragleave', e => {
    const row = targetRow(e);
    if (row) {
      // Only clear if leaving the row entirely (not just moving to a child)
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('sb-drop-target', 'sb-drop-folder');
      }
    }
  });

  container.addEventListener('drop', async e => {
    const row = targetRow(e);
    if (!row) return;
    e.preventDefault();
    clearDropHighlights();
    if (!dragId || !dragRow || dragId === row.dataset.subpageId) return;

    const targetIsFolder     = row.dataset.isFolder === '1';
    const targetId           = row.dataset.subpageId;
    const dragParentPageId   = dragRow.dataset.parentPageId || null;
    const targetParentPageId = row.dataset.parentPageId    || null;

    // Capture before any await (dragend may fire and null these out)
    const capturedDragId  = dragId;
    const capturedDragRow = dragRow;

    if (targetIsFolder) {
      // Move into folder
      const { count } = await sb.from('nav_pages')
        .select('id', { count: 'exact', head: true })
        .eq('parent_page_id', targetId);
      await sb.from('nav_pages')
        .update({ parent_page_id: targetId, sort_order: count || 0 })
        .eq('id', capturedDragId);
      setGroupOpen(`folder-${targetId}`, true);
      toast('Moved into folder.', 'success');

    } else if (capturedDragRow.dataset.domain === row.dataset.domain &&
               capturedDragRow.dataset.phase  === row.dataset.phase  &&
               dragParentPageId               === targetParentPageId) {
      // Same-level swap
      const aOrd = parseInt(capturedDragRow.dataset.sortOrder) || 0;
      const bOrd = parseInt(row.dataset.sortOrder) || 0;
      await sb.from('nav_pages').update({ sort_order: bOrd }).eq('id', capturedDragId);
      await sb.from('nav_pages').update({ sort_order: aOrd }).eq('id', targetId);

    } else {
      // Different level — adopt target's parent
      await sb.from('nav_pages')
        .update({ parent_page_id: targetParentPageId || null, sort_order: parseInt(row.dataset.sortOrder) || 0 })
        .eq('id', capturedDragId);
    }

    onReload();
  });
}

function wireSystemActions(container, systems, projectId, itemId, onReload) {
  // Collapse / expand system block
  container.querySelectorAll('.sb-sys-toggle').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const blockKey = btn.dataset.block;
      const block    = container.querySelector(`[data-sys-block="${blockKey}"]`);
      const open     = block.classList.toggle('open');
      block.classList.toggle('closed', !open);
      setGroupOpen(blockKey, open);
    };
  });

  container.querySelectorAll('.btn-edit-sys').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const titleDiv  = btn.closest('.sb-system-title');
      const nameSpan  = titleDiv.querySelector('.sb-system-title-name');
      inlineRenameEl(null, nameSpan, async (name) => {
        const { error } = await sb.from('systems').update({ name }).eq('id', btn.dataset.id);
        if (error) { toast(t('common.error'), 'error'); nameSpan.textContent = btn.dataset.name; return; }
        toast('Renamed.', 'success');
        btn.dataset.name = name;
        onReload();
      });
    };
  });

  container.querySelectorAll('.btn-del-sys').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation();
      confirmDialog(`Delete system "${btn.dataset.name}"?`, async () => {
        await sb.from('systems').delete().eq('id', btn.dataset.id);
        toast('System deleted.', 'success');
        onReload();
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

function wireDomainActions(container, _parentType, _parentId, onReload) {
  function ctx(btn) {
    return {
      pType: btn.dataset.parentType || _parentType,
      pId:   btn.dataset.parentId   || _parentId,
    };
  }

  // Hide domain
  container.querySelectorAll('.btn-hide-domain').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain } = btn.dataset;
      const { pType, pId } = ctx(btn);
      const label = t(`domain.${domain}`);
      confirmDialog(`Hide "${label}" from this sidebar? You can restore it later.`, async () => {
        await upsertPhaseConfig(pType, pId, domain, '__domain__', { is_hidden: true });
        onReload();
      });
    };
  });

  // Restore hidden domain (pill buttons)
  container.querySelectorAll('.btn-restore-domain').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const { domain } = btn.dataset;
      const { pType, pId } = ctx(btn);
      await upsertPhaseConfig(pType, pId, domain, '__domain__', { is_hidden: false });
      onReload();
    };
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

// ── Inline rename ─────────────────────────────────────────────────────────────

/**
 * Inline rename: hides the navBtn (or just the labelSpan if no navBtn),
 * inserts an input in its place, saves on Enter/blur.
 */
function inlineRenameEl(navBtn, labelSpan, onSave) {
  const currentValue = labelSpan.textContent.trim();

  const input = document.createElement('input');
  input.className = 'sb-inline-input';
  input.value = currentValue;

  if (navBtn) {
    navBtn.style.display = 'none';
    navBtn.parentNode.insertBefore(input, navBtn);
  } else {
    labelSpan.style.display = 'none';
    labelSpan.parentNode.insertBefore(input, labelSpan);
  }

  input.focus();
  input.select();

  let saved = false;

  async function save() {
    if (saved) return;
    saved = true;
    const val = input.value.trim();
    // Restore DOM
    if (navBtn) { navBtn.style.display = ''; } else { labelSpan.style.display = ''; }
    input.remove();
    if (val && val !== currentValue) {
      labelSpan.textContent = val;
      await onSave(val);
    }
  }

  function cancel() {
    if (saved) return;
    saved = true;
    if (navBtn) { navBtn.style.display = ''; } else { labelSpan.style.display = ''; }
    input.remove();
  }

  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };
}

// ── Modal helper (for add sub-page name prompt) ───────────────────────────────

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

/**
 * Show a small dropdown near `anchor` to let the user pick the page type
 * before being asked for a name. Calls `onPick(pageType)` with 'standard' or 'wiki'.
 */
function openPageTypeMenu(anchor, onPick) {
  document.querySelectorAll('.sb-page-type-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'sb-page-type-menu';
  menu.innerHTML = `
    <button class="sb-ptm-btn" data-type="standard">
      <span class="sb-ptm-icon">╰</span>
      <span class="sb-ptm-label">Standard page</span>
      <span class="sb-ptm-desc">Requirements, specs, analysis…</span>
    </button>
    <button class="sb-ptm-btn" data-type="wiki">
      <span class="sb-ptm-icon">📄</span>
      <span class="sb-ptm-label">Wiki page</span>
      <span class="sb-ptm-desc">Free-form notes &amp; documentation</span>
    </button>
  `;
  document.body.appendChild(menu);

  // Position below anchor
  const r = anchor.getBoundingClientRect();
  menu.style.top  = `${r.bottom + window.scrollY + 4}px`;
  menu.style.left = `${r.left  + window.scrollX}px`;

  menu.querySelectorAll('.sb-ptm-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.remove();
      onPick(btn.dataset.type);
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
