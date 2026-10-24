import { Avatar } from "@/components/Avatar";
import { CallProvider } from "@/components/Calls";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { LiveProvider } from "@/components/Live";
import { Mark } from "@/components/Mark";
import { NotificationBell } from "@/components/NotificationBell";
import { ShareInvites } from "@/components/ShareInvites";
import { UnreadBadge } from "@/components/UnreadBadge";
import { strings } from "@/lib/i18n";
import { shareInviteStrings } from "@/lib/i18n-share";
import { callStrings } from "@/lib/i18n-social";
import { fill } from "@/lib/people";
import { apiJson, currentUser, incomingRequests } from "@/lib/session";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import "./social.css";
import "./feed.css";
import "./share.css";
import "./notify.css";
import "./hub.css";
import "./discover.css";

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
  const [texts, user, waiting, unread, notices] = await Promise.all([
    strings(),
    currentUser(),
    incomingRequests(),
    apiJson<{ messages: number }>("/me/conversations/unread"),
    apiJson<{ unread: number }>("/me/notifications/unread"),
  ]);
  const page = (
    <main>
      <header className="in">
        <Link href="/" className="brand" aria-label="AnyTogether">
          <Mark />
          <span className="wordmark">AnyTogether</span>
        </Link>
        <div className="side">
          {user ? (
            <nav className="side signed">
              <Link href="/leaderboards" className="pill nav roomy" aria-label={texts.leaderboards}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
                  <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
                </svg>
                <span className="wide">{texts.leaderboards}</span>
              </Link>
              <Link href="/find" className="pill nav" aria-label={texts.findPlayers}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20.5 20.5l-4.6-4.6" />
                  <circle cx="11" cy="9.4" r="2.2" />
                  <path d="M7.4 14.6c.8-1.5 2.1-2.3 3.6-2.3s2.8.8 3.6 2.3" />
                </svg>
                <span className="wide">{texts.findPlayers}</span>
              </Link>
              <Link href="/messages" className="pill nav" aria-label={texts.messages}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z" />
                </svg>
                <span className="wide">{texts.messages}</span>
                <UnreadBadge initial={unread.body?.messages ?? 0} label={texts.unreadLabel} />
              </Link>
              <Link href="/party" className="pill nav" aria-label={texts.party}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                  <rect x="3" y="13.5" width="4.5" height="6.5" rx="1.6" />
                  <rect x="16.5" y="13.5" width="4.5" height="6.5" rx="1.6" />
                </svg>
                <span className="wide">{texts.party}</span>
              </Link>
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
              <NotificationBell
                initial={notices.body?.unread ?? 0}
                label={texts.notifications}
                unreadLabel={texts.unreadNotifications}
              />
              <Link href={`/u/${user.profile.handle}`} className="tag nav me" aria-label={texts.myProfile}>
                <Avatar person={{ ...user.profile, avatar: user.profile.avatar ?? null }} size={20} />
                <span className="wide">@{user.profile.handle}</span>
              </Link>
              <Link href="/settings" className="pill nav" aria-label={texts.settings}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
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
        <div className="foot-start">
          <span>&copy; 2026 AnyTogether</span>
          <nav className="foot-links" aria-label="AnyTogether">
            <Link href="/themes">{texts.themes}</Link>
            <Link href="/compatibility">{texts.compatibility}</Link>
            <Link href="/download">{texts.downloads}</Link>
          </nav>
        </div>
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
  );
  return (
    <html lang={texts.language} className={`${display.variable} ${mono.variable}`}>
      <body>
        <div className="glow" />
        <div className="grid" />
        {user ? (
          <LiveProvider me={user.account.id}>
            <CallProvider texts={callStrings(texts)}>{page}</CallProvider>
            <ShareInvites texts={shareInviteStrings(texts)} />
          </LiveProvider>
        ) : (
          page
        )}
      </body>
    </html>
  );
}
