# WrapChat Functional UI/System Spec

This document extracts the product logic and UI system from the current app without carrying over any visual style, branding treatment, layout aesthetic, motion taste, or art direction.

Use this as the design-agnostic product contract when rebuilding the interface in a different visual language.

## Purpose

WrapChat lets a signed-in user upload a WhatsApp export, parse it locally in the client, generate one or more AI-powered relationship/chat reports, save those report results to the user's account, reopen saved results later, share result screens as images, and submit feedback on incorrect analysis cards.

## Core Product Job

The app turns a WhatsApp export into:

1. Structured chat data
2. Local computed chat stats
3. One or more AI analysis outputs
4. Saved report records attached to the user account

The app does not aim to be a general messenger, chat viewer, or raw transcript browser.

## Primary Inputs

- User authentication state
- Accepted legal/onboarding state
- WhatsApp export file (`.txt` or `.zip`)
- Parsed messages
- Relationship type for duo chats only
- Selected report types
- Preferred report language
- Feedback submitted against a saved result card

## Primary Outputs

- Parsed chat summary
- Local stats derived from the chat
- Report result objects for one or more report types
- Saved results history
- Shareable image capture of a current result screen or result summary
- Feedback records tied to saved result cards

## Functional App Flow

The current app behaves like a state machine with these main phases:

1. `auth`
2. `onboarding`
3. `terms`
4. `upload`
5. `tooshort`
6. `relationship` for duo chats only
7. `select`
8. `loading`
9. `results`
10. `history`
11. `admin` for admin users only

Expected flow:

1. User signs in.
2. If needed, user completes onboarding and accepts current terms.
3. User lands on upload/import.
4. User provides a WhatsApp export through file picker, drag/drop, or share-target handoff.
5. Client parses the export.
6. If message count is below threshold, user sees the too-short state.
7. If chat is a duo, user selects the relationship category.
8. User selects one or more report types.
9. App runs the selected analysis jobs.
10. Each successful report is saved separately.
11. If one report was generated, user is taken directly into that result.
12. If multiple reports were generated, user is taken to saved-results history and can open each one.

## Chat Import System

Functional requirements:

- Accept `.txt` and `.zip` WhatsApp exports.
- If a zip is provided, locate the most likely chat text file inside it.
- Reject oversized files.
- Parse iOS and Android WhatsApp export formats.
- Merge multi-line messages back into a single message entry.
- Ignore common system messages.
- Normalize omitted media/voice placeholders.
- Convert parsed messages into AI-ready message objects.
- Produce an import summary:
  - participants
  - participant label
  - message count
  - date range
- Flag chats with fewer than `50` messages as too short.

## Functional Chat Classification

After parsing, the app derives whether the chat is:

- a duo chat
- a group chat

That classification changes the flow:

- Duo chats require relationship selection before report selection.
- Group chats skip relationship selection and go directly to report selection.

## Relationship Input

Relationship selection is a required framing input for duo chats.

Supported relationship categories:

- `partner`
- `dating`
- `ex`
- `family`
- `friend`
- `colleague`
- `other`

Functional rule:

- The selected relationship type is treated as a hard constraint for AI interpretation and downstream labeling.

## Report Catalog

The app currently exposes six report types:

1. `general`
2. `toxicity`
3. `lovelang`
4. `growth`
5. `accounta`
6. `energy`

Users can select multiple report types in one run.

Functional batch behavior:

- Each selected report is generated independently.
- Each successful report is saved as its own result row.
- Credits are checked against the number of selected reports.
- Partial success is allowed.

## Analysis Families

The six reports are powered by three reusable AI analysis families:

- `connection`
- `growth`
- `risk`

Mapping:

- `general` uses `connection`
- `lovelang` uses `connection`
- `energy` uses `connection`
- `growth` uses `growth`
- `toxicity` uses `risk`
- `accounta` uses `risk`

Functional implication:

- The app separates core analysis generation from report-specific presentation.
- Multiple report types can derive from the same underlying family output.

## Local Computation Layer

Before AI runs, the app computes local chat statistics from the parsed message set.

These stats are used to:

- classify group vs duo
- build report context
- seed prompt context
- render non-AI metrics in results
- save math data alongside report results

This local layer is part of the product contract even if the visual UI changes.

## AI Pipeline Responsibilities

### Connection family

Used for:

- general relationship/chat read
- love language read
- energy read

Functional coverage includes:

- overall vibe
- biggest recurring topic
- ghosting/response context
- funniest person and funniest moment
- drama source/context
- kindness and sweetness moments
- relationship summary or group dynamic
- love language signals
- energy dynamics

### Growth family

Used for:

- how the relationship/chat changed over time

Functional coverage includes:

- then vs now
- depth change
- who changed more
- appeared/disappeared topics
- trajectory
- arc summary

### Risk family

Used for:

- toxicity/conflict read
- accountability/promises read

Functional coverage includes:

- chat health
- apology dynamics
- red flag moments
- conflict pattern
- power balance
- accountability outcomes
- kept/broken promises
- overall verdict

## Sampling Rules

The AI does not always receive the full transcript.

Current functional behavior:

