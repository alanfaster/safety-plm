/**
 * Traceability Dashboard — structured V-model layout
 *
 * Top section: item/system-level nodes only.
 * Per-system cards: one per system, domain tabs (SW/HW/MECH), per-domain V-model SVG.
 */

import { sb } from '../config.js';
import { VMODEL_NODES, PHASE_DB_SOURCE } from '../components/vmodel-editor.js';
import { wireBottomPanel } from '../utils/bottom-panel.js';
import { toast } from '../toast.js';

const NODE_W = 148;
const NODE_H = 34;

// Domain visibility per system — populated by loadDashboard, consumed by getParents.
// Shape: { [systemId]: Set<domain> } — only contains domains that are hidden.
let _hiddenDomains   = {};
let _refreshDiagrams = null;   // set in loadDashboard, used by browse unlink

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderTraceabilityDashboard(container, { project, item }) {
  container.innerHTML = `
    <div class="tdb-page">
      <div class="page-header">
        <div class="page-header-top">
          <div>
            <h1>Traceability Dashboard</h1>
            <p class="text-muted">${esc(item?.name)} · V-Model coverage</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-ghost btn-sm" id="tdb-export-pdf-top" title="Generate traceability report" style="display:none;gap:5px;align-items:center">
              <span style="font-size:13px">📄</span> Generate Report
            </button>
            <button class="btn btn-secondary btn-sm" id="tdb-refresh">↺ Refresh</button>
          </div>
        </div>
      </div>
      <div class="page-body tdb-scroll-body" id="tdb-body">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>

      <!-- Bottom panel -->
      <div class="bp-bar bp-collapsed" id="tdb-bp">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <div class="tdb-bp-tabs">
            <button class="tdb-bp-tab tdb-bp-tab--active" data-tab="coverage">📊 Coverage</button>
            <button class="tdb-bp-tab" data-tab="missing">⚠ Missing &amp; Justify</button>
            <button class="tdb-bp-tab" data-tab="browse">🔍 Check individual traceability</button>
          </div>
          <span class="bp-title" id="tdb-bp-title" style="display:none"></span>
          <button class="btn btn-ghost btn-xs" id="tdb-bp-close" style="margin-left:auto">✕</button>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body" id="tdb-bp-body">
          <!-- Tab: Coverage -->
          <div id="tdb-tab-coverage" style="overflow:auto;padding:4px 0">
            <div class="tdb-panel-empty"><p>Select a diagram tab or domain to view coverage.</p></div>
          </div>
          <!-- Tab: Missing & Justify -->
          <div id="tdb-tab-missing" class="tdb-bp-cols" style="display:none">
            <div class="tdb-bp-left"  id="tdb-bp-left"></div>
            <div class="tdb-bp-right" id="tdb-bp-right"></div>
          </div>
          <!-- Tab: Browse Links -->
          <div id="tdb-tab-browse" class="tdb-bp-cols" style="display:none;">
            <div class="tdb-bp-left"  id="tdb-browse-left"></div>
            <div class="tdb-bp-right tdb-browse-right" id="tdb-browse-right">
              <div class="tdb-panel-empty"><p>Select an item on the left to view its V-model trace.</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const { data: systems } = await sb.from('systems').select('*').eq('item_id', item.id);

  document.getElementById('tdb-refresh')?.addEventListener('click', () =>
    renderTraceabilityDashboard(container, { project, item })
  );
  document.getElementById('tdb-bp-close')?.addEventListener('click', () =>
    document.getElementById('tdb-bp')?._bp?.collapse()
  );

  const bpEl = document.getElementById('tdb-bp');
  wireBottomPanel(bpEl, { key: 'tdb_bp_h', defaultH: 300 });

  const exportArgs = await loadDashboard(project, item, systems || []);

  const topBtn = document.getElementById('tdb-export-pdf-top');
  if (topBtn && exportArgs) {
    topBtn.style.display = 'flex';
    topBtn.addEventListener('click', () => {
      const { allLinkStats, badgeOffsets, topLinks, allActiveIds, topPosMap, nodeMap } = exportArgs;
      exportTraceabilityPDF(project, item, systems || [], allLinkStats, badgeOffsets, topLinks, allActiveIds, topPosMap, nodeMap);
    });
  }
}

// ── Main loader ───────────────────────────────────────────────────────────────

async function loadDashboard(project, item, systems) {
  const body = document.getElementById('tdb-body');
  if (!body) return;

  // 1. Load which domains are hidden per system
  _hiddenDomains = {};
  if (systems.length) {
    const sysIds = systems.map(s => s.id);
    const { data: domainCfg } = await sb.from('nav_phase_config')
      .select('parent_id, domain')
      .in('parent_id', sysIds)
      .eq('parent_type', 'system')
      .eq('phase', '__domain__')
      .eq('is_hidden', true);
    for (const row of (domainCfg || [])) {
      if (!_hiddenDomains[row.parent_id]) _hiddenDomains[row.parent_id] = new Set();
      _hiddenDomains[row.parent_id].add(row.domain);
    }
  }

  // 2. Load project_config
  const { data: pcRow } = await sb.from('project_config')
    .select('config').eq('project_id', project.id).maybeSingle();
  const config      = pcRow?.config || {};
  const vmodelLinks = config.vmodel_links        || [];
  const canvasNodes = config.vmodel_canvas_nodes || [];
  const allTraceLinks = vmodelLinks.filter(l => !l.type || l.type === 'trace');

  if (!allTraceLinks.length) {
    body.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:8px">⛓</div>
      <h3>No V-Model trace links configured</h3>
      <p class="text-muted">Go to <strong>Project Settings → V-Model</strong> to define traceability connections.</p>
    </div></div>`;
    return;
  }

  const nodeMap = Object.fromEntries(VMODEL_NODES.map(n => [n.id, n]));

  // 3. Classify links
  const TOP_DOMAINS    = new Set(['customer', 'safety', 'item', 'system']);
  const SUB_DOMAINS_LIST = ['sw', 'hw', 'mech'];
  const CROSS_DOMAINS  = new Set([...TOP_DOMAINS]); // system/item nodes that cross into domain diagrams

  // Expand domain_panel placeholder links → per-domain req node links (deduped)
  const _seenLinks = new Set();
  const allExpandedLinks = [];
  for (const link of allTraceLinks) {
    const hasDomainPanel = link.from === 'domain_panel' || link.to === 'domain_panel';
    if (hasDomainPanel) {
      for (const d of SUB_DOMAINS_LIST) {
        const expanded = link.to === 'domain_panel'
          ? { ...link, to: `${d}_req` }
          : { ...link, from: `${d}_req` };
        const key = `${expanded.from}__${expanded.to}`;
        if (!_seenLinks.has(key)) { _seenLinks.add(key); allExpandedLinks.push(expanded); }
      }
    } else {
      const key = `${link.from}__${link.to}`;
      if (!_seenLinks.has(key)) { _seenLinks.add(key); allExpandedLinks.push(link); }
    }
  }

  // topLinks: item/system/safety/customer only (pure top-level)
  const topLinks = allExpandedLinks.filter(l => {
    const fn = nodeMap[l.from], tn = nodeMap[l.to];
    if (!fn || !tn) return false;
    return TOP_DOMAINS.has(fn.domain) && TOP_DOMAINS.has(tn.domain);
  });

  // crossLinks: sys_req/sys_arch → {d}_req — shown in the per-system diagram
  const crossLinks = allExpandedLinks.filter(l => {
    const fn = nodeMap[l.from], tn = nodeMap[l.to];
    if (!fn || !tn) return false;
    const fd = fn.domain, td = tn.domain;
    return (fd === 'system' && SUB_DOMAINS_LIST.includes(td)) ||
           (td === 'system' && SUB_DOMAINS_LIST.includes(fd));
  });

  // domainLinks: pure per-domain links only (no cross-level — kept clean)
  const domainLinks = {};
  for (const d of SUB_DOMAINS_LIST) {
    domainLinks[d] = allExpandedLinks.filter(l => {
      const fn = nodeMap[l.from], tn = nodeMap[l.to];
      if (!fn || !tn) return false;
      return fn.domain === d && tn.domain === d;
    });
  }

  // 4. Canvas positions
  const topPos = Object.fromEntries(
    canvasNodes.filter(cn => !cn.panelDomain).map(cn => [cn.nodeId, { x: cn.x, y: cn.y }])
  );
  const domainPos = Object.fromEntries(
    canvasNodes.filter(cn => cn.panelDomain).map(cn => [cn.nodeId, { x: cn.x, y: cn.y }])
  );

  const DOMAIN_DEFAULT_POS = {
    sw_req:{x:10,y:8},   sw_arch:{x:75,y:78},   sw_design:{x:140,y:148},
    sw_impl:{x:225,y:218}, sw_ut:{x:365,y:148},  sw_it:{x:440,y:78},  sw_qt:{x:505,y:8},
    hw_req:{x:10,y:8},   hw_arch:{x:80,y:78},   hw_design:{x:150,y:148},
    hw_ut:{x:360,y:148}, hw_it:{x:430,y:78},    hw_qt:{x:505,y:8},
    mech_req:{x:10,y:8}, mech_arch:{x:80,y:78}, mech_design:{x:150,y:148},
    mech_ut:{x:360,y:148}, mech_it:{x:430,y:78}, mech_qt:{x:505,y:8},
  };

  const ASPICE_TOP_POS = {
    customer_req:{x:20,y:20}, fsr:{x:90,y:95}, tsr:{x:160,y:170},
    item_req:{x:90,y:95},  item_arch:{x:160,y:170},
    item_it:{x:1050,y:170}, item_qt:{x:1120,y:95},
    sys_req:{x:230,y:245}, sys_arch:{x:300,y:320},
    sys_it:{x:840,y:320},  sys_qt:{x:910,y:245},
    // Domain req nodes shown in system diagram (below sys_arch)
    sw_req:  {x:130,y:430}, hw_req:{x:300,y:430}, mech_req:{x:470,y:430},
  };

  // Build top posMap (topLinks only — for the shared overview diagram)
  const topActiveIds = new Set(topLinks.flatMap(l => [l.from, l.to]));
  const topPosMap = {};
  for (const id of topActiveIds) {
    topPosMap[id] = topPos[id] || ASPICE_TOP_POS[id] || { x: 0, y: 0 };
  }

  // Build per-system posMap: topLinks + crossLinks (includes domain req nodes)
  const sysViewLinks = [...topLinks, ...crossLinks];

  // Auto-inject cross-level links if project has sys nodes but no explicit cross-level links
  // (backward-compat for projects set up before v0.3.99)
  if (crossLinks.length === 0 && topActiveIds.has('sys_req')) {
    for (const d of SUB_DOMAINS_LIST) {
      const domainReqId = `${d}_req`;
      // Only inject if this domain has nodes configured
      const domainHasNodes = allExpandedLinks.some(l => l.from === domainReqId || l.to === domainReqId);
      if (domainHasNodes) {
        for (const sysNodeId of ['sys_req', 'sys_arch']) {
          if (topActiveIds.has(sysNodeId)) {
            sysViewLinks.push({ from: sysNodeId, to: domainReqId, type: 'trace', _auto: true });
          }
        }
      }
    }
  }

  const sysViewActiveIds = new Set(sysViewLinks.flatMap(l => [l.from, l.to]));
  const sysViewPosMap = {};
  for (const id of sysViewActiveIds) {
    sysViewPosMap[id] = topPos[id] || ASPICE_TOP_POS[id] || { x: 0, y: 0 };
  }

  // Collect ALL active node IDs for cache refresh
  const allActiveIds = new Set(sysViewActiveIds);
  for (const d of SUB_DOMAINS_LIST) {
    for (const l of domainLinks[d]) {
      allActiveIds.add(l.from);
      allActiveIds.add(l.to);
    }
  }

  // Build per-domain posMap
  const dPosMap = {};
  for (const d of SUB_DOMAINS_LIST) {
    const ids = new Set(domainLinks[d].flatMap(l => [l.from, l.to]));
    dPosMap[d] = {};
    for (const id of ids) {
      dPosMap[d][id] = domainPos[id] || DOMAIN_DEFAULT_POS[id] || { x: 0, y: 0 };
    }
  }

  // 5. Fetch all items
  const itemCache = {};
  await refreshCache(allActiveIds, nodeMap, item, systems, itemCache);

  // Badge drag offsets — one set per context
  const badgeOffsets     = {};                                  // overview tab
  const sysTopBadgeOff   = {};                                  // per-system top diagram
  const sysDomBadgeOff   = {};                                  // per-system per-domain
  for (const sys of systems) {
    sysTopBadgeOff[sys.id] = {};
    sysDomBadgeOff[sys.id] = { sw: {}, hw: {}, mech: {} };
  }

  // 6. Compute top-level link stats (all systems — for Overview tab)
  const topLinkStats = topLinks.map(link => {
    const fromNode = nodeMap[link.from], toNode = nodeMap[link.to];
    if (!fromNode || !toNode) return null;
    return {
      link, fromNode, toNode,
      forward:  computeLinkCov(link.from, link.to,   fromNode, item, systems, itemCache),
      backward: computeLinkCov(link.to,   link.from, toNode,   item, systems, itemCache),
    };
  }).filter(Boolean);

  // 7. Compute per-system per-domain link stats
  const domainStats = {};
  for (const sys of systems) {
    domainStats[sys.id] = {};
    for (const d of SUB_DOMAINS_LIST) {
      // Always compute — even hidden domains show 0/0
      domainStats[sys.id][d] = domainLinks[d].map(link => {
        const fromNode = nodeMap[link.from], toNode = nodeMap[link.to];
        if (!fromNode || !toNode) return null;
        // Hidden domains → force empty (0/0) without querying cache
        if (_hiddenDomains[sys.id]?.has(d)) {
          const empty = { total:0, linked:0, missing:0, missingItems:[], justifiedItems:[], linkedItems:[] };
          return { link, fromNode, toNode, forward: empty, backward: empty };
        }
        return {
          link, fromNode, toNode,
          forward:  computeLinkCovForSystem(link.from, link.to,   fromNode, sys, itemCache),
          backward: computeLinkCovForSystem(link.to,   link.from, toNode,   sys, itemCache),
        };
      }).filter(Boolean);
    }
  }

  // 7b. Per-system diagram stats (topLinks + crossLinks, scoped to one system)
  const sysTopLinkStats = {};
  for (const sys of systems) {
    sysTopLinkStats[sys.id] = sysViewLinks.map(link => {
      const fromNode = nodeMap[link.from], toNode = nodeMap[link.to];
      if (!fromNode || !toNode) return null;
      return {
        link, fromNode, toNode,
        forward:  computeTopLinkCovForSystem(link.from, link.to,   fromNode, sys, item, itemCache),
        backward: computeTopLinkCovForSystem(link.to,   link.from, toNode,   sys, item, itemCache),
      };
    }).filter(Boolean);
  }

  // 8. Overall KPI
  const allLinkStats = [
    ...topLinkStats,
    ...Object.values(domainStats).flatMap(ds => Object.values(ds).flat()),
  ];
  let kpiTotal = 0, kpiLinked = 0, kpiMissing = 0, kpiJustified = 0;
  for (const ls of allLinkStats) {
    for (const cov of [ls.forward, ls.backward]) {
      kpiTotal     += cov.total;
      kpiLinked    += cov.linked;
      kpiMissing   += cov.missing;
      kpiJustified += cov.justifiedItems.length;
    }
  }
  const kpiPct   = kpiTotal ? Math.round(kpiLinked / kpiTotal * 100) : 0;
  const kpiColor = kpiPct === 100 ? '#1e7e34' : kpiPct >= 70 ? '#b45309' : '#c62828';

  // ── Build Overview SVG ────────────────────────────────────────────────────
  const topLsMap = {};
  for (const ls of topLinkStats) topLsMap[`${ls.link.from}__${ls.link.to}`] = ls;
  const topSvgHtml   = buildVmodelSVG(topLinks, topActiveIds, topPosMap, nodeMap, topLsMap, badgeOffsets);
  // ── Coverage panel helper ─────────────────────────────────────────────────
  function showCoverageTable(stats, label) {
    const el = document.getElementById('tdb-tab-coverage');
    if (!el) return;
    if (!stats || !stats.length) {
      el.innerHTML = `<div class="tdb-panel-empty"><p>No trace links in this diagram.</p></div>`;
    } else {
      el.innerHTML = `
        <div class="tdb-cov-label">${esc(label)}</div>
        <div class="table-wrap"><table class="data-table tdb-link-table">
          <thead><tr>
            <th>From</th><th></th><th>To</th>
            <th style="text-align:center;width:64px">Total</th>
            <th style="text-align:center;width:64px">Linked</th>
            <th style="text-align:center;width:72px">Missing</th>
            <th style="text-align:center;width:88px">Coverage</th>
            <th style="width:140px"></th>
          </tr></thead>
          <tbody>${buildLinkTableRows(stats, 'cov')}</tbody>
        </table></div>`;
      wireTableMissing(el, stats, 'cov');
    }
    // Switch bottom panel to coverage tab
    switchBpTab('coverage', allLinkStats, item, systems, itemCache, nodeMap, allTraceLinks, project);
    document.getElementById('tdb-bp')?._bp?.expand();
  }

  // ── Build per-system tab HTML ─────────────────────────────────────────────
  const DOMAIN_ICONS  = { sw: '◧', hw: '◨', mech: '◎' };
  const DOMAIN_LABELS = { sw: 'SW', hw: 'HW', mech: 'MECH' };

  const sysPanelsHtml = systems.map(sys => {
    // System-level top diagram for this system only
    const stls  = sysTopLinkStats[sys.id] || [];
    const stMap = {};
    for (const ls of stls) stMap[`${ls.link.from}__${ls.link.to}`] = ls;
    const stSvg = buildVmodelSVG(sysViewLinks, sysViewActiveIds, sysViewPosMap, nodeMap, stMap, sysTopBadgeOff[sys.id]);

    // 3 domain columns — always all 3
    const domColsHtml = SUB_DOMAINS_LIST.map(d => {
      const hidden = !!_hiddenDomains[sys.id]?.has(d);
      const dls    = domainStats[sys.id]?.[d] || [];
      const dIds   = new Set(domainLinks[d].flatMap(l => [l.from, l.to]));
      const dlsMap = {};
      for (const ls of dls) dlsMap[`${ls.link.from}__${ls.link.to}`] = ls;
      const svgHtml = dIds.size
        ? buildVmodelSVG(domainLinks[d], dIds, dPosMap[d], nodeMap, dlsMap, sysDomBadgeOff[sys.id][d])
        : '<svg viewBox="0 0 200 60" width="100%" height="200"><text x="10" y="30" font-size="12" fill="#bbb">No links configured</text></svg>';
      return `
        <div class="tdb-dom-col" id="tdb-domcol-${esc(sys.id)}-${d}">
          <div class="tdb-dom-col-hdr tdb-dom-col-hdr--${d}" style="cursor:pointer"
               data-sys="${esc(sys.id)}" data-domain="${d}">
            ${DOMAIN_ICONS[d]} ${DOMAIN_LABELS[d]}${hidden ? ' <span style="font-size:10px;opacity:0.6">(not active)</span>' : ''}
          </div>
          <div class="tdb-vmodel-wrap tdb-dom-vmodel-wrap" id="tdb-dsvg-${esc(sys.id)}-${d}">${svgHtml}</div>
        </div>`;
    }).join('');

    return `
      <div class="tdb-main-panel" id="tdb-panel-${esc(sys.id)}" style="display:none">
        <!-- System-level sub-diagram (item req → sys arch, this system only) -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-header" style="cursor:pointer" id="tdb-systop-hdr-${esc(sys.id)}">
            <h3 style="font-size:14px">${esc(sys.system_code || sys.code || '')} · ${esc(sys.name || '')}
              <span style="font-size:11px;font-weight:400;color:var(--color-text-muted)">— item &amp; system level · click to view coverage</span></h3>
          </div>
          <div class="tdb-vmodel-wrap" id="tdb-syssvg-${esc(sys.id)}">${stSvg}</div>
        </div>
        <!-- 3 domain diagrams side by side -->
        <div class="tdb-dom-row">${domColsHtml}</div>
      </div>`;
  }).join('');

  // 9. Render body HTML
  const tabsHtml = [
    `<button class="tdb-main-tab active" data-panel="tdb-panel-overview">🌐 Overview</button>`,
    ...systems.map(sys =>
      `<button class="tdb-main-tab" data-panel="tdb-panel-${esc(sys.id)}">${esc(sys.system_code || sys.name || 'System')}</button>`
    ),
  ].join('');

  body.innerHTML = `
    <div class="tdb-kpi-bar">
      <div class="tdb-kpi"><div class="tdb-kpi-value" style="color:${kpiColor}">${kpiPct}%</div><div class="tdb-kpi-label">Overall Coverage</div></div>
      <div class="tdb-kpi"><div class="tdb-kpi-value" style="color:var(--color-primary)">${allLinkStats.length}</div><div class="tdb-kpi-label">Trace Links</div></div>
      <div class="tdb-kpi"><div class="tdb-kpi-value" style="color:#1e7e34">${kpiLinked}</div><div class="tdb-kpi-label">Items Linked</div></div>
      <div class="tdb-kpi"><div class="tdb-kpi-value" style="color:#c62828">${kpiMissing}</div><div class="tdb-kpi-label">Missing</div></div>
      <div class="tdb-kpi"><div class="tdb-kpi-value" style="color:#b45309">${kpiJustified}</div><div class="tdb-kpi-label">Justified</div></div>
    </div>

    <div class="tdb-main-tabs">${tabsHtml}</div>

    <!-- Overview panel -->
    <div class="tdb-main-panel active" id="tdb-panel-overview">
      <div class="card tdb-vmodel-card" id="tdb-top-card">
        <div class="card-header">
          <h3>System &amp; Item Level <span style="font-size:11px;color:var(--color-text-muted);font-weight:400">· all systems · click badge to review</span></h3>
        </div>
        <div class="tdb-vmodel-wrap" id="tdb-top-svg-wrap">${topSvgHtml}</div>
      </div>
    </div>

    ${sysPanelsHtml}`;

  // 10. Wire tab switching + coverage update
  body.querySelectorAll('.tdb-main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      body.querySelectorAll('.tdb-main-tab').forEach(t => t.classList.toggle('active', t === tab));
      body.querySelectorAll('.tdb-main-panel').forEach(p => {
        p.classList.toggle('active', p.id === tab.dataset.panel);
        p.style.display = p.id === tab.dataset.panel ? '' : 'none';
      });
      // Update coverage table for the newly shown panel
      if (tab.dataset.panel === 'tdb-panel-overview') {
        showCoverageTable(topLinkStats, '🌐 Overview — all systems');
      } else {
        const sysId = tab.dataset.panel.replace('tdb-panel-', '');
        const sys   = systems.find(s => s.id === sysId);
        const stls  = sysTopLinkStats[sysId] || [];
        showCoverageTable(stls, `${sys?.system_code || sys?.name || 'System'} — item & system level`);
      }
      // Clear domain selection highlight
      body.querySelectorAll('.tdb-dom-col--selected').forEach(el => el.classList.remove('tdb-dom-col--selected'));
    });
  });

  // Wire domain column header click → update coverage
  body.querySelectorAll('.tdb-dom-col-hdr[data-sys]').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const sysId  = hdr.dataset.sys;
      const domain = hdr.dataset.domain;
      const sys    = systems.find(s => s.id === sysId);
      const dls    = domainStats[sysId]?.[domain] || [];
      body.querySelectorAll('.tdb-dom-col--selected').forEach(el => el.classList.remove('tdb-dom-col--selected'));
      hdr.closest('.tdb-dom-col')?.classList.add('tdb-dom-col--selected');
      showCoverageTable(dls, `${sys?.system_code || sys?.name || 'System'} — ${DOMAIN_LABELS[domain]}`);
    });
  });

  // Wire system-top header click → update coverage
  for (const sys of systems) {
    document.getElementById(`tdb-systop-hdr-${sys.id}`)?.addEventListener('click', () => {
      const stls = sysTopLinkStats[sys.id] || [];
      body.querySelectorAll('.tdb-dom-col--selected').forEach(el => el.classList.remove('tdb-dom-col--selected'));
      showCoverageTable(stls, `${sys.system_code || sys.name || 'System'} — item & system level`);
    });
  }

  // Show overview coverage on initial load
  showCoverageTable(topLinkStats, '🌐 Overview — all systems');

  // ── SVG wiring helper ──────────────────────────────────────────────────────
  function wireSvg(wrapEl, links, activeIds, posMap, lsStats, badgeOffs, openSystems) {
    if (!wrapEl) return;
    wireBadgeDrag(wrapEl, badgeOffs, links, activeIds, posMap, nodeMap, lsStats, item, openSystems);
    wrapEl.addEventListener('click', e => {
      if (wrapEl._dragJustEnded) return;
      const badge = e.target.closest('.tdb-link-badge--clickable');
      if (!badge) return;
      const ls = lsStats.find(l => l.link.from === badge.dataset.from && l.link.to === badge.dataset.to);
      if (!ls) return;
      const hasMissing = (ls.forward?.missing || 0) + (ls.backward?.missing || 0) > 0;
      openLinkPanel(ls, allLinkStats, item, openSystems, itemCache, nodeMap, project, allTraceLinks,
        allActiveIds, posMap, hasMissing ? 'missing' : 'browse', badgeOffs, refreshAllDiagrams);
    });
    wireDiagramZoom(wrapEl);
  }

  // ── Full diagram refresh ───────────────────────────────────────────────────
  function refreshAllDiagrams() {
    // Recompute overview stats
    for (const ls of topLinkStats) {
      ls.forward  = computeLinkCov(ls.link.from, ls.link.to,   ls.fromNode, item, systems, itemCache);
      ls.backward = computeLinkCov(ls.link.to,   ls.link.from, ls.toNode,   item, systems, itemCache);
    }
    // Re-render overview SVG
    const tLsMap = {};
    for (const ls of topLinkStats) tLsMap[`${ls.link.from}__${ls.link.to}`] = ls;
    const topWrap = document.getElementById('tdb-top-svg-wrap');
    if (topWrap) {
      topWrap.innerHTML = buildVmodelSVG(topLinks, topActiveIds, topPosMap, nodeMap, tLsMap, badgeOffsets);
      wireBadgeDrag(topWrap, badgeOffsets, topLinks, topActiveIds, topPosMap, nodeMap, topLinkStats, item, systems);
      wireDiagramZoom(topWrap);
    }
    // Recompute and re-render per-system SVGs
    for (const sys of systems) {
      const stls = sysTopLinkStats[sys.id] || [];
      for (const ls of stls) {
        ls.forward  = computeTopLinkCovForSystem(ls.link.from, ls.link.to,   ls.fromNode, sys, item, itemCache);
        ls.backward = computeTopLinkCovForSystem(ls.link.to,   ls.link.from, ls.toNode,   sys, item, itemCache);
      }
      const stLsMap = {};
      for (const ls of stls) stLsMap[`${ls.link.from}__${ls.link.to}`] = ls;
      const stWrap = document.getElementById(`tdb-syssvg-${sys.id}`);
      if (stWrap) {
        stWrap.innerHTML = buildVmodelSVG(sysViewLinks, sysViewActiveIds, sysViewPosMap, nodeMap, stLsMap, sysTopBadgeOff[sys.id]);
        wireBadgeDrag(stWrap, sysTopBadgeOff[sys.id], sysViewLinks, sysViewActiveIds, sysViewPosMap, nodeMap, stls, item, [sys]);
        wireDiagramZoom(stWrap);
      }
      // Domain SVGs
      for (const d of SUB_DOMAINS_LIST) {
        const dls  = domainStats[sys.id]?.[d] || [];
        for (const ls of dls) {
          ls.forward  = computeLinkCovForSystem(ls.link.from, ls.link.to,   ls.fromNode, sys, itemCache);
          ls.backward = computeLinkCovForSystem(ls.link.to,   ls.link.from, ls.toNode,   sys, itemCache);
        }
        const dIds  = new Set(domainLinks[d].flatMap(l => [l.from, l.to]));
        const dLsMap = {};
        for (const ls of dls) dLsMap[`${ls.link.from}__${ls.link.to}`] = ls;
        const dWrap = document.getElementById(`tdb-dsvg-${sys.id}-${d}`);
        if (dWrap && dIds.size) {
          dWrap.innerHTML = buildVmodelSVG(domainLinks[d], dIds, dPosMap[d], nodeMap, dLsMap, sysDomBadgeOff[sys.id][d]);
          wireBadgeDrag(dWrap, sysDomBadgeOff[sys.id][d], domainLinks[d], dIds, dPosMap[d], nodeMap, dls, item, [sys]);
          wireDiagramZoom(dWrap);
        }
      }
    }
  }

  // Overview SVG
  wireSvg(document.getElementById('tdb-top-svg-wrap'), topLinks, topActiveIds, topPosMap, topLinkStats, badgeOffsets, systems);

  // Per-system panel wiring
  for (const sys of systems) {
    const stls = sysTopLinkStats[sys.id] || [];
    wireSvg(document.getElementById(`tdb-syssvg-${sys.id}`), sysViewLinks, sysViewActiveIds, sysViewPosMap, stls, sysTopBadgeOff[sys.id], [sys]);

    // Domain columns
    for (const d of SUB_DOMAINS_LIST) {
      const dls  = domainStats[sys.id]?.[d] || [];
      const dIds = new Set(domainLinks[d].flatMap(l => [l.from, l.to]));
      if (dIds.size) {
        wireSvg(document.getElementById(`tdb-dsvg-${sys.id}-${d}`), domainLinks[d], dIds, dPosMap[d], dls, sysDomBadgeOff[sys.id][d], [sys]);
      }
    }
  }

  _refreshDiagrams = refreshAllDiagrams;
  wireBpTabs(allLinkStats, item, systems, itemCache, nodeMap, allTraceLinks, project);

  return { allLinkStats, badgeOffsets, topLinks, allActiveIds, topPosMap, nodeMap };
}

