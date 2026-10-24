"use client";

import { since } from "@/lib/feed";
import { useEffect, useState } from "react";

/** When something happened: "5 min ago", or a date for older things. The server does not know the
 *  reader's time zone, so the first render (the server's, and the browser's matching it) gives
 *  dates in UTC and no tooltip; once in the browser it shows the reader's own. */
export function When({ iso, language, now }: { iso: string; language: string; now: number }) {
  const [here, setHere] = useState(false);
  useEffect(() => setHere(true), []);
  return (
    <time dateTime={iso} title={here ? new Date(iso).toLocaleString(language) : undefined}>
      {since(iso, language, now, here ? undefined : "UTC")}
    </time>
  );
}
