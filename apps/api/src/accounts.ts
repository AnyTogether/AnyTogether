import { type Database, accounts, identities, profiles } from "@anytogether/db";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

export interface Identity {
  provider: "apple" | "google" | "discord" | "email";
  subject: string;
  /** Only a verified address links to an existing account. */
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  name?: string | undefined;
  avatarUrl?: string | undefined;
}

/** The account for this way in: the one it already belongs to, the one with its verified email
 *  (which it then joins), or a new one with a profile. */
export async function findOrCreateAccount(db: Database, identity: Identity) {
  return db.transaction(async (tx) => {
    const known = await tx
      .select({ accountId: identities.accountId })
      .from(identities)
      .where(and(eq(identities.provider, identity.provider), eq(identities.subject, identity.subject)));
    if (known[0]) return { accountId: known[0].accountId, created: false };

    const email = identity.emailVerified ? identity.email?.toLowerCase() : undefined;
    if (email) {
      const byEmail = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, email));
      if (byEmail[0]) {
        await tx
          .insert(identities)
          .values({ accountId: byEmail[0].id, provider: identity.provider, subject: identity.subject });
        return { accountId: byEmail[0].id, created: false };
      }
    }

    const accountId = uuidv7();
    await tx.insert(accounts).values({ id: accountId, email: email ?? null });
    await tx.insert(identities).values({ accountId, provider: identity.provider, subject: identity.subject });
    const base = handleFrom(identity.name ?? email?.split("@")[0] ?? "player");
    let handle = base;
    for (let attempt = 0; attempt < 20; attempt++) {
      const taken = await tx
        .select({ id: profiles.accountId })
        .from(profiles)
        .where(eq(profiles.handle, handle));
      if (!taken[0]) break;
      handle = `${base.slice(0, 15)}${Math.floor(1000 + Math.random() * 9000)}`;
    }
    await tx.insert(profiles).values({
      accountId,
      handle,
      displayName: (identity.name ?? handle).slice(0, 60),
      avatarUrl: identity.avatarUrl ?? null,
    });
    return { accountId, created: true };
  });
}

/** "Ayşe Yılmaz" → "ayse.yilmaz", "kral" → "kral": 3-20 of a-z 0-9 _ . */
export function handleFrom(name: string) {
  const plain = name
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/ı/g, "i")
    .replace(/\p{Mn}/gu, "")
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20);
  return plain.length >= 3 ? plain : `${plain}player`.slice(0, 20);
}
