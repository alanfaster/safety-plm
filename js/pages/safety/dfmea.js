/**
 * DFMEA — Design Failure Mode and Effects Analysis (VDA DFMEA 2019)
 *
 * Visual hierarchy (rowspan-based, like Medini / APIS):
 *
 *  ┌────────────────┬─────────────────┬──────┬───────────────────┬──────────────────────────────┐
 *  │ Component /    │ Failure Mode    │ MaxS │ Effect Higher /   │ Failure Cause / O / D / AP … │
 *  │ Function       │                 │      │ Effect Local / S  │                              │
 *  │ (rowspan=all)  │ (rowspan=effects│      │ (rowspan=causes)  │ one row per cause            │
 *  │                │  + causes)      │      │                   │                              │
 *  └────────────────┴─────────────────┴──────┴───────────────────┴──────────────────────────────┘
 *
 * "+" buttons live INSIDE the cells:
 *   • FM cell          → adds another FM to same Component/Function group
 *   • Effect Higher cell → adds another Effect to that FM
 *   • Failure Cause cell → adds another Cause to that Effect or FM
 *
 * row_type: 'fm' | 'effect' | 'cause'  (DB column added by migration_dfmea_v2.sql)
 * parent_row_id: effect→fm, cause→effect or fm
 */

import { sb, buildCode, nextIndex } from '../../config.js';
import { wireBottomPanel } from '../../utils/bottom-panel.js';
import { toast } from '../../toast.js';
import { showModal, hideModal } from '../../components/modal.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STATUSES = ['open', 'in_progress', 'closed'];
const ITEM_STATUSES   = ['draft', 'review', 'approved'];

function calcAP(s, o, d) {
  s=+s; o=+o; d=+d; if(!s||!o||!d) return '-';
  if(s>=9) return 'H';
  if(s>=7){if(o===1&&d<=3)return 'L';if(o===1)return 'M';return 'H';}
  if(s>=4){if(o<=2&&d<=3)return 'L';if(o<=2)return 'M';if(d<=3)return 'M';return 'H';}
  if(s>=2){if(o<=2&&d<=3)return 'N';if(o<=2)return 'L';return 'M';}
  return 'N';
}

const AP_COLORS    = {H:'#C5221F',M:'#E65100',L:'#1E8E3E',N:'#6B778C','-':'#9AA0A6'};
const IFACE_COLORS = {Data:'#1A73E8',Electrical:'#E37400',Mechanical:'#5D4037',Thermal:'#C5221F',Power:'#7B1FA2'};
const COMP_COLORS  = {
  HW:        {border:'#1A73E8',badge:'#E8F0FE',badgeText:'#1A73E8'},
  SW:        {border:'#1E8E3E',badge:'#E6F4EA',badgeText:'#1E8E3E'},
  Mechanical:{border:'#E37400',badge:'#FEF3E2',badgeText:'#E37400'},
  Group:     {border:'#9AA0A6',badge:'#F8F9FA',badgeText:'#6B778C'},
  Port:      {border:'#212121',badge:'#EEE',   badgeText:'#333'   },
};

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx     = null;
let _items   = [];
let _selId   = null;
let _chain   = {components:[],functions:[],selCompId:null,selFuncId:null};
let _map     = {components:[],connections:[],functions:[]};
let _netVisible  = true;
let _focusFmId   = null;
let _rowCtx      = new WeakMap();
let _pill        = null;
let _activeTbody = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function cellText(v){
  if(!v)return`<span class="dfmea-placeholder">—</span>`;
  return`<span class="dfmea-cell-text">${esc(v)}</span>`;
}
function rtype(it){return it.row_type||'fm';}

/** Wraps td content so the corner-del button survives innerHTML replacements on the inner div */
function wrapWithDel(td, action, innerHtml){
  td.innerHTML=`<div class="dfmea-cell-wrap"><button class="dfmea-corner-del" data-action="${action}" title="Delete">✕</button><div class="dfmea-cell-inner">${innerHtml}</div></div>`;
}
function setInner(td, html){
  const inner=td.querySelector('.dfmea-cell-inner');
  if(inner) inner.innerHTML=html; else td.innerHTML=html;
}
function getInner(td){
  return td.querySelector('.dfmea-cell-inner')||td;
}

function maxSevForFm(fm){
  const effs=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  if(!effs.length) return fm.severity||0;
  return Math.max(...effs.map(e=>+e.severity||0),0);
}

function fmOf(it){
  if(rtype(it)==='fm') return it;
  if(rtype(it)==='effect') return _items.find(i=>i.id===it.parent_row_id)||null;
  if(rtype(it)==='cause'){
    const p=_items.find(i=>i.id===it.parent_row_id); if(!p) return null;
    return rtype(p)==='fm'?p:(_items.find(i=>i.id===p.parent_row_id)||null);
  }
  return null;
}

/** Group FM rows by component_id+function_name (stable insertion order). */
function buildGroups(){
  const fms=_items.filter(i=>rtype(i)==='fm');
  const order=[], map=new Map();
  fms.forEach(fm=>{
    const k=`${fm.component_id||''}__${fm.component_name||''}__${fm.function_name||''}`;
    if(!map.has(k)){
      const g={key:k,component_id:fm.component_id,component_name:fm.component_name,function_name:fm.function_name,fms:[]};
      order.push(g); map.set(k,g);
    }
    map.get(k).fms.push(fm);
  });
  return order;
}

/** Total <tr> count for one FM (its own row + effect rows + cause rows).
 *  The effect <tr> is merged with its FIRST cause, so each effect contributes
 *  max(1, causesUnderEffect) rows — not 1 + N.
 */
function fmRowCount(fm){
  const effects=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  const directCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id);
  const effectRows=effects.reduce((n,e)=>{
    const c=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===e.id).length;
    return n+Math.max(1,c);
  },0);
  return 1+effectRows+directCauses.length;
}

/** Total <tr> count for one group. */
function groupRowCount(g){return g.fms.reduce((n,fm)=>n+fmRowCount(fm),0);}

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, {project,item,system,parentType,parentId}){
  const isItemLevel = parentType === 'item';
  _ctx={project,parentType,parentId,isItemLevel};
  _items=[]; _selId=null; _netVisible=true; _focusFmId=null;
  _chain={components:[],functions:[],selCompId:null,selFuncId:null};
  _map={components:[],connections:[],functions:[]};

  const parentName = system?.name || item?.name || '';
  const focusLabel = isItemLevel ? 'System'    : 'Component';
  const upperLabel = isItemLevel ? 'Item'       : 'System';
  const lowerLabel = isItemLevel ? 'Component'  : 'Sub-component';
  const syncLabel  = isItemLevel ? '⟳ Sync from Architecture' : '⟳ Sync from FHA';

  container.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden';
  container.innerHTML=`
    <div class="page-header" style="flex-shrink:0">
      <div class="page-header-top">
        <div>
          <h1>Functional FMEA</h1>
          <p class="page-subtitle">VDA 2019 · ${esc(parentName)}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
          <span style="font-size:11px;background:var(--bg-hover);border:1px solid var(--color-border);border-radius:5px;padding:3px 10px;color:var(--color-text-muted);">
            Upper: <strong>${upperLabel}</strong>
            &nbsp;·&nbsp; Focus: <strong style="color:var(--color-primary);">${focusLabel}</strong>
            &nbsp;·&nbsp; Lower: <strong>${lowerLabel}</strong>
          </span>
        </div>
        <div class="dfmea-toolbar">
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-dfmea-sync">${syncLabel}</button>
          <button class="btn btn-primary   btn-sm" id="btn-dfmea-new" title="Add new row">＋ New</button>
        </div>
      </div>
    </div>
    <div class="dfmea-layout" id="dfmea-layout">
      <div class="dfmea-table-area" id="dfmea-table-area">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <div class="bp-bar bp-collapsed dfmea-bp-fnet" id="dfmea-fnet-panel">
        <div class="bp-resize-handle"></div>
        <div class="bp-hdr">
          <span class="bp-title">⬡ Failure Net</span>
          <span class="bp-subtitle" id="fnet-focus-label">All FMs · click FM node to focus · drag to pan · scroll to zoom</span>
          <button class="dfmea-tb-btn" id="btn-fnet-all" style="margin-left:auto">All FMs</button>
          <span class="bp-toggle">▲</span>
        </div>
        <div class="bp-body dfmea-fnet-body" id="dfmea-fnet-body"></div>
      </div>
    </div>`;

  wirePanelToggles();
  document.getElementById('btn-dfmea-new').onclick  = ()=>addFmRow();
  document.getElementById('btn-dfmea-sync').onclick = ()=>(_ctx.isItemLevel ? syncFromArchitecture() : syncFromSystem());

  await loadItems();
}

// ── Panels ────────────────────────────────────────────────────────────────────

