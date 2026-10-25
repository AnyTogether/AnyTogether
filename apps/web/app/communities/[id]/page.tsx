import { Avatar } from "@/components/Avatar";
import { CommunityActions, MemberList } from "@/components/Communities";
import { RefreshOn } from "@/components/Discover";
import { EventComposer, EventDays } from "@/components/Events";
import type { LibraryGame } from "@/lib/games";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import {
  type Community,
  type CommunityMember,
  type PlannedEvent,
  gameOptions,
  iconSrc,
  localArt,
} from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const community = uuid.test(id) ? (await apiJson<Community>(`/communities/${id}`)).body : null;
  return { title: `${community?.name ?? "Community"} · AnyTogether` };
}

/** One community: who started it, what it is about, joining, its chat, events and members. */
export default async function CommunityPage({ params }: Params) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=/communities/${id}`);
  const [found, events, members, library] = await Promise.all([
    apiJson<Community>(`/communities/${id}`),
    apiJson<{ events: PlannedEvent[] }>(`/communities/${id}/events`),
    apiJson<{ members: CommunityMember[] }>(`/communities/${id}/members`),
    apiJson<{ games: LibraryGame[] }>(`/users/${encodeURIComponent(user.profile.handle)}/library`),
  ]);
  const community = found.body;
  if (!community) notFound();
  const { language } = texts;
  const t = ui(texts);
  const games = gameOptions(library.body?.games ?? [], language);
  if (community.titleId && !games.some((g) => g.titleId === community.titleId))
    games.unshift({
      titleId: community.titleId,
      name: localName(community.game?.names ?? {}, language) || community.titleId,
    });
  const gameName = community.game ? localName(community.game.names, language) || community.titleId : null;

  return (
    <section className="page">
      <RefreshOn
        topics={[]}
        events={["community.updated", "community.left", "event.updated", "event.cancelled", "event.started"]}
      />
      <nav className="crumbs in d1">
        <Link href="/communities">{texts.communities}</Link>
      </nav>
      <article className="card raise in d1">
        <div className="community-head">
          <img
            className="community-icon big"
            src={localArt(community.iconUrl) ?? iconSrc(community.icon)}
            alt=""
          />
          <div className="lines">
            <h2>{community.name}</h2>
            <div className="meta">
              {gameName && community.titleId && (
                <Link href={`/games/${community.titleId}`} className="chip">
                  {gameName}
                </Link>
              )}
              <span className="chip">{texts[`visibilityShort_${community.visibility}`]}</span>
              <span>{fill(texts.membersOf, { n: community.members, max: community.maxMembers })}</span>
            </div>
          </div>
        </div>
        {community.description && <p className="community-desc">{community.description}</p>}
        {community.owner && (
          <p className="hint" style={{ marginTop: 12 }}>
            {fill(texts.ownerLabel, { name: community.owner.displayName })}
          </p>
        )}
        <CommunityActions texts={t} community={community} games={games} />
      </article>

      <article className="card in d2">
        <div className="card-head">
          <h3 className="sub">
            {texts.events} <span className="n">{events.body?.events.length ?? 0}</span>
          </h3>
          {community.role && (
            <EventComposer
              texts={t}
              communityId={community.id}
              games={games}
              defaultGame={community.titleId}
            />
          )}
        </div>
        <EventDays
          texts={t}
          events={events.body?.events ?? []}
          showCommunity={false}
          empty={texts.noCommunityEvents}
        />
      </article>

      <article className="card in d3">
        <h3 className="sub">
          {texts.communityMembers} <span className="n">{community.members}</span>
        </h3>
        {members.body ? (
          <MemberList texts={t} community={community} initial={members.body.members} me={user.account.id} />
        ) : (
          <>
            <p className="empty">{texts.inviteOnlyLock}</p>
            <div className="going-faces">
              {[community.owner, ...community.moderators].flatMap((person) =>
                person ? [<Avatar key={person.userId} person={person} size={34} />] : [],
              )}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
