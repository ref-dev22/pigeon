import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in first.");
  return userId;
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  boardId: Id<"boards">,
): Promise<{ userId: Id<"users">; board: Doc<"boards">; membership: Doc<"memberships"> }> {
  const userId = await requireUser(ctx);
  const board = await ctx.db.get(boardId);
  if (!board) throw new Error("Board not found.");
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_board_user", (q) => q.eq("boardId", boardId).eq("userId", userId))
    .unique();
  if (!membership) throw new Error("You are not a member of this board.");
  return { userId, board, membership };
}

export function inviteCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) pages can be watched.");
  // Keep the scraper away from private networks. Local development with the
  // placeholder Firecrawl key is the one exception (it fetches directly).
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === "[::1]" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd") ||
    host.startsWith("[fe80");
  if (isPrivate && process.env.FIRECRAWL_API_KEY !== "fc-local-placeholder") {
    throw new Error("That address is on a private network and cannot be watched.");
  }
  u.hash = "";
  // Drop common tracking params so the same page is not watched twice.
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>()\[\]"']+/gi;
  const found = text.match(re) ?? [];
  const out: string[] = [];
  for (const f of found) {
    const cleaned = f.replace(/[.,;:!?)]+$/, "");
    try {
      const n = normalizeUrl(cleaned);
      if (!out.includes(n)) out.push(n);
    } catch {
      // ignore junk
    }
  }
  return out;
}

export const INTERVALS = [30, 60, 180, 360, 720, 1440, 4320, 10080] as const;
export const DEFAULT_INTERVAL = 360;

// The app's own demo notice board may be checked every 10 minutes; nothing
// else can, to protect the free tiers.
export function isDemoPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/demo/notices" && u.hostname.endsWith(".convex.site");
  } catch {
    return false;
  }
}

export function clampInterval(minutes: number, url?: string): number {
  if (url && isDemoPage(url) && minutes === 10) return 10;
  const allowed = INTERVALS as readonly number[];
  return allowed.includes(minutes) ? minutes : DEFAULT_INTERVAL;
}

// Small stable hash for change detection, FNV-1a 32-bit over the string.
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + ":" + s.length;
}

// Strip lines that change on every load (dates, counters, tokens) before
// deciding whether a page "really" changed.
export function stabilize(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      // Times, dates and amounts are kept: "closes at 20:00" and "AED 1,500"
      // are real content. Only machine noise is normalised: counters on lines
      // that say they are counters, long query strings, hashes.
      (/\b(visitors?|views?|online now|members online|followers|likes|hits|page ?views)\b/i.test(line)
        ? line.replace(/\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b/g, "<n>")
        : line
      )
        .replace(/\?[A-Za-z0-9_=&%.-]{20,}/g, "?<q>")
        .replace(/[A-Fa-f0-9]{24,}/g, "<hex>")
        .trimEnd(),
    )
    .filter((l) => !/^\s*(last updated|updated on|page generated|generated at)/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
