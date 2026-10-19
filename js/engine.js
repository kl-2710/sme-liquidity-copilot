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
    const start=periodStart||diso(A-182),N=A-dnum(start)+1,issues=[];
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

  /* ---------- Interim cash schedule (replaced by the SRS v1.3 delay model in phase E) ---------- */
  function lateWavg(rows){const w=sum(rows,r=>r.amount);return w?sum(rows,r=>r.amount*Math.max(0,dnum(r.paid)-dnum(r.due)))/w:null}
  function schedule(snap,scenario){
    const A=dnum(snap.as_of),start=A+1,ev=[],by={};
    (snap.sales||[]).forEach(s=>{if(s.fully_paid&&s.due)(by[s.key]=by[s.key]||[]).push(s)});
    (snap.sales||[]).filter(s=>s.open&&s.due).forEach(s=>{
      const h=by[s.key]||[],d=h.length>=CFG.ar.minHistory?Math.ceil(lateWavg(h)-1e-9):0;
      let t=Math.max(start,dnum(s.due)+d);if(scenario==='stress_7')t+=CFG.tv2.stressDays;
      ev.push([s.id,'IN','invoice_receipt',s.customer,s.open_amount,diso(t)])});
    (snap.purchases||[]).filter(p=>p.open&&p.due).forEach(p=>ev.push([p.id,'OUT','supplier_payment',p.supplier,p.open_amount,diso(Math.max(start,dnum(p.due)))]));
    snap.planned.forEach(p=>{const t=p.date?dnum(p.date):A+(p.week-1)*7+4;if(t<start)return;ev.push(planEvent(p,t))});
    return ev;
  }
  // Planned flows keep their category code when it is a known one (payroll, tax…); otherwise the file's own label is the partner.
  const KNOWN_CAT=new Set(['payroll','rent','utilities','new_materials','tax','debt_service','capex']);
  const planEvent=(p,t)=>{const known=KNOWN_CAT.has(p.category);return [p.id,p.direction,known?p.category:(p.direction==='IN'?'planned_inflow':'planned_outflow'),known?'Planned item':(p.category||'Planned item'),p.amount,diso(t)]};
  function ledger(cash0,ev,A,days=91){
    const by=new Map();ev.forEach(e=>{const d=dnum(e[5]);by.set(d,(by.get(d)||0)+(e[1]==='IN'?e[4]:-e[4]))});
    let run=cash0;const out=[];for(let t=A+1;t<=A+days;t++){run+=by.get(t)||0;out.push([diso(t),run])}return out;
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
  // Interim: base and stress_7 cases with the earlier prototype schedule.
  function buildCases(snap){
    const rt=snap.firm.rtarget||0,cash0=snap.fin.opening_cash||0,A=dnum(snap.as_of),out={};
    ['base','stress_7'].forEach(sc=>{const ev=schedule(snap,sc);out[sc]=legacyCase(snap,sc,{rtarget:rt,cash0,ev,days:ledger(cash0,ev,A)})});
    return out;
  }
  return {dnum,diso,sum,round,hash,normName,tri,inferLotType,customerOwnedHint,cancelledHint,resolveFinancials,makeSnapshot,inputFromRaw,inputFromUpload,
    schedule,ledger,legacyCase,buildCases};
})();
