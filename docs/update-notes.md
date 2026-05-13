# Update Notes

Add a note before each commit. Use the next version number. Latest version always goes at the top — move it out of Pending when committed.

---

## Pending (not yet committed)

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
