// ─────────────────────────────────────────────────────────────────
// SHELL — layout backbone, colour palette, share utilities.
// All screens mount inside Shell.
// ─────────────────────────────────────────────────────────────────
import { useState, useLayoutEffect, useRef, createContext, useContext } from "react";
import { getDA, useTheme, WaveLines, setAppSafeAreaColor } from "../theme.jsx";
import html2canvas from "html2canvas";
import { wrapchatLogoTransparent } from "../BrandLockup";
import { REPORT_PACKS, REPORT_PACK_ORDER, CREDIT_BUNDLES } from "../reportCredits";
import { useT, UILanguageContext } from "../i18n/translations";
import cardShareIcon from "../../assets/card-share.svg";
import sumShareIcon from "../../assets/sum-share.svg";

// ── Contexts ──
export const CloseResultsContext   = createContext(null);
export const ShareResultsContext   = createContext(null);
export const FeedbackContext       = createContext(null);
export const SlideContext          = createContext({ dir: "fwd", id: 0, animateIn: false });
export const SectionPaletteContext = createContext(null);
// True when the current Shell section renders the theme background (cream in
// light mode) instead of a fixed dark report palette — text must follow da.*.
export const ThemedSurfaceContext  = createContext(false);

// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES  — bold rounded-card aesthetic
// ─────────────────────────────────────────────────────────────────

// Category accent colors — used for inner cards
export const PAL = {
  roast:    { bg:"#B83A10", inner:"#E8592A", text:"#fff", accent:"#FF8B6A" },
  lovely:   { bg:"#7A1C48", inner:"#A02860", text:"#fff", accent:"#F08EBF" },
  funny:    { bg:"#4A6A04", inner:"#6E9A08", text:"#fff", accent:"#C8F06A" },
  stats:    { bg:"#083870", inner:"#0E5AAA", text:"#fff", accent:"#6AB4F0" },
  ai:       { bg:"#1A3060", inner:"#2A4A90", text:"#fff", accent:"#8AACF0" },
  finale:   { bg:"#5E1228", inner:"#8A1C3C", text:"#fff", accent:"#F08EBF" },
  upload:   { bg:"#1f184e", inner:"#1A1E72", text:"#fff", accent:"#7A90FF" },
  general:  { bg:"#1C0E5A", inner:"#361A96", text:"#fff", accent:"#9B72FF" },
  toxicity: { bg:"#3A0808", inner:"#8A1A1A", text:"#fff", accent:"#FF3C40" },
  lovelang: { bg:"#3D1A2E", inner:"#8B3A5A", text:"#fff", accent:"#FF82B8" },
  growth:   { bg:"#0A2E2E", inner:"#1A6B5A", text:"#fff", accent:"#28EAA8" },
  accounta: { bg:"#0A1A3D", inner:"#1A3A8B", text:"#fff", accent:"#5AADFF" },
  energy:   { bg:"#2E1A0A", inner:"#8B5A1A", text:"#fff", accent:"#FFA030" },
  trial:    { bg:"#0C0D30", inner:"#1A1E72", text:"#fff", accent:"#7A90FF" },
};

export const PILL_LABEL = {
  roast:"The Roast", lovely:"The Lovely", funny:"The Funny", stats:"The Stats", ai:"Insight", finale:"WrapChat",
  toxicity:"Toxicity Report", lovelang:"Love Language", growth:"Growth Report", accounta:"Accountability", energy:"Energy Report",
  trial:"Quick Read",
};

export function getReportLaunchSec(reportType) {
  if (reportType === "general") return "roast";
  if (reportType === "trial_report") return "trial";
  return REPORT_TYPES.find(r => r.id === reportType)?.palette || "upload";
}

export function getReportLaunchBg(reportType) {
  return (PAL[getReportLaunchSec(reportType)] || PAL.upload).bg;
}

export function prepaintReportLaunchSurface(reportType) {
  const bg = getReportLaunchBg(reportType);
  setAppSafeAreaColor(bg);
  if (typeof document === "undefined") return;
  const wcRoot = document.querySelector(".wc-root");
  if (!wcRoot) return;
  wcRoot.style.background = bg;
  const coverDiv = wcRoot.firstElementChild;
  if (coverDiv?.hasAttribute("data-share-hide")) coverDiv.style.background = bg;
}



export function canShareFiles(files) {
  if (!navigator?.share || !files?.length) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't create share image."));
    }, "image/png");
  });
}

export function getShareCaptureHeight(el) {
  const rect = el.getBoundingClientRect();
  const panes = Array.from(el.querySelectorAll(".wc-pane"));
  const paneHeight = panes.reduce((max, pane) => Math.max(max, pane.scrollHeight || 0), 0);
  const natural = Math.max(rect.height || 0, el.scrollHeight || 0);
  // Capture the card exactly as seen — the logo overlays the existing waves,
  // never a padded strip below them. Extend the canvas only when the pane
  // content genuinely overflows the card (scrollable cards).
  return Math.ceil(paneHeight > natural + 8 ? paneHeight + 60 : natural);
}

export async function waitForShareAssets(el) {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Continue: default fonts are better than a failed share.
    }
  }
  const images = Array.from(el.querySelectorAll("img"));
  await Promise.all(images.map(async img => {
    if (img.complete && img.naturalWidth) return;
    if (typeof img.decode === "function") {
      try {
        await img.decode();
        return;
      } catch {
        // Fall back to load/error listeners below.
      }
    }
    await new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }));
}

