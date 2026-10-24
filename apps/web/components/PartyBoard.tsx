"use client";

import { Avatar } from "@/components/Avatar";
import { useLive, useLiveEvents } from "@/components/Live";
import { Menu } from "@/components/MessagesBoard";
import type { UiStrings } from "@/lib/i18n";
import { type Friend, type Person, byPresence, fill } from "@/lib/people";
import { type CallJoin, type Party, type PartyInvite, json, maxPartySize, social } from "@/lib/social";
import { VoiceMesh, type VoiceState, keyLabel } from "@/lib/voice";
import { useCallback, useEffect, useRef, useState } from "react";

type FriendWithParty = Friend & {
  presence: Friend["presence"] & { party?: { id: string; size: number; open: boolean } };
};
type Mode = "open" | "ptt";

const loadPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem("party-voice") ?? "{}") as { mode?: Mode; key?: string };
    return { mode: saved.mode === "ptt" ? "ptt" : "open", key: saved.key || "KeyV" } as {
      mode: Mode;
      key: string;
    };
  } catch {
    return { mode: "open" as Mode, key: "KeyV" };
  }
};
const savePrefs = (prefs: { mode: Mode; key: string }) => {
  try {
    localStorage.setItem("party-voice", JSON.stringify(prefs));
  } catch {}
};
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The party page: start or join a party, invite friends, the members with the leader's tools,
 *  and voice in the browser over WebRTC with the calls API and gateway signalling. */
