// Unit checks for convex/facts.ts (SPEC-019). Run: node scripts/facts-test.mjs
import assert from "node:assert/strict";
import {
  normalizeText, pageLines, tokens, numbersCovered, candidates, numbered, checkSelection,
  quoteOf, sectionFor, tableHeaderFor, sameQuote, quoteStillPresent, changeIsRelevant,
  transition, isBoringQuestion, plainQuote,
} from "../convex/facts.ts";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok ", name); };

const demo0 = `# Community notices

Last updated: 2026-09-01 09:00 · Visitors online now: <n>

- The main pool is open daily from 07:00 to 21:00.
- Parking permits for next year can be requested from 1 October at the management office. The fee is AED 1,000 per vehicle, due by 15 October.
- The gym opens 06:00 to 22:00 every day.`;
const demo1 = demo0.replace("open daily from", "open every day from");
const demo2 = demo1
  .replace("AED 1,000 per vehicle, due by 15 October", "AED 1,500 per vehicle, due by 10 October")
  + "\n- New: the community hall is closed for renovation until the end of next month.";

t("normalise: nbsp, bidi marks, escapes, Arabic-Indic digits", () => {
  assert.equal(normalizeText("AED 1,000‏"), "AED 1,000");
  assert.equal(normalizeText("\\*fee\\*"), "*fee*");
  assert.equal(normalizeText("الرسوم ١٬٥٠٠ درهم"), "الرسوم 1,500 درهم".normalize("NFKC"));
  assert.equal(normalizeText("٢٠٢٧"), "2027");
});

t("page lines drop blanks and table separators", () => {
  const l = pageLines("| Permit | Fee |\n|---|---|\n| Parking | AED 1,000 |\n\n");
  assert.deepEqual(l, ["| Permit | Fee |", "| Parking | AED 1,000 |"]);
});

t("tokens: stopwords out, digit groups joined", () => {
  const k = tokens("How much is the parking permit and when is it due? AED 1,000");
  assert.ok(k.has("parking") && k.has("permit") && k.has("due") && k.has("1000"));
  assert.ok(!k.has("how") && !k.has("the") && !k.has("much"));
});

t("numbers rule: answer numbers must be in the quote", () => {
  const q = "The fee is AED 1,500 per vehicle, due by 10 October.";
  assert.ok(numbersCovered("AED 1,500 per vehicle, due 10 October.", q).ok);
  assert.deepEqual(numbersCovered("AED 2,000, due 10 October.", q).missing, ["2000"]);
  assert.ok(numbersCovered("Opens at 7:00.", "Open from 07:00").ok);
  assert.ok(numbersCovered("Fee ١٬٥٠٠ AED", "fee 1,500").ok);
});

t("selection: contiguous, max three lines, only shown lines", () => {
  const lines = pageLines(demo0);
  const shown = candidates(lines, "parking fee");
  assert.equal(checkSelection(lines, shown, { start: 4, end: 4 }), null);
  assert.match(checkSelection(lines, shown, { start: 1, end: 5 }), /three/);
  assert.match(checkSelection(lines, shown, { start: 9, end: 9 }), /not on the page/);
  assert.match(checkSelection(lines, shown, { start: 2.5, end: 3 }), /whole/);
});

t("quote is the page's own line, with its section", () => {
  const lines = pageLines(demo0);
  const n = lines.findIndex((l) => l.includes("Parking permits")) + 1;
  assert.match(quoteOf(lines, { start: n, end: n }), /AED 1,000 per vehicle, due by 15 October/);
  assert.equal(sectionFor(lines, n), "Community notices");
});

t("table rows carry their header", () => {
  const lines = pageLines("## Fees\n\n| Item | Fee | Due |\n|---|---|---|\n| Parking | AED 1,000 | 15 Oct |\n| Gym | AED 200 | 1 Nov |");
  const n = lines.findIndex((l) => l.includes("Gym")) + 1;
  assert.equal(tableHeaderFor(lines, n), "| Item | Fee | Due |");
  assert.equal(sectionFor(lines, n), "Fees");
});

t("long pages are cut to relevant lines with context, and numbered", () => {
  const filler = Array.from({ length: 800 }, (_, i) => `- Unrelated line ${i} about the weather and the car park lights.`);
  const page = ["# Notices", ...filler.slice(0, 400), "## Permits", "- The parking permit fee is AED 1,000, due 15 October.", ...filler.slice(400)].join("\n");
  const lines = pageLines(page);
  const shown = candidates(lines, "How much is the parking permit fee?", "", 2000);
  const text = numbered(shown);
  assert.ok(text.includes("AED 1,000"), "the answer line is shown");
  assert.ok(text.includes("Permits"), "its heading is shown");
  assert.ok(text.length < 3000);
  assert.ok(text.includes("…"), "gaps are marked");
});

