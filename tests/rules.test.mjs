/* V2 acceptance tests. Node's built-in runner: no new dependency. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  salesVsBudgetPct, aur, atv, upt, budgetSalesGap, aggregateVoyages,
  isNonRevenueVoyage, CONTRACT_GAP_VOYAGES, GREYOUT_GAP_VOYAGES,
  MONTHS_FULL, NON_REVENUE_THRESHOLD, SESSION_MS, ROLE_RANK,
  canCoach, isAdminRole,
} from "../lib/performanceRules.js";
import {
  etDateKey, weekStartKey, lastTwoCompleteWeeks, daysBetweenKeys, addDaysToKey, etParts,
} from "../lib/datetime.js";
import { classifyMovement } from "../lib/interventions.js";

/* ---------- KPI integrity ---------- */
test("Sales vs Budget uses accumulated totals, not an average of averages", () => {
  // Two voyages: one far over budget on a small budget, one under on a large one.
  const voyages = [
    { sd: 200, budget: 100, u: 10, tr: 5 },   // +100%
    { sd: 900, budget: 1000, u: 40, tr: 20 }, // -10%
  ];
  const agg = aggregateVoyages(voyages);
  // Accumulated: (1100-1100)/1100 = 0%. Average of percentages would be +45%.
  assert.equal(Math.round(agg.salesVsBudget), 0);
  assert.notEqual(Math.round(agg.salesVsBudget), 45);
});

test("AUR, ATV and UPT are total-based", () => {
  assert.equal(aur(1000, 40), 25);
  assert.equal(atv(1000, 25), 40);
  assert.equal(upt(40, 25), 1.6);
});

test("Budget Sales Gap is sales minus budget", () => {
  assert.equal(budgetSalesGap(1200, 1000), 200);
  assert.equal(budgetSalesGap(800, 1000), -200);
});

test("zero-budget voyages cannot corrupt Sales vs Budget", () => {
  assert.equal(salesVsBudgetPct(500, 0), null);
  const agg = aggregateVoyages([
    { sd: 500, budget: 0, u: 5, tr: 5 },
    { sd: 1000, budget: 1000, u: 10, tr: 10 },
  ]);
  assert.equal(Math.round(agg.salesVsBudget), 0); // only the budgeted voyage counts
  assert.equal(agg.totalSales, 1500);             // sales still accumulate
});

test("non-revenue voyages are excluded from averages", () => {
  assert.equal(isNonRevenueVoyage({ sp: NON_REVENUE_THRESHOLD }), true);
  assert.equal(isNonRevenueVoyage({ nr: 1 }), true);
  assert.equal(isNonRevenueVoyage({ sp: 5, nr: 0 }), false);
  const agg = aggregateVoyages([
    { sd: 1000, budget: 1000, u: 10, tr: 10, sp: 0 },
    { sd: 0, budget: 0, u: 0, tr: 0, nr: 1 },
  ]);
  assert.equal(agg.voyageCount, 1);
  assert.equal(agg.avgPerVoyage, 1000);
});

test("Sales total and Avg per Voyage are distinct measures", () => {
  const agg = aggregateVoyages([
    { sd: 1000, budget: 500, u: 10, tr: 5 },
    { sd: 3000, budget: 500, u: 30, tr: 15 },
  ]);
  assert.equal(agg.totalSales, 4000);
  assert.equal(agg.avgPerVoyage, 2000);
  assert.notEqual(agg.totalSales, agg.avgPerVoyage);
});

/* ---------- lifecycle constants ---------- */
test("contract and greyout voyage rules are single-sourced", () => {
  assert.equal(CONTRACT_GAP_VOYAGES, 5);
  assert.equal(GREYOUT_GAP_VOYAGES, 4);
  assert.ok(CONTRACT_GAP_VOYAGES > GREYOUT_GAP_VOYAGES);
});

/* ---------- twelve-month support ---------- */
test("all twelve months are supported", () => {
  assert.equal(MONTHS_FULL.length, 12);
  assert.equal(MONTHS_FULL[6], "July");
  assert.equal(MONTHS_FULL[11], "December");
});

