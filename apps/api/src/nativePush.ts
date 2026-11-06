import { createHash } from "node:crypto";
import { type ClientHttp2Session, connect as http2Connect } from "node:http2";
import type { PushPlatform } from "@anytogether/shared";
import { SignJWT, importPKCS8 } from "jose";

/** What a phone is sent: a notification (title, text, the badge, and what a tap opens), a friend
 *  calling (it rings until `ringFor` runs out), or the end of that ringing (`missed` replaces it
 *  with a missed call; without it the ringing just goes away). `tag` is the one notification this
 *  replaces on the phone: the same conversation or post gathers into one. */
export type PhoneMessage =
  | {
      type: "notice";
      title: string;
      body: string;
      tag: string;
      badge: number;
      data: Record<string, string>;
    }
  | { type: "call"; title: string; body: string; tag: string; data: Record<string, string> }
  | {
      type: "call_over";
      tag: string;
      missed: { title: string; body: string; badge: number } | null;
      data: Record<string, string>;
    };

export interface PhoneDevice {
  platform: PushPlatform;
  token: string;
  /** The iPhone app's bundle ID (the APNs topic). */
  app: string | null;
  sandbox: boolean;
}

/** A token the push service no longer knows (the app was removed, the token was renewed, or it
 *  belongs to another app or environment): the device is forgotten. */
export class PushGone extends Error {
  constructor(reason: string) {
    super(`push token gone: ${reason}`);
  }
}

/** Sends to phones; `apns` lists the iPhone apps (bundle IDs) it can push to, empty when APNs is
 *  not set up, and `fcm` says whether Android phones can be pushed to. */
export interface NativePush {
  apns: string[];
  fcm: boolean;
  send(device: PhoneDevice, message: PhoneMessage): Promise<void>;
}

/** How long a call rings on a phone before it counts as not answered. */
export const ringSeconds = 45;
/** A notification means little after a day. */
const daySeconds = 86_400;

// MARK: APNs

/** One HTTP/2 request to Apple's push service; the tests answer it themselves. */
export type ApnsTransport = (request: {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;

/** HTTP/2 to Apple, one connection per origin kept open, a new one when it closes. */
export function http2Transport(): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string) => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const made = http2Connect(origin);
    made.on("error", () => sessions.delete(origin));
    made.on("close", () => sessions.delete(origin));
    // An idle connection is closed by Apple after a while; this one is let go after an hour.
    made.setTimeout(3_600_000, () => made.close());
    made.unref();
    sessions.set(origin, made);
    return made;
  };
  return ({ origin, path, headers, body }) =>
    new Promise((resolve, reject) => {
      const stream = sessionFor(origin).request({ ":method": "POST", ":path": path, ...headers });
      let status = 0;
      let text = "";
      stream.setEncoding("utf8");
      stream.setTimeout(10_000, () => stream.close());
      stream.on("response", (head) => {
        status = Number(head[":status"] ?? 0);
      });
      stream.on("data", (chunk: string) => {
        text += chunk;
      });
      stream.on("end", () => resolve({ status, body: text }));
      stream.on("error", reject);
      stream.end(body);
    });
}

/** An APNs collapse ID is at most 64 bytes. */
const collapseId = (tag: string) =>
  Buffer.byteLength(tag) <= 64 ? tag : createHash("sha256").update(tag).digest("hex").slice(0, 64);

/** APNs with a token-based key (.p8 from the Apple Developer account): the key's ID, the team ID,
 *  the key itself, and the bundle IDs of the iPhone apps it may push to. None when any is missing,
 *  which keeps iPhone push off. */
export function apnsSender(options: {
  keyId: string;
  teamId: string;
  privateKey: string;
  topics: string[];
  transport?: ApnsTransport;
  now?: () => number;
}) {
  const { keyId, teamId, privateKey, topics } = options;
  if (!keyId || !teamId || !privateKey || !topics.length) return undefined;
  const transport = options.transport ?? http2Transport();
  const now = options.now ?? Date.now;
  const key = importPKCS8(privateKey, "ES256");
  key.catch((error: Error) => console.error(`APNS_PRIVATE_KEY is not a usable .p8 key: ${error.message}`));
  // Apple wants a fresh provider token at most every 20 minutes and refuses one older than an hour.
  let token: { value: string; madeAt: number } | undefined;
  const providerToken = async () => {
    if (token && now() - token.madeAt < 40 * 60_000) return token.value;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(Math.floor(now() / 1000))
      .sign(await key);
    token = { value, madeAt: now() };
    return value;
  };

  return {
    topics,
    async send(device: PhoneDevice, message: PhoneMessage) {
      const topic = device.app && topics.includes(device.app) ? device.app : undefined;
      if (!topic) throw new PushGone("not an app this server pushes to");
      const seconds = Math.floor(now() / 1000);
      const headers: Record<string, string> = {
        authorization: `bearer ${await providerToken()}`,
        "apns-topic": topic,
        "content-type": "application/json",
      };
      let payload: Record<string, unknown>;
      const silent = message.type === "call_over" && !message.missed;
      if (silent) {
        // Only the app hears it: it takes the ringing away.
        headers["apns-push-type"] = "background";
        headers["apns-priority"] = "5";
        headers["apns-expiration"] = String(seconds + ringSeconds);
        payload = { aps: { "content-available": 1 }, ...message.data };
      } else {
        const shown =
          message.type === "call_over" && message.missed
            ? message.missed
            : (message as Exclude<PhoneMessage, { type: "call_over" }>);
        headers["apns-push-type"] = "alert";
        headers["apns-priority"] = "10";
        headers["apns-collapse-id"] = collapseId(message.tag);
        headers["apns-expiration"] = String(seconds + (message.type === "call" ? ringSeconds : daySeconds));
        const aps: Record<string, unknown> = {
          alert: { title: shown.title, body: shown.body },
          sound: "default",
          "thread-id": message.tag.split(":")[0],
        };
        if ("badge" in shown) aps.badge = shown.badge;
        if (message.type === "call") {
          aps.category = "CALL";
          aps["interruption-level"] = "time-sensitive";
        }
        payload = { aps, ...message.data };
      }
      const origin = device.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
      const answer = await transport({
        origin,
        path: `/3/device/${device.token}`,
        headers,
        body: JSON.stringify(payload),
      });
      if (answer.status === 200) return;
      const reason = (() => {
        try {
          return String((JSON.parse(answer.body) as { reason?: string }).reason ?? "");
        } catch {
          return "";
        }
      })();
      if (
        answer.status === 410 ||
        ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason)
      )
        throw new PushGone(reason || "Unregistered");
      if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") token = undefined;
      throw Object.assign(new Error(`APNs ${answer.status} ${reason}`), { statusCode: answer.status });
    },
  };
}

