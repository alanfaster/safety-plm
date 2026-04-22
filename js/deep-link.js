/**
 * Deep-link utilities.
 *
 * URL format:  {origin}{pathname}#/project/.../vcycle/requirements/page/X||anchor:ELEMENT_ID
 * The router strips "||anchor:..." before matching routes and stores the id in
 * window.__plmAnchor.  After a page finishes rendering it calls
 * scrollToAnchor() to highlight the element.
 */

import { toast } from './toast.js';

/** Build the full shareable URL for a specific element on the current page. */
export function elementLink(elementId) {
  const base = window.location.href.split('||')[0]; // strip any existing anchor
  return `${base}||anchor:${elementId}`;
}

/** Copy the element link to clipboard and show a toast. */
export function copyElementLink(elementId) {
  const url = elementLink(elementId);
  navigator.clipboard.writeText(url).then(() => {
    toast('Link copied to clipboard', 'success');
  }).catch(() => {
    // Fallback for older browsers / non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Link copied', 'success');
  });
}

/**
 * Called after a page renders.
 * Reads window.__plmAnchor, scrolls to the element with that id, and
 * flashes a highlight animation.  Clears the anchor afterwards.
 */
export function scrollToAnchor() {
  const id = window.__plmAnchor;
  if (!id) return;
  window.__plmAnchor = null;

  // Give the DOM one more tick to settle (tables build rows asynchronously)
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('plm-anchor-flash');
    setTimeout(() => el.classList.remove('plm-anchor-flash'), 2200);
  });
}
