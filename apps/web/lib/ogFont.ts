import "server-only";

const kept = new Map<string, Promise<ArrayBuffer | null>>();

/** A Google font cut down to `text` (a few kilobytes), for share pictures: the built-in font has
 *  no ş, ğ or İ. Null when Google cannot be reached (a self-hosted site offline): the picture
 *  then falls back to the built-in font. */
export function googleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}:${text}`;
  const cached = kept.get(key);
  if (cached) return cached;
  const loading = (async () => {
    try {
      const query = `family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
      const css = await fetch(`https://fonts.googleapis.com/css2?${query}`, {
        signal: AbortSignal.timeout(2500),
      }).then((response) => (response.ok ? response.text() : ""));
      const source = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
      if (!source?.startsWith("https://fonts.gstatic.com/")) return null;
      const font = await fetch(source, { signal: AbortSignal.timeout(2500) });
      return font.ok ? await font.arrayBuffer() : null;
    } catch {
      return null;
    }
  })();
  kept.set(key, loading);
  // Only the last few hundred names are kept; a failure is not kept, so the next one tries again.
  if (kept.size > 300) kept.delete(kept.keys().next().value as string);
  loading.then((font) => font || kept.delete(key));
  return loading;
}
