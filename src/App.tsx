import { useEffect, useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, AuthLoading, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Reveal, SkyBackdrop, PigeonGlider, PigeonMark, PulseDots, flapPigeon } from "./motion";

// ---------- tiny hash router ----------
type Route =
  | { name: "home" }
  | { name: "board"; boardId: Id<"boards"> }
  | { name: "watch"; watchId: Id<"watches"> }
  | { name: "change"; changeId: Id<"changes"> }
  | { name: "join"; code: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [a, b] = h.split("/");
  if (a === "board" && b) return { name: "board", boardId: b as Id<"boards"> };
  if (a === "watch" && b) return { name: "watch", watchId: b as Id<"watches"> };
  if (a === "change" && b) return { name: "change", changeId: b as Id<"changes"> };
  if (a === "join" && b) return { name: "join", code: b };
  return { name: "home" };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function go(hash: string) {
  window.location.hash = hash;
}

// ---------- helpers ----------
const INTERVALS: Array<[number, string]> = [
  [30, "every 30 minutes"],
  [60, "hourly"],
  [180, "every 3 hours"],
  [360, "every 6 hours"],
  [720, "twice a day"],
  [1440, "daily"],
  [4320, "every 3 days"],
  [10080, "weekly"],
];

function intervalLabel(m: number): string {
  return INTERVALS.find(([v]) => v === m)?.[1] ?? "every " + m + " min";
}

function ago(ms: number | undefined | null): string {
  if (!ms) return "never";
  const d = Date.now() - ms;
  if (d < 0) return "in " + fmtDur(-d);
  if (d < 60_000) return "just now";
  return fmtDur(d) + " ago";
}

function fmtDur(d: number): string {
  const m = Math.round(d / 60_000);
  if (m < 60) return m + " min";
  const h = Math.round(m / 60);
  if (h < 48) return h + " h";
  return Math.round(h / 24) + " d";
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function importanceLabel(i: number | null | undefined): string {
  switch (i) {
    case 1: return "cosmetic";
    case 2: return "minor";
    case 3: return "worth a look";
    case 4: return "money, dates or availability";
    case 5: return "act now";
    default: return "summarising…";
  }
}

function Logo() {
  return <PigeonMark />;
}

// ---------- app shell ----------
export default function App() {
  const route = useRoute();
  return (
    <>
      <AuthLoading>
        <div className="page empty">Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <TopBar cta />
        <Landing route={route} />
      </Unauthenticated>
      <Authenticated>
        <TopBar />
        <Main route={route} />
      </Authenticated>
      <footer className="foot">
        Pigeon · a newsletter for pages that don't have one · built on Convex, Firecrawl, AgentMail and OpenAI
      </footer>
    </>
  );
}

function TopBar({ cta = false }: { cta?: boolean }) {
  const user = useQuery(api.auth.currentUser);
  const boards = useQuery(api.boards.myBoards);
  const { signIn, signOut } = useAuthActions();
  const route = useRoute();
  const currentBoard = route.name === "board" ? route.boardId : undefined;
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <Logo /> Pigeon
      </a>
      <span className="tagline">Watch any page. Get told when it really changes.</span>
      <span className="spacer" />
      {cta && (
        <button className="btn cta small" onClick={() => void signIn("anonymous")}>
          Try it now, no sign-up
        </button>
      )}
      {user && boards && boards.length > 0 && (
        <select
          value={currentBoard ?? ""}
          onChange={(e) => e.target.value && go("/board/" + e.target.value)}
          aria-label="Switch board"
        >
          <option value="">Boards…</option>
          {boards.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {user && (
        <>
          <span className="hint">{user.isAnonymous ? "Guest" : user.email ?? user.name ?? "Signed in"}</span>
          <button className="btn small" onClick={() => void signOut()}>
            Sign out
          </button>
        </>
      )}
    </header>
  );
}

// ---------- landing + auth ----------
function Landing({ route }: { route: Route }) {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guest = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn("anonymous");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page landing">
      <section className="hero-full">
        <SkyBackdrop />
        <PigeonGlider />
        <div className="hero-inner">
          <span className="eyebrow">
            <Logo /> a newsletter for pages that don't have one
          </span>
          <h1>A carrier pigeon for pages that never write back.</h1>
          <p className="hero-sub">Get an email when a page changes. Only when it matters.</p>
          <p className="lede">The pages you need to watch don't send newsletters.</p>
          {route.name === "join" && (
            <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
              You have an invite. Sign in or continue as a guest and it will be applied.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="btn cta" onClick={() => void guest()} disabled={busy}>
              Try it now, no sign-up
            </button>
            <button className="btn onviolet" onClick={() => setMode("signIn")}>
              Sign in with email
            </button>
          </div>
          <p className="hero-note">
            School notice boards, embassy pages, community announcements, a clinic's schedule, a landlord's portal, a
            government fee table. Pigeon checks them and writes you in plain language, with the exact diff one click
            away.
          </p>
        </div>
        <span className="scroll-cue">scroll</span>
      </section>

      <Reveal as="section" className="band b-how">
        <span className="section-label">Chapter one</span>
        <h3>How it works</h3>
        <ol className="steps">
          <li>
            <span className="num">1</span>
            <span>
              <b>Paste a link</b>
              <span className="d">Any public page. No account needed to try it.</span>
            </span>
          </li>
          <li>
            <span className="num">2</span>
            <span>
              <b>We check on a schedule</b>
              <span className="d">Every 30 minutes to once a week, your call.</span>
            </span>
          </li>
          <li>
            <span className="num">3</span>
            <span>
              <b>You get a plain-language email</b>
              <span className="d">Only when it really changes, with the exact diff attached.</span>
            </span>
          </li>
        </ol>
      </Reveal>

      <Reveal as="section" className="band b-board">
        <span className="section-label">The board</span>
        <h3>One page, watched. One card when it moves.</h3>
        <div className="demo">
          <div className="demo-head">
            <span className="demo-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="demo-title">My board</span>
            <span className="demo-live">live</span>
          </div>
          <div className="demo-body">
            <div className="demo-row">
              <span className="dot ok" />
              <span className="demo-page">
                <b>Springfield Primary — Notices</b>
                <span className="demo-url">springfield.sch.uk/notices</span>
              </span>
              <span className="demo-when">checked 12 min ago</span>
            </div>
            <div className="demo-row demo-row-busy">
              <span className="dot pending" />
              <span className="demo-page">
                <b>Embassy — Appointments</b>
                <span className="demo-url">embassy.example/appointments</span>
              </span>
              <span className="demo-when">
                <PulseDots label="checking" />
              </span>
            </div>
            <div className="demo-card">
              <div className="demo-card-head">
                <b>What changed</b>
                <span className="chip i4">money, dates or availability</span>
              </div>
              <p>
                The summer term fee deadline moved forward to 14 June. Late payments now carry a £25 charge.
              </p>
              <div className="demo-foot">
                <span className="plus">+3</span>
                <span className="minus">−2</span>
                <span className="demo-unit">lines</span>
                <span className="demo-link">see diff</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal as="section" className="band b-who">
        <span className="section-label">Four households</span>
        <h3>Who it's for</h3>
        <div className="examples">
          <div className="ex">
            <b>Family</b>
            <span>Your child's school notices page. Term dates, closures, fee changes, straight to both parents.</span>
          </div>
          <div className="ex">
            <b>Expats</b>
            <span>Embassy appointment pages and visa rules. Know the day the requirements change.</span>
          </div>
          <div className="ex">
            <b>Neighbours</b>
            <span>The building or community announcements page, shared with the whole household.</span>
          </div>
          <div className="ex">
            <b>Anyone</b>
            <span>Email a link to your board's address and it starts watching. Reply with another link any time.</span>
          </div>
        </div>
      </Reveal>

      <Reveal as="section" className="band b-inside">
        <span className="section-label">Under the wing</span>
        <h3>What's inside</h3>
        <div className="ledger">
          <ul className="features">
            <li>
              <b>Firecrawl scraping</b>
              <span>Clean text from any public page.</span>
            </li>
            <li>
              <b>Noise filtering</b>
              <span>Cosmetic edits stay silent.</span>
            </li>
            <li>
              <b>Exact diff</b>
              <span>Every line added and removed.</span>
            </li>
            <li>
              <b>Model summary</b>
              <span>Two sentences, plain language.</span>
            </li>
            <li>
              <b>Shared boards</b>
              <span>One invite link for the household.</span>
            </li>
            <li>
              <b>Add by email</b>
              <span>Forward a link to your board address.</span>
            </li>
          </ul>
          <div>
            <h4 className="mock-title">What lands in your inbox</h4>
            <div className="mock">
              <div className="from">Pigeon · just now</div>
              <span className="chip i4">money, dates or availability</span>
              <div className="subject">Springfield Primary — Notices</div>
              <p className="body">
                The summer term fee deadline moved forward to 14 June. A new line says late payments now carry a £25
                charge.
              </p>
              <div className="lines">
                <span className="plus">+3</span>
                <span className="minus">−2</span>
                <span className="hint">lines</span>
              </div>
            </div>
            <h4 className="mock-title">Built on</h4>
            <div className="sponsors">
              <span>Convex</span>
              <span>Firecrawl</span>
              <span>AgentMail</span>
              <span>OpenAI</span>
            </div>
            <p className="note">Realtime data, clean page capture, a real inbox per board, and plain-language summaries.</p>
          </div>
        </div>
      </Reveal>

      <section className="faq">
        <span className="section-label">Before you fly</span>
        <h3>Questions</h3>
        <div className="faq-list">
          <details>
            <summary>Which pages work?</summary>
            <p>Any public page you can open without logging in. Text pages work best: notices, schedules, fee tables, rules.</p>
          </details>
          <details>
            <summary>How often does it check?</summary>
            <p>From every 30 minutes to once a week. You choose per page, and you can change it later.</p>
          </details>
          <details>
            <summary>Will I get spammed by tiny changes?</summary>
            <p>No. Every change is scored. Cosmetic edits stay silent. You hear about money, dates and availability.</p>
          </details>
          <details>
            <summary>What does the email look like?</summary>
            <p>The page name, an importance chip, two sentences on what changed, and a link to the exact diff.</p>
          </details>
          <details>
            <summary>Can my family or team share it?</summary>
            <p>Yes. A board is shared. Send the invite link and everyone on it gets the same alerts.</p>
          </details>
          <details>
            <summary>Is it free?</summary>
            <p>Yes, free to use right now. No card, no trial timer.</p>
          </details>
          <details>
            <summary>What does it cost me to try?</summary>
            <p>One click and one link. Guest mode gives you a working board with no sign-up.</p>
          </details>
        </div>
      </section>

      {mode && <EmailAuth mode={mode} setMode={setMode} />}
    </div>
  );
}

function EmailAuth({
  mode,
  setMode,
}: {
  mode: "signIn" | "signUp";
  setMode: (m: "signIn" | "signUp" | null) => void;
}) {
  const { signIn } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card auth"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const fd = new FormData(e.currentTarget);
        fd.set("flow", mode);
        try {
          await signIn("password", fd);
        } catch (err) {
          setError(
            mode === "signIn"
              ? "Could not sign in. Check the email and password, or create an account."
              : "Could not create the account. Use at least 8 characters for the password.",
          );
          console.warn(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="card-head">
        <h2>{mode === "signIn" ? "Sign in" : "Create an account"}</h2>
        <span className="spacer" />
        <button type="button" className="btn link" onClick={() => setMode(null)}>
          close
        </button>
      </div>
      <div className="card-body">
        <div className="field">
          <label>Email</label>
          <input name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label>Password</label>
          <input name="password" type="password" required minLength={8} autoComplete={mode === "signIn" ? "current-password" : "new-password"} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="inline">
          <button className="btn primary" type="submit" disabled={busy}>
            {mode === "signIn" ? "Sign in" : "Create account"}
          </button>
          <button type="button" className="btn link" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
            {mode === "signIn" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---------- authenticated area ----------
function Main({ route }: { route: Route }) {
  const boards = useQuery(api.boards.myBoards);
  const createBoard = useMutation(api.boards.createBoard);
  const joinBoard = useMutation(api.boards.joinBoard);
  const [creating, setCreating] = useState(false);

  // Apply an invite link once signed in.
  useEffect(() => {
    if (route.name !== "join") return;
    joinBoard({ inviteCode: route.code })
      .then((id) => go("/board/" + id))
      .catch((e) => {
        alert(e instanceof Error ? e.message : String(e));
        go("/");
      });
  }, [route, joinBoard]);

  // First visit: make a board so the product is usable in one click.
  useEffect(() => {
    if (boards === undefined || creating) return;
    if (boards.length === 0 && route.name === "home") {
      setCreating(true);
      createBoard({ name: "My board" })
        .then((id) => go("/board/" + id))
        .finally(() => setCreating(false));
    }
  }, [boards, route, creating, createBoard]);

  // Home with boards: jump to the first one.
  useEffect(() => {
    if (route.name === "home" && boards && boards.length > 0) go("/board/" + boards[0]._id);
  }, [route, boards]);

  if (route.name === "board") return <BoardPage boardId={route.boardId} />;
  if (route.name === "watch") return <WatchPage watchId={route.watchId} />;
  if (route.name === "change") return <ChangePage changeId={route.changeId} />;
  return <div className="page empty">Setting up your board…</div>;
}

// ---------- board ----------
function BoardPage({ boardId }: { boardId: Id<"boards"> }) {
  const board = useQuery(api.boards.getBoard, { boardId });
  const watches = useQuery(api.watches.listWatches, { boardId });
  const changes = useQuery(api.watches.listChanges, { boardId });
  const events = useQuery(api.boards.listEvents, { boardId });
  if (board === undefined) return <div className="page empty">Loading board…</div>;
  if (board === null) return <div className="page empty">Board not found.</div>;

  return (
    <div className="page">
      <h1 className="h">{board.name}</h1>
      <p className="sub">
        {watches?.length ?? 0} page{watches?.length === 1 ? "" : "s"} watched · {board.members.length} member
        {board.members.length === 1 ? "" : "s"}
        {board.inboxAddress ? (
          <>
            {" "}
            · board email: <code>{board.inboxAddress}</code>
          </>
        ) : Date.now() - board.createdAt > 60_000 ? (
          <> · board email: not available on this deployment</>
        ) : (
          <> · board email: setting up…</>
        )}
      </p>
      <div className="grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Watch a page</h2>
            </div>
            <div className="card-body">
              <AddWatch boardId={boardId} />
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Pages</h2>
              <span className="hint">live · updates as checks finish</span>
            </div>
            {watches === undefined ? (
              <div className="empty">Loading…</div>
            ) : watches.length === 0 ? (
              <div className="empty">Nothing watched yet. Paste a link above, or email one to the board address.</div>
            ) : (
              watches.map((w) => <WatchRow key={w._id} w={w} />)
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>What changed</h2>
            </div>
            {changes === undefined ? (
              <div className="empty">Loading…</div>
            ) : changes.length === 0 ? (
              <div className="empty">No changes detected yet. The first check only takes a snapshot; changes show up from the second check on.</div>
            ) : (
              changes.slice(0, 15).map((c) => (
                <div key={c._id} className={"change" + (c.isRead ? "" : " unread")}>
                  <div className="head">
                    <span className="t">{c.watchTitle}</span>
                    <span className={"chip i" + (c.importance ?? 0)}>{importanceLabel(c.importance)}</span>
                    <time>{ago(c.detectedAt)}</time>
                  </div>
                  <div className="s">{c.summary ?? "Working out what changed…"}</div>
                  <div className="foot">
                    <span>
                      +{c.addedLines} / −{c.removedLines} lines
                    </span>
                    <span>email: {c.emailStatus}</span>
                    <a href={"#/change/" + c._id}>see diff</a>
                  </div>
                </div>
              ))
            )}
          </div>
          <BoardPanel board={board} />
          <div className="card">
            <div className="card-head">
              <h2>Activity</h2>
            </div>
            <div className="card-body">
              {events && events.length > 0 ? (
                <ul className="events">
                  {events.map((e) => (
                    <li key={e._id}>
                      <time>{ago(e.at)}</time>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="hint">Nothing yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddWatch({ boardId }: { boardId: Id<"boards"> }) {
  const addWatch = useMutation(api.watches.addWatch);
  const [url, setUrl] = useState("");
  const [interval, setInterval_] = useState(360);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="add"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await addWatch({ boardId, url, intervalMinutes: interval, focus: focus || undefined });
          setUrl("");
          setFocus("");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        type="url"
        placeholder="https://example.org/notices"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Watch"}
      </button>
      <div className="row2">
        <select value={interval} onChange={(e) => setInterval_(Number(e.target.value))} aria-label="How often">
          {INTERVALS.map(([v, l]) => (
            <option key={v} value={v}>
              check {l}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Optional: what matters to you, e.g. 'fees or deadlines'"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={200}
        />
      </div>
      {error && <p className="error" style={{ gridColumn: "1 / -1" }}>{error}</p>}
      <p className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
        The first check takes a snapshot. From then on you get an email only when the page really changes.
      </p>
    </form>
  );
}

type WatchListItem = NonNullable<ReturnType<typeof useQuery<typeof api.watches.listWatches>>>[number];

function WatchRow({ w }: { w: WatchListItem }) {
  const checkNow = useMutation(api.watches.checkNow);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="watch">
      <span className={"dot " + w.status} title={w.status} />
      <div>
        <div className="title">
          <a href={"#/watch/" + w._id}>{w.title ?? host(w.url)}</a>{" "}
          <span className={"chip " + w.source}>{w.source === "email" ? "added by email" : "added on web"}</span>
        </div>
        <div className="url">{w.url}</div>
        <div className="meta">
          <span>{intervalLabel(w.intervalMinutes)}</span>
          <span>checked {ago(w.lastCheckedAt)}</span>
          <span>{w.checkCount} checks</span>
          <span>{w.changeCount} changes</span>
          {w.status === "pending" && <PulseDots label="checking" />}
          {w.status === "error" && <span className="error">{w.lastError}</span>}
          {w.focus && <span>focus: “{w.focus}”</span>}
        </div>
        {w.latestChange && (
          <div className="summary">
            <span className={"chip i" + (w.latestChange.importance ?? 0)}>{importanceLabel(w.latestChange.importance)}</span>{" "}
            {w.latestChange.summary ?? "Summarising…"}{" "}
            <a href={"#/change/" + w.latestChange._id}>diff</a>
          </div>
        )}
        {err && <div className="error">{err}</div>}
      </div>
      <div className="actions">
        <button
          className="btn small"
          onClick={() => {
            setErr(null);
            flapPigeon();
            checkNow({ watchId: w._id }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
          }}
        >
          Check now
        </button>
      </div>
    </div>
  );
}

type BoardInfo = NonNullable<ReturnType<typeof useQuery<typeof api.boards.getBoard>>>;

function BoardPanel({ board }: { board: BoardInfo }) {
  const update = useMutation(api.boards.updateNotifications);
  const rename = useMutation(api.boards.renameBoard);
  const [email, setEmail] = useState(board.me.notifyEmail ?? "");
  const [notify, setNotify] = useState(board.me.notify);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inviteLink = useMemo(
    () => window.location.origin + window.location.pathname + "#/join/" + board.inviteCode,
    [board.inviteCode],
  );
  return (
    <div className="card">
      <div className="card-head">
        <h2>Board</h2>
        <span className="spacer" />
        {board.me.role === "owner" && (
          <button
            className="btn small"
            onClick={() => {
              const n = prompt("Board name", board.name);
              if (n) void rename({ boardId: board._id, name: n });
            }}
          >
            Rename
          </button>
        )}
      </div>
      <div className="card-body stack">
        <dl className="kv">
          <dt>Email a link to</dt>
          <dd>
            {board.inboxAddress ? (
              <span className="copy">
                <code>{board.inboxAddress}</code>
                <button className="btn small" onClick={() => void navigator.clipboard.writeText(board.inboxAddress!)}>
                  copy
                </button>
              </span>
            ) : (
              <span className="hint">not ready yet</span>
            )}
          </dd>
          <dt>Invite link</dt>
          <dd>
            <span className="copy">
              <code>…/#/join/{board.inviteCode}</code>
              <button className="btn small" onClick={() => void navigator.clipboard.writeText(inviteLink)}>
                copy
              </button>
            </span>
          </dd>
        </dl>
        <div>
          <label className="hint">Where should your alerts go?</label>
          <div className="inline" style={{ marginTop: 4 }}>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 9 }}
            />
            <label className="inline" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> email me
            </label>
            <button
              className="btn small primary"
              onClick={() => {
                setErr(null);
                update({ boardId: board._id, notify, notifyEmail: email || undefined })
                  .then(() => {
                    setSaved(true);
                    setTimeout(() => setSaved(false), 1500);
                  })
                  .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
              }}
            >
              {saved ? "Saved" : "Save"}
            </button>
          </div>
          {err && <div className="error">{err}</div>}
        </div>
        <ul className="members">
          {board.members.map((m) => (
            <li key={m.userId}>
              <span>
                {m.name}
                {m.isMe ? " (you)" : ""}
              </span>
              <span className="hint">{m.notify && m.hasEmail ? "gets emails" : "no emails"}</span>
              <span className="role">{m.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------- watch detail ----------
function WatchPage({ watchId }: { watchId: Id<"watches"> }) {
  const data = useQuery(api.watches.getWatch, { watchId });
  const update = useMutation(api.watches.updateWatch);
  const remove = useMutation(api.watches.removeWatch);
  const checkNow = useMutation(api.watches.checkNow);
  const [err, setErr] = useState<string | null>(null);
  if (data === undefined) return <div className="page empty">Loading…</div>;
  if (data === null) return <div className="page empty">This page is no longer watched.</div>;
  const { watch } = data;
  return (
    <div className="page">
      <div className="crumbs">
        <a href={"#/board/" + watch.boardId}>← back to board</a>
      </div>
      <h1 className="h">{watch.title ?? host(watch.url)}</h1>
      <p className="sub">
        <a href={watch.url} target="_blank" rel="noreferrer">
          {watch.url}
        </a>
      </p>
      <div className="grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Changes on this page</h2>
            </div>
            {data.changes.length === 0 ? (
              <div className="empty">None yet. {watch.checkCount} check{watch.checkCount === 1 ? "" : "s"} so far.</div>
            ) : (
              data.changes.map((c) => (
                <div key={c._id} className="change">
                  <div className="head">
                    <span className={"chip i" + (c.importance ?? 0)}>{importanceLabel(c.importance)}</span>
                    <time>{ago(c.detectedAt)}</time>
                  </div>
                  <div className="s">{c.summary ?? "Summarising…"}</div>
                  <div className="foot">
                    <span>
                      +{c.addedLines} / −{c.removedLines}
                    </span>
                    <span>email: {c.emailStatus}</span>
                    <a href={"#/change/" + c._id}>see diff</a>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Current text</h2>
              <span className="hint">as Pigeon last saw it, {ago(data.latestFetchedAt)}</span>
            </div>
            <div className="card-body">
              {data.latestMarkdown ? <div className="text">{data.latestMarkdown}</div> : <div className="hint">No snapshot yet.</div>}
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Settings</h2>
            </div>
            <div className="card-body stack">
              <dl className="kv">
                <dt>Status</dt>
                <dd>
                  {watch.status}
                  {watch.lastError ? " · " + watch.lastError : ""}
                </dd>
                <dt>Last checked</dt>
                <dd>{ago(watch.lastCheckedAt)}</dd>
                <dt>Next check</dt>
                <dd>{watch.status === "paused" ? "paused" : ago(watch.nextCheckAt)}</dd>
                <dt>Added</dt>
                <dd>
                  {ago(watch.createdAt)} {watch.source === "email" ? "by email" : "on the web"}
                </dd>
              </dl>
              <div className="field">
                <label>How often</label>
                <select
                  value={watch.intervalMinutes}
                  onChange={(e) => void update({ watchId, intervalMinutes: Number(e.target.value) })}
                >
                  {INTERVALS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>What matters to you on this page</label>
                <input
                  type="text"
                  defaultValue={watch.focus ?? ""}
                  placeholder="e.g. fees, dates, closures"
                  onBlur={(e) => void update({ watchId, focus: e.target.value })}
                />
              </div>
              <div className="inline">
                <button
                  className="btn small"
                  onClick={() => {
                    setErr(null);
                    flapPigeon();
                    checkNow({ watchId }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  Check now
                </button>
                <button className="btn small" onClick={() => void update({ watchId, paused: watch.status !== "paused" })}>
                  {watch.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (confirm("Stop watching this page and delete its history?")) {
                      void remove({ watchId }).then(() => go("/board/" + watch.boardId));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
              {err && <div className="error">{err}</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Snapshots</h2>
            </div>
            <div className="card-body">
              <ul className="events">
                {data.snapshots.map((s) => (
                  <li key={s._id}>
                    <time>{ago(s.fetchedAt)}</time>
                    <span>
                      {s.title ?? "snapshot"} · {s.length.toLocaleString()} chars
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- change detail ----------
function ChangePage({ changeId }: { changeId: Id<"changes"> }) {
  const data = useQuery(api.watches.getChange, { changeId });
  const markRead = useMutation(api.watches.markRead);
  useEffect(() => {
    if (data) void markRead({ changeId });
  }, [data, changeId, markRead]);
  if (data === undefined) return <div className="page empty">Loading…</div>;
  if (data === null) return <div className="page empty">Change not found.</div>;
  const { change, watch } = data;
  return (
    <div className="page">
      <div className="crumbs">
        {watch && <a href={"#/board/" + watch.boardId}>← back to board</a>}
        {watch && (
          <>
            {" · "}
            <a href={"#/watch/" + watch._id}>this page's history</a>
          </>
        )}
      </div>
      <h1 className="h">{watch?.title ?? host(watch?.url ?? "")}</h1>
      <p className="sub">
        {watch && (
          <a href={watch.url} target="_blank" rel="noreferrer">
            {watch.url}
          </a>
        )}{" "}
        · detected {ago(change.detectedAt)} · <span className={"chip i" + (change.importance ?? 0)}>{importanceLabel(change.importance)}</span>
      </p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div style={{ fontSize: 17 }}>{change.summary ?? "Summarising…"}</div>
          <div className="hint" style={{ marginTop: 6 }}>
            {change.summarySource === "model" ? "Summary written by the model." : change.summarySource === "heuristic" ? "Summary from the diff itself (no model key configured)." : ""}{" "}
            Email: {change.emailStatus}
            {change.emailError ? " (" + change.emailError + ")" : ""}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Exact difference</h2>
          <span className="hint">
            +{change.addedLines} / −{change.removedLines} lines
          </span>
        </div>
        <div className="card-body">
          <Diff text={change.diff} />
        </div>
      </div>
    </div>
  );
}

function Diff({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="diff">
      {lines.map((l, i) => {
        let cls = "l";
        if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("Index") || l.startsWith("====")) cls += " meta";
        else if (l.startsWith("@@")) cls += " hunk";
        else if (l.startsWith("+")) cls += " add";
        else if (l.startsWith("-")) cls += " del";
        return (
          <span key={i} className={cls}>
            {l || " "}
          </span>
        );
      })}
    </pre>
  );
}
