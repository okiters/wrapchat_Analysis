// ─────────────────────────────────────────────────────────────────
// SPINE — the contiguous-conversation layer of the AI sample.
//
// Evenly spaced anchors across the full history, each snapped to the
// liveliest exchange nearby and grown while the conversation keeps
// flowing. Pure JS (no Vite-only imports) so it is unit-testable.
// ─────────────────────────────────────────────────────────────────

// Explicit content the report should never be built on. PII and credentials
// are already stripped upstream by redactSensitive; this is about steering
// the spine's anchors away from intimate stretches entirely, so they are not
// summarised, quoted, or turned into a card.
export const SENSITIVE_CONTENT_RE = new RegExp([
  // en
  "\\b(sex|sexy|sexual|horny|nude|nudes|naked|boobs|dick|cock|pussy|blowjob|orgasm|masturbat|porn|fuck me|turn(s)? me on)\\b",
  // tr
  "\\b(seks|seksi|azgın|azgin|çıplak|ciplak|göğüs|gogus|meme|sik|am|amcık|amcik|orospu|porno|mastürbasyon|masturbasyon|orgazm|sevişelim|sevisel)\\b",
  // es / pt
  "\\b(sexo|sexy|desnud[oa]|caliente|porno|orgasmo|follar|coger contigo|tesão|tesao|pelad[oa]|gozar)\\b",
  // fr / de / it
  "\\b(sexe|nue?|baiser|jouir|porno|nackt|geil|ficken|schwanz|titten|sesso|nud[oa]|scopare|cazzo|tette)\\b",
].join("|"), "i");

function isSensitiveRange(messages, start, end) {
  for (let i = start; i <= end; i += 1) {
    if (SENSITIVE_CONTENT_RE.test(messages[i].body || "")) return true;
  }
  return false;
}

// How much this position looks like a real conversation rather than a lone
// message: tight reply gaps and both people talking.
export function burstScore(messages, start, length) {
  const end = Math.min(messages.length - 1, start + length - 1);
  let tight = 0;
  let alternations = 0;
  for (let i = start + 1; i <= end; i += 1) {
    const gapMin = (messages[i].date - messages[i - 1].date) / 60000;
    if (gapMin <= 20) tight += 1;
    if (messages[i].name !== messages[i - 1].name) alternations += 1;
  }
  return tight + alternations * 1.5;
}

// Evenly spaced anchors, but each one snaps to the liveliest conversation in
// its neighbourhood and then grows while the exchange keeps flowing. Longer
// contiguous stretches read as real conversations; 14-message slices often
// cut a story in half.
export function buildSpineRuns(messages, {
  runs = 70,
  minLen = 16,
  maxLen = 42,
  gapBreakMinutes = 45,
  lineBudget = 1900,
} = {}) {
  const n = messages.length;
  if (n <= runs * minLen) return [[0, n - 1]];
  const step = n / runs;
  const searchRadius = Math.max(1, Math.floor(step / 3));
  const out = [];
  let used = 0;

  for (let r = 0; r < runs; r += 1) {
    if (used >= lineBudget) break;
    const target = Math.round(r * step);
    const from = Math.max(0, target - searchRadius);
    const to = Math.min(n - minLen, target + searchRadius);
    if (to < from) continue;

    // Pick the best anchor in this slot, skipping explicit stretches.
    let best = null;
    for (let i = from; i <= to; i += 1) {
      const provisionalEnd = Math.min(n - 1, i + minLen - 1);
      if (isSensitiveRange(messages, i, provisionalEnd)) continue;
      const score = burstScore(messages, i, minLen);
      if (!best || score > best.score) best = { start: i, score };
    }
    if (!best) continue; // whole slot is explicit: skip it rather than sample it

    const start = best.start;
    let end = Math.min(n - 1, start + minLen - 1);
    // Grow while the conversation is still flowing and stays clean.
    while (end + 1 <= n - 1 && end - start + 1 < maxLen && used + (end - start + 2) <= lineBudget) {
      const gapMin = (messages[end + 1].date - messages[end].date) / 60000;
      if (gapMin > gapBreakMinutes) break;
      if (SENSITIVE_CONTENT_RE.test(messages[end + 1].body || "")) break;
      end += 1;
    }

    if (out.length && start <= out[out.length - 1][1] + 1) {
      const previous = out[out.length - 1];
      const grown = Math.max(previous[1], end);
      used += grown - previous[1];
      previous[1] = grown;
    } else {
      out.push([start, end]);
      used += end - start + 1;
    }
  }
  return out;
}
