import { ThemeShare } from "@/components/ThemeShare";
import { strings, ui } from "@/lib/i18n";
import { currentUser } from "@/lib/session";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.shareTheme);

/** Sharing a theme exported from the launcher's Theme Studio. */
export default async function NewTheme() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/themes/new");
  return (
    <section className="page narrowish share">
      <nav className="crumbs in d1">
        <Link href="/themes">{texts.themes}</Link>
      </nav>
      <h2 className="in d1">{texts.shareThemeTitle}</h2>
      <p className="lead in d2">{texts.shareLead}</p>
      <article className="card in d3">
        <ThemeShare texts={ui(texts)} />
      </article>
    </section>
  );
}
