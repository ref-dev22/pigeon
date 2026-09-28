// SPEC-019: ask a page a question. Pigeon watches the life of the fact that
// answers it, in the page's own words: not stated yet, answered, changed, no
// longer on the page. No extra scrapes: every reading uses a capture Pigeon
// already took.
import { ConvexError, v } from "convex/values";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, stabilize } from "./lib";
import * as F from "./facts";
import { decideFactChanged, pickAnswer, suggestQuestions } from "./summarize";

const MAX_PER_WATCH = 3;
const MAX_PER_BOARD = 15;
// History built at ask time reads at most this many stored captures.
const MAX_RETRO_SNAPSHOTS = 4;
// Answer emails per question per day; later moves that day are logged, not emailed.
const MAX_ALERTS_PER_DAY = 3;

const limiter = new RateLimiter(components.rateLimiter, {
  askQuestion: { kind: "token bucket", rate: 6, period: MINUTE, capacity: 6 },
  suggestions: { kind: "token bucket", rate: 2, period: MINUTE, capacity: 2 },
  // Whole deployment, so model spend has a ceiling however many guest boards exist.
  askQuestionDaily: { kind: "fixed window", rate: 200, period: 24 * HOUR },
  suggestionsDaily: { kind: "fixed window", rate: 100, period: 24 * HOUR },
});

// ---------------------------------------------------------------------------
// Public mutations

export const ask = mutation({
  args: {
    watchId: v.id("watches"),
    text: v.string(),
    source: v.optional(v.union(v.literal("typed"), v.literal("suggested"))),
  },
  handler: async (ctx, { watchId, text, source }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new ConvexError("That page is no longer watched.");
    const { userId } = await requireMember(ctx, watch.boardId);
    const question = text.replace(/\s+/g, " ").trim();
    if (question.length < 5) throw new ConvexError("Ask a slightly longer question.");
    if (question.length > 200) throw new ConvexError("Keep the question under 200 characters.");
    const onWatch = await ctx.db
      .query("questions")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .collect();
    if (onWatch.some((q) => q.text.toLowerCase() === question.toLowerCase())) {
      throw new ConvexError("That question is already being watched on this page.");
    }
    if (onWatch.length >= MAX_PER_WATCH) {
      throw new ConvexError("A page can hold " + MAX_PER_WATCH + " questions. Remove one to ask another.");
    }
    const onBoard = await ctx.db
      .query("questions")
      .withIndex("by_board", (q) => q.eq("boardId", watch.boardId))
      .collect();
    if (onBoard.length >= MAX_PER_BOARD) {
      throw new ConvexError("A board can hold " + MAX_PER_BOARD + " questions. Remove one to ask another.");
    }
    const { ok, retryAfter } = await limiter.limit(ctx, "askQuestion", { key: userId });
    if (!ok) {
      throw new ConvexError("You are asking quickly. Try again in " + Math.ceil((retryAfter ?? 1000) / 1000) + " seconds.");
    }
    const daily = await limiter.limit(ctx, "askQuestionDaily");
    if (!daily.ok) throw new ConvexError("Pigeon has read as many new questions as it can today. Try again tomorrow.");
    const now = Date.now();
    const questionId = await ctx.db.insert("questions", {
      boardId: watch.boardId,
      watchId,
      text: question,
      askedBy: userId,
      source: source ?? "typed",
      status: "evaluating",
      checksAtAsk: watch.checkCount,
      createdAt: now,
    });
    await ctx.db.insert("events", {
      boardId: watch.boardId,
      kind: "question.asked",
      message: "Asked " + (watch.title ?? watch.url) + ": “" + question + "”",
      watchId,
      at: now,
    });
    await ctx.scheduler.runAfter(0, internal.questions.evaluateNew, { questionId });
    return questionId;
  },
});

export const remove = mutation({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get(questionId);
    if (!q) return;
    await requireMember(ctx, q.boardId);
    await deleteQuestionRows(ctx.db, questionId);
  },
});

