/**
 * Review Findings Tracker
 * Shows all findings for a session with status lifecycle management.
 * Route: /project/:projectId/item/:itemId/reviews/:sessionId/findings
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';

const SEVERITY_LABELS  = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };
const SEVERITY_CLASSES = { critical: 'rv-sev-critical', major: 'rv-sev-major', minor: 'rv-sev-minor', observation: 'rv-sev-observation' };

// ASPICE MAN.5 finding lifecycle
const STATUS_LABELS = {
  open:        'Open',
  accepted:    'Accepted',
  in_progress: 'In Progress',
  deferred:    'Deferred',
  fixed:       'Fixed',
  verified:    'Verified',
  closed:      'Closed',
  duplicate:   'Duplicate',
  rejected:    'Rejected',
};
const STATUS_CLASSES = {
  open:        'rv-fs-open',
  accepted:    'rv-fs-accepted',
  in_progress: 'rv-fs-in-progress',
  deferred:    'rv-fs-deferred',
  fixed:       'rv-fs-fixed',
  verified:    'rv-fs-verified',
  closed:      'rv-fs-closed',
  duplicate:   'rv-fs-closed',
  rejected:    'rv-fs-closed',
};

// Valid transitions (from → [to])
const TRANSITIONS = {
  open:        ['accepted', 'rejected', 'duplicate'],
  accepted:    ['in_progress', 'deferred', 'rejected'],
  in_progress: ['fixed', 'deferred'],
  deferred:    ['in_progress', 'rejected'],
  fixed:       ['verified', 'in_progress'],
  verified:    ['closed', 'in_progress'],
  closed:      [],
  duplicate:   [],
  rejected:    [],
};

export async function renderReviewFindings(container, ctx) {
  const { project, item, sessionId } = ctx;
  const base = `/project/${project.id}/item/${item.id}`;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `${base}/vcycle/item_definition` },
    { label: 'Reviews', path: `${base}/reviews` },
    { label: 'Findings' },
  ]);

  container.innerHTML = `<div class="content-loading"><div class="spinner"></div></div>`;

  const [
    { data: session },
    { data: findings },
    { data: snapshots },
  ] = await Promise.all([
    sb.from('review_sessions').select('id, title, status').eq('id', sessionId).single(),
    sb.from('review_findings').select('*').eq('session_id', sessionId).order('created_at'),
    sb.from('review_artifact_snapshots').select('id, artifact_id, artifact_code, artifact_title, artifact_type').eq('session_id', sessionId),
  ]);

  const snapMap = {};
  (snapshots || []).forEach(s => { snapMap[s.id] = s; });

  // Active filters
  let filterStatus   = 'all';
  let filterSeverity = 'all';
  const _urlParams   = new URLSearchParams(window.location.hash.split('?')[1] || '');
  let filterArtifact = _urlParams.get('artifactId') || null;
  const _fromPath    = _urlParams.get('from') ? decodeURIComponent(_urlParams.get('from')) : null;

  renderPage();

  function renderPage() {
    // Build set of snapshot IDs matching the artifact filter (artifact_id now included in query)
    const snapIdsForArtifact = filterArtifact
      ? new Set((snapshots || []).filter(s => s.artifact_id === filterArtifact).map(s => s.id))
      : null;
    const filterArtSnap = filterArtifact
      ? (snapshots || []).find(s => s.artifact_id === filterArtifact)
      : null;

    const filtered = (findings || []).filter(f => {
      if (filterStatus !== 'all' && f.status !== filterStatus) return false;
      if (filterSeverity !== 'all' && f.severity !== filterSeverity) return false;
      if (snapIdsForArtifact && !snapIdsForArtifact.has(f.snapshot_id)) return false;
      return true;
    });

    // Summary counts
    const openCount     = (findings || []).filter(f => f.status === 'open').length;
    const inProgCount   = (findings || []).filter(f => f.status === 'in_progress' || f.status === 'accepted').length;
    const fixedCount    = (findings || []).filter(f => f.status === 'fixed' || f.status === 'verified').length;
    const closedCount   = (findings || []).filter(f => f.status === 'closed').length;
    const critCount     = (findings || []).filter(f => f.severity === 'critical').length;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-top">
          <div>
            <h1>Findings</h1>
            <p class="page-subtitle">${escHtml(session?.title || '')} · ${(findings || []).length} total</p>
          </div>
          <div style="display:flex;gap:8px">
            ${_fromPath ? `<button class="btn btn-secondary" id="rvf-btn-back">← Back</button>` : ''}
            <button class="btn btn-secondary" id="rvf-btn-execute">← Back to Checklist</button>
          </div>
        </div>
      </div>
      <div class="page-body">

        <div class="rvf-summary-bar">
          <div class="rvf-stat rv-fs-open"><span class="rvf-stat-num">${openCount}</span> Open</div>
          <div class="rvf-stat rv-fs-in-progress"><span class="rvf-stat-num">${inProgCount}</span> In Progress</div>
          <div class="rvf-stat rv-fs-fixed"><span class="rvf-stat-num">${fixedCount}</span> Fixed/Verified</div>
          <div class="rvf-stat rv-fs-closed"><span class="rvf-stat-num">${closedCount}</span> Closed</div>
          ${critCount ? `<div class="rvf-stat rv-sev-critical"><span class="rvf-stat-num">${critCount}</span> Critical</div>` : ''}
        </div>

        ${filterArtSnap ? `
          <div class="rvf-artifact-filter-bar">
            <span class="rvf-artifact-filter-label">
              Filtering findings for:
              <strong>${escHtml(filterArtSnap.artifact_code || filterArtSnap.artifact_title || 'artifact')}</strong>
              ${filterArtSnap.artifact_title ? `<span class="text-muted">— ${escHtml(filterArtSnap.artifact_title)}</span>` : ''}
            </span>
            <button class="btn btn-ghost btn-xs" id="rvf-clear-art-filter" title="Show all artifacts">✕ Clear filter</button>
          </div>` : ''}

        <div class="rvf-filters">
          <label>Status:
            <select class="form-input form-select rvf-filter-status" style="width:140px">
              <option value="all">All statuses</option>
              ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${filterStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <label>Severity:
            <select class="form-input form-select rvf-filter-sev" style="width:140px">
              <option value="all">All severities</option>
              ${Object.entries(SEVERITY_LABELS).map(([v, l]) => `<option value="${v}" ${filterSeverity === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </label>
          <span class="text-muted" style="font-size:12px">${filtered.length} shown</span>
        </div>

        ${filtered.length ? `
          <table class="data-table rvf-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Artifact</th>
                <th>Severity</th>
                <th>Title</th>
                <th>Status</th>
                <th>Resolution Note</th>
                <th style="width:160px">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(f => renderFindingRow(f, snapMap)).join('')}
            </tbody>
          </table>
        ` : `<p class="rv-empty" style="padding:40px 0">No findings match the current filters.</p>`}
      </div>
    `;

    document.getElementById('rvf-btn-back')?.addEventListener('click', () => navigate(_fromPath));
    document.getElementById('rvf-btn-execute').onclick = () => navigate(`${base}/reviews/${sessionId}/execute`);

    document.getElementById('rvf-clear-art-filter')?.addEventListener('click', () => {
      filterArtifact = null; renderPage();
    });

    container.querySelector('.rvf-filter-status').onchange = e => {
      filterStatus = e.target.value; renderPage();
    };
    container.querySelector('.rvf-filter-sev').onchange = e => {
      filterSeverity = e.target.value; renderPage();
    };

    // Status transition buttons — show inline comment form before committing
    const COMMENT_REQUIRED = new Set(['rejected','duplicate','deferred','closed']);

    container.querySelectorAll('.rvf-status-btn').forEach(btn => {
      btn.onclick = () => {
        const { findingId, toStatus } = btn.dataset;
        const tr = btn.closest('tr');
        if (!tr) return;

        // Remove any other open transition form in this table
        container.querySelectorAll('.rvf-transition-row').forEach(r => r.remove());
        container.querySelectorAll('.rvf-status-btn.rvf-status-btn--active').forEach(b => b.classList.remove('rvf-status-btn--active'));

        btn.classList.add('rvf-status-btn--active');
        const required = COMMENT_REQUIRED.has(toStatus);

        const formTr = document.createElement('tr');
        formTr.className = 'rvf-transition-row';
        formTr.innerHTML = `
          <td colspan="7">
            <div class="rvf-transition-form">
              <span class="rvf-transition-label">→ <strong>${STATUS_LABELS[toStatus]}</strong></span>
              <textarea class="form-input rvf-transition-comment" rows="2"
                placeholder="Add a note${required ? ' (required)' : ' (optional)'}…"
                style="flex:1;font-size:12px"></textarea>
              <div class="rvf-transition-actions">
                <button class="btn btn-primary btn-sm rvf-transition-confirm">Confirm</button>
                <button class="btn btn-ghost btn-sm rvf-transition-cancel">Cancel</button>
              </div>
            </div>
          </td>`;
        tr.after(formTr);

        const commentInput = formTr.querySelector('.rvf-transition-comment');
        commentInput.focus();

        formTr.querySelector('.rvf-transition-cancel').onclick = () => {
          formTr.remove();
          btn.classList.remove('rvf-status-btn--active');
        };

        formTr.querySelector('.rvf-transition-confirm').onclick = async () => {
          const comment = commentInput.value.trim();
          if (required && !comment) { commentInput.focus(); toast('A note is required for this transition.', 'error'); return; }
          const finding = findings?.find(f => f.id === findingId);
          if (!finding) return;

          const confirmBtn = formTr.querySelector('.rvf-transition-confirm');
          confirmBtn.disabled = true;

          const updates = { status: toStatus, updated_at: new Date().toISOString() };
          if (comment) updates.resolution_note = comment;
          const { error } = await sb.from('review_findings').update(updates).eq('id', findingId);
          if (error) { toast('Error: ' + error.message, 'error'); confirmBtn.disabled = false; return; }

          if (comment) {
            await sb.from('review_finding_comments').insert({
              finding_id: findingId, author_id: null,
              comment: `[${STATUS_LABELS[toStatus]}] ${comment}`,
            }).catch(() => {});
          }

          finding.status = toStatus;
          if (comment) finding.resolution_note = comment;
          toast(`${finding.finding_code}: ${STATUS_LABELS[toStatus]}`, 'success');
          renderPage();
        };
      };
    });

    // Resolution note inline edit
    container.querySelectorAll('.rvf-resolution-input').forEach(inp => {
      inp.addEventListener('change', debounce(async () => {
        const { findingId } = inp.dataset;
        const finding = findings?.find(f => f.id === findingId);
        if (!finding) return;
        await sb.from('review_findings').update({
          resolution_note: inp.value.trim(), updated_at: new Date().toISOString(),
        }).eq('id', findingId);
        finding.resolution_note = inp.value.trim();
      }, 600));
    });
  }

  function renderFindingRow(f, snapMap) {
    const snap = f.snapshot_id ? snapMap[f.snapshot_id] : null;
    const transitions = TRANSITIONS[f.status] || [];

    return `
      <tr class="rvf-row" data-id="${f.id}">
        <td class="mono rvf-code">${escHtml(f.finding_code)}</td>
        <td class="rvf-artifact">
          ${snap ? `<span class="rv-art-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
          <span class="text-muted" style="font-size:11px;display:block">${escHtml(snap.artifact_title || '')}</span>` : '<span class="text-muted">—</span>'}
        </td>
        <td><span class="badge ${SEVERITY_CLASSES[f.severity] || ''}">${SEVERITY_LABELS[f.severity] || f.severity}</span></td>
        <td class="rvf-title-cell">
          <div class="rvf-title">${escHtml(f.title)}</div>
          ${f.description ? `<div class="rvf-desc text-muted">${escHtml(f.description)}</div>` : ''}
        </td>
        <td>
          <span class="badge ${STATUS_CLASSES[f.status] || ''}">${STATUS_LABELS[f.status] || f.status}</span>
        </td>
        <td>
          <input class="form-input rvf-resolution-input" data-finding-id="${f.id}"
            value="${escHtml(f.resolution_note || '')}" placeholder="Resolution note…" style="font-size:12px"/>
        </td>
        <td class="rvf-actions">
          ${transitions.map(to => `
            <button class="btn btn-ghost btn-sm rvf-status-btn" data-finding-id="${f.id}" data-to-status="${to}" title="${STATUS_LABELS[to]}">
              ${STATUS_LABELS[to]}
            </button>`).join('')}
        </td>
      </tr>
    `;
  }
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
