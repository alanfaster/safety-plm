/**
 * System DFMEA — VDA 2019 system-level analysis.
 *
 * Structure:  Item (upper)  →  System/Group (focus)  →  Component HW/SW (lower/cause)
 *
 * Table hierarchy (rowspan-based):
 *  Sistema  |  Función  |  Failure Mode  |  Max S  |  Status
 *                                        |  Effect Higher (Item)  |  Effect Local  |  S
 *                                                                  |  Cause (Component)  |  O  |  Prev  |  D  |  Det  |  AP  |  ...
 */

import { sb, buildCode, nextIndex } from '../../config.js';
import { wireBottomPanel } from '../../utils/bottom-panel.js';
import { toast } from '../../toast.js';
import { showModal, hideModal } from '../../components/modal.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const ACTION_STATUSES = ['open','in_progress','closed'];
const ITEM_STATUSES   = ['draft','review','approved'];

function calcAP(s,o,d){
  s=+s;o=+o;d=+d; if(!s||!o||!d) return '-';
  if(s>=9) return 'H';
  if(s>=7){if(o===1&&d<=3)return 'L';if(o===1)return 'M';return 'H';}
  if(s>=4){if(o<=2&&d<=3)return 'L';if(o<=2)return 'M';if(d<=3)return 'M';return 'H';}
  if(s>=2){if(o<=2&&d<=3)return 'N';if(o<=2)return 'L';return 'M';}
  return 'N';
}
const AP_COLORS={H:'#C5221F',M:'#E65100',L:'#1E8E3E',N:'#6B778C','-':'#9AA0A6'};

// ── Module state ───────────────────────────────────────────────────────────────

let _ctx    = null;
let _items  = [];
let _selId  = null;
let _groups = [];   // arch_components Groups for this item
let _comps  = [];   // arch_components HW/SW/Mechanical for this item
let _fns    = [];   // arch_functions for all components
let _fnFms  = {};   // arch_function_fms keyed by function_id

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function cellText(v){
  if(!v) return `<span class="dfmea-placeholder">—</span>`;
  return `<span class="dfmea-cell-text">${esc(v)}</span>`;
}
function rtype(it){return it.row_type||'fm';}

function fmOf(it){
  if(rtype(it)==='fm') return it;
  if(rtype(it)==='effect') return _items.find(i=>i.id===it.parent_row_id)||null;
  if(rtype(it)==='cause'){
    const p=_items.find(i=>i.id===it.parent_row_id); if(!p) return null;
    return rtype(p)==='fm'?p:(_items.find(i=>i.id===p.parent_row_id)||null);
  }
  return null;
}

function maxSevForFm(fm){
  const effs=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  if(!effs.length) return fm.severity||0;
  return Math.max(...effs.map(e=>+e.severity||0),0);
}

function wrapWithDel(td,action,innerHtml){
  td.innerHTML=`<div class="dfmea-cell-wrap"><button class="dfmea-corner-del" data-action="${action}" title="Delete">✕</button><div class="dfmea-cell-inner">${innerHtml}</div></div>`;
}
function getInner(td){return td.querySelector('.dfmea-cell-inner')||td;}

// ── Entry Point ────────────────────────────────────────────────────────────────

export async function renderSysDFMEA(container, {project,item,parentType,parentId}){
  _ctx={project,item,parentType,parentId};
  _items=[]; _selId=[];

  container.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';
  container.innerHTML=`
    <div class="page-header" style="flex-shrink:0">
      <div class="page-header-top">
        <div>
          <h1>System DFMEA</h1>
          <p class="page-subtitle">VDA 2019 · ${esc(item?.name||project?.name||'')}</p>
        </div>
        <div class="dfmea-toolbar">
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-sdm-sync">⟳ Sync from Architecture</button>
          <button class="btn btn-primary   btn-sm" id="btn-sdm-new">＋ New</button>
        </div>
      </div>
    </div>
    <div class="sdm-layout" id="sdm-layout">
      <div class="spec-nav" id="sdm-nav" style="width:220px">
        <div class="arch-tree-resize-handle" id="sdm-nav-handle"></div>
        <div class="spec-nav-inner" id="sdm-nav-inner">
          <div class="sdm-nav-hdr">
            <span class="sdm-nav-title">Architecture</span>
          </div>
          <div id="sdm-nav-tree"></div>
        </div>
      </div>
      <div class="sdm-content" id="sdm-content">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
    </div>`;

  wireNavPanel();
  document.getElementById('btn-sdm-new').onclick  = ()=>addFmRow();
  document.getElementById('btn-sdm-sync').onclick = ()=>syncFromArchitecture();

  await Promise.all([loadItems(), loadArchData()]);
}

// ── Nav panel (left) ───────────────────────────────────────────────────────────

