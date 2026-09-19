import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every five minutes, pick up any page whose next check is due.
crons.interval("check due pages", { minutes: 5 }, internal.checks.runDueChecks, {});

export default crons;
