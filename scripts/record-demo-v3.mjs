// Records the judge path as a captioned video: guest, demo card, save email,
// capture, cosmetic edit (quiet), fee change (alert), diff, email status.
// Output: demo/pigeon-demo-v3.webm then ffmpeg to mp4. Run: node scripts/record-demo-v3.mjs <email>
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
const app = "https://marvelous-dinosaur-465.convex.site/";
const email = process.argv[2];
if (!email) { console.error("need an email for the alert"); process.exit(2); }
fs.mkdirSync("demo/v3", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: "demo/v3", size: { width: 1280, height: 800 } }, reducedMotion: "no-preference" });
const p = await ctx.newPage();
const caption = async (text) => {
  await p.evaluate((t) => {
    let el = document.getElementById("pigeon-caption");
    if (!el) { el = document.createElement("div"); el.id = "pigeon-caption"; el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(20,24,32,.92);color:#fff;font:500 20px/1.35 Georgia,serif;padding:12px 20px;border-radius:12px;max-width:80%;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .3s"; document.body.appendChild(el); }
    el.textContent = t; el.style.opacity = t ? "1" : "0";
  }, text);
};
const hold = (s) => p.waitForTimeout(s * 1000);

await p.goto(app, { waitUntil: "networkidle" });
await caption("Pigeon: a newsletter for pages that don't have one."); await hold(3.5);
await p.mouse.wheel(0, 500); await hold(2); await p.mouse.wheel(0, -500); await hold(1);
await caption("One click, no sign-up."); await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await hold(2.5);
await caption("Your board. Save an email to receive alerts."); await hold(1);
await p.getByPlaceholder(/you@example.com/i).first().fill(email); await hold(1);
await p.getByRole("button", { name: /save my email/i }).first().click(); await hold(2);
await caption("Watch a fictional notice board through the real pipeline."); await hold(1);
await p.getByRole("button", { name: /try a real change/i }).first().click();
await caption("Firecrawl captures the original notice."); await hold(4);
await p.getByRole("button", { name: /publish a cosmetic edit/i }).waitFor({ state: "visible", timeout: 40000 }); await hold(1.5);
await caption("First, a cosmetic edit: one sentence reworded, timestamp and counter bumped."); await hold(1);
await p.getByRole("button", { name: /publish a cosmetic edit/i }).click(); await hold(4);
await caption("The decision model judges it cosmetic. No email. That is the point."); await hold(26);
await caption("Now the fee rises, the deadline moves, a closure is added."); await hold(3);
await p.getByRole("button", { name: /publish a fee/i }).click(); await hold(4);
await caption("Two models: one judges importance with probabilities, one writes two sentences."); await hold(24);
await caption("Money, dates or availability. Emailed."); await hold(4);
const diff = p.locator("a", { hasText: /^diff$/ }).first();
await diff.click(); await hold(1);
await caption("The exact difference, one click away."); await hold(5);
await p.goBack(); await hold(2);
await caption("Email a link to the board and it starts watching. Convex, Firecrawl, AgentMail, OpenAI."); await hold(5);
await caption(""); await hold(1);
const video = p.video();
await ctx.close(); await b.close();
const webm = await video.path();
execSync(`ffmpeg -y -i "${webm}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart demo/pigeon-demo-v3.mp4`, { stdio: "ignore" });
const dur = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 demo/pigeon-demo-v3.mp4`, { encoding: "utf8" }).trim();
console.log("demo/pigeon-demo-v3.mp4", Math.round(Number(dur)), "seconds");
