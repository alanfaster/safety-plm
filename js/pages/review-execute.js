/**
 * Review Execute — 2-tab execution view.
 *
 * Tab 1 – Review:    split panel. Left: artifact list with GO/NO-GO status.
 *                    Right: per-artifact panel (checklist accordion + open points + verdict stamp).
 * Tab 2 – Findings:  session-level findings management — all findings cross-artifact,
 *                    comment threads, status lifecycle.
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


const FINAL_VERDICT_LABELS  = { go:'GO', conditional:'Conditional', no_go:'NO-GO' };
const FINAL_VERDICT_CLASSES = { go:'rve-artcard-go', conditional:'rve-artcard-conditional', no_go:'rve-artcard-nogo' };

const ARTIFACT_DISPLAY_FIELDS = {
  requirements:         ['req_code','title','description','type','status','priority','asil','dal'],
  arch_spec_items:      ['spec_code','title','type','status'],
  test_specs:           ['test_code','name','description','level','status','method'],
  safety_analysis_rows: ['analysis_code','title','analysis_type','status'],
};

function openDiffModal(snap) {
  const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
  const table = tableMap[snap.artifact_type];
  if (!table) return;
  import('../config.js').then(({ sb }) => {
    sb.from(table).select('*').eq('id', snap.artifact_id).single().then(({ data: live }) => {
      if (!live) return;
      showDiffModal(snap.snapshot_data, live, snap);
    });
  });
}

function showDiffModal(frozen, live, snap) {
  document.querySelector('.rvck-diff-overlay')?.remove();
  const allKeys = new Set([...Object.keys(frozen), ...Object.keys(live)]);
  const skipKeys = new Set(['id','created_at','updated_at','project_id','parent_id','parent_type']);
  const rows = [...allKeys].filter(k => !skipKeys.has(k)).map(k => {
    const a = String(frozen[k] ?? '—'); const b = String(live[k] ?? '—');
    const changed = a !== b;
    return `<tr class="${changed ? 'rvck-diff-changed' : ''}">
      <td class="rvck-diff-key">${escHtml(k)}</td>
      <td class="rvck-diff-old">${escHtml(a)}</td>
      <td class="rvck-diff-new">${changed ? `<strong>${escHtml(b)}</strong>` : escHtml(b)}</td></tr>`;
  }).join('');
  const overlay = document.createElement('div');
  overlay.className = 'rvck-diff-overlay';
  overlay.innerHTML = `<div class="rvck-diff-modal">
    <div class="rvck-diff-header"><strong>Compare: Snapshot v${snap.artifact_version ?? '?'} vs Current</strong>
      <button class="btn btn-ghost btn-sm rvck-diff-close">✕</button></div>
    <table class="rvck-diff-table">
      <thead><tr><th>Field</th><th>Snapshot</th><th>Current</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.rvck-diff-close').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
}

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

  // Template sections + items
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

  const driftMap = await detectDrift(snapshots || []);

  // Mutable local state
  const _findings         = findings         ? [...findings]         : [];
  const _artifactVerdicts = artifactVerdicts ? [...artifactVerdicts] : [];
  const _allResponses     = allResponses      ? [...allResponses]     : [];

  let _selectedSnapshot = snapshots?.[0] || null;

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
            ${session.checklist_mode === 'shared' ? `<span class="rve-tpl-tag" title="One checklist shared across all artifacts">⇔ Shared checklist</span>` : ''}
          </div>
          <div class="rve-topbar-right">
            ${session.status === 'in_progress' ? `<button class="btn btn-primary btn-sm" id="rve-btn-complete">✓ Complete Review</button>` : ''}
          </div>
        </div>
        <div class="rve-tab-body" id="rve-tab-body">${renderReviewTab()}</div>
      </div>
    `;

    document.getElementById('rve-btn-complete')?.addEventListener('click', completeSession);
    wireReviewTab();
  }

  // ── Tab 1: Review (3-column layout) ──────────────────────────────────────────

  function renderReviewTab() {
    return `
      <div class="rve-body">
        <div class="rve-artifact-list" id="rve-artifact-list">
          ${(snapshots || []).map(snap => renderArtifactCard(snap)).join('')}
          ${!snapshots?.length ? '<p class="rv-empty" style="padding:16px">No artifacts in this session.</p>' : ''}
        </div>
        <div class="rve-checklist-col" id="rve-checklist-col">
          ${sections.length ? '' : '<div class="rve-checklist-empty text-muted" style="padding:24px;text-align:center">No checklist template attached to this session.</div>'}
        </div>
        <div class="rve-props-panel" id="rve-props-panel">
          <div class="rve-props-placeholder text-muted">Select an artifact to view its properties.</div>
        </div>
      </div>
    `;
  }

  function wireReviewTab() {
    container.querySelectorAll('.rve-art-card').forEach(card => {
      card.addEventListener('click', () => {
        const snapId = card.dataset.snapId;
        _selectedSnapshot = (snapshots || []).find(s => s.id === snapId);
        container.querySelectorAll('.rve-art-card').forEach(c => c.classList.toggle('active', c.dataset.snapId === snapId));
        loadArtifactPanel();
      });
    });
    if (_selectedSnapshot) {
      container.querySelector(`[data-snap-id="${_selectedSnapshot.id}"]`)?.classList.add('active');
    }
    // Always mount checklist (it's always visible); load first artifact properties
    mountChecklist();
    if (_selectedSnapshot) loadPropsPanel();
  }

  function renderArtifactCard(snap) {
    const myVerdict = _artifactVerdicts.find(v => v.snapshot_id === snap.id && v.reviewer_id === currentUserId);
    const mv        = myVerdict?.verdict;
    const isShared  = session.checklist_mode === 'shared';
    const ckSnapId  = isShared ? (snapshots?.[0]?.id || snap.id) : snap.id;
    const snapResponses = _allResponses.filter(r => r.snapshot_id === ckSnapId);
    const totalItems    = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
    const myDone        = snapResponses.filter(r => r.reviewer_id === currentUserId).length;
    const snapFindings  = _findings.filter(f => f.snapshot_id === snap.id);
    const openFnds      = snapFindings.filter(f => f.status === 'open').length;
    const drifted       = driftMap[snap.artifact_id];
    const pct           = totalItems ? Math.round(myDone / totalItems * 100) : 0;

    return `
      <div class="rve-art-card ${mv ? FINAL_VERDICT_CLASSES[mv] : ''}" data-snap-id="${snap.id}">
        <div class="rve-art-card-header">
          <span class="rve-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          ${snap.artifact_version != null ? `<span class="artifact-version-badge">v${snap.artifact_version}</span>` : ''}
          <div style="display:flex;gap:4px;align-items:center;margin-left:auto">
            ${drifted ? `<span class="rve-drift-badge" title="Changed since snapshot">⚠</span>` : ''}
            ${mv ? `<span class="rve-artcard-verdict-badge rve-artcard-verdict-${mv}">${mv === 'go' ? '✓ GO' : mv === 'no_go' ? '✗ NO-GO' : '⚑ Cond.'}</span>` : ''}
          </div>
        </div>
        <div class="rve-art-title">${escHtml(snap.artifact_title || '—')}</div>
        ${totalItems ? `
          <div class="rve-progress-bar"><div class="rve-progress-fill" style="width:${pct}%"></div></div>
          <div class="rve-art-counts">
            <span class="text-muted">${myDone}/${totalItems} items</span>
            ${openFnds ? `<span class="rv-fs-open" style="font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid">⚑ ${openFnds}</span>` : ''}
          </div>` : '<span class="text-muted" style="font-size:11px">No checklist</span>'}
      </div>
    `;
  }

  // Mounts the checklist once in the middle column — stays mounted across artifact switches
  function mountChecklist(snap) {
    const col = document.getElementById('rve-checklist-col');
    if (!col || !sections.length) return;

    snap = snap || _selectedSnapshot || snapshots?.[0];
    const isShared = session.checklist_mode === 'shared';
    const ckSnap   = isShared ? (snapshots?.[0] || snap) : snap;
    if (!snap) return;

    const snapResponses = _allResponses.filter(r => r.snapshot_id === ckSnap.id);
    const snapFindings  = _findings.filter(f => f.snapshot_id === snap.id);
    const isDrifted     = !!driftMap[snap.artifact_id];

    mountReviewChecklist(col, {
      session, snapshot: snap, sections,
      responseSnapshot: isShared ? ckSnap : undefined,
      allResponses: snapResponses,
      currentUserId, reviewers: reviewerList,
      findings: snapFindings,
      isDrifted,
      onSaved: ({ snapshotId, itemId, verdict }) => {
        const existing = _allResponses.find(r => r.snapshot_id === snapshotId && r.template_item_id === itemId && r.reviewer_id === currentUserId);
        if (existing) existing.verdict = verdict;
        else _allResponses.push({ snapshot_id: snapshotId, template_item_id: itemId, reviewer_id: currentUserId, verdict, session_id: sessionId });
        if (isShared) (snapshots || []).forEach(s => refreshArtifactCard(s));
        else refreshArtifactCard(snap);
      },
      onFindingRaise: opts => openRaiseFindingModal(opts),
      onFindingCreated: f => { _findings.push(f); refreshArtifactCard(snap); },
      onCompareRequest: () => openDiffModal(snap),
      onReSnapshotRequest: async () => { await reSnapshot(snap); loadPropsPanel(); },
    });
  }

  // Refreshes the right properties panel when the selected artifact changes
  async function loadArtifactPanel() {
    const snap = _selectedSnapshot;
    if (snap) await recheckDrift(snap);
    if (session.checklist_mode !== 'shared') mountChecklist(snap);
    loadPropsPanel();
  }

  // Re-fetches updated_at for one artifact and updates driftMap + card badge
  async function recheckDrift(snap) {
    const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
    const table = tableMap[snap.artifact_type];
    if (!table) return;
    const { data: live } = await sb.from(table).select('updated_at').eq('id', snap.artifact_id).single();
    if (!live) return;
    const wasDrifted  = !!driftMap[snap.artifact_id];
    const nowDrifted  = snap.artifact_updated_at ? live.updated_at > snap.artifact_updated_at : false;
    if (nowDrifted !== wasDrifted) {
      if (nowDrifted) driftMap[snap.artifact_id] = true;
      else delete driftMap[snap.artifact_id];
      refreshArtifactCard(snap);
    }
  }

  async function loadPropsPanel() {
    const panel = document.getElementById('rve-props-panel');
    if (!panel || !_selectedSnapshot) return;

    const snap   = _selectedSnapshot;
    const data   = snap.snapshot_data || {};
    const fields = ARTIFACT_DISPLAY_FIELDS[snap.artifact_type] || ['title','status'];

    const myVerdict   = _artifactVerdicts.find(v => v.snapshot_id === snap.id && v.reviewer_id === currentUserId);
    const mv          = myVerdict?.verdict || null;
    const otherVerdicts = reviewerList
      .filter(r => r.user_id !== currentUserId)
      .map(r => {
        const v = _artifactVerdicts.find(x => x.snapshot_id === snap.id && x.reviewer_id === r.user_id);
        return v ? { display_name: r.display_name, verdict: v.verdict } : null;
      }).filter(Boolean);
    const drifted = !!driftMap[snap.artifact_id];

    // Load comment thread — fetch rows then resolve display names separately
    const { data: rawComments } = await sb
      .from('review_artifact_comments')
      .select('id, author_id, comment, created_at')
      .eq('snapshot_id', snap.id)
      .order('created_at');
    const rows = rawComments || [];
    const authorIds = [...new Set(rows.map(c => c.author_id).filter(Boolean))];
    const profileMap = {};
    if (authorIds.length) {
      const { data: profiles } = await sb.from('user_profiles').select('id, display_name').in('id', authorIds);
      (profiles || []).forEach(p => { profileMap[p.id] = p.display_name; });
    }
    const _comments = rows.map(c => ({ ...c, user_profiles: { display_name: profileMap[c.author_id] || null } }));

    panel.innerHTML = `
      <div class="rve-props-inner">
        <div class="rve-props-artifact-header">
          <span class="rve-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          ${snap.artifact_version != null ? `<span class="artifact-version-badge">v${snap.artifact_version}</span>` : ''}
          <span class="badge badge-${escHtml(data.status || 'draft')}">${escHtml(data.status || '—')}</span>
        </div>
        <div class="rve-props-title">${escHtml(snap.artifact_title || '')}</div>

        ${drifted ? `
          <div class="rve-props-drift">
            ⚠ Changed since snapshot
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-ghost btn-sm" id="rve-props-compare">Compare</button>
              <button class="btn btn-secondary btn-sm" id="rve-props-resnap">Update Snapshot</button>
            </div>
          </div>` : ''}

        <div class="rve-props-fields">
          ${fields.filter(f => data[f] != null && data[f] !== '').map(f => `
            <div class="rve-props-field">
              <div class="rve-props-field-label">${escHtml(f.replace(/_/g,' '))}</div>
              <div class="rve-props-field-value">${escHtml(String(data[f]))}</div>
            </div>`).join('')}
        </div>

        <div class="rve-props-divider"></div>

        <div class="rve-props-verdict-section">
          <div class="rve-props-verdict-label">Reviewer Verdict</div>
          <div class="rve-props-verdict-btns">
            ${['go','conditional','no_go'].map(v => `
              <button class="rve-props-vbtn ${mv === v ? 'rve-props-vbtn-' + v + ' active' : ''}"
                      data-verdict="${v}">
                ${v === 'go' ? '✓ GO' : v === 'no_go' ? '✗ NO-GO' : '⚑ Conditional'}
              </button>`).join('')}
          </div>
          ${otherVerdicts.length ? `
            <div class="rve-props-other-verdicts">
              ${otherVerdicts.map(ov => `
                <span class="rvck-rv-pill ${ov.verdict || ''}" title="${escHtml(ov.display_name)}">
                  ${escHtml(ov.display_name.charAt(0))}: ${FINAL_VERDICT_LABELS[ov.verdict] || '—'}
                </span>`).join('')}
            </div>` : ''}
        </div>

        <div class="rve-props-divider"></div>

        <div class="rve-props-thread-section">
          <div class="rve-props-verdict-label">Comments</div>
          <div class="rve-props-thread" id="rve-props-thread">
            ${_comments.length
              ? _comments.map((c, i) => renderArtifactComment(c, i === _comments.length - 1)).join('')
              : '<p class="rve-props-thread-empty text-muted">No comments yet.</p>'}
          </div>
          <div class="rve-props-reply">
            <textarea class="form-input rve-props-reply-input" id="rve-props-reply-input"
              rows="2" placeholder="Add a comment…"></textarea>
            <button class="btn btn-secondary btn-sm rve-props-reply-btn" id="rve-props-reply-btn">Reply</button>
          </div>
        </div>
      </div>
    `;

    // Wire comment edit/delete actions
    const thread0 = panel.querySelector('#rve-props-thread');
    if (thread0) wireCommentActions(thread0);

    // Wire drift buttons
    panel.querySelector('#rve-props-compare')?.addEventListener('click', () => openDiffModal(snap));
    panel.querySelector('#rve-props-resnap')?.addEventListener('click', async () => { await reSnapshot(snap); loadPropsPanel(); });

    // Wire verdict buttons
    let _currentVerdict = mv;
    panel.querySelectorAll('.rve-props-vbtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        _currentVerdict = btn.dataset.verdict;
        panel.querySelectorAll('.rve-props-vbtn').forEach(b => {
          b.className = `rve-props-vbtn${b.dataset.verdict === _currentVerdict ? ' rve-props-vbtn-' + _currentVerdict + ' active' : ''}`;
        });
        await saveArtifactVerdict(snap, _currentVerdict);
      });
    });

    // Wire comment reply
    const replyBtn   = panel.querySelector('#rve-props-reply-btn');
    const replyInput = panel.querySelector('#rve-props-reply-input');
    const postComment = async () => {
      const text = replyInput?.value?.trim();
      if (!text) { replyInput?.focus(); return; }
      replyBtn.disabled = true;

      // Insert first, then fetch with join to avoid join failures blocking the save
      const { data: inserted, error } = await sb.from('review_artifact_comments').insert({
        session_id: sessionId, snapshot_id: snap.id,
        author_id: currentUserId, comment: text,
      }).select('id, author_id, comment, created_at').single();

      replyBtn.disabled = false;
      if (error) { toast('Error saving comment: ' + error.message, 'error'); return; }

      // Fetch display name separately
      const { data: profile } = await sb.from('user_profiles').select('display_name').eq('id', currentUserId).single();
      const saved = { ...inserted, user_profiles: profile || null };

      replyInput.value = '';
      const thread = panel.querySelector('#rve-props-thread');
      if (thread) {
        const empty = thread.querySelector('.rve-props-thread-empty');
        if (empty) empty.remove();
        // Strip edit/delete from the previously last comment (no longer last)
        thread.querySelector('.rve-props-comment:last-child .rve-props-comment-actions')?.remove();
        // Append new comment as last (with edit buttons since it's ours)
        thread.insertAdjacentHTML('beforeend', renderArtifactComment(saved, true));
        wireCommentActions(thread);
        thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    replyBtn?.addEventListener('click', postComment);
    replyInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postComment(); }
    });
  }

  function renderArtifactComment(c, isLast = false) {
    const name      = c.user_profiles?.display_name || c.author_id?.slice(0, 8) || '?';
    const dt        = formatDateTime(c.created_at);
    const canEdit   = isLast && c.author_id === currentUserId;
    return `<div class="rve-props-comment" data-comment-id="${c.id}">
      <div class="rve-props-comment-header">
        <span class="rve-props-comment-meta"><strong>${escHtml(name)}</strong>, ${escHtml(dt)}</span>
        ${canEdit ? `
          <span class="rve-props-comment-actions">
            <button class="btn btn-ghost btn-xs rve-comment-edit-btn" data-id="${c.id}" title="Edit">✎</button>
            <button class="btn btn-ghost btn-xs rve-comment-del-btn" data-id="${c.id}" title="Delete" style="color:var(--color-danger)">✕</button>
          </span>` : ''}
      </div>
      <div class="rve-props-comment-body" data-id="${c.id}">${escHtml(c.comment)}</div>
    </div>`;
  }

  function wireCommentActions(thread) {
    // Edit button — replace body with inline textarea
    thread.querySelectorAll('.rve-comment-edit-btn').forEach(btn => {
      btn.onclick = () => {
        const commentEl = thread.querySelector(`.rve-props-comment[data-comment-id="${btn.dataset.id}"]`);
        const body      = commentEl?.querySelector('.rve-props-comment-body');
        if (!body || body.querySelector('textarea')) return; // already editing
        const original = body.textContent;
        body.innerHTML = `
          <textarea class="form-input rve-comment-edit-input" rows="2" style="width:100%;margin-top:4px">${escHtml(original)}</textarea>
          <div style="display:flex;gap:6px;margin-top:4px;justify-content:flex-end">
            <button class="btn btn-ghost btn-xs rve-comment-edit-cancel">Cancel</button>
            <button class="btn btn-secondary btn-xs rve-comment-edit-save" data-id="${btn.dataset.id}">Save</button>
          </div>`;
        body.querySelector('.rve-comment-edit-cancel').onclick = () => { body.innerHTML = escHtml(original); };
        body.querySelector('.rve-comment-edit-save').onclick = async () => {
          const newText = body.querySelector('textarea')?.value?.trim();
          if (!newText) return;
          const { error } = await sb.from('review_artifact_comments')
            .update({ comment: newText }).eq('id', btn.dataset.id);
          if (error) { toast('Error: ' + error.message, 'error'); return; }
          body.innerHTML = escHtml(newText);
        };
      };
    });

    // Delete button
    thread.querySelectorAll('.rve-comment-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this comment?')) return;
        const { error } = await sb.from('review_artifact_comments').delete().eq('id', btn.dataset.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        const commentEl = thread.querySelector(`.rve-props-comment[data-comment-id="${btn.dataset.id}"]`);
        commentEl?.remove();
        if (!thread.querySelector('.rve-props-comment')) {
          thread.innerHTML = '<p class="rve-props-thread-empty text-muted">No comments yet.</p>';
        } else {
          // Re-render previous comment without edit buttons (it's no longer the last)
          // just remove actions from new last comment if it's not the current user's
          rewireLastComment(thread);
        }
      };
    });
  }

  function rewireLastComment(thread) {
    // After a delete, re-evaluate which comment is last and update its action buttons
    const allComments = [...thread.querySelectorAll('.rve-props-comment')];
    if (!allComments.length) return;
    // Remove all action spans first
    thread.querySelectorAll('.rve-props-comment-actions').forEach(el => el.remove());
    const last = allComments[allComments.length - 1];
    const authorId = last.querySelector('.rve-comment-edit-btn, .rve-comment-del-btn')?.dataset?.id;
    // We can't know the author_id from DOM alone after removal — reload the panel to be safe
    loadPropsPanel();
  }

  async function saveArtifactVerdict(snap, verdict) {
    const { data, error } = await sb.from('review_artifact_verdicts')
      .upsert({
        session_id: sessionId, snapshot_id: snap.id,
        reviewer_id: currentUserId, verdict,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'snapshot_id,reviewer_id' })
      .select().single();
    if (!error && data) {
      const existing = _artifactVerdicts.find(v => v.snapshot_id === snap.id && v.reviewer_id === currentUserId);
      if (existing) existing.verdict = verdict;
      else _artifactVerdicts.push({ snapshot_id: snap.id, reviewer_id: currentUserId, verdict, session_id: sessionId });
      refreshArtifactCard(snap);
    }
  }

  function refreshArtifactCard(snap) {
    const card = container.querySelector(`[data-snap-id="${snap.id}"].rve-art-card`);
    if (!card) return;
    card.outerHTML = renderArtifactCard(snap);
    container.querySelectorAll('.rve-art-card').forEach(c => {
      c.addEventListener('click', () => {
        _selectedSnapshot = (snapshots || []).find(s => s.id === c.dataset.snapId);
        container.querySelectorAll('.rve-art-card').forEach(x => x.classList.toggle('active', x.dataset.snapId === c.dataset.snapId));
        loadArtifactPanel();
      });
      if (c.dataset.snapId === snap.id) c.classList.add('active');
    });
  }

  // ── Raise Finding modal ──────────────────────────────────────────────────────

  function openRaiseFindingModal({ snapshotId, templateItemId, criterion, verdict, comment, responseId, isOpenPoint }) {
    showModal({
      title: '⚑ Raise Finding',
      body: `
        <div class="form-grid cols-1">
          ${criterion ? `<div class="form-group"><label class="form-label">Criterion</label><p class="form-hint">${escHtml(criterion)}</p></div>` : ''}
          ${(!snapshotId && !isOpenPoint) ? `
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

        </div>`,
      footer: `<button class="btn btn-secondary" id="fnd-cancel">Cancel</button>
               <button class="btn btn-primary" id="fnd-save">⚑ Raise Finding</button>`,
    });

    document.getElementById('fnd-cancel').onclick = hideModal;
    document.getElementById('fnd-save').onclick = async () => {
      const title = document.getElementById('fnd-title').value.trim();
      if (!title) { document.getElementById('fnd-title').focus(); return; }
      const btn = document.getElementById('fnd-save');
      btn.disabled = true;

      const resolvedSnapshotId = snapshotId || document.getElementById('fnd-snap')?.value || null;
      const { count } = await sb.from('review_findings').select('id', { count:'exact', head:true }).eq('session_id', sessionId);
      const finding_code = `FND-${String((count || 0) + 1).padStart(3, '0')}`;

      const { data: finding, error } = await sb.from('review_findings').insert({
        session_id:       sessionId,
        snapshot_id:      resolvedSnapshotId || null,
        template_item_id: templateItemId || null,
        response_id:      responseId || null,
        finding_code,
        title,
        severity:    document.getElementById('fnd-severity').value,
        description: document.getElementById('fnd-desc').value.trim(),
        status:      'open',
        created_by:  currentUserId,
      }).select().single();

      if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
      _findings.push(finding);
      toast(`Finding ${finding_code} raised.`, 'success');
      hideModal();

      // Inject into checklist panel without full re-mount
      const panel = document.getElementById('rve-checklist-panel');
      if (panel?._addFinding) panel._addFinding(finding);

      refreshArtifactCard(_selectedSnapshot);
    };
    document.getElementById('fnd-title').focus();
  }

  // ── Complete session ──────────────────────────────────────────────────────────

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

  // ── Re-snapshot ───────────────────────────────────────────────────────────────

  async function reSnapshot(snap) {
    const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
    const table = tableMap[snap.artifact_type];
    if (!table) return;
    const { data: live } = await sb.from(table).select('*').eq('id', snap.artifact_id).single();
    if (!live) return;

    await sb.from('review_artifact_snapshots').update({ is_current: false }).eq('id', snap.id);
    await sb.from('review_checklist_responses').update({ is_stale: true }).eq('snapshot_id', snap.id);

    const { data: newSnap } = await sb.from('review_artifact_snapshots').insert({
      session_id: sessionId, artifact_type: snap.artifact_type, artifact_id: snap.artifact_id,
      artifact_code: snap.artifact_code, artifact_title: live.title || live.name || snap.artifact_title,
      snapshot_data: live, artifact_updated_at: live.updated_at, artifact_version: live.version ?? null, is_current: true,
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

// ── Drift detection ───────────────────────────────────────────────────────────
async function detectDrift(snapshots) {
  const driftMap = {};
  if (!snapshots.length) return driftMap;
  const byType = {};
  snapshots.forEach(s => { if (!byType[s.artifact_type]) byType[s.artifact_type] = []; byType[s.artifact_type].push(s); });
  const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
  await Promise.all(Object.entries(byType).map(async ([type, snaps]) => {
    const table = tableMap[type];
    if (!table) return;
    const { data: liveRows } = await sb.from(table).select('id, updated_at').in('id', snaps.map(s => s.artifact_id));
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
