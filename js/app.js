/* SME Finance Copilot prototype v2-4 application logic (flow and business rules unchanged; colours use Lilact tokens). */
const DAY=864e5;
const dn=iso=>{const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)/DAY};
const iso=n=>new Date(n*DAY).toISOString().slice(0,10);
function episodes(C){const out=[];let cur=null;C.days.forEach(([d,c],i)=>{const g=Math.max(0,C.buffer-c);if(g>0){if(!cur){cur={start:d,end:d,peak:g,peakDay:d,cashMin:c,i0:i,i1:i};out.push(cur)}else{cur.end=d;cur.i1=i;if(g>cur.peak){cur.peak=g;cur.peakDay=d;cur.cashMin=c}}}else cur=null});out.forEach((e,k)=>{e.k=k+1;e.censored=e.i1===C.days.length-1});return out}
function simulate(C,ep,lev,CAT){
 const asOf=dn(C.as_of),N=C.N,buf=C.buffer;
 const revBy=b=>C.sales.filter(s=>s[1]===b&&s[3]===1).reduce((a,s)=>a+s[2],0);
 const purBy=b=>C.pur.filter(s=>s[0]===b&&s[2]===1).reduce((a,s)=>a+s[1],0);
 const vLine=l=>C.inv.filter(x=>x.name===l).reduce((a,x)=>a+x.own,0);
 const revC=revBy(lev.cust),purS=purBy(lev.supp),vL=vLine(lev.line);
 const l1=!!lev.l1_on&&lev.X>=0&&lev.X<=30&&revC>0,l2=!!lev.l2_on&&lev.Y>=0&&lev.Y<=30&&purS>0,l3=!!lev.l3_on&&lev.Z>=0&&lev.Z<=50&&vL>0;
 const delta=new Map(),add=(d,x)=>delta.set(d,(delta.get(d)||0)+x);
 const recv=new Map();
 C.ev.forEach(e=>{const [id,dir,cat,partner,amt,date]=e;let nd=dn(date);const od=nd;
  if(l1&&cat==='invoice_receipt'&&partner===lev.cust){nd=Math.max(asOf+1,od-lev.X);if(nd!==od){add(nd,amt);add(od,-amt)}}
  if(l2&&cat==='supplier_payment'&&partner===lev.supp){nd=od+lev.Y;if(nd!==od){add(od,amt);add(nd,-amt)}}
  recv.set(id,nd)});
 const freed=l3?vL*lev.Z/100:0,rel=freed*(1-lev.hair/100);if(l3)add(asOf+lev.lag,rel);
 let l4=false,cost=0,Iu=0,Cc=0,status='OFF',reason='';
 const need=dn(ep.start);
 if(lev.l4_on){status='BLOCKED';const cat=CAT.find(c=>c.id===lev.prod),e=C.ev.find(x=>x[0]===lev.inv_id&&x[1]==='IN');
  if(!cat||!['invoice_factoring','reverse_factoring','dynamic_discounting'].includes(cat.type)){reason='Product outside the catalogue or not tied to an invoice'}
  else if(!e){reason='Invoice is no longer open'}
  else{const rd=recv.get(e[0]),fund=need,sale=C.sales.find(s=>s[0]===lev.inv_id),dpd=sale&&typeof sale[5]==='number'?Math.max(0,sale[5]):0,wl=cat.wl?cat.wl.split('|'):[];
   if(dn(e[5])<need)reason='Invoice is collected before the cash-needed date';
   else if(e[4]<cat.mn)reason='Invoice is below the product minimum';
   else if(wl.length&&!wl.includes(e[3]))reason='Customer is not on the product list';
   else if(dpd>cat.mo)reason='Invoice overdue beyond the cap';
   else if(rd<fund)reason='After early collection the invoice no longer lands after the cash-needed date';
   else{l4=true;status='OK';Iu=Math.min(e[4],cat.mx);const t=Math.max(1,rd-fund);
    if(cat.type==='dynamic_discounting'){Cc=Iu*(1-cat.disc/100);cost=Iu*cat.disc/100}
    else{Cc=Iu*cat.adv/100;const base=cat.fbase==='invoice'?Iu:Cc;cost=Cc*cat.rate/100*t/365+(cat.fee?base*cat.fee/100:0)}
    add(fund,Cc);add(rd,-(Cc+cost))}}}
 let cum=0;const path=C.days.map(([d,c])=>{cum+=delta.get(dn(d))||0;return {d,c,s:c+cum}});
 const gap0=p=>Math.max(0,buf-p.c),gap1=p=>Math.max(0,buf-p.s);
 const epi=path.filter(p=>dn(p.d)>=need&&dn(p.d)<=dn(ep.end));
 const AR=C.ar-(l1?revC/N*lev.X:0)-(l4?Iu*1:0),INV=C.invv-freed,AP=C.ap+(l2?purS/N*lev.Y:0);
 const dso=AR/C.rev*N,dio=INV/C.cogs*N,dpo=AP/C.cogs*N;
 const pk=epi.reduce((a,p)=>p.c<a.c?p:a,epi[0]);
 return {ccc:dso+dio-dpo,dso,dio,dpo,gap_epi:Math.max(...epi.map(gap1)),newDays:path.filter(p=>gap0(p)===0&&gap1(p)>0).length,cost:cost+freed*lev.hair/100,cashPeak:pk.s,l:[l1,l2,l3,l4],status4:status,reason,path,financed:l4?{Iu,Cc,fin:cost}:null,
  valid:{l1:!lev.l1_on||l1,l2:!lev.l2_on||l2,l3:!lev.l3_on||l3},freed,rel};
}



const DISC='Simulated products and indicative figures only. This is not a credit decision; lenders decide.';
const CAT=DATA.cat;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// nf, mm, money, vnd, enM, pct, days, fd, fds, enDate: js/formatters.js (shared number and date formatting).
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const FIRMS={F01:{name:'Alpha Garment Subcontractor',short:'Alpha Garment'},F02:{name:'Beta Fabric Distributor',short:'Beta Fabric'},F03:{name:'Gamma Packaging & Trims',short:'Gamma Trims'}};
const LV_NAME={l1:'Early collection',l2:'Extend payables',l3:'Cut inventory',l4:'Finance one invoice'};
const REJ={INVOICE_TOO_SMALL:'Invoice is below the product minimum',NO_OPEN_INVOICE:'No suitable open invoice',NOT_ELIGIBLE:'Not eligible'};
const TYPE_VN={invoice_factoring:'Invoice factoring',reverse_factoring:'Reverse factoring',inventory_loan:'Inventory-backed loan',credit_line:'Credit line',dynamic_discounting:'Dynamic discounting'};
const INV_PRODUCTS=['FAC-001','FAC-002','FAC-003','RF-001','DD-001'];


/* Sample companies: every case is computed here from the raw snapshots in DATA.raw with the same engine that
   processes uploaded files (BR-02.18). Nothing computed is stored in data.js. */
const SESSION_LOADED_AT=new Date().toISOString();
const VIEW=new Map();   // horizon views of the cases (see C())
DATA.cases={};DATA.snaps={};DATA.inputs={};DATA.forecasts={};DATA.caseVersion={};
function registerCases(id,input){
  const snap=ENGINE.makeSnapshot(input),cases=ENGINE.buildCases(snap);DATA.snaps[id]=snap;DATA.inputs[id]=input;
  setCases(id,cases);DATA.caseVersion[id]=null;
  return snap;
}
function setCases(id,cases){
  Object.keys(DATA.cases).filter(k=>k.split('|')[0]===id).forEach(k=>delete DATA.cases[k]);
  Object.entries(cases).forEach(([k,c])=>{DATA.cases[id+'|'+k]=c;setDefaultGap(c)});DATA.forecasts[id]=cases.base.fc;VIEW.clear();
}
// Cases follow the company's configuration (Cash0, Rmin/Rtarget/Rupper, VAT, essential suppliers): they are rebuilt when the
// configuration version changes, so results of an older version are never shown as current.
function policyCases(firm){
  const snap=DATA.snaps[firm];if(!snap)return;const vid=POLICY.versionId(firm)+'|'+((S.user&&S.user.id)||'anon');if(DATA.caseVersion[firm]===vid)return;
  const p=POLICY.get(firm),model=ENGINE.modelOf(snap,{business_model:p.business_model}).model,c0=ENGINE.resolveCash0(snap,p),R=ENGINE.resolveReserves(snap,p,model);
  setCases(firm,ENGINE.buildCases(snap,{cash0:c0.value,rtarget:R.rtarget>0?R.rtarget:0,config:{amount_basis:p.amount_basis||snap.config.amount_basis,vat_rate:p.vat_rate??snap.config.vat_rate},
    essentialSuppliers:p.essential_suppliers||snap.firm.essential_suppliers,apTiming:p.ap_timing}));
  DATA.caseVersion[firm]=vid;
}
// UC02 run of the current company and configuration over S.weeks weeks (cached per snapshot, formula, configuration and horizon).
function uc02(firm=S.firm){
  const snap=DATA.snaps[firm];if(!snap)return null;policyCases(firm);
  const p=POLICY.get(firm),vid=POLICY.versionId(firm),d=uc01(firm),fr=freshness(snap).level;
  const key=['uc02',snap.snapshot_id,CFG.versions.formula,vid,S.weeks,d.snapshot_id,fr].join('|');
  if(!RUNS.has(key))RUNS.set(key,ENGINE.runUC02(snap,p,{weeks:S.weeks,uc01:d,config_version:vid,freshness:fr,model:d.model.model}));
  return RUNS.get(key);
}
// Rmin of the current configuration for the daily colours (alertLevel falls back to 50 % of Rtarget when it is missing).
const RMIN=()=>{const u=uc02();return u&&u.reserves.rmin!=null?u.reserves.rmin:undefined};
Object.entries(DATA.raw).forEach(([id,raw])=>registerCases(id,ENGINE.inputFromRaw(raw,SESSION_LOADED_AT)));
const S={uc01Sel:null,weeks:13,firm:'F01',case:'base',tab:'dash',epIdx:0,lev:null,last:null,cmp:[],log:[],drafts:[],draftN:0,logFilter:{status:'all',q:''},apprFilter:'all',overlay:true,done:new Set(),seq:0,runN:0,stage:0,cause:null};
const C=()=>{const c=DATA.cases[S.firm+'|'+S.case];if(!c||!(S.weeks<CFG.tv2.horizonWeeks))return c;
  const k=[S.firm,S.case,S.weeks,DATA.caseVersion[S.firm]].join('|');if(!VIEW.has(k))VIEW.set(k,viewCase(c,S.weeks));return VIEW.get(k)};
function viewCase(c,H){const last=dn(c.as_of)+7*H,v={...c,days:c.days.slice(0,7*H),ev:c.ev.filter(e=>dn(e[5])<=last),defk:null,tv3:null,weeks:H};setDefaultGap(v);return v}
// Default gap for financing: the largest gap that has ended within the horizon (a still-open gap has no known end), else the largest.
function setDefaultGap(c){const eps=episodes(c);if(eps.length){const ended=eps.filter(e=>!e.censored),pool=ended.length?ended:eps,e=pool.reduce((a,x)=>x.peak>a.peak?x:a,pool[0]);c.defk=e.k;c.tv3=rankFor(c,e,eps.length)}}
/* Company policy store: owner declarations and approved settings, one versioned record per account and company.
   Every change bumps the version, so results computed with an older version are no longer reused (they are stale). */
const POLICY={
  key:f=>`lilact.policy.v1.${(S.user&&S.user.id)||'anon'}.${f}`,
  get(f=S.firm){try{return JSON.parse(localStorage.getItem(this.key(f))||'null')||{version:0}}catch(e){return {version:0}}},
  set(f,patch,reason){const p=this.get(f),v=(p.version||0)+1,at=new Date().toISOString();
    const n={...p,...patch,version:v,updatedAt:at,history:[...(p.history||[]),{version:v,at,patch,reason:reason||null}].slice(-20)};
    try{localStorage.setItem(this.key(f),JSON.stringify(n))}catch(e){toast('Could not save the setting: browser storage is full or blocked');return p}
    return n},
  versionId(f=S.firm){return `CFG-${f}-v${this.get(f).version||0}`}
};
// Results are kept per (snapshot, formula version, configuration version): asking again reuses the stored run (BR-02.28, Q70).
const RUNS=new Map();
// UC01 snapshot: the data snapshot, or a re-cut at the cut-off date and period chosen on the dashboard (S.uc01Sel).
function uc01Snap(firm=S.firm){
  const sel=firm===S.firm?S.uc01Sel:null;if(!sel)return DATA.snaps[firm];
  const k=`snap|${firm}|${sel.asOf}|${sel.start}`;if(!RUNS.has(k))RUNS.set(k,ENGINE.makeSnapshot(DATA.inputs[firm],{asOf:sel.asOf,periodStart:sel.start}));return RUNS.get(k);
}
function uc01(firm=S.firm){
  const snap=uc01Snap(firm);if(!snap)return null;
  const p=POLICY.get(firm),vid=POLICY.versionId(firm),key='uc01|'+[snap.snapshot_id,CFG.versions.formula,vid].join('|');
  if(!RUNS.has(key)){
    const prev=LABELS.previous(firm,snap.snapshot_id),d=ENGINE.diagnose(snap,{business_model:p.business_model||null,materiality:p.materiality??null,version_id:vid,prevLabels:prev});
    // Programme lists of the supply-chain products (RF, DD) and the highest catalogue rate feed the UC03 flags of the profiles.
    const wl=CAT.filter(c=>['reverse_factoring','dynamic_discounting'].includes(c.type)).flatMap(c=>c.wl?c.wl.split('|'):[]);
    d.profiles=ENGINE.profiles(snap,d,{maxRate:Math.max(...CAT.map(c=>c.rate))/100,whitelist:wl,prevLabels:prev,allowExtension:p.allowExtension||{}});
    LABELS.record(firm,snap.snapshot_id,d.profiles.customers);RUNS.set(key,d)}
  return RUNS.get(key);
}
// Label history per company: labels are recomputed for each new snapshot and every change is logged (section 2.7.10.1);
// the size and behaviour bands of Tables 2-38/2-39 compare against the labels of the previous snapshot.
const LABELS={
  key:f=>`lilact.labels.v1.${(S.user&&S.user.id)||'anon'}.${f}`,
  get(f){try{return JSON.parse(localStorage.getItem(this.key(f))||'null')||{snaps:{},order:[],history:[]}}catch(e){return {snaps:{},order:[],history:[]}}},
  previous(f,sid){const L=this.get(f),prev=L.order.filter(x=>x!==sid).at(-1);return prev?L.snaps[prev]:{}},
  record(f,sid,custs){const L=this.get(f);if(L.snaps[sid])return;const prev=L.order.length?L.snaps[L.order.at(-1)]:null,now={};
    custs.forEach(c=>{now[c.key]={size:c.size,behaviour:c.behaviour};if(prev&&prev[c.key])['size','behaviour'].forEach(k=>{if(prev[c.key][k]!==now[c.key][k])L.history.push({at:new Date().toISOString(),snapshot:sid,customer:c.name,field:k,from:prev[c.key][k],to:now[c.key][k]})})});
    L.snaps[sid]=now;L.order.push(sid);L.order=L.order.slice(-12);L.history=L.history.slice(-200);try{localStorage.setItem(this.key(f),JSON.stringify(L))}catch(e){}}
};
let EPS=[],EP=null,BASE=null;
function derive(){
  const c=C();EPS=episodes(c);
  S.epIdx=Math.min(S.epIdx,Math.max(0,EPS.length-1));
  EP=EPS[S.epIdx]||{start:c.days[0][0],end:c.days.at(-1)[0],k:0,peak:0,none:true};
  BASE=simulate(c,EP,offLev(),CAT);
}
// TV3 ranking for any gap: the stored ranking for c.defk, otherwise rankFor(); cached per firm|case|gap.
const TV3_CACHE={};
function tv3For(ep){
  const c=C();if(!ep||ep.none)return null;
  if(c.defk===ep.k&&c.tv3)return c.tv3;
  const key=`${S.firm}|${S.case}|${ep.k}`;
  return TV3_CACHE[key]||(TV3_CACHE[key]=rankFor(c,ep,EPS.length));
}
const largestGap=()=>EPS.length?EPS.reduce((a,e)=>e.peak>a.peak?e:a,EPS[0]):null;
function selectGap(k){const i=EPS.findIndex(e=>e.k===k);if(i<0)return false;S.epIdx=i;derive();S.lev=freshLev();return true}
// Daily alert level (SRS 2.8.11.3), checked in this order on unrounded values:
// red: below 0, below Rmin or more than 50% short of Rtarget · orange: 20–50% short · yellow: up to 20% short · green: at or above Rtarget.
function alertLevel(cashEnd,Rt,Rmin=0.5*Rt){
  if(!(Rt>0))return 'na';
  const gr=Math.max(0,Rt-cashEnd)/Rt;
  if(cashEnd<0||cashEnd<Rmin||gr>0.5)return 'red';
  if(gr>0.2)return 'orange';
  if(gr>0)return 'yellow';
  return 'green';
}
const LV={red:{n:3,label:'Red',color:'var(--lc-color-status-error)'},orange:{n:2,label:'Orange',color:'var(--lc-color-alert-orange)'},yellow:{n:1,label:'Yellow',color:'var(--lc-color-alert-yellow)'},green:{n:0,label:'Green',color:'var(--lc-color-status-success)'},blue:{n:-1,label:'Surplus',color:'var(--lc-color-status-info)'},na:{n:-2,label:'Not available',color:'var(--lc-color-status-neutral)'}};
const worstLevel=levels=>levels.reduce((a,l)=>LV[l].n>LV[a].n?l:a,'green');
const LV_RULE={red:'below 0, below Rmin or more than 50% short of Rtarget',orange:'20–50% short of Rtarget',yellow:'up to 20% short of Rtarget',green:'at or above Rtarget'};
function alertLegendHTML({surplus}={}){
  return `<div class="legend lv-legend" role="list" aria-label="Alert colours">${['red','orange','yellow','green'].map(l=>`<span role="listitem"><i class="lv-sw lv-${l}" aria-hidden="true"></i><b>${LV[l].label}</b>&nbsp;· ${LV_RULE[l]}</span>`).join('')}${surplus?`<span role="listitem"><i class="lv-sw lv-blue" aria-hidden="true"></i><b>Blue</b>&nbsp;· surplus, above Rupper for ≥ 14 days</span>`:''}</div>`;
}
function offLev(){
  const c=C(),buyers=topBy(c.sales.filter(s=>s[3]===1),s=>s[1],s=>s[2]),sup=topBy(c.pur.filter(s=>s[2]===1),s=>s[0],s=>s[1]);
  const own=c.inv.filter(x=>x.own>0),slow=own.find(x=>x.slow===1)||own[0];
  return {l1_on:0,cust:buyers[0]?.k||'',X:7,l2_on:0,supp:sup[0]?.k||'',Y:7,l3_on:0,line:slow?.name||'',Z:25,lag:14,hair:10,l4_on:0,inv_id:'',prod:'RF-001'};
}
function topBy(arr,kf,vf){const m=new Map();arr.forEach(a=>m.set(kf(a),(m.get(kf(a))||0)+vf(a)));return [...m].map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v)}
function candInvoices(){const c=C(),need=dn(EP.start);return c.ev.filter(e=>e[1]==='IN'&&e[2]==='invoice_receipt'&&dn(e[5])>=need).sort((a,b)=>dn(a[5])-dn(b[5]))}
function defaultInvoice(){const g=EP.peak||0,list=candInvoices();if(!list.length)return '';const fit=list.filter(e=>e[4]>=g).sort((a,b)=>a[4]-b[4])[0];return (fit||list.sort((a,b)=>b[4]-a[4])[0])[0]}
function freshLev(){const l=offLev();l.inv_id=defaultInvoice();return l}
const SCEN=()=>SC.filter(s=>s.firm===S.firm);


function toast(msg,ms=3200){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('#toasts').appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),320)},ms)}
function animNum(el,to,fmt,dur=650){
  if(!el)return;const from=el._v??to;el._v=to;
  if(reduceMotion||from===to){el.textContent=fmt(to);return}
  const t0=performance.now();cancelAnimationFrame(el._raf);
  const step=t=>{const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(from+(to-from)*e);if(p<1)el._raf=requestAnimationFrame(step)};
  el._raf=requestAnimationFrame(step);
}
let modalReturnFocus=null;
function openModal(html,onMount){const m=$('#modal');modalReturnFocus=document.activeElement;m.innerHTML=html;m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');$('#scrim').classList.add('show');onMount&&onMount(m);const f=m.querySelector('input,textarea,button.primary,button.ok,button:not([disabled])');f&&setTimeout(()=>f.focus(),30)}
function closeModal(){$('#scrim').classList.remove('show');modalReturnFocus?.focus?.();modalReturnFocus=null}
$('#scrim').addEventListener('mousedown',e=>{if(e.target.id==='scrim')closeModal()});
document.addEventListener('keydown',e=>{
  if($('#scrim').classList.contains('show')){const m=$('#modal'),f=[...m.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(x=>!x.hidden);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeModal();return}if(e.key==='Tab'&&f.length){if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===f.at(-1)){e.preventDefault();f[0].focus()}}return}
  const tag=(e.target.tagName||'').toLowerCase();
  if(['input','textarea','select'].includes(tag)||e.metaKey||e.ctrlKey)return;
  const map={'1':'dash','2':'gap','3':'whatif','4':'appr'};
  if(map[e.key])setTab(map[e.key]);
  if(e.key==='/'){e.preventDefault();$('#chatInput').focus()}
});


function eventsByDay(){const m=new Map();C().ev.forEach(e=>{const d=dn(e[5]);if(!m.has(d))m.set(d,{in:[],out:[]});m.get(d)[e[1]==='IN'?'in':'out'].push(e)});return m}
function cashChart(box,o){
  if(!box._init){box.innerHTML='<svg></svg><div class="hv" style="position:absolute;inset:0"></div><div class="tip"></div>';box._init=1;bindHover(box)}
  box._o=o;const svg=$('svg',box);
  const target=o.scen?o.path.map(p=>p.s):null,prev=box._prev&&box._prev.length===o.path.length?box._prev:(target||o.path.map(p=>p.c));
  const paint=(sv,first)=>drawChart(box,svg,o,sv,first);
  cancelAnimationFrame(box._raf);
  if(!target){paint(null,!box._drawn);box._drawn=1;box._prev=null;return}
  if(reduceMotion||!box._drawn||!box._prev){paint(target,!box._drawn);box._drawn=1;box._prev=target;return}
  const t0=performance.now(),from=prev.slice();
  const step=t=>{const p=Math.min(1,(t-t0)/420),e=1-Math.pow(1-p,3);paint(target.map((v,i)=>from[i]+(v-from[i])*e),false);if(p<1)box._raf=requestAnimationFrame(step);else box._prev=target};
  box._raf=requestAnimationFrame(step);box._prev=target;
}
function drawChart(box,svg,o,sv,first){
  const W=Math.max(320,box.clientWidth||680),H=o.h||250,m={l:46,r:14,t:14,b:28},n=o.path.length;
  const base=o.path.map(p=>p.c/1e6),sc=sv?sv.map(v=>v/1e6):null,buf=o.buf/1e6,rmin=o.rmin!=null?o.rmin/1e6:null,rup=o.rup!=null?o.rup/1e6:null,sbd=o.band?o.band.map(a=>a.map(v=>v/1e6)):null;
  const all=[...base,...(sc||[]),buf,...(rmin!=null?[rmin]:[]),...(rup!=null?[rup]:[]),...(sbd?sbd.flat():[])];let mn=Math.min(...all),mx=Math.max(...all);const pad=(mx-mn)*.12||50;mn-=pad;mx+=pad;
  const X=i=>m.l+i*(W-m.l-m.r)/(n-1),Y=v=>m.t+(1-(v-mn)/(mx-mn))*(H-m.t-m.b),yb=Y(buf);
  const line=a=>a.map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join(' ');
  const area=a=>line(a)+` L${X(n-1)} ${yb} L${X(0)} ${yb} Z`;
  const cid='cp'+Math.random().toString(36).slice(2,7);
  let g='';const steps=4;
  for(let i=0;i<=steps;i++){const v=mn+(mx-mn)*i/steps,y=Y(v);g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y}" y2="${y}" stroke="var(--lc-color-border-default)" stroke-dasharray="3 4"/><text x="${m.l-8}" y="${y+3.5}" text-anchor="end" font-size="10" fill="var(--lc-color-text-muted)" class="num">${Math.round(v)}</text>`}
  let xl='';for(let i=0;i<n;i+=7){xl+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle" font-size="10" fill="var(--lc-color-text-muted)">${i%14===0?fds(o.path[i].d):''}</text>`}
  let band='';(o.eps||(o.ep&&!o.ep.none?[o.ep]:[])).forEach(e=>{const i0=o.path.findIndex(p=>p.d===e.start),i1=o.path.findIndex(p=>p.d===e.end);if(i0<0)return;const on=o.ep&&!o.ep.none&&e.k===o.ep.k;
    band+=`<rect class="gapband${on?' on':''}" x="${X(i0)-3}" y="${m.t}" width="${Math.max(6,X(i1)-X(i0)+6)}" height="${H-m.t-m.b}" rx="5" fill="color-mix(in srgb,var(--lc-color-alert-red-mark) ${on?15:7}%,transparent)" stroke="color-mix(in srgb,var(--lc-color-status-error) ${on?70:30}%,transparent)" stroke-width="${on?1.6:1}" stroke-dasharray="4 3"/><text x="${X(i0)}" y="${m.t+11}" font-size="10" font-weight="700" fill="var(--lc-color-status-error)">Gap ${e.k}</text>`});
  const dim=sc?'var(--lc-color-data-historical)':'var(--lc-color-data-cash)';
  const bandP=sbd&&sbd[0].length===n?`<path class="sband" d="${sbd[0].map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join(' ')} ${sbd[1].map((v,i)=>i).reverse().map(i=>'L'+X(i).toFixed(1)+' '+Y(sbd[1][i]).toFixed(1)).join(' ')} Z" fill="color-mix(in srgb,var(--lc-color-data-cash) 9%,transparent)"/>`
    +sbd.map(a=>`<path d="${line(a)}" fill="none" stroke="var(--lc-color-data-historical)" stroke-width="1.2" stroke-dasharray="2 3"/>`).join(''):'';
  const rline=(v,lb,col)=>v==null?'':`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-width="1.1" stroke-dasharray="2 4"/><text x="${m.l+4}" y="${Y(v)-4}" font-size="10" font-weight="700" fill="${col}">${lb} ${Math.round(v)}</text>`;
  const len=Math.round(W*1.6);
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('height',H);
  svg.innerHTML=`<defs><clipPath id="${cid}"><rect x="${m.l}" y="${yb}" width="${W-m.l-m.r}" height="${Math.max(0,H-yb)}"/></clipPath><linearGradient id="${cid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--lc-color-data-cash)" stop-opacity=".16"/><stop offset="1" stop-color="var(--lc-color-data-cash)" stop-opacity="0"/></linearGradient></defs>
  ${g}${xl}${band}${bandP}${rline(rup,'Rupper','var(--lc-color-status-info)')}${rline(rmin,'Rmin','var(--lc-color-status-error)')}
  <path d="${area(base)}" fill="color-mix(in srgb,var(--lc-color-alert-red-mark) 19%,transparent)" clip-path="url(#${cid})" ${first?'style="animation:areaIn .9s .5s both"':''}/>
  <line x1="${m.l}" x2="${W-m.r}" y1="${yb}" y2="${yb}" stroke="var(--lc-color-alert-orange-mark)" stroke-width="1.5" stroke-dasharray="6 4"/>
  <text x="${W-m.r}" y="${yb-5}" text-anchor="end" font-size="10" font-weight="700" fill="var(--lc-color-alert-orange)">Rtarget ${Math.round(buf)}</text>
  <path d="${line(base)}" fill="none" stroke="${dim}" stroke-width="${sc?2:2.6}" stroke-linecap="round" stroke-linejoin="round" ${first?`style="--len:${len};stroke-dasharray:${len};animation:lineDraw 1.1s var(--ease) both"`:''} ${sc?'opacity=".75"':''}/>
  ${o.path.map((p,i)=>`<circle class="dpt" cx="${X(i).toFixed(1)}" cy="${Y(base[i]).toFixed(1)}" r="2.4" fill="${LV[alertLevel(p.c,o.buf,o.rmin)].color}"><title>${fd(p.d)} · ${LV[alertLevel(p.c,o.buf,o.rmin)].label}</title></circle>`).join('')}
  ${sc?`<path d="${line(sc)}" fill="none" stroke="var(--lc-color-status-success)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`:''}
  <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H-m.b}" stroke="var(--lc-color-text-primary)" stroke-opacity=".35" stroke-dasharray="3 3" style="display:none"/>
  <circle class="dot1" r="4.5" fill="var(--lc-color-bg-surface)" stroke="${dim}" stroke-width="2.5" style="display:none"/>${sc?'<circle class="dot2" r="4.5" fill="var(--lc-color-bg-surface)" stroke="var(--lc-color-status-success)" stroke-width="2.5" style="display:none"/>':''}`;
  box._geo={W,H,m,n,X,Y,mn,mx};
}
function bindHover(box){
  const hv=$('.hv',box),tip=$('.tip',box);let evm=null;
  hv.addEventListener('mousemove',ev=>{
    const o=box._o,g=box._geo;if(!o||!g)return;evm=evm||eventsByDay();
    const r=hv.getBoundingClientRect(),x=ev.clientX-r.left,i=Math.max(0,Math.min(g.n-1,Math.round((x-g.m.l)/((g.W-g.m.l-g.m.r)/(g.n-1)))));
    const p=o.path[i],svg=$('svg',box),cross=$('.cross',svg),d1=$('.dot1',svg),d2=$('.dot2',svg);
    if(!cross)return;cross.style.display='';cross.setAttribute('x1',g.X(i));cross.setAttribute('x2',g.X(i));
    d1.style.display='';d1.setAttribute('cx',g.X(i));d1.setAttribute('cy',g.Y(p.c/1e6));
    if(d2&&o.scen){d2.style.display='';d2.setAttribute('cx',g.X(i));d2.setAttribute('cy',g.Y(p.s/1e6))}
    const e=evm.get(dn(p.d))||{in:[],out:[]},top=(a,cls,sign)=>a.sort((u,v)=>v[4]-u[4]).slice(0,3).map(z=>`<div class="r ${cls}"><span>${sign} ${esc(z[3]).slice(0,26)}</span><span class="num">${nf(z[4]/1e6,1)}</span></div>`).join('');
    const short=Math.max(0,o.buf-p.c);
    tip.innerHTML=`<b>${fd(p.d)}</b><div class="r"><span>Base balance</span><span class="num">${nf(p.c/1e6,1)}M</span></div>${o.scen?`<div class="r" style="color:#6BCB8F"><span>After levers</span><span class="num">${nf(p.s/1e6,1)}M</span></div>`:''}${short>0?`<div class="r" style="color:#F2C94C"><span>Below buffer</span><span class="num">${nf(short/1e6,1)}M</span></div>`:''}${(e.in.length||e.out.length)?'<hr>':''}${top(e.in,'in','+')}${top(e.out,'out','−')}`;
    tip.classList.add('show');
    const tw=tip.offsetWidth,left=Math.min(Math.max(4,g.X(i)+12),g.W-tw-4);tip.style.left=left+'px';tip.style.top=Math.max(4,g.Y(p.c/1e6)-tip.offsetHeight-10)+'px';
  });
  hv.addEventListener('mouseleave',()=>{tip.classList.remove('show');$$('.cross,.dot1,.dot2',box).forEach(e=>e.style.display='none')});
}
// Daily charts size themselves to their box, so redraw them after a resize or once a panel transition has settled.
function redrawCharts(){$$('.chartbox').forEach(b=>{if(b._o){const o=b._o;b._prev=null;b._drawn=1;cashChart(b,o)}})}
let rzT;addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{redrawCharts();placeInk()},120)});


function placeInk(){const t=$(`.tab[data-tab="${S.tab}"]`),ink=$('#ink');if(!t)return;ink.style.left=t.offsetLeft+'px';ink.style.width=t.offsetWidth+'px'}

$('#tabs').addEventListener('click',e=>{const t=e.target.closest('.tab');if(t)setTab(t.dataset.tab)});


function switchContext(firm,cs,{silent}={}){
  for(const k in TV3_CACHE)delete TV3_CACHE[k];S.causes={};
  S.firm=firm;S.case=cs;S.lev=null;S.last=null;S.cmp=[];S.epIdx=0;S.uc01Sel=null;S.gapRequest=null;S.weeks=CFG.tv2.horizonWeeks;policyCases(firm);
  const c=C();const eps=episodes(c);if(c.defk)S.epIdx=c.defk-1;else if(eps.length)S.epIdx=eps.reduce((a,e,i)=>e.peak>eps[a].peak?i:a,0);
  derive();S.lev=freshLev();$('#firmSel').value=firm;$$('.chipdate b').forEach(b=>b.textContent=fd(C().as_of));
  const w=$('#work');w.classList.add('loading');setTimeout(()=>w.classList.remove('loading'),260);
  $('#panelSub').textContent=`${firm} · ${FIRMS[firm].name}`;renderDemoChips();refreshTab();
  Object.values(THREADS).forEach(t=>{t.innerHTML='';t.dataset.init='0'});S.done=new Set();resetFlow();
  if(!silent)welcome(S.task);
}
$('#firmSel').addEventListener('change',e=>{const f=e.target.value;if(f==='__add'){$('#firmSel').value=S.firm;startImport(null);return}switchContext(f,defCase(f));addLog({tool:'get_firm_context',tier:0,args:{firm_id:f},status:'ok',summary:'Switched company, started a new session'});toast(`Switched to ${f} · ${FIRMS[f].short}`)});


// Numbered section used by the Dashboard and Shortfall tabs.
const dashSec=(n,col,h,pp,inner)=>`<section class="dsec" style="--sc:${col};--i:${n-1}"><header class="dsh"><span class="dsn">${n}</span><div><h2>${h}</h2><p>${pp}</p></div></header>${inner}</section>`;
/* ===== UC01 ↔ UC02 links and the gap_request to UC03 (SRS 2.7.11.9, 2.8.5, 2.8.7) ===== */
const evDate=e=>e.t!=null?fd(isoOf(e.t)):'—';
// Contributing factors of a gap of the displayed scenario, from the cached UC02 run and UC01 findings (nothing recalculated).
function gapFactors(e){return ENGINE.contributingFactors(uc02(),uc01(),{start:e.start,end:e.end,low_date:e.peakDay},S.case)}
function delayNote(e){
  if(e.tier==null)return '';
  const m=e.method||'',d=e.delay!=null?nf(e.delay,1):'—';
  if(/residual/.test(m))return t('cf.delay.residual',{dpd:e.dpd,d});
  return t('cf.delay.'+e.tier+(/conditional/.test(m)?'_cond':''),{d,n:(uc02().fc.delays.receipts[e.key]||{}).used_n||0});
}
function factorsHTML(cf){
  const L=cf.links;
  const linkLine=l=>l.type==='L1'?t('link.L1.'+l.item,{obj:esc(l.object),f:l.finding_ids.join(', '),ev:t('ev.'+l.evidence),v:money(l.amount)})
    :t('link.L2',{f:l.finding_ids.join(', ')||'—',ev:t('ev.'+l.evidence),v:money(l.amount)});
  return `<div class="cf"><div class="cf-col"><b>${t('cf.out')}</b><ul>${cf.outflows.map(e=>`<li>${esc(lblCat(e.cat))}${e.cat==='supplier_payment'?' · '+esc(e.partner):''}: ${money(e.amt)} · ${evDate(e)}</li>`).join('')||`<li>—</li>`}</ul></div>
   <div class="cf-col"><b>${t('cf.after')}</b><ul>${cf.receipts_after.map(e=>`<li>${esc(e.partner)} · ${esc(e.id)}: ${money(e.amt)} · ${e.scope==='beyond_horizon'?t('cf.beyond'):t('cf.expected',{d:evDate(e)})}<small>${delayNote(e)}</small></li>`).join('')||`<li>—</li>`}</ul></div></div>
   <div class="cf-links">${L.length?L.map(l=>`<p class="lk lk-${l.type}"><span class="lt">${l.type}</span>${linkLine(l)}</p>`).join(''):`<p class="lk lk-L3"><span class="lt">L3</span>${t('link.L3')}</p>`}
    ${cf.squeeze?`<p class="lk sq">⇄ ${t('link.squeeze')}</p>`:''}<p class="cf-note">${t('cf.note')}${cf.fallback_delays?' '+t('cf.fallback'):''}</p></div>`;
}
// gap_request (UC02.7): a summary to confirm first; only with an ok/provisional run, TH01 and a matrix cell; never with W unknown or expired data.
function gapRequestState(){const u=uc02(),d=uc01(),fr=freshness(DATA.snaps[S.firm]).level;return {u,d,chk:ENGINE.gapRequestCheck(u,d,fr)}}
function gapRequestHTML(gr){
  const row=(k,v)=>`<div><dt>${t('gr.'+k)}</dt><dd>${v}</dd></div>`;
  return `<dl class="ev-info gr">${row('need_date',fd(gr.need_date))}${row('peak_gap',`${money(gr.peak_gap)} · ${fd(gr.peak_date)}`)}${row('cash0_need',money(gr.cash0_need))}
   ${row('episodes',gr.episodes.map(e=>`${fds(e.start)}–${fds(e.end)}${e.censored?' ('+t('ep.open')+')':''}`).join(', '))}${row('matrix',`${gr.matrix_case_id} · ${M_EN[gr.matrix_case_id]}`)}
   ${row('bottleneck',gr.main_bottleneck?t('item.'+gr.main_bottleneck):t('w.none'))}${row('pattern',`${gr.bn_pattern} · ${gr.cause_items.join(', ')||'—'}`)}${row('findings',gr.finding_ids.join(', ')||'—')}
   ${row('obligation',money(gr.obligation_overdue))}${row('link',`${gr.link_type} · ${t('ev.'+gr.evidence_level)}`)}${row('scenario',t('sc.'+gr.scenario))}${row('cash0',t('c0.st.'+gr.cash0_status))}
   ${row('health',t('mh.'+gr.model_health))}${row('ids',`${gr.run_id} · ${esc(gr.snapshot_id)}`)}${row('versions',`${gr.versions.formula} · ${gr.versions.threshold} · ${esc(gr.versions.config)}`)}</dl>
   <p class="cf-note">${t('gr.peaknote')}</p>`;
}
function openGapRequest(after){
  const {u,d,chk}=gapRequestState();
  if(!chk.ok){openModal(`<div class="evid"><button class="settings-close" aria-label="Close">×</button><h3>${chk.label==='idle_cash'?t('gr.idle'):t('gr.title')}</h3><p>${t('gr.block.'+chk.reason)}</p><div class="acts"><button class="btn sec" id="grClose">${t('pol.cancel')}</button></div></div>`,m=>{m.querySelector('.settings-close').onclick=m.querySelector('#grClose').onclick=closeModal});return}
  const gr=ENGINE.buildGapRequest(u,d,{scenario:S.case,health:modelHealthNow(),createdAt:new Date().toISOString()});
  openModal(`<div class="evid"><button class="settings-close" aria-label="Close">×</button><h3>${t('gr.title')}</h3><p class="sub">${t('gr.sub')}</p>${gapRequestHTML(gr)}
    <div class="acts"><button class="btn sec" id="grCancel">${t('pol.cancel')}</button><button class="btn primary" id="grSend">${t('gr.send')}</button></div></div>`,m=>{
    m.querySelector('.settings-close').onclick=m.querySelector('#grCancel').onclick=closeModal;
    m.querySelector('#grSend').onclick=()=>{S.gapRequest=gr;closeModal();addLog({tool:'match_financing',tier:1,args:{gap_request:gr.request_id},status:'ok',summary:`gap_request ${gr.request_id} sent: need ${gr.need_date}, peak ${Math.round(gr.peak_gap)}`});
      toast(t('gr.sent',{id:gr.request_id}));if(after)after(gr)};
  });
}
// Health of the forecast model from the feedback loop (phase H); insufficient_sample until a previous forecast can be reconciled.
function modelHealthNow(){return (typeof FEEDBACK!=='undefined'&&FEEDBACK.health(S.firm))||'insufficient_sample'}

/* ===== UC02 Shortfall tab (SRS 2.8.1, 2.8.3–2.8.5, Table 3-1): information bar, scenario and horizon selectors, Cash0 banner,
   overview, weekly forecast with an expandable daily table, daily chart with reserve lines and the Optimistic–Conservative band,
   scenario comparison, shortfall episodes, two-week blocks and the financing ranking. TH and the matrix cell always use Base. ===== */
const SC_KEYS=['base','optimistic','conservative','stress_7','continuing_sales'];
const lvLabel=l=>l==='na'||l==='unknown'?t('lv.na'):t('lv.'+l);
const srcName=k=>thrSrcName(k);
// Colour of one shortfall episode = the worst daily level inside it (SRS 2.8.11.4), with the configured Rmin.
function episodeLevel(c,e){const r=RMIN();return worstLevel(c.days.slice(e.i0,e.i1+1).map(([,v])=>alertLevel(v,c.buffer,r)))}
function uc02HeaderHTML(u,c){
  const sc=S.case,sm=u.summary[sc],b=u.summary.base,R=u.reserves,snap=DATA.snaps[S.firm],fr=freshness(snap);
  const scope=t('gap.scope',{s:(snap.sales||[]).filter(x=>x.open).length,p:(snap.purchases||[]).filter(x=>x.open).length,pl:(snap.planned||[]).length});
  const opts=SC_KEYS.map(k=>`<option value="${k}" ${k===sc?'selected':''}>${t('sc.'+k)}</option>`).join('');
  const wk=Array.from({length:CFG.tv2.horizonWeeks},(_,i)=>`<option value="${i+1}" ${i+1===u.weeks?'selected':''}>${i+1}</option>`).join('');
  const bar=`<div class="uc-src uc2-bar" data-wid="uc2bar"><div class="uc-src-l"><span><b>${esc(FIRMS[S.firm].name)}</b> · ${t('gap.asof',{d:fd(u.as_of)})} · ${t('gap.period',{a:fd(u.start),b:fd(u.end),w:u.weeks})} · ${t('gap.mode.'+(sc==='continuing_sales'?'cont':'runoff'))}</span>
     <span class="runst st-${u.status}">${t('run.'+u.status)}</span><span>${scope}</span><span class="fr fr-${fr.level}"><i class="lv-sw" aria-hidden="true"></i>${t('fresh.'+fr.level,{h:CFG.erp.freshMaxHours})}</span></div>
    <div class="uc-ctl"><label>${t('gap.scenario')}<select id="scSel">${opts}</select></label><label>${t('gap.weeks')}<select id="wkSel">${wk}</select></label>
     <button class="btn sec sm" type="button" id="cash0Btn">${t('c0.open')}</button><button class="btn primary sm" type="button" id="grBtn">${u.th.th==='TH03'?t('gr.idle'):t('gr.open')}</button></div>
    ${sc==='continuing_sales'?`<p class="uc-note warn">${t('gap.cont.note')}</p>`:''}${sc!=='base'?`<p class="uc-note">${t('gap.base.note')}</p>`:''}</div>`;
  const banner=u.cash0.status!=='confirmed'?`<div class="callout warn c0b" data-wid="cash0"><span>⚠</span><div><b>${t('c0.banner.t')}</b> ${t('c0.banner',{v:u.cash0.value==null?'—':money(u.cash0.value),need:b.need_rtarget==null?'—':money(b.need_rtarget)})}
     <div style="margin-top:8px"><button class="btn primary sm" type="button" id="cash0Btn2">${t('c0.open')}</button></div></div></div>`:'';
  if(u.status==='invalid_data')return bar+banner+`<div class="callout red"><span>⛔</span><div><b>${t('run.invalid.t')}</b> ${u.status_codes.invalid.map(x=>t('code.'+x)).join(' ')}</div></div>`;
  const tile=(lb,v,sub,cls='')=>`<div class="ls-tile ${cls}"><span>${lb}</span><b class="num">${v}</b><small>${sub}</small></div>`;
  const ov=u.overall,cell=u.matrix.cell;
  const tiles=`<div class="ls-tiles uc2-tiles" data-wid="uc2tiles">
    ${tile(t('ov.level'),`<span class="lv-pill lv-${ov==='unknown'?'na':ov}" data-lv="${ov}"><i class="lv-sw lv-${ov==='unknown'?'na':ov}" aria-hidden="true"></i>${lvLabel(ov)}</span>`,t('ov.level.sub'))}
    ${tile(t('ov.min'),money(sm.min),t('ov.min.sub',{d:fd(sm.min_date),s:t('sc.'+sc)}))}
    ${tile(t('ov.first'),sm.first_below_rtarget?fd(sm.first_below_rtarget):t('ov.none'),t('ov.first.sub',{z:sm.first_negative?fd(sm.first_negative):t('ov.none')}))}
    ${tile(t('ov.need'),sm.need_rtarget==null?'—':money(sm.need_rtarget),t('ov.need.sub',{z:money(sm.need_zero),c:u.cash0.value==null?'—':money(u.cash0.value)}))}
    ${tile(t('ov.peak'),money(sm.peak_buffer),t('ov.peak.sub',{z:money(sm.peak_zero),d:sm.peak_buffer_date?fd(sm.peak_buffer_date):'—'}))}
    ${tile(t('ov.th'),u.th.th==='unknown'?t('ov.unknown'):t('th.'+u.th.th),`${u.th.reference?t('th.ref')+' · ':''}${cell?t('ov.cell',{c:cell,n:M_EN[cell]}):t('ov.notrouted')}`)}</div>
   <p class="uc2-res">${t('res.line',{rmin:money(R.rmin),rt:money(R.rtarget),rup:money(R.rupper),s1:srcName(R.src.rmin),s2:srcName(R.src.rtarget),s3:srcName(R.src.rupper)})}${R.annualised&&R.src.rtarget==='verified_reference'?' '+t('res.annual'):''}</p>`;
  return bar+banner+tiles;
}
// Comparison of the five scenarios of the same run (UC02.4); nothing is recalculated.
function scenarioTableHTML(u){
  const rows=SC_KEYS.map(k=>{const s=u.summary[k];return `<tr class="${k===S.case?'on':''}"><td><b>${t('sc.'+k)}</b>${k==='continuing_sales'?`<small>${t('gap.cont.short')}</small>`:''}</td><td>${t('gap.mode.'+(k==='continuing_sales'?'cont':'runoff'))}</td>
    <td class="num ${s.min<0?'neg':''}">${money(s.min)}</td><td class="num">${fd(s.min_date)}</td><td><span class="lv-tag" style="--lvc:${LV[s.overall==='unknown'?'na':s.overall].color}"><i class="lv-sw lv-${s.overall}" aria-hidden="true"></i>${lvLabel(s.overall)}</span></td>
    <td class="num">${s.need_rtarget==null?'—':money(s.need_rtarget)}</td><td><small>${t('basis.'+k)}</small></td></tr>`}).join('');
  return `<div class="table-wrap"><table class="dtable sc-cmp"><thead><tr><th>${t('gap.scenario')}</th><th>${t('cmp.mode')}</th><th class="num">${t('cmp.min')}</th><th class="num">${t('cmp.date')}</th><th>${t('cmp.level')}</th><th class="num">${t('ov.need')}</th><th>${t('cmp.basis')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function blocksHTML(u){
  const b=u.blocks;if(!b.list.length)return '';
  const it=x=>`<li class="blk b-${x.status}"><span class="blk-k">${t('blk.n',{k:x.k})}</span><span>${fds(x.start)}–${fds(x.end)}</span><b>${t('blk.'+x.status)}</b>${x.severity?`<span class="lv-tag" style="--lvc:${LV[x.severity].color}"><i class="lv-sw lv-${x.severity}"></i>${lvLabel(x.severity)}</span>`:''}<span class="num">${t('blk.min',{v:money(x.min),d:fds(x.min_date)})}</span>${x.gap?`<span class="num neg">${t('blk.gap',{v:money(x.gap)})}</span>`:''}${x.excess?`<span class="num">${t('blk.ex',{v:money(x.excess)})}</span>`:''}</li>`;
  return `<div class="card blks" data-wid="blocks"><div class="card-head"><div><h3>${t('blk.title')}</h3><p>${t('blk.sub')}</p></div></div>
    ${b.persistent?`<div class="callout warn"><span>⏳</span><div><b>${t('blk.persist')}</b> ${t('blk.persist.sub',{a:fd(b.persistent.from),b:fd(b.persistent.to),n:b.persistent.blocks,d:fd(b.persistent.need_date),g:money(b.persistent.peak_gap)})}</div></div>`:''}
    <ol class="blk-list">${b.display.map(it).join('')}</ol></div>`;
}
function dailyTableHTML(c){
  const r=RMIN(),o=c.fc.scenarios[S.case],ds=o.days.slice(0,c.days.length);
  return `<div class="table-wrap dt-daily"><table class="dtable"><thead><tr><th>${t('col.date')}</th><th class="num">${t('col.opening')}</th><th class="num">${t('col.in')}</th><th class="num">${t('col.out')}</th><th class="num">${t('col.closing')}</th><th>${t('cmp.level')}</th></tr></thead><tbody>
    ${ds.map(x=>{const l=alertLevel(x.close,c.buffer,r);return `<tr><td class="num">${fd(x.d)}</td><td class="num">${mm(x.open)}</td><td class="num">${x.in?mm(x.in):'–'}</td><td class="num">${x.out?mm(x.out):'–'}</td><td class="num ${x.close<0?'neg':''}">${mm(x.close)}</td><td><span class="lv-tag" style="--lvc:${LV[l].color}"><i class="lv-sw lv-${l}"></i>${lvLabel(l)}</span></td></tr>`}).join('')}</tbody></table></div>`;
}
function renderGap(){
  const c=C(),p=$('#pane-gap'),u=uc02(),M=weeklyModel(c),big=largestGap(),asOf=dn(c.as_of),H=u.weeks;
  const ov=!!(S.last&&S.overlay&&!EP.none),weeklyOnly=u.weekly_only,sumIn=M.W.reduce((a,x)=>a+x.inn,0),sumOut=M.W.reduce((a,x)=>a+x.out,0),minB=Math.min(...M.W.map(x=>x.bal)),minW=M.W.find(x=>x.bal===minB);
  const head=uc02HeaderHTML(u,c);
  if(u.status==='invalid_data'){p.innerHTML=head;bindGapHeader(p);return}
  const scName=t('sc.'+S.case);
  const forecast=dashSec(1,'var(--lc-color-data-cash)',`${H}-week cash forecast`,`Cash in, cash out and week-end balance vs Rtarget · ${scName}`,`<div class="card fcc" data-wid="flow"><div class="card-head"><div><h3>Weekly cash flow</h3><p>${scName} · VND million · as of ${fd(c.as_of)}${c.est?' · estimated from your file':''}${EP.none?'':` · weeks of gap ${EP.k} outlined`}</p></div><button class="btn sec sm" data-csv="1" type="button">⤓ Export CSV</button></div>
   <div class="fcw"><div class="fcs"><div class="fst"><span class="dot" style="background:var(--lc-color-data-cash)"></span><b class="num">${money(c.cash0??openingCash(c))}</b><small>Cash at cut-off (${t('c0.st.'+u.cash0.status)})</small></div>
    <div class="fst"><b class="num pos">+${money(sumIn)}</b><small>Expected cash in</small><b class="num neg" style="margin-top:8px">−${money(sumOut)}</b><small>Expected cash out</small></div>
    <div class="fst"><b class="num ${minB<c.buffer?'neg':''}">${money(minB)}</b><small>Lowest week-end, week ${minW.w}</small></div></div>
    <div class="chartbox fch">${flowChartSVG(c,M,EP)}</div></div>
   <div class="legend"><span><i style="background:var(--lc-color-status-success-bg);border:1px solid var(--lc-color-status-success)"></i>Cash in</span><span><i style="background:var(--lc-color-status-error-bg);border:1px solid var(--lc-color-status-error)"></i>Cash out</span><span><i class="ln" style="background:var(--lc-color-data-cash)"></i>Week-end balance (dot = alert level)</span><span><i class="ds"></i>Rtarget ${money(c.buffer)}</span>${EP.none?'':`<span><i class="gapwk-sw"></i>Weeks of gap ${EP.k}</span>`}</div>
   ${alertLegendHTML()}
   ${flowTableHTML(c,M,EP)}
   <p class="lv-note">Week columns are coloured by the week-end balance; the “Lowest in week” row is coloured by the worst day of the week.${weeklyOnly?' '+t('gap.weekly'):''}</p>
   ${weeklyOnly?'':`<button class="btn sec sm" type="button" id="dailyBtn" aria-expanded="${!!S.showDaily}">${S.showDaily?t('gap.daily.hide'):t('gap.daily.show')}</button>${S.showDaily?dailyTableHTML(c):''}`}</div>`);
  const daily=dashSec(2,'var(--lc-color-status-error)','Daily cash balance','Every gap below Rtarget is shaded; each dot shows that day’s alert level; Rmin, Rtarget and Rupper lines; Optimistic–Conservative band',weeklyOnly?`<div class="card"><div class="empty">${t('gap.weekly')}</div></div>`
    :`<div class="card hov" data-wid="daily"><div class="card-head"><div><h3>Daily balance and gaps</h3><p>VND million · ${scName}</p></div>
      <label class="legend" style="cursor:pointer;user-select:none;${S.last&&!EP.none?'':'display:none'}" id="ovLbl"><input type="checkbox" id="ovChk" ${S.overlay?'checked':''} style="accent-color:var(--lc-color-status-success)"> Show latest scenario</label></div>
    <div class="chartbox" id="gapChart"></div>
    <div class="legend" style="margin-top:8px"><span><i class="ln" style="background:var(--lc-color-data-cash)"></i>${scName}</span>${ov?'<span><i class="ln" style="background:var(--lc-color-status-success)"></i>After levers</span>':''}<span><i class="band-sw"></i>${t('chart.band')}</span><span><i class="ds"></i>Rtarget ${money(c.buffer)}</span><span><i class="ds rmin"></i>Rmin ${money(u.reserves.rmin)}</span><span><i class="ds rup"></i>Rupper ${money(u.reserves.rupper)}</span><span><i style="background:color-mix(in srgb,var(--lc-color-alert-red-mark) 30%,transparent);border:1px dashed var(--lc-color-status-error)"></i>Gap (selected gap is darker)</span></div>
    ${alertLegendHTML()}<h4 class="sub-h">${t('cmp.title')}</h4>${scenarioTableHTML(u)}</div>`);
  const foot=`<div class="foot-note">${t('gap.foot',{n:(uc01()||{}).N||c.N})} Aged stock and goods held for subcontracting are excluded from collateral; financed receivables are not counted as receivables. Interest, fees and advance rates come from the synthetic finance_catalogue; EAC is indicative only. ${DISC}</div>`;
  const stuck=(()=>{const d=uc01();return `<p class="stuck">${t('stuck.line',{ar:money(d.metrics.total_overdue_ar),inv:money(d.profiles.stuck_inventory)})}</p>`})();
  if(!EPS.length){
    p.innerHTML=head+forecast+daily+`<div class="card" style="margin-top:14px"><div class="empty"><b>No cash shortfall in the ${H}-week forecast (${scName}), so there is nothing to simulate.</b></div></div>`+blocksHTML(u)+stuck+foot;
  }else{
    const dl=dn(EP.start)-asOf,rq='Rank the financing options that fit this cause.',t3=S.stage>=3?tv3For(EP):null;
    const card=e=>{const lv=episodeLevel(c,e),rec=e.censored?null:c.days[e.i1+1];return `<button class="ep gap-lv lv-${lv} ${EP.k===e.k?'on':''}" data-ep="${e.k}" data-lv="${lv}" aria-pressed="${EP.k===e.k}"><div class="ep-tags"><span class="lv-tag" style="--lvc:${LV[lv].color}"><i class="lv-sw lv-${lv}" aria-hidden="true"></i>${t('ep.alert',{l:lvLabel(lv)})}</span>${big&&big.k===e.k?'<span class="status blue">Largest gap</span>':''}${e.censored?`<span class="status gray">${t('ep.open')}</span>`:''}</div><div class="k">Gap ${e.k}</div><div class="a num">${mm(e.peak)}</div><div class="d">${fds(e.start)}${e.start!==e.end?' – '+fds(e.end):''} · ${t('ep.days',{n:e.i1-e.i0+1})} · lowest ${money(e.cashMin)} on ${fds(e.peakDay)}</div><div class="d">${rec?t('ep.recovery',{d:fds(rec[0])}):t('ep.notended')}</div></button>`};
    const gaps=dashSec(3,'var(--lc-color-status-error)','Cash gaps',`Gap = a run of consecutive days with balance below Rtarget ${money(c.buffer)} (${scName}). The colour is the worst daily alert level inside the gap. Pick a gap to see its weeks, KPIs and financing ranking.`,`<div class="eps">${EPS.map(card).join('')}</div>
  <div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:14px">
    <div class="card kpi k2"><div class="t">Peak shortfall · gap ${EP.k}</div><div class="v num">${mm(EP.peak)}</div><div class="f">vs Rtarget</div></div>
    <div class="card kpi"><div class="t">Cash needed on</div><div class="v num">${fds(EP.start)}</div><div class="f">${dl} days from the cut-off</div></div>
    <div class="card kpi k3"><div class="t">Lowest balance</div><div class="v num">${money(EP.cashMin)}</div><div class="f">on ${fds(EP.peakDay)}</div></div>
    <div class="card kpi k4"><div class="t">Gap ends</div><div class="v num">${fds(EP.end)}</div><div class="f">${EP.censored?'not recovered within the period':'recovered'}</div></div>
  </div><div class="card cfcard" data-wid="factors"><div class="card-head"><div><h3>${t('cf.title',{k:EP.k})}</h3><p>${t('cf.sub')}</p></div></div>${factorsHTML(gapFactors(EP))}</div>${blocksHTML(u)}${stuck}`);
    const rank=dashSec(4,'var(--lc-color-action-primary)',`Financing ranking · gap ${EP.k}`,'Tier (fully covers and funds in time), then cost relative to the shortfall',
      !t3?`<div class="callout"><span>ℹ</span><div>The ranking appears after the financing step of the conversation.<div style="margin-top:8px"><button class="btn primary sm" type="button" data-ask="${esc(rq)}">${esc(rq)} →</button></div></div></div>`
      :`<div class="card"><div class="card-head"><div><h3>Financing ranking · gap ${EP.k}</h3><p>${CAT.length} products in the synthetic catalogue · loan period ${t3.inputs.t_loan} days · inventory collateral ${money(t3.inputs.V)}</p></div><span class="status amber"><i></i>provisional</span></div>${t3.ranked.length?rankTable(t3):'<div class="empty">No product fits this gap.</div>'}</div>`);
    p.innerHTML=head+forecast+daily+gaps+rank+foot;
  }
  if(!weeklyOnly){
    const band=['optimistic','conservative'].map(k=>DATA.cases[S.firm+'|'+k].days.slice(0,c.days.length).map(d=>d[1]));
    cashChart($('#gapChart',p),{path:(ov?S.last.res:BASE).path,buf:c.buffer,rmin:u.reserves.rmin,rup:u.reserves.rupper,band,ep:EP,eps:EPS,scen:ov});
  }
  const chk=$('#ovChk',p);chk&&chk.addEventListener('change',e=>{S.overlay=e.target.checked;renderGap()});
  $$('[data-csv]',p).forEach(b=>b.onclick=()=>exportFlowCSV(c,M));window._csvCtx=()=>exportFlowCSV(c,M);
  $$('[data-ask]',p).forEach(b=>b.onclick=()=>sendChat(b.dataset.ask));
  const db=$('#dailyBtn',p);db&&(db.onclick=()=>{S.showDaily=!S.showDaily;renderGap()});
  bindGapHeader(p);
  setTimeout(redrawCharts,480);
  $$('[data-ep]',p).forEach(b=>b.addEventListener('click',()=>{selectGap(+b.dataset.ep);renderGap();renderDemoChips()}));
  $$('[data-try]',p).forEach(b=>b.addEventListener('click',()=>{const [inv,prod]=b.dataset.try.split('|');S.lev=freshLev();S.lev.l4_on=1;S.lev.inv_id=inv;S.lev.prod=prod;setTab('whatif');runNow('Finance '+inv+' via '+prod)}));
}
function bindGapHeader(p){
  const ss=$('#scSel',p);ss&&(ss.onchange=()=>setScenario(ss.value));
  const ws=$('#wkSel',p);ws&&(ws.onchange=()=>setWeeks(+ws.value));
  $$('#cash0Btn,#cash0Btn2',p).forEach(b=>b.onclick=openCash0Form);
  const gb=$('#grBtn',p);gb&&(gb.onclick=()=>openGapRequest(()=>renderGap()));
}
// The scenario selector changes the displayed scenario only; the chat, the stage and TH (Base) stay as they are.
function setScenario(sc){if(!SC_KEYS.includes(sc))return;S.case=sc;S.epIdx=0;const c=C();if(c.defk)S.epIdx=c.defk-1;derive();S.lev=freshLev();S.last=null;for(const k in TV3_CACHE)delete TV3_CACHE[k];refreshTab();renderDemoChips()}
function setWeeks(h){S.weeks=Math.min(CFG.tv2.horizonWeeks,Math.max(1,h|0));S.epIdx=0;const c=C();if(c&&c.defk)S.epIdx=c.defk-1;derive();S.lev=freshLev();S.last=null;for(const k in TV3_CACHE)delete TV3_CACHE[k];refreshTab();renderDemoChips()}
// Cash0 and reserve-level form (UC02.3). Saving creates a configuration version (owner_policy); earlier results become stale.
function essentialDailySpend(){
  const fc=DATA.forecasts[S.firm],ess=new Set(['payroll','tax','rent','debt_service']);
  const out=fc.scenarios.base.events.filter(e=>e.dir==='OUT'&&e.scope==='in_horizon'&&(ess.has(e.cat)||e.essential));
  return out.reduce((a,e)=>a+e.amt,0)/fc.days;
}
function openCash0Form(){
  const f=S.firm,snap=DATA.snaps[f],p=POLICY.get(f),u=uc02(),R=u.reserves,ref=R.reference,daily=essentialDailySpend();
  const sups=[...new Set((snap.purchases||[]).map(x=>x.supplier))],essSel=new Set(p.essential_suppliers||snap.firm.essential_suppliers||[]);
  const v=x=>x==null?'':Math.round(x);
  openModal(`<form class="evid c0f" id="c0Form" novalidate><button class="settings-close" type="button" aria-label="Close">×</button><h3>${t('c0.title')}</h3><p class="sub">${t('c0.sub',{v:esc(POLICY.versionId(f))})}</p>
   <div class="pol-form">
    <label>${t('c0.total')}<input id="c0Total" inputmode="numeric" value="${v(p.cash0?p.cash0.total:u.cash0.total)}"></label>
    <label>${t('c0.restricted')}<input id="c0Restr" inputmode="numeric" value="${v(p.cash0?p.cash0.restricted:0)}"></label>
    <fieldset class="wide c0m"><legend>${t('c0.method')}</legend>${['industry','critical_days','direct'].map(m=>`<label><input type="radio" name="c0m" value="${m}" ${(p.reserve&&p.reserve.method||'direct')===m?'checked':''}> ${t('c0.m.'+m)}</label>`).join('')}</fieldset>
    <label>Rmin<input id="c0Rmin" inputmode="numeric" value="${v(R.rmin)}"></label><label>Rtarget<input id="c0Rt" inputmode="numeric" value="${v(R.rtarget)}"></label><label>Rupper<input id="c0Rup" inputmode="numeric" value="${v(R.rupper)}"></label>
    <label>${t('c0.basis')}<select id="c0Basis"><option value="net">net</option><option value="gross">gross</option></select></label>
    <label>${t('c0.vat')}<input id="c0Vat" inputmode="decimal" placeholder="${t('c0.vat.ph')}" value="${p.vat_rate!=null?p.vat_rate*100:''}"></label>
    <fieldset class="wide c0s"><legend>${t('c0.ess')}</legend>${sups.map(s=>`<label><input type="checkbox" value="${esc(s)}" ${essSel.has(s)?'checked':''}> ${esc(s)}</label>`).join('')}</fieldset>
    <label class="wide">${t('pol.reason')}<textarea id="c0Reason" rows="2" maxlength="500" placeholder="${t('c0.reason.ph')}">${esc((p.reserve&&p.reserve.reason)||'')}</textarea></label></div>
   <p class="c0-ref">${ref?t('c0.ref',{a:money(ref.rmin),b:money(ref.rtarget),c:money(ref.rupper),m:(uc01()||{model:{model:'FOB'}}).model.model}):''} ${t('c0.days',{d:money(daily)})}</p>
   <div id="c0Warn"></div><p id="c0Err" class="settings-error"></p>
   <div class="acts"><button class="btn sec" type="button" id="c0Cancel">${t('pol.cancel')}</button><button class="btn primary" type="submit" id="c0Save">${t('c0.save')}</button></div></form>`,m=>{
    const q=s=>m.querySelector(s),num=s=>{const x=q(s).value.trim();return x===''?null:parseNum(x)};
    q('#c0Basis').value=p.amount_basis||snap.config.amount_basis||'net';
    q('.settings-close').onclick=q('#c0Cancel').onclick=closeModal;
    m.querySelectorAll('input[name=c0m]').forEach(r=>r.onchange=()=>{const md=r.value;
      if(md==='industry'&&ref){q('#c0Rmin').value=v(ref.rmin);q('#c0Rt').value=v(ref.rtarget);q('#c0Rup').value=v(ref.rupper)}
      if(md==='critical_days'){q('#c0Rmin').value=v(daily*CFG.liq.criticalDays.rmin[0]);q('#c0Rt').value=v(daily*CFG.liq.criticalDays.rtarget[0]);q('#c0Rup').value=v(daily*CFG.liq.criticalDays.rtarget[0]*CFG.liq.rupperDefaultRatio)}
      check()});
    const check=()=>{const w=[],rt=num('#c0Rt'),rmin=num('#c0Rmin');
      if(ref&&rt!=null&&rt<ref.rmin)w.push(t('c0.w.p25'));if(rmin!=null&&rmin<15*daily)w.push(t('c0.w.days',{d:money(15*daily)}));
      q('#c0Warn').innerHTML=w.map(x=>`<div class="callout warn"><span>⚠</span><div>${x}</div></div>`).join('')};
    m.querySelectorAll('#c0Rmin,#c0Rt,#c0Rup').forEach(i=>i.oninput=check);check();
    q('#c0Form').onsubmit=e=>{e.preventDefault();const tot=num('#c0Total'),res=num('#c0Restr')??0,rmin=num('#c0Rmin'),rt=num('#c0Rt'),rup=num('#c0Rup'),vat=num('#c0Vat'),reason=q('#c0Reason').value.trim(),err=q('#c0Err');
      // Validation (UC02.3 step 5): amounts ≥ 0, restricted ≤ total, 0 ≤ Rmin ≤ Rtarget < Rupper, reason 10–500 characters when the levels differ from the reference.
      if(tot!=null&&!(tot>=0)){err.textContent=t('c0.e.total');return}if(!(res>=0)||(tot!=null&&res>tot)){err.textContent=t('c0.e.restr');return}
      if(!(rt>0)){err.textContent=t('c0.e.rt');return}if(!(rmin>=0&&rmin<=rt)){err.textContent=t('c0.e.rmin');return}if(!(rup>rt)){err.textContent=t('c0.e.rup');return}
      if(vat!=null&&!(vat>=0&&vat<100)){err.textContent=t('c0.e.vat');return}
      const differs=!ref||[rmin,rt,rup].some((x,i)=>Math.abs(x-[ref.rmin,ref.rtarget,ref.rupper][i])>1);
      if((differs&&reason.length<10)||reason.length>500){err.textContent=t('pol.reason.err');return}
      const md=(m.querySelector('input[name=c0m]:checked')||{}).value||'direct',ess=[...m.querySelectorAll('.c0s input:checked')].map(x=>x.value);
      POLICY.set(f,{cash0:tot==null?null:{total:tot,restricted:res,confirmed:true},reserve:{method:md,rmin,rtarget:rt,rupper:rup,reason},amount_basis:q('#c0Basis').value,vat_rate:vat==null?null:vat/100,essential_suppliers:ess},reason);
      closeModal();policyCases(f);S.gapRequest=null;S.epIdx=0;const c=C();if(c&&c.defk)S.epIdx=c.defk-1;derive();S.lev=freshLev();S.last=null;for(const k in TV3_CACHE)delete TV3_CACHE[k];
      toast(t('c0.saved',{v:POLICY.versionId(f)}));refreshTab();renderDemoChips()};
  });
}
function rankTable(t3){
  const G=t3.inputs.gap,maxC=Math.max(...t3.ranked.map(r=>r.cpg));
  const rows=t3.ranked.map((r,i)=>{const cat=CAT.find(c=>c.id===r.product_id),isInv=INV_PRODUCTS.includes(r.product_id)&&r.invoice_id!=='–';
    return `<tr class="${i===0?'top1':''}"><td><span class="rank">${r.rank}</span></td><td><b>${r.product_id}</b> · ${esc(cat.provider)}<small>${TYPE_VN[cat.type]||cat.type}${cat.recourse==='Y'?' · with recourse':''}</small></td><td>${isInv?`<span class="num">${r.invoice_id}</span>`:'<span class="neu">–</span>'}</td><td><span class="tier t${r.tier}">${r.tier===0?'0 · fully covered':'1 · partly covered'}</span></td><td class="num">${mm(r.cash)}</td><td class="num">${nf(r.cost/1e6,2)}M</td><td class="num">${nf(r.cpg*100,2)}%<div class="bar"><span style="width:${Math.max(6,r.cpg/maxC*100)}%"></span></div></td><td class="num">${r.days} days</td><td class="num ${r.gap_rem>0?'neg':'pos'}">${r.gap_rem>0?mm(r.gap_rem):'0'}</td><td class="num">${nf(r.ccc_after,1)}</td><td>${isInv?`<button class="btn sec sm" data-try="${r.invoice_id}|${r.product_id}">Try →</button>`:'<span class="subtle" style="font-size:10.5px;color:var(--muted)">Not an invoice lever</span>'}</td></tr>`}).join('');
  const rej=t3.rejected.length?`<div style="margin-top:12px"><div class="legend" style="margin-bottom:6px"><b style="color:var(--ink2)">Excluded (${t3.rejected.length})</b></div>${t3.rejected.map(r=>`<span class="status gray" style="margin:0 6px 6px 0" title="${r.reason}">${r.product_id} · ${REJ[r.reason]||r.reason}</span>`).join('')}</div>`:'';
  return `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Option</th><th>Invoice</th><th>Tier</th><th>Cash received</th><th>Cost</th><th>Cost / shortfall</th><th>Funding</th><th>Remaining gap</th><th>CCC after</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${rej}`;
}


const shortN=s=>String(s||'').replace(/^Large Exporter /,'').replace(/^Garment Factory (subcontract )?/,'').replace(/^Beta Fabric Distributor.*/,'Beta').replace(/^Overseas fabric mill /,'').slice(0,30);
function describeLev(l){
  const a=[];
  if(l.l1_on)a.push(`Collect early ${shortN(l.cust)} ${l.X} days`);
  if(l.l2_on)a.push(`Extend ${shortN(l.supp)} ${l.Y} days`);
  if(l.l3_on)a.push(`Cut inventory ${String(l.line).slice(0,22)} ${l.Z}%`);
  if(l.l4_on)a.push(`Finance ${l.inv_id} via ${l.prod}`);
  return a.join(' + ')||'No lever switched on';
}
const anyOn=l=>l.l1_on||l.l2_on||l.l3_on||l.l4_on;
function leverArgs(l){
  const a={};
  if(l.l1_on)a.early_collection={customer:l.cust,days:l.X};
  if(l.l2_on)a.extend_payables={supplier:l.supp,days:l.Y};
  if(l.l3_on)a.reduce_inventory={product_line:l.line,pct:l.Z};
  if(l.l4_on)a.finance_invoice={invoice_id:l.inv_id,product_id:l.prod};
  return a;
}
function statusOf(l,res){
  if(!anyOn(l))return {k:'na',t:'No lever on'};
  const bad=[];
  if(l.l1_on&&!res.valid.l1)bad.push('Early collection: the customer has no valid invoice or the days are out of range');
  if(l.l2_on&&!res.valid.l2)bad.push('Extend payables: the supplier has no valid payable or the days are out of range');
  if(l.l3_on&&!res.valid.l3)bad.push('Cut inventory: the line is not owned (e.g. goods held for subcontracting)');
  if(l.l4_on&&res.status4==='BLOCKED')bad.push('Financing: '+res.reason);
  if(bad.length)return {k:'bl',t:'Blocked · '+bad[0],all:bad};
  return res.gap_epi<1?{k:'yes',t:'Fully covers the gap'}:{k:'no',t:'Not enough · still short '+mm(res.gap_epi)};
}
function runSim(l){return simulate(C(),EP,l,CAT)}
function commit(l,res,label,{fromChat}={}){
  const st=statusOf(l,res);
  S.last={lev:{...l},res,label,st,ts:Date.now(),id:'RUN-'+String(++S.runN).padStart(3,'0')};
  addLog({tool:'simulate_scenario',tier:1,args:{firm_id:S.firm,levers:leverArgs(l)},status:st.k==='bl'?'blocked':'ok',summary:`${label} → CCC ${nf(BASE.ccc,1)}→${nf(res.ccc,1)}; short ${mm(BASE.gap_epi)}→${mm(res.gap_epi)}; cost ${nf(res.cost/1e6,2)}M`+(st.k==='bl'?' · '+st.all[0]:''),reason:st.k==='bl'?st.all[0]:''});
  $('#ovLbl')&&($('#ovLbl').style.display='');
  return S.last;
}
let wiTimer;
function scheduleRun(){const r=$('#wiRes');r&&r.classList.add('loading');clearTimeout(wiTimer);wiTimer=setTimeout(()=>runNow(),420)}
function runNow(label){
  const l={...S.lev},res=runSim(l);commit(l,res,label||describeLev(l));
  if(S.tab==='whatif'){renderWhatIf(true)}
  return S.last;
}
function renderWhatIf(keep){
  const c=C(),p=$('#pane-whatif'),L=S.lev;
  if(EP.none){p.innerHTML=`<div class="card"><div class="empty"><div class="big">⟳</div><b>No shortfall to simulate</b><br>No cash shortfall in the 13-week forecast, so there is nothing to simulate.</div></div>`;return}
  if(!keep||!$('#wiRes')){buildWI(p)}
  syncWI();
}
function buildWI(p){
  const c=C(),L=S.lev;
  const buyers=topBy(c.sales.filter(s=>s[3]===1),s=>s[1],s=>s[2]),sup=topBy(c.pur.filter(s=>s[2]===1),s=>s[0],s=>s[1]);
  const invs=candInvoices();
  const lever=(id,ic,t,sub,body)=>`<div class="lever" id="lv-${id}"><div class="lever-h"><div class="ic">${ic}</div><div><strong>${t}</strong><small>${sub}</small></div><button class="sw" role="switch" aria-checked="false" aria-label="Switch on ${t}" data-sw="${id}"></button></div><div class="lever-b">${body}</div></div>`;
  const slider=(id,min,max,val,unit,tk)=>`<div class="f"><label>${unit.l}<span class="val num" id="${id}V">${val}${unit.u}</span></label><input type="range" id="${id}" min="${min}" max="${max}" value="${val}" aria-label="${unit.l}"><div class="ticks">${tk.map(t=>`<span>${t}</span>`).join('')}</div></div>`;
  p.innerHTML=`
  <div class="card-head" style="margin-bottom:8px"><div><h3>Test levers · gap ${EP.k}</h3><p>Drag the sliders; results recompute on a copy of the data; original data is unchanged. Cash needed ${fd(EP.start)} · peak shortfall ${mm(EP.peak)}.</p></div><button class="btn sec sm" id="wiReset">↺ Reset</button></div>
  <div class="presets" id="presets"><span class="legend" style="margin-right:2px">Sample scenarios:</span>${SCEN().map(s=>`<button data-sc="${s.id}" title="${esc(s.name)}">${s.id.split('-')[1]} · ${esc(s.name.length>30?s.name.slice(0,29)+'…':s.name)}</button>`).join('')}</div>
  <div class="wi">
   <div>
    ${lever('l1','⇢','Early collection','Move one customer collection earlier by X days',`
      <div class="f"><label for="cust">Customer</label><select class="sel" id="cust">${buyers.map(b=>`<option value="${esc(b.k)}">${esc(b.k)} · ${mm(b.v)}</option>`).join('')}</select></div>
      ${slider('X',0,30,L.X,{l:'Early collection',u:' days'},['0','10','20','30'])}<div class="hint" id="h1"></div>`)}
    ${lever('l2','⇠','Extend payables','Delay one supplier payment by Y days',`
      <div class="f"><label for="supp">Supplier</label><select class="sel" id="supp">${sup.map(b=>`<option value="${esc(b.k)}">${esc(b.k)} · ${mm(b.v)}</option>`).join('')}</select></div>
      ${slider('Y',0,30,L.Y,{l:'Extend terms',u:' days'},['0','10','20','30'])}<div class="hint" id="h2"></div>`)}
    ${lever('l3','▤','Cut inventory','Sell down Z% of one owned inventory line',`
      <div class="f"><label for="line">Inventory line</label><select class="sel" id="line">${c.inv.map(x=>`<option value="${esc(x.name)}" ${x.own>0?'':'disabled'}>${esc(x.name)} · ${mm(x.own)}${x.excl?' (subcontracted goods)':x.slow?' · aged':''}${/in transit/.test(x.name)?' · heading to port':''}</option>`).join('')}</select></div>
      ${slider('Z',0,50,L.Z,{l:'Cut inventory',u:'%'},['0','15','30','50'])}<div class="hint" id="h3"></div>`)}
    ${lever('l4','◈','Finance one invoice','Receive cash on the cash-needed date, repay when the customer pays',`
      <div class="f"><label for="inv_id">Invoice</label><select class="sel" id="inv_id">${invs.map(e=>`<option value="${e[0]}">${e[0]} · ${esc(shortN(e[3]))} · ${mm(e[4])} · expected ${fds(e[5])}</option>`).join('')}</select></div>
      <div class="f"><label for="prod">Catalogue product</label><select class="sel" id="prod">${CAT.filter(x=>INV_PRODUCTS.includes(x.id)).map(x=>`<option value="${x.id}">${x.id} · ${x.provider} · ${TYPE_VN[x.type]}</option>`).join('')}</select></div><div class="hint" id="h4"></div>`)}
   </div>
   <div>
    <div class="result shim" id="wiRes">
      <div class="lb" id="rLbl">SIMULATION RESULT · TIER 1</div><h3 id="rHead">—</h3>
      <div style="margin:-4px 0 12px"><span class="cover na" id="rCover">No lever on</span></div>
      <div class="bigs"><div class="big"><span>Remaining gap</span><strong class="num" id="bGap">0</strong><small id="bGapS"></small></div><div class="big"><span>New gap days</span><strong class="num" id="bNew">0</strong><small>outside the gap under review</small></div><div class="big"><span>Total cost</span><strong class="num" id="bCost">0</strong><small>financing + inventory sale discount</small></div></div>
    </div>
    <div class="card" style="margin-top:12px"><div class="card-head" style="margin-bottom:6px"><div><h3>Cash line before / after</h3><p>VND million · hover for each day</p></div></div><div class="chartbox" id="wiChart"></div>
      <div class="legend" style="margin-top:6px"><span><i class="ln" style="background:var(--lc-color-data-historical)"></i>Base</span><span><i class="ln" style="background:var(--lc-color-status-success)"></i>After levers</span><span><i class="ds"></i>Buffer</span></div></div>
    <div class="card" style="margin-top:12px"><div class="table-wrap" style="border:0"><table class="dtable" style="min-width:0"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody id="mTbl"></tbody></table></div></div>
    <div class="row" style="margin-top:12px"><button class="btn sec" id="wiSave">＋ Save to compare</button><button class="btn primary" id="wiDraft">✎ Create draft</button><span class="subtle" style="font-size:11px;color:var(--muted);align-self:center">Drafts are only created, never sent.</span></div>
    <div id="cmpBox"></div>
   </div>
  </div>
  <div class="foot-note">Slider bounds (X ≤ 30, Y ≤ 30, Z ≤ 50%) are proposals. Early collection and extended terms assume zero cost; inventory reduction is discounted ${C()&&S.lev?S.lev.hair:10}% and cash arrives after ${S.lev?S.lev.lag:14} days. TV4 formula · runs in the browser, matched on 17/17 scenarios against the Python calculation.</div>`;
  bindWI(p);
}
function bindWI(p){
  if(p._bound)return;p._bound=1;
  const L=()=>S.lev;
  p.addEventListener('click',e=>{
    const sw=e.target.closest('[data-sw]');if(sw){const id=sw.dataset.sw;L()['l'+id.slice(1)+'_on']=L()['l'+id.slice(1)+'_on']?0:1;syncWI();scheduleRun();return}
    const pr=e.target.closest('[data-sc]');if(pr){loadScenario(SC.find(s=>s.id===pr.dataset.sc),true);return}
    if(e.target.closest('#wiReset')){S.lev=freshLev();syncWI();runNow();toast('Levers reset');return}
    if(e.target.closest('#wiSave')){saveCmp();return}
    if(e.target.closest('#wiDraft')){draftFromLast();return}
    const rm=e.target.closest('[data-rm]');if(rm){S.cmp.splice(+rm.dataset.rm,1);renderCmp();return}
  });
  p.addEventListener('input',e=>{const t=e.target;if(t.type==='range'){L()[t.id]=+t.value;$('#'+t.id+'V').textContent=t.value+(t.id==='Z'?'%':' days');fillRange(t);syncWI(true);scheduleRun()}});
  p.addEventListener('change',e=>{const t=e.target;if(t.tagName==='SELECT'){L()[t.id]=t.value;syncWI(true);scheduleRun()}});
}
const fillRange=t=>t.style.setProperty('--p',((t.value-t.min)/(t.max-t.min)*100)+'%');
function syncWI(soft){
  const L=S.lev,c=C(),p=$('#pane-whatif');if(!p.querySelector('#wiRes'))return;
  ['l1','l2','l3','l4'].forEach(k=>{const el=$('#lv-'+k),on=!!L[k+'_on'];el.classList.toggle('on',on);$('.sw',el).setAttribute('aria-checked',on)});
  ['cust','supp','line','inv_id','prod'].forEach(id=>{const s=$('#'+id);if(s&&s.value!==L[id])s.value=L[id]});
  [['X'],['Y'],['Z']].forEach(([id])=>{const r=$('#'+id);r.value=L[id];$('#'+id+'V').textContent=L[id]+(id==='Z'?'%':' days');fillRange(r)});
  $$('#presets button').forEach(b=>b.classList.remove('on'));
  const res=S.last&&S.last.lev&&JSON.stringify(S.last.lev)===JSON.stringify(L)?S.last.res:runSim(L);
  const st=statusOf(L,res);

  const asOf=dn(c.as_of);
  const near=(kind,partner,f)=>c.ev.filter(e=>e[2]===kind&&e[3]===partner&&dn(e[5])>asOf).map(e=>({...f(e)}));
  const h1=$('#h1'),h2=$('#h2'),h3=$('#h3'),h4=$('#h4');
  const rc=c.sales.filter(s=>s[1]===L.cust&&s[3]===1).reduce((a,s)=>a+s[2],0),ev1=c.ev.filter(e=>e[2]==='invoice_receipt'&&e[3]===L.cust&&dn(e[5])>asOf).sort((a,b)=>dn(a[5])-dn(b[5]))[0];
  h1.innerHTML=ev1?`Nearest invoice ${fds(ev1[5])} → ${fds(iso(Math.max(asOf+1,dn(ev1[5])-L.X)))} · period revenue ${mm(rc)} → receivables drop ${mm(rc/c.N*L.X)}`:'This customer has no invoice awaiting collection.';
  const ps=c.pur.filter(s=>s[0]===L.supp&&s[2]===1).reduce((a,s)=>a+s[1],0),ev2=c.ev.filter(e=>e[2]==='supplier_payment'&&e[3]===L.supp&&dn(e[5])>asOf).sort((a,b)=>dn(a[5])-dn(b[5]))[0];
  h2.innerHTML=ev2?`Nearest payment ${fds(ev2[5])} → ${fds(iso(dn(ev2[5])+L.Y))} · payables rise ${mm(ps/c.N*L.Y)}`:'This supplier has no upcoming payment.';
  h3.className='hint'+(L.l3_on&&!res.valid.l3?' err':'');h3.innerHTML=L.l3_on&&!res.valid.l3?'This inventory line is not owned, so the lever is blocked.':`Releases ${mm(res.freed)} · cash arrives ${mm(res.rel)} on ${fds(iso(asOf+L.lag))} (after discount ${L.hair}%)`;
  h4.className='hint '+(L.l4_on?(res.status4==='OK'?'ok':'err'):'');
  h4.innerHTML=L.l4_on?(res.status4==='OK'?`Eligible: receive ${mm(res.financed.Cc)} on ${fds(EP.start)} · cost ${nf(res.financed.fin/1e6,2)}M`:'Blocked: '+res.reason):'Pick an invoice collected after the cash-needed date and a product whose conditions fit.';
  ['l1','l2','l3','l4'].forEach(k=>$('#lv-'+k).classList.toggle('bad',!!L[k+'_on']&&(k==='l4'?res.status4==='BLOCKED':!res.valid[k])));

  const hasLast=S.last&&JSON.stringify(S.last.lev)===JSON.stringify(L),label=describeLev(L);
  $('#rHead').textContent=label;
  const cv=$('#rCover');cv.className='cover '+st.k;cv.textContent=(st.k==='yes'?'✓ ':st.k==='no'?'◐ ':st.k==='bl'?'⛔ ':'')+st.t;
  animNum($('#bGap'),res.gap_epi/1e6,v=>nf(v,1)+'M');$('#bGapS').textContent='before: '+mm(BASE.gap_epi);
  animNum($('#bNew'),res.newDays,v=>Math.round(v)+' days');
  animNum($('#bCost'),res.cost/1e6,v=>nf(v,2)+'M');
  const rows=[['DSO',BASE.dso,res.dso],['DIO',BASE.dio,res.dio],['DPO',BASE.dpo,res.dpo],['CCC',BASE.ccc,res.ccc]];
  $('#mTbl').innerHTML=rows.map(([n,a,b])=>{const d=b-a,good=n==='DPO'?d>0:d<0,cls=Math.abs(d)<.005?'neu':(good?'pos':'neg');return `<tr><td><b>${n}</b></td><td class="num">${nf(a,1)} days</td><td class="num"><b>${nf(b,1)} days</b></td><td class="num ${cls}">${Math.abs(d)<.005?'—':(d>0?'+':'−')+nf(Math.abs(d),1)}</td></tr>`}).join('');
  cashChart($('#wiChart'),{path:res.path,buf:c.buffer,ep:EP,scen:anyOn(L)&&st.k!=='na'});
  const r=$('#wiRes');if(!soft||hasLast)r.classList.remove('loading');
  $('#wiDraft').disabled=!anyOn(L)||st.k==='bl'&&!res.l.some(Boolean);
  renderCmp();
}
function loadScenario(sc,run){
  const l={...offLev(),inv_id:defaultInvoice(),...sc.lev};S.lev=l;
  if($('#pane-whatif').querySelector('#wiRes')){syncWI();$$('#presets button').forEach(b=>b.classList.toggle('on',b.dataset.sc===sc.id))}
  if(run){const r=runNow(sc.name);if(S.tab==='whatif')$$('#presets button').forEach(b=>b.classList.toggle('on',b.dataset.sc===sc.id));return r}
}
function saveCmp(){
  const l={...S.lev};if(!anyOn(l)){toast('Switch on at least one lever');return}
  if(S.cmp.length>=4){toast('Compare at most 4 scenarios');return}
  const res=runSim(l);if(S.cmp.some(x=>JSON.stringify(x.lev)===JSON.stringify(l))){toast('This scenario is already in the comparison');return}
  S.cmp.push({label:describeLev(l),lev:l,res,st:statusOf(l,res)});renderCmp();toast('Scenario saved to comparison');
}
function renderCmp(){
  const b=$('#cmpBox');if(!b)return;
  if(!S.cmp.length){b.innerHTML='';return}
  const ok=S.cmp.filter(x=>x.st.k==='yes'),best=ok.length?ok.reduce((a,x)=>x.res.cost<a.res.cost?x:a):null;
  b.innerHTML=`<div class="cmp-h"><h3 style="margin:0;font-size:14px">Compare scenarios</h3><span class="subtle" style="font-size:11px;color:var(--muted)">${S.cmp.length}/4 · the cheapest that fully covers is highlighted</span></div>
  <div class="table-wrap"><table class="dtable" style="min-width:0"><thead><tr><th>Metric</th>${S.cmp.map((x,i)=>`<th class="${x===best?'cmpcol best':''}">${x===best?'★ ':''}Scenario ${i+1} <button data-rm="${i}" aria-label="Delete" style="color:var(--lc-color-text-muted)">✕</button></th>`).join('')}</tr></thead><tbody>
  <tr><td>Content</td>${S.cmp.map(x=>`<td style="text-align:right;font-size:11px;white-space:normal;min-width:120px">${esc(x.label)}</td>`).join('')}</tr>
  <tr><td>CCC after</td>${S.cmp.map(x=>`<td class="num ${x===best?'cmpcol best':''}">${nf(x.res.ccc,1)}</td>`).join('')}</tr>
  <tr><td>Remaining gap</td>${S.cmp.map(x=>`<td class="num ${x.res.gap_epi<1?'pos':'neg'}">${mm(x.res.gap_epi)}</td>`).join('')}</tr>
  <tr><td>New gap days</td>${S.cmp.map(x=>`<td class="num">${x.res.newDays}</td>`).join('')}</tr>
  <tr><td>Cost</td>${S.cmp.map(x=>`<td class="num">${nf(x.res.cost/1e6,2)}M</td>`).join('')}</tr>
  <tr><td>Verdict</td>${S.cmp.map(x=>`<td><span class="status ${x.st.k==='yes'?'green':x.st.k==='no'?'amber':x.st.k==='bl'?'red':'gray'}">${x.st.k==='yes'?'Covers':x.st.k==='no'?'Not enough':x.st.k==='bl'?'Blocked':'—'}</span></td>`).join('')}</tr></tbody></table></div>`;
}


function mkDrafts(run){
  const c=C(),l=run.lev,res=run.res,asOf=dn(c.as_of),firm=FIRMS[S.firm].short,out=[];
  const impact={ccc0:BASE.ccc,ccc1:res.ccc,gap0:BASE.gap_epi,gap1:res.gap_epi,cost:res.cost};
  const sign=`\n\nBest regards,\n${firm} Finance Team\n\n${DISC}`;
  if(l.l1_on&&res.valid.l1){
    const ev=c.ev.filter(e=>e[2]==='invoice_receipt'&&e[3]===l.cust&&dn(e[5])>asOf),tot=ev.reduce((a,e)=>a+e[4],0);
    out.push({type:'payment_reminder',to:l.cust,subject:'Request for earlier settlement of open invoices',body:`Dear ${l.cust} team,\n\nWe would be grateful if you could settle the ${ev.length} open invoices listed in the attached statement (total ${enM(tot)}) ${l.X} days earlier than currently scheduled. Earlier settlement would help us manage our working capital in late October.\n\nPlease let us know if this is possible.`+sign,lever:'l1',args:{customer:l.cust,days_earlier:l.X},impact});
  }
  if(l.l2_on&&res.valid.l2){
    const ev=c.ev.filter(e=>e[2]==='supplier_payment'&&e[3]===l.supp&&dn(e[5])>asOf).sort((a,b)=>dn(a[5])-dn(b[5])).slice(0,4);
    out.push({type:'term_extension_request',to:l.supp,subject:`Request for ${l.Y}-day extension of payment terms`,body:`Dear ${l.supp} team,\n\nDue to a short-term timing difference in our collections, we kindly request a ${l.Y}-day extension on the following payments:\n${ev.map(e=>`  - ${enDate(e[5])}: ${enM(e[4])}`).join('\n')}\n\nWe value our relationship and will settle promptly on the revised dates.`+sign,lever:'l2',args:{supplier:l.supp,extra_days:l.Y},impact});
  }
  if(l.l4_on&&res.status4==='OK'){
    const cat=CAT.find(x=>x.id===l.prod),e=c.ev.find(x=>x[0]===l.inv_id&&x[1]==='IN'),f=res.financed;
    out.push({type:'financing_application',to:`${cat.provider} · ${l.prod}`,subject:`${TYPE_VN[cat.type]} application – invoice ${l.inv_id}`,body:`To the ${cat.provider} desk,\n\nWe would like to apply for ${cat.type.replace('_',' ')} (product ${l.prod}) on invoice ${l.inv_id}.\n\n  Debtor:             ${e[3]}\n  Invoice amount:     ${enM(e[4])}\n  Expected receipt:   ${enDate(e[5])}\n  Funds needed on:    ${enDate(EP.start)}\n  Indicative advance: ${enM(f.Cc)}\n  Indicative cost:    ${enM(f.fin)}\n\nThis application is a simulated draft and has not been submitted.`+sign,lever:'l4',args:{invoice_id:l.inv_id,product_id:l.prod},impact});
  }
  return out;
}
function createDrafts(run,{silent}={}){
  const made=[],ds=mkDrafts(run);
  ds.forEach(d=>{
    const dup=S.drafts.find(x=>x.firm===S.firm&&x.run===run.id&&x.type===d.type);if(dup)return;
    const o={...d,id:`D-${S.firm}-${String(++S.draftN).padStart(3,'0')}`,firm:S.firm,run:run.id,label:run.label,status:'pending_approval',ts:Date.now(),open:false,scId:run.scId||''};
    S.drafts.unshift(o);made.push(o);
    addLog({tool:'draft_action',tier:2,args:{action_type:d.type,details:d.args},status:'pending_approval',summary:`${o.id} · ${d.type} → ${d.to}`,draftId:o.id});
  });

  if(run.lev.l4_on&&run.res.status4==='BLOCKED'&&!S.drafts.find(x=>x.run===run.id&&x.status==='blocked')){
    const o={id:`D-${S.firm}-${String(++S.draftN).padStart(3,'0')}`,firm:S.firm,run:run.id,label:run.label,type:'financing_application',to:`${run.lev.prod}`,subject:'Financing application – blocked',body:'',args:{invoice_id:run.lev.inv_id,product_id:run.lev.prod},status:'blocked',reason:run.res.reason,ts:Date.now(),impact:null};
    S.drafts.unshift(o);made.push(o);
    addLog({tool:'draft_action',tier:2,args:{action_type:'financing_application',details:o.args},status:'blocked',summary:`${o.id} blocked · ${o.reason}`,draftId:o.id,reason:o.reason});
  }
  updatePending();
  if(!silent&&made.length)toast(`Drafted ${made.filter(x=>x.status==='pending_approval').length} drafts, awaiting your approval`);
  if(S.tab==='appr')renderAppr();
  return made;
}
function draftFromLast(){
  if(!S.last||JSON.stringify(S.last.lev)!==JSON.stringify(S.lev)){runNow()}
  const made=createDrafts(S.last);
  if(!made.length){toast('No valid lever to draft (inventory reduction is simulation only)');return}
  setTab('appr');const first=$('#pane-appr .ac');first&&first.classList.add('open');
}
function updatePending(){
  const n=S.drafts.filter(d=>d.status==='pending_approval'&&d.firm===S.firm).length,chip=$('#pendChip'),nEl=$('#pendN');
  const prev=+nEl.textContent;nEl.textContent=n;chip.classList.toggle('zero',n===0);
  if(n>prev){chip.classList.remove('bump');void chip.offsetWidth;chip.classList.add('bump')}
  const b=$('#apprBadge');b.textContent=n;b.classList.toggle('zero',n===0);const sb=$('#sideBadge');sb.textContent=n;sb.classList.toggle('zero',n===0);
}
$('#pendChip').addEventListener('click',()=>setTab('appr'));
const DT={payment_reminder:['✉','Payment reminder'],term_extension_request:['⏱','Terms extension request'],financing_application:['◈','Pre-filled financing application']};
function renderAppr(){
  const p=$('#pane-appr'),f=S.apprFilter,list=S.drafts.filter(d=>d.firm===S.firm&&(f==='all'||d.status===f||(f==='executed'&&d.status.startsWith('executed'))));
  const cnt=k=>S.drafts.filter(d=>d.firm===S.firm&&(k==='all'||d.status===k)).length;
  const pend=list.filter(d=>d.status==='pending_approval'),hist=list.filter(d=>d.status!=='pending_approval');
  p.innerHTML=`<div class="card-head"><div><h3>Approval queue</h3><p>Only here does a draft become a simulated action. Nothing is sent outside.</p></div>
  <div class="seg" id="apprSeg">${[['all','All'],['pending_approval','Pending'],['executed','Executed'],['rejected','Rejected'],['blocked','Blocked']].map(([k,t])=>`<button data-f="${k}" class="${f===k?'on':''}">${t} ${cnt(k)}</button>`).join('')}</div></div>
  ${!list.length?`<div class="card"><div class="empty"><div class="big">☑</div><b>No drafts yet${f!=='all'?' in this status':''}</b><br>Try a lever in What-if or ask Copilot to draft.<br><br><button class="btn primary" id="goWI">Open What-if →</button></div></div>`:`<div class="appr">${[...pend,...hist].map(draftCard).join('')}</div>`}
  <div class="callout" style="margin-top:14px"><span>⛨</span><div><b>Approval does not mean a real send.</b> When you press Approve, the UI only calls <code>submit_action</code> in simulation mode and writes the log (tier 3).</div></div>`;
  $$('#apprSeg button',p).forEach(b=>b.addEventListener('click',()=>{S.apprFilter=b.dataset.f;renderAppr()}));
  const g=$('#goWI');g&&g.addEventListener('click',()=>setTab('whatif'));
  p.onclick=e=>{
    const card=e.target.closest('.ac');if(!card)return;const d=S.drafts.find(x=>x.id===card.dataset.id);
    if(e.target.closest('[data-tg]')){d.open=!d.open;card.classList.toggle('open',d.open);e.target.closest('[data-tg]').textContent=d.open?'Collapse':'Show full text';return}
    if(e.target.closest('[data-ap]'))approveDlg(d);
    if(e.target.closest('[data-rj]'))rejectDlg(d);
  };
}
function draftCard(d){
  const [ic,tn]=DT[d.type],st={pending_approval:['amber','Pending'],executed:['green','Executed (simulated)'],rejected:['gray','Rejected'],blocked:['red','Blocked']}[d.status];
  const im=d.impact,pend=d.status==='pending_approval';
  return `<div class="ac ${d.status==='executed'?'executed':d.status} ${d.open?'open':''}" data-id="${d.id}">
   <div class="ac-h"><div class="ac-ic" style="${d.status==='blocked'?'background:var(--red-bg)':d.status==='executed'?'background:var(--green-bg)':''}">${ic}</div><div><h4>${tn} · ${esc(d.to)}</h4><div class="sub">${d.id} · ${esc(d.label)} · tier 2 · ${new Date(d.ts).toLocaleTimeString('en-GB')}</div></div><span class="status ${st[0]}"><i></i>${st[1]}</span></div>
   ${d.status==='blocked'?`<div class="callout red" style="margin-top:12px"><span>⛔</span><div><b>Does not enter the queue.</b> ${esc(d.reason)}. This draft has no Approve button.</div></div>`:`
   <div class="impact"><div class="imp"><span>CCC</span><strong class="num">${nf(im.ccc0,1)} → ${nf(im.ccc1,1)}</strong></div><div class="imp"><span>Remaining gap</span><strong class="num">${mm(im.gap0)} → ${mm(im.gap1)}</strong></div><div class="imp"><span>Estimated cost</span><strong class="num">${nf(im.cost/1e6,2)}M</strong></div><div class="imp"><span>Lever</span><strong>${LV_NAME[d.lever]}</strong></div></div>
   <pre class="mail">Subject: ${esc(d.subject)}\n\n${esc(d.body)}</pre>
   <div class="ac-f">${pend?`<button class="btn ok" data-ap>✓ Approve</button><button class="btn danger" data-rj>Rejected</button>`:''}<button class="btn sec sm" data-tg>${d.open?'Collapse':'Show full text'}</button><span class="grow"></span>
   ${d.status==='executed'?`<span class="done-line"><span class="tick"><svg viewBox="0 0 12 12"><path d="M2 6.5l2.6 2.6L10 3.4"/></svg></span>submit_action · simulated · ${new Date(d.decidedAt).toLocaleTimeString('en-GB')}</span>`:''}
   ${d.status==='rejected'?`<span class="done-line">Reason: ${esc(d.reasonTxt)}</span>`:''}</div>`}
  </div>`;
}
function approveDlg(d){
  openModal(`<h3>Approve draft ${d.id}?</h3><p>${DT[d.type][1]} sent to <b>${esc(d.to)}</b>. This is a simulation: no email, application or money is really sent.</p>
  <div class="impact" style="grid-template-columns:1fr 1fr;margin:0"><div class="imp"><span>CCC</span><strong class="num">${nf(d.impact.ccc0,1)} → ${nf(d.impact.ccc1,1)}</strong></div><div class="imp"><span>Remaining gap</span><strong class="num">${mm(d.impact.gap0)} → ${mm(d.impact.gap1)}</strong></div></div>
  <label class="chk"><input type="checkbox" id="ackChk"> I understand this is a simulation and take responsibility for this approval decision.</label>
  <div class="acts"><button class="btn sec" id="mCancel">Cancel</button><button class="btn ok" id="mOk" disabled>Confirm approval</button></div>`,m=>{
    $('#ackChk',m).onchange=e=>$('#mOk',m).disabled=!e.target.checked;$('#mCancel',m).onclick=closeModal;
    $('#mOk',m).onclick=()=>{closeModal();d.status='executed';d.decidedAt=Date.now();
      addLog({tool:'submit_action',tier:3,args:{draft_id:d.id,mode:'simulated'},status:'executed (simulated)',summary:`${d.id} approved, simulated execution`,draftId:d.id});
      updatePending();renderAppr();toast('Approved: executed (simulated)');botNote(`Recorded <b>${d.id}</b> as <b>executed (simulated)</b>. Nothing was really sent.`,{suggest:nextSuggest()});};
  });
}
function rejectDlg(d){
  const R=['Cost too high','Customer or supplier does not agree','Want to try another option','Data is inaccurate'];
  openModal(`<h3>Reject draft ${d.id}</h3><p>The reason is written to the log, and Copilot will suggest another option.</p><div class="reasons">${R.map(r=>`<button type="button">${r}</button>`).join('')}</div><textarea id="rjTxt" placeholder="Reason for rejection (required)"></textarea><div class="acts"><button class="btn sec" id="mCancel">Cancel</button><button class="btn danger" id="mOk" disabled>Confirm rejection</button></div>`,m=>{
    const t=$('#rjTxt',m),ok=$('#mOk',m);t.oninput=()=>ok.disabled=t.value.trim().length<3;
    $$('.reasons button',m).forEach(b=>b.onclick=()=>{$$('.reasons button',m).forEach(x=>x.classList.remove('on'));b.classList.add('on');t.value=b.textContent;t.oninput()});
    $('#mCancel',m).onclick=closeModal;
    ok.onclick=()=>{closeModal();d.status='rejected';d.reasonTxt=t.value.trim();d.decidedAt=Date.now();
      addLog({tool:'reject_draft',tier:2,args:{draft_id:d.id,reason:d.reasonTxt},status:'rejected',summary:`${d.id} rejected · ${d.reasonTxt}`,draftId:d.id,reason:d.reasonTxt});
      updatePending();renderAppr();toast('Draft rejected');suggestAlternative(d)};
  });
}


const ST_CLS={ok:'blue','pending_approval':'amber','executed (simulated)':'green',rejected:'gray',blocked:'red'};
function addLog(e){
  const o={n:++S.seq,ts:Date.now(),firm:S.firm,...e};S.log.unshift(o);

}


let msgs=null;
const scroll=()=>{msgs.scrollTop=msgs.scrollHeight};
const norm=s=>String(s).toLowerCase().replace(/[?.!,]/g,'').replace(/\s+/g,' ').trim();
function userMsg(t){const e=document.createElement('div');e.className='msg user';e.textContent=t;msgs.appendChild(e);scroll()}
function typingEl(){const e=document.createElement('div');e.className='msg bot';e.innerHTML='<div class="typing"><i></i><i></i><i></i></div>';msgs.appendChild(e);scroll();return e}
function typeHTML(el,html){
  el.innerHTML=html;if(reduceMotion)return Promise.resolve();
  const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];while(w.nextNode())nodes.push(w.currentNode);
  const full=nodes.map(n=>n.nodeValue);nodes.forEach(n=>n.nodeValue='');const total=full.reduce((a,s)=>a+s.length,0);
  return new Promise(res=>{const t0=performance.now();const step=t=>{const shown=Math.min(total,Math.floor((t-t0)*.85));let rem=shown;nodes.forEach((n,i)=>{const k=Math.max(0,Math.min(full[i].length,rem));n.nodeValue=full[i].slice(0,k);rem-=k});scroll();shown<total?requestAnimationFrame(step):res()};requestAnimationFrame(step)});
}
function newBot(){const e=document.createElement('div');e.className='msg bot';msgs.appendChild(e);return e}
async function botNote(html,{suggest}={}){const b=newBot();await say(b,html);suggestRow(b,suggest);return b}
async function say(bot,html,cls=''){const b=document.createElement('div');b.className='bubble '+cls;bot.appendChild(b);await typeHTML(b,html);return b}
async function toolCall(bot,name,tier,args,work,{ms=650}={}){
  const el=document.createElement('div');el.className='toolchip';
  el.innerHTML=`<button type="button" aria-expanded="false"><span>⚙</span><code>${name}</code><span class="tl t${tier}">Tier ${tier}</span><span class="st"><i class="spin"></i>running…</span></button><pre>${esc(JSON.stringify({tool:name,tier,args},null,2))}</pre>`;
  bot.appendChild(el);scroll();
  $('button',el).onclick=()=>{el.classList.toggle('open');$('button',el).setAttribute('aria-expanded',el.classList.contains('open'))};
  await sleep(reduceMotion?0:ms+Math.random()*250);
  const out=work();const bad=out&&out.bad;
  $('.st',el).innerHTML=bad?'<span class="bad">⛔ blocked</span>':'<span class="ok">✓ ok</span>';scroll();return out;
}
function suggestRow(bot,items){
  if(!items||!items.length)return;const d=document.createElement('div');d.className='suggest';
  items.forEach(it=>{const b=document.createElement('button');b.type='button';b.textContent=typeof it==='string'?it:it.t;b.onclick=()=>typeof it==='string'?sendChat(it):it.f();d.appendChild(b)});bot.appendChild(d);scroll();
}

const STOP=new Set(['the','what','if','we','can','you','for','from','and','with','more','how','about','than','this','that','our','my','please','collect','early','extend','terms','days','day','pay','payment','payments','cut','sell','down','stock','inventory','finance','financing','invoice','line','customer','supplier','by','to','of','in','on','is','are','do','does','get','ask','try','let','me','us','a','an','it','its','at','as','any','not','too','longer','earlier','faster','delay','defer','reduce','clear','slow','items','item']);
function pick(text,names){
  const toks=text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=2&&!STOP.has(w)&&!/^\d+$/.test(w));
  let best=null,bs=0;names.forEach(n=>{const nl=n.toLowerCase();const sc=toks.filter(w=>nl.split(/[^\p{L}\p{N}]+/u).includes(w)||(w.length>=4&&nl.includes(w))).length;if(sc>bs){bs=sc;best=n}});
  return bs>0?best:null;
}
function parseLev(t){
  const c=C(),low=t.toLowerCase(),L={...offLev(),inv_id:defaultInvoice()},carry=S.last?S.last.lev:null,miss=[];
  const days=(low.match(/(\d+)\s*(?:days?|d\b)/)||[])[1],pct=(low.match(/(\d+)\s*%/)||[])[1];
  const t1=/collect[^.?!]*early|early[^.?!]*(collect|pay)|pay[^.?!]*early|bring forward/.test(low),t2=/extend|defer|postpone|delay (our |the )?pay|stretch|longer terms/.test(low),t3=/inventory|sell (down|off)|cut stock|reduce stock|liquidat|clear (the )?stock/.test(low),t4=/financ|factoring|advance|s-f0\d-\d+|\b(fac|rf|dd)-\d{3}\b/.test(low);
  if(!(t1||t2||t3||t4))return null;
  const buyers=topBy(c.sales.filter(s=>s[3]===1),s=>s[1],s=>s[2]).map(x=>x.k),sup=topBy(c.pur.filter(s=>s[2]===1),s=>s[0],s=>s[1]).map(x=>x.k),lines=c.inv.map(x=>x.name);
  if(t1){L.l1_on=1;L.X=days?+days:7;const m=pick(t,buyers)||(carry&&carry.l1_on?carry.cust:null);if(m)L.cust=m;else miss.push({what:'customer',opts:buyers})}
  if(t2){L.l2_on=1;L.Y=days?+days:7;const m=pick(t,sup)||(carry&&carry.l2_on?carry.supp:null);if(m)L.supp=m;else miss.push({what:'supplier',opts:sup})}
  if(t3){L.l3_on=1;L.Z=pct?+pct:25;const m=pick(t,lines);if(m)L.line=m;else miss.push({what:'product line',opts:lines.filter((n,i)=>c.inv[i].own>0)})}
  if(t4){L.l4_on=1;const inv=(t.match(/[S]-F0\d-\d{4}/)||[])[0],pr=(t.match(/\b(?:FAC|RF|DD)-\d{3}\b/)||[])[0];if(inv)L.inv_id=inv;if(pr)L.prod=pr;if(!pr&&carry&&carry.l4_on)L.prod=carry.prod}
  if(!t1&&!t2&&!t3&&!t4)return null;
  return {lev:L,miss};
}
function routeBase(raw){
  const t=raw.trim(),low=t.toLowerCase();
  const ex=SCEN().find(s=>norm(s.ask)===norm(t));if(ex)return {type:'sc',sc:ex};
  const noInv=t.replace(/\b[SP]-F0\d-\d+/g,'');
  const other=(noInv.match(/\bF0\d\b/g)||[]).find(f=>f!==S.firm);if(other)return {type:'block',kind:'firm',other};
  const prods=(noInv.match(/\b[A-Z]{2,4}-\d{1,3}\b/g)||[]).filter(x=>!CAT.some(c=>c.id===x));
  if(prods.length||/bank\s*z\b|outside (the )?catalogue|not in (the )?catalogue/i.test(t))return {type:'block',kind:'product',ref:prods[0]||'Bank Z'};
  if(/(send|submit|transfer|file)[^.?!]*(now|immediately|right away|directly)|(no need|without|skip|bypass)[^.?!]*approval/i.test(t))return {type:'block',kind:'send'};
  if(/(draft|prepare|write|create)[^.?!]*(draft|proposal)|\bdraft\b/.test(low))return {type:'draft'};
  if(/rank|reject|catalogue/.test(low)&&!/collect|early|extend|inventory|s-f0/.test(low))return {type:'rank'};
  const pl=parseLev(t);if(pl)return pl.miss.length?{type:'clarify',miss:pl.miss[0]}:{type:'custom',lev:pl.lev};
  if(/concentrat|which customer|receivable|who owes/.test(low))return {type:'conc'};
  if(/liquidity|overview|diagnos|situation|health/.test(low))return {type:'liq'};
  if(/stuck|bottleneck|tied up|locked up/.test(low))return {type:'liq',focus:'stuck'};
  if(/short|gap|cash ?flow|13.?week|risk|largest|biggest|deficit|cause|root/.test(low))return {type:'gap'};
  if(/ccc|dso|dio|dpo|working capital|cycle/.test(low))return {type:'ccc'};
  if(/rank|catalogue|option|compar|financ|reject/.test(low))return {type:'rank'};
  return {type:'help'};
}
// "gap N" anywhere in the question selects that gap first, then the question is answered for it.
function route(raw){const r=routeBase(raw),m=String(raw).match(/gap\s*(\d+)/i);if(m)r.gap=+m[1];return r}
let busy=false;
async function sendChat(text){
  text=(text||'').trim();if(!text||busy)return;busy=true;$('#sendBtn').disabled=true;$('#chatInput').value='';

  {const ch=chipList().find(x=>norm(x.ask)===norm(text));if(ch)S.done.add(ch.id)}userMsg(text);$('#demoChips').hidden=true;const ty=typingEl();await sleep(reduceMotion?0:420);ty.remove();
  try{await respond(route(text),text)}catch(err){console.error(err);await botNote('There was an error processing the request. Please try again.')}
  busy=false;$('#sendBtn').disabled=false;renderDemoChips();$('#chatInput').focus({preventScroll:true});
}
let pendingChatFiles=[];
function renderChatFiles(){const box=$('#chatFileChips');box.hidden=!pendingChatFiles.length;if(!pendingChatFiles.length){box.innerHTML='';return}box.innerHTML=`<div class="upload-chip-list">${pendingChatFiles.map((f,i)=>`<span class="upload-chip">${esc(f.name)} <button type="button" data-remove-chat-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('')}<button type="button" class="btn sec sm" id="uploadChatFiles">Upload</button></div>`;$$('[data-remove-chat-file]',box).forEach(b=>b.onclick=()=>{pendingChatFiles.splice(+b.dataset.removeChatFile,1);renderChatFiles()});$('#uploadChatFiles').onclick=uploadComposerFiles}
$('#attachBtn').onclick=()=>$('#chatFile').click();
$('#chatFile').onchange=e=>{pendingChatFiles.push(...e.target.files);renderChatFiles();e.target.value=''};
async function uploadComposerFiles(){if(!pendingChatFiles.length)return;const files=pendingChatFiles.slice(),added=await acceptFiles(files),recognized=[],documents=[];for(const rec of added){if(rec.kind==='document'){documents.push(rec);continue}try{const text=await fileText(rec.blob);if(detectedFileType(text))recognized.push(rec)}catch(e){toast(e.message||`Could not read ${rec.name}`)}}pendingChatFiles=[];renderChatFiles();const unknown=added.filter(x=>x.kind==='table'&&!recognized.some(y=>y.id===x.id)).length;const sample=['F01','F02','F03'].includes(S.firm);addLog({tool:'upload_files',tier:1,args:{files:added.map(x=>x.name)},status:'ok',summary:`Received ${recognized.length} recognised table file${recognized.length===1?'':'s'}, ${documents.length} reference document${documents.length===1?'':'s'}, ${unknown} unrecognised`});const b=newBot();await say(b,`<p>Received <b>${recognized.length}</b> recognised table file${recognized.length===1?'':'s'}, <b>${documents.length}</b> reference document${documents.length===1?'':'s'} and <b>${unknown}</b> unrecognised file${unknown===1?'':'s'}.</p><p>Files are only used after you review them and save a snapshot. ${sample?'The selected company is sample data, so review will create a new business instead of changing it.':''}</p>`);const a=document.createElement('div');a.className='rcact';a.innerHTML='<button type="button" class="btn primary sm">Review and import</button>';a.querySelector('button').onclick=()=>openReviewImport(recognized.map(x=>x.id));b.appendChild(a);scroll()}
$('#chatForm').addEventListener('submit',async e=>{e.preventDefault();const text=$('#chatInput').value.trim();if(pendingChatFiles.length)await uploadComposerFiles();if(text)sendChat(text)});

async function respond(r,text){
  const bot=newBot(),c=C();
  if(r.type==='block'){
    const msgs2={firm:[`This session can only view data for <b>${S.firm}</b>. The request to access <b>${r.other}</b> was blocked.`,'get_firm_data',0,{firm_id:r.other}],
      product:[`<b>${esc(r.ref)}</b> is not in the synthetic catalogue, so no figures are given. Products you can use: ${CAT.map(x=>x.id).join(', ')}.`,'lookup_product',1,{product_id:r.ref}],
      send:[`I only <b>draft proposals</b> (tier 2). Sending or filing only runs at tier 3 and only after you click <b>Approve</b> in the Approvals tab.`,'submit_action',3,{mode:'direct',approved:false}]}[r.kind];
    await toolCall(bot,msgs2[1],msgs2[2],msgs2[3],()=>({bad:true}),{ms:380});
    addLog({tool:msgs2[1],tier:msgs2[2],args:msgs2[3],status:'blocked',summary:msgs2[0].replace(/<[^>]+>/g,''),reason:r.kind});
    await say(bot,msgs2[0],'warn');suggestRow(bot,nextSuggest());return;
  }
  if(r.type==='clarify'){
    await say(bot,`Which <b>${r.miss.what}</b> do you want to apply this to? I did not recognise a name in your question.`);
    suggestRow(bot,r.miss.opts.slice(0,4).map(n=>({t:n,f:()=>sendChat((text+' '+n))})));return;
  }
  if(r.gap!=null&&r.type!=='block'){
    if(!EPS.some(e=>e.k===r.gap)){await say(bot,EPS.length?`There is no gap ${r.gap}. The 13-week forecast has ${EPS.length} gap${EPS.length>1?'s':''}: ${EPS.map(e=>'gap '+e.k).join(', ')}.`:'The 13-week forecast has no cash gaps.');suggestRow(bot,nextSuggest());return}
    selectGap(r.gap);if(S.panel)renderTab();
  }
  {const need=r.type==='gap'?1:r.type==='rank'?2:['sc','custom','draft','clarify'].includes(r.type)?3:0;
   if(S.stage<need){await gateMsg(bot);return}}
  if(r.type==='sc'){await runScenarioInChat(bot,r.sc);return}
  if(r.type==='custom'){await runLevInChat(bot,r.lev,null,text);return}
  if(r.type==='draft'){await draftInChat(bot);return}
  if(r.type==='gap'){await respondCause(bot,{focus:r.gap});return}
  if(r.type==='ccc'){await respondLiq(bot,{focus:'ccc'});return}
  if(r.type==='liq'){await respondLiq(bot,{focus:r.focus});return}
  if(r.type==='conc'){await respondConc(bot);return}
  if(r.type==='rank'){await respondRank(bot,{focus:r.gap});return}
  await say(bot,`<p>I support <b>${S.firm}</b> one step at a time, each unlocking when you ask for it:</p><ul><li>Diagnose DSO, DIO, DPO and CCC.</li><li>Find cash-short weeks over 13 weeks.</li><li>Rank financing options in the synthetic catalogue.</li><li>Test levers (collect early, extend payment terms, cut inventory, finance one invoice) and draft proposals for your approval.</li></ul><p>Example: <i>“What if we collect from K1 10 days early?”</i></p>`);
  suggestRow(bot,nextSuggest());
}
async function runScenarioInChat(bot,sc){
  const l={...offLev(),inv_id:defaultInvoice(),...sc.lev};
  await runLevInChat(bot,l,sc);
}
async function runLevInChat(bot,L,sc,text){
  const label=sc?sc.name:describeLev(L);
  if(EP.none){await say(bot,'No gap to simulate. No cash shortfall in the 13-week forecast, so there is nothing to simulate.');return}
  const out=await toolCall(bot,'simulate_scenario',1,{firm_id:S.firm,levers:leverArgs(L)},()=>{
    S.lev={...L};const res=runSim(L),run=commit(L,res,label);if(sc){run.scId=sc.id;S.done.add(sc.id)}return {run,bad:run.st.k==='bl'&&!res.l.some(Boolean)};
  });
  const run=out.run,r=run.res,st=run.st;advance(4,bot);renderDemoChips();
  if(S.tab==='whatif')renderWhatIf(true);if(S.tab==='gap')renderGap();
  const note=sc&&sc.note&&sc.note.startsWith('Note:')?sc.note.slice(5).trim():'';
  if(st.k==='bl'){
    await say(bot,`<p><b class="k">A lever is blocked.</b> ${st.all.map(esc).join('; ')}.</p>${r.l.some(Boolean)?`<p>The remaining levers are still calculated: CCC ${nf(BASE.ccc,1)} → ${nf(r.ccc,1)}, shortfall now ${mm(r.gap_epi)}.</p>`:'<p>I do not calculate figures for this combination.</p>'}${r.status4==='BLOCKED'?'<p>You can drop one of the two levers and try again.</p>':''}`,'warn');
  }else{
    const cover=r.gap_epi<1;
    await say(bot,`<p>${esc(label)}: CCC <b>${nf(BASE.ccc,1)} → ${nf(r.ccc,1)} days</b>, peak shortfall <b>${mm(BASE.gap_epi)} → ${mm(r.gap_epi)}</b>, cost <b>${nf(r.cost/1e6,2)} million VND</b>${r.cost===0?' (assumes no fees)':''}. ${cover?'<b>Covers</b> of the shortfall.':'<b>Not enough</b>, still short '+mm(r.gap_epi)+'.'}</p>${r.newDays>0?`<p>Note: this creates ${r.newDays} new shortfall days outside this gap.</p>`:''}${note?`<p>${esc(note)}</p>`:''}`);
  }
  if(st.k!=='bl'||r.l.some(Boolean)){
    const card=document.createElement('div');card.className='rescard';
    card.innerHTML=`<div class="rt"><h4>${esc(label)}</h4><span class="status ${st.k==='yes'?'green':st.k==='no'?'amber':'red'}"><i></i>${st.k==='yes'?'Covers':st.k==='no'?'Not enough':'Partially blocked'}</span></div>
    <div class="rgrid"><div class="rg"><span>CCC</span><strong class="num">${nf(BASE.ccc,1)} → ${nf(r.ccc,1)}</strong><small>days</small></div><div class="rg"><span>Remaining gap</span><strong class="num ${r.gap_epi<1?'pos':'neg'}">${mm(r.gap_epi)}</strong><small>before ${mm(BASE.gap_epi)}</small></div><div class="rg"><span>Cost</span><strong class="num">${nf(r.cost/1e6,2)}M</strong><small>${r.newDays} new shortfall days</small></div></div>
    <div class="rcact"><button class="btn sec sm" data-a="wi" type="button">Open in What-if</button><button class="btn primary sm" data-a="dr" type="button">✎ Create draft</button></div>`;
    bot.appendChild(card);scroll();
    $('[data-a=wi]',card).onclick=()=>setTab('whatif');
    $('[data-a=dr]',card).onclick=async()=>{S.lev={...L};S.last=run;const b2=newBot();await draftInChat(b2,run)};
  }
  const nx=nextSuggest();
  if(sc&&sc.mode==='approve')await say(bot,'If you like this option, click <b>Create draft</b> to add it to the queue, then approve it in the Approvals tab.');
  if(sc&&sc.mode==='reject')await say(bot,'This option is costly. Try <b>Create draft</b> then <b>Rejected</b> in Approvals to see Copilot propose a new one.');
  suggestRow(bot,nx);
}
async function draftInChat(bot,run){
  run=run||S.last;
  if(!run){await say(bot,'There is no scenario to draft yet. Try a lever first, for example: <i>“Collect early from K1 7 days”</i>.');suggestRow(bot,nextSuggest());return}
  const made=await toolCall(bot,'draft_action',2,{action_type:'(based on the active levers)',scenario:run.label},()=>{const m=createDrafts(run,{silent:true});return {made:m,bad:!m.length}});
  const m=made.made;
  if(!m.length){await say(bot,'This scenario has no draft: cutting inventory is simulation only, and the other levers are not valid.','warn');return}
  const ok=m.filter(x=>x.status==='pending_approval'),bl=m.filter(x=>x.status==='blocked');
  await say(bot,`${ok.length?`<p>I have drafted <b>${ok.length} draft(s)</b>, status <b>pending_approval</b> (not sent):</p><ul>${ok.map(x=>`<li>${x.id} · ${DT[x.type][1]} → ${esc(x.to)}</li>`).join('')}</ul><p>Read the full text and click <b>Approve</b> or <b>Rejected</b> in the Approvals tab.</p>`:''}${bl.length?`<p><b class="k">Blocked:</b> ${bl.map(x=>x.id+' ('+esc(x.reason)+')').join('; ')}. This draft does not enter the queue.</p>`:''}`,bl.length&&!ok.length?'warn':'');
  suggestRow(bot,[{t:'Open Approvals →',f:()=>setTab('appr')}]);
  if(ok.length)toast('A new draft is awaiting approval')
}
function suggestAlternative(d){
  const sc=SCEN().filter(s=>s.id!==d.scId);let best=null;
  sc.forEach(s=>{const l={...offLev(),inv_id:defaultInvoice(),...s.lev},res=runSim(l),st=statusOf(l,res);if(st.k==='yes'&&(!best||res.cost<best.res.cost))best={s,l,res}});
  (async()=>{
    const b=newBot();
    if(!best){await say(b,`Noted that you rejected <b>${d.id}</b>. I could not find an alternative that fully covers the gap; try adjusting it yourself in What-if.`);return}
    await say(b,`Noted that you rejected <b>${d.id}</b> (${esc(d.reasonTxt)}). Cheapest alternative that still covers the gap: <b>${esc(best.s.name)}</b>, CCC ${nf(BASE.ccc,1)} → ${nf(best.res.ccc,1)}, cost ${nf(best.res.cost/1e6,2)} million VND.`);
    suggestRow(b,[{t:'Try in What-if',f:()=>{loadScenario(best.s,true);setTab('whatif')}},{t:'Draft this option',f:()=>{loadScenario(best.s,true);const bb=newBot();userMsg('Draft this option');draftInChat(bb,S.last)}}]);
  })();
}


SC=SC.map(s=>s.id==='F02-D'?{...s,ask:'What about financing S-F02-0094 via DD-001?'}:s);
function bootApp(){
  addLog({tool:'start_session',tier:0,args:{sandbox:true},status:'ok',summary:'Open the demo session, synthetic data as of 30 Sep 2026'});
  switchContext('F01','base',{silent:true});
  updatePending();
  requestAnimationFrame(()=>{placeInk();document.fonts&&document.fonts.ready.then(placeInk)});
}


const TASKS={
  tv1:{n:'TV1',title:'Working-capital diagnosis',tab:'dash',
    hello:s=>`How is ${s}’s liquidity today?`,
    ph:'Ask where your working capital is stuck…',
    chips:['How is my liquidity?','What is my CCC?','Which customer holds most of my receivables?']},
  tv2:{n:'TV2',title:'Cash-flow forecast',tab:'gap',
    hello:s=>`The next 13 weeks of cash for ${s}`,
    ph:'Ask about cash-short weeks, the date cash is needed…',
    chips:['Which week am I short of cash?','Which gap is the largest?']},
  tv3:{n:'TV3',title:'Financing match',tab:'gap',
    hello:s=>`Find funding for ${s}`,
    ph:'Ask about financing options, rejected products…',
    chips:['Rank financing options for the gap','Why were some products rejected?']},
  tv4:{n:'TV4',title:'What-if and drafts',tab:'whatif',
    hello:s=>`Test levers for ${s} before you decide`,
    ph:'Example: What if we collect from K1 10 days early?',
    chips:[]}
};
S.task='tv1';S.panel=false;S.user=null;
const THREADS={};
(function(){const box=$('#threads');const d=document.createElement('div');d.className='messages on';d.id='thread-flow';d.dataset.init='0';box.appendChild(d);Object.keys(TASKS).forEach(t=>{THREADS[t]=d})})();
msgs=THREADS.tv1;

function currentChips(){
  const st=S.stage|0;
  if(st>=3)return SCEN();
  if(st===2)return [{id:'f2',ask:'Rank the financing options that fit this cause.'},{id:'f2b',ask:'Why were some products rejected?'}];
  if(st===1)return [{id:'f1',ask:'Why am I short of cash? Show me the cause.'}];
  return [{id:'f0',ask:'Where is my working capital stuck?'},{id:'f0b',ask:'Which customer holds most of my receivables?'}];
}
const unlockedTask=k=>k===1||(S.stage|0)>=(k===4?3:k);
function applyStage(){
  const g=$('.tab[data-tab="gap"]'),w=$('.tab[data-tab="whatif"]');
  if(g)g.hidden=S.stage<2;if(w)w.hidden=S.stage<3;
}
function advance(n,bot){
  const previous=S.stage;S.stage=Math.max(S.stage,n);S.task='tv'+n;

  $('#chatInput').placeholder='Ask about your cash, receivables, shortfalls or financing…';
  applyStage();
  if(S.panel){if(S.tab!==TASKS[S.task].tab)setTab(TASKS[S.task].tab);else renderTab()}
}
function resetFlow(){S.stage=0;S.cause=null;S.causes={};S.gapRequest=null;S.task='tv1';$('#chatInput').placeholder='Ask about your cash, receivables, shortfalls or financing…';applyStage();if(S.panel&&(S.tab==='gap'||S.tab==='whatif'))setTab('dash')}
function userFirst(){const n=(S.user&&S.user.name||'you').trim().split(/\s+/);return n[n.length-1]}


const pWrap=$('#panelWrap');
function openPanel(){
  S.panel=true;$('#work').classList.add('panel-open');pWrap.inert=false;pWrap.setAttribute('aria-hidden','false');
  $('#panelBtn').classList.add('on');$('#panelBtn').setAttribute('aria-pressed','true');syncViewNav();
}
function closePanel(){
  S.panel=false;$('#work').classList.remove('panel-open');pWrap.inert=true;pWrap.setAttribute('aria-hidden','true');
  $('#panelBtn').classList.remove('on');$('#panelBtn').setAttribute('aria-pressed','false');syncViewNav();
}
// Main-screen navigation uses an explicit S.view state:
//   'chat' – the conversation (the detailed dashboard can open beside it on tab S.tab)
//   'data' – the Company data screen (hides the whole chat workspace)
// Every navigation item goes through showView(), so the target screen appears immediately, without a Back click.
S.view='chat';
function showView(view,{tab}={}){
  if(view==='data'){openDataScreen('files');return}
  if(!$('#dataScreen').hidden)closeDataScreen();
  S.view='chat';
  if(tab)setTab(tab);else syncViewNav();
}
function syncViewNav(){$$('[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view==='data'?S.view==='data':S.view==='chat'&&S.panel&&b.dataset.view===S.tab))}
function renderTab(){({dash:renderDash,gap:renderGap,whatif:renderWhatIf,appr:renderAppr})[S.tab]()}
function refreshTab(){if(S.panel)renderTab()}
function setTab(id){
  if(id==='data'){openDataScreen('businesses');return}
  if(!$('#dataScreen').hidden)closeDataScreen(); // the dashboard lives inside the chat workspace, so show it first
  if((id==='gap'&&S.stage<2)||(id==='whatif'&&S.stage<3))id='dash';
  S.tab=id;$$('.tab').forEach(t=>{const on=t.dataset.tab===id;t.classList.toggle('on',on);t.setAttribute('aria-selected',on)});
  $$('.tabpane').forEach(p=>p.classList.toggle('on',p.id==='pane-'+id));
  openPanel();$('#panelSub').textContent=`${S.firm} · ${FIRMS[S.firm].name}`;
  renderTab();placeInk();setTimeout(placeInk,480);
}
$('#panelClose').addEventListener('click',closePanel);
$('#panelBtn').addEventListener('click',()=>S.panel?closePanel():setTab(S.tab&&S.tab!=='appr'?S.tab:TASKS[S.task].tab));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.view;
  if(v==='data')showView('data');
  else if(S.view==='chat'&&S.panel&&S.tab===v)closePanel(); // clicking the open item again closes the panel
  else showView('chat',{tab:v});
  closeSide()}));


function openSide(){$('#app').classList.add('side-open')}
function closeSide(){$('#app').classList.remove('side-open')}
$('#menuBtn').addEventListener('click',openSide);$('#sideClose').addEventListener('click',closeSide);$('#sideScrim').addEventListener('click',closeSide);
function setTask(id,{force}={}){
  if(!TASKS[id])return;
  if(!unlockedTask(+id.slice(2))){toast('This step opens as the conversation reaches it. Ask the next question in the chat.');return}
  const same=S.task===id;S.task=id;
  Object.values(THREADS).forEach(el=>el.classList.add('on'));
  msgs=THREADS[id];
  $('#chatInput').placeholder='Ask about your cash, receivables, shortfalls or financing…';
  if(msgs.dataset.init!=='1'||force)welcome(id);
  renderDemoChips();
  if(S.panel&&!same)setTab(TASKS[id].tab);
closeSide();scroll();
}


const ci=$('#chatInput');
function grow(){ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,170)+'px'}
ci.addEventListener('input',grow);
ci.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chatForm').requestSubmit()}});
$('#chatForm').addEventListener('submit',()=>setTimeout(grow,0));


function spark(c){
  const W=320,H=64,p=4,v=c.days.map(d=>d[1]),n=v.length,mn=Math.min(...v,c.buffer),mx=Math.max(...v,c.buffer),rg=(mx-mn)||1;
  const X=i=>p+i*(W-2*p)/(n-1),Y=x=>p+(mx-x)*(H-2*p)/rg,by=Y(c.buffer);
  let red='',i=0;
  while(i<n){if(v[i]<c.buffer){let j=i;while(j+1<n&&v[j+1]<c.buffer)j++;
    let d=`M${X(i).toFixed(1)},${by.toFixed(1)}`;for(let k=i;k<=j;k++)d+=` L${X(k).toFixed(1)},${Y(v[k]).toFixed(1)}`;d+=` L${X(j).toFixed(1)},${by.toFixed(1)}Z`;red+=`<path d="${d}" fill="var(--lc-color-alert-red-mark)" fill-opacity=".22"/>`;i=j+1}else i++}
  const pts=v.map((x,k)=>X(k).toFixed(1)+','+Y(x).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="13-week cash balance vs buffer">${red}<line x1="${p}" x2="${W-p}" y1="${by.toFixed(1)}" y2="${by.toFixed(1)}" stroke="var(--lc-color-alert-orange-mark)" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/><polyline points="${pts}" fill="none" stroke="var(--lc-color-data-cash)" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function openAR(c){const open=c.sales.filter(s=>s[4]===1),tot=open.reduce((a,s)=>a+s[2],0);return {open,tot,top:topBy(open,s=>s[1],s=>s[2])}}
function liqCardHTML(){
  const c=C(),b=BASE,{tot,top}=openAR(c),tb=top[0],minPt=c.days.reduce((a,x)=>x[1]<a[1]?x:a,c.days[0]);
  const worst=EPS.length?EPS.reduce((a,e)=>e.peak>a.peak?e:a,EPS[0]):null,below=minPt[1]<c.buffer;
  const kp=(cls,t,v)=>`<div class="lk ${cls}"><span>${t}</span><strong class="num">${nf(v,1)}<small>days</small></strong></div>`;
  return `<div class="liq-h"><div><h4>Liquidity diagnosis</h4><p>${S.firm} · ${esc(FIRMS[S.firm].short)} · as of ${fd(c.as_of)}${S.case==='stress_7'?' · assuming customers pay 7 days later':''}</p></div><span class="status amber"><i></i>simulated</span></div>
  <div class="liq-k">${kp('','DSO · collection',b.dso)}${kp('','DIO · storage',b.dio)}${kp('','DPO · supplier pay',b.dpo)}${kp('hl','CCC · cash cycle',b.ccc)}</div>
  <div class="liq-b"><div class="lb"><span>Receivables</span><b class="num">${money(c.ar)}</b></div><div class="lb"><span>Owned inventory</span><b class="num">${money(c.invv)}</b></div><div class="lb"><span>Payables</span><b class="num">${money(c.ap)}</b></div></div>
  <div class="liq-s"><div class="cap"><span>13-week cash balance vs buffer ${money(c.buffer)}</span><b class="num">lowest ${money(minPt[1])} · ${fds(minPt[0])}</b></div>${spark(c)}</div>
  ${worst?`<div class="liq-note"><span>⚠</span><div><b>${EPS.length} cash gaps</b> in 13 weeks; largest shortfall <b>${mm(worst.peak)}</b>, cash needed from <b>${fd(worst.start)}</b>${worst.censored?' (not recovered within the period)':''}.</div></div>`:`<div class="liq-note ok"><span>✓</span><div><b>No cash gaps</b>: lowest balance ${money(minPt[1])} remains ${below?'':'above'} the buffer.</div></div>`}
  ${tb?`<div class="liq-note"><span>◷</span><div><b>Concentrated receivables</b>: ${esc(tb.k)} makes up ${nf(tb.v/tot*100,1)}% of open receivables (${money(tb.v)}).</div></div>`:''}`;
}
function diagCardHTML(){
  const c=C(),b=BASE,{tot,top}=openAR(c),tb=top[0];
  const kp=(cls,t,v)=>`<div class="lk ${cls}"><span>${t}</span><strong class="num">${nf(v,1)}<small>days</small></strong></div>`;
  const arBig=c.ar>=c.invv,bigN=arBig?'Receivables':'Owned inventory',bigV=arBig?c.ar:c.invv,per=(arBig?c.rev:c.cogs)/c.N;
  const own=c.inv.filter(x=>x.own>0),oldest=own.slice().sort((x,y)=>y.days-x.days)[0],slowest=own.filter(x=>x.slow===1).sort((x,y)=>y.own-x.own)[0];
  return `<div class="liq-h"><div><h4>Working-capital diagnosis</h4><p>${S.firm} · ${esc(FIRMS[S.firm].short)} · as of ${fd(c.as_of)}${S.case==='stress_7'?' · assuming customers pay 7 days later':''}</p></div><span class="status amber"><i></i>simulated</span></div>
  <div class="liq-k">${kp('','DSO · collection',b.dso)}${kp('','DIO · storage',b.dio)}${kp('','DPO · supplier pay',b.dpo)}${kp('hl','CCC · cash cycle',b.ccc)}</div>
  <div class="liq-b"><div class="lb"><span>Receivables</span><b class="num">${money(c.ar)}</b></div><div class="lb"><span>Owned inventory</span><b class="num">${money(c.invv)}</b></div><div class="lb"><span>Payables</span><b class="num">${money(c.ap)}</b></div></div>
  ${wNoteHTML()}<div class="liq-note"><span>◎</span><div><b>Largest pocket: ${bigN}</b>, ${money(bigV)}. One day of ${arBig?'DSO':'DIO'} is about ${money(per)} of capital, not guaranteed cash.</div></div>
  ${tb?`<div class="liq-note"><span>◷</span><div><b>Concentrated receivables</b>: ${esc(tb.k)} makes up ${nf(tb.v/tot*100,1)}% of open receivables (${money(tb.v)}).</div></div>`:''}
  ${oldest?`<div class="liq-note"><span>▤</span><div><b>Oldest owned lot</b>: ${esc(oldest.name)}, ${oldest.days} days, ${money(oldest.own)}.${slowest&&slowest!==oldest?` <b>Largest slow-moving value</b>: ${esc(slowest.name)}, ${money(slowest.own)}.`:''}</div></div>`:''}`;
}
async function respondLiq(bot,{focus}={}){
  const c=C(),b=BASE;
  await toolCall(bot,'diagnose_working_capital',0,{firm_id:S.firm,as_of:c.as_of},()=>{addLog({tool:'compute_ccc',tier:0,args:{firm_id:S.firm},status:'ok',summary:`CCC ${nf(b.ccc,1)} on (DSO ${nf(b.dso,1)}, DIO ${nf(b.dio,1)}, DPO ${nf(b.dpo,1)})`});return {}},{ms:420});
  const lead=focus==='ccc'
    ?`<p>CCC of <b>${S.firm}</b> is <b>${nf(b.ccc,1)} days</b> = DSO ${nf(b.dso,1)} + DIO ${nf(b.dio,1)} − DPO ${nf(b.dpo,1)}.</p>`
    :`<p>Here is where the working capital of <b>${S.firm} · ${esc(FIRMS[S.firm].short)}</b> is held. This is the diagnosis step only; I have not looked at the cash forecast yet.</p>`;
  await say(bot,lead);
  const card=document.createElement('div');card.className='liq';card.innerHTML=diagCardHTML()+
    `<div class="liq-act"><button class="btn primary sm" type="button" data-a="dash">▦ View detailed dashboard</button></div>
     <p class="liq-fn">CCC uses period-end balances, period ${c.N} days; goods held for subcontracting are excluded from owned inventory. W is classified with the garment-industry thresholds (FiinTrade 2016–2025, tv1.threshold.v2) and the default 5% materiality level because no company policy is set, so the result is provisional. ${DISC}</p>`;
  bot.appendChild(card);scroll();
  $('[data-a=dash]',card).onclick=()=>setTab('dash');
    advance(1,bot);suggestRow(bot,nextSuggest());
}
const CAUSE_LBL={payroll:'payroll',tax:'tax',debt_service:'loan repayments',supplier_payment:'supplier payments',new_materials:'new materials',rent:'rent',utilities:'utilities',capex:'capex'};
function causeOf(ep=EP){
  const c=C();if(!ep||ep.none)return null;
  const a0=dn(c.as_of),pk=dn(ep.peakDay);
  const outs=c.ev.filter(e=>e[1]==='OUT'&&dn(e[5])>a0&&dn(e[5])<=pk),ins=c.ev.filter(e=>e[1]==='IN'&&dn(e[5])>a0&&dn(e[5])<=pk);
  const sumOut=outs.reduce((a,e)=>a+e[4],0),sumIn=ins.reduce((a,e)=>a+e[4],0),m={};
  outs.forEach(e=>m[e[2]]=(m[e[2]]||0)+e[4]);
  const by=Object.entries(m).sort((x,y)=>y[1]-x[1]).slice(0,3);
  const late=c.ev.filter(e=>e[1]==='IN'&&e[2]==='invoice_receipt'&&dn(e[5])>pk).sort((x,y)=>y[4]-x[4])[0];
  return {open:ep.cashMin-sumIn+sumOut,sumIn,sumOut,by,late};
}
// Cash bridge for every gap (or one gap when the question names it), shown as an accordion with the largest gap open.
async function respondCause(bot,{focus}={}){
  const c=C();
  await toolCall(bot,'forecast_liquidity',1,{firm_id:S.firm,horizon_weeks:13},()=>{addLog({tool:'get_cash_forecast',tier:1,args:{firm_id:S.firm,horizon_weeks:13},status:'ok',summary:EPS.length?`${EPS.length} gaps; largest ${mm(Math.max(...EPS.map(e=>e.peak)))}`:'No shortfall in 13 weeks'});return {}},{ms:500});
  if(!EPS.length){
    await say(bot,`The lowest balance over 13 weeks is <b>${money(Math.min(...c.days.map(d=>d[1])))}</b>, always above the buffer ${money(c.buffer)}. There is no shortfall to explain, so there is nothing to match funding against.`);
    advance(2,bot);suggestRow(bot,nextSuggest());return;
  }
  const list=focus?EPS.filter(e=>e.k===focus):EPS,big=largestGap(),tb=openAR(c).top[0];
  if(focus)await say(bot,`<p>${t('cf.focus',{k:focus})} <b>gap ${focus}</b> (${fds(list[0].start)}${list[0].start!==list[0].end?'–'+fds(list[0].end):''}, peak shortfall <b>${mm(list[0].peak)}</b>).</p>`);
  else await say(bot,`<p>There are <b>${EPS.length} gap${EPS.length>1?'s':''}</b> below Rtarget ${money(c.buffer)}:</p><ul>${EPS.map(e=>`<li>Gap ${e.k}: ${fds(e.start)}${e.start!==e.end?'–'+fds(e.end):''}, peak shortfall <b>${mm(e.peak)}</b>${e.censored?' (not yet ended)':''}${e.k===big.k?' · largest':''}</li>`).join('')}</ul><p>${t('cf.intro')}</p>`);
  await toolCall(bot,'explain_liquidity_case',0,{firm_id:S.firm,gaps:list.map(e=>e.k)},()=>{addLog({tool:'explain_liquidity_case',tier:0,args:{firm_id:S.firm,gaps:list.map(e=>e.k)},status:'ok',summary:`Cash bridge for gap${list.length>1?'s':''} ${list.map(e=>e.k).join(', ')}`});return {}},{ms:420});
  S.causes=S.causes||{};
  const wrap=document.createElement('div');wrap.className='gap-accs';
  wrap.innerHTML=list.map(e=>{
    const k=causeOf(e),drv=k.by.map(([lb,v])=>`${CAUSE_LBL[lb]||lb} ${mm(v)}`),cf=gapFactors(e);
    const lateTxt=k.late?`${esc(k.late[3])} ${mm(k.late[4])} arrives only on ${fd(k.late[5])}, after the low point`:'';
    const same=k.late&&tb&&k.late[3]===tb.k;
    S.causes[e.k]={txt:`${drv.slice(0,2).join(' and ')} fall before the low point${k.late?`, while ${lateTxt}`:''}`,link:cf.link_type,evidence:cf.evidence_level};
    const lv=episodeLevel(c,e);
    return `<details class="liq gap-acc" data-gap="${e.k}" ${focus||e.k===big.k?'open':''}><summary><span class="ga-t">${t('cf.title',{k:e.k})}</span><span class="lv-tag" style="--lvc:${LV[lv].color}"><i class="lv-sw lv-${lv}" aria-hidden="true"></i>${t('ep.alert',{l:lvLabel(lv)})}</span><span class="ga-s">${fds(e.start)}${e.start!==e.end?'–'+fds(e.end):''} · peak ${mm(e.peak)}${e.k===big.k?' · largest gap':''}</span></summary>
    <div class="ga-b"><p class="ga-p">Bridge from the cut-off ${fd(c.as_of)} to the low point ${fd(e.peakDay)}: the balance reaches <b>${money(e.cashMin)}</b>, ${mm(e.peak)} below the buffer.</p>
    <div class="liq-b"><div class="lb"><span>Opening cash</span><b class="num">${money(k.open)}</b></div><div class="lb"><span>+ Cash in</span><b class="num">${money(k.sumIn)}</b></div><div class="lb"><span>− Cash out</span><b class="num">${money(k.sumOut)}</b></div></div>
    ${factorsHTML(cf)}
    <div class="liq-act"><button class="btn primary sm" type="button" data-gap-open="${e.k}">⚠ Open gap ${e.k} in Shortfall</button></div></div></details>`}).join('');
  S.cause=S.causes[focus||big.k];
  bot.appendChild(wrap);scroll();
  advance(2,bot);
  $$('[data-gap-open]',wrap).forEach(b=>b.onclick=()=>{selectGap(+b.dataset.gapOpen);setTab('gap');renderDemoChips()});
  suggestRow(bot,nextSuggest());
}
// Financing for every gap (or one named gap): a summary table, then the top 3 per gap, collapsed.
async function respondRank(bot,{focus}={}){
  if(!EPS.length){await say(bot,'No shortfall, so there is nothing to match against the catalogue yet.');suggestRow(bot,nextSuggest());return}
  // SRS-DECISION: asking for the financing ranking in the chat is the user's explicit request; the gap_request is created here when
  // UC02.7 allows it, otherwise the reason is given and nothing is ranked.
  if(!S.gapRequest){const {u,d,chk}=gapRequestState();
    if(!chk.ok){await say(bot,`<p>${chk.label==='idle_cash'?t('gr.idle')+': ':''}${t('gr.block.'+chk.reason)}</p>`,'warn');suggestRow(bot,nextSuggest());return}
    S.gapRequest=ENGINE.buildGapRequest(u,d,{scenario:S.case,health:modelHealthNow(),createdAt:new Date().toISOString()})}
  const gr=S.gapRequest,list=focus?EPS.filter(e=>e.k===focus):EPS,res=list.map(e=>({e,t3:tv3For(e)}));
  await toolCall(bot,'rank_financing',1,{firm_id:S.firm,episodes:list.map(e=>e.k)},()=>{addLog({tool:'rank_financing',tier:1,args:{firm_id:S.firm,episodes:list.map(e=>e.k)},status:'ok',summary:res.map(({e,t3})=>`gap ${e.k}: ${t3.ranked[0]?t3.ranked[0].product_id:'none'}`).join('; ')});return {}},{ms:520});
  const use=new Map();
  res.forEach(({e,t3})=>t3.ranked.slice(0,3).forEach(x=>{if(x.invoice_id&&x.invoice_id!=='–'){if(!use.has(x.invoice_id))use.set(x.invoice_id,new Set());use.get(x.invoice_id).add(e.k)}}));
  const dups=[...use].filter(([,g])=>g.size>1);
  const cause=focus?(S.causes||{})[focus]:S.cause;
  await say(bot,`<p>${t('gr.used',{id:gr.request_id,d:fd(gr.need_date),p:money(gr.peak_gap),c:gr.matrix_case_id,l:gr.link_type,e:t('ev.'+gr.evidence_level)})}</p>${cause?`<p>${t('cf.from',{k:focus||''})} ${cause.txt}.</p>`:''}<p>${focus?`Financing options for gap ${focus}`:`Financing options for all ${EPS.length} gaps`}, ranked by tier (fully covers and funds in time) and then cost relative to the shortfall.</p>`);
  const rows=res.map(({e,t3})=>{const b=t3.ranked[0];return `<tr data-gap="${e.k}"><td><b>Gap ${e.k}</b></td><td class="num">${mm(e.peak)}</td><td class="num">${fd(e.start)}</td><td>${b?`<b>${b.product_id}</b>${b.invoice_id!=='–'?' · '+b.invoice_id:''}`:'—'}</td><td class="num">${b?nf(b.cost/1e6,2)+'M':'—'}</td><td>${!b?'—':b.gap_rem>0?`<span class="status amber">Partly · short ${mm(b.gap_rem)}</span>`:'<span class="status green">Yes</span>'}</td></tr>`}).join('');
  const card=document.createElement('div');card.className='liq rank-all';
  card.innerHTML=`<div class="liq-h"><div><h4>Financing summary</h4><p>Best option per gap · ${CAT.length} products in the synthetic catalogue</p></div><span class="status amber"><i></i>provisional</span></div>
   <div class="table-wrap"><table class="dtable rank-sum"><thead><tr><th>Gap</th><th>Peak</th><th>Need date</th><th>Best option</th><th>Cost</th><th>Covered</th></tr></thead><tbody>${rows}</tbody></table></div>
   ${dups.length?`<div class="liq-note"><span>⚠</span><div><b>The same invoice is proposed for more than one gap.</b> ${dups.map(([inv,g])=>`${inv} → gaps ${[...g].join(', ')}`).join('; ')}. An invoice can be financed only once: use it for one gap and take the next option for the others.</div></div>`:''}
   <div class="gap-tops">${res.map(({e,t3})=>`<details class="gap-top" data-gap-top="${e.k}"><summary>Gap ${e.k} · top 3 options · short ${mm(e.peak)}</summary><ol>${t3.ranked.slice(0,3).map(x=>`<li><b>${x.product_id}</b> (${esc(CAT.find(z=>z.id===x.product_id).provider)})${x.invoice_id!=='–'?' · '+x.invoice_id:''}: receives ${mm(x.cash)}, cost ${nf(x.cost/1e6,2)}M (${nf(x.cpg*100,2)}% of the shortfall), ${x.gap_rem>0?'still short '+mm(x.gap_rem):'fully covered'}.</li>`).join('')}</ol>${t3.rejected.length?`<p class="rej">Rejected: ${t3.rejected.map(x=>x.product_id).join(', ')}</p>`:''}</details>`).join('')}</div>
   <p class="liq-fn">${DISC}</p>
   <div class="liq-act"><button class="btn sec sm" type="button" data-a="open">Open ranking</button></div>`;
  bot.appendChild(card);scroll();
  $('[data-a=open]',card).onclick=()=>setTab('gap');
  advance(3,bot);suggestRow(bot,nextSuggest());
}
async function gateMsg(bot){
  const m={1:['Let’s start with the diagnosis. I want to know where your working capital is stuck before I look for the cause of any shortfall.'],2:['Funding is matched to a cause, not to a number. First let me find the cause of the shortfall.'],3:['Levers are built from the financing shortlist. First let me rank the options that fit the cause.']}[S.stage+1];
  await say(bot,m[0]);suggestRow(bot,nextSuggest());
}
async function respondConc(bot){
  const c=C(),{tot,top}=openAR(c);
  await toolCall(bot,'get_receivables',0,{firm_id:S.firm,status:'open'},()=>{addLog({tool:'get_receivables',tier:0,args:{firm_id:S.firm,status:'open'},status:'ok',summary:`${top.length} customers owe, totalling ${money(tot)}`});return {}},{ms:380});
  if(!top.length){await say(bot,'There are currently no open credit invoices.');suggestRow(bot,nextSuggest());return}
  await say(bot,`<p>Open receivables of <b>${S.firm}</b> is <b>${money(tot)}</b>, concentrated mainly in <b>${esc(top[0].k)}</b> (${nf(top[0].v/tot*100,1)}%).</p>`);
  const card=document.createElement('div');card.className='liq';
  card.innerHTML=`<div class="liq-h"><div><h4>Receivables by customer</h4><p>Invoices open as of the cut-off ${fd(c.as_of)}</p></div></div><div class="conc">${top.slice(0,5).map(x=>`<div class="it"><b>${esc(x.k)}</b><span class="num">${money(x.v)} · ${nf(x.v/tot*100,1)}%</span><div class="bar"><span style="width:${Math.max(3,x.v/top[0].v*100)}%"></span></div></div>`).join('')}</div>
  ${(()=>{const d=uc01(),cc=d&&d.concentration;if(!cc||!d.cause_items.includes('AR'))return '';const lim=nf(CFG.bn.concentrationShare*100,0);
    return `<div class="liq-note"><span>⚠</span><div>${cc.flag==='concentrated'?`<b>${esc(cc.top.name)}</b> holds ${nf(cc.top.share*100,1)}% of the receivables above the normal level (≥ ${lim}%): <b>concentrated</b>.`:`No customer holds ${lim}% or more of the receivables above the normal level: <b>dispersed</b>.`} Try the <b>early collection</b> lever in the What-if task.</div></div>`})()}
  <div class="liq-act"><button class="btn primary sm" type="button">▦ View detailed dashboard</button></div>`;
  bot.appendChild(card);scroll();$('button',card).onclick=()=>setTab('dash');
  advance(1,bot);suggestRow(bot,nextSuggest());
}


function welcome(task){
  task=task||S.task;const th=THREADS[task],T=TASKS[task];th.innerHTML='';th.dataset.init='1';
  const h=document.createElement('div');h.className='hero';
  h.innerHTML=`<div class="hm" aria-hidden="true"><img src="assets/brand/lilact-symbol-light.svg" alt="" class="lilact-logo--light"><img src="assets/brand/lilact-symbol-dark.svg" alt="" class="lilact-logo--dark"></div>${accountFirm()?`<h1>Hi ${esc(userFirst())}. ${esc(T.hello(FIRMS[S.firm].short))}</h1>`:`<h1>Hi ${esc(userFirst())}. Let’s set up ${esc(S.user?.company||'your company')}.</h1><p class="hero-setup">Upload your company files to start the analysis.</p><button class="btn primary" type="button" data-setup-data>⇪ Upload company data</button>`}`;
  th.appendChild(h);syncChatEmpty();
}
// Suggestion chips above the composer: the flow step chips plus gap-specific chips, at most 4. Hidden only while busy.
function chipList(){
  const base=currentChips(),dyn=[];
  if(S.stage>=1&&EPS.length&&!EP.none)dyn.push({id:'gx'+EP.k,ask:`Explain gap ${EP.k}`});
  if(S.stage>=2&&EPS.length>1)dyn.push({id:'rall',ask:'Rank financing for all gaps'});
  const ordered=[...base.filter(s=>!S.done.has(s.id)),...base.filter(s=>S.done.has(s.id))];
  return [...ordered.slice(0,Math.max(0,4-dyn.length)),...dyn].slice(0,4);
}
function renderDemoChips(){
  const box=$('#demoChips'),list=chipList();box.hidden=busy||!list.length;
  box.innerHTML=list.map((s,i)=>`<button type="button" class="${S.done.has(s.id)?'done':''}" data-i="${i}" title="${esc(s.ask)}"><span class="n">${S.done.has(s.id)?'✓':i+1}</span>${esc(s.ask.length>46?s.ask.slice(0,45)+'…':s.ask)}</button>`).join('');
  $$('button',box).forEach(b=>b.onclick=()=>sendChat(list[+b.dataset.i].ask));
}
function nextSuggest(){return currentChips().filter(s=>!S.done.has(s.id)).slice(0,2).map(s=>s.ask)}


const mem={};
const store={get(k){try{return localStorage.getItem(k)}catch(e){return mem[k]??null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){mem[k]=v}},del(k){try{localStorage.removeItem(k)}catch(e){delete mem[k]}}};
const sess={get(k){try{return sessionStorage.getItem(k)}catch(e){return mem['s:'+k]??null}},set(k,v){try{sessionStorage.setItem(k,v)}catch(e){mem['s:'+k]=v}},del(k){try{sessionStorage.removeItem(k)}catch(e){delete mem['s:'+k]}}};
const KU='smefc.users.v1',KS='smefc.session.v1';
const users=()=>{try{return JSON.parse(store.get(KU)||'[]')}catch(e){return []}};
const saveUsers=u=>store.set(KU,JSON.stringify(u));
const salt=()=>{const a=new Uint8Array(12);(self.crypto||{}).getRandomValues?crypto.getRandomValues(a):a.forEach((_,i)=>a[i]=Math.random()*256);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')};
async function sha(s){
  if(self.crypto&&crypto.subtle){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  let h=2166136261;for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return 'x'+(h>>>0).toString(16); // demo fallback when WebCrypto is unavailable
}
const hashPw=(pw,sl)=>sha(sl+'|'+pw);
const normEmail=e=>String(e||'').trim().toLowerCase();
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const initials=n=>{const p=String(n||'?').replace(/[^\p{L}\s]/gu,'').trim().split(/\s+/);return ((p[0]?.[0]||'')+(p.length>1?p[p.length-1][0]:'')).toUpperCase()||'?'};
function pwScore(pw){let s=0;if(pw.length>=8)s++;if(/[a-zA-Z]/.test(pw)&&/\d/.test(pw))s++;if(/[A-Z]/.test(pw)&&/[a-z]/.test(pw))s++;if(/[^\w\s]/.test(pw)||pw.length>=12)s++;return pw?Math.max(1,s):0}
function pwRuleErrors(pw){const missing=[];if(String(pw).length<8)missing.push('length');if(!/[a-z]/.test(pw))missing.push('lowercase');if(!/[A-Z]/.test(pw))missing.push('uppercase');if(!/\d/.test(pw))missing.push('digit');if(!/[^\p{L}\p{N}\s]/u.test(pw))missing.push('special character');return missing}
function updatePwChecklist(pw){const missing=pwRuleErrors(pw),rules={length:'length',lower:'lowercase',upper:'uppercase',digit:'digit',symbol:'special character'};$$('#pwChecklist [data-rule]').forEach(x=>{const ok=!missing.includes(rules[x.dataset.rule]);x.classList.toggle('met',ok);x.setAttribute('aria-label',`${x.textContent}: ${ok?'met':'not met'}`)})}
function setErr(id,msg){const el=$('#'+id);if(!el)return;el.textContent=msg||'';const inp=el.previousElementSibling&&el.previousElementSibling.matches('input')?el.previousElementSibling:$('#'+id.replace(/E$/,''));inp&&inp.classList&&inp.classList.toggle('bad',!!msg)}
function clearErrs(form){$$('.ferr',form).forEach(e=>e.textContent='');$$('input.bad',form).forEach(i=>i.classList.remove('bad'))}
function showAuthTab(which){
  const login=which==='login';
  $('#tabLogin').classList.toggle('on',login);$('#tabReg').classList.toggle('on',!login);
  $('#tabLogin').setAttribute('aria-selected',login);$('#tabReg').setAttribute('aria-selected',!login);
  $('#formLogin').hidden=!login;$('#formReg').hidden=login;
  clearErrs($('#formLogin'));clearErrs($('#formReg'));
  setTimeout(()=>(login?$('#liEmail'):$('#rgName')).focus(),30);
}
$('#tabLogin').onclick=()=>showAuthTab('login');$('#tabReg').onclick=()=>showAuthTab('reg');
$$('[data-goto]').forEach(b=>b.onclick=()=>showAuthTab(b.dataset.goto));
$$('.eye').forEach(b=>b.onclick=()=>{const i=$('#'+b.dataset.eye),show=i.type==='password';i.type=show?'text':'password';b.textContent=show?'Hide':'Show';b.setAttribute('aria-pressed',show);b.setAttribute('aria-label',show?'Hide password':'Show password')});
$('#rgPw').addEventListener('input',e=>{const s=pwScore(e.target.value);$('#pwMeter').dataset.s=s;$('#pwHint').textContent=['Password strength','Weak: add letters, digits or length','Fair: add upper/lower case','Good','Strong'][s];updatePwChecklist(e.target.value)});

let fails=0,lockUntil=0;
async function doLogin(email,pw,remember){
  const f=$('#formLogin');clearErrs(f);let ok=true;
  if(!EMAIL_RE.test(normEmail(email))){setErr('liEmailE','Enter a valid email, e.g. you@company.com');ok=false}
  if(!pw){setErr('liPwE','Enter your password');ok=false}
  if(!ok)return;
  if(Date.now()<lockUntil){$('#liErr').textContent=`Too many attempts. Try again in ${Math.ceil((lockUntil-Date.now())/1000)} seconds.`;return}
  const btn=$('#liSubmit');btn.disabled=true;btn.textContent='Signing in…';
  try{
    const u=users().find(x=>x.email===normEmail(email));
    const good=u&&(await hashPw(pw,u.salt))===u.hash;
    if(!good){fails++;if(fails>=5){lockUntil=Date.now()+30000;fails=0;$('#liErr').textContent='Wrong 5 times. Locked for 30 seconds.'}else $('#liErr').textContent='Incorrect email or password.';return}
    fails=0;persistSession(u,remember);enterApp(u);
  }finally{btn.disabled=false;btn.textContent='Sign in'}
}
$('#formLogin').addEventListener('submit',e=>{e.preventDefault();doLogin($('#liEmail').value,$('#liPw').value,$('#liRemember').checked)});
$('#btnDemo').onclick=()=>{$('#liEmail').value=DEMO.email;$('#liPw').value=DEMO.pw;doLogin(DEMO.email,DEMO.pw,true)};
const DEMO={email:'demo@smecopilot.vn',pw:'Demo@2026',name:'Minh Anh',company:'Alpha Garment Subcontractor',firmId:'F01'};
// One account = one company. Each demo account is tied to one sample company.
const DEMOS=[DEMO,{email:'beta.demo@smecopilot.vn',pw:'Demo@2026',name:'Pham Thi Lan',company:'Beta Fabric Distributor',firmId:'F02'},{email:'gamma.demo@smecopilot.vn',pw:'Demo@2026',name:'Tran Van Quang',company:'Gamma Packaging & Trims',firmId:'F03'}];
$$('[data-demo]').forEach(b=>b.onclick=()=>{const d=DEMOS.find(x=>x.firmId===b.dataset.demo);$('#liEmail').value=d.email;$('#liPw').value=d.pw;doLogin(d.email,d.pw,true)});

$('#formReg').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;clearErrs(f);$('#rgErr').textContent='';
  const name=$('#rgName').value.trim(),company=$('#rgCompany').value.trim(),taxCode=$('#rgTax').value.trim().replace(/\s/g,''),email=normEmail($('#rgEmail').value),pw=$('#rgPw').value,pw2=$('#rgPw2').value;
  let ok=true;
  if(name.length<2){setErr('rgNameE','Enter your full name (at least 2 characters)');ok=false}
  if(company.length<2){setErr('rgCompanyE','Enter your company name');ok=false}
  if(!/^(?:\d{10}|\d{13}|\d{10}-\d{3})$/.test(taxCode)){setErr('rgTaxE','Tax code must be 10 or 13 digits');ok=false}
  if(!EMAIL_RE.test(email)){setErr('rgEmailE','Enter a valid email, e.g. you@company.com');ok=false}
  if(pwRuleErrors(pw).length){setErr('rgPwE','Password must have 8+ characters with an uppercase letter, a lowercase letter, a digit and a special character');ok=false}
  if(pw2!==pw){setErr('rgPw2E','Passwords do not match');ok=false}
  if(!$('#rgTerms').checked){$('#rgTermsE').textContent='Please confirm to continue';ok=false}
  if(!ok){const bad=$('input.bad',f);bad&&bad.focus();return}
  if(users().some(u=>u.email===email)){setErr('rgEmailE','This email already has an account. Please sign in.');$('#rgEmail').focus();return}
  const taxDigits=taxCode.replace(/\D/g,'');if(users().some(u=>String(u.taxCode||'').replace(/\D/g,'')===taxDigits)){setErr('rgTaxE','This tax code is already registered');$('#rgTax').focus();return}
  const btn=$('#rgSubmit');btn.disabled=true;btn.textContent='Creating…';
  try{
    const sl=salt(),u={id:'u'+Date.now().toString(36),name,company,taxCode:taxDigits,email,salt:sl,hash:await hashPw(pw,sl),created:new Date().toISOString()};
    const all=users();all.push(u);saveUsers(all);persistSession(u,true);f.reset();$('#pwMeter').dataset.s=0;enterApp(u,{fresh:true});
  }finally{btn.disabled=false;btn.textContent='Create an account'}
});

$('#btnForgot').onclick=()=>{
  openModal(`<h3>Reset password</h3><p>The demo does not send email: enter your registered email and a new password to reset it right here in this browser.</p>
  <div class="fld"><label for="fgEmail">Email</label><input id="fgEmail" type="email" value="${esc($('#liEmail').value)}" autocomplete="email"></div>
  <div class="fld"><label for="fgPw">New password</label><input id="fgPw" type="password" autocomplete="new-password" placeholder="8+ characters, upper & lower case, digit, symbol"></div>
  <p class="ferr" id="fgErr" role="alert"></p>
  <div class="acts"><button class="btn sec" type="button" id="fgCancel">Cancel</button><button class="btn primary" type="button" id="fgOk">Reset</button></div>`,m=>{
    $('#fgCancel',m).onclick=closeModal;
    $('#fgPw',m).addEventListener('input',()=>{$('#fgErr',m).textContent=pwRuleErrors($('#fgPw',m).value).length?'Password must have 8+ characters with an uppercase letter, a lowercase letter, a digit and a special character':''});
    $('#fgOk',m).onclick=async()=>{
      const em=normEmail($('#fgEmail',m).value),pw=$('#fgPw',m).value,all=users(),u=all.find(x=>x.email===em);
      if(!u){$('#fgErr',m).textContent='No account found for this email.';return}
      if(pwRuleErrors(pw).length){$('#fgErr',m).textContent='Password must have 8+ characters with an uppercase letter, a lowercase letter, a digit and a special character';return}
      u.salt=salt();u.hash=await hashPw(pw,u.salt);saveUsers(all);closeModal();$('#liEmail').value=em;$('#liPw').value='';$('#liPw').focus();fails=0;lockUntil=0;toast('Password reset. Please sign in.');
    };
  });
};

function persistSession(u,remember){
  const v=JSON.stringify({id:u.id,t:Date.now()});
  store.del(KS);sess.del(KS);(remember?store:sess).set(KS,v);
}
function currentSession(){
  const raw=sess.get(KS)||store.get(KS);if(!raw)return null;
  try{const {id}=JSON.parse(raw);return users().find(u=>u.id===id)||null}catch(e){return null}
}
let booted=false;
function enterApp(u,{fresh,restore}={}){
  S.user=u;syncUserFirms();
  $('#authRoot').hidden=true;$('#app').hidden=false;document.title='Lilact · SME Liquidity Copilot';
  $('#uAvatar').textContent=initials(u.name);$('#uName').textContent=u.name;$('#uSub').textContent=u.company||u.email;
  $('#umName').textContent=u.name||'Business owner';$('#umEmail').textContent=u.email||'';$('#umCompany').textContent=u.company||'';$('#umTax').textContent=u.taxCode?`Tax code ${u.taxCode}`:'';
  if(!booted){booted=true;bootApp()}else{resetSession();switchContext('F01','base');updatePending()}
  setTask('tv1',{force:true});
if(!restore)toast(fresh?`Welcome ${userFirst()}! Your account has been created.`:`Hello ${userFirst()}, you are signed in.`);
}
function resetSession(){
  S.drafts=[];S.log=[];S.draftN=0;S.cmp=[];S.last=null;S.done=new Set();S.seq=0;S.runN=0;closePanel();
  addLog({tool:'start_session',tier:0,args:{sandbox:true},status:'ok',summary:'Open the demo session, synthetic data as of 30 Sep 2026'});
}
function leaveApp(){
  store.del(KS);sess.del(KS);S.user=null;syncUserFirms(true);$('#userMenu').hidden=true;$('#userBtn').setAttribute('aria-expanded','false');
  closePanel();closeSide();$('#app').hidden=true;$('#authRoot').hidden=false;document.title='Sign in · Lilact';
  $('#liPw').value='';showAuthTab('login');
}
$('#btnLogout').onclick=leaveApp;
$('#userBtn').onclick=e=>{e.stopPropagation();const m=$('#userMenu');m.hidden=!m.hidden;$('#userBtn').setAttribute('aria-expanded',!m.hidden)};
document.addEventListener('click',e=>{const m=$('#userMenu');if(!m.hidden&&!e.target.closest('.side-foot')){m.hidden=true;$('#userBtn').setAttribute('aria-expanded','false')}});
addEventListener('keydown',e=>{if(e.key==='Escape'){const m=$('#userMenu');if(!m.hidden){m.hidden=true;$('#userBtn').setAttribute('aria-expanded','false')}else if(S.panel&&!$('#scrim').classList.contains('show'))closePanel()}});

async function initAuth(){
  const all=users();
  if(!all.some(u=>u.email===DEMO.email)){const sl=salt();all.unshift({id:'u-demo',name:DEMO.name,company:DEMO.company,email:DEMO.email,salt:sl,hash:await hashPw(DEMO.pw,sl),created:new Date().toISOString()});saveUsers(all)}
  const u=currentSession();
  if(u){enterApp(u,{restore:true})}else{$('#authRoot').hidden=false;document.title='Sign in · Lilact';setTimeout(()=>$('#liEmail').focus(),50)}
}


const DK='smefc.data.v1.';
const DAYMS=86400000, isoOf=n=>new Date(n*DAYMS).toISOString().slice(0,10);
REJ.TOO_SLOW='Disbursement later than the cash-needed date';
const defCase=f=>(f==='F01'||String(f)[0]==='U')?'base':'stress_7';
const isUserFirm=f=>String(f)[0]==='U';
const dstore={
  key:()=>DK+((S.user&&S.user.email)||'anon').toLowerCase(),
  load(){try{return JSON.parse(localStorage.getItem(this.key()))||{firms:{}}}catch(e){return {firms:{}}}},
  save(d){try{localStorage.setItem(this.key(),JSON.stringify(d));return true}catch(e){toast('Could not save: browser storage is full or blocked');return false}}
};


function parseCSV(text){
  text=String(text).replace(/^﻿/,'');
  const first=text.split(/\r?\n/,1)[0]||'';
  const delim=[',',';','\t'].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;
    else if(ch===delim){row.push(cur);cur=''}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';if(row.some(x=>x.trim()!==''))rows.push(row);row=[]}
    else cur+=ch}
  row.push(cur);if(row.some(x=>x.trim()!==''))rows.push(row);
  return rows;
}
const hnorm=h=>String(h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const ALIAS={ma_so_thue:'tax_code',mst:'tax_code',loai_hang:'inventory_type',loai_ton_kho:'inventory_type',chu_so_huu:'owner',da_huy:'cancelled',cam_co:'pledged',thiet_yeu:'essential',so_tien_da_thu:'paid_amount',so_tien_da_tra:'paid_amount',ngay:'date',muc_chac_chan:'certainty',tai_san_ngan_han:'current_assets_vnd',mo_hinh_kinh_doanh:'business_model',so_tien:'amount_vnd',amount:'amount_vnd',gia_tri:'amount_vnd',khach_hang:'buyer',customer:'buyer',nha_cung_cap:'supplier',ngay_phat_hanh:'issue_date',ngay_lap:'issue_date',han_thanh_toan:'due_date',ngay_den_han:'due_date',ngay_thanh_toan:'paid_date',so_hoa_don:'invoice_id',ma_hoa_don:'invoice_id',ten_hang:'product_line',mat_hang:'product_line',so_luong:'qty',don_gia:'unit_cost_vnd',so_ngay_ton:'days_in_stock',doanh_thu:'revenue_vnd',gia_von:'cogs_vnd',tien_dau_ky:'opening_cash_vnd',tuan:'week',hang_muc:'category',ten:'name',nganh:'industry',tien_dem_toi_thieu:'min_cash_buffer_vnd'};
const canon=h=>{const n=hnorm(h);return ALIAS[n]||n};
const TYPES={
  sales:{label:'Sales invoices (receivable)',file:'sales_invoices.csv',cols:['invoice_id','buyer','amount_vnd','issue_date','due_date','paid_date'],opt:['tax_code','paid_amount','status'],need:['invoice_id','buyer','amount_vnd','due_date'],key:r=>r.id,
    sample:['INV-S-0101,Customer K1,1200000000,2026-08-10,2026-10-12,','INV-S-0102,Customer K2,800000000,2026-09-01,2026-09-20,2026-09-22']},
  purchases:{label:'Purchase invoices (payable)',file:'purchase_invoices.csv',cols:['invoice_id','supplier','amount_vnd','issue_date','due_date','paid_date','early_discount_pct','discount_days'],opt:['tax_code','paid_amount','essential','status'],need:['invoice_id','supplier','amount_vnd','due_date'],key:r=>r.id,
    sample:['INV-P-0101,Supplier P1,1400000000,2026-09-10,2026-10-10,,2,10']},
  inventory:{label:'Inventory',file:'inventory.csv',cols:['product_line','qty','unit_cost_vnd','days_in_stock'],opt:['inventory_type','owner','cancelled','pledged','supplier_id'],need:['product_line','qty','unit_cost_vnd'],key:r=>r.name.toLowerCase(),
    sample:['Cotton fabric,25000,80000,25','Aged stock (slow-moving),10000,90000,95']},
  planned:{label:'13-week planned cash flow',file:'planned_flows.csv',cols:['week','flow_type','category','amount_vnd'],opt:['date','certainty','flow_id','source_id'],need:['flow_type','amount_vnd'],needOne:['week','date'],key:r=>r.week+'|'+r.type+'|'+r.cat.toLowerCase(),
    sample:['1,inflow,Retail sales,400000000','1,outflow,Payroll and operations,300000000']},
  financials:{label:'Financial statements for the period',file:'financials.csv',cols:['period','revenue_vnd','cogs_vnd','opening_cash_vnd'],opt:['current_assets_vnd','period_start','period_end','st_investments_vnd'],need:['revenue_vnd','cogs_vnd'],sample:['Q3-2026 (90 days),9000000000,7200000000,1200000000']},
  firms:{label:'Company information',file:'firms.csv',cols:['name','industry','min_cash_buffer_vnd'],opt:['business_model','supply_chain_position'],need:['min_cash_buffer_vnd'],sample:['ABC Company,Textiles,500000000']}
};
function detectType(hdr){
  const s=new Set(hdr);
  if(s.has('invoice_id')&&s.has('buyer'))return 'sales';
  if(s.has('invoice_id')&&s.has('supplier'))return 'purchases';
  if(s.has('product_line')&&s.has('qty'))return 'inventory';
  if(s.has('flow_type')&&(s.has('week')||s.has('date')))return 'planned';
  if(s.has('revenue_vnd')&&s.has('cogs_vnd'))return 'financials';
  if(s.has('min_cash_buffer_vnd'))return 'firms';
  return null;
}
function parseNum(v){
  let s=String(v==null?'':v).trim().replace(/[₫đ\s]|vnd/gi,'');if(s==='')return NaN;
  if(/^-?\d+$/.test(s))return +s;
  const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.');
  if(lc>=0&&ld>=0){const dec=lc>ld?',':'.';s=dec===','?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'')}
  else if(lc>=0||ld>=0){const sep=lc>=0?',':'.',parts=s.split(sep);
    if(parts.length>2||(parts.length===2&&parts[1].length===3&&parts[0].length<=3))s=parts.join('');else s=s.replace(sep,'.')}
  const n=+s;return isFinite(n)?n:NaN;
}
function dateParts(s){
  s=String(s||'').trim();if(!s)return null;
  let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return {k:'iso',y:+m[1],a:+m[2],b:+m[3]};
  m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);if(m)return {k:'x',y:+m[3],a:+m[1],b:+m[2]};
  return {k:'bad'};
}
function mkIso(y,mo,d){const t=Date.UTC(y,mo-1,d),dt=new Date(t);return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?isoOf(t/DAYMS):null}
function toIso(s,fmt){
  const p=dateParts(s);if(!p||p.k==='bad')return null;
  if(p.k==='iso')return mkIso(p.y,p.a,p.b);
  return fmt==='mdy'?mkIso(p.y,p.a,p.b):mkIso(p.y,p.b,p.a);
}
function detectFmt(strs){
  let dm=0,md=0,x=0;
  strs.forEach(s=>{const p=dateParts(s);if(!p||p.k!=='x')return;x++;if(p.a>12)dm++;if(p.b>12)md++});
  if(!x)return {fmt:'iso',sure:true};
  if(dm&&md)return {fmt:'dmy',sure:false,mixed:true};
  if(dm)return {fmt:'dmy',sure:true};
  if(md)return {fmt:'mdy',sure:true};
  return {fmt:'dmy',sure:false};
}


function normTable(type,hdr,rows,fmt){
  const ix={};hdr.forEach((h,i)=>{if(!(h in ix))ix[h]=i});
  const get=(r,h)=>ix[h]==null?'':String(r[ix[h]]==null?'':r[ix[h]]).trim();
  const out=[],issues=[];const seen=new Set();let skipped=0;
  const bad=(i,msg,fatal=true)=>{issues.push({line:i+2,msg,fatal});if(fatal)skipped++};
  rows.forEach((r,i)=>{
    if(type==='sales'||type==='purchases'){
      const id=get(r,'invoice_id'),party=get(r,type==='sales'?'buyer':'supplier'),amt=parseNum(get(r,'amount_vnd'));
      const dueRaw=get(r,'due_date'),issRaw=get(r,'issue_date'),pd=get(r,'paid_date');
      const due=dueRaw?toIso(dueRaw,fmt):'',iss=issRaw?toIso(issRaw,fmt):'',paid=pd?toIso(pd,fmt):'';
      if(!id)return bad(i,'missing invoice_id');if(!party)return bad(i,`${id}: missing ${type==='sales'?'buyer':'supplier'}`);
      if(!(amt>0))return bad(i,`${id}: invalid amount`);
      if(dueRaw&&!due)return bad(i,`${id}: due date unreadable`);
      if(pd&&!paid)return bad(i,`${id}: payment date unreadable`);
      if(issRaw&&!iss)return bad(i,`${id}: issue date unreadable`);
      if(seen.has(id))return bad(i,`${id}: duplicate invoice ID, keeping the first row`);seen.add(id);
      if(!due)issues.push({line:i+2,msg:`${id}: no due date; counted in the balance but not aged`,fatal:false});
      if(!iss)issues.push({line:i+2,msg:`${id}: no issue date; a ${CFG.ar.termFallbackDays}-day term is assumed for the overdue ratio`,fatal:false});
      if(due&&iss&&due<iss)issues.push({line:i+2,msg:`${id}: due date is before issue date`,fatal:false});
      const pa=get(r,'paid_amount')===''?null:parseNum(get(r,'paid_amount'));
      if(pa!=null&&!(pa>=0))return bad(i,`${id}: invalid paid amount`);
      const o={id,amt,issue:iss,due,paid:paid||'',paid_amount:pa,tax_code:get(r,'tax_code')||null,status:get(r,'status')||null};o[type==='sales'?'buyer':'supplier']=party;
      if(type==='purchases'){o.disc_pct=parseNum(get(r,'early_discount_pct'))||0;if(o.disc_pct>1)o.disc_pct/=100;o.disc_days=parseNum(get(r,'discount_days'))||0;o.essential=get(r,'essential')||null}
      out.push(o);
    }else if(type==='inventory'){
      const name=get(r,'product_line'),qty=parseNum(get(r,'qty')),uc=parseNum(get(r,'unit_cost_vnd')),dd=get(r,'days_in_stock')===''?NaN:parseNum(get(r,'days_in_stock'));
      if(!name)return bad(i,'missing product_line');if(!(qty>=0)||!(uc>=0))return bad(i,`${name}: invalid quantity or unit cost`);
      if(seen.has(name.toLowerCase()))return bad(i,`${name}: duplicate product line name, keeping the first row`);seen.add(name.toLowerCase());
      if(isNaN(dd))issues.push({line:i+2,msg:`${name}: missing days_in_stock, the lot cannot be aged`,fatal:false});
      const it=get(r,'inventory_type').toUpperCase(),ow=get(r,'owner').toLowerCase();
      if(!it)issues.push({line:i+2,msg:`${name}: no inventory_type; the type is inferred from the name (provisional)`,fatal:false});
      out.push({name,qty,unit:uc,days:isNaN(dd)?null:dd,inventory_type:it||null,owner:/^(customer|khach)/.test(ow)?'customer':/^(own|doanh)/.test(ow)?'own':(ow?'unknown':null),cancelled:get(r,'cancelled')||null,pledged:get(r,'pledged')||null,supplier_id:get(r,'supplier_id')||null});
    }else if(type==='planned'){
      const wr=get(r,'week'),w=wr===''?null:parseNum(wr),dr=get(r,'date'),dt=dr?toIso(dr,fmt):null,ft=get(r,'flow_type').toLowerCase(),amt=parseNum(get(r,'amount_vnd')),cat=get(r,'category')||'(unnamed)';
      if(dr&&!dt)return bad(i,`date "${dr}" unreadable`);
      if(!dt&&!(w>=1&&w<=13&&Number.isInteger(w)))return bad(i,`week "${wr}" outside 1–13 and no date`);
      const t=/^(in|inflow|thu)/.test(ft)?'in':/^(out|outflow|chi)/.test(ft)?'out':'';
      if(!t)return bad(i,`flow_type "${ft}" must be inflow or outflow`);if(!(amt>0))return bad(i,`week ${w}: invalid amount`);
      const cert=get(r,'certainty').toLowerCase();
      out.push({week:dt?null:w,date:dt,type:t,cat,amt,certainty:/^confirm/.test(cert)?'confirmed':'estimated',id:get(r,'flow_id')||null,source_id:get(r,'source_id')||null});
    }else if(type==='financials'){
      const rev=parseNum(get(r,'revenue_vnd')),cogs=parseNum(get(r,'cogs_vnd')),op=parseNum(get(r,'opening_cash_vnd')),per=get(r,'period');
      if(!(rev>0)||!(cogs>0))return bad(i,'invalid revenue or COGS');
      const dm=per.match(/(\d+)\s*(?:days?|ngày)/i),rg=per.match(/(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})/);
      const ps=get(r,'period_start')?toIso(get(r,'period_start'),fmt):rg?rg[1]:null,pe=get(r,'period_end')?toIso(get(r,'period_end'),fmt):rg?rg[2]:null;
      const ca=parseNum(get(r,'current_assets_vnd')),sti=parseNum(get(r,'st_investments_vnd'));
      out.push({rev,cogs,opening:isNaN(op)?null:op,period:per,days:ps&&pe?dn(pe)-dn(ps)+1:dm?+dm[1]:null,period_start:ps,period_end:pe,current_assets:isNaN(ca)?null:ca,st_investments:isNaN(sti)?null:sti});
    }else if(type==='firms'){
      const bm=get(r,'business_model').toUpperCase();
      out.push({name:get(r,'name'),industry:get(r,'industry'),buffer:parseNum(get(r,'min_cash_buffer_vnd')),business_model:/^(CMT|GIA)/.test(bm)?'CMT':/^FOB/.test(bm)?'FOB':null,position:get(r,'supply_chain_position')||null});
    }
  });
  return {rows:out,issues,skipped};
}


function mergeTable(type,base,up,mode){
  const T=TYPES[type];base=base||[];
  if(!T.key)return {rows:up,st:{added:up.length,updated:0,kept:0,removed:0}};
  if(mode==='replace'){const ks=new Set(up.map(T.key));return {rows:up,st:{added:up.filter(r=>!base.some(b=>T.key(b)===T.key(r))).length,updated:up.filter(r=>base.some(b=>T.key(b)===T.key(r))).length,kept:0,removed:base.filter(b=>!ks.has(T.key(b))).length}}}
  const m=new Map(base.map(r=>[T.key(r),r]));let a=0,u=0;
  up.forEach(r=>{const k=T.key(r);if(m.has(k))u++;else a++;m.set(k,r)});
  return {rows:[...m.values()],st:{added:a,updated:u,kept:base.length-u,removed:0}};
}


// Uploaded snapshot → engine input (period length from the file or, failing that, from the invoice dates).
function uploadInput(f,snap){
  const input=ENGINE.inputFromUpload(f,snap),r=input.fin[0];
  if(!r.days&&!r.period_start){const iss=input.sales.concat(input.purchases).map(x=>x.issue).filter(Boolean).sort();
    if(iss.length){r.period_start=iss[0];r.period_end=snap.asOf;r.days=dn(snap.asOf)-dn(iss[0])+1;input.fin_period_from_invoices=true}}
  return input;
}


function rankFor(c,ep,neps){
  const A=dn(c.as_of),need=dn(ep.start),gap=ep.peak,daysLeft=need-A;
  const endN=dn(ep.end),censored=!!ep.censored;
  const tLoan=Math.max(1,censored?30:(endN-need+1));
  const V=c.inv.filter(x=>x.own>0&&!x.slow).reduce((a,x)=>a+x.own,0);
  const dio=c.invv/c.cogs*c.N,dpo=c.ap/c.cogs*c.N,dso=c.ar/c.rev*c.N;
  const ranked=[],rejected=[];
  const cost=(cat,draw,base,t)=>draw*cat.rate/100*t/365+(cat.fee?(cat.fbase==='invoice'?base:draw)*cat.fee/100:0);
  CAT.forEach(cat=>{
    if(cat.dtf>daysLeft){rejected.push({product_id:cat.id,reason:'TOO_SLOW'});return}
    if(['invoice_factoring','reverse_factoring','dynamic_discounting'].includes(cat.type)){
      const wl=cat.wl?cat.wl.split('|'):[];
      const open=c.ev.filter(e=>e[1]==='IN'&&e[2]==='invoice_receipt'&&dn(e[5])>=need);
      const ok=open.filter(e=>{const s=c.sales.find(x=>x[0]===e[0]);const dpd=s&&typeof s[5]==='number'?s[5]:0;return e[4]>=cat.mn&&(!wl.length||wl.includes(e[3]))&&dpd<=cat.mo});
      if(!ok.length){rejected.push({product_id:cat.id,reason:!open.length?'NO_OPEN_INVOICE':open.every(e=>e[4]<cat.mn)?'INVOICE_TOO_SMALL':'NOT_ELIGIBLE'});return}
      const opts=ok.map(e=>{const Iu=Math.min(e[4],cat.mx),t=Math.max(1,dn(e[5])-need);
        const cash=cat.type==='dynamic_discounting'?Iu*(1-cat.disc/100):Iu*cat.adv/100;
        const cs=cat.type==='dynamic_discounting'?Iu*cat.disc/100:cost(cat,cash,Iu,t);
        return {e,Iu,cash,cs,full:cash>=gap}});
      const full=opts.filter(o=>o.full).sort((a,b)=>a.cs-b.cs)[0],best=full||opts.sort((a,b)=>b.cash-a.cash)[0];
      const cash=Math.min(best.cash,Math.max(gap,0)) ,csc=best.full?best.cs*cash/best.cash:best.cs;
      ranked.push({product_id:cat.id,invoice_id:best.e[0],cash:best.full?cash:best.cash,cost:best.full?csc:best.cs,tier:best.full?0:1,days:cat.dtf,cash_after:ep.cashMin+(best.full?cash:best.cash),gap_rem:Math.max(0,gap-best.cash),dso_after:(c.ar-best.Iu)/c.rev*c.N,ccc_after:(c.ar-best.Iu)/c.rev*c.N+dio-dpo});
    }else{
      const cap=cat.type==='inventory_loan'?Math.min(V*cat.adv/100,cat.mx):cat.mx;
      if(cat.type==='inventory_loan'&&V*cat.adv/100<cat.mn){rejected.push({product_id:cat.id,reason:'NOT_ELIGIBLE'});return}
      const draw=Math.min(cap,Math.max(gap,cat.mn)),cs=cost(cat,draw,draw,Math.min(tLoan,cat.tenor)),full=draw>=gap;
      ranked.push({product_id:cat.id,invoice_id:'–',cash:draw,cost:cs,tier:full?0:1,days:cat.dtf,cash_after:ep.cashMin+draw,gap_rem:Math.max(0,gap-draw),dso_after:dso,ccc_after:dso+dio-dpo});
    }
  });
  ranked.forEach(r=>{r.cpg=r.cost/Math.max(1,Math.min(r.cash,gap))});
  ranked.sort((a,b)=>a.tier-b.tier||a.cpg-b.cpg);ranked.forEach((r,i)=>r.rank=i+1);
  return {inputs:{gap,need,days_left:daysLeft,t_loan:tLoan,V,cash_peak:ep.cashMin,dso,k:ep.k,neps,censored},ranked,rejected};
}


function activeSnap(f){return f.snaps.find(s=>s.id===f.active)||f.snaps[f.snaps.length-1]}
function registerFirm(f){
  const snap=activeSnap(f);if(!snap)return;
  registerCases(f.id,uploadInput(f,snap));
  FIRMS[f.id]={name:f.name,short:f.name.length>24?f.name.slice(0,23)+'…':f.name};
}
function syncUserFirms(clear){
  Object.keys(DATA.cases).filter(k=>isUserFirm(k.split('|')[0])).forEach(k=>delete DATA.cases[k]);
  Object.keys(FIRMS).filter(isUserFirm).forEach(k=>delete FIRMS[k]);
  if(!clear&&S.user){const d=dstore.load();Object.values(d.firms).forEach(f=>{try{registerFirm(f)}catch(e){console.error('registerFirm',f.id,e)}})}
  renderFirmSel();typeof loadPins==='function'&&loadPins();
}
function renderFirmSel(){
  const sel=$('#firmSel'),cur=S.firm;
  const mine=Object.keys(FIRMS).filter(isUserFirm);
  sel.innerHTML=['F01','F02','F03'].map(f=>`<option value="${f}">${f} · ${esc(FIRMS[f].name)}</option>`).join('')+
    (mine.length?`<optgroup label="My data">${mine.map(f=>`<option value="${f}">${f} · ${esc(FIRMS[f].name)}</option>`).join('')}</optgroup>`:'');
  sel.innerHTML+=`<option value="__add">＋ Add business…</option>`;
  sel.value=FIRMS[cur]?cur:'F01';
}


const FILE_MAX=10*1024*1024, FILE_EXTS=new Set(['csv','txt','xlsx','xls','docx']);
let fileDbPromise=null,fileStoreWarned=false;
const FILES={
  memory:[],
  async db(){if(!('indexedDB'in window))throw new Error('IndexedDB is unavailable');if(!fileDbPromise)fileDbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('lilact.files.v1',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('files')){const s=db.createObjectStore('files',{keyPath:'id'});s.createIndex('userId','userId')}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Could not open file storage'))});return fileDbPromise},
  warn(){if(!fileStoreWarned){fileStoreWarned=true;toast('Browser file storage is unavailable. You can still review and import files in this session.')}},
  async put(file,{firmId=S.firm,status}={}){const ext=String(file.name.split('.').pop()||'').toLowerCase();if(!FILE_EXTS.has(ext))throw new Error(`${file.name}: unsupported file type`);if(file.size>FILE_MAX)throw new Error(`${file.name}: file exceeds the 10 MB limit`);const kind=ext==='docx'?'document':'table',rec={id:`file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,userId:S.user.id,firmId:firmId||null,name:file.name,ext,kind,size:file.size,uploadedAt:new Date().toISOString(),status:status||(kind==='document'?'Reference only':'Pending review'),snapshotId:null,blob:file};try{const db=await this.db();await new Promise((ok,no)=>{const r=db.transaction('files','readwrite').objectStore('files').put(rec);r.onsuccess=ok;r.onerror=()=>no(r.error)});return rec}catch(e){this.warn();this.memory=this.memory.filter(x=>x.id!==rec.id);this.memory.push(rec);return rec}},
  async list(){try{const db=await this.db(),all=await new Promise((ok,no)=>{const r=db.transaction('files').objectStore('files').getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)}),mine=all.filter(x=>x.userId===S.user.id),ids=new Set(mine.map(x=>x.id));return mine.concat(this.memory.filter(x=>x.userId===S.user.id&&!ids.has(x.id)))}catch(e){this.warn();return this.memory.filter(x=>x.userId===S.user.id)}},
  async get(id){return (await this.list()).find(x=>x.id===id)||null},
  async markUsed(ids,snapshotId){if(!ids?.length)return;try{const db=await this.db();await Promise.all(ids.map(id=>new Promise((ok,no)=>{const tx=db.transaction('files','readwrite'),s=tx.objectStore('files'),r=s.get(id);r.onsuccess=()=>{if(r.result&&r.result.userId===S.user.id){r.result.status=`Used in snapshot ${snapshotId}`;r.result.snapshotId=snapshotId;s.put(r.result)}};tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})))}catch(e){this.warn();this.memory.forEach(x=>{if(ids.includes(x.id)){x.status=`Used in snapshot ${snapshotId}`;x.snapshotId=snapshotId}})}},
  async remove(ids){try{const db=await this.db();await Promise.all(ids.map(id=>new Promise((ok,no)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})))}catch(e){this.warn()}this.memory=this.memory.filter(x=>!ids.includes(x.id))}
};
FILES.setFirm=async function(ids,firmId){if(!ids?.length)return;try{const db=await this.db();await Promise.all(ids.map(id=>new Promise((ok,no)=>{const tx=db.transaction('files','readwrite'),s=tx.objectStore('files'),r=s.get(id);r.onsuccess=()=>{if(r.result&&r.result.userId===S.user.id){r.result.firmId=firmId;s.put(r.result)}};tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})))}catch(e){this.warn();this.memory.forEach(x=>{if(ids.includes(x.id))x.firmId=firmId})}};
async function fileText(file){const ext=String(file.name.split('.').pop()||'').toLowerCase();if(ext==='docx')return null;if(ext==='xlsx'||ext==='xls'){if(!window.XLSX)throw new Error(`${file.name}: Excel support could not be loaded`);const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=wb.Sheets[wb.SheetNames[0]];return XLSX.utils.sheet_to_csv(sheet)}return file.text()}
function detectedFileType(text){if(!text)return null;const rows=parseCSV(text);return rows.length?detectType(rows[0].map(canon)):null}
let fileFilters={q:'',type:'all',sort:'newest'},selectedFiles=new Set();
function loadFileFilters(){try{fileFilters={...fileFilters,...JSON.parse(localStorage.getItem(`lilact.files.filters.${S.user.id}`)||'{}')}}catch(e){}}
function saveFileFilters(){try{localStorage.setItem(`lilact.files.filters.${S.user.id}`,JSON.stringify(fileFilters))}catch(e){}}
function openDataScreen(tab='files'){S.view='data';$('#work').hidden=true;$('#dataScreen').hidden=false;$('#filesTab').classList.toggle('on',tab==='files');$('#filesTab').setAttribute('aria-selected',tab==='files');$('#businessesTab').classList.toggle('on',tab==='businesses');$('#businessesTab').setAttribute('aria-selected',tab==='businesses');$('#dataFiles').hidden=tab!=='files';$('#dataBusinesses').hidden=tab!=='businesses';syncViewNav();if(tab==='files')renderFiles();else renderData()}
function closeDataScreen(){S.view='chat';$('#dataScreen').hidden=true;$('#work').hidden=false;syncViewNav()}
$('#dataBack').onclick=closeDataScreen;
$('#filesTab').onclick=()=>openDataScreen('files');$('#businessesTab').onclick=()=>openDataScreen('businesses');
$('#dataAddSources').onclick=()=>$('#dataFileInput').click();
async function acceptFiles(files,{firmId=S.firm}={}){const out=[];for(const f of files){try{const ext=String(f.name.split('.').pop()||'').toLowerCase();if(!FILE_EXTS.has(ext))throw new Error(`${f.name}: unsupported file type. Choose CSV, XLSX, XLS or DOCX.`);if(f.size>FILE_MAX)throw new Error(`${f.name}: file exceeds the 10 MB limit.`);const text=ext==='docx'?null:await fileText(f),detected=detectedFileType(text),status=ext==='docx'?'Reference only':detected?'Pending review':'Not recognised';out.push(await FILES.put(f,{firmId,status}))}catch(e){toast(e.message||`Could not read ${f.name}`)}}return out}
$('#dataFileInput').onchange=async e=>{const added=await acceptFiles([...e.target.files]);e.target.value='';if(!added.length)return;renderFiles();const r=await autoImportFiles();toast(importNote(added.length,r));renderFiles()};
function sizeLabel(n){if(n<1024)return `${n} B`;if(n<1024*1024)return `${(n/1024).toFixed(0)} KB`;return `${(n/1024/1024).toFixed(1)} MB`}
// The toolbar (search, type filter, sort) is built once per account and never replaced, so typing or choosing a filter always
// acts on live controls; each render only rewrites the list. Only the latest asynchronous render may write the screen.
let filesRenderToken=0;
function filesToolbar(root){
  root.dataset.uid=S.user.id;loadFileFilters();
  root.innerHTML=`<div class="files-toolbar"><label class="sr" for="filesSearch">Search files</label><input id="filesSearch" type="search" placeholder="Search files by name"><label class="sr" for="filesType">Filter by file type</label><select id="filesType"><option value="all">All types</option><option value="docx">Word (.docx)</option><option value="tables">Excel &amp; CSV (.xlsx, .xls, .csv)</option></select><label class="sr" for="filesSort">Sort files</label><select id="filesSort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="alpha">Alphabetical</option></select></div><div class="file-selection" id="fileSelection" hidden></div><div id="filesList"></div>`;
  const q=$('#filesSearch',root),ty=$('#filesType',root),so=$('#filesSort',root);q.value=fileFilters.q;ty.value=fileFilters.type;so.value=fileFilters.sort;
  q.oninput=()=>{fileFilters.q=q.value;saveFileFilters();renderFiles()};ty.onchange=()=>{fileFilters.type=ty.value;saveFileFilters();renderFiles()};so.onchange=()=>{fileFilters.sort=so.value;saveFileFilters();renderFiles()};
}
function renderFiles(){if($('#dataScreen').hidden)return Promise.resolve();const root=$('#dataFiles');if(root.dataset.uid!==S.user.id||!$('#filesList',root))filesToolbar(root);
  const tok=++filesRenderToken;return FILES.list().then(files=>{if(tok!==filesRenderToken)return;
  const filtered=files.filter(f=>(!fileFilters.q||f.name.toLowerCase().includes(fileFilters.q.toLowerCase()))&&(fileFilters.type==='all'||(fileFilters.type==='docx'?f.ext==='docx':['csv','xlsx','xls','txt'].includes(f.ext))));
  filtered.sort((a,b)=>fileFilters.sort==='oldest'?Date.parse(a.uploadedAt)-Date.parse(b.uploadedAt):fileFilters.sort==='alpha'?a.name.localeCompare(b.name):Date.parse(b.uploadedAt)-Date.parse(a.uploadedAt));
  const empty=!files.length,none=!filtered.length;const row=f=>`<tr data-file-row="${esc(f.id)}"><td><input type="checkbox" class="file-select" value="${esc(f.id)}" aria-label="Select ${esc(f.name)}" ${selectedFiles.has(f.id)?'checked':''}></td><td><span class="file-name"><span aria-hidden="true">${f.kind==='document'?'▤':'▦'}</span><b>${esc(f.name)}</b></span></td><td>${f.ext.toUpperCase()}</td><td>${sizeLabel(f.size)}</td><td>${new Date(f.uploadedAt).toLocaleString('en-GB')}</td><td><span class="status ${f.status.startsWith('Used')?'green':f.status==='Not recognised'||f.status.startsWith('Waiting')||f.status.startsWith('Missing')||f.status.startsWith('Could not')?'amber':f.kind==='document'?'blue':'gray'}">${esc(fileStatusLabel(f.status))}</span></td><td><button type="button" class="file-delete" aria-label="Delete ${esc(f.name)}" data-file-delete="${esc(f.id)}">⌫</button></td></tr>`;
  const list=$('#filesList',root);
  list.innerHTML=empty?`<div class="files-empty"><b>No files uploaded yet</b><button class="btn primary" type="button" data-empty-add>Add sources</button></div>`:none?`<div class="files-empty"><b>No files match your search</b><button class="btn sec" type="button" data-clear-filters>Clear filters</button></div>`:`<div class="files-table-wrap"><table class="files-table"><thead><tr><th><input id="filesSelectAll" type="checkbox" aria-label="Select all visible files"></th><th>Name</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map(row).join('')}</tbody></table></div>`;
  const boxes=$$('.file-select',list),all=$('#filesSelectAll',list);if(all){const count=boxes.filter(x=>x.checked).length;all.checked=boxes.length>0&&count===boxes.length;all.indeterminate=count>0&&count<boxes.length;all.onchange=()=>{boxes.forEach(x=>{x.checked=all.checked;if(all.checked)selectedFiles.add(x.value);else selectedFiles.delete(x.value)});renderFiles()}}
  boxes.forEach(x=>x.onchange=()=>{x.checked?selectedFiles.add(x.value):selectedFiles.delete(x.value);renderFiles()});
  const bar=$('#fileSelection',root);bar.hidden=!selectedFiles.size;bar.innerHTML=selectedFiles.size?`<b>${selectedFiles.size} selected</b><button type="button" class="btn danger sm" id="deleteSelected">Delete selected</button><button type="button" class="btn sec sm" id="clearSelected">Clear</button>`:'';
  if(selectedFiles.size){$('#deleteSelected').onclick=()=>confirmDeleteFiles([...selectedFiles]);$('#clearSelected').onclick=()=>{selectedFiles.clear();renderFiles()}}
  $$('[data-file-delete]',list).forEach(b=>b.onclick=()=>confirmDeleteFiles([b.dataset.fileDelete]));$('[data-empty-add]',list)?.addEventListener('click',()=>$('#dataFileInput').click());
  $('[data-clear-filters]',list)?.addEventListener('click',()=>{fileFilters={q:'',type:'all',sort:fileFilters.sort};saveFileFilters();$('#filesSearch',root).value='';$('#filesType',root).value='all';renderFiles()});
})}
function confirmDeleteFiles(ids){openModal(`<h3>Delete ${ids.length} ${ids.length===1?'file':'files'}?</h3><p>Data already used in your analysis is kept.</p><div class="acts"><button class="btn sec" id="filesNo">Cancel</button><button class="btn danger" id="filesYes">Delete</button></div>`,m=>{$('#filesNo',m).onclick=closeModal;$('#filesYes',m).onclick=async()=>{await FILES.remove(ids);selectedFiles.clear();closeModal();addLog({tool:'delete_files',tier:1,args:{count:ids.length},status:'ok',summary:`Deleted ${ids.length} uploaded file${ids.length===1?'':'s'}`});toast(`${ids.length} file${ids.length===1?'':'s'} deleted`);renderFiles()}})}
const DW={view:'list',firmId:null,files:{},fmt:'auto',mode:'replace',form:{},pick:{},err:'',registryIds:[]};
const fmtVND=n=>n==null||isNaN(n)?'–':nf(n/1e6,1)+'M';
function nextFirmId(d){let n=1;while(d.firms['U'+String(n).padStart(2,'0')])n++;return 'U'+String(n).padStart(2,'0')}
function startImport(firmId){
  DW.view='import';DW.firmId=firmId||null;DW.files={};DW.registryIds=[];DW.fmt='auto';DW.mode=firmId?'upsert':'replace';DW.pick={};DW.err='';
  const f=firmId?dstore.load().firms[firmId]:null,snap=f&&activeSnap(f);
  DW.form=f?{name:f.name,industry:f.industry||'',buffer:f.buffer,asOf:snap.asOf,rev:snap.tables.fin[0].rev,cogs:snap.tables.fin[0].cogs,cash0:snap.tables.fin[0].cash0!=null?snap.tables.fin[0].cash0:snap.tables.fin[0].opening,touched:{}}
    :{name:'',industry:'',buffer:'',asOf:'',rev:'',cogs:'',cash0:'',touched:{}};
  openDataScreen('businesses');
}
async function openReviewImport(ids){const firmId=['F01','F02','F03'].includes(S.firm)?null:S.firm;startImport(firmId);for(const id of ids){const rec=await FILES.get(id);if(!rec||!rec.blob)continue;try{const text=await fileText(rec.blob),rows=text&&parseCSV(text);if(rows&&rows.length>1&&detectedFileType(text)){addRaw(rec.name,text);DW.registryIds.push(id)}}catch(e){toast(e.message||`Could not read ${rec.name}`)}}DW._refresh&&DW._refresh()}
function addRaw(name,text){
  const rows=parseCSV(text);if(rows.length<2){toast(`${name}: file is empty or has only a header`);return}
  const hdr=rows[0].map(canon),type=detectType(hdr);
  if(!type){toast(`${name}: data type not recognised (check the column names against the sample file)`);return}
  DW.files[type]={name,hdr,rows:rows.slice(1)};
}
function evalImport(){
  const fs=DW.files,res={tables:{},issues:{},ids:{}};

  const allDates=[];
  Object.entries(fs).forEach(([t,f])=>{
    const fi=f.hdr.indexOf('firm_id');
    f.ids=fi>=0?[...new Set(f.rows.map(r=>String(r[fi]||'').trim()).filter(Boolean))]:[];
    ['issue_date','due_date','paid_date'].forEach(h=>{const i=f.hdr.indexOf(h);if(i>=0)f.rows.forEach(r=>{if(String(r[i]||'').trim())allDates.push(r[i])})});
  });
  const det=detectFmt(allDates),fmt=DW.fmt==='auto'?det.fmt:DW.fmt;
  const ids=[...new Set(Object.values(fs).flatMap(f=>f.ids))];
  const pick=DW.pick.firm&&ids.includes(DW.pick.firm)?DW.pick.firm:ids[0];
  Object.entries(fs).forEach(([t,f])=>{
    const fi=f.hdr.indexOf('firm_id');
    const rows=fi>=0&&ids.length>1?f.rows.filter(r=>String(r[fi]||'').trim()===pick):f.rows;
    const miss=TYPES[t].need.filter(h=>!f.hdr.includes(h));if(TYPES[t].needOne&&!TYPES[t].needOne.some(h=>f.hdr.includes(h)))miss.push(TYPES[t].needOne.join(' or '));
    if(miss.length){res.issues[t]={fatalMissing:miss,list:[],skipped:rows.length};return}
    const n=normTable(t,f.hdr,rows,fmt);res.tables[t]=n.rows;res.issues[t]={list:n.issues,skipped:n.skipped,total:rows.length};
  });
  return {...res,det,fmt,ids,pick};
}
function formDefaults(ev){
  const F=DW.form,T=ev.tables;
  if(T.firms&&T.firms[0]){const x=T.firms[0];if(!F.touched.name&&!F.name)F.name=x.name||F.name;if(!F.touched.industry&&!F.industry)F.industry=x.industry||'';if(!F.touched.buffer&&(F.buffer===''||F.buffer==null)&&x.buffer>=0)F.buffer=x.buffer}
  if(T.financials&&T.financials[0]){const x=T.financials[0];if(!F.touched.rev)F.rev=x.rev;if(!F.touched.cogs)F.cogs=x.cogs;if(!F.touched.cash0&&x.opening!=null)F.cash0=x.opening}
  if(!F.touched.asOf){const ds=[...(T.sales||[]),...(T.purchases||[])].flatMap(r=>[r.issue,r.paid]).filter(Boolean).sort();if(ds.length)F.asOf=ds[ds.length-1]}
}
function previewHTML(ev){
  const base=DW.firmId?activeSnap(dstore.load().firms[DW.firmId]):null;
  let h='';
  const rowsF=Object.entries(DW.files).map(([t,f])=>{
    const is=ev.issues[t]||{list:[]},n=ev.tables[t]?ev.tables[t].length:0;
    const fatal=is.list.filter(x=>x.fatal),warn=is.list.filter(x=>!x.fatal);
    let st='';
    if(is.fatalMissing)st=`<span class="status red">Missing columns: ${is.fatalMissing.join(', ')}</span>`;
    else st=`<span class="status green">${n} valid rows</span>${is.skipped?`<span class="status amber">${is.skipped} rows skipped</span>`:''}${warn.length?`<span class="status gray">${warn.length} warnings</span>`:''}`;
    let mg='';
    if(DW.firmId&&ev.tables[t]&&base){const m=t==='financials'||t==='firms'?null:mergeTable(t,base.tables[{financials:'fin',firms:'x'}[t]||t],ev.tables[t],DW.mode);if(m)mg=`<div class="dd-m">${m.st.added} new · ${m.st.updated} updated${DW.mode==='upsert'?` · ${m.st.kept} unchanged`:` · ${m.st.removed} dropped`}</div>`}
    const lst=[...fatal,...warn].slice(0,4).map(x=>`<li class="${x.fatal?'f':''}">Row ${x.line}: ${esc(x.msg)}</li>`).join('');
    return `<div class="dd-file"><div class="dd-fh"><b>${esc(TYPES[t].label)}</b><small>${esc(DW.files[t].name)}</small><button class="x" data-rm="${t}" aria-label="Remove file">✕</button></div><div class="dd-st">${st}</div>${mg}${lst?`<ul class="dd-il">${lst}${is.list.length>4?`<li>…and ${is.list.length-4} more</li>`:''}</ul>`:''}</div>`}).join('');
  h+=rowsF||'<div class="empty" style="padding:14px">No files yet. Drop a CSV file in the box above, paste CSV content, or load the sample dataset.</div>';
  return h;
}
function renderData(){
  const p=$('#dataBusinesses');const d=dstore.load();
  if(!S.user){p.innerHTML='';return}
  if(DW.view==='import')return renderImport(p);
  if(DW.view==='hist')return renderHist(p,d);
  const firms=Object.values(d.firms);
  p.innerHTML=`
  <div class="card-head"><div><h3>Company data</h3><p>Upload your own data. Each save creates a <b>snapshot</b> with a version number; Copilot always uses the active snapshot, and you can roll back to an older one.</p></div><button class="btn primary" id="dNew">＋ Add business</button></div>
  ${firms.length?`<div class="dfirms">${firms.map(f=>{const s=activeSnap(f);return `<div class="card dfirm ${S.firm===f.id?'cur':''}">
     <div class="dfh"><div><b>${esc(f.name)}</b><small>${f.id}${f.industry?' · '+esc(f.industry):''}</small></div>${S.firm===f.id?'<span class="status blue">In use</span>':''}</div>
     <div class="dfk"><span>Version <b>${s.id}</b> · as of <b>${fd(s.asOf)}</b></span><span>${s.tables.sales.length} sales inv. · ${s.tables.purchases.length} purchase inv. · ${s.tables.inventory.length} stock lines · ${s.tables.planned.length} plan lines</span><span>Save ${new Date(s.ts).toLocaleString('en-GB')} · ${f.snaps.length} snapshot</span></div>
     <div class="dfa"><button class="btn primary sm" data-use="${f.id}">Open in Copilot</button><button class="btn sec sm" data-upd="${f.id}">Update data</button><button class="btn sec sm" data-hist="${f.id}">History</button><button class="btn sec sm" data-exp="${f.id}">Export CSV</button><button class="btn sec sm danger" data-del="${f.id}">Delete</button></div></div>`}).join('')}</div>`
  :`<div class="card"><div class="empty"><div class="big">⇪</div><b>You have no businesses yet</b><br>Add a business, then upload 3–6 CSV files: (sales invoices, purchase invoices, inventory, 13-week plan, financial statements). No files? Use the sample set to try it.<br><br><button class="btn primary" id="dNew2">＋ Add business</button></div></div>`}
  <div class="foot-note">Data is stored in this browser, per signed-in account; not synced across devices. A production version needs a server-side database, per-business permissions and encryption. The three businesses F01–F03 are fixed sample data and cannot be edited. Figures from your files are <b>estimates</b> based on the synthetic catalogue. ${DISC}</div>`;
  $('#dNew')&&($('#dNew').onclick=()=>startImport(null));$('#dNew2')&&($('#dNew2').onclick=()=>startImport(null));
  $$('[data-use]',p).forEach(b=>b.onclick=()=>{switchContext(b.dataset.use,'base');addLog({tool:'get_firm_context',tier:0,args:{firm_id:b.dataset.use},status:'ok',summary:'Open uploaded data'});toast('In use '+FIRMS[b.dataset.use].short);renderData()});
  $$('[data-upd]',p).forEach(b=>b.onclick=()=>startImport(b.dataset.upd));
  $$('[data-hist]',p).forEach(b=>b.onclick=()=>{DW.view='hist';DW.firmId=b.dataset.hist;renderData()});
  $$('[data-exp]',p).forEach(b=>b.onclick=()=>exportFirm(b.dataset.exp));
  $$('[data-del]',p).forEach(b=>b.onclick=()=>{const f=d.firms[b.dataset.del];
    openModal(`<h3>Delete "${esc(f.name)}"?</h3><p style="color:var(--muted);font-size:13px;margin:8px 0 16px">Delete all ${f.snaps.length} snapshots of this business from this browser. This cannot be undone. Export CSV first if you need to keep them.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="mNo">Cancel</button><button class="btn danger" id="mYes">Delete</button></div>`,m=>{
      m.querySelector('#mNo').onclick=closeModal;
      m.querySelector('#mYes').onclick=()=>{const dd=dstore.load();delete dd.firms[f.id];dstore.save(dd);closeModal();const was=S.firm===f.id;syncUserFirms();if(was)switchContext('F01','base');addLog({tool:'delete_company_data',tier:2,args:{firm_id:f.id},status:'ok',summary:'Delete data '+f.name});toast('Deleted '+f.name);renderData()}})});
}
function renderHist(p,d){
  const f=d.firms[DW.firmId];if(!f){DW.view='list';return renderData()}
  p.innerHTML=`<div class="card-head"><div><h3>Snapshot history</h3><p>${esc(f.name)} · ${f.id}. The active snapshot determines every figure Copilot answers with.</p></div><button class="btn sec sm" id="dBack">← Back</button></div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>Version</th><th>Saved at</th><th>Cut-off date</th><th>Source</th><th>Rows</th><th></th></tr></thead><tbody>
  ${f.snaps.slice().reverse().map(s=>`<tr class="${s.id===f.active?'top1':''}"><td><b>${s.id}</b>${s.id===f.active?' <span class="status green">Active</span>':''}</td><td>${new Date(s.ts).toLocaleString('en-GB')}</td><td class="num">${fd(s.asOf)}</td><td>${esc(s.label)}</td><td class="num">${s.tables.sales.length}/${s.tables.purchases.length}/${s.tables.inventory.length}/${s.tables.planned.length}</td>
  <td style="white-space:nowrap">${s.id!==f.active?`<button class="btn sec sm" data-act="${s.id}">Apply this version</button> <button class="btn sec sm danger" data-rm="${s.id}">Delete</button>`:''}</td></tr>`).join('')}
  </tbody></table></div><div class="foot-note">Rows = sales inv. / purchase inv. / stock / plan. Keeps the latest 10 snapshots.</div></div>`;
  $('#dBack').onclick=()=>{DW.view='list';renderData()};
  $$('[data-act]',p).forEach(b=>b.onclick=()=>{const dd=dstore.load();dd.firms[f.id].active=b.dataset.act;if(dstore.save(dd)){syncUserFirms();if(S.firm===f.id)switchContext(f.id,'base');addLog({tool:'activate_snapshot',tier:1,args:{firm_id:f.id,snapshot:b.dataset.act},status:'ok',summary:'Back to version '+b.dataset.act});toast('Applied version '+b.dataset.act);renderData()}});
  $$('[data-rm]',p).forEach(b=>b.onclick=()=>{const dd=dstore.load();dd.firms[f.id].snaps=dd.firms[f.id].snaps.filter(s=>s.id!==b.dataset.rm);dstore.save(dd);renderData()});
}
function dlFile(name,text,mime='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+text],{type:mime+';charset=utf-8'}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
const csvCell=v=>{v=v==null?'':String(v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const csvOf=(hdr,rows)=>[hdr.join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\n');
function exportFirm(id){
  const f=dstore.load().firms[id],s=activeSnap(f),T=s.tables,fin=T.fin[0];
  dlFile(`${id}_sales_invoices.csv`,csvOf(TYPES.sales.cols,T.sales.map(r=>[r.id,r.buyer,r.amt,r.issue,r.due,r.paid])));
  setTimeout(()=>dlFile(`${id}_purchase_invoices.csv`,csvOf(TYPES.purchases.cols,T.purchases.map(r=>[r.id,r.supplier,r.amt,r.issue,r.due,r.paid,'',''])) ),250);
  setTimeout(()=>dlFile(`${id}_inventory.csv`,csvOf(TYPES.inventory.cols,T.inventory.map(r=>[r.name,r.qty,r.unit,r.days]))),500);
  setTimeout(()=>dlFile(`${id}_planned_flows.csv`,csvOf(TYPES.planned.cols,T.planned.map(r=>[r.week,r.type==='in'?'inflow':'outflow',r.cat,r.amt]))),750);
  setTimeout(()=>dlFile(`${id}_financials.csv`,csvOf(TYPES.financials.cols,[[fin.period||(fin.period_start&&fin.period_end?fin.period_start+'..'+fin.period_end:fin.days?fin.days+' days':''),fin.rev,fin.cogs,fin.cash0!=null?fin.cash0:fin.opening]])),1000);
  toast('Loading the 5 CSV files of version '+s.id);
}
const SAMPLE_FILES=()=>({
  'firms.csv':'name,industry,min_cash_buffer_vnd\nABC Sample Upload Co.,Packaging manufacturing,400000000',
  'financials.csv':'period,revenue_vnd,cogs_vnd,opening_cash_vnd\nQ3-2026 (90 days),9000000000,7200000000,900000000',
  'sales_invoices.csv':'invoice_id,buyer,amount_vnd,issue_date,due_date,paid_date\nS-001,Customer K1,1200000000,2026-08-12,2026-10-14,\nS-002,Customer K2,900000000,2026-09-02,2026-10-20,\nS-003,Customer K1,700000000,2026-09-15,2026-11-12,\nS-004,Customer K3,500000000,2026-09-18,2026-11-18,\nS-005,Customer K2,600000000,2026-07-20,2026-09-18,2026-09-19\nS-006,Customer K3,350000000,2026-08-01,2026-09-25,',
  'purchase_invoices.csv':'invoice_id,supplier,amount_vnd,issue_date,due_date,paid_date,early_discount_pct,discount_days\nP-001,Supplier P1,1400000000,2026-09-10,2026-10-10,,2,10\nP-002,Supplier P2,800000000,2026-09-12,2026-10-12,,1.5,7\nP-003,Supplier P1,500000000,2026-09-20,2026-10-30,,0,0',
  'inventory.csv':'product_line,qty,unit_cost_vnd,days_in_stock\nPaper rolls,20000,60000,30\nInk and glue,8000,50000,40\nAged finished goods,10000,45000,95',
  'planned_flows.csv':'week,flow_type,category,amount_vnd\n1,inflow,Retail sales,300000000\n1,outflow,Payroll and operations,350000000\n2,inflow,Retail sales,300000000\n2,outflow,Payroll and operations,350000000\n3,inflow,Retail sales,300000000\n3,outflow,Payroll and operations,350000000\n4,outflow,Tax and insurance,300000000'
});
function renderImport(p){
  const upd=!!DW.firmId,F=DW.form;
  p.innerHTML=`
  <div class="card-head"><div><h3>${upd?'Update data':'Add business'}</h3><p>${upd?`Upload new files for <b>${esc(F.name)}</b>. Results are saved as a new snapshot; older ones are kept so you can roll back.`:'Step 1: upload files. Step 2: review. Step 3: save.'}</p></div><button class="btn sec sm" id="dBack">← Back</button></div>
  <div class="card" id="dz" tabindex="0"><div class="dz"><b>Drop CSV files here</b> or <button class="lnk" id="dPick" type="button">browse files</button><small>Multiple files at once are fine. The system detects each file type from its column names. UTF-8 with comma, semicolon or tab separators is supported.</small>
   <input type="file" id="dFile" accept=".csv,.txt,.xlsx,.xls,.docx" multiple hidden></div>
   <div class="dz-act"><button class="btn sec sm" id="dPaste">Paste CSV content</button><button class="btn sec sm" id="dSample">Load sample dataset</button>
   <span class="dz-tpl">Sample file: ${Object.entries(TYPES).filter(([k])=>k!=='firms').map(([k,t])=>`<button class="lnk" data-tpl="${k}" type="button">${t.file}</button>`).join(' · ')}</span></div>
   <div id="dPasteBox" hidden><textarea id="dPasteTa" rows="5" placeholder="The first row is the column header, for example: invoice_id,buyer,amount_vnd,issue_date,due_date,paid_date"></textarea><button class="btn primary sm" id="dPasteOk">Read content</button></div></div>
  <div id="dPrev"></div>
  <div class="card" style="margin-top:12px"><div class="card-head"><div><h3>Company information</h3><p>Auto-filled from the file when available; edit directly if needed.</p></div></div>
   <div class="dform">
    <label>Business name<input id="fName" value="${esc(F.name)}" ${upd?'':'required'}></label>
    <label>Industry<input id="fInd" value="${esc(F.industry)}"></label>
    <label>Minimum buffer (VND)<input id="fBuf" inputmode="numeric" value="${F.buffer===''?'':F.buffer}" placeholder="500000000"></label>
    <label>Data cut-off date<input id="fAsOf" type="date" value="${F.asOf||''}"></label>
    <label>Revenue for the period (VND)<input id="fRev" inputmode="numeric" value="${F.rev===''?'':F.rev}"></label>
    <label>COGS for the period (VND)<input id="fCogs" inputmode="numeric" value="${F.cogs===''?'':F.cogs}"></label>
    <label>Cash at cut-off (VND)<input id="fCash" inputmode="numeric" value="${F.cash0===''?'':F.cash0}"></label>
    <label>Date format in file<select id="fFmt"><option value="auto">Auto-detect</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></select></label>
   </div><div id="dMsg"></div></div>
  ${upd?`<div class="card" style="margin-top:12px"><div class="card-head"><div><h3>Update mode</h3><p>Applies to each table you upload. Tables you do not upload stay unchanged.</p></div></div>
   <div class="dmode"><label class="dm ${DW.mode==='upsert'?'on':''}"><input type="radio" name="dmode" value="upsert" ${DW.mode==='upsert'?'checked':''}><span><b>Merge by key</b><small>Rows with the same key (invoice ID, item name, week+type+category) are overwritten, new rows are added, and rows missing from the file are kept. Good for adding new invoices or marking them paid.</small></span></label>
   <label class="dm ${DW.mode==='replace'?'on':''}"><input type="radio" name="dmode" value="replace" ${DW.mode==='replace'?'checked':''}><span><b>Replace whole table</b><small>The uploaded table fully replaces the old one. Good when you re-export everything from your accounting software.</small></span></label></div></div>`:''}
  <div class="dsave"><button class="btn primary" id="dSave">${upd?'Save as new snapshot':'Create business and save first snapshot'}</button><span id="dSaveNote" class="subtle"></span></div>`;
  $('#fFmt').value=DW.fmt;
  const refresh=()=>{
    const ev=evalImport();formDefaults(ev);
    $('#dPrev').innerHTML=`<div class="card" style="margin-top:12px"><div class="card-head"><div><h3>Review files</h3><p>${Object.keys(DW.files).length} files received.</p></div></div>${ev.ids.length>1?`<div class="callout"><span>ℹ</span><div>The file contains ${ev.ids.length} business IDs. Choose the one to load: <select id="fPick">${ev.ids.map(i=>`<option ${i===ev.pick?'selected':''}>${esc(i)}</option>`).join('')}</select></div></div>`:''}${previewHTML(ev)}</div>`;
    const msgs=[];
    if(ev.det.mixed)msgs.push('Dates in the file mix DD/MM and MM/DD styles. Choose the format in the field below, then check again.');
    else if(!ev.det.sure&&DW.fmt==='auto'&&Object.keys(DW.files).length)msgs.push('A date like 5/10/2026 cannot be told apart as DD/MM or MM/DD. Reading it as DD/MM/YYYY; change the "Date format" field if wrong.');
    $('#dMsg').innerHTML=msgs.map(m=>`<div class="callout warn"><span>⚠</span><div>${m}</div></div>`).join('');
    ['fName','fInd','fBuf','fAsOf','fRev','fCogs','fCash'].forEach(id=>{const k={fName:'name',fInd:'industry',fBuf:'buffer',fAsOf:'asOf',fRev:'rev',fCogs:'cogs',fCash:'cash0'}[id];const e=$('#'+id);if(document.activeElement!==e)e.value=F[k]===null||F[k]===undefined?'':F[k]});
    $$('[data-rm]',$('#dPrev')).forEach(b=>b.onclick=()=>{delete DW.files[b.dataset.rm];refresh()});
    const pk=$('#fPick');pk&&(pk.onchange=()=>{DW.pick.firm=pk.value;refresh()});
    return ev;
  };
  DW._refresh=refresh;refresh();
  const bind=(id,k,num)=>$('#'+id).addEventListener('input',e=>{F.touched[k]=true;F[k]=num?(e.target.value===''?'':parseNum(e.target.value)):e.target.value});
  bind('fName','name');bind('fInd','industry');bind('fBuf','buffer',1);bind('fAsOf','asOf');bind('fRev','rev',1);bind('fCogs','cogs',1);bind('fCash','cash0',1);
  $('#fFmt').onchange=e=>{DW.fmt=e.target.value;F.touched.asOf=false;refresh()};
  $$('input[name=dmode]').forEach(r=>r.onchange=()=>{DW.mode=r.value;$$('.dm').forEach(x=>x.classList.toggle('on',x.querySelector('input').checked));refresh()});
  $('#dBack').onclick=()=>{DW.view='list';renderData()};
  const take=async fl=>{const accepted=await acceptFiles(fl);for(const rec of accepted){if(rec.kind==='document')continue;try{const text=await fileText(rec.blob),rows=text&&parseCSV(text);if(rows&&rows.length>1&&detectedFileType(text)){addRaw(rec.name,text);DW.registryIds.push(rec.id)}}catch(e){toast(e.message||`Could not read ${rec.name}`)}}F.touched.asOf=false;refresh();if(accepted.length)toast(`Received ${accepted.length} file${accepted.length===1?'':'s'}`)};
  $('#dPick').onclick=()=>$('#dFile').click();$('#dFile').onchange=e=>{take([...e.target.files]);e.target.value=''};
  const dz=$('#dz');['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('over')}));
  ['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('over')}));
  dz.addEventListener('drop',e=>take([...e.dataTransfer.files]));
  $('#dPaste').onclick=()=>{$('#dPasteBox').hidden=!$('#dPasteBox').hidden};
  $('#dPasteOk').onclick=()=>{const t=$('#dPasteTa').value;if(!t.trim())return;addRaw('Pasted content',t);$('#dPasteTa').value='';F.touched.asOf=false;refresh()};
  $('#dSample').onclick=()=>{Object.entries(SAMPLE_FILES()).forEach(([n,t])=>addRaw(n,t));F.touched={};if(!upd){F.name='';F.industry='';F.buffer=''}F.rev='';F.cogs='';F.cash0='';refresh()};
  $$('[data-tpl]').forEach(b=>b.onclick=()=>{const t=TYPES[b.dataset.tpl];dlFile(t.file,[t.cols.join(','),...t.sample].join('\n'))});
  $('#dSave').onclick=()=>saveImport(refresh());
}
function saveImport(ev){
  const F=DW.form,note=$('#dSaveNote'),upd=!!DW.firmId;
  const fail=m=>{note.textContent=m;note.style.color='var(--red,var(--lc-color-status-error))';toast(m)};
  const d=dstore.load(),f=upd?d.firms[DW.firmId]:null,base=f?activeSnap(f):null;
  const fatalFile=Object.entries(ev.issues).find(([t,i])=>i.fatalMissing);
  if(fatalFile)return fail(`${TYPES[fatalFile[0]].label}: missing column ${fatalFile[1].fatalMissing.join(', ')}`);
  const name=String(F.name||'').trim(),buf=F.buffer===''?NaN:+F.buffer,rev=+F.rev,cogs=+F.cogs,cash=F.cash0===''||F.cash0==null?NaN:+F.cash0;
  if(!name)return fail('Enter a business name');
  if(!(buf>=0))return fail('Enter the minimum buffer (a number ≥ 0)');
  if(!F.asOf||isNaN(dn(F.asOf)))return fail('Choose the data cut-off date');
  if(!(rev>=0)||!(cogs>=0)||F.rev===''||F.cogs==='')return fail('Enter revenue and COGS for the period (0 or more)');
  if(isNaN(cash))return fail('Enter cash at the cut-off date');
  const mode=upd?DW.mode:'replace',T={};
  [['sales','sales'],['purchases','purchases'],['inventory','inventory'],['planned','planned']].forEach(([t,k])=>{
    const up=ev.tables[t];T[k]=up?mergeTable(t,base?base.tables[k]:[],up,mode).rows:(base?base.tables[k]:[])});
  if(!T.sales.length&&!T.purchases.length&&!T.planned.length)return fail('At least one of these is required: sales invoices, purchase invoices, 13-week plan');
  const fin0=ev.tables.financials&&ev.tables.financials[0];
  const pf=fin0||(base&&base.tables.fin[0])||{};
  T.fin=[{rev,cogs,opening:cash,cash0:cash,period:pf.period||'',days:pf.days||null,period_start:pf.period_start||null,period_end:pf.period_end||null,current_assets:pf.current_assets??null,st_investments:pf.st_investments??null}];
  const id=upd?f.id:nextFirmId(d),fn=f||{id,created:Date.now(),snaps:[]};
  fn.name=name;fn.industry=String(F.industry||'').trim();fn.buffer=buf;
  const fx=ev.tables.firms&&ev.tables.firms[0];if(fx){if(fx.business_model)fn.business_model=fx.business_model;if(fx.position)fn.position=fx.position}
  const n=(fn.snaps.reduce((a,s)=>Math.max(a,s.n),0))+1;
  const snap={id:'v'+n,n,ts:Date.now(),asOf:F.asOf,files:Object.values(DW.files).map(x=>x.name),label:upd?(mode==='upsert'?'Merge by key':'Replace by table')+' · '+Object.keys(ev.tables).filter(t=>t!=='financials'&&t!=='firms').map(t=>TYPES[t].label.split(' (')[0]).join(', ')||'Edit details':'First load',tables:T};
  fn.snaps.push(snap);fn.active=snap.id;
  if(fn.snaps.length>10)fn.snaps=fn.snaps.filter((s,i)=>i>=fn.snaps.length-10||s.id===fn.active);

  try{const s=ENGINE.makeSnapshot(uploadInput(fn,snap)),c=ENGINE.buildCases(s).base;if(!c.days.length)throw new Error('empty')}catch(e){console.error(e);return fail('Could not build data from these files. Check the columns and dates.')}
  d.firms[id]=fn;if(!dstore.save(d))return;
  void FILES.markUsed(DW.registryIds,snap.id);void FILES.setFirm(DW.registryIds,id);DW.registryIds=[];
  syncUserFirms();DW.view='list';
  switchContext(id,'base');
  addLog({tool:upd?'update_company_data':'create_company_data',tier:1,args:{firm_id:id,snapshot:snap.id,mode},status:'ok',summary:`${name}: saved version ${snap.id}, cut-off ${fd(snap.asOf)}`});
  toast(`Saved version ${snap.id} for ${name}`);
  renderData();
}


const CATVN={invoice_receipt:'Customer collections',planned_inflow:'Planned inflows',supplier_payment:'Supplier payments',planned_outflow:'Planned outflows',payroll:'Payroll and allowances',rent:'Rent',utilities:'Utilities',new_materials:'New raw-material purchases',tax:'Tax',debt_service:'Loan repayments',capex:'Equipment investment'};
const lblCat=k=>CATVN[k]||k;
function weeklyModel(c){
  const A=dn(c.as_of),W=[];
  const H=Math.ceil(c.days.length/7),c0=c.cash0??openingCash(c);
  for(let w=0;w<H;w++){const ds=c.days.slice(7*w,7*(w+1)),lo=ds.reduce((a,d)=>d[1]<a[1]?d:a,ds[0]);W.push({w:w+1,start:A+1+7*w,end:A+7*(w+1),inn:0,out:0,open:w?c.days[7*w-1][1]:c0,bal:c.days[Math.min(7*(w+1),c.days.length)-1][1],min:lo[1],minDay:lo[0]})}
  const rows=new Map();
  c.ev.forEach(e=>{const d=dn(e[5]);if(d<=A)return;const w=Math.floor((d-A-1)/7);if(w<0||w>=H)return;
    const dir=e[1],k=dir+'|'+e[2];
    if(dir==='IN')W[w].inn+=e[4];else W[w].out+=e[4];
    let r=rows.get(k);if(!r){r={dir,cat:e[2],tot:0,wk:Array(H).fill(0),ch:new Map()};rows.set(k,r)}
    r.tot+=e[4];r.wk[w]+=e[4];
    if(e[2]==='invoice_receipt'||e[2]==='supplier_payment'){let ch=r.ch.get(e[3]);if(!ch){ch={name:e[3],tot:0,wk:Array(H).fill(0)};r.ch.set(e[3],ch)}ch.tot+=e[4];ch.wk[w]+=e[4]}});
  const groups=[...rows.values()].sort((a,b)=>b.tot-a.tot);
  groups.forEach(g=>{const arr=[...g.ch.values()].sort((a,b)=>b.tot-a.tot);g.kids=arr.slice(0,3);
    if(arr.length>3){const o={name:`Other (${arr.length-3})`,tot:0,wk:Array(H).fill(0)};arr.slice(3).forEach(x=>{o.tot+=x.tot;x.wk.forEach((v,i)=>o.wk[i]+=v)});g.kids.push(o)}});
  return {W,groups,A};
}
function agingModel(c){
  const A=dn(c.as_of),od=new Set(c.sales.filter(s=>s[4]===1&&(s[5]||0)>0).map(s=>s[0]));
  const B=['Overdue','≤ 7 days','8–14','15–30','31–60','61–91'],ar=Array(6).fill(0),ap=Array(6).fill(0);
  const ix=d=>d<=7?1:d<=14?2:d<=30?3:d<=60?4:5;
  c.sales.forEach(s=>{if(s[4]===1&&(s[5]||0)>0)ar[0]+=s[9]!=null?s[9]:s[2]});
  c.ev.forEach(e=>{const d=dn(e[5])-A;if(d<=0&&e[1]==='OUT'){ap[1]+=e[4];return}
    if(e[1]==='IN'&&e[2]==='invoice_receipt'){if(od.has(e[0]))return;ar[ix(d)]+=e[4]}
    else if(e[1]==='OUT'&&e[2]==='supplier_payment')ap[ix(d)]+=e[4]});
  return {B,ar,ap};
}
function gauge(v,max,color,unit,label,tip){
  const cx=100,cy=100,r=72,a0=135,sw=270,f=Math.max(0,Math.min(1,v/max)),P=(a,rr=r)=>[cx+rr*Math.cos(a*Math.PI/180),cy+rr*Math.sin(a*Math.PI/180)];
  const arc=(a,b)=>{const [x1,y1]=P(a),[x2,y2]=P(b);return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 ${b-a>180?1:0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`};
  const ang=a0+sw*f,[nx,ny]=P(ang,r-26),[bx,by]=P(ang,6);
  return `<div class="gcard card" data-wid="${label.toLowerCase()}" style="--gc:${color}"><div class="gt">${label}<span class="info" tabindex="0" data-tip="${esc(tip)}">i</span></div>
  <svg viewBox="0 0 200 168" role="img" aria-label="${label}: ${nf(v,1)} ${unit}"><path d="${arc(a0,a0+sw)}" fill="none" stroke="var(--lc-color-border-default)" stroke-width="22" stroke-linecap="butt"/>${f>0?`<path class="garc" pathLength="100" d="${arc(a0,Math.max(a0+.5,ang))}" fill="none" stroke="${color}" stroke-width="22"/>`:''}
  <g class="gneedle" style="--rot:${(-(sw*f)).toFixed(1)}deg"><line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--lc-color-text-primary)" stroke-width="5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="var(--lc-color-text-primary)"/></g>
  <text x="48" y="164" class="gl" text-anchor="middle">0</text><text x="152" y="164" class="gl" text-anchor="middle">${max}</text></svg>
  <div class="gv"><b class="num" data-v="${v}">${nf(v,1)}</b> ${unit}</div></div>`;
}
function spk(vals,color){
  const W=200,H=46,mx=Math.max(...vals,1),n=vals.length,X=i=>i*W/(n-1),Y=v=>H-3-v/mx*(H-8);
  const pts=vals.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
  return `<svg class="spk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${H} ${pts} ${W},${H}" fill="${color}" opacity=".10"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
const gapWeeks=(M,ep)=>new Set(ep&&!ep.none?M.W.filter(x=>x.end>=dn(ep.start)&&x.start<=dn(ep.end)).map(x=>x.w):[]);
function flowChartSVG(c,M,ep){
  const {W}=M,buf=c.buffer,rmin=RMIN(),Wd=900,Hd=250,l=44,r=10,t=14,b=26,iw=Wd-l-r,ih=Hd-t-b,hw=gapWeeks(M,ep);
  const mn=Math.min(0,...W.map(x=>x.bal),buf),mx=Math.max(...W.flatMap(x=>[x.inn,x.out,x.bal]),buf)*1.08,rg=(mx-mn)||1;
  const Y=v=>t+(mx-v)*ih/rg,step=iw/W.length,bw=Math.min(22,step*.32);
  const tk=(()=>{const raw=rg/4,p=Math.pow(10,Math.floor(Math.log10(raw))),m=[1,2,2.5,5,10].find(x=>x*p>=raw)*p,o=[];for(let v=Math.ceil(mn/m)*m;v<=mx;v+=m)o.push(v);return o})();
  let s=`<svg viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="Cash in, out and week-end balance over ${W.length} weeks">`;
  W.forEach((x,i)=>{if(hw.has(x.w))s+=`<rect class="gapwk" x="${(l+step*i+1).toFixed(1)}" y="${t}" width="${(step-2).toFixed(1)}" height="${ih}" rx="4"/>`});
  tk.forEach(v=>{s+=`<line x1="${l}" x2="${Wd-r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--lc-color-border-default)"/><text x="${l-6}" y="${Y(v)+3.5}" text-anchor="end" class="ax">${nf(Math.round(v/1e6)||0,0)}</text>`});
  s+=`<line x1="${l}" x2="${Wd-r}" y1="${Y(buf)}" y2="${Y(buf)}" stroke="var(--lc-color-status-error)" stroke-dasharray="5 4" stroke-width="1.2"/><text x="${Wd-r}" y="${Y(buf)-4}" text-anchor="end" class="ax" fill="var(--lc-color-status-error)">Rtarget ${nf(buf/1e6,0)}</text>`;
  W.forEach((x,i)=>{const cx=l+step*(i+.5),lv=alertLevel(x.bal,buf,rmin),ml=alertLevel(x.min,buf,rmin);
    s+=`<g class="wk" data-w="${x.w}" data-tt="${esc(`<b>Week ${x.w} · ${fds(isoOf(x.start))}–${fds(isoOf(x.end))}</b><i style='background:var(--lc-color-status-success)'></i>In ${mm(x.inn)}<br><i style='background:var(--lc-color-status-error)'></i>Out ${mm(x.out)}<br><i style='background:${LV[lv].color}'></i>Week-end balance ${mm(x.bal)} · ${LV[lv].label}<br><i style='background:${LV[ml].color}'></i>Lowest in week ${mm(x.min)} on ${fds(x.minDay)} · ${LV[ml].label}${hw.has(x.w)?`<br>Part of gap ${ep.k}`:''}`)}"><rect class="wkhit" x="${l+step*i}" y="${t}" width="${step}" height="${ih}"/>
    <rect class="bx" style="--bi:${i}" x="${cx-bw-1}" y="${Y(x.inn)}" width="${bw}" height="${Math.max(0,Y(0)-Y(x.inn))}" rx="3" fill="var(--lc-color-status-success-bg)" stroke="var(--lc-color-status-success)"/>
    <rect class="bx" style="--bi:${i}" x="${cx+1}" y="${Y(x.out)}" width="${bw}" height="${Math.max(0,Y(0)-Y(x.out))}" rx="3" fill="var(--lc-color-status-error-bg)" stroke="var(--lc-color-status-error)"/></g>
    <text x="${cx}" y="${Hd-9}" text-anchor="middle" class="ax${hw.has(x.w)?' gapax':''}">W${x.w}</text>`});
  const pts=W.map((x,i)=>[l+step*(i+.5),Y(x.bal)]);
  s+=`<polyline points="${pts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--lc-color-data-cash)" stroke-width="2.2"/>`;
  W.forEach((x,i)=>{s+=`<circle class="lvdot" data-lv="${alertLevel(x.bal,buf,rmin)}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="4.6" fill="${LV[alertLevel(x.bal,buf,rmin)].color}" stroke="var(--lc-color-bg-surface)" stroke-width="1.5"/>`});
  return s+'</svg>';
}
function agingSVG(A){
  const Wd=520,Hd=230,l=40,r=8,t=10,b=34,iw=Wd-l-r,ih=Hd-t-b,mx=Math.max(...A.ar,...A.ap,1)*1.1,Y=v=>t+(mx-v)*ih/mx,step=iw/A.B.length,bw=Math.min(24,step*.3);
  const raw=mx/4,p=Math.pow(10,Math.floor(Math.log10(raw))),m=[1,2,2.5,5,10].find(x=>x*p>=raw)*p;
  let s=`<svg viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="Receivables and payables by due bucket">`;
  for(let v=0;v<=mx;v+=m)s+=`<line x1="${l}" x2="${Wd-r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--lc-color-border-default)"/><text x="${l-5}" y="${Y(v)+3.5}" text-anchor="end" class="ax">${nf(v/1e6,0)}</text>`;
  A.B.forEach((lb,i)=>{const cx=l+step*(i+.5);
    s+=`<g class="ag" data-tt="${esc(`<b>${lb}</b><i style='background:var(--lc-color-data-receivables)'></i>Receivables ${mm(A.ar[i])}<br><i style='background:var(--lc-color-data-payables)'></i>Payables ${mm(A.ap[i])}`)}"><rect class="bx" style="--bi:${i}" x="${cx-bw-1}" y="${Y(A.ar[i])}" width="${bw}" height="${Y(0)-Y(A.ar[i])}" rx="2" fill="${i===0?'var(--lc-color-status-error)':'var(--lc-color-data-receivables)'}"/><rect class="bx" style="--bi:${i}" x="${cx+1}" y="${Y(A.ap[i])}" width="${bw}" height="${Y(0)-Y(A.ap[i])}" rx="2" fill="var(--lc-color-data-payables)"/><rect class="wkhit" x="${cx-step/2}" y="${t}" width="${step}" height="${ih}"/></g><text x="${cx}" y="${Hd-16}" text-anchor="middle" class="ax">${lb}</text>`});
  return s+`<text x="${(l+Wd-r)/2}" y="${Hd-2}" text-anchor="middle" class="ax" font-weight="700">Due in (days)</text></svg>`;
}
function flowTableHTML(c,M,ep){
  const {W,groups}=M,buf=c.buffer,rmin=RMIN(),hw=gapWeeks(M,ep),gw=w=>w&&hw.has(w)?' gapwk':'',daily=!(uc02()||{}).weekly_only;
  const cell=(v,cls='',w)=>`<td class="num ${cls}${gw(w)}"${w?` data-w="${w}"`:''}>${v?nf(v/1e6,1):'–'}</td>`;
  const head=`<thead><tr><th class="sticky">VND million</th>${W.map(x=>{const lv=alertLevel(x.bal,buf,rmin);return `<th data-w="${x.w}" data-lv="${lv}" class="lv-${lv}${gw(x.w)}" title="Week-end level: ${LV[lv].label}"><span><i class="lv-sw lv-${lv}" aria-hidden="true"></i>W${x.w}</span><small>${fds(isoOf(x.start))}</small></th>`}).join('')}<th>Total</th></tr></thead>`;
  const sec=(dir,title)=>{
    const gs=groups.filter(g=>g.dir===dir),tot=W.map(x=>dir==='IN'?x.inn:x.out),sum=tot.reduce((a,v)=>a+v,0);
    let h=`<tr class="grp ${dir}"><th class="sticky"><button type="button" class="tg" data-tg="${dir}" aria-expanded="true">▾ ${title}</button></th>${tot.map((v,i)=>cell(v,'',i+1)).join('')}${cell(sum)}</tr>`;
    gs.forEach((g,gi)=>{h+=`<tr class="cat ${dir}" data-par="${dir}"><th class="sticky">${g.kids.length?`<button type="button" class="tg sub" data-tg="${dir}${gi}" aria-expanded="false">▸ ${lblCat(g.cat)}</button>`:lblCat(g.cat)}</th>${g.wk.map((v,i)=>cell(v,'',i+1)).join('')}${cell(g.tot)}</tr>`;
      g.kids.forEach(k=>{h+=`<tr class="kid" data-par="${dir}" data-gp="${dir}${gi}" hidden><th class="sticky">${esc(k.name)}</th>${k.wk.map((v,i)=>cell(v,'',i+1)).join('')}${cell(k.tot)}</tr>`})});
    return h};
  const net=W.map(x=>x.inn-x.out);
  const lvCell=(v,lv,w,extra='',tip='')=>`<td class="num lvc lv-${lv}${gw(w)}" data-w="${w}" data-lv="${lv}" title="${tip||LV[lv].label}">${v<0?'−':''}${nf(Math.abs(v)/1e6,1)}${extra}</td>`;
  const body=`<tbody><tr class="grp open"><th class="sticky">Opening cash</th>${W.map(x=>`<td class="num${gw(x.w)}" data-w="${x.w}">${x.open<0?'−':''}${nf(Math.abs(x.open)/1e6,1)}</td>`).join('')}<td></td></tr>${sec('IN','Cash in')}${sec('OUT','Cash out')}
   <tr class="grp net"><th class="sticky">Net cash flow</th>${net.map((v,i)=>`<td class="num ${v<0?'neg':'pos'}${gw(i+1)}" data-w="${i+1}">${v<0?'−':''}${nf(Math.abs(v)/1e6,1)}</td>`).join('')}<td class="num">${nf(net.reduce((a,v)=>a+v,0)/1e6,1)}</td></tr>
   <tr class="grp end"><th class="sticky">Week-end balance</th>${W.map(x=>{const lv=alertLevel(x.bal,buf,rmin);return lvCell(x.bal,lv,x.w,'',`Week-end · ${LV[lv].label}`)}).join('')}<td></td></tr>
   ${daily?'':'<!--weekly_only-->'}<tr class="grp lowwk"${daily?'':' hidden'}><th class="sticky">Lowest in week <small>worst day</small></th>${W.map(x=>{const lv=alertLevel(x.min,buf,rmin);return lvCell(x.min,lv,x.w,`<small>${fds(x.minDay)}</small>`,`${fd(x.minDay)} · ${LV[lv].label}`)}).join('')}<td></td></tr></tbody>`;
  return `<div class="ftw"><table class="ft">${head}${body}</table></div>`;
}
function exportFlowCSV(c,M){
  const hdr=['Category',...M.W.map(x=>'Week '+x.w+' ('+isoOf(x.start)+')'),'Total'],rows=[];
  const add=(n,arr)=>rows.push([n,...arr.map(v=>Math.round(v)),Math.round(arr.reduce((a,v)=>a+v,0))]);
  add('Cash in',M.W.map(x=>x.inn));M.groups.filter(g=>g.dir==='IN').forEach(g=>add('  '+lblCat(g.cat),g.wk));
  add('Cash out',M.W.map(x=>x.out));M.groups.filter(g=>g.dir==='OUT').forEach(g=>add('  '+lblCat(g.cat),g.wk));
  rows.unshift(['Opening cash',...M.W.map(x=>Math.round(x.open)),'']);rows.push(['Week-end balance',...M.W.map(x=>Math.round(x.bal)),'']);
  rows.push(['Lowest in week (worst day)',...M.W.map(x=>Math.round(x.min)),'']);
  dlFile(`${S.firm}_${S.case}_cash_flow_${M.W.length}_weeks.csv`,csvOf(hdr,rows));
}
/* ===== SRS v1.3 · W axis (UC01), cash state TH (UC02) and the M1–M9 matrix =====
   A deterministic engine on the selected company's snapshot, always using the Base case.
   Values missing from the data use the SRS demo assumptions and are always labelled "provisional". */
// Constants used by the liquidity-state card; all values come from CFG (Appendix C).
const LIQ={thr:CFG.wc.thr,materiality:CFG.wc.materiality,rminRatio:CFG.liq.rminDefaultRatio,rupperRatio:CFG.liq.rupperDefaultRatio,th03Days:CFG.tv2.th03MinConsecutiveDays,nearRatio:CFG.bn.nearThresholdRatio};
const ITEM_EN={AR:'Receivables',INV:'Inventory',AP:'Payables'};
const W_EN={W0:'W0 – No signs yet',W1:'W1 – Watch',W2:'W2 – Material bottleneck',unknown:'Not enough data'};
const TH_EN={TH01:'TH01 – Cash shortfall',TH02:'TH02 – Balanced',TH03:'TH03 – Cash surplus',unknown:'Not determined'};
const BN_EN={BN0:'No bottleneck',BN1:'Receivables',BN2:'Inventory',BN3:'Payables',BN4:'Receivables + Inventory',BN5:'Receivables + Payables',BN6:'Inventory + Payables',BN7:'All three items',unknown:'Not determined'};
const MATRIX={W0:{TH01:'M1',TH02:'M2',TH03:'M3'},W1:{TH01:'M4',TH02:'M5',TH03:'M6'},W2:{TH01:'M7',TH02:'M8',TH03:'M9'}};
const M_EN={M1:'Short from timing mismatch',M2:'Balanced, no bottleneck',M3:'Surplus, no bottleneck',M4:'Short, signs to check',M5:'Balanced, signs to watch',M6:'Surplus, signs to watch',M7:'Short and materially blocked',M8:'Enough cash, capital tied up',M9:'Surplus and materially blocked'};
const baseCase=()=>DATA.cases[S.firm+'|base']||C();
// Opening available cash (Cash0): from the data when present, otherwise derived from the first day-end balance.
function openingCash(c){
  if(c.cash0!=null)return c.cash0;
  const d1=dn(c.days[0][0]),net=c.ev.filter(e=>dn(e[5])===d1).reduce((a,e)=>a+(e[1]==='IN'?e[4]:-e[4]),0);
  return c.days[0][1]-net;
}
// W axis and bottleneck pattern BN0–BN7 from the UC01 engine (sections 2.7.6–2.7.11). It never reads forecast balances:
// the two axes are independent. Short aliases (w, bn, main, mar, share) keep the card code readable.
function classifyW(){const d=uc01();return Object.assign({},d,{w:d.wc_class,bn:d.bn_pattern,main:d.main_bottleneck,mar:d.money_at_risk,share:d.materiality_share||0,model:d.model.model,modelDeclared:d.model.declared})}
// Cash state TH (section 2.8.12) from the UC02 run on Base, with Cash0 needed (Table 2-86) and SafeCash for the surplus branch.
function computeTH(c){
  const u=uc02();if(!u)return {th:'unknown'};const R=u.reserves,b=u.summary.base,T=u.th;
  const out={th:T.th,Rt:R.rtarget,Rmin:R.rmin,Rup:R.rupper,op:u.cash0.value,minC:b.min,minD:b.min_date,firstBelow:b.first_below_rtarget,firstNeg:b.first_negative,
    peakGap:b.peak_buffer,need:b.need_rtarget,needZero:b.need_zero,run:T.run||0,level:u.overall==='unknown'?'na':u.overall,reference:!!T.reference,status:u.status,src:R.src};
  out.shown=T.th==='TH03'?'blue':out.level;
  if(T.th==='TH03'){const base=DATA.cases[S.firm+'|base'],i0=base.days.findIndex(d=>d[0]===T.window[0]),i1=base.days.findIndex(d=>d[0]===T.window[1]);
    const scen=[base,DATA.cases[S.firm+'|stress_7']].filter(Boolean),gap=x=>x.days.slice(i0,i1+1).map(([,v])=>v-R.rtarget);
    out.safe=Math.max(0,Math.min(...scen.flatMap(gap)));   // SafeCash under the most adverse scenario (SRS 2.9.5.7)
    out.safeBase=Math.max(0,Math.min(...gap(base)));        // reference: Base case only
    out.window=T.window;out.scenN=scen.length}
  return out;
}
function wNoteHTML(){
  const W=classifyW(baseCase());
  if(W.w==='unknown')return `<div class="liq-note"><span>W</span><div><b>W axis: not enough data</b> to classify; no matrix cell is assigned.</div></div>`;
  return `<div class="liq-note ${W.w==='W0'?'ok':W.w==='W2'?'red':''}"><span>W</span><div><b>${W_EN[W.w]}</b> · bottleneck pattern ${W.bn} (${BN_EN[W.bn]})${W.main?` · main bottleneck: ${ITEM_EN[W.main]}`:''}${W.mar?` · capital above threshold ${money(W.mar)}, materiality ${pct(W.share)}`:''}${W.modelDeclared?'':' · default FOB thresholds – business model not confirmed'}. Provisional result.</div></div>`;
}
// Liquidity-state card at the top of the dashboard: rendered by cash state TH01 / TH02 / TH03 combined with the W axis.
function liquidityStateHTML(){
  const c=baseCase(),W=classifyW(c),T=computeTH(c),same=W.snapshot_id===(DATA.snaps[S.firm]||{}).snapshot_id,cell=same&&W.w!=='unknown'&&T.th!=='unknown'?MATRIX[W.w][T.th]:null;
  const main=W.main?ITEM_EN[W.main]:'',tile=(lb,v,sub,cls='')=>`<div class="ls-tile ${cls}"><span>${lb}</span><b class="num">${v}</b><small>${sub}</small></div>`;
  const marTile=W.mar>0?tile('Capital tied up above threshold',money(W.mar),`money_at_risk · ${main||'—'} · ${pct(W.share)} of current assets`,'hl'):tile('Capital tied up above threshold','0',`No item above its threshold (${W.bn})`);
  const grid=`<div class="ls-matrix" role="img" aria-label="Nine-case matrix, current cell ${cell||'not routed'}"><span></span><span class="h">TH01</span><span class="h">TH02</span><span class="h">TH03</span>${['W0','W1','W2'].map(w=>`<span class="h">${w}</span>${['TH01','TH02','TH03'].map(t=>`<span class="${MATRIX[w][t]===cell?'on':''}" title="${MATRIX[w][t]} · ${M_EN[MATRIX[w][t]]}">${MATRIX[w][t]}</span>`).join('')}`).join('')}</div>`;
  const chips=`<div class="ls-chips">${T.shown?`<span class="lv-pill lv-${T.shown}" data-lv="${T.shown}"><i class="lv-sw lv-${T.shown}" aria-hidden="true"></i>${T.shown==='blue'?'Blue · cash surplus':`Highest alert: ${LV[T.shown].label}`}</span>`:''}<span class="ls-w ${W.w}">${W_EN[W.w]}</span><span class="ls-chip">${TH_EN[T.th]}</span><span class="ls-chip">Pattern ${W.bn} · ${BN_EN[W.bn]}</span>${cell?`<span class="ls-chip strong">Cell ${cell} · ${M_EN[cell]}</span>`:`<span class="ls-chip">Not routed${same?'':' · W and TH use different snapshots'}</span>`}</div>`;
  let cls='unknown',icon='?',title='Liquidity state could not be routed',badge='',lead='',tiles='',body='',acts='';
  if(T.th==='TH01'){
    cls='th01 '+T.level;icon='⚠';title='Liquidity Shortfall Alert';badge=`Highest alert level: ${LV[T.level].label}`;
    lead=`In the Base case, the balance falls below the target level ${money(T.Rt)} from ${fd(T.firstBelow)}; lowest ${money(T.minC)} on ${fd(T.minD)}.`;
    tiles=tile('Peak shortfall',money(T.peakGap),`Vs Rtarget ${money(T.Rt)} · on ${fd(T.minD)}`)
      +tile('First negative-cash date',T.firstNeg?fd(T.firstNeg):'No negative cash',`Below target from ${fd(T.firstBelow)}`)
      +tile('Required Cash0',money(T.need),`Current ${money(T.op)} · additional ${money(Math.max(0,T.need-T.op))}`)+marTile;
    body={M1:'Short because of a timing mismatch in collections and payments: no item is above its threshold, so cover the short-term gap on the date cash is needed; no tied-up capital needs releasing.',
      M4:`Short of cash with signs to check in ${main}: cover the short-term gap and review the flagged items at the same time.`,
      M7:`Top priority: release capital tied up in ${main} (collections, inventory) alongside a funding source that arrives in time.`}[cell]||'';
    acts=`<button class="btn primary" type="button" data-liq="fund">Find financing to cover the gap →</button>`;
  }else if(T.th==='TH02'){
    cls='th02';icon='✓';title='Balanced Liquidity – Stable Operations';
    badge={M2:'Optimal state',M5:'Balanced, signs to watch',M8:'Cash Balanced but Capital Tied Up'}[cell]||'Balanced';
    lead=`In the Base case, the balance stays at or above the target level ${money(T.Rt)} and never stays above the ceiling ${money(T.Rup)} for 14 consecutive days.`;
    tiles=tile('Lowest balance',money(T.minC),`On ${fd(T.minD)}`)+tile('Headroom over target',money(T.minC-T.Rt),`Rtarget ${money(T.Rt)}`)+tile('Rupper ceiling',money(T.Rup),'Cash above this level is idle')+(cell==='M2'?'':marTile);
    body={M2:'The business keeps a safe cash buffer and no working-capital bottleneck was found.',
      M5:`Short-term liquidity is secure; there are signs to watch in ${main}, but they are below the materiality level. No funding needed yet.`,
      M8:`Short-term liquidity is secure, but a large amount of capital is tied up in ${main} (${vnd(W.mar)}). Improve collections and inventory turnover to prevent longer-term risk.`}[cell]||'';
  }else if(T.th==='TH03'){
    cls='th03';icon='◆';title='Safe Liquidity Surplus';badge='Reference (run-off)';
    lead=`The balance stays above the Rupper ceiling ${money(T.Rup)} for ${T.run} consecutive days (required ≥ ${LIQ.th03Days} days), from ${fd(T.window[0])} to ${fd(T.window[1])}. Run-off mode excludes new revenue and costs, so this surplus is for reference.`;
    tiles=tile('Safe idle cash (SafeCash)',money(T.safe),`Lowest in the surplus window, minus Rtarget, across ${T.scenN===2?'the Base and 7-day-late scenarios':'the Base scenario'}`,'hl')
      +tile('Lowest balance in period',money(T.minC),`On ${fd(T.minD)}`)+tile('Rupper ceiling',money(T.Rup),`= ${nf(LIQ.rupperRatio,0)} × Rtarget ${money(T.Rt)}`)+(W.mar>0?marTile:'');
    body=(cell==='M9'?'':cell==='M6'?`Check the signs in ${main} before using surplus cash. `:'Idle cash can be put to disciplined use. ')
      +(T.safe>0?'':`SafeCash is 0 because the adverse scenario takes the balance below Rtarget inside the surplus window (Base case alone: ${money(T.safeBase)}); there is no safe idle cash to use yet.`);
    acts=`${cell==='M9'?`<div class="callout red ls-warn"><span>⚠</span><div><b>Resolve the working-capital bottleneck before using idle cash.</b> ${money(W.mar)} is tied up in ${main}; do not borrow more.</div></div>`:''}
      <div class="ls-opts"><div class="ls-opts-h">Options for idle cash <span class="ls-chip">Phase 2 · UC03</span></div>
      <div class="ls-opt"><b>D1</b><div><strong>Prepay high-interest short-term loans</strong><small>Lowers financing cost; only when the net benefit is positive and the Base balance stays ≥ Rtarget after paying.</small></div></div>
      <div class="ls-opt"><b>D2</b><div><strong>Pay suppliers early for a discount</strong><small>Annualised rate APR = d ÷ (1 − d) × 365 ÷ Δ; e.g. 2% for paying 30 days early ≈ ${nf(.02/.98*365/30*100,1)}% a year.</small></div></div>
      <div class="ls-opt"><b>D3</b><div><strong>Short-term deposit</strong><small>Only the SafeCash amount, maturing at least 2 days before the next large payment; never the Rmin reserve.</small></div></div></div>`;
  }else{
    lead=W.w==='unknown'?'Core data is missing to classify the W axis (revenue, COGS, receivables, inventory or payables).':'Rtarget or the cash-flow sources are missing, so the cash state cannot be determined.';
  }
  const foot=`Rtarget = the company's minimum buffer ${money(T.Rt||0)}; Rmin = ${nf(LIQ.rminRatio*100,0)}% and Rupper = ${nf(LIQ.rupperRatio*100,0)}% of Rtarget (demo assumption, SRS 2.8.10.2). The W axis uses garment-industry thresholds for the ${W.model||'FOB'} model (tv1.threshold.v2${W.modelDeclared?'':'; default FOB thresholds – business model not confirmed'}), each invoice’s own term for the overdue ratio, and ${W.metrics&&W.metrics.ca_src==='financials'?'current assets from the financial statements':'current assets ≈ cash + receivables + inventory (assumption)'}. TH is determined from the Base case.${S.case==='stress_7'?' The chart below shows the 7-day-late scenario; it does not change the Base matrix cell.':''} Provisional result.`;
  return `<section class="lstate ${cls}" data-wid="state" aria-label="Liquidity state">
    <header class="ls-head"><span class="ls-ic" aria-hidden="true">${icon}</span><div class="ls-tt"><h2>${title}</h2>${badge?`<span class="ls-badge">${badge}</span>`:''}</div>${grid}</header>
    ${chips}<p class="ls-lead">${lead}</p>${tiles?`<div class="ls-tiles">${tiles}</div>`:''}${body?`<p class="ls-msg">${body}</p>`:''}${acts?`<div class="ls-acts">${acts}</div>`:''}
    ${T.th!=='unknown'?alertLegendHTML({surplus:true}):''}<p class="ls-foot">${foot}</p></section>`;
}
// "Find financing" (UC03): solutions only open after diagnosis → cause → ranking, so Copilot runs the next step in the chat.
function goFinancing(){openGapRequest(()=>goFinancingFlow())}
function goFinancingFlow(){
  if(S.stage>=3){setTab('gap');return}
  const list=currentChips(),next=list.find(x=>!S.done.has(x.id))||list[0];
  if(innerWidth<900)closePanel();
  toast('Copilot goes step by step: diagnosis → cause of the shortfall → financing ranking.',2800);
  if(next)sendChat(next.ask);
}
/* ===== UC01 dashboard (SRS 2.7.1, 2.7.3, Table 3-1): data source line and controls, W card, capital above the normal
   level, item cards with threshold bars, detail tables with evidence, cash-cycle gauges. Display only reads the cached UC01
   run; nothing is recalculated when the screen is drawn. ===== */
S.dash={custOrder:'exposure',sort:{},expert:false};
try{S.dash.expert=localStorage.getItem('lilact.expert.v1')==='1'}catch(e){}
function freshness(snap){
  const at=snap&&snap.source&&snap.source.at?Date.parse(snap.source.at):NaN;if(isNaN(at))return {level:'unknown'};
  const h=(Date.now()-at)/36e5;return {level:h<=CFG.erp.freshMaxHours?'fresh':h<=CFG.erp.staleHours?'stale':'expired',hours:h,at:snap.source.at};
}
const fdt=s=>{const d=new Date(s),p=n=>String(n).padStart(2,'0');return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`};
const thrSrcName=k=>(THRESHOLD_SOURCE[k]||{})[LANG]||k;
const pctS=(v,dg=1)=>v==null?'—':nf(v*100,dg)+'%';
const daysS=v=>v==null?t('st.n/a'):nf(v,1);
const rawVND=v=>S.dash.expert&&v!=null?` <small class="raw num" title="${esc(t('exp.raw'))}">${nf(Math.round(v),0)} VND</small>`:'';
const lbl=k=>t('lbl.'+k);
function dataSourceHTML(d,snap){
  const fr=freshness(snap),at=snap.source.at?fdt(snap.source.at):'—',base=DATA.snaps[S.firm];
  const iss=(base.sales||[]).concat(base.purchases||[]).map(x=>x.issue).filter(Boolean).sort();
  const minAsOf=iss.length?isoOf(dn(iss[0])+1):base.data_as_of;
  return `<div class="uc-src" data-wid="source"><div class="uc-src-l"><span>${t('src.line',{src:esc(snap.source.id),sid:esc(d.snapshot_id),asof:fd(d.as_of),start:fd(d.period_start),end:fd(d.as_of),n:d.N})}</span>
    <span class="fr fr-${fr.level}"><i class="lv-sw" aria-hidden="true"></i>${t(snap.source.type==='upload'?'src.uploaded':'src.loaded',{at})} · ${t('fresh.'+fr.level,{h:CFG.erp.freshMaxHours})}</span></div>
   <div class="uc-ctl"><label>${t('ctl.asof')}<input type="date" id="ucAsOf" value="${d.as_of}" min="${minAsOf}" max="${base.data_as_of}"></label>
    <label>${t('ctl.start')}<input type="date" id="ucStart" value="${d.period_start}" max="${isoOf(dn(d.as_of)-1)}"></label>
    ${S.uc01Sel?`<button class="btn sec sm" type="button" id="ucReset">${t('ctl.reset')}</button>`:''}
    <label class="uc-exp"><input type="checkbox" id="ucExpert" ${S.dash.expert?'checked':''}> ${t('ctl.expert')}</label>
    <button class="btn sec sm" type="button" id="ucPolicy">${t('ctl.policy')}</button></div>
   ${S.uc01Sel?`<p class="uc-note">${t('ctl.note')}</p>`:''}</div>`;
}
function wCardHTML(d){
  const W=d.wc_class,main=d.main_bottleneck?t('item.'+d.main_bottleneck):'',share=pctS(d.materiality_share,1);
  const s=W==='unknown'?(d.inactive?t('w.s.inactive'):t('w.s.unknown',{fields:d.missing.join(', ')})):W==='W0'?t('w.s.W0')
    :W==='W1'?t('w.s.W1',{items:d.cause_items.map(k=>t('item.'+k)).join(', '),share})
    :d.rule_ids.some(r=>r==='R-AR-2'||r==='R-INV-2')?t('w.s.W2sev',{main}):t('w.s.W2mat',{main,share});
  const causes=d.cause_items.map(k=>{const it=d.item_states.find(i=>i.item===k);return `${t('item.'+k)} (c=${it.c}, ${it.shape})`}).join(' · ');
  const prov=d.provisional.length?`<span class="prov">${t('w.prov')}</span>`:'';
  return `<div class="card wcard ${W}" data-wid="w"><div class="wc-h"><span class="ls-w ${W}">${t('w.'+W)}</span>${prov}</div>
   <p class="wc-s">${esc(s)}</p>
   <dl class="wc-dl"><div><dt>${t('w.main')}</dt><dd>${main||t('w.none')}</dd></div><div><dt>${t('w.pattern')}</dt><dd>${d.bn_pattern}${causes?' · '+causes:''}</dd></div>
    <div><dt>${t('w.model')}</dt><dd>${d.model.model} · ${thrSrcName(d.model.src==='owner_policy'?'owner_policy':d.model.src==='firm_profile'?'firm_profile':'demo_assumption')}${d.model.declared?'':` · <b class="warn">${t('w.model.unconfirmed')}</b>`}</dd></div></dl>
   ${S.dash.expert?`<p class="expert">${t('exp.rules')}: ${d.rule_ids.join(', ')||'—'}${d.info_rules.length?' · '+d.info_rules.join(', '):''} · ${t('exp.run')}: ${d.run_id} · ${t('exp.versions')}: ${d.formula_version}, ${d.threshold_version}, ${esc(d.policy_version)}</p>`:''}</div>`;
}
function marTilesHTML(d){
  if(d.wc_class==='unknown')return '';
  const ob=`<div class="card mtile ob" data-wid="ob"><span>${t('ob.t')}</span><b class="num">${money(d.obligation_overdue)}</b>${rawVND(d.obligation_overdue)}<small>${t('ob.sub')}</small></div>`;
  if(d.bn_pattern==='BN0')return `<div class="card mtile bn0" data-wid="mar"><span>✓ ${t('bn0.t')}</span><small>${t('bn0.sub')}</small></div>`+ob;
  const ca=money(d.metrics.ca),assumed=d.metrics.ca_src==='assumed'?t('mar.assumed'):'';
  return `<div class="card mtile hl" data-wid="mar"><span>${t('mar.t')}</span><b class="num">${money(d.money_at_risk)}</b>${rawVND(d.money_at_risk)}<small>${t('mar.sub')}</small></div>
   <div class="card mtile"><span>${t('mar.share')}</span><b class="num">${pctS(d.materiality_share,1)}</b><small>${t('mar.share.sub',{ca,assumed,mat:pctS(d.materiality,0)})}</small></div>`+ob;
}
function tbarHTML(it){
  const marks=it.item==='AP'?[['low',it.low],['high',it.high]]:[['ref',it.ref],['watch',it.watch],['severe',it.severe]];
  const max=Math.max(...marks.map(m=>m[1]),it.value||0)*1.18,X=v=>Math.max(0,Math.min(100,v/max*100));
  const zones=it.item==='AP'?'':`<span class="tb-zone z1" style="left:${X(it.watch)}%;width:${X(it.severe)-X(it.watch)}%"></span><span class="tb-zone z2" style="left:${X(it.severe)}%;width:${100-X(it.severe)}%"></span>`;
  return `<div class="tbar" role="img" aria-label="${it.metric} ${daysS(it.value)}; ${marks.map(m=>t('mk.'+m[0])+' '+nf(m[1],1)).join(', ')}"><div class="tb-track">${zones}
    ${it.value!=null?`<span class="tb-fill" style="width:${X(it.value)}%"></span><span class="tb-val" style="left:${X(it.value)}%"></span>`:''}
    ${marks.map(m=>`<span class="tb-mk mk-${m[0]}" style="left:${X(m[1])}%" title="${t('mk.'+m[0])} ${nf(m[1],1)}"></span>`).join('')}</div>
   <div class="tb-lbl">${marks.map((m,i)=>{const close=i>0&&X(m[1])-X(marks[i-1][1])<16;return `<span class="${close&&i%2?'r2':''}" style="left:${X(m[1])}%"><b>${nf(m[1],1)}</b>${t('mk.'+m[0]).replace(/ P\d+.*$/,'')}</span>`}).join('')}</div></div>`;
}
function itemCardHTML(d,it){
  const n=d.N,m=d.metrics,bn0=d.bn_pattern==='BN0',notes=[];
  if(it.item!=='AP'&&it.c===0&&it.headroom!=null)notes.push((it.near_threshold?`<b class="near">⚑ ${t('item.near',{p:pctS(it.value/it.watch,0)})}</b> · `:'')+t('item.headroom',{d:nf(it.headroom,1)}));
  if(it.item!=='AP'&&it.value!=null&&it.value>it.watch)notes.push(t('item.above',{d:nf(it.value-it.watch,1)}));
  if(it.c>0)notes.push(`${t('item.E',{v:money(it.E)})}${rawVND(it.E)} · ${t('item.shape',{s:it.shape})} (${t('shape.'+it.shape)})`);
  if(it.info_high)notes.push(t('item.apinfo'));
  if(it.item!=='AR'&&m.cogs_src==='converted')notes.push(t('item.cogsprov',{n,d:m.cogs_days}));
  if(it.value==null)notes.push(t('item.missing',{f:it.balance==null?t('item.'+it.item):it.item==='AR'?'revenue':'cogs'}));
  const cls=bn0?'gray':it.status==='severe'?'red':it.status==='watch'?'amber':it.status==='n/a'?'gray':'green';
  const src=thrSrcName(d.model.src==='owner_policy'?'owner_policy':'verified_reference');
  return `<div class="card icard st-${bn0?'normal':it.status}" data-wid="${it.item.toLowerCase()}"><div class="ic-h"><b>${t('item.'+it.item)}</b><span class="status ${cls}"><i></i>${t('st.'+it.status)}</span></div>
   <div class="ic-v"><span class="num big">${it.balance!=null?money(it.balance):'—'}</span>${rawVND(it.balance)}<span class="ic-d"><b class="num">${daysS(it.value)}</b> ${t('unit.days')} · ${it.metric}</span></div>
   ${tbarHTML(it)}<p class="ic-cap">${t('item.cap.'+it.item,{n})}</p>${notes.map(x=>`<p class="ic-n">${x}</p>`).join('')}
   <p class="ic-src">${t('thr.src',{s:src,v:d.threshold_version})}${it.provisional?` · <span class="prov">${t('w.prov')}</span>`:''}</p>
   ${S.dash.expert?`<p class="expert">${it.item==='AR'?`DSO = AR × N ÷ Revenue = ${nf(Math.round(it.balance||0),0)} × ${n} ÷ ${nf(Math.round(m.rev||0),0)}`:it.item==='INV'?`DIO = INV × N ÷ COGS = ${nf(Math.round(it.balance||0),0)} × ${n} ÷ ${nf(Math.round(m.cogs||0),0)}`:`DPO = AP × N ÷ COGS = ${nf(Math.round(it.balance||0),0)} × ${n} ÷ ${nf(Math.round(m.cogs||0),0)}`} · c=${it.c} · E=${nf(Math.round(it.E),0)}</p>`:''}</div>`;
}
// Sortable detail tables (allowed columns only). BN0: no warning colours.
function sortRows(rows,kind,cols){
  const s=S.dash.sort[kind];if(!s||!cols[s.col])return rows;
  return rows.slice().sort((a,b)=>{const x=cols[s.col](a),y=cols[s.col](b);return (x>y?1:x<y?-1:0)*(s.dir==='asc'?1:-1)});
}
const sortTh=(kind,col,label)=>{const s=S.dash.sort[kind],on=s&&s.col===col;return `<th class="num sortable${on?' on':''}" data-sort="${kind}|${col}" aria-sort="${on?(s.dir==='asc'?'ascending':'descending'):'none'}" tabindex="0">${label}${on?(s.dir==='asc'?' ▲':' ▼'):''}</th>`};
function detailTablesHTML(d){
  const P=d.profiles,bn0=d.bn_pattern==='BN0',flagged=new Set(d.findings.filter(f=>f.object.type==='customer').map(f=>f.object.key));
  const cols={ar:x=>x.ar,share:x=>x.ar_share,overdue:x=>x.overdue,maxod:x=>x.max_overdue,late:x=>x.late_pos_wavg??-1,tier:x=>x.tier};
  const order=S.dash.custOrder==='intervention'?P.interventionOrder:P.exposureOrder,byKey=new Map(P.customers.map(c=>[c.key,c]));
  const custs=sortRows(order.map(k=>byKey.get(k)),'cust',cols);
  const cRows=custs.map(c=>`<tr data-ev="cust|${esc(c.key)}" tabindex="0" class="${!bn0&&flagged.has(c.key)?'flag':''}"><td><b>${esc(c.name)}</b>${c.notes.length?`<small>${c.notes.map(x=>t('note.'+x)).join(' · ')}</small>`:''}</td>
    <td class="num">${money(c.ar)}</td><td class="num">${pctS(c.ar_share,1)}</td><td class="num ${!bn0&&c.overdue>0?'neg':''}">${money(c.overdue)}</td><td class="num">${c.max_overdue}</td>
    <td class="num">${c.late_pos_wavg==null?'—':nf(c.late_pos_wavg,1)}</td><td>${lbl(c.size)} · ${lbl(c.relationship)}<small>${lbl(c.behaviour)}${c.behaviour_status!=='ok'?` (${t('w.prov')})`:''}</small></td>
    <td>${!bn0&&c.debt_status!=='none'?`<span class="status ${c.debt_status==='overdue_long'?'red':'amber'}">${lbl(c.debt_status)}</span>`:lbl(c.debt_status)}</td><td class="num"><b>${c.tier}</b></td></tr>`).join('');
  const lcols={age:x=>x.days??-1,value:x=>x.value};
  const lots=sortRows(P.lots,'lot',lcols);
  const lRows=lots.map(l=>`<tr data-ev="lot|${esc(l.name)}" tabindex="0" class="${!bn0&&(l.status==='slow'||l.status==='cancelled')?'flag':''}"><td><b>${esc(l.name)}</b>${l.checks.length?`<small>${l.checks.join(' · ')}</small>`:''}</td>
    <td>${l.type||'—'}${l.type_src==='inferred'?` <small>(${t('w.prov')})</small>`:''}${l.suggested_type?` → ${l.suggested_type}`:''}</td><td class="num">${l.days==null?'—':l.days}</td><td class="num">${l.threshold==null?'—':l.threshold}</td>
    <td class="num">${money(l.value)}</td><td>${!bn0&&l.status!=='normal'&&l.status!=='excluded'?`<span class="status amber">${lbl(l.status)}</span>`:lbl(l.status)}${l.cancel_status==='proposed'?` <small>(${lbl('proposed')})</small>`:''}</td>
    <td class="num">${l.collateral?money(l.collateral):'—'}${l.collateral_pending?` <small>(${t('tbl.pending')})</small>`:''}</td></tr>`).join('');
  const scols={purch:x=>x.purchases,dep:x=>x.dependency,ap:x=>x.ap,overdue:x=>x.overdue,press:x=>x.pressure30};
  const sups=sortRows(P.suppliers.slice().sort((a,b)=>b.ap-a.ap),'sup',scols);
  const sRows=sups.map(s=>`<tr data-ev="sup|${esc(s.key)}" tabindex="0" class="${!bn0&&s.overdue>0?'flag':''}"><td><b>${esc(s.name)}</b>${s.discount?`<small>${nf(s.discount.pct*100,1)}%/${s.discount.days}d · r_disc ${pctS(s.discount.r_disc,1)}</small>`:''}</td>
    <td class="num">${money(s.purchases)}</td><td class="num">${pctS(s.dependency,1)}${s.dependency_high?' ⚑':''}</td><td class="num">${money(s.ap)}</td><td class="num ${!bn0&&s.overdue>0?'neg':''}">${money(s.overdue)}</td>
    <td class="num">${money(s.pressure30)}</td><td>${lbl(s.essential)}</td><td>${lbl(s.conclusion)}${s.pending_confirmation?` <small>(${t('tbl.pending')})</small>`:''}</td></tr>`).join('');
  const tbl=(cls,head,rows)=>`<div class="table-wrap"><table class="dtable ${cls}"><thead><tr>${head}</tr></thead><tbody>${rows||`<tr><td colspan="11" class="empty">${t('tbl.empty')}</td></tr>`}</tbody></table></div>`;
  return `<div class="card dtables" data-wid="tables">
   <div class="dt-h"><h3>${t('tbl.customers')}</h3><div class="seg2" role="group">${['exposure','intervention'].map(o=>`<button type="button" data-corder="${o}" aria-pressed="${S.dash.custOrder===o}" class="${S.dash.custOrder===o?'on':''}">${t('tbl.order.'+o)}</button>`).join('')}</div></div>
   ${tbl('t-cust',`<th>${t('col.customer')}</th>${sortTh('cust','ar',t('col.ar'))}${sortTh('cust','share',t('col.share'))}${sortTh('cust','overdue',t('col.overdue'))}${sortTh('cust','maxod',t('col.maxod'))}${sortTh('cust','late',t('col.late'))}<th>${t('col.labels')}</th><th>${t('col.debt')}</th>${sortTh('cust','tier',t('col.tier'))}`,cRows)}
   <div class="dt-h"><h3>${t('tbl.lots')}</h3></div>
   ${tbl('t-lot',`<th>${t('col.lot')}</th><th>${t('col.type')}</th>${sortTh('lot','age',t('col.age'))}<th>${t('col.thr')}</th>${sortTh('lot','value',t('col.value'))}<th>${t('col.status')}</th><th>${t('col.collateral')}</th>`,lRows)}
   <div class="dt-h"><h3>${t('tbl.suppliers')}</h3></div>
   ${tbl('t-sup',`<th>${t('col.supplier')}</th>${sortTh('sup','purch',t('col.purch'))}${sortTh('sup','dep',t('col.dep'))}${sortTh('sup','ap',t('col.ap'))}${sortTh('sup','overdue',t('col.overdue'))}${sortTh('sup','press',t('col.press'))}<th>${t('col.ess')}</th><th>${t('col.concl')}</th>`,sRows)}</div>`;
}
// Evidence panel (UC01.3): object information and its invoices / lot, page size 50 (at most 200), filter and sort; read from the run.
function openEvidence(kind,key){
  const d=uc01(),snap=uc01Snap(),P=d.profiles,st={filter:'all',sort:{col:'due',dir:'asc'},page:0};
  let obj,rows,info;
  if(kind==='cust'){obj=P.customers.find(c=>c.key===key);rows=(snap.sales||[]).filter(s=>s.key===key);
    const f=d.findings.filter(x=>x.object.key===key);
    info=[[t('col.ar'),money(obj.ar)],[t('col.overdue'),money(obj.overdue)],['1–30 / 31–60 / 61–90 / >90',['d1_30','d31_60','d61_90','d90p'].map(k=>money(obj.buckets[k])).join(' / ')],
      [t('col.maxod'),obj.max_overdue+' '+t('unit.days')],[t('col.late'),obj.late_pos_wavg==null?'—':nf(obj.late_pos_wavg,1)+' '+t('unit.days')+` (${obj.paid_count})`],['ρ max',rows.filter(r=>r.rho!=null&&r.open&&r.dpd>0).reduce((a,r)=>Math.max(a,r.rho),0).toFixed(2)],
      [t('exp.rules'),f.map(x=>`${x.rule_id} (${x.level===2?t('st.severe'):t('st.watch')})`).join(', ')||'—'],['ρ',`${t('st.watch')} > ${CFG.ar.rhoWatch} · ${t('st.severe')} > ${CFG.ar.rhoSevere} (${thrSrcName('demo_assumption')})`]]}
  else if(kind==='sup'){obj=P.suppliers.find(s=>s.key===key);rows=(snap.purchases||[]).filter(s=>s.key===key);const f=d.findings.filter(x=>x.object.key===key);
    info=[[t('col.ap'),money(obj.ap)],[t('col.overdue'),money(obj.overdue)],[t('col.maxod'),obj.max_overdue+' '+t('unit.days')],[t('col.dep'),pctS(obj.dependency,1)],[t('col.ess'),lbl(obj.essential)],
      [t('col.concl'),lbl(obj.conclusion)],[t('exp.rules'),f.map(x=>`${x.rule_id} (${x.level===2?t('st.severe'):t('st.watch')})`).join(', ')||'—']]}
  else{obj=P.lots.find(l=>l.name===key);rows=[obj];
    info=[[t('col.type'),obj.type||'—'],[t('col.age'),obj.days==null?'—':obj.days+' '+t('unit.days')],[t('col.thr'),obj.threshold==null?'—':obj.threshold+' '+t('unit.days')],[t('col.value'),money(obj.value)],
      [t('col.status'),lbl(obj.status)],[t('col.collateral'),obj.collateral?money(obj.collateral):'—'],[t('exp.rules'),d.findings.filter(x=>x.object.type==='lot'&&x.object.name===key).map(x=>x.rule_id).join(', ')||'—']]}
  const PS=CFG.ui.evidencePageSize,MAX=CFG.ui.evidenceMaxRows;
  const draw=m=>{
    let r=kind==='lot'?rows:rows.filter(x=>st.filter==='all'||(st.filter==='open'&&x.open)||(st.filter==='overdue'&&x.open&&x.dpd>0)||(st.filter==='paid'&&!x.open));
    const key2={amount:x=>x.amount,due:x=>x.due||'9999',dpd:x=>x.dpd??-1,age:x=>x.days??-1}[st.sort.col]||(x=>0);
    r=r.slice().sort((a,b)=>{const x=key2(a),y=key2(b);return (x>y?1:x<y?-1:0)*(st.sort.dir==='asc'?1:-1)});
    const total=r.length,capped=r.slice(0,MAX),pages=Math.max(1,Math.ceil(capped.length/PS));st.page=Math.min(st.page,pages-1);
    const page=capped.slice(st.page*PS,st.page*PS+PS),th=(c,l)=>`<th class="sortable${st.sort.col===c?' on':''}" data-esort="${c}">${l}${st.sort.col===c?(st.sort.dir==='asc'?' ▲':' ▼'):''}</th>`;
    const body=kind==='lot'?`<thead><tr><th>${t('col.lot')}</th><th>${t('col.type')}</th>${th('age',t('col.age'))}${th('amount',t('col.value'))}<th>${t('col.status')}</th></tr></thead><tbody>${page.map(l=>`<tr><td>${esc(l.name)}</td><td>${l.type||'—'}</td><td class="num">${l.days??'—'}</td><td class="num">${money(l.value)}${rawVND(l.value)}</td><td>${lbl(l.status)}</td></tr>`).join('')}</tbody>`
      :`<thead><tr><th>${t('col.inv')}</th><th>${t('col.issue')}</th>${th('due',t('col.due'))}<th>${t('col.paid')}</th>${th('amount',t('col.amount'))}<th>${t('col.open')}</th>${th('dpd',t('col.dpd'))}<th>${t('col.rho')}</th></tr></thead>
       <tbody>${page.map(x=>`<tr class="${x.open&&x.dpd>0?'flag':''}"><td class="num">${esc(x.id)}</td><td class="num">${x.issue?fd(x.issue):'—'}</td><td class="num">${x.due?fd(x.due):'—'}</td><td class="num">${x.paid&&!x.open?fd(x.paid):'—'}</td><td class="num">${money(x.amount)}${rawVND(x.amount)}</td><td class="num">${x.open?money(x.open_amount):'0'}</td><td class="num">${x.dpd??'—'}</td><td class="num">${x.rho!=null&&x.open&&x.dpd>0?x.rho.toFixed(2):'—'}</td></tr>`).join('')}</tbody>`;
    m.querySelector('.ev-body').innerHTML=total?`<div class="table-wrap"><table class="dtable">${body}</table></div>${total>PS?`<div class="ev-pg"><button class="btn sec sm" data-pg="-1" ${st.page?'':'disabled'}>${t('ev.prev')}</button><span>${t('ev.page',{p:st.page+1,n:pages})}</span><button class="btn sec sm" data-pg="1" ${st.page<pages-1?'':'disabled'}>${t('ev.next')}</button></div>`:''}${total>MAX?`<p class="ev-more">${t('ev.more',{n:MAX,total,p:PS,max:MAX})}</p>`:''}`
      :`<div class="empty">${t('ev.none',{f:t('ev.'+st.filter)})}</div>`;
    $$('[data-esort]',m).forEach(h=>h.onclick=()=>{const c=h.dataset.esort;st.sort={col:c,dir:st.sort.col===c&&st.sort.dir==='asc'?'desc':'asc'};draw(m)});
    $$('[data-pg]',m).forEach(b=>b.onclick=()=>{st.page+=+b.dataset.pg;draw(m)});
  };
  openModal(`<div class="evid"><button class="settings-close" aria-label="Close">×</button><h3>${t('ev.title',{name:esc(kind==='lot'?obj.name:obj.name)})}</h3>
    <dl class="ev-info">${info.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${kind==='lot'?'':`<label class="ev-f">${t('ev.filter')} <select id="evFilter">${['all','open','overdue','paid'].map(f=>`<option value="${f}">${t('ev.'+f)}</option>`).join('')}</select></label>`}
    <div class="ev-body"></div><p class="ev-src">${t('ev.from',{run:d.run_id})}</p></div>`,m=>{
    m.querySelector('.settings-close').onclick=closeModal;const fsel=m.querySelector('#evFilter');if(fsel)fsel.onchange=()=>{st.filter=fsel.value;st.page=0;draw(m)};draw(m)});
  addLog({tool:'view_evidence',tier:0,args:{firm_id:S.firm,object:kind,key},status:'ok',summary:`Evidence for ${obj&&obj.name}`});
}
// Threshold policy (UC01.4, minimal): thresholds by model with source and version; business model and materiality are changed
// here (never through Chat) with a reason, a preview of the impact and a new configuration version.
function openPolicy(){
  const f=S.firm,d=uc01(),p=POLICY.get(f),T=CFG.wc.thr;
  const row=(lb,k,s)=>`<tr><td>${lb}</td><td class="num">${k.CMT}</td><td class="num">${k.FOB}</td><td>${s}</td></tr>`,src=thrSrcName('verified_reference');
  openModal(`<div class="evid pol"><button class="settings-close" aria-label="Close">×</button><h3>${t('pol.title')}</h3><p class="sub">${t('pol.sub',{v:CFG.versions.threshold,cfg:esc(POLICY.versionId(f))})}</p>
   <div class="table-wrap"><table class="dtable"><thead><tr><th>${t('pol.metric')}</th><th>CMT</th><th>FOB</th><th>${t('pol.source')}</th></tr></thead><tbody>
    ${row('DSO P50 / P75 / P90',{CMT:[T.CMT.dso.ref,T.CMT.dso.watch,T.CMT.dso.severe].map(v=>nf(v,1)).join(' / '),FOB:[T.FOB.dso.ref,T.FOB.dso.watch,T.FOB.dso.severe].map(v=>nf(v,1)).join(' / ')},src)}
    ${row('DIO P50 / P75 / P90',{CMT:[T.CMT.dio.ref,T.CMT.dio.watch,T.CMT.dio.severe].map(v=>nf(v,1)).join(' / '),FOB:[T.FOB.dio.ref,T.FOB.dio.watch,T.FOB.dio.severe].map(v=>nf(v,1)).join(' / ')},src)}
    ${row('DPO P10 / P75',{CMT:nf(T.CMT.dpo.low,1)+' / '+nf(T.CMT.dpo.high,1),FOB:nf(T.FOB.dpo.low,1)+' / '+nf(T.FOB.dpo.high,1)},src)}
    ${row(t('pol.buffer'),{CMT:pctS(T.CMT.bufThin,1),FOB:pctS(T.FOB.bufThin,1)},src)}
    ${row('ρ',{CMT:'0,5 / 1,0',FOB:'0,5 / 1,0'},thrSrcName('demo_assumption'))}
    ${row(t('pol.lot'),{CMT:'60 / 30',FOB:'60 / 30'},thrSrcName('demo_assumption'))}</tbody></table></div>
   <div class="pol-form"><label>${t('w.model')}<select id="polModel"><option value="undeclared">${t('pol.undeclared')}</option><option value="CMT">CMT</option><option value="FOB">FOB</option></select></label>
    <label>${t('mar.share')}<select id="polMat">${[0.03,0.05,0.1].map(v=>`<option value="${v}">${pctS(v,0)}</option>`).join('')}</select></label>
    <label class="wide">${t('pol.reason')}<textarea id="polReason" rows="2" maxlength="500" placeholder="${t('pol.reason.ph')}"></textarea></label></div>
   <div id="polPreview" class="pol-prev"></div><p id="polErr" class="settings-error"></p>
   <div class="acts"><button class="btn sec" id="polCancel">${t('pol.cancel')}</button><button class="btn primary" id="polSave">${t('pol.save')}</button></div></div>`,m=>{
    const ms=m.querySelector('#polModel'),mt=m.querySelector('#polMat');ms.value=p.business_model||(DATA.snaps[f].firm.business_model||'undeclared');mt.value=String(p.materiality??CFG.wc.materiality);
    const prev=()=>{const x=ENGINE.diagnose(uc01Snap(f),{business_model:ms.value,materiality:+mt.value,version_id:'preview'});
      m.querySelector('#polPreview').innerHTML=t('pol.preview',{from:`${d.wc_class} · ${d.bn_pattern}`,to:`${x.wc_class} · ${x.bn_pattern}`,mar:money(x.money_at_risk),share:pctS(x.materiality_share,1)})};
    ms.onchange=mt.onchange=prev;prev();
    m.querySelector('.settings-close').onclick=m.querySelector('#polCancel').onclick=closeModal;
    m.querySelector('#polSave').onclick=()=>{const r=m.querySelector('#polReason').value.trim();
      if(r.length<10||r.length>500){m.querySelector('#polErr').textContent=t('pol.reason.err');return}
      POLICY.set(f,{business_model:ms.value,materiality:+mt.value},r);closeModal();toast(t('pol.saved',{v:POLICY.versionId(f)}));refreshTab()};
  });
}
function uc01SelChange(asOf,start){
  const base=DATA.snaps[S.firm];
  if(!asOf||asOf>base.data_as_of){toast(t('ctl.bad'));return}
  const st=start||isoOf(dn(asOf)-182);if(st>=asOf){toast(t('ctl.bad'));return}
  S.uc01Sel=asOf===base.data_as_of&&st===isoOf(dn(asOf)-182)?null:{asOf,start:st};
  renderDash();
}
function cccGaugesHTML(d,c){
  const T=d.thresholds,m=d.metrics,dso=m.dso,dio=m.dio,dpo=m.dpo,ccc=m.ccc,n=d.N;
  // Gauge scales follow the thresholds of the model (no fixed 90-day scale).
  const mx=(v,ref)=>Math.ceil(Math.max(v||0,ref)*1.15/10)*10;
  return `<div class="gauges">${dso==null?'':gauge(dso,mx(dso,T.dso.severe),'var(--lc-color-data-receivables)',t('unit.days'),'DSO',`${t('item.cap.AR',{n})} ${t('mk.watch')} ${nf(T.dso.watch,1)} · ${t('mk.severe')} ${nf(T.dso.severe,1)}`)}
   ${dio==null?'':gauge(dio,mx(dio,T.dio.severe),'var(--lc-color-data-inventory)',t('unit.days'),'DIO',`${t('item.cap.INV',{n})} ${t('mk.watch')} ${nf(T.dio.watch,1)} · ${t('mk.severe')} ${nf(T.dio.severe,1)}`)}
   ${dpo==null?'':gauge(dpo,mx(dpo,T.dpo.high),'var(--lc-color-data-payables)',t('unit.days'),'DPO',`${t('item.cap.AP',{n})} ${t('mk.low')} ${nf(T.dpo.low,1)} · ${t('mk.high')} ${nf(T.dpo.high,1)}`)}
   ${ccc==null?'':gauge(ccc,mx(ccc,T.dso.severe+T.dio.severe),'var(--lc-color-data-cash)',t('unit.days'),'CCC',t('ccc.cap'))}</div>`;
}
function renderDash(){
  const c=C(),p=$('#pane-dash'),AG=agingModel(c),d=uc01(),snap=uc01Snap();
  const own=isUserFirm(S.firm),f=own?dstore.load().firms[S.firm]:null,fs=f&&activeSnap(f);
  $$('.chipdate b').forEach(b=>b.textContent=fd(c.as_of));
  p.innerHTML=`
  <div class="dsrc ${own?'own':''}">${own?`<span><b>${esc(f.name)}</b> · your uploaded data · version ${fs.id} · as of ${fd(fs.asOf)} · estimated figures</span><span class="dsa"><button class="btn primary sm" data-go="upd">Update data</button><button class="btn sec sm" data-go="hist">Version history</button></span>`
   :`<span>Viewing <b>sample data ${S.firm}</b>. Want to analyse your own business?</span><span class="dsa"><button class="btn primary sm" data-go="new">⇪ Upload data</button></span>`}</div>
  ${dataSourceHTML(d,snap)}
  ${dashSec(1,'var(--lc-color-alert-orange-mark)',t('sec.w'),t('sec.w.sub'),`<div class="wgrid">${wCardHTML(d)}<div class="mtiles">${marTilesHTML(d)}</div></div>`)}
  ${dashSec(2,'var(--lc-color-data-receivables)',t('sec.items'),t('sec.items.sub'),`<div class="icards">${d.item_states.map(it=>itemCardHTML(d,it)).join('')}</div>`)}
  ${dashSec(3,'var(--lc-color-data-inventory)',t('sec.tables'),t('sec.tables.sub'),detailTablesHTML(d))}
  ${liquidityStateHTML()}
  ${dashSec(4,'var(--lc-color-data-cash)',t('sec.ccc'),t('sec.ccc.sub'),`<div class="dmid">${cccGaugesHTML(d,c)}
   <div class="card agc" data-wid="aging"><div class="card-head"><div><h3>Receivables and payables by due bucket</h3><p>VND million · from the cut-off date</p></div></div><div class="chartbox">${agingSVG(AG)}</div>
    <div class="legend"><span><i style="background:var(--lc-color-data-receivables)"></i>Receivables</span><span><i style="background:var(--lc-color-status-error)"></i>Overdue receivables</span><span><i style="background:var(--lc-color-data-payables)"></i>Payables</span></div></div></div>`)}
  <div class="foot-note">${t('foot.uc01')} ${d.N}-day period; goods held for subcontracting are excluded from owned inventory. Cash-flow projections, the daily balance and the cash gaps are in the Shortfall tab. Synthetic data.</div>`;
  $$('.gv b[data-v]',p).forEach(e=>animNum(e,+e.dataset.v,v=>nf(v,1),1000));
  $$('[data-go]',p).forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(g==='new')startImport(null);else if(g==='upd')startImport(S.firm);else{DW.view='hist';DW.firmId=S.firm;openDataScreen('businesses')}});
  $$('[data-liq="fund"]',p).forEach(b=>b.onclick=goFinancing);
  const ao=$('#ucAsOf',p),so=$('#ucStart',p);
  if(ao)ao.onchange=()=>uc01SelChange(ao.value,null);if(so)so.onchange=()=>uc01SelChange(ao.value,so.value);
  const rs=$('#ucReset',p);if(rs)rs.onclick=()=>{S.uc01Sel=null;renderDash()};
  $('#ucExpert',p).onchange=e=>{S.dash.expert=e.target.checked;try{localStorage.setItem('lilact.expert.v1',S.dash.expert?'1':'0')}catch(x){}renderDash()};
  $('#ucPolicy',p).onclick=openPolicy;
  $$('[data-corder]',p).forEach(b=>b.onclick=()=>{S.dash.custOrder=b.dataset.corder;S.dash.sort.cust=null;renderDash()});
  $$('[data-sort]',p).forEach(h=>{const go=()=>{const [k,col]=h.dataset.sort.split('|'),s=S.dash.sort[k];S.dash.sort[k]={col,dir:s&&s.col===col&&s.dir==='desc'?'asc':'desc'};renderDash()};h.onclick=go;h.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}}});
  $$('[data-ev]',p).forEach(r=>{const go=()=>{const i=r.dataset.ev.indexOf('|');openEvidence(r.dataset.ev.slice(0,i),r.dataset.ev.slice(i+1))};r.onclick=go;r.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go()}}});
  decorateWidgets(p);
}

document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.tg');if(!b)return;
  const root=b.closest('.ftw')||document,k=b.dataset.tg,open=b.getAttribute('aria-expanded')!=='true';
  b.setAttribute('aria-expanded',open);b.textContent=(open?'▾ ':'▸ ')+b.textContent.slice(2);
  if(b.classList.contains('sub'))root.querySelectorAll(`tr.kid[data-gp="${k}"]`).forEach(r=>r.hidden=!open);
  else root.querySelectorAll(`tr.cat[data-par="${k}"]`).forEach(r=>{r.hidden=!open;if(!open)root.querySelectorAll('tr.kid[data-gp]').forEach(x=>{if(x.dataset.par===k)x.hidden=true})})});

(function(){const tt=document.createElement('div');tt.id='tt';document.body.appendChild(tt);
 document.addEventListener('mousemove',e=>{const g=e.target.closest&&e.target.closest('[data-tt]');
  if(!g){tt.classList.remove('on');return}
  tt.innerHTML=g.dataset.tt;tt.classList.add('on');const w=tt.offsetWidth,h=tt.offsetHeight;
  let x=e.clientX+16,y=e.clientY+16;if(x+w>innerWidth-8)x=e.clientX-w-16;if(y+h>innerHeight-8)y=e.clientY-h-16;tt.style.left=x+'px';tt.style.top=y+'px'});
 let lastW=null;
 document.addEventListener('mouseover',e=>{const g=e.target.closest&&e.target.closest('.wk');const w=g?g.dataset.w:null;if(w===lastW)return;lastW=w;
  const root=(g&&g.closest('[data-wid]'))||document;
  document.querySelectorAll('.ft .hlc').forEach(x=>x.classList.remove('hlc'));if(w&&root.querySelectorAll)root.querySelectorAll(`.ft [data-w="${w}"]`).forEach(x=>x.classList.add('hlc'))});
 document.addEventListener('mouseover',e=>{const c=e.target.closest&&e.target.closest('.ft [data-w]');if(!c)return;
  const w=c.dataset.w,root=c.closest('[data-wid]')||document;root.querySelectorAll('.fch .wk').forEach(x=>x.classList.toggle('hot',x.dataset.w===w))});
})();


const PK='smefc.prefs.v1';
const PREF={theme:'light',density:'comfy',motion:true,side:'open'};
(function(){try{Object.assign(PREF,JSON.parse(localStorage.getItem(PK)||'{}'))}catch(e){}})();
const mqDark=matchMedia('(prefers-color-scheme: dark)');
const isDark=()=>PREF.theme==='dark'||(PREF.theme==='system'&&mqDark.matches);
function applyPrefs(){
  const h=document.documentElement;h.dataset.theme=isDark()?'dark':'light';h.dataset.density=PREF.density;h.dataset.motion=PREF.motion?'on':'off';
  let m=document.querySelector('meta[name=theme-color]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}m.content=isDark()?'#0F0C1E':'#F7F6FB';
}
function savePrefs(){try{localStorage.setItem(PK,JSON.stringify(PREF))}catch(e){}applyPrefs()}
mqDark.addEventListener&&mqDark.addEventListener('change',()=>{if(PREF.theme==='system')applyPrefs()});
function toggleTheme(){PREF.theme=isDark()?'light':'dark';savePrefs();toast(isDark()?'Switched to dark theme':'Switched to light theme',1800)}
function openSettings(){
  const u=S.user||{};
  const seg=(key,opts,two)=>`<div class="stseg ${two?'two':''}" data-seg="${key}">${opts.map(([v,l,pv])=>`<button type="button" data-v="${v}" class="${String(PREF[key])===v?'on':''}" aria-pressed="${String(PREF[key])===v}">${pv?`<span class="pv ${pv}"></span>`:''}${l}</button>`).join('')}</div>`;
  openModal(`<div class="stset"><h3>Settings</h3><p class="sub">Saved in this browser, applied immediately.</p>
   <div class="grp"><div class="gl2">Appearance</div>${seg('theme',[['light','Light','l'],['dark','Dark','d'],['system','System','s']])}</div>
   <div class="grp"><div class="gl2">Display density</div>${seg('density',[['comfy','Comfortable'],['compact','Compact']],true)}</div>
   <div class="grp"><div class="stsw"><div><b>Motion effects</b><small>Page transitions, chart bars, gauge needles. Turn off if your device is slow or you feel dizzy.</small></div><button type="button" class="tog" role="switch" aria-checked="${PREF.motion}" id="swMotion" aria-label="Motion effects"></button></div></div>
   <div class="grp"><div class="gl2">Account</div><div class="acc"><span class="avatar">${esc(initials(u.name||'?'))}</span><div><b>${esc(u.name||'')}</b><small>${esc(u.email||'')}</small></div></div></div>
   <div style="display:flex;gap:8px;justify-content:space-between;margin-top:6px"><button class="btn sec sm" id="setReset" type="button">Reset settings</button><button class="btn primary sm" id="setDone" type="button">Done</button></div></div>`,m=>{
    m.querySelectorAll('[data-seg]').forEach(g=>g.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;PREF[g.dataset.seg]=b.dataset.v;savePrefs();g.querySelectorAll('button').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',x===b)})}));
    m.querySelector('#swMotion').onclick=e=>{PREF.motion=!PREF.motion;e.currentTarget.setAttribute('aria-checked',PREF.motion);savePrefs()};
    m.querySelector('#setReset').onclick=()=>{Object.assign(PREF,{theme:'light',density:'comfy',motion:true});savePrefs();closeModal();toast('Settings reset');setTimeout(openSettings,250)};
    m.querySelector('#setDone').onclick=closeModal});
}
// Account menu actions are wired after the settings and help dialogs are defined below.
applyPrefs();


document.addEventListener('pointerdown',e=>{
  const b=e.target.closest&&e.target.closest('.btn,.send,.newchat,.stseg button');if(!b||b.disabled||PREF.motion===false)return;
  if(getComputedStyle(b).position==='static')b.style.position='relative';b.style.overflow='hidden';
  const r=b.getBoundingClientRect(),d=Math.max(r.width,r.height)*2,s=document.createElement('span');s.className='rip';
  s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;b.appendChild(s);setTimeout(()=>s.remove(),650)});


const _setTask=setTask;
setTask=function(...a){const r=_setTask.apply(this,a);const t=THREADS[S.task];if(t&&PREF.motion){t.classList.remove('swap');void t.offsetWidth;t.classList.add('swap')}return r};


const PINS={firms:[],prompts:[],widgets:[]};
const pinKey=()=>'smefc.pins.v1.'+((S.user&&S.user.email)||'anon').toLowerCase();
function loadPins(){let d={};try{d=JSON.parse(localStorage.getItem(pinKey())||'{}')}catch(e){}
  PINS.firms=d.firms||[];PINS.prompts=d.prompts||[];PINS.widgets=d.widgets||[];renderPins();syncFirmPin()}
function savePins(){try{localStorage.setItem(pinKey(),JSON.stringify(PINS))}catch(e){}renderPins();syncFirmPin()}
const toggleIn=(arr,v)=>{const i=arr.indexOf(v);if(i>=0){arr.splice(i,1);return false}arr.push(v);return true};
const PIN_SVG='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>';
const FS_SVG='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const WNAME={factors:'Contributing factors',source:'Data source',w:'W axis',mar:'Capital above the normal level',ob:'Overdue obligations',tables:'Customers, lots and suppliers',ar:'Receivables',ap:'Payables',inv:'Owned inventory',min:'Lowest balance',dso:'DSO',dio:'DIO',dpo:'DPO',ccc:'CCC',aging:'Receivables vs payables by due date',flow:'13-week cash forecast',daily:'Daily cash balance',state:'Liquidity state'};

function renderPins(){
  const box=$('#pinBox'),list=$('#pinList');if(!box)return;
  const items=[
    ...PINS.firms.filter(f=>FIRMS[f]&&f===accountFirm()).map(f=>({t:'firm',k:f,label:FIRMS[f].short,sub:'Company',ic:'▣'})),
    ...PINS.widgets.map(w=>({t:'widget',k:w,label:WNAME[w]||w,sub:'Dashboard card',ic:'▦'})),
    ...PINS.prompts.map(p=>({t:'prompt',k:p,label:p,sub:'Question',ic:'?'}))];
  box.hidden=!items.length;
  list.innerHTML=items.map(i=>`<div class="pinrow" data-t="${i.t}" data-k="${esc(i.k)}"><button class="pinopen" type="button" title="${esc(i.label)}"><span class="pic">${i.ic}</span><span class="ptx"><b>${esc(i.label)}</b><small>${i.sub}</small></span></button><button class="pinx" type="button" aria-label="Unpin" title="Unpin">✕</button></div>`).join('');
}
$('#pinList').addEventListener('click',e=>{
  const row=e.target.closest('.pinrow');if(!row)return;const t=row.dataset.t,k=row.dataset.k;
  if(e.target.closest('.pinx')){const arr=t==='firm'?PINS.firms:t==='widget'?PINS.widgets:PINS.prompts;toggleIn(arr,k);savePins();if(S.tab==='dash'&&S.panel)renderDash();return}
  closeSide();
  if(t==='firm'){if(S.firm!==k)switchContext(k,defCase(k));toast('Switched to '+FIRMS[k].short,1600)}
  else if(t==='widget'){setTab('dash');setTimeout(()=>{const el=document.querySelector(`#pane-dash [data-wid="${k}"]`);el&&openFS(el)},350)}
  else{$('#chatInput').value=k;$('#chatForm').requestSubmit()}
});
function syncFirmPin(){const b=$('#firmPin');if(!b)return;const on=PINS.firms.includes(S.firm);b.setAttribute('aria-pressed',on);b.classList.toggle('on',on);b.title=on?'Unpin this company':'Pin this company'}
$('#firmPin').addEventListener('click',()=>{const on=toggleIn(PINS.firms,S.firm);savePins();toast(on?'Company pinned':'Company unpinned',1400)});
const _sc2=switchContext;switchContext=function(...a){const r=_sc2.apply(this,a);syncFirmPin();return r};

const _um=userMsg;
userMsg=function(t){_um(t);const e=msgs.lastElementChild;if(!e)return;
  const b=document.createElement('button');b.type='button';b.className='mpin';b.title='Pin this question';b.innerHTML=PIN_SVG;
  b.onclick=()=>{const on=toggleIn(PINS.prompts,t);savePins();b.classList.toggle('on',on);toast(on?'Question pinned':'Question unpinned',1400)};
  if(PINS.prompts.includes(t))b.classList.add('on');e.appendChild(b)};


function decorateWidgets(p){
  const ws=$$('[data-wid]',p).filter(w=>w.dataset.wid);
  ws.forEach(w=>{if(w.querySelector(':scope > .wctl'))return;const id=w.dataset.wid,on=PINS.widgets.includes(id);
    const c=document.createElement('div');c.className='wctl';
    c.innerHTML=`<button class="wb ${on?'on':''}" type="button" data-pin="${id}" aria-pressed="${on}" title="${on?'Unpin':'Pin to top'}">${PIN_SVG}</button><button class="wb" type="button" data-fs="${id}" title="Full screen">${FS_SVG}</button>`;
    w.appendChild(c);w.classList.add('wi2');
    w.addEventListener('dblclick',e=>{if(e.target.closest('button,a,input,.ftw'))return;openFS(w)})});
  const pinned=PINS.widgets.map(id=>ws.find(w=>w.dataset.wid===id)).filter(Boolean);
  if(pinned.length){
    const z=document.createElement('section');z.className='dsec pinsec';z.style.cssText='--sc:var(--lc-color-alert-orange-mark);--i:0';
    z.innerHTML='<header class="dsh"><span class="dsn">'+PIN_SVG+'</span><div><h2>Pinned</h2><p>Your quick-access cards</p></div></header><div class="pingrid"></div>';
    const g=z.querySelector('.pingrid');pinned.forEach(w=>{w.classList.add('pinned');g.appendChild(w)});
    const first=p.querySelector('.dsec');first?first.before(z):p.appendChild(z);
    $$('.kcs,.gauges,.dmid',p).forEach(e=>{if(!e.children.length)e.remove()});
    $$('.dsec:not(.pinsec)',p).forEach(sx=>{if(!sx.querySelector(':scope > :not(header)'))sx.remove()});
  }
}
document.addEventListener('click',e=>{
  const pb=e.target.closest&&e.target.closest('.wb[data-pin]');
  if(pb){const id=pb.dataset.pin,on=toggleIn(PINS.widgets,id);savePins();toast(on?'Pinned to top of dashboard':'Unpinned',1400);if(S.tab==='dash')renderDash();return}
  const fb=e.target.closest&&e.target.closest('.wb[data-fs]');
  if(fb){const w=fb.closest('[data-wid]');w&&openFS(w)}
});


let fsEl=null;
function openFS(w){
  closeFS();const id=w.dataset.wid,clone=w.cloneNode(true);
  clone.querySelectorAll('.wctl').forEach(x=>x.remove());clone.classList.remove('pinned','wi2');clone.removeAttribute('style');clone.classList.add('fsclone');
  const ov=document.createElement('div');ov.className='fsov';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label',WNAME[id]||'Full screen');
  ov.innerHTML=`<div class="fsbar"><b>${esc(WNAME[id]||'')}</b><button class="btn sec sm" id="fsX" type="button">✕ Close <kbd>Esc</kbd></button></div><div class="fsbody"></div>`;
  ov.querySelector('.fsbody').appendChild(clone);document.body.appendChild(ov);fsEl=ov;
  clone.querySelectorAll('[data-csv]').forEach(b=>b.onclick=()=>window._csvCtx&&window._csvCtx());
  ov.addEventListener('mousedown',e=>{if(e.target===ov||e.target.classList.contains('fsbody'))closeFS()});
  ov.querySelector('#fsX').onclick=closeFS;requestAnimationFrame(()=>ov.classList.add('on'));
}
function closeFS(){if(!fsEl)return;const o=fsEl;fsEl=null;o.classList.remove('on');setTimeout(()=>o.remove(),220)}


function setWide(on){
  $('#work').classList.toggle('wide',on);$('#app').classList.toggle('fs-mode',on);
  const b=$('#panelWide');b.setAttribute('aria-pressed',on);b.querySelector('span').textContent=on?'Exit full screen':'Full screen';setTimeout(()=>{placeInk();redrawCharts()},500);
}
$('#panelWide').addEventListener('click',()=>setWide(!$('#work').classList.contains('wide')));
function setSide(open,persist=true){
  $('#app').classList.toggle('side-collapsed',!open);if(persist){PREF.side=open?'open':'closed';try{localStorage.setItem(PK,JSON.stringify(PREF))}catch(e){}}
  $('#sideToggle').setAttribute('aria-pressed',!open);
  $('#sideToggle').setAttribute('aria-label',open?'Hide sidebar':'Show sidebar');
  $('#sideToggle').setAttribute('title',(open?'Hide':'Show')+' sidebar (Ctrl+B)');
  setTimeout(placeInk,400);
}
const toggleSideDesk=()=>setSide($('#app').classList.contains('side-collapsed'));
$('#sideToggle').addEventListener('click',toggleSideDesk);$('#sideFold').addEventListener('click',toggleSideDesk);
addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){e.preventDefault();toggleSideDesk();return}
  if(e.key==='Escape'){if($('#scrim').classList.contains('show'))return;if(fsEl){closeFS();e.stopPropagation();return}if($('#work').classList.contains('wide'))setWide(false)}},true);
setSide(PREF.side!=='closed',false);
const _cp=closePanel;closePanel=function(){setWide(false);return _cp.apply(this,arguments)};


// Local conversation history and account help/settings views.
const CHAT_KEY=()=>`lilact.chats.v1.${S.user?.id||'anon'}`;let chats=[],activeChat=null;
let otherChats=[];
function chatsRead(){let all=[];try{all=JSON.parse(localStorage.getItem(CHAT_KEY())||'[]')}catch(e){}const f=accountFirm();const mine=c=>!c.firmId||c.firmId===f;otherChats=all.filter(c=>!mine(c));return all.filter(mine)}
function chatsWrite(){try{chats.sort((a,b)=>b.updatedAt-a.updatedAt);chats=chats.slice(0,50);localStorage.setItem(CHAT_KEY(),JSON.stringify(chats.concat(otherChats)))}catch(e){toast('Chat history could not be saved')}}
function chatHasMessages(){return !!msgs?.querySelector('.msg.user')}
function chatSave(){if(!S.user||!activeChat||!msgs)return;const c=chats.find(x=>x.id===activeChat);if(!c)return;Object.assign(c,{firmId:accountFirm(),case:S.case,updatedAt:Date.now(),stage:S.stage,cause:S.cause,done:[...S.done],html:threadHTML()});chatsWrite();chatRender()}
function chatNew(){if(chatHasMessages())chatSave();Object.values(THREADS).forEach(t=>{t.innerHTML='';t.dataset.init='0'});msgs=THREADS.tv1;resetFlow();welcome('tv1');activeChat='c'+Date.now().toString(36);chats.unshift({id:activeChat,title:'New chat',firmId:accountFirm(),case:S.case,createdAt:Date.now(),updatedAt:Date.now(),stage:S.stage,cause:null,done:[],html:threadHTML()});chatsWrite();$('#taskTitle').textContent='New chat';chatRender();renderDemoChips()}
function chatRender(){const box=$('#chatHistoryList');if(!box)return;if(!chats.length){box.innerHTML='<p class="chat-empty">No chats yet</p>';return}const day=new Date().setHours(0,0,0,0),groups=[['Today',c=>c.updatedAt>=day],['Previous 7 days',c=>c.updatedAt<day&&c.updatedAt>=day-7*DAY],['Older',c=>c.updatedAt<day-7*DAY]];box.innerHTML=groups.map(([n,f])=>{const a=chats.filter(f);return a.length?`<div class="chat-group-title">${n}</div>${a.map(c=>`<div class="chat-row ${c.id===activeChat?'on':''}" data-id="${esc(c.id)}"><button class="chat-open" title="${esc(c.title)}">${esc(c.title)}</button><button class="chat-more" aria-label="Chat options" aria-haspopup="menu" aria-expanded="false">⋯</button></div>`).join('')}`:''}).join('');box.querySelectorAll('.chat-open').forEach(b=>b.onclick=()=>{showView('chat');chatRestore(b.closest('.chat-row').dataset.id);closeSide()});box.querySelectorAll('.chat-more').forEach(b=>b.onclick=e=>{e.stopPropagation();openChatMenu(b,chats.find(x=>x.id===b.closest('.chat-row').dataset.id))})}
function chatRestore(id){const c=chats.find(x=>x.id===id);if(!c)return;if(c.firmId&&FIRMS[c.firmId])switchContext(c.firmId,c.case,{silent:true});Object.values(THREADS).forEach(t=>t.innerHTML='');activeChat=id;msgs=THREADS.tv1;msgs.innerHTML=c.html;$$('.hero',msgs).forEach(h=>h.remove());if(threadIsEmpty())welcome('tv1');S.stage=c.stage|0;S.cause=c.cause;S.done=new Set(c.done||[]);S.task='tv'+Math.min(4,S.stage+1);$$('.rcact button,.liq-act button,.suggest button,.result button',msgs).forEach(b=>{b.disabled=true;b.title='Ask again to refresh this result'});applyStage();$('#taskTitle').textContent=c.title;renderDemoChips();chatRender();scroll()}
function chatLoad(){chats=chatsRead();chatRender();if(chats.length)chatRestore(chats[0].id);else chatNew()}
// New chat goes straight back to the conversation from any screen (Company data, Approval queue…).
function startNewChat(){showView('chat');closePanel();chatNew();closeSide();const ci=$('#chatInput');if(!ci.disabled)ci.focus({preventScroll:true})}
$('#newChat').onclick=startNewChat;$('#newChatSide').onclick=startNewChat;
$('#taskTitle').ondblclick=()=>{const h=$('#taskTitle'),v=h.textContent,i=document.createElement('input');i.value=v;i.className='chat-title-input';h.replaceChildren(i);i.focus();i.select();i.onkeydown=e=>{if(e.key==='Enter'){const c=chats.find(x=>x.id===activeChat);if(c){c.title=i.value.slice(0,48)||'New chat';chatsWrite();chatRender()}h.textContent=c?.title||'New chat'}if(e.key==='Escape')h.textContent=v};i.onblur=()=>{if(i.isConnected)h.textContent=v}};
document.addEventListener('change',e=>{if(e.target.id==='firmSel'&&chatHasMessages())chatSave()},true);
uploadComposerFiles=async function(){if(!pendingChatFiles.length)return;leaveChatEmpty();await uploadComposerAuto();chatSave()};
const sendChatOriginal=sendChat;sendChat=async function(t){if(!activeChat)chatNew();const c=chats.find(x=>x.id===activeChat);if(c&&c.title==='New chat'){c.title=String(t).slice(0,48);$('#taskTitle').textContent=c.title;chatRender()}if(String(t||'').trim()&&!busy)leaveChatEmpty();await sendChatOriginal(t);chatSave()};
const enterAppOriginal=enterApp;enterApp=function(u,o={}){const r=enterAppOriginal(u,o);document.getElementById('umName').textContent=u.name||'Business owner';document.getElementById('umEmail').textContent=u.email||'';document.getElementById('umCompany').textContent=u.company||'';document.getElementById('umTax').textContent=u.taxCode?`Tax code ${u.taxCode}`:'';if(o.fresh){chats=[];activeChat=null}applyAccountCompany();chatLoad();applyAccountCompany();return r};
const firmSelOld=$('#firmSel').onchange;$('#firmSel').addEventListener('change',()=>{if(chatHasMessages())chatSave();activeChat=null;chatNew()});
$('#btnSettings').onclick=()=>{closeUserMenu();openSettings()};
$('#btnHelp').onclick=()=>{closeUserMenu();openModal(`<div class="help-modal"><button class="settings-close" aria-label="Close">×</button><h2>How Lilact works</h2><p>Ask in English. Copilot diagnoses working capital, forecasts cash, finds funding and tests what-if options. Every action is a draft that waits for your approval.</p><h3>Try a question</h3>${['Where is my working capital stuck?','Which customer holds most of my receivables?','Why am I short of cash? Show me the cause.'].map(q=>`<button class="btn sec help-prompt">${esc(q)}</button>`).join('')}<h3>Keyboard shortcuts</h3><p>Ctrl+B sidebar · / chat · Enter send · Shift+Enter new line · Esc close</p><h3>Frequently asked questions</h3><details><summary>Where is data stored?</summary><p>In this browser.</p></details><details><summary>Which files affect calculations?</summary><p>Recognised table files (invoices, inventory, 13-week plan, financial statements) are read automatically once the required files are uploaded; Word files are reference only.</p></details><details><summary>Why are figures estimates?</summary><p>The demo uses synthetic data and indicative products.</p></details></div>`,m=>{m.querySelector('.settings-close').onclick=closeModal;m.querySelectorAll('.help-prompt').forEach(b=>b.onclick=()=>{$('#chatInput').value=b.textContent;closeModal();$('#chatInput').focus()})})};
function closeUserMenu(){$('#userMenu').hidden=true;$('#userBtn').setAttribute('aria-expanded','false')}
function openSettings(section='General',query=''){
 const u=S.user||{},demo=isDemoUser(u),names=['General','Account','Privacy','Billing','Usage','Log out'],fields={General:['Appearance','Light','Dark','System','Display density','Motion effects','Reset settings'],Account:['Full name','Company','Email','Tax code','Change password','Delete account'],Privacy:['Clear chat history','Delete all uploaded files','Export my data'],Billing:['Current plan','Billing is not available'],Usage:['conversations','messages','files','data updates','drafts']};let q=query.toLowerCase(),sel=q&&names.slice(0,5).find(n=>n.toLowerCase().includes(q)||(fields[n]||[]).some(x=>x.toLowerCase().includes(q)))||section;if(!names.includes(sel)||sel==='Log out')sel='General';
 let content='';if(sel==='General')content=`<h2>General</h2><section class="settings-block ${query&&'appearance dark system light'.includes(query.toLowerCase())?'search-hit':''}" data-label="Appearance"><h3>Appearance</h3><div class="settings-choice">${['Light','Dark','System'].map(x=>`<button data-theme="${x.toLowerCase()}" aria-pressed="${PREF.theme===x.toLowerCase()}">${x}</button>`).join('')}</div></section><section class="settings-block"><h3>Display density</h3><div class="settings-choice">${[['comfy','Comfortable'],['compact','Compact']].map(([v,x])=>`<button data-density="${v}" aria-pressed="${PREF.density===v}">${x}</button>`).join('')}</div></section><section class="settings-block"><label class="settings-switch"><span><b>Motion effects</b><small>Reduce transitions and chart animation.</small></span><input id="settingsMotion" type="checkbox" ${PREF.motion?'checked':''}></label></section><button class="btn sec" id="resetSettings">Reset settings</button>`;
 if(sel==='Account')content=`<h2>Account</h2><div class="settings-avatar"><span class="avatar">${esc(initials(u.name))}</span>${demo?'Demo account':'Account details'}</div><form id="profileForm"><label class="settings-field">Full name<input name="name" value="${esc(u.name||'')}" ${demo?'disabled':''}></label><label class="settings-field">Company<input name="company" value="${esc(u.company||'')}" ${demo?'disabled':''}></label><label class="settings-field">Email<input value="${esc(u.email||'')}" readonly></label><label class="settings-field">Tax code<input value="${esc(u.taxCode||'Not provided')}" readonly></label>${demo?'':'<button class="btn primary">Save profile</button>'}</form><section class="settings-block"><h3>Business model</h3><label class="settings-field">Business model<select id="bizModel"><option value="undeclared">Not declared (default FOB thresholds)</option><option value="CMT">CMT – garment subcontracting</option><option value="FOB">FOB – own materials</option></select></label><p>Selects the garment-industry thresholds (tv1.threshold.v2) used by the working-capital diagnosis.</p></section>${demo?'':'<section class="settings-block"><h3>Change password</h3><form id="changePw"><label class="settings-field">Current password<input name="old" type="password"></label><label class="settings-field">New password<input name="new" type="password"></label><label class="settings-field">Confirm password<input name="confirm" type="password"></label><p id="pwError" class="settings-error"></p><button class="btn sec">Change password</button></form></section><button class="btn danger" id="deleteAccount">Delete account</button>'}`;
 if(sel==='Privacy')content=`<h2>Privacy</h2><p>Your data is stored in this browser. Copilot provides advice only; actions require your review and approval.</p><section class="settings-block"><button class="btn sec" id="clearChats">Clear chat history</button></section><section class="settings-block"><button class="btn sec" id="clearFiles">Delete all uploaded files</button><p>Data already used in your analysis is kept.</p></section><button class="btn sec" id="exportData">Export my data</button>`;
 if(sel==='Billing')content='<h2>Billing</h2><section class="settings-block billing-card"><b>Current plan: Demo (free)</b><p>Billing is not available in this demo.</p></section>';
 if(sel==='Usage')content='<h2>Usage</h2><p>Counted in this browser only</p><div id="usageStats" class="usage-stats"><p>Loading local usage...</p></div>';
 openModal(`<div class="settings-shell"><aside class="settings-nav"><label class="settings-search"><input id="settingsSearch" placeholder="Search settings" value="${esc(query)}"></label><nav>${names.slice(0,5).map(n=>`<button data-section="${n}" class="${n===sel?'on':''}">${n}</button>`).join('')}<div class="settings-nav-rule"></div><button class="settings-logout" data-section="Log out">Log out</button></nav></aside><section class="settings-content"><button class="settings-close" aria-label="Close settings">×</button><button class="settings-back">← Back</button><div class="settings-no-results" hidden>No settings match</div><div class="settings-body">${content}</div></section></div>`,m=>{const shell=m.querySelector('.settings-shell'),reopen=(s=sel,v='')=>openSettings(s,v);m.querySelector('.settings-close').onclick=closeModal;m.querySelector('.settings-back').onclick=()=>shell.classList.remove('content-open');if(innerWidth<=600)shell.classList.add('content-open');m.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>b.dataset.section==='Log out'?confirmAction('Log out?','Return to sign in?',()=>{closeModal();leaveApp()}):reopen(b.dataset.section));m.querySelector('#settingsSearch').oninput=e=>{const v=e.target.value.toLowerCase(),n=names.slice(0,5).find(x=>x.toLowerCase().includes(v)||(fields[x]||[]).some(y=>y.toLowerCase().includes(v)));if(!v){m.querySelector('.settings-no-results').hidden=true;m.querySelector('.settings-body').hidden=false;return}if(!n){m.querySelector('.settings-no-results').hidden=false;m.querySelector('.settings-body').hidden=true}else{m.querySelector('.settings-no-results').hidden=true;m.querySelector('.settings-body').hidden=false;if(n!==sel){const pos=e.target.selectionStart;reopen(n,v);requestAnimationFrame(()=>{const input=document.querySelector('#settingsSearch');if(input){input.focus();input.setSelectionRange(pos,pos)}})}}};m.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{PREF.theme=b.dataset.theme;savePrefs();reopen('General')});m.querySelectorAll('[data-density]').forEach(b=>b.onclick=()=>{PREF.density=b.dataset.density;savePrefs();reopen('General')});const bm=m.querySelector('#bizModel');if(bm){const f=accountFirm()||S.firm,pm=POLICY.get(f).business_model;bm.value=pm||(DATA.snaps[f]&&DATA.snaps[f].firm.business_model)||'undeclared';bm.onchange=()=>{POLICY.set(f,{business_model:bm.value},'Business model declared in Settings');refreshTab();toast('Business model saved')}}const motion=m.querySelector('#settingsMotion');if(motion)motion.onchange=()=>{PREF.motion=motion.checked;savePrefs()};const reset=m.querySelector('#resetSettings');if(reset)reset.onclick=()=>{Object.assign(PREF,{theme:'light',density:'comfy',motion:true});savePrefs();reopen('General')};const pf=m.querySelector('#profileForm');if(pf)pf.onsubmit=e=>{e.preventDefault();const all=users(),i=all.findIndex(x=>x.id===u.id);all[i].name=pf.elements.name.value.trim()||u.name;all[i].company=pf.elements.company.value.trim()||u.company;saveUsers(all);S.user=all[i];renameAccountCompany(all[i]);$('#uName').textContent=u.name;$('#umName').textContent=u.name;$('#umCompany').textContent=u.company;toast('Profile updated');reopen('Account')};const pw=m.querySelector('#changePw');if(pw)pw.onsubmit=async e=>{e.preventDefault();const all=users(),x=all.find(v=>v.id===u.id),err=m.querySelector('#pwError');if(await hashPw(pw.elements.old.value,x.salt)!==x.hash){err.textContent='Current password is incorrect';return}if(pwRuleErrors(pw.elements.new.value).length){err.textContent='Password must have 8+ characters with an uppercase letter, a lowercase letter, a digit and a special character';return}if(pw.elements.new.value!==pw.elements.confirm.value){err.textContent='Passwords do not match';return}x.salt=salt();x.hash=await hashPw(pw.elements.new.value,x.salt);saveUsers(all);err.textContent='Password changed'};const cl=m.querySelector('#clearChats');if(cl)cl.onclick=()=>confirmAction('Clear chat history?','All saved conversations will be removed from this browser.',()=>{try{localStorage.removeItem(CHAT_KEY())}catch(e){}chats=[];activeChat=null;chatNew();closeModal()});const cf=m.querySelector('#clearFiles');if(cf)cf.onclick=async()=>{const fs=await FILES.list();confirmAction('Delete uploaded files?','Data already used in your analysis is kept.',async()=>{await FILES.remove(fs.map(x=>x.id));addLog({tool:'delete_files',tier:1,args:{count:fs.length},status:'ok',summary:'Deleted uploaded files'});toast('Uploaded files deleted');reopen('Privacy')})};const ex=m.querySelector('#exportData');if(ex)ex.onclick=async()=>{const f=await FILES.list(),safe={account:{id:u.id,name:u.name,company:u.company,email:u.email,taxCode:u.taxCode||null},files:f.map(({id,userId,firmId,name,ext,kind,size,uploadedAt,status,snapshotId})=>({id,userId,firmId,name,ext,kind,size,uploadedAt,status,snapshotId})),chats};dlFile('lilact-my-data.json',JSON.stringify(safe,null,2),'application/json')};const del=m.querySelector('#deleteAccount');if(del)del.onclick=()=>confirmAction('Delete account?','Confirm again to delete this account and its browser data.',()=>confirmAction('Confirm account deletion','This permanently removes your local account data.',async()=>{const email=u.email.toLowerCase();saveUsers(users().filter(x=>x.id!==u.id));store.del(DK+email);store.del('smefc.pins.v1.'+email);try{localStorage.removeItem(CHAT_KEY())}catch(e){}const fs=await FILES.list();await FILES.remove(fs.map(x=>x.id));closeModal();leaveApp()}))})
 if(sel==='Usage')void (async()=>{const files=await FILES.list(),d=dstore.load(),snaps=Object.values(d.firms||{}).reduce((n,f)=>n+(f.snaps||[]).length,0),bytes=files.reduce((n,f)=>n+(f.size||0),0),sent=chats.reduce((n,c)=>n+(c.html.match(/class="msg user"/g)||[]).length,0),pending=S.drafts.filter(x=>x.status==='pending_approval').length,approved=S.drafts.filter(x=>x.status==='executed (simulated)').length,rejected=S.drafts.filter(x=>x.status==='rejected').length;const b=document.querySelector('#usageStats');if(b)b.innerHTML='<div><b>'+chats.length+'</b><span>Conversations</span></div><div><b>'+sent+'</b><span>Messages sent</span></div><div><b>'+files.length+' · '+sizeLabel(bytes)+'</b><span>Uploaded files</span></div><div><b>'+snaps+'</b><span>Data updates</span></div><div><b>'+pending+' / '+approved+' / '+rejected+'</b><span>Pending / approved / rejected drafts</span></div>'})()
}
$('#btnSettings').onclick=()=>{closeUserMenu();openSettings()};
// Empty chat: greeting, composer and starter questions sit centred in the chat column until the first
// message (typed, chip or file upload). The greeting is removed then and never saved to chat history.
function threadIsEmpty(){return !msgs||![...msgs.children].some(e=>!e.classList.contains('hero'))}
function syncChatEmpty(){const col=document.querySelector('.chatcol');if(col)col.classList.toggle('is-empty',threadIsEmpty())}
function threadHTML(){const c=msgs.cloneNode(true);c.querySelectorAll('.hero').forEach(h=>h.remove());return c.innerHTML}
function leaveChatEmpty(){
  if(!msgs||!threadIsEmpty())return;
  msgs.querySelectorAll('.hero').forEach(h=>h.remove());
  const col=document.querySelector('.chatcol');col.classList.remove('is-empty');
  if(PREF.motion!==false&&!reduceMotion){col.classList.add('is-leaving');setTimeout(()=>col.classList.remove('is-leaving'),220)}
}
new MutationObserver(syncChatEmpty).observe(document.getElementById('thread-flow'),{childList:true});

function isDemoUser(u){return !!u&&(u.id==='u-demo'||DEMOS.some(d=>d.email===u.email))}
// The company this account analyses: the demo company, or the business the user created from their own files.
function accountFirm(u=S.user){
  if(!u)return null;
  if(isDemoUser(u)){const d=DEMOS.find(x=>x.email===u.email)||DEMO;return d.firmId}
  const firms=Object.values(dstore.load().firms||{}).sort((a,b)=>(a.created||0)-(b.created||0));
  const own=firms.find(f=>f.id===u.firmId)||firms[0];
  return own&&FIRMS[own.id]?own.id:null;
}
function renameAccountCompany(u){
  if(isDemoUser(u))return;const id=accountFirm(u);if(!id)return;
  const d=dstore.load();if(d.firms[id]&&u.company){d.firms[id].name=u.company;dstore.save(d);syncUserFirms()}
  applyAccountCompany();
}
function applyAccountCompany(){
  const u=S.user;if(!u)return;
  const firm=accountFirm(u),noData=!firm;
  $('#app').classList.toggle('no-company-data',noData);
  $('#uSub').textContent=u.company||u.email;$('#umCompany').textContent=u.company||'';
  const ci=$('#chatInput');ci.disabled=noData;ci.placeholder=noData?'Upload your company data to start…':'Ask about your cash, receivables, shortfalls or financing…';
  if(firm&&S.firm!==firm)switchContext(firm,defCase(firm),{silent:true});
}
const saveImportOne=saveImport;saveImport=function(ev){lockAccountName();const r=saveImportOne(ev);const u=S.user,id=accountFirm(u);if(u&&id&&isUserFirm(id)&&u.firmId!==id){const all=users(),x=all.find(v=>v.id===u.id);if(x){x.firmId=id;saveUsers(all);S.user=x}}applyAccountCompany();return r};
// The business name always comes from the account; files and the sample dataset cannot change it.
function lockAccountName(u=S.user){
  if(!u||isDemoUser(u)||!DW.form)return;const company=u.company||'';
  Object.defineProperty(DW.form,'name',{get:()=>company,set:()=>{},enumerable:true,configurable:true});
}
async function ensureDemoAccounts(){
  const all=users();let changed=false;
  for(const d of DEMOS){const u=all.find(x=>x.email===d.email);
    if(!u){const sl=salt();all.push({id:d.firmId==='F01'?'u-demo':'u-demo-'+d.firmId.toLowerCase(),name:d.name,company:d.company,firmId:d.firmId,email:d.email,salt:sl,hash:await hashPw(d.pw,sl),created:new Date().toISOString()});changed=true}
    else if(u.firmId!==d.firmId||u.company!==d.company){u.firmId=d.firmId;u.company=d.company;changed=true}}
  if(changed)saveUsers(all);
}

// Company data is a single Files screen. Recognised tables are read, checked and saved as the
// company's data in the background, with the existing import pipeline (no review screen).
const openDataScreenOne=openDataScreen;openDataScreen=function(){return openDataScreenOne('files')};
startImport=function(){if(isDemoUser(S.user)){toast('Demo accounts use fixed sample data. Create an account to analyse your own company.');return}openDataScreen('files')};
openReviewImport=function(){return startImport()};
FILES.setStatus=async function(ids,status){if(!ids?.length)return;try{const db=await this.db();await Promise.all(ids.map(id=>new Promise((ok,no)=>{const tx=db.transaction('files','readwrite'),s=tx.objectStore('files'),r=s.get(id);r.onsuccess=()=>{if(r.result&&r.result.userId===S.user.id){r.result.status=status;s.put(r.result)}};tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})))}catch(e){this.warn();this.memory.forEach(x=>{if(ids.includes(x.id))x.status=status})}};
function fileStatusLabel(st){if(st.startsWith('Used'))return 'Used in analysis';if(st==='Pending review')return 'Processing';return st}
let importQueue=Promise.resolve();
function autoImportFiles(){const run=importQueue.then(autoImportNow,autoImportNow);importQueue=run.catch(()=>{});return run}
async function autoImportNow(){
  const u=S.user;if(!u)return {status:'none'};
  const all=(await FILES.list()).filter(f=>f.kind==='table'&&f.status!=='Not recognised').sort((a,b)=>Date.parse(a.uploadedAt)-Date.parse(b.uploadedAt));
  if(isDemoUser(u)){const fresh=all.filter(f=>f.status==='Pending review').map(f=>f.id);await FILES.setStatus(fresh,'Not used: demo data is fixed');return {status:'demo'}}
  if(!all.some(f=>!f.status.startsWith('Used')&&!f.status.startsWith('Replaced')))return {status:'none'};
  // Latest file of each type wins; older files of the same type are kept but replaced.
  const latest={};
  for(const f of all){try{const text=await fileText(f.blob),type=detectedFileType(text);if(!type){await FILES.setStatus([f.id],'Not recognised');continue}const rows=parseCSV(text);if(rows.length<2){await FILES.setStatus([f.id],'Could not read: no data rows');continue}latest[type]={f,text}}catch(e){await FILES.setStatus([f.id],'Could not read this file')}}
  const used=Object.values(latest).map(x=>x.f.id),replaced=all.map(f=>f.id).filter(id=>!used.includes(id));
  const own=accountFirm(u),firmId=own&&isUserFirm(own)?own:null,f=firmId?dstore.load().firms[firmId]:null,snap=f&&activeSnap(f);
  Object.assign(DW,{view:'list',firmId,files:{},registryIds:[],fmt:'auto',mode:'replace',pick:{},err:''});
  DW.form=f?{name:f.name,industry:f.industry||'',buffer:f.buffer,asOf:snap.asOf,rev:snap.tables.fin[0].rev,cogs:snap.tables.fin[0].cogs,cash0:snap.tables.fin[0].cash0!=null?snap.tables.fin[0].cash0:snap.tables.fin[0].opening,touched:{}}:{name:'',industry:'',buffer:'',asOf:'',rev:'',cogs:'',cash0:'',touched:{}};
  lockAccountName(u);
  for(const x of Object.values(latest))addRaw(x.f.name,x.text);
  const ev=evalImport();formDefaults(ev);if(DW.form.buffer===''||DW.form.buffer==null)DW.form.buffer=0;
  const bad=Object.entries(ev.issues).filter(([t,i])=>i.fatalMissing);
  for(const [t,i] of bad)await FILES.setStatus([latest[t].f.id],`Missing columns: ${i.fatalMissing.join(', ')}`);
  const has=t=>ev.tables[t]||(snap&&snap.tables[t]&&snap.tables[t].length),F=DW.form,need=[];
  if(!(+F.rev>0)||!(+F.cogs>0)||F.cash0===''||F.cash0==null)need.push('financial statements');
  if(!has('sales')&&!has('purchases')&&!has('planned'))need.push('sales invoices, purchase invoices or a 13-week plan');
  if(!F.asOf)need.push('dated sales or purchase invoices');
  const ok=used.filter(id=>!bad.some(([t])=>latest[t].f.id===id));
  if(bad.length||need.length){await FILES.setStatus(ok,need.length?`Waiting for ${need.join(' and ')}`:'Waiting for the other files to be fixed');return {status:'waiting',need,bad:bad.length}}
  if(!threadIsEmpty())chatNew();
  const note=document.createElement('p');note.id='dSaveNote';note.hidden=true;document.body.appendChild(note);
  const before=snap?snap.id:null;
  const toastOne=toast;toast=()=>{};try{saveImport(ev)}finally{toast=toastOne;note.remove()}
  const id=accountFirm(u),after=id&&isUserFirm(id)?activeSnap(dstore.load().firms[id]):null;
  if(!after||after.id===before){await FILES.setStatus(ok,'Could not read: check the columns and dates');return {status:'error'}}
  await FILES.markUsed(ok,after.id);await FILES.setStatus(replaced.filter(id=>all.find(x=>x.id===id).status.startsWith('Used')),'Replaced by a newer file');
  return {status:'saved',snap:after.id};
}
function importNote(n,r){const got=`${n} file${n===1?'':'s'} added`;
  if(r.status==='saved')return `${got}. Your company data is updated.`;
  if(r.status==='waiting'&&r.need.length)return `${got}. Still needed: ${r.need.join(', ')}.`;
  if(r.status==='waiting')return `${got}. Some files are missing required columns.`;
  if(r.status==='error')return `${got}. The files could not be read; check the columns and dates.`;
  if(r.status==='demo')return `${got}. Demo accounts keep their fixed sample data.`;
  return got}
async function uploadComposerAuto(){
  const files=pendingChatFiles.slice();pendingChatFiles=[];renderChatFiles();
  const added=await acceptFiles(files);if(!added.length)return;
  const docs=added.filter(x=>x.kind==='document').length;
  addLog({tool:'upload_files',tier:1,args:{files:added.map(x=>x.name)},status:'ok',summary:`Received ${added.length} file${added.length===1?'':'s'}`});
  const r=await autoImportFiles();
  const b=newBot();await say(b,`<p>${esc(importNote(added.length,r))}</p>${docs?`<p>Word documents are kept for reference only.</p>`:''}${r.status==='saved'?'<p>Ask a question to analyse the updated data.</p>':''}`);scroll();
}
document.addEventListener('click',e=>{if(e.target.closest('[data-setup-data]')){openDataScreen('files');$('#dataFileInput').click()}});

// Chat row options open as a small menu next to the ⋯ button; Rename opens a dialog with Cancel and Save.
function closeChatMenu(){const m=document.querySelector('.chat-menu');if(!m)return;m.remove();document.querySelectorAll('.chat-more[aria-expanded="true"]').forEach(x=>{x.setAttribute('aria-expanded','false');x.closest('.chat-row')?.classList.remove('menu-open')})}
function openChatMenu(btn,c){
  const open=btn.getAttribute('aria-expanded')==='true';closeChatMenu();if(open||!c)return;
  const m=document.createElement('div');m.className='chat-menu';m.setAttribute('role','menu');
  m.innerHTML='<button type="button" role="menuitem" data-chat-act="rename"><span aria-hidden="true">✎</span>Rename</button><button type="button" role="menuitem" class="danger" data-chat-act="delete"><span aria-hidden="true">⌫</span>Delete</button>';
  document.body.appendChild(m);btn.setAttribute('aria-expanded','true');btn.closest('.chat-row')?.classList.add('menu-open');
  const r=btn.getBoundingClientRect(),w=m.offsetWidth,h=m.offsetHeight;
  m.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+'px';
  m.style.top=(r.bottom+4+h>innerHeight-8?r.top-h-4:r.bottom+4)+'px';
  m.querySelector('[data-chat-act="rename"]').onclick=()=>{closeChatMenu();renameChatDialog(c)};
  m.querySelector('[data-chat-act="delete"]').onclick=e=>{e.stopPropagation();closeChatMenu();confirmAction('Delete this chat?','This conversation will be removed from this browser.',()=>deleteChat(c.id),{okLabel:'Delete'})};
  m.querySelector('button').focus({preventScroll:true});
}
function renameChatDialog(c){
  openModal(`<form class="rename-chat" id="renameChatForm"><h3>Rename chat</h3><label class="sr" for="chatName">Chat name</label><input id="chatName" value="${esc(c.title)}" maxlength="48" autocomplete="off"><div class="acts"><button type="button" class="btn sec" id="chatCancelName">Cancel</button><button type="submit" class="btn primary" id="chatSaveName">Save</button></div></form>`,n=>{
    const input=n.querySelector('#chatName');setTimeout(()=>{input.focus();input.select()},40);
    n.querySelector('#chatCancelName').onclick=closeModal;
    n.querySelector('#renameChatForm').onsubmit=e=>{e.preventDefault();c.title=input.value.trim().slice(0,48)||'New chat';chatsWrite();chatRender();if(activeChat===c.id)$('#taskTitle').textContent=c.title;closeModal()};
  });
}
// Shared confirmation dialog (delete chat, log out, clear data, delete account).
// It was called before but never defined, so Delete chat threw a ReferenceError and nothing was deleted.
function confirmAction(title,msg,onOk,{okLabel='Confirm',danger=true}={}){
  openModal(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="acts"><button type="button" class="btn sec" id="cfNo">Cancel</button><button type="button" class="btn ${danger?'danger':'primary'}" id="cfYes">${esc(okLabel)}</button></div>`,m=>{
    $('#cfNo',m).onclick=closeModal;
    $('#cfYes',m).onclick=async()=>{closeModal();await onOk()};
  });
}
// Delete one chat. If it is the open chat, switch to the most recent remaining chat, or start a new one if none is left.
function deleteChat(id){
  const wasActive=activeChat===id;
  chats=chats.filter(x=>x.id!==id);
  if(wasActive){activeChat=null;chatsWrite();if(chats.length)chatRestore(chats[0].id);else chatNew()}
  else{chatsWrite();chatRender()}
  toast('Chat deleted');
}
document.addEventListener('click',e=>{if(!e.target.closest('.chat-menu'))closeChatMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.chat-menu')){const b=document.querySelector('.chat-more[aria-expanded="true"]');closeChatMenu();b&&b.focus()}});
addEventListener('resize',closeChatMenu);document.addEventListener('scroll',closeChatMenu,true);

ensureDemoAccounts().then(initAuth);
