import {
  type Database,
  accounts,
  notifications,
  profiles,
  pushDevices,
  pushSubscriptions,
} from "@anytogether/db";
import {
  ErrorCode,
  type MemberView,
  type NotificationKind,
  NotificationSettingsUpdate,
  type NotificationView,
  PushDeviceInput,
  PushDeviceRemove,
  PushSubscriptionInput,
  PushUnsubscribe,
  devicePresenceKey,
  digestEveryMs,
  mailLanguageOf,
  notificationSettingsOf,
  presenceDevicesKey,
  presenceHiddenKey,
  presenceKey,
} from "@anytogether/shared";
import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import webpush from "web-push";
import { z } from "zod";
import type { Deps } from "./app.js";
import { HttpError } from "./errors.js";
import { publish } from "./events.js";
import { body } from "./http.js";
import type { DigestItem, MailLanguage, Mailer } from "./mail.js";
import { type AuthVariables, requireUser } from "./middleware.js";
import { type PhoneMessage, PushGone } from "./nativePush.js";
import { people } from "./people.js";
import { settingLimiter } from "./ratelimit.js";

type Row = typeof notifications.$inferSelect;

/** Sends one Web Push message; a rejection carries the push service's statusCode (404 and 410 mean
 *  the subscription is gone). */
export interface PushSender {
  publicKey: string;
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ): Promise<void>;
}

/** Web Push with the server's VAPID keys; none when they are not all set, which turns push off. */
export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }):
  | PushSender
  | undefined {
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return undefined;
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return {
    publicKey: vapid.publicKey,
    async send(subscription, payload) {
      // A day: an invite or a missed call means little after that.
      await webpush.sendNotification(subscription, payload, { vapidDetails, TTL: 86_400, timeout: 10_000 });
    },
  };
}

/** Whether any of the user's devices has a gateway socket open now. Hidden presence keeps no merged
 *  key, so then the devices' own keys (listed in their set, as the gateway keeps them) decide. */
export async function hasLiveSocket(valkey: Redis, userId: string) {
  if (await valkey.exists(presenceKey(userId))) return true;
  if (!(await valkey.exists(presenceHiddenKey(userId)))) return false;
  const devices = await valkey.smembers(presenceDevicesKey(userId));
  if (!devices.length) return false;
  return (await valkey.mget(...devices.map((id) => devicePresenceKey(userId, id)))).some(Boolean);
}

const iso = (date: Date) => date.toISOString();

