export function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

/** Show a persistent toast (stays until toastDismiss() or next toast() call). */
export function toastPersist(message, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = null;
}

/** Dismiss the persistent toast (or replace it with a regular one). */
export function toastDismiss() {
  const el = document.getElementById('toast');
  clearTimeout(el._timer);
  el.classList.add('hidden');
}
