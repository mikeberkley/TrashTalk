import { SharedGallery } from "./SharedGallery";
import { ChefCaption } from "./ChefCaption";
import { ChaosChef } from "./ChaosChef";
import { Stats } from "./Stats";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Game } from "../../../packages/contracts/src/leagues";
import "./style.css";
import { offer, offerPrice } from "../../../packages/contracts/src/generation";
import { validateIncludeWord } from "../../../packages/trash-talk/src/include-word";
let csrf = "";
async function api(path: string, method = "GET", data?: any, key?: string) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b: any = await r.json();
  if (!r.ok) throw Error(b.error || "Request failed");
  return b;
}

const checkoutReturn = new URLSearchParams(location.search);
const returnedPurchase = checkoutReturn.get("checkout") === "success";
const checkoutSession = checkoutReturn.get("session_id");

function App() {
  const [wordError, setWordError] = useState("");
  const errorNotice = useRef<HTMLDivElement>(null);
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("tt-form") || "{}");
    } catch {
      return {};
    }
  })();
  const [me, setMe] = useState<any>(),
    [teams, setTeams] = useState<any[]>([]),
    [team, setTeam] = useState<any>(saved.team || null),
    [favorites, setFavorites] = useState<string[]>([]),
    [suggestion, setSuggestion] = useState(0),
    [query, setQuery] = useState(""),
    [games, setGames] = useState<Game[]>([]),
    [latestMeme, setLatestMeme] = useState<any>(null),
    [galleryOpen, setGalleryOpen] = useState(false),
    [game, setGame] = useState<Game | null>(saved.game || null),
    [favorite, setFavorite] = useState(saved.favorite || ""),
    [word, setWord] = useState(saved.word || ""),
    [refs, setRefs] = useState<any[]>(saved.refs || []),
    [job, setJob] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [uploading, setUploading] = useState<number | null>(null),
    [tab, setTab] = useState(
      returnedPurchase
        ? "purchase"
        : checkoutReturn.get("checkout") === "canceled"
          ? "credits"
          : "create",
    ),
    [fromCollection, setFromCollection] = useState(false),
    [viewer, setViewer] = useState(false),
    [deleting, setDeleting] = useState<string | null>(null),
    [purchases, setPurchases] = useState<any[]>([]);
  useEffect(() => {
    if (error) {
      errorNotice.current?.focus({ preventScroll: true });
      errorNotice.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    }
  }, [error]);
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [purchaseRetry, setPurchaseRetry] = useState(0);
  useEffect(() => {
    if (tab !== "purchase") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    setPurchaseMessage("");
    async function check() {
      try {
        if (!checkoutSession)
          throw Error(
            "The purchase reference is missing. Check your purchase history or contact support.",
          );
        const result = await api(
          "/billing/purchases/" + encodeURIComponent(checkoutSession),
        );
        if (stopped) return;
        if (result.status === "paid" && result.credited) {
          const account = await api("/me");
          if (stopped) return;
          setMe(account);
          csrf = account.csrf;
          setPurchaseResult(result);
          return;
        }
        if (result.status === "review")
          throw Error("This purchase needs review. Please contact support.");
        if (Date.now() - started >= 60000)
          throw Error(
            "Your credits are still being processed. Check again shortly or contact support if they don’t appear.",
          );
        timer = setTimeout(check, 2000);
      } catch (e: any) {
        if (!stopped) setPurchaseMessage(e.message);
      }
    }
    check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [tab, purchaseRetry]);
  function leavePurchase(destination: string) {
    window.history.replaceState(null, "", location.pathname);
    setTab(destination);
  }
  const preparedShares = useRef(new Map<string, string>());
  const menu = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const google = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismissMenu = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismissMenu);
    return () => document.removeEventListener("pointerdown", dismissMenu);
  }, []);

  async function refresh() {
    const m = await api("/me");
    csrf = m.csrf;
    setMe(m);
    const local: string[] = JSON.parse(
      localStorage.getItem("tt-favorites") || "[]",
    );
    if (m.authenticated) {
      const remote: string[] = await api("/favorites");
      await Promise.all(
        local
          .filter((id) => !remote.includes(id))
          .map((id) => api("/favorites/" + encodeURIComponent(id), "PUT", {})),
      );
      setFavorites([...new Set([...remote, ...local])]);
      localStorage.removeItem("tt-favorites");
    } else setFavorites(local);
    if (m.activeJob) {
      const j = await api("/generations/" + m.activeJob);
      setJob(j);
      sessionStorage.setItem("tt-job", j.id);
    }
    setHistory(await api("/my-images"));
    setPurchases(await api("/billing/purchases"));
    return m;
  }
  useEffect(() => {
    refresh()
      .then(() => api("/teams"))
      .then(setTeams)
      .catch((e) => setError(e.message));
    const id = sessionStorage.getItem("tt-job");
    if (id)
      api("/generations/" + id)
        .then(setJob)
        .catch(() => {});
  }, []);
  useEffect(() => {
    let stopped = false;
    api("/latest-shared-meme")
      .then((data) => {
        if (!stopped) setLatestMeme(data.meme);
      })
      .catch(() => {
        if (!stopped) setLatestMeme(null);
      });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    sessionStorage.setItem(
      "tt-form",
      JSON.stringify({ team, game, favorite, word, refs }),
    );
  }, [team, game, favorite, word, refs]);
  useEffect(() => {
    if (!me || !team) return;
    let stale = false;
    setLoading(true);
    api(`/teams/${encodeURIComponent(team.id)}/games`)
      .then((g) => {
        if (!stale) {
          setGames(g);
          setError("");
        }
      })
      .catch((e) => {
        if (!stale) {
          setError(e.message);
          setGames([]);
        }
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [team?.id, !!me]);
  useEffect(() => {
    if (!job || ["complete", "failed"].includes(job.status)) return;
    const t = setInterval(
      () =>
        api("/generations/" + job.id)
          .then((j) => {
            setJob(j);
            if (["complete", "failed"].includes(j.status)) refresh();
          })
          .catch((e) => setError(e.message)),
      3000,
    );
    return () => clearInterval(t);
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job?.status === "complete")
      setRefs((current) =>
        current.filter((ref) => !job.referenceIds?.includes(ref.id)),
      );
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (viewer) dialog.current?.showModal();
    else dialog.current?.close();
  }, [viewer]);
  useEffect(() => {
    if (!me?.googleClientId || me.authenticated) return;
    const init = () => {
      const g = (window as any).google;
      g.accounts.id.initialize({
        client_id: me.googleClientId,
        callback: async (r: any) => {
          try {
            await api("/auth/google", "POST", { credential: r.credential });
            await refresh();
          } catch (e: any) {
            setError(e.message);
          }
        },
      });
      if (google.current)
        g.accounts.id.renderButton(google.current, {
          theme: "outline",
          size: "large",
          text: "signin_with",
        });
    };
    if ((window as any).google) init();
    else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = init;
      document.head.appendChild(s);
    }
  }, [me?.googleClientId, me?.authenticated, tab, history.length]);
  async function choose(g: Game, rootingTeam = team?.id || "") {
    setFromCollection(false);
    sessionStorage.removeItem("tt-job");
    setFavorite(rootingTeam);
    setGame(g);
    setJob(null);
    setBusy(true);
    try {
      setGame(await api("/games/" + g.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(retry = false) {
    if (needsCredits) {
      setError("");
      setTab("credits");
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (!retry) {
      const validation = validateIncludeWord(word);
      setWordError(validation.error || "");
      if (validation.error) return;
    }
    setFromCollection(false);
    setBusy(true);
    setError("");
    try {
      const j = await api(
        retry ? `/generations/${job.id}/retry` : "/generations",
        "POST",
        retry
          ? {}
          : {
              gameId: game?.id,
              favoriteTeamId: favorite,
              includeWord: word,
              referenceIds: refs.map((r) => r.id),
            },
        crypto.randomUUID(),
      );
      setJob({ id: j.id, status: "queued" });
      sessionStorage.setItem("tt-job", j.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File, replaceIndex?: number) {
    if (refs.length >= 1 && replaceIndex === undefined) return;
    setUploading(0);
    setError("");
    try {
      const result: any = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("POST", "/api/uploads");
        x.setRequestHeader("X-CSRF-Token", csrf);
        x.upload.onprogress = (e) =>
          setUploading(Math.round((e.loaded / e.total) * 100));
        x.onload = () => {
          try {
            const r = JSON.parse(x.responseText);
            if (x.status >= 400) reject(Error(r.error));
            else resolve(r);
          } catch {
            reject(Error("Upload failed"));
          }
        };
        x.onerror = () => reject(Error("Upload failed"));
        x.send(file);
      });
      if (replaceIndex === undefined) setRefs([result]);
      else {
        const prior = refs[replaceIndex];
        setRefs((r) => r.map((v, i) => (i === replaceIndex ? result : v)));
        api("/uploads/" + prior.id, "DELETE").catch(() => {});
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  }
  async function share(target = job) {
    try {
      let url = target.shareToken
        ? location.origin + "/m/" + target.shareToken
        : preparedShares.current.get(target.id);
      if (!url) {
        const s = await api(`/generations/${target.id}/share`, "POST", {});
        url = String(s.url);
        preparedShares.current.set(target.id, url);
        setError("Your share link is ready. Tap Share again to send it.");
        return;
      }
      // Begin native sharing synchronously while the explicit share action publishes the prepared token.
      const publishing = api(`/generations/${target.id}/share`, "POST", {});
      const sharing = navigator.share
        ? navigator
            .share({
              title:
                target.shareTitle ||
                (target.id === job?.id && game
                  ? `${game.away.displayName} vs ${game.home.displayName}`
                  : "TrashTalk"),
              url,
            })
            .catch(async (e) => {
              if (e.name === "AbortError") throw e;
              await navigator.clipboard.writeText(url);
              setError("Share link copied.");
            })
        : navigator.clipboard.writeText(url);
      await publishing;
      await sharing;
      if (!navigator.share) setError("Share link copied.");
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
    }
  }
  async function buy() {
    try {
      setBusy(true);
      const r = await api("/billing/checkout", "POST", {}, crypto.randomUUID());
      window.location.assign(r.url);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }
  const needsCredits =
    me && !me.generationUnlimited && me.trial <= 0 && me.paid <= 0;
  const inlineError = tab === "create" && !!game && !job;
  const errorMessage = error && (
    <div ref={errorNotice} role="alert" tabIndex={-1} className="notice">
      {error}
      <button aria-label="Dismiss message" onClick={() => setError("")}>
        ×
      </button>
    </div>
  );
  const active = job && !["complete", "failed"].includes(job.status);
  const suggestions = query.trim()
    ? teams
        .filter((t) =>
          `${t.displayName} ${t.name} ${t.city} ${t.abbr} ${(t.aliases || []).join(" ")}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  function selectTeam(t: any) {
    sessionStorage.removeItem("tt-job");
    setTeam(t);
    setQuery("");
    setGames([]);
    setGame(null);
    setJob(null);
    setError("");
  }
  async function toggleFavorite() {
    const adding = !favorites.includes(team.id);
    try {
      if (me?.authenticated)
        await api(
          "/favorites/" + encodeURIComponent(team.id),
          adding ? "PUT" : "DELETE",
          {},
        );
      const next = adding
        ? [...favorites, team.id]
        : favorites.filter((id) => id !== team.id);
      setFavorites(next);
      if (!me?.authenticated)
        localStorage.setItem("tt-favorites", JSON.stringify(next));
    } catch (e: any) {
      setError(e.message);
    }
  }
  function resetToStepOne() {
    setFromCollection(false);
    setTab("create");
    setJob(null);
    setTeam(null);
    setGame(null);
    setQuery("");
    setFavorite("");
    setWord("");
    setRefs([]);
    setError("");
    sessionStorage.removeItem("tt-form");
    sessionStorage.removeItem("tt-job");
    if (menu.current) menu.current.open = false;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return (
    <>
      <header>
        <a
          className="brand"
          href="/"
          aria-label="TrashTalk — back to Step 1"
          onClick={(e) => {
            e.preventDefault();
            resetToStepOne();
          }}
        >
          <img src="/trash-can-192.png" alt="" width="46" height="46" />
          <span className="wordmark">
            TRASH<span>TALK</span>
            <b aria-hidden="true">!</b>
          </span>
        </a>
        <details
          className="header-menu"
          ref={menu}
          onKeyDown={(e) => {
            if (e.key === "Escape" && menu.current) {
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label="Navigation menu">
            <span aria-hidden="true">☰</span>
          </summary>
          <nav aria-label="Main navigation">
            {[
              ["create", "Make a meme"],
              ["history", "My trash talk"],
              ["credits", "Credits"],
              ["account", "Account"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-current={tab === id ? "page" : undefined}
                className={tab === id ? "selected" : ""}
                onClick={() => {
                  if (id === "create") resetToStepOne();
                  else setTab(id);
                  if (menu.current) {
                    menu.current.open = false;
                    menu.current.querySelector("summary")?.focus();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </details>
      </header>
      <main>
        {me && me.environment !== "production" && (
          <div className="preview">PREVIEW · Payments use test mode</div>
        )}
        {!inlineError && errorMessage}
        {tab === "stats" && me?.admin ? (
          <Stats />
        ) : tab === "purchase" ? (
          <section
            className="panel account purchase-confirmation"
            aria-live="polite"
          >
            <h1>
              {purchaseResult ? "You’re all set!" : "Confirming your purchase"}
            </h1>
            {purchaseResult ? (
              <>
                <p>
                  <strong>
                    {purchaseResult.credits} image credits purchased for $
                    {(purchaseResult.amount / 100).toFixed(2)}.
                  </strong>
                </p>
                <p>Your new credits have been added to your account.</p>
                <p>
                  You now have <strong>{me?.paid || 0} paid credits</strong>{" "}
                  available.
                </p>
                <button
                  className="primary"
                  onClick={() => leavePurchase("create")}
                >
                  Make a meme
                </button>
                <button
                  onClick={() => {
                    leavePurchase("credits");
                    refresh().catch((e) => setError(e.message));
                  }}
                >
                  View credits
                </button>
              </>
            ) : (
              <>
                <p>
                  {purchaseMessage ||
                    "We’re checking your payment and waiting for your credits to be added. This usually takes a few moments."}
                </p>
                {purchaseMessage && (
                  <button
                    className="primary"
                    onClick={() => setPurchaseRetry((n) => n + 1)}
                  >
                    Check again
                  </button>
                )}
                <p>
                  <a href="mailto:mike@earthly.art">Contact support</a>
                </p>
              </>
            )}
          </section>
        ) : tab === "create" ? (
          <>
            {!job && (
              <div className="flow">
                {!game ? (
                  <section className="panel discovery">
                    {team ? (
                      <>
                        <button
                          className="back"
                          onClick={() => {
                            setTeam(null);
                            setQuery("");
                          }}
                        >
                          ← Switch teams
                        </button>
                        <h1>{team.displayName}</h1>
                        <button
                          className="favorite"
                          aria-pressed={favorites.includes(team.id)}
                          onClick={toggleFavorite}
                        >
                          {favorites.includes(team.id)
                            ? "★ Favorited"
                            : "☆ Favorite team"}
                        </button>
                        {!me?.authenticated && favorites.includes(team.id) && (
                          <p className="privacy">
                            Saved on this device.{" "}
                            <button
                              className="inline-link"
                              onClick={() => setTab("account")}
                            >
                              Sign in to sync favorites
                            </button>
                          </p>
                        )}
                        <p>Pick the matchup. Bring the disrespect.</p>
                        <div className="games" aria-busy={loading}>
                          {loading ? (
                            <p>Hunting for your next roast…</p>
                          ) : games.length ? (
                            games.map((g) => (
                              <button
                                className={`game${g.status === "final" ? " game-final" : ""}`}
                                key={g.id}
                                onClick={() => choose(g)}
                                disabled={busy}
                              >
                                <small>
                                  {new Date(g.date).toLocaleDateString([], {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  })}{" "}
                                  ·{" "}
                                  {new Date(g.date).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}{" "}
                                  · {g.leagueLabel}
                                </small>
                                <strong>
                                  <span>
                                    <img
                                      className="team-logo"
                                      src={g.away.brandingUrl}
                                      alt=""
                                    />
                                    {g.away.displayName}
                                  </span>
                                  {g.status === "final" && (
                                    <b
                                      className="game-score"
                                      aria-label={`${g.away.displayName} score ${g.score.away ?? "unavailable"}`}
                                    >
                                      {g.score.away ?? "–"}
                                    </b>
                                  )}
                                </strong>
                                <strong>
                                  <span>
                                    <img
                                      className="team-logo"
                                      src={g.home.brandingUrl}
                                      alt=""
                                    />
                                    {g.home.displayName}
                                  </span>
                                  {g.status === "final" && (
                                    <b
                                      className="game-score"
                                      aria-label={`${g.home.displayName} score ${g.score.home ?? "unavailable"}`}
                                    >
                                      {g.score.home ?? "–"}
                                    </b>
                                  )}
                                </strong>
                                {g.status === "final" && (
                                  <span className="state">
                                    Most recent final
                                  </span>
                                )}
                                {g.status === "live" && (
                                  <span className="state live">● Live</span>
                                )}
                              </button>
                            ))
                          ) : (
                            <p>
                              No upcoming or recently finished games are
                              available for this team.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="welcome-intro">
                          <div className="welcome-copy">
                            <p className="welcome-tagline">
                              Your team. Their humiliation.
                            </p>
                            <h1>
                              Turn your sports rivalry into a hilarious meme.
                            </h1>
                            <p className="welcome-description">
                              Pick your team and a game. TrashTalk creates an
                              AI-generated meme image roasting your
                              opponent—ready to drop in the group chat.
                            </p>
                            <p className="welcome-trial">
                              <strong>Your first 5 memes are free.</strong>
                              <span>No sign-up required.</span>
                            </p>
                          </div>
                          {latestMeme && (
                            <figure className="welcome-example">
                              <a
                                href={`/m/${latestMeme.token}`}
                                aria-label="Open the latest shared TrashTalk meme"
                              >
                                <img
                                  src={`/m/${latestMeme.token}/image`}
                                  width="640"
                                  height="640"
                                  alt={
                                    latestMeme.caption ||
                                    "Latest shared TrashTalk meme"
                                  }
                                  fetchPriority="high"
                                />
                              </a>
                              <figcaption>
                                <strong>Latest shared TrashTalk</strong>
                                <span>{latestMeme.matchup}</span>
                                {latestMeme.rootingFor && (
                                  <span>
                                    Rooting for {latestMeme.rootingFor}
                                  </span>
                                )}
                              </figcaption>
                            </figure>
                          )}
                        </div>
                        <h2 className="team-invitation">Who’s your team?</h2>
                        <label className="search discovery-choice-label">
                          Search by team (all pro sports &amp; college football)
                          <input
                            type="search"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={suggestions.length > 0}
                            aria-controls="team-suggestions"
                            aria-activedescendant={
                              suggestions[suggestion]
                                ? `team-option-${suggestion}`
                                : undefined
                            }
                            autoComplete="off"
                            placeholder="e.g. Patriots, Lakers, Arsenal…"
                            value={query}
                            onChange={(e) => {
                              setQuery(e.target.value);
                              setSuggestion(0);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setSuggestion((i) =>
                                  Math.min(i + 1, suggestions.length - 1),
                                );
                              }
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setSuggestion((i) => Math.max(0, i - 1));
                              }
                              if (
                                e.key === "Enter" &&
                                suggestions[suggestion]
                              ) {
                                e.preventDefault();
                                selectTeam(suggestions[suggestion]);
                              }
                              if (e.key === "Escape") setQuery("");
                            }}
                          />
                        </label>
                        <div
                          id="team-suggestions"
                          role="listbox"
                          className="suggestions"
                        >
                          {suggestions.map((t, i) => (
                            <button
                              id={`team-option-${i}`}
                              role="option"
                              aria-selected={suggestion === i}
                              key={t.id}
                              onClick={() => selectTeam(t)}
                            >
                              <img
                                className="team-logo"
                                src={t.brandingUrl}
                                alt=""
                              />
                              <span>
                                {t.displayName}
                                <small>{t.leagueLabels.join(" · ")}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                        {query.trim() && !suggestions.length && (
                          <p>
                            {teams.length
                              ? "No supported teams match that name."
                              : "Loading teams…"}
                          </p>
                        )}
                        {!query && favorites.length > 0 && (
                          <div className="presets">
                            <p className="discovery-choice-label">
                              Your ride-or-dies
                            </p>
                            {teams
                              .filter((t) => favorites.includes(t.id))
                              .map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => selectTeam(t)}
                                >
                                  <img
                                    className="team-logo"
                                    src={t.brandingUrl}
                                    alt=""
                                  />
                                  {t.displayName}
                                </button>
                              ))}
                          </div>
                        )}
                      </>
                    )}
                    <div className="gallery-discovery">
                      <a
                        href="#latest-trashtalk-memes"
                        aria-expanded={galleryOpen}
                        aria-controls="latest-trashtalk-memes"
                        onClick={(event) => {
                          event.preventDefault();
                          setGalleryOpen(!galleryOpen);
                        }}
                      >
                        See the latest TrashTalk memes
                      </a>
                      <div id="latest-trashtalk-memes">
                        {galleryOpen && <SharedGallery />}
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="panel creative">
                    <button
                      className="back"
                      onClick={() => {
                        setGame(null);
                        setError("");
                      }}
                    >
                      ← Choose another game
                    </button>
                    <h1>Step 2: add chaos</h1>
                    <div
                      className={`game selected-game${game.status === "final" ? " game-final" : ""}`}
                    >
                      <small>
                        {new Date(game.date).toLocaleDateString([], {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        ·{" "}
                        {new Date(game.date).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · {game.leagueLabel}
                      </small>
                      {[game.away, game.home].map((t, i) => (
                        <strong key={t.id}>
                          <span>
                            <img
                              className="team-logo"
                              src={t.brandingUrl}
                              alt=""
                            />
                            {t.displayName}
                          </span>
                          {game.status === "final" && (
                            <b className="game-score">
                              {(i === 0 ? game.score.away : game.score.home) ??
                                "–"}
                            </b>
                          )}
                        </strong>
                      ))}
                      {game.status === "final" && (
                        <span className="state">Most recent final</span>
                      )}
                      {game.status === "live" && (
                        <span className="state live">● Live</span>
                      )}
                    </div>
                    {!team && (
                      <label>
                        Who are you rooting for?
                        <select
                          value={favorite}
                          onChange={(e) => setFavorite(e.target.value)}
                        >
                          <option value="">Choose your team</option>
                          {[game.away, game.home].map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <p className="rooting">
                      Roasting on behalf of{" "}
                      {team?.displayName ||
                        [game.away, game.home].find((t) => t.id === favorite)
                          ?.displayName}
                    </p>
                    <p className="chaos-instruction">
                      No joke to write. No photo needed. We’ll take care of the
                      roast—or add a word or photo to make it your own.
                    </p>
                    <label>
                      A word of chaos <span className="optional">Optional</span>
                      <input
                        placeholder="e.g. banana. Yes, banana."
                        maxLength={30}
                        value={word}
                        onChange={(e) => {
                          setWord(e.target.value);
                          setWordError("");
                        }}
                        aria-invalid={!!wordError}
                        aria-describedby={wordError ? "word-error" : undefined}
                        disabled={active}
                      />
                    </label>
                    {wordError && (
                      <p id="word-error" role="alert">
                        {wordError}
                      </p>
                    )}
                    <div className="photo-heading">
                      A photo for the madness{" "}
                      <span className="optional">Optional · 1 photo</span>
                    </div>
                    <p className="photo-hint">
                      Want to put yourself—or a rival fan—in the meme? Add a
                      photo.
                    </p>
                    {refs.length > 1 && (
                      <p role="alert">
                        TrashTalk now supports one reference photo. Remove a
                        photo to continue.
                      </p>
                    )}
                    <div className="photos">
                      {refs.map((r, i) => (
                        <div className="photo" key={r.id}>
                          <img src={r.url} alt={`Reference ${i + 1}`} />
                          <label className="replace-photo">
                            Replace
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/heic,image/heif"
                              disabled={active || uploading !== null}
                              onChange={(e) => {
                                if (e.target.files?.[0])
                                  upload(e.target.files[0], i);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            aria-label={`Remove reference ${i + 1}`}
                            disabled={active}
                            onClick={() => {
                              setRefs(refs.filter((x) => x.id !== r.id));
                              api("/uploads/" + r.id, "DELETE").catch(() => {});
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {refs.length < 1 && (
                        <label className="upload">
                          {uploading !== null ? (
                            `${uploading}% uploaded`
                          ) : (
                            <>
                              <b>＋</b>Add a photo
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/heic,image/heif"
                            disabled={active || uploading !== null}
                            onChange={(e) => {
                              if (e.target.files?.[0])
                                upload(e.target.files[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <p className="privacy">
                      Photos stay private, are sent to the image generator, and
                      are then deleted from our storage as soon as your meme is
                      ready. Upload only photos you have permission to use; no
                      photos of children or sexual content allowed.
                    </p>
                    {inlineError && errorMessage}
                    <button
                      className="primary generate"
                      disabled={
                        !me ||
                        !favorite ||
                        !game ||
                        game.status === "unavailable" ||
                        busy ||
                        active ||
                        uploading !== null ||
                        refs.length > 1
                      }
                      onClick={() => generate()}
                    >
                      {active
                        ? "Cooking up nonsense…"
                        : needsCredits
                          ? me.authenticated
                            ? "Get more credits"
                            : "Sign in & get more credits"
                          : "Unleash the meme"}
                    </button>
                    <p className="price">
                      5 free successful images. Then {offerPrice} for{" "}
                      {offer.credits}. Only finished images use a credit.
                    </p>
                  </section>
                )}
              </div>
            )}
            {job && (
              <section className="result panel" aria-live="polite">
                {fromCollection && (
                  <a
                    className="collection-back"
                    href="#my-trash-talk"
                    onClick={(e) => {
                      e.preventDefault();
                      setTab("history");
                      window.scrollTo({ top: 0, behavior: "instant" });
                    }}
                  >
                    <span aria-hidden="true">← </span>Back to My Trash Talk
                  </a>
                )}
                {active ? (
                  <>
                    <p className="cooking-message">
                      Great nonsense takes a minute. Thx for waiting while we
                      cook.
                    </p>
                    <ChaosChef />
                    <ChefCaption />
                  </>
                ) : job.status === "failed" ? (
                  <>
                    <h2>That image didn’t finish.</h2>
                    <p>{job.error}</p>
                    <p>
                      Your credit was released. A timed-out provider call may
                      still have incurred provider cost.
                    </p>
                    <button onClick={() => generate(true)} disabled={busy}>
                      Retry unchanged inputs
                    </button>
                  </>
                ) : (
                  <>
                    <button className="artwork" onClick={() => setViewer(true)}>
                      <img src={job.url} alt={job.text} />
                    </button>
                    <div className="result-actions">
                      <button
                        className="primary share-action"
                        ref={shareButton}
                        onClick={() => share()}
                      >
                        ↗ Share
                      </button>
                      <div className="result-links">
                        <a
                          href="#make-another"
                          onClick={(e) => {
                            e.preventDefault();
                            setJob(null);
                            sessionStorage.removeItem("tt-job");
                          }}
                        >
                          Make another one
                        </a>
                        <a
                          href="#my-trash-talk"
                          onClick={(e) => {
                            e.preventDefault();
                            setTab("history");
                          }}
                        >
                          View all my trash talk
                        </a>
                      </div>
                    </div>
                    {job.limitation && (
                      <p className="privacy">{job.limitation}</p>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        ) : tab === "history" ? (
          <section>
            <h1>My trash talk</h1>
            {history.length > 0 && (
              <p>Only the images you explicitly share become public.</p>
            )}
            <div className="history">
              {history.map((j) => (
                <article className="history-item" key={j.id}>
                  <button
                    className="history-image"
                    aria-label="View meme"
                    onClick={() => {
                      setFromCollection(true);
                      setJob(j);
                      setFavorite(j.favoriteTeamId || "");
                      setWord(j.includeWord || "");
                      setRefs([]);
                      api("/games/" + j.gameId)
                        .then(setGame)
                        .catch((e) => setError(e.message));
                      setTab("create");
                      window.scrollTo({ top: 0, behavior: "instant" });
                    }}
                  >
                    <img src={j.url} alt={j.text} />
                  </button>
                  <div className="history-links">
                    <a
                      href={j.shareToken ? `/m/${j.shareToken}` : "#share"}
                      onClick={(e) => {
                        e.preventDefault();
                        share(j);
                      }}
                    >
                      Share
                    </a>
                    <a
                      className="delete-link"
                      href="#delete"
                      aria-disabled={deleting === j.id}
                      onClick={async (e) => {
                        e.preventDefault();
                        if (
                          deleting ||
                          !window.confirm(
                            "Delete this meme? Its shared link will redirect to the homepage.",
                          )
                        )
                          return;
                        setDeleting(j.id);
                        try {
                          await api(`/generations/${j.id}`, "DELETE");
                          setHistory((rows) =>
                            rows.filter((row) => row.id !== j.id),
                          );
                          preparedShares.current.delete(j.id);
                          if (job?.id === j.id) {
                            setJob(null);
                            sessionStorage.removeItem("tt-job");
                          }
                        } catch (e: any) {
                          setError(e.message);
                        } finally {
                          setDeleting(null);
                        }
                      }}
                    >
                      {deleting === j.id ? "Deleting…" : "Delete"}
                    </a>
                  </div>
                </article>
              ))}
            </div>
            {!history.length && (
              <div className="empty-history">
                <p>No masterpieces of disrespect to display yet.</p>
                {me && !me.authenticated && (
                  <>
                    <p>
                      Sign in with Google to see your saved trash talk across
                      devices.
                    </p>
                    <div ref={google} />
                    {!me.googleClientId && (
                      <p>Google sign-in is awaiting configuration.</p>
                    )}
                  </>
                )}
                <a
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    resetToStepOne();
                  }}
                >
                  Show some disrespect
                </a>
              </div>
            )}
            {history.length >= 30 && (
              <button
                onClick={async () => {
                  const last = history.at(-1);
                  const rows = await api(
                    "/my-images?before=" +
                      last.createdAt +
                      "&beforeId=" +
                      last.id,
                  );
                  setHistory([...history, ...rows]);
                  if (!rows.length)
                    setError("You have reached your first image.");
                }}
              >
                Load older images
              </button>
            )}
          </section>
        ) : (
          <section className="panel account">
            <h1>{tab === "credits" ? "Credits" : "Account"}</h1>
            {tab === "credits" && (
              <>
                <p>Available credits</p>
                <dl className="credit-balances">
                  <div>
                    <dt>Free credits</dt>
                    <dd>{me ? me.trial : "—"}</dd>
                  </div>
                  <div>
                    <dt>Paid credits</dt>
                    <dd>{me ? me.paid : "—"}</dd>
                  </div>
                </dl>
                <p>One credit creates one meme.</p>
                <h2>
                  {offerPrice}. {offer.credits} credits. Your call.
                </h2>
                <p>No subscription. Credits do not expire.</p>
              </>
            )}
            {!me?.authenticated ? (
              <>
                {tab === "credits" && (
                  <p>First, sign in with Google to buy more credits.</p>
                )}
                <div ref={google} />
                <p>
                  For adults 18+. By using TrashTalk, you agree to the{" "}
                  <a href="/terms">Terms of Service</a>. Read our{" "}
                  {me?.admin && (
                    <>
                      <button
                        className="stats-link"
                        onClick={() => setTab("stats")}
                      >
                        App stats
                      </button>{" "}
                      ·{" "}
                    </>
                  )}
                  <a href="/privacy">Privacy Policy</a>.
                </p>
                {!me?.googleClientId && (
                  <p>Google sign-in is awaiting configuration.</p>
                )}
              </>
            ) : (
              <>
                {tab === "credits" && (
                  <>
                    <button
                      className="primary"
                      onClick={buy}
                      disabled={busy || !me.paymentsReady}
                    >
                      Buy {offer.credits} credits — {offerPrice}
                    </button>
                    {!me.paymentsReady && (
                      <p>Payments are awaiting configuration.</p>
                    )}
                  </>
                )}
                {tab === "account" && (
                  <button
                    onClick={async () => {
                      await api("/auth/logout", "POST", {});
                      sessionStorage.clear();
                      location.reload();
                    }}
                  >
                    Sign out
                  </button>
                )}
                {tab === "account" && (
                  <p>
                    Your favorites and images are saved to your Google account.
                  </p>
                )}
              </>
            )}
            {tab === "credits" && me?.authenticated && purchases.length > 0 && (
              <>
                <h2>Purchases</h2>
                {purchases.map((p) => (
                  <p key={p.session_id}>
                    {new Date(p.created_at * 1000).toLocaleDateString()} · $
                    {(p.amount / 100).toFixed(2)} · {p.status} · {p.credits}{" "}
                    credits
                  </p>
                ))}
              </>
            )}
          </section>
        )}
        <footer>
          TrashTalk · Real teams. Ridiculous memes. Absolutely no chill.
          <p>
            {me?.admin && (
              <>
                <button className="stats-link" onClick={() => setTab("stats")}>
                  App stats
                </button>{" "}
                ·{" "}
              </>
            )}
            <a href="/privacy">Privacy Policy</a> ·{" "}
            <a href="/terms">Terms of Service</a>
          </p>
        </footer>
      </main>
      <dialog
        ref={dialog}
        onCancel={() => setViewer(false)}
        onClose={() => {
          setViewer(false);
          shareButton.current?.focus();
        }}
      >
        <button
          className="close"
          aria-label="Close image"
          onClick={() => setViewer(false)}
        >
          ×
        </button>
        <img
          src={job?.url}
          alt={job?.text}
          onTouchStart={(e) => {
            (e.currentTarget as any).touchY = e.touches[0].clientY;
          }}
          onTouchEnd={(e) => {
            if (
              Math.abs(
                e.changedTouches[0].clientY - (e.currentTarget as any).touchY,
              ) > 100
            )
              setViewer(false);
          }}
        />
        <button className="primary share-action" onClick={() => share()}>
          ↗ Share
        </button>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
