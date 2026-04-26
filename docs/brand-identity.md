# WrapChat — Brand Identity

---

## Name & Concept

**WrapChat** — a WhatsApp chat analysis PWA that reads an exported chat file and returns AI-powered reports. The name plays on "wrap" (summarise, reveal, à la Spotify Wrapped) and "chat."

---

## Logo

- **File:** `assets/WrapchatLogo_main_2.svg` (SVG, transparent background)
- **App icon:** `public/applogo.png` — 1308 × 1308 px, maskable
- **Brand lockup:** logo stacked above the wordmark "WrapChat," logo at 72 px, title at 44 px weight 800 letter-spacing −3
- **Inline variant:** logo and wordmark side-by-side with 14 px gap
- **Tinting:** in share cards the logo SVG fill (`#6cb9e0`) is replaced at runtime with the section's accent colour — so the logo always matches the card it sits on

---

## Taglines

| Role | Copy |
|---|---|
| Primary | **"Your chats, unwrapped."** |
| Value prop | "Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation." |
| CTA | "Upload. Analyse. See it clearly." |
| Feature summary | "Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute." |
| Privacy promise | "Your chat is analysed by AI and never stored. Only results are saved." |

---

## Colour System

### Base tokens — non-result screens (auth, upload, navigation chrome)

| Token | Hex | Use |
|---|---|---|
| Background | `#2A1969` | Deep indigo — default screen bg |
| App shell | `#0C1520` | Body / PWA theme colour |
| Text | `#FFFFFF` | Primary text on dark |
| Muted | `rgba(255,255,255,0.60)` | Secondary body copy |
| Faint | `rgba(255,255,255,0.30)` | Placeholder, overline |
| Teal | `#3DC4BF` | Default CTA, primary button |
| Amber | `#F5A84C` | Loading mosaic, accent |
| Lime | `#C2DC3A` | Loading mosaic, accent |
| Blue | `#6AAFD4` | Loading mosaic, accent |
| Orange | `#E07040` | Accent |
| Purple | `#9B8FD8` | Accent |

### Section palettes — result screens

Each report section has three colour stops: full-screen **bg**, card/button **inner**, and highlight **accent**.

| Section | Label pill | bg | inner | accent |
|---|---|---|---|---|
| Roast | The Roast | `#B83A10` | `#E8592A` | `#FF8B6A` |
| Lovely | The Lovely | `#7A1C48` | `#A02860` | `#F08EBF` |
| Funny | The Funny | `#4A6A04` | `#6E9A08` | `#C8F06A` |
| Stats | The Stats | `#083870` | `#0E5AAA` | `#6AB4F0` |
| AI / Insight | Insight | `#1A3060` | `#2A4A90` | `#8AACF0` |
| Upload / Wrapped | Wrapped | `#2C1268` | `#4A1EA0` | `#A08AF0` |
| Toxicity | Toxicity Report | `#3D0A0A` | `#8B1A1A` | `#E04040` |
| Love Language | Love Language | `#3D1A2E` | `#8B3A5A` | `#F08EBF` |
| Growth | Growth Report | `#0A2E2E` | `#1A6B5A` | `#3AF0C0` |
| Accountability | Accountability | `#0A1A3D` | `#1A3A8B` | `#6AB4F0` |
| Energy | Energy Report | `#2E1A0A` | `#8B5A1A` | `#F0A040` |
| Trial / Paywall | — | `#1A0A3D` | `#2E1A6B` | `#A078F0` |

---

## Typography

### Typefaces

| Role | Family | Weights | Source |
|---|---|---|---|
| **Display** (logo, headings, stats) | **Nunito** | 700 · 800 · 900 | Google Fonts |
| **Body** (labels, body copy, buttons) | **Nunito Sans** | 400 · 500 · 600 · 700 | Google Fonts |

The logo wordmark uses Nunito 800.

### Type scale

| Element | Size | Weight | Letter-spacing | Notes |
|---|---|---|---|---|
| Logo wordmark | 44 px | 800 | −3 px | Nunito, line-height 1 |
| Display heading | 32 px | 900 | −0.025 em | Nunito, line-height 1.05 |
| Big stat | 46 px | 900 | −0.03 em | Nunito, centred |
| Score ring number | 32 px | 900 | — | Nunito |
| Body / subtitle | 14 px | 400 | — | Nunito Sans, line-height 1.55 |
| Button primary | 15–16 px | 700–800 | — | Nunito Sans |
| Button secondary | 14–15 px | 600–700 | — | Nunito Sans |
| Overline / CLabel | 11 px | 700 | 0.08–0.10 em | uppercase |
| Section pill badge | 11 px | 700 | 0.04 em | uppercase |
| Caption / meta | 11–13 px | 400–600 | — | |

