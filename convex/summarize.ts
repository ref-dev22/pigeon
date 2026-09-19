// Turn a raw diff into two plain sentences a busy person can act on.
// Uses any OpenAI-compatible chat endpoint. If no key is configured the
// heuristic fallback still produces something useful, so the product works
// end to end without a paid model.

export type Summary = {
  summary: string;
  importance: number; // 1 trivial .. 5 act now
  source: "model" | "heuristic";
};

const KEYWORDS_HIGH = [
  "deadline",
  "closes",
  "closing",
  "last day",
  "cancel",
  "cancelled",
  "canceled",
  "suspended",
  "no longer",
  "price",
  "fee",
  "fees",
  "aed",
  "usd",
  "eur",
  "$",
  "€",
  "required",
  "mandatory",
  "urgent",
  "sold out",
  "out of stock",
  "in stock",
  "available",
  "new date",
  "postponed",
  "rescheduled",
];

export function heuristicSummary(diff: string, focus?: string): Summary {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 2 && !/^[-=*_#|]+$/.test(l));
  const removed = diff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 2 && !/^[-=*_#|]+$/.test(l));

  const text = (added.join(" ") + " " + removed.join(" ")).toLowerCase();
  let importance = 2;
  if (added.length + removed.length > 12) importance = 3;
  if (KEYWORDS_HIGH.some((k) => text.includes(k))) importance = Math.max(importance, 4);
  if (focus && focus.split(/\s+/).some((w) => w.length > 3 && text.includes(w.toLowerCase()))) {
    importance = 5;
  }
  if (added.length + removed.length <= 1 && !KEYWORDS_HIGH.some((k) => text.includes(k))) {
    importance = 1;
  }

  const clip = (s: string) => (s.length > 140 ? s.slice(0, 137) + "..." : s);
  let summary: string;
  if (added.length && removed.length) {
    summary =
      "New: " + clip(added[0]) + (added.length > 1 ? " (+" + (added.length - 1) + " more)" : "") +
      " Removed: " + clip(removed[0]) + (removed.length > 1 ? " (+" + (removed.length - 1) + " more)" : "");
  } else if (added.length) {
    summary = "Added: " + clip(added[0]) + (added.length > 1 ? " and " + (added.length - 1) + " more line(s)." : "");
  } else if (removed.length) {
    summary = "Removed: " + clip(removed[0]) + (removed.length > 1 ? " and " + (removed.length - 1) + " more line(s)." : "");
  } else {
    summary = "The page changed, but only in formatting.";
    importance = 1;
  }
  return { summary, importance, source: "heuristic" };
}

export async function modelSummary(args: {
  diff: string;
  title?: string;
  url: string;
  focus?: string;
}): Promise<Summary | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

  const diff = args.diff.length > 12000 ? args.diff.slice(0, 12000) + "\n...(truncated)" : args.diff;
  const system =
    "You write change alerts for a page-watching service. A person asked to be told when a web page changes. " +
    "Given a unified diff of the page text, reply with JSON only: " +
    '{"summary": string, "importance": number}. ' +
    "summary: at most two short sentences, plain language, say exactly what changed and why it might matter. No preamble. " +
    "importance: 1 = cosmetic or automatic (dates, counters, ads), 2 = minor wording, 3 = worth reading, 4 = affects money, dates or availability, 5 = the reader should act now. " +
    (args.focus ? 'The reader said what they care about: "' + args.focus + '". Rate 5 only if the change touches that.' : "");
  const user =
    "Page: " + (args.title ? args.title + " (" + args.url + ")" : args.url) + "\n\nDiff:\n" + diff;

  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 300,
      }),
    });
    if (!res.ok) {
      console.warn("summary model returned", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { summary?: unknown; importance?: unknown };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const importance =
      typeof parsed.importance === "number" ? Math.min(5, Math.max(1, Math.round(parsed.importance))) : 3;
    if (!summary) return null;
    return { summary: summary.slice(0, 400), importance, source: "model" };
  } catch (e) {
    console.warn("summary model failed", String(e));
    return null;
  }
}