t("cosmetic demo edit is not relevant to the parking question", () => {
  const diff = "--- before\n+++ after\n@@\n-- The main pool is open daily from 07:00 to 21:00.\n+- The main pool is open every day from 07:00 to 21:00.";
  const q = "- Parking permits for next year can be requested from 1 October at the management office. The fee is AED 1,000 per vehicle, due by 15 October.";
  assert.equal(changeIsRelevant(diff, "How much is the parking permit and when is it due?", q, pageLines(demo1)), false);
});

t("fee change is relevant; a removed quote is relevant", () => {
  const diff = "-- Parking permits ... The fee is AED 1,000 per vehicle, due by 15 October.\n+- Parking permits ... The fee is AED 1,500 per vehicle, due by 10 October.";
  const q = pageLines(demo0).find((l) => l.includes("Parking"));
  assert.equal(changeIsRelevant(diff, "How much is the parking permit?", q, pageLines(demo2)), true);
  assert.equal(changeIsRelevant("+- Pool closed", "When is the pool open?", "- gone line", pageLines(demo2)), true);
});

t("stale copy: quote still present is detected line by line", () => {
  const lines = pageLines(demo2 + "\n- Archive: The fee is AED 1,000 per vehicle, due by 15 October.");
  assert.equal(quoteStillPresent(lines, "- Archive: The fee is AED 1,000 per vehicle, due by 15 October."), true);
  assert.equal(quoteStillPresent(pageLines(demo2), pageLines(demo0).find((l) => l.includes("Parking"))), false);
});

t("fact lifecycle transitions", () => {
  assert.equal(transition(undefined, { status: "waiting" }), "none");
  assert.equal(transition({ status: "waiting" }, { status: "answered", quote: "x" }), "answered");
  assert.equal(transition({ status: "answered", quote: "x" }, { status: "waiting" }), "withdrawn");
  assert.equal(transition({ status: "answered", quote: "Fee AED 1,000" }, { status: "answered", quote: "fee  AED 1,000" }), "same");
  assert.equal(transition({ status: "answered", quote: "Fee AED 1,000" }, { status: "answered", quote: "Fee AED 1,500" }), "quote_changed");
  assert.equal(transition({ status: "waiting" }, { status: "waiting" }), "same");
  assert.ok(sameQuote("a b", "A b"));
});

t("boring suggestions are filtered", () => {
  assert.ok(isBoringQuestion("When was the page last updated?"));
  assert.ok(isBoringQuestion("How many visitors are online?"));
  assert.ok(!isBoringQuestion("How much is the parking permit?"));
});

t("a line holding a noise placeholder cannot be quoted", () => {
  const lines = ["Visitors online now: <n>", "The fee is AED 1,000.", "See https://x.org/a?<q>"];
  const shown = lines.map((text, i) => ({ n: i + 1, text }));
  assert.match(checkSelection(lines, shown, { start: 1, end: 1 }), /cannot quote/);
  assert.match(checkSelection(lines, shown, { start: 2, end: 3 }), /cannot quote/);
  assert.equal(checkSelection(lines, shown, { start: 2, end: 2 }), null);
});

t("long page with no matching words shows its top, not nothing", () => {
  const lines = Array.from({ length: 800 }, (_, i) => "Row " + i + " lorem ipsum dolor sit amet consectetur");
  const shown = candidates(lines, "When is the academic year calendar published?");
  assert.ok(shown.length > 0 && shown[0].n === 1);
  assert.ok(shown.reduce((s, c) => s + c.text.length + 8, 0) <= 12_000);
});

t("section prefers a real heading over a bold label", () => {
  const lines = ["### 2026 FOMC Meetings", "**October** 27-28", "**Statement:**", "[PDF](https://x.org/a.pdf) (Released February 18, 2026)"];
  assert.equal(sectionFor(lines, 4), "2026 FOMC Meetings");
  assert.equal(sectionFor(["**Free Plan**", "1,000 credits / month"], 2), "Free Plan");
});

t("display quotes drop list markers only", () => {
  assert.equal(plainQuote("**Minutes:** [PDF](https://x.org/m.pdf) (Released February 18, 2026)"), "Minutes: PDF (Released February 18, 2026)");
  assert.equal(plainQuote("- Parking permits cost AED 1,000."), "Parking permits cost AED 1,000.");
  assert.equal(plainQuote("2. Pool opens 07:00\n* Gym 06:00"), "Pool opens 07:00\nGym 06:00");
  assert.equal(plainQuote("Fee is -5% this year"), "Fee is -5% this year");
  assert.equal(plainQuote("2026 fees rise"), "2026 fees rise");
});

console.log(`\n${passed} checks passed`);

