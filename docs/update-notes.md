# Update Notes

Add a note before each commit. Use the next version number. Latest version always goes at the top — move it out of Pending when committed.

---

## Pending (not yet committed)

_Nothing pending — everything below is shipped._

---

## v4.0.2 — The love-language guess was a coin flip that leaked its own answer

**Files:** `src/screens/Screens.jsx`, `tests/loveLanguageGuess.test.js` (new)

"Which love language describes {name}?" built its options as `[...new Set([langA, langB])]` — the two participants' *actual answers*. Three consequences, all bad:

- a 50/50 between two real answers rather than a guess against the five types;
- the second person's answer was sitting in the options while you guessed the first;
- when a pair shared a language the set collapsed to one option, `confidenceValid` went false, and the guess silently disappeared — in exactly the case where it is most interesting.

Options are now the real answer plus three decoys drawn from `LOVE_LANG_CANONICAL`. `"Mixed"` is a fallback label rather than a guessable type, so it is never offered as a decoy and only ever appears when it is the answer. Ordering derives from `stableHash`, the same helper the quips use, so a given result always presents the same options on revisit.

Audited the other seven `GuessCard` call sites: every one asks "which of the two people?", which is a legitimate binary. This was the only card guessing a *category*, and the only one built this way.

Five tests cover the contract: four distinct options, the answer always present, no `Mixed` decoy, a shared language still yielding a full guess, and stability per result.

---

## v4.0.1 — `npm run schema-check`, and a live grammar-limit failure it found

**Files:** `scripts/schema-check.mjs` (new), `package.json`

Sends every structured-output schema to the API and asserts both that the request is accepted and that it is served by the model we think we are paying for. That failure is silent by design: when a compiled grammar goes over the API's size limit the call 400s, the edge function retries without the schema and/or on the fallback model, reports keep being produced, and the only visible symptom is spend on the wrong model in the Anthropic console. It has now happened twice.

**The `risk` schema is over the limit in production right now.** Every Toxicity and Accountability report has therefore been running without schema enforcement. It is not marginal — dropping single properties does not recover it, and it fails while the larger `connection` schema (4219B vs 4093B) passes, because the cost scales with required properties on a single object rather than byte size. The widest object is `shared.toxicity` at 13 required properties.

Two structure-preserving fixes were measured, both accepted: hoisting `shared.toxicity` + `shared.accountability` up a level (3887B), or hoisting `people[].health` + `people[].accountability` (3969B). The second is the smaller client change — `normalizeCorePersonB` is the only reader and it already rebuilds the nested shape internally, so nothing downstream moves. Both change the wire shape, so either needs `ANALYSIS_CONTRACT` 2 and a coordinated app release, which is why neither is applied here.

Also measured while investigating: the `connection` schema has room for exactly **one** more string property (three if `timeOfDay` and `loveMiss` are hoisted, four if the group-only fields move to a duo-specific variant). That rules out giving all six moment fields a separate required `read` property, which was the plan for making the read reliable.

`schema-check` is deliberately NOT wired into `npm test` — it needs a key and network, and it currently exits 1 on the known `risk` failure.

---

## v4.0 — Card voice, page structure, and the quip layer

Driven by a run against a fourth real chat (a four-year Turkish friend chat, 17.8k messages) plus a structural audit of all 38 pages. The theme across all three parts: the right abstractions already existed and had been rolled out to exactly one page each.

### Moment cards: a friend telling you about a moment, not a screenshot with a caption
**Files:** `supabase/functions/_shared/prompts.js`, `src/analysis/aiAnalysis.js`, `src/analysis/voiceLint.js`

The shared rule said, in as many words, *"the quote IS the card... never summarise a dialog in your own words... a screenshot with a caption"* — and capped the read at 15 words while leaving the quotes uncapped. That is backwards: the read is the part carrying the voice and the only part that was rationed, and the rule explicitly forbade the setup that tells a reader why the moment mattered.

Measured across four chats before changing anything: the median card quote is 4 words and the median field 8% verbatim, which is healthy, but the outliers ran to **26 words and 67% of the card**. All of them were in the Turkish chat, where run-on messages are normal. The cause was a gap rather than a policy — the candidate bank caps its own quotes at 110 chars, but a field quoting straight from the window text had no ceiling at all.

