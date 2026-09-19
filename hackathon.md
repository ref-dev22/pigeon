# Hackathon log

- **Project:** Pigeon
- **Event:** Convex All Gas Hackathon
- **What it does:** Watches any web page on a schedule and emails a shared board a plain-language summary when the page really changes, with the exact diff one click away; boards can also be fed links by email.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/static-hosting, @firecrawl/firecrawl-convex, @agentmail/convex
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, realtime queries
- **Auth:** Convex Auth
- **AI models:** none configured yet (OpenAI-compatible endpoint, model set by `OPENAI_MODEL`; heuristic fallback in use)
- **Started:** 2026-09-19T16:33:05Z
- **Last updated:** 2026-09-19T17:10:00Z

## Log

### 2026-09-19 - dcfc64c
Laid out the data model: boards with invite codes and an optional board inbox, memberships with per-member notification settings, watches with a check interval and next-check time, snapshots of page text, detected changes with a diff and summary, and an activity feed. Indexes cover board membership lookups, due-check scanning by status and time, and per-watch history. Convex features: schema, tables, indexes (`convex/schema.ts`).

Wrote the check pipeline as an internal action: fetch the page through the Firecrawl component as markdown with change tracking, normalise volatile lines (timestamps, counters, tokens), hash, compare with the last snapshot, store a new snapshot on change, build a unified diff, summarise it, and hand off to email. A cron every five minutes schedules checks for pages whose next check is due; adding a page schedules its first check immediately. Convex features: actions, crons, scheduled functions, internal queries and mutations (`convex/checks.ts`, `convex/crons.ts`, `convex/watches.ts`).

Wired email through the AgentMail component: each new board gets its own inbox in the background, change alerts go to opted-in members from that inbox, cosmetic changes are logged but not emailed, and inbound mail to a board inbox is parsed for links which become new watches, with an automatic reply listing what is now watched. The webhook is mounted as an HTTP action. Convex features: HTTP actions, mutations (`convex/email.ts`, `convex/http.ts`).

Set up Convex Auth with anonymous and password providers so a judge can use the live app without signing up, and registered the static-hosting component so the frontend can be served from `convex.site` (`convex/auth.ts`, `convex/convex.config.ts`).

### 2026-09-19 - 9825e4c
Built the React frontend: landing page, guest and email sign-in, automatic first board, board screen with an add-page form, a live list of watched pages showing status and the latest summary, a live "what changed" feed with importance chips, board panel with invite link, board email address, member list and alert settings, an activity feed, a page-detail screen with settings, snapshots and current text, and a change screen with the colour-coded diff. All lists update in place as checks finish. Convex features: realtime queries, mutations (`src/App.tsx`, `src/styles.css`).

### 2026-09-19 - working tree
Moved static hosting to app-owned mode so Convex Auth's discovery endpoint stays at the root; the AgentMail webhook and the static routes are registered explicitly in the router (`convex/http.ts`, `convex/convex.config.ts`).

Added a local-development fallback that fetches a page directly when the Firecrawl key is the documented placeholder, so the diff, summary and notification path can be tested without an account; production always uses Firecrawl (`convex/checks.ts`). Logged a board event when email is not configured on the deployment so the gap is visible in the activity feed rather than silent (`convex/email.ts`, `convex/boards.ts`).

Verified locally on an anonymous deployment: guest sign-in, board creation, adding a page, first snapshot, a real content change detected with the visitor counter and timestamp correctly ignored (+3/-2 lines), heuristic summary with importance 4, email correctly skipped with a reason, and the diff view. Production build passes.
