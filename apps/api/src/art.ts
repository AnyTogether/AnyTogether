import {
  type CoverPattern,
  type IconGlyph,
  type PaletteName,
  coverPresets,
  iconPresets,
  palettes,
} from "@anytogether/shared";
import { Hono } from "hono";

/** Covers and community icons, drawn here as SVG from the launcher's palettes: nothing is
 *  uploaded or stored, and the same name always draws the same picture. */

/** A small seeded generator, so a preset's stars land in the same places every time. */
function seeded(text: string) {
  let state = 2166136261;
  for (const char of text) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

function coverBody(palette: PaletteName, pattern: CoverPattern, id: string) {
  const { deep, middle, bright, accent } = palettes[palette];
  const random = seeded(id);
  const base = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${middle}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${bright}" stop-opacity="0.55"/><stop offset="1" stop-color="${bright}" stop-opacity="0"/></radialGradient>
<radialGradient id="warm" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${deep}" stop-opacity="0"/><stop offset="1" stop-color="${deep}" stop-opacity="0.65"/></linearGradient>
</defs>
<rect width="1500" height="500" fill="url(#bg)"/>`;
  let art = "";
  if (pattern === "ribbons") {
    for (let i = 0; i < 5; i++) {
      const y = 120 + i * 70 + random() * 40;
      const lift = 80 + random() * 140;
      const width = 26 + random() * 50;
      art += `<path d="M-100 ${round(y + lift)} C 300 ${round(y - lift)}, 700 ${round(y + lift * 1.4)}, 1000 ${round(y)} S 1400 ${round(y - lift)}, 1650 ${round(y + lift * 0.4)}" fill="none" stroke="${i % 2 ? accent : bright}" stroke-opacity="${round(0.12 + random() * 0.2)}" stroke-width="${round(width)}" stroke-linecap="round" filter="url(#soft)"/>`;
      art += `<path d="M-100 ${round(y + lift)} C 300 ${round(y - lift)}, 700 ${round(y + lift * 1.4)}, 1000 ${round(y)} S 1400 ${round(y - lift)}, 1650 ${round(y + lift * 0.4)}" fill="none" stroke="${bright}" stroke-opacity="0.35" stroke-width="1.5"/>`;
    }
  } else if (pattern === "grid") {
    art += `<ellipse cx="750" cy="250" rx="620" ry="120" fill="url(#glow)"/>`;
    for (let i = 0; i <= 24; i++)
      art += `<line x1="750" y1="250" x2="${750 + (i - 12) * 250}" y2="520" stroke="${bright}" stroke-opacity="0.32" stroke-width="1.2"/>`;
    for (let i = 1; i <= 9; i++) {
      const y = 250 + (i * i * 270) / 81;
      art += `<line x1="0" y1="${round(y)}" x2="1500" y2="${round(y)}" stroke="${bright}" stroke-opacity="${round(0.08 + i * 0.025)}" stroke-width="1.2"/>`;
    }
    art += `<rect y="0" width="1500" height="250" fill="${deep}" fill-opacity="0.35"/><line x1="0" y1="250" x2="1500" y2="250" stroke="${accent}" stroke-opacity="0.7" stroke-width="2"/>`;
  } else if (pattern === "stars") {
    art += `<ellipse cx="${round(300 + random() * 900)}" cy="${round(150 + random() * 200)}" rx="520" ry="200" fill="url(#glow)" opacity="0.7"/>`;
    art += `<ellipse cx="${round(200 + random() * 1100)}" cy="${round(100 + random() * 300)}" rx="380" ry="160" fill="url(#warm)" opacity="0.6"/>`;
    for (let i = 0; i < 140; i++) {
      const r = random() < 0.9 ? 0.6 + random() * 1.1 : 1.8 + random() * 1.4;
      art += `<circle cx="${round(random() * 1500)}" cy="${round(random() * 500)}" r="${round(r)}" fill="${random() < 0.15 ? accent : "#ffffff"}" fill-opacity="${round(0.35 + random() * 0.6)}"/>`;
    }
  } else {
    art += `<ellipse cx="${round(250 + random() * 300)}" cy="${round(60 + random() * 120)}" rx="560" ry="260" fill="url(#glow)"/>`;
    art += `<ellipse cx="${round(950 + random() * 300)}" cy="${round(300 + random() * 150)}" rx="520" ry="240" fill="url(#warm)"/>`;
    art += `<ellipse cx="${round(600 + random() * 300)}" cy="${round(480)}" rx="420" ry="160" fill="url(#glow)" opacity="0.5"/>`;
  }
  return `${base}${art}<rect width="1500" height="500" fill="url(#fade)"/>`;
}

