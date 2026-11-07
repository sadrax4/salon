import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BookingError } from "./booking-service.ts";
import { AuthError } from "./auth.ts";
import { ForbiddenError } from "../domain/permissions.ts";
import { TransitionError } from "../domain/booking-state.ts";

/** Maps domain errors to safe HTTP responses; never leaks stack traces or internals. */
export function handle(e: unknown) {
  if (e instanceof ZodError) return NextResponse.json({ error: "VALIDATION", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  if (e instanceof BookingError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "SLOT_UNAVAILABLE" ? 409 : 400 });
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.message === "TOO_MANY_ATTEMPTS" ? 429 : 401 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (e instanceof TransitionError) return NextResponse.json({ error: "INVALID_TRANSITION", message: e.message }, { status: 409 });
  console.error(e);
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
