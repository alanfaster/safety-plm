/**
 * Review Checklist Component
 * Renders the checklist for one artifact snapshot, supporting multiple reviewers.
 *
 * mountReviewChecklist(container, {
 *   session, snapshot, sections, allResponses, currentUserId,
 *   reviewers, findings, onSaved, onFindingRaise, onReSnapshotRequest
 * })
 *
 * sections: [{ id, name, sort_order, items: [{id, criterion, guidance, is_mandatory}] }]
 * allResponses: all review_checklist_responses rows for this snapshot (all reviewers)
 * reviewers: [{ user_id, role, display_name }]
 * findings: review_findings rows for this snapshot
 */

const VERDICT_LABELS = { ok: 'OK', nok: 'NOK', partially_ok: 'Partially OK', na: 'N/A' };
const VERDICT_CLASSES = { ok: 'rv-v-ok', nok: 'rv-v-nok', partially_ok: 'rv-v-partial', na: 'rv-v-na' };

const ARTIFACT_DISPLAY_FIELDS = {
  requirements:         ['req_code','title','description','type','status','priority','asil','dal'],
  arch_spec_items:      ['spec_code','title','type','status'],
  test_specs:           ['test_code','name','description','level','status','method'],
  safety_analysis_rows: ['analysis_code','title','analysis_type','status'],
  vcycle_docs:          ['title','status'],
};

