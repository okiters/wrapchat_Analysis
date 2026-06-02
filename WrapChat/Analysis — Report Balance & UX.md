# Report Balance & UX Analysis

*Connects to: [[Analysis — Features & Report Redesign]]*

---

## The Core Problem — Revised

The original framing of this problem was: General Wrapped is 17 cards, everything else is 5–7, that's too imbalanced. The proposed solution was to trim General Wrapped and lightly expand the others.

That was wrong about one thing. The Energy section here previously suggested trimming from 6 to 5 cards. The Accountability section suggested merging down to 6. Both were moving in the wrong direction. The correct principle, once you factor in the interactive features described in [[Analysis — Features & Report Redesign]], is this:

**No paid report should feel like it ends before the user is ready.**

General Wrapped at ~16 cards sets a value expectation. That doesn't mean every report needs to be 16 cards — but no report in a paid pack should deliver fewer than 8. Under 8, a report doesn't feel focused. It feels thin. And "thin" is incompatible with premium.

The revised target: GW around 16, all other paid reports at 8–9. That's a 2:1 ratio at most, not 3.4:1.

---

## Report-by-Report Read — Revised

### Quick Read Trial — current 8, target 8
**Verdict: Right shape once restructured. Two structural fixes.**

The funnel logic is sound. The problem is Card 7 (Your Summary) repeats the vibe from Card 6 (The Vibe) almost verbatim, then adds a 2×2 stats grid users already saw in Card 1. Merge Cards 6 and 7 into one. The freed slot becomes a Teaser card — one AI-generated provocation specific enough to feel personal and unresolved enough to demand the full report. Generic upsell copy ("there's a lot more to read") doesn't convert. Specific unanswered questions do.

The stats currently land as a single dense card. Split them across 2 cards — one for message volume and activity data, one for behavioral patterns — so the data has room to breathe rather than feeling like a dump. Merging cards 6+7 frees one slot; splitting the stats card uses it. Net: stays at 8 cards.

---

### General Wrapped Duo — current 17, target 16
**Verdict: Right range, wrong shape, wrong ending order.**

The pacing problem isn't the count — it's that 13 of the first 17 cards are flat stats. The AI payoff comes in a block at the end instead of being distributed. By card 8 the user is on autopilot. Spotify Wrapped works because the emotional reveals are spread throughout, not saved for the finale.

