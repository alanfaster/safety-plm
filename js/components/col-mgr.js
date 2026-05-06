/**
 * Column Manager — persistent column visibility + order per table/subpage.
 *
 * Config stored in localStorage per table key.
 * Built-in columns are always listed; hidden ones are tracked.
 * Custom column *definitions* live in project_config (managed from Settings).
 * Here we only track visibility and order.
 *
 * `wireColMgr` adds:
 *   - × hide button on non-fixed columns (hover)
 *   - + edge button to restore hidden columns (from col index ≥ 2)
 *   - drag-to-reorder on non-fixed column headers
 */

const LS_PREFIX = 'alm_col_cfg_';

// ── Config persistence ────────────────────────────────────────────────────────

export function loadColConfig(key, builtins) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return builtins.map(c => ({ ...c }));
    const { cols } = JSON.parse(raw);
    const merged = [];
    for (const sc of (cols || [])) {
      const b = builtins.find(b => b.id === sc.id);
      if (b)          merged.push({ ...b, visible: sc.visible });
      else if (sc.custom) merged.push({ ...sc, visible: sc.visible !== false });
    }
    // Append builtins not yet in stored config (new columns added in code or settings)
    for (const b of builtins) {
      if (!merged.find(m => m.id === b.id)) merged.push({ ...b });
    }
    return merged;
  } catch { return builtins.map(c => ({ ...c })); }
}

export function saveColConfig(key, cols) {
  localStorage.setItem(LS_PREFIX + key, JSON.stringify({
    cols: cols.map(c => ({
      id: c.id, visible: c.visible,
      ...(c.custom ? { name: c.name, type: c.type || 'text', custom: true } : {}),
    })),
  }));
}

// ── Visibility ────────────────────────────────────────────────────────────────

export function applyColVisibility(tableEl, cols) {
  const hiddenIds = new Set(cols.filter(c => !c.visible).map(c => c.id));
  tableEl.querySelectorAll('[data-col]').forEach(el => {
    el.style.display = hiddenIds.has(el.dataset.col) ? 'none' : '';
  });
}

// ── Wire headers (hide × + insert + + drag reorder) ──────────────────────────

/**
 * Adds per-column controls to an already-rendered <thead> row.
 * - Non-fixed columns get a "×" hide button on hover.
 * - Non-fixed columns from index ≥ 2 get a "+" restore button on their right edge.
 * - Non-fixed columns support drag-to-reorder.
 *
 * @param {HTMLTableRowElement} theadRow  — the <tr> inside <thead>
 * @param {HTMLTableElement}    tableEl   — the <table> element
 * @param {string}              key       — localStorage key
 * @param {Array}               cols      — mutable cols array
 * @param {Function}            onUpdate  — called after config changes (cols) => void
 */
