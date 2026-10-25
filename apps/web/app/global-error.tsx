"use client";

import { ErrorPage } from "@/components/site/ErrorPage";
import "./globals.css";
import "./site.css";
import "./night.css";
import "./pages.css";

/** The root layout itself failed: the error page on its own, in a document of its own. */
export default function GlobalError({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main>
          <ErrorPage error={error} reset={reset} />
        </main>
      </body>
    </html>
  );
}
