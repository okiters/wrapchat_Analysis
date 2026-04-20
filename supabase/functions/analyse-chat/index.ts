import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PROVIDER_TOKENS = 2600;
const TRUNCATION_RETRY_TOKENS = 2600;

const ALLOWED_ORIGINS = new Set([
  "https://wrapchat.vercel.app",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://wrapchat.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function createParseFailedError(details: Record<string, unknown> = {}) {
  const error = new Error("parse_failed") as Error & { details?: Record<string, unknown> };
  error.details = details;
  return error;
}

function sanitizeJsonCandidate(raw: string): string {
  let cleaned = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "\r") continue;

    if (inString) {
      if (escaped) {
        cleaned += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        cleaned += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        cleaned += ch;
        inString = false;
        continue;
      }
      if (ch === "\n") {
        cleaned += "\\n";
        continue;
      }
    } else if (ch === '"') {
      inString = true;
    }

    cleaned += ch;
  }

  return cleaned.replace(/,\s*([}\]])/g, "$1");
}

function parseModelJson(rawText: string): unknown {
  const stripped = rawText.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw createParseFailedError();

  const matched = match[0];
  let lastDetails: Record<string, unknown> = {};

  for (let start = 0; start < matched.length; start++) {
    if (matched[start] !== "{") continue;

    let firstBlockEnd = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < matched.length; i++) {
      const ch = matched[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          firstBlockEnd = i + 1;
          break;
        }
      }
    }

    if (firstBlockEnd === -1) continue;

    const candidate = matched.slice(start, firstBlockEnd);
    const cleaned = sanitizeJsonCandidate(candidate);

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const posMatch = error instanceof SyntaxError
        ? error.message.match(/position (\d+)/)
        : null;
      const parseErrorPosition = posMatch ? parseInt(posMatch[1], 10) : null;
      lastDetails = {
        candidate_start: start,
        cleaned_length: cleaned.length,
        cleaned_preview_start: cleaned.slice(0, 1200),
        cleaned_preview_end: cleaned.slice(-1200),
        ...(parseErrorPosition !== null ? {
          parse_error_position: parseErrorPosition,
          parse_error_context: cleaned.slice(Math.max(0, parseErrorPosition - 200), parseErrorPosition + 200),
        } : {}),
      };
      console.error("[analyse-chat] parse_failed cleaned_end:", cleaned.slice(-1200));
    }
  }

  throw createParseFailedError(lastDetails);
}

function looksCanonicalAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.people)) return false;
  if (!isRecord(value.shared)) return false;

  const shared = value.shared;
  const looksLikeCoreA = [
    "vibeOneLiner",
    "ghostContext",
    "funniestReason",
    "relationshipSummary",
    "kindestPerson",
    "sweetMoment",
    "growth",
  ].some(key => key in shared);

  const looksLikeCoreB = [
    "toxicity",
    "accountability",
  ].some(key => key in shared);

  return looksLikeCoreA || looksLikeCoreB;
}

function extractFirstTextBlock(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.content)) return "";
  const textBlock = data.content.find((b: unknown) => isRecord(b) && b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0);
  return textBlock && isRecord(textBlock) && typeof textBlock.text === "string" ? textBlock.text : "";
}

function didLikelyHitOutputLimit(data: unknown, raw: string): boolean {
  if (!isRecord(data)) return false;
  const stopReason = typeof data.stop_reason === "string" ? data.stop_reason : "";
  if (stopReason === "max_tokens") return true;
  const trimmed = String(raw || "").trim();
  if (!trimmed) return false;
  const withoutFence = trimmed.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return withoutFence.startsWith("{") && !withoutFence.endsWith("}");
}

async function callAnthropic(apiKey: string, system: string, userContent: string, max_tokens: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  return res;
}

// @ts-ignore: unused in debug mode — restore call sites before production
async function repairAnalysisPayload(apiKey: string, system: string, userContent: string, rawOutput: string, maxTokens: number) {
  const repairSystem = [
    "You repair multilingual AI outputs into strict JSON.",
    "Use the exact JSON structure and exact English key names required by the original instructions.",
    "Preserve all free-text values in whatever language they already use unless the original instructions explicitly require an English control token.",
    "Do not add markdown fences, commentary, or extra keys.",
    "Return only valid JSON.",
  ].join(" ");

  const repairUser = `Original system instruction:
${system}

Original user instruction:
${userContent}

Model output to repair:
${rawOutput}

Rewrite that output into valid JSON that exactly follows the original schema and uses the exact English key names from the original instructions. Preserve the existing free-text content wherever possible.`;

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 2600));
  if (!repairRes.ok) {
    await repairRes.text();
    throw new Error("Schema repair failed");
  }

  const repairData = await repairRes.json();
  return repairData.content?.[0]?.text?.trim() ?? "{}";
}

