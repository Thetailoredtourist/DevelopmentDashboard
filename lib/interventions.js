/* ============================================================
   COACHING INTERVENTION EFFECTIVENESS  ·  deterministic
   ------------------------------------------------------------
   Measures observed movement after a coaching event by comparing
   the snapshot the coaching was based on against a later snapshot.
   This describes movement only. It never claims causation.
   ============================================================ */
export const MOVEMENT_STATUS = {
  IMPROVED: "Improved",
  MIXED: "Mixed",
  FLAT: "No Material Movement",
  REGRESSED: "Regressed",
  INSUFFICIENT: "Insufficient Follow-Up Data",
};

/* Sales-vs-budget movement below this many percentage points is treated
   as noise rather than a real change. */
export const MATERIAL_POINTS = 1;

export const delta = (now, then) =>
  (typeof now === "number" && typeof then === "number") ? now - then : null;

/* Classify observed post-intervention movement. */
export function classifyMovement(d) {
  if (!d) return MOVEMENT_STATUS.INSUFFICIENT;
  const signals = [d.salesVsBudget, d.aur, d.atv, d.transactions, d.units]
    .filter((v) => typeof v === "number");
  if (!signals.length) return MOVEMENT_STATUS.INSUFFICIENT;
  const up = signals.filter((v) => v > 0).length;
  const down = signals.filter((v) => v < 0).length;
  const primary = d.salesVsBudget;
  // Materiality is judged first: a fractional move is not an improvement.
  if (typeof primary === "number") {
    if (Math.abs(primary) < MATERIAL_POINTS) {
      return (up && down) ? MOVEMENT_STATUS.MIXED : MOVEMENT_STATUS.FLAT;
    }
    if (primary >= MATERIAL_POINTS) {
      return down ? MOVEMENT_STATUS.MIXED : MOVEMENT_STATUS.IMPROVED;
    }
    return up ? MOVEMENT_STATUS.MIXED : MOVEMENT_STATUS.REGRESSED;
  }
  // No budget signal: fall back to directional consensus of the rest.
  if (up && !down) return MOVEMENT_STATUS.IMPROVED;
  if (down && !up) return MOVEMENT_STATUS.REGRESSED;
  return MOVEMENT_STATUS.MIXED;
}

/* Movement for one candidate between two metric sets. */
export function movementBetween(before, after) {
  if (!before || !after) return null;
  return {
    salesVsBudget: delta(after.salesVsBudget, before.salesVsBudget),
    aur: delta(after.aur, before.aur),
    atv: delta(after.atv, before.atv),
    upt: delta(after.upt, before.upt),
    transactions: delta(after.transactions, before.transactions),
    units: delta(after.units, before.units),
  };
}

/* Evidence grading, so snapshot-backed findings are never confused
   with the pre-V2 heuristic comparisons. */
export const EVIDENCE = { SNAPSHOT: "snapshot-backed", LEGACY: "legacy-estimate" };

export function evaluateIntervention({ intervention, beforeMetrics, afterMetrics }) {
  if (!intervention) return null;
  if (!beforeMetrics || !afterMetrics) {
    return {
      candidate: intervention.candidate_name || intervention.candidateName,
      status: MOVEMENT_STATUS.INSUFFICIENT,
      evidence: EVIDENCE.SNAPSHOT, movement: null,
    };
  }
  const movement = movementBetween(beforeMetrics, afterMetrics);
  return {
    candidate: intervention.candidate_name || intervention.candidateName,
    coach: intervention.coach_name || intervention.coach,
    createdAt: intervention.created_at || intervention.createdAt,
    developmentFocus: intervention.development_focus || intervention.focus,
    readinessLevel: intervention.readiness_level || intervention.phase,
    status: classifyMovement(movement),
    evidence: EVIDENCE.SNAPSHOT,
    movement,
  };
}
