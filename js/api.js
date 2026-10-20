/* Lilact service layer (the "server" of this static build): every write and every agent tool goes through API.call(),
   which checks the session role and the enterprise scope before anything else (SRS v2.10 3.2.1, Table 3-3, Table 3-7).
   Roles are read from the stored account of the session, never from the interface, a question or the language model.
   It also holds the Approval queue of UC04.6–UC04.8 (2.10.9): drafts built from a saved UC04 test, the checks CK-01…CK-12,
   the four statuses, versioned edits, owner-only decisions with a fresh identity confirmation, and submit_action, which
   only writes a tier-3 action log entry in simulation mode. Nothing is ever sent outside the application.
   This build has no network server: the layer runs in the browser and stores its records in localStorage per enterprise.
   The checks are real (the UI and the chat both call them), but browser storage is not a security boundary (see PORTING). */
const API=(()=>{
  const KU='smefc.users.v1',KS='smefc.session.v1';
  const ROLES={owner:'Business Owner',accountant:'Accountant'};
  const both=['owner','accountant'],own=['owner'];
  // Table 3-3 (two-role permission matrix) and Table 2-135 (draft actions). Deny by default: an operation that is not listed is refused.
  const PERM={
    'data.view':both,'data.upload':both,'evidence.view':both,
    'run.uc01':both,'run.uc02':both,'run.uc03':both,'run.uc04':both,
    'policy.propose':both,'policy.confirm':own,'catalogue.confirm':own,'source.exclude':both,
    'draft.view':both,'draft.create':both,'draft.edit':both,'draft.review':both,'draft.withdraw':both,'draft.regenerate':both,'draft.revise':both,
    'draft.approve':own,'draft.reject':own,'draft.return':own,'draft.copy':both,
    'audit.view':both,'team.manage':own,'export':both
  };
  // Table 3-7: the only tools the chat may call. submit_action is not a tool.
  const TOOLS={diagnose_working_capital:'run.uc01',forecast_cash:'run.uc02',match_liquidity_options:'run.uc03',simulate_scenario:'run.uc04',create_action_draft:'draft.create'};
  const NOTICE='Simulated products and indicative figures only. This is not a credit decision; lenders decide.';
  const TYPES={payment_reminder:'Payment reminder',financing_application:'Financing application',term_extension_request:'Term extension request'};
  const STATUS={pending:'Pending',executed:'Executed (simulated)',rejected:'Rejected',blocked:'Blocked'};
  const REJECT_CODES=['INCORRECT_FIGURES','WRONG_RECIPIENT','TIMING','NOT_PREFERRED','OTHER'];
  const CFGQ={ttlDays:7,maxPending:50,maxPerHour:10,noteMax:300,stepUpMs:5*60*1000,requireReview:false};
  const PRODUCT_KIND={dynamic_discounting:['Dynamic discounting','Dynamic Discounting Desk'],reverse_factoring:['Reverse factoring','Reverse Factoring Desk'],invoice_factoring:['Invoice factoring','Factoring Desk']};

  const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
    set(k,v){localStorage.setItem(k,JSON.stringify(v))}};   // throws when storage is unavailable: callers treat that as AUDIT_WRITE_FAILED

  /* ---------- Session, role and enterprise scope (3.2.1) ---------- */
  function sessionUser(){
    let raw=null;try{raw=sessionStorage.getItem(KS)||localStorage.getItem(KS)}catch(e){}
    if(!raw)return null;
    try{const {id}=JSON.parse(raw);return (ls.get(KU,[])||[]).find(u=>u.id===id)||null}catch(e){return null}
  }
  const roleOf=u=>u&&ROLES[u.role]?u.role:(u?'owner':null);   // accounts created before roles existed are owners of their company
  function session(){
    const u=sessionUser();if(!u)return null;
    const firm=typeof accountFirm==='function'?accountFirm(u):u.firmId||null;
    return {user:u,role:roleOf(u),firm,scope:scopeOf(u,firm)};
  }
  // Records of an enterprise are shared by its owner and its accountants and by nobody else.
  function scopeOf(u,firm){if(!u||!firm)return null;const demo=typeof isDemoUser==='function'&&isDemoUser(u);return demo?'demo:'+firm:(u.ownerId||u.id)+':'+firm}
  function err(code,http,message,extra){return {ok:false,code,http,message,...(extra||{})}}
  function can(op,s=session()){return !!s&&!!PERM[op]&&PERM[op].includes(s.role)}

  /* ---------- Append-only audit log (3.2.4, BR-04-28) ---------- */
  const kAudit=s=>'lilact.audit.v1.'+s.scope,kQueue=s=>'lilact.approvals.v1.'+s.scope,kNote=s=>'lilact.notices.v1.'+s.scope;
  let failAudit=false;                 // test hook: simulates an audit store outage (AUDIT_WRITE_FAILED, D25)
  function audit(s,op,obj,result,extra){
    if(failAudit)throw new Error('audit unavailable');
    const log=ls.get(kAudit(s),[]);
    const e={id:'AUD-'+(log.length+1)+'-'+Date.now().toString(36),at:new Date().toISOString(),user:s.user.id,name:s.user.name,role:s.role,op,object:obj||null,result,...(extra||{})};
    log.push(e);ls.set(kAudit(s),log.slice(-2000));return e.id;
  }
  function tryAudit(s,op,obj,result,extra){try{return audit(s,op,obj,result,extra)}catch(e){return null}}

  // Every call: session → operation known → role allowed → enterprise of the arguments equals the session (overwritten, never trusted).
  function call(op,args={},fn){
    const s=session();
    if(!s)return err('REAUTH_REQUIRED',401,'Sign in again to continue.');
    if(!PERM[op]){tryAudit(s,op,null,'refused',{code:'INVALID_REQUEST'});return err('INVALID_REQUEST',422,'This operation is not available.')}
    if(args.firm&&args.firm!==s.firm){tryAudit(s,op,args.firm,'refused',{code:'UNAUTHORIZED_SCOPE'});return err('UNAUTHORIZED_SCOPE',403,'This enterprise is not in your session.')}
    if(!PERM[op].includes(s.role)){
      const code=/^draft\.(approve|reject|return)$/.test(op)?'APPROVAL_REQUIRES_OWNER':'UNAUTHORIZED_ROLE';
      tryAudit(s,op,args.draft_id||null,'refused',{code});
      return err(code,403,code==='APPROVAL_REQUIRES_OWNER'?'Only the Business Owner can approve, reject or return a draft.':`Your role (${ROLES[s.role]}) cannot do this; it needs the Business Owner.`);
    }
    return fn?fn(s,{...args,firm:s.firm}):{ok:true,session:s};
  }
  // The chat's tool layer (Table 3-7): unknown tools and parameters are refused; the enterprise always comes from the session.
  const TOOL_PARAMS={diagnose_working_capital:['focus','language'],forecast_cash:['weeks','scenario','language'],match_liquidity_options:['source_run_id','language'],
    simulate_scenario:['changes','language','label'],create_action_draft:['test_id','action_type','target_id','variant','note','language','idempotency_key']};
  function tool(name,params={}){
    if(!TOOLS[name]){const s=session();s&&tryAudit(s,'tool:'+name,null,'refused',{code:'INVALID_REQUEST'});return err('INVALID_REQUEST',422,`“${name}” is not an allowed tool.`)}
    const bad=Object.keys(params).filter(k=>!TOOL_PARAMS[name].includes(k));
    if(bad.length)return err('INVALID_REQUEST',422,`Parameter not allowed: ${bad.join(', ')}.`,{field:bad[0]});
    if(name==='forecast_cash'&&params.scenario&&!['base','conservative','positive'].includes(params.scenario))return err('UNSUPPORTED_SCENARIO',422,'Only base, conservative or positive.');
    return call(TOOLS[name],{});
  }

  /* ---------- Step-up identity confirmation (IAM-05, CK-12) ---------- */
  let stepUpAt=0,stepUpFails=0;
  async function stepUp(password){
    const s=session();if(!s)return err('REAUTH_REQUIRED',401,'Sign in again.');
    if(stepUpFails>=3){tryAudit(s,'step_up',null,'locked');return err('REAUTH_REQUIRED',401,'Too many failed confirmations. Approval is locked for this session; sign in again.')}
    const ok=typeof hashPw==='function'&&(await hashPw(String(password||''),s.user.salt))===s.user.hash;
    if(!ok){stepUpFails++;tryAudit(s,'step_up',null,'failed');return err('REAUTH_REQUIRED',401,'Password not confirmed.')}
    stepUpFails=0;stepUpAt=Date.now();tryAudit(s,'step_up',null,'ok');return {ok:true,at:stepUpAt};
  }
  const stepUpFresh=()=>Date.now()-stepUpAt<=CFGQ.stepUpMs;

  /* ---------- Approval queue store ---------- */
  const load=s=>ls.get(kQueue(s),{drafts:[],seq:0,idem:{},actions:[]});
  function save(s,q){ls.set(kQueue(s),q)}
  function notify(s,to,text){try{const n=ls.get(kNote(s),[]);n.push({id:'N'+(n.length+1),to,text,at:new Date().toISOString(),read:false});ls.set(kNote(s),n.slice(-200))}catch(e){}}
  // FNV-1a (two lanes) over the rendered text: the content_hash that binds a decision to what the owner saw.
  function hash(str){let a=0x811c9dc5,b=0x01000193;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);a=Math.imul(a^c,16777619)>>>0;b=Math.imul(b^(c+i),2246822519)>>>0}
    return (a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0'))}

  /* ---------- Facts of a test and the draft templates (Appendix H) ---------- */
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const iso=d=>String(d).slice(0,10);
  const longDate=d=>{const [y,m,dd]=iso(d).split('-');return `${+dd} ${MONTHS[+m-1]} ${y}`};
  const millions=v=>`${(Math.round(v/1e5)/10).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})} million VND`;
  const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
  // H-R2: the phrase comes from a closed list, chosen by the first shortfall episode of the test's Base.
  function periodPhrase(ep){
    if(!ep)return null;const [y,m,d]=iso(ep.start).split('-').map(Number),[ey,em,ed]=iso(ep.end).split('-').map(Number),M=MONTHS[m-1];
    if(ey===y&&em===m&&ed===lastDay(y,m))return `through the end of ${M}`;
    if(d>=21&&ey===y&&em===m&&ed<lastDay(y,m))return `in late ${M}`;
    return `in ${M}`;
  }
  // due_dates grouped by month: "13, 19 and 23 October 2026".
  function dueList(dates){
    const by=new Map();[...new Set(dates.map(iso))].sort().forEach(d=>{const [y,m,dd]=d.split('-');const k=y+'-'+m;by.has(k)||by.set(k,[]);by.get(k).push(+dd)});
    const and=a=>a.length<2?String(a[0]):a.slice(0,-1).join(', ')+' and '+a.at(-1);
    return [...by.entries()].map(([k,days])=>{const [y,m]=k.split('-');return `${and(days)} ${MONTHS[+m-1]} ${y}`}).join('; ');
  }
  function firstEpisode(path,L){let s=null;for(let i=0;i<path.length;i++){if(path[i].close<L){if(!s)s={start:path[i].d,end:path[i].d};else s.end=path[i].d}else if(s)break}return s}
  const TEMPLATES={
    'payment_reminder.v1':f=>({title:'Request for earlier settlement of open invoices',
      body:`Dear Customer,\nWe would be grateful if you could settle the invoices listed in the attached statement ${f.earlier_days} days earlier than the agreed due dates. Earlier settlement would help us manage our working capital ${f.period_phrase}.\nPlease let us know if this is possible.\nBest regards,\n${f.sender_name}`}),
    'payment_reminder.v2':f=>({title:'Request for earlier settlement of open invoices',
      body:`Dear Customer,\nWe would appreciate settlement of the invoices listed in the attached statement ${f.earlier_days} days earlier than agreed, to help our working capital ${f.period_phrase}.\nBest regards,\n${f.sender_name}`}),
    'financing_application.v1':f=>({title:`${f.product_kind} application – invoice ${f.invoice_id}`,
      body:`To the ${f.desk_name},\nWe would like to apply for ${f.product_kind.toLowerCase()} on invoice ${f.invoice_id}, with funds needed on ${longDate(f.funds_date)} and repayment on the expected invoice receipt date. Product: ${f.product_id}. Indicative cost: ${f.cost_text} with the early-collection lever.\nBest regards,\n${f.sender_name}`}),
    'financing_application.v2':f=>({title:`${f.product_kind} application – invoice ${f.invoice_id}`,
      body:`To the ${f.desk_name},\nWe would like to apply for ${f.product_kind.toLowerCase()} on invoice ${f.invoice_id} (${f.amount_text}, expected receipt ${longDate(f.expected_receipt_date)}), with funds needed on ${longDate(f.funds_date)}. Indicative cost: ${f.cost_text}.\nBest regards,\n${f.sender_name}`}),
    'term_extension_request.v1':f=>({title:`Request for ${f.extension_days}-day extension of payment terms`,
      body:`Dear Supplier,\nDue to a short-term timing difference in our collections, we kindly request a ${f.extension_days}-day extension on the payments due to you on ${f.due_dates}. We value our relationship and will settle promptly on the new dates.\nBest regards,\n${f.sender_name}`})
  };
  const VARIANTS={payment_reminder:['payment_reminder.v1','payment_reminder.v2'],financing_application:['financing_application.v1','financing_application.v2'],term_extension_request:['term_extension_request.v1']};
  function render(d){const t=TEMPLATES[d.variant](d.facts);return {title:t.title,body:t.body,note:d.note||'',notice:NOTICE}}
  const contentHash=d=>{const r=render(d);return hash([d.type,d.variant,r.title,r.body,r.note,r.notice,JSON.stringify(d.facts.statement||[])].join('␞'))};

  // What a UC04 test supports as follow-up actions (Table 2-132): reminders from early collection, applications when the early
  // collection was transferred from a catalogue product of UC03, extension requests from supplier extensions. Stock sales have none.
  function actionsFor(run){
    if(!run||run.status!=='ok')return [];
    const out=[],ch=run.changes||[],opt=new Set(run.option_ids||[]);
    ch.forEach((c,i)=>{
      // A reminder states one number of days earlier, so it needs a shift_days test; an application needs the catalogue product the
      // early collection was transferred from (any date rule: the funds date of each invoice is a tested fact).
      if(c.lever==='ar'&&c.mode!=='absolute_date'&&c.days<0)out.push({type:'payment_reminder',change:i,target:{kind:'customer',id:c.customer,label:c.customer}});
      if(c.lever==='ar'&&(c.mode==='absolute_date'||c.days<0))(DATA.cat||[]).filter(p=>opt.has(p.id)&&PRODUCT_KIND[p.type]&&(!c.from||c.from===p.id)).forEach(p=>out.push({type:'financing_application',change:i,target:{kind:'product',id:p.id,label:`${p.provider||p.id} · ${PRODUCT_KIND[p.type][0].toLowerCase()}`}}));
      if(c.lever==='ap'&&c.days>0)out.push({type:'term_extension_request',change:i,target:{kind:'supplier',id:c.supplier,label:c.supplier}});
    });
    return out;
  }
  const invoiceOwner=(firm,id)=>{const s=((DATA.snaps[firm]||{}).sales||[]).find(x=>x.id===id);return s?s.customer:null};
  const billOwner=(firm,id)=>{const p=((DATA.snaps[firm]||{}).purchases||[]).find(x=>x.id===id);return p?p.supplier:null};
  // Facts bound to the test (fact_registry): every number, date and name of the text comes from here (BR-04-11, BR-04-13).
  function buildFacts(s,run,input,act,opts={}){
    const c=run.changes[act.change],ledger=(run.results.base.ledger||[]).filter(x=>x.lever===c.lever);
    const ep=firstEpisode(input.paths.base,input.L),base={sender_name:`${s.firm} Finance Team`,firm_code:s.firm};
    if(act.type==='payment_reminder'){
      const rows=ledger.filter(x=>invoiceOwner(s.firm,x.object_id)===c.customer).map(x=>({invoice:x.object_id,due:x.old,residual:x.moved,proposed:x.new,cost:x.cost}));
      return {...base,customer:c.customer,earlier_days:-c.days,period_phrase:periodPhrase(ep),statement:rows,tested_amount:rows.reduce((a,r)=>a+r.residual,0),
        needed_date:rows.length?rows.map(r=>r.proposed).sort()[0]:null,units:rows.map(r=>'INV:'+r.invoice)};
    }
    if(act.type==='financing_application'){
      const p=(DATA.cat||[]).find(x=>x.id===act.target.id),rows=ledger.filter(x=>invoiceOwner(s.firm,x.object_id)===c.customer);
      const r=rows.find(x=>x.object_id===opts.invoice_id)||rows.slice().sort((a,b)=>b.moved-a.moved)[0];if(!p||!r)return {...base,missing:['invoice or product']};
      const [kind,desk]=PRODUCT_KIND[p.type];
      return {...base,product_id:p.id,product_kind:kind,desk_name:desk,invoice_id:r.object_id,amount_text:millions(r.moved),funds_date:r.new,expected_receipt_date:r.old,
        cost_text:`about ${millions(r.cost)} in total`,cost:r.cost,tested_amount:r.moved,needed_date:r.new,units:['INV:'+r.object_id],customer:c.customer};
    }
    const rows=ledger.filter(x=>billOwner(s.firm,x.object_id)===c.supplier).map(x=>({bill:x.object_id,due:x.old,amount:x.moved,new_date:x.new,fee:x.cost}));
    return {...base,supplier:c.supplier,extension_days:c.days,due_dates:dueList(rows.map(r=>r.due)),payments:rows,tested_amount:rows.reduce((a,r)=>a+r.amount,0),
      needed_date:rows.length?rows.map(r=>r.due).sort()[0]:null,units:rows.map(r=>'BILL:'+r.bill)};
  }
  const REQUIRED={payment_reminder:['earlier_days','period_phrase','statement','sender_name'],financing_application:['product_kind','desk_name','invoice_id','funds_date','product_id','cost_text','sender_name','amount_text','expected_receipt_date'],
    term_extension_request:['extension_days','due_dates','sender_name']};

  /* ---------- Checks CK-01…CK-12 (Table 2-145) ---------- */
  function currentKey(firm){
    try{const I=UC0304.prepInput(DATA.snaps[firm],uc01(firm),uc02(firm));return I&&I.key}catch(e){return null}
  }
  const dataDate=firm=>(DATA.snaps[firm]||{}).as_of;
  const NOTE_BAD=/\d|https?:|www\.|@|\+\d|\b\d{6,}\b|[\u0000-\u001f]/;
  function noteError(note){if(note==null||note==='')return null;if(String(note).length>CFGQ.noteMax)return `A note has at most ${CFGQ.noteMax} characters.`;if(NOTE_BAD.test(note))return 'A note cannot contain digits, links, e-mail addresses, phone numbers or account numbers.';return null}
  function runChecks(s,d,q,when){
    const res=[],add=(code,ok,reason)=>res.push({code,ok,reason:ok?null:reason});
    add('CK-01',d.firm===s.firm,'The draft belongs to another enterprise.');
    const key=currentKey(s.firm);add('CK-02',!!key&&key===d.source.base_key,'The test was made on older data, policy or catalogue; re-run it and regenerate.');
    const miss=(REQUIRED[d.type]||[]).filter(k=>d.facts[k]==null||d.facts[k]===''||(Array.isArray(d.facts[k])&&!d.facts[k].length));
    add('CK-03',!miss.length,'Missing: '+miss.join(', '));
    const sum=d.type==='payment_reminder'?(d.facts.statement||[]).reduce((a,r)=>a+r.residual,0):d.type==='term_extension_request'?(d.facts.payments||[]).reduce((a,r)=>a+r.amount,0):d.facts.tested_amount;
    const order=d.type!=='financing_application'||iso(d.facts.funds_date)<=iso(d.facts.expected_receipt_date);
    add('CK-04',Math.abs(sum-d.facts.tested_amount)<=1&&order,'The figures no longer reconcile with the test.');
    const snap=DATA.snaps[s.firm]||{},openInv=new Set((snap.sales||[]).filter(x=>x.open).map(x=>'INV:'+x.id)),openBill=new Set((snap.purchases||[]).filter(x=>x.open).map(x=>'BILL:'+x.id));
    const prodOk=d.type!=='financing_application'||(DATA.cat||[]).some(p=>p.id===d.facts.product_id);
    add('CK-05',(d.facts.units||[]).every(u=>openInv.has(u)||openBill.has(u))&&prodOk,'An invoice is settled, a payment is made or the product is no longer active.');
    const live=q.drafts.filter(x=>x.draft_id!==d.draft_id&&(x.status==='pending'||x.status==='executed'));
    const clash=live.find(x=>x.type!==d.type&&(x.facts.units||[]).some(u=>(d.facts.units||[]).includes(u)));
    add('CK-06',!clash,clash?`Already in live draft ${clash.draft_id} on the same invoice or payment.`:'');
    const needed=d.facts.needed_date,dd=dataDate(s.firm);
    add('CK-07',(!needed||!dd||iso(needed)>iso(dd))&&!(d.expires_at&&Date.now()>Date.parse(d.expires_at)),'The needed date has passed or the draft expired.');
    if(when!=='create')add('CK-08',d.content_hash===contentHash(d),'The content changed since it was shown.');
    add('CK-09',!noteError(d.note),noteError(d.note)||'');
    add('CK-10',!failAudit,'The audit log cannot be written.');
    return res;
  }
  const failed=r=>r.filter(x=>!x.ok).map(x=>x.code);
  const BLOCK_CODE={'CK-02':'STALE_SOURCE','CK-04':'CHECK_FAILED','CK-05':'OBJECT_INVALID','CK-06':'DOUBLE_COMMITMENT','CK-07':'EXPIRED','CK-08':'CHECK_FAILED','CK-11':'CHECK_FAILED'};

  /* ---------- UC04.6 create ---------- */
  function createDraft({run,input,type,target_id,variant,note,invoice_id,idempotency_key,via}={}){
    return call('draft.create',{},(s)=>{
      if(!run||run.status!=='ok')return err('STALE_SOURCE',409,'There is no valid saved test. Run the test again first.');
      if(!input||run.meta.snapshot_id!==DATA.snaps[s.firm].snapshot_id)return err('UNAUTHORIZED_SCOPE',403,'This test does not belong to your enterprise.');
      const key=currentKey(s.firm);if(!key||key!==input.key)return err('STALE_SOURCE',409,'The test was made on older data or policy. Re-run it, then create the draft.');
      if(!TYPES[type])return err('UNSUPPORTED_ACTION_TYPE',422,`Only ${Object.keys(TYPES).join(', ')} are supported; stock sales have no draft type in this version.`);
      const act=actionsFor(run).find(a=>a.type===type&&(!target_id||a.target.id===target_id));
      if(!act)return err('UNSUPPORTED_ACTION_TYPE',422,type==='financing_application'?'A financing application needs a test transferred from a catalogue product in Solutions.':'This test has no lever that supports this action type.');
      const q=load(s);
      if(idempotency_key&&q.idem[idempotency_key]){const ex=q.drafts.find(x=>x.draft_id===q.idem[idempotency_key]);if(ex)return {ok:true,draft:ex,duplicate:true}}
      const hourAgo=Date.now()-3600e3;
      if(q.drafts.filter(x=>x.status==='pending').length>=CFGQ.maxPending||q.drafts.filter(x=>x.created_by.id===s.user.id&&Date.parse(x.created_at)>hourAgo).length>=CFGQ.maxPerHour)
        return err('RATE_LIMITED',429,`Limit reached: at most ${CFGQ.maxPending} pending drafts per enterprise and ${CFGQ.maxPerHour} new drafts per hour.`);
      const facts=buildFacts(s,run,input,act,{invoice_id});
      if(facts.missing||(REQUIRED[type]||[]).some(k=>facts[k]==null||(Array.isArray(facts[k])&&!facts[k].length)))
        return {ok:false,code:'missing_data',http:200,message:'Some facts are missing: '+((facts.missing||REQUIRED[type].filter(k=>facts[k]==null||(Array.isArray(facts[k])&&!facts[k].length))).join(', '))+'. Change the test so that it covers them.'};
      const nErr=noteError(note);if(nErr)return err('TEMPLATE_VALIDATION_FAILED',422,nErr,{field:'note'});
      const v=variant&&VARIANTS[type].includes(variant)?variant:VARIANTS[type][0];
      // An identical live draft is returned instead of a duplicate (A5).
      const same=q.drafts.find(x=>(x.status==='pending'||x.status==='executed')&&x.type===type&&x.variant===v&&x.source.sim_run_id===run.sim_run_id&&JSON.stringify(x.facts.units)===JSON.stringify(facts.units));
      if(same)return {ok:true,draft:same,duplicate:true,code:'DUPLICATE_DRAFT'};
      const b=run.results.base,now=new Date();
      const d={draft_id:`DRAFT-${s.firm}-${String(++q.seq).padStart(3,'0')}`,firm:s.firm,type,variant:v,language:'en',status:'pending',reason_code:null,version:1,
        target:act.target,facts,note:note||'',created_by:{id:s.user.id,name:s.user.name,role:s.role},created_at:now.toISOString(),via:via||'screen',
        expires_at:new Date(now.getTime()+CFGQ.ttlDays*864e5).toISOString(),
        review:{label:'awaiting_review',by:null,at:null,comment:null},
        source:{sim_run_id:run.sim_run_id,label:run.label||null,base_key:input.key,snapshot_id:run.meta.snapshot_id,uc01:run.meta.source_uc01_run,uc02:run.meta.source_uc02_run,uc03:run.source_uc03_run||null,
          summary:Object.fromEntries(Object.entries(run.results).map(([k,r])=>[k,{min_before:r.before.min,min_after:r.after.min,days_before:r.before.floor_days,days_after:r.after.floor_days,cost:r.costs.cash}])),
          conclusion:run.conclusion,cost:b.costs.cash},
        history:[],checks:[],action:null,parent_draft_id:null};
      d.content_hash=contentHash(d);
      const checks=runChecks(s,d,q,'create'),bad=failed(checks);d.checks=checks;
      // Authorisation, stale-source and missing-data failures create nothing; a failed guard stores a Blocked draft with its reason.
      if(bad.includes('CK-02'))return err('STALE_SOURCE',409,checks.find(x=>x.code==='CK-02').reason);
      if(bad.includes('CK-03'))return {ok:false,code:'missing_data',http:200,message:checks.find(x=>x.code==='CK-03').reason};
      if(bad.includes('CK-09'))return err('TEMPLATE_VALIDATION_FAILED',422,checks.find(x=>x.code==='CK-09').reason,{field:'note'});
      if(bad.includes('CK-10'))return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written, so no draft was created.');
      if(bad.length){d.status='blocked';d.reason_code=BLOCK_CODE[bad[0]]||'CHECK_FAILED'}
      let ref;try{ref=audit(s,'draft.create',d.draft_id,d.status,{version:1,content_hash:d.content_hash,checks:bad})}catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written, so no draft was created.')}
      d.history.push({at:d.created_at,by:s.user.name,role:s.role,event:d.status==='blocked'?`Created and blocked (${d.reason_code})`:'Created',version:1,audit_ref:ref});
      q.drafts.unshift(d);if(idempotency_key)q.idem[idempotency_key]=d.draft_id;save(s,q);
      if(s.role==='accountant'&&d.status==='pending')notify(s,'owner',`New draft waiting for approval: ${TYPES[type]} to ${act.target.label}.`);
      return {ok:true,draft:d,audit_ref:ref,blocked:d.status==='blocked'};
    });
  }

  /* ---------- Reading ---------- */
  function list(status='all'){
    return call('draft.view',{},(s)=>{const q=load(s);expireAll(s,q);
      const rows=q.drafts.filter(d=>status==='all'||d.status===status);
      const counts={all:q.drafts.length};Object.keys(STATUS).forEach(k=>counts[k]=q.drafts.filter(d=>d.status===k).length);
      return {ok:true,drafts:rows.sort((a,b)=>(b.status==='pending')-(a.status==='pending')||Date.parse(b.created_at)-Date.parse(a.created_at)),counts}});
  }
  function get(id){return call('draft.view',{},(s)=>{const q=load(s),d=q.drafts.find(x=>x.draft_id===id);return d?{ok:true,draft:d,rendered:render(d),stale:currentKey(s.firm)!==d.source.base_key}:err('UNAUTHORIZED_SCOPE',403,'Draft not found in your enterprise.')})}
  function pendingCount(){const s=session();if(!s||!can('draft.view',s))return 0;try{const q=load(s);return q.drafts.filter(d=>d.status==='pending').length}catch(e){return 0}}
  // Expiry and stale sources move Pending drafts to Blocked (BR-04-25, BR-04-26).
  function expireAll(s,q){
    let ch=false;const key=currentKey(s.firm);
    q.drafts.filter(d=>d.status==='pending').forEach(d=>{
      const exp=Date.now()>Date.parse(d.expires_at),stale=key&&key!==d.source.base_key;
      if(exp||stale){d.status='blocked';d.reason_code=exp?'EXPIRED':'STALE_SOURCE';d.history.push({at:new Date().toISOString(),by:'System',role:'system',event:`Blocked (${d.reason_code})`,version:d.version});ch=true;
        notify(s,'all',`Draft ${d.draft_id} is blocked (${d.reason_code}).`)}});
    if(ch){try{audit(s,'draft.auto_block',null,'blocked');save(s,q)}catch(e){}}
  }

  /* ---------- UC04.7 edit, review, withdraw, regenerate, revise ---------- */
  function mutate(op,id,expected_version,fn){
    return call(op,{draft_id:id},(s)=>{
      const q=load(s),d=q.drafts.find(x=>x.draft_id===id);
      if(!d)return err('UNAUTHORIZED_SCOPE',403,'Draft not found in your enterprise.');
      if(expected_version!=null&&expected_version!==d.version)return err('VERSION_CONFLICT',409,`The draft changed (now version ${d.version}). Reload it before deciding.`,{draft:d});
      const before=JSON.stringify({status:d.status,version:d.version,review:d.review,variant:d.variant,note:d.note});
      const out=fn(s,q,d);if(out&&out.ok===false)return out;
      let ref;try{ref=audit(s,op,id,'ok',{before,after:JSON.stringify({status:d.status,version:d.version,review:d.review,variant:d.variant,note:d.note}),content_hash:d.content_hash})}
      catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written; nothing was changed.')}
      if(d.history.length&&!d.history.at(-1).audit_ref)d.history.at(-1).audit_ref=ref;
      save(s,q);return {ok:true,draft:d,audit_ref:ref,...(out||{})};
    });
  }
  function edit(id,expected_version,{variant,note}={}){
    return mutate('draft.edit',id,expected_version,(s,q,d)=>{
      if(d.status!=='pending')return err('DRAFT_NOT_PENDING',409,'Only a Pending draft can be edited.');
      if(variant!=null&&!VARIANTS[d.type].includes(variant))return err('TEMPLATE_VALIDATION_FAILED',422,'Choose one of the approved wording variants.',{field:'variant'});
      const nErr=noteError(note);if(nErr)return err('TEMPLATE_VALIDATION_FAILED',422,nErr,{field:'note'});
      if(variant!=null)d.variant=variant;if(note!=null)d.note=String(note).trim();
      d.version++;d.content_hash=contentHash(d);d.review={label:'awaiting_review',by:null,at:null,comment:null};
      d.history.push({at:new Date().toISOString(),by:s.user.name,role:s.role,event:'Edited',version:d.version});
      if(s.role==='accountant')notify(s,'owner',`Draft ${d.draft_id} was edited (version ${d.version}).`);
    });
  }
  function review(id,expected_version,{decision,comment}={}){
    return mutate('draft.review',id,expected_version,(s,q,d)=>{
      if(d.status!=='pending')return err('DRAFT_NOT_PENDING',409,'Only a Pending draft can be reviewed.');
      if(decision==='returned'&&!String(comment||'').trim())return err('INVALID_REQUEST',422,'A comment is required to return a draft.',{field:'comment'});
      if(!['reviewed','returned'].includes(decision))return err('INVALID_REQUEST',422,'Choose Reviewed or Return with comment.');
      d.review={label:decision,by:s.user.name,role:s.role,at:new Date().toISOString(),comment:comment||null};
      d.history.push({at:d.review.at,by:s.user.name,role:s.role,event:decision==='reviewed'?'Reviewed – figures and recipient checked':'Returned with comment: '+comment,version:d.version});
      notify(s,decision==='reviewed'?'owner':'all',`Draft ${d.draft_id}: ${decision}.`);
    });
  }
  function withdraw(id,expected_version,reason){
    return mutate('draft.withdraw',id,expected_version,(s,q,d)=>{
      if(d.status!=='pending')return err('DRAFT_NOT_PENDING',409,'Only a Pending draft can be withdrawn.');
      if(s.role==='accountant'&&d.created_by.id!==s.user.id)return err('UNAUTHORIZED_ROLE',403,'An Accountant can withdraw only their own drafts.');
      if(!String(reason||'').trim())return err('INVALID_REQUEST',422,'A reason is required to withdraw.',{field:'reason'});
      d.status='rejected';d.reason_code='WITHDRAWN';d.history.push({at:new Date().toISOString(),by:s.user.name,role:s.role,event:'Withdrawn: '+reason,version:d.version});
    });
  }
  // Regenerate (Blocked → new version from the latest valid test) and Create revised draft (Rejected/Blocked → new draft linked by parent).
  function regenerate(id,expected_version,{run,input}={}){
    return mutate('draft.regenerate',id,expected_version,(s,q,d)=>{
      if(d.status!=='blocked')return err('DRAFT_NOT_PENDING',409,'Only a Blocked draft can be regenerated.');
      if(!run||!input||currentKey(s.firm)!==input.key)return err('STALE_SOURCE',409,'Run the test again on the current data, then regenerate.');
      const act=actionsFor(run).find(a=>a.type===d.type&&a.target.id===d.target.id);if(!act)return err('UNSUPPORTED_ACTION_TYPE',422,'The latest test has no lever for this draft.');
      d.facts=buildFacts(s,run,input,act,{invoice_id:d.facts.invoice_id});d.source={...d.source,sim_run_id:run.sim_run_id,base_key:input.key,snapshot_id:run.meta.snapshot_id};
      d.version++;d.status='pending';d.reason_code=null;d.content_hash=contentHash(d);d.review={label:'awaiting_review',by:null,at:null,comment:null};
      d.expires_at=new Date(Date.now()+CFGQ.ttlDays*864e5).toISOString();
      d.checks=runChecks(s,d,q,'create');const bad=failed(d.checks);if(bad.length){d.status='blocked';d.reason_code=BLOCK_CODE[bad[0]]||'CHECK_FAILED'}
      d.history.push({at:new Date().toISOString(),by:s.user.name,role:s.role,event:d.status==='pending'?'Regenerated from '+run.sim_run_id:`Regenerated and blocked (${d.reason_code})`,version:d.version});
    });
  }
  function revise(id,{run,input}={}){
    const g=get(id);if(!g.ok)return g;const p=g.draft;
    if(!['rejected','blocked'].includes(p.status))return err('DRAFT_NOT_PENDING',409,'A revised draft is made from a Rejected or Blocked draft.');
    const r=createDraft({run,input,type:p.type,target_id:p.target.id,variant:p.variant,note:p.note,invoice_id:p.facts.invoice_id,via:'revise'});
    if(r.ok&&!r.duplicate){const s=session(),q=load(s),d=q.drafts.find(x=>x.draft_id===r.draft.draft_id);d.parent_draft_id=p.draft_id;d.history.push({at:new Date().toISOString(),by:s.user.name,role:s.role,event:'Revised from '+p.draft_id,version:d.version});save(s,q);r.draft=d}
    return r;
  }

  /* ---------- UC04.8 approve, reject, return (Business Owner only) ---------- */
  // submit_action: internal, simulation mode only, never reachable from the chat or the tool list (2.10.9.10).
  function submitAction(s,q,d,mode){
    if(mode!=='simulation')return err('INVALID_REQUEST',422,'Only simulation mode exists in this version.');
    const r=render(d),action={action_id:`ACT-${s.firm}-${String(q.actions.length+1).padStart(4,'0')}`,tier:3,mode:'simulation',action_type:d.type,draft_id:d.draft_id,version:d.version,
      content_hash:d.content_hash,firm_id:s.firm,creator:d.created_by.name,reviewer:d.review.by,approver:s.user.name,approved_at:new Date().toISOString(),
      source:{sim_run_id:d.source.sim_run_id,uc01:d.source.uc01,uc02:d.source.uc02,uc03:d.source.uc03},result:'simulated',text:`${r.title}\n\n${r.body}${r.note?`\n\n${r.note} (added by user)`:''}\n\n${r.notice}`};
    action.log_ref=audit(s,'submit_action',d.draft_id,'simulated',{action_id:action.action_id,tier:3,mode:'simulation',content_hash:d.content_hash});
    q.actions.push(action);return {ok:true,action};
  }
  function approve(id,{expected_version,content_hash,ack_unreviewed,idempotency_key,mode='simulation'}={}){
    return call('draft.approve',{draft_id:id},(s)=>{
      const q=load(s),d=q.drafts.find(x=>x.draft_id===id);
      if(!d)return err('UNAUTHORIZED_SCOPE',403,'Draft not found in your enterprise.');
      if(idempotency_key&&q.idem[idempotency_key]===id+':approve'&&d.status==='executed')return {ok:true,draft:d,action:q.actions.find(a=>a.draft_id===id),duplicate:true};
      if(d.status!=='pending')return err('DRAFT_NOT_PENDING',409,`The draft is ${STATUS[d.status]}; nothing was executed.`,{draft:d});
      if(expected_version!==d.version||(content_hash&&content_hash!==d.content_hash))return err('VERSION_CONFLICT',409,`The draft changed (now version ${d.version}). Review the new version before deciding.`,{draft:d});
      if(!stepUpFresh()){tryAudit(s,'draft.approve',id,'refused',{code:'REAUTH_REQUIRED'});return err('REAUTH_REQUIRED',401,'Confirm your identity (within the last 5 minutes) to approve.')}
      if(mode!=='simulation')return err('INVALID_REQUEST',422,'Only simulation mode exists in this version.');
      if((CFGQ.requireReview||ack_unreviewed!==true)&&d.review.label!=='reviewed'){
        if(CFGQ.requireReview)return err('CHECK_FAILED',409,'This enterprise requires an Accountant review first.');
        return err('INVALID_REQUEST',422,'This draft has not been reviewed by an Accountant; tick the confirmation to approve it anyway.',{field:'ack'});
      }
      const checks=runChecks(s,d,q,'approve');checks.push({code:'CK-11',ok:mode==='simulation',reason:null},{code:'CK-12',ok:true,reason:null});d.checks=checks;
      const bad=failed(checks);
      if(bad.includes('CK-10'))return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written; nothing was executed.');
      if(bad.length){d.status='blocked';d.reason_code=BLOCK_CODE[bad[0]]||'CHECK_FAILED';
        d.history.push({at:new Date().toISOString(),by:'System',role:'system',event:`Blocked at approval (${d.reason_code}): `+checks.filter(x=>!x.ok).map(x=>x.reason).join(' '),version:d.version});
        try{audit(s,'draft.approve',id,'blocked',{code:d.reason_code})}catch(e){}save(s,q);notify(s,'all',`Draft ${d.draft_id} blocked at approval (${d.reason_code}).`);
        return err(d.reason_code==='STALE_SOURCE'?'STALE_SOURCE':'CHECK_FAILED',409,'A check failed at approval; the draft is blocked and nothing was recorded.',{draft:d})}
      try{audit(s,'draft.approve',id,'approved',{version:d.version,content_hash:d.content_hash,self_approved:d.created_by.id===s.user.id,basis:d.source.base_key})}
      catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written; nothing was executed.')}
      let sub;try{sub=submitAction(s,q,d,mode)}catch(e){sub=null}
      if(!sub||!sub.ok){d.status='blocked';d.reason_code='SUBMIT_FAILED';d.history.push({at:new Date().toISOString(),by:'System',role:'system',event:'Blocked (SUBMIT_FAILED)',version:d.version});save(s,q);return err('SUBMIT_FAILED',409,'The simulated submission failed; the draft is blocked and was not executed.',{draft:d})}
      d.status='executed';d.reason_code=null;d.action={action_id:sub.action.action_id,log_ref:sub.action.log_ref,at:sub.action.approved_at,by:s.user.name,self_approved:d.created_by.id===s.user.id};
      d.history.push({at:sub.action.approved_at,by:s.user.name,role:s.role,event:`Approved → Executed (simulated) · ${sub.action.action_id} · nothing was sent`,version:d.version});
      if(idempotency_key)q.idem[idempotency_key]=id+':approve';save(s,q);
      if(d.created_by.id!==s.user.id)notify(s,'accountant',`Draft ${d.draft_id} executed (simulated).`);
      return {ok:true,draft:d,action:sub.action};
    });
  }
  function reject(id,{expected_version,reason_code,comment}={}){
    return call('draft.reject',{draft_id:id},(s)=>{
      if(!REJECT_CODES.includes(reason_code))return err('INVALID_REQUEST',422,'Choose a reason.',{field:'reason'});
      if(reason_code==='OTHER'&&!String(comment||'').trim())return err('INVALID_REQUEST',422,'A comment is required for “Other”.',{field:'comment'});
      return mutate('draft.reject',id,expected_version,(s2,q,d)=>{
        if(d.status!=='pending')return err('DRAFT_NOT_PENDING',409,'Only a Pending draft can be rejected.');
        d.status='rejected';d.reason_code=reason_code;d.history.push({at:new Date().toISOString(),by:s2.user.name,role:s2.role,event:`Rejected (${reason_code})${comment?': '+comment:''}`,version:d.version});
        notify(s2,'accountant',`Draft ${d.draft_id} rejected (${reason_code}).`);
      });
    });
  }
  function returnDraft(id,{expected_version,comment}={}){
    return call('draft.return',{draft_id:id},()=>review(id,expected_version,{decision:'returned',comment}));
  }
  function copyText(id){
    return call('draft.copy',{draft_id:id},(s)=>{const q=load(s),d=q.drafts.find(x=>x.draft_id===id);
      if(!d)return err('UNAUTHORIZED_SCOPE',403,'Draft not found.');
      if(d.status!=='executed')return err('DRAFT_NOT_PENDING',409,'Only the text of an Executed draft can be copied.');
      const a=q.actions.find(x=>x.draft_id===id);try{audit(s,'draft.copy',id,'ok')}catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written.')}
      return {ok:true,text:a?a.text:''}});
  }
  function notices(){const s=session();if(!s)return [];try{return ls.get(kNote(s),[]).filter(n=>n.to==='all'||n.to===s.role).slice(-20).reverse()}catch(e){return []}}
  function markNoticesRead(){const s=session();if(!s)return;try{const n=ls.get(kNote(s),[]);n.forEach(x=>{if(x.to==='all'||x.to===s.role)x.read=true});ls.set(kNote(s),n)}catch(e){}}
  function auditLog(){
    return call('audit.view',{},(s)=>{const log=ls.get(kAudit(s),[]);return {ok:true,entries:s.role==='owner'?log:log.filter(e=>e.user===s.user.id||/^(data|draft\.create|draft\.edit|draft\.review)/.test(e.op))}});
  }
  // Policy confirmation (UC03.5, Table 3-3): the owner confirms; an accountant's attempt is refused here, whatever the screen shows.
  function confirmPolicy(what,fn){return call('policy.confirm',{},(s)=>{let ref;try{ref=audit(s,'policy.confirm',what,'ok')}catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written; nothing was confirmed.')}const r=fn?fn(s):null;return {ok:true,audit_ref:ref,result:r}})}
  function propose(what,fn){return call('policy.propose',{},(s)=>{let ref;try{ref=audit(s,'policy.propose',what,'ok')}catch(e){return err('AUDIT_WRITE_FAILED',503,'The audit log cannot be written.')}const r=fn?fn(s):null;return {ok:true,audit_ref:ref,result:r}})}

  return {ROLES,PERM,TOOLS,TYPES,STATUS,REJECT_CODES,NOTICE,VARIANTS,CFG:CFGQ,session,can,call,tool,stepUp,stepUpFresh,actionsFor,createDraft,list,get,pendingCount,edit,review,withdraw,
    regenerate,revise,approve,reject,returnDraft,copyText,render,notices,markNoticesRead,auditLog,confirmPolicy,propose,periodPhrase,dueList,longDate,
    _test:{setAuditFailure(v){failAudit=!!v},resetStepUp(){stepUpAt=0;stepUpFails=0},hash,contentHash,runChecks:(d)=>{const s=session();return runChecks(s,d,load(s),'approve')}}};
})();
