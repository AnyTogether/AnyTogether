import { MetList } from "@/components/MetList";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import type { MetPlayers } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Recently played with · AnyTogether" };

/** People the reader was in a party, share play, game or post with, the last 30 days. */
export default async function Players() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/players");
  const met = await apiJson<MetPlayers>("/me/players-met");
  const initial = met.body ?? { remember: true, days: 30, players: [] };
  return (
    <section className="page">
      <nav className="crumbs in d1">
        <Link href="/friends">{texts.friends}</Link>
      </nav>
      <h2 className="in d1">{texts.playersMet}</h2>
      <p className="lead in d2">{texts.playersMetLead}</p>
      <article className="card in d3">
        <h3 className="sub">
          {fill(texts.daysLabel, { n: initial.days })} <span className="n">{initial.players.length}</span>
        </h3>
        <MetList texts={ui(texts)} initial={initial} now={Date.now()} />
      </article>
    </section>
  );
}
