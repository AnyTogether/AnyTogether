import { AdminBoard } from "@/components/AdminBoard";
import { type AdminBanRow, type AdminReport, type AdminTab, type AuditEntry, adminTabs } from "@/lib/admin";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Admin · AnyTogether", robots: { index: false } };

/** The moderators' page. Only an admin sees it; everyone else gets "not found". The API checks the
 *  role again on every call it makes, so the page itself grants nothing. */
export default async function Admin({
  searchParams,
}: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const [texts, user, query] = await Promise.all([strings(), currentUser(), searchParams]);
  if (!user) redirect("/login?next=/admin");
  if (user.account.role !== "admin") notFound();
  const tab: AdminTab = adminTabs.includes(query.tab as AdminTab) ? (query.tab as AdminTab) : "reports";
  const [reports, bans, audit] = await Promise.all([
    apiJson<{ reports: AdminReport[]; more: boolean; open: number }>("/admin/reports"),
    tab === "bans" ? apiJson<{ bans: AdminBanRow[]; more: boolean }>("/admin/bans") : null,
    tab === "audit" ? apiJson<{ entries: AuditEntry[]; more: boolean }>("/admin/audit") : null,
  ]);
  // Not an admin after all (revoked a moment ago): nothing to show.
  if (reports.status === 403) notFound();
  return (
    <section className="page admin-page">
      <h2 className="in d1">{texts.admin}</h2>
      <p className="lead in d2">{texts.adminLead}</p>
      <AdminBoard
        texts={ui(texts)}
        tab={tab}
        me={user.profile.handle}
        initialReports={reports.body ?? { reports: [], more: false, open: 0 }}
        initialBans={bans?.body ?? null}
        initialAudit={audit?.body ?? null}
        initialQuery={tab === "people" ? (query.q ?? "") : ""}
        now={Date.now()}
      />
    </section>
  );
}
