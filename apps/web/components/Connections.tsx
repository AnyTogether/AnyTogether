"use client";

import { type Connection, type ConnectionSetup, connectionProviders, providerName } from "@/lib/connections";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import { rateLimitText } from "@/lib/rateLimit";
import { useState } from "react";

/** Steam and Discord linked to the profile: link one (off to Steam or Discord and back), show it
 *  on the profile or not, unlink it. */
export function ConnectionList({
  setup,
  texts,
  notice: initialNotice,
}: {
  setup: ConnectionSetup;
  texts: UiStrings;
  /** What the redirect back said: linked, or why not. */
  notice: { ok: boolean; text: string } | null;
}) {
  const [linked, setLinked] = useState(setup.connections);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialNotice);

  async function call(path: string, init: RequestInit) {
    const response = await fetch(`/me/connections/${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
    }).catch(() => undefined);
    const body = response && response.status !== 204 ? await response.json().catch(() => ({})) : {};
    return { ok: response?.ok ?? false, body };
  }

  async function link(provider: Connection["provider"]) {
    setBusy(provider);
    setNotice(null);
    const done = await call(`${provider}/start`, { method: "POST" });
    if (done.ok && typeof done.body.url === "string") {
      window.location.assign(done.body.url);
      return;
    }
    setBusy(null);
    setNotice({
      ok: false,
      text: done.body.code === "rate_limited" ? rateLimitText(done.body.retryAfter, texts) : texts.failed,
    });
  }

  async function setHidden(connection: Connection, hidden: boolean) {
    setBusy(connection.provider);
    const done = await call(connection.provider, { method: "PATCH", body: JSON.stringify({ hidden }) });
    setBusy(null);
    if (done.ok)
      setLinked((list) => list.map((c) => (c.provider === connection.provider ? done.body.connection : c)));
    else
      setNotice({
        ok: false,
        text: done.body.code === "rate_limited" ? rateLimitText(done.body.retryAfter, texts) : texts.failed,
      });
  }

  async function unlink(connection: Connection) {
    setBusy(connection.provider);
    const done = await call(connection.provider, { method: "DELETE" });
    setBusy(null);
    if (done.ok) {
      setLinked((list) => list.filter((c) => c.provider !== connection.provider));
      setNotice({ ok: true, text: fill(texts.unlinked, { provider: providerName[connection.provider] }) });
    } else setNotice({ ok: false, text: texts.failed });
  }

  const shown = connectionProviders.filter(
    (provider) => setup.available[provider] || linked.some((c) => c.provider === provider),
  );
  return (
    <>
      <ul className="people connections">
        {shown.map((provider) => {
          const connection = linked.find((c) => c.provider === provider);
          return (
            <li key={provider} className="person connection">
              <span className={`provider-mark is-${provider}`}>{providerName[provider]}</span>
              <span className="lines">
                {connection ? (
                  <>
                    <a className="name" href={connection.url} target="_blank" rel="noopener noreferrer">
                      {connection.name ?? connection.username ?? connection.externalId}
                    </a>
                    <span className="meta">
                      {connection.username && connection.username !== connection.name
                        ? `@${connection.username} · `
                        : ""}
                      {connection.hidden ? texts.connectionHidden : texts.connectionShown}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="name">{providerName[provider]}</span>
                    <span className="meta">{texts[`connectionLead_${provider}`]}</span>
                  </>
                )}
              </span>
              <div className="acts">
                {connection ? (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!connection.hidden}
                        disabled={busy !== null}
                        onChange={(event) => setHidden(connection, !event.target.checked)}
                      />
                      {texts.showOnProfile}
                    </label>
                    <button
                      type="button"
                      className="pill"
                      disabled={busy !== null}
                      onClick={() => unlink(connection)}
                    >
                      {texts.unlink}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="pill accent"
                    disabled={busy !== null}
                    onClick={() => link(provider)}
                  >
                    {fill(texts.linkAccount, { provider: providerName[provider] })}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {notice && <output className={`notice ${notice.ok ? "success" : "error"}`}>{notice.text}</output>}
    </>
  );
}
