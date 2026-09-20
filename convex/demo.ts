import { v } from "convex/values";
import { httpAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// A public notice page served by the app at /demo/notices so anyone can
// watch a page and see a real alert without waiting for the world to change.
//
// Two modes:
//   /demo/notices              rewrites one or two notices every six hours
//                              (deterministic from the clock).
//   /demo/notices?watch=<id>   a fixed fictional notice tied to one watch;
//                              its content flips once when the board owner
//                              clicks "Publish a fee and deadline change".

// Six hours: often enough to show unattended change detection, rare enough
// that a real watcher is not emailed all day.
const WINDOW_MS = 6 * 60 * 60_000;

const POOL = [
  "The main pool is open daily from 07:00 to 21:00.",
  "The main pool is closed on Tuesday for cleaning; it reopens Wednesday at 07:00.",
  "The main pool is open daily from 07:00 to 22:00 during the holidays.",
  "The main pool is closed until further notice for pump repairs.",
];
const PARKING = [
  "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 250 per vehicle.",
  "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 300 per vehicle, payable by 15 October.",
  "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 300 per vehicle, payable by 10 October (deadline moved forward).",
  "Parking permit applications are now closed. Late applications carry a AED 100 surcharge.",
];
const GYM = [
  "The gym opens 06:00 to 22:00 every day.",
  "The gym closes at 20:00 on weekdays from next month; weekend hours are unchanged.",
  "The gym is closed this Friday morning for equipment servicing.",
  "The gym opens 06:00 to 22:00 every day. New treadmills have been installed.",
];
const EXTRA = [
  "",
  "Reminder: the annual fire-safety inspection of all apartments takes place on the 2nd; access is required between 09:00 and 15:00.",
  "The community hall is closed for renovation until the end of next month.",
  "Bookings for the community hall reopen on the 1st; residents get priority for two weeks.",
];

const FIXED: Record<number, string[]> = {
  0: [
    "The main pool is open daily from 07:00 to 21:00.",
    "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 1,000 per vehicle, due by 15 October.",
    "The gym opens 06:00 to 22:00 every day.",
  ],
  // Phase 1: a cosmetic edit. Same facts, one sentence reworded, new timestamp
  // and visitor count. The pipeline should log it and stay quiet.
  1: [
    "The main pool is open every day from 07:00 to 21:00.",
    "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 1,000 per vehicle, due by 15 October.",
    "The gym opens 06:00 to 22:00 every day.",
  ],
  // Phase 2: the change that matters.
  2: [
    "The main pool is open every day from 07:00 to 21:00.",
    "Parking permits for next year can be requested from 1 October at the management office. The fee is AED 1,500 per vehicle, due by 10 October.",
    "The gym opens 06:00 to 22:00 every day.",
    "New: the community hall is closed for renovation until the end of next month.",
  ],
};

export const demoPhase = internalQuery({
  args: { watchId: v.string() },
  handler: async (ctx, { watchId }) => {
    const w = await ctx.db.get(watchId as Id<"watches">).catch(() => null);
    return w ? (w.demoPhase ?? 0) : null;
  },
});

export const notices = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const watchParam = url.searchParams.get("watch");
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  let items: string[];
  let updated: string;
  let visitors: number;
  if (watchParam) {
    const phase = (await ctx.runQuery(internal.demo.demoPhase, { watchId: watchParam })) ?? 0;
    items = FIXED[phase] ?? FIXED[0];
    updated = phase === 0 ? "2026-09-01 09:00" : phase === 1 ? "2026-09-20 08:00" : "2026-09-20 09:00";
    visitors = phase === 0 ? 1234 : phase === 1 ? 1987 : 2412;
  } else {
    const pick = (arr: string[], salt: number) => arr[(bucket + salt) % arr.length];
    const extra = pick(EXTRA, 1);
    items = [pick(POOL, 0), pick(PARKING, 2), pick(GYM, 3), ...(extra ? [extra] : [])];
    updated = new Date(bucket * WINDOW_MS).toISOString().replace("T", " ").slice(0, 16);
    visitors = 1000 + ((bucket * 7919) % 1500);
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Riverside Court Community Notices</title>
<meta name="robots" content="noindex">
<style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222}h1{font-weight:normal}li{margin:10px 0}small{color:#777}</style>
</head><body>
<h1>Community notices</h1>
<p><small>Last updated: ${updated} · Visitors online now: ${visitors.toLocaleString()}</small></p>
<ul>
${items.map((t) => "<li>" + t + "</li>").join("\n")}
</ul>
<p><small>This is Pigeon's demo notice board, a fictional page checked through Pigeon's real pipeline. Nothing here is real.</small></p>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
});
