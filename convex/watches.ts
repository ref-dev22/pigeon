import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { clampInterval, DEFAULT_INTERVAL, DEMO_FAST_WINDOW_MS, isPerBoardDemo, normalizeUrl, requireMember } from "./lib";

const MAX_WATCHES_PER_BOARD = 25;
const MAX_CONCURRENT_SCRAPES = 3;

// Public queries take ids as strings and normalise them: a mistyped or truncated
// link must show "not found", never a thrown error.
export const listWatches = query({
  args: { boardId: v.string() },
  handler: async (ctx, args) => {
    const boardId = ctx.db.normalizeId("boards", args.boardId);
    if (!boardId) return [];
    if (!(await requireMember(ctx, boardId).catch(() => null))) return [];
    const watches = await ctx.db
      .query("watches")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    const out = [];
    for (const w of watches) {
      const latestChange = await ctx.db
        .query("changes")
        .withIndex("by_watch", (q) => q.eq("watchId", w._id))
        .order("desc")
        .first();
      out.push({
        ...w,
        latestChange: latestChange
          ? {
              _id: latestChange._id,
              summary: latestChange.summary ?? null,
              importance: latestChange.importance ?? null,
              detectedAt: latestChange.detectedAt,
              addedLines: latestChange.addedLines,
              removedLines: latestChange.removedLines,
              emailStatus: latestChange.emailStatus,
              emailError: latestChange.emailError ?? null,
            }
          : null,
      });
    }
    return out.sort(
      (a, b) => (b.lastChangedAt ?? b.createdAt) - (a.lastChangedAt ?? a.createdAt),
    );
  },
});

export const getWatch = query({
  args: { watchId: v.string() },
  handler: async (ctx, args) => {
    const watchId = ctx.db.normalizeId("watches", args.watchId);
    if (!watchId) return null;
    const watch = await ctx.db.get(watchId);
    if (!watch) return null;
    if (!(await requireMember(ctx, watch.boardId).catch(() => null))) return null;
    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .order("desc")
      .take(10);
    const changes = await ctx.db
      .query("changes")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .order("desc")
      .take(20);
    const latest = snapshots[0];
    return {
      watch,
      latestMarkdown: latest?.markdown ?? null,
      latestFetchedAt: latest?.fetchedAt ?? null,
      snapshots: snapshots.map((s) => ({
        _id: s._id,
        fetchedAt: s.fetchedAt,
        title: s.title ?? null,
        length: s.markdown.length,
      })),
      changes,
    };
  },
});

export const listChanges = query({
  args: { boardId: v.string() },
  handler: async (ctx, args) => {
    const boardId = ctx.db.normalizeId("boards", args.boardId);
    if (!boardId) return [];
    const access = await requireMember(ctx, boardId).catch(() => null);
    if (!access) return [];
    const { userId } = access;
    const changes = await ctx.db
      .query("changes")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .order("desc")
      .take(50);
    const out = [];
    for (const c of changes) {
      const w = await ctx.db.get(c.watchId);
      out.push({
        ...c,
        isRead: c.readBy.includes(userId),
        watchTitle: w?.title ?? w?.url ?? "Removed page",
        watchUrl: w?.url ?? null,
      });
    }
    return out;
  },
});

export const getChange = query({
  args: { changeId: v.string() },
  handler: async (ctx, args) => {
    const changeId = ctx.db.normalizeId("changes", args.changeId);
    if (!changeId) return null;
    const change = await ctx.db.get(changeId);
    if (!change) return null;
    if (!(await requireMember(ctx, change.boardId).catch(() => null))) return null;
    const watch = await ctx.db.get(change.watchId);
    const to = await ctx.db.get(change.toSnapshotId);
    const from = change.fromSnapshotId ? await ctx.db.get(change.fromSnapshotId) : null;
    return {
      change,
      watch,
      before: from?.markdown ?? null,
      after: to?.markdown ?? null,
    };
  },
});