function wireNavPanel(){
  const nav   = document.getElementById('sdm-nav');
  const handle= document.getElementById('sdm-nav-handle');
  const layout= document.getElementById('sdm-layout');
  if(!nav||!handle) return;

  const saved=localStorage.getItem('sdm_nav_w')||'220px';
  nav.style.width=saved;
  nav.classList.toggle('spec-nav--hidden', parseInt(saved)<60);

  let dragging=false, startX=0, startW=0;
  handle.addEventListener('pointerdown',e=>{
    dragging=true; startX=e.clientX; startW=nav.offsetWidth;
    nav.style.transition='none'; handle.setPointerCapture(e.pointerId); e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const w=Math.max(40,Math.min(400,startW+(e.clientX-startX)));
    nav.style.width=w+'px';
    nav.classList.toggle('spec-nav--hidden',w<60);
  });
  handle.addEventListener('pointerup',()=>{
    dragging=false; nav.style.transition='';
    localStorage.setItem('sdm_nav_w',nav.style.width);
  });
}

function renderNavTree(){
  const tree=document.getElementById('sdm-nav-tree'); if(!tree) return;
  if(!_groups.length){tree.innerHTML='<div class="sdm-nav-empty">No systems in Architecture Concept</div>';return;}

  tree.innerHTML=_groups.map(g=>{
    const children=_comps.filter(c=>c.data?.group_id===g.id);
    return `<div class="sdm-nav-system" data-gid="${g.id}">
      <div class="sdm-nav-sys-row">
        <span class="sdm-nav-sys-icon">⬡</span>
        <span class="sdm-nav-sys-name">${esc(g.name)}</span>
      </div>
      ${children.map(c=>`<div class="sdm-nav-comp" data-cid="${c.id}">
        <span class="sdm-nav-comp-type">${esc(c.comp_type)}</span>
        <span class="sdm-nav-comp-name">${esc(c.name)}</span>
      </div>`).join('')}
    </div>`;
  }).join('');

  tree.querySelectorAll('[data-gid]').forEach(el=>{
    el.addEventListener('click',()=>{
      const row=document.querySelector(`tr[data-sys-id="${el.dataset.gid}"]`);
      row?.scrollIntoView({block:'start',behavior:'smooth'});
    });
  });
}

// ── Load data ──────────────────────────────────────────────────────────────────

async function loadArchData(){
  const [{data:groups},{data:comps}]=await Promise.all([
    sb.from('arch_components').select('id,name,comp_type,data,sort_order')
      .eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId)
      .eq('comp_type','Group').order('sort_order',{ascending:true}),
    sb.from('arch_components').select('id,name,comp_type,data,sort_order')
      .eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId)
      .neq('comp_type','Group').neq('comp_type','Port').order('sort_order',{ascending:true}),
  ]);
  _groups=groups||[];
  _comps=(comps||[]).filter(c=>c.comp_type!=='Port');

  // Load functions for all components (groups + leaf comps)
  const allCompIds=[..._groups.map(g=>g.id),..._comps.map(c=>c.id)];
  if(allCompIds.length){
    const {data:fns}=await sb.from('arch_functions').select('id,component_id,name')
      .in('component_id',allCompIds).order('sort_order',{ascending:true});
    _fns=fns||[];
    const fnIds=_fns.map(f=>f.id);
    if(fnIds.length){
      const {data:fnFms}=await sb.from('arch_function_fms').select('id,function_id,failure_mode')
        .in('function_id',fnIds).order('sort_order',{ascending:true});
      _fnFms={};
      (fnFms||[]).forEach(fm=>{(_fnFms[fm.function_id]||(_fnFms[fm.function_id]=[])).push(fm);});
    }
  }
  renderNavTree();
}

async function loadItems(){
  const area=document.getElementById('sdm-content'); if(!area) return;
  const {data,error}=await sb.from('sys_dfmea_items')
    .select('*').eq('item_id',_ctx.parentId)
    .order('sort_order',{ascending:true}).order('created_at',{ascending:true});
  if(error){
    area.innerHTML=`<div class="card"><div class="card-body">
      <p style="color:var(--color-danger)"><strong>Error:</strong> <code>${esc(error.message)}</code></p>
      <p style="margin-top:8px;font-size:13px">Run <code>db/migration_sys_dfmea.sql</code> in Supabase.</p>
    </div></div>`;
    return;
  }
  _items=data||[];
  renderTable();
}

// ── Table render ───────────────────────────────────────────────────────────────

function buildGroups(){
  const fms=_items.filter(i=>rtype(i)==='fm');
  const order=[], map=new Map();
  fms.forEach(fm=>{
    const k=`${fm.arch_comp_id||''}__${fm.system_name||''}__${fm.function_name||''}`;
    if(!map.has(k)){
      const g={key:k,arch_comp_id:fm.arch_comp_id,system_name:fm.system_name,function_name:fm.function_name,fms:[]};
      order.push(g); map.set(k,g);
    }
    map.get(k).fms.push(fm);
  });
  return order;
}

function fmRowCount(fm){
  const effects=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  const directCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id);
  const effRows=effects.reduce((n,e)=>{
    const c=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===e.id).length;
    return n+Math.max(1,c);
  },0);
  return 1+effRows+directCauses.length;
}
function groupRowCount(g){return g.fms.reduce((n,fm)=>n+fmRowCount(fm),0);}

