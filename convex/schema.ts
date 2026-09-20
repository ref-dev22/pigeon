import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // A board is a shared space (a household, a small team, a class group).
  boards: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    inviteCode: v.string(),
    // AgentMail inbox that belongs to this board. Anyone can email a link to it.
    inboxId: v.optional(v.string()),
    inboxAddress: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_inviteCode", ["inviteCode"])
    .index("by_inboxId", ["inboxId"]),

  memberships: defineTable({
    boardId: v.id("boards"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    // Where change emails for this board go for this member.
    notifyEmail: v.optional(v.string()),
    notify: v.boolean(),
    joinedAt: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_user", ["userId"])
    .index("by_board_user", ["boardId", "userId"])
    .index("by_notifyEmail", ["notifyEmail"]),

  // A watched page.
  watches: defineTable({
    boardId: v.id("boards"),
    url: v.string(),
    title: v.optional(v.string()),
    // How often to check, in minutes.
    intervalMinutes: v.number(),
    // Optional plain-language focus, e.g. "only tell me about fee changes".
    focus: v.optional(v.string()),
    addedBy: v.optional(v.id("users")),
    // "email" when the watch was added by mailing a link to the board inbox.
    source: v.union(v.literal("web"), v.literal("email")),
    status: v.union(
      v.literal("pending"),
      v.literal("ok"),
      v.literal("error"),
      v.literal("paused"),
    ),
    lastError: v.optional(v.string()),
    // Set while a check is running so overlapping triggers do not double-scrape.
    checkingSince: v.optional(v.number()),
    // For the app's own demo notice page: 0 = original notice, 1 = changed.
    demoPhase: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    nextCheckAt: v.number(),
    lastChangedAt: v.optional(v.number()),
    latestSnapshotId: v.optional(v.id("snapshots")),
    checkCount: v.number(),
    changeCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_nextCheck", ["status", "nextCheckAt"])
    .index("by_board_url", ["boardId", "url"]),

  // Every fetched version of a page. Content is markdown from Firecrawl.
  snapshots: defineTable({
    watchId: v.id("watches"),
    boardId: v.id("boards"),
    markdown: v.string(),
    contentHash: v.string(),
    title: v.optional(v.string()),
    fetchedAt: v.number(),
    // Firecrawl's own change tracking verdict, when returned.
    firecrawlChangeStatus: v.optional(v.string()),
    firecrawlPreviousScrapeAt: v.optional(v.string()),
    truncated: v.boolean(),
  })
    .index("by_watch", ["watchId", "fetchedAt"]),

  // A detected change between two snapshots, with the diff and a summary.
  changes: defineTable({
    watchId: v.id("watches"),
    boardId: v.id("boards"),
    fromSnapshotId: v.optional(v.id("snapshots")),
    toSnapshotId: v.id("snapshots"),
    // Unified diff of the markdown.
    diff: v.string(),
    addedLines: v.number(),
    removedLines: v.number(),
    // Plain-language summary produced by the model, or a heuristic fallback.
    summary: v.optional(v.string()),
    summarySource: v.optional(
      v.union(v.literal("model"), v.literal("heuristic")),
    ),
    // 1 = trivial (timestamps, counters), 3 = worth reading, 5 = act now.
    importance: v.optional(v.number()),
    detectedAt: v.number(),
    emailStatus: v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("sent"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    emailError: v.optional(v.string()),
    // AgentMail component outbound id, used to sync the real send status.
    emailOutboundId: v.optional(v.string()),
    // Members who marked this change as read.
    readBy: v.array(v.id("users")),
  })
    .index("by_watch", ["watchId", "detectedAt"])
    .index("by_board", ["boardId", "detectedAt"])
    .index("by_emailStatus", ["emailStatus"]),

  // Activity feed for a board: watch added, page changed, email sent, link mailed in.
  events: defineTable({
    boardId: v.id("boards"),
    kind: v.string(),
    message: v.string(),
    watchId: v.optional(v.id("watches")),
    changeId: v.optional(v.id("changes")),
    at: v.number(),
  }).index("by_board", ["boardId", "at"]),
});
