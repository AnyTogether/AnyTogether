"use client";

import { Avatar } from "@/components/Avatar";
import type { GameOption } from "@/components/Communities";
import { ProfileMenu } from "@/components/ProfileMenu";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type PlannedEvent,
  byDay,
  dayKey,
  eventDurations,
  isoToLocalInput,
  linkHref,
  localInputToIso,
} from "@/lib/psn";
import { json, social } from "@/lib/social";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/** The reader's time zone, known only in the browser: until then (the server's render and the
 *  first one in the browser) times are shown in UTC. */
function useZone() {
  const [zone, setZone] = useState<string | undefined>("UTC");
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  return zone;
}

const timeOf = (iso: string, language: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZone });

/** "Today", "Tomorrow" or the date, in the reader's time zone. */
function dayLabel(day: string, texts: UiStrings, timeZone?: string) {
  const today = dayKey(new Date().toISOString(), timeZone);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString(), timeZone);
  if (day === today) return texts.dayToday;
  if (day === tomorrow) return texts.dayTomorrow;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(texts.language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

const isLive = (event: PlannedEvent, now: number) =>
  event.status === "scheduled" && Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) > now;

function EventRow({
  event,
  texts,
  zone,
  showCommunity,
}: {
  event: PlannedEvent;
  texts: UiStrings;
  zone?: string;
  showCommunity: boolean;
}) {
  const { language } = texts;
  const live = isLive(event, Date.now()) || !!event.link;
  const game = event.game ? localName(event.game.names, language) || event.titleId : null;
  return (
    <Link href={`/events/${event.id}`} className={`event-row${live ? " live" : ""}`}>
      <span className="event-time">
        <b>{timeOf(event.startsAt, language, zone)}</b>
        <span>{timeOf(event.endsAt, language, zone)}</span>
      </span>
      <span className="lines">
        <span className="name">{event.title}</span>
        <span className="meta">
          {[showCommunity ? event.community.name : null, game, event.host?.displayName]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="rsvp-n">
        {live && <span className="chip live">{texts.eventLive}</span>}
        {!live && (
          <>
            {event.mine && <span className="mine">✓ {texts[event.mine]}</span>}
            <span>{fill(texts.goingN, { n: event.going })}</span>
          </>
        )}
      </span>
    </Link>
  );
}

/** Events grouped by the day they start on, in the reader's time zone. */
export function EventDays({
  texts,
  events,
  showCommunity = true,
  empty,
}: {
  texts: UiStrings;
  events: PlannedEvent[];
  showCommunity?: boolean;
  empty: string;
}) {
  const zone = useZone();
  if (!events.length) return <p className="empty">{empty}</p>;
  return (
    <>
      <div className="event-days">
        {byDay(events, zone).map(({ day, events: list }) => (
          <section key={day} className="event-day">
            <h4>{dayLabel(day, texts, zone)}</h4>
            <ul className="event-list">
              {list.map((event) => (
                <li key={event.id}>
                  <EventRow event={event} texts={texts} zone={zone} showCommunity={showCommunity} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {zone && zone !== "UTC" && <p className="hint tz-note">{fill(texts.timeZoneNote, { zone })}</p>}
    </>
  );
}

/** When an event is, in the reader's time zone. */
export function EventWhen({ event, texts }: { event: PlannedEvent; texts: UiStrings }) {
  const zone = useZone();
  const { language } = texts;
  const day = dayLabel(dayKey(event.startsAt, zone), texts, zone);
  return (
    <div className="event-when">
      <b>{day}</b>
      <span>
        {timeOf(event.startsAt, language, zone)} – {timeOf(event.endsAt, language, zone)}
      </span>
      {zone && zone !== "UTC" && <span className="meta">{zone}</span>}
    </div>
  );
}

/** Planning an event in a community, or (with `event`) changing one. */
export function EventComposer({
  texts,
  communityId,
  games,
  defaultGame,
  event,
}: {
  texts: UiStrings;
  communityId: string;
  games: GameOption[];
  defaultGame?: string | null;
  event?: PlannedEvent;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(
    event ? Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000) : 60,
  );
  const [titleId, setTitleId] = useState(event?.titleId ?? defaultGame ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const durations: number[] = eventDurations.includes(duration as (typeof eventDurations)[number])
    ? [...eventDurations]
    : [...eventDurations, duration].sort((a, b) => a - b);

  function open() {
    // The start in the reader's own time zone: the event's, or the next full hour.
    const next = new Date(Date.now() + 3_600_000);
    next.setMinutes(0, 0, 0);
    setStart(isoToLocalInput(event?.startsAt ?? next.toISOString()));
    dialog.current?.showModal();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const startsAt = localInputToIso(start);
    if (!startsAt) return setError(texts.timeAhead);
    setBusy(true);
    setError(null);
    const body = {
      title,
      titleId: titleId || null,
      startsAt,
      durationMinutes: duration,
      description: description.trim() ? description : event ? null : undefined,
    };
    const saved = await social<PlannedEvent>(
      event ? `events/${event.id}` : `communities/${communityId}/events`,
      {
        method: event ? "PATCH" : "POST",
        ...json(body),
      },
    );
    setBusy(false);
    if (!saved.ok || !saved.body)
      return setError(
        saved.status === 400 ? texts.timeAhead : saved.status === 429 ? texts.tooMany : texts.failed,
      );
    dialog.current?.close();
    if (event) router.refresh();
    else router.push(`/events/${saved.body.id}`);
  }

  const durationText = (minutes: number) =>
    minutes < 60 || minutes % 60
      ? fill(texts.durationMinutes, { n: minutes })
      : fill(texts.durationHours, { n: minutes / 60 });

  return (
    <>
      <button type="button" className={event ? "pill" : "primary small"} onClick={open}>
        {event ? texts.editEvent : texts.planEvent}
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
          <h3 id={heading}>{event ? texts.editEvent : texts.planEvent}</h3>
          <form className="form" onSubmit={submit}>
            <label className="stack">
              <span>{texts.eventTitle}</span>
              <input
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
                minLength={3}
                maxLength={80}
                required
              />
            </label>
            <div className="two">
              <label className="stack">
                <span>{texts.eventStart}</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(ev) => setStart(ev.target.value)}
                  required
                />
              </label>
              <label className="stack">
                <span>{texts.eventDuration}</span>
                <select value={duration} onChange={(ev) => setDuration(Number(ev.target.value))}>
                  {durations.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {durationText(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="stack">
              <span>{texts.eventGame}</span>
              <select value={titleId} onChange={(ev) => setTitleId(ev.target.value)}>
                <option value="">{texts.communityGameNone}</option>
                {games.map((g) => (
                  <option key={g.titleId} value={g.titleId}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack">
              <span>{texts.eventDescription}</span>
              <textarea
                rows={3}
                maxLength={1000}
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
              <button type="submit" className="primary small" disabled={busy || title.trim().length < 3}>
                {event ? texts.save : texts.plan}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}

/** Going, maybe or not; the host starts it (into a party or their share play); the host and the
 *  community's moderators change or cancel it; anyone else may report it. */
export function EventActions({
  texts,
  event,
  member,
  me,
  games,
}: {
  texts: UiStrings;
  event: PlannedEvent;
  member: boolean;
  me: string;
  games: GameOption[];
}) {
  const router = useRouter();
  const [mine, setMine] = useState(event.mine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = Date.parse(event.endsAt) <= Date.now();
  const host = event.host?.userId === me;
  const startable = host && !over && Date.parse(event.startsAt) - 30 * 60_000 <= Date.now();

  async function rsvp(next: "going" | "maybe" | null) {
    const before = mine;
    setMine(next);
    setError(null);
    const done = next
      ? await social(`events/${event.id}/rsvp`, { method: "PUT", ...json({ status: next }) })
      : await social(`events/${event.id}/rsvp`, { method: "DELETE" });
    if (!done.ok) {
      setMine(before);
      return setError(done.status === 429 ? texts.tooMany : texts.failed);
    }
    router.refresh();
  }

  async function start(kind: "party" | "share_play") {
    setBusy(true);
    setError(null);
    const done = await social<PlannedEvent & { code?: string }>(`events/${event.id}/start`, {
      method: "POST",
      ...json({ kind }),
    });
    setBusy(false);
    if (!done.ok || !done.body)
      return setError(
        kind === "share_play" && done.status === 409
          ? texts.shareFirst
          : done.body?.code === "not_party_leader"
            ? texts.notPartyLeader
            : texts.failed,
      );
    if (done.body.link) router.push(linkHref(done.body.link));
  }

  async function cancel() {
    if (!window.confirm(fill(texts.confirmCancelEvent, { title: event.title }))) return;
    setBusy(true);
    const done = await social(`events/${event.id}`, { method: "DELETE" });
    setBusy(false);
    if (!done.ok) return setError(texts.failed);
    router.push(`/communities/${event.communityId}`);
  }

  if (event.status === "cancelled") return <p className="notice error">{texts.eventCancelled}</p>;

  return (
    <>
      <div className="community-actions">
        {event.link && (
          <Link href={linkHref(event.link)} className="primary">
            {texts.joinEvent}
          </Link>
        )}
        {member && !over && (
          <fieldset className="rsvp">
            <legend className="visually-hidden">{texts.going}</legend>
            {(["going", "maybe"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={value}
                aria-pressed={mine === value}
                onClick={() => rsvp(mine === value ? null : value)}
              >
                {texts[value]}
              </button>
            ))}
            <button type="button" aria-pressed={mine === null} onClick={() => rsvp(null)}>
              {texts.notGoing}
            </button>
          </fieldset>
        )}
        {startable && (
          <>
            <button type="button" className="pill" disabled={busy} onClick={() => start("party")}>
              {texts.startInParty}
            </button>
            <button type="button" className="pill" disabled={busy} onClick={() => start("share_play")}>
              {texts.startInShare}
            </button>
          </>
        )}
        {event.canEdit && !over && (
          <>
            <EventComposer texts={texts} communityId={event.communityId} games={games} event={event} />
            <button type="button" className="pill danger" disabled={busy} onClick={cancel}>
              {texts.cancelEvent}
            </button>
          </>
        )}
      </div>
      {startable && <p className="hint tz-note">{texts.startHint}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!host && (
        <ProfileMenu
          person={{ userId: event.id, displayName: event.title }}
          texts={texts}
          kind="event"
          label={texts.reportEvent}
          title={texts.reportEvent}
          lead={texts.communityReportLead}
        />
      )}
    </>
  );
}

/** Who is going: their faces. */
export function Faces({ event }: { event: PlannedEvent }) {
  return (
    <div className="going-faces">
      {event.people.map((person) => (
        <Link key={person.userId} href={`/u/${person.handle}`} title={person.displayName}>
          <Avatar person={person} size={34} />
        </Link>
      ))}
    </div>
  );
}
