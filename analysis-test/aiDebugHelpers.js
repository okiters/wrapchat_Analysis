function sanitizeDownloadBaseName(fileName) {
  const base = String(fileName || "wrapchat-chat")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "wrapchat-chat";
}

export function createAiDebugFileName(fileName) {
  return `${sanitizeDownloadBaseName(fileName)}-ai-debug.json`;
}

export function createAiRawDebugFileName(fileName, pipeline = "core-a") {
  return `${sanitizeDownloadBaseName(fileName)}-${pipeline}-raw.txt`;
}

export function serializeDebugAnalysisExport(payload) {
  return JSON.stringify(payload, null, 2);
}

export function downloadJsonFile(jsonText, fileName) {
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(text, fileName) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function toDebugRequestRecord(request) {
  if (!request) return null;
  return {
    pipeline: request.pipeline,
    systemPrompt: request.systemPrompt,
    userContent: request.userContent,
    maxTokens: request.maxTokens,
    schemaMode: request.schemaMode,
    schemaId: request.schemaId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Shared userContent fragments.
// Global rules (speaker attribution, window isolation, funny attribution,
// relationship boundary, quotes, dates, voice, JSON rules) live in
// buildAnalystSystemPrompt — builders here carry only pipeline scope.
// ─────────────────────────────────────────────────────────────────

function buildTopicSpreadLine(math) {
  const pick = list => (Array.isArray(list) ? list : [])
    .slice(0, 5)
    .map(entry => (Array.isArray(entry) ? entry[0] : entry))
    .filter(Boolean);
  const topics = [...pick(math?.topBigrams), ...pick(math?.topWords)].slice(0, 8);
  if (!topics.length) return "";
  return `RECURRING TOPICS (from local counts): ${topics.join(", ")}. Spread your answers across different topics: never anchor more than two fields on the same topic or the same story.`;
}

function buildDuoLocalContext(math, relationshipContext, isGroup) {
  const base = isGroup
    ? `The least active member (the ghost) is ${math.ghost}. The conversation starter is ${math.convStarter}.`
    : `By reply time, ${math.ghostName} is slower to respond. The conversation starter is ${math.convStarter}. Local analysis found that ${math.funniestPerson} caused the most laugh reactions from the other person (${math.laughCausedBy?.[math.funniestPerson] || 0} times), confirm or correct this from the chat.`;
  const evidence = !isGroup && relationshipContext?.evidence
    ? `\nRELATIONSHIP EVIDENCE: A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}". Use it as confirmation, but do not over-quote it.`
    : "";
  return `IMPORTANT CONTEXT: ${base}${evidence}`;
}

function buildWindowIntro(names, totalMessages, isGroup, largeChatNote = "") {
  return `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${totalMessages.toLocaleString()} messages.${largeChatNote} The content below is divided into ISOLATED WINDOWS from across the full history, each labelled ━━━ WINDOW N/N · date · type ━━━.`;
}

// ─────────────────────────────────────────────────────────────────
// CONNECTION DIGEST
// ─────────────────────────────────────────────────────────────────

export function prepareConnectionDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildAnalystSystemPrompt,
  buildRelationshipLine,
  buildSampleText,
  extraConnectionRules = "",
  candidatesText = "",
  coreAnalysisVersion,
  maxTokens,
}) {
  const names = math?.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipLine = !isGroup ? buildRelationshipLine(relationshipContext, relationshipType) : "";
  const chatText = buildSampleText(messages);
  const fields = `{
  "schemaVersion": ${coreAnalysisVersion},
  "meta": {
    "confidenceNote": "1 short sentence - how confident the connection read is",
    "dominantTone": "short phrase naming the dominant overall tone"
  },
  "people": [
    {
      "name": "first person's first name",
      "careStyle": {
        "language": "one of: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed",
        "examples": ["one short concrete example (one sentence, under 120 characters, no line breaks)", "second short example if needed"],
        "score": [1-10]
      },
      "energy": {
        "netScore": [1-10],
        "type": "net positive / mixed / net draining",
        "goodNews": "1 short sentence - how they bring positive energy",
        "venting": "1 short sentence - how or how much they drain or vent, or 'minimal venting'",
        "hypeQuote": "short real quote or near-verbatim example"
      }
    }
  ],
  "shared": {
    "vibeOneLiner": "1 memorable line capturing this exact chat in a way that feels specific to these people",
    "biggestTopic": "the dominant recurring storyline in this chat - something both repeated and important to the dynamic, not a trivial side debate",
    "ghostContext": "1 sentence explaining the slower replier's pattern",
    "funniestPerson": "ONLY the first name of the funniest person, or 'None clearly identified'",
    "funniestReason": "1-2 short sentences - the exact line or move that got the reaction, who said it, and why it hit",
    "dramaStarter": "ONLY a first name, 'Shared', or 'None clearly identified'",
    "dramaContext": "1 sentence describing the real recurring drama pattern",
    "signaturePhrases": ["real repeated phrase person 1 uses", "real repeated phrase person 2 uses"],
    "relationshipSummary": "1 sentence - a specific human read on what's actually going on between them, not a label or diagnosis",
    "groupDynamic": "1 sentence - honest read of this group's energy",
    "tensionMoment": "1-2 short sentences - the sharpest supported tension point: trigger, who was involved, and why it felt tense",
    "kindestPerson": "ONLY a first name, or 'None clearly identified'",
    "sweetMoment": "1-2 short sentences - the most revealing caring moment: who did what, the quote or move, and why it landed",
    "mostMissed": "group only: ONLY a first name, or 'None clearly identified'",
    "insideJoke": "group only: 1 sentence naming a recurring inside joke or reference",
    "hypePersonReason": "group only: 1 sentence describing how this person energises the group",
    "loveLanguageMismatch": "1 sentence describing how their care styles align or mismatch",
    "mostLovingMoment": "1-2 short sentences - the warmest concrete moment, naming who did what and why it felt real",
    "compatibilityScore": [1-10],
    "compatibilityRead": "1 short sentence - love-language compatibility summary",
    "mostEnergising": "1-2 short sentences - the most energising exchange: what sparked it and how the other person met it",
    "mostDraining": "1-2 short sentences - the most draining moment or recurring pattern: what created the pressure",
    "energyCompatibility": "1 sentence - how their energy styles work together",
    "timeOfDay": {
      "personA": { "name": "first name", "peakHour": "peak hour as a readable string e.g. '10pm' or '9am'", "peakDaypart": "one of: morning / afternoon / evening / late night" },
      "personB": { "name": "first name", "peakHour": "peak hour as a readable string e.g. '10pm' or '9am'", "peakDaypart": "one of: morning / afternoon / evening / late night" },
      "contrast": "1 sentence - what the time difference reveals about how each person uses or experiences this chat"
    },
    "loveLanguageIntro": "1 sentence - how love languages show up in this chat overall, before naming either person specifically",
    "loveMiss": {
      "description": "1 sentence - a moment where love was expressed in one language but received in another, or empty string if not clearly supported",
      "quote": "short real quote from that moment or empty string",
      "persons": ["sender first name", "receiver first name"]
    },
    "loveMissUnspoken": "1 sentence - a moment of love expressed without words: a fast reply streak, an emoji burst at an odd hour, or sustained presence during a hard week - or empty string if not clearly supported",
    "energyDynamic": "1 sentence - what happens when these two specific energies meet as a pair, not what each person is individually",
    "guessThresholds": {
      "loveLanguageGuessValid": "[true if person A has a clearly dominant love language with multiple examples and it is not obvious - false if borderline, mixed, or predictable]",
      "energyGuessValid": "[true if one person is clearly more positive than the other by a meaningful margin - false if close, balanced, or obvious]"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a compact connection digest for relationship, love-language, and energy reports",
    relationshipType,
    `CONNECTION DIGEST SCOPE: relationship dynamic, ghost context, funny moments, kindness, tension, inside jokes, love language, energy, time-of-day patterns, love-language miss moments, energy dynamic, and love-language intro. Do NOT generate growth, evidence timelines, red-flag lists, accountability, or long status explanations.
TIME OF DAY: Derive peakHour and peakDaypart from the timestamps in the windows: look at when each person sends the most messages.
GUESS THRESHOLDS: Set loveLanguageGuessValid to true only if person A's love language is clearly dominant with multiple examples and is not the obvious expectation. Set energyGuessValid to true only if one person's energy score is clearly higher by a meaningful margin, not borderline.
LOVE MISS: Only populate if there is a specific moment where love was expressed in one language but clearly not received; otherwise use empty string. LOVE MISS UNSPOKEN: only populate from a specific non-verbal care moment in the windows; otherwise empty string. ENERGY DYNAMIC: always populate, describing the chemistry of the pair, not the individuals.
MOMENT PICKING: For funniestReason, sweetMoment, tensionMoment, mostLovingMoment, mostEnergising, and mostDraining, choose the strongest supported moment or repeated pattern, not the safest bland example. Prefer a clear trigger, a quote or move, and the reaction or consequence.
SUMMARY FIELDS: vibeOneLiner must be a sharp, memorable read of the dynamic specific to this chat. biggestTopic must name the recurring theme with real references, not a broad category: not "relationships" but the actual recurring storyline with its people. ghostContext explains WHY the slower replier takes longer, from observable patterns, without repeating the numeric reply time. insideJoke must recur across multiple windows, not a single funny line. Each summary should feel like it could only belong to this chat. ${extraConnectionRules}`,
    chatLang,
    relationshipLine
  );

  const largeChatNote = math.totalMessages > 10000
    ? " This is a very large chat: summary fields must reflect dominant patterns that recur across the full history, never one standout moment."
    : "";

  const userContent = `${buildWindowIntro(names, math.totalMessages, isGroup, largeChatNote)}

${buildDuoLocalContext(math, relationshipContext, isGroup)}
${buildTopicSpreadLine(math)}
${candidatesText ? `\n${candidatesText}\n` : ""}
EVENT WINDOWS:
${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "connection",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    schemaId: "connection",
    relationshipContext,
    relationshipLine,
  };
}

// ─────────────────────────────────────────────────────────────────
// GROWTH DIGEST
// ─────────────────────────────────────────────────────────────────

function buildGrowthBridgeText(messages, formatForAI) {
  if (!Array.isArray(messages) || !messages.length || typeof formatForAI !== "function") return "";
  const total = messages.length;
  const windowSize = total > 12000 ? 24 : 32;
  const bridgeSpecs = [0.25, 0.5, 0.75];

  return bridgeSpecs.map((ratio, index) => {
    const center = Math.floor(total * ratio);
    const start = Math.max(0, center - windowSize);
    const end = Math.min(total, center + windowSize);
    const slice = messages.slice(start, end);
    if (!slice.length) return "";
    return `BRIDGE WINDOW ${index + 1} (${Math.round(ratio * 100)}% through the chat):\n${formatForAI(slice)}`;
  }).filter(Boolean).join("\n\n");
}

export function prepareGrowthDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildAnalystSystemPrompt,
  buildRelationshipLine,
  formatForAI,
  coreAnalysisVersion,
  maxTokens,
}) {
  const names = math?.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipLine = !isGroup ? buildRelationshipLine(relationshipContext, relationshipType) : "";
  const snapshotSize = Math.min(120, Math.max(48, Math.floor(messages.length * 0.16)));
  const earlyMsgs = messages.slice(0, snapshotSize);
  const lateMsgs = messages.slice(Math.max(0, messages.length - snapshotSize));
  const earlyText = formatForAI(earlyMsgs);
  const lateText = formatForAI(lateMsgs);
  const bridgeText = buildGrowthBridgeText(messages, formatForAI);
  const fields = `{
  "schemaVersion": ${coreAnalysisVersion},
  "meta": {
    "confidenceNote": "1 short sentence - how confident the growth read is",
    "dominantTone": "short phrase naming the overall arc"
  },
  "people": [],
  "shared": {
    "growth": {
      "thenDepth": "1 short sentence describing the conversation style and topics in the EARLY snapshot",
      "nowDepth": "1 short sentence describing the conversation style and topics in the RECENT snapshot",
      "depthChange": "deeper / shallower / about the same",
      "whoChangedMore": "first name of who changed more, or 'Both equally'",
      "whoChangedHow": "1 short sentence - specifically how they changed, with evidence",
      "topicsAppeared": "1 short sentence naming topics or themes that appear recently but were not central early on",
      "topicsDisappeared": "1 short sentence naming topics or themes that faded away from the early period",
      "trajectory": "closer / drifting / stable",
      "trajectoryDetail": "1 short sentence - the overall arc based on evidence",
      "arcSummary": "1 sharp sentence capturing the full growth arc",
      "personAArc": "1 sentence - how the first person changed across the chat's lifespan: topics, tone, or engagement level",
      "personBArc": "1 sentence - how the second person changed across the chat's lifespan: topics, tone, or engagement level",
      "turningPoint": "approximate period when the biggest shift happened e.g. 'a few months in' or 'toward the end' - empty string if no clear turning point",
      "messageAtTurningPoint": {
        "quote": "short real quote from at or near the turning point - empty string if not clearly present in the provided text",
        "person": "first name of sender or empty string",
        "contextParagraph": "1 sentence - what changed in the relationship in the period after this message or exchange"
      },
      "growthGuessThreshold": "[true if one person's change is clearly more pronounced than the other and the answer would be non-obvious - false if both changed equally or the answer is predictable]"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp chat analyst building a compact growth digest",
    relationshipType,
    `GROWTH DIGEST SCOPE: only relationship evolution over time, including individual arcs per person, a turning point if detectable, and the message at that turning point. Do NOT generate funny moments, kindness, inside jokes, energy, red flags, accountability, timelines, or relationship labels.
METHOD: Compare the EARLY snapshot, the BRIDGE WINDOWS, and the RECENT snapshot to read how the conversation changed. INDIVIDUAL ARCS: personAArc and personBArc must describe how each specific person changed, never repeating whoChangedHow.
TURNING POINT: Only populate turningPoint and messageAtTurningPoint if a detectable shift is anchored in the snapshots; if the change is gradual or unclear, use empty strings.
GUESS THRESHOLD: growthGuessThreshold is true only when one person's change is clearly more visible and the answer would surprise the user.
GROWTH VOICE: Describe change as a lived rhythm, not a formal timeline: faster or slower, warmer or flatter, more casual or more careful, more dependent or more distant. If the evidence for change is mixed, prefer "about the same" or "stable" over forcing a dramatic arc.`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages.
${!isGroup && relationshipContext?.evidence ? `RELATIONSHIP EVIDENCE: A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}". Use it only as framing, not as a growth datapoint.` : ""}

