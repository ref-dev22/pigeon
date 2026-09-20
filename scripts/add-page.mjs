// Create a guest board with an email and one watched page. Prints the board URL.
// node scripts/add-page.mjs <email> <url> <intervalMinutes> "<focus>"
import { chromium } from "playwright";
const [email, url, interval, focus] = process.argv.slice(2);
const app = "https://marvelous-dinosaur-465.convex.site/";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(app, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /try it now/i }).first().click();
await p.waitForURL(/#\/board\//, { timeout: 30000 }); await p.waitForTimeout(2000);
await p.getByPlaceholder(/you@example.com/i).first().fill(email);
await p.getByRole("button", { name: /save my email/i }).first().click(); await p.waitForTimeout(1500);
await p.getByPlaceholder("https://example.org/notices").fill(url);
await p.locator("select[aria-label='How often']").selectOption(String(interval));
if (focus) await p.getByPlaceholder(/what matters to you/i).fill(focus);
await p.getByRole("button", { name: /^watch$/i }).click();
await p.waitForTimeout(15000);
const body = await p.textContent("body");
console.log("board:", p.url());
console.log("row:", body.match(/CNN[^\n]{0,80}/)?.[0] ?? "(title pending)", "| status ok:", !/Server Error|could not be fetched|not found/i.test(body));
await b.close();
