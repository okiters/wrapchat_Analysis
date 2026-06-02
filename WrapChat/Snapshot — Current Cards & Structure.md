# Snapshot — Current Cards & Structure

*Reference snapshot taken 2026-06-02. Connected to: [[Analysis — Features & Report Redesign]] · [[Analysis — Report Balance & UX]]*

*This file is a frozen copy of every branch's card list and card content as it stands today. Use it to compare against edits made to the live branch files and to restore any card you've changed.*

---

## Pack Map

| Pack                 | Reports                                  | Credits |
| -------------------- | ---------------------------------------- | ------- |
| Quick Read           | Trial (free, one-time)                   | 0       |
| Vibe Pack            | General Wrapped + Love Language + Energy | 95      |
| Red Flags Pack       | Toxicity + Accountability                | 80      |
| Growth Report (Pack) | Growth only                              | 45      |
| Full Read            | All of the above (except Quick Read)     | 210     |

---

## Quick Read Trial — 8 cards

**Chat type:** Duo & Group (minor label swaps only)

| # | Card | Type |
|---|------|------|
| 1 | QR — Chat Snapshot | Stats |
| 2 | QR — Message Balance | Stats |
| 3 | QR — Conversation Rhythm | Stats |
| 4 | QR — Chat Texture | Stats |
| 5 | QR — How You Connect | AI |
| 6 | QR — The Vibe | AI |
| 7 | QR — Your Summary | AI + Stats + Upsell |
| 8 | QR — What You Can Unlock | Upsell |

### Card content

**Card 1 — QR — Chat Snapshot**
2×2 grid of stat cells: total message count · number of people (labeled "Chatters" for duo, "People" for group) · best streak in days · top month with its message count. Subtitle: participant names joined with "&" and total message count.

**Card 2 — QR — Message Balance**
Bar chart with one bar per person — up to 2 bars for duo, up to 5 for group. Each bar a different color. Subtitle: duo shows percentage of messages from Person 1; group shows who the main character is.

**Card 3 — QR — Conversation Rhythm**
2×2 grid of stat cells. Duo cells: Ghost award · Reply times · Who starts conversations · Last word. Group cells: Main character · The ghost · Who starts conversations · Last word.

**Card 4 — QR — Chat Texture**
Three stacked sections — "Most used words" (word and bigram list) · "Stats" (3-cell row: total media count · total voice note count · total link count) · "Most used emojis" (rounded strip showing all spirit emojis in a row).

**Card 5 — QR — How You Connect**
Two AI cards stacked: "How you communicate" (overall communication pattern) · "Most interesting thing" (single most notable takeaway the AI found).

**Card 6 — QR — The Vibe**
One AI card labeled "Chat vibe" — the AI's one-liner characterization of the overall energy of this chat.

**Card 7 — QR — Your Summary**
AI card label "Chat vibe" — repeated from Card 6. Below: 2×2 stats grid (total messages · best streak · top month · people count). Below: faint bordered text block: "There is a lot more to read in this chat. See the packs to unlock the deeper reports." Nav button: "See packs."

**Card 8 — QR — What You Can Unlock**
Full-screen upsell. No navigation chrome, no pill label. Collapsible list of all available packs. Navigation leads to the Finale.

---

## General Wrapped — Duo — 17 cards

**Chat type:** Duo

| # | Card | Type |
|---|------|------|
| 1 | GW Duo — Who's More Obsessed | Stats |
| 2 | GW Duo — The Ghost Award | AI + Stats |
| 3 | GW Duo — The Last Word | Stats |
| 4 | GW Duo — Your Longest Streak | Stats |
| 5 | GW Duo — The Kindest One | AI |
| 6 | GW Duo — Top 3 Most Active Months | Stats |
| 7 | GW Duo — Who Always Reaches Out First | Stats |
| 8 | GW Duo — The Funny One | AI |
| 9 | GW Duo — Spirit Emojis | Stats |
| 10 | GW Duo — Top 10 Most Used Words | Stats |
| 11 | GW Duo — Signature Phrases | Stats |
| 12 | GW Duo — The Novelist vs The Texter | Stats |
| 13 | GW Duo — Media and Links | Stats |
| 14 | GW Duo — What You Actually Talk About | AI |
| 15 | GW Duo — The Drama Report | AI |
| 16 | GW Duo — What's Really Going On | AI |
| 17 | GW Duo — Chat Vibe | AI |

