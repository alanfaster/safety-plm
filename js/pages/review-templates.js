/**
 * Review Protocol Templates — project settings tab
 * Allows admins to create/edit/delete checklist templates per artifact type.
 * Exported as mountReviewTemplatesTab(container, project, sb, toast)
 */

const ARTIFACT_TYPE_LABELS = {
  requirements:         'Requirements',
  arch_spec_items:      'Architecture Spec Items',
  test_specs:           'Test Specs',
  safety_analysis_rows: 'Safety Analysis',
  vcycle_docs:          'V-Cycle Documents',
};

const REVIEW_TYPE_LABELS = {
  inspection:        'Inspection (IEEE 1028)',
  walkthrough:       'Walkthrough',
  technical_review:  'Technical Review',
  audit:             'Audit',
  management_review: 'Management Review',
};

// Default templates seeded on first use (per artifact type)
const DEFAULT_TEMPLATES = [
  {
    name: 'Requirements Inspection',
    artifact_type: 'requirements',
    review_type: 'inspection',
    description: 'IEEE 1028 inspection checklist for requirements artifacts',
    sections: [
      { name: 'Completeness', items: [
        { criterion: 'All requirements have a unique identifier (req_code)', is_mandatory: true },
        { criterion: 'Every requirement has a title and description' },
        { criterion: 'Source / rationale is documented for each requirement' },
        { criterion: 'All requirements have an assigned priority' },
        { criterion: 'Applicable ASIL / DAL levels are assigned where required', is_mandatory: true },
      ]},
      { name: 'Correctness', items: [
        { criterion: 'Requirements use precise, unambiguous language (avoid "should", "might")' },
        { criterion: 'No contradictions between requirements' },
        { criterion: 'Measurable / verifiable acceptance criteria are present', is_mandatory: true },
        { criterion: 'Requirements are technically feasible' },
      ]},
      { name: 'Traceability', items: [
        { criterion: 'Each requirement is traceable to a parent (customer req, FSR, TSR, etc.)', is_mandatory: true },
        { criterion: 'Each requirement is allocated to at least one verification test', is_mandatory: true },
        { criterion: 'No orphan requirements (requirements with no parent or child trace)' },
      ]},
      { name: 'Safety Compliance', items: [
        { criterion: 'Safety requirements are flagged with correct ASIL / DAL', is_mandatory: true },
        { criterion: 'Safety independence requirements are correctly identified' },
        { criterion: 'Freedom from interference requirements are addressed where applicable' },
      ]},
    ],
  },
  {
    name: 'SW Architecture Inspection',
    artifact_type: 'arch_spec_items',
    review_type: 'inspection',
    description: 'Architecture specification inspection checklist',
    sections: [
      { name: 'Completeness', items: [
        { criterion: 'All architecture elements have a unique identifier' },
        { criterion: 'All interfaces are described with type, direction, and protocol' },
        { criterion: 'Architecture covers all allocated requirements' },
      ]},
      { name: 'Design Quality', items: [
        { criterion: 'Separation of concerns between components is clear' },
        { criterion: 'Safety-critical components are explicitly identified', is_mandatory: true },
        { criterion: 'Error handling and fault tolerance mechanisms are described' },
      ]},
      { name: 'Traceability', items: [
        { criterion: 'Architecture items are traceable to requirements', is_mandatory: true },
        { criterion: 'Architecture items are traceable to test specifications' },
      ]},
    ],
  },
  {
    name: 'Test Spec Review',
    artifact_type: 'test_specs',
    review_type: 'technical_review',
    description: 'Technical review checklist for test specifications',
    sections: [
      { name: 'Completeness', items: [
        { criterion: 'Test has a unique code and descriptive name' },
        { criterion: 'Test preconditions are fully specified' },
        { criterion: 'Step-by-step test procedure is documented' },
        { criterion: 'Expected results and acceptance criteria are explicit', is_mandatory: true },
      ]},
      { name: 'Coverage', items: [
        { criterion: 'Test covers the linked requirements', is_mandatory: true },
        { criterion: 'Boundary and edge cases are included' },
        { criterion: 'Safety-critical scenarios are explicitly tested', is_mandatory: true },
      ]},
    ],
  },
];

