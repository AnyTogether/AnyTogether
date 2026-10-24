import type { ThemeColors, ThemeStatus } from "./themes";

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
  targetKind: "user" | "message" | "theme" | "lfg";
  targetId: string;
  message: { text: string | null; sentAt: string | null; removed: boolean } | null;
  /** A reported looking-for-group post, as it was when reported. */
  post: {
    note: string | null;
    titleId: string | null;
    purpose: string | null;
    postedAt: string | null;
    removed: boolean;
  } | null;
  /** A reported theme: its name and version when reported, and its state now (null once deleted). */
  theme: {
    id: string;
    name: string | null;
    version: number | null;
    status: AdminThemeStatus | null;
    colors: ThemeColors | null;
  } | null;
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
  /** Whose post, message or theme the entry is about, when its target is that thing. */
  author?: { userId: string; handle: string; displayName: string; avatar: string | null } | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export type AdminThemeStatus = ThemeStatus;

/** A theme as the admin page's theme queue shows it. */
export interface AdminTheme {
  id: string;
  name: string;
  description: string | null;
  status: AdminThemeStatus;
  version: number;
  style: number;
  colors: ThemeColors;
  background: "picture" | "video" | null;
  music: boolean;
  downloads: number;
  likes: number;
  maker: AdminPerson | null;
  openReports: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminThemePage {
  themes: AdminTheme[];
  more: boolean;
  /** How many themes wait for review. */
  review: number;
}

/** Where the admin page reads a theme's card still, whatever its state. */
export const adminThumb = (id: string, version?: number | null) =>
  `/me/admin/admin/themes/${id}/thumb.webp${version ? `?v=${version}` : ""}`;

export const adminTabs = ["reports", "themes", "people", "bans", "audit"] as const;
export type AdminTab = (typeof adminTabs)[number];
