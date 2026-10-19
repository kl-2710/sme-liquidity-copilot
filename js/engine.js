/* Deterministic UC01/UC02 engine (SRS v1.3). Pure functions: no DOM, no network, no language model.
   The sample companies (DATA.raw) and uploaded files go through the same normalisation and the same rules (BR-02.18).
   Money is VND; dates are ISO strings (YYYY-MM-DD) or day numbers (days since 1970-01-01, UTC). */
const ENGINE=(()=>{
  const DAYMS=864e5;
  const dnum=s=>{const [y,m,d]=String(s).slice(0,10).split('-').map(Number);return Date.UTC(y,m-1,d)/DAYMS};
  const diso=n=>new Date(n*DAYMS).toISOString().slice(0,10);
  const sum=(a,f=x=>x)=>a.reduce((s,x)=>s+f(x),0);
  const round=(v,d=0)=>{const p=10**d;return Math.round(v*p)/p};
  const normName=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ').trim();
  // FNV-1a: deterministic ids (snapshot, run) so the same inputs always give the same id.
  const hash=s=>{let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36).toUpperCase()};
  // Threshold comparisons on unrounded values: a relative tolerance keeps binary rounding from flipping exact decimal boundaries
  // (5.00 % materiality is W2, T07; DSO equal to the watch threshold gives no signal, T08).
  const EPS=1e-9,tol=b=>EPS*Math.max(1,Math.abs(b)),GT=(a,b)=>a>b+tol(b),GE=(a,b)=>a>=b-tol(b),LT=(a,b)=>a<b-tol(b);
  const tri=v=>{const s=String(v==null?'':v).trim().toLowerCase();return ['1','true','yes','y','có','co'].includes(s)?'yes':['0','false','no','n','không','khong'].includes(s)?'no':'unknown'};

  /* ---------- Inventory hints (suggestions only, never applied without confirmation) ---------- */
  // inventory_type inferred from the lot name when the file has no inventory_type column (provisional, Table 2-43).
  function inferLotType(name){
    const n=normName(name);
    if(/work in progress|\bwip\b|semi.?finished|ban thanh pham|do dang|on the line/.test(n))return 'BTP';
    if(/finished|carton|thanh pham|awaiting shipment|cho xuat/.test(n))return 'TP';
    if(/for resale|trading goods|hang hoa|merchandise/.test(n))return 'HH';
    if(/fabric|trim|thread|button|zipper|label|yarn|paper|ink|glue|material|nguyen|phu lieu|vai|chi|nut|khoa|giay|muc|keo/.test(n))return 'NVL';
    return null;
  }
  const customerOwnedHint=name=>/subcontract|customer.?owned|consign|supplied by|held for|giao de gia cong|hang gia cong|nhan gia cong/.test(normName(name));
  const cancelledHint=name=>/\bhuy\b|cancel/.test(normName(name));

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
      let term=due&&issue?dnum(due)-dnum(issue):null,termAssumed=false;
      if(term==null&&due){term=CFG.ar.termFallbackDays;termAssumed=true}       // invoice without issue date: fallback term, flagged
      const p=party(kind==='sale'?r.customer:r.supplier,r.tax_code);
      return {...r,issue,due,key:p.key,key_weak:p.weak,paid_amount_asof:paidAmt,open_amount:open,advance,open:open>0,
        fully_paid:paidAt&&paidAmt>=r.amount,dpd,term,term_assumed:termAssumed,rho:dpd!=null&&term!=null?dpd/Math.max(1,term):null,missing_due:!due,
        in_period:!!issue&&dnum(issue)>=dnum(start)&&dnum(issue)<=A};
    };
    const sales=input.tables.sales?input.sales.map(r=>inv(r,'sale')).filter(Boolean):null;
    const purchases=input.tables.purchases?input.purchases.map(r=>inv(r,'purchase')).filter(Boolean):null;
    const essential=new Set((input.firm.essential_suppliers||[]).map(normName));
    if(purchases)purchases.forEach(p=>{if(p.essential!=='yes'&&p.essential!=='no')p.essential=essential.has(normName(p.supplier))?'yes':'unknown'});
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
    return {firm:input.firm,source:input.source,snapshot_id:sid,data_snapshot_id:input.snapshot_id,data_as_of:dataAsOf,
      as_of:cut,period_start:start,N,fin,sales,purchases,lots,planned:input.planned||[],config:input.config||{amount_basis:'net',vat_rate:null},
      tables:input.tables,issues,shifted:shift!==0};
  }
  // DATA.raw sample record → engine input.
  function inputFromRaw(raw,loadedAt){
    return {firm:raw.firm,snapshot_id:raw.snapshot.id,as_of:raw.snapshot.as_of,source:{type:'sample',id:raw.snapshot.source,at:loadedAt},
      fin:raw.fin,config:raw.config,tables:{sales:true,purchases:true,inventory:true,planned:true},
      sales:raw.sales.map(([id,customer,amount,issue,due,paid])=>({id,customer,amount,issue,due,paid,paid_amount:null,tax_code:null})),
      purchases:raw.purchases.map(([id,supplier,amount,issue,due,paid,disc_pct,disc_days])=>({id,supplier,amount,issue,due,paid,paid_amount:null,disc_pct,disc_days,tax_code:null,essential:null})),
      inventory:raw.inventory.map(([name,type,qty,unit_cost,days,owner,cancelled,pledged])=>({name,type,qty,unit_cost,days,owner,cancelled,pledged})),
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
    arFlagged.forEach(x=>{p[x.tier>=4?1:x.tier<=2?2:3]+=x.amount});
    slowLots.forEach(x=>{p[x.cancelled?6:5]+=x.amount});
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
    const inactive=(rev!=null&&rev<=0)||(cogs!=null&&cogs<=0);
    // Aggregate signals (strictly greater than the threshold, T08).
    const lvl=(v,t)=>v==null?0:GT(v,t.severe)?2:GT(v,t.watch)?1:0;
    const aAR=lvl(dso,T.dso),aINV=lvl(dio,T.dio);
    // Invoice level R-AR-OD: ρ = overdue days ÷ the invoice's own term (A12). Invoices without a due date never signal (T13).
    const arOD=(sales||[]).filter(s=>s.open&&s.dpd>0&&s.rho!=null&&GT(s.rho,CFG.ar.rhoWatch)).map(s=>({inv:s,level:GT(s.rho,CFG.ar.rhoSevere)?2:1}));
    // Lot level R-INV-SLOW by type (NVL/HH > 60 days, BTP/TP > 30 days); severe at twice the watch age or a confirmed cancelled order.
    const slow=(lots||[]).filter(l=>l.owner!=='customer').map(l=>{
      const thr=CFG.inv.slowDays[l.type]||CFG.inv.unknownTypeSlowDays,aged=l.days!=null&&l.days>thr,cancelled=l.cancelled==='yes';
      if(!aged&&!cancelled)return null;
      return {lot:l,thr,over:l.days!=null?l.days-thr:null,level:cancelled||(l.days!=null&&l.days>2*thr)?2:1,cancelled:cancelled||l.cancel_proposed,cancel_confirmed:cancelled};
    }).filter(Boolean);
    // Purchase level R-AP-OD: ρ > 0.5 is a watch signal; any overdue amount to an essential supplier is severe.
    const apOD=(pur||[]).filter(p=>p.open&&p.dpd>0&&((p.rho!=null&&GT(p.rho,CFG.ap.rhoWatch))||p.essential==='yes')).map(p=>({inv:p,level:p.essential==='yes'?2:1}));
    const ap1=dpo!=null&&cashBuffer!=null&&LT(dpo,T.dpo.low)&&LT(cashBuffer,T.bufThin);     // R-AP-1
    const apInfo=dpo!=null&&GT(dpo,T.dpo.high);                                            // R-AP-INFO: note only, never a signal (T09)
    // Capital above threshold E_i with double-count protection (Table 2-52).
    const aggAR=aAR?(dso-T.dso.watch)*rev/N:0,odAR=sum(arOD,x=>x.inv.open_amount);
    const aggINV=aINV?(dio-T.dio.watch)*cogs/N:0,slowV=sum(slow,x=>x.lot.value_own);
    const E_AR=aAR||arOD.length?Math.max(aggAR,odAR):0,E_INV=aINV||slow.length?Math.max(aggINV,slowV):0,E_AP=sum(apOD,x=>x.inv.open_amount);
    const caV=ca.value,m=E=>caV>0?E/caV:0;
    const has={AR:!!(aAR||arOD.length),INV:!!(aINV||slow.length),AP:!!(ap1||apOD.length)};
    const c={AR:!has.AR?0:aAR===2||GE(m(E_AR),mat)?2:1,INV:!has.INV?0:aINV===2||GE(m(E_INV),mat)?2:1,AP:!has.AP?0:GE(m(E_AP),mat)?2:1};
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
    const share=caV>0?Math.max(E_AR,E_INV,E_AP)/caV:null;
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
      money_at_risk:!unknown&&cause.length?E_AR+E_INV:0,obligation_overdue:unknown?0:E_AP,bn_pattern:bn,cause_items:unknown?[]:cause.map(i=>i.item),
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
  function supplierCategory(name){
    const n=normName(name);
    if(/logistic|customs|thong quan/.test(n))return {cat:'logistics_customs',extendable:false};
    if(/electric|power|water|utility|dien|nuoc/.test(n))return {cat:'utilities',extendable:false};
    if(/transport|freight|van tai/.test(n))return {cat:'transport',extendable:true};
    if(/trim|thread|button|zipper|label|packag|carton|phu lieu|bao bi|ink|consumable|muc in|chi|nut|khoa/.test(n))return {cat:'trims_packaging',extendable:true};
    if(/fabric|yarn|paper roll|mill|vai|giay cuon|soi/.test(n))return {cat:'main_material',extendable:false};
    return {cat:'unknown',extendable:null};
  }
  function companySize(annual){
    if(annual==null)return {tier:null,status:'missing_data'};
    const z=CFG.size,tier=annual<=z.micro?'micro':annual<=z.small?'small':annual<=z.medium?'medium':'beyond_sme';
    const cap=tier==='micro'?z.micro:tier==='small'?z.small:tier==='medium'?z.medium:null;
    // Without total capital and headcount the tier is provisional by revenue only (Table 2-46, A48).
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
  // Amount-weighted statistics: Base = weighted mean, Optimistic = P25, Conservative = P75. SRS-DECISION: P25/P75 are amount-weighted
  // quantiles (the first sample whose cumulative weight reaches p), consistent with the weighted Base; P25 ≤ Base ≤ P75 is enforced (T2-04).
  function wQuantile(sorted,tot,p){let acc=0;for(const s of sorted){acc+=s.w;if(acc>=p*tot-1e-9)return s.late}return sorted.length?sorted[sorted.length-1].late:null}
  function delayStats(samples){
    if(!samples||!samples.length)return null;const tot=sum(samples,s=>s.w);if(!(tot>0))return null;
    const sorted=samples.slice().sort((a,b)=>a.late-b.late),mean=sum(samples,s=>s.w*s.late)/tot,p25=wQuantile(sorted,tot,.25),p75=wQuantile(sorted,tot,.75);
    return {base:Math.min(Math.max(mean,p25),p75),optimistic:p25,conservative:p75,mean,n:samples.length};
  }
  // Samples with a due date in (as_of − lookback; as_of]: paid in full → MAX(0; paid − due); still open and overdue → as_of − due
  // (a truncated sample, a lower bound of the real delay, BR-02.13). Partly paid invoices that are still open count as open.
  function delaySamples(rows,A){
    const out=[];(rows||[]).forEach(r=>{if(!r.due)return;const due=dnum(r.due);if(!(due>A-CFG.tv2.delay.lookbackDays&&due<=A))return;
      if(r.fully_paid&&r.paid)out.push({id:r.id,key:r.key,late:Math.max(0,dnum(r.paid)-due),w:r.amount,truncated:false});
      else if(r.open)out.push({id:r.id,key:r.key,late:A-due,w:r.amount,truncated:true})});
    return out;
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
    return {receipts:build(snap.sales),payments:build(snap.purchases)};
  }
  // Cash basis of invoice amounts (T2-22): gross → 1; net with a rate → 1 + rate; net without a rate → 1 and provisional (never 10 % by default).
  function vatFactor(cfg){const c=cfg||{};if(c.amount_basis==='gross')return {f:1,status:'gross'};if(c.vat_rate>0)return {f:1+c.vat_rate,status:'net_with_rate'};return {f:1,status:'net_no_rate'}}
  const KNOWN_CAT=new Set(['payroll','rent','utilities','new_materials','tax','debt_service','capex']);
  function forecast(snap,opts={}){
    const T=CFG.tv2,A=dnum(snap.as_of),start=A+1,HD=7*T.horizonWeeks,end=A+HD,D=delayModel(snap),vat=vatFactor(opts.config||snap.config),issues=[];
    const essential=new Set((opts.essentialSuppliers||snap.firm.essential_suppliers||[]).map(normName));
    const isEssential=p=>p.essential==='yes'||essential.has(normName(p.supplier)),apTiming=opts.apTiming||'historical';
    const openSales=(snap.sales||[]).filter(s=>s.open),openPur=(snap.purchases||[]).filter(p=>p.open);
    const odPur=openPur.filter(p=>p.due&&dnum(p.due)<=A).sort((a,b)=>dnum(a.due)-dnum(b.due)||(a.id<b.id?-1:a.id>b.id?1:0));
    const byK={};
    ['base','optimistic','conservative'].forEach(k=>{
      const rec=openSales.map(s=>{
        const amt=s.open_amount*vat.f,base={id:s.id,dir:'IN',cat:'invoice_receipt',partner:s.customer,amt,certainty:'estimated',src:'sales_invoice',key:s.key};
        if(!s.due)return {...base,t:null,method:'no_due_date'};
        const due=dnum(s.due),tr=D.receipts.tierOf(s.key);let delay,method;
        if(due>A){delay=tr.tier==='default'?T.delay.defaultLate:tr.stats[k];method=tr.tier}          // not yet due: due + CEILING(delay), not before Start
        else{const dpd=A-due,cond=tr.set.filter(x=>x.late>=dpd&&x.id!==s.id);                     // overdue: conditional delay on samples late ≥ dpd
          // SRS-DECISION: the invoice's own truncated sample is left out of its conditional set (it would only say "late ≥ dpd").
          if(tr.tier!=='default'&&cond.length>=T.delay.conditionalMinN){delay=delayStats(cond)[k];method=tr.tier+'_conditional'}
          else{delay=dpd+T.overdueResidual[k];method='residual'}}
        return {...base,t:Math.max(start,due+ceilT(delay)),tier:tr.tier,n:tr.n,method,delay,dpd:due<=A?A-due:0};
      });
      const pay=openPur.map(p=>{
        const amt=p.open_amount*vat.f,ess=isEssential(p),base={id:p.id,dir:'OUT',cat:'supplier_payment',partner:p.supplier,amt,certainty:'confirmed',src:'purchase_invoice',key:p.key,essential:ess};
        if(!p.due)return {...base,t:null,method:'no_due_date'};
        const due=dnum(p.due);
        if(due<=A){const rank=odPur.indexOf(p);return {...base,t:A+T.apOverdueOffset[k]+(rank%5),method:'overdue_spread',rank}}   // as_of + off + (rank mod 5)
        if(k==='conservative'||ess||apTiming==='due')return {...base,t:Math.max(start,due),method:ess?'essential_due':'due'};
        const tr=D.payments.tierOf(p.key),L=tr.stats?tr.stats.mean:0;                                      // historical: due + CEILING(L_sup)
        return {...base,t:Math.max(start,due+ceilT(L)),method:'historical_'+tr.tier,delay:L};
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
      let t=null;if(p.date)t=dnum(p.date);else if(p.week){t=A+(p.week-1)*7+4;weeklyOnly=true}   // nominal day inside the week, never published as a daily figure
      if(t!=null&&t<start){issues.push({code:'PLAN_BEFORE_START',severity:'warning',id:p.id});return}
      plans.push({...base,t,method:p.date?'plan_date':p.week?'plan_week':'no_date'});
    });
    // continuing_sales (T2-21): new revenue each week = period revenue ÷ (N / 7), received at issue + average term + company delay.
    // SRS-DECISION: new sales are issued on the first day of each forecast week; the delay is the company-pool Base delay.
    const per=(snap.sales||[]).filter(s=>s.in_period&&s.due&&s.issue),wt=sum(per,s=>s.amount);
    const avgTerm=wt?sum(per,s=>s.amount*(dnum(s.due)-dnum(s.issue)))/wt:CFG.ar.termFallbackDays;
    const poolDelay=D.receipts.pool.n>=T.delay.minN?D.receipts.pool.stats.base:T.delay.defaultLate;
    const weekly=snap.fin.revenue>0?snap.fin.revenue/(snap.N/7)*vat.f:0;
    const newSales=weekly>0?Array.from({length:T.horizonWeeks},(_,i)=>{const iss=start+7*i;
      return {id:'NS-W'+(i+1),dir:'IN',cat:'new_sales',partner:'New sales (assumed)',amt:weekly,certainty:'estimated',src:'continuing_sales',t:iss+ceilT(avgTerm+poolDelay),issue:diso(iss),method:'continuing_sales'}}):[];
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
  return {dnum,diso,sum,round,hash,normName,tri,GT,GE,LT,inferLotType,customerOwnedHint,cancelledHint,resolveFinancials,makeSnapshot,inputFromRaw,inputFromUpload,
    sizeLabel,relationLabel,customerTier,customerBase,decompose,modelOf,diagnose,behaviourLabel,supplierCategory,companySize,profiles,SCENARIOS,delayStats,delaySamples,delayModel,vatFactor,forecast,legacyCase,buildCases};
})();
