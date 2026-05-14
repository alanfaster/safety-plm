import { t } from '../i18n/index.js';

const overlay = () => document.getElementById('modal-overlay');
const modal   = () => document.getElementById('modal');

let _modalKeyHandler = null;

export function showModal({ title, body, footer, large = false, onClose } = {}) {
  const m = modal();
  m.classList.toggle('modal-lg', !!large);
  document.getElementById('modal-title').textContent = title || '';
  document.getElementById('modal-body').innerHTML = body || '';
  document.getElementById('modal-footer').innerHTML = footer || '';
  overlay().classList.remove('hidden');

  const close = document.getElementById('modal-close');
  close.onclick = () => hideModal(onClose);
  overlay().onclick = (e) => { if (e.target === overlay()) hideModal(onClose); };

  if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
  _modalKeyHandler = (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const danger = document.getElementById('modal-footer')?.querySelector('.btn-danger');
    if (!danger) return;
    e.preventDefault();
    danger.click();
  };
  document.addEventListener('keydown', _modalKeyHandler);
}

export function hideModal(callback) {
  overlay().classList.add('hidden');
  if (_modalKeyHandler) { document.removeEventListener('keydown', _modalKeyHandler); _modalKeyHandler = null; }
  if (typeof callback === 'function') callback();
}

/** Confirm dialog shortcut */
export function confirmDialog(message, onConfirm) {
  showModal({
    title: t('common.confirm_delete'),
    body: `<p style="color:var(--color-text)">${message}</p>`,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel">${t('common.cancel')}</button>
      <button class="btn btn-danger"    id="modal-confirm">${t('common.delete')}</button>
    `
  });
  document.getElementById('modal-cancel').onclick  = () => hideModal();
  document.getElementById('modal-confirm').onclick = () => { hideModal(); onConfirm(); };
}
