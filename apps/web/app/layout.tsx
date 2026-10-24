import { Avatar } from "@/components/Avatar";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Mark } from "@/components/Mark";
import { strings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { currentUser, incomingRequests } from "@/lib/session";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--font-display",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "AnyTogether",
  description: "Profiles, trophies, parties, voice chat and downloads for AnyPS5.",
};

export const viewport: Viewport = { themeColor: "#07080c" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [texts, user, waiting] = await Promise.all([strings(), currentUser(), incomingRequests()]);
  return (
    <html lang={texts.language} className={`${display.variable} ${mono.variable}`}>
      <body>
        <div className="glow" />
        <div className="grid" />
        <main>
          <header className="in">
            <Link href="/" className="brand">
              <Mark />
              AnyTogether
            </Link>
            <div className="side">
              {user ? (
                <nav className="side signed">
                  <Link
                    href="/friends"
                    className="pill nav"
                    aria-label={
                      waiting > 0
                        ? `${texts.friends}, ${fill(texts.requestsWaiting, { n: waiting })}`
                        : texts.friends
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="9" cy="8" r="3.2" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M3 20c.8-3.4 3.2-5.5 6-5.5s5.2 2.1 6 5.5M15 15c2.6-.4 5 1.3 6 4.5" />
                    </svg>
                    <span className="wide">{texts.friends}</span>
                    {waiting > 0 && <b className="badge">{waiting > 99 ? "99+" : waiting}</b>}
                  </Link>
                  <Link
                    href={`/u/${user.profile.handle}`}
                    className="tag nav me"
                    aria-label={texts.myProfile}
                  >
                    <Avatar person={{ ...user.profile, avatar: user.profile.avatar ?? null }} size={20} />
                    <span className="wide">@{user.profile.handle}</span>
                  </Link>
                  <form action="/auth/logout" method="post">
                    <button type="submit" className="pill nav" aria-label={texts.signOut}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="narrow-only">
                        <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
                      </svg>
                      <span className="wide">{texts.signOut}</span>
                    </button>
                  </form>
                </nav>
              ) : (
                <>
                  <span className="tag status">
                    <i className="dot" />
                    {texts.inDevelopment}
                  </span>
                  <Link href="/login" className="pill">
                    {texts.signIn}
                  </Link>
                </>
              )}
            </div>
          </header>
          {children}
          <footer className="in d4">
            <span>&copy; 2026 AnyTogether</span>
            <div className="foot-end">
              <span>
                {texts.madeBy.split("{link}")[0]}
                <a href="https://kodla.agency">kodla.agency</a>
                {texts.madeBy.split("{link}")[1]}
              </span>
              <LanguageSwitch current={texts.language} label={texts.languageLabel} />
            </div>
          </footer>
        </main>
      </body>
    </html>
  );
}
