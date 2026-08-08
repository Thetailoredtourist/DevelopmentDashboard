/* ============================================================
   BUSINESS CALENDAR  ·  America/New_York (ET, DST-correct)
   ------------------------------------------------------------
   Never subtract a fixed UTC offset. Every calculation resolves
   the real wall-clock date in the business timezone, so EST and
   EDT are both handled automatically.
   ============================================================ */
import { PERFORMANCE_TIME_ZONE, PERFORMANCE_TIME_ZONE_LABEL } from "./performanceRules.js";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PERFORMANCE_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/* Wall-clock parts in the business timezone for any instant. */
export function etParts(date = new Date()) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) {
    if (type !== "literal") p[type] = value;
  }
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +(p.hour === "24" ? "00" : p.hour), minute: +p.minute, second: +p.second,
  };
}

/* Business-day key, e.g. "2026-08-05". Rolls over at ET midnight. */
export function etDateKey(date = new Date()) {
  const { year, month, day } = etParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* Calendar-day difference between two YYYY-MM-DD keys, DST-safe
   because both are compared as pure UTC midnights. */
export function daysBetweenKeys(fromKey, toKey) {
  if (!fromKey || !toKey) return null;
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* Days elapsed, in business days, since a YYYY-MM-DD date. */
export function daysSince(dateKey, now = new Date()) {
  return daysBetweenKeys(dateKey, etDateKey(now));
}

/* Monday of the ET week containing the given instant. */
export function weekStartKey(date = new Date()) {
  const key = etDateKey(date);
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay(); // 0=Sun
  const backToMonday = (dow + 6) % 7;
  return addDaysToKey(key, -backToMonday);
}

export function addDaysToKey(key, delta) {
  const t = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(t)) return key;
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

/* The two most recent COMPLETE Monday-Sunday weeks.
   The in-progress week is never treated as complete. */
export function lastTwoCompleteWeeks(date = new Date()) {
  const thisMonday = weekStartKey(date);
  const w1 = addDaysToKey(thisMonday, -7); // most recent complete week
  const w2 = addDaysToKey(thisMonday, -14);
  return { w1, w2, w1End: addDaysToKey(w1, 6), w2End: addDaysToKey(w2, 6) };
}

/* ET month index (0-11) and its abbreviation. */
export function etMonthIndex(date = new Date()) { return etParts(date).month - 1; }

/* Human clock string for the banner, labelled ET (not EST). */
export function etClockLabel(date = new Date()) {
  try {
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: PERFORMANCE_TIME_ZONE, weekday: "short", month: "short", day: "numeric",
    }).format(date);
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: PERFORMANCE_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true,
    }).format(date);
    return `${dateStr} . ${timeStr} ${PERFORMANCE_TIME_ZONE_LABEL}`;
  } catch { return ""; }
}

/* Back-compat shim: existing code calls getETNow()/getESTNow() and
   then reads getMonth()/getTime(). Returns a Date whose UTC fields
   equal the ET wall clock, which keeps those call sites correct. */
export function getETNow(date = new Date()) {
  const p = etParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}
