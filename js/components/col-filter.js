/**
 * col-filter.js — Excel-style column filter utility
 *
 * - Text columns  → text input (contains match)
 * - Enum columns  → checkbox multi-select dropdown (OR match)
 * - Both get an ✕ clear button
 * - ⊽ funnel icon in the <th> toggles the filter cell open/closed
 *
 * Public API:
 *   buildFilterRowHTML(cols, skipIds, colOptions) → <tr> HTML
 *   applyColFilters(data, filters, getValueFn)    → filtered array
 *   wireColFilterIcons(theadEl, filters, onChange, skipIds) → full wiring
 */

/**
 * Build the filter row HTML.
 * @param {Array}  cols        — [{ id, visible }]
 * @param {Set}    skipIds     — col ids with no filter (drag, actions)
 * @param {Object} colOptions  — { [colId]: string[] } — if present, renders a multi-select
 */
export function buildFilterRowHTML(cols, skipIds = new Set(), colOptions = {}) {
  const cells = cols
    .filter(c => c.visible)
    .map(c => {
      if (skipIds.has(c.id)) {
        return `<td class="col-filter-cell col-filter-cell--empty" data-col="${c.id}"></td>`;
      }
      const opts = colOptions[c.id];
      const inner = opts
        ? _buildMultiselHTML(c.id, opts)
        : `<input class="col-filter-inp" data-col="${c.id}" type="text" placeholder="Filter…" autocomplete="off" spellcheck="false" />`;
      return `<td class="col-filter-cell col-filter-cell--closed" data-col="${c.id}">
        <div class="col-filter-wrap">
          ${inner}
          <button class="col-filter-clear" data-col="${c.id}" title="Clear filter">✕</button>
        </div>
      </td>`;
    })
    .join('');
  return `<tr class="col-filter-row">${cells}</tr>`;
}

function _buildMultiselHTML(colId, opts) {
  // Options stored as JSON data attribute — the floating panel reads them at click time
  return `<div class="col-filter-multisel" data-col="${colId}" data-opts="${_esc(JSON.stringify(opts))}">
    <div class="col-filter-ms-display" title="Click to choose values">All</div>
  </div>`;
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Filter a data array.
 * filters[colId] is either:
 *   - string  → contains match (text input)
 *   - string[] → OR match (multi-select; empty array = no filter)
 */
export function applyColFilters(data, filters, getValueFn) {
  const active = Object.entries(filters).filter(([, v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v && v.trim();
  });
  if (!active.length) return data;
  return data.filter(item =>
    active.every(([colId, term]) => {
      const val = (getValueFn(item, colId) ?? '').toString().toLowerCase();
      if (Array.isArray(term)) {
        return term.some(t => val === t.toLowerCase());
      }
      return val.includes(term.toLowerCase().trim());
    })
  );
}

// One shared floating dropdown panel appended to body
let _floatingPanel = null;
let _floatingCleanup = null;

function _getOrCreatePanel() {
  if (!_floatingPanel) {
    _floatingPanel = document.createElement('div');
    _floatingPanel.className = 'col-filter-ms-panel';
    _floatingPanel.style.display = 'none';
    document.body.appendChild(_floatingPanel);
    // Close on outside click
    document.addEventListener('click', e => {
      if (_floatingPanel && !_floatingPanel.contains(e.target)) {
        _hidePanel();
      }
    });
  }
  return _floatingPanel;
}

function _hidePanel() {
  if (_floatingPanel) _floatingPanel.style.display = 'none';
  if (_floatingCleanup) { _floatingCleanup(); _floatingCleanup = null; }
}

function _showPanel(anchorEl, opts, currentValues, onCommit) {
  const panel = _getOrCreatePanel();
  _hidePanel(); // reset previous

  panel.innerHTML = opts.map(v =>
    `<label class="col-filter-opt">
      <input type="checkbox" value="${_esc(v)}"${currentValues.includes(v) ? ' checked' : ''}> ${_esc(v)}
    </label>`
  ).join('');

  // Position below anchor using fixed coords
  const rect = anchorEl.getBoundingClientRect();
  panel.style.display  = 'block';
  panel.style.position = 'fixed';
  panel.style.top      = (rect.bottom + 2) + 'px';
  panel.style.left     = rect.left + 'px';
  panel.style.minWidth = Math.max(rect.width, 140) + 'px';

  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checked = [...panel.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value);
      onCommit(checked);
    });
  });

  panel.addEventListener('click', e => e.stopPropagation());
  _floatingCleanup = null;
}

