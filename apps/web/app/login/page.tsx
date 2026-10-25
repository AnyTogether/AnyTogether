import { LoginForm } from "@/components/LoginForm";
import { PasskeySignIn } from "@/components/Passkeys";
import { strings } from "@/lib/i18n";
import { samePath } from "@/lib/paths";
import { api } from "@/lib/session";

export default async function Login({
  searchParams,
}: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const texts = await strings();
  const { next, error } = await searchParams;
  // Sign in with Discord, when this server has Discord set up.
  const providers = await api("/auth/providers")
    .then((response) => (response.ok ? (response.json() as Promise<{ discord: unknown }>) : null))
    .catch(() => null);
  // Only paths on this site, never another address.
  const target = samePath(next ?? null);
  return (
    <section className="narrow">
      <h2 className="in d1">{texts.loginTitle}</h2>
      <p className="lead in d2">{texts.loginLead}</p>
      <div className="in d3">
        <LoginForm texts={texts} next={target} />
        <p className="or" aria-hidden="true">
          <span>{texts.or}</span>
        </p>
        <PasskeySignIn texts={texts} next={target} autofill />
        {providers?.discord ? (
          <a
            className="pill provider-sign-in"
            href={`/auth/discord/start?next=${encodeURIComponent(target)}`}
          >
            <span className="provider-mark is-discord">Discord</span>
            {texts.signInWithDiscord}
          </a>
        ) : null}
        {error === "discord" && (
          <p className="error" role="alert">
            {texts.discordFailed}
          </p>
        )}
      </div>
    </section>
  );
}
