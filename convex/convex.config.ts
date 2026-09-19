import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";

// The static-hosting component owns "/" so the built frontend is served from
// the convex.site domain. Our own HTTP routes (auth, webhooks) live under /api.
const app = defineApp({
  httpPrefix: "/api",
  env: {
    FIRECRAWL_API_KEY: v.string(),
  },
});

app.use(staticHosting, { httpPrefix: "/" });
app.use(firecrawl, {
  env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY },
});
app.use(agentmail);

export default app;
