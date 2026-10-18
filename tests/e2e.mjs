// Browser smoke test for the Lilact-branded SME Finance Copilot demo (Playwright + Chromium).
// Run: node tests/e2e.mjs   (PW_CHROMIUM=/path/to/chromium to override the browser; SHOTS=dir to save screenshots)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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
async function step(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name + " — " + e.message.split("\n")[0]]); } }
const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); };

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL0);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem("smefc.prefs.v1", JSON.stringify({ theme: t })); }, theme);
  await page.reload();
  const ask = async (q) => { await page.fill("#chatInput", q); await page.click("#sendBtn"); await page.waitForTimeout(3800); };
  const last = () => page.locator(".messages.on .msg.bot").last();

  await step(`[${theme}] sign-in screen uses the Lilact logo and tokens`, async () => {
    assert.equal(await page.locator("#authRoot").isVisible(), true);
    assert.equal(await page.locator(`.auth-brand img.lilact-logo--dark`).isVisible(), true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, theme === "dark" ? "rgb(15, 12, 30)" : "rgb(247, 246, 251)");
    await shot(page, `${theme}-auth`);
  });
  await step(`[${theme}] demo account opens the app with tasks 2–4 locked`, async () => {
    await page.click("#btnDemo");
    await page.waitForSelector("#app:not([hidden])");
    assert.equal(await page.locator(".tnav.locked").count(), 3);
    assert.equal(await page.locator(`.side .lilact-logo--${theme}`).isVisible(), true);
  });
  await step(`[${theme}] Task 1 diagnosis shows DSO/DIO/DPO/CCC`, async () => {
    await ask("Where is my working capital stuck?");
    const t = await last().innerText();
    assert.match(t, /diagnose_working_capital/); assert.match(t, /69\.0/);
  });
  await step(`[${theme}] Task 2 forecast explains the shortfall`, async () => {
    await ask("Why am I short of cash? Show me the cause.");
    assert.match(await page.locator("#taskTitle").innerText(), /Cash-flow forecast/);
  });
  await step(`[${theme}] Task 3 ranks financing options`, async () => {
    await ask("Rank the financing options that fit this cause.");
    assert.match(await page.locator("#taskTitle").innerText(), /Financing match/);
  });
  await step(`[${theme}] Task 4 what-if creates drafts pending approval`, async () => {
    await ask("K1 will only pay 7 days early. What if we combine that with financing invoice S-F01-0070 via RF-001?");
    assert.match(await last().innerText(), /3\.87/);
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
  await step(`[${theme}] dashboard tabs render`, async () => {
    for (const t of ["dash", "gap", "whatif", "log", "data"]) {
      await page.click(`.tab[data-tab=${t}]`); await page.waitForTimeout(500);
      assert.ok((await page.locator(`#pane-${t}`).innerText()).length > 40, t);
    }
  });
  await step(`[${theme}] no JavaScript errors`, async () => assert.deepEqual(errors, []));
  await page.close();
}

await step("mobile 390px: no horizontal scroll, menu opens", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URL0); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click("#btnDemo"); await page.waitForSelector("#app:not([hidden])");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await page.click("#menuBtn"); await page.waitForTimeout(500);
  assert.equal(await page.locator("#side").isVisible(), true);
  await page.close();
});

await browser.close(); server.close();
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
