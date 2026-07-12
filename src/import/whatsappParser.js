import { MIN_MESSAGES } from "./normalizedSchema.js";

const INVISIBLE_CHAR_RE = /[\u200e\u200f\u202a-\u202e\ufeff\u2066-\u2069]/g;
const DIRECTION_MARK_RE = /[\u200e\u200f]/;
const LINE_BREAK_RE = /\r\n?/g;
// Phrases that identify a system message wherever they appear. Only phrases
// that cannot plausibly occur in real conversation belong here — bare words
// like "added", "removed", and "left" used to live in this list and silently
// deleted real messages ("I left work early", "she added me on insta").
const SYSTEM_MESSAGE_RE = /end-to-end encrypted|end-to-end şifreli|uçtan uca şifreli|security code|created group|created this group|changed this group's icon|changed the group description|joined using this group's invite link|you deleted this message|this message was deleted/i;
// Group-membership events ("Alice added Bob", "Bob left"). In iOS exports
// these can appear colon-attributed to the group name, so they parse like real
// messages — but WhatsApp prefixes system/media lines with a Unicode direction
// mark that real typed messages almost never carry. These words are only
// treated as system content when that mark was present on the raw line.
const GROUP_EVENT_RE = /\b(added|removed|left|joined|changed the subject|created|pinned a message)\b/i;
// Continuation lines that start with a date-time stamp are system lines
// (encryption notices, membership events, call logs) in every locale — real
// multi-line message content does not begin with a full export timestamp.
const DATED_SYSTEM_LINE_RE = /^\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s*\d{1,2}:\d{2}/;

const HEADER_PATTERNS = [
  {
    id: "ios",
    re: /^\[(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\]\s([^:]+?):\s?(.*)$/,
  },
  {
    id: "android",
    re: /^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\s[-–—]\s([^:]+?):\s?(.*)$/,
  },
];

function getHeaderPattern(lines) {
  for (const line of lines) {
    for (const pattern of HEADER_PATTERNS) {
      if (pattern.re.test(line)) return pattern;
    }
  }
  return null;
}

function inferDateOrder(lines, pattern) {
  const counts = { dayFirst: 0, monthFirst: 0, yearFirst: 0 };

  for (const line of lines.slice(0, 80)) {
    const match = line.match(pattern.re);
    if (!match) continue;

    const parts = match[1].split(/[./-]/).map(part => part.trim());
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) {
      counts.yearFirst += 1;
      continue;
    }

    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > 12 && b <= 12) counts.dayFirst += 1;
    if (b > 12 && a <= 12) counts.monthFirst += 1;
  }

  if (counts.yearFirst > 0) return "year-first";
  if (counts.monthFirst > counts.dayFirst) return "month-first";
  return "day-first";
}

function normalizeYear(value) {
  return value < 100 ? 2000 + value : value;
}

function parseTimestamp(dateToken, timeToken, dateOrder) {
  const parts = dateToken.split(/[./-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;

  let day;
  let month;
  let year;

  if (dateOrder === "year-first") {
    year = parts[0];
    month = parts[1];
    day = parts[2];
  } else if (dateOrder === "month-first") {
    month = parts[0];
    day = parts[1];
    year = parts[2];
  } else {
    day = parts[0];
    month = parts[1];
    year = parts[2];
  }

  year = normalizeYear(year);

  const timeMatch = String(timeToken || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?$/);
  if (!timeMatch) return null;

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] || 0);
  const meridiem = timeMatch[4]?.replace(/\./g, "").toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  const timestamp = new Date(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(timestamp.getTime())) return null;
  if (
    timestamp.getFullYear() !== year ||
    timestamp.getMonth() !== month - 1 ||
    timestamp.getDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function normalizeBody(text) {
  const body = String(text || "").trim();
  if (/audio omitted|voice omitted|\.(opus|aac|m4a)$/i.test(body)) return "<Voice omitted>";
  if (/^<attached:.*>$/.test(body) || /\.(jpg|jpeg|png|mp4|pdf|webp|heic|mov)$/i.test(body)) return "<Media omitted>";
  return body;
}

function flattenBodyForAnalysis(text) {
  return String(text || "").replace(/\s*\n+\s*/g, " ").trim();
}

export function parseWhatsAppExport(text) {
  const rawLines = String(text || "").replace(LINE_BREAK_RE, "\n").split("\n");
  // Track WhatsApp's direction marks per raw line before stripping them —
  // their presence is the only reliable signal separating iOS system/media
  // lines from real typed messages.
  const lines = rawLines.map(raw => ({
    text: raw.replace(INVISIBLE_CHAR_RE, ""),
    hadDirectionMark: DIRECTION_MARK_RE.test(raw),
  }));
  const pattern = getHeaderPattern(lines.map(line => line.text));

  if (!pattern) {
    return {
      participants: [],
      messages: [],
      metadata: { messageCount: 0, dateRange: [null, null], format: null },
      formatDetected: false,
      tooShort: false,
    };
  }

  const dateOrder = inferDateOrder(lines.map(line => line.text), pattern);
  const joined = [];

  for (const line of lines) {
    if (pattern.re.test(line.text)) {
      joined.push({
        head: line.text,
        continuation: "",
        hadDirectionMark: line.hadDirectionMark,
      });
    } else if (joined.length > 0) {
      const trimmed = line.text.trimEnd();
      if (!trimmed) continue;
      // Dated non-header lines are system lines (membership events, call
      // logs, encryption notices) — dropping them here keeps them from being
      // glued onto the previous real message.
      if (DATED_SYSTEM_LINE_RE.test(trimmed)) continue;
      const last = joined[joined.length - 1];
      last.continuation += last.continuation ? `\n${trimmed}` : trimmed;
      last.hadDirectionMark = last.hadDirectionMark || line.hadDirectionMark;
    }
  }

  const participants = [];
  const seenParticipants = new Set();
  const messages = [];

  for (const entry of joined) {
    // Match against the header line only — the previous implementation
    // matched against the joined multi-line string, which the un-flagged `$`
    // anchor can never match, so every multi-line message was dropped.
    const match = entry.head.match(pattern.re);
    if (!match) continue;

    const timestamp = parseTimestamp(match[1], match[2], dateOrder);
    const sender = String(match[3] || "").trim();
    const rawBody = entry.continuation ? `${match[4]}\n${entry.continuation}` : match[4];
    const textBody = normalizeBody(rawBody);

    if (!timestamp || !sender || !textBody) continue;
    if (SYSTEM_MESSAGE_RE.test(sender) || SYSTEM_MESSAGE_RE.test(textBody)) continue;
    if (entry.hadDirectionMark && GROUP_EVENT_RE.test(textBody)) continue;

    if (!seenParticipants.has(sender)) {
      seenParticipants.add(sender);
      participants.push(sender);
    }

    messages.push({
      sender,
      text: textBody,
      timestamp,
    });
  }

  const first = messages[0]?.timestamp || null;
  const last = messages[messages.length - 1]?.timestamp || null;

  return {
    participants,
    messages,
    metadata: {
      messageCount: messages.length,
      dateRange: [first, last],
      format: pattern.id,
      dateOrder,
    },
    formatDetected: true,
    tooShort: messages.length < MIN_MESSAGES,
  };
}

export function toAnalysisMessages(parsed) {
  return (parsed?.messages || []).map(message => {
    const timestamp = new Date(message.timestamp);
    return {
      name: message.sender,
      body: flattenBodyForAnalysis(message.text),
      date: timestamp,
      hour: timestamp.getHours(),
      month: timestamp.getMonth(),
      year: timestamp.getFullYear(),
    };
  });
}
