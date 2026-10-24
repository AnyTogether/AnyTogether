import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { type Database, accounts, auditLog, profiles, themes } from "@anytogether/db";
import { ThemeDescription, themeExtension } from "@anytogether/shared";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { HttpError } from "./errors.js";
import { type BlobStore, postgresStore } from "./storage.js";
import { type ThemeContents, makeStills, packTheme, readTheme } from "./themeFile.js";

/** The account the Hub's own themes are shared from: @anyps5, a handle nobody can take (see
 *  isReservedHandle). It has no way to sign in. */
export const curatorHandle = "anyps5";
const curatorName = "AnyPS5";
const curatorBio = "Themes from the AnyPS5 team and the first AnyPS5 theme hub.";

/** One theme an index (the old GitHub hub's themes.json) lists. */
interface IndexEntry {
  id?: string;
  name?: string;
  author?: string;
  package: string;
}

type Ctx = { db: Database; blobs?: BlobStore | undefined };

/** The curator's account, made the first time it is needed. */
export async function curatorAccount(db: Database) {
  const find = async () =>
    (await db.select({ id: profiles.accountId }).from(profiles).where(eq(profiles.handle, curatorHandle)))[0];
  const found = await find();
  if (found) return { id: found.id, created: false };
  const id = uuidv7();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(accounts).values({ id, role: "curator" });
      await tx.insert(profiles).values({
        accountId: id,
        handle: curatorHandle,
        displayName: curatorName,
        bio: curatorBio,
        discoverable: false,
      });
    });
    return { id, created: true };
  } catch (error) {
    // Another run made it a moment ago.
    const again = await find();
    if (again) return { id: again.id, created: false };
    throw error;
  }
}

/** The themes a folder holds: what its themes.json lists, or else every theme file in it and in
 *  its themes/ folder. Paths outside the folder are refused. */
async function entriesOf(dir: string): Promise<IndexEntry[]> {
  const root = resolve(dir);
  const inside = (path: string) => {
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) throw new Error(`${path} is outside ${dir}`);
    return full;
  };
  const index = await readFile(join(root, "themes.json"), "utf8").catch(() => null);
  if (index !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(index);
    } catch {
      throw new Error("themes.json is not valid JSON");
    }
    const list = (parsed as { themes?: unknown })?.themes;
    if (!Array.isArray(list)) throw new Error("themes.json has no themes list");
    return list.map((raw, at) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const text = (key: string) => (typeof entry[key] === "string" ? (entry[key] as string) : undefined);
      const path = text("package");
      if (!path) throw new Error(`themes.json: theme ${at + 1} names no package`);
      return {
        id: text("id"),
        name: text("name"),
        author: text("author"),
        package: inside(path),
      };
    });
  }
  const found: IndexEntry[] = [];
  for (const folder of [root, join(root, "themes")]) {
    const names = await readdir(folder).catch(() => [] as string[]);
    for (const name of names.sort())
      if (name.endsWith(`.${themeExtension}`)) found.push({ package: join(folder, name) });
  }
  return found;
}

const escapeXml = (value: string) => value.replace(/[^#0-9A-Fa-f]/g, "");

/** A still for a theme that brought none: its colors drawn the way its animated background
 *  looks (0 cosmic, 1 aurora, 2 sunset), 1280x720. */
export async function drawStill(json: ThemeContents["json"], seed: string) {
  const deep = escapeXml(json.deep);
  const middle = escapeXml(json.middle);
  const bright = escapeXml(json.bright);
  const accent = escapeXml(json.accent);
  // The same stars for the same theme on every run.
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
  const style = json.style % 3;
  const layers =
    style === 1
      ? [0, 1, 2]
          .map((band) => {
            const y = 170 + band * 120;
            const lift = 150 + band * 40;
            return `<path d="M-300 ${y + 60} C 200 ${y - lift}, 800 ${y + lift}, 1580 ${y - 80} L 1580 ${y + 50} C 900 ${
              y + 40 + lift
            }, 300 ${y - lift / 2}, -300 ${y + 150} Z" fill="${band === 1 ? accent : bright}" opacity="${
              0.38 - band * 0.08
            }" filter="url(#soft)"/>`;
          })
          .join("")
      : style === 2
        ? `<circle cx="640" cy="560" r="230" fill="url(#sun)"/>
           <rect y="540" width="1280" height="180" fill="${deep}" opacity="0.55"/>
           ${[0, 1, 2, 3]
             .map(
               (line) =>
                 `<rect y="${566 + line * 34}" width="1280" height="${3 + line * 2}" fill="${accent}" opacity="${
                   0.28 - line * 0.05
                 }"/>`,
             )
             .join("")}`
        : `<circle cx="900" cy="250" r="330" fill="url(#glow)"/>
           <circle cx="260" cy="560" r="220" fill="url(#glow2)"/>
           ${Array.from({ length: 90 }, () => {
             const r = 0.6 + random() * 1.8;
             return `<circle cx="${Math.round(random() * 1280)}" cy="${Math.round(random() * 720)}" r="${r.toFixed(
               1,
             )}" fill="#FFFFFF" opacity="${(0.25 + random() * 0.6).toFixed(2)}"/>`;
           }).join("")}`;
  // Drawn with a margin and cut out, so blurred shapes do not fade at the edges.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1880" height="1320" viewBox="-300 -300 1880 1320">
    <defs>
      <linearGradient id="base" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="512" y2="720">
        <stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${middle}"/>
      </linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="${bright}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${bright}" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow2"><stop offset="0" stop-color="${accent}" stop-opacity="0.4"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="${bright}"/>
        <stop offset="0.6" stop-color="${accent}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
      <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
        <stop offset="0.6" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.45"/></radialGradient>
      <filter id="soft" filterUnits="userSpaceOnUse" x="-400" y="-400" width="2080" height="1520"><feGaussianBlur stdDeviation="26"/></filter>
    </defs>
    <rect x="-300" y="-300" width="1880" height="1320" fill="url(#base)"/>
    ${layers}
    <rect width="1280" height="720" fill="url(#vignette)"/>
  </svg>`;
  return new Uint8Array(
    await sharp(Buffer.from(svg)).extract({ left: 300, top: 300, width: 1280, height: 720 }).png().toBuffer(),
  );
}

