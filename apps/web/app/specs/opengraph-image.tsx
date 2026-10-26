import { Mark } from "@/components/Mark";
import { specsStrings } from "@/lib/i18n-specs";
import { googleFont } from "@/lib/ogFont";
import { countOf, sections, totalCount } from "@/lib/specs";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AnyPS5 and AnyTogether: every feature, on one sheet";

/** The picture a shared /specs link shows: the sheet's title and the count of each product's
 *  features, as on the page's strip. English, since a preview is made once for everyone. */
export default async function SpecsImage() {
  const t = specsStrings("en");
  const cells = sections.map((section, index) => ({
    code: String(index + 1).padStart(2, "0"),
    n: countOf(section),
    name: t.sections[section.id].nav,
  }));
  const total = totalCount();
  const text = `${t.title.join(" ")}${cells.map((c) => `${c.code}${c.n}${c.name}`).join("")}${total} features · AnyTogether FULL SPECS`;
  const [heavy, regular] = await Promise.all([
    googleFont("Archivo", 800, text),
    googleFont("Space Grotesk", 500, text),
  ]);
  const fonts = [
    ...(heavy ? [{ name: "Head", data: heavy, weight: 800 as const, style: "normal" as const }] : []),
    ...(regular ? [{ name: "Body", data: regular, weight: 500 as const, style: "normal" as const }] : []),
  ];
  const head = heavy ? "Head" : undefined;
  const body = regular ? "Body" : undefined;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 72px 56px",
        background: "#0b0f1d",
        backgroundImage:
          "radial-gradient(70% 90% at 0% 0%, rgba(79,124,255,0.34), transparent 70%), linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "100% 100%, 48px 48px, 48px 48px",
        color: "#f1f3f9",
        fontFamily: body,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: "#9aa3bd" }}>FULL SPECS</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26 }}>
          <Mark size={36} />
          AnyTogether
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontFamily: head }}>
        <div style={{ display: "flex", fontSize: 104, lineHeight: 0.92, letterSpacing: "-0.045em" }}>
          {t.title[0]}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 104,
            lineHeight: 0.92,
            letterSpacing: "-0.045em",
            color: "#7f8bad",
          }}
        >
          {t.title[1]}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          borderTop: "1px solid rgba(255,255,255,0.16)",
          borderBottom: "1px solid rgba(255,255,255,0.16)",
        }}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.code}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              padding: "16px 0 16px 18px",
              borderLeft: index ? "1px solid rgba(255,255,255,0.16)" : "none",
              paddingLeft: index ? 18 : 0,
            }}
          >
            <div style={{ display: "flex", fontSize: 16, color: "#9aa3bd" }}>{cell.code}</div>
            <div
              style={{
                display: "flex",
                fontSize: 50,
                fontFamily: head,
                letterSpacing: "-0.04em",
                marginTop: 4,
              }}
            >
              {String(cell.n)}
            </div>
            <div style={{ display: "flex", fontSize: 20, color: "#b9c0d4" }}>{cell.name}</div>
          </div>
        ))}
      </div>
    </div>,
    { ...size, fonts, headers: { "cache-control": "public, max-age=3600" } },
  );
}
