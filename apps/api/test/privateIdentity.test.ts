import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

type User = Awaited<ReturnType<typeof h.user>>;
const v1 = "/api/v1";
const game = "PPSA01234";
const secretName = "Selin Kaya";
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

const picture = (side: number, color = "#ff0000") =>
  sharp({ create: { width: side, height: side, channels: 3, background: color } })
    .png()
    .toBuffer();

async function befriend(a: User, b: User) {
  await h.call("POST", `${v1}/me/friends/requests`, { handle: b.handle }, a.token);
  await h.call("POST", `${v1}/me/friends/requests/${a.id}/accept`, {}, b.token);
}

async function put(path: string, token: string, bytes: Uint8Array) {
  const response = await h.app.request(`${v1}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
    body: new Uint8Array(bytes),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const fetchUrl = (url: string) => {
  const parsed = new URL(url);
  return h.app.request(parsed.pathname + parsed.search);
};

async function listen(userId: string) {
  const events = h.valkey.duplicate();
  const heard: { type: string; data: unknown }[] = [];
  await events.subscribe(`user:${userId}`);
  events.on("message", (_channel, message) => heard.push(JSON.parse(message)));
  return { heard, stop: () => events.disconnect() };
}

/** Mira has a private name and picture; Fen is her friend; Sam is not, but both know Hub. */
async function scene() {
  const mira = await h.user("mira@example.com");
  const fen = await h.user("fen@example.com");
  const sam = await h.user("sam@example.com");
  const hub = await h.user("hub@example.com");
  await befriend(mira, fen);
  await befriend(hub, mira);
  await befriend(hub, sam);
  expect((await put("/me/avatar", mira.token, await picture(64, "#00ff00"))).status).toBe(200);
  const set = await h.call("PATCH", `${v1}/me/profile`, { privateName: secretName }, mira.token);
  expect(set.status).toBe(200);
  const uploaded = await put("/me/avatar/private", mira.token, await picture(64));
  expect(uploaded.status).toBe(200);
  const privateAvatar = uploaded.body.privateAvatar as string;
  const hash = privateAvatar.match(/avatars\/private\/([0-9a-f]{32})\.jpg/)?.[1] as string;
  expect(hash).toBeTruthy();
  /** Whether anything private of Mira's is in an answer. */
  /** Whether anything private of Mira's is in an answer: her private name or picture anywhere, or
   *  the private keys on a card of hers (even empty). */
  const leaks = (body: unknown) => {
    const text = JSON.stringify(body ?? null);
    if (text.includes(secretName) || text.includes(hash)) return true;
    const cardLeaks = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(cardLeaks);
      if (!value || typeof value !== "object") return false;
      const card = value as Record<string, unknown>;
      if (
        (card.userId === mira.id || card.handle === mira.handle) &&
        ("privateName" in card || "privateAvatar" in card)
      )
        return true;
      return Object.values(card).some(cardLeaks);
    };
    return cardLeaks(body);
  };
  return { mira, fen, sam, hub, hash, privateAvatar, leaks };
}

const miraIn = (list: { userId?: string; handle?: string }[], mira: User) =>
  list.find((p) => p.userId === mira.id || p.handle === mira.handle) as
    | { privateName?: string | null; privateAvatar?: string | null }
    | undefined;

describe("private name and picture: settings", () => {
  it("are set, shown to the owner, cleared, and checked like the public ones", async () => {
    const { mira, privateAvatar, hash } = await scene();
    const me = await h.call("GET", `${v1}/me`, undefined, mira.token);
    expect(me.body.profile).toMatchObject({ privateName: secretName, privateAvatar: expect.any(String) });
    expect(me.body.profile.avatar).not.toContain(hash);

    // The private picture only opens through its signed link, never at the public address.
    const opened = await fetchUrl(privateAvatar);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-type")).toBe("image/jpeg");
    expect(opened.headers.get("cache-control")).toMatch(/^private/);
    expect((await h.app.request(`${v1}/avatars/${hash}.jpg`)).status).toBe(404);
    const tampered = privateAvatar.replace(/s=[^&]+/, "s=AAAA");
    expect((await fetchUrl(tampered)).status).toBe(403);
    expect((await h.app.request(`${v1}/avatars/private/${hash}.jpg`)).status).toBe(403);

    // The same upload checks as the public picture.
    expect(
      (await put("/me/avatar/private", mira.token, new TextEncoder().encode("not a picture"))).status,
    ).toBe(415);
    expect((await put("/me/avatar/private", mira.token, await picture(8))).status).toBe(400);
    expect(
      (await h.call("PATCH", `${v1}/me/profile`, { privateName: "see cats.com" }, mira.token)).status,
    ).toBe(400);
    expect(
      (await h.call("PATCH", `${v1}/me/profile`, { privateName: "x".repeat(41) }, mira.token)).status,
    ).toBe(400);

    // A new public picture leaves the private one alone, and the other way round.
    expect((await put("/me/avatar", mira.token, await picture(80, "#0000ff"))).status).toBe(200);
    expect((await fetchUrl(privateAvatar)).status).toBe(200);
    const publicAvatar = (await h.call("GET", `${v1}/me`, undefined, mira.token)).body.profile.avatar;
    const second = await put("/me/avatar/private", mira.token, await picture(72, "#ffff00"));
    expect(second.status).toBe(200);
    expect((await fetchUrl(privateAvatar)).status).toBe(404);
    expect((await fetchUrl(publicAvatar)).status).toBe(200);

    // Cleared: an empty name or null, and DELETE for the picture.
    expect(
      (await h.call("PATCH", `${v1}/me/profile`, { privateName: "" }, mira.token)).body.privateName,
    ).toBeNull();
    expect((await h.call("DELETE", `${v1}/me/avatar/private`, undefined, mira.token)).status).toBe(204);
    expect((await fetchUrl(second.body.privateAvatar)).status).toBe(404);
    expect((await fetchUrl(publicAvatar)).status).toBe(200);
    const cleared = await h.call("GET", `${v1}/me`, undefined, mira.token);
    expect(cleared.body.profile).toMatchObject({ privateName: null, privateAvatar: null });
  });

  it("a muted account cannot set a private name, but can clear it", async () => {
    const { mira } = await scene();
    await run(["mute", "@mira"], h.deps);
    expect((await h.call("PATCH", `${v1}/me/profile`, { privateName: "New" }, mira.token)).status).toBe(403);
    expect((await h.call("PATCH", `${v1}/me/profile`, { privateName: null }, mira.token)).status).toBe(200);
  });
});

describe("private name and picture: friends see them", () => {
  it("in the friends list, the profile, search and someone's friends list, next to the handle", async () => {
    const { mira, fen, hub } = await scene();
    const friends = await h.call("GET", `${v1}/me/friends`, undefined, fen.token);
    const shown = miraIn(friends.body.friends, mira);
    expect(shown).toMatchObject({ handle: mira.handle, privateName: secretName });
    expect(shown?.privateAvatar).toMatch(/\/avatars\/private\//);
    expect((await fetchUrl(shown?.privateAvatar as string)).status).toBe(200);

    const profile = await h.call("GET", `${v1}/users/${mira.handle}`, undefined, fen.token);
    expect(profile.body).toMatchObject({ handle: mira.handle, privateName: secretName });
    const found = await h.call("GET", `${v1}/users/search?q=${mira.handle}`, undefined, fen.token);
    expect(miraIn(found.body.users, mira)).toMatchObject({ privateName: secretName });
    // Hub's friends list, read by Fen: Mira is Fen's friend, so Fen sees her private name there.
    await h.call("PATCH", `${v1}/me/privacy`, { friends: "everyone" }, hub.token);
    await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: true }, hub.token);
    const theirs = await h.call("GET", `${v1}/users/${hub.handle}/friends`, undefined, fen.token);
    expect(miraIn(theirs.body.friends, mira)).toMatchObject({ privateName: secretName });
    // A friend without a private name shows both as null.
    expect(miraIn(friends.body.friends, mira)).toBeTruthy();
    const back = await h.call("GET", `${v1}/me/friends`, undefined, mira.token);
    expect(miraIn(back.body.friends, fen)).toMatchObject({ privateName: null, privateAvatar: null });
  });

  it("stop being returned when the friendship ends or someone blocks", async () => {
    const { mira, fen, hub, leaks } = await scene();
    await h.call("DELETE", `${v1}/me/friends/${mira.id}`, undefined, fen.token);
    expect(leaks((await h.call("GET", `${v1}/users/${mira.handle}`, undefined, fen.token)).body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/me/friends`, undefined, fen.token)).body)).toBe(false);

    expect(leaks((await h.call("GET", `${v1}/users/${mira.handle}`, undefined, hub.token)).body)).toBe(true);
    await h.call("POST", `${v1}/me/blocks`, { userId: mira.id }, hub.token);
    expect((await h.call("GET", `${v1}/users/${mira.handle}`, undefined, hub.token)).status).toBe(404);
    expect(leaks((await h.call("GET", `${v1}/me/friends`, undefined, hub.token)).body)).toBe(false);
  });
});

