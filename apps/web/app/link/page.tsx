import { LinkForm } from "@/components/LinkForm";
import { PasskeySignIn } from "@/components/Passkeys";
import { strings } from "@/lib/i18n";
import { currentUser } from "@/lib/session";
import Link from "next/link";

/** Where a launcher's device code is approved (the launcher shows a QR to this page). */
export default async function LinkDevice({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const [texts, user, { code }] = await Promise.all([strings(), currentUser(), searchParams]);
  const back = `/link${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return (
    <section className="narrow">
      <h2 className="in d1">{texts.linkTitle}</h2>
      <p className="lead in d2">{user ? texts.linkLead : texts.linkSignIn}</p>
      <div className="in d3">
        {user ? (
          <LinkForm initial={code ?? ""} texts={texts} />
        ) : (
          // A passkey signs in right here; the page then shows the code field.
          <div className="link-sign-in">
            <PasskeySignIn texts={texts} />
            <Link className="pill" href={`/login?next=${encodeURIComponent(back)}`}>
              {texts.signInWithEmail}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
