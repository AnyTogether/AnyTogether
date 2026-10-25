import { Avatar } from "@/components/Avatar";
import { JoinAsk } from "@/components/JoinAsk";
import { localName } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { currentUser, publicJson } from "@/lib/session";
import { type JoinCodeView, formatJoinCode, isJoinCode, normalizeJoinCode } from "@/lib/social";
import type { Metadata } from "next";
import Link from "next/link";

type Params = { params: Promise<{ code: string }> };

async function load(raw: string) {
  const code = normalizeJoinCode(decodeURIComponent(raw));
  if (!isJoinCode(code)) return { code, view: null };
  const { body } = await publicJson<JoinCodeView>(`/join/${code}`);
  return { code, view: body };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [texts, { view }] = await Promise.all([strings(), load((await params).code)]);
  const name = view?.host?.displayName ?? "AnyTogether";
  const title = view
    ? fill(view.kind === "party" ? texts.joinPartyTitle : texts.joinShareTitle, { name })
    : texts.joinGoneTitle;
  return { title: `${title} · AnyTogether`, robots: { index: false, follow: false } };
}

/** What a join code opens (a link from Discord or a friend of a friend), and asking to join. It
 *  never joins by itself: the leader or host says yes, then the invite waits on the party or
 *  share play page with Join and Decline. */
export default async function JoinPage({ params }: Params) {
  const [texts, user, { code, view }] = await Promise.all([
    strings(),
    currentUser(),
    load((await params).code),
  ]);
  if (!view)
    return (
      <section className="narrow join-page">
        <h2 className="in d1">{texts.joinGoneTitle}</h2>
        <p className="lead in d2">{texts.joinGone}</p>
        <div className="in d3 join-acts">
          <Link className="pill" href="/party">
            {texts.party}
          </Link>
        </div>
      </section>
    );

  const name = view.host?.displayName ?? "?";
  const game = view.game
    ? view.game.title || localName(view.game.names, texts.language) || view.game.titleId
    : null;
  const target = view.kind === "party" ? "/party" : `/watch/${view.id}`;
  const goLabel = view.kind === "party" ? texts.joinOpenParty : texts.joinOpenWatch;
  return (
    <section className="narrow join-page">
      <h2 className="in d1">
        {fill(view.kind === "party" ? texts.joinPartyTitle : texts.joinShareTitle, { name })}
      </h2>
      <p className="lead in d2">{fill(texts.joinHow, { name })}</p>
      <div className="card join-card in d3">
        {view.host && (
          <div className="join-host">
            <Avatar person={view.host} size={52} />
            <span className="lines">
              <span className="name">{view.host.displayName}</span>
              <span className="meta">@{view.host.handle}</span>
            </span>
          </div>
        )}
        {game && (
          <div className="join-game">
            {view.game?.iconUrl && <img src={view.game.iconUrl} alt="" />}
            <span>{game}</span>
          </div>
        )}
        <span className="meta">
          {fill(texts.joinPeople, { n: view.size, max: view.max })} ·{" "}
          <span className="join-code-tag">{formatJoinCode(view.code)}</span>
        </span>
        <div className="join-acts">
          {!user ? (
            <Link className="primary" href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}>
              {texts.joinSignIn}
            </Link>
          ) : view.state === "member" ? (
            <>
              <span>{texts.joinIn}</span>
              <Link className="pill" href={target}>
                {goLabel}
              </Link>
            </>
          ) : view.state === "invited" ? (
            <>
              <span>{fill(texts.joinInvited, { name })}</span>
              <Link className="primary" href={target}>
                {goLabel}
              </Link>
            </>
          ) : (
            <JoinAsk texts={ui(texts)} code={view.code} host={name} asked={view.state === "requested"} />
          )}
        </div>
      </div>
    </section>
  );
}
