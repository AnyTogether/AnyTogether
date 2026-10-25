import { Mark } from "@/components/Mark";
import { accountEn } from "@/lib/i18n-account";
import { googleFont } from "@/lib/ogFont";
import { type PublicProfile, initialOf } from "@/lib/people";
import { api } from "@/lib/session";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AnyTogether profile";

type Params = { params: Promise<{ handle: string }> };

const grades = [
  { key: "platinum", tone: "#b9c8e2" },
  { key: "gold", tone: "#e8c15a" },
  { key: "silver", tone: "#cbd0d6" },
  { key: "bronze", tone: "#c88b57" },
] as const;

/** Our own avatars only (the API's /avatars/<hash>.jpg), read from the API inside the server's
 *  network; a picture from anywhere else is not fetched, the initial stands in. */
async function avatarData(url: string | null) {
  const path = url ? new URL(url, "http://local").pathname : "";
  if (!/^\/api\/v1\/avatars\/[0-9a-f]{32}\.jpg$/.test(path)) return null;
  const response = await api(path.replace("/api/v1", "")).catch(() => undefined);
  if (!response?.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > 0 && bytes.length < 512 * 1024
    ? `data:image/jpeg;base64,${bytes.toString("base64")}`
    : null;
}

function Cup({ tone }: { tone: string }) {
  return (
    <svg
      aria-hidden="true"
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke={tone}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8" />
    </svg>
  );
}

/** The picture a shared profile link shows (Discord, X, iMessage): the name, the avatar and, when
 *  the trophies are open to everyone, how many of each grade. Read signed out, so it never shows
 *  more than anyone may see. */
export default async function ProfileImage({ params }: Params) {
  const handle = decodeURIComponent((await params).handle)
    .replace(/^@/, "")
    .toLowerCase();
  const response = /^[a-z0-9_.]{1,40}$/.test(handle)
    ? await api(`/users/${encodeURIComponent(handle)}`).catch(() => undefined)
    : undefined;
  const profile = response?.ok ? ((await response.json()) as PublicProfile) : null;
  const name = profile?.displayName ?? `@${handle}`;
  const counts = profile?.trophyCounts;
  const avatar = await avatarData(profile?.avatar ?? null);
  const number = new Intl.NumberFormat("en");
  const bio = (profile?.bio ?? "").replace(/\s+/g, " ").slice(0, 110);
  const text = `${name}@${handle}${initialOf(name)}${bio}…AnyTogether${accountEn.ogTrophies}0123456789,·`;
  const [bold, regular] = await Promise.all([
    googleFont("Space Grotesk", 700, text),
    googleFont("Space Grotesk", 500, text),
  ]);
  const fonts = [
    ...(bold ? [{ name: "Display", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(regular ? [{ name: "Display", data: regular, weight: 500 as const, style: "normal" as const }] : []),
  ];
  const long = name.length > 18;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: "#07080c",
        backgroundImage:
          "radial-gradient(60% 90% at 12% 0%, rgba(79,124,255,0.42), transparent 70%), radial-gradient(50% 90% at 92% 8%, rgba(182,92,255,0.34), transparent 70%), radial-gradient(45% 70% at 60% 110%, rgba(47,224,196,0.20), transparent 70%)",
        color: "#eef0f6",
        fontFamily: fonts.length ? "Display" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 220,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            border: "6px solid rgba(255,255,255,0.10)",
            backgroundImage: "linear-gradient(135deg, #4f7cff, #b65cff 55%, #2fe0c4)",
            fontSize: 110,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {avatar ? (
            <img src={avatar} width={220} height={220} alt="" style={{ objectFit: "cover" }} />
          ) : (
            initialOf(name)
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: long ? 62 : 80,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
          <div style={{ marginTop: 14, fontSize: 34, fontWeight: 500, color: "#8a90a3" }}>{`@${handle}`}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {counts ? (
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: 18 }}>
              <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>
                {number.format(counts.total)}
              </div>
              <div style={{ fontSize: 24, fontWeight: 500, color: "#8a90a3", marginTop: 6 }}>
                {accountEn.ogTrophies}
              </div>
            </div>
            {grades.map(({ key, tone }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 20px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  fontSize: 30,
                  fontWeight: 500,
                }}
              >
                <Cup tone={tone} />
                {number.format(counts[key])}
              </div>
            ))}
          </div>
        ) : (
          // No trophies to show: the bio says who this is, if there is one.
          <div
            style={{
              display: "flex",
              maxWidth: 720,
              fontSize: 32,
              fontWeight: 500,
              lineHeight: 1.35,
              color: "#c9cdd8",
            }}
          >
            {bio.length === 110 ? `${bio.trimEnd()}…` : bio}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
          <Mark size={44} />
          AnyTogether
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts,
      // A changed name or a new trophy shows within minutes; previews keep their own copy anyway.
      headers: { "cache-control": "public, max-age=600" },
    },
  );
}
