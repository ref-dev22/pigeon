// Chaos judge: behaves like an impatient stranger on the live app and fails on
// anything a real user would call broken. Run: node scripts/chaos.mjs [seed] [steps] [url]
// It never saves an email, so it cannot send mail. It creates guest boards; the
// health report lists them and they can be paused afterwards.
import { chromium } from "playwright";

const seed = Number(process.argv[2] ?? Date.now() % 100000);
const STEPS = Number(process.argv[3] ?? 40);
const app = process.argv[4] ?? "https://marvelous-dinosaur-465.convex.site/";
let s = seed;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const findings = [];
const note = (kind, detail) => { findings.push({ step, kind, detail }); console.log(`  ! ${kind}: ${detail}`); };
let step = 0;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
// The Convex client echoes every failed mutation to the console, including
// ConvexErrors the UI handles with a friendly message. Only unexplained
// failures count.
page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_ABORTED|\[CONVEX M\(/.test(m.text())) consoleErrors.push(m.text()); });

const BAD_TEXT = /Server Error|Something went wrong|Uncaught|undefined|NaN|\[object Object\]/;

async function check(label) {
  const body = (await page.textContent("body").catch(() => "")) ?? "";
  if (BAD_TEXT.test(body)) note("bad-text", `${label}: ${body.match(BAD_TEXT)?.[0]} visible at ${page.url()}`);
  if (body.trim().length < 40) note("blank-page", `${label}: page nearly empty at ${page.url()}`);
  if (/Loading…/.test(body)) {
    await page.waitForTimeout(4000);
    const again = (await page.textContent("body").catch(() => "")) ?? "";
    if (/Loading…/.test(again) && !/Loading…\s*$/.test(again)) note("stuck-loading", `${label}: still loading after 4 s at ${page.url()}`);
  }
  while (consoleErrors.length) note("console", `${label}: ${consoleErrors.shift().slice(0, 200)}`);
}

const JUNK_URLS = [
  "not a url", "javascript:alert(1)", "http://localhost:3000/x", "https://127.0.0.1/", "ftp://example.org/",
  "https://example.org/" + "a".repeat(3000), "https://[::1]/", "https://example.org/?utm_source=x#frag",
  "https://news.ycombinator.com/", "https://www.gov.uk/", "https://httpstat.us/500", "https://example.org/404-not-here",
  "  https://example.org  ", "example.org/notice", "https://例え.テスト/",
];

const actions = {
  async clickAnyButton() {
    const btns = await page.locator("button:visible:not([disabled])").all();
    if (!btns.length) return "no buttons";
    const b = pick(btns);
    const label = (await b.textContent())?.trim().slice(0, 40);
    if (/remove|delete/i.test(label ?? "") && rnd() < 0.7) return "skipped " + label;
    await b.click({ timeout: 3000 }).catch((e) => note("click-failed", `${label}: ${e.message.split("\n")[0]}`));
    return "click " + label;
  },
  async doubleClickButton() {
    const btns = await page.locator("button:visible:not([disabled])").all();
    if (!btns.length) return "no buttons";
    const b = pick(btns);
    const label = (await b.textContent())?.trim().slice(0, 40);
    if (/remove|delete|sign out/i.test(label ?? "")) return "skipped " + label;
    await Promise.all([b.click({ timeout: 3000 }).catch(() => {}), b.click({ timeout: 3000 }).catch(() => {})]);
    return "double " + label;
  },
  async addJunkUrl() {
    const input = page.getByPlaceholder("https://example.org/notices");
    if (!(await input.count())) return "no url field";
    const u = pick(JUNK_URLS);
    await input.first().fill(u);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    return "url " + u.slice(0, 40);
  },
  async reload() { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500); return "reload"; },
  async back() { await page.goBack().catch(() => {}); await page.waitForTimeout(800); return "back"; },
  async junkHash() {
    const h = pick(["#/board/xyz", "#/watch/kn7notreal", "#/change/", "#/join/zzzzzzzz", "#/board/" + "k".repeat(40), "#/%00", "#/watch/../..", "#garbage"]);
    await page.evaluate((x) => { window.location.hash = x; }, h);
    await page.waitForTimeout(1200);
    return "hash " + h;
  },
  async secondTab() {
    const p2 = await ctx.newPage();
    await p2.goto(page.url(), { waitUntil: "domcontentloaded" }).catch(() => {});
    await p2.waitForTimeout(1500);
    const b = p2.locator("button:visible:not([disabled])").filter({ hasText: /check now|publish|try a real/i }).first();
    if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {});
    await p2.waitForTimeout(800);
    const body = (await p2.textContent("body").catch(() => "")) ?? "";
    if (BAD_TEXT.test(body)) note("bad-text", "second tab: " + body.match(BAD_TEXT)?.[0]);
    await p2.close();
    return "second tab";
  },
  async fillSettingsJunk() {
    const focus = page.getByPlaceholder(/what matters|fees, dates/i).first();
    if (!(await focus.count())) return "no focus field";
    await focus.fill(pick(["x".repeat(5000), "<script>alert(1)</script>", "'; DROP TABLE watches; --", "🐦".repeat(300), ""]));
    const save = page.locator("button:visible").filter({ hasText: /save|watch/i }).first();
    if (await save.count()) await save.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    return "junk focus";
  },
  async wait() { await page.waitForTimeout(2500); return "wait"; },
};

console.log(`chaos seed=${seed} steps=${STEPS} app=${app}`);
await page.goto(app, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /try it now/i }).first().click();
await page.waitForURL(/#\/board\//, { timeout: 30000 }).catch(() => note("no-board", "guest sign-in did not reach a board"));
await page.waitForTimeout(2000);
const boardUrl = page.url();
await check("after guest");

const weights = [["clickAnyButton", 5], ["doubleClickButton", 2], ["addJunkUrl", 3], ["reload", 2], ["back", 1], ["junkHash", 2], ["secondTab", 1], ["fillSettingsJunk", 1], ["wait", 2]];
const bag = weights.flatMap(([k, w]) => Array(w).fill(k));

for (step = 1; step <= STEPS; step++) {
  const name = pick(bag);
  let what = "";
  try { what = await actions[name](); } catch (e) { note("action-threw", `${name}: ${e.message.split("\n")[0]}`); }
  console.log(`${String(step).padStart(2)} ${name.padEnd(18)} ${what}`);
  await check(name);
  // If a junk hash left us off the board, a real user would click the brand; do the same sometimes.
  if (rnd() < 0.3 && !page.url().includes("#/board/")) { await page.goto(boardUrl).catch(() => {}); await page.waitForTimeout(800); }
}

// End: sign out from wherever we are, then come back to the stale board link.
await page.locator("button").filter({ hasText: /sign out/i }).first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(1500);
await check("after sign out");
await page.goto(boardUrl); await page.waitForTimeout(1500);
await check("stale board link signed out");

await page.screenshot({ path: `../shots/chaos-${seed}.png` }).catch(() => {});
await browser.close();
console.log(`\nboard: ${boardUrl}\nfindings: ${findings.length}`);
for (const f of findings) console.log(` step ${f.step} ${f.kind}: ${f.detail}`);
process.exit(findings.length ? 1 : 0);
