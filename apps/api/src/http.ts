import { type ClientKind, ErrorCode, clientKinds } from "@anytogether/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "./errors.js";

/** The request body, checked against its schema. */
export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new HttpError(
      400,
      ErrorCode.badRequest,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
    );
  return parsed.data;
}

/** The asking program from the AnyTogether-Client header ("launcher-windows/0.3.0 (…)"). */
export function clientKind(c: Context): ClientKind {
  const name = (c.req.header("anytogether-client") ?? "").split("/")[0] as ClientKind;
  return clientKinds.includes(name) ? name : "web";
}
