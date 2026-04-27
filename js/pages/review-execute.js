/**
 * Review Execute — 3-tab execution view.
 *
 * Tab 1 – Checklist:   split panel (artifact list left + template checklist right)
 * Tab 2 – Findings:    general findings for the session (list + raise without checklist item)
 * Tab 3 – Artifact Review: every artifact in one table — reviewer marks OK/NOK/Partially OK
 *                          and leaves a comment for the author.
 *
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
const VERDICT_LABELS  = { ok: 'OK', nok: 'NOK', partially_ok: 'Partially OK' };
const VERDICT_CLASSES = { ok: 'rv-v-ok', nok: 'rv-v-nok', partially_ok: 'rv-v-partial' };

const FINDING_STATUS_LABELS = {
  open:'Open', accepted:'Accepted', in_progress:'In Progress', deferred:'Deferred',
  fixed:'Fixed', verified:'Verified', closed:'Closed', duplicate:'Duplicate', rejected:'Rejected',
};
const FINDING_STATUS_CLASSES = {
  open:'rv-fs-open', accepted:'rv-fs-accepted', in_progress:'rv-fs-in-progress',
  deferred:'rv-fs-deferred', fixed:'rv-fs-fixed', verified:'rv-fs-verified',
  closed:'rv-fs-closed', duplicate:'rv-fs-closed', rejected:'rv-fs-closed',
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

  const driftMap = await detectDrift(snapshots || []);

  // Local mutable arrays
  const _findings        = findings        ? [...findings]        : [];
  const _artifactVerdicts = artifactVerdicts ? [...artifactVerdicts] : [];

  let _selectedSnapshot = snapshots?.[0] || null;
  let _activeTab = 'checklist'; // 'checklist' | 'findings' | 'artifact-review'

  renderPage();

  // ── Main render ──────────────────────────────────────────────────────────────

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
            ${_findings.length ? `<span class="rve-main-tab-badge">${_findings.filter(f => f.status === 'open').length}</span>` : ''}
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
    const done = (allResponses || []).filter(r => r.reviewer_id === currentUserId).length;
    return `${done}/${totalItems * (snapshots?.length || 1)}`;
  }

  function artifactReviewProgress() {
    const total = snapshots?.length || 0;
    if (!total) return '';
    const done  = _artifactVerdicts.filter(v => v.reviewer_id === currentUserId).length;
    return `${done}/${total}`;
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

    const snap         = _selectedSnapshot;
    const snapResponses = (allResponses || []).filter(r => r.snapshot_id === snap.id);
    const snapFindings  = _findings.filter(f => f.snapshot_id === snap.id);
    const isDrifted     = !!driftMap[snap.artifact_id];

    mountReviewChecklist(panel, {
      session, snapshot: snap, sections, allResponses: snapResponses,
      currentUserId, reviewers: reviewerList, findings: snapFindings,
      isDrifted,
      onSaved: ({ itemId, verdict }) => {
        const existing = allResponses?.find(r => r.snapshot_id === snap.id && r.template_item_id === itemId && r.reviewer_id === currentUserId);
        if (existing) { existing.verdict = verdict; }
        else { allResponses?.push({ snapshot_id: snap.id, template_item_id: itemId, reviewer_id: currentUserId, verdict, session_id: sessionId }); }
        refreshArtifactCard(snap);
      },
      onFindingRaise: (opts) => openRaiseFindingModal(opts),
      onReSnapshotRequest: async () => { await reSnapshot(snap); },
    });
  }

  // ── Tab 2: Findings ──────────────────────────────────────────────────────────

  function renderFindingsTab() {
    const snapMap = {};
    (snapshots || []).forEach(s => { snapMap[s.id] = s; });

    const openFindings   = _findings.filter(f => f.status === 'open');
    const closedFindings = _findings.filter(f => !['open','in_progress','accepted'].includes(f.status));
    const activeFindings = _findings.filter(f => ['accepted','in_progress','deferred'].includes(f.status));

    return `
      <div class="rve-findings-wrap">
        <div class="rve-findings-header">
          <div class="rve-findings-stats">
            <span class="rv-fs-open rve-stat-pill">${openFindings.length} Open</span>
            <span class="rv-fs-in-progress rve-stat-pill">${activeFindings.length} In Progress</span>
            <span class="rv-fs-closed rve-stat-pill">${closedFindings.length} Closed</span>
          </div>
          <button class="btn btn-primary btn-sm" id="rve-raise-general">⚑ Add General Finding</button>
        </div>

        ${!_findings.length ? `
          <div class="rv-empty" style="padding:40px 0">
            <p>No findings yet. Raise findings from the Checklist tab or add a general finding here.</p>
          </div>` : `
          <table class="data-table rve-findings-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Artifact</th>
                <th>Severity</th>
                <th>Title</th>
                <th>Status</th>
                <th>Due</th>
                <th>Resolution</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${_findings.map(f => {
                const snap = f.snapshot_id ? snapMap[f.snapshot_id] : null;
                return `
                  <tr>
                    <td class="mono">${escHtml(f.finding_code)}</td>
                    <td>${snap ? `<span class="rv-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>` : '<span class="text-muted">General</span>'}</td>
                    <td><span class="badge rv-sev-${escHtml(f.severity)}">${escHtml(SEVERITY_LABELS[f.severity] || f.severity)}</span></td>
                    <td>
                      <div style="font-weight:500;font-size:12px">${escHtml(f.title)}</div>
                      ${f.description ? `<div class="text-muted" style="font-size:11px">${escHtml(f.description)}</div>` : ''}
                    </td>
                    <td><span class="badge ${FINDING_STATUS_CLASSES[f.status] || ''}">${FINDING_STATUS_LABELS[f.status] || f.status}</span></td>
                    <td class="text-muted">${f.due_date ? escHtml(f.due_date) : '—'}</td>
                    <td>
                      <input class="form-input rve-resolution-input" style="font-size:12px;min-width:140px"
                        data-finding-id="${f.id}" value="${escHtml(f.resolution_note || '')}" placeholder="Resolution note…"/>
                    </td>
                    <td>
                      <button class="btn btn-ghost btn-sm rve-finding-nav" data-id="${f.id}" title="View in findings tracker">→</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>`}
      </div>
    `;
  }

  function wireFindingsTab() {
    document.getElementById('rve-raise-general')?.addEventListener('click', () => {
      openRaiseFindingModal({ snapshotId: null, templateItemId: null, criterion: '', verdict: '', comment: '', responseId: null });
    });

    container.querySelectorAll('.rve-resolution-input').forEach(inp => {
      inp.addEventListener('change', debounce(async () => {
        const { findingId } = inp.dataset;
        const f = _findings.find(x => x.id === findingId);
        if (!f) return;
        await sb.from('review_findings').update({ resolution_note: inp.value.trim(), updated_at: new Date().toISOString() }).eq('id', findingId);
        f.resolution_note = inp.value.trim();
      }, 600));
    });

    container.querySelectorAll('.rve-finding-nav').forEach(btn => {
      btn.addEventListener('click', () => navigate(`${base}/reviews/${sessionId}/findings`));
    });
  }

  // ── Tab 3: Artifact Review ───────────────────────────────────────────────────

  function renderArtifactReviewTab() {
    if (!snapshots?.length) {
      return `<div class="rv-empty" style="padding:40px 0">No artifacts in this session.</div>`;
    }

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

    // Other reviewers' verdicts (read-only)
    const otherPills = reviewerList
      .filter(r => r.user_id !== currentUserId)
      .map(r => {
        const v = _artifactVerdicts.find(x => x.snapshot_id === snap.id && x.reviewer_id === r.user_id);
        if (!v) return `<span class="rvck-rv-pill rvck-rv-pending" title="${escHtml(r.display_name)}: pending">${escHtml(r.display_name.charAt(0))}: —</span>`;
        return `<span class="rvck-rv-pill ${v.verdict}" title="${escHtml(r.display_name)}: ${VERDICT_LABELS[v.verdict]}">${escHtml(r.display_name.charAt(0))}: ${VERDICT_LABELS[v.verdict]}</span>`;
      }).join('');

    const drifted = driftMap[snap.artifact_id];

    return `
      <tr class="rve-artrev-row" data-snap-id="${snap.id}">
        <td>
          <span class="rve-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          ${drifted ? `<span class="rve-drift-badge" title="Changed since snapshot"> ⚠</span>` : ''}
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
    // Verdict buttons
    container.querySelectorAll('.rve-artrev-vbtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const snapId  = btn.dataset.snapId;
        const verdict = btn.dataset.verdict;
        const row     = container.querySelector(`.rve-artrev-row[data-snap-id="${snapId}"]`);
        const comment = row?.querySelector('.rve-artrev-comment')?.value?.trim() || '';

        // Optimistic UI
        row?.querySelectorAll('.rve-artrev-vbtn').forEach(b => {
          b.classList.remove('active', 'sel-ok', 'sel-nok', 'sel-partially_ok');
        });
        btn.classList.add('active', `sel-${verdict}`);

        await saveArtifactVerdict(snapId, verdict, comment);
      });
    });

    // Comment textareas
    container.querySelectorAll('.rve-artrev-comment').forEach(ta => {
      ta.addEventListener('input', debounce(async () => {
        const snapId  = ta.dataset.snapId;
        const existing = _artifactVerdicts.find(v => v.snapshot_id === snapId && v.reviewer_id === currentUserId);
        const verdict  = existing?.verdict || null;
        if (!verdict) return; // need a verdict before saving comment
        await saveArtifactVerdict(snapId, verdict, ta.value.trim());
      }, 600));
    });
  }

  async function saveArtifactVerdict(snapId, verdict, comment) {
    const existing = _artifactVerdicts.find(v => v.snapshot_id === snapId && v.reviewer_id === currentUserId);
    const payload  = {
      session_id:  sessionId,
      snapshot_id: snapId,
      reviewer_id: currentUserId,
      verdict,
      comment,
      updated_at:  new Date().toISOString(),
    };
    const { data, error } = await sb.from('review_artifact_verdicts')
      .upsert(payload, { onConflict: 'snapshot_id,reviewer_id' })
      .select().single();
    if (error) { toast('Error saving verdict: ' + error.message, 'error'); return; }
    if (existing) {
      Object.assign(existing, data);
    } else {
      _artifactVerdicts.push(data);
    }
    // Update tab progress badge
    const tab = container.querySelector('[data-tab="artifact-review"] .rve-main-tab-count');
    if (tab) tab.textContent = artifactReviewProgress();
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  function refreshArtifactCard(snap) {
    const card = container.querySelector(`[data-snap-id="${snap.id}"].rve-art-card`);
    if (!card) return;
    card.outerHTML = renderArtifactCard(snap);
    // Re-wire the replaced card
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
    const snapMap = {};
    (snapshots || []).forEach(s => { snapMap[s.id] = s; });

    showModal({
      title: '⚑ Raise Finding',
      body: `
        <div class="form-grid cols-1">
          ${criterion ? `<div class="form-group">
            <label class="form-label">Criterion</label>
            <p class="form-hint">${escHtml(criterion)}</p>
          </div>` : ''}
          ${!snapshotId ? `<div class="form-group">
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
        session_id:      sessionId,
        snapshot_id:     resolvedSnapshotId || null,
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
      _findings.push(finding);
      toast(`Finding ${finding_code} raised.`, 'success');
      hideModal();

      // Refresh whichever tab is visible
      if (_activeTab === 'checklist') loadChecklist();
      if (_activeTab === 'findings') {
        document.getElementById('rve-tab-body').innerHTML = renderFindingsTab();
        wireFindingsTab();
      }
      // Update findings tab badge
      const findingsTab = container.querySelector('[data-tab="findings"]');
      if (findingsTab) {
        const open = _findings.filter(f => f.status === 'open').length;
        let badge = findingsTab.querySelector('.rve-main-tab-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'rve-main-tab-badge';
          findingsTab.appendChild(badge);
        }
        badge.textContent = open;
      }
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
      if (snap && snap.artifact_updated_at && live.updated_at > snap.artifact_updated_at) {
        driftMap[live.id] = true;
      }
    });
  }));
  return driftMap;
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
