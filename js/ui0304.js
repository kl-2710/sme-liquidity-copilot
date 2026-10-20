/* Solutions (UC03) and What-if (UC04) views and chat answers. Rendering only: every figure comes from js/uc0304.js on the UC01/UC02 runs
   of the app (uc01(), uc02()); app.js helpers ($, esc, money, openModal, toast, botNote…) are used at call time. Two roles only
   (owner, accountant); the app analyses and simulates, decisions and actions happen outside it (UC04.6). */
const U34=(()=>{
  const OUTSIDE='Analysis and simulation only. A follow-up can be prepared as a draft for the Approval queue; an approval is recorded as a simulated action and nothing is sent outside the app.';
  const GROUP={O4:'Receivables (AR)',O3:'Inventory release (INV)',O1:'Payables extension (AP)',O2:'Short-term borrowing',I0:'Short-term investment',R0:'Hold as reserve',O0:'Internal funds'};
  const CELL={M1:'Safe + short of cash',M2:'Safe + surplus',M3:'At risk + short of cash',M4:'At risk + surplus',M5:'Severe + short of cash',M6:'Severe + surplus'};
  const W_TXT={W0:'W0 safe',W1:'W1 at risk',W2:'W2 severe bottleneck',unknown:'W not released'};
  const TH_TXT={TH01:'TH01 short of cash',TH02:'TH02 surplus',in_band:'Within the watch band',unknown:'Cash state not released'};
  const REASON={TOO_SLOW:'Too slow: cash arrives after the need date',STRATEGIC_OR_CRITICAL:'Strategic customer or essential supplier',PLEDGED:'Already pledged',
    NO_PRODUCT_DATA:'No product data',PROGRAM_HEADROOM_EXHAUSTED:'No unused limit',NO_NET_CASH:'Nothing to use in the shortfall window',CATALOGUE_EXPIRED:'Catalogue expired',
    NO_ELIGIBLE_LOT:'No owned lot free of pledge and order constraints',CREATES_LATER_SHORTFALL:'Would create a shortfall on a later date',BELOW_MIN_DRAW:'Too small for the gap',
    MAX_SOURCES:'Four sources already',GAP_COVERED:'Gap already covered',TO_CONSIDER:'To consider: evidence missing',NO_USABLE_OBJECT:'No usable object for this shortfall',
    DISPUTE_STATUS_UNKNOWN:'Dispute or assignment status unknown'};
  const CONCL={full:'Full improvement within scope',partial:'Partial improvement',none:'No improvement',worse:'Worse'};
  const CONCL_CLS={full:'green',partial:'amber',none:'gray',worse:'red'};
  const SC_NAME={base:'Base',conservative:'Conservative',positive:'Positive'};
  const store={get(k,d){try{return JSON.parse(localStorage.getItem(k)||'null')??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  // Records of the enterprise (proposals, selections), shared by its Business Owner and Accountant and by nobody else.
  const keyOf=kind=>`lilact.${kind}.v2.${((typeof API!=='undefined'&&API.session())||{}).scope||'anon'}`;
  const flagHTML=(v,L,H)=>{const f=UC0304.dayFlag(v,L,H);return f?`<span class="u34-flag ${f.cls}">${f.label}</span>`:''};
  const cellLabel=c=>c?`${c} · ${CELL[c]}`:'No cell';
  const reasonTxt=c=>REASON[c]||c;

  /* ---------- state ---------- */
  // Selection state of UC03 (user exclusions and their versions) and the catalogue proposals (UC03.5), per account and company.
  const SOL={get(){return store.get(keyOf('uc03'),{excluded:{},versions:[],proposals:[],seen:[]})},set(v){store.set(keyOf('uc03'),v)}};
  // The role comes from the signed-in account (API.session); the screen cannot switch it (SRS 3.2.1).
  const ROLE={get(){return (API.session()||{}).role||'owner'},label(){const s=API.session();return s?`${s.user.name} (${API.ROLES[s.role]})`:'—'}};
  const SIMS={};                       // per firm: {runs:[], cur, rows, prefill, cmp:Set, errors, seq}
  const sims=()=>SIMS[S.firm]||(SIMS[S.firm]={runs:[],cur:null,rows:null,prefill:null,cmp:new Set(),errors:[],seq:0,lastParent:null});
  const CACHE=new Map();
  function input(){
    const snap=DATA.snaps[S.firm];if(!snap)return null;const d=uc01(),u=uc02();if(!d||!u)return null;
    const k='in|'+u.run_id+'|'+d.run_id;if(!CACHE.has(k))CACHE.set(k,UC0304.prepInput(snap,d,u));return CACHE.get(k);
  }
  const table=()=>(DATA.uc03||{})[S.firm]||{products:[],params:{}};
  function matchNow(){
    const I=input();if(!I)return null;const st=SOL.get(),k='m|'+I.key+'|'+JSON.stringify(st.excluded)+'|'+JSON.stringify(st.proposals.filter(p=>p.status==='confirmed'));
    if(!CACHE.has(k)){const m=UC0304.match(I,table(),{excluded:st.excluded,proposals:st.proposals});CACHE.set(k,m);
      if(!st.seen.some(x=>x.match_run_id===m.meta.match_run_id)){st.seen.push({match_run_id:m.meta.match_run_id,catalogue_version:m.meta.catalogue_version,cell:m.meta.matrix_case,at:new Date().toISOString()});st.seen=st.seen.slice(-20);SOL.set(st)}}
    return CACHE.get(k);
  }

  /* ---------- small chart: Base before / after with L, Z and H ---------- */
  function chartSVG(before,after,L,Z,H){
    const W=640,Hh=180,p={l:44,r:8,t:10,b:20},vals=[...before.map(x=>x.close),...(after||[]).map(x=>x.close),L,Z,H],lo=Math.min(...vals),hi=Math.max(...vals);
    const x=i=>p.l+(W-p.l-p.r)*i/Math.max(1,before.length-1),y=v=>p.t+(Hh-p.t-p.b)*(1-(v-lo)/Math.max(1,hi-lo));
    const line=(a,cls)=>`<polyline class="${cls}" fill="none" points="${a.map((d,i)=>`${x(i).toFixed(1)},${y(d.close).toFixed(1)}`).join(' ')}"/>`;
    const hl=(v,cls,t)=>`<line class="${cls}" x1="${p.l}" x2="${W-p.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="u34-ax" x="2" y="${(y(v)+3).toFixed(1)}">${t}</text>`;
    const ticks=[0,Math.floor(before.length/2),before.length-1].map(i=>`<text class="u34-ax" x="${x(i).toFixed(1)}" y="${Hh-4}" text-anchor="middle">${fds(before[i].d)}</text>`).join('');
    return `<svg class="u34-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Base cash before and after, with L, Z and H">${hl(L,'u34-l','L')}${hl(Z,'u34-z','Z')}${hl(H,'u34-h','H')}${line(before,'u34-before')}${after?line(after,'u34-after'):''}${ticks}</svg>`;
  }

  /* ---------- Solutions view (UC03.1 – UC03.6) ---------- */
  function headHTML(m,I){
    const pol=m.groups?m.groups.map(g=>`<span class="u34-grp">${g} ${GROUP[g]}</span>`).join('<span class="u34-arrow">→</span>'):'';
    return `<div class="card u34-head"><div class="u34-chips"><span class="status ${I.W==='W2'?'red':I.W==='W1'?'amber':I.W==='W0'?'green':'gray'}">${W_TXT[I.W]}</span>
      <span class="status ${I.TH==='TH01'?'red':I.TH==='TH02'?'blue':'gray'}">${TH_TXT[I.TH]}</span><span class="status blue" id="solCell">${cellLabel(I.cell)}</span></div>
      ${pol?`<p class="u34-pol"><b>Priority policy (${m.meta.priority_policy_version}):</b> ${pol}. The order of the groups is fixed by policy; it is not changed by scores or chat requests.</p>`:''}
      <p class="u34-meta">L ${mm(I.L)} · Z ${mm(I.Z)} · H ${mm(I.H)} (Miller–Orr, ${I.reserves_version||'—'}) · ${m.meta.matrix_version} · catalogue ${esc(m.meta.catalogue_version)} (${m.meta.catalogue_status}) · runs ${esc(m.meta.source_uc01_run)}, ${esc(m.meta.source_uc02_run)} · ${esc(m.meta.match_run_id)}</p>
      ${m.catalogue&&(m.catalogue.expired||m.catalogue.warn)?`<div class="callout ${m.catalogue.expired?'red':'amber'}"><span>⚠</span><div>${m.catalogue.expired?`The catalogue expired on ${fd(m.catalogue.valid_until)}: borrowing products are not offered until it is updated.`:`The catalogue expires on ${fd(m.catalogue.valid_until)} (${m.catalogue.days_left} days).`}</div></div>`:''}</div>`;
  }
  function needHTML(n,L,Z,H){
    const eps=n.episodes.map(e=>`<tr><td>${fds(e.start)}${e.start!==e.end?' – '+fds(e.end):''}</td><td class="num">${e.days}</td><td class="num">${money(e.low)} ${flagHTML(e.low,L,H)}</td><td class="num">${mm(e.floor_peak)}</td><td class="num">${mm(e.target_peak)}</td></tr>`).join('');
    return `<section class="dsec u34-sec" id="solNeed"><header class="dsh"><h3>1 · Need on Base</h3><p>Shortfall below the floor L and the gap to the target Z are reported separately; gaps are never added over days.</p></header>
      <div class="u34-tiles"><div class="card kpi"><div class="t">FloorGap (below L)</div><div class="v num" id="solFloor">${mm(n.floor_peak)}</div><div class="f">${n.floor_peak_date?fds(n.floor_peak_date):'—'} · ${n.floor_days} day(s) below L</div></div>
      <div class="card kpi"><div class="t">TargetGap (to Z)</div><div class="v num" id="solTarget">${mm(n.target_peak)}</div><div class="f">${n.target_days} day(s) below Z</div></div>
      <div class="card kpi"><div class="t">Cash needed from</div><div class="v num">${n.first_floor_day?fds(n.first_floor_day):'—'}</div><div class="f">lowest ${money(n.min)} on ${fds(n.min_date)}</div></div>
      <div class="card kpi"><div class="t">Negative days</div><div class="v num">${n.negative_days}</div><div class="f">cash below 0</div></div></div>
      ${eps?`<div class="table-wrap"><table class="dtable"><thead><tr><th>Episode below L</th><th class="num">Days</th><th class="num">Lowest</th><th class="num">FloorGap</th><th class="num">TargetGap</th></tr></thead><tbody>${eps}</tbody></table></div>`:''}</section>`;
  }
  function remainingHTML(r,id){
    const I=input(),rows=r.daily.filter(x=>x.floor>0||x.target>0).slice(0,12).map(x=>`<tr><td>${fds(x.d)}</td><td class="num">${mm(x.cash)} ${flagHTML(x.cash,I.L,I.H)}</td><td class="num">${x.floor>0?mm(x.floor):'0'}</td><td class="num">${mm(x.target)}</td></tr>`).join('');
    return `<div class="u34-rem" id="${id}"><p><b>Remaining under L:</b> peak ${mm(r.floor_peak)} on ${r.floor_days} day(s). <b>Remaining under Z:</b> peak ${mm(r.target_peak)} on ${r.target_days} day(s).</p>
      ${rows?`<details><summary>Remaining gap by day</summary><div class="table-wrap"><table class="dtable"><thead><tr><th>Day</th><th class="num">Cash</th><th class="num">Under L</th><th class="num">Under Z</th></tr></thead><tbody>${rows}</tbody></table></div></details>`:''}</div>`;
  }
  function packageHTML(m){
    const P=m.package;
    if(P.status==='none')return `<section class="dsec u34-sec" id="solPkg"><header class="dsh"><h3>2 · Package</h3></header><div class="callout red" id="solNoPkg"><span>⛔</span><div><b>No timely package.</b> No eligible source of ${m.groups.map(g=>g).join(' → ')} can bring cash by the need date, so nothing counts as coverage and no excluded source is used to fill the gap.</div></div>${remainingHTML(P.remaining,'solRemain')}</section>`;
    const ev=P.events.map(e=>`<tr><td>${fds(e.date)}</td><td><b>${esc(e.source_id)}</b> ${esc(e.unit)}</td><td>${esc(e.kind)}</td><td class="num ${e.amount<0?'neg':'pos'}">${e.amount<0?'−':'+'}${money(Math.abs(e.amount))}</td></tr>`).join('');
    const dr=P.draws.map(d=>`<li><b>${esc(d.source_id)}</b> ${esc(d.name)} · ${d.group} · net ${money(d.net)} on ${fds(d.fund_date)} · cost ${mm(d.cost)}${d.obligations.length?` · later: ${d.obligations.map(o=>`${money(o.amount)} on ${fds(o.date)}`).join(', ')}`:''}</li>`).join('');
    const st={to_target:'Lifts Base to Z on every shortfall day (days below Z outside the shortfall stay as reported below)',above_floor:'Keeps Base above L; still under Z on some days',partial:'Partial: days below L remain'}[P.status];
    return `<section class="dsec u34-sec" id="solPkg"><header class="dsh"><h3>2 · Package (daily events)</h3><p>${st}. Each invoice, payment, lot or limit is used once; the package is checked so that it creates no shortfall on a later episode or repayment date.</p></header>
      <ul class="u34-draws">${dr}</ul><div class="table-wrap"><table class="dtable"><thead><tr><th>Day</th><th>Source · object</th><th>Event</th><th class="num">Amount</th></tr></thead><tbody>${ev}</tbody></table></div>
      ${P.tail.length?`<p class="hint">After the horizon: ${P.tail.map(t=>`${money(Math.abs(t.amount))} ${esc(t.kind)} on ${fds(t.date)}`).join('; ')}.</p>`:''}
      ${remainingHTML(P.remaining,'solRemain')}<p class="hint">Cost ${mm(P.cost)} · partner agreement and lender approval are not assumed (BR-03-05).</p></section>`;
  }
  function srcStatus(s){
    if(s.in_package)return '<span class="status green">In package</span>';
    if(s.status==='user_excluded')return `<span class="status gray">Not used: ${esc(s.user_excluded.reason)}</span>`;
    if(s.status==='fails')return `<span class="status red">Fails: ${s.reasons.filter(r=>r!=='TOO_SLOW').map(reasonTxt).join(', ')||reasonTxt(s.reasons[0])}</span>`;
    if(s.too_slow)return `<span class="status red">TOO_SLOW · cash ${fds(s.fund_date)}</span>`;
    if(s.status==='lacks_evidence')return '<span class="status amber">To consider: evidence missing</span>';
    const k=(s.skips||[])[0];return k?`<span class="status gray">${esc(reasonTxt(k.code))}</span>`:'<span class="status gray">Not needed</span>';
  }
  function sourcesHTML(m){
    const blk=m.groups.map((g,i)=>{const list=m.sources.filter(s=>s.group===g);
      return `<div class="u34-group"><h4>${i+1}. ${g} · ${GROUP[g]}</h4>${list.length?`<div class="table-wrap"><table class="dtable"><thead><tr><th>Source</th><th>Status</th><th class="num">Net amount</th><th>Cash on</th><th></th></tr></thead><tbody>${list.map(s=>`<tr data-src="${s.id}"><td><b>${s.id}</b> ${esc(s.name)} <small class="u34-ill">illustrative</small></td><td>${srcStatus(s)}</td><td class="num">${money(s.capacity)}</td><td>${fds(s.fund_date)}</td><td class="u34-act"><button class="btn sec sm" data-det="${s.id}" type="button">Details</button>${s.status==='fails'?'':s.status==='user_excluded'?`<button class="btn sec sm" data-undo="${s.id}" type="button">Use again</button>`:`<button class="btn sec sm" data-ex="${s.id}" type="button">Don’t use</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">No source of this group in the catalogue.</p>'}</div>`}).join('');
    return `<section class="dsec u34-sec" id="solSources"><header class="dsh"><h3>3 · Sources by priority group</h3><p>Inside a group: timely → eligibility confirmed → speed → cost on the same amount and term → relationship impact → id.</p></header>${blk}</section>`;
  }
  function excludedHTML(m){
    const li=s=>`<li data-xsrc="${s.id}"><b>${s.id}</b> ${esc(s.name)}: ${(s.reasons.length?s.reasons:['TO_CONSIDER']).map(c=>`<code>${c}</code> ${esc(reasonTxt(c))}`).join('; ')}</li>`;
    const li2=s=>`<li data-xsrc="${s.id}"><b>${s.id}</b> ${esc(s.name)}: ${s.missing_evidence.map(esc).join('; ')||'evidence missing'}</li>`;
    return `<section class="dsec u34-sec" id="solExcluded"><header class="dsh"><h3>4 · Excluded sources</h3><p>Hard checks EL-03-01 … EL-03-07 cannot be overridden. Missing evidence makes a source “to consider”, never coverage.</p></header>
      <div class="u34-cols"><div><h4>Fails</h4><ul class="u34-list" id="solFails">${m.excluded.fails.map(li).join('')||'<li>None</li>'}</ul></div>
      <div><h4>Lacks evidence (to consider)</h4><ul class="u34-list" id="solLacks">${m.excluded.lacks_evidence.map(li2).join('')||'<li>None</li>'}</ul></div></div>
      ${m.excluded.user.length?`<h4>Not used by your choice</h4><ul class="u34-list">${m.excluded.user.map(s=>`<li><b>${s.id}</b>: ${esc(s.user_excluded.reason)} (${esc(s.user_excluded.by)}, ${fd(s.user_excluded.at)})</li>`).join('')}</ul>`:''}
      ${m.excluded.outside_policy.length?`<h4>Outside the policy of ${m.meta.matrix_case}</h4><p class="hint" id="solOutside">${m.excluded.outside_policy.map(s=>`${s.id} (${s.group})`).join(', ')}: not in ${m.groups.join(' → ')}; no group is added implicitly.</p>`:''}</section>`;
  }
  function tryHTML(m){
    const list=m.internal;
    return `<section class="dsec u34-sec" id="solTry"><header class="dsh"><h3>5 · Try the internal part</h3><p>Only O1 / O3 / O4 can be simulated in What-if; the objects, amounts, dates and costs are pre-filled.</p></header>
      ${list.length?`<div class="u34-try">${list.map(s=>`<label class="chk2"><input type="checkbox" data-try="${s.id}" ${s.in_package||(!m.package.draws.length&&s.in_policy)?'checked':''}> <b>${s.id}</b> ${esc(s.name)} (${s.group})</label>`).join('')}</div>`:'<p class="hint">No internal source to simulate.</p>'}
      ${m.not_simulated.length?`<p class="hint" id="solNotSim">Not simulated: ${m.not_simulated.map(s=>`${s.id} (${s.group})`).join(', ')}. Borrowing and investment are outside What-if.</p>`:''}
      <button class="btn primary" id="solTryBtn" type="button" ${list.length?'':'disabled'}>Try in What-if →</button></section>`;
  }
  function versionsHTML(){
    const v=SOL.get().versions;if(!v.length)return '';
    return `<section class="dsec u34-sec" id="solVersions"><header class="dsh"><h3>Selection versions</h3><p>Each choice is a new version; the original package is kept.</p></header><ol class="u34-list" start="0"><li>Original package (no user choice)</li>${v.map(x=>`<li>${esc(x.action)} <b>${esc(x.source_id)}</b>${x.reason?`: “${esc(x.reason)}”`:''} · ${esc(x.by)} · ${fd(x.at)} · ${esc(x.match_run_id)}</li>`).join('')}</ol></section>`;
  }
  function footHTML(){return `<div class="u34-foot"><p class="callout"><span>ⓘ</span><span id="solOutsideNote">${OUTSIDE}</span></p><div class="row"><button class="btn sec" id="solPolicy" type="button">Policy and catalogue</button><button class="btn sec" id="solExport" type="button">⤓ Export results</button></div></div>`}
  function renderSolutions(){
    const p=$('#pane-sol');if(!p)return;const I=input(),m=matchNow();
    if(!I||!m){p.innerHTML='<div class="card"><div class="empty"><b>Company data is not ready.</b><br>Upload the financial statements and at least one cash-flow table; the diagnosis and forecast then run automatically.</div></div>';return}
    let body='';
    if(m.route==='not_routed')body=`<div class="card"><div class="empty" id="solNotRouted"><b>No matrix cell.</b><br>One axis is not released (${m.reason.map(esc).join(', ')}), so no cell is assigned and nothing is recommended. Complete the missing part first.</div></div>`;
    else if(m.route==='in_band')body=`<div class="card"><div class="empty" id="solInBand"><b>Within the watch band.</b><br>Base cash stays between L ${money(I.L)} and H ${money(I.H)} on every day: no matrix cell and no solution request. Lowest ${money(m.need.min)} on ${fd(m.need.min_date)}, ${money(m.need.min-I.L)} above L.</div></div>`;
    else if(m.route==='invest'){const s=m.safe_cash;body=`<section class="dsec u34-sec" id="solSafe"><header class="dsh"><h3>Surplus · ${m.meta.matrix_case}</h3><p>SafeCash = MAX(0; MIN(Cash(t0) − Z; MIN over the three scenarios and days t0…τ of Cash − Z)) (MT03).</p></header>
      <div class="u34-tiles"><div class="card kpi"><div class="t">SafeCash</div><div class="v num" id="solSafeV">${money(s.value)}</div><div class="f">from ${fds(s.t0)} to ${fds(s.tau)} (within the horizon only)</div></div></div>
      <p>${m.allocation==='none_needed'?'<b>No allocation needed.</b> SafeCash is 0, so no investment is suggested that could cause a shortfall.':m.allocation==='no_product_data'?'No short-term investment product with term, withdrawal and fee data is in the catalogue: keep the amount as reserve.':'A short-term investment may be considered for the SafeCash amount only, subject to term and withdrawal checks.'}</p></section>`}
    else if(m.route==='reserve'){const h=m.hold;body=`<section class="dsec u34-sec" id="solReserve"><header class="dsh"><h3>Hold as reserve · ${m.meta.matrix_case}</h3><p>Positive cash does not remove the working-capital bottleneck; no loan or investment is proposed.</p></header>
      <p>L ${money(h.L)} · Z ${money(h.Z)} · H ${money(h.H)} · ${h.above_days} day(s) above H, largest excess ${money(h.max_above)}.</p>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Upcoming obligation</th><th>Day</th><th class="num">Amount</th></tr></thead><tbody>${h.obligations.map(o=>`<tr><td>${esc(o.kind)} · ${esc(o.partner)}</td><td>${fds(o.date)}</td><td class="num">${money(o.amount)}</td></tr>`).join('')}</tbody></table></div></section>`}
    else body=needHTML(m.need,I.L,I.Z,I.H)+packageHTML(m)+sourcesHTML(m)+excludedHTML(m)+tryHTML(m)+versionsHTML();
    p.innerHTML=`<div class="u34">${headHTML(m,I)}${body}${footHTML()}</div>`;
    bindSolutions(p,m);
  }
  function bindSolutions(p,m){
    p.onclick=e=>{
      const det=e.target.closest('[data-det]');if(det){openSourceDetail(m.sources.find(s=>s.id===det.dataset.det),m);return}
      const ex=e.target.closest('[data-ex]');if(ex){excludeDlg(m.sources.find(s=>s.id===ex.dataset.ex),m);return}
      const un=e.target.closest('[data-undo]');if(un){setExcluded(un.dataset.undo,null,m);return}
      if(e.target.closest('#solTryBtn')){const ids=$$('[data-try]',p).filter(x=>x.checked).map(x=>x.dataset.try);if(!ids.length){toast('Pick at least one internal source');return}tryInternal(m,ids);return}
      if(e.target.closest('#solPolicy')){openPolicy();return}
      if(e.target.closest('#solExport')){exportSolutions(m);return}
    };
  }
  // UC03.3: basis, net amount, fees, obligations and evidence of one source.
  function openSourceDetail(s,m){
    const checks=s.checks.map(c=>`<li><code>${c.id}</code> <span class="status ${c.status==='pass'?'green':c.status==='fail'?'red':'amber'}">${c.status==='pass'?'passed':c.status==='fail'?'fails':'evidence missing'}</span> ${esc(c.note||'')}${c.code?` <code>${c.code}</code>`:''}</li>`).join('');
    const units=s.units.slice(0,8).map(u=>`<li>${esc(u.label)} · net ${money(u.net)}${u.cost?` · cost ${mm(u.cost)}`:''}</li>`).join('');
    openModal(`<h3>${esc(s.id)} · ${esc(s.name)}</h3><p class="hint">Illustrative product (${esc(m.meta.catalogue_version)}); not an offer and not an agreement.</p>
      <dl class="u34-dl"><dt>Group</dt><dd>${s.group} · ${GROUP[s.group]}</dd><dt>Basis</dt><dd>${esc(s.basis)}</dd><dt>Net amount</dt><dd>${money(s.capacity)}</dd><dt>Cash on</dt><dd>${fd(s.fund_date)} (${s.dtf} day(s) to fund)</dd>
      <dt>Fees and cost</dt><dd>${mm(s.cost_full)} on the full amount${s.product.rate?` · ${pct(s.product.rate,1)} a year`:''}${s.product.fee_pct?` · fee ${pct(s.product.fee_pct,2)}`:''}${s.product.haircut?` · haircut ${pct(s.product.haircut,1)}`:''}</dd>
      <dt>Obligations</dt><dd>${s.obligations.length?s.obligations.slice(0,6).map(o=>`${money(o.amount)} ${esc(o.kind)} on ${fds(o.date)}`).join('; '):'none'}</dd>
      <dt>Evidence</dt><dd>${s.evidence.map(esc).join('; ')}</dd></dl>
      <h4>Checks</h4><ul class="u34-list">${checks}</ul>${units?`<h4>Objects</h4><ul class="u34-list">${units}</ul>`:''}
      ${s.reasons.length?`<p><b>Why it is not in the package:</b> ${s.reasons.map(reasonTxt).join('; ')}.</p>`:''}
      <div class="acts"><button class="btn sec" id="mClose" type="button">Close</button></div>`,mm_=>{$('#mClose',mm_).onclick=closeModal});
  }
  // UC03.4: "Don't use this source" with a reason → a new version rebuilt in the same order; hard checks are never overridden.
  function excludeDlg(s,m){
    if(s.status==='fails'){toast('Hard checks cannot be overridden');return}
    openModal(`<h3>Don’t use ${esc(s.id)}?</h3><p>The package is rebuilt from the remaining sources in the same group order and saved as a new version; the original package is kept.</p>
      <label class="settings-field">Reason (required)<textarea id="exReason" placeholder="For example: the customer refused early payment"></textarea></label><p class="ferr" id="exReasonE"></p>
      <div class="acts"><button class="btn sec" id="mCancel" type="button">Cancel</button><button class="btn primary" id="mOk" type="button">Save new version</button></div>`,mm_=>{
      $('#mCancel',mm_).onclick=closeModal;
      $('#mOk',mm_).onclick=()=>{const r=$('#exReason',mm_).value.trim();if(r.length<3){$('#exReasonE',mm_).textContent='Give a specific reason';return}closeModal();setExcluded(s.id,r,m)}});
  }
  function setExcluded(id,reason,m){
    const ok=API.call('source.exclude',{});if(!ok.ok){toast(ok.message);return}
    const st=SOL.get(),by=ROLE.label(),at=new Date().toISOString();
    if(reason)st.excluded[id]={reason,by,at};else delete st.excluded[id];
    SOL.set(st);const m2=matchNow();st.versions.push({action:reason?'Not used':'Used again',source_id:id,reason,by,at,match_run_id:m2.meta.match_run_id,from:m.meta.match_run_id});
    SOL.set(st);renderSolutions();toast(reason?`New version saved without ${id}`:`${id} is considered again`);
  }
  // UC03.5: the accountant proposes, the owner confirms; a confirmed change is a new catalogue version, published results keep theirs.
  const FIELDS={rate:['Interest a year (%)',100],fee_pct:['Fee or discount (%)',100],haircut:['Haircut (%)',100],adv:['Advance rate (%)',100],dtf:['Days to fund',1],hold:['Term (days)',1]};
  function openPolicy(){
    const st=SOL.get(),role=ROLE.get(),m=matchNow(),cat=UC0304.catalogueOf(table(),st.proposals),cs=UC0304.catalogueState(cat,(input()||{}).as_of||cat.meta.valid_from);
    const pend=st.proposals.filter(p=>p.status==='pending'),done=st.proposals.filter(p=>p.status!=='pending');
    const rerun=st.seen.filter(x=>x.catalogue_version!==cat.meta.version);
    const rows=cat.products.map(p=>`<tr><td><b>${p.id}</b> ${esc(p.name)} <small class="u34-ill">illustrative</small></td><td>${p.option}</td><td class="num">${pct(p.rate,1)}</td><td class="num">${pct(p.fee_pct,2)}</td><td class="num">${p.dtf}</td><td class="num">${p.hold}</td></tr>`).join('');
    openModal(`<h3>Policy and catalogue</h3>
      <p class="hint" id="roleNote">Signed in as <b>${esc(ROLE.label())}</b>. ${role==='owner'?'You confirm or return proposals.':'You can propose changes with their source; the Business Owner confirms them.'}</p>
      <p class="hint">Priority policy ${UC0304.VERSIONS.priority} and ${UC0304.VERSIONS.matrix} (owner-confirmed). Changing the group order of a cell needs an explicit policy proposal; it is never done by adjusting rank scores.</p>
      <p>Catalogue <b>${esc(cat.meta.version)}</b> · ${cat.meta.status} · valid ${fd(cat.meta.valid_from)} – <b id="catUntil">${fd(cat.meta.valid_until)}</b> · source ${esc(cat.meta.source)} · confirmed by ${esc(cat.meta.confirmed_by)}</p>
      ${cs.expired?`<div class="callout red" id="catWarn"><span>⚠</span><div>Expired: old fees are not used as current offers.</div></div>`:cs.warn?`<div class="callout amber" id="catWarn"><span>⚠</span><div>Expires in ${cs.days_left} days.</div></div>`:''}
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Product</th><th>Group</th><th class="num">Rate</th><th class="num">Fee</th><th class="num">Days to fund</th><th class="num">Term</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h4>${role==='accountant'?'Propose a change':'Propose a change (as owner)'}</h4>
      <div class="pol-form u34-form"><label>Product<select class="sel" id="ppProd"><option value="*">Catalogue validity</option>${cat.products.map(p=>`<option value="${p.id}">${p.id}</option>`).join('')}</select></label>
      <label>Field<select class="sel" id="ppField"></select></label><label>New value<input id="ppVal"></label><label>Source / evidence<input id="ppSrc" placeholder="Bank quote of 01/07/2026"></label><label>Effective from<input id="ppFrom" type="date"></label></div><p class="ferr" id="ppErr"></p>
      <button class="btn sec" id="ppAdd" type="button">Save proposal</button>
      <h4>Pending proposals</h4><ul class="u34-list" id="ppPending">${pend.map(p=>`<li>${esc(p.product_id)} · ${esc(p.field)} → <b>${esc(String(p.display))}</b> · ${esc(p.source)} · by ${esc(p.by)}${role==='owner'?` <button class="btn ok sm" data-conf="${p.id}" type="button">Confirm</button> <button class="btn sec sm" data-ret="${p.id}" type="button">Return</button>`:' · waiting for the owner'}</li>`).join('')||'<li>None</li>'}</ul>
      ${done.length?`<h4>History</h4><ul class="u34-list">${done.map(p=>`<li>${esc(p.product_id)} · ${esc(p.field)} → ${esc(String(p.display))} · ${p.status} by ${esc(p.confirmed_by||p.returned_by||'')}</li>`).join('')}</ul>`:''}
      <h4>Packages to rerun</h4><ul class="u34-list" id="ppRerun">${rerun.map(x=>`<li>${esc(x.match_run_id)} (${esc(x.cell||'—')}) used ${esc(x.catalogue_version)}</li>`).join('')||'<li>None: every package uses the current catalogue</li>'}</ul>
      <div class="acts"><button class="btn sec" id="mClose" type="button">Close</button></div>`,md=>{
      const fsel=$('#ppField',md),psel=$('#ppProd',md),fill=()=>{fsel.innerHTML=psel.value==='*'?'<option value="valid_until">Valid until</option>':Object.entries(FIELDS).map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('')};fill();psel.onchange=fill;
      $('#mClose',md).onclick=closeModal;
      $('#ppAdd',md).onclick=()=>{const f=fsel.value,raw=$('#ppVal',md).value.trim(),src=$('#ppSrc',md).value.trim(),err=$('#ppErr',md);let value;
        if(f==='valid_until'){if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)){err.textContent='Enter the date as YYYY-MM-DD';return}value=raw}
        else{const n=+String(raw).replace(',','.');if(!isFinite(n)||n<0){err.textContent='Enter a number of 0 or more';return}
          if(FIELDS[f][1]===1&&!Number.isInteger(n)){err.textContent='Days must be a whole number';return}if(FIELDS[f][1]===100&&n>=100){err.textContent='Percent must be below 100';return}value=FIELDS[f][1]===100?n/100:n}
        if(src.length<3){err.textContent='Give the source of the change';return}
        if(st.proposals.some(p=>p.status==='pending'&&p.product_id===psel.value&&p.field===f)){err.textContent='A pending proposal for this field already exists';return}
        const r=API.propose(`${psel.value}.${f}`,()=>{st.proposals.push({id:'PP-'+(st.proposals.length+1),product_id:psel.value,field:f,value,display:raw,source:src,effective:$('#ppFrom',md).value||null,by:ROLE.label(),status:'pending',at:new Date().toISOString()});SOL.set(st)});
        if(!r.ok){err.textContent=r.message;return}
        closeModal();openPolicy();toast(ROLE.get()==='owner'?'Proposal saved: confirm it to apply':'Proposal saved: the Business Owner confirms it')};
      // Confirmation is checked by the API at the time of writing, not by the visibility of the button.
      $$('[data-conf]',md).forEach(b=>b.onclick=()=>{const p=st.proposals.find(x=>x.id===b.dataset.conf);
        const r=API.confirmPolicy(`${p.product_id}.${p.field}`,()=>{p.status='confirmed';p.confirmed_by=ROLE.label();p.confirmed_at=new Date().toISOString();SOL.set(st)});
        if(!r.ok){toast(r.message);return}closeModal();openPolicy();if(S.detail==='sol')renderSolutions();toast('New catalogue version saved')});
      $$('[data-ret]',md).forEach(b=>b.onclick=()=>{const p=st.proposals.find(x=>x.id===b.dataset.ret);
        const r=API.confirmPolicy(`${p.product_id}.${p.field}:return`,()=>{p.status='returned';p.returned_by=ROLE.label();SOL.set(st)});if(!r.ok){toast(r.message);return}closeModal();openPolicy()});
    });
  }
  function exportSolutions(m){
    const out={note:OUTSIDE,meta:m.meta,need:{floor_peak:m.need.floor_peak,target_peak:m.need.target_peak,floor_days:m.need.floor_days,episodes:m.need.episodes},route:m.route,groups:m.groups||null,
      package:m.package?{status:m.package.status,draws:m.package.draws,events:m.package.events,remaining:{floor_peak:m.package.remaining.floor_peak,floor_days:m.package.remaining.floor_days,target_peak:m.package.remaining.target_peak,target_days:m.package.remaining.target_days}}:null,
      sources:(m.sources||[]).map(s=>({id:s.id,group:s.group,status:s.status,in_package:s.in_package,reasons:s.reasons,net:s.capacity,fund_date:s.fund_date})),safe_cash:m.safe_cash||null,hold:m.hold||null};
    dlFile(`solutions-${S.firm}-${m.meta.match_run_id}.json`,JSON.stringify(out,null,2),'application/json');
  }
  function tryInternal(m,ids){
    const pf=UC0304.prefill(m,ids),st=sims();
    st.rows=pf.changes.map(c=>({...c,on:true}));st.prefill=pf;st.errors=[];
    if(pf.rejected.length)toast('Borrowing and investment are not simulated');
    openDetail('whatif');
  }

  /* ---------- What-if view (UC04.1 – UC04.5) ---------- */
  function lists(I){
    const custs=[...new Set(I.events.base.filter(e=>e.src==='sales_invoice'&&e.t!=null).map(e=>e.partner))].sort();
    const sup=new Map();I.events.base.filter(e=>e.src==='purchase_invoice'&&e.t!=null).forEach(e=>sup.set(e.partner,sup.get(e.partner)||!!e.essential));
    const idOf=(m,n)=>Object.keys(m||{}).find(k=>m[k]===n)||null;
    return {custs:custs.map(n=>({name:n,id:idOf(I.ids.customers,n)})),sups:[...sup.keys()].sort().map(n=>({name:n,essential:sup.get(n),id:idOf(I.ids.suppliers,n)})),
      lots:I.lots.filter(l=>l.owner==='own'&&l.lot_id)};
  }
  function defaults(I){
    const D=(DATA.uc04||{})[S.firm],L=lists(I);
    if(D)return [{lever:'ar',on:true,customer:D.customer,share:D.ar_share,mode:'shift_days',days:-D.early_days,date:'',discount:D.discount},
      {lever:'ap',on:true,supplier:D.supplier,share:D.ap_share,days:D.extend_days,fee:D.ap_fee,consent_assumed:!!D.allow_essential},
      {lever:'inv',on:true,lot_id:D.lot_id,share:D.sale_share,qty:null,qmode:'share',basis:'recovery',recovery:D.recovery,unit_price:null,lag_days:D.sale_lag,selling_cost:D.sale_cost,sale_confirmed:!!D.sale_confirmed}];
    return [{lever:'ar',on:false,customer:(L.custs[0]||{}).name,share:.5,mode:'shift_days',days:-7,date:'',discount:0},{lever:'ap',on:false,supplier:(L.sups[0]||{}).name,share:.5,days:14,fee:0,consent_assumed:false},
      {lever:'inv',on:false,lot_id:(L.lots[0]||{}).lot_id,share:.5,qty:null,qmode:'share',basis:'recovery',recovery:.8,unit_price:null,lag_days:14,selling_cost:0,sale_confirmed:false}];
  }
  const P100=v=>v==null||v===''?'':String(Math.round(v*1e4)/100).replace('.',',');
  const fromP=v=>{const s=String(v).trim().replace(',','.');return s===''?NaN:+s/100};
  const numIn=v=>{const s=String(v).trim().replace(',','.');return s===''?NaN:+s};
  function errAt(i,f){const e=sims().errors.find(x=>x.index===i&&x.field===f);return `<p class="ferr" data-err="${i}.${f}">${e?esc(e.msg):''}</p>`}
  function rowHTML(r,i,L){
    const on=`<label class="chk2 u34-on"><input type="checkbox" data-f="on" ${r.on?'checked':''}> Include</label>`;
    if(r.lever==='ar')return `<div class="u34-row" data-i="${i}">${on}
      <label>Customer<select class="sel" data-f="customer">${L.custs.map(c=>`<option value="${esc(c.name)}" ${c.name===r.customer?'selected':''}>${esc(c.name)}${c.id?' · '+c.id:''}</option>`).join('')}</select></label>${errAt(i,'customer')}
      ${r.invoice_ids?`<p class="hint">Limited to ${r.invoice_ids.length} invoice(s) from ${esc(r.from||'UC03')}.</p>`:''}
      <label>Share of each receipt (%)<input data-f="share" inputmode="decimal" value="${P100(r.share)}"></label>${errAt(i,'share')}
      <div class="u34-radio" role="radiogroup" aria-label="Date rule"><label><input type="radio" name="arm${i}" data-f="mode" value="shift_days" ${r.mode!=='absolute_date'?'checked':''}> Shift days</label><label><input type="radio" name="arm${i}" data-f="mode" value="absolute_date" ${r.mode==='absolute_date'?'checked':''}> Fixed date</label></div>
      ${r.mode==='absolute_date'?`<label>Committed date<input type="date" data-f="date" value="${esc(r.date||'')}"></label>${errAt(i,'date')}`:`<label>Days (negative = earlier, positive = later)<input data-f="days" inputmode="numeric" value="${r.days??''}"></label>${errAt(i,'days')}`}
      <label>Discount on the part collected early (%)<input data-f="discount" inputmode="decimal" value="${P100(r.discount)}"></label>${errAt(i,'discount')}</div>`;
    if(r.lever==='ap'){const s=L.sups.find(x=>x.name===r.supplier);return `<div class="u34-row" data-i="${i}">${on}
      <label>Supplier<select class="sel" data-f="supplier">${L.sups.map(c=>`<option value="${esc(c.name)}" ${c.name===r.supplier?'selected':''}>${esc(c.name)}${c.id?' · '+c.id:''}${c.essential?' · essential':''}</option>`).join('')}</select></label>${errAt(i,'supplier')}
      ${r.event_ids?`<p class="hint">Limited to ${r.event_ids.length} payment(s) from ${esc(r.from||'UC03')}.</p>`:''}
      <label>Share of each payment (%)<input data-f="share" inputmode="decimal" value="${P100(r.share)}"></label>${errAt(i,'share')}
      <label>Extra days<input data-f="days" inputmode="numeric" value="${r.days??''}"></label>${errAt(i,'days')}
      <label>Extension fee (%)<input data-f="fee" inputmode="decimal" value="${P100(r.fee)}"></label>${errAt(i,'fee')}
      <label class="chk2"><input type="checkbox" data-f="consent_assumed" ${r.consent_assumed?'checked':''}> Assumed supplier consent${s&&s.essential?' (essential supplier)':''}</label>${errAt(i,'consent_assumed')}</div>`}
    const lot=L.lots.find(x=>x.lot_id===r.lot_id);
    return `<div class="u34-row" data-i="${i}">${on}
      <label>Owned lot<select class="sel" data-f="lot_id">${L.lots.map(l=>`<option value="${esc(l.lot_id)}" ${l.lot_id===r.lot_id?'selected':''}>${esc(l.lot_id)} · ${esc(l.name)} · ${money(l.value)}${l.pledged==='yes'?' · pledged':''}</option>`).join('')}</select></label>${errAt(i,'lot_id')}
      ${lot?`<p class="hint">Available ${nf(lot.qty,0)} units at ${nf(lot.unit_cost,0)} VND book cost.</p>`:''}
      <div class="u34-radio" role="radiogroup" aria-label="Amount sold"><label><input type="radio" name="iq${i}" data-f="qmode" value="share" ${r.qmode!=='qty'?'checked':''}> Share</label><label><input type="radio" name="iq${i}" data-f="qmode" value="qty" ${r.qmode==='qty'?'checked':''}> Quantity</label></div>
      ${r.qmode==='qty'?`<label>Quantity sold<input data-f="qty" inputmode="numeric" value="${r.qty??''}"></label>${errAt(i,'qty')}`:`<label>Share sold (%)<input data-f="share" inputmode="decimal" value="${P100(r.share)}"></label>${errAt(i,'share')}`}
      <div class="u34-radio" role="radiogroup" aria-label="Price basis"><label><input type="radio" name="ib${i}" data-f="basis" value="recovery" ${r.basis!=='unit_price'?'checked':''}> Recovery of book value</label><label><input type="radio" name="ib${i}" data-f="basis" value="unit_price" ${r.basis==='unit_price'?'checked':''}> Unit price</label></div>
      ${r.basis==='unit_price'?`<label>Unit price (VND)<input data-f="unit_price" inputmode="numeric" value="${r.unit_price??''}"></label>${errAt(i,'unit_price')}`:`<label>Recovery (% of book)<input data-f="recovery" inputmode="decimal" value="${P100(r.recovery)}"></label>${errAt(i,'recovery')}`}${errAt(i,'basis')}
      <label>Cash in after (days from the first forecast day)<input data-f="lag_days" inputmode="numeric" value="${r.lag_days??''}"></label>${errAt(i,'lag_days')}
      <label>Selling cost (% of sale)<input data-f="selling_cost" inputmode="decimal" value="${P100(r.selling_cost)}"></label>${errAt(i,'selling_cost')}
      <label class="chk2"><input type="checkbox" data-f="sale_confirmed" ${r.sale_confirmed?'checked':''}> Sale assumption confirmed (buyer, price and date)</label>${errAt(i,'sale_confirmed')}</div>`;
  }
  const LEVERS=[['ar','Early or late collection (AR)','U401: move part of a customer’s receipts; the rest of each invoice keeps its date'],['ap','Supplier extension (AP)','U402: pay part later with a fee; the payment stays due, also after the horizon'],['inv','Inventory sale (INV)','U403–U404: one price basis; owned lots only; available quantity respected']];
  function metricRows(r){
    const b=r.before,a=r.after,row=(t,x,y,f,good)=>{const d=y-x;return `<tr><td>${t}</td><td class="num">${f(x)}</td><td class="num"><b>${f(y)}</b></td><td class="num ${Math.abs(d)<1e-6?'':((good==='up'?d>0:d<0)?'pos':'neg')}">${Math.abs(d)<1e-6?'—':(d>0?'+':'−')+f(Math.abs(d))}</td></tr>`};
    return row('Lowest cash',b.min,a.min,mm,'up')+row('FloorGap peak (below L)',b.floor_peak,a.floor_peak,mm,'down')+row('TargetGap peak (to Z)',b.target_peak,a.target_peak,mm,'down')
      +row('Days below L',b.floor_days,a.floor_days,v=>nf(v,0),'down')+row('Negative days',b.negative_days,a.negative_days,v=>nf(v,0),'down');
  }
  function scenarioHTML(run,k,main){
    const r=run.results[k],I=input();
    const worse=r.worse.slice(0,8).map(w=>`${fds(w.d)} ${money(w.amount)}`).join(', ');
    return `<div class="card u34-res ${main?'main':''}" id="wi-${k}"><div class="card-head"><div><h3>${SC_NAME[k]}${main?'':' · sensitivity'}</h3><p>${main?'Same change set on the Base path':'Same change set; read as sensitivity, not as the result'}</p></div><span class="status ${CONCL_CLS[r.conclusion]}" data-concl="${k}">${CONCL[r.conclusion]}</span></div>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Metric</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead><tbody>${metricRows(r)}</tbody></table></div>
      <p class="hint">Lowest after on ${fd(r.after.min_date)} ${flagHTML(r.after.min,I.L,I.H)} · WorseDays ${r.worse_days}${worse?` (${worse}${r.worse.length>8?', …':''})`:''} · new days below L ${r.new_gap_days}</p>
      ${main?`<div class="chartbox">${chartSVG(r.path_before,r.path_after,I.L,I.Z,I.H)}</div><div class="legend"><span><i class="ln u34-before-sw"></i>Before</span><span><i class="ln u34-after-sw"></i>After</span><span><i class="ds"></i>L / Z / H</span></div>`:''}
      ${r.tail_events.length?`<p class="hint" data-tail="${k}"><b>After the horizon (${fd(I.end)}):</b> ${r.tail_events.map(t=>`${t.amount<0?'−':'+'}${money(Math.abs(t.amount))} ${esc(t.type)} on ${fds(t.date)}`).join('; ')}. These stay due; they are not savings.</p>`:''}</div>`;
  }
  function resultHTML(run){
    const b=run.results.base,c=b.costs,I=input();
    const scope={direct:'Direct run',full_internal:'Full internal part of the UC03 package',subset:'Subset of the UC03 package',outside_package:'UC03 sources outside the package'}[run.scope]||run.scope;
    return `<div class="u34-run" id="wiResult"><div class="card"><div class="card-head"><div><h3>Result · ${esc(run.sim_run_id)}</h3><p>${esc(scope)}${run.parent_id?` · follows ${esc(run.parent_id)}`:''}${run.source_uc03_run?` · from ${esc(run.source_uc03_run)}`:''} · mode simulation</p></div><span class="status ${CONCL_CLS[run.conclusion]}" id="wiConcl">${CONCL[run.conclusion]}</span></div>
      ${run.scope!=='direct'?`<p class="u34-subset" id="wiScope"><b>${run.scope==='subset'?'Subset':'Scope'}:</b> only ${run.option_ids.join(', ')} simulated.${run.not_simulated.length?` Not simulated: ${run.not_simulated.map(s=>s.id).join(', ')} (borrowing or investment).`:''}</p>`:''}
      <p>${run.conditions.map(esc).join(' · ')}</p>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Cost (Base)</th><th class="num">VND</th></tr></thead><tbody>
      <tr><td>Early-payment discount</td><td class="num" id="wiCostDisc">${mm(c.discount)}</td></tr><tr><td>Extension fee</td><td class="num" id="wiCostFee">${nf(c.fee/1e6,2)}M</td></tr><tr><td>Selling cost</td><td class="num" id="wiCostSale">${nf(c.sale/1e6,2)}M</td></tr>
      <tr><td><b>Cash cost</b></td><td class="num"><b>${nf(c.cash/1e6,2)}M</b></td></tr><tr><td>Book shortfall on the stock sold (not a cash outflow)</td><td class="num" id="wiBook">${mm(c.book_shortfall)}</td></tr></tbody></table></div>
      <p class="hint" id="wiMatrix">Published cell ${esc(run.source_matrix_case||'—')} and ${esc(run.W)} are unchanged (historical CCC ${run.historical?nf(run.historical.ccc,1):'—'} days, DSO/DIO/DPO unchanged). On Base after the change: ${esc(run.th_after)}, simulated cell ${esc(run.simulated_matrix_case||'none')} (kept apart from the published cell).${b.equivalent_dso_days!=null?` Equivalent DSO days (reference only): ${nf(b.equivalent_dso_days,2)}.`:''}</p></div>
      ${scenarioHTML(run,'base',true)}<details class="u34-sens" id="wiSens"><summary>Conservative and Positive (sensitivity)</summary>${scenarioHTML(run,'conservative')}${scenarioHTML(run,'positive')}</details></div>`;
  }
  function historyHTML(){
    const st=sims();if(!st.runs.length)return '';
    return `<section class="dsec u34-sec" id="wiHistory"><header class="dsh"><h3>Runs</h3><p>Each run is versioned; a changed assumption creates a new run linked to the previous one.</p></header>
      <ul class="u34-list">${st.runs.map(r=>`<li><label class="chk2"><input type="checkbox" data-cmp="${r.sim_run_id}" ${st.cmp.has(r.sim_run_id)?'checked':''}> <b>${esc(r.sim_run_id)}</b> ${esc(r.label||'')} · ${CONCL[r.conclusion]}${r.parent_id?` · after ${esc(r.parent_id)}`:''}${r.meta.source_uc02_run!==(input()||{}).source_uc02_run?' · <span class="status gray">historical base</span>':''}</label> <button class="btn sec sm" data-open="${r.sim_run_id}" type="button">Open</button></li>`).join('')}</ul>
      <button class="btn sec sm" id="wiCmp" type="button">Compare selected</button><div id="wiCmpBox"></div></section>`;
  }
  function renderWhatIf(){
    const p=$('#pane-whatif');if(!p)return;const I=input();
    if(!I){p.innerHTML='<div class="card"><div class="empty"><b>Company data is not ready.</b></div></div>';return}
    const st=sims();if(!st.rows)st.rows=defaults(I);const L=lists(I),cur=st.runs.find(r=>r.sim_run_id===st.cur);
    const pf=st.prefill;
    p.innerHTML=`<div class="u34"><div class="card u34-head"><p class="u34-pol"><b>Three levers, applied to Base, Conservative and Positive.</b> W, CCC and the historical DSO/DIO/DPO are never changed; results are simulations, not agreements.</p>
      ${pf?`<p class="u34-subset" id="wiPrefill">Pre-filled from ${esc(pf.source_match_run)} (${esc(pf.option_ids.join(', '))}) · ${pf.scope==='subset'?'subset of the package':pf.scope==='full_internal'?'full internal part':'sources outside the package'}${pf.not_simulated.length?` · not simulated: ${pf.not_simulated.map(s=>esc(s.id)).join(', ')}`:''}. <button class="linkbtn" id="wiClearPf" type="button">Clear</button></p>`:''}
      <div class="presets" id="wiPresets"><span class="legend">Examples:</span>${(typeof SC!=='undefined'?SC:[]).filter(s=>!s.firm||s.firm===S.firm).map(s=>`<button type="button" data-sc="${s.id}" title="${esc(s.name)}">${esc(s.id.split('-')[1])} · ${esc(s.name.length>34?s.name.slice(0,33)+'…':s.name)}</button>`).join('')}</div></div>
      <div class="u34-levers">${LEVERS.map(([k,t,sub])=>`<section class="dsec u34-sec u34-lever" data-lever="${k}"><header class="dsh"><h3>${t}</h3><p>${sub}</p></header>${st.rows.map((r,i)=>r.lever===k?rowHTML(r,i,L):'').join('')}</section>`).join('')}</div>
      <div class="row u34-runbar"><button class="btn primary" id="wiRun" type="button">Run what-if</button><button class="btn sec" id="wiReset" type="button">Reset</button>${cur?'<button class="btn sec" id="wiExport" type="button">⤓ Export results</button>':''}<span class="hint">${OUTSIDE}</span></div>
      ${st.errors.length?`<div class="ferr form" id="wiErrors">Fix the highlighted fields; the other inputs are kept.</div>`:''}
      ${cur?resultHTML(cur):''}${historyHTML()}</div>`;
    bindWhatIf(p);
  }
  function readRows(p){
    const st=sims();
    $$('.u34-row',p).forEach(el=>{const r=st.rows[+el.dataset.i];
      $$('[data-f]',el).forEach(x=>{const f=x.dataset.f;
        if(x.type==='checkbox')r[f]=x.checked;
        else if(x.type==='radio'){if(x.checked)r[f]=x.value}
        else if(['share','discount','fee','recovery','selling_cost'].includes(f))r[f]=fromP(x.value);
        else if(['days','qty','unit_price','lag_days'].includes(f))r[f]=numIn(x.value);
        else r[f]=x.value})});
  }
  const toChange=r=>{const c={...r};delete c.on;delete c.qmode;if(r.lever==='inv'){if(r.qmode==='qty'){c.share=null}else c.qty=null}return c};
  function run(opts={}){
    const I=input(),st=sims(),changes=st.rows.filter(r=>r.on).map(toChange);
    if(!changes.length){st.errors=[];toast('Include at least one lever');return null}
    const pf=st.prefill,meta={seq:++st.seq,parent_id:st.cur||null,created_at:new Date().toISOString(),label:opts.label||describe(changes),
      source_uc03_run:pf?pf.source_match_run:null,scope:pf?pf.scope:'direct',option_ids:pf?pf.option_ids:[],not_simulated:pf?pf.not_simulated:[]};
    const res=UC0304.simulate(I,changes,meta);
    // Field errors map back to the full row list (rows that are switched off are not validated).
    if(res.status==='rejected'){const on=st.rows.map((r,i)=>r.on?i:-1).filter(i=>i>=0);st.errors=res.errors.map(e=>({...e,index:on[e.index]}));return res}
    st.errors=[];st.runs.unshift(res);st.cur=res.sim_run_id;st.runs=st.runs.slice(0,20);
    if(typeof addLog==='function')addLog({tool:'simulate_scenario',args:{firm_id:S.firm,changes},status:'ok',summary:`${res.sim_run_id}: ${res.conclusion}`});
    return res;
  }
  function describe(ch){
    return ch.map(c=>c.lever==='ar'?`${short(c.customer)} ${c.mode==='absolute_date'?'on '+fds(c.date):(c.days<0?-c.days+' days early':c.days+' days late')}`:c.lever==='ap'?`${short(c.supplier)} +${c.days} days`:`sell ${c.lot_id}`).join(' + ');
  }
  const short=s=>String(s||'').replace(/^(Large )?FOB Buyer /,'').replace(/ Fabric Distributor$/,'').slice(0,26);
  function bindWhatIf(p){
    p.onchange=e=>{if(e.target.closest('.u34-row')){readRows(p);if(['mode','qmode','basis','lot_id','supplier'].includes(e.target.dataset.f))renderWhatIf()}};
    p.onclick=e=>{const st=sims();
      if(e.target.closest('#wiRun')){readRows(p);const r=run();renderWhatIf();if(r&&r.status==='ok'){const el=$('#wiResult',p);el&&el.scrollIntoView({block:'start',behavior:'auto'})}else if(r){const f=$('.ferr:not(:empty)',p);f&&f.scrollIntoView({block:'center'})}return}
      if(e.target.closest('#wiReset')){st.rows=defaults(input());st.prefill=null;st.errors=[];renderWhatIf();return}
      if(e.target.closest('#wiClearPf')){st.prefill=null;st.rows=defaults(input());renderWhatIf();return}
      if(e.target.closest('#wiExport')){exportRun(st.runs.find(r=>r.sim_run_id===st.cur));return}
      const sc=e.target.closest('[data-sc]');if(sc){loadPreset(SC.find(x=>x.id===sc.dataset.sc));run({label:SC.find(x=>x.id===sc.dataset.sc).name});renderWhatIf();return}
      const op=e.target.closest('[data-open]');if(op){st.cur=op.dataset.open;renderWhatIf();return}
      const cb=e.target.closest('[data-cmp]');if(cb){cb.checked?st.cmp.add(cb.dataset.cmp):st.cmp.delete(cb.dataset.cmp);return}
      if(e.target.closest('#wiCmp')){$('#wiCmpBox',p).innerHTML=compareHTML(st.runs.filter(r=>st.cmp.has(r.sim_run_id)));return}
    };
  }
  function loadPreset(sc){
    const I=input(),st=sims(),d=defaults(I),ch=sc.changes||{};st.prefill=null;st.errors=[];
    st.rows=d.map(r=>{const c=ch[r.lever];if(!c)return {...r,on:false};
      if(r.lever==='ar')return {...r,on:true,customer:(I.ids.customers||{})[c.customer_id]||r.customer,share:c.share,mode:c.mode,days:c.days,date:c.date||'',discount:c.discount};
      if(r.lever==='ap')return {...r,on:true,supplier:(I.ids.suppliers||{})[c.supplier_id]||r.supplier,share:c.share,days:c.days,fee:c.fee,consent_assumed:!!c.consent_assumed};
      return {...r,on:true,lot_id:c.lot_id,share:c.share,qmode:'share',basis:c.basis,recovery:c.recovery,lag_days:c.lag_days,selling_cost:c.selling_cost,sale_confirmed:!!c.sale_confirmed}});
  }
  // UC04.4: same base, policy and scenario set only; no "cheapest that covers" star.
  function compareHTML(runs){
    const c=UC0304.compare(runs);
    if(!c.ok)return `<div class="callout red" id="wiCmpRefused"><span>⛔</span><div>${esc(c.message||c.reason)}</div></div>`;
    const col=(f)=>c.rows.map(r=>`<td class="num">${f(r)}</td>`).join('');
    return `<div class="table-wrap" id="wiCmpTable"><table class="dtable"><thead><tr><th>Base</th>${c.rows.map(r=>`<th>${esc(r.sim_run_id)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Changes</td>${c.rows.map(r=>`<td>${esc(r.label||'')}</td>`).join('')}</tr><tr><td>Lowest cash</td>${col(r=>money(r.min))}</tr><tr><td>FloorGap peak</td>${col(r=>mm(r.floor_peak))}</tr><tr><td>TargetGap peak</td>${col(r=>mm(r.target_peak))}</tr>
      <tr><td>Days below L</td>${col(r=>r.gap_days)}</tr><tr><td>WorseDays</td>${col(r=>r.worse_days)}</tr><tr><td>After the horizon</td>${col(r=>money(r.tail))}</tr><tr><td>Cash cost</td>${col(r=>nf(r.cost/1e6,2)+'M')}</tr>
      <tr><td>Conclusion</td>${c.rows.map(r=>`<td>${CONCL[r.conclusion]}</td>`).join('')}</tr></tbody></table></div><p class="hint">Trade-offs only; the decision stays with the owner, outside the app.</p>`;
  }
  function exportRun(r){
    if(!r)return;const b=r.results.base;
    const csv=['date,base_before,base_after,conservative_after,positive_after',...b.path_before.map((x,i)=>[x.d,Math.round(x.close),Math.round(b.path_after[i].close),Math.round(r.results.conservative.path_after[i].close),Math.round(r.results.positive.path_after[i].close)].join(','))].join('\n');
    dlFile(`whatif-${r.sim_run_id}.csv`,csv);
    const slim={note:OUTSIDE,sim_run_id:r.sim_run_id,parent_id:r.parent_id,meta:r.meta,scope:r.scope,changes:r.changes,conclusion:r.conclusion,conditions:r.conditions,
      results:Object.fromEntries(Object.entries(r.results).map(([k,x])=>[k,{before:{...x.before,daily:undefined,episodes:undefined},after:{...x.after,daily:undefined,episodes:undefined},worse_days:x.worse_days,tail_events:x.tail_events,costs:x.costs,conclusion:x.conclusion,th_after:x.th_after,simulated_matrix_case:x.simulated_matrix_case}]))};
    dlFile(`whatif-${r.sim_run_id}.json`,JSON.stringify(slim,null,2),'application/json');
  }

  /* ---------- Chat (UC03.2, UC04.3, UC04.6) ---------- */
  function registry(){const f={};return {f,add:(id,v,d)=>{f[id]={value:v,display:String(d)};return String(d)}}}
  function checked(ans,html){const v=NARR.verifyAnswer({html,facts:ans.f,entities:ans.entities||[],kind:'uc0304'});return v.ok?html:`<p>${esc(ans.fallback)}</p>`}
  function solutionsAnswer(){
    const I=input(),m=matchNow();if(!I||!m)return {html:'<p>Company data is not ready yet.</p>'};
    const R=registry(),A=R.add,ent=[I.firm_name,...(m.sources||[]).map(s=>s.name)];let html;
    const lead=`<p>${A('w',I.W,I.W)} and ${A('th',I.TH,I.TH)} on Base give cell <b>${A('cell',I.cell||'none',I.cell||'none')}</b> (${m.meta.matrix_version}, ${m.meta.priority_policy_version}).</p>`;
    if(m.route==='shortfall'){const n=m.need,P=m.package,first=A('need_d',n.first_floor_day,fd(n.first_floor_day)),fl=A('floor',n.floor_peak,mm(n.floor_peak)),tg=A('target',n.target_peak,mm(n.target_peak));
      const remZ=A('rem_z',P.remaining.target_peak,mm(P.remaining.target_peak)),remL=A('rem_l',P.remaining.floor_peak,mm(P.remaining.floor_peak));
      const slow=m.excluded.fails.filter(s=>s.too_slow&&s.in_policy&&s.status!=='fails').map(s=>A('slow_'+s.id,s.id,s.id)),strat=m.excluded.fails.filter(s=>s.reasons.includes('STRATEGIC_OR_CRITICAL')).map(s=>A('strat_'+s.id,s.id,s.id));
      if(I.cell==='M5')html=`<p>The company has a severe bottleneck and Base is short ${fl} below L (${tg} to Z) from ${first}. The system considers, in turn, receivables, stock that can be sold and payments that can be negotiated later. After the eligible sources, ${remZ} is still not covered; borrowing is considered only for this part if it meets the conditions and arrives in time. Collections or deferrals not yet confirmed by the partner remain assumptions.</p>`;
      else html=`<p>Base is short ${fl} below L (${tg} to the target Z) from ${first}. Policy order: ${m.groups.map(g=>A('g_'+g,g,g)+' '+GROUP[g]).join(' → ')}.</p><p>${P.status==='none'?'There is no timely package: no eligible source can bring cash by the need date.':`The package brings ${A('pkg',P.net,mm(P.net))} net.`} Remaining under Z: ${remZ}; under L: ${remL}.</p>`;
      html+=(slow.length?`<p>Too slow: ${slow.join(', ')}. </p>`:'')+(strat.length?`<p>Strategic customer or essential supplier: ${strat.join(', ')}.</p>`:'');
      if(I.cell==='M3'&&m.excluded.outside_policy.some(s=>s.group==='O2'))html+='<p>Borrowing is not in the policy of this cell, so it is not added; the remaining gap is reported instead.</p>';
    }else if(m.route==='invest')html=`<p>SafeCash is ${A('safe',m.safe_cash.value,mm(m.safe_cash.value))}${m.safe_cash.value<=TOL1?': no allocation needed.':'.'}</p>`;
    else if(m.route==='reserve')html='<p>Hold the surplus as reserve: no loan or investment is proposed while the bottleneck remains.</p>';
    else if(m.route==='in_band')html='<p>Base stays within the watch band: no matrix cell and no solution request.</p>';
    else html='<p>One axis is not released, so no cell is assigned.</p>';
    html=lead+html+`<p class="hint">${OUTSIDE}</p>`;
    return {html:checked({f:R.f,entities:ent,fallback:`Cell ${I.cell||'none'}: see the Solutions view.`},html),facts:R.f,match:m};
  }
  const TOL1=1;
  function whatIfAnswer(run){
    const R=registry(),A=R.add,b=run.results.base,I=input(),ent=[I.firm_name,...run.changes.map(c=>c.customer||c.supplier||c.lot_id)];
    const html=`<p>${A('label',run.label,esc(run.label||run.sim_run_id))} (${A('id',run.sim_run_id,run.sim_run_id)}): on Base the lowest cash moves from ${A('min0',b.before.min,mm(b.before.min))} to ${A('min1',b.after.min,mm(b.after.min))} on ${A('mind',b.after.min_date,fd(b.after.min_date))}; days below L ${A('g0',b.before.floor_days,b.before.floor_days)} → ${A('g1',b.after.floor_days,b.after.floor_days)}; gap to Z ${A('t0',b.before.target_peak,mm(b.before.target_peak))} → ${A('t1',b.after.target_peak,mm(b.after.target_peak))}.</p>
      <p>Cash cost ${A('cost',b.costs.cash,mm(b.costs.cash))}; book shortfall ${A('book',b.costs.book_shortfall,mm(b.costs.book_shortfall))} (not cash). WorseDays ${A('worse',b.worse_days,b.worse_days)}.${b.tail_obligations>0?` ${A('tail',b.tail_obligations,mm(b.tail_obligations))} stays due after the horizon.`:''} Conclusion on Base: <b>${CONCL[run.conclusion]}</b>.</p>
      <p>Sensitivity: Conservative ${CONCL[run.results.conservative.conclusion]}, Positive ${CONCL[run.results.positive.conclusion]}. ${esc(run.conditions.join('; '))}.</p>`;
    return checked({f:R.f,entities:ent,fallback:`Run ${run.sim_run_id}: ${CONCL[run.conclusion]}. Open What-if for the figures.`},html);
  }
  const REFUSE={
    reorder:'The order of the source groups is the owner-confirmed policy for this cell; the chat does not change it. To change it, the owner records an explicit policy proposal under Policy and catalogue; the current policy stays in force until then.',
    e30:'Interest savings from a lower CCC are not computed: that needs a debt model (balances, rates, prepayment terms and fees) that this version does not simulate. The what-if shows cash, gaps, costs and obligations only.',
    exec:'The app does not send, sign or execute anything. A follow-up can be prepared as a draft in the Approval queue; the Business Owner decides there, and an approval is recorded as a simulated action only. Nothing is sent outside the application.',
    override:'Hard checks (ownership, pledge, strategic or essential counterparty, dispute, catalogue validity) cannot be overridden. Add the missing evidence or correct the data through the data screens instead.'};
  // Chat what-if: the three levers only; a new assumption always creates a new run linked to the previous one (UC04.3 A1).
  function parseWhatIf(text){
    const I=input();if(!I)return null;const low=text.toLowerCase(),L=lists(I);
    const days=(low.match(/(\d+)\s*(?:days?|d\b)/)||[])[1],pc=(low.match(/(\d+(?:[.,]\d+)?)\s*%/)||[])[1];
    const half=/\bhalf\b/.test(low)?.5:/quarter/.test(low)?.25:null;
    const ar=/(collect|pay|pays|paid)[^.?!]*(early|earlier|late|later)|early collection|bring forward/.test(low)&&!/(we|us) pay/.test(low);
    const ap=/(extend|defer|postpone|later|stretch)[^.?!]*(supplier|beta|pay(ment)?s?\b)|(supplier|beta)[^.?!]*(later|extend)|we pay[^.?!]*later/.test(low);
    const inv=/\bsell\b|stock sale|inventory sale|clear (the )?stock/.test(low);
    if(!ar&&!ap&&!inv)return null;
    const pickName=(arr)=>{let best=null;arr.forEach(n=>{const k=(n.name.match(/\b(K\d+|SUP\d+|Beta|Gamma)\b/)||[])[1];if(k&&new RegExp('\\b'+k.toLowerCase()+'\\b').test(low))best=n});return best};
    const rows=defaults(I).map(r=>({...r,on:false}));
    if(ar){const c=pickName(L.custs),r=rows[0];r.on=true;if(c)r.customer=c.name;const d=days?+days:7,late=/late|later/.test(low.replace(/(extend|defer|postpone)[^.?!]*/,''))&&!/early/.test(low);r.days=late?d:-d;r.mode='shift_days';if(half||pc)r.share=half||(+pc.replace(',','.')/100);if(late)r.discount=0}
    if(ap){const s=pickName(L.sups),r=rows[1];r.on=true;if(s)r.supplier=s.name;const m=low.match(/(\d+)\s*days?\s*later/);if(m)r.days=+m[1];if(half)r.share=half;r.consent_assumed=/consent|agree|lets? us/.test(low)||!!(L.sups.find(x=>x.name===r.supplier)||{}).essential}
    if(inv){const r=rows[2];r.on=true;r.sale_confirmed=true;if(half)r.share=half}
    return rows;
  }
  async function chatWhatIf(bot,rows,label){
    const st=sims();st.rows=rows;st.prefill=null;const res=run({label});
    if(!res){await say(bot,'Include at least one of the three levers: early or late collection, supplier extension or inventory sale.');return}
    if(res.status==='rejected'){await say(bot,`<p>The change cannot run yet: ${res.errors.map(e=>esc(e.msg)).join('; ')}.</p><p>Open What-if to correct the fields; the other inputs are kept.</p>`,'warn');
      suggestRow(bot,[{t:'Open What-if →',f:()=>openDetail('whatif')}]);return}
    await say(bot,whatIfAnswer(res));
    const card=document.createElement('div');card.className='rcact';card.innerHTML='<button class="btn sec sm" type="button">Open What-if →</button>';card.querySelector('button').onclick=()=>openDetail('whatif');bot.appendChild(card);
    if(S.detail==='whatif'&&S.panel)renderWhatIf();
  }
  return {renderSolutions,renderWhatIf,solutionsAnswer,whatIfAnswer,parseWhatIf,chatWhatIf,loadPreset,run,input,matchNow,sims,REFUSE,OUTSIDE,CONCL,tryInternal,compareHTML,
    reset(){CACHE.clear()}};
})();