/** Push texts, in the device's language. */
const pushTexts = {
  en: {
    friend_request: ["{name}", "wants to be your friend."],
    friend_accepted: ["{name}", "accepted your friend request."],
    message: ["{name}", "{text}"],
    messages: ["{name}", "{n} new messages · {text}"],
    party_invite: ["{name}", "invited you to their party."],
    game_invite: ["{name}", "invited you to play {game}."],
    missed_call: ["{name}", "Missed call."],
    lfg_request: ["{name}", "wants in on your {game} post."],
    lfg_requests: ["{name}", "and {others} more want in on your {game} post."],
    lfg_accepted: ["{name}", "let you in for {game}. Your invite is waiting."],
    level_up: ["AnyTogether", "You reached trophy level {level}."],
    community_invite: ["{name}", "invited you to {community}."],
    event_reminder: ["{event}", "starts in 15 minutes · {community}"],
    event_started: ["{event}", "{name} started it. Join in."],
    warning: ["AnyTogether", "A moderator warned you: {reason}"],
    family_invite: ["{name}", "invited you to the family {family}."],
    family_request_more_time: ["{name}", "asks for {minutes} more minutes of play today."],
    family_request_add_friend: ["{name}", "asks to add {person} as a friend."],
    family_request_play_game: ["{name}", "asks to play {game}."],
    family_answer_yes: ["{name}", "said yes to your request."],
    family_answer_no: ["{name}", "said no to your request."],
    family_alert_limit_reached: ["{name}", "reached today's play time."],
    family_alert_child_joined: ["{name}", "joined your family."],
    family_alert_member_joined: ["{name}", "joined your family."],
    family_alert_child_declined: ["{name}", "said the new account is not theirs and left the family."],
    family_summary: ["AnyTogether", "Your family's week of play is ready."],
    appeal_accepted: ["AnyTogether", "Your appeal was accepted. {reply}"],
    appeal_declined: ["AnyTogether", "Your appeal was declined. {reply}"],
    post_like: ["{name}", "liked your capture."],
    post_likes: ["{name}", "and {others} others liked your capture."],
    post_likes_two: ["{name}", "and one other liked your capture."],
    post_comment: ["{name}", "commented: {text}"],
    post_comments: ["{name}", "{n} new comments on your capture · {text}"],
    comment_reply: ["{name}", "replied to your comment: {text}"],
    comment_replies: ["{name}", "{n} new replies to your comment · {text}"],
    // What a push says when the person keeps what was written off their lock screen.
    message_hidden: ["{name}", "New message."],
    messages_hidden: ["{name}", "{n} new messages."],
    post_comment_hidden: ["{name}", "commented on your capture."],
    post_comments_hidden: ["{name}", "{n} new comments on your capture."],
    comment_reply_hidden: ["{name}", "replied to your comment."],
    comment_replies_hidden: ["{name}", "{n} new replies to your comment."],
    call: ["{name}", "is calling you."],
  },
  tr: {
    friend_request: ["{name}", "arkadaşın olmak istiyor."],
    friend_accepted: ["{name}", "arkadaşlık isteğini kabul etti."],
    message: ["{name}", "{text}"],
    messages: ["{name}", "{n} yeni mesaj · {text}"],
    party_invite: ["{name}", "seni partisine çağırdı."],
    game_invite: ["{name}", "seni {game} oynamaya çağırdı."],
    missed_call: ["{name}", "Cevapsız arama."],
    lfg_request: ["{name}", "{game} ilanına katılmak istiyor."],
    lfg_requests: ["{name}", "ve {others} kişi daha {game} ilanına katılmak istiyor."],
    lfg_accepted: ["{name}", "seni {game} için kabul etti. Davetin seni bekliyor."],
    level_up: ["AnyTogether", "Kupa seviyen {level} oldu."],
    community_invite: ["{name}", "seni {community} topluluğuna çağırdı."],
    event_reminder: ["{event}", "15 dakika sonra başlıyor · {community}"],
    event_started: ["{event}", "{name} başlattı. Katıl."],
    warning: ["AnyTogether", "Bir moderatör seni uyardı: {reason}"],
    family_invite: ["{name}", "seni {family} ailesine çağırdı."],
    family_request_more_time: ["{name}", "bugün {minutes} dakika daha oynamak istiyor."],
    family_request_add_friend: ["{name}", "{person} ile arkadaş olmak istiyor."],
    family_request_play_game: ["{name}", "{game} oynamak istiyor."],
    family_answer_yes: ["{name}", "isteğine evet dedi."],
    family_answer_no: ["{name}", "isteğine hayır dedi."],
    family_alert_limit_reached: ["{name}", "bugünkü oyun süresini doldurdu."],
    family_alert_child_joined: ["{name}", "ailene katıldı."],
    family_alert_member_joined: ["{name}", "ailene katıldı."],
    family_alert_child_declined: [
      "{name}",
      "yeni hesabın kendisine ait olmadığını söyledi ve aileden çıktı.",
    ],
    family_summary: ["AnyTogether", "Ailenin oyun haftası hazır."],
    appeal_accepted: ["AnyTogether", "İtirazın kabul edildi. {reply}"],
    appeal_declined: ["AnyTogether", "İtirazın reddedildi. {reply}"],
    post_like: ["{name}", "çekimini beğendi."],
    post_likes: ["{name}", "ve {others} kişi daha çekimini beğendi."],
    post_likes_two: ["{name}", "ve bir kişi daha çekimini beğendi."],
    post_comment: ["{name}", "yorum yaptı: {text}"],
    post_comments: ["{name}", "Çekimine {n} yeni yorum · {text}"],
    comment_reply: ["{name}", "yorumunu yanıtladı: {text}"],
    comment_replies: ["{name}", "Yorumuna {n} yeni yanıt · {text}"],
    message_hidden: ["{name}", "Yeni mesaj."],
    messages_hidden: ["{name}", "{n} yeni mesaj."],
    post_comment_hidden: ["{name}", "çekimine yorum yaptı."],
    post_comments_hidden: ["{name}", "Çekimine {n} yeni yorum."],
    comment_reply_hidden: ["{name}", "yorumunu yanıtladı."],
    comment_replies_hidden: ["{name}", "Yorumuna {n} yeni yanıt."],
    call: ["{name}", "seni arıyor."],
  },
} as const;
type PushTextKey = keyof (typeof pushTexts)["en"];

