const K = process.argv[2];
const cases = [
  ["counter", "- Visitors online now: 1,987\n+ Visitors online now: 2,412"],
  ["timestamp", "- Last updated: 2026-09-20 01:20\n+ Last updated: 2026-09-20 03:35"],
  ["cookie banner", "- We use cookies to improve your experience. Accept\n+ We use cookies and similar technologies to improve your experience. Accept all"],
  ["related articles", "- Related: 5 tips for winter gardening\n+ Related: How to prune roses in autumn"],
  ["fee change", "- The fee is AED 250 per vehicle.\n+ The fee is AED 300 per vehicle, payable by 10 October."],
  ["closure", "+ The main pool is closed until further notice for pump repairs."],
  ["date moved", "- Applications close on 15 October.\n+ Applications close on 3 October."],
  ["typo fix", "- Parking permits can be requsted from 1 October.\n+ Parking permits can be requested from 1 October."],
  ["new requirement", "+ From 1 November, a valid Emirates ID must be shown at the gate."],
  ["ad rotation", "- Sponsored: Save 20% on gym memberships this month\n+ Sponsored: New yoga classes, first session free"],
];
for (const [name, diff] of cases) {
  const r = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + K },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: { page: "Community notices", reader_focus: "fees, dates or closures", diff },
      questions: {
        importance: { type: "score", instructions: "How important is this page change for a reader who asked to be emailed when the page really changes?", criteria: ["Cosmetic or automatic: timestamps, counters, ads, formatting", "Minor wording with no practical effect", "Worth reading but no action needed", "Affects money, dates, availability or requirements", "The reader should act now"] },
        worth_email: { type: "noul", instructions: "Should the reader receive an email about this change right now?", criteria: { true: "The change carries real information the reader would want to know", false: "Noise, cosmetic, or automatic content only" } },
      },
    }),
  });
  const j = await r.json();
  if (!j.answers) { console.log(name.padEnd(18), "ERROR", JSON.stringify(j).slice(0, 200)); process.exitCode = 1; continue; }
  const a = j.answers;
  console.log(name.padEnd(18), "importance", Math.round(a.importance.score) + 1, "conf", a.importance.confidence.toFixed(2), "email", a.worth_email.noul.toFixed(2));
}
