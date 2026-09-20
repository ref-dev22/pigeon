import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every five minutes, pick up any page whose next check is due.
crons.interval("check due pages", { minutes: 5 }, internal.checks.runDueChecks, {});

// Once a day, pause pages on boards where nobody ever saved an alert email.
crons.interval("expire idle guest watches", { hours: 24 }, internal.admin.expireIdleGuestWatches, {});

export default crons;
