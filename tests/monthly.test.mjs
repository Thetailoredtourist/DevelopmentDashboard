/* Guards against the two defects found in the Monthly tab:
   a hard-coded month range, and a missing/incorrect summary row. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MONTHS_ABBR, MONTHS_FULL } from "../lib/performanceRules.js";

const src = fs.readFileSync(new URL("../components/Dashboard.jsx", import.meta.url), "utf8");

test("no hard-coded six-month array survives in the client", () => {
  // The exact defect: MONTHS capped at Jun so Jul-Dec could never render.
  assert.equal(/\[\s*"Jan"\s*,\s*"Feb"\s*,\s*"Mar"\s*,\s*"Apr"\s*,\s*"May"\s*,\s*"Jun"\s*\]/.test(src), false);
  // And the truncated label map that went with it.
  assert.equal(/Jun:\s*"June"\s*\}/.test(src), false);
});

test("month lists cover all twelve months", () => {
  assert.equal(MONTHS_ABBR.length, 12);
  assert.equal(MONTHS_FULL.length, 12);
  assert.equal(MONTHS_ABBR[7], "Aug");
  assert.equal(MONTHS_FULL[7], "August");
  // The client's own month arrays must be twelve long too.
  const m = src.match(/const intMonths=\[([^\]]*)\]/);
  assert.ok(m, "intMonths must exist in the client");
  assert.equal(m[1].split(",").length, 12);
});

test("monthly table renders a summary row", () => {
  assert.ok(src.includes("Average (${n} voyages)"), "summary row must be present");
});

/* The summary must accumulate totals, never average the monthly averages. */
function summarise(rows) {
  const list = rows.filter((w) => w && !w.nb && !w.nr);
  const sum = (f) => list.reduce((a, w) => a + (Number(w[f]) || 0), 0);
  const n = list.length;
  const tSales = sum("sd"), tUnits = sum("u"), tTrans = sum("tr"), tGap = sum("gap");
  const tBudget = tSales - tGap;
  return {
    voyages: n,
    avgSales: Math.round(tSales / n),
    gap: tGap,
    svb: tBudget > 0 ? ((tSales - tBudget) / tBudget) * 100 : 0,
    aur: tUnits > 0 ? Math.round(tSales / tUnits) : 0,
    upt: tTrans > 0 ? tUnits / tTrans : 0,
  };
}

test("summary row accumulates rather than averaging averages", () => {
  const rows = [
    { sd: 200, gap: 100, u: 10, tr: 5 },    // budget 100, +100%
    { sd: 900, gap: -100, u: 40, tr: 20 },  // budget 1000, -10%
  ];
  const s = summarise(rows);
  assert.equal(s.voyages, 2);
  assert.equal(s.avgSales, 550);
  assert.equal(s.gap, 0);
  assert.equal(Math.round(s.svb), 0);        // accumulated, not +45
  assert.equal(s.aur, 1100 / 50);            // total sales / total units
  assert.equal(s.upt, 50 / 25);
});

test("non-revenue and unbudgeted voyages stay out of the summary", () => {
  const rows = [
    { sd: 1000, gap: 0, u: 10, tr: 10 },
    { sd: 0, gap: 0, u: 0, tr: 0, nr: 1 },
    { sd: 500, gap: 0, u: 5, tr: 5, nb: 1 },
  ];
  assert.equal(summarise(rows).voyages, 1);
});

/* ---------- Monthly Sales column must be the month total ---------- */
test("monthly Sales column shows the month total, not a per-voyage average", () => {
  // The old defect rendered md.sdAvg (average per voyage) under a "Sales" header.
  assert.equal(/metricColor\(md\.sdAvg,false\)[^]{0,80}\$\{md\.sdAvg\.toLocaleString\(\)\}/.test(src), false);
  assert.ok(src.includes("md.sdTot"), "the table must read the stored month total");
});

