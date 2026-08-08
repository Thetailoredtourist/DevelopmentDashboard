/* Shared Neon client. DATABASE_URL never reaches the browser. */
import { neon } from "@neondatabase/serverless";

let _sql = null;
export function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
export function dbConfigured() { return !!process.env.DATABASE_URL; }
