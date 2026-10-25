"use client";

import { Avatar } from "@/components/Avatar";
import { LevelBadge } from "@/components/LevelBadge";
import { ProfileMenu } from "@/components/ProfileMenu";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import type { Friend, Person } from "@/lib/people";
import { fill } from "@/lib/people";
import {
  type Community,
  type CommunityCard,
  type CommunityMember,
  type CommunityRole,
  iconPresets,
  iconSrc,
  localArt,
} from "@/lib/psn";
import { json, social } from "@/lib/social";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export type GameOption = { titleId: string; name: string };

/** What an API refusal means for a person, in their words. */
function problemText(texts: UiStrings, status: number, code?: string) {
  if (status === 429) return texts.tooMany;
  if (code === "full") return texts.communityFull;
  if (code === "links_not_allowed") return texts.failed;
  return texts.failed;
}

/** One community in a list: its icon, name, game and size. */
export function CommunityRow({ community, texts }: { community: CommunityCard; texts: UiStrings }) {
  const { language } = texts;
  return (
    <Link href={`/communities/${community.id}`} className="community-row">
      <img className="community-icon" src={localArt(community.iconUrl) ?? iconSrc(community.icon)} alt="" />
      <span className="lines">
        <span className="name">{community.name}</span>
        {community.description && <span className="desc">{community.description}</span>}
        <span className="meta">
          {community.game ? `${localName(community.game.names, language) || community.titleId} · ` : ""}
          {fill(texts.membersN, { n: community.members })}
          {community.upcomingEvents > 0 && ` · ${fill(texts.upcomingN, { n: community.upcomingEvents })}`}
        </span>
      </span>
      {community.role && (
        <span className={`chip role-${community.role}`}>{texts[`role_${community.role}`]}</span>
      )}
      {!community.role && community.visibility === "invite" && (
        <span className="chip">{texts.visibilityShort_invite}</span>
      )}
    </Link>
  );
}