export const addWatch = mutation({
  args: {
    boardId: v.id("boards"),
    url: v.string(),
    intervalMinutes: v.optional(v.number()),
    focus: v.optional(v.string()),
  },
  handler: async (ctx, { boardId, url, intervalMinutes, focus }) => {
    const { userId } = await requireMember(ctx, boardId);
    let normalized: string;
    try {
      normalized = normalizeUrl(url);
    } catch {
      throw new ConvexError("That is not a valid web address.");
    }
    const existing = await ctx.db
      .query("watches")
      .withIndex("by_board_url", (q) => q.eq("boardId", boardId).eq("url", normalized))
      .unique();
    if (existing) return existing._id;
    const count = (
      await ctx.db
        .query("watches")
        .withIndex("by_board", (q) => q.eq("boardId", boardId))
        .collect()
    ).length;
    if (count >= MAX_WATCHES_PER_BOARD) {
      throw new ConvexError("A board can watch up to " + MAX_WATCHES_PER_BOARD + " pages.");
    }
    const now = Date.now();
    const watchId = await ctx.db.insert("watches", {
      boardId,
      url: normalized,
      intervalMinutes: clampInterval(intervalMinutes ?? DEFAULT_INTERVAL, normalized),
      focus: focus?.trim() ? focus.trim().slice(0, 200) : undefined,
      addedBy: userId,
      source: "web",
      status: "pending",
      nextCheckAt: now,
      checkCount: 0,
      changeCount: 0,
      createdAt: now,
    });
    await ctx.db.insert("events", {
      boardId,
      kind: "watch.added",
      message: "Started watching " + normalized,
      watchId,
      at: now,
    });
    await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
    return watchId;
  },
});

// One fictional demo notice per board, checked through the real pipeline.
// Idempotent: a second click returns the existing watch.
export const createDemoWatch = mutation({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const { userId } = await requireMember(ctx, boardId);
    const existing = (
      await ctx.db
        .query("watches")
        .withIndex("by_board", (q) => q.eq("boardId", boardId))
        .collect()
    ).find((w) => w.url.includes("/demo/notices?watch="));
    if (existing) return existing._id;
    const site = (process.env.APP_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
    const now = Date.now();
    const watchId = await ctx.db.insert("watches", {
      boardId,
      url: site + "/demo/notices",
      intervalMinutes: 10,
      focus: "fees, dates or closures",
      addedBy: userId,
      source: "web",
      status: "pending",
      nextCheckAt: now,
      checkCount: 0,
      changeCount: 0,
      createdAt: now,
      demoPhase: 0,
    });
    await ctx.db.patch(watchId, { url: site + "/demo/notices?watch=" + watchId });
    await ctx.db.insert("events", {
      boardId,
      kind: "watch.added",
      message: "Started watching the demo notice board (fictional page, real pipeline).",
      watchId,
      at: now,
    });
    await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
    // SPEC-014: ten-minute checks are for the first hour only.
    await ctx.scheduler.runAfter(DEMO_FAST_WINDOW_MS, internal.watches.relaxUnpublishedDemo, { watchId });
    return watchId;
  },
});

// Flip the demo notice to its changed version and check it right away.
// step "cosmetic": phase 0 -> 1, a reworded sentence the pipeline should
// ignore. step "fee": phase 0 or 1 -> 2, the change that matters (SPEC-017).
export const publishDemoChange = mutation({
  args: { watchId: v.id("watches"), step: v.optional(v.union(v.literal("cosmetic"), v.literal("fee"))) },
  handler: async (ctx, { watchId, step }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new ConvexError("Watch not found.");
    await requireMember(ctx, watch.boardId);
    if (!watch.url.includes("/demo/notices?watch=")) throw new ConvexError("Not a demo page.");
    const phase = watch.demoPhase ?? 0;
    const which = step ?? "fee";
    if (phase >= 2) return;
    if (which === "cosmetic" && phase >= 1) return;
    if (!watch.latestSnapshotId) throw new ConvexError("Still capturing the original notice. Try again in a few seconds.");
    if (watch.checkingSince && Date.now() - watch.checkingSince < 6 * 60_000) {
      throw new ConvexError("A check is running. Try again in a few seconds.");
    }
    if (which === "cosmetic") {
      await ctx.db.patch(watchId, { demoPhase: 1, ...(watch.status === "paused" ? { status: "ok" as const } : {}) });
      await ctx.db.insert("events", {
        boardId: watch.boardId,
        kind: "demo.published",
        message: "Demo notice edited cosmetically: one sentence reworded, timestamp and visitor count changed. Nothing that matters.",
        watchId,
        at: Date.now(),
      });
      await ctx.scheduler.runAfter(1500, internal.checks.checkWatch, { watchId });
      return;
    }
    // The demo is done after this check: fall back to a normal interval so the
    // page is not scraped every ten minutes for ever. A demo paused by the
    // daily expiry is resumed, otherwise the scheduled check would refuse to run.
    await ctx.db.patch(watchId, {
      demoPhase: 2,
      intervalMinutes: DEFAULT_INTERVAL,
      ...(watch.status === "paused" ? { status: "ok" as const } : {}),
    });
    await ctx.db.insert("events", {
      boardId: watch.boardId,
      kind: "demo.published",
      message: "Demo notice changed: fee AED 1,000 → 1,500, deadline 15 → 10 October, hall closure added.",
      watchId,
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(1500, internal.checks.checkWatch, { watchId });
  },
});

export const checkNow = mutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new ConvexError("Watch not found.");
    await requireMember(ctx, watch.boardId);
    const now = Date.now();
    // A check already running, or one finished under a minute ago, is answer
    // enough: tell the caller instead of failing the click.
    if (watch.checkingSince && now - watch.checkingSince < 6 * 60_000) return "running" as const;
    if (watch.lastCheckedAt && now - watch.lastCheckedAt < 60_000) return "fresh" as const;
    await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
    return "scheduled" as const;
  },
});

