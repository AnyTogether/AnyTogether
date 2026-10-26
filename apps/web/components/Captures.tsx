"use client";

import { Avatar } from "@/components/Avatar";
import { useLiveEvents } from "@/components/Live";
import { MediaTile } from "@/components/Media";
import { ReportSheet } from "@/components/ProfileMenu";
import { When } from "@/components/When";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill, shownName } from "@/lib/people";
import {
  type CommentPage,
  type LikesPage,
  type Post,
  type PostComment,
  type PostMedia,
  type PostPage,
  type PostVisibility,
  clipLength,
  compactCount,
  pickProblem,
  postError,
  postLimits,
  togglePick,
  toggledLike,
  withComment,
  withoutComment,
} from "@/lib/posts";
import { type MediaItem, kindOfFile, posterOf, uploadMedia } from "@/lib/storage";
import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/** Captures: the feed of screenshots and clips, one post with its likes and comments, the grid on
 *  a profile or a game's page, and the composer. Every call goes through /me/captures/…, which
 *  passes only the capture calls on to the API. */

export type CaptureSource =
  | { kind: "captures" }
  | { kind: "user"; handle: string }
  | { kind: "game"; titleId: string };
export interface ComposerSetup {
  /** The reader's games, for the game tag. */
  games: { titleId: string; name: string }[];
  /** What the visibility starts at (the gallery setting's). */
  visibility: PostVisibility;
  defaultGame?: string;
}

const api = "/me/captures";
const listPath = (source: CaptureSource) =>
  source.kind === "captures"
    ? "me/captures"
    : source.kind === "user"
      ? `users/${encodeURIComponent(source.handle)}/posts`
      : `games/${source.titleId}/posts`;

