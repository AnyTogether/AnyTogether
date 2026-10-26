"use client";

import { When } from "@/components/When";

import { Avatar } from "@/components/Avatar";
import {
  type AdminAppeal,
  type AdminAppealPage,
  type AdminBanRow,
  type AdminLookup,
  type AdminPerson,
  type AdminReport,
  type AdminTab,
  type AdminTheme,
  type AdminThemePage,
  type AdminThemeStatus,
  type AuditEntry,
  adminThumb,
} from "@/lib/admin";
import { since } from "@/lib/feed";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { type ThemeColors, themeStyle } from "@/lib/themes";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";

type Texts = UiStrings;

/** A call to the admin API through the website's relay. */
async function admin<T>(path: string, body?: unknown) {
  const response = await fetch(`/me/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => undefined);
  const parsed = (await response?.json().catch(() => null)) as (T & { code?: string }) | null;
  return { ok: response?.ok ?? false, status: response?.status ?? 0, body: parsed };
}

const date = (iso: string, language: string) =>
  new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" });

/** A person as a moderator needs them: picture, name, handle, and any role or status worth seeing. */
function Who({ person, texts, size = 36 }: { person: AdminPerson; texts: Texts; size?: number }) {
  const shown = {
    handle: person.handle ?? "?",
    displayName: person.displayName ?? "?",
    avatar: person.avatar,
  };
  const body = (
    <>
      <Avatar person={shown} size={size} />
      <span className="lines">
        <span className="name">
          {shown.displayName} <span className="handle">@{shown.handle}</span>
        </span>
        {(person.role === "admin" || person.status !== "active") && (
          <span className="flags">
            {person.role === "admin" && <span className="flair admin-flag">{texts.roleAdmin}</span>}
            {person.status === "banned" && <span className="flair banned-flag">{texts.statusBanned}</span>}
            {person.status === "deleting" && <span className="flair">{texts.statusDeleting}</span>}
          </span>
        )}
      </span>
    </>
  );
  return person.handle && person.status === "active" ? (
    <Link href={`/u/${person.handle}`} className="who">
      {body}
    </Link>
  ) : (
    <span className="who">{body}</span>
  );
}

type Action =
  | "dismiss"
  | "warn"
  | "ban"
  | "remove_message"
  | "reset_avatar"
  | "reset_bio"
  | "reset_private_name"
  | "reset_private_avatar"
  | "remove_post"
  | "hide_theme"
  | "publish_theme"
  | "hide_media"
  | "delete_media"
  | "mute"
  | "remove_community"
  | "remove_event"
  | "remove_comment";
const durations: { days: number | null; key: "days1" | "days7" | "days30" | "forGood" }[] = [
  { days: 1, key: "days1" },
  { days: 7, key: "days7" },
  { days: 30, key: "days30" },
  { days: null, key: "forGood" },
];

/** How long a ban or mute lasts, why as the person reads it, and a note for the moderators. */
function BanFields({
  days,
  setDays,
  reason,
  setReason,
  publicReason,
  setPublicReason,
  texts,
  name,
  legend,
}: {
  days: number | null;
  setDays: (days: number | null) => void;
  reason: string;
  setReason: (reason: string) => void;
  publicReason: string;
  setPublicReason: (reason: string) => void;
  texts: Texts;
  name: string;
  legend: string;
}) {
  return (
    <>
      <fieldset className="durations">
        <legend>{legend}</legend>
        {durations.map((d) => (
          <label key={d.key} className={days === d.days ? "on" : undefined}>
            <input type="radio" name={name} checked={days === d.days} onChange={() => setDays(d.days)} />
            {texts[d.key]}
          </label>
        ))}
      </fieldset>
      <label className="reason">
        <span>{texts.publicReasonLabel}</span>
        <input
          value={publicReason}
          maxLength={300}
          onChange={(event) => setPublicReason(event.target.value)}
        />
        <small className="meta">{texts.publicReasonHint}</small>
      </label>
      <ReasonField
        reason={reason}
        setReason={setReason}
        hint={texts.modNoteHint}
        label={texts.modNote}
        texts={texts}
      />
    </>
  );
}

function ReasonField({
  reason,
  setReason,
  hint,
  label,
  texts,
}: {
  reason: string;
  setReason: (reason: string) => void;
  hint: string;
  label?: string;
  texts: Texts;
}) {
  return (
    <label className="reason">
      <span>{label ?? texts.modReason}</span>
      <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      <small className="meta">{hint}</small>
    </label>
  );
}

/** A theme's card still over its own colors; the still comes through the admin API, so it shows
 *  whatever the theme's state. */
function ThemeStill({
  id,
  version,
  colors,
}: { id: string; version?: number | null; colors: ThemeColors | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="admin-still" style={colors ? themeStyle(colors) : undefined}>
      {!failed && (
        <img
          src={adminThumb(id, version)}
          alt=""
          width={640}
          height={360}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

const statusWord = (status: AdminThemeStatus, texts: Texts) => texts[`themeStatus_${status}`];

function ReportedTheme({ theme, texts }: { theme: NonNullable<AdminReport["theme"]>; texts: Texts }) {
  return (
    <figure className="said reported-theme">
      {theme.status && <ThemeStill id={theme.id} colors={theme.colors} />}
      <figcaption className="lines">
        <span className="name">{theme.name ?? "?"}</span>
        <span className="meta">
          {theme.version ? fill(texts.themeVersion, { n: theme.version }) : null}
          {theme.status ? (
            <>
              {theme.version ? " · " : ""}
              <span className={`theme-now is-${theme.status}`}>
                {fill(texts.themeNow, { status: statusWord(theme.status, texts) })}
              </span>
            </>
          ) : null}
        </span>
        {!theme.status && <span className="meta">{texts.themeGone}</span>}
        {theme.status === "published" && (
          <Link href={`/themes/${theme.id}`} className="meta link">
            {texts.themeOpen}
          </Link>
        )}
      </figcaption>
    </figure>
  );
}

/** Reported media as moderators see it: the picture, clip or voice note itself, and its state. */
function ReportedMedia({ media, texts }: { media: NonNullable<AdminReport["media"]>; texts: Texts }) {
  const view = media.view;
  return (
    <figure className="said reported-media">
      {view && view.kind === "image" && <img src={view.thumb ?? view.url} alt="" loading="lazy" />}
      {view && view.kind === "clip" && (
        // biome-ignore lint/a11y/useMediaCaption: players' own clips have no captions
        <video src={view.url} poster={view.poster ?? undefined} controls preload="metadata" />
      )}
      {view && view.kind === "voice" && (
        // biome-ignore lint/a11y/useMediaCaption: a voice note has no captions
        <audio src={view.url} controls preload="none" />
      )}
      <figcaption className="meta">
        {media.kind ? texts[`kind_${media.kind}`] : texts.kindMedia}
        {media.status === "hidden" && <span className="flair banned-flag">{texts.mediaNowHidden}</span>}
        {media.status === "deleted" && <span className="flair banned-flag">{texts.mediaGone}</span>}
      </figcaption>
    </figure>
  );
}

function ReportItem({
  report,
  texts,
  now,
  onDone,
}: {
  report: AdminReport;
  texts: Texts;
  now: number;
  onDone: (closed: number) => void;
}) {
  const { language } = texts;
  const [action, setAction] = useState<Action | null>(null);
  const [days, setDays] = useState<number | null>(7);
  const [reason, setReason] = useState("");
  const [publicReason, setPublicReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonText = texts[`reason_${report.reason}` as keyof Texts] as string | undefined;

  async function run(chosen: Action) {
    const restricting = chosen === "ban" || chosen === "mute";
    setBusy(true);
    setError(null);
    const done = await admin<{ closed: number }>(`admin/reports/${report.id}`, {
      action: chosen,
      ...(restricting ? { days } : {}),
      ...((restricting || chosen === "warn") && reason.trim() ? { reason: reason.trim() } : {}),
      ...(restricting && publicReason.trim() ? { publicReason: publicReason.trim() } : {}),
    });
    setBusy(false);
    if (!done.ok) return setError(done.status === 409 ? texts.cannotBanAdmin : texts.failed);
    setAction(null);
    onDone(done.body?.closed ?? 1);
  }

  const choices: { key: Action; label: string; show: boolean; danger?: boolean }[] = [
    { key: "warn", label: texts.acWarn, show: true },
    { key: "mute", label: texts.acMute, show: report.target?.role !== "admin", danger: true },
    { key: "ban", label: texts.acBan, show: report.target?.role !== "admin", danger: true },
    {
      key: "remove_message",
      label: texts.acRemoveMessage,
      show: report.targetKind === "message" && !report.message?.removed,
      danger: true,
    },
    {
      key: "remove_post",
      label: texts.acRemovePost,
      show: report.targetKind === "lfg" && !report.post?.removed,
      danger: true,
    },
    {
      key: "remove_post",
      label: texts.acRemoveCapture,
      show: report.targetKind === "post" && Boolean(report.capture) && !report.capture?.removed,
      danger: true,
    },
    {
      key: "remove_comment",
      label: texts.acRemoveComment,
      show: report.targetKind === "comment" && Boolean(report.comment) && !report.comment?.removed,
      danger: true,
    },
    {
      key: "hide_theme",
      label: texts.acHideTheme,
      show:
        report.targetKind === "theme" && Boolean(report.theme?.status) && report.theme?.status !== "hidden",
      danger: true,
    },
    {
      key: "publish_theme",
      label: texts.acPublishTheme,
      show:
        report.targetKind === "theme" &&
        Boolean(report.theme?.status) &&
        report.theme?.status !== "published",
    },
    {
      key: "hide_media",
      label: texts.acHideMedia,
      show: report.targetKind === "media" && report.media?.status === "active",
      danger: true,
    },
    {
      key: "delete_media",
      label: texts.acDeleteMedia,
      show: report.targetKind === "media" && report.media?.status !== "deleted",
      danger: true,
    },
    {
      key: "remove_community",
      label: texts.acRemoveCommunity,
      show: report.targetKind === "community" && !report.community?.removed,
      danger: true,
    },
    {
      key: "remove_event",
      label: texts.acRemoveEvent,
      show: report.targetKind === "event" && !report.community?.removed,
      danger: true,
    },
    { key: "reset_avatar", label: texts.acResetAvatar, show: Boolean(report.target?.avatar) },
    { key: "reset_bio", label: texts.acResetBio, show: Boolean(report.target?.bio) },
    {
      key: "reset_private_name",
      label: texts.acResetPrivateName,
      show: report.targetKind === "private_profile" && Boolean(report.privateProfile?.name),
    },
    {
      key: "reset_private_avatar",
      label: texts.acResetPrivateAvatar,
      show: report.targetKind === "private_profile" && Boolean(report.privateProfile?.avatar),
    },
  ];
  const kindLabel =
    report.targetKind === "message"
      ? texts.kindMessage
      : report.targetKind === "theme"
        ? texts.kindTheme
        : report.targetKind === "lfg"
          ? texts.kindPost
          : report.targetKind === "media"
            ? texts.kindMedia
            : report.targetKind === "community"
              ? texts.kindCommunity
              : report.targetKind === "event"
                ? texts.kindEvent
                : report.targetKind === "private_profile"
                  ? texts.kindPrivateProfile
                  : report.targetKind === "post"
                    ? texts.kindCapture
                    : report.targetKind === "comment"
                      ? texts.kindComment
                      : texts.kindUser;
  // Putting a theme back is not a punishment: it is confirmed like a warning.
  const gentle = action === "warn" || action === "publish_theme";
  const statusLabel =
    report.status === "open"
      ? texts.statusOpen
      : report.status === "actioned"
        ? texts.statusActioned
        : texts.statusDismissed;

  return (
    <li className={`report-item is-${report.status}`}>
      <div className="report-top">
        <span className="flair reason-flag">{reasonText ?? report.reason}</span>
        <span className="flair">{kindLabel}</span>
        {report.timesReported > 1 && (
          <span className="meta">{fill(texts.reportedTimes, { n: report.timesReported })}</span>
        )}
        <time className="meta" dateTime={report.createdAt}>
          {since(report.createdAt, language, now)}
        </time>
      </div>
      {report.target ? (
        <Who person={report.target} texts={texts} />
      ) : (
        <p className="hint">{texts.targetGone}</p>
      )}
      {report.message && (
        <figure className="said">
          <figcaption className="meta">
            {texts.saidText}
            {report.message.removed && <span className="flair banned-flag">{texts.messageRemoved}</span>}
          </figcaption>
          <blockquote>{report.message.text ?? "…"}</blockquote>
        </figure>
      )}
      {report.post && (
        <figure className="said">
          <figcaption className="meta">
            {texts.postText}
            {report.post.removed && <span className="flair banned-flag">{texts.postRemoved}</span>}
          </figcaption>
          <blockquote>{report.post.note ?? "…"}</blockquote>
        </figure>
      )}
      {report.capture && (
        <figure className="said">
          <figcaption className="meta">
            {texts.captureText}
            {report.capture.titleId && <span className="flair">{report.capture.titleId}</span>}
            {report.capture.removed && <span className="flair banned-flag">{texts.captureRemoved}</span>}
          </figcaption>
          {report.capture.caption && <blockquote>{report.capture.caption}</blockquote>}
          {report.capture.media.length > 0 && (
            <div className="reported-captures">
              {report.capture.media.map((m) =>
                m.kind === "clip" ? (
                  // biome-ignore lint/a11y/useMediaCaption: players' own clips have no captions
                  <video key={m.id} src={m.url} poster={m.poster ?? undefined} controls preload="metadata" />
                ) : (
                  <img key={m.id} src={m.thumb ?? m.url} alt="" loading="lazy" />
                ),
              )}
            </div>
          )}
        </figure>
      )}
      {report.comment && (
        <figure className="said">
          <figcaption className="meta">
            {texts.commentText}
            {report.comment.removed && <span className="flair banned-flag">{texts.captureRemoved}</span>}
          </figcaption>
          <blockquote>{report.comment.text ?? "…"}</blockquote>
        </figure>
      )}
      {report.theme && <ReportedTheme theme={report.theme} texts={texts} />}
      {report.media && <ReportedMedia media={report.media} texts={texts} />}
      {report.privateProfile && (
        <figure className="said private-said">
          <figcaption className="meta">
            {texts.privateSnapshot}
            {!report.privateProfile.current && <span className="flair">{texts.privateChanged}</span>}
          </figcaption>
          <div className="private-evidence">
            {report.privateProfile.avatar && (
              <img src={report.privateProfile.avatar} alt="" width={72} height={72} loading="lazy" />
            )}
            <blockquote>{report.privateProfile.name ?? "…"}</blockquote>
          </div>
        </figure>
      )}
      {report.community && (
        <figure className="said">
          <figcaption className="meta">
            {report.community.title
              ? `${report.community.name} · ${report.community.title}`
              : report.community.name}
            {report.community.removed && <span className="flair banned-flag">{texts.postRemoved}</span>}
          </figcaption>
          <blockquote>{report.community.description ?? "…"}</blockquote>
        </figure>
      )}
      {report.target?.bio && report.targetKind === "user" && <p className="said-bio">{report.target.bio}</p>}
      {report.note && <p className="report-note">“{report.note}”</p>}
      <p className="meta">
        {report.reporter
          ? fill(texts.reportedBy, { name: `@${report.reporter.handle ?? "?"}` })
          : texts.reporterGone}
      </p>
      {report.status === "open" ? (
        <>
          <div className="report-acts">
            <button type="button" className="pill" disabled={busy} onClick={() => run("dismiss")}>
              {texts.acDismiss}
            </button>
            {choices
              .filter((c) => c.show)
              .map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`pill${c.danger ? " danger" : ""}`}
                  aria-pressed={action === c.key}
                  disabled={busy}
                  onClick={() => setAction(action === c.key ? null : c.key)}
                >
                  {c.label}
                </button>
              ))}
          </div>
          {action && (
            <form
              className="confirm-action"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                run(action);
              }}
            >
              {(action === "ban" || action === "mute") && (
                <BanFields
                  days={days}
                  setDays={setDays}
                  reason={reason}
                  setReason={setReason}
                  publicReason={publicReason}
                  setPublicReason={setPublicReason}
                  texts={texts}
                  name={`days-${report.id}`}
                  legend={action === "mute" ? texts.muteFor : texts.banFor}
                />
              )}
              {action === "warn" && (
                <ReasonField
                  reason={reason}
                  setReason={setReason}
                  hint={texts.warnReasonHint}
                  texts={texts}
                />
              )}
              <div className="row">
                <button type="button" className="pill" onClick={() => setAction(null)}>
                  {texts.cancel}
                </button>
                <button type="submit" className={gentle ? "primary small" : "pill danger"} disabled={busy}>
                  {texts.confirmAction}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className="meta handled">
          {fill(texts.handledBy, {
            status: statusLabel,
            name: report.handledBy ?? "?",
            when: report.handledAt ? since(report.handledAt, language, now) : "",
          })}
        </p>
      )}
    </li>
  );
}

function ReportsPanel({
  initial,
  texts,
  now,
}: {
  initial: { reports: AdminReport[]; more: boolean; open: number };
  texts: Texts;
  now: number;
}) {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [page, setPage] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(next = status, before?: string) {
    setLoading(true);
    const got = await admin<typeof initial>(
      `admin/reports?status=${next}${before ? `&before=${before}` : ""}`,
    );
    setLoading(false);
    if (!got.body) return;
    const body = got.body;
    setPage((current) => (before ? { ...body, reports: [...current.reports, ...body.reports] } : body));
  }

  return (
    <>
      <div className="admin-bar">
        <div className="seg-mini">
          {(["open", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setNotice(null);
                load(value);
              }}
            >
              {value === "open" ? texts.filterOpen : texts.filterAll}
              {value === "open" && page.open > 0 && <b className="n">{page.open}</b>}
            </button>
          ))}
        </div>
      </div>
      {notice && <output className="notice success">{notice}</output>}
      {page.reports.length ? (
        <ul className="reports">
          {page.reports.map((report) => (
            <ReportItem
              key={report.id}
              report={report}
              texts={texts}
              now={now}
              onDone={(closed) => {
                setNotice(fill(texts.closedReports, { n: closed }));
                load();
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="hint empty">{status === "open" ? texts.noReports : texts.noReportsAll}</p>
      )}
      {page.more && (
        <div className="more-row">
          <button
            type="button"
            className="pill"
            disabled={loading}
            onClick={() => load(status, page.reports.at(-1)?.id)}
          >
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

/** One appeal: who, against what (the moderators' own note too), what they wrote, and the answer. */
function AppealItem({
  appeal,
  texts,
  now,
  onDone,
}: {
  appeal: AdminAppeal;
  texts: Texts;
  now: number;
  onDone: (appeal: AdminAppeal) => void;
}) {
  const { language } = texts;
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = appeal.restriction;

  async function decide(decision: "accept" | "decline") {
    setBusy(true);
    setError(null);
    const done = await admin<{ appeal: AdminAppeal }>(`admin/appeals/${appeal.id}`, {
      decision,
      ...(reply.trim() ? { reply: reply.trim() } : {}),
    });
    setBusy(false);
    if (!done.ok || !done.body?.appeal) return setError(texts.failed);
    onDone(done.body.appeal);
  }

  return (
    <li className={`report-item appeal-item is-${appeal.status}`}>
      <div className="report-top">
        {r ? (
          <span className={`flair${r.kind === "muted" ? "" : " banned-flag"}`}>
            {fill(texts.appealAgainst, { kind: texts[`restriction_${r.kind}`] })}
          </span>
        ) : (
          <span className="flair">{texts.appealRestrictionGone}</span>
        )}
        {r && !r.live && <span className="meta">{texts.appealRestrictionOver}</span>}
        <time className="meta" dateTime={appeal.createdAt}>
          {since(appeal.createdAt, language, now)}
        </time>
      </div>
      {appeal.account ? (
        <Who person={appeal.account} texts={texts} />
      ) : (
        <p className="hint">{texts.targetGone}</p>
      )}
      {r && (
        <p className="meta">
          {r.reason ? `“${r.reason}”` : texts.rNoReason}
          {r.until
            ? ` · ${fill(texts.banUntil, { date: date(r.until, language) })}`
            : ` · ${texts.banForever}`}
          {r.createdBy ? ` · ${fill(texts.banBy, { name: r.createdBy })}` : ""}
        </p>
      )}
      {r?.note && <p className="meta">{fill(texts.appealNote, { note: r.note })}</p>}
      <figure className="said">
        <figcaption className="meta">{texts.appealTitle}</figcaption>
        <blockquote>{appeal.text}</blockquote>
      </figure>
      {appeal.status === "open" ? (
        <form
          className="confirm-action"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
          }}
        >
          <label className="reason">
            <span>{texts.appealReplyLabel}</span>
            <textarea
              rows={3}
              maxLength={1000}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" className="pill" disabled={busy} onClick={() => decide("decline")}>
              {texts.appealDecline}
            </button>
            <button type="button" className="primary small" disabled={busy} onClick={() => decide("accept")}>
              {texts.appealAccept}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          {appeal.reply && <p className="report-note">“{appeal.reply}”</p>}
          <p className="meta handled">
            {fill(texts.handledBy, {
              status: appeal.status === "accepted" ? texts.appealStatusAccepted : texts.appealStatusDeclined,
              name: appeal.handledBy ?? "?",
              when: appeal.answeredAt ? since(appeal.answeredAt, language, now) : "",
            })}
          </p>
        </>
      )}
    </li>
  );
}

function AppealsPanel({
  initial,
  texts,
  now,
}: { initial: AdminAppealPage | null; texts: Texts; now: number }) {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [page, setPage] = useState(initial ?? { appeals: [], more: false, open: 0 });
  const [loading, setLoading] = useState(false);

  async function load(next = status, before?: string) {
    setLoading(true);
    const got = await admin<AdminAppealPage>(
      `admin/appeals?status=${next}${before ? `&before=${before}` : ""}`,
    );
    setLoading(false);
    if (!got.body) return;
    const body = got.body;
    setPage((current) => (before ? { ...body, appeals: [...current.appeals, ...body.appeals] } : body));
  }

  return (
    <>
      <div className="admin-bar">
        <div className="seg-mini">
          {(["open", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                load(value);
              }}
            >
              {value === "open" ? texts.filterOpen : texts.filterAll}
              {value === "open" && page.open > 0 && <b className="n">{page.open}</b>}
            </button>
          ))}
        </div>
      </div>
      {page.appeals.length ? (
        <ul className="reports">
          {page.appeals.map((appeal) => (
            <AppealItem
              key={appeal.id}
              appeal={appeal}
              texts={texts}
              now={now}
              onDone={(answered) =>
                setPage((current) => ({
                  ...current,
                  open: Math.max(0, current.open - 1),
                  appeals:
                    status === "open"
                      ? current.appeals.filter((a) => a.id !== answered.id)
                      : current.appeals.map((a) => (a.id === answered.id ? answered : a)),
                }))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="hint empty">{status === "open" ? texts.noAppeals : texts.noAppealsAll}</p>
      )}
      {page.more && (
        <div className="more-row">
          <button
            type="button"
            className="pill"
            disabled={loading}
            onClick={() => load(status, page.appeals.at(-1)?.id)}
          >
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

/** One theme in the queue: its still, name, maker and reports, and what a moderator may do. */
function ThemeItem({
  theme,
  texts,
  onDone,
}: {
  theme: AdminTheme;
  texts: Texts;
  onDone: (theme: AdminTheme) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices: { status: AdminThemeStatus; label: string; danger?: boolean }[] = [
    { status: "published", label: texts.themeShow },
    { status: "review", label: texts.themeReview },
    { status: "hidden", label: texts.themeHide, danger: true },
  ];
  async function set(status: AdminThemeStatus) {
    setBusy(true);
    setError(null);
    const done = await admin<{ theme: AdminTheme }>(`admin/themes/${theme.id}`, { status });
    setBusy(false);
    if (!done.ok || !done.body?.theme) return setError(texts.failed);
    onDone(done.body.theme);
  }
  return (
    <li className="admin-theme">
      <ThemeStill id={theme.id} version={theme.version} colors={theme.colors} />
      <div className="admin-theme-body">
        <span className="name">{theme.name}</span>
        <span className="meta">
          {theme.maker
            ? fill(texts.themeBy, { name: `@${theme.maker.handle ?? "?"}` })
            : texts.themeMakerGone}
          {" · "}
          {fill(texts.themeVersion, { n: theme.version })}
        </span>
        {theme.openReports > 0 && (
          <span className="flair reason-flag">{fill(texts.themeReports, { n: theme.openReports })}</span>
        )}
        {theme.description && <p className="said-bio">{theme.description}</p>}
        <div className="report-acts">
          {choices
            .filter((c) => c.status !== theme.status)
            .map((c) => (
              <button
                key={c.status}
                type="button"
                className={`pill${c.danger ? " danger" : ""}`}
                disabled={busy}
                onClick={() => set(c.status)}
              >
                {c.label}
              </button>
            ))}
          {theme.status === "published" && (
            <Link href={`/themes/${theme.id}`} className="pill">
              {texts.themeOpen}
            </Link>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

/** Themes held for review (people reported them), hidden ones, and published ones. */
function ThemesPanel({ initial, texts }: { initial: AdminThemePage | null; texts: Texts }) {
  const [status, setStatus] = useState<AdminThemeStatus>("review");
  const [page, setPage] = useState<AdminThemePage>(initial ?? { themes: [], more: false, review: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(next = status, before?: string) {
    setLoading(true);
    const got = await admin<AdminThemePage>(
      `admin/themes?status=${next}${before ? `&before=${before}` : ""}`,
    );
    setLoading(false);
    if (!got.body) return;
    const body = got.body;
    setPage((current) => (before ? { ...body, themes: [...current.themes, ...body.themes] } : body));
  }

  const filters: { value: AdminThemeStatus; label: string }[] = [
    { value: "review", label: texts.themesReview },
    { value: "hidden", label: texts.themesHidden },
    { value: "published", label: texts.themesPublished },
  ];
  const empty =
    status === "review"
      ? texts.noThemesReview
      : status === "hidden"
        ? texts.noThemesHidden
        : texts.noThemesPublished;
  return (
    <>
      <div className="admin-bar">
        <div className="seg-mini">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => {
                setStatus(f.value);
                setNotice(null);
                load(f.value);
              }}
            >
              {f.label}
              {f.value === "review" && page.review > 0 && <b className="n">{page.review}</b>}
            </button>
          ))}
        </div>
      </div>
      {notice && <output className="notice success">{notice}</output>}
      {page.themes.length ? (
        <ul className="admin-themes">
          {page.themes.map((theme) => (
            <ThemeItem
              key={theme.id}
              theme={theme}
              texts={texts}
              onDone={(changed) => {
                setNotice(
                  fill(texts.themeDone, { name: changed.name, status: statusWord(changed.status, texts) }),
                );
                load();
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="hint empty">{empty}</p>
      )}
      {page.more && (
        <div className="more-row">
          <button
            type="button"
            className="pill"
            disabled={loading}
            onClick={() => load(status, page.themes.at(-1)?.id)}
          >
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

/** One ban: who (or an address), why, by whom, until when; lift it while it is in force. */
function BanItem({
  ban,
  texts,
  onLifted,
}: {
  ban: AdminBanRow;
  texts: Texts;
  onLifted: (ban: AdminBanRow) => void;
}) {
  const { language } = texts;
  const [busy, setBusy] = useState(false);
  const until = ban.liftedAt
    ? fill(texts.banLifted, { date: date(ban.liftedAt, language) })
    : !ban.expiresAt
      ? texts.banForever
      : ban.live
        ? fill(texts.banUntil, { date: date(ban.expiresAt, language) })
        : fill(texts.banExpired, { date: date(ban.expiresAt, language) });
  return (
    <li className={`person ban-item${ban.live ? "" : " over"}`}>
      {ban.account ? (
        <Who person={ban.account} texts={texts} />
      ) : (
        <span className="who">
          <span className="avatar system" style={{ "--size": "36px" } as React.CSSProperties} />
          <span className="lines">
            <span className="name">{ban.emailOnly ? texts.banEmailOnly : "?"}</span>
          </span>
        </span>
      )}
      <span className="lines ban-lines">
        <span className={`meta${ban.live ? " live" : ""}`}>
          {ban.kind === "mute" && <span className="flair">{texts.kindMute}</span>} {until}
        </span>
        {ban.publicReason && <span className="meta">“{ban.publicReason}”</span>}
        {ban.reason && <span className="meta">{ban.reason}</span>}
        {ban.createdBy && <span className="meta">{fill(texts.banBy, { name: ban.createdBy })}</span>}
      </span>
      {ban.live && (
        <button
          type="button"
          className="pill"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const done = await admin<{ ban: AdminBanRow }>(`admin/bans/${ban.id}/lift`, {});
            setBusy(false);
            if (done.body?.ban) onLifted(done.body.ban);
          }}
        >
          {texts.lift}
        </button>
      )}
    </li>
  );
}

function BansPanel({
  initial,
  texts,
}: { initial: { bans: AdminBanRow[]; more: boolean } | null; texts: Texts }) {
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(initial ?? { bans: [], more: false });
  const [loading, setLoading] = useState(false);

  async function load(nextAll = all, before?: string) {
    setLoading(true);
    const got = await admin<{ bans: AdminBanRow[]; more: boolean }>(
      `admin/bans?${nextAll ? "all=1&" : ""}${before ? `before=${before}` : ""}`,
    );
    setLoading(false);
    if (got.body) {
      const body = got.body;
      setPage((current) => (before ? { ...body, bans: [...current.bans, ...body.bans] } : body));
    }
  }

  return (
    <>
      <div className="admin-bar">
        <div className="seg-mini">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={all === value}
              onClick={() => {
                setAll(value);
                load(value);
              }}
            >
              {value ? texts.filterAll : texts.filterLive}
            </button>
          ))}
        </div>
      </div>
      {page.bans.length ? (
        <ul className="people">
          {page.bans.map((ban) => (
            <BanItem
              key={ban.id}
              ban={ban}
              texts={texts}
              onLifted={(lifted) =>
                setPage((current) => ({
                  ...current,
                  bans: all
                    ? current.bans.map((b) => (b.id === lifted.id ? lifted : b))
                    : current.bans.filter((b) => b.id !== lifted.id),
                }))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="hint empty">{texts.noBans}</p>
      )}
      {page.more && (
        <div className="more-row">
          <button
            type="button"
            className="pill"
            disabled={loading}
            onClick={() => load(all, page.bans.at(-1)?.id)}
          >
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

function PeoplePanel({ initialQuery, texts, now }: { initialQuery: string; texts: Texts; now: number }) {
  const { language } = texts;
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<AdminLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number | null>(7);
  const [reason, setReason] = useState("");
  const [publicReason, setPublicReason] = useState("");
  const [banning, setBanning] = useState<"ban" | "mute" | false>(false);
  const [error, setError] = useState<string | null>(null);

  async function find(term = query) {
    if (term.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const got = await admin<AdminLookup>(`admin/users?q=${encodeURIComponent(term.trim())}`);
    setBusy(false);
    if (!got.body) return setError(texts.failed);
    setFound(got.body);
    setBanning(false);
  }

  async function banUser(userId: string, kind: "ban" | "mute") {
    setBusy(true);
    const done = await admin(`admin/users/${userId}/${kind}`, {
      days,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(publicReason.trim() ? { publicReason: publicReason.trim() } : {}),
    });
    setBusy(false);
    if (!done.ok) return setError(done.status === 409 ? texts.cannotBanAdmin : texts.failed);
    setReason("");
    setPublicReason("");
    await find();
  }

  const user = found?.user;
  return (
    <>
      <form
        className="search admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        <label htmlFor="admin-q">{texts.findPerson}</label>
        <div className="field">
          <input
            id="admin-q"
            type="search"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder={texts.findHint}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="pill small" disabled={busy || query.trim().length < 2}>
            {texts.find}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {found && !user && <p className="hint empty">{texts.noPerson}</p>}
      {user && (
        <div className="lookup">
          <Who person={user} texts={texts} size={48} />
          <ul className="facts">
            {user.email && <li>{user.email}</li>}
            <li className="mono">{user.userId}</li>
            <li>{fill(texts.joined, { date: date(user.createdAt, language) })}</li>
            <li>
              {fill(texts.reportsAgainst, { n: user.reportsAgainst })} ·{" "}
              {fill(texts.reportsMade, { n: user.reportsMade })}
            </li>
          </ul>
          {user.bio && <p className="said-bio">{user.bio}</p>}

          <h4 className="sub">{texts.sessionsTitle}</h4>
          {found.sessions?.length ? (
            <ul className="people sessions">
              {found.sessions.map((s) => (
                <li key={s.id} className={`person${s.revokedAt ? " over" : ""}`}>
                  <span className="lines">
                    <span className="name">
                      {(texts[`client_${s.client.replace(/-/g, "_")}` as keyof Texts] as string) ?? s.client}
                      {s.deviceName ? ` · ${s.deviceName}` : ""}
                    </span>
                    <span className="meta">
                      {s.revokedAt
                        ? `${texts.revoked} ${since(s.revokedAt, language, now)}`
                        : fill(texts.lastActive, { when: since(s.lastSeenAt ?? s.createdAt, language, now) })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{texts.noSessions}</p>
          )}
        </div>
      )}
      {found && (found.bans.length > 0 || user) && (
        <>
          <h4 className="sub">{texts.bansTitle}</h4>
          {found.bans.length ? (
            <ul className="people">
              {found.bans.map((ban) => (
                <BanItem key={ban.id} ban={ban} texts={texts} onLifted={() => find()} />
              ))}
            </ul>
          ) : (
            <p className="hint">{texts.noBans}</p>
          )}
        </>
      )}
      {user && user.role !== "admin" && user.status !== "banned" && (
        <div className="lookup-ban">
          {banning ? (
            <form
              className="confirm-action"
              onSubmit={(event) => {
                event.preventDefault();
                banUser(user.userId, banning);
              }}
            >
              <BanFields
                days={days}
                setDays={setDays}
                reason={reason}
                setReason={setReason}
                publicReason={publicReason}
                setPublicReason={setPublicReason}
                texts={texts}
                name="lookup-days"
                legend={banning === "mute" ? texts.muteFor : texts.banFor}
              />
              <div className="row">
                <button type="button" className="pill" onClick={() => setBanning(false)}>
                  {texts.cancel}
                </button>
                <button type="submit" className="pill danger" disabled={busy}>
                  {texts.confirmAction}
                </button>
              </div>
            </form>
          ) : (
            <div className="row">
              <button type="button" className="pill danger" onClick={() => setBanning("mute")}>
                {texts.mutePerson}
              </button>
              <button type="button" className="pill danger" onClick={() => setBanning("ban")}>
                {texts.banPerson}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AuditPanel({
  initial,
  texts,
  now,
}: {
  initial: { entries: AuditEntry[]; more: boolean } | null;
  texts: Texts;
  now: number;
}) {
  const { language } = texts;
  const [page, setPage] = useState(initial ?? { entries: [], more: false });
  const [loading, setLoading] = useState(false);

  const line = (entry: AuditEntry): ReactNode => {
    const key = `au_${entry.action}` as keyof Texts;
    const verb = typeof texts[key] === "string" ? (texts[key] as string) : entry.action;
    const data = entry.data ?? {};
    const by = entry.actor
      ? `@${entry.actor.handle}`
      : typeof data.by === "string"
        ? data.by
        : texts.auditSystem;
    const name = typeof data.name === "string" ? data.name : null;
    // A theme by its name, a removed post or message by its author, a person by their handle.
    const target = entry.targetUser
      ? `@${entry.targetUser.handle}`
      : entry.action.startsWith("theme.") && name
        ? `“${name}”`
        : entry.author
          ? `@${entry.author.handle}`
          : entry.action.startsWith("report.")
            ? null
            : entry.target;
    return (
      <>
        <b>{by}</b> {verb} {target && <b>{target}</b>}
      </>
    );
  };
  const extra = (entry: AuditEntry) => {
    const data = entry.data ?? {};
    const parts: string[] = [];
    if (typeof data.publicReason === "string" && data.publicReason) parts.push(`“${data.publicReason}”`);
    if (typeof data.reason === "string" && data.reason) parts.push(data.reason);
    if (typeof data.days === "number") parts.push(fill(texts.auditDays, { n: data.days }));
    else if (entry.action === "ban" || entry.action === "mute") parts.push(texts.banForever);
    return parts.join(" · ");
  };

  return (
    <>
      {page.entries.length ? (
        <ul className="audit">
          {page.entries.map((entry) => (
            <li key={entry.id}>
              <p className="audit-line">{line(entry)}</p>
              <p className="meta">
                <When iso={entry.createdAt} language={language} now={now} />
                {extra(entry) && <span> · {extra(entry)}</span>}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint empty">{texts.auditEmpty}</p>
      )}
      {page.more && (
        <div className="more-row">
          <button
            type="button"
            className="pill"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              const got = await admin<{ entries: AuditEntry[]; more: boolean }>(
                `admin/audit?before=${page.entries.at(-1)?.id ?? ""}`,
              );
              setLoading(false);
              if (got.body) {
                const body = got.body;
                setPage((current) => ({ entries: [...current.entries, ...body.entries], more: body.more }));
              }
            }}
          >
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

/** The admin page: the reports queue, appeals, the theme queue, finding a person, bans, and the
 *  audit log, one tab each. */
export function AdminBoard({
  texts,
  tab,
  initialReports,
  initialBans,
  initialAudit,
  initialThemes,
  initialAppeals,
  initialQuery,
  now,
}: {
  texts: Texts;
  tab: AdminTab;
  me: string;
  initialReports: { reports: AdminReport[]; more: boolean; open: number };
  initialAppeals: AdminAppealPage | null;
  initialThemes: AdminThemePage | null;
  initialBans: { bans: AdminBanRow[]; more: boolean } | null;
  initialAudit: { entries: AuditEntry[]; more: boolean } | null;
  initialQuery: string;
  now: number;
}) {
  const tabs: { key: AdminTab; label: string; n?: number }[] = [
    { key: "reports", label: texts.tabReports, n: initialReports.open },
    { key: "appeals", label: texts.tabAppeals, n: initialAppeals?.open },
    { key: "themes", label: texts.tabThemes, n: initialThemes?.review },
    { key: "people", label: texts.tabPeople },
    { key: "bans", label: texts.tabBans },
    { key: "audit", label: texts.tabAudit },
  ];
  return (
    <>
      <nav className="switch admin-tabs in d2" aria-label={texts.admin}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "reports" ? "/admin" : `/admin?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
            {t.n ? <b className="n">{t.n}</b> : null}
          </Link>
        ))}
      </nav>
      <article className="card in d3 admin-card">
        {tab === "reports" && <ReportsPanel initial={initialReports} texts={texts} now={now} />}
        {tab === "appeals" && <AppealsPanel initial={initialAppeals} texts={texts} now={now} />}
        {tab === "themes" && <ThemesPanel initial={initialThemes} texts={texts} />}
        {tab === "people" && <PeoplePanel initialQuery={initialQuery} texts={texts} now={now} />}
        {tab === "bans" && <BansPanel initial={initialBans} texts={texts} />}
        {tab === "audit" && <AuditPanel initial={initialAudit} texts={texts} now={now} />}
      </article>
    </>
  );
}
