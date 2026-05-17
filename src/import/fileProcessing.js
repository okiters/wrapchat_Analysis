import JSZip from "jszip";
import {
  detectImportFormat,
  isHtmlFile,
  isJsonFile,
  isTextFile,
  isZipFile,
  MAX_IMPORT_BYTES,
  pickBestImportEntry,
} from "./importDetector";
import { getImportAdapter } from "./adapters";

function formatParticipantLabel(participants) {
  const names = Array.isArray(participants) ? participants.filter(Boolean) : [];
  if (names.length === 0) return "this chat";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildSummary(parsed) {
  const [start, end] = parsed.metadata.dateRange || [];
  return {
    participants: parsed.participants,
    participantLabel: formatParticipantLabel(parsed.participants),
    messageCount: parsed.metadata.messageCount || 0,
    dateRange: [start || null, end || null],
    dateRangeLabel: start && end ? `${formatDate(start)} - ${formatDate(end)}` : "Date range unavailable",
  };
}

async function extractImportText(file) {
  if (isTextFile(file) || isJsonFile(file) || isHtmlFile(file)) {
    return {
      text: await file.text(),
      fileName: file?.name || null,
      file: {
        name: file?.name || "",
        type: file?.type || "",
      },
    };
  }

  if (isZipFile(file)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = pickBestImportEntry(zip);
    if (!entry) {
      throw new Error("We couldn't find a supported chat file inside that export. Try exporting again, or export without media.");
    }
    const name = entry.name || file?.name || "";
    return {
      text: await entry.async("string"),
      fileName: name,
      file: {
        name,
        type: /\.json$/i.test(name) ? "application/json" : /\.(html|htm)$/i.test(name) ? "text/html" : "text/plain",
      },
    };
  }

  throw new Error("Please share a chat export as a supported .txt, .zip, .json, or .html file.");
}

export async function processImportedChatFile(file, { onStatus } = {}) {
  if (!file) throw new Error("Choose a chat export to continue.");
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("This export is too large to open here. Try exporting a shorter date range.");
  }

  onStatus?.({ key: "opening", message: "Opening your chat..." });

  let rawText = "";
  try {
    const extracted = await extractImportText(file);
    rawText = extracted.text;
    onStatus?.({ key: "reading", message: "Reading messages..." });

    const detected = detectImportFormat({ file: extracted.file, text: rawText });
    const adapter = getImportAdapter(detected);
    if (!adapter) {
      if (detected.sourceFormat === "json") {
        throw new Error("We detected a JSON export, but this format is not supported yet. Please import a supported WhatsApp .txt export for now.");
      }
      if (detected.sourceFormat === "html") {
        throw new Error("We detected an HTML export, but this format is not supported yet. Please import a supported WhatsApp .txt export for now.");
      }
      throw new Error("We couldn't recognize that chat export format. Please import a supported WhatsApp .txt export for now.");
    }

    const parsed = adapter.parse(rawText, {
      fileName: extracted.fileName || file?.name || null,
      detected,
    });
    if (!parsed.formatDetected || !parsed.messages.length) {
      throw new Error("We couldn't read that chat. Try exporting the chat again, or export without media.");
    }

    const analysisMessages = parsed.messages;
    const summary = buildSummary(parsed);
    onStatus?.({
      key: "found",
      message: `Found ${summary.messageCount.toLocaleString()} messages with ${summary.participantLabel}.`,
    });

    return {
      parsed,
      analysisMessages,
      tooShort: parsed.tooShort,
      platform: parsed.platform,
      sourceFormat: parsed.sourceFormat,
      parserId: parsed.parserId,
      summary,
      payload: {
        platform: parsed.platform,
        sourceFormat: parsed.sourceFormat,
        parserId: parsed.parserId,
        metadata: parsed.metadata,
        messages: analysisMessages,
        tooShort: parsed.tooShort,
      },
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/corrupt|unsupported/i.test(message)) {
      throw new Error("We couldn't open that export cleanly. Try exporting the chat again without media.");
    }
    throw error;
  } finally {
    rawText = "";
  }
}
