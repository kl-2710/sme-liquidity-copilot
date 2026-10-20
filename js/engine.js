/* Deterministic UC01/UC02 engine (SRS v1.3). Pure functions: no DOM, no network, no language model.
   The sample companies (DATA.raw) and uploaded files go through the same normalisation and the same rules (BR-02.18).
   Money is VND; dates are ISO strings (YYYY-MM-DD) or day numbers (days since 1970-01-01, UTC). */
const ENGINE=(()=>{
  const DAYMS=864e5;
  const dnum=s=>{const [y,m,d]=String(s).slice(0,10).split('-').map(Number);return Date.UTC(y,m-1,d)/DAYMS};
  const diso=n=>new Date(n*DAYMS).toISOString().slice(0,10);
  const sum=(a,f=x=>x)=>a.reduce((s,x)=>s+f(x),0);
  const round=(v,d=0)=>{const p=10**d;return Math.round(v*p)/p};
  const normName=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0111/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
  // Upload alias keywords (js/config.js), without accents, as a regex alternation: kw('lot','NVL') → 'nguyen|phu lieu|…'.
  const kw=(kind,canon)=>UPLOAD_ALIASES.filter(a=>a[2]===kind&&(canon==null||a[1]===canon)).map(a=>normName(a[0])).join('|');
  const aliasWords=canon=>UPLOAD_ALIASES.filter(a=>a[2]==='val'&&a[1]===canon).map(a=>normName(a[0]));
  // FNV-1a: deterministic ids (snapshot, run) so the same inputs always give the same id.
  const hash=s=>{let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36).toUpperCase()};
  // SRS-DECISION: threshold comparisons on unrounded values use a relative tolerance of 1e-9 so binary rounding cannot flip exact decimal boundaries
  // (5.00 % materiality is W2, T07; DSO equal to the watch threshold gives no signal, T08).
  const EPS=1e-9,tol=b=>EPS*Math.max(1,Math.abs(b)),GT=(a,b)=>a>b+tol(b),GE=(a,b)=>a>=b-tol(b),LT=(a,b)=>a<b-tol(b);
  const tri=v=>{const s=normName(v);return ['1','true','yes','y',...aliasWords('yes')].includes(s)?'yes':['0','false','no','n',...aliasWords('no')].includes(s)?'no':'unknown'};

  /* ---------- Inventory hints (suggestions only, never applied without confirmation) ---------- */
  // inventory_type inferred from the lot name when the file has no inventory_type column (provisional, Table 2-43).
  function inferLotType(name){
    const n=normName(name);
    if(new RegExp('work in progress|\\bwip\\b|semi.?finished|on the line|'+kw('lot','BTP')).test(n))return 'BTP';
    if(new RegExp('finished|carton|awaiting shipment|'+kw('lot','TP')).test(n))return 'TP';
    if(new RegExp('for resale|trading goods|merchandise|'+kw('lot','HH')).test(n))return 'HH';
    if(new RegExp('fabric|trim|thread|button|zipper|label|yarn|paper|ink|glue|material|'+kw('lot','NVL')).test(n))return 'NVL';
    return null;
  }
  const customerOwnedHint=name=>new RegExp('subcontract|customer.?owned|consign|supplied by|held for|'+kw('owner')).test(normName(name));
  const cancelledHint=name=>new RegExp('\\b('+kw('cancel')+')\\b|cancel').test(normName(name));

  /* ---------- Snapshot normalisation ---------- */
  // Financial rows: [{period_start, period_end, days, revenue, cogs, opening_cash, current_assets, st_investments}].
  function rowDays(r){if(r.period_start&&r.period_end)return dnum(r.period_end)-dnum(r.period_start)+1;return r.days>0?r.days:null}
  function resolveFinancials(rows,asOf,start,N,sales){
    const out={issues:[]},A=dnum(asOf),S=dnum(start),same=r=>r.period_start&&r.period_end&&dnum(r.period_start)===S&&dnum(r.period_end)===A;
    const revRow=rows.find(r=>same(r)&&r.revenue!=null);
    if(revRow){out.revenue=revRow.revenue;out.revenue_src='financials'}
    else if(sales){out.revenue=sum(sales.filter(s=>s.issue&&dnum(s.issue)>=S&&dnum(s.issue)<=A),s=>s.amount);out.revenue_src='sales_invoices';
      out.issues.push({code:'REVENUE_FROM_INVOICES',severity:'info'})}
    else{out.revenue=null;out.revenue_src='missing'}
    const cogsSame=rows.find(r=>same(r)&&r.cogs!=null);
    if(cogsSame){out.cogs=cogsSame.cogs;out.cogs_src='financials';out.cogs_days=N}
    else{const r=rows.find(x=>x.cogs!=null&&rowDays(x));
      if(r){const d=rowDays(r);out.cogs=r.cogs/d*N;out.cogs_src='converted';out.cogs_days=d;out.cogs_raw=r.cogs;
        out.issues.push({code:'COGS_CONVERTED',severity:'provisional',days:d})}
      else{out.cogs=null;out.cogs_src='missing'}}
    const atCut=rows.filter(r=>(r.period_end?dnum(r.period_end)===A:true));
    const cashRow=atCut.find(r=>r.opening_cash!=null);
    out.opening_cash=cashRow?cashRow.opening_cash:null;
    const ca=atCut.find(r=>r.current_assets!=null);out.current_assets=ca?ca.current_assets:null;
    const sti=atCut.find(r=>r.st_investments!=null);out.st_investments=sti?sti.st_investments:0;
    return out;
  }
  // Cuts the raw tables at as_of and computes per-invoice and per-lot fields used by every rule.
  // input: {firm, source, snapshot_id, as_of (data cut-off), fin:[...], sales:[{id,customer,tax_code,amount,issue,due,paid,paid_amount,status}],
  //         purchases:[{...,supplier,disc_pct,disc_days,essential}], inventory:[{name,type,qty,unit_cost,days,owner,cancelled,pledged,supplier}],
  //         planned:[{id,date,week,direction,category,amount,certainty,source_id}], config:{amount_basis,vat_rate}, tables:{sales:bool,...}}
  function makeSnapshot(input,{asOf,periodStart}={}){
    const dataAsOf=input.as_of,cut=asOf||dataAsOf,A=dnum(cut),shift=dnum(dataAsOf)-A;
    // SRS-DECISION: the default period is that of the financial statements ending at the cut-off (the data's own N); otherwise as_of − 182.
    const own=cut===dataAsOf?(input.fin||[]).filter(r=>r.revenue!=null&&r.period_end===cut&&rowDays(r)).sort((a,b)=>rowDays(b)-rowDays(a))[0]:null;
    const start=periodStart||(own?diso(A-rowDays(own)+1):diso(A-182)),N=A-dnum(start)+1,issues=[];
    if(N<=0)throw new Error('INVALID_PERIOD');
    const party=(name,tax)=>{const t=String(tax||'').replace(/\D/g,'');return t?{key:'TAX:'+t,weak:false}:{key:'NAME:'+normName(name),weak:true}};
    const inv=(r,kind)=>{
      if(r.status&&/cancel|void|huy/i.test(r.status))return null;          // cancelled invoices are excluded
      if(r.issue&&dnum(r.issue)>A)return null;                                // issued after the cut-off
      const paidAt=r.paid&&dnum(r.paid)<=A,paidAmt=paidAt?(r.paid_amount!=null?r.paid_amount:r.amount):0;
      let open=r.amount-paidAmt,advance=0;if(open<0){advance=-open;open=0}     // overpayment is an advance, not a negative receivable
      const due=r.due||null,issue=r.issue||null,dpd=open>0&&due?Math.max(0,A-dnum(due)):null;
      // SRS-DECISION: a term shorter than one day (due = issue) counts as one day in ρ = overdue days ÷ term.
      let term=due&&issue?dnum(due)-dnum(issue):null,termAssumed=false;
      if(term==null&&due){term=CFG.ar.termFallbackDays;termAssumed=true}       // invoice without issue date: fallback term, flagged
      const p=party(kind==='sale'?r.customer:r.supplier,r.tax_code);
      return {...r,issue,due,key:p.key,key_weak:p.weak,paid_amount_asof:paidAmt,open_amount:open,advance,open:open>0,
        fully_paid:paidAt&&paidAmt>=r.amount,dpd,term,term_assumed:termAssumed,rho:dpd!=null&&term!=null?dpd/Math.max(1,term):null,missing_due:!due,
        in_period:!!issue&&dnum(issue)>=dnum(start)&&dnum(issue)<=A};
    };
    const sales=input.tables.sales?input.sales.map(r=>inv(r,'sale')).filter(Boolean):null;
    const purchases=input.tables.purchases?input.purchases.map(r=>inv(r,'purchase')).filter(Boolean):null;
    const essential=new Set((input.firm.essential_suppliers||[]).map(normName)),notEssential=new Set((input.firm.non_essential_suppliers||[]).map(normName));
    if(purchases)purchases.forEach(p=>{if(p.essential!=='yes'&&p.essential!=='no')p.essential=essential.has(normName(p.supplier))?'yes':notEssential.has(normName(p.supplier))?'no':'unknown'});
    const lots=input.tables.inventory?input.inventory.map(x=>{
      const age=x.days==null?null:x.days-shift;if(age!=null&&age<0)return null;  // lot not yet in stock at an earlier cut-off
      const declaredType=x.type&&/^(NVL|BTP|TP|HH|HGC)$/i.test(x.type)?x.type.toUpperCase():null;
      const type=declaredType||inferLotType(x.name);
      const owner=x.owner==='customer'||declaredType==='HGC'?'customer':x.owner==='own'?'own':'unknown';
      const value=x.qty*x.unit_cost,isHGC=owner==='customer';
      return {...x,days:age,type:isHGC?'HGC':type,type_src:declaredType?'declared':type?'inferred':'missing',owner,
        value,value_own:isHGC?0:value,cancelled:x.cancelled||'unknown',pledged:x.pledged||'unknown',
        cancel_proposed:x.cancelled!=='yes'&&cancelledHint(x.name),hgc_proposed:!isHGC&&owner!=='customer'&&customerOwnedHint(x.name)};
    }).filter(Boolean):null;
    const fin=resolveFinancials(input.fin||[],cut,start,N,sales);issues.push(...fin.issues);
    if(sales&&sales.some(s=>s.open&&s.missing_due))issues.push({code:'AR_MISSING_DUE',severity:'provisional',amount:sum(sales.filter(s=>s.open&&s.missing_due),s=>s.open_amount)});
    if(sales&&sales.some(s=>s.advance>0))issues.push({code:'AR_ADVANCE',severity:'info',amount:sum(sales,s=>s.advance)});
    if(lots&&lots.some(l=>l.type_src!=='declared'&&l.owner!=='customer'))issues.push({code:'INV_TYPE_INFERRED',severity:'provisional'});
    if(lots&&lots.some(l=>l.owner==='unknown'))issues.push({code:'INV_OWNER_UNKNOWN',severity:'provisional'});
    if(sales&&sales.some(s=>s.term_assumed))issues.push({code:'AR_TERM_ASSUMED',severity:'provisional'});
    const sid=cut===dataAsOf&&!periodStart?input.snapshot_id:`${input.snapshot_id}@${cut}/${N}d`;
    // Daily cash history up to the cut-off (Miller–Orr σ); never shifted into the forecast.
    const history=(input.history||[]).filter(h=>dnum(h.date)<=A);
    return {firm:input.firm,source:input.source,snapshot_id:sid,data_snapshot_id:input.snapshot_id,data_as_of:dataAsOf,
      as_of:cut,period_start:start,N,fin,sales,purchases,lots,planned:input.planned||[],history,config:input.config||{amount_basis:'net',vat_rate:null},
      tables:input.tables,issues,shifted:shift!==0};
  }
  // DATA.raw sample record → engine input.
  function inputFromRaw(raw,loadedAt){
    return {firm:raw.firm,snapshot_id:raw.snapshot.id,as_of:raw.snapshot.as_of,source:{type:'sample',id:raw.snapshot.source,at:loadedAt},
      fin:raw.fin,config:raw.config,tables:{sales:true,purchases:true,inventory:true,planned:true},
      sales:raw.sales.map(([id,customer,amount,issue,due,paid,confirmed,status])=>({id,customer,amount,issue,due,paid,paid_amount:null,tax_code:null,confirmed_date:confirmed||null,status:status||null})),
      purchases:raw.purchases.map(([id,supplier,amount,issue,due,paid,disc_pct,disc_days])=>({id,supplier,amount,issue,due,paid,paid_amount:null,disc_pct,disc_days,tax_code:null,essential:null})),
      inventory:raw.inventory.map(([name,type,qty,unit_cost,days,owner,cancelled,pledged,lot_id,order_id,order_status])=>({name,type,qty,unit_cost,days,owner,cancelled,pledged,lot_id:lot_id||null,order_id:order_id||null,order_status:order_status||null})),
      history:(raw.history||[]).map(([date,net])=>({date,net})),
      planned:raw.planned.map(([id,date,direction,category,amount,certainty,source_id])=>({id,date,week:null,direction,category,amount,certainty,source_id}))};
  }
  // Uploaded company (app data store) → engine input. Missing tables stay missing (never zero-filled).
  function inputFromUpload(f,snap){
    const T=snap.tables,f0=(T.fin||[])[0]||{},has=k=>Array.isArray(T[k])&&T[k].length>0;
    const days=f0.days||null,end=f0.period_end||snap.asOf,start=f0.period_start||(days?diso(dnum(end)-days+1):null);
    const fin=[{period_start:start,period_end:end,days,revenue:f0.rev??null,cogs:f0.cogs??null,
      opening_cash:f0.cash0!=null?f0.cash0:(f0.opening??null),current_assets:f0.current_assets??null,st_investments:f0.st_investments??null}];
    return {firm:{id:f.id,name:f.name,industry:f.industry||'',position:f.position||null,business_model:f.business_model||null,
        rtarget:f.buffer>0?f.buffer:null,essential_suppliers:f.essential_suppliers||[],strategic_customers:f.strategic_customers||[]},
      snapshot_id:`SNP-${f.id}-${snap.asOf.replace(/-/g,'')}-${snap.id}`,as_of:snap.asOf,
      source:{type:'upload',id:'upload:'+(snap.files&&snap.files.length?snap.files.join(', '):snap.label||snap.id),at:new Date(snap.ts).toISOString()},
      fin,config:{amount_basis:snap.amount_basis||'net',vat_rate:snap.vat_rate??null},
      tables:{sales:has('sales'),purchases:has('purchases'),inventory:has('inventory'),planned:has('planned')},
      sales:(T.sales||[]).map(r=>({id:r.id,customer:r.buyer,amount:r.amt,issue:r.issue||null,due:r.due||null,paid:r.paid||null,paid_amount:r.paid_amount??null,tax_code:r.tax_code||null,status:r.status||null})),
      purchases:(T.purchases||[]).map(r=>({id:r.id,supplier:r.supplier,amount:r.amt,issue:r.issue||null,due:r.due||null,paid:r.paid||null,paid_amount:r.paid_amount??null,
        disc_pct:r.disc_pct||0,disc_days:r.disc_days||0,tax_code:r.tax_code||null,essential:r.essential?tri(r.essential):null,status:r.status||null})),
      inventory:(T.inventory||[]).map(r=>({name:r.name,type:r.inventory_type||null,qty:r.qty,unit_cost:r.unit,days:r.days,
        owner:r.owner==='customer'?'customer':r.owner==='own'?'own':(r.owner?'unknown':null),cancelled:r.cancelled?tri(r.cancelled):'unknown',pledged:r.pledged?tri(r.pledged):'unknown',supplier:r.supplier_id||null})),
      planned:(T.planned||[]).map((r,i)=>({id:r.id||('PF-'+(r.week||'x')+'-'+(i+1)),date:r.date||null,week:r.week||null,direction:r.type==='in'?'IN':'OUT',
        category:r.cat,amount:r.amt,certainty:r.certainty||'estimated',source_id:r.source_id||null}))};
  }

  /* ---------- UC01 · customer tier (Table 2-40), needed for the cause breakdown ---------- */
  // Relationship (Table 2-38): new ≤ cl.newDays of relationship; regular ≥ cl.regularMinInvoices invoices in the period and
  // ≥ cl.regularMinMonths active months; otherwise occasional. Size by revenue share; the ±band applies only when a previous label exists.
  // SRS-DECISION: the ±band applies only against the label of a previous snapshot; the first snapshot uses the plain thresholds.
  function sizeLabel(share,prev){
    const {largeShare:L,smallShare:S,bandSharePP:B}=CFG.cl;
    if(prev==='large'&&share>=L-B)return 'large';if(prev!=='large'&&prev&&share>=L+B)return 'large';if(!prev&&share>=L)return 'large';
    if(prev==='small'&&share<S+B)return 'small';if(prev!=='small'&&prev&&share<S-B)return 'small';if(!prev&&share<S)return 'small';
    return 'medium';
  }
  function relationLabel(relDays,nInv,months){
    if(relDays<=CFG.cl.newDays)return 'new';
    if(nInv>=CFG.cl.regularMinInvoices&&months>=CFG.cl.regularMinMonths)return 'regular';
    return 'occasional';
  }
  // Tier: 5 strategic (declared yes) → 1 new → 2 occasional or small → 4 large → 3 otherwise (A42).
  function customerTier(rel,size,strategic){
    if(strategic==='yes')return 5;if(rel==='new')return 1;if(rel==='occasional'||size==='small')return 2;if(size==='large')return 4;return 3;
  }
  function customerBase(snap,prevLabels={}){
    const A=dnum(snap.as_of),S0=dnum(snap.period_start),sales=snap.sales||[],rev=snap.fin.revenue,arTot=sum(sales,s=>s.open_amount);
    const strategic=new Set((snap.firm.strategic_customers||[]).map(normName)),groups=new Map();
    sales.forEach(s=>{if(!groups.has(s.key))groups.set(s.key,[]);groups.get(s.key).push(s)});
    return [...groups.entries()].map(([key,rows])=>{
      const name=rows[0].customer,inPer=rows.filter(r=>r.in_period),revK=sum(inPer,r=>r.amount),share=rev>0?revK/rev:0;
      const first=Math.min(...rows.map(r=>r.issue?dnum(r.issue):A)),relDays=A-first,months=new Set(inPer.map(r=>r.issue.slice(0,7))).size;
      const rel=relationLabel(relDays,inPer.length,months),size=sizeLabel(share,(prevLabels[key]||{}).size),strat=strategic.has(normName(name))?'yes':'unknown';
      const open=rows.filter(r=>r.open),ar=sum(open,r=>r.open_amount),od=open.filter(r=>r.due&&dnum(r.due)<A);
      return {key,name,key_weak:rows[0].key_weak,rows,revenue:revK,revenue_share:share,ar,ar_share:arTot>0?ar/arTot:0,overdue:sum(od,r=>r.open_amount),
        max_overdue:Math.max(0,...od.map(r=>r.dpd||0)),rel_days:relDays,invoices_in_period:inPer.length,active_months:months,
        relationship:rel,size,strategic:strat,tier:customerTier(rel,size,strat),new_large:rel==='new'&&size==='large'};
    });
  }

  /* ---------- UC01 · cause breakdown of E_AR and E_INV (section 2.7.10.7, Table 2-47) ---------- */
  // SRS-DECISION: sources (1)–(3) take the overdue balance of invoices that carry R-AR-OD, grouped by the customer's tier, so the
  // parts can never exceed E_AR = MAX(aggregate excess; Σ R-AR-OD overdue); (4) is the unassigned remainder. Sources (5)/(6) take the
  // slow lots (R-INV-SLOW) split by cancelled status (confirmed or proposed by the name); (7) is the unassigned remainder of E_INV.
  function decompose({E_AR,E_INV,arFlagged,slowLots}){
    const p=[0,0,0,0,0,0,0,0];
    // DECISION (workbook v9): E_AR / E_INV are the threshold excesses (T1-87/88); flagged invoices and slow lots are details that can
    // exceed them, so their sources are scaled pro rata to fit inside E (the parts still add up to MoneyAtRisk).
    const fAR=sum(arFlagged,x=>x.amount),fINV=sum(slowLots,x=>x.amount),kAR=fAR>E_AR&&fAR>0?E_AR/fAR:1,kINV=fINV>E_INV&&fINV>0?E_INV/fINV:1;
    arFlagged.forEach(x=>{p[x.tier>=4?1:x.tier<=2?2:3]+=x.amount*kAR});
    slowLots.forEach(x=>{p[x.cancelled?6:5]+=x.amount*kINV});
    p[4]=E_AR-(p[1]+p[2]+p[3]);p[7]=E_INV-(p[5]+p[6]);
    const parts=[1,2,3,4,5,6,7].map(i=>({source:i,amount:p[i],item:i<=4?'AR':'INV',unassigned:i===4||i===7}));
    const okAR=Math.abs(p[1]+p[2]+p[3]+p[4]-E_AR)<=CFG.tv2.tolerance&&p[4]>=-CFG.tv2.tolerance,okINV=Math.abs(p[5]+p[6]+p[7]-E_INV)<=CFG.tv2.tolerance&&p[7]>=-CFG.tv2.tolerance;
    const total=E_AR+E_INV,named=parts.filter(x=>!x.unassigned&&x.amount>0).sort((a,b)=>b.amount-a.amount||a.source-b.source);
    const free=parts.filter(x=>x.unassigned&&x.amount>0).sort((a,b)=>b.amount-a.amount);
    let main=named[0]||null;if(free[0]&&(!main||free[0].amount>main.amount))main=free[0];   // "unassigned" wins only when larger than every named source
    return {parts,total,ok:okAR&&okINV,main_cause_detail:main&&total>0?{...main,share:main.amount/total}:null};
  }

  /* ---------- UC01 · W axis, bottleneck pattern and hand-off (sections 2.7.6–2.7.9, 2.7.11, Appendix A) ---------- */
  function modelOf(snap,policy){
    const pm=policy&&policy.business_model;
    if(pm==='CMT'||pm==='FOB')return {model:pm,declared:true,src:'owner_policy'};
    if(pm!=='undeclared'&&snap.firm.business_model)return {model:snap.firm.business_model,declared:true,src:'firm_profile'};
    // SRS-DECISION: an undeclared model uses the FOB defaults (Table 2-23, E3) and is labelled "not confirmed"; W is not set to unknown.
    return {model:CFG.wc.defaultModel,declared:false,src:'demo_assumption'};
  }
  function diagnose(snap,policy={}){
    const M=modelOf(snap,policy),T=CFG.wc.thr[M.model],N=snap.N,f=snap.fin,mat=policy.materiality??CFG.wc.materiality;
    const sales=snap.sales,pur=snap.purchases,lots=snap.lots,A=dnum(snap.as_of);
    const AR=sales?sum(sales,s=>s.open_amount):null,INV=lots?sum(lots,l=>l.value_own):null,AP=pur?sum(pur,p=>p.open_amount):null;
    const rev=f.revenue,cogs=f.cogs;
    // Days metrics as AR × N ÷ revenue (exact for integer inputs at the threshold boundaries, T08). Denominator 0 → not applicable (E2, T14).
    const dso=AR!=null&&rev>0?AR*N/rev:null,dio=INV!=null&&cogs>0?INV*N/cogs:null,dpo=AP!=null&&cogs>0?AP*N/cogs:null;
    const ccc=dso!=null&&dio!=null&&dpo!=null?dso+dio-dpo:null,twc=AR!=null&&INV!=null&&AP!=null?AR+INV-AP:null;
    const cash=f.opening_cash;
    const ca=f.current_assets!=null?{value:f.current_assets,src:'financials'}:cash!=null&&AR!=null&&INV!=null?{value:cash+AR+INV,src:'assumed'}:{value:null,src:'missing'};
    const annualRev=rev>0?rev*365/N:null,cashBuffer=cash!=null&&annualRev?(cash+(f.st_investments||0))/annualRev:null;
    const missing=[];if(rev==null)missing.push('revenue');if(cogs==null)missing.push('cogs');if(ca.value==null)missing.push('current_assets');
    if(AR==null)missing.push('receivables');if(INV==null)missing.push('inventory');if(AP==null)missing.push('payables');
    // SRS-DECISION: revenue or COGS of 0 is treated as an inactive business (Table 2-32 row 1): W = unknown; DSO/DIO/DPO show 'not applicable'.
    const inactive=(rev!=null&&rev<=0)||(cogs!=null&&cogs<=0);
    // Aggregate signals (strictly greater than the threshold, T08).
    const lvl=(v,t)=>v==null?0:GT(v,t.severe)?2:GT(v,t.watch)?1:0;
    const aAR=lvl(dso,T.dso),aINV=lvl(dio,T.dio);
    // Invoice level R-AR-OD: ρ = overdue days ÷ the invoice's own term (A12). Invoices without a due date never signal (T13).
    const arOD=(sales||[]).filter(s=>s.open&&s.dpd>0&&s.rho!=null&&GT(s.rho,CFG.ar.rhoWatch)).map(s=>({inv:s,level:GT(s.rho,CFG.ar.rhoSevere)?2:1}));
    // Lot level R-INV-SLOW by type (NVL/HH > 60 days, BTP/TP > 30 days); severe at twice the watch age or a confirmed cancelled order.
    const slow=(lots||[]).filter(l=>l.owner!=='customer').map(l=>{
      const thr=CFG.inv.slowDays[l.type]||CFG.inv.unknownTypeSlowDays,aged=l.days!=null&&l.days>thr,cancelled=l.cancelled==='yes';
      // SRS-DECISION: a cancelled order proposed from the lot name (not yet confirmed) is not a severe signal; a slow lot with that proposal goes to source (6).
      if(!aged&&!cancelled)return null;
      return {lot:l,thr,over:l.days!=null?l.days-thr:null,level:cancelled||(l.days!=null&&l.days>2*thr)?2:1,cancelled:cancelled||l.cancel_proposed,cancel_confirmed:cancelled};
    }).filter(Boolean);
    // Purchase level R-AP-OD: ρ > 0.5 is a watch signal; any overdue amount to an essential supplier is severe.
    const apOD=(pur||[]).filter(p=>p.open&&p.dpd>0&&((p.rho!=null&&GT(p.rho,CFG.ap.rhoWatch))||p.essential==='yes')).map(p=>({inv:p,level:p.essential==='yes'?2:1}));
    const ap1=dpo!=null&&cashBuffer!=null&&LT(dpo,T.dpo.low)&&LT(cashBuffer,T.bufThin);     // R-AP-1
    const apInfo=dpo!=null&&GT(dpo,T.dpo.high);                                            // R-AP-INFO: note only, never a signal (T09)
    // Capital above threshold (workbook v9, T1-87/88/91): ExcessAR = MAX(0; DSO − DSOWatch) × Rev ÷ N, ExcessINV = MAX(0; DIO − DIOWatch) × COGS ÷ N,
    // MoneyAtRisk = ExcessAR + ExcessINV. Overdue invoices, slow lots and overdue payables are details: they are listed but do not raise
    // the signals or W ("chi tiet qua han khong tu nang W"). E_AP is the overdue payables total (T1-55), a reference only.
    const aggAR=aAR?(dso-T.dso.watch)*rev/N:0,odAR=sum(arOD,x=>x.inv.open_amount);
    const aggINV=aINV?(dio-T.dio.watch)*cogs/N:0,slowV=sum(slow,x=>x.lot.value_own);
    const E_AR=aggAR,E_INV=aggINV,E_AP=sum((pur||[]).filter(p=>p.open&&p.dpd>0),p=>p.open_amount);
    const caV=ca.value,shareW=caV>0?Math.max(E_AR,E_INV)/caV:null;
    // W (T1-90): W2 when a level is severe (wc.severe_forces_w2) or a level ≥ 1 with MaterialityRatio ≥ 5 %; W1 for any AR/INV level or the AP signal.
    const lvW=(a)=>!a?0:a===2||(shareW!=null&&GE(shareW,mat))?2:1;
    const c={AR:lvW(aAR),INV:lvW(aINV),AP:ap1?1:0};
    const shape=(agg,det)=>agg&&det?'HL':agg?'H':det?'L':'';
    const status=(v,t)=>v==null?'n/a':GT(v,t.severe)?'severe':GT(v,t.watch)?'watch':'normal';
    const near=(k,v,w)=>c[k]===0&&v!=null&&GE(v,CFG.bn.nearThresholdRatio*w);
    const covProv={AR:snap.issues.some(i=>['AR_MISSING_DUE','AR_TERM_ASSUMED'].includes(i.code)),INV:snap.issues.some(i=>['INV_TYPE_INFERRED','INV_OWNER_UNKNOWN'].includes(i.code)),cogs:f.cogs_src==='converted'};
    const item_states=[
      {item:'AR',c:c.AR,E:E_AR,shape:shape(aAR,arOD.length),metric:'DSO',value:dso,ref:T.dso.ref,watch:T.dso.watch,severe:T.dso.severe,status:status(dso,T.dso),
        headroom:dso!=null?T.dso.watch-dso:null,near_threshold:near('AR',dso,T.dso.watch),balance:AR,provisional:covProv.AR},
      {item:'INV',c:c.INV,E:E_INV,shape:shape(aINV,slow.length),metric:'DIO',value:dio,ref:T.dio.ref,watch:T.dio.watch,severe:T.dio.severe,status:status(dio,T.dio),
        headroom:dio!=null?T.dio.watch-dio:null,near_threshold:near('INV',dio,T.dio.watch),balance:INV,provisional:covProv.INV||covProv.cogs},
      {item:'AP',c:c.AP,E:E_AP,shape:shape(ap1,apOD.length),metric:'DPO',value:dpo,low:T.dpo.low,high:T.dpo.high,status:dpo==null?'n/a':ap1?'watch':apOD.some(x=>x.level===2)?'severe':apOD.length?'watch':'normal',
        headroom:null,near_threshold:false,balance:AP,provisional:covProv.cogs,info_high:apInfo}];
    const order=CFG.bn.rankOrder,cause=item_states.filter(i=>i.c>=1).sort((a,b)=>b.c-a.c||b.E-a.E||order.indexOf(a.item)-order.indexOf(b.item));
    const unknown=missing.length>0||inactive;
    const set=new Set(cause.map(i=>i.item));
    const bn=unknown?'unknown':!set.size?'BN0':set.size===3?'BN7':set.has('AR')&&set.has('INV')?'BN4':set.has('AR')&&set.has('AP')?'BN5':set.has('INV')&&set.has('AP')?'BN6':set.has('AR')?'BN1':set.has('INV')?'BN2':'BN3';
    const share=shareW;
    const w=unknown?'unknown':cause.some(i=>i.c===2)?'W2':cause.length?'W1':'W0';
    const rule_ids=[];if(aAR)rule_ids.push(aAR===2?'R-AR-2':'R-AR-1');if(arOD.length)rule_ids.push('R-AR-OD');if(aINV)rule_ids.push(aINV===2?'R-INV-2':'R-INV-1');
    if(slow.length)rule_ids.push('R-INV-SLOW');if(ap1)rule_ids.push('R-AP-1');if(apOD.length)rule_ids.push('R-AP-OD');if(cause.length&&share!=null&&GE(share,mat))rule_ids.push('R-MAT');
    // Customers and tiers (needed by the breakdown); the full profiles come from profiles() below.
    const custs=sales?customerBase(snap,policy.prevLabels):[],tierOf=new Map(custs.map(x=>[x.key,x.tier]));
    // Findings by object (section 2.7.9 a); BN0 → empty list.
    const findings=[],thrSrc=M.src==='owner_policy'?'owner_policy':'verified_reference';
    if(aAR)findings.push({id:'F-AR-AGG',item:'AR',object:{type:'firm',name:snap.firm.name},metric:'DSO',value:dso,threshold:aAR===2?T.dso.severe:T.dso.watch,deviation:dso-T.dso.watch,
      amount:aggAR,days:null,rule_id:aAR===2?'R-AR-2':'R-AR-1',level:aAR,threshold_source:thrSrc,evidence_id:'EV-AR-AGG',data_status:covProv.AR?'provisional':'ok',direction:'review_credit_terms'});
    const byCust=new Map();arOD.forEach(x=>{const k=x.inv.key;if(!byCust.has(k))byCust.set(k,[]);byCust.get(k).push(x)});
    [...byCust.entries()].sort((a,b)=>sum(b[1],x=>x.inv.open_amount)-sum(a[1],x=>x.inv.open_amount)).forEach(([k,xs],i)=>{
      const rho=Math.max(...xs.map(x=>x.inv.rho)),lv=Math.max(...xs.map(x=>x.level));
      findings.push({id:'F-AR-'+(i+1),item:'AR',object:{type:'customer',key:k,name:xs[0].inv.customer},metric:'rho',value:rho,threshold:lv===2?CFG.ar.rhoSevere:CFG.ar.rhoWatch,deviation:rho-CFG.ar.rhoWatch,
        amount:sum(xs,x=>x.inv.open_amount),days:Math.max(...xs.map(x=>x.inv.dpd)),rule_id:'R-AR-OD',level:lv,threshold_source:'demo_assumption',evidence_id:'EV-AR-'+(i+1),
        invoice_ids:xs.map(x=>x.inv.id),data_status:'ok',direction:'reconcile_receivables'})});
    if(aINV)findings.push({id:'F-INV-AGG',item:'INV',object:{type:'firm',name:snap.firm.name},metric:'DIO',value:dio,threshold:aINV===2?T.dio.severe:T.dio.watch,deviation:dio-T.dio.watch,
      amount:aggINV,days:null,rule_id:aINV===2?'R-INV-2':'R-INV-1',level:aINV,threshold_source:thrSrc,evidence_id:'EV-INV-AGG',data_status:covProv.INV||covProv.cogs?'provisional':'ok',direction:'review_stock_levels'});
    slow.slice().sort((a,b)=>b.lot.value_own-a.lot.value_own).forEach((x,i)=>findings.push({id:'F-INV-'+(i+1),item:'INV',object:{type:'lot',name:x.lot.name},metric:'lot_age',value:x.lot.days,threshold:x.thr,
      deviation:x.over,amount:x.lot.value_own,days:x.lot.days,rule_id:'R-INV-SLOW',level:x.level,threshold_source:'demo_assumption',evidence_id:'EV-INV-'+(i+1),
      data_status:x.lot.type_src==='declared'?'ok':'provisional',direction:x.cancelled?'review_cancelled_order_stock':'review_slow_stock'}));
    const bySup=new Map();apOD.forEach(x=>{const k=x.inv.key;if(!bySup.has(k))bySup.set(k,[]);bySup.get(k).push(x)});
    [...bySup.entries()].sort((a,b)=>sum(b[1],x=>x.inv.open_amount)-sum(a[1],x=>x.inv.open_amount)).forEach(([k,xs],i)=>{
      const lv=Math.max(...xs.map(x=>x.level)),rho=Math.max(...xs.map(x=>x.inv.rho||0));
      findings.push({id:'F-AP-'+(i+1),item:'AP',object:{type:'supplier',key:k,name:xs[0].inv.supplier},metric:lv===2?'essential_overdue':'rho',value:rho,threshold:CFG.ap.rhoWatch,deviation:rho-CFG.ap.rhoWatch,
        amount:sum(xs,x=>x.inv.open_amount),days:Math.max(...xs.map(x=>x.inv.dpd)),rule_id:'R-AP-OD',level:lv,threshold_source:'demo_assumption',evidence_id:'EV-AP-'+(i+1),
        invoice_ids:xs.map(x=>x.inv.id),essential:xs[0].inv.essential,data_status:'ok',direction:lv===2?'pay_essential_supplier_on_time':'agree_payment_schedule'})});
    if(ap1)findings.push({id:'F-AP-AGG',item:'AP',object:{type:'firm',name:snap.firm.name},metric:'DPO',value:dpo,threshold:T.dpo.low,deviation:dpo-T.dpo.low,amount:null,days:null,
      rule_id:'R-AP-1',level:1,threshold_source:thrSrc,evidence_id:'EV-AP-AGG',data_status:'ok',direction:'review_payment_speed',cash_buffer:cashBuffer});
    const final=unknown?[]:(bn==='BN0'?[]:findings);
    // Concentration (A36): one customer ≥ bn.concentration_share of E_AR. SRS-DECISION: when E_AR comes from flagged invoices the share
    // uses each customer's flagged overdue; when E_AR is the aggregate excess it is allocated in proportion to open receivables.
    let concentration=null;
    if(E_AR>0&&custs.length){const fromDetail=odAR>=aggAR&&odAR>0;
      const shares=custs.map(x=>({key:x.key,name:x.name,share:fromDetail?sum(arOD.filter(y=>y.inv.key===x.key),y=>y.inv.open_amount)/E_AR:x.ar_share})).sort((a,b)=>b.share-a.share);
      concentration={flag:shares[0].share>=CFG.bn.concentrationShare?'concentrated':'dispersed',top:shares[0],basis:fromDetail?'flagged_overdue':'open_receivables_pro_rata'}}
    const dec=decompose({E_AR,E_INV,arFlagged:arOD.map(x=>({amount:x.inv.open_amount,tier:tierOf.get(x.inv.key)||3})),slowLots:slow.map(x=>({amount:x.lot.value_own,cancelled:x.cancelled}))});
    const provisional=[];if(!M.declared)provisional.push('MODEL_NOT_DECLARED');if(covProv.cogs)provisional.push('COGS_CONVERTED');if(ca.src==='assumed')provisional.push('CURRENT_ASSETS_ASSUMED');
    if(covProv.INV)provisional.push('INVENTORY_PROVISIONAL');if(covProv.AR)provisional.push('RECEIVABLES_PROVISIONAL');if(cash==null)provisional.push('CASH_MISSING');
    const policyVersion=policy.version_id||'CFG-default';
    const run_id='RUN-UC01-'+hash([snap.snapshot_id,CFG.versions.formula,CFG.versions.threshold,policyVersion,M.model,mat].join('|'));
    const result={wc_class:w,rule_ids,info_rules:apInfo?['R-AP-INFO']:[],main_bottleneck:unknown||!cause.length?null:cause[0].item,
      money_at_risk:unknown?0:E_AR+E_INV,obligation_overdue:unknown?0:E_AP,bn_pattern:bn,cause_items:unknown?[]:cause.map(i=>i.item),
      item_states,materiality_share:share,materiality:mat,findings:final,coverage:{AR:sales?(covProv.AR?'provisional':'ok'):'missing',INV:lots?(covProv.INV?'provisional':'ok'):'missing',
        AP:pur?'ok':'missing',revenue:rev==null?'missing':'ok',cogs:cogs==null?'missing':covProv.cogs?'provisional':'ok',current_assets:ca.src},
      missing,inactive,provisional,model:M,thresholds:T,run_id,snapshot_id:snap.snapshot_id,as_of:snap.as_of,period_start:snap.period_start,N,
      threshold_version:CFG.versions.threshold,policy_version:policyVersion,formula_version:CFG.versions.formula,
      metrics:{AR,INV,AP,rev,cogs,dso,dio,dpo,ccc,twc,day_rev:rev>0?rev/N:null,day_cogs:cogs>0?cogs/N:null,cash,ca:caV,ca_src:ca.src,cash_buffer:cashBuffer,annual_revenue:annualRev,
        rev_src:f.revenue_src,cogs_src:f.cogs_src,cogs_days:f.cogs_days,cogs_raw:f.cogs_raw,agg:{AR:aggAR,INV:aggINV},detail:{AR:odAR,INV:slowV},
        total_overdue_ar:sum((sales||[]).filter(s=>s.open&&s.dpd>0),s=>s.open_amount),missing_due_ar:sum((sales||[]).filter(s=>s.open&&s.missing_due),s=>s.open_amount)},
      signals:{arOD,slow,apOD,ap1},concentration,customers:custs,stuck_breakdown:dec.ok?dec.parts:null,main_cause_detail:dec.ok?dec.main_cause_detail:null,
      breakdown_ok:dec.ok,status:!dec.ok?'rejected':unknown?'missing_data':provisional.length?'provisional':'ok'};
    // A breakdown that does not reconcile within 1 VND rejects the run (operational error, Table 2-50).
    if(!dec.ok)result.error='BREAKDOWN_MISMATCH';
    return result;
  }

  /* ---------- UC01 · counterparty and lot profiles (section 2.7.10) ---------- */
  // Declared labels (strategic, essential, sole, allows extension, pledged, cancelled) default to "unknown" and are never read as "no";
  // no label changes W, bn_pattern, TH or the matrix cell (BR-02.31). Each label carries a status: ok / provisional / missing_data.
  const TIER_ACTION={5:'negotiate_schedule',1:'tighten_if_late_else_new_orders',2:'tighten_if_late_else_monitor',4:'negotiate_commitment_or_finance',3:'polite_reminder'};
  const TIER_TEMPLATE={5:'REM+FIN',1:'TIGHTEN',2:'TIGHTEN',4:'REM+FIN',3:'REM'};
  function behaviourLabel(lpw,nPaid,rel,prev){
    if(rel==='new'||nPaid<CFG.cl.behaviourMinPaid)return {label:'insufficient',status:'provisional'};
    const {lateFrequentDays:L,bandLateDays:B}=CFG.cl;
    const late=prev==='frequent_late'?lpw>L-B:prev?lpw>L+B:lpw>L;
    return {label:late?'frequent_late':'on_time',status:nPaid>=CFG.cl.lateConclusionMinPaid?'ok':'provisional'};
  }
  // SRS-DECISION: the data has no goods category per supplier; it is inferred from the name and labelled provisional.
  function supplierCategory(name){
    const n=normName(name);
    const has=(en,c)=>new RegExp(en+'|'+kw('supplier',c)).test(n);
    if(has('logistic|customs','logistics_customs'))return {cat:'logistics_customs',extendable:false};
    if(has('electric|power|water|utility','utilities'))return {cat:'utilities',extendable:false};
    if(has('transport|freight','transport'))return {cat:'transport',extendable:true};
    if(has('trim|thread|button|zipper|label|packag|carton|ink|consumable','trims_packaging'))return {cat:'trims_packaging',extendable:true};
    if(has('fabric|yarn|paper roll|mill','main_material'))return {cat:'main_material',extendable:false};
    return {cat:'unknown',extendable:null};
  }
  function companySize(annual){
    if(annual==null)return {tier:null,status:'missing_data'};
    const z=CFG.size,tier=annual<=z.micro?'micro':annual<=z.small?'small':annual<=z.medium?'medium':'beyond_sme';
    const cap=tier==='micro'?z.micro:tier==='small'?z.small:tier==='medium'?z.medium:null;
    // Without total capital and headcount the tier is provisional by revenue only (Table 2-46, A48).
    // SRS-DECISION: "near the cap" (T50) = annual revenue ≥ 90 % of the tier cap (the same ratio as bn.near_threshold_ratio).
    return {tier,annual,status:'provisional',near_cap:cap!=null&&annual>=CFG.bn.nearThresholdRatio*cap,cap};
  }
  function profiles(snap,d,opts={}){
    const A=dnum(snap.as_of),win=A-CFG.ar.lookbackDays,maxRate=opts.maxRate||0,wl=opts.whitelist||[];
    const wlNames=new Set(wl.map(normName)),strategic=new Set((snap.firm.strategic_customers||[]).map(normName));
    const customers=(d.customers||[]).map(c=>{
      const open=c.rows.filter(r=>r.open),b={current:0,d1_30:0,d31_60:0,d61_90:0,d90p:0,no_due:0};
      open.forEach(r=>{if(!r.due)b.no_due+=r.open_amount;else if(dnum(r.due)>=A)b.current+=r.open_amount;else{const x=r.dpd;b[x<=30?'d1_30':x<=60?'d31_60':x<=90?'d61_90':'d90p']+=r.open_amount}});
      const paid=c.rows.filter(r=>r.fully_paid&&r.due&&r.paid&&dnum(r.paid)>win&&dnum(r.paid)<=A),w=sum(paid,r=>r.amount);
      const lpw=w?sum(paid,r=>r.amount*Math.max(0,dnum(r.paid)-dnum(r.due)))/w:null;
      const withIssue=paid.filter(r=>r.issue),wi=sum(withIssue,r=>r.amount),cdw=wi?sum(withIssue,r=>r.amount*(dnum(r.paid)-dnum(r.issue)))/wi:null;
      const beh=behaviourLabel(lpw??0,paid.length,c.relationship,((opts.prevLabels||{})[c.key]||{}).behaviour);
      const debt=c.max_overdue>CFG.cl.overdueLongDays?'overdue_long':c.overdue>0?'overdue':'none';
      const strat=strategic.has(normName(c.name))?'yes':c.strategic;
      const tier=customerTier(c.relationship,c.size,strat),notes=[];
      if(tier===4&&strat==='unknown')notes.push('strategic_not_confirmed');if(c.new_large)notes.push('new_large');if(c.key_weak)notes.push('counterparty_key_weak');
      const late=c.overdue>0||(lpw??0)>0;
      const action=tier===1?(late?'tighten_now':'strict_terms_new_orders'):tier===2?(late?'tighten_now':'monitor'):TIER_ACTION[tier];
      // SRS-DECISION: the sample data has no tax codes; a name match is shown as 'name_match_unverified' (T41) and never treated as a verified
      // whitelist match (T55). The UC03 product filter of rankFor is unchanged.
      const inWl=wlNames.has(normName(c.name)),whitelist=inWl?(c.key_weak?'name_match_unverified':'in_program'):'BUYER_NOT_IN_PROGRAM';
      return {...c,rows:undefined,invoice_ids:c.rows.map(r=>r.id),buckets:b,late_pos_wavg:lpw,paid_count:paid.length,late_rate:paid.length?paid.filter(r=>dnum(r.paid)>dnum(r.due)).length/paid.length:null,
        collect_days_wavg:cdw,behaviour:beh.label,behaviour_status:beh.status,debt_status:debt,disputed:'missing_data',strategic:strat,tier,action,template:TIER_TEMPLATE[tier],notes,whitelist,
        label_status:{relationship:'ok',size:'ok',behaviour:beh.status,strategic:strat==='unknown'?'provisional':'ok',key:c.key_weak?'provisional':'ok'}};
    });
    const exposureOrder=customers.slice().sort((a,b)=>b.ar-a.ar).map(c=>c.key);
    const interventionOrder=customers.slice().sort((a,b)=>a.tier-b.tier||b.overdue-a.overdue).map(c=>c.key);
    // Suppliers (section 2.7.10.4).
    const pur=snap.purchases||[],purTot=sum(pur.filter(p=>p.in_period),p=>p.amount),groups=new Map();
    pur.forEach(p=>{if(!groups.has(p.key))groups.set(p.key,[]);groups.get(p.key).push(p)});
    const suppliers=[...groups.entries()].map(([key,rows])=>{
      const name=rows[0].supplier,inPer=rows.filter(r=>r.in_period),purchases=sum(inPer,r=>r.amount),dep=purTot>0?purchases/purTot:0;
      const open=rows.filter(r=>r.open),g={overdue:0,due0_7:0,due8_30:0,later:0,no_due:0};
      open.forEach(r=>{if(!r.due){g.no_due+=r.open_amount;return}const t=dnum(r.due);g[t<A?'overdue':t<=A+7?'due0_7':t<=A+30?'due8_30':'later']+=r.open_amount});
      const terms=rows.filter(r=>r.due&&r.issue).map(r=>dnum(r.due)-dnum(r.issue)),avgTerm=terms.length?sum(terms)/terms.length:null;
      const disc=rows.find(r=>r.disc_pct>0&&r.disc_days>0&&r.due&&r.issue);
      let rDisc=null;if(disc){const dd=disc.disc_pct,T=dnum(disc.due)-dnum(disc.issue),k=disc.disc_days;if(T>k)rDisc=dd/(1-dd)*365/(T-k)}
      const first=Math.min(...rows.map(r=>r.issue?dnum(r.issue):A)),months=new Set(inPer.filter(r=>r.issue).map(r=>r.issue.slice(0,7))).size;
      const rel=relationLabel(A-first,inPer.length,months),essential=rows[0].essential||'unknown',cat=supplierCategory(name);
      const allowsExt=(opts.allowExtension||{})[key]||'unknown',sole='unknown';
      let conclusion;
      if(essential==='yes'||sole==='yes')conclusion='pay_on_time';
      else if(allowsExt==='no')conclusion='no_basis';
      else if(cat.extendable)conclusion=rel==='new'?'cautious':'negotiate';
      else conclusion='undecided';
      const pending=conclusion==='negotiate'&&essential==='unknown';
      return {key,name,key_weak:rows[0].key_weak,purchases,dependency:dep,dependency_high:dep>=CFG.cl.supplierDependency,ap:sum(open,r=>r.open_amount),groups:g,
        overdue:g.overdue,max_overdue:Math.max(0,...open.filter(r=>r.dpd>0).map(r=>r.dpd)),pressure30:g.overdue+g.due0_7+g.due8_30,avg_term:avgTerm,
        short_term:avgTerm!=null&&avgTerm<CFG.cl.supplierShortTermDays,discount:disc?{pct:disc.disc_pct,days:disc.disc_days,term:dnum(disc.due)-dnum(disc.issue),r_disc:rDisc,attractive:rDisc!=null&&rDisc>maxRate}:null,
        relationship:rel,essential,sole,allows_extension:allowsExt,category:cat.cat,category_src:'inferred',conclusion,pending_confirmation:pending,ext_days:conclusion==='negotiate'?CFG.cl.extDays:null,
        invoice_ids:rows.map(r=>r.id),label_status:{essential:essential==='unknown'?'provisional':'ok',category:'provisional',key:rows[0].key_weak?'provisional':'ok'}};
    });
    const pressure={essential:0,extendable:0,undecided:0};
    suppliers.forEach(s=>{pressure[s.essential==='yes'?'essential':(s.conclusion==='negotiate'||s.conclusion==='cautious')?'extendable':'undecided']+=s.pressure30});
    // Lots (section 2.7.10.5, Tables 2-44 and 2-45).
    const pos=snap.firm.position||null;
    const lots=(snap.lots||[]).map(l=>{
      const thr=l.owner==='customer'?null:(CFG.inv.slowDays[l.type]||CFG.inv.unknownTypeSlowDays),slow=thr!=null&&l.days!=null&&l.days>thr;
      const status=l.owner==='customer'?'excluded':(l.cancelled==='yes'||l.cancel_proposed)?'cancelled':l.pledged==='yes'?'pledged':slow?'slow':'normal';
      const stuck=l.owner!=='customer'&&(slow||l.cancelled==='yes')?l.value_own:0;
      const collateralOk=l.owner!=='customer'&&l.cancelled!=='yes'&&l.pledged!=='yes'&&CFG.inv.collateralTypes.includes(l.type);
      const checks=[];
      if(pos==='trading'&&l.type==='NVL')checks.push('trader_should_be_HH');
      if(l.owner==='customer'&&pos&&pos!=='cmt')checks.push('hgc_at_non_subcontractor');
      if(l.type==='BTP'&&slow)checks.push('line_bottleneck');if(l.type==='TP'&&slow)checks.push('late_delivery_or_slow_pickup');
      return {name:l.name,type:l.type,type_src:l.type_src,suggested_type:pos==='trading'&&l.type==='NVL'?'HH':null,owner:l.owner,qty:l.qty,unit_cost:l.unit_cost,value:l.value,value_own:l.value_own,days:l.days,
        threshold:thr,days_over:slow?l.days-thr:0,status,cancel_status:l.cancelled==='yes'?'confirmed':l.cancel_proposed?'proposed':'unknown',pledged:l.pledged,stuck,
        collateral:collateralOk?l.value_own:0,collateral_pending:collateralOk&&(l.pledged==='unknown'||l.cancel_proposed),checks,hgc_proposed:l.hgc_proposed,
        label_status:{type:l.type_src==='declared'?'ok':l.type_src==='inferred'?'provisional':'missing_data',owner:l.owner==='unknown'?'provisional':'ok',pledged:l.pledged==='unknown'?'provisional':'ok',cancelled:l.cancelled==='unknown'?'provisional':'ok'}};
    });
    const own=lots.filter(l=>l.owner!=='customer'),oldest=own.filter(l=>l.days!=null).sort((a,b)=>b.days-a.days)[0]||null;
    const largestSlow=own.filter(l=>l.status==='slow'||l.stuck>0).sort((a,b)=>b.value_own-a.value_own)[0]||null;
    const collateral=sum(lots,l=>l.collateral);
    return {customers,exposureOrder,interventionOrder,suppliers,pressure,lots,oldest_lot:oldest&&oldest.name,largest_slow_lot:largestSlow&&largestSlow.name,
      stuck_inventory:sum(lots,l=>l.stuck),collateral,collateral_eligible:collateral>=CFG.collateralMin,size:companySize(d.metrics.annual_revenue)};
  }

  /* ---------- UC02 · delay model and five scenarios (section 2.8.11.1, Appendix B T2-02 … T2-23) ---------- */
  const SCENARIOS=['base','optimistic','conservative','stress_7','continuing_sales'];
  const kOf=sc=>sc==='optimistic'||sc==='conservative'?sc:'base';   // delay assumption behind each scenario
  const ceilT=x=>Math.ceil(x-1e-9);
  // Delay statistics (workbook v9, T2-04 and T2-32): Base = amount-weighted mean of the sample delays; P25 / P75 are sample
  // percentiles of the delays (unweighted, linear interpolation like Excel PERCENTILE.INC); Optimistic = MIN(P25; Mean) and
  // Conservative = MAX(P75; Mean), so Opt ≤ Base ≤ Cons without moving the mean.
  function percentileInc(values,p){const v=values.slice().sort((a,b)=>a-b),n=v.length;if(!n)return null;const h=(n-1)*p,lo=Math.floor(h);return lo+1<n?v[lo]+(h-lo)*(v[lo+1]-v[lo]):v[lo]}
  function delayStats(samples){
    if(!samples||!samples.length)return null;const tot=sum(samples,s=>s.w);if(!(tot>0))return null;
    const mean=sum(samples,s=>s.w*s.late)/tot,lates=samples.map(s=>s.late),p25=percentileInc(lates,.25),p75=percentileInc(lates,.75);
    return {base:mean,optimistic:Math.min(p25,mean),conservative:Math.max(p75,mean),mean,p25,p75,n:samples.length};
  }
  // Samples with a due date in (as_of − lookback; as_of]: paid in full → MAX(0; paid − due); still open and overdue → as_of − due
  // (a truncated sample, a lower bound of the real delay, BR-02.13). Partly paid invoices that are still open count as open.
  function delaySamples(rows,A){
    const out=[];(rows||[]).forEach(r=>{if(!r.due)return;const due=dnum(r.due);if(!(due>A-CFG.tv2.delay.lookbackDays&&due<=A))return;
      if(r.fully_paid&&r.paid)out.push({id:r.id,key:r.key,late:Math.max(0,dnum(r.paid)-due),w:r.amount,truncated:false});
      else if(r.open)out.push({id:r.id,key:r.key,late:A-due,w:r.amount,truncated:true})});
    return out;
  }
  // Supplier payment history (workbook v9, T2-06 "historical_policy"): completed payments only (no open lower bounds), each supplier's
  // own amount-weighted mean of MAX(0; paid − due), whatever the number of samples; a supplier without history is paid on the due date.
  function paymentModel(rows,A){
    const samples=delaySamples(rows,A).filter(s=>!s.truncated),by=new Map();samples.forEach(s=>{if(!by.has(s.key))by.set(s.key,[]);by.get(s.key).push(s)});
    const parties={};by.forEach((ss,k)=>{parties[k]={samples:ss,n:ss.length,stats:delayStats(ss)}});
    const tierOf=k=>{const p=parties[k];return p&&p.n?{tier:'supplier',set:p.samples,stats:p.stats,n:p.n}:{tier:'none',set:[],stats:null,n:0}};
    return {pool:{samples,n:samples.length,stats:delayStats(samples)},parties,tierOf};
  }
  function delayModel(snap){
    const A=dnum(snap.as_of),minN=CFG.tv2.delay.minN;
    const build=rows=>{
      const samples=delaySamples(rows,A),by=new Map();samples.forEach(s=>{if(!by.has(s.key))by.set(s.key,[]);by.get(s.key).push(s)});
      const pool={samples,n:samples.length,stats:delayStats(samples)},parties={};by.forEach((ss,k)=>{parties[k]={samples:ss,n:ss.length,stats:delayStats(ss)}});
      // Fallback chain (T2-19): own samples ≥ min_n → company pool ≥ min_n → default late days; the level and count are kept per party.
      const tierOf=k=>{const p=parties[k];if(p&&p.n>=minN)return {tier:'customer',set:p.samples,stats:p.stats,n:p.n};
        if(pool.n>=minN)return {tier:'pool',set:pool.samples,stats:pool.stats,n:pool.n};return {tier:'default',set:[],stats:null,n:p?p.n:0}};
      return {pool,parties,tierOf};
    };
    return {receipts:build(snap.sales),payments:paymentModel(snap.purchases,A)};
  }
  // Cash basis of invoice amounts (T2-22): gross → 1; net with a rate → 1 + rate; net without a rate → 1 and provisional (never 10 % by default).
  function vatFactor(cfg){const c=cfg||{};if(c.amount_basis==='gross')return {f:1,status:'gross'};if(c.vat_rate>0)return {f:1+c.vat_rate,status:'net_with_rate'};return {f:1,status:'net_no_rate'}}
  const KNOWN_CAT=new Set(['payroll','rent','utilities','new_materials','tax','debt_service','capex']);
  function forecast(snap,opts={}){
    const T=CFG.tv2,A=dnum(snap.as_of),start=A+1,HD=7*T.horizonWeeks,end=A+HD,D=delayModel(snap),vat=vatFactor(opts.config||snap.config),issues=[];
    const essential=new Set((opts.essentialSuppliers||snap.firm.essential_suppliers||[]).map(normName));
    // SRS-DECISION: only suppliers declared essential are paid on the due date; an "unknown" essential flag keeps the historical timing (the
    // essential_suppliers list of Table 2-79 is explicit), while UC01 still shows the flag as unknown, never as "no".
    const isEssential=p=>p.essential==='yes'||essential.has(normName(p.supplier)),apTiming=opts.apTiming||'historical';
    const openSales=(snap.sales||[]).filter(s=>s.open),openPur=(snap.purchases||[]).filter(p=>p.open);
    // Data v11 (F01_UC2 event table): Rank of MOD(Rank; 5) is the position of the bill among all open payables in invoice-id order.
    const odPur=openPur.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const byK={};
    ['base','optimistic','conservative'].forEach(k=>{
      const rec=openSales.map(s=>{
        const amt=s.open_amount*vat.f,base={id:s.id,dir:'IN',cat:'invoice_receipt',partner:s.customer,amt,certainty:'estimated',src:'sales_invoice',key:s.key};
        // A confirmed receipt schedule (known at the cut-off) replaces the estimated date in every scenario; it adds no money (A07, A11).
        if(s.confirmed_date&&dnum(s.confirmed_date)>A)return {...base,certainty:'confirmed',t:Math.max(start,dnum(s.confirmed_date)),method:'confirmed_schedule'};
        if(!s.due)return {...base,t:null,method:'no_due_date'};
        const due=dnum(s.due),tr=D.receipts.tierOf(s.key);let delay,method;
        if(due>A){delay=tr.tier==='default'?T.delay.defaultLate:tr.stats[k];method=tr.tier}          // not yet due: due + CEILING(delay), not before Start
        else{const dpd=A-due,cond=tr.set.filter(x=>x.late>=dpd);                                    // overdue: conditional delay on samples late ≥ dpd
          // Workbook v9 (T2-19): the eligible set is every sample of the same level with ModelDelay ≥ DPD, the invoice's own open sample included.
          if(tr.tier!=='default'&&cond.length>=T.delay.conditionalMinN){delay=delayStats(cond)[k];method=tr.tier+'_conditional'}
          else{delay=dpd+T.overdueResidual[k];method='residual'}}
        return {...base,t:Math.max(start,due+ceilT(delay)),tier:tr.tier,n:tr.n,method,delay,dpd:due<=A?A-due:0};
      });
      const pay=openPur.map(p=>{
        const amt=p.open_amount*vat.f,ess=isEssential(p),base={id:p.id,dir:'OUT',cat:'supplier_payment',partner:p.supplier,amt,certainty:'confirmed',src:'purchase_invoice',key:p.key,essential:ess};
        if(!p.due)return {...base,t:null,method:'no_due_date'};
        const due=dnum(p.due);
        if(due<=A){const rank=odPur.indexOf(p)+1;return {...base,t:A+T.apOverdueOffset[k]+(rank%5),method:'overdue_spread',rank}}   // as_of + off + MOD(rank; 5), rank from 1
        if(k==='conservative'||ess||apTiming==='due')return {...base,t:Math.max(start,due),method:ess?'essential_due':'due'};
        const tr=D.payments.tierOf(p.key),L=tr.stats?tr.stats.mean:0;                                      // historical: due + CEILING(L_sup)
        return {...base,t:Math.max(start,due+ceilT(L)),method:tr.stats?'historical_supplier':'due_no_history',delay:L};
      });
      byK[k]=rec.concat(pay);
    });
    // Planned flows (T2-20): one obligation, one event; rows that duplicate an invoice are dropped (Q09); week-only rows switch the run to
    // weekly_only (no daily figures are published); rows without date or week stay in the unscheduled list (never dropped from totals).
    const invoiceIds=new Set([...(snap.sales||[]),...(snap.purchases||[])].map(x=>x.id)),plans=[];let weeklyOnly=false;
    (snap.planned||[]).forEach(p=>{
      if(p.source_id&&invoiceIds.has(p.source_id)){issues.push({code:'PLAN_DUPLICATES_INVOICE',severity:'warning',id:p.id,source:p.source_id});return}
      const known=KNOWN_CAT.has(p.category),base={id:p.id,dir:p.direction,cat:known?p.category:(p.direction==='IN'?'planned_inflow':'planned_outflow'),
        partner:known?'Planned item':(p.category||'Planned item'),amt:p.amount,certainty:p.certainty||'estimated',src:'plan'};
      // SRS-DECISION: week-only rows are placed on a nominal day of their week for the internal ledger; in weekly_only mode no daily figure is shown.
      let t=null;if(p.date)t=dnum(p.date);else if(p.week){t=A+(p.week-1)*7+4;weeklyOnly=true}   // nominal day inside the week, never published as a daily figure
      if(t!=null&&t<start){issues.push({code:'PLAN_BEFORE_START',severity:'warning',id:p.id});return}
      plans.push({...base,t,method:p.date?'plan_date':p.week?'plan_week':'no_date'});
    });
    // continuing_sales (T2-21): new revenue each week = Rev ÷ N × 7, issued on the first day of each forecast week and received at
    // issue + Terms + DelayBase (company pool). Terms = the declared credit days for new sales (config.continuing.credit_days), else the
    // amount-weighted term of the period's invoices. When the company declares an incremental cost ratio, each week also pays
    // WeeklySales × ratio at issue + cost lag (fixed payroll and rent are already in Base); without it the scenario has receipts only
    // and is flagged CONTINUING_NO_COST (workbook A17).
    const per=(snap.sales||[]).filter(s=>s.in_period&&s.due&&s.issue),wt=sum(per,s=>s.amount),cont=(snap.config||{}).continuing||{};
    const avgTerm=cont.credit_days!=null?cont.credit_days:wt?sum(per,s=>s.amount*(dnum(s.due)-dnum(s.issue)))/wt:CFG.ar.termFallbackDays;
    const poolDelay=D.receipts.pool.n>=T.delay.minN?D.receipts.pool.stats.base:T.delay.defaultLate;
    const weekly=snap.fin.revenue>0?snap.fin.revenue/snap.N*7*vat.f:0;
    const newSales=weekly>0?Array.from({length:T.horizonWeeks},(_,i)=>{const iss=start+7*i,ev=[
      {id:'NS-W'+(i+1),dir:'IN',cat:'new_sales',partner:'New sales (assumed)',amt:weekly,certainty:'estimated',src:'continuing_sales',t:iss+ceilT(avgTerm+poolDelay),issue:diso(iss),method:'continuing_sales'}];
      if(cont.cost_ratio>0)ev.push({id:'NC-W'+(i+1),dir:'OUT',cat:'new_cost',partner:'Variable cost of new sales (assumed)',amt:weekly*cont.cost_ratio,certainty:'estimated',src:'continuing_sales',t:iss+(cont.cost_lag_days||0),issue:diso(iss),method:'continuing_cost'});
      return ev}).flat():[];
    if(weekly>0&&!(cont.cost_ratio>0))issues.push({code:'CONTINUING_NO_COST',severity:'provisional'});
    const cash0=opts.cash0;
    const scen={};
    SCENARIOS.forEach(sc=>{
      let list=byK[kOf(sc)].concat(plans);
      // stress_7 (T2-18): only estimated receipts move 7 days later; confirmed items keep their date.
      if(sc==='stress_7')list=list.map(e=>e.dir==='IN'&&e.t!=null&&e.certainty==='estimated'?{...e,t:e.t+T.stressDays,shift:T.stressDays}:e);
      if(sc==='continuing_sales')list=list.concat(newSales);
      list=list.map(e=>({...e,scope:e.t==null?'unscheduled':e.t>end?'beyond_horizon':'in_horizon'}));
      const by=new Map();list.forEach(e=>{if(e.scope!=='in_horizon')return;const r=by.get(e.t)||{in:0,out:0};r[e.dir==='IN'?'in':'out']+=e.amt;by.set(e.t,r)});
      let run=cash0??0,cum=0,minCum=0;const days=[];
      for(let t=start;t<=end;t++){const r=by.get(t)||{in:0,out:0},open=run;run+=r.in-r.out;cum+=r.in-r.out;if(cum<minCum)minCum=cum;days.push({d:diso(t),open,in:r.in,out:r.out,close:run})}
      const tot=(scope,dir)=>sum(list.filter(e=>e.scope===scope&&e.dir===dir),e=>e.amt);
      scen[sc]={events:list,days,minCum,totals:{in:tot('in_horizon','IN'),out:tot('in_horizon','OUT')},beyond:{IN:tot('beyond_horizon','IN'),OUT:tot('beyond_horizon','OUT')},
        unscheduled:{IN:tot('unscheduled','IN'),OUT:tot('unscheduled','OUT')}};
    });
    // Arithmetic reconciliation (≤ 1 VND): ledger vs totals, and every open invoice scheduled exactly once in each delay assumption.
    const tol=T.tolerance,arSrc=sum(openSales,s=>s.open_amount)*vat.f,apSrc=sum(openPur,p=>p.open_amount)*vat.f;
    const recon=SCENARIOS.every(sc=>{const o=scen[sc],last=o.days[o.days.length-1];return Math.abs((last.close-(cash0??0))-(o.totals.in-o.totals.out))<=tol&&Math.abs(sum(o.days,x=>x.in)-o.totals.in)<=tol&&Math.abs(sum(o.days,x=>x.out)-o.totals.out)<=tol})
      &&['base','optimistic','conservative'].every(k=>Math.abs(sum(byK[k].filter(e=>e.dir==='IN'),e=>e.amt)-arSrc)<=tol&&Math.abs(sum(byK[k].filter(e=>e.dir==='OUT'),e=>e.amt)-apSrc)<=tol);
    // Scenario order (BR-02.16): min Optimistic ≥ min Base ≥ min Conservative and min stress_7 ≤ min Base; otherwise an engine error.
    const mn=sc=>Math.min(...scen[sc].days.map(x=>x.close));
    const order_ok=GE(mn('optimistic'),mn('base'))&&GE(mn('base'),mn('conservative'))&&GE(mn('base'),mn('stress_7'));
    if(!recon)issues.push({code:'RECONCILIATION_FAILED',severity:'invalid'});
    if(!order_ok)issues.push({code:'SCENARIO_ORDER',severity:'invalid'});
    if(scen.base.unscheduled.IN+scen.base.unscheduled.OUT>0)issues.push({code:'UNSCHEDULED_AMOUNT',severity:'missing',amount:scen.base.unscheduled.IN+scen.base.unscheduled.OUT});
    if(!snap.tables.sales||!snap.tables.purchases)issues.push({code:'MISSING_CORE_SOURCE',severity:'missing'});
    if(vat.status==='net_no_rate')issues.push({code:'VAT_NOT_MODELLED',severity:'provisional'});
    if(weeklyOnly)issues.push({code:'WEEKLY_ONLY',severity:'provisional'});
    const delays={receipts:{},payments:{}};
    Object.entries(D.receipts.parties).forEach(([k,p])=>{const tr=D.receipts.tierOf(k),r=(snap.sales||[]).find(s=>s.key===k);delays.receipts[k]={name:r?r.customer:k,tier:tr.tier,n:p.n,used_n:tr.n,stats:tr.stats?{...tr.stats}:null}});
    openSales.forEach(s=>{if(!delays.receipts[s.key]){const tr=D.receipts.tierOf(s.key);delays.receipts[s.key]={name:s.customer,tier:tr.tier,n:0,used_n:tr.n,stats:tr.stats?{...tr.stats}:null}}});
    Object.entries(D.payments.parties).forEach(([k,p])=>{const tr=D.payments.tierOf(k),r=(snap.purchases||[]).find(s=>s.key===k);delays.payments[k]={name:r?r.supplier:k,tier:tr.tier,n:p.n,mean:tr.stats?tr.stats.mean:0}});
    return {as_of:snap.as_of,start:diso(start),end:diso(end),days:HD,scenarios:scen,recon_ok:recon,order_ok,issues,vat,weekly_only:weeklyOnly,delays,
      pool:{n:D.receipts.pool.n,stats:D.receipts.pool.stats},avg_term:avgTerm,pool_delay:poolDelay,new_sales_weekly:weekly,cash0};
  }

  /* ---------- UC02 · Cash0, reserve levels and the run summary (sections 2.8.3, 2.8.10–2.8.12) ---------- */
  // Cash0 = cash_total − cash_restricted when the owner entered it (confirmed); otherwise the cash of the data as a substitute
  // (provisional); otherwise missing (T2-01).
  function resolveCash0(snap,policy={}){
    const c=policy.cash0;
    if(c&&c.total!=null)return {value:c.total-(c.restricted||0),total:c.total,restricted:c.restricted||0,status:'confirmed'};
    if(snap.fin.opening_cash!=null)return {value:snap.fin.opening_cash,total:snap.fin.opening_cash,restricted:0,status:'provisional'};
    return {value:null,status:'missing'};
  }
  // Rmin / Rtarget / Rupper by source priority (BR-02.20): owner_policy > company profile target > verified_reference (cash-buffer
  // percentiles × model factor × 12-month revenue) > demo_assumption (Rmin = 50 %, Rupper = 200 % of an existing Rtarget).
  // SRS-DECISION: min_cash_buffer_vnd of the company profile is the owner's declared Rtarget (source firm_profile); its Rmin/Rupper
  // come from the demo assumption. With only N < 365 days of revenue, 12-month revenue = revenue × 365 ÷ N and the reference is provisional.
  // Miller–Orr levels (SRS 2.8.9, CF01–CF04): own daily history when ≥ minDailyObs days within maxHistoryDays, else the industry σ proxy.
  // Needs the 12-month revenue (declared revenue_ttm, else revenue × 365 ÷ N, provisional). Returns null when b, i or σ² is not valid (E04).
  function millerOrr(snap,policy={}){
    const P=CFG.liq.millerOrr,A=dnum(snap.as_of),ttm=snap.firm.revenue_ttm>0?snap.firm.revenue_ttm:snap.fin.revenue>0?snap.fin.revenue*365/snap.N:null;
    if(!(ttm>0))return null;
    const xs=(snap.history||[]).filter(h=>dnum(h.date)>A-P.maxHistoryDays).map(h=>h.net),n=xs.length;
    let var_,src;
    if(n>=P.minDailyObs){const m=sum(xs)/n;var_=sum(xs,x=>(x-m)**2)/(n-1);src='firm_daily'}
    else{var_=(P.sigmaDailyRatio*ttm)**2;src='industry_proxy'}
    const b=P.transactionCost,i=P.rateAnnual/P.daysPerYear;
    if(!(b>0&&i>0&&var_>0))return {status:'invalid_model',ttm,n,sigma_src:src};
    const L=Math.max(P.lowerRatio*ttm,policy.lower_min_owner??P.lowerMinOwner??0),D=Math.cbrt(3*b*var_/(4*i));
    return {L,Z:L+D,H:L+3*D,D,sigma2:var_,sigma:Math.sqrt(var_),sigma_src:src,n,ttm,ttm_src:snap.firm.revenue_ttm>0?'declared':'annualised',b,i,version:P.version,
      status:src==='firm_daily'&&snap.firm.revenue_ttm>0?'ok':'provisional'};
  }
  function resolveReserves(snap,policy={},model){
    const pr=policy.reserve||{},R=CFG.liq,annual=snap.fin.revenue>0?snap.fin.revenue*365/snap.N:null,ref=annual?R.reference[model]:null;
    const out={rmin:null,rtarget:null,rupper:null,src:{},annual,annualised:snap.N<365,reference:ref?{rmin:ref.rmin*annual,rtarget:ref.rtarget*annual,rupper:ref.rupper*annual}:null};
    // Miller–Orr (fob.threshold.v3) when the company has a daily cash history or a declared 12-month revenue: rmin = L, rtarget = Z,
    // rupper = H (aliases of CF04). Owner policy values still win field by field.
    const mo=(snap.history&&snap.history.length)||snap.firm.revenue_ttm>0?millerOrr(snap,pr):null;
    if(mo&&mo.L!=null&&pr.rtarget==null){out.miller_orr=mo;
      [['rmin','L'],['rtarget','Z'],['rupper','H']].forEach(([k,m])=>{if(pr[k]==null){out[k]=mo[m];out.src[k]='miller_orr'}})}
    if(pr.rtarget!=null){out.rtarget=pr.rtarget;out.src.rtarget='owner_policy'}
    else if(out.rtarget!=null){}
    else if(snap.firm.rtarget!=null&&snap.firm.rtarget!==''){out.rtarget=snap.firm.rtarget;out.src.rtarget='firm_profile'}
    else if(out.reference){out.rtarget=out.reference.rtarget;out.src.rtarget='verified_reference'}
    if(pr.rmin!=null){out.rmin=pr.rmin;out.src.rmin='owner_policy'}
    if(pr.rupper!=null){out.rupper=pr.rupper;out.src.rupper='owner_policy'}
    if(out.src.rtarget==='verified_reference'){if(out.rmin==null){out.rmin=out.reference.rmin;out.src.rmin='verified_reference'}if(out.rupper==null){out.rupper=out.reference.rupper;out.src.rupper='verified_reference'}}
    if(out.rtarget!=null){if(out.rmin==null){out.rmin=R.rminDefaultRatio*out.rtarget;out.src.rmin='demo_assumption'}if(out.rupper==null){out.rupper=R.rupperDefaultRatio*out.rtarget;out.src.rupper='demo_assumption'}}
    // Validation (EC-2, Q15/Q16): Rtarget > 0 and 0 ≤ Rmin ≤ Rtarget < Rupper; otherwise no colour is assigned.
    if(out.rtarget==null)out.status='missing_data';
    else if(!(out.rtarget>0))out.status=out.rtarget===0?'missing_data':'invalid_data';
    else if(!(out.rmin>=0&&out.rmin<=out.rtarget&&out.rtarget<out.rupper))out.status='invalid_data';
    else out.status=Object.values(out.src).some(s=>s==='demo_assumption'||(s==='verified_reference'&&out.annualised))||out.src.rtarget==='firm_profile'||(out.miller_orr&&out.miller_orr.status!=='ok'&&Object.values(out.src).includes('miller_orr'))?'provisional':'ok';
    return out;
  }
  const LVN={green:0,yellow:1,orange:2,red:3};
  // Daily alert level of SRS 2.8.11.3 on unrounded values (the same rule as alertLevel in the app).
  function level(v,R){if(!(R.rtarget>0))return 'na';const gr=Math.max(0,R.rtarget-v)/R.rtarget;if(v<0||v<R.rmin||gr>.5)return 'red';if(gr>.2)return 'orange';if(gr>0)return 'yellow';return 'green'}
  const worst=ls=>ls.reduce((a,l)=>(LVN[l]??-1)>(LVN[a]??-1)?l:a,'green');
  // Summary of one scenario over the first H weeks (T2-10 … T2-15, T2-23).
  function scenarioSummary(o,R,H){
    const ds=o.days.slice(0,7*H),valid=R.status!=='invalid_data'&&R.rtarget>0;
    let low=ds[0],cum=0,minCum=0,firstB=null,firstZ=null,pb=0,pbD=null,pz=0,pzD=null;
    ds.forEach(x=>{if(x.close<low.close)low=x;cum+=x.in-x.out;if(cum<minCum)minCum=cum;
      if(valid&&x.close<R.rtarget&&!firstB)firstB=x.d;if(x.close<0&&!firstZ)firstZ=x.d;
      const gb=valid?Math.max(0,R.rtarget-x.close):0,gz=Math.max(0,-x.close);if(gb>pb){pb=gb;pbD=x.d}if(gz>pz){pz=gz;pzD=x.d}});
    const levels=valid?ds.map(x=>level(x.close,R)):ds.map(()=>'na');
    return {min:low.close,min_date:low.d,first_below_rtarget:firstB,first_negative:firstZ,peak_buffer:pb,peak_buffer_date:pbD,peak_zero:pz,peak_zero_date:pzD,
      need_rtarget:valid?Math.max(0,R.rtarget-Math.min(0,minCum)):null,need_zero:Math.max(0,-minCum),min_cum:minCum,closing:ds[ds.length-1].close,
      levels,overall:valid?worst(levels):'na',totals:{in:sum(ds,x=>x.in),out:sum(ds,x=>x.out)}};
  }
  function weeklyRollup(o,R,H){
    const out=[];for(let w=0;w<H;w++){const ch=o.days.slice(7*w,7*w+7),low=ch.reduce((a,x)=>x.close<a.close?x:a,ch[0]);
      out.push({w:w+1,start:ch[0].d,end:ch[ch.length-1].d,open:ch[0].open,in:sum(ch,x=>x.in),out:sum(ch,x=>x.out),close:ch[ch.length-1].close,min:low.close,min_date:low.d,
        level_close:level(ch[ch.length-1].close,R),level_worst:worst(ch.map(x=>level(x.close,R)))})}
    return out;
  }
  // Two-week blocks (T2-25, Table 2-88): status by the lowest day of the block, never by its closing balance.
  function blocks(o,R,H){
    const ds=o.days.slice(0,7*H),n=CFG.tv2.blockDays,out=[];
    for(let i=0;i<ds.length;i+=n){const ch=ds.slice(i,i+n),low=ch.reduce((a,x)=>x.close<a.close?x:a,ch[0]);
      const st=low.close<R.rtarget?'shortage':low.close>R.rupper?'surplus':'balanced';
      out.push({k:out.length+1,start:ch[0].d,end:ch[ch.length-1].d,days:ch.length,min:low.close,min_date:low.d,status:st,severity:st==='shortage'?level(low.close,R):null,
        gap:st==='shortage'?R.rtarget-low.close:0,excess:st==='surplus'?low.close-R.rupper:0})}
    const order=out.slice().sort((a,b)=>{const g=x=>x.status==='shortage'?0:x.status==='surplus'?1:2;return g(a)-g(b)||
      (a.status==='shortage'?(LVN[b.severity]-LVN[a.severity])||(b.gap-a.gap):a.status==='surplus'?(b.excess-a.excess):0)||a.k-b.k});
    // "Persistent shortfall": ≥ tv2.persistent_shortfall.min_blocks consecutive shortage blocks; it never raises the daily colours.
    let best=null,run=[];out.forEach(b=>{if(b.status==='shortage'){run.push(b);if(run.length>=CFG.tv2.persistentShortfallMinBlocks&&(!best||run.length>best.length))best=run.slice()}else run=[]});
    const persistent=best?{from:best[0].start,to:best[best.length-1].end,blocks:best.length,need_date:ds.find(x=>x.d>=best[0].start&&x.close<R.rtarget).d,peak_gap:Math.max(...best.map(b=>b.gap))}:null;
    return {list:out,display:order,persistent};
  }
  // Shortfall episodes on Base (2.8.11.4): consecutive days below Rtarget; colour = the worst daily level inside the episode.
  function shortfallEpisodes(o,R,H){
    const ds=o.days.slice(0,7*H),eps=[];let cur=null;
    ds.forEach((x,i)=>{if(x.close<R.rtarget){if(!cur){cur={start:x.d,i0:i,low:x,levels:[]};eps.push(cur)}cur.end=x.d;cur.i1=i;cur.levels.push(level(x.close,R));if(x.close<cur.low.close)cur.low=x}else cur=null});
    return eps.map((e,j)=>({k:j+1,start:e.start,end:e.end,days:e.i1-e.i0+1,low_date:e.low.d,low:e.low.close,peak_gap:R.rtarget-e.low.close,color:worst(e.levels),
      recovery:e.i1+1<ds.length?ds[e.i1+1].d:null,censored:e.i1===ds.length-1}));
  }
  // Cash state TH on Base (Table 2-89): shortage before surplus; TH03 needs ≥ 14 consecutive days above Rupper; run-off surplus is a reference.
  function cashState(base,R,status,H,mode='run_off'){
    if(['missing_data','invalid_data','rejected'].includes(status)||!(R.rtarget>0))return {th:'unknown'};
    const ds=base.days.slice(0,7*H);
    if(ds.some(x=>x.close<R.rtarget))return {th:'TH01'};
    let run=0,best={len:0,end:-1};ds.forEach((x,i)=>{run=x.close>R.rupper?run+1:0;if(run>best.len)best={len:run,end:i}});
    if(best.len>=CFG.tv2.th03MinConsecutiveDays)return {th:'TH03',reference:mode==='run_off',window:[ds[best.end-best.len+1].d,ds[best.end].d],run:best.len};
    return {th:'TH02',run:best.len};
  }
  const MATRIX_CELLS={W0:{TH01:'M1',TH02:'M2',TH03:'M3'},W1:{TH01:'M4',TH02:'M5',TH03:'M6'},W2:{TH01:'M7',TH02:'M8',TH03:'M9'}};
  // Full UC02 run on one snapshot and configuration (UC02.1). The matrix cell needs W and TH from the same snapshot (BR-02.22).
  function runUC02(snap,policy={},opts={}){
    const H=Math.min(CFG.tv2.horizonWeeks,Math.max(1,opts.weeks|0||CFG.tv2.horizonWeeks)),model=opts.model||(snap.firm.business_model||CFG.wc.defaultModel);
    const cash0=resolveCash0(snap,policy),R=resolveReserves(snap,policy,model);
    const fc=forecast(snap,{cash0:cash0.value,config:{amount_basis:policy.amount_basis||snap.config.amount_basis,vat_rate:policy.vat_rate??snap.config.vat_rate},
      essentialSuppliers:policy.essential_suppliers||snap.firm.essential_suppliers,apTiming:policy.ap_timing});
    const sev=s=>fc.issues.filter(i=>i.severity===s).map(i=>i.code);
    const invalid=[...sev('invalid'),...(R.status==='invalid_data'?['INVALID_RESERVES']:[])],missing=[...sev('missing'),...(R.status==='missing_data'?['MISSING_RTARGET']:[]),...(cash0.status==='missing'?['MISSING_CASH0']:[])];
    const prov=[...sev('provisional'),...(cash0.status==='provisional'?['CASH0_PROVISIONAL']:[]),...(R.status==='provisional'?['RESERVES_PROVISIONAL']:[]),...(opts.freshness==='stale'?['DATA_STALE']:[]),
      ...(opts.freshness==='expired'?['DATA_EXPIRED']:[]),...(snap.source.type==='sample'?['DEMO_DATA']:[])];
    const status=invalid.length?'invalid_data':missing.length?'missing_data':prov.length?'provisional':'ok';
    const summary={},weekly={};SCENARIOS.forEach(sc=>{summary[sc]=scenarioSummary(fc.scenarios[sc],R,H)});
    const base=fc.scenarios.base,th=cashState(base,R,status,H),W=opts.uc01;
    const same=W&&W.snapshot_id===snap.snapshot_id,cell=same&&W.wc_class!=='unknown'&&th.th!=='unknown'?MATRIX_CELLS[W.wc_class][th.th]:null;
    const key=[snap.snapshot_id,CFG.versions.formula,opts.config_version||'CFG-default',H].join('|');
    return {run_id:'RUN-UC02-'+hash(key),key,snapshot_id:snap.snapshot_id,as_of:snap.as_of,weeks:H,start:fc.start,end:diso(dnum(snap.as_of)+7*H),mode:'run_off',status,
      status_codes:{invalid,missing,provisional:prov},cash0,reserves:R,fc,summary,weekly:weeklyRollup(base,R,H),blocks:blocks(base,R,H),episodes:shortfallEpisodes(base,R,H),
      th,matrix:{cell,routed:!!cell,reason:!W?'no_uc01':!same?'different_snapshot':W.wc_class==='unknown'?'w_unknown':th.th==='unknown'?'th_unknown':null},
      overall:status==='invalid_data'||status==='missing_data'?'unknown':summary.base.overall,config_version:opts.config_version||'CFG-default',weekly_only:fc.weekly_only};
  }
  // Weekly roll-up of any scenario (the forecast table follows the selected scenario).
  const weeklyOf=(o,R,H)=>weeklyRollup(o,R,H);
  // Cash0 needed by the formula T2-23 from a cumulative net-flow series (Q38).
  const cashNeeded=(minCum,rt)=>({rtarget:Math.max(0,rt-Math.min(0,minCum)),zero:Math.max(0,-minCum)});

  /* ---------- UC01 ↔ UC02 links and the request to UC03 (sections 2.7.11.9, 2.8.5, 2.8.7, 2.8.9) ---------- */
  // Contributing factors of one shortfall episode: the 3 largest outflows up to the low day and the receipts expected after it, with
  // their delay level (customer / company pool / default). UC01 findings are attached with a link type and an evidence level:
  // L1 – a receipt or payment of a counterparty with an object-level finding (AR customer with R-AR-OD, AP supplier with R-AP-OD);
  //      candidate, or supported when the date comes from that counterparty's own history; never confirmed (no counterfactual test yet);
  // L2 – inventory finding: only "money already spent on goods not yet turned over" when the episode has purchase outflows; candidate;
  // L3 – BN0 or no matching finding: the shortfall comes from the timing of collections and payments.
  // Amounts attached to links are references: they are not added up and never added to the shortfall.
  function contributingFactors(run,uc01,episode,scenario='base'){
    const o=run.fc.scenarios[scenario],start=dnum(run.fc.start),low=dnum(episode.low_date),epS=dnum(episode.start),epE=dnum(episode.end);
    const inH=o.events.filter(e=>e.scope==='in_horizon');
    const top3=a=>a.slice().sort((x,y)=>y.amt-x.amt||(x.id<y.id?-1:1)).slice(0,3);
    const outflows=top3(inH.filter(e=>e.dir==='OUT'&&e.t>=start&&e.t<=low));
    const receipts=top3(o.events.filter(e=>e.dir==='IN'&&e.src==='sales_invoice'&&(e.scope==='beyond_horizon'||(e.scope==='in_horizon'&&e.t>low))));
    const W=uc01||{findings:[],cause_items:[],bn_pattern:'unknown'},links=[];
    const fCust=new Map(),fSup=new Map();W.findings.forEach(f=>{if(f.object.type==='customer')fCust.set(f.object.key,f);if(f.object.type==='supplier')fSup.set(f.object.key,f)});
    // SRS-DECISION: L1 needs an object-level finding (a customer with R-AR-OD); a company-level DSO finding does not link a single receipt.
    receipts.forEach(e=>{const f=fCust.get(e.key);if(f)links.push({type:'L1',item:'AR',finding_ids:[f.id],object:e.partner,event_ids:[e.id],amount:e.amt,
      evidence:e.tier==='customer'&&!/residual/.test(e.method||'')?'supported':'candidate',delay_tier:e.tier})});
    // AP: the overdue-payable schedule (offset + rank mod 5) of a supplier with a finding that falls inside the episode.
    const apOd=inH.filter(e=>e.dir==='OUT'&&e.src==='purchase_invoice'&&e.method==='overdue_spread'&&e.t>=epS&&e.t<=epE);
    [...new Set(apOd.map(e=>e.key))].forEach(k=>{const f=fSup.get(k);if(!f)return;const es=apOd.filter(e=>e.key===k);
      links.push({type:'L1',item:'AP',finding_ids:[f.id],object:es[0].partner,event_ids:es.map(e=>e.id),amount:sum(es,e=>e.amt),evidence:'candidate',method:'overdue_spread'})});
    const buys=inH.filter(e=>e.dir==='OUT'&&e.t>=start&&e.t<=low&&(e.src==='purchase_invoice'||e.cat==='new_materials'));
    if(W.cause_items.includes('INV')&&buys.length)links.push({type:'L2',item:'INV',finding_ids:W.findings.filter(f=>f.item==='INV').map(f=>f.id),object:null,
      event_ids:buys.map(e=>e.id),amount:sum(buys,e=>e.amt),evidence:'candidate'});
    const squeeze=links.some(l=>l.type==='L1'&&l.item==='AR')&&links.some(l=>l.type==='L1'&&l.item==='AP');
    const linkType=links.some(l=>l.type==='L1')?'L1':links.some(l=>l.type==='L2')?'L2':'L3';
    const evidence=linkType==='L3'?'not_applicable':links.some(l=>l.evidence==='supported')?'supported':'candidate';
    // "Main cause" is never used (no counterfactual test in this phase); with fallback delays only "contributing factor" applies.
    return {episode,outflows,receipts_after:receipts,links,squeeze,link_type:linkType,evidence_level:evidence,fallback_delays:receipts.some(e=>e.tier!=='customer')};
  }
  // Preconditions of UC02.7: run ok or provisional, TH01 with a matrix cell, W known, data not expired; BN0 is allowed (L3).
  function gapRequestCheck(run,uc01,freshnessLevel){
    if(run.th.th==='TH03')return {ok:false,reason:'th03',label:'idle_cash'};
    if(['missing_data','invalid_data','rejected'].includes(run.status))return {ok:false,reason:'status'};
    if(!uc01||uc01.wc_class==='unknown')return {ok:false,reason:'w_unknown'};
    if(freshnessLevel==='expired')return {ok:false,reason:'expired'};
    if(run.th.th!=='TH01')return {ok:false,reason:'not_th01'};
    if(!run.matrix.cell)return {ok:false,reason:'not_routed'};
    return {ok:true};
  }
  const deepFreeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))deepFreeze(v)});return Object.freeze(o)};
  // The immutable gap_request handed to UC03 (Table 2-78). Need date, peak and Cash0 needed come from Base; episodes from Base.
  function buildGapRequest(run,uc01,{scenario='base',health='insufficient_sample',createdAt}={}){
    const b=run.summary.base,factors=run.episodes.map(e=>contributingFactors(run,uc01,e,'base'));
    const order={L1:0,L2:1,L3:2},best=factors.reduce((a,f)=>!a||order[f.link_type]<order[a.link_type]?f:a,null);
    const findingIds=[...new Set(factors.flatMap(f=>f.links.flatMap(l=>l.finding_ids)))];
    return deepFreeze({request_id:'GR-'+hash(run.run_id+'|'+scenario),need_date:b.first_below_rtarget,peak_gap:b.peak_buffer,peak_date:b.peak_buffer_date,cash0_need:b.need_rtarget,
      episodes:run.episodes.map(e=>({start:e.start,end:e.end,low_date:e.low_date,peak_gap:e.peak_gap,censored:e.censored})),matrix_case_id:run.matrix.cell,
      main_bottleneck:uc01?uc01.main_bottleneck:null,finding_ids:findingIds,bn_pattern:uc01?uc01.bn_pattern:'unknown',cause_items:uc01?uc01.cause_items.slice():[],
      obligation_overdue:uc01?uc01.obligation_overdue:0,link_type:best?best.link_type:'L3',evidence_level:best?best.evidence_level:'not_applicable',model_health:health,
      scenario,cash0_status:run.cash0.status,run_id:run.run_id,snapshot_id:run.snapshot_id,
      versions:{formula:CFG.versions.formula,threshold:CFG.versions.threshold,config:run.config_version},created_at:createdAt||null});
  }

  /* ---------- UC02 · feedback loop after operation (section 2.8.15) ---------- */
  // Immutable forecast log of a run on a confirmed snapshot: daily balances of Base, Conservative, Optimistic and continuing_sales,
  // expected receipts per invoice with their delay level, TH, the matrix cell and the configuration version (BR-02.23).
  function forecastLog(run){
    const sc=run.fc.scenarios,pick=k=>sc[k].days.map(x=>[x.d,Math.round(x.close)]);
    return Object.freeze({run_id:run.run_id,snapshot_id:run.snapshot_id,as_of:run.as_of,start:run.fc.start,end:run.fc.end,mode:run.mode,config_version:run.config_version,
      days:{base:pick('base'),conservative:pick('conservative'),optimistic:pick('optimistic'),continuing_sales:pick('continuing_sales')},
      receipts:sc.base.events.filter(e=>e.src==='sales_invoice').map(e=>({invoice_id:e.id,date:e.t!=null?diso(e.t):null,amount:e.amt,tier:e.tier||null})),
      th:run.th.th,cell:run.matrix.cell,rtarget:run.reserves.rtarget});
  }
  const median=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const p90=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(.9*s.length)-1)]};
  // Reconciliation of a log with a newer confirmed snapshot (as_of' inside the log's horizon), matched by invoice_id over (as_of; as_of'].
  // Run-off logs: FB-2, FB-3, FB-4 and the missed-alert part of FB-6 only (FB-1 and FB-5 need the continuing mode and daily actual cash).
  function reconcile(log,snap){
    const A0=dnum(log.as_of),A1=dnum(snap.as_of);if(!(A1>A0)||A1>dnum(log.end))return {status:'not_applicable'};
    const byId=new Map((snap.sales||[]).map(s=>[s.id,s])),rows=[];let excluded=0;
    log.receipts.forEach(r=>{const s=byId.get(r.invoice_id);if(!s){excluded++;return}
      if(!s.fully_paid&&s.paid_amount_asof>0){excluded++;return}                 // partly paid or credited: left out (FB-E3)
      const paidIn=s.fully_paid&&s.paid&&dnum(s.paid)>A0&&dnum(s.paid)<=A1;
      const a=paidIn?s.amount:0,p=r.date&&dnum(r.date)>A0&&dnum(r.date)<=A1?r.amount:0;
      if(a===0&&p===0)return;
      rows.push({id:r.invoice_id,a,p,lag:paidIn&&r.date?dnum(s.paid)-dnum(r.date):null,tier:r.tier})});
    const sa=sum(rows,x=>x.a),sp=sum(rows,x=>x.p),lags=rows.filter(x=>x.lag!=null);
    const byTier={};lags.forEach(x=>{(byTier[x.tier||'none']=byTier[x.tier||'none']||[]).push(Math.abs(x.lag))});
    const actual=snap.fin.opening_cash,missed=log.th!=='TH01'&&actual!=null&&log.rtarget>0&&actual<log.rtarget;
    return {status:'ok',window:[log.as_of,snap.as_of],matched:rows.length,excluded,fb1:null,fb5:null,
      fb2:Math.max(sa,sp)>0?sum(rows,x=>Math.abs(x.a-x.p))/Math.max(sa,sp):null,fb3:sp>0?(sa-sp)/sp:null,
      fb4:{median:median(lags.map(x=>x.lag)),median_abs:median(lags.map(x=>Math.abs(x.lag))),p90_abs:p90(lags.map(x=>Math.abs(x.lag))),
        by_tier:Object.fromEntries(Object.entries(byTier).map(([k,v])=>[k,{median:median(v),p90:p90(v)}]))},fb6:{missed,actual_cash:actual}};
  }
  // model_health (Table 2-94): insufficient_sample below fb.min_matched; a missed alert degrades at once; otherwise the watch or degraded
  // thresholds must be exceeded in fb.consecutive_runs reconciliations in a row. It never changes TH, the matrix cell or the colours.
  function modelHealth(history){
    if(!history||!history.length)return 'insufficient_sample';
    const F=CFG.fb,last=history[history.length-1];if(last.matched<F.minMatched)return 'insufficient_sample';
    if(last.fb6&&last.fb6.missed)return 'degraded';
    const sev=r=>(r.fb3!=null&&Math.abs(r.fb3)>F.bias.degraded)||(r.fb2!=null&&r.fb2>F.wape.degraded);
    const wat=r=>(r.fb3!=null&&Math.abs(r.fb3)>F.bias.watch)||(r.fb2!=null&&r.fb2>F.wape.watch);
    const lastN=history.slice(-F.consecutiveRuns),full=lastN.length===F.consecutiveRuns&&lastN.every(r=>r.matched>=F.minMatched);
    if(full&&lastN.every(sev))return 'degraded';
    if(full&&lastN.every(r=>wat(r)||sev(r)))return 'watch';
    return 'ok';
  }
  // H3: a suggested value for the default delay and the overdue residual (median lag), never applied automatically.
  const calibrationProposal=(history,health)=>health==='watch'||health==='degraded'?{default_late:Math.max(0,Math.round(history[history.length-1].fb4.median??0)),applied:false}:null;

  /* ---------- Legacy case shape used by the chat flow, simulate() and rankFor() ---------- */
  function legacyCase(snap,scenario,{rtarget,cash0,ev,days}){
    const A=dnum(snap.as_of),lots=snap.lots||[];
    const sales=(snap.sales||[]).map(s=>[s.id,s.customer,s.amount,s.in_period?1:0,s.open?1:0,s.open?s.dpd:null,s.issue,s.due,s.paid,s.open_amount,s.key]);
    const pur=(snap.purchases||[]).map(p=>[p.supplier,p.amount,p.in_period?1:0,p.open?1:0,p.id,p.issue,p.due,p.paid,p.open?p.dpd:null,p.essential]);
    const inv=lots.map(x=>{const thr=CFG.inv.slowDays[x.type]||CFG.inv.unknownTypeSlowDays;
      return {name:x.name,type:x.type||'—',days:x.days,value:x.value,own:x.value_own,slow:x.owner!=='customer'&&x.days!=null&&x.days>thr?1:0,excl:x.owner==='customer'?1:0,
        owner:x.owner,cancelled:x.cancelled,pledged:x.pledged,qty:x.qty,unit:x.unit_cost}});
    const ar=snap.sales?sum(snap.sales,s=>s.open_amount):null,ap=snap.purchases?sum(snap.purchases,p=>p.open_amount):null,invv=snap.lots?sum(lots,x=>x.value_own):null;
    const f=snap.fin;
    return {firm:snap.firm.id,case:scenario,as_of:snap.as_of,N:snap.N,buffer:rtarget,days,ev,sales,pur,inv,rev:f.revenue,cogs:f.cogs,ar,invv,ap,
      ccc0:f.revenue>0&&f.cogs>0?ar/f.revenue*snap.N+invv/f.cogs*snap.N-ap/f.cogs*snap.N:null,dso0:null,defk:null,cash0,
      opening:[snap.firm.id,`${snap.period_start}..${snap.as_of}`,snap.N,f.revenue,f.cogs,f.opening_cash,null],est:snap.source.type==='upload',snap};
  }
  // The five scenario cases of one snapshot. Event tuples keep the legacy order [id, IN/OUT, category, partner, amount, date] plus a
  // metadata object (delay level, method, certainty) for the contributing-factor views.
  function buildCases(snap,opts={}){
    const cash0=opts.cash0!==undefined?opts.cash0:snap.fin.opening_cash,rt=opts.rtarget!==undefined?opts.rtarget:(snap.firm.rtarget||0);
    const fc=forecast(snap,{...opts,cash0}),out={};
    SCENARIOS.forEach(sc=>{const o=fc.scenarios[sc];
      const ev=o.events.filter(e=>e.scope==='in_horizon').sort((a,b)=>a.t-b.t).map(e=>[e.id,e.dir,e.cat,e.partner,e.amt,diso(e.t),{tier:e.tier,method:e.method,delay:e.delay,dpd:e.dpd,certainty:e.certainty,src:e.src,essential:e.essential,shift:e.shift}]);
      const c=legacyCase(snap,sc,{rtarget:rt,cash0:cash0??0,ev,days:o.days.map(x=>[x.d,x.close])});c.fc=fc;out[sc]=c});
    return out;
  }
  // UC03 Solutions and UC04 What-if run on these results in js/uc0304.js (SRS v2.3 sections 2.9 and 2.10).
  return {dnum,diso,sum,round,hash,normName,tri,GT,GE,LT,inferLotType,customerOwnedHint,cancelledHint,resolveFinancials,makeSnapshot,inputFromRaw,inputFromUpload,
    sizeLabel,relationLabel,customerTier,customerBase,decompose,modelOf,diagnose,behaviourLabel,supplierCategory,companySize,profiles,SCENARIOS,delayStats,delaySamples,delayModel,vatFactor,forecast,resolveCash0,millerOrr,resolveReserves,level,scenarioSummary,weeklyOf,blocks,shortfallEpisodes,cashState,runUC02,cashNeeded,contributingFactors,gapRequestCheck,buildGapRequest,forecastLog,reconcile,modelHealth,calibrationProposal,legacyCase,buildCases};
})();
