import { RefreshOn } from "@/components/Discover";
import { EventActions, EventWhen, Faces } from "@/components/Events";
import type { LibraryGame } from "@/lib/games";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type Community, type PlannedEvent, communityIconOf, gameOptions } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const event = uuid.test(id) ? (await apiJson<PlannedEvent>(`/events/${id}`)).body : null;
  return { title: `${event?.title ?? "Event"} · AnyTogether` };
}

/** One event: when (in the reader's time zone), who hosts it, who is going, and going or not. */
export default async function EventPage({ params }: Params) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=/events/${id}`);
  const found = await apiJson<PlannedEvent>(`/events/${id}`);
  const event = found.body;
  if (!event) notFound();
  const [community, library] = await Promise.all([
    apiJson<Community>(`/communities/${event.communityId}`),
    apiJson<{ games: LibraryGame[] }>(`/users/${encodeURIComponent(user.profile.handle)}/library`),
  ]);
  const { language } = texts;
  const t = ui(texts);
  const games = gameOptions(library.body?.games ?? [], language);
  if (event.titleId && !games.some((g) => g.titleId === event.titleId))
    games.unshift({
      titleId: event.titleId,
      name: localName(event.game?.names ?? {}, language) || event.titleId,
    });
  const gameName = event.game ? localName(event.game.names, language) || event.titleId : null;

  return (
    <section className="page">
      <RefreshOn
        topics={[]}
        events={["community.updated", "community.left", "event.updated", "event.cancelled", "event.started"]}
      />
      <nav className="crumbs in d1">
        <Link href="/events">{texts.events}</Link>
      </nav>
      <article className="card raise in d1">
        <Link href={`/communities/${event.communityId}`} className="community-row" style={{ paddingTop: 0 }}>
          <img className="community-icon" src={communityIconOf(event)} alt="" />
          <span className="lines">
            <span className="name">{event.community.name}</span>
            {gameName && <span className="meta">{gameName}</span>}
          </span>
          {event.status === "cancelled" && <span className="chip cancelled">{texts.eventCancelled}</span>}
          {event.link && <span className="chip live">{texts.eventLive}</span>}
        </Link>
        <div className="event-hero">
          <h2>{event.title}</h2>
          <EventWhen event={event} texts={t} />
          {event.host && (
            <p className="hint" style={{ marginTop: 8 }}>
              {fill(texts.eventHostedBy, { name: event.host.displayName })}
            </p>
          )}
        </div>
        {event.description && <p className="community-desc">{event.description}</p>}
        <EventActions
          texts={t}
          event={event}
          member={!!community.body?.role}
          me={user.account.id}
          games={games}
        />
      </article>

      <article className="card in d2">
        <h3 className="sub">
          {fill(texts.goingN, { n: event.going })}
          {event.maybe > 0 && <span className="n">· {fill(texts.maybeN, { n: event.maybe })}</span>}
        </h3>
        {event.people.length > 0 ? <Faces event={event} /> : <p className="empty">{texts.nobodyGoing}</p>}
      </article>
    </section>
  );
}
