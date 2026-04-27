/**
 * Review Execute — split-panel checklist execution view.
 * Left: artifact list with drift detection and progress bars.
 * Right: checklist component for the selected artifact.
 * Route: /project/:projectId/item/:itemId/reviews/:sessionId/execute
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { showModal, hideModal } from '../components/modal.js';
import { toast } from '../toast.js';
import { mountReviewChecklist } from '../components/review-checklist.js';

const STATUS_CLASSES = {
  planned:     'badge-draft',
  in_progress: 'badge-review',
  completed:   'badge-approved',
  cancelled:   'badge-deprecated',
};
const STATUS_LABELS = {
  planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
};
const SEVERITY_LABELS = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };

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
  ] = await Promise.all([
    sb.from('review_sessions').select('*, review_protocol_templates(id,name,artifact_type,review_type)').eq('id', sessionId).single(),
    sb.from('review_artifact_snapshots').select('*').eq('session_id', sessionId).eq('is_current', true).order('snapshotted_at'),
    sb.from('review_session_reviewers').select('*, user_profiles(display_name)').eq('session_id', sessionId),
    sb.from('review_checklist_responses').select('*').eq('session_id', sessionId),
    sb.from('review_findings').select('*').eq('session_id', sessionId),
  ]);

  if (!session) { container.innerHTML = `<p style="padding:40px">Session not found.</p>`; return; }

  // Get current user
  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  // Build reviewers list with display names
  const reviewerList = (reviewers || []).map(r => ({
    user_id: r.user_id,
    role: r.role,
    display_name: r.user_profiles?.display_name || r.user_id?.slice(0,8),
  }));

  // Load template sections + items (if template attached)
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

  // Detect drift: fetch current versions of all artifacts
  const driftMap = await detectDrift(snapshots || []);

  let _selectedSnapshot = snapshots?.[0] || null;

  renderPage();

  function renderPage() {
    container.innerHTML = `
      <div class="rve-wrap">
        <div class="rve-topbar">
          <div class="rve-topbar-left">
            <span class="rve-session-title">${escHtml(session.title)}</span>
            <span class="badge ${STATUS_CLASSES[session.status] || 'badge-draft'}">${STATUS_LABELS[session.status] || session.status}</span>
            ${session.review_protocol_templates ? `<span class="rve-tpl-tag">${escHtml(session.review_protocol_templates.name)}</span>` : ''}
          </div>
          <div class="rve-topbar-right">
            <button class="btn btn-ghost btn-sm" id="rve-btn-findings">⚑ View Findings</button>
            ${session.status === 'in_progress' ? `<button class="btn btn-primary btn-sm" id="rve-btn-complete">✓ Complete Review</button>` : ''}
          </div>
        </div>

        <div class="rve-body">
          <div class="rve-artifact-list" id="rve-artifact-list">
            ${(snapshots || []).map(snap => renderArtifactCard(snap)).join('')}
            ${!snapshots?.length ? '<p class="rv-empty" style="padding:16px">No artifacts in this session.</p>' : ''}
          </div>
          <div class="rve-checklist-panel" id="rve-checklist-panel">
            ${_selectedSnapshot ? '' : '<div class="rve-checklist-empty">Select an artifact to start reviewing.</div>'}
          </div>
        </div>
      </div>
    `;

    document.getElementById('rve-btn-findings')?.addEventListener('click', () => navigate(`${base}/reviews/${sessionId}/findings`));
    document.getElementById('rve-btn-complete')?.addEventListener('click', completeSession);

    // Wire artifact card clicks
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
          <div class="rve-progress-bar">
            <div class="rve-progress-fill" style="width:${pct}%"></div>
          </div>
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

    const snap = _selectedSnapshot;
    const snapResponses = (allResponses || []).filter(r => r.snapshot_id === snap.id);
    const snapFindings  = (findings || []).filter(f => f.snapshot_id === snap.id);
    const isDrifted     = !!driftMap[snap.artifact_id];

    mountReviewChecklist(panel, {
      session, snapshot: snap, sections, allResponses: snapResponses,
      currentUserId, reviewers: reviewerList, findings: snapFindings,
      isDrifted,
      onSaved: ({ itemId, verdict }) => {
        // Update local allResponses cache
        const existing = allResponses?.find(r => r.snapshot_id === snap.id && r.template_item_id === itemId && r.reviewer_id === currentUserId);
        if (existing) { existing.verdict = verdict; }
        else { allResponses?.push({ snapshot_id: snap.id, template_item_id: itemId, reviewer_id: currentUserId, verdict, session_id: sessionId }); }
        // Refresh artifact card progress
        const card = container.querySelector(`[data-snap-id="${snap.id}"]`);
        if (card) card.outerHTML = renderArtifactCard(snap);
        // Re-wire after replacement
        container.querySelectorAll('.rve-art-card').forEach(c => {
          c.addEventListener('click', () => {
            _selectedSnapshot = (snapshots || []).find(s => s.id === c.dataset.snapId);
            container.querySelectorAll('.rve-art-card').forEach(x => x.classList.toggle('active', x.dataset.snapId === c.dataset.snapId));
            loadChecklist();
          });
          if (c.dataset.snapId === snap.id) c.classList.add('active');
        });
      },
      onFindingRaise: (opts) => openRaiseFindingModal(opts),
      onReSnapshotRequest: async () => {
        await reSnapshot(snap);
      },
    });
  }

  function openRaiseFindingModal({ snapshotId, templateItemId, criterion, verdict, comment, responseId }) {
    showModal({
      title: '⚑ Raise Finding',
      body: `
        <div class="form-grid cols-1">
          <div class="form-group">
            <label class="form-label">Criterion</label>
            <p class="form-hint">${escHtml(criterion)}</p>
          </div>
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

      // Generate finding code
      const { count } = await sb.from('review_findings').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
      const finding_code = `FND-${String((count || 0) + 1).padStart(3, '0')}`;

      const { data: finding, error } = await sb.from('review_findings').insert({
        session_id:      sessionId,
        snapshot_id:     snapshotId,
        response_id:     responseId || null,
        finding_code,
        title,
        severity:        document.getElementById('fnd-severity').value,
        description:     document.getElementById('fnd-desc').value.trim(),
        due_date:        document.getElementById('fnd-due').value || null,
        status:          'open',
        created_by:      currentUserId,
      }).select().single();

      if (error) { toast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
      findings?.push(finding);
      toast(`Finding ${finding_code} raised.`, 'success');
      hideModal();
      loadChecklist(); // Refresh to show new finding tag
    };
    document.getElementById('fnd-title').focus();
  }

  async function completeSession() {
    if (!confirm('Mark this review session as completed? This cannot be undone.')) return;
    const { error } = await sb.from('review_sessions').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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

    // Mark old snapshot as superseded
    await sb.from('review_artifact_snapshots').update({ is_current: false }).eq('id', snap.id);
    // Mark responses as stale
    await sb.from('review_checklist_responses').update({ is_stale: true }).eq('snapshot_id', snap.id);

    // Insert new snapshot
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

  // Group by artifact type
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
      if (snap && snap.artifact_updated_at && live.updated_at > snap.artifact_updated_at) {
        driftMap[live.id] = true;
      }
    });
  }));

  return driftMap;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
