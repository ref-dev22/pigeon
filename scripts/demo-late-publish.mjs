// SPEC-014 acceptance: create a demo, relax it by hand (simulating the hour),
// then publish and confirm the summary still arrives. Prints watch interval
// before and after. Run: node scripts/demo-late-publish.mjs
import { chromium } from "playwright";
import { execSync } from "node:child_process";
const app = "https://marvelous-dinosaur-465.convex.site/";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await p.waitForTimeout(2000);
await p.getByRole("button", { name: /try a real change/i }).first().click();
await p.waitForTimeout(12000);
const m = (await p.textContent("body")).match(/demo\/notices\?watch=([a-z0-9]{32})/);
if (!m) { console.log("no demo watch on page"); process.exit(1); }
const watchId = m[1];
const q = (o) => '"' + JSON.stringify(o).replace(/"/g, '\\"') + '"';
const iv = (r) => r?.intervalMinutes ?? r?.watch?.intervalMinutes;
const run = (fn, args) => {
  const out = execSync(`npx convex run --prod ${fn} ${q(args)}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.slice(out.indexOf("{")));
};
console.log("before:", iv(run("watches:getWatchInternal", { watchId })), "min");
// Simulate the hour: the timer would find the watch too young, so force via backfill-style patch.
execSync(`npx convex run --prod admin:forceRelaxDemo ${q({ watchId })}`, { stdio: "ignore" });
await p.waitForTimeout(1500);
const mid = run("watches:getWatchInternal", { watchId });
console.log("after relax:", iv(mid), "min | label on page:", (await p.textContent("body")).includes("every 6 hours"));
const pub = p.getByRole("button", { name: /publish a fee/i });
await pub.waitFor({ state: "visible", timeout: 30000 }); await pub.click();
await p.waitForTimeout(25000);
const body = await p.textContent("body");
console.log("summary present:", /money, dates or availability|act now|worth a look/.test(body), "| Server Error:", body.includes("Server Error"));
console.log("final interval:", iv(run("watches:getWatchInternal", { watchId })), "min");
await b.close();
