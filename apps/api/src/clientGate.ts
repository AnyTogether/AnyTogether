import { type ClientKind, ErrorCode, clientKinds, compareVersions } from "@anytogether/shared";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "./errors.js";

/** The oldest version of each program the API still answers; a program left out is never refused.
 *  Each program counts its own versions (the Mac launcher, the Windows and Linux launcher and the
 *  phone app are released apart). */
export type ClientMinimums = Partial<Record<Exclude<ClientKind, "web">, string>>;

export interface ClientGate {
  minimums: ClientMinimums;
  /** Where a refused client sends its user to update (the website's downloads page). */
  downloadUrl: string;
}

/** The names MIN_LAUNCHER_VERSION takes for each program; `desktop` is Windows and Linux at once. */
const platforms: Record<string, (keyof ClientMinimums)[]> = {
  macos: ["launcher-macos"],
  windows: ["launcher-windows"],
  linux: ["launcher-linux"],
  desktop: ["launcher-windows", "launcher-linux"],
  phone: ["phone"],
};

/** A plain version for a minimum: 0.3.0, 1.16 or 2. */
const plainVersion = /^\d+(\.\d+){0,3}$/;
/** A client's own version, maybe with a pre-release or build part: 0.2.13, 1.16.0+19, 0.3.0-beta. */
const clientVersion = /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.+-]*)?$/;

/** MIN_LAUNCHER_VERSION: "macos=0.2.20,desktop=0.1.8,phone=1.16.0" (macos, windows, linux, desktop,
 *  phone). Empty: nobody is refused. Anything else stops the start, so a typo never shuts
 *  everyone out or lets everyone in unnoticed. */
export function parseClientMinimums(value: string | undefined): ClientMinimums {
  const minimums: ClientMinimums = {};
  const named = new Set<keyof ClientMinimums>();
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // `desktop` first, so windows= or linux= given beside it win whatever the order.
  entries.sort((a, b) => Number(!a.startsWith("desktop=")) - Number(!b.startsWith("desktop=")));
  for (const entry of entries) {
    const [platform = "", version = "", ...rest] = entry.split("=").map((part) => part.trim());
    const kinds = platforms[platform.toLowerCase()];
    if (!kinds || rest.length || !plainVersion.test(version))
      throw new Error(
        `MIN_LAUNCHER_VERSION takes platform=version entries such as macos=0.2.20,desktop=0.1.8,phone=1.16.0 (platforms: ${Object.keys(platforms).join(", ")}): ${JSON.stringify(entry)}`,
      );
    for (const kind of kinds) {
      if (platform !== "desktop") named.add(kind);
      else if (named.has(kind)) continue;
      minimums[kind] = version;
    }
  }
  return minimums;
}

/** The program and version an AnyTogether-Client header names ("launcher-macos/0.2.13 (macOS
 *  26.6)"); nothing when it names no known program or no version that reads. */
export function readClient(header: string | undefined) {
  const [name = "", rest = ""] = (header ?? "").split("/", 2);
  const version = rest.split(" ")[0] ?? "";
  if (!clientKinds.includes(name as ClientKind) || !clientVersion.test(version)) return undefined;
  return { kind: name as ClientKind, version };
}

/** Retires old clients: a request from a program below its minimum is answered 426
 *  `client_too_old` with the minimum, its own version and where to update, before anything else
 *  looks at it (signed in or not). Health checks and the release routes stay open, so an old
 *  client can still find the release that replaces it. A missing or unreadable header passes. */
export function clientGate(gate: ClientGate | undefined): MiddlewareHandler {
  const open = (path: string) =>
    path.endsWith("/health") || path.includes("/releases") || path.endsWith("/projects");
  return async (c, next) => {
    if (!gate || !Object.keys(gate.minimums).length || open(c.req.path)) return next();
    const client = readClient(c.req.header("anytogether-client"));
    const minimum = client && gate.minimums[client.kind as keyof ClientMinimums];
    if (client && minimum && compareVersions(client.version, minimum) < 0)
      throw new HttpError(
        426,
        ErrorCode.clientTooOld,
        `This version is too old. Update to ${minimum} or newer.`,
        { client: client.kind, current: client.version, minimum, downloadUrl: gate.downloadUrl },
      );
    return next();
  };
}
