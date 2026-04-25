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
  };
}

export function prepareConnectionDigestRequest({
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
    "confidenceNote": "1 short sentence - how confident the connection read is",
    "dominantTone": "short phrase naming the dominant overall tone"
  },
  "people": [
    {
      "name": "first person's first name",
      "careStyle": {
        "language": "one of: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed",
        "languageEmoji": "1 emoji representing that care style",
        "examples": ["one short concrete example", "second short example if needed"],
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
    "energyCompatibility": "1 sentence - how their energy styles work together"
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a compact connection digest for relationship, love-language, and energy reports",
    relationshipType,
    `CONNECTION DIGEST SCOPE: relationship dynamic, ghost context, funny moments, kindness, tension, inside jokes, love language, and energy. Do NOT generate growth, evidence timelines, red-flag lists, accountability, or long status explanations. Keep most free-text fields compact and direct. vibeOneLiner, biggestTopic, sweetMoment, tensionMoment, funniestReason, mostLovingMoment, mostEnergising, and mostDraining may use 1-2 short sentences if that keeps them specific rather than flat. MOMENT PICKING: For funniestReason, sweetMoment, tensionMoment, mostLovingMoment, mostEnergising, and mostDraining, choose the strongest supported moment or repeated pattern, not the safest bland example. Prefer a clear trigger, quote or move, and reaction or consequence. If several moments fit, pick the one that best captures the dynamic. ANTI-REPETITION: sweetMoment and mostLovingMoment must describe different events. sweetMoment = a specific act of care, support, or going out of their way. mostLovingMoment = a warm affectionate exchange, compliment, or emotional closeness. They must reference different messages. No two fields anywhere in the output should quote the same message. SIGNATURE PHRASES: Before assigning a phrase to a person, verify by checking which sender's line it appears on most. signaturePhrases[0] must be a phrase only person 1 sends; signaturePhrases[1] must be a phrase only person 2 sends. Never guess or swap attribution. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers - each window is a non-contiguous excerpt from the full history. Never connect or combine events from different windows unless the messages themselves explicitly link them. SPEAKER ATTRIBUTION: Every message line is formatted as [timestamp] SpeakerName: body - the name before the colon is always and only the sender. Assign every quote, action, and behaviour to the name shown on that exact line. Never swap or infer the sender. FUNNY ATTRIBUTION: Whenever you see a laugh reaction (😂, lol, lmao, 'im dead', 💀, 🤣, haha, or similar) from person B immediately following a line from person A, the funny person is person A - the one whose line caused the reaction. Never attribute humour to the person who is laughing. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone. DIRECTION OF ACTIONS: For sweetMoment, kindestPerson, energy, and love-language reads, the actor is the sender of that exact line. For all "name" fields return ONLY the person's first name, with no explanation. Only report findings you can directly support from the chat. If evidence is weak, use "None clearly identified". SUMMARY FIELD RULES: vibeOneLiner and biggestTopic must reflect recurring patterns across the full chat, not one isolated window. biggestTopic should sound like the chat's actual ongoing storyline, not a category label. It should be both recurring and important to the dynamic; do not elevate minor logistics, running bits, or low-stakes side debates just because they repeat. funniestReason should name the exact line or move that triggered the laugh, not the reaction itself. relationshipSummary should sound like a specific read on their dynamic, not a generic status label. insideJoke must be recurring across multiple windows. Keep quotes short and exact when used; do not translate them.`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages. ${math.totalMessages > 10000 ? `This is a very large chat - keep every answer compact. Summary fields must reflect dominant patterns that recur across the full history, not one standout moment.` : ""} The content below is divided into ISOLATED WINDOWS from across the full history - each labelled ━━━ WINDOW N/N · date · type ━━━. Windows are non-contiguous excerpts; do not infer connections between separate windows. Every line shows the speaker: [timestamp] SpeakerName: body.

IMPORTANT CONTEXT: ${isGroup ? `The least active member (the ghost) is ${math.ghost}. The conversation starter is ${math.convStarter}.` : `By reply time, ${math.ghostName} is slower to respond. The conversation starter is ${math.convStarter}. Local analysis found that ${math.funniestPerson} caused the most laugh reactions from the other person (${math.laughCausedBy?.[math.funniestPerson] || 0} times) - confirm or correct this based on the chat.`}
${!isGroup && relationshipContext?.evidence ? `RELATIONSHIP EVIDENCE: A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}". Use it as confirmation, but do not over-quote it.` : ""}

EVENT WINDOWS:
${chatText}

Return exactly this JSON structure. JSON rules: (1) return ONLY valid JSON — no markdown, no text outside the JSON object; (2) the "examples" field MUST be an array of strings where each item is one sentence under 120 characters with no embedded line breaks; (3) never embed literal newline or tab characters inside any string value anywhere in the output.
${fields}`;

  return {
    pipeline: "connection",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    relationshipContext,
    relationshipLine,
  };
}

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
      "arcSummary": "1 sharp sentence capturing the full growth arc"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp chat analyst building a compact growth digest",
    relationshipType,
    `GROWTH DIGEST SCOPE: only relationship evolution over time. Do NOT generate funny moments, kindness, inside jokes, energy, red flags, accountability, timelines, or relationship labels. Compare the EARLY snapshot, the BRIDGE WINDOWS, and the RECENT snapshot to read how the conversation changed. Keep every free-text field compact and direct: one sentence whenever possible, no filler, no repeated ideas across fields. SPEAKER ATTRIBUTION: Every message line is formatted as [timestamp] SpeakerName: body - assign all quotes and changes only to the name shown on that exact line. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone or emoji use alone. If the evidence for change is mixed, prefer "about the same" or "stable" over forcing a dramatic arc.`,
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
    relationshipContext,
    relationshipLine,
  };
}

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
        "languageEmoji": "1 emoji representing that care style",
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
    "vibeOneLiner": "One sharp memorable sentence that nails exactly what this chat *is* — specific to these people, not a mood label. If you can't nail it, keep it simple.",
    "biggestTopic": "1 sentence — what actually keeps coming up across the chat. Name the specific thing, not the category: not 'relationships' but 'whether [Person] should quit their job' or 'trips they plan but never take'.",
    "ghostContext": "1 sentence - explain WHY the slower replier takes longer to respond, based on observable patterns in the chat such as time of day, topic avoidance, or mood. Do not repeat the numeric response time. Do not mention unanswered messages.",
    "funniestPerson": "ONLY the first name of the funniest person, or 'None clearly identified'",
    "funniestReason": "Name the specific line or moment that got the biggest reaction. Write it as 'drops lines like...' then the actual quote. Reference what caused the laugh, not the laugh itself. Under 20 words.",
    "dramaStarter": "ONLY a first name, 'Shared', or 'None clearly identified'",
    "dramaContext": "1 sentence — describe the real pattern with one concrete moment from the chat. What do they actually do, and what did they say or drop that set it off ('exact quote'). No exaggeration.",
    "signaturePhrases": ["real phrase or expression person 1 uses a lot", "real phrase or expression person 2 uses a lot"],
    "relationshipStatus": "duo only: short relationship-status label, or 'None clearly identified'",
    "relationshipStatusWhy": "1 sentence - why that status fits, using objective evidence",
    "statusEvidence": "1 short line with a concrete dated example if possible",
    "toxicPerson": "ONLY a first name, 'Tie', or 'None clearly identified'",
    "toxicReason": "1 sentence - factual and conservative explanation of that read",
    "toxicityReport": "1 sentence - balanced, observable summary of tension or health",
    "redFlags": [
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" }
    ],
    "evidenceTimeline": [
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" }
    ],
    "relationshipSummary": "1 sentence — what's actually going on between them, in plain human terms. Specific about the pattern, not a label or diagnosis.",
    "groupDynamic": "1 sentence - honest read of this group's energy. Specific about who does what and what the group runs on.",
    "tensionMoment": "1 sentence — the most tense moment: what triggered it and how it played out. Support with a real quote. Describe clearly, don't amplify.",
    "kindestPerson": "ONLY a first name - the warmest/caring person, or 'None clearly identified'",
    "sweetMoment": "1 sentence — name the person, what they said or did, and why it landed. The shape is 'When [Person] [did specific thing] for [Other]'. Not a warm routine — actual effort, support, or going out of their way.",
    "mostMissed": "group only: ONLY a first name, or 'None clearly identified'",
    "insideJoke": "group only: 1 sentence - a recurring joke, meme, reference, or expression that keeps coming back in the chat. Must appear in at least two separate windows. Quote the actual phrase or expression exactly as it appears in the chat.",
    "hypePersonReason": "group only: 1 sentence - specifically how this person energises the group, with a real example of the kind of thing they say or do. Not generic - something that actually appears in the chat.",
    "loveLanguageMismatch": "1 sentence - how their care styles align or mismatch in practice",
    "mostLovingMoment": "1 sentence - the most genuinely warm or loving moment in the chat. Describe what happened and who was involved, with the actual message or action as evidence.",
    "compatibilityScore": [1-10],
    "compatibilityRead": "1 sentence - love-language compatibility summary",
    "mostEnergising": "1 sentence - the single most energising moment or exchange. Describe what happened and quote the line that best captures it.",
    "mostDraining": "1 sentence - the single most draining moment or recurring pattern. Describe what happened and quote the line that best illustrates it.",
    "energyCompatibility": "1 sentence - how their energy styles work together (or don't)",
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
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a canonical core-analysis object that later reports will reuse",
    relationshipType,
    `CORE-A SCOPE: relationship dynamic, communication patterns, funny moments, kindness moments, energy, love language, and growth trajectory. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers - each window is a non-contiguous excerpt from the full history. Never connect or combine events from different windows unless the messages themselves explicitly link them. You will also receive EARLY and RECENT contiguous snapshots; use those specifically for growth/change fields, and use the event windows for specific moments and recurring patterns. SPEAKER ATTRIBUTION: Every message line is formatted as [timestamp] SpeakerName: body - the name before the colon is always and only the sender. Assign every quote, action, and behaviour to the name shown on that exact line. Never swap or infer the sender. FUNNY ATTRIBUTION: Whenever you see a laugh reaction (😂, lol, lmao, 'im dead', 💀, 🤣, haha, or similar) from person B immediately following a line from person A, the funny person is person A - the one whose line caused the reaction. Never attribute humour to the person who is laughing. This rule applies everywhere in the chat, regardless of window label. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone - a warm message between cousins does not make them romantic partners, a casual message between partners does not make them friends. Always use the confirmed relationship label when describing who did something to whom. DIRECTION OF ACTIONS: For sweetMoment, kindestPerson, and energy/love-language reads, the actor is the sender of that exact line. For all "name" fields return ONLY the person's first name, with no explanation. Each timestamp already includes the day of week - read it directly and never calculate it yourself. Only report findings you can directly cite from the chat - if evidence is weak, use "None clearly identified". QUOTE RULE: For funniestReason, sweetMoment, dramaContext, tensionMoment, mostLovingMoment, mostEnergising, mostDraining, hypePersonReason, insideJoke, and ghostContext - find the actual line from the chat that best illustrates the finding and include it as supporting evidence. The format is: your sentence describing what happened or the pattern, then the supporting quote in parentheses at the end like this: ('exact quote here'). The sentence must be meaningful on its own - the quote supports it, not replaces it. Do not explain or translate the quote after the closing parenthesis. If no specific supporting line exists in the windows for a field, write the sentence without a quote rather than inventing one. Do not translate quotes - reproduce them exactly as written in their original language. SUMMARY FIELD RULES: vibeOneLiner must capture the dominant emotional tone of the entire chat - never base it on a single moment, window, or exchange. insideJoke must be a recurring reference that appears in multiple windows - if you only saw it once, use 'None clearly identified'. biggestTopic must be the most consistently recurring subject across the full history, not the most dramatic single event. For all three fields: if you cannot confirm recurrence across multiple windows, do not claim it. When quoting messages in any language, quote them as-is - do not translate them. ALL PARTICIPANTS IN THIS CHAT: ${names.slice(0, isGroup ? names.length : 2).join(", ")}. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"} only - one entry per slotted participant. Participants not in the people array may still appear as senders in the windows. Track their behaviour for shared fields (dramaStarter, toxicPerson, funniestPerson, kindestPerson, etc.) but do not create people entries for them. Never fold an unslotted participant's actions into a slotted participant's entry.`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages. ${math.totalMessages > 10000 ? `This is a very large chat - every summary field (especially vibeOneLiner, biggestTopic, insideJoke) must reflect dominant patterns that recur across the full history. A single window is a tiny fraction of the whole. Never let one moment, joke, or exchange define a summary field. Weight only what appears repeatedly across multiple windows.` : ""} The content below is divided into ISOLATED WINDOWS from across the full history - each labelled ━━━ WINDOW N/N · date · type ━━━. Windows are non-contiguous excerpts; do not infer connections between separate windows. Every line shows the speaker: [timestamp] SpeakerName: body - assign all quotes and actions only to the name on that specific line.

IMPORTANT CONTEXT: ${isGroup ? `The least active member (the ghost) is ${math.ghost}. The conversation starter is ${math.convStarter}.` : `By reply time, ${math.ghostName} is slower to respond. The conversation starter is ${math.convStarter}. Local analysis found that ${math.funniestPerson} caused the most laugh reactions from the other person (${math.laughCausedBy?.[math.funniestPerson] || 0} times) - confirm or correct this based on the chat.`}
${!isGroup && relationshipContext?.evidence ? `RELATIONSHIP EVIDENCE: A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}". Use it as confirmation, but do not over-quote it.` : ""}

EARLY SNAPSHOT (contiguous excerpt from the start of the chat - use ONLY for growth/change fields: thenDepth, nowDepth, depthChange, whoChangedMore, whoChangedHow, topicsAppeared, topicsDisappeared, trajectory, trajectoryDetail, arcSummary):
${earlyText}

RECENT SNAPSHOT (contiguous excerpt from the end of the chat - use ONLY for the same growth/change fields listed above. Do not cite snapshot content for any other field):
${lateText}

EVENT WINDOWS (use these for all non-growth fields - specific moments, quotes, patterns, kindness, humor, tension, red flags, love language, energy):
${chatText}

Return exactly this JSON structure. JSON rules: (1) return ONLY valid JSON — no markdown, no text outside the JSON object; (2) the "examples" field MUST be an array of strings where each item is one sentence under 120 characters with no embedded line breaks; (3) never embed literal newline or tab characters inside any string value anywhere in the output.
${fields}`;

  return {
    pipeline: "coreA",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    relationshipContext,
    relationshipLine,
  };
}

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
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "1 sentence - how arguments usually start and resolve or fail to resolve",
      "powerBalance": "1 sentence - who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 punchy sentence verdict on the overall health of this chat"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do - quote or close paraphrase",
        "date": "approximate date",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "date": "approximate date",
        "outcome": "how they followed through"
      },
      "overallVerdict": "1 sentence verdict on accountability in this chat overall"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building the canonical core-b object",
    relationshipType,
    `CORE-B SCOPE: toxicity, health scores, apology patterns, conflict patterns, power balance, red flag moments, and accountability. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers - never connect separate windows unless the messages explicitly link them. SPEAKER ATTRIBUTION: Every line is [timestamp] SpeakerName: body - all behaviour belongs only to the sender on that exact line. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone. Always use the confirmed relationship label when describing who did something to whom. Be conservative: one or two examples do not prove a stable pattern. If the balance is mixed, prefer "Balanced", "Tie", or "None clearly identified" over forcing one villain. For accountability: a promise is BROKEN only if there is clear evidence it was never fulfilled or the person explicitly backed out. A promise fulfilled late is still KEPT. Do not count vague ideas like "we should hang out sometime" as promises. Never combine two separate events into one story. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, with one people entry per participant in that subset.`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). ${!isGroup && relationshipContext?.evidence ? `A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}".` : ""} The content below is ISOLATED WINDOWS from across the full history. Do not connect events across windows unless the messages explicitly link them. Every line shows the speaker: [timestamp] SpeakerName: body.

${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "coreB",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
    relationshipContext,
    relationshipLine,
  };
}

export function prepareRiskDigestRequest({
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
        { "date": "approximate date", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "short factual description", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "1 short sentence - how arguments usually start and resolve or fail to resolve",
      "powerBalance": "1 short sentence - who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 short sentence verdict on the overall health of this chat"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do - quote or close paraphrase",
        "date": "approximate date",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to - quote or close paraphrase",
        "date": "approximate date",
        "outcome": "how they followed through"
      },
      "overallVerdict": "1 short sentence verdict on accountability in this chat overall"
    }
  }
}`;

  const systemPrompt = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building a compact risk digest",
    relationshipType,
    `RISK DIGEST SCOPE: toxicity, chat health, apology patterns, conflict patterns, power balance, red flag moments, and accountability. Do NOT generate relationship summaries, growth, timelines, love-language, or energy reads. Keep every free-text field compact and factual: one sentence whenever possible, no padding, no repeated ideas across fields. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers - never connect separate windows unless the messages explicitly link them. SPEAKER ATTRIBUTION: Every line is [timestamp] SpeakerName: body - all behaviour belongs only to the sender on that exact line. RELATIONSHIP LANGUAGE: The user selected relationship type is "${relationshipType}". ${relationshipLine} Never infer or override the relationship type from tone, emoji use, or affection level alone. Always use the confirmed relationship label when describing who did something to whom. Be conservative: one or two examples do not prove a stable pattern. If the balance is mixed, prefer "Balanced", "Tie", or "None clearly identified" over forcing one villain. For accountability: a promise is BROKEN only if there is clear evidence it was never fulfilled or the person explicitly backed out. A promise fulfilled late is still KEPT. Do not count vague ideas like "we should hang out sometime" as promises. Never combine two separate events into one story. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, with one people entry per participant in that subset.`,
    chatLang,
    relationshipLine
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). ${!isGroup && relationshipContext?.evidence ? `A direct-address snippet supporting the confirmed relationship is: "${relationshipContext.evidence}".` : ""} The content below is ISOLATED WINDOWS from across the full history. Do not connect events across windows unless the messages explicitly link them. Every line shows the speaker: [timestamp] SpeakerName: body.

${chatText}

Return exactly this JSON structure:
${fields}`;

  return {
    pipeline: "risk",
    systemPrompt,
    userContent,
    maxTokens,
    schemaMode: "analysis",
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