export const requestSuggestions = mutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new ConvexError("That page is no longer watched.");
    await requireMember(ctx, watch.boardId);
    if (!watch.latestSnapshotId) throw new ConvexError("Pigeon is still reading this page for the first time.");
    const { ok, retryAfter } = await limiter.limit(ctx, "suggestions", { key: watchId });
    if (!ok) throw new ConvexError("Try again in " + Math.ceil((retryAfter ?? 1000) / 1000) + " seconds.");
    const daily = await limiter.limit(ctx, "suggestionsDaily");
    if (!daily.ok) throw new ConvexError("Pigeon has read as many pages for suggestions as it can today. Ask your own question instead.");
    await ctx.db.patch(watchId, { suggestionsStatus: "pending" });
    await ctx.scheduler.runAfter(0, internal.questions.suggest, { watchId });
  },
});

// Delete a question and its history. Used by remove and when a page is removed.
export async function deleteQuestionRows(db: MutationCtx["db"], questionId: Id<"questions">) {
  const rows = await db
    .query("answers")
    .withIndex("by_question", (q) => q.eq("questionId", questionId))
    .collect();
  for (const r of rows) await db.delete(r._id);
  await db.delete(questionId);
}

// ---------------------------------------------------------------------------
// Read model for the board: questions with their recent history, and the
// suggestions not yet asked.

export async function questionsView(ctx: QueryCtx, watch: Doc<"watches">) {
  const qs = await ctx.db
    .query("questions")
    .withIndex("by_watch", (q) => q.eq("watchId", watch._id))
    .collect();
  const out = [];
  for (const q of qs) {
    const rows = await ctx.db
      .query("answers")
      .withIndex("by_question", (x) => x.eq("questionId", q._id))
      .order("desc")
      .collect();
    // The receipt: how often Pigeon looked since the question was asked, and
    // how often the answer actually moved in that time.
    const movesSinceAsk = rows.filter(
      (r) => r.capturedAt > q.createdAt && (r.kind === "answered" || r.kind === "changed" || r.kind === "withdrawn"),
    ).length;
    const checksSinceAsk = q.checksAtAsk === undefined ? null : Math.max(0, watch.checkCount - q.checksAtAsk);
    out.push({ ...q, history: rows.slice(0, 8), movesSinceAsk, checksSinceAsk });
  }
  const asked = new Set(qs.map((q) => q.text.toLowerCase()));
  const suggestions = (watch.suggestions ?? []).filter((s) => !asked.has(s.question.toLowerCase()));
  return { questions: out, suggestions, suggestionsStatus: watch.suggestionsStatus ?? null };
}

// ---------------------------------------------------------------------------
// Reading a fact from one capture

type Reading = {
  status: "answered" | "waiting";
  quote?: string;
  tableHeader?: string;
  section?: string;
  answer?: string;
  // The answer in a few words, for an email subject.
  headline?: string;
  isoDate?: string;
  relative?: boolean;
  note?: string;
};

// Ask the model for line numbers, check them in code, retry once with the
// reason. Returns null only when the model is unavailable.
async function readFact(question: string, markdown: string, title: string | undefined, currentQuote?: string): Promise<Reading | null> {
  const lines = F.pageLines(stabilize(markdown));
  const shown = F.candidates(lines, question, currentQuote ?? "");
  if (shown.length === 0) return { status: "waiting" };
  const page = F.numbered(shown);
  let reason: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const pick = await pickAnswer({ question, numberedPage: page, title, retryReason: reason, previousQuote: currentQuote });
    if (!pick) return null;
    if (!pick.answered || pick.start === null || pick.end === null) return { status: "waiting" };
    const sel = { start: pick.start, end: pick.end };
    const bad = F.checkSelection(lines, shown, sel);
    if (bad) {
      reason = bad;
      continue;
    }
    const quote = F.quoteOf(lines, sel);
    const tableHeader = F.tableHeaderFor(lines, sel.start);
    const nums = F.numbersCovered(pick.answer, quote + "\n" + (tableHeader ?? ""));
    if (!nums.ok) {
      reason = "the numbers " + nums.missing.join(", ") + " in your answer are not in lines L" + sel.start + "-L" + sel.end;
      continue;
    }
    const headline = pick.headline && F.numbersCovered(pick.headline, quote + "\n" + (tableHeader ?? "")).ok ? pick.headline : undefined;
    return {
      status: "answered",
      quote,
      tableHeader,
      section: F.sectionFor(lines, sel.start),
      answer: pick.answer || undefined,
      headline,
      isoDate: pick.isoDate ?? undefined,
      relative: pick.relative || undefined,
    };
  }
  return { status: "waiting", note: "Pigeon could not point to the exact words on the page, so it shows nothing rather than guess." };
}