- Smaller chats can be sent as full history.
- Larger chats are reduced using event-window sampling.
- Growth analysis uses early/recent snapshots plus bridge windows instead of event windows.

Design-independent requirement:

- Any redesign must preserve the distinction between:
  - import/parsing of the full transcript
  - local stats over the parsed transcript
  - sampled text sent to AI

## Language Model Output Rules

Functional rules in the current system:

- Canonical stored report content is English-based.
- If the chat language is not English, the app may generate a translated overlay for display.
- Control tokens and schema-critical enum values stay fixed.
- The UI language and report display language are related but not identical concerns.

Design-independent requirement:

- Future UIs should keep a clear separation between:
  - interface language
  - detected chat language
  - canonical stored result language
  - translated display overlay

## Persistence Model

Saved result records include:

- `user_id`
- `report_type`
- `chat_type`
- participant names
- `result_data`
- `math_data`

Important storage rule:

- Raw chat text is not saved as a normal persisted result object.
- Report results and summarized math data are saved.

Feedback records include:

- `user_id`
- `result_id`
- `report_type`
- `card_index`
- `card_title`
- `error_type`
- optional note

## Functional Screens

These are the product screens/views that need to exist in some form, regardless of design style.

### 1. Auth

Responsibilities:

- sign in / access account
- transition into onboarding or upload flow based on account state

### 2. Onboarding

Responsibilities:

- explain product basics
- mark onboarding complete

### 3. Terms

Responsibilities:

- present terms/privacy copy
- record acceptance of current legal version

### 4. Upload / Import

Responsibilities:

- accept chat file
- show parsing/opening progress
- show import errors
- show parsed summary before continuing
- provide access to saved results history
- show credit balance when relevant

### 5. Too Short

Responsibilities:

- explain minimum-message requirement
- provide route back to import

### 6. Relationship Select

Responsibilities:

- collect relationship category for duo chats
- gate report generation until selection is made

### 7. Report Select

Responsibilities:

- list available report types
- allow multi-select
- show language option for report display
- validate credit availability
- start batch analysis

### 8. Loading

Responsibilities:

- show that analysis is in progress
- indicate which report in the batch is currently running

### 9. Results

Responsibilities:

- display one saved/generated report
- step through cards/screens inside that report
- support close/back behavior
- support share actions
- support per-card feedback submission

### 10. History / My Results

Responsibilities:

- list previously saved reports
- reopen a saved result
- delete saved results

### 11. Admin

Responsibilities:

- inspect user/feedback operations
- review submitted feedback
- delete feedback records
- use debug tooling where enabled

## Functional UI System

This is the reusable UI contract that can survive a redesign.

### Shell

A report screen container should provide:

- current report context
- progress within the report
- content slot for a card/screen
- back/close navigation
- optional share entry point
- optional feedback entry point

### Card/Step model

Results are not one long page. They are a sequence of report-specific steps/cards.

Each result card should support:

- report section identity
- step index
- display content
- optional feedback target metadata

### Modal/Sheet actions

The product requires at least two overlay interactions:

- share picker
- feedback submission form

### History item model

Saved-result items should surface enough metadata to identify:

- report type
- participants
- chat type
- creation time
- reopen action
- delete action

## Share System

Functional behavior:

- User can share the current result screen as an image.
- User can share a summary/overview capture as an image.
- If native file sharing is available, use it.
- Otherwise fall back to download.

Important note for redesigns:

- The share system depends on rendering a captureable result surface.

## Feedback System

Feedback is attached to a specific saved result card, not just the overall report.

Current functional feedback options:

- Events are mixing
- Wrong person
- Didn't happen
- Tone misread
- Overclaiming
- Missing context
- Other

Functional requirements:

- User chooses an issue type.
- User can add an optional note.
- Submission should not break the browsing flow.

## Credits and Access Control

Functional rules:

- Non-admin users consume credits when reports are generated.
- Credit check happens before running analysis.
- Multi-report runs require at least as many credits as selected reports.
- Admin users bypass normal credit constraints.

## Saved Result Restoration

When a user opens a saved result, the app restores:

- report type
- saved math data
- saved AI/display data
- relationship type if applicable
- correct display language overlay

Design-independent requirement:

- The history system is not just an archive list; it must support full re-entry into the report viewer.

## Privacy and Data Boundary

Current product rule:

- Chat content is processed to produce reports but is not retained as a normal stored chat history.
- Saved reports remain available until deleted by the user or account lifecycle rules remove them.

Any redesign should preserve this product promise at the functional level.

## Explicitly Out Of Scope For This Doc

This document intentionally does not specify:

- color palette
- typography
- visual hierarchy style
- spacing language
- animation style
- iconography style
- brand tone
- illustration direction
- card appearance
- layout mood

Those should be handled in separate design-system or visual-direction docs.

## Rebuild Guidance

If rebuilding the app in a new visual system, keep these invariants:

1. Upload and parse first.
2. Compute local stats before AI.
3. Require relationship input for duo chats.
4. Support multi-report batch runs.
5. Save each report separately.
6. Preserve history restore behavior.
7. Keep per-card feedback targeting.
8. Keep share/export behavior.
9. Preserve language separation and translation overlay logic.
10. Preserve the privacy boundary that stores results, not raw chat history.
