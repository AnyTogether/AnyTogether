import { FeedList } from "@/components/FeedList";
import { Landing } from "@/components/site/Landing";
import type { Board, FeedPage } from "@/lib/feed";
import { type Language, type Strings, language, strings, ui } from "@/lib/i18n";
import { siteStrings } from "@/lib/i18n-site";
import { fill } from "@/lib/people";
import { pageMetadata } from "@/lib/product-page";
import { apiJson, currentUser } from "@/lib/session";
import { loadReleases, loadStats, visitorPlatform } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const l = siteStrings(await language()).landing;
  return pageMetadata(l.title, l.description, "/");
}

/** Signed in: the friends' feed. Signed out: the AnyPS5 family and what it does. */
export default async function Home() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  return user ? <Feed texts={texts} /> : <Visitor language={texts.language} />;
}

async function Feed({ texts }: { texts: Strings }) {
  const [feed, friends, board] = await Promise.all([
    apiJson<FeedPage>("/me/feed"),
    apiJson<{ friends: unknown[] }>("/me/friends"),
    apiJson<Board>("/leaderboards/points?scope=friends&limit=3"),
  ]);
  const lonely = (friends.body?.friends.length ?? 0) === 0;
  const mine = board.body?.me;
  const number = new Intl.NumberFormat(texts.language);
  return (
    <section className="page home">
      <h2 className="in d1">{texts.home}</h2>
      <p className="lead in d2">{texts.homeLead}</p>
      <nav className="switch in d2" aria-label={texts.home}>
        <Link href="/" aria-current="page">
          {texts.home}
        </Link>
        <Link href="/captures">{texts.captures}</Link>
        <Link href="/leaderboards">{texts.leaderboards}</Link>
      </nav>
      {mine?.rank && board.body && board.body.total > 1 ? (
        <Link href="/leaderboards" className="card rank-strip in d3">
          <span className="sub">{texts.topFriends}</span>
          <span className="rank-strip-value">
            <b>{fill(texts.rankOf, { rank: mine.rank, total: board.body.total })}</b>
            <span className="meta">{fill(texts.pointsValue, { n: number.format(mine.value) })}</span>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="chev">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      ) : null}
      <article className="card feed-card in d3">
        <FeedList
          texts={ui(texts)}
          initial={feed.body ?? { items: [], next: null }}
          live
          now={Date.now()}
          empty={
            <div className="feed-empty">
              <p className="empty">{lonely ? texts.feedEmptyNoFriends : texts.feedEmpty}</p>
              {lonely && (
                <Link href="/friends" className="pill">
                  {texts.findFriends}
                </Link>
              )}
            </div>
          }
        />
      </article>
    </section>
  );
}

async function Visitor({ language }: { language: Language }) {
  const [platform, releases, stats] = await Promise.all([visitorPlatform(), loadReleases(), loadStats()]);
  return (
    <Landing
      s={siteStrings(language)}
      language={language}
      platform={platform}
      releases={releases}
      stats={stats}
    />
  );
}
