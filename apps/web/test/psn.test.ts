import { describe, expect, it, vi } from "vitest";
import { type Notice, noticeHref } from "../lib/notify";
import { byDay, dayKey, gameOptions, isoToLocalInput, linkHref, localArt, localInputToIso } from "../lib/psn";

vi.mock("@/lib/session", () => ({ relay: async (path: string) => Response.json({ relayed: path }) }));

const id = "01a16f94-8442-724b-931e-0a26a894b17d";
const other = "01a16f94-8417-7dad-a1b1-1fd3b4f79ff5";

describe("events in the reader's time zone", () => {
  it("groups events by the day they start on where the reader is", () => {
    const events = [
      { id: "b", startsAt: "2026-10-25T21:30:00Z" },
      { id: "a", startsAt: "2026-10-25T20:00:00Z" },
      { id: "c", startsAt: "2026-10-26T09:00:00Z" },
    ];
    // In UTC, the evening ones fall on the 25th.
    expect(byDay(events, "UTC").map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ["2026-10-25", ["a", "b"]],
      ["2026-10-26", ["c"]],
    ]);
    // In Istanbul (UTC+3) 21:30 UTC is already the 26th.
    expect(byDay(events, "Europe/Istanbul").map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ["2026-10-25", ["a"]],
      ["2026-10-26", ["b", "c"]],
    ]);
    expect(dayKey("2026-10-25T23:30:00Z", "America/New_York")).toBe("2026-10-25");
  });

  it("reads the time picker in the browser's zone and writes it back", () => {
    const iso = localInputToIso("2026-10-25T21:30");
    expect(iso).toBe(new Date(2026, 9, 25, 21, 30).toISOString());
    expect(isoToLocalInput(iso as string)).toBe("2026-10-25T21:30");
    expect(localInputToIso("not a time")).toBeNull();
  });
});

describe("profile and community helpers", () => {
  it("loads the API's drawn pictures from this site, and other pictures as they are", () => {
    expect(localArt("https://together.example.org/api/v1/art/covers/sunset-grid.svg")).toBe(
      "/api/v1/art/covers/sunset-grid.svg",
    );
    expect(localArt("https://image.api.playstation.com/cat.png")).toBe(
      "https://image.api.playstation.com/cat.png",
    );
    expect(localArt(null)).toBeNull();
  });

  it("lists games by name in the reader's language and says where a started event goes", () => {
    expect(
      gameOptions(
        [
          { titleId: "PPSA00002", names: { en: "Zebra", tr: "Zebra" } },
          { titleId: "PPSA00001", names: { en: "Owl", tr: "Baykuş" } },
        ],
        "tr",
      ),
    ).toEqual([
      { titleId: "PPSA00001", name: "Baykuş" },
      { titleId: "PPSA00002", name: "Zebra" },
    ]);
    expect(linkHref({ kind: "party", id })).toBe("/party");
    expect(linkHref({ kind: "share_play", id })).toBe(`/watch/${id}`);
  });

  it("leads the new notifications to what they are about", () => {
    const notice = (kind: Notice["kind"], extra: Partial<Notice> = {}): Notice => ({
      id: "n",
      kind,
      actor: { userId: "u", handle: "ayse", displayName: "Ayşe", avatar: null },
      subjectId: id,
      data: {},
      read: false,
      createdAt: "",
      updatedAt: "",
      ...extra,
    });
    expect(noticeHref(notice("level_up"))).toBe("/u/ayse");
    expect(noticeHref(notice("community_invite"))).toBe(`/communities/${id}`);
    expect(noticeHref(notice("event_reminder"))).toBe(`/events/${id}`);
    expect(noticeHref(notice("event_started", { data: { link: { kind: "share_play", id: other } } }))).toBe(
      `/watch/${other}`,
    );
    expect(noticeHref(notice("event_started", { data: { link: { kind: "party", id: other } } }))).toBe(
      "/party",
    );
  });
});

describe("the social relay for communities, events, players met and the profile", () => {
  const call = async (path: string, method: string) => {
    const route = await import("@/app/me/social/[...path]/route");
    const handler = route[method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE"];
    const [bare] = path.split("?");
    return handler(
      new Request(`https://together.example.org/me/social/${path}`, {
        method,
        headers: { host: "together.example.org", origin: "https://together.example.org" },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      }),
      { params: Promise.resolve({ path: bare?.split("/") ?? [] }) },
    ).then(async (response) => ({ status: response.status, body: await response.json() }));
  };

  it("passes what the new pages use", async () => {
    for (const [path, method, to] of [
      [
        "communities?q=Kedi Avcıları&titleId=PPSA01234",
        "GET",
        "/communities?titleId=PPSA01234&q=Kedi+Avc%C4%B1lar%C4%B1",
      ],
      ["communities", "POST", "/communities"],
      [`communities/${id}`, "PATCH", `/communities/${id}`],
      [`communities/${id}`, "DELETE", `/communities/${id}`],
      [`communities/${id}/join`, "POST", `/communities/${id}/join`],
      [`communities/${id}/members`, "GET", `/communities/${id}/members`],
      [`communities/${id}/members/${other}/role`, "PUT", `/communities/${id}/members/${other}/role`],
      [`communities/${id}/members/${other}`, "DELETE", `/communities/${id}/members/${other}`],
      [`communities/${id}/bans/${other}`, "DELETE", `/communities/${id}/bans/${other}`],
      [`communities/${id}/events`, "POST", `/communities/${id}/events`],
      [`events/${id}/rsvp`, "PUT", `/events/${id}/rsvp`],
      [`events/${id}/rsvp`, "DELETE", `/events/${id}/rsvp`],
      [`events/${id}/start`, "POST", `/events/${id}/start`],
      [`events/${id}`, "PATCH", `/events/${id}`],
      ["me/events", "GET", "/me/events"],
      ["me/players-met?days=30", "GET", "/me/players-met?days=30"],
      ["me/players-met", "PATCH", "/me/players-met"],
      [`me/players-met/${id}`, "DELETE", `/me/players-met/${id}`],
      ["me/look", "PATCH", "/me/look"],
      ["me/showcase", "PUT", "/me/showcase"],
      [`conversations/${id}/mute`, "PUT", `/conversations/${id}/mute`],
    ] as const) {
      const answer = await call(path, method);
      expect(answer.status, path).toBe(200);
      expect(answer.body.relayed, path).toBe(to);
    }
  });

  it("refuses odd paths and methods", async () => {
    for (const [path, method] of [
      ["communities/not-an-id", "GET"],
      [`communities/${id}/owner`, "PUT"],
      [`events/${id}/start`, "PUT"],
      ["me/showcase", "POST"],
      ["admin/communities", "GET"],
    ] as const)
      expect((await call(path, method)).status, path).toBe(404);
  });
});
