import { describe, expect, it, vi } from "vitest";
import { languageName, startTime, startsNow, untilShort } from "../lib/discover";

// The relay itself needs a request's cookies; these tests see whether it was reached.
vi.mock("@/lib/session", () => ({ relay: async (path: string) => Response.json({ relayed: path }) }));

const id = "01a16f94-8442-724b-931e-0a26a894b17d";
const other = "01a16f94-8417-7dad-a1b1-1fd3b4f79ff5";

describe("Find players helpers", () => {
  it("says when a post starts and ends", () => {
    const now = Date.parse("2026-10-24T18:00:00Z");
    expect(startsNow({ startsAt: null }, now)).toBe(true);
    expect(startsNow({ startsAt: "2026-10-24T18:20:00Z" }, now)).toBe(true);
    expect(startsNow({ startsAt: "2026-10-24T19:00:00Z" }, now)).toBe(false);
    expect(untilShort("2026-10-24T18:25:00Z", "en", now)).toBe("in 25 min.");
    expect(untilShort("2026-10-24T21:00:00Z", "en", now)).toBe("in 3 hr.");
    expect(startTime("2026-10-24T19:30:00", "en", Date.parse("2026-10-24T09:00:00"))).toMatch(/7:30|19:30/);
  });

  it("names languages in the reader's language", () => {
    expect(languageName("tr", "en")).toBe("Turkish");
    expect(languageName("tr", "tr")).toBe("Türkçe");
    expect(languageName("de", "tr")).toBe("Almanca");
  });
});

describe("the social relay", () => {
  const call = async (path: string, method: string) => {
    const route = await import("@/app/me/social/[...path]/route");
    const handler = route[method as "GET" | "POST" | "PATCH" | "DELETE"];
    const [bare, query] = path.split("?");
    return handler(
      new Request(`https://together.example.org/me/social/${path}`, {
        method,
        headers: { host: "together.example.org", origin: "https://together.example.org" },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      }),
      { params: Promise.resolve({ path: bare?.split("/") ?? [] }) },
    ).then(async (response) => ({ status: response.status, body: await response.json(), query }));
  };

  it("passes the board, the public lists, people and hubs, with their filters", async () => {
    for (const [path, method, to] of [
      [
        "lfg?titleId=PPSA01234&purpose=coop&language=tr&now=1&evil=1",
        "GET",
        "/lfg?titleId=PPSA01234&purpose=coop&language=tr&now=1",
      ],
      ["lfg", "POST", "/lfg"],
      [`lfg/${id}/requests`, "POST", `/lfg/${id}/requests`],
      [`lfg/${id}/requests/${other}/accept`, "POST", `/lfg/${id}/requests/${other}/accept`],
      [`lfg/${id}/requests/me`, "DELETE", `/lfg/${id}/requests/me`],
      [`lfg/${id}`, "DELETE", `/lfg/${id}`],
      ["parties/public", "GET", "/parties/public"],
      ["share-plays/public?live=1", "GET", "/share-plays/public?live=1"],
      [`parties/${id}/requests/${other}/decline`, "POST", `/parties/${id}/requests/${other}/decline`],
      ["discover/suggestions", "GET", "/discover/suggestions"],
      ["games/PPSA01234/hub", "GET", "/games/PPSA01234/hub"],
      ["me/discovery", "PATCH", "/me/discovery"],
    ] as const) {
      const answer = await call(path, method);
      expect(answer.status, path).toBe(200);
      expect(answer.body.relayed, path).toBe(to);
    }
  });

  it("refuses what the website never does: answering share play requests, odd paths", async () => {
    for (const [path, method] of [
      [`share-plays/${id}/requests/${other}/accept`, "POST"],
      ["games/ppsa1/hub", "GET"],
      ["lfg/not-an-id", "DELETE"],
      ["discover/everyone", "GET"],
    ] as const)
      expect((await call(path, method)).status, path).toBe(404);
  });
});