/**
 * Wire ⊽ funnel icons into each filterable <th> and connect to filter inputs/multiselects.
 *
 * @param {HTMLElement} theadEl   — the <thead> element
 * @param {Object}      filters   — shared filter state (mutated in place)
 * @param {Function}    onChange  — called after any change
 * @param {Set}         skipIds   — col ids with no filter
 */
export function wireColFilterIcons(theadEl, filters, onChange, skipIds = new Set()) {
  if (!theadEl) return;
  const filterRow = theadEl.querySelector('.col-filter-row');
  if (!filterRow) return;

  theadEl.querySelectorAll('th[data-col]').forEach(th => {
    const colId = th.dataset.col;
    if (skipIds.has(colId)) return;
    if (th.querySelector('.col-filter-btn')) return; // already wired

    const btn = document.createElement('button');
    btn.className   = 'col-filter-btn';
    btn.title       = 'Filter column';
    btn.innerHTML   = '⊽';
    btn.dataset.col = colId;
    th.appendChild(btn);

    const cell = filterRow.querySelector(`.col-filter-cell[data-col="${colId}"]`);
    if (!cell) return;

    // Restore open state if filter already active
    const isActive = _isFilterActive(filters[colId]);
    if (isActive) {
      _openCell(cell, btn);
      _restoreFilterUI(cell, colId, filters[colId]);
    }

    // Toggle open/close on funnel click
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (cell.classList.contains('col-filter-cell--closed')) {
        _openCell(cell, btn);
        setTimeout(() => cell.querySelector('.col-filter-inp, .col-filter-ms-display')?.focus(), 30);
      } else {
        _hidePanel();
        _closeAndClear(cell, btn, colId, filters, onChange);
      }
    });

    // Wire clear (✕) button
    const clearBtn = cell.querySelector('.col-filter-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        _hidePanel();
        _clearFilter(cell, colId, filters, onChange);
        btn.classList.remove('col-filter-btn--active');
        _closeCell(cell);
      });
    }

    // Wire text input
    const inp = cell.querySelector('.col-filter-inp');
    if (inp) {
      inp.addEventListener('input', () => {
        filters[colId] = inp.value;
        btn.classList.toggle('col-filter-btn--active', inp.value.length > 0);
        onChange(colId, inp.value);
      });
      inp.addEventListener('click',     e => e.stopPropagation());
      inp.addEventListener('mousedown', e => e.stopPropagation());
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          _clearFilter(cell, colId, filters, onChange);
          _closeCell(cell);
          btn.classList.remove('col-filter-btn--active');
          e.stopPropagation();
        }
      });
    }

    // Wire multi-select display button → floating panel
    const ms = cell.querySelector('.col-filter-multisel');
    if (ms) {
      const display = ms.querySelector('.col-filter-ms-display');
      const opts = JSON.parse(ms.dataset.opts || '[]');
      display?.addEventListener('click', e => {
        e.stopPropagation();
        const current = Array.isArray(filters[colId]) ? filters[colId] : [];
        _showPanel(display, opts, current, checked => {
          filters[colId] = checked;
          btn.classList.toggle('col-filter-btn--active', checked.length > 0);
          _updateMsDisplay(display, checked);
          onChange(colId, checked);
        });
      });
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _isFilterActive(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v && v.trim().length > 0;
}

function _openCell(cell, btn) {
  cell.classList.remove('col-filter-cell--closed');
  btn.classList.add('col-filter-btn--active');
}

function _closeCell(cell) {
  cell.classList.add('col-filter-cell--closed');
}

function _closeAndClear(cell, btn, colId, filters, onChange) {
  _clearFilter(cell, colId, filters, onChange);
  _closeCell(cell);
  btn.classList.remove('col-filter-btn--active');
}

function _clearFilter(cell, colId, filters, onChange) {
  const inp = cell.querySelector('.col-filter-inp');
  if (inp) inp.value = '';
  const checkboxes = cell.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => { cb.checked = false; });
  const display = cell.querySelector('.col-filter-ms-display');
  if (display) display.textContent = 'All';
  filters[colId] = Array.isArray(filters[colId]) ? [] : '';
  onChange(colId, filters[colId]);
}

function _restoreFilterUI(cell, colId, value) {
  if (Array.isArray(value) && value.length) {
    const display = cell.querySelector('.col-filter-ms-display');
    _updateMsDisplay(display, value);
  } else if (typeof value === 'string' && value) {
    const inp = cell.querySelector('.col-filter-inp');
    if (inp) inp.value = value;
  }
}

function _updateMsDisplay(displayEl, checked) {
  if (!displayEl) return;
  displayEl.textContent = checked.length === 0 ? 'All' : checked.join(', ');
  displayEl.title = checked.length === 0 ? 'Click to choose values' : checked.join(', ');
}
