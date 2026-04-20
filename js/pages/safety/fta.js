/**
 * FTA — Fault Tree Analysis  (v3)
 *
 * Features:
 *  • Box nodes (code / component / failure) + optional probability / FR / MTTR rows
 *  • IEC 61025 gate shapes
 *  • Multi-select: rubber-band drag on empty canvas; Shift+click to add/remove
 *  • Move: drag any selected node → all selected move together
 *  • Delete: Delete/Backspace key, or toolbar button
 *  • Port-drag connections: hover → green ● at bottom, drag to target
 *  • Pan: Space + drag  |  Zoom: scroll wheel
 *  • Manual colour per node: colour picker in toolbar (applies to selection)
 *  • Config panel: choose which optional fields to show
 */

import { sb } from '../../config.js';
import { toast } from '../../toast.js';
import { exportFTApdf } from '../../utils/export-pdf.js';
import { wireBottomPanel } from '../../utils/bottom-panel.js';

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Node config ────────────────────────────────────────────────────────────────
const ROW_CODE  = 22;   // code row height
const ROW_STD   = 28;   // component row height
const ROW_EXTRA = 22;   // (legacy, kept for reference)
const LINE_H    = 15;   // px per wrapped text line in label row
const BOX_W     = 188;

// Split label text into wrapped lines for the label row
function labelLines(text) {
  if (!text) return [''];
  const maxCh = Math.floor((BOX_W - 16) / 6.2); // ~font-size 11
  const words = text.split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length > maxCh && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const NT = {
  top_event:    { stroke:'#000', sw:3, fill:'#fff', codeColor:'#e8e8e8', indicator:null     },
  intermediate: { stroke:'#000', sw:2, fill:'#fff', codeColor:'#e8e8e8', indicator:null     },
  basic:        { stroke:'#000', sw:2, fill:'#fff', codeColor:'#e8e8e8', indicator:'circle' },
  undeveloped:  { stroke:'#000', sw:2, fill:'#fff', codeColor:'#e8e8e8', indicator:'diamond'},
  transfer:     { stroke:'#000', sw:2, fill:'#fff', codeColor:'#e8e8e8', indicator:'triangle'},
  gate_and:     { label:'AND',     stroke:'#000', sw:2, fill:'#fff', gw:74, gh:62 },
  gate_or:      { label:'OR',      stroke:'#000', sw:2, fill:'#fff', gw:74, gh:62 },
  gate_not:     { label:'NOT',     stroke:'#000', sw:2, fill:'#fff', gw:60, gh:60 },
  gate_inhibit: { label:'INHIBIT', stroke:'#000', sw:2, fill:'#fff', gw:74, gh:58 },
};

const CODE_PFX = {
  top_event:'TE', intermediate:'IE', basic:'BE', undeveloped:'UE',
  transfer:'TR', gate_and:'G', gate_or:'G', gate_not:'G', gate_inhibit:'G',
};

function isGate(type)  { return type?.startsWith('gate'); }
function svgEl(tag)    { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// IEC gate paths (centred at 0,0)
function andPath(hw,hh){ return `M ${-hw},${hh} L ${hw},${hh} L ${hw},0 A ${hw},${hw} 0 0,0 ${-hw},0 Z`; }
function orPath(hw,hh) { return `M ${-hw},${hh} Q 0,${hh*.3} ${hw},${hh} Q ${hw*.85},0 0,${-hh} Q ${-hw*.85},0 ${-hw},${hh} Z`; }
function hexPath(hw,hh){ const f=hw*.38; return `M ${-f},${-hh} L ${f},${-hh} L ${hw},0 L ${f},${hh} L ${-f},${hh} L ${-hw},0 Z`; }

// Lighten a hex colour for fill / code-row bg
function lighten(hex, pct=0.88) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const l=(c)=>Math.round(Math.min(255, c+(255-c)*pct));
  return `rgb(${l(r)},${l(g)},${l(b)})`;
}
function semiLighten(hex){ return lighten(hex, 0.68); }

const LEVEL_H=150, H_GAP=65;
const CHILD_Y   = 175;   // vertical distance (centre→centre) from parent to child
const CHILD_GAP = 225;   // horizontal gap between sibling centres

// ── Main ──────────────────────────────────────────────────────────────────────
export async function renderFTA(container, { project, item, system, parentType, parentId }) {

  // ── Config (persisted in localStorage) ────────────────────────────────────
  const CFG_KEY = `fta_cfg_${parentType}_${parentId}`;
  let _cfg = { showProbability:false, showFR:false, showMTTR:false, childY:100, showSPF:true };
  try { Object.assign(_cfg, JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); } catch{}
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(_cfg)); }

  // ── State ──────────────────────────────────────────────────────────────────
  const UNLINKED_ID = '__unlinked__'; // sentinel for orphaned FTA nodes (FC deleted with keep-FTA)
  let _fcs     = [];             // FHA failure conditions for this parent
  let _topEventField = 'effect_item'; // column used as FTA top-event label (from project config)
  let _activeHazardId = null;    // currently displayed FC's hazard id
  let _nodes   = [];
  let _selSet  = new Set();      // selected node ids
  let _drag    = null;           // { origins:[{id,ox,oy}], mx, my }
  let _conn    = null;           // { fromId, curX, curY }
  let _lasso   = null;           // { x1,y1,x2,y2 } rubber-band
  let _pan     = { x:100, y:70 };
  let _zoom    = 1;
  let _panDrag = false;
  let _panStart= null;
  let _space   = false;
  let _activeMenu = null;             // currently open add-child menu
  let _editFo     = null;             // active <foreignObject> inline editor
  let _copyDrag   = null;             // { fromId, startX, startY, curX, curY }
  const _undoStack = [];              // max 10 snapshots
  let _undoToastEl = null;
  let _lastGateClick = null;          // { id, t } — used to detect dblclick on gates
  let _mcs        = [];               // current Minimal Cut Sets
  let _spfNodes   = new Set();        // node IDs on Single Point Failure paths
  let _mcsMaxOrder= 99;               // display cut sets up to this order
  let _safetyReqs  = [];              // cached safety requirements from DB
  let _highlightedGateId = null;      // AND gate currently highlighted via reqs panel

  // SPF annotation floating panel state (per-node, persisted in localStorage)
  const ANNOT_KEY = `fta_spf_annot_${parentType}_${parentId}`;
  let _spfAnnotState = {};
  try { _spfAnnotState = JSON.parse(localStorage.getItem(ANNOT_KEY)||'{}'); } catch {}
  function saveSpfAnnotState() { localStorage.setItem(ANNOT_KEY, JSON.stringify(_spfAnnotState)); }

  // ── Shell ──────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="fta-wrap">
      <div class="fta-toolbar" id="fta-tb">
        <span class="fta-toolbar-section">Events</span>
        <button class="btn btn-sm fta-add-btn" data-type="top_event">⬛ Top Event</button>
        <button class="btn btn-sm fta-add-btn" data-type="intermediate">▭ Intermediate</button>
        <button class="btn btn-sm fta-add-btn" data-type="basic">● Basic</button>
        <button class="btn btn-sm fta-add-btn" data-type="undeveloped">◇ Undeveloped</button>
        <button class="btn btn-sm fta-add-btn" data-type="transfer">△ Transfer</button>
        <span class="fta-toolbar-sep"></span>
        <span class="fta-toolbar-section">Gates</span>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_and">∧ AND</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_or">∨ OR</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_not">¬ NOT</button>
        <button class="btn btn-sm fta-add-btn fta-gate-btn" data-type="gate_inhibit">⊘ INH</button>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm fta-color-btn" id="fta-color-btn" title="Node colour" disabled>
          🎨 <span class="fta-color-swatch" id="fta-color-swatch"></span>
        </button>
        <div class="fta-palette-popup" id="fta-palette-popup" style="display:none">
          <div class="fta-palette-swatches" id="fta-palette-swatches"></div>
          <div class="fta-palette-custom">
            <span style="font-size:11px;color:#666">Custom:</span>
            <input type="color" id="fta-color-inp" value="#1E8E3E">
          </div>
          <div class="fta-palette-reset">
            <button id="fta-color-reset">✕ Reset to default</button>
          </div>
        </div>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm btn-danger" id="fta-btn-del" disabled>✕ Delete</button>
        <button class="btn btn-sm"            id="fta-btn-cfg" title="Display settings">⚙ Config</button>
        <span class="fta-toolbar-sep"></span>
        <button class="btn btn-sm"            id="fta-btn-sreqs-panel" title="Show/Hide Safety Requirements panel">🔗 Reqs Panel</button>
        <button class="btn btn-sm"            id="fta-btn-pdf" title="Export to PDF">📄 PDF</button>
      </div>

      <!-- Config panel -->
      <div class="fta-cfg-panel" id="fta-cfg-panel" style="display:none">
        <div class="fta-cfg-title">Display fields</div>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-prob" ${_cfg.showProbability?'checked':''}> Probability (P)</label>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-fr"   ${_cfg.showFR?'checked':''}> Failure Rate (FR)</label>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-mttr" ${_cfg.showMTTR?'checked':''}> MTTR</label>
        <div class="fta-cfg-sep"></div>
        <label class="fta-cfg-row"><input type="checkbox" id="cfg-spf" ${_cfg.showSPF?'checked':''}> Mark SPF in diagram</label>
        <div class="fta-cfg-sep"></div>
        <div class="fta-cfg-row fta-cfg-spacing-row">
          <span>Spacing</span>
          <input type="range" id="cfg-spacing" min="100" max="150" step="5" value="${_cfg.childY}" style="flex:1;margin:0 6px">
          <span id="cfg-spacing-lbl" style="min-width:36px;text-align:right">${_cfg.childY}px</span>
        </div>
      </div>

      <!-- FC sub-page tabs (one per FHA Failure Condition) -->
      <div class="fta-fc-tabs" id="fta-fc-tabs"></div>

      <div class="fta-content-row">
      <div class="fta-canvas-wrap" id="fta-cw">
        <svg id="fta-svg" class="fta-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="farr"  markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 Z" fill="#97A0AF"/></marker>
            <marker id="farrh" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 Z" fill="#1A73E8"/></marker>
          </defs>
          <g id="fta-root">
            <g id="fta-conns"></g>
            <g id="fta-pending"></g>
            <g id="fta-lasso-g"></g>
            <g id="fta-nodes-g"></g>
            <g id="fta-add-btns-g"></g>
            <g id="fta-guides-g"></g>
            <g id="fta-edit-g"></g>
            <g id="fta-copy-g"></g>
          </g>
        </svg>
        <div class="canvas-zoom-fab" id="fta-zoom-fab">
          <button class="czf-btn" id="fta-btn-zi"     title="Zoom in">＋</button>
          <button class="czf-btn" id="fta-btn-zo"     title="Zoom out">－</button>
          <button class="czf-btn" id="fta-btn-zr"     title="Fit all">⊡</button>
          <button class="czf-btn" id="fta-btn-layout" title="Auto layout">⟳</button>
        </div>
        <div class="fta-hint" id="fta-hint">
          Add a node above · Hover node → drag <span style="color:#1E8E3E;font-weight:700">⇣</span> (bottom) to connect · Drag from FFC panel to insert Basic Event ·
          Drag empty area to multi-select · Space+drag to pan
        </div>
      </div>

      <!-- ── Properties side panel ── -->
      <div class="fta-prop-panel" id="fta-prop-panel">
        <div class="fta-prop-hdr">
          <span class="fta-prop-hdr-title">Properties</span>
          <button class="fta-prop-toggle" id="fta-prop-toggle" title="Collapse">◀</button>
        </div>
        <div class="fta-prop-body" id="fta-prop-body">
          <div class="fta-prop-empty">← Select a node</div>
        </div>
      </div>

      </div>

      <!-- ── Functional Failure Conditions bottom bar ── -->
      <div class="bp-bar bp-collapsed fta-ffc-bar" id="fta-ffc-bar">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title">⬇ Functional Failure Conditions — drag to canvas</span>
          <span class="bp-subtitle" id="fta-ffc-subtitle"></span>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body fta-ffc-body-wrap" id="fta-ffc-body">
          <div class="fta-ffc-loading">Expand to browse Features → Use Cases → Functions → FFCs</div>
        </div>
      </div>

      <!-- ── Safety Requirements bottom bar ── -->
      <div class="bp-bar bp-collapsed fta-sreqs-bar" id="fta-sreqs-bar">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr" id="fta-sreqs-hdr">
          <span class="bp-title fta-sreqs-hdr-title">🔗 Safety Requirements (Independence)</span>
          <span class="bp-toggle fta-sreqs-toggle">▲</span>
        </div>
        <div class="bp-body fta-sreqs-body" id="fta-sreqs-body">
          <div class="fta-sreqs-empty">Click the ⚡ Safety Reqs button to generate requirements from AND gates, then expand this panel.</div>
        </div>
      </div>

      <!-- ── MCS bottom bar ── -->
      <div class="bp-bar bp-collapsed fta-mcs-bar" id="fta-mcs-bar">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr" id="fta-mcs-hdr">
          <span class="bp-title fta-mcs-hdr-title">⚡ Minimal Cut Sets</span>
          <label style="font-size:10px;color:#666;margin-left:12px;white-space:nowrap" onclick="event.stopPropagation()">
            Max order:
            <select id="fta-mcs-lvl" style="font-size:10px;padding:1px 4px;border:1px solid #ccc;border-radius:3px;margin-left:3px">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="99" selected>All</option>
            </select>
          </label>
          <span class="bp-toggle fta-mcs-toggle" id="fta-mcs-toggle">▲</span>
        </div>
        <div class="bp-body fta-mcs-body" id="fta-mcs-body">
          <div class="fta-mcs-empty">No cut sets computed yet.</div>
        </div>
      </div>`; /* end fta-content-row + mcs-bar */

  // Load project config to get the configured FTA top-event field
  try {
    const { data: pcRow } = await sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle();
    _topEventField = pcRow?.config?.fha_top_event_field || 'effect_item';
  } catch(_) { /* non-fatal, keep default */ }

  await loadFCs();
  try { await loadNodes(); } catch(e) { console.warn('FTA loadNodes error:', e); }
  try { renderFCTabs(); } catch(e) { console.warn('FTA renderFCTabs error:', e); }
  try { recomputeMCS(); } catch(e) { console.warn('FTA recomputeMCS error:', e); }
  try { render(); } catch(e) { console.error('FTA render error:', e); }
  try { wireToolbar(); } catch(e) { console.error('FTA wireToolbar error:', e); }
  try { wireCanvas(); } catch(e) { console.error('FTA wireCanvas error:', e); }
  wireKeyboard();
  // Defer a second annotation pass so the browser completes flex layout before
  // positioning the absolutely-placed SPF panels (overflow:hidden clips them
  // if container dimensions aren't resolved yet during synchronous init).
  requestAnimationFrame(() => { try { renderSpfAnnotations(); } catch(e) {} });

  // ── Data ───────────────────────────────────────────────────────────────────
  async function loadFCs() {
    // Only show tabs for hazards that have FTA nodes generated (on-demand, not auto)
    const { data: nodes } = await sb.from('fta_nodes')
      .select('hazard_id')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .not('hazard_id', 'is', null);

    const hazardIdsWithFTA = [...new Set((nodes || []).map(n => n.hazard_id))];

    if (hazardIdsWithFTA.length) {
      const { data } = await sb.from('hazards')
        .select('id, haz_code, data, status')
        .in('id', hazardIdsWithFTA)
        .order('sort_order', { ascending: true });
      _fcs = (data || []);
    } else {
      _fcs = [];
    }

    // Check for orphaned FTA nodes (hazard_id = null)
    try {
      const { data: orphans } = await sb.from('fta_nodes')
        .select('id')
        .eq('parent_type', parentType).eq('parent_id', parentId)
        .is('hazard_id', null)
        .limit(1);
      if (orphans?.length) {
        _fcs.push({ id: UNLINKED_ID, haz_code: '—', data: { failure_condition: 'Unlinked FTA (FC deleted)' }, status: 'unlinked' });
      }
    } catch(_) { /* non-fatal */ }

    if (_fcs.length && !_activeHazardId) _activeHazardId = _fcs[0].id;
  }

  async function loadNodes() {
    if (!_activeHazardId) { _nodes = []; return; }
    try {
      let query = sb.from('fta_nodes').select('*');
      if (_activeHazardId === UNLINKED_ID) {
        query = query.eq('parent_type', parentType).eq('parent_id', parentId).is('hazard_id', null);
      } else {
        query = query.eq('hazard_id', _activeHazardId);
      }
      const { data, error } = await query.order('sort_order', { ascending:true });
      if (error) {
        // Fallback: if hazard_id column missing (migration not yet run), load by parent
        const { data: d2 } = await sb.from('fta_nodes')
          .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
          .order('sort_order', { ascending:true });
        _nodes = d2 || [];
      } else {
        _nodes = data || [];
      }
    } catch(e) {
      console.warn('FTA loadNodes fallback:', e);
      _nodes = [];
    }
    if (_nodes.length) { const h=document.getElementById('fta-hint'); if(h) h.style.display='none'; }
    recomputeMCS();
  }

  function renderFCTabs() {
    const el = document.getElementById('fta-fc-tabs'); if (!el) return;
    if (!_fcs.length) {
      el.innerHTML = '<span class="fta-fc-empty">No Failure Conditions found in FHA — create FCs in the FHA page to generate FTA sub-pages.</span>';
      return;
    }
    el.innerHTML = _fcs.map(fc => {
      const label = fc.id === UNLINKED_ID
        ? (fc.data?.failure_condition || fc.haz_code)
        : (fc.data?.[_topEventField] || fc.data?.failure_condition || fc.haz_code);
      const active = fc.id === _activeHazardId;
      const isUnlinked = fc.id === UNLINKED_ID;
      const full = isUnlinked ? label : `${fc.haz_code} ${label}`;
      const short = full.length > 40 ? full.slice(0, 39) + '…' : full;
      return `<span class="fta-fc-tab${active?' active':''}${isUnlinked?' fta-fc-tab-unlinked':''}" data-hid="${fc.id}" title="${esc(full)}">${isUnlinked ? '⚠ ' : ''}${esc(short)}<span class="fta-fc-tab-del" data-hid="${fc.id}" title="Delete FTA">×</span></span>`;
    }).join('');

    // Tab switch (click on the label part)
    el.querySelectorAll('.fta-fc-tab').forEach(tab => {
      tab.addEventListener('click', async e => {
        if (e.target.classList.contains('fta-fc-tab-del')) return; // handled separately
        if (tab.dataset.hid === _activeHazardId) return;
        _activeHazardId = tab.dataset.hid;
        _selSet.clear(); _nodes = [];
        closeEditor(); closeAddMenu();
        await loadNodes();
        recomputeMCS();
        render();
        renderFCTabs();
        refreshFFCPanelIfOpen();
      });
    });

    // Delete FTA (×)
    el.querySelectorAll('.fta-fc-tab-del').forEach(x => {
      x.addEventListener('click', e => { e.stopPropagation(); deleteFTAConfirm(x.dataset.hid); });
    });
  }

  function deleteFTAConfirm(hazardId) {
    const isUnlinked = hazardId === UNLINKED_ID;
    const fc = _fcs.find(f => f.id === hazardId);
    const fcLabel = fc?.data?.failure_condition || fc?.haz_code || '—';
    const fcCode  = fc?.haz_code || '—';

    const mkOverlay = html => {
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
      o.innerHTML = html;
      document.body.appendChild(o);
      o.addEventListener('click', e => { if (e.target === o) o.remove(); });
      return o;
    };

    if (isUnlinked) {
      // Unlinked FTA: two-step hard delete
      const o1 = mkOverlay(`
        <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:400px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">Delete unlinked FTA?</div>
          <div style="font-size:13px;color:#555;margin-bottom:20px">This FTA is no longer linked to any Failure Condition. All nodes will be permanently deleted.</div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="d1-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
            <button id="d1-ok"     style="padding:6px 16px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Delete</button>
          </div>
        </div>`);
      o1.querySelector('#d1-cancel').onclick = () => o1.remove();
      o1.querySelector('#d1-ok').onclick = () => {
        o1.remove();
        const o2 = mkOverlay(`
          <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25);font-family:inherit;border-top:4px solid #d93025">
            <div style="font-size:15px;font-weight:700;color:#d93025;margin-bottom:10px">⚠ Confirm permanent deletion</div>
            <div style="font-size:13px;color:#555;margin-bottom:20px">All FTA nodes will be deleted. This <strong>cannot be undone</strong>.</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="d2-cancel"  style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
              <button id="d2-confirm" style="padding:6px 16px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Yes, delete all nodes</button>
            </div>
          </div>`);
        o2.querySelector('#d2-cancel').onclick = () => o2.remove();
        o2.querySelector('#d2-confirm').onclick = async () => {
          o2.remove();
          await sb.from('fta_nodes').delete()
            .eq('parent_type', parentType).eq('parent_id', parentId).is('hazard_id', null);
          _nodes = []; _selSet.clear();
          _fcs = _fcs.filter(f => f.id !== UNLINKED_ID);
          if (_activeHazardId === UNLINKED_ID) _activeHazardId = _fcs[0]?.id || null;
          render(); renderFCTabs();
          toast('Unlinked FTA deleted.', 'success');
        };
      };
    } else {
      // Linked FTA: recommend clearing instead; still allow with double confirm
      const o1 = mkOverlay(`
        <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:430px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">Delete FTA for ${esc(fcCode)}?</div>
          <div style="font-size:13px;color:#555;margin-bottom:8px">Failure Condition: <strong>${esc(fcLabel)}</strong></div>
          <div style="font-size:13px;background:#FFF8E1;border:1px solid #F9AB00;border-radius:5px;padding:10px 12px;margin-bottom:18px;color:#5F4000">
            <strong>⚠ Recommendation:</strong> Failure Conditions normally require a Fault Tree Analysis. It is better to <strong>clear the content</strong> and keep the FTA empty than to delete it entirely.
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button id="l1-cancel" style="padding:6px 14px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
            <button id="l1-clear"  style="padding:6px 14px;border:1px solid #1A73E8;border-radius:4px;background:#fff;color:#1A73E8;cursor:pointer;font-size:13px;font-weight:600">Clear content (recommended)</button>
            <button id="l1-del"    style="padding:6px 14px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px">Delete anyway</button>
          </div>
        </div>`);
      o1.querySelector('#l1-cancel').onclick = () => o1.remove();
      o1.querySelector('#l1-clear').onclick = async () => {
        o1.remove();
        await sb.from('fta_nodes').delete().eq('hazard_id', hazardId);
        _nodes = []; _selSet.clear(); render(); renderFCTabs();
        toast('FTA content cleared. Empty FTA preserved.', 'success');
      };
      o1.querySelector('#l1-del').onclick = () => {
        o1.remove();
        const o2 = mkOverlay(`
          <div style="background:#fff;border-radius:8px;padding:24px 28px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25);font-family:inherit;border-top:4px solid #d93025">
            <div style="font-size:15px;font-weight:700;color:#d93025;margin-bottom:10px">⚠ Confirm deletion</div>
            <div style="font-size:13px;color:#555;margin-bottom:6px">All FTA nodes for <strong>${esc(fcCode)}</strong> will be permanently deleted.</div>
            <div style="font-size:12px;color:#888;margin-bottom:20px">The Failure Condition will remain in FHA but will have no FTA. This cannot be undone.</div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="l2-cancel"  style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
              <button id="l2-confirm" style="padding:6px 16px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Yes, delete all nodes</button>
            </div>
          </div>`);
        o2.querySelector('#l2-cancel').onclick = () => o2.remove();
        o2.querySelector('#l2-confirm').onclick = async () => {
          o2.remove();
          await sb.from('fta_nodes').delete().eq('hazard_id', hazardId);
          _nodes = []; _selSet.clear();
          _fcs = _fcs.filter(f => f.id !== hazardId);
          if (_activeHazardId === hazardId) _activeHazardId = _fcs[0]?.id || null;
          render(); renderFCTabs();
          toast('FTA deleted.', 'success');
        };
      };
    }
  }

  function byId(id) { return _nodes.find(n=>n.id===id); }

  function nextCode(type) {
    const pfx = CODE_PFX[type]||'N';
    const nums = _nodes.filter(n=>n.type===type&&n.fta_code?.startsWith(pfx+'-'))
                       .map(n=>parseInt(n.fta_code.split('-')[1])||0);
    return `${pfx}-${String((nums.length?Math.max(...nums):0)+1).padStart(2,'0')}`;
  }

  // Box height: code + component + label (label row grows with wrapped text)
  function boxH(label='') {
    const nLines = Math.max(1, labelLines(label).length);
    return ROW_CODE + ROW_STD + Math.max(ROW_STD, nLines * LINE_H + 8);
  }

  function nw(n){ return isGate(n.type) ? (NT[n.type]?.gw||74) : BOX_W; }
  function nh(n){ return isGate(n.type) ? (NT[n.type]?.gh||62) : boxH(n.label); }
  // external optional fields height (below box, outside border)
  function extH(){ return ((_cfg.showProbability?1:0)+(_cfg.showFR?1:0)+(_cfg.showMTTR?1:0))*14; }
  // True visual bottom of a node in canvas coords (matches what buildBoxNode renders)
  function nodeVisualBottom(n) {
    if (isGate(n.type)) {
      const hh = (NT[n.type]?.gh||62)/2;
      let by = hh + 8;
      if (_cfg.showProbability) by += 14;
      return n.y + by;
    }
    const hh = nh(n) / 2;
    const base = NT[n.type];
    let by = hh + (n.type === 'top_event' ? 14 : 8);
    if (base?.indicator) by += 13 + 2 + 13 + 5; // line + IND_R + gap + IND_R + margin
    by += extH();
    return n.y + by;
  }

  // Recursively compute probability for a node (gates derive from children;
  // box nodes propagate from a child gate if no manual value is set)
  function computeP(n) {
    if (!isGate(n.type)) {
      if (n.probability != null && n.probability !== '') return parseFloat(n.probability);
      // Inherit from a single child gate (e.g. top_event → AND gate)
      const gateChild = _nodes.find(c => c.parent_node_id === n.id && isGate(c.type));
      return gateChild ? computeP(gateChild) : null;
    }
    const children = _nodes.filter(c => c.parent_node_id === n.id);
    if (!children.length) return null;
    const ps = children.map(c => computeP(c)).filter(p => p !== null && !isNaN(p));
    if (!ps.length) return null;
    if (n.type === 'gate_and')     return ps.reduce((a,b) => a*b, 1);
    if (n.type === 'gate_or')      return 1 - ps.reduce((a,b) => a*(1-b), 1);
    if (n.type === 'gate_not')     return 1 - ps[0];
    if (n.type === 'gate_inhibit') return ps.reduce((a,b) => a*b, 1);
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    renderConns();
    renderNodeEls();
    renderPendingConn();
    renderLasso();
    renderCopyGhost();
    renderGuides();
    applyTransform();
    const hint=document.getElementById('fta-hint'); if(hint) hint.style.display = _nodes.length ? 'none' : '';
    updateDelBtn();
    updatePropPanel();
    renderSpfAnnotations(); // rebuilds panels (needed when SPF set changes)
  }

  // Call after tree structure changes (add/delete/connect) — not on every render
  function recomputeMCS() {
    try { _mcs = computeMCS(); _spfNodes = computeSPFNodes(_mcs); } catch(e) { _mcs=[]; _spfNodes=new Set(); }
    try { renderMCSBar(); } catch(e) { /* non-fatal */ }
  }

  function applyTransform() {
    const g=container.querySelector('#fta-root');
    if (g) g.setAttribute('transform',`translate(${_pan.x},${_pan.y}) scale(${_zoom})`);
    repositionAnnotPanels();
  }

  // Convert canvas coords → screen coords (relative to canvas wrap)
  function canvasToScreen(cx, cy) {
    return { left: cx * _zoom + _pan.x, top: cy * _zoom + _pan.y };
  }
  // Convert screen coords (relative to wrap) → canvas coords
  function screenToCanvas(left, top) {
    return { cx: (left - _pan.x) / _zoom, cy: (top - _pan.y) / _zoom };
  }

  function repositionAnnotPanels() {
    container.querySelectorAll('.fta-spf-float[data-nid]').forEach(panel => {
      const nid = panel.dataset.nid;
      const s = _spfAnnotState[nid];
      if (!s) return;
      const n = byId(nid);
      const cy = n ? nodeVisualBottom(n) + (s.relY ?? 20) : 0;
      const { left, top } = canvasToScreen(s.cx, cy);
      panel.style.left = left + 'px';
      panel.style.top  = top  + 'px';
      panel.style.transform = `scale(${_zoom})`;
      panel.style.transformOrigin = 'top left';
    });
  }

  // ── Undo ──────────────────────────────────────────────────────────────────────
  function pushUndo(label) {
    _undoStack.push({ label, nodes: JSON.parse(JSON.stringify(_nodes)) });
    if (_undoStack.length > 10) _undoStack.shift();
  }

  function showUndoToast(msg, state='doing') {
    if (!_undoToastEl) {
      _undoToastEl = document.createElement('div');
      _undoToastEl.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:500;z-index:9998;box-shadow:0 4px 16px rgba(0,0,0,.22);display:flex;align-items:center;gap:8px;font-family:inherit;transition:background .25s';
      document.body.appendChild(_undoToastEl);
    }
    if (state === 'doing') {
      _undoToastEl.style.background = '#E37400';
      _undoToastEl.style.color = '#fff';
      _undoToastEl.innerHTML = `<span style="display:inline-block;animation:fta-spin .8s linear infinite">↺</span> ${esc(msg)}`;
    } else {
      _undoToastEl.style.background = '#1E8E3E';
      _undoToastEl.style.color = '#fff';
      _undoToastEl.innerHTML = `✓ ${esc(msg)}`;
      setTimeout(() => { _undoToastEl?.remove(); _undoToastEl = null; }, 2200);
    }
  }

  async function undo() {
    if (!_undoStack.length) { toast('Nothing to undo.', 'info'); return; }
    const snap = _undoStack.pop();
    showUndoToast(`Undoing: ${snap.label}…`);

    const snapNodes = snap.nodes;
    const snapMap = new Map(snapNodes.map(n => [n.id, n]));
    const curMap  = new Map(_nodes.map(n => [n.id, n]));

    const toDelete = _nodes.filter(n => !snapMap.has(n.id));
    const toInsert = snapNodes.filter(n => !curMap.has(n.id));
    const toUpdate = snapNodes.filter(n => curMap.has(n.id));

    for (const n of toDelete) await sb.from('fta_nodes').delete().eq('id', n.id);
    for (const n of toInsert) {
      const { id, created_at, updated_at, ...rest } = n;
      await sb.from('fta_nodes').upsert({ id, ...rest });
    }
    for (const n of toUpdate) {
      const { id, created_at, ...rest } = n;
      await sb.from('fta_nodes').update(rest).eq('id', id);
    }

    _nodes = JSON.parse(JSON.stringify(snapNodes));
    _selSet.clear();
    recomputeMCS(); render();
    showUndoToast(`Done: ${snap.label}`, 'done');
  }

  function renderConns() {
    const layer=document.getElementById('fta-conns'); if(!layer) return;
    layer.innerHTML='';
    _nodes.forEach(n=>{
      if (!n.parent_node_id) return;
      const p=byId(n.parent_node_id); if(!p) return;
      const x1=p.x, y1=p.y+nh(p)/2, x2=n.x, y2=n.y-nh(n)/2;
      const mid=(y1+y2)/2;
      const sel=_selSet.has(n.id)||_selSet.has(p.id);
      const spf=!sel&&_spfNodes.has(n.id)&&_spfNodes.has(p.id)&&_cfg.showSPF;
      const el=svgEl('path');
      el.setAttribute('d',`M ${x1},${y1} L ${x1},${mid} L ${x2},${mid} L ${x2},${y2}`);
      el.setAttribute('fill','none');
      el.setAttribute('stroke', sel?'#1A73E8':spf?'#d93025':'#555F6E');
      el.setAttribute('stroke-width', sel?'2.5':spf?'2.5':'1.8');
      el.setAttribute('marker-end', sel?'url(#farrh)':'url(#farr)');
      if (spf) el.setAttribute('stroke-dasharray','none');
      layer.appendChild(el);
    });
  }

  function renderNodeEls() {
    const layer = document.getElementById('fta-nodes-g'); if(!layer) return;
    const btnLayer = document.getElementById('fta-add-btns-g');
    layer.innerHTML=''; if(btnLayer) btnLayer.innerHTML='';
    _nodes.forEach(n=>layer.appendChild(isGate(n.type)?buildGateNode(n):buildBoxNode(n)));
  }

  // ── Box node ────────────────────────────────────────────────────────────────
  function buildBoxNode(n) {
    const base = NT[n.type]||NT.basic;
    const userColor = n.color&&n.color.startsWith('#') ? n.color : null;
    const spf       = !userColor && _spfNodes.has(n.id) && _cfg.showSPF;
    const stroke    = userColor ? userColor : spf ? '#d93025' : base.stroke;
    const fill      = userColor ? lighten(userColor) : spf ? '#fff5f5' : base.fill;
    const codeColor = userColor ? semiLighten(userColor) : spf ? '#fde8e8' : base.codeColor;
    const sw        = base.sw;
    const sel       = _selSet.has(n.id);
    const BH        = boxH(n.label);
    const hw        = BOX_W/2, hh = BH/2;

    const g = svgEl('g');
    g.dataset.id = n.id;
    g.setAttribute('class',`fta-node${sel?' fta-sel':''}`);
    g.setAttribute('transform',`translate(${n.x},${n.y})`);

    // Selection glow
    if (sel) {
      const sh=svgEl('rect');
      sh.setAttribute('x',-hw+3); sh.setAttribute('y',-hh+3);
      sh.setAttribute('width',BOX_W); sh.setAttribute('height',BH);
      sh.setAttribute('rx','6'); sh.setAttribute('fill','rgba(26,115,232,0.30)');
      g.appendChild(sh);
    }

    // Top-event double border
    if (n.type==='top_event') {
      const ob=svgEl('rect');
      ob.setAttribute('x',-(hw+4)); ob.setAttribute('y',-(hh+4));
      ob.setAttribute('width',BOX_W+8); ob.setAttribute('height',BH+8);
      ob.setAttribute('rx','8'); ob.setAttribute('fill','none');
      ob.setAttribute('stroke',stroke); ob.setAttribute('stroke-width','1.5');
      g.appendChild(ob);
    }

    // Main box
    const box=svgEl('rect');
    box.setAttribute('x',-hw); box.setAttribute('y',-hh);
    box.setAttribute('width',BOX_W); box.setAttribute('height',BH);
    box.setAttribute('rx','5'); box.setAttribute('fill',fill);
    box.setAttribute('stroke', sel ? '#1A73E8' : stroke);
    box.setAttribute('stroke-width', sel ? sw+2 : sw);
    if (sel) box.setAttribute('filter','drop-shadow(0 0 8px rgba(26,115,232,.6))');
    g.appendChild(box);

    // Code row background
    appendCodeBg(g, -hw, -hh, BOX_W, ROW_CODE, sw, codeColor, stroke);

    // ── Code row ──
    const addHitRect=(field,ry,rh2)=>{
      const rh=svgEl('rect');
      rh.setAttribute('x',-hw); rh.setAttribute('y',ry);
      rh.setAttribute('width',BOX_W); rh.setAttribute('height',rh2);
      rh.setAttribute('fill','transparent'); rh.setAttribute('class','fta-row-hit');
      rh.dataset.field=field; g.appendChild(rh);
    };
    const addDivider=dy=>{
      const line=svgEl('line');
      line.setAttribute('x1',-hw); line.setAttribute('y1',dy);
      line.setAttribute('x2', hw); line.setAttribute('y2',dy);
      line.setAttribute('stroke','#bbb'); line.setAttribute('stroke-width','0.8');
      line.setAttribute('pointer-events','none'); g.appendChild(line);
    };
    // Code
    addHitRect('fta_code', -hh, ROW_CODE);
    {const t=svgEl('text'); t.setAttribute('x',-(hw-8)); t.setAttribute('y',-hh+ROW_CODE/2);
     t.setAttribute('dominant-baseline','middle'); t.setAttribute('font-size','10');
     t.setAttribute('font-weight','700'); t.setAttribute('fill',stroke);
     t.setAttribute('font-family','inherit'); t.setAttribute('pointer-events','none');
     const v=n.fta_code||''; t.textContent=v.length>22?v.slice(0,21)+'…':v; g.appendChild(t);}
    addDivider(-hh+ROW_CODE);
    // Component
    addHitRect('component', -hh+ROW_CODE, ROW_STD);
    {const t=svgEl('text'); t.setAttribute('x',-(hw-6)); t.setAttribute('y',-hh+ROW_CODE+ROW_STD/2);
     t.setAttribute('dominant-baseline','middle'); t.setAttribute('font-size','11');
     t.setAttribute('font-weight','400'); t.setAttribute('fill','#444');
     t.setAttribute('font-family','inherit'); t.setAttribute('pointer-events','none');
     const v=n.component||''; const mc=Math.floor((BOX_W-14)/6.4);
     t.textContent=v.length>mc?v.slice(0,mc-1)+'…':v; g.appendChild(t);}
    addDivider(-hh+ROW_CODE+ROW_STD);
    // Label (failure) — multi-line
    const lblLines=labelLines(n.label||'');
    const lblRH=Math.max(ROW_STD, lblLines.length*LINE_H+8);
    addHitRect('label', -hh+ROW_CODE+ROW_STD, lblRH);
    {const t=svgEl('text'); t.setAttribute('x',-(hw-6));
     t.setAttribute('font-size','11'); t.setAttribute('font-weight','500');
     t.setAttribute('fill','#000'); t.setAttribute('font-family','inherit');
     t.setAttribute('pointer-events','none');
     const lineStartY=-hh+ROW_CODE+ROW_STD+LINE_H;
     lblLines.forEach((line,i)=>{
       const ts=svgEl('tspan'); ts.setAttribute('x',-(hw-6));
       ts.setAttribute('y', lineStartY+i*LINE_H);
       ts.setAttribute('dominant-baseline','middle');
       ts.textContent=line;
       t.appendChild(ts);
     });
     g.appendChild(t);}

    // ── Below box: indicator (connected by line) then optional numeric fields ──
    // extra gap for top_event double border (border extends 4px outside box)
    const IND_R = 13;
    let belowY = hh + (n.type==='top_event' ? 14 : 8);
    if (base.indicator) {
      // short vertical line from box bottom to indicator centre
      const indCY = belowY + IND_R + 2; // 2px gap then radius
      const ln = svgEl('line');
      ln.setAttribute('x1',0); ln.setAttribute('y1',hh);
      ln.setAttribute('x2',0); ln.setAttribute('y2',indCY - IND_R);
      ln.setAttribute('stroke',stroke); ln.setAttribute('stroke-width','1.5');
      ln.setAttribute('pointer-events','none');
      g.appendChild(ln);
      const ind = buildIndicator(base.indicator, stroke);
      ind.setAttribute('transform',`translate(0,${indCY})`);
      g.appendChild(ind);
      belowY = indCY + IND_R + 5; // start ext fields just below indicator
    }
    const extFields = [];
    if (_cfg.showProbability) extFields.push({f:'probability',  lbl:'P'});
    if (_cfg.showFR)          extFields.push({f:'failure_rate', lbl:'FR'});
    if (_cfg.showMTTR)        extFields.push({f:'mttr',         lbl:'MTTR'});
    const EXT_X = -(hw-6); // left-aligned, same indent as text rows
    extFields.forEach(({f, lbl})=>{
      const rh=svgEl('rect');
      rh.setAttribute('x',-hw); rh.setAttribute('y',belowY-7);
      rh.setAttribute('width',BOX_W); rh.setAttribute('height',14);
      rh.setAttribute('fill','transparent'); rh.setAttribute('class','fta-row-hit');
      rh.dataset.field=f; g.appendChild(rh);
      const txt=svgEl('text');
      txt.setAttribute('x',EXT_X); txt.setAttribute('y',belowY);
      txt.setAttribute('text-anchor','start'); txt.setAttribute('dominant-baseline','middle');
      txt.setAttribute('font-size','9'); txt.setAttribute('fill','#666');
      txt.setAttribute('pointer-events','none');
      const val = n[f]!=null&&n[f]!=='' ? fmtNum(n[f]) : '—';
      // For P on non-gate: also show computed value from child gate if no manual value
      const disp = (f==='probability' && (n[f]==null||n[f]==='')) ? computeP(n) : (n[f]!=null&&n[f]!=='' ? n[f] : null);
      txt.textContent=`${lbl} = ${disp!=null ? fmtNum(disp) : '—'}`;
      g.appendChild(txt);
      belowY+=14;
    });

    // Port + optional add-child button (leaf event types cannot have children)
    const isLeafType = n.type === 'basic' || n.type === 'undeveloped' || n.type === 'transfer';
    const portY = belowY + 14;
    const portG = buildPort(n.id, 0, portY);
    g.appendChild(portG);
    if (!isLeafType) {
      const addBtn = buildAddBtn(n.id, 0, hh + 10);
      g.appendChild(addBtn);
      wireAddBtnHover(g, addBtn, portG);
    } else {
      // Leaf nodes: show port on hover even without add button
      g.addEventListener('mouseenter', () => { portG.style.opacity='1'; }, false);
      g.addEventListener('mouseleave', () => { portG.style.opacity='0'; }, false);
    }
    return g;
  }

  function appendCodeBg(g, x, y, w, h, sw, color, stroke) {
    const r1=svgEl('rect');
    r1.setAttribute('x',x+sw/2); r1.setAttribute('y',y+sw/2);
    r1.setAttribute('width',w-sw); r1.setAttribute('height',h);
    r1.setAttribute('rx','4'); r1.setAttribute('fill',color); r1.setAttribute('pointer-events','none');
    g.appendChild(r1);
    const r2=svgEl('rect'); // cover bottom rounded corners
    r2.setAttribute('x',x+sw/2); r2.setAttribute('y',y+sw/2+h-6);
    r2.setAttribute('width',w-sw); r2.setAttribute('height',6);
    r2.setAttribute('fill',color); r2.setAttribute('pointer-events','none');
    g.appendChild(r2);
  }

  function fmtNum(v) {
    if (v==null||v==='') return '';
    const n=parseFloat(v);
    if (isNaN(n)) return String(v);
    if (n>0&&n<0.001) return n.toExponential(2);
    return String(parseFloat(n.toPrecision(4)));
  }

  function buildIndicator(shape, stroke) {
    const g=svgEl('g'); g.setAttribute('pointer-events','none');
    if (shape==='circle')  { const c=svgEl('circle'); c.setAttribute('cx',0);c.setAttribute('cy',0);c.setAttribute('r',13);c.setAttribute('fill','white');c.setAttribute('stroke',stroke);c.setAttribute('stroke-width','2');g.appendChild(c); }
    else if (shape==='diamond') { const p=svgEl('path'); p.setAttribute('d','M 0,-13 L 13,0 L 0,13 L -13,0 Z');p.setAttribute('fill','white');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width','2');g.appendChild(p); }
    else if (shape==='triangle') { const p=svgEl('path'); p.setAttribute('d','M 0,-13 L 14,13 L -14,13 Z');p.setAttribute('fill','white');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width','2');g.appendChild(p); }
    return g;
  }

  // ── Gate node ───────────────────────────────────────────────────────────────
  function buildGateNode(n) {
    const t=NT[n.type]||NT.gate_and;
    const userColor=n.color&&n.color.startsWith('#')?n.color:null;
    const spf=!userColor&&_spfNodes.has(n.id)&&_cfg.showSPF;
    const stroke=userColor?userColor:spf?'#d93025':t.stroke;
    const fill=userColor?lighten(userColor):spf?'#fff5f5':t.fill;
    const hw=(t.gw||74)/2, hh=(t.gh||62)/2;
    const sel=_selSet.has(n.id);

    const g=svgEl('g');
    g.dataset.id=n.id;
    g.setAttribute('class',`fta-node fta-gate-node${sel?' fta-sel':''}`);
    g.setAttribute('transform',`translate(${n.x},${n.y})`);

    let shape;
    if (n.type==='gate_and')     { shape=svgEl('path'); shape.setAttribute('d',andPath(hw,hh)); }
    else if (n.type==='gate_or') { shape=svgEl('path'); shape.setAttribute('d',orPath(hw,hh)); }
    else if (n.type==='gate_not'){ shape=svgEl('ellipse'); shape.setAttribute('cx',0); shape.setAttribute('cy',0); shape.setAttribute('rx',hw); shape.setAttribute('ry',hh); }
    else                         { shape=svgEl('path'); shape.setAttribute('d',hexPath(hw,hh)); }
    shape.setAttribute('fill',fill); shape.setAttribute('stroke',stroke);
    shape.setAttribute('stroke-width',sel?t.sw+2:t.sw);
    if (sel) shape.setAttribute('filter','drop-shadow(0 0 8px rgba(26,115,232,.6))');
    g.appendChild(shape);

    const lbl=svgEl('text');
    lbl.setAttribute('x',0); lbl.setAttribute('y',2);
    lbl.setAttribute('text-anchor','middle'); lbl.setAttribute('dominant-baseline','middle');
    lbl.setAttribute('font-size','13'); lbl.setAttribute('font-weight','700');
    lbl.setAttribute('fill',stroke);
    lbl.setAttribute('font-family','-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif');
    lbl.setAttribute('pointer-events','none');
    lbl.textContent=n.label||t.label;
    g.appendChild(lbl);

    // Computed P below gate shape (outside, left-aligned)
    let gBelowY = hh + 8;
    if (_cfg.showProbability) {
      const p=computeP(n);
      const ptxt=svgEl('text');
      ptxt.setAttribute('x',-(hw-4)); ptxt.setAttribute('y', gBelowY);
      ptxt.setAttribute('text-anchor','start'); ptxt.setAttribute('dominant-baseline','middle');
      ptxt.setAttribute('font-size','9'); ptxt.setAttribute('fill','#555');
      ptxt.setAttribute('pointer-events','none');
      ptxt.textContent = p !== null ? `P = ${fmtNum(p)}` : 'P = —';
      g.appendChild(ptxt);
      gBelowY += 14;
    }
    const portGG = buildPort(n.id, 0, gBelowY + 10);
    g.appendChild(portGG);
    const addBtnG = buildAddBtn(n.id, 0, hh + 10);
    g.appendChild(addBtnG);
    wireAddBtnHover(g, addBtnG, portGG);
    return g;
  }

  // ── Port (connection handle — visible on hover, drag to connect) ────────────
  function buildPort(nodeId, px, py) {
    const g=svgEl('g');
    g.setAttribute('class','fta-port');
    g.setAttribute('transform',`translate(${px},${py})`);
    g.dataset.portFor=nodeId;
    g.style.opacity='0';
    g.style.transition='opacity 0.12s';
    g.style.cursor='crosshair';
    const title=svgEl('title'); title.textContent='Drag to connect to another node';
    const hit=svgEl('circle'); hit.setAttribute('r','14'); hit.setAttribute('fill','transparent'); hit.setAttribute('class','fta-port-hit');
    const ring=svgEl('circle'); ring.setAttribute('r','9'); ring.setAttribute('fill','#1E8E3E'); ring.setAttribute('stroke','#fff'); ring.setAttribute('stroke-width','2'); ring.setAttribute('pointer-events','none');
    const arrow=svgEl('text'); arrow.setAttribute('x','0'); arrow.setAttribute('y','1'); arrow.setAttribute('text-anchor','middle'); arrow.setAttribute('dominant-baseline','middle'); arrow.setAttribute('font-size','11'); arrow.setAttribute('font-weight','700'); arrow.setAttribute('fill','#fff'); arrow.setAttribute('pointer-events','none'); arrow.textContent='⇣';
    g.appendChild(title); g.appendChild(hit); g.appendChild(ring); g.appendChild(arrow);
    return g;
  }

  // ── Add-child "+" button (SVG) ──────────────────────────────────────────────
  function buildAddBtn(nodeId, px, py) {
    const g=svgEl('g');
    g.setAttribute('class','fta-add-child');
    g.setAttribute('transform',`translate(${px},${py})`);
    g.dataset.addFor=nodeId;
    g.style.opacity='0';
    g.style.transition='opacity 0.12s';
    g.style.cursor='pointer';
    const hit=svgEl('circle'); hit.setAttribute('r','12'); hit.setAttribute('fill','transparent');
    const vis=svgEl('circle'); vis.setAttribute('r','9'); vis.setAttribute('fill','#1A73E8'); vis.setAttribute('stroke','#fff'); vis.setAttribute('stroke-width','1.5'); vis.setAttribute('pointer-events','none');
    const txt=svgEl('text'); txt.setAttribute('x','0'); txt.setAttribute('y','1'); txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','middle'); txt.setAttribute('font-size','14'); txt.setAttribute('font-weight','700'); txt.setAttribute('fill','#fff'); txt.setAttribute('pointer-events','none'); txt.textContent='+';
    g.appendChild(hit); g.appendChild(vis); g.appendChild(txt);
    return g;
  }

  // Wire hover show/hide for port + add-child button on a node group
  function wireAddBtnHover(nodeG, addBtnG, portG) {
    nodeG.addEventListener('mouseenter', () => {
      addBtnG.style.opacity='1';
      if (portG) portG.style.opacity='1';
    }, false);
    nodeG.addEventListener('mouseleave', () => {
      addBtnG.style.opacity='0';
      if (portG) portG.style.opacity='0';
    }, false);
  }

  // ── Pending connection ──────────────────────────────────────────────────────
  function renderPendingConn() {
    const layer=document.getElementById('fta-pending'); if(!layer) return; layer.innerHTML='';
    if (!_conn) return;
    const n=byId(_conn.fromId); if(!n) return;
    const x1=n.x, y1=n.y+nh(n)/2, x2=_conn.curX, y2=_conn.curY, mid=(y1+y2)/2;
    const line=svgEl('path');
    line.setAttribute('d',`M ${x1},${y1} L ${x1},${mid} L ${x2},${mid} L ${x2},${y2}`);
    line.setAttribute('fill','none'); line.setAttribute('stroke','#1E8E3E');
    line.setAttribute('stroke-width','2'); line.setAttribute('stroke-dasharray','6,4');
    line.setAttribute('pointer-events','none');
    layer.appendChild(line);
    const tip=svgEl('circle'); tip.setAttribute('cx',x2); tip.setAttribute('cy',y2);
    tip.setAttribute('r','4'); tip.setAttribute('fill','#1E8E3E'); tip.setAttribute('pointer-events','none');
    layer.appendChild(tip);
  }

  // ── Rubber-band lasso ───────────────────────────────────────────────────────
  function renderLasso() {
    const layer=document.getElementById('fta-lasso-g'); if(!layer) return; layer.innerHTML='';
    if (!_lasso) return;
    const x=Math.min(_lasso.x1,_lasso.x2), y=Math.min(_lasso.y1,_lasso.y2);
    const w=Math.abs(_lasso.x2-_lasso.x1), h=Math.abs(_lasso.y2-_lasso.y1);
    const rect=svgEl('rect');
    rect.setAttribute('x',x); rect.setAttribute('y',y);
    rect.setAttribute('width',w); rect.setAttribute('height',h);
    rect.setAttribute('fill','rgba(26,115,232,.1)'); rect.setAttribute('stroke','#1A73E8');
    rect.setAttribute('stroke-width','1.5'); rect.setAttribute('stroke-dasharray','5,3');
    rect.setAttribute('pointer-events','none');
    layer.appendChild(rect);
  }

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  function wireToolbar() {
    const q = id => container.querySelector('#'+id);
    container.querySelectorAll('.fta-add-btn').forEach(btn=>btn.addEventListener('click',()=>addNode(btn.dataset.type)));
    q('fta-btn-del').addEventListener('click', deleteSelected);
    q('fta-btn-layout').addEventListener('click', autoLayout);
    q('fta-btn-zi').addEventListener('click',()=>setZoom(_zoom*1.2));
    q('fta-btn-zo').addEventListener('click',()=>setZoom(_zoom/1.2));
    q('fta-btn-zr').addEventListener('click', fitAll);
    q('fta-btn-pdf').addEventListener('click', () => {
      const svg = container.querySelector('#fta-svg');
      const fc  = _fcs.find(f => f.id === _activeHazardId);
      const fcLabel = fc?.data?.failure_condition || fc?.haz_code || '';
      const title   = project.name || 'FTA';
      exportFTApdf(svg, _nodes, title, fcLabel, _mcs, _mcsMaxOrder);
    });
    q('fta-btn-sreqs-panel').addEventListener('click', () => toggleSreqsPanel());
    wireMCSBar();
    wireSreqsBar();
    wireFFCBar();

    // Prop panel toggle
    q('fta-prop-toggle').addEventListener('click',()=>{
      const panel=q('fta-prop-panel');
      const collapsed=panel.classList.toggle('fta-prop-collapsed');
      q('fta-prop-toggle').textContent=collapsed?'▶':'◀';
    });

    // Config toggle
    const cfgBtn=q('fta-btn-cfg');
    const cfgPanel=q('fta-cfg-panel');
    cfgBtn.addEventListener('click',()=>{
      cfgPanel.style.display=cfgPanel.style.display==='none'?'':'none';
    });
    ['cfg-prob','cfg-fr','cfg-mttr','cfg-spf'].forEach((id,i)=>{
      const key=['showProbability','showFR','showMTTR','showSPF'][i];
      q(id).addEventListener('change',e=>{
        _cfg[key]=e.target.checked; saveCfg(); render();
      });
    });
    q('cfg-spacing').addEventListener('input',e=>{
      _cfg.childY=parseInt(e.target.value);
      q('cfg-spacing-lbl').textContent=_cfg.childY+'px';
      relayoutInMemory(); render(); // live preview — no DB save yet
    });
    q('cfg-spacing').addEventListener('change',async e=>{
      saveCfg();
      await Promise.all(_nodes.map(n=>autosave(n.id,{x:n.x,y:n.y})));
    });

    // ── Colour palette ──────────────────────────────────────────────────────
    const PALETTE_COLORS = [
      '#1E8E3E','#34A853','#7CB342','#F9AB00','#E37400','#EA4335',
      '#D32F2F','#E91E63','#8E24AA','#3949AB','#1A73E8','#039BE5',
      '#00897B','#00ACC1','#546E7A','#78909C','#BDBDBD','#5D4037',
    ];
    const swatchesEl = q('fta-palette-swatches');
    PALETTE_COLORS.forEach(col => {
      const s = document.createElement('button');
      s.className = 'fta-palette-swatch';
      s.style.background = col;
      s.title = col;
      s.addEventListener('click', () => applyColor(col));
      swatchesEl.appendChild(s);
    });

    async function applyColor(col) {
      if (!_selSet.size) return;
      pushUndo(`Colour ${[..._selSet].map(id=>byId(id)?.fta_code||'node').join(', ')}`);
      for (const id of _selSet) {
        const n=byId(id); if(!n) continue;
        n.color = col;
        await autosave(id,{color:col});
      }
      // sync swatch preview
      const sw = container.querySelector('#fta-color-swatch');
      if (sw) sw.style.background = col || '';
      closePalette();
      render();
    }

    function closePalette() {
      const pop = container.querySelector('#fta-palette-popup');
      if (pop) pop.style.display = 'none';
    }

    q('fta-color-btn').addEventListener('click', e => {
      e.stopPropagation();
      const pop = container.querySelector('#fta-palette-popup');
      if (!pop) return;
      if (pop.style.display === 'none') {
        // position below button (relative to .fta-wrap which is position:relative)
        const btn = q('fta-color-btn');
        const br = btn.getBoundingClientRect();
        const wr = (container.querySelector('.fta-wrap')||container).getBoundingClientRect();
        pop.style.top  = (br.bottom - wr.top + 4) + 'px';
        pop.style.left = (br.left - wr.left) + 'px';
        pop.style.display = 'block';
      } else {
        closePalette();
      }
    });

    // Custom colour input — apply on change (picker close) or input (live)
    q('fta-color-inp').addEventListener('input', e => {
      const sw = container.querySelector('#fta-color-swatch');
      if (sw) sw.style.background = e.target.value;
    });
    q('fta-color-inp').addEventListener('change', e => applyColor(e.target.value));

    // Reset to default
    q('fta-color-reset').addEventListener('click', () => applyColor(''));

    // Close palette on outside click
    document.addEventListener('click', e => {
      const pop = container.querySelector('#fta-palette-popup');
      if (pop && pop.style.display !== 'none') {
        if (!pop.contains(e.target) && e.target.id !== 'fta-color-btn') closePalette();
      }
    });
  }

  // ── Canvas events ────────────────────────────────────────────────────────────
  function wireCanvas() {
    const wrap=container.querySelector('#fta-cw');
    const svg =container.querySelector('#fta-svg');

    // ── Drop from FFC panel ──────────────────────────────────────────────────
    wrap.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('application/fta-ffc')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    wrap.addEventListener('drop', async e => {
      const raw = e.dataTransfer.getData('application/fta-ffc');
      if (!raw) return;
      e.preventDefault();
      const { label, code } = JSON.parse(raw);
      // Convert drop position to canvas coordinates
      const rect = wrap.getBoundingClientRect();
      const cx   = (e.clientX - rect.left - _pan.x) / _zoom;
      const cy   = (e.clientY - rect.top  - _pan.y) / _zoom;
      const nodeCode = nextCode('basic');
      const { data, error } = await sb.from('fta_nodes').insert({
        parent_type: parentType, parent_id: parentId, project_id: project.id,
        hazard_id: _activeHazardId === UNLINKED_ID ? null : _activeHazardId,
        type: 'basic', label, component: code, fta_code: nodeCode,
        x: cx, y: cy, sort_order: _nodes.length, color: '',
      }).select().single();
      if (error) { toast('Error inserting node.', 'error'); return; }
      _nodes.push(data);
      _selSet.clear(); _selSet.add(data.id);
      recomputeMCS(); render();
      refreshFFCPanelIfOpen();
      toast(`Added basic event: ${nodeCode}`, 'success');
    });

    wrap.addEventListener('wheel',e=>{
      e.preventDefault();
      const rect=wrap.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const bef={x:(mx-_pan.x)/_zoom,y:(my-_pan.y)/_zoom};
      _zoom=Math.min(3,Math.max(0.15,_zoom*(e.deltaY<0?1.1:0.9)));
      _pan.x=mx-bef.x*_zoom; _pan.y=my-bef.y*_zoom;
      applyTransform();
    },{passive:false});

    svg.addEventListener('contextmenu', e=>e.preventDefault());

    svg.addEventListener('mousedown',e=>{
      if (e.button===1){ e.preventDefault(); _panDrag=true; _panStart={x:e.clientX-_pan.x,y:e.clientY-_pan.y}; wrap.style.cursor='grabbing'; return; }

      // Right-click: copy drag on node, pan on empty canvas
      if (e.button===2) {
        const nodeEl=e.target.closest('.fta-node');
        if (nodeEl) {
          e.stopPropagation();
          const clickedId=nodeEl.dataset.id;
          // If the clicked node is part of a multi-selection, copy all selected; otherwise just this node
          const ids = (_selSet.size>1 && _selSet.has(clickedId)) ? [..._selSet] : [clickedId];
          const pt=toSvg(e);
          _copyDrag={ids, startX:pt.x, startY:pt.y, curX:pt.x, curY:pt.y};
          return;
        }
        // Empty canvas right-click → pan
        _panDrag=true; _panStart={x:e.clientX-_pan.x,y:e.clientY-_pan.y};
        wrap.style.cursor='grabbing';
        return;
      }

      // SPF annotation click
      const annotEl = e.target.closest('.fta-spf-annot');
      if (annotEl) { e.stopPropagation(); openSpfDialog(annotEl.dataset.spfFor); return; }

      // "+" add-child button
      const addBtn=e.target.closest('.fta-add-child');
      if (addBtn) { e.stopPropagation(); closeAddMenu(); showAddMenu(addBtn.dataset.addFor, e.clientX, e.clientY); return; }

      // Port drag → connection
      const portEl=e.target.closest('.fta-port');
      if (portEl){ e.stopPropagation(); const pt=toSvg(e); _conn={fromId:portEl.dataset.portFor,curX:pt.x,curY:pt.y}; return; }

      const nodeEl=e.target.closest('.fta-node');
      if (nodeEl) {
        e.stopPropagation();
        const id=nodeEl.dataset.id;
        // If already selected: single click → edit field (not gates — gates use dblclick)
        if (_selSet.has(id) && !e.shiftKey) {
          const n=byId(id);
          if (!isGate(n?.type)) {
            const pt=toSvg(e);
            const field=fieldAtY(n, pt.y);
            if (field) { editField(id, field); return; }
          }
        }

        if (e.shiftKey) {
          _selSet.has(id)?_selSet.delete(id):_selSet.add(id);
          onSelectionChanged();
          render(); return;
        }
        if (!_selSet.has(id)) { _selSet.clear(); _selSet.add(id); }
        onSelectionChanged();
        // For gates: suppress render on 2nd rapid mousedown so dblclick can fire
        const n2=byId(id);
        if (isGate(n2?.type) && _lastGateClick?.id===id && Date.now()-_lastGateClick.t < 400) {
          _lastGateClick = null;
          return; // let dblclick handle it
        }
        if (isGate(n2?.type)) _lastGateClick = { id, t: Date.now() };
        else _lastGateClick = null;
        // Start drag for all selected
        closeEditor();
        pushUndo(`Move ${[..._selSet].map(sid=>byId(sid)?.fta_code||'node').join(', ')}`);
        const pt=toSvg(e);
        _drag={ origins:[..._selSet].map(sid=>{const sn=byId(sid);return{id:sid,ox:sn.x,oy:sn.y};}), mx:pt.x, my:pt.y };
        render(); return;
      }

      // Empty canvas — close any open menu/editor
      closeAddMenu(); closeEditor();
      if (_space) {
        _panDrag=true; _panStart={x:e.clientX-_pan.x,y:e.clientY-_pan.y};
      } else {
        if (!e.shiftKey) _selSet.clear();
        const pt=toSvg(e);
        _lasso={x1:pt.x,y1:pt.y,x2:pt.x,y2:pt.y};
      }
      render();
    });

    svg.addEventListener('mousemove',e=>{
      if (_copyDrag) { const pt=toSvg(e); _copyDrag.curX=pt.x; _copyDrag.curY=pt.y; renderCopyGhost(); return; }
      if (_conn) { const pt=toSvg(e); _conn.curX=pt.x; _conn.curY=pt.y; renderPendingConn(); return; }
      if (_drag) {
        const pt=toSvg(e); const dx=pt.x-_drag.mx, dy=pt.y-_drag.my;
        _drag.origins.forEach(({id,ox,oy})=>{ const n=byId(id); if(n){n.x=ox+dx;n.y=oy+dy;} });
        render(); return;
      }
      if (_lasso) { const pt=toSvg(e); _lasso.x2=pt.x; _lasso.y2=pt.y; renderLasso(); return; }
      if (_panDrag) { _pan.x=e.clientX-_panStart.x; _pan.y=e.clientY-_panStart.y; applyTransform(); }
    });

    svg.addEventListener('mouseup',async e=>{
      if (_copyDrag) {
        const cd=_copyDrag; _copyDrag=null;
        document.getElementById('fta-copy-g').innerHTML='';
        const dx=cd.curX-cd.startX, dy=cd.curY-cd.startY;
        if (Math.abs(dx)>15||Math.abs(dy)>15) {
          await finishMultiCopyDrag(cd.ids, dx, dy);
        }
        return;
      }
      if (_conn) {
        const nodeEl=e.target.closest('.fta-node');
        const fromId=_conn.fromId; _conn=null; renderPendingConn();
        if (nodeEl&&nodeEl.dataset.id!==fromId) await createConn(fromId,nodeEl.dataset.id);
        return;
      }
      if (_drag) {
        document.getElementById('fta-guides-g').innerHTML='';
        await Promise.all(_drag.origins.map(async({id})=>{ const n=byId(id); if(n) await autosave(id,{x:n.x,y:n.y}); }));
        _drag=null;
      }
      if (_lasso) {
        const lx1=Math.min(_lasso.x1,_lasso.x2), lx2=Math.max(_lasso.x1,_lasso.x2);
        const ly1=Math.min(_lasso.y1,_lasso.y2), ly2=Math.max(_lasso.y1,_lasso.y2);
        if (lx2-lx1>5||ly2-ly1>5) {
          _nodes.forEach(n=>{ if(n.x>=lx1&&n.x<=lx2&&n.y>=ly1&&n.y<=ly2) _selSet.add(n.id); });
        }
        _lasso=null; render();
      }
      if (_panDrag && !_space) wrap.style.cursor='default';
      _panDrag=false;
    });

    // Double-click on a gate → open type picker
    svg.addEventListener('dblclick', e => {
      const nodeEl = e.target.closest('.fta-node');
      if (!nodeEl) return;
      const id = nodeEl.dataset.id;
      const n  = byId(id);
      if (n && isGate(n.type)) { e.stopPropagation(); openGatePicker(id); }
    });

  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  function wireKeyboard() {
    const onKey=e=>{
      if (e.target.closest('input,textarea,select')) return;
      if (e.key===' ') { e.preventDefault(); _space=true; const cw=container.querySelector('#fta-cw'); if(cw) cw.style.cursor='grab'; }
      if (e.key==='Delete'||e.key==='Backspace') deleteSelected();
      if (e.key==='Escape') { _selSet.clear(); render(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==='a') { e.preventDefault(); _nodes.forEach(n=>_selSet.add(n.id)); render(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undo(); }
    };
    const onKeyUp=e=>{
      if (e.key===' ') { _space=false; const cw=container.querySelector('#fta-cw'); if(cw) cw.style.cursor='default'; }
    };
    document.addEventListener('keydown',onKey);
    document.addEventListener('keyup',onKeyUp);
    // Cleanup when container is replaced
    const observer=new MutationObserver(()=>{
      if (!document.contains(container)) { document.removeEventListener('keydown',onKey); document.removeEventListener('keyup',onKeyUp); observer.disconnect(); }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  // ── Connect ──────────────────────────────────────────────────────────────────
  async function createConn(parentId,childId) {
    if (isDescendant(parentId,childId)) { toast('Cycle detected — not connected.','error'); return; }
    const child=byId(childId); if(!child) return;
    // If child already has a parent, sever the old connection first
    const oldParentId = child.parent_node_id;
    pushUndo(`Connect ${byId(parentId)?.fta_code||'?'} → ${child.fta_code||'?'}`);
    child.parent_node_id=parentId;
    await autosave(childId,{parent_node_id:parentId});
    // Re-balance the new parent's children and the old parent if it changed
    await redistributeChildren(parentId);
    if (oldParentId && oldParentId !== parentId) await redistributeChildren(oldParentId);
    recomputeMCS(); render();
    syncAndGateReq(parentId);
  }
  function isDescendant(nid,ancId) {
    let c=byId(nid); const seen=new Set();
    while(c?.parent_node_id){ if(seen.has(c.id))break; seen.add(c.id); if(c.parent_node_id===ancId)return true; c=byId(c.parent_node_id); }
    return false;
  }

  // ── Copy drag ────────────────────────────────────────────────────────────────
  function renderCopyGhost() {
    const layer=document.getElementById('fta-copy-g'); if(!layer) return; layer.innerHTML='';
    if (!_copyDrag) return;
    const dx=_copyDrag.curX-_copyDrag.startX, dy=_copyDrag.curY-_copyDrag.startY;
    if (Math.abs(dx)<5&&Math.abs(dy)<5) return;
    _copyDrag.ids.forEach(id=>{
      const orig=byId(id); if(!orig) return;
      const nx=orig.x+dx, ny=orig.y+dy;
      const hw=nw(orig)/2, hh=nh(orig)/2;
      const r=svgEl('rect');
      r.setAttribute('x',nx-hw); r.setAttribute('y',ny-hh);
      r.setAttribute('width',nw(orig)); r.setAttribute('height',nh(orig));
      r.setAttribute('fill','rgba(26,115,232,0.12)'); r.setAttribute('stroke','#1A73E8');
      r.setAttribute('stroke-width','2'); r.setAttribute('stroke-dasharray','6,3');
      r.setAttribute('rx','5'); r.setAttribute('pointer-events','none');
      layer.appendChild(r);
    });
    // Label on first ghost
    const first=byId(_copyDrag.ids[0]); if(!first) return;
    const t=svgEl('text');
    t.setAttribute('x',first.x+dx); t.setAttribute('y',first.y+dy);
    t.setAttribute('text-anchor','middle'); t.setAttribute('dominant-baseline','middle');
    t.setAttribute('font-size','10'); t.setAttribute('fill','#1A73E8');
    t.setAttribute('pointer-events','none');
    t.textContent=_copyDrag.ids.length>1?`Copy ×${_copyDrag.ids.length}`:'Copy';
    layer.appendChild(t);
  }

  async function finishMultiCopyDrag(ids, dx, dy) {
    pushUndo(`Copy ${ids.length} node${ids.length>1?'s':''}`);
    const newNodes=[];
    // Build id-map for remapping parent_node_id within the copied group
    const idMap={};
    for (const origId of ids) {
      const orig=byId(origId); if(!orig) continue;
      const code=nextCode(orig.type);
      const {data,error}=await sb.from('fta_nodes').insert({
        parent_type:parentType, parent_id:parentId, project_id:project.id,
        hazard_id: _activeHazardId === UNLINKED_ID ? null : _activeHazardId,
        type:orig.type, label:orig.label, component:orig.component, fta_code:code,
        x:orig.x+dx, y:orig.y+dy, sort_order:_nodes.length+newNodes.length, color:orig.color,
        probability:orig.probability, failure_rate:orig.failure_rate, mttr:orig.mttr,
        parent_node_id:null,
      }).select().single();
      if (error){toast('Error copying node.','error');return;}
      _nodes.push(data); newNodes.push({data,orig});
      idMap[origId]=data.id;
    }
    // Reconnect intra-group parent_node_id references
    for (const {data,orig} of newNodes) {
      if (orig.parent_node_id && idMap[orig.parent_node_id]) {
        data.parent_node_id=idMap[orig.parent_node_id];
        await autosave(data.id,{parent_node_id:data.parent_node_id});
      }
    }
    // For single-node copy, ask about connecting to same parent
    if (newNodes.length===1) {
      const {data,orig}=newNodes[0];
      if (orig.parent_node_id && !idMap[orig.parent_node_id]) {
        const doConn=await confirmCopyConnect(orig);
        if (doConn) {
          data.parent_node_id=orig.parent_node_id;
          await autosave(data.id,{parent_node_id:orig.parent_node_id});
          await redistributeChildren(orig.parent_node_id);
        }
      }
    }
    _selSet.clear(); newNodes.forEach(({data})=>_selSet.add(data.id)); recomputeMCS(); render();
  }

  function confirmCopyConnect(orig) {
    const parent=byId(orig.parent_node_id);
    return new Promise(resolve=>{
      const overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center';
      const box=document.createElement('div');
      box.style.cssText='background:#fff;border-radius:8px;padding:24px 28px;box-shadow:0 8px 32px rgba(0,0,0,.18);max-width:360px;width:100%;font-family:inherit';
      box.innerHTML=`
        <div style="font-size:15px;font-weight:600;margin-bottom:8px">Connect copy to same parent?</div>
        <div style="font-size:13px;color:#555;margin-bottom:20px">Parent: <strong>${esc(parent?.fta_code||'?')}</strong>. Connect the new node and redistribute children?</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="cc-no"  style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">No, leave free</button>
          <button id="cc-yes" style="padding:6px 16px;border:none;border-radius:4px;background:#1A73E8;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Yes, connect</button>
        </div>`;
      overlay.appendChild(box); document.body.appendChild(overlay);
      const cleanup=ok=>{overlay.remove();resolve(ok);};
      box.querySelector('#cc-yes').addEventListener('click',()=>cleanup(true));
      box.querySelector('#cc-no').addEventListener('click',()=>cleanup(false));
      overlay.addEventListener('click',e=>{if(e.target===overlay)cleanup(false);});
    });
  }

  // ── Add-child menu ────────────────────────────────────────────────────────────
  function closeAddMenu() {
    if (_activeMenu) { _activeMenu.remove(); _activeMenu=null; }
  }

  function showAddMenu(parentId, clientX, clientY) {
    closeAddMenu();
    const wrap = container.querySelector('#fta-cw');
    const rect = wrap.getBoundingClientRect();
    const left = clientX - rect.left + 10;
    const top  = clientY - rect.top  + 10;

    const menu = document.createElement('div');
    menu.className = 'fta-add-menu';
    menu.style.cssText = `left:${left}px;top:${top}px`;

    // Two-column layout: Events left, Gates right
    const cols = document.createElement('div');
    cols.style.cssText='display:flex;gap:2px';

    const events=[
      {type:'top_event',    label:'⬛ Top'},
      {type:'intermediate', label:'▭ Interm.'},
      {type:'basic',        label:'● Basic'},
      {type:'undeveloped',  label:'◇ Undev.'},
      {type:'transfer',     label:'△ Transfer'},
    ];
    const gates=[
      {type:'gate_and',    label:'∧ AND'},
      {type:'gate_or',     label:'∨ OR'},
      {type:'gate_not',    label:'¬ NOT'},
      {type:'gate_inhibit',label:'⊘ INH'},
    ];

    [{ title:'Events', items:events }, { title:'Gates', items:gates }].forEach(col=>{
      const wrap=document.createElement('div');
      wrap.style.cssText='flex:1;min-width:100px';
      const hdr=document.createElement('div');
      hdr.className='fta-add-menu-section'; hdr.textContent=col.title;
      wrap.appendChild(hdr);
      col.items.forEach(({type,label})=>{
        const btn=document.createElement('button');
        btn.className='fta-add-menu-item'; btn.textContent=label;
        btn.addEventListener('mousedown',async e=>{
          e.stopPropagation(); closeAddMenu(); await addChildNode(parentId,type);
        });
        wrap.appendChild(btn);
      });
      cols.appendChild(wrap);
    });
    menu.appendChild(cols);

    wrap.appendChild(menu);
    _activeMenu = menu;

    // Close on outside click (next tick so this mousedown doesn't immediately close it)
    setTimeout(() => {
      document.addEventListener('mousedown', closeAddMenu, { once:true, capture:true });
    }, 0);
  }

  // ── Add child node (connected + redistributed) ────────────────────────────────
  async function addChildNode(parentId, type) {
    const parent = byId(parentId); if (!parent) return;
    pushUndo(`Add ${CODE_PFX[type]||type} under ${parent.fta_code||'node'}`);
    const siblings = _nodes.filter(n => n.parent_node_id === parentId);
    const cx = parent.x;
    const cy = parent.y + _cfg.childY;
    const code = nextCode(type);
    const { data, error } = await sb.from('fta_nodes').insert({
      parent_type:parentType, parent_id:parentId, project_id:project.id,
      hazard_id: _activeHazardId === UNLINKED_ID ? null : _activeHazardId,
      type, label:'', component:'', fta_code:code,
      x:cx, y:cy, sort_order:_nodes.length, color:'',
      parent_node_id: parentId,
    }).select().single();
    if (error) { toast('Error adding node.','error'); return; }
    _nodes.push(data);
    await redistributeChildren(parentId);
    _selSet.clear(); _selSet.add(data.id);
    recomputeMCS(); render();
    syncAndGateReq(parentId);
    { const h=document.getElementById('fta-hint'); if(h) h.style.display='none'; }
  }

  // Redistribute all direct children of a node horizontally, centred on parent
  async function redistributeChildren(parentId) {
    const parent = byId(parentId); if (!parent) return;
    const children = _nodes.filter(n => n.parent_node_id === parentId);
    const n = children.length;
    if (!n) return;
    const childGap = Math.max(BOX_W + 20, _cfg.childY * 1.3);
    const totalW = (n - 1) * childGap;
    const startX = parent.x - totalW / 2;
    const childY = parent.y + _cfg.childY;
    const saves = [];
    children.forEach((c, i) => {
      c.x = startX + i * childGap;
      c.y = childY;
      saves.push(autosave(c.id, { x:c.x, y:c.y }));
    });
    await Promise.all(saves);
  }

  // ── Add node ─────────────────────────────────────────────────────────────────
  async function addNode(type) {
    pushUndo(`Add ${CODE_PFX[type]||type}`);
    const t=NT[type]||NT.basic;
    const wrap=container.querySelector('#fta-cw');
    const cx=(wrap ? wrap.offsetWidth/2-_pan.x : 300)/_zoom + (_nodes.length%5)*18-36;
    const cy=(wrap ? wrap.offsetHeight/2-_pan.y : 200)/_zoom + (_nodes.length%5)*18-36;
    const code=nextCode(type);
    const {data,error}=await sb.from('fta_nodes').insert({
      parent_type:parentType, parent_id:parentId, project_id:project.id,
      hazard_id: _activeHazardId === UNLINKED_ID ? null : _activeHazardId,
      type, label:'', component:'', fta_code:code,
      x:cx, y:cy, sort_order:_nodes.length, color:'',
    }).select().single();
    if (error){toast('Error adding node.','error');return;}
    _nodes.push(data);
    _selSet.clear(); _selSet.add(data.id);
    recomputeMCS(); render();
    { const h=document.getElementById('fta-hint'); if(h) h.style.display='none'; }
  }

  // ── Inline editor (SVG foreignObject — lives inside the transform group) ──────
  function closeEditor() {
    if (_editFo) { _editFo.remove(); _editFo = null; }
  }

  function openEditor(x, y, w, h, value, isNum, onCommit) {
    closeEditor();
    const layer = container.querySelector('#fta-edit-g'); if (!layer) return;
    const fo = svgEl('foreignObject');
    fo.setAttribute('x', x); fo.setAttribute('y', y);
    fo.setAttribute('width', w); fo.setAttribute('height', h);

    const inp = document.createElement('input');
    inp.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
    inp.type = isNum ? 'number' : 'text';
    if (isNum) { inp.step = 'any'; inp.min = '0'; }
    inp.value = value != null ? value : '';
    inp.style.cssText = [
      'width:100%','height:100%','box-sizing:border-box',
      'border:2px solid #1A73E8','background:#EEF4FF',
      'font-size:11px','padding:0 5px','outline:none',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'color:#172B4D','border-radius:0',
    ].join(';');

    fo.appendChild(inp);
    layer.appendChild(fo);
    _editFo = fo;

    // defer focus so mousedown finishes first
    requestAnimationFrame(() => { inp.focus(); inp.select(); });

    let committed = false;
    const commit = async () => {
      if (committed) return; committed = true;
      closeEditor();
      let v = inp.value.trim();
      if (isNum) v = v === '' ? null : parseFloat(v);
      await onCommit(v);
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { committed = true; closeEditor(); render(); }
    });
  }

  function editField(id, field) {
    if (field === 'fta_code') return; // auto-generated, read-only
    const n = byId(id); if (!n) return;
    const base = NT[n.type]||NT.basic;
    const isNum = field==='probability'||field==='failure_rate'||field==='mttr';
    const hh = boxH(n.label)/2, hw = BOX_W/2;
    let rx = n.x-hw, ry, rw = BOX_W, rh;
    const lblRH = Math.max(ROW_STD, labelLines(n.label||'').length*LINE_H+8);
    if      (field==='fta_code')  { ry=n.y-hh;                 rh=ROW_CODE; }
    else if (field==='component') { ry=n.y-hh+ROW_CODE;         rh=ROW_STD;  }
    else if (field==='label')     { ry=n.y-hh+ROW_CODE+ROW_STD; rh=lblRH;   }
    else {
      // external numeric fields (below indicator)
      const IND_R3=13;
      let ey = n.y+hh+(n.type==='top_event'?14:8)+(base.indicator?IND_R3+2+IND_R3+5:0);
      rw=100; rx=n.x-50; rh=16;
      if (field==='probability')  { ry=ey-8; }
      else { ey+=(_cfg.showProbability?14:0);
        if (field==='failure_rate') { ry=ey-8; }
        else { ey+=(_cfg.showFR?14:0); ry=ey-8; }
      }
    }
    openEditor(rx, ry, rw, rh, n[field], isNum, async v => {
      if (v===(n[field]??'')) { render(); return; }
      pushUndo(`Edit ${n.fta_code||'node'} ${field}`);
      n[field]=v; await autosave(id,{[field]:v}); render();
    });
  }

  function openGatePicker(id) {
    const n = byId(id); if (!n) return;
    const GATE_OPTS = [
      { type:'gate_and',     icon:'∧', label:'AND' },
      { type:'gate_or',      icon:'∨', label:'OR'  },
      { type:'gate_not',     icon:'¬', label:'NOT' },
      { type:'gate_inhibit', icon:'⊘', label:'INH' },
    ];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:10px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit;min-width:260px';
    box.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#172B4D;margin-bottom:14px">Change gate type — <span style="color:#666;font-weight:400">${esc(n.fta_code||'gate')}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${GATE_OPTS.map(g => `
          <button data-gtype="${g.type}" style="padding:10px 8px;border:2px solid ${n.type===g.type?'#1A73E8':'#ddd'};border-radius:8px;background:${n.type===g.type?'#e8f0fe':'#fff'};cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:${n.type===g.type?'#1A73E8':'#333'}">
            <span style="font-size:18px">${g.icon}</span>${g.label}
            ${n.type===g.type?'<span style="margin-left:auto;font-size:10px;color:#1A73E8">current</span>':''}
          </button>`).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button id="gp-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
    box.querySelector('#gp-cancel').addEventListener('click', cleanup);
    box.querySelectorAll('[data-gtype]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newType = btn.dataset.gtype;
        cleanup();
        if (newType === n.type) return;
        const oldType = n.type;
        pushUndo(`Change gate ${n.fta_code||'gate'} → ${newType}`);
        n.type = newType;
        n.label = '';  // reset label so NT default for new type shows
        await autosave(id, { type: newType, label: '' });
        recomputeMCS(); render();
        // Sync independence requirement: AND↔other
        if (oldType === 'gate_and' && newType !== 'gate_and') {
          // Removing AND → delete requirement
          const gateSource = `FTA-AND:${id}`;
          const { data: existing } = await sb.from('requirements')
            .select('id').eq('project_id', project.id).eq('source', gateSource).maybeSingle();
          if (existing) {
            await sb.from('requirements').delete().eq('id', existing.id);
            _safetyReqs = _safetyReqs.filter(r => r.source !== gateSource);
            renderSreqsBar();
          }
        } else if (oldType !== 'gate_and' && newType === 'gate_and') {
          // Becoming AND → create requirement if ≥2 children
          syncAndGateReq(id);
        }
      });
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  const DEL_SKIP_KEY = 'fta_del_no_confirm';

  async function confirmDelete(ids) {
    if (localStorage.getItem(DEL_SKIP_KEY) === '1') return true;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;border-radius:8px;padding:24px 28px;box-shadow:0 8px 32px rgba(0,0,0,.18);max-width:340px;width:100%;font-family:inherit';
      const names = ids.map(id=>byId(id)?.fta_code||'node').join(', ');
      box.innerHTML = `
        <div style="font-size:15px;font-weight:600;margin-bottom:8px">Delete node${ids.length>1?'s':''}?</div>
        <div style="font-size:13px;color:#555;margin-bottom:16px">${esc(names)}</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#555;margin-bottom:20px;cursor:pointer">
          <input type="checkbox" id="fta-del-skip"> Don't ask again
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="fta-del-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
          <button id="fta-del-ok" style="padding:6px 16px;border:none;border-radius:4px;background:#d93025;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Delete</button>
        </div>`;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const cleanup = ok => {
        if (ok && box.querySelector('#fta-del-skip').checked) localStorage.setItem(DEL_SKIP_KEY,'1');
        overlay.remove(); resolve(ok);
      };
      box.querySelector('#fta-del-ok').addEventListener('click', () => cleanup(true));
      box.querySelector('#fta-del-cancel').addEventListener('click', () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target===overlay) cleanup(false); });
    });
  }

  async function deleteSelected() {
    if (!_selSet.size) return;
    const ids=[..._selSet];
    if (!await confirmDelete(ids)) return;
    pushUndo(`Delete ${ids.map(id=>byId(id)?.fta_code||'node').join(', ')}`);
    // Collect parent IDs to redistribute after delete (skip parents that are also being deleted)
    const parentsToRedist = new Set();
    for (const id of ids) {
      const node = byId(id);
      if (node?.parent_node_id && !ids.includes(node.parent_node_id)) parentsToRedist.add(node.parent_node_id);
    }
    for (const id of ids) {
      _nodes.filter(c=>c.parent_node_id===id).forEach(c=>{c.parent_node_id=null; autosave(c.id,{parent_node_id:null});});
      await sb.from('fta_nodes').delete().eq('id',id);
    }
    _nodes=_nodes.filter(n=>!ids.includes(n.id));
    // Re-balance siblings symmetrically
    for (const pid of parentsToRedist) {
      if (byId(pid)) await redistributeChildren(pid);
    }
    _selSet.clear(); recomputeMCS(); render();
    refreshFFCPanelIfOpen();
    // Sync requirements for any AND gate parents that lost children
    for (const pid of parentsToRedist) { syncAndGateReq(pid); }
  }

  function updateDelBtn() {
    const b=container.querySelector('#fta-btn-del'); if(b) b.disabled=!_selSet.size;
    const colorBtn=container.querySelector('#fta-color-btn');
    if (colorBtn) colorBtn.disabled=!_selSet.size;
    // Sync swatch and custom input to first selected node's colour
    const sw=container.querySelector('#fta-color-swatch');
    const inp=container.querySelector('#fta-color-inp');
    if (_selSet.size) {
      const n=byId([..._selSet][0]);
      const col=n?.color?.startsWith('#')?n.color:'';
      if (sw) sw.style.background=col||'transparent';
      if (inp&&col) inp.value=col;
    } else {
      if (sw) sw.style.background='transparent';
    }
  }

  // ── Auto layout ───────────────────────────────────────────────────────────────
  function relayoutInMemory() {
    if (!_nodes.length) return;
    const ch=Object.fromEntries(_nodes.map(n=>[n.id,[]]));
    _nodes.forEach(n=>{if(n.parent_node_id&&ch[n.parent_node_id])ch[n.parent_node_id].push(n);});
    const ids=new Set(_nodes.map(n=>n.id));
    const roots=_nodes.filter(n=>!n.parent_node_id||!ids.has(n.parent_node_id));
    if (!roots.length) roots.push(_nodes[0]);
    const NW=Math.max(BOX_W+20, _cfg.childY*1.3);
    const GAP=Math.round(NW*0.3);
    function lay(n,sx,d){ n.y=80+d*_cfg.childY; const kids=ch[n.id]||[]; if(!kids.length){n.x=sx+NW/2;return NW;} let cx=sx; kids.forEach((k,i)=>{const w=lay(k,cx,d+1);cx+=w+(i<kids.length-1?GAP:0);}); n.x=(kids[0].x+kids[kids.length-1].x)/2; return Math.max(NW,cx-sx); }
    let cx=80; roots.forEach(r=>{const w=lay(r,cx,0);cx+=w+GAP*2;});
  }

  async function autoLayout() {
    if (!_nodes.length) return;
    relayoutInMemory();
    await Promise.all(_nodes.map(n=>autosave(n.id,{x:n.x,y:n.y})));
    // Reset userMoved on all SPF panels so they recentre below their (new) node positions
    Object.values(_spfAnnotState).forEach(s => { s.userMoved = false; });
    saveSpfAnnotState();
    render(); toast('Layout applied.','success');
  }

  // ── FHA INFO helpers ──────────────────────────────────────────────────────────
  function getActiveFC() { return _fcs.find(f => f.id === _activeHazardId) || null; }

  // Declared with var so they are hoisted above render() calls that happen before this line
  var CLS_COLOR = {
    catastrophic: '#d93025', hazardous: '#E37400', major: '#F9AB00',
    minor: '#1A73E8', 'no safety effect': '#555',
  };
  var DAL_COLOR = { 'DAL-A':'#d93025','DAL-B':'#E37400','DAL-C':'#F9AB00','DAL-D':'#1E8E3E','DAL-E':'#555' };

  function fhaInfoHTML(fc) {
    if (!fc) return '';
    const d = fc.data || {};
    const cls = (d.classification||'').toLowerCase();
    const clsColor = CLS_COLOR[cls] || '#555';
    const dalColor = DAL_COLOR[d.dal] || '#555';
    const badge = (text, color) => text
      ? `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700;background:${color}18;color:${color};border:1px solid ${color}40">${esc(text)}</span>`
      : '';
    const row = (label, value) => value
      ? `<div class="fta-info-row"><span class="fta-info-label">${label}</span><span class="fta-info-value">${esc(value)}</span></div>`
      : '';
    return `
      <div class="fta-info-section">
        <div class="fta-info-hdr">
          <span class="fta-info-code">${esc(fc.haz_code)}</span>
          <span class="fta-info-status">${esc(fc.status||'')}</span>
        </div>
        ${d.failure_condition ? `<div class="fta-info-fc">${esc(d.failure_condition)}</div>` : ''}
        <div class="fta-info-badges">${badge(d.classification, clsColor)} ${badge(d.dal, dalColor)}</div>
        ${row('Phase', d.phase_of_op)}
        ${row('Local effect', d.effect_local)}
        ${row('System effect', d.effect_system)}
      </div>
      <div class="fta-prop-sep"></div>`;
  }

  // ── Properties panel ─────────────────────────────────────────────────────────
  function updatePropPanel() {
    const body=container.querySelector('#fta-prop-body'); if(!body) return;

    // Flush any in-progress edit — innerHTML removal does NOT fire blur in browsers
    const activeInp = body.querySelector('input:focus');
    if (activeInp) {
      const field=activeInp.dataset.field, nid=activeInp.dataset.nid;
      const node=byId(nid);
      if (node && field) {
        let v=activeInp.value.trim();
        if(activeInp.type==='number') v=v===''?null:parseFloat(v);
        if(v!==(node[field]??'')) { node[field]=v; autosave(nid,{[field]:v}); }
      }
    }

    const infoBlock = fhaInfoHTML(getActiveFC());

    if (_selSet.size!==1) {
      const hint = _selSet.size===0
        ? '<div class="fta-prop-empty">← Select a node</div>'
        : `<div class="fta-prop-empty">${_selSet.size} nodes selected</div>`;
      body.innerHTML = infoBlock + hint;
      return;
    }
    const n=byId([..._selSet][0]); if(!n) return;
    const isGateNode=isGate(n.type);
    const fields=[
      {key:'component',    label:'Component',   type:'text'},
      {key:'label',        label:isGateNode?'Gate label':'Failure',    type:'text'},
    ];
    const numFields=[
      {key:'probability',  label:'Probability (P)',   type:'number'},
      {key:'failure_rate', label:'Failure Rate (FR)',  type:'number'},
      {key:'mttr',         label:'MTTR',              type:'number'},
    ];
    let html=`<div class="fta-prop-type">${(NT[n.type]?.label||n.type).replace(/_/g,' ')}</div>`;
    // ID is auto-generated and read-only
    html+=`<div class="fta-prop-field">
      <label class="fta-prop-label">ID</label>
      <div class="fta-prop-readonly">${esc(n.fta_code||'')}</div>
    </div>`;
    fields.forEach(f=>{
      const val=esc(n[f.key]||'');
      html+=`<div class="fta-prop-field">
        <label class="fta-prop-label">${f.label}</label>
        <input class="fta-prop-input" type="${f.type}" value="${val}" data-field="${f.key}" data-nid="${n.id}">
      </div>`;
    });
    html+='<div class="fta-prop-sep"></div>';
    numFields.forEach(f=>{
      const val=n[f.key]!=null?n[f.key]:'';
      html+=`<div class="fta-prop-field">
        <label class="fta-prop-label">${f.label}</label>
        <input class="fta-prop-input" type="number" step="any" min="0" value="${val}" data-field="${f.key}" data-nid="${n.id}">
      </div>`;
    });
    if (isGateNode && _cfg.showProbability) {
      const cp=computeP(n);
      html+=`<div class="fta-prop-computed">Computed P = ${cp!=null?fmtNum(cp):'—'}</div>`;
    }
    body.innerHTML=infoBlock+html;
    // Wire autosave on blur
    body.querySelectorAll('.fta-prop-input').forEach(inp=>{
      inp.addEventListener('blur',async()=>{
        const field=inp.dataset.field, nid=inp.dataset.nid;
        const node=byId(nid); if(!node) return;
        let v=inp.value.trim();
        if(inp.type==='number') v=v===''?null:parseFloat(v);
        if(v===(node[field]??'')) return;
        pushUndo(`Edit ${node.fta_code||'node'} ${field}`);
        node[field]=v; await autosave(nid,{[field]:v}); render();
      });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter') inp.blur(); });
    });
  }

  // ── Alignment guides ──────────────────────────────────────────────────────────
  function renderGuides() {
    const layer=document.getElementById('fta-guides-g'); if(!layer){return;} layer.innerHTML='';
    if (!_drag) return;
    const THRESH=10, EXT=300;
    _drag.origins.forEach(({id})=>{
      const dn=byId(id); if(!dn) return;
      _nodes.forEach(other=>{
        if(_drag.origins.find(o=>o.id===other.id)) return;
        // Vertical guide (same X)
        if(Math.abs(dn.x-other.x)<THRESH){
          dn.x=other.x;
          const yl=Math.min(dn.y,other.y)-EXT, yh=Math.max(dn.y,other.y)+EXT;
          const l=svgEl('line');
          l.setAttribute('x1',other.x); l.setAttribute('y1',yl);
          l.setAttribute('x2',other.x); l.setAttribute('y2',yh);
          l.setAttribute('stroke','#1A73E8'); l.setAttribute('stroke-width','1');
          l.setAttribute('stroke-dasharray','5,3'); l.setAttribute('opacity','0.7');
          l.setAttribute('pointer-events','none'); layer.appendChild(l);
        }
        // Horizontal guide (same Y)
        if(Math.abs(dn.y-other.y)<THRESH){
          dn.y=other.y;
          const xl=Math.min(dn.x,other.x)-EXT, xh=Math.max(dn.x,other.x)+EXT;
          const l=svgEl('line');
          l.setAttribute('x1',xl); l.setAttribute('y1',other.y);
          l.setAttribute('x2',xh); l.setAttribute('y2',other.y);
          l.setAttribute('stroke','#1A73E8'); l.setAttribute('stroke-width','1');
          l.setAttribute('stroke-dasharray','5,3'); l.setAttribute('opacity','0.7');
          l.setAttribute('pointer-events','none'); layer.appendChild(l);
        }
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function toSvg(e){ const wrap=container.querySelector('#fta-cw'),rect=wrap?wrap.getBoundingClientRect():{left:0,top:0}; return{x:(e.clientX-rect.left-_pan.x)/_zoom,y:(e.clientY-rect.top-_pan.y)/_zoom}; }
  function setZoom(z){ _zoom=Math.min(3,Math.max(0.15,z));applyTransform(); }

  function fitAll() {
    if (!_nodes.length) { _zoom=1; _pan={x:100,y:70}; applyTransform(); return; }
    const PAD = 60;
    // Compute bounding box of all node centres (using half-dimensions for edges)
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    _nodes.forEach(n=>{
      const hw=nw(n)/2, hh=nh(n)/2;
      if(n.x-hw<minX) minX=n.x-hw;
      if(n.y-hh<minY) minY=n.y-hh;
      if(n.x+hw>maxX) maxX=n.x+hw;
      if(n.y+hh>maxY) maxY=n.y+hh;
    });
    const wrap=container.querySelector('#fta-cw');
    const vw=wrap ? wrap.clientWidth : 800, vh=wrap ? wrap.clientHeight : 600;
    const contentW=maxX-minX, contentH=maxY-minY;
    const z=Math.min(3, Math.max(0.1, Math.min(
      (vw-PAD*2)/Math.max(contentW,1),
      (vh-PAD*2)/Math.max(contentH,1)
    )));
    _zoom=z;
    _pan.x=(vw-contentW*z)/2 - minX*z;
    _pan.y=(vh-contentH*z)/2 - minY*z;
    applyTransform();
  }

  // Determine which field a SVG Y coordinate falls on for a box node
  function fieldAtY(n, svgY) {
    if (!n || isGate(n.type)) return null;
    const base = NT[n.type]||NT.basic;
    const ry = svgY - n.y;
    const hh = boxH(n.label)/2;
    if (ry >= -hh              && ry < -hh+ROW_CODE)          return 'fta_code';
    if (ry >= -hh+ROW_CODE     && ry < -hh+ROW_CODE+ROW_STD) return 'component';
    if (ry >= -hh+ROW_CODE+ROW_STD && ry < hh)               return 'label';
    // External fields below indicator
    const IND_R2=13;
    let ey = hh + (n.type==='top_event'?14:8);
    if (base.indicator) ey += IND_R2 + 2 + IND_R2 + 5; // indCY + radius + gap
    if (_cfg.showProbability){ if(ry>=ey-7&&ry<ey+7) return 'probability'; ey+=14; }
    if (_cfg.showFR)         { if(ry>=ey-7&&ry<ey+7) return 'failure_rate'; ey+=14; }
    if (_cfg.showMTTR)       { if(ry>=ey-7&&ry<ey+7) return 'mttr'; }
    return null;
  }

  async function autosave(id,fields){
    const{error}=await sb.from('fta_nodes').update({...fields,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)toast('Autosave failed.','error');
  }

  // ── Minimal Cut Sets (MOCUS algorithm) ────────────────────────────────────
  function computeMCS() {
    if (!_nodes.length) return [];
    // Build children map (parent→children)
    const childMap = {};
    _nodes.forEach(n => { childMap[n.id] = []; });
    _nodes.forEach(n => { if (n.parent_node_id && childMap[n.parent_node_id]) childMap[n.parent_node_id].push(n.id); });
    // Find root
    const nodeIds = new Set(_nodes.map(n => n.id));
    const roots = _nodes.filter(n => !n.parent_node_id || !nodeIds.has(n.parent_node_id));
    if (!roots.length) return [];
    const root = roots[0];

    // Recursive expansion — returns array of cut sets (each = array of leaf IDs)
    const seen = new Set();
    function expand(nodeId) {
      if (seen.has(nodeId)) return [[]]; // cycle guard
      seen.add(nodeId);
      const n = byId(nodeId);
      if (!n) { seen.delete(nodeId); return [[]]; }
      const kids = childMap[nodeId] || [];
      if (!kids.length) { seen.delete(nodeId); return [[nodeId]]; } // leaf
      let result;
      if (n.type === 'gate_and' || n.type === 'gate_inhibit') {
        // AND: Cartesian product
        result = [[]];
        for (const kid of kids) {
          const kidSets = expand(kid);
          const next = [];
          for (const r of result) for (const ks of kidSets) next.push([...r, ...ks]);
          result = next;
          if (result.length > 2000) { result = result.slice(0, 2000); break; } // safety limit
        }
      } else {
        // OR / top_event / intermediate / gate_or / gate_not: union
        result = [];
        for (const kid of kids) result.push(...expand(kid));
      }
      seen.delete(nodeId);
      return result;
    }

    const raw = expand(root.id);
    // Deduplicate elements in each set and sort
    const deduped = raw.map(s => [...new Set(s)].sort());
    // Minimize: remove supersets
    const minimized = deduped.filter((s, i) =>
      !deduped.some((other, j) => i !== j && other.length <= s.length && other.every(e => s.includes(e)))
    );
    // Sort by order then by first code
    minimized.sort((a, b) => a.length - b.length || (byId(a[0])?.fta_code||'').localeCompare(byId(b[0])?.fta_code||''));
    return minimized;
  }

  // Compute the set of node IDs on SPF (order-1 MCS) paths from leaf to root.
  // Leaves with spf_status === 'accepted' are excluded — their entire chain loses red
  // unless another non-accepted SPF also runs through the same node.
  function computeSPFNodes(mcs) {
    const spf = new Set();
    const order1 = mcs.filter(s => s.length === 1);
    for (const [leafId] of order1) {
      const leaf = byId(leafId);
      if (leaf?.spf_status === 'accepted') continue; // accepted SPF: skip entire chain
      let cur = byId(leafId);
      const visited = new Set();
      while (cur && !visited.has(cur.id)) {
        visited.add(cur.id);
        spf.add(cur.id);
        if (!cur.parent_node_id) break;
        cur = byId(cur.parent_node_id);
      }
    }
    return spf;
  }

  function renderMCSBar() {
    const bar  = container.querySelector('#fta-mcs-bar');
    const body = container.querySelector('#fta-mcs-body');
    if (!bar || !body) return;

    if (!_mcs.length) {
      body.innerHTML = '<div class="fta-mcs-empty">No cut sets — add basic events and connect them to a top event.</div>';
      return;
    }

    const spfCount = _mcs.filter(s => s.length === 1).length;
    const visible  = _mcs.filter(cs => cs.length <= _mcsMaxOrder);

    const rows = visible.map((cs, i) => {
      const isSpf = cs.length === 1;
      const codes = cs.map(id => byId(id)?.fta_code || id).join(' ∩ ');
      const events = cs.map(id => { const n=byId(id); return esc(n?.label||n?.component||n?.fta_code||id); }).join(', ');
      if (!isSpf) {
        return `<tr>
          <td class="fta-mcs-order">${cs.length}</td>
          <td class="fta-mcs-codes">${esc(codes)}</td>
          <td colspan="4" style="font-size:11px;color:#555">${esc(events)}</td>
        </tr>`;
      }
      const nodeId = cs[0];
      const n = byId(nodeId);
      const just = n?.spf_justification || '';
      const stat = n?.spf_status || 'pending';
      const comm = n?.spf_approver_comment || '';
      return `<tr class="fta-mcs-spf-row" data-nid="${nodeId}">
        <td class="fta-mcs-order">1</td>
        <td class="fta-mcs-codes">${esc(codes)}</td>
        <td style="font-size:11px;color:#555">${esc(events)}</td>
        <td><span class="fta-mcs-spf">SPF</span></td>
        <td>${stat==='accepted'
          ? `<span style="font-size:10px;color:#1E8E3E;font-style:italic;padding:2px 5px">${esc(just)||'—'}</span>`
          : `<input class="fta-mcs-inp" data-nid="${nodeId}" data-field="spf_justification" placeholder="Justification…" value="${esc(just)}" style="width:160px;font-size:10px;padding:2px 5px;border:1px solid #ddd;border-radius:3px;outline:none">`
        }</td>
        <td>
          <select class="fta-mcs-sel" data-nid="${nodeId}" data-field="spf_status" style="font-size:10px;padding:2px 4px;border:1px solid #ddd;border-radius:3px">
            <option value="pending"  ${stat==='pending' ?'selected':''}>Pending</option>
            <option value="accepted" ${stat==='accepted'?'selected':''}>✓ Accepted</option>
            <option value="rejected" ${stat==='rejected'?'selected':''}>Rejected</option>
          </select>
        </td>
        <td><input class="fta-mcs-inp" data-nid="${nodeId}" data-field="spf_approver_comment" placeholder="Approver comment…" value="${esc(comm)}" style="width:140px;font-size:10px;padding:2px 5px;border:1px solid #ddd;border-radius:3px;outline:none"></td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:10px;color:#888;margin-bottom:6px">${_mcs.length} cut set${_mcs.length!==1?'s':''} · ${spfCount} SPF${_mcsMaxOrder<99?' · showing ≤ order '+_mcsMaxOrder+' ('+visible.length+')':''}</div>
      <div style="overflow-x:auto">
      <table class="fta-mcs-table">
        <thead><tr><th>Order</th><th>IDs</th><th>Events</th><th></th><th>Justification</th><th>Status</th><th>Approver comment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    // Wire inline save for SPF fields
    body.querySelectorAll('.fta-mcs-inp').forEach(inp => {
      inp.addEventListener('change', async () => {
        const nid = inp.dataset.nid;
        const field = inp.dataset.field;
        const val = inp.value.trim() || null;
        const node = byId(nid); if (!node) return;
        node[field] = val;
        await sb.from('fta_nodes').update({ [field]: val, updated_at: new Date().toISOString() }).eq('id', nid);
        render();
      });
    });
    body.querySelectorAll('.fta-mcs-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const nid = sel.dataset.nid;
        const val = sel.value;
        const node = byId(nid); if (!node) return;
        node.spf_status = val;
        await sb.from('fta_nodes').update({ spf_status: val, updated_at: new Date().toISOString() }).eq('id', nid);
        recomputeMCS(); // update _spfNodes first (must come before render)
        render();
      });
    });
  }

  // ── Generate Safety Requirements from AND gates ────────────────────────────
  // ── Auto-sync safety requirement for a single AND gate ───────────────────────
  // Called whenever children of an AND gate change (add node, create conn, delete).
  // • < 2 children → delete requirement if it exists
  // • ≥ 2 children → upsert requirement (create or update title/description)
  async function syncAndGateReq(gateId) {
    const gate = byId(gateId);
    if (!gate || gate.type !== 'gate_and') return;

    const gateSource = `FTA-AND:${gateId}`;
    const children   = _nodes.filter(n => n.parent_node_id === gateId);

    // Fetch existing requirement for this gate (if any)
    const { data: existing } = await sb.from('requirements')
      .select('id, req_code')
      .eq('project_id', project.id)
      .eq('source', gateSource)
      .maybeSingle();

    if (children.length < 2) {
      // Not enough children for an independence requirement — delete if exists
      if (existing) {
        await sb.from('requirements').delete().eq('id', existing.id);
        _safetyReqs = _safetyReqs.filter(r => r.source !== gateSource);
        renderSreqsBar();
      }
      return;
    }

    const childNames = children.map(c => c.fta_code || c.label || 'event').join(', ');
    const gateRef    = gate.fta_code || gate.label || 'AND gate';
    const title      = `Independence between failures of: ${childNames} (${gateRef})`;
    const description = `Safety requirement derived from FTA AND gate ${gateRef}. ` +
      `Simultaneous failures of [${childNames}] cause the top-level failure condition. ` +
      `Ensure independence between these failure sources to prevent common-cause failures.`;

    if (existing) {
      // Update title and description to reflect new child list
      await sb.from('requirements').update({
        title, description, updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      // Refresh local cache entry
      const idx = _safetyReqs.findIndex(r => r.source === gateSource);
      if (idx !== -1) { _safetyReqs[idx] = { ..._safetyReqs[idx], title }; }
      else { _safetyReqs.push({ id: existing.id, req_code: existing.req_code, title, status: 'draft', source: gateSource }); }
    } else {
      // Ensure the Safety Requirements nav page exists
      await ensureSafetyReqPage();
      // Generate a new req_code
      const { count: reqCount } = await sb.from('requirements')
        .select('*', { count: 'exact', head: true })
        .eq('parent_type', parentType).eq('parent_id', parentId);
      const pfx      = parentType === 'item' ? 'ITEM' : 'SYS';
      const projAbbr = (project.name||'PRJ').replace(/[^A-Za-z0-9]/g,'').slice(0,4).toUpperCase();
      const reqCode  = `REQ-${pfx}-${projAbbr}-${String((reqCount||0)+1).padStart(3,'0')}`;
      const { data: inserted, error } = await sb.from('requirements').insert({
        req_code: reqCode, title, description,
        type: 'safety-independency', priority: 'high', status: 'draft',
        parent_type: parentType, parent_id: parentId, project_id: project.id,
        source: gateSource,
      }).select('id, req_code, title, status, source').single();
      if (!error && inserted) _safetyReqs.push(inserted);
    }

    _safetyReqs.sort((a,b) => (a.req_code||'').localeCompare(b.req_code||''));
    renderSreqsBar();
  }

  async function ensureSafetyReqPage() {
    const SAFETY_REQ_PAGE_NAME = 'Safety Requirements';
    const { data: existing } = await sb.from('nav_pages')
      .select('id').eq('parent_type', parentType).eq('parent_id', parentId)
      .ilike('name', SAFETY_REQ_PAGE_NAME).maybeSingle();
    if (existing) return;
    const { data: anyPages } = await sb.from('nav_pages')
      .select('domain').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order').limit(1);
    const domain = anyPages?.[0]?.domain || (parentType === 'system' ? 'system' : 'item');
    const { count: pgCount } = await sb.from('nav_pages')
      .select('*', { count: 'exact', head: true })
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', domain).eq('phase', 'requirements');
    await sb.from('nav_pages').insert({
      parent_type: parentType, parent_id: parentId,
      domain, phase: 'requirements',
      name: SAFETY_REQ_PAGE_NAME, sort_order: pgCount || 0,
    });
  }

  // ── Floating SPF annotation panels ────────────────────────────────────────────
  // Positions are stored in CANVAS coordinates (like node x/y) so they move with pan/zoom.
  // Width/height are in screen pixels (consistent visual size regardless of zoom).
  function renderSpfAnnotations() {
    const wrap = container.querySelector('#fta-cw'); if (!wrap) return;
    wrap.querySelectorAll('.fta-spf-float').forEach(el => el.remove());
    if (!_cfg.showSPF) return;

    const spfLeaves = _nodes.filter(n =>
      !isGate(n.type) && n.type !== 'top_event' &&
      _mcs.some(s => s.length === 1 && s[0] === n.id));
    spfLeaves.forEach(n => {
      // Migrate or reset old state that lacks relY (pre-v0.2.2 format)
      if (_spfAnnotState[n.id]?.relY == null) delete _spfAnnotState[n.id];
      const existing = _spfAnnotState[n.id] || {};
      if (!existing.w) existing.w = 210;
      if (!existing.h) existing.h = 0; // 0 = auto (no min-height override)
      if (existing.relY == null) existing.relY = 20; // default: 20 canvas-px below visual bottom
      if (!existing.userMoved) {
        existing.cx = n.x - existing.w / (2 * _zoom);  // horizontally centred on node
      }
      _spfAnnotState[n.id] = existing;

      const state = _spfAnnotState[n.id];
      const nodeBtm = nodeVisualBottom(n);
      const cy = nodeBtm + state.relY;

      const accepted  = n.spf_status === 'accepted';
      const rejected  = n.spf_status === 'rejected';
      const bdColor   = accepted ? '#1E8E3E' : rejected ? '#d93025' : '#E37400';
      const statIcon  = accepted ? '✓' : rejected ? '✕' : '!';

      const { left, top } = canvasToScreen(state.cx, cy);
      const minHStyle = state.h > 0 ? `min-height:${state.h}px;` : '';

      const panel = document.createElement('div');
      panel.className = 'fta-spf-float';
      panel.dataset.nid = n.id;
      panel.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${state.w}px;${minHStyle}` +
        `transform:scale(${_zoom});transform-origin:top left;` +
        `background:#fff;border:2px solid ${bdColor};border-radius:6px;` +
        `box-shadow:2px 4px 12px rgba(0,0,0,.18);z-index:100;font-family:inherit;font-size:11px;overflow:visible;`;

      // Title bar (drag handle) — double-click opens full dialog
      const titleBar = document.createElement('div');
      titleBar.className = 'fta-spf-float-title';
      titleBar.style.cssText = `background:${bdColor};color:#fff;padding:3px 8px;cursor:move;` +
        `display:flex;align-items:center;justify-content:space-between;` +
        `font-size:10px;font-weight:700;user-select:none;border-radius:3px 3px 0 0;`;
      titleBar.innerHTML = `<span>SPF ${esc(n.fta_code||'')} Justification</span>` +
        `<span style="background:rgba(255,255,255,.25);border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-size:9px">${statIcon}</span>`;
      panel.appendChild(titleBar);

      // Content area — double-click to edit justification inline (auto-saves on blur, no popup)
      const content = document.createElement('div');
      content.className = 'fta-spf-float-content';
      content.style.cssText = 'padding:6px 8px;min-height:36px;cursor:default;color:#333;line-height:1.4;word-break:break-word;';
      if (n.spf_justification) {
        content.textContent = n.spf_justification;
      } else {
        content.textContent = accepted ? '(no justification)' : 'Double-click to add justification…';
        content.style.color = '#aaa';
        content.style.fontStyle = 'italic';
      }
      panel.appendChild(content);
      if (accepted) {
        const lock = document.createElement('div');
        lock.style.cssText = 'font-size:9px;color:#1E8E3E;padding:2px 8px 4px;opacity:.7;user-select:none';
        lock.textContent = '🔒 Text locked — dbl-click title to change status';
        panel.appendChild(lock);
      }

      // 4 corner resize handles
      [['nw','left:-1px;top:-1px'],['ne','right:-1px;top:-1px'],
       ['sw','left:-1px;bottom:-1px'],['se','right:-1px;bottom:-1px']].forEach(([cls, pos])=>{
        const h = document.createElement('div');
        h.className = `fta-spf-resize fta-spf-resize-${cls}`;
        h.style.cssText = `position:absolute;width:9px;height:9px;background:${bdColor};opacity:.55;border-radius:2px;cursor:${cls}-resize;${pos}`;
        panel.appendChild(h);
      });

      wrap.appendChild(panel);
      wireDragAnnotation(panel, titleBar, n.id);
      panel.querySelectorAll('.fta-spf-resize').forEach(h => wireResizeAnnotation(panel, h, n.id));
      content.addEventListener('dblclick', e => { e.stopPropagation(); openAnnotEdit(panel, content, n); });
      // Double-click on title bar opens full SPF status/approver dialog
      titleBar.addEventListener('dblclick', e => { e.stopPropagation(); openSpfDialog(n.id); });
    });
  }

  function wireDragAnnotation(panel, handle, nid) {
    let dragged = false;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      dragged = false;
      const startX = e.clientX, startY = e.clientY;
      const startCX  = _spfAnnotState[nid]?.cx || 0;
      const startRelY = _spfAnnotState[nid]?.relY ?? 20;
      const n = byId(nid);
      const nodeBtm = n ? nodeVisualBottom(n) : 0;
      const onMove = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
        const newCX   = startCX + dx / _zoom;
        const newRelY = startRelY + dy / _zoom;
        _spfAnnotState[nid] = { ..._spfAnnotState[nid], cx: newCX, relY: newRelY, userMoved: true };
        const newCY = nodeBtm + newRelY;
        const { left, top } = canvasToScreen(newCX, newCY);
        panel.style.left = left + 'px';
        panel.style.top  = top  + 'px';
      };
      const onUp = () => {
        if (dragged) saveSpfAnnotState();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Suppress dblclick-opening-dialog after a drag
    handle.addEventListener('dblclick', e => { if (dragged) { e.stopPropagation(); dragged = false; } });
  }

  function wireResizeAnnotation(panel, handle, nid) {
    const cls = [...handle.classList].find(c => c.startsWith('fta-spf-resize-'))?.replace('fta-spf-resize-','') || 'se';
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const startW = panel.offsetWidth, startH = panel.offsetHeight;
      // Derive actual canvas coords from the panel's current screen position (state only has relY, not cy)
      const startCX = _spfAnnotState[nid]?.cx || 0;
      const { cy: startCY } = screenToCanvas(parseFloat(panel.style.left) || 0, parseFloat(panel.style.top) || 0);
      const onMove = ev => {
        // Deltas are screen px; divide by _zoom to get DOM px (panel dims stored at zoom=1)
        const dx = (ev.clientX - startX) / _zoom, dy = (ev.clientY - startY) / _zoom;
        let nw2 = startW, nh2 = startH, ncx = startCX, ncy = startCY;
        if (cls.includes('e')) nw2 = Math.max(140, startW + dx);
        if (cls.includes('s')) nh2 = Math.max(60,  startH + dy);
        // West: shrink from left — anchor moves right in canvas space
        if (cls.includes('w')) { nw2 = Math.max(140, startW - dx); ncx = startCX + (startW - nw2); }
        // North: shrink from top — anchor moves down in canvas space
        if (cls.includes('n')) { nh2 = Math.max(60,  startH - dy); ncy = startCY + (startH - nh2); }
        // Keep relY in sync so the panel re-renders correctly on layout changes
        const n = byId(nid);
        const nodeBtm = n ? nodeVisualBottom(n) : 0;
        const newRelY = ncy - nodeBtm;
        _spfAnnotState[nid] = { ..._spfAnnotState[nid], cx: ncx, relY: newRelY, w: nw2, h: nh2, userMoved: true };
        const { left, top } = canvasToScreen(ncx, ncy);
        panel.style.left      = left + 'px';
        panel.style.top       = top  + 'px';
        panel.style.width     = nw2  + 'px';
        panel.style.minHeight = nh2  + 'px';
      };
      const onUp = () => {
        saveSpfAnnotState();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function openAnnotEdit(panel, content, n) {
    if (n.spf_status === 'accepted') return; // locked — accepted justifications are read-only
    if (panel.querySelector('.fta-spf-float-ta')) return; // already editing
    const ta = document.createElement('textarea');
    ta.className = 'fta-spf-float-ta';
    ta.value = n.spf_justification || '';
    ta.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 8px;border:none;border-top:1px solid #ddd;' +
      'font-size:11px;font-family:inherit;resize:none;outline:none;min-height:48px;display:block;';
    ta.rows = 3;
    content.style.display = 'none';
    panel.appendChild(ta);
    ta.focus(); ta.select();
    let saved = false;
    const save = async () => {
      if (saved) return; saved = true;
      const val = ta.value.trim() || null;
      n.spf_justification = val;
      await sb.from('fta_nodes').update({ spf_justification: val, updated_at: new Date().toISOString() }).eq('id', n.id);
      ta.remove();
      content.style.display = '';
      if (val) { content.textContent = val; content.style.color = '#333'; content.style.fontStyle = ''; }
      else { content.textContent = 'Double-click to add justification…'; content.style.color = '#aaa'; content.style.fontStyle = 'italic'; }
      render();
    };
    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { saved = true; ta.remove(); content.style.display = ''; render(); }
    });
  }

  function openSpfDialog(nodeId) {
    const n = byId(nodeId); if (!n) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:8px;padding:24px 28px;max-width:460px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.2);font-family:inherit;border-top:4px solid #d93025';
    box.innerHTML = `
      <div style="font-size:14px;font-weight:700;color:#d93025;margin-bottom:4px">⚠ Single Point Failure — ${esc(n.fta_code||'')}</div>
      <div style="font-size:12px;color:#555;margin-bottom:16px">${esc(n.label||n.component||'')}</div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:600;color:#555;display:block;margin-bottom:4px">
          Justification / Safety Argument
          ${n.spf_status==='accepted'?'<span style="font-size:10px;color:#1E8E3E;font-weight:400;margin-left:6px">🔒 locked while accepted</span>':''}
        </label>
        <textarea id="spf-just" rows="3" ${n.spf_status==='accepted'?'readonly':''}
          style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:inherit;resize:vertical;${n.spf_status==='accepted'?'background:#f5f5f5;color:#888;cursor:not-allowed;':''}"
        >${esc(n.spf_justification||'')}</textarea>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:600;color:#555;display:block;margin-bottom:4px">Status (FSM review)</label>
        <select id="spf-stat" style="padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;width:180px">
          <option value="pending"  ${(n.spf_status||'pending')==='pending' ?'selected':''}>⏳ Pending</option>
          <option value="accepted" ${n.spf_status==='accepted'?'selected':''}>✅ Accepted</option>
          <option value="rejected" ${n.spf_status==='rejected'?'selected':''}>❌ Rejected</option>
        </select>
      </div>
      <div style="margin-bottom:20px">
        <label style="font-size:11px;font-weight:600;color:#555;display:block;margin-bottom:4px">Approver comment</label>
        <input id="spf-comm" type="text" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:inherit" value="${esc(n.spf_approver_comment||'')}" placeholder="FSM comment…">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="spf-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
        <button id="spf-save" style="padding:6px 16px;border:none;border-radius:4px;background:#1A73E8;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Save</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
    box.querySelector('#spf-cancel').onclick = cleanup;
    box.querySelector('#spf-save').onclick = async () => {
      const stat = box.querySelector('#spf-stat').value;
      // Keep existing justification if it was locked (accepted → accepted or accepted → other)
      const justEl = box.querySelector('#spf-just');
      const just = justEl.readOnly ? (n.spf_justification || null) : (justEl.value.trim() || null);
      const comm = box.querySelector('#spf-comm').value.trim() || null;
      n.spf_justification = just;
      n.spf_status = stat;
      n.spf_approver_comment = comm;
      await sb.from('fta_nodes').update({
        spf_justification: just, spf_status: stat, spf_approver_comment: comm,
        updated_at: new Date().toISOString()
      }).eq('id', nodeId);
      cleanup();
      recomputeMCS(); // update _spfNodes before render so canvas gets correct colours
      render();
    };
  }

  function onSelectionChanged() {
    // If a single AND gate is selected, highlight its requirement in the reqs panel
    const bar = container.querySelector('#fta-sreqs-bar');
    if (!bar || bar.classList.contains('fta-sreqs-collapsed')) return;
    if (_selSet.size === 1) {
      const n = byId([..._selSet][0]);
      if (n?.type === 'gate_and') { highlightAndGateInSreqs(n.id); return; }
    }
    highlightAndGateInSreqs(null);
  }

  // ── Functional Failure Conditions panel (Features > Use Cases > Functions > FFCs) ──
  const _ffc = { loaded: false, selFeatId: null, selUCId: null, selFnId: null,
                 features: [], useCases: [], functions: [], ffcs: [] };

  function wireFFCBar() {
    const bar = container.querySelector('#fta-ffc-bar');
    if (!bar) return;
    wireBottomPanel(bar, {
      key: `fta_ffc_h_${parentType}_${parentId}`,
      defaultH: 200,
      onExpand: () => loadFFCFeatures(),
    });
  }

  async function loadFFCFeatures() {
    const body = container.querySelector('#fta-ffc-body');
    if (!body) return;
    if (_ffc.loaded) { renderFFCCols(); return; }
    body.innerHTML = '<div class="fta-ffc-loading">Loading…</div>';
    const { data: feats } = await sb.from('features')
      .select('*').eq('parent_type', parentType).eq('parent_id', parentId)
      .order('sort_order').order('created_at');
    _ffc.features = feats || [];
    _ffc.loaded = true;
    renderFFCCols();
  }

  function renderFFCCols() {
    const body = container.querySelector('#fta-ffc-body');
    if (!body) return;
    body.innerHTML = `<div class="fta-ffc-cols" id="fta-ffc-cols">
      ${ffcFeatColHTML()}${ffcUCColHTML()}${ffcFnColHTML()}${ffcFFCColHTML()}
    </div>`;
    wireFFCCols();
  }

  function ffcFeatColHTML() {
    const feats = _ffc.features;
    const rows = feats.length
      ? feats.map(f => {
          const sel = _ffc.selFeatId === f.id;
          return `<div class="fuf-row fta-ffc-row${sel ? ' selected' : ''}" data-id="${esc(f.id)}" data-ffc-type="feat">
            <div class="fuf-row-main">
              <span class="fuf-icon feat-icon">◈</span>
              <div class="fuf-row-text">
                <span class="fuf-code">${esc(f.feat_code || '')}</span>
                <span class="fuf-name">${esc(f.name)}</span>
              </div>
            </div>
          </div>`;
        }).join('')
      : '<div class="fuf-empty">No features</div>';
    return `<div class="fuf-col fta-ffc-col" id="fta-ffc-col-feat">
      <div class="fuf-col-header"><span class="fuf-col-icon feat-icon">◈</span><span class="fuf-col-title">Features</span></div>
      <div class="fuf-col-body">${rows}</div>
    </div>`;
  }

  function ffcUCColHTML() {
    const ucs = _ffc.useCases;
    const empty = !_ffc.selFeatId
      ? '<div class="fuf-empty fuf-hint">← Select a Feature</div>'
      : '<div class="fuf-empty">No use cases</div>';
    const rows = ucs.length
      ? ucs.map(u => {
          const sel = _ffc.selUCId === u.id;
          return `<div class="fuf-row fta-ffc-row${sel ? ' selected' : ''}" data-id="${esc(u.id)}" data-ffc-type="uc">
            <div class="fuf-row-main">
              <span class="fuf-icon uc-icon">◇</span>
              <div class="fuf-row-text">
                <span class="fuf-code">${esc(u.uc_code || '')}</span>
                <span class="fuf-name">${esc(u.name)}</span>
              </div>
            </div>
          </div>`;
        }).join('')
      : empty;
    return `<div class="fuf-col fta-ffc-col" id="fta-ffc-col-uc">
      <div class="fuf-col-header"><span class="fuf-col-icon uc-icon">◇</span><span class="fuf-col-title">Use Cases</span></div>
      <div class="fuf-col-body">${rows}</div>
    </div>`;
  }

  function ffcFnColHTML() {
    const fns = _ffc.functions;
    const empty = !_ffc.selUCId
      ? '<div class="fuf-empty fuf-hint">← Select a Use Case</div>'
      : '<div class="fuf-empty">No functions</div>';
    const rows = fns.length
      ? fns.map(fn => {
          const sel = _ffc.selFnId === fn.id;
          return `<div class="fuf-row fta-ffc-row${sel ? ' selected' : ''}" data-id="${esc(fn.id)}" data-ffc-type="fn">
            <div class="fuf-row-main">
              <span class="fuf-icon fun-icon">⚙</span>
              <div class="fuf-row-text">
                <span class="fuf-code">${esc(fn.func_code || fn.fn_code || '')}</span>
                <span class="fuf-name">${esc(fn.name)}</span>
              </div>
            </div>
          </div>`;
        }).join('')
      : empty;
    return `<div class="fuf-col fta-ffc-col" id="fta-ffc-col-fn">
      <div class="fuf-col-header"><span class="fuf-col-icon fun-icon">⚙</span><span class="fuf-col-title">Functions</span></div>
      <div class="fuf-col-body">${rows}</div>
    </div>`;
  }

  function ffcFFCColHTML() {
    const ffcs = _ffc.ffcs;
    const insertedCodes = new Set(_nodes.map(n => n.component).filter(Boolean));
    const empty = !_ffc.selFnId
      ? '<div class="fuf-empty fuf-hint">← Select a Function</div>'
      : '<div class="fuf-empty">No FFCs for this function</div>';
    const rows = ffcs.length
      ? ffcs.map(h => {
          const label    = h.data?.failure_condition || h.data?.functional_failure_condition || '(no label)';
          const code     = h.haz_code || '';
          const inserted = insertedCodes.has(code);
          return `<div class="fuf-row fta-ffc-row fta-ffc-ffc-row${inserted ? ' fta-ffc-ffc--inserted' : ''}"
                    draggable="true"
                    data-id="${esc(h.id)}" data-ffc-type="ffc"
                    data-label="${esc(label)}" data-code="${esc(code)}"
                    title="${inserted ? '✔ Already in diagram' : 'Drag to FTA canvas as Basic Event'} · ${esc(code)}">
                    <div class="fuf-row-main">
                      <span class="fuf-icon" style="font-size:13px">${inserted ? '✔' : '○'}</span>
                      <div class="fuf-row-text">
                        <span class="fuf-code">${esc(code)}</span>
                        <span class="fuf-name">${esc(label)}</span>
                      </div>
                    </div>
                  </div>`;
        }).join('')
      : empty;
    const hint = ffcs.length ? '<div class="fta-ffc-drag-hint">Drag a row to the FTA canvas to insert as Basic Event</div>' : '';
    return `<div class="fuf-col fta-ffc-col fta-ffc-col--ffc" id="fta-ffc-col-ffc">
      <div class="fuf-col-header"><span class="fuf-col-icon" style="font-size:14px">⚡</span><span class="fuf-col-title">Functional Failure Conditions</span></div>
      ${hint}
      <div class="fuf-col-body">${rows}</div>
    </div>`;
  }

  function wireFFCCols() {
    const cols = container.querySelector('#fta-ffc-cols');
    if (!cols) return;

    // Row click — navigate feat → uc → fn
    cols.addEventListener('click', async e => {
      const row = e.target.closest('.fta-ffc-row[data-ffc-type]');
      if (!row) return;
      const { id, ffcType } = row.dataset;
      if (ffcType === 'feat') {
        if (_ffc.selFeatId === id) return;
        _ffc.selFeatId = id; _ffc.selUCId = null; _ffc.selFnId = null;
        _ffc.useCases = []; _ffc.functions = []; _ffc.ffcs = [];
        renderFFCCols();
        const { data } = await sb.from('use_cases').select('*')
          .eq('feature_id', id).order('sort_order').order('created_at');
        _ffc.useCases = data || [];
        renderFFCCols();
      } else if (ffcType === 'uc') {
        if (_ffc.selUCId === id) return;
        _ffc.selUCId = id; _ffc.selFnId = null;
        _ffc.functions = []; _ffc.ffcs = [];
        renderFFCCols();
        const { data } = await sb.from('functions').select('*')
          .eq('use_case_id', id).order('sort_order').order('created_at');
        _ffc.functions = data || [];
        renderFFCCols();
      } else if (ffcType === 'fn') {
        if (_ffc.selFnId === id) return;
        _ffc.selFnId = id; _ffc.ffcs = [];
        renderFFCCols();
        const { data } = await sb.from('hazards').select('id, haz_code, data')
          .eq('analysis_type', 'FHA')
          .eq('function_id', id)
          .order('sort_order').order('created_at');
        _ffc.ffcs = data || [];
        renderFFCCols();
      }
    });

    // Drag from FFC rows
    cols.querySelectorAll('.fta-ffc-ffc-row[draggable]').forEach(row => {
      row.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/fta-ffc', JSON.stringify({
          label: row.dataset.label,
          code:  row.dataset.code,
          hazId: row.dataset.id,
        }));
      });
    });
  }

  // Refresh FFC column (inserted badges) when nodes change, without reloading data
  function refreshFFCPanelIfOpen() {
    const bar = container.querySelector('#fta-ffc-bar');
    if (!bar || bar.classList.contains('bp-collapsed')) return;
    // Just re-render the FFC column in place to update inserted badges
    const ffcCol = container.querySelector('#fta-ffc-col-ffc');
    if (ffcCol) {
      ffcCol.outerHTML = ffcFFCColHTML();
      // Re-wire drag on the new column
      const newCol = container.querySelector('#fta-ffc-col-ffc');
      if (newCol) {
        newCol.querySelectorAll('.fta-ffc-ffc-row[draggable]').forEach(row => {
          row.addEventListener('dragstart', e => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/fta-ffc', JSON.stringify({
              label: row.dataset.label,
              code:  row.dataset.code,
              hazId: row.dataset.id,
            }));
          });
        });
      }
    }
  }

  // ── Safety Requirements panel ───────────────────────────────────────────────
  function wireSreqsBar() {
    const bar = container.querySelector('#fta-sreqs-bar');
    if (!bar) return;
    wireBottomPanel(bar, {
      key: `fta_sreqs_h_${parentType}_${parentId}`,
      defaultH: 200,
      onExpand: () => loadSafetyReqs(),
    });
  }

  function toggleSreqsPanel() {
    const bar = container.querySelector('#fta-sreqs-bar');
    if (!bar) return;
    if (bar.classList.contains('bp-collapsed')) {
      bar._bp?.expand();
    } else {
      bar._bp?.collapse();
    }
  }

  async function loadSafetyReqs() {
    const { data, error } = await sb.from('requirements')
      .select('id, req_code, title, status, source')
      .eq('project_id', project.id)
      .like('source', 'FTA-AND:%')
      .order('req_code', { ascending: true });
    if (error) { console.warn('loadSafetyReqs error:', error); return; }
    _safetyReqs = data || [];
    renderSreqsBar();
  }

  function renderSreqsBar() {
    const body = container.querySelector('#fta-sreqs-body');
    if (!body) return;
    if (!_safetyReqs.length) {
      body.innerHTML = '<div class="fta-sreqs-empty">No independence requirements found. Use ⚡ Safety Reqs to generate them from AND gates.</div>';
      return;
    }
    // Build a map of hazard_id → fc label for display
    const fcMap = {};
    _fcs.forEach(fc => { fcMap[fc.id] = fc.data?.failure_condition || fc.haz_code || fc.id; });

    body.innerHTML = `<table class="fta-sreqs-table">
      <thead><tr>
        <th>Req Code</th><th>Failure Condition</th><th>AND Gate</th><th>Title</th><th>Status</th>
      </tr></thead>
      <tbody>${_safetyReqs.map(r => {
        const gateId  = r.source?.replace('FTA-AND:', '') || '';
        // Look up gate in current diagram nodes; gate may belong to a different FC
        const gateNode = _nodes.find(n => n.id === gateId);
        const gateCode = gateNode?.fta_code || gateNode?.label || gateId.slice(0,8);
        const hazId    = gateNode?.hazard_id || '';
        const fcLabel  = fcMap[hazId] || '—';
        const short    = fcLabel.length > 30 ? fcLabel.slice(0,29)+'…' : fcLabel;
        const isHighlighted = _highlightedGateId && _highlightedGateId === gateId;
        return `<tr class="fta-sreqs-row${isHighlighted?' fta-sreqs-row-hl':''}" data-gate-id="${esc(gateId)}" data-haz-id="${esc(hazId)}" style="cursor:pointer">
          <td><b>${esc(r.req_code||'')}</b></td>
          <td title="${esc(fcLabel)}">${esc(short)}</td>
          <td>${esc(gateCode)}</td>
          <td>${esc(r.title||'')}</td>
          <td><span class="fta-sreqs-status fta-sreqs-status-${esc(r.status||'draft')}">${esc(r.status||'draft')}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

    // Wire row clicks
    body.querySelectorAll('.fta-sreqs-row').forEach(row => {
      row.addEventListener('click', () => navigateToAndGate(row.dataset.gateId, row.dataset.hazId));
    });
  }

  async function navigateToAndGate(gateId, hazId) {
    if (!gateId) return;
    // If no hazard_id stored, look it up from DB
    if (!hazId) {
      const { data: gateRow } = await sb.from('fta_nodes').select('hazard_id').eq('id', gateId).maybeSingle();
      hazId = gateRow?.hazard_id || null;
    }
    // If the requirement belongs to a different FC, switch to it
    if (hazId && hazId !== _activeHazardId) {
      _activeHazardId = hazId;
      renderFCTabs();
      await loadNodes();
      render();
    }
    // Highlight the AND gate
    const n = byId(gateId);
    if (!n) return;
    _selSet.clear(); _selSet.add(gateId);
    _highlightedGateId = gateId;
    render();
    // Fit entire diagram so the gate is visible, then nudge it to centre
    fitAll();
  }

  function highlightAndGateInSreqs(gateId) {
    _highlightedGateId = gateId || null;
    const body = container.querySelector('#fta-sreqs-body');
    if (!body) return;
    body.querySelectorAll('.fta-sreqs-row').forEach(row => {
      if (row.dataset.gateId === gateId) {
        row.classList.add('fta-sreqs-row-hl');
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        row.classList.remove('fta-sreqs-row-hl');
      }
    });
  }

  // Wire MCS bar
  function wireMCSBar() {
    const bar = container.querySelector('#fta-mcs-bar');
    if (!bar) return;
    wireBottomPanel(bar, {
      key: `fta_mcs_h_${parentType}_${parentId}`,
      defaultH: 220,
    });
    const lvlSel = container.querySelector('#fta-mcs-lvl');
    if (lvlSel) {
      lvlSel.addEventListener('change', () => {
        _mcsMaxOrder = parseInt(lvlSel.value) || 99;
        renderMCSBar();
      });
    }
  }
}
