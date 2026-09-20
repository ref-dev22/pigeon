import { v } from "convex/values";
import { createTwoFilesPatch } from "diff";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components, internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { capBytes, hashText, isCosmeticDiff, stabilize } from "./lib";
import { decideNovelty, decideImportance, heuristicSummary, modelSummary, type Summary } from "./summarize";

const firecrawl = new FirecrawlClient(components.firecrawl);

// Convex documents are capped at 1 MB; keep page text well under that, in bytes.
const MAX_MARKDOWN_BYTES = 300_000;
const MAX_DIFF_BYTES = 150_000;

export const runDueChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const due: Id<"watches">[] = await ctx.runQuery(internal.watches.dueWatches, { limit: 20 });
    for (const watchId of due) {
      await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
    }
    return due.length;
  },
});

export const checkWatch = internalAction({
  args: { watchId: v.id("watches") },
  handler: async (ctx, { watchId }): Promise<void> => {
    const loaded = await ctx.runQuery(internal.watches.getWatchInternal, { watchId });
    if (!loaded) return;
    const { watch, latest } = loaded;
    if (watch.status === "paused") return;

    // 0. Finish anything a previous run left half-done (a model call that hung
    //    until the action was cut off). Idempotent: only changes without a
    //    summary are touched.
    await finalizePending(ctx, watchId, watch.url, watch.title, watch.focus);

    const claim = await ctx.runMutation(internal.watches.claimCheck, { watchId });
    if (claim === null) return;

    // 1. Fetch the page as markdown through Firecrawl. Firecrawl's own change
    //    tracking runs alongside our diff so the verdicts can be compared.
    let doc;
    try {
      doc = isLocalPlaceholderKey()
        ? await localFetchFallback(watch.url)
        : await firecrawl.scrape(ctx, watch.url, {
            formats: [
              "markdown",
              { type: "changeTracking", modes: ["git-diff"], tag: "pigeon-" + watch.boardId },
            ],
            onlyMainContent: true,
            blockAds: true,
            removeBase64Images: true,
            // Always fetch fresh: Firecrawl may otherwise serve a cached copy.
            maxAge: 0,
            timeout: 45_000,
          });
    } catch (e) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        claim,
        status: "error",
        lastError: trimError(e),
      });
      return;
    }

    // An error page with readable text must never replace a good baseline.
    const statusCode = typeof doc.metadata?.statusCode === "number" ? doc.metadata.statusCode : undefined;
    if ((statusCode !== undefined && statusCode >= 400) || doc.metadata?.error) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        claim,
        status: "error",
        lastError: doc.metadata?.error
          ? String(doc.metadata.error).slice(0, 300)
          : "The page returned HTTP " + statusCode + ".",
      });
      return;
    }

    const rawMarkdown = (doc.markdown ?? "").trim();
    if (!rawMarkdown) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        claim,
        status: "error",
        lastError: "The page returned no readable text.",
      });
      return;
    }
    const capped = capBytes(rawMarkdown, MAX_MARKDOWN_BYTES);
    const markdown = capped.text;
    const truncated = capped.truncated;
    const title = pickTitle(doc.metadata?.title, watch.url);
    const stable = stabilize(markdown);
    const contentHash = hashText(stable);

    const ct = (doc.changeTracking ?? {}) as Record<string, unknown>;
    const fcStatus = typeof ct.changeStatus === "string" ? ct.changeStatus : undefined;
    const fcPrev = typeof ct.previousScrapeAt === "string" ? ct.previousScrapeAt : undefined;

    // 2. Nothing meaningful changed: record the check and move on. The old
    //    hash is recomputed so a change to the normaliser never looks like a
    //    page change.
    if (latest && hashText(stabilize(latest.markdown)) === contentHash) {
      await ctx.runMutation(internal.watches.finishCheck, { watchId, claim, status: "ok", title });
      return;
    }

    // 3. Something changed (or this is the first look). Store the snapshot.
    const snapshotId = await ctx.runMutation(internal.watches.recordSnapshot, {
      watchId,
      markdown,
      contentHash,
      title,
      truncated,
      firecrawlChangeStatus: fcStatus,
      firecrawlPreviousScrapeAt: fcPrev,
    });
    if (!snapshotId) return;

    if (!latest) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        claim,
        status: "ok",
        title,
        latestSnapshotId: snapshotId,
      });
      return;
    }

    // 4. Build the diff on the stabilised text so noise lines do not show up.
    const fullDiff = createTwoFilesPatch(
      "before",
      "after",
      stabilize(latest.markdown) + "\n",
      stable + "\n",
      formatWhen(latest.fetchedAt),
      formatWhen(Date.now()),
      { context: 2 },
    );
    let addedLines = 0;
    let removedLines = 0;
    for (const line of fullDiff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) addedLines++;
      else if (line.startsWith("-") && !line.startsWith("---")) removedLines++;
    }
    const diffCapped = capBytes(fullDiff, MAX_DIFF_BYTES);
    const diff = diffCapped.truncated ? diffCapped.text + "\n...(truncated)" : diffCapped.text;
    const changeId = await ctx.runMutation(internal.watches.recordChange, {
      watchId,
      fromSnapshotId: latest._id,
      toSnapshotId: snapshotId,
      diff,
      addedLines,
      removedLines,
    });
    // The baseline advances before summarising, so a hung model call cannot
    // cause the same change to be recorded twice; finalizePending picks up
    // whatever is left.
    await ctx.runMutation(internal.watches.finishCheck, {
      watchId,
      claim,
      status: "ok",
      title,
      latestSnapshotId: snapshotId,
    });
    if (!changeId) return;

    // 5. Explain the change in plain language, then tell the board.
    await summariseAndNotify(ctx, changeId, diff, addedLines, removedLines, watch.url, title, watch.focus);
  },
});

