import { strings } from "@/lib/i18n";
import type { JSX } from "react";

const icons: (() => JSX.Element)[] = [
  () => (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  () => (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
    </>
  ),
  () => (
    <>
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  () => (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c.8-3.4 3.2-5.5 6-5.5s5.2 2.1 6 5.5M15 15c2.6-.4 5 1.3 6 4.5" />
    </>
  ),
  () => (
    <>
      <path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="8" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  () => <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />,
  () => (
    <>
      <rect x="2" y="7" width="20" height="12" rx="4" />
      <path d="M7 11v4M5 13h4" />
      <circle cx="16" cy="12" r=".6" fill="currentColor" />
      <circle cx="18" cy="14" r=".6" fill="currentColor" />
    </>
  ),
  () => <path d="M3 12h4l3-8 4 16 3-8h4" />,
  () => (
    <>
      <circle cx="13.5" cy="6.5" r="1.2" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="1.2" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="1.2" fill="currentColor" />
      <path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 22 10.7C22 5.9 17.5 2 12 2z" />
    </>
  ),
  () => <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />,
  () => (
    <>
      <path d="M4 4h16v12H4z" />
      <path d="M2 20h20M9 8l5 2.5L9 13z" />
    </>
  ),
  () => <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" />,
];

export default async function Home() {
  const texts = await strings();
  return (
    <section className="hero">
      <p className="eyebrow in d1">{texts.eyebrow}</p>
      <h1 className="in d2">
        {texts.heroA} <span>{texts.heroB}</span>
        <br />
        {texts.heroC}
      </h1>
      <p className="lead in d3">
        <b>AnyTogether</b> {texts.lead}
      </p>
      <div className="features in d4">
        {texts.features.map(([title, detail], index) => (
          <div className="f" key={title}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {icons[index]?.()}
            </svg>
            <h3>{title}</h3>
            <p>{detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