function wirePanelToggles(){
  const fnetBar=document.getElementById('dfmea-fnet-panel');
  wireBottomPanel(fnetBar,{key:'dfmea_fnet_h',defaultH:300,onExpand:()=>renderFailureNet()});
  document.getElementById('btn-fnet-all')?.addEventListener('click',e=>{
    e.stopPropagation();
    _focusFmId=null;
    document.getElementById('fnet-focus-label').textContent='All FMs · click FM node to focus · drag to pan · scroll to zoom';
    renderFailureNet();
  });
}

// ── Load items ────────────────────────────────────────────────────────────────

async function loadItems(){
  const area=document.getElementById('dfmea-table-area'); if(!area) return;
  const {data,error}=await sb.from('dfmea_items')
    .select('*').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId)
    .order('sort_order',{ascending:true}).order('created_at',{ascending:true});
  if(error){
    area.innerHTML=`<div class="card"><div class="card-body">
      <p style="color:var(--color-danger)"><strong>Error:</strong> <code>${esc(error.message)}</code></p>
      <p style="margin-top:8px;font-size:13px">Run <code>db/migration_dfmea.sql</code> and <code>db/migration_dfmea_v2.sql</code> in Supabase.</p>
    </div></div>`;
    return;
  }
  _items=data||[];
  await refreshNamesFromSources();
  renderTable(area);
}

/**
 * Refresh denormalized component_name and function_name from live sources:
 *   • component_name ← arch_components.name  (keyed by component_id)
 *   • function_name  ← functions.name via hazard.function_id  (item-definition)
 * Runs silently on every load so renames in Architecture or Item Definition are
 * automatically reflected without a manual ⟳ Sync.
 */
async function refreshNamesFromSources(){
  const fmRows=_items.filter(i=>rtype(i)==='fm');
  if(!fmRows.length) return;

  // 1. Refresh component_name from arch_components
  const compIds=[...new Set(fmRows.filter(f=>f.component_id).map(f=>f.component_id))];
  const compMap={};
  if(compIds.length){
    const {data:comps}=await sb.from('arch_components').select('id,name').in('id',compIds);
    (comps||[]).forEach(c=>{compMap[c.id]=c.name;});
  }

  // 2. Refresh function_name via hazard → item-definition functions
  const hazIds=[...new Set(fmRows.filter(f=>f.hazard_id).map(f=>f.hazard_id))];
  const hazFnMap={}; // hazard_id → current function name
  if(hazIds.length){
    const {data:hazards}=await sb.from('hazards').select('id,function_id').in('id',hazIds);
    const fnIds=[...new Set((hazards||[]).filter(h=>h.function_id).map(h=>h.function_id))];
    if(fnIds.length){
      const {data:fns}=await sb.from('functions').select('id,name').in('id',fnIds);
      const fnMap={};
      (fns||[]).forEach(f=>{fnMap[f.id]=f.name;});
      (hazards||[]).forEach(h=>{if(h.function_id&&fnMap[h.function_id]) hazFnMap[h.id]=fnMap[h.function_id];});
    }
  }

  // 3. Apply updates where name has drifted
  const now=new Date().toISOString();
  for(const fm of fmRows){
    const updates={};
    const newComp=fm.component_id?compMap[fm.component_id]:undefined;
    const newFn=fm.hazard_id?hazFnMap[fm.hazard_id]:undefined;
    if(newComp!==undefined&&newComp!==fm.component_name){fm.component_name=newComp;updates.component_name=newComp;}
    if(newFn!==undefined&&newFn!==fm.function_name){fm.function_name=newFn;updates.function_name=newFn;}
    if(Object.keys(updates).length){
      await sb.from('dfmea_items').update({...updates,updated_at:now}).eq('id',fm.id);
    }
  }
}

// ── Table render (full rebuild — called on any structural change) ──────────────

function renderTable(area){
  if(!(area instanceof HTMLElement)) area=document.getElementById('dfmea-table-area');
  if(!area) return;

  const groups=buildGroups();

  if(!groups.length){
    area.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon">⚠</div>
      <h3>No DFMEA entries yet</h3>
      <p>Click <strong>＋ New</strong> to start a new Function group, or use <strong>⟳ Sync from System</strong>.</p>
    </div>`;
    return;
  }

  const isItem = _ctx?.isItemLevel;
  area.innerHTML=`
    <div class="dfmea-table-wrap">
      <table class="dfmea-table">
        <thead><tr>
          <th class="dfmea-col-compfunc">${isItem ? 'System / Function' : 'Component / Function'}</th>
          <th class="dfmea-col-fm">Failure Mode</th>
          <th class="dfmea-col-maxs" title="Max Severity">Max S</th>
          <th class="dfmea-col-status">Status</th>
          <th class="dfmea-col-eff">${isItem ? 'Effect — Item Level' : 'Effect — System Level'}</th>
          <th class="dfmea-col-eff">${isItem ? 'Effect — System Level' : 'Effect — Local'}</th>
          <th class="dfmea-col-sod" title="Severity">S</th>
          <th class="dfmea-col-fc">${isItem ? 'Failure Cause (Component)' : 'Failure Cause'}</th>
          <th class="dfmea-col-ctrl">Prevention Controls</th>
          <th class="dfmea-col-sod" title="Occurrence">O</th>
          <th class="dfmea-col-ctrl">Detection Controls</th>
          <th class="dfmea-col-sod" title="Detection">D</th>
          <th class="dfmea-col-ap">AP</th>
          <th class="dfmea-col-actions">Actions</th>
          <th class="dfmea-col-resp">Responsible</th>
          <th class="dfmea-col-date">Target Date</th>
          <th class="dfmea-col-astatus">Action Status</th>
        </tr></thead>
        <tbody id="dfmea-tbody"></tbody>
      </table>
    </div>`;

  const tbody=document.getElementById('dfmea-tbody');
  groups.forEach(g=>renderGroup(tbody,g));
  wireInsertHover(tbody);
}

// ── Group rendering ───────────────────────────────────────────────────────────

function renderGroup(tbody,g){
  const totalSpan=groupRowCount(g);
  g.fms.forEach((fm,fi)=>{
    const effects       =_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
    const directCauses  =_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id);
    const fmSpan        =fmRowCount(fm);
    const isFirstFm     =(fi===0);
    const isLastFm      =(fi===g.fms.length-1);

    // ── FM row ──────────────────────────────────────────────────────────────
    const fmTr=document.createElement('tr');
    fmTr.className=`dfmea-row dfmea-row-fm${isFirstFm?' dfmea-group-first':''}${isLastFm&&!effects.length&&!directCauses.length?' dfmea-group-last':''}`;
    fmTr.dataset.id=fm.id; fmTr.dataset.type='fm';

    // Function cell (rowspan = entire group, only on first FM)
    if(isFirstFm){
      const cfTd=document.createElement('td');
      cfTd.rowSpan=totalSpan;
      cfTd.className='dfmea-col-compfunc dfmea-group-cell';
      cfTd.innerHTML=`<div class="dfmea-cell-wrap">
        <button class="dfmea-corner-del" data-action="del-group" title="Delete function group">✕</button>
        <div class="dfmea-cf-func dfmea-editable" data-field="function_name" data-fm-id="${fm.id}" title="dblclick to edit">${cellText(fm.function_name)}</div>
        ${fm.component_name?`<div class="dfmea-cf-comp-sub">${esc(fm.component_name)}</div>`:''}
      </div>`;

      fmTr.appendChild(cfTd);
      cfTd.querySelector('[data-action="del-group"]')?.addEventListener('click', () => deleteGroup(g));
      // Wire group-cell editing (edits ALL fms in group for comp/func)
      cfTd.querySelectorAll('.dfmea-editable').forEach(el=>wireGroupCellEdit(el,g));
    }

    // Failure Mode cell (rowspan = this FM's rows)
    const fmTd=makeTd('dfmea-col-fm dfmea-editable',fmSpan);
    fmTd.dataset.field='failure_mode';
    wrapWithDel(fmTd,'del-fm',cellText(fm.failure_mode));
    fmTr.appendChild(fmTd);

    // Max S cell (rowspan = this FM's rows)
    const maxSTd=makeTd('dfmea-col-maxs',fmSpan);
    const maxS=maxSevForFm(fm);
    maxSTd.dataset.fmId=fm.id;
    maxSTd.className+=' dfmea-maxs-cell';
    maxSTd.innerHTML=maxS?`<span class="dfmea-maxs-badge">${maxS}</span>`:`<span class="dfmea-placeholder">—</span>`;
    fmTr.appendChild(maxSTd);

    // Status + del immediately after maxs (rowspan cells must be contiguous for correct layout)
    const statusTd=makeTd('dfmea-col-status',fmSpan);
    statusTd.innerHTML=`<select class="dfmea-sel" data-field="status">${ITEM_STATUSES.map(s=>`<option value="${s}"${fm.status===s?' selected':''}>${s}</option>`).join('')}</select>`;
    fmTr.appendChild(statusTd);

    if(!effects.length&&!directCauses.length){
      const naEff1=naCell('dfmea-col-eff dfmea-na-editable'); naEff1.title='Double-click to add Effect';
      naEff1.innerHTML='<span class="dfmea-placeholder">—</span>';
      naEff1.addEventListener('dblclick',()=>addEffectRow(fm)); fmTr.appendChild(naEff1);
      const naEff2=naCell('dfmea-col-eff dfmea-na-editable'); naEff2.title='Double-click to add Effect';
      naEff2.innerHTML='<span class="dfmea-placeholder">—</span>';
      naEff2.addEventListener('dblclick',()=>addEffectRow(fm)); fmTr.appendChild(naEff2);
      fmTr.appendChild(naCell('dfmea-col-sod'));
      const naFc=naCell('dfmea-col-fc dfmea-na-editable'); naFc.title='Double-click to add Cause';
      naFc.innerHTML='<span class="dfmea-placeholder">—</span>';
      naFc.addEventListener('dblclick',()=>addCauseRow(fm.id,fm)); fmTr.appendChild(naFc);
      ['dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ap',
       'dfmea-col-actions','dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'].forEach(c=>fmTr.appendChild(naCell(c)));
    }

    _rowCtx.set(fmTr,{type:'fm',fm,g});
    tbody.appendChild(fmTr);
    wireFmCells(fmTr,fmTd,statusTd,fm,g);

    // ── Effect rows ────────────────────────────────────────────────────────
    effects.forEach((eff,ei)=>{
      const effCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===eff.id);
      // Effect TR is merged with its first cause → actual rows = max(1, N causes)
      const effSpan  =Math.max(1,effCauses.length);
      const isLastEff=(ei===effects.length-1);

      const effTr=document.createElement('tr');
      effTr.className='dfmea-row dfmea-row-effect';
      effTr.dataset.id=eff.id; effTr.dataset.type='effect';

      // Effect Higher (rowspan = 1 + causes under this effect)
      const effHTd=makeTd('dfmea-col-eff dfmea-editable',effSpan);
      effHTd.dataset.field='effect_higher';
      wrapWithDel(effHTd,'del-effect',cellText(eff.effect_higher));
      effTr.appendChild(effHTd);

      // Effect Local (rowspan)
      const effLTd=makeTd('dfmea-col-eff dfmea-editable',effSpan);
      effLTd.dataset.field='effect_local';
      effLTd.innerHTML=cellText(eff.effect_local);
      effTr.appendChild(effLTd);

      // S (rowspan)
      const sTd=makeTd('dfmea-col-sod',effSpan);
      sTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${eff.severity||5}" data-field="severity">`;
      effTr.appendChild(sTd);

      // First cause inline (or NA if no causes)
      _rowCtx.set(effTr,{type:'effect',eff,fm,g});
      if(effCauses.length){
        appendCauseCells(effTr,effCauses[0],fm,effCauses.length===1);
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
        wireCauseCells(effTr,effCauses[0],fm);
        // Remaining causes
        effCauses.slice(1).forEach((c,ci)=>{
          const cTr=causeTrShell(c,fm,ci===effCauses.length-2);
          _rowCtx.set(cTr,{type:'cause',cause:c,fm,g});
          tbody.appendChild(cTr);
          wireCauseCells(cTr,c,fm);
        });
      } else {
        appendNaCauseCells(effTr,eff.id,fm);
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
      }
      // Wire inline del-effect button (inside effHTd)
      effHTd.querySelector('[data-action="del-effect"]')?.addEventListener('click',()=>deleteEffect(eff,fm));
    });

    // ── Direct causes (parent = FM) ────────────────────────────────────────
    // Direct causes have no effect row above them → prepend NA cells for Effect Higher/Local/S
    directCauses.forEach((c,ci)=>{
      const cTr=causeTrShell(c,fm,ci===directCauses.length-1,true);
      _rowCtx.set(cTr,{type:'cause',cause:c,fm,g});
      tbody.appendChild(cTr);
      wireCauseCells(cTr,c,fm);
    });
  });
}