/** Searching public communities by name and game, the list replaced as one types. */
export function CommunityFinder({
  texts,
  initial,
  games,
  titleId,
}: {
  texts: UiStrings;
  initial: CommunityCard[];
  games: GameOption[];
  titleId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [game, setGame] = useState(titleId ?? "");
  const [list, setList] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams();
      if (query.trim().length >= 2) params.set("q", query.trim());
      if (game) params.set("titleId", game);
      const found = await social<{ communities: CommunityCard[] }>(
        `communities${params.size ? `?${params}` : ""}`,
      );
      if (found.body) setList(found.body.communities);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, game]);

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={texts.searchCommunities}
          aria-label={texts.searchCommunities}
          maxLength={40}
        />
        <select
          value={game}
          onChange={(event) => setGame(event.target.value)}
          aria-label={texts.communityGame}
        >
          <option value="">{texts.communityAnyGame}</option>
          {games.map((g) => (
            <option key={g.titleId} value={g.titleId}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      {list.length === 0 ? (
        <p className="empty">{texts.noCommunities}</p>
      ) : (
        <ul className="community-list">
          {list.map((community) => (
            <li key={community.id}>
              <CommunityRow community={community} texts={texts} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A dialog with a heading, closed by a tap outside it. */
function Sheet({
  dialog,
  title,
  children,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  title: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby={heading}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") dialog.current?.close();
      }}
    >
      <div className="sheet-body">
        <h3 id={heading}>{title}</h3>
        {children}
      </div>
    </dialog>
  );
}

/** Making a community, or (with `community`) changing one. */
export function CommunityComposer({
  texts,
  games,
  community,
  defaultGame,
  canChangeVisibility = true,
}: {
  texts: UiStrings;
  games: GameOption[];
  community?: Community;
  defaultGame?: string | null;
  canChangeVisibility?: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(community?.name ?? "");
  const [titleId, setTitleId] = useState(community?.titleId ?? defaultGame ?? "");
  const [description, setDescription] = useState(community?.description ?? "");
  const [icon, setIcon] = useState(community?.icon ?? "pad-cosmic");
  const [visibility, setVisibility] = useState<"public" | "invite">(community?.visibility ?? "public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options =
    community?.titleId && !games.some((g) => g.titleId === community.titleId)
      ? [
          {
            titleId: community.titleId,
            name: localName(community.game?.names ?? {}, texts.language) || community.titleId,
          },
          ...games,
        ]
      : games;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      titleId: titleId || null,
      description: description.trim() ? description : community ? null : undefined,
      icon,
      ...(canChangeVisibility ? { visibility } : {}),
    };
    const saved = await social<Community & { code?: string }>(
      community ? `communities/${community.id}` : "communities",
      {
        method: community ? "PATCH" : "POST",
        ...json(body),
      },
    );
    setBusy(false);
    if (!saved.ok || !saved.body) return setError(problemText(texts, saved.status, saved.body?.code));
    dialog.current?.close();
    if (community) router.refresh();
    else router.push(`/communities/${saved.body.id}`);
  }

  return (
    <>
      <button
        type="button"
        className={community ? "pill" : "primary small"}
        onClick={() => dialog.current?.showModal()}
      >
        {community ? texts.editCommunity : texts.newCommunity}
      </button>
      <Sheet dialog={dialog} title={community ? texts.editCommunity : texts.newCommunity}>
        <form className="form" onSubmit={submit}>
          <label className="stack">
            <span>{texts.communityName}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={3}
              maxLength={40}
              required
            />
          </label>
          <label className="stack">
            <span>{texts.communityGame}</span>
            <select value={titleId} onChange={(event) => setTitleId(event.target.value)}>
              <option value="">{texts.communityGameNone}</option>
              {options.map((g) => (
                <option key={g.titleId} value={g.titleId}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>{texts.communityDescription}</span>
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="stack">
            <span>{texts.communityIcon}</span>
            <fieldset className="icon-grid">
              <legend className="visually-hidden">{texts.communityIcon}</legend>
              {iconPresets.map((id) => (
                <label key={id} className={icon === id ? "on" : undefined} title={id}>
                  <input type="radio" name="icon" checked={icon === id} onChange={() => setIcon(id)} />
                  <img src={iconSrc(id)} alt={id} loading="lazy" />
                </label>
              ))}
            </fieldset>
          </div>
          {canChangeVisibility && (
            <fieldset className="reasons">
              <legend className="visually-hidden">{texts.visibility_public}</legend>
              {(["public", "invite"] as const).map((value) => (
                <label key={value} className={visibility === value ? "on" : undefined}>
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                  />
                  <span>{texts[`visibility_${value}`]}</span>
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="pill" onClick={() => dialog.current?.close()}>
              {texts.cancel}
            </button>
            <button type="submit" className="primary small" disabled={busy || name.trim().length < 3}>
              {community ? texts.save : texts.create}
            </button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

/** Join, leave, the chat, inviting friends, editing and deleting, and reporting it. */
export function CommunityActions({
  texts,
  community,
  games,
}: {
  texts: UiStrings;
  community: Community;
  games: GameOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = community.role;
  const staff = role === "owner" || role === "moderator";

  async function act(path: string, method = "POST", confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    const done = await social<{ code?: string }>(path, { method });
    setBusy(false);
    if (!done.ok) return setError(problemText(texts, done.status, done.body?.code));
    if (method === "DELETE") router.push("/communities");
    else router.refresh();
  }

  return (
    <>
      <div className="community-actions">
        {!role && (
          <button
            type="button"
            className="primary"
            disabled={busy || community.members >= community.maxMembers}
            onClick={() => act(`communities/${community.id}/join`)}
          >
            {community.members >= community.maxMembers ? texts.communityFull : texts.communityJoin}
          </button>
        )}
        {!role && community.invited && (
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() => act(`communities/${community.id}/decline`)}
          >
            {texts.decline}
          </button>
        )}
        {role && community.conversationId && (
          <Link href={`/messages?c=${community.conversationId}`} className="pill">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A1.5 1.5 0 0 1 4 15.5z" />
            </svg>
            {texts.openChat}
          </Link>
        )}
        {role && (community.visibility === "public" || staff) && (
          <InviteFriends texts={texts} community={community} />
        )}
        {staff && (
          <CommunityComposer
            texts={texts}
            games={games}
            community={community}
            canChangeVisibility={role === "owner"}
          />
        )}
        {role && role !== "owner" && (
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() =>
              act(
                `communities/${community.id}/leave`,
                "POST",
                fill(texts.confirmLeaveCommunity, { name: community.name }),
              )
            }
          >
            {texts.leave}
          </button>
        )}
        {role === "owner" && (
          <button
            type="button"
            className="pill danger"
            disabled={busy}
            onClick={() =>
              act(
                `communities/${community.id}`,
                "DELETE",
                fill(texts.confirmDeleteCommunity, { name: community.name }),
              )
            }
          >
            {texts.deleteCommunity}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {role !== "owner" && (
        <ProfileMenu
          person={{ userId: community.id, displayName: community.name }}
          texts={texts}
          kind="community"
          label={texts.reportCommunity}
          title={texts.reportCommunity}
          lead={texts.communityReportLead}
        />
      )}
    </>
  );
}

/** Friends not in the community yet, to invite. */
function InviteFriends({ texts, community }: { texts: UiStrings; community: Community }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());

  async function open() {
    dialog.current?.showModal();
    const [list, inside] = await Promise.all([
      fetch("/me/friends")
        .then((r) => r.json() as Promise<{ friends: Friend[] }>)
        .catch(() => ({ friends: [] })),
      social<{ members: CommunityMember[] }>(`communities/${community.id}/members`),
    ]);
    setFriends(list.friends ?? []);
    setMembers(new Set((inside.body?.members ?? []).map((m) => m.userId)));
  }

  async function invite(friend: Person) {
    const done = await social(`communities/${community.id}/invites`, {
      method: "POST",
      ...json({ userIds: [friend.userId] }),
    });
    if (done.ok) setSent((set) => new Set([...set, friend.userId]));
  }

  const open_ = (friends ?? []).filter((f) => !members.has(f.userId));
  return (
    <>
      <button type="button" className="pill" onClick={open}>
        {texts.communityInviteFriends}
      </button>
      <Sheet dialog={dialog} title={texts.communityInviteFriends}>
        {friends === null ? (
          <p className="hint">{texts.loading}</p>
        ) : open_.length === 0 ? (
          <p className="hint">{texts.communityNoFriendsToInvite}</p>
        ) : (
          <ul className="people picker">
            {open_.map((friend) => (
              <li key={friend.userId} className="person">
                <span className="who">
                  <Avatar person={friend} size={34} />
                  <span className="lines">
                    <span className="name">{friend.displayName}</span>
                    <span className="meta">@{friend.handle}</span>
                  </span>
                </span>
                <button
                  type="button"
                  className="pill"
                  disabled={sent.has(friend.userId)}
                  onClick={() => invite(friend)}
                >
                  {sent.has(friend.userId) ? texts.communityInvited : texts.invite}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="pill" onClick={() => dialog.current?.close()}>
            {texts.done}
          </button>
        </div>
      </Sheet>
    </>
  );
}

const roleRank: Record<CommunityRole, number> = { owner: 0, moderator: 1, member: 2 };

/** The members with their roles and levels; moderators get a menu per member. */
export function MemberList({
  texts,
  community,
  initial,
  me,
}: {
  texts: UiStrings;
  community: Community;
  initial: CommunityMember[];
  me: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [bans, setBans] = useState<{ user: Person; reason: string | null }[] | null>(null);
  const role = community.role;

  async function act(member: CommunityMember, action: "moderator" | "member" | "owner" | "kick" | "ban") {
    const name = { name: member.displayName };
    const ask =
      action === "kick"
        ? fill(texts.confirmCommunityKick, name)
        : action === "ban"
          ? fill(texts.confirmBan, name)
          : action === "owner"
            ? fill(texts.confirmHandOver, name)
            : null;
    if (ask && !window.confirm(ask)) return;
    setError(null);
    const base = `communities/${community.id}`;
    const done =
      action === "moderator" || action === "member"
        ? await social(`${base}/members/${member.userId}/role`, { method: "PUT", ...json({ role: action }) })
        : action === "owner"
          ? await social(`${base}/owner`, { method: "POST", ...json({ userId: member.userId }) })
          : action === "kick"
            ? await social(`${base}/members/${member.userId}`, { method: "DELETE" })
            : await social(`${base}/bans`, { method: "POST", ...json({ userId: member.userId }) });
    if (!done.ok) return setError(done.status === 429 ? texts.tooMany : texts.failed);
    if (action === "kick" || action === "ban")
      setMembers((list) => list.filter((m) => m.userId !== member.userId));
    else router.refresh();
    if (action === "moderator" || action === "member")
      setMembers((list) => list.map((m) => (m.userId === member.userId ? { ...m, role: action } : m)));
  }

  async function showBans() {
    const found = await social<{ bans: { user: Person; reason: string | null }[] }>(
      `communities/${community.id}/bans`,
    );
    setBans(found.body?.bans ?? []);
  }

  async function unban(user: Person) {
    const done = await social(`communities/${community.id}/bans/${user.userId}`, { method: "DELETE" });
    if (done.ok) setBans((list) => (list ?? []).filter((b) => b.user.userId !== user.userId));
  }

  const mayAct = (member: CommunityMember) =>
    member.userId !== me && !!role && role !== "member" && roleRank[member.role] > roleRank[role];

  return (
    <>
      <ul className="people">
        {[...members]
          .sort((x, y) => roleRank[x.role] - roleRank[y.role] || x.displayName.localeCompare(y.displayName))
          .map((member) => (
            <li key={member.userId} className="person member-row">
              <Link href={`/u/${member.handle}`} className="who">
                <Avatar person={member} size={36} />
                <span className="lines">
                  <span className="name">
                    {member.displayName}
                    <LevelBadge level={member.level} texts={texts} />
                    {member.role !== "member" && (
                      <span className={`chip role-${member.role}`}>{texts[`role_${member.role}`]}</span>
                    )}
                  </span>
                  <span className="meta">@{member.handle}</span>
                </span>
              </Link>
              {mayAct(member) && (
                <MemberMenu
                  texts={texts}
                  member={member}
                  owner={role === "owner"}
                  onPick={(action) => act(member, action)}
                />
              )}
            </li>
          ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {role && role !== "member" && (
        <div className="row start" style={{ marginTop: 14 }}>
          {bans === null ? (
            <button type="button" className="quiet" onClick={showBans}>
              {texts.bans}
            </button>
          ) : bans.length === 0 ? (
            <p className="hint">{texts.bans}: 0</p>
          ) : (
            <ul className="people" style={{ width: "100%" }}>
              {bans.map((ban) => (
                <li key={ban.user.userId} className="person">
                  <span className="who">
                    <Avatar person={ban.user} size={30} />
                    <span className="lines">
                      <span className="name">{ban.user.displayName}</span>
                      <span className="meta">{ban.reason ?? `@${ban.user.handle}`}</span>
                    </span>
                  </span>
                  <button type="button" className="pill" onClick={() => unban(ban.user)}>
                    {texts.unban}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function MemberMenu({
  texts,
  member,
  owner,
  onPick,
}: {
  texts: UiStrings;
  member: CommunityMember;
  owner: boolean;
  onPick: (action: "moderator" | "member" | "owner" | "kick" | "ban") => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (action: Parameters<typeof onPick>[0]) => {
    setOpen(false);
    onPick(action);
  };
  return (
    <div className="menu" ref={box}>
      <button
        type="button"
        className="pill icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={fill(texts.memberOptions, { name: member.displayName })}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="pop" role="menu">
          {owner && member.role === "member" && (
            <button type="button" role="menuitem" onClick={() => pick("moderator")}>
              {texts.makeModerator}
            </button>
          )}
          {owner && member.role === "moderator" && (
            <button type="button" role="menuitem" onClick={() => pick("member")}>
              {texts.removeModerator}
            </button>
          )}
          {owner && (
            <button type="button" role="menuitem" onClick={() => pick("owner")}>
              {texts.handOver}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => pick("kick")}>
            {texts.communityKick}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => pick("ban")}>
            {texts.ban}
          </button>
        </div>
      )}
    </div>
  );
}
