// Pull the production health report and let the decision model rank it.
// Run: node scripts/health-jev.mjs <openrouter-key>   (from claude-earn/app)
import { execSync } from "node:child_process";
const key = process.argv[2] ?? process.env.OPENROUTER_API_KEY;
if (!key) { console.error("need an OpenRouter key"); process.exit(2); }
const raw = execSync("npx convex run admin:healthReport --prod", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const report = JSON.parse(raw.slice(raw.indexOf("{")));
console.log("totals:", JSON.stringify(report.totals));
const nonEmpty = Object.entries(report.findings).filter(([, v]) => (Array.isArray(v) ? v.length : Object.keys(v).length) > 0);
console.log("non-empty findings:", nonEmpty.map(([k, v]) => `${k}(${Array.isArray(v) ? v.length : Object.keys(v).length})`).join(", ") || "none");

const questions = {
  healthy: { type: "noul", instructions: "Is this deployment healthy enough that a stranger using it today would not notice a problem?", criteria: { true: "No finding affects a user-visible flow or sends unwanted mail", false: "At least one finding would show up as an error, a missed alert or unwanted mail" } },
  urgency: { type: "score", instructions: "How urgently should an operator act on the worst finding?", criteria: ["Nothing to do", "Look this week", "Look today", "Fix before the next check cycle", "Users are being harmed now"] },
  worst: { type: "choice", instructions: "Which finding category is the most serious right now?", criteria: Object.fromEntries([...Object.keys(report.findings).map((k) => [k, "The " + k + " finding is the most serious"]), ["none", "Nothing is serious"]]) },
};
const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
  body: JSON.stringify({ model: "typesafe/jev-1.13", state: { context: "Pigeon watches web pages and emails a household when a page really changes. Demo pages under /demo/notices are the app's own fixtures. Budget is 700 scrapes a day.", report }, questions }),
});
if (!res.ok) { console.error("jev http", res.status, await res.text()); process.exit(1); }
const data = await res.json();
console.log("\njev verdict:");
console.log(JSON.stringify(data.answers ?? data, null, 2));
const healthy = data.answers?.healthy?.noul;
process.exit(typeof healthy === "number" && healthy < 0.5 ? 1 : 0);
