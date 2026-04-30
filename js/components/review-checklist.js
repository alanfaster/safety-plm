/**
 * Review Artifact Panel
 *
 * mountReviewChecklist(container, {
 *   session, snapshot, sections, allResponses,
 *   currentUserId, reviewers, findings,
 *   artifactVerdict,          // current user's review_artifact_verdicts row for this snapshot
 *   isDrifted,
 *   onSaved,                  // ({ itemId, verdict, comment })
 *   onFindingRaise,           // (opts) → opens raise-finding modal in parent
 *   onReSnapshotRequest,
 *   onVerdictSaved,           // ({ verdict, comment }) → updates local cache in parent
 * })
 *
 * sections: template sections with .items[] pre-loaded
 * findings: all review_findings rows for this snapshot (item-linked + open points)
 * artifactVerdict: single review_artifact_verdicts row (or null)
 */

import { sb } from '../config.js';
import { wireBottomPanel } from '../utils/bottom-panel.js';
import {
  FINDING_STATUS_LABELS, FINDING_STATUS_CLASSES,
  TRANSITIONS, TRANSITION_LABELS, COMMENT_REQUIRED,
  SEVERITY_LABELS, SEVERITY_CLASSES,
} from './finding-constants.js';

const VERDICT_LABELS  = { ok:'OK', nok:'NOK', partially_ok:'Partially OK', na:'N/A' };
const VERDICT_CLASSES = { ok:'sel-ok', nok:'sel-nok', partially_ok:'sel-partially_ok', na:'sel-na' };

const ARTIFACT_FINAL_LABELS  = { go:'GO', conditional:'Conditional', no_go:'NO-GO' };
const ARTIFACT_FINAL_CLASSES = { go:'rvck-stamp-go', conditional:'rvck-stamp-conditional', no_go:'rvck-stamp-nogo' };


function buildStatusSelectHtml(f, isAuthor, extraClass = '') {
  const transitions = TRANSITIONS[f.status] || [];
  const visibleTransitions = transitions.filter(to => to !== 'closed' || isAuthor);
  const disabled = visibleTransitions.length === 0 ? 'disabled' : '';
  const closeBlocked = transitions.includes('closed') && !isAuthor;
  return `<select class="rve-status-select ${extraClass}" data-finding-id="${f.id}" data-current="${f.status}" data-status="${f.status}" ${disabled}>
    <option value="${f.status}" selected>${FINDING_STATUS_LABELS[f.status] || f.status}</option>
    ${visibleTransitions.map(to => `<option value="${to}">${TRANSITION_LABELS[to] || FINDING_STATUS_LABELS[to]}</option>`).join('')}
    ${closeBlocked ? `<option value="" disabled>Close (creator only)</option>` : ''}
  </select>`;
}

function buildFindingsSummaryBadges(findings) {
  const counts = {};
  findings.forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1; });
  return Object.entries(counts)
    .map(([status, n]) =>
      `<span class="badge ${FINDING_STATUS_CLASSES[status] || ''}" style="margin-left:4px">${FINDING_STATUS_LABELS[status] || status} ×${n}</span>`)
    .join('');
}

const ARTIFACT_DISPLAY_FIELDS = {
  requirements:         ['req_code','title','description','type','status','priority','asil','dal'],
  arch_spec_items:      ['spec_code','title','type','status'],
  test_specs:           ['test_code','name','description','level','status','method'],
  safety_analysis_rows: ['analysis_code','title','analysis_type','status'],
};

