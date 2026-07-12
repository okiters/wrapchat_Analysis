import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareConnectionDigestRequest,
  prepareGrowthDigestRequest,
  prepareRiskDigestRequest,
  prepareCoreAnalysisARequest,
  prepareCoreAnalysisBRequest,
} from "../analysis-test/aiDebugHelpers.js";
import { buildVoiceSection } from "../src/analysis/voice.js";

// The builders receive the system-prompt assembler as a parameter, so they can
// be tested pure. The stub echoes its inputs so we can assert what each
// pipeline contributes.
const stubSystemPromptBuilder = (role, relationshipType, extraRules, chatLang, relationshipLine) =>
  `ROLE=${role}\nREL=${relationshipType}\nLINE=${relationshipLine}\nLANG=${chatLang}\nSCOPE=${extraRules}`;
const stubRelationshipLine = () => "CONFIRMED RELATIONSHIP LINE";
const stubSampleText = () => "━━━ WINDOW 1/1 · 2024-01-01 Mon · excerpt ━━━\n[2024-01-01 Mon 10:00] A: hi";
const stubFormatForAI = messages => messages.map(m => `[x] ${m.name}: ${m.body}`).join("\n");

const baseMath = {
  names: ["Derin", "Mia"],
  isGroup: false,
  totalMessages: 1234,
  ghostName: "Mia",
  convStarter: "Derin",
  funniestPerson: "Derin",
  laughCausedBy: { Derin: 7 },
  topWords: [["berlin", 22], ["sinav", 15]],
  topBigrams: [["berlin trip", 9]],
};
const baseMessages = Array.from({ length: 30 }, (_, i) => ({
  name: i % 2 ? "Mia" : "Derin",
  body: `message number ${i}`,
  date: new Date(2024, 0, 1 + i),
}));

function build(prepare, extra = {}) {
  return prepare({
    messages: baseMessages,
    math: baseMath,
    relationshipType: "friend",
    chatLang: "en",
    relationshipContext: null,
    buildAnalystSystemPrompt: stubSystemPromptBuilder,
    buildRelationshipLine: stubRelationshipLine,
    buildSampleText: stubSampleText,
    formatForAI: stubFormatForAI,
    coreAnalysisVersion: 2,
    maxTokens: 1000,
    ...extra,
  });
}

test("each pipeline carries the right schemaId", () => {
  assert.equal(build(prepareConnectionDigestRequest).schemaId, "connection");
  assert.equal(build(prepareGrowthDigestRequest).schemaId, "growth");
  assert.equal(build(prepareRiskDigestRequest).schemaId, "risk");
  assert.equal(build(prepareCoreAnalysisARequest).schemaId, null);
  assert.equal(build(prepareCoreAnalysisBRequest).schemaId, null);
});

test("scope rules no longer duplicate globally-owned rules", () => {
  for (const prepare of [prepareConnectionDigestRequest, prepareGrowthDigestRequest, prepareRiskDigestRequest]) {
    const request = build(prepare);
    // These all live once in buildAnalystSystemPrompt now; a scope block that
    // mentions them re-introduces the duplication this restructure removed.
    for (const banned of ["WINDOW FORMAT", "SPEAKER ATTRIBUTION", "FUNNY ATTRIBUTION", "RELATIONSHIP LANGUAGE", "em dash"]) {
      assert.ok(
        !request.systemPrompt.includes(`SCOPE=`) || !request.systemPrompt.split("SCOPE=")[1].includes(banned),
        `${request.pipeline} scope re-states "${banned}"`
      );
    }
  }
});

test("candidate moments are embedded when provided, absent otherwise", () => {
  const candidatesText = "CANDIDATE MOMENTS (pre-extracted locally from the full history):\n#1 [funny · early on] Derin: \"x\"";
  const withCandidates = build(prepareConnectionDigestRequest, { candidatesText });
  assert.ok(withCandidates.userContent.includes("CANDIDATE MOMENTS"));
  assert.equal(withCandidates.userContent.split("CANDIDATE MOMENTS").length, 2);
  const without = build(prepareConnectionDigestRequest);
  assert.ok(!without.userContent.includes("CANDIDATE MOMENTS"));
});

test("topic spread line is derived from local math", () => {
  const request = build(prepareConnectionDigestRequest);
  assert.ok(request.userContent.includes("RECURRING TOPICS"));
  assert.ok(request.userContent.includes("berlin trip"));
});

test("risk accountability rules appear exactly once per prompt", () => {
  const request = build(prepareRiskDigestRequest);
  const occurrences = request.systemPrompt.split("a promise is BROKEN only if").length - 1;
  assert.ok(occurrences <= 1, `BROKEN-promise rule appears ${occurrences} times`);
});

test("pseudo-schemas keep their schema-critical enums", () => {
  const connection = build(prepareConnectionDigestRequest);
  assert.ok(connection.userContent.includes("Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed"));
  assert.ok(connection.userContent.includes("net positive / mixed / net draining"));
  const growth = build(prepareGrowthDigestRequest);
  assert.ok(growth.userContent.includes("deeper / shallower / about the same"));
  assert.ok(growth.userContent.includes("closer / drifting / stable"));
});

test("voice section is single-sourced and dash-free in all languages", () => {
  for (const lang of ["en", "tr", "es", "pt", "fr", "de", "it", "ar"]) {
    const section = buildVoiceSection(lang);
    assert.ok(section.includes("CALIBRATION EXAMPLES"));
    assert.ok(!/[—–]/.test(section));
  }
});
