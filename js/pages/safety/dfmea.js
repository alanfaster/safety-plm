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
import { toast } from '../../toast.js';

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

let _ctx   = null;
let _items = [];
let _selId = null;
let _chain = {components:[],functions:[],selCompId:null,selFuncId:null};
let _map   = {components:[],connections:[],functions:[]};
let _netVisible = true;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function cellText(v){
  if(!v)return`<span class="dfmea-placeholder">—</span>`;
  return`<span class="dfmea-cell-text">${esc(v)}</span>`;
}
function rtype(it){return it.row_type||'fm';}

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

/** Total <tr> count for one FM (its own row + effect rows + cause rows). */
function fmRowCount(fm){
  const effects=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id);
  const directCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id);
  const effCauses=effects.reduce((n,e)=>n+_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===e.id).length,0);
  // 1 FM row + N effect rows + N directCause rows + N effectCause rows
  // (but effect rows are merged into one <tr> with their first cause, see renderFmBlock)
  // Actual count: 1 + effects.length + directCauses.length + effCauses
  return 1 + effects.length + directCauses.length + effCauses;
}

/** Total <tr> count for one group. */
function groupRowCount(g){return g.fms.reduce((n,fm)=>n+fmRowCount(fm),0);}

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function renderDFMEA(container, {project,item,system,parentType,parentId}){
  _ctx={project,parentType,parentId};
  _items=[]; _selId=null; _netVisible=true;
  _chain={components:[],functions:[],selCompId:null,selFuncId:null};
  _map={components:[],connections:[],functions:[]};

  const parentName=system?.name||item?.name||'';

  container.innerHTML=`
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <h1>DFMEA</h1>
          <p class="page-subtitle">Design FMEA · VDA 2019 · ${esc(parentName)}</p>
        </div>
        <div class="dfmea-toolbar">
          <button class="dfmea-tb-btn" id="btn-dfmea-map"   title="Toggle Structure Map">◈ Structure</button>
          <button class="dfmea-tb-btn" id="btn-dfmea-chain" title="Toggle chain">⬡ Chain</button>
          <div class="arch-sep"></div>
          <button class="btn btn-secondary btn-sm" id="btn-dfmea-sync">⟳ Sync from System</button>
          <button class="btn btn-primary   btn-sm" id="btn-dfmea-new" title="Add new Component / Function group">＋ New</button>
        </div>
      </div>
    </div>
    <div class="dfmea-layout" id="dfmea-layout">
      <div class="dfmea-table-area" id="dfmea-table-area">
        <div class="content-loading"><div class="spinner"></div></div>
      </div>
      <div class="dfmea-bottom-panel" id="dfmea-map-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-map-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">◈ Structure Map</span>
          <span class="dfmea-panel-hint">Live — dblclick to edit</span>
          <button class="dfmea-tb-btn" id="btn-dfmea-net">⇄ Net</button>
          <button class="dfmea-tb-btn" id="dfmea-map-close">✕</button>
        </div>
        <div class="dfmea-map-body" id="dfmea-map-body"></div>
      </div>
      <div class="dfmea-bottom-panel" id="dfmea-chain-panel" style="display:none">
        <div class="dfmea-panel-resize-bar" id="dfmea-chain-resize"></div>
        <div class="dfmea-panel-hdr">
          <span class="dfmea-panel-title">⬡ Structure — Function — Failure Chain</span>
          <button class="dfmea-tb-btn" id="dfmea-chain-close">✕</button>
        </div>
        <div class="dfmea-chain-body" id="dfmea-chain-body"></div>
      </div>
    </div>`;

  wirePanelToggles();
  document.getElementById('btn-dfmea-new').onclick  = ()=>addFmRow();
  document.getElementById('btn-dfmea-sync').onclick = ()=>syncFromSystem();

  await Promise.all([loadItems(), loadChainData(), loadMapData()]);
}

// ── Panels ────────────────────────────────────────────────────────────────────

