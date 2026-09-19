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
  handler: httpAction(async (ctx, req) => agentmail.handleWebhook(ctx, req)),
});

export default http;
