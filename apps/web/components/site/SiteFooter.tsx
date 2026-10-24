import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Mark } from "@/components/Mark";
import type { SiteStrings } from "@/lib/i18n-site";
import Link from "next/link";

const gh = (repo: string) => `https://github.com/utkuhalis/${repo}`;

/** The footer of every page: the products, the community's repositories, the account, and the
 *  language. */
export function SiteFooter({
  s,
  signedIn,
  language,
  languageLabel,
  madeBy,
}: {
  s: SiteStrings;
  signedIn: boolean;
  language: "en" | "tr";
  languageLabel: string;
  madeBy: string;
}) {
  const [before, after] = madeBy.split("{link}");
  return (
    <footer className="site-foot">
      <div className="foot-brand">
        <Link href="/" className="brand" aria-label="AnyTogether">
          <Mark size={24} />
          <span className="wordmark">AnyTogether</span>
        </Link>
        <p>{s.footer.tagline}</p>
      </div>
      <nav className="foot-cols" aria-label={s.nav.label}>
        <div>
          <h2>{s.footer.product}</h2>
          <ul>
            <li>
              <Link href="/mac">{s.nav.mac}</Link>
            </li>
            <li>
              <Link href="/pc">{s.nav.pc}</Link>
            </li>
            <li>
              <Link href="/phone">{s.nav.phone}</Link>
            </li>
            <li>
              <Link href="/together">{s.nav.together}</Link>
            </li>
            <li>
              <Link href="/download">{s.footer.download}</Link>
            </li>
            <li>
              <Link href="/themes">{s.footer.themes}</Link>
            </li>
            <li>
              <Link href="/compatibility">{s.footer.compatibility}</Link>
            </li>
            <li>
              <Link href="/find">{s.footer.findPlayers}</Link>
            </li>
          </ul>
        </div>
        <div>
          <h2>{s.footer.community}</h2>
          <ul>
            <li>
              <a href={gh("AnyTogether")}>GitHub · AnyTogether</a>
            </li>
            <li>
              <a href={gh("AnyPS5-ARM")}>GitHub · AnyPS5-ARM</a>
            </li>
            <li>
              <a href={gh("AnyPS5-Desktop")}>GitHub · AnyPS5-Desktop</a>
            </li>
            <li>
              <a href={`${gh("AnyTogether")}/blob/main/docs/self-hosting.md`}>{s.footer.selfHosting}</a>
            </li>
          </ul>
        </div>
        <div>
          <h2>{s.footer.account}</h2>
          <ul>
            {signedIn ? (
              <>
                <li>
                  <Link href="/settings">{s.footer.settings}</Link>
                </li>
                <li>
                  <Link href="/leaderboards">{s.footer.leaderboards}</Link>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link href="/login">{s.footer.signIn}</Link>
                </li>
                <li>
                  <Link href="/login">{s.footer.createAccount}</Link>
                </li>
              </>
            )}
          </ul>
        </div>
      </nav>
      <div className="foot-base">
        <span>
          &copy; 2026 AnyTogether · {before}
          <a href="https://kodla.agency">kodla.agency</a>
          {after}
        </span>
        <LanguageSwitch current={language} label={languageLabel} />
      </div>
      <p className="foot-legal">{s.footer.rules}</p>
    </footer>
  );
}
