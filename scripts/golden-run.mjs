#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// GOLDEN HARNESS — runs the real analysis pipeline against a local
// chat export and lints the output against the voice contract, so
// prompt changes become measurable instead of vibes-based.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/golden-run.mjs tests/golden/chats/mychat.txt
//   node scripts/golden-run.mjs tests/golden/chats/mychat.txt --offline   (prompts + candidates only, no API)
//
// Options:
//   --rel <type>        relationship type for duo chats (default: friend)
//   --lang <code>       output language (default: auto-detected from the chat)
//   --model <id>        Anthropic model (default: claude-sonnet-4-6)
//   --pipelines a,b,c   subset of: connection,growth,risk (default: all)
//   --offline           build and save prompts without calling the API
//
// Outputs land in tests/golden/outputs/<chat-name>/ (git-ignored: they
// contain real chat content — never commit them).
// ─────────────────────────────────────────────────────────────────
import { register } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

globalThis.__WRAPCHAT_ENV__ = { DEV: false };
register(new URL("./golden/loader.mjs", import.meta.url));

const args = process.argv.slice(2);
const chatPath = args.find(a => !a.startsWith("--"));
const opt = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const OFFLINE = args.includes("--offline");
const REL = opt("rel") || "friend";
const MODEL = opt("model") || "claude-sonnet-4-6";
const PIPELINES = (opt("pipelines") || "connection,growth,risk").split(",").map(s => s.trim());

if (!chatPath) {
  console.error("Usage: node scripts/golden-run.mjs <chat-export.txt> [--rel friend] [--lang tr] [--model id] [--pipelines connection,growth,risk] [--offline]");
  process.exit(1);
}
if (!OFFLINE && !args.includes("--relint") && !process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY (or use --offline to only build prompts).");
  process.exit(1);
}

const [parser, localMath, ai, helpers, i18n, lint] = await Promise.all([
  import("../src/import/whatsappParser.js"),
  import("../src/analysis/localMath.js"),
  import("../src/analysis/aiAnalysis.js"),
  import("../analysis-test/aiDebugHelpers.js"),
  import("../src/i18n/translations.js"),
  import("../src/analysis/voiceLint.js"),
]);

const rawText = await readFile(chatPath, "utf8");
const parsed = parser.parseWhatsAppExport(rawText);
if (!parsed.formatDetected || !parsed.messages.length) {
  console.error("Could not parse that export.");
  process.exit(1);
}
const { messages } = localMath.capLargeGroup(parser.toAnalysisMessages(parsed));
const math = localMath.localStats(messages);
const detected = i18n.detectLanguage(messages);
const chatLang = opt("lang") || detected?.code || "en";
const relationshipLine = math.isGroup ? "" : ai.buildRelationshipLine ? "" : "";
const candidates = ai.extractCandidateMoments(messages);
const candidatesText = ai.formatCandidateMoments(candidates);
const recurringCast = ai.extractRecurringCast(messages, math.names || [], {
  topicTokens: (math.topWords || []).map(entry => (Array.isArray(entry) ? entry[0] : entry)),
});

console.log(`chat: ${path.basename(chatPath)} · ${messages.length} messages · ${math.isGroup ? "group" : "duo"} · lang=${chatLang} · ${candidates.length} candidate moments`);

const common = {
  messages,
  math,
  relationshipType: math.isGroup ? null : REL,
  chatLang,
  relationshipContext: null,
  buildRelationshipLine: () => "",
  coreAnalysisVersion: ai.CORE_ANALYSIS_VERSION,
};

const requests = {};
if (PIPELINES.includes("connection")) {
  requests.connection = helpers.prepareConnectionDigestRequest({
    ...common,
    recurringCast,
    buildAnalystSystemPrompt: ai.buildCoreASystemPrompt,
    buildSampleText: ai.buildSampleText,
    candidatesText,
    maxTokens: ai.CORE_A_MAX_TOKENS,
  });
}
if (PIPELINES.includes("growth")) {
  requests.growth = helpers.prepareGrowthDigestRequest({
    ...common,
    buildAnalystSystemPrompt: ai.buildCoreASystemPrompt,
    formatForAI: ai.formatForAI,
    maxTokens: ai.CORE_A_MAX_TOKENS,
  });
}
if (PIPELINES.includes("risk")) {
  requests.risk = helpers.prepareRiskDigestRequest({
    ...common,
    recurringCast,
    buildAnalystSystemPrompt: ai.buildAnalystSystemPrompt,
    buildSampleText: ai.buildSampleText,
    candidatesText,
    maxTokens: ai.CORE_B_MAX_TOKENS,
  });
}

const outDir = path.join("tests", "golden", "outputs", path.basename(chatPath).replace(/\.[^.]+$/, ""));
await mkdir(outDir, { recursive: true });

// What local math extracted and categorized before any AI call — the review
// surface for "what are we sending Claude": typed candidate moments (with
// reactions), the math context lines the prompts embed, and topic data.
await writeFile(path.join(outDir, "local-analysis.json"), JSON.stringify({
  chat: path.basename(chatPath),
  messages: messages.length,
  names: math.names,
  totalMessages: math.totalMessages,
  isGroup: math.isGroup,
  detectedLanguage: chatLang,
  localContext: {
    ghostName: math.ghostName,
    ghost: math.ghost,
    convStarter: math.convStarter,
    funniestPerson: math.funniestPerson,
    laughCausedBy: math.laughCausedBy,
    peakHour: math.peakHour,
    streak: math.streak,
  },
  topWords: math.topWords,
  topBigrams: math.topBigrams,
  signatureWord: math.signatureWord,
  candidateMoments: candidates,
  candidatesTextSentToClaude: candidatesText,
  recurringCast,
}, null, 2));