// ── Cell factories ────────────────────────────────────────────────────────────

function makeTd(cls,span=1){
  const td=document.createElement('td');
  td.className=cls;
  if(span>1) td.rowSpan=span;
  return td;
}
function naCell(cls){const td=document.createElement('td');td.className='dfmea-cell-na '+(cls||'');return td;}

/** Build <td> cells for a cause and append them to tr. */
function appendCauseCells(tr,cause,fm,isLast){
  const maxS=maxSevForFm(fm);
  const ap=calcAP(maxS,cause.occurrence,cause.detection);
  const apClr=AP_COLORS[ap]||'#9AA0A6';

  const fcTd=makeTd('dfmea-col-fc dfmea-editable');
  fcTd.dataset.field='failure_cause';
  wrapWithDel(fcTd,'del-cause',cellText(cause.failure_cause));
  tr.appendChild(fcTd);

  const prevTd=makeTd('dfmea-col-ctrl dfmea-editable');prevTd.dataset.field='prevention_controls';prevTd.innerHTML=cellText(cause.prevention_controls);tr.appendChild(prevTd);

  const oTd=makeTd('dfmea-col-sod');oTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.occurrence||5}" data-field="occurrence">`;tr.appendChild(oTd);

  const detCtrlTd=makeTd('dfmea-col-ctrl dfmea-editable');detCtrlTd.dataset.field='detection_controls';detCtrlTd.innerHTML=cellText(cause.detection_controls);tr.appendChild(detCtrlTd);

  const dTd=makeTd('dfmea-col-sod');dTd.innerHTML=`<input class="dfmea-sod-input" type="number" min="1" max="10" value="${cause.detection||5}" data-field="detection">`;tr.appendChild(dTd);

  const apTd=makeTd('dfmea-col-ap dfmea-ap-cell');apTd.innerHTML=`<span class="dfmea-ap-badge" style="background:${apClr}">${ap}</span>`;tr.appendChild(apTd);

  const actTd=makeTd('dfmea-col-actions dfmea-editable');actTd.dataset.field='actions';actTd.innerHTML=cellText(cause.actions);tr.appendChild(actTd);
  const respTd=makeTd('dfmea-col-resp dfmea-editable');respTd.dataset.field='responsible';respTd.innerHTML=cellText(cause.responsible);tr.appendChild(respTd);
  const dateTd=makeTd('dfmea-col-date dfmea-editable');dateTd.dataset.field='target_date';dateTd.innerHTML=cellText(cause.target_date);tr.appendChild(dateTd);

  const asTd=makeTd('dfmea-col-astatus');
  asTd.innerHTML=`<select class="dfmea-sel" data-field="action_status">${ACTION_STATUSES.map(s=>`<option value="${s}"${cause.action_status===s?' selected':''}>${s.replace('_',' ')}</option>`).join('')}</select>`;
  tr.appendChild(asTd);
}

function appendNaCauseCells(tr, parentId, fm){
  const fcNa=naCell('dfmea-col-fc dfmea-na-editable');
  fcNa.title='Double-click to add Cause';
  fcNa.innerHTML='<span class="dfmea-placeholder">—</span>';
  fcNa.addEventListener('dblclick',()=>addCauseRow(parentId,fm,null));
  tr.appendChild(fcNa);
  ['dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ap','dfmea-col-actions','dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'].forEach(c=>tr.appendChild(naCell(c)));
}

function causeTrShell(cause,fm,isLast,isDirectCause=false){
  const tr=document.createElement('tr');
  tr.className='dfmea-row dfmea-row-cause';
  tr.dataset.id=cause.id; tr.dataset.type='cause'; tr.dataset.fmId=fm.id;
  // Direct causes (parent = FM) have no effect row providing cols 6-8; add NA cells for them
  if(isDirectCause){
    tr.appendChild(naCell('dfmea-col-eff'));  // Effect Higher
    tr.appendChild(naCell('dfmea-col-eff'));  // Effect Local
    tr.appendChild(naCell('dfmea-col-sod'));  // S
  }
  appendCauseCells(tr,cause,fm,isLast);
  return tr;
}

// ── Row wiring ────────────────────────────────────────────────────────────────

/** Wire the Component/Function cell (edits propagate to all FMs in the group). */
function wireGroupCellEdit(el,g){
  el.addEventListener('dblclick',()=>{
    if(el.querySelector('textarea')) return;
    const field=el.dataset.field;
    const fmId =el.dataset.fmId;
    const fm   =_items.find(i=>i.id===fmId); if(!fm) return;
    const cur  =fm[field]||'';
    const h=Math.max(el.closest('td')?.offsetHeight-4||40,20);
    el.innerHTML=`<textarea class="dfmea-cell-input" style="height:${h}px">${esc(cur)}</textarea>`;
    const ta=el.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); el.innerHTML=cellText(v);
      if(v===(fm[field]||'')) return;
      // Update all FMs in this group
      for(const gfm of g.fms){
        gfm[field]=v;
        await autosave(gfm.id,{[field]:v});
      }
      if(field==='component_name'||field==='function_name') renderChain();
      refreshMapComp(fm.component_id||fm.component_name);
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape') el.innerHTML=cellText(cur);
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });
}

