import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import {
  type ApnsTransport,
  PushGone,
  apnsSender,
  fcmSender,
  nativePush,
  serviceAccountOf,
} from "../src/nativePush.js";

const pem = (type: "ec" | "rsa") =>
  (type === "ec"
    ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    : generateKeyPairSync("rsa", { modulusLength: 2048 })
  ).privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

const app = "org.anyps5.anyps5Remote";
const iphone = { platform: "apns" as const, token: "a1b2c3", app, sandbox: false };
const notice = {
  type: "notice" as const,
  title: "Deniz",
  body: "Hi",
  tag: "message:c1",
  badge: 3,
  data: { kind: "message", url: "/messages?c=c1", notice: "{}" },
};

function apple(answers: { status: number; body?: string }[] = []) {
  const asked: Parameters<ApnsTransport>[0][] = [];
  const transport: ApnsTransport = async (request) => {
    asked.push(request);
    const answer = answers.shift() ?? { status: 200 };
    return { status: answer.status, body: answer.body ?? "" };
  };
  return { asked, transport };
}

describe("APNs", () => {
  it("stays off until the key, the team, the .p8 and a bundle ID are all set", () => {
    expect(apnsSender({ keyId: "", teamId: "T", privateKey: pem("ec"), topics: [app] })).toBeUndefined();
    expect(apnsSender({ keyId: "K", teamId: "T", privateKey: pem("ec"), topics: [] })).toBeUndefined();
    expect(nativePush({})).toBeUndefined();
  });

  it("sends an alert with a provider token, the collapse ID and the badge, to the right environment", async () => {
    const { asked, transport } = apple();
    let clock = Date.parse("2026-11-06T10:00:00Z");
    const sender = apnsSender({
      keyId: "KEY123",
      teamId: "TEAM123",
      privateKey: pem("ec"),
      topics: [app],
      transport,
      now: () => clock,
    });
    await sender?.send(iphone, notice);
    await sender?.send({ ...iphone, sandbox: true }, notice);
    const [first, second] = asked;
    expect(first?.origin).toBe("https://api.push.apple.com");
    expect(second?.origin).toBe("https://api.sandbox.push.apple.com");
    expect(first?.path).toBe("/3/device/a1b2c3");
    expect(first?.headers).toMatchObject({
      "apns-topic": app,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "message:c1",
    });
    const jwt = (first?.headers.authorization ?? "").replace("bearer ", "");
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(decodeJwt(jwt)).toMatchObject({ iss: "TEAM123" });
    expect(JSON.parse(first?.body ?? "{}")).toEqual({
      aps: { alert: { title: "Deniz", body: "Hi" }, sound: "default", "thread-id": "message", badge: 3 },
      kind: "message",
      url: "/messages?c=c1",
      notice: "{}",
    });
    // The same provider token for a while, a new one after 40 minutes.
    expect(second?.headers.authorization).toBe(first?.headers.authorization);
    clock += 41 * 60_000;
    await sender?.send(iphone, notice);
    expect(asked[2]?.headers.authorization).not.toBe(first?.headers.authorization);
  });

  it("rings for a call, takes the ringing away quietly, and forgets tokens Apple does not know", async () => {
    const { asked, transport } = apple([
      { status: 200 },
      { status: 200 },
      { status: 410, body: '{"reason":"Unregistered"}' },
      { status: 400, body: '{"reason":"BadDeviceToken"}' },
      { status: 500, body: '{"reason":"InternalServerError"}' },
    ]);
    const sender = apnsSender({ keyId: "K", teamId: "T", privateKey: pem("ec"), topics: [app], transport });
    await sender?.send(iphone, {
      type: "call",
      title: "Deniz",
      body: "is calling you.",
      tag: "missed_call:c1",
      data: { kind: "call", callId: "c1" },
    });
    expect(asked[0]?.headers["apns-push-type"]).toBe("alert");
    expect(JSON.parse(asked[0]?.body ?? "{}").aps).toMatchObject({
      category: "CALL",
      "interruption-level": "time-sensitive",
    });
    await sender?.send(iphone, {
      type: "call_over",
      tag: "missed_call:c1",
      missed: null,
      data: { callId: "c1" },
    });
    expect(asked[1]?.headers).toMatchObject({ "apns-push-type": "background", "apns-priority": "5" });
    expect(asked[1]?.headers["apns-collapse-id"]).toBeUndefined();
    expect(JSON.parse(asked[1]?.body ?? "{}")).toEqual({ aps: { "content-available": 1 }, callId: "c1" });
    await expect(sender?.send(iphone, notice)).rejects.toBeInstanceOf(PushGone);
    await expect(sender?.send(iphone, notice)).rejects.toBeInstanceOf(PushGone);
    await expect(sender?.send(iphone, notice)).rejects.not.toBeInstanceOf(PushGone);
    // An app the server does not push to is never sent to Apple.
    await expect(sender?.send({ ...iphone, app: "com.other" }, notice)).rejects.toBeInstanceOf(PushGone);
    expect(asked).toHaveLength(5);
  });
});

