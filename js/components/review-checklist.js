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

const VERDICT_LABELS  = { ok:'OK', nok:'NOK', partially_ok:'Partially OK', na:'N/A' };
const VERDICT_CLASSES = { ok:'rv-v-ok', nok:'rv-v-nok', partially_ok:'rv-v-partial', na:'rv-v-na' };

const ARTIFACT_FINAL_LABELS  = { go:'GO', conditional:'Conditional', no_go:'NO-GO' };
const ARTIFACT_FINAL_CLASSES = { go:'rvck-stamp-go', conditional:'rvck-stamp-conditional', no_go:'rvck-stamp-nogo' };

const FINDING_STATUS_LABELS  = {
  open:'Open', accepted:'Accepted', in_progress:'In Progress', deferred:'Deferred',
  fixed:'Fixed', verified:'Verified', closed:'Closed', duplicate:'Duplicate', rejected:'Rejected',
};
const FINDING_STATUS_CLASSES = {
  open:'rv-fs-open', accepted:'rv-fs-accepted', in_progress:'rv-fs-in-progress',
  deferred:'rv-fs-deferred', fixed:'rv-fs-fixed', verified:'rv-fs-verified',
  closed:'rv-fs-closed', duplicate:'rv-fs-closed', rejected:'rv-fs-closed',
};
const SEVERITY_CLASSES = {
  critical:'rv-sev-critical', major:'rv-sev-major', minor:'rv-sev-minor', observation:'rv-sev-observation',
};
const SEVERITY_LABELS  = { critical:'Critical', major:'Major', minor:'Minor', observation:'Observation' };