const fillIn = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** Where a notification leads on the website. */
export function notificationPath(n: Pick<NotificationView, "kind" | "subjectId" | "actor" | "data">) {
  switch (n.kind) {
    case "message":
      return `/messages?c=${n.subjectId}`;
    case "friend_request":
    case "friend_accepted":
      return "/friends";
    case "party_invite":
      return "/party";
    case "missed_call":
      return n.actor ? `/u/${n.actor.handle}` : "/notifications";
    case "lfg_request":
      return "/find#mine";
    case "family_invite":
    case "family_request":
    case "family_answer":
    case "family_alert":
    case "family_summary":
      return "/family";
    case "appeal":
      return "/restricted";
    case "post_like":
    case "post_comment":
    case "comment_reply": {
      const postId = (n.data as { postId?: string }).postId;
      return postId ? `/p/${postId}` : "/notifications";
    }
    case "lfg_accepted": {
      const invite = (n.data as { invite?: { kind?: string; id?: string } | null }).invite;
      return invite?.kind === "share_play" && invite.id ? `/watch/${invite.id}` : "/party";
    }
    case "level_up":
      return n.actor ? `/u/${n.actor.handle}` : "/notifications";
    case "community_invite":
      return `/communities/${n.subjectId}`;
    case "event_reminder":
      return `/events/${n.subjectId}`;
    case "event_started": {
      const link = (n.data as { link?: { kind?: string; id?: string } | null }).link;
      return link?.kind === "share_play" && link.id
        ? `/watch/${link.id}`
        : link
          ? "/party"
          : `/events/${n.subjectId}`;
    }
    default:
      return "/notifications";
  }
}

/** The push message for one notification: {title, body, url, tag, unread}. Without `preview` it
 *  says that someone wrote, not what. */
export function pushPayload(n: NotificationView, lang: string, unread: number, preview = true) {
  const texts = lang === "tr" ? pushTexts.tr : pushTexts.en;
  const data = n.data as Record<string, unknown>;
  const count = Number(data.count ?? 1);
  const familyKey =
    n.kind === "family_request"
      ? `family_request_${String(data.kind)}`
      : n.kind === "family_answer"
        ? `family_answer_${data.approved ? "yes" : "no"}`
        : n.kind === "family_alert"
          ? `family_alert_${String(data.event)}`
          : n.kind === "appeal"
            ? data.decision === "accepted"
              ? "appeal_accepted"
              : "appeal_declined"
            : null;
  const key = (
    familyKey && familyKey in texts
      ? familyKey
      : n.kind === "message" && count > 1
        ? "messages"
        : n.kind === "lfg_request" && count > 1
          ? "lfg_requests"
          : n.kind === "post_like" && count > 2
            ? "post_likes"
            : n.kind === "post_like" && count === 2
              ? "post_likes_two"
              : n.kind === "post_comment" && count > 1
                ? "post_comments"
                : n.kind === "comment_reply" && count > 1
                  ? "comment_replies"
                  : n.kind === "family_request" || n.kind === "family_answer" || n.kind === "family_alert"
                    ? "family_summary"
                    : n.kind
  ) as PushTextKey;
  const hidden = `${key}_hidden` as PushTextKey;
  const shownKey = !preview && hidden in texts ? hidden : key;
  const name =
    n.kind === "message" && data.group
      ? `${String(data.title ?? "")}${data.title ? " · " : ""}${n.actor?.displayName ?? ""}`
      : (n.actor?.displayName ?? "");
  const games = (data.gameNames ?? {}) as Record<string, string>;
  const values = {
    name,
    n: count,
    others: count - 1,
    text: String(data.text ?? ""),
    game: games[lang] ?? games.en ?? String(data.gameName ?? data.titleId ?? ""),
    reason: String(data.reason ?? ""),
    family: String(data.familyName ?? ""),
    minutes: Number(data.minutes ?? 0),
    person: String((data.person as { displayName?: string } | null)?.displayName ?? ""),
    reply: String(data.reply ?? ""),
    level: String(data.level ?? ""),
    community: String(data.community ?? data.name ?? ""),
    event: String(data.title ?? ""),
  };
  const [title, text] = texts[shownKey];
  return {
    title: fillIn(title, values),
    body: fillIn(text, values),
    url: notificationPath(n),
    tag: `${n.kind}:${n.subjectId}`,
    unread,
  };
}

