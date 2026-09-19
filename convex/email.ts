import { v } from "convex/values";
import { AgentMail } from "@agentmail/convex";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { clampInterval, DEFAULT_INTERVAL, extractUrls } from "./lib";

// Pigeon uses one AgentMail inbox for the whole deployment
// (AGENTMAIL_INBOX_ID). It sends every change alert, and it accepts links:
// anyone who emails a URL to that address from the email they saved for
// alerts gets the page added to their board(s), with a reply confirming it.
export const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onMessageReceived,
});

export const ensureInbox = internalAction({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const inboxId = process.env.AGENTMAIL_INBOX_ID;
    if (!process.env.AGENTMAIL_API_KEY || !inboxId) {
      console.warn("AGENTMAIL_API_KEY or AGENTMAIL_INBOX_ID is not set; email disabled.");
      await ctx.runMutation(internal.boards.logEvent, {
        boardId,
        kind: "inbox.unavailable",
        message:
          "Email is not configured on this deployment yet, so this board has no inbox and sends no alerts.",
      });
      return;
    }
    await ctx.runMutation(internal.boards.setInbox, {
      boardId,
      inboxId,
      inboxAddress: inboxId,
    });
  },
});

// Runs when a change has been recorded and summarised.
export const sendChangeEmail = internalMutation({
  args: { changeId: v.id("changes") },
  handler: async (ctx, { changeId }) => {
    const change = await ctx.db.get(changeId);
    if (!change) return;
    const watch = await ctx.db.get(change.watchId);
    const board = await ctx.db.get(change.boardId);
    if (!watch || !board) return;
    const inboxId = board.inboxId ?? process.env.AGENTMAIL_INBOX_ID;
    if (!inboxId) {
      await ctx.db.patch(changeId, {
        emailStatus: "skipped",
        emailError: "Board has no email inbox yet.",
      });
      return;
    }
    // Trivial changes (importance 1) are logged but not emailed.
    if ((change.importance ?? 3) <= 1) {
      await ctx.db.patch(changeId, {
        emailStatus: "skipped",
        emailError: "Cosmetic change, not worth an email.",
      });
      return;
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_board", (q) => q.eq("boardId", change.boardId))
      .collect();
    const recipients: string[] = [];
    for (const m of memberships) {
      if (!m.notify) continue;
      const user = await ctx.db.get(m.userId);
      const email = m.notifyEmail ?? user?.email;
      if (email && !recipients.includes(email)) recipients.push(email);
    }
    if (recipients.length === 0) {
      await ctx.db.patch(changeId, {
        emailStatus: "skipped",
        emailError: "No member has an email address for alerts.",
      });
      return;
    }
    const title = watch.title ?? watch.url;
    const stars = "!".repeat(Math.max(1, (change.importance ?? 3) - 2));
    const appUrl = process.env.APP_URL ?? process.env.CONVEX_SITE_URL ?? "";
    const link = appUrl ? appUrl.replace(/\/$/, "") + "/#/change/" + changeId : "";
    const text =
      "Pigeon noticed a change on: " + title + "\n" +
      watch.url + "\n\n" +
      (change.summary ?? "The page changed.") + "\n\n" +
      "+" + change.addedLines + " lines, -" + change.removedLines + " lines. " +
      (link ? "See the exact diff: " + link + "\n\n" : "\n") +
      "You get this because you are on the board \"" + board.name + "\". " +
      "Reply to this email with a link to start watching another page.";
    const html =
      "<div style=\"font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;color:#1f2937\">" +
      "<p style=\"margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280\">Pigeon " + escapeHtml(stars) + "</p>" +
      "<h2 style=\"margin:0 0 4px;font-size:18px\">" + escapeHtml(title) + "</h2>" +
      "<p style=\"margin:0 0 16px;font-size:13px\"><a href=\"" + escapeHtml(watch.url) + "\" style=\"color:#2563eb\">" + escapeHtml(watch.url) + "</a></p>" +
      "<p style=\"font-size:16px;line-height:1.5;margin:0 0 16px\">" + escapeHtml(change.summary ?? "The page changed.") + "</p>" +
      "<p style=\"font-size:13px;color:#6b7280;margin:0 0 16px\">+" + change.addedLines + " lines, -" + change.removedLines + " lines" +
      (link ? " · <a href=\"" + escapeHtml(link) + "\" style=\"color:#2563eb\">see the exact diff</a>" : "") + "</p>" +
      "<hr style=\"border:0;border-top:1px solid #e5e7eb;margin:16px 0\">" +
      "<p style=\"font-size:12px;color:#6b7280;margin:0\">You are on the board “" + escapeHtml(board.name) + "”. Reply with a link to start watching another page.</p>" +
      "</div>";
    try {
      await agentmail.sendMessage(ctx, inboxId, {
        to: recipients,
        subject: "Changed: " + title.slice(0, 80),
        text,
        html,
        labels: ["pigeon", "change"],
      });
      await ctx.db.patch(changeId, { emailStatus: "sent", emailError: undefined });
      await ctx.db.insert("events", {
        boardId: change.boardId,
        kind: "email.sent",
        message: "Emailed " + recipients.length + " member(s) about " + title,
        watchId: watch._id,
        changeId,
        at: Date.now(),
      });
    } catch (e) {
      await ctx.db.patch(changeId, {
        emailStatus: "failed",
        emailError: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      });
    }
  },
});

// Inbound mail: someone emailed the shared inbox. Find their board(s) by the
// sender address, pull out links and start watching.
export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  handler: async (ctx, { message }) => {
    const msg = message as {
      inbox_id?: string;
      message_id?: string;
      from?: string | { email?: string; address?: string };
      subject?: string;
      text?: string;
      html?: string;
    };
    const inboxId = msg.inbox_id ?? process.env.AGENTMAIL_INBOX_ID;
    if (!inboxId) return;
    const sender = parseAddress(msg.from);

    // Boards this sender belongs to, matched on the alert email they saved,
    // or on the account email for password users.
    const boards: Doc<"boards">[] = [];
    if (sender) {
      const byNotify = await ctx.db
        .query("memberships")
        .withIndex("by_notifyEmail", (q) => q.eq("notifyEmail", sender))
        .collect();
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", sender))
        .collect();
      const byUser = [];
      for (const u of users) {
        byUser.push(
          ...(await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", u._id))
            .collect()),
        );
      }
      const seen = new Set<string>();
      for (const m of [...byNotify, ...byUser]) {
        if (seen.has(m.boardId)) continue;
        seen.add(m.boardId);
        const b = await ctx.db.get(m.boardId);
        if (b) boards.push(b);
      }
    }

    const body = (msg.text ?? "") + "\n" + stripTags(msg.html ?? "") + "\n" + (msg.subject ?? "");
    const urls = extractUrls(body).filter((u) => !/mailto:|unsubscribe|agentmail|convex\.site/i.test(u));

    // Optional interval hint in the subject or body, e.g. "hourly" / "daily".
    let interval = DEFAULT_INTERVAL;
    const lower = body.toLowerCase();
    if (/\b(hourly|every hour|every 1h|1h)\b/.test(lower)) interval = 60;
    else if (/\b(daily|every day|once a day|24h)\b/.test(lower)) interval = 1440;
    else if (/\b(weekly|every week)\b/.test(lower)) interval = 10080;
    else if (/\bevery 30 ?min/.test(lower)) interval = 30;
    interval = clampInterval(interval);

    // If the subject names one of the sender's boards, use only that one.
    const subjectLower = (msg.subject ?? "").toLowerCase();
    const named = boards.filter((b) => subjectLower.includes(b.name.toLowerCase()));
    const targets = named.length ? named : boards;

    const added: string[] = [];
    const already: string[] = [];
    for (const board of targets) {
      for (const url of urls.slice(0, 5)) {
        const existing = await ctx.db
          .query("watches")
          .withIndex("by_board_url", (q) => q.eq("boardId", board._id).eq("url", url))
          .unique();
        if (existing) {
          if (!already.includes(url)) already.push(url);
          continue;
        }
        const now = Date.now();
        const watchId = await ctx.db.insert("watches", {
          boardId: board._id,
          url,
          intervalMinutes: interval,
          source: "email",
          status: "pending",
          nextCheckAt: now,
          checkCount: 0,
          changeCount: 0,
          createdAt: now,
        });
        await ctx.db.insert("events", {
          boardId: board._id,
          kind: "watch.added",
          message: "A link arrived by email; now watching " + url,
          watchId,
          at: now,
        });
        await ctx.scheduler.runAfter(0, internal.checks.checkWatch, { watchId });
        if (!added.includes(url)) added.push(url);
      }
      await ctx.db.insert("events", {
        boardId: board._id,
        kind: "email.received",
        message:
          "Email received" +
          (added.length ? ": " + added.length + " new page(s) added" : ": no new links found") +
          ".",
        at: Date.now(),
      });
    }

    // Reply so the sender knows what happened.
    if (!msg.message_id) return;
    const lines: string[] = [];
    if (!sender || boards.length === 0) {
      lines.push(
        "Thanks for writing to Pigeon. I could not match your address to a board.",
        "Open your board, put this email address in \"Where should your alerts go?\", save, and send the link again.",
      );
    } else if (urls.length === 0) {
      lines.push(
        "I did not find a web link in your message. Send me a URL (starting with http) and I will watch that page for changes.",
      );
    } else {
      if (added.length) {
        lines.push("Got it. Now watching:");
        for (const u of added) lines.push("  • " + u);
        lines.push(
          "",
          "I check every " + humanInterval(interval) + " and email the board only when something meaningful changes.",
        );
      }
      if (already.length) lines.push("Already watching: " + already.join(", "));
      lines.push("", "Board" + (targets.length > 1 ? "s" : "") + ": " + targets.map((b) => b.name).join(", "));
    }
    lines.push("", "— Pigeon");
    try {
      await agentmail.replyToMessage(ctx, inboxId, msg.message_id, {
        text: lines.join("\n"),
        labels: ["pigeon", "auto-reply"],
      });
    } catch (e) {
      console.warn("reply failed", String(e));
    }
  },
});

function parseAddress(from: unknown): string | null {
  if (!from) return null;
  if (typeof from === "object") {
    const o = from as { email?: string; address?: string };
    const s = o.email ?? o.address;
    return s ? s.trim().toLowerCase() : null;
  }
  const s = String(from);
  const m = /<([^>]+)>/.exec(s);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanInterval(minutes: number): string {
  if (minutes < 60) return minutes + " minutes";
  if (minutes < 1440) return minutes / 60 + " hour" + (minutes === 60 ? "" : "s");
  if (minutes < 10080) return minutes / 1440 + " day" + (minutes === 1440 ? "" : "s");
  return "week";
}