EARLY SNAPSHOT:
${earlyText}

BRIDGE WINDOWS:
${bridgeText || "None"}

RECENT SNAPSHOT:
${lateText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "growth",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    schemaId: "growth",
    relationshipContext,
    relationshipLine,
  };
}

// ─────────────────────────────────────────────────────────────────
// CORE A (legacy full analysis — kept for the debug panel and fallbacks)
// ─────────────────────────────────────────────────────────────────

export function prepareCoreAnalysisARequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildAnalystSystemPrompt,
  buildRelationshipLine,
  buildSampleText,
  formatForAI,
  candidatesText = "",
  coreAnalysisVersion,
  maxTokens,
}) {
  const names = math?.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipLine = !isGroup ? buildRelationshipLine(relationshipContext, relationshipType) : "";
  const chatText = buildSampleText(messages);
  const personCount = Math.min(names.length || 0, isGroup ? Math.min(names.length || 0, 6) : 2);
  const earlyMsgs = messages.slice(0, Math.min(120, Math.max(40, Math.floor(messages.length * 0.18))));
  const lateMsgs = messages.slice(Math.max(0, messages.length - Math.min(120, Math.max(40, Math.floor(messages.length * 0.18)))));
  const earlyText = formatForAI(earlyMsgs);
  const lateText = formatForAI(lateMsgs);
  const fields = `{
  "schemaVersion": ${coreAnalysisVersion},
  "meta": {
    "confidenceNote": "1 sentence - how confident the read is, noting if evidence is mixed or limited",
    "dominantTone": "short phrase naming the dominant overall tone"
  },
  "people": [
    {
      "name": "first person's first name",
      "summaryRole": "1 short phrase describing their role in the dynamic",
      "careStyle": {
        "language": "one of: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed",
        "examples": ["first example of how they show care or affection (one sentence, under 120 chars)", "second example if applicable"],
        "score": [1-10]
      },
      "energy": {
        "netScore": [1-10],
        "type": "net positive / mixed / net draining",
        "goodNews": "1 sentence - how they bring positive energy, with a real example",
        "venting": "1 sentence - how or how much they vent/drain, or 'minimal venting' if low",
        "hypeQuote": "a short real quote or near-verbatim example of them bringing energy"
      }
    }
  ],
  "shared": {
    "vibeOneLiner": "One sharp memorable sentence that nails exactly what this chat *is*, specific to these people, not a mood label. If you can't nail it, keep it simple.",
    "biggestTopic": "1 sentence - what actually keeps coming up across the chat. Name the specific thing, not the category.",
    "ghostContext": "1 sentence - explain WHY the slower replier takes longer to respond, based on observable patterns such as time of day, topic avoidance, or mood. Do not repeat the numeric response time. Do not mention unanswered messages.",
    "funniestPerson": "ONLY the first name of the funniest person, or 'None clearly identified'",
    "funniestReason": "Name the specific line or moment that got the biggest reaction. Write it as 'drops lines like...' then the actual quote. Reference what caused the laugh, not the laugh itself. Under 20 words.",
    "dramaStarter": "ONLY a first name, 'Shared', or 'None clearly identified'",
    "dramaContext": "1 sentence - the real pattern with one concrete moment from the chat: what they actually do, and what they said or dropped that set it off ('exact quote'). No exaggeration.",
    "signaturePhrases": ["real phrase or expression person 1 uses a lot", "real phrase or expression person 2 uses a lot"],
    "relationshipStatus": "duo only: short relationship-status label, or 'None clearly identified'",
    "relationshipStatusWhy": "1 sentence - why that status fits, using objective evidence",
    "statusEvidence": "1 short line with a concrete example if possible",
    "toxicPerson": "ONLY a first name, 'Tie', or 'None clearly identified'",
    "toxicReason": "1 sentence - factual and conservative explanation of that read",
    "toxicityReport": "1 sentence - balanced, observable summary of tension or health",
    "redFlags": [
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "period-dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "period-dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "period-dated example or short quote" }
    ],
    "evidenceTimeline": [
      { "date": "approximate period only (e.g. 'early on', 'mid-chat', 'recently')", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "approximate period only", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "approximate period only", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" }
    ],
    "relationshipSummary": "1 sentence - what's actually going on between them, in plain human terms. Specific about the pattern, not a label or diagnosis.",
    "groupDynamic": "1 sentence - honest read of this group's energy. Specific about who does what and what the group runs on.",
    "tensionMoment": "1 sentence - the most tense moment: what triggered it and how it played out, with a real quote. Describe clearly, don't amplify.",
    "kindestPerson": "ONLY a first name - the warmest/caring person, or 'None clearly identified'",
    "sweetMoment": "1 sentence - name the person, what they said or did, and why it landed. The shape is 'When [Person] [did specific thing] for [Other]'. Actual effort or support, not a warm routine.",
    "mostMissed": "group only: ONLY a first name, or 'None clearly identified'",
    "insideJoke": "group only: 1 sentence - a recurring joke, meme, reference, or expression that keeps coming back. Must appear in at least two separate windows. Quote the actual phrase exactly as written.",
    "hypePersonReason": "group only: 1 sentence - specifically how this person energises the group, with a real example that actually appears in the chat.",
    "loveLanguageMismatch": "1 sentence - how their care styles align or mismatch in practice",
    "mostLovingMoment": "1 sentence - the most genuinely warm or loving moment, with the actual message or action as evidence.",
    "compatibilityScore": [1-10],
    "compatibilityRead": "1 sentence - love-language compatibility summary",
    "mostEnergising": "1 sentence - the single most energising moment or exchange, quoting the line that best captures it.",
    "mostDraining": "1 sentence - the single most draining moment or recurring pattern, quoting the line that best illustrates it.",
    "energyCompatibility": "1 sentence - how their energy styles work together (or don't)",
    "timeOfDay": {
      "personA": { "name": "first name", "peakHour": "peak hour as a readable string e.g. '10pm' or '9am'", "peakDaypart": "one of: morning / afternoon / evening / late night" },
      "personB": { "name": "first name", "peakHour": "peak hour as a readable string e.g. '10pm' or '9am'", "peakDaypart": "one of: morning / afternoon / evening / late night" },
      "contrast": "1 sentence - what the time difference reveals about how each person uses or experiences this chat"
    },
    "loveLanguageIntro": "1 sentence - how love languages show up in this chat overall, before naming either person specifically",
    "loveMiss": {
      "description": "1 sentence - a moment where love was expressed in one language but received in another, or empty string if not clearly supported",
      "quote": "short real quote from that moment or empty string",
      "persons": ["sender first name", "receiver first name"]
    },
    "loveMissUnspoken": "1 sentence - a moment of love expressed without words - or empty string if not clearly supported",
    "energyDynamic": "1 sentence - what happens when these two specific energies meet as a pair, not what each person is individually",
    "guessThresholds": {
      "loveLanguageGuessValid": "[true if person A has a clearly dominant love language with multiple examples and the answer would be non-obvious - false if borderline, mixed, or predictable]",
      "energyGuessValid": "[true if one person is clearly more positive than the other by a meaningful margin - false if close, balanced, or obvious]"
    },
    "growth": {
      "thenDepth": "1 sentence describing the conversation style and topics in the EARLY snapshot",
      "nowDepth": "1 sentence describing the conversation style and topics in the RECENT snapshot",
      "depthChange": "deeper / shallower / about the same",
      "whoChangedMore": "first name of who changed more, or 'Both equally'",
      "whoChangedHow": "1 sentence - specifically how they changed, with evidence",
      "topicsAppeared": "topics or themes that appear in recent messages but were not present early on",
      "topicsDisappeared": "topics or themes from the early messages that seem to have faded away",
      "trajectory": "closer / drifting / stable",
      "trajectoryDetail": "1 sentence - the overall arc based on evidence",
      "arcSummary": "1 punchy sentence capturing the full growth arc"
    },
    "memorableMoments": [
      {
        "type": "funny | sweet | awkward | chaotic | signature | tension | care | conflict",
        "date": "approximate period only (e.g. 'early on', 'a few months in', 'recently')",
        "people": ["first name of person involved"],
        "title": "2-5 word card title",
        "quote": "short exact quote if directly present in the provided windows - empty string if not",
        "setup": "1 short sentence: what was happening in this moment",
        "read": "1 short sentence: WrapChat-style interpretation, warm and specific"
      }
    ]
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a canonical core-analysis object that later reports will reuse",
    relationshipType,
    `CORE-A SCOPE: relationship dynamic, communication patterns, funny moments, kindness moments, energy, love language, growth trajectory, and memorable moments.
SNAPSHOTS VS WINDOWS: You will receive EARLY and RECENT contiguous snapshots plus event windows. Use the snapshots ONLY for the growth/change fields (thenDepth, nowDepth, depthChange, whoChangedMore, whoChangedHow, topicsAppeared, topicsDisappeared, trajectory, trajectoryDetail, arcSummary). Use the event windows for everything else.
PARTICIPANTS: ${names.slice(0, isGroup ? names.length : 2).join(", ")}. The people array must follow this order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"} only, one entry each. Other senders may appear in windows: track them for shared fields but never create people entries for them, and never fold their actions into a slotted participant's entry.
SUMMARY FIELDS: vibeOneLiner, biggestTopic, and insideJoke must reflect what recurs across multiple windows, never a single window. If you cannot confirm recurrence, do not claim it.
MEMORABLE MOMENTS: Select 3 to 6 moments, each from a different window and a different exchange. Prefer funny, warm, awkward, revealing, or signature over generic filler. The quote must be a short exact string from the provided windows or empty. The read should feel like a card someone would screenshot.
TIME OF DAY: Derive from timestamps in the windows; each timestamp already includes the day of week, read it directly.
GUESS THRESHOLDS: true only when the answer is clear AND non-obvious; err toward false.`,
    chatLang,
    relationshipLine
  );

  const largeChatNote = math.totalMessages > 10000
    ? " This is a very large chat: every summary field must reflect dominant patterns recurring across the full history. Never let one moment, joke, or exchange define a summary field."
    : "";

  const userContent = `${buildWindowIntro(names, math.totalMessages, isGroup, largeChatNote)}

${buildDuoLocalContext(math, relationshipContext, isGroup)}
${buildTopicSpreadLine(math)}
${candidatesText ? `\n${candidatesText}\n` : ""}
EARLY SNAPSHOT (contiguous excerpt from the start of the chat - use ONLY for growth/change fields):
${earlyText}

RECENT SNAPSHOT (contiguous excerpt from the end of the chat - use ONLY for growth/change fields):
${lateText}

EVENT WINDOWS (use these for all non-growth fields):
${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "coreA",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    schemaId: null,
    relationshipContext,
    relationshipLine,
  };
}

