// ─────────────────────────────────────────────────────────────────
// AI ANALYSIS — prompt builders, Claude calls, result normalisation.
// Pure JS, no React.
// ─────────────────────────────────────────────────────────────────
import _updateNotesRaw from "../../docs/update-notes.md?raw";
import {
  prepareCoreAnalysisARequest,
  prepareConnectionDigestRequest,
  prepareGrowthDigestRequest,
  prepareCoreAnalysisBRequest,
  prepareRiskDigestRequest,
} from "../../analysis-test/aiDebugHelpers.js";
import { deriveTrialReport } from "../trialReport";
import { normalizeUiLangCode, LANG_META } from "../i18n/translations";
import { callAnalysis } from "./claudeClient";
import { redactSensitiveText } from "./redactSensitive";
import { groundResultQuotes } from "./voiceLint";
import {
  buildAnalystSystemPrompt as sharedBuildAnalystSystemPrompt,
  CORE_A_WRITING_STYLE as SHARED_CORE_A_WRITING_STYLE,
} from "../../supabase/functions/_shared/prompts.js";
import {
  resolveRelationshipContext, normalizeRedFlags, normalizeTimeline,
  normalizeMemorableMoments, LOCAL_STATS_VERSION,
  CONTROL_RE, AGGRO_RE, BREAKUP_RE, APOLOGY_RE, ROMANCE_RE, DATE_RE, FLIRTY_EMOJI_RE,
  SUPPORT_RE, GRATITUDE_RE, DISTRESS_RE, HEART_REPLY_RE,
  coerceRelationshipCategory, coerceRelationshipSpecificLabel, sanitizeRelationshipStatus,
  STOP_WORDS, TOKEN_STOP_WORDS, foldToken, cleanQuote, sanitizeResultText,
} from "./localMath";

// ─────────────────────────────────────────────────────────────────
// EVENT-BASED SAMPLING PIPELINE
// ─────────────────────────────────────────────────────────────────

export const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Format a single message line — timestamp always includes speaker name
export function formatMessageLine(m) {
  const d  = m.date;
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  // Contact info and credentials are stripped from every AI-bound line here,
  // before the text leaves the device.
  return `[${ts}] ${m.name}: ${redactSensitiveText(m.body)}`;
}

// Flat formatter kept for growth analysis early/late contiguous slices
export function formatForAI(messages) {
  return messages.map(formatMessageLine).join("\n");
}

// ── Laugh grading ──
// isLaughReaction() only answers "does this contain laughter anywhere?",
// which produced two failure modes in funny extraction: a message that is
// itself laughter scored as the laugh TRIGGER (in a cascade every line
// "causes" the next laugh, so we picked laughing messages instead of the
// joke), and "content lol" trailers counted as full reactions. Grading the
// laughter fixes both: triggers must not be laughing themselves, and
// reactions must be dedicated laughs, ranked by how hard they are.
const LAUGH_WORD_RE = /^(a?ha(?:ha)+h*|ha+h|lo+l+z?|lmf?ao+|hehe+h*|heh|xd+|dying|dead|ded|deceased|jaja(?:ja)+|kk{2,}|wkwk\w*|mdr+|ptdr+)$/i;

// A keyboard-mash laugh token: either a pure consonant run ("sksk",
// "skdjfhdf"), or a long token that is almost vowel-free AND contains a 5+
// consonant cluster ("ahshshsgsg", "Agahhssggsgd"). Both conditions together
// keep ordinary consonant-heavy words ("combing", "thank", "strength") out.
function isMashToken(word) {
  if (!/^[a-zçğıöşü]+$/i.test(word)) return false;
  // Interjections ("pfffff", "hmmm", "shhh") are one letter repeated, not a
  // mash: random-key laughs spread across the keyboard.
  const counts = {};
  for (const ch of word.toLowerCase()) counts[ch] = (counts[ch] || 0) + 1;
  if (Math.max(...Object.values(counts)) / word.length >= 0.7) return false;
  if (/^[bcdfghjklmnpqrsştvwxyzçğ]{4,}$/i.test(word)) return true;
  if (word.length < 8) return false;
  const vowels = (word.match(/[aeiouöüıi]/gi) || []).length;
  return vowels / word.length <= 0.2 && /[^aeiouöüıi]{5,}/i.test(word);
}

// 0 = no laughter · 1 = weak trailer (content with a laugh token tacked on)
// 2 = clear laugh · 3 = hard laugh (keyboard mash, 💀/🤣, multi-😂, caps howl)
export function laughStrength(body) {
  const text = String(body || "").trim();
  if (!text) return 0;
  const tokens = text.split(/\s+/);
  let laughCount = 0;
  let contentCount = 0;
  let hard = /[💀🤣]/u.test(text) || /😂[^😂]*😂/u.test(text);
  for (const token of tokens) {
    const word = token.replace(/[^\p{L}\p{N}'’]/gu, "");
    const mash = isMashToken(word);
    if (mash) hard = true;
    if (mash || LAUGH_WORD_RE.test(word) || /[😂💀🤣]/u.test(token)) laughCount += 1;
    else if (word) contentCount += 1;
  }
  // A shouted all-caps laugh ("AHAHAHA", "LMAOOO") is hard laughter too.
  if (!/[a-zçğıöşü]/.test(text) && /HA(HA)+|LMF?AO|LO+L/.test(text)) hard = true;
  if (!laughCount && !hard) return 0;
  const dedicated = contentCount <= Math.max(1, tokens.length * 0.25);
  if (hard) return dedicated ? 3 : 2;
  return dedicated ? 2 : 1;
}

// Assign an event score and tag set to every message position.
// Higher score = more valuable to anchor a context window on.
function scoreMessages(messages) {
  return messages.map((msg, i) => {
    let score = 0;
    const tags = [];
    // Skip pure media placeholders for signal detection
    const body = /^<(Voice|Media) omitted>$/.test(msg.body) ? "" : msg.body;
    const prev = i > 0 ? messages[i - 1] : null;
    const next = i < messages.length - 1 ? messages[i + 1] : null;

    // Reply-gap signal — long silences often bracket important exchanges
    if (i > 0) {
      const gapMin = (msg.date - messages[i - 1].date) / 60000;
      if (gapMin > 240)     { score += 4; tags.push("long-gap"); }
      else if (gapMin > 60) { score += 2; tags.push("gap"); }
    }

    // Conflict signals
    if (body && (CONTROL_RE.test(body) || AGGRO_RE.test(body) || BREAKUP_RE.test(body))) {
      score += 6; tags.push("conflict");
    }

    // Apology clusters
    if (body && APOLOGY_RE.test(body)) {
      score += 4; tags.push("apology");
    }

    // Romantic / affection spikes
    if (body && (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body))) {
      score += 4; tags.push("affection");
    }

    // Care / support signals
    if (body && SUPPORT_RE.test(body)) {
      score += 5; tags.push("support");
    }

    // Distress / venting — life problems and third-party drama live here.
    // These windows carry the recurring storylines (a partner, a boss, an ex)
    // that summary fields kept missing.
    if (body && DISTRESS_RE.test(body)) {
      score += 4; tags.push("distress");
    }
    if (body && prev && prev.name !== msg.name && DISTRESS_RE.test(prev.body) && (SUPPORT_RE.test(body) || body.length > 90)) {
      score += 7; tags.push("care-response");
    }
    if (
      body && prev && prev.name !== msg.name &&
      (GRATITUDE_RE.test(body) || HEART_REPLY_RE.test(body)) &&
      (SUPPORT_RE.test(prev.body) || DISTRESS_RE.test(prev.body))
    ) {
      score += 3; tags.push("care-followup");
    }

    // Long message — likely something substantive
    if (body.length > 200) { score += 2; tags.push("long-msg"); }

    // Laugh-trigger: this message caused a laugh reaction from a DIFFERENT
    // speaker in the next 1–3 messages. A message that is itself laughing
    // (strength ≥ 2) can never be the trigger — that's how cascades resolve
    // to the joke at their root instead of to the loudest laugher. Reactions
    // must be dedicated laughs (strength ≥ 2): "nice one lol" is filler, not
    // a receipt. Multiple distinct laughers (groups) boost the score.
    if (body && laughStrength(body) < 2) {
      let reactionStrength = 0;
      const laughers = new Set();
      for (let j = i + 1; j <= Math.min(i + 4, messages.length - 1); j++) {
        const reply = messages[j];
        if (reply.name === msg.name) continue;
        const strength = laughStrength(reply.body);
        if (strength >= 2) {
          reactionStrength = Math.max(reactionStrength, strength);
          laughers.add(reply.name);
        }
      }
      if (reactionStrength >= 2) {
        score += (reactionStrength >= 3 ? 9 : 6) + Math.max(0, laughers.size - 1) * 2;
        tags.push(reactionStrength >= 3 ? "laugh-trigger-hard" : "laugh-trigger");
      }
    }

    // Energising back-and-forth bursts are often useful for "fun" and chemistry reads.
    if (
      body && next && next.name !== msg.name &&
      body.length > 8 && body.length < 140 &&
      (next.date - msg.date) / 60000 < 8 &&
      /!|\?|😂|🤣|💀|❤️|❤|💕|🥰/.test(body + next.body)
    ) {
      score += 2; tags.push("energy-burst");
    }

    return { score, tags };
  });
}

// Merge overlapping or adjacent [start, end, tags[]] intervals
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [[...sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], sorted[i][1]);
      last[2] = [...new Set([...(last[2] || []), ...(sorted[i][2] || [])])];
    } else {
      out.push([...sorted[i]]);
    }
  }
  return out;
}

// Human-readable label for a chunk header, derived from its tag set
function chunkLabel(tags = []) {
  if (tags.includes("accountability-kept")) return "kept commitment";
  if (tags.includes("accountability-broken")) return "missed commitment";
  if (tags.includes("accountability-promise")) return "commitment";
  if (tags.includes("energy-high"))   return "positive energy";
  if (tags.includes("energy-low"))    return "draining energy";
  if (tags.includes("conflict"))      return "conflict";
  if (tags.includes("apology"))       return "apology";
  if (tags.includes("laugh-trigger-hard") || tags.includes("laugh-trigger")) return "funny moment";
  if (tags.includes("care-response") || tags.includes("support")) return "care moment";
  if (tags.includes("affection"))     return "affection";
  if (tags.includes("long-gap"))      return "after silence";
  if (tags.includes("long-msg"))      return "long message";
  return "excerpt";
}

