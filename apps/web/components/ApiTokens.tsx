"use client";

import { CopyButton } from "@/components/CopyButton";
import { type ApiScope, type ApiToken, apiScopes } from "@/lib/challenges";
import { ago } from "@/lib/games";
import type { UiStrings } from "@/lib/i18n";
import { fill } from "@/lib/people";
import Link from "next/link";
import { useState } from "react";

/** Settings: personal API tokens for the public API, made with a name and scopes (the token shown
 *  this once), and revoked. */
export function ApiTokens({
  tokens: initial,
  max,
  texts,
}: { tokens: ApiToken[]; max: number; texts: UiStrings }) {
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([...apiScopes]);
  const [made, setMade] = useState<{ id: string; token: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = tokens.length >= max;

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const answer = await fetch("/me/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), scopes }),
    }).catch(() => undefined);
    const body = answer ? await answer.json().catch(() => null) : null;
    setBusy(false);
    if (!answer?.ok || !body)
      return setError(
        answer?.status === 409
          ? fill(texts.tokensMax, { n: max })
          : answer?.status === 429
            ? texts.tooMany
            : texts.failed,
      );
    const { token, ...view } = body as ApiToken & { token: string };
    setTokens((list) => [...list, view]);
    setMade({ id: view.id, token });
    setName("");
  }

  async function revoke(id: string) {
    setBusy(true);
    const done = await fetch(`/me/api-tokens/${id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(false);
    setAsking(null);
    if (!done || (!done.ok && done.status !== 404)) return setError(texts.failed);
    setTokens((list) => list.filter((t) => t.id !== id));
    if (made?.id === id) setMade(null);
  }

  return (
    <>
      {tokens.length > 0 ? (
        <ul className="people devices api-tokens">
          {tokens.map((token) => (
            <li key={token.id} className="person">
              <span className="device-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                  <path d="M8 8.5 4 12l4 3.5M16 8.5l4 3.5-4 3.5M13.5 6l-3 12" />
                </svg>
              </span>
              <span className="lines">
                <span className="name">
                  <span className="label">{token.name}</span>
                  <code className="token-start">{token.start}…</code>
                </span>
                <span className="meta">
                  {token.scopes.map((scope) => texts[`scope_${scope}`]).join(", ")}
                </span>
                <span className="meta">
                  {token.lastUsedAt
                    ? fill(texts.tokenUsed, { when: ago(token.lastUsedAt, texts.language) })
                    : texts.tokenUnused}
                </span>
                {made?.id === token.id && (
                  <output className="token-once">
                    <code>{made.token}</code>
                    <CopyButton
                      text={made.token}
                      label={texts.tokenCopy}
                      done={texts.tokenCopied}
                      name={token.name}
                    />
                    <span className="hint">{texts.tokenOnce}</span>
                  </output>
                )}
              </span>
              <div className="acts">
                {asking === token.id ? (
                  <>
                    <button type="button" className="quiet" disabled={busy} onClick={() => setAsking(null)}>
                      {texts.keep}
                    </button>
                    <button
                      type="button"
                      className="pill danger"
                      disabled={busy}
                      onClick={() => revoke(token.id)}
                      aria-label={fill(texts.confirmRevokeToken, { name: token.name })}
                    >
                      {texts.revokeToken}
                    </button>
                  </>
                ) : (
                  <button type="button" className="pill" disabled={busy} onClick={() => setAsking(token.id)}>
                    {texts.revokeToken}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{texts.tokensEmpty}</p>
      )}
      {full ? (
        <p className="hint">{fill(texts.tokensMax, { n: max })}</p>
      ) : (
        <form className="form api-token-form" onSubmit={make}>
          <label className="stack">
            <span>{texts.apiTokenName}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={texts.apiTokenNamePlaceholder}
              maxLength={60}
              required
            />
          </label>
          <fieldset className="scope-list">
            <legend className="stack-legend">{texts.apiScopesLabel}</legend>
            {apiScopes.map((scope) => (
              <label key={scope} className="check">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() =>
                    setScopes((list) =>
                      list.includes(scope) ? list.filter((s) => s !== scope) : [...list, scope],
                    )
                  }
                />
                <span>{texts[`scope_${scope}`]}</span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="save-row">
            <Link href="/developers" className="quiet-link">
              {texts.apiDocsLink}
            </Link>
            <button
              type="submit"
              className="primary small"
              disabled={busy || !name.trim() || scopes.length === 0}
            >
              {texts.makeToken}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
