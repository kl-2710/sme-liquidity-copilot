/* Approval queue (SRS v2.10 2.10.9.11, UC04.6–UC04.8): the only place where a draft becomes a simulated action.
   The screen shows what the API returns and sends the user's decisions to it; every permission and check is done by API. */
const APPR={tab:'pending',sel:null};
const AP_REASON={INCORRECT_FIGURES:'Incorrect figures',WRONG_RECIPIENT:'Wrong recipient',TIMING:'Timing',NOT_PREFERRED:'Not preferred',OTHER:'Other',WITHDRAWN:'Withdrawn by the creator',
  CHECK_FAILED:'A check failed',STALE_SOURCE:'The test is out of date',DOUBLE_COMMITMENT:'Same invoice or payment in another draft',OBJECT_INVALID:'Invoice, payment or product no longer valid',EXPIRED:'Expired',SUBMIT_FAILED:'Simulated submission failed'};
const AP_REVIEW={awaiting_review:'Awaiting review',reviewed:'Reviewed',returned:'Returned for changes'};
const AP_CHECK={'CK-01':'Role and enterprise','CK-02':'Test is current','CK-03':'All facts present','CK-04':'Figures reconcile with the test','CK-05':'Invoice, payment, product still valid',
  'CK-06':'No conflicting draft','CK-07':'Not past the needed date or expiry','CK-08':'Content unchanged','CK-09':'Text is safe','CK-10':'Audit log available','CK-11':'Simulation mode only','CK-12':'Identity confirmed'};
const apDate=d=>d?fd(String(d).slice(0,10)):'—';
const apTime=d=>{if(!d)return '—';const x=new Date(d);return `${fd(x.toISOString().slice(0,10))} ${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`};
const apStatus=d=>`<span class="ap-st st-${d.status}">${API.STATUS[d.status]}${d.reason_code?` · ${esc(AP_REASON[d.reason_code]||d.reason_code)}`:''}</span>`;
const newKey=()=>(self.crypto&&crypto.randomUUID)?crypto.randomUUID():'k'+Date.now().toString(36)+Math.random().toString(36).slice(2);

// Pending counter of the sidebar badge (Table 2-148: equals the number of Pending drafts, hidden at zero) plus policy proposals for the owner.
function updatePending(){
  const b=$('#apprBadge');if(!b)return;
  const s=API.session(),props=s&&s.role==='owner'?POLICY.proposals().filter(p=>p.status==='pending').length:0,n=API.pendingCount()+props;
  b.textContent=n;b.hidden=!n;b.setAttribute('aria-label',`${n} waiting`);
}