// Build the ordered list of [startIdx, endIdx, tags[]] MOMENT windows.
// Event windows anchor on high-scoring messages with enough surrounding
// context that speaker direction and laugh reactions are unambiguous.
// Baseline timeline coverage is no longer filled here: the TIMELINE SPINE
// (buildSpineRuns) carries the chat's ordinary flow, so these windows can
// stay a smaller, denser set of genuine events.
function buildChunks(messages) {
  if (!messages.length) return [];

  const CONTEXT_BEFORE      = 4;   // lines before each event center
  const CONTEXT_AFTER       = 5;   // lines after event center (default)
  const CONTEXT_AFTER_LAUGH = 8;   // extended tail for laugh-trigger windows
                                   //   — captures the reaction(s) that follow the funny line
  const CONTEXT_AFTER_CARE  = 7;   // keep the support response and the gratitude / reaction after it
  const EVENT_SCORE_MIN     = 4;   // minimum score to qualify as an event center
  const MAX_EVENT_WINDOWS   = 40;  // hard cap on event-based windows
  const MSG_LINE_LIMIT      = 1000; // hard cap on total message lines (headers not counted)

  const n      = messages.length;
  const scores = scoreMessages(messages);

  // ── Pass 1: event windows ──
  // Sort all candidates by descending score, then limit density so we never
  // take more than one event center within any 8-message neighbourhood.
  const candidates = scores
    .map((s, i) => ({ i, score: s.score, tags: s.tags }))
    .filter(x => x.score >= EVENT_SCORE_MIN)
    .sort((a, b) => b.score - a.score);

  const takenCenters  = new Set();
  const eventWindows  = [];
  const addEventWindow = (c) => {
    if (takenCenters.has(c.i)) return false;
    for (let k = Math.max(0, c.i - 4); k <= Math.min(n - 1, c.i + 4); k++) takenCenters.add(k);
    const after = (c.tags.includes("laugh-trigger-hard") || c.tags.includes("laugh-trigger"))
      ? CONTEXT_AFTER_LAUGH
      : (c.tags.includes("care-response") || c.tags.includes("support") || c.tags.includes("care-followup"))
        ? CONTEXT_AFTER_CARE
        : CONTEXT_AFTER;
    eventWindows.push([
      Math.max(0, c.i - CONTEXT_BEFORE),
      Math.min(n - 1, c.i + after),
      c.tags,
    ]);
    return true;
  };

  let preservedFunny = 0;
  let preservedCare = 0;
  for (const c of candidates) {
    if ((c.tags.includes("laugh-trigger-hard") || c.tags.includes("laugh-trigger")) && preservedFunny < 8) {
      if (addEventWindow(c)) preservedFunny += 1;
    }
  }
  for (const c of candidates) {
    if ((c.tags.includes("care-response") || c.tags.includes("support")) && preservedCare < 8) {
      if (addEventWindow(c)) preservedCare += 1;
    }
  }
  for (const c of candidates) {
    if (takenCenters.has(c.i)) continue;
    addEventWindow(c);
    if (eventWindows.length >= MAX_EVENT_WINDOWS) break;
  }

  // ── Merge, sort, enforce line budget ──
  const all = mergeIntervals(eventWindows)
    .sort((a, b) => a[0] - b[0]);

  let msgLines = 0;
  const result = [];
  for (const chunk of all) {
    const sz = chunk[1] - chunk[0] + 1;
    if (msgLines + sz > MSG_LINE_LIMIT) break;
    result.push(chunk);
    msgLines += sz;
  }
  return result;
}