function renderTable(){
  const area=document.getElementById('sdm-content'); if(!area) return;
  const groups=buildGroups();

  if(!groups.length){
    area.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon">⚠</div>
      <h3>No System DFMEA entries yet</h3>
      <p>Click <strong>＋ New</strong> or use <strong>⟳ Sync from Architecture</strong>.</p>
    </div>`;
    return;
  }

  // Group by system
  const bySystem=new Map();
  groups.forEach(g=>{
    const k=g.arch_comp_id||g.system_name||'';
    if(!bySystem.has(k)) bySystem.set(k,[]);
    bySystem.get(k).push(g);
  });

  area.innerHTML=`
    <div class="dfmea-table-wrap">
      <table class="dfmea-table sdm-table">
        <thead><tr>
          <th class="sdm-col-sys">Sistema</th>
          <th class="sdm-col-fn">Función</th>
          <th class="sdm-col-fm">Failure Mode</th>
          <th class="dfmea-col-maxs" title="Max Severity">Max S</th>
          <th class="dfmea-col-status">Status</th>
          <th class="sdm-col-eff">Effect — Item Level</th>
          <th class="sdm-col-eff">Effect — System Level</th>
          <th class="dfmea-col-sod" title="Severity">S</th>
          <th class="sdm-col-cause">Failure Cause (Component)</th>
          <th class="dfmea-col-sod" title="Occurrence">O</th>
          <th class="dfmea-col-ctrl">Prevention Controls</th>
          <th class="dfmea-col-sod" title="Detection">D</th>
          <th class="dfmea-col-ctrl">Detection Controls</th>
          <th class="dfmea-col-ap">AP</th>
          <th class="dfmea-col-actions">Actions</th>
          <th class="dfmea-col-resp">Responsible</th>
          <th class="dfmea-col-date">Target Date</th>
          <th class="dfmea-col-astatus">Action Status</th>
        </tr></thead>
        <tbody id="sdm-tbody"></tbody>
      </table>
    </div>`;

  const tbody=document.getElementById('sdm-tbody');

  bySystem.forEach((sysGroups, sysKey)=>{
    const totalSysRows=sysGroups.reduce((n,g)=>n+groupRowCount(g),0);
    let isFirstSysGroup=true;
    sysGroups.forEach(g=>{
      const totalGrpRows=groupRowCount(g);
      renderGroup(tbody, g, isFirstSysGroup?totalSysRows:0);
      isFirstSysGroup=false;
    });
  });
}

// ── Group render ───────────────────────────────────────────────────────────────

function renderGroup(tbody, g, sysRowSpan){
  const totalSpan=groupRowCount(g);
  g.fms.forEach((fm,fi)=>{
    const effects      =_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
    const directCauses =_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id);
    const fmSpan       =fmRowCount(fm);
    const isFirstFm    =(fi===0);

    const fmTr=document.createElement('tr');
    fmTr.className='dfmea-row dfmea-row-fm'+(isFirstFm?' dfmea-group-first':'');
    fmTr.dataset.id=fm.id; fmTr.dataset.type='fm';

    // Sistema cell (rowspan = sysRowSpan, only on very first FM)
    if(isFirstFm && sysRowSpan>0){
      const sysTd=document.createElement('td');
      sysTd.rowSpan=sysRowSpan;
      sysTd.className='sdm-col-sys sdm-sys-cell dfmea-group-cell';
      sysTd.dataset.sysId=fm.arch_comp_id||'';
      fmTr.dataset.sysId=fm.arch_comp_id||'';
      sysTd.innerHTML=`<div class="dfmea-cell-wrap">
        <button class="dfmea-corner-del" data-action="del-sys-group" title="Delete system group">✕</button>
        <div class="dfmea-cell-inner">
          <div class="sdm-sys-name">${esc(g.system_name||'—')}</div>
        </div></div>`;
      sysTd.querySelector('[data-action="del-sys-group"]')?.addEventListener('click',()=>deleteSystemGroup(g.arch_comp_id||g.system_name));
      fmTr.appendChild(sysTd);
    }

    // Función cell (rowspan = totalSpan, only on first FM of the group)
    if(isFirstFm){
      const fnTd=document.createElement('td');
      fnTd.rowSpan=totalSpan;
      fnTd.className='sdm-col-fn dfmea-editable dfmea-group-cell';
      fnTd.dataset.field='function_name';
      wrapWithDel(fnTd,'del-fn-group',cellText(g.function_name));
      fnTd.querySelector('[data-action="del-fn-group"]')?.addEventListener('click',()=>deleteFnGroup(g));
      wireTextCellGroup(fnTd,g,'function_name');
      fmTr.appendChild(fnTd);
    }

    // FM cell
    const fmTd=makeTd('sdm-col-fm dfmea-editable',fmSpan);
    fmTd.dataset.field='failure_mode';
    wrapWithDel(fmTd,'del-fm',cellText(fm.failure_mode));
    fmTr.appendChild(fmTd);

    // Max S
    const maxSTd=makeTd('dfmea-col-maxs dfmea-maxs-cell',fmSpan);
    maxSTd.dataset.fmId=fm.id;
    const maxS=maxSevForFm(fm);
    maxSTd.innerHTML=maxS?`<span class="dfmea-maxs-badge">${maxS}</span>`:`<span class="dfmea-placeholder">—</span>`;
    fmTr.appendChild(maxSTd);

    // Status
    const statusTd=makeTd('dfmea-col-status',fmSpan);
    statusTd.innerHTML=`<select class="dfmea-sel" data-field="status">${ITEM_STATUSES.map(s=>`<option value="${s}"${fm.status===s?' selected':''}>${s}</option>`).join('')}</select>`;
    fmTr.appendChild(statusTd);

    // No effects/causes placeholder
    if(!effects.length&&!directCauses.length){
      ['sdm-col-eff','sdm-col-eff','dfmea-col-sod','sdm-col-cause','dfmea-col-sod',
       'dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ctrl','dfmea-col-ap','dfmea-col-actions',
       'dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'].forEach(c=>{
        const td=naCell(c); td.classList.add('dfmea-na-editable');
        td.innerHTML='<span class="dfmea-placeholder">—</span>';
        if(c==='sdm-col-eff') td.addEventListener('dblclick',()=>addEffectRow(fm));
        if(c==='sdm-col-cause') td.addEventListener('dblclick',()=>addCauseRow(fm.id,fm));
        fmTr.appendChild(td);
      });
    }

    tbody.appendChild(fmTr);
    wireFmCells(fmTr,fmTd,statusTd,fm,g);

    // Effect rows
    effects.forEach((eff,ei)=>{
      const effCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===eff.id);
      const effSpan=Math.max(1,effCauses.length);

      const effTr=document.createElement('tr');
      effTr.className='dfmea-row dfmea-row-effect';
      effTr.dataset.id=eff.id; effTr.dataset.type='effect';

      const effHTd=makeTd('sdm-col-eff dfmea-editable',effSpan);
      effHTd.dataset.field='effect_higher';
      wrapWithDel(effHTd,'del-effect',cellText(eff.effect_higher));
      effTr.appendChild(effHTd);

      const effLTd=makeTd('sdm-col-eff dfmea-editable',effSpan);
      effLTd.dataset.field='effect_local';
      effLTd.innerHTML=cellText(eff.effect_local);
      effTr.appendChild(effLTd);

      const sTd=makeTd('dfmea-col-sod',effSpan);
      sTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${eff.severity||5}" data-field="severity">`;
      effTr.appendChild(sTd);

      if(effCauses.length){
        appendCauseCells(effTr,effCauses[0],fm,true);
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
        wireCauseCells(effTr,effCauses[0],fm);
        effCauses.slice(1).forEach(c=>{
          const cTr=causeTrShell(c,fm);
          tbody.appendChild(cTr);
          wireCauseCells(cTr,c,fm);
        });
      } else {
        const naFc=naCell('sdm-col-cause dfmea-na-editable');
        naFc.innerHTML='<span class="dfmea-placeholder">—</span>';
        naFc.addEventListener('dblclick',()=>addCauseRow(eff.id,fm));
        effTr.appendChild(naFc);
        ['dfmea-col-sod','dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ctrl','dfmea-col-ap',
         'dfmea-col-actions','dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'].forEach(c=>effTr.appendChild(naCell(c)));
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
      }
      effHTd.querySelector('[data-action="del-effect"]')?.addEventListener('click',()=>deleteEffect(eff,fm));
    });

    directCauses.forEach(c=>{
      const cTr=causeTrShell(c,fm,true);
      tbody.appendChild(cTr);
      wireCauseCells(cTr,c,fm);
    });
  });
}