function wirePanelToggles(){
  const mapBtn=document.getElementById('btn-dfmea-map');
  mapBtn?.addEventListener('click',()=>{
    const p=document.getElementById('dfmea-map-panel');
    const wasHidden=p.style.display==='none';
    togglePanel('dfmea-map-panel','btn-dfmea-map');
    if(wasHidden){renderMap();}else{renderMap();p.style.display='';mapBtn.classList.add('active');}
  });
  document.getElementById('dfmea-map-close')?.addEventListener('click',()=>closePanel('dfmea-map-panel','btn-dfmea-map'));
  document.getElementById('btn-dfmea-net')?.addEventListener('click',()=>{
    _netVisible=!_netVisible;
    document.getElementById('btn-dfmea-net')?.classList.toggle('active',_netVisible);
    document.querySelectorAll('.dmap-net-legend').forEach(s=>{s.style.display=_netVisible?'':'none';});
  });
  wireResizeBar('dfmea-map-resize','dfmea-map-panel');
  document.getElementById('btn-dfmea-chain')?.addEventListener('click',()=>togglePanel('dfmea-chain-panel','btn-dfmea-chain'));
  document.getElementById('dfmea-chain-close')?.addEventListener('click',()=>closePanel('dfmea-chain-panel','btn-dfmea-chain'));
  wireResizeBar('dfmea-chain-resize','dfmea-chain-panel');
}
function togglePanel(pid,bid){const p=document.getElementById(pid);if(!p)return;const op=p.style.display==='none';p.style.display=op?'':'none';document.getElementById(bid)?.classList.toggle('active',op);}
function closePanel(pid,bid){const p=document.getElementById(pid);if(p)p.style.display='none';document.getElementById(bid)?.classList.remove('active');}
function wireResizeBar(bid,pid){
  const b=document.getElementById(bid),p=document.getElementById(pid);if(!b||!p)return;
  b.addEventListener('mousedown',e=>{e.preventDefault();const sy=e.clientY,sh=p.offsetHeight;
    const mv=m=>{p.style.height=`${Math.max(120,sh-(m.clientY-sy))}px`;};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);});
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
  renderTable(area);
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
      <p>Click <strong>＋ New</strong> to start a new Component / Function group, or use <strong>⟳ Sync from System</strong>.</p>
    </div>`;
    return;
  }

  area.innerHTML=`
    <div class="dfmea-table-wrap">
      <table class="dfmea-table">
        <thead><tr>
          <th class="dfmea-col-compfunc">Component / Function</th>
          <th class="dfmea-col-fm">Failure Mode</th>
          <th class="dfmea-col-maxs" title="Max Severity">Max S</th>
          <th class="dfmea-col-status">Status</th>
          <th class="dfmea-col-del"></th>
          <th class="dfmea-col-eff">Effect — Higher Level</th>
          <th class="dfmea-col-eff">Effect — Local</th>
          <th class="dfmea-col-sod" title="Severity">S</th>
          <th class="dfmea-col-fc">Failure Cause</th>
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

    // Component / Function cell (rowspan = entire group, only on first FM)
    if(isFirstFm){
      const cfTd=document.createElement('td');
      cfTd.rowSpan=totalSpan;
      cfTd.className='dfmea-col-compfunc dfmea-group-cell';
      cfTd.innerHTML=`
        <div class="dfmea-cf-comp dfmea-editable" data-field="component_name" data-fm-id="${fm.id}" title="dblclick to edit">${cellText(fm.component_name)}</div>
        <div class="dfmea-cf-sep">/</div>
        <div class="dfmea-cf-func dfmea-editable" data-field="function_name" data-fm-id="${fm.id}" title="dblclick to edit">${cellText(fm.function_name)}</div>`;
      fmTr.appendChild(cfTd);
      // Wire group-cell editing (edits ALL fms in group for comp/func)
      cfTd.querySelectorAll('.dfmea-editable').forEach(el=>wireGroupCellEdit(el,g));
    }

    // Failure Mode cell (rowspan = this FM's rows)
    const fmTd=makeTd('dfmea-col-fm dfmea-editable',fmSpan);
    fmTd.dataset.field='failure_mode';
    fmTd.innerHTML=`${cellText(fm.failure_mode)}<button class="dfmea-inline-add" data-action="add-fm" title="Add Failure Mode to this Component / Function">＋</button>`;
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
    const delTd=makeTd('dfmea-col-del',fmSpan);
    delTd.innerHTML=`<button class="dfmea-del-row-btn" data-action="del-fm" title="Delete FM">✕</button>`;
    fmTr.appendChild(delTd);

    // If no effects and no causes, show actionable placeholders so user can start filling in
    if(!effects.length&&!directCauses.length){
      const addEffTd=makeTd('dfmea-col-eff dfmea-cell-na-add');
      addEffTd.innerHTML=`<button class="dfmea-inline-add dfmea-add-first-cause" data-action="add-effect" title="Add Effect">＋ Add Effect</button>`;
      fmTr.appendChild(addEffTd);
      fmTr.appendChild(naCell('dfmea-col-eff'));
      fmTr.appendChild(naCell('dfmea-col-sod'));
      const addCauseTd=makeTd('dfmea-col-fc dfmea-cell-na-add');
      addCauseTd.innerHTML=`<button class="dfmea-inline-add dfmea-add-first-cause" data-action="add-cause" title="Add Cause">＋ Add Cause</button>`;
      fmTr.appendChild(addCauseTd);
      fmTr.appendChild(naCell('dfmea-col-ctrl'));
      fmTr.appendChild(naCell('dfmea-col-sod'));
      fmTr.appendChild(naCell('dfmea-col-ctrl'));
      fmTr.appendChild(naCell('dfmea-col-sod'));
      fmTr.appendChild(naCell('dfmea-col-ap'));
      fmTr.appendChild(naCell('dfmea-col-actions'));
      fmTr.appendChild(naCell('dfmea-col-resp'));
      fmTr.appendChild(naCell('dfmea-col-date'));
      fmTr.appendChild(naCell('dfmea-col-astatus'));
      // Wire add buttons
      addEffTd.querySelector('[data-action="add-effect"]').addEventListener('click',()=>addEffectRow(fm));
      addCauseTd.querySelector('[data-action="add-cause"]').addEventListener('click',()=>addCauseRow(fm.id,fm));
    }

    tbody.appendChild(fmTr);
    wireFmCells(fmTr,fmTd,statusTd,fm,g);

    // ── Effect rows ────────────────────────────────────────────────────────
    effects.forEach((eff,ei)=>{
      const effCauses=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===eff.id);
      const effSpan  =1+effCauses.length;
      const isLastEff=(ei===effects.length-1);

      const effTr=document.createElement('tr');
      effTr.className='dfmea-row dfmea-row-effect';
      effTr.dataset.id=eff.id; effTr.dataset.type='effect';

      // Effect Higher (rowspan = 1 + causes under this effect)
      const effHTd=makeTd('dfmea-col-eff dfmea-editable',effSpan);
      effHTd.dataset.field='effect_higher';
      effHTd.innerHTML=`${cellText(eff.effect_higher)}${isLastEff?`<button class="dfmea-inline-add" data-action="add-effect" title="Add Effect">＋</button>`:''}`;
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
      if(effCauses.length){
        appendCauseCells(effTr,effCauses[0],fm,effCauses.length===1);
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
        wireCauseCells(effTr,effCauses[0],fm);
        // Remaining causes
        effCauses.slice(1).forEach((c,ci)=>{
          const cTr=causeTrShell(c,fm,ci===effCauses.length-2);
          tbody.appendChild(cTr);
          wireCauseCells(cTr,c,fm);
        });
      } else {
        // NA cause columns + "＋ Cause" hint
        appendNaCauseCells(effTr,eff.id,fm);
        tbody.appendChild(effTr);
        wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm);
      }
    });

    // ── Direct causes (parent = FM) ────────────────────────────────────────
    directCauses.forEach((c,ci)=>{
      const cTr=causeTrShell(c,fm,ci===directCauses.length-1);
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
  fcTd.innerHTML=`${cellText(cause.failure_cause)}${isLast?`<button class="dfmea-inline-add" data-action="add-cause" title="Add Cause">＋</button>`:''}`;
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
  const placeholder=makeTd('dfmea-col-fc dfmea-cell-na-add');
  placeholder.innerHTML=`<button class="dfmea-inline-add dfmea-add-first-cause" data-action="add-cause" title="Add Cause">＋ Add Cause</button>`;
  tr.appendChild(placeholder);
  ['dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ctrl','dfmea-col-sod','dfmea-col-ap','dfmea-col-actions','dfmea-col-resp','dfmea-col-date','dfmea-col-astatus'].forEach(c=>tr.appendChild(naCell(c)));
}

function causeTrShell(cause,fm,isLast){
  const tr=document.createElement('tr');
  tr.className='dfmea-row dfmea-row-cause';
  tr.dataset.id=cause.id; tr.dataset.type='cause'; tr.dataset.fmId=fm.id;
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
    el.innerHTML=`<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea>`;
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
    const cur=fm.failure_mode||'';
    fmTd.innerHTML=`<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea><button class="dfmea-inline-add" data-action="add-fm" title="Add FM" style="display:none">＋</button>`;
    const ta=fmTd.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); fm.failure_mode=v;
      fmTd.innerHTML=`${cellText(v)}<button class="dfmea-inline-add" data-action="add-fm" title="Add Failure Mode to this Component / Function">＋</button>`;
      await autosave(fm.id,{failure_mode:v});
      refreshMapComp(fm.component_id||fm.component_name);
      // Re-wire the new button
      fmTd.querySelector('[data-action="add-fm"]')?.addEventListener('click',()=>addFmRow({component_id:fm.component_id,component_name:fm.component_name,function_name:fm.function_name},true));
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape'){fm.failure_mode=cur;fmTd.innerHTML=`${cellText(cur)}<button class="dfmea-inline-add" data-action="add-fm">＋</button>`;wireFmCells(fmTr,fmTd,statusTd,fm,g);}
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}
    });
  });

  // + Add FM
  fmTd.querySelector('[data-action="add-fm"]')?.addEventListener('click',()=>
    addFmRow({component_id:fm.component_id,component_name:fm.component_name,function_name:fm.function_name},true));

  // Status
  statusTd.querySelector('.dfmea-sel')?.addEventListener('change',async e=>{
    fm.status=e.target.value; await autosave(fm.id,{status:e.target.value});
  });

  // Del FM
  fmTr.querySelector('[data-action="del-fm"]')?.addEventListener('click',()=>deleteFm(fm));
}