/** A cover preset as an SVG document, or null for a name that is not one. */
export function coverSvg(id: string) {
  if (!coverPresets.includes(id)) return null;
  const [palette, pattern] = id.split("-") as [PaletteName, CoverPattern];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500" width="1500" height="500" preserveAspectRatio="xMidYMid slice">${coverBody(palette, pattern, id)}</svg>`;
}

/** The glyphs, drawn with strokes on a 24-unit grid. */
const glyphs: Record<IconGlyph, string> = {
  pad: "M6.5 8h11a4 4 0 0 1 3.9 4.8l-.8 3.6a2.2 2.2 0 0 1-3.8 1L15 15.5H9l-1.8 1.9a2.2 2.2 0 0 1-3.8-1l-.8-3.6A4 4 0 0 1 6.5 8zM7.5 10.5v3M6 12h3M15.5 11.2h.01M17.5 13h.01",
  sword: "M14.5 4H20v5.5L10 19.5 4.5 14zM8 16l-3.5 3.5M6.5 13.5l4 4",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z",
  flag: "M5 21V4M5 4.5c4-2 6 2 10 0s4-1 4-1v9s-1-1-4 0-6-2-10 0",
  rocket:
    "M12 3c3 2 4.5 5.5 4.5 9.5L14 16h-4l-2.5-3.5C7.5 8.5 9 5 12 3zM10 16l-2 4 4-1.5 4 1.5-2-4M12 9.5h.01",
  crown: "M4 8l4 4 4-7 4 7 4-4-1.5 10h-13zM5.5 20h13",
  shield: "M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6zM9 12l2 2 4-4",
  heart: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z",
  flame:
    "M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.9-2.9-6.2-4.2-9.8-1.6 1.6-2 3.4-1.8 5-1.5-.8-2.4-2.4-2.4-4C7.8 8 5.5 10.8 5.5 14.8 5.5 18.4 8.1 21 12 21z",
  ghost: "M5.5 20V11a6.5 6.5 0 0 1 13 0v9l-2.2-1.6L14.2 20 12 18.4 9.8 20l-2.1-1.6zM9.5 11h.01M14.5 11h.01",
  wheel:
    "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.8 11h5.8M14.4 11h5.8M12 14.5v6",
  ball: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8l3.3 2.4-1.3 3.9h-4l-1.3-3.9zM12 3.5V8M15.3 10.4l4.6-1.5M14 14.3l2.9 3.9M10 14.3l-2.9 3.9M8.7 10.4L4.1 8.9",
};

/** A community icon preset as an SVG document, or null for a name that is not one. */
export function iconSvg(id: string) {
  if (!iconPresets.includes(id)) return null;
  const [glyph, palette] = id.split("-") as [IconGlyph, PaletteName];
  const { deep, middle, bright, accent } = palettes[palette];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${middle}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
<radialGradient id="glow" cx="0.3" cy="0.2" r="0.8"><stop offset="0" stop-color="${bright}" stop-opacity="0.45"/><stop offset="1" stop-color="${bright}" stop-opacity="0"/></radialGradient></defs>
<rect width="256" height="256" rx="64" fill="url(#bg)"/><rect width="256" height="256" rx="64" fill="url(#glow)"/>
<rect x="1.5" y="1.5" width="253" height="253" rx="62.5" fill="none" stroke="${bright}" stroke-opacity="0.25" stroke-width="3"/>
<g transform="translate(48 48) scale(6.6667)" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="${glyphs[glyph]}" stroke="${accent}" stroke-opacity="0.5" stroke-width="3.2" transform="translate(.35 .45)"/>
<path d="${glyphs[glyph]}" stroke="#ffffff" stroke-width="1.7"/>
</g></svg>`;
}

/** URLs of the pictures, on the API's own address. */
export const coverUrl = (publicUrl: string, id: string) =>
  new URL(`/api/v1/art/covers/${id}.svg`, publicUrl).toString();
export const iconUrl = (publicUrl: string, id: string) =>
  new URL(`/api/v1/art/icons/${id}.svg`, publicUrl).toString();

/** Served to anyone, kept by browsers and proxies for a day (a name always draws the same). */
export function artRoutes() {
  const app = new Hono();
  const svg = (text: string) =>
    new Response(text, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  const missing = () =>
    new Response(JSON.stringify({ status: 404, code: "not_found", title: "No such picture" }), {
      status: 404,
      headers: { "content-type": "application/problem+json" },
    });
  app.get("/art/covers/:file{[a-z]+-[a-z]+\\.svg}", (c) => {
    const text = coverSvg(c.req.param("file").replace(/\.svg$/, ""));
    return text ? svg(text) : missing();
  });
  app.get("/art/icons/:file{[a-z]+-[a-z]+\\.svg}", (c) => {
    const text = iconSvg(c.req.param("file").replace(/\.svg$/, ""));
    return text ? svg(text) : missing();
  });
  app.get("/art/*", missing);
  return app;
}
