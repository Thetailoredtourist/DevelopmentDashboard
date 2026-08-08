import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession, audit, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = getSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  if (session) await audit("logout", session, session.email, {});
  return res;
}
