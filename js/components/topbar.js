import { t, getLang, setLang } from '../i18n/index.js';
import { signOut } from '../auth.js';
import { navigate } from '../router.js';

export function initTopbar(user) {
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
      // Re-render the whole app on lang change
      window.dispatchEvent(new Event('hashchange'));
      document.querySelectorAll('[data-lang]').forEach(b =>
        b.classList.toggle('active', b.dataset.lang === getLang())
      );
    };
  });

  // Sidebar toggle
  document.getElementById('sidebar-toggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  };
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