// Render chunks as windowed text with ━━━ separators.
// Each header tells Claude: isolated excerpt, date, type of signal.
// Speaker name is always present on every message line — attribution is unambiguous.
function formatChunksForAI(messages, chunks) {
  const total = chunks.length;
  const parts = [];
  chunks.forEach(([start, end, tags], idx) => {
    const d       = messages[start].date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]}`;
    parts.push(`\n━━━ WINDOW ${idx + 1}/${total} · ${dateStr} · ${chunkLabel(tags)} ━━━`);
    for (let i = start; i <= end; i++) parts.push(formatMessageLine(messages[i]));
  });
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// TIMELINE SPINE — evenly spaced contiguous runs across the full history.
//
// The earliest versions sampled every Nth message across the whole chat and
// sent it as one continuous stream; global reads (vibe, topics, dynamic)
// were noticeably better because the sample preserved the chat's true
// proportions instead of a curated highlight reel. Its flaw was that single
// strided messages destroyed exchanges (jokes without their laughs). The
// spine keeps the even coverage but samples short CONTIGUOUS runs, so every
// excerpt is a readable exchange. Moment windows still carry the events.
// ─────────────────────────────────────────────────────────────────

// Chats up to this size go to Claude in full — the early versions used 2000
// and it was the single biggest reason small-chat reports felt so grounded.
const FULL_CHAT_LIMIT = 2000;

function buildSpineRuns(messages, { runs = 70, runLen = 12 } = {}) {
  const n = messages.length;
  if (n <= runs * runLen) return [[0, n - 1]];
  const step = n / runs;
  const out = [];
  for (let r = 0; r < runs; r += 1) {
    const start = Math.max(0, Math.min(n - runLen, Math.round(r * step)));
    const end = Math.min(n - 1, start + runLen - 1);
    if (out.length && start <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

function formatSpine(messages, runs) {
  const parts = ["TIMELINE SPINE (evenly spaced excerpts across the FULL history, in chronological order — the chat's ordinary flow):"];
  runs.forEach(([start, end]) => {
    const d = messages[start].date;
    parts.push(`\n⋯ ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${DAY_ABBR[d.getDay()]} ⋯`);
    for (let i = start; i <= end; i += 1) parts.push(formatMessageLine(messages[i]));
  });
  return parts.join("\n");
}

// Two-layer corpus: the spine carries the chat's real proportions for
// summary-level fields; the moment windows carry the events for moment
// fields. The prompt rules route which fields ground where.
function composeSampleText(messages, eventChunks) {
  const spine = formatSpine(messages, buildSpineRuns(messages));
  const moments = eventChunks.length
    ? `\n\nMOMENT WINDOWS (isolated excerpts selected around single events):\n${formatChunksForAI(messages, eventChunks)}`
    : "";
  return `${spine}${moments}`;
}

// Main entry point. Short chats (≤${FULL_CHAT_LIMIT} messages) are delivered
// in full as a single window; larger chats get spine + moment windows.
export function buildSampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= FULL_CHAT_LIMIT) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return composeSampleText(messages, buildChunks(messages));
}

const ENERGY_KEYWORDS = Object.freeze({
  highEnergy: Object.freeze({
    en: ["love", "happy", "excited", "proud", "thank you", "thanks", "miss you", "perfect", "amazing", "fun", "funny", "laugh", "hahaha", "lol", "lmao", "yay", "can't wait", "so sweet", "cute", "best", "great", "good news"],
    tr: ["seviyorum", "mutlu", "heyecan", "gurur", "teşekkür", "tesekkur", "özledim", "ozledim", "mükemmel", "mukemmel", "harika", "komik", "güldüm", "guldum", "hahaha", "ahahah", "çok tatlı", "cok tatli", "en iyi", "iyi haber"],
    es: ["amo", "feliz", "emocion", "orgullo", "gracias", "te extraño", "perfecto", "increible", "divertido", "risa", "jajaja", "lol", "que lindo", "me encanta", "genial", "buenas noticias"],
    pt: ["amo", "feliz", "animado", "orgulho", "obrigado", "obrigada", "saudade", "perfeito", "incrivel", "divertido", "risada", "kkkk", "haha", "que fofo", "adorei", "otimo", "boa noticia"],
    ar: ["احب", "أحب", "سعيد", "مبسوط", "متحمس", "فخور", "شكرا", "شكرًا", "اشتقت", "ممتاز", "رائع", "حلو", "ضحك", "هههه", "جميل", "خبر حلو"],
    fr: ["aime", "heureux", "heureuse", "content", "contente", "excite", "fier", "fiere", "merci", "tu me manques", "parfait", "incroyable", "drole", "haha", "mdr", "trop mignon", "genial", "bonne nouvelle"],
    de: ["liebe", "glucklich", "glücklich", "freue", "stolz", "danke", "vermiss", "perfekt", "unglaublich", "lustig", "haha", "lol", "suss", "süß", "super", "toll", "gute nachricht"],
    it: ["amo", "felice", "contento", "contenta", "emozionato", "orgoglioso", "grazie", "mi manchi", "perfetto", "incredibile", "divertente", "rido", "ahaha", "lol", "che carino", "adoro", "bella notizia"],
  }),
  lowEnergy: Object.freeze({
    en: ["tired", "exhausted", "drained", "sad", "angry", "annoyed", "upset", "stress", "stressed", "anxious", "sorry", "fight", "argue", "hurt", "cry", "crying", "ignored", "lonely", "overwhelmed", "can't do this"],
    tr: ["yorgun", "bitkin", "tükendim", "tukendim", "üzgün", "uzgun", "kızgın", "kizgin", "sinir", "stres", "kaygı", "kaygi", "üzgünüm", "uzgunum", "kavga", "tartış", "tartis", "kırıldım", "kirildim", "ağlı", "agli", "yalnız", "yalniz", "bunaldım"],
    es: ["cansado", "cansada", "agotado", "triste", "enojado", "molesto", "estres", "ansioso", "ansiosa", "perdon", "pelea", "discutir", "dolido", "lloro", "llorando", "ignorado", "solo", "sola", "abrumado"],
    pt: ["cansado", "cansada", "exausto", "triste", "irritado", "chateado", "estresse", "ansioso", "ansiosa", "desculpa", "briga", "discutir", "machucado", "chorar", "chorando", "ignorado", "sozinho", "sobrecarregado"],
    ar: ["تعبان", "مرهق", "حزين", "زعلان", "غاضب", "متضايق", "توتر", "قلق", "اسف", "آسف", "مشكلة", "خناق", "وجع", "بكاء", "ابكي", "تجاهل", "وحيد", "ضغط"],
    fr: ["fatigue", "fatigué", "fatiguee", "epuise", "triste", "enerve", "stress", "angoisse", "desole", "desolee", "dispute", "mal", "pleure", "ignore", "seul", "seule", "deborde"],
    de: ["mude", "müde", "erschopft", "erschöpft", "traurig", "wutend", "wütend", "genervt", "stress", "gestresst", "angst", "sorry", "streit", "verletzt", "weine", "ignoriert", "allein", "uberfordert", "überfordert"],
    it: ["stanco", "stanca", "esausto", "triste", "arrabbiato", "arrabbiata", "stress", "ansioso", "ansiosa", "scusa", "litigio", "discutere", "ferito", "piango", "ignorato", "solo", "sola", "sopraffatto"],
  }),
});

const ENERGY_POSITIVE_EXCLUDE_KEYWORDS = Object.freeze({
  en: ["sex", "sexual", "horny", "nude", "naked", "creepy", "awkward", "weird", "sarcasm", "sarcastic", "kidding", "jk", "whatever", "shut up"],
  tr: ["seks", "cinsel", "azgın", "azgin", "çıplak", "ciplak", "garip", "tuhaf", "rahatsız", "rahatsiz", "alay", "sarkazm", "şaka", "saka", "neyse", "sus"],
  es: ["sexo", "sexual", "caliente", "desnudo", "desnuda", "raro", "incomodo", "incómodo", "sarcasmo", "sarcastico", "broma", "da igual", "callate"],
  pt: ["sexo", "sexual", "tesao", "tesão", "nu", "nua", "estranho", "esquisito", "desconfortavel", "sarcasmo", "sarcastico", "brincadeira", "tanto faz", "cala a boca"],
  ar: ["جنس", "جنسي", "عارية", "غريب", "مريب", "محرج", "سخرية", "امزح", "مزح", "اخرس"],
  fr: ["sexe", "sexuel", "nu", "nue", "bizarre", "genant", "gênant", "malaisant", "sarcasme", "sarcastique", "blague", "tais-toi"],
  de: ["sex", "sexuell", "nackt", "komisch", "unheimlich", "peinlich", "sarkasmus", "sarkastisch", "spass", "spaß", "egal", "halt die klappe"],
  it: ["sesso", "sessuale", "nudo", "nuda", "strano", "inquietante", "imbarazzante", "sarcasmo", "sarcastico", "scherzo", "zitto", "zitta"],
});

function normalizeEnergyText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function flattenEnergyTerms(group) {
  return Object.values(group).flat().map(normalizeEnergyText).filter(Boolean);
}

const ENERGY_HIGH_TERMS = flattenEnergyTerms(ENERGY_KEYWORDS.highEnergy);
const ENERGY_LOW_TERMS = flattenEnergyTerms(ENERGY_KEYWORDS.lowEnergy);
const ENERGY_POSITIVE_EXCLUDE_TERMS = flattenEnergyTerms(ENERGY_POSITIVE_EXCLUDE_KEYWORDS);

function countEnergyMatches(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function scoreEnergyMessage(msg, index, messages) {
  const body = /^<(Voice|Media) omitted>$/.test(msg?.body || "") ? "" : (msg?.body || "");
  const text = normalizeEnergyText(body);
  if (!text || text.length < 3) return null;

  const highMatches = countEnergyMatches(text, ENERGY_HIGH_TERMS);
  const lowMatches = countEnergyMatches(text, ENERGY_LOW_TERMS);
  if (!highMatches && !lowMatches) return null;

  const expressive =
    (/[!?]{1,3}/.test(body) ? 2 : 0) +
    (/(😂|🤣|💀|❤️|❤|💕|🥰|😍|😭|✨|🔥)/.test(body) ? 3 : 0) +
    (body.length >= 24 && body.length <= 220 ? 2 : 0) +
    (body.length > 220 ? 1 : 0);
  const next = messages[index + 1];
  const quickReplyBoost = next && next.name !== msg.name && (next.date - msg.date) / 60000 < 10 ? 1 : 0;
  const hasPositiveBlock = ENERGY_POSITIVE_EXCLUDE_TERMS.some(term => text.includes(term));
  const highScore = highMatches * 5 + expressive + quickReplyBoost - (hasPositiveBlock ? 99 : 0);
  const lowScore = lowMatches * 5 + expressive + quickReplyBoost;
  const tags = [];
  if (highScore > 0 && highScore >= lowScore) tags.push("energy-high");
  if (lowScore > 0) tags.push("energy-low");
  if (expressive >= 3) tags.push("expressive");
  if (!tags.includes("energy-high") && !tags.includes("energy-low")) return null;

  return {
    i: index,
    score: Math.max(highScore, lowScore),
    tags,
  };
}

function buildEnergyChunks(messages) {
  if (!messages.length) return [];
  const n = messages.length;
  const MSG_LINE_LIMIT = 1000;
  const energyCandidates = messages
    .map((msg, index) => scoreEnergyMessage(msg, index, messages))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const windows = [];
  const taken = new Set();
  const addCandidateWindow = (candidate) => {
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k++) {
      if (taken.has(k)) return false;
    }
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k++) taken.add(k);
    windows.push([
      Math.max(0, candidate.i - 4),
      Math.min(n - 1, candidate.i + 6),
      candidate.tags,
    ]);
    return true;
  };

  let highCount = 0;
  let lowCount = 0;
  for (const candidate of energyCandidates) {
    if (candidate.tags.includes("energy-high") && highCount < 12 && addCandidateWindow(candidate)) highCount += 1;
  }
  for (const candidate of energyCandidates) {
    if (candidate.tags.includes("energy-low") && lowCount < 12 && addCandidateWindow(candidate)) lowCount += 1;
  }
  for (const candidate of energyCandidates) {
    if (windows.length >= 42) break;
    addCandidateWindow(candidate);
  }

  // Baseline coverage now comes from the TIMELINE SPINE in the composed
  // sample, so only the focused energy windows are kept here.
  const mergedEnergy = mergeIntervals(windows);
  let lines = 0;
  const selected = [];
  for (const chunk of mergedEnergy) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

export function buildEnergySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= FULL_CHAT_LIMIT) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return composeSampleText(messages, buildEnergyChunks(messages));
}

const ACCOUNTABILITY_KEYWORDS = Object.freeze({
  commitments: Object.freeze({
    en: ["i will", "i'll", "i can", "i'll do", "i'm going to", "i promise", "promise", "let's", "we will", "we'll", "i booked", "i ordered", "i sent", "i'll bring", "i'll call", "i'll send", "i'll pick", "i'll pay"],
    tr: ["yapacağım", "yapacagim", "ederim", "gideceğim", "gidecegim", "söz", "soz", "hallederim", "ararım", "ararim", "gönderirim", "gonderirim", "alırım", "alirim", "getiririm", "bakarım", "bakarim"],
    es: ["voy a", "prometo", "te prometo", "puedo", "lo hago", "lo hare", "lo haré", "mando", "envio", "envío", "llamo", "traigo", "pago", "reservé", "reserve"],
    pt: ["vou", "prometo", "eu faço", "eu faco", "posso", "mando", "envio", "ligo", "trago", "pago", "reservei", "comprei"],
    ar: ["سأ", "راح", "هعمل", "هسوي", "اوعد", "أوعد", "وعد", "ابعت", "أبعت", "ارسل", "أرسل", "اجيب", "أجيب", "اتصل", "أدفع"],
    fr: ["je vais", "je peux", "je promets", "promis", "j'envoie", "j'appelle", "je ramene", "je ramène", "je paie", "j'ai reserve", "j'ai réservé"],
    de: ["ich werde", "ich kann", "versprochen", "ich verspreche", "ich schicke", "ich rufe", "ich bringe", "ich zahle", "ich habe gebucht", "ich buche"],
    it: ["farò", "faro", "posso", "prometto", "mando", "invio", "chiamo", "porto", "pago", "ho prenotato", "prenoto"],
  }),
  followThrough: Object.freeze({
    en: ["done", "did it", "finished", "sent it", "booked", "ordered", "paid", "got it", "handled", "completed", "on my way", "i'm here", "i called"],
    tr: ["bitti", "yaptım", "yaptim", "gönderdim", "gonderdim", "aldım", "aldim", "ödedim", "odedim", "hallettim", "geliyorum", "geldim", "aradım", "aradim"],
    es: ["hecho", "lo hice", "terminé", "termine", "enviado", "reservé", "reserve", "pagado", "lo tengo", "ya voy", "llegué", "llegue", "llamé", "llame"],
    pt: ["feito", "fiz", "terminei", "enviei", "reservei", "paguei", "consegui", "estou indo", "cheguei", "liguei"],
    ar: ["خلص", "عملت", "سويت", "ارسلت", "أرسلت", "حجزت", "دفعت", "جبت", "وصلت", "اتصلت"],
    fr: ["fait", "je l'ai fait", "termine", "terminé", "envoye", "envoyé", "reserve", "réservé", "paye", "payé", "j'arrive", "je suis la", "appelé"],
    de: ["erledigt", "gemacht", "fertig", "geschickt", "gebucht", "bezahlt", "hab es", "bin unterwegs", "bin da", "angerufen"],
    it: ["fatto", "l'ho fatto", "finito", "inviato", "prenotato", "pagato", "preso", "arrivo", "sono qui", "ho chiamato"],
  }),
  delayOrExcuse: Object.freeze({
    en: ["sorry", "forgot", "late", "delayed", "can't", "cannot", "couldn't", "busy", "tomorrow", "later", "not yet", "i missed", "rain check", "reschedule", "postpone"],
    tr: ["pardon", "özür", "ozur", "unuttum", "geç", "gec", "geciktim", "yapamam", "yoğunum", "yogunum", "yarın", "yarin", "sonra", "daha değil", "erteleyelim"],
    es: ["perdón", "perdon", "olvidé", "olvide", "tarde", "no puedo", "ocupado", "ocupada", "mañana", "manana", "luego", "todavía no", "todavia no", "reprogramar"],
    pt: ["desculpa", "esqueci", "atrasado", "atrasada", "não posso", "nao posso", "ocupado", "ocupada", "amanhã", "amanha", "depois", "ainda não", "remarcar"],
    ar: ["اسف", "آسف", "نسيت", "متأخر", "اتأخرت", "مش قادر", "ما اقدر", "مشغول", "بكرة", "بعدين", "لسه", "نأجل"],
    fr: ["desole", "désolé", "oublie", "oublié", "retard", "je peux pas", "occupe", "occupé", "demain", "plus tard", "pas encore", "reporter"],
    de: ["sorry", "vergessen", "spät", "verspätet", "kann nicht", "beschäftigt", "morgen", "später", "noch nicht", "verschieben"],
    it: ["scusa", "dimenticato", "tardi", "ritardo", "non posso", "occupato", "occupata", "domani", "dopo", "non ancora", "rimandare"],
  }),
  cancellation: Object.freeze({
    en: ["cancel", "can't make it", "not coming", "skip", "forget it", "never mind", "called off"],
    tr: ["iptal", "gelemem", "gelmiyorum", "boşver", "bosver", "vazgeç", "vazgec"],
    es: ["cancelar", "cancelo", "no voy", "no puedo ir", "olvidalo", "déjalo", "dejalo"],
    pt: ["cancelar", "cancelei", "não vou", "nao vou", "não consigo ir", "deixa", "esquece"],
    ar: ["الغاء", "إلغاء", "مش جاي", "مش هاجي", "خلينا نلغي", "انسى"],
    fr: ["annuler", "j'annule", "je viens pas", "je ne viens pas", "laisse tomber"],
    de: ["absagen", "abgesagt", "komme nicht", "schaffe es nicht", "vergiss es"],
    it: ["annullare", "annullo", "non vengo", "non riesco", "lascia stare"],
  }),
});

const ACCOUNTABILITY_WEAK_COMMITMENT_TERMS = [
  "sometime", "one day", "maybe", "should hang", "we should", "eventually",
  "bir ara", "belki", "algún día", "algun dia", "talvez", "un jour", "irgendwann", "prima o poi",
].map(normalizeEnergyText);

function flattenAccountabilityTerms(group) {
  return Object.values(group).flat().map(normalizeEnergyText).filter(Boolean);
}

const ACCOUNTABILITY_COMMITMENT_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.commitments);
const ACCOUNTABILITY_FOLLOW_THROUGH_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.followThrough);
const ACCOUNTABILITY_DELAY_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.delayOrExcuse);
const ACCOUNTABILITY_CANCEL_TERMS = flattenAccountabilityTerms(ACCOUNTABILITY_KEYWORDS.cancellation);

function scoreAccountabilityMessage(msg, index, messages) {
  const body = /^<(Voice|Media) omitted>$/.test(msg?.body || "") ? "" : (msg?.body || "");
  const text = normalizeEnergyText(body);
  if (!text || text.length < 4) return null;

  const commitmentMatches = countEnergyMatches(text, ACCOUNTABILITY_COMMITMENT_TERMS);
  const followMatches = countEnergyMatches(text, ACCOUNTABILITY_FOLLOW_THROUGH_TERMS);
  const delayMatches = countEnergyMatches(text, ACCOUNTABILITY_DELAY_TERMS);
  const cancelMatches = countEnergyMatches(text, ACCOUNTABILITY_CANCEL_TERMS);
  if (!commitmentMatches && !followMatches && !delayMatches && !cancelMatches) return null;

  const hasSpecificity = (
    /\b(today|tonight|tomorrow|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at \d|by \d|\d{1,2}:\d{2})\b/i.test(body) ||
    /\b(bugun|bugün|yarin|yarın|aksam|akşam|sabah|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar)\b/i.test(body) ||
    /\b(hoy|mañana|manana|noche|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i.test(body) ||
    /\b(hoje|amanhã|amanha|noite|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i.test(body) ||
    /\b(aujourd'hui|demain|soir|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(body) ||
    /\b(heute|morgen|abend|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(body) ||
    /\b(oggi|domani|sera|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\b/i.test(body)
  );
  const weakCommitment = ACCOUNTABILITY_WEAK_COMMITMENT_TERMS.some(term => text.includes(term));
  const nearby = messages.slice(Math.max(0, index - 3), Math.min(messages.length, index + 5));
  const nearbyFollow = nearby.some(item => item !== msg && countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_FOLLOW_THROUGH_TERMS));
  const nearbyDelay = nearby.some(item => item !== msg && (
    countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_DELAY_TERMS) ||
    countEnergyMatches(normalizeEnergyText(item?.body), ACCOUNTABILITY_CANCEL_TERMS)
  ));

  const tags = [];
  if (commitmentMatches) tags.push("accountability-promise");
  if (followMatches || nearbyFollow) tags.push("accountability-kept");
  if (delayMatches || cancelMatches || nearbyDelay) tags.push("accountability-broken");
  const quoteShape = body.length >= 12 && body.length <= 240 ? 2 : 0;
  const score =
    commitmentMatches * 6 +
    followMatches * 5 +
    delayMatches * 4 +
    cancelMatches * 6 +
    (hasSpecificity ? 4 : 0) +
    (nearbyFollow ? 2 : 0) +
    (nearbyDelay ? 2 : 0) +
    quoteShape -
    (weakCommitment && !hasSpecificity ? 5 : 0);

  if (score < 4) return null;
  return { i: index, score, tags: [...new Set(tags)] };
}

function buildAccountabilityChunks(messages) {
  if (!messages.length) return [];
  const n = messages.length;
  const MSG_LINE_LIMIT = 1000;
  const candidates = messages
    .map((msg, index) => scoreAccountabilityMessage(msg, index, messages))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const windows = [];
  const taken = new Set();
  const addWindow = (candidate) => {
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k += 1) {
      if (taken.has(k)) return false;
    }
    for (let k = Math.max(0, candidate.i - 5); k <= Math.min(n - 1, candidate.i + 5); k += 1) taken.add(k);
    windows.push([
      Math.max(0, candidate.i - 5),
      Math.min(n - 1, candidate.i + 7),
      candidate.tags,
    ]);
    return true;
  };

  let promiseCount = 0;
  let keptCount = 0;
  let brokenCount = 0;
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-promise") && promiseCount < 12 && addWindow(candidate)) promiseCount += 1;
  }
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-kept") && keptCount < 10 && addWindow(candidate)) keptCount += 1;
  }
  for (const candidate of candidates) {
    if (candidate.tags.includes("accountability-broken") && brokenCount < 10 && addWindow(candidate)) brokenCount += 1;
  }
  for (const candidate of candidates) {
    if (windows.length >= 44) break;
    addWindow(candidate);
  }

  // Baseline coverage now comes from the TIMELINE SPINE in the composed
  // sample, so only the focused accountability windows are kept here.
  const focused = mergeIntervals(windows);
  let lines = 0;
  const selected = [];
  for (const chunk of focused) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

export function buildAccountabilitySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= FULL_CHAT_LIMIT) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return composeSampleText(messages, buildAccountabilityChunks(messages));
}

export const CORE_ANALYSIS_VERSION = 2;
export const CORE_ANALYSIS_CACHE_VERSION = 9;
// Server clamp is MAX_PROVIDER_TOKENS in analyse-chat/index.ts (5000) — keep
// these below it so the request budget is honoured, not silently truncated.
export const CORE_A_MAX_TOKENS = 4200;
export const CORE_B_MAX_TOKENS = 3400;
export const HOMEPAGE_VERSION = "67538";
export const HOMEPAGE_VERSION_LABEL = (_updateNotesRaw.match(/^## (v\d+\.\d+)/m) || [])[1] ?? "v?";

// Prompt construction is server-owned since the edge refactor: the shared
// module in supabase/functions/_shared/prompts.js is the single source of
// truth. These re-exports keep the debug panel and tests on the same text.
export const buildAnalystSystemPrompt = sharedBuildAnalystSystemPrompt;
export const CORE_A_WRITING_STYLE = SHARED_CORE_A_WRITING_STYLE;

export function buildCoreASystemPrompt(role, relationshipType, extraRules = "", chatLang = "en", relationshipLine = "") {
  return buildAnalystSystemPrompt(role, relationshipType, `${CORE_A_WRITING_STYLE} ${extraRules}`, chatLang, relationshipLine);
}

// ─────────────────────────────────────────────────────────────────
// CANDIDATE MOMENTS — pre-extracted anchors that stop the model from
// reusing one event across many cards. Local scoring already knows where
// the laughs, care, tension, and affection live; this turns the top hits
// into an explicit, deduplicated shortlist the prompts can reserve.
// ─────────────────────────────────────────────────────────────────

const CANDIDATE_TYPE_DEFS = [
  { type: "funny",     take: 7, match: tags => tags.includes("laugh-trigger-hard") || tags.includes("laugh-trigger") },
  { type: "care",      take: 5, match: tags => tags.includes("care-response") || tags.includes("support") },
  { type: "tension",   take: 5, match: tags => tags.includes("conflict") },
  { type: "drama",     take: 4, match: tags => tags.includes("distress") && !tags.includes("conflict") },
  { type: "affection", take: 5, match: tags => tags.includes("affection") },
  { type: "apology",   take: 3, match: tags => tags.includes("apology") },
];

// Energy highs/lows come from the dedicated energy scorer, not scoreMessages,
// so the bank can also feed mostEnergising / mostDraining with real lines.
const CANDIDATE_ENERGY_DEFS = [
  { type: "energy-high", take: 4, match: tags => tags.includes("energy-high") },
  { type: "energy-low",  take: 4, match: tags => tags.includes("energy-low") && !tags.includes("energy-high") },
];

function candidateContentTokens(body) {
  return new Set(
    String(body || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^\p{L}\p{N}']+/u)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word))
  );
}

function candidateTokenOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function extractCandidateMoments(messages, { perType = 0, minGap = 30 } = {}) {
  if (!Array.isArray(messages) || messages.length < 20) return [];
  const n = messages.length;
  const scores = scoreMessages(messages);
  const periodOf = index => (index < n / 3 ? "early on" : index < (2 * n) / 3 ? "mid-chat" : "recently");
  const chosen = [];

  const takeCandidates = (def, candidates) => {
    const limit = perType > 0 ? perType : (def.take || 3);
    let taken = 0;
    for (const candidate of candidates) {
      if (taken >= limit) break;
      const anchorBody = messages[candidate.index].body || "";
      // A media placeholder can't be quoted; a message that is itself
      // laughter is a reaction, never a good anchor for ANY type.
      if (/^<(Voice|Media) omitted>$/.test(anchorBody)) continue;
      if (laughStrength(anchorBody) >= 2) continue;
      // Distance dedupe: two anchors inside the same exchange are one moment.
      if (chosen.some(existing => Math.abs(existing.index - candidate.index) < minGap)) continue;
      const tokens = candidateContentTokens(anchorBody);
      // Topic dedupe: near-identical wording elsewhere means the same story.
      if (chosen.some(existing => candidateTokenOverlap(existing.tokens, tokens) > 0.45)) continue;

      // Every candidate carries how the other person reacted: the exchange is
      // the moment, not the single line. Funny requires a dedicated laugh
      // (strength ≥ 2) and takes the HARDEST one — the receipt is the point;
      // other types take the first reply from a different speaker.
      let reaction = null;
      let bestStrength = 0;
      for (let j = candidate.index + 1; j <= Math.min(candidate.index + 4, n - 1); j += 1) {
        const reply = messages[j];
        if (reply.name === messages[candidate.index].name) continue;
        if (/^<(Voice|Media) omitted>$/.test(reply.body)) continue;
        if (def.type === "funny") {
          const strength = laughStrength(reply.body);
          if (strength < 2 || strength <= bestStrength) continue;
          bestStrength = strength;
          reaction = { speaker: reply.name, quote: cleanQuote(redactSensitiveText(reply.body), 40) };
          continue;
        }
        reaction = { speaker: reply.name, quote: cleanQuote(redactSensitiveText(reply.body), 90) };
        break;
      }
      // A "funniest" candidate without a visible laugh receipt is exactly the
      // unfunny content we're trying to keep out of the bank.
      if (def.type === "funny" && !reaction) continue;

      chosen.push({
        index: candidate.index,
        tokens,
        type: def.type,
        period: periodOf(candidate.index),
        speaker: messages[candidate.index].name,
        quote: cleanQuote(redactSensitiveText(anchorBody), 110),
        reaction,
      });
      taken += 1;
    }
  };

  for (const def of CANDIDATE_TYPE_DEFS) {
    takeCandidates(def, scores
      .map((entry, index) => ({ index, score: entry.score, tags: entry.tags }))
      .filter(candidate => candidate.score >= 4 && def.match(candidate.tags))
      .sort((a, b) => b.score - a.score));
  }

  const energyScores = messages
    .map((msg, index) => scoreEnergyMessage(msg, index, messages))
    .filter(Boolean);
  for (const def of CANDIDATE_ENERGY_DEFS) {
    takeCandidates(def, energyScores
      .map(entry => ({ index: entry.i, score: entry.score, tags: entry.tags }))
      .filter(candidate => candidate.score >= 8 && def.match(candidate.tags))
      .sort((a, b) => b.score - a.score));
  }

  return chosen
    .sort((a, b) => a.index - b.index)
    .map(({ index, tokens, ...moment }, i) => ({ id: i + 1, ...moment }));
}

export function formatCandidateMoments(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return "";
  const lines = candidates.map(candidate => {
    const reaction = candidate.reaction
      ? (candidate.type === "funny"
        ? ` (laugh reaction from ${candidate.reaction.speaker}: "${candidate.reaction.quote}")`
        : ` (reply from ${candidate.reaction.speaker}: "${candidate.reaction.quote}")`)
      : "";
    return `#${candidate.id} [${candidate.type} · ${candidate.period}] ${candidate.speaker}: "${candidate.quote}"${reaction}`;
  });
  return `CANDIDATE MOMENTS (pre-extracted locally from the full history):
${lines.join("\n")}
RESERVATION RULE: Each candidate may anchor AT MOST ONE output field; reference it by its # number wherever a candidateId is requested. Prefer these candidates for moment fields (funniest, sweetest, most loving, tension, drama example, energising, draining) and copy their quotes VERBATIM. Never anchor two fields on the same candidate or on the same underlying event, even reworded. If no candidate fits a field, use candidateId 0 and a different real moment from the windows instead. Spread fields across different people and different stories wherever the evidence allows.`;
}

