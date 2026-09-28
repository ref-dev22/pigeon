// SPEC-019 acceptance run: guest board, demo notice board, ask the suggested
// question, cosmetic edit (answer must not move, nothing sent), fee change
// (answer must change, was/now shown), plus a question the page does not answer
// until the fee change adds the hall closure ("now answered").
// Usage: node scripts/ask-demo.mjs [baseUrl] [email] [--fast]
// --fast: publish the fee change right after asking, while the first reading
// may still be running (the race the pipeline must wait out).
import { chromium } from "playwright";

const app = (process.argv.filter((a) => a !== "--fast")[2]) ?? "https://marvelous-dinosaur-465.convex.site/";
const fast = process.argv.includes("--fast");
const [, , appArg, emailArg] = process.argv.filter((a) => a !== "--fast");
const email = emailArg;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const waitFor = async (fn, label, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await p.waitForTimeout(1500);
  }
  log("TIMEOUT waiting for", label);
  return false;
};
const facts = async () =>
  p.locator("[data-pigeon-fact]").evaluateAll((els) =>
    els.map((e) => ({ tone: e.getAttribute("data-pigeon-fact"), text: e.innerText.replace(/\s+/g, " ").slice(0, 400) })),
  );

await p.goto(app, { waitUntil: "networkidle" });
log("hero:", (await p.locator("#hero-title").innerText()).replace(/\s+/g, " "));
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30_000 });
await p.waitForTimeout(1500);
if (email) {
  await p.getByPlaceholder(/you@example.com/i).first().fill(email);
  await p.getByRole("button", { name: /save my email/i }).first().click();
  await p.waitForTimeout(1200);
}
await p.getByRole("button", { name: /try a real change/i }).first().click();
log("demo created; waiting for the first capture and suggestions");

const gotSuggestion = await waitFor(async () => (await p.locator(".suggest-chip").count()) > 0, "suggestions", 120_000);
const suggestions = await p.locator(".suggest-chip").allInnerTexts();
log("suggestions:", JSON.stringify(suggestions));
// The fee change must move the answer, so prefer the suggestion that asks about the cost.
const parking = suggestions.find((s) => /parking|permit/i.test(s) && /cost|fee|price|how much/i.test(s)) ?? suggestions.find((s) => /parking|permit|fee/i.test(s));
if (gotSuggestion && parking) {
  await p.locator(".suggest-chip", { hasText: parking }).first().click();
  log("asked (suggested):", parking);
} else {
  await p.getByLabel("Ask this page a question").fill("How much is the parking permit and when is it due?");
  await p.getByRole("button", { name: /^ask$/i }).click();
  log("asked (typed): parking question");
}
if (fast) {
  await p.getByRole("button", { name: /publish a fee/i }).click();
  log("fast: fee change published straight after asking");
  await waitFor(async () => (await facts()).some((f) => f.tone === "changed"), "answer changed", 150_000);
  await p.waitForTimeout(3000);
  const f = await facts();
  log("progress:", (await p.locator("[data-pigeon-progress]").first().innerText()).replace(/s+/g, " "));
  log("facts:", JSON.stringify(f, null, 1));
  log("RESULT", JSON.stringify({ fastChanged: f.some((x) => x.tone === "changed" && /1,500/.test(x.text)), pageErrors: errs.length }));
  await b.close();
  process.exit(0);
}
await p.waitForTimeout(1500);
await p.getByLabel("Ask this page a question").fill("Is the community hall open for bookings?");
await p.getByRole("button", { name: /^ask$/i }).click();
log("asked (typed): community hall question");

await waitFor(async () => {
  const f = await facts();
  return f.length >= 2 && f.every((x) => x.tone !== "reading");
}, "both facts read");
log("facts after asking:", JSON.stringify(await facts(), null, 1));

// Cosmetic edit: the parking answer must not move and nothing is sent.
await p.getByRole("button", { name: /publish a cosmetic edit/i }).click();
log("cosmetic edit published");
await waitFor(async () => /Cosmetic edit published[\s\S]*(Not emailed|Emailed)/.test(await p.locator("[data-pigeon-progress]").first().innerText()), "cosmetic judged");
await p.waitForTimeout(3000);
const afterCosmetic = await facts();
log("progress:", (await p.locator("[data-pigeon-progress]").first().innerText()).replace(/\s+/g, " "));
log("facts after cosmetic:", JSON.stringify(afterCosmetic, null, 1));

// Fee change: the answer must change, and the hall question becomes answered.
await p.getByRole("button", { name: /publish a fee/i }).click();
log("fee change published");
await waitFor(async () => (await facts()).some((f) => f.tone === "changed"), "answer changed", 120_000);
await p.waitForTimeout(4000);
const afterFee = await facts();
log("progress:", (await p.locator("[data-pigeon-progress]").first().innerText()).replace(/\s+/g, " "));
log("facts after fee:", JSON.stringify(afterFee, null, 1));

// Change page shows the answer moves.
const diffLink = p.locator("a", { hasText: /^diff$/ }).first();
if (await diffLink.count()) {
  await diffLink.click();
  await p.waitForTimeout(2500);
  const moves = await p.locator("[data-pigeon-answer-moves]").count();
  log("change page shows answer moves:", moves > 0);
  await p.screenshot({ path: "../shots/ask-demo-change.png", fullPage: true });
  await p.goBack();
  await p.waitForTimeout(1500);
}
await p.screenshot({ path: "../shots/ask-demo-board.png", fullPage: true });
const body = await p.textContent("body");
log(
  "RESULT",
  JSON.stringify({
    suggestionOffered: !!parking,
    cosmeticKeptAnswer: afterCosmetic.some((f) => /1,000/.test(f.text) && f.tone === "answered"),
    feeChanged: afterFee.some((f) => f.tone === "changed" && /1,500/.test(f.text)),
    hallNowAnswered: afterFee.some((f) => /hall/i.test(f.text) && f.tone === "changed"),
    serverError: /Server Error/.test(body ?? ""),
    pageErrors: errs.length,
    receipts: await p.locator("[data-pigeon-receipt]").allInnerTexts(),
  }),
);
await b.close();
