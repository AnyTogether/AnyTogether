import { Avatar } from "@/components/Avatar";
import { LevelBadge } from "@/components/LevelBadge";
import { localName, rarityPercent, trophyText } from "@/lib/games";
import { strings } from "@/lib/i18n";
import type { Profile } from "@/lib/people";
import { fill } from "@/lib/people";
import type { Compare, CompareGame, CompareSide } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const clean = (handle: string) => decodeURIComponent(handle).replace(/^@/, "").toLowerCase();
const cupPath = "M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `@${clean((await params).handle)} · Compare · AnyTogether` };
}

/** You and someone else, game by game: the games either of you has trophies in, or one game's
 *  trophies side by side with when each of you earned them. */
export default async function CompareTrophies({ params, searchParams }: Props) {
  const handle = clean((await params).handle);
  const query = await searchParams;
  const game = typeof query.game === "string" && /^[A-Z]{4}[0-9]{5}$/.test(query.game) ? query.game : null;
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/u/${handle}/compare`)}`);
  if (!/^[a-z0-9_.]{1,40}$/.test(handle)) notFound();
  const profile = await apiJson<Profile>(`/users/${handle}`);
  if (!profile.body) notFound();
  const them = profile.body;
  if (them.friendship === "me") redirect(`/u/${them.handle}`);
  const base = `/users/${encodeURIComponent(handle)}/trophies/compare`;
  const { language } = texts;
  const name = { name: them.displayName };

  if (!game) {
    const list = await apiJson<{ games: CompareGame[] }>(base);
    return (
      <section className="page">
        <nav className="crumbs in d1">
          <Link href={`/u/${them.handle}`}>@{them.handle}</Link>
        </nav>
        <h2 className="in d1">{fill(texts.compareTitle, name)}</h2>
        <p className="lead in d2">{texts.compareLead}</p>
        <article className="card in d3">
          <h3 className="sub">
            {texts.compareTrophies} {list.body && <span className="n">{list.body.games.length}</span>}
          </h3>
          {list.status === 403 ? (
            <p className="empty">{fill(texts.comparePrivate, name)}</p>
          ) : !list.body?.games.length ? (
            <p className="empty">{texts.compareNoGames}</p>
          ) : (
            <ul className="compare-games">
              {list.body.games.map((item) => (
                <li key={item.titleId}>
                  <Link href={`/u/${them.handle}/compare?game=${item.titleId}`} className="compare-game">
                    <span
                      className="game-art"
                      style={item.iconUrl ? { backgroundImage: `url("${item.iconUrl}")` } : undefined}
                      aria-hidden="true"
                    />
                    <span className="lines">
                      <span className="name">{localName(item.names, language) || item.titleId}</span>
                      <span className="duel">
                        <Side side={item.mine} label={texts.you} texts={texts} />
                        <Side side={item.theirs} label={them.displayName} texts={texts} theirs />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    );
  }

  const result = await apiJson<Compare>(`${base}?titleId=${game}`);
  if (result.status === 404) notFound();
  const view = result.body;
  const day = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(language, {
          day: "numeric",
          month: "short",
          ...(new Date(iso).getFullYear() === new Date().getFullYear() ? {} : { year: "2-digit" }),
        })
      : null;
  return (
    <section className="page">
      <nav className="crumbs in d1">
        <Link href={`/u/${them.handle}/compare`}>{texts.compareAll}</Link>
      </nav>
      {!view ? (
        <article className="card in d2">
          <p className="empty">{fill(texts.comparePrivate, name)}</p>
        </article>
      ) : (
        <>
          <h2 className="in d1">{localName(view.game?.names ?? {}, language) || view.titleId}</h2>
          <p className="lead in d2">{texts.compareGameLead}</p>
          <article className="card in d2">
            <div className="versus">
              <div className="side">
                <Avatar person={view.me} size={52} />
                <span className="name">
                  {texts.you} <LevelBadge level={view.me.level} texts={texts} />
                </span>
                <span className="score">
                  {view.totals.mine}
                  <span className="meta">/{view.totals.total}</span>
                </span>
              </div>
              <span className="vs">VS</span>
              <div className="side">
                <Avatar person={view.them} size={52} />
                <span className="name">
                  {view.them.displayName} <LevelBadge level={view.them.level} texts={texts} />
                </span>
                <span className="score">
                  {view.totals.theirs}
                  <span className="meta">/{view.totals.total}</span>
                </span>
              </div>
            </div>
            <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>
              {fill(texts.compareBoth, { n: view.totals.both })}
            </p>
          </article>
          <article className="card in d3">
            <div className="compare-cols" aria-hidden="true">
              <span />
              <span />
              <span>{texts.you}</span>
              <span>{view.them.displayName.split(" ")[0]}</span>
            </div>
            <ul className="compare-trophies">
              {view.trophies.map((trophy) => {
                const text = trophyText(trophy.texts, language);
                return (
                  <li key={trophy.id} className="compare-trophy">
                    <span
                      className={`cup ${trophy.grade}`}
                      title={texts[`grade_${trophy.grade}`]}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={cupPath} />
                      </svg>
                    </span>
                    <span className="lines">
                      <span className="name">{text?.name ?? texts.hiddenTrophy}</span>
                      <span className="meta">
                        {texts[`grade_${trophy.grade}`]}
                        {trophy.rarity !== null &&
                          ` · ${fill(texts.ofPlayers, { p: rarityPercent(trophy.rarity, language) })}`}
                      </span>
                    </span>
                    <span className={`when${trophy.mine ? " got" : ""}`}>
                      {day(trophy.mine) ?? texts.compareNotYet}
                    </span>
                    <span className={`when theirs${trophy.theirs ? " got" : ""}`}>
                      {day(trophy.theirs) ?? texts.compareNotYet}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>
        </>
      )}
    </section>
  );
}

function Side({
  side,
  label,
  texts,
  theirs = false,
}: {
  side: CompareSide | null;
  label: string;
  texts: { compareNotPlayed: string };
  theirs?: boolean;
}) {
  return (
    <span className={theirs ? "theirs" : "mine"}>
      <span className="meta">
        {label} · {side ? `${side.earned}/${side.total ?? "?"}` : texts.compareNotPlayed}
      </span>
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${side?.progress ?? 0}%` }} />
      </span>
    </span>
  );
}