type Snap = { _id: Id<"snapshots">; markdown: string; fetchedAt: number; truncated: boolean; title?: string };

// Is the fact different, or only reworded? The decision model decides. If it
// is unavailable, only a quote with the same numbers and the same plain answer
// counts as rewording; anything else is reported as a change.
async function factChanged(question: string, before: Reading & { quote: string }, after: Reading & { quote: string }) {
  const p = await decideFactChanged({
    question,
    before: { quote: before.quote, answer: before.answer ?? "" },
    after: { quote: after.quote, answer: after.answer ?? "" },
  });
  if (p !== null) return { changed: p >= 0.5, p };
  const a = [...F.numbersIn(before.quote)].sort().join(" ");
  const b = [...F.numbersIn(after.quote)].sort().join(" ");
  const sameAnswer = F.normalizeText(before.answer ?? "").toLowerCase() === F.normalizeText(after.answer ?? "").toLowerCase();
  return { changed: a !== b || !sameAnswer, p: undefined };
}

// ---------------------------------------------------------------------------
// A new question: read it against the captures Pigeon already holds, oldest
// first, so it arrives with its history.

export const loadForQuestion = internalQuery({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) return null;
    const watch = await ctx.db.get(question.watchId);
    if (!watch) return null;
    const snaps = await ctx.db
      .query("snapshots")
      .withIndex("by_watch", (q) => q.eq("watchId", watch._id))
      .order("desc")
      .take(MAX_RETRO_SNAPSHOTS);
    return {
      question,
      watch,
      snapshots: snaps.reverse().map((s) => ({
        _id: s._id,
        markdown: s.markdown,
        fetchedAt: s.fetchedAt,
        truncated: s.truncated,
        title: s.title,
      })) as Snap[],
    };
  },
});

type Row = {
  kind: Doc<"answers">["kind"];
  status: "answered" | "waiting";
  quote?: string;
  section?: string;
  answer?: string;
  headline?: string;
  prevQuote?: string;
  prevAnswer?: string;
  prevCapturedAt?: number;
  capturedAt: number;
  snapshotId?: Id<"snapshots">;
  changeId?: Id<"changes">;
  retro: boolean;
  factChanged?: number;
};

const patchValidator = v.object({
  status: v.optional(v.union(v.literal("evaluating"), v.literal("answered"), v.literal("waiting"))),
  quote: v.optional(v.union(v.string(), v.null())),
  tableHeader: v.optional(v.union(v.string(), v.null())),
  section: v.optional(v.union(v.string(), v.null())),
  answer: v.optional(v.union(v.string(), v.null())),
  headline: v.optional(v.union(v.string(), v.null())),
  isoDate: v.optional(v.union(v.string(), v.null())),
  relative: v.optional(v.union(v.boolean(), v.null())),
  capturedAt: v.optional(v.number()),
  waitingSince: v.optional(v.union(v.number(), v.null())),
  lastKind: v.optional(v.string()),
  lastTransitionAt: v.optional(v.number()),
  evaluatedSnapshotId: v.optional(v.id("snapshots")),
  note: v.optional(v.union(v.string(), v.null())),
  truncatedPage: v.optional(v.boolean()),
});

