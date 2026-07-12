import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OUTPUT_SCHEMAS } from "./schemas.ts";

// Output budget. The Core A / connection schema asks for ~50 populated fields;
// the old 2600 clamp regularly truncated it (and the retry below could never
// fire because the request was already at the ceiling).
const MAX_PROVIDER_TOKENS = 5000;
const TRUNCATION_RETRY_TOKENS = 6400;
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
// claude-sonnet-4-20250514 (Sonnet 4) retired 2026-06-15 and now 404s.
const FALLBACK_ANTHROPIC_MODEL = "claude-sonnet-4-5";

// Server-side gating (see migration 20260712120000_edge_ai_gating.sql).
const RATE_LIMIT_MAX_CALLS = 60;      // per user
const RATE_LIMIT_WINDOW_MINUTES = 60; // fixed window
const ALLOWED_SCHEMA_MODES = new Set(["analysis", "json", "raw_text", "relationship"]);
const MAX_SYSTEM_CHARS = 60_000;
const MAX_USER_CONTENT_CHARS = 600_000;
// Fail-open keeps production alive if the gating migration has not been applied
// yet (RPC missing). Flip to false once 20260712120000 is confirmed deployed.
const GATING_FAIL_OPEN = false;

const ALLOWED_ORIGINS = new Set([
  "https://wrapchat.vercel.app",
  "capacitor://localhost",
  "ionic://localhost",
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

async function callAnthropic(
  apiKey: string,
  system: string,
  userContent: string,
  max_tokens: number,
  model: string,
  outputSchema: Record<string, unknown> | null = null,
) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      system,
      messages: [{ role: "user", content: userContent }],
      // Structured outputs: guarantees schema-valid JSON when supported by
      // the model; on models without support the 400 is caught by the caller
      // and the request is retried without the schema (prose-JSON path).
      ...(outputSchema ? { output_config: { format: { type: "json_schema", schema: outputSchema } } } : {}),
    }),
  });

  return res;
}

function isStructuredOutputRejection(status: number, providerError: Record<string, unknown>): boolean {
  if (status !== 400) return false;
  const message = String(providerError.provider_error_message || "").toLowerCase();
  return (
    message.includes("output_config") ||
    message.includes("output config") ||
    message.includes("json_schema") ||
    message.includes("structured") ||
    message.includes("format")
  );
}

function parseProviderError(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      const error = isRecord(parsed.error) ? parsed.error : {};
      return {
        provider_error_type: typeof error.type === "string" ? error.type : null,
        provider_error_message: typeof error.message === "string" ? error.message.slice(0, 500) : raw.slice(0, 500),
      };
    }
  } catch {
    // Fall through to a plain-text preview.
  }

  return {
    provider_error_type: null,
    provider_error_message: raw.slice(0, 500),
  };
}

