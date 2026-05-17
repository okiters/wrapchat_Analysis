import { detectPossibleDuplicateContacts, normalizeDisplayName } from "../utils/identityMerge.js";
import { getParsedChatImportKind, validateImportCompatibility } from "./normalizedSchema.js";

const DATASET_VERSION = 1;

function stableHash(value) {
  const text = String(value || "");
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeMessage(message, fallbackSourceId, index) {
  const date = asDate(message?.date || message?.timestamp);
  const name = String(message?.name || message?.sender || "").trim();
  const body = String(message?.body || message?.text || "").trim();
  if (!date || !name || !body) return null;
  return {
    sourceChatId: message.sourceChatId || fallbackSourceId,
    sourceMessageIndex: Number.isInteger(message.sourceMessageIndex) ? message.sourceMessageIndex : index,
    participantId: message.participantId || null,
    senderId: message.senderId || null,
    senderUsername: message.senderUsername || null,
    senderDisplayName: message.senderDisplayName || name,
    platform: message.platform || null,
    type: message.type || "text",
    mediaKind: message.mediaKind || null,
    raw: message.raw || null,
    name,
    body,
    date,
    hour: date.getHours(),
    month: date.getMonth(),
    year: date.getFullYear(),
  };
}

function participantIdFor(sourceChatId, rawName) {
  return `p_${stableHash(`${sourceChatId}|${rawName}`)}`;
}

function sourceChatIdFor(parsedChat, index) {
  const fileName = parsedChat?.fileName || parsedChat?.importFileName || "";
  const summary = parsedChat?.summary || parsedChat?.importSummary || {};
  const payload = parsedChat?.payload || parsedChat || {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const first = messages[0]?.date || messages[0]?.timestamp || "";
  const last = messages[messages.length - 1]?.date || messages[messages.length - 1]?.timestamp || "";
  return `chat_${stableHash(`${index}|${fileName}|${messages.length}|${first}|${last}`)}`;
}

function getParsedMessages(parsedChat) {
  if (Array.isArray(parsedChat?.analysisMessages)) return parsedChat.analysisMessages;
  if (Array.isArray(parsedChat?.messages)) return parsedChat.messages;
  if (Array.isArray(parsedChat?.payload?.messages)) return parsedChat.payload.messages;
  if (Array.isArray(parsedChat?.parsed?.messages)) return parsedChat.parsed.messages;
  return [];
}

function getParsedSummary(parsedChat) {
  return parsedChat?.summary || parsedChat?.importSummary || null;
}

function createSourceChat(parsedChat, sourceChatId, index, messages) {
  const summary = getParsedSummary(parsedChat);
  const importKind = getParsedChatImportKind(parsedChat);
  const participants = Array.isArray(summary?.participants)
    ? summary.participants
    : [...new Set(messages.map(message => message.name))];
  const dates = messages.map(message => message.date).filter(Boolean).sort((a, b) => a - b);
  return {
    id: sourceChatId,
    index,
    fileName: parsedChat?.fileName || parsedChat?.importFileName || null,
    platform: importKind.platform,
    sourceFormat: importKind.sourceFormat,
    parserId: importKind.parserId,
    compatibilityKey: importKind.compatibilityKey,
    participantNames: participants,
    participantLabel: summary?.participantLabel || participants.join(", "),
    messageCount: messages.length,
    dateRange: [dates[0] || null, dates[dates.length - 1] || null],
    duplicateOf: null,
  };
}

function buildParticipants(messages) {
  const byKey = new Map();
  messages.forEach(message => {
    const key = `${message.sourceChatId}|${message.name}`;
    if (!byKey.has(key)) {
      const id = participantIdFor(message.sourceChatId, message.name);
      byKey.set(key, {
        id,
        displayName: message.name,
        rawName: message.name,
        sourceChatIds: [message.sourceChatId],
        aliases: [message.name],
        messageCount: 0,
      });
    }
    const participant = byKey.get(key);
    participant.messageCount += 1;
    message.participantId = participant.id;
  });
  return Array.from(byKey.values()).sort((a, b) => b.messageCount - a.messageCount);
}

function messageFingerprint(message) {
  const date = asDate(message.date);
  const timestamp = date ? Math.floor(date.getTime() / 1000) : "";
  const body = String(message.body || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  const name = String(message.name || "").trim().toLocaleLowerCase("en-US");
  return `${timestamp}|${name}|${body}`;
}

function dedupeMessages(messages) {
  const seen = new Map();
  const duplicates = [];
  const unique = [];
  messages.forEach(message => {
    const fingerprint = messageFingerprint(message);
    if (seen.has(fingerprint)) {
      duplicates.push({
        sourceChatId: message.sourceChatId,
        duplicateOfSourceChatId: seen.get(fingerprint).sourceChatId,
        fingerprint,
      });
      return;
    }
    seen.set(fingerprint, message);
    unique.push(message);
  });
  return { messages: unique, duplicates };
}

function sortMessagesChronologically(messages) {
  return [...messages].sort((a, b) => {
    const timeDiff = a.date - b.date;
    if (timeDiff) return timeDiff;
    return (a.sourceMessageIndex || 0) - (b.sourceMessageIndex || 0);
  });
}

function formatParticipantLabel(participants) {
  const names = participants.map(participant => participant.displayName).filter(Boolean);
  if (names.length === 0) return "this chat";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

function buildDisplayTitle(participants, sourceChatCount) {
  const base = formatParticipantLabel(participants);
  return sourceChatCount > 1 ? `${base}, combined` : base;
}

function createDataset({ kind, parsedChats, sourceChats, messages, duplicates }) {
  if (!messages.length) {
    throw new Error("No readable messages were found in the selected chat export.");
  }
  const sortedMessages = sortMessagesChronologically(messages);
  const participants = buildParticipants(sortedMessages);
  const datasetId = `dataset_${stableHash(`${kind}|${sourceChats.map(chat => chat.id).join("|")}|${sortedMessages.length}|${sortedMessages[0]?.date?.toISOString()}|${sortedMessages.at(-1)?.date?.toISOString()}`)}`;
  const suggestions = detectPossibleDuplicateContacts(participants);
  const participantAliases = Object.fromEntries(participants.flatMap(participant =>
    participant.aliases.map(alias => [alias, participant.displayName])
  ));

  return {
    datasetVersion: DATASET_VERSION,
    datasetId,
    datasetKind: kind,
    sourceChats,
    messages: sortedMessages,
    participants,
    participantAliases,
    mergeState: {
      version: 1,
      status: suggestions.length ? "suggested" : "none",
      suggestions,
      approved: [],
      rejected: [],
      participantIdMap: {},
    },
    combinedMeta: {
      sourceChatCount: parsedChats.length,
      duplicateMessageCount: duplicates.length,
      datasetKind: kind,
      displayTitle: buildDisplayTitle(participants, parsedChats.length),
      approvedMerges: 0,
      rejectedMerges: 0,
    },
  };
}

export function buildDatasetFromParsedChat(parsedChat) {
  const sourceChatId = sourceChatIdFor(parsedChat, 0);
  const rawMessages = getParsedMessages(parsedChat);
  const messages = rawMessages
    .map((message, index) => normalizeMessage(message, sourceChatId, index))
    .filter(Boolean);
  const sourceChat = createSourceChat(parsedChat, sourceChatId, 0, messages);
  return createDataset({
    kind: "single",
    parsedChats: [parsedChat],
    sourceChats: [sourceChat],
    messages,
    duplicates: [],
  });
}

export function buildCombinedDataset(parsedChats) {
  const chats = (Array.isArray(parsedChats) ? parsedChats : []).filter(Boolean);
  if (!chats.length) {
    throw new Error("Choose at least one chat export.");
  }
  validateImportCompatibility(chats);

  const sourceChats = [];
  const allMessages = [];
  chats.forEach((parsedChat, index) => {
    const sourceChatId = sourceChatIdFor(parsedChat, index);
    const messages = getParsedMessages(parsedChat)
      .map((message, messageIndex) => normalizeMessage(message, sourceChatId, messageIndex))
      .filter(Boolean);
    if (!messages.length) {
      throw new Error(`No readable messages were found in ${parsedChat?.fileName || `chat ${index + 1}`}.`);
    }
    sourceChats.push(createSourceChat(parsedChat, sourceChatId, index, messages));
    allMessages.push(...messages);
  });

  const deduped = dedupeMessages(allMessages);
  return createDataset({
    kind: chats.length > 1 ? "combined" : "single",
    parsedChats: chats,
    sourceChats,
    messages: deduped.messages,
    duplicates: deduped.duplicates,
  });
}

export function toAnalysisMessagesFromDataset(dataset) {
  return (dataset?.messages || []).map(message => ({
    participantId: message.participantId,
    sourceChatId: message.sourceChatId,
    sourceMessageIndex: message.sourceMessageIndex,
    senderId: message.senderId,
    senderUsername: message.senderUsername,
    senderDisplayName: message.senderDisplayName,
    platform: message.platform,
    type: message.type,
    mediaKind: message.mediaKind,
    name: message.name,
    body: message.body,
    date: asDate(message.date),
    hour: message.hour,
    month: message.month,
    year: message.year,
  }));
}

export function getDatasetDisplayTitle(dataset) {
  return dataset?.combinedMeta?.displayTitle || formatParticipantLabel(dataset?.participants || []);
}

export function detectOtherParticipantMismatches(dataset, registeredUserName) {
  if (!dataset || dataset.datasetKind !== "combined") return null;
  const normalizedUser = normalizeDisplayName(registeredUserName);
  if (!normalizedUser) return null;

  const aliasToCanonical = dataset.participantAliases || {};
  const rows = (dataset.sourceChats || [])
    .map((chat, index) => {
      const names = Array.isArray(chat.participantNames) ? chat.participantNames.filter(Boolean) : [];
      if (names.length !== 2) return null;
      const canonicalNames = names.map(name => aliasToCanonical[name] || name);
      const hasRegisteredUser = canonicalNames.some(name => normalizeDisplayName(name) === normalizedUser);
      const otherName = canonicalNames.find(name => normalizeDisplayName(name) !== normalizedUser);
      if (!hasRegisteredUser || !otherName) return null;
      return {
        chatId: chat.id,
        label: `Chat ${index + 1}`,
        fileName: chat.fileName,
        otherName,
      };
    })
    .filter(Boolean);

  if (rows.length < 2) return null;
  const uniqueOthers = [...new Set(rows.map(row => normalizeDisplayName(row.otherName)))];
  return uniqueOthers.length > 1 ? { rows } : null;
}
