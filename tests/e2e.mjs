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
  // The sign-in screen is ready once the demo accounts are stored (their passwords are hashed asynchronously on first load).
  const authReady = async () => { await page.waitForSelector("#authRoot:not([hidden])"); await page.waitForFunction(() => JSON.parse(localStorage.getItem("smefc.users.v1") || "[]").length >= DEMOS.length); await page.waitForTimeout(300); };
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
  await step("the single demo account opens F01; retired demo accounts of F02/F03 are removed", async () => {
    await page.evaluate(() => { localStorage.setItem("smefc.users.v1", JSON.stringify([{ id: "u-demo-f02", email: "beta.demo@smecopilot.vn", firmId: "F02", company: "Beta Fabric Distributor", name: "Beta", salt: "x", hash: "x" }])); });
    await page.reload(); await authReady();
    const emails = await page.evaluate(() => JSON.parse(localStorage.getItem("smefc.users.v1")).map(u => u.email));
    assert.deepEqual(emails, ["demo@smecopilot.vn"]);
    assert.equal(await page.locator("[data-demo]").count(), 0, "no demo buttons for removed sample companies");
    assert.deepEqual(await page.evaluate(() => SAMPLE_FIRMS), ["F01"]);
    await page.evaluate(() => localStorage.clear());
  });
  await page.close();
}

// Engine acceptance cases (SRS v1.3 Appendix D/E), evaluated in the page against the shared engine (js/engine.js).
// TMK builds a minimal engine input: the FOB reference company of T21–T38 (revenue 30 B, COGS 24 B, 90-day period).
const TMK = `window.TMK=(o={})=>({firm:{id:'T',name:'Test Co',business_model:'FOB',rtarget:500e6,essential_suppliers:[],...(o.firm||{})},
  snapshot_id:'SNP-T-1',as_of:'2026-09-30',source:{type:'upload',id:'upload:test.csv',at:new Date().toISOString()},
  fin:o.fin||[{period_start:'2026-07-03',period_end:'2026-09-30',revenue:30e9,cogs:24e9,opening_cash:1e9,current_assets:20e9}],
  config:{amount_basis:'net',vat_rate:null},tables:{sales:true,purchases:true,inventory:true,planned:true,...(o.tables||{})},
  sales:o.sales||[],purchases:o.purchases||[],inventory:o.inventory||[],planned:o.planned||[]});`;
const enginePage = await browser.newPage();
await enginePage.goto(URL0); await enginePage.waitForTimeout(400); await enginePage.addScriptTag({ content: TMK });
const ev = (fn, arg) => enginePage.evaluate(fn, arg);
// The SRS Appendix D acceptance cases were written against the sample data before workbook v9. Those companies
// live on as a test-only fixture (X01–X03), loaded into the page beside the shipped F01.
const LEGACY = JSON.parse(await readFile(path.join(ROOT, "tests/fixtures/legacy_samples.json"), "utf8"));
const loadLegacy = (p) => p.evaluate((L) => { Object.entries(L.raw).forEach(([id, raw]) => {
  FIRMS[id] = { name: L.names[id][0], short: L.names[id][1] }; DATA.raw[id] = raw; registerCases(id, ENGINE.inputFromRaw(raw, new Date().toISOString())); }); }, LEGACY);
