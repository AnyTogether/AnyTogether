import { afterEach, describe, expect, it } from "vitest";
import { parseClientMinimums, readClient } from "../src/clientGate.js";
import { config } from "../src/config.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>> | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const friends = "/api/v1/me/friends";

describe("retiring old clients", () => {
  it("is off unless MIN_LAUNCHER_VERSION is set; entries are per platform and must be versions", () => {
    expect(config({}).clientGate).toEqual({
      minimums: {},
      downloadUrl: "http://localhost:3000/download",
    });
    expect(config({ MIN_LAUNCHER_VERSION: "  " }).clientGate.minimums).toEqual({});
    expect(
      config({
        MIN_LAUNCHER_VERSION: "macos=0.2.20, desktop=0.1.8, phone=1.16.0",
        PUBLIC_URL: "https://together.example",
      }).clientGate,
    ).toEqual({
      minimums: {
        "launcher-macos": "0.2.20",
        "launcher-windows": "0.1.8",
        "launcher-linux": "0.1.8",
        phone: "1.16.0",
      },
      downloadUrl: "https://together.example/download",
    });
    // A platform named on its own wins over desktop, whatever the order.
    expect(parseClientMinimums("linux=0.1.9,desktop=0.1.8")).toEqual({
      "launcher-windows": "0.1.8",
      "launcher-linux": "0.1.9",
    });
    expect(config({ CLIENT_DOWNLOAD_URL: "https://dl.example/get" }).clientGate.downloadUrl).toBe(
      "https://dl.example/get",
    );
    for (const bad of ["0.2.20", "macos=", "macos=v0.2", "macos=latest", "tv=1.0.0", "web=1.0.0"])
      expect(() => parseClientMinimums(bad), bad).toThrow(/MIN_LAUNCHER_VERSION/);
  });

  it("reads the AnyTogether-Client header, and nothing it cannot read", () => {
    expect(readClient("launcher-macos/0.2.13 (macOS 26.6)")).toEqual({
      kind: "launcher-macos",
      version: "0.2.13",
    });
    expect(readClient("phone/1.16.0+19 (Android 15)")).toEqual({ kind: "phone", version: "1.16.0+19" });
    for (const unread of [
      undefined,
      "",
      "garbage",
      "launcher-macos",
      "launcher-macos/",
      "launcher-macos/abc",
      "tv/1.0.0",
    ])
      expect(readClient(unread), String(unread)).toBeUndefined();
  });

  it("refuses a client below its platform's minimum with client_too_old, the minimum and where to update", async () => {
    h = await harness({
      clientGate: {
        minimums: { "launcher-macos": "0.3.0", phone: "1.16.0" },
        downloadUrl: "https://together.example/download",
      },
    });
    const me = await h.user("gate@example.com", "launcher-macos/0.3.0 (macOS 26.6)");

    for (const old of [
      "launcher-macos/0.2.13 (macOS 26.6)",
      "launcher-macos/0.2.99",
      "launcher-macos/0.0.1",
    ]) {
      const refused = await h.call("GET", friends, undefined, me.token, old);
      expect(refused.status, old).toBe(426);
      expect(refused.body).toMatchObject({
        code: "client_too_old",
        client: "launcher-macos",
        minimum: "0.3.0",
        current: old.split("/")[1]?.split(" ")[0],
        downloadUrl: "https://together.example/download",
      });
    }
    // Before signing in too: the answer is the update, not "unauthorized".
    const signedOut = await h.call("GET", friends, undefined, undefined, "phone/1.15.2 (Android 15)");
    expect(signedOut.status).toBe(426);
    expect(signedOut.body).toMatchObject({ client: "phone", minimum: "1.16.0", current: "1.15.2" });
    const signIn = await h.call(
      "POST",
      "/api/v1/auth/email/start",
      { email: "x@example.com" },
      undefined,
      "launcher-macos/0.1.0",
    );
    expect(signIn.status).toBe(426);

    for (const fine of [
      "launcher-macos/0.3.0 (macOS 26.6)",
      "launcher-macos/0.3.1",
      "launcher-macos/0.10.0",
      "launcher-macos/1.0.0",
      "phone/1.16.0+19 (Android 15)",
      // Platforms without a minimum, the website and whatever cannot be read pass.
      "launcher-windows/0.0.1 (Windows 10.0)",
      "launcher-linux/0.0.1",
      "web",
      "garbage",
      "launcher-macos/unknown",
    ]) {
      const ok = await h.call("GET", friends, undefined, me.token, fine);
      expect(ok.status, fine).toBe(200);
    }
  });

  it("an old client can still check health and find the release that replaces it", async () => {
    h = await harness({
      clientGate: {
        minimums: { "launcher-windows": "0.2.0" },
        downloadUrl: "https://together.example/download",
      },
      githubFetch: async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    });
    const old = "launcher-windows/0.1.7 (Windows 10.0)";
    expect((await h.call("GET", "/api/v1/health", undefined, undefined, old)).status).toBe(200);
    const releases = await h.call("GET", "/api/v1/releases", undefined, undefined, old);
    expect(releases.status).not.toBe(426);
    expect((await h.call("GET", friends, undefined, undefined, old)).status).toBe(426);
  });

  it("lets everyone through when no minimum is set", async () => {
    h = await harness();
    const me = await h.user("open@example.com");
    const ok = await h.call("GET", friends, undefined, me.token, "launcher-macos/0.0.1 (macOS 14.0)");
    expect(ok.status).toBe(200);
  });
});
