export const IMPORT_FORMATS = Object.freeze({
  WHATSAPP_TEXT: "whatsapp_text",
  TELEGRAM_JSON: "telegram_json",
  INSTAGRAM_JSON: "instagram_json",
  INSTAGRAM_HTML: "instagram_html",
  UNKNOWN_JSON: "unknown_json",
  UNKNOWN_HTML: "unknown_html",
  UNKNOWN_TEXT: "unknown_text",
});

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function isZipFile(file) {
  return /\.zip$/i.test(file?.name || "") || file?.type === "application/zip" || file?.type === "application/x-zip-compressed";
}

export function isTextFile(file) {
  return /\.txt$/i.test(file?.name || "") || file?.type === "text/plain";
}

export function isJsonFile(file) {
  return /\.json$/i.test(file?.name || "") || /(?:^|\/)json$/i.test(file?.type || "") || file?.type === "application/json";
}

export function isHtmlFile(file) {
  return /\.(html|htm)$/i.test(file?.name || "") || file?.type === "text/html";
}

export function scoreArchiveEntry(entry) {
  const name = entry.name.toLowerCase();
  let score = entry._data?.uncompressedSize || 0;
  if (name.includes("whatsapp chat")) score += 1_000_000;
  if (/\.(txt|json|html?)$/i.test(name)) score += 200_000;
  if (!name.includes("/")) score += 100_000;
  if (name.startsWith("__macosx/")) score -= 1_000_000;
  return score;
}

export function pickBestImportEntry(zip) {
  return Object.values(zip.files)
    .filter(entry => !entry.dir && /\.(txt|json|html?)$/i.test(entry.name) && !entry.name.startsWith("__MACOSX/"))
    .sort((a, b) => scoreArchiveEntry(b) - scoreArchiveEntry(a))[0] || null;
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsonLooksLikeTelegram(value) {
  const root = value && typeof value === "object" ? value : null;
  if (!root) return false;
  const messages = Array.isArray(root.messages) ? root.messages : [];
  if (!messages.length) return false;
  return messages.some(message =>
    message &&
    typeof message === "object" &&
    ("from" in message || "from_id" in message || "date" in message) &&
    ("text" in message || "text_entities" in message)
  );
}

function jsonLooksLikeInstagram(value) {
  const root = value && typeof value === "object" ? value : null;
  if (!root) return false;
  const messages = Array.isArray(root.messages) ? root.messages : [];
  if (!messages.length) return false;
  return messages.some(message =>
    message &&
    typeof message === "object" &&
    ("sender_name" in message || "timestamp_ms" in message) &&
    ("content" in message || "share" in message || "photos" in message || "videos" in message)
  );
}

function htmlLooksLikeInstagram(text) {
  const sample = String(text || "").slice(0, 100_000).toLowerCase();
  return sample.includes("instagram") || sample.includes("messages/inbox") || sample.includes("sender_name");
}

export function detectImportFormat({ file, text = "" } = {}) {
  if (isTextFile(file)) {
    return { id: IMPORT_FORMATS.WHATSAPP_TEXT, platform: "whatsapp", sourceFormat: "txt", parserId: "whatsapp:text" };
  }

  if (isJsonFile(file)) {
    const json = safeParseJson(text);
    if (jsonLooksLikeTelegram(json)) {
      return { id: IMPORT_FORMATS.TELEGRAM_JSON, platform: "telegram", sourceFormat: "json", parserId: "telegram:json" };
    }
    if (jsonLooksLikeInstagram(json)) {
      return { id: IMPORT_FORMATS.INSTAGRAM_JSON, platform: "instagram", sourceFormat: "json", parserId: "instagram:json" };
    }
    return { id: IMPORT_FORMATS.UNKNOWN_JSON, platform: "unknown", sourceFormat: "json", parserId: "unknown:json" };
  }

  if (isHtmlFile(file)) {
    if (htmlLooksLikeInstagram(text)) {
      return { id: IMPORT_FORMATS.INSTAGRAM_HTML, platform: "instagram", sourceFormat: "html", parserId: "instagram:html" };
    }
    return { id: IMPORT_FORMATS.UNKNOWN_HTML, platform: "unknown", sourceFormat: "html", parserId: "unknown:html" };
  }

  return { id: IMPORT_FORMATS.UNKNOWN_TEXT, platform: "unknown", sourceFormat: "unknown", parserId: "unknown" };
}