Moment fields are now four beats: **setup** (in the writer's own words, so the line has somewhere to land), **the line** (12-word ceiling), **the reaction**, and **the read** (why it lands for these two, mandatory, closing the field). Generic maxims are banned by name — "a concrete offer outweighs a vague consolation" is true of anybody and is the exact sound of a report. The budget moved 240 → 300 characters because the four beats genuinely do not fit in 240, least of all in Turkish.

Deterministic backstops, so none of this depends on the model complying: `trimLongQuotes` caps any quoted span at 12 words while keeping it a literal prefix (quote-grounding still matches), `clampMomentField` holds the field at 320 chars, and two new lint rules — `quote-heavy` (>55% verbatim) and `quote-too-long` (>14 words) — make the balance measurable.

**Two bugs found by making the change.** `resolveMomentPicks` demanded the WHOLE candidate quote appear verbatim, which was right when the quote was the card; now that a field quotes a fragment by design, the check failed on correct output and *prepended* speaker + quote + reaction to a field that already told the story — a transcript followed by a re-narration of the same moment, at 483 characters. It now accepts a recognisable fragment in either direction, and only injects when the card quotes nothing real at all. Separately, that repair ran after `momentFieldText`, so its quotes bypassed both the trim and the clamp; and because the read is the closing beat, the clamp was trimming off precisely the part that carries the voice.

Also: the model leaked internal candidate numbering into user-facing Turkish ("Kandidat #53'ün ruhu bu"). The candidate list is now marked internal scaffolding in the prompt and the mechanics lint catches the leak in both languages.

Honest limit: the read is **not yet reliable**. Judged across three runs it scored 5, 3 and 1 on the same field with no contract change between runs — that is variance, not progress, and three rounds of prompt tightening moved the average 3.2 → 3.3 → 2.7. Quote balance is now deterministic and holds; the read needs to become its own schema field so structured outputs cannot return a card without one.

### Quips: the app's most-repeated voice
**Files:** `src/i18n/translations.js`, `tests/quipVoice.test.js` (new)

A quip sits under almost every card, and the hand-written ones failed the exact test the voice section spends 800 words teaching the model to pass. Laid out together, the weak ones shared one tic: they **graded the number** instead of reacting to it — "that kind of consistency is rare", "that means something", "still counts", "not bad at all", "that says a lot".

24 of 57 variants rewritten in all 8 languages against one rule: *make a picture or take a side, never grade the number.* "That kind of consistency is rare" → "Neither of you once got too busy." Lines that already worked ("joined the group and immediately disappeared into witness protection", "Somewhere {novelist} is still typing") were kept. Turkish was written natively rather than translated. Three tests now fail the build if an appraisal tic returns, if any language drifts from 19 keys × 3 variants, or if placeholders diverge between languages.

Still open: 3 variants per key means a user running several reports sees repeats.

### Page structure: one scroll owner, one header, one theme path
**Files:** `src/ui/Shell.jsx`, `src/screens/Screens.jsx`, `src/App.jsx`

Shell exports a complete page contract (`SCREEN_CONTENT_STYLE`, `SCREEN_HEADER_BLOCK_STYLE`, `SCREEN_BODY_SCROLL_STYLE`), documented in its own comment as *"the contract for every headered page"*. Across all of `src/` those three constants had **three usages between them**. My Results was not the odd page out, it was the only page that had adopted it.

- **Nested scroll containers (the headers-move bug).** The Shell pane is `overflowY:auto` by default, and four pages added their own scroller without passing `scrollable={false}`: PackSelect, PackResultsBuffer, the trial unlock step, and My Results' name-detail view. A sticky header inside an inner scroller sticks to that scroller, so when the outer pane had also scrolled the header rode along. TermsFlow already had this right.
- **The scroll reset missed them entirely.** It reset only `paneRef`, so pages that own their scrolling kept their offset across navigation; and it fired on `[id]` alone, where `id` is a counter App.jsx increments by hand in 50 places, so any route that forgot to bump it kept the old position. Split into its own effect on `[id, sec, prog]`, and it now resets descendant scrollers too.
- **Four sticky-header variants** (opaque, opaque+pullTop0, alpha .94 + blur 8, alpha .90 + blur 8) with no rule deciding which page got which. The frosted treatment is now the default in `getStickyHeaderStyle` and pages only override `pullTop`.
- **Unlock reads had the smallest bottom padding of the three purchase pages** — 24px + safe-area against PackSelect's 56px and PackResultsBuffer's 96px — which is why its CTA did not clear. Now matches PackSelect.
- **The My Results drawer had no bottom inset at all.** `SHELL_DRAWER_PADDING` existed to match the top and does; the bottom was never matched. Added to the drawer's scroller, where the Shell pane keeps its own.
- **Theme.** `ThemedSurfaceContext` defaults to `false` and only Shell provides it, so in drawer mode `useInk()` returned dark ink on a theme-following light background. The drawer now provides the context, and 11 user-facing colour sites moved onto `useInk()` or an explicit theme branch.

Not done, deliberately: migrating the remaining 37 pages onto the layout contract. It is the biggest win left and wants doing page by page with eyes on each one. None of the UI work has been visually verified — `env(safe-area-inset-*)` is zero in a desktop browser, so the CTA clearance in particular needs a device.

Correction to the audit that preceded this: the unguarded-colour count was overstated (86, not 136) because the detector only recognised `isLight` as a theme guard and missed the `lightInk` and `light` spellings, and it attributed non-exported helpers to the preceding exported component.

82 → **85 tests**. `PROMPT_VERSION` 14, deployed to the edge function (analyse-chat v46). `ANALYSIS_CONTRACT` stays at 1.

---

## v3.9 — Moment selection, honest local math, and prompt/lint contract repair

Driven by a measured audit of the analysis pipeline (sampling, local math, prompts, cards) run against three chats: a 6.9k Turkish duo, a 61k English partner chat, and a 4.3k four-person group. Every number below came from instrumenting the real modules, not from reading the code.

### Moment selection: the funny cards were picking the earliest jokes, not the best
**Files:** `src/analysis/aiAnalysis.js`, `src/analysis/spine.js`

The laugh score had exactly **two** possible values in a duo (6 or 9), so on the 61k chat **965 moments tied for first** and the stable sort simply returned the earliest ten. Nine of ten picks came from the first 45% of the chat and 402 hard laughs after the last pick were never considered. Regraded using signals already present in the data — distinct laughers, laugh-burst length, reaction latency, how long the laugh token is, whether the exchange kept going, and trigger substance — which turns 2 distinct scores into ~860. Picks now span 2%–98% of the chat.

**Candidate moments had no context.** The prompt hands Claude a bank of pre-extracted moments and tells it to quote them VERBATIM, but `buildChunks` only guaranteed windows for two of the eight candidate types (funny, care). Measured: **44–53% of candidates were stranded single lines** with no surrounding conversation — the model was asked to narrate a scene it could not see. `buildSampleText` now feeds the bank's indices into `buildChunks`, which reserves their windows first, out of the same budget. Coverage 47% → 94%. Token spend unchanged (~40k): reallocation, not addition.

**The spine never reached the end of any chat.** `buildSpineRuns` consumed its 1900-line budget front-to-back, so it stopped ~85% through and the most recent weeks were never sampled — the final decile of the 61k chat had **0%** coverage. Now fair-share budgeted per slot. Final-decile coverage 0% → 4% (duo), 30% → 61% (group).

**Media placeholders were being quoted.** 7.7% of the 61k chat carries an inline attachment marker that the exact-match filter missed, including a bare `image omitted` the parser never normalises. Three of ten group joke picks were image-dependent ("Eylül image omitted"), where the joke is in a picture the model cannot see. Substance is now measured after stripping the marker, funny anchors need real text alongside an attachment, and no card quote can contain the phrase.

### Local math: two headline numbers were wrong, not just dull
**Files:** `src/analysis/localMath.js`

- **Toxicity was a volume metric.** A fixed `>= 18` threshold applied to an unnormalised running total that reached 1090 on a friendly 7k chat and 7371 on a 61k one, dominated by double-texting. Every chat past ~200 messages was permanently "Heated", and the person who simply texted most was named most toxic in 20 of 22 samples — while the AI rated the same chat 8/10 healthy on the same card. Now a rate per 1000 of that person's own messages with +300 additive smoothing (so a short sample cannot spike into a confident verdict), volume terms removed, thresholds recalibrated. Hubbychat: "Heated / 7371 / Ozge" → **"Healthy / 7 / Tie"**.
- **The Ghost Award excluded ghosting.** The filter `d > 1 && d < 1440` discarded every reply under a minute *and* every gap over 24 hours — 61–70% of all replies. It reported "45m / 52m" for a couple whose median reply is ~20 seconds, and the filtering **reversed who won**. Now: median for the displayed number, and the share of replies over three hours decides the ghost (measured across both chats, that separates a real ghost by 36% where percentiles separated by 3–21%).
- **Streaks broke on daylight saving.** `(day[i] - day[i-1]) / 86400000 === 1` yields `0.9583` at a spring-forward boundary, silently halving the streak twice a year. Invisible in local testing because this machine runs Europe/Istanbul, which dropped DST in 2016. Verified fixed under `TZ=Europe/Berlin`.
- **Signature words were language furniture.** None of `kanka / askım / bro / habibi / alter` were in any stop list, and distinctiveness was measured only between participants — so "kanka" (320 uses) ranked first. New `UBIQUITOUS_ADDRESS_TERMS` across all 8 languages, rarity-weighted selection mirroring the phrase logic, participant names excluded (`signaturePhrase` was returning a group member's name), connective and logistics phrases filtered, and an honest empty string rather than filler.
- **New `absenceFelt` signal.** "Most missed member" promises "when they go quiet, the group feels it" but nothing measured that, so the model returned nothing and the card named person A. Now counts how often others say your name while you have been silent 36h+.

### Cards and prompts
**Files:** `src/screens/Screens.jsx`, `src/analysis/aiAnalysis.js`, `supabase/functions/_shared/prompts.js`, `src/analysis/consistency.js`, `src/analysis/voiceLint.js`

- **A prompt instruction was rendering as user copy.** `relationshipStatusWhy` fell back to a sentence written for the model (`Use the user-selected relationship type "friend" as the framing for this chat.`) and showed it in the "Observed pattern" card. New `stripPromptInstruction` screens it; an empty card is honest, prompt engineering on screen is not.
- **Five cards named a person on no evidence.** The Funny One, The Drama Report, Most Missed, Who Apologises More and the toxicity scorecard all fell back to `s.names[0]` — the highest-volume sender. The Kindest One already used `"—"`; the rest now match it.
- **Candidate types are bound to fields.** Nothing said which candidate type feeds which card, so an *apology* won "the sweetest moment". Now funniest←funny, kindest←care, loving←affection, tension←tension, with "an apology is not kindness" stated outright.
- **Inside jokes had to be group-invented.** The live connection prompt asked only for "a recurring inside joke", so a common Turkish pet name ("askım") was presented as one. It now must be something the group made up and must recur; a term the language hands everyone is explicitly excluded. Also blanked client-side on duo chats, which have no card for it.
- **Groups got far less context than duos.** The group branch passed only ghost and conversation starter — `hypePersonReason` said "how *this person* energises the group" without ever naming them, so it came back empty. Groups now get the hype person named, laugh counts, and absence counts. `signaturePhrases` was also capped at 2 regardless of group size, so two of four members fell back to local filler.
- **The prompt banned 10 phrases; the linter enforced 20.** `BANNED_PHRASES.slice(0, 10)` meant "significant", "notably", "moreover" and "furthermore" failed runs without ever being stated in the prompt.
- **The dedupe ran on one pipeline out of three.** `dedupeSharedEvents` was called only from `normalizeConnectionDigest`, and `EVENT_CLAIM_ORDER` listed no growth fields — so one line anchored three growth cards of the same report. Now runs on growth and risk too, with dotted-path claim support.
- **Two lint bugs produced false alarms.** The emoji exemption tested `/(^|\.)name$/`, missing `personAName`/`personBName`, so a participant whose WhatsApp name is literally "Hubby 🧡" failed every run; and `meta.confidenceNote` — which is never rendered — raised hard errors that masked real leaks, now a warning.
- `contextParagraph` is clamped to 260 characters at a sentence boundary.

### Tests
`tests/localMath.test.js` is new: six regression tests covering the toxicity rate, the volume bias, reply-time tails, the DST streak, vocative signature words, and prompt-instruction leakage. 71 → **77 passing**. `localMath.js` imports now carry explicit `.js` extensions; it still needs the golden loader for the Vite `supabase` alias, which is why it had no test file before.

Both real chats now lint clean end to end. `PROMPT_VERSION` 13; `ANALYSIS_CONTRACT` stays at 1 — these are prompt-text changes a current client already handles, so prompts stay redeployable without an app release.

Known and unfixed: the static quip layer still fails the same generic test the voice section teaches (`"That kind of consistency is rare."`), and local frequency ranking fundamentally cannot find "character" — the AI finds the good phrases ("sadboysince99", "traum was schönes"), local math's job is now to return nothing rather than filler.

---

## v3.8 — Report self-consistency, longer conversation sampling, signature quality

Driven by a full audit of a real 22k-message report (all 25 cards reviewed as screenshots) plus live golden runs against a 61k chat.

### UI: duplicate time card removed, contrast panelled, flags restored, words regrouped
**Files:** `src/screens/Screens.jsx`, `src/analysis/localMath.js`

- **Time of Day was shipping twice** — once in General Wrapped (card 11) and once in the Energy report ("Energy by time") with identical numbers and layout. Removed from General Wrapped, kept in Energy; following cards renumbered and `DUO_CASUAL_SCREENS` 13 → 12.
- **The contrast sentence was bare text on the background** while every other insight sits in a bordered AICard panel. Now wrapped in an AICard labelled "What the timing says", so the card matches the rest of the system.
- **Flag button was missing on guess cards whenever the guess mechanic was disabled.** The feedback target was gated on the same threshold as the interactive mode (`energyGuessValid`, `apologyGuessThreshold`, `growthGuessThreshold`, `promiseGuessThreshold`), so a flat content card rendered with no way to report it. Ungated on all four: the card always shows content, so it is always flaggable.
- **"Your language" mixed two rankings under one medal list** — 3 top words (275x, 186x, 181x) then 3 top phrases (16x, 15x, 10x), which made the phrases read as padding. Now two labelled groups ("Most used words" / "Most used phrases"), medals only within words, no cross-list ranking.
- Fixed a duplicate `signaturePhrase` key in the quiz payload (the AI-verified phrase now wins, local math is the fallback).

Not changed: vertical centering across report cards is inconsistent (some cards float mid-screen, others sit high) — it follows from content height under a shared centering rule, so it needs a design decision rather than a patch.

### Sampling redesign: longer contiguous conversations + explicit-content filter
**Files:** `src/analysis/spine.js` (new), `src/analysis/aiAnalysis.js`, `tests/spine.test.js` (new)

The timeline spine sampled 120 fixed 14-message slices — even coverage, but a 14-message slice often cuts a story in half. Rewritten as ~60 adaptive runs: each evenly spaced anchor snaps to the liveliest exchange in its neighbourhood (tight reply gaps + speaker alternation) and then grows while the conversation keeps flowing (up to 42 messages, breaking on a 45-minute gap), under a 1900-line budget. Measured on the real 61k chat: average run 14 → 31 messages, 120 → 61 runs, same budget.

Explicit stretches are now steered around entirely: `SENSITIVE_CONTENT_RE` (sexual/explicit vocabulary, en/tr/es/pt/fr/de/it) is checked when choosing an anchor and when growing a run, so intimate conversations are never sampled, summarised, or quoted. PII/credentials were already redacted upstream; this is the separate "inappropriate content" rule. A leak test asserts a 300-message explicit stretch never appears in any run. Extracted to a pure module so it is unit-testable (6 tests).

### Report self-consistency: clock contradictions, event repetition, signature quality, drama evidence
**Files:** `src/analysis/consistency.js` (new), `src/analysis/aiAnalysis.js`, `src/analysis/localMath.js`, `analysis-test/aiDebugHelpers.js`, `supabase/functions/_shared/prompts.js`, `tests/consistency.test.js` (new)

Found by auditing a real 22k-message report end to end (screenshots of all 25 cards).

**Clock contradiction (fixed deterministically).** Time-of-day cards printed "2pm / afternoon" for both people while the sentence underneath said "ikisi de geç saatlerde canlanıyor" (both come alive late at night). Peak hours were already forced from local math; the free-text `contrast` was not checked against them. `contrastContradictsDayparts` now matches daypart vocabulary in 8 languages against the authoritative dayparts and blanks a contrast that argues with the clock.

**One event narrated on three cards (fixed deterministically).** `resolveMomentPicks` only guarded the six candidateId-anchored fields, so the same airport exchange anchored Most Loving Moment, The Miss, and a love-language example. New `dedupeSharedEvents` claims every quote and every event once in card order: a required field keeps its text but loses the repeated quote's marks, an optional card (loveMiss, loveMissUnspoken) left retelling a told story is emptied so the UI skips it.

**Signature phrases.** Real-data audit of a 61k chat exposed three flaws: WhatsApp call-log lines ("call click to call back", "answered on other device") were in the phrase pool and dominated by frequency; the casual-formula blocklist only matched whole strings, so "are you doing" slipped past "how are you"; and reflex fillers ("allah allah", "fark etmez") ranked as personality. Now: call-log noise filtered, token-level formula overlap (any two consecutive shared tokens), reflex-filler blocklist, a chat-size-scaled minimum (capped at 20 uses), 2x-not-3x distinctiveness so a phrase the other person picked up still counts, and rarity weighting so a phrase must carry at least one non-ubiquitous content word. Also widened the generic-verb filler list, which improves top words too. Honest limit: frequency n-grams still surface some bland phrases; the AI verification against the windows remains the final arbiter.

**Drama attribution.** `dramaStarter` was an impression. `localStats` now computes `dramaCounts` per person (distress + conflict + long emotional messages), the payload carries them, and the prompt renders a DRAMA LOAD line with an explicit instruction to start from the counts, confirm from the windows, and say "Shared" when close. Verified in the rendered prompt (Ozge: 117, Hubby: 49).

Guards live in a pure module so they are unit-testable without Vite-only imports.

**Verified on the real 61k chat (live golden runs).** First run surfaced two more issues, both fixed: the dedupe missed per-person `careStyle.examples` and the summary/read fields (`loveLanguageMismatch` et al), so the claim list now covers every quote-bearing field with the moment cards claiming first; and the emoji lint was flagging a participant whose WhatsApp name is literally "Hubby 🧡" (name leaves are now exempt). The daypart guard was also over-firing: it blanked a good sentence that mentioned "morning" only as sequencing, so a contradiction now requires peak-activity vocabulary near the time word. Signature phrases are capped at 6 words (the model was returning whole sentences). Final run: **all reports lint clean**, nine cards telling nine distinct stories.

70 tests passing. `PROMPT_VERSION` 12, deployed to the edge function.


---

## v3.7 — Extraction quality, reliability fixes, and native share

### Bundle reports no longer randomly drop + one automatic retry (1b82168, e82597a)
**Files:** `src/App.jsx`

Running a pack (e.g. Vibe: General + Love Language + Energy) sometimes returned only 2 of 3 reports, and which one was missing alternated between runs while Energy always survived — with no error in the edge logs. Cause: the per-family core caches (`connectionDigest` etc.) were read through a closure frozen at render time, so inside a single multi-report run their setters never updated the value the loop saw. Reports that should share a core (General + Love Language both use the plain "connection" key) each regenerated it instead — doubling the API cost and creating two independent failure points, so a transient hiccup on one call silently dropped one report client-side. Fixed with a synchronous `batchCoreCacheRef` (readable across loop iterations, cleared each run) so shared-core reports truly share one generation: atomic and half the calls. Plus a targeted single retry: a report that fails on a transient error (timeout, 5xx, cut-off/garbled answer) is retried once; non-recoverable errors (no credits, rate limited, misconfig) fail through as before.

### Grammar-limit fix — reports were silently running on Sonnet 4.5 (cb0e819)
**Files:** `supabase/functions/analyse-chat/schemas.ts`, `supabase/functions/_shared/prompts.js`, `src/analysis/aiAnalysis.js`

The six nested `{candidateId, text}` moment-pick objects pushed the compiled structured-outputs grammar over the API limit, so every connection call 400'd and silently fell back to Sonnet 4.5 without schema enforcement (visible only as 4.5 spend in the Anthropic console). Flattened to sibling `<field>CandidateId` integer fields, which keep the grammar small; the client accepts both shapes. PROMPT_VERSION 8.

### Signal precision pass — measured on a real 61k-message chat (d9a5ba2)
**Files:** `src/analysis/localMath.js`, `src/analysis/aiAnalysis.js`

The moment-detection regexes were firing on ordinary chatter: CONTROL matched "where are you heading" (46 hits → 3), AGGRO matched "stupid pigeons" banter (135 → 2), DISTRESS matched bare "tired/hard/lost" (604 → 109). Reworked all of them for precision (insults require a second-person target, distress needs an emotional frame, breakup no longer matches "I'm done for today"), added a statements-only AFFECTION_RE so pet-name-heavy chats stop tagging 4% of all messages as affection, and extended every signal to Spanish/Portuguese/French/Italian/Arabic (they were English/Turkish/German only). `laughStrength` grading now also feeds the local funniest-person count.

### Signature phrases carry personality + wider extraction budgets (69b1ddb)
**Files:** `supabase/functions/_shared/prompts.js`, `src/analysis/aiAnalysis.js`

Signature phrase redefined as "the line you'd use to impersonate that person" (a pet name, exaggeration, hype line, or recurring complaint) — repetition alone no longer qualifies, and logistics/fillers are excluded. Timeline spine widened to 70×12 runs, moment windows to 40/1000 lines, the candidate quote bank to ~37 entries, and the full-chat threshold to 2000 messages (~+3-4¢ per analysis). PROMPT_VERSION 9.

### Native share sheet for quiz challenge links
**Files:** `src/screens/Screens.jsx`, `package.json` (+`@capacitor/share`, `@capacitor/clipboard`)

On native (iOS/Android) the quiz challenge link now opens the OS share sheet via Capacitor Share instead of the web `navigator.share`, with a Capacitor Clipboard fallback and silent handling when the user dismisses the sheet.

---

## v3.6 — Quote-first results: quote bank, spine sampling, reveal choreography, card cleanup

### Quote bank — moment cards anchor on real extracted quotes (0bb6e69)
**Files:** `src/analysis/aiAnalysis.js`, `supabase/functions/_shared/prompts.js`, `supabase/functions/analyse-chat/schemas.ts`, `src/analysis/voiceLint.js`, `src/analysis/voice.js`

Moment cards had melted into long quote-less paragraphs (digest specs asked for "full shape" narration; the quote grounder silently stripped paraphrased quotes' marks). Now local math extracts a typed quote bank per chat (funny / care / tension / drama / affection / apology / energy-high / energy-low, each entry = verbatim quote + the other person's reaction), and the connection digest's six moment fields return `{candidateId, text}` picks anchored on it. The client verifies the picked quote appears verbatim in the text, rebuilds the field from the bank if the model paraphrased, and enforces one-candidate-one-card across the whole report — the same moment can never appear on two cards. Risk digest copies candidate quotes verbatim for red flags. Calibration examples are now exported, marked as a made-up chat in the prompt, and a `calibration-copy` lint error catches output that parrots them (the fabricated "Barcelona" cards). PROMPT_VERSION 7, CORE_ANALYSIS_CACHE_VERSION 8 — **edge fn deployed**.

### Funny accuracy — graded laughter, cascades resolve to the joke (0bb6e69)
**Files:** `src/analysis/aiAnalysis.js`

`isLaughReaction` was binary ("contains laughter anywhere"), so laugh cascades made laughing messages the "joke" and "content lol" trailers counted as reactions. New `laughStrength()` grades 0–3 (weak trailer / clear laugh / hard laugh: keyboard mash, 💀🤣, multi-😂, caps howl); laugh triggers must not themselves be laughing, funny candidates require a real receipt and keep the hardest one, and no card type can anchor on a laughing message or media placeholder. Mash detection hardened (consonant-only runs or long near-vowel-free tokens with 5+ consonant clusters; "combing"/"thank"/"pfffff" no longer count).

### Timeline spine — the early smartSample idea, upgraded (0bb6e69)
**Files:** `src/analysis/aiAnalysis.js`, `supabase/functions/_shared/prompts.js`

Large chats now send a two-layer corpus: a TIMELINE SPINE (55 contiguous 10-message runs evenly spaced across the full history — the chat's true proportions, storyline-following allowed) plus trimmed MOMENT WINDOWS (28 event excerpts; the timeline-fill pass is gone). Prompt rules route summary fields to the spine and moment fields to the windows, and state that moment windows over-represent the loudest moments by design. Chats up to 1,600 messages go to Claude in full (was 600) — restoring the early-version behaviour that made small-chat reports feel so grounded.

### Card cleanup + energy report rework (0bb6e69)
**Files:** `src/screens/Screens.jsx`, `src/analysis/localMath.js`, `src/i18n/translations.js`

Removed "A moment from the chat" (its fallback re-rendered sweetMoment — the duplication users saw), "Top 3 most active months" (duo + group), and the "Powered by AI" footers. Duo general is now 13 cards, group 16. Energy report (9 cards): opens with "The energy read" — name/energy-type chips plus the pair-chemistry read, no rings — and the rings + overall compatibility appear only on the closing card, so the first and last cards no longer duplicate.

### Reveal choreography + pinned nav (0bb6e69)
**Files:** `src/ui/Shell.jsx`, `src/screens/Screens.jsx`

Card content now arrives in beats after the slide settles: headline value pops at +80ms, payload card at +360ms, footnotes at +640ms, list items cascade. Sections keep their emotional tempo (roast/funny snappier, lovely softer, toxicity pure fades with no pop). GuessCard reveals compress the beats so the payoff stays immediate; reduced-motion collapses to a plain fade. Fixed two latent bugs: exiting cards replayed their entrance fades while sliding out, and share capture could snapshot mid-reveal invisible elements. Nav buttons are pinned to the bottom of the pane with bottom padding, content stays centered above them.

### Signature phrases: distinctive multi-word extraction + "Your language" card cleanup
**Files:** `src/analysis/localMath.js`, `analysis-test/aiDebugHelpers.js`, `supabase/functions/_shared/prompts.js`, `src/screens/Screens.jsx`

The old `signatureWord` was each person's most frequent content word with no distinctiveness check (both people could get near-identical words). New `computeSignaturePhrases` in localMath extracts 2-3-word expressions per person that are frequent for them (>=4 uses), rare for everyone else (>=3x ratio), skip link-bearing messages, contain at least one content token, exclude a multilingual everyday-formula list (good night / iyi geceler / merhaba / nasılsın / wie geht's / buenas noches / bom dia...), dedupe across participants, and prefer denser phrases ("fair enough" over "kanka ben" when counts allow). `signatureWord` (kept as fallback) also gained a distinctiveness requirement. `localStats` now returns `signaturePhrase[]`; the quiz payload carries it.

The candidates flow into the AI as evidence: `pickLocalContext` sends name+phrase pairs, the server prompt renders "Local counts found signature-phrase candidates: ... verify against the windows, never invent", the SIGNATURE PHRASES evidence rule now demands multi-word, recognizably-theirs expressions and bans greetings/daily formulas, and both pseudo-schema descriptions match. Verified end-to-end via the offline harness (real chat: Eylul "kanka ben", Ozge "fair enough").

Card 9 ("Your language"): removed the "The words and phrases that define this chat." explanation line, added a small SIGNATURE PHRASE label per box, added the local phrase as fallback between AI result and legacy single word, and guarded long phrases with minWidth/overflow-wrap. Note: `supabase functions deploy analyse-chat` needed for the prompt-side changes.


_Nothing pending — the sections below shipped in "Latest changes with UI mostly", "Quiz pages", and the quiz-chrome commit (cda28cf)._

### Quiz page chrome + iOS scroll fixes (shipped in cda28cf and earlier)
**Files:** `src/screens/Screens.jsx`, `src/ui/Shell.jsx`, `src/index.css`

- **Quiz page fills the viewport and owns the page chrome:** `#root` is a centering flexbox painted with `--app-safe-area-bg` (default navy); the public quiz page now stretches full-width and calls `setAppSafeAreaColor(PAL.finale.bg)` on mount (also updates the `theme-color` meta so Safari's bars tint maroon).
- **Window-scroll guard:** iOS could leave the document scrolled after rubber-banding (the "My Results shifts up" bug). Shell resets window/document scroll on screen changes; html/body get `overscroll-behavior: none`.
- **Sticky header `top` reverted to 0:** negative sticky offsets misbehave in iOS WebKit (suspected unlock-screen scroll freeze).
- **Quiz score CTA:** "Analyse your own chat, free" → "Try WrapChat for free".

### Pack multi-buy fixes + unlock/settings scroll clipping
**Files:** `supabase/migrations/20260716120000_pack_multi_buy.sql` (new), `src/App.jsx`, `src/screens/Screens.jsx`

Packs are consumable stock (the DB tracked quantities since `20260531120000_pack_quantity.sql`) but the client treated `unlockedPackIds` as boolean ownership, so three things were broken:
- **Owned packs couldn't be re-bought:** `buyPacksWithCredits` filtered out any pack you already owned and silently returned (no charge, no buffer). Removed the filter — owning a pack never blocks buying more; every successful buy now shows the "You're in" buffer.
- **Quantity stepper did nothing:** the Unlock screen's per-pack +/- selected quantities, but `selectedPacks` dropped them (unique ids only) AND the DB de-duplicated the array. Now `handlePrimary` expands by quantity (one entry per unit) and the new migration makes `unlock_report_packs` honor duplicate ids — buying Vibe ×3 charges 3× and increments quantity by 3, atomically in one transaction.
- **Dots showed presence, not amount:** `AnalysisDotsCounter` now renders one dot per owned unit (coloured by pack, capped at 10 with a +N overflow) instead of one lit dot per owned pack type.

**Scroll clipping (Unlock reads, Add Credits, Settings):** these used a full-bleed inner scroller (negative margins) nested inside Shell's pane, whose negative *bottom* margin pushed the scroll container past the pane's clip line — so the Unlock button landed under the safe area and couldn't be reached. Removed the inner scroller entirely and made the Shell pane itself the single scroll container (the pattern the review/relationship screens already use): the frosted header is now a direct sticky child of the pane. `getStickyHeaderStyle` now sets `top: -pullTop` (was `top: 0`) so a bled header stays glued to the very top edge while content scrolls under it, instead of detaching by `pullTop` px.

**My Results shift on return:** the My Results drawer (`SHELL_DRAWER_PADDING`, top `safe+6`) and the full "history" phase (Shell pane, top `safe+16`) sat at different heights, so opening a result and coming back — which lands you in the drawer rather than the full phase — visibly shifted the whole page up ~10px. Aligned `SHELL_DRAWER_PADDING` to `safe+16` to match.

**Deploy:** needs `supabase db push` (the multi-buy migration) plus the app build. No edge-function change.

---

## v3.5 — Evidence-led analysis: cast attribution, storyline arcs, quote grounding, German support

### Analysis quality: evidence-gathering extraction, quote grounding, storyline arcs (golden-validated)
**Files:** `src/analysis/aiAnalysis.js`, `src/analysis/localMath.js`, `src/analysis/voiceLint.js`, `supabase/functions/_shared/prompts.js` (PROMPT_VERSION 4), `scripts/golden-run.mjs`, `src/screens/Screens.jsx`, `src/App.jsx`

Golden-loop session on the real 6.9k-message Turkish duo: voice-lint went 14 errors → 0 across three live runs.
- **Recurring cast + NAMED ATTRIBUTION:** `extractRecurringCast` counts third-party names deterministically (Titlecase/apostrophe channels + filtered top-words recall, vocative filter) and ships dated evidence samples per name; the model may attach an event to a name only when a message literally ties them. Fixed the Habib/Josh storyline blending.
- **STORYLINE ARCS:** every cast entry carries its temporal span and its most recent mention; endings (breakups etc.) may only be claimed when later mentions stay consistent — a discussed breakup that recovered is a "rough patch," not an ending.
- **Deterministic quote grounding:** `groundResultQuotes` de-quotes any span not verbatim in the chat, wired into all six AI paths + harness. Fabricated quotes are now structurally impossible.
- **Drama candidates + reactions:** distress-driven `drama` candidate type; every candidate now includes the other person's reaction; the "why it lands for these exact people" commentary shape is required in all moment fields (the dad-casino principle).
- **Category contracts:** Miss requires both sides in one exchange, Unspoken requires wordless care, group-only fields empty on duos, quote-spent rule, ranked Memorable Moments criteria with the screenshot test.
- **Turkish register:** native-composition + actor-clarity rules (repeat names in pro-drop languages).
- **Cards skip when unfulfilled:** Love Language Miss/Unspoken/How-It-Shows and Energy's Charge render only with real content (`getLovelangScreenCount`/`getEnergyScreenCount`); duplicate fallbacks deleted.
- **German brought to structural parity:** all eight signal lexicons + stopwords/fillers gained colloquial German; cast detector disables the Titlecase channel for `de` (nouns are capitalized). Needs one real German chat for golden validation.
- **Harness:** dumps `local-analysis.json` (typed candidates, cast, math context) per run for reviewable "what we send Claude" evidence.

### UI feedback batch (share capture, admin, settings, icons) + deterministic time-of-day
**Files:** `src/ui/Shell.jsx`, `src/screens/Screens.jsx`, `src/analysis/aiAnalysis.js`, `src/analysis/localMath.js`

- **Share capture:** the `paneHeight + 120` allowance painted a flat band below the waves with the logo in it on every normal card; capture is now the exact natural card height (pane allowance only when content genuinely overflows), and the capture gets 56px top padding so the pill clears phone camera cutouts when viewed full-screen.
- **Admin Users tab:** credits no longer shown twice; controls in a tidy `76px/1fr/1fr` grid (amount / add / remove) with the resend button full-width below; light theme gets readable teal (#0E6B66 on teal tint) instead of invisible pale mint for resend/success notices, and error notices darken to #B34A17.
- **Settings:** `justifyContent:"safe center"` clipped the bottom unrecoverably on WebKit without `safe` support — restructured to the Unlock pattern (full-bleed scroller + sticky frosted header, alpha 0.9 + blur 8), 40px bottom padding.
- **SwatchIcon:** light theme always uses the vivid `accent60` fill (the Unlock page look); the solid dark report inner colors read as dark blobs on cream (PackResultsBuffer, My Results, trial).
- **Quiz copy:** intro now just "{count} questions"; share text drops "about a minute".
- **Time-of-day is now deterministic:** `normalizeTimeOfDay` overrides the AI's peakHour/peakDaypart with `math.peakHour`/new `math.peakHourRaw` (daypart derived locally); the AI keeps only the contrast sentence. General Wrapped and Energy Report can no longer contradict each other on peak times — first instance of the rule that deterministic facts always come from local math, never per-call AI output.

### Post-purchase buffer pages + Chat Memory Quiz redesign
**Files:** `src/screens/Screens.jsx`, `src/App.jsx`

**Post-purchase buffers:** new `PostPurchaseBuffer` component with two variants and a 200px dashed illustration slot (`data-illustration-slot="unlock" | "credits"`, artwork pending). Unlock flow ("You're in." → Continue) shows after a successful pack unlock; credits flow ("Credits landed." → Pick a read) replaces the success toast after buying credits and returns to the screen the purchase started from. Failure toasts unchanged. New `unlockBuffer`/`creditsBuffer` phases + `bufferTarget` state in App. Copy strings not yet translated (English fallback in all locales) pending final wording.

**Chat Memory Quiz brought onto the design system:** the public quiz page previously used ghost white-alpha cards, no font family, top-anchored layout, and depended on wc-btn/keyframe styles that only exist inside Shell (never mounted on the public route, so hovers/animations silently missing). Now: content vertically centered with the brand pill pinned top (stable frame across phases), solid `PAL.finale.inner` cards with accent borders, Nunito display type, Nav-style CTA with ForwardIcon, WaveLines behind, Shell-style 3px progress bar, Dots loading state, per-question fadeUp, safe-area padding, and a local `<style>` block providing the wc-btn/fadeUp/blink rules the page needs standalone. Emojis removed from score labels; key strings wrapped in `t()`.

**Share message fixed:** "I wrapped our chat — can you beat my score? 🎯" claimed a score the sender never had. Now: "How well do you actually remember our chat? 6 questions, about a minute." (no emoji, goes through `t()`).

---

## v3.4 — Server-side prompt construction, token telemetry, light-theme ink audit

### Server-side prompt construction + token telemetry (audit: "one refactor fixes four")
**Files:** `supabase/functions/_shared/prompts.js` (new), `supabase/functions/analyse-chat/index.ts`, `supabase/migrations/20260715120000_ai_usage_log.sql` (new), `analysis-test/aiDebugHelpers.js`, `src/analysis/aiAnalysis.js`, `src/analysis/claudeClient.js`, `src/analysis/localMath.js`, `src/analysis/voice.js`, `src/trialReport.js`, `src/App.jsx`, `src/screens/Screens.jsx`, `tests/promptServer.test.js` (new)

#### Prompts are now server-owned
All prompt text for every pipeline (connection, growth, risk, coreA, coreB, trial, relationship-confirm, translation) moved into `supabase/functions/_shared/prompts.js` — one pure-ESM module imported by three runtimes: the edge function (builds the real prompts), the app's request builders (debug panel/offline export parity), and the golden harness. The client now sends `{ pipeline, payload }` where payload is structured DATA only: redacted window text, math context values, name lists, candidate moments, relationship-confirm output. The edge function REJECTS any body carrying raw `system`/`userContent` (`legacy_client` 400) — the open-proxy hole where any entitled account could run arbitrary prompts on the API key is closed. Token budgets and schema selection are server-owned too (client-sent `max_tokens`/`schema_id` are gone).

**Prompt parity proven, not assumed:** a worktree diff of HEAD's client-built prompts vs the new shared-module prompts over identical inputs came back byte-identical for all 7 pipeline variants (incl. energy/accountability focus) plus trial; the parity run caught and fixed two porting bugs first (missing default CONFIRMED RELATIONSHIP line when no confirm context; three risk-only fields wrongly added to the coreB spec). The v3.3 voice work ships through this refactor unchanged.

#### Hardening at the trust boundary
Payload values are sanitized server-side before entering prompts: single-line fields get control chars/newlines stripped (no `<priority_rules>` injection via a forged ghost name), free-text relationship-context fields are length-capped, relationship category/specific labels are clamped against the fixed tables, candidate/window blocks are size-capped, list fields bounded. `tests/promptServer.test.js` pins these behaviors (suite: 58 passing).

#### Server-side prompt versioning
`PROMPT_VERSION` in the shared module is returned per request and logged per call — prompt text can now be improved by redeploying the edge function alone, no app release, with output changes correlatable in the log.

#### Token/cost telemetry (audit follow-up closed)
New `ai_usage_log` table (migration `20260715120000`): one row per request with user_id, pipeline, model, prompt_version, input/output tokens (summed across provider retries), provider call count, and outcome status. Written fire-and-forget with the service role; RLS with no policies (server-only). Repair-call usage is not counted (helpers don't surface it) — known minor undercount.

#### Deploy sequencing (IMPORTANT)
The new edge function rejects old-client bodies, and the new client sends bodies the old edge function rejects. Deploy as one step: `supabase db push`, then `supabase functions deploy analyse-chat`, then ship the web build / `cap:sync` immediately. Installed app versions older than this refactor lose AI analysis until updated (beta-acceptable).

### Light-theme ink audit (audit item: accessibility / white-on-accent contrast)
**Files:** `src/ui/Shell.jsx`, `src/screens/Screens.jsx`

White text hardcoded across themed (upload/trial) screens was invisible on the cream light background. New `ThemedSurfaceContext` in Shell marks sections whose background follows the theme; a `useInk()` hook in Screens maps ink to the surface (white family on the fixed dark report palettes, `#1f184e` alphas on cream). Applied to the base primitives `T`/`Big`/`Sub`/`Cell`/`Words`/`Dots`/`Nav` — report screens are untouched (context defaults to dark ink). Per-screen fixes: TrialReportScreen labels/info card/pack-explainer title, TermsFlow scroll caption, PreviewAuthConfirmed card, UpgradePlaceholder credits chip + disabled Unlock button, and the MyResults name-detail cards (now use `REPORT_BUFFER_STYLE_LIGHT` + `da.*` text like PackResultsBuffer already did). Dots on permanently-dark overlays (AICard, delete confirms) pin white via the new `color` prop. Pack stepper "+" now uses each pack's `fg` (white failed 2.5:1 on the yellow/green accents). Also fixed the pre-existing rules-of-hooks error in `AnalysisDotsCounter` (early return before `useTheme`). Measured contrast after: light body text 4.9–13.2:1, dark 5.7–16.2:1. Suite 51/51, eslint 0 errors.

Second pass (user caught the admin panel still white): the first audit only scanned the component containing each `<Shell>`, missing subcomponents. AdminFeedbackTab / AdminUsersTab / AdminAccessModeTab / AdminPreviewLab (~55 hardcoded white surfaces and texts) now use `useInk()` throughout — headers, pills (`adminControlPillStyle(ink)`), cards, note blocks, language toggles, mode options, and the errorTypeColor default chip all flip on light; delete-confirm overlays, red × buttons, and the dark scrim spinner intentionally keep white. A whole-file sweep of every remaining component confirmed the rest of the unguarded whites live on always-dark report screens or dead code (`CreditPackGrid`, `PricingCostOverview`, `Btn`, `TextList` are unused).

---

## v3.3 — AI voice system + structured outputs, edge gating, PII redaction, audit fixes

### Prompt restructure, voice system, structured outputs, and golden harness (audit item 4)
**Files:** `src/analysis/voice.js` (new), `src/analysis/voiceLint.js` (new), `src/analysis/aiAnalysis.js`, `src/analysis/localMath.js`, `src/analysis/claudeClient.js`, `analysis-test/aiDebugHelpers.js`, `supabase/functions/analyse-chat/schemas.ts` (new), `supabase/functions/analyse-chat/index.ts`, `scripts/golden-run.mjs` (new), `scripts/golden/loader.mjs` (new), `tests/voiceLint.test.js` (new), `tests/promptStructure.test.js` (new), `package.json`, `.gitignore`

#### Voice system — single source of truth
New `src/analysis/voice.js` holds the WrapChat voice contract, built from the product's reference-tone outputs (anonymised): scene + real detail + coined micro-label, untranslated quotes, named third parties, casual spoken register. Four calibration examples ship in every analysis system prompt. Non-English output gets an explicit native-register instruction plus a per-language register example (tr/es/pt/fr/de/it) so results stop sounding like translated English. Em/long dashes are banned once in the prompt AND stripped deterministically at normalisation time (`stripLongDashes` in localMath, applied in `strOr`, red flags, timeline, and memorable moments) — the guarantee no longer depends on model obedience.

#### System prompt restructure — every rule once
`buildAnalystSystemPrompt` now assembles tagged sections (`<priority_rules>`, `<data_boundary>`, `<evidence_rules>`, `<voice>`, `<scope>`, `<relationship_context>`, `<output_language>`, `<json_rules>`). The four pipeline builders in `aiDebugHelpers.js` were rewritten to carry ONLY pipeline scope; the previously 2-3× duplicated rules (funny attribution, window format, speaker attribution, relationship language, em-dash ban, accountability BROKEN-promise rule) each now appear exactly once per request. `tests/promptStructure.test.js` guards against the duplication creeping back.

#### Candidate moments — local pre-extraction against repetition
`extractCandidateMoments` (aiAnalysis) reuses the local event scoring to pre-extract up to 3 moments per type (funny with its laugh reaction, care, tension, affection, apology), deduplicated by message distance and token-overlap so the same story can't appear twice. The connection, core-A, and risk prompts now receive a numbered CANDIDATE MOMENTS list with a reservation rule (each candidate anchors at most one output field) plus a RECURRING TOPICS spread rule from local word counts — directly attacking same-moment/same-topic repetition across cards.

#### Structured outputs — schema-guaranteed JSON
New `supabase/functions/analyse-chat/schemas.ts` defines JSON output schemas for connection/growth/risk/relationship/trial/translation. The client sends `schema_id`; the edge function attaches `output_config.format` when a schema exists. Control tokens (love languages, trajectory, depth change, energy type, dayparts, relationship categories) are now enums enforced by the API. Graceful degradation: if the model rejects structured outputs (400), the function retries once without the schema and falls back to the existing prose-JSON + repair path; the fallback model always uses the prose path. Once structured outputs are confirmed in production the repair machinery can be deleted.

#### Golden harness — voice is now measurable
`npm run golden -- tests/golden/chats/<chat>.txt` runs the real pipeline (parse → localStats → candidates → prompts → Anthropic → normalise → derive reports) against a local export and lints every output field with `voiceLint.js`: long-dash detection, banned analyst phrases (shared list with the prompt), repeated-quote-across-fields, near-identical fields, generic moment fields (no name, no quote), length caps. `--offline` builds and saves the prompts without API calls. `tests/golden/` is git-ignored (real chat content). Requires `ANTHROPIC_API_KEY` in env for live runs; supports `--model` for A/B testing model upgrades (e.g. claude-sonnet-5).

#### No emojis in results (hard rule) + platonic narration guard
`languageEmoji` removed from prompts and server schemas (it was never rendered by any screen; normaliser now returns ""). New `src/analysis/textSanitize.js` centralises the hard text rules: `sanitizeResultText` strips em/en dashes AND all emoji (pictographs, ZWJ sequences, skin tones, flags, keycaps) from every AI-written field at normalisation time; applied in `strOr`, `cleanStringArray`, and the localMath normalisers. The voice contract bans emojis in model output (including dropping them from quoted chat lines); the linter flags any emoji as an error. Local-math surfaces like the Spirit Emojis card are intentionally unaffected. Separately, platonic reports (friend/family/colleague/other) now carry a PLATONIC NARRATION rule: the participants' own romantic vocabulary ("askim", "sacma sapan bi ask bizimkisi") may be quoted, but the narrator's own words must never frame the bond as love/romance/a couple; the linter's `romantic-narration` rule watches for it.

#### UI structure: pinned headers everywhere + light-theme color retune
**Word variants:** top-words now merge spelling variants under the most-used form (kanka/knka/knk -> kanka, summed counts) via a consonant-skeleton grouping in `mergeVariantCounts`; generic day-words (bugün/yarın/akşam/today/tomorrow...) joined the filler list.
**Fixed headers (the My Results structure, now the contract):** new `SCREEN_BODY_SCROLL_STYLE` + `getStickyHeaderStyle` exports in Shell. Applied to Settings (content now scrolls with `safe center` instead of overflowing into the header on short viewports — the reported overlap bug), PaymentScreen/Add Credits, PackSelect (header moved out of FadeScale: transforms break position:sticky), PackResultsBuffer, UpgradePlaceholder (credits chip pinned together with the header), Admin (tab bodies share one scroll area; both inner 58vh caps removed), DuplicateParticipantReview, ParticipantMismatchReview, ProfileNameMismatchReview, and RelationshipSelect. Back button + title now stay visible on every scrollable page.
**Unlock reads header — full-bleed + frosted:** the Unlock reads screen moved to the same full-bleed scroll wrapper as Add Credits (`hidePill`, scroller starts at the top content edge), so the header surface reaches the very top of the page and content can never render above it. `getStickyHeaderStyle` gained `alpha` and `blur` options: the unlock header uses `alpha: 0.94, blur: 8` (backdrop-filter, with the `-webkit-` prefix iOS WebKit needs), so content scrolling under the header shows as a soft frosted haze instead of readable text. All other headers keep defaults (opaque, no blur).
**Light theme:** DA_LIGHT accents were the dark theme's values verbatim — tuned to glow on deep indigo, they washed out on cream (lime ~1.3:1, teal text ~1.8:1). Retuned hue-for-hue to hold >=4:1 as text on #EDE8DC and >=4.4:1 as fills under white text (teal #12837E, amber #A8690D, lime #6E7F10, blue/purple #4353CC, orange #B34A17); muted/faint alphas bumped (0.6->0.66, 0.28->0.34); PrimaryButton's default label goes white on the darker light-theme fills; GhostButton's light border 0.16->0.26. Needs an in-app visual pass to confirm the retune reads well.

#### Top-words cleanup + analysis-mechanics guards
`localStats` word/bigram/signature frequencies now share one `isContentToken` gate: diacritic-folded stop-word matching (ASCII Turkish "cok"/"simdi" now filtered like "çok"/"şimdi"), a new CHAT_FILLER_WORDS list (yani/evet/zaten/iyi/tamam/aynen/falan... + like/okay/actually/thing/really...), laugh-token filtering in every language via `isLaughReaction`, and fixed URL-remnant filtering (fused "wwwsitecom"/"httpsinstagram..." tokens). On the reference chat, top words went from filler ("cok", "yani", "evet", "zaten") to persona and story ("kanka", "askım", "tim", "josh", "aga"); bigrams from "cok iyi" to "fair enough", "bira icip", "indoor cycling". Separately, an OUTPUT HYGIENE rule bans analysis mechanics from result text (windows, snapshots, candidate numbering, redaction placeholders) and the linter's new `mechanics-leak` rule enforces it; current outputs scored clean.

#### Client-side PII/credential redaction before AI sampling
New `src/analysis/redactSensitive.js`: emails, 10+-digit numbers (phones, cards, accounts), IBANs, URL credentials, and keyword-marked secrets (password/şifre/parola/pin/otp/doğrulama kodu/username/kullanıcı adı, TR + EN) are replaced with placeholders BEFORE chat text is sampled into any AI request — applied at all three funnels every AI-bound message passes through: `formatMessageLine` (all windows/snapshots, every pipeline incl. trial), candidate-moment quotes, and relationship-confirm snippets. Redacted values never leave the device; local math and on-device rendering are untouched. Dates, times, and prices are preserved (digit-count threshold). A PRIVACY rule in the shared evidence rules is the model-side backup and also bans placeholders from appearing in output text. Verified end-to-end: a chat containing a phone number, wifi password, and email produced prompts containing only `[number]`, `şifre [redacted]`, and `[email]`. 8 new tests (suite: 50 passing). Known limits: spelled-out numbers and free-text home addresses are not caught.

#### Quote grounding — fabricated-quote detection
User spotted a real grounding failure: the energy report claimed a "Tim breakup" that never happened (the model blended Ozge's Tim visa-bureaucracy stress with Eylul's Josh breakup). Fixes: (1) THIRD PARTIES evidence rule: third-party life events only when the chat states them literally, never merging storylines, travel/distance is never a breakup; (2) QUOTES rule tightened: a quote is a verbatim substring of ONE message, no reordering, no splicing two messages; (3) coined phrases must stay unquoted, quote marks reserved for verbatim chat text; (4) new `lintQuoteGrounding` in the harness verifies every quoted span exists in the source chat (diacritic/emoji/punctuation-insensitive), with Turkish-suffix-apostrophe-aware quote extraction. Retro-lint of the first run caught the model reordering one quote and splicing two messages into another.

#### First golden run (real 6.9k-message Turkish duo) — tone validated
All three digests completed with `stop=end_turn` (no truncation at the new budgets). Turkish output landed in the reference register natively. After linter fixes (exclude the embedded `coreAnalysis` metadata subtree from comparisons; genericity judged by leaf name; quote-valued/period leaves exempt) the true score was 2 errors, both the same root cause: one care quote reused across `careStyle.examples` and `loveMissUnspoken` — a distinctness pair rule was added for exactly that pair. `--relint` flag added to re-score saved outputs without API calls. Examples join no longer produces double periods.

#### Notes
- Relationship-confirm, trial, and translation calls also gained schemas (`relationship`/`trial`/`translation`), which structurally eliminates the "reasoning before the JSON" failure class.
- Suite: 37 tests passing (voice lint 10, prompt structure 7, parser 6, dataset 7, identity 7).
- Deploy: `supabase functions deploy analyse-chat` picks up schemas.ts automatically; no migration needed.

### Security, correctness, and trust fixes from the July 2026 audit
**Files:** `supabase/functions/analyse-chat/index.ts`, `supabase/migrations/20260712120000_edge_ai_gating.sql`, `src/App.jsx`, `src/analysis/aiAnalysis.js`, `src/analysis/claudeClient.js`, `src/import/whatsappParser.js`, `src/screens/Screens.jsx`, `src/i18n/translations.js`, `tests/whatsappParser.test.js`

#### Server-side gating for analyse-chat (closes the open-proxy hole)
The edge function previously verified the JWT and nothing else — any free account could use it as an unmetered Anthropic proxy and bypass the paywall entirely. It now enforces, per request: a per-user rate limit (60 calls/hour, `consume_ai_call_quota`), an entitlement check (`user_has_ai_entitlement`: open mode, allowlisted admin, credits > 0, owned pack, or live Quick Read), a `schema_mode` allowlist, and payload size caps. New migration `20260712120000_edge_ai_gating.sql` adds both RPCs (service-role only) plus the `ai_usage_counters` table. `GATING_FAIL_OPEN = true` keeps production alive until the migration is deployed — **flip to `false` after applying the migration**. Client maps the new 402/429 responses to friendly copy in `userFacingAnalysisError`. Known follow-up before real payments go live: tie each call to a paid run grant so a funded account can't over-consume within the rate limit.

#### Output token budget unblocked (silent truncation fix)
`MAX_PROVIDER_TOKENS` 2600 → 5000 and `TRUNCATION_RETRY_TOKENS` 2600 → 6400. The old values clamped Core A's 3200-token request to 2600 (the ~50-field schema regularly needs more) and made the truncation retry dead code (`2600 < 2600` never fired). Client budgets raised: `CORE_A_MAX_TOKENS` 3200 → 4200, `CORE_B_MAX_TOKENS` 2600 → 3400. Fallback model updated `claude-sonnet-4-20250514` (retired 2026-06-15, now 404s) → `claude-sonnet-4-5`.

#### WhatsApp parser: two data-integrity bugs fixed
(1) Multi-line messages were **dropped entirely, not merged** — the join glued continuations with `\n` into one string, which the un-flagged `$` anchor in the header regex can never match, so the final loop skipped every multi-line message. Parsing now matches the header line only and appends continuations. (2) `SYSTEM_MESSAGE_RE` contained bare `added|removed|left`, deleting real messages like "I left work early". Group-event words are now only treated as system content when the raw line carried WhatsApp's invisible direction mark (iOS system/media prefix), dated non-header lines (Android system events) are dropped before gluing, and the phrase list keeps only unambiguous system phrases. Six regression tests added in `tests/whatsappParser.test.js` (suite now 20/20).

#### Honest privacy copy
"Powered by AI — your messages never left your device." was factually false (sampled windows are sent to the AI). Replaced with "Powered by AI — analysed securely, never stored." in both result screens and all 8 locales, matching the brand doc's privacy promise.

#### Charge before save (free-report leak fix)
`runAnalysis` now generates all results in memory, deducts credits, and only then persists. Previously a failed deduction still left the generated reports saved and re-openable from history for free. If a save fails after payment, the result stays usable in-session.

#### Prompt-injection hardening
`buildAnalystSystemPrompt` now includes a DATA BOUNDARY rule: chat content inside message windows is data to analyse, never instructions to follow.

#### Relationship-confirm call: reasoning preamble fix
`confirmRelationship` token budget 300 → 700 and an explicit "first character must be {" output rule — on ambiguous endearment cases (e.g. Turkish "annem" between partners) the model reasoned out loud, exhausted the 300-token budget before the JSON, and the relationship context was silently dropped after a parse failure.

#### Share capture + finale button fixes
Share images no longer append a footer strip: `getShareCaptureHeight` captures the natural card height and the tinted logo is overlaid bottom-center on the waves (absolute, z-30) instead of being appended as a flex footer. Finale back buttons (`PremiumFinale`, `Finale`) pin white-alpha text/border — `GhostButton` styles by global theme, which made the button invisible on the always-dark report palettes in light mode.

---

## v3.2 — Interactive reports, Chat Memory Quiz, and Finale redesign
**Files:** `src/ui/Shell.jsx`, `src/screens/Screens.jsx`, `src/analysis/aiAnalysis.js`, `src/analysis/localMath.js`, `analysis-test/aiDebugHelpers.js`, `src/App.jsx`, `supabase/migrations/20260603130000_quiz_challenges.sql`

### GuessCard + AttributionCard — new interactive UI primitives
Two new reusable components added to `src/ui/Shell.jsx`. `GuessCard` implements a three-phase guess-before-reveal mechanic: guess → 820ms correct/wrong button feedback → reveal. `confidenceValid` prop gates the interactive mode; when false, renders flat content directly. `onReveal` callback supports auto-advance to the following card. Nav is now owned internally by GuessCard: only a Back button is shown during the guess phase — answering is required to advance. `AttributionCard` implements a "Who Said This?" mechanic with hidden sender, name buttons, and a correct/wrong reveal showing sender + context. `isSensitive` flag suppresses the guessing mechanic for harmful content and renders a plain moment card instead.

### AI schema extensions — all four prompt builders
`analysis-test/aiDebugHelpers.js` extended with new JSON fields across all pipelines. Core A / Connection Digest: `timeOfDay` (peak hour + daypart per person + contrast), `loveLanguageIntro`, `loveMiss` (description + quote + persons), `loveMissUnspoken`, `energyDynamic`, `guessThresholds` (`loveLanguageGuessValid`, `energyGuessValid`). Growth Digest: `personAArc`, `personBArc`, `turningPoint`, `messageAtTurningPoint` (quote + person + contextParagraph), `growthGuessThreshold`. Core B / Risk Digest: `whatStillHere`, `heavyAttributionQuote` (quote + person + contextParagraph + `isSensitive`), `apologyGuessThreshold`, `powerGuessThreshold`, `reliabilityArc`, `promiseThatMattered`, `promiseGuessThreshold`. `src/analysis/aiAnalysis.js` updated with four new normalisers (`normalizeAttributionQuote`, `normalizeTimeOfDay`, `normalizeLoveMiss`, `normalizeGuessThresholds`) and all five `derive*` functions pass new fields through. Boolean coercion handles Claude's string `"true"` output for all threshold flags.

### General Wrapped Duo — restructured (17 → 15 cards)
`DUO_CASUAL_SCREENS` 17 → 15. "Who's more obsessed?" restored as card 1 with animated bars. Ghost Award (card 2) converted to GuessCard when reply times are skewed; when balanced, "Who reaches out first?" (card 6) becomes the GuessCard instead — one interactive card always fires in the opening sequence. Removed: The Last Word, Novelist vs Texter, Media & Links. Merged: Top 10 Words + Signature Phrases → "Your Language" (card 9). Added: Time of Day (card 12) showing peak hours per person with contrast sentence. Added: A Moment from the Chat (card 13) — AttributionCard using a memorable moment with quote; falls back to AICard for old results without new schema fields. Reordered ending: Chat Vibe → 14, What's Really Going On → 15.

### Growth Report — expanded (5 → 10 cards)
`GROWTH_SCREENS` 5 → 10. Added: Person A's Arc (card 2), Person B's Arc (card 3). Added: Guess Who Changed More (card 4) — GuessCard gated by `growthGuessThreshold`; auto-advances to card 5 on answer. Renamed "Who changed more" → "How they changed" (card 5) as the detailed follow-up. Added: The Turning Point (card 7) — approximate period; graceful fallback when undetectable. Added: The Message That Shifted Everything (card 8) — AttributionCard using `messageAtTurningPoint`; falls back to trajectory detail. Trajectory and The Arc renumbered to 9–10.

### Energy Report — expanded (6 → 10 cards)
`ENERGY_SCREENS` 6 → 10. Added: Guess Who Lifts the Chat More (card 4) — GuessCard gated by `energyGuessValid`; winner = higher `netScore`; wording softened from "more positive presence" to "who lifts the chat more?". Added: The Dynamic (card 5) — `energyDynamic` sentence about the pair's combined energy. Most Energising and Most Draining reordered to 6–7. Added: Energy by Time (card 8) — peak hours per person from `timeOfDay` data. Added: The Charge (card 9) — AttributionCard using a funny/signature memorable moment; falls back to Most Energising text. Energy Compatibility closing card → 10.

### Love Language Report — expanded (5 → 10 cards)
`LOVELANG_SCREENS` 5 → 10. Added: Love Languages in This Chat (card 1) — `loveLanguageIntro` overview. Added: Guess A's Love Language (card 2) — GuessCard using both detected languages as options; requires 2 distinct options; auto-advances on answer. Person A/B cards → 3–4. Added: The Miss (card 6) — `loveMiss` description + italic quote + persons direction arrow. Added: The Unspoken Moment (card 7) — `loveMissUnspoken`. Most Loving Moment → card 8. Added: How It Shows (card 9) — AttributionCard using a care/sweet memorable moment; falls back to Most Loving Moment text. Compatibility ScoreRing moved to card 10 (closing).

### Accountability Report — expanded (7 → 10 cards)
`ACCOUNTA_SCREENS` 7 → 10. Added: Guess Who Made More Promises (card 2) — GuessCard gated by `promiseGuessThreshold`; winner = higher promise `total`. Added: The Reliability Arc (card 6) — `reliabilityArc` sentence: did reliability improve or decline over time? Added: The Promise That Changed Things (card 8) — AttributionCard using `promiseThatMattered`; falls back to most notable kept promise text. Report now ends on the kept promise card.

### Toxicity Report — redesigned (7 → 10 cards)
`TOXICITY_SCREENS` 7 → 10. Card 1 redesigned: ScoreRing removed from opening — the number now lands after all the evidence, not before it. Added: Guess Who Apologises More (card 3) — GuessCard gated by `apologyGuessThreshold`; auto-advances to the full context card. Red Flag Moments list replaced with A Moment from the Conflict (card 5) — AttributionCard using `heavyAttributionQuote`; `isSensitive` flag suppresses guessing for harmful content; falls back to Conflict Pattern text. Added: Guess Who Steers the Emotional Tone (card 7) — GuessCard gated by `powerGuessThreshold` plus a "Balanced" guard that disables the guess when no clear holder exists; auto-advances to full detail. Added: What's Still Here (card 9) — prevents the report ending as a pure indictment. ScoreRing moved to The Verdict (card 10, closing).

### Finale — redesigned
`vibeOneLiner` promoted to hero position above the stat grid. Names + message count metadata line added at top. Challenge card added: "Challenge a friend" section with "Send the challenge" button — calls `createQuizChallenge()`, uses Web Share API when available, falls back to clipboard copy with toast. Challenge card hidden during screenshot shares (`data-share-hide`) and suppressed in Red Flags mode. Quiz teaser copy: "Chat Memory Quiz — 6 questions about this chat."

### Chat Memory Quiz — Phase 9
Full quiz challenge system for viral sharing. `buildQuizQuestions(quizData)` in `localMath.js` generates 6 questions from local stats using a deterministic seeded shuffle (no AI required). Questions: Who sent more messages, Who takes longer to reply, Spirit emoji (2×2 grid), Signature phrase, Most used word (2×2 grid), Longest streak (hardest, last). New `quiz_challenges` Supabase table with public anon read RLS — migration at `supabase/migrations/20260603130000_quiz_challenges.sql`. `ChatMemoryQuiz` standalone component uses the finale palette (`#5E1228` background, `#F08EBF` accent) and a top-anchored fixed-width layout so all phases have a consistent column position. URL detection in `App.jsx` initialises `phase = "quiz"` from pathname before auth effects fire; auth routing fully bypassed. `onJoin` transitions from quiz score screen → auth → Quick Read trial.

### Bar animation fix
Bar fill now starts after `SLIDE_MS + 80 + delay` ms — previously started at 120ms, competing with the 480ms card slide animation. Switched from CSS `width` transition (layout reflow per frame) to `transform: scaleX()` (GPU compositor thread). Numbers inside bars fade in separately after the fill settles via a `showLabel` state and opacity transition.

### Bug fixes
- `normalizeRedFlags` and `normalizeTimeline` used throughout `Screens.jsx` but never imported — caused `ReferenceError` in Safari/production; both now explicitly imported from `localMath.js`
- All AttributionCard usages: when quote data is absent (old saved results), cards now show a meaningful fallback AICard instead of an empty label-only placeholder
- GuessCards that auto-advance no longer show a redundant intermediate reveal page before the full-detail card — user sees 820ms button feedback then slides directly to the next card

---

## v3.1 — Animation system overhaul + auth/upload frame unification
**Files:** `src/App.jsx`, `src/theme.jsx`

### AuthUploadFrame — logo persists across sign-in
`Auth` and `Upload` phases merged into a single `AuthUploadFrame` component that wraps both inside one `Shell`. `BrandLockup` lives outside the animated region, so it stays perfectly still when the user logs in and the phase transitions from `auth` to `upload`. `AuthPhaseFade` handles the content swap internally — the tab toggle + inputs fade out while the upload controls fade in (180–220ms crossfade). `setSid` no longer fires on `auth → upload` since no Shell remount is needed; it still fires for all other phase changes.

### FadeScale and StaggerList entry animation components
New `FadeScale` wrapper plays a fade + scale-from-0.93 entry animation (320ms ease-out, `wcFadeScaleIn`). Applied to `RelationshipSelect` and `PackSelect` content via `key={animKey}` (set to `sid`) so the animation re-triggers each time the screen is mounted. New `StaggerList` wrapper staggers list children in 55ms apart (280ms ease-out, `wcStaggerItemIn`). Applied to both the Reports and Names lists in `MyResults`.

### SlidingSegmentedTabs — shared animated tab control
New `SlidingSegmentedTabs` component replaces all four inline tab/segmented control implementations (`Auth`, `TermsFlow`, `AdminPanel`, `MyResults` sort control). A sliding indicator div animates with `translateX` at `240ms cubic-bezier(0.22, 1, 0.36, 1)` instead of per-button background swaps. Accepts `compact`, `padding`, `background`, `activeBackground`, `activeColor`, `inactiveColor` props. Supports a `suffix` per item (used by `TermsFlow` for read checkmarks). ARIA `role="tablist"` / `role="tab"` / `aria-selected` wired correctly; indicator is `aria-hidden`.

### Shell — animateIn prop and new CSS keyframes
`Slide` and `SlideContext` gain an `animateIn` prop (default `false`). When true, `Shell` initialises `isEntering` state and plays `wcContentIn` on mount — matching the existing between-card slide — then clears after `SLIDE_MS + 50ms`. Used on `settings`, `upgrade`, and `payment` phase entries. Five new `@keyframes` added to Shell's inline `<style>`: `wcFadeScaleIn`, `wcStaggerItemIn`, `wcAuthFadeIn`, `wcAuthFadeOut`, `wcWaveLayerIn`. `prefers-reduced-motion` overrides collapse all new animations to 150ms fades or instant transitions.

### WaveLines — staggered intro on upload screen
`WaveLines` accepts a new `intro` boolean. When true each SVG wave starts at `opacity:0` and fades in via `wcWaveLayerIn` (620ms spring ease) with staggered delays (`120ms + i×110ms`). Shell passes `intro={forceWaves && sec === "upload"}` so the waves animate in only on the upload homepage, not on result screens.

### SwatchIcon inner layer — neutral dark background
Inner rotated square background changed from `${accent}20` (tinted semi-transparent) to `rgba(0,0,0,0.14)` — a palette-neutral dark overlay that reads consistently across all pack accent colors.

### Upload screen — reads check includes unlocked packs
`isTrialUsed` renamed to `hasNoPaymentReads`. Logic updated: `isPaymentsMode && !quickReadAvailable && !hasUnlockedReads`. Users with any unlocked pack reads no longer see the "No reads left" banner even at zero credits. Same fix applied inside `AuthUploadFrame`.

### SettingsScreen — shared select style object
Repeated inline styles across the UI language and report language `<select>` elements extracted into a shared `languageSelectStyle` object. Adds a custom SVG chevron via `backgroundImage` with `appearance:none` / `WebkitAppearance:none` / `MozAppearance:none` so the native arrow is suppressed consistently across browsers.

---

## v3.0 — Persistent report unlocks + iOS safe-area polish
**Files:** `src/App.jsx`, `src/reportCredits.js`, `supabase/migrations/20260517120000_persistent_report_unlocks.sql`, `supabase/functions/delete-account/index.ts`

### Persistent report unlocks — new table and RPCs
Pack unlocks are now stored in Supabase instead of only kept in local React state. New `public.report_unlocks` table (`user_id`, `pack_id`, `credits_spent`, `source`, `unlocked_at`; unique on `user_id × pack_id`). RLS enabled; users can only read their own rows. Four new RPCs: `get_report_unlocks(p_user_id)` — returns owned pack ids as a text array; `unlock_report_packs(p_user_id, p_pack_ids)` — atomically deducts credits and inserts unlock rows for any not-yet-owned packs, returning updated balance and full unlock list; `simulate_credit_purchase(p_user_id, p_bundle_id)` — adds credits from a named bundle (starter/plus/all_access) as a placeholder for real payment; `admin_add_credits(p_user_id, p_amount)` — admin-only direct credit adjustment. Helper `report_pack_credit_cost(pack_id)` encodes pack costs server-side. All functions are `security definer` with locked `search_path`.

### Frontend unlock integration
New exports in `reportCredits.js`: `getUnlockedReportPacks`, `unlockReportPacks`, `simulateCreditPurchase`. `getUnlockedReportPacks` and `getUserProfile` now fetched in parallel via `Promise.all` on login, so the first render already knows which packs the user owns. `buyPacksWithCredits` replaced: it now calls `unlockReportPacks` (Supabase RPC) which deducts credits and persists unlocks server-side, then writes both `credits` and `unlockedPackIds` state from the response. On successful analysis completion, `unlockReportPacks` is also called for the completed pack so the unlock is recorded even if the user paid credits in a prior session. `unlockedPackIds` state is cleared on new chat upload and on logout. `PaymentScreen` and `TrialFinale` receive an `onPurchaseCredits` prop; when provided, the pay button calls `purchaseCredits` which invokes `simulateCreditPurchase` and updates balance + shows a brief toast notification.

### Account deletion cleanup
`supabase/functions/delete-account/index.ts` now deletes rows from `report_unlocks` before deleting the `credits` row, matching the cascade order. Ensures no orphaned unlock records remain for deleted users.

### AnalysisDotsCounter — explicit pack state support
`AnalysisDotsCounter` refactored to build `dotPacks` from `PACK_ORDER` so ordering is consistent. When `useExplicitPackState` is true, active dots are driven by `activePackIds` map (owned packs); when false, dots still fall back to the `Math.floor(credits / cost)` heuristic for backward compatibility.

### iOS safe-area — transition and color flash fixes
Removed `document.documentElement.style.transition` and `document.body.style.transition` assignments from Shell's `useLayoutEffect`. These were causing the safe-area background to animate through an intermediate maroon color (midpoint of `#1C0E5A` and `#B83A10`) when transitioning between sections. Removed `transition: background 480ms` from `wc-root` for the same reason — all background layers now snap in sync. Progress bar repositioned from `top: SHELL_SAFE_TOP` to `top: 0` so it sits at the very top of the screen behind the notch.

### First-card maroon flash fix — General Wrapped
General Wrapped's loading screen uses `sec="general"` (dark indigo `#1C0E5A`) while the first result card uses `sec="roast"` (orange `#B83A10`). During React's commit phase the DOM briefly holds neither color, producing a maroon blend visible on iOS. Fixed by pre-painting the wc-root, its safe-area cover div, and html/body/root backgrounds to the first card's color synchronously inside `restoreGeneratedResult` (and `onRestoreResult` for history restores), before any React state updates are batched. All other report types were unaffected because their loading palette already matched their first card.

### PackResultsBuffer — header label removed
Removed the "VIBE PACK" (pack name) label pill from the PackResultsBuffer header. The title now aligns vertically with the back button without the extra label above it.

---

## v2.9 — Quick Read entitlement, pack-based credit pricing, multi-chat upload, iOS polish
**Files:** `src/App.jsx`, `src/reportCredits.js`, `src/accessMode.js`, `src/trialReport.js`, `src/theme.jsx`, `supabase/migrations/20260514120000_quick_read_entitlement.sql`

### Quick Read separated from purchased credits
Quick Read is no longer charged against the user's credit balance. It is tracked as a separate one-time entitlement (`quick_read_available`) in the `credits` table. New Supabase migration adds `quick_read_available boolean default true` and `quick_read_used_at timestamptz` columns; a backfill marks existing users who already ran a Quick Read as having used it. `initialise_credits` recreated to start new users at 0 purchased credits + `quick_read_available = true`. New `consume_quick_read_trial(p_user_id)` RPC marks the gift as spent after a successful Quick Read run. `QUICK_READ_TRIAL_CONFIG` exported from `reportCredits.js` (`creditCost: 0`). App `getUserProfile()` now returns `quickReadAvailable`; new `quickReadAvailable` state replaces the old `credits === 1` trigger. `deductCreditsBatch` filters out `trial_report` so Quick Read never touches the balance.

### Pack-based credit pricing
Credit costs overhauled. New `REPORT_PACKS` object in `reportCredits.js` defines four packs with integer credit costs: growth (45), rf (80), vibe (95), full (210). `PACK_DEFS` costs in App.jsx now reference `REPORT_PACKS` directly — single source of truth. `CREDIT_BUNDLES` replaces the old inline array: Starter (100 cr, €1.99), Plus (250 cr, €3.99, recommended), All Access (450 cr, €7.99). New exports: `REPORT_PACK_ORDER`, `getPackCreditCost`, `estimateAnalysesLeft`, `getCreditBundleById`. `getTotalCreditCostBundled` now resolves to the cheapest covering pack when no exact bundle match exists, removing the old `FAMILY_ADDON_COST` logic. Individual `reportCredits` entries map to their cheapest covering pack cost so no legacy 1–2 credit prices leak through.

### CreditPackGrid — recommended star badge
`SolidStarIcon` component added. Shown inline next to the pack label when `pack.recommended === true` (Plus pack). Pack description line simplified: recommended packs show "Recommended", others show "One-time credits". Grid item key changed from `pack.label` to `pack.id`; `pack.price` → `pack.priceLabel`.

### PricingCostOverview — bundles section now uses PACK_DEFS
Bundle rows in `PricingCostOverview` now iterate `PACK_ORDER` and render from `PACK_DEFS` instead of the old `BUNDLES` object, so the displayed costs are always in sync with pack definitions. The "Report costs" tile replaced with a "Credit rules" tile ("Credits never expire.", "One-time purchases only.", "No subscriptions.").

### RelationshipSelect — optional extra chat files
Screen title changed from "Relationship" to "Set up this chat". Users can optionally add a second chat export from the relationship screen. Tapping the extra-file area runs `processImportedChatFile` and appends the result to a local `extraChats` list. On relationship confirm, `onSelectRelationship` forwards `extraParsedChats` to the app; if extra chats are present and `pendingParsedInput` exists, `buildCombinedAndContinue` merges all inputs via `buildCombinedDataset`, resolves any merge suggestions, and advances to `select` with `skipRelationship: true` so the relationship screen is not shown again. `pendingParsedInput` stored on parse (single uploads only) for use in the combine step; `pendingSkipRelationship` flag propagated through merge-review and participant-mismatch confirmation paths.

### PackSelect — unlock flow replaces direct payment
`onOpenPayment` prop on PackSelect replaced with `onOpenUnlock`. New `openUnlockReads` function navigates to the upgrade screen without directly opening payment. New `unlockPackForCurrentChat` function marks a pack as locally unlocked (`unlockedPackIds` state) and returns to the select screen — gives the upgrade/payment flow a way to signal that a pack is available for the current chat session. `UpgradePlaceholder` receives `onUnlockPack` when `messages` and `math` are present.

### Report language moved to Settings
`reportLang` / `onReportLangChange` props removed from `PackSelect`. `SettingsScreen` now receives `reportLang` and `onReportLangChange` props; language change from Settings still resets the core analysis cache. Default `reportLang` on reset changed from `"en"` to `"auto"` in both reset paths.

### iOS safe area — 20 px floor
All `env(safe-area-inset-top, 0px)` references in Shell (App.jsx and theme.jsx) replaced with `max(20px, env(safe-area-inset-top, 0px))`. Prevents chrome buttons and the progress bar from touching the top edge on devices that report a zero safe-area inset. Bottom padding in `theme.jsx` Shell now uses `calc(40px + env(safe-area-inset-bottom, 0px))`.

### Copy polish
Quick Read description: "A quick onboarding gift — vibe, communication pattern, and one key insight." (removed "Uses 1 credit."). Growth Report description: "Standalone temporal analysis — how this chat has changed from early days to now." Analysis dots + button aria-label: "Unlock more reads". Out-of-credits error messages across `accessMode.js`, `reportCredits.js`, and `runAnalysis`: "You need more credits to unlock this read."

---

## v2.8 — Pack explainer screen + pack selection UX polish
**Files:** `src/App.jsx`, `docs/update-notes.md`

### Pack explainer screen between Quick Read and pricing
A new screen inserted at step 8 of the Quick Read flow (before TrialFinale / PaymentScreen). It lives inside `TrialReportScreen`'s screens array so the Shell DOM node is reused across the transition — identical mechanism to General Wrapped's background color transitions. When the user taps "See packs" on the last trial card, the Shell background smoothly animates from the trial deep-purple (`#0C0D30`) to the app default purple (`#2A1969`) via the existing `transition: background 480ms` on the `.wc-root` div. `document.body` and `documentElement` now also carry the same transition so the background visible outside the card animates in sync. Share and Close chrome buttons are hidden on this screen via a new `hideChromeButtons` prop on Shell rather than context provider overrides, which would have broken the DOM-reuse transition.

### Pack explainer — accordion cards with colored report pills
The explainer shows all four packs (Vibe Pack, Red Flags Pack, Full Read, Growth Report) as expandable accordion tiles. One tile is open at a time; Vibe Pack is open by default. Each tile header shows the pack swatch icon, pack name left-aligned, and a report count ("3 reports", "1 report") instead of raw credits. The expanded body shows a rewritten pack description (more specific than the picker copy) and report pills colored per report type using `REPORT_PILL_STYLE` (purple for General Wrapped, pink for Love Language, orange for Energy, red for Toxicity, blue for Accountability, teal for Growth). Nav row: Back + "See pricing".

### Pack selection page — credit count and button label fixes
The subtitle under each pack name on the PackSelect screen now always shows `{N} left` (including `0 left`) instead of the word "Unlock" when the user has no credits. The action button inside the expanded tile now reads "Add more" when credits are zero and "Run" when the user has credits available. Pack description text was also given `textAlign: "left"` and the `0 left` subtitle received an explicit `textAlign: "left"` to override the `wc-btn` class center-alignment.

---

## v2.7 — Pack selection, payment screen, pack results buffer, and analysis balance dots
**Files:** `src/App.jsx`, `src/reportCredits.js`, `docs/update-notes.md`

### ReportSelect replaced with PackSelect
The old individual-report selection screen has been replaced by a new pack-first selection screen. Users now choose from four expandable tiles: Vibe Pack, Red Flags Pack, Full Read, and Growth Report. Only one tile can be open at a time. Each tile shows a user-facing `{N} left` count calculated from the existing internal credit balance with `Math.floor(credits / packCost)`, without exposing raw credit numbers. Running a pack calls the existing analysis pipeline with that pack's report types, so Claude/API generation and Supabase schema remain unchanged.

### Manual report language selection restored
The new PackSelect screen includes a compact manual "Report language" selector again. It uses the existing `reportLang` and `detectedLang` state, shows `auto` when matching the detected language and `changed` when manually overridden, and clears cached core analysis state on change so the next run regenerates in the selected language.

### Shared swatch icon system
Added a shared `SwatchIcon` component for the new pack/payment/results surfaces. It renders the finalized two-layer icon system: outer rounded square/ring plus an inset rotated inner square. `PackSwatch`, PackSelect tiles, PaymentScreen rows, PackResultsBuffer pills/cards, and Growth pack cards reuse the same visual system.

### New PaymentScreen phase
Added `phase === "payment"` with a new PaymentScreen. Entry points now include PackSelect "Unlock", PackSelect "Get more analyses", upgrade screen pack CTAs, upgrade screen "Get more analyses", and the home balance dots plus button. `paymentPreselect` controls which pack is initially selected. The screen supports multi-select, live Euro total, overlap nudges for redundant pack combinations, dominant-accent pay button coloring, and a fallback console log + "Payment coming soon" toast when no real payment provider is wired.

### Upgrade flow routes into payment
The payments-mode upgrade screen now shows pack purchase rows instead of raw credit pack counters. Pack CTAs route to PaymentScreen with the relevant pack preselected; "Get more analyses" routes with no preselection. Back navigation from payment returns to the phase that opened it via `paymentBackPhase` / `upgradeInfo.backPhase`.

### Homepage analysis balance dots
The old numeric credit pill on the Upload screen has been replaced by a compact four-dot analysis balance indicator. Dots appear in fixed order: Vibe, Red Flags, Full Read, Growth. Each dot is colored only when the user has at least one corresponding pack available (`Math.floor(credits / packCost) >= 1`), otherwise muted. The plus button opens PaymentScreen with no preselected pack. The raw credit balance is no longer shown to users.

### PackResultsBuffer for multi-report packs
Opening a completed multi-report pack from My Results now shows a buffer page with the individual reports inside that pack. Each report card uses its report-type palette, shows a swatch, report pill, title, divider, key stat, insight quote, and tappable arrow. Tapping a card restores the existing single-report result screen using the saved row. Growth is a single-report pack and opens directly without the buffer.

### My Results listing redesigned around packs
The My Results "Results" tab now renders pack-level cards chronologically instead of individual report cards for completed pack runs. Multi-report packs show a 2×2 bundle swatch grid; Growth uses the shared single swatch. Pack cards preserve the existing edit FAB and delete confirmation flow. Tapping Vibe, Red Flags, or Full Read opens PackResultsBuffer; tapping Growth opens the Growth report directly.

### Session-completed pack tracking
Added `sessionCompletedBundles` state with the requested shape (`vibe`, `rf`, `full`, `growth`). It is cleared on new parsed uploads and populated after successful pack runs with saved result ids. This gives the session a pack-level record without changing persisted database schema.

### Settings return from drawer fixed
Back navigation from Settings now correctly restores the My Results drawer when Settings was opened from the drawer, instead of returning to Upload with the drawer closed. The `historyDrawer` return target is handled explicitly in `navigateBack()`.

### Pack label updates
Updated bundle labels in `src/reportCredits.js`: "Vibe Bundle" → "Vibe Pack", "Red Flags Bundle" → "Red Flags Pack", and "Full Suite" → "Full Read". Costs and report memberships remain unchanged.

### Verification
`npm test` passes all 12 tests. `npm run build` completes successfully. The existing Vite large chunk warning remains unchanged.

---

## v2.6 — My Results UI polish + edit mode animations + animated wave backgrounds
**Files:** `src/App.jsx`, `src/theme.jsx`

### Back button — bare icon, no circular background
`ScreenHeader` back button style simplified: removed `width:34`, `height:34`, `borderRadius:999`, and `background:"rgba(255,255,255,0.08)"`. The triangular `BackIcon` now renders as a standalone icon with `background:"none"` and minimal padding — no surrounding circle.

### Edit mode text alignment
All edit-state card containers (single reports, bundles, and name groups — across the main list, bundle detail, and name detail views) now include `textAlign:"left"` so text doesn't centre when the card switches to non-interactive mode.

### Names tab swatch — uniform purple squares
The 4-square grid icon on name-group cards in the Names view now renders 4 identical purple squares (`background:"#2E1A70"`, `border:"1px solid rgba(160,138,240,0.6)"`) instead of varying colors sampled from each report type's palette.

### Sort control — inline "Sort as" label + "Results" rename
The Results / Names segmented control is now a single flex row: a compact "SORT AS" uppercase label sits inline to the left, followed by the pill tabs. The "Reports" tab label renamed to "Results". Layout uses `gap:10` and `alignItems:"center"` — no extra vertical space consumed.

### Edit mode animations — content slide + × fade
All 6 card types (main view: single, bundle; names view: name group; bundle detail: single; name detail: single, bundle) are rewritten as a single unified `<div>` element for both edit and non-edit states. Because the element type and React key stay constant, CSS transitions fire across state changes:
- **Content wrapper** slides 6 px left (`translateX(-6px)`) and dims to 70 % opacity when editing, reverses on exit. Easing: `cubic-bezier(.2,0,.1,1)` over 240 ms.
- **`›` chevron** fades out and its `max-width` collapses from 24 px → 0 with `overflow:hidden`, freeing space on the right. Reverse on exit.
- **`×` delete button** is always in the DOM at `opacity:0, pointerEvents:none`; fades to `opacity:1` when editing. All three transitions start simultaneously.
- Card `onClick` handler conditionally fires the navigate/open action only when `!editing && !isDeleting && !isConfirming`, and confirm-overlay buttons use `e.stopPropagation()` to prevent bubbling to the card.

### My Results drawer — full-width panel
Drawer panel width changed from `min(390px, 96vw)` to `100%`. The fixed-position container already uses `inset:0`, so `100%` fills the viewport edge-to-edge with no gap on the right side.

### Animated wave-line backgrounds
Generic `Geo` polygon shapes replaced with a new `WaveLines` component in `src/theme.jsx`. Five sine-wave SVG paths are layered at different vertical positions (`17%`, `34%`, `52%`, `69%`, `85%`), each with independent amplitude (11–29 px), period (185–370 px), opacity (0.05–0.13), stroke width (0.8–1.6 px), and drift duration (22 s–41 s). Negative `animationDelay` values phase-offset the waves so they don't move in sync. Each SVG is rendered at 3× viewport width; the `@keyframes waveDrift` animation shifts by `−33.333%` (one viewport width), creating a seamless periodic loop. Cubic-bezier control points at `±period/2 × 0.36` horizontally and `±amp × 4/3` vertically ensure wave peaks land at exactly `±amp`. `RShell` now passes `<WaveLines accent={p.accent} />` as its background instead of three `<Geo>` elements; the four `<Geo>` elements in the main results shell in `App.jsx` are also replaced.

---

## v2.5 — My Results drawer + Names grouping + Upload page cleanup
**Files:** `src/App.jsx`

### My Results replaced with a slide-in drawer
The "My Results" text pill on the Upload screen is replaced with a minimalist 36 × 36 circular icon button (three-line list SVG, `aria-label="My Results"`) positioned at `top:14, left:16`. Clicking it opens My Results as a left-side sliding panel that overlays the Upload screen rather than replacing it. The panel is `min(390px, 96vw)` wide, animated with `transform: translateX(-100%) → 0` at `0.32s cubic-bezier(0.4, 0, 0.2, 1)`. A blurred backdrop (`backdrop-filter: blur(3px)`, `rgba(0,0,0,0.52)`) covers the rest of the screen and dismisses the drawer on tap. When a result is opened from the drawer the drawer closes first, then the results phase starts. When results are closed and they were opened from history, the Upload screen reappears with the drawer already open (restoring context). The existing `phase === "history"` path is kept as a fallback for direct navigation.

### MyResults drawerMode prop
`MyResults` accepts a new `drawerMode` boolean. When true: the `Shell` wrapper is replaced with a bare flex container that fills the panel height, and the negative margins that existed to cancel Shell's padding are suppressed. The bundle detail view and loading state also respect `drawerMode`.

### Reports / Names sorting modes
A segmented control (two pills: "Reports" / "Names") is rendered in the My Results header whenever there are saved results. Selection is persisted via `localStorage` key `"wrapchat_results_view"` and restored on open. **Reports mode** is the existing view — items sorted by date, bundled reports grouped under a bundle card. **Names mode** groups all analyses by participant name; each name becomes a section header (uppercase, muted) with its associated single-report and bundle cards nested underneath. Names are ordered by most-recent analysis date. Bundle cards in Names mode are read-only (no edit/delete); use Reports mode to manage results. Switching mode exits edit state.

### Settings and Log out removed from Upload page
The gear icon (Settings) and Log out button removed from the bottom button row of the Upload screen. The row now only shows the Admin button for admin accounts. Settings remains accessible from the My Results drawer header (existing `onSettings` prop). Log out moved to the Settings page — a new full-width row button ("Log out ›") appears above "Delete my account", rendered only when `onLogout` is provided. `SettingsScreen` signature extended with `onLogout` prop; the phase-level render passes `logout`.

---

## v2.4 — Homepage UX polish + platform-agnostic copy + language & navigation fixes
**Files:** `src/App.jsx`, `src/import/fileProcessing.js`, `src/ImportRoute.jsx`

### Report output language independent from UI language
`chatLang` state renamed to `reportLang` — an explicit, independently controlled state for the AI output language. `resolveReportContentLanguage` removed; its third fallback (`return normalizeUiLangCode(uiLang)`) was the root cause: when chat language detection confidence was below threshold, reports were generated in the user's UI language instead of English. `reportContentLang` is now simply `reportLang` — no derivation from `resolvedUiLang`. Initial default after upload: `isReliableDetectedLanguage(detected) ? detected.code : "en"` — always falls back to English when detection is uncertain, never to UI language. `ReportSelect` prop renamed from `chatLang` to `reportLang`; `onLangChange` writes `setReportLang`. Restore and reset flows updated. Cache keys, stored `displayLanguage`/`sourceLanguage`, and AI prompt language instruction are all unchanged.

### Back navigation simplified — single `navigateBack()` helper
`goBackFromCurrent()` and `backFromReport()` replaced by a single `navigateBack()` covering all phases. Two bugs fixed in the consolidation: (1) `goBackFromCurrent` hardcoded upgrade→"select" ignoring `upgradeInfo.backPhase`; `navigateBack` respects it. (2) `goBackFromCurrent` did not reset `historyBundleView` on history→upload; `navigateBack` does. Swipe-back gesture, browser popstate, all `onBack=` inline arrows, and all report-screen `back=` props now point to the same function. Swipe dep array updated to include `upgradeInfo`.

### Platform-agnostic UI copy — WhatsApp references removed
All user-facing mentions of "WhatsApp" replaced across `src/App.jsx`, `src/import/fileProcessing.js`, and `src/ImportRoute.jsx`. Changes: onboarding step "Open WhatsApp" → "Open your messaging app"; onboarding hook copy "Reads your WhatsApp chat…" → "Reads your chat export…" (English source key + all 7 language translation values updated); error messages "Please share a WhatsApp export…" / "Choose a WhatsApp export…" → "chat export"; drop-zone copy in ImportRoute updated; Terms of Service and Privacy Policy in-app text updated. Internal parser module names, filename-detection heuristics, and AI system prompts left unchanged.

### My Results top-left shortcut + Settings gear in My Results
`My Results` button removed from the lower nav row of the Upload screen and repositioned as an absolutely placed pill at `top:16, left:20` — symmetric with the credit counter on the right. `MyResults` now accepts `onSettings` prop; when provided, a `GearIcon` button is rendered in the `ScreenHeader` action slot. App wires `onSettings` to navigate to the settings phase.

### Credit counter moved to top-right of homepage + upgrade shortcut
Below-logo credit pill replaced with an absolutely positioned pill at `top:16, right:20`. Shows credit count even at zero; includes a "+" button (separated by a subtle divider) that triggers the upgrade flow via a new `onUpgrade` prop. `showCreditPill` condition: `!hideCredits && !isOpenMode(accessMode) && !isTrialPending && Number.isInteger(credits)` — hidden in open/test mode and for admins. `upgradeInfo` now carries `backPhase` so pressing Back from the upgrade screen returns to the correct phase (upload or select).

### Open/test mode indicator on homepage
When `isOpenMode(accessMode) && !hideCredits`, a green pill "Open testing · free reports" appears below the logo on the Upload screen, using the same palette as the ReportSelect open-mode banner (`rgba(176,244,200,0.9)` / `rgba(20,160,80,0.12)`). Hidden for admins. Mutually exclusive with the credit counter pill.

### My Results bundle detail loading flash fixed
When `bundleView` is set but `rows === null` (Supabase still loading), the bundle detail view previously showed fallback values "—" and "0 reports". Now returns a `<Shell>` with a centered `<Dots />` spinner — identical to the main list loading treatment — until rows arrive. Empty-state fallbacks remain intact for bundles that genuinely have no rows after load.

### Premium report summary sharing shows correct content
`getSummaryShareScreen` was passing `PremiumFinale` for all premium report types. `PremiumFinale` accepts no `ai` prop and rendered only the report label and names/message count — producing a nearly-blank share image. Replaced with the last step of each report type's existing `*ReportScreen` component, which is already designed as the natural "Done" summary card. Each report now shares its richest screen: toxicity → "The verdict" (health score ring + final read), lovelang → "Love language compatibility" (score ring + compatibility read), growth → "The arc" (arc summary), accounta → "Most notable kept promise", energy → "Energy compatibility" (score rings + overall read). Buttons are hidden at capture time via existing `data-share-hide`. `resultId={null}` prevents feedback icons rendering in the hidden capture node. General Finale path unchanged.

### Auth error handling — registered email and duplicate account
Raw Supabase error messages were being shown directly in the UI. New `normalizeAuthError(error, mode)` helper maps known error strings to user-friendly copy: wrong login credentials → "Email or password is incorrect."; email not yet confirmed → "Please confirm your email before logging in. Check your inbox."; signup with existing email (error path) → "This email is already registered. Log in instead.". Duplicate signup detection for the error-free path: when Supabase has email confirmation enabled it returns no error on duplicate signup (to prevent server-side enumeration), but does return `user.identities = []`. `signUp` now destructures `data` and checks `data?.user?.identities?.length === 0` to catch this case and show the registered-email error instead of a false "check your email" confirmation. A code comment documents the Supabase limitation. Genuine new account signup still shows "Check your email to confirm your account, then log in."

## v2.3 — AI prompt quality pass + memorable moments
**Files:** `src/App.jsx`, `src/BrandLockup.jsx`, `analysis-test/aiDebugHelpers.js`

### Logo accent color follows report type on loading screen
`BrandLockup` now renders the logo as inline SVG when an `accentColor` is passed. The three accent-colored paths in the logo (previously hard-coded to `#6cb9e0`) swap to the active report's palette accent color. The `<img>` fallback is kept for all screens where no accent color is provided. The "WrapChat" title text already used `accentColor`; now the logo icon matches it too.

### Memorable moments layer added to Core A
`prepareCoreAnalysisARequest` schema extended with `memorableMoments` — an array of 3–6 structured moment objects, each with: `type` (funny / sweet / awkward / chaotic / signature / tension / care / conflict), `date` (approximate period only), `people`, `title` (2–5 word card title), `quote` (exact from windows or empty string), `setup`, and `read`. Rules embedded in the Core A system prompt: each entry must come from a different window, quotes are never invented, no calendar dates.

### No exact dates in any AI date field
All date-bearing schema fields across Core A (`evidenceTimeline`), Core B (`redFlagMoments`, `notableBroken`, `notableKept`), and Risk digest (same) now instruct the AI to use approximate period descriptions only — "early on", "mid-chat", "recently" — never specific calendar dates, month names, or day numbers. Same rule added to `CORE_A_WRITING_STYLE` as a `DATE RULE` block.

### Anti-repetition rules extended and made field-specific
Old single-line anti-repetition rule replaced with explicit per-pair rules: `sweetMoment ≠ mostLovingMoment` (act of care vs affectionate exchange), `tensionMoment ≠ dramaContext` (single spike vs recurring pattern), `vibeOneLiner ≠ relationshipSummary` (one-line feel vs ongoing dynamic), `toxicityReport ≠ groupDynamic` (health verdict vs energy read), `relationshipSummary ≠ relationshipStatusWhy` (dynamic description vs label justification). Each `evidenceTimeline` and `memorableMoments` entry must reference a distinct event.

### Moment extraction and quote use instructions added
`CORE_A_WRITING_STYLE` now includes a `MOMENT EXTRACTION` block (prefer concrete scene over broad summary; output shape: what happened + phrase + short interpretation — screenshot-worthy, not report-note) and a `QUOTE USE` block (exact quotes only when they add recognisability; never invent; one per field max). Both blocks also appear in the Core A system prompt's scope rules.

### normalizeMemorableMoments validator
New `normalizeMemorableMoments()` in App.jsx normalizes the AI response: validates `type` against the eight allowed values (maps unknown types to `"signature"`), filters entries missing both `title` and `read`, trims all string fields, clamps array to 6. Called from `normalizeCoreAnalysisA` and the result passed through `deriveGeneralReportFromCore`.

### MomentsRow component + rendering in general report
New `MomentsRow` component renders the `memorableMoments` array at the end of the "Chat vibe" screen (prog=17) for both DUO and GROUP casual reports. Shows only when moments exist and AI is not loading. Each card: emoji + bold title, optional italic quote, and the read line. Invisible when the field is empty — no layout shift.

### CORE_A_MAX_TOKENS increased
Raised from 2600 → 3200 to give the expanded schema (growth + memorableMoments + all shared fields) enough output headroom without truncation.

---

## v2.2 — Post-trial pricing flow
**Files:** `src/App.jsx`, `docs/update-notes.md`

### Credit pack pricing updated
The paid credit packs now show the intended Euro pricing: Starter (10 credits / €2.99), Standard (25 credits / €5.99), and Deep Dive (60 credits / €11.99). The same pack definitions are reused by the post-trial screen and the out-of-credits upgrade screen so pricing stays consistent.

### Trial now leads into a fuller pricing page
After the free preview, `TrialFinale` now becomes a compact pricing page headed "Go deeper with this chat". It shows bundle costs, individual report costs, the three credit pack options, and the payments-coming-soon note in one place instead of only showing placeholder packs.

### Upgrade screen matches post-trial pricing
Payments-mode upgrade now reuses the same bundle/report cost overview and credit pack grid, with copy focused on going deeper with the chat. Tester and manual-credit modes keep their existing messaging.

---

## v2.1 — Admin feedback panel fix
**Files:** `src/App.jsx`

### Admin feedback panel now shows all users' feedback
The admin feedback tab was querying the `feedback` table directly via the anon key, which is subject to Supabase RLS. Since the RLS SELECT policy restricts rows to `user_id = auth.uid()`, the admin could only see their own feedback rows. Replaced the direct table query with a call to a new `admin_list_feedback(p_limit)` RPC (which runs with `SECURITY DEFINER` to bypass RLS), matching the pattern already used by `admin_delete_feedback` and `admin_list_user_credits`. The corresponding SQL function must be created in Supabase — see the fix notes for the `CREATE OR REPLACE FUNCTION` statement.

---

## v2.0 — UI consistency pass + iOS polish + translation fixes
**Files:** `src/App.jsx`, `index.html`, `docs/update-notes.md`

### Delete confirm overlay blur
When the user taps × in edit mode on a result, feedback, or bundle card, the "Are you sure?" overlay now blurs the card content behind it (`backdropFilter: blur(8px)`) and adds a dark semi-transparent background. Previously the confirm buttons appeared over the unblurred card content with no visual separation.

### iPhone status bar color
Added `viewport-fit=cover`, `apple-mobile-web-app-capable`, and `apple-mobile-web-app-status-bar-style: black-translucent` to `index.html`. The status bar is now transparent so the app background color shows through it on iOS. Added `paddingTop: env(safe-area-inset-top)` to the Shell root to push content below the status bar. All absolute-positioned chrome elements (progress bar, share, feedback, close buttons) updated to `calc(Xpx + env(safe-area-inset-top, 0px))`. Added a `useEffect` in Shell to dynamically sync `theme-color` meta tag with each section's palette background — so the Safari browser chrome tints to match on iOS 15+.

### Translation fixes — missing keys
`Settings` and `Delete my account` had no entries in any translation table despite being called with `t()`. Added both to all 7 language tables (tr, es, pt, ar, fr, de, it). The delete confirmation modal strings (`Are you sure you want to delete your account?`, `All your saved results will be gone…`, `Delete account`, `Deleting...`) were hardcoded English — wrapped in `t()` and added to all 7 language tables.

### Translation fixes — new titles
`Relationship` and `Report Type` added as translation keys to all 7 language tables. These replace the old long titles ("Who is this chat with?" and "Choose your report") used in `RelationshipSelect` and `ReportSelect`.

### ScreenHeader layout redesign
`ScreenHeader` changed from a single flex row (back button + title + action competing for horizontal space) to a two-row column layout: back button and action sit on the first row (`justifyContent: space-between`), title gets its own full-width row below. Added `paddingTop: 8` so all headers breathe from the top of the content area. Affects My Results, Settings, Relationship, Report Type, Admin, and all other back-button screens.

### Title renames
`RelationshipSelect` title changed from `"Who is this chat with?"` to `"Relationship"`. `ReportSelect` title changed from `"Choose your report"` to `"Report Type"`. Both are now short enough to never crowd the header row and both have translations in all 7 languages.

### Version label auto-wired
`HOMEPAGE_VERSION_LABEL` constant replaced with a build-time parse of the first `## vX.Y` heading in `docs/update-notes.md`. Updating the version in this file is now the single source of truth.

---

## v1.9 — Trial flow & payment gating
**Files:** `src/App.jsx`, `src/trialReport.js`, `src/reportCredits.js`, `supabase/migrations/20260424160000_trial_and_roles.sql`

### DB migration: roles + trial credit on signup
`role TEXT DEFAULT 'user' CHECK (role IN ('user','tester'))` and `trial_granted_at TIMESTAMPTZ` columns added to `public.credits` (idempotent `DO $$ BEGIN ... END $$` blocks). New RPCs: `initialise_credits(p_user_id, p_email)` — grants 1 credit on first signup in payments mode, no-op if row exists; `get_user_role(p_user_id)` — returns role from credits row or 'user'; `admin_set_user_role(p_user_id, p_role)` — admin-only toggle between 'user' and 'tester'.

### Trial report type (internal only, hidden from selector)
New `src/trialReport.js` exports `buildTrialPrompt` (vibe / pattern / takeaway JSON, 360 max tokens, input capped to 80 evenly-spread messages to keep API cost minimal) and `deriveTrialReport` (pure mapping to report shape). `trial_report` registered in `REPORT_PIPELINES` (strategy: "trial"), `reportCredits` (1 cr), `REPORT_FAMILY` ("trial"), and `REPORT_TYPES` (routing only) — filtered out of the visible list in `ReportSelect` so users never see it as a selectable option.

### Auto-trigger trial flow
After upload, payments-mode users with exactly 1 credit skip the report selector entirely. A `useEffect` watches `phase === "select"` and calls `runAnalysis(["trial_report"], relType)` automatically. `trialAutoRunDoneRef` prevents double-firing; reset in `onParsed` so each new upload gets a fresh trigger.

### Upload screen trial messaging
`Upload` now accepts `accessMode` prop. In payments mode + 1 credit: purple banner "You have 1 free trial analysis included" replaces the generic credit pill. In payments mode + 0 credits: "Your free trial is used up. Upgrade to unlock full reports."

### TrialReportScreen & TrialFinale
`TrialReportScreen` (1 screen, `PAL.trial` deep-purple palette): three AICards (vibe, how you communicate, most interesting thing) + teaser block opening with "That was your free preview. Here's what the full reports include:" followed by a locked list of all report types. `TrialFinale` (step 2): three credit pack cards (Starter 3 cr / $4, Standard 7 cr / $8, Deep Dive 12 cr / $12) as Stripe-ready placeholders + CTA navigates to upgrade screen.

### UpgradePlaceholder redesign
Accepts new `userRole` and `accessMode` props. In payments mode: shows credit pack grid (same three packs, disabled with "coming soon" note). Tester role: "You're in beta testing mode — credits are managed by the admin." Credits mode: existing "ask an admin" message.

### userRole state + getUserProfile
`userRole` state (default `"user"`) added to App. New `getUserProfile()` function fetches both `balance` and `role` from the credits row in a single query, replacing `getUserCredits()` in the auth effect.

---

## v1.8 — Bundle UI & credit visibility fix
**Commit:** `80f334f` | **Files:** `src/App.jsx`

### Bundle quick-select pills
"BUNDLES" section added above the individual report list in ReportSelect. Three pills (Vibe Bundle, Red Flags Bundle, Full Suite) with cost shown. Clicking a pill sets the full selection to that bundle; clicking an already-active pill clears the selection. Pill goes active (brighter border + white text) when the current selection exactly matches that bundle.

### Credit costs now visible for admins
Removed `hideCredits={authedIsAdmin}` from the select screen (kept only on the upload/balance screen). Admin accounts now see per-report costs and bundle prices. The access mode check still skips actual deduction for admins.

### onBundle handler
New `onSelectBundle` handler in App sets the full selection atomically (no toggle flicker). Passed as `onBundle` prop to ReportSelect.

---

## v1.7 — Bundle & family-aware credit pricing
**Commit:** `8ab2cd0` | **Files:** `src/reportCredits.js`, `src/App.jsx`

### Bundle definitions
Three named bundles added to `reportCredits.js`: Vibe Bundle (general + lovelang + energy = 4 cr, saves 1), Red Flags Bundle (toxicity + accounta = 3 cr, saves 1), Full Suite (all 6 = 8 cr, saves 3).

### Family-aware pricing engine
`getTotalCreditCostBundled()` replaces `getTotalCreditCost()` in all pricing paths. For selections that don't match a named bundle, the first report in each AI family pays full price; each additional same-family report costs 1 cr (the `FAMILY_ADDON_COST` constant). Growth is always standalone.

### deductCreditsAmount helper
New `deductCreditsAmount(userId, amount)` export in reportCredits — takes a pre-computed amount instead of recomputing from report types. `deductCreditsBatch` now uses this with the bundled cost.

### canUserRunReports updated
Access check now uses bundled cost so users with just enough credits for a bundle aren't incorrectly blocked.

### Bundle discount in report selector UI
Summary line shows bundle name (slightly brighter white) + strikethrough original cost when a saving applies. Family-aware partial discounts also show the strikethrough. No new components — same 12 px gray text row as before.

---

## v1.6 — Access Mode System & Share Improvements
**Commit:** `123d4c7` | **Files:** `src/App.jsx`, `src/accessMode.js`, `assets/`, `public/`, `index.html`, `supabase/migrations/`

### Access mode system
New `src/accessMode.js` module introducing three modes: `open` (free access), `credits` (default), `payments`. Mode is fetched from Supabase on login and kept in app state. Credit deduction and upload access checks now respect the active mode — `open` mode bypasses credit requirements entirely.

### Admin access mode controls
`AdminPanel` gets a new Settings tab (`AdminAccessModeTab`) where admins can switch the global access mode live. Mode change is persisted via `admin_set_access_mode` RPC.

### DB migration for access mode
New migration `20260424143000_app_access_mode.sql` adds the Supabase-side `get_access_mode` / `admin_set_access_mode` RPCs.

### Share icons wired up
`card-share.svg` and `sum-share.svg` added to assets and imported. SharePicker emoji replaced with `<img>` tags using `filter: brightness(0) invert(1)` — same colour treatment as relationship type icons.

### Share capture improvements
`buildShareCanvas` refactored with three new helpers: `waitForShareAssets` (waits for fonts + images before capture), `getShareCaptureHeight` (measures pane scroll height to avoid clipping), `buildTintedShareLogoMarkup` (fetches SVG logo and tints it to the card's accent colour). Off-screen `getSummaryShareScreen` renders the Finale/PremiumFinale into a hidden fixed node so "Share Summary" captures the actual summary even when the user is on a different card.

### Favicon consolidated
All favicon sizes and apple-touch-icon replaced with a single `public/applogo.png` reference in `index.html` and `manifest.json`.

---

## v1.5 — Screenshot-based sharing
**Commit:** `f9efe43` | **Files:** `src/App.jsx`

### buildShareCanvas helper
New module-level `buildShareCanvas(type, logoSrc)` replaces the raw `html2canvas` call in `captureScreen`. Uses `onclone` to modify the capture without touching the live UI.

### Chrome stripped from screenshots
Progress bar, Share button, Close button, and Feedback button each get `data-share-hide`; `onclone` hides them all before rasterising so they don't appear in exported images.

### Logo watermark injected at capture time
A 24 × 24 px WrapChat logo (`wrapchatLogoTransparent`) is appended to the cloned `.wc-root` at bottom-center, 45 % opacity. Never visible in the running UI.

### Card vs summary target selection
Shell now accepts a `shareType` prop (`"card"` default) stamped as `data-share-type` on `.wc-root`. `Finale` and `PremiumFinale` pass `shareType="summary"`. `buildShareCanvas` queries `[data-share-type="card|summary"]` so each picker option captures the right element.

### captureScreen updated
Signature changed from `(filename)` to `(type, filename)`. Delegates capture to `buildShareCanvas`, keeping all blob/share/download logic unchanged.

---

## v1.4 — Relationship Selector Redesign
**Commit:** `f9efe43` | **Files:** `src/App.jsx`, `assets/WrapchatLogo_main.svg`

### Viewport height fix
Shell container switched from `minHeight: 100svh` to `height: 100svh` (no scroll overflow)

### RelationshipSelect card UI
`RelationshipSelect` redesigned: added local `sel` state, replaced flat list with `RelCard` component using per-option accent colors from `DA` palette
- Romantic options: Partner (purple), Dating (amber), Ex (orange)
- Other options: Related (teal), Friend (blue), Colleague (lime), Other (faint)
- Removed old description text; active card shows accent border + background highlight

### Logo asset removed
`WrapchatLogo_main.svg` removed from repo

---

## v1.3 — Button System & Assets
**Commit:** `779d9d0` | **Files:** `src/App.jsx`, `src/BrandLockup.jsx`, new assets

### Themed button components
Introduced `PrimaryButton` and `GhostButton` from `theme.jsx` — replaced all inline `<Btn>` calls throughout

### Full-width button layout
Nav/back/next buttons changed from centered to full-width flex with `flex:1`; arrow decorations added (`← Back`, `Next →`, `Continue →`)

### Pill border radius
Tab segment control border-radius updated to `999` (pill) from `50`

### New assets
`AppIcon.png`, `WrapchatLogo_main.svg`, `WrapchatLogo_main_2.svg` added

---

## v1.2 — Theme System & Docs
**Commit:** `86253ad` | **Files:** `src/theme.jsx`, `docs/`, `src/App.jsx`, `src/ImportRoute.jsx`, `src/main.jsx`

### Theme file created
`src/theme.jsx` created (456 lines) — centralises design tokens and reusable components; `docs/theme.js` added as reference copy

### Functional spec doc
`docs/app-functional-system.md` created — product logic + UI spec (no visual style)

### AI prompt docs expanded
`docs/ai-prompts-current.md` expanded with provider request envelope docs (`claude-sonnet-4-6`)

### ImportRoute refactor
`src/ImportRoute.jsx` simplified (-49 lines net)

---

## v1.1 — AI Debug Tools & Admin Controls
**Commit:** `e185d35` | **Files:** `src/App.jsx`, `supabase/`, `docs/`, `analysis-test/`

### AI debug panel
`analysis-test/AiDebugPanel.jsx` added (142 lines) — debug overlay for AI responses; `aiDebugHelpers.js` expanded (+319 lines)

### AI prompt documentation
`docs/ai-prompts-current.md` expanded (+262 lines) with full prompt documentation

### Admin credit & feedback controls
New migration `admin_feedback_and_credit_controls.sql` (78 lines) — admin controls for user credits and feedback; `supabase/functions/analyse-chat/index.ts` updated

---

## v1.0 — Layout & Footer
**Commits:** `849dc88`, `f164d27`, `ab36F70` | **Files:** `src/App.jsx`

### Layout centering fix
Minor centering adjustment (2 lines)

### Auth & general footers
Auth footer and general footer added to the shell
