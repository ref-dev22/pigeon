# Filter evaluation

Pigeon's promise is "only when it matters", so the filter is the product. Ten hand-written cases are a smoke test, not a proof: they show the decision model separates obvious noise from obvious signal on one kind of page. Real pages will produce edge cases this table does not cover. This is a small, reproducible check of the decision model (`typesafe/jev-1.13` through OpenRouter's decisions endpoint) on ten diffs a community-notices page might produce. Reader focus was set to "fees, dates or closures". Run on 20 September 2026.

| Case | Diff (abridged) | Importance (1-5) | Confidence | P(worth an email) | Pigeon's action |
|---|---|---:|---:|---:|---|
| Visitor counter | 1,987 → 2,412 | 1 | 1.00 | 0.04 | logged, no email |
| Timestamp | Last updated 01:20 → 03:35 | 1 | 1.00 | 0.07 | logged, no email |
| Cookie banner wording | "cookies" → "cookies and similar technologies" | 1 | 0.76 | 0.06 | logged, no email |
| Related-articles block | different article titles | 2 | 0.53 | 0.10 | logged, no email |
| Typo fixed | requsted → requested | 2 | 0.45 | 0.06 | logged, no email |
| Rotating advert | different sponsored line | 3 | 0.00 | 0.33 | logged, no email |
| Fee change | AED 250 → AED 300, payable by 10 October | 4 | 0.62 | 0.84 | emailed |
| Closure | pool closed until further notice | 4 | 0.90 | 0.77 | emailed |
| Deadline moved | closes 15 October → 3 October | 5 | 0.60 | 0.79 | emailed |
| New requirement | Emirates ID required at the gate | 4 | 0.91 | 0.69 | emailed |

Rule in `convex/checks.ts`: a change is emailed when its importance is 2 or more; the decision model's "worth an email" probability below 0.40 caps importance at 1 regardless of its importance confidence; a probability of 0.80 or more that the change touches the reader's stated focus raises importance to at least 4.

Before the model sees a diff, `convex/lib.ts` already normalises machine noise (large counters, long query strings, hashes) and Firecrawl's main-content extraction drops most navigation and chrome. Times and dates are kept because they are often the content.

Total cost of the ten decisions: under one tenth of a US cent.

Reproduce: `node docs/filter-eval.mjs <openrouter-key>`.