function wireFmCells(fmTr,fmTd,statusTd,fm,g){
  // Click → select
  fmTr.addEventListener('click',e=>{if(!e.target.closest('input,select,button')) selectRow(fm.id);});

  // FM text dblclick edit
  fmTd.addEventListener('dblclick',()=>{
    if(fmTd.querySelector('textarea')) return;
    const inner=getInner(fmTd);
    const cur=fm.failure_mode||'';
    const h=Math.max(fmTd.offsetHeight-4,20);
    inner.innerHTML=`<textarea class="dfmea-cell-input" style="height:${h}px">${esc(cur)}</textarea>`;
    const ta=inner.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); fm.failure_mode=v;
      inner.innerHTML=cellText(v);
      await autosave(fm.id,{failure_mode:v});
      refreshMapComp(fm.component_id||fm.component_name);
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape') inner.innerHTML=cellText(cur);
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });

  // Status
  statusTd.querySelector('.dfmea-sel')?.addEventListener('change',async e=>{
    fm.status=e.target.value; await autosave(fm.id,{status:e.target.value});
  });

  // Del FM
  fmTr.querySelector('[data-action="del-fm"]')?.addEventListener('click',()=>deleteFm(fm));
}

function wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm){
  wireTextCell(effHTd,eff,'effect_higher',()=>refreshMapComp(fm.component_id||fm.component_name));
  wireTextCell(effLTd,eff,'effect_local',()=>refreshMapComp(fm.component_id||fm.component_name));

  sTd.querySelector('.dfmea-sod-input')?.addEventListener('change',async e=>{
    const val=Math.min(10,Math.max(1,+e.target.value||5));
    e.target.value=val; eff.severity=val;
    await autosave(eff.id,{severity:val});
    refreshMaxSCell(fm);
    refreshCauseAPs(fm);
    refreshMapComp(fm.component_id||fm.component_name);
  });
}

function wireCauseCells(tr,cause,fm){
  tr.addEventListener('click',e=>{if(!e.target.closest('input,select,button')) selectRow(cause.id);});

  tr.querySelectorAll('.dfmea-editable').forEach(td=>{
    if(td.dataset.field) wireTextCell(td,cause,td.dataset.field,()=>refreshMapComp(fm.component_id||fm.component_name));
  });

  tr.querySelectorAll('.dfmea-sod-input').forEach(inp=>{
    inp.addEventListener('change',async e=>{
      const f=inp.dataset.field;
      const v=Math.min(10,Math.max(1,+e.target.value||5));
      e.target.value=v; cause[f]=v;
      await autosave(cause.id,{[f]:v});
      refreshCauseAP(tr,cause,fm);
      refreshMapComp(fm.component_id||fm.component_name);
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

// ── Refresh helpers ───────────────────────────────────────────────────────────

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

function selectRow(id){
  _selId=id;
  document.querySelectorAll('.dfmea-row').forEach(r=>r.classList.toggle('selected',r.dataset.id===id));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function addFmRow(prefill={}, rebuild=false){
  const idx =await nextIndex('dfmea_items',{parent_id:_ctx.parentId});
  const code=buildCode('DFM',{domain:_ctx.parentType==='item'?'ITEM':'SYS',projectName:_ctx.project.name,index:idx});
  const {data:fm,error}=await sb.from('dfmea_items').insert({
    dfmea_code:code, parent_type:_ctx.parentType, parent_id:_ctx.parentId,
    project_id:_ctx.project.id, row_type:'fm',
    sort_order:_items.filter(i=>rtype(i)==='fm').length,
    severity:5, occurrence:5, detection:5, action_status:'open', status:'draft', ...prefill,
  }).select().single();
  if(error){toast('Error creating FM.','error');return null;}
  _items.push(fm);
  renderTable(); // full rebuild for correct rowspans
  // Focus failure_mode cell of new FM
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${fm.id}"] .dfmea-col-fm`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
  renderChain();
  return fm;
}

async function addEffectRow(fm, afterEff=null){
  const existingEffs=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  const insertPos=afterEff!=null ? existingEffs.findIndex(e=>e.id===afterEff.id)+1 : existingEffs.length;
  // Shift sort_order of effects after insertion point (keep integers)
  const toShift=existingEffs.slice(insertPos);
  if(toShift.length){
    await Promise.all(toShift.map((e,i)=>sb.from('dfmea_items').update({sort_order:insertPos+1+i}).eq('id',e.id)));
    toShift.forEach((e,i)=>{e.sort_order=insertPos+1+i;});
  }
  const {data:eff,error}=await sb.from('dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-E${existingEffs.length+1}`,
    parent_type:_ctx.parentType, parent_id:_ctx.parentId, project_id:_ctx.project.id,
    row_type:'effect', parent_row_id:fm.id,
    sort_order:insertPos,
    severity:5, occurrence:5, detection:5, action_status:'open', status:'draft',
  }).select().single();
  if(error){toast('Error creating Effect.','error');return;}
  eff.sort_order=insertPos;
  if(afterEff!=null){
    let idx=_items.findIndex(i=>i.id===afterEff.id)+1;
    while(idx<_items.length){
      const it=_items[idx];
      if(rtype(it)==='fm'||(rtype(it)==='effect'&&it.parent_row_id===afterEff.parent_row_id)) break;
      idx++;
    }
    _items.splice(idx,0,eff);
  } else {
    _items.push(eff);
  }
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${eff.id}"] .dfmea-col-eff`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function addCauseRow(parentId,fm,afterCause=null){
  const existingCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===parentId);
  const insertPos=afterCause!=null ? existingCauses.findIndex(c=>c.id===afterCause.id)+1 : existingCauses.length;
  const toShift=existingCauses.slice(insertPos);
  if(toShift.length){
    await Promise.all(toShift.map((c,i)=>sb.from('dfmea_items').update({sort_order:insertPos+1+i}).eq('id',c.id)));
    toShift.forEach((c,i)=>{c.sort_order=insertPos+1+i;});
  }
  const {data:cause,error}=await sb.from('dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-C${_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id).length+1}`,
    parent_type:_ctx.parentType, parent_id:_ctx.parentId, project_id:_ctx.project.id,
    row_type:'cause', parent_row_id:parentId,
    sort_order:insertPos,
    severity:5, occurrence:5, detection:5, action_status:'open', status:'draft',
  }).select().single();
  if(error){toast('Error creating Cause.','error');return;}
  cause.sort_order=insertPos;
  if(afterCause!=null){
    const afterIdx=_items.findIndex(i=>i.id===afterCause.id);
    _items.splice(afterIdx>=0?afterIdx+1:_items.length,0,cause);
  } else {
    _items.push(cause);
  }
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${cause.id}"] .dfmea-col-fc`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function deleteGroup(g){
  const allIds=g.fms.flatMap(fm=>[fm.id,..._items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id).map(i=>i.id)]);
  showModal({
    title:'Delete Function Group',
    body:`<p>Delete function <strong>${esc(g.fms[0]?.function_name||'—')}</strong> and all its failure modes, effects and causes?</p>
      <div class="modal-warn-box" style="margin-top:10px">⚠ This will delete ${allIds.length} row(s). Cannot be undone.</div>`,
    footer:`<button class="btn btn-secondary" id="dg-cancel">Cancel</button>
            <button class="btn btn-danger" id="dg-confirm">Delete all</button>`,
  });
  document.getElementById('dg-cancel').onclick=()=>hideModal();
  document.getElementById('dg-confirm').onclick=async()=>{
    hideModal();
    await sb.from('dfmea_items').delete().in('id',allIds);
    allIds.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); renderChain();
    toast('Function group deleted.','success');
  };
}

async function deleteFm(fm){
  const kids=_items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id);
  const ids=[fm.id,...kids.map(i=>i.id)];
  showModal({
    title:'Delete Failure Mode',
    body:`<p>Delete FM <strong>${esc(fm.dfmea_code)}</strong>${kids.length?` and its ${kids.length} effect/cause row(s)`:''}?</p>`,
    footer:`<button class="btn btn-secondary" id="dfm-cancel">Cancel</button><button class="btn btn-danger" id="dfm-confirm">Delete</button>`,
  });
  document.getElementById('dfm-cancel').onclick=()=>hideModal();
  document.getElementById('dfm-confirm').onclick=async()=>{
    hideModal();
    await sb.from('dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); renderChain(); refreshMapComp(fm.component_id||fm.component_name);
    toast('FM deleted.','success');
  };
}

async function deleteEffect(eff,fm){
  const causes=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===eff.id);
  const ids=[eff.id,...causes.map(i=>i.id)];
  showModal({
    title:'Delete Effect',
    body:`<p>Delete this effect${causes.length?` and its ${causes.length} cause(s)`:''}?</p>`,
    footer:`<button class="btn btn-secondary" id="deff-cancel">Cancel</button><button class="btn btn-danger" id="deff-confirm">Delete</button>`,
  });
  document.getElementById('deff-cancel').onclick=()=>hideModal();
  document.getElementById('deff-confirm').onclick=async()=>{
    hideModal();
    await sb.from('dfmea_items').delete().in('id',ids);
    ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
    renderTable(); refreshMaxSCell(fm); refreshMapComp(fm.component_id||fm.component_name);
  };
}

