import en from './en.js';
import es from './es.js';

const LANGS = { en, es };
let current = localStorage.getItem('alm_lang') || 'en';

/** Translate a key. Supports {{placeholder}} interpolation. */
export function t(key, vars = {}) {
  const dict = LANGS[current] || LANGS.en;
  let str = dict[key] ?? LANGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replace(new RegExp(`{{${k}}}`, 'g'), v);
  }
  return str;
}

export function getLang() { return current; }

export function setLang(lang) {
  if (!LANGS[lang]) return;
  current = lang;
  localStorage.setItem('alm_lang', lang);
  document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

export function availableLangs() { return Object.keys(LANGS); }
