/**
 * V-Model Graph Editor — context-driven UX
 *
 * Interaction model (no mode toolbar):
 *   • Click node (no drag)  → context menu: Add Traceability link / Delete node
 *   • After choosing a link type → rubber-band line follows mouse; click target to confirm, Esc to cancel
 *   • Click connection line → context menu: Delete link
 *   • Drag node             → reposition
 *   • Drag bend handle      → reshape connection curve
 *
 * Domain panel: the Multi-Domain template embeds a fully interactive sub-canvas
 * inside a tabbed panel node. Nodes with `panelDomain:'sw'|'hw'|'mech'` are
 * rendered and interacted with inside that sub-canvas. Their links are real
 * traceability links stored in the same _links array and drive the traceability
 * dashboard just like any other link.
 */

export const VMODEL_NODES = [
  // ── Customer / Safety (item-level) ──
  { id: 'customer_req', domain: 'customer', phase: 'requirements',        label: 'Customer Requirements' },
  { id: 'fsr',          domain: 'safety',   phase: 'requirements',        label: 'Functional Safety Req.' },
  { id: 'tsr',          domain: 'safety',   phase: 'requirements',        label: 'Technical Safety Req.' },
  // ── Item-level (multi-system) ──
  { id: 'item_req',     domain: 'item',     phase: 'requirements',        label: 'Item Requirements' },
  { id: 'item_arch',    domain: 'item',     phase: 'architecture',        label: 'Item Architecture' },
  { id: 'item_it',      domain: 'item',     phase: 'integration_testing', label: 'Item Integration Test' },
  { id: 'item_qt',      domain: 'item',     phase: 'system_testing',      label: 'Item Qualification Test' },
  // ── System ──
  { id: 'sys_req',     domain: 'system', phase: 'requirements',        label: 'System Requirements' },
  { id: 'sys_arch',    domain: 'system', phase: 'architecture',        label: 'System Architecture' },
  { id: 'sys_it',      domain: 'system', phase: 'integration_testing', label: 'System Integration Test' },
  { id: 'sys_qt',      domain: 'system', phase: 'system_testing',      label: 'System Qualification Test' },
  // ── SW ──
  { id: 'sw_req',      domain: 'sw',     phase: 'requirements',        label: 'SW Requirements' },
  { id: 'sw_arch',     domain: 'sw',     phase: 'architecture',        label: 'SW Architecture' },
  { id: 'sw_design',   domain: 'sw',     phase: 'design',              label: 'SW Detailed Design' },
  { id: 'sw_impl',     domain: 'sw',     phase: 'implementation',      label: 'SW Units' },
  { id: 'sw_ut',       domain: 'sw',     phase: 'unit_testing',        label: 'Unit Test Spec' },
  { id: 'sw_it',       domain: 'sw',     phase: 'integration_testing', label: 'SW Integration Test Spec' },
  { id: 'sw_qt',       domain: 'sw',     phase: 'system_testing',      label: 'SW Qualification Test Spec' },
  // ── HW ──
  { id: 'hw_req',      domain: 'hw',     phase: 'requirements',        label: 'HW Requirements' },
  { id: 'hw_arch',     domain: 'hw',     phase: 'architecture',        label: 'HW Architecture' },
  { id: 'hw_design',   domain: 'hw',     phase: 'design',              label: 'HW Detailed Design' },
  { id: 'hw_ut',       domain: 'hw',     phase: 'unit_testing',        label: 'HW Test Spec' },
  { id: 'hw_it',       domain: 'hw',     phase: 'integration_testing', label: 'HW Integration Test Spec' },
  { id: 'hw_qt',       domain: 'hw',     phase: 'system_testing',      label: 'HW Qualification Test Spec' },
  // ── MECH ──
  { id: 'mech_req',    domain: 'mech',   phase: 'requirements',        label: 'MECH Requirements' },
  { id: 'mech_arch',   domain: 'mech',   phase: 'architecture',        label: 'MECH Architecture' },
  { id: 'mech_design', domain: 'mech',   phase: 'design',              label: 'MECH Detailed Design' },
  { id: 'mech_ut',     domain: 'mech',   phase: 'unit_testing',        label: 'MECH Test Spec' },
  { id: 'mech_it',     domain: 'mech',   phase: 'integration_testing', label: 'MECH Integration Test Spec' },
  { id: 'mech_qt',     domain: 'mech',   phase: 'system_testing',      label: 'MECH Qualification Test Spec' },
  // ── Special ──
  { id: 'domain_panel', domain: 'panel', phase: 'none', label: 'Domain Implementations', special: 'domain_panel' },
];

export const PHASE_DB_SOURCE = {
  requirements:        'requirements',
  architecture:        'arch_spec_items',
  unit_testing:        'test_specs',
  integration_testing: 'test_specs',
  system_testing:      'test_specs',
};

// ── ASPICE SW default ─────────────────────────────────────────────────────────

const ASPICE_NODES = [
  { nodeId: 'sys_req',   x: 20,  y: 20  },
  { nodeId: 'sys_arch',  x: 90,  y: 95  },
  { nodeId: 'sw_req',    x: 160, y: 170 },
  { nodeId: 'sw_arch',   x: 230, y: 245 },
  { nodeId: 'sw_design', x: 300, y: 320 },
  { nodeId: 'sw_impl',   x: 390, y: 400 },
  { nodeId: 'sw_ut',     x: 490, y: 320 },
  { nodeId: 'sw_it',     x: 560, y: 245 },
  { nodeId: 'sw_qt',     x: 630, y: 170 },
  { nodeId: 'sys_it',    x: 700, y: 95  },
  { nodeId: 'sys_qt',    x: 770, y: 20  },
];

const ASPICE_LINKS = [
  { from: 'sys_req',   to: 'sys_qt',  type: 'trace' },
  { from: 'sys_arch',  to: 'sys_it',  type: 'trace' },
  { from: 'sw_req',    to: 'sw_qt',   type: 'trace' },
  { from: 'sw_arch',   to: 'sw_it',   type: 'trace' },
  { from: 'sw_design', to: 'sw_ut',   type: 'trace' },
  { from: 'sys_req',   to: 'sw_req',  type: 'trace', bend: { x: -220, y: 0 } },
  { from: 'sw_req',    to: 'sw_impl', type: 'trace', bend: { x: -220, y: 0 } },
  { from: 'sys_req',   to: 'sys_arch',  type: 'trace' },
  { from: 'sys_arch',  to: 'sw_req',    type: 'trace' },
  { from: 'sw_req',    to: 'sw_arch',   type: 'trace' },
  { from: 'sw_arch',   to: 'sw_design', type: 'trace' },
  { from: 'sw_design', to: 'sw_impl',   type: 'trace' },
];

// ── ASPICE Extended (+ Customer Requirements) ─────────────────────────────────

const ASPICE_EXT_NODES = [
  { nodeId: 'customer_req', x: 20,  y: 20  },
  { nodeId: 'sys_req',      x: 90,  y: 95  },
  { nodeId: 'sys_arch',     x: 160, y: 170 },
  { nodeId: 'sw_req',       x: 230, y: 245 },
  { nodeId: 'sw_arch',      x: 300, y: 320 },
  { nodeId: 'sw_design',    x: 370, y: 395 },
  { nodeId: 'sw_impl',      x: 460, y: 475 },
  { nodeId: 'sw_ut',        x: 560, y: 395 },
  { nodeId: 'sw_it',        x: 630, y: 320 },
  { nodeId: 'sw_qt',        x: 700, y: 245 },
  { nodeId: 'sys_it',       x: 770, y: 170 },
  { nodeId: 'sys_qt',       x: 840, y: 95  },
];

