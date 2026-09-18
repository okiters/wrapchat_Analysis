#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// SCHEMA CHECK — sends every structured-output schema to the API and asserts
// two things: the request is accepted, and it is served by the model we think
// we are paying for.
//
// This exists because that failure is SILENT. When a compiled grammar goes over
// the API's size limit the call 400s, the edge function retries without the
// schema and/or on the fallback model, reports keep being produced, and the
// only visible symptom is spend on the wrong model in the Anthropic console.
// It has now happened twice: once in v3.7 (six nested {candidateId, text}
// objects) and once undetected in the `risk` schema, which is over the limit in
// production today.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/schema-check.mjs
//   npm run schema-check
//
// Costs a few tenths of a cent: each call is ~40 max_tokens with a one-word
// prompt, because only the SCHEMA size is under test.
// ─────────────────────────────────────────────────────────────────
import { readFile } from "node:fs/promises";
import path from "node:path";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const ROOT = path.resolve(import.meta.dirname, "..");

let key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  try { key = (await readFile(path.join(ROOT, "tests/golden/.anthropic-key"), "utf8")).trim(); } catch { /* none */ }
}
if (!key) {
  console.error("Set ANTHROPIC_API_KEY (or put one in tests/golden/.anthropic-key).");
  process.exit(1);
}

const { OUTPUT_SCHEMAS } = await import(path.join(ROOT, "supabase/functions/analyse-chat/schemas.ts"));

function objectCensus(schema) {
  const counts = [];
  const walk = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (node.properties) {
      counts.push([at || "(root)", Object.keys(node.properties).length]);
      Object.entries(node.properties).forEach(([key, value]) => walk(value, at ? `${at}.${key}` : key));
    }
    if (node.type === "array") walk(node.items, `${at}[]`);
  };
  walk(schema, "");
  return counts.sort((a, b) => b[1] - a[1]);
}

let failed = 0;
console.log(`schema check · ${MODEL}\n`);
for (const [id, schema] of Object.entries(OUTPUT_SCHEMAS)) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 40,
      messages: [{ role: "user", content: "ok" }],
      output_config: { format: { type: "json_schema", schema } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  const size = JSON.stringify(schema).length;

  if (!res.ok) {
    failed += 1;
    const message = body?.error?.message || `HTTP ${res.status}`;
    console.log(`  ✗ ${id.padEnd(13)} ${String(size).padStart(5)}B  ${message.slice(0, 90)}`);
    // The widest object is almost always the culprit: cost scales with the
    // number of required properties on a single object, not with byte size.
    const [widest, count] = objectCensus(schema)[0] || [];
    if (widest) console.log(`      widest object: ${widest} (${count} required properties)`);
    continue;
  }
  if (body.model !== MODEL) {
    failed += 1;
    console.log(`  ✗ ${id.padEnd(13)} ${String(size).padStart(5)}B  accepted but served by ${body.model}`);
    continue;
  }
  console.log(`  ✓ ${id.padEnd(13)} ${String(size).padStart(5)}B  served by ${body.model}`);
}

console.log(failed
  ? `\n${failed} schema(s) failed — reports would silently run without schema enforcement.`
  : "\nall schemas accepted and served by the intended model.");
process.exit(failed ? 1 : 0);
