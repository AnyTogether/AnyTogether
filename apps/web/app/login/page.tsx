import { AgreeLine } from "@/components/LegalLinks";
import { LoginForm } from "@/components/LoginForm";
import { PasskeySignIn } from "@/components/Passkeys";
import { ProviderLogo } from "@/components/ProviderLogo";
import { strings } from "@/lib/i18n";
import { samePath } from "@/lib/paths";
import { api } from "@/lib/session";

export default async function Login({
  searchParams,
}: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const texts = await strings();
  const { next, error } = await searchParams;
  // Sign in with Discord, when this server has Discord set up, and with Steam, for accounts that
  // have Steam linked (an older API offers no Steam).
  const providers = await api("/auth/providers")
    .then((response) =>
      response.ok ? (response.json() as Promise<{ discord: unknown; steam?: unknown }>) : null,
    )
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
          <a className="discord-sign-in" href={`/auth/discord/start?next=${encodeURIComponent(target)}`}>
            <ProviderLogo provider="discord" />
            {texts.signInWithDiscord}
          </a>
        ) : null}
        {providers?.steam === true ? (
          <a className="steam-sign-in" href={`/auth/steam/start?next=${encodeURIComponent(target)}`}>
            <ProviderLogo provider="steam" />
            {texts.signInWithSteam}
          </a>
        ) : null}
        {error === "discord" && (
          <p className="error" role="alert">
            {texts.discordFailed}
          </p>
        )}
        {(error === "steam" || error === "steam_unlinked") && (
          <p className="error" role="alert">
            {error === "steam" ? texts.steamFailed : texts.steamNotLinked}
          </p>
        )}
      </div>
      <AgreeLine texts={texts} />
    </section>
  );
}
