# Update Notes

Add a note before each commit. Use the next version number and move it up from Pending when done.

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
**Commits:** `849dc88`, `f164d27`, `ab36f70` | **Files:** `src/App.jsx`

### Layout centering fix
Minor centering adjustment (2 lines)

### Auth & general footers
Auth footer and general footer added to the shell

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

## Pending (not yet committed)
<!-- Add notes here before your next commit, then label with the next version -->

## v1.9 — Trial & payment gating system
**Files:** `src/App.jsx`, `src/trialReport.js`, `src/reportCredits.js`, `supabase/migrations/20260424160000_trial_and_roles.sql`

### DB migration: roles + trial columns
`role TEXT DEFAULT 'user' CHECK (role IN ('user','tester'))` and `trial_granted_at TIMESTAMPTZ` columns added to `public.credits` (idempotent). New RPCs: `initialise_credits(p_user_id, p_email)` — inserts a first row granting 1 credit in payments mode, no-op if row exists; `get_user_role(p_user_id)` — returns role or 'user'; `admin_set_user_role(p_user_id, p_role)` — admin-only role toggle between 'user' and 'tester'.

### Trial report type (hidden from report selector)
`trial_report` added to `REPORT_PIPELINES` (strategy: "trial"), `reportCredits` (1 cr), and `REPORT_FAMILY` ("trial"). It is in `REPORT_TYPES` for routing purposes but filtered out of the visible list in `ReportSelect`. New `src/trialReport.js` exports `buildTrialPrompt` (short AI prompt — vibe / pattern / takeaway JSON, 360 tokens, capped to 80 messages to minimise API cost) and `deriveTrialReport` (pure mapping). `generateTrialDigest` in App.jsx wires them to `callClaude`.

### Auto-trigger trial flow
`trialAutoRunDoneRef` prevents double-firing. `useEffect` watches `phase === "select"` — when in payments mode with exactly 1 credit and not admin, automatically calls `runAnalysis(["trial_report"], relType)`, skipping the report selector. Ref is reset in `onParsed` so each new upload gets a fresh trigger.

### Upload screen trial messaging
`Upload` now accepts `accessMode` prop. In payments mode with 1 credit: purple banner "You have 1 free trial analysis included." Credit pill is suppressed. In payments mode with 0 credits: info message "Your free trial is used up. Upgrade to unlock full reports."

### TrialReportScreen & TrialFinale
`TrialReportScreen` (1 screen): three AICards (vibe, how you communicate, most interesting thing) + teaser block labelled "That was your free preview. Here's what the full reports include:" with locked report list. `TrialFinale` (step 2): three credit pack cards (Starter 3 cr/$4, Standard 7 cr/$8, Deep Dive 12 cr/$12) + CTA → upgrade screen.

### UpgradePlaceholder redesign
Shows credit pack grid in payments mode. Tester role gets "contact admin" copy instead of packs. Credits mode shows existing "ask admin" message. Accepts new `userRole` and `accessMode` props.

### userRole state & getUserProfile
`userRole` state added to App. `getUserProfile()` replaces `getUserCredits()` in the auth effect — fetches both `balance` and `role` from the credits row in a single query and sets both states.

---

## v1.8 — Bundle UI & credit visibility fix
**Files:** `src/App.jsx`

### Bundle quick-select pills
"BUNDLES" section added above the individual report list in ReportSelect. Three pills (Vibe Bundle, Red Flags Bundle, Full Suite) with cost shown. Clicking a pill sets the full selection to that bundle; clicking an already-active pill clears the selection. Pill goes active (brighter border + white text) when the current selection exactly matches that bundle.

### Credit costs now visible for admins
Removed `hideCredits={authedIsAdmin}` from the select screen (kept only on the upload/balance screen). Admin accounts now see per-report costs and bundle prices. The access mode check still skips actual deduction for admins.

### onBundle handler
New `onSelectBundle` handler in App sets the full selection atomically (no toggle flicker). Passed as `onBundle` prop to ReportSelect.

## v1.7 — Bundle & family-aware credit pricing
**Files:** `src/reportCredits.js`, `src/App.jsx`

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

## v1.5 — Screenshot-based sharing
**Files:** `src/App.jsx`

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
