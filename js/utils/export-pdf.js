/**
 * export-pdf.js — Print-to-PDF helpers for FHA and FTA
 *
 * Opens a styled print window and triggers window.print() automatically.
 * The user can then "Save as PDF" from the browser print dialog.
 */

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─────────────────────────────────────────────────────────────────────────────
// FHA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export FHA page to PDF.
 * @param {HTMLElement} container  - the FHA page container element
 * @param {string}      title      - document title (project / item name)
 */
export function exportFHApdf(container, title) {
  const headerEl = container.querySelector('.page-header');
  const bodyEl   = container.querySelector('#fha-body');
  if (!bodyEl) return;

  // Clone and strip interactive controls
  const headerClone = headerEl ? headerEl.cloneNode(true) : null;
  if (headerClone) {
    headerClone.querySelectorAll('button, a.btn, .btn').forEach(b => b.remove());
  }
  const bodyClone = bodyEl.cloneNode(true);
  bodyClone.querySelectorAll(
    'button, a.btn, .btn, .btn-icon, .btn-ghost, ' +
    '.fha-hazop-panel, .pha-add-row-anchor, .pha-inline-row'
  ).forEach(b => b.remove());
  // Remove empty anchors and spacers that inflate height
  bodyClone.querySelectorAll('.pha-spacer').forEach(s => { s.style.flex = '0'; });

  const headerHtml = headerClone
    ? headerClone.outerHTML
    : `<div class="page-header"><h1>${esc(title)} — FHA</h1></div>`;

  const date = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)} — FHA</title>
<style>
@page { size: A4 landscape; margin: 12mm 15mm 14mm; }
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 10.5px; color: #111; background: #fff; margin: 0; padding: 0;
}

