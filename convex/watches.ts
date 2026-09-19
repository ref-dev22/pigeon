import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { clampInterval, DEFAULT_INTERVAL, normalizeUrl, requireMember } from "./lib";

const MAX_WATCHES_PER_BOARD = 25;

export const listWatches = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    await requireMember(ctx, boardId);
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
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return null;
    await requireMember(ctx, watch.boardId);
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
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const { userId } = await requireMember(ctx, boardId);
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
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    const change = await ctx.db.get(changeId);
    if (!change) return null;
    await requireMember(ctx, change.boardId);
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
      throw new Error("That is not a valid web address.");
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
      throw new Error("A board can watch up to " + MAX_WATCHES_PER_BOARD + " pages.");
    }
    const now = Date.now();
    const watchId = await ctx.db.insert("watches", {
      boardId,
      url: normalized,
      intervalMinutes: clampInterval(intervalMinutes ?? DEFAULT_INTERVAL),
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

export const checkNow = mutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) throw new Error("Watch not found.");
    await requireMember(ctx, watch.boardId);
    // Rate-limit manual checks to one a minute per page.
    if (watch.lastCheckedAt && Date.now() - watch.lastCheckedAt < 60_000) {
      throw new Error("Checked less than a minute ago. Give it a moment.");
    }
    await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
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
    if (!watch) throw new Error("Watch not found.");
    await requireMember(ctx, watch.boardId);
    const patch: Record<string, unknown> = {};
    if (intervalMinutes !== undefined) patch.intervalMinutes = clampInterval(intervalMinutes);
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

export const getWatchInternal = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return null;
    const latest = watch.latestSnapshotId ? await ctx.db.get(watch.latestSnapshotId) : null;
    return { watch, latest };
  },
});

export const dueWatches = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const out = [];
    for (const status of ["ok", "pending", "error"] as const) {
      const rows = await ctx.db
        .query("watches")
        .withIndex("by_nextCheck", (q) => q.eq("status", status).lte("nextCheckAt", now))
        .take(limit);
      out.push(...rows.map((r) => r._id));
    }
    return out.slice(0, limit);
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
  },
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (!watch) return null;
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
  },
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (!watch) return null;
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
    status: v.union(v.literal("ok"), v.literal("error")),
    lastError: v.optional(v.string()),
    title: v.optional(v.string()),
    latestSnapshotId: v.optional(v.id("snapshots")),
  },
  handler: async (ctx, { watchId, status, lastError, title, latestSnapshotId }) => {
    const watch = await ctx.db.get(watchId);
    if (!watch) return;
    const now = Date.now();
    // Back off on repeated errors so a dead page does not burn credits.
    const interval = watch.intervalMinutes * 60_000;
    const next =
      status === "error" ? now + Math.max(interval, 6 * 60 * 60_000) : now + interval;
    await ctx.db.patch(watchId, {
      status,
      lastError: status === "error" ? lastError : undefined,
      lastCheckedAt: now,
      nextCheckAt: next,
      checkCount: watch.checkCount + 1,
      ...(title ? { title } : {}),
      ...(latestSnapshotId ? { latestSnapshotId } : {}),
    });
  },
});
