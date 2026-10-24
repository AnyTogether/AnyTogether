import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accounts, auditLog, profiles, themes } from "@anytogether/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { extract, readEntries, writeZip } from "../src/zip.js";
import { harness } from "./harness.js";

let h: Awaited<ReturnType<typeof harness>>;
let dir: string | undefined;
afterEach(async () => {
  await h.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const v1 = "/api/v1";
const cli = (...args: string[]) => run(args, h.deps);

/** A theme file like the old hub's: theme.json alone, or with the files given. */
const themeZip = (json: Record<string, unknown>, files: { name: string; bytes: Uint8Array }[] = []) =>
  writeZip([
    { name: "theme.json", bytes: new TextEncoder().encode(JSON.stringify(json)), deflate: true },
    ...files.map((f) => ({ ...f, deflate: true })),
  ]);

const design = (id: string, name: string, style: number, more: Record<string, unknown> = {}) => ({
  id,
  name,
  author: "AnyPS5",
  version: 1,
  style,
  deep: "#02100A",
  middle: "#0E4A2C",
  bright: "#9BFFC4",
  accent: "#5CEB9F",
  ...more,
});

/** A folder like the old GitHub hub: themes.json and themes/*.anyps5theme. */
async function hubFolder() {
  dir = await mkdtemp(join(tmpdir(), "hub-"));
  await mkdir(join(dir, "themes"));
  const still = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#FF0000" } })
    .png()
    .toBuffer();
  const files: [string, Uint8Array][] = [
    ["themes/meadow.anyps5theme", themeZip(design("meadow", "Meadow", 1))],
    ["themes/glow.anyps5theme", themeZip(design("glow", "Glow", 2, { author: "Someone Else" }))],
    [
      "themes/red.anyps5theme",
      themeZip(design("red", "Red Room", 0, { preview: "preview.png" }), [
        { name: "preview.png", bytes: still },
      ]),
    ],
    ["themes/broken.anyps5theme", new TextEncoder().encode("not a zip")],
  ];
  for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
  const index = {
    themes: [
      { id: "meadow", name: "Meadow", author: "AnyPS5", package: "themes/meadow.anyps5theme" },
      { id: "glow", name: "Glow", author: "Someone Else", package: "themes/glow.anyps5theme" },
      { id: "red", name: "Red Room", author: "AnyPS5", package: "themes/red.anyps5theme" },
      { id: "broken", name: "Broken", author: "AnyPS5", package: "themes/broken.anyps5theme" },
    ],
  };
  await writeFile(join(dir, "themes.json"), JSON.stringify(index));
  return dir;
}

describe("hub import", () => {
  it("shares the old hub's themes from @anyps5, credits who made them, and does it once", async () => {
    h = await harness();
    const folder = await hubFolder();
    const first = await cli("hub", "import", folder);
    expect(first).toContain("made the curator account @anyps5");
    expect(first).toMatch(/added “Meadow” by AnyPS5/);
    expect(first).toMatch(/added “Glow” by Someone Else/);
    expect(first).toMatch(/skipped themes\/broken\.anyps5theme: This is not a theme file/);
    expect(first).toMatch(/3 added, 0 already there, 1 failed$/);

    // The curator: reserved handle, no way to sign in, not shown in discovery.
    const [curator] = await h.deps.db
      .select({ account: accounts, profile: profiles })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(eq(profiles.handle, "anyps5"));
    expect(curator?.account).toMatchObject({ role: "curator", status: "active", email: null });
    expect(curator?.profile).toMatchObject({ displayName: "AnyPS5", discoverable: false });

    const list = await h.call("GET", `${v1}/themes?sort=new&limit=60`);
    expect(list.body.themes).toHaveLength(3);
    const byName = Object.fromEntries(
      list.body.themes.map((t: { name: string; id: string }) => [t.name, t]),
    ) as Record<
      string,
      { id: string; maker: { handle: string }; style: number; preview: string; download: string }
    >;
    expect(byName.Glow?.maker.handle).toBe("anyps5");
    expect(byName.Glow?.style).toBe(2);
    const glow = await h.call("GET", `${v1}/themes/${byName.Glow?.id}`);
    expect(glow.body.description).toBe("By Someone Else. One of the first themes on the AnyPS5 hub.");

    // A theme with no still gets one drawn from its colors; one with a still keeps it.
    for (const [name, red] of [
      ["Meadow", false],
      ["Red Room", true],
    ] as const) {
      const u = new URL(byName[name]?.preview ?? "");
      const response = await h.app.request(`${u.pathname}${u.search}`);
      expect(response.status).toBe(200);
      const still = sharp(Buffer.from(await response.arrayBuffer()));
      expect(await still.metadata()).toMatchObject({ format: "webp", width: 1280, height: 720 });
      const { dominant } = await still.stats();
      expect(dominant.r > 200 && dominant.g < 60).toBe(red);
    }

    // The file people download keeps who made it.
    const download = new URL(byName.Glow?.download ?? "");
    const file = new Uint8Array(await (await h.app.request(download.pathname)).arrayBuffer());
    const entries = readEntries(file, 64);
    const json = JSON.parse(
      new TextDecoder().decode(extract(file, entries.find((e) => e.name === "theme.json") as never)),
    );
    expect(json).toMatchObject({ id: byName.Glow?.id, author: "Someone Else", name: "Glow", version: 1 });

    // The old launchers' index lists them too, with who made them.
    const index = await h.call("GET", `${v1}/hub/themes.json`);
    const authors = Object.fromEntries(
      index.body.themes.map((t: { name: string; author: string }) => [t.name, t.author]),
    );
    expect(authors).toEqual({ Glow: "Someone Else", Meadow: "AnyPS5", "Red Room": "AnyPS5" });

    // Again: nothing new, nothing changed.
    const second = await cli("hub", "import", folder);
    expect(second).not.toContain("made the curator account");
    expect(second).toMatch(/kept “Meadow”: already on the Hub/);
    expect(second).toMatch(/0 added, 3 already there, 1 failed$/);
    expect(await h.deps.db.select({ id: themes.id }).from(themes)).toHaveLength(3);
    expect(
      await h.deps.db.select({ id: profiles.accountId }).from(profiles).where(eq(profiles.handle, "anyps5")),
    ).toHaveLength(1);
    const imported = await h.deps.db.select().from(auditLog).where(eq(auditLog.action, "theme.imported"));
    expect(imported).toHaveLength(3);
  });

  it("takes a folder of theme files without an index, and refuses paths outside the folder", async () => {
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "hub-"));
    await writeFile(join(dir, "solo.anyps5theme"), themeZip(design("solo", "Solo", 0)));
    expect(await cli("hub", "import", dir)).toMatch(/added “Solo” by AnyPS5[\s\S]*1 added, 0 already there$/);

    await writeFile(
      join(dir, "themes.json"),
      JSON.stringify({ themes: [{ id: "x", package: "../elsewhere.anyps5theme" }] }),
    );
    await expect(cli("hub", "import", dir)).rejects.toThrow(/outside/);

    const empty = await mkdtemp(join(tmpdir(), "hub-empty-"));
    await expect(cli("hub", "import", empty)).rejects.toThrow(/no themes/);
    await rm(empty, { recursive: true, force: true });
    expect(await cli("hub", "import")).toContain("usage:");
  });
});
