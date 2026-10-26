import { AdminBoard } from "@/components/AdminBoard";
import { BackupNotice, type BackupReport } from "@/components/BackupNotice";
import {
  type AdminAppealPage,
  type AdminBanRow,
  type AdminReport,
  type AdminTab,
  type AdminThemePage,
  type AuditEntry,
  adminTabs,
} from "@/lib/admin";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.admin, { robots: { index: false } });

/** The moderators' page. Only an admin sees it; everyone else gets "not found". The API checks the
 *  role again on every call it makes, so the page itself grants nothing. */
export default async function Admin({
  searchParams,
}: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const [texts, user, query] = await Promise.all([strings(), currentUser(), searchParams]);
  if (!user) redirect("/login?next=/admin");
  if (user.account.role !== "admin") notFound();
  const tab: AdminTab = adminTabs.includes(query.tab as AdminTab) ? (query.tab as AdminTab) : "reports";
  const [reports, appeals, themes, bans, audit, backups] = await Promise.all([
    apiJson<{ reports: AdminReport[]; more: boolean; open: number }>("/admin/reports"),
    // Always: the tab shows how many appeals wait.
    apiJson<AdminAppealPage>("/admin/appeals"),
    // Always: the tab shows how many themes wait for review.
    apiJson<AdminThemePage>("/admin/themes"),
    tab === "bans" ? apiJson<{ bans: AdminBanRow[]; more: boolean }>("/admin/bans") : null,
    tab === "audit" ? apiJson<{ entries: AuditEntry[]; more: boolean }>("/admin/audit") : null,
    apiJson<BackupReport>("/admin/backups"),
  ]);
  // Not an admin after all (revoked a moment ago): nothing to show.
  if (reports.status === 403) notFound();
  return (
    <section className="page admin-page">
      <h2 className="in d1">{texts.admin}</h2>
      <p className="lead in d2">{texts.adminLead}</p>
      <BackupNotice report={backups.body} texts={texts} />
      <AdminBoard
        texts={ui(texts)}
        tab={tab}
        me={user.profile.handle}
        initialReports={reports.body ?? { reports: [], more: false, open: 0 }}
        initialBans={bans?.body ?? null}
        initialAudit={audit?.body ?? null}
        initialThemes={themes.body}
        initialAppeals={appeals.body}
        initialQuery={tab === "people" ? (query.q ?? "") : ""}
        now={Date.now()}
      />
    </section>
  );
}
