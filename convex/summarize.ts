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

// Structured decision about a change from a "System One" decision model
// (TypeSafe Jev via OpenRouter's decisions endpoint). It does not write prose;
// it returns typed judgments with probabilities, which is exactly what the
// importance score and the "is this worth an email" gate need.
export type Decision = {
  importance: number; // 1..5
  confidence: number; // 0..1
  worthEmail: number; // probability 0..1
  touchesFocus: number | null; // probability, or null when no focus was given
};

export async function decideImportance(args: {
  diff: string;
  title?: string;
  url: string;
  focus?: string;
}): Promise<Decision | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.DECISION_MODEL;
  if (!apiKey || !model) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/v1\/?$/, "");
  const diff = args.diff.length > 16000 ? args.diff.slice(0, 16000) + "\n...(truncated)" : args.diff;
  const questions: Record<string, unknown> = {
    importance: {
      type: "score",
      instructions:
        "How important is this page change for a reader who asked to be emailed when the page really changes?",
      criteria: [
        "Cosmetic or automatic: timestamps, counters, ads, formatting",
        "Minor wording with no practical effect",
        "Worth reading but no action needed",
        "Affects money, dates, availability or requirements",
        "The reader should act now",
      ],
    },
    worth_email: {
      type: "noul",
      instructions: "Should the reader receive an email about this change right now?",
      criteria: {
        true: "The change carries real information the reader would want to know",
        false: "Noise, cosmetic, or automatic content only",
      },
    },
  };
  if (args.focus) {
    questions.touches_focus = {
      type: "noul",
      instructions: "Does the change touch what the reader said they care about (reader_focus)?",
      criteria: {
        true: "The changed text concerns the reader focus",
        false: "Unrelated to the reader focus",
      },
    };
  }
  try {
    const res = await fetch(baseUrl + "/alpha/decisions", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        state: { page: args.title ?? args.url, url: args.url, reader_focus: args.focus ?? null, diff },
        questions,
      }),
    });
    if (!res.ok) {
      console.warn("decision model returned", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as {
      answers?: {
        importance?: { score?: number; confidence?: number };
        worth_email?: { noul?: number };
        touches_focus?: { noul?: number };
      };
    };
    const a = data.answers;
    if (!a?.importance || typeof a.importance.score !== "number") return null;
    return {
      importance: Math.min(5, Math.max(1, Math.round(a.importance.score) + 1)),
      confidence: a.importance.confidence ?? 0,
      worthEmail: a.worth_email?.noul ?? 0.5,
      touchesFocus: args.focus ? (a.touches_focus?.noul ?? null) : null,
    };
  } catch (e) {
    console.warn("decision model failed", String(e));
    return null;
  }
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
      signal: AbortSignal.timeout(40_000),
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

// Second, cheaper question for a page that already alerted several times
// today: is this change materially new, or the same story again? Returns the
// probability that it is new, or null when the decision model is unavailable.
export async function decideNovelty(args: {
  diff: string;
  newSummary: string;
  lastSummaries: string[];
}): Promise<number | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.DECISION_MODEL;
  if (!apiKey || !model) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/v1\/?$/, "");
  const diff = args.diff.length > 8000 ? args.diff.slice(0, 8000) + "\n...(truncated)" : args.diff;
  try {
    const res = await fetch(baseUrl + "/alpha/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model,
        state: { previous_alerts_today: args.lastSummaries, new_change: args.newSummary, diff },
        questions: {
          materially_new: {
            type: "noul",
            instructions:
              "The reader was already emailed previous_alerts_today (newest first). Does new_change tell them something materially different from all of them, justifying another email now?",
            criteria: {
              true: "New facts not covered by any earlier alert today: a different amount, date, item, closure or requirement",
              false: "A rewording of an earlier alert, or the page flipping back to a state an earlier alert today already described",
            },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answers?: { materially_new?: { noul?: number } } };
    const p = data.answers?.materially_new?.noul;
    return typeof p === "number" ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SPEC-019: watch a fact, not a page.

type ChatJson = Record<string, unknown>;

// One JSON reply from the OpenAI-compatible model, or null.
async function chatJson(system: string, user: string, maxTokens = 400): Promise<ChatJson | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      console.warn("answer model returned", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      // A reasoning model can spend the whole budget thinking and return nothing.
      console.warn("answer model returned no content, finish_reason:", data.choices?.[0]?.finish_reason ?? "unknown");
      return null;
    }
    return JSON.parse(content) as ChatJson;
  } catch (e) {
    console.warn("answer model failed", String(e));
    return null;
  }
}

export type AnswerPick = {
  answered: boolean;
  start: number | null;
  end: number | null;
  answer: string;
  headline: string;
  isoDate: string | null;
  relative: boolean;
};

const ANSWER_SYSTEM =
  "You find where a web page answers a reader's question. The page is given as numbered lines (L<n>: text); '…' marks lines that were left out. " +
  "Reply with JSON only: {\"answered\": boolean, \"start\": number|null, \"end\": number|null, \"answer\": string, \"headline\": string, \"isoDate\": string|null, \"relative\": boolean}. " +
  "start and end are the line numbers of the ONE contiguous block (one to three lines) that states the answer. Never copy or rewrite the text; only give numbers. " +
  "If the page does not state the answer, set answered to false, start and end to null, and answer to an empty string. Do not answer from general knowledge. " +
  "answer: one short plain-English sentence answering the question using only facts in those lines; every number you write must appear in those lines. " +
  "headline: the answer itself in at most eight words, without restating the question (for example 'AED 1,500 per vehicle, due 10 October' or 'Closed until the end of next month'); every number in it must appear in those lines. " +
  "isoDate: YYYY-MM-DD when the answer names a complete calendar date, else null. relative: true if the answer only makes sense relative to today (for example 'next Friday').";

export async function pickAnswer(args: {
  question: string;
  numberedPage: string;
  title?: string;
  retryReason?: string;
  previousQuote?: string;
}): Promise<AnswerPick | null> {
  const user =
    "Page: " + (args.title ?? "(untitled)") + "\n\nQuestion: " + args.question + "\n\nPage lines:\n" + args.numberedPage +
    (args.previousQuote
      ? "\n\nLast time, the answer was stated in these words:\n" + args.previousQuote +
        "\nIf lines with the same meaning still answer the question, choose them again; choose other lines only if they now answer it instead."
      : "") +
    (args.retryReason ? "\n\nYour previous choice was rejected: " + args.retryReason + ". Choose again." : "");
  const j = await chatJson(ANSWER_SYSTEM, user, 1500);
  if (!j) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null);
  return {
    answered: j.answered === true,
    start: num(j.start),
    end: num(j.end ?? j.start),
    answer: typeof j.answer === "string" ? j.answer.trim().slice(0, 300) : "",
    headline: typeof j.headline === "string" ? j.headline.trim().slice(0, 80) : "",
    isoDate: typeof j.isoDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.isoDate) ? j.isoDate : null,
    relative: j.relative === true,
  };
}

