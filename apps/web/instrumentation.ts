import type { Instrumentation } from "next";
import { errorLogLine } from "./lib/errorLog";

/** Every error a page, route or server action throws on the server is logged once, as a JSON line
 *  with the error ID the visitor sees on the error page. No outside monitoring service. */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(errorLogLine(error, request, context));
};