// ─────────────────────────────────────────────────────────────────
// RECURRING CAST — locally verified third-party name detection.
// The model kept blending third-party storylines (attaching a breakup to the
// wrong person) because entity resolution was left to it across isolated
// windows. This counts recurring outside names deterministically and collects
// dated sample lines per name, so claims about third parties can be anchored
// to literal evidence instead of guessed.
// ─────────────────────────────────────────────────────────────────

const CAST_TOKEN_RE = /[\p{L}][\p{L}'’-]{1,24}/gu;

export function extractRecurringCast(messages, participantNames = [], { maxPeople = 8, maxSamples = 3, minMentions = 4, topicTokens = [], nounCapitalization = false } = {}) {
  if (!Array.isArray(messages) || messages.length < 20) return [];
  const participants = new Set(
    participantNames.flatMap(n => String(n || "").toLowerCase().split(/\s+/)).filter(Boolean)
  );
  const stats = new Map(); // lower -> { canonical, count, strongCount, indexes }

  messages.forEach((msg, index) => {
    const body = msg.body || "";
    if (/^<(Voice|Media) omitted>$/.test(body)) return;
    let match;
    let tokenPos = 0;
    const bodyTokenCount = (body.match(CAST_TOKEN_RE) || []).length;
    CAST_TOKEN_RE.lastIndex = 0;
    while ((match = CAST_TOKEN_RE.exec(body)) !== null) {
      tokenPos += 1;
      const rawToken = match[0];
      const base = rawToken.split(/['’]/)[0];
      if (base.length < 3) continue;
      const lower = base.toLowerCase();
      if (participants.has(lower)) continue;
      if (TOKEN_STOP_WORDS.has(lower) || TOKEN_STOP_WORDS.has(foldToken(lower))) continue;
      // Titlecase only: ALL-CAPS tokens are shouting, not names.
      const titlecase = /^[A-ZÇĞİÖŞÜ]/.test(base) && base.slice(1) === base.slice(1).toLowerCase();
      const midSentence = tokenPos > 1;
      const suffix = rawToken.slice(base.length + 1).toLowerCase();
      const hasSuffixApostrophe = rawToken.length > base.length && !/^(s|t|d|m|re|ve|ll)$/.test(suffix);
      // Strong signal: Titlecase away from sentence start, or an apostrophe
      // suffix (Josh'la, Habib'e) — both are name-shaped usage.
      // In noun-capitalizing languages (German) Titlecase marks every noun,
      // so only the apostrophe/frequency channels count as name-shaped there.
      const strong = (!nounCapitalization && titlecase && midSentence) || hasSuffixApostrophe;
      const capitalized = titlecase;
      const entry = stats.get(lower) || { canonical: base, count: 0, strongCount: 0, aloneCount: 0, indexes: [] };
      entry.count += 1;
      if (bodyTokenCount <= 2) entry.aloneCount += 1;
      if (strong) { entry.strongCount += 1; if (capitalized) entry.canonical = base; }
      if (entry.indexes.length < 400) entry.indexes.push(index);
      stats.set(lower, entry);
    }
  });

  const n = messages.length;
  const periodOf = index => (index < n / 3 ? "early on" : index < (2 * n) / 3 ? "mid-chat" : "recently");

  // Recall channel for names people type lowercase (josh, tim): the top
  // content words are already stopword/filler/laugh-filtered by localStats,
  // so recurring single tokens there are worth evidence samples too.
  const topicSet = new Set(
    (Array.isArray(topicTokens) ? topicTokens : [])
      .map(token => String(token || "").toLowerCase())
      .filter(token => /^[\p{L}][\p{L}-]{2,}$/u.test(token) && !participants.has(token))
      .slice(0, 8)
  );

  return [...stats.values()]
    .filter(entry => {
      const nameLike = entry.strongCount >= 3 && entry.count >= minMentions;
      const aloneRatio = entry.aloneCount / Math.max(1, entry.count);
      const topicLike = topicSet.has(entry.canonical.toLowerCase()) && entry.count >= 6 && aloneRatio < 0.2;
      return nameLike || topicLike;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, maxPeople)
    .map(entry => {
      // Spread samples across the chat's lifespan so the evidence shows the
      // storyline's arc, not one burst.
      const picks = [];
      const step = Math.max(1, Math.floor(entry.indexes.length / maxSamples));
      for (let i = 0; i < entry.indexes.length && picks.length < maxSamples - 1; i += step) picks.push(entry.indexes[i]);
      // The most recent mention is always evidence: it shows how the
      // storyline CURRENTLY stands (a "breakup" followed by casual future
      // plans never happened).
      const lastIndex = entry.indexes[entry.indexes.length - 1];
      if (!picks.includes(lastIndex)) picks.push(lastIndex);
      const firstIndex = entry.indexes[0];
      return {
        name: entry.canonical,
        mentions: entry.count,
        firstPeriod: periodOf(firstIndex),
        lastPeriod: periodOf(lastIndex),
        samples: picks.map((index, i) => ({
          period: i === picks.length - 1 && index === lastIndex ? "most recent mention" : periodOf(index),
          speaker: messages[index].name,
          quote: cleanQuote(redactSensitiveText(messages[index].body), 130),
        })),
      };
    });
}

export function clampScore(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

export function strOr(value, fallback = "") {
  return typeof value === "string" ? sanitizeResultText(value) : fallback;
}

export function cleanStringArray(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map(item => sanitizeResultText(String(item || ""))).filter(Boolean).slice(0, limit);
}

export function normalizeNamedScoreRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      name: strOr(item.name, `Person ${i + 1}`),
      score: clampScore(item.score, 5),
      detail: strOr(item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

export function normalizeApologySummary(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    name: strOr(safe.name, "None clearly identified"),
    count: Math.max(0, Math.round(Number(safe.count) || 0)),
    context: strOr(safe.context),
  };
}

export function normalizeMomentRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      date: strOr(item.date, `Moment ${i + 1}`),
      person: strOr(item.person),
      description: strOr(item.description || item.title),
      quote: strOr(item.quote || item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

export function normalizePromiseMoment(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    person: strOr(safe.person, "None clearly identified"),
    promise: strOr(safe.promise),
    date: strOr(safe.date),
    outcome: strOr(safe.outcome),
  };
}

// Moment fields arrive either as plain strings (legacy coreA/coreB pipelines)
// or as { candidateId, text } picks anchored on the local quote bank.
export function momentFieldText(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return strOr(value.text);
  return strOr(value);
}

// Same normalisation as voiceLint's squash: substring matching across
// diacritics, case, emoji, and punctuation.
function squashForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıi̇]/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Remove the quote marks around a specific quote inside a text (used when two
// fields anchored on the same candidate: the later one loses the quote marks
// so no two cards flash the same line as a quote).
function dequoteSpecificQuote(text, quote) {
  const target = squashForMatch(quote);
  const fix = (match, inner) => (squashForMatch(inner) === target ? inner : match);
  return String(text || "")
    .replace(/["“”]([^"“”\n]{2,}?)["“”]/gu, fix)
    .replace(/(?<![\p{L}\p{N}])['‘]([^'‘’\n]{2,}?)['’](?![\p{L}\p{N}])/gu, fix);
}

const MOMENT_PICK_FIELDS = ["funniestReason", "sweetMoment", "mostLovingMoment", "tensionMoment", "mostEnergising", "mostDraining"];

// Enforce the quote-bank contract on the normalized shared object:
// - a picked candidate's quote must appear verbatim in the field text; if the
//   model paraphrased or dropped it, rebuild the field from the bank entry
//   (speaker: "quote" + reaction + the model's read), so the exact line the
//   math extracted is always what the card shows;
// - each candidate anchors at most one field across the whole result, in
//   field-priority order; a duplicate pick keeps its text but loses the
//   repeated quote's marks.
export function resolveMomentPicks(rawShared, normalizedShared, quoteBank) {
  if (!Array.isArray(quoteBank) || !quoteBank.length) return normalizedShared;
  const byId = new Map(quoteBank.map(candidate => [candidate.id, candidate]));
  const used = new Set();
  const out = { ...normalizedShared };
  for (const field of MOMENT_PICK_FIELDS) {
    // Picks arrive as a sibling <field>CandidateId number (flat, to keep the
    // structured-outputs grammar small); the nested {candidateId, text} shape
    // is still accepted for older cached results.
    const rawValue = rawShared?.[field];
    const id = rawValue && typeof rawValue === "object"
      ? Math.round(Number(rawValue.candidateId) || 0)
      : Math.round(Number(rawShared?.[`${field}CandidateId`]) || 0);
    const candidate = id > 0 ? byId.get(id) : null;
    const text = strOr(out[field]);
    if (!candidate || !text) continue;
    if (used.has(id)) {
      out[field] = sanitizeResultText(dequoteSpecificQuote(text, candidate.quote));
      continue;
    }
    used.add(id);
    if (!squashForMatch(text).includes(squashForMatch(candidate.quote))) {
      const reaction = candidate.reaction
        ? ` ${candidate.reaction.speaker}: "${candidate.reaction.quote}"`
        : "";
      out[field] = sanitizeResultText(`${candidate.speaker}: "${candidate.quote}"${reaction} ${dequoteSpecificQuote(text, candidate.quote)}`.trim());
    }
  }
  return out;
}

export function normalizeAttributionQuote(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    quote: strOr(safe.quote),
    person: strOr(safe.person),
    contextParagraph: strOr(safe.contextParagraph),
    isSensitive: Boolean(safe.isSensitive === true || safe.isSensitive === "true"),
  };
}

export function normalizeTimeOfDay(item, math = null) {
  const safe = item && typeof item === "object" ? item : {};
  const personA = safe.personA && typeof safe.personA === "object" ? safe.personA : {};
  const personB = safe.personB && typeof safe.personB === "object" ? safe.personB : {};
  // Peak hours are deterministic facts from the timestamps: always use the
  // local computation so every report shows identical numbers. The AI keeps
  // only the contrast sentence (interpretation, not data).
  const daypartOf = h => (h >= 5 && h <= 11) ? "morning" : (h >= 12 && h <= 16) ? "afternoon" : (h >= 17 && h <= 21) ? "evening" : "late night";
  if (math && !math.isGroup && Array.isArray(math.names) && Array.isArray(math.peakHour) && math.names.length >= 2) {
    const rawHours = Array.isArray(math.peakHourRaw) ? math.peakHourRaw : [];
    return {
      personA: {
        name: math.names[0] || strOr(personA.name),
        peakHour: math.peakHour[0] || strOr(personA.peakHour),
        peakDaypart: Number.isInteger(rawHours[0]) ? daypartOf(rawHours[0]) : strOr(personA.peakDaypart),
      },
      personB: {
        name: math.names[1] || strOr(personB.name),
        peakHour: math.peakHour[1] || strOr(personB.peakHour),
        peakDaypart: Number.isInteger(rawHours[1]) ? daypartOf(rawHours[1]) : strOr(personB.peakDaypart),
      },
      contrast: strOr(safe.contrast),
    };
  }
  return {
    personA: { name: strOr(personA.name), peakHour: strOr(personA.peakHour), peakDaypart: strOr(personA.peakDaypart) },
    personB: { name: strOr(personB.name), peakHour: strOr(personB.peakHour), peakDaypart: strOr(personB.peakDaypart) },
    contrast: strOr(safe.contrast),
  };
}

export function normalizeLoveMiss(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    description: strOr(safe.description),
    quote: strOr(safe.quote),
    persons: Array.isArray(safe.persons) ? safe.persons.map(s => strOr(s)).filter(Boolean) : [],
  };
}

export function normalizeGuessThresholds(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    loveLanguageGuessValid: safe.loveLanguageGuessValid === true || safe.loveLanguageGuessValid === "true",
    energyGuessValid: safe.energyGuessValid === true || safe.energyGuessValid === "true",
  };
}

// Normalize schema-critical enum values that Claude may translate despite instructions.
// Maps common translations back to canonical English control tokens so the app's
// UI mappings (arrowMap, trajMap, love-language labels) keep working.
export const LOVE_LANG_CANONICAL = [
  "Words of Affirmation",
  "Acts of Service",
  "Receiving Gifts",
  "Quality Time",
  "Physical Touch",
  "Mixed",
];
export function normalizeLoveLanguage(v) {
  const s = String(v || "").trim();
  const exact = LOVE_LANG_CANONICAL.find(l => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const sl = s.toLowerCase();
  if (/affirm|onay|söz|szavak|parole|afirmación|palavras|aff/.test(sl)) return "Words of Affirmation";
  if (/service|servis|hizmet|actes|handlung|servicio|atos|acts/.test(sl)) return "Acts of Service";
  if (/gift|hediye|cadeau|geschenk|regalo|doni/.test(sl)) return "Receiving Gifts";
  if (/quality|nitelik|temps|zeit|tiempo|tempo/.test(sl) && /time|zaman/.test(sl)) return "Quality Time";
  if (/physical|fizik|fisique|körper|físic|fisic|touch|dokunuş/.test(sl)) return "Physical Touch";
  return s; // keep as-is if unrecognized (still renders, just without canonical label)
}
export function normalizeDepthChange(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["deeper", "shallower", "about the same"].includes(s)) return s;
  if (/deep|derin|profond|tief|profund|más profund/.test(s)) return "deeper";
  if (/shallow|yüzey|superfic|flach|poco profund/.test(s)) return "shallower";
  if (/same|aynı|même|gleich|igual|stessa/.test(s)) return "about the same";
  return v;
}
export function normalizeTrajectory(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["closer", "drifting", "stable"].includes(s)) return s;
  if (/clos|yakın|proche|näher|cerca|vicin/.test(s)) return "closer";
  if (/drift|uzaklaş|éloign|entfern|alej|allontan/.test(s)) return "drifting";
  if (/stable|stabil|estable|stabil/.test(s)) return "stable";
  return v;
}
export function normalizeEnergyType(v) {
  const s = String(v || "").toLowerCase().trim();
  if (["net positive", "mixed", "net draining"].includes(s)) return s;
  if (/positive|pozitif|positif|positivo|positiv/.test(s)) return "net positive";
  if (/drain|yoran|épuisant|erschöpf|agotador|sfiancant/.test(s)) return "net draining";
  if (/mixed|karma|mixte|gemischt|mixto|misto/.test(s)) return "mixed";
  return v;
}

export function normalizeCorePersonA(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const care = safe.careStyle && typeof safe.careStyle === "object" ? safe.careStyle : {};
  const energy = safe.energy && typeof safe.energy === "object" ? safe.energy : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    summaryRole: strOr(safe.summaryRole),
    careStyle: {
      language: normalizeLoveLanguage(strOr(care.language, "Mixed")),
      languageEmoji: "",
      examples: Array.isArray(care.examples)
        ? care.examples
            .filter(s => typeof s === "string" && s.trim())
            .map(s => sanitizeResultText(s).replace(/\.+$/, ""))
            .join(". ")
        : strOr(care.examples),
      score: clampScore(care.score, 5),
    },
    energy: {
      netScore: clampScore(energy.netScore, 5),
      type: normalizeEnergyType(strOr(energy.type, "mixed")),
      goodNews: strOr(energy.goodNews),
      venting: strOr(energy.venting, "minimal venting"),
      hypeQuote: strOr(energy.hypeQuote),
    },
  };
}

function normalizeCorePersonB(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const health = safe.health && typeof safe.health === "object" ? safe.health : {};
  const accountability = safe.accountability && typeof safe.accountability === "object" ? safe.accountability : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    health: {
      score: clampScore(health.score, 5),
      detail: strOr(health.detail),
      apologyCount: Math.max(0, Math.round(Number(health.apologyCount) || 0)),
      apologyContext: strOr(health.apologyContext),
    },
    accountability: {
      total: Math.max(0, Math.round(Number(accountability.total) || 0)),
      kept: Math.max(0, Math.round(Number(accountability.kept) || 0)),
      broken: Math.max(0, Math.round(Number(accountability.broken) || 0)),
      score: clampScore(accountability.score, 5),
      detail: strOr(accountability.detail),
    },
  };
}

export function normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const growth = shared.growth && typeof shared.growth === "object" ? shared.growth : {};
  const lockedRelationshipCategory = coerceRelationshipCategory(
    relationshipContext?.category,
    relationshipType,
    relationshipContext?.category || relationshipType || "other"
  );
  const lockedRelationshipSpecific = coerceRelationshipSpecificLabel(
    relationshipContext?.specificRelationship,
    lockedRelationshipCategory
  );
  const sanitizedRelationshipStatus = sanitizeRelationshipStatus(
    shared.relationshipStatus,
    lockedRelationshipCategory,
    lockedRelationshipSpecific
  );
  const relationshipStatusWasAdjusted = sanitizedRelationshipStatus !== strOr(shared.relationshipStatus);
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, math?.isGroup ? Math.min(math?.names?.length || 0, 6) : 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonA(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "a",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
      relationshipCategory: lockedRelationshipCategory || null,
      relationshipSpecific: lockedRelationshipSpecific,
      relationshipConfidence: strOr(relationshipContext?.confidence, "low"),
      relationshipReasoning: strOr(relationshipContext?.reasoning),
      relationshipEvidence: strOr(relationshipContext?.evidence),
      endearmentWarning: strOr(relationshipContext?.endearmentWarning),
    },
    people,
    shared: {
      vibeOneLiner: strOr(shared.vibeOneLiner),
      biggestTopic: strOr(shared.biggestTopic),
      ghostContext: strOr(shared.ghostContext),
      funniestPerson: strOr(shared.funniestPerson),
      funniestReason: momentFieldText(shared.funniestReason),
      dramaStarter: strOr(shared.dramaStarter),
      dramaContext: strOr(shared.dramaContext),
      signaturePhrases: cleanStringArray(shared.signaturePhrases, 2),
      relationshipStatus: sanitizedRelationshipStatus,
      relationshipStatusWhy: relationshipStatusWasAdjusted
        ? strOr(relationshipContext?.reasoning, `Use the user-selected relationship type "${lockedRelationshipCategory}" as the framing for this chat.`)
        : strOr(shared.relationshipStatusWhy),
      statusEvidence: relationshipStatusWasAdjusted
        ? strOr(shared.statusEvidence || relationshipContext?.evidence)
        : strOr(shared.statusEvidence),
      toxicPerson: strOr(shared.toxicPerson),
      toxicReason: strOr(shared.toxicReason),
      toxicityReport: strOr(shared.toxicityReport),
      redFlags: normalizeRedFlags(shared.redFlags),
      evidenceTimeline: normalizeTimeline(shared.evidenceTimeline),
      relationshipSummary: strOr(shared.relationshipSummary),
      groupDynamic: strOr(shared.groupDynamic),
      tensionMoment: momentFieldText(shared.tensionMoment),
      kindestPerson: strOr(shared.kindestPerson),
      sweetMoment: momentFieldText(shared.sweetMoment),
      mostMissed: strOr(shared.mostMissed),
      insideJoke: strOr(shared.insideJoke),
      hypePersonReason: strOr(shared.hypePersonReason),
      loveLanguageMismatch: strOr(shared.loveLanguageMismatch),
      mostLovingMoment: momentFieldText(shared.mostLovingMoment),
      compatibilityScore: clampScore(shared.compatibilityScore, 5),
      compatibilityRead: strOr(shared.compatibilityRead),
      mostEnergising: momentFieldText(shared.mostEnergising),
      mostDraining: momentFieldText(shared.mostDraining),
      energyCompatibility: strOr(shared.energyCompatibility),
      timeOfDay: normalizeTimeOfDay(shared.timeOfDay, math),
      loveLanguageIntro: strOr(shared.loveLanguageIntro),
      loveMiss: normalizeLoveMiss(shared.loveMiss),
      loveMissUnspoken: strOr(shared.loveMissUnspoken),
      energyDynamic: strOr(shared.energyDynamic),
      guessThresholds: normalizeGuessThresholds(shared.guessThresholds),
      memorableMoments: normalizeMemorableMoments(shared.memorableMoments),
      growth: {
        thenDepth: strOr(growth.thenDepth),
        nowDepth: strOr(growth.nowDepth),
        depthChange: normalizeDepthChange(strOr(growth.depthChange)),
        whoChangedMore: strOr(growth.whoChangedMore),
        whoChangedHow: strOr(growth.whoChangedHow),
        topicsAppeared: strOr(growth.topicsAppeared),
        topicsDisappeared: strOr(growth.topicsDisappeared),
        trajectory: normalizeTrajectory(strOr(growth.trajectory)),
        trajectoryDetail: strOr(growth.trajectoryDetail),
        arcSummary: strOr(growth.arcSummary),
        personAArc: strOr(growth.personAArc),
        personBArc: strOr(growth.personBArc),
        turningPoint: strOr(growth.turningPoint),
        messageAtTurningPoint: normalizeAttributionQuote(growth.messageAtTurningPoint),
        growthGuessThreshold: growth.growthGuessThreshold === true || growth.growthGuessThreshold === "true",
      },
    },
  };
}