function renderAppr(){
  const p=$('#pane-appr');if(!p)return;
  const s=API.session(),r=API.list('all');
  if(!r.ok){p.innerHTML=`<div class="callout red"><span>⛔</span><div>${esc(r.message)}</div></div>`;return}
  const role=s.role,counts=r.counts,tabs=['all','pending','executed','rejected','blocked'];
  const rows=r.drafts.filter(d=>APPR.tab==='all'||d.status===APPR.tab);
  const props=POLICY.proposals().filter(x=>x.status==='pending');
  const notes=API.notices().filter(n=>!n.read).slice(0,5);
  p.innerHTML=`<div class="ap-head">
      <h3>Approval queue</h3><p class="ap-rule">Only here does a draft become a simulated action. Nothing is sent outside.</p>
      <p class="ap-role">Signed in as <b>${esc(s.user.name)}</b> · ${API.ROLES[role]}. ${role==='owner'?'You approve, reject or return drafts.':'You prepare, edit, review and withdraw drafts; the Business Owner decides.'}</p>
      <div class="callout ap-notice"><span>ⓘ</span><div>Approval does not mean a real send. When you press Approve, the app only calls submit_action in simulation mode and writes the log (tier 3).</div></div>
    </div>
    ${notes.length?`<div class="ap-notes" aria-live="polite">${notes.map(n=>`<p>• ${esc(n.text)} <small>${apTime(n.at)}</small></p>`).join('')}<button class="linkbtn" id="apNotesRead" type="button">Mark as read</button></div>`:''}
    ${props.length?`<section class="card ap-props"><h4>Policy changes waiting for the Business Owner</h4><ul>${props.map(x=>`<li><b>${esc(x.what.replace(/_/g,' '))}</b> · proposed by ${esc(x.by)} on ${apTime(x.at)} · reason: ${esc(x.reason||'—')}
      ${role==='owner'?`<span class="ap-acts"><button class="btn ok sm" data-pconf="${x.id}" type="button">Confirm</button><button class="btn sec sm" data-pret="${x.id}" type="button">Return</button></span>`:'<small> · waiting for the owner</small>'}</li>`).join('')}</ul></section>`:''}
    <div class="ap-tabs" role="tablist" aria-label="Draft status">${tabs.map(k=>`<button role="tab" type="button" data-aptab="${k}" aria-selected="${APPR.tab===k}" class="${APPR.tab===k?'on':''}">${k==='all'?'All':API.STATUS[k].replace(' (simulated)','')} <b>${counts[k]}</b>${APPR.tab===k?'<span class="sr"> (selected)</span>':''}</button>`).join('')}</div>
    ${rows.length?`<div class="table-wrap"><table class="dtable ap-list"><thead><tr><th>Draft</th><th>Recipient</th><th>Status</th><th>Review</th><th>Source test</th><th>Created</th><th>Expires</th></tr></thead><tbody>
      ${rows.map(d=>`<tr data-apopen="${d.draft_id}" tabindex="0" class="${APPR.sel===d.draft_id?'on':''}"><td><b>${API.TYPES[d.type]}</b><small>${esc(API.render(d).title)}</small></td><td>${esc(d.target.label)}</td><td>${apStatus(d)}</td>
        <td>${d.status==='pending'?esc(AP_REVIEW[d.review.label]):'—'}</td><td><small>${esc(d.source.label||'What-if test')}</small></td><td><small>${esc(d.created_by.name)} · ${apTime(d.created_at)}</small></td><td><small>${d.status==='pending'?apTime(d.expires_at):'—'}</small></td></tr>`).join('')}</tbody></table></div>`
      :`<div class="empty ap-empty">No drafts yet. Ask Lilact in the chat to test a lever, then create a draft from its answer.</div>`}
    <div id="apDetail">${APPR.sel?draftDetailHTML(APPR.sel):''}</div>`;
  bindAppr(p);
}

