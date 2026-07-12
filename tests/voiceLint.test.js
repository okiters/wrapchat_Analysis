import test from "node:test";
import assert from "node:assert/strict";
import { lintText, lintResult, flattenResultStrings, lintQuoteGrounding } from "../src/analysis/voiceLint.js";
import { buildVoiceSection, BANNED_PHRASES } from "../src/analysis/voice.js";

test("flags em and en dashes", () => {
  assert.ok(lintText("A scene — with a dash", "x").some(i => i.rule === "long-dash"));
  assert.ok(lintText("range 3–5", "x").some(i => i.rule === "long-dash"));
  assert.equal(lintText("clean, spoken flow: no dash", "x").length, 0);
});

test("flags emojis in result text", () => {
  const issues = lintText("Derin brings the chaos 😂 every time", "x");
  assert.ok(issues.some(i => i.rule === "emoji"));
});

test("flags analysis-mechanics leaks", () => {
  assert.ok(lintText("In window 3 they argue about the trip", "x").some(i => i.rule === "mechanics-leak"));
  assert.ok(lintText("The early snapshot shows small talk", "x").some(i => i.rule === "mechanics-leak"));
  assert.ok(lintText("Derin sends [number] to coordinate", "x").some(i => i.rule === "mechanics-leak"));
  assert.equal(lintText("They talk by the window every morning", "x").filter(i => i.rule === "mechanics-leak").length, 0);
});

test("flags banned analyst phrases", () => {
  const issues = lintText("This shows that they care deeply.", "x");
  assert.ok(issues.some(i => i.rule === "banned-phrase"));
});

test("flags repeated quotes across two fields", () => {
  const issues = lintResult({
    sweetMoment: `When Derin says 'sensiz atlatamam bu ayı' after the trip plan.`,
    mostLovingMoment: `The line 'sensiz atlatamam bu ayı' lands again here.`,
  });
  assert.ok(issues.some(i => i.rule === "repeated-quote"));
});

test("flags near-identical fields as similar", () => {
  const issues = lintResult({
    tensionMoment: "Derin keeps cancelling the weekend plans about the Berlin trip every single time",
    dramaContext: "Derin keeps cancelling the weekend plans about the Berlin trip every time",
  });
  assert.ok(issues.some(i => i.rule === "similar-fields" || i.rule === "repeated-quote"));
});

test("flags generic moment fields without name or quote", () => {
  const issues = lintResult({ sweetMoment: "they are always there for each other and it is very kind." });
  assert.ok(issues.some(i => i.rule === "generic"));
});

test("accepts a reference-tone field", () => {
  const issues = lintResult({
    sweetMoment: `When they're planning to meet up and Derin says 'Sensiz atlatamam bu ayı'. Pure wholesome friendship dependency.`,
  });
  assert.equal(issues.filter(i => i.level === "error").length, 0);
});

test("ignores the embedded coreAnalysis metadata subtree", () => {
  const issues = lintResult({
    sweetMoment: `When Derin brings 'ilaçlarını getircem' out of nowhere. Quiet devotion.`,
    coreAnalysis: { shared: { sweetMoment: `When Derin brings 'ilaçlarını getircem' out of nowhere. Quiet devotion.` } },
  });
  assert.equal(issues.length, 0);
});

test("quote-valued and period-label leaves are exempt from the generic check", () => {
  const issues = lintResult({
    turningPoint: "a few months in",
    messageAtTurningPoint: { quote: "seni ozledim ya", person: "Derin", contextParagraph: "After this, Derin starts planning the visits." },
    personA: { hypeQuote: "biz bu berlinde hukum sureriz" },
  });
  assert.ok(!issues.some(i => i.rule === "generic"), JSON.stringify(issues));
});

test("flags narrator romance vocabulary on platonic reports, allows it inside quotes", () => {
  const flagged = lintResult({
    relationshipType: "friend",
    vibeOneLiner: "ikisi de bunun aşk olduğunu biliyor",
  });
  assert.ok(flagged.some(i => i.rule === "romantic-narration"));
  const quoted = lintResult({
    relationshipType: "friend",
    funniestReason: "'Sacma sapan bi aşk bizimkisi' dedikten sonra kahkaha patlattı; kendi dostluklarını absürtleştirme sanatı.",
  });
  assert.ok(!quoted.some(i => i.rule === "romantic-narration"), JSON.stringify(quoted));
});

test("quote grounding: flags quotes that never appear in the chat, tolerates sanitiser edits", () => {
  const corpus = "dun aksam Josh'tan ayrildim ya 😭\nAskim Tim in çalışma dönemi bitmişse geliriz";
  const grounded = lintQuoteGrounding({
    venting: "Eylul 'dun aksam Joshtan ayrildim ya' diye acildi; agir bir hafta.",
  }, corpus);
  assert.equal(grounded.length, 0, JSON.stringify(grounded));
  const invented = lintQuoteGrounding({
    venting: "Ozge 'Tim ile ayrilik surecindeyim artik' dedi.",
  }, corpus);
  assert.ok(invented.some(i => i.rule === "ungrounded-quote"));
});

test("quote grounding ignores Turkish suffix apostrophes", () => {
  const corpus = "selam nasilsin bugun hava cok guzel";
  const issues = lintQuoteGrounding({
    tensionMoment: "Hamza'nın hastalığını ve taşınmayı üst üste sıralarken Ozge'nin tek cevabı ağır kaldı.",
  }, corpus);
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

test("flattenResultStrings walks nested objects and arrays", () => {
  const flat = flattenResultStrings({ a: { b: "x" }, list: [{ q: "y" }] });
  assert.deepEqual(flat, { "a.b": "x", "list.0.q": "y" });
});

test("voice section itself contains no long dashes and exactly one punctuation rule", () => {
  for (const lang of ["en", "tr", "es", "ar"]) {
    const section = buildVoiceSection(lang);
    assert.ok(!/[—–]/.test(section), `voice section for ${lang} contains a long dash`);
    assert.equal((section.match(/PUNCTUATION:/g) || []).length, 1);
  }
});

test("voice section carries a native register example for supported languages", () => {
  assert.ok(buildVoiceSection("tr").includes("Register example"));
  assert.ok(buildVoiceSection("de").includes("Register example"));
  assert.ok(!buildVoiceSection("en").includes("Register example"));
});

test("banned phrase list is lowercase (matching is case-insensitive)", () => {
  for (const phrase of BANNED_PHRASES) assert.equal(phrase, phrase.toLowerCase());
});