### Card content

**Card 1 — Who's More Obsessed**
Two animated horizontal bars, one per person, proportional to message count (orange / blue). Subtitle: percentage of all messages sent by Person 1. Quip: deterministic one-liner seeded by names + percentage.

**Card 2 — The Ghost Award**
*Balanced variant:* Title "Response times" · Big text "Balanced" · both avg reply times side by side · quip about balanced responses.
*One person is slower variant:* Title "The Ghost Award" · Big text: name of the slower replier · both avg reply times side by side · AI card label "What's really going on" (AI context for why this person ghosts) · quip about the ghost.

**Card 3 — The Last Word**
Big text: name of the person who sends the final unanswered message most often. Subtitle: "Sends the last message that nobody replies to — X times." Quip below.

**Card 4 — Your Longest Streak**
Big text: number of days. Subtitle: "Texted every single day for X days straight." Quip from a tiered pool: under 10 days / 10+ days / 30+ days / 100+ days.

**Card 5 — The Kindest One**
Big text: AI-determined name. AI card label "The sweetest moment" — a specific moment the AI identified. No stat bars. Fully AI-driven.

**Card 6 — Top 3 Most Active Months**
Three medal badges in a row — 🥇 🥈 🥉. Each shows the month name and message count. Subtitle: "{top month} was your month. Something was going on."

**Card 7 — Who Always Reaches Out First**
Big text: name of the person who starts the most conversations. Subtitle: "Started X% of all conversations." Quip below.

**Card 8 — The Funny One**
Big text: AI-determined name. AI card label "Drops lines like" — AI's description of their humor style or a representative example.

**Card 9 — Spirit Emojis**
Two large emojis (64px) side by side, one per person, with the person's name in small text below. Subtitle: "These two emojis basically ARE this chat."

**Card 10 — Top 10 Most Used Words**
Word and bigram list via Words component using topWords and topBigrams from local stats. No AI — purely computed from message frequency.

**Card 11 — Signature Phrases**
Two side-by-side cards with slightly transparent white background. Each: one italic bold quoted phrase per person. Phrase source: AI-generated, falling back to top local word. Person's name in small muted text below. Subtitle: "The phrases that define each of you."

**Card 12 — The Novelist vs The Texter**
*Similar lengths (under 15 char difference or under 1.3× ratio):* Title "Message length."
*Clearly different lengths:* Title "The Novelist vs The Texter."
Both variants: two columns side by side per person — large avg char count · "avg chars" label · max message length prefixed "max" · person name below. Quip matches variant.

**Card 13 — Media and Links**
Three stacked bar groups, each with a small uppercase label: "Photos & videos" (two bars, teal/blue) · "Voice memos" (two bars, purple shades) · "Links shared" (two bars, teal/blue). Bars proportional to each person's count within category.

**Card 14 — What You Actually Talk About**
Two AI cards stacked: "Biggest topic" (primary topic of the chat) · "Most tense moment" (most charged or conflict-heavy moment).

**Card 15 — The Drama Report**
Big text: AI-determined drama starter name, or "Shared" or "None clearly identified." AI card label "How they do it" — explains the drama pattern.

**Card 16 — What's Really Going On**
One AI card. Label is dynamic — changes based on relationship type selected at start (partner, friend, family, etc.). Value is the AI's relationship summary tailored to that relationship context.

**Card 17 — Chat Vibe**
Quote box: full-width italic quote with faint background — AI's one-liner vibe for the chat. Below: MomentsRow component (AI's memorable moments, horizontal scrollable row). Subtitle: "Powered by AI — your messages never left your device." Nav button: "See summary" → Finale.

---

## General Wrapped — Group — 17 cards

**Chat type:** Group

