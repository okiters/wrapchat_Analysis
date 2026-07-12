import test from "node:test";
import assert from "node:assert/strict";
import { parseWhatsAppExport } from "../src/import/whatsappParser.js";

const ios = (date, time, sender, body) => `[${date}, ${time}] ${sender}: ${body}`;

function bodies(parsed) {
  return parsed.messages.map(message => message.text);
}

test("keeps real messages containing bare system words (left, added, removed)", () => {
  const parsed = parseWhatsAppExport([
    ios("12.03.2024", "21:14", "Ozge", "I left work early today"),
    ios("12.03.2024", "21:15", "Asli", "she added me on insta"),
    ios("12.03.2024", "21:16", "Ozge", "he removed the post already"),
  ].join("\n"));

  assert.equal(parsed.messages.length, 3);
  assert.deepEqual(bodies(parsed), [
    "I left work early today",
    "she added me on insta",
    "he removed the post already",
  ]);
});

test("merges multi-line messages instead of dropping them", () => {
  const parsed = parseWhatsAppExport([
    ios("12.03.2024", "21:14", "Ozge", "first line"),
    "second line",
    "third line",
    ios("12.03.2024", "21:20", "Asli", "reply"),
  ].join("\n"));

  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].text, "first line\nsecond line\nthird line");
  assert.equal(parsed.messages[1].text, "reply");
});

test("drops dated system lines instead of gluing them onto the previous message", () => {
  const parsed = parseWhatsAppExport([
    ios("12.03.2024", "21:14", "Ozge", "hello"),
    "12.03.2024, 21:15 - Alice added Bob",
    "[12.03.2024, 21:16] Alice left",
    ios("12.03.2024", "21:20", "Asli", "hi back"),
  ].join("\n"));

  assert.equal(parsed.messages.length, 2);
  assert.deepEqual(bodies(parsed), ["hello", "hi back"]);
  assert.deepEqual(parsed.participants, ["Ozge", "Asli"]);
});

test("drops colon-attributed encryption notices and deleted-message placeholders", () => {
  const parsed = parseWhatsAppExport([
    ios("12.03.2024", "21:14", "Fam Group", "Messages and calls are end-to-end encrypted. No one outside of this chat can read them."),
    ios("12.03.2024", "21:15", "Ozge", "real message"),
    ios("12.03.2024", "21:16", "Asli", "This message was deleted"),
  ].join("\n"));

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].text, "real message");
});

test("drops iOS group events carrying a direction mark, keeps identical text without one", () => {
  const parsed = parseWhatsAppExport([
    `[12.03.2024, 21:14] Fam Group: ‎Alice added Bob`,
    ios("12.03.2024", "21:15", "Ozge", "Alice added Bob to the plan, finally"),
  ].join("\n"));

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].text, "Alice added Bob to the plan, finally");
  assert.deepEqual(parsed.participants, ["Ozge"]);
});

test("android format with multi-line body still parses", () => {
  const parsed = parseWhatsAppExport([
    "12/03/2024, 21:14 - Ozge: line one",
    "line two",
    "12/03/2024, 21:15 - Asli: ok",
  ].join("\n"));

  assert.equal(parsed.metadata.format, "android");
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].text, "line one\nline two");
});