// ── Cell factories ─────────────────────────────────────────────────────────────

function makeTd(cls,span=1){
  const td=document.createElement('td');
  td.className=cls;
  if(span>1) td.rowSpan=span;
  return td;
}
function naCell(cls){
  const td=document.createElement('td');
  td.className='dfmea-cell-na '+(cls||'');
  return td;
}

function buildCauseCell(td, cause, fm){
  td.className='sdm-col-cause sdm-cause-td';
  const compName=cause.cause_comp_name||'';
  const fnName  =cause.cause_fn_name||'';
  const fmText  =cause.failure_cause||'';
  const hasData =compName||fnName||fmText;

  const inner=document.createElement('div');
  inner.className='dfmea-cell-wrap';
  inner.innerHTML=`
    <button class="dfmea-corner-del" data-action="del-cause" title="Delete">✕</button>
    <div class="sdm-cause-inner">
      ${hasData?`
        ${compName?`<div class="sdm-cause-comp">${esc(compName)}</div>`:''}
        ${fnName ?`<div class="sdm-cause-fn">${esc(fnName)}</div>`:''}
        ${fmText ?`<div class="sdm-cause-fm">${esc(fmText)}</div>`:
                   `<span class="dfmea-placeholder">—</span>`}
      `:`<span class="dfmea-placeholder">—</span>`}
      <button class="sdm-cause-pick" title="Select component / function / failure mode">✎ Select</button>
    </div>`;
  td.appendChild(inner);

  td.querySelector('[data-action="del-cause"]')?.addEventListener('click',()=>deleteCause(cause,fm));
  td.querySelector('.sdm-cause-pick')?.addEventListener('click',e=>{
    e.stopPropagation();
    openCausePicker(td, cause, fm);
  });
}

