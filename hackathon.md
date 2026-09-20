# Hackathon log

- **Project:** Pigeon
- **Event:** Convex All Gas Hackathon
- **What it does:** Watches any web page on a schedule and emails a shared board a plain-language summary when the page really changes, with the exact diff one click away; boards can also be fed links by email.
- **Live app:** https://marvelous-dinosaur-465.convex.site
- **Repo:** https://github.com/ref-dev22/pigeon
- **Frontend:** Convex static hosting
- **Convex deployment:** https://marvelous-dinosaur-465.convex.cloud
- **Components:** @convex-dev/static-hosting, @firecrawl/firecrawl-convex, @agentmail/convex
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, realtime queries
- **Auth:** Convex Auth
- **AI models:** openai/gpt-5.6-luna (summaries, via an OpenAI-compatible endpoint set by `OPENAI_BASE_URL`), typesafe/jev-1.13 (importance and email-worthiness decisions, via OpenRouter's decisions endpoint); heuristic fallback when either is unavailable
- **Started:** 2026-09-19T16:33:05Z
- **Last updated:** 2026-09-20T02:10:00Z

## Log

### 2026-09-19 - dcfc64c
Laid out the data model: boards with invite codes and an optional board inbox, memberships with per-member notification settings, watches with a check interval and next-check time, snapshots of page text, detected changes with a diff and summary, and an activity feed. Indexes cover board membership lookups, due-check scanning by status and time, and per-watch history. Convex features: schema, tables, indexes (`convex/schema.ts`).

Wrote the check pipeline as an internal action: fetch the page through the Firecrawl component as markdown with change tracking, normalise volatile lines (timestamps, counters, tokens), hash, compare with the last snapshot, store a new snapshot on change, build a unified diff, summarise it, and hand off to email. A cron every five minutes schedules checks for pages whose next check is due; adding a page schedules its first check immediately. Convex features: actions, crons, scheduled functions, internal queries and mutations (`convex/checks.ts`, `convex/crons.ts`, `convex/watches.ts`).

Wired email through the AgentMail component: each new board gets its own inbox in the background, change alerts go to opted-in members from that inbox, cosmetic changes are logged but not emailed, and inbound mail to a board inbox is parsed for links which become new watches, with an automatic reply listing what is now watched. The webhook is mounted as an HTTP action. Convex features: HTTP actions, mutations (`convex/email.ts`, `convex/http.ts`).

Set up Convex Auth with anonymous and password providers so a judge can use the live app without signing up, and registered the static-hosting component so the frontend can be served from `convex.site` (`convex/auth.ts`, `convex/convex.config.ts`).

### 2026-09-19 - 9825e4c
Built the React frontend: landing page, guest and email sign-in, automatic first board, board screen with an add-page form, a live list of watched pages showing status and the latest summary, a live "what changed" feed with importance chips, board panel with invite link, board email address, member list and alert settings, an activity feed, a page-detail screen with settings, snapshots and current text, and a change screen with the colour-coded diff. All lists update in place as checks finish. Convex features: realtime queries, mutations (`src/App.tsx`, `src/styles.css`).

### 2026-09-19 - 8350927
Moved static hosting to app-owned mode so Convex Auth's discovery endpoint stays at the root; the AgentMail webhook and the static routes are registered explicitly in the router (`convex/http.ts`, `convex/convex.config.ts`).

Added a local-development fallback that fetches a page directly when the Firecrawl key is the documented placeholder, so the diff, summary and notification path can be tested without an account; production always uses Firecrawl (`convex/checks.ts`). Logged a board event when email is not configured on the deployment so the gap is visible in the activity feed rather than silent (`convex/email.ts`, `convex/boards.ts`).

Verified locally on an anonymous deployment: guest sign-in, board creation, adding a page, first snapshot, a real content change detected with the visitor counter and timestamp correctly ignored (+3/-2 lines), heuristic summary with importance 4, email correctly skipped with a reason, and the diff view. Production build passes.

### 2026-09-19 - c486533
Moved to one shared AgentMail inbox for the deployment instead of one inbox per board, because the available API key is inbox-scoped. Inbound mail is now routed by the sender address: the address a member saved for alerts, or their account email, selects the board(s); a board named in the subject narrows it further. Added an index on memberships by alert email. Filled in the live URL, repository and deployment (`convex/email.ts`, `convex/schema.ts`, `convex/boards.ts`).

### 2026-09-19 - 9db6f81
Dark bento-grid redesign: benefit-led headline, the product itself as the hero visual (a static mock of a board row and a change card), one dominant orange call to action that also sits in the top bar for logged-out visitors, benefits before features, an FAQ, and a single-column layout at phone width (`src/App.tsx`, `src/styles.css`, `index.html`).

Fixed alert delivery on the cloud deployment. Convex components do not inherit the deployment's environment variables, and the AgentMail component version in use reads its key from the component environment without declaring it, so sends failed with a missing-key error. Patched the component config to declare `AGENTMAIL_API_KEY` and bound it by reference from the app; patch-package applies the patch on install (`convex/convex.config.ts`, `patches/`). After the fix, a real change on a page hosted on the live site produced an alert that AgentMail reports as sent.

Deployed to production: backend on Convex cloud, frontend on convex.site through the static-hosting component. First real Firecrawl scrape on production succeeded (a GOV.UK page, title extracted).

### 2026-09-19 - 8ee1f0c
Inbound email works end to end on production. The webhook route now uses the AgentMail handle that carries the `onMessageReceived` callback; a bare handle verified and stored events but never routed them. A real message from a member's address added a page to their board with the requested daily interval and received an automatic reply (`convex/http.ts`).

Hardening after an independent code review: checks are claimed with a `checkingSince` marker so the cron and "Check now" never scrape the same page twice; owners are capped at five boards and each page keeps at most fifty changes; the language model is only called when the heuristic says the change is more than cosmetic; private-network URLs are rejected; inbound mail must pass SPF or DKIM and is capped by the board's page limit; changing an interval reschedules the next check; alert emails are lowercased for matching; the email status after enqueueing is `queued`, not `sent` (`convex/watches.ts`, `convex/checks.ts`, `convex/email.ts`, `convex/lib.ts`, `convex/boards.ts`, `convex/schema.ts`).

Two models, two jobs: a structured decision model (TypeSafe Jev through OpenRouter's decisions endpoint) now judges importance, whether the change deserves an email, and whether it touches the reader's stated focus, returning typed answers with probabilities; the language model still writes the two-sentence summary. They run in parallel, and either can be missing (`convex/summarize.ts`, `convex/checks.ts`).

### 2026-09-19 - 66c2a1b
Each change now records the AgentMail outbound id and a scheduled follow-up syncs the real send status, so the board shows "sent" or "failed" with the reason instead of staying at "queued" (`convex/email.ts`, `convex/schema.ts`). Alert emails carry a plain importance label and a descriptive subject instead of exclamation marks.

Added a self-rewriting demo notice board served by the app at `/demo/notices` (an HTTP action whose content changes every ten minutes, deterministic from the clock) and a one-click "Watch the demo notice board" with a ten-minute interval allowed only for that page. Anyone who saves an alert email can receive a real change email within about a quarter of an hour without anything being staged (`convex/demo.ts`, `convex/http.ts`, `convex/lib.ts`, `src/App.tsx`).

Evaluated the decision model on ten diffs a notices page might produce: every cosmetic case (counter, timestamp, cookie wording, related links, typo, rotating advert) scored 0.33 or below for "worth an email", every meaningful case (fee, closure, moved deadline, new requirement) 0.69 or above. The gate now trusts that signal on its own. Ten cases are a smoke test, not a proof; real pages will have edge cases this does not cover. Table and script in `docs/filter-eval.md` and `docs/filter-eval.mjs`.

### 2026-09-19 - 2c21ae4
Replaced the dark bento landing with a light editorial design: daytime sky hero, serif display type, tiny tracked labels, a small gold call to action, staggered load and scroll reveals, a gliding origami pigeon that also flaps when a check is triggered, all disabled under reduced motion. Hero and section artwork were generated with an image model and stored under `public/art` with their prompts in `art-prompts.md`. Board, page and change screens follow the same light system (`src/App.tsx`, `src/styles.css`, `src/PigeonMotion.tsx`, `index.html`).

### 2026-09-20 - 481422a
Two reliability fixes from an independent review: the normaliser kept replacing every comma-formatted number, so "AED 1,000" becoming "AED 1,500" would have been missed; it now only touches counters on lines that name themselves as such (visitors, views, followers). Firecrawl scrapes pass `maxAge: 0` so a cached copy can never mask a change, and the previous snapshot's hash is recomputed with the current normaliser so a rule change never looks like a page change (`convex/lib.ts`, `convex/checks.ts`).

Judge path in two clicks: "Try a real change on a demo notice board" creates one fictional notice per board at `/demo/notices?watch=<id>`, checked through the real pipeline; once the baseline exists, "Publish a fee and deadline change" flips the page (fee AED 1,000 to 1,500, deadline 15 to 10 October, a closure added) and schedules an immediate check, so the summary, importance and email arrive while the judge is watching. Idempotent per board; boards cannot affect each other (`convex/demo.ts`, `convex/watches.ts`, `src/App.tsx`).

An alert-setup prompt now sits above the first-watch form until the member has an email, so the product's main benefit is never silently off (`src/App.tsx`).

Spot check on an ordinary public page: Hacker News' front page was added to a guest board and re-checked ninety seconds later. The pipeline detected the change, the language model summarised it ("rankings updated, scores and comment counts changed, normal feed activity"), the decision model rated it importance 1, and no email was sent. That is the intended behaviour for a busy feed, and it shows the "paste any page" path is not limited to the demo fixture.

Public posts: X https://x.com/omarref11/status/2101455354173493595 and LinkedIn https://lnkd.in/p/du-TV4kz. Video: https://youtu.be/i0d-cCDS9_A.

### 2026-09-20 - b3ee8a9
A second independent engineering review (flows, architecture, code quality) produced 28 findings; the ones that could lose an alert, leak data or break a deploy are fixed:
- Filtering: the models are skipped only when every changed line is recognisable noise, so a single meaningful line ("the pool is closed") is always judged; counters are normalised only where a counter label sits next to the number, so "AED 1,000" on a line that also says "visitors" is kept (`convex/lib.ts`, `convex/checks.ts`).
- Pipeline: model calls have deadlines; changes left without a summary by an interrupted run are finished on the next check; checks carry a claim token so a superseded worker cannot overwrite state; a pause requested during a check is preserved; error pages (HTTP 400+) never replace a good baseline; page text and diffs are capped in bytes, not characters; the cron drains the most overdue pages first regardless of status (`convex/checks.ts`, `convex/watches.ts`, `convex/summarize.ts`).
- Cost: a deployment-wide daily scrape budget (700) stops a runaway guest from exhausting the shared Firecrawl credits (`convex/watches.ts`, `convex/schema.ts`).
- Mail: when a sender's address is on more than one board and the subject names none, nothing is added and the sender is asked to name the board; a board that merely claims an address cannot silently receive someone else's links. Replies use the new text only, so quoted history never re-adds old pages. Delivery status is reconciled for six hours (`convex/email.ts`).
- Auth: emails are lowercased on sign-up and sign-in so casing never splits an account or breaks inbound routing (`convex/auth.ts`).
- Engineering: backend tsconfig includes Node types so `convex dev` typechecks; deploy runs codegen before the frontend build; patch-package is a runtime dependency so a production install applies the AgentMail patch; the AgentMail key is optional so an email-less local setup validates (`convex/tsconfig.json`, `package.json`, `convex/convex.config.ts`, `patches/`).
- UI: board settings stay in step with saved values; first-board creation shows its error instead of retrying forever; the error boundary resets on navigation; the demo page shows its real 10-minute cadence; pause, remove, rename and interval changes surface failures (`src/App.tsx`).
Known and accepted for now: a guest who later creates a password account does not carry their boards over (use the invite link); address ownership is not verified by a confirmation email, so routing relies on the sender authenticating (SPF/DKIM) plus the name-the-board rule above.

## 20 Sep, morning: the demo showed "Server Error" after a quick "Check now"

Omar clicked "Check now" straight after "Publish a fee and deadline change" and the row printed `[CONVEX M(watches:checkNow)] ... Server Error`. Two causes stacked: `checkNow` threw a plain `Error` for its one-a-minute rate limit, and Convex hides plain error text in production, so the friendly message never reached the browser.

Fixed in three moves:
- Every user-facing `throw` in mutations (`watches.ts`, `boards.ts`, `lib.ts`) is now a `ConvexError`, whose text does survive production. The UI reads it through one `errMsg` helper; anything still generic is shown as "Something went wrong on the server. Please try again."
- `checkNow` no longer throws for timing. It returns `"running"`, `"fresh"` or `"scheduled"`, and the new `CheckNowButton` shows "Checking…" (disabled) while a check is in flight, or a quiet "Checked just now. Try again in a minute." note that fades.
- `scripts/checknow-test.mjs` replays the exact click sequence from the screenshot against production: no "Server Error", summary present, no page errors.

## 20 Sep, mid-morning: an alert every fifteen minutes

Omar's inbox showed a Pigeon alert every quarter hour. Cause: one watch from my early testing pointed at the shared `/demo/notices` page, which rewrote itself every ten minutes by design, and its board had Omar's email. Every rotation was a genuine, important-looking change, so every check emailed. Working as built, built wrong.

- That watch is paused. `convex/admin.ts` holds the operator tools used (`demoWatchReport`, `pauseWatches`, `relaxFinishedDemos`), runnable only with `npx convex run`.
- The shared demo page now rotates every six hours, not ten minutes.
- When a board publishes its demo change, the watch drops from ten minutes to the normal six-hour interval; the demo has made its point and should not scrape all day.

## 20 Sep, midday: hunting the bugs nobody reported yet

Both bugs the owner found came from off-script use: an unexpected click order, and the system running unattended with real data. Three tools now look for that class on purpose, and the decision model is used as a cheap checkpoint at three more points.

- **Chaos judge** (`scripts/chaos.mjs`): a seeded random walk over the live app as an impatient guest: odd click orders, double clicks, reloads mid-action, a second tab on the same board, junk URLs, malformed links, sign-out from anywhere. Fails on any "Server Error", blank page, stuck spinner or page error. First run found that a mistyped board or watch id in the URL (`#/board/xyz`) threw and dropped the whole view to the error boundary; public queries now normalise ids and answer "not found" instead (`convex/watches.ts`, `convex/boards.ts`). A later seed found a raw Firecrawl component error printed in a watch row; scrape errors are now rewritten into plain sentences (`convex/checks.ts`). Three seeds now pass clean.
- **Data health report** (`admin:healthReport` in `convex/admin.ts`, `scripts/health-jev.mjs`): invariants over the production data (stale claims, overdue checks, changes without a summary, emails stuck at "queued", non-demo pages checked too often, any page that emailed more than three times in a day, overfull boards, error reasons, scrape budget). The decision model reads the report and answers three typed questions: healthy or not, urgency 1 to 5, and which finding is worst. First run: not healthy, "look today", worst was an email stuck at "queued" for hours because its send never produced an outbound id. The last status reconciliation now resolves "queued" to a stated outcome instead of leaving it forever (`convex/email.ts`).
- **Alert-fatigue gate** (`convex/checks.ts`, `convex/summarize.ts`): once a page has emailed three times in 24 hours, the decision model is shown the last three alerts and asked whether the new change is materially different from all of them. Rewordings and a page flipping back to a state already reported are logged, not emailed. `docs/novelty-eval.mjs` covers six cases (rewording, first reversal, oscillation, new amount, new item, moved deadline): 6 of 6 as expected. Showing only the last alert was not enough; the model correctly treats a first reversal as news, so the oscillation case needs the history.

Also: clipboard writes no longer throw when the browser denies them; an old test page that had emailed four times today is paused.

Follow-up the same afternoon: the health report was re-run after the fixes and Jev still ranked the deployment unhealthy, because the findings were now my own chaos leftovers (guest boards with mistyped URLs, historical counts on paused watches). Two changes: the report separates benign errors (not found, refused access) from unexplained ones and ignores paused watches; and the roadmap item "guest-watch expiry" is done. A daily cron (`admin:expireIdleGuestWatches`) pauses every page on a board where nobody saved an alert email within a day, with a note in the activity feed and a one-click resume. Run once by hand it paused 32 test watches on 14 boards. Jev's verdict after that: healthy, urgency below "look this week", worst finding "none".
