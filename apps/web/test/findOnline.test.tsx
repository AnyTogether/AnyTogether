import type { Activity } from "@/lib/feed";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let chosen = "en";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: chosen }) }),
  headers: async () => new Headers(),
}));
let online: { online: number } | null = { online: 12 };
vi.mock("@/lib/site", () => ({ loadOnline: async () => online }));

const { strings } = await import("@/lib/i18n");
const { OnlineNow } = await import("@/components/OnlineNow");
const { FeedList } = await import("@/components/FeedList");

beforeEach(() => {
  chosen = "en";
  online = { online: 12 };
});

const onlineLine = async () => {
  const node = await OnlineNow({ texts: await strings() });
  return node ? renderToStaticMarkup(node) : "";
};

describe("players online on Find players", () => {
  it("shows the count only, and says who is left out", async () => {
    const html = await onlineLine();
    expect(html).toContain("12 players online now");
    expect(html).toContain("Not counting anyone who is invisible or hides their status.");
    online = { online: 1 };
    expect(await onlineLine()).toContain("1 player online now");
  });

  it("speaks Turkish", async () => {
    chosen = "tr";
    const html = await onlineLine();
    expect(html).toContain("Şu an 12 oyuncu çevrimiçi");
    expect(html).toContain("Görünmez olanlar ve durumunu gizleyenler sayılmaz.");
  });

  it("shows nothing without a count or with nobody counted", async () => {
    online = null;
    expect(await onlineLine()).toBe("");
    online = { online: 0 };
    expect(await onlineLine()).toBe("");
  });
});

describe("game names in recent activity", () => {
  const item = (titleId: string): Activity => ({
    id: "a1",
    kind: "first_play",
    createdAt: "2026-11-07T17:00:00Z",
    actor: { userId: "u1", handle: "slickdaddy", displayName: "Slick Daddy", avatar: null },
    game: { titleId, names: { en: "Cat Quest III" }, iconUrl: null },
    highlight: null,
    reactions: { counts: {}, mine: null },
  });
  const html = async (activity: Activity) =>
    renderToStaticMarkup(
      <FeedList
        texts={await strings()}
        initial={{ items: [activity], next: null }}
        now={Date.parse("2026-11-07T17:12:00Z")}
        empty={null}
        readOnly
      />,
    );

  it("open the game's page", async () => {
    const out = await html(item("PPSA01234"));
    expect(out).toContain('href="/games/PPSA01234"');
    expect(out).toContain(">Cat Quest III</a>");
    expect(out).toContain('href="/u/slickdaddy"');
  });

  it("stay plain text for an ID the game page does not take", async () => {
    const out = await html(item("not-a-title"));
    expect(out).not.toContain("/games/");
    expect(out).toContain('<b class="game-name">Cat Quest III</b>');
  });
});
