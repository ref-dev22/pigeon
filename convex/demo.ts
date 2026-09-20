import { httpAction } from "./_generated/server";

// A public notice page that rewrites itself every ten minutes so anyone can
// watch it and receive a real alert without waiting for the world to change.
// Served by the app at /demo/notices. The edits are deterministic from the
// clock, so two checks in the same window see identical text.

const WINDOW_MS = 10 * 60_000;

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

export const notices = httpAction(async () => {
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const pick = (arr: string[], salt: number) => arr[(bucket + salt) % arr.length];
  const visitors = 1000 + ((bucket * 7919) % 1500);
  const updated = new Date(bucket * WINDOW_MS).toISOString().replace("T", " ").slice(0, 16);
  const extra = pick(EXTRA, 1);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Riverside Court Community Notices</title>
<meta name="robots" content="noindex">
<style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222}h1{font-weight:normal}li{margin:10px 0}small{color:#777}</style>
</head><body>
<h1>Community notices</h1>
<p><small>Last updated: ${updated} · Visitors online now: ${visitors.toLocaleString()}</small></p>
<ul>
<li>${pick(POOL, 0)}</li>
<li>${pick(PARKING, 2)}</li>
<li>${pick(GYM, 3)}</li>
${extra ? `<li>${extra}</li>` : ""}
</ul>
<p><small>This is Pigeon's demo notice board. It rewrites one or two notices every ten minutes so you can watch it and receive a real alert. Nothing here is real.</small></p>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