export async function mountReviewTemplatesTab(container, project, sb, toast) {
  let _templates = [];
  let _selectedId = null;
  let _sections = [];   // sections for selected template
  let _items = {};      // { sectionId: [items] }

  container.innerHTML = `
    <div class="rt-wrap">
      <div class="rt-list-col">
        <div class="rt-list-header">
          <span class="rt-list-title">Review Protocols</span>
          <button class="btn btn-primary btn-sm" id="rt-btn-new">＋ New</button>
        </div>
        <div id="rt-list"></div>
      </div>
      <div class="rt-editor-col" id="rt-editor">
        <div class="rt-editor-empty">Select a protocol to edit or create a new one.</div>
      </div>
    </div>
  `;

  await loadTemplates();
  wireNew();

  // ── Data load ──────────────────────────────────────────────────────────
  async function loadTemplates() {
    const { data } = await sb.from('review_protocol_templates')
      .select('*').eq('project_id', project.id).order('created_at');
    _templates = data || [];

    // Seed defaults on first use
    if (!_templates.length) {
      await seedDefaults();
      const { data: d2 } = await sb.from('review_protocol_templates')
        .select('*').eq('project_id', project.id).order('created_at');
      _templates = d2 || [];
    }
    renderList();
  }

  async function seedDefaults() {
    for (const tpl of DEFAULT_TEMPLATES) {
      const { data: t, error } = await sb.from('review_protocol_templates').insert({
        project_id:    project.id,
        name:          tpl.name,
        artifact_type: tpl.artifact_type,
        review_type:   tpl.review_type,
        description:   tpl.description || '',
      }).select().single();
      if (error || !t) continue;

      for (let si = 0; si < tpl.sections.length; si++) {
        const sec = tpl.sections[si];
        const { data: s } = await sb.from('review_template_sections').insert({
          template_id: t.id, name: sec.name, sort_order: si,
        }).select().single();
        if (!s) continue;
        for (let ii = 0; ii < sec.items.length; ii++) {
          await sb.from('review_template_items').insert({
            section_id:   s.id,
            template_id:  t.id,
            criterion:    sec.items[ii].criterion,
            guidance:     sec.items[ii].guidance || '',
            is_mandatory: sec.items[ii].is_mandatory || false,
            sort_order:   ii,
          });
        }
      }
    }
  }

  async function loadSections(templateId) {
    const { data: secs } = await sb.from('review_template_sections')
      .select('*').eq('template_id', templateId).order('sort_order');
    _sections = secs || [];

    if (_sections.length) {
      const { data: items } = await sb.from('review_template_items')
        .select('*').eq('template_id', templateId).order('sort_order');
      _items = {};
      (items || []).forEach(item => {
        if (!_items[item.section_id]) _items[item.section_id] = [];
        _items[item.section_id].push(item);
      });
    } else {
      _items = {};
    }
  }

  // ── List rendering ─────────────────────────────────────────────────────
  function renderList() {
    const el = container.querySelector('#rt-list');
    if (!_templates.length) {
      el.innerHTML = `<p class="rt-list-empty">No protocols yet.</p>`;
      return;
    }
    el.innerHTML = _templates.map(t => `
      <div class="rt-list-item ${t.id === _selectedId ? 'active' : ''}" data-id="${t.id}">
        <div class="rt-list-item-main">
          <span class="rt-list-item-name">${escHtml(t.name)}</span>
          <span class="badge rt-atype-badge">${escHtml(ARTIFACT_TYPE_LABELS[t.artifact_type] || t.artifact_type)}</span>
        </div>
        <span class="rt-rtype-tag">${escHtml(REVIEW_TYPE_LABELS[t.review_type] || t.review_type)}</span>
        <button class="rt-del-btn" data-id="${t.id}" title="Delete protocol">✕</button>
      </div>
    `).join('');

    el.querySelectorAll('.rt-list-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.rt-del-btn')) return;
        selectTemplate(row.dataset.id);
      });
    });

    el.querySelectorAll('.rt-del-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this review protocol and all its sections?')) return;
        await sb.from('review_protocol_templates').delete().eq('id', btn.dataset.id);
        if (_selectedId === btn.dataset.id) {
          _selectedId = null;
          container.querySelector('#rt-editor').innerHTML = `<div class="rt-editor-empty">Select a protocol to edit or create a new one.</div>`;
        }
        await loadTemplates();
        toast('Protocol deleted.', 'success');
      });
    });
  }

  async function selectTemplate(id) {
    _selectedId = id;
    renderList();
    const tpl = _templates.find(t => t.id === id);
    if (!tpl) return;
    await loadSections(id);
    renderEditor(tpl);
  }

  // ── Editor rendering ───────────────────────────────────────────────────
  function renderEditor(tpl) {
    const ed = container.querySelector('#rt-editor');
    ed.innerHTML = `
      <div class="rt-editor-inner">
        <div class="rt-editor-header">
          <div class="rt-editor-meta">
            <input class="form-input rt-name-input" value="${escHtml(tpl.name)}" placeholder="Protocol name"/>
            <select class="form-input form-select rt-atype-select">
              ${Object.entries(ARTIFACT_TYPE_LABELS).map(([v, l]) =>
                `<option value="${v}" ${tpl.artifact_type === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
            <select class="form-input form-select rt-rtype-select">
              ${Object.entries(REVIEW_TYPE_LABELS).map(([v, l]) =>
                `<option value="${v}" ${tpl.review_type === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </div>
          <textarea class="form-input rt-desc-input" placeholder="Description (optional)" rows="2">${escHtml(tpl.description || '')}</textarea>
        </div>

        <div class="rt-sections" id="rt-sections"></div>

        <button class="btn btn-secondary btn-sm rt-add-section-btn" id="rt-btn-add-section">＋ Add Section</button>
      </div>
    `;

    renderSections();

    // Auto-save meta fields on change
    const save = debounce(() => saveTemplateMeta(tpl.id), 600);
    ed.querySelector('.rt-name-input').addEventListener('input', save);
    ed.querySelector('.rt-atype-select').addEventListener('change', save);
    ed.querySelector('.rt-rtype-select').addEventListener('change', save);
    ed.querySelector('.rt-desc-input').addEventListener('input', save);

    ed.querySelector('#rt-btn-add-section').addEventListener('click', () => addSection(tpl.id));
  }

  function renderSections() {
    const el = container.querySelector('#rt-sections');
    if (!el) return;
    if (!_sections.length) {
      el.innerHTML = `<p class="rt-sections-empty">No sections yet. Add one below.</p>`;
      return;
    }
    el.innerHTML = _sections.map((sec, si) => `
      <div class="rt-section" data-sec-id="${sec.id}">
        <div class="rt-section-header">
          <span class="rt-section-grip">⠿</span>
          <input class="form-input rt-sec-name" value="${escHtml(sec.name)}" data-sec-id="${sec.id}" placeholder="Section name"/>
          <button class="rt-sec-del btn-icon" data-sec-id="${sec.id}" title="Delete section">✕</button>
        </div>
        <div class="rt-items-list" id="rt-items-${sec.id}">
          ${(_items[sec.id] || []).map((item, ii) => renderItemRow(item, ii, sec.id)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm rt-add-item-btn" data-sec-id="${sec.id}">＋ Add Criterion</button>
      </div>
    `).join('');

    // Section name save
    el.querySelectorAll('.rt-sec-name').forEach(inp => {
      inp.addEventListener('change', async () => {
        await sb.from('review_template_sections').update({ name: inp.value.trim() }).eq('id', inp.dataset.secId);
      });
    });

    // Section delete
    el.querySelectorAll('.rt-sec-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this section and all its criteria?')) return;
        await sb.from('review_template_sections').delete().eq('id', btn.dataset.secId);
        _sections = _sections.filter(s => s.id !== btn.dataset.secId);
        delete _items[btn.dataset.secId];
        renderSections();
      });
    });

    // Add item
    el.querySelectorAll('.rt-add-item-btn').forEach(btn => {
      btn.addEventListener('click', () => addItem(_selectedId, btn.dataset.secId));
    });

    // Item interactions (via delegation)
    el.querySelectorAll('.rt-item-row').forEach(row => wireItemRow(row));
  }

  function renderItemRow(item, idx, secId) {
    return `
      <div class="rt-item-row" data-item-id="${item.id}" data-sec-id="${secId}">
        <span class="rt-item-grip">⠿</span>
        <label class="rt-mandatory-label" title="Mandatory criterion">
          <input type="checkbox" class="rt-mandatory-chk" data-item-id="${item.id}" ${item.is_mandatory ? 'checked' : ''}/>
          <span class="rt-mandatory-icon" title="${item.is_mandatory ? 'Mandatory' : 'Optional'}">★</span>
        </label>
        <div class="rt-item-texts">
          <input class="form-input rt-criterion-input" data-item-id="${item.id}"
            value="${escHtml(item.criterion)}" placeholder="Checklist criterion…"/>
          <input class="form-input rt-guidance-input" data-item-id="${item.id}"
            value="${escHtml(item.guidance || '')}" placeholder="Guidance / hint (optional)…"/>
        </div>
        <button class="rt-item-del btn-icon" data-item-id="${item.id}" data-sec-id="${secId}" title="Delete">✕</button>
      </div>
    `;
  }

  function wireItemRow(row) {
    const itemId = row.dataset.itemId;
    const secId  = row.dataset.secId;
    const saveItem = debounce(async () => {
      const criterion = row.querySelector('.rt-criterion-input').value.trim();
      const guidance  = row.querySelector('.rt-guidance-input').value.trim();
      if (!criterion) return;
      await sb.from('review_template_items').update({ criterion, guidance }).eq('id', itemId);
    }, 600);

    row.querySelector('.rt-criterion-input').addEventListener('input', saveItem);
    row.querySelector('.rt-guidance-input').addEventListener('input', saveItem);

    row.querySelector('.rt-mandatory-chk').addEventListener('change', async e => {
      await sb.from('review_template_items').update({ is_mandatory: e.target.checked }).eq('id', itemId);
      row.querySelector('.rt-mandatory-icon').title = e.target.checked ? 'Mandatory' : 'Optional';
    });

    row.querySelector('.rt-item-del').addEventListener('click', async () => {
      await sb.from('review_template_items').delete().eq('id', itemId);
      _items[secId] = (_items[secId] || []).filter(i => i.id !== itemId);
      row.remove();
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function wireNew() {
    container.querySelector('#rt-btn-new').addEventListener('click', async () => {
      const { data: t, error } = await sb.from('review_protocol_templates').insert({
        project_id:    project.id,
        name:          'New Protocol',
        artifact_type: 'requirements',
        review_type:   'inspection',
        description:   '',
      }).select().single();
      if (error) { toast('Create failed: ' + error.message, 'error'); return; }
      _templates.push(t);
      await selectTemplate(t.id);
      renderList();
    });
  }

  async function saveTemplateMeta(id) {
    const ed = container.querySelector('#rt-editor');
    const name         = ed.querySelector('.rt-name-input')?.value.trim();
    const artifact_type = ed.querySelector('.rt-atype-select')?.value;
    const review_type   = ed.querySelector('.rt-rtype-select')?.value;
    const description   = ed.querySelector('.rt-desc-input')?.value.trim();
    if (!name) return;
    await sb.from('review_protocol_templates').update({ name, artifact_type, review_type, description, updated_at: new Date().toISOString() }).eq('id', id);
    const tpl = _templates.find(t => t.id === id);
    if (tpl) { tpl.name = name; tpl.artifact_type = artifact_type; tpl.review_type = review_type; }
    renderList();
  }

  async function addSection(templateId) {
    const sort_order = _sections.length;
    const { data: s } = await sb.from('review_template_sections').insert({
      template_id: templateId, name: 'New Section', sort_order,
    }).select().single();
    if (!s) return;
    _sections.push(s);
    _items[s.id] = [];
    renderSections();
    // Focus new section name
    const inp = container.querySelector(`[data-sec-id="${s.id}"].rt-sec-name`);
    if (inp) { inp.focus(); inp.select(); }
  }

  async function addItem(templateId, sectionId) {
    const sort_order = (_items[sectionId] || []).length;
    const { data: item } = await sb.from('review_template_items').insert({
      template_id: templateId, section_id: sectionId,
      criterion: '', guidance: '', is_mandatory: false, sort_order,
    }).select().single();
    if (!item) return;
    if (!_items[sectionId]) _items[sectionId] = [];
    _items[sectionId].push(item);

    const listEl = container.querySelector(`#rt-items-${sectionId}`);
    if (listEl) {
      const div = document.createElement('div');
      div.innerHTML = renderItemRow(item, sort_order, sectionId);
      const row = div.firstElementChild;
      listEl.appendChild(row);
      wireItemRow(row);
      row.querySelector('.rt-criterion-input').focus();
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