function draftDetailHTML(id){
  const g=API.get(id);if(!g.ok)return `<div class="callout red"><span>⛔</span><div>${esc(g.message)}</div></div>`;
  const d=g.draft,r=g.rendered,s=API.session(),role=s.role,f=d.facts,pend=d.status==='pending';
  // Locked values are highlighted in the text (Table 2-146).
  const locked=[f.earlier_days&&`${f.earlier_days} days`,f.extension_days&&`${f.extension_days}-day`,f.extension_days&&`${f.extension_days} days`,f.period_phrase,f.due_dates,f.invoice_id,f.product_id,f.cost_text,f.amount_text,f.sender_name,f.desk_name,
    f.funds_date&&API.longDate(f.funds_date),f.expected_receipt_date&&API.longDate(f.expected_receipt_date)].filter(Boolean).sort((a,b)=>String(b).length-String(a).length);
  let body=esc(r.body);locked.forEach(v=>{const e=esc(String(v));body=body.split(e).join(`\u0001${e}\u0002`)});body=body.replace(/\u0001/g,'<mark class="lock">').replace(/\u0002/g,'</mark>').replace(/\n/g,'<br>');
  const stmt=d.type==='payment_reminder'?`<table class="dtable ap-att"><thead><tr><th>Invoice</th><th>Due date</th><th class="num">Residual amount</th><th>Proposed settlement</th></tr></thead><tbody>
      ${f.statement.map(x=>`<tr><td>${esc(x.invoice)}</td><td>${apDate(x.due)}</td><td class="num">${money(x.residual)}</td><td>${apDate(x.proposed)}</td></tr>`).join('')}<tr class="tot"><td colspan="2">Total (equals the tested amount)</td><td class="num">${money(f.tested_amount)}</td><td></td></tr></tbody></table>`
    :d.type==='term_extension_request'?`<table class="dtable ap-att"><thead><tr><th>Payment</th><th>Due date</th><th class="num">Amount moved</th><th>New date</th></tr></thead><tbody>
      ${f.payments.map(x=>`<tr><td>${esc(x.bill)}</td><td>${apDate(x.due)}</td><td class="num">${money(x.amount)}</td><td>${apDate(x.new_date)}</td></tr>`).join('')}</tbody></table>`
    :`<p class="ap-att">Invoice ${esc(f.invoice_id)} · ${esc(f.amount_text)} · expected receipt ${apDate(f.expected_receipt_date)} · funds needed ${apDate(f.funds_date)} · indicative cost ${esc(f.cost_text)} (not a quotation).</p>`;
  const sm=d.source.summary||{},scen=[['base','Base'],['conservative','Conservative'],['positive','Positive']];
  const summary=`<table class="dtable ap-sum"><thead><tr><th>Scenario</th><th class="num">Lowest balance before → after</th><th class="num">Days below the safe level</th></tr></thead><tbody>
    ${scen.filter(([k])=>sm[k]).map(([k,n])=>`<tr><td>${n}</td><td class="num">${money(sm[k].min_before)} → ${money(sm[k].min_after)}</td><td class="num">${sm[k].days_before} → ${sm[k].days_after}</td></tr>`).join('')}</tbody></table>
    <p class="hint">Conclusion of the test: ${esc(U34.CONCL[d.source.conclusion]||d.source.conclusion||'—')} · cash cost of the levers ${money(d.source.cost||0)} · simulated, not actual figures.</p>`;
  const btn=(a,label,cls='sec')=>`<button type="button" class="btn ${cls} sm" data-apact="${a}">${label}</button>`;
  const acts=[];
  if(pend){acts.push(btn('edit','Edit wording'),btn('review','Reviewed'),btn('return-c','Return with comment'));
    if(role==='owner'){acts.push(btn('approve','✓ Approve','primary'),btn('reject','Reject','danger'))}
    if(role==='owner'||d.created_by.id===s.user.id)acts.push(btn('withdraw','Withdraw'))}
  if(d.status==='blocked')acts.push(btn('regen','Regenerate from the latest test','primary'));
  if(d.status==='rejected'||d.status==='blocked')acts.push(btn('revise','Create revised draft'));
  if(d.status==='executed')acts.push(btn('copy','Copy approved text','primary'));
  const xp=typeof XP==='function'&&XP();
  return `<section class="card ap-detail" aria-label="Draft detail">
    <div class="ap-dh"><div><h4>${esc(r.title)}</h4><p>${API.TYPES[d.type]} · to <b>${esc(d.target.label)}</b> · version ${d.version} · ${apStatus(d)} · ${pend?esc(AP_REVIEW[d.review.label]):''}${d.review.by&&pend?` by ${esc(d.review.by)}`:''}</p></div>
      <button class="icon-btn" type="button" data-apclose aria-label="Close draft">×</button></div>
    ${g.stale&&pend?`<div class="callout amber"><span>⚠</span><div>The source test is out of date; approval is disabled. Regenerate from the latest test.</div></div>`:''}
    ${d.review.label==='returned'&&pend?`<div class="callout amber"><span>↩</span><div>Returned: ${esc(d.review.comment||'')}</div></div>`:''}
    ${d.status==='executed'?`<div class="callout green"><span>✓</span><div><b>Executed (simulated)</b> by ${esc(d.action.by)} on ${apTime(d.action.at)}${d.action.self_approved?' (self-approved)':''}. Nothing was sent outside the application.${xp?` <small>${esc(d.action.action_id)} · log ${esc(d.action.log_ref)}</small>`:''}</div></div>`:''}
    <div class="ap-text"><p>${body}</p>${d.note?`<p class="ap-note">${esc(d.note)} <small>(added by user)</small></p>`:''}<p class="ap-mand"><mark class="lock">${esc(r.notice)}</mark></p></div>
    <h5>Attachment</h5>${stmt}
    <h5>Source test</h5>${summary}
    <details class="ap-more"><summary>Checks, history and calculation details</summary>
      <ul class="ap-checks">${(d.checks||[]).map(c=>`<li class="${c.ok?'ok':'bad'}">${c.ok?'✓':'✗'} ${esc(AP_CHECK[c.code]||c.code)}${xp?` <small>${c.code}</small>`:''}${c.reason?` – ${esc(c.reason)}`:''}</li>`).join('')}</ul>
      <ol class="ap-hist">${d.history.map(h=>`<li>${apTime(h.at)} · ${esc(h.by)}${h.role&&h.role!=='system'?` (${esc(API.ROLES[h.role]||h.role)})`:''} · ${esc(h.event)} · v${h.version}</li>`).join('')}</ol>
      ${xp?`<p class="expert">draft ${esc(d.draft_id)} · template ${esc(d.variant)} · content_hash ${esc(d.content_hash)} · test ${esc(d.source.sim_run_id)} · base ${esc(d.source.base_key)} · UC01 ${esc(d.source.uc01||'—')} · UC02 ${esc(d.source.uc02||'—')} · UC03 ${esc(d.source.uc03||'—')}</p>`:''}
    </details>
    <div class="ap-acts">${acts.join('')}</div>
    <p class="ap-notice2">Approval does not mean a real send. Nothing is sent outside.</p>
  </section>`;
}

