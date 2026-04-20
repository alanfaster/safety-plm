/**
 * wireBottomPanel — shared collapsed/expandable/resizable bottom panel.
 *
 * HTML structure expected:
 *   <div class="bp-bar bp-collapsed" id="...">
 *     <div class="bp-resize-handle"></div>
 *     <div class="bp-hdr">
 *       <span class="bp-title">Panel Title</span>
 *       <!-- optional extra controls here -->
 *       <span class="bp-toggle">▲</span>
 *     </div>
 *     <div class="bp-body">...content...</div>
 *   </div>
 *
 * @param {HTMLElement} barEl   - the .bp-bar element
 * @param {object}      opts
 * @param {string}      opts.key       - localStorage key for height persistence
 * @param {number}      opts.defaultH  - default expanded height in px (default 220)
 * @param {function}    opts.onExpand  - called the first time the panel is expanded
 */
export function wireBottomPanel(barEl, { key = null, defaultH = 220, onExpand = null } = {}) {
  if (!barEl || barEl.dataset.bpWired) return;
  barEl.dataset.bpWired = '1';

  const hdr = barEl.querySelector('.bp-hdr');
  const tog = barEl.querySelector('.bp-toggle');
  const rh  = barEl.querySelector('.bp-resize-handle');

  const savedH = key ? (parseInt(localStorage.getItem(key)) || defaultH) : defaultH;
  barEl.style.setProperty('--bp-h', savedH + 'px');

  let expandedOnce = false;

  function expand() {
    barEl.classList.remove('bp-collapsed');
    if (tog) tog.textContent = '▼';
    if (onExpand && !expandedOnce) { expandedOnce = true; onExpand(); }
  }

  function collapse() {
    barEl.classList.add('bp-collapsed');
    if (tog) tog.textContent = '▲';
  }

  if (hdr) {
    hdr.addEventListener('click', e => {
      if (e.target.closest('button, select, input, a')) return;
      barEl.classList.contains('bp-collapsed') ? expand() : collapse();
    });
  }

  if (rh) {
    rh.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const startY = e.clientY;
      const startH = barEl.offsetHeight;
      const onMove = ev => {
        const newH = Math.max(60, Math.min(window.innerHeight * 0.7, startH - (ev.clientY - startY)));
        barEl.style.setProperty('--bp-h', newH + 'px');
        if (barEl.classList.contains('bp-collapsed')) expand();
      };
      const onUp = () => {
        if (key) localStorage.setItem(key, parseInt(barEl.style.getPropertyValue('--bp-h')) || savedH);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Expose programmatic control
  barEl._bp = { expand, collapse };
}
