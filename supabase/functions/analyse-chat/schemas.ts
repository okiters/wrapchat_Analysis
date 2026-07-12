// JSON output schemas for structured outputs (output_config.format).
// Shape enforcement only — field-level guidance lives in the client prompts.
// Keys must stay in lockstep with the client normalizers in
// src/analysis/aiAnalysis.js and the pseudo-schemas in analysis-test/aiDebugHelpers.js.
//
// Structured-outputs constraints honoured here: every object carries
// additionalProperties:false with all properties required; no numeric or
// string min/max constraints; enums only for schema-critical control tokens.

type Schema = Record<string, unknown>;

const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const nullableStr: Schema = { type: ["string", "null"] };

function obj(properties: Record<string, Schema>): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function arr(items: Schema): Schema {
  return { type: "array", items };
}

function enumOf(...values: string[]): Schema {
  return { type: "string", enum: values };
}

const meta = obj({ confidenceNote: str, dominantTone: str });

const LOVE_LANGUAGE_ENUM = enumOf(
  "Words of Affirmation",
  "Acts of Service",
  "Receiving Gifts",
  "Quality Time",
  "Physical Touch",
  "Mixed",
);
const ENERGY_TYPE_ENUM = enumOf("net positive", "mixed", "net draining");
const DAYPART_ENUM = enumOf("morning", "afternoon", "evening", "late night");

const timeOfDayPerson = obj({ name: str, peakHour: str, peakDaypart: DAYPART_ENUM });

const connectionPerson = obj({
  name: str,
  careStyle: obj({
    language: LOVE_LANGUAGE_ENUM,
    examples: arr(str),
    score: int,
  }),
  energy: obj({
    netScore: int,
    type: ENERGY_TYPE_ENUM,
    goodNews: str,
    venting: str,
    hypeQuote: str,
  }),
});

const connectionSchema = obj({
  schemaVersion: int,
  meta,
  people: arr(connectionPerson),
  shared: obj({
    vibeOneLiner: str,
    biggestTopic: str,
    ghostContext: str,
    funniestPerson: str,
    funniestReason: str,
    dramaStarter: str,
    dramaContext: str,
    signaturePhrases: arr(str),
    relationshipSummary: str,
    groupDynamic: str,
    tensionMoment: str,
    kindestPerson: str,
    sweetMoment: str,
    mostMissed: str,
    insideJoke: str,
    hypePersonReason: str,
    loveLanguageMismatch: str,
    mostLovingMoment: str,
    compatibilityScore: int,
    compatibilityRead: str,
    mostEnergising: str,
    mostDraining: str,
    energyCompatibility: str,
    timeOfDay: obj({ personA: timeOfDayPerson, personB: timeOfDayPerson, contrast: str }),
    loveLanguageIntro: str,
    loveMiss: obj({ description: str, quote: str, persons: arr(str) }),
    loveMissUnspoken: str,
    energyDynamic: str,
    guessThresholds: obj({ loveLanguageGuessValid: bool, energyGuessValid: bool }),
  }),
});

const growthSchema = obj({
  schemaVersion: int,
  meta,
  people: arr(obj({})),
  shared: obj({
    growth: obj({
      thenDepth: str,
      nowDepth: str,
      depthChange: enumOf("deeper", "shallower", "about the same"),
      whoChangedMore: str,
      whoChangedHow: str,
      topicsAppeared: str,
      topicsDisappeared: str,
      trajectory: enumOf("closer", "drifting", "stable"),
      trajectoryDetail: str,
      arcSummary: str,
      personAArc: str,
      personBArc: str,
      turningPoint: str,
      messageAtTurningPoint: obj({ quote: str, person: str, contextParagraph: str }),
      growthGuessThreshold: bool,
    }),
  }),
});

const riskPerson = obj({
  name: str,
  health: obj({ score: int, detail: str, apologyCount: int, apologyContext: str }),
  accountability: obj({ total: int, kept: int, broken: int, score: int, detail: str }),
});

const apologySummary = obj({ name: str, count: int, context: str });
const promiseMoment = obj({ person: str, promise: str, date: str, outcome: str });

const riskSchema = obj({
  schemaVersion: int,
  meta,
  people: arr(riskPerson),
  shared: obj({
    toxicity: obj({
      chatHealthScore: int,
      healthScores: arr(obj({ name: str, score: int, detail: str })),
      apologiesLeader: apologySummary,
      apologiesOther: apologySummary,
      redFlagMoments: arr(obj({ date: str, person: str, description: str, quote: str })),
      conflictPattern: str,
      powerBalance: str,
      powerHolder: str,
      verdict: str,
      whatStillHere: str,
      heavyAttributionQuote: obj({ quote: str, person: str, contextParagraph: str, isSensitive: bool }),
      apologyGuessThreshold: bool,
      powerGuessThreshold: bool,
    }),
    accountability: obj({
      notableBroken: promiseMoment,
      notableKept: promiseMoment,
      comparison: str,
      followThroughPattern: str,
      evidenceQuality: str,
      overallVerdict: str,
      reliabilityArc: str,
      promiseThatMattered: obj({ person: str, promise: str, outcome: str, contextParagraph: str }),
      promiseGuessThreshold: bool,
    }),
  }),
});

const relationshipSchema = obj({
  category: enumOf("partner", "dating", "ex", "family", "friend", "colleague", "other", "unknown"),
  specificRelationship: str,
  confidence: enumOf("high", "medium", "low"),
  reasoning: str,
  evidence: str,
  endearmentWarning: nullableStr,
});

const trialSchema = obj({ vibe: str, pattern: str, takeaway: str });

const translationSchema = obj({
  items: arr(obj({ path: str, text: str })),
});

export const OUTPUT_SCHEMAS: Record<string, Schema> = {
  connection: connectionSchema,
  growth: growthSchema,
  risk: riskSchema,
  relationship: relationshipSchema,
  trial: trialSchema,
  translation: translationSchema,
};
