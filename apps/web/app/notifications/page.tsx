import { NotificationList } from "@/components/NotificationList";
import { strings, ui } from "@/lib/i18n";
import type { NoticePage } from "@/lib/notify";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Notifications · AnyTogether" };

/** Everything the bell counts: requests, invites, missed calls, messages while away, warnings. */
export default async function Notifications() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/notifications");
  const page = await apiJson<NoticePage>("/me/notifications");
  return (
    <section className="page notifications-page">
      <h2 className="in d1">{texts.notifications}</h2>
      <p className="lead in d2">{texts.notificationsLead}</p>
      <article className="card in d3">
        <NotificationList
          texts={ui(texts)}
          initial={page.body ?? { notifications: [], unread: 0, more: false }}
          now={Date.now()}
        />
      </article>
    </section>
  );
}
