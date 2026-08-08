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
