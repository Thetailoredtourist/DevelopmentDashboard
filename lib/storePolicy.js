/* Key-level authorization for the coaching data store.
   An authenticated user may only touch known application namespaces. */
export const MAX_KEY_LEN = 200;
export const MAX_VALUE_CHARS = 2_000_000;

export const COACH_PREFIXES = ["spine:", "fb:", "rp:"];
export const COACH_KEYS = new Set([
  "group_dev_v1", "dev_meta", "status_overrides",
  "learning_ledger", "output_lab_modules", "prospects_v1", "merge_log_v1",
]);
export const ADMIN_KEYS = new Set(["dataset_v1", "last_refreshed"]);

/* Returns "admin" | "coach" | null (refused). */
export function keyClass(key) {
  if (typeof key !== "string" || !key || key.length > MAX_KEY_LEN) return null;
  if (ADMIN_KEYS.has(key)) return "admin";
  if (COACH_KEYS.has(key)) return "coach";
  if (COACH_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length)) return "coach";
  return null;
}
export function prefixAllowed(prefix) { return COACH_PREFIXES.includes(prefix); }
