# Future — Native App Version

> *Later-phase backlog. Things to revisit once the core build is settled.*

Parking lot for the "should WrapChat go native Swift?" question and the native-feel features that come with it. Add to the [[#Later backlog]] as things come up.

---

## Where we are today

WrapChat is a **Capacitor app** — a React web app (~22k lines) inside a native iOS/Android WebView shell. It splits into:

- **UI** (~12.5k lines) — `Screens.jsx`, `App.jsx`, `Shell.jsx`, `theme.jsx` → a native rewrite means SwiftUI
- **Brain** (~7k lines) — parsing, stats, AI, credits → reimplement in Swift *or* move server-side
- **Backend** — Supabase + a Claude API call → stays as-is (Supabase has a Swift SDK)

A Capacitor app is already a real App Store app: same `.ipa`, same review, same listing. "Native" only buys us performance/feel and true platform features — not store credibility on its own.

## The decision, when we get to it

Don't commit to Swift yet. Do the steps that pay off on *every* path first:

1. **Keep-awake plugin** — the immediate win (see backlog below).
2. **Profile the report screens** — is the jank fixable in the WebView, or structural? `html2canvas` and a 8k-line `Screens.jsx` are prime suspects. Cheap, reversible — this is the evidence that says whether native is even needed.
3. **Move the brain server-side** — pull `localMath` + `aiAnalysis` + `claudeClient` + credits into a Supabase Edge Function. Makes the client a thin UI, so a future native rewrite is "rewrite the UI only," and Android survives for free.
4. **Then** decide native — with Android settled and a thin UI to port instead of a monolith.

Open question: **does Android need to survive?** A Swift-only rewrite abandons the `android/` build unless the brain is server-side + a Kotlin UI.

---

## Later backlog

Native-feel features to add (most are Capacitor plugins — no full rewrite needed):

- [ ] **Keep screen awake during analysis** — stop the screen locking mid-analysis, like Google Maps during navigation. `@capacitor-community/keep-awake`: `KeepAwake.keepAwake()` when analysis starts, `allowSleep()` when it finishes. Wraps iOS `isIdleTimerDisabled`. One-day job.

<!-- Add later-phase items below as they come up -->

---
*Related: [[WrapChat]]*
