import { ThemeTile } from "@/components/ThemeTile";
import { strings } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import type { ThemeDetail } from "@/lib/themes";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My themes · AnyTogether" };

/** The themes you shared, in every state: published, in review or hidden. */
export default async function MyThemes() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/themes/mine");
  const mine = (await apiJson<{ themes: ThemeDetail[] }>("/me/themes")).body?.themes ?? [];
  return (
    <section className="page hub-page">
      <nav className="crumbs in d1">
        <Link href="/themes">{texts.themes}</Link>
      </nav>
      <div className="hub-head">
        <h2 className="in d1">{texts.myThemes}</h2>
        <div className="hub-actions in d2">
          <Link href="/themes/new" className="pill accent">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {texts.shareTheme}
          </Link>
        </div>
      </div>
      {mine.length === 0 ? (
        <article className="card in d3">
          <p className="empty">{texts.noMyThemes}</p>
        </article>
      ) : (
        <ul className="theme-grid in d3">
          {mine.map((theme) => (
            <ThemeTile key={theme.id} theme={theme} texts={texts} status={theme.status} />
          ))}
        </ul>
      )}
    </section>
  );
}