const rowValidator = v.object({
  kind: v.union(v.literal("first"), v.literal("answered"), v.literal("changed"), v.literal("reworded"), v.literal("withdrawn")),
  status: v.union(v.literal("answered"), v.literal("waiting")),
  quote: v.optional(v.string()),
  section: v.optional(v.string()),
  answer: v.optional(v.string()),
  headline: v.optional(v.string()),
  prevQuote: v.optional(v.string()),
  prevAnswer: v.optional(v.string()),
  prevCapturedAt: v.optional(v.number()),
  capturedAt: v.number(),
  snapshotId: v.optional(v.id("snapshots")),
  changeId: v.optional(v.id("changes")),
  retro: v.boolean(),
  factChanged: v.optional(v.number()),
});

// Null in a patch means "clear this field".
function cleanPatch(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(p)) out[k] = val === null ? undefined : val;
  return out;
}

export const saveReading = internalMutation({
  args: {
    questionId: v.id("questions"),
    patch: patchValidator,
    rows: v.array(rowValidator),
    // Guard against a stale worker: only apply if the question was last read
    // from this snapshot (or never read).
    expectEvaluated: v.optional(v.union(v.id("snapshots"), v.null())),
  },
  handler: async (ctx, { questionId, patch, rows, expectEvaluated }) => {
    const q = await ctx.db.get(questionId);
    if (!q) return [];
    if (expectEvaluated !== undefined && (q.evaluatedSnapshotId ?? null) !== expectEvaluated) return [];
    await ctx.db.patch(questionId, cleanPatch(patch));
    const ids: Id<"answers">[] = [];
    for (const r of rows) {
      ids.push(await ctx.db.insert("answers", { ...r, questionId, watchId: q.watchId, boardId: q.boardId, at: Date.now() }));
    }
    return ids;
  },
});

function readingPatch(r: Reading, snap: Snap) {
  return {
    status: r.status,
    quote: r.quote ?? null,
    tableHeader: r.tableHeader ?? null,
    section: r.section ?? null,
    answer: r.answer ?? null,
    headline: r.headline ?? null,
    isoDate: r.isoDate ?? null,
    relative: r.relative ?? null,
    capturedAt: snap.fetchedAt,
    evaluatedSnapshotId: snap._id,
    note: r.note ?? null,
    truncatedPage: snap.truncated,
  };
}

export const evaluateNew = internalAction({
  args: { questionId: v.id("questions"), attempt: v.optional(v.number()) },
  handler: async (ctx, { questionId, attempt }): Promise<void> => {
    const data = await ctx.runQuery(internal.questions.loadForQuestion, { questionId });
    if (!data) return;
    const { question, watch, snapshots } = data;
    if (snapshots.length === 0) {
      await ctx.runMutation(internal.questions.saveReading, {
        questionId,
        patch: { note: "Waiting for Pigeon's first capture of this page." },
        rows: [],
        expectEvaluated: null,
      });
      return;
    }
    const rows: Row[] = [];
    let prev: (Reading & { capturedAt: number }) | undefined;
    let waitingSince: number | undefined;
    let last: Reading | undefined;
    for (const [i, snap] of snapshots.entries()) {
      const r = await readFact(question.text, snap.markdown, snap.title ?? watch.title);
      if (!r) {
        // Model unavailable: try again shortly, a few times.
        const n = (attempt ?? 0) + 1;
        if (n <= 3) await ctx.scheduler.runAfter(30_000 * n, internal.questions.evaluateNew, { questionId, attempt: n });
        await ctx.runMutation(internal.questions.saveReading, {
          questionId,
          patch: {
            note: n <= 3 ? "Pigeon could not reach its reading model; it will try again shortly." : "Pigeon could not reach its reading model; it will read this again at the next check.",
          },
          rows: [],
          expectEvaluated: null,
        });
        return;
      }
      const retro = i < snapshots.length - 1;
      const base = { status: r.status, quote: r.quote, section: r.section, answer: r.answer, headline: r.headline, capturedAt: snap.fetchedAt, snapshotId: snap._id, retro };
      if (!prev) {
        rows.push({ kind: "first", ...base });
      } else {
        const t = F.transition(prev, r);
        const was = { prevQuote: prev.quote, prevAnswer: prev.answer, prevCapturedAt: prev.capturedAt };
        if (t === "answered") rows.push({ kind: "answered", ...base });
        else if (t === "withdrawn") rows.push({ kind: "withdrawn", ...base, ...was });
        else if (t === "quote_changed") {
          const d = await factChanged(question.text, prev as Reading & { quote: string }, r as Reading & { quote: string });
          rows.push({ kind: d.changed ? "changed" : "reworded", ...base, ...was, factChanged: d.p });
        }
      }
      if (r.status === "waiting") waitingSince = waitingSince ?? snap.fetchedAt;
      else waitingSince = undefined;
      prev = { ...r, capturedAt: snap.fetchedAt };
      last = r;
    }
    const latest = snapshots[snapshots.length - 1];
    const lastRow = [...rows].reverse().find((r) => r.kind !== "reworded") ?? rows[0];
    await ctx.runMutation(internal.questions.saveReading, {
      questionId,
      patch: {
        ...readingPatch(last!, latest),
        waitingSince: last!.status === "waiting" ? (waitingSince ?? latest.fetchedAt) : null,
        lastKind: lastRow.kind,
        lastTransitionAt: lastRow.capturedAt,
      },
      rows,
      expectEvaluated: null,
    });
  },
});