/** The phones that rang for a call (push_devices IDs), so its end reaches them. */
const rangKey = (callId: string) => `call:${callId}:rang`;

/** The routing part of a notification, small enough for a push (APNs and FCM take 4 KB): what a
 *  tap on the phone opens. What was written stays out without `preview`. */
function noticeForPhone(n: NotificationView, preview: boolean) {
  const data = n.data as Record<string, unknown>;
  const keep = [
    "conversationId",
    "postId",
    "commentId",
    "partyId",
    "sessionId",
    "titleId",
    "invite",
    "link",
    "communityId",
    "eventId",
    "callId",
    "count",
    "group",
    ...(preview ? ["text", "title"] : []),
  ];
  const actor = n.actor
    ? {
        userId: n.actor.userId,
        handle: n.actor.handle,
        displayName: n.actor.displayName,
        avatar: n.actor.avatar,
      }
    : null;
  return {
    id: n.id,
    kind: n.kind,
    subjectId: n.subjectId,
    actor,
    data: Object.fromEntries(Object.entries(data).filter(([key]) => keep.includes(key))),
    read: false,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** A notification as a phone push: the words in the phone's language, the badge, and the
 *  notification itself for where a tap leads. */
export function phoneNotice(
  n: NotificationView,
  lang: string,
  unread: number,
  preview: boolean,
): PhoneMessage {
  const shown = pushPayload(n, lang, unread, preview);
  let notice = JSON.stringify(noticeForPhone(n, preview));
  // Never near the 4 KB a push may carry: long texts are cut.
  if (notice.length > 2500) notice = JSON.stringify({ ...noticeForPhone(n, false), data: {} });
  return {
    type: "notice",
    title: shown.title.slice(0, 120),
    body: shown.body.slice(0, 300),
    tag: shown.tag,
    badge: unread,
    data: { kind: n.kind, url: shown.url, notice },
  };
}

const callTag = (callId: string) => `missed_call:${callId}`;
const caller = (from: MemberView) =>
  JSON.stringify({
    userId: from.userId,
    handle: from.handle,
    displayName: from.displayName,
    avatar: from.avatar,
  });

/** A friend calling, as a phone push: it rings, and answering opens the call. The caller goes
 *  under `caller`: FCM keeps `from` for itself. */
export function phoneCall(call: { callId: string; from: MemberView }, lang: string): PhoneMessage {
  const texts = lang === "tr" ? pushTexts.tr : pushTexts.en;
  const [title, body] = texts.call;
  const values = { name: call.from.displayName };
  return {
    type: "call",
    title: fillIn(title, values),
    body: fillIn(body, values),
    tag: callTag(call.callId),
    data: { kind: "call", callId: call.callId, caller: caller(call.from) },
  };
}

/** The ringing is over: a missed call from `from`, or nothing to show. */
export function phoneCallOver(
  callId: string,
  from: MemberView | null,
  lang: string,
  unread: number,
): PhoneMessage {
  const texts = lang === "tr" ? pushTexts.tr : pushTexts.en;
  const [title, body] = texts.missed_call;
  return {
    type: "call_over",
    tag: callTag(callId),
    missed: from ? { title: fillIn(title, { name: from.displayName }), body, badge: unread } : null,
    data: { kind: from ? "missed_call" : "call_over", callId, ...(from ? { caller: caller(from) } : {}) },
  };
}

export interface NotifyInput {
  kind: NotificationKind;
  actorId?: string | null;
  subjectId: string;
  data?: Record<string, unknown>;
}

/** Storing notifications, telling the person's sockets, and pushing to their browsers when none is
 *  open. Pushes go out in the background; `flush` waits for them (the tests use it). */
export function notifier(deps: Pick<Deps, "db" | "valkey" | "push" | "nativePush">) {
  const { db, valkey } = deps;
  const who = people(db);
  const pending = new Set<Promise<unknown>>();

  const unreadCount = async (accountId: string) => {
    const [row] = await db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.accountId, accountId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  };

  const views = async (rows: Row[]): Promise<NotificationView[]> => {
    const cards = await who.cards(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as NotificationKind,
      actor: r.actorId ? (cards.get(r.actorId) ?? null) : null,
      subjectId: r.subjectId,
      data: r.data,
      read: r.readAt !== null,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }));
  };

  const forget = (id: string) => db.delete(pushDevices).where(eq(pushDevices.id, id));

  /** One message to one phone; a token its push service no longer knows is forgotten. */
  async function toPhone(device: typeof pushDevices.$inferSelect, message: PhoneMessage) {
    try {
      await deps.nativePush?.send(
        {
          platform: device.platform as "apns" | "fcm",
          token: device.token,
          app: device.app,
          sandbox: device.sandbox,
        },
        message,
      );
    } catch (error) {
      if (error instanceof PushGone) await forget(device.id);
      else console.error("phone push failed", (error as { statusCode?: number }).statusCode ?? error);
    }
  }

  async function pushTo(accountId: string, view: NotificationView, unread: number, preview: boolean) {
    const sender = deps.push;
    const devices = sender
      ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId))
      : [];
    const phones = deps.nativePush
      ? await db.select().from(pushDevices).where(eq(pushDevices.accountId, accountId))
      : [];
    // A phone that rang for this call shows the missed call itself, as the ringing ends.
    const rang =
      view.kind === "missed_call" && view.subjectId
        ? new Set(await valkey.smembers(rangKey(view.subjectId)))
        : new Set<string>();
    await Promise.all([
      ...devices.map(async (device) => {
        try {
          await sender?.send(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            JSON.stringify(pushPayload(view, device.lang, unread, preview)),
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // The browser unsubscribed or the subscription expired: forget it.
          if (status === 404 || status === 410)
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
          else console.error("push failed", status ?? error);
        }
      }),
      ...phones
        .filter((phone) => !rang.has(phone.id))
        .map((phone) => toPhone(phone, phoneNotice(view, phone.lang, unread, preview))),
    ]);
  }

  const background = (work: Promise<unknown>) => {
    const sending = work.catch((error) => console.error("push failed", error));
    pending.add(sending);
    sending.finally(() => pending.delete(sending));
  };

  const pushSettings = async (accountId: string) => {
    const [profile] = await db
      .select({ settings: profiles.notificationSettings })
      .from(profiles)
      .where(eq(profiles.accountId, accountId));
    return profile ? notificationSettingsOf(profile.settings) : null;
  };

  /** A friend calls: the person's phones ring, each one whose app has no socket open (an open app
   *  rings by itself), unless they turned calls on the phone off. */
  function ring(accountId: string, call: { callId: string; from: MemberView }) {
    if (!deps.nativePush) return;
    background(
      (async () => {
        const settings = await pushSettings(accountId);
        if (!settings?.pushCalls) return;
        const phones = await db.select().from(pushDevices).where(eq(pushDevices.accountId, accountId));
        const live = phones.length
          ? await valkey.mget(...phones.map((p) => devicePresenceKey(accountId, p.sessionId)))
          : [];
        const ringing = phones.filter((_, index) => !live[index]);
        if (!ringing.length) return;
        await valkey
          .multi()
          .sadd(rangKey(call.callId), ...ringing.map((p) => p.id))
          .expire(rangKey(call.callId), 600)
          .exec();
        await Promise.all(ringing.map((phone) => toPhone(phone, phoneCall(call, phone.lang))));
      })(),
    );
  }

  /** The ringing is over on the phones that rang: answered or declined somewhere, it goes away;
   *  not answered, it becomes a missed call (unless missed calls are turned off). */
  function ringOver(accountId: string, call: { callId: string; from: MemberView | null; missed: boolean }) {
    if (!deps.nativePush) return;
    background(
      (async () => {
        const rang = await valkey.smembers(rangKey(call.callId));
        if (!rang.length) return;
        const phones = await db
          .select()
          .from(pushDevices)
          .where(and(eq(pushDevices.accountId, accountId), inArray(pushDevices.id, rang)));
        const settings = await pushSettings(accountId);
        const missed = call.missed && Boolean(settings?.missed_call);
        const unread = missed ? await unreadCount(accountId) : 0;
        await Promise.all(
          phones.map((phone) =>
            toPhone(phone, phoneCallOver(call.callId, missed ? call.from : null, phone.lang, unread)),
          ),
        );
      })(),
    );
  }

  /** A notification for `accountId`, unless they turned its kind off; a message only while none of
   *  their devices is connected. Messages, and people asking in on a post, gather in the one unread
   *  notification of their conversation or post, counting how many came. Returns it, or null when
   *  nothing was stored. */
  async function notify(accountId: string, input: NotifyInput) {
    const [profile] = await db
      .select({ settings: profiles.notificationSettings })
      .from(profiles)
      .where(eq(profiles.accountId, accountId));
    if (!profile) return null;
    if (
      input.kind !== "warning" &&
      input.kind !== "appeal" &&
      !notificationSettingsOf(profile.settings)[input.kind]
    )
      return null;
    const online = await hasLiveSocket(valkey, accountId);
    if (input.kind === "message" && online) return null;
    const data = input.data ?? {};
    // Messages, people asking in on a post, and comments and replies gather into one unread
    // notification, counting how many came; a like says how many like the post now.
    const gathers =
      input.kind === "message" ||
      input.kind === "lfg_request" ||
      input.kind === "post_comment" ||
      input.kind === "comment_reply";
    const [row] = await db
      .insert(notifications)
      .values({
        id: uuidv7(),
        accountId,
        kind: input.kind,
        actorId: input.actorId ?? null,
        subjectId: input.subjectId,
        data: gathers ? { ...data, count: 1 } : data,
      })
      .onConflictDoUpdate({
        target: [notifications.accountId, notifications.kind, notifications.subjectId],
        targetWhere: sql`${notifications.readAt} is null`,
        set: {
          actorId: sql`excluded.actor_id`,
          // More messages gather into the one unread notification of the conversation.
          data: gathers
            ? sql`jsonb_set(excluded.data, '{count}', to_jsonb(coalesce((${notifications.data}->>'count')::int, 1) + 1))`
            : sql`excluded.data`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) return null;
    const [view] = await views([row]);
    const unread = await unreadCount(accountId);
    await publish(valkey, accountId, {
      type: "notification",
      data: { notification: view as NotificationView, unread },
    });
    if (!online && (deps.push || deps.nativePush))
      background(
        pushTo(
          accountId,
          view as NotificationView,
          unread,
          notificationSettingsOf(profile.settings).pushPreview,
        ),
      );
    return view as NotificationView;
  }

  /** Marks read (all of them, or these IDs, or what is about one kind and subject) and tells the
   *  person's other devices. */
  async function markRead(
    accountId: string,
    which: { ids?: string[]; kind?: NotificationKind; subjectId?: string } = {},
  ) {
    const changed = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.accountId, accountId),
          isNull(notifications.readAt),
          which.ids ? inArray(notifications.id, which.ids.length ? which.ids : [uuidv7()]) : undefined,
          which.kind ? eq(notifications.kind, which.kind) : undefined,
          which.subjectId ? eq(notifications.subjectId, which.subjectId) : undefined,
        ),
      )
      .returning({ id: notifications.id });
    // Settling something already read (the usual case) needs no count.
    const unread = changed.length || !which.kind ? await unreadCount(accountId) : 0;
    if (changed.length)
      await publish(valkey, accountId, {
        type: "notification.read",
        data: { ids: which.ids || which.kind ? changed.map((c) => c.id) : null, unread },
      });
    return { unread, changed: changed.length };
  }

  /** What `accountId` was told about one thing is over (they answered, joined, read it). */
  const settle = (accountId: string, kind: NotificationKind, subjectId: string) =>
    markRead(accountId, { kind, subjectId });

  /** Takes back what is no longer true (a friend request withdrawn, an invite to a party that
   *  ended) if it is still unread. */
  async function withdraw(accountId: string, kind: NotificationKind, subjectId: string) {
    const removed = await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.accountId, accountId),
          eq(notifications.kind, kind),
          eq(notifications.subjectId, subjectId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (removed.length)
      await publish(valkey, accountId, {
        type: "notification.read",
        data: { ids: removed.map((r) => r.id), unread: await unreadCount(accountId) },
      });
  }

  const flush = async () => {
    while (pending.size) await Promise.all([...pending]);
  };

  return { notify, markRead, settle, withdraw, unreadCount, views, flush, ring, ringOver };
}

