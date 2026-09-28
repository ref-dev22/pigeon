// SPEC-019: pure helpers for watching a fact, not a page.
//
// A page is read as numbered, normalised lines. The language model only ever
// returns line numbers, so a quote is always the page's own words; code checks
// the selection and that every number in the plain answer appears in the
// quoted lines. Nothing here touches the database or the network, so it can be
// tested directly (scripts/facts-test.mjs).

// One canonical text for every comparison: NFKC, bidi marks removed,
// non-breaking spaces as spaces, markdown escapes undone, Eastern Arabic and
// Persian digits as ASCII, runs of spaces collapsed.
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Arabic thousands and decimal separators
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// The page as the lines the model sees (1-based when shown). Empty lines and
// table separator rows carry no facts and are dropped.
export function pageLines(stableMarkdown: string): string[] {
  return stableMarkdown
    .split("\n")
    .map(normalizeText)
    .filter((l) => l.length > 0 && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l));
}

const STOP = new Set(
  "the and for when what how much does did is are was were will this that with from page there have has which who whom where why can could should would about into your our their its it be been being any all per a an of to in on at by or as do if not no yes now new get got i me my we you they them than then also just only more most some such very"
    .split(" "),
);

// Words that carry meaning for matching: letters of any script (3+ chars) and
// digit groups with separators removed ("1,000" -> "1000").
export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  const text = normalizeText(s).toLowerCase();
  for (const m of text.matchAll(/\d[\d,.]*\d|\d|[\p{L}]+/gu)) {
    let t = m[0];
    if (/^\d/.test(t)) {
      t = t.replace(/,/g, "").replace(/\.0+$/, "");
      if (t.length >= 1) out.add(t);
    } else if (t.length >= 3 && !STOP.has(t)) {
      out.add(t);
    }
  }
  return out;
}

// Numbers in canonical form: separators removed, trailing ".0" and leading
// zeros dropped, so "07:00", "7:00", "1,000" and "1000.0" compare as facts.
export function numbersIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of normalizeText(s).matchAll(/\d[\d,.]*\d|\d/g)) {
    const n = m[0].replace(/,/g, "").replace(/\.$/, "").replace(/\.0+$/, "").replace(/^0+(?=\d)/, "");
    out.add(n);
  }
  return out;
}

// Every number the plain answer states must appear in the quoted lines.
export function numbersCovered(answer: string, quote: string): { ok: boolean; missing: string[] } {
  const have = numbersIn(quote);
  const missing = [...numbersIn(answer)].filter((n) => !have.has(n));
  return { ok: missing.length === 0, missing };
}

export type Candidate = { n: number; text: string };

function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line) || /^\*\*[^*]{2,120}\*\*:?$/.test(line);
}

