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
import { buildTrialPrompt, deriveTrialReport } from "../trialReport";
import { normalizeUiLangCode, LANG_META } from "../i18n/translations";
import { callClaude, callClaudeRawText, userFacingAnalysisError } from "./claudeClient";
import {
  buildRelationshipLine, resolveRelationshipContext, normalizeRedFlags, normalizeTimeline,
  normalizeMemorableMoments, LOCAL_STATS_VERSION,
  CONTROL_RE, AGGRO_RE, BREAKUP_RE, APOLOGY_RE, ROMANCE_RE, DATE_RE, FLIRTY_EMOJI_RE,
  SUPPORT_RE, GRATITUDE_RE, DISTRESS_RE, HEART_REPLY_RE,
  isLaughReaction, coerceRelationshipCategory, coerceRelationshipSpecificLabel, sanitizeRelationshipStatus,
} from "./localMath";

// ─────────────────────────────────────────────────────────────────
// EVENT-BASED SAMPLING PIPELINE
// ─────────────────────────────────────────────────────────────────

export const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Format a single message line — timestamp always includes speaker name
export function formatMessageLine(m) {
  const d  = m.date;
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `[${ts}] ${m.name}: ${m.body}`;
}

// Flat formatter kept for growth analysis early/late contiguous slices
export function formatForAI(messages) {
  return messages.map(formatMessageLine).join("\n");
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

    // Laugh-trigger: this message caused a laugh reaction from a DIFFERENT speaker
    // in the next 1–3 messages. Preserving these windows (with their tail) lets
    // Claude see exactly whose line made someone laugh — not just what sounds funny.
    for (let j = i + 1; j <= Math.min(i + 4, messages.length - 1); j++) {
      const reactionBody = messages[j].body || "";
      if (messages[j].name !== msg.name && isLaughReaction(reactionBody)) {
        const isHardLaugh = /\b[ŞSKDGJFHBNMZXCVWQÇÖÜİ]{4,}\b/.test(reactionBody) || /😂.*😂|🤣|💀/i.test(reactionBody);
        const boost = isHardLaugh ? 9 : 6;
        score += boost;
        tags.push(isHardLaugh ? "laugh-trigger-hard" : "laugh-trigger");
        break;
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

// Build the ordered list of [startIdx, endIdx, tags[]] windows to send to Claude.
//
// Two-pass strategy:
//   1. Event windows  — anchor on high-scoring messages, include enough surrounding
//      context that speaker direction and laugh reactions are unambiguous.
//   2. Timeline fill  — add short baseline windows for time buckets not yet covered,
//      so Claude always sees something from every major period of the chat.
function buildChunks(messages) {
  if (!messages.length) return [];

  const CONTEXT_BEFORE      = 4;   // lines before each event center
  const CONTEXT_AFTER       = 5;   // lines after event center (default)
  const CONTEXT_AFTER_LAUGH = 8;   // extended tail for laugh-trigger windows
                                   //   — captures the reaction(s) that follow the funny line
  const CONTEXT_AFTER_CARE  = 7;   // keep the support response and the gratitude / reaction after it
  const EVENT_SCORE_MIN     = 4;   // minimum score to qualify as an event center
  const MAX_EVENT_WINDOWS   = 55;  // hard cap on event-based windows
  const TIMELINE_BUCKETS    = 28;  // time segments for baseline coverage
  const LINES_PER_BUCKET    = 5;   // messages per uncovered timeline window
  const MSG_LINE_LIMIT      = 1400; // hard cap on total message lines (headers not counted)

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

  // ── Pass 2: timeline fill ──
  // Divide the chat's time span into equal buckets.  Any bucket with no event
  // coverage gets a short window centred on its midpoint message.
  const firstTs = messages[0].date.getTime();
  const lastTs  = messages[n - 1].date.getTime();
  const span    = Math.max(lastTs - firstTs, 1);

  const mergedEvents = mergeIntervals(eventWindows);
  const coveredSet   = new Set();
  mergedEvents.forEach(([s, e]) => { for (let k = s; k <= e; k++) coveredSet.add(k); });

  const timelineWindows = [];
  for (let b = 0; b < TIMELINE_BUCKETS; b++) {
    const lo = firstTs + (b / TIMELINE_BUCKETS) * span;
    const hi = firstTs + ((b + 1) / TIMELINE_BUCKETS) * span;
    const bucket = [];
    for (let i = 0; i < n; i++) {
      const ts = messages[i].date.getTime();
      if (ts >= lo && ts < hi) bucket.push(i);
    }
    if (!bucket.length || bucket.some(i => coveredSet.has(i))) continue;
    const center = bucket[Math.floor(bucket.length / 2)];
    timelineWindows.push([
      Math.max(0, center - 2),
      Math.min(n - 1, center + LINES_PER_BUCKET - 1),
      ["timeline"],
    ]);
  }

  // ── Merge, sort, enforce line budget ──
  const all = mergeIntervals([...eventWindows, ...timelineWindows])
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

// Main entry point — replaces the old smartSample(messages,N) + formatForAI(sample) pair.
// Short chats (≤600 messages) are delivered in full as a single window.
export function buildSampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildChunks(messages));
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
  const MSG_LINE_LIMIT = 1400;
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

  const baseline = buildChunks(messages);
  const mergedEnergy = mergeIntervals(windows);
  const covered = new Set();
  mergedEnergy.forEach(([start, end]) => {
    for (let i = start; i <= end; i += 1) covered.add(i);
  });

  let lines = 0;
  const selected = [];
  for (const chunk of mergedEnergy) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  const baselineFill = baseline.filter(([start, end]) => {
    for (let i = start; i <= end; i += 1) {
      if (covered.has(i)) return false;
    }
    return true;
  });
  for (const chunk of baselineFill) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) break;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

export function buildEnergySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildEnergyChunks(messages));
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
  const MSG_LINE_LIMIT = 1400;
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

  const baseline = buildChunks(messages);
  const focused = mergeIntervals(windows);
  const covered = new Set();
  focused.forEach(([start, end]) => {
    for (let i = start; i <= end; i += 1) covered.add(i);
  });

  let lines = 0;
  const selected = [];
  for (const chunk of focused) {
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) continue;
    selected.push(chunk);
    lines += size;
  }

  for (const chunk of baseline) {
    const overlapsFocused = (() => {
      for (let i = chunk[0]; i <= chunk[1]; i += 1) {
        if (covered.has(i)) return true;
      }
      return false;
    })();
    if (overlapsFocused) continue;
    const size = chunk[1] - chunk[0] + 1;
    if (lines + size > MSG_LINE_LIMIT) break;
    selected.push(chunk);
    lines += size;
  }

  return mergeIntervals(selected).sort((a, b) => a[0] - b[0]);
}

