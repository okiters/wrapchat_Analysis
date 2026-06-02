# Features & Report Redesign — Integrated Thinking

*Connects to: [[Analysis — Report Balance & UX]]*

---

## The Frame

Three features are on the table: Guess Before Reveal, Chat Memory Quiz, Who Said This. The right way to think about them is not as additions to the existing reports, but as forces that change what the reports need to be.

The core shift: right now every card is a delivery. You arrive, you receive. These features make cards into exchanges. That changes the pacing, the card count logic, and what "too many cards" even means. A 16-card report where 3 cards are guess interactions is a fundamentally different experience than 16 passive slides. The count is similar. The time in the app is longer. The feeling is completely different.

One clarification from [[Analysis — Report Balance & UX]]: the question is not just how the features fit into the current card counts. The current card counts for Energy (6), Accountability (7), and Growth (5) are themselves too low for paid reports. The features don't solve that — expansion does. These features make each card earn its slot; they don't substitute for having enough slots.

The revised target: no paid report fewer than 8 cards. The features change the shape of those cards. They don't change the minimum.

---

## Feature 1 — Guess Before Reveal: Design System

### What it actually is

Not a quiz. A prediction. The distinction matters psychologically: a quiz tests whether you know something. A prediction makes you commit to a belief about another person before the data corrects you. The correction is the point. People are not neutral about being wrong about someone they know — they're surprised, or defensive, or delighted. That emotional reaction is what makes the card feel alive instead of informational.

The setup line ("one of you takes 4 hours, the other 8 minutes") is doing critical work before the buttons appear. It creates stakes. The user already knows something interesting is about to land. The guess is a commitment ritual — it makes the reveal feel earned.

### The card structure

Two cards per interaction:

**Guess card** — teaser line (the gap, not the answer), two name pills, three interaction states: idle / wrong (shake + flip to reveal) / right (burst + flip to reveal).

**Reveal card (enriched)** — not just the answer. The number + a specific moment from the actual chat that contextualizes it + one line that reframes the stat beyond the number. The reframe is what prevents the reveal from feeling like a correction and makes it feel like a deeper truth. "When she's in it, she's in it" does this. Without the reframe, the reveal is just scoring a quiz.

### Where it belongs — across all reports

The mechanic needs two conditions: the user has a genuine prior belief about who it is, and being wrong is actually interesting. Obvious stats don't work. Surprising ones, or ones where the user knows who but not by how much, work best.

**General Wrapped Duo** — Ghost Award (strong: reply time asymmetry is almost always surprising even when the direction is expected), Novelist vs Texter (strong: message length difference is invisible in daily use), Who Always Reaches Out First (medium: works if the percentage is extreme).

**General Wrapped Group** — The Ghost (strong: in a group, the least active member is rarely who people assume).

**Love Language** — Guessing Person A's love language (very strong: this is the most emotionally loaded guess in the whole app; people are frequently wrong about the category, confusing the expression of love for the language). Only guess A's, not B's — two consecutive guesses of the same type lose momentum.

**Energy** — Who's the more positive presence (strong: self-perception is systematically biased here; most people assume they're the more energizing one).

**Toxicity** — Who apologises more (strong: people have strong feelings about this and the correct answer is often not what either person would say out loud).

**Accountability** — Who made more promises (medium: works when the numbers are genuinely surprising; less charged than the apology guess).

**Growth** — Who changed more (medium: works when the answer is counterintuitive, which it often is).

### The cut logic

Every card that becomes a Guess+Reveal pair adds one card net. So converting Ghost Award to a pair turns one card into two (+1). This doesn't add content weight — it adds interaction value. The correct move is: identify the guessable cards, convert them, then separately identify the genuinely redundant flat cards and cut those. Don't cut to make room for guess cards. Cut what's redundant independently, then add guess pairs where the mechanic fits.

