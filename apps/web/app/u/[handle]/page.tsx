import { Avatar } from "@/components/Avatar";
import { FriendAction } from "@/components/FriendAction";
import { strings, ui } from "@/lib/i18n";
import type { Profile } from "@/lib/people";
import { apiJson, currentUser } from "@/lib/session";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type Params = { params: Promise<{ handle: string }> };

const clean = (handle: string) => decodeURIComponent(handle).replace(/^@/, "").toLowerCase();

async function load(handle: string) {
  if (!/^[a-z0-9_.]{1,40}$/.test(handle)) return null;
  const { body } = await apiJson<Profile>(`/users/${encodeURIComponent(handle)}`);
  return body;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const handle = clean((await params).handle);
  return { title: `@${handle} · AnyTogether` };
}

/** A person's card and the friendship step that fits (signed in for now; public later). */
export default async function UserProfile({ params }: Params) {
  const handle = clean((await params).handle);
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/u/${handle}`)}`);
  const profile = await load(handle);
  if (!profile) notFound();
  return (
    <section className="page narrowish">
      <article className="card profile in d1">
        <div className="banner" aria-hidden="true" />
        <Avatar person={profile} size={96} />
        <h2 className="in d2">{profile.displayName}</h2>
        <p className="handle in d2">@{profile.handle}</p>
        <p className={`bio in d3${profile.bio ? "" : " none"}`}>{profile.bio || texts.noBio}</p>
        <div className="in d4">
          <FriendAction profile={profile} texts={ui(texts)} />
        </div>
      </article>
    </section>
  );
}
