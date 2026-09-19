// The love-language guess offers the real answer against decoys from the
// canonical five. It used to offer [langA, langB] — the two people's actual
// answers — which made it a coin flip, revealed the second person's answer
// while you guessed the first, and collapsed to one option (disabling the card)
// whenever the pair shared a language.
//
// The helper lives in Screens.jsx, which cannot be imported here (JSX). This
// mirrors it exactly; the assertions below are the contract it must keep.
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// aiAnalysis pulls in a Vite `?raw` markdown import, so it needs the golden
// harness loader to resolve outside Vite (same as localMath.test.js).
globalThis.__WRAPCHAT_ENV__ = { DEV: false };
register(new URL("../scripts/golden/loader.mjs", import.meta.url));
const { LOVE_LANG_CANONICAL } = await import("../src/analysis/aiAnalysis.js");

const stableHash = (value) => {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

function loveLanguageGuessOptions(correct, seed = "") {
  if (!correct) return [];
  const byHash = key => (a, b) => stableHash(`${key}|${a}`) - stableHash(`${key}|${b}`);
  const decoys = LOVE_LANG_CANONICAL
    .filter(lang => lang !== correct && lang !== "Mixed")
    .sort(byHash(`${seed}|decoy`))
    .slice(0, 3);
  return [correct, ...decoys].sort(byHash(`${seed}|order`));
}

test("offers four options and always includes the real answer", () => {
  for (const lang of LOVE_LANG_CANONICAL) {
    const options = loveLanguageGuessOptions(lang, "Ozge|Aynuke");
    assert.equal(options.length, 4, `${lang} gave ${options.length} options`);
    assert.ok(options.includes(lang), `${lang} missing from its own options`);
    assert.equal(new Set(options).size, 4, `${lang} has duplicate options`);
  }
});

test("never offers Mixed as a decoy, but shows it when it is the answer", () => {
  for (const lang of LOVE_LANG_CANONICAL.filter(l => l !== "Mixed")) {
    assert.ok(!loveLanguageGuessOptions(lang, "s").includes("Mixed"), `${lang} offered Mixed as a decoy`);
  }
  assert.ok(loveLanguageGuessOptions("Mixed", "s").includes("Mixed"));
});

test("a shared language still yields a full guess", () => {
  // The old implementation produced one option here and disabled the card.
  const a = loveLanguageGuessOptions("Quality Time", "Ozge|Aynuke");
  const b = loveLanguageGuessOptions("Quality Time", "Aynuke|Ozge");
  assert.equal(a.length, 4);
  assert.equal(b.length, 4);
});

test("options are stable for a given result and vary between results", () => {
  const first = loveLanguageGuessOptions("Acts of Service", "Ozge|Aynuke");
  assert.deepEqual(loveLanguageGuessOptions("Acts of Service", "Ozge|Aynuke"), first);
  const other = loveLanguageGuessOptions("Acts of Service", "Ozge|Hubby");
  assert.notDeepEqual(other, first);
});

test("no answer means no guess", () => {
  assert.deepEqual(loveLanguageGuessOptions("", "s"), []);
  assert.deepEqual(loveLanguageGuessOptions(null, "s"), []);
});