| # | Card | Type |
|---|------|------|
| 1 | GW Group — The Main Character | Stats |
| 2 | GW Group — The Ghost | AI + Stats |
| 3 | GW Group — The Last Word | Stats |
| 4 | GW Group — Top 3 Most Active Months | Stats |
| 5 | GW Group — Longest Active Streak | Stats |
| 6 | GW Group — The Hype Person | AI + Stats |
| 7 | GW Group — The Kindest One | AI |
| 8 | GW Group — The Funny One | AI |
| 9 | GW Group — Group Spirit Emoji | Stats |
| 10 | GW Group — Top 10 Most Used Words | Stats |
| 11 | GW Group — The Novelist | Stats |
| 12 | GW Group — Group Roles | Stats |
| 13 | GW Group — What You Actually Talk About | AI |
| 14 | GW Group — The Drama Report | AI |
| 15 | GW Group — Most Missed Member | Stats |
| 16 | GW Group — The Group Read | AI |
| 17 | GW Group — Group Vibe | AI |

### Card content

**Card 1 — The Main Character**
Big text: name of the person with the most messages. Bar chart: all members up to 6, each bar a different color, proportional to message count. Quip: seeded by main character's name and message counts — deterministic.

**Card 2 — The Ghost**
Big text: name of the least active member. Subtitle: "{name} had X messages total. Why are they even here?" AI card label "What's really going on" — AI context for this person's low activity. Quip below.

**Card 3 — The Last Word**
Big text: name of the person who most often sends the final unanswered message. Subtitle: "Sends the last message that nobody replies to." Quip below.

**Card 4 — Top 3 Most Active Months**
Three medal badges in a row — 🥇 🥈 🥉. Each shows month name and message count. Subtitle: "The group was most alive in {top month}."

**Card 5 — Longest Active Streak**
Big text: number of days. Subtitle: "The group kept the chat alive for X days straight." Quip from tiered pool: under 10 / 10+ / 30+ / 100+ days.

**Card 6 — The Hype Person**
Big text: name of the person who starts the most conversations. Subtitle: "Started X% of all conversations. The engine of this group." AI card label "Why {name} is the hype" — AI-generated explanation.

**Card 7 — The Kindest One**
Big text: AI-determined name. AI card label "The sweetest moment" — specific moment AI identified. No stat bars. Fully AI-driven.

**Card 8 — The Funny One**
Big text: AI-determined name. AI card label "Drops lines like" — AI's description of humor style or a representative example.

**Card 9 — Group Spirit Emoji**
Single large emoji (90px) centered — one emoji for the whole group. Subtitle: "This one emoji basically summarises the entire group energy."

**Card 10 — Top 10 Most Used Words**
Word and bigram list via Words component using topWords and topBigrams from local stats. No AI.

**Card 11 — The Novelist**
Big text: name of the person with the longest average messages. Two stats side by side: avg character count · longest single message length. Subtitle (conditional): "Their longest message was mostly about '{topic}'." — shown only if a topic was detected. Quip below.

**Card 12 — Group Roles**
2×3 grid of role cells. Each cell: role label + name of person who fits it.
Roles: Photographer (most photos/videos; switches to "Voice Note Addict" if more voice notes than photos) · Therapist (most supportive/empathetic messages) · Night Owl (most messages sent late at night) · Early Bird (most messages sent in the morning) · Voice Memo King (most voice notes sent).

**Card 13 — What You Actually Talk About**
Two AI cards stacked: "Biggest topic" (primary topic of the group chat) · "The inside joke" (recurring joke or in-group reference).

**Card 14 — The Drama Report**
Big text: AI-determined drama starter name, or "Shared" or "None clearly identified." AI card label "How they do it" — explains the drama pattern.

**Card 15 — Most Missed Member**
Big text: AI-determined name of the person whose absence the group feels most. Subtitle: "When they go quiet, the group feels it." No AI card — name and subtitle only.

**Card 16 — The Group Read**
Two AI cards stacked: "Group dynamic" (AI's overall read of the group's relationship dynamic) · "Most tense moment" (AI-identified most charged moment).

**Card 17 — Group Vibe**
Quote box: full-width italic quote with faint background — AI's one-liner vibe for the group. Below: MomentsRow component (AI's memorable moments, horizontal scrollable row). Subtitle: "Powered by AI — your messages never left your device." Nav button: "See summary" → Finale.

---

## Love Language Report — 5 cards

**Pack:** Vibe Pack
**Chat type:** Duo & Group (same 5 cards)

