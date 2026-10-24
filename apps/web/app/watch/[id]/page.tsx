import { Watch } from "@/components/Watch";
import { strings, ui } from "@/lib/i18n";
import { apiJson, currentUser } from "@/lib/session";
import { type SharePlay, isShareId } from "@/lib/share";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const share = isShareId(id) ? (await apiJson<SharePlay>(`/share-plays/${id}`)).body : null;
  return {
    title: share?.host ? `${share.host.displayName} · Share play · AnyTogether` : "Share play · AnyTogether",
  };
}

/** Watching a friend's share play: from their presence, their profile or an invite. */
export default async function WatchPage({ params }: Params) {
  const { id } = await params;
  const [texts, user] = await Promise.all([strings(), currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/watch/${id}`)}`);
  const share = isShareId(id) ? (await apiJson<SharePlay>(`/share-plays/${id}`)).body : null;
  return <Watch texts={ui(texts)} initial={share} id={id} />;
}
