// Quick Read — lightweight onboarding gift tracked separately from purchased credits.
// Prompt construction moved to supabase/functions/_shared/prompts.js (trial pipeline);
// only the derive step lives here.

export function deriveTrialReport(raw, math, relType) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    vibe:     String(data.vibe     || ""),
    pattern:  String(data.pattern  || ""),
    takeaway: String(data.takeaway || ""),
    relationshipType: relType ?? null,
  };
}
