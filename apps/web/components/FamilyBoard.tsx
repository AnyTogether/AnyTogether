"use client";

import { Avatar } from "@/components/Avatar";
import { When } from "@/components/When";
import {
  type Activity,
  type Allowance,
  type ChildSettings,
  type DayPlan,
  type Family,
  type FamilyInvite,
  type FamilyMember,
  type FamilyRequest,
  type FamilyStatus,
  type LogEntry,
  type MyFamily,
  type Restrictions,
  browserZone,
  duration,
  familyApi,
  familyRefusal,
  featureSwitches,
  friendRequestRules,
  isGuardian,
  messageRules,
  weekdays,
} from "@/lib/family";
import { localName } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, createContext, useContext, useEffect, useState } from "react";

export interface GuardianData {
  requests: FamilyRequest[];
  log: LogEntry[];
  children: Record<string, { settings: ChildSettings | null; activity: Activity | null }>;
}

type Texts = UiStrings;
type Run = (work: () => Promise<{ ok: boolean; body: unknown }>, after?: () => void) => Promise<boolean>;

/** The words for an API refusal. */
function errorText(body: unknown, texts: Texts) {
  const problem = (body ?? {}) as { code?: string; hint?: string; side?: string; status?: number };
  return (
    familyRefusal(problem, texts) ??
    (problem.hint === "link_code"
      ? texts.familyChildHasAccount
      : problem.code === "code_invalid"
        ? texts.familyCodeWrong
        : problem.code === "full"
          ? texts.familyFull
          : problem.code === "not_found"
            ? texts.noOne
            : problem.code === "rate_limited"
              ? texts.tooMany
              : problem.code === "conflict"
                ? texts.familyInFamily
                : texts.failed)
  );
}

/** Calls the API, shows a refusal, and reloads the page's data when it went through. */
function useRun(): [Run, string | null, boolean, (text: string | null) => void] {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const texts = useTexts();
  const run: Run = async (work, after) => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.body, texts));
      return false;
    }
    after?.();
    router.refresh();
    return true;
  };
  return [run, error, busy, setError];
}

// The texts, passed once and read anywhere below.
const TextsContext = createContext<Texts | null>(null);
const useTexts = () => useContext(TextsContext) as Texts;

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null;
}

function Person({
  person,
  size = 36,
  children,
}: {
  person: { displayName: string; handle: string; avatar: string | null; userId: string };
  size?: number;
  children?: ReactNode;
}) {
  return (
    <span className="fam-person">
      <Avatar person={person} size={size} />
      <span className="lines">
        <b>{person.displayName}</b>
        <span className="meta">@{person.handle}</span>
        {children}
      </span>
    </span>
  );
}

/** The family page. */
export function FamilyBoard({
  texts,
  me,
  data,
  guardian,
  child,
  regions,
  now,
}: {
  texts: Texts;
  me: string;
  data: MyFamily;
  guardian: GuardianData | null;
  child: { status: FamilyStatus | null; requests: FamilyRequest[] } | null;
  regions: { code: string; name: string }[];
  now: number;
}) {
  const family = data.family;
  return (
    <TextsContext.Provider value={texts}>
      <section className="page family">
        <h2 className="in d1">{texts.family}</h2>
        <p className="lead in d2">{texts.familyLead}</p>
        <div className="in d3">
          {data.invites.length > 0 && <InvitesForMe invites={data.invites} />}
          {!family ? (
            <Start />
          ) : family.role === "child" ? (
            <ChildHome
              family={family}
              me={me}
              status={child?.status ?? null}
              requests={child?.requests ?? []}
              now={now}
            />
          ) : (
            <>
              {guardian && <Requests requests={guardian.requests} now={now} />}
              {guardian &&
                family.members
                  .filter((m) => m.role === "child")
                  .map((m) => (
                    <ChildPanel
                      key={m.userId}
                      member={m}
                      settings={guardian.children[m.userId]?.settings ?? null}
                      activity={guardian.children[m.userId]?.activity ?? null}
                      regions={regions}
                      now={now}
                    />
                  ))}
              {guardian && !family.members.some((m) => m.role === "child") && (
                <article className="card fam-empty">
                  <p className="hint">{texts.familyNoChildren}</p>
                </article>
              )}
              <Members family={family} me={me} now={now} />
              {family.role === "manager" && <ManagerTools family={family} />}
              {guardian && guardian.log.length > 0 && <Log entries={guardian.log} now={now} />}
            </>
          )}
        </div>
      </section>
    </TextsContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// The way in

function Start() {
  const texts = useTexts();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [run, error, busy] = useRun();
  const [joinRun, joinError, joining] = useRun();
  return (
    <>
      <article className="card fam-intro">
        <div className="fam-intro-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M8 22L24 9l16 13v17H29v-9h-10v9H8z" />
            <circle cx="24" cy="21" r="3.2" />
          </svg>
        </div>
        <h3 className="sub">{texts.familyIntroTitle}</h3>
        <p>{texts.familyIntro}</p>
        <p className="hint">{texts.familyIntroOptIn}</p>
        <form
          className="fam-inline"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => familyApi("families", { method: "POST", body: { name } }));
          }}
        >
          <label className="visually-hidden" htmlFor="family-name">
            {texts.familyName}
          </label>
          <input
            id="family-name"
            required
            maxLength={40}
            placeholder={texts.familyNamePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {texts.familyCreate}
          </button>
        </form>
        <Problem text={error} />
      </article>
      <article className="card">
        <h3 className="sub">{texts.familyJoinTitle}</h3>
        <p className="hint section-lead">{texts.familyJoinLead}</p>
        <form
          className="fam-inline"
          onSubmit={(event) => {
            event.preventDefault();
            joinRun(() =>
              familyApi("me/family/join", { method: "POST", body: { code, timeZone: browserZone() } }),
            );
          }}
        >
          <label className="visually-hidden" htmlFor="family-code">
            {texts.familyCode}
          </label>
          <input
            id="family-code"
            className="fam-code-input"
            required
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            placeholder="ABCD-2345"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button
            type="submit"
            className="pill"
            disabled={joining || code.replace(/[\s-]/g, "").length !== 8}
          >
            {texts.familyJoin}
          </button>
        </form>
        <Problem text={joinError} />
      </article>
    </>
  );
}

