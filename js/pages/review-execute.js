/**
 * Review Execute — 3-tab execution view.
 *
 * Tab 1 – Checklist:       split panel (artifact list left + template checklist right)
 * Tab 2 – Findings:        finding cards with status lifecycle + reviewer↔author comment threads
 * Tab 3 – Artifact Review: every artifact — reviewer marks OK/NOK/Partially OK + author comment
 *
 * Route: /project/:projectId/item/:itemId/reviews/:sessionId/execute
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { showModal, hideModal } from '../components/modal.js';
import { toast } from '../toast.js';
import { mountReviewChecklist } from '../components/review-checklist.js';

const SESSION_STATUS_CLASSES = {
  planned:'badge-draft', in_progress:'badge-review', completed:'badge-approved', cancelled:'badge-deprecated',
};
const SESSION_STATUS_LABELS = {
  planned:'Planned', in_progress:'In Progress', completed:'Completed', cancelled:'Cancelled',
};
const SEVERITY_LABELS  = { critical:'Critical', major:'Major', minor:'Minor', observation:'Observation' };
const SEVERITY_CLASSES = { critical:'rv-sev-critical', major:'rv-sev-major', minor:'rv-sev-minor', observation:'rv-sev-observation' };
const VERDICT_LABELS   = { ok:'OK', nok:'NOK', partially_ok:'Partially OK' };

const FINDING_STATUS_LABELS = {
  open:'Open', accepted:'Accepted', in_progress:'In Progress', deferred:'Deferred',
  fixed:'Fixed', verified:'Verified', closed:'Closed', duplicate:'Duplicate', rejected:'Rejected',
};
const FINDING_STATUS_CLASSES = {
  open:'rv-fs-open', accepted:'rv-fs-accepted', in_progress:'rv-fs-in-progress',
  deferred:'rv-fs-deferred', fixed:'rv-fs-fixed', verified:'rv-fs-verified',
  closed:'rv-fs-closed', duplicate:'rv-fs-closed', rejected:'rv-fs-closed',
};

// ASPICE MAN.5 valid transitions
const TRANSITIONS = {
  open:        ['accepted', 'rejected', 'duplicate'],
  accepted:    ['in_progress', 'deferred', 'rejected'],
  in_progress: ['fixed', 'deferred'],
  deferred:    ['in_progress', 'rejected'],
  fixed:       ['verified', 'in_progress'],
  verified:    ['closed', 'in_progress'],
  closed:      [], duplicate:[], rejected:[],
};

// Human-readable transition button labels
const TRANSITION_LABELS = {
  accepted:    '✓ Accept',
  in_progress: '▶ Start',
  deferred:    '⏸ Defer',
  fixed:       '✔ Mark Fixed',
  verified:    '★ Verify',
  closed:      '✓ Close',
  rejected:    '✕ Reject',
  duplicate:   '⊘ Duplicate',
};

export async function renderReviewExecute(container, ctx) {
  const { project, item, sessionId } = ctx;
  const base = `/project/${project.id}/item/${item.id}`;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `${base}/vcycle/item_definition` },
    { label: 'Reviews', path: `${base}/reviews` },
    { label: 'Execute' },
  ]);

  container.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

  // Load everything in parallel
  const [
    { data: session },
    { data: snapshots },
    { data: reviewers },
    { data: allResponses },
    { data: findings },
    { data: artifactVerdicts },
  ] = await Promise.all([
    sb.from('review_sessions').select('*, review_protocol_templates(id,name,artifact_type,review_type)').eq('id', sessionId).single(),
    sb.from('review_artifact_snapshots').select('*').eq('session_id', sessionId).eq('is_current', true).order('snapshotted_at'),
    sb.from('review_session_reviewers').select('*, user_profiles(display_name)').eq('session_id', sessionId),
    sb.from('review_checklist_responses').select('*').eq('session_id', sessionId),
    sb.from('review_findings').select('*').eq('session_id', sessionId).order('created_at'),
    sb.from('review_artifact_verdicts').select('*').eq('session_id', sessionId),
  ]);

  if (!session) { container.innerHTML = `<p style="padding:40px">Session not found.</p>`; return; }

  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  const reviewerList = (reviewers || []).map(r => ({
    user_id:      r.user_id,
    role:         r.role,
    display_name: r.user_profiles?.display_name || r.user_id?.slice(0, 8),
  }));

  // Load template sections + items
  let sections = [];
  if (session.template_id) {
    const { data: secs } = await sb.from('review_template_sections')
      .select('*').eq('template_id', session.template_id).order('sort_order');
    if (secs?.length) {
      const { data: items } = await sb.from('review_template_items')
        .select('*').eq('template_id', session.template_id).order('sort_order');
      const itemsBySec = {};
      (items || []).forEach(i => {
        if (!itemsBySec[i.section_id]) itemsBySec[i.section_id] = [];
        itemsBySec[i.section_id].push(i);
      });
      sections = secs.map(s => ({ ...s, items: itemsBySec[s.id] || [] }));
    }
  }

  // Load finding comments (all at once for the session)
  let allComments = [];
  if (findings?.length) {
    const findingIds = findings.map(f => f.id);
    const { data: comments } = await sb.from('review_finding_comments')
      .select('*, user_profiles(display_name)')
      .in('finding_id', findingIds)
      .order('created_at');
    allComments = comments || [];
  }

  // Load user display name for current user
  const { data: currentProfile } = await sb.from('user_profiles').select('display_name').eq('id', currentUserId).single();
  const currentDisplayName = currentProfile?.display_name || currentUserId?.slice(0, 8) || 'Me';

  const driftMap = await detectDrift(snapshots || []);

  // Local mutable arrays
  const _findings         = findings         ? [...findings]         : [];
  const _artifactVerdicts = artifactVerdicts ? [...artifactVerdicts] : [];
  const _comments         = [...allComments];

  let _selectedSnapshot = snapshots?.[0] || null;
  let _activeTab        = 'checklist';

  renderPage();

  // ── Main render ──────────────────────────────────────────────────────────────

  function renderPage() {
    container.innerHTML = `
      <div class="rve-wrap">
        <div class="rve-topbar">
          <div class="rve-topbar-left">
            <span class="rve-session-title">${escHtml(session.title)}</span>
            <span class="badge ${SESSION_STATUS_CLASSES[session.status] || 'badge-draft'}">${SESSION_STATUS_LABELS[session.status] || session.status}</span>
            ${session.review_protocol_templates ? `<span class="rve-tpl-tag">${escHtml(session.review_protocol_templates.name)}</span>` : ''}
          </div>
          <div class="rve-topbar-right">
            ${session.status === 'in_progress' ? `<button class="btn btn-primary btn-sm" id="rve-btn-complete">✓ Complete Review</button>` : ''}
          </div>
        </div>

        <div class="rve-main-tabs">
          <button class="rve-main-tab ${_activeTab === 'checklist'       ? 'active' : ''}" data-tab="checklist">
            📋 Checklist
            <span class="rve-main-tab-count">${checklistProgress()}</span>
          </button>
          <button class="rve-main-tab ${_activeTab === 'findings'        ? 'active' : ''}" data-tab="findings">
            ⚑ Findings
            ${_findings.filter(f => f.status === 'open').length ? `<span class="rve-main-tab-badge">${_findings.filter(f => f.status === 'open').length}</span>` : ''}
          </button>
          <button class="rve-main-tab ${_activeTab === 'artifact-review' ? 'active' : ''}" data-tab="artifact-review">
            ✓ Artifact Review
            <span class="rve-main-tab-count">${artifactReviewProgress()}</span>
          </button>
        </div>

        <div class="rve-tab-body" id="rve-tab-body">
          ${renderActiveTab()}
        </div>
      </div>
    `;

    document.getElementById('rve-btn-complete')?.addEventListener('click', completeSession);

    container.querySelectorAll('.rve-main-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        container.querySelectorAll('.rve-main-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
        document.getElementById('rve-tab-body').innerHTML = renderActiveTab();
        wireActiveTab();
      });
    });

    wireActiveTab();
  }

  function renderActiveTab() {
    if (_activeTab === 'checklist')       return renderChecklistTab();
    if (_activeTab === 'findings')        return renderFindingsTab();
    if (_activeTab === 'artifact-review') return renderArtifactReviewTab();
    return '';
  }

  function wireActiveTab() {
    if (_activeTab === 'checklist')       wireChecklistTab();
    if (_activeTab === 'findings')        wireFindingsTab();
    if (_activeTab === 'artifact-review') wireArtifactReviewTab();
  }

  // ── Progress helpers ─────────────────────────────────────────────────────────

  function checklistProgress() {
    const totalItems = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
    if (!totalItems) return '';
    const done = new Set(
      (allResponses || []).filter(r => r.reviewer_id === currentUserId).map(r => r.snapshot_id + ':' + r.template_item_id)
    ).size;
    return `${done}/${totalItems * (snapshots?.length || 1)}`;
  }

  function artifactReviewProgress() {
    const total = snapshots?.length || 0;
    if (!total) return '';
    const done = _artifactVerdicts.filter(v => v.reviewer_id === currentUserId).length;
    return `${done}/${total}`;
  }

  function updateFindingsBadge() {
    const tab = container.querySelector('[data-tab="findings"]');
    if (!tab) return;
    const openCount = _findings.filter(f => f.status === 'open').length;
    let badge = tab.querySelector('.rve-main-tab-badge');
    if (openCount > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'rve-main-tab-badge'; tab.appendChild(badge); }
      badge.textContent = openCount;
    } else {
      badge?.remove();
    }
  }

  // ── Tab 1: Checklist ─────────────────────────────────────────────────────────

  function renderChecklistTab() {
    return `
      <div class="rve-body">
        <div class="rve-artifact-list" id="rve-artifact-list">
          ${(snapshots || []).map(snap => renderArtifactCard(snap)).join('')}
          ${!snapshots?.length ? '<p class="rv-empty" style="padding:16px">No artifacts in this session.</p>' : ''}
        </div>
        <div class="rve-checklist-panel" id="rve-checklist-panel">
          ${_selectedSnapshot ? '' : '<div class="rve-checklist-empty">Select an artifact to start reviewing.</div>'}
        </div>
      </div>
    `;
  }

  function wireChecklistTab() {
    container.querySelectorAll('.rve-art-card').forEach(card => {
      card.addEventListener('click', () => {
        const snapId = card.dataset.snapId;
        _selectedSnapshot = (snapshots || []).find(s => s.id === snapId);
        container.querySelectorAll('.rve-art-card').forEach(c => c.classList.toggle('active', c.dataset.snapId === snapId));
        loadChecklist();
      });
    });
    if (_selectedSnapshot) {
      container.querySelector(`[data-snap-id="${_selectedSnapshot.id}"]`)?.classList.add('active');
      loadChecklist();
    }
  }

  function renderArtifactCard(snap) {
    const snapResponses = (allResponses || []).filter(r => r.snapshot_id === snap.id);
    const totalItems    = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
    const myResponses   = snapResponses.filter(r => r.reviewer_id === currentUserId);
    const okCount       = myResponses.filter(r => r.verdict === 'ok').length;
    const nokCount      = myResponses.filter(r => r.verdict === 'nok' || r.verdict === 'partially_ok').length;
    const naCount       = myResponses.filter(r => r.verdict === 'na').length;
    const doneCount     = myResponses.length;
    const drifted       = driftMap[snap.artifact_id];
    const pct           = totalItems ? Math.round(doneCount / totalItems * 100) : 0;

    return `
      <div class="rve-art-card" data-snap-id="${snap.id}">
        <div class="rve-art-card-header">
          <span class="rve-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          ${drifted ? `<span class="rve-drift-badge" title="Artifact changed since snapshot">⚠</span>` : ''}
        </div>
        <div class="rve-art-title">${escHtml(snap.artifact_title || '—')}</div>
        ${totalItems ? `
          <div class="rve-progress-bar"><div class="rve-progress-fill" style="width:${pct}%"></div></div>
          <div class="rve-art-counts">
            <span class="rv-v-ok">${okCount} OK</span>
            <span class="rv-v-nok">${nokCount} ⚑</span>
            <span class="rv-v-na">${naCount} N/A</span>
            <span class="text-muted">${doneCount}/${totalItems}</span>
          </div>` : '<span class="text-muted" style="font-size:11px">No checklist</span>'}
      </div>
    `;
  }

  function loadChecklist() {
    const panel = document.getElementById('rve-checklist-panel');
    if (!_selectedSnapshot || !panel) return;
    const snap          = _selectedSnapshot;
    const snapResponses = (allResponses || []).filter(r => r.snapshot_id === snap.id);
    const snapFindings  = _findings.filter(f => f.snapshot_id === snap.id);
    mountReviewChecklist(panel, {
      session, snapshot: snap, sections, allResponses: snapResponses,
      currentUserId, reviewers: reviewerList, findings: snapFindings,
      isDrifted: !!driftMap[snap.artifact_id],
      onSaved: ({ itemId, verdict }) => {
        const existing = allResponses?.find(r => r.snapshot_id === snap.id && r.template_item_id === itemId && r.reviewer_id === currentUserId);
        if (existing) existing.verdict = verdict;
        else allResponses?.push({ snapshot_id: snap.id, template_item_id: itemId, reviewer_id: currentUserId, verdict, session_id: sessionId });
        refreshArtifactCard(snap);
      },
      onFindingRaise: opts => openRaiseFindingModal(opts),
      onReSnapshotRequest: async () => reSnapshot(snap),
    });
  }

  // ── Tab 2: Findings ──────────────────────────────────────────────────────────

  function renderFindingsTab() {
    const snapMap = {};
    (snapshots || []).forEach(s => { snapMap[s.id] = s; });

    const openCount   = _findings.filter(f => f.status === 'open').length;
    const activeCount = _findings.filter(f => ['accepted','in_progress','deferred'].includes(f.status)).length;
    const doneCount   = _findings.filter(f => ['fixed','verified','closed','rejected','duplicate'].includes(f.status)).length;

    return `
      <div class="rve-findings-wrap">
        <div class="rve-findings-header">
          <div class="rve-findings-stats">
            <span class="rv-fs-open rve-stat-pill">${openCount} Open</span>
            <span class="rv-fs-in-progress rve-stat-pill">${activeCount} Active</span>
            <span class="rv-fs-closed rve-stat-pill">${doneCount} Done</span>
          </div>
          <button class="btn btn-primary btn-sm" id="rve-raise-general">⚑ Add Finding</button>
        </div>

        ${!_findings.length
          ? `<div class="rv-empty" style="padding:40px 0"><p>No findings yet. Raise findings from the Checklist tab or add one here.</p></div>`
          : _findings.map(f => renderFindingCard(f, snapMap)).join('')
        }
      </div>
    `;
  }

  function renderFindingCard(f, snapMap) {
    const snap        = f.snapshot_id ? snapMap[f.snapshot_id] : null;
    const transitions = TRANSITIONS[f.status] || [];
    const comments    = _comments.filter(c => c.finding_id === f.id);
    const isTerminal  = transitions.length === 0;

    return `
      <div class="rve-fcard" data-finding-id="${f.id}">
        <div class="rve-fcard-header">
          <div class="rve-fcard-meta">
            <span class="rve-fcard-code mono">${escHtml(f.finding_code)}</span>
            <span class="badge ${SEVERITY_CLASSES[f.severity] || ''}">${SEVERITY_LABELS[f.severity] || f.severity}</span>
            ${snap ? `<span class="rv-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>` : '<span class="text-muted" style="font-size:11px">General</span>'}
          </div>
          <span class="badge ${FINDING_STATUS_CLASSES[f.status] || ''}">${FINDING_STATUS_LABELS[f.status] || f.status}</span>
        </div>

        <div class="rve-fcard-title">${escHtml(f.title)}</div>
        ${f.description ? `<div class="rve-fcard-desc text-muted">${escHtml(f.description)}</div>` : ''}
        ${f.due_date ? `<div class="rve-fcard-due text-muted">Due: ${escHtml(f.due_date)}</div>` : ''}

        ${!isTerminal ? `
          <div class="rve-fcard-transitions">
            ${transitions.map(to => `
              <button class="btn btn-sm rve-fcard-trans-btn rve-trans-${to}" data-finding-id="${f.id}" data-to="${to}">
                ${TRANSITION_LABELS[to] || FINDING_STATUS_LABELS[to]}
              </button>`).join('')}
          </div>` : ''}

        <div class="rve-fcard-thread" id="rve-thread-${f.id}">
          ${comments.map(c => renderComment(c)).join('')}
        </div>

        <div class="rve-fcard-reply">
          <textarea class="form-input rve-fcard-reply-input" data-finding-id="${f.id}"
            rows="2" placeholder="Write a comment…"></textarea>
          <button class="btn btn-secondary btn-sm rve-fcard-reply-btn" data-finding-id="${f.id}">Reply</button>
        </div>
      </div>
    `;
  }

  function renderComment(c) {
    const name = c.user_profiles?.display_name || c.author_id?.slice(0, 8) || '?';
    const dt   = formatDateTime(c.created_at);
    return `
      <div class="rve-fcard-comment">
        <span class="rve-fcard-comment-author">${escHtml(name)}, ${escHtml(dt)}:</span>
        <span class="rve-fcard-comment-text"> ${escHtml(c.comment)}</span>
      </div>
    `;
  }

  function wireFindingsTab() {
    const snapMap = {};
    (snapshots || []).forEach(s => { snapMap[s.id] = s; });

    document.getElementById('rve-raise-general')?.addEventListener('click', () => {
      openRaiseFindingModal({ snapshotId: null, templateItemId: null, criterion: '', verdict: '', comment: '', responseId: null });
    });

    // Status transitions
    container.querySelectorAll('.rve-fcard-trans-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const findingId = btn.dataset.findingId;
        const toStatus  = btn.dataset.to;
        const f = _findings.find(x => x.id === findingId);
        if (!f) return;

        btn.disabled = true;
        const { error } = await sb.from('review_findings').update({
          status: toStatus, updated_at: new Date().toISOString(),
        }).eq('id', findingId);
        if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
        f.status = toStatus;
        toast(`Finding ${f.finding_code}: ${FINDING_STATUS_LABELS[toStatus]}`, 'success');

        // Re-render just this card
        const card = container.querySelector(`.rve-fcard[data-finding-id="${findingId}"]`);
        if (card) {
          card.outerHTML = renderFindingCard(f, snapMap);
          wireFindingCard(findingId, snapMap);
        }
        updateFindingsBadge();
      });
    });

    // Reply buttons
    container.querySelectorAll('.rve-fcard-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => postComment(btn.dataset.findingId, snapMap));
    });

    // Ctrl+Enter in textarea
    container.querySelectorAll('.rve-fcard-reply-input').forEach(ta => {
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          postComment(ta.dataset.findingId, snapMap);
        }
      });
    });
  }

  // Wire only one re-rendered card (after status transition replaces its HTML)
  function wireFindingCard(findingId, snapMap) {
    const card = container.querySelector(`.rve-fcard[data-finding-id="${findingId}"]`);
    if (!card) return;

    card.querySelectorAll('.rve-fcard-trans-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const toStatus = btn.dataset.to;
        const f = _findings.find(x => x.id === findingId);
        if (!f) return;
        btn.disabled = true;
        const { error } = await sb.from('review_findings').update({ status: toStatus, updated_at: new Date().toISOString() }).eq('id', findingId);
        if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
        f.status = toStatus;
        toast(`Finding ${f.finding_code}: ${FINDING_STATUS_LABELS[toStatus]}`, 'success');
        card.outerHTML = renderFindingCard(f, snapMap);
        wireFindingCard(findingId, snapMap);
        updateFindingsBadge();
      });
    });

    card.querySelectorAll('.rve-fcard-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => postComment(findingId, snapMap));
    });
    card.querySelectorAll('.rve-fcard-reply-input').forEach(ta => {
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postComment(findingId, snapMap); }
      });
    });
  }

  async function postComment(findingId, snapMap) {
    const ta = container.querySelector(`.rve-fcard-reply-input[data-finding-id="${findingId}"]`);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }

    const btn = container.querySelector(`.rve-fcard-reply-btn[data-finding-id="${findingId}"]`);
    if (btn) btn.disabled = true;

    const { data: comment, error } = await sb.from('review_finding_comments').insert({
      finding_id: findingId,
      author_id:  currentUserId,
      comment:    text,
    }).select('*, user_profiles(display_name)').single();

    if (btn) btn.disabled = false;
    if (error) { toast('Error posting comment: ' + error.message, 'error'); return; }

    _comments.push(comment);
    ta.value = '';

    // Append the new comment to the thread without full re-render
    const thread = container.querySelector(`#rve-thread-${findingId}`);
    if (thread) {
      thread.insertAdjacentHTML('beforeend', renderComment(comment));
      thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ── Tab 3: Artifact Review ───────────────────────────────────────────────────

  function renderArtifactReviewTab() {
    if (!snapshots?.length) return `<div class="rv-empty" style="padding:40px 0">No artifacts in this session.</div>`;

    return `
      <div class="rve-artrev-wrap">
        <p class="rve-artrev-subtitle text-muted">
          Mark each artifact with your overall verdict and leave a comment for the author.
          All reviewers' verdicts are shown; only yours is editable.
        </p>
        <table class="data-table rve-artrev-table">
          <thead>
            <tr>
              <th>Artifact</th>
              <th>Title</th>
              <th>Other Reviewers</th>
              <th style="width:220px">Your Verdict</th>
              <th>Comment for Author</th>
            </tr>
          </thead>
          <tbody>
            ${(snapshots || []).map(snap => renderArtifactReviewRow(snap)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderArtifactReviewRow(snap) {
    const myVerdict = _artifactVerdicts.find(v => v.snapshot_id === snap.id && v.reviewer_id === currentUserId);
    const mv = myVerdict?.verdict || '';
    const mc = myVerdict?.comment || '';

    const otherPills = reviewerList
      .filter(r => r.user_id !== currentUserId)
      .map(r => {
        const v = _artifactVerdicts.find(x => x.snapshot_id === snap.id && x.reviewer_id === r.user_id);
        if (!v) return `<span class="rvck-rv-pill rvck-rv-pending" title="${escHtml(r.display_name)}: pending">${escHtml(r.display_name.charAt(0))}: —</span>`;
        return `<span class="rvck-rv-pill ${v.verdict}" title="${escHtml(r.display_name)}: ${VERDICT_LABELS[v.verdict]}">${escHtml(r.display_name.charAt(0))}: ${VERDICT_LABELS[v.verdict]}</span>`;
      }).join('');

    return `
      <tr class="rve-artrev-row" data-snap-id="${snap.id}">
        <td>
          <span class="rve-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          ${driftMap[snap.artifact_id] ? `<span class="rve-drift-badge" title="Changed since snapshot"> ⚠</span>` : ''}
        </td>
        <td style="font-size:12px">${escHtml(snap.artifact_title || '—')}</td>
        <td>${otherPills || '<span class="text-muted" style="font-size:11px">—</span>'}</td>
        <td>
          <div class="rve-artrev-verdict-btns">
            ${['ok','nok','partially_ok'].map(v => `
              <button class="rve-artrev-vbtn ${mv === v ? 'active sel-' + v : ''}"
                      data-snap-id="${snap.id}" data-verdict="${v}" title="${VERDICT_LABELS[v]}">
                ${VERDICT_LABELS[v]}
              </button>`).join('')}
          </div>
        </td>
        <td>
          <textarea class="form-input rve-artrev-comment" data-snap-id="${snap.id}"
            rows="2" placeholder="Comment for the author…">${escHtml(mc)}</textarea>
        </td>
      </tr>
    `;
  }

  function wireArtifactReviewTab() {
    container.querySelectorAll('.rve-artrev-vbtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const snapId  = btn.dataset.snapId;
        const verdict = btn.dataset.verdict;
        const row     = container.querySelector(`.rve-artrev-row[data-snap-id="${snapId}"]`);
        const comment = row?.querySelector('.rve-artrev-comment')?.value?.trim() || '';

        row?.querySelectorAll('.rve-artrev-vbtn').forEach(b => b.classList.remove('active','sel-ok','sel-nok','sel-partially_ok'));
        btn.classList.add('active', `sel-${verdict}`);

        await saveArtifactVerdict(snapId, verdict, comment);
      });
    });

    container.querySelectorAll('.rve-artrev-comment').forEach(ta => {
      ta.addEventListener('input', debounce(async () => {
        const snapId  = ta.dataset.snapId;
        const existing = _artifactVerdicts.find(v => v.snapshot_id === snapId && v.reviewer_id === currentUserId);
        if (!existing?.verdict) return;
        await saveArtifactVerdict(snapId, existing.verdict, ta.value.trim());
      }, 600));
    });
  }

  async function saveArtifactVerdict(snapId, verdict, comment) {
    const payload = { session_id: sessionId, snapshot_id: snapId, reviewer_id: currentUserId, verdict, comment, updated_at: new Date().toISOString() };
    const { data, error } = await sb.from('review_artifact_verdicts')
      .upsert(payload, { onConflict: 'snapshot_id,reviewer_id' }).select().single();
    if (error) { toast('Error saving verdict: ' + error.message, 'error'); return; }
    const existing = _artifactVerdicts.find(v => v.snapshot_id === snapId && v.reviewer_id === currentUserId);
    if (existing) Object.assign(existing, data);
    else _artifactVerdicts.push(data);
    const tab = container.querySelector('[data-tab="artifact-review"] .rve-main-tab-count');
    if (tab) tab.textContent = artifactReviewProgress();
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  function refreshArtifactCard(snap) {
    const card = container.querySelector(`[data-snap-id="${snap.id}"].rve-art-card`);
    if (!card) return;
    card.outerHTML = renderArtifactCard(snap);
    container.querySelectorAll('.rve-art-card').forEach(c => {
      c.addEventListener('click', () => {
        _selectedSnapshot = (snapshots || []).find(s => s.id === c.dataset.snapId);
        container.querySelectorAll('.rve-art-card').forEach(x => x.classList.toggle('active', x.dataset.snapId === c.dataset.snapId));
        loadChecklist();
      });
      if (c.dataset.snapId === snap.id) c.classList.add('active');
    });
  }

  function openRaiseFindingModal({ snapshotId, templateItemId, criterion, verdict, comment, responseId }) {
    showModal({
      title: '⚑ Raise Finding',
      body: `
        <div class="form-grid cols-1">
          ${criterion ? `<div class="form-group"><label class="form-label">Criterion</label><p class="form-hint">${escHtml(criterion)}</p></div>` : ''}
          ${!snapshotId ? `
            <div class="form-group">
              <label class="form-label">Artifact</label>
              <select class="form-input form-select" id="fnd-snap">
                <option value="">— General (not tied to an artifact) —</option>
                ${(snapshots || []).map(s => `<option value="${s.id}">${escHtml(s.artifact_code || s.artifact_type)} – ${escHtml(s.artifact_title || '')}</option>`).join('')}
              </select>
            </div>` : ''}
          <div class="form-group">
            <label class="form-label">Finding Title *</label>
            <input class="form-input" id="fnd-title" placeholder="Short description of the issue"/>
          </div>
          <div class="form-group">
            <label class="form-label">Severity</label>
            <select class="form-input form-select" id="fnd-severity">
              ${Object.entries(SEVERITY_LABELS).map(([v, l]) => `<option value="${v}" ${v === 'major' ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-input" id="fnd-desc" rows="3" placeholder="Detailed description…">${escHtml(comment)}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Due Date</label>
            <input type="date" class="form-input" id="fnd-due"/>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" id="fnd-cancel">Cancel</button>
        <button class="btn btn-primary" id="fnd-save">⚑ Raise Finding</button>`,
    });

    document.getElementById('fnd-cancel').onclick = hideModal;
    document.getElementById('fnd-save').onclick = async () => {
      const title = document.getElementById('fnd-title').value.trim();
      if (!title) { document.getElementById('fnd-title').focus(); return; }
      const btn = document.getElementById('fnd-save');
      btn.disabled = true;

      const resolvedSnapshotId = snapshotId || document.getElementById('fnd-snap')?.value || null;
      const { count } = await sb.from('review_findings').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
      const finding_code = `FND-${String((count || 0) + 1).padStart(3, '0')}`;

      const { data: finding, error } = await sb.from('review_findings').insert({
        session_id:  sessionId,
        snapshot_id: resolvedSnapshotId || null,
        response_id: responseId || null,
        finding_code,
        title,
        severity:    document.getElementById('fnd-severity').value,
        description: document.getElementById('fnd-desc').value.trim(),
        due_date:    document.getElementById('fnd-due').value || null,
        status:      'open',
        created_by:  currentUserId,
      }).select().single();

      if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
      _findings.push(finding);
      toast(`Finding ${finding_code} raised.`, 'success');
      hideModal();

      if (_activeTab === 'checklist') loadChecklist();
      if (_activeTab === 'findings') {
        document.getElementById('rve-tab-body').innerHTML = renderFindingsTab();
        wireFindingsTab();
      }
      updateFindingsBadge();
    };
    document.getElementById('fnd-title').focus();
  }

  async function completeSession() {
    if (!confirm('Mark this review session as completed? This cannot be undone.')) return;
    const { error } = await sb.from('review_sessions').update({
      status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    toast('Review session completed.', 'success');
    session.status = 'completed';
    renderPage();
  }

  async function reSnapshot(snap) {
    const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
    const table = tableMap[snap.artifact_type];
    if (!table) return;
    const { data: live } = await sb.from(table).select('*').eq('id', snap.artifact_id).single();
    if (!live) return;

    await sb.from('review_artifact_snapshots').update({ is_current: false }).eq('id', snap.id);
    await sb.from('review_checklist_responses').update({ is_stale: true }).eq('snapshot_id', snap.id);

    const { data: newSnap } = await sb.from('review_artifact_snapshots').insert({
      session_id:          sessionId,
      artifact_type:       snap.artifact_type,
      artifact_id:         snap.artifact_id,
      artifact_code:       snap.artifact_code,
      artifact_title:      live.title || live.name || snap.artifact_title,
      snapshot_data:       live,
      artifact_updated_at: live.updated_at,
      is_current:          true,
    }).select().single();

    if (newSnap) {
      const idx = snapshots?.findIndex(s => s.id === snap.id);
      if (idx !== undefined && idx >= 0) snapshots.splice(idx, 1, newSnap);
      _selectedSnapshot = newSnap;
      delete driftMap[snap.artifact_id];
      toast('Snapshot updated.', 'success');
      renderPage();
    }
  }
}

async function detectDrift(snapshots) {
  const driftMap = {};
  if (!snapshots.length) return driftMap;
  const byType = {};
  snapshots.forEach(s => {
    if (!byType[s.artifact_type]) byType[s.artifact_type] = [];
    byType[s.artifact_type].push(s);
  });
  const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
  await Promise.all(Object.entries(byType).map(async ([type, snaps]) => {
    const table = tableMap[type];
    if (!table) return;
    const ids = snaps.map(s => s.artifact_id);
    const { data: liveRows } = await sb.from(table).select('id, updated_at').in('id', ids);
    (liveRows || []).forEach(live => {
      const snap = snaps.find(s => s.artifact_id === live.id);
      if (snap && snap.artifact_updated_at && live.updated_at > snap.artifact_updated_at) driftMap[live.id] = true;
    });
  }));
  return driftMap;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