// ─────────────────────────────────────────────────────────────────
// CORE B (legacy risk analysis — kept for the debug panel and fallbacks)
// ─────────────────────────────────────────────────────────────────

const RISK_SCOPE_RULES = `ACCOUNTABILITY RULES: Count only concrete commitments with a clear actor and action. A vague wish like "we should hang out sometime" is not a promise unless there is a specific plan, time, task, or follow-up. A promise is BROKEN only if there is clear evidence it was never fulfilled, explicitly cancelled, forgotten, or abandoned. A promise fulfilled late is still KEPT. A delay is not a failure unless the chat shows pressure, repeated postponement, or a missed agreed time. If the evidence is weak, say it is weak and use "None clearly identified" rather than forcing a dramatic broken promise. Prefer meaningful commitments over tiny logistics, and compare both people fairly.
RISK VOICE: Careful but still human. No courtroom language unless the chat is clearly severe. Never make one person the villain from one or two examples. Use grounded phrasing like "this is more messy than malicious" or "the pattern is avoidance, not open conflict" when supported. Never combine two separate events into one story.`;

export function prepareCoreAnalysisBRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildAnalystSystemPrompt,
  buildRelationshipLine,
  buildSampleText,
  coreAnalysisVersion,
  maxTokens,
}) {
  const names = math?.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipLine = !isGroup ? buildRelationshipLine(relationshipContext, relationshipType) : "";
  const chatText = buildSampleText(messages);
  const personCount = Math.min(names.length || 0, 2);
  const fields = `{
  "schemaVersion": ${coreAnalysisVersion},
  "meta": {
    "confidenceNote": "1 sentence - how confident the risk/accountability read is",
    "dominantTone": "short phrase naming the overall tension level"
  },
  "people": [
    {
      "name": "first person's first name",
      "health": {
        "score": [1-10, this person's contribution to chat health],
        "detail": "1 sentence - specific behaviours driving their health score",
        "apologyCount": [estimated apology count in the sample],
        "apologyContext": "1 sentence - how and when they tend to apologise"
      },
      "accountability": {
        "total": [estimated number of real commitments/promises made],
        "kept": [estimated number kept],
        "broken": [estimated number broken or dropped],
        "score": [1-10],
        "detail": "1 sentence - pattern of how they handle commitments"
      }
    }
  ],
  "shared": {
    "toxicity": {
      "chatHealthScore": [1-10, overall chat health],
      "healthScores": [
        { "name": "first name", "score": [1-10], "detail": "1 sentence - behaviours driving their score" },
        { "name": "first name", "score": [1-10], "detail": "1 sentence - behaviours driving their score" }
      ],
      "apologiesLeader": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence - context and pattern" },
      "apologiesOther": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence - context and pattern" },
      "redFlagMoments": [
        { "date": "approximate period only (e.g. 'early on', 'recently')", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate period only", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate period only", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "1 sentence - how arguments usually start and resolve or fail to resolve",
      "powerBalance": "1 sentence - who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 punchy sentence verdict on the overall health of this chat",
      "whatStillHere": "1 sentence - the genuine positive thread that runs through the chat despite its tension - empty string if not clearly supported",
      "heavyAttributionQuote": {
        "quote": "short real quote from the most charged moment in the conflict cluster",
        "person": "first name of sender",
        "contextParagraph": "1 sentence - what was happening around this message and why it mattered",
        "isSensitive": "[true if the message involves threats, self-harm, sexual pressure, or severe abuse - false otherwise]"
      },
      "apologyGuessThreshold": "[true only if the apology gap is large and non-obvious - one person apologises more than twice the other - false if close or predictable]",
      "powerGuessThreshold": "[true only if there is a clear, non-obvious power imbalance - false if Balanced or borderline]"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do - quote or close paraphrase",
        "date": "approximate period only",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "date": "approximate period only",
        "outcome": "how they followed through"
      },
      "overallVerdict": "1 sentence verdict on accountability in this chat overall",
      "reliabilityArc": "1 sentence - did accountability improve or decline over the chat's lifespan? Use evidence from early vs late windows - empty string if no clear arc",
      "promiseThatMattered": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "outcome": "what happened",
        "contextParagraph": "1 sentence - why this specific promise mattered to the arc of the relationship"
      },
      "promiseGuessThreshold": "[true only if there is a clear, surprising difference in promise count between the two people - false if similar or obvious]"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building the canonical core-b object",
    relationshipType,
    `CORE-B SCOPE: toxicity, health scores, apology patterns, conflict patterns, power balance, red flag moments, accountability, what still remains positive, attribution quotes, and guess thresholds.
WHAT STILL HERE: Only populate if a genuine positive thread is clearly visible; empty string otherwise. HEAVY ATTRIBUTION QUOTE: the single most charged real quote from a conflict window; isSensitive is true for threats, self-harm, sexual pressure, or severe abuse. GUESS THRESHOLDS: true only when the gap is large and non-obvious; err toward false. RELIABILITY ARC: empty string if evidence is thin. PROMISE THAT MATTERED: the promise with the clearest downstream effect, not just the biggest or most broken.
PARTICIPANTS: The people array follows the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, one entry each.
${RISK_SCOPE_RULES}`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). ${!isGroup && relationshipContext?.evidence ? `A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}".` : ""} The content below is ISOLATED WINDOWS from across the full history.

