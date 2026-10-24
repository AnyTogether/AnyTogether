"use client";

import { Avatar } from "@/components/Avatar";
import { useLiveEvents, useWatch } from "@/components/Live";
import { ProfileMenu } from "@/components/ProfileMenu";
import {
  type Discovery,
  type JoinMode,
  type LfgPost,
  type PersonCard,
  type Purpose,
  type Region,
  languageName,
  maxCoopSlots,
  maxNote,
  maxSlots,
  pickLanguages,
  purposes,
  regions,
} from "@/lib/discover";
import type { UiStrings } from "@/lib/i18n";
import { type Person, fill, isUserId } from "@/lib/people";
import { json, social } from "@/lib/social";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Redraws the page (its server parts) when a watched topic or one of these personal events says
 *  something changed; a burst of them redraws once. A reconnect redraws too: events may have been
 *  missed. */
export function RefreshOn({ topics, events }: { topics: string[]; events: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  useWatch(topics);
  useLiveEvents((event) => {
    if (event.type === "live.ready") {
      if (!ready.current) {
        ready.current = true;
        return;
      }
    } else if (!events.includes(event.type)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 250);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}

/** A filter that lives in the address: picking an option changes one search parameter. */
export function FilterSelect({
  name,
  value,
  label,
  options,
}: {
  name: string;
  value: string;
  label: string;
  options: [string, string][];
}) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  return (
    <label className="filter">
      <span className="visually-hidden">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = new URLSearchParams(search.toString());
          if (event.target.value) next.set(name, event.target.value);
          else next.delete(name);
          router.push(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
        }}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const errorOf = (status: number, code: string | undefined, texts: UiStrings) =>
  status === 429
    ? texts.tooMany
    : code === "link_blocked"
      ? texts.linkBlocked
      : code === "full"
        ? texts.partyFull
        : code === "not_party_leader"
          ? texts.notPartyLeader
          : status === 409 && code === "conflict"
            ? texts.postClosed
            : texts.failed;

/** The next time of day `hhmm` happens, from now: today, or tomorrow when it has passed. */
function nextAt(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date();
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  if (date.getTime() < Date.now() - 5 * 60_000) date.setDate(date.getDate() + 1);
  return date;
}

/** "Post" and the sheet that makes a looking-for-group post. */
export function LfgComposer({
  texts,
  games,
  defaultLanguages,
  defaultGame,
}: {
  texts: UiStrings;
  games: { titleId: string; name: string }[];
  defaultLanguages: string[];
  defaultGame?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const first = defaultGame ?? games[0]?.titleId ?? "";
  const [game, setGame] = useState(first || "other");
  const [other, setOther] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("online");
  const [later, setLater] = useState(false);
  const [time, setTime] = useState("21:00");
  const [chosen, setChosen] = useState<string[]>(defaultLanguages.slice(0, 3));
  const [offered, setOffered] = useState<string[]>([...new Set([...defaultLanguages, "en", "tr"])]);
  const [region, setRegion] = useState<Region | "">("");
  const [slots, setSlots] = useState(2);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxFor = purpose === "coop" ? maxCoopSlots : maxSlots;
  const titleId = game === "other" ? other.trim().toUpperCase() : game;

  useEffect(() => {
    if (slots > maxFor) setSlots(maxFor);
  }, [maxFor, slots]);

  const toggle = (code: string) =>
    setChosen((list) =>
      list.includes(code) ? list.filter((c) => c !== code) : list.length < 3 ? [...list, code] : list,
    );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[A-Z]{4}[0-9]{5}$/.test(titleId)) return setError(texts.badTitleId);
    setBusy(true);
    setError(null);
    const start = later ? nextAt(time) : null;
    const from = start?.getTime() ?? Date.now();
    const expires = Math.min(Date.now() + 24 * 3_600_000 - 60_000, from + hours * 3_600_000);
    const made = await social<{ code?: string }>("lfg", {
      method: "POST",
      ...json({
        titleId,
        purpose,
        languages: chosen.length ? chosen : ["en"],
        slots,
        ...(start ? { startsAt: start.toISOString() } : {}),
        ...(region ? { region } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        expiresAt: new Date(expires).toISOString(),
      }),
    });
    setBusy(false);
    if (!made.ok) {
      const code = made.body?.code;
      return setError(
        made.status === 409 && code === "conflict"
          ? texts.tooManyOpen
          : made.status === 400 && !code?.startsWith("link")
            ? texts.failed
            : errorOf(made.status, code, texts),
      );
    }
    dialog.current?.close();
    setNote("");
    router.refresh();
  }

  return (
    <>
      <button type="button" className="primary small post-btn" onClick={() => dialog.current?.showModal()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {texts.lfgPost}
      </button>
      <dialog
        ref={dialog}
        className="sheet lfg-sheet"
        aria-labelledby="lfg-new"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") dialog.current?.close();
        }}
      >
        <form className="sheet-body" onSubmit={submit}>
          <h3 id="lfg-new">{texts.lfgNew}</h3>
          <p className="hint">{texts.lfgNewLead}</p>

          <div className="field-group">
            <label htmlFor="lfg-game">{texts.game}</label>
            <select id="lfg-game" value={game} onChange={(event) => setGame(event.target.value)}>
              {games.map((g) => (
                <option key={g.titleId} value={g.titleId}>
                  {g.name}
                </option>
              ))}
              <option value="other">{texts.otherGame}</option>
            </select>
            {game === "other" && (
              <input
                aria-label={texts.titleIdLabel}
                placeholder={texts.titleIdPlaceholder}
                value={other}
                maxLength={9}
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => setOther(event.target.value.toUpperCase())}
              />
            )}
          </div>

          <fieldset className="purpose-pick">
            <legend>{texts.whatFor}</legend>
            {purposes.map((p) => (
              <label key={p} className={`purpose-opt p-${p}${purpose === p ? " on" : ""}`}>
                <input
                  type="radio"
                  name="purpose"
                  value={p}
                  checked={purpose === p}
                  onChange={() => setPurpose(p)}
                />
                <span className="purpose-name">{texts[`purpose_${p}`]}</span>
                <span className="purpose-hint">{texts[`purposeHint_${p}`]}</span>
              </label>
            ))}
          </fieldset>

          <div className="lfg-row">
            <div className="field-group">
              <span className="label">{texts.when}</span>
              <div className="seg-mini">
                <button type="button" aria-pressed={!later} onClick={() => setLater(false)}>
                  {texts.whenNow}
                </button>
                <button type="button" aria-pressed={later} onClick={() => setLater(true)}>
                  {texts.whenLater}
                </button>
              </div>
              {later && (
                <input
                  type="time"
                  aria-label={texts.startTime}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              )}
            </div>
            <div className="field-group">
              <label htmlFor="lfg-slots">{texts.playersWanted}</label>
              <div className="stepper">
                <button
                  type="button"
                  className="pill icon"
                  aria-label="−"
                  disabled={slots <= 1}
                  onClick={() => setSlots(slots - 1)}
                >
                  −
                </button>
                <output id="lfg-slots" aria-live="polite">
                  {slots}
                </output>
                <button
                  type="button"
                  className="pill icon"
                  aria-label="+"
                  disabled={slots >= maxFor}
                  onClick={() => setSlots(slots + 1)}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="field-group">
            <span className="label">{texts.languagesUpTo}</span>
            <div className="lang-chips">
              {offered.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="lang-chip"
                  aria-pressed={chosen.includes(code)}
                  onClick={() => toggle(code)}
                >
                  {languageName(code, texts.language)}
                </button>
              ))}
              <select
                className="lang-more"
                aria-label={texts.languagesUpTo}
                value=""
                onChange={(event) => {
                  const code = event.target.value;
                  if (!code) return;
                  setOffered((list) => [...new Set([...list, code])]);
                  toggle(code);
                }}
              >
                <option value="">+</option>
                {pickLanguages
                  .filter((code) => !offered.includes(code))
                  .map((code) => (
                    <option key={code} value={code}>
                      {languageName(code, texts.language)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="lfg-row">
            <div className="field-group">
              <label htmlFor="lfg-region">{texts.region}</label>
              <select
                id="lfg-region"
                value={region}
                onChange={(event) => setRegion(event.target.value as Region | "")}
              >
                <option value="">{texts.anywhere}</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {texts[`region_${r}`]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="lfg-hours">{texts.endsAfter}</label>
              <select id="lfg-hours" value={hours} onChange={(event) => setHours(Number(event.target.value))}>
                {[1, 2, 3, 4, 6, 8, 12, 24].map((n) => (
                  <option key={n} value={n}>
                    {fill(texts.hoursN, { n })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group">
            <div className="label-row">
              <label htmlFor="lfg-note">{texts.note}</label>
              <span className={`counter${note.length > maxNote - 15 ? " near" : ""}`} aria-hidden="true">
                {note.length}/{maxNote}
              </span>
            </div>
            <textarea
              id="lfg-note"
              rows={2}
              maxLength={maxNote}
              placeholder={texts.lfgNotePlaceholder}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="pill" onClick={() => dialog.current?.close()}>
              {texts.cancel}
            </button>
            <button type="submit" className="primary small" disabled={busy}>
              {busy ? texts.posting : texts.postIt}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** What a reader can do with someone else's post: I'm in, take it back, follow the invite; and
 *  report it. On their own post, close it. */
export function LfgActions({ post, texts }: { post: LfgPost; texts: UiStrings }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const result = await social<{ code?: string }>(path, init);
    setBusy(false);
    if (!result.ok) setError(errorOf(result.status, result.body?.code, texts));
    router.refresh();
  }

  const open = post.status === "open";
  let main: ReactNode = null;
  if (post.mine) {
    main =
      open || post.status === "full" ? (
        <button
          type="button"
          className="pill"
          disabled={busy}
          onClick={() => run(`lfg/${post.id}`, { method: "DELETE" })}
        >
          {texts.closePost}
        </button>
      ) : null;
  } else if (post.myRequest?.status === "accepted") {
    const invite = post.myRequest.invite;
    main = (
      <>
        <span className="tag in-tag">{texts.youreIn}</span>
        {invite && (
          <Link href={invite.kind === "party" ? "/party" : `/watch/${invite.id}`} className="primary small">
            {invite.kind === "party" ? texts.openParty : texts.watchNow}
          </Link>
        )}
      </>
    );
  } else if (post.myRequest?.status === "pending") {
    main = (
      <>
        <span className="tag">
          <i className="dot" />
          {texts.askedState}
        </span>
        <button
          type="button"
          className="pill"
          disabled={busy}
          onClick={() => run(`lfg/${post.id}/requests/me`, { method: "DELETE" })}
        >
          {texts.takeBack}
        </button>
      </>
    );
  } else if (post.myRequest?.status === "declined") {
    main = <span className="tag">{texts.notThisTime}</span>;
  } else if (open) {
    main = (
      <button
        type="button"
        className="primary small"
        disabled={busy}
        onClick={() => run(`lfg/${post.id}/requests`, { method: "POST" })}
      >
        {texts.imIn}
      </button>
    );
  }

  return (
    <div className="lfg-acts">
      {main}
      {!post.mine && (
        <ProfileMenu
          person={{ userId: post.id, displayName: post.author.displayName }}
          texts={texts}
          kind="lfg"
          label={texts.reportPost}
          title={texts.reportPostTitle}
          lead={fill(texts.reportPostLead, { name: post.author.displayName })}
        />
      )}
      {error && (
        <p className="error lfg-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Who wants in on the reader's own post, with Let in and Decline for those who wait. */
export function LfgRequests({ post, texts }: { post: LfgPost; texts: UiStrings }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = post.requests ?? [];

  async function answer(userId: string, verdict: "accept" | "decline") {
    if (!isUserId(userId)) return;
    setBusy(userId);
    setError(null);
    const result = await social<{ code?: string }>(`lfg/${post.id}/requests/${userId}/${verdict}`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) setError(errorOf(result.status, result.body?.code, texts));
    router.refresh();
  }

  if (!list.length)
    return post.status === "open" ? <p className="hint lfg-wait">{texts.noRequestsYet}</p> : null;
  return (
    <div className="lfg-requests">
      <span className="sub">
        {texts.wantsIn} <span className="n">{list.filter((r) => r.status === "pending").length}</span>
      </span>
      <ul className="people">
        {list.map((request) => (
          <li key={request.user.userId} className="person">
            <Link href={`/u/${request.user.handle}`} className="who">
              <Avatar person={request.user} size={34} />
              <span className="lines">
                <span className="name">{request.user.displayName}</span>
                <span className="meta">
                  {request.status === "accepted"
                    ? request.invite?.kind === "share_play"
                      ? texts.invitedToShare
                      : texts.invitedToParty
                    : `@${request.user.handle}`}
                </span>
              </span>
            </Link>
            <div className="acts">
              {request.status === "pending" ? (
                <>
                  <button
                    type="button"
                    className="primary small"
                    disabled={busy !== null || post.status !== "open"}
                    onClick={() => answer(request.user.userId, "accept")}
                  >
                    {texts.letIn}
                  </button>
                  <button
                    type="button"
                    className="pill"
                    disabled={busy !== null}
                    onClick={() => answer(request.user.userId, "decline")}
                  >
                    {texts.decline}
                  </button>
                </>
              ) : (
                <span className={`tag${request.status === "accepted" ? " in-tag" : ""}`}>
                  {request.status === "accepted" ? texts.requestIn : texts.requestNo}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Joining a public party or share play: walk in when it is open, else ask (and take it back). */
export function JoinPublic({
  kind,
  id,
  join,
  requested,
  full,
  texts,
}: {
  kind: "party" | "share_play";
  id: string;
  join: JoinMode;
  requested: boolean;
  full: boolean;
  texts: UiStrings;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = kind === "party" ? `parties/${id}` : `share-plays/${id}`;

  async function run(path: string, init: RequestInit, then?: string) {
    setBusy(true);
    setError(null);
    const result = await social<{ code?: string }>(path, init);
    setBusy(false);
    if (!result.ok) return setError(errorOf(result.status, result.body?.code, texts));
    if (then) router.push(then);
    else router.refresh();
  }

  return (
    <div className="acts join-acts">
      {join === "open" ? (
        kind === "share_play" ? (
          <Link
            href={`/watch/${id}`}
            className={`pill watch-btn${full ? " disabled" : ""}`}
            aria-disabled={full}
          >
            {texts.watchNow}
          </Link>
        ) : (
          <button
            type="button"
            className="primary small"
            disabled={busy || full}
            onClick={() => run(`${base}/join`, { method: "POST" }, "/party")}
          >
            {texts.join}
          </button>
        )
      ) : requested ? (
        <>
          <span className="tag">
            <i className="dot" />
            {texts.askedState}
          </span>
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() => run(`${base}/requests/me`, { method: "DELETE" })}
          >
            {texts.takeBack}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="pill"
          disabled={busy || full}
          onClick={() => run(`${base}/requests`, { method: "POST" })}
        >
          {texts.askToJoin}
        </button>
      )}
      {error && (
        <p className="error join-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Add someone as a friend from a discovery card; their answer shows on the next visit. */
export function AddFriend({
  card,
  texts,
}: { card: Pick<PersonCard, "user" | "friendship">; texts: UiStrings }) {
  const router = useRouter();
  const [state, setState] = useState(card.friendship);
  const [busy, setBusy] = useState(false);
  if (state === "friends") return <span className="tag friends">{texts.areFriends}</span>;
  if (state === "pending_out")
    return (
      <span className="tag">
        <i className="dot" />
        {texts.requested}
      </span>
    );
  return (
    <button
      type="button"
      className={state === "pending_in" ? "primary small" : "pill"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const response = await fetch("/me/friends/requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: card.user.handle }),
        }).catch(() => undefined);
        const body = (await response?.json().catch(() => ({}))) as { state?: string };
        setBusy(false);
        if (response?.ok) {
          setState(body.state === "accepted" ? "friends" : "pending_out");
          router.refresh();
        }
      }}
    >
      {state === "pending_in" ? texts.accept : texts.add}
    </button>
  );
}

/** People by handle or name, as the friends page finds them, with Add. */
export function PeopleSearch({ texts }: { texts: UiStrings }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);
  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    if (q.length < 2) {
      setFound(null);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetch(`/me/users/search?q=${encodeURIComponent(q)}`).catch(() => undefined);
      if (response?.ok) setFound(((await response.json()) as { users: Person[] }).users);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="card search">
      <label htmlFor="people-q">{texts.searchLabel}</label>
      <div className="field">
        <span className="at" aria-hidden="true">
          @
        </span>
        <input
          id="people-q"
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={texts.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {found && (
        <ul className="people results">
          {found.length === 0 && <li className="hint empty">{texts.noResults}</li>}
          {found.map((person) => (
            <li key={person.userId} className="person">
              <Link href={`/u/${person.handle}`} className="who">
                <Avatar person={person} size={34} />
                <span className="lines">
                  <span className="name">{person.displayName}</span>
                  <span className="meta">@{person.handle}</span>
                </span>
              </Link>
              <div className="acts">
                <AddFriend card={{ user: person, friendship: "none" }} texts={texts} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Show me in discovery" and the languages the person plays in, saved as soon as they change. */
export function DiscoverySettings({ initial, texts }: { initial: Discovery; texts: UiStrings }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  async function save(change: { discoverable?: boolean | null; languages?: string[] }) {
    const before = value;
    if (change.discoverable !== undefined)
      setValue({
        ...value,
        discoverable: change.discoverable ?? value.discoverable,
        chosen: change.discoverable,
      });
    if (change.languages) setValue((v) => ({ ...v, languages: change.languages as string[] }));
    const saved = await social<Discovery>("me/discovery", { method: "PATCH", ...json(change) });
    if (!saved.body) {
      setValue(before);
      return setStatus("error");
    }
    setValue(saved.body);
    setStatus("saved");
  }

  const toggleLanguage = (code: string) => {
    const has = value.languages.includes(code);
    if (!has && value.languages.length >= 5) return;
    save({ languages: has ? value.languages.filter((c) => c !== code) : [...value.languages, code] });
  };

  return (
    <div className="discovery-settings">
      <div className="toggles">
        <label className="toggle-row digest">
          <span className="lines">
            <span>{texts.showInDiscovery}</span>
            <span className="meta">
              {value.chosen === null ? texts.discoveryFollows : texts.discoveryChosen}
            </span>
          </span>
          <input
            type="checkbox"
            checked={value.discoverable}
            onChange={(event) => save({ discoverable: event.target.checked })}
          />
          <span className="toggle" />
        </label>
      </div>
      {value.chosen !== null && (
        <button type="button" className="link reset-link" onClick={() => save({ discoverable: null })}>
          {texts.discoveryReset}
        </button>
      )}
      <div className="field-group lang-field">
        <span className="label">{texts.languagesYouPlay}</span>
        <div className="lang-chips">
          {[...new Set([...value.languages, ...pickLanguages])].map((code) => (
            <button
              key={code}
              type="button"
              className="lang-chip"
              aria-pressed={value.languages.includes(code)}
              onClick={() => toggleLanguage(code)}
            >
              {languageName(code, texts.language)}
            </button>
          ))}
        </div>
        <p className="meta hint-line">{texts.languagesHint}</p>
      </div>
      <div className="save-row">
        {status === "error" ? (
          <p className="error" role="alert">
            {texts.failed}
          </p>
        ) : (
          <output className={`saved${status === "saved" ? " on" : ""}`}>
            {status === "saved" ? texts.saved : ""}
          </output>
        )}
      </div>
    </div>
  );
}

/** The party page's public listing: the leader lists the party (how to join, its game and
 *  language) and lets in those who ask; everyone else sees how it is listed. */
export function PartyListing({
  party,
  leader,
  games,
  texts,
  onChange,
}: {
  party: {
    id: string;
    public?: { join: JoinMode; titleId: string | null; language: string | null } | null;
    requests?: Person[];
  };
  leader: boolean;
  games: { titleId: string; name: string }[];
  texts: UiStrings;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listing = party.public ?? null;
  const requests = party.requests ?? [];

  async function run(path: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const result = await social<{ code?: string }>(path, init);
    setBusy(false);
    if (!result.ok) setError(errorOf(result.status, result.body?.code, texts));
    onChange();
  }
  const list = (next: { join: JoinMode; titleId: string | null; language: string | null } | null) =>
    run(`parties/${party.id}`, { method: "PATCH", ...json({ public: next }) });
  const gameOptions =
    listing?.titleId && !games.some((g) => g.titleId === listing.titleId)
      ? [{ titleId: listing.titleId, name: listing.titleId }, ...games]
      : games;

  if (!leader && !listing) return null;
  return (
    <div className="card party-listing">
      <label className="toggle-row digest">
        <span className="lines">
          <span>{texts.partyPublic}</span>
          <span className="meta">{texts.partyPublicHint}</span>
        </span>
        <input
          type="checkbox"
          checked={Boolean(listing)}
          disabled={!leader || busy}
          onChange={(event) =>
            list(
              event.target.checked
                ? { join: "request", titleId: games[0]?.titleId ?? null, language: texts.language }
                : null,
            )
          }
        />
        <span className="toggle" />
      </label>
      {listing && (
        <div className="listing-fields">
          <div className="seg-mini">
            {(["request", "open"] as const).map((join) => (
              <button
                key={join}
                type="button"
                aria-pressed={listing.join === join}
                disabled={!leader || busy}
                onClick={() => listing.join !== join && list({ ...listing, join })}
              >
                {join === "open" ? texts.joinModeOpen : texts.joinModeRequest}
              </button>
            ))}
          </div>
          <select
            aria-label={texts.game}
            value={listing.titleId ?? ""}
            disabled={!leader || busy}
            onChange={(event) => list({ ...listing, titleId: event.target.value || null })}
          >
            <option value="">{texts.noGameListed}</option>
            {gameOptions.map((g) => (
              <option key={g.titleId} value={g.titleId}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            aria-label={texts.listLanguage}
            value={listing.language ?? ""}
            disabled={!leader || busy}
            onChange={(event) => list({ ...listing, language: event.target.value || null })}
          >
            <option value="">
              {texts.listLanguage}: {texts.noLanguage}
            </option>
            {pickLanguages.map((code) => (
              <option key={code} value={code}>
                {languageName(code, texts.language)}
              </option>
            ))}
          </select>
        </div>
      )}
      {requests.length > 0 && (
        <div className="lfg-requests">
          <span className="sub">
            {texts.askingToJoin} <span className="n">{requests.length}</span>
          </span>
          <ul className="people">
            {requests.map((person) => (
              <li key={person.userId} className="person">
                <Link href={`/u/${person.handle}`} className="who">
                  <Avatar person={person} size={34} />
                  <span className="lines">
                    <span className="name">{person.displayName}</span>
                    <span className="meta">@{person.handle}</span>
                  </span>
                </Link>
                {leader && (
                  <div className="acts">
                    <button
                      type="button"
                      className="primary small"
                      disabled={busy}
                      onClick={() =>
                        run(`parties/${party.id}/requests/${person.userId}/accept`, { method: "POST" })
                      }
                    >
                      {texts.letIn}
                    </button>
                    <button
                      type="button"
                      className="pill"
                      disabled={busy}
                      onClick={() =>
                        run(`parties/${party.id}/requests/${person.userId}/decline`, { method: "POST" })
                      }
                    >
                      {texts.decline}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
