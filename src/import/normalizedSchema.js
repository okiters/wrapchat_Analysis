export const MIXED_IMPORT_FORMAT_ERROR =
  "These files come from different platforms or export formats. For now, WrapChat can analyze each format separately, but mixed-format merging is disabled to keep results accurate.";

export const MIN_MESSAGES = 50;

export const IMPORT_ACCEPT_TYPES = ".txt,.zip,.json,.html,.htm,text/plain,application/zip,application/json,text/html";

export function normalizeImportKind(value) {
  return String(value || "").trim().toLowerCase();
}

export function getParsedChatImportKind(parsedChat) {
  const payload = parsedChat?.payload || {};
  const parsed = parsedChat?.parsed || {};
  const metadata = parsedChat?.metadata || parsed?.metadata || payload?.metadata || {};
  const platform = normalizeImportKind(
    parsedChat?.platform ||
    payload?.platform ||
    parsed?.platform ||
    metadata?.platform ||
    "unknown"
  );
  const sourceFormat = normalizeImportKind(
    parsedChat?.sourceFormat ||
    payload?.sourceFormat ||
    parsed?.sourceFormat ||
    metadata?.sourceFormat ||
    metadata?.importFormat ||
    "unknown"
  );
  const parserId = normalizeImportKind(
    parsedChat?.parserId ||
    payload?.parserId ||
    parsed?.parserId ||
    metadata?.parserId ||
    `${platform}:${sourceFormat}`
  );

  return {
    platform,
    sourceFormat,
    parserId,
    compatibilityKey: `${platform}:${sourceFormat}:${parserId}`,
  };
}

export function validateImportCompatibility(parsedChats = []) {
  const chats = (Array.isArray(parsedChats) ? parsedChats : [parsedChats]).filter(Boolean);
  if (chats.length <= 1) return true;

  const first = getParsedChatImportKind(chats[0]);
  const incompatible = chats.some(chat => {
    const current = getParsedChatImportKind(chat);
    return current.compatibilityKey !== first.compatibilityKey;
  });

  if (incompatible) {
    throw new Error(MIXED_IMPORT_FORMAT_ERROR);
  }

  return true;
}

export function normalizeParsedChat({
  platform,
  sourceFormat,
  parserId,
  fileName = null,
  participants = [],
  messages = [],
  metadata = {},
  formatDetected = false,
  tooShort = false,
}) {
  const normalizedPlatform = normalizeImportKind(platform || "unknown");
  const normalizedSourceFormat = normalizeImportKind(sourceFormat || "unknown");
  const normalizedParserId = normalizeImportKind(parserId || `${normalizedPlatform}:${normalizedSourceFormat}`);

  return {
    platform: normalizedPlatform,
    sourceFormat: normalizedSourceFormat,
    parserId: normalizedParserId,
    fileName,
    participants: Array.isArray(participants) ? participants.filter(Boolean) : [],
    messages: Array.isArray(messages) ? messages : [],
    metadata: {
      ...metadata,
      platform: normalizedPlatform,
      sourceFormat: normalizedSourceFormat,
      parserId: normalizedParserId,
    },
    formatDetected: Boolean(formatDetected),
    tooShort: Boolean(tooShort),
  };
}

export function normalizeMessageForAnalysis(message, fallback = {}) {
  const date = message?.date instanceof Date ? new Date(message.date.getTime()) : new Date(message?.date || message?.timestamp);
  const name = String(message?.name || message?.senderDisplayName || message?.sender || "").trim();
  const body = String(message?.body || message?.text || "").trim();
  if (!name || !body || Number.isNaN(date.getTime())) return null;

  return {
    ...message,
    platform: normalizeImportKind(message?.platform || fallback.platform || "unknown"),
    sourceMessageIndex: Number.isInteger(message?.sourceMessageIndex) ? message.sourceMessageIndex : fallback.sourceMessageIndex,
    senderId: message?.senderId || null,
    senderUsername: message?.senderUsername || null,
    senderDisplayName: message?.senderDisplayName || name,
    name,
    body,
    date,
    hour: date.getHours(),
    month: date.getMonth(),
    year: date.getFullYear(),
    type: message?.type || "text",
    mediaKind: message?.mediaKind || null,
    raw: message?.raw || null,
  };
}