${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "coreB",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    schemaId: null,
    relationshipContext,
    relationshipLine,
  };
}

// ─────────────────────────────────────────────────────────────────
// RISK DIGEST
// ─────────────────────────────────────────────────────────────────

export function prepareRiskDigestRequest({
  messages,
  math,
  relationshipType,
  chatLang = "en",
  relationshipContext = null,
  buildAnalystSystemPrompt,
  buildRelationshipLine,
  buildSampleText,
  extraRiskRules = "",
  candidatesText = "",
  coreAnalysisVersion,
  maxTokens,
}) {
  const names = math?.names || [];
  const isGroup = !!math?.isGroup;
  const relationshipLine = !isGroup ? buildRelationshipLine(relationshipContext, relationshipType) : "";
  const chatText = buildSampleText(messages);
  const personCount = Math.min(names.length || 0, 2);
  const fields = `{
  "schemaVersion": ${coreAnalysisVersion},
  "meta": {
    "confidenceNote": "1 short sentence - how confident the risk/accountability read is",
    "dominantTone": "short phrase naming the overall tension level"
  },
  "people": [
    {
      "name": "first person's first name",
      "health": {
        "score": [1-10, this person's contribution to chat health],
        "detail": "1 short sentence - behaviours driving their health score",
        "apologyCount": [estimated apology count in the sample],
        "apologyContext": "1 short sentence - how and when they tend to apologise"
      },
      "accountability": {
        "total": [estimated number of real commitments/promises made],
        "kept": [estimated number kept],
        "broken": [estimated number broken or dropped],
        "score": [1-10],
        "detail": "1 short sentence - pattern of how they handle commitments"
      }
    }
  ],
  "shared": {
    "toxicity": {
      "chatHealthScore": [1-10, overall chat health],
      "healthScores": [
        { "name": "first name", "score": [1-10], "detail": "1 short sentence - behaviours driving their score" },
        { "name": "first name", "score": [1-10], "detail": "1 short sentence - behaviours driving their score" }
      ],
      "apologiesLeader": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 short sentence - context and pattern" },
      "apologiesOther": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 short sentence - context and pattern" },
      "redFlagMoments": [
        { "date": "approximate period only (e.g. 'early on', 'recently')", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" },
        { "date": "approximate period only", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" },
        { "date": "approximate period only", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "1 short sentence - how arguments usually start and resolve or fail to resolve",
      "powerBalance": "1 short sentence - who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 short sentence verdict on the overall health of this chat",
      "whatStillHere": "1 short sentence - the genuine positive thread in the chat despite its tension - empty string if not clearly supported",
      "heavyAttributionQuote": {
        "quote": "short real quote from the most charged conflict moment",
        "person": "first name of sender",
        "contextParagraph": "1 short sentence - what was happening around this message",
        "isSensitive": "[true if it involves threats, self-harm, sexual pressure, or severe abuse - false otherwise]"
      },
      "apologyGuessThreshold": "[true only if the apology gap is large and non-obvious - false if close or predictable]",
      "powerGuessThreshold": "[true only if there is a clear non-obvious power imbalance - false if Balanced or borderline]"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do - quote or close paraphrase",
        "date": "approximate period only",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "date": "approximate period only",
        "outcome": "how they followed through"
      },
      "comparison": "1 short sentence comparing both people's follow-through fairly, only if supported",
      "followThroughPattern": "1 short sentence naming the real pattern around kept, delayed, dropped, or unclear commitments",
      "evidenceQuality": "1 short sentence saying whether the promise evidence is strong, mixed, thin, or mostly casual",
      "overallVerdict": "1 short sentence verdict on accountability in this chat overall",
      "reliabilityArc": "1 short sentence - did accountability improve or decline over the chat's lifespan - empty string if no clear arc",
      "promiseThatMattered": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "outcome": "what happened",
        "contextParagraph": "1 short sentence - why this promise mattered to the arc of the relationship"
      },
      "promiseGuessThreshold": "[true only if there is a clear surprising difference in promise count - false if similar or obvious]"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building a compact risk digest",
    relationshipType,
    `RISK DIGEST SCOPE: toxicity, chat health, apology patterns, conflict patterns, power balance, red flag moments, accountability, what still remains positive, attribution quotes, and guess thresholds. Do NOT generate relationship summaries, growth, timelines, love-language, or energy reads.
WHAT STILL HERE: Only populate if a genuine positive thread is visible; empty string otherwise. HEAVY ATTRIBUTION QUOTE: one real quote from the conflict cluster; isSensitive is true for threats, self-harm, sexual pressure, or severe abuse. GUESS THRESHOLDS: true only when the gap is large and non-obvious; err toward false. RELIABILITY ARC: empty string if evidence is thin. PROMISE THAT MATTERED: the promise with the clearest downstream effect, not just the biggest or most broken.
PARTICIPANTS: The people array follows the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, one entry each.
${RISK_SCOPE_RULES} ${extraRiskRules}`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). ${!isGroup && relationshipContext?.evidence ? `A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}".` : ""} The content below is ISOLATED WINDOWS from across the full history.
${candidatesText ? `\n${candidatesText}\n` : ""}
${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "risk",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    schemaId: "risk",
    relationshipContext,
    relationshipLine,
  };
}

export function buildDebugAnalysisExport({
  fileName = null,
  rawProcessedPayload = null,
  messages = [],
  math = null,
  detectedLanguage = null,
  relationshipType = null,
  relationshipContext = null,
  relationshipLine = "",
  requests = {},
  tooShort = false,
  analysisVersions = {},
  summary = null,
}) {
  return {
    exportedAt: new Date().toISOString(),
    fileName,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    participants: math?.names || summary?.participants || [],
    isGroup: !!math?.isGroup,
    detectedLanguage: detectedLanguage || null,
    relationshipType: relationshipType || null,
    relationshipContext: relationshipContext || null,
    relationshipLine: relationshipLine || "",
    analysisVersions,
    input: {
      messages,
      math,
      tooShort: Boolean(tooShort),
      cappedGroup: Boolean(math?.cappedGroup),
      originalParticipantCount: math?.originalParticipantCount ?? null,
      rawProcessedPayload,
    },
    requests: Object.fromEntries(
      Object.entries(requests || {}).map(([key, value]) => [key, toDebugRequestRecord(value)])
    ),
  };
}
