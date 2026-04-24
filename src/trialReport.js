// Trial report — lightweight 1-credit preview that runs in payments mode.
// Pure functions only; callClaude lives in App.jsx.

export function buildTrialPrompt(messages, math, relType, buildSampleText) {
  // Cap to 80 messages (evenly spread) to keep token cost minimal — max ~$0.01 per call.
  const capped = messages.length <= 80
    ? messages
    : Array.from({ length: 80 }, (_, i) => messages[Math.floor(i * messages.length / 80)]);
  const sample = buildSampleText(capped);
  const names = (math?.names || []).filter(Boolean).join(" and ") || "the participants";
  const rel = relType || "friends";

  const system = `You are a relationship chat analyst. Analyse this WhatsApp conversation between ${names} (relationship: ${rel}) and return ONLY valid JSON with exactly these three keys:
{
  "vibe":      "one sentence describing the overall emotional vibe of this chat",
  "pattern":   "one sentence about the most notable communication pattern you see",
  "takeaway":  "one sentence — the single most interesting insight about this relationship"
}
Be specific. Use the actual names. No markdown, no extra keys.`;

  const userContent = `Chat export:\n${sample}`;
  return { system, userContent, maxTokens: 360 };
}

export function deriveTrialReport(raw, math, relType) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    vibe:     String(data.vibe     || ""),
    pattern:  String(data.pattern  || ""),
    takeaway: String(data.takeaway || ""),
    relationshipType: relType ?? null,
  };
}
