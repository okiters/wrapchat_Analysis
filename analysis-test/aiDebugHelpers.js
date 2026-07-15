// ─────────────────────────────────────────────────────────────────
// AI DEBUG HELPERS — client-side request assembly.
//
// Since the server-side prompt refactor, these builders no longer own any
// prompt text: they assemble the structured DATA payload (redacted window
// text, math context, candidate moments) that the edge function turns into
// prompts, and render the same prompts locally via the shared module for
// the debug panel, offline exports, and the golden harness.
// Prompt wording lives in supabase/functions/_shared/prompts.js only.
// ─────────────────────────────────────────────────────────────────
import { renderPipelinePrompt } from "../supabase/functions/_shared/prompts.js";

function sanitizeDownloadBaseName(fileName) {
  const base = String(fileName || "wrapchat-chat")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "wrapchat-chat";
}

export function createAiDebugFileName(fileName) {
  return `${sanitizeDownloadBaseName(fileName)}-ai-debug.json`;
}

export function createAiRawDebugFileName(fileName, pipeline = "core-a") {
  return `${sanitizeDownloadBaseName(fileName)}-${pipeline}-raw.txt`;
}

export function serializeDebugAnalysisExport(payload) {
  return JSON.stringify(payload, null, 2);
}

export function downloadJsonFile(jsonText, fileName) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(text, fileName) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function toDebugRequestRecord(request) {
  if (!request) return null;
  return {
    pipeline: request.pipeline,
    systemPrompt: request.systemPrompt,
    userContent: request.userContent,
    maxTokens: request.maxTokens,
    schemaMode: request.schemaMode,
    schemaId: request.schemaId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Payload assembly. All values here are DATA (redacted chat text, local math
// results, name lists) — never prompt wording.
// ─────────────────────────────────────────────────────────────────

function pickTopics(math) {
  const pick = list => (Array.isArray(list) ? list : [])
    .slice(0, 5)
    .map(entry => (Array.isArray(entry) ? entry[0] : entry))
    .filter(Boolean);
  return [...pick(math?.topBigrams), ...pick(math?.topWords)].slice(0, 8);
}

function pickLocalContext(math) {
  return {
    ghost: math?.ghost || "",
    ghostName: math?.ghostName || "",
    convStarter: math?.convStarter || "",
    funniestPerson: math?.funniestPerson || "",
    funniestLaughCount: math?.laughCausedBy?.[math?.funniestPerson] || 0,
  };
}

function basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }) {
  return {
    names: math?.names || [],
    totalMessages: math?.totalMessages || 0,
    isGroup: !!math?.isGroup,
    relationshipType: relationshipType || "",
    chatLang: chatLang || "en",
    relationshipContext: relationshipContext || null,
    coreAnalysisVersion,
  };
}

function toRequest(pipeline, payload, relationshipContext) {
  const rendered = renderPipelinePrompt(pipeline, payload);
  return {
    pipeline,
    payload,
    systemPrompt: rendered.system,
    userContent: rendered.userContent,
    maxTokens: rendered.maxTokens,
    schemaMode: rendered.schemaMode,
    schemaId: rendered.schemaId,
    promptVersion: rendered.promptVersion,
    relationshipContext,
    relationshipLine: rendered.relationshipLine,
  };
}

// ─────────────────────────────────────────────────────────────────
// CONNECTION DIGEST
// ─────────────────────────────────────────────────────────────────

export function prepareConnectionDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildSampleText,
  extraConnectionRules = "",
  candidatesText = "",
  coreAnalysisVersion,
}) {
  const payload = {
    ...basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }),
    windowsText: buildSampleText(messages),
    candidatesText,
    topics: pickTopics(math),
    localContext: pickLocalContext(math),
    // The only extra connection rule that exists is the energy-focus one; the
    // wording itself is server-owned, the client just flags the focus.
    energyFocus: !!extraConnectionRules,
  };
  return toRequest("connection", payload, relationshipContext);
}

// ─────────────────────────────────────────────────────────────────
// GROWTH DIGEST
// ─────────────────────────────────────────────────────────────────

