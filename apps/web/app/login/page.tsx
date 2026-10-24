import { LoginForm } from "@/components/LoginForm";
import { strings } from "@/lib/i18n";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const texts = await strings();
  const { next } = await searchParams;
  // Only paths on this site, never another address.
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <section className="narrow">
      <h2 className="in d1">{texts.loginTitle}</h2>
      <p className="lead in d2">{texts.loginLead}</p>
      <div className="in d3">
        <LoginForm texts={texts} next={target} />
      </div>
    </section>
  );
}