export function mountReviewChecklist(container, opts) {
  const {
    session, snapshot, sections, allResponses, currentUserId,
    reviewers, findings = [], onSaved, onFindingRaise, onReSnapshotRequest,
    isDrifted = false,
  } = opts;

  // Index responses: { [itemId]: { [reviewerId]: responseRow } }
  const responseIndex = {};
  (allResponses || []).forEach(r => {
    if (!responseIndex[r.template_item_id]) responseIndex[r.template_item_id] = {};
    responseIndex[r.template_item_id][r.reviewer_id] = r;
  });

  // Index findings: { [itemId]: [finding] }
  const findingsByItem = {};
  (findings || []).forEach(f => {
    const resp = (allResponses || []).find(r => r.id === f.response_id);
    if (resp) {
      if (!findingsByItem[resp.template_item_id]) findingsByItem[resp.template_item_id] = [];
      findingsByItem[resp.template_item_id].push(f);
    }
  });

  const reviewerMap = {};
  (reviewers || []).forEach(r => { reviewerMap[r.user_id] = r; });

  let _activeTab = sections?.[0]?.id || null;

  render();

  function render() {
    const data = snapshot.snapshot_data || {};
    const fields = ARTIFACT_DISPLAY_FIELDS[snapshot.artifact_type] || ['title','status'];

    container.innerHTML = `
      <div class="rvck-wrap">
        ${isDrifted ? `
          <div class="rvck-drift-banner">
            ⚠ This artifact has been modified since this snapshot was taken.
            <button class="btn btn-ghost btn-sm rvck-compare-btn" id="rvck-compare">Compare with current</button>
            ${onReSnapshotRequest ? `<button class="btn btn-secondary btn-sm" id="rvck-resnap">Update Snapshot</button>` : ''}
          </div>` : ''}

        <div class="rvck-snapshot-card">
          <div class="rvck-snap-header">
            <span class="rvck-snap-code">${escHtml(snapshot.artifact_code || snapshot.artifact_type)}</span>
            <span class="rvck-snap-title">${escHtml(snapshot.artifact_title || '')}</span>
            <span class="badge badge-${escHtml(data.status || 'draft')}">${escHtml(data.status || '—')}</span>
            <span class="rvck-snap-at text-muted">Snapshot: ${formatDate(snapshot.snapshotted_at)}</span>
          </div>
          <div class="rvck-snap-fields">
            ${fields.map(f => data[f] ? `
              <div class="rvck-snap-field">
                <span class="rvck-snap-field-label">${escHtml(f.replace(/_/g,' '))}</span>
                <span class="rvck-snap-field-value">${escHtml(String(data[f]))}</span>
              </div>` : '').join('')}
          </div>
        </div>

        ${sections && sections.length ? `
          <div class="rvck-tabs">
            ${sections.map(s => `
              <button class="rvck-tab ${s.id === _activeTab ? 'active' : ''}" data-sec="${s.id}">
                ${escHtml(s.name)}
                <span class="rvck-tab-progress" id="rvck-prog-${s.id}">${sectionProgress(s)}</span>
              </button>`).join('')}
          </div>
          <div class="rvck-checklist" id="rvck-checklist">
            ${renderSection(_activeTab)}
          </div>
        ` : `<p class="rv-empty" style="padding:24px">No checklist template attached to this session.</p>`}
      </div>
    `;

    container.querySelectorAll('.rvck-tab').forEach(btn => {
      btn.onclick = () => {
        _activeTab = btn.dataset.sec;
        container.querySelectorAll('.rvck-tab').forEach(b => b.classList.toggle('active', b.dataset.sec === _activeTab));
        container.querySelector('#rvck-checklist').innerHTML = renderSection(_activeTab);
        wireSection();
      };
    });
    wireSection();

    const compareBtn = container.querySelector('#rvck-compare');
    if (compareBtn) compareBtn.onclick = () => openDiffModal();

    const resnapBtn = container.querySelector('#rvck-resnap');
    if (resnapBtn) resnapBtn.onclick = () => onReSnapshotRequest?.();
  }

  function sectionProgress(section) {
    const items = section.items || [];
    const responses = items.map(i => responseIndex[i.id]?.[currentUserId]).filter(Boolean);
    return `${responses.length}/${items.length}`;
  }

  function renderSection(secId) {
    const section = sections?.find(s => s.id === secId);
    if (!section) return '';
    const items = section.items || [];
    if (!items.length) return `<p class="rv-empty">No criteria in this section.</p>`;

    return `
      <table class="rvck-table">
        <thead>
          <tr>
            <th style="width:28px"></th>
            <th>Criterion</th>
            <th class="rvck-th-reviewers">Reviewer Verdicts</th>
            <th style="width:120px">Your Verdict</th>
            <th style="width:36px"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => renderItemRow(item)).join('')}
        </tbody>
      </table>
    `;
  }

  function renderItemRow(item) {
    const myResp = responseIndex[item.id]?.[currentUserId];
    const myVerdict = myResp?.verdict || '';
    const myComment = myResp?.comment || '';

    // Other reviewers' verdicts
    const otherVerdicts = (reviewers || [])
      .filter(rv => rv.user_id !== currentUserId)
      .map(rv => {
        const r = responseIndex[item.id]?.[rv.user_id];
        return r ? `<span class="rvck-rv-pill ${VERDICT_CLASSES[r.verdict] || ''}" title="${escHtml(rv.display_name || rv.user_id)}: ${VERDICT_LABELS[r.verdict] || r.verdict}">${escHtml((rv.display_name || 'User').charAt(0).toUpperCase())}: ${VERDICT_LABELS[r.verdict] || r.verdict}</span>` : `<span class="rvck-rv-pill rvck-rv-pending" title="${escHtml(rv.display_name || rv.user_id)}: pending">${escHtml((rv.display_name || 'User').charAt(0).toUpperCase())}: —</span>`;
      }).join('');

    // Consensus
    const allVerdicts = (reviewers || []).map(rv => responseIndex[item.id]?.[rv.user_id]?.verdict).filter(Boolean);
    let consensus = '';
    if (allVerdicts.length && allVerdicts.length === (reviewers || []).length) {
      const allSame = allVerdicts.every(v => v === allVerdicts[0]);
      consensus = allSame
        ? `<span class="rvck-consensus ${VERDICT_CLASSES[allVerdicts[0]] || ''}" title="All reviewers agree">✓ ${VERDICT_LABELS[allVerdicts[0]] || allVerdicts[0]}</span>`
        : `<span class="rvck-consensus rvck-consensus-split" title="Reviewers disagree">⚡ Split</span>`;
    }

    const itemFindings = findingsByItem[item.id] || [];
    const needsComment = myVerdict === 'nok' || myVerdict === 'partially_ok';

    return `
      <tr class="rvck-item-row ${item.is_mandatory ? 'rvck-mandatory' : ''}" data-item-id="${item.id}">
        <td class="rvck-mandatory-cell">${item.is_mandatory ? '<span title="Mandatory">★</span>' : ''}</td>
        <td class="rvck-criterion-cell">
          <div class="rvck-criterion-text">${escHtml(item.criterion)}</div>
          ${item.guidance ? `<div class="rvck-guidance">${escHtml(item.guidance)}</div>` : ''}
          ${itemFindings.map(f => `
            <span class="rvck-finding-tag rv-sev-${escHtml(f.severity)}" title="${escHtml(f.title)}">
              ⚑ ${escHtml(f.finding_code)} · ${escHtml(f.severity)}
            </span>`).join('')}
        </td>
        <td class="rvck-reviewers-cell">
          ${otherVerdicts || '<span class="text-muted">—</span>'}
          ${consensus}
        </td>
        <td class="rvck-verdict-cell">
          <div class="rvck-verdict-pills">
            ${['ok','nok','partially_ok','na'].map(v => `
              <button class="rvck-vbtn ${myVerdict === v ? VERDICT_CLASSES[v] + ' active' : ''}" data-verdict="${v}" data-item-id="${item.id}" title="${VERDICT_LABELS[v]}">${VERDICT_LABELS[v]}</button>
            `).join('')}
          </div>
          <div class="rvck-comment-wrap" style="${needsComment ? '' : 'display:none'}">
            <textarea class="form-input rvck-comment" data-item-id="${item.id}" rows="2" placeholder="Comment on this finding…">${escHtml(myComment)}</textarea>
          </div>
        </td>
        <td class="rvck-actions-cell">
          ${(myVerdict === 'nok' || myVerdict === 'partially_ok') ? `
            <button class="btn btn-ghost btn-sm rvck-raise-btn" data-item-id="${item.id}" title="Raise finding">⚑</button>` : ''}
        </td>
      </tr>
    `;
  }

  function wireSection() {
    const cl = container.querySelector('#rvck-checklist');
    if (!cl) return;

    // Verdict pills
    cl.querySelectorAll('.rvck-vbtn').forEach(btn => {
      btn.onclick = async () => {
        const itemId  = btn.dataset.itemId;
        const verdict = btn.dataset.verdict;
        const row     = cl.querySelector(`[data-item-id="${itemId}"].rvck-item-row`);
        const comment = row?.querySelector('.rvck-comment')?.value || '';

        // Optimistic UI update
        row.querySelectorAll('.rvck-vbtn').forEach(b => b.classList.remove(...Object.values(VERDICT_CLASSES), 'active'));
        btn.classList.add(VERDICT_CLASSES[verdict], 'active');

        // Show/hide comment
        const commentWrap = row?.querySelector('.rvck-comment-wrap');
        if (commentWrap) commentWrap.style.display = (verdict === 'nok' || verdict === 'partially_ok') ? '' : 'none';

        // Show/hide raise finding button
        updateRaiseBtn(row, verdict, itemId);

        // Update index
        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        if (!responseIndex[itemId][currentUserId]) responseIndex[itemId][currentUserId] = {};
        responseIndex[itemId][currentUserId].verdict = verdict;

        // Save
        await saveResponse(itemId, verdict, comment);
        updateTabProgress();
        onSaved?.({ snapshotId: snapshot.id, itemId, verdict, comment });
      };
    });

    // Comments
    cl.querySelectorAll('.rvck-comment').forEach(ta => {
      ta.addEventListener('input', debounce(async () => {
        const itemId = ta.dataset.itemId;
        const verdict = responseIndex[itemId]?.[currentUserId]?.verdict || '';
        if (!verdict) return;
        responseIndex[itemId][currentUserId].comment = ta.value;
        await saveResponse(itemId, verdict, ta.value);
      }, 600));
    });

    // Raise finding
    cl.querySelectorAll('.rvck-raise-btn').forEach(btn => {
      btn.onclick = () => {
        const itemId = btn.dataset.itemId;
        const section = sections?.find(s => s.items?.some(i => i.id === itemId));
        const item    = section?.items?.find(i => i.id === itemId);
        const resp    = responseIndex[itemId]?.[currentUserId];
        onFindingRaise?.({
          snapshotId: snapshot.id,
          templateItemId: itemId,
          criterion: item?.criterion || '',
          verdict: resp?.verdict || '',
          comment: resp?.comment || '',
          responseId: resp?.id || null,
        });
      };
    });
  }

  function updateRaiseBtn(row, verdict, itemId) {
    const actionsCell = row?.querySelector('.rvck-actions-cell');
    if (!actionsCell) return;
    actionsCell.innerHTML = (verdict === 'nok' || verdict === 'partially_ok') ?
      `<button class="btn btn-ghost btn-sm rvck-raise-btn" data-item-id="${itemId}" title="Raise finding">⚑</button>` : '';
    actionsCell.querySelector('.rvck-raise-btn')?.addEventListener('click', () => {
      const section = sections?.find(s => s.items?.some(i => i.id === itemId));
      const item    = section?.items?.find(i => i.id === itemId);
      const resp    = responseIndex[itemId]?.[currentUserId];
      onFindingRaise?.({ snapshotId: snapshot.id, templateItemId: itemId, criterion: item?.criterion || '', verdict, comment: resp?.comment || '', responseId: resp?.id || null });
    });
  }

  function updateTabProgress() {
    sections?.forEach(s => {
      const el = container.querySelector(`#rvck-prog-${s.id}`);
      if (el) el.textContent = sectionProgress(s);
    });
  }

  async function saveResponse(itemId, verdict, comment) {
    const existing = responseIndex[itemId]?.[currentUserId];
    if (existing?.id) {
      const { data } = await (await import('../config.js')).sb
        .from('review_checklist_responses')
        .update({ verdict, comment, updated_at: new Date().toISOString() })
        .eq('id', existing.id).select().single();
      if (data) Object.assign(responseIndex[itemId][currentUserId], data);
    } else {
      const { data } = await (await import('../config.js')).sb
        .from('review_checklist_responses')
        .upsert({
          session_id:       session.id,
          snapshot_id:      snapshot.id,
          template_item_id: itemId,
          reviewer_id:      currentUserId,
          verdict, comment,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'snapshot_id,template_item_id,reviewer_id' })
        .select().single();
      if (data) {
        if (!responseIndex[itemId]) responseIndex[itemId] = {};
        responseIndex[itemId][currentUserId] = data;
      }
    }
  }

  function openDiffModal() {
    // Import sb dynamically to avoid circular deps
    import('../config.js').then(({ sb: _sb }) => {
      const tableMap = {
        requirements:         'requirements',
        arch_spec_items:      'arch_spec_items',
        test_specs:           'test_specs',
        safety_analysis_rows: 'safety_analyses',
      };
      const table = tableMap[snapshot.artifact_type];
      if (!table) return;
      _sb.from(table).select('*').eq('id', snapshot.artifact_id).single().then(({ data: live }) => {
        if (!live) return;
        showDiffModal(snapshot.snapshot_data, live);
      });
    });
  }

  function showDiffModal(frozen, live) {
    const existing = document.querySelector('.rvck-diff-overlay');
    if (existing) existing.remove();

    const allKeys = new Set([...Object.keys(frozen), ...Object.keys(live)]);
    const skipKeys = new Set(['id','created_at','updated_at','project_id','parent_id','parent_type']);
    const relevantKeys = [...allKeys].filter(k => !skipKeys.has(k));

    const rows = relevantKeys.map(k => {
      const a = String(frozen[k] ?? '—');
      const b = String(live[k] ?? '—');
      const changed = a !== b;
      return `<tr class="${changed ? 'rvck-diff-changed' : ''}">
        <td class="rvck-diff-key">${escHtml(k)}</td>
        <td class="rvck-diff-old">${escHtml(a)}</td>
        <td class="rvck-diff-new">${changed ? `<strong>${escHtml(b)}</strong>` : escHtml(b)}</td>
      </tr>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'rvck-diff-overlay';
    overlay.innerHTML = `
      <div class="rvck-diff-modal">
        <div class="rvck-diff-header">
          <strong>Compare: Snapshot vs Current Version</strong>
          <button class="btn btn-ghost btn-sm rvck-diff-close">✕</button>
        </div>
        <table class="rvck-diff-table">
          <thead><tr><th>Field</th><th>Snapshot (frozen)</th><th>Current</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.rvck-diff-close').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
