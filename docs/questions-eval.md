# Questions evaluation (SPEC-019)

"Ask a page a question" promises two things: the answer shown is the page's own line, and when the page does not say, Pigeon says so instead of guessing. This is a small, reproducible check of both on four real public pages, run on 29 September 2026 against the development deployment. It is a smoke test, not a benchmark: ten questions, one run.

Seven questions have an answer on the page (checked by hand against the page that day). Three are traps the page does not answer.

| Page | Question | Expected | Pigeon showed | Quoted line (as displayed) | Verdict |
|---|---|---|---|---|---|
| convex.dev/pricing | How much does the Professional plan cost per developer per month? | $25 per developer per month | Answered: "$25 per developer per month" | `Popular Try Professional $25per developer/month` under "Plans" | correct |
| convex.dev/pricing | How many function calls per month are included on the free plan? | 1M included | Not stated yet | none | miss, safe direction |
| convex.dev/pricing | What is Convex's refund policy? | not on the page | Not stated yet | none | correct refusal |
| firecrawl.dev/pricing | How many credits per month does the free plan include? | 1,000 | Answered: "1,000 credits per month" | `1,000 credits / month` under "Free Plan" | correct |
| firecrawl.dev/pricing | What does the Hobby plan cost per month when billed yearly? | $16 a month, billed yearly | Answered: "$16 per month when billed yearly" | `$16 /month Billed yearly` under "Hobby" | correct |
| firecrawl.dev/pricing | Does Firecrawl offer a student discount? | not on the page | Not stated yet | none | correct refusal |
| federalreserve.gov FOMC calendars | What are the dates of the October 2026 FOMC meeting? | 27-28 October 2026 | Answered: "October 27-28" | `October 27-28` under "2026 FOMC Meetings" | correct |
| federalreserve.gov FOMC calendars | When were the minutes of the January 2026 meeting released? | 18 February 2026 | Answered: "February 18, 2026" | `Minutes: PDF \| HTML (Released February 18, 2026)` under "2026 FOMC Meetings" | correct |
| u.ae public holidays | How many days off are given for National Day? | 2 days, 2 and 3 December | Answered: "2 days off" | `National Day - 2 and 3 December (2 days).` under "List of holidays" | correct |
| u.ae public holidays | What is the minimum wage in the UAE? | not on the page | Not stated yet | none | correct refusal |

**Result:** 6 of 7 answerable questions answered correctly with the line that states it; 1 answerable question came back "Not stated yet" (the free-plan function-call allowance sits in a wide comparison table, and Pigeon would not tie "1M included" to the Free column); 3 of 3 traps refused. No wrong answers, and every quote shown is a line of the captured page, because the model only returns line numbers and code checks the selection and every number in the answer against the quoted lines.

**Suggestions offered on the same pages** (up to three, each verified against a quoted line before it is shown): Firecrawl "How much does the Standard plan cost?"; FOMC "How many regularly scheduled FOMC meetings are held each year?"; u.ae "Do these public holidays apply to both public and private sectors?", "When is the UAE National Day public holiday?", "Can a public holiday be moved if it falls on a weekend?". None on the Convex pricing page: no proposal survived verification.

**Cost:** one Firecrawl scrape per page (four in total); every question and suggestion read that stored capture. The watches were paused straight after.

**What the first run found, fixed before this one:**
- Section labels came from bold labels ("Projection Materials", "Statement:") instead of the page's heading; sections now prefer a real markdown heading.
- Quotes showed markdown (`**`, link addresses); display now shows the words a reader sees, while the stored quote stays verbatim for comparisons.
- One question and the Convex suggestions came back empty because the reasoning model spent its whole output budget thinking; the budget was raised and an empty reply is now logged.
- One question was refused by the ask limiter (six a minute per person); the script now paces itself like a person would.

Reproduce (development deployment and a local frontend):

```bash
node scripts/questions-eval.mjs http://localhost:5183/ scripts/questions-eval.json
```

The raw output is written to `../shots/questions-eval.json`.