async function deleteCause(cause,fm){
  showModal({
    title:'Delete Cause',
    body:`<p>Delete this failure cause?</p>`,
    footer:`<button class="btn btn-secondary" id="dca-cancel">Cancel</button><button class="btn btn-danger" id="dca-confirm">Delete</button>`,
  });
  document.getElementById('dca-cancel').onclick=()=>hideModal();
  document.getElementById('dca-confirm').onclick=async()=>{
    hideModal();
    await sb.from('dfmea_items').delete().eq('id',cause.id);
    _items=_items.filter(i=>i.id!==cause.id);
    renderTable();
    refreshMapComp(fm.component_id||fm.component_name);
  };
}

async function autosave(id,fields){
  const {error}=await sb.from('dfmea_items').update({...fields,updated_at:new Date().toISOString()}).eq('id',id);
  if(error) toast('Autosave failed.','error');
}

// ── Chain panel ───────────────────────────────────────────────────────────────

async function loadChainData(){
  const [{data:comps},{data:fns}]=await Promise.all([
    sb.from('arch_components').select('id,name,comp_type').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId).order('sort_order',{ascending:true}),
    sb.from('arch_functions').select('id,component_id,name,is_safety_related').order('sort_order',{ascending:true}),
  ]);
  const ids=new Set((comps||[]).map(c=>c.id));
  _chain.components=comps||[];
  _chain.functions=(fns||[]).filter(f=>ids.has(f.component_id));
  renderChain();
}

