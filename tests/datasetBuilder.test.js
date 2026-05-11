import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCombinedDataset,
  buildDatasetFromParsedChat,
  detectOtherParticipantMismatches,
  toAnalysisMessagesFromDataset,
} from "../src/import/datasetBuilder.js";
import { applyApprovedMerges } from "../src/utils/identityMerge.js";

function msg(name, body, iso) {
  const date = new Date(iso);
  return {
    name,
    body,
    date,
    hour: date.getHours(),
    month: date.getMonth(),
    year: date.getFullYear(),
  };
}

test("builds a single normalized dataset without mutating source messages", () => {
  const source = {
    fileName: "chat.txt",
    payload: {
      messages: [
        msg("Ozge", "hello", "2024-01-01T10:00:00Z"),
        msg("Asli", "hi", "2024-01-01T10:01:00Z"),
      ],
    },
  };
  const dataset = buildDatasetFromParsedChat(source);

  assert.equal(dataset.datasetKind, "single");
  assert.equal(dataset.messages.length, 2);
  assert.ok(dataset.messages[0].participantId);
  assert.equal(source.payload.messages[0].participantId, undefined);
});

test("combines chats, removes duplicate uploads, and sorts chronologically", () => {
  const chatA = {
    fileName: "a.txt",
    payload: {
      messages: [
        msg("Ozge", "later", "2024-01-01T10:05:00Z"),
        msg("Asli", "same", "2024-01-01T10:01:00Z"),
      ],
    },
  };
  const chatB = {
    fileName: "b.txt",
    payload: {
      messages: [
        msg("Asli", "same", "2024-01-01T10:01:00Z"),
        msg("Ozge", "first", "2024-01-01T10:00:00Z"),
      ],
    },
  };

  const dataset = buildCombinedDataset([chatA, chatB]);
  assert.equal(dataset.datasetKind, "combined");
  assert.equal(dataset.messages.length, 3);
  assert.equal(dataset.combinedMeta.duplicateMessageCount, 1);
  assert.deepEqual(dataset.messages.map(message => message.body), ["first", "same", "later"]);
});

test("rejects empty parsed files", () => {
  assert.throws(
    () => buildCombinedDataset([{ fileName: "empty.txt", payload: { messages: [] } }]),
    /No readable messages/,
  );
});

test("produces analysis messages from canonical merged dataset", () => {
  const dataset = buildCombinedDataset([{
    fileName: "chat.txt",
    payload: {
      messages: [
        msg("Özge", "one", "2024-01-01T10:00:00Z"),
        msg("Ozge", "two", "2024-01-01T10:01:00Z"),
      ],
    },
  }]);
  const merged = applyApprovedMerges(
    dataset,
    dataset.mergeState.suggestions.map(suggestion => suggestion.id),
    dataset.mergeState.suggestions,
  );
  const analysisMessages = toAnalysisMessagesFromDataset(merged);
  assert.equal(analysisMessages.length, 2);
  assert.equal(new Set(analysisMessages.map(message => message.name)).size, 1);
  assert.ok(analysisMessages.every(message => message.participantId));
});

test("detects participant mismatch across one-to-one combined chats", () => {
  const dataset = buildCombinedDataset([
    {
      fileName: "chat-1.txt",
      payload: { messages: [
        msg("Ozge", "hi", "2024-01-01T10:00:00Z"),
        msg("Asli", "hey", "2024-01-01T10:01:00Z"),
      ] },
      summary: { participants: ["Ozge", "Asli"] },
    },
    {
      fileName: "chat-2.txt",
      payload: { messages: [
        msg("Ozge", "hello", "2024-01-02T10:00:00Z"),
        msg("Mert", "yo", "2024-01-02T10:01:00Z"),
      ] },
      summary: { participants: ["Ozge", "Mert"] },
    },
  ]);
  const mismatch = detectOtherParticipantMismatches(dataset, "Ozge");
  assert.equal(mismatch.rows.length, 2);
  assert.deepEqual(mismatch.rows.map(row => row.otherName), ["Asli", "Mert"]);
});
