import { t, getLang, setLang } from '../i18n/index.js';
import { signOut } from '../auth.js';
import { navigate } from '../router.js';
import { VERSION } from '../version.js';
import { sb } from '../config.js';
import { showModal, hideModal } from './modal.js';

export function initTopbar(user) {
  // Version
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = VERSION;

  // User info
  const email = user?.email || '';
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = email.charAt(0).toUpperCase();

  // Gear / project settings button
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.onclick = () => {
      const m = window.location.hash.match(/\/project\/([^/]+)/);
      if (m) {
        sessionStorage.setItem('settings_return_hash', window.location.hash);
        navigate(`/project/${m[1]}/settings`);
      }
    };
  }

  // Change password on user-info click
  document.getElementById('user-info').onclick = () => {
    showModal({
      title: 'Change Password',
      body: `
        <div class="form-group">
          <label class="form-label">New password</label>
          <input type="password" class="form-input" id="cp-new" placeholder="Min. 6 characters" autocomplete="new-password"/>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm new password</label>
          <input type="password" class="form-input" id="cp-confirm" placeholder="Repeat password" autocomplete="new-password"/>
        </div>
        <p id="cp-error" style="color:var(--color-error);font-size:13px;margin-top:4px;min-height:18px"></p>`,
      footer: `
        <button class="btn btn-secondary" id="cp-cancel">Cancel</button>
        <button class="btn btn-primary" id="cp-save">Save</button>`,
    });
    document.getElementById('cp-cancel').onclick = () => hideModal();
    document.getElementById('cp-save').onclick = async () => {
      const pw  = document.getElementById('cp-new').value;
      const pw2 = document.getElementById('cp-confirm').value;
      const err = document.getElementById('cp-error');
      err.textContent = '';
      if (pw.length < 6)    { err.textContent = 'Password must be at least 6 characters.'; return; }
      if (pw !== pw2)       { err.textContent = 'Passwords do not match.'; return; }
      const btn = document.getElementById('cp-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = 'Save'; }
      else { hideModal(); }
    };
    setTimeout(() => document.getElementById('cp-new')?.focus(), 100);
  };

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
      // Allow resizing from rail (collapsed) too — it will expand automatically
      isResizing  = true;
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        startWidth = 44;
      } else {
        startWidth = sidebar.getBoundingClientRect().width;
      }
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
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
    else sidebar.style.width = '';
  } else {
    // Rail mode: clear any custom width so CSS 44px takes effect
    sidebar.style.width = '';
  }
}

/**
 * Set contextual action buttons in the topbar (beside breadcrumb).
 * Call with HTML string; cleared automatically on each route change via clearPageActions().
 */
export function setPageActions(html) {
  const el = document.getElementById('page-actions');
  if (el) el.innerHTML = html;
}

export function clearPageActions() {
  const el = document.getElementById('page-actions');
  if (el) el.innerHTML = '';
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