// ── New helper: computeLinkCovForSystem ───────────────────────────────────────

function computeLinkCovForSystem(srcNodeId, dstNodeId, srcNode, system, itemCache) {
  let total = 0, linked = 0;
  const missingItems = [], justifiedItems = [], linkedItems = [];
  for (const it of (itemCache[`${srcNodeId}:${system.id}`] || [])) {
    total++;
    const t    = it.traceability || {};
    const just = t._justifications?.[dstNodeId];
    if (Array.isArray(t[dstNodeId]) && t[dstNodeId].length > 0) {
      linked++;
      linkedItems.push({ ...it, _linkedCodes: t[dstNodeId] });
    } else if (just) {
      linked++;
      justifiedItems.push({ ...it, _justification: just });
    } else {
      missingItems.push(it);
    }
  }
  return { total, linked, missing: missingItems.length, missingItems, justifiedItems, linkedItems };
}

function computeTopLinkCovForSystem(srcNodeId, dstNodeId, srcNode, system, item, itemCache) {
  // system/sub-domain nodes → use system's cache; item-level nodes → use item's cache
  const SUB_DOM = new Set(['sw', 'hw', 'mech']);
  const usesSystem = srcNode.domain === 'system' || SUB_DOM.has(srcNode.domain);
  const parentId = usesSystem ? system.id : item?.id;
  const items = parentId ? (itemCache[`${srcNodeId}:${parentId}`] || []) : [];
  let total = 0, linked = 0;
  const missingItems = [], justifiedItems = [], linkedItems = [];
  for (const it of items) {
    total++;
    const t    = it.traceability || {};
    const just = t._justifications?.[dstNodeId];
    if (Array.isArray(t[dstNodeId]) && t[dstNodeId].length > 0) {
      linked++;
      linkedItems.push({ ...it, _linkedCodes: t[dstNodeId] });
    } else if (just) {
      linked++;
      justifiedItems.push({ ...it, _justification: just });
    } else {
      missingItems.push(it);
    }
  }
  return { total, linked, missing: missingItems.length, missingItems, justifiedItems, linkedItems };
}