await loadLegacy(enginePage);
await step("A · sample snapshot: N from the period, Appendix D revenue, converted COGS (T47)", async () => {
  const snap = (id) => ev((id) => { const s = DATA.snaps[id]; return { N: s.N, start: s.period_start, rev: s.fin.revenue, cogs: Math.round(s.fin.cogs), src: s.fin.cogs_src, inv: Math.round(DATA.cases[id + "|base"].invv) }; }, id);
  // Workbook v9 (D_F01): period 01/01–20/06/2026, N = 171, revenue 30 B and COGS 24 B from the financial statements.
  assert.deepEqual(await snap("F01"), { N: 171, start: "2026-01-01", rev: 30e9, cogs: 24e9, src: "financials", inv: 1573770492 });
  assert.deepEqual(await snap("X01"), { N: 183, start: "2026-04-01", rev: 18108528000, cogs: 14385833333, src: "converted", inv: 3450000000 });
  assert.equal(await ev(() => DATA.snaps.X02.fin.revenue), 24031968000);
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
  const r = await ev(() => { const s = ENGINE.makeSnapshot(ENGINE.inputFromRaw(DATA.raw.X01, new Date().toISOString()), { asOf: "2026-08-31" }); return { N: s.N, start: s.period_start, sid: s.snapshot_id }; });
  assert.deepEqual(r, { N: 183, start: "2026-03-02", sid: "SNP-X01-20260930-01@2026-08-31/183d" });
  const f = await ev(() => { const s = ENGINE.makeSnapshot(DATA.inputs.F01, { asOf: "2026-05-31" }); return { N: s.N, start: s.period_start, sid: s.snapshot_id }; });
  assert.deepEqual(f, { N: 183, start: "2025-11-30", sid: "F01-20260620-SYN171-v1@2026-05-31/183d" });
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
  // DM7: DSO 112.9, revenue 741.1 B a year, current assets 406.3 B (FOB) → W2, money_at_risk 114.1 B.
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
  // E_AR = (60 − 56.7222) × 100 M/day ≈ 327.8 M (watch threshold at the Nguong precision); current assets E_AR ÷ share.
  const at = (share) => B({ rev: 9e9, cogs: 8e9, dso: 60, ca: (60 - 56.7221787175074) * 100e6 / share });
  assert.equal((await at(0.0499)).w, "W1"); assert.equal((await at(0.0501)).w, "W2");
  let r = await B({ dso: 56.7 }); assert.equal(r.w, "W0"); assert.deepEqual(r.rules, []);
  r = await ev(() => { const x = TCASE({ dpo: 70 }); return [x.wc_class, x.info_rules]; }); assert.deepEqual(r, ["W0", ["R-AP-INFO"]]);
  r = await B({ dpo: 10, buffer: 0.04 }); assert.equal(r.w, "W1"); assert.deepEqual(r.rules, ["R-AP-1"]); assert.equal(r.bn, "BN3");
});
await step("B · T11 small overdue invoice, T12 customer-owned stock, T13 missing due dates, T14 zero revenue", async () => {
  // Workbook v9: c_AR comes from the DSO level only, so an overdue invoice under a normal DSO is a signal (R-AR-OD), not a pocket.
  let r = await B({ arOverdue: [{ amount: 100e6, dpd: 45, term: 30 }] });                      // ρ = 1.5, 0.5 % of current assets
  assert.deepEqual([r.w, r.bn, r.shape.AR, r.rules], ["W0", "BN0", "L", ["R-AR-OD"]]);
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
  // E = (value − watch threshold) × daily base, thresholds at the Nguong precision (56.7222 / 98.4403 days).
  r = await B({ dso: 58 }); assert.deepEqual([r.bn, r.w, r.mar, r.share, r.main, r.shape.AR], ["BN1", "W1", 426, 2.13, "AR", "H"]);
  r = await B({ dso: 80 }); assert.deepEqual([r.bn, r.w, r.mar, r.share], ["BN1", "W2", 7759, 38.8]);
  r = await B({ dio: 150 }); assert.deepEqual([r.bn, r.w, r.mar], ["BN2", "W2", 13749]);
  // Workbook v9: overdue payables are E_AP (an obligation), c_AP comes only from a low DPO with a thin buffer.
  r = await B({ apOverdue: [{ amount: 1200e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.mar, r.ob, r.rules], ["BN0", "W0", 0, 1200, ["R-AP-OD"]]);
  r = await B({ dpo: 10, buffer: 0.04 }); assert.deepEqual([r.bn, r.w, r.mar, r.ob], ["BN3", "W1", 0, 0]);
});
await step("B · T28–T34 combined patterns, double counting and tie order", async () => {
  // Workbook v9: only DSO/DIO above their thresholds and ap1 set the pattern; overdue items and slow lots stay signals and details.
  let r = await B({ dso: 58, dio: 100 }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN4", "W1", "AR", 842]);
  r = await B({ dso: 80, dio: 100 }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN4", "W2", "AR", 8175]);
  r = await B({ dso: 58, apOverdue: [{ amount: 300e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.main, r.mar, r.ob], ["BN1", "W1", "AR", 426, 300]);
  r = await B({ dio: 90, slowLots: [{ amount: 600e6, days: 90 }], apOverdue: [{ amount: 400e6, dpd: 40, term: 30 }] });
  assert.deepEqual([r.bn, r.w, r.main, r.mar, r.ob, r.shape.INV, r.shape.AP], ["BN0", "W0", null, 0, 400, "L", "L"]);
  r = await ev(() => { const x = TCASE({ N: 183, rev: 20e9, cogs: 16e9, ca: 18977.6e6, dso: 7061.3e6 * 183 / 20e9, dio: 10716.3e6 * 183 / 16e9, dpo: 1941.2e6 * 183 / 16e9, buffer: 0.03,
    apOverdue: [{ amount: 370.8e6, dpd: 40, term: 30 }] }); return { s: SUMMARY(x), e: x.item_states.map((i) => Math.round(i.E / 1e5) / 10) }; });
  // DPO 22.2 days is above the FOB low threshold, so AP is an obligation (E_AP) and the pattern is BN4, as F01 in workbook v9.
  assert.deepEqual([r.s.bn, r.s.w, r.s.main], ["BN4", "W2", "INV"]); assert.deepEqual(r.e, [862.2, 2109.5, 370.8]); assert.equal(r.s.mar, 2972);
  r = await B({ dso: 62, arOverdue: [{ amount: 600e6, dpd: 40, term: 30 }] }); assert.deepEqual([r.bn, r.w, r.mar, r.shape.AR], ["BN1", "W2", 1759, "HL"]);
  r = await B({ arOverdue: [{ amount: 500e6, dpd: 40, term: 30 }], slowLots: [{ amount: 500e6, days: 90 }] }); assert.deepEqual([r.bn, r.w, r.main, r.mar], ["BN0", "W0", null, 0]);
});
await step("B · T35 missing payables, T36 provisional stock, T37 concentrated receivables", async () => {
  let r = await ev(() => { const x = TCASE({ dso: 58, tables: { purchases: false } }); return [x.wc_class, x.bn_pattern, x.item_states.map((i) => i.value == null ? null : Math.round(i.value))]; });
  assert.deepEqual(r, ["unknown", "unknown", [58, 70, null]]);
  r = await ev(() => { const input = TMK({ fin: [{ period_start: "2026-07-03", period_end: "2026-09-30", revenue: 30e9, cogs: 24e9, opening_cash: 1e9, current_assets: 20e9 }],
    sales: [{ id: "S", customer: "K", amount: 40 * 30e9 / 90, issue: "2026-09-20", due: "2026-10-20", paid: null }], purchases: [{ id: "P", supplier: "S", amount: 30 * 24e9 / 90, issue: "2026-09-20", due: "2026-10-20", paid: null }],
    inventory: [{ name: "Unlabelled stock", type: null, qty: 1, unit_cost: 70 * 24e9 / 90, days: 10, owner: null }] });
    const x = ENGINE.diagnose(ENGINE.makeSnapshot(input, { periodStart: "2026-07-03" })); return [x.bn_pattern, x.wc_class, x.coverage.INV, x.item_states[1].provisional, x.status]; });
  assert.deepEqual(r, ["BN0", "W0", "provisional", true, "provisional"]);
  // T37 with an aggregate DSO excess: E_AR is allocated in proportion to open receivables (K1 holds 97.9 %).
  r = await ev(() => TCASE({ dso: 58, mainCustomer: "K1", arOverdue: [{ customer: "K2", amount: 400e6, dpd: 40, term: 30 }] }).concentration);
  assert.equal(r.flag, "concentrated"); assert.equal(r.top.name, "K1"); assert.equal(Math.round(r.top.share * 100), 98); assert.equal(r.basis, "open_receivables_pro_rata");
});
await step("B · T47 F01 cash cycle and T48/T49 cause breakdowns", async () => {
  const cyc = (id) => ev((id) => { const d = uc01(id); return { dso: d.metrics.dso.toFixed(1), dio: d.metrics.dio.toFixed(1), dpo: d.metrics.dpo.toFixed(1), ccc: d.metrics.ccc.toFixed(1), cogs: d.coverage.cogs }; }, id);
  assert.deepEqual(await cyc("X01"), { dso: "49.6", dio: "43.9", dpo: "24.8", ccc: "68.7", cogs: "provisional" });
  assert.deepEqual(await cyc("F01"), { dso: "39.2", dio: "11.2", dpo: "9.3", ccc: "41.1", cogs: "ok" });   // workbook v9 F01_UC1
  // T48 assumes E_AR equals the total overdue: K1 tier 4 817,756,000; K3 tier 2 53,809,000; cancelled lot 430,000,000.
  const t48 = await ev(() => ENGINE.decompose({ E_AR: 871565000, E_INV: 430000000, arFlagged: [{ amount: 817756000, tier: 4 }, { amount: 53809000, tier: 2 }], slowLots: [{ amount: 430000000, cancelled: true }] }));
  assert.equal(t48.ok, true); assert.deepEqual(t48.parts.filter((p) => p.amount).map((p) => [p.source, p.amount]), [[1, 817756000], [2, 53809000], [6, 430000000]]);
  assert.equal(t48.total, 1301565000); assert.equal(t48.main_cause_detail.source, 1); assert.equal((t48.main_cause_detail.share * 100).toFixed(1), "62.8");
  const t49 = await ev(() => ENGINE.decompose({ E_AR: 860267000, E_INV: 1450000000, arFlagged: [{ amount: 248943000, tier: 4 }, { amount: 611324000, tier: 3 }], slowLots: [{ amount: 1450000000, cancelled: false }] }));
  assert.equal(t49.total, 2310267000); assert.equal(t49.main_cause_detail.source, 5); assert.equal((t49.main_cause_detail.share * 100).toFixed(1), "62.8");
  // T56 under workbook v9: flagged invoices larger than E_AR are scaled into it pro rata, so the parts still add up to E_AR.
  const big = await ev(() => ENGINE.decompose({ E_AR: 100, E_INV: 0, arFlagged: [{ amount: 300, tier: 4 }, { amount: 100, tier: 2 }], slowLots: [] }));
  assert.equal(big.ok, true); assert.deepEqual(big.parts.filter((p) => p.amount).map((p) => [p.source, p.amount]), [[1, 75], [2, 25]]); assert.equal(big.total, 100);
});

await step("C · T39–T42 customer profiles of the legacy F01 (K1 large, tier 4; K3 small, tier 2)", async () => {
  const r = await ev(() => { const p = uc01("X01").profiles, k = (n) => p.customers.find((c) => c.name.endsWith(n));
    const K1 = k("K1"), K3 = k("K3");
    return { k1: [K1.revenue, (K1.revenue_share * 100).toFixed(1), K1.size, K1.ar, (K1.ar_share * 100).toFixed(1), p.exposureOrder[0] === K1.key, K1.late_pos_wavg.toFixed(1), K1.max_overdue, K1.overdue,
        K1.behaviour, K1.debt_status, K1.tier, K1.notes.includes("strategic_not_confirmed"), K1.whitelist],
      k3: [K3.revenue, (K3.revenue_share * 100).toFixed(1), K3.size, K3.late_pos_wavg.toFixed(1), K3.behaviour, K3.overdue, K3.debt_status, K3.tier, K3.action, K3.whitelist] }; });
  assert.deepEqual(r.k1, [11820351000, "65.3", "large", 3888513000, "79.2", true, "20.5", 11, 817756000, "frequent_late", "overdue", 4, true, "name_match_unverified"]);
  assert.deepEqual(r.k3, [1813146000, "10.0", "small", "9.5", "on_time", 53809000, "overdue", 2, "tighten_now", "BUYER_NOT_IN_PROGRAM"]);
});
await step("C · T43 supplier Beta, T44 khaki stock at a trader, T45 cancelled-order trims, T46 customer fabric", async () => {
  const r = await ev(() => { const s = uc01("X01").profiles.suppliers.find((x) => x.name.startsWith("Beta")), p2 = uc01("X02").profiles, p1 = uc01("X01").profiles;
    const kaki = p2.lots.find((l) => l.name.startsWith("Khaki")), trims = p1.lots.find((l) => l.name.startsWith("Trims for cancelled")), hgc = p1.lots.find((l) => l.name.startsWith("Fabric supplied"));
    return { beta: [s.purchases, (s.dependency * 100).toFixed(1), s.dependency_high, (s.discount.r_disc * 100).toFixed(1), s.essential, s.conclusion],
      kaki: [kaki.value, kaki.days, kaki.suggested_type, kaki.status, kaki.stuck, kaki.checks.includes("trader_should_be_HH")],
      trims: [trims.cancel_status, trims.status, trims.stuck, trims.collateral, trims.collateral_pending], hgc: [hgc.status, hgc.value_own, hgc.stuck, hgc.collateral, uc01("X01").metrics.INV] }; });
  assert.deepEqual(r.beta, [4627174000, "53.5", true, "37.2", "yes", "pay_on_time"]);
  assert.deepEqual(r.kaki, [1450000000, 155, "HH", "slow", 1450000000, true]);
  assert.deepEqual(r.trims, ["proposed", "cancelled", 430000000, 430000000, true]);   // before confirmation: still slow-moving stuck stock, collateral pending
  assert.deepEqual(r.hgc, ["excluded", 0, 0, 0, 3450000000]);
  // After the owner confirms the cancelled order the lot leaves the collateral (T45).
  const c = await ev(() => { const raw = JSON.parse(JSON.stringify(DATA.raw.X01)); raw.inventory.find((l) => l[0].startsWith("Trims for cancelled"))[6] = "yes";
    const s = ENGINE.makeSnapshot(ENGINE.inputFromRaw(raw, new Date().toISOString())), d = ENGINE.diagnose(s), p = ENGINE.profiles(s, d); const l = p.lots.find((x) => x.name.startsWith("Trims for cancelled")); return [l.stuck, l.collateral]; });
  assert.deepEqual(c, [430000000, 0]);
});
await step("C · T50 company size, T51 size band, T52 new customer, T53 strategic flag, T54/T55 tax codes", async () => {
  const size = await ev(() => uc01("X02").profiles.size);
  assert.equal(size.tier, "small"); assert.equal((size.annual / 1e9).toFixed(2), "47.93"); assert.equal(size.status, "provisional"); assert.equal(size.near_cap, true);
  const band = await ev(() => { let prev = "medium"; return [0.305, 0.325, 0.29, 0.275].map((s) => (prev = ENGINE.sizeLabel(s, prev))); });
  assert.deepEqual(band, ["medium", "large", "large", "medium"]);
  const t52 = await ev(() => { const input = TMK({ sales: [{ id: "N1", customer: "New Co", amount: 100e6, issue: "2026-09-01", due: "2026-10-15", paid: null },
    { id: "O1", customer: "Old Co", amount: 900e6, issue: "2026-08-01", due: "2026-10-30", paid: null }] });
    const s = ENGINE.makeSnapshot(input, { periodStart: "2026-07-03" }), d = ENGINE.diagnose(s), c = ENGINE.profiles(s, d).customers.find((x) => x.name === "New Co"); return [c.relationship, c.tier, c.action]; });
  assert.deepEqual(t52, ["new", 1, "strict_terms_new_orders"]);
  const t53 = await ev(() => { const mk = (strat) => { const input = TMK({ firm: { strategic_customers: strat }, fin: [{ period_start: null, period_end: "2026-09-30", revenue: null, cogs: 24e9, opening_cash: 1e9, days: 90 }], sales: Array.from({ length: 12 }, (_, i) => ({ id: "A" + i, customer: "Anchor", amount: 40e6, issue: ENGINE.diso(ENGINE.dnum("2026-04-05") + i * 14), due: "2026-10-20", paid: null }))
      .concat(Array.from({ length: 12 }, (_, i) => ({ id: "B" + i, customer: "Other", amount: 60e6, issue: ENGINE.diso(ENGINE.dnum("2026-04-06") + i * 14), due: "2026-10-20", paid: null }))) });
    const s = ENGINE.makeSnapshot(input), d = ENGINE.diagnose(s), c = ENGINE.profiles(s, d).customers.find((x) => x.name === "Anchor"); return [Math.round(c.revenue_share * 100), c.tier, c.notes.includes("strategic_not_confirmed")]; };
    return [mk([]), mk(["Anchor"])]; });
  assert.deepEqual(t53, [[40, 4, true], [40, 5, false]]);
  const tax = await ev(() => { const input = TMK({ sales: [{ id: "X1", customer: "Kappa JSC", tax_code: "0101234567", amount: 100e6, issue: "2026-09-01", due: "2026-10-01", paid: null },
    { id: "X2", customer: "KAPPA Joint Stock Co.", tax_code: "0101234567", amount: 50e6, issue: "2026-09-02", due: "2026-10-02", paid: null },
    { id: "X3", customer: "No Tax Ltd", amount: 70e6, issue: "2026-09-03", due: "2026-10-03", paid: null }] });
    const s = ENGINE.makeSnapshot(input), d = ENGINE.diagnose(s), cs = ENGINE.profiles(s, d, { whitelist: ["No Tax Ltd"] }).customers; return cs.map((c) => [c.key, c.ar, c.key_weak, c.whitelist]); });
  assert.deepEqual(tax, [["TAX:0101234567", 150e6, false, "BUYER_NOT_IN_PROGRAM"], ["NAME:no tax ltd", 70e6, true, "name_match_unverified"]]);
});

// UC02 delay model and scenarios (phase E). QF builds a forecast input around one customer / supplier.
await enginePage.addScriptTag({ content: `window.QF=(o={})=>{const d=(x)=>ENGINE.diso(ENGINE.dnum('2026-09-30')+x);
  const input=TMK({fin:[{period_start:'2026-07-03',period_end:'2026-09-30',revenue:o.revenue??9e9,cogs:7e9,opening_cash:o.cash??1e9,current_assets:10e9}],
    sales:(o.sales||[]).map((s,i)=>({id:s.id||'S'+i,customer:s.c||'K1',amount:s.a??100,issue:s.iss!=null?d(s.iss):d((s.due??0)-30),due:s.due==null?null:d(s.due),paid:s.paid==null?null:d(s.paid)})),
    purchases:(o.purchases||[]).map((p,i)=>({id:p.id||'P'+i,supplier:p.s||'S1',amount:p.a??100,issue:d((p.due??0)-30),due:p.due==null?null:d(p.due),paid:p.paid==null?null:d(p.paid),essential:p.essential||null})),
    planned:(o.planned||[]).map((p,i)=>({id:p.id||'PL'+i,date:p.date==null?null:d(p.date),week:p.week||null,direction:p.dir||'OUT',category:p.cat||'payroll',amount:p.a,certainty:p.cert||'estimated',source_id:p.src||null})),
    firm:o.firm||{}});if(o.config)input.config=o.config;
  const snap=ENGINE.makeSnapshot(input,{periodStart:'2026-07-03'});return {snap,fc:ENGINE.forecast(snap,{cash0:o.cash??1e9,config:input.config})}};
window.RECV=(fc,sc,id)=>{const e=fc.scenarios[sc].events.find(x=>x.id===id);return e.t==null?null:ENGINE.diso(e.t)};` });
await step("E · Q01 horizon, Q11 balances, Q03 sample window, Q04 positive lateness", async () => {
  const r = await ev(() => { const { fc } = QF({ cash: 100, planned: [{ date: 1, dir: "OUT", a: 150 }, { date: 7, dir: "IN", a: 100, cert: "confirmed" }] }), ds = fc.scenarios.base.days;
    return { start: fc.start, end: fc.end, n: ds.length, w1: [ds[0].d, ds[6].d], min: Math.min(...ds.map((x) => x.close)), last: ds.at(-1).close }; });
  assert.deepEqual(r, { start: "2026-10-01", end: "2026-12-30", n: 91, w1: ["2026-10-01", "2026-10-07"], min: -50, last: 50 });
  const w = await ev(() => ENGINE.delaySamples(ENGINE.makeSnapshot(TMK({ sales: [-179, -180, 0].map((x, i) => ({ id: "W" + i, customer: "K", amount: 100, issue: ENGINE.diso(ENGINE.dnum("2026-09-30") + x - 30), due: ENGINE.diso(ENGINE.dnum("2026-09-30") + x), paid: null })) })).sales, ENGINE.dnum("2026-09-30")).map((s) => s.id));
  assert.deepEqual(w, ["W0", "W2"]);
  const q4 = await ev(() => { const s = ENGINE.makeSnapshot(TMK({ sales: [{ id: "A", customer: "K", amount: 100, issue: "2026-07-01", due: "2026-08-01", paid: "2026-08-11" }, { id: "B", customer: "K", amount: 100, issue: "2026-07-01", due: "2026-08-21", paid: "2026-08-11" }] }), { periodStart: "2026-07-03" });
    return [ENGINE.delayStats(ENGINE.delaySamples(s.sales, ENGINE.dnum("2026-09-30"))).mean, ENGINE.profiles(s, ENGINE.diagnose(s)).customers[0].late_pos_wavg]; });
  assert.deepEqual(q4, [5, 5]);
});
await step("E · Q31/Q32 truncated samples and the fallback chain customer → company → 7 days", async () => {
  const r = await ev(() => { const hist = Array.from({ length: 5 }, (_, i) => ({ c: "Big", due: -100 + i * 10, paid: -100 + i * 10 + 4 }));
    const { snap, fc } = QF({ sales: [...hist, { id: "OPEN", c: "Big", due: -6 }, { id: "NEWCUST", c: "Small", due: 10 }, { id: "BIG2", c: "Big", due: 20 }] });
    const samples = ENGINE.delaySamples(snap.sales, ENGINE.dnum("2026-09-30")), open = samples.find((s) => s.id === "OPEN");
    const lone = QF({ sales: [{ id: "ONLY", c: "Solo", due: 10 }] }).fc;
    return { trunc: [open.late, open.truncated], tiers: Object.values(fc.delays.receipts).map((x) => [x.name, x.tier]), newcust: RECV(fc, "base", "NEWCUST"), big2: RECV(fc, "base", "BIG2"),
      lone: [Object.values(lone.delays.receipts)[0].tier, RECV(lone, "base", "ONLY")] }; });
  assert.deepEqual(r.trunc, [6, true]);
  assert.deepEqual(r.tiers, [["Big", "customer"], ["Small", "pool"]]);
  assert.deepEqual(r.lone, ["default", "2026-10-17"]);                 // due 10/10 + 7 default days
});
await step("E · Q33/Q34 overdue receivables: conditional delay with ≥ 3 samples, otherwise dpd + 3/10/21; never before as_of + 1", async () => {
  const r = await ev(() => { const hist = [20, 22, 25, 30, 2, 3].map((late, i) => ({ c: "K1", due: -150 + i * 15, paid: -150 + i * 15 + late }));
    const a = QF({ sales: [...hist, { id: "OD", c: "K1", due: -11 }] }).fc;
    const b = QF({ sales: [...hist.slice(4), { c: "K1", due: -40, paid: -38 }, { c: "K1", due: -30, paid: -29 }, { c: "K1", due: -20, paid: -20 }, { id: "OD", c: "K1", due: -11 }] }).fc;
    return { cond: ["base", "optimistic", "conservative"].map((k) => [a.scenarios[k].events.find((e) => e.id === "OD").method, RECV(a, k, "OD")]),
      resid: ["optimistic", "base", "conservative"].map((k) => RECV(b, k, "OD")) }; });
  assert.ok(r.cond.every(([m]) => m === "customer_conditional"));
  assert.ok(r.cond.every(([, d]) => d >= "2026-10-01"));
  assert.deepEqual(r.resid, ["2026-10-03", "2026-10-10", "2026-10-21"]);   // as_of + 3 / 10 / 21
});
await step("E · Q35/Q36 overdue payables are spread (offset + rank mod 5); essential suppliers are paid on the due date", async () => {
  const r = await ev(() => { const { fc } = QF({ purchases: [...[-30, -25, -20, -15, -10, -5].map((due, i) => ({ id: "OP" + i, due })), { id: "ESS", s: "Key mill", due: 12, essential: "yes" },
    ...Array.from({ length: 5 }, (_, i) => ({ s: "Late payer", due: -170 + i * 20, paid: -170 + i * 20 + 6 })), { id: "HIST", s: "Late payer", due: 12 }] });
    const ids = ["OP0", "OP1", "OP2", "OP3", "OP4", "OP5"];
    return { spread: Object.fromEntries(["conservative", "base", "optimistic"].map((k) => [k, ids.map((id) => RECV(fc, k, id).slice(8))])),
      ess: ["base", "optimistic", "conservative"].map((k) => RECV(fc, k, "ESS")), hist: ["base", "conservative"].map((k) => RECV(fc, k, "HIST")) }; });
  // Workbook v9: rank is the 1-based position in invoice-id order, so the first overdue bill lands on offset + 1.
  assert.deepEqual(r.spread, { conservative: ["02", "03", "04", "05", "01", "02"], base: ["06", "07", "08", "09", "05", "06"], optimistic: ["11", "12", "13", "14", "10", "11"] });
  assert.deepEqual(r.ess, ["2026-10-12", "2026-10-12", "2026-10-12"]);
  assert.deepEqual(r.hist, ["2026-10-18", "2026-10-12"]);               // historical: due + 6 days; Conservative: due
});
await step("E · Q37 scenario order on the sample and the legacy samples, reconciliation and the sample scenario table", async () => {
  const r = await ev(() => Object.fromEntries(["F01", "X01", "X02", "X03"].map((f) => { const fc = DATA.forecasts[f], rt = DATA.snaps[f].firm.rtarget;
    return [f, { order: fc.order_ok, recon: fc.recon_ok, mins: ENGINE.SCENARIOS.map((sc) => Math.round(Math.min(...fc.scenarios[sc].days.map((x) => x.close)) / 1e6)),
      need: Math.round(Math.max(0, rt - Math.min(0, fc.scenarios.base.minCum)) / 1e6) }]; })));
  for (const f of ["F01", "X01", "X02", "X03"]) { assert.equal(r[f].order, true); assert.equal(r[f].recon, true); }
  // Workbook v9 F01_UC2: every scenario bottoms out at −3,063.6 M on 18/09 (after the last open receipt); Continuing −4,725.7 M; need 4,763.6 M.
  assert.deepEqual(r.F01, { order: true, recon: true, mins: [-3064, -3064, -3064, -3064, -4726], need: 4764 });
  // Legacy samples under the v9 delay model and continuing defaults (Table E-2 had X01 Conservative −1,009 and Continuing 156 / 251).
  assert.deepEqual(r.X01, { order: true, recon: true, mins: [-619, -619, -619, -902, 247], need: 2319 });
  assert.deepEqual(r.X02, { order: true, recon: true, mins: [998, 1383, 749, 490, 998], need: 1802 });
  assert.deepEqual(r.X03, { order: true, recon: true, mins: [631, 808, 602, 333, 631], need: 369 });
});
await step("E · Q39/Q40 VAT basis and the same data through the upload path; Q07–Q10 unscheduled, duplicates, out of horizon", async () => {
  const vat = await ev(() => { const s = [{ id: "V", c: "K1", a: 1000, due: 10 }];
    const net = QF({ sales: s }).fc, rate = QF({ sales: s, config: { amount_basis: "net", vat_rate: 0.08 } }).fc, gross = QF({ sales: s, config: { amount_basis: "gross", vat_rate: 0.08 } }).fc;
    const amt = (fc) => fc.scenarios.base.events.find((e) => e.id === "V").amt;
    return [amt(net), net.issues.some((i) => i.code === "VAT_NOT_MODELLED"), amt(rate), amt(gross)]; });
  assert.deepEqual(vat, [1000, true, 1080, 1000]);
  const same = await ev(() => { const raw = DATA.raw.X01, snapApp = { id: "v1", asOf: raw.snapshot.as_of, ts: Date.now(), files: ["f01.csv"], tables: {
      sales: raw.sales.map(([id, buyer, amt, issue, due, paid]) => ({ id, buyer, amt, issue, due, paid: paid || "" })),
      purchases: raw.purchases.map(([id, supplier, amt, issue, due, paid, dp, dd]) => ({ id, supplier, amt, issue, due, paid: paid || "", disc_pct: dp, disc_days: dd })),
      inventory: raw.inventory.map(([name, type, qty, unit, days, owner]) => ({ name, inventory_type: type, qty, unit, days, owner })),
      planned: raw.planned.map(([id, date, dir, cat, amt, cert]) => ({ id, date, type: dir === "IN" ? "in" : "out", cat, amt, certainty: cert })),
      fin: [{ rev: raw.fin[0].revenue, cogs: raw.fin[1].cogs, cash0: raw.fin[1].opening_cash, period_start: raw.fin[0].period_start, period_end: raw.fin[0].period_end, days: 183 }] } };
    const firm = { id: "U77", name: "X01 via upload", buffer: raw.firm.rtarget, business_model: "CMT", essential_suppliers: raw.firm.essential_suppliers };
    const s = ENGINE.makeSnapshot(ENGINE.inputFromUpload(firm, snapApp)), fc = ENGINE.forecast(s, { cash0: s.fin.opening_cash });
    const mins = (f) => ["base", "optimistic", "conservative", "stress_7"].map((sc) => Math.round(Math.min(...f.scenarios[sc].days.map((x) => x.close))));
    return [mins(fc).join(","), mins(DATA.forecasts.X01).join(",")]; });
  assert.equal(same[0], same[1]);
  const q = await ev(() => { const { fc } = QF({ sales: [{ id: "NODUE", c: "K1", a: 500, due: null }, { id: "FAR", c: "K1", a: 300, due: 120, iss: -10 }], purchases: [{ id: "P9", a: 200, due: 20 }],
      planned: [{ id: "DUP", date: 20, dir: "OUT", a: 200, src: "P9" }, { id: "WK", week: 3, dir: "OUT", a: 50 }] });
    const b = fc.scenarios.base; return { unsched: b.unscheduled.IN, beyond: b.beyond.IN, dup: b.events.some((e) => e.id === "DUP"), codes: fc.issues.map((i) => i.code), weekly: fc.weekly_only,
      week13: b.days.slice(84).reduce((a, x) => a + x.in, 0) }; });
  assert.equal(q.unsched, 500); assert.equal(q.beyond, 300); assert.equal(q.dup, false); assert.equal(q.week13, 0);
  assert.ok(q.codes.includes("PLAN_DUPLICATES_INVOICE") && q.codes.includes("UNSCHEDULED_AMOUNT") && q.weekly === true);
});
await step("E · two runs on the same data give identical results", async () => {
  const r = await ev(() => { const a = ENGINE.forecast(DATA.snaps.F01, { cash0: 12e8 }), b = ENGINE.forecast(DATA.snaps.F01, { cash0: 12e8 }); return JSON.stringify(a.scenarios) === JSON.stringify(b.scenarios); });
  assert.equal(r, true);
});

// UC02 reserve levels, summary, blocks, TH and the matrix (phase F).
await step("F · Q15/Q16 invalid or missing Rtarget gives no colours; Q58 industry reference levels", async () => {
  const r = await ev(() => { const run = (pol, firm) => { const input = TMK({ firm: firm || {} }), s = ENGINE.makeSnapshot(input, { periodStart: "2026-07-03" }); return ENGINE.runUC02(s, pol || {}, {}); };
    const zero = run({ reserve: { rtarget: 0 } }), bad = run({ reserve: { rmin: 600e6, rtarget: 500e6, rupper: 1e9 } }), neg = run({ reserve: { rtarget: -5 } });
    const q58 = ENGINE.resolveReserves(ENGINE.makeSnapshot(TMK({ firm: { rtarget: null }, fin: [{ period_start: "2025-10-01", period_end: "2026-09-30", revenue: 120e9, cogs: 90e9, opening_cash: 5e9 }] })), {}, "FOB");
    return { zero: [zero.reserves.status, zero.status, zero.overall, zero.th.th], bad: [bad.reserves.status, bad.status, bad.overall], neg: neg.reserves.status,
      q58: [q58.src.rtarget, (q58.rtarget / 1e9).toFixed(1), (q58.rmin / 1e9).toFixed(1), (q58.rupper / 1e9).toFixed(1), q58.status] }; });
  assert.deepEqual(r.zero, ["missing_data", "missing_data", "unknown", "unknown"]);
  assert.deepEqual(r.bad, ["invalid_data", "invalid_data", "unknown"]);
  assert.equal(r.neg, "invalid_data");
  assert.deepEqual(r.q58, ["verified_reference", "12.3", "6.4", "22.9", "ok"]);
});
await step("F · Q12–Q14 colour boundaries, the 363 M gap case, Q17/Q18 peaks not summed, Q38 Cash0 needed", async () => {
  const r = await ev(() => { const R = { rmin: 250e6, rtarget: 500e6, rupper: 1e9 };
    const lv = [400e6, 350e6, 250e6, 249e6, 363e6].map((v) => ENGINE.level(v, R));
    const days = (vals) => ({ days: vals.map((v, i) => ({ d: ENGINE.diso(ENGINE.dnum("2026-10-01") + i), open: 0, in: 0, out: 0, close: v })) });
    const two = days([...Array(7).fill(400), ...Array(7).fill(400), ...Array(77).fill(600)].map((v) => v * 1e6));
    const eps = ENGINE.shortfallEpisodes(two, R, 13), s = ENGINE.scenarioSummary(two, R, 13), open = ENGINE.shortfallEpisodes(days([...Array(85).fill(600e6), ...Array(6).fill(300e6)]), R, 13);
    return { lv, eps: eps.map((e) => [e.start, e.days, Math.round(e.peak_gap / 1e6), e.low_date]), peak: [Math.round(s.peak_buffer / 1e6), s.peak_buffer_date], open: open[0].censored, need: ENGINE.cashNeeded(-116, 200) }; });
  assert.deepEqual(r.lv, ["yellow", "orange", "orange", "red", "orange"]);
  assert.deepEqual(r.eps, [["2026-10-01", 14, 100, "2026-10-01"]]);
  assert.deepEqual(r.peak, [100, "2026-10-01"]); assert.equal(r.open, true);
  assert.deepEqual(r.need, { rtarget: 316, zero: 116 });
});
await step("F · Q41–Q45 two-week blocks: 7 blocks, lowest day decides, boundaries are balanced, display order", async () => {
  const r = await ev(() => { const R = { rmin: 250e6, rtarget: 500e6, rupper: 1e9 }, v = Array(91).fill(700e6);
    v[20] = 300e6; for (let i = 28; i < 42; i++) v[i] = 1.2e9; v[45] = 500e6; v[60] = 1e9; v[86] = 450e6;
    const b = ENGINE.blocks({ days: v.map((x, i) => ({ d: ENGINE.diso(ENGINE.dnum("2026-10-01") + i), close: x })) }, R, 13);
    return { n: b.list.length, last: b.list[6].days, st: b.list.map((x) => x.status + (x.severity ? "/" + x.severity : "")), order: b.display.map((x) => x.k), persist: b.persistent }; });
  assert.equal(r.n, 7); assert.equal(r.last, 7);
  assert.deepEqual(r.st, ["balanced", "shortage/orange", "surplus", "balanced", "balanced", "balanced", "shortage/yellow"]);
  assert.deepEqual(r.order, [2, 7, 3, 1, 4, 5, 6]); assert.equal(r.persist, null);
});
await step("F · Q52–Q55 cash state TH on Base and Q56 the matrix cell", async () => {
  const r = await ev(() => { const R = { rmin: 250e6, rtarget: 500e6, rupper: 1e9 }, mk = (f) => ({ days: Array.from({ length: 91 }, (_, i) => ({ d: ENGINE.diso(ENGINE.dnum("2026-10-01") + i), close: f(i) })) });
    return [ENGINE.cashState(mk((i) => i === 40 ? 500e6 - 1 : 700e6), R, "ok", 13).th, ENGINE.cashState(mk((i) => i >= 10 && i < 23 ? 1.1e9 : 700e6), R, "ok", 13).th,
      ENGINE.cashState(mk((i) => i >= 10 && i < 24 ? 1.1e9 : 700e6), R, "ok", 13), ENGINE.cashState(mk((i) => i === 5 ? 400e6 : i >= 30 && i < 50 ? 1.2e9 : 700e6), R, "ok", 13).th,
      uc02("F01").matrix.cell, uc02("F01").th.th]; });
  assert.equal(r[0], "TH01"); assert.equal(r[1], "TH02"); assert.equal(r[2].th, "TH03"); assert.equal(r[2].reference, true); assert.equal(r[3], "TH01");
  assert.equal(r[4], "M4"); assert.equal(r[5], "TH01");   // workbook v9: W1 × TH01
});

// UC01 ↔ UC02 links and gap_request (phase G).
await step("G · L1 on both sides (two-sided squeeze, supported from the customer's own history); T38 BN0 + TH01 → M1, L3, request allowed", async () => {
  const r = await ev(() => { const A = ENGINE.dnum("2026-09-30"), d = (x) => ENGINE.diso(A + x);
    const hist = Array.from({ length: 6 }, (_, i) => ({ id: "H" + i, customer: "Slow Co", amount: 50e6, issue: d(-170 + i * 20 - 30), due: d(-170 + i * 20), paid: d(-170 + i * 20 + 60) }));
    const input = TMK({ fin: [{ period_start: "2026-07-03", period_end: "2026-09-30", revenue: 30e9, cogs: 24e9, opening_cash: 300e6, current_assets: 20e9 }],
      // Workbook v9: object findings count once the item is a pocket, so DSO is above its threshold (59.7 days) and DPO is low
      // with a thin buffer (12.2 days, R-AP-1); the overdue bill lands on as_of + 5 + 1 inside the episode.
      sales: [...hist, { id: "LATE", customer: "Slow Co", amount: 900e6, issue: d(-55), due: d(-25), paid: null }, { id: "N1", customer: "Main", amount: 19e9, issue: d(-5), due: d(60), paid: null }],
      purchases: [{ id: "PO", supplier: "Late Mill", amount: 250e6, issue: d(-70), due: d(-40), paid: null }, { id: "P1", supplier: "Mill", amount: 3e9, issue: d(-5), due: d(70), paid: null }],
      inventory: [{ name: "Fabric", type: "NVL", qty: 1, unit_cost: 15e9, days: 10, owner: "own" }], planned: [{ id: "PAY", date: d(3), direction: "OUT", category: "payroll", amount: 300e6, certainty: "confirmed" }] });
    const s = ENGINE.makeSnapshot(input, { periodStart: "2026-07-03" }), w = ENGINE.diagnose(s), run = ENGINE.runUC02(s, {}, { uc01: w });
    const cf = ENGINE.contributingFactors(run, w, run.episodes[0], "base");
    // T38: no item above its threshold, a payroll pushes Base below Rtarget.
    const bn0 = TMK({ sales: [{ id: "S", customer: "K", amount: 40 * 30e9 / 90, issue: d(-10), due: d(20), paid: null }], purchases: [{ id: "P", supplier: "S", amount: 30 * 24e9 / 90, issue: d(-5), due: d(25), paid: null }],
      inventory: [{ name: "Fabric", type: "NVL", qty: 1, unit_cost: 70 * 24e9 / 90, days: 10, owner: "own" }], planned: [{ id: "PAY", date: d(2), direction: "OUT", category: "payroll", amount: 900e6 }] });
    const s0 = ENGINE.makeSnapshot(bn0, { periodStart: "2026-07-03" }), w0 = ENGINE.diagnose(s0), r0 = ENGINE.runUC02(s0, {}, { uc01: w0 }), gr0 = ENGINE.buildGapRequest(r0, w0, {});
    return { rules: w.rule_ids, links: cf.links.map((l) => [l.type, l.item, l.evidence]), squeeze: cf.squeeze, type: cf.link_type,
      t38: [w0.bn_pattern, r0.th.th, r0.matrix.cell, ENGINE.gapRequestCheck(r0, w0, "fresh").ok, gr0.link_type, gr0.finding_ids.length, Object.isFrozen(gr0)] }; });
  assert.ok(r.rules.includes("R-AR-OD") && r.rules.includes("R-AP-OD"));
  assert.deepEqual(r.links.filter((l) => l[0] === "L1"), [["L1", "AR", "supported"], ["L1", "AP", "candidate"]]);
  assert.equal(r.squeeze, true); assert.equal(r.type, "L1");
  assert.deepEqual(r.t38, ["BN0", "TH01", "M1", true, "L3", 0, true]);
});
await step("G · gap_request of F01 (need date, peak, Cash0 needed, M4, L2) is immutable; UC02.7 refusals", async () => {
  const r = await ev(() => { const u = uc02("F01"), d = uc01("F01"), gr = ENGINE.buildGapRequest(u, d, {}); let changed = true; try { gr.peak_gap = 1; changed = gr.peak_gap === 1 } catch (e) { changed = false }
    const unknownW = { ...d, wc_class: "unknown" };
    return { gr: [gr.need_date, gr.peak_gap, gr.peak_date, gr.cash0_need, gr.matrix_case_id, gr.link_type, gr.evidence_level, gr.bn_pattern, gr.obligation_overdue, gr.scenario, gr.cash0_status], changed,
      th03: ENGINE.gapRequestCheck(uc02("X02"), uc01("X02"), "fresh"), w: ENGINE.gapRequestCheck(u, unknownW, "fresh").reason, exp: ENGINE.gapRequestCheck(u, d, "expired").reason,
      miss: ENGINE.gapRequestCheck({ ...u, status: "missing_data" }, d, "fresh").reason }; });
  // Workbook v9 F01_UC2/UC03: need date 30/06, peak 3,563,626,768 on 18/09, Cash0 needed 4,763,626,768, W1 × TH01 → M4, BN4, E_AP 400,396,507.
  assert.deepEqual(r.gr, ["2026-06-30", 3563626768, "2026-09-18", 4763626768, "M4", "L2", "candidate", "BN4", 400396507, "base", "provisional"]);
  assert.equal(r.changed, false);
  assert.deepEqual(r.th03, { ok: false, reason: "th03", label: "idle_cash" }); assert.equal(r.w, "w_unknown"); assert.equal(r.exp, "expired"); assert.equal(r.miss, "status");
});

// Feedback loop and answer controls (phase H).
await step("H · Q59–Q67 reconciliation by invoice_id, FB-2/3/4/6 and model_health", async () => {
  const r = await ev(() => { const A = ENGINE.dnum("2026-09-30"), d = (x) => ENGINE.diso(A + x);
    const sales = [{ id: "A", customer: "K1", amount: 400, issue: d(-20), due: d(10), paid: null }, { id: "B", customer: "K2", amount: 600, issue: d(-20), due: d(12), paid: null },
      { id: "C", customer: "K3", amount: 300, issue: d(-20), due: d(15), paid: null }];
    const s0 = ENGINE.makeSnapshot(TMK({ sales }), { periodStart: "2026-07-03" }), run = ENGINE.runUC02(s0, {}, {}), log = ENGINE.forecastLog(run);
    const exp = Object.fromEntries(log.receipts.map((x) => [x.invoice_id, x.date]));
    const later = TMK({ sales: [{ ...sales[0], paid: exp.A }, { ...sales[1], paid: ENGINE.diso(ENGINE.dnum(exp.B) + 5) }, { ...sales[2], paid: d(20), paid_amount: 100 }] });
    later.as_of = "2026-10-31"; later.snapshot_id = "SNP-T-2";
    const s1 = ENGINE.makeSnapshot(later), rec = ENGINE.reconcile(log, s1);
    const H = (list) => ENGINE.modelHealth(list), R = (o) => ({ matched: 25, fb2: 0.1, fb3: 0, fb6: { missed: false }, fb4: { median: 3 }, ...o });
    return { rec: [rec.status, rec.matched, rec.excluded, Math.round(rec.fb3 * 1000) / 1000, rec.fb4.median, rec.fb1, rec.fb5], frozen: Object.isFrozen(log),
      health: [H([]), H([R({ fb3: -0.12 })]), H([R({ fb3: -0.12 }), R({ fb3: -0.12 })]), H([R({ fb3: -0.25 }), R({ fb3: -0.25 })]), H([R({ fb6: { missed: true } })]), H([R({ matched: 12, fb3: -0.5 })])],
      prop: ENGINE.calibrationProposal([R({ fb3: -0.12 }), R({ fb3: -0.12 })], "watch") }; });
  assert.deepEqual(r.rec, ["ok", 2, 1, 0, 2.5, null, null]);      // C partly paid → excluded; A on time, B five days late; run-off → no FB-1 / FB-5
  assert.equal(r.frozen, true);
  assert.deepEqual(r.health, ["insufficient_sample", "ok", "watch", "degraded", "degraded", "insufficient_sample"]);
  assert.deepEqual(r.prop, { default_late: 3, applied: false });
});
await step("H · verifyAnswer: registered numbers and names pass; an unregistered number, a banned phrase or another company's name falls back", async () => {
  const r = await ev(() => { const a = NARR.uc01Answer(uc01("F01"), "Alpha Garment Subcontractor"), ok = NARR.verifyAnswer(a, { foreign: ["Garment Factory KH5"] });
    const bad = { ...a, html: a.html + "<p>It will certainly recover 999,9M by Garment Factory KH5.</p>" }, v = NARR.verifyAnswer(bad, { foreign: ["Garment Factory KH5"] }), fin = NARR.finalize(bad, { foreign: ["Garment Factory KH5"] });
    const bn0 = NARR.uc01Answer({ ...uc01("X03"), bn_pattern: "BN0", wc_class: "W0", cause_items: [], findings: [] }, "Gamma"), vb = NARR.verifyAnswer(bn0);
    return { ok: ok.ok, issues: v.issues.map((x) => x.split(":")[0]).sort(), fb: fin.fallback, bn0: vb.ok && !/no (cash|money) problem/i.test(NARR.plain(bn0.html)) }; });
  assert.equal(r.ok, true); assert.deepEqual(r.issues, ["banned", "entity", "number"]); assert.equal(r.fb, true); assert.equal(r.bn0, true);
});

// Workbook v9 reconciliation: the shipped F01 against the Excel results of F01_UC1, F01_UC2, F01_UC03, F01_UC4 and Kiem_thu.
await step("V9 · UC01–UC04 of F01 match the workbook v9 results", async () => {
  const r = await ev(() => { const d = uc01("F01"), u = uc02("F01"), m3 = uc03("F01"), g = m3.rounds[0], b = u.summary.base, R = Math.round;
    const u4 = ENGINE.simulateUC04(DATA.snaps.F01, u, d, uc04Setup(SC.find((x) => x.id === "F01-C").lev, "F01"));
    return { uc01: [R(d.metrics.AR), R(d.metrics.INV), R(d.metrics.AP), d.metrics.dso.toFixed(4), d.metrics.dio.toFixed(4), d.metrics.dpo.toFixed(4), d.metrics.ccc.toFixed(4), R(d.metrics.ca),
        d.materiality_share.toFixed(6), d.wc_class, d.bn_pattern, d.item_states.map((i) => R(i.E)), R(d.money_at_risk)],
      uc02: [DATA.snaps.F01.N, DATA.snaps.F01.snapshot_id, R(u.fc.cash0 ?? DATA.snaps.F01.fin.opening_cash), R(b.min), b.min_date, R(b.peak_buffer), R(b.need_rtarget), b.first_below_rtarget, b.first_negative,
        u.episodes.map((e) => [R(e.low), R(e.peak_gap)]), u.th.th, u.matrix.cell, u.overall, R(Math.min(...u.fc.scenarios.continuing_sales.days.map((x) => x.close)))],
      uc03: [m3.n, m3.shape, m3.review_manual, g.need_date, g.days_left, R(g.G), g.duration, g.scenario, R(g.best_c), g.ranked.join(" > "), g.package.map((p) => p.id).join(" + "), Math.round(g.cost * 100) / 100,
        g.cost_per_gap, g.not_covering, g.eligible_count, m3.requires_human_decision],
      uc04: [R(u4.after.min), u4.before.gap_days, u4.after.gap_days, u4.before.negative_days, u4.after.negative_days, R(u4.gap_reduction),
        ...["discount", "extension_fee", "sale_cash", "book_shortfall", "cash", "economic"].map((k) => Math.round(u4.costs[k] * 100) / 100), u4.conclusion, u4.th_after, u4.matrix_after] }; });
  assert.deepEqual(r.uc01, [6885245902, 1573770492, 1311475410, "39.2459", "11.2131", "9.3443", "41.1148", 12459016394, "0.048114", "W1", "BN4", [599455226, 244802452, 400396507], 844257678]);
  assert.deepEqual(r.uc02, [171, "F01-20260620-SYN171-v1", 1200000000, -3063626768, "2026-09-18", 3563626768, 4763626768, "2026-06-30", "2026-07-31",
    [[797304, 499202696], [470478434, 29521566], [-522821317, 1022821317], [-3063626768, 3563626768]], "TH01", "M4", "red", -4725732031]);
  assert.deepEqual(r.uc03, [4, "unclassifiable", true, "2026-06-30", 10, 3563626768, 82, "B2", 3057605692,
    "NB-01 > RF-001 > FAC-001 > FAC-002 > EX-01 > AR-01 > INV-001 > CL-001 > CL-002 > INV-002", "NB-01 + RF-001", 14310286.55, 0.004, 1, 10, true]);
  assert.deepEqual(r.uc04, [-3063518221, 54, 50, 34, 26, 108547, 19116602.58, 698931.29, 406613.9, 5082673.69, 20222147.77, 25304821.46, "partial_improvement", "TH01", "M4"]);
});

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL0);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: t})); localStorage.setItem("lilact.expert.v1", "1"); }, theme);
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
    assert.equal(await page.locator("#demoChips").isVisible(), true, "an empty chat shows the suggested questions by the composer");
    assert.equal(await page.locator(".messages.on .suggest").count(), 0);
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
    assert.match(t, /diagnose_working_capital/); assert.match(t, /41[.,]1/);
    assert.equal(await last().locator(".ans5 > p").count(), 5); assert.match(t, /1\. Overall conclusion\..*5\. What to check and the limits\./s); assert.match(t, /Tools used: diagnose_working_capital/);
  });
  await step(`[${theme}] Task 2 explains every gap; suggestions sit only under the latest answer`, async () => {
    await ask("Why am I short of cash? Show me the contributing factors.");
    const acc = last().locator(".gap-acc");
    assert.equal(await acc.count(), 4, "one contributing-factors card per gap");
    assert.equal(await last().locator(".ans4 > p").count(), 4); assert.match(await last().innerText(), /Tools used: forecast_cash/); assert.match(await last().innerText(), /forecast_cash/);
    assert.deepEqual(await acc.evaluateAll((els) => els.filter((e) => e.open).map((e) => e.dataset.gap)), ["4"], "largest gap open");
    assert.equal(await page.locator("#demoChips").isVisible(), false, "no chips by the composer after the first message");
    assert.equal(await page.locator(".messages.on .suggest").count(), 1, "one suggestion row in the whole chat");
    const chips = await last().locator(".suggest button").allInnerTexts();
    assert.ok(chips.length > 0 && chips.length <= 4, `chips: ${chips}`);
    assert.equal(new Set(chips.map((c) => c.toLowerCase())).size, chips.length, "no duplicate suggestions");
    assert.ok(!chips.includes("Why am I short of cash? Show me the contributing factors."), "the question just asked is not suggested again");
  });
  await step(`[${theme}] Open on the UC02 answer shows only Shortfall, on the gap clicked`, async () => {
    const btn = last().locator("[data-gap-open]").last();
    const k = Number(await btn.getAttribute("data-gap-open"));
    await btn.evaluate((el) => el.click()); await page.waitForTimeout(800);
    assert.equal(await page.locator("#detailTitle").innerText(), "Shortfall");
    assert.equal(await page.evaluate(() => EP.k), k, "the clicked gap is selected");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".detail-pane")].filter((p) => !p.hidden || p.innerHTML.trim()).map((p) => p.id)), ["pane-gap"]);
    assert.equal(await page.locator('#panelWrap [role="tab"], #panelWrap .tab, #panelWrap [data-tab]').count(), 0, "no way to switch views inside the panel");
    await page.click("#panelClose");
  });
  await step(`[${theme}] Task 3 ranks financing for the whole shortfall (workbook v9 UC03)`, async () => {
    await ask("Rank the financing options that fit these factors.");
    const card = last().locator(".liq.rank-all.uc03");
    assert.equal(await card.count(), 1);
    assert.deepEqual(await card.locator("tbody tr[data-prod]").evaluateAll((els) => els.map((e) => e.dataset.prod)),
      ["NB-01", "RF-001", "FAC-001", "FAC-002", "EX-01", "AR-01", "INV-001", "CL-001", "CL-002", "INV-002"]);
    assert.match(await card.innerText(), /Proposed package: NB-01 .* \+ RF-001 /);
    assert.match(await card.innerText(), /scenario B2/);
    assert.match(await last().innerText(), /match_financing/);
    assert.doesNotMatch(await page.locator(".messages.on").innerText(), /forecast_liquidity|rank_financing|explain_liquidity_case|get_receivables/);
    assert.equal(await page.locator("#demoChips").isVisible(), false);
    assert.equal(await page.locator(".messages.on .suggest").count(), 1); assert.equal(await last().locator(".suggest").count(), 1);
  });
  await step(`[${theme}] Task 4 what-if creates drafts pending approval`, async () => {
    await ask("Explain gap 3");
    // Main demo (workbook v9 UC04 case 1): K1 early 7 days, Beta 14 days later, half of last season's finished goods sold.
    await ask("What if K1 pays half of its invoices 7 days early, Beta lets us pay half 14 days later and we sell half of last season's finished goods?");
    const t4 = await last().innerText();
    assert.match(t4, /simulate_scenario/); assert.match(t4, /days below the safe level 54 → 50; days below zero 34 → 26/); assert.match(t4, /Partial improvement/);
    assert.match(t4, /Cash cost 20,2M \(early-payment discount 19,1M, extension fee 0,7M, sale cost 0,4M\)/);
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
  await step(`[${theme}] each detail view renders alone, with its own title and no tabs`, async () => {
    const titles = { dash: "Dashboard", gap: "Shortfall", whatif: "What-if", appr: "Approvals" };
    for (const t of ["dash", "gap", "whatif", "appr"]) {
      await page.evaluate((v) => openDetail(v), t); await page.waitForTimeout(500);
      assert.equal(await page.locator("#detailTitle").innerText(), titles[t]);
      assert.ok((await page.locator(`#pane-${t}`).innerText()).length > 40, t);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".detail-pane")].filter((p) => !p.hidden || p.innerHTML.trim()).map((p) => p.id)), [`pane-${t}`]);
    }
    assert.equal(await page.locator('#panelWrap [role="tab"], #panelWrap .tab, #tabs').count(), 0);
    await page.keyboard.press("2"); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => S.detail), "appr", "number keys no longer switch views");
    await page.click("#panelClose"); assert.equal(await page.evaluate(() => S.panel), false);
    await page.click("#panelBtn"); await page.waitForTimeout(300);
    assert.equal(await page.locator("#detailTitle").innerText(), "Approvals", "the header button reopens the last detail view");
  });
  await step(`[${theme}] dashboard has no forecast; Shortfall holds forecast, daily chart, gaps and ranking`, async () => {
    await page.evaluate(() => openDetail("dash")); await page.waitForTimeout(500);
    assert.equal(await page.locator('#pane-dash :is([data-wid="flow"], [data-wid="daily"], .fch, #gapChart, #dashChart)').count(), 0);
    assert.doesNotMatch(await page.locator("#pane-dash").innerText(), /13-week cash forecast/);
    assert.match(await page.locator("#pane-dash .lstate .lv-pill").innerText(), /Highest alert: Red/);
    await page.evaluate(() => openDetail("gap")); await page.waitForTimeout(700);
    const h2 = await page.locator("#pane-gap .dsec h2").allInnerTexts();
    assert.deepEqual(h2.slice(0, 3), ["13-week cash forecast", "Daily cash balance", "Cash gaps"]);
    assert.match(h2[3], /^Funding plan for the shortfall/);
    const cards = page.locator("#pane-gap .ep");
    assert.equal(await cards.count(), 4);
    assert.deepEqual(await cards.evaluateAll((els) => els.map((e) => e.dataset.lv)), ["red", "yellow", "red", "red"]);
    assert.match((await cards.allInnerTexts())[1], /Yellow alert/);
    assert.doesNotMatch(await page.locator("#pane-gap").innerText(), /Target gap|No TV3 result/);
    assert.equal(await page.locator("#pane-gap #gapChart .gapband").count(), 4);
    await page.click('#pane-gap .ep[data-ep="3"]'); await page.waitForTimeout(600);
    assert.deepEqual(await page.locator("#pane-gap .ft thead th.gapwk").evaluateAll((els) => els.map((e) => e.dataset.w)), ["6", "7", "8"]);
    assert.equal(await page.locator("#pane-gap table:not(.ft) tbody tr td:nth-child(2) b").first().innerText(), "NB-01");
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
  await step(`[${theme}] legacy companies without a shortfall (fixture X02/X03) render without errors`, async () => {
    await loadLegacy(page);
    for (const fm of ["X02", "X03"]) {
      await page.evaluate((f) => { switchContext(f, "base", { silent: true }); advance(3); openDetail("dash"); }, fm); await page.waitForTimeout(500);
      assert.match(await page.locator("#pane-dash .lv-pill").innerText(), /Blue/);
      await page.evaluate(() => openDetail("gap")); await page.waitForTimeout(500);
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
    assert.equal(await page.locator("#demoChips").isVisible(), true, "New chat brings the chips back by the composer");
    assert.equal(await page.locator(".messages.on .suggest").count(), 0);
  });
  await step(`[${theme}] a chat reopened from history has its suggestions under the last answer`, async () => {
    await page.locator(".chat-row .chat-open").nth(1).click(); await page.waitForTimeout(600);
    assert.equal(await page.locator("#demoChips").isVisible(), false);
    assert.equal(await page.locator(".messages.on .suggest").count(), 1);
    assert.equal(await page.evaluate(() => { const b = [...document.querySelectorAll(".messages.on .msg.bot")].pop(); return !!b.querySelector(".suggest") && !b.querySelector(".suggest button:disabled"); }), true);
    await page.click("#newChat"); await page.waitForTimeout(500);
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

// UC01 dashboard (phase D): order of Table 3-1, data source, evidence, expert mode, cut-off picker, threshold policy, BN0 display.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL0);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: "light"})); localStorage.setItem("lilact.expert.v1", "1"); });
  await page.reload(); await page.waitForSelector("#authRoot:not([hidden])"); await page.click("#btnDemo"); await page.waitForSelector("#app:not([hidden])");
  const dash = async () => { await page.evaluate(() => { openDetail("dash"); setWide(true); }); await page.waitForTimeout(700); };
  await step("D · dashboard order, data source line and gauge scales follow Table 3-1", async () => {
    await dash();
    const r = await page.evaluate(() => { const p = document.querySelector("#pane-dash"), kids = [...p.children].map((e) => e.className.split(" ")[0]);
      return { order: kids, secs: [...p.querySelectorAll(".dsec h2")].map((h) => h.textContent), w: p.querySelector(".wcard .ls-w").textContent,
        src: p.querySelector(".uc-src").textContent, chip: document.querySelector(".chipdate b").textContent, gaugeMax: [...p.querySelectorAll(".gcard")].map((g) => g.querySelectorAll(".gl")[1].textContent) }; });
    assert.deepEqual(r.secs.slice(0, 3), ["Working-capital diagnosis", "Receivables, Inventory and Payables", "Cash conversion cycle"]);
    assert.ok(r.order.indexOf("uc-src") < r.order.indexOf("dsec"));
    assert.equal(r.w, "W1 – Watch");
    assert.match(r.src, /sample:F01 · snapshot F01-20260620-SYN171-v1 · as of 20 Jun 2026 · period 1 Jan 2026–20 Jun 2026 \(171 days\)/); assert.match(r.src, /fresh/);
    assert.equal(r.chip, "20 Jun 2026");
    assert.ok(r.gaugeMax.length === 4 && !r.gaugeMax.includes("90"), "gauge scales follow the thresholds: " + r.gaugeMax.join(","));
  });
  await step("D · item cards are stacked; Details opens a six-column table under its own card; no 'Who holds the money' section", async () => {
    const boxes = await page.evaluate(() => [...document.querySelectorAll("#pane-dash .icards > .iblock > .icard")].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.wid, Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }));
    assert.deepEqual(boxes.map((b) => b[0]), ["ar", "inv", "ap"]);
    assert.ok(boxes[0][1] === boxes[1][1] && boxes[1][1] === boxes[2][1] && boxes[0][2] < boxes[1][2] && boxes[1][2] < boxes[2][2], "one card under the other: " + JSON.stringify(boxes));
    assert.ok(boxes.every((b) => b[3] === boxes[0][3]), "same full width");
    assert.doesNotMatch(await page.locator("#pane-dash").innerText(), /Who holds the money/);
    assert.equal(await page.locator('#pane-dash [data-wid="tables"]').count(), 0);
    const btn = page.locator('#pane-dash [data-det="AR"]');
    assert.equal(await btn.getAttribute("aria-expanded"), "false"); assert.equal(await btn.getAttribute("aria-controls"), "icd-ar");
    assert.equal(await page.locator("#icd-ar").isVisible(), false);
    await btn.click(); await page.waitForTimeout(200);
    assert.equal(await btn.getAttribute("aria-expanded"), "true");
    assert.equal(await page.evaluate(() => document.querySelector("#icd-ar").previousElementSibling.dataset.wid), "ar", "the table sits right under the Receivables card");
    assert.deepEqual(await page.locator("#icd-ar thead th").evaluateAll((els) => els.map((e) => e.textContent.replace(/[▲▼]/g, "").trim())), ["Name", "Amount", "Share", "Overdue", "Longest Overdue (Days)", "Priority"]);
    assert.equal(await page.locator("#icd-ar tbody tr").count(), 9);
    await page.click('#pane-dash [data-det="INV"]'); await page.waitForTimeout(200);
    assert.deepEqual(await page.locator("#icd-inv thead th").count(), 6);
    assert.deepEqual(await page.locator("#icd-inv tbody tr").first().locator("td").evaluateAll((els) => els.slice(3, 5).map((e) => e.textContent)), ["—", "—"], "lots have no due date");
    assert.equal(await page.locator("#icd-ar").isVisible(), true, "opening Inventory keeps Receivables open");
    await page.click('#pane-dash [data-det="INV"]'); await page.waitForTimeout(200);
    assert.equal(await page.locator("#icd-inv").isVisible(), false); assert.equal(await page.locator("#icd-ar").isVisible(), true);
  });
  await step("D · expert mode shows rule ids, versions and raw VND; tables sort and switch order", async () => {
    const t = await page.locator("#pane-dash .wcard .expert").innerText();
    assert.match(t, /R-AR-1, R-AR-OD, R-INV-1, R-INV-SLOW, R-AP-OD/); assert.match(t, /tv1\.threshold\.v2/);
    assert.match(await page.locator("#pane-dash .mtile.hl").innerText(), /\d{1,3}(\.\d{3})+ VND/);
    await page.click("#ucExpert"); await page.waitForTimeout(300);                 // off: the simple view hides rule ids and raw VND
    assert.equal(await page.locator("#pane-dash .wcard .expert").count(), 0);
    assert.doesNotMatch(await page.locator("#pane-dash").innerText(), /R-AR-1|tv1\.threshold|money_at_risk|\d{1,3}(\.\d{3}){2,} VND/);
    await page.click("#ucExpert"); await page.waitForTimeout(300);                 // back on (remembered)
    assert.equal(await page.evaluate(() => localStorage.getItem("lilact.expert.v1")), "1");
    const exposure = await page.locator("#icd-ar .t-cust tbody tr td:first-child > b").allInnerTexts();
    assert.equal(exposure[0], "Large Exporter K1");
    await page.click('[data-corder="intervention"]'); await page.waitForTimeout(200);
    const tiers = await page.locator("#icd-ar .t-cust tbody tr td:first-child small b").allInnerTexts();   // Expert: tier under the name
    assert.deepEqual(tiers, ["1", "2", "2", "2", "2", "2", "3", "3", "5"]);
  });
  await step("D · evidence panel lists the invoices; an empty filter says no records match", async () => {
    await page.click('#pane-dash .t-cust tr[data-ev*="large exporter k1"]'); await page.waitForTimeout(300);
    assert.match(await page.locator("#modal h3").innerText(), /Evidence · Large Exporter K1/);
    assert.equal(await page.locator("#modal .ev-body tbody tr").count(), 31);
    await page.selectOption("#evFilter", "overdue"); await page.waitForTimeout(150);
    assert.equal(await page.locator("#modal .ev-body tbody tr").count(), 5);
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    await page.click('#pane-dash .t-cust tr[data-ev*="exporter k2"]'); await page.waitForTimeout(300);
    await page.selectOption("#evFilter", "overdue"); await page.waitForTimeout(150);
    assert.match(await page.locator("#modal .ev-body").innerText(), /No records match the condition \(Overdue\)/);
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  });
  await step("D · an earlier cut-off re-runs UC01 only; the matrix cell is not routed across snapshots", async () => {
    await page.fill("#ucAsOf", "2026-05-31"); await page.dispatchEvent("#ucAsOf", "change"); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ src: document.querySelector("#pane-dash .uc-src").textContent, chips: document.querySelector("#pane-dash .lstate .ls-chips").textContent, n: uc01().N }));
    assert.match(r.src, /as of 31 May 2026 · period 30 Nov 2025–31 May 2026 \(183 days\)/); assert.match(r.chips, /Not routed · W and TH use different snapshots/);
    await page.click("#ucReset"); await page.waitForTimeout(400);
    assert.match(await page.locator("#pane-dash .lstate .ls-chips").innerText(), /Cell M4/);
  });
  await step("D · threshold policy needs a reason, previews the impact and creates a new configuration version", async () => {
    await page.click("#ucPolicy"); await page.waitForTimeout(300);
    await page.selectOption("#polModel", "FOB"); await page.waitForTimeout(150);
    assert.match(await page.locator("#polPreview").innerText(), /W1 · BN4 → W1 · BN3/);   // FOB: DSO/DIO under the watch levels, DPO 9,3 < 13,2 with a thin buffer
    await page.click("#polSave"); assert.match(await page.locator("#polErr").innerText(), /10 to 500 characters/);
    await page.fill("#polReason", "Board decision: the company works on FOB terms"); await page.click("#polSave"); await page.waitForTimeout(500);
    const r = await page.evaluate(() => [uc01().wc_class, uc01().bn_pattern, uc01().policy_version, document.querySelector("#pane-dash .wcard .ls-w").textContent]);
    assert.deepEqual(r, ["W1", "BN3", "CFG-F01-v1", "W1 – Watch"]);
    // Settings › Account sets the model back to CMT (another configuration version).
    await page.evaluate(() => { openSettings("Account"); }); await page.waitForTimeout(300);
    await page.selectOption("#bizModel", "CMT"); await page.waitForTimeout(300); await page.keyboard.press("Escape");
    assert.deepEqual(await page.evaluate(() => [uc01().wc_class, uc01().bn_pattern, uc01().policy_version]), ["W1", "BN4", "CFG-F01-v2"]);
  });
  await step("D · BN0 company: no capital card, headroom on the items, tables without warning colours, evidence pages", async () => {
    await page.evaluate(() => {
      const d = (x) => ENGINE.diso(ENGINE.dnum("2026-09-30") + x), many = Array.from({ length: 260 }, (_, i) => ({ id: "B" + i, customer: "Busy Buyer", amount: 40 * 30e9 / 90 / 260, issue: d(-10), due: d(20), paid: null }));
      registerCases("X99", { firm: { id: "X99", name: "BN0 Test Co", business_model: "FOB", rtarget: 100e6, essential_suppliers: [] }, snapshot_id: "SNP-X99-1", as_of: "2026-09-30",
        source: { type: "upload", id: "upload:bn0.csv", at: new Date().toISOString() }, fin: [{ period_start: d(-89), period_end: "2026-09-30", revenue: 30e9, cogs: 24e9, opening_cash: 1e9, current_assets: 20e9 }],
        config: { amount_basis: "net", vat_rate: null }, tables: { sales: true, purchases: true, inventory: true, planned: true }, sales: many,
        purchases: [{ id: "P", supplier: "Mill", amount: 30 * 24e9 / 90, issue: d(-5), due: d(25), paid: null }],
        inventory: [{ name: "Fabric", type: "NVL", qty: 1, unit_cost: 70 * 24e9 / 90, days: 10, owner: "own" }], planned: [] });
      FIRMS.X99 = { name: "BN0 Test Co", short: "BN0 Test" }; switchContext("X99", "base", { silent: true }); openDetail("dash"); setWide(true);
    });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const p = document.querySelector("#pane-dash"); return { w: p.querySelector(".wcard .ls-w").textContent, bn0: !!p.querySelector(".mtile.bn0"), mar: !!p.querySelector(".mtile.hl"),
      head: p.querySelector(".icard").textContent, flags: p.querySelectorAll(".dtable tr.flag, .dtable .status.red, .dtable .status.amber").length }; });
    assert.equal(r.w, "W0 – No signs yet"); assert.ok(r.bn0 && !r.mar); assert.match(r.head, /16,7 days to the watch threshold/); assert.equal(r.flags, 0);
    await page.click("#pane-dash .t-cust tr[data-ev]"); await page.waitForTimeout(300);
    assert.equal(await page.locator("#modal .ev-body tbody tr").count(), 50);
    assert.match(await page.locator("#modal .ev-body").innerText(), /Page 1 of 4/); assert.match(await page.locator("#modal .ev-body").innerText(), /Showing 200 of 260 records/);
    await page.keyboard.press("Escape");
  });

  await step("F · Shortfall header: run status, scenario and horizon selectors, Cash0 form with validation and a new configuration version", async () => {
    await page.evaluate(() => { switchContext("F01", "base", { silent: true }); advance(3); openDetail("gap"); setWide(true); }); await page.waitForTimeout(700);
    assert.match(await page.locator("#pane-gap .uc2-bar").innerText(), /Run status: provisional/);
    assert.match(await page.locator("#pane-gap .c0b").innerText(), /Cash0 is provisional/);
    await page.selectOption("#scSel", "conservative"); await page.waitForTimeout(500);
    assert.match(await page.locator("#pane-gap .uc2-tiles").innerText(), /-3,06B\s+18 Sep 2026 · Conservative/);
    assert.match(await page.locator("#pane-gap .uc2-tiles").innerText(), /TH01 – Cash shortfall/);    // TH stays on Base
    await page.selectOption("#scSel", "base"); await page.waitForTimeout(300);
    await page.selectOption("#wkSel", "4"); await page.waitForTimeout(500);
    assert.equal(await page.locator("#pane-gap .dsec h2").first().innerText(), "4-week cash forecast");
    assert.equal(await page.locator("#pane-gap .ft thead th[data-w]").count(), 4);
    await page.selectOption("#wkSel", "13"); await page.waitForTimeout(400);
    const v0 = await page.evaluate(() => POLICY.get("F01").version || 0);
    await page.click("#cash0Btn"); await page.waitForTimeout(300);
    await page.fill("#c0Total", "2000000000"); await page.fill("#c0Rmin", "600000000"); await page.fill("#c0Rt", "500000000"); await page.fill("#c0Rup", "1000000000");
    await page.click("#c0Save"); assert.match(await page.locator("#c0Err").innerText(), /Rmin must be between 0 and Rtarget/);
    await page.fill("#c0Rmin", "250000000"); await page.click("#c0Save"); assert.match(await page.locator("#c0Err").innerText(), /10 to 500 characters/);
    await page.fill("#c0Reason", "Bank balances confirmed on 20/06/2026"); await page.click("#c0Save"); await page.waitForTimeout(600);
    const r = await page.evaluate(() => { const u = uc02(); return [u.cash0.status, Math.round(u.cash0.value / 1e6), u.config_version, Math.round(u.summary.base.need_rtarget / 1e6), Math.round(u.summary.base.min / 1e6), u.reserves.src.rtarget]; });
    assert.deepEqual(r, ["confirmed", 2000, `CFG-F01-v${v0 + 1}`, 4764, -2264, "owner_policy"]);    // Cash0 needed does not depend on Cash0
    assert.equal(await page.locator("#pane-gap .c0b").count(), 0);
  });

  await step("G · Find financing shows the gap_request summary; the chat ranking uses the confirmed request; wording is 'contributing factors'", async () => {
    await page.evaluate(() => { switchContext("F01", "base", { silent: true }); advance(2); openDetail("gap"); setWide(true); }); await page.waitForTimeout(700);
    assert.match(await page.locator("#pane-gap .cfcard h3").innerText(), /Contributing factors · gap \d/);
    await page.click("#grBtn"); await page.waitForTimeout(300);
    const need = await page.evaluate(() => fd(uc02().summary.base.first_below_rtarget));
    const m = await page.locator("#modal").innerText();
    assert.match(m, /Request to find financing \(gap_request\)/); assert.ok(m.includes(need), need); assert.match(m, /M4/); assert.match(m, /not the amount to raise on the first day/);
    await page.click("#grSend"); await page.waitForTimeout(400);
    const id = await page.evaluate(() => S.gapRequest && S.gapRequest.request_id);
    assert.match(id, /^GR-/);
    await page.evaluate(() => setWide(false));
    await page.fill("#chatInput", "Why am I short of cash? Show me the contributing factors."); await page.click("#sendBtn"); await page.waitForTimeout(3800);
    const cause = await page.locator(".messages.on .msg.bot").last().innerText();
    assert.match(cause, /Contributing factors · gap/); assert.doesNotMatch(cause, /Why gap|main cause/i);
    await page.fill("#chatInput", "Rank the financing options that fit these factors."); await page.click("#sendBtn"); await page.waitForTimeout(3800);
    assert.ok((await page.locator(".messages.on .msg.bot").last().innerText()).includes(`Request ${id}: cash needed from ${need}`));
  });
  await step("G · legacy X02 (Base TH03): the button offers idle-cash options and no request is created", async () => {
    await loadLegacy(page);
    await page.evaluate(() => { switchContext("X02", "base", { silent: true }); advance(2); openDetail("gap"); setWide(true); }); await page.waitForTimeout(700);
    assert.match(await page.locator("#grBtn").innerText(), /View options for idle cash \(phase 2\)/);
    await page.click("#grBtn"); await page.waitForTimeout(300);
    assert.match(await page.locator("#modal").innerText(), /cash surplus \(TH03\)/); assert.equal(await page.locator("#grSend").count(), 0);
    await page.keyboard.press("Escape"); assert.equal(await page.evaluate(() => S.gapRequest), null);
    await page.evaluate(() => switchContext("F01", "base", { silent: true }));
  });
  await step("D · no JavaScript errors on the dashboard", async () => assert.deepEqual(errors, []));
  await page.close();
}


