import { LoginForm } from "@/components/LoginForm";
import { PasskeySignIn } from "@/components/Passkeys";
import { strings } from "@/lib/i18n";
import { samePath } from "@/lib/paths";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const texts = await strings();
  const { next } = await searchParams;
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
      </div>
    </section>
  );
}