function wireEffCells(effTr,effHTd,effLTd,sTd,eff,fm){
  // Effect Higher dblclick
  wireTextCell(effHTd,eff,'effect_higher',()=>{
    refreshMapComp(fm.component_id||fm.component_name);
    // Re-wire the + button after replacing content
    effHTd.querySelector('[data-action="add-effect"]')?.addEventListener('click',()=>addEffectRow(fm));
  });
  // + Add Effect
  effHTd.querySelector('[data-action="add-effect"]')?.addEventListener('click',()=>addEffectRow(fm));

  // Effect Local dblclick
  wireTextCell(effLTd,eff,'effect_local',()=>refreshMapComp(fm.component_id||fm.component_name));

  // S input
  sTd.querySelector('.dfmea-sod-input')?.addEventListener('change',async e=>{
    const val=Math.min(10,Math.max(1,+e.target.value||5));
    e.target.value=val; eff.severity=val;
    await autosave(eff.id,{severity:val});
    refreshMaxSCell(fm);
    refreshCauseAPs(fm);
    refreshMapComp(fm.component_id||fm.component_name);
  });

  // + Add Cause from NA placeholder
  effTr.querySelector('[data-action="add-cause"]')?.addEventListener('click',()=>addCauseRow(eff.id,fm));
}

