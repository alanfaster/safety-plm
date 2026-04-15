/**
 * Generic V-Cycle phase page.
 * Renders Requirements page if phase === 'requirements', otherwise a rich text editor.
 * domain: 'default' | 'system' | 'sw' | 'hw' | 'mech'
 */
import { sb } from '../config.js';
import { t } from '../i18n/index.js';
import { toast } from '../toast.js';
import { renderRequirements }   from './requirements.js';
import { renderItemDefinition } from './item-definition.js';
import { renderArchitecture }   from './architecture.js';
import { renderArchSpec }       from './arch-spec.js';

export async function renderVcycle(container, { project, item, system, phase, domain = 'default', pageId = null }) {
  if (phase === 'item_definition') {
    await renderItemDefinition(container, { project, item, system, domain, pageId });
    return;
  }

  if (phase === 'architecture' && (domain === 'system' || domain === 'default')) {
    if (pageId) {
      const { data: pg } = await sb.from('nav_pages').select('name').eq('id', pageId).maybeSingle();
      if (pg?.name?.toLowerCase().includes('specification')) {
        const parentType = system ? 'system' : 'item';
        const parentId   = system ? system.id : item.id;
        await renderArchSpec(container, { project, item, system, parentType, parentId, pageId });
        return;
      }
    }
    await renderArchitecture(container, { project, item, system, domain, pageId });
    return;
  }

  if (phase === 'requirements') {
    const parentType = system ? 'system' : 'item';
    const parentId   = system ? system.id : item.id;
    await renderRequirements(container, { project, item, system, parentType, parentId, domain, pageId });
    return;
  }

  const parentType = system ? 'system' : 'item';
  const parentId   = system ? system.id : item.id;
  const phaseLabel = t(`vcycle.${phase}`);
  const domainLabel = domain !== 'default' ? ` — ${t(`domain.${domain}`)}` : '';

  // Sub-page name (if any)
  let pageLabel = '';
  if (pageId) {
    const { data: pg } = await sb.from('nav_pages').select('name').eq('id', pageId).maybeSingle();
    if (pg) pageLabel = ` › ${pg.name}`;
  }

  let query = sb.from('vcycle_docs').select('*')
    .eq('parent_type', parentType).eq('parent_id', parentId)
    .eq('domain', domain).eq('phase', phase);
  if (pageId) {
    query = query.eq('nav_page_id', pageId);
  } else {
    query = query.is('nav_page_id', null);
  }
  let { data: doc } = await query.maybeSingle();

  const content = doc?.content || {};
  const textContent = content.text || '';
  const status = doc?.status || 'draft';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>${phaseLabel}<span style="font-weight:400;font-size:15px;color:var(--color-text-muted)">${domainLabel}${escHtml(pageLabel)}</span></h1>
          <p class="text-muted">${parentType === 'system' ? system?.name : item?.name} · ${phaseLabel}</p>
        </div>
        <div class="flex gap-2 items-center">
          <select class="form-input form-select" id="doc-status" style="width:140px">
            ${['draft','review','approved'].map(s =>
              `<option value="${s}" ${status === s ? 'selected' : ''}>${t(`common.${s}`)}</option>`
            ).join('')}
          </select>
          <button class="btn btn-primary" id="btn-save-doc">💾 ${t('common.save')}</button>
        </div>
      </div>
    </div>
    <div class="page-body">
      ${phaseHint(phase)}
      <div class="card mt-4">
        <div class="card-header">
          <h3>${phaseLabel}${domainLabel} Document</h3>
          <span class="badge badge-${status}">${t(`common.${status}`)}</span>
        </div>
        <div class="card-body">
          <textarea class="form-input form-textarea" id="doc-text" rows="20"
            style="font-family:var(--font-mono);font-size:13px;resize:vertical"
            placeholder="Enter ${phaseLabel} content here...">${escHtml(textContent)}</textarea>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-save-doc').onclick = async () => {
    const text      = document.getElementById('doc-text').value;
    const newStatus = document.getElementById('doc-status').value;
    const payload = {
      parent_type: parentType,
      parent_id: parentId,
      project_id: project.id,
      phase,
      domain,
      nav_page_id: pageId || null,
      content: { text },
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    const { error } = doc
      ? await sb.from('vcycle_docs').update(payload).eq('id', doc.id)
      : await sb.from('vcycle_docs').insert(payload);

    if (error) { toast(t('common.error'), 'error'); return; }
    toast('Document saved.', 'success');

    // Refresh doc reference
    let refQ = sb.from('vcycle_docs').select('*')
      .eq('parent_type', parentType).eq('parent_id', parentId)
      .eq('domain', domain).eq('phase', phase);
    if (pageId) { refQ = refQ.eq('nav_page_id', pageId); }
    else        { refQ = refQ.is('nav_page_id', null); }
    const { data } = await refQ.maybeSingle();
    doc = data;
  };
}

function phaseHint(phase) {
  const hints = {
    item_definition:     'Define the item scope, purpose, boundaries, and operating environment.',
    architecture:        'Describe the system architecture, components, interfaces, and allocation of requirements.',
    design:              'Detail the technical design: data flows, state machines, interfaces, and design decisions.',
    implementation:      'Document implementation notes, coding guidelines, and configuration management.',
    unit_testing:        'Define unit test plan, test cases, and coverage targets.',
    integration_testing: 'Define integration test plan, test cases, and interface verification.',
    system_testing:      'Define system-level test plan and functional verification strategy.',
    validation:          'Document validation activities against stakeholder requirements and safety goals.',
  };
  const text = hints[phase];
  if (!text) return '';
  return `<div class="card" style="background:var(--color-info-bg);border-color:var(--color-primary-light)">
    <div class="card-body" style="color:var(--color-primary);font-size:var(--text-sm)">ℹ️ ${text}</div>
  </div>`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
