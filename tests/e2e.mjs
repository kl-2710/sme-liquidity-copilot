// Browser smoke test for the Lilact-branded SME Finance Copilot demo (Playwright + Chromium).
// Run: node tests/e2e.mjs   (PW_CHROMIUM=/path/to/chromium to override the browser; SHOTS=dir to save screenshots)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(p.endsWith("/") ? p + "index.html" : p); res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await pw.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const results = [];
async function step(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name + " — " + e.message.replace(/\s+/g, " ").slice(0, 220)]); } }
const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); };
const SAMPLE_CSV = {
  "firms.csv": "name,industry,min_cash_buffer_vnd\nABC Sample Upload Co.,Packaging manufacturing,400000000",
  "financials.csv": "period,revenue_vnd,cogs_vnd,opening_cash_vnd\nQ3-2026 (90 days),9000000000,7200000000,900000000",
  "sales_invoices.csv": "invoice_id,buyer,amount_vnd,issue_date,due_date,paid_date\nS-001,Customer K1,1200000000,2026-08-12,2026-10-14,\nS-002,Customer K2,900000000,2026-09-02,2026-10-20,2026-09-22",
  "purchase_invoices.csv": "invoice_id,supplier,amount_vnd,issue_date,due_date,paid_date,early_discount_pct,discount_days\nP-001,Supplier P1,1400000000,2026-09-10,2026-10-10,,2,10",
  "inventory.csv": "product_line,qty,unit_cost_vnd,days_in_stock\nPaper rolls,20000,60000,30\nInk and glue,8000,50000,40",
  "planned_flows.csv": "week,flow_type,category,amount_vnd\n1,inflow,Retail sales,300000000\n1,outflow,Payroll and operations,350000000\n2,inflow,Retail sales,300000000\n2,outflow,Payroll and operations,350000000\n3,outflow,Tax and insurance,300000000",
};

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const authReady = async () => { await page.waitForSelector("#authRoot:not([hidden])"); await page.waitForTimeout(300); };
  await page.goto(URL0); await page.evaluate(() => localStorage.clear()); await page.reload(); await authReady();
  await step("sign-up requires company, valid tax code and a complex password", async () => {
    await page.click("#tabReg");
    await page.fill("#rgName", "Test Owner"); await page.fill("#rgEmail", "signup-validation@example.com");
    await page.fill("#rgPw", "lowercase@1"); await page.fill("#rgPw2", "lowercase@1"); await page.check("#rgTerms");
    await page.locator("#rgPw").dispatchEvent("input");
    await page.waitForFunction(() => document.querySelectorAll("#pwChecklist li.met").length === 4);
    assert.equal(await page.locator("#pwChecklist li.met").count(), 4);
    await page.click("#rgSubmit");
    assert.equal(await page.locator("#rgCompanyE").innerText(), "Enter your company name");
    assert.equal(await page.locator("#rgTaxE").innerText(), "Tax code must be 10 or 13 digits");
    assert.match(await page.locator("#rgPwE").innerText(), /uppercase letter.*special character/);
    await page.fill("#rgCompany", "A"); await page.fill("#rgTax", "12345678901");
    await page.fill("#rgPw", "Lowercase1"); await page.fill("#rgPw2", "Lowercase1"); await page.click("#rgSubmit");
    assert.equal(await page.locator("#rgCompanyE").innerText(), "Enter your company name");
    assert.equal(await page.locator("#rgTaxE").innerText(), "Tax code must be 10 or 13 digits");
    assert.match(await page.locator("#rgPwE").innerText(), /Password must have 8\+ characters/);
    await page.fill("#rgCompany", "Alpha Co."); await page.fill("#rgTax", "12345abcde"); await page.click("#rgSubmit");
    assert.equal(await page.locator("#rgTaxE").innerText(), "Tax code must be 10 or 13 digits");
    await page.click("#tabLogin"); await page.click("#btnForgot"); await page.fill("#fgEmail", "demo@smecopilot.vn");
    await page.fill("#fgPw", "Lowercase1"); await page.locator("#fgOk").evaluate(el => el.click());
    assert.match(await page.locator("#fgErr").innerText(), /Password must have 8\+ characters/);
    await page.keyboard.press("Escape");
  });
  await step("sign-up stores normalized tax codes and rejects duplicate codes", async () => {
    const complete = async (tax, email) => {
      await page.fill("#rgName", "Test Owner"); await page.fill("#rgCompany", "Alpha Co.");
      await page.fill("#rgTax", tax); await page.fill("#rgEmail", email);
      await page.fill("#rgPw", "Strong@2026"); await page.fill("#rgPw2", "Strong@2026");
      await page.check("#rgTerms"); await page.click("#rgSubmit");
    };
    await page.click("#tabReg"); await page.waitForTimeout(200);
    await complete("0101 234567", "signup-first@example.com");
    await page.waitForFunction(() => !document.querySelector("#app").hidden, null, { timeout: 5000 }).catch(async () => { const detail=await page.evaluate(()=>({company:document.querySelector('#rgCompanyE').textContent,tax:document.querySelector('#rgTaxE').textContent,email:document.querySelector('#rgEmailE').textContent,password:document.querySelector('#rgPwE').textContent,form:document.querySelector('#rgErr').textContent})); throw new Error(`signup did not enter app: ${JSON.stringify(detail)}`) });
    assert.equal(await page.locator("#uSub").innerText(), "Alpha Co.");
    await page.click("#userBtn");
    assert.equal(await page.locator("#umName").innerText(), "Test Owner");
    assert.equal(await page.locator("#umCompany").innerText(), "Alpha Co.");
    assert.match(await page.locator("#umTax").innerText(), /Tax code 0101234567/);
    await page.click("#btnLogout"); await page.click("#tabReg"); await page.waitForTimeout(200);
    await complete("0101234567", "signup-duplicate@example.com");
    assert.equal(await page.locator("#rgTaxE").innerText(), "This tax code is already registered");
    await page.evaluate(() => { localStorage.removeItem("smefc.users.v1"); localStorage.removeItem("smefc.session.v1"); });
    await page.reload(); await authReady(); await page.click("#tabReg"); await page.waitForTimeout(200);
    await complete("0101234567-001", "signup-dashed@example.com");
    await page.waitForSelector("#app:not([hidden])");
    await page.click("#userBtn");
    assert.match(await page.locator("#umTax").innerText(), /Tax code 0101234567001/);
    await page.evaluate(() => localStorage.clear());
  });
  await step("a new account is bound to its own company and sets up its data", async () => {
    await page.reload(); await authReady(); await page.click("#tabReg"); await page.waitForTimeout(200);
    await page.fill("#rgName", "Nguyen Thi Hoa"); await page.fill("#rgCompany", "Delta Textiles");
    await page.fill("#rgTax", "0312345678"); await page.fill("#rgEmail", "hoa@delta.example");
    await page.fill("#rgPw", "Strong@2026"); await page.fill("#rgPw2", "Strong@2026");
    await page.check("#rgTerms"); await page.click("#rgSubmit");
    await page.waitForSelector("#app:not([hidden])");
    assert.equal(await page.locator(".firmbox").isVisible(), false);
    assert.equal(await page.locator("#uSub").innerText(), "Delta Textiles");
    assert.equal(await page.locator("#chatInput").isDisabled(), true);
    assert.match(await page.locator(".hero h1").innerText(), /Let’s set up Delta Textiles/);
    await page.click("[data-setup-data]");
    await page.waitForSelector("#dataScreen:not([hidden]) #dataFiles");
    assert.equal(await page.locator(".data-page-tabs").isVisible(), false, "Company data is a single Files screen");
    const csv = (n) => ({ name: n, mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV[n]) });
    await page.locator("#dataFileInput").setInputFiles([csv("sales_invoices.csv"), csv("purchase_invoices.csv")]);
    await page.waitForFunction(() => /Waiting for financial statements/.test(document.querySelector("#dataFiles").innerText));
    assert.equal(await page.locator("#chatInput").isDisabled(), true, "no analysis until the required files exist");
    await page.locator("#dataFileInput").setInputFiles([csv("financials.csv"), csv("inventory.csv"), csv("planned_flows.csv"), csv("firms.csv")]);
    await page.waitForFunction(() => document.querySelectorAll(".files-table tbody tr").length === 6 && [...document.querySelectorAll(".files-table tbody tr")].every(r => /Used in analysis/.test(r.innerText)));
    const files = await page.locator("#dataFiles").innerText();
    assert.doesNotMatch(files, /snapshot|Review/i, "reading and importing stays in the background");
    assert.equal(await page.evaluate(() => FIRMS[S.firm].name), "Delta Textiles", "files cannot rename the account company");
    await page.click("#dataBack");
    assert.equal(await page.locator("#chatInput").isDisabled(), false);
    await page.fill("#chatInput", "Where is my working capital stuck?"); await page.click("#sendBtn"); await page.waitForTimeout(3800);
    assert.match(await page.locator(".messages.on .msg.bot").last().innerText(), /Delta Textiles/);
    await page.reload(); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(500);
    assert.equal(await page.locator("#uSub").innerText(), "Delta Textiles");
    await page.evaluate(() => localStorage.clear());
  });
  await step("each demo account opens its own sample company", async () => {
    for (const [id, name] of [["F02", "Beta Fabric Distributor"], ["F03", "Gamma Packaging & Trims"]]) {
      await page.reload(); await authReady();
      await page.click(`[data-demo=${id}]`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => S.firm), id);
      assert.equal(await page.locator("#uSub").innerText(), name);
      await page.evaluate(() => { localStorage.removeItem("smefc.session.v1"); sessionStorage.removeItem("smefc.session.v1"); });
    }
    await page.evaluate(() => localStorage.clear());
  });
  await page.close();
}