**What to cut:**
- Card 1 (Who's More Obsessed) is absorbed by Card 7 (Who Always Reaches Out First). Same insight, different metric. Cut it.
- Cards 10 and 11 (Top 10 Words + Signature Phrases) are back-to-back with identical register. Merge into one "Your Language" card — top 5 words on one side (reduced from 10; a tighter list reads as curated rather than exhaustive), signature phrase on the other as an interactive element: multiple options shown, tap to reveal which phrase belongs to which person.
- Card 13 (Media and Links) is the lowest-emotion stat card in the report. Nobody has feelings about who sent more links. Cut it.
- Card 3 (The Last Word) — its behavioral insight overlaps with the Ghost Award. Cut it.

Net cut: −4 cards. Then add back with [[Analysis — Features & Report Redesign]]'s interactive mechanics: Ghost Award becomes Guess+Reveal (+1), a Time of Day card slots in between the stats and AI sections (+1), and an Attribution card appears in the AI section (+1). Novelist vs Texter is cut entirely — it's the least emotionally loaded of the potential guess pairs, and its removal simplifies the report without loss of insight. Net: 17 − 4 + 3 = 16. Sixteen cards, all earning their slot.

**The ending must change.** Current order: Drama Report → What's Really Going On → Chat Vibe. What's Really Going On is the most emotionally resonant card in the app — the relationship truth, delivered by AI. It should be last. Chat Vibe is a beautiful aesthetic closer but it's a *feeling*, not a *truth*. End on truth. Move Chat Vibe to second-to-last, What's Really Going On to last. This also matters for the quiz mechanic: the quiz invitation at the Finale lands harder after "What's Really Going On" than after a quote box. The user just received the truth about their relationship — now they want to know if the other person sees it the same way.

**What's still missing:** Time-of-day data. WhatsApp exports have full timestamps. "You're a 2am person, they're a 9am person" is the kind of specific, intimate detail that makes users feel seen. This is what Wrapped-style experiences are actually built on — not what you did, but when, because when implies how you live. The Time of Day card covers this and bridges the stats-to-AI transition in the second half of the report.

---

### General Wrapped Group — current 17, target 16
**Verdict: Length more justified. Same ending fix.**

Groups naturally have more variation — more people, more roles, more dynamics. The Group Roles card is the single highest-value card in the entire app: 5 named insights in one visual. Most Missed Member is quietly devastating. The group format earns its card count better than duo does.

Same cuts apply: The Last Word, Media and Links equivalent. Same addition: Time of Day card, The Ghost becomes Guess+Reveal. Same ending fix: Group Read last, Group Vibe second-to-last.

---

### Love Language Report — current 5, target 10
**Verdict: Was too thin. 10 is the right depth.**

The original 5-card structure: identify A, identify B, analyze gap, find one moment, score. This covers the material without exploring it. The score ring as a closer is the wrong register entirely — love languages are about translation, not measurement. A number out of 10 is the wrong payoff for an emotionally intimate report.

The deeper problem: love language theory exists in service of behavior change. Every person who's taken a love language quiz wants to know what it means practically. But this report doesn't do suggestions — it states facts with examples. That constraint produces a better card: not "here's what would help" but "here's what it actually looks like in your chat." The report also shouldn't open on an individual — a common intro card frames the lens before the personal reads begin.

**The 10-card structure:**
1. Love Languages in This Chat (common intro card — an overview of how love languages show up in this specific chat overall, before naming anyone; frames the lens before the individual reads)
2. Guess A's love language (Guess card — emotionally loaded; people are frequently wrong about the category, confusing the expression of love for the language)
3. Reveal A's love language (enriched with "How they show it" — specific examples from the actual chat)
4. Person B's love language (no second guess — mechanic repetition kills momentum; reveal directly with examples)
5. The Language Gap (do they speak the same language? If different: what the gap looks like in practice)
6. The Miss — a moment where love was expressed in one language but received in another (new; the most psychologically precise card in the report)
7. Most Loving Moment (Attribution card — real message, sender hidden; framed as the mutual peak of the relationship, the moment of highest connection between both people, not simply identifying who was kindest; reveal with context)
8. How It Shows (replaces "What Would Help" — instead of suggestions, surfaces real examples of each love language in action from the actual chat; facts with evidence, not prescriptions)
9. The Unspoken Moment (new — AI identifies a moment of love expressed without words: a fast reply streak during a hard week, an emoji burst, a voice note at an odd hour; makes the theory feel alive in the specific)
10. Compatibility (score ring + closing read — now the score lands in context, not as a cold verdict)

The Miss card is new and worth explaining: it's the card that makes the Love Language Report feel like it actually understands the theory rather than just naming it. Identifying the gap is one thing. Showing a moment where someone tried and it didn't land — because they were speaking different languages — is what makes it personal. This is also the card most likely to generate a real conversation between the two people.

Note on scope: this report is in the same pack as General Wrapped, so users should be able to run it on group chats as well as duo conversations. Card structures should accommodate multi-person readings where applicable.

---

### Energy Report — current 6, target 10
**Verdict: Previous suggestion to trim to 5 was wrong. Expand to 10.**

The earlier version of this document suggested restructuring Energy to 5 cards. That was the wrong direction. 6 was already thin for a paid report. 5 would have been a collapse. The correct target is 10.

Why 10: the Energy Report has a concept — two distinct energies, how they interact together, and the moments that define them — that genuinely needs more space. The individual energy cards (A and B) currently contain two AI fields each plus a hype quote. That's substantial content for one card. But what's entirely missing is a card about the *interaction itself* — not who A is, not who B is, but what happens when these two specific energies meet. That's the most interesting question and it has no card. Two additional cards cover the temporal and evidential gaps.

**The 10-card structure:**
1. Guess who's the more positive presence (Guess card — self-perception is systematically biased here; people often think they're the more energizing one)
2. Net Energy Scores (Reveal — energy type labels + score rings for both + compatibility opening)
3. Person A's Energy (positive energy + draining patterns + hype quote if available)
4. Person B's Energy (positive energy + draining patterns + hype quote if available)
5. Energy by Time (new — when is each person at their peak? "She's a 10pm person. They're a 9am person." Uses timestamp data, same tech as the GW Time of Day card, filtered through an energy lens)
6. The Dynamic (new card — "What happens when you're together" — AI's read of how their specific energies interact as a pair, not as individuals)
7. Most Energising Moment (moved before draining — end the middle section on a high)
8. The Charge (new Attribution card — "Who sent this when the energy was at its highest?" A message from the conversation's most electrically alive moment, sender hidden; reveal with context about what was happening)
9. Most Draining Moment (honest; comes after the high so the contrast is felt)
10. Overall Compatibility (score rings + "Overall read" AI card — no repeat of Card 2's rings; these are the same values but the framing is now a conclusion, not an introduction)

Cards 1 and 10 are intentional bookends but they're not duplicates — Card 1 opens with a guess and a score. Card 10 closes with the compatibility read after 8 cards of evidence. The score means something different by card 10.

---

### Toxicity Report — current 7, target 10
**Verdict: Strong bones. High interactive potential. Expand to 10 and redesign the center.**

The flow works — macro health → individual scores → behavior → evidence → pattern → power → verdict. But the bookend score ring structure is wrong: the ring at card 1 announces the verdict before the evidence is presented. Remove it. The opening should be the AI's framing — tone and context — not a number. The number lands at card 10, after everything. That's when it means something.

The critical blind spot: this report is entirely negative. Cards of scores, asymmetries, red flags, conflict patterns, and power imbalance with no acknowledgment of what keeps these two people talking. Even genuinely toxic relationships have something real in them, and ignoring that makes the report feel like an indictment rather than an analysis. The difference between a report that helps and one that just hurts is one card.

The opportunity: Toxicity has more interactive potential than any other report in the pack. Power imbalance, apology asymmetry, and conflict authorship are all questions where the user has strong prior beliefs — and where being wrong hits differently. Two guess moments fit naturally here.

**The 10-card structure:**
1. Chat Health Score ("Verdict" AI opening — no score ring; sets tone before evidence)
2. Individual Health Scores (both on one card — stacked rows, A's ring + B's ring)
3. Guess who apologises more (Guess card — charged; people have strong feelings about this)
4. Who Apologises More (Reveal — per-person context AI cards)
5. Attribution Card — heavy message from the conflict cluster (Who Said This mechanic; sender hidden, full context on reveal)
6. Conflict Pattern (how arguments unfold)
7. Guess who holds the power (Guess card — power perception is rarely accurate; the most charged guess in the report)
8. Power Balance (Reveal — power holder + "Power dynamic" AI card)
9. What's Still Here (new — AI card identifying the genuine positive thread that runs through the chat despite its toxicity; placed before the verdict so the final score lands in a more honest context)
10. The Verdict (score ring + "Final read" + disclaimer — ring appears here only)

The Attribution card at position 5 replaces the scrollable Red Flag Moments list. A scrollable list is passive — you skim it. A single message, sender hidden, asking "who sent this?" makes you commit. The reveal with timestamp and context paragraph makes you feel the moment rather than read about it. One experienced deeply beats five skimmed.

---

### Accountability Report — current 7, target 10
**Verdict: Previous suggestion to merge down to 6 was wrong. Expand to 10.**

The earlier version of this document suggested merging Person A and Person B's accountability cards, and merging Fair Comparison with Follow-Through Pattern. Both were wrong. Person A and B need separate cards — sitting with each person's score individually is part of how accountability lands. If you see both scores at once, you immediately compare rather than absorb. And Fair Comparison (about context and circumstances) is genuinely different from Follow-Through Pattern (about behavioral patterns and evidence quality). They shouldn't be merged.

The real problem with Accountability isn't the card count — it's the cold open. The report currently starts with "here are the promise counts." There's no stakes-setting before the data. The guess mechanic fixes this exactly.

**The 10-card structure:**
1. Guess who made more promises (Guess card — medium strength; works best when the numbers are genuinely surprising)
2. Promises Made (Reveal — counts per person + "Overall verdict" AI card)
3. Person A's Accountability (score ring + kept/broken counts + "Pattern" AI card — keep separate)
4. Person B's Accountability (same structure — keep separate)
5. Fair Comparison (both sides — contextualizes the numbers)
6. The Reliability Arc (new — did accountability improve or decline over the chat's lifespan? One AI card using early/late promise data; "In the first three months, 80% of commitments were kept. In the last three months, 45%." A downward arc is the most confrontational read in the report)
7. Follow-Through Pattern (behavioral pattern + evidence strength — keep separate from Fair Comparison)
8. The Promise That Changed Things (new Attribution card — a promise with visible downstream effects, sender hidden; not the most broken or most kept, but the one that mattered most to the arc of the relationship)
9. Most Notable Broken Promise (promise moment card)
10. Most Notable Kept Promise (promise moment card + "Done" nav)

The Reliability Arc card formalizes the temporal read that was previously proposed as a one-sentence addition to Follow-Through Pattern. A full card is warranted — the arc over time is the most consequential finding the Accountability Report can deliver.

---

### Growth Report — current 5, target 10
**Verdict: Most conceptually interesting, most underdeveloped. 10 cards is appropriate.**

Growth is the only report whose core concept is time — how the relationship changed across the full span of the chat. 5 cards for that concept was a genuine underdelivery. The previous version of this document suggested 8, which was better. 10 is the right number.

The biggest structural gap: no individual arc cards. Every report that covers two people gives each person their own card (Love Language, Energy, Accountability all do this). Growth doesn't. Who drove the deepening or the drift? Did one person's communication style shift while the other stayed static? These are the most psychologically interesting questions in the report and they have no cards.

**The 10-card structure:**
1. Then vs Now (early messages vs recent messages + direction subtitle)
2. Person A's Arc (how A changed across the chat's lifespan — topics, tone, engagement)
3. Person B's Arc (how B changed)
4. Guess who changed more (Guess card — works when the answer is counterintuitive, which it often is)
5. Who Changed More (Reveal — name or "Both equally" + "How they changed" AI card)
6. What Changed in the Chat (topics that appeared + topics that faded — kept as a full card; distinct from individual arcs because it covers the *relationship's* themes, not individual people)
7. The Turning Point (new — AI identifies the approximate period when the biggest shift happened; temporal anchor that makes the report feel like it actually read across time)
8. The Message That Shifted Everything (new Attribution card — the actual message or exchange at or near the Turning Point, sender hidden; The Turning Point tells you when, this card shows you what; reveal with context about what changed in the weeks after)
9. Relationship Trajectory (Getting Closer / Drifting Apart / Holding Steady + "What the data shows")
10. The Arc (closing AI read + "Done")

The Turning Point card is the most important addition. "Then vs Now" tells you that things changed. The Turning Point tells you when. Without a when, the growth analysis feels theoretical. With a when, it becomes: "Something happened around that September. You can probably guess what."

---

## Cross-Cutting Issues — Updated

### Score ring count
Across a Full Read: Love Language 1 ring, Energy 2 rings (cards 2 and 8, but same values so second is a callback not a new number), Toxicity 2 rings (cards 2 and 10 — individual scores and the verdict; ring removed from card 1 as it front-loads the verdict before the evidence), Accountability 4 rings (cards 3 and 4 each have one). Total: roughly 9–10 score rings. That's high but not unmanageable if the rings look and feel meaningfully distinct per report (different colors, different contexts). The bigger risk is Accountability cards 3 and 4 appearing back-to-back — same ring component, same visual structure. The color distinction (orange for A, blue for B as specified) carries this.

### The Finale — now has a purpose
The [[Analysis — Features & Report Redesign]] document establishes this clearly: the Finale becomes synthesis line → share → quiz challenge. This solves the current problem of "Done" leading to a dead screen. The quiz invitation is also most powerful after "What's Really Going On" closes General Wrapped — the user just received a truth about their relationship and now they're curious whether the other person sees it the same way. The sequencing matters.

The quiz share framing should extend beyond the two people in the chat. Add a second option on the Finale screen: "See how much your friends know about this chat." A shareable link or screenshot challenge that anyone can take — not just the person in the conversation. The quiz becomes a social artifact: "I uploaded my chat, can you guess what it said about us?" This widens the viral surface beyond the dyad and gives users a reason to share even when the other person hasn't downloaded the app.

### Time dimension
Still almost entirely unused except in Growth and the streak/months stats. The Time of Day card proposed for General Wrapped is the start, not the end. The Turning Point card in Growth uses temporal data. The quiz question "who sent the first good morning?" uses temporal + content search. These establish a pattern that could extend further — response latency changing over time, what days the chat is most active, etc. This is an underleveraged axis across the entire product.

### Shareability
The most shareable cards remain the identity/personality reveals: Spirit Emojis, Group Roles, Love Language reveal, Ghost Award. The guess mechanic makes these more shareable — "I got this wrong, I thought it was Mia" is a more compelling share than "look at my results." The Attribution card also drives sharing because real quoted messages are the most recognizable content in the chat.

---

## Revised Target Card Counts

| Report | Current | Previous Suggestion | Revised Target |
|--------|---------|-------------------|---------------|
| Quick Read Trial | 8 | 7 | 8 |
| General Wrapped Duo | 17 | 13–14 | 16 |
| General Wrapped Group | 17 | ~16 | 16 |
| Love Language | 5 | 7 | 10 |
| Energy | 6 | 5 ← wrong | 10 |
| Toxicity | 7 | 8 | 10 |
| Accountability | 7 | 6 ← wrong | 10 |
| Growth | 5 | 8 | 10 |

The ratio between General Wrapped and the smallest paid report is now 16:10 = 1.6:1. Previously it was 17:5 = 3.4:1. That's the real fix.

---

## Priority Order — Revised

1. **Reshape General Wrapped Duo** — convert Ghost Award to Guess+Reveal, cut Novelist vs Texter entirely, add Time of Day card, add Attribution card, fix ending order, cut 4 redundant flat cards; update Your Language card to top 5 words with interactive signature phrase
2. **Expand Growth Report to 10 cards** — add individual arc cards, add Turning Point, add The Message That Shifted Everything (Attribution), add Guess
3. **Expand Energy Report to 10 cards** — add The Dynamic card, add Energy by Time card, add The Charge (Attribution), add Guess, fix ending order (energising before draining)
4. **Expand Love Language to 10 cards** — add common intro card, add Guess for A, add The Miss card, replace What Would Help with How It Shows, add The Unspoken Moment, move score ring to closer position; ensure group chat compatibility
5. **Expand Accountability to 10 cards** — add Guess, add The Reliability Arc, add The Promise That Changed Things (Attribution), keep individual cards separate
6. **Redesign Toxicity to 10 cards** — remove ring from Card 1, convert Red Flag Moments to Attribution card, add What's Still Here, add Guess before Apologises More, add Guess before Power Balance
7. **Define the Finale** — synthesis line + share + quiz challenge + friends quiz option
8. **Restructure Quick Read stats** — split into 2 cards, merge Cards 6+7
