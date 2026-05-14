// Quick Read — lightweight onboarding gift tracked separately from purchased credits.
// Pure functions only; callClaude lives in App.jsx.

export function buildTrialPrompt(messages, math, relType, buildSampleText) {
  // Cap to 80 messages (evenly spread) to keep token cost minimal — max ~$0.01 per call.
  const capped = messages.length <= 80
    ? messages
    : Array.from({ length: 80 }, (_, i) => messages[Math.floor(i * messages.length / 80)]);
  const sample = buildSampleText(capped);
  const names = (math?.names || []).filter(Boolean).join(" and ") || "the participants";
  const rel = relType || "friends";

  const system = `You are reading a WhatsApp chat between ${names} (relationship: ${rel}). Write like a perceptive friend who just read the whole thing — specific, direct, a little playful. Avoid "this shows that", "it seems like", "they communicate well". Use actual names. Each field must be distinct: vibe is the overall feeling, pattern is a real communication habit you noticed, takeaway is the most surprising or interesting thing.

Return ONLY valid JSON with exactly these three keys:
{
  "vibe":      "one sentence — the specific emotional tone of this chat, not a mood label",
  "pattern":   "one sentence — a real repeated communication habit: who does what and how",
  "takeaway":  "one sentence — the single most interesting or unexpected thing about this chat"
}
No markdown, no extra keys. Never start a sentence with 'This', 'It seems', or 'Overall'.`;

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
