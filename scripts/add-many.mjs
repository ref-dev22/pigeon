// Create a guest board (no email) and add many pages at 30-minute intervals.
// node scripts/add-many.mjs urls.txt   -> prints the board id
import { chromium } from "playwright";
import fs from "node:fs";
const urls = fs.readFileSync(process.argv[2], "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const app = "https://marvelous-dinosaur-465.convex.site/";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await p.waitForTimeout(2000);
for (const u of urls) {
  await p.getByPlaceholder("https://example.org/notices").fill(u);
  await p.locator("select[aria-label='How often']").selectOption("30");
  await p.getByRole("button", { name: /^watch$/i }).click();
  await p.waitForTimeout(1500);
}
console.log("board:", p.url().split("#/board/")[1]);
await b.close();
