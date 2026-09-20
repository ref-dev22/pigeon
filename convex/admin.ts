import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Operator tools, only runnable with `npx convex run` on the deployment.
export const demoWatchReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.db.query("watches").collect();
    const out = [];
    for (const w of watches) {
      if (!w.url.includes("/demo/notices")) continue;
      const members = await ctx.db.query("memberships").withIndex("by_board", (q) => q.eq("boardId", w.boardId)).collect();
      out.push({
        id: w._id, url: w.url, interval: w.intervalMinutes, status: w.status, phase: w.demoPhase ?? null,
        checks: w.checkCount, changes: w.changeCount, lastChanged: w.lastChangedAt ? new Date(w.lastChangedAt).toISOString() : null,
        emails: members.map((m) => m.notifyEmail).filter(Boolean),
      });
    }
    return out;
  },
});

export const pauseWatches = internalMutation({
  args: { ids: v.array(v.id("watches")) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) await ctx.db.patch(id, { status: "paused" });
    return ids.length;
  },
});

// Demos whose change was already published keep no value at ten minutes.
export const relaxFinishedDemos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.db.query("watches").collect();
    let n = 0;
    for (const w of watches) {
      if ((w.demoPhase ?? 0) >= 1 && w.intervalMinutes === 10) {
        await ctx.db.patch(w._id, { intervalMinutes: 360 });
        n++;
      }
    }
    return n;
  },
});

// Data health: invariants that should hold on a healthy deployment. Anything
// listed here is a lead, not a verdict; scripts/health-jev.mjs asks the
// decision model to rank them.
export const healthReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const day = 24 * 60 * 60_000;
    const watches = await ctx.db.query("watches").collect();
    const changes = await ctx.db.query("changes").collect();
    const boards = await ctx.db.query("boards").collect();
    const usage = await ctx.db.query("usage").collect();
    const isDemo = (u: string) => u.includes("/demo/notices");

    const staleClaims = watches.filter((w) => w.checkingSince && now - w.checkingSince > 6 * 60_000).map((w) => w._id);
    const overdue = watches.filter((w) => w.status !== "paused" && now - w.nextCheckAt > 30 * 60_000).map((w) => ({ id: w._id, minutesLate: Math.round((now - w.nextCheckAt) / 60_000) }));
    const stuckSummaries = changes.filter((c) => !c.summary && now - c.detectedAt > 10 * 60_000).map((c) => c._id);
    const stuckQueued = changes.filter((c) => c.emailStatus === "queued" && now - c.detectedAt > 6 * 60 * 60_000).map((c) => c._id);
    const fastNonDemo = watches.filter((w) => w.intervalMinutes < 30 && !isDemo(w.url)).map((w) => ({ id: w._id, url: w.url, interval: w.intervalMinutes }));
    const perWatchEmails: Record<string, number> = {};
    for (const c of changes) {
      if ((c.emailStatus === "queued" || c.emailStatus === "sent") && now - c.detectedAt < day) {
        perWatchEmails[c.watchId] = (perWatchEmails[c.watchId] ?? 0) + 1;
      }
    }
    // Paused watches cannot send any more; only live ones are a problem.
    const noisyWatches = Object.entries(perWatchEmails)
      .filter(([id, n]) => n > 3 && watches.find((w) => w._id === id)?.status !== "paused")
      .map(([id, n]) => ({ id, emailsLast24h: n, url: watches.find((w) => w._id === id)?.url }));
    const perBoard: Record<string, number> = {};
    for (const w of watches) perBoard[w.boardId] = (perBoard[w.boardId] ?? 0) + 1;
    const overfullBoards = Object.entries(perBoard).filter(([, n]) => n > 25).map(([id, n]) => ({ id, watches: n }));
    // A page that is not found or refuses access is the visitor's URL, not the
    // system. Only unexplained errors are findings.
    const benign = /not found|refused access|could not be fetched|took too long/i;
    const errors: Record<string, number> = {};
    let benignErrorWatches = 0;
    for (const w of watches) {
      if (w.status !== "error") continue;
      const reason = (w.lastError ?? "unknown").slice(0, 80);
      if (benign.test(reason)) { benignErrorWatches++; continue; }
      errors[reason] = (errors[reason] ?? 0) + 1;
    }
    const today = new Date(now).toISOString().slice(0, 10);
    const scrapesToday = usage.find((u) => u.day === today)?.scrapes ?? 0;
    const failedEmails = changes.filter((c) => c.emailStatus === "failed" && now - c.detectedAt < day).map((c) => ({ id: c._id, reason: (c.emailError ?? "").slice(0, 120) }));
    let boardsWithoutEmail = 0;
    for (const b of boards) {
      const members = await ctx.db.query("memberships").withIndex("by_board", (q) => q.eq("boardId", b._id)).collect();
      if (!members.some((m) => m.notifyEmail)) boardsWithoutEmail++;
    }

    return {
      generatedAt: new Date(now).toISOString(),
      totals: { boards: boards.length, boardsWithoutEmail, watches: watches.length, changes: changes.length, activeWatches: watches.filter((w) => w.status !== "paused").length, benignErrorWatches, scrapesToday, dailyBudget: 700 },
      findings: {
        staleClaims,
        overdueChecks: overdue,
        stuckSummaries,
        stuckQueuedEmails: stuckQueued,
        fastNonDemoWatches: fastNonDemo,
        noisyWatches,
        overfullBoards,
        unexplainedErrorsByReason: errors,
        failedEmailsLast24h: failedEmails,
      },
    };
  },
});

export const latestChangeForWatch = internalQuery({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const c = await ctx.db.query("changes").withIndex("by_watch", (q) => q.eq("watchId", watchId)).order("desc").first();
    if (!c) return null;
    return { id: c._id, importance: c.importance, summary: c.summary, emailStatus: c.emailStatus, emailError: c.emailError, detectedAt: new Date(c.detectedAt).toISOString() };
  },
});

// Boards where nobody saved an alert email get nothing from scraping. After a
// day their watches are paused with a note; saving an email and pressing
// resume brings them back. Runs daily from crons.ts; `olderThanMs: 0` pauses
// every such board right now (operator use).
export const expireIdleGuestWatches = internalMutation({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, { olderThanMs }) => {
    const cutoff = Date.now() - (olderThanMs ?? 24 * 60 * 60_000);
    const boards = await ctx.db.query("boards").collect();
    let pausedWatches = 0;
    let boardsTouched = 0;
    for (const board of boards) {
      if (board.createdAt > cutoff) continue;
      const members = await ctx.db.query("memberships").withIndex("by_board", (q) => q.eq("boardId", board._id)).collect();
      let hasEmail = false;
      for (const m of members) {
        if (m.notifyEmail) { hasEmail = true; break; }
        const u = await ctx.db.get(m.userId);
        if (u?.email) { hasEmail = true; break; }
      }
      if (hasEmail) continue;
      const watches = await ctx.db.query("watches").withIndex("by_board", (q) => q.eq("boardId", board._id)).collect();
      const active = watches.filter((w) => w.status !== "paused");
      if (active.length === 0) continue;
      for (const w of active) {
        await ctx.db.patch(w._id, { status: "paused" });
        pausedWatches++;
      }
      boardsTouched++;
      await ctx.db.insert("events", {
        boardId: board._id,
        kind: "watch.paused",
        message: "Paused all pages: no alert email was saved on this board within a day. Save an email in the board panel and resume any page.",
        at: Date.now(),
      });
    }
    return { boardsTouched, pausedWatches };
  },
});
