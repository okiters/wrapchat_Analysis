// ─────────────────────────────────────────────────────────────────
// VOICE — moved to supabase/functions/_shared/prompts.js so the edge
// function, the app, and the golden harness share one source of truth.
// This shim keeps existing import paths (voiceLint, tests) working.
// ─────────────────────────────────────────────────────────────────
export { BANNED_PHRASES, buildVoiceSection, CALIBRATION_EXAMPLES, LANGUAGE_REGISTER_EXAMPLES } from "../../supabase/functions/_shared/prompts.js";