// ---------------------------------------------------------------------------
// The page changed: re-read each question and report transitions that deserve
// an email. Called from the check pipeline; returns alert rows.

export const loadForChange = internalQuery({
  args: { watchId: v.id("watches"), snapshotId: v.id("snapshots"), since: v.number() },
  handler: async (ctx, { watchId, snapshotId, since }) => {
    const qs = await ctx.db
      .query("questions")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .collect();
    if (qs.length === 0) return null;
    const snap = await ctx.db.get(snapshotId);
    const watch = await ctx.db.get(watchId);
    if (!snap || !watch) return null;
    const questions = [];
    for (const q of qs) {
      // Answer emails already sent for this question in the last day.
      const recent = await ctx.db
        .query("answers")
        .withIndex("by_question", (x) => x.eq("questionId", q._id).gt("capturedAt", since))
        .collect();
      const recentAlerts = recent.filter((r) => r.changeId && (r.kind === "answered" || r.kind === "changed" || r.kind === "withdrawn")).length;
      questions.push({ ...q, recentAlerts });
    }
    return {
      questions,
      title: watch.title,
      snapshot: { _id: snap._id, markdown: snap.markdown, fetchedAt: snap.fetchedAt, truncated: snap.truncated, title: snap.title } as Snap,
    };
  },
});

export type ChangeReading = {
  // The page holds at least one question.
  hasQuestions: boolean;
  // Every question was read against this capture, so "the answer did not
  // move" is a fact, not a guess. When false, the page's own alert rules apply.
  allRead: boolean;
  // Answer rows that deserve an email.
  alertIds: Id<"answers">[];
  // Answer moves not emailed because the question hit its daily limit.
  capped: number;
};