export function wireColMgr(theadRow, tableEl, key, cols, onUpdate) {
  let dragColId = null;

  // ── Per-header: hide btn + restore btn ───────────────────────────────────────
  const allThs = Array.from(theadRow.querySelectorAll('th[data-col]'));

  allThs.forEach((th, thIndex) => {
    const col = cols.find(c => c.id === th.dataset.col);
    if (!col || col.fixed) return;

    th.classList.add('col-managed');

    // × hide button — pointer-events blocked while dragging (set via CSS .col-th-dragging *)
    const hideBtn = document.createElement('button');
    hideBtn.className = 'col-hide-btn';
    hideBtn.draggable = false;           // never drag the button itself
    hideBtn.textContent = '×';
    hideBtn.title = 'Hide column';
    hideBtn.addEventListener('click', e => {
      e.stopPropagation();
      col.visible = false;
      saveColConfig(key, cols);
      applyColVisibility(tableEl, cols);
      onUpdate(cols);
    });
    th.appendChild(hideBtn);

    // + restore button — only from 3rd column onwards (thIndex ≥ 2)
    if (thIndex >= 2) {
      const addBtn = document.createElement('button');
      addBtn.className = 'col-add-edge-btn';
      addBtn.draggable = false;
      addBtn.textContent = '+';
      addBtn.title = 'Restore / show column';
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        openColPanel(addBtn, key, cols, col.id, tableEl, theadRow, onUpdate);
      });
      th.appendChild(addBtn);
    }

    // Mark non-fixed th as draggable
    th.draggable = true;
  });

  // ── Column drag-reorder via event delegation on theadRow ─────────────────────
  // This avoids per-th listeners competing with child buttons.

  function targetTh(e) {
    // Walk up from e.target to find a th[data-col] inside theadRow
    let el = e.target;
    while (el && el !== theadRow) {
      if (el.tagName === 'TH' && el.dataset.col) return el;
      el = el.parentElement;
    }
    return null;
  }

  function clearDropIndicators() {
    theadRow.querySelectorAll('th').forEach(t =>
      t.classList.remove('col-th-drop-left', 'col-th-drop-right'));
  }

  theadRow.addEventListener('dragstart', e => {
    const th = targetTh(e);
    if (!th) return;
    const col = cols.find(c => c.id === th.dataset.col);
    if (!col || col.fixed) { e.preventDefault(); return; }
    dragColId = col.id;
    th.classList.add('col-th-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.id);
  });

  theadRow.addEventListener('dragend', () => {
    theadRow.querySelectorAll('th').forEach(t =>
      t.classList.remove('col-th-dragging'));
    clearDropIndicators();
    dragColId = null;
  });

  theadRow.addEventListener('dragover', e => {
    if (!dragColId) return;
    const th = targetTh(e);
    if (!th || th.dataset.col === dragColId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();
    const rect = th.getBoundingClientRect();
    th.classList.add(e.clientX < rect.left + rect.width / 2
      ? 'col-th-drop-left' : 'col-th-drop-right');
  });

  theadRow.addEventListener('dragleave', e => {
    // Only clear if leaving the entire thead row
    if (!theadRow.contains(e.relatedTarget)) clearDropIndicators();
  });

  theadRow.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragColId) return;
    const th = targetTh(e);
    if (!th) { clearDropIndicators(); return; }
    const targetColId = th.dataset.col;
    if (!targetColId || targetColId === dragColId) { clearDropIndicators(); return; }

    clearDropIndicators();

    const fromIdx = cols.findIndex(c => c.id === dragColId);
    const toIdx   = cols.findIndex(c => c.id === targetColId);
    if (fromIdx < 0 || toIdx < 0) return;

    const rect   = th.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;

    // Splice out the moved column, then re-find target index (array shifted), then insert
    const [moved] = cols.splice(fromIdx, 1);
    const newToIdx = cols.findIndex(c => c.id === targetColId);
    cols.splice(before ? newToIdx : newToIdx + 1, 0, moved);

    saveColConfig(key, cols);
    onUpdate(cols);
  });
}

// ── Column panel (restore hidden only) ───────────────────────────────────────

function openColPanel(anchor, key, cols, afterColId, tableEl, theadRow, onUpdate) {
  // Close any existing panel
  document.querySelectorAll('.col-mgr-panel').forEach(p => p.remove());

  const hidden = cols.filter(c => !c.visible && !c.fixed);

  if (!hidden.length) {
    // Nothing to restore — show a brief message and auto-dismiss
    const panel = document.createElement('div');
    panel.className = 'col-mgr-panel';
    panel.innerHTML = `<div class="col-panel-empty">All columns are visible</div>`;
    document.body.appendChild(panel);
    positionPanel(panel, anchor);
    setTimeout(() => {
      document.addEventListener('click', () => panel.remove(), { once: true });
    }, 0);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'col-mgr-panel';
  panel.innerHTML = `
    <div class="col-panel-section">Show column</div>
    ${hidden.map(c => `
      <button class="col-panel-restore" data-col-id="${c.id}">＋ ${escPanel(c.name)}</button>
    `).join('')}
  `;
  document.body.appendChild(panel);
  positionPanel(panel, anchor);

  // Restore hidden
  panel.querySelectorAll('.col-panel-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = cols.find(c => c.id === btn.dataset.colId);
      if (col) {
        col.visible = true;
        saveColConfig(key, cols);
        applyColVisibility(tableEl, cols);
        onUpdate(cols);
      }
      panel.remove();
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', () => panel.remove(), { once: true });
  }, 0);
}

function positionPanel(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top  = (r.bottom + 4) + 'px';
  panel.style.left = r.left + 'px';
}

