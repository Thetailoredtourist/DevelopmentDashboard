import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requireAdmin, getSession, audit } from "@/lib/auth";
import { createSnapshot, compareLatestSnapshots, listSnapshots } from "@/lib/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_KEY = "dataset_v1";
const MAX_DATASET_CHARS = 12_000_000;

/* GET: the current live dataset. Authenticated users only, so the
   ambassador roster never ships in the client bundle. */
export async function GET(req) {
  // Guest view: the three performance panels (Overview, Performance, Analytics)
  // are readable without a session when GUEST_VIEW is enabled, so the fleet can
  // see current numbers without an account. Coaching data and every write still
  // require authentication. Set GUEST_VIEW=off to lock reads to signed-in users.
  const guestAllowed = (process.env.GUEST_VIEW || "on").toLowerCase() !== "off";
  const session = getSession();
  if (!session && !guestAllowed) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "comparison") {
      if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      return NextResponse.json(await compareLatestSnapshots());
    }
    if (url.searchParams.get("action") === "snapshots") {
      if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      return NextResponse.json({ snapshots: await listSnapshots(10) });
    }
    const sql = db();
    const rows = await sql`select value from coaching_store where key = ${LIVE_KEY} limit 1`;
    if (!rows.length) return NextResponse.json({ dataset: null });
    return NextResponse.json({ dataset: rows[0].value });
  } catch (e) {
    console.error("dataset read error:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/* POST: admin-only refresh. Saves the live dataset AND writes an
   immutable historical snapshot stamped with who, when and source. */
export async function POST(req) {
  const guard = requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
      return NextResponse.json({ error: "invalid_request" }, { status: 415 });
    }
    const body = await req.json();
    const dataset = body?.dataset;
    const sourceFilename = String(body?.sourceFilename || "").slice(0, 300);
    if (!dataset || !Array.isArray(dataset.candidates) || !dataset.candidates.length) {
      return NextResponse.json({ error: "empty_dataset" }, { status: 400 });
    }
    const serialized = JSON.stringify(dataset);
    if (serialized.length > MAX_DATASET_CHARS) {
      return NextResponse.json({ error: "dataset_too_large" }, { status: 413 });
    }

    const sql = db();
    const session = guard.session;
    // 1. live dataset for fast application loading
    await sql`
      insert into coaching_store (key, value, updated_by)
      values (${LIVE_KEY}, ${serialized}::jsonb, ${session.name})
      on conflict (key) do update
        set value = excluded.value, updated_by = excluded.updated_by`;
    // 2. immutable historical snapshot (never overwritten).
    // The live dataset is already saved above, so a snapshot failure must not
    // discard a good refresh: report it instead of losing the upload.
    let snap = null, snapshotError = null;
    try {
      snap = await createSnapshot({ dataset, capturedBy: session.name, sourceFilename });
    } catch (se) {
      const code = se?.code || se?.sourceError?.code;
      snapshotError = (code === "42P01" || /relation .* does not exist/i.test(String(se?.message || "")))
        ? "migration_required" : "snapshot_failed";
      console.error("snapshot write failed:", se);
    }
    await audit("dataset.refresh", session, sourceFilename, {
      snapshotId: snap?.id || null, candidateCount: dataset.candidates.length,
      snapshotError,
    });
    if (snap) {
      await audit("snapshot.created", session, String(snap.id), {
        candidateCount: dataset.candidates.length,
      });
    }
    return NextResponse.json({
      ok: true, sharedSaved: true,
      snapshotId: snap?.id || null, capturedAt: snap?.captured_at || null,
      candidateCount: dataset.candidates.length,
      snapshotError,
      message: snapshotError === "migration_required"
        ? "Shared dataset updated for all coaches, but history was not captured: run migrations/001_v2_core.sql to enable snapshots."
        : null,
    });
  } catch (e) {
    console.error("dataset write error:", e);
    // 42P01 = undefined_table. The V2 migration has not been run yet.
    const code = e?.code || e?.sourceError?.code;
    const msg = String(e?.message || "");
    if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
      return NextResponse.json({
        error: "migration_required",
        message: "The V2 database migration has not been run. Run migrations/001_v2_core.sql in the Neon SQL editor, then refresh again.",
      }, { status: 503 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/* Schema health: tells an admin exactly which V2 tables are missing. */
export async function PUT() {
  const guard = requireAdmin();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const sql = db();
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('coaching_store','coaches','dataset_snapshots',
                           'audit_log','usage_events','coaching_interventions')`;
    const present = rows.map((r) => r.table_name);
    const required = ["coaching_store","coaches","dataset_snapshots",
                      "audit_log","usage_events","coaching_interventions"];
    const missing = required.filter((t) => !present.includes(t));
    return NextResponse.json({
      ok: missing.length === 0, present, missing,
      migrationRequired: missing.length > 0,
    });
  } catch (e) {
    console.error("schema check error:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