// ── Diagram zoom/pan ─────────────────────────────────────────────────────────

function wireDiagramZoom(wrapEl) {
  const svg = wrapEl.querySelector('svg');
  if (!svg) return;

  const vbStr = svg.getAttribute('viewBox');
  if (!vbStr) return;
  const [ox, oy, ow, oh] = vbStr.split(' ').map(Number);
  let vx = ox, vy = oy, vw = ow, vh = oh;

  function applyVB() {
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
  }

  function zoomAt(factor, cx, cy) {
    vx = cx - (cx - vx) * factor;
    vy = cy - (cy - vy) * factor;
    vw *= factor;
    vh *= factor;
    applyVB();
  }

  // Zoom toolbar
  const bar = document.createElement('div');
  bar.className = 'tdb-zoom-bar';
  bar.innerHTML = `
    <button class="btn btn-ghost btn-xs tdb-zoom-btn" data-action="in"  title="Zoom in">＋</button>
    <button class="btn btn-ghost btn-xs tdb-zoom-btn" data-action="out" title="Zoom out">－</button>
    <button class="btn btn-ghost btn-xs tdb-zoom-btn" data-action="fit" title="Fit to view">⊡</button>`;
  wrapEl.style.position = 'relative';
  wrapEl.insertBefore(bar, svg);

  bar.querySelectorAll('.tdb-zoom-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cx = vx + vw / 2, cy = vy + vh / 2;
      if (btn.dataset.action === 'in')  zoomAt(0.75, cx, cy);
      if (btn.dataset.action === 'out') zoomAt(1.33, cx, cy);
      if (btn.dataset.action === 'fit') { vx = ox; vy = oy; vw = ow; vh = oh; applyVB(); }
    });
  });

  // Mouse wheel zoom
  wrapEl.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top)  / rect.height;
    const cx = vx + vw * px, cy = vy + vh * py;
    zoomAt(e.deltaY > 0 ? 1.15 : 0.87, cx, cy);
  }, { passive: false });

  // Drag to pan
  let drag = null;
  svg.style.cursor = 'grab';

  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.tdb-link-badge')) return; // let badge drag handle it
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    drag = {
      startX: e.clientX, startY: e.clientY,
      startVx: vx, startVy: vy,
      scaleX: vw / rect.width, scaleY: vh / rect.height,
    };
    svg.style.cursor = 'grabbing';
  });

  const onMove = e => {
    if (!drag) return;
    vx = drag.startVx - (e.clientX - drag.startX) * drag.scaleX;
    vy = drag.startVy - (e.clientY - drag.startY) * drag.scaleY;
    applyVB();
  };
  const onUp = () => {
    if (!drag) return;
    drag = null;
    svg.style.cursor = 'grab';
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);

  // Cleanup on page navigation
  wrapEl._zoomCleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  };
}

async function refreshCache(activeIds, nodeMap, item, systems, cache) {
  await Promise.all([...activeIds].map(async nodeId => {
    const node = nodeMap[nodeId];
    if (!node) return;
    for (const { parentType, parentId } of getParents(node, item, systems)) {
      cache[`${nodeId}:${parentId}`] = await fetchNodeItems(node, parentType, parentId);
    }
  }));
}

// ── SVG ───────────────────────────────────────────────────────────────────────