// Simple view (default, Expert mode off): plain results without codes, formulas, ids or raw VND (business-owner view).
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL0);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: "light"})); });
  await page.reload(); await page.waitForSelector("#authRoot:not([hidden])"); await page.click("#btnDemo"); await page.waitForSelector("#app:not([hidden])");
  const TECH = /\b(W[0-2] –|BN\d|TH0\d|M[1-9]|R-AR|R-INV|R-AP|R-MAT|c_i|E_AR|E_INV|E_i|money_at_risk|tv1\.threshold|SNP-|RUN-|SRS|Rtarget|Rmin|Rupper|demo assumption|90-day)\b|[÷×]|\d{1,3}(\.\d{3}){2,} VND/;
  const plain = (x) => x.replace(/Tools used:.*/g, "").replace(/\{[\s\S]*?\}/g, "");
  await step("Simple · dashboard shows plain results; Expert mode is off by default", async () => {
    await page.evaluate(() => { openDetail("dash"); setWide(true); }); await page.waitForTimeout(700);
    assert.equal(await page.isChecked("#ucExpert"), false);
    const txt = await page.locator("#pane-dash").innerText();
    assert.doesNotMatch(txt, TECH);
    assert.match(txt, /Sample data F01 · as of 20 Jun 2026 · updated \d{1,2} [A-Z][a-z]{2} \d{4}/);
    // Workbook v9 data is complete (COGS from the statements, model declared, current assets given), so the data line has no Estimate badge.
    assert.equal(await page.locator("#pane-dash .uc-src .est").count(), 0);
    assert.match(await page.locator("#pane-dash .wcard").innerText(), /Some items are worth watching, but they are not tying up much cash yet[\s\S]*Main issue\s+Receivables[\s\S]*Also watch\s+Owned inventory \(Watch\)/);
    const tiles = await page.locator("#pane-dash .mtiles").innerText();
    // Workbook v9 F01_UC1: money at risk 844,3M, materiality 4,81 % (below 5 %, shown with one decimal), E_AP 400,4M.
    assert.match(tiles, /Cash tied up above normal\s+844,3M\s+receivables \+ inventory/); assert.match(tiles, /Impact\s+4,8%\s+of short-term assets · Moderate/); assert.match(tiles, /Overdue to suppliers\s+400,4M/);
    assert.deepEqual(await page.locator("#pane-dash .icard .ic-h .status").allInnerTexts(), ["Watch", "Watch", "Normal"]);   // from c_i: AR 1, INV 1, AP 0
    assert.match(await page.locator("#pane-dash .icard").first().innerText(), /About 3 days above normal/);
    assert.equal(await page.locator("#pane-dash .tb-lbl").count(), 0, "no numeric threshold labels");
    await page.click('#pane-dash [data-det="AR"]'); await page.waitForTimeout(200);
    assert.deepEqual((await page.locator("#pane-dash .t-cust thead th").allInnerTexts()).map((x) => x.replace(/[▲▼]/g, "").trim().toLowerCase()), ["name", "amount", "share", "overdue", "longest overdue (days)", "priority"]);
    assert.equal(await page.locator("#pane-dash .foot-note").innerText(), "Sample data. Estimates only, not financial advice.");
    assert.doesNotMatch(await page.locator("#pane-dash .gcard .info").first().getAttribute("data-tip"), /[=÷×]/);
  });
  await step("Simple · evidence panel has no rule ids; customer labels and tier appear only in Expert mode", async () => {
    await page.click('#pane-dash .t-cust tr[data-ev*="large exporter k1"]'); await page.waitForTimeout(300);
    assert.doesNotMatch(await page.locator("#modal").innerText(), /R-AR|Tier|RUN-|ρ/); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    await page.click("#ucExpert"); await page.waitForTimeout(300);
    await page.click('#pane-dash .t-cust tr[data-ev*="large exporter k1"]'); await page.waitForTimeout(300);
    assert.match(await page.locator("#modal").innerText(), /Size · relationship · behaviour[\s\S]*Tier/); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  });
  await step("Expert · threshold labels never overlap on the item bars; status pills stay inside their cells", async () => {
    const overlaps = await page.evaluate(() => [...document.querySelectorAll("#pane-dash .tb-lbl")].map((l) => { const r = [...l.children].map((s) => s.getBoundingClientRect());
      return r.some((a, i) => r.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)); }));
    assert.deepEqual(overlaps, [false, false, false]);
    await page.evaluate(() => setWide(false)); await page.waitForTimeout(400);
    const pills = await page.evaluate(() => [...document.querySelectorAll("#pane-dash .t-cust td .status")].map((s) => { const r = s.getBoundingClientRect(), c = s.closest("td").getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1; }));
    assert.ok(pills.length && pills.every(Boolean), "pills stay inside their cell");
    await page.click("#ucExpert"); await page.waitForTimeout(300);
  });
  await step("Simple · Shortfall tab uses plain names and shows only the main Cash0 figure", async () => {
    await page.evaluate(() => { advance(3); openDetail("gap"); setWide(true); }); await page.waitForTimeout(900);
    const txt = await page.locator("#pane-gap").innerText();
    assert.doesNotMatch(txt, TECH); assert.doesNotMatch(txt, /PeakZero|Need\(0\)|to stay ≥ 0/);
    assert.match(txt, /Minimum cash 250,0M · Safe cash level 500,0M · Surplus level 1,00B/);
    assert.equal(await page.locator("#pane-gap .uc2-bar .est").count(), 1);
    assert.ok((await page.locator("#pane-gap .uc2-bar .est").getAttribute("title")).length > 10, "the Estimate badge explains why (Cash0 not confirmed)");
    assert.match(await page.locator("#pane-gap .uc2-tiles").innerText(), /Cash needed at the start\s+4,76B\s+Largest shortfall\s+3,56B/);
    assert.match(await page.locator("#pane-gap .fbcard").innerText(), /Forecast confidence\s+There are not enough past forecasts/);
    assert.equal(await page.locator("#pane-gap .lv-legend").first().evaluate((e) => e.tagName), "P");
  });
  await step("Simple · chat answers use plain words, no rule codes or formulas", async () => {
    await page.evaluate(() => { setWide(false); startNewChat(); }); await page.waitForTimeout(400);
    const ask = async (q) => { await page.fill("#chatInput", q); await page.click("#sendBtn"); await page.waitForTimeout(3600); return page.locator(".messages.on .msg.bot").last().innerText(); };
    const a = await ask("Where is my working capital stuck?");
    assert.match(a, /1\. Overall conclusion\./); assert.match(a, /Receivables, Owned inventory are worth watching, but they are not tying up much cash yet/);
    assert.doesNotMatch(plain(a), TECH);
    const b = await ask("Why am I short of cash? Show me the contributing factors.");
    assert.match(b, /With no new sales and an estimated opening cash, the alert level is Red/);
    assert.doesNotMatch(plain(b), TECH);
  });
  await step("Modals · at a short viewport the Cash0 form scrolls inside, Save stays reachable, the page is locked, Esc restores focus", async () => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.evaluate(() => { setWide(true); openDetail("gap"); }); await page.waitForTimeout(700);
    await page.focus("#cash0Btn"); await page.click("#cash0Btn"); await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const b = document.querySelector("#modal .modal-b"), m = document.querySelector("#modal").getBoundingClientRect();
      return { scrollable: b.scrollHeight > b.clientHeight, overflow: getComputedStyle(b).overflowY, modalFits: m.top >= 0 && m.bottom <= innerHeight, locked: getComputedStyle(document.documentElement).overflow }; });
    assert.ok(r.scrollable, "the form body scrolls"); assert.equal(r.overflow, "auto"); assert.ok(r.modalFits, "the modal fits the viewport"); assert.equal(r.locked, "hidden");
    await page.locator("#c0Save").scrollIntoViewIfNeeded();
    const save = await page.locator("#c0Save").boundingBox();
    assert.ok(save && save.y >= 0 && save.y + save.height <= 420, "Save is inside the viewport");
    await page.locator("#c0Reason").scrollIntoViewIfNeeded();
    const reason = await page.locator("#c0Reason").boundingBox();
    assert.ok(reason && reason.y + reason.height <= 420, "the last field can be scrolled into view");
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
    assert.ok(await page.evaluate(() => document.querySelector("#modal").contains(document.activeElement)), "focus stays inside the modal");
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    assert.equal(await page.locator("#scrim.show").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "cash0Btn");
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "visible");
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step("Simple · no JavaScript errors", async () => assert.deepEqual(errors, []));
  await page.close();
}