const ASPICE_EXT_LINKS = [
  { from: 'customer_req', to: 'sys_req',   type: 'trace' },
  { from: 'sys_req',      to: 'sys_arch',  type: 'trace' },
  { from: 'sys_arch',     to: 'sw_req',    type: 'trace' },
  { from: 'sw_req',       to: 'sw_arch',   type: 'trace' },
  { from: 'sw_arch',      to: 'sw_design', type: 'trace' },
  { from: 'sw_design',    to: 'sw_impl',   type: 'trace' },
  { from: 'sys_req',      to: 'sys_qt',    type: 'trace' },
  { from: 'sys_arch',     to: 'sys_it',    type: 'trace' },
  { from: 'sw_req',       to: 'sw_qt',     type: 'trace' },
  { from: 'sw_arch',      to: 'sw_it',     type: 'trace' },
  { from: 'sw_design',    to: 'sw_ut',     type: 'trace' },
  { from: 'sys_req',      to: 'sw_req',    type: 'trace', bend: { x: -240, y: 0 } },
  { from: 'sw_req',       to: 'sw_impl',   type: 'trace', bend: { x: -240, y: 0 } },
];

// ── ISO 26262 ─────────────────────────────────────────────────────────────────

const ISO26262_NODES = [
  { nodeId: 'customer_req', x: 20,  y: 20  },
  { nodeId: 'fsr',          x: 90,  y: 95  },
  { nodeId: 'tsr',          x: 160, y: 170 },
  { nodeId: 'sys_req',      x: 230, y: 245 },
  { nodeId: 'sys_arch',     x: 300, y: 320 },
  { nodeId: 'sw_req',       x: 370, y: 395 },
  { nodeId: 'sw_arch',      x: 440, y: 470 },
  { nodeId: 'sw_design',    x: 510, y: 545 },
  { nodeId: 'sw_impl',      x: 600, y: 620 },
  { nodeId: 'sw_ut',        x: 700, y: 545 },
  { nodeId: 'sw_it',        x: 770, y: 470 },
  { nodeId: 'sw_qt',        x: 840, y: 395 },
  { nodeId: 'sys_it',       x: 910, y: 320 },
  { nodeId: 'sys_qt',       x: 980, y: 245 },
];

const ISO26262_LINKS = [
  { from: 'customer_req', to: 'fsr',       type: 'trace' },
  { from: 'fsr',          to: 'tsr',       type: 'trace' },
  { from: 'tsr',          to: 'sys_req',   type: 'trace' },
  { from: 'sys_req',      to: 'sys_arch',  type: 'trace' },
  { from: 'sys_arch',     to: 'sw_req',    type: 'trace' },
  { from: 'sw_req',       to: 'sw_arch',   type: 'trace' },
  { from: 'sw_arch',      to: 'sw_design', type: 'trace' },
  { from: 'sw_design',    to: 'sw_impl',   type: 'trace' },
  { from: 'sys_req',      to: 'sys_qt',    type: 'trace' },
  { from: 'sys_arch',     to: 'sys_it',    type: 'trace' },
  { from: 'sw_req',       to: 'sw_qt',     type: 'trace' },
  { from: 'sw_arch',      to: 'sw_it',     type: 'trace' },
  { from: 'sw_design',    to: 'sw_ut',     type: 'trace' },
  { from: 'sys_req',      to: 'sw_req',    type: 'trace', bend: { x: -260, y: 0 } },
  { from: 'sw_req',       to: 'sw_impl',   type: 'trace', bend: { x: -260, y: 0 } },
];

// ── Multi-System ──────────────────────────────────────────────────────────────

const MULTI_SYS_NODES = [
  { nodeId: 'customer_req', x: 20,   y: 20  },
  { nodeId: 'item_req',     x: 90,   y: 95  },
  { nodeId: 'item_arch',    x: 160,  y: 170 },
  { nodeId: 'sys_req',      x: 230,  y: 245 },
  { nodeId: 'sys_arch',     x: 300,  y: 320 },
  { nodeId: 'sw_req',       x: 370,  y: 395 },
  { nodeId: 'sw_arch',      x: 440,  y: 470 },
  { nodeId: 'sw_design',    x: 510,  y: 545 },
  { nodeId: 'sw_impl',      x: 600,  y: 620 },
  { nodeId: 'sw_ut',        x: 700,  y: 545 },
  { nodeId: 'sw_it',        x: 770,  y: 470 },
  { nodeId: 'sw_qt',        x: 840,  y: 395 },
  { nodeId: 'sys_it',       x: 910,  y: 320 },
  { nodeId: 'sys_qt',       x: 980,  y: 245 },
  { nodeId: 'item_it',      x: 1050, y: 170 },
  { nodeId: 'item_qt',      x: 1120, y: 95  },
];

const MULTI_SYS_LINKS = [
  { from: 'customer_req', to: 'item_req',   type: 'trace' },
  { from: 'item_req',     to: 'item_arch',  type: 'trace' },
  { from: 'item_arch',    to: 'sys_arch',   type: 'trace' },
  { from: 'sys_req',      to: 'sys_arch',   type: 'trace' },
  { from: 'sys_arch',     to: 'sw_req',     type: 'trace' },
  { from: 'sw_req',       to: 'sw_arch',    type: 'trace' },
  { from: 'sw_arch',      to: 'sw_design',  type: 'trace' },
  { from: 'sw_design',    to: 'sw_impl',    type: 'trace' },
  { from: 'item_req',     to: 'item_qt',    type: 'trace' },
  { from: 'item_arch',    to: 'item_it',    type: 'trace' },
  { from: 'sys_req',      to: 'sys_qt',     type: 'trace' },
  { from: 'sys_arch',     to: 'sys_it',     type: 'trace' },
  { from: 'sw_req',       to: 'sw_qt',      type: 'trace' },
  { from: 'sw_arch',      to: 'sw_it',      type: 'trace' },
  { from: 'sw_design',    to: 'sw_ut',      type: 'trace' },
  { from: 'item_req',     to: 'sys_req',    type: 'trace', bend: { x: -300, y: 0 } },
  { from: 'sys_req',      to: 'sw_req',     type: 'trace', bend: { x: -300, y: 0 } },
  { from: 'sw_req',       to: 'sw_impl',    type: 'trace', bend: { x: -300, y: 0 } },
];

// ── Multi-Domain ──────────────────────────────────────────────────────────────
// Same top chain as Multi-System. The domain_panel node embeds a fully
// interactive sub-canvas. SW / HW / MECH nodes live INSIDE the panel
// (panelDomain flag) with their own local coordinates. Their links are real
// traceability links stored alongside all others.

