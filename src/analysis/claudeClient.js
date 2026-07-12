// ─────────────────────────────────────────────────────────────────
// CLAUDE CLIENT — HTTP transport to the edge function.
// Imported by both localMath (relationship confirm) and aiAnalysis.
// ─────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";

const MOCK_MODE = import.meta.env.VITE_MOCK_CLAUDE === "true";

const MOCK_ANALYSIS_PAYLOAD = {
  people: [
    { name: "Alice", messageCount: 420, avgMsgLength: 12, emojiCount: 30, responseRate: 0.9, initiationRate: 0.5, loveLangScores: { words: 8, acts: 4, gifts: 2, time: 6, touch: 3 }, topEmojis: ["😂","❤️","🥰"], signaturePhrase: "haha literally", energyLabel: "warm", energyScore: 7, energyReason: "mock", toneLabel: "playful", toneScore: 7, accountaScore: 6, promisesKept: 3, promisesBroken: 1, growthScore: 7, growthEvidence: "mock" },
    { name: "Bob",   messageCount: 380, avgMsgLength: 14, emojiCount: 20, responseRate: 0.85, initiationRate: 0.5, loveLangScores: { words: 6, acts: 7, gifts: 3, time: 8, touch: 4 }, topEmojis: ["😊","🙏","💪"], signaturePhrase: "exactly", energyLabel: "steady", energyScore: 6, energyReason: "mock", toneLabel: "supportive", toneScore: 6, accountaScore: 7, promisesKept: 4, promisesBroken: 0, growthScore: 6, growthEvidence: "mock" },
  ],
  shared: {
    vibeOneLiner: "MOCK MODE — no API call was made",
    biggestTopic: "daily life",
    ghostContext: null,
    funniestPerson: "Alice",
    funniestReason: "mock",
    dramaStarter: "neither",
    dramaContext: "low drama",
    signaturePhrases: ["haha literally", "exactly"],
    relationshipStatus: "close friends",
    relationshipStatusWhy: "mock",
    statusEvidence: "mock",
    toxicPerson: null,
    toxicReason: null,
    toxicityReport: "No toxicity detected (mock)",
    redFlags: [],
    evidenceTimeline: [],
    relationshipSummary: "A warm and balanced connection (mock).",
    sweetMoment: "mock sweet moment",
    mostLovingMoment: "mock loving moment",
    tensionMoment: "mock tension moment",
    groupDynamic: null,
    growth: { summary: "mock growth", score: 7 },
    memorableMoments: [],
  },
  meta: {
    confidenceNote: "MOCK MODE",
    dominantTone: "warm",
  },
};