export function buildAccountabilitySampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildAccountabilityChunks(messages));
}

export const CORE_ANALYSIS_VERSION = 2;
export const CORE_ANALYSIS_CACHE_VERSION = 6;
export const CORE_A_MAX_TOKENS = 3200;
export const CORE_B_MAX_TOKENS = 2600;
export const HOMEPAGE_VERSION = "67537";
export const HOMEPAGE_VERSION_LABEL = (_updateNotesRaw.match(/^## (v\d+\.\d+)/m) || [])[1] ?? "v?";

function relContextStr(relType) {
  const map = {
    partner:   "committed romantic partner or spouse",
    dating:    "early stage or casual romantic relationship",
    ex:        "former romantic partner — the relationship has ended",
    family:    "This is a chat between the user and a family member (parent, sibling, or relative).",
    friend:    "This is a chat between the user and a close friend.",
    colleague: "This is a chat between the user and a work colleague.",
    other:     "This is a chat between the user and someone they know.",
  };
  return relType ? (map[relType] || "") : "";
}

function buildRelationshipContextBlock(relType) {
  const relCtx = relContextStr(relType);
  return relCtx
    ? ` RELATIONSHIP CONTEXT: ${relCtx}. Frame all analysis, tone, and language accordingly. Treat the user-selected relationship category as a hard boundary. Do not label a partner dynamic as friendship or chosen family. Do not label a family dynamic as romantic. Do not label an ex dynamic as family, friendship, or current romance.`
    : "";
}

function buildLangInstruction(chatLang) {
  if (!chatLang || chatLang === "en") return "";
  const label = LANG_META[chatLang];
  if (!label) return "";
  return `\n\nOUTPUT LANGUAGE: Write all free-text fields (sentences, summaries, descriptions, examples, context, verdicts, reasons, and analysis) directly and natively in ${label}. Do NOT draft in English first and then translate, compose every sentence directly in ${label} from scratch. The JSON structure and all key names must remain exactly as specified in the schema.\n\nThe following fields are schema-critical control tokens, reproduce them EXACTLY as listed here, with zero translation:\n- "language" (careStyle): must be one of exactly: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed\n- "depthChange": must be one of exactly: deeper / shallower / about the same\n- "trajectory": must be one of exactly: closer / drifting / stable\n- "type" (energy): must be one of exactly: net positive / mixed / net draining\n- "dramaStarter": a first name as written in the chat, or exactly "Shared", or exactly "None clearly identified"\n- "toxicPerson": a first name as written in the chat, or exactly "Tie", or exactly "None clearly identified"\n- "funniestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "kindestPerson": a first name as written in the chat, or exactly "None clearly identified"\n- "whoChangedMore": a first name as written in the chat, or exactly "Both equally"\n- "powerHolder": a first name as written in the chat, or exactly "Balanced"\n- "person" in promise/apology fields: a first name as written in the chat, or exactly "None clearly identified"\n- All "name" fields: the exact first name as it appears in the chat\nDo NOT translate, paraphrase, or modify these control tokens under any circumstances. All descriptive text fields, everything else, must be written natively in ${label}.`;
}

export function buildAnalystSystemPrompt(role, relationshipType, extraRules = "", chatLang = "en", relationshipLine = "") {
  return `PRIORITY RULES: READ FIRST, OVERRIDE EVERYTHING ELSE:

1. RELATIONSHIP LABEL: ${relationshipLine || `Use the user-selected relationship type "${relationshipType}". Never override it. Cousins are not father-daughter. Friends are not partners. Use only the confirmed label, never infer relationship from tone, warmth, or emoji use.`}

2. FUNNY ATTRIBUTION, LAUGH TYPES:
   Keyboard mashes (random consonant clusters like 'skdjfhsdf', 'ŞUHAJDADGHKFD', 'fjdksj') are LAUGH REACTIONS, not jokes. They mean the person is laughing.
   UPPERCASE keyboard mashes (e.g. 'ŞUHAJDADGHKFD', 'SKDJFHDF') = extremely hard laughter.
   lowercase keyboard mashes (e.g. 'skdjfhsdf') = regular laughter.
   😂 💀 🤣 lol lmao haha 'im dead' = laugh reactions.
   The FUNNY PERSON is whoever sent the line that triggered the laugh reaction, never the person doing the laughing.
   If Aslı sends 'ŞUHAJDADGHKFD' after Ozge's message, Ozge is funny. Aslı is the audience.

3. DIRECTION OF ACTIONS: The actor is always the sender of that exact message line. Never reverse who did what to whom.

4. SIGNATURE PHRASES: signaturePhrases must be actual repeated text phrases or expressions, never emojis alone, never keyboard mashes, never laugh sounds. Only real words or short sentences that a person uses repeatedly.

5. DRAMA SCOPE: dramaStarter and dramaContext must consider ALL drama in the chat, not just conflict between the two participants. This includes personal dramas they share with each other about third parties, work stress, relationship issues, life problems. The drama starter is whoever brings drama into the conversation most often, regardless of whether it is directed at the other person.

6. TRANSLATION: Never translate quoted messages. Reproduce all quotes exactly as written in the chat in their original language. Do not add translations in parentheses.

7. GEOGRAPHY: Never claim participants live in different cities, countries or continents unless the chat explicitly and literally states this.

8. SPECIFICITY: Prefer real names, recurring people, places, repeated situations, and actual phrasing from the chat when they make the line more recognizable.

9. CONTROLLED INTERPRETATION: You may compress clearly supported patterns into short reads like "easy flow", "awkwardness", "chaos", "natural ghosting", or "therapist mode", or similarly compact grounded tags, only when repeated or concrete evidence supports them. Never infer motives, inner states, diagnoses, or emotional certainty.

You are WrapChat, ${role}. Be specific, grounded, and evidence-led.

INTERPRETATION RULE:
You are allowed to interpret patterns when they are supported by repeated behavior, even if the chat does not explicitly name the pattern. Do not stay at surface description. Convert behavior into a short, natural insight. Keep interpretations soft and grounded, never diagnostic or absolute.

PUNCTUATION:
Never use the em dash punctuation mark in any user-facing text field. Use commas, semicolons, periods, or natural sentence flow instead.

Reference real patterns, real phrases, and real moments from the chat instead of generic observations. Be conservative before singling out one person: if the evidence is mixed, close, or mostly based on tone, prefer balanced labels like "Tie", "Shared", "Balanced", or "None clearly identified" instead of over-assigning blame. Do not pile onto the loudest or most active person unless multiple distinct examples support it. Keep the tone honest but not cruel, mocking, or absolute. Avoid repetitive wording across fields: if two answers overlap, make them distinct in angle and concrete detail rather than repeating the same judgment. When negative and positive evidence coexist, acknowledge both. Return ONLY valid JSON with no markdown fences or explanation outside the JSON. Never embed literal newline characters inside a JSON string value, keep every string on a single line.${buildRelationshipContextBlock(relationshipType)}${extraRules ? ` ${extraRules}` : ""}${buildLangInstruction(chatLang)}`;
}

export const CORE_A_WRITING_STYLE = `WRITING STYLE:
Write like an observant friend who has read the entire chat and formed specific opinions, not an analyst, not a therapist, not a report generator.

VOICE:
- Warm, perceptive, and lightly playful
- Slightly ironic when the chat supports it, but never cruel, mocking, or judgmental
- Emotionally aware, but grounded in actual behavior
- The output should feel like "you were already thinking this, now someone said it clearly"

SPECIFICITY:
- Use real names, recurring topics, repeated situations, places, timing patterns, or short exact quotes when possible
- Avoid generic statements that could apply to any random chat
- Every insight should feel like it belongs only to this chat

PATTERN FOCUS:
- Do not only summarize what happened
- Identify the recurring pattern, role, or dynamic behind the behavior
- Assign soft roles when clearly supported, such as "the planner", "the therapist friend", "the chaos-bringer", "the one who disappears", "the emotional translator"
- Do not force roles if evidence is weak

COINED MICRO-PHRASES:
- When natural, compress a pattern into a short memorable phrase
- Examples: "natural ghosting", "friendship dependency", "low-effort check-ins", "emotional admin", "accidental disappearing act"
- Do not overdo this. Use it only when it makes the insight sharper

STRUCTURE:
Each free-text insight should usually follow:
specific observation + recurring pattern or concrete moment + short interpretation

Good examples:
- "Maya keeps bringing the chaos, and Alex keeps translating it into something manageable, very therapist-friend energy."
- "The slow replies are not pure ghosting, they feel more like timing chaos, one person is mid-crisis while the other arrives six hours later."
- "Their sweetest moments are not dramatic speeches, they are tiny check-ins that say, 'I know your life, and I am still here.'"

BAD examples:
- "They have a strong connection."
- "This shows that they support each other."
- "Overall, their communication is healthy."
- "It seems like they care about each other."

TONE CONTROL:
- No therapy language
- No diagnosis
- No advice
- No moralizing
- No over-explaining
- No "this shows that", "it seems like", "overall", "in general", "the analysis suggests"
- State observations directly when supported by evidence

PUNCTUATION RULE:
- Do not use the em dash punctuation mark
- Prefer commas, semicolons, periods, or natural sentence flow
- The tone should feel like spoken thought, not polished editorial prose

COMPRESSION:
- Keep text compact but layered
- Prefer one strong sentence over two weak generic sentences
- Avoid filler and repeated ideas

ANTI-GENERIC RULE:
Before finalizing any free-text field, check whether it could fit another random chat. If yes, rewrite it with specific evidence, names, or a more precise dynamic.

ANTI-REPETITION: sweetMoment and mostLovingMoment must describe different events — sweetMoment is a specific act of care or support, mostLovingMoment is a warm affectionate exchange or emotional closeness; they must not reference the same message. tensionMoment and dramaContext must describe different events — tensionMoment is the sharpest single spike, dramaContext is the recurring pattern. vibeOneLiner and relationshipSummary must not be near-identical — vibeOneLiner captures the overall feel in one memorable line, relationshipSummary describes the ongoing dynamic in human terms. toxicityReport and groupDynamic must not paraphrase each other — groupDynamic is the social energy read, toxicityReport is the final health verdict. relationshipSummary and relationshipStatusWhy must take different angles — relationshipStatusWhy explains the label choice, relationshipSummary describes the dynamic. Each evidenceTimeline entry must reference a distinct event. No two fields across the full output should describe the same moment or quote the same line. SIGNATURE PHRASES: Before assigning a phrase to a person, verify it by checking which sender's lines it appears on. signaturePhrases[0] must be a phrase only person 1 sends, signaturePhrases[1] must be a phrase only person 2 sends, never swap or guess attribution.

MOMENT EXTRACTION:
When a field asks for a funny moment, sweet moment, tension moment, signature phrase, vibe line, or memorable example — prefer one concrete scene from the provided evidence windows over a broad summary. The shape is: what happened + exact phrase or recurring detail + short interpretation. The result should feel like a card someone would screenshot, not a report note.

QUOTE USE:
Use short exact quotes only when they make the insight more recognizable, funny, affectionate, tense, or specific. Never invent quotes. Never translate quotes. One quote per field maximum. If no quote fits naturally, write the observation without one.

DATE RULE:
For all date-bearing fields (evidenceTimeline entries, memorableMoments entries, redFlagMoments entries, notableBroken, notableKept), use approximate period descriptions only — words like 'early on', 'a few months in', 'mid-chat', 'recently', 'toward the end'. Never write a specific calendar date, month name, day number, or year.`;

export function buildCoreASystemPrompt(role, relationshipType, extraRules = "", chatLang = "en", relationshipLine = "") {
  return buildAnalystSystemPrompt(role, relationshipType, `${CORE_A_WRITING_STYLE} ${extraRules}`, chatLang, relationshipLine);
}

export function clampScore(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

export function strOr(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function cleanStringArray(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
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
      languageEmoji: strOr(care.languageEmoji, "💝"),
      examples: Array.isArray(care.examples)
        ? care.examples.filter(s => typeof s === "string" && s.trim()).map(s => s.trim()).join(". ")
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
      funniestReason: strOr(shared.funniestReason),
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
      tensionMoment: strOr(shared.tensionMoment),
      kindestPerson: strOr(shared.kindestPerson),
      sweetMoment: strOr(shared.sweetMoment),
      mostMissed: strOr(shared.mostMissed),
      insideJoke: strOr(shared.insideJoke),
      hypePersonReason: strOr(shared.hypePersonReason),
      loveLanguageMismatch: strOr(shared.loveLanguageMismatch),
      mostLovingMoment: strOr(shared.mostLovingMoment),
      compatibilityScore: clampScore(shared.compatibilityScore, 5),
      compatibilityRead: strOr(shared.compatibilityRead),
      mostEnergising: strOr(shared.mostEnergising),
      mostDraining: strOr(shared.mostDraining),
      energyCompatibility: strOr(shared.energyCompatibility),
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
      },
    },
  };
}

export function normalizeConnectionDigest(raw, math, relationshipType, relationshipContext = null) {
  const normalized = normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
  return {
    ...normalized,
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
      },
      accountability: {
        notableBroken: normalizePromiseMoment(accountability.notableBroken),
        notableKept: normalizePromiseMoment(accountability.notableKept),
        comparison: strOr(accountability.comparison),
        followThroughPattern: strOr(accountability.followThroughPattern),
        evidenceQuality: strOr(accountability.evidenceQuality),
        overallVerdict: strOr(accountability.overallVerdict),
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
  }, relationshipType, core);
}

