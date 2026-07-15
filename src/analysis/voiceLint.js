// ─────────────────────────────────────────────────────────────────
// VOICE LINT — deterministic checks that report text matches the
// WrapChat voice contract. Used by the golden harness (and safe to run
// anywhere: pure JS, imports only the voice module).
// ─────────────────────────────────────────────────────────────────
import { BANNED_PHRASES } from "./voice.js";
import { EMOJI_RE } from "./textSanitize.js";

const LONG_DASH_RE = /[—–]/;
// Analysis mechanics must never surface in user-facing text.
const MECHANICS_RE = /(━|\[(?:number|email|account|redacted)\]|(?:early|recent) snapshot|bridge window|candidate (?:moment|#\d)|window \d+\/\d+|\bwindow \d\b|evidence window)/i;
const MECHANICS_UPPER_RE = /\bWINDOW\b/;
// Double quotes and guillemets always delimit quotes. Single quotes only
// count when they are not intra-word suffix apostrophes (Ozge'nin, Josh'tan),
// which Turkish uses constantly.
const DOUBLE_QUOTE_RE = /["“”]([^"“”\n]{10,}?)["“”]/gu;
const SINGLE_QUOTE_RE = /(?<![\p{L}\p{N}])['‘]([^'‘’\n]{10,}?)['’](?![\p{L}\p{N}])/gu;

function extractQuotes(text) {
  const value = String(text || "");
  return [
    ...[...value.matchAll(DOUBLE_QUOTE_RE)].map(match => match[1]),
    ...[...value.matchAll(SINGLE_QUOTE_RE)].map(match => match[1]),
  ];
}
const MAX_FIELD_CHARS = 260;
// Fields that must feel like a concrete scene: they need a name or a quote.
const MOMENT_FIELD_RE = /moment|funniest|drama|tension|energis|draining|insidejoke|sweet|loving|turningpoint|hype/i;
// Narrator-voice romance vocabulary that reads as misclassification on a
// platonic report. Quoted occurrences are stripped before matching.
const ROMANTIC_NARRATION_RE = /\b(a\u015Fk|ask olduğunu|sevgili|\u00E7ift gibi|cift gibi|romantik|romantic|romance|a couple|in love|flirting|flört)\b/iu;
const PLATONIC_TYPES = new Set(["friend", "family", "colleague", "other"]);
// Control-token fields and labels where prose checks don't apply.
const EXEMPT_FIELD_RE = /^(schemaVersion|part|relationshipType|.*\b(score|count|total|kept|broken|netScore)\b.*|.*(person|holder|starter|missed|language|emoji|daypart|peakhour|trajectory|depthchange|type))$/i;

function contentTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(word => word.length > 3);
}

function tokenJaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

export function lintText(text, path = "") {
  const issues = [];
  const value = String(text || "");
  if (!value) return issues;

  if (LONG_DASH_RE.test(value)) {
    issues.push({ path, level: "error", rule: "long-dash", detail: "contains an em/en dash" });
  }
  if (MECHANICS_RE.test(value) || MECHANICS_UPPER_RE.test(value)) {
    issues.push({ path, level: "error", rule: "mechanics-leak", detail: "mentions analysis mechanics (window/snapshot/placeholder)" });
  }
  if (EMOJI_RE.test(value)) {
    EMOJI_RE.lastIndex = 0;
    issues.push({ path, level: "error", rule: "emoji", detail: "contains an emoji" });
  }
  EMOJI_RE.lastIndex = 0;
  const lower = value.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({ path, level: "error", rule: "banned-phrase", detail: `contains "${phrase}"` });
    }
  }
  if (value.length > MAX_FIELD_CHARS) {
    issues.push({ path, level: "warning", rule: "too-long", detail: `${value.length} chars (max ${MAX_FIELD_CHARS})` });
  }
  return issues;
}