// Engine acceptance cases (SRS v1.3 Appendix D/E), evaluated in the page against the shared engine (js/engine.js).
// TMK builds a minimal engine input: the FOB reference company of T21–T38 (revenue 30 bn, COGS 24 bn, 90-day period).
const TMK = `window.TMK=(o={})=>({firm:{id:'T',name:'Test Co',business_model:'FOB',rtarget:500e6,essential_suppliers:[],...(o.firm||{})},
  snapshot_id:'SNP-T-1',as_of:'2026-09-30',source:{type:'upload',id:'upload:test.csv',at:new Date().toISOString()},
  fin:o.fin||[{period_start:'2026-07-03',period_end:'2026-09-30',revenue:30e9,cogs:24e9,opening_cash:1e9,current_assets:20e9}],
  config:{amount_basis:'net',vat_rate:null},tables:{sales:true,purchases:true,inventory:true,planned:true,...(o.tables||{})},
  sales:o.sales||[],purchases:o.purchases||[],inventory:o.inventory||[],planned:o.planned||[]});`;
const enginePage = await browser.newPage();
await enginePage.goto(URL0); await enginePage.waitForTimeout(400); await enginePage.addScriptTag({ content: TMK });
const ev = (fn, arg) => enginePage.evaluate(fn, arg);
await step("A · sample snapshot: N from the period, Appendix D revenue, converted COGS (T47)", async () => {
  const r = await ev(() => { const s = DATA.snaps.F01; return { N: s.N, start: s.period_start, rev: s.fin.revenue, cogs: Math.round(s.fin.cogs), src: s.fin.cogs_src, inv: DATA.cases["F01|base"].invv }; });
  assert.deepEqual(r, { N: 183, start: "2026-04-01", rev: 18108528000, cogs: 14385833333, src: "converted", inv: 3450000000 });
  const f2 = await ev(() => DATA.snaps.F02.fin.revenue);
  assert.equal(f2, 24031968000);
});
await step("A · T13 missing due date stays in receivables, is not aged and is reported", async () => {
  const r = await ev(() => { const s = ENGINE.makeSnapshot(TMK({ sales: [
    { id: "S1", customer: "K1", amount: 800e6, issue: "2026-08-01", due: "2026-08-31", paid: null },
    { id: "S2", customer: "K2", amount: 200e6, issue: "2026-08-01", due: null, paid: null }] }));
    const s2 = s.sales.find((x) => x.id === "S2"); return { open: s.sales.reduce((a, x) => a + x.open_amount, 0), dpd: s2.dpd, missing: s2.missing_due, issue: s.issues.find((i) => i.code === "AR_MISSING_DUE") }; });
  assert.equal(r.open, 1000e6); assert.equal(r.dpd, null); assert.equal(r.missing, true); assert.equal(r.issue.amount, 200e6);
});
await step("A · Q02 payment after the cut-off does not reduce the balance; overpayment is an advance", async () => {
  const r = await ev(() => { const s = ENGINE.makeSnapshot(TMK({ sales: [
    { id: "S1", customer: "K1", amount: 100, issue: "2026-08-01", due: "2026-09-15", paid: "2026-09-20", paid_amount: 40 },
    { id: "S2", customer: "K1", amount: 100, issue: "2026-08-01", due: "2026-09-15", paid: "2026-10-05" },
    { id: "S3", customer: "K2", amount: 100, issue: "2026-08-01", due: "2026-09-15", paid: "2026-09-10", paid_amount: 120 }] }));
    return s.sales.map((x) => [x.open_amount, x.advance]); });
  assert.deepEqual(r, [[60, 0], [100, 0], [0, 20]]);
});
await step("A · T12/T46 customer-owned lots are excluded; an inferred type and a name hint stay provisional", async () => {
  const r = await ev(() => { const s = ENGINE.makeSnapshot(TMK({ inventory: [
    { name: "Fabric supplied by customer K1", type: null, qty: 1, unit_cost: 900e6, days: 20, owner: "customer" },
    { name: "Cotton fabric", type: null, qty: 2, unit_cost: 100e6, days: 70, owner: null },
    { name: "Fabric held for subcontracting", type: "NVL", qty: 1, unit_cost: 50e6, days: 10, owner: null }] }));
    return { lots: s.lots.map((l) => [l.type, l.type_src, l.owner, l.value_own, l.hgc_proposed]), codes: s.issues.map((i) => i.code) }; });
  assert.deepEqual(r.lots, [["HGC", "inferred", "customer", 0, false], ["NVL", "inferred", "unknown", 200e6, false], ["NVL", "declared", "unknown", 50e6, true]]);
  assert.ok(r.codes.includes("INV_TYPE_INFERRED") && r.codes.includes("INV_OWNER_UNKNOWN"));
});
await step("A · the analysis period follows the chosen cut-off (default start = as_of − 182)", async () => {
  const r = await ev(() => { const s = ENGINE.makeSnapshot(ENGINE.inputFromRaw(DATA.raw.F01, new Date().toISOString()), { asOf: "2026-08-31" }); return { N: s.N, start: s.period_start, sid: s.snapshot_id }; });
  assert.deepEqual(r, { N: 183, start: "2026-03-02", sid: "SNP-F01-20260930-01@2026-08-31/183d" });
});