function openCausePicker(anchorTd, cause, fm){
  document.querySelectorAll('.sdm-cause-picker').forEach(p=>p.remove());
  const picker=document.createElement('div');
  picker.className='sdm-cause-picker';

  // Step 1: component selector
  const groupId=fm.arch_comp_id;
  const groupComps=_comps.filter(c=>c.data?.group_id===groupId);

  picker.innerHTML=`
    <div class="sdm-picker-hdr">Select Cause</div>
    <label class="sdm-picker-lbl">Component</label>
    <select class="dfmea-sel sdm-picker-comp">
      <option value="">— select —</option>
      ${groupComps.map(c=>`<option value="${c.id}" ${cause.cause_comp_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
    </select>
    <label class="sdm-picker-lbl">Function</label>
    <select class="dfmea-sel sdm-picker-fn" ${!cause.cause_comp_id?'disabled':''}>
      <option value="">— select component first —</option>
      ${cause.cause_comp_id?_fns.filter(f=>f.component_id===cause.cause_comp_id).map(f=>`<option value="${f.id}" ${cause.cause_fn_id===f.id?'selected':''}>${esc(f.name)}</option>`).join(''):''}
    </select>
    <label class="sdm-picker-lbl">Failure Mode</label>
    <select class="dfmea-sel sdm-picker-fm" ${!cause.cause_fn_id?'disabled':''}>
      <option value="">— select function first —</option>
      ${cause.cause_fn_id?(_fnFms[cause.cause_fn_id]||[]).map(fm=>`<option value="${fm.id}" ${cause.cause_fm_id===fm.id?'selected':''}>${esc(fm.failure_mode)}</option>`).join(''):''}
    </select>
    <div class="sdm-picker-actions">
      <button class="btn btn-secondary btn-sm sdm-picker-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm sdm-picker-apply">Apply</button>
    </div>`;

  // Position near cell
  const rect=anchorTd.getBoundingClientRect();
  picker.style.cssText=`position:fixed;top:${rect.bottom+2}px;left:${rect.left}px;z-index:200`;
  document.body.appendChild(picker);

  const compSel=picker.querySelector('.sdm-picker-comp');
  const fnSel  =picker.querySelector('.sdm-picker-fn');
  const fmSel  =picker.querySelector('.sdm-picker-fm');

  compSel.addEventListener('change',()=>{
    const cid=compSel.value;
    const fns=_fns.filter(f=>f.component_id===cid);
    fnSel.innerHTML=`<option value="">— select —</option>${fns.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}`;
    fnSel.disabled=!cid;
    fmSel.innerHTML='<option value="">— select function first —</option>';
    fmSel.disabled=true;
  });
  fnSel.addEventListener('change',()=>{
    const fid=fnSel.value;
    const fms=_fnFms[fid]||[];
    fmSel.innerHTML=`<option value="">— select —</option>${fms.map(fm=>`<option value="${fm.id}">${esc(fm.failure_mode)}</option>`).join('')}`;
    fmSel.disabled=!fid;
  });

  picker.querySelector('.sdm-picker-cancel').addEventListener('click',()=>picker.remove());
  picker.querySelector('.sdm-picker-apply').addEventListener('click',async()=>{
    const comp=_comps.find(c=>c.id===compSel.value)||_groups.find(g=>g.id===compSel.value);
    const fn  =_fns.find(f=>f.id===fnSel.value);
    const fmRec=fn?(_fnFms[fn.id]||[]).find(fm=>fm.id===fmSel.value):null;
    cause.cause_comp_id  =comp?.id||null;
    cause.cause_comp_name=comp?.name||'';
    cause.cause_fn_id    =fn?.id||null;
    cause.cause_fn_name  =fn?.name||'';
    cause.cause_fm_id    =fmRec?.id||null;
    cause.failure_cause  =fmRec?.failure_mode||'';
    await autosave(cause.id,{
      cause_comp_id:cause.cause_comp_id, cause_comp_name:cause.cause_comp_name,
      cause_fn_id:cause.cause_fn_id, cause_fn_name:cause.cause_fn_name,
      cause_fm_id:cause.cause_fm_id, failure_cause:cause.failure_cause,
    });
    picker.remove();
    buildCauseCell(anchorTd, cause, fm);
    anchorTd.innerHTML='';
    buildCauseCell(anchorTd, cause, fm);
  });

  // Close on outside click
  setTimeout(()=>document.addEventListener('click',function h(e){
    if(!picker.contains(e.target)){picker.remove();document.removeEventListener('click',h);}
  }),0);
}

function appendCauseCells(tr,cause,fm){
  const maxS=maxSevForFm(fm);
  const ap=calcAP(maxS,cause.occurrence,cause.detection);
  const apClr=AP_COLORS[ap]||'#9AA0A6';

  const fcTd=makeTd('sdm-col-cause');
  buildCauseCell(fcTd, cause, fm);
  tr.appendChild(fcTd);

  const oTd=makeTd('dfmea-col-sod');
  oTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.occurrence||5}" data-field="occurrence">`;
  tr.appendChild(oTd);

  const prevTd=makeTd('dfmea-col-ctrl dfmea-editable'); prevTd.dataset.field='prevention_controls';
  prevTd.innerHTML=cellText(cause.prevention_controls); tr.appendChild(prevTd);

  const dTd=makeTd('dfmea-col-sod');
  dTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.detection||5}" data-field="detection">`;
  tr.appendChild(dTd);

  const detTd=makeTd('dfmea-col-ctrl dfmea-editable'); detTd.dataset.field='detection_controls';
  detTd.innerHTML=cellText(cause.detection_controls); tr.appendChild(detTd);

  const apTd=makeTd('dfmea-col-ap dfmea-ap-cell');
  apTd.innerHTML=`<span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>`;
  tr.appendChild(apTd);

  const actTd=makeTd('dfmea-col-actions dfmea-editable'); actTd.dataset.field='actions';
  actTd.innerHTML=cellText(cause.actions); tr.appendChild(actTd);

  const respTd=makeTd('dfmea-col-resp dfmea-editable'); respTd.dataset.field='responsible';
  respTd.innerHTML=cellText(cause.responsible); tr.appendChild(respTd);

  const dateTd=makeTd('dfmea-col-date dfmea-editable'); dateTd.dataset.field='target_date';
  dateTd.innerHTML=cellText(cause.target_date); tr.appendChild(dateTd);

  const asTd=makeTd('dfmea-col-astatus');
  asTd.innerHTML=`<select class="dfmea-sel" data-field="action_status">${ACTION_STATUSES.map(s=>`<option value="${s}"${cause.action_status===s?' selected':''}>${s.replace('_',' ')}</option>`).join('')}</select>`;
  tr.appendChild(asTd);
}