// @ts-ignore: unused in debug mode — restore call sites before production
async function repairJsonPayload(apiKey: string, system: string, userContent: string, rawOutput: string, maxTokens: number) {
  const repairSystem = [
    "You repair AI outputs into strict valid JSON.",
    "Follow the original instructions exactly.",
    "Do not add markdown fences, commentary, or extra keys.",
    "Return only valid JSON.",
  ].join(" ");

  const repairUser = `Original system instruction:
${system}

Original user instruction:
${userContent}

Model output to repair:
${rawOutput}

Rewrite that output into valid JSON that follows the original instructions exactly.`;

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 1800));
  if (!repairRes.ok) {
    await repairRes.text();
    throw new Error("JSON repair failed");
  }

  const repairData = await repairRes.json();
  return repairData.content?.[0]?.text?.trim() ?? "{}";
}

serve(async (req) => {
  console.log("[analyse-chat] request received");
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Verify JWT
  const authHeader = req.headers.get("Authorization");
  const token = getBearerToken(authHeader);
  if (!token) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: authData, error: authError } = await supabaseAuth.auth.getClaims(token);
  if (authError || !authData?.claims?.sub) {
    console.error("[analyse-chat] auth check failed:", authError?.message ?? "Missing sub claim");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  try {
    const { system, userContent, max_tokens = 1500, schema_mode = "analysis" } = await req.json();
    const safeMaxTokens = Math.min(max_tokens, MAX_PROVIDER_TOKENS);
    console.log("[analyse-chat] body:", { system: system?.slice(0, 80), userContent: userContent?.slice(0, 80), max_tokens, safeMaxTokens });

    if (!system || !userContent) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: system, userContent" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    console.log("[analyse-chat] has API key:", !!apiKey);
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    console.log("[analyse-chat] calling provider");
    let effectiveSystem = system;
    let effectiveMaxTokens = safeMaxTokens;
    let res = await callAnthropic(apiKey, effectiveSystem, userContent, effectiveMaxTokens);
    console.log("[analyse-chat] provider status:", res.status);

    if (!res.ok) {
      const text = await res.text();
      console.error("[analyse-chat] provider error:", text);
      return new Response(
        JSON.stringify({ error: "Analysis failed. Please try again." }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    let data = await res.json();
    console.log("[analyse-chat] raw response:", JSON.stringify(data).slice(0, 400));
    console.log("[analyse-chat] content blocks:", JSON.stringify((data.content || []).map((b: Record<string, unknown>) => ({ type: b.type, textLen: typeof b.text === "string" ? b.text.length : null }))));

    // Defensive text extraction: find the first non-empty text block.
    let raw: string = extractFirstTextBlock(data);
    if (!raw) {
      console.error("[analyse-chat] no_text_block: full provider payload:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Analysis failed: provider returned no text content" }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    console.log("[analyse-chat] raw text:", raw.slice(0, 200));
    if (schema_mode === "raw_text") {
      return new Response(
        raw,
        { status: 200, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    if (schema_mode === "analysis" && didLikelyHitOutputLimit(data, raw) && effectiveMaxTokens < TRUNCATION_RETRY_TOKENS) {
      const retryTokens = Math.min(TRUNCATION_RETRY_TOKENS, Math.max(effectiveMaxTokens + 1200, Math.round(effectiveMaxTokens * 1.5)));
      effectiveSystem = `${system}\n\nRETRY OVERRIDE: The previous attempt hit the output limit. Keep every free-text field concise and single-sentence where possible so the full JSON completes. Preserve the exact schema and concrete evidence.`;
      console.warn("[analyse-chat] output_limit_reached: retrying with higher token budget", { from: effectiveMaxTokens, to: retryTokens });
      const retryRes = await callAnthropic(apiKey, effectiveSystem, userContent, retryTokens);
      console.log("[analyse-chat] retry provider status:", retryRes.status);
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const retryRaw = extractFirstTextBlock(retryData);
        if (retryRaw) {
          data = retryData;
          raw = retryRaw;
          effectiveMaxTokens = retryTokens;
          console.log("[analyse-chat] retry raw response:", JSON.stringify(data).slice(0, 400));
          console.log("[analyse-chat] retry content blocks:", JSON.stringify((data.content || []).map((b: Record<string, unknown>) => ({ type: b.type, textLen: typeof b.text === "string" ? b.text.length : null }))));
          console.log("[analyse-chat] retry raw text:", raw.slice(0, 200));
        }
      }
    }

    // Strip markdown fences before parsing — model sometimes wraps JSON in ```json ... ``` blocks.
    const rawForParsing = raw.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed: unknown = null;
    let parseErrorPosition: number | null = null;
    let parseFailureDetails: Record<string, unknown> | null = null;
    try {
      parsed = parseModelJson(rawForParsing);
    } catch (parseErr) {
      const details = parseErr && typeof parseErr === "object" && "details" in parseErr && isRecord((parseErr as Record<string, unknown>).details)
        ? (parseErr as { details: Record<string, unknown> }).details
        : null;
      parseFailureDetails = details;
      // DEBUG MODE: capture parse error position from SyntaxError message (e.g. "position 6272")
      const posMatch = details && typeof details.parse_error_position === "number"
        ? null
        : parseErr instanceof SyntaxError
        ? parseErr.message.match(/position (\d+)/)
        : null;
      parseErrorPosition = details && typeof details.parse_error_position === "number"
        ? details.parse_error_position
        : posMatch ? parseInt(posMatch[1], 10) : null;
      console.error("[analyse-chat] parse_failed: could not parse provider response text");
    }

    if (parsed == null) {
      console.warn("[analyse-chat] parse_failed: attempting JSON repair");
      try {
        const repairedRaw = await repairJsonPayload(apiKey, effectiveSystem, userContent, raw, effectiveMaxTokens);
        parsed = parseModelJson(repairedRaw);
      } catch (repairErr) {
        console.error("[analyse-chat] parse_failed: JSON repair failed", repairErr);
      }
    }

    if (parsed == null) {
      const posContext = parseErrorPosition !== null
        ? rawForParsing.slice(Math.max(0, parseErrorPosition - 200), parseErrorPosition + 200)
        : null;
      console.error("[analyse-chat] parse_failed raw_length:", rawForParsing.length);
      console.error("[analyse-chat] parse_failed raw_start:", rawForParsing.slice(0, 1200));
      console.error("[analyse-chat] parse_failed raw_end:", rawForParsing.slice(-1200));
      if (posContext !== null) console.error("[analyse-chat] parse_failed pos_context:", posContext);
      return new Response(
        JSON.stringify({
          error: "parse_failed",
          raw_length: rawForParsing.length,
          raw_preview_start: rawForParsing.slice(0, 1200),
          raw_preview_end: rawForParsing.slice(-1200),
          ...(parseFailureDetails ?? {}),
          ...(posContext !== null ? { parse_error_context: posContext } : {}),
        }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (schema_mode === "analysis" && !looksCanonicalAnalysis(parsed)) {
      console.warn("[analyse-chat] invalid_response_shape: attempting schema repair");
      try {
        const repairedRaw = await repairAnalysisPayload(apiKey, effectiveSystem, userContent, raw, effectiveMaxTokens);
        parsed = parseModelJson(repairedRaw);
      } catch (repairErr) {
        console.error("[analyse-chat] invalid_response_shape: schema repair failed", repairErr);
      }
    }

    if (schema_mode === "analysis" && !looksCanonicalAnalysis(parsed)) {
      console.warn("[analyse-chat] invalid_response_shape: refusing non-canonical payload after repair attempt");
      return new Response(
        JSON.stringify({
          error: didLikelyHitOutputLimit(data, raw) ? "output_limit_reached" : "invalid_response_shape",
          raw_preview_start: rawForParsing.slice(0, 1200),
          raw_preview_end: rawForParsing.slice(-1200),
          stop_reason: isRecord(data) && typeof data.stop_reason === "string" ? data.stop_reason : null,
        }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(parsed),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[analyse-chat] fatal error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
