import { CaptureFeed } from "@/components/Captures";
import { composerSetup } from "@/lib/captures-server";
import { strings, ui } from "@/lib/i18n";
import type { PostPage } from "@/lib/posts";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const texts = await strings();
  return { title: `${texts.captures} · AnyTogether`, description: texts.capturesLead };
}

/** Captures: friends' screenshots and clips, one's own, and public ones of people one played with;
 *  liked and commented on here, shared from the composer at the top. */
export default async function Captures() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/captures");
  const [feed, setup] = await Promise.all([apiJson<PostPage>("/me/captures"), composerSetup(texts.language)]);
  return (
    <section className="page home captures">
      <h2 className="in d1">{texts.captures}</h2>
      <p className="lead in d2">{texts.capturesLead}</p>
      <nav className="switch in d2" aria-label={texts.home}>
        <Link href="/">{texts.home}</Link>
        <Link href="/captures" aria-current="page">
          {texts.captures}
        </Link>
        <Link href="/leaderboards">{texts.leaderboards}</Link>
      </nav>
      <div className="in d3">
        <CaptureFeed
          texts={ui(texts)}
          initial={feed.body ?? { items: [], next: null }}
          source={{ kind: "captures" }}
          now={Date.now()}
          composer={setup}
          empty={
            <div className="card feed-empty cap-empty">
              <p className="empty">{texts.capEmpty}</p>
              <Link href="/friends" className="pill">
                {texts.findFriends}
              </Link>
            </div>
          }
        />
      </div>
    </section>
  );
}
