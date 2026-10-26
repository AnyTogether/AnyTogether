import { RefreshOn } from "@/components/Discover";
import { FindTabs, PartyRow, ShareRow } from "@/components/DiscoverCards";
import type { PublicParty, PublicShare } from "@/lib/discover";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.tabLive);

/** Share plays under Live now, and the parties and share plays their hosts listed in public. */
export default async function FindLive() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/find/live");
  const [parties, shares] = await Promise.all([
    apiJson<{ parties: PublicParty[] }>("/parties/public"),
    apiJson<{ sharePlays: PublicShare[] }>("/share-plays/public"),
  ]);
  const t = ui(texts);
  const all = shares.body?.sharePlays ?? [];
  const live = all.filter((s) => s.live);
  const listed = all.filter((s) => !s.live);
  const partyList = parties.body?.parties ?? [];

  return (
    <section className="page find">
      <RefreshOn
        topics={["discover"]}
        events={["discover.changed", "party.request_answered", "share_play.request_answered"]}
      />
      <div className="find-head in d1">
        <h2>{texts.findPlayers}</h2>
      </div>
      <p className="lead in d2">{texts.findLead}</p>
      <FindTabs current="live" texts={texts} />

      <div className="in d3 find-stack">
        <article className="card live-card">
          <h3 className="sub">
            <span className="live-dot" aria-hidden="true" />
            {texts.liveNow} <span className="n">{live.length}</span>
          </h3>
          <p className="hint section-lead">{texts.liveLead}</p>
          {live.length === 0 ? (
            <p className="hint empty">{texts.noLive}</p>
          ) : (
            <ul className="people">
              {live.map((share) => (
                <ShareRow key={share.id} share={share} texts={texts} ui={t} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <h3 className="sub">
            {texts.publicParties} <span className="n">{partyList.length}</span>
          </h3>
          {partyList.length === 0 ? (
            <p className="hint empty">{texts.noPublicParties}</p>
          ) : (
            <ul className="people">
              {partyList.map((party) => (
                <PartyRow key={party.id} party={party} texts={texts} ui={t} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <h3 className="sub">
            {texts.publicShares} <span className="n">{listed.length}</span>
          </h3>
          {listed.length === 0 ? (
            <p className="hint empty">{texts.noPublicShares}</p>
          ) : (
            <ul className="people">
              {listed.map((share) => (
                <ShareRow key={share.id} share={share} texts={texts} ui={t} />
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