export type Notifier = ReturnType<typeof notifier>;

const Before = z.string().uuid();

/** The notification center: the list, unread count, marking read, the settings, and this browser's
 *  push subscription. */
export function notificationRoutes(deps: Deps, notes: Notifier) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", requireUser(deps));
  const { db } = deps;
  const setting = settingLimiter(deps.valkey, deps.limits);

  /** Newest first, 30 a page; `before` is the last ID of the page before. */
  app.get("/me/notifications", async (c) => {
    const me = c.get("userId");
    const before = c.req.query("before");
    if (before !== undefined && !Before.safeParse(before).success)
      throw new HttpError(400, ErrorCode.badRequest, "before: a notification ID");
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 30) || 30));
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.accountId, me), before ? lt(notifications.id, before) : undefined))
      .orderBy(desc(notifications.id))
      .limit(limit + 1);
    return c.json({
      notifications: await notes.views(rows.slice(0, limit)),
      unread: await notes.unreadCount(me),
      more: rows.length > limit,
    });
  });

  app.get("/me/notifications/unread", async (c) =>
    c.json({ unread: await notes.unreadCount(c.get("userId")) }),
  );

  app.post("/me/notifications/read-all", async (c) => {
    const { unread } = await notes.markRead(c.get("userId"));
    return c.json({ unread });
  });

  app.post("/me/notifications/:id/read", async (c) => {
    const id = c.req.param("id");
    if (!Before.safeParse(id).success) throw new HttpError(404, ErrorCode.notFound, "No such notification");
    const { unread } = await notes.markRead(c.get("userId"), { ids: [id] });
    return c.json({ unread });
  });

  const settingsOf = async (me: string) => {
    const [row] = await db
      .select({ settings: profiles.notificationSettings, email: accounts.email })
      .from(profiles)
      .innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(eq(profiles.accountId, me));
    if (!row) throw new HttpError(401, ErrorCode.unauthorized, "No such account");
    return row;
  };
  /** The settings, whether this server sends push (and its key), and whether a digest can be
   *  mailed (an account without an email gets none). */
  const settingsView = async (me: string) => {
    const row = await settingsOf(me);
    return {
      settings: notificationSettingsOf(row.settings),
      push: deps.push ? { publicKey: deps.push.publicKey } : null,
      native: deps.nativePush ? { apns: deps.nativePush.apns, fcm: deps.nativePush.fcm } : null,
      canMail: row.email !== null,
    };
  };

  app.get("/me/notifications/settings", async (c) => c.json(await settingsView(c.get("userId"))));

  app.patch("/me/notifications/settings", async (c) => {
    const me = c.get("userId");
    await setting("notifications", me);
    const input = await body(c, NotificationSettingsUpdate);
    const row = await settingsOf(me);
    const settings = notificationSettingsOf({ ...notificationSettingsOf(row.settings), ...input });
    await db.update(profiles).set({ notificationSettings: settings }).where(eq(profiles.accountId, me));
    return c.json(await settingsView(me));
  });

  /** This browser's push subscription, tied to its sign-in (signing out ends it). */
  app.post("/me/push", async (c) => {
    if (!deps.push) throw new HttpError(404, ErrorCode.notFound, "This server sends no push notifications");
    const input = await body(c, PushSubscriptionInput);
    const values = {
      accountId: c.get("userId"),
      sessionId: c.get("sessionId"),
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      lang: input.lang ?? "en",
    };
    const [made] = await db
      .insert(pushSubscriptions)
      .values({ id: uuidv7(), endpoint: input.endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .returning({ id: pushSubscriptions.id });
    return c.json({ id: made?.id }, 201);
  });

  app.delete("/me/push", async (c) => {
    const { endpoint } = await body(c, PushUnsubscribe);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.accountId, c.get("userId")), eq(pushSubscriptions.endpoint, endpoint)));
    return c.body(null, 204);
  });

  /** This phone's push token, tied to its sign-in (signing out ends it). A token seen before moves
   *  to this sign-in: the phone signed in again or as someone else. */
  app.post("/me/push/device", async (c) => {
    const native = deps.nativePush;
    const input = await body(c, PushDeviceInput);
    if (!native || (input.platform === "apns" ? !native.apns.length : !native.fcm))
      throw new HttpError(404, ErrorCode.notFound, "This server sends no push notifications to this phone");
    if (input.platform === "apns" && !(input.app && native.apns.includes(input.app)))
      throw new HttpError(400, ErrorCode.badRequest, "This server sends no push notifications to this app");
    const values = {
      accountId: c.get("userId"),
      sessionId: c.get("sessionId"),
      platform: input.platform,
      app: input.platform === "apns" ? (input.app ?? null) : null,
      sandbox: input.platform === "apns" && input.sandbox === true,
      lang: input.lang ?? "en",
    };
    const [made] = await db
      .insert(pushDevices)
      .values({ id: uuidv7(), token: input.token, ...values })
      .onConflictDoUpdate({ target: pushDevices.token, set: values })
      .returning({ id: pushDevices.id });
    return c.json({ id: made?.id }, 201);
  });

  app.delete("/me/push/device", async (c) => {
    const { token } = await body(c, PushDeviceRemove);
    await db
      .delete(pushDevices)
      .where(and(eq(pushDevices.accountId, c.get("userId")), eq(pushDevices.token, token)));
    return c.body(null, 204);
  });

  return app;
}

