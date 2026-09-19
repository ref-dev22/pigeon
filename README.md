# Pigeon

**A newsletter for pages that don't have one.**

The pages people actually need to watch rarely have an RSS feed or a mailing list: a school's notice board, an embassy's appointment page, the building's community announcements, a clinic's schedule, a government fee table, a landlord's portal. People reload them, or miss the change.

Pigeon watches any web page on a schedule and emails you only when something meaningful changed, explained in two plain sentences, with the exact diff one click away. Households and small teams share a board, and every board has its own email address: send it a link and it starts watching.

Built for the [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas), September 2026.

## What it does

- **Watch a page** by pasting a URL, choosing how often to check (30 minutes to weekly), and optionally saying what you care about ("fees or deadlines").
- **Only real changes count.** Timestamps, visitor counters, cache-busting tokens and "last updated" lines are normalised away before comparing, so you are not woken up by noise.
- **Plain-language summary and an importance score** from 1 (cosmetic) to 5 (act now). A model writes it when a key is configured; a heuristic fallback still produces a useful line when it is not.
- **Exact diff** of the page text, colour-coded, for every change.
- **Email alerts** go to every member who opted in. Cosmetic changes are logged but not emailed.
- **Add pages by email.** Each board gets its own inbox. Email it a link (optionally with "hourly" or "daily" in the text) and the page is added; Pigeon replies with what it is now watching.
- **Shared boards** with invite links, live-updating for everyone at once.
- **Guest mode** so a judge can open the live URL and use the product immediately, plus email and password accounts for people who want to keep a board.

## How the sponsor stack does real work

| Piece | Role |
|---|---|
| **Convex** | Database, schema with indexes, queries and mutations, live updates on every screen, scheduled functions, a cron that picks up due pages, Convex Auth (anonymous and password), three registered components (Firecrawl, AgentMail, static hosting), and the frontend served from `convex.site`. |
| **Firecrawl** (`@firecrawl/firecrawl-convex`) | Every check scrapes the page to clean markdown with `onlyMainContent`, and asks for Firecrawl's own `changeTracking` verdict alongside Pigeon's diff. |
| **AgentMail** (`@agentmail/convex`) | One inbox per board. Sends the change alerts, receives links through the signed webhook, and replies to the sender. |
| **OpenAI-compatible model** | Turns the unified diff into the summary and importance score. Any OpenAI-compatible endpoint works through `OPENAI_BASE_URL`. |

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
npx convex env set OPENAI_API_KEY sk-...           # optional; heuristic summaries without it
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
  summarize.ts     model summary with heuristic fallback
  email.ts         board inbox creation, alert sending, inbound link handling
  crons.ts         every 5 minutes: run due checks
  auth.ts, http.ts Convex Auth, AgentMail webhook, static routes
src/
  App.tsx          landing, board, watch detail, change/diff views
```

## Honest limits

- Pages behind logins or heavy bot protection may not scrape.
- The importance score is a judgment call by a model or a heuristic, not a guarantee.
- A board watches at most 25 pages, at most every 30 minutes, to stay within free tiers.

## Licence

MIT.
