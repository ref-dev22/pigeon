import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [out, url, prefix] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
for (const [name, w, h] of [["desktop", 1280, 800], ["mobile", 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${out}/${prefix}-${name}-hero.png` });
  await p.screenshot({ path: `${out}/${prefix}-${name}-full.png`, fullPage: true });
  console.log(name, "no-hscroll:", await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await p.close();
}
await b.close();