const MULTI_DOM_NODES = [
  // ── Shared top chain ──
  { nodeId: 'customer_req', x: 20,  y: 20  },
  { nodeId: 'item_req',     x: 90,  y: 95  },
  { nodeId: 'item_arch',    x: 160, y: 170 },
  { nodeId: 'sys_req',      x: 230, y: 245 },
  { nodeId: 'sys_arch',     x: 300, y: 320 },
  // ── Domain panel (bottom of V) ──
  { nodeId: 'domain_panel', x: 460, y: 385 },
  // ── System right arm ──
  { nodeId: 'sys_it',       x: 1350, y: 320 },
  { nodeId: 'sys_qt',       x: 1420, y: 245 },
  // ── Item right arm ──
  { nodeId: 'item_it',      x: 1490, y: 170 },
  { nodeId: 'item_qt',      x: 1560, y: 95  },

  // ── SW domain nodes (inside panel, local coords) ──
  { nodeId: 'sw_req',    x: 10,  y: 8,   panelDomain: 'sw' },
  { nodeId: 'sw_arch',   x: 75,  y: 78,  panelDomain: 'sw' },
  { nodeId: 'sw_design', x: 140, y: 148, panelDomain: 'sw' },
  { nodeId: 'sw_impl',   x: 225, y: 218, panelDomain: 'sw' },
  { nodeId: 'sw_ut',     x: 365, y: 148, panelDomain: 'sw' },
  { nodeId: 'sw_it',     x: 440, y: 78,  panelDomain: 'sw' },
  { nodeId: 'sw_qt',     x: 505, y: 8,   panelDomain: 'sw' },

  // ── HW domain nodes (inside panel, local coords) ──
  { nodeId: 'hw_req',    x: 10,  y: 8,   panelDomain: 'hw' },
  { nodeId: 'hw_arch',   x: 80,  y: 78,  panelDomain: 'hw' },
  { nodeId: 'hw_design', x: 150, y: 148, panelDomain: 'hw' },
  { nodeId: 'hw_ut',     x: 360, y: 148, panelDomain: 'hw' },
  { nodeId: 'hw_it',     x: 430, y: 78,  panelDomain: 'hw' },
  { nodeId: 'hw_qt',     x: 505, y: 8,   panelDomain: 'hw' },

  // ── MECH domain nodes (inside panel, local coords) ──
  { nodeId: 'mech_req',    x: 10,  y: 8,   panelDomain: 'mech' },
  { nodeId: 'mech_arch',   x: 80,  y: 78,  panelDomain: 'mech' },
  { nodeId: 'mech_design', x: 150, y: 148, panelDomain: 'mech' },
  { nodeId: 'mech_ut',     x: 360, y: 148, panelDomain: 'mech' },
  { nodeId: 'mech_it',     x: 430, y: 78,  panelDomain: 'mech' },
  { nodeId: 'mech_qt',     x: 505, y: 8,   panelDomain: 'mech' },
];

const MULTI_DOM_LINKS = [
  // ── Shared top chain ──
  { from: 'customer_req', to: 'item_req',     type: 'trace' },
  { from: 'item_req',     to: 'item_arch',    type: 'trace' },
  { from: 'item_arch',    to: 'sys_req',      type: 'trace' },
  { from: 'sys_req',      to: 'sys_arch',     type: 'trace' },
  { from: 'item_req',     to: 'sys_req',      type: 'trace', bend: { x: -300, y: 0 } },
  // ── System/item horizontal traces ──
  { from: 'sys_arch',     to: 'sys_it',       type: 'trace' },
  { from: 'sys_req',      to: 'sys_qt',       type: 'trace' },
  { from: 'item_arch',    to: 'item_it',      type: 'trace' },
  { from: 'item_req',     to: 'item_qt',      type: 'trace' },
  // ── System trunk → domain req nodes (direct cross-level links) ──
  { from: 'sys_arch', to: 'sw_req',   type: 'trace' },
  { from: 'sys_arch', to: 'hw_req',   type: 'trace' },
  { from: 'sys_arch', to: 'mech_req', type: 'trace' },
  { from: 'sys_req',  to: 'sw_req',   type: 'trace', bend: { x: -200, y: 0 } },
  { from: 'sys_req',  to: 'hw_req',   type: 'trace', bend: { x: -200, y: 0 } },
  { from: 'sys_req',  to: 'mech_req', type: 'trace', bend: { x: -200, y: 0 } },

  // ── SW domain links (real traceability, inside panel) ──
  { from: 'sw_req',    to: 'sw_arch',   type: 'trace' },
  { from: 'sw_arch',   to: 'sw_design', type: 'trace' },
  { from: 'sw_design', to: 'sw_impl',   type: 'trace' },
  { from: 'sw_req',    to: 'sw_qt',     type: 'trace' },
  { from: 'sw_arch',   to: 'sw_it',     type: 'trace' },
  { from: 'sw_design', to: 'sw_ut',     type: 'trace' },
  { from: 'sw_req',    to: 'sw_impl',   type: 'trace', bend: { x: -180, y: 0 } },

  // ── HW domain links (real traceability, inside panel) ──
  { from: 'hw_req',    to: 'hw_arch',   type: 'trace' },
  { from: 'hw_arch',   to: 'hw_design', type: 'trace' },
  { from: 'hw_design', to: 'hw_ut',     type: 'trace' },
  { from: 'hw_arch',   to: 'hw_it',     type: 'trace' },
  { from: 'hw_req',    to: 'hw_qt',     type: 'trace' },
  { from: 'hw_req',    to: 'hw_design', type: 'trace', bend: { x: -150, y: 0 } },

  // ── MECH domain links (real traceability, inside panel) ──
  { from: 'mech_req',    to: 'mech_arch',   type: 'trace' },
  { from: 'mech_arch',   to: 'mech_design', type: 'trace' },
  { from: 'mech_req',    to: 'mech_design', type: 'trace', bend: { x: -100, y: 0 } },
  { from: 'mech_design', to: 'mech_ut',     type: 'trace' },
  { from: 'mech_arch',   to: 'mech_it',     type: 'trace' },
  { from: 'mech_req',    to: 'mech_qt',     type: 'trace' },
];

// ── Dimensions ────────────────────────────────────────────────────────────────

const NODE_W = 148;
const NODE_H = 36;
const DRAG_THRESHOLD = 5;