function bindAppr(p){
  $$('[data-aptab]',p).forEach(b=>b.onclick=()=>{APPR.tab=b.dataset.aptab;renderAppr()});
  $$('[data-apopen]',p).forEach(tr=>{const go=()=>{APPR.sel=tr.dataset.apopen;renderAppr();const d=$('#apDetail',p);d&&d.scrollIntoView({block:'nearest'})};tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go()}}});
  const nr=$('#apNotesRead',p);nr&&(nr.onclick=()=>{API.markNoticesRead();renderAppr()});
  $$('[data-pconf],[data-pret]',p).forEach(b=>b.onclick=()=>{const conf=!!b.dataset.pconf,r=POLICY.decide(b.dataset.pconf||b.dataset.pret,conf);
    if(!r.ok){toast(r.message);return}toast(conf?'Policy change confirmed: a new configuration version is in force':'Proposal returned to the Accountant');
    if(conf&&typeof policyCases==='function'){policyCases(S.firm);derive()}renderAppr();updatePending()});
  const close=$('[data-apclose]',p);close&&(close.onclick=()=>{APPR.sel=null;renderAppr()});
  $$('[data-apact]',p).forEach(b=>b.onclick=()=>apAction(b.dataset.apact,APPR.sel));
}
const apDone=(r,ok)=>{if(!r.ok){toast(r.message);if(r.code==='VERSION_CONFLICT'||r.draft)renderAppr();return false}toast(ok);renderAppr();updatePending();return true};
function latestTestFor(d){
  const runs=(U34.sims().runs||[]).filter(r=>r.status==='ok'&&API.actionsFor(r).some(a=>a.type===d.type&&a.target.id===d.target.id));return runs[0]||null;
}
function apAction(a,id){
  const g=API.get(id);if(!g.ok){toast(g.message);return}const d=g.draft,v=d.version;
  if(a==='edit'){
    openModal(`<h3>Edit wording</h3><p>Amounts, dates, recipient and invoices are locked; to change them, change the test and regenerate.</p>
      <label class="settings-field">Wording variant<select class="sel" id="apVar">${API.VARIANTS[d.type].map(x=>`<option value="${x}" ${x===d.variant?'selected':''}>${x.endsWith('v2')?'Short form':'Standard'}</option>`).join('')}</select></label>
      <label class="settings-field">Note added by user (optional, up to 300 characters; no digits, links, e-mail, phone or account numbers)<textarea id="apNoteIn" maxlength="300">${esc(d.note||'')}</textarea></label>
      <p class="ferr" id="apErr" role="alert"></p><div class="acts"><button class="btn sec" id="mCancel" type="button">Cancel</button><button class="btn primary" id="mOk" type="button">Save new version</button></div>`,m=>{
      $('#mCancel',m).onclick=closeModal;
      $('#mOk',m).onclick=()=>{const r=API.edit(id,v,{variant:$('#apVar',m).value,note:$('#apNoteIn',m).value});if(!r.ok){$('#apErr',m).textContent=r.message;return}closeModal();apDone(r,`Saved as version ${r.draft.version}; it needs a new review.`)}});return}
  if(a==='review'){apDone(API.review(id,v,{decision:'reviewed'}),'Recorded: reviewed – figures and recipient checked');return}
  if(a==='return-c'||a==='withdraw'||a==='reject'){
    const rej=a==='reject';
    openModal(`<h3>${rej?'Reject draft':a==='withdraw'?'Withdraw draft':'Return with comment'}</h3>
      ${rej?`<label class="settings-field">Reason<select class="sel" id="apReason">${API.REJECT_CODES.map(c=>`<option value="${c}">${AP_REASON[c]}</option>`).join('')}</select></label>`:''}
      <label class="settings-field">${rej?'Comment (required for Other)':a==='withdraw'?'Reason (required)':'Comment (required)'}<textarea id="apCmt"></textarea></label>
      <p class="ferr" id="apErr" role="alert"></p><div class="acts"><button class="btn sec" id="mCancel" type="button">Cancel</button><button class="btn ${rej?'danger':'primary'}" id="mOk" type="button">${rej?'Reject':a==='withdraw'?'Withdraw':'Return'}</button></div>`,m=>{
      $('#mCancel',m).onclick=closeModal;
      $('#mOk',m).onclick=()=>{const c=$('#apCmt',m).value.trim();
        const r=rej?API.reject(id,{expected_version:v,reason_code:$('#apReason',m).value,comment:c}):a==='withdraw'?API.withdraw(id,v,c):(API.session().role==='owner'?API.returnDraft(id,{expected_version:v,comment:c}):API.review(id,v,{decision:'returned',comment:c}));
        if(!r.ok){$('#apErr',m).textContent=r.message;return}closeModal();apDone(r,rej?'Draft rejected':a==='withdraw'?'Draft withdrawn':'Draft returned with your comment')}});return}
  if(a==='approve'){openApprove(d);return}
  if(a==='regen'||a==='revise'){const run=latestTestFor(d);if(!run){toast('There is no current test for this lever. Ask Lilact to run the test again, then regenerate.');return}
    const r=a==='regen'?API.regenerate(id,v,{run,input:U34.input()}):API.revise(id,{run,input:U34.input()});
    if(r.ok&&a==='revise')APPR.sel=r.draft.draft_id;apDone(r,a==='regen'?`Regenerated as version ${r.draft&&r.draft.version}`:`Revised draft ${r.draft&&r.draft.draft_id} created`);return}
  if(a==='copy'){const r=API.copyText(id);if(!r.ok){toast(r.message);return}
    const done=()=>toast('Approved text copied. Sending it is your decision, outside the app.');
    (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(r.text).then(done,done):done());return}
}
// UC04.8 approval: identity confirmation (password, valid 5 minutes), the statement that nothing is sent, the key figures and the hash.
function openApprove(d){
  const r=API.render(d),need=!API.stepUpFresh(),unrev=d.review.label!=='reviewed',f=d.facts;
  const key=newKey(),fig=d.type==='payment_reminder'?`${f.statement.length} invoice(s), ${money(f.tested_amount)}, ${f.earlier_days} days earlier`:d.type==='term_extension_request'?`${f.payments.length} payment(s), ${money(f.tested_amount)}, ${f.extension_days} days later`:`${f.invoice_id}, ${f.amount_text}, funds ${apDate(f.funds_date)}`;
  openModal(`<h3>Approve draft</h3>
    <div class="callout"><span>ⓘ</span><div><b>Approval does not mean a real send. Lilact records a simulated action only.</b></div></div>
    <p>${API.TYPES[d.type]} to <b>${esc(d.target.label)}</b> · ${esc(fig)} · version ${d.version} · fingerprint <code>${esc(d.content_hash.slice(0,8))}</code></p>
    ${unrev?`<label class="chk2"><input type="checkbox" id="apAck"> This draft has not been reviewed by an Accountant. I approve it anyway.</label>`:''}
    ${need?`<label class="settings-field">Confirm your identity: password<input type="password" id="apPw" autocomplete="current-password"></label>`:'<p class="hint">Identity confirmed in the last 5 minutes.</p>'}
    <p class="ferr" id="apErr" role="alert"></p>
    <div class="acts"><button class="btn sec" id="mCancel" type="button">Cancel</button><button class="btn primary" id="mOk" type="button">Approve (simulated)</button></div>`,m=>{
    $('#mCancel',m).onclick=closeModal;
    $('#mOk',m).onclick=async()=>{const e=$('#apErr',m);e.textContent='';
      if(need){const su=await API.stepUp($('#apPw',m).value);if(!su.ok){e.textContent=su.message;return}}
      const res=API.approve(d.draft_id,{expected_version:d.version,content_hash:d.content_hash,ack_unreviewed:unrev?!!($('#apAck',m)||{}).checked:true,idempotency_key:key});
      if(!res.ok){e.textContent=res.message;if(res.draft&&res.draft.status==='blocked'){closeModal();apDone(res,'')}return}
      closeModal();apDone(res,'Executed (simulated) – nothing was sent');
      if(typeof botNote==='function')botNote(`Draft <b>${esc(d.draft_id)}</b> was approved and recorded as <b>executed (simulated)</b>. Nothing was sent outside the application.`,{suggest:[]});
    }});
}

