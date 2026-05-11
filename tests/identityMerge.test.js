import test from "node:test";
import assert from "node:assert/strict";
import {
  applyApprovedMerges,
  calculateNameSimilarity,
  detectPossibleDuplicateContacts,
  normalizeDisplayName,
  normalizePhoneNumber,
} from "../src/utils/identityMerge.js";

test("normalizes display names across case and accents", () => {
  assert.equal(normalizeDisplayName("Özge Kiter"), "ozge kiter");
  assert.equal(normalizeDisplayName(" ozge   kiter "), "ozge kiter");
});

test("normalizes phone numbers", () => {
  assert.equal(normalizePhoneNumber("+90 (555) 111-22-33"), "905551112233");
});

test("calculates fuzzy name similarity above threshold for small differences", () => {
  assert.ok(calculateNameSimilarity("Özge Kiter", "Ozge Kitr") >= 0.82);
});

test("detects possible duplicate contacts without merging them", () => {
  const participants = [
    { id: "p1", displayName: "Özge Kiter", messageCount: 120 },
    { id: "p2", displayName: "Ozge Kitr", messageCount: 4 },
    { id: "p3", displayName: "Asli", messageCount: 90 },
  ];
  const suggestions = detectPossibleDuplicateContacts(participants);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].participantAId, "p1");
  assert.equal(suggestions[0].participantBId, "p2");
});

test("approved merges rewrite canonical participant mapping and preserve aliases", () => {
  const dataset = {
    participants: [
      { id: "p1", displayName: "Özge", aliases: ["Özge"], messageCount: 10 },
      { id: "p2", displayName: "Ozge", aliases: ["Ozge"], messageCount: 2 },
    ],
    messages: [
      { participantId: "p1", name: "Özge", body: "hi" },
      { participantId: "p2", name: "Ozge", body: "hello" },
    ],
    participantAliases: {},
    combinedMeta: {},
  };
  const suggestions = [{
    id: "s1",
    participantAId: "p1",
    participantBId: "p2",
    participantA: { displayName: "Özge" },
    participantB: { displayName: "Ozge" },
  }];

  const merged = applyApprovedMerges(dataset, ["s1"], suggestions);
  assert.equal(merged.participants.length, 1);
  assert.equal(merged.messages[1].participantId, "p1");
  assert.equal(merged.messages[1].name, "Özge");
  assert.equal(merged.participantAliases.Ozge, "Özge");
  assert.equal(merged.mergeState.approved.length, 1);
});

test("rejected merges remain separate", () => {
  const dataset = {
    participants: [
      { id: "p1", displayName: "Ali", aliases: ["Ali"], messageCount: 10 },
      { id: "p2", displayName: "Alya", aliases: ["Alya"], messageCount: 9 },
    ],
    messages: [
      { participantId: "p1", name: "Ali", body: "hi" },
      { participantId: "p2", name: "Alya", body: "hello" },
    ],
    participantAliases: {},
    combinedMeta: {},
  };
  const suggestions = [{
    id: "s1",
    participantAId: "p1",
    participantBId: "p2",
    participantA: { displayName: "Ali" },
    participantB: { displayName: "Alya" },
  }];

  const merged = applyApprovedMerges(dataset, [], suggestions);
  assert.equal(merged.participants.length, 2);
  assert.equal(merged.messages[1].participantId, "p2");
  assert.equal(merged.mergeState.rejected.length, 1);
});

test("rejected same-name participants are disambiguated before analysis", () => {
  const dataset = {
    sourceChats: [{ id: "c1" }, { id: "c2" }],
    participants: [
      { id: "p1", displayName: "Ozge", sourceChatIds: ["c1"], aliases: ["Ozge"], messageCount: 10 },
      { id: "p2", displayName: "Ozge", sourceChatIds: ["c2"], aliases: ["Ozge"], messageCount: 9 },
    ],
    messages: [
      { participantId: "p1", name: "Ozge", body: "hi" },
      { participantId: "p2", name: "Ozge", body: "hello" },
    ],
    participantAliases: {},
    combinedMeta: {},
  };
  const suggestions = [{
    id: "s1",
    participantAId: "p1",
    participantBId: "p2",
    participantA: { displayName: "Ozge" },
    participantB: { displayName: "Ozge" },
  }];

  const merged = applyApprovedMerges(dataset, [], suggestions);
  assert.equal(merged.participants.length, 2);
  assert.equal(new Set(merged.messages.map(message => message.name)).size, 2);
  assert.ok(merged.messages.every(message => /Ozge \(Chat [12]\)/.test(message.name)));
});