---

## Visual Language

### Layout
- Mobile-first, max width **430 px**, full-screen cards
- Every result screen fills the viewport — no scrollable web page feel
- 3 px progress bar at the very top of each card (white, 75 % opacity fill)
- Section pill badge — top-left, pill-shaped, accent colour text on `accent + 20` tinted background

### Cards
- **ACard** (accent result card): `border-radius 24 px`, `border 1.5 px solid accent + 80` opacity, bg is the section's inner colour
- **DCard** (dark info card): `border-radius 20 px`, `background rgba(255,255,255,0.05)`, `border 1px solid rgba(255,255,255,0.10)`
- **Input fields**: `border-radius 16 px`, dark translucent bg `rgba(0,0,0,0.28)`

### Buttons
- **Primary**: full-width pill (`border-radius 999`), accent bg, section bg text, weight 800
- **Ghost / secondary**: pill, transparent bg, `border 1.5 px solid rgba(255,255,255,0.16)`
- **Hover state**: opacity 0.82, scale 0.98 — **Active state**: opacity 0.65, scale 0.95

### Decorative geometry
Background shapes on each result screen — floating, low-opacity, coloured with the section accent:
- Rounded square (sq-r) — `border-radius = size × 0.18`
- Circle — `border-radius 50%`
- Typical set: 90 px sq-r top-right (rotate 18°, 18–20 % opacity) · 60 px sq-r bottom-left (rotate −14°, 13–15 %) · 40 px circle bottom-right (10–12 %) · 130 px sq-r top-left off-screen (rotate 28°, 7 %)

### Loading mosaic spinner
Four 44 × 44 px rounded squares (border-radius 8 px) in a 2 × 2 grid, animated with staggered blink:
- Top-left: Amber `#F5A84C`
- Top-right: Teal `#3DC4BF`
- Bottom-left: Lime `#C2DC3A`
- Bottom-right: Blue `#6AAFD4`
- Centre overlay: 12 × 12 px dark square (bg colour) — creates a "gap" cross effect

---

## Motion & Animation

| Animation | Duration | Easing | Trigger |
|---|---|---|---|
| `fadeUp` (content reveal) | 380 ms | `cubic-bezier(.2,0,.1,1)` | Screen entry, staggered in 3 layers (+0 ms, +80 ms, +160 ms) |
| `slideR` / `slideL` (screen transition) | 260 ms | `cubic-bezier(.2,0,.1,1)` | Step navigation |
| Background colour cross-fade | 480 ms | `cubic-bezier(0.4,0,0.2,1)` | Section change |
| Progress bar fill | 400 ms | ease | Step advance |
| `blink` (loading dots) | 1.2–1.8 s loop | ease-in-out | Loading states |
| `toastIn` (bottom toast) | 300 ms | ease | Notifications |

---

## Products / Report Types

| ID | Display name | Pill label | Colour family |
|---|---|---|---|
| `general` | Chat Wrapped / General Wrapped | Wrapped | Deep purple |
| `toxicity` | Toxicity Report | Toxicity Report | Dark red |
| `lovelang` | Love Language Report | Love Language | Dusty rose |
| `growth` | Growth Report | Growth Report | Deep teal |
| `accounta` | Accountability Report | Accountability | Midnight blue |
| `energy` | Energy Report | Energy Report | Warm amber |

The **Chat Wrapped** (general) report also has inner section labels:

| Section | Pill |
|---|---|
| Roast cards | The Roast |
| Kindness / streaks | The Lovely |
| Emojis / words / phrases | The Funny |
| Stats / media | The Stats |
| AI insight cards | Insight |

---

## Relationship Icons

The upload flow asks who the chat is with. Each relationship type has a dedicated illustrated SVG icon:

`partner` · `friend` · `family` · `colleague` · `dating` · `ex` · `other`

---

## Localisation

The app ships in **8 languages**: English · Turkish · Spanish · Portuguese · Arabic · French · German · Italian. All UI strings including report names, taglines, and legal copy are translated.

---

## Platform & PWA

- **Display mode:** standalone (no browser chrome)
- **Theme colour:** `#0C1520`
- **Background colour:** `#0C1520`
- **Share target:** accepts WhatsApp export files (`.txt`, `.zip`) directly from the OS share sheet
- **iOS:** status bar transparent (`black-translucent`), content pushed below `env(safe-area-inset-top)`
- **Theme-color meta tag** syncs to the current section's palette background in real time
