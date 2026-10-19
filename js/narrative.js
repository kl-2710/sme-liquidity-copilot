/* Deterministic answers for the chat (SRS 2.7.9 b, 2.8.13): no language model. Every number, date and name in an answer comes from
   the fact registry of the same run; verifyAnswer() checks the text against that registry and the wording rules before it is shown,
   and falls back to a minimal deterministic answer if anything does not match. */
const NARR=(()=>{
  // Phrases the answer must never contain (certainty, causal claims, forecasts presented as facts).
  const BANNED=[/\bcertainly\b/i,/\bguarantee/i,/\bjust need/i,/\bonly need/i,/caused? the (cash )?short(age|fall)/i,
    /closing balance will be/i,/main cause/i,/no (cash|money) problem/i];
  const tools=list=>`<p class="tools-used">${t('tools.used')}: ${list.join(', ')}</p>`;
  // Fact registry: id → {value, display}. Displays are exactly the strings written in the answer.
  function registry(){const f={};return {f,add:(id,value,display)=>{f[id]={value,display:String(display)};return String(display)}}}
  /* ---------- UC01 · five parts (Table 2-35) ---------- */
  function uc01Answer(d,firmName,opts={}){
    const R=registry(),A=R.add,m=d.metrics,P=d.profiles,th=d.thresholds,items=d.item_states,src=d.model.src==='owner_policy'?THRESHOLD_SOURCE.owner_policy:THRESHOLD_SOURCE.verified_reference;
    A('firm',firmName,firmName);A('asof',d.as_of,fd(d.as_of));A('N',d.N,d.N);A('model',d.model.model,d.model.model);
    const it=k=>items.find(i=>i.item===k),name=k=>tx('item.'+k);
    let p1;
    if(d.wc_class==='unknown')p1=d.inactive?tx('na.uc01.p1.inactive'):tx('na.uc01.p1.unknown',{f:d.missing.join(', ')});
    else if(d.bn_pattern==='BN0'){p1=tx('na.uc01.p1.bn0',{dso:A('dso',m.dso,nf(m.dso,1)),a:A('dso_w',th.dso.watch,nf(th.dso.watch,1)),dio:A('dio',m.dio,nf(m.dio,1)),b:A('dio_w',th.dio.watch,nf(th.dio.watch,1)),dpo:A('dpo',m.dpo,nf(m.dpo,1))});
      const near=items.filter(i=>i.near_threshold);near.forEach(i=>{p1+=' '+tx('na.uc01.p1.near',{item:name(i.item),p:A('near_'+i.item,i.value/i.watch,pct(i.value/i.watch,0))})})}
    else p1=tx(d.wc_class==='W2'?'na.uc01.p1.W2':'na.uc01.p1.W1',{main:name(d.main_bottleneck),items:d.cause_items.map(name).join(', ')});
    if(!d.model.declared)p1+=' '+tx('w.model.unconfirmed')+'.';
    // 2. Where the money is.
    const ar=it('AR'),inv=it('INV'),ap=it('AP');
    const p2=[ar.value!=null?tx('na.uc01.p2.ar',{v:A('ar',m.AR,money(m.AR)),d:A('dso',m.dso,nf(m.dso,1)),cmp:tx(ar.value>ar.watch?'na.above':'na.below'),w:A('dso_w',th.dso.watch,nf(th.dso.watch,1)),s:A('thr_src',src,src)}):'',
      inv.value!=null?tx('na.uc01.p2.inv',{v:A('inv',m.INV,money(m.INV)),d:A('dio',m.dio,nf(m.dio,1)),cmp:tx(inv.value>inv.watch?'na.above':'na.below'),w:A('dio_w',th.dio.watch,nf(th.dio.watch,1))}):'',
      ap.value!=null?tx('na.uc01.p2.ap',{v:A('ap',m.AP,money(m.AP)),d:A('dpo',m.dpo,nf(m.dpo,1))}):''].filter(Boolean).join(' ');
    // 3. Who holds it.
    const top=P.customers.find(c=>c.key===P.exposureOrder[0]),sup=P.suppliers.slice().sort((a,b)=>b.overdue-a.overdue)[0],lotOld=P.lots.find(l=>l.name===P.oldest_lot),lotSlow=P.lots.find(l=>l.name===P.largest_slow_lot);
    const p3=[top?tx('na.uc01.p3.cust',{c:A('cust_top',top.name,top.name),s:A('cust_share',top.ar_share,pct(top.ar_share,1)),o:A('cust_od',top.overdue,money(top.overdue))}):'',
      lotSlow?tx('na.uc01.p3.lot',{l:A('lot_slow',lotSlow.name,lotSlow.name),v:A('lot_slow_v',lotSlow.value_own,money(lotSlow.value_own)),d:A('lot_slow_d',lotSlow.days,lotSlow.days)}):'',
      lotOld&&lotOld!==lotSlow?tx('na.uc01.p3.old',{l:A('lot_old',lotOld.name,lotOld.name),d:A('lot_old_d',lotOld.days,lotOld.days)}):'',
      sup&&sup.overdue>0?tx('na.uc01.p3.sup',{s:A('sup_top',sup.name,sup.name),o:A('sup_od',sup.overdue,money(sup.overdue)),e:tx('lbl.'+sup.essential)}):''].filter(Boolean).join(' ');
    // 4. How worrying.
    const p4=d.wc_class==='unknown'?tx('na.uc01.p4.unknown'):d.bn_pattern==='BN0'?tx('na.uc01.p4.bn0')
      :tx('na.uc01.p4',{mar:A('mar',d.money_at_risk,money(d.money_at_risk)),s:A('share',d.materiality_share,pct(d.materiality_share,1)),bn:d.bn_pattern})+(d.obligation_overdue>0?' '+tx('na.uc01.p4.ob',{o:A('ob',d.obligation_overdue,money(d.obligation_overdue))}):'')
        +(d.concentration&&d.cause_items.includes('AR')?' '+tx('na.uc01.p4.conc.'+d.concentration.flag,{c:A('conc_c',d.concentration.top.name,d.concentration.top.name),s:A('conc_s',d.concentration.top.share,pct(d.concentration.top.share,0))}):'');
    // 5. What to check and the limits.
    const checks=[];d.findings.slice(0,3).forEach(f=>{if(f.object.type==='customer')checks.push(tx('na.chk.cust',{c:A('f_'+f.id,f.object.name,f.object.name)}));else if(f.object.type==='lot')checks.push(tx('na.chk.lot',{l:A('f_'+f.id,f.object.name,f.object.name)}));
      else if(f.object.type==='supplier')checks.push(tx('na.chk.sup',{s:A('f_'+f.id,f.object.name,f.object.name)}));else checks.push(tx('na.chk.'+f.item))});
    const limits=[tx('na.uc01.lim',{d:A('asof',d.as_of,fd(d.as_of)),n:A('N',d.N,d.N)})];
    if(d.provisional.includes('COGS_CONVERTED'))limits.push(tx('na.lim.cogs',{d:A('cogs_days',m.cogs_days,m.cogs_days),n:A('N',d.N,d.N)}));
    if(d.provisional.includes('CURRENT_ASSETS_ASSUMED'))limits.push(tx('na.lim.ca'));
    const p5=(checks.length?tx('na.uc01.p5',{c:[...new Set(checks)].join('; ')})+' ':'')+limits.join(' ');
    const parts=[['1',tx('na.uc01.h1'),p1],['2',tx('na.uc01.h2'),p2],['3',tx('na.uc01.h3'),p3],['4',tx('na.uc01.h4'),p4],['5',tx('na.uc01.h5'),p5]];
    const html=`<div class="ans ans5">${parts.map(([n,h,x])=>`<p><b>${n}. ${h}.</b> ${x||'—'}</p>`).join('')}</div>`;
    const entities=[firmName,...P.customers.map(c=>c.name),...P.suppliers.map(s=>s.name),...P.lots.map(l=>l.name)];
    return {html,facts:R.f,entities,kind:'uc01',bn0:d.bn_pattern==='BN0',tool:'diagnose_working_capital'};
  }
  /* ---------- UC02 · four parts (Table 2-91) ---------- */
  function uc02Answer(u,d,ctx){
    const R=registry(),A=R.add,b=u.summary.base,Rv=u.reserves,base=u.fc.scenarios.base,low=b.min_date;
    const at=sc=>{const x=u.fc.scenarios[sc].days.find(z=>z.d===low);return x?x.close:null};
    const prov=u.cash0.status!=='confirmed';
    const p1=tx(prov?'na.uc02.p1.prov':'na.uc02.p1',{lv:tx('lv.'+(u.overall==='unknown'?'na':u.overall)),min:A('min',b.min,money(b.min)),d:A('min_d',low,fd(low)),rt:A('rt',Rv.rtarget,money(Rv.rtarget)),
      need:A('need',b.need_rtarget,money(b.need_rtarget)),th:tx('th.'+u.th.th)+(u.matrix.cell&&!SIMPLE()?` (${u.matrix.cell})`:''),w:A('weeks',u.weeks,u.weeks)})
      +(b.first_below_rtarget?' '+tx('na.uc02.p1.first',{d:A('first',b.first_below_rtarget,fd(b.first_below_rtarget)),z:b.first_negative?A('first0',b.first_negative,fd(b.first_negative)):tx('ov.none')}):'');
    const tight=u.weekly.reduce((a,w)=>w.min<a.min?w:a,u.weekly[0]);
    const p2=(u.episodes.length?tx('na.uc02.p2.eps',{n:A('neps',u.episodes.length,u.episodes.length),last:u.episodes.some(e=>e.censored)?tx('na.uc02.p2.open'):''}):tx('na.uc02.p2.none'))+' '
      +tx('na.uc02.p2.week',{w:A('tw',tight.w,tight.w),a:A('tw_a',tight.start,fd(tight.start)),b:A('tw_b',tight.end,fd(tight.end)),v:A('tw_min',tight.min,money(tight.min))})+' '
      +tx('na.uc02.p2.band',{c:A('band_c',at('conservative'),money(at('conservative'))),o:A('band_o',at('optimistic'),money(at('optimistic')))});
    const cf=ctx.factors;
    const out=cf&&cf.outflows[0],rc=cf&&cf.receipts_after[0];
    let p3=out?tx('na.uc02.p3.out',{c:lblCat(out.cat),v:A('out_v',out.amt,money(out.amt)),d:A('out_d',isoOf(out.t),fd(isoOf(out.t)))}):'';
    if(rc)p3+=' '+tx('na.uc02.p3.in',{c:A('in_c',rc.partner,rc.partner),v:A('in_v',rc.amt,money(rc.amt)),d:rc.t!=null?A('in_d',isoOf(rc.t),fd(isoOf(rc.t))):tx('cf.beyond')});
    if(cf)p3+=' '+(cf.link_type==='L3'?tx('link.L3'):tx('na.uc02.p3.link',{l:cf.link_type,e:tx('ev.'+cf.evidence_level),f:[...new Set(cf.links.flatMap(l=>l.finding_ids))].join(', ')}));
    p3+=' '+tx('na.uc02.p3.stuck',{ar:A('stuck_ar',d.metrics.total_overdue_ar,money(d.metrics.total_overdue_ar)),inv:A('stuck_inv',d.profiles.stuck_inventory,money(d.profiles.stuck_inventory))});
    const lims=[tx(prov?'na.lim.cash0.prov':'na.lim.cash0',{c:A('cash0',u.cash0.value,money(u.cash0.value))}),tx('na.lim.runoff'),tx('na.lim.delay')];
    if(u.fc.vat.status==='net_no_rate')lims.push(tx('na.lim.vat'));
    if(Rv.src.rmin==='demo_assumption'||Rv.src.rupper==='demo_assumption')lims.push(tx('na.lim.reserve'));
    lims.push(tx('na.lim.decision'));
    const parts=[['1',tx('na.uc02.h1'),p1],['2',tx('na.uc02.h2'),p2],['3',tx('na.uc02.h3'),p3],['4',tx('na.uc02.h4'),lims.join(' ')]];
    const html=`<div class="ans ans4">${parts.map(([n,h,x])=>`<p><b>${n}. ${h}.</b> ${x}</p>`).join('')}</div>`;
    const entities=[...Object.values(u.fc.delays.receipts).map(x=>x.name),...Object.values(u.fc.delays.payments).map(x=>x.name)];
    return {html,facts:R.f,entities,kind:'uc02',cash0Provisional:prov,runOff:true,tool:'forecast_cash'};
  }
  /* ---------- Controls (E5 / EC-6) ---------- */
  const plain=html=>String(html).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  // Numeric tokens not glued to letters (codes such as W2, BN7, P75, M7, TH01, F-AR-1 are not quantities).
  const NUM=/(?<![\p{L}\d\-_.,])[−-]?\d[\d.]*(?:,\d+)?(?:\s?(?:%|M|bn|days?)(?![\p{L}\d]))?/gu;
  const DATE=/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/g;
  // opts.foreign: names that belong to other companies or runs; none of them may appear in the answer.
  function verifyAnswer(ans,opts={}){
    const text=plain(ans.html),issues=[],displays=Object.values(ans.facts).map(f=>f.display);
    const own=ans.entities||[];(opts.foreign||[]).forEach(n=>{if(n&&n.length>3&&text.includes(n)&&!own.some(o=>o.includes(n)||n.includes(o)))issues.push('entity:'+n)});
    BANNED.forEach(re=>{if(re.test(text))issues.push('banned:'+re.source)});
    const dates=text.match(DATE)||[];dates.forEach(x=>{if(!displays.some(s=>s.includes(x)))issues.push('date:'+x)});
    // Part numbers (1.–5.) are single digits; trailing punctuation is not part of a quantity.
    const rest=text.replace(DATE,' ');(rest.match(NUM)||[]).forEach(x=>{const k=x.trim().replace(/[.,]+$/,'');if(/^\d$/.test(k))return;if(!displays.some(s=>s.includes(k)||k.includes(s)&&s.length>1))issues.push('number:'+k)});
    if(ans.kind==='uc02'){if(ans.cash0Provisional&&!/provisional|estimate/i.test(text))issues.push('missing:cash0_provisional');if(ans.runOff&&!/run-off|no new sales/i.test(text))issues.push('missing:run_off')}
    return {ok:!issues.length,issues};
  }
  // Minimal deterministic answer used when a draft fails the controls.
  function fallback(ans){
    const f=ans.facts,g=k=>f[k]?f[k].display:'—';
    const html=ans.kind==='uc01'?`<div class="ans"><p>${t('na.fb.uc01',{asof:g('asof'),n:g('N')})}</p></div>`:`<div class="ans"><p>${t('na.fb.uc02',{min:g('min'),d:g('min_d'),need:g('need')})}</p></div>`;
    return {...ans,html,fallback:true};
  }
  function finalize(ans,opts={}){const v=verifyAnswer(ans,opts);const out=v.ok?ans:fallback(ans);out.verification=v;out.html+=tools([ans.tool]);return out}
  return {uc01Answer,uc02Answer,verifyAnswer,fallback,finalize,plain,tools,BANNED};
})();