export const updateWatch = mutation({
  args: {
    watchId: v.id("watches"),
    intervalMinutes: v.optional(v.number()),
    focus: v.optional(v.string()),
    paused: v.optional(v.boolean()),
  },
  handler: async (ctx, { watchId, intervalMinutes, focus, paused }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new ConvexError("Watch not found.");
    await requireMember(ctx, watch.boardId);
    const patch: Record<string, unknown> = {};
    if (intervalMinutes !== undefined) {
      const demoEligible =
        isPerBoardDemo(watch.url) && (watch.demoPhase ?? 0) < 2 && Date.now() - watch.createdAt < DEMO_FAST_WINDOW_MS;
      const minutes = clampInterval(intervalMinutes, watch.url, { demoEligible });
      patch.intervalMinutes = minutes;
      // Reschedule so a shorter interval takes effect now, not after the old one.
      const base = watch.lastCheckedAt ?? watch.createdAt;
      patch.nextCheckAt = Math.min(watch.nextCheckAt, base + minutes * 60_000);
    }
    if (focus !== undefined) patch.focus = focus.trim() ? focus.trim().slice(0, 200) : undefined;
    if (paused !== undefined) {
      patch.status = paused ? "paused" : "ok";
      if (!paused) patch.nextCheckAt = Date.now();
    }
    await ctx.db.patch(watchId, patch);
  },
});

export const removeWatch = mutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return;
    await requireMember(ctx, watch.boardId);
    const snaps = await ctx.db
      .query("snapshots")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .collect();
    for (const r of snaps) await ctx.db.delete(r._id);
    const changes = await ctx.db
      .query("changes")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .collect();
    for (const r of changes) await ctx.db.delete(r._id);
    await ctx.db.delete(watchId);
    await ctx.db.insert("events", {
      boardId: watch.boardId,
      kind: "watch.removed",
      message: "Stopped watching " + (watch.title ?? watch.url),
      at: Date.now(),
    });
  },
});

export const markRead = mutation({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    const change = await ctx.db.get(changeId);
    if (!change) return;
    const { userId } = await requireMember(ctx, change.boardId);
    if (!change.readBy.includes(userId)) {
      await ctx.db.patch(changeId, { readBy: [...change.readBy, userId] });
    }
  },
});

// ---------- internal plumbing used by the check pipeline ----------

export const getChangeInternal = internalQuery({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => await ctx.db.get(changeId),
});

export const getWatchInternal = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return null;
    const latest = watch.latestSnapshotId ? await ctx.db.get(watch.latestSnapshotId) : null;
    return { watch, latest };
  },
});

// Scrapes allowed per UTC day across the whole deployment (Firecrawl's free
// tier is 1,000 credits a month plus hackathon credits; this keeps a runaway
// guest from spending them all).
// Firecrawl free tier is 1,000 scrapes a MONTH (renews 19 Oct 2026). Kept low
// through judging so the demo always has credit.
const DAILY_SCRAPE_BUDGET = 40;

