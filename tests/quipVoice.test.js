// A quip sits under almost every card, so it is the app's most-repeated voice.
// The failure mode these guard against is the one that made them read like
// fortune cookies: GRADING the number ("that kind of consistency is rare")
// instead of reacting to it ("neither of you once got too busy").
import test from "node:test";
import assert from "node:assert/strict";
import { UI_TRANSLATIONS } from "../src/i18n/translations.js";

const LANGS = ["en", "tr", "es", "pt", "ar", "fr", "de", "it"];
const quipKeys = obj => Object.keys(obj).filter(key => key.startsWith("quips."));

// Appraisal tics: they pass judgement on the stat rather than saying anything.
const APPRAISAL = [
  "that's rare", "that is rare", "means something", "still counts",
  "not bad at all", "that says a lot", "is something", "takes effort",
  "more than most", "this is what balance looks like", "suspiciously normal",
];

test("english quips never just grade the number", () => {
  const offenders = [];
  for (const key of quipKeys(UI_TRANSLATIONS.en)) {
    for (const line of UI_TRANSLATIONS.en[key]) {
      const lower = line.toLowerCase();
      for (const tic of APPRAISAL) {
        if (lower.includes(tic)) offenders.push(`${key}: "${line}" (${tic})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `appraisal instead of reaction:\n${offenders.join("\n")}`);
});

test("every language carries the same quip keys with three variants each", () => {
  const expected = quipKeys(UI_TRANSLATIONS.en).sort();
  for (const lang of LANGS) {
    assert.deepEqual(quipKeys(UI_TRANSLATIONS[lang]).sort(), expected, `${lang} key set differs`);
    for (const key of expected) {
      const variants = UI_TRANSLATIONS[lang][key];
      assert.ok(Array.isArray(variants) && variants.length === 3, `${lang}/${key} needs 3 variants`);
      variants.forEach(line => assert.ok(line.trim().length > 0, `${lang}/${key} has an empty variant`));
    }
  }
});

test("placeholders never drift between languages", () => {
  for (const key of quipKeys(UI_TRANSLATIONS.en)) {
    const want = [...new Set(UI_TRANSLATIONS.en[key].join(" ").match(/\{\w+\}/g) || [])].sort().join(",");
    for (const lang of LANGS) {
      const got = [...new Set(UI_TRANSLATIONS[lang][key].join(" ").match(/\{\w+\}/g) || [])].sort().join(",");
      assert.equal(got, want, `${lang}/${key} placeholders drifted`);
    }
  }
});
