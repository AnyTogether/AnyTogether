"use client";

import { useLiveEvents } from "@/components/Live";
import { appearOfflineAfter } from "@/lib/presenceMode";
import { useEffect, useState } from "react";

/** The small mark on one's own avatar in the header while appearing offline, kept live by the
 *  gateway's presence.mode (the choice made on this or another device). */
export function AppearingOfflineMark({ initial, label }: { initial: boolean; label: string }) {
  const [on, setOn] = useState(initial);
  useEffect(() => setOn(initial), [initial]);
  useLiveEvents((event) => setOn((current) => appearOfflineAfter(current, event)));
  return on ? <span className="appear-offline-mark" role="img" aria-label={label} title={label} /> : null;
}