function buildGrowthBridgeText(messages, formatForAI) {
  if (!Array.isArray(messages) || !messages.length || typeof formatForAI !== "function") return "";
  const total = messages.length;
  const windowSize = total > 12000 ? 24 : 32;
  const bridgeSpecs = [0.25, 0.5, 0.75];

  return bridgeSpecs.map((ratio, index) => {
    const center = Math.floor(total * ratio);
    const start = Math.max(0, center - windowSize);
    const end = Math.min(total, center + windowSize);
    const slice = messages.slice(start, end);
    if (!slice.length) return "";
    return `BRIDGE WINDOW ${index + 1} (${Math.round(ratio * 100)}% through the chat):\n${formatForAI(slice)}`;
  }).filter(Boolean).join("\n\n");
}

export function prepareGrowthDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  formatForAI,
  coreAnalysisVersion,
}) {
  const snapshotSize = Math.min(120, Math.max(48, Math.floor(messages.length * 0.16)));
  const payload = {
    ...basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }),
    earlyText: formatForAI(messages.slice(0, snapshotSize)),
    lateText: formatForAI(messages.slice(Math.max(0, messages.length - snapshotSize))),
    bridgeText: buildGrowthBridgeText(messages, formatForAI),
  };
  return toRequest("growth", payload, relationshipContext);
}

// ─────────────────────────────────────────────────────────────────
// CORE A (legacy full analysis — kept for the debug panel and fallbacks)
// ─────────────────────────────────────────────────────────────────

export function prepareCoreAnalysisARequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildSampleText,
  formatForAI,
  candidatesText = "",
  coreAnalysisVersion,
}) {
  const snapshotSize = Math.min(120, Math.max(40, Math.floor(messages.length * 0.18)));
  const payload = {
    ...basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }),
    windowsText: buildSampleText(messages),
    earlyText: formatForAI(messages.slice(0, snapshotSize)),
    lateText: formatForAI(messages.slice(Math.max(0, messages.length - snapshotSize))),
    candidatesText,
    topics: pickTopics(math),
    localContext: pickLocalContext(math),
  };
  return toRequest("coreA", payload, relationshipContext);
}

// ─────────────────────────────────────────────────────────────────
// CORE B (legacy risk analysis — kept for the debug panel and fallbacks)
// ─────────────────────────────────────────────────────────────────

export function prepareCoreAnalysisBRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildSampleText,
  coreAnalysisVersion,
}) {
  const payload = {
    ...basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }),
    windowsText: buildSampleText(messages),
  };
  return toRequest("coreB", payload, relationshipContext);
}

// ─────────────────────────────────────────────────────────────────
// RISK DIGEST
// ─────────────────────────────────────────────────────────────────

export function prepareRiskDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildSampleText,
  extraRiskRules = "",
  candidatesText = "",
  coreAnalysisVersion,
}) {
  const payload = {
    ...basePayload({ math, relationshipType, chatLang, relationshipContext, coreAnalysisVersion }),
    windowsText: buildSampleText(messages),
    candidatesText,
    // The only extra risk rule that exists is the accountability-focus one;
    // the wording itself is server-owned, the client just flags the focus.
    accountabilityFocus: !!extraRiskRules,
  };
  return toRequest("risk", payload, relationshipContext);
}

export function buildDebugAnalysisExport({
  fileName = null,
  rawProcessedPayload = null,
  messages = [],
  math = null,
  detectedLanguage = null,
  relationshipType = null,
  relationshipContext = null,
  relationshipLine = "",
  requests = {},
  tooShort = false,
  analysisVersions = {},
  summary = null,
}) {
  return {
    exportedAt: new Date().toISOString(),
    fileName,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    participants: math?.names || summary?.participants || [],
    isGroup: !!math?.isGroup,
    detectedLanguage: detectedLanguage || null,
    relationshipType: relationshipType || null,
    relationshipContext: relationshipContext || null,
    relationshipLine: relationshipLine || "",
    analysisVersions,
    input: {
      messages,
      math,
      tooShort: Boolean(tooShort),
      cappedGroup: Boolean(math?.cappedGroup),
      originalParticipantCount: math?.originalParticipantCount ?? null,
      rawProcessedPayload,
    },
    requests: Object.fromEntries(
      Object.entries(requests || {}).map(([key, value]) => [key, toDebugRequestRecord(value)])
    ),
  };
}
