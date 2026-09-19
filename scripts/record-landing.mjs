import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
const [appUrl = "https://marvelous-dinosaur-465.convex.site/"] = process.argv.slice(2);
mkdirSync("demo", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: "demo/landing", size: { width: 1280, height: 800 } } });
const page = await context.newPage();
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 520); await page.waitForTimeout(1600); }
await page.waitForTimeout(1000);
await context.close(); await browser.close();
const f = readdirSync("demo/landing").find((x) => x.endsWith(".webm"));
renameSync("demo/landing/" + f, "demo/landing.webm");
console.log("landing recorded");
