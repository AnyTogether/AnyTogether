import { AvatarEditor } from "@/components/AvatarEditor";
import { DiscoverySettings } from "@/components/Discover";
import { NotificationSettings } from "@/components/NotificationSettings";
import { PasskeyList, type PasskeyRow } from "@/components/Passkeys";
import { PushSwitch } from "@/components/PushSwitch";
import { DeleteAccount, HandleForm, PrivacyForm, ProfileForm, SessionList } from "@/components/Settings";
import { countryOptions } from "@/lib/countries";
import type { Discovery } from "@/lib/discover";
import { strings, ui } from "@/lib/i18n";
import type { NoticeSetup } from "@/lib/notify";
import type { Own, SignedIn } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Settings · AnyTogether" };

/** The signed-in user's settings: profile, privacy, notifications, passkeys, signed-in devices, their data,
 *  deletion. */
export default async function Settings() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/settings");
  const [own, signedIn, keys, notify, discovery] = await Promise.all([
    apiJson<Own>("/me"),
    apiJson<{ sessions: SignedIn[] }>("/auth/sessions"),
    apiJson<{ passkeys: PasskeyRow[]; max: number }>("/auth/passkeys"),
    apiJson<NoticeSetup>("/me/notifications/settings"),
    apiJson<Discovery>("/me/discovery"),
  ]);
  if (!own.body) redirect("/login?next=/settings");
  const me = own.body;
  const t = ui(texts);
  const sections = [
    ["profile", texts.sectionProfile],
    ["privacy", texts.sectionPrivacy],
    ["discovery", texts.sectionDiscovery],
    ["notifications", texts.sectionNotifications],
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
        {user.account.role === "admin" && (
          <a href="/admin" className="pill admin-link">
            {texts.admin}
          </a>
        )}
      </nav>

      <div className="in d3">
        <article className="card" id="profile">
          <h3 className="sub">{texts.sectionProfile}</h3>
          <AvatarEditor person={me.profile} texts={t} />
          <hr />
          <HandleForm own={me} texts={t} />
          <hr />
          <ProfileForm own={me} texts={t} options={countryOptions(texts.language)} />
        </article>

        <article className="card" id="privacy">
          <h3 className="sub">{texts.sectionPrivacy}</h3>
          <p className="hint section-lead">{texts.privacyLead}</p>
          <PrivacyForm privacy={me.profile.privacy} texts={t} />
        </article>

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
        </article>

        <article className="card danger-zone" id="delete">
          <h3 className="sub">{texts.sectionDelete}</h3>
          <DeleteAccount own={me} texts={t} />
        </article>
      </div>
    </section>
  );
}