// Claim a check so two triggers (cron plus "Check now") never scrape twice,
// and spend one unit of the daily budget. Returns the claim token (a
// timestamp) to pass back on completion, or null when the check must not run.
export const claimCheck = internalMutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch || watch.status === "paused") return null;
    const now = Date.now();
    // Claims outlive the longest possible scrape (four Firecrawl attempts).
    if (watch.checkingSince && now - watch.checkingSince < 6 * 60_000) return null;
    // Firecrawl rate-limits bursts. At most a few scrapes run at once across
    // the deployment; the rest wait a few seconds and try again.
    const active = (await ctx.db.query("watches").withIndex("by_nextCheck").collect()).filter(
      (w) => w._id !== watchId && w.checkingSince && now - w.checkingSince < 90_000,
    ).length;
    if (active >= MAX_CONCURRENT_SCRAPES) return "busy" as const;
    const day = new Date(now).toISOString().slice(0, 10);
    const meter = await ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    // The judge demo is small and essential; it is counted but never refused.
    if ((meter?.scrapes ?? 0) >= DAILY_SCRAPE_BUDGET && !isPerBoardDemo(watch.url)) {
      // Out of budget for today: push the check to tomorrow, do not scrape.
      await ctx.db.patch(watchId, { nextCheckAt: now + 60 * 60_000, lastError: "Daily check budget reached; retrying later." });
      return null;
    }
    if (meter) await ctx.db.patch(meter._id, { scrapes: meter.scrapes + 1 });
    else await ctx.db.insert("usage", { day, scrapes: 1 });
    await ctx.db.patch(watchId, { checkingSince: now });
    return now;
  },
});

// Changes that were recorded but never summarised or emailed (for example
// because a model call hung until the action was cut off).
export const pendingChanges = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const rows = await ctx.db
      .query("changes")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId))
      .order("desc")
      .take(5);
    return rows
      .filter((c) => c.summary === undefined && Date.now() - c.detectedAt > 90_000)
      .map((c) => ({ _id: c._id, diff: c.diff, addedLines: c.addedLines, removedLines: c.removedLines }));
  },
});

export const dueWatches = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const out: Array<{ id: Id<"watches">; due: number }> = [];
    for (const status of ["ok", "pending", "error"] as const) {
      const rows = await ctx.db
        .query("watches")
        .withIndex("by_nextCheck", (q) => q.eq("status", status).lte("nextCheckAt", now))
        .take(limit);
      out.push(...rows.map((r) => ({ id: r._id, due: r.nextCheckAt })));
    }
    // Fair across statuses: the most overdue first, whatever its state.
    return out
      .sort((a, b) => a.due - b.due)
      .slice(0, limit)
      .map((r) => r.id);
  },
});

export const recordSnapshot = internalMutation({
  args: {
    watchId: v.id("watches"),
    markdown: v.string(),
    contentHash: v.string(),
    title: v.optional(v.string()),
    truncated: v.boolean(),
    firecrawlChangeStatus: v.optional(v.string()),
    firecrawlPreviousScrapeAt: v.optional(v.string()),
    claim: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (!watch) return null;
    // A worker whose claim was superseded must not write a snapshot.
    if (args.claim !== undefined && watch.checkingSince !== undefined && watch.checkingSince !== args.claim) return null;
    const snapshotId = await ctx.db.insert("snapshots", {
      watchId: args.watchId,
      boardId: watch.boardId,
      markdown: args.markdown,
      contentHash: args.contentHash,
      title: args.title,
      fetchedAt: Date.now(),
      truncated: args.truncated,
      firecrawlChangeStatus: args.firecrawlChangeStatus,
      firecrawlPreviousScrapeAt: args.firecrawlPreviousScrapeAt,
    });
    // Keep at most 12 snapshots per page so storage stays bounded.
    const all = await ctx.db
      .query("snapshots")
      .withIndex("by_watch", (q) => q.eq("watchId", args.watchId))
      .order("desc")
      .collect();
    for (const old of all.slice(12)) {
      await ctx.db.delete(old._id);
    }
    return snapshotId;
  },
});

export const recordChange = internalMutation({
  args: {
    watchId: v.id("watches"),
    fromSnapshotId: v.optional(v.id("snapshots")),
    toSnapshotId: v.id("snapshots"),
    diff: v.string(),
    addedLines: v.number(),
    removedLines: v.number(),
    claim: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (!watch) return null;
    if (args.claim !== undefined && watch.checkingSince !== undefined && watch.checkingSince !== args.claim) return null;
    const now = Date.now();
    const changeId = await ctx.db.insert("changes", {
      watchId: args.watchId,
      boardId: watch.boardId,
      fromSnapshotId: args.fromSnapshotId,
      toSnapshotId: args.toSnapshotId,
      diff: args.diff,
      addedLines: args.addedLines,
      removedLines: args.removedLines,
      detectedAt: now,
      emailStatus: "pending",
      readBy: [],
    });
    await ctx.db.patch(args.watchId, {
      lastChangedAt: now,
      changeCount: watch.changeCount + 1,
    });
    // Keep at most 50 changes per page so storage and deletes stay bounded.
    const history = await ctx.db
      .query("changes")
      .withIndex("by_watch", (q) => q.eq("watchId", args.watchId))
      .order("desc")
      .collect();
    for (const old of history.slice(50)) await ctx.db.delete(old._id);
    await ctx.db.insert("events", {
      boardId: watch.boardId,
      kind: "page.changed",
      message:
        (watch.title ?? watch.url) +
        " changed (+" +
        args.addedLines +
        " / -" +
        args.removedLines +
        " lines).",
      watchId: args.watchId,
      changeId,
      at: now,
    });
    return changeId;
  },
});

