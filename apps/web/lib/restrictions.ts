/** What an account may not do now, as the API gives it (GET /me, GET /me/restrictions, a refused
 *  sign-in): the website keeps its own copy of the shape. */
export type RestrictionKind = "banned" | "suspended" | "muted";

export interface Restriction {
  id: string;
  kind: RestrictionKind;
  restricts: string[];
  reason: string | null;
  since: string;
  until: string | null;
  appealable: boolean;
}

export interface Appeal {
  id: string;
  restrictionId: string | null;
  status: "open" | "accepted" | "declined";
  text: string;
  reply: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface Restrictions {
  restrictions: Restriction[];
  appeal: Appeal | null;
}

/** The appeal token a refused sign-in gave a banned account, kept for an hour in an HttpOnly
 *  cookie: it opens /restricted and the appeal form, nothing else. */
export const appealCookie = "at_appeal";

export const longDate = (iso: string, language: string) =>
  new Date(iso).toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" });
