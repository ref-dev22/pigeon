import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { inviteCode, requireMember, requireUser } from "./lib";

export const myBoards = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx).catch(() => null);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const boards = [];
    for (const m of memberships) {
      const board = await ctx.db.get(m.boardId);
      if (!board) continue;
      const watches = await ctx.db
        .query("watches")
        .withIndex("by_board", (q) => q.eq("boardId", board._id))
        .collect();
      boards.push({
        _id: board._id,
        name: board.name,
        role: m.role,
        watchCount: watches.length,
        changeCount: watches.reduce((n, w) => n + w.changeCount, 0),
        inboxAddress: board.inboxAddress ?? null,
      });
    }
    return boards;
  },
});

export const getBoard = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const { board, membership, userId } = await requireMember(ctx, boardId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .collect();
    const members = [];
    for (const m of memberships) {
      const u = await ctx.db.get(m.userId);
      members.push({
        userId: m.userId,
        name: u?.name ?? (u?.isAnonymous ? "Guest" : "Member"),
        role: m.role,
        notify: m.notify,
        hasEmail: !!(m.notifyEmail ?? u?.email),
        isMe: m.userId === userId,
      });
    }
    return {
      _id: board._id,
      name: board.name,
      inviteCode: board.inviteCode,
      inboxAddress: board.inboxAddress ?? null,
      inboxReady: !!board.inboxId,
      createdAt: board.createdAt,
      me: {
        role: membership.role,
        notify: membership.notify,
        notifyEmail: membership.notifyEmail ?? null,
      },
      members,
    };
  },
});

export const createBoard = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const trimmed = name.trim().slice(0, 60) || "My board";
    const boardId = await ctx.db.insert("boards", {
      name: trimmed,
      ownerId: userId,
      inviteCode: inviteCode(),
      createdAt: Date.now(),
    });
    const user = await ctx.db.get(userId);
    await ctx.db.insert("memberships", {
      boardId,
      userId,
      role: "owner",
      notify: true,
      notifyEmail: user?.email ?? undefined,
      joinedAt: Date.now(),
    });
    await ctx.db.insert("events", {
      boardId,
      kind: "board.created",
      message: `Board "${trimmed}" created.`,
      at: Date.now(),
    });
    // Give the board its own email inbox. Runs in the background; the board
    // works without it, it just cannot receive links by email yet.
    await ctx.scheduler.runAfter(0, internal.email.ensureInbox, { boardId });
    return boardId;
  },
});

export const renameBoard = mutation({
  args: { boardId: v.id("boards"), name: v.string() },
  handler: async (ctx, { boardId, name }) => {
    const { membership } = await requireMember(ctx, boardId);
    if (membership.role !== "owner") throw new Error("Only the owner can rename.");
    await ctx.db.patch(boardId, { name: name.trim().slice(0, 60) || "My board" });
  },
});

export const joinBoard = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode: code }) => {
    const userId = await requireUser(ctx);
    const board = await ctx.db
      .query("boards")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code.trim().toLowerCase()))
      .unique();
    if (!board) throw new Error("No board with that invite code.");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_board_user", (q) => q.eq("boardId", board._id).eq("userId", userId))
      .unique();
    if (existing) return board._id;
    const user = await ctx.db.get(userId);
    await ctx.db.insert("memberships", {
      boardId: board._id,
      userId,
      role: "member",
      notify: true,
      notifyEmail: user?.email ?? undefined,
      joinedAt: Date.now(),
    });
    await ctx.db.insert("events", {
      boardId: board._id,
      kind: "member.joined",
      message: `${user?.name ?? "A new member"} joined the board.`,
      at: Date.now(),
    });
    return board._id;
  },
});

export const updateNotifications = mutation({
  args: {
    boardId: v.id("boards"),
    notify: v.boolean(),
    notifyEmail: v.optional(v.string()),
  },
  handler: async (ctx, { boardId, notify, notifyEmail }) => {
    const { membership } = await requireMember(ctx, boardId);
    const email = notifyEmail?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("That does not look like an email address.");
    }
    await ctx.db.patch(membership._id, {
      notify,
      notifyEmail: email || undefined,
    });
  },
});

export const listEvents = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    await requireMember(ctx, boardId);
    return await ctx.db
      .query("events")
      .withIndex("by_board", (q) => q.eq("boardId", boardId))
      .order("desc")
      .take(40);
  },
});

export const setInbox = internalMutation({
  args: { boardId: v.id("boards"), inboxId: v.string(), inboxAddress: v.string() },
  handler: async (ctx, { boardId, inboxId, inboxAddress }) => {
    await ctx.db.patch(boardId, { inboxId, inboxAddress });
    await ctx.db.insert("events", {
      boardId,
      kind: "inbox.ready",
      message: "The board now has its own email address. Send it a link to start watching a page.",
      at: Date.now(),
    });
  },
});
