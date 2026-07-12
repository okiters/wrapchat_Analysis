// ─────────────────────────────────────────────────────────────────
// TEXT SANITIZE — hard product rules applied to every AI-written result
// field at normalisation time, so the guarantees never depend on the
// model obeying the prompt. Pure JS, no imports (node-testable).
//
// Rules: no em/en dashes, no emojis, in any language. Local-math data
// (e.g. the Spirit Emojis card) is intentionally NOT routed through this.
// ─────────────────────────────────────────────────────────────────

// Pictographs plus the plumbing that renders them: variation selectors,
// ZWJ sequences, keycap combiner, skin tones, regional-indicator flags, tags.
export const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}]/gu;

export function stripLongDashes(text) {
  return String(text ?? "")
    .replace(/\s*[—–]+\s*/g, ", ")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*,/g, "$1 ");
}

export function stripEmojis(text) {
  return String(text ?? "")
    .replace(EMOJI_RE, "")
    .replace(/ {2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1");
}

export function sanitizeResultText(text) {
  return stripEmojis(stripLongDashes(text)).trim();
}