export function normalizeConnectionDigest(raw, math, relationshipType, relationshipContext = null, quoteBank = []) {
  const normalized = normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
  const rawShared = raw && typeof raw === "object" && raw.shared && typeof raw.shared === "object" ? raw.shared : {};
  return {
    ...normalized,
    shared: resolveMomentPicks(rawShared, normalized.shared, quoteBank),
    part: "connection",
  };
}

export function normalizeGrowthDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
    part: "growth",
  };
}

export function normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const toxicity = shared.toxicity && typeof shared.toxicity === "object" ? shared.toxicity : {};
  const accountability = shared.accountability && typeof shared.accountability === "object" ? shared.accountability : {};
  const lockedRelationshipCategory = coerceRelationshipCategory(
    relationshipContext?.category,
    relationshipType,
    relationshipContext?.category || relationshipType || "other"
  );
  const lockedRelationshipSpecific = coerceRelationshipSpecificLabel(
    relationshipContext?.specificRelationship,
    lockedRelationshipCategory
  );
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonB(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "b",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
      relationshipCategory: lockedRelationshipCategory || null,
      relationshipSpecific: lockedRelationshipSpecific,
      relationshipConfidence: strOr(relationshipContext?.confidence, "low"),
      relationshipReasoning: strOr(relationshipContext?.reasoning),
      relationshipEvidence: strOr(relationshipContext?.evidence),
      endearmentWarning: strOr(relationshipContext?.endearmentWarning),
    },
    people,
    shared: {
      toxicity: {
        chatHealthScore: clampScore(toxicity.chatHealthScore, 5),
        healthScores: normalizeNamedScoreRows(toxicity.healthScores),
        apologiesLeader: normalizeApologySummary(toxicity.apologiesLeader),
        apologiesOther: normalizeApologySummary(toxicity.apologiesOther),
        redFlagMoments: normalizeMomentRows(toxicity.redFlagMoments, 5),
        conflictPattern: strOr(toxicity.conflictPattern),
        powerBalance: strOr(toxicity.powerBalance),
        powerHolder: strOr(toxicity.powerHolder, "Balanced"),
        verdict: strOr(toxicity.verdict),
        whatStillHere: strOr(toxicity.whatStillHere),
        heavyAttributionQuote: normalizeAttributionQuote(toxicity.heavyAttributionQuote),
        apologyGuessThreshold: toxicity.apologyGuessThreshold === true || toxicity.apologyGuessThreshold === "true",
        powerGuessThreshold: toxicity.powerGuessThreshold === true || toxicity.powerGuessThreshold === "true",
      },
      accountability: {
        notableBroken: normalizePromiseMoment(accountability.notableBroken),
        notableKept: normalizePromiseMoment(accountability.notableKept),
        comparison: strOr(accountability.comparison),
        followThroughPattern: strOr(accountability.followThroughPattern),
        evidenceQuality: strOr(accountability.evidenceQuality),
        overallVerdict: strOr(accountability.overallVerdict),
        reliabilityArc: strOr(accountability.reliabilityArc),
        promiseThatMattered: normalizeAttributionQuote(accountability.promiseThatMattered),
        promiseGuessThreshold: accountability.promiseGuessThreshold === true || accountability.promiseGuessThreshold === "true",
      },
    },
  };
}

