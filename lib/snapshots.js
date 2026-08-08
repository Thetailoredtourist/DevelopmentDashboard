/* ============================================================
   HISTORICAL DATASET SNAPSHOTS  ·  real, immutable, server-side
   ------------------------------------------------------------
   Replaces the synthetic "previous period" estimate that removed
   the latest voyage. Every successful admin refresh writes one
   immutable snapshot; comparisons run between two real captures.
   ============================================================ */
import { db } from "./db.js";
import { aggregateVoyages } from "./performanceRules.js";

export async function createSnapshot({ dataset, capturedBy, sourceFilename }) {
  const sql = db();
  const candidates = Array.isArray(dataset?.candidates) ? dataset.candidates : [];
  const fleets = new Set(candidates.map((c) => c.org).filter(Boolean));
  const rows = await sql`
    insert into dataset_snapshots
      (captured_by, source_filename, candidate_count, fleet_count, dataset)
    values (${capturedBy || null}, ${sourceFilename || null},
            ${candidates.length}, ${fleets.size}, ${JSON.stringify(dataset)}::jsonb)
    returning id, captured_at`;
  return rows[0];
}

export async function listSnapshots(limit = 10) {
  const sql = db();
  return await sql`
    select id, captured_at, captured_by, source_filename, candidate_count, fleet_count
    from dataset_snapshots order by captured_at desc limit ${limit}`;
}

export async function getSnapshot(id) {
  const sql = db();
  const rows = await sql`select * from dataset_snapshots where id = ${id} limit 1`;
  return rows[0] || null;
}

export async function twoMostRecentSnapshots() {
  const sql = db();
  const rows = await sql`
    select id, captured_at, captured_by, source_filename, dataset
    from dataset_snapshots order by captured_at desc limit 2`;
  return rows;
}

/* Per-candidate accumulated KPIs from a stored dataset. */
function indexCandidates(dataset) {
  const map = new Map();
  for (const c of (dataset?.candidates || [])) {
    const agg = aggregateVoyages(c.weekly || []);
    map.set(c.name, {
      name: c.name, org: c.org, tier: c.tier,
      salesVsBudget: agg.salesVsBudget,
      aur: agg.aur, atv: agg.atv, upt: agg.upt,
      transactions: agg.totalTransactions, units: agg.totalUnits,
      sales: agg.totalSales, budgetGap: agg.budgetSalesGap,
    });
  }
  return map;
}

const delta = (now, then) =>
  (typeof now === "number" && typeof then === "number") ? now - then : null;

/* Compare the two most recent REAL snapshots. Never fabricates
   movement: with fewer than two captures it says so. */
export async function compareLatestSnapshots() {
  const snaps = await twoMostRecentSnapshots();
  if (snaps.length < 2) {
    return {
      available: false,
      reason: snaps.length === 1
        ? "Only one refresh has been captured. Historical comparison becomes available after the next refresh."
        : "No dataset refreshes have been captured yet.",
      snapshotCount: snaps.length,
    };
  }
  const [current, previous] = snaps;
  const nowMap = indexCandidates(current.dataset);
  const thenMap = indexCandidates(previous.dataset);

  const movements = [];
  for (const [name, now] of nowMap) {
    const then = thenMap.get(name);
    if (!then) { movements.push({ name, org: now.org, isNew: true }); continue; }
    movements.push({
      name, org: now.org, isNew: false,
      salesVsBudget: delta(now.salesVsBudget, then.salesVsBudget),
      aur: delta(now.aur, then.aur),
      atv: delta(now.atv, then.atv),
      upt: delta(now.upt, then.upt),
      transactions: delta(now.transactions, then.transactions),
      units: delta(now.units, then.units),
      budgetGap: delta(now.budgetGap, then.budgetGap),
      tierFrom: then.tier, tierTo: now.tier,
      tierMoved: then.tier !== now.tier,
    });
  }
  const scored = movements.filter((m) => !m.isNew && typeof m.salesVsBudget === "number");
  const byMove = [...scored].sort((a, b) => b.salesVsBudget - a.salesVsBudget);
  return {
    available: true,
    currentSnapshotId: current.id, previousSnapshotId: previous.id,
    currentCapturedAt: current.captured_at, previousCapturedAt: previous.captured_at,
    label: "Since Previous Refresh",
    movements,
    topMovers: byMove.slice(0, 5),
    largestRegressions: byMove.slice(-5).reverse().filter((m) => m.salesVsBudget < 0),
    tierMovements: movements.filter((m) => m.tierMoved),
  };
}

export { classifyMovement } from "./interventions.js";