export async function callClaude(systemPrompt, userContent, maxTokens = 1500, schemaMode = "analysis", schemaId = null) {
  if (MOCK_MODE) {
    console.info("[callClaude] MOCK MODE — returning fake payload, no API call made");
    await new Promise(r => setTimeout(r, 600));
    return MOCK_ANALYSIS_PAYLOAD;
  }
  let { data: { session } } = await supabase.auth.getSession();
  const isExpired = session && session.expires_at && (session.expires_at * 1000) < Date.now();
  if (!session || isExpired) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session;
    } catch (refreshErr) {
      console.warn("[callClaude] refreshSession threw:", refreshErr?.message);
    }
  }
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens, schema_mode: schemaMode, schema_id: schemaId || undefined }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      let detail = "";
      let parsed = null;
      try {
        const text = await res.text();
        parsed = tryParseJsonText(text);
        if (parsed && typeof parsed === "object") {
          console.error("[callClaude] edge function error payload:", parsed);
        }
        detail = String(parsed?.error || text || "").trim();
      } catch {
        // Fall back to the status code below.
      }
      const err = new Error(detail || `Edge function error ${res.status}`);
      if (parsed && typeof parsed === "object") {
        err.debug = parsed;
        const preview = [parsed.parse_error_context, parsed.cleaned_preview_end, parsed.raw_preview_end]
          .filter(Boolean)
          .join("\n\n");
        if (preview) err.message = `${detail || `Edge function error ${res.status}`}\n${preview}`;
      }
      throw err;
    }
    const raw = await res.json();
    return extractClaudePayload(raw);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Analysis timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callClaudeRawText(systemPrompt, userContent, maxTokens = 1500) {
  if (MOCK_MODE) {
    console.info("[callClaudeRawText] MOCK MODE — returning fake text, no API call made");
    await new Promise(r => setTimeout(r, 400));
    return "MOCK RESPONSE: This is a placeholder returned in dev mock mode. No API call was made.";
  }
  let { data: { session } } = await supabase.auth.getSession();
  const isExpired = session && session.expires_at && (session.expires_at * 1000) < Date.now();
  if (!session || isExpired) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session;
    } catch (refreshErr) {
      console.warn("[callClaudeRawText] refreshSession threw:", refreshErr?.message);
    }
  }
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens, schema_mode: "raw_text" }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        const parsed = tryParseJsonText(text);
        if (parsed && typeof parsed === "object") {
          console.error("[callClaudeRawText] edge function error payload:", parsed);
        }
        detail = String(parsed?.error || text || "").trim();
      } catch {
        // Fall back to the status code below.
      }
      throw new Error(detail || `Edge function error ${res.status}`);
    }
    return await res.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Analysis timed out");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function tryParseJsonText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function userFacingAnalysisError(error) {
  const message = String(error?.message || "").trim();
  const debug = error?.debug && typeof error.debug === "object" ? error.debug : null;
  const providerDetail = String(debug?.provider_error_message || debug?.provider_error_type || "").trim();
  const combined = [message, providerDetail].filter(Boolean).join("\n");
  if (!message) return "The AI analysis didn't come through. Please try again.";
  if (message.includes("timed out")) return "The AI took too long to answer. Please try again.";
  if (/no_entitlement/i.test(combined)) return "You need credits or a pack before running more AI reads.";
  if (/rate_limited/i.test(combined)) return "You've hit the analysis limit for now. Please wait a little while and try again.";
  if (/parse_failed/i.test(combined)) return "The AI returned malformed JSON. Check the console for the raw preview and try again.";
  if (/invalid_response_shape|output_limit_reached/i.test(combined)) return "The AI answer was cut off before it finished. Please try again.";
  if (/ANTHROPIC_API_KEY secret not set/i.test(combined)) return "The AI server isn't configured correctly yet.";
  if (/credit|billing|quota|balance/i.test(combined)) return "The AI provider needs billing or credit attention before this can run.";
  if (/rate_limit|overloaded|too many requests/i.test(combined)) return "The AI service is busy right now. Please try again in a minute.";
  if (/model|not_found|invalid_request/i.test(combined)) return "The AI model configuration needs attention. Please try again after the server is updated.";
  if (/Analysis failed/i.test(combined) || /Edge function error 502/i.test(combined)) return "The AI provider failed to return a usable answer. Please try again.";
  if (/AI returned an empty analysis/i.test(message)) return "The AI answered, but the result was empty. Please try again.";
  if (/Missing required fields/i.test(message)) return "The analysis request was incomplete. Please try again.";
  if (/failed to fetch|networkerror|load failed/i.test(message.toLowerCase())) return "The app couldn't reach the AI server. Check your connection and try again.";
  return message;
}

export function isAnalysisPayload(value) {
  return !!(
    value &&
    typeof value === "object" &&
    (
      Array.isArray(value.people) ||
      (value.shared && typeof value.shared === "object") ||
      (value.meta && typeof value.meta === "object")
    )
  );
}

export function extractClaudePayload(raw) {
  const queue = [raw];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const parsed = tryParseJsonText(current);
      if (parsed) queue.unshift(parsed);
      continue;
    }

    if (Array.isArray(current)) {
      current.forEach(item => queue.push(item));
      continue;
    }

    if (typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (isAnalysisPayload(current)) return current;

    [
      "analysis",
      "result",
      "data",
      "payload",
      "parsed",
      "json",
      "response",
      "output",
      "completion",
      "choices",
      "choice",
      "candidate",
      "candidates",
      "answer",
      "artifact",
      "text",
      "content",
      "message",
      "messages",
      "delta",
      "raw",
      "body",
    ].forEach(key => {
      if (key in current) queue.push(current[key]);
    });
  }

  return raw;
}

