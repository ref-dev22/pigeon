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
    const noisyWatches = Object.entries(perWatchEmails).filter(([, n]) => n > 3).map(([id, n]) => ({ id, emailsLast24h: n, url: watches.find((w) => w._id === id)?.url }));
    const perBoard: Record<string, number> = {};
    for (const w of watches) perBoard[w.boardId] = (perBoard[w.boardId] ?? 0) + 1;
    const overfullBoards = Object.entries(perBoard).filter(([, n]) => n > 25).map(([id, n]) => ({ id, watches: n }));
    const errors: Record<string, number> = {};
    for (const w of watches) if (w.status === "error") errors[(w.lastError ?? "unknown").slice(0, 80)] = (errors[(w.lastError ?? "unknown").slice(0, 80)] ?? 0) + 1;
    const today = new Date(now).toISOString().slice(0, 10);
    const scrapesToday = usage.find((u) => u.day === today)?.scrapes ?? 0;
    const failedEmails = changes.filter((c) => c.emailStatus === "failed" && now - c.detectedAt < day).map((c) => ({ id: c._id, reason: (c.emailError ?? "").slice(0, 120) }));

    return {
      generatedAt: new Date(now).toISOString(),
      totals: { boards: boards.length, watches: watches.length, changes: changes.length, activeWatches: watches.filter((w) => w.status !== "paused").length, scrapesToday, dailyBudget: 700 },
      findings: {
        staleClaims,
        overdueChecks: overdue,
        stuckSummaries,
        stuckQueuedEmails: stuckQueued,
        fastNonDemoWatches: fastNonDemo,
        noisyWatches,
        overfullBoards,
        errorWatchesByReason: errors,
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