/* ── Header ── */
.page-header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
.page-header-top { display: flex; align-items: flex-start; justify-content: space-between; }
h1 { font-size: 17px; margin: 0; }
.page-subtitle { font-size: 10px; color: #555; margin: 2px 0 0; }
.print-date { font-size: 9px; color: #888; margin-top: 2px; text-align: right; }
.pha-sbar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.pha-sbar-pill { padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; }

/* ── Feature block ── */
.pha-feat { border: 1px solid #ccc; border-radius: 4px; margin-bottom: 10px; overflow: hidden; page-break-inside: avoid; }
.pha-feat-hdr {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; background: #f4f5f7;
  border-bottom: 1px solid #ccc; font-weight: 700; font-size: 11px;
}
.pha-feat-icon { font-size: 12px; color: #FF8B00; }
.pha-cnt { font-size: 9px; font-weight: 700; color: #FF8B00; background: #FF8B0015;
  padding: 1px 6px; border-radius: 10px; margin-left: auto; }

/* ── UC ── */
.pha-uc-wrap { border-bottom: 1px solid #ddd; }
.pha-uc-wrap:last-child { border-bottom: none; }
.pha-uc-hdr {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px 4px 12px; font-size: 10.5px;
}
.pha-uc-indent, .pha-uc-icon { color: #888; font-size: 10px; }
.pha-uc-code  { font-family: monospace; font-size: 10px; color: #444; font-weight: 700; }
.pha-uc-name  { color: #111; }

/* ── Function ── */
.fha-fun-wrap { }
.fha-fun-hdr {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 10px 3px 22px; background: #fafafa;
  border-bottom: 1px solid #eee; font-size: 10px;
}
.fha-fun-indent { font-family: monospace; font-size: 10px; color: #aaa; }
.fha-fun-icon   { font-size: 10px; color: #1A73E8; }
.fha-fun-code   { font-family: monospace; font-size: 9px; font-weight: 700; color: #333; }
.fha-fun-name   { font-weight: 600; color: #111; }
.fun-type-badge { font-size: 8px; background: #e3e8f0; padding: 1px 4px; border-radius: 2px; color: #334; }
.pha-ctx-desc   { font-weight: 400; color: #666; }
.pha-mini-badge { display: none; }

/* ── Hazard row ── */
.pha-haz-row {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  padding: 3px 10px 3px 36px; background: #fafbff;
  border-bottom: 1px solid #eef0f7; font-size: 10px;
}
.pha-haz-tree-indent { font-family: monospace; font-size: 10px; color: #bbb; white-space: pre; }
.pha-haz-icon  { font-size: 10px; color: #FF8B00; }
.pha-haz-code  { font-family: monospace; font-size: 9px; font-weight: 700; }
.pha-haz-desc  { flex: 1; min-width: 120px; color: #111; }
.pha-meta      { font-size: 9px; color: #666; white-space: nowrap; }
.pha-spacer    { flex: 0 !important; }

/* ── Mitigation row ── */
.pha-haz-mit-row {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  padding: 2px 10px 3px 50px; background: #fafbff;
  border-bottom: 1px solid #eef0f7; font-size: 9px;
}
.pha-haz-mit-indent { font-family: monospace; color: #bbb; white-space: pre; }
.pha-mit-label { font-weight: 700; color: #555; }
.pha-mit-text  { color: #444; }

/* ── Badges ── */
.pha-badge { padding: 1px 5px; border-radius: 8px; font-size: 9px; font-weight: 700; white-space: nowrap; }
.pha-status-chip { padding: 1px 5px; border-radius: 6px; font-size: 9px; font-weight: 600; white-space: nowrap; text-transform: capitalize; }
.pha-mono {
  font-family: monospace; font-size: 9px; color: #1A73E8;
  background: #e8f0fe; padding: 1px 4px; border-radius: 2px; font-weight: 700;
}
.pha-empty-row { padding: 6px 10px 6px 36px; font-size: 9px; color: #888; font-style: italic; }

/* ── Hide interactive elements ── */
.btn, button, .btn-icon, .btn-ghost, .fha-hazop-panel,
.pha-add-row-anchor, .pha-inline-row { display: none !important; }
</style>
</head>
<body>
${headerHtml}
<div style="font-size:9px;color:#888;text-align:right;margin-top:-10px;margin-bottom:8px">${date}</div>
<div class="pha-body">${bodyClone.outerHTML}</div>
<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

  _openPrintWin(html);
}


// ─────────────────────────────────────────────────────────────────────────────
// FTA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export FTA canvas to PDF.
 * Clones the live SVG content, computes a bounding-box viewBox, and prints.
 *
 * @param {SVGElement} svgEl   - the live #fta-svg element
 * @param {Array}      nodes   - current _nodes array (for bbox)
 * @param {string}     title   - document title (e.g. project + FC name)
 * @param {string}     fcLabel - active failure-condition label (shown as subtitle)
 */
export function exportFTApdf(svgEl, nodes, title, fcLabel) {
  if (!svgEl || !nodes.length) return;

  const PAD = 60;

  // ── Bounding box from node positions ─────────────────────────────────────
  const BOX_W = 188;
  const GATE_DIMS = { gate_and:[74,62], gate_or:[74,62], gate_not:[60,60], gate_inhibit:[74,58] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  nodes.forEach(n => {
    const isGate = n.type?.startsWith('gate');
    const [gw, gh] = GATE_DIMS[n.type] || [74, 62];
    const hw = isGate ? gw / 2 : BOX_W / 2;
    // Approximate full height (box + indicator + port + add-btn)
    const fullH = isGate ? gh / 2 + 55 : 80 + 60;
    const hTop  = isGate ? gh / 2 : 80;
    minX = Math.min(minX, n.x - hw);
    minY = Math.min(minY, n.y - hTop);
    maxX = Math.max(maxX, n.x + hw);
    maxY = Math.max(maxY, n.y + fullH);
  });

  const vx = minX - PAD, vy = minY - PAD;
  const vw = maxX - minX + PAD * 2;
  const vh = maxY - minY + PAD * 2;

  // ── Clone SVG content groups ─────────────────────────────────────────────
  const serial = new XMLSerializer();
  const connsG = svgEl.querySelector('#fta-conns');
  const nodesG = svgEl.querySelector('#fta-nodes-g');

  // Temporarily remove port dots and add-child buttons (they're invisible at scale anyway)
  // We clone deep, then remove opacity-0 helper elements from clone
  const nodesClone = nodesG ? nodesG.cloneNode(true) : null;
  if (nodesClone) {
    nodesClone.querySelectorAll('.fta-port, .fta-add-child').forEach(el => el.remove());
  }

  const connsHtml = connsG  ? serial.serializeToString(connsG)      : '';
  const nodesHtml = nodesClone ? serial.serializeToString(nodesClone) : '';

  // Determine orientation
  const orient = vw > vh * 1.1 ? 'landscape' : 'portrait';

  const date = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)} — FTA</title>
<style>
@page { size: A4 ${orient}; margin: 10mm 12mm 12mm; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #fff;
       font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.print-hdr {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-bottom: 8px; border-bottom: 2px solid #111; margin-bottom: 12px;
}
.print-title { font-size: 16px; font-weight: 700; margin: 0; }
.print-fc    { font-size: 11px; color: #444; margin: 3px 0 0; }
.print-meta  { font-size: 9px; color: #888; text-align: right; }
.svg-wrap    { width: 100%; }
svg          { width: 100%; height: auto; display: block; }
/* FTA node text styles used inline in SVG — no extra CSS needed */
</style>
</head>
<body>
<div class="print-hdr">
  <div>
    <p class="print-title">${esc(title)}</p>
    <p class="print-fc">Fault Tree Analysis${fcLabel ? ' — ' + esc(fcLabel) : ''}</p>
  </div>
  <div class="print-meta">FTA · ${date}</div>
</div>
<div class="svg-wrap">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}">
    <defs>
      <marker id="farr"  markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L9,3 Z" fill="#97A0AF"/>
      </marker>
      <marker id="farrh" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L9,3 Z" fill="#1A73E8"/>
      </marker>
    </defs>
    ${connsHtml}
    ${nodesHtml}
  </svg>
</div>
<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

  _openPrintWin(html);
}


// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

function _openPrintWin(html) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Por favor habilita los pop-ups del navegador para exportar PDF.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