describe("private name and picture: never for anyone else", () => {
  it("search, which never matches a private name either", async () => {
    const { mira, sam, fen, leaks } = await scene();
    const found = await h.call("GET", `${v1}/users/search?q=${mira.handle}`, undefined, sam.token);
    expect(found.body.users).toHaveLength(1);
    expect(leaks(found.body)).toBe(false);
    for (const user of [sam, fen])
      expect((await h.call("GET", `${v1}/users/search?q=Selin`, undefined, user.token)).body.users).toEqual(
        [],
      );
  });

  it("public profiles, signed in or not, and their showcase and activity", async () => {
    const { mira, sam, leaks } = await scene();
    await h.call("PATCH", `${v1}/me/privacy`, { library: "everyone", trophies: "everyone" }, mira.token);
    await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: true }, mira.token);
    for (const token of [sam.token, undefined]) {
      for (const path of ["", "/showcase", "/activity", "/library", "/trophies"]) {
        const answer = await h.call("GET", `${v1}/users/${mira.handle}${path}`, undefined, token);
        expect(answer.status, path).toBe(200);
        expect(leaks(answer.body), `${path} ${token ? "signed in" : "signed out"}`).toBe(false);
      }
    }
  });

  it("party members", async () => {
    const { mira, sam, hub, leaks } = await scene();
    const party = (await h.call("POST", `${v1}/parties`, {}, hub.token)).body.id as string;
    await h.call("POST", `${v1}/parties/${party}/invites`, { userIds: [mira.id, sam.id] }, hub.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, mira.token);
    const joined = await h.call("POST", `${v1}/parties/${party}/join`, {}, sam.token);
    expect(joined.body.members).toHaveLength(3);
    expect(leaks(joined.body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/me/party`, undefined, sam.token)).body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/parties/${party}`, undefined, sam.token)).body)).toBe(false);
    // Hub is Mira's friend and sees them in the same party.
    const hubView = await h.call("GET", `${v1}/me/party`, undefined, hub.token);
    expect(miraIn(hubView.body.party.members, mira)).toMatchObject({ privateName: secretName });
  });

  it("Play Together members", async () => {
    const { mira, sam, hub, leaks } = await scene();
    const party = (await h.call("POST", `${v1}/parties`, {}, mira.token)).body.id as string;
    await befriend(mira, sam);
    await h.call("POST", `${v1}/parties/${party}/invites`, { userIds: [sam.id] }, mira.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, sam.token);
    await h.call("DELETE", `${v1}/me/friends/${mira.id}`, undefined, sam.token);
    const lan = {
      kind: "lan",
      titleId: game,
      gameVersion: "01.000.000",
      engineBuild: "0.2.21-1",
      capacity: 4,
    };
    const started = await h.call("POST", `${v1}/game-sessions`, lan, mira.token);
    expect(started.status).toBe(201);
    const id = started.body.id as string;
    const joined = await h.call(
      "POST",
      `${v1}/game-sessions/${id}/join`,
      { gameVersion: lan.gameVersion, engineBuild: lan.engineBuild },
      sam.token,
    );
    expect(leaks(joined.body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/game-sessions/${id}`, undefined, sam.token)).body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/me/game-session`, undefined, sam.token)).body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/me/party`, undefined, sam.token)).body)).toBe(false);
    expect(hub).toBeTruthy();
  });

  it("messages and conversation members", async () => {
    const { mira, sam, hub, leaks } = await scene();
    const chat = await h.call(
      "POST",
      `${v1}/conversations`,
      { members: [mira.id, sam.id], group: true, title: "Co-op" },
      hub.token,
    );
    expect(chat.status).toBe(201);
    const id = chat.body.id as string;
    await h.call(
      "POST",
      `${v1}/conversations/${id}/messages`,
      { clientId: crypto.randomUUID(), text: "hi all" },
      mira.token,
    );
    for (const path of ["/me/conversations", `/conversations/${id}`, `/conversations/${id}/messages`]) {
      const answer = await h.call("GET", `${v1}${path}`, undefined, sam.token);
      expect(answer.status, path).toBe(200);
      expect(leaks(answer.body), path).toBe(false);
    }
    const hubView = await h.call("GET", `${v1}/conversations/${id}`, undefined, hub.token);
    expect(miraIn(hubView.body.members, mira)).toMatchObject({ privateName: secretName });
  });

  it("community lists and members", async () => {
    const { mira, sam, leaks } = await scene();
    const made = await h.call(
      "POST",
      `${v1}/communities`,
      { name: "Cat Questers", titleId: game, icon: "pad-cosmic", description: "Paws up." },
      mira.token,
    );
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    expect((await h.call("POST", `${v1}/communities/${id}/join`, {}, sam.token)).status).toBe(200);
    for (const path of [
      `/communities?titleId=${game}`,
      "/me/communities",
      `/communities/${id}`,
      `/communities/${id}/members`,
      `/conversations/${made.body.conversationId}`,
    ]) {
      const answer = await h.call("GET", `${v1}${path}`, undefined, sam.token);
      expect(answer.status, path).toBe(200);
      expect(leaks(answer.body), path).toBe(false);
    }
  });

  it("feeds, discovery and leaderboards", async () => {
    const { mira, sam, leaks } = await scene();
    await h.call("PATCH", `${v1}/me/privacy`, { library: "everyone", trophies: "everyone" }, mira.token);
    await h.call("PATCH", `${v1}/me/public-profile`, { publicProfile: true }, mira.token);
    // Mira plays and earns a trophy, so she is in the lists and her activity has something.
    await h.call("PUT", `${v1}/games/${game}`, { names: { en: "Stray" } }, mira.token);
    await h.call(
      "PUT",
      `${v1}/trophy-sets/${game}/set1`,
      { trophies: [{ id: 0, grade: "bronze", texts: { en: { name: "Meow" } } }] },
      mira.token,
    );
    await h.call(
      "POST",
      `${v1}/me/trophies`,
      { trophies: [{ titleId: game, setHash: "set1", trophyId: 0, earnedAt: new Date().toISOString() }] },
      mira.token,
    );
    await h.deps.db.execute(sql`insert into library (account_id, title_id, last_played_at, seconds_played)
      values (${mira.id}, ${game}, now() - interval '1 hour', 3600)
      on conflict (account_id, title_id) do update set last_played_at = excluded.last_played_at`);
    const players = await h.call("GET", `${v1}/discover/players?titleId=${game}`, undefined, sam.token);
    expect(JSON.stringify(players.body)).toContain(mira.id);
    const activity = await h.call("GET", `${v1}/users/${mira.handle}/activity`, undefined, sam.token);
    expect(activity.body.items.length).toBeGreaterThan(0);
    for (const path of [
      "/me/feed",
      `/users/${mira.handle}/activity`,
      `/discover/players?titleId=${game}`,
      "/discover/suggestions",
      "/leaderboards/points",
      `/games/${game}/hub`,
    ]) {
      const answer = await h.call("GET", `${v1}${path}`, undefined, sam.token);
      expect(answer.status, path).toBe(200);
      expect(leaks(answer.body), path).toBe(false);
    }
  });

  it("realtime events, even to friends", async () => {
    const { mira, sam, fen, hub, leaks } = await scene();
    const samHears = await listen(sam.id);
    const fenHears = await listen(fen.id);
    const party = (await h.call("POST", `${v1}/parties`, {}, hub.token)).body.id as string;
    await h.call("POST", `${v1}/parties/${party}/invites`, { userIds: [mira.id, sam.id] }, hub.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, sam.token);
    await h.call("POST", `${v1}/parties/${party}/join`, {}, mira.token);
    await h.call("PATCH", `${v1}/me/profile`, { privateName: "Selin Kaya Two" }, mira.token);
    await put("/me/avatar/private", mira.token, await picture(64, "#123456"));
    const chat = await h.call("POST", `${v1}/conversations`, { members: [fen.id] }, mira.token);
    await h.call(
      "POST",
      `${v1}/conversations/${chat.body.id}/messages`,
      { clientId: crypto.randomUUID(), text: "hey" },
      mira.token,
    );
    await settle();
    expect(samHears.heard.length).toBeGreaterThan(0);
    expect(fenHears.heard.length).toBeGreaterThan(0);
    expect(leaks(samHears.heard)).toBe(false);
    expect(leaks(fenHears.heard)).toBe(false);
    samHears.stop();
    fenHears.stop();
  });

  it("admin and moderation views", async () => {
    const { mira, sam, leaks } = await scene();
    await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "user", targetId: mira.id, reason: "spam" },
      sam.token,
    );
    const boss = await h.user("boss@example.com");
    await run(["grant", "@boss"], h.deps);
    const queue = await h.call("GET", `${v1}/admin/reports`, undefined, boss.token);
    expect(queue.body.reports).toHaveLength(1);
    expect(leaks(queue.body)).toBe(false);
    expect(leaks((await h.call("GET", `${v1}/admin/users?q=@mira`, undefined, boss.token)).body)).toBe(false);
    // The admin's own signed-in views treat the admin as anyone else.
    expect(leaks((await h.call("GET", `${v1}/users/${mira.handle}`, undefined, boss.token)).body)).toBe(
      false,
    );
  });

  it("data export: the owner's own fields, never a friend's", async () => {
    const { mira, fen, sam, leaks } = await scene();
    const exportOf = async (user: User) => {
      const response = await h.app.request(`${v1}/me/export`, {
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(response.status).toBe(200);
      return JSON.parse(await response.text());
    };
    for (const user of [fen, sam]) expect(leaks(await exportOf(user))).toBe(false);
    const own = await exportOf(mira);
    expect(own.profile).toMatchObject({ privateName: secretName });
    expect(own.privateAvatar).toMatch(/^data:image\/jpeg;base64,/);
    expect(own.avatar).toMatch(/^data:image\/jpeg;base64,/);
    expect(own.avatar).not.toBe(own.privateAvatar);
  });
});

describe("private name and picture: moderation", () => {
  it("a friend reports them; moderators see what was reported and can reset either", async () => {
    const { mira, fen, sam, hash } = await scene();
    const report = (user: User) =>
      h.call(
        "POST",
        `${v1}/reports`,
        { targetKind: "private_profile", targetId: mira.id, reason: "sexual" },
        user.token,
      );
    expect((await report(sam)).status).toBe(404);
    expect((await report(mira)).status).toBe(400);
    expect((await report(fen)).status).toBe(201);

    const boss = await h.user("boss@example.com");
    await run(["grant", "@boss"], h.deps);
    const queue = await h.call("GET", `${v1}/admin/reports`, undefined, boss.token);
    const [item] = queue.body.reports;
    expect(item).toMatchObject({
      targetKind: "private_profile",
      target: { userId: mira.id, handle: mira.handle },
      privateProfile: { name: secretName, avatar: expect.stringContaining(hash), current: true },
    });
    // The person card itself stays public-only.
    expect(JSON.stringify(item.target)).not.toContain(secretName);
    expect((await fetchUrl(item.privateProfile.avatar)).status).toBe(200);

    const acted = await h.call(
      "POST",
      `${v1}/admin/reports/${item.id}`,
      { action: "reset_private_avatar" },
      boss.token,
    );
    expect(acted.status).toBe(200);
    expect((await fetchUrl(item.privateProfile.avatar)).status).toBe(404);
    const me = await h.call("GET", `${v1}/me`, undefined, mira.token);
    expect(me.body.profile).toMatchObject({ privateName: secretName, privateAvatar: null });
    expect(me.body.profile.avatar).toBeTruthy();

    expect((await report(fen)).status).toBe(201);
    const next = (await h.call("GET", `${v1}/admin/reports`, undefined, boss.token)).body.reports[0];
    expect(next.privateProfile).toMatchObject({ name: secretName, avatar: null });
    await h.call("POST", `${v1}/admin/reports/${next.id}`, { action: "reset_private_name" }, boss.token);
    expect((await h.call("GET", `${v1}/me`, undefined, mira.token)).body.profile.privateName).toBeNull();

    // A public-avatar reset never touches the private picture, and the other way round.
    const again = await put("/me/avatar/private", mira.token, await picture(64, "#abcdef"));
    await h.call(
      "POST",
      `${v1}/reports`,
      { targetKind: "user", targetId: mira.id, reason: "spam" },
      fen.token,
    );
    const userReport = (await h.call("GET", `${v1}/admin/reports`, undefined, boss.token)).body.reports[0];
    await h.call("POST", `${v1}/admin/reports/${userReport.id}`, { action: "reset_avatar" }, boss.token);
    expect((await fetchUrl(again.body.privateAvatar)).status).toBe(200);
    expect((await h.call("GET", `${v1}/me`, undefined, mira.token)).body.profile.avatar).toBeNull();
  });
});
