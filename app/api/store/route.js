// Server-side Neon access + individual coach logins.
// DATABASE_URL and SESSION_SECRET live ONLY here, never in the browser.
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

export const runtime = "nodejs"; // Buffer + crypto require the Node runtime

const sql = neon(process.env.DATABASE_URL);
const SECRET = process.env.SESSION_SECRET || "change-me";

// --- tiny signed-token helpers (no external dependency) ---
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  // constant-time comparison prevents timing attacks on the signature
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp && Date.now() > p.exp) return null; // expired
    return p;
  } catch { return null; }
}

const MAX_KEY_LEN = 200;
const MAX_VALUE_CHARS = 2_000_000; // ~2 MB serialized cap protects the DB
const validKey = (k) => typeof k === "string" && k.length > 0 && k.length <= MAX_KEY_LEN;

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, key, value, prefix, token, email, password } = body || {};

    // --- LOGIN: verify against the coaches table, return a signed session token ---
    if (action === "login") {
      const em = String(email || "").trim().toLowerCase();
      if (!em || typeof password !== "string" || !password) {
        return Response.json({ ok: false, error: "email" }, { status: 401 });
      }
      const exists = await sql`select 1 from coaches where email = ${em} limit 1`;
      if (!exists.length) return Response.json({ ok: false, error: "email" }, { status: 401 });
      const rows = await sql`select * from verify_coach(${em}, ${password})`;
      if (!rows.length) return Response.json({ ok: false, error: "password" }, { status: 401 });
      const coach = rows[0];
      const tok = sign({ email: coach.email, name: coach.name, is_admin: coach.is_admin, exp: Date.now() + 12 * 3600 * 1000 });
      return Response.json({ ok: true, token: tok, name: coach.name, isAdmin: coach.is_admin });
    }

    // --- reads are open so the dashboard always displays ---
    if (action === "get") {
      if (!validKey(key)) return Response.json({ error: "bad key" }, { status: 400 });
      const rows = await sql`select value from coaching_store where key = ${key} limit 1`;
      return Response.json({ value: rows[0] ? rows[0].value : null });
    }
    if (action === "getPrefix") {
      // Batch read: every key/value under a prefix in ONE query.
      // Replaces per-candidate loops (98 round trips -> 1).
      if (typeof prefix !== "string" || !prefix || prefix.length > 64) {
        return Response.json({ error: "bad prefix" }, { status: 400 });
      }
      const rows = await sql`select key, value from coaching_store where key like ${prefix + "%"}`;
      return Response.json({ records: rows });
    }
    if (action === "list") {
      const rows = prefix
        ? await sql`select key from coaching_store where key like ${String(prefix) + "%"}`
        : await sql`select key from coaching_store`;
      return Response.json({ keys: rows.map((r) => r.key) });
    }
    if (action === "export") {
      const rows = await sql`select key, value, updated_at, updated_by from coaching_store order by key`;
      return Response.json({ exportedAt: new Date().toISOString(), count: rows.length, records: rows });
    }

    // --- WRITES require a valid session token; the coach's name is stamped on the row ---
    if (action === "set") {
      const session = verify(token);
      if (!session) return Response.json({ ok: false, error: "Please log in" }, { status: 401 });
      if (!validKey(key)) return Response.json({ ok: false, error: "bad key" }, { status: 400 });
      let serialized;
      try { serialized = JSON.stringify(value); } catch { serialized = null; }
      if (serialized == null || serialized.length > MAX_VALUE_CHARS) {
        return Response.json({ ok: false, error: "value too large" }, { status: 413 });
      }
      await sql`
        insert into coaching_store (key, value, updated_by)
        values (${key}, ${value}, ${session.name})
        on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`;
      return Response.json({ ok: true });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    // Log full detail server-side; never leak infrastructure errors to the browser.
    console.error("store route error:", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