// --relint: re-score previously saved outputs with the current linter,
// without any API calls. Cheap way to iterate on lint rules or re-judge
// old runs after a rule change.
if (args.includes("--relint")) {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(outDir)).filter(name => name.endsWith(".json"));
  const lines = [`# Golden relint · ${new Date().toISOString()}`, ""];
  const corpus = messages.map(message => message.body).join("\n");
  let errors = 0;
  for (const file of files.sort()) {
    const data = JSON.parse(await readFile(path.join(outDir, file), "utf8"));
    const issues = [...lint.lintResult(data), ...lint.lintQuoteGrounding(data, corpus)];
    errors += issues.filter(issue => issue.level === "error").length;
    lines.push(lint.formatLintReport(issues, file), "");
  }
  await writeFile(path.join(outDir, "lint-report.md"), lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(errors ? `voice-lint: ${errors} error(s)` : "voice-lint: all clean");
  process.exit(errors ? 2 : 0);
}

async function callAnthropic(request) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userContent }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = data.content?.find(block => block.type === "text")?.text || "";
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const braceStart = stripped.indexOf("{");
  const braceEnd = stripped.lastIndexOf("}");
  const candidate = braceStart >= 0 && braceEnd > braceStart ? stripped.slice(braceStart, braceEnd + 1) : stripped;
  return { parsed: JSON.parse(candidate), raw: text, usage: data.usage, stopReason: data.stop_reason };
}

const groundCorpus = messages.map(message => message.body || "").join("\n");
const NORMALIZERS = {
  connection: raw => lint.groundResultQuotes(ai.normalizeConnectionDigest(raw, math, common.relationshipType, null, candidates), groundCorpus),
  growth: raw => lint.groundResultQuotes(ai.normalizeGrowthDigest(raw, math, common.relationshipType), groundCorpus),
  risk: raw => lint.groundResultQuotes(ai.normalizeRiskDigest(raw, math, common.relationshipType), groundCorpus),
};
const DERIVED = {
  connection: core => ({
    general: ai.deriveGeneralReportFromCore(core, math, common.relationshipType),
    lovelang: ai.deriveLoveLangReportFromCore(core, math, common.relationshipType),
    energy: ai.deriveEnergyReportFromCore(core, math, common.relationshipType),
  }),
  growth: core => ({ growth: ai.deriveGrowthReportFromCore(core, math, common.relationshipType) }),
  risk: core => ({
    toxicity: ai.deriveToxicityReportFromCore(core, math, common.relationshipType),
    accounta: ai.deriveAccountaReportFromCore(core, math, common.relationshipType),
  }),
};

const reportLines = [`# Golden run · ${new Date().toISOString()}`, `model: ${MODEL} · lang: ${chatLang} · rel: ${common.relationshipType ?? "group"}`, ""];
let totalErrors = 0;

for (const [name, request] of Object.entries(requests)) {
  await writeFile(path.join(outDir, `${name}.request.txt`), `SYSTEM:\n${request.systemPrompt}\n\nUSER:\n${request.userContent}`);
  if (OFFLINE) {
    console.log(`${name}: request saved (offline)`);
    continue;
  }
  process.stdout.write(`${name}: calling ${MODEL}... `);
  try {
    const { parsed: rawResult, raw, usage, stopReason } = await callAnthropic(request);
    console.log(`ok (${usage?.output_tokens} out tokens, stop=${stopReason})`);
    const core = NORMALIZERS[name](rawResult);
    await writeFile(path.join(outDir, `${name}.raw.txt`), raw);
    await writeFile(path.join(outDir, `${name}.digest.json`), JSON.stringify(core, null, 2));
    const corpus = messages.map(message => message.body).join("\n");
    const digestIssues = [...lint.lintResult(core), ...lint.lintQuoteGrounding(core, corpus)];
    totalErrors += digestIssues.filter(issue => issue.level === "error").length;
    reportLines.push(`## ${name}`, lint.formatLintReport(digestIssues, `${name} digest`), "");
    for (const [reportName, report] of Object.entries(DERIVED[name](core))) {
      await writeFile(path.join(outDir, `${reportName}.report.json`), JSON.stringify(report, null, 2));
      const issues = [...lint.lintResult(report), ...lint.lintQuoteGrounding(report, corpus)];
      totalErrors += issues.filter(issue => issue.level === "error").length;
      reportLines.push(lint.formatLintReport(issues, `${reportName} report`), "");
    }
  } catch (error) {
    console.log("FAILED");
    reportLines.push(`## ${name}`, `FAILED: ${error.message}`, "");
    totalErrors += 1;
  }
}

await writeFile(path.join(outDir, "lint-report.md"), reportLines.join("\n"));
console.log(`\n${OFFLINE ? "requests" : "outputs + lint report"} written to ${outDir}`);
if (!OFFLINE) console.log(totalErrors ? `voice-lint: ${totalErrors} error(s) — see lint-report.md` : "voice-lint: all clean");
process.exit(totalErrors ? 2 : 0);
