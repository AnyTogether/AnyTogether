import { AppealForm } from "@/components/AppealForm";
import { strings, ui } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type Restriction, type Restrictions, appealCookie, longDate } from "@/lib/restrictions";
import { api, restrictionToken } from "@/lib/session";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

export const metadata: Metadata = { title: "Account restrictions · AnyTogether", robots: { index: false } };

function Mark({ kind }: { kind: Restriction["kind"] }) {
  return (
    <span className={`restriction-mark is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {kind === "muted" ? (
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5zM9 8.5l6 5M15 8.5l-6 5" />
        ) : (
          <>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M6 6l12 12" />
          </>
        )}
      </svg>
    </span>
  );
}

/** What is restricted on the account, why and until when, and the appeal: for a muted account
 *  signed in, or a banned one with the appeal token its refused sign-in left (an hour). */
export default async function Restricted() {
  const texts = await strings();
  const { language } = texts;
  const token = await restrictionToken();
  const response = token ? await api("/me/restrictions", { token }).catch(() => undefined) : undefined;
  const data = response?.ok ? ((await response.json()) as Restrictions) : null;
  const hadAppealToken = Boolean((await cookies()).get(appealCookie));

  if (!data)
    return (
      <section className="narrow">
        <h2 className="in d1">{texts.restrictedTitle}</h2>
        <div className="card restriction-empty in d2">
          <p>{hadAppealToken ? texts.restrictedExpired : texts.restrictedSignIn}</p>
          <Link href="/login?next=/restricted" className="pill accent">
            {texts.signIn}
          </Link>
        </div>
      </section>
    );

  const { restrictions, appeal } = data;
  const until = (r: Restriction) =>
    r.until ? fill(texts.rUntil, { date: longDate(r.until, language) }) : texts.rUntilLifted;
  const lead = (r: Restriction) =>
    r.kind === "banned"
      ? texts.r_banned_lead
      : r.kind === "suspended"
        ? fill(texts.r_suspended_lead, { date: longDate(r.until ?? r.since, language) })
        : fill(texts.r_muted_lead, { until: until(r) });

  return (
    <section className="narrow restricted-page">
      <h2 className="in d1">{texts.restrictedTitle}</h2>
      {restrictions.length === 0 && (
        <div className="card restriction-empty in d2">
          <p>{texts.restrictedNone}</p>
          <Link href="/" className="pill">
            {texts.home}
          </Link>
        </div>
      )}
      {restrictions.map((r, index) => (
        <article key={r.id} className={`card restriction is-${r.kind} in d${Math.min(index + 2, 4)}`}>
          <header>
            <Mark kind={r.kind} />
            <div className="lines">
              <h3>{texts[`r_${r.kind}`]}</h3>
              <p className="meta">
                {fill(texts.rSince, { date: longDate(r.since, language) })} · {until(r)}
              </p>
            </div>
          </header>
          <p className="restriction-lead">{lead(r)}</p>
          <div className="restriction-reason">
            <span className="label">{texts.rReason}</span>
            <p className={r.reason ? undefined : "none"}>{r.reason ?? texts.rNoReason}</p>
          </div>
          {r.appealable && !(appeal?.status === "open") && (
            <AppealForm restrictionId={r.id} texts={ui(texts)} />
          )}
        </article>
      ))}
      {appeal && (
        <article className={`card appeal-card is-${appeal.status} in d4`}>
          <header>
            <h3 className="sub">{texts.appealYour}</h3>
            <span className={`tag appeal-status is-${appeal.status}`}>
              {texts[`appealStatus_${appeal.status}`]}
            </span>
          </header>
          <blockquote>{appeal.text}</blockquote>
          <p className="meta">{longDate(appeal.createdAt, language)}</p>
          {appeal.reply && (
            <div className="appeal-reply">
              <span className="label">{texts.appealReplyFrom}</span>
              <p>{appeal.reply}</p>
            </div>
          )}
          {appeal.status === "declined" && restrictions.length > 0 && (
            <p className="hint">{texts.appealAgain}</p>
          )}
        </article>
      )}
    </section>
  );
}