async function call<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}/${path}`, {
    ...init,
    headers: init.body ? { "content-type": "application/json" } : undefined,
  }).catch(() => undefined);
  const body = response && response.status !== 204 ? await response.json().catch(() => null) : null;
  return {
    ok: Boolean(response?.ok),
    status: response?.status ?? 0,
    body: body as (T & { code?: string }) | null,
  };
}

const ratioOf = (m: Pick<PostMedia, "width" | "height">) =>
  m.width && m.height ? Math.min(1.91, Math.max(0.8, m.width / m.height)) : 16 / 9;

/** Lucide-like strokes, drawn here so they take the text color. */
const icons = {
  heart: "M12 20.5s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.7-7.5 10.1-7.5 10.1z",
  comment: "M4.5 12a7.5 7.5 0 1 1 3.6 6.4L4 19.5l1.1-3.9A7.5 7.5 0 0 1 4.5 12z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  friends:
    "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3 19.5c.8-3.3 3.1-5.3 6-5.3s5.2 2 6 5.3M16 5a3 3 0 0 1 0 6M18.5 14.5c1.4.8 2.3 2.4 2.7 5",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  close: "M6 6l12 12M18 6L6 18",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  stack:
    "M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16M4 9.5A1.5 1.5 0 0 1 5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5z",
  plus: "M12 5v14M5 12h14",
  send: "M4.5 12l15-7.5-4.5 15-3-6z",
};
const Icon = ({ d, className = "stroke" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);

/** The heart: fills when liked, pops and throws a few sparks when it changes to liked. */
function LikeButton({
  post,
  texts,
  onToggle,
}: {
  post: Post;
  texts: UiStrings;
  onToggle: () => void;
}) {
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      className={`cap-act cap-like${post.liked ? " on" : ""}`}
      aria-pressed={post.liked}
      aria-label={post.liked ? texts.capLiked : texts.capLike}
      onClick={() => {
        if (!post.liked) setPop((n) => n + 1);
        onToggle();
      }}
    >
      <span className="cap-heart" key={pop} data-pop={pop > 0 && post.liked ? "" : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={icons.heart} />
        </svg>
        <span className="cap-sparks" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ "--a": `${i * 60 + 30}deg` } as CSSProperties} />
          ))}
        </span>
      </span>
    </button>
  );
}

/** The pictures (swiped, or stepped with the arrows) or the clip of a post, in a frame with a
 *  camera's corner marks; a double tap on a picture likes it. */
function CaptureFrame({
  post,
  texts,
  onOpen,
  onDoubleTap,
}: {
  post: Post;
  texts: UiStrings;
  onOpen: (index: number) => void;
  onDoubleTap: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [burst, setBurst] = useState(0);
  const items = post.media;
  const first = items[0];
  if (!first) return null;
  const many = items.length > 1;
  const go = (index: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(items.length - 1, index));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };
  const like = () => {
    setBurst((n) => n + 1);
    onDoubleTap();
  };
  return (
    <div
      className={`cap-frame${first.kind === "clip" ? " is-clip" : ""}`}
      style={{ "--ratio": ratioOf(first) } as CSSProperties}
    >
      <div
        ref={track}
        className="cap-track"
        onScroll={(event) => {
          const el = event.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {items.map((m, index) =>
          m.kind === "clip" ? (
            <div key={m.id} className="cap-slide">
              {/* biome-ignore lint/a11y/useMediaCaption: players' own clips have no captions */}
              <video src={m.url} poster={m.poster ?? undefined} controls playsInline preload="none" />
            </div>
          ) : (
            <button
              key={m.id}
              type="button"
              className="cap-slide"
              aria-label={many ? fill(texts.capShot, { i: index + 1, n: items.length }) : texts.capOpen}
              title={texts.capDoubleTapHint}
              onClick={(event) => {
                // A double tap likes; a single one opens the picture.
                if (event.detail === 2) return like();
                const timer = window.setTimeout(() => onOpen(index), 240);
                (event.currentTarget as HTMLButtonElement).dataset.timer = String(timer);
              }}
              onDoubleClick={(event) => {
                window.clearTimeout(Number((event.currentTarget as HTMLButtonElement).dataset.timer));
              }}
            >
              <img
                src={m.url}
                alt=""
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </button>
          ),
        )}
      </div>
      <span className="cap-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {first.kind === "clip" ? (
        <span className="cap-stamp rec" aria-hidden="true">
          <b />
          REC {clipLength(first.durationMs) ?? ""}
        </span>
      ) : many ? (
        <span className="cap-stamp" aria-hidden="true">
          {String(at + 1).padStart(2, "0")}/{String(items.length).padStart(2, "0")}
        </span>
      ) : null}
      {many && (
        <>
          <button
            type="button"
            className="cap-step prev"
            aria-label={texts.capPrevShot}
            disabled={at === 0}
            onClick={() => go(at - 1)}
          >
            <Icon d={icons.left} />
          </button>
          <button
            type="button"
            className="cap-step next"
            aria-label={texts.capNextShot}
            disabled={at === items.length - 1}
            onClick={() => go(at + 1)}
          >
            <Icon d={icons.right} />
          </button>
          <span className="cap-dots" aria-hidden="true">
            {items.map((m, index) => (
              <i key={m.id} className={index === at ? "on" : undefined} />
            ))}
          </span>
        </>
      )}
      {burst > 0 && (
        <span className="cap-heart-big" key={burst} aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={icons.heart} />
          </svg>
        </span>
      )}
    </div>
  );
}

/** A picture filling the screen; Escape, the × or a click beside it closes it. */
function ShotViewer({
  media,
  index,
  texts,
  onClose,
}: {
  media: PostMedia[];
  index: number | null;
  texts: UiStrings;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState(index ?? 0);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (index !== null) {
      setAt(index);
      if (!el.open) el.showModal();
    } else if (el.open) el.close();
  }, [index]);
  const shown = media[at];
  return (
    <dialog
      ref={dialog}
      className="viewer cap-viewer"
      aria-label={texts.capOpen}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") setAt((n) => Math.min(media.length - 1, n + 1));
        if (event.key === "ArrowLeft") setAt((n) => Math.max(0, n - 1));
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.classList.contains("viewer-stage"))
          dialog.current?.close();
      }}
    >
      {index !== null && shown && (
        <>
          <div className="viewer-stage">
            <img
              key={shown.id}
              src={shown.url}
              alt=""
              width={shown.width ?? undefined}
              height={shown.height ?? undefined}
            />
          </div>
          <div className="viewer-bar">
            <span className="viewer-meta">
              {media.length > 1 ? fill(texts.capShot, { i: at + 1, n: media.length }) : texts.capOpen}
              {shown.width && shown.height ? ` · ${shown.width}×${shown.height}` : ""}
            </span>
            {media.length > 1 && (
              <>
                <button
                  type="button"
                  className="pill icon"
                  aria-label={texts.capPrevShot}
                  disabled={at === 0}
                  onClick={() => setAt(at - 1)}
                >
                  <Icon d={icons.left} />
                </button>
                <button
                  type="button"
                  className="pill icon"
                  aria-label={texts.capNextShot}
                  disabled={at === media.length - 1}
                  onClick={() => setAt(at + 1)}
                >
                  <Icon d={icons.right} />
                </button>
              </>
            )}
            <a className="pill" href={shown.url} download>
              <Icon d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
              {texts.saveMedia}
            </a>
            <button
              type="button"
              className="pill icon viewer-close"
              aria-label={texts.closeViewer}
              onClick={() => dialog.current?.close()}
            >
              <Icon d={icons.close} />
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

/** The ⋯ of a post: the author edits, hides or deletes it; anyone else reports it. */
function PostMenu({
  post,
  texts,
  onEdit,
  onChange,
  onDelete,
}: {
  post: Post;
  texts: UiStrings;
  onEdit: () => void;
  onChange: (changes: Partial<Pick<Post, "commentsOff" | "visibility">>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const report = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const item = (label: string, act: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={danger ? "danger" : undefined}
      onClick={() => {
        setOpen(false);
        act();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="cap-menu" ref={box}>
      <button
        type="button"
        className="pill icon"
        aria-label={texts.capMore}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Icon d={icons.more} className="stroke dots" />
      </button>
      {open && (
        <div className="pop" role="menu">
          {post.mine ? (
            <>
              {item(texts.capEditCaption, onEdit)}
              {item(post.commentsOff ? texts.capCommentsOnAction : texts.capCommentsOffAction, () =>
                onChange({ commentsOff: !post.commentsOff }),
              )}
              {item(post.visibility === "public" ? texts.capMakeFriends : texts.capMakePublic, () =>
                onChange({ visibility: post.visibility === "public" ? "friends" : "public" }),
              )}
              {item(texts.capDelete, onDelete, true)}
            </>
          ) : (
            item(texts.capReport, () => report.current?.showModal(), true)
          )}
        </div>
      )}
      {!post.mine && (
        <ReportSheet
          dialog={report}
          person={{ userId: post.id, displayName: post.author.displayName }}
          texts={texts}
          kind="post"
          title={texts.capReportTitle}
          lead={texts.capReportLead}
        />
      )}
    </div>
  );
}

/** One post: who and when, the game, the frame, the like and comment row, the caption, and the
 *  comments (in a sheet, or below it on the post's own page). */
export function PostCard({
  post: initial,
  texts,
  now,
  inline = false,
  onRemoved,
  arrived = false,
}: {
  post: Post;
  texts: UiStrings;
  now: number;
  /** The post's own page: comments are shown under it, not in a sheet. */
  inline?: boolean;
  onRemoved?: (id: string) => void;
  arrived?: boolean;
}) {
  const [post, setPost] = useState(initial);
  useEffect(() => setPost(initial), [initial]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.caption ?? "");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const comments = useRef<HTMLDialogElement>(null);
  const likes = useRef<HTMLDialogElement>(null);
  const [commentsOpened, setCommentsOpened] = useState(inline ? 1 : 0);
  const [likesOpened, setLikesOpened] = useState(0);
  const { language } = texts;
  const say = (code: string | undefined, status: number) =>
    setError(texts[postError(code, status) as keyof UiStrings] as string);

  const like = async (only?: "like") => {
    if (only && post.liked) return;
    const before = post;
    setPost((p) => ({ ...p, ...toggledLike(p) }));
    const done = await call<{ likes: number; liked: boolean }>(`posts/${post.id}/like`, {
      method: before.liked ? "DELETE" : "PUT",
    });
    if (done.ok && done.body)
      setPost((p) => ({ ...p, likes: done.body?.likes ?? p.likes, liked: Boolean(done.body?.liked) }));
    else {
      setPost(before);
      say(done.body?.code, done.status);
    }
  };
  const change = async (changes: Partial<Pick<Post, "caption" | "commentsOff" | "visibility">>) => {
    const done = await call<Post>(`posts/${post.id}`, { method: "PATCH", body: JSON.stringify(changes) });
    if (done.ok && done.body) {
      setPost(done.body);
      setEditing(false);
      setError(null);
    } else say(done.body?.code, done.status);
  };
  const remove = async () => {
    if (!window.confirm(texts.capConfirmDelete)) return;
    const done = await call(`posts/${post.id}`, { method: "DELETE" });
    if (done.ok) onRemoved?.(post.id);
    else say(done.body?.code, done.status);
  };
  const gameName = post.game ? localName(post.game.names, language) || post.game.titleId : null;
  const link = typeof window === "undefined" ? `/p/${post.id}` : `${window.location.origin}/p/${post.id}`;

  return (
    <article className={`card cap-card${arrived ? " arrived" : ""}`} aria-labelledby={`cap-${post.id}`}>
      <header className="cap-head">
        <Link href={`/u/${post.author.handle}`} className="cap-who" tabIndex={-1} aria-hidden="true">
          <Avatar person={post.author} size={40} />
        </Link>
        <div className="cap-lines">
          <Link href={`/u/${post.author.handle}`} className="cap-name" id={`cap-${post.id}`}>
            {shownName(post.author)}
          </Link>
          <span className="meta">
            <When iso={post.createdAt} language={language} now={now} />
            {post.source === "launcher" && <span> · {texts.capFromLauncher}</span>}
            {post.source === "phone" && <span> · {texts.capFromPhone}</span>}
          </span>
        </div>
        {post.game && (
          <Link href={`/games/${post.game.titleId}`} className="cap-game" title={post.game.titleId}>
            <span className="cap-game-id">{post.game.titleId}</span>
            <span className="cap-game-name">{gameName}</span>
          </Link>
        )}
        <span
          className={`cap-vis is-${post.visibility}`}
          title={post.visibility === "public" ? texts.capEveryone : texts.capFriendsOnly}
        >
          <Icon d={post.visibility === "public" ? icons.globe : icons.friends} />
          <span className="visually-hidden">
            {post.visibility === "public" ? texts.capEveryone : texts.capFriendsOnly}
          </span>
        </span>
        <PostMenu
          post={post}
          texts={texts}
          onEdit={() => {
            setDraft(post.caption ?? "");
            setEditing(true);
          }}
          onChange={change}
          onDelete={remove}
        />
      </header>

      <CaptureFrame post={post} texts={texts} onOpen={setViewing} onDoubleTap={() => like("like")} />

      <div className="cap-acts">
        <LikeButton post={post} texts={texts} onToggle={() => like()} />
        {post.likes > 0 && (
          <button
            type="button"
            className="cap-count"
            aria-label={
              post.likes === 1
                ? texts.capLikesOne
                : fill(texts.capLikesN, { n: compactCount(post.likes, language) })
            }
            onClick={() => {
              setLikesOpened((n) => n + 1);
              likes.current?.showModal();
            }}
          >
            {compactCount(post.likes, language)}
          </button>
        )}
        <button
          type="button"
          className="cap-act"
          aria-label={post.comments ? fill(texts.capCommentsN, { n: post.comments }) : texts.capComment}
          onClick={() => {
            if (inline) return document.getElementById(`compose-${post.id}`)?.focus();
            setCommentsOpened((n) => n + 1);
            comments.current?.showModal();
          }}
        >
          <Icon d={icons.comment} />
          {post.comments > 0 && <span className="cap-n">{compactCount(post.comments, language)}</span>}
        </button>
        <button
          type="button"
          className={`cap-act${copied ? " on-copy" : ""}`}
          aria-label={copied ? texts.capCopied : texts.capCopyLink}
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          <Icon d={copied ? "M5 12.5l4.5 4.5L19 7.5" : icons.link} />
        </button>
      </div>

      {editing ? (
        <form
          className="cap-edit"
          onSubmit={(event) => {
            event.preventDefault();
            change({ caption: draft.trim() || null });
          }}
        >
          <textarea
            value={draft}
            maxLength={postLimits.caption}
            rows={2}
            aria-label={texts.capCaption}
            // biome-ignore lint/a11y/noAutofocus: the editor opens from the menu to be typed in
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="row">
            <span className="meta">
              {draft.length}/{postLimits.caption}
            </span>
            <button type="button" className="pill" onClick={() => setEditing(false)}>
              {texts.cancel}
            </button>
            <button type="submit" className="pill solid">
              {texts.capSaveCaption}
            </button>
          </div>
        </form>
      ) : (
        post.caption && (
          <p className="cap-caption">
            <Link href={`/u/${post.author.handle}`} className="who-name">
              {post.author.handle}
            </Link>{" "}
            {post.caption}
            {post.editedAt && <span className="cap-edited"> · {texts.capEdited}</span>}
          </p>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {inline ? (
        <CommentThread
          post={post}
          texts={texts}
          now={now}
          opened={commentsOpened}
          onCount={(delta) => setPost((p) => ({ ...p, comments: Math.max(0, p.comments + delta) }))}
        />
      ) : (
        <>
          {post.comments > 0 && (
            <button
              type="button"
              className="cap-view-comments"
              onClick={() => {
                setCommentsOpened((n) => n + 1);
                comments.current?.showModal();
              }}
            >
              {post.comments === 1 ? texts.capCommentsOne : fill(texts.capViewComments, { n: post.comments })}
            </button>
          )}
          <Sheet dialog={comments} title={texts.capComments} wide>
            <CommentThread
              post={post}
              texts={texts}
              now={now}
              opened={commentsOpened}
              onCount={(delta) => setPost((p) => ({ ...p, comments: Math.max(0, p.comments + delta) }))}
            />
          </Sheet>
        </>
      )}
      <Sheet dialog={likes} title={texts.capLikesTitle}>
        <LikesList postId={post.id} texts={texts} opened={likesOpened} />
      </Sheet>
      <ShotViewer media={post.media} index={viewing} texts={texts} onClose={() => setViewing(null)} />
    </article>
  );
}

/** A sheet with a heading and a close button; Escape or a tap on the backdrop closes it. */
function Sheet({
  dialog,
  title,
  wide = false,
  children,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <dialog
      ref={dialog}
      className={`sheet cap-sheet${wide ? " cap-wide" : ""}`}
      aria-labelledby={heading}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") dialog.current?.close();
      }}
    >
      <div className="sheet-body">
        <div className="cap-sheet-head">
          <h3 id={heading}>{title}</h3>
          <button
            type="button"
            className="pill icon"
            aria-label={title}
            onClick={() => dialog.current?.close()}
          >
            <Icon d={icons.close} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function LikesList({ postId, texts, opened }: { postId: string; texts: UiStrings; opened: number }) {
  const [page, setPage] = useState<LikesPage | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again each time the sheet opens
  useEffect(() => {
    if (!opened) return;
    call<LikesPage>(`posts/${postId}/likes`).then((done) =>
      setPage(done.body ?? { items: [], next: null, hidden: 0 }),
    );
  }, [opened]);
  if (!page) return <div className="cap-loading" aria-busy="true" />;
  if (!page.items.length && !page.hidden) return <p className="empty">{texts.capNoLikes}</p>;
  return (
    <>
      <ul className="people cap-likers">
        {page.items.map((person) => (
          <li key={person.userId} className="person">
            <Link href={`/u/${person.handle}`} className="who">
              <Avatar person={person} size={36} />
              <span className="lines">
                <span className="name">{shownName(person)}</span>
                <span className="meta">@{person.handle}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {page.hidden > 0 && <p className="meta">{fill(texts.capLikesHidden, { n: page.hidden })}</p>}
    </>
  );
}

/** One comment: who, what, when, and Reply, Delete or Report. */
function CommentRow({
  comment,
  texts,
  now,
  canReply,
  onReply,
  onDelete,
  children,
}: {
  comment: PostComment;
  texts: UiStrings;
  now: number;
  canReply: boolean;
  onReply: (comment: PostComment) => void;
  onDelete: (comment: PostComment) => void;
  children?: ReactNode;
}) {
  const report = useRef<HTMLDialogElement>(null);
  const mine = comment.canDelete;
  return (
    <li className={`cap-comment${comment.replyTo ? " is-reply" : ""}`}>
      <Link
        href={`/u/${comment.author.handle}`}
        tabIndex={-1}
        aria-hidden="true"
        className="cap-comment-face"
      >
        <Avatar person={comment.author} size={comment.replyTo ? 26 : 32} />
      </Link>
      <div className="cap-comment-body">
        <p>
          <Link href={`/u/${comment.author.handle}`} className="who-name">
            {comment.author.handle}
          </Link>{" "}
          {comment.text}
        </p>
        <p className="cap-comment-meta">
          <When iso={comment.createdAt} language={texts.language} now={now} />
          {canReply && (
            <button type="button" className="link-button" onClick={() => onReply(comment)}>
              {texts.capReply}
            </button>
          )}
          {mine ? (
            <button
              type="button"
              className="link-button"
              aria-label={texts.capDeleteComment}
              onClick={() => onDelete(comment)}
            >
              {texts.capDeleteShort}
            </button>
          ) : (
            <button
              type="button"
              className="link-button"
              aria-label={texts.capReportComment}
              onClick={() => report.current?.showModal()}
            >
              {texts.capReportShort}
            </button>
          )}
        </p>
        {children}
      </div>
      {!mine && (
        <ReportSheet
          dialog={report}
          person={{ userId: comment.id, displayName: comment.author.displayName }}
          texts={texts}
          kind="comment"
          title={texts.capReportCommentTitle}
          lead={texts.capReportCommentLead}
        />
      )}
    </li>
  );
}

/** The comments of a post, one level of replies under each, and the box to write one. */
function CommentThread({
  post,
  texts,
  now,
  opened,
  onCount,
}: {
  post: Post;
  texts: UiStrings;
  now: number;
  /** Goes up each time the comments are opened: they are read again. */
  opened: number;
  onCount: (delta: number) => void;
}) {
  const [items, setItems] = useState<PostComment[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (before?: string) => {
      const done = await call<CommentPage>(`posts/${post.id}/comments${before ? `?before=${before}` : ""}`);
      const page = done.body ?? { items: [], next: null };
      setItems((list) => (before ? [...(list ?? []), ...page.items] : page.items));
      setNext(page.next);
    },
    [post.id],
  );
  useEffect(() => {
    if (opened) load();
  }, [opened, load]);

  const send = async () => {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setError(null);
    const done = await call<PostComment>(`posts/${post.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text: said, ...(replyTo ? { replyTo: replyTo.id } : {}) }),
    });
    setBusy(false);
    if (!done.ok || !done.body) {
      setError(texts[postError(done.body?.code, done.status) as keyof UiStrings] as string);
      return;
    }
    setItems((list) => withComment(list ?? [], done.body as PostComment));
    setText("");
    setReplyTo(null);
    onCount(1);
  };
  const remove = async (comment: PostComment) => {
    if (!window.confirm(texts.capConfirmDeleteComment)) return;
    const done = await call(`posts/${post.id}/comments/${comment.id}`, { method: "DELETE" });
    if (!done.ok) return setError(texts.failed);
    const left = withoutComment(items ?? [], comment.id);
    setItems(left.items);
    onCount(-left.removed);
  };
  const reply = (comment: PostComment) => {
    setReplyTo(comment);
    box.current?.focus();
  };

  return (
    <div className="cap-thread">
      {items === null ? (
        <div className="cap-loading" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="empty">{post.commentsOff ? texts.capCommentsOffNote : texts.capNoComments}</p>
      ) : (
        <ul className="cap-comments">
          {items.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              texts={texts}
              now={now}
              canReply={!post.commentsOff}
              onReply={reply}
              onDelete={remove}
            >
              {(comment.replies ?? []).length > 0 && (
                <ul className="cap-replies">
                  {(comment.replies ?? []).map((r) => (
                    <CommentRow
                      key={r.id}
                      comment={r}
                      texts={texts}
                      now={now}
                      canReply={false}
                      onReply={reply}
                      onDelete={remove}
                    />
                  ))}
                </ul>
              )}
            </CommentRow>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="pill cap-older" onClick={() => load(next)}>
          {texts.capOlderComments}
        </button>
      )}
      {post.commentsOff ? (
        items && items.length > 0 && <p className="meta">{texts.capCommentsOffNote}</p>
      ) : (
        <form
          className="cap-compose"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {replyTo && (
            <p className="cap-replying">
              {fill(texts.capReplyingTo, { name: `@${replyTo.author.handle}` })}
              <button type="button" className="link-button" onClick={() => setReplyTo(null)}>
                {texts.capCancelReply}
              </button>
            </p>
          )}
          <div className="cap-compose-row">
            <textarea
              id={`compose-${post.id}`}
              ref={box}
              value={text}
              rows={1}
              maxLength={postLimits.comment}
              placeholder={texts.capAddComment}
              aria-label={texts.capAddComment}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="pill solid cap-send" disabled={busy || !text.trim()}>
              <Icon d={icons.send} />
              <span>{texts.capSend}</span>
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** Pages through a list of posts as the reader scrolls (and with a button, for keyboards). */
function usePaging(source: CaptureSource, initial: PostPage) {
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = useCallback(async () => {
    if (!next || loading) return;
    setLoading(true);
    const done = await call<PostPage>(`${listPath(source)}?before=${encodeURIComponent(next)}`);
    if (done.body) {
      const page = done.body;
      setItems((list) => [...list, ...page.items.filter((p) => !list.some((known) => known.id === p.id))]);
      setNext(page.next);
    }
    setLoading(false);
  }, [next, loading, source]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return;
    const watcher = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting)) more();
      },
      { rootMargin: "600px 0px" },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [next, more]);
  return { items, setItems, next, loading, more, sentinel };
}

/** The Captures feed: posts as cards, newest first, more as one scrolls. Friends' new posts wait
 *  behind a "new" pill rather than pushing the page down. */
export function CaptureFeed({
  texts,
  initial,
  source,
  now: renderedAt,
  composer,
  empty,
}: {
  texts: UiStrings;
  initial: PostPage;
  source: CaptureSource;
  now: number;
  composer?: ComposerSetup;
  empty: ReactNode;
}) {
  const { items, setItems, next, loading, more, sentinel } = usePaging(source, initial);
  const [waiting, setWaiting] = useState<Post[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useLiveEvents((event) => {
    if (event.type === "post.new" && source.kind === "captures") {
      const post = event.data as Post;
      setWaiting((list) =>
        list.some((p) => p.id === post.id) || items.some((p) => p.id === post.id) ? list : [post, ...list],
      );
    }
    if (event.type === "post.removed") {
      const { postId } = event.data as { postId: string };
      setItems((list) => list.filter((p) => p.id !== postId));
      setWaiting((list) => list.filter((p) => p.id !== postId));
    }
    if (event.type === "post.counts") {
      const counts = event.data as { postId: string; likes: number; comments: number };
      setItems((list) =>
        list.map((p) =>
          p.id === counts.postId ? { ...p, likes: counts.likes, comments: counts.comments } : p,
        ),
      );
    }
  });

  const showWaiting = () => {
    setItems((list) => [...waiting, ...list.filter((p) => !waiting.some((w) => w.id === p.id))]);
    setFresh(new Set(waiting.map((p) => p.id)));
    setWaiting([]);
    setNow(Date.now());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="cap-feed">
      {composer && (
        <Composer
          texts={texts}
          setup={composer}
          onPosted={(post) => {
            setItems((list) => [post, ...list]);
            setFresh(new Set([post.id]));
          }}
        />
      )}
      {waiting.length > 0 && (
        <button type="button" className="pill cap-waiting" onClick={showWaiting}>
          <Icon d="M12 19V5M6 11l6-6 6 6" />
          {fill(texts.capNewPosts, { n: waiting.length })}
        </button>
      )}
      {items.length === 0 ? (
        empty
      ) : (
        <div className="cap-list">
          {items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              texts={texts}
              now={now}
              arrived={fresh.has(post.id)}
              onRemoved={(id) => setItems((list) => list.filter((p) => p.id !== id))}
            />
          ))}
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {next && (
        <div className="more-row">
          <button type="button" className="pill" onClick={more} disabled={loading}>
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

/** Posts as a grid of tiles (a profile, a game's page): each opens the post's own page. */
export function CaptureGrid({
  texts,
  initial,
  source,
  empty,
}: {
  texts: UiStrings;
  initial: PostPage;
  source: CaptureSource;
  empty: ReactNode;
}) {
  const { items, next, loading, more } = usePaging(source, initial);
  if (!items.length) return <>{empty}</>;
  return (
    <>
      <ul className="cap-grid">
        {items.map((post) => {
          const first = post.media[0];
          if (!first) return null;
          const still = first.kind === "clip" ? first.poster : (first.thumb ?? first.url);
          return (
            <li key={post.id}>
              <Link
                href={`/p/${post.id}`}
                className="cap-tile"
                aria-label={`${texts.capOpen}: ${post.caption ?? shownName(post.author)}`}
              >
                {still ? (
                  <img src={still} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="cap-tile-blank" aria-hidden="true" />
                )}
                {first.kind === "clip" ? (
                  <span className="cap-tile-badge">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8.5 5.8v12.4L18.5 12z" />
                    </svg>
                    {clipLength(first.durationMs)}
                  </span>
                ) : post.media.length > 1 ? (
                  <span className="cap-tile-badge">
                    <Icon d={icons.stack} />
                    {post.media.length}
                  </span>
                ) : null}
                <span className="cap-tile-over" aria-hidden="true">
                  <span>
                    <svg viewBox="0 0 24 24" className="fill" aria-hidden="true">
                      <path d={icons.heart} />
                    </svg>
                    {compactCount(post.likes, texts.language)}
                  </span>
                  <span>
                    <Icon d={icons.comment} />
                    {compactCount(post.comments, texts.language)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {next && (
        <div className="more-row">
          <button type="button" className="pill" onClick={more} disabled={loading}>
            {loading ? texts.loading : texts.loadMore}
          </button>
        </div>
      )}
    </>
  );
}

/** The composer: pick up to four screenshots or one clip from one's AnyTogether gallery (or
 *  upload), then a caption, the game and who sees it. */
export function Composer({
  texts,
  setup,
  onPosted,
}: {
  texts: UiStrings;
  setup: ComposerSetup;
  onPosted: (post: Post) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const heading = useId();
  const [step, setStep] = useState<"pick" | "say">("pick");
  const [pool, setPool] = useState<MediaItem[] | null>(null);
  const [picked, setPicked] = useState<MediaItem[]>([]);
  const [caption, setCaption] = useState("");
  const [game, setGame] = useState(setup.defaultGame ?? "");
  const [visibility, setVisibility] = useState<PostVisibility>(setup.visibility);
  const [commentsOn, setCommentsOn] = useState(true);
  const [uploading, setUploading] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setStep("pick");
    setPicked([]);
    setCaption("");
    setError(null);
    setGame(setup.defaultGame ?? "");
    setVisibility(setup.visibility);
    setCommentsOn(true);
    dialog.current?.showModal();
    const response = await fetch("/me/storage/me/media").catch(() => undefined);
    const body = (await response?.json().catch(() => null)) as { media?: MediaItem[] } | null;
    setPool((body?.media ?? []).filter((m) => m.kind !== "voice" && !m.hidden));
  };
  const problem = pickProblem(picked);
  const problemText = (key: NonNullable<typeof problem>) =>
    ({
      empty: texts.capEmptyPick,
      mixed: texts.capMixed,
      tooMany: texts.capTooMany,
      oneClip: texts.capOneClip,
      clipTooLong: texts.capClipTooLong,
    })[key];

  const upload = async (files: File[]) => {
    setError(null);
    for (const file of files) {
      const kind = kindOfFile(file);
      if (!kind) {
        setError(texts.notMedia);
        continue;
      }
      if (kind === "clip" && file.size > postLimits.clipBytes) {
        setError(texts.capBadMedia);
        continue;
      }
      setUploading(0);
      const made = await uploadMedia(file, kind, (f) => setUploading(Math.round(f * 100)));
      let item = made.body.media;
      if (!made.ok || !item) {
        setUploading(null);
        setError(texts[postError(made.body.code, made.status) as keyof UiStrings] as string);
        continue;
      }
      if (kind === "clip") {
        const poster = await posterOf(file);
        if (poster) {
          const response = await fetch(`/me/upload/${item.id}/poster`, { method: "PUT", body: poster }).catch(
            () => undefined,
          );
          const body = (await response?.json().catch(() => null)) as { media?: MediaItem } | null;
          if (body?.media) item = body.media;
        }
      }
      const shown = item;
      setPool((all) => [shown, ...(all ?? [])]);
      setPicked((all) => togglePick(all, shown));
    }
    setUploading(null);
  };

  const post = async () => {
    if (problem || posting) return;
    setPosting(true);
    setError(null);
    const done = await call<Post>("posts", {
      method: "POST",
      body: JSON.stringify({
        media: picked.map((m) => m.id),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(game ? { titleId: game } : {}),
        visibility,
        commentsOff: !commentsOn,
        source: "web",
      }),
    });
    setPosting(false);
    if (!done.ok || !done.body) {
      setError(texts[postError(done.body?.code, done.status) as keyof UiStrings] as string);
      return;
    }
    onPosted(done.body);
    dialog.current?.close();
  };

  return (
    <>
      <button type="button" className="cap-share" onClick={open}>
        <span className="cap-share-mark" aria-hidden="true">
          <Icon d={icons.plus} />
        </span>
        <span className="lines">
          <b>{texts.capShare}</b>
          <span className="meta">{texts.capShareHint}</span>
        </span>
      </button>
      <dialog
        ref={dialog}
        className="sheet cap-sheet cap-wide cap-composer"
        aria-labelledby={heading}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") dialog.current?.close();
        }}
      >
        <div className="sheet-body">
          <div className="cap-sheet-head">
            <h3 id={heading}>{texts.capShare}</h3>
            <span className="cap-steps" aria-hidden="true">
              <i className={step === "pick" ? "on" : undefined} />
              <i className={step === "say" ? "on" : undefined} />
            </span>
            <button
              type="button"
              className="pill icon"
              aria-label={texts.closeViewer}
              onClick={() => dialog.current?.close()}
            >
              <Icon d={icons.close} />
            </button>
          </div>
          {step === "pick" ? (
            <>
              <p className="hint">{texts.capPickLead}</p>
              {pool === null ? (
                <div className="pick-grid loading" aria-busy="true" />
              ) : pool.length === 0 ? (
                <p className="empty">{texts.capNothing}</p>
              ) : (
                <ul className="pick-grid cap-pick">
                  {pool.map((item) => {
                    const at = picked.findIndex((p) => p.id === item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`pick-cell${at >= 0 ? " on" : ""}`}
                          aria-pressed={at >= 0}
                          aria-label={texts[`kind_${item.kind}`]}
                          onClick={() => setPicked((all) => togglePick(all, item))}
                        >
                          <MediaTile item={item} texts={texts} />
                          <span className="pick-n" aria-hidden="true">
                            {at >= 0 ? at + 1 : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {(error || (problem && problem !== "empty")) && (
                <p className="error" role="alert">
                  {error ?? (problem ? problemText(problem) : null)}
                </p>
              )}
              <div className="row spread">
                <span className="meta-mono">
                  {picked[0]?.kind === "clip"
                    ? texts.capPickedClip
                    : fill(texts.capPicked, { n: picked.length })}
                </span>
                <input
                  ref={picker}
                  type="file"
                  hidden
                  multiple
                  accept="image/png,image/jpeg,image/webp,video/mp4"
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    event.target.value = "";
                    upload(files);
                  }}
                />
                <button
                  type="button"
                  className="pill"
                  disabled={uploading !== null}
                  onClick={() => picker.current?.click()}
                >
                  {uploading !== null ? fill(texts.capUploading, { p: uploading }) : texts.capUpload}
                </button>
                <button
                  type="button"
                  className="pill solid"
                  disabled={Boolean(problem) || uploading !== null}
                  onClick={() => {
                    setError(null);
                    setStep("say");
                  }}
                >
                  {texts.capNext}
                </button>
              </div>
            </>
          ) : (
            <form
              className="cap-say"
              onSubmit={(event) => {
                event.preventDefault();
                post();
              }}
            >
              <ul className="cap-chosen" aria-label={texts.capShare}>
                {picked.map((item) => (
                  <li key={item.id}>
                    <MediaTile item={item} texts={texts} />
                  </li>
                ))}
              </ul>
              <label className="cap-field">
                <span>{texts.capCaption}</span>
                <textarea
                  value={caption}
                  rows={3}
                  maxLength={postLimits.caption}
                  placeholder={texts.capCaptionPlaceholder}
                  onChange={(event) => setCaption(event.target.value)}
                />
                <span className="meta cap-counter">
                  {caption.length}/{postLimits.caption}
                </span>
              </label>
              {setup.games.length > 0 && (
                <label className="cap-field">
                  <span>{texts.capGame}</span>
                  <select value={game} onChange={(event) => setGame(event.target.value)}>
                    <option value="">{texts.capNoGame}</option>
                    {setup.games.map((g) => (
                      <option key={g.titleId} value={g.titleId}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <fieldset className="cap-field">
                <legend>{texts.capVisibility}</legend>
                <div
                  className="segmented two"
                  style={{ "--i": visibility === "public" ? 1 : 0 } as CSSProperties}
                >
                  <span className="thumb" aria-hidden="true" />
                  {(["friends", "public"] as const).map((choice) => (
                    <label key={choice}>
                      <input
                        type="radio"
                        name={`${heading}-visibility`}
                        value={choice}
                        checked={visibility === choice}
                        onChange={() => setVisibility(choice)}
                      />
                      <span>
                        <Icon d={choice === "public" ? icons.globe : icons.friends} />
                        {choice === "public" ? texts.capPublic : texts.capFriends}
                      </span>
                    </label>
                  ))}
                </div>
                <span className="meta">
                  {visibility === "public" ? texts.capPublicHint : texts.capFriendsHint}
                </span>
              </fieldset>
              <label className="toggle-row">
                <span className="lines">
                  <span>{texts.capAllowComments}</span>
                </span>
                <input
                  type="checkbox"
                  checked={commentsOn}
                  onChange={(event) => setCommentsOn(event.target.checked)}
                />
                <span className="toggle" />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row spread">
                <button type="button" className="pill" onClick={() => setStep("pick")}>
                  {texts.capBack}
                </button>
                <button type="submit" className="primary cap-post" disabled={posting}>
                  {posting ? texts.capPosting : texts.capPost}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