**Balanced-data rule:** the Guess mechanic only fires when there is a clear, skewed answer. If the underlying data is balanced — a near 50/50 split, no meaningful winner — skip the Guess card entirely and show a balanced result card instead. A guess with two names and a balanced answer creates a frustrating non-reveal and undermines the mechanic's credibility. The threshold for "skewed enough to guess" should be defined at the stat computation layer before the card is rendered.

---

## Feature 2 — Chat Memory Quiz: Design System

### What it actually is

Not a memory test. The quiz is about exposing the gap between how much each person pays attention to the relationship. The viral hook is the score comparison: "You got 3/5. Özge got 5/5 on her own quiz." That line does all the work. It creates mild social pressure — defend yourself or send the quiz back. The social loop is: Person A generates report → sends quiz to Person B → Person B scores lower → Person B generates their own report and sends quiz back. The quiz is the engine of word-of-mouth.

Screenshots are passive sharing. The quiz is a challenge. The difference in viral mechanics is significant.

### Data coupling with the reports

Quiz questions must be answerable from computed stats — they can't require AI calls because the quiz recipient may not have generated the report. This bounds the quiz to what the stat computation layer produces.

Questions from local stats (always available): who sent the first message, most used word (multiple choice, excluding stopwords), quietest month, who sent most voice notes, who used more emojis, best streak, who had the longest single message.

Questions from content pattern matching (requires phrase search): who sent the first "good morning," who sent the first apology, who first said they missed the other person.

Questions unlocked by specific reports: who has the higher accountability score (Accountability Report), whose love language is Words of Affirmation (Love Language Report), who the AI says is the more positive presence (Energy Report), what the relationship trajectory label is (Growth Report).

This creates a natural tier system. Quick Read users get a 3-question quiz from base stats. Full Read users get a 7-question quiz drawing from all reports. The quiz depth becomes a concrete, visible benefit of the fuller pack — not just more cards, but richer questions.

### Question design

5 questions is right. Order: easy → surprising → emotionally loaded. Start with something most people get roughly right (quietest month), move to something that requires genuine recall (most used word), end with something that lands differently depending on the relationship (who apologized first, who said good morning first). The escalation mirrors the report structure itself.

The four answer options for word/phrase questions need calibrated decoys — plausible but wrong. This is the only element that might need AI generation (producing convincing wrong answers for word questions is harder than the right answer). Everything else can be deterministic.

### Where it lives

After the Finale. The report has to land first. The quiz invitation is a second action on the Finale screen alongside the share button. This also solves the Finale's current problem: "Done" leading nowhere is a dead screen. With the quiz, the Finale becomes: synthesis line → share → challenge. That's a launch point, not an ending.

The quiz is most powerful in the Finale after "What's Really Going On" closes General Wrapped — as noted in [[Analysis — Report Balance & UX]], the user just received a truth about their relationship and the natural next question is whether the other person sees it the same way. The Finale and the quiz are sequentially dependent on that closing card landing correctly. This is another reason to move What's Really Going On to the true final card of General Wrapped.

---

## Feature 3 — Who Said This?: Design System

### What it actually is

An attribution mechanic. Show a real message from the chat with the sender hidden. Ask who sent it. Reveal with context.

The mechanic is universal — it works anywhere a specific message has been surfaced. The emotional register changes by context: in Toxicity, the message is charged or confrontational. In Love Language, it's tender. In General Wrapped, it might be funny or distinctive. The card component is the same; the tone is set entirely by which message the AI selects.

### The reveal standard — non-negotiable

Every Attribution reveal needs exactly three things:
1. The attribution (name)
2. Timestamp and minimal context (sent on a Wednesday at 11:43pm)
3. One line about what was happening around it (Özge had just sent two messages with no response for 6 hours)

Without item 3, it's a name reveal. With item 3, it's a moment. The difference between the two is whether the user feels like the app read the chat or just extracted a message.

### Where Attribution cards replace existing cards

