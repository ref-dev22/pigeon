// Walks the judge path as a brand-new guest against the live site and prints what happened.
import { chromium } from "playwright";
const app = process.argv[2] || "https://marvelous-dinosaur-465.convex.site/";
const email = process.argv[3] || "";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await p.waitForTimeout(2500);
if (email) { await p.getByPlaceholder("you@example.com").first().fill(email); await p.getByRole("button", { name: /save my email/i }).click(); await p.waitForTimeout(1500); }
await p.getByRole("button", { name: /try a real change/i }).click();
await p.waitForTimeout(12000);
console.log("after create:", (await p.innerText("body")).match(/Riverside[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*/)?.[0]);
const pub = p.getByRole("button", { name: /publish a fee and deadline change/i });
await pub.waitFor({ state: "visible", timeout: 30000 });
await pub.click();
await p.waitForTimeout(25000);
const t = await p.innerText("body");
console.log("change card:", t.match(/What changed\n([\s\S]{0,400})/)?.[1]?.split("\n").slice(0, 6).join(" | "));
await p.screenshot({ path: "../shots/judge-path-board.png" });
await c.storageState({ path: "demo/judge-state.json" });
await b.close();