/* ---------- calendar and DST ---------- */
test("performance week starts on Monday", () => {
  // 2026-08-05 is a Wednesday; its week starts Monday 2026-08-03.
  const wed = new Date("2026-08-05T16:00:00Z");
  assert.equal(weekStartKey(wed), "2026-08-03");
  // Sunday belongs to the week that began the previous Monday.
  const sun = new Date("2026-08-09T16:00:00Z");
  assert.equal(weekStartKey(sun), "2026-08-03");
});

test("last two complete weeks exclude the in-progress week", () => {
  const w = lastTwoCompleteWeeks(new Date("2026-08-05T16:00:00Z"));
  assert.equal(w.w1, "2026-07-27");
  assert.equal(w.w2, "2026-07-20");
  assert.equal(w.w1End, "2026-08-02");
});

test("week maths survives the DST transitions", () => {
  // US DST starts 2026-03-08 and ends 2026-11-01.
  assert.equal(weekStartKey(new Date("2026-03-09T12:00:00Z")), "2026-03-09");
  assert.equal(weekStartKey(new Date("2026-03-14T12:00:00Z")), "2026-03-09");
  assert.equal(weekStartKey(new Date("2026-11-02T12:00:00Z")), "2026-11-02");
  assert.equal(weekStartKey(new Date("2026-11-06T12:00:00Z")), "2026-11-02");
  // A week is exactly seven calendar days across a DST boundary.
  assert.equal(daysBetweenKeys("2026-03-02", "2026-03-09"), 7);
  assert.equal(daysBetweenKeys("2026-10-26", "2026-11-02"), 7);
  assert.equal(addDaysToKey("2026-03-07", 1), "2026-03-08");
});

test("business date resolves in New York, not UTC", () => {
  // 03:00 UTC on 6 Aug is still 23:00 on 5 Aug in New York.
  assert.equal(etDateKey(new Date("2026-08-06T03:00:00Z")), "2026-08-05");
  // EDT in August is UTC-4.
  assert.equal(etParts(new Date("2026-08-06T03:00:00Z")).hour, 23);
  // EST in January is UTC-5.
  assert.equal(etParts(new Date("2026-01-06T03:00:00Z")).hour, 22);
});

/* ---------- roles and sessions ---------- */
test("role ranks enforce the permission ladder", () => {
  assert.ok(ROLE_RANK.admin > ROLE_RANK.coach);
  assert.ok(ROLE_RANK.coach > ROLE_RANK.viewer);
  assert.equal(canCoach("viewer"), false);
  assert.equal(canCoach("coach"), true);
  assert.equal(canCoach("admin"), true);
  assert.equal(isAdminRole("coach"), false);
  assert.equal(isAdminRole("admin"), true);
});

test("session expiry is one shared 12-hour value", () => {
  assert.equal(SESSION_MS, 12 * 60 * 60 * 1000);
});

/* ---------- intervention movement ---------- */
test("post-intervention movement classifies without claiming causation", () => {
  assert.equal(classifyMovement(null), "Insufficient Follow-Up Data");
  assert.equal(classifyMovement({}), "Insufficient Follow-Up Data");
  assert.equal(classifyMovement({ salesVsBudget: 8, aur: 3, atv: 2 }), "Improved");
  assert.equal(classifyMovement({ salesVsBudget: -8, aur: -3 }), "Regressed");
  assert.equal(classifyMovement({ salesVsBudget: 0.4, aur: 2, atv: -1 }), "Mixed");
  assert.equal(classifyMovement({ salesVsBudget: 0.5 }), "No Material Movement");
});

/* ---------- store key authorization ---------- */
import { keyClass, prefixAllowed } from "../lib/storePolicy.js";

test("store keys are scoped by namespace and role", () => {
  assert.equal(keyClass("spine:Eduin_Jose"), "coach");
  assert.equal(keyClass("fb:Someone"), "coach");
  assert.equal(keyClass("group_dev_v1"), "coach");
  assert.equal(keyClass("dataset_v1"), "admin");   // global key: admin only
  assert.equal(keyClass("last_refreshed"), "admin");
  assert.equal(keyClass("arbitrary_key"), null);   // unknown namespace refused
  assert.equal(keyClass("spine:"), null);          // bare prefix refused
  assert.equal(keyClass("x".repeat(201)), null);   // oversized key refused
  assert.equal(keyClass(null), null);
  assert.equal(prefixAllowed("spine:"), true);
  assert.equal(prefixAllowed("dataset_"), false);
});
