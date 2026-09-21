import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

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

// One-off backfill for SPEC-014: relax unpublished demos older than an hour
// and schedule the timer for younger ones.
export const backfillDemoTimers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.db.query("watches").collect();
    let relaxed = 0;
    let scheduled = 0;
    for (const w of watches) {
      if (!w.url.includes("/demo/notices?watch=") || (w.demoPhase ?? 0) !== 0 || w.intervalMinutes !== 10) continue;
      const age = Date.now() - w.createdAt;
      if (age >= 60 * 60_000) {
        const base = w.lastCheckedAt ?? w.createdAt;
        await ctx.db.patch(w._id, { intervalMinutes: 360, nextCheckAt: Math.max(w.nextCheckAt, base + 360 * 60_000) });
        relaxed++;
      } else {
        await ctx.scheduler.runAfter(60 * 60_000 - age, internal.watches.relaxUnpublishedDemo, { watchId: w._id });
        scheduled++;
      }
    }
    return { relaxed, scheduled };
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
      totals: { boards: boards.length, boardsWithoutEmail, watches: watches.length, changes: changes.length, activeWatches: watches.filter((w) => w.status !== "paused").length, benignErrorWatches, scrapesToday, dailyBudget: 40 },
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

// Who has used the app: boards by creation day, whether an email was saved,
// pages added, and whether any page is not one of our own fixtures.
export const usageReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const boards = await ctx.db.query("boards").collect();
    const watches = await ctx.db.query("watches").collect();
    const own = (u: string) => /marvelous-dinosaur-465\.convex\.site/.test(u);
    const rows = [];
    for (const b of boards) {
      const members = await ctx.db.query("memberships").withIndex("by_board", (q) => q.eq("boardId", b._id)).collect();
      const emails = members.map((m) => m.notifyEmail).filter(Boolean) as string[];
      const ws = watches.filter((w) => w.boardId === b._id);
      rows.push({
        created: new Date(b.createdAt).toISOString().slice(0, 16).replace("T", " "),
        name: b.name,
        members: members.length,
        emailDomains: emails.map((e) => e.split("@")[1]),
        pages: ws.length,
        externalPages: ws.filter((w) => !own(w.url)).map((w) => ({ url: w.url.slice(0, 70), status: w.status, checks: w.checkCount, changes: w.changeCount, title: w.title ?? null, lastError: w.lastError ?? null })),
        demo: ws.filter((w) => own(w.url)).map((w) => ({ phase: w.demoPhase ?? null, checks: w.checkCount, changes: w.changeCount, status: w.status })),
        source: ws.map((w) => w.source),
      });
    }
    rows.sort((a, b) => (a.created < b.created ? 1 : -1));
    return rows;
  },
});

// SPEC-017 backfill: demos published under the two-phase scheme (phase 1 meant
// "fee change published") become phase 2 so they read as finished.
export const backfillDemoPhases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.db.query("watches").collect();
    let n = 0;
    for (const w of watches) {
      if (w.url.includes("/demo/notices?watch=") && w.demoPhase === 1 && w.intervalMinutes !== 10) {
        await ctx.db.patch(w._id, { demoPhase: 2 });
        n++;
      }
    }
    return n;
  },
});

// Test hook for SPEC-014 acceptance: relax one demo regardless of age.
export const forceRelaxDemo = internalMutation({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }) => {
    const w = await ctx.db.get(watchId);
    if (!w || !w.url.includes("/demo/notices?watch=") || (w.demoPhase ?? 0) !== 0) return false;
    const base = w.lastCheckedAt ?? w.createdAt;
    await ctx.db.patch(watchId, { intervalMinutes: 360, nextCheckAt: Math.max(w.nextCheckAt, base + 360 * 60_000) });
    return true;
  },
});

export const inviteLinkFor = internalQuery({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const b = await ctx.db.get(boardId);
    return b ? (process.env.APP_URL ?? "") + "/#/join/" + b.inviteCode : null;
  },
});

// Per-board test matrix: every watch with its latest outcome.
export const boardReport = internalQuery({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const watches = await ctx.db.query("watches").withIndex("by_board", (q) => q.eq("boardId", boardId)).collect();
    const out = [];
    for (const w of watches) {
      const changes = await ctx.db.query("changes").withIndex("by_watch", (q) => q.eq("watchId", w._id)).order("desc").take(3);
      out.push({
        id: w._id, url: w.url, title: w.title ?? null, status: w.status, lastError: w.lastError ?? null,
        checks: w.checkCount, changes: w.changeCount,
        recent: changes.map((c) => ({ importance: c.importance ?? null, email: c.emailStatus, reason: c.emailError ?? null, lines: "+" + c.addedLines + "/-" + c.removedLines, summary: (c.summary ?? "").slice(0, 220) })),
      });
    }
    return out;
  },
});

export const checkAll = internalMutation({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const watches = await ctx.db.query("watches").withIndex("by_board", (q) => q.eq("boardId", boardId)).collect();
    let n = 0;
    for (const w of watches) {
      if (w.status === "paused") continue;
      await ctx.scheduler.runAfter(n * 1500, internal.checks.checkWatch, { watchId: w._id });
      n++;
    }
    return n;
  },
});

// Operator: set every active watch on a board to one interval; pause errored ones if asked.
export const setBoardInterval = internalMutation({
  args: { boardId: v.id("boards"), intervalMinutes: v.number(), pauseErrors: v.optional(v.boolean()) },
  handler: async (ctx, { boardId, intervalMinutes, pauseErrors }) => {
    const watches = await ctx.db.query("watches").withIndex("by_board", (q) => q.eq("boardId", boardId)).collect();
    let n = 0;
    for (const w of watches) {
      if (pauseErrors && w.status === "error") { await ctx.db.patch(w._id, { status: "paused" }); n++; continue; }
      if (w.status === "paused") continue;
      const base = w.lastCheckedAt ?? w.createdAt;
      await ctx.db.patch(w._id, { intervalMinutes, nextCheckAt: base + intervalMinutes * 60_000 });
      n++;
    }
    return n;
  },
});

export const usageByDay = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("usage").collect()).map((u) => ({ day: u.day, scrapes: u.scrapes })).sort((a, b) => (a.day < b.day ? -1 : 1)),
});

// Emergency brake: pause every active watch on the deployment.
export const pauseAllWatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const watches = await ctx.db.query("watches").collect();
    let n = 0;
    for (const w of watches) if (w.status !== "paused") { await ctx.db.patch(w._id, { status: "paused" }); n++; }
    return n;
  },
});
