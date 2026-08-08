/* ============================================================
   SERVER-ENFORCED SESSIONS  ·  HttpOnly signed cookie + RBAC
   ------------------------------------------------------------
   Password verification stays in Postgres (verify_coach/pgcrypto).
   The session value is signed here and is never readable from
   JavaScript in the browser.
   ============================================================ */
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "./db.js";
import { SESSION_MS, ROLES, ROLE_RANK } from "./performanceRules.js";

export const SESSION_COOKIE = "effy_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  const insecure = !s || s === "change-me" || s.length < 16;
  if (insecure) {
    // Fail securely and clearly. Never fall back to a known value.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is not configured");
    }
    return "dev-only-insecure-secret-not-for-production";
  }
  return s;
}

export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(value) {
  if (!value || typeof value !== "string" || !value.includes(".")) return null;
  const [body, mac] = value.split(".");
  let expected;
  try { expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url"); }
  catch { return null; }
  const a = Buffer.from(mac || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p || !p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  };
}

/* Current session from the request cookie, or null. */
export function getSession() {
  try {
    const c = cookies().get(SESSION_COOKIE);
    return c ? verifySession(c.value) : null;
  } catch { return null; }
}

/* Guards. Each returns { session } or { error, status }. */
export function requireSession() {
  const session = getSession();
  if (!session) return { error: "Authentication required", status: 401 };
  return { session };
}
export function requireRole(minRole) {
  const r = requireSession();
  if (r.error) return r;
  const rank = ROLE_RANK[r.session.role] || 0;
  if (rank < (ROLE_RANK[minRole] || 0)) {
    return { error: "Insufficient permissions", status: 403 };
  }
  return r;
}
export const requireCoach = () => requireRole(ROLES.COACH);
export const requireAdmin = () => requireRole(ROLES.ADMIN);

/* Map a coaches row to a role, backwards compatible with is_admin. */
export function roleForCoach(row) {
  if (!row) return ROLES.VIEWER;
  if (row.role && ROLE_RANK[row.role]) return row.role;
  return row.is_admin ? ROLES.ADMIN : ROLES.COACH;
}

/* Audit trail. Never throws into the caller's path. */
export async function audit(action, session, target, meta) {
  try {
    const sql = db();
    await sql`
      insert into audit_log (actor_email, actor_name, actor_role, action, target, meta)
      values (${session?.email || null}, ${session?.name || null},
              ${session?.role || null}, ${action}, ${target || null},
              ${JSON.stringify(meta || {})}::jsonb)`;
  } catch (e) {
    console.error("audit write failed:", e?.message || e);
  }
}

/* Persistent, database-backed rate limiting (serverless safe). */
export async function rateLimit({ bucket, identifier, limit, windowMinutes }) {
  try {
    const sql = db();
    const rows = await sql`
      select count(*)::int as n from usage_events
      where bucket = ${bucket} and identifier = ${identifier}
        and occurred_at > now() - (${windowMinutes} || ' minutes')::interval`;
    const used = rows[0]?.n || 0;
    if (used >= limit) return { allowed: false, used, limit };
    await sql`insert into usage_events (bucket, identifier) values (${bucket}, ${identifier})`;
    return { allowed: true, used: used + 1, limit };
  } catch (e) {
    // If the limiter itself fails, do not hard-block legitimate users,
    // but record it so the failure is visible.
    console.error("rate limit check failed:", e?.message || e);
    return { allowed: true, used: 0, limit, degraded: true };
  }
}

export function clientIp(req) {
  try {
    const h = req.headers;
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    return h.get("x-real-ip") || "unknown";
  } catch { return "unknown"; }
}
