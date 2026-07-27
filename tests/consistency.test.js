import test from "node:test";
import assert from "node:assert/strict";
import { contrastContradictsDayparts, dedupeSharedEvents } from "../src/analysis/consistency.js";

test("a contrast that argues with the clock is detected", () => {
  assert.ok(contrastContradictsDayparts("İkisi de geç saatlerde canlanıyor, sohbet gece başlıyor", ["afternoon", "afternoon"]));
  assert.ok(contrastContradictsDayparts("Both come alive late at night", ["afternoon", "afternoon"]));
  assert.ok(!contrastContradictsDayparts("İkisi de öğleden sonra en aktif", ["afternoon", "afternoon"]));
  assert.ok(!contrastContradictsDayparts("Gece kuşu ikisi de", ["late night", "late night"]));
  assert.ok(!contrastContradictsDayparts("", ["afternoon", "afternoon"]));
});

test("a passing time reference is not treated as a contradiction", () => {
  // Real case: both peak at 10pm; the sentence mentions morning only as
  // sequencing, so it must survive.
  assert.ok(!contrastContradictsDayparts(
    "Hubby signs off first while Ozge hits her stride later, so she often picks up the thread in the morning.",
    ["late night", "late night"]
  ));
  // Real bug: 2pm peaks with a "both come alive at night" claim.
  assert.ok(contrastContradictsDayparts(
    "İkisi de geç saatlerde canlanıyor; en uzun sohbetler gece başlıyor.",
    ["afternoon", "afternoon"]
  ));
});

test("an optional card retelling a claimed event is blanked", () => {
  const shared = dedupeSharedEvents({
    sweetMoment: `Ataberk 'ben alirim seni' dedi ve gece havaalanina gitti.`,
    loveMiss: {
      description: `Ataberk 'ben alirim seni' dedi ve gece havaalanina gitti, Ozge sozle karsilik verdi.`,
      quote: "ben alirim seni",
      persons: ["Ozge", "Ataberk"],
    },
    loveMissUnspoken: "Sabah erken mesaj atmasi sessiz bir ilgi gostergesi.",
  });
  assert.ok(shared.sweetMoment.includes("alirim seni"));
  assert.equal(shared.loveMiss.description, "");
  assert.ok(shared.loveMissUnspoken.length > 0, "an unrelated optional card survives");
});

test("a required field keeps its text but loses a repeated quote's marks", () => {
  const shared = dedupeSharedEvents({
    sweetMoment: `Ozge 'krallar gibi yasatirim' diye soz verdi.`,
    mostLovingMoment: `Sonrasinda 'krallar gibi yasatirim' sozu tekrar geldi.`,
  });
  assert.ok(shared.mostLovingMoment.includes("krallar gibi yasatirim"));
  assert.ok(!shared.mostLovingMoment.includes("'krallar gibi yasatirim'"), "quote marks dropped on the repeat");
});

test("distinct events are all kept", () => {
  const shared = dedupeSharedEvents({
    sweetMoment: `Ataberk 'ilaclarini getircem' diyerek eve ugradi.`,
    mostLovingMoment: `Ozge 'seni krallar gibi yasatirim' diye soz verdi.`,
    loveMissUnspoken: "Gece yarisi gelen mesajlar tartismasiz kabul ediliyor.",
  });
  assert.ok(shared.sweetMoment.includes("ilaclarini"));
  assert.ok(shared.mostLovingMoment.includes("krallar"));
  assert.ok(shared.loveMissUnspoken.length > 0);
});