export function normalizeRiskDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
    part: "risk",
  };
}

export function attachReportMeta(report, relationshipType, coreAnalysis = null) {
  return {
    ...(report && typeof report === "object" ? report : {}),
    relationshipType: relationshipType ?? null,
    relationshipSpecific: coreAnalysis?.meta?.relationshipSpecific || null,
    relationshipConfidence: coreAnalysis?.meta?.relationshipConfidence || null,
    relationshipEvidence: coreAnalysis?.meta?.relationshipEvidence || null,
    relationshipReasoning: coreAnalysis?.meta?.relationshipReasoning || null,
    ...(coreAnalysis ? { coreAnalysis } : {}),
  };
}

function pickCorePairA(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonA(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonA(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function pickCorePairB(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonB(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonB(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

export function deriveGeneralReportFromCore(core, math, relationshipType) {
  const shared = core?.shared || {};
  return attachReportMeta({
    funniestPerson: shared.funniestPerson || math?.funniestPerson || "",
    funniestReason: shared.funniestReason,
    ghostContext: shared.ghostContext,
    biggestTopic: shared.biggestTopic,
    dramaStarter: shared.dramaStarter,
    dramaContext: shared.dramaContext,
    signaturePhrase: shared.signaturePhrases?.length ? shared.signaturePhrases : undefined,
    relationshipStatus: shared.relationshipStatus,
    relationshipStatusWhy: shared.relationshipStatusWhy,
    statusEvidence: shared.statusEvidence,
    toxicPerson: shared.toxicPerson,
    toxicReason: shared.toxicReason,
    evidenceTimeline: shared.evidenceTimeline,
    redFlags: shared.redFlags,
    toxicityReport: shared.toxicityReport,
    relationshipSummary: shared.relationshipSummary,
    tensionMoment: shared.tensionMoment,
    kindestPerson: shared.kindestPerson,
    sweetMoment: shared.sweetMoment,
    vibeOneLiner: shared.vibeOneLiner,
    groupDynamic: shared.groupDynamic,
    mostMissed: shared.mostMissed,
    insideJoke: shared.insideJoke,
    hypePersonReason: shared.hypePersonReason,
    memorableMoments: shared.memorableMoments,
    timeOfDay: shared.timeOfDay,
  }, relationshipType, core);
}

export function deriveEnergyReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      netScore: personA.energy.netScore,
      type: personA.energy.type,
      goodNews: personA.energy.goodNews,
      venting: personA.energy.venting,
      hypeQuote: personA.energy.hypeQuote,
    },
    personB: {
      name: personB.name,
      netScore: personB.energy.netScore,
      type: personB.energy.type,
      goodNews: personB.energy.goodNews,
      venting: personB.energy.venting,
      hypeQuote: personB.energy.hypeQuote,
    },
    mostEnergising: shared.mostEnergising,
    mostDraining: shared.mostDraining,
    compatibility: shared.energyCompatibility,
    energyDynamic: shared.energyDynamic,
    timeOfDay: shared.timeOfDay,
    energyGuessValid: shared.guessThresholds?.energyGuessValid ?? false,
    chargeAttribution: shared.memorableMoments?.find(m => m.type === "funny" || m.type === "signature") ?? null,
  }, relationshipType, core);
}

export function deriveToxicityReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const shared = core?.shared || {};
  const toxicity = shared.toxicity || {};
  const healthScores = toxicity.healthScores?.length
    ? toxicity.healthScores
    : [personA, personB].map(person => ({
        name: person.name,
        score: person.health.score,
        detail: person.health.detail,
      }));

  const apologyLeader = toxicity.apologiesLeader?.name && toxicity.apologiesLeader.name !== "None clearly identified"
    ? toxicity.apologiesLeader
    : (personA.health.apologyCount >= personB.health.apologyCount
        ? { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext }
        : { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext });
  const apologyOther = toxicity.apologiesOther?.name && toxicity.apologiesOther.name !== "None clearly identified"
    ? toxicity.apologiesOther
    : (apologyLeader.name === personA.name
        ? { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext }
        : { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext });

  return attachReportMeta({
    chatHealthScore: toxicity.chatHealthScore,
    healthScores,
    apologiesLeader: apologyLeader,
    apologiesOther: apologyOther,
    redFlagMoments: toxicity.redFlagMoments,
    conflictPattern: toxicity.conflictPattern,
    powerBalance: toxicity.powerBalance,
    powerHolder: toxicity.powerHolder,
    verdict: toxicity.verdict,
    whatStillHere: toxicity.whatStillHere,
    heavyAttributionQuote: toxicity.heavyAttributionQuote,
    apologyGuessThreshold: toxicity.apologyGuessThreshold ?? false,
    powerGuessThreshold: toxicity.powerGuessThreshold ?? false,
  }, relationshipType, core);
}

export function deriveLoveLangReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  const careAttribution = shared.memorableMoments?.find(m => m.type === "care" || m.type === "sweet") ?? null;
  return attachReportMeta({
    personA: {
      name: personA.name,
      language: personA.careStyle.language,
      languageEmoji: personA.careStyle.languageEmoji,
      examples: personA.careStyle.examples,
      score: personA.careStyle.score,
    },
    personB: {
      name: personB.name,
      language: personB.careStyle.language,
      languageEmoji: personB.careStyle.languageEmoji,
      examples: personB.careStyle.examples,
      score: personB.careStyle.score,
    },
    mismatch: shared.loveLanguageMismatch,
    mostLovingMoment: shared.mostLovingMoment,
    mostLovingMomentAttribution: careAttribution,
    compatibilityScore: shared.compatibilityScore,
    compatibilityRead: shared.compatibilityRead,
    loveLanguageIntro: shared.loveLanguageIntro,
    loveMiss: shared.loveMiss,
    loveMissUnspoken: shared.loveMissUnspoken,
    loveLanguageGuessValid: shared.guessThresholds?.loveLanguageGuessValid ?? false,
  }, relationshipType, core);
}