function buildVmodelSVG(traceLinks, activeIds, posMap, nodeMap, lsMap, badgeOffsets = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of activeIds) {
    const p = posMap[id]; if (!p) continue;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
  }
  if (!isFinite(minX)) return '<svg viewBox="0 0 200 60" width="100%"><text x="10" y="30" font-size="12" fill="#888">No nodes</text></svg>';
  const PAD = 24;
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;

  const DC = {
    system:   { fill:'#e8f0fe', stroke:'#4285f4', text:'#1a56db' },
    sw:       { fill:'#e6f4ea', stroke:'#34a853', text:'#1e7e34' },
    hw:       { fill:'#fce8e6', stroke:'#ea4335', text:'#c62828' },
    mech:     { fill:'#f3e8fd', stroke:'#9c27b0', text:'#6a1b9a' },
    safety:   { fill:'#fff3e0', stroke:'#ff9800', text:'#e65100' },
    customer: { fill:'#fffde7', stroke:'#f9a825', text:'#795548' },
    item:     { fill:'#e0f7fa', stroke:'#00acc1', text:'#006064' },
  };

  const linkElems = traceLinks.map(link => {
    const fp = posMap[link.from], tp = posMap[link.to];
    if (!fp || !tp) return '';
    const x1 = fp.x+NODE_W/2, y1 = fp.y+NODE_H/2;
    const x2 = tp.x+NODE_W/2, y2 = tp.y+NODE_H/2;
    let mx, my, d;
    if (link.bend) {
      const bx=(x1+x2)/2+link.bend.x, by=(y1+y2)/2+(link.bend.y||0);
      d=`M${x1},${y1} Q${bx},${by} ${x2},${y2}`;
      mx=0.25*x1+0.5*bx+0.25*x2; my=0.25*y1+0.5*by+0.25*y2;
    } else {
      d=`M${x1},${y1} L${x2},${y2}`; mx=(x1+x2)/2; my=(y1+y2)/2;
    }

    const ls  = lsMap[`${link.from}__${link.to}`];
    const fwd = ls?.forward, bwd = ls?.backward;
    const fwdPct = fwd?.total ? Math.round(fwd.linked/fwd.total*100) : null;
    const bwdPct = bwd?.total ? Math.round(bwd.linked/bwd.total*100) : null;
    const minPct = fwdPct!==null&&bwdPct!==null ? Math.min(fwdPct,bwdPct) : fwdPct??bwdPct;
    const lc = minPct===null?'#d1d5db':minPct===100?'#34a853':minPct>=50?'#fbbc04':'#ea4335';

    const fwdTxt = fwd ? `→ ${fwd.linked}/${fwd.total} (${fwdPct??'N/A'}%)` : '→ N/A';
    const bwdTxt = bwd ? `← ${bwd.linked}/${bwd.total} (${bwdPct??'N/A'}%)` : '← N/A';
    const BW = Math.max(fwdTxt.length, bwdTxt.length)*6.2+10;
    const BH=28, BR=4;
    const badgeKey = `${link.from}__${link.to}`;
    const bOff = badgeOffsets[badgeKey] || { dx: 0, dy: 0 };
    const bmx = mx + bOff.dx, bmy = my + bOff.dy;
    const bx = bmx-BW/2, by = bmy-BH/2;

    const tetherVis = (bOff.dx !== 0 || bOff.dy !== 0) ? '0.7' : '0';

    return `
      <path d="${d}" stroke="${lc}" stroke-width="2" fill="none" stroke-dasharray="5,3" opacity="0.75"/>
      <line data-tether="${badgeKey}" x1="${mx}" y1="${my}" x2="${bmx}" y2="${bmy}"
            stroke="#aaa" stroke-width="1" stroke-dasharray="3,3" opacity="${tetherVis}" pointer-events="none"/>
      <g class="tdb-link-badge tdb-link-badge--clickable"
         data-from="${link.from}" data-to="${link.to}" data-mx="${mx}" data-my="${my}" style="cursor:grab">
        <rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="${BR}"
              fill="white" stroke="${lc}" stroke-width="1.5" opacity="0.97"/>
        <text x="${bmx}" y="${by+11}" text-anchor="middle"
              font-size="9" font-weight="600" fill="${_pctColor(fwdPct)}" font-family="system-ui,sans-serif">${esc(fwdTxt)}</text>
        <text x="${bmx}" y="${by+22}" text-anchor="middle"
              font-size="9" font-weight="600" fill="${_pctColor(bwdPct)}" font-family="system-ui,sans-serif">${esc(bwdTxt)}</text>
        <title>Drag to reposition · Click to inspect traceability</title>
      </g>`;
  }).join('');

  const nodeBoxes = [...activeIds].map(nodeId => {
    const node=nodeMap[nodeId], pos=posMap[nodeId];
    if(!node||!pos) return '';
    const c=DC[node.domain]||DC.system;
    return `
      <g class="tdb-vnode">
        <rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}"
              rx="5" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>
        <text x="${pos.x+NODE_W/2}" y="${pos.y+21}"
              text-anchor="middle" font-size="10" font-weight="700"
              fill="${c.text}" font-family="system-ui,sans-serif">${esc(node.label)}</text>
      </g>`;
  }).join('');

  return `<svg viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}"
               width="100%" style="max-height:480px;display:block" xmlns="http://www.w3.org/2000/svg">
    ${linkElems}${nodeBoxes}
  </svg>`;
}

// ── Bottom panel tabs ─────────────────────────────────────────────────────────

function wireBpTabs(linkStats, item, systems, itemCache, nodeMap, traceLinks, project) {
  document.querySelectorAll('.tdb-bp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchBpTab(tab.dataset.tab, linkStats, item, systems, itemCache, nodeMap, traceLinks, project);
      document.getElementById('tdb-bp')._bp?.expand();
    });
  });
}

function switchBpTab(tabId, linkStats, item, systems, itemCache, nodeMap, traceLinks, project) {
  document.querySelectorAll('.tdb-bp-tab').forEach(t =>
    t.classList.toggle('tdb-bp-tab--active', t.dataset.tab === tabId));
  document.getElementById('tdb-tab-coverage').style.display = tabId === 'coverage' ? '' : 'none';
  document.getElementById('tdb-tab-missing').style.display  = tabId === 'missing'  ? '' : 'none';
  document.getElementById('tdb-tab-browse').style.display   = tabId === 'browse'   ? '' : 'none';
  if (tabId === 'browse') buildBrowseLeft(linkStats, item, systems, itemCache, nodeMap, traceLinks, project);
}

function buildBrowseLeft(linkStats, item, systems, itemCache, nodeMap, traceLinks, project) {
  const leftEl  = document.getElementById('tdb-browse-left');
  const rightEl = document.getElementById('tdb-browse-right');
  if (!leftEl) return;

  const sections = [];
  for (const nodeId of Object.keys(nodeMap)) {
    const node  = nodeMap[nodeId];
    const items = getAllItems(nodeId, item, systems, itemCache);
    const linked = items.filter(it => {
      const t = it.traceability || {};
      const hasForward  = Object.entries(t).some(([k, v]) => k !== '_justifications' && Array.isArray(v) && v.length > 0);
      const hasJust     = t._justifications && Object.keys(t._justifications).length > 0;
      const isTarget = linkStats.some(ls =>
        (ls.link.from === nodeId || ls.link.to === nodeId) &&
        getAllItems(ls.link.from === nodeId ? ls.link.to : ls.link.from, item, systems, itemCache)
          .some(other => {
            const ot = other.traceability || {};
            return Object.entries(ot).some(([k, v]) => k !== '_justifications' && k === nodeId && Array.isArray(v) && v.includes(it.code));
          })
      );
      return hasForward || hasJust || isTarget;
    });
    if (linked.length) sections.push({ node, nodeId, items: linked });
  }

  if (!sections.length) {
    leftEl.innerHTML = `<div class="tdb-panel-empty"><p>No linked items yet.</p></div>`;
    return;
  }

  leftEl.innerHTML = sections.map(sec => `
    <div class="tdb-panel-section">
      <div class="tdb-panel-section-hdr">
        <span class="tdb-panel-dir">${esc(sec.node.label)}</span>
        <span class="tdb-panel-count tdb-badge tdb-badge--ok">${sec.items.length}</span>
      </div>
      ${sec.items.map(it => `
        <div class="tdb-panel-item tdb-panel-item--available" data-code="${esc(it.code)}" data-node="${esc(sec.nodeId)}"
             style="cursor:pointer" title="View V-model trace for ${esc(it.code)}">
          <code class="tdb-panel-code">${esc(it.code)}</code>
          <span class="tdb-panel-label">${esc((it.label||'').slice(0,50))}</span>
        </div>`).join('')}
    </div>`).join('');

  leftEl.querySelectorAll('.tdb-panel-item').forEach(el => {
    el.addEventListener('click', async () => {
      leftEl.querySelectorAll('.tdb-panel-item').forEach(x => x.classList.remove('tdb-panel-item--selected'));
      el.classList.add('tdb-panel-item--selected');
      const nodeId = el.dataset.node;
      const code   = el.dataset.code;
      const allItems = getAllItems(nodeId, item, systems, itemCache);
      const it = allItems.find(i => i.code === code);
      if (!it) return;
      await buildBrowseRight(it, nodeId, nodeMap, itemCache, item, systems, traceLinks, rightEl, project);
    });
  });

  leftEl.querySelector('.tdb-panel-item')?.click();
}

async function buildBrowseRight(selItem, nodeId, nodeMap, itemCache, item, systems, traceLinks, rightEl, project) {
  rightEl.innerHTML = '<div class="content-loading" style="padding:24px"><div class="spinner"></div></div>';

  const node         = nodeMap[nodeId];
  const traceability = selItem.traceability || {};
  const nodeOrder    = VMODEL_NODES.map(n => n.id);
  const myNodeIdx    = nodeOrder.indexOf(nodeId);

  const connectedNodeIds = new Set();
  for (const link of traceLinks) {
    if (link.from === nodeId) connectedNodeIds.add(link.to);
    if (link.to   === nodeId) connectedNodeIds.add(link.from);
  }

  if (!connectedNodeIds.size) {
    rightEl.innerHTML = `<div class="tdb-panel-empty"><p>No V-model connections configured for this node.</p></div>`;
    return;
  }

  const TEST_PHASES = new Set(['unit_testing', 'integration_testing', 'system_testing']);

  const fields = [];
  for (const cNodeId of connectedNodeIds) {
    const cNode = nodeMap[cNodeId];
    if (!cNode) continue;
    const linked    = Array.isArray(traceability[cNodeId]) ? traceability[cNodeId] : [];
    const cItems    = getAllItems(cNodeId, item, systems, itemCache);
    const revLinked = cItems.filter(ci => {
      const ct = ci.traceability || {};
      return Array.isArray(ct[nodeId]) && ct[nodeId].includes(selItem.code);
    }).map(ci => ({ code: ci.code, label: ci.label }));
    const options = cItems.map(ci => ({ code: ci.code, label: ci.label }));

    fields.push({
      field: { id: cNodeId, label: cNode.label, node: cNode },
      linked, revLinked, options,
    });
  }

  const devFields  = fields.filter(f => !TEST_PHASES.has(f.field.node.phase));
  const testFields = fields.filter(f =>  TEST_PHASES.has(f.field.node.phase));

  devFields.sort((a, b) => {
    const ai = nodeOrder.indexOf(a.field.id);
    const bi = nodeOrder.indexOf(b.field.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const upstreamFields   = devFields.filter(e => nodeOrder.indexOf(e.field.id) < myNodeIdx);
  const downstreamFields = devFields.filter(e => nodeOrder.indexOf(e.field.id) > myNodeIdx);

  const chainHTML = buildBrowseChainHTML(selItem, node, nodeId, upstreamFields, downstreamFields, testFields);

  rightEl.innerHTML = `<div class="rtrace-chain" style="overflow-y:auto;padding:12px 8px">${chainHTML}</div>`;

  rightEl.querySelectorAll('.rtrace-item-main').forEach(el => {
    el.addEventListener('click', async () => {
      const detail  = document.getElementById(`rtrace-detail-${CSS.escape(el.dataset.code)}`);
      const chevron = el.querySelector('.rtrace-item-chevron');
      if (!detail) return;
      const open = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : 'block';
      if (chevron) chevron.textContent = open ? '▶' : '▼';
      if (!open && !detail.dataset.loaded) {
        detail.dataset.loaded = '1';
        const code    = el.dataset.code;
        const fieldId = el.dataset.field;
        const opts    = fields.find(f => f.field.id === fieldId)?.options || [];
        const opt     = opts.find(o => o.code === code);
        detail.innerHTML = opt?.label
          ? `<div style="padding:4px 0 2px;font-size:11px;color:var(--color-text-muted)">${esc(opt.label)}</div>`
          : `<div style="font-size:11px;color:var(--color-text-muted)">—</div>`;
      }
    });
  });

  rightEl.querySelectorAll('.tdb-open-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const code    = btn.dataset.code;
      const fieldId = btn.dataset.field;
      const fNode   = nodeMap[fieldId] || VMODEL_NODES.find(n => n.id === fieldId);
      if (!fNode) { console.warn('tdb: node not found for fieldId', fieldId); return; }
      openItemInNewTab(code, fNode, project, item, systems, itemCache);
    });
  });

  rightEl.querySelectorAll('.tdb-unlink-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      e.preventDefault();
      if (!confirm(`Remove link ${btn.dataset.srcCode} ↔ ${btn.dataset.dstCode}?`)) return;
      btn.disabled = true; btn.textContent = '…';
      const ok = await unlinkItems(
        btn.dataset.srcCode, btn.dataset.srcNode,
        btn.dataset.dstCode, btn.dataset.dstNode,
        item, systems, itemCache
      );
      if (!ok) { btn.disabled = false; btn.textContent = '✕'; return; }
      toast(`Unlinked ${btn.dataset.srcCode} ↔ ${btn.dataset.dstCode}`, 'success');
      _refreshDiagrams?.();
      // Rebuild the right panel to reflect removal
      await buildBrowseRight(selItem, nodeId, nodeMap, itemCache, item, systems, traceLinks, rightEl, project);
    });
  });
}

