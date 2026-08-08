import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The browser learns who it is without ever reading the signed value. */
export async function GET() {
  const s = getSession();
  if (!s) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true, name: s.name, role: s.role,
    isAdmin: s.role === "admin", expiresAt: s.exp,
  });
}