export function PartyBoard({
  texts,
  initialParty,
  initialInvites,
  initialFriends,
}: {
  texts: UiStrings;
  initialParty: Party | null;
  initialInvites: PartyInvite[];
  initialFriends: FriendWithParty[];
}) {
  const { me, session, send, status } = useLive();
  const [party, setParty] = useState(initialParty);
  const [invites, setInvites] = useState(initialInvites);
  const [friends, setFriends] = useState(initialFriends);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<"invite" | "friends">("invite");

  // Voice
  const mesh = useRef<VoiceMesh | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [joining, setJoining] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [prefs, setPrefs] = useState<{ mode: Mode; key: string }>({ mode: "open", key: "KeyV" });
  const [held, setHeld] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => setPrefs(loadPrefs()), []);

  const reload = useCallback(async () => {
    const [mine, list] = await Promise.all([
      social<{ party: Party | null; invites: PartyInvite[] }>("me/party"),
      fetch("/me/friends")
        .then((r) => (r.ok ? (r.json() as Promise<{ friends: FriendWithParty[] }>) : null))
        .catch(() => null),
    ]);
    if (mine.body) {
      setParty(mine.body.party);
      setInvites(mine.body.invites);
    }
    if (list) setFriends(list.friends);
  }, []);

  const stopVoice = useCallback((tellServer: boolean) => {
    const id = mesh.current ? callIdRef.current : null;
    mesh.current?.close();
    mesh.current = null;
    setVoice(null);
    setCallId(null);
    if (tellServer && id) social(`calls/${id}/leave`, { method: "POST" });
  }, []);
  const callIdRef = useRef<string | null>(null);
  callIdRef.current = callId;

  // Leaving the page leaves the call.
  useEffect(() => {
    const away = () => {
      const id = callIdRef.current;
      if (id) navigator.sendBeacon(`/me/social/calls/${id}/leave`);
    };
    window.addEventListener("pagehide", away);
    return () => {
      window.removeEventListener("pagehide", away);
      if (mesh.current) stopVoice(true);
    };
  }, [stopVoice]);

  const talking = micOn && (prefs.mode === "open" || held);
  useEffect(() => mesh.current?.setTalking(talking), [talking]);

  // The others see who muted themselves (push-to-talk not held is not muted).
  const toldMuted = useRef(false);
  useEffect(() => {
    if (!callId) {
      toldMuted.current = false;
      return;
    }
    if (toldMuted.current === !micOn) return;
    toldMuted.current = !micOn;
    social(`calls/${callId}/mute`, { method: "POST", ...json({ muted: !micOn }) });
  }, [callId, micOn]);

  // Push to talk: hold the key anywhere on the page but in a text field.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (capturing) {
        event.preventDefault();
        if (event.code !== "Escape") {
          const next = { ...prefs, key: event.code };
          setPrefs(next);
          savePrefs(next);
        }
        setCapturing(false);
        return;
      }
      if (prefs.mode === "ptt" && event.code === prefs.key && !event.repeat && !typing(event.target)) {
        event.preventDefault();
        setHeld(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === prefs.key) setHeld(false);
    };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [prefs, capturing]);

  useLiveEvents((event) => {
    const data = event.data;
    switch (event.type) {
      case "party.member_left":
        if (data.userId === me && data.reason === "kicked") {
          setNotice({ kind: "error", text: texts.kickedNotice });
          stopVoice(false);
        }
        return reload();
      case "party.ended":
        stopVoice(false);
        return reload();
      case "party.invite":
      case "party.updated":
      case "party.member_joined":
        return reload();
      case "presence.updated":
        setFriends((all) =>
          all.map((f) => (f.userId === data.userId ? { ...f, presence: { ...data, userId: undefined } } : f)),
        );
        return;
      case "call.left":
        if (data.callId === callIdRef.current) mesh.current?.drop(data.userId, false);
        return reload();
      case "call.joined":
      case "call.updated":
        return reload();
      case "call.ended":
        if (data.callId === callIdRef.current) stopVoice(false);
        return reload();
      case "signal":
        if (data.call === callIdRef.current) mesh.current?.onSignal(data).catch(() => {});
        return;
      case "live.ready":
        return reload();
    }
  });

  async function act(key: string, path: string, init: RequestInit = { method: "POST" }) {
    setBusy(key);
    setNotice(null);
    const result = await social<{ code?: string }>(path, init);
    if (!result.ok)
      setNotice({ kind: "error", text: result.body?.code === "full" ? texts.partyFull : texts.failed });
    await reload();
    setBusy(null);
    return result.ok;
  }

  async function joinVoice() {
    if (!party || !session) return;
    setJoining(true);
    setNotice(null);
    let stream: MediaStream | null = null;
    try {
      stream = await VoiceMesh.microphone();
      const joined = await social<CallJoin>("calls", { method: "POST", ...json({ partyId: party.id }) });
      if (!joined.body?.call) throw new Error("no call");
      const call = joined.body.call.id;
      const started = new VoiceMesh({
        me,
        stream,
        iceServers: joined.body.iceServers,
        signal: (to, device, kind, data) => send({ op: "signal", to, device, call, kind, data }),
        onChange: () => setVoice(started.state()),
      });
      mesh.current = started;
      setCallId(call);
      started.setTalking(micOn && prefs.mode === "open");
      setVoice(started.state());
      // We are the newcomer: we call everyone already in.
      for (const peer of joined.body.call.in) if (peer.userId !== me) await started.connectTo(peer);
      await reload();
    } catch (error) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      const denied = error instanceof DOMException && /NotAllowed|Security|NotFound/.test(error.name);
      setNotice({ kind: "error", text: denied ? texts.micDenied : texts.failed });
    } finally {
      setJoining(false);
    }
  }

  // Everyone but the people in it: friends to invite, online first.
  const inParty = new Set(party?.members.map((m) => m.userId));
  const invitedSet = new Set(party?.invited.map((p) => p.userId));
  const invitable = [...friends].sort(byPresence).filter((f) => !inParty.has(f.userId));
  const openParties = friends.filter((f) => f.presence.party?.open && f.presence.party.id !== party?.id);
  const leader = party?.leaderId === me;
  const inVoice = new Set(party?.call?.in ?? []);
  const mutedSet = new Set(party?.call?.muted ?? []);
  const peerState = new Map(voice?.peers.map((p) => [p.userId, p]));
  const connected = voice?.peers.filter((p) => p.state === "connected").length ?? 0;
  const connecting = voice?.peers.filter((p) => p.state !== "connected").length ?? 0;
  const failed = voice?.peers.find((p) => p.state === "failed");

  if (!party)
    return (
      <section className="page party-page">
        <h2 className="in d1">{texts.party}</h2>
        <p className="lead in d2">{texts.partyLead}</p>
        <div className="in d3">
          <div className="card start-party">
            <span className="sub">{texts.privacyLabel}</span>
            <Segmented
              value={privacy}
              onChange={setPrivacy}
              options={[
                ["invite", texts.privacyInvite],
                ["friends", texts.privacyFriends],
              ]}
            />
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() => act("start", "parties", { method: "POST", ...json({ privacy }) })}
            >
              {texts.startParty}
            </button>
          </div>
          {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
          {invites.length > 0 && (
            <div className="card">
              <h3 className="sub">
                {texts.invitesTitle} <span className="n">{invites.length}</span>
              </h3>
              <ul className="people">
                {invites.map((invite) => (
                  <li key={invite.partyId} className="person">
                    {invite.from && <Avatar person={invite.from} />}
                    <span className="lines">
                      <span className="name">{invite.from?.displayName ?? "?"}</span>
                      <span className="meta">
                        {fill(texts.invitedYou, { name: invite.from?.displayName ?? "?", n: invite.size })}
                      </span>
                    </span>
                    <div className="acts">
                      <button
                        type="button"
                        className="primary small"
                        disabled={busy !== null}
                        onClick={() => act(invite.partyId, `parties/${invite.partyId}/join`)}
                      >
                        {texts.join}
                      </button>
                      <button
                        type="button"
                        className="pill"
                        disabled={busy !== null}
                        onClick={() => act(invite.partyId, `parties/${invite.partyId}/decline`)}
                      >
                        {texts.decline}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {openParties.length > 0 && (
            <div className="card">
              <h3 className="sub">{texts.openParties}</h3>
              <ul className="people">
                {openParties.map((friend) => (
                  <li key={friend.userId} className="person">
                    <Avatar person={friend} presence={friend.presence.state} />
                    <span className="lines">
                      <span className="name">{fill(texts.partyOf, { name: friend.displayName })}</span>
                      <span className="meta">
                        {friend.presence.party?.size}/{maxPartySize}
                      </span>
                    </span>
                    <div className="acts">
                      <button
                        type="button"
                        className="primary small"
                        disabled={busy !== null || (friend.presence.party?.size ?? 0) >= maxPartySize}
                        onClick={() => act(friend.userId, `parties/${friend.presence.party?.id}/join`)}
                      >
                        {texts.join}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    );

  return (
    <section className="page party-page">
      <div className="party-title in d1">
        <h2>{texts.party}</h2>
        <span className="count">
          {party.members.length}/{maxPartySize}
        </span>
        {status !== "ready" && <span className="tag live-state">{texts.reconnecting}</span>}
      </div>
      <div className="in d2">
        <div className={`card voice${mesh.current ? " live" : ""}`}>
          <div className="voice-head">
            <h3 className="sub">{texts.voice}</h3>
            {voice && (
              <span className="voice-status" aria-live="polite">
                {failed
                  ? fill(texts.voiceFailed, {
                      name: party.members.find((m) => m.userId === failed.userId)?.displayName ?? "?",
                    })
                  : connecting
                    ? fill(texts.voiceConnecting, { n: connecting })
                    : connected
                      ? fill(texts.voiceConnected, { n: connected })
                      : texts.voiceAlone}
              </span>
            )}
          </div>
          {!mesh.current ? (
            <div className="voice-join">
              <button type="button" className="primary" disabled={joining || !session} onClick={joinVoice}>
                <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                </svg>
                {texts.joinVoice}
              </button>
              <p className="hint">{texts.headphones}</p>
            </div>
          ) : (
            <div className="voice-controls">
              <button
                type="button"
                className={`mic${micOn ? " on" : ""}${talking && voice?.speaking ? " hot" : ""}`}
                aria-pressed={!micOn}
                aria-label={micOn ? texts.micOn : texts.micOff}
                title={micOn ? texts.micOn : texts.micOff}
                onClick={() => setMicOn(!micOn)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  {!micOn && <path d="M4 4l16 16" />}
                </svg>
              </button>
              <div className="voice-mode">
                <Segmented
                  value={prefs.mode}
                  onChange={(mode) => {
                    const next = { ...prefs, mode };
                    setPrefs(next);
                    savePrefs(next);
                  }}
                  options={[
                    ["open", texts.openMic],
                    ["ptt", texts.pushToTalk],
                  ]}
                />
                {prefs.mode === "ptt" ? (
                  <div className="ptt">
                    <button
                      type="button"
                      className={`pill hold${held ? " held" : ""}`}
                      onPointerDown={() => setHeld(true)}
                      onPointerUp={() => setHeld(false)}
                      onPointerLeave={() => setHeld(false)}
                      onPointerCancel={() => setHeld(false)}
                    >
                      {fill(texts.holdKey, { key: keyLabel(prefs.key) })}
                    </button>
                    <button type="button" className="link" onClick={() => setCapturing(true)}>
                      {capturing ? texts.pressKey : texts.changeKey}
                    </button>
                  </div>
                ) : (
                  <div className="meter" aria-hidden="true">
                    <i style={{ transform: `scaleX(${Math.min(1, (voice?.level ?? 0) * 8)})` }} />
                  </div>
                )}
              </div>
              <button type="button" className="pill danger" onClick={() => stopVoice(true)}>
                {texts.leaveVoice}
              </button>
            </div>
          )}
        </div>

        {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}

        <div className="card raise">
          <div className="members-head">
            <h3 className="sub">
              {texts.members} <span className="n">{party.members.length}</span>
            </h3>
            {leader ? (
              <Segmented
                small
                value={party.privacy}
                onChange={(value) =>
                  act("privacy", `parties/${party.id}`, { method: "PATCH", ...json({ privacy: value }) })
                }
                options={[
                  ["invite", texts.privacyInvite],
                  ["friends", texts.privacyFriends],
                ]}
              />
            ) : (
              <span className="tag">
                {party.privacy === "friends" ? texts.privacyFriends : texts.privacyInvite}
              </span>
            )}
          </div>
          <ul className="people">
            {party.members.map((member) => {
              const self = member.userId === me;
              const peer = peerState.get(member.userId);
              const speaking = self ? !!voice?.speaking && talking : !!peer?.speaking;
              const voiceIn = self ? !!mesh.current : inVoice.has(member.userId);
              const muted = self ? !micOn : mutedSet.has(member.userId);
              return (
                <li key={member.userId} className="person">
                  <span className={`ring${speaking ? " speaking" : ""}`}>
                    <Avatar person={member} />
                  </span>
                  <span className="lines">
                    <span className="name">
                      {member.displayName}
                      {self && <span className="handle"> ({texts.you})</span>}
                    </span>
                    <span className="meta member-meta">
                      {party.leaderId === member.userId && <span className="crown">{texts.leader}</span>}
                      {voiceIn && (
                        <span className={`in-voice${muted ? " muted" : ""}`}>
                          {muted
                            ? texts.muted
                            : speaking
                              ? texts.speaking
                              : peer && peer.state !== "connected"
                                ? texts.connectingShort
                                : texts.inVoice}
                        </span>
                      )}
                      {!voiceIn && <span>@{member.handle}</span>}
                    </span>
                  </span>
                  <div className="acts">
                    {leader && !self && (
                      <Menu label={fill(texts.more, { name: member.displayName })}>
                        {(close) => (
                          <MemberActions
                            texts={texts}
                            member={member}
                            onLead={() => {
                              close();
                              act(member.userId, `parties/${party.id}/leader`, {
                                method: "POST",
                                ...json({ userId: member.userId }),
                              });
                            }}
                            onKick={() => {
                              close();
                              act(member.userId, `parties/${party.id}/kick`, {
                                method: "POST",
                                ...json({ userId: member.userId }),
                              });
                            }}
                          />
                        )}
                      </Menu>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="party-foot">
            <button
              type="button"
              className="pill danger"
              disabled={busy !== null}
              onClick={async () => {
                stopVoice(true);
                await act("leave", `parties/${party.id}/leave`);
              }}
            >
              {texts.leaveParty}
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="sub">{texts.inviteFriends}</h3>
          {invitable.length === 0 ? (
            <p className="hint empty">{texts.noFriendsToInvite}</p>
          ) : (
            <ul className="people">
              {invitable.map((friend) => (
                <li key={friend.userId} className={`person ${friend.presence.state}`}>
                  <Avatar person={friend} presence={friend.presence.state} />
                  <span className="lines">
                    <span className="name">{friend.displayName}</span>
                    <span className="meta">@{friend.handle}</span>
                  </span>
                  <div className="acts">
                    {invitedSet.has(friend.userId) ? (
                      <span className="tag">{texts.invited}</span>
                    ) : (
                      <button
                        type="button"
                        className="pill"
                        disabled={busy !== null || party.members.length >= maxPartySize}
                        onClick={() =>
                          act(friend.userId, `parties/${party.id}/invites`, {
                            method: "POST",
                            ...json({ userIds: [friend.userId] }),
                          })
                        }
                      >
                        {texts.invite}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MemberActions({
  texts,
  member,
  onLead,
  onKick,
}: {
  texts: UiStrings;
  member: Person;
  onLead: () => void;
  onKick: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking)
    return (
      <div className="confirm">
        <p>{fill(texts.confirmKick, { name: member.displayName })}</p>
        <div className="row">
          <button type="button" className="pill" onClick={() => setAsking(false)}>
            {texts.keep}
          </button>
          <button type="button" className="pill danger" onClick={onKick}>
            {texts.remove}
          </button>
        </div>
      </div>
    );
  return (
    <>
      <button type="button" role="menuitem" onClick={onLead}>
        {texts.makeLeader}
      </button>
      <button type="button" role="menuitem" className="danger" onClick={() => setAsking(true)}>
        {texts.kick}
      </button>
    </>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  small,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  small?: boolean;
}) {
  return (
    <div className={`segmented${small ? " small-seg" : ""}`}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          className={value === key ? "on" : ""}
          onClick={() => value !== key && onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
