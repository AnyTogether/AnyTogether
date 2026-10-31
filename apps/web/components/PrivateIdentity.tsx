"use client";

import { Avatar } from "@/components/Avatar";
import { AvatarEditor } from "@/components/AvatarEditor";
import type { UiStrings } from "@/lib/i18n";
import type { Own } from "@/lib/people";
import { rateLimitText } from "@/lib/rateLimit";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Status = { kind: "idle" | "busy" | "saved" } | { kind: "error"; text: string };

/** One side of the preview: the card as that reader sees it, handle always under the name. */
function IdCard({
  label,
  person,
  sealed,
}: {
  label: string;
  person: { handle: string; displayName: string; avatar: string | null };
  sealed?: boolean;
}) {
  return (
    <figure className={`id-card${sealed ? " sealed" : ""}`}>
      <figcaption>
        {sealed ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z" />
          </svg>
        )}
        {label}
      </figcaption>
      <div className="id-body">
        <Avatar person={person} size={44} />
        <span className="lines">
          <span className="name">{person.displayName}</span>
          <span className="handle">@{person.handle}</span>
        </span>
      </div>
    </figure>
  );
}

/** The friends-only name and picture: who sees what (a preview of both cards), the name, and the
 *  picture through the same editor and checks as the public one. */
export function PrivateIdentity({ own, texts }: { own: Own; texts: UiStrings }) {
  const router = useRouter();
  const { profile } = own;
  const [name, setName] = useState(profile.privateName ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = setTimeout(() => setStatus({ kind: "idle" }), 2200);
    return () => clearTimeout(timer);
  }, [status]);
  const changed = name.trim() !== (profile.privateName ?? "");
  const everyone = { handle: profile.handle, displayName: profile.displayName, avatar: profile.avatar };
  const friends = {
    handle: profile.handle,
    displayName: name.trim() || profile.displayName,
    avatar: profile.privateAvatar || profile.avatar,
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus({ kind: "busy" });
    const response = await fetch("/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ privateName: name.trim() || null }),
    }).catch(() => undefined);
    const body = (await response?.json().catch(() => ({}))) as {
      privateName?: string | null;
      code?: string;
      retryAfter?: number;
    };
    if (!response?.ok)
      return setStatus({
        kind: "error",
        text:
          body.code === "links_not_allowed"
            ? texts.noLinks
            : body.code === "rate_limited"
              ? rateLimitText(body.retryAfter, texts)
              : body.code === "account_muted"
                ? texts.r_muted
                : texts.failed,
      });
    setName(body.privateName ?? "");
    setStatus({ kind: "saved" });
    router.refresh();
  }

  return (
    <div className="private-identity">
      <p className="hint section-lead">{texts.privateLead}</p>
      <div className="id-preview" aria-hidden="true">
        <IdCard label={texts.everyoneSees} person={everyone} />
        <IdCard label={texts.friendsSee} person={friends} sealed />
      </div>
      <form className="form fields" onSubmit={save}>
        <div className="field-group">
          <label htmlFor="private-name">{texts.privateName}</label>
          <input
            id="private-name"
            maxLength={40}
            autoComplete="name"
            placeholder={texts.privateNamePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="meta">{texts.privateNameHint}</span>
        </div>
        <div className="save-row">
          <output className={`saved${status.kind === "saved" ? " on" : ""}`}>
            {status.kind === "saved" ? texts.saved : ""}
          </output>
          {status.kind === "error" && (
            <p className="error" role="alert">
              {status.text}
            </p>
          )}
          <button type="submit" className="primary small" disabled={!changed || status.kind === "busy"}>
            {status.kind === "busy" ? texts.saving : texts.save}
          </button>
        </div>
      </form>
      <hr />
      <div className="field-group">
        <span className="label">{texts.privateAvatar}</span>
        <AvatarEditor person={profile} texts={texts} kind="private" hint={texts.privateAvatarHint} />
      </div>
      <p className="hint never">{texts.privateNever}</p>
    </div>
  );
}
