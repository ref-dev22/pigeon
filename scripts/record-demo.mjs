// Records the demo video with Playwright against the live site.
// Two phases so the recording shows a real detected change:
//   node scripts/record-demo.mjs seed   <appUrl> <pageUrl>   -> guest board + first snapshot, saves demo/state.json
//   (publish a changed version of <pageUrl>, wait 60s for the rate limit)
//   node scripts/record-demo.mjs record <appUrl> <pageUrl2> -> records: board, Check now, change appears, diff, page detail
// Output: demo/*.webm (1280x800). Convert with ffmpeg if mp4 is needed.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const [mode = "record", appUrl = "https://marvelous-dinosaur-465.convex.site/", extraUrl = ""] = process.argv.slice(2);
mkdirSync("demo", { recursive: true });
const statePath = "demo/state.json";
const wait = (p, ms) => p.waitForTimeout(ms);

if (mode === "seed") {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /try it now/i }).first().click();
  await page.waitForURL(/#\/board\//, { timeout: 30000 });
  await wait(page, 2000);
  await page.getByPlaceholder("https://example.org/notices").fill(extraUrl);
  await page.getByPlaceholder(/what matters to you/i).fill("fees, dates or closures");
  await page.getByRole("button", { name: /^watch$/i }).click();
  await wait(page, 9000);
  await context.storageState({ path: statePath });
  console.log("seeded; board url:", page.url());
  await browser.close();
  process.exit(0);
}

if (!existsSync(statePath)) {
  console.error("Run the seed phase first.");
  process.exit(1);
}
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  storageState: statePath,
  recordVideo: { dir: "demo", size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// 1. Landing (logged out view is not shown since we are signed in; start on the board).
await page.goto(appUrl, { waitUntil: "networkidle" });
await page.waitForURL(/#\/board\//, { timeout: 30000 });
await wait(page, 3500);

// 2. Add a second page live so the viewer sees the add flow.
if (extraUrl) {
  await page.getByPlaceholder("https://example.org/notices").fill(extraUrl);
  await wait(page, 800);
  await page.getByRole("button", { name: /^watch$/i }).click();
  await wait(page, 7000);
}

// 3. Trigger a check on the seeded page; the change, summary and importance
//    appear live in the "What changed" column.
await page.getByRole("button", { name: /check now/i }).last().click();
await wait(page, 12000);

// 4. Open the diff.
const diff = page.getByRole("link", { name: /see diff/i }).first();
if (await diff.count()) {
  await diff.click();
  await wait(page, 7000);
  await page.mouse.wheel(0, 400);
  await wait(page, 3000);
  await page.getByText(/back to board/i).click();
  await wait(page, 2500);
}

// 5. Page detail with history and settings.
await page.locator(".watch .title a, .watch a").first().click();
await wait(page, 6000);
await page.getByText(/back to board/i).click();
await wait(page, 2500);

// 6. Board panel: email address and invite link.
await page.mouse.wheel(0, 500);
await wait(page, 4000);

await context.close();
await browser.close();
console.log("Video written to ./demo");