function causeTrShell(cause,fm,isDirectCause=false){
  const tr=document.createElement('tr');
  tr.className='dfmea-row dfmea-row-cause';
  tr.dataset.id=cause.id; tr.dataset.type='cause';
  if(isDirectCause){
    tr.appendChild(naCell('sdm-col-eff'));
    tr.appendChild(naCell('sdm-col-eff'));
    tr.appendChild(naCell('dfmea-col-sod'));
  }
  appendCauseCells(tr,cause,fm);
  return tr;
}

// ── Row wiring ─────────────────────────────────────────────────────────────────

function wireTextCell(td,it,field,afterSave){
  td.addEventListener('dblclick',()=>{
    if(td.querySelector('textarea')) return;
    const inner=getInner(td);
    const cur=it[field]||'';
    const h=Math.max(td.offsetHeight-4,20);
    inner.innerHTML=`<textarea class="dfmea-cell-input" style="height:${h}px">${esc(cur)}</textarea>`;
    const ta=inner.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); it[field]=v;
      inner.innerHTML=cellText(v);
      if(v!==cur) await autosave(it.id,{[field]:v});
      if(afterSave) afterSave();
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape'){inner.innerHTML=cellText(cur);if(afterSave)afterSave();}
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });
}

function wireTextCellGroup(td,g,field){
  td.addEventListener('dblclick',()=>{
    if(td.querySelector('textarea')) return;
    const inner=getInner(td);
    const cur=g[field]||'';
    const h=Math.max(td.offsetHeight-4,20);
    inner.innerHTML=`<textarea class="dfmea-cell-input" style="height:${h}px">${esc(cur)}</textarea>`;
    const ta=inner.querySelector('textarea'); ta.focus();
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); inner.innerHTML=cellText(v);
      if(v===cur) return;
      for(const fm of g.fms){
        fm[field]=v;
        await autosave(fm.id,{[field]:v});
      }
      g[field]=v;
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape') inner.innerHTML=cellText(cur);
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });
}

function wireFmCells(fmTr,fmTd,statusTd,fm,g){
  fmTr.addEventListener('click',e=>{if(!e.target.closest('input,select,button')) selectRow(fm.id);});
  fmTd.addEventListener('dblclick',()=>{
    if(fmTd.querySelector('textarea')) return;
    const inner=getInner(fmTd);
    const cur=fm.failure_mode||'';
    const h=Math.max(fmTd.offsetHeight-4,20);
    inner.innerHTML=`<textarea class="dfmea-cell-input" style="height:${h}px">${esc(cur)}</textarea>`;
    const ta=inner.querySelector('textarea'); ta.focus();
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); fm.failure_mode=v;
      inner.innerHTML=cellText(v);
      await autosave(fm.id,{failure_mode:v});
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape') inner.innerHTML=cellText(cur);
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });
  fmTr.querySelector('[data-action="del-fm"]')?.addEventListener('click',()=>deleteFm(fm));
  statusTd.querySelector('.dfmea-sel')?.addEventListener('change',async e=>{
    fm.status=e.target.value; await autosave(fm.id,{status:e.target.value});
  });
}

function wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm){
  wireTextCell(effHTd,eff,'effect_higher');
  wireTextCell(effLTd,eff,'effect_local');
  sTd.querySelector('.dfmea-sod-input')?.addEventListener('change',async e=>{
    const v=Math.min(10,Math.max(1,+e.target.value||5));
    e.target.value=v; eff.severity=v;
    await autosave(eff.id,{severity:v});
    refreshMaxSCell(fm);
    refreshCauseAPs(fm);
  });
}

function wireCauseCells(tr,cause,fm){
  tr.addEventListener('click',e=>{if(!e.target.closest('input,select,button')) selectRow(cause.id);});
  tr.querySelectorAll('.dfmea-editable').forEach(td=>{
    if(td.dataset.field&&td.dataset.field!=='failure_cause') wireTextCell(td,cause,td.dataset.field);
  });
  tr.querySelectorAll('.dfmea-sod-input').forEach(inp=>{
    inp.addEventListener('change',async e=>{
      const f=inp.dataset.field;
      const v=Math.min(10,Math.max(1,+e.target.value||5));
      e.target.value=v; cause[f]=v;
      await autosave(cause.id,{[f]:v});
      refreshCauseAP(tr,cause,fm);
    });
  });
  tr.querySelectorAll('.dfmea-sel').forEach(sel=>{
    sel.addEventListener('change',async e=>{
      cause[e.target.dataset.field]=e.target.value;
      await autosave(cause.id,{[e.target.dataset.field]:e.target.value});
    });
  });
  tr.querySelector('[data-action="del-cause"]')?.addEventListener('click',()=>deleteCause(cause,fm));
}

// ── Refresh helpers ────────────────────────────────────────────────────────────

function selectRow(id){
  _selId=id;
  document.querySelectorAll('.dfmea-row').forEach(r=>r.classList.toggle('selected',r.dataset.id===id));
}

function refreshMaxSCell(fm){
  document.querySelectorAll(`.dfmea-maxs-cell[data-fm-id="${fm.id}"]`).forEach(cell=>{
    const maxS=maxSevForFm(fm);
    cell.innerHTML=maxS?`<span class="dfmea-maxs-badge">${maxS}</span>`:`<span class="dfmea-placeholder">—</span>`;
  });
}

function refreshCauseAP(tr,cause,fm){
  const maxS=maxSevForFm(fm);
  const ap=calcAP(maxS,cause.occurrence,cause.detection);
  const cell=tr.querySelector('.dfmea-ap-cell');
  if(cell) cell.innerHTML=`<span class="dfmea-ap-badge" style="background:${AP_COLORS[ap]||'#9AA0A6'}">${ap}</span>`;
}

function refreshCauseAPs(fm){
  _items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id).forEach(c=>{
    const tr=document.querySelector(`tr[data-id="${c.id}"]`);
    if(tr) refreshCauseAP(tr,c,fm);
  });
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

async function autosave(id,fields){
  const {error}=await sb.from('sys_dfmea_items').update({...fields,updated_at:new Date().toISOString()}).eq('id',id);
  if(error) toast('Autosave failed.','error');
}

async function addFmRow(prefill={}){
  const idx=await nextIndex('sys_dfmea_items',{item_id:_ctx.parentId});
  const code=buildCode('SDM',{projectName:_ctx.project.name,index:idx});
  const {data:fm,error}=await sb.from('sys_dfmea_items').insert({
    dfmea_code:code, item_id:_ctx.parentId, project_id:_ctx.project.id,
    row_type:'fm', sort_order:_items.filter(i=>rtype(i)==='fm').length,
    severity:5,occurrence:5,detection:5,action_status:'open',status:'draft',...prefill,
  }).select().single();
  if(error){toast('Error creating row.','error');return null;}
  _items.push(fm);
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${fm.id}"] .sdm-col-fm`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
  return fm;
}

async function addEffectRow(fm){
  const existing=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  const {data:eff,error}=await sb.from('sys_dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-E${existing.length+1}`,
    item_id:_ctx.parentId,project_id:_ctx.project.id,
    row_type:'effect',parent_row_id:fm.id,
    sort_order:existing.length,severity:5,occurrence:5,detection:5,
    action_status:'open',status:'draft',
  }).select().single();
  if(error){toast('Error creating effect.','error');return;}
  _items.push(eff);
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${eff.id}"] .sdm-col-eff`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function addCauseRow(parentId,fm){
  const existing=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===parentId);
  const {data:cause,error}=await sb.from('sys_dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-C${_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id).length+1}`,
    item_id:_ctx.parentId,project_id:_ctx.project.id,
    row_type:'cause',parent_row_id:parentId,
    sort_order:existing.length,severity:5,occurrence:5,detection:5,
    action_status:'open',status:'draft',
  }).select().single();
  if(error){toast('Error creating cause.','error');return;}
  _items.push(cause);
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${cause.id}"] .sdm-col-cause`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function deleteFm(fm){
  const kids=_items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id);
  const ids=[fm.id,...kids.map(i=>i.id)];
  showModal({
    title:'Delete Failure Mode',
    body:`<p>Delete FM <strong>${esc(fm.dfmea_code)}</strong>${kids.length?` and its ${kids.length} child row(s)`:''}?</p>`,
    footer:`<button class="btn btn-secondary" id="dfm2-cancel">Cancel</button><button class="btn btn-danger" id="dfm2-confirm">Delete</button>`,
  });
  document.getElementById('dfm2-cancel').onclick=()=>hideModal();
  document.getElementById('dfm2-confirm').onclick=async()=>{
    hideModal();
    await sb.from('sys_dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); toast('Deleted.','success');
  };
}

