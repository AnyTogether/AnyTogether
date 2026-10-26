import type { ComposerSetup } from "@/components/Captures";
import { type LibraryGame, localName } from "@/lib/games";
import type { Language } from "@/lib/i18n";
import { apiJson } from "@/lib/session";

/** What the composer starts with for the signed-in reader: their games for the game tag (most
 *  recently played first) and the visibility their gallery setting gives a new post. */
export async function composerSetup(language: Language, defaultGame?: string): Promise<ComposerSetup> {
  const me = await apiJson<{ profile: { handle: string; privacy?: { gallery?: string } } }>("/me");
  const handle = me.body?.profile.handle;
  const library = handle
    ? await apiJson<{ games: LibraryGame[] }>(`/users/${encodeURIComponent(handle)}/library`)
    : { body: null };
  const games = [...(library.body?.games ?? [])]
    .sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""))
    .map((g) => ({ titleId: g.titleId, name: localName(g.names, language) || g.titleId }));
  return {
    games,
    visibility: me.body?.profile.privacy?.gallery === "everyone" ? "public" : "friends",
    ...(defaultGame ? { defaultGame } : {}),
  };
}