export type SuggestionPick = { question: string; start: number; end: number; answer: string };

const SUGGEST_SYSTEM =
  "You help someone decide what to watch on a public web page. The page is given as numbered lines (L<n>: text). " +
  "List up to 3 specific questions that a resident, parent, customer or applicant would want answered and that this page answers explicitly right now. " +
  "Prefer money, dates, deadlines, opening times, availability, requirements and closures. Never ask about when the page was updated, visitor or view counts, cookies, menus or navigation. " +
  "Each question at most 90 characters, in plain English, answerable from one to three contiguous lines. " +
  "The reader will watch the question over time, so ask about everything its lines state that a reader would act on (for example both when and how much), so that a change to any of those facts changes the answer. " +
  "Reply with JSON only: {\"suggestions\": [{\"question\": string, \"start\": number, \"end\": number, \"answer\": string}]}. " +
  "start and end are the line numbers that state the answer; answer is one short sentence using only facts in those lines, and every number in it must appear in those lines.";

// Null when the model is unavailable, so the caller can offer a retry.
export async function suggestQuestions(args: { numberedPage: string; title?: string }): Promise<SuggestionPick[] | null> {
  const j = await chatJson(SUGGEST_SYSTEM, "Page: " + (args.title ?? "(untitled)") + "\n\nPage lines:\n" + args.numberedPage, 2500);
  if (!j) return null;
  const list = Array.isArray(j?.suggestions) ? (j!.suggestions as unknown[]) : [];
  const out: SuggestionPick[] = [];
  for (const s of list.slice(0, 5)) {
    const o = s as Record<string, unknown>;
    if (typeof o.question !== "string" || typeof o.start !== "number") continue;
    out.push({
      question: o.question.trim().slice(0, 120),
      start: Math.round(o.start),
      end: Math.round(typeof o.end === "number" ? o.end : o.start),
      answer: typeof o.answer === "string" ? o.answer.trim().slice(0, 300) : "",
    });
  }
  return out;
}

// Decision model: did the fact change, or only its wording? Probability that
// the new quote states a materially different fact; null when unavailable.
export async function decideFactChanged(args: {
  question: string;
  before: { quote: string; answer: string };
  after: { quote: string; answer: string };
}): Promise<number | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.DECISION_MODEL;
  if (!apiKey || !model) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/v1\/?$/, "");
  try {
    const res = await fetch(baseUrl + "/alpha/decisions", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        state: { reader_question: args.question, before: args.before, after: args.after },
        questions: {
          fact_changed: {
            type: "noul",
            instructions:
              "A reader asked `reader_question`. `before` and `after` are the page's own lines that answered it at two times. Does `after` state a materially different answer than `before`?",
            criteria: {
              true: "A different amount, date, time, place, requirement, availability or status: the reader would act differently",
              false: "The same facts reworded, reformatted or reordered: the reader would do exactly the same",
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn("fact decision returned", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { answers?: { fact_changed?: { noul?: number } } };
    const p = data.answers?.fact_changed?.noul;
    return typeof p === "number" ? p : null;
  } catch (e) {
    console.warn("fact decision failed", String(e));
    return null;
  }
}
