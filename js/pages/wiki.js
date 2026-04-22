/**
 * Wiki Page — Etherpad-inspired editor.
 *
 * Layout (all inside #content which is the scrolling container):
 *   ┌── wiki-topbar (sticky, full-width toolbar) ──────────────────┐
 *   ├── wiki-layout (flex row, fills remaining height) ────────────┤
 *   │   ├── wiki-toc  (left panel, collapsible)                    │
 *   │   └── wiki-scroll (flex:1, overflow-y:auto)                  │
 *   │         └── wiki-paper (centred doc, max-width 860px)        │
 *   │               └── wiki-editor (contenteditable)              │
 *   └────────────────────────────────────────────────────────────── ┘
 *   └── wiki-statusbar (bottom, word/char count + save status)
 *
 * Features:
 *  - Auto-numbered headings H1–H6
 *  - Figure & Table auto-numbering
 *  - Image insertion (URL or file upload)
 *  - Table insertion
 *  - Collapsible TOC with heading tree
 */
import { sb } from '../config.js';
import { setBreadcrumb } from '../components/topbar.js';
import { navigate } from '../router.js';

export async function renderWiki(container, { project, item, system, pageId }) {
  const { data: pg, error } = await sb.from('nav_pages')
    .select('name, wiki_content')
    .eq('id', pageId)
    .maybeSingle();

  if (error || !pg) {
    container.innerHTML = `<div class="empty-state"><p class="text-muted">Page not found.</p></div>`;
    return;
  }

  container.classList.add('wiki-container');

  const parentName = system?.name || item?.name || '';
  setBreadcrumb([
    { label: project.name, path: `/project/${project.id}` },
    ...(item   ? [{ label: item.name }]   : []),
    ...(system ? [{ label: system.name }] : []),
    { label: pg.name },
  ]);

  container.innerHTML = `
    <!-- ── Sticky toolbar ─────────────────────────────────────── -->
    <div class="wiki-topbar" id="wiki-topbar">
      <div class="wiki-topbar-left">
        <span class="wiki-doc-title" id="wiki-doc-title">${escHtml(pg.name)}</span>
        <span class="wiki-save-status" id="wiki-save-status"></span>
      </div>
      <div class="wiki-tb-groups">
        <!-- History -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn" data-cmd="undo"  title="Undo (Ctrl+Z)">↩</button>
          <button class="wiki-tb-btn" data-cmd="redo"  title="Redo (Ctrl+Y)">↪</button>
        </div>
        <span class="wiki-tb-sep"></span>
        <!-- Text style -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn wiki-tb-icon" data-cmd="bold"          title="Bold (Ctrl+B)"><b>B</b></button>
          <button class="wiki-tb-btn wiki-tb-icon" data-cmd="italic"        title="Italic (Ctrl+I)"><i>I</i></button>
          <button class="wiki-tb-btn wiki-tb-icon" data-cmd="underline"     title="Underline (Ctrl+U)"><u>U</u></button>
          <button class="wiki-tb-btn wiki-tb-icon" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        </div>
        <span class="wiki-tb-sep"></span>
        <!-- Headings -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn" data-heading="h1" title="Heading 1">H1</button>
          <button class="wiki-tb-btn" data-heading="h2" title="Heading 2">H2</button>
          <button class="wiki-tb-btn" data-heading="h3" title="Heading 3">H3</button>
          <button class="wiki-tb-btn" data-heading="h4" title="Heading 4">H4</button>
          <button class="wiki-tb-btn" data-heading="h5" title="Heading 5">H5</button>
          <button class="wiki-tb-btn" data-heading="h6" title="Heading 6">H6</button>
          <button class="wiki-tb-btn" data-cmd="formatBlock" data-val="p" title="Normal text">¶</button>
        </div>
        <span class="wiki-tb-sep"></span>
        <!-- Lists & indent -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn" data-cmd="insertUnorderedList" title="Bullet list">☰</button>
          <button class="wiki-tb-btn" data-cmd="insertOrderedList"   title="Numbered list">1.</button>
          <button class="wiki-tb-btn" data-cmd="indent"              title="Indent">⇥</button>
          <button class="wiki-tb-btn" data-cmd="outdent"             title="Outdent">⇤</button>
        </div>
        <span class="wiki-tb-sep"></span>
        <!-- Align -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn" data-cmd="justifyLeft"   title="Align left">⬜</button>
          <button class="wiki-tb-btn" data-cmd="justifyCenter" title="Center">⬛</button>
          <button class="wiki-tb-btn" data-cmd="justifyRight"  title="Align right">▪</button>
        </div>
        <span class="wiki-tb-sep"></span>
        <!-- Insert -->
        <div class="wiki-tb-group">
          <button class="wiki-tb-btn" id="wiki-btn-img"              title="Insert image">🖼</button>
          <button class="wiki-tb-btn" id="wiki-btn-table"            title="Insert table">⊞</button>
          <button class="wiki-tb-btn" data-cmd="insertHorizontalRule" title="Horizontal rule">—</button>
        </div>
      </div>
      <div class="wiki-topbar-right">
        <button class="wiki-toc-toggle-btn" id="wiki-toc-btn" title="Toggle contents">☰ Contents</button>
      </div>
    </div>

    <!-- ── Body: TOC + paper ──────────────────────────────────── -->
    <div class="wiki-layout" id="wiki-layout">
      <!-- TOC panel -->
      <nav class="wiki-toc" id="wiki-toc">
        <div class="wiki-toc-header">
          <span class="wiki-toc-title">Contents</span>
        </div>
        <div class="wiki-toc-tree" id="wiki-toc-tree"></div>
      </nav>

      <!-- Scrollable document area -->
      <div class="wiki-scroll" id="wiki-scroll">
        <div class="wiki-paper">
          <h1 class="wiki-page-title" contenteditable="true" spellcheck="true"
            id="wiki-page-title"
            data-placeholder="Page title…">${escHtml(pg.name)}</h1>
          <div class="wiki-editor" contenteditable="true" spellcheck="true"
            id="wiki-body">${pg.wiki_content || '<p>Start writing…</p>'}</div>
        </div>
      </div>
    </div>

    <!-- ── Status bar ─────────────────────────────────────────── -->
    <div class="wiki-statusbar">
      <span id="wiki-wordcount">0 words</span>
      <span class="wiki-sb-sep">·</span>
      <span id="wiki-charcount">0 chars</span>
    </div>

    <input type="file" id="wiki-file-input" accept="image/*" style="display:none">
  `;

  const editor    = container.querySelector('#wiki-body');
  const titleEl   = container.querySelector('#wiki-page-title');
  const statusEl  = container.querySelector('#wiki-save-status');
  const tocEl     = container.querySelector('#wiki-toc');
  const tocTree   = container.querySelector('#wiki-toc-tree');
  const fileInput = container.querySelector('#wiki-file-input');
  const wordCount = container.querySelector('#wiki-wordcount');
  const charCount = container.querySelector('#wiki-charcount');

  // ── Guard flag: DOM mutations during recalc must not re-trigger save ──────
  let isRecalc = false;

  // ── Toolbar buttons ───────────────────────────────────────────────────────
  container.querySelectorAll('.wiki-tb-btn[data-cmd], .wiki-tb-btn[data-heading]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (btn.dataset.heading) {
        document.execCommand('formatBlock', false, btn.dataset.heading);
      } else {
        document.execCommand(btn.dataset.cmd, false, btn.dataset.val || null);
      }
      recalcIndex();
      updateCounts();
    });
  });

  // ── Heading auto-numbering + Figure/Table indexing ────────────────────────
  function recalcIndex() {
    isRecalc = true;

    // 1. Heading numbers H1–H6
    const counters = [0, 0, 0, 0, 0, 0];
    editor.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      const lvl = parseInt(h.tagName[1]) - 1;
      counters[lvl]++;
      for (let i = lvl + 1; i < 6; i++) counters[i] = 0;
      const numStr = counters.slice(0, lvl + 1).join('.');
      if (!h.id) h.id = `wh-${Math.random().toString(36).slice(2)}`;
      const old = h.querySelector('.hnum');
      if (old) old.remove();
      const span = document.createElement('span');
      span.className = 'hnum';
      span.contentEditable = 'false';
      span.textContent = numStr + '\u00A0';
      h.insertBefore(span, h.firstChild);
    });

    // 2. Figure numbers
    let figIdx = 0;
    editor.querySelectorAll('figure.wiki-figure').forEach(fig => {
      ++figIdx;
      const ns = fig.querySelector('.fig-num');
      if (ns) ns.textContent = `Figure ${figIdx}:`;
    });

    // 3. Table numbers
    let tblIdx = 0;
    editor.querySelectorAll('figure.wiki-table-wrap').forEach(fig => {
      ++tblIdx;
      const ns = fig.querySelector('.tbl-num');
      if (ns) ns.textContent = `Table ${tblIdx}:`;
    });

    isRecalc = false;
    rebuildToc();
  }

  // ── Word / char count ─────────────────────────────────────────────────────
  function updateCounts() {
    const text  = editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.replace(/\n/g, '').length;
    wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    charCount.textContent = `${chars} char${chars !== 1 ? 's' : ''}`;
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────
  let saveTimer = null;

  function schedSave() {
    clearTimeout(saveTimer);
    statusEl.textContent = 'Unsaved…';
    saveTimer = setTimeout(saveContent, 1400);
  }

  async function saveContent() {
    const { error } = await sb.from('nav_pages')
      .update({ wiki_content: editor.innerHTML })
      .eq('id', pageId);
    statusEl.textContent = error ? '⚠ Save failed' : '✓ Saved';
    if (!error) setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  editor.addEventListener('input', () => {
    if (isRecalc) return;
    schedSave();
    recalcIndex();
    updateCounts();
  });

  editor.addEventListener('paste', e => {
    e.preventDefault();

    // ── Check for internal deep-link URL (plain text paste of a copied element link)
    const plainText = e.clipboardData.getData('text/plain').trim();
    const deepLinkMatch = extractDeepLink(plainText);
    if (deepLinkMatch) {
      // Save cursor position, show choice popup while fetching element in background
      const savedRange = window.getSelection()?.getRangeAt(0)?.cloneRange() || null;
      showPasteModePopup(e, plainText, deepLinkMatch, savedRange);
      return;
    }

    const html = e.clipboardData.getData('text/html');
    if (html) {
      // Check if the HTML is just a single anchor wrapping a deep-link URL
      const tmp0 = document.createElement('div');
      tmp0.innerHTML = html;
      const singleA = tmp0.querySelector('a');
      if (singleA) {
        const href = singleA.getAttribute('href') || '';
        const dlm = extractDeepLink(href) || extractDeepLink(singleA.textContent.trim());
        if (dlm) {
          const savedRange = window.getSelection()?.getRangeAt(0)?.cloneRange() || null;
          showPasteModePopup(e, href || singleA.textContent.trim(), dlm, savedRange);
          return;
        }
      }

      // Parse into a temporary container so we can sanitize
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('script, style, meta, link, head, iframe, object, embed').forEach(el => el.remove());
      const KEEP_ATTRS = new Set([
        'href','src','alt','title','colspan','rowspan','span',
        'width','height','align','valign','border','cellpadding','cellspacing',
        'start','type','reversed',
      ]);
      tmp.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
          if (!KEEP_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
        }
        if ((el.tagName === 'FONT' || el.tagName === 'SPAN') && el.attributes.length === 0) {
          el.replaceWith(...el.childNodes);
        }
      });
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = range.createContextualFragment(tmp.innerHTML);
        range.insertNode(frag);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        document.execCommand('insertHTML', false, tmp.innerHTML);
      }
    } else {
      document.execCommand('insertText', false, plainText);
    }
    schedSave();
    recalcIndex();
    updateCounts();
  });

  // ── Deep-link detection ───────────────────────────────────────────────────
  function extractDeepLink(text) {
    const m = (text || '').match(/\|\|anchor:(req|fha)-([0-9a-f-]+)$/i);
    return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
  }

  // ── Paste-mode popup (Jira-style) ─────────────────────────────────────────
  function showPasteModePopup(pasteEvent, fullUrl, { type, id }, savedRange) {
    // Remove any existing popup
    document.querySelector('.plm-paste-popup')?.remove();

    // Position near cursor
    const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect?.()
               || { bottom: 100, left: 100 };

    const popup = document.createElement('div');
    popup.className = 'plm-paste-popup';
    popup.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${Math.max(8, rect.left)}px;z-index:9999`;
    popup.innerHTML = `
      <div class="plm-pp-title">Paste as…</div>
      <button class="plm-pp-btn" data-mode="card" autofocus>
        <span class="plm-pp-btn-icon">🔗</span>
        <span>
          <strong>Link only</strong>
          <span class="plm-pp-hint">Inline badge with title</span>
        </span>
      </button>
      <button class="plm-pp-btn" data-mode="detail">
        <span class="plm-pp-btn-icon">📄</span>
        <span>
          <strong>Link + details</strong>
          <span class="plm-pp-hint">Badge + full element block</span>
        </span>
      </button>`;
    document.body.appendChild(popup);

    // Fetch element data in parallel while the popup is visible
    const dataPromise = fetchElementData(type, id);

    const dismiss = () => popup.remove();

    popup.querySelectorAll('.plm-pp-btn').forEach(btn => {
      btn.onclick = async () => {
        dismiss();
        const elData = await dataPromise;
        // Restore cursor
        if (savedRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
        }
        if (btn.dataset.mode === 'card') {
          insertCard(fullUrl, elData);
        } else {
          insertCardWithDetails(fullUrl, elData, type);
        }
        schedSave(); recalcIndex(); updateCounts();
      };
    });

    // Dismiss on outside click or Escape
    setTimeout(() => {
      const outside = ev => { if (!popup.contains(ev.target)) { dismiss(); document.removeEventListener('mousedown', outside); } };
      document.addEventListener('mousedown', outside);
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { dismiss(); } }, { once: true });
    }, 0);
  }

  // ── Fetch element data from DB ────────────────────────────────────────────
  async function fetchElementData(type, id) {
    try {
      if (type === 'req') {
        const { data } = await sb.from('requirements')
          .select('req_code,title,description,type,status,priority,asil,dal,verification_type')
          .eq('id', id).maybeSingle();
        return data ? { ...data, _icon: '📋', _type: 'req' } : null;
      } else if (type === 'fha') {
        const { data } = await sb.from('hazards')
          .select('haz_code,data,status')
          .eq('id', id).maybeSingle();
        return data ? { haz_code: data.haz_code, ...data.data, status: data.status, _icon: '⚠️', _type: 'fha' } : null;
      }
    } catch (_) {}
    return null;
  }

  // ── Build & insert link card ──────────────────────────────────────────────
  function insertCard(fullUrl, elData) {
    const { internalHref, label, icon } = cardParts(fullUrl, elData);
    const html = `<span class="plm-link-card" contenteditable="false"
      ><span class="plm-link-card-icon">${icon}</span
      ><a class="plm-link-card-label" href="${escHtml(internalHref)}">${escHtml(label)}</a
      ><a class="plm-link-card-ext" href="${escHtml(fullUrl)}" target="_blank" title="Open in new tab">↗</a
    ></span>`;
    document.execCommand('insertHTML', false, html);
  }

  // ── Build & insert card + detail block ───────────────────────────────────
  function insertCardWithDetails(fullUrl, elData, type) {
    const { internalHref, label, icon } = cardParts(fullUrl, elData);
    const cardHtml = `<span class="plm-link-card" contenteditable="false"
      ><span class="plm-link-card-icon">${icon}</span
      ><a class="plm-link-card-label" href="${escHtml(internalHref)}">${escHtml(label)}</a
      ><a class="plm-link-card-ext" href="${escHtml(fullUrl)}" target="_blank" title="Open in new tab">↗</a
    ></span>`;

    let detailRows = '';
    if (elData) {
      if (type === 'req') {
        const fields = [
          ['Type',         elData.type],
          ['Status',       elData.status],
          ['Priority',     elData.priority],
          ['ASIL',         elData.asil],
          ['DAL',          elData.dal],
          ['Verification', elData.verification_type],
        ].filter(([, v]) => v);
        detailRows = fields.map(([k, v]) =>
          `<tr><td class="plm-detail-key">${escHtml(k)}</td><td class="plm-detail-val">${escHtml(v)}</td></tr>`
        ).join('');
        if (elData.description) {
          detailRows += `<tr><td class="plm-detail-key">Description</td><td class="plm-detail-val">${escHtml(elData.description)}</td></tr>`;
        }
      } else if (type === 'fha') {
        const skip = new Set(['_icon','_type']);
        detailRows = Object.entries(elData)
          .filter(([k, v]) => !skip.has(k) && k !== 'haz_code' && v)
          .map(([k, v]) => `<tr><td class="plm-detail-key">${escHtml(k)}</td><td class="plm-detail-val">${escHtml(String(v))}</td></tr>`)
          .join('');
      }
    }

    const blockHtml = `<div class="plm-detail-block">
      <div class="plm-detail-header">${cardHtml}</div>
      ${detailRows ? `<table class="plm-detail-table"><tbody>${detailRows}</tbody></table>` : ''}
    </div>`;
    document.execCommand('insertHTML', false, blockHtml);
  }

  function cardParts(fullUrl, elData) {
    const icon  = elData?._icon || '📋';
    const code  = elData?.req_code || elData?.haz_code || '';
    const title = elData?.title || elData?.description || elData?.hazard || '';
    const label = code ? (title ? `${code} — ${title}` : code) : (title || 'Element');
    const hashIdx = fullUrl.indexOf('#/');
    const internalHref = hashIdx >= 0 ? fullUrl.slice(hashIdx) : fullUrl;
    return { internalHref, label, icon };
  }

  // ── Internal link navigation ──────────────────────────────────────────────
  // When clicking a link inside the wiki editor (or its rendered view) that
  // points to an internal app URL (contains #/ or the same origin), intercept
  // and use the SPA router instead of letting the browser do a full reload.
  editor.addEventListener('click', e => {
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;

    // Internal app link: href starts with #/ or is an absolute URL to this origin
    let internalPath = null;
    if (href.startsWith('#/')) {
      internalPath = href.slice(1); // strip leading #
    } else {
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin && url.hash.startsWith('#/')) {
          internalPath = url.hash.slice(1);
        }
      } catch (_) { /* not a valid URL — ignore */ }
    }

    if (internalPath) {
      e.preventDefault();
      navigate(internalPath);
    }
  });

  // Highlight active toolbar buttons on selection change
  document.addEventListener('selectionchange', updateActiveButtons);
  function updateActiveButtons() {
    if (!editor.contains(window.getSelection()?.anchorNode)) return;
    ['bold','italic','underline','strikeThrough'].forEach(cmd => {
      const btn = container.querySelector(`.wiki-tb-btn[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('wiki-tb-active', document.queryCommandState(cmd));
    });
  }

  // ── Title rename ──────────────────────────────────────────────────────────
  titleEl.addEventListener('input', () => {
    container.querySelector('#wiki-doc-title').textContent = titleEl.textContent.trim() || 'Untitled';
  });
  titleEl.addEventListener('blur', async () => {
    const newName = titleEl.textContent.trim();
    if (!newName || newName === pg.name) return;
    pg.name = newName;
    await sb.from('nav_pages').update({ name: newName }).eq('id', pageId);
    const label = document.querySelector(`.sb-subpage-row[data-subpage-id="${pageId}"] .sb-item-label`);
    if (label) label.textContent = newName;
  });
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); editor.focus(); }
  });

  // ── TOC toggle ────────────────────────────────────────────────────────────
  let tocVisible = true;
  container.querySelector('#wiki-toc-btn').addEventListener('click', () => {
    tocVisible = !tocVisible;
    tocEl.style.display = tocVisible ? '' : 'none';
    container.querySelector('#wiki-toc-btn').classList.toggle('wiki-tb-active', tocVisible);
  });

  // ── TOC build ─────────────────────────────────────────────────────────────
  const tocCollapsed = new Set();

  function headingText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.hnum').forEach(s => s.remove());
    return clone.textContent.trim();
  }

  function rebuildToc() {
    const headings = Array.from(editor.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    if (!headings.length) {
      tocTree.innerHTML = '<span class="wiki-toc-empty">No headings yet</span>';
      return;
    }
    const roots = [], stack = [];
    for (const el of headings) {
      const level = parseInt(el.tagName[1]);
      if (!el.id) el.id = `wh-${Math.random().toString(36).slice(2)}`;
      const numSpan = el.querySelector('.hnum');
      const node = { level, id: el.id,
        numText: numSpan ? numSpan.textContent.trim() : '',
        text: headingText(el), children: [] };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    }
    tocTree.innerHTML = renderTocNodes(roots, 0);
    wireTocNodes();
  }

  function renderTocNodes(nodes, depth) {
    return nodes.map(node => {
      const hasKids   = node.children.length > 0;
      const collapsed = tocCollapsed.has(node.id);
      const label = node.numText
        ? `<span class="toc-num">${escHtml(node.numText)}</span>${escHtml(node.text || '(untitled)')}`
        : escHtml(node.text || '(untitled)');
      return `<div class="wiki-toc-node" data-id="${node.id}">
        <div class="wiki-toc-row" style="padding-left:${depth * 12 + 10}px">
          ${hasKids
            ? `<button class="wiki-toc-chevron${collapsed ? ' toc-collapsed' : ''}" data-node-id="${node.id}">▾</button>`
            : `<span class="wiki-toc-dot"></span>`}
          <a class="wiki-toc-link wiki-toc-h${node.level}" data-target="${node.id}">${label}</a>
        </div>
        ${hasKids && !collapsed
          ? `<div class="wiki-toc-children">${renderTocNodes(node.children, depth + 1)}</div>`
          : ''}
      </div>`;
    }).join('');
  }

  function wireTocNodes() {
    tocTree.querySelectorAll('.wiki-toc-link').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        editor.querySelector(`#${a.dataset.target}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    tocTree.querySelectorAll('.wiki-toc-chevron').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.nodeId;
        tocCollapsed.has(id) ? tocCollapsed.delete(id) : tocCollapsed.add(id);
        rebuildToc();
      });
    });
  }

  // ── Image insertion ───────────────────────────────────────────────────────
  let savedRange = null;
  function saveSelection() {
    const sel = window.getSelection();
    if (sel?.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  container.querySelector('#wiki-btn-img').addEventListener('mousedown', e => {
    e.preventDefault(); saveSelection(); openImgDialog();
  });

  function openImgDialog() {
    closeAllPopups();
    const panel = makePanel(`
      <div class="wiki-ins-title">Insert Image</div>
      <div class="wiki-ins-tabs">
        <button class="wiki-ins-tab active" data-tab="url">URL</button>
        <button class="wiki-ins-tab" data-tab="file">Upload</button>
      </div>
      <div class="wiki-ins-body">
        <div data-panel="url">
          <input class="form-input" id="wimg-url" placeholder="https://…" style="margin-bottom:6px"/>
        </div>
        <div data-panel="file" style="display:none">
          <button class="btn btn-secondary btn-sm" id="wimg-file-btn">Choose file…</button>
          <span id="wimg-file-name" style="font-size:12px;color:#888;margin-left:8px"></span>
        </div>
        <input class="form-input" id="wimg-alt" placeholder="Caption / alt text" style="margin-top:6px"/>
      </div>
      <div class="wiki-ins-footer">
        <button class="btn btn-secondary btn-sm" id="wimg-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm"   id="wimg-insert">Insert</button>
      </div>`);
    positionPopup(panel, container.querySelector('#wiki-btn-img'));
    document.body.appendChild(panel);

    let pendingDataUrl = null;
    panel.querySelectorAll('.wiki-ins-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.wiki-ins-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        panel.querySelectorAll('[data-panel]').forEach(p => {
          p.style.display = p.dataset.panel === tab.dataset.tab ? '' : 'none';
        });
      });
    });
    panel.querySelector('#wimg-file-btn').addEventListener('click', () => fileInput.click());
    fileInput.onchange = () => {
      const file = fileInput.files[0]; if (!file) return;
      new FileReader().onload = ev => {
        pendingDataUrl = ev.target.result;
        panel.querySelector('#wimg-file-name').textContent = file.name;
      };
      const fr = new FileReader(); fr.onload = ev => { pendingDataUrl = ev.target.result; panel.querySelector('#wimg-file-name').textContent = file.name; }; fr.readAsDataURL(file);
      fileInput.value = '';
    };
    panel.querySelector('#wimg-cancel').addEventListener('click', () => panel.remove());
    panel.querySelector('#wimg-insert').addEventListener('click', () => {
      const isUrl = panel.querySelector('.wiki-ins-tab.active').dataset.tab === 'url';
      const src   = isUrl ? panel.querySelector('#wimg-url').value.trim() : pendingDataUrl;
      if (!src) return;
      const alt = panel.querySelector('#wimg-alt').value.trim();
      panel.remove();
      restoreSelection();
      const fig = document.createElement('figure');
      fig.className = 'wiki-figure'; fig.contentEditable = 'false';
      fig.innerHTML = `<img src="${escAttr(src)}" alt="${escAttr(alt)}" class="wiki-img">
        <figcaption><span class="fig-num" contenteditable="false">Figure ?:</span>
        <span class="fig-caption" contenteditable="true"> ${escHtml(alt || 'Caption…')}</span></figcaption>`;
      document.execCommand('insertHTML', false, fig.outerHTML);
      recalcIndex(); schedSave();
    });
    setTimeout(() => document.addEventListener('mousedown', e => { if (!panel.contains(e.target)) panel.remove(); }, { once: true }), 0);
  }

  // ── Table insertion ───────────────────────────────────────────────────────
  container.querySelector('#wiki-btn-table').addEventListener('mousedown', e => {
    e.preventDefault(); saveSelection(); openTableDialog();
  });

  function openTableDialog() {
    closeAllPopups();
    const panel = makePanel(`
      <div class="wiki-ins-title">Insert Table</div>
      <div class="wiki-ins-body" style="display:flex;gap:12px;align-items:flex-end">
        <label class="wiki-ins-label">Rows<input class="form-input" id="wtbl-rows" type="number" value="3" min="1" max="50"/></label>
        <label class="wiki-ins-label">Columns<input class="form-input" id="wtbl-cols" type="number" value="3" min="1" max="20"/></label>
      </div>
      <div class="wiki-ins-body">
        <input class="form-input" id="wtbl-caption" placeholder="Table caption…" style="margin-top:6px"/>
      </div>
      <div class="wiki-ins-footer">
        <button class="btn btn-secondary btn-sm" id="wtbl-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm"   id="wtbl-insert">Insert</button>
      </div>`);
    positionPopup(panel, container.querySelector('#wiki-btn-table'));
    document.body.appendChild(panel);

    panel.querySelector('#wtbl-cancel').addEventListener('click', () => panel.remove());
    panel.querySelector('#wtbl-insert').addEventListener('click', () => {
      const rows = Math.max(1, parseInt(panel.querySelector('#wtbl-rows').value) || 3);
      const cols = Math.max(1, parseInt(panel.querySelector('#wtbl-cols').value) || 3);
      const cap  = panel.querySelector('#wtbl-caption').value.trim();
      panel.remove();
      restoreSelection();
      const headerRow = `<tr>${Array.from({length: cols}, (_, i) =>
        `<th contenteditable="true">Col ${i+1}</th>`).join('')}</tr>`;
      const bodyRows = Array.from({length: rows}, () =>
        `<tr>${Array.from({length: cols}, () =>
          `<td contenteditable="true"></td>`).join('')}</tr>`).join('');
      const fig = document.createElement('figure');
      fig.className = 'wiki-table-wrap'; fig.contentEditable = 'false';
      fig.innerHTML = `
        <figcaption class="wiki-tbl-caption">
          <span class="tbl-num" contenteditable="false">Table ?:</span>
          <span class="tbl-caption" contenteditable="true"> ${escHtml(cap || 'Caption…')}</span>
        </figcaption>
        <div class="wiki-tbl-scroll">
          <table class="wiki-table"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>
        </div>`;
      document.execCommand('insertHTML', false, fig.outerHTML);
      editor.querySelectorAll('.wiki-table th, .wiki-table td').forEach(c => { c.contentEditable = 'true'; });
      editor.querySelectorAll('.tbl-caption').forEach(c => { c.contentEditable = 'true'; });
      recalcIndex(); schedSave();
    });
    setTimeout(() => document.addEventListener('mousedown', e => { if (!panel.contains(e.target)) panel.remove(); }, { once: true }), 0);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  recalcIndex();
  updateCounts();
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function makePanel(html) {
  const panel = document.createElement('div');
  panel.className = 'wiki-insert-panel';
  panel.innerHTML = html;
  return panel;
}

function positionPopup(panel, anchor) {
  panel.style.position = 'fixed';
  panel.style.zIndex   = '9999';
  const r = anchor.getBoundingClientRect();
  panel.style.top  = `${r.bottom + 4}px`;
  panel.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`;
}

function closeAllPopups() {
  document.querySelectorAll('.wiki-insert-panel').forEach(p => p.remove());
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(str) {
  return String(str || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
