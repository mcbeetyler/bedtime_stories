// api/story.js — Vercel serverless function.
//
// The browser never sees the API key and can't send arbitrary prompts:
// it sends { kind: "menu" | "story", ...inputs } and this file builds the
// prompt, calls Anthropic, validates the JSON that comes back, and returns it.
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  required
//   ANTHROPIC_MODEL    optional, default below. Haiku is faster/cheaper:
//                      claude-haiku-4-5-20251001

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

const SAFETY =
  "Everything must be age-appropriate for young children: warm, safe, kind, no real scariness, no violence, no meanness. Silly is great.";

// ---------------------------------------------------------------- prompts

function menuPrompt(audience) {
  return `You are inventing ingredients for a dad who improvises bedtime stories out loud for his kids.

Audience: ${audience}

Give me exactly 8 of each:
- heroes (e.g. "a brave little fox", "a monster truck with a cowboy hat")
- places (e.g. "a candy garden", "a busy construction site")
- problems (e.g. "the rainbow got tangled in a tree", "a baby duck fell in the mud")
- wildcards (e.g. "a singing seashell", "a giant roll of toilet paper")

Rules:
- Tailor everything to the audience's age and any interests mentioned. Mix familiar favorites with a few surprises.
- Each entry is 2-7 words, lowercase, playful and concrete. No two entries alike.
- ${SAFETY}

Respond with ONLY valid JSON, no markdown:
{"heroes":[...],"places":[...],"problems":[...],"wildcards":[...]}`;
}

function storyPrompt({ audience, hero, place, problem, wildcard, vibe, beats }) {
  const or = (v) => v || "you pick something fun";
  const asks = beats >= 20 ? "2 or 3" : "1 or 2";
  return `You are helping a dad improvise a bedtime story out loud for his kids. Write numbered story BEATS he can read aloud and riff off.

Audience: ${audience}
Hero: ${or(hero)}
Place: ${or(place)}
Problem: ${or(problem)}
Wildcard: ${or(wildcard)}
Vibe: ${vibe}
Length: about ${beats} beats

Rules:
- Beat 1 introduces the hero and gives them a short, fun catchphrase in *italics*. Repeat the catchphrase throughout.
- Simple arc: setup → the problem appears → one or two tries that don't quite work → the wildcard helps solve it → celebration → a calm, sleepy ending where the hero falls asleep.
- Include ${asks} beats that start with "Ask the kids:" and pose a question to the children. One can be a countdown ("3… 2… 1…").
- Each beat is 1-3 short sentences, with sound effects and silly-voice cues in *italics*.
- Use **bold** for a character's name the first time it appears.
- The last 2-3 beats get slower and quieter.
- ${SAFETY}

Respond with ONLY valid JSON, no markdown fences:
{"title":"a fun story title","beats":["beat 1","beat 2","..."]}`;
}

// ---------------------------------------------------------------- helpers

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// Pull the first {...} block out of the model's reply, tolerating stray prose or fences.
function extractJson(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validateMenu(m) {
  const out = {};
  for (const key of ["heroes", "places", "problems", "wildcards"]) {
    if (!Array.isArray(m[key]) || m[key].length === 0) throw new Error(`missing "${key}"`);
    out[key] = m[key].map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  }
  return out;
}

function validateStory(s) {
  if (typeof s.title !== "string" || !Array.isArray(s.beats) || s.beats.length === 0) {
    throw new Error("not a story");
  }
  return { title: s.title.trim(), beats: s.beats.map((b) => String(b).trim()).filter(Boolean) };
}

async function complete(prompt, maxTokens, apiKey) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const status = r.status >= 400 && r.status < 500 ? r.status : 502;
    throw new ApiError(status, data?.error?.message || `Anthropic API error ${r.status}`);
  }
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------------------------------------------------------------- handler

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.",
    });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const audience = clip(body.audience, 120) || "young kids";

  let prompt;
  let maxTokens;
  let validate;

  if (body.kind === "menu") {
    prompt = menuPrompt(audience);
    maxTokens = 1200;
    validate = validateMenu;
  } else if (body.kind === "story") {
    const beats = Math.min(40, Math.max(6, Number(body.beats) || 20));
    prompt = storyPrompt({
      audience,
      hero: clip(body.hero, 120),
      place: clip(body.place, 120),
      problem: clip(body.problem, 160),
      wildcard: clip(body.wildcard, 120),
      vibe: clip(body.vibe, 60) || "silly & giggly",
      beats,
    });
    maxTokens = Math.min(4096, 500 + beats * 120);
    validate = validateStory;
  } else {
    return res.status(400).json({ error: 'Unknown request kind (expected "menu" or "story")' });
  }

  try {
    let lastErr;
    // One retry, only for garbled JSON — real API errors throw straight out.
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await complete(prompt, maxTokens, apiKey);
      try {
        return res.status(200).json(validate(extractJson(text)));
      } catch (e) {
        lastErr = e;
      }
    }
    throw new ApiError(502, `The story came back garbled (${lastErr.message}). Tap again.`);
  } catch (e) {
    console.error("api/story:", e);
    return res.status(e.status || 502).json({ error: e.message || "Request failed" });
  }
}