function shouldRetryWithFallbackModel(status: number, providerError: Record<string, unknown>) {
  if (status !== 400 && status !== 404) return false;
  const message = String(providerError.provider_error_message || "").toLowerCase();
  const type = String(providerError.provider_error_type || "").toLowerCase();
  return (
    type.includes("not_found") ||
    type.includes("invalid_request") ||
    message.includes("model") ||
    message.includes("not found") ||
    message.includes("does not exist")
  );
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

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 2600), Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL);
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

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 1800), Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL);
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
  const userId = String(authData.claims.sub);

  // ── Server-side gating: rate limit + entitlement ──
  // The JWT alone is not enough: accounts are free, and this endpoint spends
  // real money per call. Every request must pass a per-user rate limit, and in
  // credits/payments mode the user must hold credits, a pack, or a live Quick
  // Read. Open mode and allowlisted admins pass the entitlement check inside
  // the RPC itself.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey) {
    const service = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    const { data: quotaOk, error: quotaError } = await service.rpc("consume_ai_call_quota", {
      p_user_id: userId,
      p_max_calls: RATE_LIMIT_MAX_CALLS,
      p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
    });
    if (quotaError) {
      console.error("[analyse-chat] rate-limit RPC failed:", quotaError.message);
      if (!GATING_FAIL_OPEN) {
        return new Response(
          JSON.stringify({ error: "rate_limit_unavailable" }),
          { status: 503, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    } else if (quotaOk === false) {
      return new Response(
        JSON.stringify({ error: "rate_limited", detail: "Too many analysis calls. Please wait a bit and try again." }),
        { status: 429, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: entitled, error: entitlementError } = await service.rpc("user_has_ai_entitlement", {
      p_user_id: userId,
    });
    if (entitlementError) {
      console.error("[analyse-chat] entitlement RPC failed:", entitlementError.message);
      if (!GATING_FAIL_OPEN) {
        return new Response(
          JSON.stringify({ error: "entitlement_unavailable" }),
          { status: 503, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    } else if (entitled === false) {
      return new Response(
        JSON.stringify({ error: "no_entitlement", detail: "This account has no credits, packs, or trial available." }),
        { status: 402, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
  } else {
    console.error("[analyse-chat] SUPABASE_SERVICE_ROLE_KEY not set — gating skipped");
  }

  try {
    const { system, userContent, max_tokens = 1500, schema_mode = "analysis", schema_id = null } = await req.json();
    let outputSchema = typeof schema_id === "string" && OUTPUT_SCHEMAS[schema_id] ? OUTPUT_SCHEMAS[schema_id] : null;
    const safeMaxTokens = Math.min(
      Number.isFinite(Number(max_tokens)) && Number(max_tokens) > 0 ? Math.floor(Number(max_tokens)) : 1500,
      MAX_PROVIDER_TOKENS
    );
    console.log("[analyse-chat] body:", { system: system?.slice(0, 80), userContent: userContent?.slice(0, 80), max_tokens, safeMaxTokens });

    if (!system || !userContent || typeof system !== "string" || typeof userContent !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing required fields: system, userContent" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    if (!ALLOWED_SCHEMA_MODES.has(String(schema_mode))) {
      return new Response(
        JSON.stringify({ error: "Unsupported schema_mode" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    if (system.length > MAX_SYSTEM_CHARS || userContent.length > MAX_USER_CONTENT_CHARS) {
      return new Response(
        JSON.stringify({ error: "Request payload too large" }),
        { status: 413, headers: { ...CORS, "Content-Type": "application/json" } }
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

    const primaryModel = Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL;
    console.log("[analyse-chat] calling provider", { model: primaryModel });
    let effectiveSystem = system;
    let effectiveMaxTokens = safeMaxTokens;
    let effectiveModel = primaryModel;
    let res = await callAnthropic(apiKey, effectiveSystem, userContent, effectiveMaxTokens, effectiveModel, outputSchema);
    console.log("[analyse-chat] provider status:", res.status, outputSchema ? `(structured: ${schema_id})` : "(prose)");

    if (!res.ok) {
      const text = await res.text();
      let providerError = parseProviderError(text);
      console.error("[analyse-chat] provider error:", { model: effectiveModel, status: res.status, ...providerError });

      if (outputSchema && isStructuredOutputRejection(res.status, providerError)) {
        console.warn("[analyse-chat] structured outputs rejected by model, retrying without schema", { model: effectiveModel, schema_id });
        outputSchema = null;
        res = await callAnthropic(apiKey, effectiveSystem, userContent, effectiveMaxTokens, effectiveModel);
        console.log("[analyse-chat] prose retry status:", res.status);
        if (!res.ok) {
          const proseText = await res.text();
          providerError = parseProviderError(proseText);
          console.error("[analyse-chat] prose retry error:", { model: effectiveModel, status: res.status, ...providerError });
        }
      }

      if (!res.ok && effectiveModel !== FALLBACK_ANTHROPIC_MODEL && shouldRetryWithFallbackModel(res.status, providerError)) {
        effectiveModel = FALLBACK_ANTHROPIC_MODEL;
        outputSchema = null;
        console.warn("[analyse-chat] retrying provider with fallback model", { model: effectiveModel });
        res = await callAnthropic(apiKey, effectiveSystem, userContent, effectiveMaxTokens, effectiveModel);
        console.log("[analyse-chat] fallback provider status:", res.status);
        if (!res.ok) {
          const fallbackText = await res.text();
          providerError = parseProviderError(fallbackText);
          console.error("[analyse-chat] fallback provider error:", { model: effectiveModel, status: res.status, ...providerError });
        }
      }

      if (!res.ok) {
        return new Response(
          JSON.stringify({
            error: "Analysis failed. Please try again.",
            provider_status: res.status,
            provider_model: effectiveModel,
            ...providerError,
          }),
          { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
    }

    let data = await res.json();
    console.log("[analyse-chat] provider model used:", effectiveModel);
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
      const retryRes = await callAnthropic(apiKey, effectiveSystem, userContent, retryTokens, effectiveModel, outputSchema);
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