function InvitesForMe({ invites }: { invites: FamilyInvite[] }) {
  const texts = useTexts();
  const [run, error, busy] = useRun();
  return (
    <article className="card fam-invites">
      <h3 className="sub">{texts.familyInvitesForYou}</h3>
      <ul className="fam-list">
        {invites.map((invite) => (
          <li key={invite.id} className="fam-row">
            {invite.from && <Avatar person={invite.from} size={36} />}
            <p className="grow">
              {fill(texts.familyInviteLine, {
                name: invite.from?.displayName ?? texts.n_someone,
                family: invite.familyName,
                role: texts[`role_${invite.role}`],
              })}
            </p>
            <div className="acts">
              <button
                type="button"
                className="primary small"
                disabled={busy}
                onClick={() => run(() => familyApi(`family-invites/${invite.id}/accept`, { method: "POST" }))}
              >
                {texts.familyAcceptInvite}
              </button>
              <button
                type="button"
                className="pill"
                disabled={busy}
                onClick={() =>
                  run(() => familyApi(`family-invites/${invite.id}/decline`, { method: "POST" }))
                }
              >
                {texts.familyDeclineInvite}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Problem text={error} />
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Members and the manager's tools

function Members({ family, me, now }: { family: Family; me: string; now: number }) {
  const texts = useTexts();
  const [run, error, busy] = useRun();
  const manager = family.role === "manager";
  const act = (member: FamilyMember, path: string, method: string, body?: unknown, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    run(() => familyApi(path, { method, body }));
  };
  return (
    <article className="card">
      <h3 className="sub">
        {family.name} <span className="n">{family.members.length}</span>
      </h3>
      <ul className="fam-list">
        {family.members.map((member) => (
          <li key={member.userId} className="fam-row">
            <Person person={member}>
              {!member.confirmed && <span className="meta warn-line">{texts.familyNotConfirmed}</span>}
            </Person>
            <span className={`fam-role r-${member.role}`}>{texts[`roleTitle_${member.role}`]}</span>
            {manager && member.userId !== me && (
              <div className="acts fam-member-acts">
                {member.role === "parent" && (
                  <button
                    type="button"
                    className="pill small"
                    disabled={busy}
                    onClick={() =>
                      act(member, `me/family/members/${member.userId}`, "PATCH", { role: "adult" })
                    }
                  >
                    {texts.familyMakeAdult}
                  </button>
                )}
                {member.role === "adult" && (
                  <button
                    type="button"
                    className="pill small"
                    disabled={busy}
                    onClick={() =>
                      act(member, `me/family/members/${member.userId}`, "PATCH", { role: "parent" })
                    }
                  >
                    {texts.familyMakeParent}
                  </button>
                )}
                {member.role !== "child" && (
                  <button
                    type="button"
                    className="pill small"
                    disabled={busy}
                    onClick={() =>
                      act(
                        member,
                        `me/family/members/${member.userId}`,
                        "PATCH",
                        { role: "manager" },
                        fill(texts.familyHandOverConfirm, { name: member.displayName }),
                      )
                    }
                  >
                    {texts.familyHandOver}
                  </button>
                )}
                <button
                  type="button"
                  className="pill small danger"
                  disabled={busy}
                  onClick={() =>
                    act(
                      member,
                      `me/family/members/${member.userId}`,
                      "DELETE",
                      undefined,
                      fill(texts.familyRemoveConfirm, { name: member.displayName }),
                    )
                  }
                >
                  {texts.familyRemove}
                </button>
              </div>
            )}
          </li>
        ))}
        {family.invites.map((invite) => (
          <li key={invite.id} className="fam-row pending">
            {invite.to && <Person person={invite.to} />}
            <span className="fam-role">
              {texts.familyInvited} · {texts[`role_${invite.role}`]}
            </span>
            <div className="acts">
              <span className="meta">
                <When iso={invite.createdAt} language={texts.language} now={now} />
              </span>
              <button
                type="button"
                className="pill small"
                disabled={busy}
                onClick={() => run(() => familyApi(`me/family/invites/${invite.id}`, { method: "DELETE" }))}
              >
                {texts.familyInviteCancel}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Problem text={error} />
      {family.role !== "child" && (
        <div className="save-row fam-leave">
          <span />
          {manager ? (
            <button
              type="button"
              className="pill danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(fill(texts.familyEndConfirm, { family: family.name })))
                  run(() => familyApi("me/family", { method: "DELETE" }));
              }}
            >
              {texts.familyEnd}
            </button>
          ) : (
            <button
              type="button"
              className="pill danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(fill(texts.familyLeaveConfirm, { family: family.name })))
                  run(() => familyApi("me/family/leave", { method: "POST" }));
              }}
            >
              {texts.familyLeave}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ManagerTools({ family }: { family: Family }) {
  const texts = useTexts();
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"parent" | "adult">("parent");
  const [email, setEmail] = useState("");
  const [childName, setChildName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [inviteRun, inviteError, inviting] = useRun();
  const [childRun, childError, making] = useRun();
  const [codeError, setCodeError] = useState<string | null>(null);
  const full = family.members.length >= 8;
  return (
    <article className="card fam-tools">
      <div className="fam-tool">
        <h3 className="sub">{texts.familyAddChild}</h3>
        <p className="hint section-lead">{texts.familyAddChildLead}</p>
        <form
          className="form fields"
          onSubmit={(event) => {
            event.preventDefault();
            const made = { email: email.trim(), name: childName.trim() };
            childRun(
              () =>
                familyApi("me/family/children", {
                  method: "POST",
                  body: { email: made.email, displayName: made.name || undefined, timeZone: browserZone() },
                }),
              () => {
                setDone(fill(texts.familyChildCreated, { name: made.name || made.email, email: made.email }));
                setEmail("");
                setChildName("");
              },
            );
          }}
        >
          <div className="fam-two">
            <div className="field-group">
              <label htmlFor="child-email">{texts.familyChildEmail}</label>
              <input
                id="child-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="child-name">{texts.familyChildName}</label>
              <input
                id="child-name"
                maxLength={40}
                value={childName}
                onChange={(event) => setChildName(event.target.value)}
              />
            </div>
          </div>
          <div className="save-row">
            {done ? <output className="saved on">{done}</output> : <Problem text={childError} />}
            <button type="submit" className="primary" disabled={making || full || !email.trim()}>
              {texts.familyChildCreate}
            </button>
          </div>
        </form>
        <div className="fam-code">
          {code ? (
            <>
              <p className="fam-code-value" aria-live="polite">
                {code.code.slice(0, 4)}
                <span aria-hidden="true">-</span>
                {code.code.slice(4)}
              </p>
              <p className="hint">
                {texts.familyLinkCodeLead}{" "}
                {fill(texts.familyLinkCodeUntil, {
                  time: new Date(code.expiresAt).toLocaleString(texts.language, {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  }),
                })}
              </p>
            </>
          ) : (
            <button
              type="button"
              className="pill"
              disabled={full}
              onClick={async () => {
                setCodeError(null);
                const made = await familyApi<{ code: string; expiresAt: string }>("me/family/link-codes", {
                  method: "POST",
                });
                if (made.ok && made.body) setCode(made.body);
                else setCodeError(errorText(made.body, texts));
              }}
            >
              {texts.familyLinkCode}
            </button>
          )}
          <Problem text={codeError} />
        </div>
      </div>
      <hr />
      <div className="fam-tool">
        <h3 className="sub">{texts.familyInviteTitle}</h3>
        <p className="hint section-lead">{texts.familyInviteLead}</p>
        <form
          className="fam-inline"
          onSubmit={(event) => {
            event.preventDefault();
            inviteRun(
              () =>
                familyApi("me/family/invites", {
                  method: "POST",
                  body: { handle: handle.replace(/^@/, ""), role },
                }),
              () => setHandle(""),
            );
          }}
        >
          <div className="field">
            <span className="at">@</span>
            <input
              aria-label={texts.familyInviteHandle}
              placeholder={texts.familyInviteHandle}
              required
              maxLength={40}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
          <Segmented
            name="invite-role"
            value={role}
            options={[
              ["parent", texts.familyInviteAsParent],
              ["adult", texts.familyInviteAsAdult],
            ]}
            onChange={(value) => setRole(value as "parent" | "adult")}
          />
          <button type="submit" className="primary" disabled={inviting || full || !handle.trim()}>
            {texts.familyInviteSend}
          </button>
        </form>
        <Problem text={inviteError} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces

function Segmented({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex(([key]) => key === value),
  );
  return (
    <div className="segmented fam-seg" style={{ "--i": index, "--n": options.length } as CSSProperties}>
      <span className="thumb" aria-hidden="true" />
      {options.map(([key, label]) => (
        <label key={key}>
          <input
            type="radio"
            name={name}
            value={key}
            checked={value === key}
            disabled={disabled}
            onChange={() => onChange(key)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span className="lines">
        <span>{label}</span>
        {hint && <span className="meta">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle" />
    </label>
  );
}

/** Today as a bar: played, left, extra time; and why play is not allowed now. */
function TodayMeter({ today }: { today: Allowance }) {
  const texts = useTexts();
  const language = texts.language;
  const limit = today.limitMinutes;
  const played = today.playedSeconds;
  const share = limit ? Math.min(1, played / Math.max(1, limit * 60)) : 0;
  return (
    <div className={`fam-meter${today.allowed ? "" : " over"}`}>
      <div className="fam-meter-head">
        <b>
          {limit === null
            ? texts.familyNoLimitToday
            : today.allowed
              ? fill(texts.familyLeftToday, { time: duration(today.remainingSeconds ?? 0, language) })
              : today.reason === "window"
                ? texts.familyOutsideWindow
                : texts.familyLimitReached}
        </b>
        <span className="meta">{fill(texts.familyPlayedToday, { time: duration(played, language) })}</span>
      </div>
      {limit !== null && (
        <div
          className="fam-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={limit * 60}
          aria-valuenow={Math.min(played, limit * 60)}
          aria-label={texts.familyToday}
        >
          <span style={{ "--share": share } as CSSProperties} />
        </div>
      )}
      <p className="meta fam-meter-foot">
        {today.from && today.until
          ? fill(texts.familyWindowToday, { from: today.from, until: today.until })
          : null}
        {today.bonusMinutes > 0 && (
          <span className="fam-bonus">{fill(texts.familyBonusToday, { minutes: today.bonusMinutes })}</span>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One child, for the parents

function ChildPanel({
  member,
  settings,
  activity,
  regions,
  now,
}: {
  member: FamilyMember;
  settings: ChildSettings | null;
  activity: Activity | null;
  regions: { code: string; name: string }[];
  now: number;
}) {
  const texts = useTexts();
  const [tab, setTab] = useState<"today" | "settings" | "activity">("today");
  const [run, error, busy] = useRun();
  const [given, setGiven] = useState<string | null>(null);
  return (
    <article className="card fam-child">
      <header className="fam-child-head">
        <Person person={member} size={44}>
          {!member.confirmed && <span className="meta warn-line">{texts.familyNotConfirmed}</span>}
        </Person>
        <nav className="fam-tabs" aria-label={member.displayName}>
          {(["today", "settings", "activity"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`pill small${tab === key ? " on" : ""}`}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {key === "today"
                ? texts.familyTabToday
                : key === "settings"
                  ? texts.familyTabSettings
                  : texts.familyTabActivity}
            </button>
          ))}
        </nav>
      </header>
      {tab === "today" && (
        <div className="fam-today">
          {settings?.today ? <TodayMeter today={settings.today} /> : null}
          <div className="fam-give">
            <span className="meta">{texts.familyGiveTime}</span>
            <div className="acts">
              {[15, 30, 60].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="pill small"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        familyApi(`me/family/children/${member.userId}/time-grants`, {
                          method: "POST",
                          body: { minutes },
                        }),
                      () => setGiven(fill(texts.familyGiven, { minutes })),
                    )
                  }
                >
                  {fill(texts.familyGive, { minutes })}
                </button>
              ))}
            </div>
          </div>
          {given && <output className="saved on">{given}</output>}
          <Problem text={error} />
          {settings && <RulesSummary rules={settings.restrictions} />}
        </div>
      )}
      {tab === "settings" && settings && (
        <LimitsEditor childId={member.userId} initial={settings} regions={regions} now={now} />
      )}
      {tab === "activity" && activity && <ActivityView activity={activity} />}
    </article>
  );
}

/** What is on and off, at a glance. */
function RulesSummary({ rules }: { rules: Restrictions }) {
  const texts = useTexts();
  return (
    <ul className="fam-rules">
      <li>
        <span>{texts.familyFriendRequests}</span>
        <b>{texts[`fr_${rules.friendRequests}`]}</b>
      </li>
      <li>
        <span>{texts.familyMessages}</span>
        <b>{texts[`msg_${rules.messages}`]}</b>
      </li>
      {featureSwitches.map((key) => (
        <li key={key} className={rules[key] ? "on" : "off"}>
          <span>{texts[`sw_${key}`]}</span>
          <b>{rules[key] ? texts.rule_on : texts.rule_off}</b>
        </li>
      ))}
      <li>
        <span>{texts.familyAgeLimit}</span>
        <b>
          {rules.ageLimit === null ? texts.familyAgeAny : fill(texts.familyAgeUpTo, { n: rules.ageLimit })}
        </b>
      </li>
    </ul>
  );
}

const limitChoices = [null, 15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360];
const ageChoices = [null, 3, 6, 7, 10, 12, 13, 15, 16, 17, 18];

/** A child's limits, each change saved as it is made. */
function LimitsEditor({
  childId,
  initial,
  regions,
  now,
}: {
  childId: string;
  initial: ChildSettings;
  regions: { code: string; name: string }[];
  now: number;
}) {
  const texts = useTexts();
  const router = useRouter();
  const [rules, setRules] = useState(initial.restrictions);
  const [contacts, setContacts] = useState(initial.approvedContacts);
  const [status, setStatus] = useState<"idle" | "saved" | string>("idle");
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(timer);
  }, [status]);

  async function save(update: Record<string, unknown>, optimistic: Restrictions) {
    const before = rules;
    setRules(optimistic);
    const saved = await familyApi<ChildSettings>(`me/family/children/${childId}/restrictions`, {
      method: "PATCH",
      body: update,
    });
    if (!saved.ok || !saved.body) {
      setRules(before);
      return setStatus(errorText(saved.body, texts));
    }
    setRules(saved.body.restrictions);
    setContacts(saved.body.approvedContacts);
    setStatus("saved");
    router.refresh();
  }
  const set = <K extends keyof Restrictions>(key: K, value: Restrictions[K]) =>
    save({ [key]: value }, { ...rules, [key]: value });
  const setTime = (update: Partial<Restrictions["playTime"]>) =>
    save({ playTime: update }, { ...rules, playTime: { ...rules.playTime, ...update } });
  const setDay = (day: (typeof weekdays)[number], plan: DayPlan) =>
    save(
      { playTime: { days: { [day]: plan } } },
      { ...rules, playTime: { ...rules.playTime, days: { ...rules.playTime.days, [day]: plan } } },
    );
  const zones = (() => {
    try {
      return (
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          "timeZone",
        ) ?? []
      );
    } catch {
      return [];
    }
  })();

  return (
    <div className="fam-limits">
      <section className="fam-section">
        <h4>{texts.familyPlayTime}</h4>
        <div className="toggles">
          <Toggle
            label={texts.familyPlayTimeOn}
            hint={texts.familyPlayTimeHint}
            checked={rules.playTime.enabled}
            onChange={(enabled) => setTime({ enabled })}
          />
        </div>
        {rules.playTime.enabled && (
          <>
            <div className="fam-days">
              {weekdays.map((day) => {
                const plan = rules.playTime.days[day];
                return (
                  <div key={day} className="fam-day">
                    <span className="fam-day-name">
                      <span className="fam-long">{texts[`day_${day}`]}</span>
                      <span className="fam-short">{texts[`dayShort_${day}`]}</span>
                    </span>
                    <label className="fam-select">
                      <span className="visually-hidden">{texts.familyDayLimit}</span>
                      <select
                        value={plan.limitMinutes === null ? "" : String(plan.limitMinutes)}
                        onChange={(event) =>
                          setDay(day, {
                            ...plan,
                            limitMinutes: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                      >
                        {[...new Set([...limitChoices, plan.limitMinutes])]
                          .sort((a, b) => (a ?? -1) - (b ?? -1))
                          .map((minutes) => (
                            <option key={String(minutes)} value={minutes === null ? "" : String(minutes)}>
                              {minutes === null
                                ? texts.familyNoLimit
                                : duration(minutes * 60, texts.language)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <span className="fam-hours">
                      <label className="fam-anytime">
                        <input
                          type="checkbox"
                          checked={plan.from === null}
                          onChange={(event) =>
                            setDay(
                              day,
                              event.target.checked
                                ? { ...plan, from: null, until: null }
                                : { ...plan, from: "08:00", until: "21:00" },
                            )
                          }
                        />
                        <span>{texts.familyAnyTime}</span>
                      </label>
                      {plan.from !== null && plan.until !== null && (
                        <>
                          <input
                            type="time"
                            aria-label={`${texts[`day_${day}`]} ${texts.familyDayHours}`}
                            value={plan.from}
                            onChange={(event) =>
                              event.target.value &&
                              event.target.value < (plan.until ?? "24:00") &&
                              setDay(day, { ...plan, from: event.target.value })
                            }
                          />
                          <span aria-hidden="true">–</span>
                          <input
                            type="time"
                            aria-label={`${texts[`day_${day}`]} ${texts.familyDayHours}`}
                            value={plan.until}
                            onChange={(event) =>
                              event.target.value &&
                              event.target.value > (plan.from ?? "00:00") &&
                              setDay(day, { ...plan, until: event.target.value })
                            }
                          />
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="save-row">
              <span />
              <button
                type="button"
                className="pill small"
                onClick={() => {
                  const monday = rules.playTime.days.mon;
                  const days = Object.fromEntries(
                    weekdays.map((d) => [d, { ...monday }]),
                  ) as Restrictions["playTime"]["days"];
                  save({ playTime: { days } }, { ...rules, playTime: { ...rules.playTime, days } });
                }}
              >
                {texts.familyCopyToAll}
              </button>
            </div>
            <div className="fam-pairs">
              <div className="fam-pair">
                <span>{texts.familyWhenUp}</span>
                <Segmented
                  name={`${childId}-when`}
                  value={rules.playTime.whenLimitReached}
                  options={[
                    ["close", texts.familyWhenUpClose],
                    ["notify", texts.familyWhenUpNotify],
                  ]}
                  onChange={(value) => setTime({ whenLimitReached: value as "close" | "notify" })}
                />
              </div>
              {rules.playTime.whenLimitReached === "close" && (
                <label className="fam-pair">
                  <span>{texts.familyGrace}</span>
                  <select
                    className="fam-select"
                    value={rules.playTime.graceMinutes}
                    onChange={(event) => setTime({ graceMinutes: Number(event.target.value) })}
                  >
                    {[0, 1, 2, 3, 5, 10, 15].map((n) => (
                      <option key={n} value={n}>
                        {fill(texts.familyGraceMinutes, { n })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="fam-pair">
                <span>{texts.familyTimeZone}</span>
                <select
                  className="fam-select"
                  value={rules.playTime.timeZone}
                  onChange={(event) => setTime({ timeZone: event.target.value })}
                >
                  {[...new Set([rules.playTime.timeZone, ...zones])].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="toggles">
              <Toggle
                label={texts.familyNotifyMe}
                checked={rules.playTime.notifyParents}
                onChange={(notifyParents) => setTime({ notifyParents })}
              />
            </div>
          </>
        )}
      </section>

      <section className="fam-section">
        <h4>{texts.familyGames}</h4>
        <div className="fam-pairs">
          <label className="fam-pair">
            <span className="lines">
              <span>{texts.familyAgeLimit}</span>
              <span className="meta">{texts.familyAgeLimitHint}</span>
            </span>
            <select
              className="fam-select"
              value={rules.ageLimit === null ? "" : String(rules.ageLimit)}
              onChange={(event) =>
                set("ageLimit", event.target.value === "" ? null : Number(event.target.value))
              }
            >
              {[...new Set([...ageChoices, rules.ageLimit])]
                .sort((a, b) => (a ?? -1) - (b ?? -1))
                .map((age) => (
                  <option key={String(age)} value={age === null ? "" : String(age)}>
                    {age === null ? texts.familyAgeAny : fill(texts.familyAgeUpTo, { n: age })}
                  </option>
                ))}
            </select>
          </label>
          {rules.ageLimit !== null && (
            <>
              <label className="fam-pair">
                <span>{texts.familyAgeRegion}</span>
                <select
                  className="fam-select"
                  value={rules.ageRegion}
                  onChange={(event) => set("ageRegion", event.target.value)}
                >
                  <option value="default">{texts.familyAgeRegionDefault}</option>
                  {regions.map((region) => (
                    <option key={region.code} value={region.code}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fam-pair">
                <span>{texts.familyUnknownAge}</span>
                <Segmented
                  name={`${childId}-unknown`}
                  value={rules.unknownAge}
                  options={[
                    ["allow", texts.familyUnknownAllow],
                    ["block", texts.familyUnknownBlock],
                  ]}
                  onChange={(value) => set("unknownAge", value as "allow" | "block")}
                />
              </div>
            </>
          )}
        </div>
        {rules.ageLimit !== null && (
          <div className="fam-chips">
            <span className="meta">{texts.familyAllowedGames}</span>
            {rules.allowedTitles.length ? (
              rules.allowedTitles.map((titleId) => (
                <button
                  key={titleId}
                  type="button"
                  className="tag fam-chip"
                  aria-label={fill(texts.familyAllowedRemove, { name: titleId })}
                  onClick={() =>
                    set(
                      "allowedTitles",
                      rules.allowedTitles.filter((t) => t !== titleId),
                    )
                  }
                >
                  {titleId} <span aria-hidden="true">×</span>
                </button>
              ))
            ) : (
              <span className="hint">{texts.familyAllowedNone}</span>
            )}
          </div>
        )}
      </section>

      <section className="fam-section">
        <h4>{texts.familyCommunication}</h4>
        <div className="fam-stack">
          <div className="fam-pair column">
            <span className="lines">
              <span>{texts.familyFriendRequests}</span>
              <span className="meta">{texts.familyFriendRequestsHint}</span>
            </span>
            <Segmented
              name={`${childId}-fr`}
              value={rules.friendRequests}
              options={friendRequestRules.map((rule) => [rule, texts[`fr_${rule}`]])}
              onChange={(value) => set("friendRequests", value as Restrictions["friendRequests"])}
            />
          </div>
          <div className="fam-pair column">
            <span className="lines">
              <span>{texts.familyMessages}</span>
              <span className="meta">{texts.familyMessagesHint}</span>
            </span>
            <Segmented
              name={`${childId}-msg`}
              value={rules.messages}
              options={messageRules.map((rule) => [rule, texts[`msg_${rule}`]])}
              onChange={(value) => set("messages", value as Restrictions["messages"])}
            />
          </div>
          <div className="fam-pair column">
            <span className="lines">
              <span>{texts.familyProfile}</span>
              <span className="meta">{texts.familyProfileHint}</span>
            </span>
            <Segmented
              name={`${childId}-pv`}
              value={rules.profileVisibility}
              options={[
                ["friends", texts.pv_friends],
                ["nobody", texts.pv_nobody],
              ]}
              onChange={(value) => set("profileVisibility", value as "friends" | "nobody")}
            />
          </div>
        </div>
        <div className="fam-chips">
          <span className="meta">{texts.familyApproved}</span>
          {contacts.length ? (
            contacts.map((person) => (
              <button
                key={person.userId}
                type="button"
                className="tag fam-chip"
                aria-label={fill(texts.familyApprovedRemove, { name: person.displayName })}
                onClick={() =>
                  set(
                    "approvedContacts",
                    rules.approvedContacts.filter((id) => id !== person.userId),
                  )
                }
              >
                <Avatar person={person} size={18} /> {person.displayName} <span aria-hidden="true">×</span>
              </button>
            ))
          ) : (
            <span className="hint">{texts.familyApprovedNone}</span>
          )}
        </div>
      </section>

      <section className="fam-section">
        <h4>{texts.familyFeatures}</h4>
        <div className="toggles">
          {featureSwitches.map((key) => (
            <Toggle
              key={key}
              label={texts[`sw_${key}`]}
              hint={texts[`sw_${key}_hint`]}
              checked={rules[key]}
              onChange={(value) => set(key, value)}
            />
          ))}
        </div>
      </section>

      <div className="save-row">
        {status !== "idle" && status !== "saved" ? (
          <p className="error" role="alert">
            {status}
          </p>
        ) : initial.updatedBy && initial.updatedAt ? (
          <span className="meta">
            {fill(texts.familyUpdatedBy, { name: initial.updatedBy.displayName, when: "" })}
            <When iso={initial.updatedAt} language={texts.language} now={now} />
          </span>
        ) : (
          <span />
        )}
        <output className={`saved${status === "saved" ? " on" : ""}`}>
          {status === "saved" ? texts.familySaved : ""}
        </output>
      </div>
    </div>
  );
}

function ActivityView({ activity }: { activity: Activity }) {
  const texts = useTexts();
  const language = texts.language;
  const most = Math.max(1, ...activity.days.map((d) => d.seconds));
  const dayName = (date: string) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return texts[`dayShort_${weekdays[(weekday + 6) % 7] ?? "mon"}`];
  };
  return (
    <div className="fam-activity">
      <div className="fam-activity-head">
        <h4>{texts.familyWeek}</h4>
        <span className="meta">
          {fill(texts.familyWeekTotal, { time: duration(activity.totalSeconds, language) })}
          {activity.requests > 0 && ` · ${fill(texts.familyRequestsCount, { n: activity.requests })}`}
        </span>
      </div>
      <ol className="fam-chart" aria-label={texts.familyWeek}>
        {activity.days.map((day) => (
          <li key={day.date} title={`${day.date}: ${duration(day.seconds, language)}`}>
            <span className="fam-col" style={{ "--h": day.seconds / most } as CSSProperties}>
              <span className="visually-hidden">{duration(day.seconds, language)}</span>
            </span>
            <span className="meta">{dayName(day.date)}</span>
          </li>
        ))}
      </ol>
      <div className="fam-two">
        <section>
          <h4>{texts.familyTopGames}</h4>
          {activity.games.length ? (
            <ul className="fam-games">
              {activity.games.map((game) => (
                <li key={game.titleId}>
                  <span className="grow">{localName(game.names, language) || game.titleId}</span>
                  <span className="meta">{duration(game.seconds, language)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{texts.familyNoPlay}</p>
          )}
        </section>
        <section>
          <h4>{texts.familyFriendsAdded}</h4>
          {activity.friendsAdded.length ? (
            <ul className="fam-list compact">
              {activity.friendsAdded.map((friend) => (
                <li key={friend.userId} className="fam-row">
                  <Person person={friend} size={28} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{texts.familyNoNewFriends}</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Requests

function requestLine(request: FamilyRequest, texts: Texts) {
  const name = request.child?.displayName ?? texts.n_someone;
  if (request.kind === "more_time") return fill(texts.req_more_time, { name, minutes: request.minutes ?? 0 });
  if (request.kind === "add_friend")
    return fill(texts.req_add_friend, {
      name,
      person: request.person ? `${request.person.displayName} (@${request.person.handle})` : "?",
    });
  return fill(texts.req_play_game, { name, game: request.gameName ?? request.titleId ?? "?" });
}

function Requests({ requests, now }: { requests: FamilyRequest[]; now: number }) {
  const texts = useTexts();
  const [run, error, busy] = useRun();
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const pending = requests.filter((r) => r.status === "pending");
  const answered = requests.filter((r) => r.status !== "pending").slice(0, 8);
  return (
    <article className="card fam-requests">
      <h3 className="sub">
        {texts.familyRequests} {pending.length > 0 && <span className="n">{pending.length}</span>}
      </h3>
      {pending.length ? (
        <ul className="fam-list">
          {pending.map((request) => {
            const chosen = minutes[request.id] ?? request.minutes ?? 30;
            return (
              <li key={request.id} className="fam-row request">
                {request.child && <Avatar person={request.child} size={36} />}
                <div className="grow">
                  <p>{requestLine(request, texts)}</p>
                  {request.note && <p className="notice-detail">“{request.note}”</p>}
                  <p className="meta">
                    <When iso={request.createdAt} language={texts.language} now={now} />
                  </p>
                </div>
                <div className="acts">
                  {request.kind === "more_time" && (
                    <select
                      className="fam-select small"
                      aria-label={texts.familyGiveTime}
                      value={chosen}
                      onChange={(event) =>
                        setMinutes({ ...minutes, [request.id]: Number(event.target.value) })
                      }
                    >
                      {[...new Set([5, 10, 15, 30, 45, 60, 90, 120, request.minutes ?? 30])]
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <option key={n} value={n}>
                            {fill(texts.familyMinutesShort, { n })}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="primary small"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        familyApi(`me/family/requests/${request.id}/approve`, {
                          method: "POST",
                          body: request.kind === "more_time" ? { minutes: chosen } : {},
                        }),
                      )
                    }
                  >
                    {texts.familyApprove}
                  </button>
                  <button
                    type="button"
                    className="pill small"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        familyApi(`me/family/requests/${request.id}/decline`, { method: "POST", body: {} }),
                      )
                    }
                  >
                    {texts.familyDecline}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">{texts.familyNoRequests}</p>
      )}
      <Problem text={error} />
      {answered.length > 0 && (
        <details className="fam-answered">
          <summary className="meta">{texts.familyRequestsAnswered}</summary>
          <ul className="fam-list compact">
            {answered.map((request) => (
              <li key={request.id} className="fam-row">
                <p className="grow">{requestLine(request, texts)}</p>
                <span className={`fam-status s-${request.status}`}>
                  {texts[`reqStatus_${request.status}`]}
                  {request.grantedMinutes
                    ? ` · ${fill(texts.familyMinutesShort, { n: request.grantedMinutes })}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Log({ entries, now }: { entries: LogEntry[]; now: number }) {
  const texts = useTexts();
  return (
    <article className="card">
      <details className="fam-log">
        <summary>
          <h3 className="sub">{texts.familyLog}</h3>
        </summary>
        <ul className="fam-list compact">
          {entries.map((entry) => {
            const key = `log_${entry.action.replaceAll(".", "_")}` as keyof Texts;
            const template = typeof texts[key] === "string" ? (texts[key] as string) : texts.log_other;
            return (
              <li key={entry.id} className="fam-row">
                <p className="grow">
                  {fill(template, {
                    actor: entry.actor?.displayName ?? texts.n_someone,
                    subject: entry.subject?.displayName ?? texts.n_someone,
                    action: entry.action,
                  })}
                </p>
                <span className="meta">
                  <When iso={entry.createdAt} language={texts.language} now={now} />
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// The child's own view

function ChildHome({
  family,
  me,
  status,
  requests,
  now,
}: {
  family: Family;
  me: string;
  status: FamilyStatus | null;
  requests: FamilyRequest[];
  now: number;
}) {
  const texts = useTexts();
  const self = family.members.find((m) => m.userId === me);
  const manager = family.members.find((m) => m.role === "manager");
  const [run, error, busy] = useRun();
  const [asked, setAsked] = useState(false);
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const ask = (body: Record<string, unknown>) =>
    run(
      () => familyApi("me/family/requests", { method: "POST", body }),
      () => {
        setAsked(true);
        setHandle("");
        setNote("");
      },
    );
  return (
    <>
      {self && !self.confirmed && (
        <article className="card fam-confirm">
          <h3 className="sub">{texts.familyConfirmTitle}</h3>
          <p>
            {fill(texts.familyConfirmLead, {
              name: manager?.displayName ?? texts.n_someone,
              family: family.name,
            })}
          </p>
          <div className="acts">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => run(() => familyApi("me/family/confirm", { method: "POST" }))}
            >
              {texts.familyConfirmYes}
            </button>
            <button
              type="button"
              className="pill danger"
              disabled={busy}
              onClick={() => run(() => familyApi("me/family/not-mine", { method: "POST" }))}
            >
              {texts.familyConfirmNo}
            </button>
          </div>
        </article>
      )}
      <article className="card fam-mine">
        <h3 className="sub">{texts.familyYours}</h3>
        <p className="hint section-lead">{fill(texts.familyYoursLead, { family: family.name })}</p>
        {status?.today && (
          <>
            <h4>{texts.familyYourDay}</h4>
            <TodayMeter today={status.today} />
            {status.today.limitMinutes !== null && (
              <div className="fam-give">
                <span className="meta">{texts.familyAskTime}</span>
                <div className="acts">
                  {[15, 30, 60].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className="pill small"
                      disabled={busy}
                      onClick={() => ask({ kind: "more_time", minutes })}
                    >
                      {fill(texts.familyAskMinutes, { n: minutes })}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {asked && <output className="saved on">{texts.familyAsked}</output>}
        <Problem text={error} />
        {status?.restrictions && (
          <>
            <h4>{texts.familyRulesTitle}</h4>
            <RulesSummary rules={status.restrictions} />
          </>
        )}
      </article>
      <article className="card">
        <h3 className="sub">{texts.familyAskFriend}</h3>
        <form
          className="fam-inline"
          onSubmit={(event) => {
            event.preventDefault();
            ask({
              kind: "add_friend",
              handle: handle.replace(/^@/, ""),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}
        >
          <div className="field">
            <span className="at">@</span>
            <input
              aria-label={texts.familyAskFriendHandle}
              placeholder={texts.familyAskFriendHandle}
              required
              maxLength={40}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
          </div>
          <input
            aria-label={texts.familyAskNote}
            placeholder={texts.familyAskNote}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="submit" className="primary" disabled={busy || !handle.trim()}>
            {texts.familyAsk}
          </button>
        </form>
        <p className="hint">{texts.familyAskGameHint}</p>
      </article>
      {requests.length > 0 && (
        <article className="card">
          <h3 className="sub">{texts.familyYourRequests}</h3>
          <ul className="fam-list compact">
            {requests.slice(0, 20).map((request) => (
              <li key={request.id} className="fam-row">
                <p className="grow">{requestLine(request, texts)}</p>
                <span className={`fam-status s-${request.status}`}>
                  {texts[`reqStatus_${request.status}`]}
                </span>
                <span className="meta">
                  <When iso={request.createdAt} language={texts.language} now={now} />
                </span>
              </li>
            ))}
          </ul>
        </article>
      )}
      <Members family={family} me={me} now={now} />
    </>
  );
}