function wireCauseCells(tr,cause,fm){
  tr.addEventListener('click',e=>{if(!e.target.closest('input,select,button')) selectRow(cause.id);});

  tr.querySelectorAll('.dfmea-editable').forEach(td=>{
    if(td.dataset.field) wireTextCell(td,cause,td.dataset.field,()=>{
      refreshMapComp(fm.component_id||fm.component_name);
      // Re-wire add-cause button if it was in failure_cause cell
      td.querySelector('[data-action="add-cause"]')?.addEventListener('click',()=>addCauseRow(cause.parent_row_id,fm));
    });
  });

  tr.querySelector('[data-action="add-cause"]')?.addEventListener('click',()=>addCauseRow(cause.parent_row_id,fm));

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
    const cur=it[field]||'';
    const existingBtn=td.querySelector('.dfmea-inline-add');
    const hasAddBtn=!!existingBtn;
    const addAction=existingBtn?.dataset.action||'';
    const btnHtml=hasAddBtn?`<button class="dfmea-inline-add" data-action="${addAction}" style="display:none">＋</button>`:'';
    td.innerHTML=`<textarea class="dfmea-cell-input" rows="2">${esc(cur)}</textarea>${btnHtml}`;
    const ta=td.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    ta.addEventListener('blur',async()=>{
      const v=ta.value.trim(); it[field]=v;
      td.innerHTML=`${cellText(v)}${hasAddBtn?`<button class="dfmea-inline-add" data-action="${addAction}">＋</button>`:''}`;
      if(v!==(cur)) await autosave(it.id,{[field]:v});
      if(afterSave) afterSave();
    });
    ta.addEventListener('keydown',e=>{
      if(e.key==='Escape'){td.innerHTML=`${cellText(cur)}${hasAddBtn?`<button class="dfmea-inline-add" data-action="${addAction}">＋</button>`:''}`;if(afterSave)afterSave();}
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

async function addEffectRow(fm){
  const {data:eff,error}=await sb.from('dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-E${_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id).length+1}`,
    parent_type:_ctx.parentType, parent_id:_ctx.parentId, project_id:_ctx.project.id,
    row_type:'effect', parent_row_id:fm.id,
    sort_order:_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id).length,
    severity:5, occurrence:5, detection:5, action_status:'open', status:'draft',
  }).select().single();
  if(error){toast('Error creating Effect.','error');return;}
  _items.push(eff);
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${eff.id}"] .dfmea-col-eff`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function addCauseRow(parentId,fm){
  const {data:cause,error}=await sb.from('dfmea_items').insert({
    dfmea_code:`${fm.dfmea_code}-C${_items.filter(i=>rtype(i)==='cause'&&fmOf(i)?.id===fm.id).length+1}`,
    parent_type:_ctx.parentType, parent_id:_ctx.parentId, project_id:_ctx.project.id,
    row_type:'cause', parent_row_id:parentId,
    sort_order:_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===parentId).length,
    severity:5, occurrence:5, detection:5, action_status:'open', status:'draft',
  }).select().single();
  if(error){toast('Error creating Cause.','error');return;}
  _items.push(cause);
  renderTable();
  setTimeout(()=>{
    const td=document.querySelector(`tr[data-id="${cause.id}"] .dfmea-col-fc`);
    td?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },50);
}

