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