**Toxicity — Red Flag Moments (Card 4)** becomes one Attribution card. The current scrollable list is passive — users skim it. A single message, sender hidden, asking "who sent this?" forces commitment. The reveal with timestamp and context makes them feel the moment rather than read about it. One moment experienced deeply is more memorable than five moments listed. The second attribution-style card (from the original proposal — one heavy, one lighter from the humor cluster) is kept but becomes a moment of tonal contrast within the Toxicity report rather than a second identical Attribution card structure. This addresses the psychological blind spot identified in [[Analysis — Report Balance & UX]]: Toxicity needs some acknowledgment that the relationship isn't monotonically negative. A lighter message surfaced from the humor cluster, shown in the same Who Said This format, does this without forcing positivity.

**Love Language — Most Loving Moment (Card 5 in new structure)** becomes an Attribution card. The current spec says "one AI card labeled 'The moment.'" An AI summary of a loving moment is less powerful than seeing the actual words. This is the card where seeing the real message — "who sent this?" with the reveal that it was Person A, on a Tuesday in March, right after an argument — makes the report feel like it actually read their relationship.

**General Wrapped Duo** — one Attribution card embedded in the AI section (cards 14–16). The user has been reading about their chat for 12+ cards. Seeing one actual message from it, in their own words, reorients everything. It's a grounding moment after a long run of analysis.

---

## Cross-Report Redesign — Revised Card Structures

### General Wrapped Duo — target 16 cards

**Cuts:** Who's More Obsessed (−1, absorbed by Who Always Reaches Out First), merge Top 10 Words + Signature Phrases into one "Your Language" card (−1, reduced to top 5 words, signature phrase made interactive), The Last Word (−1, insight covered by Ghost Award), Media and Links (−1, lowest emotional value stat card). Novelist vs Texter also cut entirely — see [[Analysis — Report Balance & UX]].

The cuts should not flatten the report's tone. The roast/lovely/funny/chaotic categorization structure — the spirit labels, the comparative framings, the playful verdicts — stays intact throughout the remaining cards. The cuts remove redundant data, not personality.

**Additions:** Ghost Award becomes Guess+Reveal (+1), Time of Day card (+1, bridges stats and AI sections), Attribution card in AI section (+1).

**Reorder ending:** Drama Report → Chat Vibe (aesthetic) → What's Really Going On (truth, lands last).

Net: 17 − 4 + 4 = 17, but structured as 16 content slots with 2 interactive pairs. Every remaining card earns its place.

### General Wrapped Group — target 16 cards

Same cut logic: The Last Word (−1), Media and Links equivalent (−1). Same additions: The Ghost becomes Guess+Reveal (+1), Time of Day (+1). Same ending fix. Net: 17 − 2 + 2 = 17, call it 16 effective content slots.

### Love Language Report — target 10 cards

1. Love Languages in This Chat (common intro card — overview before individual reads; frames the lens)
2. Guess A's love language
3. Reveal A's love language ("How they show it" — specific examples from the actual chat)
4. Person B's love language (direct reveal with examples — no second guess; mechanic repetition kills momentum)
5. The Language Gap ("Do they speak the same language?")
6. The Miss — a moment where love was expressed in one language but received in another (new; the most psychologically precise card in the report)
7. Most Loving Moment (Attribution card — real message, sender hidden, framed as the mutual peak rather than who was kindest; reveal with context)
8. How It Shows (replaces "What Would Help" — real examples of each love language in action from the chat; facts with evidence, not prescriptions)
9. The Unspoken Moment (new — AI identifies love expressed without words: a fast reply streak, an emoji burst, a voice note at an odd hour)
10. Compatibility (score ring + "Compatibility read" — the score lands in context, not as a cold verdict)

### Energy Report — target 10 cards

Previous suggestion of 5–6 cards was wrong. 10 is correct.