// Lines worth showing the model for one question. Short pages go in whole;
// long pages are cut to the lines sharing words with the question (and with
// the current quote, when there is one), two lines of context each side, and
// the heading above, within a character budget.
export function candidates(lines: string[], question: string, extra = "", maxChars = 12_000): Candidate[] {
  const all = lines.map((text, i) => ({ n: i + 1, text }));
  const total = all.reduce((s, c) => s + c.text.length + 8, 0);
  if (total <= maxChars) return all;
  const want = new Set([...tokens(question), ...tokens(extra)]);
  const scored = all
    .map((c) => {
      let score = 0;
      for (const t of tokens(c.text)) if (want.has(t)) score++;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.n - b.c.n);
  const keep = new Set<number>();
  let used = 0;
  for (const { c } of scored) {
    const idx = c.n - 1;
    const block: number[] = [];
    for (let j = Math.max(0, idx - 2); j <= Math.min(lines.length - 1, idx + 2); j++) block.push(j);
    for (let j = idx; j >= 0; j--) {
      if (isHeading(lines[j])) {
        block.push(j);
        break;
      }
    }
    const cost = block.filter((j) => !keep.has(j)).reduce((s, j) => s + lines[j].length + 8, 0);
    if (used + cost > maxChars) continue;
    for (const j of block) keep.add(j);
    used += cost;
  }
  if (keep.size === 0) {
    const head: Candidate[] = [];
    for (const c of all) {
      used += c.text.length + 8;
      if (used > maxChars) break;
      head.push(c);
    }
    return head;
  }
  return [...keep].sort((a, b) => a - b).map((j) => all[j]);
}

// "L12: text" per line, with a gap marker where lines were skipped.
export function numbered(cands: Candidate[]): string {
  const out: string[] = [];
  let prev = 0;
  for (const c of cands) {
    if (c.n > prev + 1) out.push("…");
    out.push("L" + c.n + ": " + c.text);
    prev = c.n;
  }
  return out.join("\n");
}

export type Selection = { start: number; end: number };

// Placeholders stabilize() puts in place of counters, long query strings and hashes.
const PLACEHOLDER = /<n>|<hex>|\?<q>/;

export function checkSelection(lines: string[], shown: Candidate[], sel: Selection): string | null {
  const { start, end } = sel;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "line numbers must be whole numbers";
  if (start < 1 || end > lines.length || start > end) return "those line numbers are not on the page";
  if (end - start > 2) return "choose at most three contiguous lines";
  const visible = new Set(shown.map((c) => c.n));
  for (let n = start; n <= end; n++) if (!visible.has(n)) return "line L" + n + " was not shown to you";
  for (let n = start; n <= end; n++) {
    if (PLACEHOLDER.test(lines[n - 1])) return "line L" + n + " holds a counter or link Pigeon cannot quote exactly; choose another line";
  }
  return null;
}

export function quoteOf(lines: string[], sel: Selection): string {
  return lines.slice(sel.start - 1, sel.end).join("\n");
}

// The nearest heading above a line, as the quote's section.
// A markdown heading is structure; a bold line is often only a label
// ("**Statement:**"), so it names the section only when no heading is above.
export function sectionFor(lines: string[], start: number): string | undefined {
  const clean = (l: string) => l.replace(/^#{1,6}\s+/, "").replace(/^\*\*|\*\*:?$/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").slice(0, 100);
  for (let j = start - 2; j >= 0; j--) {
    if (/^#{1,6}\s/.test(lines[j])) return clean(lines[j]);
  }
  for (let j = start - 2; j >= 0; j--) {
    if (isHeading(lines[j])) return clean(lines[j]);
  }
  return undefined;
}

// A table row means little without its header row.
export function tableHeaderFor(lines: string[], start: number): string | undefined {
  if (!lines[start - 1]?.startsWith("|")) return undefined;
  let j = start - 1;
  while (j - 1 >= 0 && lines[j - 1].startsWith("|")) j--;
  return j < start - 1 ? lines[j] : undefined;
}

export function sameQuote(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const k = (s: string) => normalizeText(s).toLowerCase().replace(/\s+/g, " ");
  return k(a) === k(b);
}

// All the quote's lines are still on the page, somewhere.
export function quoteStillPresent(lines: string[], quote: string | undefined): boolean {
  if (!quote) return false;
  const have = new Set(lines.map((l) => l.toLowerCase()));
  return quote.split("\n").every((l) => have.has(normalizeText(l).toLowerCase()));
}

export function changedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")))
    .map((l) => l.slice(1));
}

// Cheap guard before any model call: a page change can only move the answer
// if a changed line shares a word with the question or the current quote, or
// if the current quote's lines have left the page.
export function changeIsRelevant(diff: string, question: string, currentQuote: string | undefined, lines: string[]): boolean {
  if (currentQuote && !quoteStillPresent(lines, currentQuote)) return true;
  const want = new Set([...tokens(question), ...tokens(currentQuote ?? "")]);
  for (const l of changedLines(diff)) {
    for (const t of tokens(l)) if (want.has(t)) return true;
  }
  return false;
}

export type FactState = { status: "answered" | "waiting"; quote?: string };

// What happened to the fact between two readings.
export type Transition = "none" | "answered" | "withdrawn" | "quote_changed" | "same";

export function transition(prev: FactState | undefined, next: FactState): Transition {
  if (!prev) return "none";
  if (prev.status === "waiting" && next.status === "answered") return "answered";
  if (prev.status === "answered" && next.status === "waiting") return "withdrawn";
  if (prev.status === "answered" && next.status === "answered") {
    return sameQuote(prev.quote, next.quote) ? "same" : "quote_changed";
  }
  return "same";
}

// Suggestions must never be about timestamps, counters or navigation.
export function isBoringQuestion(q: string): boolean {
  return /\b(last updated|updated on|visitors?|views?|page views|online now|cookies?|copyright|menu|navigation|sign in|log ?in)\b/i.test(q);
}

// Show a quote as a reader sees the page: without bullet markers, bold
// markers or link addresses. The stored quote stays verbatim for every
// comparison.
export function plainQuote(quote: string): string {
  return quote
    .replace(/^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2");
}