// Chat guards, scenario questions, repeat runs and Vietnamese (phase H).
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL0);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: "light"})); localStorage.setItem("lilact.expert.v1", "1"); });
  await page.reload(); await page.waitForSelector("#authRoot:not([hidden])"); await page.click("#btnDemo"); await page.waitForSelector("#app:not([hidden])");
  const ask = async (q) => { await page.fill("#chatInput", q); await page.click("#sendBtn"); await page.waitForTimeout(3800); };
  const last = () => page.locator(".messages.on .msg.bot").last();
  await step("H · T15 threshold and Rtarget changes are refused in the chat; nothing is analysed or changed", async () => {
    const v0 = await page.evaluate(() => POLICY.versionId("F01"));
    await ask("Set the DSO threshold to 100 days");
    let t = await last().innerText();
    assert.match(t, /cannot be changed in the chat; nothing was changed and no analysis was run/); assert.doesNotMatch(t, /diagnose_working_capital/);
    assert.equal(await last().locator(".suggest button", { hasText: "Open threshold policy" }).count(), 1);
    await ask("Change Rtarget to 200 million");
    assert.equal(await last().locator(".suggest button", { hasText: "Open the Cash0 form" }).count(), 1);
    assert.deepEqual(await page.evaluate(() => [POLICY.versionId("F01"), S.stage]), [v0, 0]);
  });
  await step("H · T19 out-of-scope questions state the limit and point to the right step", async () => {
    await ask("When will I run out of cash?");
    let t = await last().innerText(); assert.match(t, /answered by the cash forecast step/); assert.match(t, /W1 – Watch/);
    await ask("Where should I borrow?");
    assert.match(await last().innerText(), /does not choose a lender or a loan/);
  });
  await step("H · T18 a causal claim is not confirmed; the answer describes the numbers as a contributing factor", async () => {
    await ask("Where is my working capital stuck?");
    await ask("K1 is the cause of my cash shortage");
    const t = await last().innerText();
    assert.match(t, /I cannot confirm that Large Exporter K1 alone created the shortfall/); assert.match(t, /one contributing factor/);
    assert.match(t, /3,82B of receivables \(55,5%\), of which 765,7M is overdue/);
  });
  await step("H · scenario, Cash0-needed and tightest-week questions; Q70 the same run is reused (same run_id)", async () => {
    await ask("Why am I short of cash? Show me the contributing factors.");
    const id1 = await last().locator(".toolchip pre").innerText();
    await ask("What happens in the conservative scenario?");
    assert.match(await last().innerText(), /Conservative: lowest balance -3,06B on 18 Sep 2026, Cash0 needed 4,76B, alert level Red\. TH and the matrix cell stay on Base \(TH01 – Cash shortfall\)/);
    await ask("How much Cash0 do I need?");
    assert.match(await last().innerText(), /Cash0 needed to stay at or above Rtarget 500,0M: 4,76B; to stay at or above zero: 4,26B/);
    await ask("Which week is the tightest?");
    assert.match(await last().innerText(), /The tightest week is week 13 \(13 Sep 2026–19 Sep 2026\): lowest balance -3,06B on 18 Sep 2026, alert level Red/);
    await ask("Why am I short of cash? Show me the contributing factors.");
    const id2 = await last().locator(".toolchip pre").innerText();
    const run = (s) => JSON.parse(s).args.run_id;
    assert.match(run(id1), /^RUN-UC02-/); assert.equal(run(id1), run(id2));
    assert.equal(await page.evaluate(() => FEEDBACK.get("F01").logs.length), 1);        // Q68: one forecast log per snapshot and configuration
    assert.equal(await page.evaluate(() => FEEDBACK.health("F01")), "insufficient_sample"); // Q59
  });
  await step("English only: no language setting, <html lang=en>, English units and dates; money of 1 billion or more shows the suffix B", async () => {
    assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
    await page.evaluate(() => { openSettings("General"); }); await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-lang]").count(), 0, "no language selector");
    await page.keyboard.press("Escape");
    assert.deepEqual(await page.evaluate(() => [money(11.85e9), money(619.3e6), nInt(1200000000), fd("2026-09-30"), fd("2026-10-01")]), ["11,85B", "619,3M", "1.200.000.000", "30 Sep 2026", "1 Oct 2026"]);
    // Money of 1 billion VND or more uses the suffix B (two decimals), below that M; never "bn".
    assert.deepEqual(await page.evaluate(() => [money(1e9), money(999.9e6), money(-3063626768), money(12459016394), mm(1e9)]), ["1,00B", "999,9M", "-3,06B", "12,46B", "1.000,0M"]);
    const chat = await page.locator(".messages.on").innerText();
    assert.match(chat, /Cash0 needed to stay at or above Rtarget 500,0M: 4,76B/);
    assert.doesNotMatch(chat, /\d(,\d+)?\s?bn\b/, "no money in bn left in the chat");
    await page.evaluate(() => { openDetail("dash"); }); await page.waitForTimeout(500);
    assert.match(await page.locator("#pane-dash").innerText(), /6,89B/);
    assert.doesNotMatch(await page.locator("#pane-dash").innerText(), /\d(,\d+)?\s?bn\b/);
    await page.click("#panelClose");
    assert.doesNotMatch(await page.locator(".messages.on").innerText(), /[\u00e0-\u00fd\u0103\u0111\u01a1\u01b0\u1ea1-\u1ef9]/i, "no Vietnamese letters in the chat");
  });
  await step("H · no JavaScript errors in the chat checks", async () => assert.deepEqual(errors, []));
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
