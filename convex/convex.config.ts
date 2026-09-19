import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";

// Static hosting runs in "app-owned" mode: the frontend is served from the
// convex.site domain by routes we register in convex/http.ts, so our own
// root routes (Convex Auth discovery, the AgentMail webhook) keep working.
const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
  },
});

app.use(staticHosting);
app.use(firecrawl, {
  env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY },
});
app.use(agentmail);

export default app;
