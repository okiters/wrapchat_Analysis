// ─────────────────────────────────────────────────────────────────
// CONSISTENCY — deterministic guards that stop a report from arguing
// with itself. Pure JS (imports only textSanitize) so it is testable
// without the Vite-only imports in aiAnalysis.
//
// Two failure classes, both seen in real reports:
//  1. A free-text sentence contradicting a locally computed fact
//     ("both come alive late at night" printed under a 2pm peak).
//  2. One chat event narrated on several cards (the same airport
//     exchange as sweet moment, loving moment, and the miss).
// ─────────────────────────────────────────────────────────────────
import { sanitizeResultText } from "./textSanitize.js";

// ── Daypart agreement ──

const DAYPART_VOCAB = {
  morning: /(sabah|morning|mañana|manha|manhã|matin|mattina|morgen)/i,
  afternoon: /(öğle|ogle|afternoon|tarde|pomeriggio|nachmittag|après-midi|apres-midi)/i,
  evening: /(akşam|aksam|evening|soir|sera|abend|atardecer)/i,
  "late night": /(gece|night|late|madrugada|nuit|notte|nacht|sabaha)/i,
};

// Words that turn a time reference into a claim about when someone is most
// active. "picks up the thread in the morning" is sequencing and fine;
// "both come alive late at night" over a 2pm peak is a contradiction.
const PEAK_CLAIM_VOCAB = /(canlan|en aktif|aktifle|hareketlen|başlıyor|baslıyor|basliyor|uyanı|uyani|comes? alive|most active|peak|liveliest|hits? (her|his|their) stride|wake[sn]? up|lights? up|energ)/i;

// True only when the sentence claims peak activity in a daypart neither
// person actually peaks in. Peak hours come from the timestamps and are
// authoritative; a passing time reference is left alone.
export function contrastContradictsDayparts(contrast, dayparts) {
  const text = String(contrast || "");
  if (!text) return false;
  const actual = new Set((dayparts || []).filter(Boolean));
  if (!actual.size) return false;

  for (const [daypart, re] of Object.entries(DAYPART_VOCAB)) {
    if (actual.has(daypart)) continue;
    const match = re.exec(text);
    if (!match) continue;
    // Only a contradiction if an activity claim sits near the time word.
    const from = Math.max(0, match.index - 60);
    const to = Math.min(text.length, match.index + match[0].length + 60);
    if (PEAK_CLAIM_VOCAB.test(text.slice(from, to))) return true;
  }
  return false;
}

// ── Cross-field event dedupe ──

// Card order: the first field to tell a story keeps it.
const EVENT_CLAIM_ORDER = [
  // Moment cards first: they are the ones built around a single scene.
  "sweetMoment", "mostLovingMoment", "funniestReason", "tensionMoment",
  "mostEnergising", "mostDraining", "loveMiss.quote", "loveMiss.description",
  "loveMissUnspoken",
  // Then the summary/read cards, which may also reach for a quote.
  "loveLanguageMismatch", "loveLanguageIntro", "compatibilityRead",
  "energyDynamic", "energyCompatibility", "ghostContext", "dramaContext",
  "biggestTopic", "relationshipSummary", "groupDynamic", "vibeOneLiner",
  "insideJoke", "hypePersonReason",
  // Growth cards were never claimed, so the same line could anchor the arc,
  // the shift, and one person's story at once ("unser Auto" appeared in
  // whoChangedHow and personBArc on the same report).
  "growth.messageAtTurningPoint", "growth.turningPoint",
  "growth.personAArc", "growth.personBArc",
  "growth.whoChangedHow", "growth.arcSummary", "growth.trajectoryDetail",
];
// Cards the UI already skips when empty — safe to drop rather than repeat.
const OPTIONAL_EVENT_FIELDS = new Set(["loveMiss.quote", "loveMiss.description", "loveMissUnspoken"]);

const OVERLAP_STOPWORDS = new Set([
  "this", "that", "with", "from", "they", "them", "their", "when", "what",
  "sonra", "ç", "için", "icin", "ama", "gibi", "diye", "daha", "sonrasında",
]);

