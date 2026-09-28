import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Static hosting runs in "app-owned" mode: the frontend is served from the
// convex.site domain by routes we register in convex/http.ts, so our own
// root routes (Convex Auth discovery, the AgentMail webhook) keep working.
//
// Components do not inherit the deployment's env vars; each key a component
// needs is declared here and passed by reference.
const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    // Optional: without it the app runs with email disabled and says so.
    AGENTMAIL_API_KEY: v.optional(v.string()),
  },
});

app.use(staticHosting);
app.use(firecrawl, {
  env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY },
});
app.use(agentmail, {
  env: { AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY },
});

// SPEC-019: limits how fast one person can ask questions or request
// suggestions, since each costs a model call.
app.use(rateLimiter);

export default app;