type Ctx = ActionCtx;

async function finalizePending(
  ctx: Ctx,
  watchId: Id<"watches">,
  url: string,
  title: string | undefined,
  focus: string | undefined,
) {
  const pending = await ctx.runQuery(internal.watches.pendingChanges, { watchId });
  for (const c of pending) {
    await summariseAndNotify(ctx, c._id, c.diff, c.addedLines, c.removedLines, url, title, focus);
  }
}

async function summariseAndNotify(
  ctx: Ctx,
  changeId: Id<"changes">,
  diff: string,
  addedLines: number,
  removedLines: number,
  url: string,
  title: string | undefined,
  focus: string | undefined,
) {
  const quick = heuristicSummary(diff, focus);
  let summary: Summary = quick;
  // The models are skipped only when every changed line is recognisable
  // noise. A single meaningful line ("the pool is closed") always gets a
  // proper judgment.
  if (isCosmeticDiff(diff)) {
    summary = { ...quick, importance: 1 };
  } else {
    // Two models, two jobs: the decision model judges, the language model
    // writes. They run in parallel; either can be missing.
    const args = { diff, title, url, focus };
    const [decision, prose] = await Promise.all([decideImportance(args), modelSummary(args)]);
    summary = prose ?? quick;
    if (decision) {
      let importance = summary.importance;
      if (decision.confidence >= 0.5) importance = decision.importance;
      if (decision.touchesFocus !== null && decision.touchesFocus >= 0.8) importance = Math.max(importance, 4);
      // "Not worth an email" is trusted on its own: in evaluation every
      // cosmetic change scored 0.33 or below here, every real one 0.69+.
      if (decision.worthEmail < 0.4) importance = Math.min(importance, 1);
      summary = { ...summary, importance };
    } else if (summary.source === "heuristic" && addedLines + removedLines <= 2) {
      // No model available and only a line or two changed: stay cautious but
      // never below "minor", so a real single-line notice still shows up.
      summary = { ...summary, importance: Math.max(summary.importance, 2) };
    }
  }
  await ctx.runMutation(internal.watches.setSummary, {
    changeId,
    summary: summary.summary,
    importance: summary.importance,
    summarySource: summary.source,
  });
  // Alert fatigue gate: a page that has already produced three alerts today
  // is asked one more cheap question before a fourth email goes out. A page
  // flipping between two states, or a demo left running, stops here.
  let skipReason: string | undefined;
  if (summary.importance >= 2) {
    const change = await ctx.runQuery(internal.watches.getChangeInternal, { changeId });
    const recent = change
      ? await ctx.runQuery(internal.watches.recentAlerts, { watchId: change.watchId, exceptChangeId: changeId })
      : { count: 0, lastSummaries: [] as string[] };
    if (recent.count >= 3) {
      const novelty = await decideNovelty({ diff, newSummary: summary.summary, lastSummaries: recent.lastSummaries });
      if (novelty === null || novelty < 0.5) {
        skipReason =
          "Already alerted " + recent.count + " times today and this looks like more of the same. Logged, not emailed.";
      }
    }
  }
  await ctx.runMutation(internal.email.sendChangeEmail, { changeId, skipReason });
}

// Local development only. When the Firecrawl key is the documented
// placeholder, fetch the page directly and reduce the HTML to text so the
// diff, summary and email path can be exercised without an account.
// Production always goes through Firecrawl.
function isLocalPlaceholderKey(): boolean {
  return process.env.FIRECRAWL_API_KEY === "fc-local-placeholder";
}

async function localFetchFallback(url: string): Promise<{
  markdown?: string;
  changeTracking?: Record<string, unknown>;
  metadata?: { title?: string; statusCode?: number; error?: string };
}> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Pigeon/0.1 local dev)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n# ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|br)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return {
    markdown: body,
    changeTracking: { changeStatus: "unknown", source: "local-fallback" },
    metadata: { title, statusCode: res.status, error: res.ok ? undefined : "HTTP " + res.status },
  };
}

function pickTitle(t: unknown, url: string): string {
  const s = typeof t === "string" ? t.trim() : "";
  if (s) return s.slice(0, 120);
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// Errors are shown to people in the watch row, so they are rewritten as
// something a person can act on. Raw component errors never reach the UI.
function trimError(e: unknown): string {
  let s = e instanceof Error ? e.message : String(e);
  s = s.replace(/^Uncaught (ConvexError|Error): /, "").trim();
  const json = s.match(/{.*}/s);
  if (json) {
    try {
      const o = JSON.parse(json[0]) as { code?: string; status?: number; message?: string };
      if (o.code === "firecrawl_request_failed") {
        return "The page could not be fetched" + (o.status && o.status !== 200 ? " (HTTP " + o.status + ")" : "") + ". It may block automated readers; try again later.";
      }
      if (o.message) s = o.message;
    } catch {
      // not JSON after all
    }
  }
  if (/^not found$/i.test(s) || /404/.test(s)) return "Page not found (404). Check the address.";
  if (/(401|403)|forbidden|unauthori[sz]ed/i.test(s)) return "The page refused access. It may need a login.";
  if (/timeout|timed out/i.test(s)) return "The page took too long to respond. It will be tried again.";
  if (/5dd/.test(s)) return "The site returned a server error. It will be tried again.";
  return s.length > 160 ? s.slice(0, 157) + "..." : s;
}
