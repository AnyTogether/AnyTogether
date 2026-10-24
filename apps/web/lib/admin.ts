/** The admin page's shapes, as the API's /admin routes give them. */
export interface AdminPerson {
  userId: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  role: string;
  status: string;
}

export interface AdminReport {
  id: string;
  status: "open" | "actioned" | "dismissed";
  reason: string;
  note: string | null;
  targetKind: "user" | "message";
  targetId: string;
  message: { text: string | null; sentAt: string | null; removed: boolean } | null;
  reporter: AdminPerson | null;
  target: AdminPerson | null;
  timesReported: number;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface AdminBanRow {
  id: string;
  account: AdminPerson | null;
  emailOnly: boolean;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
  live: boolean;
}

export interface AdminSession {
  id: string;
  client: string;
  deviceName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AdminLookup {
  user:
    | (AdminPerson & {
        email: string | null;
        createdAt: string;
        deleteAfter: string | null;
        reportsAgainst: number;
        reportsMade: number;
      })
    | null;
  sessions?: AdminSession[];
  bans: AdminBanRow[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: { userId: string; handle: string; displayName: string; avatar: string | null } | null;
  target: string | null;
  targetUser: { userId: string; handle: string; displayName: string; avatar: string | null } | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export const adminTabs = ["reports", "people", "bans", "audit"] as const;
export type AdminTab = (typeof adminTabs)[number];
