const FUZZY_MATCH_THRESHOLD = 0.82;

const PHONE_RE = /(?:\+|00)?[\d\s().-]{7,}/g;

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizePhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  return digits.replace(/^00/, "");
}

export function extractPhoneNumber(value) {
  const text = String(value || "");
  const matches = text.match(PHONE_RE) || [];
  return matches
    .map(normalizePhoneNumber)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || "";
}

export function normalizeDisplayName(value) {
  const phone = extractPhoneNumber(value);
  const withoutPhone = String(value || "").replace(PHONE_RE, " ");
  const normalized = stripDiacritics(withoutPhone)
    .toLocaleLowerCase("en-US")
    .replace(/[_()[\]{}"'`´’‘.,;:!?/\\|@#$%^&*=+~<>-]/g, " ")
    .replace(/\b(contact|mobile|phone|whatsapp|wa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || phone;
}

function levenshtein(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  const curr = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function tokenSimilarity(left, right) {
  const aTokens = normalizeDisplayName(left).split(" ").filter(Boolean);
  const bTokens = normalizeDisplayName(right).split(" ").filter(Boolean);
  if (!aTokens.length || !bTokens.length) return 0;

  const shared = aTokens.filter(token => bTokens.includes(token)).length;
  const shorter = Math.min(aTokens.length, bTokens.length);
  const firstTokenMatch = aTokens[0] && aTokens[0] === bTokens[0] ? 0.08 : 0;
  return Math.min(1, (shared / shorter) + firstTokenMatch);
}

export function calculateNameSimilarity(left, right) {
  const a = normalizeDisplayName(left);
  const b = normalizeDisplayName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshtein(a, b);
  const editScore = 1 - (distance / Math.max(a.length, b.length, 1));
  const tokenScore = tokenSimilarity(a, b);
  return Math.max(0, Math.min(1, Math.max(editScore, tokenScore)));
}

function participantName(participant) {
  return participant?.displayName || participant?.name || participant?.rawName || "";
}

function participantPhone(participant) {
  return participant?.phone || extractPhoneNumber(participantName(participant));
}

export function detectPossibleDuplicateContacts(participants, options = {}) {
  const threshold = Number(options.threshold) || FUZZY_MATCH_THRESHOLD;
  const list = Array.isArray(participants) ? participants.filter(Boolean) : [];
  const suggestions = [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const aName = participantName(a);
      const bName = participantName(b);
      const aPhone = participantPhone(a);
      const bPhone = participantPhone(b);
      const samePhone = aPhone && bPhone && (
        aPhone === bPhone ||
        aPhone.endsWith(bPhone.slice(-7)) ||
        bPhone.endsWith(aPhone.slice(-7))
      );
      const similarity = calculateNameSimilarity(aName, bName);
      const sameNormalizedName = normalizeDisplayName(aName) === normalizeDisplayName(bName);
      const phoneNameVariation = Boolean((aPhone || bPhone) && similarity >= 0.65);

      if (!samePhone && !sameNormalizedName && similarity < threshold && !phoneNameVariation) continue;

      suggestions.push({
        id: `merge-${a.id || i}-${b.id || j}`,
        participantAId: a.id,
        participantBId: b.id,
        participantA: {
          id: a.id,
          displayName: a.displayName || a.name || a.rawName || "",
          phone: aPhone || "",
        },
        participantB: {
          id: b.id,
          displayName: b.displayName || b.name || b.rawName || "",
          phone: bPhone || "",
        },
        confidence: samePhone || sameNormalizedName ? 1 : similarity,
        reason: samePhone ? "phone-match" : sameNormalizedName ? "normalized-name-match" : "fuzzy-name-match",
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

function resolveParent(parent, id) {
  let current = id;
  while (parent.get(current) && parent.get(current) !== current) {
    current = parent.get(current);
  }
  return current;
}

function createMergeGroups(participants, approvedSuggestions) {
  const parent = new Map();
  participants.forEach(participant => parent.set(participant.id, participant.id));

  (approvedSuggestions || []).forEach(suggestion => {
    const a = suggestion.participantAId;
    const b = suggestion.participantBId;
    if (!parent.has(a) || !parent.has(b)) return;
    const rootA = resolveParent(parent, a);
    const rootB = resolveParent(parent, b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  });

  const groups = new Map();
  participants.forEach(participant => {
    const root = resolveParent(parent, participant.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(participant);
  });
  return groups;
}

function pickCanonicalParticipant(group) {
  return [...group].sort((a, b) => {
    const countDiff = (b.messageCount || 0) - (a.messageCount || 0);
    if (countDiff) return countDiff;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""));
  })[0];
}

function uniquifyParticipantDisplayNames(participants, sourceChats = []) {
  const sourceLabelById = Object.fromEntries((sourceChats || []).map((chat, index) => [chat.id, `Chat ${index + 1}`]));
  const counts = participants.reduce((acc, participant) => {
    const key = normalizeDisplayName(participant.displayName);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return participants.map(participant => {
    const key = normalizeDisplayName(participant.displayName);
    if ((counts[key] || 0) <= 1) return participant;
    const sourceId = participant.sourceChatIds?.[0];
    const suffix = sourceLabelById[sourceId] || sourceId || participant.id;
    return {
      ...participant,
      displayName: `${participant.displayName} (${suffix})`,
      originalDisplayName: participant.originalDisplayName || participant.displayName,
    };
  });
}

export function applyApprovedMerges(dataset, approvedSuggestionIds = [], allSuggestions = []) {
  const approvedSet = new Set(approvedSuggestionIds);
  const approvedSuggestions = allSuggestions.filter(suggestion => approvedSet.has(suggestion.id));
  const rejectedSuggestions = allSuggestions.filter(suggestion => !approvedSet.has(suggestion.id));
  const participants = Array.isArray(dataset?.participants) ? dataset.participants : [];
  const groups = createMergeGroups(participants, approvedSuggestions);
  const participantIdMap = {};
  const participantAliases = { ...(dataset?.participantAliases || {}) };
  const nextParticipants = [];

  groups.forEach(group => {
    const canonical = pickCanonicalParticipant(group);
    const aliases = [...new Set(group.flatMap(item => [
      ...(item.aliases || []),
      item.displayName,
      item.rawName,
    ]).filter(Boolean))];

    group.forEach(item => {
      participantIdMap[item.id] = canonical.id;
      aliases.forEach(alias => {
        participantAliases[alias] = canonical.displayName;
      });
    });

    nextParticipants.push({
      ...canonical,
      aliases,
      sourceChatIds: [...new Set(group.flatMap(item => item.sourceChatIds || []))],
      messageCount: group.reduce((sum, item) => sum + (item.messageCount || 0), 0),
      mergedParticipantIds: group.map(item => item.id),
    });
  });

  const uniqueParticipants = uniquifyParticipantDisplayNames(nextParticipants, dataset?.sourceChats || []);
  const displayNameById = Object.fromEntries(uniqueParticipants.map(participant => [participant.id, participant.displayName]));
  const canonicalById = Object.fromEntries(uniqueParticipants.map(participant => [participant.id, participant]));
  Object.entries(participantAliases).forEach(([alias, canonicalName]) => {
    const participant = uniqueParticipants.find(item =>
      item.displayName === canonicalName ||
      item.originalDisplayName === canonicalName ||
      (item.aliases || []).includes(alias)
    );
    if (participant) participantAliases[alias] = participant.displayName;
  });
  (dataset?.participants || []).forEach(participant => {
    const targetId = participantIdMap[participant.id] || participant.id;
    const canonical = canonicalById[targetId];
    (participant.aliases || [participant.displayName]).filter(Boolean).forEach(alias => {
      participantAliases[`${participant.sourceChatIds?.[0] || "source"}:${alias}`] = canonical?.displayName || participant.displayName;
    });
  });
  const messages = (dataset?.messages || []).map(message => {
    const participantId = participantIdMap[message.participantId] || message.participantId;
    return {
      ...message,
      participantId,
      name: displayNameById[participantId] || message.name,
    };
  });

  return {
    ...dataset,
    participants: uniqueParticipants.sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0)),
    messages,
    participantAliases,
    mergeState: {
      version: 1,
      status: approvedSuggestions.length ? "confirmed" : (allSuggestions.length ? "reviewed" : "none"),
      suggestions: allSuggestions,
      approved: approvedSuggestions,
      rejected: rejectedSuggestions,
      participantIdMap,
    },
    combinedMeta: {
      ...(dataset?.combinedMeta || {}),
      approvedMerges: approvedSuggestions.length,
      rejectedMerges: rejectedSuggestions.length,
    },
  };
}

export { FUZZY_MATCH_THRESHOLD };