export async function evaluateForChange(
  ctx: ActionCtx,
  args: { watchId: Id<"watches">; changeId: Id<"changes">; snapshotId: Id<"snapshots">; diff: string; cosmetic: boolean },
): Promise<ChangeReading> {
  const none: ChangeReading = { hasQuestions: false, allRead: false, alertIds: [], capped: 0 };
  const load = () =>
    ctx.runQuery(internal.questions.loadForChange, {
      watchId: args.watchId,
      snapshotId: args.snapshotId,
      since: Date.now() - 24 * 3600_000,
    });
  let data = await load();
  // A question asked moments ago is still being read. Wait briefly for its
  // first reading, so this change is judged against it rather than skipped.
  for (let i = 0; i < 15 && data && data.questions.some((q) => q.status === "evaluating" && !q.note); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    data = await load();
  }
  if (!data) return none;
  const { snapshot } = data;
  const lines = F.pageLines(stabilize(snapshot.markdown));
  const alertIds: Id<"answers">[] = [];
  let allRead = true;
  let capped = 0;
  for (const q of data.questions) {
    if (q.status === "evaluating") {
      // Still reading, or a reading that gave up (it carries a note): start it
      // again from the newest capture, and let the page's own rules decide.
      if (q.note) await ctx.scheduler.runAfter(0, internal.questions.evaluateNew, { questionId: q._id });
      allRead = false;
      continue;
    }
    // Already read from this capture or a newer one (a retried pipeline run).
    if (q.evaluatedSnapshotId === snapshot._id || (q.capturedAt ?? 0) > snapshot.fetchedAt) continue;
    const expect = q.evaluatedSnapshotId ?? null;
    const keep = { evaluatedSnapshotId: snapshot._id, capturedAt: snapshot.fetchedAt, truncatedPage: snapshot.truncated };
    // A cosmetic change cannot move an answer, nor can a change that touches
    // neither the words of an answered question nor its lines. A question the
    // page does not answer yet is re-read on every real change: the line that
    // answers it may use other words.
    const skip = args.cosmetic || (q.status === "answered" && !F.changeIsRelevant(args.diff, q.text, q.quote, lines));
    if (skip) {
      await ctx.runMutation(internal.questions.saveReading, { questionId: q._id, patch: keep, rows: [], expectEvaluated: expect });
      continue;
    }
    const r = await readFact(q.text, snapshot.markdown, snapshot.title ?? data.title, q.quote);
    if (!r) {
      // Model unavailable: keep the old state and let the page's own rules decide.
      allRead = false;
      continue;
    }
    // The line that answered is still on the page, so the fact has not left
    // it: a reading that finds nothing is a miss, not a withdrawal.
    if (q.status === "answered" && r.status === "waiting" && F.quoteStillPresent(lines, q.quote)) {
      await ctx.runMutation(internal.questions.saveReading, { questionId: q._id, patch: keep, rows: [], expectEvaluated: expect });
      continue;
    }
    const prev: Reading & { capturedAt: number } = {
      status: q.status === "answered" ? "answered" : "waiting",
      quote: q.quote,
      answer: q.answer,
      capturedAt: q.capturedAt ?? q.createdAt,
    };
    const t = F.transition(prev, r);
    const base = {
      status: r.status,
      quote: r.quote,
      section: r.section,
      answer: r.answer,
      headline: r.headline,
      capturedAt: snapshot.fetchedAt,
      snapshotId: snapshot._id,
      changeId: args.changeId,
      retro: false,
    };
    const was = { prevQuote: prev.quote, prevAnswer: prev.answer, prevCapturedAt: prev.capturedAt };
    let row: Row | undefined;
    let alert = false;
    if (t === "answered") {
      row = { kind: "answered", ...base };
      alert = true;
    } else if (t === "withdrawn") {
      row = { kind: "withdrawn", ...base, ...was };
      alert = true;
    } else if (t === "quote_changed") {
      const d = await factChanged(q.text, prev as Reading & { quote: string }, r as Reading & { quote: string });
      row = { kind: d.changed ? "changed" : "reworded", ...base, ...was, factChanged: d.p };
      alert = d.changed;
    }
    const patch = {
      ...readingPatch(r, snapshot),
      ...(row && row.kind !== "reworded" ? { lastKind: row.kind, lastTransitionAt: snapshot.fetchedAt } : {}),
      waitingSince: r.status === "waiting" ? (prev.status === "waiting" ? (q.waitingSince ?? q.createdAt) : snapshot.fetchedAt) : null,
    };
    const ids = await ctx.runMutation(internal.questions.saveReading, {
      questionId: q._id,
      patch,
      rows: row ? [row] : [],
      expectEvaluated: expect,
    });
    if (alert && ids.length) {
      if (q.recentAlerts < MAX_ALERTS_PER_DAY) alertIds.push(ids[0]);
      else capped++;
    }
  }
  return { hasQuestions: true, allRead, alertIds, capped };
}

