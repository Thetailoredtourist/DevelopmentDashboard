import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, requireAdmin, audit } from "@/lib/auth";
import { createSnapshot, compareLatestSnapshots, listSnapshots } from "@/lib/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_KEY = "dataset_v1";
const MAX_DATASET_CHARS = 12_000_000;

/* GET: the current live dataset. Authenticated users only, so the
   ambassador roster never ships in the client bundle. */
export async function GET(req) {
  const guard = requireSession();
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: guard.status });
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "comparison") {
      return NextResponse.json(await compareLatestSnapshots());
    }
    if (url.searchParams.get("action") === "snapshots") {
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
    // 2. immutable historical snapshot (never overwritten)
    const snap = await createSnapshot({
      dataset, capturedBy: session.name, sourceFilename,
    });
    await audit("dataset.refresh", session, sourceFilename, {
      snapshotId: snap.id, candidateCount: dataset.candidates.length,
    });
    await audit("snapshot.created", session, String(snap.id), {
      candidateCount: dataset.candidates.length,
    });
    return NextResponse.json({
      ok: true, snapshotId: snap.id, capturedAt: snap.captured_at,
      candidateCount: dataset.candidates.length,
    });
  } catch (e) {
    console.error("dataset write error:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
