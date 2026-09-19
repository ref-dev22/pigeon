import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { components } from "./_generated/api";
import { agentmail } from "./email";

const http = httpRouter();

// Convex Auth: sign-in endpoints and OpenID discovery at the root.
auth.addHttpRoutes(http);

// AgentMail delivers inbound mail here. The handle from email.ts carries the
// onMessageReceived callback; a bare handle would verify and store the event
// but never route the mail. Register
// https://<deployment>.convex.site/agentmail/webhook in the AgentMail dashboard.
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // The component types its ctx against a slightly older convex release; the
  // runtime object is the same.
  handler: httpAction(async (ctx, req) =>
    agentmail.handleWebhook(ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0], req),
  ),
});

// Everything else: the built frontend, served from Convex storage with an
// index.html fallback for client-side routes.
registerStaticRoutes(http, components.staticHosting);

export default http;