export function deriveLoveLangReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
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
    compatibilityScore: shared.compatibilityScore,
    compatibilityRead: shared.compatibilityRead,
  }, relationshipType, core);
}

export function deriveGrowthReportFromCore(core, math, relationshipType) {
  const growth = core?.shared?.growth || {};
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
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    buildSampleText,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[CoreA] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeCoreAnalysisA(raw, math, relationshipType, relationshipContext);
}

export async function generateConnectionDigest(messages, math, relationshipType, chatLang = "en", options = {}) {
  const names = math.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipContext = !isGroup ? await resolveRelationshipContext(messages, names, relationshipType) : null;
  const energyFocus = options?.energyFocus === true;
  const request = prepareConnectionDigestRequest({
    messages,
    math,
    relationshipType,
    chatLang,
    relationshipContext,
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    buildSampleText: energyFocus ? buildEnergySampleText : buildSampleText,
    extraConnectionRules: energyFocus
      ? "ENERGY QUOTES: Choose quotes that clearly reflect the emotional tone. For positive energy examples, avoid sexual, sarcastic, awkward, or irrelevant messages."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[ConnectionDigest] chatLang:", chatLang, "| energyFocus:", energyFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeConnectionDigest(raw, math, relationshipType, relationshipContext);
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
    buildAnalystSystemPrompt: buildCoreASystemPrompt,
    buildRelationshipLine,
    formatForAI,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_A_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[GrowthDigest] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeGrowthDigest(raw, math, relationshipType, relationshipContext);
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
    buildAnalystSystemPrompt,
    buildRelationshipLine,
    buildSampleText,
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_B_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[CoreB] chatLang:", chatLang, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeCoreAnalysisB(raw, math, relationshipType, relationshipContext);
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
    buildAnalystSystemPrompt,
    buildRelationshipLine,
    buildSampleText: accountabilityFocus ? buildAccountabilitySampleText : buildSampleText,
    extraRiskRules: accountabilityFocus
      ? "ACCOUNTABILITY FOCUS: Prioritize concrete promise, follow-through, delay, cancellation, apology, excuse, and follow-up windows. For notableBroken and notableKept, pick only meaningful commitments with clear evidence. If no strong broken promise exists, set person to \"None clearly identified\", leave promise/date/outcome plain and non-dramatic, and explain that the chat does not show a clear broken commitment. Make comparison, followThroughPattern, evidenceQuality, and overallVerdict fair to both people and honest about weak evidence."
      : "",
    coreAnalysisVersion: CORE_ANALYSIS_VERSION,
    maxTokens: CORE_B_MAX_TOKENS,
  });

  if (import.meta.env.DEV) console.log("[RiskDigest] chatLang:", chatLang, "| accountabilityFocus:", accountabilityFocus, "| system prompt tail:", request.systemPrompt.slice(-200));
  const raw = await callClaude(request.systemPrompt, request.userContent, request.maxTokens, request.schemaMode);
  return normalizeRiskDigest(raw, math, relationshipType, relationshipContext);
}

