/** A path on this site to go back to: "/friends", never "//elsewhere" or "https://…". */
export function samePath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  try {
    const url = new URL(next, "https://anytogether.invalid");
    return url.origin === "https://anytogether.invalid" ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}
