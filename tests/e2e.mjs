// End-to-end smoke test in a real browser (Playwright + Chromium).
// Run: node tests/e2e.mjs   (uses a global/installed `playwright`; set PW_CHROMIUM=/path/to/chromium to override the browser)
// Optional: SHOTS=dir to save screenshots at desktop / tablet / mobile widths.
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".csv": "text/csv" };
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

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const text = async () => page.locator("#workspace").innerText();
const go = async (v) => { await page.goto(URL0 + "#/" + v); await page.waitForSelector("#workspace > *"); };

await go("uc00");
await page.evaluate(() => localStorage.clear());
await page.reload();

await step("tasks are locked with a reason before UC00 confirmation", async () => {
  await go("uc02");
  assert.match(await text(), /đang khóa/); assert.match(await text(), /Cần xác nhận dữ liệu/);
  assert.equal(await page.locator('#nav a.is-locked').count(), 4);
});
await step("invalid policy shows field errors and does not save", async () => {
  await go("uc00");
  await page.fill("#pol-rmin_vnd", "abc");
  await page.click('#policy-form button[type=submit]');
  assert.equal(await page.locator('[aria-invalid="true"]').count() > 0, true);
  assert.match(await text(), /Chưa lưu chính sách nào/);
});
await step("uploaded CSV with errors is flagged, not saved", async () => {
  await page.setInputFiles("#upload", path.join(ROOT, "data/demo/sample_sales_with_errors.csv"));
  await page.waitForSelector(".la-upload-result");
  const t = await text();
  for (const c of ["DUPLICATE", "AMBIGUOUS_NUMBER", "INVALID_DATE", "OTHER_FIRM"]) assert.ok(t.includes(c), c);
  assert.match(t, /Chưa dùng được/);
});
await step("UC00 confirmation creates bundle AB-F01-001 and unlocks Task 1/2", async () => {
  await page.click('[data-action="policy-defaults"]');
  await page.click('#policy-form button[type=submit]');
  await page.check("#ack");
  await page.click('[data-action="confirm-intake"]');
  await page.waitForURL(/#\/uc01/);
  assert.match(await page.locator("#page-meta").innerText(), /AB-F01-001/);
  assert.match(await text(), /49,99|50,0/);
});
await step("UC02 shows the shortfall, 91 daily rows and routes F01 to M7", async () => {
  await go("uc02");
  const t = await text();
  assert.match(t, /−619 tr ₫/); assert.match(t, /18\/12\/2026/);
  assert.equal(await page.locator(".lc-matrix__cell.is-active b").first().innerText().then((s) => s.trim().slice(0, 2)), "M7");
  assert.match(t, /Gắn nhãn "đã giải quyết" khi còn phần chưa bù/);
  assert.equal(await page.locator('#daily tbody tr').count(), 91);
  await page.locator('#daily summary').click();
  await page.locator('[data-evidence="day:2026-10-23"]').click();
  assert.match(await page.locator("#drawer").innerText(), /Thu chi ngày 23\/10\/2026/);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#drawer").isHidden(), true);
});
await step("6-month horizon is visibly unavailable with a reason", async () => {
  assert.equal(await page.locator('button:has-text("6 tháng")').isDisabled(), true);
  assert.match(await text(), /6 tháng chưa mở/);
});
await step("UC03 lists ranked candidates and rejection reasons", async () => {
  await go("uc03");
  const t = await text();
  assert.match(t, /Không phải quyết định tín dụng/); assert.match(t, /O-LOAN-NEW/); assert.match(t, /Tài sản đã cầm cố/);
  assert.equal(await page.locator('[data-nav="uc04"]').isDisabled(), true);
  await page.check('input[value="LOAN-NEW"]');
  assert.equal(await page.locator('[data-nav="uc04"]').isDisabled(), false);
});
await step("UC04 runs a scenario, shows a verdict and creates a pending draft", async () => {
  await go("uc04");
  await page.click('[data-action="run-scenario"]');
  await page.waitForSelector("#result");
  assert.match(await text(), /robustly_resolved/);
  await page.click('[data-action="create-draft"]');
  await page.waitForSelector(".lc-approval");
  assert.match(await text(), /Bản nháp · chờ duyệt/);
});
await step("approval without approver name is refused; with a name it re-runs Task 2 in a new bundle", async () => {
  await page.locator('[data-action="approve"]').first().click();
  assert.match(await page.locator("#toast").innerText(), /Cần ghi tên người duyệt/);
  await page.locator('input[id^="approver-"]').first().fill("Nguyễn Văn A");
  await page.locator('[data-action="approve"]').first().click();
  await page.waitForURL(/#\/uc02/);
  await page.locator("#workspace", { hasText: "Kết quả chạy lại sau khi duyệt" }).waitFor({ timeout: 5000 });
  assert.match(await page.locator("#page-meta").innerText(), /AB-F01-002/);
  await go("log");
  const t = await text();
  assert.match(t, /AB-F01-001/); assert.match(t, /Đã cũ/); assert.match(t, /draft\.approved/);
});
await step("reject path requires a reason", async () => {
  await go("uc03");
  await page.locator('input[data-action="toggle-option"]').first().check();
  await go("uc04");
  await page.click('[data-action="run-scenario"]');
  await page.waitForSelector("#result");
  if (await page.locator('[data-action="create-draft"]').count()) {
    await page.click('[data-action="create-draft"]');
    await page.locator('[data-action="reject"]').first().click();
    assert.match(await page.locator("#toast").innerText(), /Cần nhập lý do/);
    await page.locator('textarea[id^="reason-"]').first().fill("Chi phí cao");
    await page.locator('[data-action="reject"]').first().click();
    assert.match(await text(), /Đã từ chối/);
  } else assert.match(await text(), /Chưa giải quyết đủ/);
});
await step("F02: untimely source is rejected with need_date reason", async () => {
  await page.selectOption("#firm", "F02");
  await go("uc00");
  await page.click('[data-action="policy-defaults"]'); await page.click('#policy-form button[type=submit]');
  await page.check("#ack"); await page.click('[data-action="confirm-intake"]');
  await go("uc03");
  assert.match(await text(), /sau need_date/);
});
await step("F03: no shortfall, surplus branch with SafeCash; Task 4 locked with reason", async () => {
  await page.selectOption("#firm", "F03");
  await go("uc00");
  await page.click('[data-action="policy-defaults"]'); await page.click('#policy-form button[type=submit]');
  await page.check("#ack"); await page.click('[data-action="confirm-intake"]');
  await go("uc02");
  assert.match(await text(), /Không có ngày nào dưới Rtarget/);
  await go("uc03");
  assert.match(await text(), /SafeCash/);
  await go("uc04");
  assert.match(await text(), /nhánh dư tiền/);
});
await step("changing thresholds after confirmation marks the old bundle stale", async () => {
  await go("uc00");
  await page.fill("#pol-rtarget_vnd", "650.000.000");
  await page.click('#policy-form button[type=submit]');
  await go("log");
  assert.match(await text(), /đổi ngưỡng/); assert.match(await text(), /Đã cũ/);
});
await step("keyboard: skip link and visible focus ring", async () => {
  await go("uc01");
  await page.reload(); await page.waitForSelector("#workspace > *");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.className), "la-skip", await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80)));
  await page.keyboard.press("Tab");
  const shadow = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  assert.notEqual(shadow, "none");
});
for (const [w, h, name] of [[1440, 1000, "desktop"], [820, 1100, "tablet"], [390, 844, "mobile"]]) {
  await step(`no horizontal page scroll at ${w}px (${name})`, async () => {
    await page.setViewportSize({ width: w, height: h });
    for (const v of ["uc00", "uc01", "uc02", "uc03", "uc04", "log"]) {
      await go(v);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `${v} overflows by ${over}px`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}-${v}.png`, fullPage: false });
    }
    if (w < 900) {
      assert.equal(await page.locator(".la-menu").isVisible(), true);
      await page.click(".la-menu");
      assert.equal(await page.locator("#nav").isVisible(), true);
    }
  });
}
await step("no JavaScript errors during the run", async () => assert.deepEqual(errors, []));

await browser.close(); server.close();
for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