// ---------------------------------------------------------------------------
// First capture of a page: read waiting questions, and propose suggestions.

export const onFirstCapture = internalAction({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }): Promise<void> => {
    const pending = await ctx.runQuery(internal.questions.evaluatingForWatch, { watchId });
    for (const questionId of pending) {
      await ctx.runAction(internal.questions.evaluateNew, { questionId });
    }
    await ctx.runAction(internal.questions.suggest, { watchId, onlyIfNew: true });
  },
});

export const evaluatingForWatch = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) =>
    (
      await ctx.db
        .query("questions")
        .withIndex("by_watch", (q) => q.eq("watchId", watchId))
        .collect()
    )
      .filter((q) => q.status === "evaluating")
      .map((q) => q._id),
});

export const loadForSuggest = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch || !watch.latestSnapshotId) return null;
    const snap = await ctx.db.get(watch.latestSnapshotId);
    if (!snap) return null;
    return { watch, snapshot: { _id: snap._id, markdown: snap.markdown, title: snap.title } };
  },
});

export const saveSuggestions = internalMutation({
  args: {
    watchId: v.id("watches"),
    snapshotId: v.id("snapshots"),
    suggestions: v.array(v.object({ question: v.string(), answer: v.string(), quote: v.string(), section: v.optional(v.string()) })),
    unavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, { watchId, snapshotId, suggestions, unavailable }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return;
    if (unavailable) {
      await ctx.db.patch(watchId, { suggestionsStatus: undefined });
      return;
    }
    await ctx.db.patch(watchId, {
      suggestions,
      suggestionsSnapshotId: snapshotId,
      suggestionsStatus: suggestions.length ? "ready" : "none",
    });
  },
});

// Words that point the reader's attention on long pages.
const SUGGEST_FOCUS =
  "fee fees price cost costs charge pay payment due deadline date dates open opening hours close closed closure available availability required requirement documents apply application aed usd eur gbp egp";

export const suggest = internalAction({
  args: { watchId: v.id("watches"), onlyIfNew: v.optional(v.boolean()) },
  handler: async (ctx, { watchId, onlyIfNew }): Promise<void> => {
    const data = await ctx.runQuery(internal.questions.loadForSuggest, { watchId });
    if (!data) return;
    if (onlyIfNew && data.watch.suggestionsStatus) return;
    const lines = F.pageLines(stabilize(data.snapshot.markdown));
    const shown = F.candidates(lines, SUGGEST_FOCUS, "", 12_000);
    const picks = shown.length ? await suggestQuestions({ numberedPage: F.numbered(shown), title: data.snapshot.title ?? data.watch.title }) : [];
    if (picks === null) {
      // Model unavailable: clear the status so the board offers to try again.
      await ctx.runMutation(internal.questions.saveSuggestions, { watchId, snapshotId: data.snapshot._id, suggestions: [], unavailable: true });
      return;
    }
    const out: Array<{ question: string; answer: string; quote: string; section?: string }> = [];
    const seenQuotes = new Set<string>();
    for (const p of picks) {
      if (out.length >= 3) break;
      if (F.isBoringQuestion(p.question) || p.question.length < 5) continue;
      const sel = { start: p.start, end: p.end };
      if (F.checkSelection(lines, shown, sel)) continue;
      const quote = F.quoteOf(lines, sel);
      if (!F.numbersCovered(p.answer, quote + "\n" + (F.tableHeaderFor(lines, sel.start) ?? "")).ok) continue;
      if (seenQuotes.has(quote)) continue;
      seenQuotes.add(quote);
      out.push({ question: p.question, answer: p.answer, quote, section: F.sectionFor(lines, sel.start) });
    }
    await ctx.runMutation(internal.questions.saveSuggestions, { watchId, snapshotId: data.snapshot._id, suggestions: out });
  },
});