function renderChain(){ refreshNet(); }
function _renderChain_unused(){
  const body=document.getElementById('dfmea-chain-body'); if(!body) return;
  const comps=_chain.components, fns=_chain.functions;
  const selFns=_chain.selCompId?fns.filter(f=>f.component_id===_chain.selCompId):[];
  const fmItems=_items.filter(i=>rtype(i)==='fm');

  body.innerHTML=`<div class="dfmea-chain">
    <div class="dfmea-chain-col">
      <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⬡</span> Structure Element</div>
      <div class="dfmea-chain-cards">
        ${comps.length?comps.map(c=>`<div class="dfmea-chain-card ${_chain.selCompId===c.id?'active':''}" data-comp-id="${c.id}">
          <div class="dfmea-chain-card-type">${esc(c.comp_type||'')}</div>
          <div class="dfmea-chain-card-name">${esc(c.name)}</div>
          <div class="dfmea-chain-card-count">${fmItems.filter(i=>i.component_id===c.id||i.component_name===c.name).length||''} FM</div>
        </div>`).join(''):'<div class="dfmea-chain-empty">No components.</div>'}
      </div>
    </div>
    <div class="dfmea-chain-arrow">▶</div>
    <div class="dfmea-chain-col">
      <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚙</span> Function</div>
      <div class="dfmea-chain-cards">
        ${!_chain.selCompId?'<div class="dfmea-chain-empty">← Select a component</div>'
        :selFns.length?selFns.map(f=>`<div class="dfmea-chain-card ${_chain.selFuncId===f.id?'active':''}" data-func-id="${f.id}">
          <div class="dfmea-chain-card-name">${esc(f.name)}</div>
        </div>`).join(''):'<div class="dfmea-chain-empty">No functions.</div>'}
      </div>
    </div>
    <div class="dfmea-chain-arrow">▶</div>
    <div class="dfmea-chain-col">
      <div class="dfmea-chain-col-hdr"><span class="dfmea-chain-col-icon">⚠</span> Failure Mode</div>
      <div class="dfmea-chain-cards">
        ${!_chain.selCompId?'<div class="dfmea-chain-empty">← Select a component</div>'
        :fmItems.filter(i=>i.component_id===_chain.selCompId||i.component_name===comps.find(c=>c.id===_chain.selCompId)?.name)
            .map(fm=>`<div class="dfmea-chain-card fm-card" data-dfmea-id="${fm.id}">
              <div class="dfmea-chain-card-name">${esc(fm.failure_mode||'—')}</div>
              <div class="dfmea-chain-card-meta"><span>Max S: ${maxSevForFm(fm)||'—'}</span></div>
            </div>`).join('')||'<div class="dfmea-chain-empty">No FMs.</div>'}
      </div>
    </div>
  </div>`;

  body.querySelectorAll('[data-comp-id]').forEach(el=>el.addEventListener('click',()=>{_chain.selCompId=el.dataset.compId;_chain.selFuncId=null;renderChain();}));
  body.querySelectorAll('[data-func-id]').forEach(el=>el.addEventListener('click',()=>{_chain.selFuncId=el.dataset.funcId;renderChain();}));
  body.querySelectorAll('[data-dfmea-id]').forEach(el=>el.addEventListener('click',()=>{
    selectRow(el.dataset.dfmeaId);
    document.querySelector(`.dfmea-row[data-id="${el.dataset.dfmeaId}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }));
}

// ── Structure Map ─────────────────────────────────────────────────────────────

async function loadMapData(){
  const {data:comps}=await sb.from('arch_components')
    .select('id,name,comp_type,data,sort_order,x,y,width,height')
    .eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId)
    .order('sort_order',{ascending:true});
  const allComps=(comps||[]).filter(c=>c.comp_type!=='Port');
  const compIds=allComps.map(c=>c.id);
  const [{data:conns},{data:fns}]=await Promise.all([
    compIds.length?sb.from('arch_connections').select('id,source_id,target_id,interface_type,name').in('source_id',compIds):Promise.resolve({data:[]}),
    compIds.length?sb.from('arch_functions').select('id,component_id,name,is_safety_related').in('component_id',compIds).order('sort_order',{ascending:true}):Promise.resolve({data:[]}),
  ]);
  const groups=allComps.filter(c=>c.comp_type==='Group');
  allComps.filter(c=>c.comp_type!=='Group'&&!c.data?.group_id).forEach(c=>{
    const grp=groups.find(g=>g.x!=null&&
      c.x+(c.width||0)/2>g.x&&c.x+(c.width||0)/2<g.x+(g.width||0)&&
      c.y+(c.height||0)/2>g.y&&c.y+(c.height||0)/2<g.y+(g.height||0));
    if(grp) c.data={...(c.data||{}),group_id:grp.id};
  });
  _map.components=allComps; _map.connections=conns||[]; _map.functions=fns||[];
}

function buildMapCompHTML(c){
  const style=COMP_COLORS[c.comp_type]||COMP_COLORS.HW;
  const compFns=_map.functions.filter(f=>f.component_id===c.id);
  const fmRows=_items.filter(i=>rtype(i)==='fm'&&(i.component_id===c.id||i.component_name===c.name));
  const apH=fmRows.filter(fm=>{const s=maxSevForFm(fm);return _items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id).some(ca=>calcAP(s,ca.occurrence,ca.detection)==='H');}).length;
  const apM=fmRows.filter(fm=>{const s=maxSevForFm(fm);const causes=_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id);return !causes.some(ca=>calcAP(s,ca.occurrence,ca.detection)==='H')&&causes.some(ca=>calcAP(s,ca.occurrence,ca.detection)==='M');}).length;
  const byFn={};
  fmRows.forEach(fm=>{const k=fm.function_name||'';(byFn[k]||(byFn[k]=[])).push(fm);});
  const fnRows=compFns.map(f=>{
    const fms=byFn[f.name]||[];
    const fmHtml=fms.map(fm=>{
      const maxS=maxSevForFm(fm);
      const causes=_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id);
      const worstAP=causes.reduce((b,ca)=>{const ap=calcAP(maxS,ca.occurrence,ca.detection);const r={H:0,M:1,L:2,N:3,'-':4};return r[ap]<r[b]?ap:b;},'-');
      return `<div class="dmap-fm-row" data-dfmea-id="${fm.id}">
        <span class="dmap-fm-icon">⚡</span>
        <span class="dmap-fm-label" data-edit-field="failure_mode">${esc(fm.failure_mode||'—')}</span>
        <span class="dmap-sod"><span class="dmap-sod-val" title="Max S">S:${maxS||'—'}</span><span class="dmap-sod-val">${causes.length}c</span></span>
        ${worstAP!=='-'?`<span class="dfmea-ap-badge sm" style="background:${AP_COLORS[worstAP]}">${worstAP}</span>`:''}
      </div>`;
    }).join('');
    return `<div class="dmap-fn-entry${f.is_safety_related?' safety':''}">
      <div class="dmap-fn-hdr">
        <span class="dmap-fn-ico">${f.is_safety_related?'🔗':'⚙'}</span>
        <span class="dmap-fn-name">${esc(f.name)}</span>
        ${fms.length?`<span class="dmap-fn-count">${fms.length} FM</span>`:''}
      </div>${fmHtml}</div>`;
  }).join('');
  const orphans=(byFn['']||[]).map(fm=>`<div class="dmap-fm-row" data-dfmea-id="${fm.id}">
    <span class="dmap-fm-icon">⚡</span><span class="dmap-fm-label">${esc(fm.failure_mode||'—')}</span>
    <span class="dmap-sod"><span class="dmap-sod-val">S:${maxSevForFm(fm)||'—'}</span></span>
  </div>`).join('');
  const nid=`dmap-c-${c.id}`;
  return `<div class="dmap-comp-node" id="${nid}" data-comp-id="${c.id}">
    <div class="dmap-comp-hdr" style="border-left:4px solid ${style.border}">
      <span class="dmap-comp-type-badge" style="background:${style.badge};color:${style.badgeText}">${esc(c.comp_type)}</span>
      <span class="dmap-comp-name">${esc(c.name)}</span>
      <span class="dmap-risk-badges">
        ${apH?`<span class="dmap-risk-badge H">H:${apH}</span>`:''}
        ${apM?`<span class="dmap-risk-badge M">M:${apM}</span>`:''}
      </span>
      <button class="dmap-collapse-btn" data-target="${nid}-body">▼</button>
    </div>
    <div class="dmap-comp-body" id="${nid}-body">
      ${fnRows||orphans?(fnRows+(orphans?`<div class="dmap-fn-entry"><div class="dmap-fn-hdr"><span class="dmap-fn-ico">⚙</span><span class="dmap-fn-name" style="color:var(--color-text-muted)">unassigned</span></div>${orphans}</div>`:''))
      :'<div class="dmap-empty-hint" style="padding:6px 10px">No DFMEA data yet</div>'}
    </div>
  </div>`;
}

function wireMapCompNode(node,c){
  node.querySelectorAll('.dmap-collapse-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();const t=document.getElementById(btn.dataset.target);if(t)btn.textContent=t.classList.toggle('collapsed')?'▶':'▼';});
  });
  node.querySelectorAll('.dmap-fm-row').forEach(row=>{
    const id=row.dataset.dfmeaId; const fm=_items.find(i=>i.id===id); if(!fm) return;
    row.addEventListener('click',e=>{if(e.target.closest('.dmap-fm-label'))return;selectRow(id);document.querySelector(`.dfmea-row[data-id="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});});
    row.querySelector('.dmap-fm-label')?.addEventListener('dblclick',e=>{e.stopPropagation();openMapInlineText(e.target,fm,'failure_mode',c);});
  });
}

function openMapInlineText(el,it,field,comp){
  if(el.querySelector('input')) return;
  const cur=it[field]||''; const w=Math.max(el.offsetWidth,120);
  el.innerHTML=`<input class="dmap-inline-input" value="${esc(cur)}" style="width:${w}px">`;
  const inp=el.querySelector('input'); inp.focus(); inp.select();
  const commit=async()=>{
    const v=inp.value.trim(); it[field]=v; el.textContent=v||'—';
    await autosave(it.id,{[field]:v});
    const tr=document.querySelector(`tr[data-id="${it.id}"] .dfmea-col-fm`);
    if(tr) setInner(tr,cellText(v));
    refreshMapComp(comp.id);
  };
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape')el.textContent=cur||'—';});
}

function refreshMapComp(compIdOrName){ refreshNet(); }
function _refreshMapComp_unused(compIdOrName){
  const panel=document.getElementById('dfmea-map-panel');
  if(!panel||panel.style.display==='none') return;
  const map=document.getElementById('dfmea-map-body'); if(!map) return;
  if(!compIdOrName){renderMap();return;}
  const comp=_map.components.find(c=>c.id===compIdOrName||c.name===compIdOrName);
  if(!comp){renderMap();return;}
  const nid=`dmap-c-${comp.id}`;
  const existing=document.getElementById(nid); if(!existing) return;
  const collapsed=document.getElementById(`${nid}-body`)?.classList.contains('collapsed');
  const tmp=document.createElement('div'); tmp.innerHTML=buildMapCompHTML(comp);
  const newNode=tmp.firstElementChild;
  existing.replaceWith(newNode);
  if(collapsed){document.getElementById(`${nid}-body`)?.classList.add('collapsed');newNode.querySelector('.dmap-collapse-btn').textContent='▶';}
  wireMapCompNode(newNode,comp);
}

function renderMap(){
  const body=document.getElementById('dfmea-map-body'); if(!body) return;
  const allComps=_map.components;
  if(!allComps.length){body.innerHTML='<div class="dfmea-chain-empty" style="padding:32px">No components in Architecture Concept.</div>';return;}
  const groups=allComps.filter(c=>c.comp_type==='Group');
  const leafComps=allComps.filter(c=>c.comp_type!=='Group');
  const groupIds=new Set(groups.map(g=>g.id));
  const branch=(id,ch)=>`<div class="dmap-connector"><div class="dmap-conn-h"></div></div><div class="dmap-tree-branch"><div class="dmap-tree-branch-line"></div><div class="dmap-tree-branch-children" id="${id}">${ch}</div></div>`;
  const renderGroup=g=>{
    const ch=leafComps.filter(c=>c.data?.group_id===g.id);
    const bid=`dmap-g-${g.id}`;
    return `<div class="dmap-sys-row"><div class="dmap-sys-card"><span class="dmap-sys-icon">⬡</span><span class="dmap-sys-name">${esc(g.name)}</span><button class="dmap-collapse-btn" data-target="${bid}">▼</button></div>${branch(bid,ch.map(c=>buildMapCompHTML(c)).join('')||'<div class="dmap-empty-hint" style="padding:6px 10px">No components</div>')}</div>`;
  };
  const ungrouped=leafComps.filter(c=>!c.data?.group_id||!groupIds.has(c.data.group_id));
  const rootId='dmap-root-body';
  const compMap=Object.fromEntries(allComps.map(c=>[c.id,c]));
  const netChips=_netVisible?_map.connections.slice(0,15).map(cn=>{const s=compMap[cn.source_id],t=compMap[cn.target_id];if(!s||!t)return'';const clr=IFACE_COLORS[cn.interface_type]||'#9AA0A6';return`<span class="dmap-conn-chip" style="border-color:${clr}"><span style="color:${clr}">→</span>${esc(s.name)} → ${esc(t.name)}${cn.interface_type?`<span class="dmap-conn-type" style="color:${clr}">${esc(cn.interface_type)}</span>`:''}</span>`;}).filter(Boolean).join(''):'';
  body.innerHTML=`
    ${netChips?`<div class="dmap-net-legend">${netChips}</div>`:''}
    <div class="dmap-root-row">
      <div class="dmap-root-card"><span class="dmap-root-icon">◈</span><span class="dmap-root-name">${esc(_ctx.parentType==='item'?(_ctx.project?.name||'Item'):'System')}</span><button class="dmap-collapse-btn" data-target="${rootId}">▼</button></div>
      <div class="dmap-connector"><div class="dmap-conn-h"></div></div>
      <div class="dmap-tree-branch"><div class="dmap-tree-branch-line"></div>
        <div class="dmap-tree-branch-children" id="${rootId}">
          ${groups.map(renderGroup).join('')+ungrouped.map(c=>buildMapCompHTML(c)).join('')||'<div class="dmap-empty-hint" style="padding:8px 12px">No components yet</div>'}
        </div>
      </div>
    </div>`;
  body.querySelectorAll('.dmap-root-card .dmap-collapse-btn,.dmap-sys-card .dmap-collapse-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();const t=document.getElementById(btn.dataset.target);if(t)btn.textContent=t.classList.toggle('collapsed')?'▶':'▼';});
  });
  leafComps.forEach(c=>{const node=document.getElementById(`dmap-c-${c.id}`);if(node)wireMapCompNode(node,c);});
}

// ── Failure Net ───────────────────────────────────────────────────────────────

const FNET_W     = 190;
const FNET_H_EST = 100;
const FNET_GAP   = 12;
const FNET_BLK   = 32;
const FNET_PAD   = 48;
const FNET_X_EFF   = 30;
const FNET_X_FM    = 290;
const FNET_X_CAUSE = 550;

function refreshNet(){
  const panel=document.getElementById('dfmea-fnet-panel');
  if(!panel||panel.classList.contains('bp-collapsed')) return;
  renderFailureNet();
}

function renderFailureNet(){
  const body=document.getElementById('dfmea-fnet-body'); if(!body) return;
  body.innerHTML='';

  const fms=_focusFmId
    ?_items.filter(i=>rtype(i)==='fm'&&i.id===_focusFmId)
    :_items.filter(i=>rtype(i)==='fm');

  if(!fms.length){
    body.innerHTML='<div style="padding:40px;text-align:center;color:var(--color-text-muted)">No FMEA data. Add entries using ＋ New.</div>';
    return;
  }

  // Build node + edge lists
  const nodes=[], edges=[], nodeMap={};
  let y=FNET_PAD;

  for(const fm of fms){
    const effects =_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
    const causes  =_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id);
    const rows    =Math.max(effects.length||1, causes.length||1);
    const blockH  =rows*(FNET_H_EST+FNET_GAP)-FNET_GAP;
    const fmY     =y+blockH/2-FNET_H_EST/2;

    const fmNode={id:fm.id,type:'fm',x:FNET_X_FM,y:fmY,data:fm,focus:fm.id===_focusFmId};
    nodes.push(fmNode); nodeMap[fm.id]=fmNode;

    effects.forEach((eff,i)=>{
      const n={id:eff.id,type:'effect',x:FNET_X_EFF,y:y+i*(FNET_H_EST+FNET_GAP),data:eff};
      nodes.push(n); nodeMap[eff.id]=n;
      edges.push({from:fm.id,to:eff.id,cls:'fnet-edge-eff'});
    });

    causes.forEach((c,i)=>{
      const n={id:c.id,type:'cause',x:FNET_X_CAUSE,y:y+i*(FNET_H_EST+FNET_GAP),data:c};
      nodes.push(n); nodeMap[c.id]=n;
      edges.push({from:c.id,to:fm.id,cls:'fnet-edge-cause'});
    });

    y+=blockH+FNET_BLK;
  }

  const canvasW=FNET_X_EFF+FNET_W+FNET_PAD;
  const canvasH=y+FNET_PAD;

  // Wrap + canvas
  const wrap=document.createElement('div');
  wrap.className='fnet-wrap';
  body.appendChild(wrap);

  const canvas=document.createElement('div');
  canvas.className='fnet-canvas';
  canvas.style.width=canvasW+'px';
  canvas.style.height=canvasH+'px';

  // SVG defs + overlay
  const NS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('width',canvasW); svg.setAttribute('height',canvasH);
  svg.setAttribute('class','fnet-svg');
  const defs=document.createElementNS(NS,'defs');
  [['arr-cause','#E37400'],['arr-eff','#1E8E3E']].forEach(([id,col])=>{
    const m=document.createElementNS(NS,'marker');
    m.setAttribute('id',id); m.setAttribute('markerWidth','8'); m.setAttribute('markerHeight','6');
    m.setAttribute('refX','7'); m.setAttribute('refY','3'); m.setAttribute('orient','auto');
    const p=document.createElementNS(NS,'polygon');
    p.setAttribute('points','0 0,8 3,0 6'); p.setAttribute('fill',col); m.appendChild(p);
    defs.appendChild(m);
  });
  svg.appendChild(defs);
  canvas.appendChild(svg);

  // Render nodes
  nodes.forEach(n=>{
    const el=buildFnetNode(n,body,nodeMap);
    canvas.appendChild(el); n._el=el;
  });

  wrap.appendChild(canvas);

  // Draw edges after layout (need actual heights)
  requestAnimationFrame(()=>{
    nodes.forEach(n=>{if(n._el) n.h=n._el.offsetHeight||FNET_H_EST;});
    edges.forEach(({from,to,cls})=>{
      const f=nodeMap[from], t=nodeMap[to]; if(!f||!t) return;
      const y1=f.y+(f.h||FNET_H_EST)/2, y2=t.y+(t.h||FNET_H_EST)/2;
      // Connect right-edge of leftmost node to left-edge of rightmost node
      const x1=f.x<t.x ? f.x+FNET_W : f.x;
      const x2=f.x<t.x ? t.x        : t.x+FNET_W;
      const cx=(x1+x2)/2;
      const path=document.createElementNS(NS,'path');
      path.setAttribute('d',`M${x1} ${y1} C${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`);
      path.setAttribute('class',`fnet-edge ${cls}`);
      path.setAttribute('marker-end',`url(#${cls==='fnet-edge-cause'?'arr-cause':'arr-eff'})`);
      svg.appendChild(path);
    });
  });

  // Pan + zoom
  let scale=1,tx=0,ty=0,drag=false,sx=0,sy=0,stx=0,sty=0;
  const apply=()=>{canvas.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;};
  const fitView=()=>{
    const r=wrap.getBoundingClientRect();
    if(!r.width||!r.height) return;
    scale=Math.min(r.width/canvasW, r.height/canvasH)*0.88;
    tx=(r.width -canvasW*scale)/2;
    ty=(r.height-canvasH*scale)/2;
    apply();
  };
  wrap.addEventListener('mousedown',e=>{
    if(e.target.closest('.fnet-node,.fnet-controls')) return;
    drag=true; sx=e.clientX; sy=e.clientY; stx=tx; sty=ty; wrap.style.cursor='grabbing';
    e.preventDefault();
  });
  const onMove=e=>{if(!drag)return; tx=stx+(e.clientX-sx); ty=sty+(e.clientY-sy); apply();};
  const onUp  =()=>{drag=false; wrap.style.cursor='grab';};
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
  wrap.addEventListener('wheel',e=>{
    e.preventDefault();
    const d=e.deltaY<0?1.12:0.9;
    const r=wrap.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    tx=(tx-mx)*d+mx; ty=(ty-my)*d+my;
    scale=Math.max(0.2,Math.min(4,scale*d)); apply();
  },{passive:false});

  // Floating controls
  const ctrls=document.createElement('div');
  ctrls.className='fnet-controls';
  ctrls.innerHTML=`
    <button class="fnet-ctrl-btn" title="Fit view">⊡</button>
    <button class="fnet-ctrl-btn" title="Zoom in">＋</button>
    <button class="fnet-ctrl-btn" title="Zoom out">－</button>`;
  const [btnFit,btnIn,btnOut]=ctrls.querySelectorAll('.fnet-ctrl-btn');
  btnFit.addEventListener('click',e=>{e.stopPropagation();fitView();});
  btnIn .addEventListener('click',e=>{e.stopPropagation();scale=Math.min(4,scale*1.25);apply();});
  btnOut.addEventListener('click',e=>{e.stopPropagation();scale=Math.max(0.2,scale/1.25);apply();});
  wrap.appendChild(ctrls);

  // Auto fit on first render
  requestAnimationFrame(()=>requestAnimationFrame(fitView));

  // Cleanup listeners when panel collapses
  const observer=new MutationObserver(()=>{
    if(!document.contains(wrap)){window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);observer.disconnect();}
  });
  observer.observe(document.body,{childList:true,subtree:true});
}

