/* UC03 Solutions and UC04 What-if (SRS v2.3 sections 2.9 and 2.10, Appendix B MT01–MT03 and U401–U409, Appendix E E15–E40).
   Pure functions on the UC01 / UC02 runs of js/engine.js: no DOM, no network, no language model. Money is VND, dates are ISO strings
   or day numbers (days since 1970-01-01, UTC). Where the SRS is silent the workbook v10 (UC3_Cong_thuc, UC4_Cong_thuc, F01_UC03,
   F01_UC4) gives the formula or the number; such choices are marked SRS-DECISION. */
const UC0304=(()=>{
  const {dnum,diso,sum,hash}=ENGINE;
  const TOL=1;                                   // reconciliation tolerance, VND (BR-02 / U4-13)
  const VERSIONS={matrix:'matrix.v2',priority:'priority.v2',uc03:'uc03.formulas.srs2.3',uc04:'uc04.formulas.srs2.3'};
  // The three source scenarios of UC03/UC04 (BR-04-01): the engine's "optimistic" scenario is published as "positive".
  // stress_7 and continuing_sales are UC02 views only and are never used here.
  const SCEN=[['base','base'],['conservative','conservative'],['positive','optimistic']];
  const SCEN_KEYS=SCEN.map(s=>s[0]);
  // matrix.v2 (Table 2-73): W × TH; inside the band there is no cell.
  const MATRIX={W0:{TH01:'M1',TH02:'M2'},W1:{TH01:'M3',TH02:'M4'},W2:{TH01:'M5',TH02:'M6'}};
  // MT01 / Table 2-110 (priority.v2): the order of the groups is policy and is never changed by a score or a chat request.
  const PRIORITY={M1:['O2'],M2:['I0'],M3:['O4','O1'],M4:['R0'],M5:['O4','O3','O1','O2'],M6:['R0']};
  const SIMULATED=['O4','O3','O1'];              // UC04 can simulate these groups only (UC03.6, BR-03-08)
  // Workbook v10 D_UC03 parameters used where the SRS gives no number (T3-P06 minimum draw, T3-P07 sources per package).
  const MIN_DRAW_PCT=.05,MAX_SOURCES=4;
  // SRS-DECISION: the extension length of a supplier deferral is the lower bound of the extension frame cl.extDays (15 days, workbook T3-14).
  const AP_EXT_DAYS=()=>CFG.cl.extDays[0];

  /* ---------- Input layer (step 0): W, TH, cell, L/Z/H and the three paths ---------- */
  function thOf(path,L,H){if(path.some(x=>x.close<L))return 'TH01';if(path.some(x=>x.close>H))return 'TH02';return 'in_band'}
  function cellOf(W,TH){if(!W||W==='unknown'||!TH||TH==='unknown'||TH==='in_band')return null;return MATRIX[W][TH]}
  // Day label (Table 2-71): red when Cash ≤ L or Cash < 0, with the touch / below floor / negative label; "above H" is a label, not red.
  // q_yellow / q_orange are not confirmed, so there is no yellow or orange (2.8.11).
  function dayFlag(v,L,H){
    if(v<0)return {cls:'red',label:'negative'};
    if(v<L)return {cls:'red',label:'below floor'};
    if(v<=L)return {cls:'red',label:'touch'};
    if(v>H)return {cls:'above',label:'above H'};
    return null;
  }
  function prepInput(snap,uc01,uc02){
    const R=uc02.reserves,L=R.rmin,Z=R.rtarget,H=R.rupper,fc=uc02.fc,missing=[];
    const sameW=!!uc01&&uc01.snapshot_id===snap.snapshot_id;
    const W=sameW&&uc01.wc_class?uc01.wc_class:'unknown';
    if(W==='unknown')missing.push(uc01?(sameW?'W_UNKNOWN':'W_OTHER_SNAPSHOT'):'W_MISSING');
    const levels=L!=null&&Z!=null&&H!=null&&L>=0&&L<Z&&Z<H;
    if(!levels)missing.push('LZH_INVALID');
    if(['invalid_data','missing_data','rejected'].includes(uc02.status))missing.push('UC02_'+uc02.status.toUpperCase());
    const paths={},events={};
    SCEN.forEach(([k,e])=>{const o=fc.scenarios[e];paths[k]=o.days.map(x=>({d:x.d,in:x.in,out:x.out,close:x.close}));events[k]=o.events});
    const TH=levels&&!missing.some(m=>m.startsWith('UC02_'))?thOf(paths.base,L,H):'unknown';
    const cell=cellOf(W,TH);
    const lots=(snap.lots||[]).map(l=>({lot_id:l.lot_id||null,name:l.name,type:l.type,owner:l.owner,qty:l.qty,unit_cost:l.unit_cost,value:l.value_own,days:l.days,
      pledged:l.pledged,order_status:l.order_status||null,order_id:l.order_id||null,cancelled:l.cancelled}));
    const ids=(typeof DATA!=='undefined'&&DATA.ids&&DATA.ids[snap.firm.id])||{customers:{},suppliers:{}};
    const key=[snap.snapshot_id,uc01?uc01.run_id:'-',uc02.run_id,uc02.config_version,Math.round(L||0),Math.round(Z||0),Math.round(H||0)].join('|');
    return {key,firm:snap.firm.id,firm_name:snap.firm.name,snapshot_id:snap.snapshot_id,as_of:snap.as_of,start:fc.start,end:fc.end,W,TH,cell,L,Z,H,paths,events,
      bn_pattern:sameW?uc01.bn_pattern:null,missing,status:uc02.status,reserves_src:R.src,reserves_version:(R.miller_orr||{}).version||null,miller_orr:R.miller_orr||null,
      matrix_version:VERSIONS.matrix,source_uc01_run:uc01?uc01.run_id:null,source_uc02_run:uc02.run_id,config_version:uc02.config_version,scenario_set:SCEN_KEYS.slice(),
      lots,ids,revenue:snap.fin.revenue,N:snap.N,st_investments:snap.fin.st_investments||0,strategic:(snap.firm.strategic_customers||[]).slice(),
      historical:uc01?{ccc:uc01.metrics.ccc,dso:uc01.metrics.dso,dio:uc01.metrics.dio,dpo:uc01.metrics.dpo}:null};
  }
  // Floor and target gaps of one path (CF06/CF07/CF11, MT02): never summed over days; peaks, day counts and episodes below L.
  function gapStats(path,L,Z){
    let low=path[0],fp=0,fpD=null,tp=0,tpD=null,floorDays=0,targetDays=0,negDays=0,cur=null;const eps=[],daily=[];
    path.forEach((x,i)=>{const f=Math.max(0,L-x.close),g=Math.max(0,Z-x.close);
      if(x.close<low.close)low=x;if(f>fp){fp=f;fpD=x.d}if(g>tp){tp=g;tpD=x.d}
      if(x.close<L)floorDays++;if(x.close<Z)targetDays++;if(x.close<0)negDays++;
      if(g>0)daily.push({d:x.d,cash:x.close,floor:f,target:g});
      if(x.close<L){if(!cur){cur={k:eps.length+1,start:x.d,i0:i,low:x.close,low_date:x.d};eps.push(cur)}cur.end=x.d;cur.i1=i;if(x.close<cur.low){cur.low=x.close;cur.low_date=x.d}}else cur=null});
    eps.forEach(e=>{e.days=e.i1-e.i0+1;e.floor_peak=L-e.low;e.target_peak=Z-e.low;e.censored=e.i1===path.length-1});
    return {min:low.close,min_date:low.d,floor_peak:fp,floor_peak_date:fpD,floor_days:floorDays,target_peak:tp,target_peak_date:tpD,target_days:targetDays,
      negative_days:negDays,negative_peak:Math.max(0,-low.close),episodes:eps,daily,first_floor_day:eps[0]?eps[0].start:null};
  }

  /* ---------- UC03 · catalogue (illustrative products of D_UC03) and policy versions ---------- */
  const OBJ_GROUP={O0:'O0',O1:'O1',O2:'O2',O3:'O3',O4:'O4'};
  // SRS-DECISION: the demo catalogue has no validity dates in the workbook; it is published as an illustrative version valid for the
  // second half of 2026, so the expiry check (UC03.1 A4, UC03.5) has a date to test. Products are labelled illustrative (UC03.5 A3).
  const CATALOGUE_META={version:'cat.F01.v10.1',valid_from:'2026-06-01',valid_until:'2026-12-31',status:'illustrative',source:'Workbook v10 D_UC03 (demo assumptions)',
    confirmed_by:'Demo owner',warn_days:30};
  function catalogueOf(table,proposals){
    // Confirmed proposals (UC03.5) create a new version; the original rows are never edited in place.
    const conf=(proposals||[]).filter(p=>p.status==='confirmed');
    const products=table.products.map(p=>{let q={...p};conf.forEach(c=>{if(c.product_id===p.id)q={...q,[c.field]:c.value}});return q});
    let meta={...CATALOGUE_META};conf.forEach(c=>{if(c.product_id==='*'&&c.field==='valid_until')meta.valid_until=c.value});
    if(conf.length)meta={...meta,version:CATALOGUE_META.version+'+'+conf.length,confirmed_by:conf[conf.length-1].confirmed_by||meta.confirmed_by};
    return {meta,products,params:table.params};
  }
  function catalogueState(cat,runDate){
    const left=dnum(cat.meta.valid_until)-dnum(runDate);
    return {expired:left<0,days_left:left,warn:left>=0&&left<=cat.meta.warn_days};
  }

  /* ---------- UC03 · sources, hard checks EL-03-01 … EL-03-07 ---------- */
  const lotSlow=l=>{const thr=CFG.inv.slowDays[l.type]||CFG.inv.unknownTypeSlowDays;return l.days!=null&&l.days>thr};
  const custByObj=(input,obj)=>{const m=String(obj).match(/K(\d+)$/);if(!m)return null;const suf=' K'+m[1];
    const names=new Set(input.events.base.filter(e=>e.src==='sales_invoice').map(e=>e.partner));return [...names].find(n=>n.endsWith(suf))||null};
  // One source per catalogue row; units are the objects it would use (invoices, payments, lots, a limit), each used once (BR-03-04).
  function buildSources(input,cat,episode){
    const A=dnum(input.as_of),base=input.events.base,end=dnum(input.end),need=episode?dnum(episode.start):null;
    const strategic=new Set(input.strategic.map(n=>ENGINE.normName(n)));
    return cat.products.map(p=>{
      const group=OBJ_GROUP[p.option]||'O2',fund=A+Math.max(0,p.dtf|0),checks=[],units=[];
      const chk=(id,status,code,note)=>checks.push({id,status,code,note});
      const src={id:p.id,name:p.name,group,product:p,object:p.object,dtf:p.dtf,fund_date:diso(fund),rel:p.rel,certainty:p.certainty,illustrative:true,checks,units,
        basis:'',party:null,obligations:[],evidence:[]};
      if(group==='O4'){
        const cust=custByObj(input,p.object);src.party=cust;
        const recs=base.filter(e=>e.dir==='IN'&&e.src==='sales_invoice'&&e.partner===cust&&e.t!=null&&(need==null||e.t>need));
        src.basis=`Open invoices of ${cust||'—'} collected after the need date on Base, moved to ${diso(fund)} at a ${(p.fee_pct*100).toFixed(1)}% discount (U401)`;
        recs.sort((a,b)=>b.t-a.t||(a.id<b.id?-1:1)).forEach(e=>{const disc=e.amt*p.fee_pct;
          units.push({uid:'INV:'+e.id,label:`${e.id} (${diso(e.t)})`,amount:e.amt,net:e.amt-disc,cost:disc,confirmed:e.certainty==='confirmed',
            evs:[{t:fund,a:e.amt-disc,kind:'receipt moved earlier'},{t:e.t,a:-e.amt,kind:'original receipt removed'}]})});
        // EL-03-01: the invoice exists with an open balance of this company, not used by another source (tracked by the package),
        // dispute and assignment status known (invoice status in D_sales), new date not in the past.
        const st=new Set(base.filter(e=>e.partner===cust&&e.src==='sales_invoice').map(e=>e.id));
        chk('EL-03-01',units.length?'pass':'fail',units.length?null:'NO_NET_CASH',units.length?`${units.length} open invoice(s) after the need date`:'no open invoice collected after the need date');
        chk('EL-03-01',st.size?'pass':'missing',st.size?null:'DISPUTE_STATUS_UNKNOWN','dispute / assignment: invoice status recorded as active in the sales ledger');
        // EL-03-02: strategic or large customers need a relationship assessment; a declared strategic customer is not used automatically.
        const strat=p.strategic||(cust&&strategic.has(ENGINE.normName(cust)));
        chk('EL-03-02',strat?'fail':'pass',strat?'STRATEGIC_OR_CRITICAL':null,strat?'declared strategic customer: terms are not changed automatically':'relationship impact assessed in the catalogue (rel '+p.rel+')');
        if(units.some(u=>u.confirmed))chk('EL-03-01','pass',null,'confirmed receipt schedules are kept as given');
        src.evidence.push('D_sales open invoices','D_UC03 '+p.id);
      }else if(group==='O1'){
        const essentialObj=/APS$/.test(p.object);
        const pays=base.filter(e=>e.dir==='OUT'&&e.src==='purchase_invoice'&&e.t!=null&&e.t<=end&&(!!e.essential)===essentialObj&&(need==null||e.t>=need));
        const ext=AP_EXT_DAYS();src.party=essentialObj?'essential suppliers':'non-essential suppliers';
        src.basis=`Supplier payments due in the shortfall window deferred by ${ext} days (U402); the payment and any fee stay due later`;
        pays.sort((a,b)=>a.t-b.t||(a.id<b.id?-1:1)).forEach(e=>{const fee=e.amt*p.fee_pct;
          units.push({uid:'PAY:'+e.id,label:`${e.id} ${e.partner} (${diso(e.t)})`,amount:e.amt,net:e.amt,cost:fee,partner:e.partner,essential:!!e.essential,old:e.t,
            notBefore:fund,evs:[{t:e.t,a:e.amt,kind:'payment deferred'},{t:e.t+ext,a:-(e.amt+fee),kind:'deferred payment due'}]})});
        chk('EL-03-04',units.length?'pass':'fail',units.length?null:'NO_NET_CASH',units.length?`${units.length} payment(s) from the need date on`:'no supplier payment from the need date on');
        chk('EL-03-04',essentialObj||p.strategic?'fail':'pass',essentialObj||p.strategic?'STRATEGIC_OR_CRITICAL':null,
          essentialObj||p.strategic?'essential or sole supplier: not a certain source of deferral':'supplier consent is an assumption to confirm');
        src.evidence.push('D_purchases payment schedule','D_UC03 '+p.id);
      }else if(group==='O3'){
        const lots=input.lots.filter(l=>/SLOW$/.test(p.object)?lotSlow(l)&&['TP','HH'].includes(l.type):!lotSlow(l));
        src.party='owned lots';src.basis=`Net cash from selling owned slow TP/HH lots at ${(100-p.haircut*100).toFixed(1)}% of book value (U403–U404), cash in on ${diso(fund)}`;
        lots.forEach(l=>{
          // EL-03-03: ownership confirmed, quantity available, pledge and order constraints checked; missing constraints are not "eligible".
          const why=l.owner!=='own'?'customer-owned or ownership unknown':l.pledged==='yes'?'pledged':l.pledged!=='no'?'pledge status unknown':l.order_status==='active'?'tied to an open order':
            ['completed','no_order','cancelled'].includes(l.order_status)?null:'order constraint unknown';
          if(why){src.evidence.push(`${l.lot_id||l.name}: ${why}`);return}
          const book=l.value,gross=book*(1-p.haircut);
          units.push({uid:'LOT:'+(l.lot_id||l.name),label:`${l.lot_id||''} ${l.name}`.trim(),amount:book,net:gross,cost:book-gross,evs:[{t:fund,a:gross,kind:'sale proceeds'}]})});
        chk('EL-03-03',units.length?'pass':'fail',units.length?null:'NO_ELIGIBLE_LOT',units.length?`${units.length} owned lot(s) free of pledge and order constraints`:'no owned lot free of pledge and order constraints');
        src.evidence.push('D_inventory','D_UC03 '+p.id);
      }else if(group==='O2'){
        // EL-03-05: product valid, fits the object, collateral/documents, unused limit, disbursement not later than the need, repayment data.
        const inv=/^OBJ-AR-/.test(p.object),lim=/^LIM-/.test(p.object),stock=/^OBJ-INV-/.test(p.object);
        if(!p.has_data)chk('EL-03-05','fail','NO_PRODUCT_DATA','no product data');
        if(p.pledged)chk('EL-03-05','fail','PLEDGED','collateral already pledged');
        if(inv){const cust=custByObj(input,p.object);src.party=cust;
          const recs=base.filter(e=>e.dir==='IN'&&e.src==='sales_invoice'&&e.partner===cust&&e.t!=null&&(need==null||e.t>need));
          src.basis=`Advance of ${(p.adv*100).toFixed(0)}% on open invoices of ${cust||'—'}, repaid when the customer pays`;
          recs.sort((a,b)=>b.t-a.t||(a.id<b.id?-1:1)).forEach(e=>{const adv=e.amt*p.adv,days=Math.max(1,e.t-fund),cost=adv*p.rate*days/365+e.amt*p.fee_pct;
            units.push({uid:'INV:'+e.id,label:`${e.id} (${diso(e.t)})`,amount:adv,net:adv,cost,evs:[{t:fund,a:adv,kind:'disbursement'},{t:e.t,a:-(adv+cost),kind:'repayment from the receipt'}]})});
          if(!recs.length)chk('EL-03-05','fail','NO_NET_CASH','no open invoice of this customer after the need date')}
        else if(lim){const C=p.base_declared||0;src.party=p.object;src.basis=`Unused limit ${p.object} (declared, illustrative), repaid after ${p.hold} days`;
          if(C>0){const f=p.rate*p.hold/365+p.fee_pct;units.push({uid:'LIM:'+p.object,label:p.object,amount:C,net:C,cost:C*f,evs:[{t:fund,a:C,kind:'disbursement'},{t:fund+p.hold,a:-C*(1+f),kind:'repayment'}]})}
          else chk('EL-03-05','fail','PROGRAM_HEADROOM_EXHAUSTED','no unused limit')}
        else if(stock){const lots=input.lots.filter(l=>l.owner==='own'&&(/PLG$/.test(p.object)?l.pledged==='yes':l.pledged==='no'&&!lotSlow(l)&&l.cancelled!=='yes'));
          const V=sum(lots,l=>l.value),C=V*p.adv;src.party='owned lots';src.basis=`Loan of ${(p.adv*100).toFixed(0)}% on owned lots (book ${Math.round(V)} VND), repaid after ${p.hold} days`;
          if(C>0&&!p.pledged){const f=p.rate*p.hold/365+p.fee_pct;units.push({uid:'COLL:'+p.object,label:'collateral pool',amount:C,net:C,cost:C*f,evs:[{t:fund,a:C,kind:'disbursement'},{t:fund+p.hold,a:-C*(1+f),kind:'repayment'}]})}}
        if(!checks.length)chk('EL-03-05','pass',null,'illustrative product; lender approval is not assumed (BR-03-05)');
        src.evidence.push('D_UC03 '+p.id+' (illustrative)');
      }else{
        src.basis='Internal funds (short-term investments): not a group of matrix.v2';
        chk('EL-03-07','pass',null,'short-term investments '+Math.round(input.st_investments)+' VND');
      }
      // EL-03-07: net amount, timing, cost, unconfirmed conditions and evidence must exist; otherwise only "to consider".
      if(!p.has_data&&group!=='O2')chk('EL-03-07','missing','NO_PRODUCT_DATA','product data missing');
      units.forEach(u=>{u.net_total=sum(u.evs.filter(e=>e.a>0),e=>e.a)});
      src.capacity=sum(units,u=>u.net);src.cost_full=sum(units,u=>u.cost);
      src.obligations=units.flatMap(u=>u.evs.filter(e=>e.a<0&&!/removed/.test(e.kind)).map(e=>({date:diso(e.t),amount:-e.a,kind:e.kind,unit:u.label})));
      return src;
    });
  }
  const statusOfChecks=c=>c.some(x=>x.status==='fail')?'fails':c.some(x=>x.status==='missing')?'lacks_evidence':'eligible';

  /* ---------- UC03 · ranking inside a group and the daily package ---------- */
  // Inside one group (2.9.13): timely → eligibility confirmed → speed → cost on the same amount and term → relationship impact → stable id.
  function rankKey(s,ep,G,dur){
    const timely=dnum(s.fund_date)<=dnum(ep.start)?0:1,conf=s.status==='eligible'?0:1;
    const amt=Math.min(Math.max(s.capacity,1),Math.max(G,1)),cps=s.capacity>0?(s.cost_full/s.capacity)*amt/Math.max(G,1):Infinity;
    return [timely,conf,s.dtf,Math.round(cps*1e6),s.rel,s.id];
  }
  const cmpKey=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]<b[i])return -1;if(a[i]>b[i])return 1}return 0};
  // MT01 + MT02: builds the package episode by episode on daily events, each object once, with no new or worse shortfall elsewhere.
  function match(input,table,opts={}){
    const cat=catalogueOf(table,opts.proposals),cs=catalogueState(cat,input.as_of),excludedByUser=opts.excluded||{};
    const meta={match_run_id:null,source_uc01_run:input.source_uc01_run,source_uc02_run:input.source_uc02_run,snapshot_id:input.snapshot_id,wc_class:input.W,cash_state:input.TH,
      matrix_case:input.cell,matrix_version:VERSIONS.matrix,priority_policy_version:VERSIONS.priority,catalogue_version:cat.meta.version,catalogue_status:cat.meta.status,
      catalogue_valid_until:cat.meta.valid_until,reserves_version:input.reserves_version,mode:'analysis'};
    meta.match_run_id='MATCH-'+hash([input.key,cat.meta.version,VERSIONS.priority,JSON.stringify(excludedByUser)].join('|'));
    const base=input.paths.base,L=input.L,Z=input.Z,need=gapStats(base,L,Z);
    const out={meta,need,catalogue:{...cat.meta,...cs},route:null,L,Z,H:input.H,start:input.start,end:input.end,as_of:input.as_of};
    // E16: no cell without both axes; inside the band there is no solution request (Table 2-72).
    if(input.missing.length&&!input.cell){out.route='not_routed';out.reason=input.missing;return out}
    if(!input.cell){out.route='in_band';return out}
    out.groups=PRIORITY[input.cell];
    if(input.TH==='TH02'){Object.assign(out,surplus(input,cat));return out}
    out.route='shortfall';
    const ep0=need.episodes[0],sources=buildSources(input,cat,ep0);
    sources.forEach(s=>{s.status=statusOfChecks(s.checks);
      // A4: an expired catalogue cannot give a current offer for borrowing products.
      if(cs.expired&&s.group==='O2'){s.checks.push({id:'EL-03-05',status:'fail',code:'CATALOGUE_EXPIRED',note:'catalogue expired on '+cat.meta.valid_until});s.status='fails'}
      if(excludedByUser[s.id]){s.user_excluded=excludedByUser[s.id];if(s.status==='eligible'||s.status==='lacks_evidence')s.status='user_excluded'}
      s.in_policy=out.groups.includes(s.group);s.policy_rank=s.in_policy?out.groups.indexOf(s.group):null;
      // BR-03-02: a source that cannot fund by the need date of any episode is reported as TOO_SLOW, whatever its capacity.
      s.too_slow=need.episodes.length>0&&need.episodes.every(ep=>dnum(s.fund_date)>dnum(ep.start))});
    const days=base.map(x=>x.d),start=dnum(days[0]),cur=base.map(x=>x.close),n=cur.length;
    const prof=(evs,f)=>{const k=new Array(n).fill(0);evs.forEach(e=>{const i=Math.max(0,e.t-start);if(i<n)for(let j=i;j<n;j++)k[j]+=e.a*f});return k};
    const used=new Map(),draws=[],skips={},events=[],tail=[];
    const skip=(id,ep,code)=>{(skips[id]=skips[id]||[]).push({episode:ep.k,code})};
    need.episodes.forEach(ep=>{
      const inEp=j=>j>=ep.i0&&j<=ep.i1,needNow=()=>Math.max(0,...cur.filter((_,j)=>inEp(j)).map(c=>Z-c));
      const G=needNow(),dur=ep.days;if(G<=TOL)return;
      let nSrc=new Set(draws.map(d=>d.source_id)).size;
      out.groups.forEach(g=>{
        const list=sources.filter(s=>s.group===g&&s.status!=='fails'&&s.status!=='user_excluded').sort((a,b)=>cmpKey(rankKey(a,ep,G,dur),rankKey(b,ep,G,dur)));
        list.forEach((s,rank)=>{s.ranks=s.ranks||{};s.ranks[ep.k]=rank+1;
          if(needNow()<=TOL){skip(s.id,ep,'GAP_COVERED');return}
          if(s.status==='lacks_evidence'){skip(s.id,ep,'TO_CONSIDER');return}
          if(dnum(s.fund_date)>dnum(ep.start)){skip(s.id,ep,'TOO_SLOW');return}   // BR-03-02: untimely never counts as coverage
          if(nSrc>=MAX_SOURCES&&!draws.some(d=>d.source_id===s.id)){skip(s.id,ep,'MAX_SOURCES');return}
          const snap=cur.slice(),mine=[];let blocked=false,limited=false;
          for(const u of s.units){
            const need1=needNow();if(need1<=TOL)break;
            const left=1-(used.get(u.uid)||0);if(left<=1e-9){continue}
            if(u.notBefore!=null&&u.old<u.notBefore)continue;      // a payment due before the agreement date cannot be deferred
            const k=prof(u.evs,1);let fNeed=0;for(let j=ep.i0;j<=ep.i1;j++)if(k[j]>0)fNeed=Math.max(fNeed,(Z-cur[j])/k[j]);
            if(fNeed<=0)continue;
            // No new or worse shortfall on a later episode or a repayment date: cur_j + f·k_j ≥ MIN(L; cur_j) − TOL wherever k_j < 0.
            let fMax=left;for(let j=0;j<n;j++)if(k[j]<0){const room=cur[j]-Math.min(L,cur[j])+TOL;fMax=Math.min(fMax,room/(-k[j]))}
            const f=Math.min(fNeed,fMax);if(fMax<fNeed-1e-12)limited=true;
            if(f<=1e-9){blocked=true;continue}
            for(let j=0;j<n;j++)cur[j]+=k[j]*f;
            mine.push({u,f});
          }
          const drawn=sum(mine,m=>m.u.net*m.f);
          if(!mine.length){skip(s.id,ep,blocked?'CREATES_LATER_SHORTFALL':'NO_USABLE_OBJECT');return}
          if(drawn<MIN_DRAW_PCT*G){for(let j=0;j<n;j++)cur[j]=snap[j];skip(s.id,ep,limited?'CREATES_LATER_SHORTFALL':'BELOW_MIN_DRAW');return}
          mine.forEach(({u,f})=>{used.set(u.uid,(used.get(u.uid)||0)+f);
            u.evs.forEach(e=>{const ev={date:diso(e.t),source_id:s.id,group:s.group,unit:u.label,uid:u.uid,amount:e.a*f,kind:e.kind,episode:ep.k};(e.t>dnum(input.end)?tail:events).push(ev)})});
          if(!draws.some(d=>d.source_id===s.id))nSrc++;
          draws.push({source_id:s.id,name:s.name,group:s.group,episode:ep.k,net:drawn,gross:sum(mine,m=>m.u.amount*m.f),cost:sum(mine,m=>m.u.cost*m.f),fund_date:s.fund_date,
            units:mine.map(m=>({label:m.u.label,uid:m.u.uid,share:m.f,net:m.u.net*m.f})),obligations:mine.flatMap(m=>m.u.evs.filter(e=>e.a<0&&!/removed/.test(e.kind)).map(e=>({date:diso(e.t),amount:-e.a*m.f,kind:e.kind})))});
        });
      });
    });
    const after=base.map((x,j)=>({d:x.d,in:x.in,out:x.out,close:cur[j]})),rem=gapStats(after,L,Z);
    events.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.source_id<b.source_id?-1:1));
    const covered=draws.length>0,epDays=need.episodes.flatMap(ep=>after.slice(ep.i0,ep.i1+1));
    // The package targets Z on the shortfall days; CF07 over the whole horizon is reported in remaining (MT02).
    const epTarget=Math.max(0,...epDays.map(x=>Z-x.close));
    out.sources=sources.map(s=>({...s,units:s.units.map(u=>({label:u.label,uid:u.uid,amount:u.amount,net:u.net,cost:u.cost,partner:u.partner||null})),skips:skips[s.id]||[],in_package:draws.some(d=>d.source_id===s.id)}));
    out.package={draws,events,tail,cost:sum(draws,d=>d.cost),net:sum(draws,d=>d.net),after,remaining:rem,
      episode_target_remaining:epTarget,status:!covered?'none':rem.floor_days===0&&epTarget<=TOL?'to_target':rem.floor_days===0?'above_floor':'partial',timely:covered};
    out.sources.forEach(s=>{s.reasons=[...new Set([...(s.too_slow?['TOO_SLOW']:[]),...s.checks.filter(c=>c.status==='fail').map(c=>c.code)])];
      s.missing_evidence=s.checks.filter(c=>c.status==='missing').map(c=>c.code||c.note)});
    out.excluded={fails:out.sources.filter(s=>s.status==='fails'||(s.in_policy&&s.too_slow&&s.status!=='user_excluded')),
      lacks_evidence:out.sources.filter(s=>s.status==='lacks_evidence'),user:out.sources.filter(s=>s.status==='user_excluded'),
      outside_policy:out.sources.filter(s=>!s.in_policy&&s.status!=='fails')};
    out.internal=out.sources.filter(s=>SIMULATED.includes(s.group)&&s.status!=='fails');
    out.not_simulated=out.sources.filter(s=>['O2','I0'].includes(s.group)&&(s.in_package||s.in_policy));
    return out;
  }
  // TH02 branch (2.9.15): M2 SafeCash (MT03) across the three scenarios; M4/M6 hold as reserve with L/Z/H and the next obligations.
  function surplus(input,cat){
    const base=input.paths.base,H=input.H,Z=input.Z,i0=base.findIndex(x=>x.close>H);
    const obligations=input.events.base.filter(e=>e.dir==='OUT'&&e.scope==='in_horizon'&&e.certainty==='confirmed').sort((a,b)=>a.t-b.t||b.amt-a.amt).slice(0,6)
      .map(e=>({date:diso(e.t),amount:e.amt,kind:e.cat,partner:e.partner}));
    if(input.cell!=='M2')return {route:'reserve',hold:{L:input.L,Z,H,obligations,above_days:base.filter(x=>x.close>H).length,max_above:Math.max(0,...base.map(x=>x.close-H))}};
    // SRS-DECISION: t0 = first Base day above H; τ = the forecast end (no recovery date is known), so the result holds within the horizon only.
    const t0=base[i0],avail=t0.close,minAll=Math.min(...SCEN_KEYS.map(k=>Math.min(...input.paths[k].slice(i0).map(x=>x.close))));
    const safe=Math.max(0,Math.min(avail-Z,minAll-Z));
    const i0prods=cat.products.filter(p=>p.option==='I0');
    return {route:'invest',safe_cash:{value:safe,t0:t0.d,tau:input.end,cash_t0:avail,min_all:minAll,Z,within_horizon_only:true},
      i0_products:i0prods.length,allocation:safe<=TOL?'none_needed':i0prods.length?'consider':'no_product_data',obligations};
  }

  /* ---------- UC03.6 / UC04.5 · hand-over of the internal part ---------- */
  function prefill(m,ids){
    const pick=m.sources.filter(s=>ids.includes(s.id));
    const bad=pick.filter(s=>!SIMULATED.includes(s.group));
    const ok=pick.filter(s=>SIMULATED.includes(s.group)&&s.status!=='fails');
    const changes=[];
    ok.forEach(s=>{const d=(m.package?m.package.draws:[]).filter(x=>x.source_id===s.id),drawn=new Map();
      d.forEach(x=>x.units.forEach(u=>drawn.set(u.uid,(drawn.get(u.uid)||0)+u.share)));
      // Package units keep their drawn share; a considered source (not in the package) is handed over in full for the user to adjust.
      const units=d.length?s.units.filter(u=>drawn.has(u.uid)):s.units,shareOf=u=>d.length?Math.min(1,drawn.get(u.uid)):1;
      const objId=u=>u.uid.replace(/^[A-Z]+:/,'');
      if(s.group==='O4'&&units.length){const tot=sum(units,u=>u.amount),sh=sum(units,u=>u.amount*shareOf(u))/Math.max(1,tot);
        changes.push({lever:'ar',customer:s.party,invoice_ids:units.map(objId),share:Math.round(sh*1e4)/1e4,mode:'absolute_date',date:s.fund_date,days:null,discount:s.product.fee_pct,from:s.id})}
      if(s.group==='O1'){const by=new Map();units.forEach(u=>{if(!by.has(u.partner))by.set(u.partner,[]);by.get(u.partner).push(u)});
        by.forEach((us,p)=>changes.push({lever:'ap',supplier:p,event_ids:us.map(objId),share:Math.round(Math.min(...us.map(shareOf))*1e4)/1e4,days:AP_EXT_DAYS(),fee:s.product.fee_pct,consent_assumed:false,from:s.id}))}
      if(s.group==='O3')units.forEach(u=>changes.push({lever:'inv',lot_id:objId(u),share:Math.round(shareOf(u)*1e4)/1e4,qty:null,basis:'recovery',recovery:1-s.product.haircut,unit_price:null,
        lag_days:Math.max(0,dnum(s.fund_date)-dnum(m.start)),selling_cost:0,sale_confirmed:false,from:s.id}))});
    const pkgIds=new Set(m.package?m.package.draws.map(d=>d.source_id):[]);
    const internalPkg=[...pkgIds].filter(id=>SIMULATED.includes((m.sources.find(s=>s.id===id)||{}).group));
    const full=internalPkg.length>0&&internalPkg.every(id=>ids.includes(id))&&ok.every(s=>pkgIds.has(s.id))&&m.not_simulated.every(s=>!s.in_package);
    return {changes,scope:full?'full_internal':pkgIds.size?'subset':'outside_package',source_match_run:m.meta.match_run_id,option_ids:ok.map(s=>s.id),
      rejected:bad.map(s=>({id:s.id,group:s.group,reason:'not simulated by UC04 (borrowing or investment)'})),not_simulated:m.not_simulated.map(s=>({id:s.id,group:s.group,name:s.name}))};
  }

  /* ---------- UC04 · validation, three levers on three scenarios ---------- */
  const isInt=v=>Number.isInteger(v);
  const num=v=>v===''||v==null?NaN:+v;
  function validate(input,changes){
    const errs=[],e=(i,field,msg)=>errs.push({index:i,field,msg}),start=dnum(input.start),end=dnum(input.end);
    const custs=new Set(input.events.base.filter(x=>x.src==='sales_invoice').map(x=>x.partner)),sups=new Map();
    input.events.base.filter(x=>x.src==='purchase_invoice').forEach(x=>sups.set(x.partner,sups.get(x.partner)||!!x.essential));
    const share={};
    changes.forEach((c,i)=>{
      if(!['ar','ap','inv'].includes(c.lever)){e(i,'lever','Only the three levers are supported: early or late collection, supplier extension, inventory sale');return}
      if(c.lever!=='inv'||c.share!=null){const s=num(c.share);if(!(s>0&&s<=1))e(i,'share','Share must be more than 0% and at most 100%')}
      if(c.lever==='ar'){
        if(!custs.has(c.customer))e(i,'customer','Pick a customer with an open invoice');
        if(c.mode==='absolute_date'){if(!c.date||isNaN(dnum(c.date)))e(i,'date','Enter the committed collection date');else if(dnum(c.date)<start)e(i,'date','The new date cannot be before the first forecast day '+input.start)}
        else{const d=num(c.days);if(!isInt(d)||d===0)e(i,'days','Enter a whole number of days other than 0 (negative = earlier, positive = later)')}
        const d=num(c.discount);if(!(d>=0&&d<1))e(i,'discount','Discount must be between 0% and 100%');
        const movable=input.events.base.filter(x=>x.src==='sales_invoice'&&x.partner===c.customer&&x.t!=null&&x.certainty!=='confirmed'&&(!c.invoice_ids||c.invoice_ids.includes(x.id)));
        if(custs.has(c.customer)&&!movable.length)e(i,'customer','This customer has no receipt that can be moved');
        const k='ar|'+c.customer,sv=num(c.share);if(sv>0&&sv<=1){share[k]=(share[k]||0)+sv;if(share[k]>1+1e-9)e(i,'share','The shares of this customer add up to more than 100% (each invoice part is used once)')}
      }
      if(c.lever==='ap'){
        if(!sups.has(c.supplier))e(i,'supplier','Pick a supplier with an upcoming payment');
        const d=num(c.days);if(!isInt(d)||d<1)e(i,'days','Enter a whole number of days, at least 1');
        const f=num(c.fee);if(!(f>=0&&f<1))e(i,'fee','Fee must be between 0% and 100%');
        if(sups.get(c.supplier)&&!c.consent_assumed)e(i,'consent_assumed','Essential supplier: tick “assumed supplier consent” to test this change');
        const pays=input.events.base.filter(x=>x.src==='purchase_invoice'&&x.partner===c.supplier&&x.t!=null&&x.t<=end);
        if(sups.has(c.supplier)&&!pays.length)e(i,'supplier','This supplier has no payment inside the horizon');
        const k='ap|'+c.supplier,sv=num(c.share);if(sv>0&&sv<=1){share[k]=(share[k]||0)+sv;if(share[k]>1+1e-9)e(i,'share','The shares of this supplier add up to more than 100%')}
      }
      if(c.lever==='inv'){
        const l=input.lots.find(x=>x.lot_id===c.lot_id);
        if(!l){e(i,'lot_id','Pick an owned lot');return}
        if(l.owner!=='own')e(i,'lot_id','This lot is not owned by the company and cannot be sold');
        if(l.pledged!=='no')e(i,'lot_id',l.pledged==='yes'?'This lot is pledged and cannot be sold here':'Pledge status unknown: add the evidence before testing');
        const qty=c.qty!=null&&c.qty!==''?num(c.qty):num(c.share)*l.qty;
        if(c.qty!=null&&c.qty!==''&&!(qty>0))e(i,'qty','Quantity must be more than 0');
        const k='inv|'+c.lot_id;share[k]=(share[k]||0)+(qty||0);if(share[k]>l.qty+1e-6)e(i,c.qty!=null&&c.qty!==''?'qty':'share',`Only ${l.qty} units are available in this lot`);
        if(c.basis==='unit_price'){if(!(num(c.unit_price)>0))e(i,'unit_price','Enter the unit price with evidence')}
        else if(c.basis==='recovery'){const r=num(c.recovery);if(!(r>0&&r<=1))e(i,'recovery','Recovery must be more than 0% and at most 100% of book value')}
        else e(i,'basis','Choose one price basis: unit price or recovery');
        const g=num(c.lag_days);if(!isInt(g)||g<0)e(i,'lag_days','Enter a whole number of days, 0 or more');
        const sc=num(c.selling_cost);if(!(sc>=0&&sc<1))e(i,'selling_cost','Selling cost must be between 0% and 100%');
        if(!c.sale_confirmed)e(i,'sale_confirmed','Confirm the sale assumption (buyer and date) to test this change');
        // A planned sale of the same lot is replaced first; an inventory-sale plan that cannot be mapped to a lot blocks the change (2.10.11).
        const plans=input.events.base.filter(x=>x.src==='plan'&&x.dir==='IN'&&/inventory|stock|sale/i.test(String(x.cat)+String(x.partner)));
        if(plans.some(p=>!p.source_id))e(i,'lot_id','A planned stock sale cannot be mapped to a lot: map it before testing this lot');
      }
    });
    return errs;
  }
  function conclusionOf(b,a){
    if(a.floor_days>b.floor_days||a.floor_peak>b.floor_peak+TOL||a.negative_days>b.negative_days)return 'worse';
    const improved=a.floor_days<b.floor_days||a.floor_peak<b.floor_peak-TOL||a.target_peak<b.target_peak-TOL||a.min>b.min+TOL;
    if(!improved)return 'none';
    return a.floor_days===0?'full':'partial';
  }
  function runScenario(input,k,changes){
    const evs=input.events[k],path=input.paths[k],S0=dnum(input.start),E0=dnum(input.end),L=input.L,Z=input.Z,H=input.H;
    const delta=new Map(),tail=[],ledger=[],notes=[],costs={discount:0,fee:0,sale:0,book_shortfall:0,book_gain:0};
    const add=(t,a,info)=>{if(t>E0){tail.push({date:diso(t),amount:a,...info});return}const j=Math.max(t,S0);delta.set(j,(delta.get(j)||0)+a)};
    let moved={ar:0,ap:0,sale:0},capDays=0;
    changes.forEach(c=>{
      if(c.lever==='ar'){const sh=+c.share,d=+c.discount;
        evs.filter(e=>e.dir==='IN'&&e.src==='sales_invoice'&&e.partner===c.customer&&e.t!=null&&(!c.invoice_ids||c.invoice_ids.includes(e.id))).forEach(e=>{
          if(e.certainty==='confirmed'){notes.push(`${e.id}: confirmed schedule kept`);return}
          const nt=c.mode==='absolute_date'?dnum(c.date):Math.max(S0,e.t+(+c.days));if(nt===e.t)return;
          const m=e.amt*sh,disc=nt<e.t?m*d:0;                                              // U401: discount only on the part collected early
          add(e.t,-m,{type:'original receipt removed',object:e.id});add(nt,m-disc,{type:'customer receipt',object:e.id});
          costs.discount+=disc;moved.ar+=m;capDays+=m*(e.t-nt);
          ledger.push({lever:'ar',source_event_id:e.id,object_id:e.id,nominal:e.amt,moved:m,remaining:e.amt-m,old:diso(e.t),new:diso(nt),cost:disc})})}
      if(c.lever==='ap'){const sh=+c.share,fr=+c.fee;
        evs.filter(e=>e.dir==='OUT'&&e.src==='purchase_invoice'&&e.partner===c.supplier&&e.t!=null&&e.t<=E0&&(!c.event_ids||c.event_ids.includes(e.id))).forEach(e=>{
          const nt=e.t+(+c.days),m=e.amt*sh,fee=m*fr;                                     // U402: AP_new = P + fee, kept after the horizon too
          add(e.t,m,{type:'payment deferred',object:e.id});add(nt,-(m+fee),{type:'supplier payment (deferred)',object:e.id,obligation:true});
          costs.fee+=fee;moved.ap+=m;ledger.push({lever:'ap',source_event_id:e.id,object_id:e.id,nominal:e.amt,moved:m,remaining:e.amt-m,old:diso(e.t),new:diso(nt),cost:fee})})}
      if(c.lever==='inv'){const l=input.lots.find(x=>x.lot_id===c.lot_id),qty=c.qty!=null&&c.qty!==''?+c.qty:+c.share*l.qty;
        const book=qty*l.unit_cost,gross=c.basis==='unit_price'?qty*(+c.unit_price):book*(+c.recovery),cost=gross*(+c.selling_cost),net=gross-cost,t=S0+(+c.lag_days);
        // Replace a planned sale of the same lot before adding the new receipt (no double count, 2.10.11).
        evs.filter(e=>e.src==='plan'&&e.dir==='IN'&&e.source_id===c.lot_id).forEach(e=>{const r=e.amt*Math.min(1,qty/l.qty);
          add(e.t,-r,{type:'planned sale replaced',object:e.id});notes.push(`${e.id}: planned sale replaced`)});
        add(t,net,{type:'stock sale receipt',object:c.lot_id});
        costs.sale+=cost;costs.book_shortfall+=Math.max(0,book-gross);costs.book_gain+=Math.max(0,gross-book);moved.sale+=net;
        ledger.push({lever:'inv',source_event_id:'SALE-'+c.lot_id,object_id:c.lot_id,nominal:l.qty,moved:qty,remaining:l.qty-qty,old:null,new:diso(t),cost,book,gross,net})}
    });
    let cum=0;const after=path.map(x=>{cum+=delta.get(dnum(x.d))||0;return {d:x.d,in:x.in,out:x.out,close:x.close+cum,delta:cum}});
    const before=gapStats(path,L,Z),aft=gapStats(after,L,Z);
    const worse=after.filter((x,j)=>x.close<path[j].close-TOL).map(x=>({d:x.d,amount:x.delta}));
    const inH=sum([...delta.values()]);
    const recon=Math.abs((after.at(-1).close-path.at(-1).close)-inH)<=TOL&&ledger.every(r=>Math.abs(r.moved+r.remaining-r.nominal)<=TOL);
    const th_after=thOf(after,L,H);
    return {scenario:k,before,after:aft,path_before:path,path_after:after,worse_days:worse.length,worse,new_gap_days:after.filter((x,j)=>x.close<L&&path[j].close>=L).length,
      tail_events:tail,tail_obligations:sum(tail.filter(t=>t.obligation),t=>-t.amount),tail_receipts:sum(tail.filter(t=>t.amount>0),t=>t.amount),costs:{...costs,cash:costs.discount+costs.fee+costs.sale},
      moved,ledger,notes,recon_ok:recon,conclusion:conclusionOf(before,aft),th_after,simulated_matrix_case:cellOf(input.W,th_after),equivalent_dso_days:input.revenue>0?capDays/input.revenue:null};
  }
  // UC04.1: one change set on base / conservative / positive. W, CCC and the historical DSO/DIO/DPO never change (BR-04-06).
  function simulate(input,changes,meta={}){
    const errors=validate(input,changes);
    const cfg={snapshot_id:input.snapshot_id,source_uc01_run:input.source_uc01_run,source_uc02_run:input.source_uc02_run,config_version:input.config_version,
      reserves:{L:input.L,Z:input.Z,H:input.H,version:input.reserves_version},scenario_set:input.scenario_set,formula_version:VERSIONS.uc04,mode:'simulation'};
    if(errors.length)return {status:'rejected',errors,meta:cfg};
    const results={};SCEN_KEYS.forEach(k=>{results[k]=runScenario(input,k,changes)});
    const b=results.base,conditions=[];
    if(changes.some(c=>c.lever==='ar'))conditions.push('Customer agreement to the new collection date is an assumption');
    if(changes.some(c=>c.lever==='ap'))conditions.push('Assumed supplier consent: not an agreement');
    if(changes.some(c=>c.lever==='inv'))conditions.push('A buyer, the price basis and the sale date are assumptions');
    if(b.tail_obligations>0)conditions.push('Obligations moved after the horizon stay due');
    const seq=meta.seq||0,sim_run_id='SIM-'+hash([input.key,JSON.stringify(changes),seq].join('|'));
    return {status:'ok',sim_run_id,parent_id:meta.parent_id||null,source_uc03_run:meta.source_uc03_run||null,scope:meta.scope||'direct',option_ids:meta.option_ids||[],
      not_simulated:meta.not_simulated||[],created_at:meta.created_at||null,label:meta.label||null,
      meta:{...cfg,sim_run_id,source_uc03_run:meta.source_uc03_run||null,source_matrix_case:input.cell,W:input.W,TH:input.TH},
      changes:JSON.parse(JSON.stringify(changes)),results,conclusion:b.conclusion,conditions,
      th_after:b.th_after,simulated_matrix_case:b.simulated_matrix_case,source_matrix_case:input.cell,W:input.W,historical:input.historical,
      recon_ok:SCEN_KEYS.every(k=>results[k].recon_ok)};
  }
  // UC04.4: only runs on the same base, policy and scenario set are compared; otherwise the comparison is refused.
  function compare(runs){
    if(runs.length<2)return {ok:false,reason:'Pick at least two runs'};
    const sig=r=>[r.meta.snapshot_id,r.meta.source_uc01_run,r.meta.source_uc02_run,r.meta.config_version,Math.round(r.meta.reserves.L),Math.round(r.meta.reserves.Z),Math.round(r.meta.reserves.H),r.meta.scenario_set.join(',')].join('|');
    const s0=sig(runs[0]),diff=runs.filter(r=>sig(r)!==s0);
    if(diff.length)return {ok:false,reason:'different_base',detail:diff.map(r=>r.sim_run_id),message:'These runs use a different base, policy or scenario set. Run them again on the same base before comparing.'};
    return {ok:true,rows:runs.map(r=>{const b=r.results.base;return {sim_run_id:r.sim_run_id,label:r.label,min:b.after.min,floor_peak:b.after.floor_peak,target_peak:b.after.target_peak,
      gap_days:b.after.floor_days,worse_days:b.worse_days,tail:b.tail_obligations,cost:b.costs.cash,book:b.costs.book_shortfall,conclusion:r.conclusion,scope:r.scope}})};
  }
  return {VERSIONS,PRIORITY,MATRIX,SIMULATED,SCEN_KEYS,thOf,cellOf,dayFlag,prepInput,gapStats,catalogueOf,catalogueState,CATALOGUE_META,buildSources,match,surplus,prefill,
    validate,simulate,compare,conclusionOf,AP_EXT_DAYS};
})();