export function mountReviewChecklist(container, opts) {
  const {
    session, snapshot, sections = [], allResponses = [], currentUserId,
    reviewers = [], findings = [], artifactVerdict = null,
    isDrifted = false,
    responseSnapshot,
    onSaved, onFindingRaise, onFindingCreated, onFindingDeleted, onFindingStatusChanged,
    onCompareRequest, onReSnapshotRequest, onVerdictSaved,
  } = opts;

  // In shared mode the checklist snapshot (where responses are stored) differs from the display snapshot
  const ckSnap = responseSnapshot || snapshot;

  // Response index: { [itemId]: { [reviewerId]: row } }
  const responseIndex = {};
  allResponses.forEach(r => {
    if (!responseIndex[r.template_item_id]) responseIndex[r.template_item_id] = {};
    responseIndex[r.template_item_id][r.reviewer_id] = r;
  });

  // Findings index: { [itemId]: [finding] } — null key = open points
  const findingsByItem = {};
  findings.forEach(f => {
    const key = f.template_item_id || '__open__';
    if (!findingsByItem[key]) findingsByItem[key] = [];
    findingsByItem[key].push(f);
  });

  // Finding comments: loaded lazily per-finding into _commentCache
  const _commentCache = {}; // { [findingId]: comment[] }

  // Collapsed state for accordion sections (all open by default)
  const _collapsed = {};

  render();

  // ── Main render ─────────────────────────────────────────────────────────────

  function render() {
    const totalItems  = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
    const myDoneTotal = sections.reduce((s, sec) =>
      s + (sec.items || []).filter(i => responseIndex[i.id]?.[currentUserId]).length, 0);

    container.innerHTML = `
      <div class="rvck-wrap">
        ${isDrifted ? `
          <div class="rvck-drift-banner">
            <span class="rvck-drift-icon">⚠</span>
            <span class="rvck-drift-text">The artifact has changed since this snapshot was taken.</span>
            <span class="rvck-drift-actions">
              ${onCompareRequest ? `<button class="btn btn-ghost btn-xs rvck-drift-compare-btn">Compare versions</button>` : ''}
            </span>
          </div>` : ''}

        ${sections.length ? `
          <div class="rvck-block">
            <button class="rvck-col-header rvck-block-toggle" data-target="rvck-sections-wrap">
              <span class="rvck-block-chevron">▼</span>
              <span class="rvck-col-title">Checklist</span>
              ${totalItems ? `<span class="rvck-bp-progress">${myDoneTotal}/${totalItems}</span>` : ''}
            </button>
            <div class="rvck-sections-wrap" id="rvck-sections-wrap">
              ${sections.map(sec => renderSection(sec)).join('')}
            </div>
          </div>` : ''}

        <div class="rvck-block" id="rvck-open-points">
          <button class="rvck-col-header rvck-block-toggle" data-target="rvck-op-body">
            <span class="rvck-block-chevron">▼</span>
            <span class="rvck-col-title">Open Points</span>
            <span class="rvck-sec-badge" id="rvck-op-badge">${(findingsByItem['__open__'] || []).length || ''}</span>
            <span style="flex:1"></span>
            <button class="btn btn-ghost btn-xs rvck-op-add-btn">+ Add</button>
          </button>
          <div id="rvck-op-body">
            ${renderOpenPointsList()}
          </div>
        </div>
      </div>
    `;

    wire();
  }

  // ── Section accordion ───────────────────────────────────────────────────────

  function renderSection(sec) {
    const items      = sec.items || [];
    const myDone     = items.filter(i => responseIndex[i.id]?.[currentUserId]).length;
    const isCollapsed = _collapsed[sec.id];

    return `
      <div class="rvck-section" id="rvck-sec-${sec.id}">
        <button class="rvck-section-header" data-sec-id="${sec.id}">
          <span class="rvck-sec-chevron">${isCollapsed ? '▶' : '▼'}</span>
          <span class="rvck-sec-name">${escHtml(sec.name)}</span>
          <span class="rvck-sec-progress">${myDone}/${items.length}</span>
        </button>
        <div class="rvck-section-body" id="rvck-sec-body-${sec.id}" style="${isCollapsed ? 'display:none' : ''}">
          ${items.map(item => renderItem(item)).join('')}
        </div>
      </div>
    `;
  }

  function renderItem(item) {
    const myResp      = responseIndex[item.id]?.[currentUserId];
    const myVerdict   = myResp?.verdict || '';
    const itemFindings = findingsByItem[item.id] || [];
    // Don't pre-fill description when findings already exist — avoids stale text on re-open
    const myComment   = itemFindings.length ? '' : (myResp?.comment || '');
    const needsComment = myVerdict === 'nok' || myVerdict === 'partially_ok';

    return `
      <div class="rvck-item" data-item-id="${item.id}" data-verdict="${myVerdict}">
        <div class="rvck-item-top-row">
          <div class="rvck-item-criterion">
            ${item.is_mandatory ? '<span class="rvck-mandatory" title="Mandatory">★</span>' : ''}
            <span class="rvck-criterion-text">${escHtml(item.criterion)}</span>
            ${item.guidance ? `<div class="rvck-guidance">${escHtml(item.guidance)}</div>` : ''}
          </div>

          <div class="rvck-item-controls">
            <div class="rvck-verdict-row">
              <div class="rvck-verdict-pills">
                ${['ok','nok','partially_ok','na'].map(v => `
                  <button class="rvck-vbtn ${myVerdict === v ? VERDICT_CLASSES[v] + ' active' : ''}"
                          data-verdict="${v}" data-item-id="${item.id}">${VERDICT_LABELS[v]}</button>`).join('')}
              </div>
            </div>

            <div class="rvck-inline-raise-form" data-item-id="${item.id}"
                 ${needsComment && !itemFindings.length ? '' : 'style="display:none"'}>
              <input  class="form-input rvck-raise-title" placeholder="Finding title *" data-item-id="${item.id}"/>
              <div class="rvck-raise-row">
                <select class="form-input form-select rvck-raise-severity" data-item-id="${item.id}">
                  ${['critical','major','minor','observation'].map(s =>
                    `<option value="${s}" ${s === 'major' ? 'selected' : ''}>${SEVERITY_LABELS[s]}</option>`
                  ).join('')}
                </select>
                <button class="btn btn-secondary btn-sm rvck-raise-save-btn" data-item-id="${item.id}">⚑ Save Finding</button>
              </div>
              <textarea class="form-input rvck-raise-desc" rows="2" placeholder="Description (optional)…"
                        data-item-id="${item.id}">${escHtml(myComment)}</textarea>
            </div>
          </div>
        </div>

        ${itemFindings.length ? `
          <button class="rvck-findings-toggle" data-item-id="${item.id}">
            <span class="rvck-findings-toggle-chevron">▶</span>
            ⚑ ${itemFindings.length} finding${itemFindings.length > 1 ? 's' : ''}
            ${buildFindingsSummaryBadges(itemFindings)}
          </button>
          <div class="rvck-item-findings" id="rvck-item-findings-${item.id}" style="display:none">
            ${itemFindings.map(f => renderInlineFinding(f)).join('')}
          </div>` : `<div class="rvck-item-findings" id="rvck-item-findings-${item.id}"></div>`}
      </div>
    `;
  }

  // ── Open Points ─────────────────────────────────────────────────────────────

  function renderOpenPointsList() {
    const openPoints = findingsByItem['__open__'] || [];
    if (!openPoints.length) return `<p class="rvck-op-empty text-muted">No open points yet.</p>`;
    return openPoints.map(f => renderInlineFinding(f, true)).join('');
  }

  // ── Inline finding card (inside checklist or open points) ───────────────────

  function renderInlineFinding(f, withThread = false) {
    const comments     = _commentCache[f.id] || [];
    const isAuthor     = f.created_by === currentUserId;
    const commentCount = comments.length;

    const statusSelect = buildStatusSelectHtml(f, isAuthor, 'rvck-status-select');

    return `
      <div class="rvck-inline-finding" data-finding-id="${f.id}" data-severity="${f.severity}" data-status="${f.status}">
        <div class="rvck-inline-finding-header">
          <span class="mono rvck-inline-finding-code">${escHtml(f.finding_code)}</span>
          <span class="badge ${SEVERITY_CLASSES[f.severity] || ''}">${SEVERITY_LABELS[f.severity] || f.severity}</span>
          <span class="rvck-inline-finding-title">${escHtml(f.title)}</span>
          ${f.description ? `<span class="rvck-inline-finding-desc-inline text-muted">— ${escHtml(f.description)}</span>` : ''}
          <span class="rvck-inline-status-group">${statusSelect}</span>
          <span class="rvck-inline-finding-actions">
            <button class="btn btn-ghost btn-xs rvck-comments-toggle" data-finding-id="${f.id}"
                    title="${commentCount ? commentCount + ' comment(s)' : 'Add comment'}">💬${commentCount ? ' ' + commentCount : ''}</button>
            ${isAuthor ? `<button class="btn btn-ghost btn-xs rvck-inline-del-btn" data-finding-id="${f.id}" title="Delete" style="color:var(--color-danger,#e53e3e)">✕</button>` : ''}
          </span>
        </div>

        <div class="rvck-inline-thread-wrap" id="rvck-thread-wrap-${f.id}" style="display:none">
          <div class="rvck-inline-thread" id="rvck-thread-${f.id}">
            ${comments.map(c => renderComment(c)).join('')}
          </div>
          <div class="rvck-inline-reply">
            <textarea class="form-input rvck-inline-reply-input" data-finding-id="${f.id}"
              rows="1" placeholder="Reply…"></textarea>
            <button class="btn btn-secondary btn-xs rvck-inline-reply-btn" data-finding-id="${f.id}">Send</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderComment(c) {
    const name = c.user_profiles?.display_name || c.author_id?.slice(0, 8) || '?';
    const dt   = formatDateTime(c.created_at);
    return `<div class="rve-fcard-comment"><span class="rve-fcard-comment-author">${escHtml(name)}, ${escHtml(dt)}:</span><span class="rve-fcard-comment-text"> ${escHtml(c.comment)}</span></div>`;
  }

  // ── Wire everything ─────────────────────────────────────────────────────────

  function wire() {
    // Block-level collapse (Checklist / Open Points headers)
    container.querySelectorAll('.rvck-block-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        if (e.target.closest('.rvck-op-add-btn')) return; // let + Add through
        const body    = container.querySelector(`#${btn.dataset.target}`);
        const chevron = btn.querySelector('.rvck-block-chevron');
        if (!body) return;
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        if (chevron) chevron.textContent = collapsed ? '▼' : '▶';
      });
    });

    // Drift banner
    container.querySelector('.rvck-drift-compare-btn')?.addEventListener('click', () => onCompareRequest?.());

    // Section accordion
    container.querySelectorAll('.rvck-section-header[data-sec-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const secId = btn.dataset.secId;
        _collapsed[secId] = !_collapsed[secId];
        const body    = container.querySelector(`#rvck-sec-body-${secId}`);
        const chevron = btn.querySelector('.rvck-sec-chevron');
        if (body)    body.style.display    = _collapsed[secId] ? 'none' : '';
        if (chevron) chevron.textContent   = _collapsed[secId] ? '▶' : '▼';
      });
    });

    // Open points — inline "Add" form (same pattern as checklist item findings)
    container.querySelector('.rvck-op-add-btn')?.addEventListener('click', () => {
      const body = container.querySelector('#rvck-op-body');
      if (!body || body.querySelector('.rvck-op-inline-form')) return; // already open
      const formHtml = `
        <div class="rvck-op-inline-form rvck-inline-raise-form" style="padding:8px 12px;border-top:1px solid #f0dfc0">
          <input  class="form-input rvck-raise-title rvck-op-raise-title" placeholder="Finding title *"/>
          <div class="rvck-raise-row">
            <select class="form-input form-select rvck-raise-severity rvck-op-raise-severity">
              ${['critical','major','minor','observation'].map(s =>
                `<option value="${s}" ${s === 'major' ? 'selected' : ''}>${SEVERITY_LABELS[s]}</option>`
              ).join('')}
            </select>
            <button class="btn btn-secondary btn-sm rvck-op-raise-save-btn">⚑ Save Open Point</button>
            <button class="btn btn-ghost btn-sm rvck-op-raise-cancel-btn">Cancel</button>
          </div>
          <textarea class="form-input rvck-raise-desc rvck-op-raise-desc" rows="2" placeholder="Description (optional)…"></textarea>
        </div>`;
      body.insertAdjacentHTML('afterbegin', formHtml);

      body.querySelector('.rvck-op-raise-cancel-btn').onclick = () => {
        body.querySelector('.rvck-op-inline-form')?.remove();
      };

      body.querySelector('.rvck-op-raise-save-btn').onclick = async () => {
        const form    = body.querySelector('.rvck-op-inline-form');
        const titleEl = form.querySelector('.rvck-op-raise-title');
        const title   = titleEl.value.trim();
        if (!title) { titleEl.focus(); titleEl.classList.add('input-error'); return; }
        titleEl.classList.remove('input-error');

        const severity = form.querySelector('.rvck-op-raise-severity').value || 'major';
        const desc     = form.querySelector('.rvck-op-raise-desc').value.trim() || '';
        const saveBtn  = form.querySelector('.rvck-op-raise-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = '…';

        const seqNum = (findings.length + 1).toString().padStart(3, '0');
        const finding_code = `FND-${seqNum}`;

        const { data: newFinding, error } = await sb.from('review_findings').insert({
          session_id:       session.id,
          snapshot_id:      ckSnap.id,
          template_item_id: null,
          finding_code,
          severity,
          title,
          description:  desc || null,
          status:       'open',
          created_by:   currentUserId,
        }).select().single();

        if (error) { saveBtn.disabled = false; saveBtn.textContent = '⚑ Save Open Point'; return; }

        findings.push(newFinding);
        if (!findingsByItem['__open__']) findingsByItem['__open__'] = [];
        findingsByItem['__open__'].push(newFinding);
        onFindingCreated?.(newFinding);

        form.remove();
        const badge = container.querySelector('#rvck-op-badge');
        if (badge) badge.textContent = findingsByItem['__open__'].length;
        body.insertAdjacentHTML('beforeend', renderInlineFinding(newFinding));
        wireInlineFinding(container);
      };
    });

    // Verdict pills
    container.querySelectorAll('.rvck-vbtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId  = btn.dataset.itemId;
        const verdict = btn.dataset.verdict;
        const itemEl  = container.querySelector(`.rvck-item[data-item-id="${itemId}"]`);

        itemEl?.querySelectorAll('.rvck-vbtn').forEach(b => b.classList.remove(...Object.values(VERDICT_CLASSES), 'active'));
        btn.classList.add(VERDICT_CLASSES[verdict], 'active');
        if (itemEl) itemEl.dataset.verdict = verdict;

        const raiseForm = itemEl?.querySelector(`.rvck-inline-raise-form[data-item-id="${itemId}"]`);
        const needsForm = verdict === 'nok' || verdict === 'partially_ok';
        if (raiseForm) raiseForm.style.display = needsForm ? '' : 'none';

        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        if (!responseIndex[itemId][currentUserId]) responseIndex[itemId][currentUserId] = {};
        responseIndex[itemId][currentUserId].verdict = verdict;

        const desc = itemEl?.querySelector(`.rvck-raise-desc[data-item-id="${itemId}"]`)?.value || '';
        await saveResponse(itemId, verdict, desc);
        updateSectionProgress(itemId);
        onSaved?.({ snapshotId: ckSnap.id, itemId, verdict, comment: desc });
      });
    });

    // Inline finding description auto-save to checklist response comment
    container.querySelectorAll('.rvck-raise-desc').forEach(ta => {
      ta.addEventListener('input', debounce(async () => {
        const itemId  = ta.dataset.itemId;
        const verdict = responseIndex[itemId]?.[currentUserId]?.verdict || '';
        if (!verdict) return;
        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        if (!responseIndex[itemId][currentUserId]) responseIndex[itemId][currentUserId] = {};
        responseIndex[itemId][currentUserId].comment = ta.value;
        await saveResponse(itemId, verdict, ta.value);
      }, 600));
    });

    // Save Finding button — inline finding form
    container.querySelectorAll('.rvck-raise-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId   = btn.dataset.itemId;
        const form     = container.querySelector(`.rvck-inline-raise-form[data-item-id="${itemId}"]`);
        const titleEl  = form?.querySelector(`.rvck-raise-title`);
        const title    = titleEl?.value?.trim();
        if (!title) { titleEl?.focus(); titleEl?.classList.add('input-error'); return; }
        titleEl?.classList.remove('input-error');

        const severity = form?.querySelector(`.rvck-raise-severity`)?.value || 'major';
        const desc     = form?.querySelector(`.rvck-raise-desc`)?.value?.trim() || '';
        const resp     = responseIndex[itemId]?.[currentUserId];

        btn.disabled = true;
        btn.textContent = '…';

        // Auto-generate finding code: FND-{seq} by counting existing findings + 1
        const seqNum = (findings.length + 1).toString().padStart(3, '0');
        const finding_code = `FND-${seqNum}`;

        const { data: newFinding, error } = await sb.from('review_findings').insert({
          session_id: session.id,
          snapshot_id: ckSnap.id,
          response_id: resp?.id || null,
          template_item_id: itemId,
          finding_code,
          severity,
          title,
          description: desc || null,
          status: 'open',
          created_by: currentUserId,
        }).select().single();

        btn.disabled = false;
        btn.textContent = '⚑ Save Finding';

        if (error) { console.error('Failed to save finding', error); return; }

        // Add to local state + notify parent (triggers full remount via afterFindingMutation)
        findings.push(newFinding);
        if (!findingsByItem[itemId]) findingsByItem[itemId] = [];
        findingsByItem[itemId].push(newFinding);
        if (responseIndex[itemId]?.[currentUserId]) responseIndex[itemId][currentUserId].comment = '';
        onFindingCreated?.(newFinding);
      });
    });

    // Findings toggle (per checklist item)
    container.querySelectorAll('.rvck-findings-toggle:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const itemId  = btn.dataset.itemId;
        const list    = container.querySelector(`#rvck-item-findings-${itemId}`);
        const chevron = btn.querySelector('.rvck-findings-toggle-chevron');
        const open    = list?.style.display !== 'none';
        if (list)    list.style.display    = open ? 'none' : '';
        if (chevron) chevron.textContent   = open ? '▶' : '▼';
      });
    });

    wireInlineFinding(container);

    // Load comments for visible findings
    loadVisibleComments();

  }


  function wireInlineFinding(root) {
    // Comments toggle
    root.querySelectorAll('.rvck-comments-toggle:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const wrap = root.querySelector(`#rvck-thread-wrap-${btn.dataset.findingId}`);
        if (wrap) wrap.style.display = wrap.style.display !== 'none' ? 'none' : '';
      });
    });
    wireInlineTransitions(root);
    wireInlineDeletes(root);
    wireInlineReplies(root);
  }

  function refreshToggleBadge(itemId) {
    if (!itemId) return;
    const btn = container.querySelector(`.rvck-findings-toggle[data-item-id="${itemId}"]`);
    if (!btn) return;
    const findings = findingsByItem[itemId] || [];
    const count = findings.length;
    const chevron = btn.querySelector('.rvck-findings-toggle-chevron')?.outerHTML || '<span class="rvck-findings-toggle-chevron">▶</span>';
    btn.innerHTML = `${chevron} ⚑ ${count} finding${count !== 1 ? 's' : ''} ${buildFindingsSummaryBadges(findings)}`;
  }

  function wireInlineTransitions(root) {
    root.querySelectorAll('.rve-status-select:not([data-wired])').forEach(sel => {
      sel.dataset.wired = '1';
      sel.addEventListener('change', () => {
        const findingId = sel.dataset.findingId;
        const toStatus  = sel.value;
        if (!toStatus || toStatus === sel.dataset.current) { sel.value = sel.dataset.current; return; }
        const f = findings.find(x => x.id === findingId);
        if (!f) return;
        const card = root.querySelector(`.rvck-inline-finding[data-finding-id="${findingId}"]`);
        if (!card || card.querySelector('.rvck-trans-confirm-form')) { sel.value = sel.dataset.current; return; }

        sel.disabled = true;
        const label = TRANSITION_LABELS[toStatus] || FINDING_STATUS_LABELS[toStatus] || toStatus;
        const form  = document.createElement('div');
        form.className = 'rvck-trans-confirm-form';
        form.innerHTML = `
          <span class="rvck-trans-confirm-label">${escHtml(label)} — add a comment <span style="color:var(--color-danger,#e53e3e)">*</span></span>
          <textarea class="form-input rvck-trans-comment" rows="2" placeholder="Required…"></textarea>
          <div class="rvck-trans-confirm-btns">
            <button class="btn btn-primary btn-sm rvck-trans-ok-btn">${escHtml(label)}</button>
            <button class="btn btn-ghost btn-sm rvck-trans-cancel-btn">Cancel</button>
          </div>`;

        card.querySelector('.rvck-inline-finding-header').insertAdjacentElement('afterend', form);
        form.querySelector('.rvck-trans-comment').focus();

        form.querySelector('.rvck-trans-cancel-btn').addEventListener('click', () => {
          form.remove();
          sel.value = sel.dataset.current;
          sel.disabled = false;
        });

        form.querySelector('.rvck-trans-ok-btn').addEventListener('click', async () => {
          const comment = form.querySelector('.rvck-trans-comment').value.trim();
          const ta = form.querySelector('.rvck-trans-comment');
          if (!comment) { ta.focus(); ta.classList.add('input-error'); return; }
          ta.classList.remove('input-error');

          if (toStatus === 'closed' && f.created_by !== currentUserId) {
            form.remove();
            sel.value = sel.dataset.current;
            sel.disabled = false;
            return;
          }

          const okBtn = form.querySelector('.rvck-trans-ok-btn');
          okBtn.disabled = true;

          const { error: statusErr } = await sb.from('review_findings')
            .update({ status: toStatus, updated_at: new Date().toISOString() }).eq('id', findingId);
          if (statusErr) { okBtn.disabled = false; return; }

          await sb.from('review_finding_comments').insert({
            finding_id: findingId, author_id: currentUserId,
            comment: `[${FINDING_STATUS_LABELS[toStatus]}] ${comment}`,
          });

          f.status = toStatus;
          card.outerHTML = renderInlineFinding(f);
          wireInlineFinding(root);
          refreshToggleBadge(f.template_item_id);
          loadVisibleComments();
          onFindingStatusChanged?.({ id: findingId, status: toStatus });
        });
      });
    });
  }

  function wireInlineDeletes(root) {
    root.querySelectorAll('.rvck-inline-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const findingId = btn.dataset.findingId;
        const f = findings.find(x => x.id === findingId);
        if (!confirm(`Delete finding ${f?.finding_code || ''}? This cannot be undone.`)) return;

        btn.disabled = true;
        const { error } = await sb.from('review_findings').delete().eq('id', findingId);
        if (error) { btn.disabled = false; return; }

        // Remove from local arrays
        const idx = findings.findIndex(x => x.id === findingId);
        if (idx >= 0) findings.splice(idx, 1);
        const key = f?.template_item_id || '__open__';
        if (findingsByItem[key]) {
          const fi = findingsByItem[key].findIndex(x => x.id === findingId);
          if (fi >= 0) findingsByItem[key].splice(fi, 1);
        }

        // Remove card from DOM
        root.querySelector(`.rvck-inline-finding[data-finding-id="${findingId}"]`)?.remove();

        // Update open-points badge
        if (!f?.template_item_id) {
          const badge = container.querySelector('#rvck-op-badge');
          const body  = container.querySelector('#rvck-op-body');
          if (badge) badge.textContent = (findingsByItem['__open__'] || []).length || '';
          if (body && !(findingsByItem['__open__'] || []).length)
            body.innerHTML = `<p class="rvck-op-empty text-muted">No open points yet.</p>`;
        }
        onFindingDeleted?.({ id: findingId });
      });
    });
  }

  function wireInlineReplies(root) {
    root.querySelectorAll('.rvck-inline-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => postInlineComment(btn.dataset.findingId, root));
    });
    root.querySelectorAll('.rvck-inline-reply-input').forEach(ta => {
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postInlineComment(ta.dataset.findingId, root); }
      });
    });
  }

  async function postInlineComment(findingId, root) {
    const ta  = root.querySelector(`.rvck-inline-reply-input[data-finding-id="${findingId}"]`);
    const btn = root.querySelector(`.rvck-inline-reply-btn[data-finding-id="${findingId}"]`);
    if (!ta || !ta.value.trim()) { ta?.focus(); return; }
    if (btn) btn.disabled = true;

    const { data: inserted, error } = await sb.from('review_finding_comments').insert({
      finding_id: findingId, author_id: currentUserId, comment: ta.value.trim(),
    }).select('id, finding_id, author_id, comment, created_at').single();

    if (btn) btn.disabled = false;
    if (error) return;
    const { data: profile } = await sb.from('user_profiles').select('display_name').eq('user_id', currentUserId).single();
    const comment = { ...inserted, user_profiles: profile || null };

    if (!_commentCache[findingId]) _commentCache[findingId] = [];
    _commentCache[findingId].push(comment);
    ta.value = '';

    // Ensure thread is visible
    const wrap = root.querySelector(`#rvck-thread-wrap-${findingId}`);
    if (wrap) wrap.style.display = '';
    const thread = root.querySelector(`#rvck-thread-${findingId}`);
    if (thread) {
      thread.insertAdjacentHTML('beforeend', renderComment(comment));
      thread.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }
    // Update comment count badge on toggle button
    const toggle = root.querySelector(`.rvck-comments-toggle[data-finding-id="${findingId}"]`);
    if (toggle) toggle.textContent = `💬 ${(_commentCache[findingId] || []).length}`;
  }

  async function loadVisibleComments() {
    const visibleFindingIds = findings.map(f => f.id);
    if (!visibleFindingIds.length) return;

    const { data: rawComments } = await sb.from('review_finding_comments')
      .select('id, finding_id, author_id, comment, created_at')
      .in('finding_id', visibleFindingIds)
      .order('created_at');
    const rows = rawComments || [];
    const authorIds = [...new Set(rows.map(c => c.author_id).filter(Boolean))];
    const profileMap = {};
    if (authorIds.length) {
      const { data: profiles } = await sb.from('user_profiles').select('user_id, display_name').in('user_id', authorIds);
      (profiles || []).forEach(p => { profileMap[p.user_id] = p.display_name; });
    }
    const comments = rows.map(c => ({ ...c, user_profiles: { display_name: profileMap[c.author_id] || null } }));

    comments.forEach(c => {
      if (!_commentCache[c.finding_id]) _commentCache[c.finding_id] = [];
      if (!_commentCache[c.finding_id].find(x => x.id === c.id)) _commentCache[c.finding_id].push(c);
    });

    // Render loaded comments into thread divs and show wrap + update count badge
    visibleFindingIds.forEach(fid => {
      const cached = _commentCache[fid] || [];
      const thread = container.querySelector(`#rvck-thread-${fid}`);
      if (thread && cached.length) {
        thread.innerHTML = cached.map(c => renderComment(c)).join('');
        // Open the thread-wrap automatically
        const wrap = container.querySelector(`#rvck-thread-wrap-${fid}`);
        if (wrap) wrap.style.display = '';
        // Update count badge on toggle button
        const toggle = container.querySelector(`.rvck-comments-toggle[data-finding-id="${fid}"]`);
        if (toggle) toggle.textContent = `💬 ${cached.length}`;
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function updateSectionProgress(itemId) {
    const sec = sections.find(s => s.items?.some(i => i.id === itemId));
    if (!sec) return;
    const items  = sec.items || [];
    const myDone = items.filter(i => responseIndex[i.id]?.[currentUserId]).length;
    const prog   = container.querySelector(`#rvck-sec-${sec.id} .rvck-sec-progress`);
    if (prog) prog.textContent = `${myDone}/${items.length}`;
  }

  async function saveResponse(itemId, verdict, comment) {
    const existing = responseIndex[itemId]?.[currentUserId];
    if (existing?.id) {
      const { data } = await sb.from('review_checklist_responses')
        .update({ verdict, comment, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (data) Object.assign(responseIndex[itemId][currentUserId], data);
    } else {
      const { data } = await sb.from('review_checklist_responses')
        .upsert({
          session_id: session.id, snapshot_id: ckSnap.id,
          template_item_id: itemId, reviewer_id: currentUserId,
          verdict, comment, updated_at: new Date().toISOString(),
        }, { onConflict: 'snapshot_id,template_item_id,reviewer_id' })
        .select().single();
      if (data) {
        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        responseIndex[itemId][currentUserId] = data;
      }
    }
  }


  // Expose method to inject a newly raised finding into the correct slot
  container._addFinding = function(finding) {
    const key = finding.template_item_id || '__open__';
    if (!findingsByItem[key]) findingsByItem[key] = [];
    findingsByItem[key].push(finding);

    if (finding.template_item_id) {
      const slot = container.querySelector(`#rvck-item-findings-${finding.template_item_id}`);
      if (slot) { slot.insertAdjacentHTML('beforeend', renderInlineFinding(finding)); wireInlineFinding(container); }
    } else {
      const body  = container.querySelector('#rvck-op-body');
      const badge = container.querySelector('#rvck-op-badge');
      if (body)  { body.innerHTML = renderOpenPointsList(); wireInlineFinding(container); }
      if (badge) badge.textContent = (findingsByItem['__open__'] || []).length || '';
    }
  };
}

// ── Module-level helpers ───────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