// TCASE builds an input that reaches given DSO/DIO/DPO exactly, plus overdue invoices, slow lots and overdue payables.
await enginePage.addScriptTag({ content: `window.TCASE=(o={})=>{
  const N=o.N||90,asOf='2026-09-30',A=ENGINE.dnum(asOf),d=x=>ENGINE.diso(A+x),rev=o.rev??30e9,cogs=o.cogs??24e9,ca=o.ca===undefined?20e9:o.ca;
  const cash=(o.buffer??0.08)*rev*365/N,AR=(o.dso??40)*rev/N,INV=(o.dio??70)*cogs/N,AP=(o.dpo??30)*cogs/N,sales=[],pur=[],inv=[];
  let od=0;(o.arOverdue||[]).forEach((x,i)=>{sales.push({id:'OD'+i,customer:x.customer||'K'+(i+1),amount:x.amount,issue:d(-(x.dpd+x.term)),due:d(-x.dpd),paid:null});od+=x.amount});
  if(AR-od>0)sales.push({id:'S0',customer:o.mainCustomer||'K9',amount:AR-od,issue:d(-10),due:d(20),paid:null});
  let sl=0;(o.slowLots||[]).forEach((x,i)=>{inv.push({name:'Slow lot '+(i+1),type:x.type||'NVL',qty:1,unit_cost:x.amount,days:x.days,owner:'own',cancelled:x.cancelled||'unknown',pledged:'unknown'});sl+=x.amount});
  if(INV-sl>0)inv.push({name:'Fabric stock',type:'NVL',qty:1,unit_cost:INV-sl,days:10,owner:o.invOwner||'own',cancelled:'unknown',pledged:'unknown'});
  let po=0;(o.apOverdue||[]).forEach((x,i)=>{pur.push({id:'PO'+i,supplier:x.supplier||'S'+(i+1),amount:x.amount,issue:d(-(x.dpd+x.term)),due:d(-x.dpd),paid:null,essential:x.essential||null});po+=x.amount});
  if(AP-po>0)pur.push({id:'P0',supplier:'S9',amount:AP-po,issue:d(-5),due:d(25),paid:null});
  const fin=[{period_start:d(-(N-1)),period_end:asOf,revenue:rev,cogs,opening_cash:cash,current_assets:ca}];
  const input=TMK({firm:{business_model:o.model||'FOB'},fin,sales,purchases:pur,inventory:inv,tables:o.tables});
  return ENGINE.diagnose(ENGINE.makeSnapshot(input,{periodStart:d(-(N-1))}),{materiality:o.materiality});
};
window.SUMMARY=(r)=>({w:r.wc_class,bn:r.bn_pattern,main:r.main_bottleneck,rules:r.rule_ids,mar:Math.round(r.money_at_risk/1e6),ob:Math.round(r.obligation_overdue/1e6),
  share:r.materiality_share==null?null:Math.round(r.materiality_share*10000)/100,shape:Object.fromEntries(r.item_states.map(i=>[i.item,i.shape])),c:Object.fromEntries(r.item_states.map(i=>[i.item,i.c]))});` });
