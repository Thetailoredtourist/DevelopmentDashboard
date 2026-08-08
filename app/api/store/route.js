/* ============================================================
   COACHING DATA STORE  ·  session-enforced, key-scoped
   ------------------------------------------------------------
   Open reads are gone. Every action requires a valid session,
   writes require coach or admin, export and global keys require
   admin. Keys are validated against known application namespaces
   so an authenticated user cannot write arbitrary rows.
   ============================================================ */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requireCoach, requireAdmin, audit } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { keyClass, prefixAllowed, MAX_VALUE_CHARS } from "@/lib/storePolicy";

export async function POST(req) {
  try {
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
      return NextResponse.json({ error: "invalid_request" }, { status: 415 });
    }
    const body = await req.json();
    const { action, key, value, prefix } = body || {};

    if (action === "ping") {
      // Connectivity check for signed-in users only.
      const guard = requireSession();
      if (guard.error) return NextResponse.json({ ok: false }, { status: guard.status });
      await db()`select 1`;
      return NextResponse.json({ ok: true, db: true });
    }

    /* ---------- reads: authenticated ---------- */
    if (action === "get" || action === "getPrefix" || action === "list") {
      const guard = requireSession();
      if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
      const sql = db();

      if (action === "get") {
        if (!keyClass(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
        const rows = await sql`select value from coaching_store where key = ${key} limit 1`;
        return NextResponse.json({ value: rows.length ? rows[0].value : null });
      }
      if (action === "getPrefix") {
        if (!prefixAllowed(prefix)) {
          return NextResponse.json({ error: "bad prefix" }, { status: 400 });
        }
        const rows = await sql`select key, value from coaching_store where key like ${prefix + "%"}`;
        return NextResponse.json({ records: rows });
      }
      const rows = prefix
        ? await sql`select key from coaching_store where key like ${String(prefix).slice(0, 64) + "%"}`
        : await sql`select key from coaching_store`;
      return NextResponse.json({ keys: rows.map((r) => r.key) });
    }

    /* ---------- export: admin only ---------- */
    if (action === "export") {
      const guard = requireAdmin();
      if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
      const rows = await db()`
        select key, value, updated_at, updated_by from coaching_store order by key`;
      await audit("system.export", guard.session, "coaching_store", { count: rows.length });
      return NextResponse.json({
        exportedAt: new Date().toISOString(), count: rows.length, records: rows,
      });
    }

    /* ---------- writes: coach or admin, key-scoped ---------- */
    if (action === "set") {
      const cls = keyClass(key);
      if (!cls) return NextResponse.json({ error: "bad key" }, { status: 400 });
      const guard = cls === "admin" ? requireAdmin() : requireCoach();
      if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });

      let serialized;
      try { serialized = JSON.stringify(value); } catch { serialized = null; }
      if (serialized == null || serialized.length > MAX_VALUE_CHARS) {
        return NextResponse.json({ error: "value too large" }, { status: 413 });
      }
      await db()`
        insert into coaching_store (key, value, updated_by)
        values (${key}, ${serialized}::jsonb, ${guard.session.name})
        on conflict (key) do update
          set value = excluded.value, updated_by = excluded.updated_by`;
      // Coaching-relevant writes are audited; routine cache keys are not noisy.
      if (key.startsWith("spine:")) await audit("coaching.entry.saved", guard.session, key, {});
      else if (key === "group_dev_v1") await audit("group.updated", guard.session, key, {});
      else if (key === "status_overrides") await audit("status.override", guard.session, key, {});
      else if (key === "dev_meta") await audit("development.status.changed", guard.session, key, {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("store route error:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
