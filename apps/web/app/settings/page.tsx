import { AvatarEditor } from "@/components/AvatarEditor";
import { ConnectionList } from "@/components/Connections";
import { DiscoverySettings } from "@/components/Discover";
import { InstallApp } from "@/components/InstallApp";
import { LegalLinks } from "@/components/LegalLinks";
import { LookSettings } from "@/components/LookSettings";
import { NotificationSettings } from "@/components/NotificationSettings";
import { PasskeyList, type PasskeyRow } from "@/components/Passkeys";
import { PrivateIdentity } from "@/components/PrivateIdentity";
import { PushSwitch } from "@/components/PushSwitch";
import {
  DeleteAccount,
  HandleForm,
  PresenceModeForm,
  PrivacyForm,
  ProfileForm,
  PublicProfileForm,
  ReadReceiptsForm,
  SessionList,
} from "@/components/Settings";
import { StorageSettings } from "@/components/StorageSettings";
import { type ConnectionProvider, type ConnectionSetup, providerName } from "@/lib/connections";
import { countryOptions } from "@/lib/countries";
import type { Discovery } from "@/lib/discover";
import type { LibraryGame } from "@/lib/games";
import { strings, ui } from "@/lib/i18n";
import type { NoticeSetup } from "@/lib/notify";
import { type Own, type SignedIn, fill, privacySectionsWithGallery } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { StorageOverview } from "@/lib/storage";
import { titled } from "@/lib/titles";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const generateMetadata = () => titled((t) => t.settings);

/** The signed-in user's settings: profile, privacy, notifications, passkeys, signed-in devices, their data,
 *  deletion. */