function buildFnetNode(n,body,nodeMap){
  const d=n.data;
  const div=document.createElement('div');
  div.className=`fnet-node fnet-node-${n.type}${n.focus?' fnet-node-focus':''}`;
  div.style.cssText=`left:${n.x}px;top:${n.y}px`;
  div.dataset.id=n.id;

  let title='', sub='', metrics='';
  if(n.type==='fm'){
    title=d.failure_mode||'—';
    sub=d.function_name?`<div class="fnet-sub">${esc(d.function_name)}</div>`:'';
    const maxS=maxSevForFm(d);
    const causes=_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===d.id);
    const worstAP=causes.reduce((b,c)=>{const ap=calcAP(maxS,c.occurrence,c.detection);const r={H:0,M:1,L:2,N:3,'-':4};return r[ap]<r[b]?ap:b;},'-');
    const apClr=AP_COLORS[worstAP]||'#9AA0A6';
    metrics=`<div class="fnet-metrics">
      <span class="fnet-metric">Max S: ${maxS||'—'}</span>
      ${worstAP!=='-'?`<span class="fnet-ap" style="background:${apClr}">${worstAP}</span>`:''}
      <span class="fnet-status">${d.status||''}</span>
    </div>`;
  } else if(n.type==='effect'){
    title=d.effect_higher||'—';
    sub=d.effect_local?`<div class="fnet-sub">${esc(d.effect_local)}</div>`:'';
    metrics=`<div class="fnet-metrics"><span class="fnet-metric">S: ${d.severity||'—'}</span></div>`;
  } else {
    title=d.failure_cause||'—';
    const fm=fmOf(d);
    const maxS=fm?maxSevForFm(fm):0;
    const ap=calcAP(maxS,d.occurrence,d.detection);
    const apClr=AP_COLORS[ap]||'#9AA0A6';
    metrics=`<div class="fnet-metrics">
      <span class="fnet-metric">O: ${d.occurrence||'—'}</span>
      <span class="fnet-metric">D: ${d.detection||'—'}</span>
      <span class="fnet-ap" style="background:${apClr}">${ap}</span>
    </div>
    ${d.prevention_controls?`<div class="fnet-ctrl-row"><span class="fnet-ctrl-label">Prev:</span> ${esc(d.prevention_controls)}</div>`:''}
    ${d.detection_controls?`<div class="fnet-ctrl-row"><span class="fnet-ctrl-label">Det:</span> ${esc(d.detection_controls)}</div>`:''}
    `;
  }

  const typeLabel={fm:'Failure Mode',effect:'Effect',cause:'Cause'}[n.type];
  div.innerHTML=`
    <div class="fnet-code">${esc(d.dfmea_code||'')}&ensp;<span class="fnet-type-tag">${typeLabel}</span></div>
    ${sub}
    <div class="fnet-title">${esc(title)}</div>
    ${metrics}`;

  div.addEventListener('click',()=>{
    if(n.type==='fm'){
      _focusFmId=_focusFmId===n.id?null:n.id;
      const lbl=document.getElementById('fnet-focus-label');
      if(lbl) lbl.textContent=_focusFmId?`Focus: ${esc(d.dfmea_code)} — ${esc(d.failure_mode||'')}` :'All FMs · click FM node to focus · drag to pan · scroll to zoom';
      renderFailureNet();
    }
    selectRow(n.id);
    document.querySelector(`.dfmea-row[data-id="${n.id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  return div;
}

// ── Hover insert pill ─────────────────────────────────────────────────────────

const _EFF_COLS  = ['dfmea-col-eff'];
const _CAUSE_COLS= ['dfmea-col-fc','dfmea-col-ctrl','dfmea-col-ap',
                    'dfmea-col-actions','dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'];

function colAction(td, ctx){
  const c=td.className;
  if(_EFF_COLS.some(x=>c.includes(x)))   return 'add-effect';
  if(_CAUSE_COLS.some(x=>c.includes(x))) return 'add-cause';
  if(c.includes('dfmea-col-sod'))         return ctx?.type==='cause'?'add-cause':'add-effect';
  return null;
}

function wireInsertHover(tbody){
  _activeTbody=tbody;
  if(!_pill){
    _pill=document.createElement('div');
    _pill.className='spec-insert-pill';
    // pointer-events:none on container so the pill never intercepts clicks on cells beneath it
    _pill.style.cssText='display:none;pointer-events:none';
    document.body.appendChild(_pill);
  }
  let _hovTd=null;
  tbody.addEventListener('mousemove',e=>{
    const td=e.target.closest('td');
    if(!td||!tbody.contains(td)){hidePill();_hovTd=null;return;}
    if(td===_hovTd) return;
    _hovTd=td;
    showPillForCell(td, _rowCtx.get(td.closest('tr')));
  });
  tbody.addEventListener('mouseleave',e=>{
    const rt=e.relatedTarget;
    // Keep visible if leaving to the pill button (which has pointer-events:auto)
    if(rt&&_pill&&_pill.contains(rt)) return;
    hidePill(); _hovTd=null;
  });
  tbody.addEventListener('mousedown',()=>{hidePill();_hovTd=null;});
}

function showPillForCell(td, ctx){
  const action=colAction(td,ctx);
  if(!action||!ctx){hidePill();return;}
  const rect=td.getBoundingClientRect();
  _pill.style.top=(rect.bottom-9)+'px';
  _pill.style.transform='none';

  _pill.style.left=rect.left+'px';
  _pill.style.width=rect.width+'px';
  const label=action==='add-effect'?'＋ Effect':'＋ Cause';
  const cls  =action==='add-effect'?'spec-insert-section':'spec-insert-item';
  _pill.innerHTML=`<div class="spec-insert-line" style="pointer-events:none"></div><button class="spec-insert-plus ${cls}" data-action="${action}" style="pointer-events:auto">${label}</button><div class="spec-insert-line" style="pointer-events:none"></div>`;
  _pill.style.display='flex';
  const btn=_pill.querySelector(`[data-action="${action}"]`);
  btn.addEventListener('click',()=>{
    hidePill();
    if(action==='add-effect'){
      addEffectRow(ctx.fm, ctx.type==='effect'?ctx.eff:null);
    } else {
      const parentId=ctx.type==='effect'?ctx.eff.id
                    :ctx.type==='cause' ?ctx.cause.parent_row_id
                    :ctx.fm.id;
      addCauseRow(parentId, ctx.fm, ctx.type==='cause'?ctx.cause:null);
    }
  });
  btn.addEventListener('mouseleave',e=>{
    if(!(e.relatedTarget&&_activeTbody&&_activeTbody.contains(e.relatedTarget))) hidePill();
  });
}

function hidePill(){
  if(_pill) _pill.style.display='none';
}

// ── Sync from System ──────────────────────────────────────────────────────────

async function syncFromSystem(){
  const btn=document.getElementById('btn-dfmea-sync');
  if(btn){btn.disabled=true;btn.textContent='⟳ Syncing…';}
  try{
    const {data:hazards}=await sb.from('hazards').select('id,data,function_id,status').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId).eq('analysis_type','FHA');
    if(!hazards?.length){toast('No FHA hazards found to sync from.','warning');return;}
    const compIds=[...(new Set(hazards.map(h=>h.data?.component_id).filter(Boolean)))];
    const comps=compIds.length?(await sb.from('arch_components').select('id,name').in('id',compIds)).data||[]:[];
    const archFns=comps.length?(await sb.from('arch_functions').select('id,component_id,name,function_ref_id').in('component_id',compIds)).data||[]:[];
    let fnRefs={};
    if(hazards?.some(h=>h.function_id)){
      const fnIds=[...new Set(hazards.filter(h=>h.function_id).map(h=>h.function_id))];
      const {data:fns}=await sb.from('functions').select('id,name').in('id',fnIds);
      (fns||[]).forEach(f=>{fnRefs[f.id]=f;});
    }
    const importedHazIds=new Set(_items.filter(i=>i.hazard_id).map(i=>i.hazard_id));
    let created=0;
    for(const haz of(hazards||[])){
      if(importedHazIds.has(haz.id)) continue;
      const d=haz.data||{};
      let mComp=null,mFn=null;
      if(haz.function_id){const fnRef=fnRefs[haz.function_id];if(fnRef){mFn=(archFns||[]).find(af=>af.function_ref_id===haz.function_id||af.name===fnRef.name);if(mFn)mComp=comps.find(c=>c.id===mFn.component_id);}}
      const fm=await addFmRow({component_id:mComp?.id||null,component_name:mComp?.name||'',function_name:mFn?.name||(fnRefs[haz.function_id]?.name||''),failure_mode:d.failure_condition||'',hazard_id:haz.id});
      if(!fm) continue;
      const efH=d.effect_system||d.effect_item||d.effect||'';
      const efL=d.effect_local||'';
      if(efH||efL) await addEffectRow(fm).then(async()=>{const e=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id).at(-1);if(e){e.effect_higher=efH;e.effect_local=efL;await autosave(e.id,{effect_higher:efH,effect_local:efL});}});
      created++;
    }
    toast(created>0?`Synced ${created} new FM(s) from FHA.`:'Already up to date.','success');
  }catch(e){toast('Sync error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='⟳ Sync from FHA';}}
}

// ── Sync from Architecture (item-level: Focus = System/Group) ─────────────────

async function syncFromArchitecture(){
  const btn=document.getElementById('btn-dfmea-sync');
  if(btn){btn.disabled=true;btn.textContent='⟳ Syncing…';}
  try{
    // Pull Systems (Groups that are NOT assembly) for this item
    const {data:allComps}=await sb.from('arch_components')
      .select('id,name,comp_type,data')
      .eq('project_id',_ctx.project.id)
      .eq('comp_type','Group');
    const systems=(allComps||[]).filter(c=>c.data?.subtype!=='assembly');
    if(!systems.length){toast('No systems found in Architecture Concept.','warning');return;}

    // Pull arch_functions for those systems
    const sysIds=systems.map(s=>s.id);
    const {data:fns}=await sb.from('arch_functions')
      .select('id,component_id,name')
      .in('component_id',sysIds)
      .order('sort_order',{ascending:true});

    const existingKeys=new Set(
      _items.filter(i=>rtype(i)==='fm'&&i.component_id)
        .map(i=>`${i.component_id}__${i.function_name}`)
    );

    let created=0;
    for(const sys of systems){
      const sysFns=(fns||[]).filter(f=>f.component_id===sys.id);
      if(!sysFns.length){
        // System has no functions — create one blank row for the system
        const key=`${sys.id}__`;
        if(existingKeys.has(key)) continue;
        await addFmRow({component_id:sys.id,component_name:sys.name,function_name:''});
        existingKeys.add(key); created++;
      } else {
        for(const fn of sysFns){
          const key=`${sys.id}__${fn.name}`;
          if(existingKeys.has(key)) continue;
          await addFmRow({component_id:sys.id,component_name:sys.name,function_name:fn.name});
          existingKeys.add(key); created++;
        }
      }
    }
    toast(created>0?`Synced ${created} new row(s) from Architecture.`:'Already up to date.','success');
  }catch(e){toast('Sync error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='⟳ Sync from Architecture';}}
}
