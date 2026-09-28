# Pigeon

**A newsletter for pages that don't have one.**

The pages people actually need to watch rarely have an RSS feed or a mailing list: a school's notice board, an embassy's appointment page, the building's community announcements, a clinic's schedule, a government fee table, a landlord's portal. People reload them, or miss the change.

Pigeon watches public web pages on a schedule and emails you only when something meaningful changed, explained in two plain sentences, with the diff of the captured text one click away. Households and small teams share a board, and the board has an email address: send it a link from the address you saved for alerts and it starts watching.

Or ask the page a question, "When is the parking permit due, and what does it cost?", and Pigeon watches that fact instead of the page: it quotes the line that answers you, and writes only when that answer changes, first appears, or disappears.

Built for the [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas), September 2026.

**Live:** https://marvelous-dinosaur-465.convex.site · **Demo video:** https://youtu.be/M9quyQCpe1Q

> **Changed after the 22 September 2026 submission deadline.** Judging moved to 2 October, and "Ask a page a question" (below) was added on 29 September. The version submitted on time is tag [`v-submitted`](https://github.com/ref-dev22/pigeon/tree/v-submitted) (commit `3425248`, 21 September); the demo video shows that version. Everything after it is listed in `hackathon.md` under "Changed after the deadline".

## What it does

- **Ask a page a question** (added after the deadline). Pigeon answers from the page's own line, shows where on the page it is, and from then on watches that answer: not stated yet, answered, changed, or no longer on the page. It suggests up to three questions the page can answer. A page with a question emails only when an answer moves. See "Ask a page a question" below.

- **Watch a page** by pasting a URL, choosing how often to check (30 minutes to weekly), and optionally saying what you care about ("fees or deadlines").
- **Noise is filtered before anyone is emailed.** Timestamps, visitor counters, cache-busting tokens and "last updated" lines are normalised away before comparing; what is left is judged by a decision model and, after three alerts in a day, checked for novelty. The filter is a judgment, not a guarantee; the ten-case and six-case smoke tests in `docs/` show what it was checked against.
- **Plain-language summary and an importance score** from 1 (cosmetic) to 5 (act now). A model writes it when a key is configured; a heuristic fallback still produces a useful line when it is not.
- **The diff** of the captured page text, colour-coded, for every change (after normalisation and size caps, so it is the text Pigeon compared, not the raw HTML).
- **Email alerts** go to every member who opted in. Cosmetic changes are logged but not emailed.
- **Add pages by email.** Email the board address a link (optionally with "hourly" or "daily" in the text) from the email you saved for alerts. Pigeon matches the sender to your board(s), adds the page, and replies with what it is now watching. Mail that fails SPF or DKIM is ignored.
- **Shared boards** with invite links, live-updating for everyone at once.
- **Guest mode** so a judge can open the live URL and use the product immediately, plus email and password accounts for people who want to keep a board.

## How the sponsor stack does real work

| Piece | Role |
|---|---|
| **Convex** | Database, schema with indexes, queries and mutations, live updates on every screen, scheduled functions, a cron that picks up due pages, Convex Auth (anonymous and password), four registered components (Firecrawl, AgentMail, static hosting, and the rate limiter that caps questions per person and per day), and the frontend served from `convex.site`. |
| **Firecrawl** (`@firecrawl/firecrawl-convex`) | Every check scrapes the page to clean markdown with `onlyMainContent`, and asks for Firecrawl's own `changeTracking` verdict alongside Pigeon's diff. |
| **AgentMail** (`@agentmail/convex`) | One inbox for the deployment. Sends the change alerts, receives links through the signed webhook, routes them to the sender's board(s), and replies. |
| **OpenAI model** (`openai/gpt-5.6-luna` via OpenRouter) | Turns the unified diff into the two-sentence summary, and for a question picks the line numbers that answer it and proposes questions a page can answer. Any OpenAI-compatible endpoint works through `OPENAI_BASE_URL`. |
| **Decision model** (`typesafe/jev-1.13` via OpenRouter's decisions endpoint) | Returns typed judgments with probabilities: importance 1 to 5, whether the change deserves an email, whether it touches the reader's stated focus, and whether a reworded answer is a different fact or the same one. |

## Run it locally

```bash
npm install
npx convex dev            # creates a local deployment; no account needed for local dev
```

Set the backend environment variables on the deployment:

```bash
npx convex env set FIRECRAWL_API_KEY fc-...        # or fc-local-placeholder to use a plain fetch in local dev
npx convex env set AGENTMAIL_API_KEY am_...        # optional locally; required for email
npx convex env set AGENTMAIL_WEBHOOK_SECRET whsec_...
npx convex env set AGENTMAIL_INBOX_ID you@agentmail.to   # the inbox alerts are sent from and links are mailed to
npx convex env set OPENAI_API_KEY sk-...           # optional; heuristic summaries without it
npx convex env set OPENAI_BASE_URL https://openrouter.ai/api/v1   # optional; any OpenAI-compatible endpoint
npx convex env set OPENAI_MODEL openai/gpt-5.6-luna
npx convex env set DECISION_MODEL typesafe/jev-1.13     # optional; importance decisions via OpenRouter
npx convex env set SITE_URL http://localhost:5183
```

Convex Auth also needs `JWT_PRIVATE_KEY` and `JWKS`; `npx @convex-dev/auth` generates them.

Then in a second terminal:

```bash
npm run dev               # Vite on http://localhost:5183
```

## Deploy

```bash
npx convex login
npm run deploy            # builds the frontend, pushes the backend, uploads to convex.site
```

Register `https://<deployment>.convex.site/agentmail/webhook` in the AgentMail dashboard and set `APP_URL` to the site URL so emails link back to the diff.

## Project layout

```
convex/
  schema.ts        boards, memberships, watches, snapshots, changes, events
  boards.ts        create/join/rename boards, notification settings, activity feed
  watches.ts       add/pause/remove pages, changes feed, internal pipeline mutations
  checks.ts        the check: scrape, normalise, hash, diff, summarise, notify
  questions.ts     ask a page a question: read, history from stored captures, re-read on change
  facts.ts         pure helpers for questions: numbered lines, selection and number checks, lifecycle
  summarize.ts     model summary, decision-model importance, heuristic fallback
  email.ts         alert sending, inbound link routing by sender, auto-replies
  crons.ts         every 5 minutes: run due checks
  auth.ts, http.ts Convex Auth, AgentMail webhook, static routes
src/
  App.tsx          landing, board, watch detail, change/diff views
```

## Try a real change in two clicks

On any board, "Try a real change on a demo notice board" creates a fictional notice page served by the app itself. Once its baseline is captured, Pigeon suggests questions the page answers; tap the parking one and it quotes the line. "Publish a cosmetic edit" leaves that answer untouched and sends nothing. "Publish a fee and deadline change" flips the page (fee AED 1,000 to 1,500, deadline moved, a closure added) and checks it immediately, so the summary, the importance judgment and the alert email arrive while you watch. The page is labelled fictional; the pipeline is the real one. A second demo page at `/demo/notices` rewrites itself every six hours for unattended watching. Once a board's demo change is published, that watch drops to the normal six-hour interval.

## Ask a page a question

Added on 29 September 2026, after the deadline (see the note at the top).

Most change monitors tell you that a page changed. What people want to know is whether the thing they care about changed: the fee, the deadline, whether the hall is open. So Pigeon lets you ask the page that, and then watches the answer rather than the page.

- **The answer is the page's own line.** The page is read as numbered lines, and the model may only return line numbers (one to three contiguous lines). Code checks that those lines exist and were shown, that no line is a counter or link placeholder, and that every number in the plain-language answer appears in the quoted lines. If the check fails twice, Pigeon shows nothing rather than guess. So a quote cannot be invented, and a number in an answer cannot be made up.
- **Four states, each quoted:** *Not stated yet*, *Answered*, *Changed* (Now and Before, each with the time it was captured and its section), and *No longer on the page*. A rewording of the same fact is recorded but not emailed; the decision model tells the two apart.
- **History from day one.** A new question is read against the captures Pigeon already holds (up to four), oldest first, so it arrives with its past.
- **Suggestions.** On a page's first capture Pigeon proposes up to three questions the page answers, each verified against its line before it is shown. Tap one to ask it.
- **Quiet by default.** A page with a question emails only when an answer moves, with the answer in the subject ("Now: AED 1,500 per vehicle…"); every other change is still logged. Each card keeps a receipt: "Checked 2 times since you asked. The answer moved once."
- **No extra scrapes.** Every reading uses a capture the page check already took.
- **Guards.** A reading that finds nothing while the old line is still on the page is treated as a miss, not a withdrawal. A question asked seconds before a change lands is waited for, not skipped. At most three answer emails per question a day. Six questions a minute per person, three per page, fifteen per board, and deployment-wide ceilings on new questions and suggestion reads per day, so model spend has a limit.

`docs/questions-eval.md` records a ten-question check on four real pages: six of seven answerable questions answered with the right line, one answerable question left as "Not stated yet", three of three unanswerable questions refused, no wrong answers. `node scripts/facts-test.mjs` runs the unit checks; `node scripts/ask-demo.mjs` runs the demo end to end.

## Honest limits

- Pages behind logins or heavy bot protection may not scrape.
- The importance score is a judgment call by a model or a heuristic, not a guarantee. `docs/filter-eval.md` is a ten-case smoke test, not a proof.
- A board watches at most 25 pages, at most every 30 minutes (10 for the demo page), an owner has at most 5 boards, and the deployment scrapes at most 40 pages a day (the demo is exempt), because Firecrawl's free tier is 1,000 scrapes a month.
- A guest who later creates a password account does not carry boards over; use the invite link.
- A board where nobody saved an alert email has its pages paused after a day, with a note in the activity feed; save an email and press resume.
- After three alerts from one page in a day, a fourth is sent only if the decision model finds it materially new; otherwise it is logged with the reason.
- Email addresses are not verified by a confirmation mail. Inbound routing relies on the sender passing SPF or DKIM, and refuses to guess when an address maps to more than one board.
- Questions: quotes are the page's lines after normalisation (spacing, markdown escapes, Arabic-Indic digits written as 0-9), and the board hides bullet, bold and link markup when showing them. Only questions a page answers explicitly work; a fact spread across a wide table may come back "Not stated yet". Pages longer than about 12 KB of text are cut to the lines that share words with the question. "No longer on the page" is covered by unit checks; the demo board adds lines but never removes one, so the demo does not show it. A question on a page changes the email rule for everyone on that board.

## Licence

MIT.
