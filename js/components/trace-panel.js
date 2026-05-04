/**
 * Reusable traceability panel.
 *
 * Usage:
 *   const tp = createTracePanel({ sb, vmodelLinks, nodeId, item, system, project,
 *                                  table, getCode, getTitle, getData,
 *                                  panelEl, panelBodyEl, rowActiveClass, onBadgeRefresh });
 *   await tp.loadSourceData();
 *   tp.openPanel(artifactId);
 */

import { VMODEL_NODES, PHASE_DB_SOURCE } from './vmodel-editor.js';
import { toast } from '../toast.js';

export function createTracePanel({
  sb,
  vmodelLinks,
  nodeId,        // V-model node id for the current artifact type (e.g. 'sw_impl')
  item,
  system,
  project,
  table,         // DB table name for this artifact type (e.g. 'sw_units')
  getCode,       // (artifact) => string code
  getTitle,      // (artifact) => string title
  getData,       // () => current artifact array
  panelEl,       // the aside.req-trace-panel element
  panelBodyEl,   // the .req-trace-panel-body element
  rowSelector,   // selector for artifact rows, e.g. 'tr[data-id]'
  rowActiveClass,// CSS class to mark active trace row
  onBadgeRefresh,// optional (id) => void — called after link change
}) {
  let _openId     = null;
  let _fields     = [];   // [{ id, label, source, node }]
  let _sourceData = {};   // { [fieldId]: [{code, label}] }

  // ── Derive trace fields from V-model links ──────────────────────────────────
  function deriveFields() {
    if (!nodeId || !vmodelLinks.length) { _fields = []; return; }
    _fields = [];
    for (const link of vmodelLinks) {
      if (link.type && link.type !== 'trace') continue;
      const otherId = link.from === nodeId ? link.to : link.to === nodeId ? link.from : null;
      if (!otherId) continue;
      const node = VMODEL_NODES.find(n => n.id === otherId);
      if (!node) continue;
      const source = PHASE_DB_SOURCE[node.phase] || 'free_text';
      _fields.push({ id: otherId, label: node.label, source, node });
    }
  }

  // ── Load candidate items for each linked node ───────────────────────────────
  async function loadSourceData() {
    deriveFields();
    for (const field of _fields) {
      if (_sourceData[field.id]) continue;
      const node = field.node;
      const isItemDomain = node.domain === 'item';
      const parentType   = isItemDomain ? 'item' : 'system';
      const parentId     = isItemDomain ? item?.id : system?.id;
      if (!parentId) { _sourceData[field.id] = []; continue; }

      const dbSource = PHASE_DB_SOURCE[node.phase];

      if (dbSource === 'requirements') {
        const { data } = await sb.from('requirements').select('req_code, title')
          .eq('parent_type', parentType).eq('parent_id', parentId)
          .eq('domain', node.domain).not('type', 'in', '("title","info")')
          .order('sort_order', { ascending: true });
        _sourceData[field.id] = (data || []).map(r => ({ code: r.req_code, label: r.title || '' }));

      } else if (dbSource === 'arch_spec_items') {
        const { data } = await sb.from('arch_spec_items').select('spec_code, title')
          .eq('parent_type', parentType).eq('parent_id', parentId)
          .eq('domain', node.domain).neq('type', 'section')
          .order('sort_order', { ascending: true });
        _sourceData[field.id] = (data || []).map(r => ({ code: r.spec_code || r.id, label: r.title || '' }));

      } else if (dbSource === 'test_specs') {
        const { data } = await sb.from('test_specs').select('test_code, name')
          .eq('parent_type', parentType).eq('parent_id', parentId)
          .eq('domain', node.domain).eq('phase', node.phase)
          .order('sort_order', { ascending: true });
        _sourceData[field.id] = (data || []).map(r => ({ code: r.test_code, label: r.name || '' }));

      } else if (dbSource === 'sw_units') {
        const { data } = await sb.from('sw_units').select('unit_code, name')
          .eq('parent_type', parentType).eq('parent_id', parentId)
          .order('sort_order', { ascending: true });
        _sourceData[field.id] = (data || []).map(r => ({ code: r.unit_code, label: r.name || '' }));

      } else {
        _sourceData[field.id] = [];
      }
    }
  }

  // ── Reverse links ───────────────────────────────────────────────────────────
  async function loadReverseLinks(itemCode) {
    const result = {};
    if (!itemCode) return result;
    for (const field of _fields) {
      const node = field.node;
      if (!node) { result[field.id] = []; continue; }
      const isItemDomain = node.domain === 'item';
      const parentType   = isItemDomain ? 'item' : 'system';
      const parentId     = isItemDomain ? item?.id : system?.id;
      if (!parentId) { result[field.id] = []; continue; }

      const dbSource = PHASE_DB_SOURCE[node.phase];
      let rows = [];

      if (dbSource === 'requirements') {
        const { data } = await sb.from('requirements').select('req_code, title, traceability')
          .eq('parent_type', parentType).eq('parent_id', parentId).eq('domain', node.domain)
          .not('type', 'in', '("title","info")');
        rows = (data || []).filter(r => Array.isArray(r.traceability?.[nodeId]) && r.traceability[nodeId].includes(itemCode))
          .map(r => ({ code: r.req_code, label: r.title || '' }));

      } else if (dbSource === 'arch_spec_items') {
        const { data } = await sb.from('arch_spec_items').select('spec_code, title, traceability')
          .eq('parent_type', parentType).eq('parent_id', parentId).eq('domain', node.domain).neq('type', 'section');
        rows = (data || []).filter(r => Array.isArray(r.traceability?.[nodeId]) && r.traceability[nodeId].includes(itemCode))
          .map(r => ({ code: r.spec_code || r.id, label: r.title || '' }));

      } else if (dbSource === 'test_specs') {
        const { data } = await sb.from('test_specs').select('test_code, name, traceability')
          .eq('parent_type', parentType).eq('parent_id', parentId).eq('domain', node.domain).eq('phase', node.phase);
        rows = (data || []).filter(r => Array.isArray(r.traceability?.[nodeId]) && r.traceability[nodeId].includes(itemCode))
          .map(r => ({ code: r.test_code, label: r.name || '' }));

      } else if (dbSource === 'sw_units') {
        const { data } = await sb.from('sw_units').select('unit_code, name, traceability')
          .eq('parent_type', parentType).eq('parent_id', parentId);
        rows = (data || []).filter(r => Array.isArray(r.traceability?.[nodeId]) && r.traceability[nodeId].includes(itemCode))
          .map(r => ({ code: r.unit_code, label: r.name || '' }));
      }

      result[field.id] = rows;
    }
    return result;
  }

  // ── HTML builders ───────────────────────────────────────────────────────────
  const nodeIcon = { system: '⬡', sw: '◧', hw: '◨', mech: '◎', item: '⬡' };

  function buildNodeCardHTML({ field, linked, revLinked }, arrowDir) {
    const node       = field.node;
    const options    = _sourceData[field.id] || [];
    const icon       = nodeIcon[node.domain] || '◈';
    const totalLinks = linked.length + revLinked.length;
    const fieldId    = field.id;
    const hasMany    = totalLinks > 3;

    const linkedItems = linked.map(code => {
      const opt = options.find(o => o.code === code);
      return `<div class="rtrace-item rtrace-item--linked" data-code="${esc(code)}" data-field="${fieldId}">
        <div class="rtrace-item-main rtrace-item-expandable" data-code="${esc(code)}" data-field="${fieldId}" title="Click to expand">
          <span class="rtrace-item-code">${esc(code)}</span>
          <span class="rtrace-item-label">${esc((opt?.label || '').slice(0, 46))}</span>
          <span class="rtrace-item-chevron">▶</span>
        </div>
        <div class="rtrace-item-detail" id="rtrace-detail-${esc(code)}" style="display:none"></div>
        <button class="rtrace-unlink" data-code="${esc(code)}" data-field="${fieldId}" title="Remove link">✕</button>
      </div>`;
    }).join('');

    const revItems = revLinked.map(r => `
      <div class="rtrace-item rtrace-item--reverse">
        <div class="rtrace-item-main rtrace-item-expandable" data-code="${esc(r.code)}" data-field="${fieldId}" title="Click to expand">
          <span class="rtrace-item-code">${esc(r.code)}</span>
          <span class="rtrace-item-label">${esc(r.label.slice(0, 46))}</span>
          <span class="rtrace-item-badge">↩</span>
          <span class="rtrace-item-chevron">▶</span>
        </div>
        <div class="rtrace-item-detail" id="rtrace-detail-${esc(r.code)}" style="display:none"></div>
      </div>`).join('');

    const unlinked = options.filter(o => !linked.includes(o.code));

    return `
      <div class="rtrace-node rtrace-node--${arrowDir}">
        <div class="rtrace-node-hdr">
          <span class="rtrace-node-icon">${icon}</span>
          <span class="rtrace-node-name">${esc(field.label)}</span>
          <span class="rtrace-node-count ${totalLinks ? 'has-links' : ''}">${totalLinks}</span>
          <div class="rtrace-hdr-actions">
            ${totalLinks > 0 ? `<button class="rtrace-filter-btn" data-field="${fieldId}" title="Filter">🔍</button>` : ''}
            ${hasMany ? `<button class="rtrace-expand-btn" data-field="${fieldId}" data-expanded="0" title="Expand list">⤢</button>` : ''}
          </div>
        </div>
        <div class="rtrace-node-filter" id="rtrace-filter-${fieldId}" style="display:none">
          <input type="text" class="rtrace-filter-inp" data-field="${fieldId}" placeholder="Filter…" autocomplete="off"/>
        </div>
        <div class="rtrace-node-body" id="rtrace-nbody-${fieldId}">
          ${linkedItems}${revItems}
          ${!linkedItems && !revItems ? `<div class="rtrace-empty">No links yet</div>` : ''}
        </div>
        <div class="rtrace-add-row">
          <div class="rtrace-search-wrap">
            <input type="text" class="rtrace-search-inp" data-field="${fieldId}"
              placeholder="＋ Search to add link…" autocomplete="off"/>
            <div class="rtrace-search-list" id="rtrace-sl-${fieldId}" style="display:none">
              ${unlinked.map(o =>
                `<div class="rtrace-search-opt" data-field="${fieldId}" data-code="${esc(o.code)}" data-label="${esc(o.label)}">
                  <span class="rtrace-search-opt-code">${esc(o.code)}</span>
                  <span class="rtrace-search-opt-label">${esc(o.label.slice(0, 50))}</span>
                </div>`).join('')}
              ${!unlinked.length ? `<div class="rtrace-search-empty">All items linked</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  function buildChainHTML(artifact, upstreamFields, downstreamFields, testFields) {
    const code  = getCode(artifact);
    const title = getTitle(artifact);
    const myNode = VMODEL_NODES.find(n => n.id === nodeId);

    const testColumn = testFields.length
      ? testFields.map(e => buildNodeCardHTML(e, 'right')).join(`<div class="rtrace-v-spacer"></div>`)
      : '';

    const nodeOrder = VMODEL_NODES.map(n => n.id);

    function renderNodeSequence(fields) {
      return fields.map((entry, i) => {
        const isLast = i === fields.length - 1;
        const connector = isLast ? '' : `
          <div class="rtrace-bidir-arrow">
            <span class="rtrace-bidir-up">↑</span>
            <span class="rtrace-bidir-label">${esc(code)} ↔ ${esc(entry.field.label)}</span>
            <span class="rtrace-bidir-down">↓</span>
          </div>`;
        return buildNodeCardHTML(entry, 'down') + connector;
      }).join('');
    }

    const upstreamColumn   = upstreamFields.length   ? renderNodeSequence(upstreamFields)   : '';
    const downstreamColumn = downstreamFields.length ? renderNodeSequence(downstreamFields) : '';

    return `
      <div class="rtrace-v-layout">
        ${upstreamColumn ? `
          <div class="rtrace-dev-chain rtrace-upstream">${upstreamColumn}</div>
          <div class="rtrace-bidir-arrow">
            <span class="rtrace-bidir-up">↑</span>
            <span class="rtrace-bidir-label">${esc(code)} ↔ ${esc(upstreamFields[upstreamFields.length - 1]?.field.label || '')}</span>
            <span class="rtrace-bidir-down">↓</span>
          </div>
        ` : ''}
        <div class="rtrace-top-row">
          <div class="rtrace-top-left">
            <div class="rtrace-current">
              <div class="rtrace-current-icon">${nodeIcon[myNode?.domain] || '◈'}</div>
              <div class="rtrace-current-body">
                <div class="rtrace-current-code">${esc(code)}</div>
                <div class="rtrace-current-title">${esc(title)}</div>
              </div>
            </div>
            ${downstreamFields.length ? `
            <div class="rtrace-bidir-arrow">
              <span class="rtrace-bidir-up">↑</span>
              <span class="rtrace-bidir-label">${esc(code)} ↔ ${esc(downstreamFields[0]?.field.label || '')}</span>
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
        ${downstreamColumn ? `<div class="rtrace-dev-chain">${downstreamColumn}</div>` : ''}
      </div>`;
  }

  // ── Wire panel interactions ─────────────────────────────────────────────────
  function wirePanel(body, artifact) {
    // Expand item detail
    body.querySelectorAll('.rtrace-item-expandable').forEach(el => {
      el.addEventListener('click', async () => {
        const code    = el.dataset.code;
        const fieldId = el.dataset.field;
        const detail  = document.getElementById(`rtrace-detail-${code}`);
        const chevron = el.querySelector('.rtrace-item-chevron');
        if (!detail) return;
        if (detail.style.display !== 'none') {
          detail.style.display = 'none';
          if (chevron) chevron.textContent = '▶';
          return;
        }
        if (chevron) chevron.textContent = '▼';
        detail.style.display = 'block';
        if (detail.dataset.loaded) return;
        detail.innerHTML = '<span style="font-size:11px;color:var(--color-text-muted)">Loading…</span>';
        detail.dataset.loaded = '1';

        const field  = _fields.find(f => f.id === fieldId);
        if (!field) { detail.innerHTML = ''; return; }
        let html = '';
        const src = field.source;

        if (src === 'requirements') {
          const { data } = await sb.from('requirements').select('req_code, title, description, type, priority, status').eq('req_code', code).maybeSingle();
          if (data) html = buildItemDetailHTML({ code: data.req_code, title: data.title, description: data.description, badges: [data.type, data.priority, data.status].filter(Boolean) });
        } else if (src === 'arch_spec_items') {
          const { data } = await sb.from('arch_spec_items').select('spec_code, title, description, type, status').eq('spec_code', code).maybeSingle();
          if (data) html = buildItemDetailHTML({ code: data.spec_code, title: data.title, description: data.description, badges: [data.type, data.status].filter(Boolean) });
        } else if (src === 'test_specs') {
          const { data } = await sb.from('test_specs').select('test_code, name, description, type, status, result').eq('test_code', code).maybeSingle();
          if (data) html = buildItemDetailHTML({ code: data.test_code, title: data.name, description: data.description, badges: [data.type, data.status, data.result].filter(Boolean) });
        } else if (src === 'sw_units') {
          const { data } = await sb.from('sw_units').select('unit_code, name, description, unit_type, status').eq('unit_code', code).maybeSingle();
          if (data) html = buildItemDetailHTML({ code: data.unit_code, title: data.name, description: data.description, badges: [data.unit_type, data.status].filter(Boolean) });
        }
        detail.innerHTML = html || '<span style="font-size:11px;color:var(--color-text-muted)">No details available.</span>';
      });
    });

    // Filter button
    body.querySelectorAll('.rtrace-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = document.getElementById(`rtrace-filter-${btn.dataset.field}`);
        if (!row) return;
        const visible = row.style.display !== 'none';
        row.style.display = visible ? 'none' : 'block';
        if (!visible) row.querySelector('.rtrace-filter-inp')?.focus();
      });
    });

    // Inline filter
    body.querySelectorAll('.rtrace-filter-inp').forEach(inp => {
      inp.addEventListener('input', () => {
        const q     = inp.value.toLowerCase();
        const nbody = document.getElementById(`rtrace-nbody-${inp.dataset.field}`);
        nbody?.querySelectorAll('.rtrace-item').forEach(item => {
          const code  = item.querySelector('.rtrace-item-code')?.textContent.toLowerCase() || '';
          const label = item.querySelector('.rtrace-item-label')?.textContent.toLowerCase() || '';
          item.style.display = (!q || code.includes(q) || label.includes(q)) ? '' : 'none';
        });
      });
    });

    // Expand button
    body.querySelectorAll('.rtrace-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nbody    = document.getElementById(`rtrace-nbody-${btn.dataset.field}`);
        if (!nbody) return;
        const expanded = btn.dataset.expanded === '1';
        nbody.classList.toggle('rtrace-node-body--expanded', !expanded);
        btn.dataset.expanded = expanded ? '0' : '1';
        btn.title       = expanded ? 'Expand list' : 'Collapse list';
        btn.textContent = expanded ? '⤢' : '⤡';
      });
    });

    // Search add-link
    body.querySelectorAll('.rtrace-search-inp').forEach(inp => {
      const fieldId = inp.dataset.field;
      const list    = document.getElementById(`rtrace-sl-${fieldId}`);
      if (!list) return;
      const allOpts = Array.from(list.querySelectorAll('.rtrace-search-opt'));

      inp.addEventListener('focus', () => { list.style.display = 'block'; });
      inp.addEventListener('input', () => {
        const q = inp.value.toLowerCase();
        allOpts.forEach(o => {
          o.style.display = (o.dataset.code.toLowerCase().includes(q) || o.dataset.label.toLowerCase().includes(q)) ? '' : 'none';
        });
      });

      document.addEventListener('mousedown', function hide(e) {
        if (!inp.closest('.rtrace-search-wrap').contains(e.target)) {
          list.style.display = 'none';
          inp.value = '';
          allOpts.forEach(o => o.style.display = '');
          document.removeEventListener('mousedown', hide);
        }
      });

      list.querySelectorAll('.rtrace-search-opt').forEach(opt => {
        opt.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          const code = opt.dataset.code;
          list.style.display = 'none';
          inp.value = '';
          allOpts.forEach(o => o.style.display = '');

          const updated = { ...(artifact.traceability || {}) };
          updated[fieldId] = [...(updated[fieldId] || []), code];
          const { error } = await sb.from(table).update({ traceability: updated }).eq('id', artifact.id);
          if (error) { toast('Error saving link: ' + error.message, 'error'); return; }
          toast(`Linked ${code}`, 'success');
          artifact.traceability = updated;
          const d = getData().find(r => r.id === artifact.id);
          if (d) d.traceability = updated;
          delete _sourceData[fieldId]; // force refresh of dropdown options
          await openPanel(artifact.id, true);
          onBadgeRefresh?.(artifact.id);
        });
      });
    });

    // Remove link
    body.querySelectorAll('.rtrace-unlink').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code    = btn.dataset.code;
        const fieldId = btn.dataset.field;
        const updated = { ...(artifact.traceability || {}) };
        updated[fieldId] = (updated[fieldId] || []).filter(c => c !== code);
        const { error } = await sb.from(table).update({ traceability: updated }).eq('id', artifact.id);
        if (error) { toast('Error removing link: ' + error.message, 'error'); return; }
        toast(`Unlinked ${code}`, 'success');
        artifact.traceability = updated;
        const d = getData().find(r => r.id === artifact.id);
        if (d) d.traceability = updated;
        delete _sourceData[fieldId]; // force refresh of dropdown options
        await openPanel(artifact.id, true);
        onBadgeRefresh?.(artifact.id);
      });
    });
  }

  // ── Public: open/close ───────────────────────────────────────────────────────
  function closePanel() {
    panelEl?.classList.remove('open');
    _openId = null;
    if (rowActiveClass) document.querySelectorAll(`.${rowActiveClass}`).forEach(r => r.classList.remove(rowActiveClass));
  }

  async function openPanel(artifactId, force = false) {
    if (!panelEl || !panelBodyEl) return;
    if (!force && _openId === artifactId) { closePanel(); return; }
    _openId = artifactId;

    if (rowActiveClass) {
      document.querySelectorAll(`.${rowActiveClass}`).forEach(r => r.classList.remove(rowActiveClass));
      document.querySelector(`${rowSelector}[data-id="${artifactId}"]`)?.classList.add(rowActiveClass);
    }

    panelEl.classList.add('open');
    panelBodyEl.innerHTML = '<div class="content-loading"><div class="spinner"></div></div>';

    const artifact = getData().find(a => a.id === artifactId);
    if (!artifact) { panelBodyEl.innerHTML = '<p style="padding:16px">Not found.</p>'; return; }

    await loadSourceData();

    const traceability = artifact.traceability || {};
    const reverseLinks = await loadReverseLinks(getCode(artifact));

    const TEST_PHASES = new Set(['unit_testing', 'integration_testing', 'system_testing']);
    const testFields = [], devFields = [];
    for (const field of _fields) {
      const linked    = traceability[field.id] || [];
      const revLinked = reverseLinks[field.id] || [];
      const entry = { field, linked, revLinked };
      if (TEST_PHASES.has(field.node.phase)) testFields.push(entry);
      else                                   devFields.push(entry);
    }

    const nodeOrder = VMODEL_NODES.map(n => n.id);
    devFields.sort((a, b) => {
      const ai = nodeOrder.indexOf(a.field.id);
      const bi = nodeOrder.indexOf(b.field.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    const myIdx          = nodeOrder.indexOf(nodeId);
    const upstreamFields   = devFields.filter(e => nodeOrder.indexOf(e.field.id) < myIdx);
    const downstreamFields = devFields.filter(e => nodeOrder.indexOf(e.field.id) > myIdx);

    panelBodyEl.innerHTML = `
      <div class="rtrace-chain">
        ${!_fields.length ? `
          <div class="rtrace-no-config">
            <p>No V-Model links configured for this node.</p>
            <p style="margin-top:4px">Go to <strong>Project Settings → V-Model</strong> to define connections.</p>
          </div>` : ''}
        ${buildChainHTML(artifact, upstreamFields, downstreamFields, testFields)}
      </div>`;

    wirePanel(panelBodyEl, artifact);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getFields()     { return _fields; }
  function getSourceData() { return _sourceData; }

  return { openPanel, closePanel, loadSourceData, deriveFields, getFields, getSourceData };
}

// ── Shared HTML helpers ───────────────────────────────────────────────────────
export function buildItemDetailHTML({ code, title, description, badges }) {
  return `
    <div class="rtrace-detail-card">
      ${badges.length ? `<div class="rtrace-detail-badges">${badges.map(b =>
        `<span class="rtrace-detail-badge">${esc(b)}</span>`).join('')}</div>` : ''}
      ${description
        ? `<div class="rtrace-detail-desc">${esc(description)}</div>`
        : `<div class="rtrace-detail-desc rtrace-detail-desc--empty">No description</div>`}
    </div>`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