/** Puts the themes of a folder like the old GitHub hub's (themes.json and its .anyps5theme files)
 *  on the Hub, shared by @anyps5 with who made them in the description. A theme already there
 *  (the same theme.json id) is left as it is, so running it again changes nothing. */
export async function importHub(ctx: Ctx, dir: string, by = "admin") {
  const store = ctx.blobs ?? postgresStore(ctx.db);
  const entries = await entriesOf(dir);
  if (!entries.length)
    throw new Error(`no themes in ${dir}: it needs themes.json or .${themeExtension} files`);
  const curator = await curatorAccount(ctx.db);
  const lines: string[] = [];
  if (curator.created) lines.push(`made the curator account @${curatorHandle}`);
  let added = 0;
  let kept = 0;
  let failed = 0;
  for (const entry of entries) {
    const shown = relative(resolve(dir), entry.package) || basename(entry.package);
    try {
      const contents = await readTheme(new Uint8Array(await readFile(entry.package)));
      const sourceId =
        contents.json.id?.trim() || entry.id?.trim() || basename(entry.package, `.${themeExtension}`);
      const name = contents.json.name;
      const [same] = await ctx.db
        .select({ id: themes.id })
        .from(themes)
        .where(and(eq(themes.makerId, curator.id), eq(themes.sourceId, sourceId)));
      if (same) {
        kept++;
        lines.push(`kept “${name}”: already on the Hub (${same.id})`);
        continue;
      }
      const author = (entry.author ?? contents.json.author ?? "").trim() || curatorName;
      const description = ThemeDescription.parse(`By ${author}. One of the first themes on the AnyPS5 hub.`);
      const still =
        contents.preview ??
        (contents.background?.kind === "picture" ? contents.background.bytes : null) ??
        (await drawStill(contents.json, sourceId));
      const stills = await makeStills(still);
      const id = uuidv7();
      const packed = packTheme(contents, { id, author, version: 1 });
      const folder = `themes/${id}/v1/`;
      try {
        await store.put(`${folder}theme.${themeExtension}`, packed.bytes);
        await store.put(`${folder}preview.webp`, stills.preview);
        await store.put(`${folder}thumb.webp`, stills.thumb);
        const [row] = await ctx.db
          .insert(themes)
          .values({
            id,
            makerId: curator.id,
            sourceId,
            name,
            description,
            style: contents.json.style,
            colors: {
              deep: contents.json.deep,
              middle: contents.json.middle,
              bright: contents.json.bright,
              accent: contents.json.accent,
            },
            design: packed.design,
            background: contents.background?.kind ?? null,
            music: Boolean(contents.music),
            size: packed.bytes.length,
            sha256: createHash("sha256").update(packed.bytes).digest("hex"),
          })
          .onConflictDoNothing()
          .returning({ id: themes.id });
        if (!row) {
          await store.deletePrefix(`themes/${id}/`);
          kept++;
          lines.push(`kept “${name}”: already on the Hub`);
          continue;
        }
      } catch (error) {
        await store.deletePrefix(`themes/${id}/`);
        throw error;
      }
      await ctx.db.insert(auditLog).values({
        id: uuidv7(),
        action: "theme.imported",
        target: id,
        data: { by, source: sourceId, author },
      });
      added++;
      lines.push(`added “${name}” by ${author} (${id})`);
    } catch (error) {
      failed++;
      const reason = error instanceof HttpError || error instanceof Error ? error.message : String(error);
      lines.push(`skipped ${shown}: ${reason}`);
    }
  }
  lines.push(`${added} added, ${kept} already there${failed ? `, ${failed} failed` : ""}`);
  return { added, kept, failed, text: lines.join("\n") };
}
