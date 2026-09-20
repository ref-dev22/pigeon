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