// MARK: FCM

/** The parts of a Firebase service account's JSON key that sending uses. */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** FCM_SERVICE_ACCOUNT as the JSON key itself or base64 of it; undefined when empty or unusable. */
export function serviceAccountOf(value: string | undefined): ServiceAccount | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  for (const candidate of [text, Buffer.from(text, "base64").toString("utf8")]) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ServiceAccount>;
      if (parsed.project_id && parsed.client_email && parsed.private_key) return parsed as ServiceAccount;
    } catch {
      // The other form, then.
    }
  }
  throw new Error("FCM_SERVICE_ACCOUNT is not a Firebase service account key (JSON or base64 JSON)");
}

/** Firebase Cloud Messaging's HTTP v1 API with a service account: an OAuth access token made from
 *  the account's key, kept until shortly before it runs out. None without an account, which keeps
 *  Android push off. */
export function fcmSender(options: {
  account: ServiceAccount | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const { account } = options;
  if (!account) return undefined;
  const ask = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const key = importPKCS8(account.private_key, "RS256");
  key.catch((error: Error) =>
    console.error(`FCM_SERVICE_ACCOUNT's private key is not usable: ${error.message}`),
  );
  let access: { value: string; until: number } | undefined;

  const accessToken = async () => {
    if (access && now() < access.until) return access.value;
    const seconds = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(seconds)
      .setExpirationTime(seconds + 3600)
      .sign(await key);
    const response = await ask(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!response.ok) throw new Error(`FCM sign-in failed: ${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in?: number };
    access = { value: json.access_token, until: now() + ((json.expires_in ?? 3600) - 300) * 1000 };
    return access.value;
  };

  return {
    async send(device: PhoneDevice, message: PhoneMessage) {
      const data: Record<string, string> = { ...message.data, type: message.type, tag: message.tag };
      let body: Record<string, unknown>;
      if (message.type === "notice") {
        // Shown by Android itself when the app is not open; the same tag replaces the last one.
        body = {
          token: device.token,
          notification: { title: message.title, body: message.body },
          data,
          android: {
            priority: "HIGH",
            collapse_key: message.tag.slice(0, 100),
            ttl: `${daySeconds}s`,
            notification: {
              tag: message.tag,
              channel_id: "together",
              notification_count: message.badge,
            },
          },
        };
      } else {
        // The app draws a call (over the lock screen, with answer and decline) and takes it away.
        if (message.type === "call") Object.assign(data, { title: message.title, body: message.body });
        if (message.type === "call_over" && message.missed)
          Object.assign(data, { title: message.missed.title, body: message.missed.body });
        body = {
          token: device.token,
          data,
          android: { priority: "HIGH", ttl: `${ringSeconds}s` },
        };
      }
      const send = async () =>
        ask(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
          body: JSON.stringify({ message: body }),
        });
      let response = await send();
      if (response.status === 401) {
        access = undefined;
        response = await send();
      }
      if (response.ok) return;
      const text = await response.text();
      const code = (() => {
        try {
          const error = (
            JSON.parse(text) as { error?: { status?: string; details?: { errorCode?: string }[] } }
          ).error;
          return error?.details?.find((d) => d.errorCode)?.errorCode ?? error?.status ?? "";
        } catch {
          return "";
        }
      })();
      if (response.status === 404 || code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH")
        throw new PushGone(code || "UNREGISTERED");
      if (response.status === 400 && code === "INVALID_ARGUMENT" && /registration token/i.test(text))
        throw new PushGone("INVALID_ARGUMENT");
      throw Object.assign(new Error(`FCM ${response.status} ${code}`), { statusCode: response.status });
    },
  };
}

/** APNs and FCM together, each when it is set up; none when neither is. */
export function nativePush(senders: {
  apns?: ReturnType<typeof apnsSender>;
  fcm?: ReturnType<typeof fcmSender>;
}): NativePush | undefined {
  const { apns, fcm } = senders;
  if (!apns && !fcm) return undefined;
  return {
    apns: apns?.topics ?? [],
    fcm: Boolean(fcm),
    async send(device, message) {
      const sender = device.platform === "apns" ? apns : fcm;
      // Not set up (any more): the device is kept for when it is.
      if (!sender) return;
      await sender.send(device, message);
    },
  };
}
