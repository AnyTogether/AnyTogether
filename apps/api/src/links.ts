/** Domains messages may not carry by default: IP loggers, which reveal a person's address to
 *  whoever sent the link the moment they open it. BLOCKED_LINK_DOMAINS replaces the list. */
export const defaultBlockedLinkDomains = [
  "grabify.link",
  "iplogger.org",
  "iplogger.com",
  "iplogger.ru",
  "iplogger.co",
  "iplogger.info",
  "2no.co",
  "yip.su",
  "blasze.com",
  "ipgrabber.ru",
];

/** Host names anywhere in a text, with or without a scheme ("https://a.b/c", "a.b/c", "a.b"). */
const hosts = /(?:^|[^a-z0-9.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}[a-z0-9])/g;

/** The blocked domain a text links to, or null. Look-alike dots ("．", "[.]", "(dot)") count as
 *  dots, and a subdomain counts as its domain. */
export function blockedLink(text: string, domains: readonly string[]) {
  if (!domains.length) return null;
  const plain = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[。．｡]/g, ".")
    .replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/g, ".");
  for (const [, host] of plain.matchAll(hosts)) {
    const hit = domains.find((domain) => host === domain || host?.endsWith(`.${domain}`));
    if (hit) return hit;
  }
  return null;
}