// Walks a result object and returns { path: stringValue } for every string leaf.
export function flattenResultStrings(value, prefix = "", out = {}) {
  if (typeof value === "string") {
    if (value.trim()) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenResultStrings(item, prefix ? `${prefix}.${index}` : String(index), out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenResultStrings(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

export function lintResult(result) {
  const fields = flattenResultStrings(result);
  const issues = [];
  const prose = Object.entries(fields).filter(([path]) => {
    // coreAnalysis is the embedded source digest kept for reuse — users never
    // see it, and every derived field would "repeat" its own origin.
    if (path === "coreAnalysis" || path.startsWith("coreAnalysis.")) return false;
    return !EXEMPT_FIELD_RE.test(path.split(".").pop() || path);
  });

  for (const [path, text] of prose) {
    issues.push(...lintText(text, path));

    // Genericity: a "moment" field with neither a name-like capital nor a quote
    // could describe any random chat. Judged by the leaf field name only, and
    // never for fields whose VALUE is itself a quote or a period label.
    const leaf = path.split(".").pop() || path;
    if (MOMENT_FIELD_RE.test(leaf) && !/^(date|quote|hypeQuote|turningPoint|period)$/i.test(leaf)) {
      const hasQuote = /["'‘’“”]/.test(text);
      const hasNameLike = /(^|[\s(])\p{Lu}\p{Ll}+/u.test(text.slice(1));
      if (!hasQuote && !hasNameLike) {
        issues.push({ path, level: "warning", rule: "generic", detail: "moment field has no name and no quote" });
      }
    }
  }

  // Platonic reports: romance words are fine inside quotes (their own jokes),
  // but the narrator's own voice must stay platonic.
  if (PLATONIC_TYPES.has(String(result?.relationshipType || "").toLowerCase())) {
    for (const [path, text] of prose) {
      const leaf = path.split(".").pop() || path;
      // Fields whose value IS a verbatim chat quote are the participants'
      // own words, not narrator voice.
      if (/^(quote|hypeQuote)$/i.test(leaf)) continue;
      const withoutQuotes = text.replace(/["'\u2018\u2019\u201C\u201D][^"'\u2018\u2019\u201C\u201D]*["'\u2018\u2019\u201C\u201D]/g, " ");
      if (ROMANTIC_NARRATION_RE.test(withoutQuotes)) {
        issues.push({ path, level: "warning", rule: "romantic-narration", detail: "narrator uses romance vocabulary on a platonic report (outside quotes)" });
      }
    }
  }

  // Repetition: the same quoted text in two fields, or two near-identical fields.
  const quotesByField = prose.map(([path, text]) => ({
    path,
    quotes: extractQuotes(text).map(quote => quote.trim().toLowerCase()),
    tokens: contentTokens(text),
  }));
  for (let i = 0; i < quotesByField.length; i += 1) {
    for (let j = i + 1; j < quotesByField.length; j += 1) {
      const a = quotesByField[i];
      const b = quotesByField[j];
      const sharedQuote = a.quotes.find(quote => b.quotes.includes(quote));
      if (sharedQuote) {
        issues.push({
          path: `${a.path} + ${b.path}`,
          level: "error",
          rule: "repeated-quote",
          detail: `both quote "${sharedQuote.slice(0, 40)}"`,
        });
      } else if (a.tokens.length >= 6 && b.tokens.length >= 6 && tokenJaccard(a.tokens, b.tokens) > 0.6) {
        issues.push({
          path: `${a.path} + ${b.path}`,
          level: "warning",
          rule: "similar-fields",
          detail: "fields describe the same thing in near-identical words",
        });
      }
    }
  }

  return issues;
}

// Normalise text for substring matching across diacritics, case, emoji, and
// punctuation, so quotes survive the sanitiser's edits.
function squash(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıi̇]/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Checks that every quoted span in the result actually appears in the source
// chat. Catches invented or reworded "quotes" — the worst grounding failure.
export function lintQuoteGrounding(result, corpusText) {
  const corpus = squash(corpusText);
  if (!corpus) return [];
  const issues = [];
  const fields = flattenResultStrings(result);
  for (const [path, text] of Object.entries(fields)) {
    if (path === "coreAnalysis" || path.startsWith("coreAnalysis.")) continue;
    for (const rawQuote of extractQuotes(text)) {
      const quote = squash(rawQuote);
      if (quote.length >= 12 && !corpus.includes(quote)) {
        issues.push({ path, level: "error", rule: "ungrounded-quote", detail: `quote not found in chat: "${rawQuote.slice(0, 50)}"` });
      }
    }
  }
  return issues;
}

// Deterministic quote grounding for the app itself (not just the linter):
// any quoted span that is not a verbatim substring of the chat loses its
// quote marks and stays as paraphrase. The model cannot be trusted to keep
// quotes verbatim; local code can.
function dequoteUngrounded(text, corpus) {
  const value = String(text || "");
  const fix = (match, inner) => {
    const squashed = squash(inner);
    if (squashed.length < 12 || corpus.includes(squashed)) return match;
    return inner;
  };
  return value.replace(DOUBLE_QUOTE_RE, fix).replace(SINGLE_QUOTE_RE, fix);
}

export function groundResultQuotes(result, corpusText) {
  const corpus = squash(corpusText);
  if (!corpus) return result;
  const walk = (value, path) => {
    if (typeof value === "string") return dequoteUngrounded(value, corpus);
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}.${index}`));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        // The embedded core object is raw analysis state, not rendered text.
        out[key] = path === "" && key === "coreAnalysis" ? item : walk(item, path ? `${path}.${key}` : key);
      }
      return out;
    }
    return value;
  };
  return walk(result, "");
}

export function formatLintReport(issues, label = "result") {
  if (!issues.length) return `voice-lint: ${label} clean`;
  const lines = issues.map(issue => `  [${issue.level}] ${issue.rule} @ ${issue.path}: ${issue.detail}`);
  const errors = issues.filter(issue => issue.level === "error").length;
  return `voice-lint: ${label} — ${errors} error(s), ${issues.length - errors} warning(s)\n${lines.join("\n")}`;
}
