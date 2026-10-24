"use client";

import { useLive, useLiveEvents } from "@/components/Live";
import { social } from "@/lib/social";
import { useRef, useState } from "react";

/** The unread count on the header's Messages link, kept live from the gateway. */
export function UnreadBadge({ initial, label }: { initial: number; label: string }) {
  const { me } = useLive();
  const [count, setCount] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useLiveEvents((event) => {
    const mine =
      (event.type === "message.created" && event.data.authorId !== me) ||
      (event.type === "conversation.read" && event.data.userId === me) ||
      event.type === "message.deleted" ||
      event.type === "conversation.updated" ||
      event.type === "live.ready";
    if (!mine) return;
    // Several events at once (a burst, a replay) make one request.
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { body } = await social<{ messages: number }>("me/conversations/unread");
      if (body) setCount(body.messages);
    }, 250);
  });

  if (count <= 0) return null;
  return (
    <b className="badge" aria-label={label.replace("{n}", String(count))}>
      {count > 99 ? "99+" : count}
    </b>
  );
}
