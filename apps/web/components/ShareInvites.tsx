"use client";

import { Avatar } from "@/components/Avatar";
import { useLiveEvents } from "@/components/Live";
import type { ShareInviteStrings } from "@/lib/i18n-share";
import { type Person, fill } from "@/lib/people";
import { social } from "@/lib/social";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Invite {
  sharePlayId: string;
  from: Person;
  game: string;
}

/** A friend's invite to watch their game, on whatever page the user is on, until they answer or
 *  the share play ends. Waiting invites are listed on the friends page as well. */
export function ShareInvites({ texts }: { texts: ShareInviteStrings }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const path = usePathname();

  useLiveEvents((event) => {
    const data = event.data;
    if (event.type === "share_play.invite" && data?.from) {
      const invite = { sharePlayId: data.sharePlayId, from: data.from, game: data.title ?? data.titleId };
      setInvites((list) => [...list.filter((i) => i.sharePlayId !== invite.sharePlayId), invite]);
    } else if (event.type === "share_play.ended") {
      setInvites((list) => list.filter((i) => i.sharePlayId !== data?.sharePlayId));
    }
  });

  // Already watching it: no card for it.
  useEffect(() => {
    setInvites((list) => list.filter((i) => path !== `/watch/${i.sharePlayId}`));
  }, [path]);

  const invite = invites[0];
  if (!invite || path === `/watch/${invite.sharePlayId}`) return null;
  const drop = () => setInvites((list) => list.filter((i) => i.sharePlayId !== invite.sharePlayId));
  const text = fill(texts.shareInvitedYou, { name: invite.from.displayName, game: invite.game });
  return (
    <div className="call-layer">
      <div key={invite.sharePlayId} className="call-card share-invite" role="alertdialog" aria-label={text}>
        <span className="call-face">
          <Avatar person={invite.from} size={44} />
        </span>
        <span className="lines">
          <span className="name">{text}</span>
          <span className="meta">{texts.shareTitle}</span>
        </span>
        <div className="share-acts">
          <button
            type="button"
            className="pill"
            onClick={() => {
              drop();
              social(`share-plays/${invite.sharePlayId}/decline`, { method: "POST" });
            }}
          >
            {texts.decline}
          </button>
          <Link href={`/watch/${invite.sharePlayId}`} className="pill watch-btn" onClick={drop}>
            {texts.shareWatch}
          </Link>
        </div>
      </div>
    </div>
  );
}
