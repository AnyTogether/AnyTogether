/** Whether a request was sent by another site's page. Browsers say so in Sec-Fetch-Site; older
 *  ones only send Origin, which must then be this host. A request with neither (a program, not a
 *  page) is not a cross-site one. SameSite=Lax cookies do not cover this: a sibling subdomain of
 *  the same registrable domain is the same "site" to the browser. */
export function fromAnotherSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const hosts = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    new URL(request.url).host,
  ];
  try {
    return !hosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}

/** Methods that change nothing and may come from anywhere (links, other sites' navigations). */
export const safeMethods = ["GET", "HEAD", "OPTIONS"];

/** Whether a request comes from this website's own pages: its Origin names the host the request
 *  was sent to. That host is the Host header, which the proxy passes on: request.url cannot be
 *  used, as Next builds it from the address the server listens on (http://[::]:3000 in the
 *  container, localhost behind any proxy), which no browser's Origin ever matches. A request with
 *  no Origin is refused unless `required` is false (GETs, and browsers that send none on
 *  same-origin requests). */
export function fromThisSite(request: Request, { required = true }: { required?: boolean } = {}) {
  const origin = request.headers.get("origin");
  if (!origin) return !required;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}
