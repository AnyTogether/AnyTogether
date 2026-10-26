import { games, library, profiles } from "@anytogether/db";
import {
  type CommunityCard,
  DiscoveryUpdate,
  type DiscoveryView,
  ErrorCode,
  type MemberView,
  type SuggestionReason,
  TitleId,
  playingFreshMs,
  playingKey,
  presenceHiddenKey,
  presenceKey,
  shownPrivacy,
} from "@anytogether/shared";
import { count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { familyGuard } from "./family.js";
import { body } from "./http.js";
import type { LfgRoutes } from "./lfg.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import type { PartyService } from "./parties.js";
import { type ProfileRow, noBlockBetween, sectionSetting } from "./people.js";
import { rateLimiter } from "./ratelimit.js";
import type { SharePlayService } from "./sharePlays.js";

/** SQL: the library of `p` is open to everyone (and the public profile switch is on). */
const libraryPublicSql = sql`${sectionSetting("p", "library")} = 'everyone'`;
/** SQL: whether the profile `p` shows in discovery: what they chose, else on while their library is
 *  public. */
const discoverableSql = sql`coalesce(p.discoverable, ${libraryPublicSql})`;

/** Whether a profile shows in discovery (see discoverableSql). */
export const discoverable = (profile: Pick<ProfileRow, "discoverable" | "privacy" | "publicProfile">) =>
  profile.discoverable ?? shownPrivacy(profile.privacy, profile.publicProfile).library === "everyone";

type Friendship = "none" | "friends" | "pending_out" | "pending_in";

/** Someone in a discovery list: their card, where the asker stands with them, and their presence
 *  when they show it to everyone. */
export interface PersonCard {
  user: MemberView;
  friendship: Friendship;
  presence?: { state: string; titleId?: string };
  lastPlayedAt?: string | null;
  reasons?: SuggestionReason[];
}

const cardOf = (p: {
  account_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
}) => ({
  userId: p.account_id,
  handle: p.handle,
  displayName: p.display_name,
  avatar: p.avatar_url,
});

/** Finding people beyond one's friends: who plays a game, people one may know, a game's hub, and the
 *  "show me in discovery" setting. Only people who are discoverable appear, never anyone with a
 *  block either way, and what a card says follows the person's privacy settings. */
export function discoverRoutes(
  deps: Deps,
  pieces: {
    lfg: LfgRoutes;
    parties: PartyService;
    shares: SharePlayService;
    /** Public communities of a game (left out of the hub without it). */
    communities?: (me: string, titleId: string) => Promise<CommunityCard[]>;
  },
) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db, valkey } = deps;
  const limit = rateLimiter(valkey, deps.limits);
  const family = familyGuard(db);
  const noDiscovery = "Your family settings keep discovery off";

  const own = async (me: string) => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.accountId, me));
    if (!profile) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return profile;
  };
  const discoveryView = (profile: ProfileRow): DiscoveryView => ({
    discoverable: discoverable(profile),
    chosen: profile.discoverable,
    languages: profile.languages,
  });

  app.get("/me/discovery", async (c) => c.json(discoveryView(await own(c.get("userId")))));

  app.patch("/me/discovery", async (c) => {
    const me = c.get("userId");
    await limit("profile", me);
    const input = await body(c, DiscoveryUpdate);
    if (input.discoverable) await family.need(me, "discovery", noDiscovery);
    await db
      .update(profiles)
      .set({
        ...(input.discoverable !== undefined ? { discoverable: input.discoverable } : {}),
        ...(input.languages !== undefined ? { languages: input.languages } : {}),
      })
      .where(eq(profiles.accountId, me));
    return c.json(discoveryView(await own(me)));
  });

  /** Where the asker stands with each of these people. */
  async function friendshipsWith(me: string, ids: string[]) {
    const result = new Map<string, Friendship>();
    if (!ids.length) return result;
    const rows = await db.execute<{ user_a: string; user_b: string; state: string; asked_by: string }>(sql`
      select user_a, user_b, state, asked_by from friendships
      where (user_a = ${me}::uuid and user_b in ${ids})
        or (user_b = ${me}::uuid and user_a in ${ids})`);
    for (const r of rows) {
      const other = r.user_a === me ? r.user_b : r.user_a;
      result.set(
        other,
        r.state === "accepted" ? "friends" : r.asked_by === me ? "pending_out" : "pending_in",
      );
    }
    return result;
  }

  /** Presence of people who show it to everyone and do not appear offline. */
  async function publicPresence(rows: { account_id: string; privacy: unknown; public_profile: boolean }[]) {
    const shown = rows.filter((r) => shownPrivacy(r.privacy, r.public_profile).presence === "everyone");
    const kept = shown.length
      ? await valkey.mget(
          ...shown.flatMap((r) => [presenceKey(r.account_id), presenceHiddenKey(r.account_id)]),
        )
      : [];
    const result = new Map<string, { state: string; titleId?: string }>();
    shown.forEach((r, index) => {
      const raw = kept[index * 2];
      if (!raw || kept[index * 2 + 1]) return;
      const { state, titleId } = JSON.parse(raw) as { state: string; titleId?: string };
      result.set(r.account_id, { state, ...(titleId ? { titleId } : {}) });
    });
    return result;
  }

  type PersonRow = {
    account_id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
    privacy: unknown;
    public_profile: boolean;
  };

  async function cards(
    me: string,
    rows: PersonRow[],
    extra: (row: PersonRow) => Partial<PersonCard> = () => ({}),
  ) {
    const ids = rows.map((r) => r.account_id);
    const [standing, presence] = await Promise.all([friendshipsWith(me, ids), publicPresence(rows)]);
    return rows.map(
      (r): PersonCard => ({
        user: cardOf(r),
        friendship: standing.get(r.account_id) ?? "none",
        ...(presence.has(r.account_id) ? { presence: presence.get(r.account_id) } : {}),
        ...extra(r),
      }),
    );
  }

  /** People who play a game and show their library to everyone, the most recently played first. */
  async function playersOf(me: string, titleId: string, max = 30) {
    const rows = await db.execute<PersonRow & { last_played_at: Date | null }>(sql`
      select p.account_id, p.handle, p.display_name, p.avatar_url, p.privacy, p.public_profile, l.last_played_at
      from library l
      join profiles p on p.account_id = l.account_id
      join accounts a on a.id = l.account_id and a.status = 'active'
      where l.title_id = ${titleId} and l.account_id <> ${me}::uuid
        and ${libraryPublicSql} and ${discoverableSql}
        and ${noBlockBetween(me, sql`l.account_id`)}
      order by l.last_played_at desc nulls last, l.account_id
      limit ${max}`);
    return cards(me, [...rows], (r) => ({
      lastPlayedAt: (r as PersonRow & { last_played_at: Date | string | null }).last_played_at
        ? new Date((r as PersonRow & { last_played_at: Date | string }).last_played_at).toISOString()
        : null,
    }));
  }

  const titleParam = (raw: string | undefined) => {
    const parsed = TitleId.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, ErrorCode.badRequest, "titleId: a title ID like PPSA01234");
    return parsed.data;
  };

  /** "Players of <game>". */
  app.get("/discover/players", async (c) => {
    const me = c.get("userId");
    const titleId = titleParam(c.req.query("titleId"));
    await family.need(me, "discovery", noDiscovery);
    await limit("discover", me);
    return c.json({ players: await playersOf(me, titleId) });
  });

  /** People the asker may know or want to play with: friends in common (through friends who show
   *  their friends list to them), games both play (only with a public library), a shared language.
   *  Friends, pending requests and blocks are left out. */
  app.get("/discover/suggestions", async (c) => {
    const me = c.get("userId");
    await family.need(me, "discovery", noDiscovery);
    await limit("discover", me);
    const mine = await own(me);
    const notConnected = (column: ReturnType<typeof sql>) => sql`${column} <> ${me}::uuid
      and not exists (select 1 from friendships f where (f.user_a = ${me}::uuid and f.user_b = ${column})
        or (f.user_b = ${me}::uuid and f.user_a = ${column}))
      and ${noBlockBetween(me, column)}`;

    const viaFriends = await db.execute<{ cand: string; n: number }>(sql`
      with mine as (
        select case when user_a = ${me}::uuid then user_b else user_a end id from friendships
        where state = 'accepted' and (user_a = ${me}::uuid or user_b = ${me}::uuid)),
      shown as (
        select m.id from mine m join profiles fp on fp.account_id = m.id
        where coalesce(fp.privacy->>'friends', 'friends') <> 'nobody'),
      fof as (
        select case when f.user_a = s.id then f.user_b else f.user_a end cand, s.id via
        from friendships f join shown s on f.user_a = s.id or f.user_b = s.id
        where f.state = 'accepted')
      select cand, count(distinct via)::int n from fof
      join profiles p on p.account_id = fof.cand
      join accounts a on a.id = fof.cand and a.status = 'active'
      where ${notConnected(sql`fof.cand`)} and ${discoverableSql}
      group by cand order by n desc limit 100`);

    const viaGames = await db.execute<{ cand: string; title_id: string }>(sql`
      with recent as (
        select title_id from library where account_id = ${me}::uuid
        order by last_played_at desc nulls last limit 10)
      select l.account_id cand, l.title_id from library l
      join recent r on r.title_id = l.title_id
      join profiles p on p.account_id = l.account_id
      join accounts a on a.id = l.account_id and a.status = 'active'
      where ${notConnected(sql`l.account_id`)} and ${libraryPublicSql} and ${discoverableSql}
      order by l.last_played_at desc nulls last limit 300`);

    const languages = mine.languages;
    const viaLanguage = languages.length
      ? await db.execute<{ cand: string; languages: string[] }>(sql`
          select p.account_id cand, p.languages from profiles p
          join accounts a on a.id = p.account_id and a.status = 'active'
          where p.languages ?| array[${sql.join(
            languages.map((language) => sql`${language}`),
            sql`, `,
          )}]::text[] and ${notConnected(sql`p.account_id`)} and ${discoverableSql}
            and exists (select 1 from library l where l.account_id = p.account_id
              and l.last_played_at > now() - interval '30 days')
          limit 50`)
      : [];

    const score = new Map<string, { points: number; reasons: SuggestionReason[] }>();
    const entry = (id: string) => {
      const found = score.get(id) ?? { points: 0, reasons: [] };
      score.set(id, found);
      return found;
    };
    for (const row of viaFriends) {
      const found = entry(row.cand);
      found.points += 3 * Number(row.n);
      found.reasons.push({ kind: "friends", count: Number(row.n) });
    }
    const titleNames = new Map<string, Record<string, string>>();
    const titles = [...new Set([...viaGames].map((r) => r.title_id))];
    if (titles.length)
      for (const g of await db.execute<{ title_id: string; names: Record<string, string> }>(
        sql`select title_id, names from games where title_id in ${titles}`,
      ))
        titleNames.set(g.title_id, g.names);
    for (const row of viaGames) {
      const found = entry(row.cand);
      if (found.reasons.filter((r) => r.kind === "game").length >= 3) continue;
      found.points += 2;
      found.reasons.push({ kind: "game", titleId: row.title_id, names: titleNames.get(row.title_id) ?? {} });
    }
    for (const row of viaLanguage) {
      const shared = row.languages.find((l) => languages.includes(l));
      if (!shared) continue;
      const found = entry(row.cand);
      found.points += 1;
      found.reasons.push({ kind: "language", language: shared });
    }
    const top = [...score.entries()]
      .sort((a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0]))
      .slice(0, 20);
    if (!top.length) return c.json({ suggestions: [] });
    const rows = await db.execute<PersonRow>(sql`
      select account_id, handle, display_name, avatar_url, privacy, public_profile from profiles
      where account_id in ${top.map(([id]) => id)}`);
    const byId = new Map([...rows].map((r) => [r.account_id, r]));
    const ordered = top.flatMap(([id]) => (byId.has(id) ? [byId.get(id) as PersonRow] : []));
    return c.json({
      suggestions: await cards(me, ordered, (r) => ({ reasons: score.get(r.account_id)?.reasons ?? [] })),
    });
  });

  /** Who plays a game right now and shows it to everyone, from the gateway's playing sets. */
  async function playingNow(me: string, titleId: string, max = 24) {
    const key = playingKey(titleId);
    const fresh = Date.now() - playingFreshMs;
    await valkey.zremrangebyscore(key, 0, fresh);
    const ids = (await valkey.zrevrangebyscore(key, "+inf", fresh, "LIMIT", 0, 200)).filter(
      (id) => id !== me,
    );
    if (!ids.length) return { total: 0, people: [] as { user: MemberView; since: string | null }[] };
    const kept = await valkey.mget(...ids.map((id) => presenceKey(id)));
    const playing = new Map<string, string | null>();
    ids.forEach((id, index) => {
      const raw = kept[index];
      if (!raw) return;
      const presence = JSON.parse(raw) as { state?: string; titleId?: string; since?: string };
      if (presence.state === "in_game" && presence.titleId === titleId)
        playing.set(id, presence.since ?? null);
    });
    if (!playing.size) return { total: 0, people: [] };
    const rows = await db.execute<PersonRow>(sql`
      select p.account_id, p.handle, p.display_name, p.avatar_url, p.privacy, p.public_profile from profiles p
      join accounts a on a.id = p.account_id and a.status = 'active'
      where p.account_id in ${[...playing.keys()]}
        and ${sectionSetting("p", "presence")} = 'everyone'
        and not p.appear_offline
        and ${noBlockBetween(me, sql`p.account_id`)}`);
    const people = [...rows]
      .map((r) => ({ user: cardOf(r), since: playing.get(r.account_id) ?? null }))
      .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
    return { total: people.length, people: people.slice(0, max) };
  }

  /** One game's hub: who plays it now (public presence only), open posts, public parties and share
   *  plays, and players who show their library. Leaderboards, compatibility and themes have their
   *  own endpoints. */
  app.get("/games/:titleId/hub", async (c) => {
    const me = c.get("userId");
    const titleId = titleParam(c.req.param("titleId"));
    await limit("discover", me);
    const [game] = await db.select().from(games).where(eq(games.titleId, titleId));
    if (!game) throw new HttpError(404, ErrorCode.notFound, "No such game");
    const [players] = await db.select({ n: count() }).from(library).where(eq(library.titleId, titleId));
    // A child sees only what the family settings allow of the hub.
    const rules = await family.rulesOf(me);
    const people = !rules || rules.discovery;
    const listings = !rules || rules.publicMatchmaking;
    const [playing, posts, partyList, shareList, recent, communityList] = await Promise.all([
      people ? playingNow(me, titleId) : [],
      listings ? pieces.lfg.openPosts(me, { titleId, limit: 10 }) : { posts: [] },
      listings ? pieces.parties.publicParties(me, { titleId, limit: 10 }) : [],
      listings && (!rules || rules.sharePlay) ? pieces.shares.publicShares(me, { titleId, limit: 10 }) : [],
      people ? playersOf(me, titleId, 8) : [],
      listings && (!rules || rules.communities) && pieces.communities
        ? pieces.communities(me, titleId)
        : Promise.resolve([]),
    ]);
    return c.json({
      game: { titleId: game.titleId, names: game.names, iconUrl: game.iconUrl },
      players: players?.n ?? 0,
      playing,
      lfg: posts.posts,
      parties: partyList,
      sharePlays: shareList,
      recentPlayers: recent,
      communities: communityList,
    });
  });

  return app;
}