// Domain panel dimensions
const PANEL_W = 820;
const PANEL_H = 370;

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountVmodelEditor(wrapper, { links = [], canvasNodes = [], configId, fullConfig, project, sb, toast, onSave }) {

  // ── State ─────────────────────────────────────────────────────────────────
  let _nodes       = [];
  let _links       = [];
  let _connectFrom = null;
  let _connectType = null;
  let _drag        = null;   // { nodeId, offX, offY, moved, startX, startY, isPanelNode? }
  let _bendDrag    = null;   // { linkId, startMX, startMY, startBX, startBY, isPanelLink? }
  let _popover     = null;
  let _mouseX      = 0;
  let _mouseY      = 0;
  let _panelMouseX = 0;
  let _panelMouseY = 0;
  let _dirty       = false;
  let _scale       = 1;
  let _panelScale  = 1;
  let _domainTab   = 'sw';

  // Panel sub-canvas references (set when panel is rendered)
  let _panelCanvas = null;
  let _panelSVG    = null;

  // Init from saved
  if (canvasNodes.length) {
    _nodes = canvasNodes.map(cn => {
      const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
      return def ? { ...def, x: cn.x, y: cn.y, ...(cn.panelDomain ? { panelDomain: cn.panelDomain } : {}) } : null;
    }).filter(Boolean);
  }
  _links = links.map(l => ({ ...l, type: l.type || 'trace' }));

  // ── HTML ──────────────────────────────────────────────────────────────────
  wrapper.innerHTML = `
    <div class="vme-wrap">
      <div class="vme-toolbar">
        <div class="vme-toolbar-left">
          <button class="btn btn-secondary btn-sm" id="vme-load-aspice-ext"
            title="ASPICE SW V-model with Customer Requirements">↺ ASPICE</button>
          <button class="btn btn-secondary btn-sm" id="vme-load-iso26262"
            title="ISO 26262 safety chain: Customer Req → FSR → TSR → System Req → …">↺ ISO 26262</button>
          <button class="btn btn-secondary btn-sm" id="vme-load-multisys"
            title="Multi-system: Item Requirements + Item Architecture above System Requirements">↺ Multi-System</button>
          <button class="btn btn-secondary btn-sm" id="vme-load-multidom"
            title="Multi-Domain: shared top chain + interactive SW/HW/MECH domain panels with full V each">↺ Multi-Domain</button>
          <button class="btn btn-ghost btn-sm" id="vme-autofit" title="Fit all nodes into view">⊡ Autofit</button>
          <button class="btn btn-ghost btn-sm" id="vme-clear">Clear</button>
        </div>
        <div class="vme-toolbar-right">
          <div class="vme-legend">
            <span class="vme-legend-trace">↔ Bidirectional traceability</span>
          </div>
          <button class="btn btn-primary btn-sm" id="vme-save">Save</button>
        </div>
      </div>
      <div class="vme-hint-bar" id="vme-hint">
        Click a node to connect or delete · Drag to reposition · Drag the midpoint dot to reroute a connection
      </div>
      <div class="vme-body">
        <div class="vme-palette" id="vme-palette">
          <div class="vme-palette-title">Palette</div>
          <div id="vme-pal-list"></div>
        </div>
        <div class="vme-canvas-scroll">
          <div class="vme-canvas" id="vme-canvas">
            <svg class="vme-svg" id="vme-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id="arr-trace" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-trace-start" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto-start-reverse">
                  <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
                </marker>
                <marker id="arr-rubber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#F29900"/>
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = wrapper.querySelector('#vme-canvas');
  const svg    = wrapper.querySelector('#vme-svg');
  const hint   = wrapper.querySelector('#vme-hint');

  // ── Palette ───────────────────────────────────────────────────────────────
  function refreshPalette() {
    const placed = new Set(_nodes.map(n => n.id));
    const list   = wrapper.querySelector('#vme-pal-list');
    const avail  = VMODEL_NODES.filter(n => !placed.has(n.id) && n.special !== 'domain_panel');
    if (!avail.length) { list.innerHTML = `<p class="vme-pal-empty">All nodes placed.</p>`; return; }
    const groups = {};
    avail.forEach(n => (groups[n.domain] = groups[n.domain] || []).push(n));
    const dOrder = ['customer','safety','item','system','sw','hw','mech'];
    const dLabel = { customer:'Customer', safety:'Safety', item:'Item', system:'System', sw:'SW', hw:'HW', mech:'MECH' };
    list.innerHTML = dOrder.filter(d => groups[d]).map(d => `
      <div class="vme-pal-group">
        <div class="vme-pal-group-label">${dLabel[d]}</div>
        ${groups[d].map(n => `<div class="vme-pal-item vme-nd--${n.domain}" draggable="true" data-nodeid="${n.id}">${n.label}</div>`).join('')}
      </div>`).join('');
    list.querySelectorAll('.vme-pal-item').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.nodeid); e.dataTransfer.effectAllowed = 'copy'; });
    });
  }

  // ── Canvas drop ───────────────────────────────────────────────────────────
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const nodeId = e.dataTransfer.getData('text/plain');
    const def    = VMODEL_NODES.find(n => n.id === nodeId);
    if (!def) return;
    const rect = canvas.getBoundingClientRect();
    _nodes.push({ ...def, x: Math.max(0, (e.clientX - rect.left) / _scale - NODE_W / 2), y: Math.max(0, (e.clientY - rect.top) / _scale - NODE_H / 2) });
    _dirty = true; render();
  });

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    closePopover();
    refreshPalette();
    renderNodes();
    renderSVG();
  }

  function renderNodes() {
    canvas.querySelectorAll('.vme-node').forEach(el => el.remove());
    _panelCanvas = null; _panelSVG = null;

    _nodes.forEach(node => {
      if (node.panelDomain) return; // rendered inside domain panel, not main canvas

      const div = document.createElement('div');
      if (node.special === 'domain_panel') {
        div.className  = 'vme-node vme-domain-panel';
        div.style.left  = node.x + 'px';
        div.style.top   = node.y + 'px';
        div.style.width  = PANEL_W + 'px';
        div.style.height = PANEL_H + 'px';
        div.dataset.nid  = node.id;
        div.innerHTML    = buildDomainPanelHTML();
        canvas.appendChild(div);
        wireDomainPanel(div, node);
      } else {
        div.className   = `vme-node vme-nd--${node.domain}`;
        div.style.left  = node.x + 'px';
        div.style.top   = node.y + 'px';
        div.dataset.nid = node.id;
        div.textContent = node.label;
        if (_connectFrom === node.id) div.classList.add('vme-node--source');
        else if (_connectFrom)        div.classList.add('vme-node--target-hint');
        canvas.appendChild(div);
        wireNode(div, node);
      }
    });
  }

  // ── Domain panel ──────────────────────────────────────────────────────────

  // Heights for domain panel internal layout (px)
  const DP_HEADER_H = 28;
  const DP_TABS_H   = 34;
  const DP_BODY_TOP = DP_HEADER_H + DP_TABS_H;          // absolute top of body
  const DP_CANVAS_H = PANEL_H - DP_BODY_TOP - 8 - 4;   // 8 = body padding*2, 4 = border*2

  function buildDomainPanelHTML() {
    const tabs = ['sw', 'hw', 'mech'].map(d =>
      `<button class="vme-dp-tab${d === _domainTab ? ' active' : ''}" data-tab="${d}">${d.toUpperCase()}</button>`
    ).join('');
    return `
      <div class="vme-dp-header" style="height:${DP_HEADER_H}px">
        <span class="vme-dp-title">⠿ Domain Implementations</span>
        <button class="vme-dp-del" title="Delete panel">✕</button>
      </div>
      <div class="vme-dp-tabs" style="height:${DP_TABS_H}px">
        ${tabs}
        <div class="vme-dp-zoom-bar">
          <button class="vme-dp-zoom-btn" data-zoom="in"  title="Zoom in">+</button>
          <button class="vme-dp-zoom-btn" data-zoom="out" title="Zoom out">−</button>
          <button class="vme-dp-zoom-btn" data-zoom="fit" title="Autofit">⊡</button>
        </div>
      </div>
      <div class="vme-dp-body" style="top:${DP_BODY_TOP}px">
        <div class="vme-dp-canvas" id="vme-dp-canvas" style="height:${DP_CANVAS_H}px">
          <svg class="vme-dp-svg" id="vme-dp-svg" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="dp-arr-trace" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
              </marker>
              <marker id="dp-arr-trace-start" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto-start-reverse">
                <polygon points="0 0, 8 3, 0 6" fill="#1A73E8" opacity="0.8"/>
              </marker>
              <marker id="dp-arr-rubber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#F29900"/>
              </marker>
            </defs>
          </svg>
        </div>
      </div>
    `;
  }

  function wireDomainPanel(panelDiv, panelNode) {
    // Drag from header
    const header = panelDiv.querySelector('.vme-dp-header');
    header.style.cursor = 'grab';
    header.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      closePopover();
      const rect = canvas.getBoundingClientRect();
      _drag = {
        nodeId: panelNode.id,
        offX:   (e.clientX - rect.left) / _scale - panelNode.x,
        offY:   (e.clientY - rect.top)  / _scale - panelNode.y,
        moved:  false, startX: e.clientX, startY: e.clientY,
      };
      header.style.cursor = 'grabbing';
    });

    // Tab switching
    panelDiv.querySelectorAll('.vme-dp-tab').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _domainTab = btn.dataset.tab;
        _panelScale = 1;
        if (_panelCanvas) { _panelCanvas.style.transform = ''; }
        panelDiv.querySelectorAll('.vme-dp-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _domainTab));
        renderDomainCanvas();
        renderDomainSVG();
      });
    });

    // Delete: remove panel + all domain nodes/links
    panelDiv.querySelector('.vme-dp-del').addEventListener('click', e => {
      e.stopPropagation();
      const panelNodeIds = new Set(_nodes.filter(n => n.panelDomain).map(n => n.id));
      panelNodeIds.add(panelNode.id);
      _nodes = _nodes.filter(n => !panelNodeIds.has(n.id));
      _links = _links.filter(l => !panelNodeIds.has(l.from) && !panelNodeIds.has(l.to));
      _dirty = true; render();
    });

    // Cache references
    _panelCanvas = panelDiv.querySelector('#vme-dp-canvas');
    _panelSVG    = panelDiv.querySelector('#vme-dp-svg');

    // ── Panel zoom controls ──
    function applyPanelScale() {
      _panelCanvas.firstElementChild && (_panelCanvas.querySelector('.vme-dp-zoom-inner') || _panelCanvas).style.transform;
      // Apply scale to the inner content wrapper (nodes + SVG scroll together)
      // We scale _panelCanvas's children via a wrapper transform on a scroll-inner div
      // Since nodes+SVG are absolutely positioned inside _panelCanvas, scale _panelCanvas itself
      _panelCanvas.style.transformOrigin = '0 0';
      _panelCanvas.style.transform = `scale(${_panelScale})`;
    }

    function panelAutofit() {
      const tabNodes = _nodes.filter(n => n.panelDomain === _domainTab);
      if (!tabNodes.length) return;
      const PAD = 20;
      const maxX = Math.max(...tabNodes.map(n => n.x + NODE_W)) + PAD;
      const maxY = Math.max(...tabNodes.map(n => n.y + NODE_H)) + PAD;
      const viewW = _panelCanvas.clientWidth  || (PANEL_W - 8);
      const viewH = _panelCanvas.clientHeight || DP_CANVAS_H;
      _panelScale = Math.min(viewW / maxX, viewH / maxY, 1.5);
      applyPanelScale();
    }

    panelDiv.querySelectorAll('.vme-dp-zoom-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (btn.dataset.zoom === 'in')  { _panelScale = Math.min(_panelScale * 1.25, 3); applyPanelScale(); }
        if (btn.dataset.zoom === 'out') { _panelScale = Math.max(_panelScale / 1.25, 0.2); applyPanelScale(); }
        if (btn.dataset.zoom === 'fit') { panelAutofit(); }
      });
    });

    _panelCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      _panelScale = Math.min(Math.max(_panelScale * factor, 0.2), 3);
      applyPanelScale();
    }, { passive: false });

    // Render domain nodes & links for current tab
    renderDomainCanvas();
    renderDomainSVG();

    // Panel can be a link target from main canvas
    if (_connectFrom && !_nodes.find(n => n.id === _connectFrom)?.panelDomain) {
      panelDiv.style.cursor = 'crosshair';
      panelDiv.addEventListener('click', e => {
        const t = e.target;
        // Only fire if clicking on background/header, not on inner nodes
        if (t.closest('.vme-dp-canvas') && t !== _panelCanvas && !t.isSameNode(_panelSVG)) return;
        e.stopPropagation();
        finishConnect(panelNode.id);
      });
    }

    // Click on panel canvas background to cancel connect or close popover
    if (_panelCanvas) {
      _panelCanvas.addEventListener('click', e => {
        if (e.target !== _panelCanvas && e.target !== _panelSVG) return;
        if (_connectFrom) { cancelConnect(); renderDomainCanvas(); renderDomainSVG(); }
        closePopover();
      });
    }
  }

  function renderDomainCanvas() {
    if (!_panelCanvas) return;
    _panelCanvas.querySelectorAll('.vme-dp-node').forEach(el => el.remove());
    const tabNodes = _nodes.filter(n => n.panelDomain === _domainTab);
    tabNodes.forEach(node => {
      const div = document.createElement('div');
      div.className  = `vme-dp-node vme-node vme-nd--${node.domain}`;
      div.style.left = node.x + 'px';
      div.style.top  = node.y + 'px';
      div.dataset.nid = node.id;
      div.textContent = node.label;
      if (_connectFrom === node.id) div.classList.add('vme-node--source');
      else if (_connectFrom)        div.classList.add('vme-node--target-hint');
      _panelCanvas.appendChild(div);
      wirePanelNode(div, node);
    });
  }

  function wirePanelNode(div, node) {
    if (_connectFrom && _connectFrom !== node.id) {
      div.style.cursor = 'crosshair';
      div.addEventListener('click', e => { e.stopPropagation(); finishConnect(node.id); });
      return;
    }
    div.style.cursor = 'grab';
    div.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      closePopover();
      const rect = _panelCanvas.getBoundingClientRect();
      _drag = {
        nodeId: node.id,
        offX:   (e.clientX - rect.left) / _panelScale - node.x,
        offY:   (e.clientY - rect.top)  / _panelScale - node.y,
        moved:  false, startX: e.clientX, startY: e.clientY,
        isPanelNode: true,
      };
      div.style.cursor = 'grabbing';
      div.classList.add('vme-node--dragging');
    });
    div.addEventListener('click', e => {
      if (_drag?.moved) return;
      e.stopPropagation();
      showPanelNodeMenu(node, div);
    });
  }

  function showPanelNodeMenu(node, div) {
    if (!_panelCanvas) return;
    closePopover();
    const menu = document.createElement('div');
    menu.className = 'vme-menu';
    menu.style.left = (node.x + NODE_W + 6) + 'px';
    menu.style.top  = node.y + 'px';
    menu.innerHTML = `
      <div class="vme-menu-title">${node.label}</div>
      <button class="vme-menu-item vme-menu-trace" data-action="trace">↔ Add Bidirectional traceability link</button>
      <div class="vme-menu-sep"></div>
      <button class="vme-menu-item vme-menu-del" data-action="del">✕ Delete node</button>
    `;
    _panelCanvas.appendChild(menu);
    _popover = menu;

    menu.querySelector('[data-action="trace"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _connectFrom = node.id; _connectType = 'trace';
      setHint(`<span style="color:#1A73E8">↔ Bidirectional traceability</span> from <strong>${node.label}</strong> — click the target node · Esc to cancel`);
      renderDomainCanvas(); renderDomainSVG();
    });
    menu.querySelector('[data-action="del"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _nodes = _nodes.filter(n => n.id !== node.id);
      _links = _links.filter(l => l.from !== node.id && l.to !== node.id);
      _dirty = true;
      renderDomainCanvas(); renderDomainSVG(); refreshPalette();
    });
  }

  // Ghost node fixed positions within the domain panel (in panel-local coordinates)
  const DOMAIN_GHOST_POS = {
    sys_req:   { x: -10, y: -58 },
    sys_arch:  { x: 200, y: -58 },
    item_req:  { x: -10, y: -118 },
    item_arch: { x: 200, y: -118 },
    fsr:       { x: -10, y: -178 },
    tsr:       { x: 200, y: -178 },
  };
  const ALL_NODE_DEFS = Object.fromEntries(VMODEL_NODES.map(n => [n.id, n]));

  function renderDomainSVG() {
    if (!_panelSVG) return;
    _panelSVG.querySelectorAll('.vme-link, .vme-link-hit, .vme-bend-handle, .vme-rubber').forEach(el => el.remove());
    const tabIds  = new Set(_nodes.filter(n => n.panelDomain === _domainTab).map(n => n.id));
    const nodeMap = Object.fromEntries(_nodes.filter(n => n.panelDomain === _domainTab).map(n => [n.id, n]));

    // Size SVG to cover all domain nodes (1:1 pixel coords — no viewBox rescaling)
    let maxX = 0, maxY = 0;
    for (const n of Object.values(nodeMap)) {
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const PAD = 20;
    _panelSVG.setAttribute('width',  maxX + PAD);
    _panelSVG.setAttribute('height', maxY + PAD);
    _panelSVG.removeAttribute('viewBox');

    // Draw only pure domain links (both endpoints inside the panel tab)
    _links.forEach(link => {
      if (!tabIds.has(link.from) || !tabIds.has(link.to)) return;
      const a = nodeMap[link.from], b = nodeMap[link.to];
      if (!a || !b) return;
      drawLinkIn(_panelSVG, link, a, b, true);
    });
    renderDomainRubberBand();
  }

  function renderDomainRubberBand() {
    if (!_panelSVG || !_connectFrom) return;
    const src = _nodes.find(n => n.id === _connectFrom);
    if (!src?.panelDomain) return;
    _panelSVG.querySelectorAll('.vme-rubber').forEach(el => el.remove());
    const ax = src.x + NODE_W / 2, ay = src.y + NODE_H / 2;
    const line = mkSVG('line');
    line.setAttribute('x1', ax); line.setAttribute('y1', ay);
    line.setAttribute('x2', _panelMouseX); line.setAttribute('y2', _panelMouseY);
    line.setAttribute('stroke', '#F29900'); line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 3'); line.setAttribute('opacity', '0.75');
    line.setAttribute('marker-end', 'url(#dp-arr-rubber)');
    line.classList.add('vme-rubber'); line.style.pointerEvents = 'none';
    _panelSVG.appendChild(line);
    const pulse = mkSVG('circle');
    pulse.setAttribute('cx', ax); pulse.setAttribute('cy', ay); pulse.setAttribute('r', '10');
    pulse.setAttribute('fill', 'none'); pulse.setAttribute('stroke', '#F29900');
    pulse.setAttribute('stroke-width', '2'); pulse.setAttribute('opacity', '0.5');
    pulse.classList.add('vme-rubber');
    _panelSVG.appendChild(pulse);
  }

  // ── Link drawing (shared between main SVG and panel SVG) ──────────────────

  function clipToRect(cx, cy, tx, ty, hw, hh) {
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(scaleX, scaleY);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function nW(n) { return n.special === 'domain_panel' ? PANEL_W : NODE_W; }
  function nH(n) { return n.special === 'domain_panel' ? PANEL_H : NODE_H; }

  function drawLinkIn(targetSVG, link, a, b, inPanel) {
    const aw = nW(a), ah = nH(a), bw = nW(b), bh = nH(b);
    const acx = a.x + aw / 2, acy = a.y + ah / 2;
    const bcx = b.x + bw / 2, bcy = b.y + bh / 2;
    const mx = (acx + bcx) / 2, my = (acy + bcy) / 2;
    const cpx = mx + (link.bend?.x || 0);
    const cpy = my + (link.bend?.y || 0);
    const pa = clipToRect(acx, acy, cpx, cpy, aw / 2 + 2, ah / 2 + 2);
    const pb = clipToRect(bcx, bcy, cpx, cpy, bw / 2 + 2, bh / 2 + 2);
    const d = `M${pa.x},${pa.y} Q${cpx},${cpy} ${pb.x},${pb.y}`;
    const vmx = (pa.x + 2 * cpx + pb.x) / 4;
    const vmy = (pa.y + 2 * cpy + pb.y) / 4;

    const mEnd   = inPanel ? 'url(#dp-arr-trace)'       : 'url(#arr-trace)';
    const mStart = inPanel ? 'url(#dp-arr-trace-start)'  : 'url(#arr-trace-start)';

    const hit = mkSVG('path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.setAttribute('fill', 'none');
    hit.classList.add('vme-link-hit');
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', e => {
      e.stopPropagation();
      const refEl = inPanel ? _panelCanvas : canvas;
      if (!refEl) return;
      const rect = refEl.getBoundingClientRect();
      const sc = inPanel ? _panelScale : _scale;
      showLinkMenu(link, (e.clientX - rect.left) / sc, (e.clientY - rect.top) / sc, inPanel);
    });

    const path = mkSVG('path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#1A73E8');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', 'none');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', '0.8');
    path.setAttribute('marker-end', mEnd);
    path.setAttribute('marker-start', mStart);
    path.classList.add('vme-link');

    targetSVG.appendChild(hit);
    targetSVG.appendChild(path);

    const ring = mkSVG('circle');
    ring.setAttribute('cx', vmx); ring.setAttribute('cy', vmy); ring.setAttribute('r', '8');
    ring.setAttribute('fill', 'transparent'); ring.setAttribute('stroke', '#1A73E8');
    ring.setAttribute('stroke-width', '1.5'); ring.setAttribute('opacity', '0.35');
    ring.style.cursor = 'move'; ring.style.pointerEvents = 'all';
    ring.classList.add('vme-bend-handle');

    const dot = mkSVG('circle');
    dot.setAttribute('cx', vmx); dot.setAttribute('cy', vmy); dot.setAttribute('r', '4');
    dot.setAttribute('fill', '#1A73E8'); dot.setAttribute('opacity', '0.55');
    dot.style.cursor = 'move'; dot.style.pointerEvents = 'all';
    dot.classList.add('vme-bend-handle');

    const startBend = e => {
      e.stopPropagation(); e.preventDefault();
      closePopover();
      _bendDrag = {
        linkId: link.id,
        startMX: e.clientX, startMY: e.clientY,
        startBX: link.bend?.x || 0,
        startBY: link.bend?.y || 0,
        isPanelLink: inPanel,
      };
    };
    ring.addEventListener('mousedown', startBend);
    dot.addEventListener('mousedown', startBend);

    targetSVG.appendChild(ring);
    targetSVG.appendChild(dot);
  }

  // ── SVG (main canvas) ─────────────────────────────────────────────────────
  function renderSVG() {
    svg.querySelectorAll('.vme-link, .vme-link-hit, .vme-bend-handle, .vme-rubber').forEach(el => el.remove());
    const nodeMap = Object.fromEntries(_nodes.map(n => [n.id, n]));
    const drawnCrossLevel = new Set();
    _links.forEach(link => {
      const a = nodeMap[link.from], b = nodeMap[link.to];
      if (!a || !b) return;
      if (a.panelDomain && b.panelDomain) return; // both inside panel — handled by renderDomainSVG
      if (a.panelDomain || b.panelDomain) {
        // Cross-level link: draw visually as a single arrow from the main-canvas node to the domain_panel box
        const panelNode = nodeMap['domain_panel'];
        if (!panelNode) return;
        const mainNode = a.panelDomain ? b : a;
        const key = mainNode.id;
        if (drawnCrossLevel.has(key)) return; // deduplicate — draw once per source
        drawnCrossLevel.add(key);
        drawLinkIn(svg, { id: 'cl_' + key, from: mainNode.id, to: 'domain_panel', type: link.type, bend: link.bend }, mainNode, panelNode, false);
        return;
      }
      drawLinkIn(svg, link, a, b, false);
    });
    renderRubberBand();
  }

  function renderRubberBand() {
    svg.querySelectorAll('.vme-rubber').forEach(el => el.remove());
    if (!_connectFrom) return;
    const src = _nodes.find(n => n.id === _connectFrom);
    if (!src || src.panelDomain) return;
    const ax = src.x + NODE_W / 2, ay = src.y + NODE_H / 2;
    const line = mkSVG('line');
    line.setAttribute('x1', ax); line.setAttribute('y1', ay);
    line.setAttribute('x2', _mouseX); line.setAttribute('y2', _mouseY);
    line.setAttribute('stroke', '#F29900'); line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6 3'); line.setAttribute('opacity', '0.75');
    line.setAttribute('marker-end', 'url(#arr-rubber)');
    line.classList.add('vme-rubber'); line.style.pointerEvents = 'none';
    svg.appendChild(line);
    const pulse = mkSVG('circle');
    pulse.setAttribute('cx', ax); pulse.setAttribute('cy', ay); pulse.setAttribute('r', '10');
    pulse.setAttribute('fill', 'none'); pulse.setAttribute('stroke', '#F29900');
    pulse.setAttribute('stroke-width', '2'); pulse.setAttribute('opacity', '0.5');
    pulse.classList.add('vme-rubber');
    svg.appendChild(pulse);
  }

  // ── Context menus ─────────────────────────────────────────────────────────
  function wireNode(div, node) {
    if (_connectFrom && _connectFrom !== node.id) {
      div.style.cursor = 'crosshair';
      div.addEventListener('click', e => { e.stopPropagation(); finishConnect(node.id); });
      return;
    }
    div.style.cursor = 'grab';
    div.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); closePopover();
      const rect = canvas.getBoundingClientRect();
      _drag = {
        nodeId: node.id,
        offX: (e.clientX - rect.left) / _scale - node.x,
        offY: (e.clientY - rect.top)  / _scale - node.y,
        moved: false, startX: e.clientX, startY: e.clientY,
      };
      div.style.cursor = 'grabbing';
      div.classList.add('vme-node--dragging');
    });
    div.addEventListener('click', e => {
      if (_drag?.moved) return;
      e.stopPropagation();
      showNodeMenu(node, div);
    });
  }

  function showNodeMenu(node, div) {
    closePopover();
    const menu = document.createElement('div');
    menu.className = 'vme-menu';
    menu.style.left = (node.x + NODE_W + 6) + 'px';
    menu.style.top  = node.y + 'px';
    menu.innerHTML = `
      <div class="vme-menu-title">${node.label}</div>
      <button class="vme-menu-item vme-menu-trace" data-action="trace">↔ Add Bidirectional traceability link</button>
      <div class="vme-menu-sep"></div>
      <button class="vme-menu-item vme-menu-del" data-action="del">✕ Delete node</button>
    `;
    canvas.appendChild(menu);
    _popover = menu;
    menu.querySelector('[data-action="trace"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _connectFrom = node.id; _connectType = 'trace';
      setHint(`<span style="color:#1A73E8">↔ Bidirectional traceability</span> from <strong>${node.label}</strong> — click the target node · Esc to cancel`);
      renderNodes(); renderSVG();
    });
    menu.querySelector('[data-action="del"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _nodes = _nodes.filter(n => n.id !== node.id);
      _links = _links.filter(l => l.from !== node.id && l.to !== node.id);
      _dirty = true; render();
    });
  }

  function showLinkMenu(link, x, y, inPanel) {
    closePopover();
    const menu = document.createElement('div');
    menu.className = 'vme-menu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    menu.innerHTML = `
      <div class="vme-menu-title" style="color:#1A73E8">↔ Bidirectional traceability link</div>
      <button class="vme-menu-item vme-menu-del" data-action="del">✕ Delete link</button>
    `;
    const container = (inPanel && _panelCanvas) ? _panelCanvas : canvas;
    container.appendChild(menu);
    _popover = menu;
    menu.querySelector('[data-action="del"]').addEventListener('click', e => {
      e.stopPropagation(); closePopover();
      _links = _links.filter(l => l.id !== link.id);
      _dirty = true;
      if (inPanel) { renderDomainSVG(); } else { renderSVG(); }
    });
  }

  function closePopover() { _popover?.remove(); _popover = null; }

  function finishConnect(toId) {
    const from = _connectFrom, type = _connectType;
    if (toId === 'domain_panel') {
      // Expand: create direct links to each domain req node that exists in _nodes
      for (const d of ['sw', 'hw', 'mech']) {
        const reqId = `${d}_req`;
        if (!_nodes.find(n => n.id === reqId)) continue;
        const dup = _links.some(l => l.type === type && ((l.from === from && l.to === reqId) || (l.from === reqId && l.to === from)));
        if (!dup) { _links.push({ id: uid(), from, to: reqId, type }); _dirty = true; }
      }
    } else {
      const dup = _links.some(l => l.type === type && ((l.from === from && l.to === toId) || (l.from === toId && l.to === from)));
      if (!dup) { _links.push({ id: uid(), from, to: toId, type }); _dirty = true; }
    }
    cancelConnect();
    render();
  }

  function cancelConnect() {
    _connectFrom = null; _connectType = null;
    setHint('Click a node to connect or delete · Drag to reposition · Drag the midpoint dot to reroute a connection');
  }

  // ── Autofit ───────────────────────────────────────────────────────────────
  function autofit() {
    const mainNodes = _nodes.filter(n => !n.panelDomain);
    if (!mainNodes.length) return;
    const PAD = 32;
    const minX = Math.min(...mainNodes.map(n => n.x)) - PAD;
    const minY = Math.min(...mainNodes.map(n => n.y)) - PAD;
    const maxX = Math.max(...mainNodes.map(n => n.x + nW(n))) + PAD;
    const maxY = Math.max(...mainNodes.map(n => n.y + nH(n))) + PAD;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const scrollEl = wrapper.querySelector('.vme-canvas-scroll');
    const viewW = scrollEl.clientWidth  || 800;
    const viewH = scrollEl.clientHeight || 460;
    _scale = Math.min(viewW / contentW, viewH / contentH, 1);
    canvas.style.transform       = `scale(${_scale})`;
    canvas.style.transformOrigin = '0 0';
    canvas.style.marginBottom = `${contentH * _scale - canvas.offsetHeight}px`;
    scrollEl.scrollLeft = minX * _scale;
    scrollEl.scrollTop  = minY * _scale;
  }

  // ── Global mouse events ───────────────────────────────────────────────────
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    _mouseX = (e.clientX - rect.left) / _scale;
    _mouseY = (e.clientY - rect.top)  / _scale;

    if (_panelCanvas) {
      const pr = _panelCanvas.getBoundingClientRect();
      _panelMouseX = (e.clientX - pr.left) / _panelScale;
      _panelMouseY = (e.clientY - pr.top)  / _panelScale;
    }

    if (_connectFrom) {
      const src = _nodes.find(n => n.id === _connectFrom);
      if (src?.panelDomain) { renderDomainRubberBand(); }
      else                  { renderRubberBand(); }
      return;
    }

    if (_bendDrag) {
      const link = _links.find(l => l.id === _bendDrag.linkId);
      if (link) {
        const bendSc = _bendDrag.isPanelLink ? _panelScale : _scale;
        link.bend = {
          x: _bendDrag.startBX + (e.clientX - _bendDrag.startMX) / bendSc,
          y: _bendDrag.startBY + (e.clientY - _bendDrag.startMY) / bendSc,
        };
        if (_bendDrag.isPanelLink) { renderDomainSVG(); } else { renderSVG(); }
        _dirty = true;
      }
      return;
    }

    if (_drag) {
      const dx = e.clientX - _drag.startX, dy = e.clientY - _drag.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) _drag.moved = true;
      if (_drag.moved) {
        const node = _nodes.find(n => n.id === _drag.nodeId);
        if (node) {
          if (_drag.isPanelNode && _panelCanvas) {
            const pr = _panelCanvas.getBoundingClientRect();
            node.x = Math.max(0, (e.clientX - pr.left) / _panelScale - _drag.offX);
            node.y = Math.max(0, (e.clientY - pr.top)  / _panelScale - _drag.offY);
            const div = _panelCanvas.querySelector(`[data-nid="${node.id}"]`);
            if (div) { div.style.left = node.x + 'px'; div.style.top = node.y + 'px'; }
            renderDomainSVG(); _dirty = true;
          } else {
            node.x = Math.max(0, (e.clientX - rect.left) / _scale - _drag.offX);
            node.y = Math.max(0, (e.clientY - rect.top)  / _scale - _drag.offY);
            const div = canvas.querySelector(`[data-nid="${node.id}"]`);
            if (div) { div.style.left = node.x + 'px'; div.style.top = node.y + 'px'; }
            renderSVG(); _dirty = true;
          }
        }
      }
    }
  }

  function onMouseUp() {
    if (_bendDrag) { _bendDrag = null; return; }
    if (_drag) {
      const lookIn = (_drag.isPanelNode && _panelCanvas) ? _panelCanvas : canvas;
      const div = lookIn.querySelector(`[data-nid="${_drag.nodeId}"]`);
      if (div) { div.style.cursor = 'grab'; div.classList.remove('vme-node--dragging'); }
      _drag = null;
    }
  }

  // ── Canvas click (cancel connect / close popover) ─────────────────────────
  canvas.addEventListener('click', e => {
    if (e.target !== canvas && e.target !== svg) return;
    if (_connectFrom) { cancelConnect(); renderNodes(); renderSVG(); }
    closePopover();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (_connectFrom) { cancelConnect(); renderNodes(); renderSVG(); renderDomainCanvas(); renderDomainSVG(); }
      closePopover();
    }
  });

  // ── Confirm dialog ────────────────────────────────────────────────────────
  function vmeConfirm(message, onConfirm) {
    wrapper.querySelector('.vme-confirm-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'vme-confirm-overlay';
    overlay.innerHTML = `
      <div class="vme-confirm-box">
        <div class="vme-confirm-msg">${message}</div>
        <div class="vme-confirm-actions">
          <button class="btn btn-ghost btn-sm vme-confirm-cancel">Cancel</button>
          <button class="btn btn-danger btn-sm vme-confirm-ok">Replace</button>
        </div>
      </div>`;
    wrapper.appendChild(overlay);
    overlay.querySelector('.vme-confirm-ok').addEventListener('click', () => { overlay.remove(); onConfirm(); });
    overlay.querySelector('.vme-confirm-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function loadTemplate(templateNodes, templateLinks) {
    const doLoad = () => {
      _nodes = templateNodes.map(cn => {
        const def = VMODEL_NODES.find(n => n.id === cn.nodeId);
        return def ? { ...def, x: cn.x, y: cn.y, ...(cn.panelDomain ? { panelDomain: cn.panelDomain } : {}) } : null;
      }).filter(Boolean);
      _links = templateLinks.map(al => ({ id: uid(), ...al }));
      _scale = 1;
      canvas.style.transform = '';
      _dirty = true;
      renderAndFit();
    };
    if (_nodes.length || _links.length) {
      vmeConfirm('This will replace the current V-model with the selected template.', doLoad);
    } else {
      doLoad();
    }
  }

  function renderAndFit() {
    render();
    requestAnimationFrame(autofit);
  }

  wrapper.querySelector('#vme-autofit').addEventListener('click', autofit);
  wrapper.querySelector('#vme-load-aspice-ext').addEventListener('click', () => loadTemplate(ASPICE_EXT_NODES, ASPICE_EXT_LINKS));
  wrapper.querySelector('#vme-load-iso26262').addEventListener('click', () => loadTemplate(ISO26262_NODES, ISO26262_LINKS));
  wrapper.querySelector('#vme-load-multisys').addEventListener('click', () => loadTemplate(MULTI_SYS_NODES, MULTI_SYS_LINKS));
  wrapper.querySelector('#vme-load-multidom').addEventListener('click', () => loadTemplate(MULTI_DOM_NODES, MULTI_DOM_LINKS));

  // ── Clear ─────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-clear').addEventListener('click', () => {
    vmeConfirm('Clear all nodes and links?', () => {
      _nodes = []; _links = []; _connectFrom = null; _dirty = true;
      render();
    });
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  wrapper.querySelector('#vme-save').addEventListener('click', async () => {
    const btn = wrapper.querySelector('#vme-save');
    btn.disabled = true;
    const canvasNodesSave = _nodes.map(n => ({
      nodeId: n.id, x: n.x, y: n.y,
      ...(n.panelDomain ? { panelDomain: n.panelDomain } : {}),
    }));
    const newConfig = { ...fullConfig, vmodel_links: _links, vmodel_canvas_nodes: canvasNodesSave };
    let error;
    if (configId) {
      ({ error } = await sb.from('project_config').update({ config: newConfig, updated_at: new Date().toISOString() }).eq('id', configId));
    } else {
      ({ error } = await sb.from('project_config').insert({ project_id: project.id, config: newConfig }));
    }
    btn.disabled = false;
    if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    Object.assign(fullConfig, newConfig);
    _dirty = false;
    toast('V-Model saved.', 'success');
    if (onSave) onSave(_links, canvasNodesSave);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function mkSVG(tag)  { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function uid()       { return crypto.randomUUID(); }
  function setHint(h)  { if (hint) hint.innerHTML = h; }

  if (!_nodes.length && !_links.length) {
    // New project — auto-load Multi-Domain as default template (no confirmation needed)
    loadTemplate(MULTI_DOM_NODES, MULTI_DOM_LINKS);
  } else {
    render();
    if (_nodes.length) requestAnimationFrame(autofit);
  }

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  };
}
