import { Mark } from "@/components/Mark";
import { strings } from "@/lib/i18n";
import { currentUser } from "@/lib/session";
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
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  return (
    <html
      lang={texts.signIn === "Giriş yap" ? "tr" : "en"}
      className={`${display.variable} ${mono.variable}`}
    >
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
                <form action="/auth/logout" method="post" className="side">
                  <span className="tag">@{user.profile.handle}</span>
                  <button type="submit" className="pill">
                    {texts.signOut}
                  </button>
                </form>
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
            <span>
              a <a href="https://kodla.agency">kodla.agency</a> project
            </span>
          </footer>
        </main>
      </body>
    </html>
  );
}
