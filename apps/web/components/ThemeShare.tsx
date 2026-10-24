"use client";

import type { UiStrings } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const errorKeys = [
  "bad_theme",
  "preview_required",
  "payload_too_large",
  "unsupported_media_type",
  "bad_image",
];

/** Sharing a theme file with its preview and description; with `themeId`, a new version of it. */
export function ThemeShare({ texts, themeId }: { texts: UiStrings; themeId?: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail?: string; themeId?: string } | null>(null);

  useEffect(() => {
    if (!preview) return setPreviewUrl(null);
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("theme", file);
    if (preview) form.set("preview", preview);
    if (!themeId && description.trim()) form.set("description", description.trim());
    const response = await fetch(themeId ? `/me/themes/${themeId}/versions` : "/me/themes", {
      method: "POST",
      body: form,
    }).catch(() => undefined);
    const answer = response ? await response.json().catch(() => null) : null;
    if (response?.ok && answer?.id) {
      if (themeId) {
        setBusy(false);
        setFile(null);
        setPreview(null);
        router.refresh();
        return;
      }
      return router.push(`/themes/${answer.id}`);
    }
    setBusy(false);
    const code = answer?.code as string | undefined;
    if (response?.status === 409 && answer?.themeId)
      return setError({ text: texts.alreadyShared, themeId: answer.themeId });
    if (response?.status === 429) return setError({ text: texts.tooMany });
    if (code && errorKeys.includes(code))
      return setError({
        text: texts[`err_${code}` as keyof UiStrings] as string,
        detail: code === "bad_theme" ? answer?.title : undefined,
      });
    setError({ text: texts.failed, detail: answer?.title });
  };

  return (
    <form className="form share-form" onSubmit={submit}>
      <div className="field-group">
        <span className="label-row">
          <label htmlFor="theme-file">{texts.themeFile}</label>
        </span>
        <label className={`drop${file ? " has" : ""}`}>
          <input
            id="theme-file"
            type="file"
            accept=".anyps5theme,application/zip"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          <span className="drop-name">{file ? file.name : texts.chooseFile}</span>
        </label>
        <p className="hint-line">{texts.themeFileHint}</p>
      </div>

      <div className="field-group">
        <span className="label-row">
          <label htmlFor="theme-preview">{texts.previewImage}</label>
        </span>
        <label className={`drop still${previewUrl ? " has" : ""}`}>
          <input
            id="theme-preview"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setPreview(event.target.files?.[0] ?? null)}
          />
          {previewUrl ? (
            <img src={previewUrl} alt="" />
          ) : (
            <>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="M21 16l-5-5-8 8" />
              </svg>
              <span className="drop-name">{texts.chooseFile}</span>
            </>
          )}
        </label>
        <p className="hint-line">{texts.previewHint}</p>
      </div>

      {!themeId && (
        <div className="field-group">
          <span className="label-row">
            <label htmlFor="theme-description">{texts.description}</label>
            <span className={`counter${description.length > 450 ? " near" : ""}`}>
              {description.length}/500
            </span>
          </span>
          <textarea
            id="theme-description"
            rows={3}
            maxLength={500}
            value={description}
            placeholder={texts.descriptionHint}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="notice error" role="alert">
          <p>
            {error.text}
            {error.themeId && (
              <>
                {" "}
                <Link href={`/themes/${error.themeId}`}>{texts.openIt}</Link> {texts.newVersionThere}
              </>
            )}
          </p>
          {error.detail && <p className="meta">{error.detail}</p>}
        </div>
      )}
      <div className="save-row">
        <button type="submit" className="primary" disabled={!file || busy}>
          {busy ? texts.publishing : themeId ? texts.uploadVersion : texts.publish}
        </button>
      </div>
      {!themeId && <p className="hint-line">{texts.shareRules}</p>}
    </form>
  );
}
