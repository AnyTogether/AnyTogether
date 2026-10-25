import { RefreshOn } from "@/components/Discover";
import { EventDays } from "@/components/Events";
import { strings, ui } from "@/lib/i18n";
import type { PlannedEvent } from "@/lib/psn";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Events · AnyTogether" };

/** What is coming up in the reader's communities and what they said they would go to, by day in
 *  their own time zone. */
export default async function Events() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/events");
  const events = await apiJson<{ events: PlannedEvent[] }>("/me/events");
  return (
    <section className="page">
      <RefreshOn
        topics={[]}
        events={["community.updated", "community.left", "event.updated", "event.cancelled", "event.started"]}
      />
      <nav className="crumbs in d1">
        <Link href="/communities">{texts.communities}</Link>
      </nav>
      <h2 className="in d1">{texts.events}</h2>
      <p className="lead in d2">{texts.eventsLead}</p>
      <article className="card in d3">
        <EventDays texts={ui(texts)} events={events.body?.events ?? []} empty={texts.noEvents} />
      </article>
    </section>
  );
}