| # | Card | Type |
|---|------|------|
| 1 | LL — Person A's Love Language | AI |
| 2 | LL — Person B's Love Language | AI |
| 3 | LL — The Language Gap | AI |
| 4 | LL — Most Loving Moment | AI |
| 5 | LL — Love Language Compatibility | AI + Score |

### Card content

**Card 1 — Person A's Love Language**
Big text: Person A's identified love language — one of: Words of Affirmation, Acts of Service, Receiving Gifts, Quality Time, Physical Touch, or Mixed. AI card label "How they show it" — specific examples of how that language appears in their messages.

**Card 2 — Person B's Love Language**
Big text: Person B's identified love language (same options as above). AI card label "How they show it" — specific examples. Identical structure to Card 1.

**Card 3 — The Language Gap**
One AI card labeled "Do they speak the same language?" — AI's assessment of whether their love languages are compatible, mismatched, or complementary, with explanation.

**Card 4 — Most Loving Moment**
One AI card labeled "The moment" — a specific moment from the chat the AI identified as the most genuinely loving or caring exchange between the two.

**Card 5 — Love Language Compatibility**
Score ring: out of 10, in pink. AI card label "Compatibility read" — AI's overall interpretation of how well their love languages work together.

---

## Energy Report — 6 cards

**Pack:** Vibe Pack
**Chat type:** Duo & Group (same 6 cards)

| # | Card | Type |
|---|------|------|
| 1 | ER — Net Energy Scores | AI + Score |
| 2 | ER — Person A's Energy | AI |
| 3 | ER — Person B's Energy | AI |
| 4 | ER — Most Energising Moment | AI |
| 5 | ER — Most Draining Moment | AI |
| 6 | ER — Energy Compatibility | AI + Score |

### Card content

**Card 1 — Net Energy Scores**
Two score rings side by side, one per person — orange shades. Below each ring: person's name and energy type label (net positive / mixed / net draining). AI card label "Energy compatibility" — AI's overall read of how their energies interact.

**Card 2 — Person A's Energy**
Two AI cards stacked: "Positive energy" (what Person A brings positively) · "Draining patterns" (what Person A does that drains the dynamic). Hype quote (conditional): if the AI returned a hype quote for Person A, it appears below as an italic quoted line.

**Card 3 — Person B's Energy**
Same structure as Card 2. Two AI cards stacked: "Positive energy" · "Draining patterns." Hype quote if available.

**Card 4 — Most Energising Moment**
One AI card labeled "The moment" — specific exchange the AI identified as the highest energy, most uplifting moment in the chat.

**Card 5 — Most Draining Moment**
One AI card labeled "The moment" — specific exchange the AI identified as the most draining or heaviest moment in the chat.

**Card 6 — Energy Compatibility**
Two score rings side by side — same as Card 1 but smaller. AI card label "Overall read" — final compatibility assessment. Nav button: "Done."

---

## Toxicity Report — 7 cards

**Pack:** Red Flags Pack
**Chat type:** Duo & Group (same 7 cards)

| # | Card | Type |
|---|------|------|
| 1 | TX — Chat Health Score | AI + Score |
| 2 | TX — Individual Health Scores | AI + Score |
| 3 | TX — Who Apologises More | AI |
| 4 | TX — Red Flag Moments | AI + List |
| 5 | TX — Conflict Pattern | AI |
| 6 | TX — Power Balance | AI |
| 7 | TX — The Verdict | AI + Score |

### Card content

**Card 1 — Chat Health Score**
Score ring: out of 10, in red, centered. Subtitle: "Out of 10 — based on conflict patterns, communication style, and overall dynamic." AI card label "Verdict" — AI's opening summary of the chat's health.

**Card 2 — Individual Health Scores**
Stacked rows, one per person. Each row: score ring (orange for Person A, blue for Person B) on the left · person's name in bold with detail text explaining what drove their individual score on the right.

**Card 3 — Who Apologises More**
Big text: name of the person who apologises more. Two AI cards stacked below, one per person — each labeled "{Person's name} — context." Shows AI's read of their apology behavior and what it means.

**Card 4 — Red Flag Moments**
Scrollable list of flagged moments. Each item: header (date and person name in small uppercase) · bold description of what happened · italic quoted line from the actual message (conditional, shown if available).