export function deriveGrowthReportFromCore(core, math, relationshipType) {
  const growth = core?.shared?.growth || {};
  const names = math?.names || [];
  return attachReportMeta({
    thenDepth: growth.thenDepth,
    nowDepth: growth.nowDepth,
    depthChange: growth.depthChange,
    whoChangedMore: growth.whoChangedMore,
    whoChangedHow: growth.whoChangedHow,
    topicsAppeared: growth.topicsAppeared,
    topicsDisappeared: growth.topicsDisappeared,
    trajectory: growth.trajectory,
    trajectoryDetail: growth.trajectoryDetail,
    arcSummary: growth.arcSummary,
    personAArc: growth.personAArc,
    personBArc: growth.personBArc,
    personAName: names[0] || "",
    personBName: names[1] || "",
    turningPoint: growth.turningPoint,
    messageAtTurningPoint: growth.messageAtTurningPoint,
    growthGuessThreshold: growth.growthGuessThreshold ?? false,
  }, relationshipType, core);
}

export function deriveAccountaReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const accountability = core?.shared?.accountability || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      total: personA.accountability.total,
      kept: personA.accountability.kept,
      broken: personA.accountability.broken,
      score: personA.accountability.score,
      detail: personA.accountability.detail,
    },
    personB: {
      name: personB.name,
      total: personB.accountability.total,
      kept: personB.accountability.kept,
      broken: personB.accountability.broken,
      score: personB.accountability.score,
      detail: personB.accountability.detail,
    },
    notableBroken: accountability.notableBroken,
    notableKept: accountability.notableKept,
    comparison: accountability.comparison,
    followThroughPattern: accountability.followThroughPattern,
    evidenceQuality: accountability.evidenceQuality,
    overallVerdict: accountability.overallVerdict,
    reliabilityArc: accountability.reliabilityArc,
    promiseThatMattered: accountability.promiseThatMattered,
    promiseGuessThreshold: accountability.promiseGuessThreshold ?? false,
  }, relationshipType, core);
}

function hasMeaningfulString(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "—" && text !== "..." && text !== "…");
}

function countMeaningfulStrings(values) {
  return values.filter(hasMeaningfulString).length;
}

export function hasMeaningfulAnalysisResult(type, result) {
  if (!result || typeof result !== "object") return false;

  switch (type) {
    case "general":
      return countMeaningfulStrings([
        result.vibeOneLiner,
        result.biggestTopic,
        result.ghostContext,
        result.funniestReason,
        result.dramaContext,
        result.relationshipSummary,
        result.groupDynamic,
        result.tensionMoment,
        result.sweetMoment,
      ]) >= 3;
    case "toxicity":
      return countMeaningfulStrings([
        result.verdict,
        result.conflictPattern,
        result.powerBalance,
        result.apologiesLeader?.context,
        result.apologiesOther?.context,
        ...(result.redFlagMoments || []).flatMap(item => [item?.description, item?.quote]),
        ...(result.healthScores || []).map(item => item?.detail),
      ]) >= 3;
    case "lovelang":
      return countMeaningfulStrings([
        result.personA?.examples,
        result.personB?.examples,
        result.mismatch,
        result.mostLovingMoment,
        result.compatibilityRead,
      ]) >= 2;
    case "growth":
      return countMeaningfulStrings([
        result.thenDepth,
        result.nowDepth,
        result.whoChangedHow,
        result.topicsAppeared,
        result.topicsDisappeared,
        result.trajectoryDetail,
        result.arcSummary,
      ]) >= 3;
    case "accounta":
      return countMeaningfulStrings([
        result.personA?.detail,
        result.personB?.detail,
        result.notableBroken?.promise,
        result.notableKept?.promise,
        result.comparison,
        result.followThroughPattern,
        result.evidenceQuality,
        result.overallVerdict,
      ]) >= 2;
    case "energy":
      return countMeaningfulStrings([
        result.personA?.goodNews,
        result.personA?.venting,
        result.personB?.goodNews,
        result.personB?.venting,
        result.mostEnergising,
        result.mostDraining,
        result.compatibility,
      ]) >= 3;
    default:
      return false;
  }
}


// Corpus for deterministic quote grounding: what the participants actually
// typed. Applied to every AI result before it reaches a screen.
function chatCorpus(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => message.body || "").join("\n");
}

function buildRecurringCast(messages, math, chatLang = "en") {
  const topicTokens = (math?.topWords || []).map(entry => (Array.isArray(entry) ? entry[0] : entry));
  return extractRecurringCast(messages, math?.names || [], { topicTokens, nounCapitalization: chatLang === "de" });
}

export async function generateCoreAnalysisA(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = math.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareCoreAnalysisARequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    candidatesText: formatCandidateMoments(extractCandidateMoments(messages)),
    recurringCast: buildRecurringCast(messages, math, chatLang),
    buildSampleText,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
  });

  if (import.meta.env.DEV) console.log("[CoreA] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callAnalysis(request.pipeline, request.payload);
  return groundResultQuotes(normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext), chatCorpus(messages));
}