export async function buildTintedShareLogoMarkup(logoSrc, accentColor) {
  if (!logoSrc) return "";
  try {
    const response = await fetch(logoSrc);
    if (!response.ok) return "";
    const svgText = await response.text();
    return svgText
      .replace(/#(?:7A90FF|6cb9e0)/gi, accentColor || "#7A90FF")
      .replace(/<\?xml[^>]*\?>\s*/i, "")
      .replace(/<svg\b/i, '<svg width="34" height="30"');
  } catch {
    return "";
  }
}

// Captures the active card or summary as a clean PNG.
// Targets the active card or hidden summary render, strips UI chrome, and adds a branded footer.
export async function buildShareCanvas(type, logoSrc) {
  const el = document.querySelector(`[data-share-capture="${type}"] .wc-root`)
    || document.querySelector(`[data-share-type="${type}"]`)
    || document.querySelector(".wc-root");
  if (!el) return null;
  await waitForShareAssets(el);

  const rect = el.getBoundingClientRect();
  const width = Math.ceil(rect.width || 420);
  const height = getShareCaptureHeight(el);
  const accentColor = el.dataset.shareAccent || "#7A90FF";
  const tintedLogoMarkup = await buildTintedShareLogoMarkup(logoSrc, accentColor);
  el.setAttribute("data-share-active", "true");

  try {
    return await html2canvas(el, {
      backgroundColor: null,
      scale: window.devicePixelRatio || 2,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll("[data-share-hide]").forEach(n => { n.style.display = "none"; });
        const root = clonedDoc.querySelector('[data-share-active="true"]');
        if (!root) return;

        const captureStyles = clonedDoc.createElement("style");
        captureStyles.textContent = `
          [data-share-active="true"],
          [data-share-active="true"] * {
            animation: none !important;
            transition: none !important;
          }
          [data-share-active="true"] .wc-fadeup,
          [data-share-active="true"] .wc-fadeup-2,
          [data-share-active="true"] .wc-fadeup-3,
          [data-share-active="true"] .wc-beat-1,
          [data-share-active="true"] .wc-beat-2,
          [data-share-active="true"] .wc-beat-3 {
            opacity: 1 !important;
            transform: none !important;
          }
          [data-share-active="true"] .wc-pane {
            opacity: 1 !important;
            visibility: visible !important;
          }
        `;
        clonedDoc.head.appendChild(captureStyles);

        Object.assign(root.style, {
          width: `${width}px`,
          height: `${height}px`,
          minHeight: `${height}px`,
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
          borderRadius: "32px",
          // Shared images get viewed full-screen: keep the pill clear of
          // camera cutouts instead of hugging the top edge.
          paddingTop: "56px",
        });

        root.querySelectorAll(".wc-body").forEach(body => {
          Object.assign(body.style, {
            flex: "1 1 auto",
            minHeight: "auto",
            height: "auto",
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          });
        });

        root.querySelectorAll(".wc-pane").forEach(pane => {
          Object.assign(pane.style, {
            position: "relative",
            inset: "auto",
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: "100%",
            height: "auto",
            overflow: "visible",
            transform: "none",
            animation: "none",
            transition: "none",
            willChange: "auto",
          });
        });

        // Logo overlays the waves at bottom center — no extra footer strip.
        if (tintedLogoMarkup) {
          const brand = clonedDoc.createElement("div");
          Object.assign(brand.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: "30",
          });
          const logoWrap = clonedDoc.createElement("div");
          logoWrap.innerHTML = tintedLogoMarkup;
          Object.assign(logoWrap.style, {
            width: "34px",
            height: "30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          });
          const svg = logoWrap.querySelector("svg");
          if (svg) {
            svg.setAttribute("aria-hidden", "true");
            Object.assign(svg.style, {
              display: "block",
              width: "34px",
              height: "30px",
            });
          }
          brand.appendChild(logoWrap);
          root.appendChild(brand);
        }
      },
    });
  } finally {
    el.removeAttribute("data-share-active");
  }
}

export function SharePicker({ open, busy, onCard, onSummary, onClose }) {
  if (!open) return null;
  const btnStyle = {
    flex: 1,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: "20px 0",
    color: "#fff",
    cursor: busy ? "wait" : "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  };
  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}
      onClick={onClose}
    >
      <div
        style={{ width:"min(420px,100%)", background:"#111118", border:"1px solid rgba(255,255,255,0.10)", borderRadius:"28px 28px 0 0", padding:"10px 20px 32px", boxShadow:"0 -20px 60px rgba(0,0,0,0.5)", color:"#fff" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width:36, height:4, borderRadius:999, background:"rgba(255,255,255,0.14)", margin:"0 auto 20px" }} />
        <div style={{ fontSize:18, fontWeight:800, letterSpacing:-0.5, marginBottom:16 }}>Share</div>
        <div style={{ display:"flex", gap:12 }}>
          <button className="wc-btn" onClick={onCard} disabled={busy} style={btnStyle}>
            <img src={cardShareIcon} alt="" aria-hidden="true" style={{ width:32, height:32, objectFit:"contain", filter:"brightness(0) invert(1)", opacity: busy ? 0.4 : 0.9 }} />
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Card"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Current screen</span>
          </button>
          <button className="wc-btn" onClick={onSummary} disabled={busy} style={btnStyle}>
            <img src={sumShareIcon} alt="" aria-hidden="true" style={{ width:32, height:32, objectFit:"contain", filter:"brightness(0) invert(1)", opacity: busy ? 0.4 : 0.9 }} />
            <span style={{ fontSize:14, fontWeight:700 }}>{busy ? "Saving…" : "Summary"}</span>
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>Results overview</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Converts AI health score (1–10, higher = healthier) to a display label.
// Prefer this over local math toxicityLevel whenever AI data is available.
export function chatHealthLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return n >= 7 ? "Healthy" : n >= 4 ? "Tense" : "Heated";
}

// ─────────────────────────────────────────────────────────────────
// REPORT TYPES — shown on the report selection screen
// ─────────────────────────────────────────────────────────────────
export const REPORT_TYPES = [
  { id:"general",      label:"General Wrapped",       desc:"The full Wrapped-style deep dive — stats, AI insights, and your chat personality.",         palette:"general"  },
  { id:"toxicity",     label:"Toxicity Report",        desc:"Red flags, power imbalances, who apologises more, conflict patterns, health scores.",        palette:"toxicity" },
  { id:"lovelang",     label:"Love Language Report",   desc:"How each person shows affection, mapped to the 5 love languages. Works for friends too.",   palette:"lovelang" },
  { id:"growth",       label:"Growth Report",          desc:"First 3 months vs last 3 months — are you growing together or drifting apart?",             palette:"growth"   },
  { id:"accounta",     label:"Accountability Report",  desc:"Promises made in the chat and whether they were followed through. Receipts for both.",       palette:"accounta" },
  { id:"energy",       label:"Energy Report",          desc:"Who brings good energy vs drains it — net energy score per person.",                         palette:"energy"   },
  { id:"trial_report", label:"Quick Read",             desc:"A quick onboarding gift — vibe, communication pattern, and one key insight.",             palette:"trial"    },
];

// Pack color palette — 3 shades per type:
//   shade1 (darkest base/card bg), shade2 (mid selected bg), shade3 (vivid accent)
// vibe:   #1a0e40 / #3d2480 / #7f5bb0  — Purple
// rf:     #220814 / #5a1228 / #bc2343  — Red
// full:   #1e1200 / #6e4a00 / #cf970c  — Yellow
// growth: #0a2210 / #1e6428 / #48bc3e  — Green
export const PACK_DEFS = Object.freeze({
  vibe: Object.freeze({
    id: "vibe",
    bundleId: "connection",
    name: "Vibe Pack",
    overline: "analysis",
    desc: "How you two actually connect — your communication style, love language, and the energy you bring each other.",
    reports: Object.freeze(["general", "lovelang", "energy"]),
    tags: Object.freeze(["General Wrapped", "Love Language", "Energy"]),
    cost: REPORT_PACKS.vibe.cost,
    bg: "#261658",
    cardBg: "#1a0e40",
    listBg: "#3d2480",
    accent: "#a070d0",
    listAccent: "#a070d0",
    fg: "#f0e8ff",
    inner: "#1a0e40",
    paymentSelectedBg: "#3d2480",
    paymentSelectedBorder: "rgba(var(--wc-p),0.70)",
    paymentMutedBg: "#2b1960",
    paymentMutedBorder: "rgba(var(--wc-p),0.35)",
  }),
  rf: Object.freeze({
    id: "rf",
    bundleId: "tension",
    name: "Red Flags Pack",
    desc: "What's actually happening under the surface — tension patterns, accountability gaps, and the hard stuff.",
    reports: Object.freeze(["toxicity", "accounta"]),
    tags: Object.freeze(["Toxicity", "Accountability"]),
    cost: REPORT_PACKS.rf.cost,
    bg: "#3e0c20",
    cardBg: "#220814",
    listBg: "#5a1228",
    accent: "#e04060",
    listAccent: "#e04060",
    fg: "#fff",
    inner: "#220814",
    paymentSelectedBg: "#5a1228",
    paymentSelectedBorder: "rgba(188,35,67,0.70)",
    paymentMutedBg: "#3c0d1e",
    paymentMutedBorder: "rgba(188,35,67,0.35)",
  }),
  full: Object.freeze({
    id: "full",
    bundleId: "full",
    name: "Full Read",
    desc: "Every report in one go — connection, tension, and growth. The complete picture of this chat.",
    reports: Object.freeze(["general", "lovelang", "energy", "toxicity", "accounta", "growth"]),
    tags: Object.freeze(["Vibe Pack", "Red Flags", "Growth"]),
    cost: REPORT_PACKS.full.cost,
    bg: "#3e2800",
    cardBg: "#1e1200",
    listBg: "#6e4a00",
    accent: "#e8a820",
    listAccent: "#e8a820",
    fg: "#160c00",
    inner: "#1e1200",
    paymentSelectedBg: "#6e4a00",
    paymentSelectedBorder: "rgba(207,151,12,0.70)",
    paymentMutedBg: "#462e00",
    paymentMutedBorder: "rgba(207,151,12,0.35)",
  }),
  growth: Object.freeze({
    id: "growth",
    bundleId: null,
    name: "Growth Read",
    desc: "Standalone temporal analysis — how this chat has changed from early days to now.",
    reports: Object.freeze(["growth"]),
    tags: Object.freeze(["Growth"]),
    cost: REPORT_PACKS.growth.cost,
    bg: "#0e3018",
    cardBg: "#0a2210",
    listBg: "#1e6428",
    accent: "#5ed454",
    listAccent: "#5ed454",
    fg: "#062010",
    inner: "#0a2210",
    paymentSelectedBg: "#1e6428",
    paymentSelectedBorder: "rgba(72,188,62,0.70)",
    paymentMutedBg: "#14431c",
    paymentMutedBorder: "rgba(72,188,62,0.33)",
  }),
});

export const PACK_ORDER = REPORT_PACK_ORDER;

// CSS filters to shift the coin SVG (base hue ~271° purple) to each pack's accent color.
export const PACK_COIN_FILTER = Object.freeze({
  vibe:   "hue-rotate(-20deg) brightness(1.1) saturate(1.2)",  // purple #a070d0
  rf:     "hue-rotate(68deg) brightness(0.72) saturate(1.5)",  // red #e04060
  full:   "hue-rotate(136deg) brightness(0.80) saturate(1.2)", // amber #e8a820
  growth: "hue-rotate(228deg) brightness(0.80) saturate(1.1)", // green #5ed454
});

export const REPORT_BUFFER_STYLE = Object.freeze({
  general:  { bg:"#1C0E5A", border:"rgba(155,114,255,0.40)", pillBg:"rgba(155,114,255,0.14)", pillBorder:"rgba(155,114,255,0.32)" },
  lovelang: { bg:"#3D1A2E", border:"rgba(255,130,184,0.38)", pillBg:"rgba(255,130,184,0.14)", pillBorder:"rgba(255,130,184,0.30)" },
  energy:   { bg:"#2E1A0A", border:"rgba(255,160,48,0.35)",  pillBg:"rgba(255,160,48,0.14)",  pillBorder:"rgba(255,160,48,0.28)" },
  toxicity: { bg:"#3A0808", border:"rgba(255,60,64,0.38)",   pillBg:"rgba(255,60,64,0.14)",   pillBorder:"rgba(255,60,64,0.30)" },
  accounta: { bg:"#0A1A3D", border:"rgba(90,173,255,0.35)",  pillBg:"rgba(90,173,255,0.14)",  pillBorder:"rgba(90,173,255,0.28)" },
  growth:   { bg:"#0A2E2E", border:"rgba(40,234,168,0.32)",  pillBg:"rgba(40,234,168,0.14)",  pillBorder:"rgba(40,234,168,0.28)" },
});

export const REPORT_BUFFER_STYLE_LIGHT = Object.freeze({
  general:  { bg:"rgba(155,114,255,0.08)", border:"rgba(155,114,255,0.30)", pillBg:"rgba(155,114,255,0.12)", pillBorder:"rgba(155,114,255,0.28)" },
  lovelang: { bg:"rgba(255,130,184,0.08)", border:"rgba(255,130,184,0.30)", pillBg:"rgba(255,130,184,0.12)", pillBorder:"rgba(255,130,184,0.28)" },
  energy:   { bg:"rgba(255,160,48,0.08)",  border:"rgba(255,160,48,0.28)",  pillBg:"rgba(255,160,48,0.12)",  pillBorder:"rgba(255,160,48,0.24)" },
  toxicity: { bg:"rgba(255,60,64,0.07)",   border:"rgba(255,60,64,0.28)",   pillBg:"rgba(255,60,64,0.10)",   pillBorder:"rgba(255,60,64,0.26)" },
  accounta: { bg:"rgba(90,173,255,0.08)",  border:"rgba(90,173,255,0.28)",  pillBg:"rgba(90,173,255,0.12)",  pillBorder:"rgba(90,173,255,0.24)" },
  growth:   { bg:"rgba(40,234,168,0.08)",  border:"rgba(40,234,168,0.26)",  pillBg:"rgba(40,234,168,0.12)",  pillBorder:"rgba(40,234,168,0.22)" },
});

export function reportTypeMeta(type) {
  return REPORT_TYPES.find(report => report.id === type) || { id:type, label:type, palette:"upload" };
}

export function packForReports(types = []) {
  const set = new Set((Array.isArray(types) ? types : [types]).filter(Boolean));
  return PACK_ORDER.map(id => PACK_DEFS[id]).find(pack =>
    pack.reports.length === set.size && pack.reports.every(type => set.has(type))
  ) || null;
}

export function packForSavedRows(rows = []) {
  const types = rows.map(row => row.report_type).filter(Boolean);
  return packForReports(types) || (types.length === 1 && types[0] === "growth" ? PACK_DEFS.growth : null);
}

export const CREDIT_PACKS = CREDIT_BUNDLES;

export function normalizeSelectedReportTypes(types) {
  const selected = new Set(Array.isArray(types) ? types : []);
  return REPORT_TYPES.map(report => report.id).filter(id => selected.has(id));
}

export const LEGAL_VERSION = "1.1";

// ─── Legal document text — rendered inline, no external links ───
// Replace the placeholder strings below with the full text from your PDFs.
export const TERMS_OF_SERVICE_TEXT = `TERMS OF SERVICE
Version 1.1 — Last updated 2025

PLEASE READ THESE TERMS CAREFULLY BEFORE USING WRAPCHAT.

1. ACCEPTANCE OF TERMS
By accessing or using WrapChat ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

2. DESCRIPTION OF SERVICE
WrapChat is a chat analysis tool that processes chat exports you provide. The Service uses AI to generate reports about communication patterns, relationship dynamics, and related insights from the text you upload.

3. ELIGIBILITY
You must be at least 18 years old to use the Service. By using the Service, you represent that you are at least 18 years of age.

4. YOUR CONTENT
You retain ownership of any chat data you upload. By uploading a chat export, you grant WrapChat a limited licence to process that data for the sole purpose of generating your requested reports. Chat content is analysed in transit and is not stored on our servers beyond what is necessary to produce your results.

5. CONSENT AND THIRD PARTIES
You are responsible for ensuring you have the right to upload any conversation. You should only upload chats in which you are a participant. You must not upload chats belonging to other people without their knowledge and consent. WrapChat is not responsible for any claims arising from your use of third-party data.

6. PROHIBITED USES
You agree not to use the Service to:
- Upload content belonging to others without consent
- Circumvent security or access controls
- Reverse-engineer, copy, or reproduce any part of the Service
- Use the Service for any unlawful purpose
- Attempt to gain unauthorised access to any system or network

7. INTELLECTUAL PROPERTY
All intellectual property rights in the Service, including but not limited to its software, design, and methodology, are owned by WrapChat. Nothing in these Terms grants you any rights in the Service other than the right to use it as expressly set out herein.

8. DISCLAIMER OF WARRANTIES
The Service is provided "as is" and "as available" without any warranties of any kind, express or implied. WrapChat does not warrant that the Service will be uninterrupted, error-free, or that any results generated will be accurate, complete, or reliable.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, WrapChat shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service.

10. CHANGES TO TERMS
WrapChat reserves the right to modify these Terms at any time. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms. Material changes will require explicit re-acceptance.

11. GOVERNING LAW
These Terms shall be governed by and construed in accordance with applicable law. Any disputes shall be resolved through binding arbitration or in the courts of the applicable jurisdiction.

12. CONTACT
For questions about these Terms, contact us at support@wrapchat.app.

By accepting these Terms, you confirm you have read and understood them in full.`;

export const PRIVACY_POLICY_TEXT = `PRIVACY POLICY
Version 1.1 — Last updated 2025

This Privacy Policy explains how WrapChat ("we", "us", "our") collects, uses, and protects your information when you use our Service.

1. INFORMATION WE COLLECT

Account Information
When you create an account, we collect your email address, a hashed version of your password, and the display name you provide so we can identify you correctly in uploaded chat exports.

Chat Data
You upload chat exports to generate reports. These chat exports contain messages written by you and other participants. Chat content is transmitted securely and processed solely to generate your requested analysis. Chat text is not stored on our servers after processing is complete.

Usage Data
We may collect anonymised information about how you use the Service, including which report types you generate and general usage patterns. This data cannot be used to identify you and is used only to improve the Service.

Results Data
The reports generated from your analysis (not the underlying chat text) may be stored on your account so you can access them later. You can delete your saved results at any time.

2. HOW WE USE YOUR INFORMATION

We use your information to:
- Provide and operate the Service
- Generate the analysis reports you request
- Maintain and improve the Service
- Communicate with you about your account
- Comply with legal obligations

We do not sell, rent, or share your personal information with third parties for marketing purposes.

3. AI PROCESSING
Your chat content is processed by AI models to generate insights. Excerpts of your chat may be sent to a third-party AI provider (Anthropic) as part of this processing. Anthropic's use of this data is governed by their API usage policies and privacy practices. Chat content processed through the AI pipeline is not used to train AI models under our current agreements.

4. DATA RETENTION
Account data is retained while your account is active. Processed chat content is not retained after your report is generated. Saved report results are retained until you delete them or close your account.

5. DATA SECURITY
We implement industry-standard security measures to protect your data, including encryption in transit (TLS) and at rest. No method of transmission over the internet is 100% secure. We cannot guarantee absolute security but will notify you promptly in the event of a breach affecting your data.

6. YOUR RIGHTS
Depending on your location, you may have rights including:
- Access to the personal data we hold about you
- Correction of inaccurate data
- Deletion of your account and associated data
- Portability of your data in a machine-readable format
- Withdrawal of consent at any time

To exercise these rights, contact us at privacy@wrapchat.app.

7. COOKIES AND TRACKING
The Service uses essential cookies required for authentication and session management. We do not use tracking or advertising cookies.

8. CHILDREN'S PRIVACY
The Service is not directed to individuals under 18. We do not knowingly collect personal information from anyone under 18. If you believe we have inadvertently collected such information, contact us immediately.

9. CHANGES TO THIS POLICY
We may update this Privacy Policy periodically. We will notify you of material changes by requiring re-acceptance within the app. The version number and date at the top of this document will always reflect the most recent update.

10. CONTACT
For privacy-related questions or to exercise your rights:
Email: privacy@wrapchat.app

By accepting this Privacy Policy, you confirm you have read and understood it in full.`;

export const SLIDE_MS   = 480;
export const SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
// Reveal choreography — after the pane slide settles (SLIDE_MS), card content
// arrives in beats via .wc-beat-1/2/3: headline value first (with a subtle
// scale pop), payload card second, footnote last. Beat offsets scale with the
// section's emotional tempo: roast/funny snap, lovely lingers, everything
// else is neutral. Restrained sections drop the pop entirely (pure fades) —
// a red-flag reveal should never feel like a prize.
export const SECTION_TEMPO = { roast: 0.85, funny: 0.85, lovely: 1.15 };
export const RESTRAINED_SECS = new Set(["toxicity"]);
export const SHELL_SAFE_TOP = "max(20px, env(safe-area-inset-top, 0px))";
export const SHELL_PANE_PADDING = "16px 20px calc(24px + env(safe-area-inset-bottom, 0px))";
// Matches the full Shell's content top (root safe-area + pane's 16px top) so
// the My Results drawer and the full "history" phase sit at the same height —
// otherwise returning to My Results via one path shifts the page vs. the other.
export const SHELL_DRAWER_PADDING = `calc(${SHELL_SAFE_TOP} + 16px) 20px 0`;
export const SCREEN_HEADER_CONTROL_TOP = "36px";
export const SCREEN_CONTENT_STYLE = {
  alignSelf:"stretch",
  flex:1,
  display:"flex",
  flexDirection:"column",
  minHeight:0,
};
export const SCREEN_HEADER_BLOCK_STYLE = {
  flexShrink:0,
  marginBottom:12,
};
// Scrollable page body that lives BELOW a pinned header: the header stays
// put and content scrolls under it (the My Results structure, now the
// contract for every headered page).
export const SCREEN_BODY_SCROLL_STYLE = {
  flex:1,
  minHeight:0,
  overflowY:"auto",
  overscrollBehavior:"contain",
  display:"flex",
  flexDirection:"column",
  paddingBottom:"calc(24px + env(safe-area-inset-bottom, 0px))",
};
// Pins a header row to the top of a scrolling page. pullTop 16 bleeds over
// the Shell pane's top padding (the header is a direct child of the pane and
// the pane itself scrolls) so the frosted bar reaches the very top edge and
// stays glued there; the matching negative `top` keeps it stuck while content
// scrolls under. pullTop 0 is for pages with their own paddingTop:0 wrapper.
// alpha < 1 lets content scrolling under the header show through faintly;
// blur (px) frosts whatever shows through so it reads as a glow, not text.
export function getStickyHeaderStyle(isLight, { pullTop = 16, alpha = 1, blur = 0 } = {}) {
  return {
    position:"sticky",
    top:0,
    zIndex:20,
    background: isLight ? `rgba(237,232,220,${alpha})` : `rgba(31,24,78,${alpha})`,
    ...(blur > 0 ? {
      backdropFilter:`blur(${blur}px)`,
      WebkitBackdropFilter:`blur(${blur}px)`,
    } : {}),
    margin:`${-pullTop}px -20px 12px`,
    padding:"16px 20px 10px",
  };
}

export const THEME_BG_SECTIONS = new Set(["upload", "trial"]);

export function Shell({ sec, prog, total, children, feedback=null, shareType="card", scrollable=true, contentAlign="center", hidePill=false, palette=null, hideChromeButtons=false, hideProgressBar=false, forceWaves=false, snapScroll=false }) {
  const p = palette || PAL[sec] || PAL.upload;
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const onClose = useContext(CloseResultsContext);
  const share = useContext(ShareResultsContext);
  const feedbackApi = useContext(FeedbackContext);
  const { dir, id, animateIn } = useContext(SlideContext);
  const t = useT();

  // Content-only slide animation — chrome (bg, bar, pill, X) stays perfectly still.
  const prevContentRef = useRef(null);
  const [isEntering, setIsEntering] = useState(() => Boolean(animateIn));
  const prevIdRef      = useRef(id);
  const rootRef        = useRef(null);
  const paneRef        = useRef(null);
  const [exitContent, setExitContent] = useState(null);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      paneRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      // iOS sometimes leaves the WINDOW scrolled (rubber-band / input focus),
      // which shifts the whole app up under the status bar and stays stuck.
      if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    });
    if (id !== prevIdRef.current) {
      setExitContent({ node: prevContentRef.current, dir });
      prevIdRef.current = id;
      const t = setTimeout(() => {
        setExitContent(null);
        paneRef.current?.style.removeProperty('--wc-enter-from');
      }, SLIDE_MS);
      return () => clearTimeout(t);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!animateIn) return;
    const t = setTimeout(() => setIsEntering(false), SLIDE_MS + 50);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shellBg = (isLight && THEME_BG_SECTIONS.has(sec)) ? da.bg : p.bg;

  useLayoutEffect(() => {
    if (rootRef.current?.closest('[data-share-capture="summary"]')) return;
    setAppSafeAreaColor(shellBg);
  });

  prevContentRef.current = children;

  const isFade = dir === "fade";
  const enterFrom = dir === "fwd" ? "100%"  : "-100%";
  const exitTo    = dir === "fwd" ? "-100%" : "100%";
  const paneJustify = contentAlign === "start" ? "flex-start" : "safe center";
  const rootPaddingTop = snapScroll ? 0 : SHELL_SAFE_TOP;
  const panePadding = snapScroll ? 0 : SHELL_PANE_PADDING;
  const paneGap = snapScroll ? 0 : 10;

  return (
    <SectionPaletteContext.Provider value={p}>
    <ThemedSurfaceContext.Provider value={THEME_BG_SECTIONS.has(sec)}>
    <>
      <style>{`
        .wc-root * { box-sizing: border-box; }
        @keyframes blink { 0%,80%,100%{opacity:.15} 40%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .wc-fadeup   { animation: fadeUp 0.4s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-2 { animation: fadeUp 0.4s 0.07s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-3 { animation: fadeUp 0.4s 0.14s cubic-bezier(.2,0,.1,1) both; }
        @keyframes wcBeatIn  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes wcBeatPop { from{opacity:0;transform:translateY(8px) scale(0.94)} to{opacity:1;transform:translateY(0) scale(1)} }
        .wc-beat-1, .wc-beat-2, .wc-beat-3 { animation-name:wcBeatIn; animation-duration:420ms; animation-timing-function:cubic-bezier(.2,0,.1,1); animation-fill-mode:both; }
        .wc-beat-1 { animation-name:var(--wc-pop, wcBeatPop); animation-delay:calc(${SLIDE_MS}ms + 80ms*var(--wc-tempo, 1)); }
        .wc-beat-2 { animation-delay:calc(${SLIDE_MS}ms + 360ms*var(--wc-tempo, 1)); }
        .wc-beat-3 { animation-delay:calc(${SLIDE_MS}ms + 640ms*var(--wc-tempo, 1)); }
        /* Content revealed by interaction (GuessCard): the slide settled long
           ago, so beats compress — payoff stays immediate. */
        .wc-reveal-now .wc-beat-1 { animation-delay:120ms; }
        .wc-reveal-now .wc-beat-2 { animation-delay:260ms !important; }
        .wc-reveal-now .wc-beat-3 { animation-delay:400ms; }
        .wc-btn:hover { opacity:0.82; transform:scale(0.98); }
        .wc-exit-pane [data-nav-row="true"] { visibility:hidden; }
        .wc-exit-pane .wc-fadeup, .wc-exit-pane .wc-fadeup-2, .wc-exit-pane .wc-fadeup-3,
        .wc-exit-pane .wc-beat-1, .wc-exit-pane .wc-beat-2, .wc-exit-pane .wc-beat-3 { animation:none !important; opacity:1; transform:none; }
        .wc-pane:has(> [data-nav-row="true"]) > :first-child { margin-top:auto; }
        .wc-snap-scroll { scrollbar-width:none; -ms-overflow-style:none; }
        .wc-snap-scroll::-webkit-scrollbar { width:0; height:0; display:none; }
        @media (max-width: 430px) { .wc-root { border-radius: 0 !important; } }
        @keyframes wcContentIn {
          from { transform: translateX(var(--wc-enter-from)); }
          to   { transform: translateX(0); }
        }
        @keyframes wcFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes wcFadeScaleIn {
          from { opacity: 0; transform: scale(0.93); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes wcStaggerItemIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes wcAuthFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes wcAuthFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes wcWaveLayerIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wc-fade-scale { animation-name: wcFadeIn !important; animation-duration: 150ms !important; }
          .wc-stagger-item { animation-name: wcFadeIn !important; animation-duration: 150ms !important; }
          .wc-beat-1, .wc-beat-2, .wc-beat-3 { animation-name: wcFadeIn !important; animation-duration: 150ms !important; animation-delay: 0ms !important; }
          .wc-auth-fade { animation-duration: 120ms !important; animation-delay: 0ms !important; }
          .wc-segmented-indicator { transition-duration: 0.01ms !important; }
          .wc-wave-layer { animation-duration: 0.01ms !important; animation-delay: 0ms !important; }
        }
      `}</style>
      <div ref={rootRef} className="wc-root" data-share-type={shareType} data-share-accent={p.accent} style={{
        ["--wc-tempo"]: SECTION_TEMPO[sec] ?? 1,
        ["--wc-pop"]: RESTRAINED_SECS.has(sec) ? "wcBeatIn" : "wcBeatPop",
        width: "min(420px, 100vw)",
        height: "100svh",
        margin: "0 auto",
        background: shellBg,
        borderRadius: 32,
        overflow: "hidden",
        position: "relative",
        isolation: "isolate",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
        paddingTop: rootPaddingTop,
      }}>
        <div data-share-hide style={{ position:"absolute", top:0, left:0, right:0, height:rootPaddingTop, background:shellBg, zIndex:4, pointerEvents:"none" }} />
        {/* ── WAVE LINES — result screens + explicitly flagged screens only ── */}
        {(forceWaves || sec !== "upload") && <WaveLines accent={p.accent} intro={forceWaves && sec === "upload"} />}

        {/* ── STATIC CHROME — never moves ── */}
        {/* Thin progress bar at very top */}
        {!hideProgressBar && total > 0 && (
        <div data-share-hide style={{ position:"absolute", top:0, left:0, right:0, height:3, background: isLight && THEME_BG_SECTIONS.has(sec) ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)", zIndex:5 }}>
          <div style={{ height:"100%", background: isLight && THEME_BG_SECTIONS.has(sec) ? "rgba(31,24,78,0.6)" : "rgba(255,255,255,0.75)", borderRadius:"0 2px 2px 0", width:`${Math.round((prog/total)*100)}%`, transition:"width 0.4s" }} />
        </div>
        )}
        {!hideChromeButtons && share?.onShare && (
          <button
            data-share-hide
            onClick={share.onShare}
            className="wc-btn"
            aria-label={t("Share")}
            disabled={share.busy}
            style={{
              position:"absolute",
              top:`calc(14px + ${SHELL_SAFE_TOP})`, left:14,
              minWidth:66, height:30,
              borderRadius:999,
              border:"none",
              background:"rgba(255,255,255,0.12)",
              color:"#fff",
              fontSize:12, lineHeight:1,
              cursor:share.busy ? "wait" : "pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              zIndex:10,
              padding:"0 12px",
              transition:"all 0.15s",
              fontWeight:700,
              letterSpacing:"0.04em",
              opacity:share.busy ? 0.7 : 1,
            }}
          >
            {share.busy ? "Saving…" : t("Share")}
          </button>
        )}
        {feedback?.resultId && feedbackApi?.openFeedback && (
          <div data-share-hide style={{ position:"absolute", top:`calc(14px + ${SHELL_SAFE_TOP})`, right:onClose ? 54 : 14, zIndex:11 }}>
            <FeedbackButton onClick={() => feedbackApi.openFeedback(feedback)} />
          </div>
        )}
        {/* Close button */}
        {!hideChromeButtons && onClose && (
          <button
            data-share-hide
            onClick={onClose}
            className="wc-btn"
            aria-label="Close results"
            style={{
              position: "absolute",
              top: `calc(14px + ${SHELL_SAFE_TOP})`, right: 14,
              width: 30, height: 30,
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 15, lineHeight: 1,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 10, padding: 0,
              transition: "all 0.15s",
            }}
          >✕</button>
        )}
        {/* Pill label */}
        {!hidePill && PILL_LABEL[sec] && (
          <div style={{ paddingTop:14, display:"flex", justifyContent:"center", position:"relative", zIndex:4 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", color:p.accent, background:`${p.accent}20`, border:`1px solid ${p.accent}50`, padding:"4px 12px", borderRadius:999 }}>
              {t(PILL_LABEL[sec])}
            </div>
          </div>
        )}

        {/* ── SLIDING CONTENT AREA ── */}
        <div className="wc-body" style={{ flex:1, minHeight:0, position:"relative", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {/* Outgoing content */}
          {exitContent && (
            <div data-share-hide className="wc-pane wc-exit-pane" style={{
              position:"absolute", inset:0,
              display:"flex", flexDirection:"column", alignItems:"stretch", justifyContent:paneJustify,
              padding:panePadding, gap:paneGap,
              transform:isFade ? "none" : `translateX(${exitTo})`,
              opacity:isFade ? 0 : 1,
              transition:isFade ? `opacity 180ms ${SLIDE_EASE}` : `transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
              willChange:isFade ? "opacity" : "transform",
              pointerEvents:"none",
              overflowY:scrollable ? "auto" : "hidden",
            }}>
              {exitContent.node}
            </div>
          )}
          {/* Incoming content */}
          <div ref={paneRef} className={`wc-pane${snapScroll ? " wc-snap-scroll" : ""}`} style={{
            position: exitContent ? "absolute" : "relative",
            inset: exitContent ? 0 : "auto",
            flex: exitContent ? "none" : 1,
            display:"flex", flexDirection:"column", alignItems:"stretch", justifyContent:paneJustify,
            width:"100%",
            minHeight:0,
            padding:panePadding, gap:paneGap,
            animation: exitContent
              ? (isFade ? `wcFadeIn 220ms ${SLIDE_EASE} both` : `wcContentIn ${SLIDE_MS}ms ${SLIDE_EASE} both`)
              : isEntering ? `wcContentIn ${SLIDE_MS}ms ${SLIDE_EASE} both` : "none",
            ["--wc-enter-from"]: enterFrom,
            willChange: exitContent ? (isFade ? "opacity, transform" : "transform") : "auto",
            overflowY:scrollable ? "auto" : "hidden",
            scrollSnapType:snapScroll ? "y mandatory" : "none",
            scrollBehavior:snapScroll ? "smooth" : "auto",
            overscrollBehavior:"contain",
          }}>
            {children}
          </div>
        </div>
      </div>
    </>
    </ThemedSurfaceContext.Provider>
    </SectionPaletteContext.Provider>
  );
}

export function FeedbackButton({ onClick }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="wc-btn"
      aria-label={t("What's off about this?")}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "all 0.15s",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" style={{ display:"block" }}>
        <path d="M4 21V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M4 4h11l-3 5 3 5H4" fill="rgba(255,255,255,0.15)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

export function GearIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6.9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// GUESS CARD — Guess Before Reveal interactive mechanic.
//
// Two phases:
//   "guess"    — question + tappable option buttons
//   "revealed" — full reveal content fades in
//
// When confidenceValid is false the guess phase is skipped entirely
// and revealContent renders directly (flat mode, no fake drama).
// ─────────────────────────────────────────────────────────────────
export function GuessCard({ question, options = [], correctAnswer, revealContent, confidenceValid = true, onReveal, back, next: nextFn }) {
  const p = useContext(SectionPaletteContext) || PAL.upload;
  const [picked, setPicked] = useState(null);
  const [phase, setPhase] = useState("guess");

  // Shared nav button styles — inlined since GhostButton/PrimaryButton live in theme.jsx
  // marginTop:auto pins the row to the pane bottom (the pane's :has() rule
  // adds the matching top counterweight so content stays centered above it).
  const navRow  = { display:"flex", gap:10, marginTop:"auto", paddingTop:8, paddingBottom:10, width:"100%" };
  const backBtn = { flex:1, padding:"13px 18px", borderRadius:999, background:"rgba(255,255,255,0.07)", border:"1.5px solid rgba(255,255,255,0.14)", color:"rgba(255,255,255,0.72)", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" };
  const nextBtn = { flex:1, padding:"13px 18px", borderRadius:999, background:p.accent, border:"none", color:p.bg, fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit" };

  // Flat mode — data not strong enough to guess, show revealContent + full nav
  if (!confidenceValid) {
    return (
      <>
        {revealContent ?? null}
        <div data-share-hide data-nav-row="true" style={navRow}>
          {back   && <button type="button" onClick={back}   className="wc-btn" style={backBtn}>← Back</button>}
          {nextFn && <button type="button" onClick={nextFn} className="wc-btn" style={nextBtn}>Next ▶</button>}
        </div>
      </>
    );
  }

  function handlePick(option) {
    if (phase !== "guess") return;
    setPicked(option);
    setPhase("locking");
    setTimeout(() => {
      setPhase("revealed");
      onReveal?.();
    }, 820);
  }

  // Revealed — show content; if onReveal auto-advances, skip nav
  if (phase === "revealed") {
    return (
      <>
        <div className="wc-reveal-now" style={{ width: "100%", animation: `wcFadeIn 320ms cubic-bezier(.2,0,.1,1) both` }}>
          {revealContent}
        </div>
        {!onReveal && (
          <div data-share-hide data-nav-row="true" style={navRow}>
            {back   && <button type="button" onClick={back}   className="wc-btn" style={backBtn}>← Back</button>}
            {nextFn && <button type="button" onClick={nextFn} className="wc-btn" style={nextBtn}>Next ▶</button>}
          </div>
        )}
      </>
    );
  }

  const isLocking = phase === "locking";

  return (
    <div className="wc-fadeup-2" style={{ width: "100%" }}>
      <div style={{
        background: p.inner,
        border: `1.5px solid ${p.accent}70`,
        borderRadius: 24,
        padding: "20px 20px 22px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent, alignSelf: "flex-start" }}>
          Make your guess
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", lineHeight: 1.35, textAlign: "center", letterSpacing: -0.3 }}>
          {question}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
          {options.map(option => {
            const isCorrect = option === correctAnswer;
            const isChosen  = option === picked;
            let bg     = "rgba(255,255,255,0.07)";
            let border = "1.5px solid rgba(255,255,255,0.14)";
            let color  = "rgba(255,255,255,0.85)";
            let icon   = null;
            if (isLocking && isChosen && isCorrect)  { bg = "rgba(80,220,120,0.18)"; border = "1.5px solid rgba(80,220,120,0.55)"; color = "#fff"; icon = "✓"; }
            if (isLocking && isChosen && !isCorrect) { bg = "rgba(255,80,80,0.15)";  border = "1.5px solid rgba(255,80,80,0.45)";  color = "#fff"; icon = "✗"; }
            if (isLocking && !isChosen && isCorrect) { bg = "rgba(80,220,120,0.10)"; border = "1.5px solid rgba(80,220,120,0.35)"; color = "rgba(255,255,255,0.6)"; }
            return (
              <button
                key={option}
                type="button"
                onClick={() => handlePick(option)}
                disabled={isLocking}
                className="wc-btn"
                style={{
                  width: "100%", padding: "13px 18px", borderRadius: 999, border, background: bg, color,
                  fontSize: 15, fontWeight: 700, cursor: isLocking ? "default" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, transition: "background 0.25s, border-color 0.25s, color 0.2s", letterSpacing: 0.1,
                }}
              >
                {option}
                {icon && <span style={{ fontSize: 13, opacity: 0.9 }}>{icon}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {/* Back only during guess — no Next, answer is required to advance */}
      <div data-share-hide style={navRow}>
        {back && <button type="button" onClick={back} className="wc-btn" style={backBtn}>← Back</button>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ATTRIBUTION CARD — Who Said This? interactive mechanic.
//
// Two phases:
//   "hidden"   — quote shown, sender hidden, two name buttons
//   "revealed" — sender + timestamp + context paragraph fades in
//
// When isSensitive is true the guessing mechanic is suppressed:
// the card renders as a plain moment card with no hidden sender.
// ─────────────────────────────────────────────────────────────────
export function AttributionCard({ quote, participants = [], correctSender, contextParagraph, isSensitive = false, label = "Who said this?" }) {
  const p = useContext(SectionPaletteContext) || PAL.upload;
  const [picked, setPicked] = useState(null);
  const [phase, setPhase] = useState("hidden"); // "hidden" | "locking" | "revealed"

  function handlePick(name) {
    if (phase !== "hidden") return;
    setPicked(name);
    setPhase("locking");
    setTimeout(() => setPhase("revealed"), 780);
  }

  // Soft mode — sensitive content shown as a plain moment card
  if (isSensitive) {
    return (
      <div className="wc-fadeup-2" style={{
        background: p.inner,
        border: `1.5px solid ${p.accent}70`,
        borderRadius: 24,
        padding: "20px 20px 22px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>
          {label}
        </div>
        {quote && (
          <div style={{ fontSize: 15, fontStyle: "italic", color: "rgba(255,255,255,0.90)", lineHeight: 1.6, borderLeft: `3px solid ${p.accent}60`, paddingLeft: 14 }}>
            "{quote}"
          </div>
        )}
        {contextParagraph && (
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
            {contextParagraph}
          </div>
        )}
      </div>
    );
  }

  if (phase === "revealed") {
    const isCorrect = picked === correctSender;
    return (
      <div style={{ width: "100%", animation: `wcFadeIn 320ms cubic-bezier(.2,0,.1,1) both`, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* result badge */}
        <div style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: isCorrect ? "rgba(80,220,120,0.15)" : "rgba(255,80,80,0.12)",
          border: `1px solid ${isCorrect ? "rgba(80,220,120,0.40)" : "rgba(255,80,80,0.35)"}`,
          color: isCorrect ? "#6EE8A0" : "#FF8080",
          fontSize: 13,
          fontWeight: 700,
          textAlign: "center",
          width: "100%",
          letterSpacing: 0.1,
        }}>
          {isCorrect ? `Correct — ${correctSender} said it` : `Actually — ${correctSender} said it`}
        </div>

        {/* full card with context */}
        <div style={{
          background: p.inner,
          border: `1.5px solid ${p.accent}70`,
          borderRadius: 24,
          padding: "20px 20px 22px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>
            {label}
          </div>
          {quote && (
            <div style={{ fontSize: 15, fontStyle: "italic", color: "rgba(255,255,255,0.90)", lineHeight: 1.6, borderLeft: `3px solid ${p.accent}60`, paddingLeft: 14 }}>
              "{quote}"
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 700, color: p.accent }}>
            — {correctSender}
          </div>
          {contextParagraph && (
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.60)", lineHeight: 1.6, marginTop: 2 }}>
              {contextParagraph}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isLocking = phase === "locking";

  return (
    <div className="wc-fadeup-2" style={{
      background: p.inner,
      border: `1.5px solid ${p.accent}70`,
      borderRadius: 24,
      padding: "20px 20px 22px",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}>
      {/* eyebrow */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: p.accent }}>
        {label}
      </div>

      {/* hidden quote */}
      {quote && (
        <div style={{ fontSize: 15, fontStyle: "italic", color: "rgba(255,255,255,0.90)", lineHeight: 1.6, borderLeft: `3px solid ${p.accent}60`, paddingLeft: 14 }}>
          "{quote}"
        </div>
      )}

      {/* who sent this prompt */}
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", textAlign: "center", fontWeight: 600 }}>
        Who sent this?
      </div>

      {/* name buttons */}
      <div style={{ display: "flex", gap: 10, width: "100%" }}>
        {participants.slice(0, 2).map(name => {
          const isCorrect = name === correctSender;
          const isChosen  = name === picked;
          let bg     = "rgba(255,255,255,0.07)";
          let border = "1.5px solid rgba(255,255,255,0.14)";
          let color  = "rgba(255,255,255,0.85)";
          if (isLocking && isChosen && isCorrect)  { bg = "rgba(80,220,120,0.18)"; border = "1.5px solid rgba(80,220,120,0.55)"; color = "#fff"; }
          if (isLocking && isChosen && !isCorrect) { bg = "rgba(255,80,80,0.15)";  border = "1.5px solid rgba(255,80,80,0.45)";  color = "#fff"; }
          if (isLocking && !isChosen && isCorrect) { bg = "rgba(80,220,120,0.10)"; border = "1.5px solid rgba(80,220,120,0.35)"; color = "rgba(255,255,255,0.55)"; }
          return (
            <button
              key={name}
              type="button"
              onClick={() => handlePick(name)}
              disabled={isLocking}
              className="wc-btn"
              style={{
                flex: 1,
                padding: "12px 10px",
                borderRadius: 999,
                border,
                background: bg,
                color,
                fontSize: 14,
                fontWeight: 700,
                cursor: isLocking ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "background 0.25s, border-color 0.25s, color 0.2s",
                letterSpacing: 0.1,
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
