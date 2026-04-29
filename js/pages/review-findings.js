/**
 * Review Findings Tracker
 * Shows all findings for a session with status lifecycle management.
 * Route: /project/:projectId/item/:itemId/reviews/:sessionId/findings
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';
import {
  FINDING_STATUS_LABELS as STATUS_LABELS,
  FINDING_STATUS_CLASSES as STATUS_CLASSES,
  TRANSITIONS, TRANSITION_LABELS, COMMENT_REQUIRED,
  SEVERITY_LABELS, SEVERITY_CLASSES,
} from '../components/finding-constants.js';

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
  const _urlParams    = new URLSearchParams(window.location.hash.split('?')[1] || '');
  let filterArtifact  = _urlParams.get('artifactId') || null;
  const _fromPath     = _urlParams.get('from') ? decodeURIComponent(_urlParams.get('from')) : null;
  const _highlightFid = _urlParams.get('findingId') || null;

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
                <th style="width:36px"></th>
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

    // Status select — show inline confirm form with required comment
    container.querySelectorAll('.rvf-status-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const findingId = sel.dataset.findingId;
        const toStatus  = sel.value;
        if (!toStatus || toStatus === sel.dataset.current) { sel.value = sel.dataset.current; return; }
        const finding = findings?.find(f => f.id === findingId);
        if (!finding) return;
        const tr = sel.closest('tr');
        if (!tr) return;

        // Remove any other open confirm row
        container.querySelectorAll('.rvf-transition-row').forEach(r => r.remove());

        sel.disabled = true;
        const required = COMMENT_REQUIRED.has(toStatus);
        const label    = TRANSITION_LABELS[toStatus] || STATUS_LABELS[toStatus];

        const formTr = document.createElement('tr');
        formTr.className = 'rvf-transition-row';
        formTr.innerHTML = `
          <td colspan="6">
            <div class="rvf-transition-form">
              <span class="rvf-transition-label">→ <strong>${escHtml(label)}</strong></span>
              <textarea class="form-input rvf-transition-comment" rows="2"
                placeholder="Add a note${required ? ' (required)' : ' (optional)'}…"></textarea>
              <div class="rvf-transition-actions">
                <button class="btn btn-primary btn-sm rvf-transition-confirm">Confirm</button>
                <button class="btn btn-ghost btn-sm rvf-transition-cancel">Cancel</button>
              </div>
            </div>
          </td>`;
        tr.after(formTr);
        formTr.querySelector('.rvf-transition-comment').focus();

        formTr.querySelector('.rvf-transition-cancel').onclick = () => {
          formTr.remove();
          sel.value = sel.dataset.current;
          sel.disabled = false;
        };

        formTr.querySelector('.rvf-transition-confirm').onclick = async () => {
          const comment    = formTr.querySelector('.rvf-transition-comment').value.trim();
          const commentEl  = formTr.querySelector('.rvf-transition-comment');
          if (required && !comment) { commentEl.focus(); toast('A note is required for this transition.', 'error'); return; }
          const confirmBtn = formTr.querySelector('.rvf-transition-confirm');
          confirmBtn.disabled = true;

          const updates = { status: toStatus, updated_at: new Date().toISOString() };
          if (comment) updates.resolution_note = comment;
          const { error } = await sb.from('review_findings').update(updates).eq('id', findingId);
          if (error) { toast('Error: ' + error.message, 'error'); confirmBtn.disabled = false; return; }

          if (comment) {
            await sb.from('review_finding_comments').insert({
              finding_id: findingId, author_id: null,
              comment: `[${label}] ${comment}`,
            }).catch(() => {});
          }

          finding.status = toStatus;
          if (comment) finding.resolution_note = comment;
          toast(`${finding.finding_code}: ${label}`, 'success');
          renderPage();
        };
      });
    });

    // Delete button
    container.querySelectorAll('.rvf-del-btn').forEach(btn => {
      btn.onclick = async () => {
        const finding = findings?.find(f => f.id === btn.dataset.findingId);
        if (!finding) return;
        if (!confirm(`Delete ${finding.finding_code}?`)) return;
        const { error } = await sb.from('review_findings').delete().eq('id', finding.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        findings.splice(findings.indexOf(finding), 1);
        toast(`${finding.finding_code} deleted.`, 'success');
        renderPage();
      };
    });

    // Scroll to and highlight a specific finding (from ?findingId= param)
    if (_highlightFid) {
      const targetRow = container.querySelector(`tr.rvf-row[data-id="${_highlightFid}"]`);
      if (targetRow) {
        targetRow.classList.add('rvf-row--highlight');
        requestAnimationFrame(() => targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        // Fade highlight out after 3s
        setTimeout(() => targetRow.classList.remove('rvf-row--highlight'), 3000);
      }
    }

  }

  function renderFindingRow(f, snapMap) {
    const snap        = f.snapshot_id ? snapMap[f.snapshot_id] : null;
    const transitions = TRANSITIONS[f.status] || [];
    const disabled    = transitions.length === 0 ? 'disabled' : '';
    const statusSelect = `
      <select class="rvf-status-select" data-finding-id="${f.id}" data-current="${f.status}" ${disabled}>
        <option value="${f.status}" selected>${STATUS_LABELS[f.status] || f.status}</option>
        ${transitions.map(to => `<option value="${to}">${TRANSITION_LABELS[to] || STATUS_LABELS[to]}</option>`).join('')}
      </select>`;

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
          ${f.resolution_note ? `<div class="text-muted" style="font-size:11px;margin-top:2px;font-style:italic">${escHtml(f.resolution_note)}</div>` : ''}
        </td>
        <td>${statusSelect}</td>
        <td style="text-align:center">
          <button class="btn btn-ghost btn-xs rvf-del-btn" data-finding-id="${f.id}"
            style="color:var(--color-danger,#e53e3e)" title="Delete finding">✕</button>
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
