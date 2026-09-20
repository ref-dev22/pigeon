import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { query } from "./_generated/server";

// Anonymous lets a judge open the live URL and use the app immediately.
// Password lets a real household keep a board across devices.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Anonymous,
    // Emails are canonicalised so Alice@Example.com and alice@example.com are
    // one account, and so inbound-mail routing (which lowercases the sender)
    // matches the stored address.
    Password({
      profile(params) {
        return { email: String(params.email ?? "").trim().toLowerCase() };
      },
    }),
  ],
});

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      isAnonymous: user.isAnonymous ?? false,
    };
  },
});