export async function generateConnectionDigest(messages, math, relationshipType, chatLang = "en", options = {}) {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const energyFocus = options?.energyFocus === true;
  // The bank is built once and shared between the prompt (candidate list) and
  // the normalizer (verbatim-quote verification + single-use enforcement).
  const quoteBank = extractCandidateMoments(messages);
  const request = prepareConnectionDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    candidatesText: formatCandidateMoments(quoteBank),
    recurringCast: buildRecurringCast(messages, math, chatLang),
    buildSampleText: energyFocus ? buildEnergySampleText : buildSampleText,
    extraConnectionRules: energyFocus
      ? "ENERGY QUOTES: Choose quotes that clearly reflect the emotional tone. For positive energy examples, avoid sexual, sarcastic, awkward, or irrelevant messages."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
  });

  if (import.meta.env.DEV) console.log("[ConnectionDigest] chatLang:", chatLang, "| energyFocus:", energyFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callAnalysis(request.pipeline, request.payload);
  return groundResultQuotes(normalizeConnectionDigest(raw, math, relationshipType, relationshipContext, quoteBank), chatCorpus(messages));
}

export async function generateGrowthDigest(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareGrowthDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
  });

  if (import.meta.env.DEV) console.log("[GrowthDigest] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callAnalysis(request.pipeline, request.payload);
  return groundResultQuotes(normalizeGrowthDigest(raw, math, relationshipType, relationshipContext), chatCorpus(messages));
}

export async function generateCoreAnalysisB(messages, math, relationshipType, chatLang = "en") {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const request = prepareCoreAnalysisBRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildSampleText,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
  });

  if (import.meta.env.DEV) console.log("[CoreB] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callAnalysis(request.pipeline, request.payload);
  return groundResultQuotes(normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext), chatCorpus(messages));
}

export async function generateRiskDigest(messages, math, relationshipType, chatLang = "en", options = {}) {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const accountabilityFocus = options?.accountabilityFocus === true;
  const request = prepareRiskDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    candidatesText: formatCandidateMoments(extractCandidateMoments(messages)),
    recurringCast: buildRecurringCast(messages, math, chatLang),
    buildSampleText: accountabilityFocus ? buildAccountabilitySampleText : buildSampleText,
    extraRiskRules: accountabilityFocus
      ? "ACCOUNTABILITY FOCUS: Prioritize concrete promise, follow-through, delay, cancellation, apology, excuse, and follow-up windows. For notableBroken and notableKept, pick only meaningful commitments with clear evidence. If no strong broken promise exists, set person to \"None clearly identified\", leave promise/date/outcome plain and non-dramatic, and explain that the chat does not show a clear broken commitment. Make comparison, followThroughPattern, evidenceQuality, and overallVerdict fair to both people and honest about weak evidence."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
  });

  if (import.meta.env.DEV) console.log("[RiskDigest] chatLang:", chatLang, "| accountabilityFocus:", accountabilityFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callAnalysis(request.pipeline, request.payload);
  return groundResultQuotes(normalizeRiskDigest(raw, math, relationshipType, relationshipContext), chatCorpus(messages));
}

export async function generateTrialDigest(messages, math, relType) {
  // Cap to 80 messages (evenly spread) to keep token cost minimal.
  const capped = messages.length <= 80
    ? messages
    : Array.from({ length: 80 }, (_, i) => messages[Math.floor(i * messages.length / 80)]);
  const raw = await callAnalysis("trial", {
    sampleText: buildSampleText(capped),
    namesLabel: (math?.names || []).filter(Boolean).join(" and ") || "the participants",
    relationshipType: relType || "friends",
  });
  return groundResultQuotes(deriveTrialReport(raw, math, relType), chatCorpus(messages));
}

export async function aiAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGeneralReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export async function aiToxicityAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveToxicityReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI toxicity failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export async function aiLoveLangAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveLoveLangReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI love language failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export async function aiGrowthAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateGrowthDigest(messages, math, relationshipType);
    return deriveGrowthReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI growth failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export async function aiAccountaAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveAccountaReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI accountability failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export async function aiEnergyAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveEnergyReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI energy failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

export function getAnalysisFamilyCacheKey(math, relationshipType, family = "core", chatLang = "en") {
  return [
    `core-cache-v${CORE_ANALYSIS_CACHE_VERSION}`,
    family || "core",
    math?.isGroup ? "group" : "duo",
    relationshipType || "none",
    chatLang || "en",
    math?.totalMessages || 0,
    ...(math?.names || []),
  ].join("::");
}

export const REPORT_PIPELINES = {
  general:      { strategy: "family", family: "connection", derive: deriveGeneralReportFromCore },
  toxicity:     { strategy: "family", family: "risk",       derive: deriveToxicityReportFromCore },
  lovelang:     { strategy: "family", family: "connection", derive: deriveLoveLangReportFromCore },
  growth:       { strategy: "family", family: "growth",     derive: deriveGrowthReportFromCore },
  accounta:     { strategy: "family", family: "risk",       derive: deriveAccountaReportFromCore },
  energy:       { strategy: "family", family: "connection", derive: deriveEnergyReportFromCore },
  trial_report: { strategy: "trial" },
};

export const STORED_RESULT_META_KEYS = new Set(["translations", "displayLanguage", "sourceLanguage", "analysisCacheVersion"]);

export const REPORT_TRANSLATION_FIELDS = {
  general: [
    "vibeOneLiner",
    "biggestTopic",
    "ghostContext",
    "funniestReason",
    "dramaContext",
    "relationshipStatus",
    "relationshipStatusWhy",
    "statusEvidence",
    "toxicReason",
    "toxicityReport",
    "relationshipSummary",
    "groupDynamic",
    "tensionMoment",
    "sweetMoment",
    "mostMissed",
    "insideJoke",
    "hypePersonReason",
  ],
  toxicity: [
    "apologiesLeader.context",
    "apologiesOther.context",
    "conflictPattern",
    "powerBalance",
    "verdict",
  ],
  lovelang: [
    "personA.examples",
    "personB.examples",
    "mismatch",
    "mostLovingMoment",
    "compatibilityRead",
  ],
  growth: [
    "thenDepth",
    "nowDepth",
    "whoChangedHow",
    "topicsAppeared",
    "topicsDisappeared",
    "trajectoryDetail",
    "arcSummary",
  ],
  accounta: [
    "personA.detail",
    "personB.detail",
    "notableBroken.promise",
    "notableBroken.outcome",
    "notableKept.promise",
    "notableKept.outcome",
    "comparison",
    "followThroughPattern",
    "evidenceQuality",
    "overallVerdict",
  ],
  energy: [
    "personA.goodNews",
    "personA.venting",
    "personB.goodNews",
    "personB.venting",
    "mostEnergising",
    "mostDraining",
    "compatibility",
  ],
};

export const REPORT_TRANSLATION_ARRAY_FIELDS = {
  general: [
    { path: "redFlags", fields: ["title", "detail", "evidence"] },
    { path: "evidenceTimeline", fields: ["title", "detail"] },
  ],
  toxicity: [
    { path: "healthScores", fields: ["detail"] },
    { path: "redFlagMoments", fields: ["description"] },
  ],
};

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function stripStoredResultMeta(result) {
  if (!isPlainObject(result)) return {};
  const next = {};
  Object.entries(result).forEach(([key, value]) => {
    if (!STORED_RESULT_META_KEYS.has(key)) next[key] = value;
  });
  return next;
}

export function getStoredResultTranslations(result) {
  return isPlainObject(result?.translations) ? result.translations : {};
}

export function getStoredResultDisplayLanguage(result) {
  const code = normalizeUiLangCode(result?.displayLanguage || result?.sourceLanguage || "en");
  return LANG_META[code] ? code : "en";
}

export function getByPath(source, path) {
  return path.split(".").reduce((acc, part) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(part)) return acc[Number(part)];
    return acc[part];
  }, source);
}

export function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isLeaf = i === parts.length - 1;
    const key = /^\d+$/.test(part) ? Number(part) : part;

    if (isLeaf) {
      cursor[key] = value;
      return target;
    }

    const nextIsIndex = /^\d+$/.test(nextPart || "");
    if (cursor[key] == null) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key];
  }
  return target;
}

export function mergeTranslatedResult(base, overlay) {
  if (overlay == null) return base;
  if (typeof overlay !== "object") return overlay;

  if (Array.isArray(overlay)) {
    const source = Array.isArray(base) ? [...base] : [];
    overlay.forEach((item, index) => {
      source[index] = mergeTranslatedResult(source[index], item);
    });
    return source;
  }

  const source = isPlainObject(base) ? { ...base } : {};
  Object.entries(overlay).forEach(([key, value]) => {
    source[key] = mergeTranslatedResult(source[key], value);
  });
  return source;
}

export function buildStoredResultData(baseResult, displayLanguage = "en", translationOverlay = null, sourceLanguage = "en") {
  const canonical = stripStoredResultMeta(baseResult);
  const lang = normalizeUiLangCode(displayLanguage);
  const sourceLang = normalizeUiLangCode(sourceLanguage);
  const translations = {};
  if (lang !== "en" && isPlainObject(translationOverlay) && Object.keys(translationOverlay).length) {
    translations[lang] = translationOverlay;
  }
  return {
    ...canonical,
    sourceLanguage: sourceLang,
    displayLanguage: lang,
    analysisCacheVersion: CORE_ANALYSIS_CACHE_VERSION,
    translations,
  };
}

export function getDisplayResultData(result, preferredLanguage = null) {
  const canonical = stripStoredResultMeta(result);
  const translations = getStoredResultTranslations(result);
  const lang = normalizeUiLangCode(preferredLanguage || getStoredResultDisplayLanguage(result));
  const overlay = isPlainObject(translations[lang]) ? translations[lang] : null;
  return {
    ...mergeTranslatedResult(canonical, overlay),
    sourceLanguage: normalizeUiLangCode(result?.sourceLanguage || "en"),
    displayLanguage: overlay ? lang : normalizeUiLangCode(result?.sourceLanguage || "en"),
    translations,
  };
}

function pushTranslationEntry(entries, path, value) {
  const text = strOr(value);
  if (!text) return;
  entries.push({ path, text });
}

function collectResultTranslationEntries(reportType, result) {
  const canonical = stripStoredResultMeta(result);
  const entries = [];

  (REPORT_TRANSLATION_FIELDS[reportType] || []).forEach(path => {
    pushTranslationEntry(entries, path, getByPath(canonical, path));
  });

  (REPORT_TRANSLATION_ARRAY_FIELDS[reportType] || []).forEach(({ path, fields }) => {
    const list = getByPath(canonical, path);
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      fields.forEach(field => pushTranslationEntry(entries, `${path}.${index}.${field}`, item?.[field]));
    });
  });

  return entries;
}

function normalizeTranslatedEntries(raw, sourceEntries) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const fallbackByPath = Object.fromEntries(sourceEntries.map(item => [item.path, item.text]));
  return items.map(item => {
    const path = strOr(item?.path);
    if (!path || !(path in fallbackByPath)) return null;
    const text = strOr(item?.text, fallbackByPath[path]);
    return { path, text };
  }).filter(Boolean);
}

function buildTranslationOverlay(entries) {
  return entries.reduce((overlay, item) => setByPath(overlay, item.path, item.text), {});
}

export async function translateResultOverlay(reportType, result, targetLang = "en") {
  const lang = normalizeUiLangCode(targetLang);
  if (!LANG_META[lang] || lang === "en") return null;

  const sourceEntries = collectResultTranslationEntries(reportType, result);
  if (!sourceEntries.length) return null;

  const raw = await callAnalysis("translation", { targetLang: lang, sourceEntries });
  const translatedEntries = normalizeTranslatedEntries(raw, sourceEntries);
  if (!translatedEntries.length) return null;
  return buildTranslationOverlay(translatedEntries);
}

