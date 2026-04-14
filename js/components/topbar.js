import { t, getLang, setLang } from '../i18n/index.js';
import { signOut } from '../auth.js';
import { navigate } from '../router.js';
import { VERSION } from '../version.js';

export function initTopbar(user) {
  // Version
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = VERSION;

  // User info
  const email = user?.email || '';
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = email.charAt(0).toUpperCase();

  // Logout
  document.getElementById('btn-logout').textContent = t('auth.signout');
  document.getElementById('btn-logout').onclick = signOut;

  // Language switcher
  document.querySelectorAll('[data-lang]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === getLang());
    btn.onclick = () => {
      setLang(btn.dataset.lang);
      window.dispatchEvent(new Event('hashchange'));
      document.querySelectorAll('[data-lang]').forEach(b =>
        b.classList.toggle('active', b.dataset.lang === getLang())
      );
    };
  });

  // Sidebar toggle (☰ button)
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle').onclick = () => toggleSidebar(sidebar);

  // Restore saved sidebar width
  const savedWidth = localStorage.getItem('alm_sidebar_width');
  if (savedWidth) {
    sidebar.style.width = savedWidth;
    document.documentElement.style.setProperty('--sidebar-width', savedWidth);
  }

  // Sidebar resize handle
  const handle = document.getElementById('sidebar-handle');
  if (handle) {
    let isResizing = false;
    let didDrag    = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
      startX  = e.clientX;
      didDrag = false;
      if (!sidebar.classList.contains('collapsed')) {
        isResizing  = true;
        startWidth  = sidebar.getBoundingClientRect().width;
        document.body.style.cursor     = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      if (Math.abs(e.clientX - startX) > 3) didDrag = true;
      const newWidth = Math.max(160, Math.min(500, startWidth + (e.clientX - startX)));
      sidebar.style.width = newWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', (e) => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor     = '';
        document.body.style.userSelect = '';
        if (sidebar.style.width) localStorage.setItem('alm_sidebar_width', sidebar.style.width);
      }
      // Click (not drag) = toggle sidebar
      if (!didDrag && e.target === handle) toggleSidebar(sidebar);
    });
  }
}

function toggleSidebar(sidebar) {
  const isCollapsed = sidebar.classList.toggle('collapsed');
  if (!isCollapsed) {
    // Restore saved width when expanding
    const savedWidth = localStorage.getItem('alm_sidebar_width');
    if (savedWidth) sidebar.style.width = savedWidth;
  }
}

/**
 * Update breadcrumb trail.
 * @param {Array<{label:string, path?:string}>} crumbs
 */
export function setBreadcrumb(crumbs) {
  const el = document.getElementById('breadcrumb');
  el.innerHTML = crumbs.map((c, i) => {
    const isLast = i === crumbs.length - 1;
    return [
      i > 0 ? '<span class="breadcrumb-sep">›</span>' : '',
      isLast
        ? `<span class="breadcrumb-item current">${c.label}</span>`
        : `<button class="breadcrumb-item" data-path="${c.path || ''}">${c.label}</button>`
    ].join('');
  }).join('');

  el.querySelectorAll('[data-path]').forEach(btn => {
    btn.onclick = () => navigate(btn.dataset.path);
  });
}