describe("FCM", () => {
  const account = {
    project_id: "anyps5-remote",
    client_email: "push@anyps5-remote.iam.gserviceaccount.com",
    private_key: pem("rsa"),
    token_uri: "https://oauth2.googleapis.com/token",
  };

  it("reads the service account as JSON or base64, and stays off without one", () => {
    const json = JSON.stringify(account);
    expect(serviceAccountOf(json)?.project_id).toBe("anyps5-remote");
    expect(serviceAccountOf(Buffer.from(json).toString("base64"))?.client_email).toBe(account.client_email);
    expect(serviceAccountOf("")).toBeUndefined();
    expect(() => serviceAccountOf("{nope")).toThrow();
    expect(fcmSender({ account: undefined })).toBeUndefined();
  });

  it("signs in with the service account once, sends notices and calls, and forgets unknown tokens", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Response[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === account.token_uri)
        return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
      return answers.shift() ?? new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const sender = fcmSender({ account, fetch: fakeFetch });
    const android = { platform: "fcm" as const, token: "fcm-1", app: null, sandbox: false };
    await sender?.send(android, notice);
    await sender?.send(android, {
      type: "call",
      title: "Deniz",
      body: "is calling you.",
      tag: "missed_call:c1",
      data: { kind: "call", callId: "c1" },
    });
    expect(calls.filter((c) => c.url === account.token_uri)).toHaveLength(1);
    const assertion = new URLSearchParams(String(calls[0]?.init.body)).get("assertion") ?? "";
    expect(decodeJwt(assertion)).toMatchObject({
      iss: account.client_email,
      aud: account.token_uri,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    const sent = calls.filter((c) => c.url.includes("messages:send"));
    expect(sent[0]?.url).toBe("https://fcm.googleapis.com/v1/projects/anyps5-remote/messages:send");
    expect((sent[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(String(sent[0]?.init.body)).message).toEqual({
      token: "fcm-1",
      notification: { title: "Deniz", body: "Hi" },
      data: { kind: "message", url: "/messages?c=c1", notice: "{}", type: "notice", tag: "message:c1" },
      android: {
        priority: "HIGH",
        collapse_key: "message:c1",
        ttl: "86400s",
        notification: { tag: "message:c1", channel_id: "together", notification_count: 3 },
      },
    });
    // A call is data alone: the app draws it.
    expect(JSON.parse(String(sent[1]?.init.body)).message).toEqual({
      token: "fcm-1",
      data: {
        kind: "call",
        callId: "c1",
        type: "call",
        tag: "missed_call:c1",
        title: "Deniz",
        body: "is calling you.",
      },
      android: { priority: "HIGH", ttl: "45s" },
    });
    answers.push(
      new Response(
        JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }),
        { status: 404 },
      ),
    );
    await expect(sender?.send(android, notice)).rejects.toBeInstanceOf(PushGone);
    answers.push(new Response("{}", { status: 503 }));
    await expect(sender?.send(android, notice)).rejects.not.toBeInstanceOf(PushGone);
  });
});
