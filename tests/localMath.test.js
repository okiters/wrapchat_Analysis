// localMath needs Vite-only resolution (extensionless paths, the supabase
// alias), so the golden harness loader is registered before importing it.
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__WRAPCHAT_ENV__ = { DEV: false };
register(new URL("../scripts/golden/loader.mjs", import.meta.url));

const { localStats } = await import("../src/analysis/localMath.js");
const { stripPromptInstruction, trimLongQuotes, clampMomentField, momentFieldText } = await import("../src/analysis/aiAnalysis.js");

// A calm two-person chat: alternating, quick replies, nothing hostile.
function calmChat(count, { startMs = Date.UTC(2026, 0, 1, 9, 0, 0), stepMs = 45_000 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    name: i % 2 ? "Bea" : "Ada",
    body: `talking about the plan for saturday number ${i}`,
    date: new Date(startMs + i * stepMs),
  }));
}

test("toxicity is a rate: a calm chat does not turn Heated just by getting longer", () => {
  const short = localStats(calmChat(300));
  const long = localStats(calmChat(12000));
  assert.equal(short.toxicityLevel, "Healthy");
  assert.equal(long.toxicityLevel, "Healthy",
    `a 12k-message calm chat scored ${Math.max(...long.toxicityScores)}`);
});

test("toxicity does not crown whoever simply sends the most messages", () => {
  // Ada sends three messages for every one of Bea's, and none are hostile.
  const messages = [];
  let clock = Date.UTC(2026, 0, 1, 9, 0, 0);
  for (let i = 0; i < 4000; i += 1) {
    clock += 40_000;
    messages.push({ name: i % 4 === 3 ? "Bea" : "Ada", body: `just chatting about dinner ${i}`, date: new Date(clock) });
  }
  const math = localStats(messages);
  assert.notEqual(math.toxicPerson, "Ada",
    "the highest-volume sender must not be named most toxic on volume alone");
});

test("reply times keep the fast replies and the real silences", () => {
  const messages = [];
  let clock = Date.UTC(2026, 0, 1, 9, 0, 0);
  // Ada answers in ~20 seconds; Bea disappears for two days at a time.
  for (let i = 0; i < 400; i += 1) {
    messages.push({ name: "Bea", body: `bea line ${i}`, date: new Date(clock) });
    clock += 20_000;
    messages.push({ name: "Ada", body: `ada line ${i}`, date: new Date(clock) });
    clock += 48 * 3600 * 1000;
  }
  const math = localStats(messages);
  // Ada's typical reply is ~20s and must be reported in seconds, not rounded
  // up past a minute the way the old >1-minute filter forced.
  assert.match(math.ghostAvg[math.names.indexOf("Ada")], /s$/,
    `expected a sub-minute median for Ada, got ${JSON.stringify(math.ghostAvg)}`);
  // The two-day gaps are Bea's, and they must not be discarded as >24h.
  assert.equal(math.ghostName, "Bea");
  assert.equal(math.ghostEqual, false);
});

test("streaks survive a daylight-saving boundary", () => {
  // 26-30 March 2026 spans the EU spring-forward (29 March).
  const days = [26, 27, 28, 29, 30].map(day => new Date(Date.UTC(2026, 2, day, 12, 0, 0)));
  const messages = days.flatMap((date, i) => ([
    { name: "Ada", body: `morning message ${i}`, date },
    { name: "Bea", body: `reply message ${i}`, date: new Date(date.getTime() + 60_000) },
  ]));
  assert.equal(localStats(messages).streak, 5);
});

test("a ubiquitous pet name is never a signature word", () => {
  const messages = [];
  let clock = Date.UTC(2026, 0, 1, 9, 0, 0);
  for (let i = 0; i < 600; i += 1) {
    clock += 60_000;
    // Ada says "kanka" constantly and "bombalamasyon" occasionally.
    const body = i % 2
      ? `kanka kanka bak sana diyorum ${i}`
      : (i % 10 === 0 ? "bombalamasyon yine oldu" : `tamam anladim ben ${i}`);
    messages.push({ name: i % 2 ? "Ada" : "Bea", body, date: new Date(clock) });
  }
  const math = localStats(messages);
  assert.ok(!math.signatureWord.includes("kanka"),
    `"kanka" is language furniture, not a signature: got ${JSON.stringify(math.signatureWord)}`);
});

test("prompt instructions never survive as user-facing copy", () => {
  assert.equal(stripPromptInstruction('Use the user-selected relationship type "friend" as the framing for this chat.'), "");
  assert.equal(stripPromptInstruction("Confirm or correct this from the chat."), "");
  assert.equal(stripPromptInstruction("They met at university and never lost touch."),
    "They met at university and never lost touch.");
});

// ── Moment-card voice guards ──
// A moment card is a friend telling you about the moment: setup, a short quote,
// the reaction, then the read. These guards keep the quote from eating the card.

test("a rambling message is quoted as a fragment, not pasted whole", () => {
  const rambling = "Ozge: 'ay beni fenalıklar bastı bi de stresli bi dönemdi test yaptırcam tek basıma "
    + "yaptırmak istemiyorum kalktım bi günlüğüne denizliye gittim anamla olayım bari kocam yok diye' dedi.";
  const out = trimLongQuotes(rambling);
  const quoted = out.match(/'([^']+)'/)[1];
  assert.ok(quoted.split(/\s+/).length <= 13, `quote still ${quoted.split(/\s+/).length} words`);
  assert.ok(out.length < rambling.length);
  // The kept fragment stays a literal prefix so quote-grounding still matches.
  assert.ok(rambling.includes(quoted.replace(/\.\.\.$/, "")));
});

test("a short quote is left exactly as written", () => {
  const fine = `She said "be nice to tiny people" and he lost it.`;
  assert.equal(trimLongQuotes(fine), fine);
});

test("the reaction quote survives while the long line is cut", () => {
  const both = "Ozge: 'bir iki üç dört beş altı yedi sekiz dokuz on onbir oniki onüç ondört' dedi, "
    + "Aynüke: 'Bbsbsbshgsgsgsgfs' ile patladı.";
  const out = trimLongQuotes(both);
  assert.ok(out.includes("Bbsbsbshgsgsgsgfs"), "short reaction must be kept");
  assert.ok(!out.includes("ondört"), "long line must be cut");
});

test("moment fields are clamped, and clamping prefers a sentence boundary", () => {
  const long = `${"Uzun bir cümle daha yazıyorum. ".repeat(20)}`;
  const out = clampMomentField(long);
  assert.ok(out.length <= 320, `got ${out.length}`);
  assert.ok(out.endsWith(".") || out.endsWith("..."));
});

test("momentFieldText accepts both the flat and the {text} shapes", () => {
  assert.equal(momentFieldText({ text: "hello there" }), "hello there");
  assert.equal(momentFieldText("hello there"), "hello there");
  assert.equal(momentFieldText(null), "");
});
