// Smoke test for the alert-fatigue question: after three alerts today, is the
// next change materially new? Run: node docs/novelty-eval.mjs <openrouter-key>
const key = process.argv[2];
if (!key) { console.error("need an OpenRouter key"); process.exit(2); }

const cases = [
  { name: "same story reworded", expect: false,
    lastSummaries: ["Parking permit fee is now AED 300 per vehicle, payable by 10 October."],
    newSummary: "The parking-permit note was reworded; the AED 300 fee and 10 October deadline are unchanged.",
    diff: "-A fee of AED 300 per vehicle applies, payable by 10 October (deadline moved forward).\n+A fee of AED 300 per vehicle applies, payable by 10 October (the deadline was brought forward)." },
  { name: "first reversal (reopening is news)", expect: true,
    lastSummaries: ["The pool is closed until further notice."],
    newSummary: "The pool has reopened; the closure notice was removed.",
    diff: "-The pool is closed until further notice.\n+The main pool is open as usual." },
  { name: "flip back again (oscillating page)", expect: false,
    lastSummaries: ["The pool has reopened; the closure notice was removed.", "The pool is closed until further notice.", "The pool has reopened after maintenance."],
    newSummary: "The pool is closed until further notice.",
    diff: "-The main pool is open as usual.\n+The pool is closed until further notice." },
  { name: "new amount", expect: true,
    lastSummaries: ["Parking permit fee is now AED 300 per vehicle, payable by 10 October."],
    newSummary: "Parking permit fee raised to AED 450 per vehicle; the 10 October deadline stands.",
    diff: "-A fee of AED 300 per vehicle applies, payable by 10 October.\n+A fee of AED 450 per vehicle applies, payable by 10 October." },
  { name: "new item entirely", expect: true,
    lastSummaries: ["Weekday gym closing time moved to 21:00 from 1 October."],
    newSummary: "New: Emirates ID will be required at the gate from 15 October.",
    diff: "+New: from 15 October, residents must show Emirates ID at the main gate." },
  { name: "deadline moved", expect: true,
    lastSummaries: ["Parking permit fee is now AED 300 per vehicle, payable by 10 October."],
    newSummary: "Parking permit payment deadline brought forward to 3 October.",
    diff: "-payable by 10 October\n+payable by 3 October" },
];

let wrong = 0;
for (const c of cases) {
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: { previous_alerts_today: c.lastSummaries, new_change: c.newSummary, diff: c.diff },
      questions: { materially_new: { type: "noul",
        instructions: "The reader was already emailed previous_alerts_today (newest first). Does new_change tell them something materially different from all of them, justifying another email now?",
        criteria: { true: "New facts not covered by any earlier alert today: a different amount, date, item, closure or requirement", false: "A rewording of an earlier alert, or the page flipping back to a state an earlier alert today already described" } } },
    }),
  });
  if (!res.ok) { console.error(c.name, "http", res.status, await res.text()); process.exit(1); }
  const p = (await res.json()).answers?.materially_new?.noul;
  const decided = p >= 0.5;
  const ok = decided === c.expect;
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "MISS"} P(new)=${p?.toFixed(2)}  expect ${c.expect ? "email" : "skip"}  ${c.name}`);
}
console.log(wrong ? `${wrong} miss(es)` : "all cases as expected");
process.exit(wrong ? 1 : 0);
