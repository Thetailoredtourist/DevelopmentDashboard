import { NextResponse } from "next/server";

/* ============================================================
   COACHING / DEVELOPMENT LAB  ·  AI PROVIDER PROXY
   ------------------------------------------------------------
   The browser never sees the API key. The dashboard posts
   { messages, max_tokens } here; this route forwards it to the
   active provider and returns the response in the shape the
   dashboard expects:  { content: [ { text: "..." } ] }

   ACTIVE PROVIDER: Groq  (free key at https://console.groq.com)
   FALLBACK:        Google AI Studio  (free key at
                    https://aistudio.google.com/app/apikey)

   To switch providers, change ONE line:  set PROVIDER below to
   "groq" or "google". Put the matching key in .env.local:
     GROQ_API_KEY=gsk_your_key_here
     GOOGLE_AI_API_KEY=your_key_here
   ============================================================ */

const PROVIDER = "groq"; // "groq"  |  "google"

// Model choices (both free tiers, change if you like)
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GOOGLE_MODEL = "gemini-2.0-flash";

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = body.messages || [];
    const maxTokens = body.max_tokens || 1500;

    if (PROVIDER === "groq") {
      return await callGroq(messages, maxTokens);
    }
    return await callGoogle(messages, maxTokens);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/* ---------- ACTIVE: Groq (OpenAI-compatible chat completions) ---------- */
async function callGroq(messages, maxTokens) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local and restart." },
      { status: 500 }
    );
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      // Groq takes the same {role, content} messages the dashboard already sends.
      messages: messages,
    }),
  });
  const data = await res.json();
  if (data.error) {
    return NextResponse.json({ error: data.error.message || "Groq error" }, { status: 500 });
  }
  // Normalize OpenAI-style -> the { content: [{ text }] } shape the dashboard reads.
  const text = data?.choices?.[0]?.message?.content || "";
  return NextResponse.json({ content: [{ type: "text", text }] });
}

/* ---------- FALLBACK: Google AI Studio (Gemini) ----------
   To use this instead of Groq:
     1) set  const PROVIDER = "google";  above
     2) put  GOOGLE_AI_API_KEY=...  in .env.local
   Nothing else changes; the dashboard sees the same response shape. */
async function callGoogle(messages, maxTokens) {
  if (!process.env.GOOGLE_AI_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_AI_API_KEY is not set. Add it to .env.local and restart." },
      { status: 500 }
    );
  }
  // Gemini wants a single prompt; flatten the chat messages into one string.
  const prompt = messages.map((m) => m.content).join("\n\n");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const data = await res.json();
  if (data.error) {
    return NextResponse.json({ error: data.error.message || "Google AI error" }, { status: 500 });
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return NextResponse.json({ content: [{ type: "text", text }] });
}
