"use client";

import { useLiveEvents } from "@/components/Live";
import { type PresenceStatus, statusAfter } from "@/lib/presenceMode";
import { useEffect, useState } from "react";

/** The small mark on one's own avatar in the header for a status other than Online (the moon for
 *  Idle, the red bar for Do Not Disturb, the hollow ring for Invisible), kept live by the gateway's
 *  presence.mode (the choice made on this or another device). */
export function StatusMark({
  initial,
  labels,
}: {
  initial: PresenceStatus;
  labels: Record<Exclude<PresenceStatus, "online">, string>;
}) {
  const [status, setStatus] = useState(initial);
  useEffect(() => setStatus(initial), [initial]);
  useLiveEvents((event) => setStatus((current) => statusAfter(current, event)));
  if (status === "online") return null;
  const label = labels[status];
  return <span className={`status-mark is-${status}`} role="img" aria-label={label} title={label} />;
}
