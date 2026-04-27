/**
 * showVersionHistory({ sb, artifactType, artifactId, artifactCode, currentData })
 *
 * Opens a full-screen modal showing the version timeline for an artifact.
 * Users can view any version or compare two versions side-by-side.
 *
 * History rows store the "before" state (OLD row) so:
 *   history[version=1] = what the artifact looked like at v1
 *   currentData        = current live state (highest version)
 */

const SKIP_FIELDS = new Set(['id', 'created_at', 'project_id', 'parent_id', 'parent_type',
  'sort_order', 'page_id', 'item_id', 'system_id', 'custom_fields', 'traceability',
  'analysis_id', 'template_id']);

export async function showVersionHistory(sb, { artifactType, artifactId, artifactCode, currentData }) {
  // Remove existing overlay if any
  document.querySelector('.avh-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'avh-overlay';
  overlay.innerHTML = `
    <div class="avh-modal">
      <div class="avh-header">
        <div class="avh-header-left">
          <span class="avh-title">Version History</span>
          <span class="avh-artifact-code">${escHtml(artifactCode)}</span>
        </div>
        <button class="btn btn-ghost btn-sm avh-close">✕</button>
      </div>
      <div class="avh-body">
        <div class="avh-sidebar" id="avh-sidebar">
          <div class="avh-loading"><div class="spinner"></div></div>
        </div>
        <div class="avh-content" id="avh-content">
          <div class="avh-placeholder">
            <p>Select a version on the left to view its content,<br>
               or pick two versions with <strong>A</strong> / <strong>B</strong> to compare.</p>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.avh-close').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  // Load history
  const { data: rows } = await sb
    .from('artifact_version_history')
    .select('version, data, changed_at')
    .eq('artifact_type', artifactType)
    .eq('artifact_id', artifactId)
    .order('version', { ascending: false });

  const history = rows || [];

  // Build version list: history entries + current live row at the top
  const currentVersion = currentData?.version ?? (history.length ? history[0].version + 1 : 1);
  const entries = [
    { version: currentVersion, data: currentData, changed_at: currentData?.updated_at || null, isCurrent: true },
    ...history.map(r => ({ version: r.version, data: r.data, changed_at: r.changed_at, isCurrent: false })),
  ];

  // State for A/B comparison
  let pickA = null; // version number
  let pickB = null;

  renderSidebar();

  function renderSidebar() {
    const sidebar = document.getElementById('avh-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = `
      ${entries.length > 1 ? `
        <div class="avh-compare-bar">
          <span class="avh-compare-hint">Pick <strong>A</strong> &amp; <strong>B</strong> then compare</span>
          <button class="btn btn-primary btn-sm avh-compare-btn" id="avh-do-compare"
            ${pickA !== null && pickB !== null ? '' : 'disabled'}>Compare A vs B</button>
        </div>` : ''}
      <div class="avh-version-list">
        ${entries.map(e => `
          <div class="avh-version-row ${e.isCurrent ? 'avh-version-current' : ''}"
               data-version="${e.version}">
            <div class="avh-version-meta">
              <span class="avh-version-num">v${e.version}${e.isCurrent ? ' <span class="avh-current-tag">current</span>' : ''}</span>
              <span class="avh-version-date text-muted">${formatDateTime(e.changed_at)}</span>
            </div>
            <div class="avh-version-actions">
              <button class="btn btn-ghost btn-xs avh-pick-a ${pickA === e.version ? 'avh-pick-active' : ''}"
                      data-version="${e.version}" title="Set as version A">A</button>
              <button class="btn btn-ghost btn-xs avh-pick-b ${pickB === e.version ? 'avh-pick-active' : ''}"
                      data-version="${e.version}" title="Set as version B">B</button>
              <button class="btn btn-ghost btn-xs avh-view-btn"
                      data-version="${e.version}" title="View this version">View</button>
            </div>
          </div>`).join('')}
      </div>
    `;

    sidebar.querySelectorAll('.avh-pick-a').forEach(btn => {
      btn.onclick = () => {
        pickA = parseInt(btn.dataset.version, 10);
        if (pickA === pickB) pickB = null;
        renderSidebar();
      };
    });
    sidebar.querySelectorAll('.avh-pick-b').forEach(btn => {
      btn.onclick = () => {
        pickB = parseInt(btn.dataset.version, 10);
        if (pickB === pickA) pickA = null;
        renderSidebar();
      };
    });
    sidebar.querySelectorAll('.avh-view-btn').forEach(btn => {
      btn.onclick = () => {
        const v = parseInt(btn.dataset.version, 10);
        const entry = entries.find(e => e.version === v);
        if (entry) renderSingleVersion(entry);
      };
    });

    document.getElementById('avh-do-compare')?.addEventListener('click', () => {
      const eA = entries.find(e => e.version === pickA);
      const eB = entries.find(e => e.version === pickB);
      if (eA && eB) renderComparison(eA, eB);
    });
  }

  function renderSingleVersion(entry) {
    const content = document.getElementById('avh-content');
    if (!content) return;
    const fields = getRelevantFields(entry.data);
    content.innerHTML = `
      <div class="avh-view-header">
        <span class="avh-view-vtag">v${entry.version}${entry.isCurrent ? ' (current)' : ''}</span>
        <span class="avh-view-date text-muted">${formatDateTime(entry.changed_at)}</span>
      </div>
      <table class="avh-fields-table">
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody>
          ${fields.map(([k, v]) => `
            <tr>
              <td class="avh-field-key">${escHtml(formatKey(k))}</td>
              <td class="avh-field-val">${escHtml(String(v ?? '—'))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  function renderComparison(eA, eB) {
    // Ensure A is the lower version (older), B is higher (newer)
    const [older, newer] = eA.version < eB.version ? [eA, eB] : [eB, eA];

    const content = document.getElementById('avh-content');
    if (!content) return;

    const allKeys = new Set([
      ...Object.keys(older.data || {}),
      ...Object.keys(newer.data || {}),
    ].filter(k => !SKIP_FIELDS.has(k)));

    const rows = [...allKeys].map(k => {
      const vA = String(older.data?.[k] ?? '—');
      const vB = String(newer.data?.[k] ?? '—');
      const changed = vA !== vB;
      return { k, vA, vB, changed };
    }).filter(r => r.vA !== '—' || r.vB !== '—');

    const changedCount = rows.filter(r => r.changed).length;

    content.innerHTML = `
      <div class="avh-compare-header">
        <div class="avh-compare-col-hdr avh-col-a">
          <span class="avh-compare-vtag avh-vtag-a">v${older.version}${older.isCurrent ? ' (current)' : ''}</span>
          <span class="avh-compare-date text-muted">${formatDateTime(older.changed_at)}</span>
        </div>
        <div class="avh-compare-col-hdr avh-col-b">
          <span class="avh-compare-vtag avh-vtag-b">v${newer.version}${newer.isCurrent ? ' (current)' : ''}</span>
          <span class="avh-compare-date text-muted">${formatDateTime(newer.changed_at)}</span>
        </div>
        <div class="avh-diff-summary">${changedCount} field${changedCount !== 1 ? 's' : ''} changed</div>
      </div>
      <table class="avh-diff-table">
        <thead>
          <tr>
            <th class="avh-diff-key-col">Field</th>
            <th>v${older.version}</th>
            <th>v${newer.version}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${r.changed ? 'avh-diff-row-changed' : ''}">
              <td class="avh-diff-key">${escHtml(formatKey(r.k))}</td>
              <td class="avh-diff-old">${escHtml(r.vA)}</td>
              <td class="avh-diff-new">${r.changed ? `<strong>${escHtml(r.vB)}</strong>` : escHtml(r.vB)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  }
}

function getRelevantFields(data) {
  if (!data) return [];
  return Object.entries(data).filter(([k]) => !SKIP_FIELDS.has(k) && data[k] != null && data[k] !== '');
}

function formatKey(k) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
