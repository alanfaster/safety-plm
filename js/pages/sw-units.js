/**
 * SW Units — CRUD + code upload for software unit artifacts.
 * Route: /project/:projectId/item/:itemId/sw-units
 */
import { sb } from '../config.js';
import { navigate } from '../router.js';
import { setBreadcrumb } from '../components/topbar.js';
import { toast } from '../toast.js';
import { showModal, hideModal } from '../components/modal.js';

const STATUS_LABELS  = { draft:'Draft', in_review:'In Review', approved:'Approved', deprecated:'Deprecated' };
const STATUS_CLASSES = { draft:'badge-draft', in_review:'badge-review', approved:'badge-approved', deprecated:'badge-deprecated' };
const LANGUAGE_LABELS = { c:'C', cpp:'C++', python:'Python', java:'Java', js:'JavaScript', ts:'TypeScript', rust:'Rust', other:'Other' };

const BUILTIN_UNIT_TYPES = [
  { id: 'function',      label: 'Function / Method' },
  { id: 'class',         label: 'Class' },
  { id: 'isr',           label: 'Interrupt (ISR)' },
  { id: 'task',          label: 'RTOS Task' },
  { id: 'state_machine', label: 'State Machine' },
  { id: 'calibration',   label: 'Calibration / Config' },
  { id: 'general',       label: 'General Code' },
];

