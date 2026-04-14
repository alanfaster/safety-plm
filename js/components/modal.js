import { t } from '../i18n/index.js';

const overlay = () => document.getElementById('modal-overlay');
const modal   = () => document.getElementById('modal');

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
}

export function hideModal(callback) {
  overlay().classList.add('hidden');
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
