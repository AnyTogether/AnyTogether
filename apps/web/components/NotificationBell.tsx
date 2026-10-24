"use client";

import { useLiveEvents } from "@/components/Live";
import { social } from "@/lib/social";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

/** The header's bell: unread notifications, kept live from the gateway. */
export function NotificationBell({
  initial,
  label,
  unreadLabel,
}: { initial: number; label: string; unreadLabel: string }) {
  const [count, setCount] = useState(initial);
  const [ring, setRing] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const here = usePathname() === "/notifications";

  useLiveEvents((event) => {
    if (event.type === "notification" || event.type === "notification.read") {
      setCount(Number(event.data?.unread ?? 0));
      // A new one rings the bell once (not when it only gathered another message).
      if (
        event.type === "notification" &&
        event.data?.notification?.createdAt === event.data?.notification?.updatedAt
      )
        setRing((n) => n + 1);
      return;
    }
    if (event.type !== "live.ready") return;
    // Back after a gap: ask again rather than trust what was missed.
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { body } = await social<{ unread: number }>("me/notifications/unread");
      if (body) setCount(body.unread);
    }, 250);
  });

  return (
    <Link
      href="/notifications"
      className="pill nav bell"
      aria-label={count > 0 ? `${label}, ${unreadLabel.replace("{n}", String(count))}` : label}
      aria-current={here ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" key={ring} className={ring ? "ring" : undefined}>
        <path d="M6 9.5a6 6 0 0 1 12 0c0 4.6 1.6 6.3 2.3 7a.6.6 0 0 1-.4 1H4.1a.6.6 0 0 1-.4-1c.7-.7 2.3-2.4 2.3-7z" />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      {count > 0 && <b className="badge">{count > 99 ? "99+" : count}</b>}
    </Link>
  );
}
