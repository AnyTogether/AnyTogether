"use client";

import { ErrorPage } from "@/components/site/ErrorPage";

/** A page that failed, inside the site's header and footer. */
export default function PageError({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage error={error} reset={reset} />;
}