export async function generateTrialDigest(messages, math, relType) {
  const { system, userContent, maxTokens } = buildTrialPrompt(messages, math, relType, buildSampleText);
  const raw = await callClaude(system, userContent, maxTokens, "json");
  return deriveTrialReport(raw, math, relType);
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

  const system = [
    "You translate saved WrapChat report text into the target language.",
    "Return only valid JSON in the exact schema requested.",
    "Keep every path value mapped to the same path.",
    "Translate natural-language explanations into the target language.",
    "Preserve the original WrapChat tone: specific, natural, lightly playful, and spoken-flow.",
    "Do not make translations more formal, therapeutic, academic, or dramatic.",
    "Do not add the em dash punctuation mark.",
    "Preserve names exactly as written.",
    "If a value contains a direct quote from the chat, keep the quote itself as-is and only translate the surrounding explanation if needed.",
  ].join(" ");

  const userContent = `Target language: ${LANG_META[lang]} (${lang})

Translate the following WrapChat report text fields into ${LANG_META[lang]}. Keep every "path" exactly the same. Return exactly this JSON shape:
{
  "items": [
    { "path": "field.path", "text": "translated text" }
  ]
}

Source items:
${JSON.stringify(sourceEntries, null, 2)}`;

  const raw = await callClaude(system, userContent, 1800, "json");
  const translatedEntries = normalizeTranslatedEntries(raw, sourceEntries);
  if (!translatedEntries.length) return null;
  return buildTranslationOverlay(translatedEntries);
}

