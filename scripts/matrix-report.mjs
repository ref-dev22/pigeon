// Print the matrix board as a table. node scripts/matrix-report.mjs <boardId>
import { execSync } from "node:child_process";
const boardId = process.argv[2];
const q = '"' + JSON.stringify({ boardId }).replace(/"/g, '\\"') + '"';
const out = execSync(`npx convex run --prod admin:boardReport ${q}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const r = JSON.parse(out.slice(out.indexOf("[")));
const pending = r.filter((w) => w.status === "pending").length;
console.log(`pages ${r.length} | pending ${pending} | ok ${r.filter((w) => w.status === "ok").length} | error ${r.filter((w) => w.status === "error").length}`);
for (const w of r) {
  const host = w.url.replace(/^https:\/\/(www\.)?/, "").slice(0, 48).padEnd(48);
  console.log(`${w.status.padEnd(7)} | ${host} | chk ${w.checks} chg ${w.changes} | ${(w.title ?? "").slice(0, 34).padEnd(34)} | ${w.lastError ?? ""}`);
  for (const c of w.recent) console.log(`        -> imp ${c.importance} ${c.lines} email ${c.email}${c.reason ? " (" + c.reason.slice(0, 50) + ")" : ""}: ${c.summary}`);
}
process.exit(pending ? 1 : 0);
