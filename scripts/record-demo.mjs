// Records the demo video with Playwright, no screen-capture software needed.
// Usage:
//   npm i -D playwright && npx playwright install chromium
//   node scripts/record-demo.mjs https://<deployment>.convex.site https://example.org/notices
// Output: demo/<timestamp>.webm (convert to mp4 with ffmpeg if the form wants mp4).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [appUrl = "http://localhost:5183", watchUrl = "http://localhost:5183/test-notice.html"] =
  process.argv.slice(2);

mkdirSync("demo", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "demo", size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(appUrl);
await pause(2500);
await page.getByRole("button", { name: /try it now/i }).click();
await page.waitForURL(/#\/board\//, { timeout: 20000 });
await pause(2500);

await page.getByPlaceholder("https://example.org/notices").fill(watchUrl);
await page.getByPlaceholder(/what matters to you/i).fill("fees or deadlines");
await pause(800);
await page.getByRole("button", { name: /^watch$/i }).click();
await pause(6000);

// Open the page detail, then come back.
await page.locator(".watch .title a").first().click();
await pause(3500);
await page.getByText("← back to board").click();
await pause(2500);

// If a change already exists, show the diff.
const diffLink = page.getByRole("link", { name: /see diff/i }).first();
if (await diffLink.count()) {
  await diffLink.click();
  await pause(5000);
  await page.getByText("← back to board").click();
  await pause(2000);
}

await context.close();
await browser.close();
console.log("Video written to ./demo");
