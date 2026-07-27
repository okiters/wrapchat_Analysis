import test from "node:test";
import assert from "node:assert/strict";
import { buildSpineRuns, burstScore, SENSITIVE_CONTENT_RE } from "../src/analysis/spine.js";

// Builds a chat where every `burstEvery`-th block is a tight two-person
// exchange and the rest are slow one-sided messages.
function makeChat(count, { sensitiveAt = [], burstEvery = 50 } = {}) {
  const messages = [];
  let clock = Date.UTC(2024, 0, 1, 9, 0, 0);
  for (let i = 0; i < count; i += 1) {
    const inBurst = Math.floor(i / 10) % Math.max(1, Math.round(burstEvery / 10)) === 0;
    clock += (inBurst ? 3 : 180) * 60000;
    messages.push({
      name: inBurst ? (i % 2 ? "Ozge" : "Ata") : "Ozge",
      body: sensitiveAt.includes(i) ? "seks yapalim mi" : `mesaj ${i}`,
      date: new Date(clock),
    });
  }
  return messages;
}

test("runs are long contiguous stretches, not thin slices", () => {
  const messages = makeChat(20000);
  const runs = buildSpineRuns(messages);
  assert.ok(runs.length > 10, "several runs across the history");
  const lengths = runs.map(([start, end]) => end - start + 1);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  assert.ok(avg >= 16, `average run ${avg} should clear the 16-message minimum`);
  runs.forEach(([start, end]) => assert.ok(end >= start, "run is contiguous and ordered"));
});

test("runs stay inside the line budget and in chronological order", () => {
  const messages = makeChat(30000);
  const runs = buildSpineRuns(messages, { lineBudget: 600 });
  const total = runs.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
  assert.ok(total <= 700, `total ${total} respects the budget`);
  for (let i = 1; i < runs.length; i += 1) {
    assert.ok(runs[i][0] > runs[i - 1][1], "runs do not overlap");
  }
});

test("anchors prefer live exchanges over one-sided stretches", () => {
  const messages = makeChat(4000);
  const live = burstScore(messages, 0, 16);        // starts inside a burst
  const quiet = burstScore(messages, 20, 16);      // slow, single-speaker
  assert.ok(live > quiet, `burst ${live} should outscore quiet ${quiet}`);
});

test("explicit content is detected in several languages", () => {
  assert.ok(SENSITIVE_CONTENT_RE.test("seks yapalim mi"));
  assert.ok(SENSITIVE_CONTENT_RE.test("send me nudes"));
  assert.ok(SENSITIVE_CONTENT_RE.test("das ist so geil"));
  assert.ok(!SENSITIVE_CONTENT_RE.test("bugun hava cok guzel"));
  assert.ok(!SENSITIVE_CONTENT_RE.test("seni ozledim kanka"));
});

test("explicit stretches are never sampled into the spine", () => {
  const sensitiveAt = [];
  for (let i = 0; i < 300; i += 1) sensitiveAt.push(1000 + i); // a long explicit stretch
  const messages = makeChat(12000, { sensitiveAt });
  const runs = buildSpineRuns(messages);
  const sampled = new Set();
  runs.forEach(([start, end]) => { for (let i = start; i <= end; i += 1) sampled.add(i); });
  const leaked = sensitiveAt.filter(index => sampled.has(index));
  assert.equal(leaked.length, 0, `explicit messages leaked: ${leaked.slice(0, 5)}`);
});

test("small chats are returned whole", () => {
  const messages = makeChat(200);
  assert.deepEqual(buildSpineRuns(messages), [[0, 199]]);
});