/* ---------- Weekly overview window ---------- */
function weekWindow(rows, startKey, endKey) {
  const addDays = (k, n) => new Date(Date.parse(k + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const endOf = (w) => addDays(w.date, (w.vd || 1) - 1);
  const inWeek = rows.filter((w) => w && !w.nb && w.date <= endKey && endOf(w) >= startKey);
  const rev = inWeek.filter((w) => !w.nr);
  const sum = (l, f) => l.reduce((a, w) => a + (Number(w[f]) || 0), 0);
  const sd = sum(rev, "sd"), u = sum(rev, "u"), tr = sum(rev, "tr"), gap = sum(inWeek, "gap");
  const budget = sd - gap;
  return {
    voyages: inWeek.length, sales: sd,
    svb: budget > 0 ? ((sd - budget) / budget) * 100 : 0,
    aur: u ? Math.round(sd / u) : 0, upt: tr ? u / tr : 0,
  };
}

test("a voyage counts toward the week when its sailing days overlap it", () => {
  const rows = [
    { date: "2026-07-06", vd: 5, sd: 13635, gap: -1000, u: 5, tr: 4 },  // inside
    { date: "2026-07-11", vd: 5, sd: 22715, gap: 2000, u: 10, tr: 6 },  // starts in, ends after
    { date: "2026-06-29", vd: 5, sd: 9000, gap: 0, u: 4, tr: 3 },       // ends 07-03, before
    { date: "2026-07-20", vd: 5, sd: 5000, gap: 0, u: 2, tr: 2 },       // after
  ];
  const w = weekWindow(rows, "2026-07-06", "2026-07-12");
  assert.equal(w.voyages, 2);
  assert.equal(w.sales, 13635 + 22715);
  // accumulated, not an average of the two voyages' percentages
  assert.equal(Math.round(w.svb * 10) / 10, Math.round(((36350 - 35350) / 35350) * 1000) / 10);
  assert.equal(w.aur, Math.round(36350 / 15));
});

test("unbudgeted and non-revenue voyages stay out of the week", () => {
  const rows = [
    { date: "2026-07-06", vd: 5, sd: 10000, gap: 0, u: 5, tr: 5 },
    { date: "2026-07-07", vd: 3, sd: 0, gap: 0, u: 0, tr: 0, nb: 1 },
    { date: "2026-07-08", vd: 3, sd: 0, gap: 0, u: 0, tr: 0, nr: 1 },
  ];
  const w = weekWindow(rows, "2026-07-06", "2026-07-12");
  assert.equal(w.voyages, 2);   // nb excluded entirely
  assert.equal(w.sales, 10000); // nr excluded from revenue totals
});

/* ---------- Budget variance scoped to the current assignment ---------- */
function currentAssignment(rows) {
  const sailed = rows.filter((w) => w && !w.nb);
  const ships = sailed.map((w) => w.ship).filter(Boolean);
  if (!ships.length) return sailed;
  const current = ships[ships.length - 1];
  let startIdx = sailed.length - 1;
  for (let i = sailed.length - 1; i >= 0; i--) {
    if (sailed[i].ship && sailed[i].ship !== current) break;
    if (sailed[i].ship === current) startIdx = i;
  }
  return sailed.slice(startIdx);
}

test("overall variance covers only the current ship assignment", () => {
  const rows = [
    { date: "2026-04-01", ship: "RCI Symphony OTS", sd: 100, gap: -50 },
    { date: "2026-05-01", ship: "RCI Symphony OTS", sd: 100, gap: -50 },
    { date: "2026-06-04", ship: "RCI Mariner OTS", sd: 200, gap: 10 },
    { date: "2026-06-11", ship: "RCI Mariner OTS", sd: 200, gap: 20 },
  ];
  const a = currentAssignment(rows);
  assert.equal(a.length, 2);
  assert.equal(a[0].date, "2026-06-04");           // first voyage on the current ship
  assert.equal(a.reduce((s, w) => s + w.gap, 0), 30);  // not -70
});

test("a candidate who never changed ship keeps their whole record", () => {
  const rows = [
    { date: "2026-04-01", ship: "Carnival Vista", sd: 100, gap: 5 },
    { date: "2026-04-08", ship: "Carnival Vista", sd: 100, gap: 5 },
  ];
  assert.equal(currentAssignment(rows).length, 2);
});

/* ---------- Budget Variance assignment paging ---------- */
function assignments(rows) {
  const all = rows.filter((w) => w && !w.nb);
  if (!all.length) return [];
  const runs = [];
  for (const w of all) {
    const ship = w.ship || "Unknown ship";
    const last = runs[runs.length - 1];
    if (last && last.ship === ship) last.voyages.push(w);
    else runs.push({ ship, voyages: [w] });
  }
  return runs.reverse().map((r) => {
    const sales = r.voyages.reduce((a, w) => a + (Number(w.sd) || 0), 0);
    const budget = r.voyages.reduce((a, w) => a + ((Number(w.sd) || 0) - (Number(w.gap) || 0)), 0);
    return { ship: r.ship, count: r.voyages.length, sales, budget, variance: sales - budget };
  });
}

test("assignments are listed newest first, current one at index 0", () => {
  const rows = [
    { date: "2026-01-05", ship: "RCI Icon OTS", sd: 100, gap: -40 },
    { date: "2026-03-29", ship: "RCI Symphony OTS", sd: 300, gap: 20 },
    { date: "2026-04-05", ship: "RCI Symphony OTS", sd: 300, gap: 20 },
    { date: "2026-06-04", ship: "RCI Mariner OTS", sd: 200, gap: -10 },
  ];
  const a = assignments(rows);
  assert.equal(a.length, 3);
  assert.equal(a[0].ship, "RCI Mariner OTS");   // current
  assert.equal(a[1].ship, "RCI Symphony OTS");  // previous
  assert.equal(a[2].ship, "RCI Icon OTS");      // earliest
  assert.equal(a[1].count, 2);
  assert.equal(a[0].variance, -10);
  assert.equal(a[1].variance, 40);
});

test("each assignment reports only its own ship's figures", () => {
  const rows = [
    { date: "2026-01-05", ship: "Ship A", sd: 100, gap: -50 },
    { date: "2026-06-04", ship: "Ship B", sd: 200, gap: 30 },
  ];
  const a = assignments(rows);
  assert.equal(a[0].sales, 200);
  assert.equal(a[0].budget, 170);
  assert.equal(a[1].sales, 100);
  assert.equal(a[1].budget, 150);
});

test("returning to a former ship is a separate assignment, not merged", () => {
  const rows = [
    { date: "2025-12-27", ship: "Carnival Vista", sd: 40, gap: -10 },
    { date: "2026-01-17", ship: "Carnival Encounter", sd: 0, gap: -14 },
    { date: "2026-01-18", ship: "Carnival Vista", sd: 190, gap: -30 },
  ];
  const a = assignments(rows);
  assert.equal(a.length, 3);
  assert.equal(a[0].ship, "Carnival Vista");
  assert.equal(a[0].sales, 190);   // the later stint only
  assert.equal(a[2].sales, 40);    // the earlier stint stays separate
});

test("a candidate with one ship has a single assignment and no paging", () => {
  const rows = [
    { date: "2026-05-20", ship: "Carnival Legend", sd: 50, gap: -20 },
    { date: "2026-05-27", ship: "Carnival Legend", sd: 60, gap: -20 },
  ];
  const a = assignments(rows);
  assert.equal(a.length, 1);
  assert.equal(a[0].count, 2);
});
