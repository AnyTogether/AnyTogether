import { FamilyBoard, type GuardianData } from "@/components/FamilyBoard";
import { countryOptions } from "@/lib/countries";
import {
  type Activity,
  type ChildSettings,
  type FamilyRequest,
  type FamilyStatus,
  type LogEntry,
  type MyFamily,
  isGuardian,
} from "@/lib/family";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import "../family.css";

export const metadata: Metadata = { title: "Family · AnyTogether" };

/** The family: for parents its members, each child's limits, requests and play; for a child their
 *  own settings, today's time and their requests; for anyone else the way in. */
export default async function FamilyPage() {
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect("/login?next=/family");
  const mine = await apiJson<MyFamily>("/me/family");
  const data: MyFamily = mine.body ?? { family: null, invites: [] };
  const family = data.family;

  let guardian: GuardianData | null = null;
  let child: { status: FamilyStatus | null; requests: FamilyRequest[] } | null = null;
  if (family && isGuardian(family.role)) {
    const children = family.members.filter((m) => m.role === "child");
    const [requests, log, perChild] = await Promise.all([
      apiJson<{ requests: FamilyRequest[] }>("/me/family/requests?status=all"),
      apiJson<{ entries: LogEntry[]; more: boolean }>("/me/family/log"),
      Promise.all(
        children.map(async (c) => {
          const [settings, activity] = await Promise.all([
            apiJson<ChildSettings>(`/me/family/children/${c.userId}/restrictions`),
            apiJson<Activity>(`/me/family/children/${c.userId}/activity?days=7`),
          ]);
          return [c.userId, { settings: settings.body, activity: activity.body }] as const;
        }),
      ),
    ]);
    guardian = {
      requests: requests.body?.requests ?? [],
      log: log.body?.entries ?? [],
      children: Object.fromEntries(perChild),
    };
  } else if (family?.role === "child") {
    const [status, requests] = await Promise.all([
      apiJson<FamilyStatus>("/me/family/restrictions"),
      apiJson<{ requests: FamilyRequest[] }>("/me/family/requests?status=all"),
    ]);
    child = { status: status.body, requests: requests.body?.requests ?? [] };
  }

  return (
    <FamilyBoard
      texts={ui(texts)}
      me={user.account.id}
      data={data}
      guardian={guardian}
      child={child}
      regions={countryOptions(texts.language)}
      now={Date.now()}
    />
  );
}