function openItemInNewTab(code, node, project, item, systems, itemCache) {
  sessionStorage.setItem('tdb_goto', JSON.stringify({ code }));

  const pid = project.id;
  const iid = item.id;

  let systemId = null;
  if (node.domain !== 'item' && systems.length) {
    for (const sys of systems) {
      const cached = itemCache[`${node.id}:${sys.id}`] || [];
      if (cached.some(i => i.code === code)) { systemId = sys.id; break; }
    }
  }

  const domain = node.domain;
  const phase  = node.phase;

  let route;
  if (systemId) {
    route = `/project/${pid}/item/${iid}/system/${systemId}/domain/${domain}/vcycle/${phase}`;
  } else if (domain !== 'item') {
    route = `/project/${pid}/item/${iid}/domain/${domain}/vcycle/${phase}`;
  } else {
    route = `/project/${pid}/item/${iid}/domain/system/vcycle/${phase}`;
  }

  window.open(`${window.location.pathname}#${route}`, '_blank');
}

function buildBrowseChainHTML(it, myNode, nodeId, upstreamFields, downstreamFields, testFields) {
  const nodeIcon   = { system: '⬡', sw: '◧', hw: '◨', mech: '◎', item: '⬡' };
  const TEST_PHASES = new Set(['unit_testing', 'integration_testing', 'system_testing']);
  const isTestNode  = TEST_PHASES.has(myNode?.phase);

  function buildNodeCard(entry, arrowDir) {
    const { field, linked, revLinked, options } = entry;
    const totalLinks  = linked.length + revLinked.length;
    const linkedItems = linked.map(code => {
      const opt = options.find(o => o.code === code);
      return `<div class="rtrace-item rtrace-item--linked" data-code="${esc(code)}" data-field="${esc(field.id)}">
        <div class="rtrace-item-main" data-code="${esc(code)}" data-field="${esc(field.id)}" title="Click to expand">
          <span class="rtrace-item-code">${esc(code)}</span>
          <span class="rtrace-item-label">${esc((opt?.label||'').slice(0,40))}</span>
          <span class="rtrace-item-chevron">▶</span>
        </div>
        <div class="rtrace-item-detail" id="rtrace-detail-${esc(code)}" style="display:none"></div>
        <button class="tdb-unlink-btn" data-src-code="${esc(it.code)}" data-src-node="${esc(nodeId)}"
          data-dst-code="${esc(code)}" data-dst-node="${esc(field.id)}" title="Remove link (both directions)">✕</button>
        <button class="tdb-open-btn" data-code="${esc(code)}" data-field="${esc(field.id)}" title="Open item in new tab">↗</button>
      </div>`;
    }).join('');
    const revItems = revLinked.map(r => `
      <div class="rtrace-item rtrace-item--reverse">
        <div class="rtrace-item-main" data-code="${esc(r.code)}" data-field="${esc(field.id)}" title="Click to expand">
          <span class="rtrace-item-code">${esc(r.code)}</span>
          <span class="rtrace-item-label">${esc((r.label||'').slice(0,40))}</span>
          <span class="rtrace-item-badge">↩</span>
          <span class="rtrace-item-chevron">▶</span>
        </div>
        <div class="rtrace-item-detail" id="rtrace-detail-${esc(r.code)}" style="display:none"></div>
        <button class="tdb-unlink-btn" data-src-code="${esc(r.code)}" data-src-node="${esc(field.id)}"
          data-dst-code="${esc(it.code)}" data-dst-node="${esc(nodeId)}" title="Remove link (both directions)">✕</button>
        <button class="tdb-open-btn" data-code="${esc(r.code)}" data-field="${esc(field.id)}" title="Open item in new tab">↗</button>
      </div>`).join('');
    return `
      <div class="rtrace-node rtrace-node--${arrowDir}">
        <div class="rtrace-node-hdr">
          <span class="rtrace-node-icon">${nodeIcon[field.node.domain] || '◈'}</span>
          <span class="rtrace-node-name">${esc(field.label)}</span>
          <span class="rtrace-node-count ${totalLinks ? 'has-links' : ''}">${totalLinks}</span>
        </div>
        <div class="rtrace-node-body">
          ${linkedItems}${revItems}
          ${!linkedItems && !revItems ? `<div class="rtrace-empty">No links</div>` : ''}
        </div>
      </div>`;
  }

  function renderNodeSequence(fields) {
    return fields.map((entry, i) => {
      const nextLabel = fields[i + 1]?.field.label || '';
      const connector = i < fields.length - 1 ? `
        <div class="rtrace-bidir-arrow">
          <span class="rtrace-bidir-up">↑</span>
          <span class="rtrace-bidir-label">${esc(it.code)} ↔ ${esc(nextLabel)}</span>
          <span class="rtrace-bidir-down">↓</span>
        </div>` : '';
      return buildNodeCard(entry, 'down') + connector;
    }).join('');
  }

  if (isTestNode) {
    const allDev = [...upstreamFields, ...downstreamFields];
    const devStack = allDev.map(e => buildNodeCard(e, 'left')).join(
      `<div class="rtrace-v-spacer"></div>`);
    return `
      <div class="rtrace-v-layout">
        <div class="rtrace-top-row">
          ${devStack ? `
          <div class="rtrace-top-right" style="order:-1">
            <div class="rtrace-test-stack">${devStack}</div>
          </div>
          <div class="rtrace-horiz-arrow" style="order:0">
            <span class="rtrace-horiz-line"></span>
            <span class="rtrace-horiz-label">↔</span>
          </div>` : ''}
          <div class="rtrace-top-left" style="order:1">
            <div class="rtrace-current">
              <div class="rtrace-current-icon">${nodeIcon[myNode?.domain] || '◈'}</div>
              <div class="rtrace-current-body">
                <div class="rtrace-current-code">${esc(it.code)}</div>
                <div class="rtrace-current-title">${esc(it.label||'')}</div>
                <span class="rtrace-current-type">${esc(myNode?.label||'')}</span>
              </div>
              <button class="tdb-open-btn" data-code="${esc(it.code)}" data-field="${esc(myNode?.id||'')}" title="Open item in new tab">↗</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  const testColumn = testFields.map(e => buildNodeCard(e, 'right')).join(
    `<div class="rtrace-v-spacer"></div>`);

  return `
    <div class="rtrace-v-layout">
      ${upstreamFields.length ? `
        <div class="rtrace-dev-chain rtrace-upstream">${renderNodeSequence(upstreamFields)}</div>
        <div class="rtrace-bidir-arrow">
          <span class="rtrace-bidir-up">↑</span>
          <span class="rtrace-bidir-label">${esc(it.code)} ↔ ${esc(myNode?.label||'')}</span>
          <span class="rtrace-bidir-down">↓</span>
        </div>` : ''}

      <div class="rtrace-top-row">
        <div class="rtrace-top-left">
          <div class="rtrace-current">
            <div class="rtrace-current-icon">${nodeIcon[myNode?.domain] || '◈'}</div>
            <div class="rtrace-current-body">
              <div class="rtrace-current-code">${esc(it.code)}</div>
              <div class="rtrace-current-title">${esc(it.label||'')}</div>
            </div>
            <button class="tdb-open-btn" data-code="${esc(it.code)}" data-field="${esc(myNode?.id||'')}" title="Open item in new tab">↗</button>
          </div>
          ${downstreamFields.length ? `
          <div class="rtrace-bidir-arrow">
            <span class="rtrace-bidir-up">↑</span>
            <span class="rtrace-bidir-label">${esc(it.code)} ↔ ${esc(downstreamFields[0]?.field.label||'')}</span>
            <span class="rtrace-bidir-down">↓</span>
          </div>` : ''}
        </div>
        ${testColumn ? `
        <div class="rtrace-top-right">
          <div class="rtrace-horiz-arrow">
            <span class="rtrace-horiz-line"></span>
            <span class="rtrace-horiz-label">↔ test</span>
          </div>
          <div class="rtrace-test-stack">${testColumn}</div>
        </div>` : ''}
      </div>

      ${downstreamFields.length ? `
        <div class="rtrace-dev-chain">${renderNodeSequence(downstreamFields)}</div>` : ''}
    </div>`;
}

// ── SVG click / badge drag wiring ─────────────────────────────────────────────

function wireBadgeDrag(svgWrap, badgeOffsets, traceLinks, activeIds, posMap, nodeMap, linkStats, item, systems) {
  svgWrap._badgeDragAbort?.abort();
  const ac = new AbortController();
  svgWrap._badgeDragAbort = ac;
  const sig = ac.signal;

  let dragging = null;
  let didMove  = false;

  function getSvgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  svgWrap.addEventListener('mousedown', e => {
    const g = e.target.closest('.tdb-link-badge');
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = svgWrap.querySelector('svg');
    if (!svg) return;
    const sp = getSvgPoint(svg, e.clientX, e.clientY);
    const key = `${g.dataset.from}__${g.dataset.to}`;
    const orig = badgeOffsets[key] || { dx: 0, dy: 0 };
    dragging = { key, startSvgX: sp.x, startSvgY: sp.y, origDx: orig.dx, origDy: orig.dy, gEl: g };
    didMove = false;
    g.style.cursor = 'grabbing';
  }, { signal: sig });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const svg = svgWrap.querySelector('svg');
    if (!svg) return;
    const sp = getSvgPoint(svg, e.clientX, e.clientY);
    const ddx = sp.x - dragging.startSvgX;
    const ddy = sp.y - dragging.startSvgY;
    if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) didMove = true;
    dragging.gEl.setAttribute('transform', `translate(${dragging.origDx + ddx},${dragging.origDy + ddy})`);
    const tether = svg.querySelector(`[data-tether="${dragging.key}"]`);
    if (tether) {
      const mx = parseFloat(tether.getAttribute('x1'));
      const my = parseFloat(tether.getAttribute('y1'));
      const bmx = mx + dragging.origDx + ddx;
      const bmy = my + dragging.origDy + ddy;
      tether.setAttribute('x2', bmx);
      tether.setAttribute('y2', bmy);
      tether.setAttribute('opacity', '0.7');
    }
  }, { signal: sig });

  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;

    if (!didMove) {
      // Simple click — reset cursor, re-register, let click event bubble through
      d.gEl.style.cursor = '';
      ac.abort();
      wireBadgeDrag(svgWrap, badgeOffsets, traceLinks, activeIds, posMap, nodeMap, linkStats, item, systems);
      return;
    }

    // Badge was actually dragged — save offset and re-render SVG
    const svg = svgWrap.querySelector('svg');
    if (svg) {
      const sp = getSvgPoint(svg, e.clientX, e.clientY);
      const ddx = sp.x - d.startSvgX;
      const ddy = sp.y - d.startSvgY;
      badgeOffsets[d.key] = {
        dx: Math.round(d.origDx + ddx),
        dy: Math.round(d.origDy + ddy),
      };
    }
    svgWrap._dragJustEnded = true;
    ac.abort();
    // Recompute lsMap and re-render SVG in place
    const lsMap = {};
    for (const ls of linkStats) lsMap[`${ls.link.from}__${ls.link.to}`] = ls;
    svgWrap.innerHTML = buildVmodelSVG(traceLinks, activeIds, posMap, nodeMap, lsMap, badgeOffsets);
    wireBadgeDrag(svgWrap, badgeOffsets, traceLinks, activeIds, posMap, nodeMap, linkStats, item, systems);
    wireDiagramZoom(svgWrap);
    setTimeout(() => { svgWrap._dragJustEnded = false; }, 50);
  }, { signal: sig });
}

function openLinkPanel(ls, linkStats, item, systems, itemCache, nodeMap, project, traceLinks, activeIds, posMap, preferTab = 'missing', badgeOffsets = {}, onLinkSaved = null) {
  const bpEl = document.getElementById('tdb-bp');
  if (!bpEl) return;
  bpEl._bp?.expand();

  switchBpTab(preferTab, linkStats, item, systems, itemCache, nodeMap, traceLinks, project);

  if (preferTab === 'missing') {
    const leftEl  = document.getElementById('tdb-bp-left');
    const rightEl = document.getElementById('tdb-bp-right');
    if (leftEl && rightEl)
      renderPanelCols(ls, linkStats, item, systems, itemCache, nodeMap, project, traceLinks, activeIds, posMap, leftEl, rightEl, badgeOffsets, onLinkSaved);
  }
}

function renderPanelCols(ls, linkStats, item, systems, itemCache, nodeMap, project, traceLinks, activeIds, posMap, leftEl, rightEl, badgeOffsets = {}, onLinkSaved = null) {
  let selectedSrc = null;

  function buildCols() {
    const sections = [
      { label: `${ls.fromNode.label} → ${ls.toNode.label}`, srcId: ls.link.from, dstId: ls.link.to,   cov: ls.forward,  srcNode: ls.fromNode, dstNode: ls.toNode   },
      { label: `${ls.toNode.label} → ${ls.fromNode.label}`, srcId: ls.link.to,   dstId: ls.link.from, cov: ls.backward, srcNode: ls.toNode,   dstNode: ls.fromNode },
    ].filter(s => s.cov.missing > 0 || s.cov.justifiedItems.length > 0);

    if (!sections.length) {
      leftEl.innerHTML = `<div class="tdb-panel-empty"><span style="color:#34a853;font-size:18px">✓</span><p>All items linked or justified in both directions.</p></div>`;
      rightEl.innerHTML = '';
      return;
    }

    leftEl.innerHTML = sections.map(sec => `
      <div class="tdb-panel-section">
        <div class="tdb-panel-section-hdr">
          <span class="tdb-panel-dir">${esc(sec.label)}</span>
          ${sec.cov.missing > 0
            ? `<span class="tdb-panel-count tdb-badge tdb-badge--low">${sec.cov.missing} missing</span>`
            : `<span class="tdb-panel-count tdb-badge tdb-badge--ok">✓ all covered</span>`}
        </div>
        <div class="tdb-missing-items" data-src="${sec.srcId}" data-dst="${sec.dstId}">
          ${sec.cov.missingItems.map(it => `
            <div class="tdb-panel-item tdb-panel-item--missing" data-code="${esc(it.code)}"
                 data-src="${sec.srcId}" data-dst="${sec.dstId}" data-justified="0"
                 title="Click to select and link">
              <code class="tdb-panel-code">${esc(it.code)}</code>
              <span class="tdb-panel-label">${esc((it.label||'').slice(0,46))}</span>
            </div>`).join('')}
          ${sec.cov.justifiedItems.map(it => `
            <div class="tdb-panel-item tdb-panel-item--justified" data-code="${esc(it.code)}"
                 data-src="${sec.srcId}" data-dst="${sec.dstId}" data-justified="1"
                 title="Justified — click to view or remove justification">
              <code class="tdb-panel-code">${esc(it.code)}</code>
              <span class="tdb-panel-label">${esc((it.label||'').slice(0,36))}</span>
              <span class="tdb-panel-just-badge">✓ justified</span>
            </div>`).join('')}
        </div>
      </div>`).join('');

    const firstSec  = sections[0];
    const firstItem = firstSec.cov.missingItems[0] || firstSec.cov.justifiedItems[0];
    if (firstItem) {
      const isJust = !firstSec.cov.missingItems.length;
      selectedSrc = { item: firstItem, srcId: firstSec.srcId, dstId: firstSec.dstId,
                      srcNode: firstSec.srcNode, dstNode: firstSec.dstNode, isJustified: isJust };
      leftEl.querySelector(`[data-code="${esc(firstItem.code)}"]`)?.classList.add('tdb-panel-item--selected');
    }

    buildRightCol();
    wireLeftClicks();
  }

  function buildRightCol() {
    if (!selectedSrc) {
      rightEl.innerHTML = `<div class="tdb-panel-empty"><p>Select an item on the left to see available links.</p></div>`;
      return;
    }
    const { dstId, dstNode, item: srcIt, isJustified } = selectedSrc;
    const existing = srcIt.traceability || {};
    const just     = existing._justifications?.[dstId];

    if (isJustified && just) {
      rightEl.innerHTML = `
        <div class="tdb-panel-section">
          <div class="tdb-panel-section-hdr">
            <span class="tdb-panel-dir">Justification for <code>${esc(srcIt.code)}</code></span>
          </div>
          <div style="padding:8px 4px">
            <textarea id="tdb-just-text" class="form-input form-textarea" rows="4"
              style="font-size:12px;resize:vertical">${esc(just.reason || '')}</textarea>
            <div style="margin-top:6px;font-size:11px;color:var(--color-text-muted)">
              Justified by <strong>${esc(just.user || '—')}</strong> on ${esc(just.date ? new Date(just.date).toLocaleDateString() : '—')}
            </div>
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="btn btn-secondary btn-sm" id="tdb-just-save">💾 Update</button>
              <button class="btn btn-sm" id="tdb-just-remove" style="color:var(--color-danger);border-color:var(--color-danger)">✕ Remove justification</button>
            </div>
          </div>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--color-border)">
            <div class="tdb-panel-section-hdr" style="margin-bottom:6px">
              <span class="tdb-panel-dir">Or link to ${esc(dstNode.label)}</span>
            </div>
            ${buildRhsLinkList(dstId, srcIt)}
          </div>
        </div>`;

      document.getElementById('tdb-just-save')?.addEventListener('click', async () => {
        const reason = document.getElementById('tdb-just-text')?.value.trim() || '';
        await saveJustification(srcIt, dstId, reason, selectedSrc.srcNode, item, systems, itemCache);
        const updated = getAllItems(selectedSrc.srcId, item, systems, itemCache).find(i => i.code === srcIt.code);
        if (updated) selectedSrc.item = updated;
        recomputeAndRefresh();
        toast('Justification updated.', 'success');
      });

      document.getElementById('tdb-just-remove')?.addEventListener('click', async () => {
        if (!confirm(`Remove justification for ${srcIt.code}?`)) return;
        await removeJustification(srcIt, dstId, selectedSrc.srcNode, item, systems, itemCache);
        const updated = getAllItems(selectedSrc.srcId, item, systems, itemCache).find(i => i.code === srcIt.code);
        if (updated) { selectedSrc.item = updated; selectedSrc.isJustified = false; }
        recomputeAndRefresh();
        toast('Justification removed.', 'success');
      });

      wireRhsClicks();
      return;
    }

    const dstItems    = getAllItems(dstId, item, systems, itemCache);
    const alreadyLinked = new Set(existing[dstId] || []);

    rightEl.innerHTML = `
      <div class="tdb-panel-section">
        <div class="tdb-panel-section-hdr">
          <span class="tdb-panel-dir">Link <code>${esc(srcIt.code)}</code> → ${esc(dstNode.label)}</span>
        </div>
        <div class="tdb-rhs-search-wrap">
          <input class="col-filter-inp tdb-rhs-search" id="tdb-rhs-search" placeholder="🔍 Search…" autocomplete="off"/>
        </div>
        <div class="tdb-rhs-list" id="tdb-rhs-list">
          ${buildRhsItems(dstItems, alreadyLinked)}
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border)">
          <div class="tdb-panel-section-hdr" style="margin-bottom:6px">
            <span class="tdb-panel-dir" style="color:var(--color-text-muted)">Or justify — no link needed</span>
          </div>
          <textarea id="tdb-just-inp" class="form-input form-textarea" rows="2"
            style="font-size:12px;resize:vertical"
            placeholder="Reason why this item does not need to be linked…"></textarea>
          <button class="btn btn-secondary btn-sm" id="tdb-just-btn" style="margin-top:6px">✔ Justify (no link needed)</button>
        </div>
      </div>`;

    document.getElementById('tdb-just-btn')?.addEventListener('click', async () => {
      const reason = document.getElementById('tdb-just-inp')?.value.trim();
      if (!reason) { document.getElementById('tdb-just-inp')?.focus(); return; }
      await saveJustification(srcIt, dstId, reason, selectedSrc.srcNode, item, systems, itemCache);
      const updated = getAllItems(selectedSrc.srcId, item, systems, itemCache).find(i => i.code === srcIt.code);
      if (updated) { selectedSrc.item = updated; selectedSrc.isJustified = true; }
      recomputeAndRefresh();
      toast(`Justified: ${srcIt.code} — no link to ${dstNode.label}`, 'success');
    });

    document.getElementById('tdb-rhs-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = dstItems.filter(it =>
        it.code.toLowerCase().includes(q) || (it.label||'').toLowerCase().includes(q)
      );
      document.getElementById('tdb-rhs-list').innerHTML = buildRhsItems(filtered, alreadyLinked);
      wireRhsClicks();
    });
    wireRhsClicks();
  }

  function buildRhsLinkList(dstId, srcIt) {
    const dstItems    = getAllItems(dstId, item, systems, itemCache);
    const alreadyLinked = new Set((srcIt.traceability || {})[dstId] || []);
    return `
      <div class="tdb-rhs-search-wrap">
        <input class="col-filter-inp tdb-rhs-search" id="tdb-rhs-search" placeholder="🔍 Search…" autocomplete="off"/>
      </div>
      <div class="tdb-rhs-list" id="tdb-rhs-list">${buildRhsItems(dstItems, alreadyLinked)}</div>`;
  }

  function buildRhsItems(items, alreadyLinked) {
    if (!items.length) return `<div class="tdb-panel-empty"><p>No items found.</p></div>`;
    return items.map(it => {
      const linked = alreadyLinked.has(it.code);
      return `<div class="tdb-panel-item ${linked?'tdb-panel-item--linked':'tdb-panel-item--available'}"
                   data-code="${esc(it.code)}">
        <code class="tdb-panel-code">${esc(it.code)}</code>
        <span class="tdb-panel-label">${esc((it.label||'').slice(0,60))}</span>
        ${linked
          ? `<span class="tdb-panel-linked-badge">✓ linked</span>`
          : `<button class="btn btn-primary btn-xs tdb-rhs-link-btn" data-code="${esc(it.code)}">＋ Link</button>`}
      </div>`;
    }).join('');
  }

  function wireLeftClicks() {
    leftEl.querySelectorAll('.tdb-panel-item--missing, .tdb-panel-item--justified, .tdb-panel-item--selected').forEach(el => {
      el.addEventListener('click', () => {
        const srcId      = el.dataset.src, dstId = el.dataset.dst;
        const srcNode    = nodeMap[srcId],  dstNode = nodeMap[dstId];
        const isJustified = el.dataset.justified === '1';
        const allItems   = getAllItems(srcId, item, systems, itemCache);
        const it = allItems.find(i => i.code === el.dataset.code);
        if (!it) return;
        if (isJustified) it._justification = it.traceability?._justifications?.[dstId];
        selectedSrc = { item: it, srcId, dstId, srcNode, dstNode, isJustified };
        leftEl.querySelectorAll('.tdb-panel-item').forEach(x => x.classList.remove('tdb-panel-item--selected'));
        el.classList.add('tdb-panel-item--selected');
        buildRightCol();
      });
    });
  }

  function wireRhsClicks() {
    rightEl.querySelectorAll('.tdb-rhs-link-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!selectedSrc) return;
        const dstCode = btn.dataset.code;
        const { item: srcIt, srcId, dstId, srcNode } = selectedSrc;
        btn.disabled = true; btn.textContent = '…';

        const ok = await saveLink(srcIt, srcId, dstId, dstCode, srcNode, item, systems, itemCache);
        if (!ok) { btn.disabled = false; btn.textContent = '＋ Link'; return; }
        toast(`Linked ${srcIt.code} → ${dstCode}`, 'success');

        const node = nodeMap[srcId];
        for (const { parentType, parentId } of getParents(node, item, systems)) {
          itemCache[`${srcId}:${parentId}`] = await fetchNodeItems(node, parentType, parentId);
        }
        const updated = getAllItems(srcId, item, systems, itemCache).find(i => i.code === srcIt.code);
        if (updated) selectedSrc.item = updated;
        recomputeAndRefresh();
      });
    });
  }

  function recomputeAndRefresh() {
    ls.forward  = computeLinkCov(ls.link.from, ls.link.to,   ls.fromNode, item, systems, itemCache);
    ls.backward = computeLinkCov(ls.link.to,   ls.link.from, ls.toNode,   item, systems, itemCache);
    buildCols();
    onLinkSaved?.();
  }

  buildCols();
}

async function saveJustification(srcItem, dstNodeId, reason, srcNode, item, systems, itemCache) {
  const existing = srcItem.traceability || {};
  const justs    = { ...(existing._justifications || {}) };
  justs[dstNodeId] = { reason, date: new Date().toISOString(), user: (await sb.auth.getUser()).data.user?.email || '' };
  const updated  = { ...existing, _justifications: justs };

  const table = PHASE_DB_SOURCE[srcNode.phase];
  const idCol  = table === 'requirements' ? 'req_code' : table === 'arch_spec_items' ? 'spec_code' : 'test_code';
  const { error } = await sb.from(table).update({ traceability: updated }).eq(idCol, srcItem.code);
  if (error) { toast('Error saving justification: ' + error.message, 'error'); return false; }

  srcItem.traceability = updated;
  for (const { parentId } of getParents(srcNode, item, systems)) {
    const cached = itemCache[`${srcNode.id}:${parentId}`];
    if (cached) {
      const idx = cached.findIndex(i => i.code === srcItem.code);
      if (idx >= 0) cached[idx].traceability = updated;
    }
  }
  return true;
}

async function removeJustification(srcItem, dstNodeId, srcNode, item, systems, itemCache) {
  const existing = srcItem.traceability || {};
  const justs    = { ...(existing._justifications || {}) };
  delete justs[dstNodeId];
  const updated  = { ...existing, _justifications: Object.keys(justs).length ? justs : undefined };
  if (!updated._justifications) delete updated._justifications;

  const table = PHASE_DB_SOURCE[srcNode.phase];
  const idCol  = table === 'requirements' ? 'req_code' : table === 'arch_spec_items' ? 'spec_code' : 'test_code';
  const { error } = await sb.from(table).update({ traceability: updated }).eq(idCol, srcItem.code);
  if (error) { toast('Error removing justification: ' + error.message, 'error'); return false; }

  srcItem.traceability = updated;
  for (const { parentId } of getParents(srcNode, item, systems)) {
    const cached = itemCache[`${srcNode.id}:${parentId}`];
    if (cached) {
      const idx = cached.findIndex(i => i.code === srcItem.code);
      if (idx >= 0) cached[idx].traceability = updated;
    }
  }
  return true;
}

function _tableAndIdCol(node) {
  const table = PHASE_DB_SOURCE[node.phase];
  const idCol = table === 'requirements' ? 'req_code' : table === 'arch_spec_items' ? 'spec_code' : 'test_code';
  return { table, idCol };
}

async function saveLink(srcItem, srcNodeId, dstNodeId, dstCode, srcNode, item, systems, itemCache) {
  // ── Forward: srcItem → dstCode ──────────────────────────────────────────
  const existing = srcItem.traceability || {};
  const current  = Array.isArray(existing[dstNodeId]) ? existing[dstNodeId] : [];
  if (!current.includes(dstCode)) {
    const updated = { ...existing, [dstNodeId]: [...current, dstCode] };
    const { table, idCol } = _tableAndIdCol(srcNode);
    const { error } = await sb.from(table).update({ traceability: updated }).eq(idCol, srcItem.code);
    if (error) { toast('Error saving link: ' + error.message, 'error'); return false; }
    srcItem.traceability = updated;
    // Update cache
    for (const { parentId } of getParents(srcNode, item, systems)) {
      const cached = itemCache[`${srcNodeId}:${parentId}`];
      if (cached) { const idx = cached.findIndex(i => i.code === srcItem.code); if (idx >= 0) cached[idx].traceability = updated; }
    }
  }

  // ── Reverse: dstItem → srcItem.code ────────────────────────────────────
  const dstNode = VMODEL_NODES.find(n => n.id === dstNodeId);
  if (dstNode) {
    const dstItems = getAllItems(dstNodeId, item, systems, itemCache);
    const dstItem  = dstItems.find(i => i.code === dstCode);
    if (dstItem) {
      const dstExisting = dstItem.traceability || {};
      const dstCurrent  = Array.isArray(dstExisting[srcNodeId]) ? dstExisting[srcNodeId] : [];
      if (!dstCurrent.includes(srcItem.code)) {
        const dstUpdated = { ...dstExisting, [srcNodeId]: [...dstCurrent, srcItem.code] };
        const { table, idCol } = _tableAndIdCol(dstNode);
        const { error } = await sb.from(table).update({ traceability: dstUpdated }).eq(idCol, dstCode);
        if (error) { toast('Error saving reverse link: ' + error.message, 'error'); return false; }
        dstItem.traceability = dstUpdated;
        // Update cache
        for (const { parentId } of getParents(dstNode, item, systems)) {
          const cached = itemCache[`${dstNodeId}:${parentId}`];
          if (cached) { const idx = cached.findIndex(i => i.code === dstCode); if (idx >= 0) cached[idx].traceability = dstUpdated; }
        }
      }
    }
  }

  return true;
}

async function unlinkItems(srcCode, srcNodeId, dstCode, dstNodeId, item, systems, itemCache) {
  const srcNode = VMODEL_NODES.find(n => n.id === srcNodeId);
  const dstNode = VMODEL_NODES.find(n => n.id === dstNodeId);

  async function removeSide(code, nodeId, node, otherCode, otherNodeId) {
    if (!node) return true;
    const allItems = getAllItems(nodeId, item, systems, itemCache);
    const it = allItems.find(i => i.code === code);
    if (!it) return true;
    const existing = it.traceability || {};
    const current  = Array.isArray(existing[otherNodeId]) ? existing[otherNodeId] : [];
    if (!current.includes(otherCode)) return true;  // already gone
    const updated = { ...existing, [otherNodeId]: current.filter(c => c !== otherCode) };
    if (!updated[otherNodeId].length) delete updated[otherNodeId];
    const { table, idCol } = _tableAndIdCol(node);
    const { error } = await sb.from(table).update({ traceability: updated }).eq(idCol, code);
    if (error) { toast('Error removing link: ' + error.message, 'error'); return false; }
    it.traceability = updated;
    for (const { parentId } of getParents(node, item, systems)) {
      const cached = itemCache[`${nodeId}:${parentId}`];
      if (cached) { const idx = cached.findIndex(i => i.code === code); if (idx >= 0) cached[idx].traceability = updated; }
    }
    return true;
  }

  const ok1 = await removeSide(srcCode, srcNodeId, srcNode, dstCode, dstNodeId);
  const ok2 = await removeSide(dstCode, dstNodeId, dstNode, srcCode, srcNodeId);
  return ok1 && ok2;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

const SUB_DOMAINS = new Set(['sw', 'hw', 'mech']);

function getParents(node, item, systems) {
  if (node.domain === 'item') return [{ parentType:'item', parentId: item?.id }];
  const activeSystems = SUB_DOMAINS.has(node.domain)
    ? systems.filter(s => !_hiddenDomains[s.id]?.has(node.domain))
    : systems;
  return activeSystems.length ? activeSystems.map(s => ({ parentType:'system', parentId: s.id })) : [];
}

function getAllItems(nodeId, item, systems, itemCache) {
  const node = VMODEL_NODES.find(n => n.id === nodeId);
  if (!node) return [];
  return getParents(node, item, systems).flatMap(({ parentId }) => itemCache[`${nodeId}:${parentId}`] || []);
}

function computeLinkCov(srcNodeId, dstNodeId, srcNode, item, systems, itemCache) {
  let total = 0, linked = 0;
  const missingItems = [], justifiedItems = [], linkedItems = [];
  for (const { parentId } of getParents(srcNode, item, systems)) {
    for (const it of (itemCache[`${srcNodeId}:${parentId}`] || [])) {
      total++;
      const t    = it.traceability || {};
      const just = t._justifications?.[dstNodeId];
      if (Array.isArray(t[dstNodeId]) && t[dstNodeId].length > 0) {
        linked++;
        linkedItems.push({ ...it, _linkedCodes: t[dstNodeId] });
      } else if (just) {
        linked++;
        justifiedItems.push({ ...it, _justification: just });
      } else {
        missingItems.push(it);
      }
    }
  }
  return { total, linked, missing: missingItems.length, missingItems, justifiedItems, linkedItems };
}

async function fetchNodeItems(node, parentType, parentId) {
  if (!parentId) return [];
  const table = PHASE_DB_SOURCE[node.phase];
  if (!table) return [];
  try {
    if (table === 'requirements') {
      const { data } = await sb.from('requirements')
        .select('req_code,title,traceability')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain).not('type','in','("title","info")');
      return (data||[]).map(r=>({ code:r.req_code, label:r.title||'', traceability:r.traceability||{} }));
    } else if (table === 'arch_spec_items') {
      const { data } = await sb.from('arch_spec_items')
        .select('spec_code,title,traceability')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain).neq('type','section');
      return (data||[]).map(r=>({ code:r.spec_code, label:r.title||'', traceability:r.traceability||{} }));
    } else if (table === 'test_specs') {
      const { data } = await sb.from('test_specs')
        .select('test_code,name,traceability')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .eq('domain', node.domain).eq('phase', node.phase);
      return (data||[]).map(r=>({ code:r.test_code, label:r.name||'', traceability:r.traceability||{} }));
    }
  } catch {}
  return [];
}

// ── Table ─────────────────────────────────────────────────────────────────────

const DCS = {
  system:'background:#e8f0fe;border-color:#4285f4;color:#1a56db',
  sw:    'background:#e6f4ea;border-color:#34a853;color:#1e7e34',
  hw:    'background:#fce8e6;border-color:#ea4335;color:#c62828',
  mech:  'background:#fff8e1;border-color:#fbbc04;color:#b45309',
  item:  'background:#f3e8fd;border-color:#9c27b0;color:#6a1b9a',
};
function nodeChip(n) { return `<span class="tdb-node-chip" style="${DCS[n?.domain]||DCS.system}">${esc(n?.label||'—')}</span>`; }
function pctBadge(l,t) {
  if(!t) return `<span class="tdb-badge tdb-badge--na">N/A</span>`;
  const p=Math.round(l/t*100), cls=p===100?'ok':p>=50?'warn':'low';
  return `<span class="tdb-badge tdb-badge--${cls}">${p}%</span>`;
}

function buildLinkTableRows(linkStats, scope = '') {
  if (!linkStats.length) return `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-muted)">No data.</td></tr>`;
  return linkStats.flatMap(ls =>
    [['→',ls.forward,ls.fromNode,ls.toNode],['←',ls.backward,ls.toNode,ls.fromNode]]
    .map(([dir,cov,src,dst]) => {
      const lid = `${scope}__${src.id}__${dst.id}__${dir==='→'?'fwd':'bwd'}`;
      return `
        <tr>
          <td>${nodeChip(src)}</td><td style="text-align:center;color:var(--color-text-muted)">${dir}</td>
          <td>${nodeChip(dst)}</td>
          <td style="text-align:center">${cov.total}</td>
          <td style="text-align:center;color:#34a853;font-weight:600">${cov.linked}</td>
          <td style="text-align:center;color:#ea4335">${cov.missing}</td>
          <td style="text-align:center">${pctBadge(cov.linked,cov.total)}</td>
          <td>${cov.missing>0
            ?`<button class="btn btn-ghost btn-xs tdb-toggle-missing" data-lid="${esc(lid)}">Show ${cov.missing} missing</button>`
            :`<span style="color:#34a853;font-size:11px">✓ Complete</span>`}</td>
        </tr>
        <tr class="tdb-missing-row" id="tdb-miss-${esc(lid)}" style="display:none">
          <td colspan="8"><div class="tdb-missing-list">${
            cov.missingItems.map(it=>`<span class="tdb-missing-item"><code style="font-size:11px">${esc(it.code)}</code><span style="font-size:11px;color:var(--color-text-muted)">${esc((it.label||'').slice(0,60))}</span></span>`).join('')
          }</div></td>
        </tr>`;
    })
  ).join('');
}