export default async function Settings({
  searchParams,
}: { searchParams: Promise<{ linked?: string; link_error?: string; provider?: string }> }) {
  const [texts, user, query] = await Promise.all([strings(), currentUser(), searchParams]);
  if (!user) redirect("/login?next=/settings");
  const [own, signedIn, keys, notify, discovery, storage, linked] = await Promise.all([
    apiJson<Own>("/me"),
    apiJson<{ sessions: SignedIn[] }>("/auth/sessions"),
    apiJson<{ passkeys: PasskeyRow[]; max: number }>("/auth/passkeys"),
    apiJson<NoticeSetup>("/me/notifications/settings"),
    apiJson<Discovery>("/me/discovery"),
    apiJson<StorageOverview | { enabled: false }>("/me/storage"),
    apiJson<ConnectionSetup>("/me/connections"),
  ]);
  // Cloud saves and media: shown only when the server keeps files.
  const files = storage.body?.enabled ? storage.body : null;
  if (!own.body) redirect("/login?next=/settings");
  const me = own.body;
  const library = await apiJson<{ games: LibraryGame[] }>(
    `/users/${encodeURIComponent(me.profile.handle)}/library`,
  );
  const withArt = (library.body?.games ?? []).flatMap((game) =>
    game.iconUrl ? [{ titleId: game.titleId, names: game.names, iconUrl: game.iconUrl }] : [],
  );
  const t = ui(texts);
  // Back from Steam or Discord: how linking went.
  const provider = providerName[(query.linked ?? query.provider) as ConnectionProvider] ?? "";
  const linkNotice = query.linked
    ? { ok: true, text: fill(texts.linkedNotice, { provider }) }
    : query.link_error
      ? {
          ok: false,
          text:
            query.link_error === "cancelled"
              ? texts.linkCancelled
              : fill(query.link_error === "taken" ? texts.linkTaken : texts.linkFailed, { provider }),
        }
      : null;
  const sections = [
    ["profile", texts.sectionProfile],
    ["private", texts.sectionPrivate],
    ["look", texts.sectionLook],
    ["privacy", texts.sectionPrivacy],
    ["connections", texts.sectionConnections],
    ["discovery", texts.sectionDiscovery],
    ["notifications", texts.sectionNotifications],
    ...(files ? ([["storage", texts.sectionStorage]] as const) : []),
    ["passkeys", texts.sectionPasskeys],
    ["devices", texts.sectionDevices],
    ["data", texts.sectionData],
  ] as const;

  return (
    <section className="page settings">
      <h2 className="in d1">{texts.settings}</h2>
      <p className="lead in d2">{texts.settingsLead}</p>
      <nav className="jump in d2" aria-label={texts.settings}>
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="pill">
            {label}
          </a>
        ))}
        <a href="/family" className="pill">
          {texts.family}
        </a>
        {user.account.role === "admin" && (
          <a href="/admin" className="pill admin-link">
            {texts.admin}
          </a>
        )}
      </nav>

      <div className="in d3">
        <article className="card" id="profile">
          <h3 className="sub">{texts.sectionProfile}</h3>
          <AvatarEditor person={me.profile} texts={t} hint={texts.publicPictureHint} />
          <hr />
          <HandleForm own={me} texts={t} />
          <hr />
          <ProfileForm own={me} texts={t} options={countryOptions(texts.language)} />
        </article>

        <article className="card" id="private">
          <h3 className="sub">{texts.sectionPrivate}</h3>
          <PrivateIdentity own={me} texts={t} />
        </article>

        <article className="card" id="look">
          <h3 className="sub">{texts.sectionLook}</h3>
          <p className="hint section-lead">{texts.lookLead}</p>
          <LookSettings
            texts={t}
            cover={me.profile.cover ?? null}
            accent={me.profile.accent ?? null}
            games={withArt}
          />
        </article>

        <article className="card" id="privacy">
          <h3 className="sub">{texts.sectionPrivacy}</h3>
          <PresenceModeForm appearOffline={me.profile.appearOffline === true} texts={t} />
          <ReadReceiptsForm readReceipts={me.profile.readReceipts !== false} texts={t} />
          <hr />
          <PublicProfileForm publicProfile={me.profile.publicProfile === true} texts={t} />
          <p className="hint section-lead">{texts.privacyLead}</p>
          <PrivacyForm
            privacy={me.profile.privacy}
            texts={t}
            {...(files ? { sections: privacySectionsWithGallery } : {})}
          />
        </article>

        {linked.body && (
          <article className="card" id="connections">
            <h3 className="sub">{texts.sectionConnections}</h3>
            <p className="hint section-lead">{texts.connectionsLead}</p>
            <ConnectionList setup={linked.body} texts={t} notice={linkNotice} />
          </article>
        )}

        {discovery.body && (
          <article className="card" id="discovery">
            <h3 className="sub">{texts.sectionDiscovery}</h3>
            <p className="hint section-lead">{texts.discoveryLead}</p>
            <DiscoverySettings initial={discovery.body} texts={t} />
          </article>
        )}

        {notify.body && (
          <article className="card" id="notifications">
            <h3 className="sub">{texts.sectionNotifications}</h3>
            <p className="hint section-lead">{texts.notifySettingsLead}</p>
            <NotificationSettings setup={notify.body} texts={t}>
              <PushSwitch publicKey={notify.body.push?.publicKey ?? null} texts={t} />
            </NotificationSettings>
          </article>
        )}

        <InstallApp texts={t} />

        {files && (
          <article className="card" id="storage">
            <h3 className="sub">{texts.sectionStorage}</h3>
            <p className="hint section-lead">{texts.storageLead}</p>
            <StorageSettings initial={files} texts={t} />
          </article>
        )}

        <article className="card" id="passkeys">
          <h3 className="sub">
            {texts.sectionPasskeys} <span className="n">{keys.body?.passkeys.length ?? 0}</span>
          </h3>
          <p className="hint section-lead">{texts.passkeysLead}</p>
          <PasskeyList passkeys={keys.body?.passkeys ?? []} max={keys.body?.max ?? 10} texts={t} />
        </article>

        <article className="card" id="devices">
          <h3 className="sub">
            {texts.sectionDevices} <span className="n">{signedIn.body?.sessions.length ?? 0}</span>
          </h3>
          <p className="hint section-lead">{texts.devicesLead}</p>
          <SessionList sessions={signedIn.body?.sessions ?? []} texts={t} />
        </article>

        <article className="card" id="data">
          <h3 className="sub">{texts.sectionData}</h3>
          <p className="hint section-lead">{texts.dataLead}</p>
          <div className="save-row">
            <span />
            <a className="pill" href="/me/export" download>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
                <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
              </svg>
              {texts.download}
            </a>
          </div>
          <LegalLinks texts={texts} />
        </article>

        <article className="card danger-zone" id="delete">
          <h3 className="sub">{texts.sectionDelete}</h3>
          <DeleteAccount own={me} texts={t} />
        </article>
      </div>
    </section>
  );
}
