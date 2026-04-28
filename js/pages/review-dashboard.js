/**
 * Review Dashboard — lists all review sessions for a project/item.
 * Route: /project/:projectId/item/:itemId/reviews
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';

const STATUS_LABELS = {
  planned:     'Planned',
  in_progress: 'In Progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
};
const STATUS_CLASSES = {
  planned:     'badge-draft',
  in_progress: 'badge-review',
  completed:   'badge-approved',
  cancelled:   'badge-deprecated',
};
const REVIEW_TYPE_LABELS = {
  inspection:        'Inspection',
  walkthrough:       'Walkthrough',
  technical_review:  'Technical Review',
  audit:             'Audit',
  management_review: 'Management Review',
};

export async function renderReviewDashboard(container, ctx) {
  const { project, item } = ctx;
  const base = `/project/${project.id}/item/${item.id}`;

  setBreadcrumb([
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `${base}/vcycle/item_definition` },
    { label: 'Reviews' },
  ]);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>Reviews</h1>
          <p class="page-subtitle">${escHtml(item.name)}</p>
        </div>
        <button class="btn btn-primary" id="rv-btn-new">＋ New Review Session</button>
      </div>
    </div>
    <div class="page-body">
      <div id="rv-sessions-wrap">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  document.getElementById('rv-btn-new').onclick = () => navigate(`${base}/reviews/new`);

  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  await loadSessions();

  async function loadSessions() {
    const { data: sessions } = await sb.from('review_sessions')
      .select('*, review_protocol_templates(name, artifact_type, review_type)')
      .eq('project_id', project.id).order('created_at', { ascending: false });

    const sessionIds = (sessions || []).map(s => s.id);
    let snapshots = [];
    if (sessionIds.length) {
      const { data } = await sb.from('review_artifact_snapshots')
        .select('id, session_id, artifact_code, artifact_title, artifact_type')
        .in('session_id', sessionIds);
      snapshots = data || [];
    }

    const wrap = document.getElementById('rv-sessions-wrap');
    if (!sessions?.length) {
      wrap.innerHTML = `<div class="rv-empty">
        <p>No review sessions yet.</p>
        <p>Create your first session to start reviewing artifacts against a protocol checklist.</p>
      </div>`;
      return;
    }

    // Group snapshots by session
    const snapsBySession = {};
    (snapshots || []).forEach(s => {
      if (!snapsBySession[s.session_id]) snapsBySession[s.session_id] = [];
      snapsBySession[s.session_id].push(s);
    });

    wrap.innerHTML = `
      <table class="data-table rv-sessions-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Protocol</th>
            <th>Artifacts</th>
            <th>Status</th>
            <th>Planned Date</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sessions.map(s => {
            const snaps = snapsBySession[s.id] || [];
            const tpl = s.review_protocol_templates;
            return `
              <tr class="rv-session-row" data-id="${s.id}">
                <td class="rv-session-title">${escHtml(s.title)}</td>
                <td><span class="rv-type-tag">${escHtml(REVIEW_TYPE_LABELS[s.review_type] || s.review_type)}</span></td>
                <td>${tpl ? `<span class="rv-tpl-name">${escHtml(tpl.name)}</span>` : '<span class="text-muted">—</span>'}</td>
                <td>
                  <span class="rv-artifact-count">${snaps.length}</span>
                  ${snaps.length ? `<span class="rv-artifact-hint">${snaps.slice(0,2).map(sn => escHtml(sn.artifact_code || sn.artifact_type)).join(', ')}${snaps.length > 2 ? ` +${snaps.length - 2}` : ''}</span>` : ''}
                </td>
                <td><span class="badge ${STATUS_CLASSES[s.status] || 'badge-draft'}">${STATUS_LABELS[s.status] || s.status}</span></td>
                <td>${s.planned_date ? escHtml(s.planned_date) : '<span class="text-muted">—</span>'}</td>
                <td class="text-muted">${formatDate(s.created_at)}</td>
                <td class="rv-actions">
                  <button class="btn btn-secondary btn-sm rv-open-btn" data-id="${s.id}" title="Open checklist">Open</button>
                  <button class="btn btn-ghost btn-sm rv-findings-btn" data-id="${s.id}" title="View findings">Findings</button>
                  ${s.status !== 'completed' && s.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm rv-cancel-btn" data-id="${s.id}" title="Cancel">Cancel</button>` : ''}
                  ${s.created_by === currentUserId ? `<button class="btn btn-ghost btn-sm rv-delete-btn" data-id="${s.id}" title="Delete review">Delete</button>` : ''}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('.rv-open-btn').forEach(btn => {
      btn.onclick = () => navigate(`${base}/reviews/${btn.dataset.id}/execute`);
    });
    wrap.querySelectorAll('.rv-findings-btn').forEach(btn => {
      btn.onclick = () => navigate(`${base}/reviews/${btn.dataset.id}/findings`);
    });
    wrap.querySelectorAll('.rv-cancel-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Cancel this review session?')) return;
        const { error } = await sb.from('review_sessions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', btn.dataset.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('Session cancelled.', 'success');
        await loadSessions();
      };
    });
    wrap.querySelectorAll('.rv-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this review session and all its data (snapshots, findings, responses)? This cannot be undone.')) return;
        const { error } = await sb.from('review_sessions').delete().eq('id', btn.dataset.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('Review session deleted.', 'success');
        await loadSessions();
      };
    });
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