const TRANSITIONS = {
  open:        ['accepted','rejected','duplicate'],
  accepted:    ['in_progress','deferred','rejected'],
  in_progress: ['fixed','deferred'],
  deferred:    ['in_progress','rejected'],
  fixed:       ['verified','in_progress'],
  verified:    ['closed','in_progress'],
  closed:[], duplicate:[], rejected:[],
};
const TRANSITION_LABELS = {
  accepted:'✓ Accept', in_progress:'▶ Start', deferred:'⏸ Defer',
  fixed:'✔ Mark Fixed', verified:'★ Verify', closed:'✓ Close',
  rejected:'✕ Reject', duplicate:'⊘ Duplicate',
};

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
    onSaved, onFindingRaise, onReSnapshotRequest, onVerdictSaved,
  } = opts;

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

  // Open Points section collapsed by default if no open points yet
  let _openPointsCollapsed = !(findingsByItem['__open__']?.length);

  // Current artifact verdict (mutable)
  let _myVerdict = artifactVerdict?.verdict || null;
  let _myVerdictComment = artifactVerdict?.verdict_comment || '';

  render();

  // ── Main render ─────────────────────────────────────────────────────────────

  function render() {
    const data   = snapshot.snapshot_data || {};
    const fields = ARTIFACT_DISPLAY_FIELDS[snapshot.artifact_type] || ['title','status'];

    // Total checklist items for bottom panel title
    const totalItems = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
    const myDoneTotal = sections.reduce((s, sec) =>
      s + (sec.items || []).filter(i => responseIndex[i.id]?.[currentUserId]).length, 0);

    container.innerHTML = `
      <div class="rvck-wrap">

        ${isDrifted ? `
          <div class="rvck-drift-banner">
            ⚠ This artifact has been modified since this snapshot was taken.
            <div class="rvck-drift-banner-actions">
              <button class="btn btn-ghost btn-sm" id="rvck-compare">Compare with current</button>
              ${onReSnapshotRequest ? `<button class="btn btn-secondary btn-sm" id="rvck-resnap">Update Snapshot</button>` : ''}
            </div>
          </div>` : ''}

        <!-- 1. Artifact details (all snapshot fields) -->
        <div class="rvck-artifact-detail">
          <div class="rvck-artifact-detail-header">
            <span class="rvck-snap-code">${escHtml(snapshot.artifact_code || snapshot.artifact_type)}</span>
            ${snapshot.artifact_version != null ? `<span class="artifact-version-badge">v${snapshot.artifact_version}</span>` : ''}
            <span class="rvck-snap-title">${escHtml(snapshot.artifact_title || '')}</span>
            <span class="badge badge-${escHtml(data.status || 'draft')}">${escHtml(data.status || '—')}</span>
            <span class="rvck-snap-at text-muted">Snapshot: ${formatDate(snapshot.snapshotted_at)}</span>
          </div>
          <div class="rvck-artifact-detail-fields">
            ${fields.filter(f => data[f] != null && data[f] !== '').map(f => `
              <div class="rvck-detail-field">
                <span class="rvck-detail-field-label">${escHtml(f.replace(/_/g,' '))}</span>
                <span class="rvck-detail-field-value">${escHtml(String(data[f]))}</span>
              </div>`).join('')}
          </div>
        </div>

        <!-- 2. GO / NO-GO verdict (above checklist) -->
        <div class="rvck-verdict-stamp" id="rvck-verdict-stamp">
          <div class="rvck-stamp-label">Reviewer Verdict</div>
          <div class="rvck-stamp-row">
            <div class="rvck-stamp-btns">
              ${['go','conditional','no_go'].map(v => `
                <button class="rvck-stamp-btn ${_myVerdict === v ? ARTIFACT_FINAL_CLASSES[v] + ' active' : ''}"
                        data-verdict="${v}">
                  ${v === 'go' ? '✓' : v === 'no_go' ? '✗' : '⚑'} ${ARTIFACT_FINAL_LABELS[v]}
                </button>`).join('')}
            </div>
            ${(opts.otherVerdicts || []).length ? `
              <div class="rvck-stamp-other">
                ${(opts.otherVerdicts || []).map(ov => `
                  <span class="rvck-rv-pill ${ov.verdict || ''}" title="${escHtml(ov.display_name)}">
                    ${escHtml(ov.display_name.charAt(0))}: ${ARTIFACT_FINAL_LABELS[ov.verdict] || '—'}
                  </span>`).join('')}
              </div>` : ''}
          </div>
          <textarea class="form-input rvck-stamp-comment" id="rvck-stamp-comment"
            rows="2" placeholder="Closing comment (optional)…">${escHtml(_myVerdictComment)}</textarea>
        </div>

        <!-- 3. Checklist — bottom panel (collapsible/resizable) -->
        <div class="bp-bar bp-collapsed rvck-checklist-bp" id="rvck-bp">
          <div class="bp-resize-handle"></div>
          <div class="bp-hdr">
            <span class="bp-title">
              Checklist
              ${totalItems ? `<span class="rvck-bp-progress">${myDoneTotal}/${totalItems}</span>` : ''}
              ${(findingsByItem['__open__'] || []).length ? `<span class="rve-main-tab-badge" style="margin-left:6px">${(findingsByItem['__open__'] || []).length}</span>` : ''}
            </span>
            <span class="bp-toggle">▲</span>
          </div>
          <div class="bp-body" id="rvck-bp-body">
            ${sections.length ? sections.map(sec => renderSection(sec)).join('') : `
              <div class="rvck-no-template text-muted" style="padding:20px">No checklist template attached to this session.</div>`}

            <!-- Open Points -->
            <div class="rvck-open-points" id="rvck-open-points">
              <button class="rvck-section-header rvck-open-points-toggle" id="rvck-op-toggle">
                <span class="rvck-sec-chevron">${_openPointsCollapsed ? '▶' : '▼'}</span>
                <span class="rvck-sec-name">Open Points</span>
                <span class="rvck-sec-badge">${(findingsByItem['__open__'] || []).length}</span>
                <span style="flex:1"></span>
                <span class="rvck-op-add-btn">+ Add Open Point</span>
              </button>
              <div class="rvck-open-points-body" id="rvck-op-body" style="${_openPointsCollapsed ? 'display:none' : ''}">
                ${renderOpenPointsList()}
              </div>
            </div>
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
    const myResp    = responseIndex[item.id]?.[currentUserId];
    const myVerdict = myResp?.verdict || '';
    const myComment = myResp?.comment || '';
    const needsComment = myVerdict === 'nok' || myVerdict === 'partially_ok';

    // Other reviewers' verdict pills
    const otherPills = reviewers.filter(r => r.user_id !== currentUserId).map(r => {
      const rv = responseIndex[item.id]?.[r.user_id];
      if (!rv) return `<span class="rvck-rv-pill rvck-rv-pending" title="${escHtml(r.display_name)}: pending">${escHtml(r.display_name.charAt(0))}: —</span>`;
      return `<span class="rvck-rv-pill ${rv.verdict}" title="${escHtml(r.display_name)}: ${VERDICT_LABELS[rv.verdict]}">${escHtml(r.display_name.charAt(0))}: ${VERDICT_LABELS[rv.verdict]}</span>`;
    }).join('');

    // Consensus
    const allV = reviewers.map(r => responseIndex[item.id]?.[r.user_id]?.verdict).filter(Boolean);
    let consensus = '';
    if (allV.length && allV.length === reviewers.length) {
      const allSame = allV.every(v => v === allV[0]);
      consensus = allSame
        ? `<span class="rvck-consensus ${VERDICT_CLASSES[allV[0]] || ''}" title="All agree">✓ ${VERDICT_LABELS[allV[0]]}</span>`
        : `<span class="rvck-consensus rvck-consensus-split">⚡ Split</span>`;
    }

    // Item-linked findings
    const itemFindings = findingsByItem[item.id] || [];

    return `
      <div class="rvck-item" data-item-id="${item.id}">
        <div class="rvck-item-criterion">
          ${item.is_mandatory ? '<span class="rvck-mandatory" title="Mandatory">★</span>' : ''}
          <span class="rvck-criterion-text">${escHtml(item.criterion)}</span>
          ${item.guidance ? `<div class="rvck-guidance">${escHtml(item.guidance)}</div>` : ''}
        </div>

        <div class="rvck-item-controls">
          ${otherPills ? `<div class="rvck-other-pills">${otherPills} ${consensus}</div>` : ''}

          <div class="rvck-verdict-row">
            <div class="rvck-verdict-pills">
              ${['ok','nok','partially_ok','na'].map(v => `
                <button class="rvck-vbtn ${myVerdict === v ? VERDICT_CLASSES[v] + ' active' : ''}"
                        data-verdict="${v}" data-item-id="${item.id}">${VERDICT_LABELS[v]}</button>`).join('')}
            </div>
            ${myVerdict === 'nok' || myVerdict === 'partially_ok' ? `
              <button class="btn btn-ghost btn-sm rvck-raise-btn" data-item-id="${item.id}" title="Raise finding">⚑ Raise</button>` : ''}
          </div>

          <div class="rvck-comment-wrap" ${needsComment ? '' : 'style="display:none"'}>
            <textarea class="form-input rvck-comment" data-item-id="${item.id}" rows="2"
              placeholder="Comment on this finding…">${escHtml(myComment)}</textarea>
          </div>

          ${itemFindings.length ? `
            <div class="rvck-item-findings" id="rvck-item-findings-${item.id}">
              ${itemFindings.map(f => renderInlineFinding(f)).join('')}
            </div>` : `<div class="rvck-item-findings" id="rvck-item-findings-${item.id}"></div>`}
        </div>
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
    const transitions = TRANSITIONS[f.status] || [];
    const comments    = _commentCache[f.id] || [];

    return `
      <div class="rvck-inline-finding" data-finding-id="${f.id}">
        <div class="rvck-inline-finding-header">
          <span class="mono rvck-inline-finding-code">${escHtml(f.finding_code)}</span>
          <span class="badge ${SEVERITY_CLASSES[f.severity] || ''}">${SEVERITY_LABELS[f.severity] || f.severity}</span>
          <span class="rvck-inline-finding-title">${escHtml(f.title)}</span>
          <span class="badge ${FINDING_STATUS_CLASSES[f.status] || ''}">${FINDING_STATUS_LABELS[f.status] || f.status}</span>
          <button class="btn btn-ghost btn-sm rvck-inline-del-btn" data-finding-id="${f.id}" title="Delete finding">✕</button>
        </div>
        ${f.description ? `<div class="rvck-inline-finding-desc text-muted">${escHtml(f.description)}</div>` : ''}

        ${transitions.length ? `
          <div class="rvck-inline-transitions">
            ${transitions.map(to => `
              <button class="btn btn-sm rvck-inline-trans-btn rve-trans-${to}"
                      data-finding-id="${f.id}" data-to="${to}">
                ${TRANSITION_LABELS[to] || FINDING_STATUS_LABELS[to]}
              </button>`).join('')}
          </div>` : ''}

        <div class="rvck-inline-thread" id="rvck-thread-${f.id}">
          ${comments.map(c => renderComment(c)).join('')}
        </div>

        <div class="rvck-inline-reply">
          <textarea class="form-input rvck-inline-reply-input" data-finding-id="${f.id}"
            rows="1" placeholder="Reply…"></textarea>
          <button class="btn btn-secondary btn-sm rvck-inline-reply-btn" data-finding-id="${f.id}">Reply</button>
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
    // Bottom panel (collapsible checklist)
    wireBottomPanel(container.querySelector('#rvck-bp'), { key: 'rvck-checklist-h', defaultH: 320 });

    // Drift buttons
    container.querySelector('#rvck-compare')?.addEventListener('click', openDiffModal);
    container.querySelector('#rvck-resnap')?.addEventListener('click', () => onReSnapshotRequest?.());

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

    // Open points toggle + "Add Open Point"
    container.querySelector('#rvck-op-toggle')?.addEventListener('click', e => {
      if (e.target.classList.contains('rvck-op-add-btn') || e.target.closest('.rvck-op-add-btn')) {
        e.stopPropagation();
        onFindingRaise?.({ snapshotId: snapshot.id, templateItemId: null, criterion: '', verdict: '', comment: '', responseId: null, isOpenPoint: true });
        return;
      }
      _openPointsCollapsed = !_openPointsCollapsed;
      const body    = container.querySelector('#rvck-op-body');
      const chevron = container.querySelector('#rvck-op-toggle .rvck-sec-chevron');
      if (body)    body.style.display  = _openPointsCollapsed ? 'none' : '';
      if (chevron) chevron.textContent = _openPointsCollapsed ? '▶' : '▼';
    });

    // Verdict pills
    container.querySelectorAll('.rvck-vbtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId  = btn.dataset.itemId;
        const verdict = btn.dataset.verdict;
        const itemEl  = container.querySelector(`.rvck-item[data-item-id="${itemId}"]`);
        const comment = itemEl?.querySelector('.rvck-comment')?.value || '';

        itemEl?.querySelectorAll('.rvck-vbtn').forEach(b => b.classList.remove(...Object.values(VERDICT_CLASSES), 'active'));
        btn.classList.add(VERDICT_CLASSES[verdict], 'active');

        const commentWrap = itemEl?.querySelector('.rvck-comment-wrap');
        if (commentWrap) commentWrap.style.display = (verdict === 'nok' || verdict === 'partially_ok') ? '' : 'none';

        updateRaiseBtn(itemEl, verdict, itemId);
        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        if (!responseIndex[itemId][currentUserId]) responseIndex[itemId][currentUserId] = {};
        responseIndex[itemId][currentUserId].verdict = verdict;

        await saveResponse(itemId, verdict, comment);
        updateSectionProgress(itemId);
        onSaved?.({ snapshotId: snapshot.id, itemId, verdict, comment });
      });
    });

    // Comments
    container.querySelectorAll('.rvck-comment').forEach(ta => {
      ta.addEventListener('input', debounce(async () => {
        const itemId  = ta.dataset.itemId;
        const verdict = responseIndex[itemId]?.[currentUserId]?.verdict || '';
        if (!verdict) return;
        responseIndex[itemId][currentUserId].comment = ta.value;
        await saveResponse(itemId, verdict, ta.value);
      }, 600));
    });

    // Raise finding (from checklist item)
    container.querySelectorAll('.rvck-raise-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId  = btn.dataset.itemId;
        const sec     = sections.find(s => s.items?.some(i => i.id === itemId));
        const item    = sec?.items?.find(i => i.id === itemId);
        const resp    = responseIndex[itemId]?.[currentUserId];
        onFindingRaise?.({
          snapshotId: snapshot.id, templateItemId: itemId,
          criterion: item?.criterion || '', verdict: resp?.verdict || '',
          comment: resp?.comment || '', responseId: resp?.id || null,
        });
      });
    });

    // Inline finding transitions, deletes, replies
    wireInlineTransitions(container);
    wireInlineDeletes(container);
    wireInlineReplies(container);

    // Load comments for visible findings
    loadVisibleComments();

    // Final verdict stamp
    container.querySelectorAll('.rvck-stamp-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const verdict = btn.dataset.verdict;
        container.querySelectorAll('.rvck-stamp-btn').forEach(b => {
          b.classList.remove('active', ...Object.values(ARTIFACT_FINAL_CLASSES));
        });
        btn.classList.add(ARTIFACT_FINAL_CLASSES[verdict], 'active');
        _myVerdict = verdict;
        const comment = container.querySelector('#rvck-stamp-comment')?.value?.trim() || '';
        await saveArtifactVerdict(verdict, comment);
      });
    });

    container.querySelector('#rvck-stamp-comment')?.addEventListener('input', debounce(async () => {
      if (!_myVerdict) return;
      const comment = container.querySelector('#rvck-stamp-comment')?.value?.trim() || '';
      _myVerdictComment = comment;
      await saveArtifactVerdict(_myVerdict, comment);
    }, 600));
  }

  function wireInlineTransitions(root) {
    root.querySelectorAll('.rvck-inline-trans-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const findingId = btn.dataset.findingId;
        const toStatus  = btn.dataset.to;
        const f = findings.find(x => x.id === findingId);
        if (!f) return;
        btn.disabled = true;
        const { error } = await sb.from('review_findings').update({ status: toStatus, updated_at: new Date().toISOString() }).eq('id', findingId);
        if (error) { btn.disabled = false; return; }
        f.status = toStatus;
        const card = root.querySelector(`.rvck-inline-finding[data-finding-id="${findingId}"]`);
        if (card) {
          card.outerHTML = renderInlineFinding(f);
          wireInlineTransitions(root);
          wireInlineDeletes(root);
          wireInlineReplies(root);
        }
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
          const badge = container.querySelector('#rvck-open-points .rvck-sec-badge');
          if (badge) badge.textContent = (findingsByItem['__open__'] || []).length;
          const body = container.querySelector('#rvck-op-body');
          if (body && !(findingsByItem['__open__'] || []).length) {
            body.innerHTML = `<p class="rvck-op-empty text-muted">No open points yet.</p>`;
          }
        }
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

    const { data: comment, error } = await sb.from('review_finding_comments').insert({
      finding_id: findingId, author_id: currentUserId, comment: ta.value.trim(),
    }).select('*, user_profiles(display_name)').single();

    if (btn) btn.disabled = false;
    if (error) return;

    if (!_commentCache[findingId]) _commentCache[findingId] = [];
    _commentCache[findingId].push(comment);
    ta.value = '';

    const thread = root.querySelector(`#rvck-thread-${findingId}`);
    if (thread) {
      thread.insertAdjacentHTML('beforeend', renderComment(comment));
      thread.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }
  }

  async function loadVisibleComments() {
    const visibleFindingIds = findings.map(f => f.id);
    if (!visibleFindingIds.length) return;

    const { data: comments } = await sb.from('review_finding_comments')
      .select('*, user_profiles(display_name)')
      .in('finding_id', visibleFindingIds)
      .order('created_at');

    (comments || []).forEach(c => {
      if (!_commentCache[c.finding_id]) _commentCache[c.finding_id] = [];
      if (!_commentCache[c.finding_id].find(x => x.id === c.id)) _commentCache[c.finding_id].push(c);
    });

    // Render loaded comments into thread divs
    visibleFindingIds.forEach(fid => {
      const thread = container.querySelector(`#rvck-thread-${fid}`);
      if (thread && _commentCache[fid]?.length) {
        thread.innerHTML = _commentCache[fid].map(c => renderComment(c)).join('');
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function updateRaiseBtn(itemEl, verdict, itemId) {
    if (!itemEl) return;
    const verdictRow = itemEl.querySelector('.rvck-verdict-row');
    let raiseBtn = verdictRow?.querySelector('.rvck-raise-btn');
    if (verdict === 'nok' || verdict === 'partially_ok') {
      if (!raiseBtn) {
        raiseBtn = document.createElement('button');
        raiseBtn.className = 'btn btn-ghost btn-sm rvck-raise-btn';
        raiseBtn.dataset.itemId = itemId;
        raiseBtn.title = 'Raise finding';
        raiseBtn.textContent = '⚑ Raise';
        verdictRow?.appendChild(raiseBtn);
        raiseBtn.addEventListener('click', () => {
          const sec  = sections.find(s => s.items?.some(i => i.id === itemId));
          const item = sec?.items?.find(i => i.id === itemId);
          const resp = responseIndex[itemId]?.[currentUserId];
          onFindingRaise?.({ snapshotId: snapshot.id, templateItemId: itemId, criterion: item?.criterion || '', verdict, comment: resp?.comment || '', responseId: resp?.id || null });
        });
      }
    } else {
      raiseBtn?.remove();
    }
  }

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
          session_id: session.id, snapshot_id: snapshot.id,
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

  async function saveArtifactVerdict(verdict, comment) {
    const { data, error } = await sb.from('review_artifact_verdicts')
      .upsert({
        session_id: session.id, snapshot_id: snapshot.id,
        reviewer_id: currentUserId, verdict,
        verdict_comment: comment,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'snapshot_id,reviewer_id' })
      .select().single();
    if (!error && data) onVerdictSaved?.({ verdict, comment });
  }

  function openDiffModal() {
    const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
    const table = tableMap[snapshot.artifact_type];
    if (!table) return;
    sb.from(table).select('*').eq('id', snapshot.artifact_id).single().then(({ data: live }) => {
      if (!live) return;
      showDiffModal(snapshot.snapshot_data, live);
    });
  }

  function showDiffModal(frozen, live) {
    document.querySelector('.rvck-diff-overlay')?.remove();
    const allKeys     = new Set([...Object.keys(frozen), ...Object.keys(live)]);
    const skipKeys    = new Set(['id','created_at','updated_at','project_id','parent_id','parent_type']);
    const relevantKeys = [...allKeys].filter(k => !skipKeys.has(k));
    const rows = relevantKeys.map(k => {
      const a = String(frozen[k] ?? '—'); const b = String(live[k] ?? '—');
      const changed = a !== b;
      return `<tr class="${changed ? 'rvck-diff-changed' : ''}">
        <td class="rvck-diff-key">${escHtml(k)}</td>
        <td class="rvck-diff-old">${escHtml(a)}</td>
        <td class="rvck-diff-new">${changed ? `<strong>${escHtml(b)}</strong>` : escHtml(b)}</td></tr>`;
    }).join('');
    const overlay = document.createElement('div');
    overlay.className = 'rvck-diff-overlay';
    overlay.innerHTML = `
      <div class="rvck-diff-modal">
        <div class="rvck-diff-header"><strong>Compare: Snapshot vs Current Version</strong>
          <button class="btn btn-ghost btn-sm rvck-diff-close">✕</button></div>
        <table class="rvck-diff-table">
          <thead><tr><th>Field</th><th>Snapshot (frozen)</th><th>Current</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.rvck-diff-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  }

  // Expose method to inject a newly raised finding into the correct slot
  container._addFinding = function(finding) {
    const key = finding.template_item_id || '__open__';
    if (!findingsByItem[key]) findingsByItem[key] = [];
    findingsByItem[key].push(finding);

    if (finding.template_item_id) {
      const slot = container.querySelector(`#rvck-item-findings-${finding.template_item_id}`);
      if (slot) { slot.insertAdjacentHTML('beforeend', renderInlineFinding(finding)); wireInlineTransitions(container); wireInlineReplies(container); }
    } else {
      _openPointsCollapsed = false;
      const body    = container.querySelector('#rvck-op-body');
      const chevron = container.querySelector('#rvck-op-toggle .rvck-sec-chevron');
      if (body)    { body.style.display = ''; body.innerHTML = renderOpenPointsList(); wireInlineTransitions(container); wireInlineReplies(container); }
      if (chevron) chevron.textContent = '▼';
      // Update badge
      const badge = container.querySelector('#rvck-open-points .rvck-sec-badge');
      if (badge) badge.textContent = (findingsByItem['__open__'] || []).length;
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
