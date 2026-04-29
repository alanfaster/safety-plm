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
    sb.from('review_session_reviewers').select('*').eq('session_id', sessionId),
    sb.from('review_checklist_responses').select('*').eq('session_id', sessionId),
    sb.from('review_findings').select('*').eq('session_id', sessionId).order('created_at'),
    sb.from('review_artifact_verdicts').select('*').eq('session_id', sessionId),
  ]);

  if (!session) { container.innerHTML = `<p style="padding:40px">Session not found.</p>`; return; }

  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  // Fetch reviewer display names separately (no FK between review_session_reviewers and user_profiles)
  const reviewerUserIds = (reviewers || []).map(r => r.user_id).filter(Boolean);
  let reviewerProfileMap = {};
  if (reviewerUserIds.length) {
    const { data: rvProfiles } = await sb.from('user_profiles')
      .select('user_id, display_name').in('user_id', reviewerUserIds);
    (rvProfiles || []).forEach(p => { reviewerProfileMap[p.user_id] = p.display_name; });
  }
  const reviewerList = (reviewers || []).map(r => ({
    user_id:      r.user_id,
    role:         r.role,
    display_name: reviewerProfileMap[r.user_id] || r.user_id?.slice(0, 8),
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

  // Artifact list panel state
  let _listExpanded    = false;
  let _propsCollapsed  = false;
  let _artlistWidth    = parseInt(localStorage.getItem('alm_artlist_width') || '750', 10);
  let _colFilters      = {};   // { [colName]: string | Set }  — per-column filter values
  // Columns visible in expanded table mode
  const SKIP_FIELDS = new Set(['id','created_at','updated_at','project_id','parent_id','parent_type','domain','session_id']);
  const ALL_COLS    = buildAvailableColumns(snapshots || []);
  // Default: show a useful subset; user can toggle
  const DEFAULT_VIS = new Set(['code','title','status','type','priority']);
  let _visCols   = new Set(ALL_COLS.filter(c => DEFAULT_VIS.has(c)));
  if (!_visCols.size) ALL_COLS.slice(0, 4).forEach(c => _visCols.add(c));
  let _colOrder  = [...ALL_COLS];  // mutable display order, drag-reorderable

  function buildAvailableColumns(snaps) {
    const seen = new Set(['code','title']); // always first
    snaps.forEach(s => {
      const d = s.snapshot_data || {};
      Object.keys(d).forEach(k => { if (!SKIP_FIELDS.has(k)) seen.add(k); });
    });
    // Normalise: req_code→code, spec_code→code, test_code→code already mapped in fetcher
    ['req_code','spec_code','test_code','analysis_code','name'].forEach(k => seen.delete(k));
    return [...seen];
  }

  function buildExpandedToolbar() {
    return `
      <div class="rve-artlist-actions">
        <button class="btn btn-ghost btn-xs" id="rve-col-picker-btn" title="Show/hide columns">⊞ Columns</button>
        <button class="btn btn-ghost btn-xs" id="rve-list-toggle" title="Collapse list">⊟ Collapse</button>
      </div>`;
  }

  // ── Diff modal ───────────────────────────────────────────────────────────────

  async function openDiffModal(snap) {
    const tableMap = { requirements:'requirements', arch_spec_items:'arch_spec_items', test_specs:'test_specs', safety_analysis_rows:'safety_analyses' };
    const table = tableMap[snap.artifact_type];
    if (!table) return;
    const { data: live } = await sb.from(table).select('*').eq('id', snap.artifact_id).single();
    if (!live) return;

    document.querySelector('.rvck-diff-overlay')?.remove();

    const frozen   = snap.snapshot_data || {};
    const skipKeys = new Set(['id','created_at','updated_at','project_id','parent_id','parent_type','session_id']);
    const allKeys  = [...new Set([...Object.keys(frozen), ...Object.keys(live)])].filter(k => !skipKeys.has(k));
    const changed  = allKeys.filter(k => String(frozen[k] ?? '') !== String(live[k] ?? ''));
    const same     = allKeys.filter(k => String(frozen[k] ?? '') === String(live[k] ?? ''));

    const fieldRow = (k, a, b, highlight) => `
      <div class="diff-row${highlight ? ' diff-row-changed' : ''}">
        <div class="diff-field-name">${escHtml(k.replace(/_/g,' '))}</div>
        <div class="diff-col diff-col-old">${escHtml(String(a ?? '—'))}</div>
        <div class="diff-col diff-col-new">${escHtml(String(b ?? '—'))}</div>
      </div>`;

    const changedRows = changed.map(k => fieldRow(k, frozen[k], live[k], true)).join('');
    const sameRows    = same.map(k => fieldRow(k, frozen[k], live[k], false)).join('');

    // Findings for this artifact that are closeable (open/accepted/fixed, current user is creator)
    const snapFindings = _findings.filter(f => f.snapshot_id === snap.id && !['closed','rejected'].includes(f.status));

    const findingRows = snapFindings.map(f => `
      <div class="diff-finding-row" data-fid="${f.id}">
        <div class="diff-finding-info">
          <span class="mono diff-finding-code">${escHtml(f.finding_code)}</span>
          <span class="badge ${SEVERITY_CLASSES[f.severity] || ''}">${SEVERITY_LABELS[f.severity] || f.severity}</span>
          <span class="diff-finding-title">${escHtml(f.title)}</span>
          <span class="badge rv-fs-${f.status}">${FINDING_STATUS_LABELS[f.status] || f.status}</span>
        </div>
        ${f.created_by === currentUserId
          ? `<button class="btn btn-primary btn-xs diff-close-finding-btn" data-fid="${f.id}">✓ Accept fix</button>`
          : `<span class="text-muted" style="font-size:11px">Creator can close</span>`}
      </div>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'rvck-diff-overlay';
    overlay.innerHTML = `
      <div class="rvck-diff-modal">
        <div class="rvck-diff-header">
          <div class="rvck-diff-header-left">
            <span class="rvck-diff-artifact-code">${escHtml(snap.artifact_code || snap.artifact_type)}</span>
            <span class="rvck-diff-artifact-title">${escHtml(snap.artifact_title || '')}</span>
          </div>
          <button class="btn btn-ghost btn-sm rvck-diff-close" title="Close">✕</button>
        </div>

        <div class="rvck-diff-body">
          <div class="diff-cols-header">
            <div class="diff-field-name"></div>
            <div class="diff-col-label">Snapshot (review baseline)</div>
            <div class="diff-col-label diff-col-label-new">Current version</div>
          </div>

          ${changed.length ? `
            <div class="diff-section-label diff-section-changed">
              ${changed.length} field${changed.length > 1 ? 's' : ''} changed
            </div>
            ${changedRows}` : `<div class="diff-no-changes">No field changes detected.</div>`}

          ${same.length ? `
            <details class="diff-unchanged-details">
              <summary class="diff-unchanged-summary">${same.length} unchanged field${same.length > 1 ? 's' : ''}</summary>
              ${sameRows}
            </details>` : ''}
        </div>

        ${snapFindings.length ? `
          <div class="rvck-diff-findings">
            <div class="diff-findings-label">Findings on this artifact</div>
            <div class="diff-findings-list" id="diff-findings-list">
              ${findingRows}
            </div>
          </div>` : ''}

        <div class="rvck-diff-footer">
          <button class="btn btn-ghost btn-sm rvck-diff-close">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('.rvck-diff-close').forEach(b => b.onclick = () => overlay.remove());
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelectorAll('.diff-close-finding-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fid = btn.dataset.fid;
        const f   = _findings.find(x => x.id === fid);
        if (!f) return;
        const row = overlay.querySelector(`.diff-finding-row[data-fid="${fid}"]`);
        if (row.querySelector('.diff-close-form')) return;

        btn.style.display = 'none';
        const form = document.createElement('div');
        form.className = 'diff-close-form';
        form.innerHTML = `
          <textarea class="form-input diff-close-comment" rows="2"
            placeholder="Comment on the fix (required)…" style="width:100%;margin-top:6px"></textarea>
          <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
            <button class="btn btn-ghost btn-xs diff-close-cancel">Cancel</button>
            <button class="btn btn-primary btn-xs diff-close-ok">✓ Confirm fix & close</button>
          </div>`;
        row.appendChild(form);
        form.querySelector('.diff-close-comment').focus();

        form.querySelector('.diff-close-cancel').onclick = () => { form.remove(); btn.style.display = ''; };
        form.querySelector('.diff-close-ok').onclick = async () => {
          const comment = form.querySelector('.diff-close-comment').value.trim();
          if (!comment) { form.querySelector('.diff-close-comment').focus(); return; }
          const okBtn = form.querySelector('.diff-close-ok');
          okBtn.disabled = true;

          const { error } = await sb.from('review_findings')
            .update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', fid);
          if (error) { toast('Error: ' + error.message, 'error'); okBtn.disabled = false; return; }

          await sb.from('review_finding_comments').insert({
            finding_id: fid, author_id: currentUserId,
            comment: `[Closed] ${comment}`,
          });

          f.status = 'closed';
          toast(`${f.finding_code} closed.`, 'success');
          row.innerHTML = `<div class="diff-finding-info">
            <span class="mono diff-finding-code">${escHtml(f.finding_code)}</span>
            <span class="badge rv-fs-closed">Closed</span>
            <span class="diff-finding-title">${escHtml(f.title)}</span>
          </div>`;
          refreshArtifactCard(snap);
          mountChecklist(snap);
        };
      });
    });
  }

  const FINDING_STATUS_LABELS = {
    open:'Open', accepted:'Accepted', fixed:'Implemented – pending review', closed:'Closed', rejected:'Rejected',
  };

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
            <button class="btn btn-ghost btn-sm" id="rve-btn-refresh" title="Refresh responses and findings from other reviewers">↺ Refresh</button>
            ${session.status === 'in_progress' ? `<button class="btn btn-primary btn-sm" id="rve-btn-complete">✓ Complete Review</button>` : ''}
          </div>
        </div>
        <div class="rve-tab-body" id="rve-tab-body">${renderReviewTab()}</div>
      </div>
    `;

    document.getElementById('rve-btn-complete')?.addEventListener('click', completeSession);
    document.getElementById('rve-btn-refresh')?.addEventListener('click', () => refreshFromServer());
    wireReviewTab();
  }

  // ── Tab 1: Review (3-column layout) ──────────────────────────────────────────

  function renderReviewTab() {
    const artlistStyle = _listExpanded ? `style="width:${_artlistWidth}px"` : '';
    return `
      <div class="rve-body">
        <div class="rve-artifact-list ${_listExpanded ? 'rve-artifact-list--expanded' : ''}"
             id="rve-artifact-list" ${artlistStyle}>
          <div class="rve-artlist-toolbar" id="rve-artlist-toolbar">
            ${_listExpanded ? buildExpandedToolbar() : `
              <span class="rve-artlist-title">Artifacts <span class="rve-artlist-count">(${(snapshots||[]).length})</span></span>
              <button class="btn btn-ghost btn-xs" id="rve-list-toggle" title="Expand artifact table">⊞ Expand</button>`}
          </div>
          <div id="rve-artlist-body">
            ${renderArtifactListBody()}
          </div>
          ${_listExpanded ? '<div class="rve-artlist-resize-handle" id="rve-artlist-resize-handle"></div>' : ''}
        </div>
        <div class="rve-checklist-col" id="rve-checklist-col"></div>
        <div class="rve-props-panel ${_propsCollapsed ? 'rve-props-panel--collapsed' : ''}" id="rve-props-panel">
          ${_propsCollapsed
            ? `<button class="rve-props-toggle-btn rve-props-toggle-btn--collapsed" id="rve-props-toggle-btn" title="Expand properties">
                 <span class="rve-props-panel-title">Properties</span>
                 <span class="rve-props-toggle-icon">▶</span>
               </button>`
            : `<div class="rve-props-header">
                 <span class="rve-props-header-title">Properties</span>
                 <button class="rve-props-toggle-btn" id="rve-props-toggle-btn" title="Collapse properties">◀</button>
               </div>
               <div class="rve-props-placeholder text-muted">Select an artifact to view its properties.</div>`}
        </div>
      </div>
    `;
  }

  function renderArtifactListBody() {
    if (!snapshots?.length) return '<p class="rv-empty" style="padding:16px">No artifacts in this session.</p>';
    return _listExpanded ? renderArtifactTable() : renderArtifactCards();
  }

  function renderArtifactCards() {
    return (snapshots || []).map(snap => renderArtifactCard(snap)).join('');
  }

  // Returns the display value for a cell (shared between table render and filter logic)
  function getCellValue(snap, col) {
    const d = snap.snapshot_data || {};
    if (col === 'code')  return snap.artifact_code  || d.req_code || d.spec_code || d.test_code || d.analysis_code || '';
    if (col === 'title') return snap.artifact_title || d.title    || d.name      || '';
    return String(d[col] ?? '');
  }

  // Distinct non-empty values for a column across all snapshots
  function getColDistinctValues(col) {
    const vals = new Set();
    (snapshots || []).forEach(s => { const v = getCellValue(s, col); if (v) vals.add(v); });
    return [...vals].sort();
  }

  // A column is "list" type when it has between 2 and 12 distinct values
  function isListCol(col) {
    const v = getColDistinctValues(col);
    return v.length >= 2 && v.length <= 12;
  }

  function renderArtifactTable() {
    const visArr      = _colOrder.filter(c => _visCols.has(c));
    const showProgress = sections.length > 0;
    const colPretty    = c => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // Filter: text = substring match; Set = must be in the set
    const filtered = (snapshots || []).filter(snap => {
      return Object.entries(_colFilters).every(([col, fv]) => {
        if (!fv || (fv instanceof Set && fv.size === 0)) return true;
        const val = getCellValue(snap, col);
        if (fv instanceof Set) return fv.has(val);
        return val.toLowerCase().includes(fv.toLowerCase());
      });
    });

    const labelRow = [
      '<th class="rve-atbl-status-col"></th>',
      ...visArr.map(c => `<th class="rve-atbl-th-drag" draggable="true" data-col="${c}">
        <span class="rve-atbl-th-label">${escHtml(colPretty(c))}</span>
        <span class="rve-atbl-th-grip" title="Drag to reorder">⠿</span>
      </th>`),
      showProgress ? '<th>Progress</th>' : '',
      '<th>Findings</th>',
    ].join('');

    const filterRow = [
      '<th class="rve-atbl-filter-spacer"></th>',
      ...visArr.map(c => {
        if (isListCol(c)) {
          const active = _colFilters[c] instanceof Set ? _colFilters[c] : null;
          const label  = active?.size ? `✓ ${active.size} selected` : '▼ All';
          return `<th class="rve-atbl-filter-cell">
            <button class="rve-atbl-list-filter-btn ${active?.size ? 'rve-atbl-list-filter-btn--active' : ''}"
              data-col="${c}" data-filter-type="list">${escHtml(label)}</button>
          </th>`;
        }
        const val = typeof _colFilters[c] === 'string' ? _colFilters[c] : '';
        return `<th class="rve-atbl-filter-cell">
          <input class="rve-atbl-col-filter" data-col="${c}"
            placeholder="…" value="${escHtml(val)}" title="Filter ${colPretty(c)}"/>
        </th>`;
      }),
      showProgress ? '<th></th>' : '',
      '<th></th>',
    ].join('');

    const rows = filtered.map(snap => {
      const d        = snap.snapshot_data || {};
      const isActive = _selectedSnapshot?.id === snap.id;
      const mv       = _artifactVerdicts.find(v => v.snapshot_id === snap.id && v.reviewer_id === currentUserId)?.verdict;
      const drifted  = !!driftMap[snap.artifact_id];
      const isShared = session.checklist_mode === 'shared';
      const ckSnapId = isShared ? (snapshots?.[0]?.id || snap.id) : snap.id;
      const snapResponses = _allResponses.filter(r => r.snapshot_id === ckSnapId && r.reviewer_id === currentUserId);
      const totalItems    = sections.reduce((s, sec) => s + (sec.items?.length || 0), 0);
      const myDone        = snapResponses.length;
      const pct           = totalItems ? Math.round(myDone / totalItems * 100) : 0;
      const openFnds      = _findings.filter(f => f.snapshot_id === snap.id && f.status === 'open').length;
      const allFnds       = _findings.filter(f => f.snapshot_id === snap.id).length;

      const dataCells = visArr.map(c => {
        const val = getCellValue(snap, c);
        if (c === 'status') return `<td><span class="badge badge-${escHtml(val || 'draft')}">${escHtml(val || '—')}</span></td>`;
        return `<td class="${c === 'code' ? 'mono' : ''}" title="${escHtml(val)}">${escHtml(val || '—')}</td>`;
      }).join('');

      const verdictIndicator = mv
        ? `<span class="rve-atbl-verdict rve-atbl-verdict--${mv}" title="${FINAL_VERDICT_LABELS[mv]}">${mv === 'go' ? '✓' : mv === 'no_go' ? '✗' : '⚑'}</span>`
        : '';
      const driftIndicator = drifted ? `<span class="rve-drift-badge" title="Changed since snapshot">⚠</span>` : '';

      const progressCell = showProgress ? `<td>
        <div class="rve-atbl-progress-wrap">
          <div class="rve-progress-bar rve-atbl-progress"><div class="rve-progress-fill" style="width:${pct}%"></div></div>
          <span class="rve-atbl-progress-label">${myDone}/${totalItems}</span>
        </div></td>` : '';

      const findingsCell = `<td>${allFnds
        ? `<span class="rve-atbl-fnds ${openFnds ? 'rve-atbl-fnds--open' : 'rve-atbl-fnds--closed'}">⚑ ${openFnds ? openFnds + ' open' : allFnds + ' closed'}</span>`
        : '<span class="text-muted" style="font-size:11px">—</span>'}</td>`;

      return `<tr class="rve-atbl-row ${isActive ? 'rve-atbl-row--active' : ''}" data-snap-id="${snap.id}">
        <td class="rve-atbl-status-col">${verdictIndicator}${driftIndicator}</td>
        ${dataCells}${progressCell}${findingsCell}
      </tr>`;
    }).join('');

    const hasActiveFilters = Object.values(_colFilters).some(v => v instanceof Set ? v.size > 0 : !!v);
    const emptyMsg = hasActiveFilters
      ? `No artifacts match the active filters. <button class="btn btn-ghost btn-xs rve-clear-filters-btn">Clear all filters</button>`
      : 'No artifacts in this session.';

    return `
      <div class="rve-atbl-wrap">
        <table class="rve-atbl" id="rve-atbl">
          <thead>
            <tr class="rve-atbl-label-row">${labelRow}</tr>
            <tr class="rve-atbl-filter-row">${filterRow}</tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="99" class="rve-atbl-empty">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  function rebuildArtifactList() {
    const list = document.getElementById('rve-artifact-list');
    if (!list) return;
    list.className = `rve-artifact-list${_listExpanded ? ' rve-artifact-list--expanded' : ''}`;
    list.style.width = _listExpanded ? `${_artlistWidth}px` : '';

    list.querySelector('#rve-artlist-toolbar').innerHTML = _listExpanded
      ? buildExpandedToolbar()
      : `<span class="rve-artlist-title">Artifacts <span class="rve-artlist-count">(${(snapshots||[]).length})</span></span>
         <button class="btn btn-ghost btn-xs" id="rve-list-toggle" title="Expand">⊞ Expand</button>`;
    list.querySelector('#rve-artlist-body').innerHTML = renderArtifactListBody();

    // Ensure resize handle present only in expanded mode
    list.querySelector('.rve-artlist-resize-handle')?.remove();
    if (_listExpanded) {
      const handle = document.createElement('div');
      handle.className = 'rve-artlist-resize-handle';
      handle.id = 'rve-artlist-resize-handle';
      list.appendChild(handle);
    }

    wireArtifactListInteractions(list);
    if (_selectedSnapshot) {
      list.querySelectorAll(`[data-snap-id="${_selectedSnapshot.id}"]`).forEach(el => {
        el.classList.add('active'); el.classList.add('rve-atbl-row--active');
      });
    }
  }

  function wireArtifactListInteractions(root) {
    root = root || document.getElementById('rve-artifact-list');
    if (!root) return;

    root.querySelector('#rve-list-toggle')?.addEventListener('click', () => {
      _listExpanded = !_listExpanded;
      if (_listExpanded) {
        _artlistWidth = Math.max(600, _artlistWidth);
      }
      rebuildArtifactList();
      if (!_listExpanded && _selectedSnapshot) loadPropsPanel();
    });

    // Resize handle drag
    const handle = root.querySelector('#rve-artlist-resize-handle');
    if (handle) {
      let startX, startW;
      const onMove = e => {
        const dx = e.clientX - startX;
        const body = document.getElementById('rve-body') || root.parentElement;
        const maxW = body ? body.clientWidth - 200 : 1400; // leave minimum room for checklist
        _artlistWidth = Math.max(260, Math.min(maxW, startW + dx));
        root.style.width = `${_artlistWidth}px`;
      };
      const onUp = () => {
        localStorage.setItem('alm_artlist_width', String(_artlistWidth));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        startX = e.clientX;
        startW = root.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    root.querySelector('#rve-col-picker-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openColPicker(root.querySelector('#rve-col-picker-btn'));
    });

    // Text filter inputs
    root.querySelectorAll('.rve-atbl-col-filter').forEach(inp => {
      inp.addEventListener('input', e => {
        e.stopPropagation();
        _colFilters[inp.dataset.col] = e.target.value;
        rebuildTbody(root);
        updateFilterCountBadge(root);
      });
      inp.addEventListener('click', e => e.stopPropagation());
    });

    // List filter buttons (multi-select popover)
    root.querySelectorAll('.rve-atbl-list-filter-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openListFilterPopover(btn, btn.dataset.col, root);
      });
    });

    wireColDrag(root);

    // Clear-all-filters button (shown when results are empty)
    root.querySelector('.rve-clear-filters-btn')?.addEventListener('click', () => {
      _colFilters = {};
      root.querySelector('#rve-artlist-body').innerHTML = renderArtifactListBody();
      wireArtifactListInteractions(root);
    });

    wireRowClicks(root);
  }

  function wireRowClicks(root) {
    root.querySelectorAll('[data-snap-id]').forEach(el => {
      // Skip filter inputs that happen to be inside a [data-snap-id] ancestor
      if (el.tagName === 'INPUT') return;
      el.addEventListener('click', () => {
        const snapId = el.dataset.snapId;
        _selectedSnapshot = (snapshots || []).find(s => s.id === snapId);
        root.querySelectorAll('.rve-art-card').forEach(c => c.classList.toggle('active', c.dataset.snapId === snapId));
        root.querySelectorAll('.rve-atbl-row').forEach(r => r.classList.toggle('rve-atbl-row--active', r.dataset.snapId === snapId));
        loadArtifactPanel();
      });
    });
  }

  function rebuildTbody(root) {
    const tbody = root.querySelector('#rve-atbl tbody');
    if (!tbody) return;
    const tmp = document.createElement('table');
    tmp.innerHTML = renderArtifactTable();
    const newTbody = tmp.querySelector('tbody');
    if (newTbody) tbody.replaceWith(newTbody);
    wireRowClicks(root);
  }

  function updateFilterCountBadge(root) {
    const active = Object.values(_colFilters).filter(v => v instanceof Set ? v.size > 0 : !!v).length;
    const toolbar = root.querySelector('#rve-artlist-toolbar');
    if (!toolbar) return;
    let badge = toolbar.querySelector('.rve-filter-active-badge');
    if (active > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'rve-filter-active-badge';
        toolbar.prepend(badge);
      }
      badge.textContent = `${active} filter${active > 1 ? 's' : ''} active`;
    } else {
      badge?.remove();
    }
  }

  function openListFilterPopover(anchor, col, root) {
    document.getElementById('rve-list-filter-popover')?.remove();

    const allVals    = getColDistinctValues(col);
    const activeSet  = _colFilters[col] instanceof Set ? _colFilters[col] : new Set(allVals); // all selected by default
    const colPretty  = col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    const popover = document.createElement('div');
    popover.id = 'rve-list-filter-popover';
    popover.className = 'rve-list-filter-popover';
    popover.innerHTML = `
      <div class="rve-lfp-header">
        <strong>${escHtml(colPretty)}</strong>
        <button class="btn btn-ghost btn-xs rve-lfp-close">✕</button>
      </div>
      <div class="rve-lfp-actions">
        <button class="btn btn-ghost btn-xs rve-lfp-all">Select all</button>
        <button class="btn btn-ghost btn-xs rve-lfp-none">Clear</button>
      </div>
      <div class="rve-lfp-list">
        ${allVals.map(v => `
          <label class="rve-lfp-item">
            <input type="checkbox" class="rve-lfp-chk" value="${escHtml(v)}" ${activeSet.has(v) ? 'checked' : ''}/>
            <span class="rve-lfp-val">${escHtml(v || '(empty)')}</span>
          </label>`).join('')}
      </div>
      <div class="rve-lfp-footer">
        <button class="btn btn-secondary btn-sm rve-lfp-apply">Apply</button>
      </div>`;

    document.body.appendChild(popover);

    // Position below the anchor button
    const rect = anchor.getBoundingClientRect();
    popover.style.left = Math.max(4, rect.left) + 'px';
    popover.style.top  = (rect.bottom + 4 + window.scrollY) + 'px';

    const getChecked = () => new Set([...popover.querySelectorAll('.rve-lfp-chk:checked')].map(c => c.value));

    popover.querySelector('.rve-lfp-close').onclick = () => popover.remove();
    popover.querySelector('.rve-lfp-all').onclick   = () => popover.querySelectorAll('.rve-lfp-chk').forEach(c => c.checked = true);
    popover.querySelector('.rve-lfp-none').onclick  = () => popover.querySelectorAll('.rve-lfp-chk').forEach(c => c.checked = false);

    popover.querySelector('.rve-lfp-apply').onclick = () => {
      const sel = getChecked();
      // If all values selected = no filter; otherwise store the set
      _colFilters[col] = sel.size === allVals.length ? new Set() : sel;
      popover.remove();
      // Rebuild filter row button + tbody
      const filterRow = root.querySelector('.rve-atbl-filter-row');
      if (filterRow) {
        const tmp = document.createElement('table');
        tmp.innerHTML = renderArtifactTable();
        const newFR = tmp.querySelector('.rve-atbl-filter-row');
        if (newFR) filterRow.replaceWith(newFR);
        // Re-wire list filter buttons in the new row
        root.querySelectorAll('.rve-atbl-list-filter-btn').forEach(btn => {
          btn.addEventListener('click', e => { e.stopPropagation(); openListFilterPopover(btn, btn.dataset.col, root); });
        });
      }
      rebuildTbody(root);
      updateFilterCountBadge(root);
    };

    const closeOut = e => { if (!popover.contains(e.target) && e.target !== anchor) { popover.remove(); document.removeEventListener('click', closeOut); } };
    setTimeout(() => document.addEventListener('click', closeOut), 0);
  }

  function wireColDrag(root) {
    const headers = [...root.querySelectorAll('.rve-atbl-th-drag')];
    if (!headers.length) return;

    let dragSrc = null;

    headers.forEach(th => {
      th.addEventListener('dragstart', e => {
        dragSrc = th.dataset.col;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSrc);
        th.classList.add('rve-atbl-th--dragging');
      });

      th.addEventListener('dragend', () => {
        headers.forEach(h => h.classList.remove('rve-atbl-th--dragging', 'rve-atbl-th--drag-over'));
        dragSrc = null;
      });

      th.addEventListener('dragover', e => {
        if (!dragSrc || th.dataset.col === dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        headers.forEach(h => h.classList.remove('rve-atbl-th--drag-over'));
        th.classList.add('rve-atbl-th--drag-over');
      });

      th.addEventListener('dragleave', () => th.classList.remove('rve-atbl-th--drag-over'));

      th.addEventListener('drop', e => {
        e.preventDefault();
        const targetCol = th.dataset.col;
        if (!dragSrc || dragSrc === targetCol) return;

        // Reorder _colOrder: move dragSrc to position of targetCol
        const fromIdx = _colOrder.indexOf(dragSrc);
        const toIdx   = _colOrder.indexOf(targetCol);
        if (fromIdx === -1 || toIdx === -1) return;
        _colOrder.splice(fromIdx, 1);
        _colOrder.splice(toIdx, 0, dragSrc);

        // Rebuild the whole table body + header (preserve filter state)
        const body = root.querySelector('#rve-artlist-body');
        if (body) {
          body.innerHTML = renderArtifactListBody();
          wireArtifactListInteractions(root);
          if (_selectedSnapshot) {
            root.querySelectorAll(`[data-snap-id="${_selectedSnapshot.id}"]`)
              .forEach(el => el.classList.add('rve-atbl-row--active'));
          }
        }
      });
    });
  }

  function wirePropsPanel() {
    document.getElementById('rve-props-toggle-btn')?.addEventListener('click', () => {
      _propsCollapsed = !_propsCollapsed;
      const propsPanel = document.getElementById('rve-props-panel');
      if (!propsPanel) return;
      if (_propsCollapsed) {
        propsPanel.className = 'rve-props-panel rve-props-panel--collapsed';
        propsPanel.innerHTML = `
          <button class="rve-props-toggle-btn rve-props-toggle-btn--collapsed" id="rve-props-toggle-btn" title="Expand properties">
            <span class="rve-props-panel-title">Properties</span>
            <span class="rve-props-toggle-icon">▶</span>
          </button>`;
        wirePropsPanel();
      } else {
        propsPanel.className = 'rve-props-panel';
        if (_selectedSnapshot) loadPropsPanel();
        else {
          propsPanel.innerHTML = `
            <div class="rve-props-header">
              <span class="rve-props-header-title">Properties</span>
              <button class="rve-props-toggle-btn" id="rve-props-toggle-btn" title="Collapse properties">◀</button>
            </div>
            <div class="rve-props-placeholder text-muted">Select an artifact to view its properties.</div>`;
          wirePropsPanel();
        }
      }
    });
  }

  function openColPicker(anchor) {
    document.getElementById('rve-col-picker-popover')?.remove();
    const popover = document.createElement('div');
    popover.id = 'rve-col-picker-popover';
    popover.className = 'rve-col-picker-popover';
    popover.innerHTML = `
      <div class="rve-col-picker-header">
        <strong>Visible Columns</strong>
        <button class="btn btn-ghost btn-xs rve-col-picker-close">✕</button>
      </div>
      <div class="rve-col-picker-list">
        ${ALL_COLS.map(c => `
          <label class="rve-col-picker-item">
            <input type="checkbox" data-col="${c}" ${_visCols.has(c) ? 'checked' : ''}/>
            <span>${c.replace(/_/g,' ')}</span>
          </label>`).join('')}
      </div>`;
    document.body.appendChild(popover);

    const rect = anchor.getBoundingClientRect();
    popover.style.top  = (rect.bottom + 4 + window.scrollY) + 'px';
    popover.style.left = Math.max(0, rect.right - popover.offsetWidth) + 'px';

    popover.querySelector('.rve-col-picker-close').onclick = () => popover.remove();
    const closeOnClickOutside = e => { if (!popover.contains(e.target)) { popover.remove(); document.removeEventListener('click', closeOnClickOutside); } };
    setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);

    popover.querySelectorAll('input[type=checkbox]').forEach(chk => {
      chk.onchange = () => {
        if (chk.checked) _visCols.add(chk.dataset.col);
        else _visCols.delete(chk.dataset.col);
        document.getElementById('rve-artlist-body').innerHTML = renderArtifactListBody();
        wireArtifactListInteractions(document.getElementById('rve-artifact-list'));
      };
    });
  }

  function wireReviewTab() {
    const list = document.getElementById('rve-artifact-list');
    if (list) wireArtifactListInteractions(list);
    if (_selectedSnapshot) {
      list?.querySelectorAll(`[data-snap-id="${_selectedSnapshot.id}"]`).forEach(el => {
        el.classList.add('active'); el.classList.add('rve-atbl-row--active');
      });
    }
    wirePropsPanel();
    // Always mount checklist; load first artifact properties
    mountChecklist();
    if (_selectedSnapshot && !_propsCollapsed) loadPropsPanel();
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
        ${drifted ? `<div class="rve-obsolete-badge">OBSOLETE</div>` : ''}
      </div>
    `;
  }

  // Mounts the checklist once in the middle column — stays mounted across artifact switches
  function mountChecklist(snap) {
    const col = document.getElementById('rve-checklist-col');
    if (!col) return;

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
    if (!panel || !_selectedSnapshot || _propsCollapsed) return;

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
      const { data: profiles } = await sb.from('user_profiles').select('user_id, display_name').in('user_id', authorIds);
      (profiles || []).forEach(p => { profileMap[p.user_id] = p.display_name; });
    }
    const _comments = rows.map(c => ({ ...c, user_profiles: { display_name: profileMap[c.author_id] || null } }));

    panel.innerHTML = `
      <div class="rve-props-header">
        <span class="rve-props-header-title">Properties</span>
        <button class="rve-props-toggle-btn" id="rve-props-toggle-btn" title="Collapse properties">◀</button>
      </div>
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
              <button class="btn btn-ghost btn-sm" id="rve-props-compare">Compare versions</button>
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

    wirePropsPanel();  // re-wire toggle after innerHTML replace
    panel.querySelector('#rve-props-compare')?.addEventListener('click', () => openDiffModal(snap));

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
      const { data: profile } = await sb.from('user_profiles').select('display_name').eq('user_id', currentUserId).single();
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
    if (_listExpanded) {
      // In table mode — rebuild body to reflect updated data
      const body = document.getElementById('rve-artlist-body');
      if (body) {
        body.innerHTML = renderArtifactListBody();
        wireArtifactListInteractions(document.getElementById('rve-artifact-list'));
      }
      return;
    }
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

  // ── Live refresh (parallel reviewers) ───────────────────────────────────────
  let _refreshTimer = null;

  async function refreshFromServer(silent = false) {
    const btn = document.getElementById('rve-btn-refresh');
    if (btn && !silent) { btn.disabled = true; btn.textContent = '↺ …'; }

    const [{ data: freshResponses }, { data: freshFindings }] = await Promise.all([
      sb.from('review_checklist_responses').select('*').eq('session_id', sessionId),
      sb.from('review_findings').select('*').eq('session_id', sessionId).order('created_at'),
    ]);

    let changed = false;

    // Merge new responses (don't overwrite current user's in-flight edits)
    (freshResponses || []).forEach(r => {
      if (r.reviewer_id === currentUserId) return; // skip own — already up to date
      const existing = _allResponses.find(x =>
        x.snapshot_id === r.snapshot_id && x.template_item_id === r.template_item_id && x.reviewer_id === r.reviewer_id);
      if (!existing) { _allResponses.push(r); changed = true; }
      else if (existing.verdict !== r.verdict || existing.comment !== r.comment) {
        existing.verdict = r.verdict; existing.comment = r.comment; changed = true;
      }
    });

    // Merge new findings
    (freshFindings || []).forEach(f => {
      const existing = _findings.find(x => x.id === f.id);
      if (!existing) { _findings.push(f); changed = true; }
      else if (existing.status !== f.status) { existing.status = f.status; changed = true; }
    });

    if (changed && _selectedSnapshot) mountChecklist(_selectedSnapshot);
    if (changed) (snapshots || []).forEach(s => refreshArtifactCard(s));

    if (btn && !silent) { btn.disabled = false; btn.textContent = '↺ Refresh'; }
    if (!silent && changed) toast('Updated with latest responses.', 'success');
  }

  // Auto-poll every 30s while session is in_progress
  if (session.status === 'in_progress') {
    _refreshTimer = setInterval(() => refreshFromServer(true), 30000);
    // Stop polling when user navigates away
    const stopPoll = () => { clearInterval(_refreshTimer); window.removeEventListener('hashchange', stopPoll); };
    window.addEventListener('hashchange', stopPoll);
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
