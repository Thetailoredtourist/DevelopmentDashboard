/* ============================================================
   EFFY AMBASSADOR INTELLIGENCE  ·  PERFORMANCE RULES
   ------------------------------------------------------------
   Single source of truth for every business rule. The parser,
   lifecycle calculations, dashboard status logic, tests and
   documentation all import from here. Do not redefine these
   numbers anywhere else.
   ============================================================ */

/* Lifecycle ------------------------------------------------- */
// A gap longer than this many typical voyages means the previous
// contract ended (vacation/rotation), so a new contract begins.
export const CONTRACT_GAP_VOYAGES = 5;
// A gap longer than this many typical voyages greys the candidate
// out of active performance pools.
export const GREYOUT_GAP_VOYAGES = 4;
// Floor for candidates without enough history to infer a voyage
// length, in days.
export const MIN_INACTIVITY_DAYS = 14;
// A ship change is only a true transfer when the new voyage starts
// within this many days of the previous voyage ending. Longer gaps
// are vacation breaks followed by a new assignment.
export const TRANSFER_CONTINUITY_DAYS = 28;
// How long the "moved ship" indicator stays visible after the move.
export const SHIP_MOVE_VISIBLE_DAYS = 28;

/* Calendar -------------------------------------------------- */
// Business reporting timezone. Named zone, so EST and EDT are both
// handled automatically. Display this to users as "ET".
export const PERFORMANCE_TIME_ZONE = "America/New_York";
export const PERFORMANCE_TIME_ZONE_LABEL = "ET";
// Organizational performance week runs Monday through Sunday.
export const WEEK_START = 1; // 1 = Monday (ISO)

/* Revenue integrity ----------------------------------------- */
// Sales-vs-budget values at or below this mark a non-revenue voyage.
// These voyages are excluded from applicable averages.
export const NON_REVENUE_THRESHOLD = -99;

/* Months ---------------------------------------------------- */
// Full twelve-month support. Nothing may slice this to six.
export const MONTHS_FULL = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
export const MONTHS_ABBR = ["Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"];

/* Tiers ----------------------------------------------------- */
export const TIER_THRESHOLDS = { star: 20, growth: 0, watch: -25 };

/* Readiness model ------------------------------------------- */
export const READINESS_LEVELS = [
  { id: "L0", label: "Emerging" },
  { id: "L1", label: "Reliable" },
  { id: "L2", label: "High-Potential" },
  { id: "L3", label: "Ambassador-Ready" },
  { id: "L4", label: "Ship Impact" },
  { id: "L5", label: "Fleet Standard-Setter" },
];

/* Sessions -------------------------------------------------- */
// One value used by both the signed cookie and the client.
export const SESSION_HOURS = 12;
export const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

/* Roles ----------------------------------------------------- */
export const ROLES = { VIEWER: "viewer", COACH: "coach", ADMIN: "admin" };
export const ROLE_RANK = { viewer: 1, coach: 2, admin: 3 };
export const canCoach = (role) => (ROLE_RANK[role] || 0) >= ROLE_RANK.coach;
export const isAdminRole = (role) => (ROLE_RANK[role] || 0) >= ROLE_RANK.admin;

/* KPI helpers ----------------------------------------------- */
// Accumulated, never an average of averages.
export function salesVsBudgetPct(totalSales, totalBudget) {
  if (!totalBudget || totalBudget <= 0) return null; // zero-budget cannot corrupt
  return ((totalSales - totalBudget) / totalBudget) * 100;
}
export function aur(totalSales, totalUnits) {
  return totalUnits > 0 ? totalSales / totalUnits : 0;
}
export function atv(totalSales, totalTransactions) {
  return totalTransactions > 0 ? totalSales / totalTransactions : 0;
}
export function upt(totalUnits, totalTransactions) {
  return totalTransactions > 0 ? totalUnits / totalTransactions : 0;
}
export function budgetSalesGap(totalSales, totalBudget) {
  return (totalSales || 0) - (totalBudget || 0);
}
export function isNonRevenueVoyage(v) {
  if (!v) return true;
  if (v.nr === 1) return true;
  return typeof v.sp === "number" && v.sp <= NON_REVENUE_THRESHOLD;
}
// Aggregate a set of voyages into accumulated KPIs.
export function aggregateVoyages(voyages) {
  const list = Array.isArray(voyages) ? voyages : [];
  const revenue = list.filter((v) => !isNonRevenueVoyage(v));
  const sum = (f) => revenue.reduce((a, v) => a + (Number(v[f]) || 0), 0);
  const totalSales = sum("sd");
  const totalUnits = sum("u");
  const totalTrans = sum("tr");
  // Only voyages carrying a real budget contribute to the budget ratio.
  const budgeted = revenue.filter((v) => Number(v.budget) > 0);
  const bSales = budgeted.reduce((a, v) => a + (Number(v.sd) || 0), 0);
  const bBudget = budgeted.reduce((a, v) => a + (Number(v.budget) || 0), 0);
  return {
    voyageCount: revenue.length,
    totalSales,
    totalUnits,
    totalTransactions: totalTrans,
    totalBudget: bBudget,
    salesVsBudget: salesVsBudgetPct(bSales, bBudget),
    avgPerVoyage: revenue.length ? totalSales / revenue.length : 0,
    aur: aur(totalSales, totalUnits),
    atv: atv(totalSales, totalTrans),
    upt: upt(totalUnits, totalTrans),
    budgetSalesGap: budgetSalesGap(bSales, bBudget),
  };
}