const B = (o) => ev((x) => SUMMARY(TCASE(x)), o);
await step("B · T01–T06 public-company cases", async () => {
  // DM7: DSO 112.9, revenue 741.1 bn a year, current assets 406.3 bn (FOB) → W2, money_at_risk 114.1 bn.
  let r = await B({ N: 365, rev: 741.1e9, cogs: 600e9, dso: 112.9, ca: 406.3e9 });
  assert.equal(r.w, "W2"); assert.ok(r.rules.includes("R-AR-2") && r.rules.includes("R-MAT")); assert.equal(Math.round(r.mar / 100) / 10, 114.1); assert.equal(r.main, "AR");
  r = await B({ N: 365, rev: 980.3e9, cogs: 800e9, dso: 63.3, ca: 624.4e9 });                  // HNI
  assert.equal(r.w, "W1"); assert.deepEqual(r.rules, ["R-AR-1"]); assert.equal(Math.round(r.share * 10) / 10, 2.8);
  r = await B({ N: 365, rev: 365e9, cogs: 300e9, dso: 67.1, ca: 10.4e9 / 0.054 });             // NJC 5.4 %
  assert.equal(r.w, "W2"); assert.deepEqual(r.rules, ["R-AR-1", "R-MAT"]);
  r = await B({ N: 365, rev: 500e9, cogs: 400e9, dio: 255, ca: 2000e9 });                     // TDT
  assert.equal(r.w, "W2"); assert.ok(r.rules.includes("R-INV-2")); assert.equal(r.main, "INV");
  r = await B({ model: "CMT", N: 365, rev: 500e9, cogs: 400e9, dso: 30.2, dio: 3.2, dpo: 4.3, buffer: 0.507 });  // PTG
  assert.equal(r.w, "W0"); assert.equal(r.bn, "BN0");
  r = await B({ rev: 0, dso: 40 });                                                              // G20: no revenue
  assert.equal(r.w, "unknown"); assert.equal(r.bn, "unknown");
});
await step("B · T07 materiality boundary, T08 threshold boundary, T09 high DPO, T10 low DPO with a thin buffer", async () => {
  // E_AR = (60 − 56.7) × 100 M/day = 330 M; current assets 330 M ÷ share.
  const at = (share) => B({ rev: 9e9, cogs: 8e9, dso: 60, ca: 330e6 / share });
  assert.equal((await at(0.0499)).w, "W1"); assert.equal((await at(0.05)).w, "W2");
  let r = await B({ dso: 56.7 }); assert.equal(r.w, "W0"); assert.deepEqual(r.rules, []);
  r = await ev(() => { const x = TCASE({ dpo: 70 }); return [x.wc_class, x.info_rules]; }); assert.deepEqual(r, ["W0", ["R-AP-INFO"]]);
  r = await B({ dpo: 10, buffer: 0.04 }); assert.equal(r.w, "W1"); assert.deepEqual(r.rules, ["R-AP-1"]); assert.equal(r.bn, "BN3");
});
await step("B · T11 small overdue invoice, T12 customer-owned stock, T13 missing due dates, T14 zero revenue", async () => {
  let r = await B({ arOverdue: [{ amount: 100e6, dpd: 45, term: 30 }] });                      // ρ = 1.5, 0.5 % of current assets
  assert.equal(r.w, "W1"); assert.equal(r.bn, "BN1"); assert.equal(r.shape.AR, "L");
  r = await ev(() => { const x = TCASE({ dio: 150, invOwner: "customer" }); return [x.metrics.INV, x.metrics.dio, x.wc_class]; });
  assert.deepEqual(r, [0, 0, "W0"]);
  r = await ev(() => { const input = TMK({ sales: [{ id: "A", customer: "K1", amount: 800e6, issue: "2026-08-01", due: "2026-08-10", paid: null }, { id: "B", customer: "K2", amount: 200e6, issue: "2026-08-01", due: null, paid: null }] });
    const x = ENGINE.diagnose(ENGINE.makeSnapshot(input)); return [x.metrics.missing_due_ar, x.coverage.AR, x.signals.arOD.map((y) => y.inv.id)]; });
  assert.deepEqual(r, [200e6, "provisional", ["A"]]);
  r = await ev(() => { const x = TCASE({ rev: 0 }); return [x.metrics.dso, x.metrics.twc > 0, x.wc_class]; });
  assert.deepEqual(r, [null, true, "unknown"]);
});
await step("B · T21–T27 single-item patterns (FOB reference company)", async () => {
  let r = await ev(() => { const x = TCASE({ dso: 40, dio: 70, dpo: 30 }); return { s: SUMMARY(x), h: x.item_states.map((i) => i.headroom == null ? null : Math.round(i.headroom * 10) / 10), f: x.findings.length }; });
  assert.equal(r.s.bn, "BN0"); assert.equal(r.s.w, "W0"); assert.equal(r.s.main, null); assert.equal(r.s.mar, 0); assert.equal(r.f, 0); assert.deepEqual(r.h.slice(0, 2), [16.7, 28.4]);
  r = await ev(() => { const x = TCASE({ dso: 52 }); return [x.bn_pattern, x.item_states[0].near_threshold, x.findings.length]; }); assert.deepEqual(r, ["BN0", true, 0]);
  r = await B({ dso: 58 }); assert.deepEqual([r.bn, r.w, r.mar, r.share, r.main, r.shape.AR], ["BN1", "W1", 433, 2.17, "AR", "H"]);
  r = await B({ dso: 80 }); assert.deepEqual([r.bn, r.w, r.mar, r.share], ["BN1", "W2", 7767, 38.83]);
  r = await B({ dio: 150 }); assert.deepEqual([r.bn, r.w, r.mar], ["BN2", "W2", 13760]);
  r = await B({ apOverdue: [{ amount: 1200e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.mar, r.ob], ["BN3", "W2", 0, 1200]);
  r = await B({ dpo: 10, buffer: 0.04 }); assert.deepEqual([r.bn, r.w, r.mar, r.ob], ["BN3", "W1", 0, 0]);
});
await step("B · T28–T34 combined patterns, double counting and tie order", async () => {
  let r = await B({ dso: 58, dio: 100 }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN4", "W1", "AR", 860]);
  r = await B({ dso: 80, dio: 100 }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN4", "W2", "AR", 8193]);
  r = await B({ dso: 58, apOverdue: [{ amount: 300e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.main, r.mar, r.ob], ["BN5", "W1", "AR", 433, 300]);
  r = await B({ dio: 90, slowLots: [{ amount: 600e6, days: 90 }], apOverdue: [{ amount: 400e6, dpd: 40, term: 30 }] });
  assert.deepEqual([r.bn, r.w, r.main, r.mar, r.ob, r.shape.INV, r.shape.AP], ["BN6", "W1", "INV", 600, 400, "L", "L"]);
  r = await ev(() => { const x = TCASE({ N: 183, rev: 20e9, cogs: 16e9, ca: 18977.6e6, dso: 7061.3e6 * 183 / 20e9, dio: 10716.3e6 * 183 / 16e9, dpo: 1941.2e6 * 183 / 16e9, buffer: 0.03,
    apOverdue: [{ amount: 370.8e6, dpd: 40, term: 30 }] }); return { s: SUMMARY(x), e: x.item_states.map((i) => Math.round(i.E / 1e5) / 10) }; });
  assert.deepEqual([r.s.bn, r.s.w, r.s.main], ["BN7", "W2", "INV"]); assert.deepEqual(r.e, [864.6, 2113, 370.8]); assert.equal(Math.round(r.s.mar * 10) / 10, 2978);
  r = await B({ dso: 62, arOverdue: [{ amount: 600e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.mar, r.shape.AR], ["BN1", "W2", 1767, "HL"]);
  r = await B({ arOverdue: [{ amount: 500e6, dpd: 40, term: 30 }], slowLots: [{ amount: 500e6, days: 90 }] }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN4", "W1", "AR", 1000]);
});
await step("B · T35 missing payables, T36 provisional stock, T37 concentrated receivables", async () => {
  let r = await ev(() => { const x = TCASE({ dso: 58, tables: { purchases: false } }); return [x.wc_class, x.bn_pattern, x.item_states.map((i) => i.value == null ? null : Math.round(i.value))]; });
  assert.deepEqual(r, ["unknown", "unknown", [58, 70, null]]);
  r = await ev(() => { const input = TMK({ fin: [{ period_start: "2026-07-03", period_end: "2026-09-30", revenue: 30e9, cogs: 24e9, opening_cash: 1e9, current_assets: 20e9 }],
    sales: [{ id: "S", customer: "K", amount: 40 * 30e9 / 90, issue: "2026-09-20", due: "2026-10-20", paid: null }], purchases: [{ id: "P", supplier: "S", amount: 30 * 24e9 / 90, issue: "2026-09-20", due: "2026-10-20", paid: null }],
    inventory: [{ name: "Unlabelled stock", type: null, qty: 1, unit_cost: 70 * 24e9 / 90, days: 10, owner: null }] });
    const x = ENGINE.diagnose(ENGINE.makeSnapshot(input, { periodStart: "2026-07-03" })); return [x.bn_pattern, x.wc_class, x.coverage.INV, x.item_states[1].provisional, x.status]; });
  assert.deepEqual(r, ["BN0", "W0", "provisional", true, "provisional"]);
  r = await ev(() => TCASE({ arOverdue: [{ customer: "K1", amount: 600e6, dpd: 40, term: 30 }, { customer: "K2", amount: 400e6, dpd: 40, term: 30 }] }).concentration);
  assert.equal(r.flag, "concentrated"); assert.equal(r.top.name, "K1"); assert.equal(Math.round(r.top.share * 100), 60);
});
await step("B · T47 F01 cash cycle and T48/T49 cause breakdowns", async () => {
  const r = await ev(() => { const d = uc01("F01"); return { dso: d.metrics.dso.toFixed(1), dio: d.metrics.dio.toFixed(1), dpo: d.metrics.dpo.toFixed(1), ccc: d.metrics.ccc.toFixed(1), cogs: d.coverage.cogs }; });
  assert.deepEqual(r, { dso: "49.6", dio: "43.9", dpo: "24.8", ccc: "68.7", cogs: "provisional" });
  // T48 assumes E_AR equals the total overdue: K1 tier 4 817,756,000; K3 tier 2 53,809,000; cancelled lot 430,000,000.
  const t48 = await ev(() => ENGINE.decompose({ E_AR: 871565000, E_INV: 430000000, arFlagged: [{ amount: 817756000, tier: 4 }, { amount: 53809000, tier: 2 }], slowLots: [{ amount: 430000000, cancelled: true }] }));
  assert.equal(t48.ok, true); assert.deepEqual(t48.parts.filter((p) => p.amount).map((p) => [p.source, p.amount]), [[1, 817756000], [2, 53809000], [6, 430000000]]);
  assert.equal(t48.total, 1301565000); assert.equal(t48.main_cause_detail.source, 1); assert.equal((t48.main_cause_detail.share * 100).toFixed(1), "62.8");
  const t49 = await ev(() => ENGINE.decompose({ E_AR: 860267000, E_INV: 1450000000, arFlagged: [{ amount: 248943000, tier: 4 }, { amount: 611324000, tier: 3 }], slowLots: [{ amount: 1450000000, cancelled: false }] }));
  assert.equal(t49.total, 2310267000); assert.equal(t49.main_cause_detail.source, 5); assert.equal((t49.main_cause_detail.share * 100).toFixed(1), "62.8");
  const bad = await ev(() => ENGINE.decompose({ E_AR: 100, E_INV: 0, arFlagged: [{ amount: 300, tier: 4 }], slowLots: [] }));   // T56
  assert.equal(bad.ok, false);
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL0);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: t })); }, theme);
  await page.reload(); await page.waitForSelector("#authRoot:not([hidden])");
  const ask = async (q) => { await page.fill("#chatInput", q); await page.click("#sendBtn"); await page.waitForTimeout(3800); };
  const last = () => page.locator(".messages.on .msg.bot").last();

  await step(`[${theme}] sign-in screen uses the Lilact logo and tokens`, async () => {
    assert.equal(await page.locator("#authRoot").isVisible(), true);
    assert.equal(await page.locator(`.auth-brand img.lilact-logo--dark`).isVisible(), true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, theme === "dark" ? "rgb(15, 12, 30)" : "rgb(247, 246, 251)");
    await shot(page, `${theme}-auth`);
  });
  await step(`[${theme}] demo account opens the app with flow steps 2–4 locked`, async () => {
    await page.click("#btnDemo");
    await page.waitForSelector("#app:not([hidden])");
    assert.equal(await page.locator('[data-view="log"], [data-tab="log"], #pane-log, #navSettings').count(), 0);
    assert.equal(await page.locator(".tnav" + "[data-task]").count(), 0);
    assert.equal(await page.locator(`.side .lilact-logo--${theme}`).isVisible(), true);
    assert.equal(await page.locator("#uSub").innerText(), "Alpha Garment Subcontractor");
    assert.equal(await page.locator(".firmbox").isVisible(), false);
    await page.waitForTimeout(400);
    await shot(page, `${theme}-flow`);
  });
  await step(`[${theme}] one sidebar toggle moves between sidebar and chat header`, async () => {
    assert.equal(await page.locator("#sideFold").isVisible(), true);
    assert.equal(await page.locator("#sideToggle").isVisible(), false);
    await page.locator("#sideFold").click();
    assert.equal(await page.locator("#app").evaluate((el) => el.classList.contains("side-collapsed")), true);
    assert.equal(await page.locator("#sideFold").isVisible(), false);
    assert.equal(await page.locator("#sideToggle").isVisible(), true);
    assert.equal(await page.locator("#sideToggle").getAttribute("aria-label"), "Show sidebar");
    await page.locator("#sideToggle").click();
    assert.equal(await page.locator("#sideFold").isVisible(), true);
    assert.equal(await page.locator("#sideToggle").isVisible(), false);
  });
  await step(`[${theme}] account menu settings and help`, async () => {
    await page.click("#userBtn");
    assert.deepEqual(await page.locator("#userMenu [role=menuitem]").allTextContents(), ["Settings", "Get help", "Log out"]);
    await page.click("#btnSettings");
    assert.equal(await page.locator("#modal").getAttribute("role"), "dialog");
    await page.fill("#settingsSearch", "dark");
    await page.click(`button[data-theme="${theme}"]`);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    await page.locator('[data-section="Billing"]').click();
    assert.match(await page.locator("#modal").innerText(), /Current plan: Demo \(free\)/);
    assert.equal(await page.locator("#modal .settings-body input").count(), 0);
    await page.locator('[data-section="Usage"]').click();
    await page.waitForFunction(() => /Conversations/.test(document.querySelector("#modal").innerText), null, { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.click("#userBtn"); await page.click("#btnHelp");
    assert.match(await page.locator("#modal").innerText(), /How Lilact works/);
    await page.keyboard.press("Escape");
  });
  await step(`[${theme}] Task 1 diagnosis shows DSO/DIO/DPO/CCC`, async () => {
    await ask("Where is my working capital stuck?");
    const t = await last().innerText();
    assert.match(t, /diagnose_working_capital/); assert.match(t, /68[.,]7/);
  });
  await step(`[${theme}] Task 2 explains every gap; chips stay visible after the 2nd message`, async () => {
    await ask("Why am I short of cash? Show me the cause.");
    const acc = last().locator(".gap-acc");
    assert.equal(await acc.count(), 5, "one 'Why gap N happens' card per gap");
    assert.deepEqual(await acc.evaluateAll((els) => els.filter((e) => e.open).map((e) => e.dataset.gap)), ["5"], "largest gap open");
    assert.equal(await page.locator("#demoChips").isVisible(), true);
    const chips = await page.locator("#demoChips button").count();
    assert.ok(chips > 0 && chips <= 4, `chips: ${chips}`);
  });
  await step(`[${theme}] Task 3 ranks financing for every gap`, async () => {
    await ask("Rank the financing options that fit this cause.");
    assert.equal(await last().locator(".rank-sum tbody tr").count(), 5);
    assert.deepEqual(await last().locator('[data-gap-top="3"] li b').allTextContents(), ["INV-001", "CL-001", "RF-001"]);
    assert.equal(await page.locator("#demoChips").isVisible(), true);
  });
  await step(`[${theme}] Task 4 what-if creates drafts pending approval`, async () => {
    await ask("K1 will only pay 7 days early. What if we combine that with financing invoice S-F01-0070 via RF-001?");
    assert.match(await last().innerText(), /3[.,]87/);
    await last().locator("button", { hasText: "Create draft" }).click();
    await page.waitForTimeout(1800);
    assert.ok(Number(await page.locator("#pendN").innerText()) > 0);
    await shot(page, `${theme}-drafts`);
  });
  await step(`[${theme}] approval needs the acknowledgement and records a simulated execution`, async () => {
    await page.click("#pendChip"); await page.waitForTimeout(1000);
    await page.locator("#pane-appr button", { hasText: /^✓?\s*Approve$/ }).first().click();
    assert.equal(await page.locator("#mOk").isDisabled(), true);
    await page.check("#ackChk"); await page.click("#mOk"); await page.waitForTimeout(2500);
    assert.match(await page.locator("#pane-appr").innerText(), /Executed \(simulated\)/);
    assert.match(await last().innerText(), /executed \(simulated\)/);
    await shot(page, `${theme}-approved`);
  });
  await step(`[${theme}] reject needs a reason`, async () => {
    await page.locator("#pane-appr .ac .btn.danger").first().click();
    assert.equal(await page.locator("#mOk").isDisabled(), true);
    await page.fill("#rjTxt", "Cost too high"); await page.click("#mOk"); await page.waitForTimeout(1500);
    assert.match(await page.locator("#pane-appr").innerText(), /Rejected/);
  });
  await step(`[${theme}] "Explain gap N" selects that gap; unknown gaps are reported`, async () => {
    await ask("Explain gap 2");
    assert.equal(await last().locator(".gap-acc").count(), 1);
    assert.equal(await page.evaluate(() => EP.k), 2);
    await ask("Rank financing for gap 4");
    assert.equal(await last().locator(".rank-sum tbody tr").count(), 1);
    assert.equal(await page.evaluate(() => EP.k), 4);
    await ask("Explain gap 9");
    assert.match(await last().innerText(), /There is no gap 9/);
  });
  await step(`[${theme}] dashboard tabs render`, async () => {
    for (const t of ["dash", "gap", "whatif"]) {
      await page.click(`.tab[data-tab=${t}]`); await page.waitForTimeout(500);
      assert.ok((await page.locator(`#pane-${t}`).innerText()).length > 40, t);
    }
  });
  await step(`[${theme}] dashboard has no forecast; Shortfall holds forecast, daily chart, gaps and ranking`, async () => {
    await page.click(".tab[data-tab=dash]"); await page.waitForTimeout(500);
    assert.equal(await page.locator('#pane-dash :is([data-wid="flow"], [data-wid="daily"], .fch, #gapChart, #dashChart)').count(), 0);
    assert.doesNotMatch(await page.locator("#pane-dash").innerText(), /13-week cash forecast/);
    assert.match(await page.locator("#pane-dash .lstate .lv-pill").innerText(), /Highest alert: Red/);
    await page.click(".tab[data-tab=gap]"); await page.waitForTimeout(700);
    const h2 = await page.locator("#pane-gap .dsec h2").allInnerTexts();
    assert.deepEqual(h2.slice(0, 3), ["13-week cash forecast", "Daily cash balance", "Cash gaps"]);
    assert.match(h2[3], /^Financing ranking/);
    const cards = page.locator("#pane-gap .ep");
    assert.equal(await cards.count(), 5);
    for (const t of await cards.allInnerTexts()) assert.match(t, /Red alert/);
    assert.doesNotMatch(await page.locator("#pane-gap").innerText(), /Target gap|No TV3 result/);
    assert.equal(await page.locator("#pane-gap #gapChart .gapband").count(), 5);
    await page.click('#pane-gap .ep[data-ep="3"]'); await page.waitForTimeout(600);
    assert.deepEqual(await page.locator("#pane-gap .ft thead th.gapwk").evaluateAll((els) => els.map((e) => e.dataset.w)), ["4", "5"]);
    assert.equal(await page.locator("#pane-gap table:not(.ft) tbody tr td:nth-child(2) b").first().innerText(), "INV-001");
    await shot(page, `${theme}-shortfall`);
  });
  await step(`[${theme}] alert colours follow SRS 2.8.11.3 boundaries`, async () => {
    const lv = await page.evaluate(() => [400e6, 399999999, 250e6, 249999999, 500e6, -1].map((c) => alertLevel(c, 500e6)));
    assert.deepEqual(lv, ["yellow", "orange", "orange", "red", "green", "red"], "gr=20% yellow, 50%/Rmin orange, below Rmin red");
    const weeksOk = await page.evaluate(() => { const c = C(), M = weeklyModel(c);
      const th = [...document.querySelectorAll("#pane-gap .ft thead th[data-w]")], lo = [...document.querySelectorAll("#pane-gap .ft tr.lowwk td[data-w]")];
      return th.length === 13 && th.every((t, i) => t.dataset.lv === alertLevel(M.W[i].bal, c.buffer))
        && lo.every((t, i) => t.dataset.lv === alertLevel(Math.min(...c.days.slice(7 * i, 7 * i + 7).map((d) => d[1])), c.buffer)); });
    assert.ok(weeksOk, "week cells use the week-end balance; lowest-in-week uses the worst day");
  });
  await step(`[${theme}] F02/F03 base render without errors`, async () => {
    for (const fm of ["F02", "F03"]) {
      await page.evaluate((f) => { switchContext(f, "base", { silent: true }); advance(3); setTab("dash"); }, fm); await page.waitForTimeout(500);
      assert.match(await page.locator("#pane-dash .lv-pill").innerText(), /Blue/);
      await page.evaluate(() => setTab("gap")); await page.waitForTimeout(500);
      assert.match(await page.locator("#pane-gap").innerText(), /No cash shortfall/);
    }
    await page.evaluate(() => switchContext("F01", defCase("F01"), { silent: true }));
  });
  await step(`[${theme}] Company data opens separately and returns to the same conversation`, async () => {
    const chatBefore = await page.locator(".messages.on").innerText();
    await page.click('[data-view="data"]');
    assert.equal(await page.locator("#dataScreen").isVisible(), true);
    assert.equal(await page.locator("#work").isVisible(), false);
    assert.equal(await page.locator(".data-page-tabs").isVisible(), false);
    await shot(page, `${theme}-company-data`);
    await page.click("#dataBack");
    assert.equal(await page.locator("#work").isVisible(), true);
    assert.equal(await page.locator(".messages.on").innerText(), chatBefore);
  });
  await step(`[${theme}] New chat resets progress and keeps the account company`, async () => {
    await page.click("#newChat"); await page.waitForTimeout(500);
    assert.equal(await page.locator(".messages.on .flow-divider").count(), 0);
    assert.equal(await page.evaluate(() => S.firm), "F01");
    assert.equal(await page.locator("#uSub").innerText(), "Alpha Garment Subcontractor");
  });
  if (theme === "light") await step("file registry supports import, search, filters, sorting and safe deletion", async () => {
    await page.click('[data-view="data"]');
    await page.click("#dataAddSources");
    await page.locator("#dataFileInput").setInputFiles(Object.entries(SAMPLE_CSV).map(([name, text]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) })));
    await page.waitForFunction(() => document.querySelectorAll(".files-table tbody tr").length === 6);
    await page.waitForFunction(() => /Not used: demo data is fixed/.test(document.querySelector("#dataFiles").innerText), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => S.firm), "F01");
    await page.click("#dataAddSources");
    await page.locator("#dataFileInput").setInputFiles({ name: "extra.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV["financials.csv"]) });
    await page.waitForFunction(() => document.querySelectorAll(".files-table tbody tr").length === 7);
    assert.equal(await page.locator("#filesSort").inputValue(), "newest");
    const latest = await page.locator(".files-table tbody tr .file-name b").first().innerText();
    assert.equal(latest, "extra.csv");
    await page.fill("#filesSearch", "financials");
    await page.waitForFunction(() => document.querySelectorAll(".files-table tbody tr").length === 1);
    assert.match(await page.locator(".files-table tbody").innerText(), /financials\.csv/);
    await page.fill("#filesSearch", ""); await page.selectOption("#filesType", "docx"); await page.waitForSelector("#dataFiles .files-empty");
    assert.match(await page.locator("#dataFiles").innerText(), /No files match your search/);
    await page.selectOption("#filesType", "all"); await page.selectOption("#filesSort", "alpha");
    await page.waitForFunction(() => document.querySelectorAll(".files-table tbody tr").length === 7);
    const names = await page.locator(".files-table tbody .file-name b").allInnerTexts();
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
    await page.locator("#filesSelectAll").check(); await page.waitForSelector("#fileSelection:not([hidden])");
    assert.match(await page.locator("#fileSelection").innerText(), /7 selected/);
    await page.click("#deleteSelected");
    assert.match(await page.locator("#modal").innerText(), /Data already used in your analysis is kept\./);
    await page.click("#filesYes"); await page.waitForSelector("#dataFiles .files-empty");
    assert.match(await page.locator("#dataFiles").innerText(), /No files uploaded yet/);
    await page.click("#dataBack");
  });
  if (theme === "light") await step("composer plus uploads without advancing the flow; demo data stays fixed", async () => {
    await page.locator("#chatFile").setInputFiles([
      { name: "sales_invoices.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV["sales_invoices.csv"]) },
      { name: "reference.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("reference") },
      { name: "unknown.csv", mimeType: "text/csv", buffer: Buffer.from("alpha,beta\n1,2") },
    ]);
    assert.equal(await page.locator(".upload-chip").count(), 3);
    await page.locator("#uploadChatFiles").evaluate(el => el.click());
    await page.waitForFunction(() => /reference only/.test(document.querySelector(".messages.on .msg.bot:last-child")?.innerText || ""), null, { timeout: 10000 });
    const reply = await page.locator(".messages.on .msg.bot").last().innerText();
    assert.match(reply, /3 files added\. Demo accounts keep their fixed sample data\./); assert.match(reply, /Word documents are kept for reference only/);
    assert.equal(await page.locator(".messages.on .msg.bot .rcact button").count(), 0, "no review step");
    assert.equal(await page.evaluate(() => S.firm), "F01");
  });
  if (theme === "light") await step("chat options open next to the row; rename has Cancel and Save", async () => {
    const row = page.locator(".chat-row").first();
    await row.hover(); await row.locator(".chat-more").click();
    assert.equal(await page.locator(".chat-menu").isVisible(), true);
    await page.waitForTimeout(300); // let the open animation settle before measuring
    assert.equal(await page.locator("#scrim.show").count(), 0, "the menu is not a modal");
    const btn = await row.locator(".chat-more").boundingBox(), menu = await page.locator(".chat-menu").boundingBox();
    assert.ok(Math.abs(menu.y - (btn.y + btn.height)) < 12 || Math.abs(menu.y + menu.height - btn.y) < 12, "menu sits next to the button");
    const before = await row.locator(".chat-open").innerText();
    await page.click('[data-chat-act="rename"]');
    assert.equal(await page.locator(".chat-menu").count(), 0);
    await page.fill("#chatName", "Not saved"); await page.click("#chatCancelName");
    assert.equal(await row.locator(".chat-open").innerText(), before);
    await row.hover(); await row.locator(".chat-more").click(); await page.click('[data-chat-act="rename"]');
    await page.fill("#chatName", "Cash review"); await page.click("#chatSaveName");
    assert.equal(await page.locator(".chat-row .chat-open").first().innerText(), "Cash review");
  });
  // ERR_TUNNEL_CONNECTION_FAILED only comes from a sandbox proxy blocking the XLSX CDN script.
  await step(`[${theme}] no JavaScript errors`, async () => assert.deepEqual(errors.filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED/.test(e)), []));
  await page.close();
}

await step("mobile 390px: no horizontal scroll, menu opens", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URL0); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click("#btnDemo"); await page.waitForSelector("#app:not([hidden])");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await page.waitForTimeout(400);
  await shot(page, "mobile-390-flow");
  await page.click("#menuBtn"); await page.click('[data-view="data"]');
  assert.equal(await page.locator("#dataScreen").isVisible(), true);
  await page.click("#dataAddSources");
  await page.locator("#dataFileInput").setInputFiles({ name: "mobile_sales.csv", mimeType: "text/csv", buffer: Buffer.from(SAMPLE_CSV["sales_invoices.csv"]) });
  await page.waitForSelector(".files-table tbody tr");
  assert.equal(await page.locator(".file-name").isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await shot(page, "mobile-390-company-data");
  await page.click("#dataBack");
  await page.click("#menuBtn"); await page.waitForTimeout(500);
  assert.equal(await page.locator("#side").isVisible(), true);
  await page.close();
});

await browser.close(); server.close();
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