export function squashForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıi̇]/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Quoted spans, ignoring Turkish suffix apostrophes (Ozge'nin, Josh'tan).
export function extractQuotedSpans(text) {
  const value = String(text || "");
  return [
    ...[...value.matchAll(/["“”]([^"“”\n]{6,}?)["“”]/gu)].map(match => match[1]),
    ...[...value.matchAll(/(?<![\p{L}\p{N}])['‘]([^'‘’\n]{6,}?)['’](?![\p{L}\p{N}])/gu)].map(match => match[1]),
  ];
}

// Strip the quote marks around one specific quote, leaving the words.
export function dequoteSpecificQuote(text, quote) {
  const target = squashForMatch(quote);
  const fix = (match, inner) => (squashForMatch(inner) === target ? inner : match);
  return String(text || "")
    .replace(/["“”]([^"“”\n]{2,}?)["“”]/gu, fix)
    .replace(/(?<![\p{L}\p{N}])['‘]([^'‘’\n]{2,}?)['’](?![\p{L}\p{N}])/gu, fix);
}

function eventTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}']+/u)
      .filter(word => word.length > 3 && !OVERLAP_STOPWORDS.has(word))
  );
}

function eventOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// people.<i>.careStyle.examples | people.<i>.energy.hypeQuote
function personSlot(people, path) {
  const [, indexText, group, key] = path.split(".");
  const person = people?.[Number(indexText)];
  return person ? { person, group, key } : null;
}

function readPersonField(people, path) {
  const slot = personSlot(people, path);
  if (!slot) return "";
  return String(slot.person?.[slot.group]?.[slot.key] || "");
}

function writePersonField(people, path, value) {
  const slot = personSlot(people, path);
  if (!slot) return;
  slot.person[slot.group] = { ...(slot.person[slot.group] || {}), [slot.key]: value };
}

// Paths are dotted so nested groups (loveMiss.*, growth.*) can be claimed the
// same way as top-level fields.
function readEventField(shared, path) {
  const parts = path.split(".");
  let node = shared;
  for (const key of parts) {
    if (!node || typeof node !== "object") return "";
    node = node[key];
  }
  return typeof node === "string" ? node : "";
}

function writeEventField(shared, path, value) {
  const parts = path.split(".");
  const leaf = parts.pop();
  let node = shared;
  for (const key of parts) {
    // Copy on write so the caller's nested objects are not mutated in place.
    node[key] = { ...(node[key] || {}) };
    node = node[key];
  }
  node[leaf] = value;
}

// Claims each quote and each event once, in card order. A later field that
// repeats a claimed quote loses the quote marks; an OPTIONAL card left
// retelling an already-told story is emptied so the card is skipped.
export function dedupeSharedEvents(shared, people = null) {
  const out = { ...shared };
  const outPeople = Array.isArray(people) ? people.map(person => ({ ...person })) : null;
  const claimedQuotes = [];
  const claimedEvents = [];

  // Shared cards claim first, then the per-person care/energy fields: a
  // person's "how they show it" example must not re-tell the sweet moment.
  const personPaths = [];
  if (outPeople) {
    outPeople.forEach((_, index) => {
      personPaths.push(`people.${index}.careStyle.examples`);
      personPaths.push(`people.${index}.energy.hypeQuote`);
    });
  }

  const readPath = path => (path.startsWith("people.")
    ? readPersonField(outPeople, path)
    : readEventField(out, path));
  const writePath = (path, value) => (path.startsWith("people.")
    ? writePersonField(outPeople, path, value)
    : writeEventField(out, path, value));

  for (const path of [...EVENT_CLAIM_ORDER, ...personPaths]) {
    const text = readPath(path);
    if (!text) continue;

    let next = text;
    let duplicateQuote = false;
    for (const quote of claimedQuotes) {
      if (squashForMatch(next).includes(quote.squashed)) {
        duplicateQuote = true;
        next = dequoteSpecificQuote(next, quote.raw);
      }
    }

    const tokens = eventTokens(next);
    const retelling = claimedEvents.some(previous => eventOverlap(tokens, previous) > 0.6);

    if ((duplicateQuote || retelling) && OPTIONAL_EVENT_FIELDS.has(path)) {
      writePath(path, "");
      continue;
    }

    writePath(path, sanitizeResultText(next));
    for (const quote of extractQuotedSpans(next)) {
      claimedQuotes.push({ raw: quote, squashed: squashForMatch(quote) });
    }
    if (tokens.size) claimedEvents.push(tokens);
  }
  return outPeople ? { shared: out, people: outPeople } : out;
}
