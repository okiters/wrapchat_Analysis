// ─────────────────────────────────────────────────────────────────
// VOICE — moved to supabase/functions/_shared/prompts.js so the edge
// function, the app, and the golden harness share one source of truth.
// This shim keeps existing import paths (voiceLint, tests) working.
// ─────────────────────────────────────────────────────────────────
export { BANNED_PHRASES, buildVoiceSection } from "../../supabase/functions/_shared/prompts.js";