**Card 5 — Conflict Pattern**
One AI card labeled "How arguments unfold" — the AI's description of the recurring conflict structure: how arguments start, how they escalate, how they end.

**Card 6 — Power Balance**
Big text: name of whoever holds more conversational power, or "Balanced" if neither does. AI card label "Power dynamic" — explains what that imbalance looks like in practice.

**Card 7 — The Verdict**
Score ring: out of 10, in red, centered. Subtitle: "Overall chat health score." AI card label "Final read" — AI's closing summary. Disclaimer: "Reflects patterns in this sample — not a final judgment." Nav button: "Done."

---

## Accountability Report — 7 cards

**Pack:** Red Flags Pack
**Chat type:** Duo & Group (same 7 cards)

| # | Card | Type |
|---|------|------|
| 1 | AC — Promises Made | AI + Stats |
| 2 | AC — Person A's Accountability | AI + Score |
| 3 | AC — Person B's Accountability | AI + Score |
| 4 | AC — Fair Comparison | AI |
| 5 | AC — Follow-Through Pattern | AI |
| 6 | AC — Most Notable Broken Promise | AI |
| 7 | AC — Most Notable Kept Promise | AI |

### Card content

**Card 1 — Promises Made**
Two cells side by side, one per person. Each cell: large number (total promise count) · "promises" label · person's name. AI card label "Overall verdict" — AI's opening read of the accountability dynamic.

**Card 2 — Person A's Accountability**
Score ring: out of 10, in blue, centered. Below the ring — two smaller cells side by side: kept count in green with "kept" label · broken count in red with "broken" label. AI card label "Pattern" — describing Person A's follow-through behavior.

**Card 3 — Person B's Accountability**
Identical structure to Card 2. Score ring · kept/broken cells · AI card label "Pattern" for Person B.

**Card 4 — Fair Comparison**
One AI card labeled "Both sides" — AI's comparison of both people's accountability, acknowledging context and circumstances rather than just raw numbers.

**Card 5 — Follow-Through Pattern**
Two AI cards stacked: "Pattern" (recurring behavioral pattern around promises) · "Evidence strength" (AI's assessment of how strong and clear the evidence was in this chat).

**Card 6 — Most Notable Broken Promise**
Promise moment card: person's name · the promise that was made · the outcome. Fallback: "No clear meaningful broken promise showed up strongly enough in this chat."

**Card 7 — Most Notable Kept Promise**
Promise moment card: person's name · the promise that was made · the outcome. Fallback: "No clear meaningful kept promise showed up strongly enough in this chat." Nav button: "Done." Identical structure to Card 6.

---

## Growth Report — 5 cards

**Pack:** Growth Report (Pack)
**Chat type:** Duo & Group (same 5 cards)

| # | Card | Type |
|---|------|------|
| 1 | GR — Then vs Now | AI |
| 2 | GR — Who Changed More | AI |
| 3 | GR — What Changed in the Chat | AI |
| 4 | GR — Relationship Trajectory | AI + Label |
| 5 | GR — The Arc | AI |

### Card content

**Card 1 — Then vs Now**
Two AI cards stacked: "Early messages" (depth and tone of the first period) · "Recent messages" (depth and tone of the most recent period). Subtitle: "Conversations got [direction] [arrow]" — direction is one of: deeper ↑, shallower ↓, or about the same →. Direction word highlighted in green.

**Card 2 — Who Changed More**
Big text: name of the person who changed more over the chat's lifespan, or "Both equally" if no clear difference. AI card label "How they changed" — what specifically shifted in their communication style or topics.

**Card 3 — What Changed in the Chat**
Two AI cards stacked: "Topics that appeared" (subjects and themes that emerged in the later period) · "Topics that faded" (subjects common early that disappeared over time).

**Card 4 — Relationship Trajectory**
Big text: one of three labels — Getting Closer · Drifting Apart · Holding Steady. AI card label "What the data shows" — specific patterns that support that trajectory label.

**Card 5 — The Arc**
One AI card labeled "Overall read" — the AI's closing summary of the full arc of this relationship as seen through the chat. Nav button: "Done."

---

*Snapshot end. For the redesign targets proposed in the analysis notes, see [[Analysis — Features & Report Redesign]] and [[Analysis — Report Balance & UX]].*