export async function renderSwUnits(container, ctx) {
  const { project, item, system } = ctx;

  // If navigating under a system, scope SW units to that system
  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const parentName = system ? `${system.system_code} · ${system.name}` : item.name;
  const base = system
    ? `/project/${project.id}/item/${item.id}/system/${system.id}`
    : `/project/${project.id}/item/${item.id}`;

  // Load project config to get custom unit types and header keywords
  const { data: pcRow } = await sb.from('project_config').select('config').eq('project_id', project.id).maybeSingle();
  const customUnitTypes = pcRow?.config?.sw_unit_types || [];
  const allUnitTypes = [...BUILTIN_UNIT_TYPES, ...customUnitTypes];
  const savedKeywords = pcRow?.config?.header_keywords || {};
  const HDR_KW = {
    unit:     savedKeywords.unit     || '@unit',
    name:     savedKeywords.name     || '@name',
    type:     savedKeywords.type     || '@type',
    asil:     savedKeywords.asil     || '@asil',
    sdd:      savedKeywords.sdd      || '@sdd',
    req:      savedKeywords.req      || '@req',
    author:   savedKeywords.author   || '@author',
    language: savedKeywords.language || '@language',
  };

  const crumbs = [
    { label: 'Projects', path: '/projects' },
    { label: project.name, path: `/project/${project.id}` },
    { label: item.name, path: `/project/${project.id}/item/${item.id}/vcycle/item_definition` },
  ];
  if (system) crumbs.push({ label: parentName });
  crumbs.push({ label: 'SW Units' });
  setBreadcrumb(crumbs);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>SW Units</h1>
          <p class="page-subtitle">${escHtml(parentName)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="swu-btn-upload">⬆ Upload Code (ZIP)</button>
          <button class="btn btn-primary" id="swu-btn-new">＋ New SW Unit</button>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div id="swu-list-wrap">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
    </div>

    <!-- Edit/Create panel (hidden by default) -->
    <div id="swu-form-panel" style="display:none" class="swu-form-panel">
      <div class="swu-form-header">
        <span id="swu-form-title">New SW Unit</span>
        <button class="btn btn-ghost btn-sm" id="swu-form-close">✕</button>
      </div>
      <div class="swu-form-body">
        <div class="form-group">
          <label class="form-label">Unit Code *</label>
          <input class="form-input" id="swu-field-code" placeholder="e.g. SWU-001"/>
        </div>
        <div class="form-group">
          <label class="form-label">Name *</label>
          <input class="form-input" id="swu-field-name" placeholder="Short descriptive name"/>
        </div>
        <div class="form-grid cols-2">
          <div class="form-group">
            <label class="form-label">Unit Type</label>
            <select class="form-input form-select" id="swu-field-unittype">
              ${allUnitTypes.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Language</label>
            <select class="form-input form-select" id="swu-field-language">
              <option value="">— select —</option>
              ${Object.entries(LANGUAGE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-input form-select" id="swu-field-status">
            ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">File Path</label>
          <input class="form-input" id="swu-field-filepath" placeholder="e.g. src/motor/control.c"/>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="swu-field-desc" rows="2" placeholder="Brief description of this unit's responsibility"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Source Code</label>
          <textarea class="form-input swu-code-editor" id="swu-field-code-src" rows="12" placeholder="Paste source code here…" spellcheck="false"></textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="swu-form-save">Save</button>
          <button class="btn btn-ghost" id="swu-form-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const { data: { user } } = await sb.auth.getUser();
  const currentUserId = user?.id;

  document.getElementById('swu-btn-new').onclick    = () => openForm(null);
  document.getElementById('swu-form-close').onclick  = closeForm;
  document.getElementById('swu-form-cancel').onclick = closeForm;
  document.getElementById('swu-btn-upload').onclick  = () => openUploadModal();

  await loadList();

  // ── List ─────────────────────────────────────────────────────────────────────

  async function loadList() {
    const { data: units, error } = await sb.from('sw_units')
      .select('*')
      .eq('project_id', project.id)
      .eq('parent_type', parentType)
      .eq('parent_id', parentId)
      .order('unit_code');

    const wrap = document.getElementById('swu-list-wrap');
    if (error) { wrap.innerHTML = `<p class="text-muted">${escHtml(error.message)}</p>`; return; }

    if (!units?.length) {
      wrap.innerHTML = `
        <div class="swu-onboarding">
          <div class="swu-onboarding-hero">
            <div class="swu-onboarding-icon">⌨</div>
            <h2>No SW Units yet</h2>
            <p class="text-muted">SW Units represent the individual software elements that make up this ${parentType === 'system' ? 'system' : 'item'} — functions, ISRs, tasks, state machines, etc.</p>
          </div>

          <div class="swu-onboarding-steps">
            <div class="swu-onboarding-step">
              <div class="swu-step-num">1</div>
              <div class="swu-step-body">
                <strong>Prepare your source files</strong>
                <p>Add a traceability header to each file so the tool can auto-populate unit code, name, type, ASIL level, and requirement links on import.</p>
                <pre class="swu-header-example">/**
 * ${HDR_KW.unit}    SWU-001
 * ${HDR_KW.name}    Motor Control
 * ${HDR_KW.type}    function
 * ${HDR_KW.asil}    B
 * ${HDR_KW.sdd}     SDD-MOT-001
 * ${HDR_KW.req}     SWR-001, SWR-002
 * ${HDR_KW.author}  Your Name
 */</pre>
                <p style="margin-top:6px">
                  <a href="docs/sw-unit-coding-guidelines.md" target="_blank" class="swu-link">📄 Read the full coding guidelines</a>
                  &nbsp;·&nbsp;
                  <a href="#" class="swu-link" id="swu-link-settings">⚙ Customize keywords in Project Settings</a>
                </p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">2</div>
              <div class="swu-step-body">
                <strong>Pack your source files into a ZIP</strong>
                <p>Zip the project folder keeping relative paths. Supported extensions: <code>.c .cpp .h .hpp .py .js .ts .java .rs .go</code></p>
                <p>You can strip a common prefix (e.g. <code>src/</code>) during import if needed.</p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">3</div>
              <div class="swu-step-body">
                <strong>Upload the ZIP</strong>
                <p>Click <strong>⬆ Upload Code (ZIP)</strong> above. The tool will:</p>
                <ul class="swu-onboarding-list">
                  <li>Parse headers and create one SW unit per file</li>
                  <li>Compute a SHA-256 hash per file for drift detection</li>
                  <li>Show a summary: <em>X new · Y changed · Z unchanged</em></li>
                </ul>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">4</div>
              <div class="swu-step-body">
                <strong>Or create units manually</strong>
                <p>Click <strong>＋ New SW Unit</strong> to define a unit without source code — useful for units that are not yet implemented.</p>
              </div>
            </div>

            <div class="swu-onboarding-step">
              <div class="swu-step-num">5</div>
              <div class="swu-step-body">
                <strong>Review changed units</strong>
                <p>When you upload a new version of the ZIP, files whose content changed are flagged <span class="swu-needs-review-badge" style="cursor:default">⚠ Changed</span>. Click the badge to start a peer review session for those units.</p>
              </div>
            </div>
          </div>

          <div class="swu-onboarding-actions">
            <button class="btn btn-primary" id="swu-ob-upload">⬆ Upload Code (ZIP)</button>
            <button class="btn btn-secondary" id="swu-ob-new">＋ New SW Unit manually</button>
          </div>
        </div>`;

      document.getElementById('swu-ob-upload').onclick = () => openUploadModal();
      document.getElementById('swu-ob-new').onclick    = () => openForm(null);
      document.getElementById('swu-link-settings')?.addEventListener('click', e => {
        e.preventDefault();
        navigate(`/project/${project.id}/settings`);
      });
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Type</th><th>File</th><th>Lang</th>
            <th>Version</th><th>Status</th><th>Review</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${units.map(u => {
            const unitTypeLabel = allUnitTypes.find(t => t.id === u.unit_type)?.label || u.unit_type || '—';
            return `
            <tr data-id="${u.id}">
              <td class="mono">${escHtml(u.unit_code)}</td>
              <td>${escHtml(u.name)}</td>
              <td><span class="badge badge-draft" style="font-size:10px">${escHtml(unitTypeLabel)}</span></td>
              <td class="mono text-muted" style="font-size:11px">${escHtml(u.file_path || '—')}</td>
              <td>${escHtml(LANGUAGE_LABELS[u.language] || u.language || '—')}</td>
              <td class="text-muted">v${u.version}</td>
              <td><span class="badge ${STATUS_CLASSES[u.status] || 'badge-draft'}">${STATUS_LABELS[u.status] || u.status}</span></td>
              <td>${u.needs_review
                ? `<span class="badge badge-review swu-needs-review-badge" data-id="${u.id}" style="cursor:pointer" title="Changed since last review — click to review">⚠ Changed</span>`
                : '<span class="text-muted">—</span>'}</td>
              <td class="rv-actions">
                <button class="btn btn-secondary btn-sm swu-edit-btn" data-id="${u.id}">Edit</button>
                <button class="btn btn-ghost btn-sm swu-del-btn" data-id="${u.id}">Delete</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('.swu-edit-btn').forEach(btn => {
      btn.onclick = () => openForm(units.find(u => u.id === btn.dataset.id));
    });
    wrap.querySelectorAll('.swu-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Delete this SW unit? This cannot be undone.')) return;
        const { error } = await sb.from('sw_units').delete().eq('id', btn.dataset.id);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('SW unit deleted.', 'success');
        await loadList();
      };
    });
    wrap.querySelectorAll('.swu-needs-review-badge').forEach(badge => {
      badge.onclick = () => navigate(`${base}/reviews/new?artifact_type=sw_units&artifact_id=${badge.dataset.id}`);
    });
  }

  // ── Form ─────────────────────────────────────────────────────────────────────

  let _editingId = null;

  function openForm(unit) {
    _editingId = unit?.id || null;
    document.getElementById('swu-form-title').textContent = unit ? 'Edit SW Unit' : 'New SW Unit';
    document.getElementById('swu-field-code').value      = unit?.unit_code || '';
    document.getElementById('swu-field-name').value      = unit?.name || '';
    document.getElementById('swu-field-unittype').value = unit?.unit_type || 'general';
    document.getElementById('swu-field-language').value  = unit?.language || '';
    document.getElementById('swu-field-status').value    = unit?.status || 'draft';
    document.getElementById('swu-field-filepath').value  = unit?.file_path || '';
    document.getElementById('swu-field-desc').value      = unit?.description || '';
    document.getElementById('swu-field-code-src').value  = unit?.source_code || '';
    document.getElementById('swu-form-panel').style.display = '';
    document.getElementById('swu-field-code').focus();

    document.getElementById('swu-form-save').onclick = saveForm;
  }

  function closeForm() {
    document.getElementById('swu-form-panel').style.display = 'none';
    _editingId = null;
  }

  async function saveForm() {
    const unit_code   = document.getElementById('swu-field-code').value.trim();
    const name        = document.getElementById('swu-field-name').value.trim();
    const unit_type   = document.getElementById('swu-field-unittype').value || 'general';
    const language    = document.getElementById('swu-field-language').value;
    const status      = document.getElementById('swu-field-status').value;
    const file_path   = document.getElementById('swu-field-filepath').value.trim();
    const description = document.getElementById('swu-field-desc').value.trim();
    const source_code = document.getElementById('swu-field-code-src').value;

    if (!unit_code) { document.getElementById('swu-field-code').focus(); toast('Enter a unit code.', 'error'); return; }
    if (!name)      { document.getElementById('swu-field-name').focus(); toast('Enter a name.', 'error'); return; }

    const saveBtn = document.getElementById('swu-form-save');
    saveBtn.disabled = true;

    let content_hash = null;
    let needs_review_update = {};

    if (source_code) {
      content_hash = await hashContent(source_code);
    }

    if (_editingId) {
      // Check if source code changed
      const { data: existing } = await sb.from('sw_units').select('content_hash, version, source_code').eq('id', _editingId).single();
      const codeChanged = source_code && existing?.content_hash && existing.content_hash !== content_hash;

      if (codeChanged) {
        // Save version snapshot before updating
        await sb.from('sw_unit_versions').insert({
          sw_unit_id: _editingId, version: existing.version,
          source_code: existing.source_code, content_hash: existing.content_hash,
          file_path, uploaded_by: currentUserId,
        });
        needs_review_update = { needs_review: true, version: (existing.version || 1) + 1 };
      }

      const { error } = await sb.from('sw_units').update({
        unit_code, name, unit_type, language: language || null, status,
        file_path: file_path || null, description: description || null,
        source_code: source_code || null, content_hash,
        ...needs_review_update,
        updated_at: new Date().toISOString(),
      }).eq('id', _editingId);

      saveBtn.disabled = false;
      if (error) { toast('Error: ' + error.message, 'error'); return; }
    } else {
      const { error } = await sb.from('sw_units').insert({
        project_id: project.id, parent_type: parentType, parent_id: parentId,
        unit_code, name, unit_type, language: language || null, status,
        file_path: file_path || null, description: description || null,
        source_code: source_code || null, content_hash,
        needs_review: false, version: 1, created_by: currentUserId,
      });

      saveBtn.disabled = false;
      if (error) { toast('Error: ' + error.message, 'error'); return; }
    }

    toast(_editingId ? 'SW unit updated.' : 'SW unit created.', 'success');
    closeForm();
    await loadList();
  }

  // ── ZIP Upload Modal ──────────────────────────────────────────────────────────

  function openUploadModal() {
    showModal({
      title: '⬆ Upload Project Code (ZIP)',
      body: `
        <div class="form-grid cols-1">
          <div class="form-group">
            <label class="form-label">ZIP file</label>
            <input type="file" class="form-input" id="swu-zip-input" accept=".zip"/>
          </div>
          <div class="form-group">
            <label class="form-label">Strip path prefix <span class="text-muted">(optional)</span></label>
            <input class="form-input" id="swu-zip-prefix" placeholder="e.g. src/ — leave empty to keep full paths"/>
          </div>
          <div id="swu-zip-preview" style="display:none">
            <div class="form-label">Files detected</div>
            <div id="swu-zip-file-list" style="max-height:200px;overflow-y:auto;font-size:12px;font-family:monospace;background:#f8f9fa;padding:8px;border-radius:4px;border:1px solid var(--border)"></div>
          </div>
          <div id="swu-zip-result" style="display:none"></div>
        </div>`,
      footer: `
        <button class="btn btn-secondary" id="swu-zip-cancel">Cancel</button>
        <button class="btn btn-primary" id="swu-zip-import" disabled>Import</button>`,
    });

    document.getElementById('swu-zip-cancel').onclick = hideModal;

    let _zipFiles = [];

    document.getElementById('swu-zip-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Load JSZip dynamically if not present
      if (!window.JSZip) {
        await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
      }

      try {
        const zip = await window.JSZip.loadAsync(file);
        _zipFiles = [];
        const preview = document.getElementById('swu-zip-preview');
        const fileList = document.getElementById('swu-zip-file-list');
        const codeExts = /\.(c|cpp|h|hpp|py|js|ts|java|cs|rs|go|rb|swift|kt|m|asm|s)$/i;

        zip.forEach((path, entry) => {
          if (!entry.dir && codeExts.test(path)) {
            _zipFiles.push({ path, entry });
          }
        });

        fileList.innerHTML = _zipFiles.length
          ? _zipFiles.map(f => `<div>${escHtml(f.path)}</div>`).join('')
          : '<div class="text-muted">No source files detected.</div>';

        preview.style.display = '';
        document.getElementById('swu-zip-import').disabled = _zipFiles.length === 0;
      } catch (err) {
        toast('Failed to read ZIP: ' + err.message, 'error');
      }
    };

    document.getElementById('swu-zip-import').onclick = async () => {
      const prefix   = document.getElementById('swu-zip-prefix').value.trim();
      const btn      = document.getElementById('swu-zip-import');
      btn.disabled   = true;
      btn.textContent = '…';

      let added = 0, changed = 0, unchanged = 0;

      for (const { path, entry } of _zipFiles) {
        const content   = await entry.async('string');
        const filePath  = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
        const hash      = await hashContent(content);
        const lang      = detectLanguage(filePath);

        const { data: existing } = await sb.from('sw_units')
          .select('id, version, content_hash, source_code')
          .eq('project_id', project.id)
          .eq('parent_type', parentType)
          .eq('parent_id', parentId)
          .eq('file_path', filePath)
          .maybeSingle();

        const hdr = parseFileHeader(content);
        const langFromHeader = hdr.language ? detectLanguage('file.' + hdr.language) : null;

        if (!existing) {
          const unitCode = hdr.unit || ('SWU-' + filePath.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase().slice(0, 20));
          const unitName = hdr.name || filePath.split('/').pop();
          const unitType = hdr.type || 'general';
          const descParts = [];
          if (hdr.asil)   descParts.push(`ASIL: ${hdr.asil}`);
          if (hdr.sdd)    descParts.push(`SDD: ${hdr.sdd}`);
          if (hdr.req)    descParts.push(`Req: ${hdr.req}`);
          if (hdr.author) descParts.push(`Author: ${hdr.author}`);
          await sb.from('sw_units').insert({
            project_id: project.id, parent_type: parentType, parent_id: parentId,
            unit_code: unitCode, name: unitName, unit_type: unitType,
            file_path: filePath, language: langFromHeader || lang,
            description: descParts.length ? descParts.join(' | ') : null,
            source_code: content, content_hash: hash,
            needs_review: true, version: 1, status: 'draft',
            created_by: currentUserId,
          });
          added++;
        } else if (existing.content_hash !== hash) {
          await sb.from('sw_unit_versions').insert({
            sw_unit_id: existing.id, version: existing.version,
            source_code: existing.source_code, content_hash: existing.content_hash,
            file_path: filePath, uploaded_by: currentUserId,
          });
          await sb.from('sw_units').update({
            source_code: content, content_hash: hash,
            version: (existing.version || 1) + 1,
            needs_review: true, updated_at: new Date().toISOString(),
          }).eq('id', existing.id);
          changed++;
        } else {
          unchanged++;
        }
      }

      const result = document.getElementById('swu-zip-result');
      result.style.display = '';
      result.innerHTML = `<div class="swu-upload-summary">
        <span class="badge badge-approved">✓ ${added} new</span>
        <span class="badge badge-review">⚠ ${changed} changed</span>
        <span class="badge badge-draft">${unchanged} unchanged</span>
      </div>`;
      btn.textContent = 'Done';

      await loadList();
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  function parseFileHeader(content) {
    const lines = content.split('\n').slice(0, 30); // Only scan first 30 lines
    const result = {};
    for (const line of lines) {
      const trimmed = line.replace(/^[\s*/]+/, '').trim(); // Strip comment chars
      for (const [field, kw] of Object.entries(HDR_KW)) {
        if (trimmed.startsWith(kw)) {
          result[field] = trimmed.slice(kw.length).trim().replace(/^[:\s]+/, '');
        }
      }
    }
    return result;
  }

  async function hashContent(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function detectLanguage(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const map = { c:'c', cpp:'cpp', h:'c', hpp:'cpp', py:'python', js:'js', ts:'ts', java:'java', cs:'other', rs:'rust', go:'other' };
    return map[ext] || 'other';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
