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
import crypto from "crypto";
import { requireCoach, audit, rateLimit } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = process.env.AI_PROVIDER || "groq"; // "groq" | "google"
// Model names are env-overridable so a provider deprecation can be handled by
// changing a Vercel variable instead of shipping code.
// Groq deprecated llama-3.3-70b-versatile (June 2026); gpt-oss-120b is the
// recommended successor. Google shut down gemini-2.0-flash on 1 June 2026;
// Flash-tier models are the ones that remain on the free tier.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GROQ_MODEL_FALLBACK = process.env.GROQ_MODEL_FALLBACK || "openai/gpt-oss-20b";
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
const GOOGLE_MODEL_FALLBACK = process.env.GOOGLE_MODEL_FALLBACK || "gemini-2.5-flash-lite";

// Output caps by purpose. Coaching entries are structured and short; the
// curriculum builder needs more room. Lower caps mean lower cost per call and
// more headroom on free tiers as the coach base grows.
const MAX_OUTPUT_TOKENS = 2500;          // absolute ceiling
const PURPOSE_TOKEN_CAPS = { coaching: 1100, group: 1100, modules: 1600, debrief: 800 };
const DEFAULT_TOKEN_CAP = 1200;
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
  // Clamp regardless of what the browser asked for, and cap by purpose so a
  // routine coaching call cannot consume a curriculum-sized budget.
  const purpose = String(body?.purpose || "coaching").slice(0, 32);
  const purposeCap = PURPOSE_TOKEN_CAPS[purpose] || DEFAULT_TOKEN_CAP;
  const requested = Number(body?.max_tokens) || purposeCap;
  const maxTokens = Math.max(256, Math.min(requested, purposeCap, MAX_OUTPUT_TOKENS));

  // Response cache: a repeated identical request within the window returns the
  // stored answer instead of spending tokens again. Coaches frequently re-open
  // the same profile, and this removes that entire class of duplicate spend.
  const cacheKey = crypto.createHash("sha256")
    .update(PROVIDER + "|" + maxTokens + "|" + JSON.stringify(messages)).digest("hex");
  try {
    const sql = db();
    const hit = await sql`
      select response from ai_cache
      where cache_key = ${cacheKey} and created_at > now() - interval '6 hours'
      limit 1`;
    if (hit.length) {
      await audit("ai.cache_hit", session, purpose, {});
      return NextResponse.json({ content: [{ type: "text", text: hit[0].response }], cached: true });
    }
  } catch (e) { /* cache is an optimization, never a hard dependency */ }

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
    try {
      const sql = db();
      await sql`
        insert into ai_cache (cache_key, response, created_by)
        values (${cacheKey}, ${text}, ${session.email})
        on conflict (cache_key) do update
          set response = excluded.response, created_at = now()`;
    } catch (e) { /* optional */ }
    await audit("ai.generation", session, purpose,
                { provider: PROVIDER, maxTokens, approxPromptTokens: Math.round(promptChars / 4) });
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

async function groqOnce(model, messages, maxTokens) {
  const res = await withTimeout((signal) =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json",
                 Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    }));
  const data = await res.json();
  if (data?.error) {
    const m = String(data.error?.message || data.error?.code || "");
    // decommissioned / not found / rate limited -> caller may retry smaller
    const retryable = /decommission|not found|does not exist|model_not_found|rate/i.test(m)
                      || res.status === 404 || res.status === 429;
    const err = new Error(retryable ? "retryable" : "provider_error");
    err.detail = m;
    throw err;
  }
  return data?.choices?.[0]?.message?.content || "";
}

async function callGroq(messages, maxTokens) {
  if (!process.env.GROQ_API_KEY) throw new Error("not_configured");
  try {
    return await groqOnce(GROQ_MODEL, messages, maxTokens);
  } catch (e) {
    if (e?.message !== "retryable" || GROQ_MODEL_FALLBACK === GROQ_MODEL) throw e;
    console.warn("Groq primary model unavailable, using fallback:", e.detail || "");
    return await groqOnce(GROQ_MODEL_FALLBACK, messages, maxTokens);
  }
}

async function googleOnce(model, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
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
  if (data?.error) {
    const m = String(data.error?.message || "");
    const retryable = res.status === 404 || res.status === 429 || /not found|deprecated|quota/i.test(m);
    const err = new Error(retryable ? "retryable" : "provider_error");
    err.detail = m;
    throw err;
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGoogle(messages, maxTokens) {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error("not_configured");
  const prompt = messages.map((m) => m.content).join("\n\n");
  try {
    return await googleOnce(GOOGLE_MODEL, prompt, maxTokens);
  } catch (e) {
    if (e?.message !== "retryable" || GOOGLE_MODEL_FALLBACK === GOOGLE_MODEL) throw e;
    console.warn("Gemini primary model unavailable, using fallback:", e.detail || "");
    return await googleOnce(GOOGLE_MODEL_FALLBACK, prompt, maxTokens);
  }
}
