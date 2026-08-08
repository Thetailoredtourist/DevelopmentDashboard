/* ============================================================
   COACHING / DEVELOPMENT LAB  ·  AI PROVIDER PROXY (hardened)
   ------------------------------------------------------------
   The browser never sees the API key and cannot reach this route
   without a coach or admin session. Output tokens are clamped
   server-side, requests time out, usage is rate limited in the
   database, and provider errors are sanitized before returning.
   Response shape stays { content: [{ type, text }] } so the
   dashboard is not coupled to any provider.
   ============================================================ */
import { NextResponse } from "next/server";
import { requireCoach, audit, rateLimit } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = process.env.AI_PROVIDER || "groq"; // "groq" | "google"
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GOOGLE_MODEL = "gemini-2.0-flash";

const MAX_OUTPUT_TOKENS = 2500;   // hard server-side clamp
const MAX_BODY_CHARS = 200_000;   // request body limit
const MAX_PROMPT_CHARS = 120_000; // prompt size limit
const PROVIDER_TIMEOUT_MS = 45_000;
const AI_LIMIT = 60;              // requests per user
const AI_WINDOW_MINUTES = 60;

function sameOriginOk(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches may omit it
  const host = req.headers.get("host");
  try { return !host || new URL(origin).host === host; } catch { return false; }
}

export async function POST(req) {
  const guard = requireCoach();
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const session = guard.session;

  if (!sameOriginOk(req)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (!(req.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 415 });
  }

  let raw;
  try { raw = await req.text(); }
  catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    return NextResponse.json({ error: "no_messages" }, { status: 400 });
  }
  const promptChars = messages.reduce(
    (n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0);
  if (promptChars > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "prompt_too_large" }, { status: 413 });
  }
  // Clamp regardless of what the browser asked for.
  const requested = Number(body?.max_tokens) || 1500;
  const maxTokens = Math.max(256, Math.min(requested, MAX_OUTPUT_TOKENS));

  const rl = await rateLimit({ bucket: "ai", identifier: session.email,
                               limit: AI_LIMIT, windowMinutes: AI_WINDOW_MINUTES });
  if (!rl.allowed) {
    await audit("ai.rate_limited", session, null, { used: rl.used });
    return NextResponse.json(
      { error: "rate_limited", message: "AI usage limit reached. Try again shortly." },
      { status: 429 });
  }

  try {
    const text = PROVIDER === "google"
      ? await callGoogle(messages, maxTokens)
      : await callGroq(messages, maxTokens);
    await audit("ai.generation", session, body?.purpose || "coaching",
                { provider: PROVIDER, maxTokens });
    return NextResponse.json({ content: [{ type: "text", text }] });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("AI provider error:", msg);
    if (msg === "not_configured") {
      return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
    }
    if (msg === "timeout") {
      return NextResponse.json({ error: "ai_timeout" }, { status: 504 });
    }
    // Sanitized: no key material, no upstream infrastructure detail.
    return NextResponse.json({ error: "ai_unavailable" }, { status: 502 });
  }
}

async function withTimeout(fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
  try { return await fn(ctrl.signal); }
  catch (e) { throw (e?.name === "AbortError" ? new Error("timeout") : e); }
  finally { clearTimeout(t); }
}

async function callGroq(messages, maxTokens) {
  if (!process.env.GROQ_API_KEY) throw new Error("not_configured");
  const res = await withTimeout((signal) =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json",
                 Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, max_tokens: maxTokens, messages }),
    }));
  const data = await res.json();
  if (data?.error) throw new Error("provider_error");
  return data?.choices?.[0]?.message?.content || "";
}

async function callGoogle(messages, maxTokens) {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error("not_configured");
  const prompt = messages.map((m) => m.content).join("\n\n");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await withTimeout((signal) =>
    fetch(url, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }));
  const data = await res.json();
  if (data?.error) throw new Error("provider_error");
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