1. Guess who's the more positive presence
2. Net Energy Scores (Reveal — score rings + energy type labels for both + compatibility opening AI card)
3. Person A's Energy (positive energy + draining patterns + hype quote)
4. Person B's Energy (positive energy + draining patterns + hype quote)
5. Energy by Time (new — when is each person at their peak? "She's a 10pm person. They're a 9am person." Same timestamp data as the GW Time of Day card, filtered through an energy lens; short, specific, intimate)
6. The Dynamic (new — "What happens when you're together" — AI's read of how their specific energies interact as a pair; distinct from A's profile and B's profile because it's about the combination, not the individuals)
7. Most Energising Moment (moved before draining — end the middle section on a high)
8. The Charge (new Attribution card — "Who sent this when the energy was at its highest?" A message from the conversation's most electrically alive moment, sender hidden; reveal with context)
9. Most Draining Moment (honest; lands harder coming after the high)
10. Overall Compatibility (score rings as callback + "Overall read" AI closing card)

The Dynamic card is the most significant addition. Love Language has the Language Gap as its equivalent — the card that asks not "who is A" or "who is B" but "what happens when these two specific people meet." Energy needs the same. Without it, the report describes two individuals and then jumps to a compatibility score without showing the dynamic that generates that score.

Cards 2 and 10 are intentional bookends — same score values, different framing. Card 2 opens: here are the scores before context. Card 10 closes: here are the scores after 8 cards of evidence. They're not duplicates.

### Toxicity Report — target 10 cards

1. Chat Health Score ("Verdict" AI opening — no ring at card 1; sets tone before evidence)
2. Individual Health Scores (stacked rows, both on one card — score rings here, not card 1)
3. Guess who apologises more
4. Who Apologises More (Reveal — per-person context AI cards)
5. Attribution Card (heavy message from conflict cluster — Who Said This mechanic)
6. Conflict Pattern ("How arguments unfold")
7. Guess who holds the power (new interactive card — power perception is rarely accurate; the most charged guess in the report)
8. Power Balance (Reveal — power holder + "Power dynamic" AI card)
9. What's Still Here (new — AI identifies the genuine positive thread; placed before the verdict so the final score lands in honest context; not forced positivity, just psychological accuracy)
10. The Verdict (score ring + "Final read" + disclaimer — ring appears only here, not at card 1)

The second tonal-contrast message (lighter, from the humor cluster) from the original proposal is absorbed into the What's Still Here card rather than being a separate Attribution card. Keeping What's Still Here as an AI card is cleaner — it's the report's acknowledgment of complexity, not a second quiz moment.

### Accountability Report — target 10 cards

Previous suggestion to merge Person A and B and to merge Fair Comparison with Follow-Through Pattern was wrong. Both pairs need to stay separate.

1. Guess who made more promises
2. Promises Made (Reveal — counts + "Overall verdict" AI card)
3. Person A's Accountability (score ring + kept/broken counts + "Pattern" AI card)
4. Person B's Accountability (same structure)
5. Fair Comparison ("Both sides" — contextualizes numbers with circumstances)
6. The Reliability Arc (new — did accountability improve or decline over the chat's lifespan? One AI card using early/late promise analysis; a downward arc is the most confrontational read in the report)
7. Follow-Through Pattern ("Pattern" + "Evidence strength" — behavioral read, distinct from Fair Comparison)
8. The Promise That Changed Things (new Attribution card — a promise with visible downstream effects, sender hidden; not the most broken or most kept, but the one that mattered most to the arc of the relationship)
9. Most Notable Broken Promise
10. Most Notable Kept Promise ("Done" nav)

### Growth Report — target 10 cards

1. Then vs Now (early vs recent + direction subtitle: deeper ↑ / shallower ↓ / about the same →)
2. Person A's Arc (how A changed across the chat — topics, tone, engagement pattern)
3. Person B's Arc (how B changed)
4. Guess who changed more
5. Who Changed More (Reveal — name or "Both equally" + "How they changed" AI card)
6. What Changed in the Chat (topics appeared + topics faded — kept as full card; distinct from individual arcs because it covers the relationship's themes, not the people)
7. The Turning Point (new — AI identifies approximately when the biggest shift happened; temporal anchor that makes the analysis feel like it actually read across time rather than just comparing early vs late)
8. The Message That Shifted Everything (new Attribution card — the actual message or exchange at or near the Turning Point, sender hidden; The Turning Point tells you when, this card shows you what; reveal with context about what changed in the weeks after)
9. Relationship Trajectory (Getting Closer / Drifting Apart / Holding Steady + "What the data shows")
10. The Arc ("Overall read" closing AI card + "Done" nav)

The Turning Point card is the most important addition. "Then vs Now" says things changed. The Turning Point says when. Without a when, the growth analysis is theoretical. With a when, it becomes: "something happened around that September." Users know what September was.

### Quick Read Trial — target 8 cards

Merge Cards 6 (The Vibe) and 7 (Your Summary) into one card to remove the repetition. Then split the stats card into 2 — one for message volume and activity data, one for behavioral patterns — so the data has room to breathe. Merging frees one slot; the stats split uses it. Net: stays at 8.

---

## Revised Card Count Table

| Report | Current | Revised Target | Change |
|--------|---------|---------------|--------|
| Quick Read Trial | 8 | 8 | 0 (reshaped: stats split, cards 6+7 merged) |
| General Wrapped Duo | 17 | 16 | −1 (completely reshaped) |
| General Wrapped Group | 17 | 16 | −1 (same) |
| Love Language | 5 | 10 | +5 |
| Energy | 6 | 10 | +4 |
| Toxicity | 7 | 10 | +3 |
| Accountability | 7 | 10 | +3 |
| Growth | 5 | 10 | +5 |

Full Read total: 8 + 16 + 16 + 10 + 10 + 10 + 10 + 10 = ~90 cards (vs current ~72).
Ratio of largest to smallest paid report: 16:10 = 1.6:1 (vs current 17:5 = 3.4:1). Tighter, more premium.

---

## Additional Card Ideas — Per Report

These are candidate cards for swapping into or extending the existing structures. Designed to be interesting, specific, and earn their slot. Pick what fits; swap what doesn't.

### Love Language — extras
Current revised structure has 10 cards. All slots filled.

If you want to push further or swap:
- **Love Language Over Time** — did their expressed language shift across the chat's lifespan? "Early on, it was all acts of service. By October, it was almost entirely words of affirmation." One AI read, uses the same early/late split as the Growth report. Makes Love Language feel time-aware.
- **The Translation Attempt** — a moment where one person clearly tried to speak the other's love language even though it isn't theirs. The inverse of The Miss. More hopeful register; a good tonal counterweight if the report reads cold.

### Energy — extras
Current revised structure has 10 cards. All slots filled.

If you want to push further or swap:
- **The Quiet Stretch** — the longest period of low-energy exchange in the chat. Not the end — the trough before a spike. When did both people go flat, and for how long? Context from the AI on what might have been happening. Counterweight to the high-energy moments.

### Toxicity — extras
Current revised structure has 10 cards. All slots filled.

If you want to push further or swap:
- **The Bright Spot** — a second Attribution card from the humor or warmth cluster. One lighter message, sender hidden, as tonal contrast within the toxicity arc. If What's Still Here is the AI's observation, The Bright Spot is the actual evidence: "This is what still exists in here." Different register from the heavy Attribution card; same component, completely different feel.
- **The Escalation Map** — a visual within Conflict Pattern: a rough timeline showing when conflicts cluster. "Three in one week in March, then nothing for six weeks." Makes the pattern visible as a shape, not just a description.

### Accountability — extras
Current revised structure has 10 cards. All slots filled.

If you want to push further or swap:
- **Who Gave More Grace** — who was more forgiving when the other person dropped the ball? The counterweight to the accountability scores. Two people can have unequal follow-through and equal grace — that's a different dynamic from unequal follow-through and unequal grace. The most humanizing card the report could have.
- **Promise Categories** — what kinds of promises are made most? "Meeting up: 12. Responding: 8. Doing something: 6." Short stat card that adds texture to the raw counts without requiring new data.

### Growth — extras
Current revised structure has 10 cards. All slots filled.

If you want to push further or swap:
- **What Stayed the Same** — the things that never changed across the full arc: a recurring topic, a phrase that shows up throughout, a behavior that persisted from first message to last. Anchors the growth analysis in continuity. Growth is more meaningful when you can see what held still while everything else moved.
- **The Quiet Before** — the period of lowest activity in the chat's lifespan, not the end but the trough before a spike. What came before the relationship deepened, and what changed it? A temporal card that uses the same data as streak stats but reads it as a story.
---

## New Card Types Needed

**Guess card**
Props: teaser line, name A, name B, correct answer.
States: idle / wrong (shake + flip to reveal) / right (burst + flip to reveal).
Transitions automatically to the next card on resolution. Does not allow swiping past without answering.

**Attribution card**
Props: quoted message text, name A, name B (for guess buttons), reveal payload: name + timestamp + context paragraph.
States: idle / answered (reveal animation).
Report-agnostic — tone is determined entirely by the message content, not the component. Works in GW, Love Language, Toxicity.

**Enriched Reveal card**
Not a new component — a spec change to existing reveal cards. Every reveal that follows a Guess card must include: the stat + a specific moment from the chat that contextualizes it + one reframe line. "Mia — 4h 12min avg" is not enough. "Mia — 4h 12min avg. Her longest streak of fast replies: a 47-message back-and-forth at 11pm on March 14th. When she's in it, she's in it." is the standard.

---

## The Finale — Structure

1. Synthesis line — one AI-generated observation that crosses report boundaries if multiple reports were run. For Full Read: something that connects findings across reports ("Your chat is emotionally generous but conflicts run cold and fast"). For Quick Read: simpler, report-specific.
2. Share button.
3. "Send [name] a quiz →" — duo chats only in the first version. For group: "Send the group a quiz →" with adapted multi-person questions.
4. Optional: generate the other person's report if they haven't already.

The Finale is a launch point, not an end screen. The quiz invitation is its primary purpose.

---

## The Rhythm of a Full Read — Revised

Quick Read (8 cards) →
General Wrapped Duo (16: stats block → guess pair → time card → AI block → attribution → relationship truth last) →
Love Language (10: common intro → guess → reveal → B's language → gap → miss → attribution moment → how it shows → unspoken → score) →
Energy (10: guess → reveal → A → B → energy by time → dynamic → high → charge attribution → low → compatibility) →
Toxicity (10: health text → individual scores → guess apology → apology reveal → attribution → pattern → guess power → power reveal → positive note → verdict) →
Accountability (10: guess → promises → A score → B score → fair comparison → reliability arc → follow-through → promise attribution → broken → kept) →
Growth (10: then/now → A's arc → B's arc → guess → who changed → what changed → turning point → message attribution → trajectory → arc) →
Finale (synthesis → share → quiz challenge + friends quiz option)

Total: ~90 cards across the full experience. Interactive beats: ~15 across the session (1 in GW, 1 in LL, 1 in Energy, 2 in Toxicity, 1 in Accountability, 1 in Growth, 5 Attribution cards). Roughly one interactive beat every 6 cards — present and surprising throughout without dominating.

The arc of the Full Read has a shape now: General Wrapped is the foundation, mostly stats, establishing who these people are numerically. Love Language and Energy are warm and analytical. Toxicity and Accountability are the confrontational center — the reports people both want and are afraid to run. Growth closes by putting everything in time. The Finale synthesizes across all of it.
