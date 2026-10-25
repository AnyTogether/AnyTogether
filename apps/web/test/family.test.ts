import { describe, expect, it, vi } from "vitest";
import { duration, familyPathAllowed, familyRefusal } from "../lib/family";
import { familyEn, familyTr } from "../lib/i18n-family";
import { type Notice, noticeHref } from "../lib/notify";

vi.mock("@/lib/session", () => ({
  relay: async (path: string, init: RequestInit = {}) =>
    Response.json({ relayed: path, method: init.method }),
}));

const id = "01a16f2a-418a-7309-8c03-ef0f6f73fb8a";

describe("the family relay", () => {
  const call = async (path: string, method: string, headers: Record<string, string> = {}) => {
    const { GET, POST, PATCH, DELETE } = await import("@/app/me/family-api/[...path]/route");
    const handler = { GET, POST, PATCH, DELETE }[method] as typeof GET;
    return handler(
      new Request(`https://together.example.org/me/family-api/${path}`, {
        method,
        headers: { host: "together.example.org", origin: "https://together.example.org", ...headers },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      }),
      { params: Promise.resolve({ path: path.split("?")[0]?.split("/") ?? [] }) },
    );
  };

  it("passes only the family API's own paths", async () => {
    for (const [path, method] of [
      ["me/friends", "GET"],
      ["me/family/../me", "GET"],
      ["me/family/children/not-an-id/restrictions", "PATCH"],
      ["me/family/restrictions", "POST"],
      ["families", "GET"],
      ["admin/users", "GET"],
    ] as const)
      expect((await call(path, method)).status, `${method} ${path}`).toBe(404);
  });

  it("passes the family paths with only their own query parameters", async () => {
    expect(await (await call("me/family/requests?status=pending&evil=1", "GET")).json()).toEqual({
      relayed: "/me/family/requests?status=pending",
      method: "GET",
    });
    expect(await (await call(`me/family/children/${id}/restrictions`, "PATCH")).json()).toEqual({
      relayed: `/me/family/children/${id}/restrictions`,
      method: "PATCH",
    });
    expect((await call(`family-invites/${id}/accept`, "POST")).status).toBe(200);
    expect((await call(`me/family/members/${id}`, "DELETE")).status).toBe(200);
  });

  it("refuses a changing call from another website", async () => {
    const response = await call("me/family/leave", "POST", { origin: "https://evil.example.com" });
    expect(response.status).toBe(403);
  });

  it("knows the paths the page uses", () => {
    expect(familyPathAllowed("POST", "me/family/join")).toBe(true);
    expect(familyPathAllowed("POST", `me/family/requests/${id}/approve`)).toBe(true);
    expect(familyPathAllowed("POST", `me/family/requests/${id}/maybe`)).toBe(false);
  });
});

describe("the family page's words", () => {
  it("says durations the way people do", () => {
    expect(duration(45 * 60, "en")).toBe("45 min");
    expect(duration(80 * 60, "en")).toBe("1 h 20 min");
    expect(duration(120 * 60, "tr")).toBe("2 sa");
    expect(duration(-5, "tr")).toBe("0 dk");
  });

  it("tells whose family limit refused something", () => {
    const texts = { restrictedNotice: "mine", restrictedOther: "theirs" };
    expect(familyRefusal({ code: "restricted_by_family", side: "self" }, texts)).toBe("mine");
    expect(familyRefusal({ code: "restricted_by_family", side: "other" }, texts)).toBe("theirs");
    expect(familyRefusal({ code: "forbidden" }, texts)).toBeNull();
  });

  it("has every string in Turkish too", () => {
    expect(Object.keys(familyTr).sort()).toEqual(Object.keys(familyEn).sort());
    for (const [key, value] of Object.entries(familyTr)) expect(value, key).not.toBe("");
  });

  it("leads family notifications to the family page", () => {
    const notice = {
      id: "n",
      kind: "family_request",
      actor: null,
      subjectId: "x",
      data: {},
    } as unknown as Notice;
    expect(noticeHref(notice)).toBe("/family");
  });
});
