import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { components } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

const http = httpRouter();

// Convex Auth routes (served under /api because of httpPrefix in convex.config.ts).
auth.addHttpRoutes(http);

// AgentMail delivers inbound mail here. Register
// https://<deployment>.convex.site/api/agentmail/webhook in the AgentMail dashboard.
const agentmail = new AgentMail(components.agentmail);
http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // The component types its ctx against a slightly older convex release; the
  // runtime object is the same.
  handler: httpAction(async (ctx, req) =>
    agentmail.handleWebhook(ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0], req),
  ),
});

export default http;