async function deleteFm(fm){
  const kids=_items.filter(i=>fmOf(i)?.id===fm.id&&i.id!==fm.id);
  if(!confirm(`Delete FM "${fm.dfmea_code}"${kids.length?` and its ${kids.length} effect/cause row(s)`:''}?`)) return;
  const ids=[fm.id,...kids.map(i=>i.id)];
  await sb.from('dfmea_items').delete().in('id',ids);
  ids.forEach(id=>{_items=_items.filter(i=>i.id!==id);});
  renderTable();
  renderChain();
  refreshMapComp(fm.component_id||fm.component_name);
  toast('FM deleted.','success');
}

async function deleteCause(cause,fm){
  if(!confirm('Delete this cause?')) return;
  await sb.from('dfmea_items').delete().eq('id',cause.id);
  _items=_items.filter(i=>i.id!==cause.id);
  renderTable();
  refreshMapComp(fm.component_id||fm.component_name);
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

function renderChain(){
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
    if(tr) tr.innerHTML=`${cellText(v)}<button class="dfmea-inline-add" data-action="add-fm">＋</button>`;
    refreshMapComp(comp.id);
  };
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape')el.textContent=cur||'—';});
}

function refreshMapComp(compIdOrName){
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

// ── Sync from System ──────────────────────────────────────────────────────────

async function syncFromSystem(){
  const btn=document.getElementById('btn-dfmea-sync');
  if(btn){btn.disabled=true;btn.textContent='⟳ Syncing…';}
  try{
    const {data:comps}=await sb.from('arch_components').select('id,name,comp_type').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId);
    if(!comps?.length){toast('No components in Architecture Concept.','warning');return;}
    const compIds=comps.map(c=>c.id);
    const {data:archFns}=await sb.from('arch_functions').select('id,component_id,name,function_ref_id,is_safety_related').in('component_id',compIds);
    const {data:hazards}=await sb.from('hazards').select('id,data,function_id,status').eq('parent_type',_ctx.parentType).eq('parent_id',_ctx.parentId).eq('analysis_type','FHA');
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
      const fm=await addFmRow({component_id:mComp?.id||null,component_name:mComp?.name||'',function_name:mFn?.name||(fnRefs[haz.function_id]?.name||''),failure_mode:'',hazard_id:haz.id});
      if(!fm) continue;
      const efL=d.failure_condition||'',efH=d.effect_system||d.effect||'';
      if(efL||efH) await addEffectRow(fm).then(async()=>{const e=_items.filter(i=>rtype(i)==='effect'&&i.parent_row_id===fm.id).at(-1);if(e){e.effect_higher=efH;e.effect_local=efL;await autosave(e.id,{effect_higher:efH,effect_local:efL});}});
      const fcause=d.effect_local||'';
      if(fcause) await addCauseRow(fm.id,fm).then(async()=>{const ca=_items.filter(i=>rtype(i)==='cause'&&i.parent_row_id===fm.id).at(-1);if(ca){ca.failure_cause=fcause;await autosave(ca.id,{failure_cause:fcause});}});
      created++;
    }
    for(const comp of comps){
      const cFns=(archFns||[]).filter(f=>f.component_id===comp.id);
      for(const fn of cFns){
        const exists=_items.some(i=>rtype(i)==='fm'&&i.component_id===comp.id&&i.function_name===fn.name);
        if(!exists){await addFmRow({component_id:comp.id,component_name:comp.name,function_name:fn.name});created++;}
      }
    }
    toast(created>0?`Synced ${created} new FM(s).`:'Already up to date.','success');
  }catch(e){toast('Sync error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.textContent='⟳ Sync from System';}}
}
