// SPEC-019 real-page eval: a guest board watches a few real public pages, asks
// questions with known answers (and some the page does not answer), records
// what Pigeon shows, then pauses every watch so nothing is scraped again.
// One scrape per page; every reading uses that capture.
// Usage: node scripts/questions-eval.mjs <baseUrl> <questions.json> [out.json]
// questions.json: [{ "url": "...", "questions": [{ "q": "...", "expect": "..." }] }]
import { chromium } from "playwright";
import fs from "node:fs";

const [, , app, cfgPath, outPath = "../shots/questions-eval.json"] = process.argv;
const pages = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const waitFor = async (fn, label, ms = 120_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(2000);
  }
  log("TIMEOUT waiting for", label);
  return false;
};

await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30_000 });
await p.waitForTimeout(1500);
const board = p.url();

// Watch every page at the longest interval.
for (const pg of pages) {
  await p.getByPlaceholder("https://example.org/notices").fill(pg.url);
  const sel = p.locator("select[aria-label='How often']");
  const longest = await sel.evaluate((s) => [...s.options].map((o) => Number(o.value)).sort((a, b) => b - a)[0]);
  await sel.selectOption(String(longest));
  await p.getByRole("button", { name: /^watch$/i }).click();
  await p.waitForTimeout(2000);
  log("watching", pg.url);
}

const row = (pg) => p.locator(".watch", { hasText: pg.url.replace(/\/$/, "") }).first();
const results = [];
for (const pg of pages) {
  const r = row(pg);
  await waitFor(async () => /\b[1-9]\d* checks?\b/.test(await r.innerText()), "first capture of " + pg.url, 180_000);
  await waitFor(async () => (await r.locator(".suggest-chip").count()) > 0 || /What can this page answer\?/.test(await r.innerText()), "suggestions for " + pg.url, 60_000);
  const suggestions = await r.locator(".suggest-chip").allInnerTexts();
  for (const item of pg.questions) {
    await r.getByLabel("Ask this page a question").fill(item.q);
    await r.getByRole("button", { name: /^ask$/i }).click();
    // Stay under the ask limiter (6 a minute per person).
    await p.waitForTimeout(11_000);
  }
  await waitFor(async () => {
    const tones = await r.locator("[data-pigeon-fact]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pigeon-fact")));
    return tones.length >= pg.questions.length && tones.every((t) => t !== "reading");
  }, "readings for " + pg.url, 180_000);
  const facts = await r.locator("[data-pigeon-fact]").evaluateAll((els) =>
    els.map((e) => ({ tone: e.getAttribute("data-pigeon-fact"), text: e.innerText.replace(/\s+/g, " ").trim() })),
  );
  const href = await r.locator("a[href^='#/watch/']").first().getAttribute("href");
  results.push({
    url: pg.url,
    suggestions,
    questions: pg.questions.map((item) => ({ ...item, shown: facts.find((f) => f.text.includes(item.q)) ?? null })),
    href,
  });
  log("read", pg.url, JSON.stringify(facts.map((f) => f.tone)));
}

// Pause every watch so the eval costs one scrape per page, once.
for (const res of results) {
  if (!res.href) continue;
  await p.goto(new URL(res.href, board).toString());
  await p.waitForTimeout(2000);
  const pause = p.getByRole("button", { name: /^pause$/i }).first();
  if (await pause.count()) {
    await pause.click();
    await p.waitForTimeout(1200);
    log("paused", res.url);
  } else log("NO PAUSE BUTTON for", res.url);
}

fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), app, board, pageErrors: errs, results }, null, 2));
log("wrote", outPath, "pageErrors:", errs.length);
await b.close();