async function deleteEffect(eff,fm){
  const causes=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===eff.id);
  const ids=[eff.id,...causes.map(i=>i.id)];
  showModal({
    title:'Delete Effect',
    body:`<p>Delete this effect${causes.length?` and its ${causes.length} cause(s)`:''}?</p>`,
    footer:`<button class="btn btn-secondary" id="de2-cancel">Cancel</button><button class="btn btn-danger" id="de2-confirm">Delete</button>`,
  });
  document.getElementById('de2-cancel').onclick=()=>hideModal();
  document.getElementById('de2-confirm').onclick=async()=>{
    hideModal();
    await sb.from('sys_dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); refreshMaxSCell(fm);
  };
}

async function deleteCause(cause,fm){
  showModal({
    title:'Delete Cause',
    body:`<p>Delete this failure cause?</p>`,
    footer:`<button class="btn btn-secondary" id="dc2-cancel">Cancel</button><button class="btn btn-danger" id="dc2-confirm">Delete</button>`,
  });
  document.getElementById('dc2-cancel').onclick=()=>hideModal();
  document.getElementById('dc2-confirm').onclick=async()=>{
    hideModal();
    await sb.from('sys_dfmea_items').delete().eq('id',cause.id);
    _items=_items.filter(i=>i.id!==cause.id);
    renderTable();
  };
}

async function deleteFnGroup(g){
  const ids=g.fms.flatMap(fm=>[fm.id,..._items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id).map(i=>i.id)]);
  showModal({
    title:'Delete Function Group',
    body:`<p>Delete function <strong>${esc(g.function_name||'—')}</strong> and all its rows (${ids.length})?</p>`,
    footer:`<button class="btn btn-secondary" id="dfg2-cancel">Cancel</button><button class="btn btn-danger" id="dfg2-confirm">Delete all</button>`,
  });
  document.getElementById('dfg2-cancel').onclick=()=>hideModal();
  document.getElementById('dfg2-confirm').onclick=async()=>{
    hideModal();
    await sb.from('sys_dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); toast('Deleted.','success');
  };
}

async function deleteSystemGroup(archCompIdOrName){
  const fmsToDelete=_items.filter(i=>rtype(i)==='fm'&&(i.arch_comp_id===archCompIdOrName||i.system_name===archCompIdOrName));
  const ids=fmsToDelete.flatMap(fm=>[fm.id,..._items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id).map(i=>i.id)]);
  showModal({
    title:'Delete System Group',
    body:`<p>Delete all DFMEA rows for this system (${ids.length} rows)?</p>`,
    footer:`<button class="btn btn-secondary" id="dsg2-cancel">Cancel</button><button class="btn btn-danger" id="dsg2-confirm">Delete all</button>`,
  });
  document.getElementById('dsg2-cancel').onclick=()=>hideModal();
  document.getElementById('dsg2-confirm').onclick=async()=>{
    hideModal();
    await sb.from('sys_dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); toast('Deleted.','success');
  };
}

// ── Sync from Architecture ─────────────────────────────────────────────────────

async function syncFromArchitecture(){
  const btn=document.getElementById('btn-sdm-sync');
  if(btn){btn.disabled=true;btn.textContent='⟳ Syncing…';}
  try{
    if(!_groups.length){toast('No systems found in Architecture Concept.','warning');return;}
    const existingKeys=new Set(_items.filter(i=>rtype(i)==='fm').map(i=>`${i.arch_comp_id}__${i.function_name}`));
    let created=0;
    for(const grp of _groups){
      const grpFns=_fns.filter(f=>f.component_id===grp.id);
      if(!grpFns.length){
        // Create one FM placeholder without a function
        const key=`${grp.id}__`;
        if(!existingKeys.has(key)){
          await addFmRow({arch_comp_id:grp.id,system_name:grp.name,function_name:''});
          created++;
        }
      } else {
        for(const fn of grpFns){
          const key=`${grp.id}__${fn.name}`;
          if(!existingKeys.has(key)){
            await addFmRow({arch_comp_id:grp.id,system_name:grp.name,function_name:fn.name,function_ref_id:fn.id});
            created++;
          }
        }
      }
    }
    toast(created>0?`Synced ${created} new row(s) from Architecture.`:'Already up to date.','success');
  }catch(e){toast('Sync error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='⟳ Sync from Architecture';}}
}