// Alerts already sent for this page in the last 24 hours, newest first.
export const recentAlerts = internalQuery({
  args: { watchId: v.id("watches"), exceptChangeId: v.id("changes") },
  handler: async (ctx, { watchId, exceptChangeId }) => {
    const since = Date.now() - 24 * 60 * 60_000;
    const recent = await ctx.db
      .query("changes")
      .withIndex("by_watch", (q) => q.eq("watchId", watchId).gt("detectedAt", since))
      .collect();
    const emailed = recent
      .filter((c) => c._id !== exceptChangeId && (c.emailStatus === "queued" || c.emailStatus === "sent"))
      .sort((a, b) => b.detectedAt - a.detectedAt);
    return {
      count: emailed.length,
      lastSummaries: emailed.slice(0, 3).map((c) => c.summary ?? "").filter((s) => s.length > 0),
    };
  },
});

// SPEC-014: an hour after creation, an unpublished demo falls back to the
// default interval. Nothing else changes: not the status, phase, baseline or a
// running claim, and no scrape is started here.
export const relaxUnpublishedDemo = internalMutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const w = await ctx.db.get(watchId);
    if (!w || !isPerBoardDemo(w.url)) return false;
    if ((w.demoPhase ?? 0) >= 2 || w.intervalMinutes !== 10) return false;
    if (Date.now() - w.createdAt < DEMO_FAST_WINDOW_MS) return false;
    const base = w.lastCheckedAt ?? w.createdAt;
    await ctx.db.patch(watchId, {
      intervalMinutes: DEFAULT_INTERVAL,
      nextCheckAt: Math.max(w.nextCheckAt, base + DEFAULT_INTERVAL * 60_000),
    });
    return true;
  },
});

export const setSummary = internalMutation({
  args: {
    changeId: v.id("changes"),
    summary: v.string(),
    importance: v.number(),
    summarySource: v.union(v.literal("model"), v.literal("heuristic")),
  },
  handler: async (ctx, { changeId, ...rest }) => {
    await ctx.db.patch(changeId, rest);
  },
});

export const finishCheck = internalMutation({
  args: {
    watchId: v.id("watches"),
    claim: v.optional(v.number()),
    status: v.union(v.literal("ok"), v.literal("error")),
    lastError: v.optional(v.string()),
    // A transient failure (rate limit, timeout): keep the page's status, note
    // the reason, and try again soon instead of waiting a full interval.
    retryInMs: v.optional(v.number()),
    title: v.optional(v.string()),
    latestSnapshotId: v.optional(v.id("snapshots")),
  },
  handler: async (ctx, { watchId, claim, status, lastError, title, latestSnapshotId, retryInMs }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return;
    // A worker whose claim has been superseded must not overwrite state.
    if (claim !== undefined && watch.checkingSince !== undefined && watch.checkingSince !== claim) return;
    const now = Date.now();
    // Back off on repeated errors so a dead page does not burn credits.
    if (retryInMs !== undefined) {
      await ctx.db.patch(watchId, {
        checkingSince: undefined,
        lastCheckedAt: now,
        nextCheckAt: now + retryInMs,
        lastError,
        status: watch.status === "paused" ? "paused" : watch.status === "ok" ? "ok" : "pending",
      });
      return;
    }
    const interval = watch.intervalMinutes * 60_000;
    const next =
      status === "error" ? now + Math.max(interval, 30 * 60_000) : now + interval;
    await ctx.db.patch(watchId, {
      // A pause requested while the check was running wins.
      status: watch.status === "paused" ? "paused" : status,
      lastError: status === "error" ? lastError : undefined,
      checkingSince: undefined,
      lastCheckedAt: now,
      nextCheckAt: next,
      checkCount: watch.checkCount + 1,
      ...(title ? { title } : {}),
      ...(latestSnapshotId ? { latestSnapshotId } : {}),
    });
  },
});