/* ---------- Creating drafts from a UC04 result (chat answer or What-if view) ---------- */
function draftChips(run){
  return API.actionsFor(run).map(a=>({t:`Create draft: ${API.TYPES[a.type].toLowerCase()} to ${a.target.label}`,f:()=>createDraftFromTest(run,a)}));
}
function createDraftFromTest(run,a,{bot:inBot}={}){
  const r=API.createDraft({run,input:U34.input(),type:a.type,target_id:a.target.id,idempotency_key:newKey(),via:'chat'});
  updatePending();
  const bot=inBot||(typeof newBot==='function'?newBot():null);
  if(!r.ok){
    const msg=r.code==='missing_data'?r.message:`${r.message}`;
    if(bot){say(bot,`<p>No draft was created. ${esc(msg)}</p>`,'warn');suggestRow(bot,r.code==='STALE_SOURCE'?[{t:'Run the test again',f:()=>sendChat(run.label||'What happens to my cash flow if I change this option?')}]:[])}
    else toast(msg);return r}
  const d=r.draft;
  if(bot){
    const card=document.createElement('div');card.className='liq ap-card';
    card.innerHTML=`<div class="liq-h"><div><h4>${r.duplicate?'This draft already exists':d.status==='blocked'?'Draft stored as Blocked':'Draft created and waiting for approval. Nothing has been sent.'}</h4>
      <p>${API.TYPES[d.type]} to ${esc(d.target.label)} · ${apStatus(d)}</p></div></div>
      ${d.status==='blocked'?`<p class="hint">${esc((d.checks.filter(c=>!c.ok).map(c=>c.reason)).join(' '))}</p>`:''}
      <div class="liq-act"><button class="btn primary sm" type="button" data-a="appr">Open in Approval queue →</button></div>`;
    bot.appendChild(card);$('[data-a=appr]',card).onclick=()=>{APPR.sel=d.draft_id;APPR.tab='all';openDetail('appr')};
    suggestRow(bot,[]);
  }
  return r;
}
