"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Opened from the mail: the link's token signs this browser in. */
export function MagicLink({ checking, failed }: { checking: string; failed: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    fetch("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: params.get("email"), link: params.get("token") }),
    }).then(async (response) => {
      if (response.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError((await response.json().catch(() => ({}))).title ?? failed);
      }
    });
  }, [params, router, failed]);
  return <p className={error ? "error" : "hint"}>{error ?? checking}</p>;
}
