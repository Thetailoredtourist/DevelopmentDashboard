import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signSession, sessionCookieOptions, SESSION_COOKIE, roleForCoach,
         audit, rateLimit, clientIp } from "@/lib/auth";
import { SESSION_MS } from "@/lib/performanceRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 10;      // per email+ip
const WINDOW_MINUTES = 15;

export async function POST(req) {
  try {
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
      return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 415 });
    }
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password || email.length > 200 || password.length > 200) {
      return NextResponse.json({ ok: false, error: "email" }, { status: 401 });
    }

    // Persistent brute-force protection. Never permanently locks an account.
    const ip = clientIp(req);
    const rl = await rateLimit({ bucket: "login", identifier: `${email}|${ip}`,
                                 limit: MAX_ATTEMPTS, windowMinutes: WINDOW_MINUTES });
    if (!rl.allowed) {
      await audit("login.rate_limited", { email }, email, { ip });
      return NextResponse.json(
        { ok: false, error: "rate_limited",
          message: `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.` },
        { status: 429 });
    }

    const sql = db();
    const exists = await sql`select 1 from coaches where email = ${email} limit 1`;
    if (!exists.length) {
      await audit("login.failed", { email }, email, { reason: "unknown_email", ip });
      return NextResponse.json({ ok: false, error: "email" }, { status: 401 });
    }
    const rows = await sql`select * from verify_coach(${email}, ${password})`;
    if (!rows.length) {
      await audit("login.failed", { email }, email, { reason: "bad_password", ip });
      return NextResponse.json({ ok: false, error: "password" }, { status: 401 });
    }

    const coach = rows[0];
    const role = roleForCoach(coach);
    const session = { email: coach.email, name: coach.name, role,
                      exp: Date.now() + SESSION_MS };
    const res = NextResponse.json({
      ok: true, name: coach.name, role,
      isAdmin: role === "admin", expiresAt: session.exp,
    });
    res.cookies.set(SESSION_COOKIE, signSession(session), sessionCookieOptions());
    await audit("login.success", session, coach.email, { ip });
    return res;
  } catch (e) {
    console.error("login error:", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