function escPanel(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Panel resize ──────────────────────────────────────────────────────────────

const LS_PANEL_W = 'alm_panel_w_';

/**
 * Makes a panel user-resizable by dragging its inner edge.
 * @param {HTMLElement} panelEl
 * @param {string}      key      — localStorage key suffix
 * @param {object}      opts     — { side='left'|'right', minWidth, maxWidth, defaultWidth, openClass }
 *   side='left'  → handle on left edge (right-side panel, drag left=wider)
 *   side='right' → handle on right edge (left-side panel, drag right=wider)
 */
export function wirePanelResize(panelEl, key, {
  side = 'left', minWidth = 160, maxWidth = 700, defaultWidth = 420,
  openClass = 'open', collapseClass = null, alwaysApply = false,
} = {}) {
  const stored = parseInt(localStorage.getItem(LS_PANEL_W + key));
  let currentW = (stored >= minWidth && stored <= maxWidth) ? stored : defaultWidth;

  const applyWidth = w => {
    currentW = w;
    panelEl.style.width    = w + 'px';
    panelEl.style.minWidth = w + 'px';
  };

  const clearWidth = () => {
    panelEl.style.width    = '';
    panelEl.style.minWidth = '';
  };

  if (collapseClass) {
    // Panel collapses by ADDING collapseClass (e.g. spec-nav--hidden)
    const mo = new MutationObserver(() => {
      if (panelEl.classList.contains(collapseClass)) clearWidth();
      else applyWidth(currentW);
    });
    mo.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    if (panelEl.classList.contains(collapseClass)) clearWidth();
    else applyWidth(currentW);
  } else if (alwaysApply) {
    applyWidth(currentW);
  } else {
    // Apply saved width on open, clear on close so CSS collapsed size takes over
    const mo = new MutationObserver(() => {
      if (panelEl.classList.contains(openClass)) applyWidth(currentW);
      else clearWidth();
    });
    mo.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    if (panelEl.classList.contains(openClass)) applyWidth(currentW);
    else clearWidth();
  }

  const handle = document.createElement('div');
  handle.className = `panel-resize-handle panel-resize-handle--${side}`;
  panelEl.appendChild(handle);

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelEl.offsetWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';

    const onMove = e => {
      const delta = e.clientX - startX;
      // left panel: drag right = wider (+delta); right panel: drag left = wider (-delta)
      const w = Math.max(minWidth, Math.min(maxWidth,
        side === 'right' ? startW + delta : startW - delta));
      applyWidth(w);
    };
    const onUp = () => {
      localStorage.setItem(LS_PANEL_W + key, currentW);
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Column resize (drag handle on right edge of each <th>) ───────────────────
// Rules:
//  • No persistence — columns always start at auto-fit (100% fill) on page load
//  • Manual resize only changes the dragged column; others stay put (push right)
//  • Table can exceed 100% → horizontal scroll; min column width = 8px

const MIN_COL_W = 8;

export function loadColWidths()  { return {}; } // no persistence by design
export function saveColWidths()  {}             // no-op

export function wireColResize(theadRow, { onResize } = {}) {
  const tableEl  = theadRow.closest('table');
  const container = tableEl?.parentElement;
  if (!tableEl) return;

  // Step 1: measure natural column widths with auto layout filling 100%
  tableEl.style.tableLayout = 'auto';
  tableEl.style.width       = '100%';
  tableEl.style.minWidth    = '';

  requestAnimationFrame(() => {
    // Step 2: read widths WHILE STILL in auto layout (before switching to fixed)
    const ths = Array.from(theadRow.querySelectorAll('th[data-col]'));
    const colWidths = ths.map(th => th.offsetWidth);
    const totalW = colWidths.reduce((s, w) => s + w, 0);

    // Step 3: switch to fixed and apply snapshotted px widths
    tableEl.style.tableLayout = 'fixed';
    tableEl.style.width       = totalW + 'px';
    tableEl.style.minWidth    = '';
    ths.forEach((th, i) => {
      th.style.width    = colWidths[i] + 'px';
      th.style.minWidth = '0';
    });

    onResize?.(container?.offsetWidth ?? totalW);

    // Step 3: wire resize handles
    ths.forEach((th, i) => {
      const colId = th.dataset.col;
      if (colId === 'drag' || colId === 'select') return;

      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const startX      = e.clientX;
        const startW      = th.offsetWidth;
        const startTableW = parseInt(tableEl.style.width) || tableEl.offsetWidth;
        document.body.style.userSelect = 'none';
        document.body.style.cursor     = 'col-resize';

        const onMove = e => {
          const newW  = Math.max(MIN_COL_W, startW + (e.clientX - startX));
          const delta = newW - startW;
          th.style.width      = newW + 'px';
          tableEl.style.width = (startTableW + delta) + 'px';
          onResize?.(container?.offsetWidth ?? (startTableW + delta));
        };
        const onUp = () => {
          document.body.style.userSelect = '';
          document.body.style.cursor     = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });
  });
}
