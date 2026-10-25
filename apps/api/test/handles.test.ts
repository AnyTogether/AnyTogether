import { readFileSync, readdirSync } from "node:fs";
import { handleSkeleton, looksReserved } from "@anytogether/shared";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const v1 = "/api/v1";
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
/** This branch's migration, as production runs it. */
const migration = () => {
  const folder = new URL("../../../packages/db/drizzle/", import.meta.url);
  const name = readdirSync(folder).find((file) => file.startsWith("0012_"));
  return readFileSync(new URL(name ?? "missing", folder), "utf8");
};

describe("handle skeletons", () => {
  it("folds what only looks different", () => {
    const same: [string, string][] = [
      ["utku", "Utku"],
      ["utku", "ut.ku"],
      ["utku", "u_t_k_u"],
      ["utku", "ＵＴＫＵ"], // full-width
      ["utku", "υtkυ"], // Greek upsilon
      ["admin", "аdmin"], // Cyrillic а
      ["admin", "ADMİN"], // Turkish dotted capital I
      ["admin", "admın"], // Turkish dotless i
      ["admin", "adm1n"],
      ["admin", "admln"],
      ["paypal", "paypa1"],
      ["paypal", "РАУРАL"], // Cyrillic capitals
      ["kralo", "kral0"],
      ["mod", "rnod"],
      ["wolf", "vvolf"],
      ["down", "clown"],
      ["sniper", "5niper"],
      ["ismail", "İsmail"],
      ["ismail", "ısmaıl"],
      ["cafe", "café"],
      ["cafe", "café"], // a combining accent
    ];
    for (const [a, b] of same) expect(handleSkeleton(b), `${a} / ${b}`).toBe(handleSkeleton(a));
    // Cyrillic р is a Latin p: "мерт" reads as "mept", not "mert".
    expect(handleSkeleton("мерт")).toBe(handleSkeleton("mept"));

    const different: [string, string][] = [
      ["kral1", "kral2"],
      ["utku", "utka"],
      ["ayse", "ayse2"],
      ["mert", "merr"],
      ["player", "players"],
    ];
    for (const [a, b] of different) expect(handleSkeleton(b), `${a} / ${b}`).not.toBe(handleSkeleton(a));
  });

  it("finds look-alikes of reserved names", () => {
    for (const handle of ["adm1n", "rnod", "supp0rt", "anyps5_tearn", "0fficial.news", "sy5tem"])
      expect(looksReserved(handle), handle).toBe(true);
    for (const handle of ["utku", "kral", "ayse", "modern.art"])
      expect(looksReserved(handle), handle).toBe(false);
  });

  it("matches the SQL that fills in existing handles", async () => {
    const handles = [
      "utku",
      "kral.0",
      "i_l_1",
      "rn.rn",
      "vvv",
      "clcl",
      "s5s",
      "a.b_c",
      "x1i0o",
      "bc1d",
      "mrnm",
    ];
    const text = migration();
    const expression = text.match(/SET "skeleton" = (replace\(.*\));/)?.[1];
    expect(expression).toBeTruthy();
    const rows = await h.deps.db.execute<{ handle: string; skeleton: string }>(sql`
      select h handle, ${sql.raw((expression as string).replace("handle::text", "h"))} skeleton
      from unnest(${`{${handles.join(",")}}`}::text[]) h`);
    for (const row of rows) expect(row.skeleton, row.handle).toBe(handleSkeleton(row.handle));
  });

  it("gives an old look-alike pair's skeleton to the older account only", async () => {
    const older = await h.user("older@example.com");
    const newer = await h.user("newer@example.com");
    await h.deps.db.execute(
      sql`update profiles set handle = 'kral0', handle_skeleton = null where account_id = ${older.id}`,
    );
    await h.deps.db.execute(
      sql`update profiles set handle = 'kralo', handle_skeleton = null where account_id = ${newer.id}`,
    );
    const text = migration();
    const backfill = text.slice(
      text.indexOf('UPDATE "profiles"'),
      text.indexOf("--> statement-breakpoint", text.indexOf('UPDATE "profiles"')),
    );
    await h.deps.db.execute(sql.raw(backfill));
    const rows = await h.deps.db.execute<{ handle: string; handle_skeleton: string | null }>(
      sql`select handle, handle_skeleton from profiles where handle like 'kral%' order by handle`,
    );
    expect(rows.map((r) => [r.handle, r.handle_skeleton])).toEqual([
      ["kral0", "kralo"],
      ["kralo", null],
    ]);
  });
});

describe("look-alike handles", () => {
  it("refuses a handle that looks like someone else's, a held one or a reserved name", async () => {
    const utku = await h.user("utku@example.com");
    const ayse = await h.user("ayse@example.com");
    const mert = await h.user("mert@example.com");
    const change = (who: typeof utku, handle: string) =>
      h.call("PATCH", `${v1}/me/handle`, { handle }, who.token);

    for (const handle of ["ay.se", "ayse_", "a_y_s_e"]) {
      const refused = await change(utku, handle);
      expect(refused.status, handle).toBe(409);
      expect(refused.body.code, handle).toBe("handle_too_similar");
    }
    for (const handle of ["adm1n", "rnod", "supp0rt"])
      expect((await change(utku, handle)).body.code, handle).toBe("handle_too_similar");
    // Exact matches keep their own codes.
    expect((await change(utku, "ayse")).body.code).toBe("handle_taken");
    expect((await change(utku, "admin")).body.code).toBe("handle_reserved");

    // A look-alike of one's own handle is fine.
    const own = await change(utku, "ut.ku");
    expect(own.status).toBe(200);
    expect(own.body.handle).toBe("ut.ku");

    // Mert gives up "mert"; for 30 days nobody takes it or a look-alike, then it is free.
    expect((await change(mert, "kral")).status).toBe(200);
    expect((await change(ayse, "mer.t")).body.code).toBe("handle_too_similar");
    await h.deps.db.execute(sql`update handle_history set released_at = ${daysAgo(31)}`);
    expect((await change(ayse, "mer.t")).status).toBe(200);
    const deniz = await h.user("deniz@example.com");
    expect((await change(deniz, "kra1")).body.code).toBe("handle_too_similar");
  });

  it("makes a new account a handle unlike anyone's", async () => {
    await h.user("ayse@example.com");
    const idToken = await h.apple.idToken(
      { sub: "a-ay-se", email: "other@example.com", email_verified: "true", name: "Ay Se" },
      "org.anyps5.launcher",
    );
    const apple = await h.call("POST", `${v1}/auth/oidc/apple`, { idToken });
    expect(apple.status).toBe(200);
    expect(apple.body.user.handle).toMatch(/^ay\.se\d{4}$/);
    const [row] = await h.deps.db.execute<{ handle_skeleton: string }>(
      sql`select handle_skeleton from profiles where account_id = ${apple.body.user.id}`,
    );
    expect(row?.handle_skeleton).toBe(handleSkeleton(apple.body.user.handle));
  });
});
