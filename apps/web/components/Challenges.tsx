"use client";

import { Avatar } from "@/components/Avatar";
import {
  type Challenge,
  type ChallengeAudience,
  type ChallengeMetric,
  challengeAudiences,
  challengeLengths,
  challengeMetrics,
  progressOf,
} from "@/lib/challenges";
import type { UiStrings } from "@/lib/i18n";
import { type Person, fill } from "@/lib/people";
import { isoToLocalInput, localInputToIso } from "@/lib/psn";
import { json, social } from "@/lib/social";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export type GameChoice = { titleId: string; name: string };
export type CommunityChoice = { id: string; name: string };

/** The reader's time zone, known only in the browser: until then times are shown in UTC. */
function useZone() {
  const [zone, setZone] = useState<string>("UTC");
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  return zone;
}

const dateOf = (iso: string, language: string, timeZone: string) =>
  new Date(iso).toLocaleString(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

/** The window as a track: the start, the finish (a chequered flag) and where now is on it. */
export function ChallengeTrack({ challenge, texts }: { challenge: Challenge; texts: UiStrings }) {
  const zone = useZone();
  const [now, setNow] = useState(() => Date.parse(challenge.createdAt));
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const share = challenge.state === "cancelled" ? 0 : progressOf(challenge, now);
  return (
    <div className={`ch-track state-${challenge.state}`}>
      <div className="ch-rail" aria-hidden="true">
        <span className="ch-fill" style={{ "--share": share } as React.CSSProperties} />
        {challenge.state === "active" && (
          <span className="ch-now" style={{ "--share": share } as React.CSSProperties} />
        )}
        <span className="ch-flag" aria-hidden="true" />
      </div>
      <div className="ch-ends">
        <span>
          <b>{texts.challengeStart}</b>
          <time dateTime={challenge.startsAt}>{dateOf(challenge.startsAt, texts.language, zone)}</time>
        </span>
        <span className="end">
          <b>{texts.challengeEnd}</b>
          <time dateTime={challenge.endsAt}>{dateOf(challenge.endsAt, texts.language, zone)}</time>
        </span>
      </div>
    </div>
  );
}

/** Join or leave, invite friends, and (its maker or the community's moderators) cancel. */
export function ChallengeActions({
  challenge,
  texts,
  friends,
}: {
  challenge: Challenge;
  texts: UiStrings;
  friends: Person[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = challenge.state === "upcoming" || challenge.state === "active";

  async function act(path: string, method = "POST") {
    setBusy(true);
    setError(null);
    const done = await social<Challenge>(path, { method, ...(method === "POST" ? json({}) : {}) });
    setBusy(false);
    if (!done.ok)
      return setError(
        done.status === 429
          ? texts.tooMany
          : (done.body as { code?: string } | null)?.code === "restricted_by_family"
            ? texts.restrictedNotice
            : texts.failed,
      );
    router.refresh();
  }

  async function cancel() {
    if (!window.confirm(texts.confirmCancelChallenge)) return;
    await act(`challenges/${challenge.id}`, "DELETE");
  }

  if (!open) return null;
  return (
    <>
      <div className="community-actions">
        {!challenge.joined && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => act(`challenges/${challenge.id}/join`)}
          >
            {texts.joinChallenge}
          </button>
        )}
        {challenge.joined && friends.length > 0 && (
          <InviteFriends challenge={challenge} texts={texts} friends={friends} />
        )}
        {challenge.joined && !challenge.mine && (
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() => act(`challenges/${challenge.id}/leave`)}
          >
            {texts.leaveChallenge}
          </button>
        )}
        {challenge.canCancel && (
          <button type="button" className="pill danger" disabled={busy} onClick={cancel}>
            {texts.cancelChallenge}
          </button>
        )}
      </div>
      {!challenge.joined && <p className="hint ch-note">{texts.joinNote}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Friends to pick, as checkable faces. */
function FriendPicker({
  friends,
  picked,
  onChange,
  label,
}: {
  friends: Person[];
  picked: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className="ch-friends">
      <legend className="visually-hidden">{label}</legend>
      {friends.map((friend) => {
        const on = picked.includes(friend.userId);
        return (
          <label key={friend.userId} className={on ? "on" : undefined}>
            <input
              type="checkbox"
              checked={on}
              onChange={() =>
                onChange(on ? picked.filter((id) => id !== friend.userId) : [...picked, friend.userId])
              }
            />
            <Avatar person={friend} size={28} />
            <span>{friend.displayName}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function InviteFriends({
  challenge,
  texts,
  friends,
}: { challenge: Challenge; texts: UiStrings; friends: Person[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const done = await social<{ invited: number }>(`challenges/${challenge.id}/invites`, {
      method: "POST",
      ...json({ userIds: picked }),
    });
    setBusy(false);
    if (!done.ok || !done.body) return setNote(done.status === 429 ? texts.tooMany : texts.failed);
    setNote(done.body.invited ? fill(texts.invitedN, { n: done.body.invited }) : texts.invitedNone);
    setPicked([]);
  }

  return (
    <>
      <button
        type="button"
        className="pill"
        onClick={() => {
          setNote(null);
          dialog.current?.showModal();
        }}
      >
        {texts.challengeInvite}
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-labelledby={heading}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") dialog.current?.close();
        }}
      >
        <div className="sheet-body">
          <h3 id={heading}>{texts.challengeInvite}</h3>
          <form className="form" onSubmit={send}>
            <FriendPicker
              friends={friends}
              picked={picked}
              onChange={setPicked}
              label={texts.challengeInvite}
            />
            {note && <output className="hint">{note}</output>}
            <div className="row">
              <button type="button" className="pill" onClick={() => dialog.current?.close()}>
                {texts.done}
              </button>
              <button type="submit" className="primary small" disabled={busy || picked.length === 0}>
                {texts.inviteSend}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}

/** Making a challenge: a game, what counts, who may join, when and how long. */
export function ChallengeComposer({
  texts,
  games,
  communities,
  friends,
  startOpen,
  defaultGame,
}: {
  texts: UiStrings;
  games: GameChoice[];
  communities: CommunityChoice[];
  friends: Person[];
  startOpen: boolean;
  defaultGame?: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [title, setTitle] = useState("");
  const [titleId, setTitleId] = useState(defaultGame ?? games[0]?.titleId ?? "");
  const [metric, setMetric] = useState<ChallengeMetric>("points");
  const [audience, setAudience] = useState<ChallengeAudience>("friends");
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");
  const [start, setStart] = useState("");
  const [hours, setHours] = useState<number>(168);
  const [description, setDescription] = useState("");
  const [invite, setInvite] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    // The next full hour, in the reader's own time zone.
    const next = new Date(Date.now() + 3_600_000);
    next.setMinutes(0, 0, 0);
    setStart(isoToLocalInput(next.toISOString()));
    setError(null);
    dialog.current?.showModal();
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: opened once, from ?new=1.
  useEffect(() => {
    if (startOpen) open();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = localInputToIso(start);
    if (!startsAt) return setError(texts.challengeTimeError);
    const endsAt = new Date(Date.parse(startsAt) + hours * 3_600_000).toISOString();
    setBusy(true);
    setError(null);
    const made = await social<Challenge>("challenges", {
      method: "POST",
      ...json({
        title,
        titleId,
        metric,
        audience,
        ...(audience === "community" ? { communityId } : {}),
        startsAt,
        endsAt,
        ...(description.trim() ? { description } : {}),
        ...(invite.length && audience !== "community" ? { invite } : {}),
      }),
    });
    setBusy(false);
    if (!made.ok || !made.body)
      return setError(
        made.status === 400
          ? texts.challengeTimeError
          : made.status === 409
            ? texts.challengeTooMany
            : made.status === 429
              ? texts.tooMany
              : (made.body as { code?: string } | null)?.code === "restricted_by_family"
                ? texts.restrictedNotice
                : texts.failed,
      );
    dialog.current?.close();
    router.push(`/challenges/${made.body.id}`);
  }

  const audiences = challengeAudiences.filter((a) => a !== "community" || communities.length > 0);

  return (
    <>
      <button type="button" className="primary small" onClick={open}>
        {texts.newChallenge}
      </button>
      <dialog
        ref={dialog}
        className="sheet ch-sheet"
        aria-labelledby={heading}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") dialog.current?.close();
        }}
      >
        <div className="sheet-body">
          <h3 id={heading}>{texts.newChallenge}</h3>
          {games.length === 0 ? (
            <>
              <p className="hint">{texts.challengeNoGames}</p>
              <div className="row">
                <button type="button" className="pill" onClick={() => dialog.current?.close()}>
                  {texts.done}
                </button>
              </div>
            </>
          ) : (
            <form className="form" onSubmit={submit}>
              <label className="stack">
                <span>{texts.challengeName}</span>
                <input
                  value={title}
                  onChange={(ev) => setTitle(ev.target.value)}
                  placeholder={texts.challengeNamePlaceholder}
                  minLength={3}
                  maxLength={80}
                  required
                />
              </label>
              <label className="stack">
                <span>{texts.challengeGame}</span>
                <select value={titleId} onChange={(ev) => setTitleId(ev.target.value)}>
                  {games.map((g) => (
                    <option key={g.titleId} value={g.titleId}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="ch-metrics">
                <legend className="stack-legend">{texts.challengeMetric}</legend>
                {challengeMetrics.map((m) => (
                  <label key={m} className={metric === m ? "on" : undefined}>
                    <input
                      type="radio"
                      name="metric"
                      value={m}
                      checked={metric === m}
                      onChange={() => setMetric(m)}
                    />
                    <MetricGlyph metric={m} />
                    <b>{texts[`metric_${m}`]}</b>
                    <span>{texts[`metricHint_${m}`]}</span>
                  </label>
                ))}
              </fieldset>
              <div className="two">
                <label className="stack">
                  <span>{texts.challengeStart}</span>
                  <input
                    type="datetime-local"
                    value={start}
                    onChange={(ev) => setStart(ev.target.value)}
                    required
                  />
                </label>
                <label className="stack">
                  <span>{texts.challengeLength}</span>
                  <select value={hours} onChange={(ev) => setHours(Number(ev.target.value))}>
                    {challengeLengths.map((length) => (
                      <option key={length.hours} value={length.hours}>
                        {texts[length.key]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={audience === "community" ? "two" : undefined}>
                <label className="stack">
                  <span>{texts.challengeAudience}</span>
                  <select
                    value={audience}
                    onChange={(ev) => setAudience(ev.target.value as ChallengeAudience)}
                  >
                    {audiences.map((a) => (
                      <option key={a} value={a}>
                        {texts[`audience_${a}`]}
                      </option>
                    ))}
                  </select>
                </label>
                {audience === "community" && (
                  <label className="stack">
                    <span>{texts.challengeCommunity}</span>
                    <select value={communityId} onChange={(ev) => setCommunityId(ev.target.value)}>
                      {communities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {audience !== "community" && friends.length > 0 && (
                <div className="stack">
                  <span>{texts.challengeInvite}</span>
                  <FriendPicker
                    friends={friends}
                    picked={invite}
                    onChange={setInvite}
                    label={texts.challengeInvite}
                  />
                  <p className="hint">{texts.challengeInviteHint}</p>
                </div>
              )}
              <label className="stack">
                <span>{texts.challengeNote}</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(ev) => setDescription(ev.target.value)}
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row">
                <button type="button" className="pill" onClick={() => dialog.current?.close()}>
                  {texts.cancel}
                </button>
                <button
                  type="submit"
                  className="primary small"
                  disabled={busy || title.trim().length < 3 || !titleId}
                >
                  {texts.makeChallenge}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

/** What counts, drawn: a cup for points, a stack for trophies, a clock for play time. */
export function MetricGlyph({ metric }: { metric: ChallengeMetric }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ch-glyph">
      {metric === "points" ? (
        <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4.5a2.5 2.5 0 0 0 2.6 3.4M17 6h2.5a2.5 2.5 0 0 1-2.6 3.4M12 13v4M8.5 20h7M9.5 17h5" />
      ) : metric === "trophies" ? (
        <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8-4.2-4.1 5.8-.8z" />
      ) : (
        <>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 9v4l2.6 1.6M9.5 3h5" />
        </>
      )}
    </svg>
  );
}
