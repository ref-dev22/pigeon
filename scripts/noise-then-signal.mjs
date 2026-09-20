// SPEC-016/017 acceptance: fresh guest, demo card first, cosmetic edit stays
// quiet, fee change alerts. Optional email as argv[2]. Prints the progress line.
import { chromium } from "playwright";
const app = "https://marvelous-dinosaur-465.convex.site/";
const email = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await p.waitForTimeout(2000);
console.log("demo card first:", (await p.locator("[data-pigeon-demo-card]").count()) === 1);
if (email) { await p.getByPlaceholder(/you@example.com/i).first().fill(email); await p.getByRole("button", { name: /save my email/i }).first().click(); await p.waitForTimeout(1200); }
await p.getByRole("button", { name: /try a real change/i }).first().click();
const progress = async () => (await p.locator("[data-pigeon-progress]").first().innerText()).replace(/\s+/g, " ").trim();
await p.getByRole("button", { name: /publish a cosmetic edit/i }).waitFor({ state: "visible", timeout: 40000 });
console.log("after capture:", await progress());
await p.getByRole("button", { name: /publish a cosmetic edit/i }).click();
await p.waitForTimeout(28000);
const afterCosmetic = await progress();
console.log("after cosmetic:", afterCosmetic);
const quiet = /Judged: cosmetic|Not emailed/i.test(afterCosmetic);
await p.getByRole("button", { name: /publish a fee/i }).waitFor({ state: "visible", timeout: 10000 });
await p.waitForTimeout(2000);
await p.getByRole("button", { name: /publish a fee/i }).click();
await p.waitForTimeout(30000);
const afterFee = await progress();
console.log("after fee:", afterFee);
const body = await p.textContent("body");
console.log("cosmetic stayed quiet:", quiet, "| fee judged important:", /money, dates or availability|act now/.test(afterFee), "| emailed:", /Emailed/.test(afterFee), "| Server Error:", body.includes("Server Error"), "| pageerrors:", errs.length);
await p.screenshot({ path: "../shots/noise-then-signal.png", fullPage: true });
await b.close();