/** Ends the push subscriptions and phone push tokens of a sign-in that ended. */
export async function forgetPush(db: Database, sessionId: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, sessionId));
  await db.delete(pushDevices).where(eq(pushDevices.sessionId, sessionId));
}

/** The kinds a digest mails about. */
const digestKinds = ["message", "friend_request"];
/** A notification waits this long before it may be mailed: the person may see it first. */
const digestQuietMs = 15 * 60_000;

/** Mails, to each person who turned the digest on and has an email, what waited unread (messages,
 *  friend requests) while they were away: at most one mail per 6 hours, each notification once.
 *  Returns how many mails went out. */
export async function sendDigests(
  deps: { db: Database; valkey: Redis; mailer: Mailer; publicUrl: string },
  now = Date.now(),
) {
  const { db, valkey } = deps;
  const due = await db
    .select({ notification: notifications, email: accounts.email, locale: accounts.locale })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.id, notifications.accountId))
    .innerJoin(profiles, eq(profiles.accountId, notifications.accountId))
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.mailedAt),
        inArray(notifications.kind, digestKinds),
        lt(notifications.updatedAt, new Date(now - digestQuietMs)),
        eq(accounts.status, "active"),
        sql`${accounts.email} is not null`,
        sql`(${profiles.notificationSettings}->>'digest')::boolean is true`,
        sql`not exists (select 1 from notifications m where m.account_id = ${notifications.accountId}
          and m.mailed_at > ${new Date(now - digestEveryMs).toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(notifications.accountId, desc(notifications.updatedAt))
    .limit(2000);
  const byAccount = new Map<string, { email: string; lang: MailLanguage; rows: Row[] }>();
  for (const { notification, email, locale } of due) {
    const entry = byAccount.get(notification.accountId) ?? {
      email: email as string,
      lang: mailLanguageOf(locale) ?? "en",
      rows: [],
    };
    entry.rows.push(notification);
    byAccount.set(notification.accountId, entry);
  }
  const who = people(db);
  let sent = 0;
  for (const [accountId, { email, lang, rows }] of byAccount) {
    if (await hasLiveSocket(valkey, accountId)) continue;
    // Another API process may be mailing the same person.
    const lock = `digest-lock:${accountId}`;
    if ((await valkey.set(lock, "1", "PX", 600_000, "NX")) !== "OK") continue;
    try {
      const cards = await who.cards(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
      const items: DigestItem[] = rows.map((r) => {
        const data = r.data as Record<string, unknown>;
        return {
          kind: r.kind as "message" | "friend_request",
          name: (r.actorId && cards.get(r.actorId)?.displayName) || "?",
          title: typeof data.title === "string" ? data.title : null,
          count: Number(data.count ?? 1),
        };
      });
      await deps.mailer.digest(email, items, deps.publicUrl, lang);
      await db
        .update(notifications)
        .set({ mailedAt: new Date(now) })
        .where(
          inArray(
            notifications.id,
            rows.map((r) => r.id),
          ),
        );
      sent++;
    } catch (error) {
      console.error("digest failed", error);
    } finally {
      await valkey.del(lock);
    }
  }
  return sent;
}

/** Read notifications go after 90 days, every one after 180. */
export async function pruneNotifications(db: Database, now = Date.now()) {
  const removed = await db
    .delete(notifications)
    .where(
      sql`(${notifications.readAt} is not null and ${notifications.createdAt} < ${new Date(now - 90 * 86_400_000).toISOString()}::timestamptz)
        or ${notifications.createdAt} < ${new Date(now - 180 * 86_400_000).toISOString()}::timestamptz`,
    )
    .returning({ id: notifications.id });
  return removed.length;
}
