import { v } from "convex/values";
import { createTwoFilesPatch } from "diff";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hashText, stabilize } from "./lib";
import { decideImportance, heuristicSummary, modelSummary } from "./summarize";

const firecrawl = new FirecrawlClient(components.firecrawl);

// Convex documents are capped at 1 MB; keep page text well under that.
const MAX_MARKDOWN = 400_000;

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
    const claimed = await ctx.runMutation(internal.watches.claimCheck, { watchId });
    if (!claimed) return;

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
            timeout: 45_000,
          });
    } catch (e) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        status: "error",
        lastError: trimError(e),
      });
      return;
    }

    const rawMarkdown = (doc.markdown ?? "").trim();
    if (!rawMarkdown) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        status: "error",
        lastError: doc.metadata?.error
          ? String(doc.metadata.error)
          : "The page returned no readable text (status " + (doc.metadata?.statusCode ?? "unknown") + ").",
      });
      return;
    }
    const truncated = rawMarkdown.length > MAX_MARKDOWN;
    const markdown = truncated ? rawMarkdown.slice(0, MAX_MARKDOWN) : rawMarkdown;
    const title = pickTitle(doc.metadata?.title, watch.url);
    const stable = stabilize(markdown);
    const contentHash = hashText(stable);

    const ct = (doc.changeTracking ?? {}) as Record<string, unknown>;
    const fcStatus = typeof ct.changeStatus === "string" ? ct.changeStatus : undefined;
    const fcPrev = typeof ct.previousScrapeAt === "string" ? ct.previousScrapeAt : undefined;

    // 2. Nothing meaningful changed: record the check and move on.
    if (latest && latest.contentHash === contentHash) {
      await ctx.runMutation(internal.watches.finishCheck, {
        watchId,
        status: "ok",
        title,
      });
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
        status: "ok",
        title,
        latestSnapshotId: snapshotId,
      });
      return;
    }

    // 4. Build the diff on the stabilised text so noise lines do not show up.
    const diff = createTwoFilesPatch(
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
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) addedLines++;
      else if (line.startsWith("-") && !line.startsWith("---")) removedLines++;
    }
    const changeId = await ctx.runMutation(internal.watches.recordChange, {
      watchId,
      fromSnapshotId: latest._id,
      toSnapshotId: snapshotId,
      diff: diff.length > 200_000 ? diff.slice(0, 200_000) + "\n...(truncated)" : diff,
      addedLines,
      removedLines,
    });
    await ctx.runMutation(internal.watches.finishCheck, {
      watchId,
      status: "ok",
      title,
      latestSnapshotId: snapshotId,
    });
    if (!changeId) return;

    // 5. Explain the change in plain language, then tell the board. The
    //    heuristic runs first; the model is only paid for when the change is
    //    more than cosmetic.
    const quick = heuristicSummary(diff, watch.focus);
    let summary = quick;
    if (!(quick.importance <= 1 && addedLines + removedLines <= 2)) {
      // Two models, two jobs: the decision model judges, the language model
      // writes. They run in parallel; either can be missing.
      const args = { diff, title, url: watch.url, focus: watch.focus };
      const [decision, prose] = await Promise.all([decideImportance(args), modelSummary(args)]);
      summary = prose ?? quick;
      if (decision && decision.confidence >= 0.5) {
        let importance = decision.importance;
        if (decision.touchesFocus !== null && decision.touchesFocus >= 0.8) importance = Math.max(importance, 4);
        if (decision.worthEmail < 0.3) importance = Math.min(importance, 1);
        summary = { ...summary, importance };
      }
    }
    await ctx.runMutation(internal.watches.setSummary, {
      changeId,
      summary: summary.summary,
      importance: summary.importance,
      summarySource: summary.source,
    });
    await ctx.runMutation(internal.email.sendChangeEmail, { changeId });
  },
});

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

function trimError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 300 ? s.slice(0, 297) + "..." : s;
}