function wireTableMissing(container, linkStats, scope = '') {
  container.querySelectorAll('.tdb-toggle-missing').forEach(btn => {
    btn.addEventListener('click', () => {
      const row  = document.getElementById(`tdb-miss-${btn.dataset.lid}`);
      if (!row) return;
      const open = row.style.display !== 'none';
      row.style.display = open ? 'none' : 'table-row';
      btn.textContent   = open ? `Show ${btn.textContent.match(/\d+/)?.[0]||''} missing` : 'Hide';
    });
  });
}

function _pctColor(p) {
  return p===null?'#9aa0a6':p===100?'#34a853':p>=50?'#b45309':'#ea4335';
}

// ── PDF Export ────────────────────────────────────────────────────────────────

function exportTraceabilityPDF(project, item, systems, linkStats, badgeOffsets, traceLinks, activeIds, posMap, nodeMap) {
  const date   = new Date().toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' });
  const lsMap  = {};
  for (const ls of linkStats) lsMap[`${ls.link.from}__${ls.link.to}`] = ls;
  const svgStr = buildVmodelSVG(traceLinks, activeIds, posMap, nodeMap, lsMap, badgeOffsets);

  let totalItems = 0, totalLinked = 0;
  for (const ls of linkStats) {
    for (const cov of [ls.forward, ls.backward]) {
      totalItems  += cov.total;
      totalLinked += cov.linked;
    }
  }
  const overallPct = totalItems ? Math.round(totalLinked / totalItems * 100) : 0;
  const overallColor = overallPct === 100 ? '#1e7e34' : overallPct >= 70 ? '#b45309' : '#c62828';

  const linkRows = linkStats.flatMap(ls =>
    [['→', ls.forward, ls.fromNode, ls.toNode],
     ['←', ls.backward, ls.toNode,  ls.fromNode]]
    .map(([dir, cov, src, dst]) => {
      const pct   = cov.total ? Math.round(cov.linked / cov.total * 100) : 0;
      const color = pct === 100 ? '#1e7e34' : pct >= 70 ? '#b45309' : '#c62828';
      const statusIcon = pct === 100 ? '✓' : pct === 0 ? '✗' : '◑';

      const linkedSubhead = cov.linkedItems.length > 0
        ? `<tr class="detail-subhead"><td colspan="8" class="subhead linked-subhead">✓ Linked (${cov.linkedItems.length})</td></tr>`
        : '';
      const linkedRows = cov.linkedItems.map(it => {
        const codes = (it._linkedCodes || []).map(c => `<code class="link-code">${esc(c)}</code>`).join(' ');
        return `<tr class="detail-row linked-row">
          <td class="detail-code">${esc(it.code)}</td>
          <td colspan="6" class="detail-label">
            <span class="linked-to-codes">→ ${codes}</span>
          </td>
          <td class="detail-status linked-status">Linked</td>
        </tr>`;
      }).join('');

      const missingSubhead = cov.missingItems.length > 0
        ? `<tr class="detail-subhead"><td colspan="8" class="subhead missing-subhead">✗ Missing (${cov.missingItems.length})</td></tr>`
        : '';
      const missingRows = cov.missingItems.map(it =>
        `<tr class="detail-row missing-row">
          <td class="detail-code">${esc(it.code)}</td>
          <td colspan="6" class="detail-label">${esc(it.label||'—')}</td>
          <td class="detail-status missing">Missing</td>
        </tr>`).join('');

      const justSubhead = cov.justifiedItems.length > 0
        ? `<tr class="detail-subhead"><td colspan="8" class="subhead just-subhead">◎ Justified (${cov.justifiedItems.length})</td></tr>`
        : '';
      const justRows = cov.justifiedItems.map(it => {
        const j = it._justification || {};
        const justBy   = j.user  ? `by ${esc(j.user)}`  : '';
        const justDate = j.date  ? ` on ${esc(j.date)}`  : '';
        return `<tr class="detail-row justified-row">
          <td class="detail-code">${esc(it.code)}</td>
          <td colspan="6" class="detail-label">
            <span class="item-label">${esc(it.label||'—')}</span>
            ${j.reason
              ? `<span class="just-reason"><strong>Justification:</strong> ${esc(j.reason)}<span class="just-meta">${justBy}${justDate}</span></span>`
              : '<span class="just-reason just-no-reason">No justification text provided</span>'}
          </td>
          <td class="detail-status justified">Justified</td>
        </tr>`;
      }).join('');

      return `
        <tr class="link-row">
          <td class="node-chip src">${esc(src.label)}</td>
          <td class="dir">${dir}</td>
          <td class="node-chip dst">${esc(dst.label)}</td>
          <td class="num">${cov.total}</td>
          <td class="num linked">${cov.linked}</td>
          <td class="num missing-num">${cov.missing}</td>
          <td class="num justified-num">${cov.justifiedItems.length}</td>
          <td class="pct"><span class="pct-badge" style="background:${color}15;color:${color};border-color:${color}40">${statusIcon} ${pct}%</span></td>
        </tr>
        ${linkedSubhead}${linkedRows}${missingSubhead}${missingRows}${justSubhead}${justRows}`;
    })
  ).join('');

  const systemsInfo = systems.length
    ? systems.map(s => `<span class="sys-chip">${esc(s.name||s.id)}</span>`).join(' ')
    : '<span style="color:#666">—</span>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Traceability Report — ${esc(item?.name||item?.id||'')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; padding: 32px 40px; }
  .rpt-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a56db; padding-bottom: 14px; margin-bottom: 24px; }
  .rpt-title { font-size: 20px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .rpt-subtitle { font-size: 12px; color: #555; }
  .rpt-meta { text-align: right; font-size: 10px; color: #666; line-height: 1.7; }
  .rpt-meta strong { color: #333; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 13px; font-weight: 700; color: #1a56db; border-bottom: 1px solid #d0d9f0; padding-bottom: 5px; margin-bottom: 12px; letter-spacing: .4px; text-transform: uppercase; }
  .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
  .kpi { flex: 1; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 16px; text-align: center; }
  .kpi-value { font-size: 24px; font-weight: 700; line-height: 1; }
  .kpi-label { font-size: 10px; color: #666; margin-top: 4px; text-transform: uppercase; letter-spacing: .4px; }
  .diagram-wrap { border: 1px solid #dde; border-radius: 8px; padding: 12px; background: #fafbff; margin-bottom: 28px; }
  .diagram-wrap svg { width: 100%; height: auto; display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { background: #f0f4ff; color: #1a56db; font-weight: 700; padding: 7px 10px; text-align: left; border-bottom: 2px solid #d0d9f0; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
  td { padding: 6px 10px; border-bottom: 1px solid #eef0f5; vertical-align: top; }
  .link-row td { background: #fff; }
  .link-row:hover td { background: #f5f8ff; }
  .node-chip { font-weight: 600; font-size: 10px; white-space: nowrap; }
  .node-chip.src { color: #1a56db; }
  .node-chip.dst { color: #1a56db; }
  .dir { text-align: center; color: #888; font-size: 13px; width: 24px; }
  .num { text-align: center; width: 52px; }
  .num.linked { color: #1e7e34; font-weight: 600; }
  .num.missing-num { color: #c62828; }
  .num.justified-num { color: #b45309; }
  .pct { text-align: center; white-space: nowrap; width: 72px; }
  .pct-badge { display: inline-block; padding: 2px 7px; border-radius: 10px; border: 1px solid; font-weight: 700; font-size: 10px; }
  .detail-row td { font-size: 10px; padding: 4px 10px 4px 28px; border-bottom: 1px solid #f0f0f0; }
  .missing-row td { background: #fff8f8; }
  .justified-row td { background: #f6fff8; }
  .detail-code { font-family: monospace; color: #333; width: 100px; white-space: nowrap; }
  .detail-label { color: #444; }
  .detail-status { font-size: 9px; font-weight: 700; white-space: nowrap; text-align: center; width: 64px; }
  .detail-status.missing { color: #c62828; }
  .detail-status.justified { color: #1e7e34; }
  .item-label { display: block; }
  .just-reason { display: block; margin-top: 3px; font-size: 10px; color: #444; line-height: 1.5; }
  .just-reason strong { color: #1e7e34; }
  .just-meta { margin-left: 6px; color: #888; font-style: italic; }
  .just-no-reason { color: #aaa; font-style: italic; }
  .detail-subhead td { padding: 5px 10px 3px 16px; font-size: 9.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; border-bottom: none; }
  .linked-subhead { color: #1e7e34; background: #f0fff4; }
  .missing-subhead { color: #c62828; background: #fff8f8; }
  .just-subhead { color: #b45309; background: #fffbf0; }
  .linked-row td { background: #f6fff8; }
  .linked-status { color: #1e7e34; font-size: 9px; font-weight: 700; text-align: center; }
  .linked-to-codes { display: block; margin-top: 3px; font-size: 10px; color: #1a56db; }
  .link-code { font-family: monospace; background: #e8f0fe; border-radius: 3px; padding: 1px 5px; margin-right: 3px; font-size: 9.5px; color: #1a56db; }
  .sys-chip { display: inline-block; background: #f0f4ff; border: 1px solid #c5d0f0; border-radius: 4px; padding: 2px 8px; font-size: 10px; color: #1a56db; margin-right: 4px; }
  .rpt-footer { margin-top: 32px; border-top: 1px solid #dde; padding-top: 10px; font-size: 9px; color: #aaa; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 12px 16px; }
    @page { size: A4 landscape; margin: 12mm 14mm; }
    .section { page-break-inside: avoid; }
    .diagram-wrap { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="rpt-header">
  <div>
    <div class="rpt-title">Traceability Report</div>
    <div class="rpt-subtitle">${esc(item?.name||item?.id||'')}</div>
  </div>
  <div class="rpt-meta">
    <div><strong>Date:</strong> ${date}</div>
    <div><strong>Project:</strong> ${esc(project?.name||project?.id||'')}</div>
    <div><strong>Item:</strong> ${esc(item?.name||item?.id||'')}</div>
    <div><strong>Systems:</strong> ${systemsInfo}</div>
  </div>
</div>

<div class="kpi-row">
  <div class="kpi">
    <div class="kpi-value" style="color:${overallColor}">${overallPct}%</div>
    <div class="kpi-label">Overall Coverage</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:#1a56db">${linkStats.length}</div>
    <div class="kpi-label">Trace Links</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:#1e7e34">${totalLinked}</div>
    <div class="kpi-label">Items Linked</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:#c62828">${totalItems - totalLinked}</div>
    <div class="kpi-label">Items Missing</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:#b45309">${linkStats.reduce((a,ls)=>a+ls.forward.justifiedItems.length+ls.backward.justifiedItems.length,0)}</div>
    <div class="kpi-label">Justified</div>
  </div>
</div>

<div class="section">
  <div class="section-title">V-Model Traceability Diagram</div>
  <div class="diagram-wrap">${svgStr}</div>
</div>

<div class="section">
  <div class="section-title">Coverage Detail by Trace Link</div>
  <table>
    <thead>
      <tr>
        <th>From</th><th></th><th>To</th>
        <th style="text-align:center">Total</th>
        <th style="text-align:center">Linked</th>
        <th style="text-align:center">Missing</th>
        <th style="text-align:center">Justified</th>
        <th style="text-align:center">Coverage</th>
      </tr>
    </thead>
    <tbody>${linkRows}</tbody>
  </table>
</div>

<div class="rpt-footer">
  <span>Safety PLM — Traceability Report</span>
  <span>Generated ${date}</span>
</div>

<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked — please allow pop-ups and try again.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}
