// ─────────────────────────────────────────────────────────────────
// SCREENS — every React screen component + supabase I/O helpers.
// ─────────────────────────────────────────────────────────────────
import { useState, useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import { DA, getDA, ThemeContext, useTheme, Geo, WaveLines, PrimaryButton, GhostButton, BackIcon, ForwardIcon, setAppSafeAreaColor } from "../theme.jsx";
import html2canvas from "html2canvas";
import { supabase } from "../supabase";
import { processImportedChatFile } from "../import/fileProcessing";
import { IMPORT_ACCEPT_TYPES, MIN_MESSAGES } from "../import/normalizedSchema";
import {
  buildCombinedDataset, buildDatasetFromParsedChat,
  detectOtherParticipantMismatches, toAnalysisMessagesFromDataset,
} from "../import/datasetBuilder";
import { applyApprovedMerges, normalizeDisplayName } from "../utils/identityMerge";
import {
  cacheUnlockedPacks, cacheUserCredits, cacheUserProfile, cacheUserResults,
  readUserDataCache, removeCachedResults, requestOnce, sameCachedValue, upsertCachedResult,
} from "../userDataCache";
import BrandLockup, { wrapchatLogoTransparent } from "../BrandLockup";
import AiDebugPanel from "../../analysis-test/AiDebugPanel.jsx";
import {
  ACCESS_MODES, DEFAULT_ACCESS_MODE, getAccessMode, getAccessModeLabel, isOpenMode, setAccessMode,
} from "../accessMode";
import {
  CREDIT_BUNDLES, QUICK_READ_TRIAL_CONFIG, REPORT_PACKS, REPORT_PACK_ORDER,
  canUserRunReports, deductCreditsAmount, estimateAnalysesLeft, getCreditBundleById,
  getBundleMatch, getPackCreditCost, getReportCreditCost, getTotalCreditCostBundled,
  getUnlockedReportPacks, simulateCreditPurchase, unlockReportPacks,
} from "../reportCredits";
import {
  buildDebugAnalysisExport, createAiDebugFileName, createAiRawDebugFileName,
  downloadTextFile, downloadJsonFile, prepareConnectionDigestRequest,
  prepareCoreAnalysisARequest, prepareGrowthDigestRequest,
  prepareCoreAnalysisBRequest, prepareRiskDigestRequest, serializeDebugAnalysisExport,
} from "../../analysis-test/aiDebugHelpers.js";
import partnerIcon from "../../assets/partner.svg";
import datingIcon from "../../assets/dating.svg";
import exIcon from "../../assets/ex.svg";
import familyIcon from "../../assets/family.svg";
import friendIcon from "../../assets/friend.svg";
import colleagueIcon from "../../assets/colleage.svg";
import otherIcon from "../../assets/other.svg";
import cardShareIcon from "../../assets/card-share.svg";
import sumShareIcon from "../../assets/sum-share.svg";
import coinIcon from "../../assets/wrpcht-coin.svg";
import bundle1Icon from "../../assets/bundle1.svg";
import bundle2Icon from "../../assets/bundle2.svg";
import bundle3Icon from "../../assets/bundle3.svg";
import { buildTrialPrompt, deriveTrialReport } from "../trialReport";
import {
  UILanguageContext, useUILanguage, useT, useControlT, translateUI, translateControlValue,
  normalizeUiLangCode, normalizeUiLangPref, LANG_META, SUPPORTED_UI_LANGS,
} from "../i18n/translations";
import { detectLanguage } from "../i18n/translations";
import {
  capLargeGroup, localStats, userProvidedDisplayName, hasUserProvidedDisplayName,
  quickReadDaysLeft, quickReadExpiryLabel, getAuthConfirmationRedirectUrl,
  namesWithoutCurrentUser, compactNamesLabel, getParticipantDisplayTitle,
  detectParticipantConsistencyMismatch, detectDuoProfileNameMismatch,
  applyAutomaticParticipantMerges, getReviewableMergeSuggestions,
  DUO_CASUAL_SCREENS, GROUP_CASUAL_SCREENS, cleanQuote,
  LOADING_STEPS, DUO_REDFLAG_SCREENS, GROUP_REDFLAG_SCREENS,
  buildQuizQuestions, normalizeRedFlags, normalizeTimeline,
} from "../analysis/localMath";
import { userFacingAnalysisError } from "../analysis/claudeClient";
import {
  aiAnalysis, aiToxicityAnalysis, aiLoveLangAnalysis, aiGrowthAnalysis,
  aiAccountaAnalysis, aiEnergyAnalysis, generateCoreAnalysisA,
  buildStoredResultData, getStoredResultTranslations, getStoredResultDisplayLanguage,
  CORE_ANALYSIS_CACHE_VERSION, getAnalysisFamilyCacheKey, REPORT_PIPELINES,
  HOMEPAGE_VERSION_LABEL, getDisplayResultData,
} from "../analysis/aiAnalysis";
import {
  CloseResultsContext, ShareResultsContext, FeedbackContext, SlideContext, SectionPaletteContext,
  ThemedSurfaceContext,
  PAL, PILL_LABEL, PACK_DEFS, PACK_ORDER, PACK_COIN_FILTER, REPORT_BUFFER_STYLE, REPORT_BUFFER_STYLE_LIGHT,
  REPORT_TYPES, CREDIT_PACKS, reportTypeMeta, packForReports, packForSavedRows,
  normalizeSelectedReportTypes, buildShareCanvas, canShareFiles, downloadBlob, canvasToBlob,
  chatHealthLabel, SLIDE_MS, SHELL_SAFE_TOP, SHELL_PANE_PADDING, SHELL_DRAWER_PADDING,
  SCREEN_CONTENT_STYLE, SCREEN_HEADER_BLOCK_STYLE, SCREEN_HEADER_CONTROL_TOP,
  SCREEN_BODY_SCROLL_STYLE, getStickyHeaderStyle,
  LEGAL_VERSION, TERMS_OF_SERVICE_TEXT, PRIVACY_POLICY_TEXT,
  SharePicker, Shell, GearIcon, getReportLaunchSec,
  GuessCard, AttributionCard,
} from "../ui/Shell";


function SolidStarIcon({ size = 13, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" focusable="false">
      <path d="M12 2.1 15.1 8.4 22 9.4 17 14.3 18.2 21.1 12 17.9 5.8 21.1 7 14.3 2 9.4 8.9 8.4 12 2.1Z" />
    </svg>
  );
}

const FEEDBACK_OPTIONS = [
  "Nothing. Very accurate.",
  "Events are mixing",
  "Wrong person",
  "Didn't happen",
  "Tone misread",
  "Overclaiming",
  "Missing context",
  "Other",
];
const POSITIVE_FEEDBACK_OPTION = "Nothing. Very accurate.";
function getFeedbackSentiment(option) {
  return option === POSITIVE_FEEDBACK_OPTION ? "positive" : "negative";
}
const ADMIN_EMAILS = Array.from(new Set(
  String(import.meta.env.VITE_ADMIN_EMAILS || import.meta.env.VITE_ADMIN_EMAIL || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
));

// Typography — ink follows the surface: white on report palettes, da.* on
// themed sections in light mode (see useInk).
const T   = ({s=26,children}) => {
  const ink = useInk();
  return (
    <div className="wc-fadeup" style={{ fontSize:s, fontWeight:900, textAlign:"center", lineHeight:1.1, color:ink.text, letterSpacing:-0.5, width:"100%", marginBottom:4 }}>{children}</div>
  );
};
const Big = ({children}) => {
  const ink = useInk();
  return (
    <div className="wc-fadeup-2" style={{ fontSize:44, fontWeight:900, textAlign:"center", color:ink.text, letterSpacing:-1.5, width:"100%", lineHeight:1.05, wordBreak:"break-word", margin:"6px 0 2px" }}>{children}</div>
  );
};
const Sub = ({children, mt=6}) => {
  const ink = useInk();
  return (
    <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:ink.muted, lineHeight:1.6, width:"100%", marginTop:mt, fontWeight:400 }}>{children}</div>
  );
};

// Inner card — the chunky rounded inner panel from the reference
function Card({ children, accent, style={} }) {
  const p = accent || PAL.upload;
  const bg = typeof p === "string" ? p : p.inner;
  return (
    <div className="wc-fadeup-2" style={{ width:"100%", background:bg, borderRadius:24, padding:"16px 18px", ...style }}>
      {children}
    </div>
  );
}
const stableHash = (value) => {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash * 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

// Deterministic pick — stable across rerenders, sharing, and reopening saved reports.
const pick = (arr, key = "") => {
  if (!Array.isArray(arr) || !arr.length) return "";
  const idx = stableHash(`${key}::${arr.join("\u241E")}`) % arr.length;
  return arr[idx];
};

const Quip = ({children}) => <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.82)", background:"rgba(255,255,255,0.07)", padding:"13px 18px", borderRadius:18, width:"100%", lineHeight:1.55, fontStyle:"italic", fontWeight:500 }}>{children}</div>;

// Ink colors for the current Shell surface: white-family on the fixed dark
// report palettes, da.* on themed (upload/trial) sections in light mode.
// Components below Shell should use this instead of hardcoding white.
function useInk() {
  const themedSection = useContext(ThemedSurfaceContext);
  const { theme } = useTheme();
  const light = themedSection && theme === "light";
  return {
    light,
    text:  light ? "#1f184e"             : "#fff",
    muted: light ? "rgba(31,24,78,0.66)" : "rgba(255,255,255,0.65)",
    dim:   light ? "rgba(31,24,78,0.55)" : "rgba(255,255,255,0.55)",
    faint: light ? "rgba(31,24,78,0.45)" : "rgba(255,255,255,0.4)",
    chipBg:     light ? "rgba(31,24,78,0.07)" : "rgba(255,255,255,0.10)",
    chipBorder: light ? "rgba(31,24,78,0.18)" : "rgba(255,255,255,0.18)",
    cellBg:     light ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.2)",
  };
}

function Dots({ color }) {
  const ink = useInk();
  return (
    <div style={{ display:"flex", gap:6, padding:"4px 0" }}>
      {[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:color || ink.faint,animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
    </div>
  );
}

function AICard({ label, value, loading }) {
  const p = useContext(SectionPaletteContext) || PAL.upload;
  return (
    <div className="wc-fadeup-2" style={{
      background: p.inner,
      border: `1.5px solid ${p.accent}70`,
      borderRadius: 24,
      padding: "18px 20px",
      width: "100%",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:p.accent, marginBottom:10 }}>{label}</div>
      {loading ? <Dots color="rgba(255,255,255,0.4)" /> : <div style={{ fontSize:15, color:"#fff", lineHeight:1.65, fontWeight:400 }}>{value||"—"}</div>}
    </div>
  );
}


export function FeedbackSheet({ open, target, selected, note, submitting, onSelect, onNoteChange, onSubmit, onClose }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open && target) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open, target]);

  if (!open || !target) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: `rgba(0,0,0,${visible ? 0.6 : 0})`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        transition: "background 0.28s ease",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(420px, 100vw)",
          display: "flex",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            width: "calc(100% - 12px)",
            maxHeight: "min(72svh, 560px)",
            background: "linear-gradient(180deg, #15151d 0%, #101017 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: "28px 28px 0 0",
            padding: "10px 14px calc(16px + env(safe-area-inset-bottom, 0px))",
            boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
            color: "#fff",
            overflowY: "auto",
            transform: visible ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            boxSizing: "border-box",
          }}
        >
          {/* drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.14)", margin: "0 auto 16px" }} />

          {/* header */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, marginBottom: 5, lineHeight: 1.2 }}>{t("What's off about this?")}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              {target.reportType} · card {target.cardIndex}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontWeight: 600, lineHeight: 1.45, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "10px 12px" }}>
              {target.cardTitle}
            </div>
          </div>

          {/* options */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
            {FEEDBACK_OPTIONS.filter(o => o !== POSITIVE_FEEDBACK_OPTION).map(option => {
              const active = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSelect(option)}
                  className="wc-btn"
                  style={{
                    minHeight: 42,
                    border: `1px solid ${active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.10)"}`,
                    borderRadius: 16,
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.25,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)",
                    color: active ? "#fff" : "rgba(255,255,255,0.72)",
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                >
                  {t(option)}
                </button>
              );
            })}
          </div>
          {/* positive option — full width, green tint */}
          {(() => {
            const active = selected === POSITIVE_FEEDBACK_OPTION;
            return (
              <button
                type="button"
                onClick={() => onSelect(POSITIVE_FEEDBACK_OPTION)}
                className="wc-btn"
                style={{
                  width: "100%",
                  minHeight: 42,
                  border: `1px solid ${active ? "rgba(80,200,110,0.55)" : "rgba(80,200,110,0.22)"}`,
                  borderRadius: 16,
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.25,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: active ? "rgba(80,200,110,0.22)" : "rgba(80,200,110,0.08)",
                  color: active ? "#7BE39A" : "rgba(120,210,140,0.80)",
                  textAlign: "center",
                  boxSizing: "border-box",
                  marginBottom: 14,
                }}
              >
                {t(POSITIVE_FEEDBACK_OPTION)}
              </button>
            );
          })()}

          {/* optional note */}
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder={t("Optional note")}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: "12px 14px",
              fontSize: 14,
              lineHeight: 1.45,
              color: "#fff",
              outline: "none",
              fontFamily: "inherit",
              marginBottom: 14,
              boxSizing: "border-box",
            }}
          />

          {/* actions */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="wc-btn"
              style={{
                minHeight: 46,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.68)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                padding: "12px 10px",
                borderRadius: 16,
                transition: "all 0.15s",
                boxSizing: "border-box",
              }}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              className="wc-btn"
              disabled={!selected || submitting}
              style={{
                minHeight: 46,
                padding: "12px 10px",
                borderRadius: 16,
                border: "none",
                background: !selected || submitting ? "rgba(255,255,255,0.08)" : PAL.upload.inner,
                color: "#fff",
                fontSize: 14,
                fontWeight: 800,
                cursor: !selected || submitting ? "default" : "pointer",
                opacity: !selected || submitting ? 0.45 : 1,
                transition: "all 0.15s",
                letterSpacing: 0.1,
                boxSizing: "border-box",
              }}
            >
              {submitting ? t("Sending…") : t("Submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children }) {
  return <button onClick={onClick} className="wc-btn" style={{ padding:"12px 28px", borderRadius:50, border:"none", background:"rgba(255,255,255,0.15)", color:"#fff", fontSize:15, cursor:"pointer", fontWeight:700, transition:"all 0.15s", flexShrink:0, letterSpacing:0.2 }}>{children}</button>;
}
function Nav({ back, next, showBack=true, nextLabel="Next", showArrow=true }) {
  const t = useT();
  const p = useContext(SectionPaletteContext) || PAL.upload;
  const ink = useInk();
  return (
    <div data-share-hide data-nav-row="true" style={{ display:"flex", gap:10, marginTop:8, width:"100%" }}>
      {showBack && (
        <button onClick={back} className="wc-btn" style={{
          flex:1, padding:"14px", borderRadius:999,
          background:ink.chipBg, border:`1.5px solid ${ink.chipBorder}`,
          fontFamily:"'Nunito Sans',sans-serif", color:ink.light ? "rgba(31,24,78,0.75)" : "rgba(255,255,255,0.75)",
          fontSize:15, fontWeight:700,
          display:"flex", alignItems:"center", justifyContent:"center", gap:7,
        }}><BackIcon size={13} /> {t("Back")}</button>
      )}
      <button onClick={next} className="wc-btn" style={{
        flex:1, padding:"14px", borderRadius:999,
        background:p.accent, border:"none",
        fontFamily:"'Nunito Sans',sans-serif", color:p.bg,
        fontSize:15, fontWeight:800,
        display:"flex", alignItems:"center", justifyContent:"center", gap:7,
      }}>
        {t(nextLabel)}
        {showArrow && <ForwardIcon size={13} />}
      </button>
    </div>
  );
}
function ScreenHeader({ title, titleNode=null, back, backLabel="Back", action=null, centerTitle=false, topOffset=20 }) {
  const t = useT();
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <div data-share-hide style={{ width:"100%", minHeight:40, display:"grid", gridTemplateColumns:"40px minmax(0, 1fr) 40px", alignItems:"center", columnGap:8, flexShrink:0, marginTop:topOffset }}>
      {back && (
        <button
          type="button"
          onClick={back}
          className="wc-btn"
          aria-label={t(backLabel)}
          style={{
            width:34,
            height:34,
            marginTop:-1,
            border:"none",
            padding:0,
            background:"none",
            color: theme === "light" ? "rgba(31,24,78,0.6)" : "rgba(255,255,255,0.74)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            cursor:"pointer",
          }}
        >
          <BackIcon size={14} />
        </button>
      )}
      {!back && <div />}
      <div style={{
        minWidth:0,
        fontSize:28, fontWeight:900, color:da.text, letterSpacing:-1, lineHeight:1.08,
        textAlign:centerTitle ? "center" : "left", overflowWrap:"anywhere",
      }}>
        {titleNode ?? t(title)}
      </div>
      <div style={{ width:40, height:34, marginTop:-1, display:"flex", alignItems:"center", justifyContent:"center" }}>{action}</div>
    </div>
  );
}

function SwatchIcon({ inner, accent, size = 48, inset = 9, style = {} }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  return (
    <div style={{ width:size, height:size, position:"relative", flexShrink:0, ...style }}>
      <div style={{
        position:"absolute", inset:0,
        borderRadius:Math.round(size * 0.27),
        background: isLight ? `${accent}18` : "rgba(0,0,0,0.14)",
        border:`1.5px solid ${accent}55`,
      }} />
      <div style={{
        position:"absolute", inset,
        borderRadius:Math.round(size * 0.17),
        background:inner || `${accent}38`,
        border:`1px solid ${accent}90`,
        transform:"rotate(-12deg)",
      }} />
    </div>
  );
}

const CREDIT_BUNDLE_ICON = { starter: bundle1Icon, plus: bundle2Icon, all_access: bundle3Icon };

function PackSwatch({ pack, size = 48, inset = 9 }) {
  return (
    <SwatchIcon
      size={size}
      inset={inset}
      inner={`${pack.accent}60`}
      accent={pack.accent}
    />
  );
}

function AnalysisDotsCounter({ credits, activePackIds = null, onAdd, hide = false }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  if (hide || !Number.isInteger(credits)) return null;
  const useExplicitPackState = activePackIds && typeof activePackIds === "object";
  const dotPacks = PACK_ORDER.map(id => PACK_DEFS[id]).filter(Boolean);
  const ownedPacks = useExplicitPackState
    ? dotPacks.filter(pack => Boolean(activePackIds[pack.id]))
    : dotPacks.filter((_, i) => i >= Math.max(dotPacks.length - dotPacks.filter(pack => Math.floor(credits / pack.cost) > 0).length, 0));
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6,
      background: isLight ? "none" : "rgba(var(--wc-p),0.18)",
      border: isLight ? "none" : "1px solid rgba(var(--wc-p),0.32)",
      borderRadius:999,
      padding:"5px 7px 5px 10px",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {dotPacks.map((_, index) => {
          const posFromRight = dotPacks.length - 1 - index;
          const active = posFromRight < ownedPacks.length;
          const color = active ? ownedPacks[ownedPacks.length - 1 - posFromRight].accent : null;
          return (
            <div
              key={dotPacks[index].id}
              title={active ? "Owned read" : "Locked read"}
              style={{
                width:8, height:8, borderRadius:"50%",
                background: active ? color : (isLight ? "rgba(122,144,255,0.28)" : "rgba(255,255,255,0.16)"),
                transition:"all 0.2s",
              }}
            />
          );
        })}
      </div>
      <div style={{ width:1, height:14, background: isLight ? "rgba(122,144,255,0.3)" : "rgba(255,255,255,0.12)", margin:"0 1px" }} />
      <button
        type="button"
        onClick={onAdd}
        className="wc-btn"
        aria-label="Unlock more reads"
        style={{
          width:22, height:22, borderRadius:"50%",
          background: isLight ? "none" : "rgba(255,255,255,0.10)",
          border: isLight ? "none" : "1px solid rgba(255,255,255,0.16)",
          display:"flex", alignItems:"center", justifyContent:"center",
          color: isLight ? "#7A90FF" : "rgba(255,255,255,0.82)",
          fontSize:14, fontWeight:700, lineHeight:1,
          padding:0, paddingBottom:2, flexShrink:0, cursor:"pointer",
        }}
      >
        +
      </button>
    </div>
  );
}

function Bar({ value, max, color, label, delay=0 }) {
  const [fill,      setFill]      = useState(0);
  const [showLabel, setShowLabel] = useState(false);
  const BAR_DURATION = 850;
  useEffect(() => {
    const start = SLIDE_MS + 80 + delay;
    const t1 = setTimeout(() => setFill(value / Math.max(max, 1)), start);
    const t2 = setTimeout(() => setShowLabel(true), start + BAR_DURATION + 40);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [value, max, delay]);
  const lbl = (label||"").split(" ")[0].slice(0,10);
  const f   = fill > 0 ? fill : 1; // avoid divide-by-zero in counter-scale
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, width:"100%" }}>
      <div style={{ width:58, textAlign:"right", fontSize:13, color:"rgba(255,255,255,0.65)", flexShrink:0, fontWeight:600 }}>{lbl}</div>
      <div style={{ flex:1, minWidth:0, height:32, borderRadius:50, background:"rgba(0,0,0,0.2)", overflow:"hidden" }}>
        <div style={{
          height:"100%", width:"100%",
          background:color, borderRadius:50,
          display:"flex", alignItems:"center", paddingLeft:12,
          fontSize:13, fontWeight:700, color:"#fff", whiteSpace:"nowrap",
          transformOrigin:"left center",
          transform:`scaleX(${fill})`,
          transition: fill === 0 ? "none" : `transform ${BAR_DURATION}ms cubic-bezier(.2,0,.1,1)`,
        }}>
          {/* counter-scale keeps text undistorted; opacity fades in only after bar settles */}
          <span style={{
            display:"inline-block",
            transform:`scaleX(${1/f})`,
            opacity: showLabel ? 1 : 0,
            transition: showLabel ? "opacity 0.28s ease" : "none",
          }}>
            {value.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
function MonthBadge({ month, count, medal }) {
  const t = useT();
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center", flex:1, minWidth:80 }}>
      <div style={{ fontSize:26 }}>{medal}</div>
      <div className="" style={{ fontSize:15, fontWeight:800, color:"#fff", marginTop:8, letterSpacing:-0.3 }}>{month}</div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4, fontWeight:500 }}>{count.toLocaleString()} {t("msgs")}</div>
    </div>
  );
}
function Words({ words, bigrams }) {
  const ink = useInk();
  const M=["🥇","🥈","🥉"];
  const top5w=(words||[]).slice(0,5);
  const top5b=(bigrams||[]).slice(0,5);
  const combined=[...top5w.map(([w,c])=>({w,c})),...top5b.map(([w,c])=>({w,c}))];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:4 }}>
      {combined.map(({w,c},i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: i<3 ? (ink.light ? "rgba(31,24,78,0.10)" : "rgba(255,255,255,0.12)") : (ink.light ? "rgba(31,24,78,0.05)" : "rgba(0,0,0,0.15)"), borderRadius:14 }}>
          <span style={{ width:26, fontSize:14, flexShrink:0 }}>{M[i]||i+1}</span>
          <span style={{ flex:1, fontWeight:700, color:ink.text, fontSize:15, letterSpacing:-0.2 }}>{w}</span>
          <span style={{ fontSize:13, color:ink.dim, fontWeight:600 }}>{c.toLocaleString()}x</span>
        </div>
      ))}
    </div>
  );
}
function Cell({ label, value }) {
  const ink = useInk();
  return (
    <div style={{ background:ink.cellBg, borderRadius:18, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:ink.faint, marginBottom:6 }}>{label}</div>
      <div className="" style={{ fontWeight:800, color:ink.text, fontSize:16, wordBreak:"break-word", letterSpacing:-0.3 }}>{value}</div>
    </div>
  );
}
function FlagList({ flags, loading }) {
  const t = useT();
  const items = normalizeRedFlags(flags);
  if (loading && !items.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {items.map((flag, index) => (
        <div key={`${flag.title}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {t("Red flag {index}", { index: index + 1 })}
          </div>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, marginBottom:6 }}>
            {flag.title}
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.78)", lineHeight:1.6 }}>
            {flag.detail || t("This pattern showed up enough to feel worth watching.")}
          </div>
          {flag.evidence && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.5, marginTop:8 }}>
              {t("Evidence")}: {flag.evidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ items, loading }) {
  const entries = normalizeTimeline(items);
  if (loading && !entries.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {entries.map((item, index) => (
        <div key={`${item.date}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {item.date}
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.25, marginBottom:6 }}>
            {item.title}
          </div>
          {item.detail && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TextList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", color:"rgba(255,255,255,0.78)", textAlign:"left", fontSize:13, lineHeight:1.55 }}>
          {item}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MEMORABLE MOMENTS ROW
// ─────────────────────────────────────────────────────────────────
const MOMENT_TYPE_EMOJI = { funny:"😂", sweet:"🫶", awkward:"😬", chaotic:"🌪️", signature:"✨", tension:"⚡", care:"💙", conflict:"🔥" };

function MomentsRow({ moments, loading }) {
  if (loading) return null;
  if (!moments?.length) return null;
  return (
    <div style={{ width:"100%", marginTop:14 }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Moments</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {moments.map((m, i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"12px 14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:m.setup || m.quote ? 5 : 0 }}>
              <span style={{ fontSize:14, lineHeight:1 }}>{MOMENT_TYPE_EMOJI[m.type] || "✨"}</span>
              <span style={{ fontSize:13, fontWeight:700, color:"#fff", lineHeight:1.3 }}>{m.title}</span>
            </div>
            {m.quote && <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontStyle:"italic", marginBottom:4, lineHeight:1.4 }}>"{m.quote}"</div>}
            {m.read && <div style={{ fontSize:13, color:"rgba(255,255,255,0.78)", lineHeight:1.5 }}>{m.read}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DUO SCREENS
// ─────────────────────────────────────────────────────────────────
export function DuoScreen({ s, ai, aiLoading, step, back, next, mode, relationshipType, resultId }) {
  const t = useT();
  const total  = s.msgCounts[0]+s.msgCounts[1];
  const pct0   = Math.round((s.msgCounts[0]/total)*100);
  const mMax   = Math.max(...s.msgCounts);
  const nov    = s.avgMsgLen[0]>=s.avgMsgLen[1]?0:1;
  const TOTAL  = mode === "redflags" ? DUO_REDFLAG_SCREENS : DUO_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || (aiLoading ? "..." : s.names[0]);
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const relationshipStatus = ai?.relationshipStatus || s.relationshipStatus || (aiLoading ? "..." : "Complicated");
  const relationshipStatusWhy = ai?.relationshipStatusWhy || s.relationshipStatusWhy;
  const statusEvidence = ai?.statusEvidence || s.statusEvidence;
  const relationshipSpecific = ai?.relationshipSpecific || null;
  const relationshipConfidence = ai?.relationshipConfidence || null;
  const relationshipEvidence = ai?.relationshipEvidence || null;
  const relationshipDetectedLabel = relationshipSpecific
    ? `${relationshipSpecific}${relationshipConfidence ? ` (${relationshipConfidence} confidence)` : ""}`
    : null;
  const relationshipReadTitle = relReadTitle(relationshipType, relationshipSpecific);
  const duoFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const attrMoment = (ai?.memorableMoments || []).find(m => m.quote && m.people?.length >= 1 && m.read) ?? null;
  const casualScreens = [
    // Card 1 — Who's more obsessed (animated bars, smooth opener)
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("Who's more obsessed?", 1)}>
      <T>{t("Who's more obsessed?")}</T>
      <div style={{width:"100%",marginTop:16}}>
        <Bar value={s.msgCounts[0]} max={mMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.msgCounts[1]} max={mMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Sub mt={14}>{t("{pct}% of all messages came from {name}.", { pct: pct0, name: s.names[0] })}</Sub>
      {(() => {
        const name = s.names[pct0>=50?0:1];
        const q = pick(t("quips.duo.obsessed", { name }), `duo-obsessed|${s.names.join("|")}|${s.totalMessages}|${name}|${pct0}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Ghost Award (GuessCard when skewed; if balanced, conv starter becomes interactive on card 6)
    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost Award", 2, !s.ghostEqual)}>
      {s.ghostEqual ? (
        <>
          <T>{t("Response times")}</T>
          <Big>{t("Balanced")}</Big>
          <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          {(() => { const q = pick(t("quips.duo.responseBalanced"), `duo-response-balanced|${s.names.join("|")}|${s.totalMessages}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
          <Nav back={back} next={next} />
        </>
      ) : (
        <GuessCard
          question={t("Who ghosts longer?")}
          options={s.names}
          correctAnswer={s.ghostName}
          confidenceValid={true}
          back={back}
          next={next}
          revealContent={
            <>
              <T>{t("The Ghost Award")}</T>
              <Big>{s.ghostName}</Big>
              <Sub>{t("{name} avg reply:", { name: s.names[0] })} <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{t("{name} avg reply:", { name: s.names[1] })} <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
              <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
              {(() => { const q = pick(t("quips.duo.ghost", { name: s.ghostName }), `duo-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghostName}|${s.ghostAvg.join("|")}`); return <Quip>{q}</Quip>; })()}
            </>
          }
        />
      )}
    </Shell>,

    // Card 3 — Your longest streak
    <Shell sec="lovely" prog={3} total={TOTAL} feedback={feedback("Your longest streak", 3)}>
      <T>{t("Your longest streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("Texted every single day for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.duo.streak100", { streak: s.streak }), `duo-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.duo.streak30", { streak: s.streak }), `duo-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.duo.streak10", { streak: s.streak }), `duo-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.duo.streakShort", { streak: s.streak }), `duo-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 4 — The Kindest One
    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("The Kindest One", 4)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 5 — Top 3 most active months
    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("Top 3 most active months", 5)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("{month} was your month. Something was going on.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — Who always reaches out first?
    // GuessCard when ghost is balanced (prioritise ghost as the interactive card; fall back here)
    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("Who always reaches out first?", 6)}>
      {s.ghostEqual ? (
        <GuessCard
          question={t("Who reaches out first?")}
          options={s.names}
          correctAnswer={s.convStarter}
          confidenceValid={true}
          back={back}
          next={next}
          revealContent={
            <>
              <T>{t("Who always reaches out first?")}</T>
              <Big>{s.convStarter}</Big>
              <Sub>{t("Started {pct} of all conversations.", { pct: s.convStarterPct })}</Sub>
              {(() => { const q = pick(t("quips.duo.convStarter", { name: s.convStarter }), `duo-conv-starter|${s.names.join("|")}|${s.totalMessages}|${s.convStarter}|${s.convStarterPct}`); return <Quip>{q}</Quip>; })()}
            </>
          }
        />
      ) : (
        <>
          <T>{t("Who always reaches out first?")}</T>
          <Big>{s.convStarter}</Big>
          <Sub>{t("Started {pct} of all conversations.", { pct: s.convStarterPct })}</Sub>
          {(() => { const q = pick(t("quips.duo.convStarter", { name: s.convStarter }), `duo-conv-starter|${s.names.join("|")}|${s.totalMessages}|${s.convStarter}|${s.convStarterPct}`); return <Quip>{q}</Quip>; })()}
          <Nav back={back} next={next} />
        </>
      )}
    </Shell>,

    // Card 7 — The Funny One
    <Shell sec="funny" prog={7} total={TOTAL} feedback={feedback("The Funny One", 7)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 8 — Spirit emojis
    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("Spirit emojis", 8)}>
      <T>{t("Spirit emojis")}</T>
      <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:64,lineHeight:1}}>{s.spiritEmoji[i]}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginTop:8}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("These two emojis basically ARE this chat.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — Your Language (Top 10 Words + Signature Phrases merged)
    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Your language", 9)}>
      <T>{t("Your language")}</T>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <div style={{display:"flex",gap:"1rem",marginTop:16,width:"100%",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{background:"rgba(255,255,255,0.08)",padding:"14px 18px",borderRadius:12,textAlign:"center",flex:1}}>
            {aiLoading?<Dots />:<div style={{fontSize:14,fontWeight:700,color:"#fff",fontStyle:"italic"}}>"{ai?.signaturePhrase?.[i]||s.signatureWord[i]}"</div>}
            <div style={{fontSize:12,color:"rgba(255,255,255,0.42)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>{t("The words and phrases that define this chat.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — What you actually talk about
    <Shell sec="ai" prog={10} total={TOTAL} feedback={feedback("What you actually talk about", 10)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 11 — The Drama Report
    <Shell sec="ai" prog={11} total={TOTAL} feedback={feedback("The Drama Report", 11)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 12 — Time of Day
    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Time of day", 12)}>
      <T>{t("Time of day")}</T>
      {ai?.timeOfDay ? (
        <>
          <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around",alignItems:"flex-start"}}>
            {[ai.timeOfDay.personA, ai.timeOfDay.personB].map((p, i) => (
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:36,fontWeight:800,color:"#fff"}}>{p?.peakHour || "—"}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>{p?.peakDaypart || ""}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4}}>{p?.name || s.names[i]}</div>
              </div>
            ))}
          </div>
          {ai.timeOfDay.contrast && <Sub mt={14}>{ai.timeOfDay.contrast}</Sub>}
        </>
      ) : aiLoading ? (
        <div style={{marginTop:24}}><Dots /></div>
      ) : (
        <Sub mt={14}>{t("Not enough data to show.")}</Sub>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 13 — A moment from the chat (Attribution)
    <Shell sec="ai" prog={13} total={TOTAL} feedback={feedback("A moment from the chat", 13)}>
      {aiLoading && !attrMoment ? (
        <>
          <T>{t("A moment from the chat")}</T>
          <div style={{marginTop:24}}><Dots /></div>
        </>
      ) : attrMoment ? (
        <AttributionCard
          quote={attrMoment.quote}
          participants={s.names}
          correctSender={attrMoment.people[0]}
          contextParagraph={attrMoment.read || attrMoment.title || ""}
          isSensitive={false}
          label={t("Who said this?")}
        />
      ) : (
        <>
          <T>{t("A moment from the chat")}</T>
          <AICard label={t("Most memorable moment")} value={ai?.memorableMoments?.[0]?.read || ai?.sweetMoment} loading={aiLoading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 14 — Chat vibe
    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("Chat vibe", 14)}>
      <T>{t("Chat vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("A chaotic, wholesome connection."))}
      </div>
      <MomentsRow moments={ai?.memorableMoments} loading={aiLoading} />
      <Sub mt={14}>{t("Powered by AI — analysed securely, never stored.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    // Card 15 — What's really going on (last)
    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("What's really going on", 15)}>
      <T>{t("What's really going on")}</T>
      <AICard label={t(relationshipReadTitle)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Relationship reading", 1)}>
      <T>{t("Relationship reading")}</T>
      <Big>{relationshipStatus}</Big>
      {relationshipDetectedLabel && (
        <AICard
          label="Detected relationship"
          value={relationshipDetectedLabel}
          loading={aiLoading && !relationshipDetectedLabel}
        />
      )}
      <AICard label={t("Observed pattern")} value={relationshipStatusWhy} loading={aiLoading && !relationshipStatusWhy} />
      {relationshipEvidence && <AICard label="Why this label" value={relationshipEvidence} loading={false} />}
      <AICard label={t("Concrete example")} value={statusEvidence} loading={aiLoading && !statusEvidence} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={duoFlags} loading={aiLoading && !duoFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        <Bar value={s.toxicityScores[0]} max={toxicMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.toxicityScores[1]} max={toxicMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Tension snapshot", 5)}>
      <T>{t("Tension snapshot")}</T>
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <AICard label={t(relationshipReadTitle)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={6} total={TOTAL} feedback={feedback("What keeps repeating", 6)}>
      <T>{t("What keeps repeating")}</T>
      <AICard label={t("Main topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("Pattern note")} value={duoFlags[0]?.detail || t("The strongest pattern is shown above.")} loading={aiLoading && !duoFlags[0]?.detail} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={7} total={TOTAL} feedback={feedback("Toxicity report", 7)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// GROUP SCREENS
// ─────────────────────────────────────────────────────────────────
export function GroupScreen({ s, ai, aiLoading, step, back, next, mode, resultId }) {
  const t = useT();
  const mMax   = Math.max(...s.msgCounts,1);
  const COLORS = ["#E06030","#4A90D4","#3ABDA0","#C4809A","#8A70D4","#D4A840"];
  const TOTAL  = mode === "redflags" ? GROUP_REDFLAG_SCREENS : GROUP_CASUAL_SCREENS;
  const reportKey = mode === "redflags" ? "toxicity" : "general";
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: reportKey, cardIndex, cardTitle } : null
  );
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || s.names[0];
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const groupFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = chatHealthLabel(ai?.chatHealthScore) || s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL} feedback={feedback("The Main Character", 1)}>
      <T>{t("The Main Character")}</T>
      <Big>{s.mainChar}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,6).map((n,i)=><Bar key={n} value={s.msgCounts[i]} max={mMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      {(() => {
      const q = pick(t("quips.group.mainCharacter", { name: s.mainChar }), `group-main-character|${s.names.join("|")}|${s.totalMessages}|${s.mainChar}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL} feedback={feedback("The Ghost", 2)}>
      <T>{t("The Ghost")}</T>
      <Big>{s.ghost}</Big>
      <Sub>{t("{count} messages total. Why are they even here?", { count: s.msgCounts[s.msgCounts.length-1].toLocaleString() })}</Sub>
      {(() => {
      const q = pick(t("quips.group.ghost", { name: s.ghost }), `group-ghost|${s.names.join("|")}|${s.totalMessages}|${s.ghost}|${s.msgCounts.join("|")}`);
      return <Quip>{q}</Quip>;
    })()}
      <AICard label={t("What's really going on")} value={ai?.ghostContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("The Last Word", 3)}>
      <T>{t("The Last Word")}</T>
      <Big>{s.convKiller}</Big>
      <Sub>{t("Sends the last message that nobody replies to.")}</Sub>
      {(() => {
      const q = pick(t("quips.group.lastWord", { name: s.convKiller }), `group-last-word|${s.names.join("|")}|${s.totalMessages}|${s.convKiller}|${s.convKillerCount}`);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL} feedback={feedback("Top 3 most active months", 4)}>
      <T>{t("Top 3 most active months")}</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{t("The group was most alive in {month}.", { month: s.topMonths[0][0] })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL} feedback={feedback("Longest active streak", 5)}>
      <T>{t("Longest active streak")}</T>
      <Big>{t("{count} days", { count: s.streak })}</Big>
      <Sub>{t("The group kept the chat alive for {count} days straight.", { count: s.streak })}</Sub>
      {(() => {
        const q = s.streak >= 100
          ? pick(t("quips.group.streak100", { streak: s.streak }), `group-streak100|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
          : s.streak >= 30
            ? pick(t("quips.group.streak30", { streak: s.streak }), `group-streak30|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
            : s.streak >= 10
              ? pick(t("quips.group.streak10", { streak: s.streak }), `group-streak10|${s.names.join("|")}|${s.totalMessages}|${s.streak}`)
              : pick(t("quips.group.streakShort", { streak: s.streak }), `group-streak-short|${s.names.join("|")}|${s.totalMessages}|${s.streak}`);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL} feedback={feedback("The Hype Person", 6)}>
      <T>{t("The Hype Person")}</T>
      <Big>{s.hype}</Big>
      <Sub>{t("Started {pct} of all conversations. The engine of this group.", { pct: s.convStarterPct })}</Sub>
      <AICard label={t("Why {name} is the hype", { name: s.hype })} value={ai?.hypePersonReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL} feedback={feedback("The Kindest One", 7)}>
      <T>{t("The Kindest One")}</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "—")}</Big>
      <AICard label={t("The sweetest moment")} value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL} feedback={feedback("The Funny One", 8)}>
      <T>{t("The Funny One")}</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label={t("Drops lines like")} value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL} feedback={feedback("Group spirit emoji", 9)}>
      <T>{t("Group spirit emoji")}</T>
      <div style={{fontSize:90,textAlign:"center",marginTop:16,lineHeight:1,width:"100%"}}>{s.spiritEmoji[0]}</div>
      <Sub>{t("This one emoji basically summarises the entire group energy.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL} feedback={feedback("Top 10 most used words", 10)}>
      <T>{t("Top 10 most used words")}</T>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL} feedback={feedback("The Novelist", 11)}>
      <T>{t("The Novelist")}</T>
      <Big>{s.novelist}</Big>
      <div style={{display:"flex",gap:0,marginTop:12,width:"100%",justifyContent:"space-around"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[[...s.names].sort((a,b)=>s.msgCounts[s.names.indexOf(b)]-s.msgCounts[s.names.indexOf(a)]).indexOf(s.novelist)]||s.avgMsgLen[0]}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("avg chars")}</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.novelistMaxLen.toLocaleString()}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>{t("longest message")}</div>
        </div>
      </div>
      {s.novelistLongestTopic && <Sub mt={8}>{t("Their longest message was mostly about \"{topic}\".", { topic: s.novelistLongestTopic })}</Sub>}
      <Quip>{pick(t("quips.group.novelist", { name: s.novelist }), `group-novelist|${s.names.join("|")}|${s.totalMessages}|${s.novelist}|${s.novelistMaxLen}`)}</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL} feedback={feedback("Group roles", 12)}>
      <T>Group roles</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        <Cell label={s.photographerIsVoice ? "Voice Note Addict" : "Photographer"} value={s.photographer} />
        <Cell label="The Therapist" value={s.therapist} />
        <Cell label="Night owl" value={s.nightOwl} />
        <Cell label="Early bird" value={s.earlyBird} />
        <Cell label="Voice memo king" value={s.voiceChampion} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={13} total={TOTAL} feedback={feedback("What you actually talk about", 13)}>
      <T>{t("What you actually talk about")}</T>
      <AICard label={t("Biggest topic")} value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label={t("The inside joke")} value={ai?.insideJoke} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL} feedback={feedback("The Drama Report", 14)}>
      <T>{t("The Drama Report")}</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label={t("How they do it")} value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL} feedback={feedback("Most missed member", 15)}>
      <T>{t("Most missed member")}</T>
      <Big>{aiLoading?"...":(ai?.mostMissed||s.names[0])}</Big>
      <Sub>{t("When they go quiet, the group feels it.")}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL} feedback={feedback("The group read", 16)}>
      <T>{t("The group read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL} feedback={feedback("Group vibe", 17)}>
      <T>{t("Group vibe")}</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||t("Chaotic. Wholesome. Somehow still going."))}
      </div>
      <MomentsRow moments={ai?.memorableMoments} loading={aiLoading} />
      <Sub mt={14}>{t("Powered by AI — analysed securely, never stored.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL} feedback={feedback("Group pattern read", 1)}>
      <T>{t("Group pattern read")}</T>
      <AICard label={t("Group dynamic")} value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label={t("Most tense moment")} value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL} feedback={feedback("Evidence log", 2)}>
      <T>{t("Evidence log")}</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL} feedback={feedback("What the chat shows", 3)}>
      <T>{t("What the chat shows")}</T>
      <FlagList flags={groupFlags} loading={aiLoading && !groupFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL} feedback={feedback("Toxicity scorecard", 4)}>
      <T>{t("Toxicity scorecard")}</T>
      <Big>{aiLoading && !toxicName ? "..." : toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,4).map((n,i)=><Bar key={n} value={s.toxicityScores[i]} max={toxicMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      <AICard label={t("Why this person scores highest")} value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL} feedback={feedback("Support and strain", 5)}>
      <T>{t("Support and strain")}</T>
      <AICard label={t("Who keeps it going")} value={s.hype ? t("{name} started {pct} of conversations.", { name: s.hype, pct: s.convStarterPct }) : t("The group shares the conversation starts.")} loading={false} />
      <AICard label={t("Who goes quiet")} value={s.ghost ? t("{name} is the least active member in the sampled history.", { name: s.ghost }) : t("No clear ghost in this sample.")} loading={false} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={6} total={TOTAL} feedback={feedback("Toxicity report", 6)}>
      <T>{t("Toxicity report")}</T>
      <Big>{toxicityLevel}</Big>
      <AICard label={t("Overall read")} value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label={t("Score breakdown")} value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>{t("This mode is meant to surface patterns and examples, not make the decision for you.")}</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// SCORE RING — animated circular score display
// ─────────────────────────────────────────────────────────────────
export function ScoreRing({ score, max=10, size=110, color="#fff" }) {
  const [pct, setPct] = useState(0);
  useEffect(() => { const t = setTimeout(() => setPct(score / max), 150); return () => clearTimeout(t); }, [score, max]);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:size > 90 ? 28 : 20, fontWeight:800, color:"#fff", lineHeight:1 }}>{score}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginTop:2 }}>/{max}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TRIAL REPORT SCREENS
// ─────────────────────────────────────────────────────────────────
export const TRIAL_SCREENS = 7;

export function TrialReportScreen({ s, ai, aiLoading, step, back, next }) {
  const t = useT();
  // Every Shell in this screen is a themed section (trial/upload), so light
  // theme means cream background: inline ink must flip with the theme.
  const { theme } = useTheme();
  const lightInk = theme === "light";
  const inkText  = lightInk ? "#1f184e" : "#fff";
  const inkLabel = lightInk ? "rgba(31,24,78,0.45)" : "rgba(255,255,255,0.4)";
  const loading = aiLoading && !ai;
  const [openPack, setOpenPack] = useState("vibe");
  const names = s.names || [];
  const msgCounts = s.msgCounts || [];
  const colors = ["#E06030", "#4A90D4", "#3ABDA0", "#C4809A", "#8A70D4", "#D4A840"];
  const topMembers = names.slice(0, Math.min(s.isGroup ? 5 : 2, names.length));
  const maxMessages = Math.max(...msgCounts, 1);
  const mediaTotal = (s.mediaCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const voiceTotal = (s.voiceCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const linkTotal = (s.linkCounts || []).reduce((sum, count) => sum + (count || 0), 0);
  const topMonth = s.topMonths?.[0];
  const ghostValue = s.isGroup
    ? (s.ghost || "—")
    : (s.ghostEqual ? t("Balanced") : (s.ghostName || "—"));
  const firstCardTitle = s.isGroup ? "Group snapshot" : "Chat snapshot";
  const screens = [
    <Shell sec="trial" prog={1} total={TRIAL_SCREENS + 2}>
      <T>{t(firstCardTitle)}</T>
      <Sub mt={4}>{names.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}</Sub>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:8 }}>
        <Cell label={t("Messages")} value={s.totalMessages?.toLocaleString() || "—"} />
        <Cell label={t(s.isGroup ? "People" : "Chatters")} value={names.length || "—"} />
        <Cell label={t("Best streak")} value={t("{count} days", { count: s.streak || 0 })} />
        <Cell label={t("Top month")} value={topMonth ? `${topMonth[0]} · ${topMonth[1].toLocaleString()}` : "—"} />
      </div>
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="trial" prog={2} total={TRIAL_SCREENS + 2}>
      <T>{t(s.isGroup ? "Who carries the chat?" : "Message balance")}</T>
      <div style={{ width:"100%", marginTop:12 }}>
        {topMembers.map((name, i) => (
          <Bar key={name} value={msgCounts[i] || 0} max={maxMessages} color={colors[i % colors.length]} label={name} delay={i * 90} />
        ))}
      </div>
      <Sub mt={12}>
        {s.isGroup
          ? t("{name} is the main character in this sample.", { name: s.mainChar || names[0] || "—" })
          : t("{pct}% of all messages came from {name}.", {
              pct: Math.round(((msgCounts[0] || 0) / Math.max(s.totalMessages || 1, 1)) * 100),
              name: names[0] || "—",
            })}
      </Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={3} total={TRIAL_SCREENS + 2}>
      <T>{t("Conversation rhythm")}</T>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:8 }}>
        <Cell label={t(s.isGroup ? "Main character" : "Ghost award")} value={s.isGroup ? (s.mainChar || "—") : ghostValue} />
        <Cell label={t(s.isGroup ? "The ghost" : "Reply times")} value={s.isGroup ? (s.ghost || "—") : (s.ghostAvg?.join(" / ") || "—")} />
        <Cell label={t("Starts most")} value={s.convStarter || "—"} />
        <Cell label={t("Last word")} value={s.convKiller || "—"} />
      </div>
      <Sub mt={12}>{t("Started {pct} of all conversations.", { pct: s.convStarterPct || "—" })}</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={4} total={TRIAL_SCREENS + 2}>
      <T>{t("Chat texture")}</T>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:inkLabel, marginBottom:6, marginTop:4 }}>{t("Most used words")}</div>
      <Words words={s.topWords} bigrams={s.topBigrams} />
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:inkLabel, marginBottom:6, marginTop:10 }}>{t("Stats")}</div>
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        <Cell label={t("Media")} value={mediaTotal.toLocaleString()} />
        <Cell label={t("Voice")} value={voiceTotal.toLocaleString()} />
        <Cell label={t("Links")} value={linkTotal.toLocaleString()} />
      </div>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:inkLabel, marginBottom:4, marginTop:10 }}>{t("Most used emojis")}</div>
      <div style={{ width:"100%", background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"12px 16px", fontSize:22, letterSpacing:4 }}>
        {(Array.isArray(s.spiritEmoji) ? s.spiritEmoji.join(" ") : s.spiritEmoji) || "💬"}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={5} total={TRIAL_SCREENS + 2}>
      <T>{t("How you connect")}</T>
      <Sub mt={4}>{t("Two reads from the AI.")}</Sub>
      <AICard label={t("How you communicate")}    value={ai?.pattern}  loading={loading} />
      <AICard label={t("Most interesting thing")} value={ai?.takeaway} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={6} total={TRIAL_SCREENS + 2}>
      <T>{t("The vibe")}</T>
      <AICard label={t("Chat vibe")} value={ai?.vibe} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="trial" prog={7} total={TRIAL_SCREENS + 2}>
      <T>{t("Your summary")}</T>
      <Sub mt={4}>{t("A short version of what stood out in this chat.")}</Sub>
      <AICard label={t("Chat vibe")} value={ai?.vibe} loading={loading} />
      <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Cell label={t("Messages")} value={s.totalMessages?.toLocaleString() || "—"} />
        <Cell label={t("Best streak")} value={t("{count} days", { count: s.streak || 0 })} />
        <Cell label={t("Top month")} value={topMonth ? `${topMonth[0]} · ${topMonth[1].toLocaleString()}` : "—"} />
        <Cell label={t(s.isGroup ? "People" : "Chatters")} value={names.length || "—"} />
      </div>
      <div style={{ width:"100%", background:lightInk ? "rgba(31,24,78,0.06)" : "rgba(255,255,255,0.06)", border:`1px solid ${lightInk ? "rgba(31,24,78,0.14)" : "rgba(255,255,255,0.12)"}`, borderRadius:18, padding:"13px 16px", color:lightInk ? "rgba(31,24,78,0.72)" : "rgba(255,255,255,0.70)", fontSize:13, lineHeight:1.55, textAlign:"center" }}>
        {t("There is a lot more to read in this chat. See the packs to unlock the deeper reports.")}
      </div>
      <Nav back={back} next={next} nextLabel="See packs" showArrow={false} />
    </Shell>,

    <Shell sec="upload" prog={TRIAL_SCREENS + 1} total={TRIAL_SCREENS + 2} contentAlign="start" hidePill hideChromeButtons>
          <div style={{ alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))", padding:"16px 20px 0", minHeight:0, overflow:"hidden" }}>
            <div style={{ marginBottom:18, flexShrink:0 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, fontWeight:900, color:inkText, letterSpacing:"-0.02em", lineHeight:1.1, textAlign:"left" }}>
                Here's what you can unlock.
              </div>
            </div>
            <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, paddingBottom:16 }}>
              {PACK_ORDER.map(id => {
                const pack = PACK_DEFS[id];
                const open = openPack === id;
                const reportCount = pack.reports.length;
                return (
                  <div key={id} onClick={() => setOpenPack(cur => cur === id ? null : id)} className="wc-btn"
                    style={{ borderRadius:22, overflow:"hidden", cursor:"pointer", background:pack.bg, border:`1.5px solid ${pack.accent}55`, flexShrink:0 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:open ? "16px 18px 12px" : "16px 18px", transition:"padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                        <PackSwatch pack={pack} />
                        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:"#fff", letterSpacing:"-0.015em", textAlign:"left" }}>{pack.name}</div>
                          <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", color:pack.accent, textAlign:"left" }}>{reportCount} {reportCount === 1 ? t("report") : t("reports")}</div>
                        </div>
                      </div>
                      <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(255,255,255,0.10)", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.50)", fontSize:13, transform:open ? "rotate(180deg)" : "none", transition:"transform 0.28s cubic-bezier(0.2,0,0.1,1)", flexShrink:0 }}>▾</div>
                    </div>
                    <div style={{ maxHeight:open ? 200 : 0, overflow:"hidden", opacity:open ? 1 : 0, padding:open ? "0 18px 16px" : "0 18px", transition:"max-height 0.35s cubic-bezier(0.2,0,0.1,1), opacity 0.22s ease, padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                      <div style={{ fontSize:13, color:"rgba(255,255,255,0.60)", lineHeight:1.55, marginBottom:12, textAlign:"left" }}>{PACK_EXPLAINER_DESCS[id]}</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {pack.reports.map(r => {
                          const rc = REPORT_PILL_STYLE[r] || {};
                          return <span key={r} style={{ background:rc.bg, border:`1px solid ${rc.border}`, borderRadius:999, padding:"4px 11px", fontSize:11, fontWeight:700, color:rc.text }}>{REPORT_LABELS_EXP[r] || r}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ flexShrink:0, paddingBottom:"calc(16px + env(safe-area-inset-bottom, 0px))", paddingTop:10 }}>
              <Nav back={back} next={next} nextLabel="See pricing" showArrow={false} />
            </div>
          </div>
        </Shell>,
  ];
  return screens[step] ?? null;
}

export function CreditPackGrid({ accent = DA.teal, disabled = true }) {
  const t = useT();
  return (
    <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
      {CREDIT_PACKS.map(pack => (
        <button
          key={pack.id}
          type="button"
          disabled={disabled}
          className="wc-btn"
          style={{
            background:"rgba(255,255,255,0.07)",
            border:"1px solid rgba(255,255,255,0.14)",
            borderRadius:18,
            padding:"14px 10px",
            textAlign:"center",
            cursor:disabled ? "not-allowed" : "pointer",
            opacity:disabled ? 0.86 : 1,
            color:"#fff",
          }}
          title={disabled ? "Payments coming soon" : pack.label}
        >
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", color:accent, marginBottom:4, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
            <span>{pack.label}</span>
            {pack.recommended && <SolidStarIcon size={10} color={accent} />}
          </div>
          <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>{pack.credits}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginBottom:4 }}>{t("credits")}</div>
          <div style={{ fontSize:13, fontWeight:800, color:accent }}>{pack.priceLabel}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.36)", lineHeight:1.35, marginTop:6 }}>
            {pack.recommended ? "Recommended" : "One-time credits"}
          </div>
        </button>
      ))}
    </div>
  );
}

export function PricingCostOverview({ accent = DA.teal, compact = false }) {
  const t = useT();
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ width:"100%", background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:18, padding:"12px 14px" }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.09em", textTransform:"uppercase", color:accent, marginBottom:8 }}>{t("Bundles")}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:7 }}>
          {PACK_ORDER.map(id => {
            const pack = PACK_DEFS[id];
            return (
            <div key={pack.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"8px 0", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{t(pack.name)}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.42)", lineHeight:1.4 }}>{pack.tags.map(label => t(label)).join(" + ")}</div>
              </div>
              <div style={{ fontSize:12, fontWeight:900, color:accent, whiteSpace:"nowrap" }}>{pack.cost} {t("cr")}</div>
            </div>
          );})}
        </div>
      </div>

      {!compact && (
        <div style={{ width:"100%", background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:18, padding:"12px 14px" }}>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.09em", textTransform:"uppercase", color:accent, marginBottom:8 }}>{t("Credit rules")}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:6 }}>
            {["Credits never expire.", "One-time purchases only.", "No subscriptions."].map(line => (
              <div key={line} style={{ fontSize:12, color:"rgba(255,255,255,0.62)" }}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PACK_EXPLAINER_DESCS = {
  vibe:   "Who talks more, how love and care show up in the text, and the emotional energy you two actually bring to each other.",
  rf:     "The uncomfortable read. Toxic language patterns, passive aggression, who apologizes — and who deflects.",
  full:   "Every report in one run. Connection, love language, energy, tension, accountability, and how the relationship has evolved.",
  growth: "Tracks this chat across time — early messages vs. recent ones. Is this relationship deepening, or slowly fading?",
};

const REPORT_PILL_STYLE = {
  general:  { text:"rgba(155,114,255,1)",  bg:"rgba(155,114,255,0.14)", border:"rgba(155,114,255,0.32)" },
  lovelang: { text:"rgba(255,130,184,1)",  bg:"rgba(255,130,184,0.14)", border:"rgba(255,130,184,0.30)" },
  energy:   { text:"rgba(255,160,48,1)",   bg:"rgba(255,160,48,0.14)",  border:"rgba(255,160,48,0.28)"  },
  toxicity: { text:"rgba(255,60,64,1)",    bg:"rgba(255,60,64,0.14)",   border:"rgba(255,60,64,0.30)"   },
  accounta: { text:"rgba(90,173,255,1)",   bg:"rgba(90,173,255,0.14)",  border:"rgba(90,173,255,0.28)"  },
  growth:   { text:"rgba(40,234,168,1)",   bg:"rgba(40,234,168,0.14)",  border:"rgba(40,234,168,0.28)"  },
};

const REPORT_LABELS_EXP = {
  general:  "General Wrapped",
  lovelang: "Love Language",
  energy:   "Energy",
  toxicity: "Toxicity",
  accounta: "Accountability",
  growth:   "Growth",
};


export function TrialFinale({ back, credits = null, userId = null, onPaymentComingSoon, onPurchaseCredits = null }) {
  return (
    <ShareResultsContext.Provider value={null}>
      <PaymentScreen preselect="vibe" credits={credits} userId={userId} onBack={back} onPaymentComingSoon={onPaymentComingSoon} onPurchaseCredits={onPurchaseCredits} />
    </ShareResultsContext.Provider>
  );
}

export const TOXICITY_SCREENS = 10;
export function ToxicityReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personAName = ai?.healthScores?.[0]?.name || s.names[0] || "Person A";
  const personBName = ai?.healthScores?.[1]?.name || s.names[1] || s.names[0] || "Person B";
  const powerHolderName = reportControl(ai?.powerHolder || "");
  const powerGuessValid = (ai?.powerGuessThreshold ?? false) && !!powerHolderName && powerHolderName !== reportControl("Balanced");
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "toxicity", cardIndex, cardTitle } : null
  );
  const screens = [
    // Card 1 — Chat health intro (score ring removed — it lands at the end after evidence)
    <Shell sec="toxicity" prog={1} total={TOXICITY_SCREENS} feedback={feedback("Chat health", 1)}>
      <T>{t("Chat health")}</T>
      <AICard label={t("Overall read")} value={ai?.verdict} loading={loading} />
      <Sub mt={8}>{t("Based on conflict patterns, communication style, and overall dynamic.")}</Sub>
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Individual health scores
    <Shell sec="toxicity" prog={2} total={TOXICITY_SCREENS} feedback={feedback("Individual health scores", 2)}>
      <T>{t("Individual health scores")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:16 }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,score:5,detail:"Analysing…"})) : (ai?.healthScores||[])).map((p, i) => (
          <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", display:"flex", alignItems:"center", gap:14 }}>
            <ScoreRing score={loading ? 0 : (p.score||5)} max={10} size={80} color={i===0?"#E06030":"#4A90D4"} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff", marginBottom:4 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{loading ? "…" : (p.detail||"—")}</div>
            </div>
          </div>
        ))}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    // Card 3 — Guess who apologises more (new — GuessCard)
    // onReveal auto-advances to card 4 which shows the full context
    <Shell sec="toxicity" prog={3} total={TOXICITY_SCREENS} feedback={feedback("Guess who apologises more", 3, ai?.apologyGuessThreshold)}>
      <GuessCard
        question={t("Who do you think apologises more?")}
        options={[personAName, personBName]}
        correctAnswer={ai?.apologiesLeader?.name || ""}
        confidenceValid={ai?.apologyGuessThreshold ?? false}
        onReveal={next}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{t("Who apologises more")}</T>
            <Big>{loading ? "…" : (ai?.apologiesLeader?.name || "—")}</Big>
          </>
        }
      />
    </Shell>,

    // Card 4 — Who apologises more (detailed context)
    <Shell sec="toxicity" prog={4} total={TOXICITY_SCREENS} feedback={feedback("Who apologises more", 4)}>
      <T>{t("Who apologises more")}</T>
      <Big>{loading ? "…" : (ai?.apologiesLeader?.name || s.names[0])}</Big>
      <AICard label={`${(loading?"…":ai?.apologiesLeader?.name) || s.names[0]} — context`} value={ai?.apologiesLeader?.context} loading={loading} />
      <AICard label={`${(loading?"…":ai?.apologiesOther?.name) || s.names[1]||s.names[0]} — context`} value={ai?.apologiesOther?.context} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 5 — A moment from the conflict (replaces Red Flag Moments list — AttributionCard)
    <Shell sec="toxicity" prog={5} total={TOXICITY_SCREENS} feedback={feedback("A moment from the conflict", 5)}>
      {aiLoading && !ai?.heavyAttributionQuote ? (
        <>
          <T>{t("A moment from the conflict")}</T>
          <div style={{ marginTop:24 }}><Dots /></div>
        </>
      ) : ai?.heavyAttributionQuote?.quote ? (
        <AttributionCard
          quote={ai.heavyAttributionQuote.quote}
          participants={[personAName, personBName]}
          correctSender={ai.heavyAttributionQuote.person || ""}
          contextParagraph={ai.heavyAttributionQuote.contextParagraph || ""}
          isSensitive={ai.heavyAttributionQuote.isSensitive}
          label={t("A moment from the conflict")}
        />
      ) : (
        <>
          <T>{t("A moment from the conflict")}</T>
          <AICard label={t("Conflict pattern")} value={ai?.conflictPattern} loading={loading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — Conflict pattern
    <Shell sec="toxicity" prog={6} total={TOXICITY_SCREENS} feedback={feedback("Conflict pattern", 6)}>
      <T>{t("Conflict pattern")}</T>
      <AICard label={t("How arguments unfold")} value={ai?.conflictPattern} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 7 — Guess who steers the emotional tone (new — GuessCard)
    // onReveal auto-advances to card 8 which shows the full power dynamic
    <Shell sec="toxicity" prog={7} total={TOXICITY_SCREENS} feedback={feedback("Guess who steers the tone", 7, powerGuessValid)}>
      <GuessCard
        question={t("Who seems to steer the emotional tone?")}
        options={[personAName, personBName]}
        correctAnswer={powerHolderName}
        confidenceValid={powerGuessValid}
        onReveal={next}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{t("Power balance")}</T>
            <Big>{loading ? "…" : (powerHolderName || t("Balanced"))}</Big>
          </>
        }
      />
    </Shell>,

    // Card 8 — Power balance (detailed context)
    <Shell sec="toxicity" prog={8} total={TOXICITY_SCREENS} feedback={feedback("Power balance", 8)}>
      <T>{t("Power balance")}</T>
      <Big>{loading ? "…" : reportControl(ai?.powerHolder || t("Balanced"))}</Big>
      <AICard label={t("Power dynamic")} value={ai?.powerBalance} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — What's still here (new)
    <Shell sec="toxicity" prog={9} total={TOXICITY_SCREENS} feedback={feedback("What's still here", 9)}>
      <T>{t("What's still here")}</T>
      <AICard label={t("What remained through it all")} value={ai?.whatStillHere} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — The verdict (score ring lives here — after all the evidence)
    <Shell sec="toxicity" prog={10} total={TOXICITY_SCREENS} feedback={feedback("The verdict", 10)}>
      <T>{t("The verdict")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore||5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={8}>{t("Overall chat health score.")}</Sub>
      <AICard label={t("Final read")} value={ai?.verdict} loading={loading} />
      <Sub mt={8}>{t("Reflects patterns in this sample — not a final judgment.")}</Sub>
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// LOVE LANGUAGE REPORT SCREENS  (10 cards)
// ─────────────────────────────────────────────────────────────────
export const LOVELANG_SCREENS = 10;
export function LoveLangReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personAName = ai?.personA?.name || s.names[0] || "Person A";
  const personBName = ai?.personB?.name || s.names[1] || s.names[0] || "Person B";
  const langA = reportControl(ai?.personA?.language || "");
  const langB = reportControl(ai?.personB?.language || "");
  const guessOptions = [...new Set([langA, langB].filter(Boolean))];
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "lovelang", cardIndex, cardTitle } : null
  );
  const screens = [
    // Card 1 — Love languages in this chat (intro — new)
    <Shell sec="lovelang" prog={1} total={LOVELANG_SCREENS} feedback={feedback("Love languages in this chat", 1)}>
      <T>{t("Love languages in this chat")}</T>
      <AICard label={t("The overall pattern")} value={ai?.loveLanguageIntro} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Guess A's love language (new — GuessCard)
    // onReveal auto-advances to card 3 which shows the full language + examples
    <Shell sec="lovelang" prog={2} total={LOVELANG_SCREENS} feedback={feedback("Guess A's love language", 2, ai?.loveLanguageGuessValid)}>
      <GuessCard
        question={loading ? "…" : t("Which love language describes {name}?", { name: personAName })}
        options={guessOptions}
        correctAnswer={langA}
        confidenceValid={(ai?.loveLanguageGuessValid ?? false) && guessOptions.length >= 2}
        onReveal={next}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{loading ? "…" : t("{name}'s love language", { name: personAName })}</T>
            <Big>{loading ? "…" : (langA || "—")}</Big>
          </>
        }
      />
    </Shell>,

    // Card 3 — Person A's love language (existing)
    <Shell sec="lovelang" prog={3} total={LOVELANG_SCREENS} feedback={feedback(`${personAName}'s love language`, 3)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: personAName })}</T>
      <Big>{loading ? "…" : (langA || "—")}</Big>
      <AICard label={t("How they show it")} value={ai?.personA?.examples} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 4 — Person B's love language (existing)
    <Shell sec="lovelang" prog={4} total={LOVELANG_SCREENS} feedback={feedback(`${personBName}'s love language`, 4)}>
      <T>{loading ? "…" : t("{name}'s love language", { name: personBName })}</T>
      <Big>{loading ? "…" : (langB || "—")}</Big>
      <AICard label={t("How they show it")} value={ai?.personB?.examples} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 5 — The language gap (existing)
    <Shell sec="lovelang" prog={5} total={LOVELANG_SCREENS} feedback={feedback("The language gap", 5)}>
      <T>{t("The language gap")}</T>
      <AICard label={t("Do they speak the same language?")} value={ai?.mismatch} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — The Miss (new)
    <Shell sec="lovelang" prog={6} total={LOVELANG_SCREENS} feedback={feedback("The miss", 6)}>
      <T>{t("The miss")}</T>
      <AICard label={t("What happened")} value={ai?.loveMiss?.description} loading={loading} />
      {!loading && ai?.loveMiss?.quote && (
        <div style={{ fontSize:14, fontStyle:"italic", color:"rgba(255,255,255,0.80)", lineHeight:1.6, borderLeft:"3px solid rgba(240,142,191,0.5)", paddingLeft:14, marginTop:4 }}>
          "{ai.loveMiss.quote}"
        </div>
      )}
      {!loading && ai?.loveMiss?.persons?.length >= 2 && (
        <Sub mt={8}>{ai.loveMiss.persons.join(" → ")}</Sub>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 7 — The Unspoken Moment (new)
    <Shell sec="lovelang" prog={7} total={LOVELANG_SCREENS} feedback={feedback("The unspoken moment", 7)}>
      <T>{t("The unspoken moment")}</T>
      <AICard label={t("What wasn't said")} value={ai?.loveMissUnspoken} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 8 — Most loving moment (existing)
    <Shell sec="lovelang" prog={8} total={LOVELANG_SCREENS} feedback={feedback("Most loving moment", 8)}>
      <T>{t("Most loving moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostLovingMoment} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — How it shows (new — AttributionCard)
    <Shell sec="lovelang" prog={9} total={LOVELANG_SCREENS} feedback={feedback("How it shows", 9)}>
      {aiLoading && !ai?.mostLovingMomentAttribution ? (
        <>
          <T>{t("How it shows")}</T>
          <div style={{ marginTop:24 }}><Dots /></div>
        </>
      ) : ai?.mostLovingMomentAttribution?.quote ? (
        <AttributionCard
          quote={ai.mostLovingMomentAttribution.quote}
          participants={[personAName, personBName]}
          correctSender={ai.mostLovingMomentAttribution.people?.[0] || ""}
          contextParagraph={ai.mostLovingMomentAttribution.read || ai.mostLovingMomentAttribution.title || ""}
          isSensitive={false}
          label={t("Who showed love here?")}
        />
      ) : (
        <>
          <T>{t("How it shows")}</T>
          <AICard label={t("Most loving moment")} value={ai?.mostLovingMoment} loading={loading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — Love language compatibility (closing — ScoreRing moved to end)
    <Shell sec="lovelang" prog={10} total={LOVELANG_SCREENS} feedback={feedback("Love language compatibility", 10)}>
      <T>{t("Love language compatibility")}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.compatibilityScore||5)} max={10} size={130} color="#F08EBF" />
      </div>
      <AICard label={t("Compatibility read")} value={ai?.compatibilityRead} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// GROWTH REPORT SCREENS  (10 cards)
// ─────────────────────────────────────────────────────────────────
export const GROWTH_SCREENS = 10;
export function GrowthReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const arrowMap = { deeper:"↑", shallower:"↓", "about the same":"→" };
  const trajMap  = { closer:"Getting closer", drifting:"Drifting apart", stable:"Holding steady" };
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "growth", cardIndex, cardTitle } : null
  );
  const personAName = ai?.personAName || s.names[0] || "Person A";
  const personBName = ai?.personBName || s.names[1] || s.names[0] || "Person B";
  const screens = [
    // Card 1 — Then vs Now
    <Shell sec="growth" prog={1} total={GROWTH_SCREENS} feedback={feedback("Then vs Now", 1)}>
      <T>{t("Then vs Now")}</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
        <AICard label={t("Early messages")} value={ai?.thenDepth} loading={loading} />
        <AICard label={t("Recent messages")} value={ai?.nowDepth} loading={loading} />
      </div>
      {!loading && ai?.depthChange && (
        <Sub mt={8}>Conversations got <strong style={{color:"#3AF0C0"}}>{reportControl(ai.depthChange)}</strong> {arrowMap[ai.depthChange]||""} over time.</Sub>
      )}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Person A's Arc (new)
    <Shell sec="growth" prog={2} total={GROWTH_SCREENS} feedback={feedback("Person A's arc", 2)}>
      <T>{loading ? "…" : t("{name}'s arc", { name: personAName })}</T>
      <AICard label={t("How they changed")} value={ai?.personAArc} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 3 — Person B's Arc (new)
    <Shell sec="growth" prog={3} total={GROWTH_SCREENS} feedback={feedback("Person B's arc", 3)}>
      <T>{loading ? "…" : t("{name}'s arc", { name: personBName })}</T>
      <AICard label={t("How they changed")} value={ai?.personBArc} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 4 — Guess Who Changed More (new — GuessCard)
    // onReveal auto-advances to card 5 which shows the full explanation
    <Shell sec="growth" prog={4} total={GROWTH_SCREENS} feedback={feedback("Guess who changed more", 4, ai?.growthGuessThreshold)}>
      <GuessCard
        question={t("Who do you think changed more?")}
        options={[personAName, personBName]}
        correctAnswer={ai?.whoChangedMore || ""}
        confidenceValid={ai?.growthGuessThreshold ?? false}
        onReveal={next}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{t("Who changed more")}</T>
            <Big>{loading ? "…" : (ai?.whoChangedMore || "—")}</Big>
          </>
        }
      />
    </Shell>,

    // Card 5 — How they changed (detailed follow-up to the guess)
    <Shell sec="growth" prog={5} total={GROWTH_SCREENS} feedback={feedback("How they changed", 5)}>
      <T>{t("How they changed")}</T>
      <AICard label={t("The shift")} value={ai?.whoChangedHow} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — What changed in the chat
    <Shell sec="growth" prog={6} total={GROWTH_SCREENS} feedback={feedback("What changed in the chat", 6)}>
      <T>{t("What changed in the chat")}</T>
      <AICard label={t("Topics that appeared")} value={ai?.topicsAppeared} loading={loading} />
      <AICard label={t("Topics that faded")} value={ai?.topicsDisappeared} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 7 — The Turning Point (new)
    <Shell sec="growth" prog={7} total={GROWTH_SCREENS} feedback={feedback("The turning point", 7)}>
      <T>{t("The turning point")}</T>
      {ai?.turningPoint ? (
        <Big>{loading ? "…" : ai.turningPoint}</Big>
      ) : aiLoading ? (
        <div style={{marginTop:24}}><Dots /></div>
      ) : (
        <Sub mt={14}>{t("No clear turning point detected.")}</Sub>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 8 — The Message That Shifted Everything (new — AttributionCard)
    <Shell sec="growth" prog={8} total={GROWTH_SCREENS} feedback={feedback("The message that shifted everything", 8)}>
      {aiLoading && !ai?.messageAtTurningPoint ? (
        <>
          <T>{t("The message that shifted everything")}</T>
          <div style={{marginTop:24}}><Dots /></div>
        </>
      ) : ai?.messageAtTurningPoint?.quote ? (
        <AttributionCard
          quote={ai.messageAtTurningPoint.quote}
          participants={[personAName, personBName]}
          correctSender={ai.messageAtTurningPoint.person || ""}
          contextParagraph={ai.messageAtTurningPoint.contextParagraph || ""}
          isSensitive={ai.messageAtTurningPoint.isSensitive}
          label={t("The message that shifted everything")}
        />
      ) : (
        <>
          <T>{t("The message that shifted everything")}</T>
          <AICard label={t("What the turning point looked like")} value={ai?.trajectoryDetail || ai?.arcSummary} loading={loading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — Relationship trajectory
    <Shell sec="growth" prog={9} total={GROWTH_SCREENS} feedback={feedback("Relationship trajectory", 9)}>
      <T>{t("Relationship trajectory")}</T>
      <Big>{loading ? "…" : (resultLang === "en" ? (trajMap[ai?.trajectory] || ai?.trajectory || "—") : reportControl(ai?.trajectory || "—"))}</Big>
      <AICard label={t("What the data shows")} value={ai?.trajectoryDetail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — The arc (closing)
    <Shell sec="growth" prog={10} total={GROWTH_SCREENS} feedback={feedback("The arc", 10)}>
      <T>{t("The arc")}</T>
      <AICard label={t("Overall read")} value={ai?.arcSummary} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ACCOUNTABILITY REPORT SCREENS  (10 cards)
// ─────────────────────────────────────────────────────────────────
export const ACCOUNTA_SCREENS = 10;

function hasPromiseMoment(moment) {
  const person = String(moment?.person || "").toLowerCase();
  return Boolean(moment?.promise || moment?.outcome) && person !== "none clearly identified";
}

export function PromiseMomentCard({ moment, emptyText }) {
  return (
    <div style={{ width:"100%", marginTop:16 }}>
      <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
        {hasPromiseMoment(moment) ? (
          <>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{moment?.date||""}{moment?.date&&moment?.person?" • ":""}{moment?.person||""}</div>
            <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{moment?.promise||"—"}"</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{moment?.outcome||""}</div>
          </>
        ) : (
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.72)", lineHeight:1.6 }}>{moment?.outcome || emptyText}</div>
        )}
      </div>
    </div>
  );
}

export function AccountaReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const personAName = ai?.personA?.name || s.names[0] || "Person A";
  const personBName = ai?.personB?.name || s.names[1] || s.names[0] || "Person B";
  const promiseLeader = (ai?.personA?.total ?? 0) >= (ai?.personB?.total ?? 0) ? personAName : personBName;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "accounta", cardIndex, cardTitle } : null
  );
  const screens = [
    // Card 1 — Promises made
    <Shell sec="accounta" prog={1} total={ACCOUNTA_SCREENS} feedback={feedback("Promises made", 1)}>
      <T>{t("Promises made")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {[ai?.personA, ai?.personB].filter(Boolean).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center" }}>
            <div style={{ fontSize:34, fontWeight:800, color:"#fff" }}>{loading ? "—" : (p.total||0)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:4 }}>{t("promises")}</div>
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)", marginTop:6 }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall verdict")} value={ai?.overallVerdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Guess who made more promises (new — GuessCard)
    <Shell sec="accounta" prog={2} total={ACCOUNTA_SCREENS} feedback={feedback("Guess who made more promises", 2, ai?.promiseGuessThreshold)}>
      <GuessCard
        question={t("Who do you think made more promises?")}
        options={[personAName, personBName]}
        correctAnswer={promiseLeader}
        confidenceValid={ai?.promiseGuessThreshold ?? false}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{t("More promises made")}</T>
            <Big>{loading ? "…" : promiseLeader}</Big>
          </>
        }
      />
    </Shell>,

    // Card 3 — Person A's accountability
    <Shell sec="accounta" prog={3} total={ACCOUNTA_SCREENS} feedback={feedback(`${personAName}'s accountability`, 3)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: personAName })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personA?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personA?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personA?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personA?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 4 — Person B's accountability
    <Shell sec="accounta" prog={4} total={ACCOUNTA_SCREENS} feedback={feedback(`${personBName}'s accountability`, 4)}>
      <T>{loading ? "…" : t("{name}'s accountability", { name: personBName })}</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personB?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personB?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("kept")}</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personB?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{t("broken")}</div>
        </div>
      </div>
      <AICard label={t("Pattern")} value={ai?.personB?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 5 — Fair comparison
    <Shell sec="accounta" prog={5} total={ACCOUNTA_SCREENS} feedback={feedback("Fair comparison", 5)}>
      <T>{t("Fair comparison")}</T>
      <AICard label={t("Both sides")} value={ai?.comparison} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — The Reliability Arc (new)
    <Shell sec="accounta" prog={6} total={ACCOUNTA_SCREENS} feedback={feedback("The reliability arc", 6)}>
      <T>{t("The reliability arc")}</T>
      <AICard label={t("Did reliability change over time?")} value={ai?.reliabilityArc} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 7 — Follow-through pattern
    <Shell sec="accounta" prog={7} total={ACCOUNTA_SCREENS} feedback={feedback("Follow-through pattern", 7)}>
      <T>{t("Follow-through pattern")}</T>
      <AICard label={t("Pattern")} value={ai?.followThroughPattern} loading={loading} />
      <AICard label={t("Evidence strength")} value={ai?.evidenceQuality} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 8 — The Promise That Changed Things (new — AttributionCard)
    <Shell sec="accounta" prog={8} total={ACCOUNTA_SCREENS} feedback={feedback("The promise that changed things", 8)}>
      {aiLoading && !ai?.promiseThatMattered ? (
        <>
          <T>{t("The promise that changed things")}</T>
          <div style={{ marginTop:24 }}><Dots /></div>
        </>
      ) : ai?.promiseThatMattered?.quote ? (
        <AttributionCard
          quote={ai.promiseThatMattered.quote}
          participants={[personAName, personBName]}
          correctSender={ai.promiseThatMattered.person || ""}
          contextParagraph={ai.promiseThatMattered.contextParagraph || ""}
          isSensitive={ai.promiseThatMattered.isSensitive}
          label={t("Who made this promise?")}
        />
      ) : (
        <>
          <T>{t("The promise that changed things")}</T>
          <AICard label={t("Most notable promise")} value={ai?.notableKept?.promise || ai?.overallVerdict} loading={loading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — Most notable broken promise
    <Shell sec="accounta" prog={9} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable broken promise", 9)}>
      <T>{t("Most notable broken promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <PromiseMomentCard moment={ai?.notableBroken} emptyText={t("No clear meaningful broken promise showed up strongly enough in this chat.")} />
      }
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — Most notable kept promise (closing)
    <Shell sec="accounta" prog={10} total={ACCOUNTA_SCREENS} feedback={feedback("Most notable kept promise", 10)}>
      <T>{t("Most notable kept promise")}</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <PromiseMomentCard moment={ai?.notableKept} emptyText={t("No clear meaningful kept promise showed up strongly enough in this chat.")} />
      }
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ENERGY REPORT SCREENS  (10 cards)
// ─────────────────────────────────────────────────────────────────
export const ENERGY_SCREENS = 10;
export function EnergyReportScreen({ s, ai, aiLoading, step, back, next, resultId }) {
  const t = useT();
  const loading = aiLoading && !ai;
  const resultLang = normalizeUiLangCode(ai?.displayLanguage || "en");
  const reportControl = (value) => translateControlValue(resultLang, value);
  const personAName = ai?.personA?.name || s.names[0] || "Person A";
  const personBName = ai?.personB?.name || s.names[1] || s.names[0] || "Person B";
  const energyLeader = (ai?.personA?.netScore ?? 0) >= (ai?.personB?.netScore ?? 0) ? personAName : personBName;
  const feedback = (cardTitle, cardIndex, enabled = true) => (
    enabled && resultId ? { resultId, reportType: "energy", cardIndex, cardTitle } : null
  );
  const screens = [
    // Card 1 — Net energy scores
    <Shell sec="energy" prog={1} total={ENERGY_SCREENS} feedback={feedback("Net energy scores", 1)}>
      <T>{t("Net energy scores")}</T>
      <div style={{ width:"100%", display:"flex", gap:16, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5,type:""})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={90} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>{loading ? "…" : reportControl(p.type || "")}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Energy compatibility")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    // Card 2 — Person A's energy
    <Shell sec="energy" prog={2} total={ENERGY_SCREENS} feedback={feedback(`${personAName}'s energy`, 2)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: personAName })}</T>
      <AICard label={t("Positive energy")} value={ai?.personA?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personA?.venting} loading={loading} />
      {!loading && ai?.personA?.hypeQuote && <Quip>"{ai.personA.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 3 — Person B's energy
    <Shell sec="energy" prog={3} total={ENERGY_SCREENS} feedback={feedback(`${personBName}'s energy`, 3)}>
      <T>{loading ? "…" : t("{name}'s energy", { name: personBName })}</T>
      <AICard label={t("Positive energy")} value={ai?.personB?.goodNews} loading={loading} />
      <AICard label={t("Draining patterns")} value={ai?.personB?.venting} loading={loading} />
      {!loading && ai?.personB?.hypeQuote && <Quip>"{ai.personB.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 4 — Guess who brings more positive energy (new — GuessCard)
    <Shell sec="energy" prog={4} total={ENERGY_SCREENS} feedback={feedback("Guess who lifts the chat more", 4, ai?.energyGuessValid)}>
      <GuessCard
        question={t("Who lifts the chat more?")}
        options={[personAName, personBName]}
        correctAnswer={energyLeader}
        confidenceValid={ai?.energyGuessValid ?? false}
        back={back}
        next={next}
        revealContent={
          <>
            <T>{t("More positive presence")}</T>
            <Big>{loading ? "…" : energyLeader}</Big>
          </>
        }
      />
    </Shell>,

    // Card 5 — The Dynamic (new)
    <Shell sec="energy" prog={5} total={ENERGY_SCREENS} feedback={feedback("The dynamic", 5)}>
      <T>{t("The dynamic")}</T>
      <AICard label={t("What happens when these two energies meet")} value={ai?.energyDynamic} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 6 — Most energising moment
    <Shell sec="energy" prog={6} total={ENERGY_SCREENS} feedback={feedback("Most energising moment", 6)}>
      <T>{t("Most energising moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostEnergising} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 7 — Most draining moment
    <Shell sec="energy" prog={7} total={ENERGY_SCREENS} feedback={feedback("Most draining moment", 7)}>
      <T>{t("Most draining moment")}</T>
      <AICard label={t("The moment")} value={ai?.mostDraining} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    // Card 8 — Energy by Time (new)
    <Shell sec="energy" prog={8} total={ENERGY_SCREENS} feedback={feedback("Energy by time", 8)}>
      <T>{t("Energy by time")}</T>
      {ai?.timeOfDay ? (
        <>
          <div style={{ display:"flex", gap:0, marginTop:16, width:"100%", justifyContent:"space-around", alignItems:"flex-start" }}>
            {[ai.timeOfDay.personA, ai.timeOfDay.personB].map((p, i) => (
              <div key={i} style={{ textAlign:"center" }}>
                <div style={{ fontSize:36, fontWeight:800, color:"#fff" }}>{p?.peakHour || "—"}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>{p?.peakDaypart || ""}</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4 }}>{p?.name || s.names[i]}</div>
              </div>
            ))}
          </div>
          {ai.timeOfDay.contrast && <Sub mt={14}>{ai.timeOfDay.contrast}</Sub>}
        </>
      ) : aiLoading ? (
        <div style={{ marginTop:24 }}><Dots /></div>
      ) : (
        <Sub mt={14}>{t("Not enough data to show.")}</Sub>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 9 — The Charge (new — AttributionCard)
    <Shell sec="energy" prog={9} total={ENERGY_SCREENS} feedback={feedback("The charge", 9)}>
      {aiLoading && !ai?.chargeAttribution ? (
        <>
          <T>{t("The charge")}</T>
          <div style={{ marginTop:24 }}><Dots /></div>
        </>
      ) : ai?.chargeAttribution?.quote ? (
        <AttributionCard
          quote={ai.chargeAttribution.quote}
          participants={[personAName, personBName]}
          correctSender={ai.chargeAttribution.people?.[0] || ""}
          contextParagraph={ai.chargeAttribution.read || ai.chargeAttribution.title || ""}
          isSensitive={false}
          label={t("Who changed the room's energy?")}
        />
      ) : (
        <>
          <T>{t("The charge")}</T>
          <AICard label={t("Most energising moment")} value={ai?.mostEnergising} loading={loading} />
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    // Card 10 — Energy compatibility (closing)
    <Shell sec="energy" prog={10} total={ENERGY_SCREENS} feedback={feedback("Energy compatibility", 10)}>
      <T>{t("Energy compatibility")}</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 12px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={72} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label={t("Overall read")} value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" showArrow={false} />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// PREMIUM FINALE — wrap-up for non-general reports
// ─────────────────────────────────────────────────────────────────
export function PremiumFinale({ s, restart, back, reportType, fromHistory = false }) {
  const t = useT();
  const closeResults = useContext(CloseResultsContext);
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const sec = rtype?.palette || "upload";
  const p = PAL[sec] || PAL.upload;
  const primaryAction = fromHistory ? closeResults : restart;
  const primaryLabel  = fromHistory ? t("My Results") : t("Start over");
  return (
    <Shell sec={sec} prog={1} total={1} shareType="summary">
      <T s={22}>{t(rtype?.label || "Report complete")}</T>
      <Sub mt={4}>{s.names?.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}</Sub>
      <div data-share-hide style={{ display:"flex", gap:10, marginTop:24, width:"100%" }}>
        <GhostButton onClick={back} style={{ flex:1, width:"auto", color:"rgba(255,255,255,0.78)", border:"1.5px solid rgba(255,255,255,0.22)" }}>← {t("Back")}</GhostButton>
        <PrimaryButton onClick={primaryAction} color={p.accent} textColor={p.bg} style={{ flex:1, width:"auto" }}>{primaryLabel}</PrimaryButton>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// FINALE
// ─────────────────────────────────────────────────────────────────
export function Finale({ s, ai, aiLoading, restart, back, prog, total, mode, resultId, fromHistory = false }) {
  const t = useT();
  const closeResults = useContext(CloseResultsContext);
  const share = useContext(ShareResultsContext);
  const [quizBusy,  setQuizBusy]  = useState(false);
  const [quizToast, setQuizToast] = useState("");

  async function handleSendChallenge() {
    if (quizBusy || !resultId) return;
    setQuizBusy(true);
    setQuizToast("");
    const url = await createQuizChallenge(resultId, s, ai?.signaturePhrase);
    setQuizBusy(false);
    if (!url) { setQuizToast("Couldn't create link — try again."); return; }
    try {
      if (navigator.share) {
        await navigator.share({ text: `I wrapped our chat — can you beat my score? 🎯`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setQuizToast("Link copied!");
        setTimeout(() => setQuizToast(""), 2500);
      }
    } catch { setQuizToast("Link ready — check your clipboard."); setTimeout(() => setQuizToast(""), 2500); }
  }
  const feedback = resultId && (mode === "redflags" || ai?.vibeOneLiner)
    ? { resultId, reportType: mode === "redflags" ? "toxicity" : "general", cardIndex: prog, cardTitle: mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup ? "Your group, unwrapped." : "Your chat, unwrapped.") }
    : null;
  const cells = mode === "redflags"
    ? (s.isGroup
      ? [
          {label:"Most toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Ghost",value:s.ghost},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ]
      : [
          {label:"Status guess",value:ai?.relationshipStatus || s.relationshipStatus || "—"},
          {label:"More toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ])
    : (s.isGroup
      ? [
          {label:"Main character",value:s.mainChar},
          {label:"The ghost",value:s.ghost},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Top month",value:s.topMonths[0]?.[0]},
        ]
      : [
          {label:"Most texts",value:s.names[0]},
          {label:"Ghost award",value:s.ghostName},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Spirit emojis",value:s.spiritEmoji.join(" ")},
          {label:"Best streak",value:t("{count} days", { count: s.streak })},
        ]);
  const title = mode === "redflags"
    ? t("Red flags, unwrapped.")
    : (s.isGroup ? t("Your group, unwrapped.") : t("Your chat, unwrapped."));
  const synthesis = !aiLoading && ai?.vibeOneLiner ? ai.vibeOneLiner : null;
  return (
    <Shell sec="finale" prog={prog} total={total} feedback={feedback} shareType="summary">
      {/* Names + count — small header */}
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.38)", fontWeight:600, letterSpacing:"0.04em", textAlign:"center" }}>
        {s.names?.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} {t("messages")}
      </div>

      {/* Main title */}
      <T s={22}>{title}</T>

      {/* Synthesis line — vibeOneLiner promoted to hero */}
      {synthesis && (
        <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 18px", width:"100%", fontSize:14, fontStyle:"italic", color:"rgba(255,255,255,0.82)", textAlign:"center", lineHeight:1.65, fontWeight:500 }}>
          "{synthesis}"
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, width:"100%" }}>
        {cells.map((c,i) => <Cell key={i} label={t(c.label)} value={c.value} />)}
      </div>

      {/* Challenge card — casual mode only */}
      {mode !== "redflags" && (
        <div data-share-hide style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 20,
          padding: "16px 18px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div style={{ fontSize:14, fontWeight:800, color:"#fff", letterSpacing:-0.2 }}>
            {t("Challenge a friend")}
          </div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.52)", lineHeight:1.55 }}>
            {t("Think they'd guess the same results? Share your wrapped and find out.")}
          </div>
          <button
            type="button"
            onClick={handleSendChallenge}
            disabled={quizBusy || !resultId}
            className="wc-btn"
            style={{
              padding: "11px 20px",
              borderRadius: 999,
              border: "none",
              background: PAL.finale.accent,
              color: PAL.finale.bg,
              fontSize: 13,
              fontWeight: 800,
              cursor: quizBusy || !resultId ? "wait" : "pointer",
              fontFamily: "inherit",
              alignSelf: "flex-start",
              letterSpacing: 0.1,
              opacity: !resultId ? 0.5 : 1,
            }}
          >
            {quizBusy ? t("Creating link…") : t("Send the challenge")}
          </button>
          {quizToast && (
            <div style={{ fontSize:12, color:"rgba(80,220,120,0.90)", fontWeight:600, animation:"wcFadeIn 200ms both" }}>
              {quizToast}
            </div>
          )}
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)", marginTop:2 }}>
            {t("Chat Memory Quiz — 6 questions about this chat.")}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div data-share-hide style={{ display:"flex", gap:10, width:"100%" }}>
        <GhostButton onClick={back} style={{ flex:1, width:"auto", color:"rgba(255,255,255,0.78)", border:"1.5px solid rgba(255,255,255,0.22)" }}>← {t("Back")}</GhostButton>
        {fromHistory
          ? <PrimaryButton onClick={closeResults} color={PAL.finale.accent} textColor={PAL.finale.bg} style={{ flex:1, width:"auto" }}>{t("My Results")}</PrimaryButton>
          : <PrimaryButton onClick={restart} color={PAL.finale.accent} textColor={PAL.finale.bg} style={{ flex:1, width:"auto" }}>{t("Start over")}</PrimaryButton>
        }
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP CONTEXT HELPERS
// ─────────────────────────────────────────────────────────────────

function relReadLabel(relType) {
  return {
    partner:   "Partnership read",
    family:    "Family dynamic",
    friend:    "Friendship read",
    colleague: "Work dynamic",
  }[relType] || "Relationship read";
}

function relReadTitle(relType, specificRelationship = null) {
  const specific = String(specificRelationship || "").trim().toLowerCase();
  if (/spouse/.test(specific)) return "Marriage dynamic";
  if (/partner/.test(specific)) return "Partnership read";
  if (/dating/.test(specific)) return "Dating dynamic";
  if (/ex/.test(specific)) return "Ex dynamic";
  if (/father and child/.test(specific)) return "Father-child dynamic";
  if (/mother and child/.test(specific)) return "Mother-child dynamic";
  if (/siblings/.test(specific)) return "Sibling dynamic";
  if (/cousins/.test(specific)) return "Cousin dynamic";
  if (/grandparent and grandchild/.test(specific)) return "Grandparent dynamic";
  if (/aunt\/uncle and niece\/nephew/.test(specific)) return "Extended family dynamic";
  if (/best friends/.test(specific)) return "Best-friend dynamic";
  if (/close friends/.test(specific)) return "Friendship read";
  if (/boss and employee/.test(specific)) return "Boss-work dynamic";
  if (/colleagues/.test(specific)) return "Work dynamic";
  if (/family members/.test(specific)) return "Family dynamic";
  return relReadLabel(relType);
}

function hasAcceptedCurrentTerms(user) {
  const meta = user?.user_metadata || {};
  return meta.terms_accepted === true && meta.terms_version === LEGAL_VERSION;
}

export function shouldShowQuickReadIntro(user) {
  const meta = user?.user_metadata || {};
  return meta.quick_read_intro_seen !== true && meta.quick_read_intro_completed !== true;
}

export function postAuthPhaseForUser(user) {
  const meta = user?.user_metadata || {};
  if (hasAcceptedCurrentTerms(user)) {
    if (!hasUserProvidedDisplayName(user)) return "profileName";
    return shouldShowQuickReadIntro(user) ? "quickReadIntro" : "upload";
  }
  if (meta.has_onboarded === true) return "terms";
  return "onboarding";
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP SELECT SCREEN
// ─────────────────────────────────────────────────────────────────
export function RelationshipSelect({
  animKey,
  onSelect,
  onBack,
  error = "",
  showDebugPanel = false,
  debugJson = "",
  debugRawText = "",
  debugRawLabel = "",
  debugRawBusy = false,
  debugRelationshipType = null,
  onDebugRelationshipTypeChange = () => {},
  onDebugExport = () => {},
  onDebugCopy = () => {},
  onDebugDownload = () => {},
  onDebugRunRawCoreA = () => {},
  onDebugRunRawCoreB = () => {},
  onDebugCopyRaw = () => {},
  onDebugDownloadRaw = () => {},
}) {
  const t = useT();
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const [sel, setSel] = useState(null);
  const [extraChats, setExtraChats] = useState([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraError, setExtraError] = useState("");
  const extraInputId = "wrapchat-extra-chat-input";

  const handleExtraFile = async (file) => {
    if (!file || extraBusy) return;
    setExtraBusy(true);
    setExtraError("");
    try {
      const result = await processImportedChatFile(file);
      const nextChat = {
        platform: result.platform,
        sourceFormat: result.sourceFormat,
        parserId: result.parserId,
        payload: result.payload,
        summary: result.summary,
        fileName: file.name || null,
      };
      setExtraChats(prev => [...prev, nextChat]);
      setExtraOpen(true);
    } catch (err) {
      setExtraError(String(err?.message || "Couldn't open that file. Try exporting again."));
    } finally {
      setExtraBusy(false);
    }
  };

  const romanticOptions = [
    { id:"partner", label:"Partner",   icon:partnerIcon,   accent:DA.purple },
    { id:"dating",  label:"Dating",    icon:datingIcon,    accent:DA.amber  },
    { id:"ex",      label:"Ex",        icon:exIcon,        accent:DA.orange },
  ];
  const otherOptions = [
    { id:"family",    label:"Related",   icon:familyIcon,    accent:DA.teal  },
    { id:"friend",    label:"Friend",    icon:friendIcon,    accent:DA.blue  },
    { id:"colleague", label:"Colleague", icon:colleagueIcon, accent:DA.lime  },
    { id:"other",     label:"Other",     icon:otherIcon,     accent:"#9090A8" },
  ];

  const RelCard = ({ opt, flex }) => {
    const active = sel === opt.id;
    return (
      <button
        key={opt.id}
        type="button"
        onClick={() => setSel(opt.id)}
        className="wc-btn"
        style={{
          flex: flex || undefined,
          position:"relative",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          padding:"20px 10px 16px",
          borderRadius:20,
          background: active ? `${opt.accent}14` : (isLight ? "rgba(31,24,78,0.05)" : "rgba(var(--wc-p),0.08)"),
          border: active ? `1.5px solid ${opt.accent}` : `1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.20)"}`,
          color:da.text, cursor:"pointer", transition:"all 0.18s",
          minHeight:100,
        }}
      >
        {active && (
          <div style={{
            position:"absolute", top:10, left:"50%", transform:"translateX(-50%)",
            width:7, height:7, borderRadius:"50%", background:opt.accent,
          }} />
        )}
        <img
          src={opt.icon} alt="" aria-hidden="true"
          style={{ width:32, height:32, objectFit:"contain", marginBottom:9,
            filter: isLight ? `brightness(0) saturate(100%) invert(14%) sepia(52%) saturate(800%) hue-rotate(225deg) brightness(93%) contrast(96%) opacity(${active ? 1 : 0.65})` : `brightness(0) invert(1) opacity(${active ? 1 : 0.65})` }}
        />
        <div style={{
          fontSize:14, fontWeight:800, letterSpacing:-0.2, textAlign:"center",
          color: active ? opt.accent : da.text,
        }}>
          {t(opt.label)}
        </div>
      </button>
    );
  };

  return (
    <Shell sec="upload" prog={1} total={3} contentAlign="start">
      <div style={getStickyHeaderStyle(isLight)}>
        <ScreenHeader back={onBack} title="Set up this chat" centerTitle />
      </div>
      <FadeScale key={animKey}>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:18, paddingBottom:"calc(22px + env(safe-area-inset-bottom, 0px))" }}>

      {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{error}</div>}

      {/* ── Section A: relationship ── */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:da.faint }}>
          Who is this with?
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, width:"100%" }}>
          {romanticOptions.map(opt => <RelCard key={opt.id} opt={opt} />)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, width:"100%" }}>
          {otherOptions.map(opt => <RelCard key={opt.id} opt={opt} />)}
        </div>
      </div>

      {/* ── Section B: extra chats — collapsible ── */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:8 }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:da.faint }}>
          Have more chats with this person?
        </div>
      <div style={{
        width:"100%",
        borderRadius:20,
        border: extraOpen ? "1px solid rgba(var(--wc-p),0.35)" : "1px solid rgba(var(--wc-p),0.18)",
        background: extraOpen ? "rgba(var(--wc-p),0.10)" : "rgba(var(--wc-p),0.05)",
        overflow:"hidden",
        transition:"border-color 0.2s, background 0.2s",
      }}>
        {/* Toggle header */}
        <button
          type="button"
          onClick={() => setExtraOpen(o => !o)}
          className="wc-btn"
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"14px 16px", background:"none", border:"none", cursor:"pointer",
            gap:10,
          }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {extraChats.length > 0 ? (
              <div style={{
                fontSize:11, fontWeight:800, background:"rgba(var(--wc-p),0.28)",
                color:"#c090e8", borderRadius:999, padding:"2px 8px", flexShrink:0,
              }}>
                {extraChats.length + 1} chats added
              </div>
            ) : (
              <span style={{ fontSize:13, fontWeight:600, color:da.muted, letterSpacing:-0.1 }}>
                Add older exports or number changes
              </span>
            )}
          </div>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ flexShrink:0, transition:"transform 0.2s", transform: extraOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <path d="M2 4l4 4 4-4" stroke="rgba(255,255,255,0.4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Expanded body */}
        {extraOpen && (
          <div style={{ padding:"0 16px 16px" }}>
            <div style={{ fontSize:13, color:da.muted, lineHeight:1.7, marginBottom:14 }}>
              If they changed numbers or you have older exports, add them here and we&apos;ll read them together.
            </div>

            {extraChats.length > 0 && (
              <div style={{ marginBottom:14, display:"flex", flexDirection:"column", gap:6 }}>
                <div style={{ fontSize:12, color:da.muted, fontWeight:700 }}>
                  We&apos;ll combine them before analysis.
                </div>
                {extraChats.map((chat, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(var(--wc-p),0.12)", borderRadius:10, padding:"7px 11px" }}>
                    <div style={{ fontSize:12, color:da.muted, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {chat.fileName || `Chat ${i + 2}`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExtraChats(prev => prev.filter((_, j) => j !== i))}
                      className="wc-btn"
                      style={{ background:"none", border:"none", color:da.faint, fontSize:11, fontWeight:700, cursor:"pointer", padding:0, flexShrink:0 }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {extraError && (
              <div style={{ fontSize:12, color:"#FFB090", marginBottom:12, lineHeight:1.5 }}>{extraError}</div>
            )}

            <label
              htmlFor={extraInputId}
              className="wc-btn"
              style={{
                display:"block", textAlign:"center",
                fontSize:13, fontWeight:800,
                color: extraBusy ? "rgba(160,138,240,0.4)" : "#A08AF0",
                background: extraBusy ? "rgba(160,138,240,0.06)" : "rgba(160,138,240,0.12)",
                border:"1.5px solid rgba(160,138,240,0.35)",
                borderRadius:14, padding:"12px 18px",
                cursor: extraBusy ? "default" : "pointer",
                letterSpacing:-0.1,
              }}
            >
              {extraBusy ? "Opening…" : extraChats.length > 0 ? "+ Add another chat" : "+ Add another chat"}
            </label>
            <input
              id={extraInputId}
              type="file"
              accept={IMPORT_ACCEPT_TYPES}
              style={{ display:"none" }}
              onClick={e => { e.target.value = ""; }}
              onChange={e => handleExtraFile(e.target.files?.[0] || null)}
            />
          </div>
        )}
      </div>
      </div>

      <AiDebugPanel
        enabled={showDebugPanel}
        title="Admin AI debug"
        description="Pick a relationship type, inspect the exact request bundle, or fetch the untouched model reply for the compact connection and risk families."
        relationshipOptions={DEBUG_RELATIONSHIP_OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
        selectedRelationshipType={debugRelationshipType}
        onRelationshipTypeChange={onDebugRelationshipTypeChange}
        exportDisabled={!debugRelationshipType}
        disabledReason={!debugRelationshipType ? "Choose a relationship type here to prepare the local debug bundle." : ""}
        jsonText={debugJson}
        onExport={onDebugExport}
        onCopy={onDebugCopy}
        onDownload={onDebugDownload}
        rawText={debugRawText}
        rawLabel={debugRawLabel}
        rawBusy={debugRawBusy}
        rawPrimaryLabel="Run Connection Raw"
        rawSecondaryLabel="Run Risk Raw"
        onRunRawCoreA={onDebugRunRawCoreA}
        onRunRawCoreB={onDebugRunRawCoreB}
        onCopyRaw={onDebugCopyRaw}
        onDownloadRaw={onDebugDownloadRaw}
      />

      <PrimaryButton
        onClick={() => sel && onSelect(sel, extraChats)}
        disabled={!sel}
        color={sel ? PAL.upload.accent : "rgba(255,255,255,0.12)"}
        textColor={sel ? DA.bg : "rgba(255,255,255,0.35)"}
        style={{ marginTop:4, minHeight:58, flexShrink:0 }}
      >
        <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>
      </PrimaryButton>
      </div>
      </FadeScale>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
function normalizeAuthError(error, mode) {
  const msg = (error?.message || "").toLowerCase();
  if (mode === "login") {
    if (msg.includes("email not confirmed"))
      return "Please confirm your email before logging in. Check your inbox.";
    if (msg.includes("invalid login") || msg.includes("invalid credentials") || msg.includes("user not found"))
      return "Email or password is incorrect.";
    return "Something went wrong. Please try again.";
  }
  // signup
  if (msg.includes("already registered") || msg.includes("already exists"))
    return "This email is already registered. Log in instead.";
  return "Something went wrong. Please try again.";
}

export function Auth() {
  const [tab,      setTab]      = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";

  const switchTab = (t) => { setTab(t); setErr(""); setInfo(""); };

  const submit = async () => {
    if (!email || !password) { setErr("Please fill in both fields."); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(normalizeAuthError(error, "login"));
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: getAuthConfirmationRedirectUrl() },
        });
        if (error) {
          setErr(normalizeAuthError(error, "signup"));
        } else if (data?.user?.identities?.length === 0) {
          setErr("This email is already registered. Log in instead.");
        } else {
          setInfo("Check your email to confirm your account, then log in.");
        }
      }
    } catch { setErr("Something went wrong. Please try again."); }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%",
    background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.25)",
    border: `1.5px solid ${isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 14,
    padding: "13px 16px",
    fontSize: 15,
    color: da.text,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <BrandLockup
        logoSrc={wrapchatLogoTransparent}
        logoSize={72}
        subtitle="Your chats, unwrapped."
        subtitleMarginBottom={8}
      />

      {/* Tab toggle */}
      <SlidingSegmentedTabs
        items={[{ id:"login", label:"Log in" }, { id:"signup", label:"Sign up" }]}
        value={tab}
        onChange={switchTab}
        ariaLabel="Authentication tabs"
      />

      {/* Inputs */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <input
          type="email" placeholder="Email" value={email}
          id="wrapchat-auth-email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
        <input
          type="password" placeholder="Password" value={password}
          id="wrapchat-auth-password"
          name="password"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete={tab === "login" ? "current-password" : "new-password"}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
      </div>

      {err  && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      {info && <div style={{ fontSize:13, color:"#B0F4C8", background:"rgba(20,160,80,0.15)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{info}</div>}

      <PrimaryButton onClick={submit} disabled={busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "…" : tab === "login" ? "Log in" : "Create account"}
      </PrimaryButton>

      <div style={{ fontSize:11, color:da.faint, textAlign:"center" }}>Your chat is analysed by AI and never stored. Only results are saved.</div>
      <div style={{ position:"absolute", left:20, right:20, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:11, color:da.faint, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", pointerEvents:"none" }}>
        {HOMEPAGE_VERSION_LABEL}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING (3 screens, first-login only)
// ─────────────────────────────────────────────────────────────────
const ONBOARD_PILLS = [
  { label: "Toxicity",       palette: "toxicity" },
  { label: "Love Languages", palette: "lovelang" },
  { label: "Accountability", palette: "accounta" },
  { label: "Energy",         palette: "energy"   },
  { label: "Growth",         palette: "growth"   },
  { label: "Chat Wrapped",   palette: "upload"   },
];

const EXPORT_STEPS = [
  "Open your messaging app",
  "Tap the chat you want to analyse",
  "Tap ··· menu → More → Export Chat",
  "Choose Without Media",
  "Save the .txt file to your device",
];

export function OnboardingFlow({ step, next, onOnboarded }) {
  const { uiLangPref } = useUILanguage();
  const t = useT();
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const [busy, setBusy] = useState(false);
  const [err]           = useState("");
  const [selectedUiLang, setSelectedUiLang] = useState(uiLangPref);

  useEffect(() => {
    setSelectedUiLang(uiLangPref);
  }, [uiLangPref]);

  const markOnboarded = async (pref, thenCb) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.updateUser({ data: { has_onboarded: true, ui_language: normalizeUiLangPref(pref) } });
    } catch { /* silent — non-critical */ }
    thenCb?.();
  };

  const handleSkip   = () => markOnboarded("en", () => onOnboarded?.("en"));
  const handleFinish = () => markOnboarded(selectedUiLang, () => onOnboarded?.(selectedUiLang));

  const linkBtn = { background:"none", border:"none", color:da.faint, fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={step + 1} total={4} scrollable={false}>

      {/* ── Screen 1: hook ── */}
      {step === 0 && (<>
        <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Your relationship, in data.")}
        </div>
        <div style={{ fontSize:14, color:da.muted, textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Reads your chat export and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.")}
        </div>
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Next")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
        <button onClick={handleSkip} className="wc-btn" style={{ background:"none", border:"none", color:da.faint, fontSize:12, padding:"4px 8px", fontWeight:600 }}>{t("Skip")}</button>
      </>)}

      {/* ── Screen 2: export instructions ── */}
      {step === 1 && (<>
        <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Start with your chat.")}
        </div>
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:9 }}>
          {EXPORT_STEPS.map((label, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:14, background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.12)", border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.24)"}`, borderRadius:18, padding:"13px 16px" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:PAL.upload.inner, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>
                {i + 1}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:da.text, lineHeight:1.4 }}>{t(label)}</div>
            </div>
          ))}
        </div>
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Next")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
      </>)}

      {/* ── Screen 3: launch ── */}
      {step === 2 && (<>
        <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Upload. Analyse. See it clearly.")}
        </div>
        <div style={{ fontSize:14, color:da.muted, textAlign:"center", lineHeight:1.75, width:"100%" }}>
          {t("Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.")}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", width:"100%" }}>
          {ONBOARD_PILLS.map(pill => {
            const p = PAL[pill.palette] || PAL.upload;
            return (
              <div key={pill.label} style={{ background:p.inner, color:"#fff", borderRadius:50, padding:"7px 16px", fontSize:13, fontWeight:700, letterSpacing:0.1 }}>
                {t(pill.label)}
              </div>
            );
          })}
        </div>
        {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
        <PrimaryButton onClick={next} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>
        </PrimaryButton>
      </>)}

      {step === 3 && (<>
        <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          {t("Choose your language")}
        </div>
        <div style={{ width:"100%", background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.12)", border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.24)"}`, borderRadius:22, padding:"18px 16px", display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ fontSize:13, color:da.muted, lineHeight:1.6 }}>
            {t("Auto selection will recognize the language from your chats.")}
          </div>
          <select
            value={selectedUiLang}
            onChange={e => setSelectedUiLang(e.target.value)}
            aria-label="App language"
            style={{
              width:"100%",
              height:44,
              background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.22)",
              border: isLight ? "1px solid rgba(31,24,78,0.14)" : "1px solid rgba(255,255,255,0.18)",
              borderRadius:14,
              color:da.text,
              fontSize:14,
              fontWeight:800,
              padding:"0 12px",
              outline:"none",
              fontFamily:"inherit",
            }}
          >
            <option value="auto">{t("Auto-detect")}</option>
            {LANG_OPTIONS.map(option => (
              <option key={option.code} value={option.code}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </div>
        <PrimaryButton onClick={handleFinish} disabled={busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          {busy ? "…" : <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>{t("Continue")}<ForwardIcon size={13} /></span>}
        </PrimaryButton>
      </>)}

    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// TERMS & PRIVACY ACCEPTANCE (separate step, after onboarding)
// ─────────────────────────────────────────────────────────────────
export function TermsFlow({ onAccepted, onLogout }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const [activeTab,    setActiveTab]    = useState("tos");
  const [tosRead,      setTosRead]      = useState(false);
  const [privacyRead,  setPrivacyRead]  = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState("");
  const tosRef     = useRef(null);
  const privacyRef = useRef(null);

  const bothRead = tosRead && privacyRead;

  const checkRead = (tab) => {
    const el = tab === "tos" ? tosRef.current : privacyRef.current;
    if (!el) return;
    if (tab !== activeTab) return;
    if (el.clientHeight <= 0 || el.scrollHeight <= 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      if (tab === "tos")     setTosRead(true);
      else                   setPrivacyRead(true);
    }
  };

  const acceptTerms = async () => {
    if (!bothRead || busy) return;
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          terms_accepted: true,
          terms_version: LEGAL_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      });
      if (error) { setErr(error.message || "Could not save. Please try again."); setBusy(false); return; }
      onAccepted?.();
    } catch {
      setErr("Could not save. Please try again.");
      setBusy(false);
    }
  };

  const scrollBox = {
    height:"40vh", overflowY:"auto",
    background: isLight ? "rgba(31,24,78,0.05)" : "rgba(0,0,0,0.22)", borderRadius:20,
    padding:"18px 20px", width:"100%",
    fontSize:12.5, color:da.muted, lineHeight:1.8,
    fontFamily:"inherit", whiteSpace:"pre-wrap",
  };

  const checkMark = (read) => read
    ? <span style={{ color:PAL.growth.accent, fontWeight:800 }}>✓</span>
    : null;

  const linkBtn = { background:"none", border:"none", color:da.faint, fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>
        One thing before you start.
      </div>
      <div style={{ fontSize:13, color:da.muted, textAlign:"center", lineHeight:1.6, width:"100%" }}>
        Read both documents below before continuing.
      </div>

      {/* Tab switcher */}
      <SlidingSegmentedTabs
        items={[
          { id:"tos", label:"Terms of Service", suffix:checkMark(tosRead) },
          { id:"privacy", label:"Privacy Policy", suffix:checkMark(privacyRead) },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Legal document tabs"
      />

      {/* Scrollable document bodies — both mounted so scroll position is preserved */}
      <div
        ref={tosRef}
        onScroll={() => checkRead("tos")}
        style={{ ...scrollBox, display: activeTab === "tos" ? "block" : "none" }}
      >
        {TERMS_OF_SERVICE_TEXT}
      </div>
      <div
        ref={privacyRef}
        onScroll={() => checkRead("privacy")}
        style={{ ...scrollBox, display: activeTab === "privacy" ? "block" : "none" }}
      >
        {PRIVACY_POLICY_TEXT}
      </div>

      {!bothRead && (
        <div style={{ fontSize:11, color:da.faint, textAlign:"center" }}>
          {!tosRead && !privacyRead
            ? "Scroll through both documents to continue."
            : !tosRead
              ? "Scroll to the bottom of Terms of Service."
              : "Scroll to the bottom of Privacy Policy."}
        </div>
      )}

      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}

      <PrimaryButton onClick={acceptTerms} disabled={!bothRead || busy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "Saving…" : "I have read and accept both documents."}
      </PrimaryButton>

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={{ background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:999, color:"rgba(200,170,240,0.70)", fontSize:12, padding:"8px 14px", fontWeight:700 }}>Log out</button>}
      </div>
    </Shell>
  );
}

export function ProfileNameSetup({ user, onSaved, onLogout }) {
  const initialName = userProvidedDisplayName(user);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  const canSave = cleanName.length >= 2 && !busy;
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";

  const save = async () => {
    if (!canSave) {
      setErr("Enter the name that appears as you in your chats.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: cleanName,
          display_name: cleanName,
          profile_name_completed: true,
          profile_name_completed_at: new Date().toISOString(),
        },
      });
      if (error) {
        setErr(error.message || "Could not save your name. Please try again.");
        setBusy(false);
        return;
      }
      onSaved?.(data?.user || null);
    } catch {
      setErr("Could not save your name. Please try again.");
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.25)",
    border: `1.5px solid ${isLight ? "rgba(31,24,78,0.15)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 16,
    padding: "14px 16px",
    fontSize: 16,
    color: da.text,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <BrandLockup
        logoSrc={wrapchatLogoTransparent}
        logoSize={62}
        subtitle="Your chats, unwrapped."
        subtitleMarginBottom={8}
      />
      <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-1, lineHeight:1.12, textAlign:"center", width:"100%" }}>
        What name should we look for?
      </div>
      <div style={{ fontSize:13, color:da.muted, textAlign:"center", lineHeight:1.7, width:"100%" }}>
        Use the name that appears for you inside your exported chats. This helps WrapChat tell you apart from the other person and keeps My Results cleaner.
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
        <input
          type="text"
          placeholder="Your name in chats"
          value={name}
          autoFocus
          autoComplete="name"
          onChange={event => { setName(event.target.value); setErr(""); }}
          onKeyDown={event => event.key === "Enter" && save()}
          style={inputStyle}
        />
      </div>
      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      <PrimaryButton onClick={save} disabled={!canSave} color={PAL.upload.accent} textColor={PAL.upload.bg}>
        {busy ? "Saving…" : "Continue"}
      </PrimaryButton>
      {onLogout && (
        <button onClick={onLogout} className="wc-btn" style={{ background:"none", border:"none", color:da.faint, fontSize:12, padding:"4px 8px", fontWeight:700 }}>
          Log out
        </button>
      )}
    </Shell>
  );
}

export function QuickReadIntro({ user, onContinue }) {
  const [busy, setBusy] = useState(false);
  const { theme } = useTheme();
  const da = getDA(theme);
  const continueToUpload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.updateUser({
        data: {
          quick_read_intro_seen: true,
          quick_read_intro_seen_at: new Date().toISOString(),
        },
      });
      onContinue?.(data?.user || user || null);
    } catch {
      onContinue?.(user || null);
    }
  };

  return (
    <Shell sec="trial" prog={0} total={0} scrollable={false}>
      <BrandLockup
        logoSrc={wrapchatLogoTransparent}
        logoSize={62}
        subtitle="Your chats, unwrapped."
        subtitleMarginBottom={8}
      />
      <div style={{ fontSize:26, fontWeight:900, color:da.text, letterSpacing:-1, lineHeight:1.12, textAlign:"center", width:"100%" }}>
        Your first read is included.
      </div>
      <div style={{ fontSize:13, color:da.muted, textAlign:"center", lineHeight:1.7, width:"100%" }}>
        Start with a Quick Read whenever you are ready. It gives you the first vibe, pattern, and takeaway from a chat.
      </div>
      <div style={{ width:"100%", background:"rgba(122,144,255,0.13)", border:"1px solid rgba(122,144,255,0.32)", borderRadius:22, padding:"15px 16px", textAlign:"left" }}>
        <div style={{ fontSize:11, color:PAL.trial.accent, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", marginBottom:6 }}>Quick Read</div>
        <div style={{ fontSize:14, color:da.muted, lineHeight:1.55 }}>
          One free starter pass. The deeper reads are there when you want them.
        </div>
      </div>
      <PrimaryButton onClick={continueToUpload} disabled={busy} color={PAL.trial.accent} textColor={PAL.trial.bg}>
        {busy ? "…" : "Continue"}
      </PrimaryButton>
    </Shell>
  );
}

export function TooShort({ onBack }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false}>
      <BrandLockup />
      <div style={{ background:"rgba(var(--wc-p),0.12)", border:"1px solid rgba(var(--wc-p),0.24)", borderRadius:24, padding:"32px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:26, fontWeight:800, color:da.text, letterSpacing:-0.5, lineHeight:1.2 }}>
          Not enough messages to wrap
        </div>
        <div style={{ fontSize:13, color:da.muted, marginTop:10, lineHeight:1.75 }}>
          This chat has fewer than {MIN_MESSAGES} messages after filtering system messages. WrapChat needs more to work with.
        </div>
      </div>
      <div style={{ fontSize:12, color:da.faint, textAlign:"center", lineHeight:1.8 }}>
        Try exporting a longer chat history.
      </div>
      <GhostButton onClick={onBack}><BackIcon size={11} /> Upload a different file</GhostButton>
    </Shell>
  );
}

export function DuplicateParticipantReview({ dataset, onContinue, onBack }) {
  const suggestions = getReviewableMergeSuggestions(dataset);
  const existingApprovedIds = (dataset?.mergeState?.approved || []).map(suggestion => suggestion.id);
  const [approvedIds, setApprovedIds] = useState([]);
  const markApproved = (id) => setApprovedIds(prev => prev.includes(id) ? prev : [...prev, id]);
  const markSeparate = (id) => setApprovedIds(prev => prev.filter(item => item !== id));
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      <div style={getStickyHeaderStyle(isLight)}>
        <ScreenHeader back={onBack} title="Review contacts" />
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:14 }}>
        <div style={{ background:"rgba(var(--wc-p),0.12)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:24, padding:"22px 20px", width:"100%" }}>
          <div style={{ fontSize:22, fontWeight:800, color:da.text, letterSpacing:-0.5, lineHeight:1.2 }}>
            We found possible duplicate contacts.
          </div>
          <div style={{ fontSize:13, color:da.muted, marginTop:10, lineHeight:1.65 }}>
            Choose which pairs should be treated as the same person before analysis.
          </div>
        </div>
        {suggestions.map(suggestion => {
          const active = approvedIds.includes(suggestion.id);
          return (
            <div key={suggestion.id} style={{
              background:"rgba(var(--wc-p),0.10)",
              border:`1px solid ${active ? PAL.upload.accent : "rgba(var(--wc-p),0.22)"}`,
              borderRadius:20,
              padding:16,
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[suggestion.participantA, suggestion.participantB].map((participant, index) => (
                  <div key={`${suggestion.id}-${index}`} style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, color:da.faint, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                      Participant {index === 0 ? "A" : "B"}
                    </div>
                    <div style={{ marginTop:5, fontSize:15, color:da.text, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {participant.displayName || "Unknown"}
                    </div>
                    {participant.phone && (
                      <div style={{ marginTop:3, fontSize:12, color:da.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {participant.phone}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button type="button" onClick={() => markApproved(suggestion.id)} className="wc-btn"
                  style={{ flex:1, borderRadius:999, padding:"10px 12px", border:`1px solid ${active ? PAL.upload.accent : (isLight ? "rgba(31,24,78,0.2)" : "rgba(255,255,255,0.16)")}`, background:active ? PAL.upload.accent : (isLight ? "rgba(31,24,78,0.06)" : "rgba(255,255,255,0.08)"), color:active ? PAL.upload.bg : da.text, fontSize:13, fontWeight:800 }}>
                  Approve
                </button>
                <button type="button" onClick={() => markSeparate(suggestion.id)} className="wc-btn"
                  style={{ flex:1, borderRadius:999, padding:"10px 12px", border:`1px solid ${isLight ? "rgba(31,24,78,0.2)" : "rgba(255,255,255,0.16)"}`, background:!active ? (isLight ? "rgba(31,24,78,0.1)" : "rgba(255,255,255,0.14)") : (isLight ? "rgba(31,24,78,0.04)" : "rgba(255,255,255,0.08)"), color:da.text, fontSize:13, fontWeight:700 }}>
                  Keep separate
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <PrimaryButton onClick={() => onContinue([...existingApprovedIds, ...approvedIds])}>Continue</PrimaryButton>
    </Shell>
  );
}

export function ParticipantMismatchReview({ mismatch, onContinue, onBack }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      <div style={getStickyHeaderStyle(theme === "light")}>
        <ScreenHeader back={onBack} title="Review chats" />
      </div>
      <div style={{ background:"rgba(var(--wc-p),0.12)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:24, padding:"22px 20px", width:"100%" }}>
        <div style={{ fontSize:22, fontWeight:800, color:da.text, letterSpacing:-0.5, lineHeight:1.2 }}>
          These chats may be from different people.
        </div>
        <div style={{ fontSize:13, color:da.muted, marginTop:10, lineHeight:1.65 }}>
          Confirm before combining them into one analysis.
        </div>
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        {(mismatch?.rows || []).map(row => (
          <div key={row.chatId} style={{ background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:18, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:PAL.upload.accent, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em" }}>
              {row.label}
            </div>
            <div style={{ marginTop:5, fontSize:16, color:da.text, fontWeight:800 }}>{row.otherName}</div>
            {row.fileName && <div style={{ marginTop:4, fontSize:12, color:da.muted }}>{row.fileName}</div>}
          </div>
        ))}
      </div>
      <PrimaryButton onClick={onContinue}>Continue combined analysis</PrimaryButton>
      <GhostButton onClick={onBack}><BackIcon size={11} /> Go back and review files</GhostButton>
    </Shell>
  );
}

export function ProfileNameMismatchReview({ warning, onContinue, onBack }) {
  const userName = warning?.userName || "your saved name";
  const participants = Array.isArray(warning?.participants) ? warning.participants : [];
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start">
      <div style={getStickyHeaderStyle(theme === "light")}>
        <ScreenHeader back={onBack} title="Check your name" />
      </div>
      <div style={{ background:"rgba(122,144,255,0.14)", border:"1px solid rgba(122,144,255,0.34)", borderRadius:24, padding:"22px 20px", width:"100%" }}>
        <div style={{ fontSize:22, fontWeight:800, color:da.text, letterSpacing:-0.5, lineHeight:1.2 }}>
          We could not find &ldquo;{userName}&rdquo; in this duo chat.
        </div>
        <div style={{ fontSize:13, color:da.muted, marginTop:10, lineHeight:1.65 }}>
          WrapChat uses your name to tell you apart from the other person. If one of these is you, you can continue.
        </div>
      </div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        {participants.map(name => (
          <div key={name} style={{ background:"rgba(122,144,255,0.10)", border:"1px solid rgba(122,144,255,0.26)", borderRadius:18, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:PAL.trial.accent, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.08em" }}>
              Chat participant
            </div>
            <div style={{ marginTop:5, fontSize:16, color:da.text, fontWeight:800 }}>{name}</div>
          </div>
        ))}
      </div>
      <PrimaryButton onClick={onContinue} color={PAL.trial.accent} textColor={PAL.trial.bg}>Continue anyway</PrimaryButton>
      <GhostButton onClick={onBack}><BackIcon size={11} /> Upload a different chat</GhostButton>
    </Shell>
  );
}

export function AdminLocked({ onBack }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} contentAlign="start">
      <ScreenHeader back={onBack} title="Admin access only" />
      <div style={{ background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:24, padding:"28px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:14, color:da.muted, lineHeight:1.7 }}>
          This panel is only visible to the configured admin email.
        </div>
      </div>
    </Shell>
  );
}

export function Upload({
  onParsed,
  onLogout,
  onHistory,
  onAdmin,
  onSettings,
  canAdmin,
  uploadError = "",
  uploadInfo = "",
  credits = null,
  quickReadAvailable = false,
  hideCredits = false,
  unlockedPackIds = {},
  accessMode = DEFAULT_ACCESS_MODE,
  onClearError,
  onUpgrade,
  onPayment,
}) {
  const t = useT();
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const showAdminEntry = Boolean(onAdmin) && canAdmin;
  const uploadInputId = "wrapchat-upload-input";
  const displayErr = err || uploadError;

  const isPaymentsMode = !hideCredits && accessMode === "payments";
  const hasUnlockedReads = Object.values(unlockedPackIds || {}).some(Boolean);
  const isTrialPending  = isPaymentsMode && quickReadAvailable;
  const displayInfo = uploadInfo
    || (!hideCredits && !isPaymentsMode && credits === 0 && !hasUnlockedReads ? OUT_OF_CREDITS_MESSAGE : "");

  const showCreditPill = !hideCredits && !isOpenMode(accessMode) && !isTrialPending && Number.isInteger(credits);

  const handle = async fileList => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    onClearError?.();
    setBusy(true); setErr("");
    try {
      const file = files[0];
      const result = await processImportedChatFile(file);
      onParsed({
        platform: result.platform,
        sourceFormat: result.sourceFormat,
        parserId: result.parserId,
        payload: result.payload,
        summary: result.summary,
        fileName: file.name || null,
      });
    } catch (error) {
      setErr(String(error?.message || "Couldn't open this file. Please export the chat again and retry."));
      setBusy(false);
    }
  };
  const showOpenPill = isOpenMode(accessMode) && !hideCredits;

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} forceWaves>
      {/* ── Absolute overlays (never participate in flex layout) ── */}
      {onHistory && (
        <div style={{ position:"absolute", top:16, left:16, zIndex:5 }}>
          <button type="button" onClick={onHistory} className="wc-btn" aria-label="My Results"
            style={{ width:40, height:40, borderRadius:"50%", background: isLight ? "none" : "rgba(var(--wc-p),0.20)", border: isLight ? "none" : "1px solid rgba(var(--wc-p),0.38)", color: isLight ? "#7A90FF" : "rgba(220,200,255,0.85)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0, flexShrink:0 }}>
            <svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="1" y1="1.5" x2="15" y2="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="12.5" x2="15" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
      {showCreditPill && (
        <div style={{ position:"absolute", top:16, right:20, minHeight:40, zIndex:5, display:"flex", alignItems:"center" }}>
          <AnalysisDotsCounter credits={credits} activePackIds={unlockedPackIds} onAdd={onUpgrade || onPayment} hide={hideCredits} />
        </div>
      )}
      <div style={{ position:"absolute", left:20, right:20, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:11, color:da.faint, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", pointerEvents:"none", zIndex:1 }}>
        {HOMEPAGE_VERSION_LABEL}
      </div>

      {/* ── Logo — pinned to match auth, never displaced by other elements ── */}
      <div style={{ position:"absolute", top:"calc(33% + 4px)", left:0, right:0, transform:"translateY(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"0 24px", zIndex:1 }}>
        <BrandLockup
          logoSrc={wrapchatLogoTransparent}
          logoSize={72}
          subtitle={t("Your chats, unwrapped.")}
          subtitleMarginBottom={showOpenPill ? 4 : 8}
        />
        {showOpenPill && (
          <div style={{
            fontSize:12, fontWeight:700,
            color:"rgba(176,244,200,0.9)",
            background:"rgba(20,160,80,0.12)",
            border:"1px solid rgba(20,160,80,0.28)",
            borderRadius:999,
            padding:"7px 18px",
            textAlign:"center",
          }}>
            Open testing · free reports
          </div>
        )}
      </div>

      {/* ── Action zone — snapped just below tagline, independent of logo ── */}
      <div style={{ position:"absolute", top:"calc(33% + 109px)", left:24, right:24, display:"flex", flexDirection:"column", gap:12 }}>
        <label
          htmlFor={uploadInputId}
          onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files); }}
          onDragOver={e => e.preventDefault()}
          style={{ background: isLight ? "rgba(31,24,78,0.08)" : "rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", cursor:"pointer", width:"100%", transition:"background 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.background = isLight ? "rgba(31,24,78,0.14)" : "rgba(0,0,0,0.35)"}
          onMouseLeave={e => e.currentTarget.style.background = isLight ? "rgba(31,24,78,0.08)" : "rgba(0,0,0,0.25)"}
        >
          <div style={{ fontSize:17, fontWeight:800, color:da.text, letterSpacing:-0.3 }}>{busy ? t("Reading your chat…") : t("Upload your chat")}</div>
        </label>
        <input id={uploadInputId} type="file" accept={IMPORT_ACCEPT_TYPES} style={{ display:"none" }} onChange={e => handle(e.target.files)} />
        {isTrialPending && (
          <div style={{
            fontSize:13, fontWeight:700, color:"rgba(232,236,255,0.95)",
            background:"rgba(122,144,255,0.14)", border:"1px solid rgba(122,144,255,0.34)",
            borderRadius:14, padding:"11px 16px", width:"100%", textAlign:"center", lineHeight:1.6,
          }}>
            {t("You have 1 Quick Read available.")}
          </div>
        )}
        {displayErr && <div style={{ fontSize:13, color:"#FFB090", textAlign:"center", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%" }}>{displayErr}</div>}
        {displayInfo && (
          <div style={{
            fontSize:13, color: isLight ? "rgba(31,24,78,0.82)" : "rgba(255,255,255,0.82)", textAlign:"center",
            background:"rgba(var(--wc-p),0.22)", border:"1px solid rgba(var(--wc-p),0.38)",
            padding:"11px 16px", borderRadius:16, width:"100%", lineHeight:1.6,
          }}>
            {displayInfo}
          </div>
        )}
        <div style={{ fontSize:11, color:da.faint, textAlign:"center" }}>{t("Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.")}</div>
        {showAdminEntry && (
          <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", flexWrap:"wrap", width:"100%" }}>
            <button onClick={onAdmin} className="wc-btn" style={{ background:"rgba(var(--wc-p),0.16)", border:"1px solid rgba(var(--wc-p),0.30)", borderRadius:999, color:"rgba(200,170,240,0.90)", fontSize:12, padding:"8px 14px", fontWeight:700, letterSpacing:0.1 }}>
              Admin
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────
export function Loading({ math, reportType, reportTypes = [], loadingIndex = 0 }) {
  const t = useT();
  const da = getDA("dark");
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => Math.min(x+1, LOADING_STEPS.length-1)), 1800); return () => clearInterval(t); }, []);
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const label = rtype?.label || "Analysis";
  const sec   = getReportLaunchSec(reportType);
  const pal   = PAL[sec] || PAL.upload;
  const queue = normalizeSelectedReportTypes(reportTypes);
  const queuePrefix = queue.length > 1 ? `${Math.min(loadingIndex + 1, queue.length)}/${queue.length} · ` : "";
  return (
    <Shell sec={sec} prog={tick+1} total={LOADING_STEPS.length} scrollable={false} hidePill>
      <BrandLockup accentColor={reportType ? pal.accent : null} />
      <div style={{ fontSize:14, color:da.muted, textAlign:"center", fontWeight:500 }}>
        {queuePrefix}{t(label)} · {math.totalMessages.toLocaleString()} {t("messages")}
      </div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"24px 20px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:18, fontWeight:800, color:da.text, minHeight:52, letterSpacing:-0.3 }}>{t(LOADING_STEPS[tick])}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:16 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"rgba(255,255,255,0.4)", animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
        </div>
      </div>
      <div style={{ fontSize:12, color:da.faint, textAlign:"center", lineHeight:1.8 }}>
        Your chat is analysed by AI and never stored. Only results are saved.
      </div>
    </Shell>
  );
}

export function SettingsScreen({ onBack, onAccountDeleted, onLogout, onUserUpdated, reportLang = "en", onReportLangChange = () => {}, previewUser = null }) {
  const t = useT();
  const { uiLangPref, updateUiLangPref } = useUILanguage();
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";
  const da = getDA(theme);
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileInfo, setProfileInfo] = useState("");
  const [profileError, setProfileError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const autoLanguage = uiLangPref === "auto";
  const cleanProfileName = String(profileName || "").replace(/\s+/g, " ").trim();
  const canSaveProfileName = cleanProfileName.length >= 2 && !profileBusy;
  const arrowStroke = isLight ? "rgba(31,24,78,0.55)" : "rgba(255,255,255,0.68)";
  const languageSelectStyle = {
    width:"100%",
    height:42,
    backgroundColor: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.22)",
    backgroundImage:`url("data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3.5 5.25L7 8.75L10.5 5.25' stroke='${encodeURIComponent(arrowStroke)}' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat:"no-repeat",
    backgroundPosition:"right 18px center",
    backgroundSize:"14px 14px",
    borderRadius:14,
    color: da.text,
    fontSize:14,
    fontWeight:700,
    padding:"0 46px 0 12px",
    outline:"none",
    fontFamily:"inherit",
    appearance:"none",
    WebkitAppearance:"none",
    MozAppearance:"none",
  };

  useEffect(() => {
    if (previewUser) {
      setProfileName(userProvidedDisplayName(previewUser));
      return undefined;
    }
    let alive = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!alive) return;
      setProfileName(userProvidedDisplayName(user));
    });
    return () => { alive = false; };
  }, [previewUser]);

  const saveProfileName = async () => {
    if (!canSaveProfileName) {
      setProfileError("Enter the name that appears as you in your chats.");
      setProfileInfo("");
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    setProfileInfo("");
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: cleanProfileName,
          display_name: cleanProfileName,
          profile_name_completed: true,
          profile_name_completed_at: new Date().toISOString(),
        },
      });
      if (error) {
        setProfileError(error.message || "Could not update your name. Please try again.");
        setProfileBusy(false);
        return;
      }
      if (data?.user) onUserUpdated?.(data.user);
      setProfileName(cleanProfileName);
      setProfileInfo("Name updated.");
    } catch {
      setProfileError("Could not update your name. Please try again.");
    }
    setProfileBusy(false);
  };

  const closeConfirm = () => {
    if (deleteBusy) return;
    setConfirmOpen(false);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCurrentAccount();
      onAccountDeleted?.();
    } catch (error) {
      console.error("Account deletion failed", error);
      setDeleteError("Couldn't delete your account. Please try again.");
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
        <div style={SCREEN_CONTENT_STYLE}>
          <div style={SCREEN_HEADER_BLOCK_STYLE}>
            <ScreenHeader back={onBack} title="Settings" />
          </div>
          <div style={{ ...SCREEN_BODY_SCROLL_STYLE, gap:14, justifyContent:"safe center", paddingTop:4 }}>

            {/* ── Appearance toggle ── */}
            <div style={{
              width:"100%",
              background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.12)",
              border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.24)"}`,
              borderRadius:18,
              padding:"15px 16px",
              display:"flex",
              flexDirection:"row",
              alignItems:"center",
              justifyContent:"space-between",
              gap:12,
            }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:da.text }}>Appearance</div>
                <div style={{ fontSize:12, color:isLight ? "rgba(31,24,78,0.48)" : "rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  Choose your preferred color theme.
                </div>
              </div>
              <div style={{
                display:"flex",
                background: isLight ? "rgba(31,24,78,0.1)" : "rgba(0,0,0,0.22)",
                borderRadius:999,
                padding:3,
                gap:2,
                flexShrink:0,
              }}>
                {["dark","light"].map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => opt !== theme && toggleTheme()}
                    style={{
                      borderRadius:999,
                      padding:"6px 14px",
                      border:"none",
                      fontSize:13,
                      fontWeight:700,
                      background: theme === opt ? PAL.upload.accent : "transparent",
                      color: theme === opt ? PAL.upload.bg : (isLight ? "rgba(31,24,78,0.5)" : "rgba(255,255,255,0.45)"),
                      transition:"all .2s",
                      cursor: theme === opt ? "default" : "pointer",
                    }}
                  >
                    {opt === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              width:"100%",
              background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.12)",
              border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.24)"}`,
              borderRadius:18,
              padding:"15px 16px",
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:da.text }}>Your name</div>
                <div style={{ fontSize:12, color:isLight ? "rgba(31,24,78,0.48)" : "rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  This is how WrapChat recognizes you in uploaded chats and keeps duo result cards focused on the other person.
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr) auto", gap:8, alignItems:"center" }}>
                <input
                  type="text"
                  value={profileName}
                  placeholder="Your name in chats"
                  autoComplete="name"
                  onChange={event => {
                    setProfileName(event.target.value);
                    setProfileInfo("");
                    setProfileError("");
                  }}
                  onKeyDown={event => event.key === "Enter" && saveProfileName()}
                  aria-label="Your name in chats"
                  style={{
                    minWidth:0,
                    height:42,
                    background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.22)",
                    border:`1px solid ${isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)"}`,
                    borderRadius:14,
                    color: da.text,
                    fontSize:14,
                    fontWeight:700,
                    padding:"0 12px",
                    outline:"none",
                    fontFamily:"inherit",
                  }}
                />
                <button
                  type="button"
                  onClick={saveProfileName}
                  disabled={!canSaveProfileName}
                  className="wc-btn"
                  style={{
                    height:42,
                    border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(255,255,255,0.14)"}`,
                    background:canSaveProfileName ? PAL.upload.accent : (isLight ? "rgba(31,24,78,0.08)" : "rgba(255,255,255,0.08)"),
                    borderRadius:999,
                    color:canSaveProfileName ? PAL.upload.bg : (isLight ? "rgba(31,24,78,0.34)" : "rgba(255,255,255,0.34)"),
                    fontSize:13,
                    fontWeight:850,
                    padding:"0 16px",
                    cursor:canSaveProfileName ? "pointer" : "default",
                    whiteSpace:"nowrap",
                  }}
                >
                  {profileBusy ? "Saving…" : "Save"}
                </button>
              </div>
              {(profileInfo || profileError) && (
                <div style={{ fontSize:12, color:profileError ? "#FFB090" : "#B0F4C8", lineHeight:1.5 }}>
                  {profileError || profileInfo}
                </div>
              )}
            </div>
            <div style={{
              width:"100%",
              background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.12)",
              border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.24)"}`,
              borderRadius:18,
              padding:"15px 16px",
              display:"flex",
              flexDirection:"column",
              gap:12,
            }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:da.text }}>App language</div>
                <div style={{ fontSize:12, color:isLight ? "rgba(31,24,78,0.48)" : "rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  {t("Auto selection will recognize the language from your chats.")}
                </div>
              </div>
              <div>
                <select
                  value={uiLangPref}
                  onChange={e => updateUiLangPref(e.target.value)}
                  aria-label="App language"
                  style={{
                    ...languageSelectStyle,
                    border:`1px solid ${autoLanguage ? (isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)") : (isLight ? "rgba(31,24,78,0.28)" : "rgba(255,255,255,0.28)")}`,
                  }}
                >
                  <option value="auto">{t("Auto-detect")}</option>
                  {LANG_OPTIONS.map(option => (
                    <option key={option.code} value={option.code}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ height:1, background: isLight ? "rgba(31,24,78,0.08)" : "rgba(255,255,255,0.08)" }} />
              <div>
                <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:da.text }}>{t("Report language")}</div>
                <div style={{ fontSize:12, color:isLight ? "rgba(31,24,78,0.48)" : "rgba(255,255,255,0.48)", lineHeight:1.5, marginTop:4 }}>
                  The language used for generated reads.
                </div>
              </div>
              <select
                value={reportLang}
                onChange={e => onReportLangChange(e.target.value)}
                aria-label={t("Report language")}
                style={{
                  ...languageSelectStyle,
                  minWidth:0,
                  border:`1px solid ${isLight ? "rgba(31,24,78,0.18)" : "rgba(255,255,255,0.18)"}`,
                }}
              >
                <option value="auto">{t("Auto-detect")}</option>
                {LANG_OPTIONS.map(option => (
                  <option key={option.code} value={option.code}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="wc-btn"
                style={{
                  width:"100%",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"space-between",
                  gap:14,
                  textAlign:"left",
                  background: isLight ? "rgba(31,24,78,0.07)" : "rgba(var(--wc-p),0.10)",
                  border:`1px solid ${isLight ? "rgba(31,24,78,0.14)" : "rgba(var(--wc-p),0.22)"}`,
                  borderRadius:18,
                  padding:"15px 16px",
                  color: da.text,
                }}
              >
                <span style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:da.muted }}>{t("Log out")}</span>
                <span style={{ fontSize:18, lineHeight:1, color: isLight ? "rgba(31,24,78,0.28)" : "rgba(255,255,255,0.28)" }}>›</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="wc-btn"
              style={{
                width:"100%",
                display:"flex",
                alignItems:"center",
                justifyContent:"space-between",
                gap:14,
                textAlign:"left",
                background:"rgba(224,64,64,0.12)",
                border:"1px solid rgba(224,64,64,0.35)",
                borderRadius:18,
                padding:"15px 16px",
                color:"#fff",
              }}
            >
              <span style={{ fontSize:15, fontWeight:800, letterSpacing:-0.2, color:"#FF8E8E" }}>{t("Delete my account")}</span>
              <span style={{ fontSize:18, lineHeight:1, color:"rgba(255,142,142,0.55)" }}>›</span>
            </button>
          </div>
        </div>
      </Shell>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          style={{
            position:"fixed",
            inset:0,
            zIndex:220,
            background:"rgba(0,0,0,0.62)",
            backdropFilter:"blur(6px)",
            WebkitBackdropFilter:"blur(6px)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:"20px",
          }}
          onClick={closeConfirm}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width:"min(380px, calc(100vw - 32px))",
              background: isLight ? "linear-gradient(180deg, #EDE8E0 0%, #E4DED4 100%)" : "linear-gradient(180deg, #211426 0%, #161018 100%)",
              border:`1px solid ${isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)"}`,
              borderRadius:24,
              padding:"22px 20px 18px",
              color: da.text,
              boxShadow:"0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            <div id="delete-account-title" style={{ fontSize:20, fontWeight:900, letterSpacing:-0.5, lineHeight:1.15 }}>
              {t("Are you sure you want to delete your account?")}
            </div>
            <div style={{ marginTop:10, fontSize:14, lineHeight:1.6, color: isLight ? "rgba(31,24,78,0.66)" : "rgba(255,255,255,0.66)" }}>
              {t("All your saved results will be gone. This permanently deletes your WrapChat account and cannot be undone.")}
            </div>
            {deleteError && (
              <div style={{ marginTop:14, fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.18)", border:"1px solid rgba(200,60,20,0.28)", padding:"10px 12px", borderRadius:14, lineHeight:1.45 }}>
                {deleteError}
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1.25fr", gap:10, marginTop:20 }}>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={deleteBusy}
                className="wc-btn"
                style={{
                  border:`1px solid ${isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)"}`,
                  background: isLight ? "rgba(31,24,78,0.06)" : "rgba(255,255,255,0.06)",
                  color: isLight ? "rgba(31,24,78,0.72)" : "rgba(255,255,255,0.72)",
                  borderRadius:16,
                  padding:"12px 10px",
                  fontSize:14,
                  fontWeight:800,
                  cursor:deleteBusy ? "default" : "pointer",
                  opacity:deleteBusy ? 0.55 : 1,
                }}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="wc-btn"
                style={{
                  border:"1px solid rgba(255,100,100,0.35)",
                  background:"rgba(224,64,64,0.82)",
                  color:"#fff",
                  borderRadius:16,
                  padding:"12px 10px",
                  fontSize:14,
                  fontWeight:900,
                  cursor:deleteBusy ? "wait" : "pointer",
                  opacity:deleteBusy ? 0.7 : 1,
                }}
              >
                {deleteBusy ? t("Deleting...") : t("Delete account")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// REPORT SELECT
// ─────────────────────────────────────────────────────────────────
const LANG_OPTIONS = [
  { code: "en", label: "English"    },
  { code: "tr", label: "Turkish"    },
  { code: "es", label: "Spanish"    },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic"     },
  { code: "fr", label: "French"     },
  { code: "de", label: "German"     },
  { code: "it", label: "Italian"    },
];

const DEBUG_RELATIONSHIP_OPTIONS = [
  { id: "partner", label: "Partner" },
  { id: "dating", label: "Dating" },
  { id: "ex", label: "Ex" },
  { id: "family", label: "Related" },
  { id: "friend", label: "Friend" },
  { id: "colleague", label: "Colleague" },
  { id: "other", label: "Other" },
];

export function PackSelect({
  animKey,
  math,
  onRunPack,
  onBack,
  error = "",
  unlockedPackIds = {},
  credits = null,
  accessMode = DEFAULT_ACCESS_MODE,
  hideCredits = false,
  quickReadAvailable = false,
  quickReadExpiresAt = null,
  onRunQuickRead = () => {},
  onOpenUnlock = () => {},
}) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const da = getDA(theme);
  const hasQuickReadChoice = !hideCredits && !isOpenMode(accessMode) && quickReadAvailable;
  const [openRead, setOpenRead] = useState(() => (hasQuickReadChoice ? "quick_read" : "vibe"));
  const stepProg  = math?.isGroup ? 1 : 2;
  const stepTotal = math?.isGroup ? 2 : 3;
  const showOpenNotice = !hideCredits && isOpenMode(accessMode);
  const showCreditsCounter = !hideCredits && !isOpenMode(accessMode) && Number.isInteger(credits);
  const isPackOwned = (id) => Boolean(hideCredits || isOpenMode(accessMode) || unlockedPackIds?.[id]);
  const quickReadOpen = openRead === "quick_read";

  return (
    <Shell sec="upload" prog={stepProg} total={stepTotal} contentAlign="start" hidePill>
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column",
        margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        padding:"0 20px 56px",
        minHeight:0,
        overflowY:"auto", overscrollBehavior:"contain",
      }}>
        <div style={getStickyHeaderStyle(theme === "light", { pullTop: 0 })}>
          <ScreenHeader back={onBack} title="Pick your read" centerTitle />
        </div>
        <FadeScale key={animKey}>
        <div style={{ fontSize:13, color:da.muted, lineHeight:1.5, textAlign:"center", margin:"-4px 8px 16px" }}>
          Choose the angle you want on this chat and uncover what is actually going on.
        </div>

	        {error && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", marginBottom:10 }}>{error}</div>}
        {showOpenNotice && (
          <div style={{ fontSize:12, color:"rgba(176,244,200,0.9)", background:"rgba(20,160,80,0.12)", border:"1px solid rgba(20,160,80,0.24)", borderRadius:14, padding:"8px 14px", width:"100%", textAlign:"center", lineHeight:1.6, marginBottom:10 }}>
            Open testing is active — analyses will not use credits.
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {hasQuickReadChoice && (
            <div
              onClick={() => setOpenRead(current => current === "quick_read" ? null : "quick_read")}
              className="wc-btn"
              style={{
                borderRadius:22,
                overflow:"hidden",
                cursor:"pointer",
                background:"rgba(122,144,255,0.16)",
                border:"1.5px solid rgba(122,144,255,0.48)",
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:quickReadOpen ? "16px 18px 12px" : "16px 18px", transition:"padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:14, minWidth:0 }}>
                  <SwatchIcon inner={PAL.trial.inner} accent={PAL.trial.accent} />
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:da.text, letterSpacing:"-0.015em", textAlign:"left" }}>Quick Read</div>
                    <div style={{ fontSize:10, fontWeight:800, color:PAL.trial.accent, marginTop:3, textAlign:"left", textTransform:"uppercase", letterSpacing:"0.07em" }}>
                      Free starter pass
                    </div>
                  </div>
                </div>
                <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(122,144,255,0.18)", display:"flex", alignItems:"center", justifyContent:"center", color:PAL.trial.accent, fontSize:13, transform:quickReadOpen ? "rotate(180deg)" : "none", transition:"transform 0.28s cubic-bezier(0.2,0,0.1,1)", flexShrink:0 }}>
                  ▾
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateRows:quickReadOpen ? "1fr" : "0fr", transition:"grid-template-rows 0.32s cubic-bezier(0.2,0,0.1,1)" }}>
                <div style={{ minHeight:0, overflow:"hidden" }}>
                  <div style={{ padding:"4px 18px 18px", opacity:quickReadOpen ? 1 : 0, transition:"opacity 0.22s ease" }}>
                    <div style={{ fontSize:13, color:da.muted, lineHeight:1.55, marginBottom:14, textAlign:"left" }}>
                      A fast first look at the vibe, communication pattern, and one useful takeaway. {quickReadExpiryLabel(quickReadExpiresAt)}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:da.muted }}>
                        <strong style={{ fontSize:18, fontWeight:900, color:da.text, marginRight:4 }}>1</strong> available
                      </div>
                      <button
                        type="button"
                        onClick={event => { event.stopPropagation(); onRunQuickRead(); }}
                        className="wc-btn"
                        style={{
                          borderRadius:999,
                          padding:"10px 22px",
                          fontSize:14,
                          fontWeight:800,
                          fontFamily:"'Nunito Sans',sans-serif",
                          cursor:"pointer",
                          border:"none",
                          background:PAL.trial.accent,
                          color:PAL.trial.bg,
                        }}
                      >
                        Use free read
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {PACK_ORDER.map(id => {
            const pack = PACK_DEFS[id];
            const open = openRead === id;
            const owned = isPackOwned(id);
            const locked = !owned;
            return (
              <div
                key={id}
                onClick={() => setOpenRead(current => current === id ? null : id)}
                className="wc-btn"
                style={{
                  borderRadius:22,
                  overflow:"hidden",
                  cursor:"pointer",
                  transition:"transform 0.18s cubic-bezier(0.2,0,0.1,1)",
                  background:owned ? (isLight ? `${pack.accent}18` : pack.bg) : `${pack.accent}12`,
                  border:`1.5px solid ${owned ? `${pack.accent}${isLight ? "99" : "70"}` : `${pack.accent}45`}`,
                  opacity:owned ? 1 : 0.86,
                }}
              >
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:open ? "16px 18px 12px" : "16px 18px", transition:"padding 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                    <PackSwatch pack={pack} />
                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                      <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:da.text, letterSpacing:"-0.015em", textAlign:"left" }}>{pack.name}</div>
                      <div style={{ fontSize:10, fontWeight:700, color:locked ? da.faint : pack.accent, marginTop:3, textAlign:"left" }}>
                        {pack.reports.length === 6 ? "All 6 reports" : `${pack.reports.length} ${pack.reports.length === 1 ? "report" : "reports"}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:`${pack.accent}18`, display:"flex", alignItems:"center", justifyContent:"center", color:`${pack.accent}CC`, fontSize:13, transform:open ? "rotate(180deg)" : "none", transition:"transform 0.28s cubic-bezier(0.2,0,0.1,1)" }}>
                    ▾
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateRows:open ? "1fr" : "0fr", transition:"grid-template-rows 0.32s cubic-bezier(0.2,0,0.1,1)" }}>
                  <div style={{ minHeight:0, overflow:"hidden" }}>
                    <div style={{ padding:"4px 18px 18px", opacity:open ? 1 : 0, transition:"opacity 0.22s ease" }}>
                      <div style={{ fontSize:13, color:da.muted, lineHeight:1.55, marginBottom:14, textAlign:"left" }}>
                        {pack.desc}
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                        {pack.tags.map(tag => (
                          <span key={tag} style={{ background:`${pack.accent}18`, borderRadius:999, padding:"4px 11px", fontSize:11, fontWeight:600, color:`${pack.accent}CC` }}>{tag}</span>
                        ))}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:13, fontWeight:700, color:da.faint }}>
                          <strong style={{ fontSize:18, fontWeight:900, color:locked ? da.faint : da.text, marginRight:4 }}>{hideCredits || isOpenMode(accessMode) ? "∞" : (unlockedPackIds?.[id] ?? 0)}</strong> left
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (locked) onOpenUnlock(id);
                            else onRunPack(pack);
                          }}
                          className="wc-btn"
                          style={{
                            borderRadius:999,
                            padding:"10px 22px",
                            fontSize:14,
                            fontWeight:700,
                            fontFamily:"'Nunito Sans',sans-serif",
                            cursor:"pointer",
                            border:"none",
                            background:locked ? pack.accent : pack.accent,
                            color:locked ? pack.fg : pack.fg,
                          }}
                        >
                          {locked ? "Unlock" : "Run"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </FadeScale>

      </div>
    </Shell>
  );
}

export function PaymentScreen({ preselect = null, credits = null, userId = null, onBack, onPaymentComingSoon, onPurchaseCredits = null }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const getSuggestedBundleId = () => {
    const packCost = getPackCreditCost(preselect);
    const balance = Number.isInteger(credits) ? credits : 0;
    const needed = packCost != null ? Math.max(packCost - balance, 0) : 0;
    if (needed > 0) {
      return CREDIT_BUNDLES.find(bundle => bundle.credits >= needed)?.id || "plus";
    }
    return "plus";
  };
  const [selectedBundleId, setSelectedBundleId] = useState(getSuggestedBundleId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedBundleId(getSuggestedBundleId());
  }, [preselect, credits]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedBundle = getCreditBundleById(selectedBundleId) || CREDIT_BUNDLES[1];
  const analysesLeft = estimateAnalysesLeft(credits);

  const pay = async (bundle = selectedBundle) => {
    if (!bundle) return;
    setBusy(true);
    setError("");
    console.log("Payment coming soon", {
      creditBundleId: bundle.id,
      credits: bundle.credits,
      price: bundle.price,
      priceLabel: bundle.priceLabel,
      userId: userId || null,
    });
    try {
      if (onPurchaseCredits) {
        await onPurchaseCredits(bundle);
      } else {
        onPaymentComingSoon?.();
      }
    } catch (purchaseError) {
      console.error("Credit purchase simulation failed", purchaseError);
      setError("Couldn't add credits right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hidePill>
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column",
        margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        padding:"0 20px 56px",
        minHeight:0,
        overflowY:"auto", overscrollBehavior:"contain",
      }}>
        <div style={getStickyHeaderStyle(theme === "light", { pullTop: 0 })}>
          <ScreenHeader back={onBack} title="Add Credits" />
        </div>
        <div style={{ fontSize:14, color:da.muted, lineHeight:1.5, marginBottom:18 }}>Add credits once. Use them whenever you want.</div>
        {error && (
          <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", marginBottom:12 }}>
            {error}
          </div>
        )}

        <div style={{ background:"rgba(var(--wc-p),0.12)", border:"1px solid rgba(var(--wc-p),0.28)", borderRadius:18, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:9 }}>
            <span style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:da.faint, whiteSpace:"nowrap" }}>Your balance</span>
            <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, lineHeight:1, fontWeight:900, color:da.text, letterSpacing:"-0.02em" }}>{Number.isInteger(credits) ? credits : "—"}</span>
            <span style={{ fontSize:12, fontWeight:800, color:da.faint }}>credits</span>
          </div>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:da.faint, margin:"0 2px 2px" }}>Add Credits</div>
          {CREDIT_BUNDLES.map(bundle => {
            const active = selectedBundleId === bundle.id;
            return (
              <button
                key={bundle.id}
                type="button"
                onClick={() => setSelectedBundleId(bundle.id)}
                className="wc-btn"
                style={{
                  borderRadius:20,
                  padding:"14px 16px",
                  display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                  cursor:"pointer",
                  border:`1.5px solid ${active ? "rgba(var(--wc-p),0.70)" : "rgba(var(--wc-p),0.22)"}`,
                  background:active ? "rgba(var(--wc-p),0.22)" : "rgba(var(--wc-p),0.07)",
                  color:da.text,
                  textAlign:"left",
                }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                  <div style={{ width:42, height:42, borderRadius:14, background:bundle.recommended ? "rgba(var(--wc-p),0.32)" : "rgba(var(--wc-p),0.14)", border:`1px solid ${bundle.recommended ? "rgba(var(--wc-p),0.60)" : "rgba(var(--wc-p),0.28)"}`, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                    <img src={CREDIT_BUNDLE_ICON[bundle.id]} alt={bundle.label} style={{ width:"92%", height:"92%", objectFit:"contain" }} />
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:0 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:16, fontWeight:900, color:da.text, letterSpacing:"-0.01em", display:"flex", alignItems:"center", gap:5 }}>
                      <span>{bundle.label}</span>
                      {bundle.recommended && <SolidStarIcon size={12} color="#c090e8" />}
                      {bundle.recommended && (
                        <span style={{ border:"1px solid rgba(var(--wc-p),0.55)", background:"rgba(var(--wc-p),0.20)", color:"#c090e8", borderRadius:999, padding:"2px 7px", fontSize:9, lineHeight:1.1, fontWeight:900, letterSpacing:"0.08em", textTransform:"uppercase" }}>
                          Popular
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:active ? "rgba(176,141,224,0.90)" : "rgba(176,141,224,0.48)", lineHeight:1.35, whiteSpace:"normal" }}>
                      {bundle.credits} credits
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:900, color:bundle.recommended ? "#c090e8" : da.muted, flexShrink:0 }}>{bundle.priceLabel}</div>
              </button>
            );
          })}
        </div>

        <div style={{ background:"rgba(var(--wc-p),0.08)", border:"1px solid rgba(var(--wc-p),0.20)", borderRadius:18, padding:"16px 18px", marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:900, letterSpacing:"0.09em", textTransform:"uppercase", color:da.faint, marginBottom:10 }}>What can I do with credits?</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {PACK_ORDER.map(id => {
              const pack = PACK_DEFS[id];
              return (
                <div key={id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                  <div style={{ fontSize:13, color:da.muted, fontWeight:700 }}>{pack.name}</div>
                  <div style={{ fontSize:13, color:pack.accent, fontWeight:900 }}>{pack.cost} credits</div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => pay(selectedBundle)}
          disabled={busy}
          className="wc-btn"
          style={{ width:"100%", padding:17, borderRadius:999, border:"none", fontSize:16, fontWeight:700, fontFamily:"'Nunito Sans',sans-serif", cursor:busy ? "wait" : "pointer", marginBottom:12, background:"#9d70d4", color:"#f0e8ff", opacity:busy ? 0.72 : 1 }}
        >
          {busy ? "Adding..." : `Add ${selectedBundle?.credits || 0} credits`}
        </button>

        <div style={{ textAlign:"center", fontSize:12, color:da.faint, lineHeight:1.6 }}>
          <strong style={{ color:da.muted, fontWeight:600 }}>Credits never expire.</strong> One-time purchases only.<br/>No subscriptions. Leftover credits stay in your account.
        </div>
      </div>
    </Shell>
  );
}

function resultPreviewFields(row) {
  const displayLang = getStoredResultDisplayLanguage(row?.result_data);
  const ai = getDisplayResultData(row?.result_data, displayLang);
  const math = row?.math_data || {};
  const control = (value) => translateControlValue(displayLang, value) || value;
  switch (row?.report_type) {
    case "general": {
      const score = math.bondScore ?? math.connectionScore ?? math.chatScore ?? null;
      return {
        stat: score != null ? String(score) : `${Math.min(10, Math.max(1, Math.round(((math.streak || 0) / 30) + 6)))}`,
        label: "bond score",
        insight: ai?.vibeOneLiner || ai?.relationshipSummary || ai?.groupDynamic || ai?.takeaway || "Your full chat read is ready.",
        title: "Your Chat, Unwrapped",
      };
    }
    case "lovelang": {
      const lang = control(ai?.personA?.language || ai?.personB?.language || "");
      return {
        stat: lang ? String(lang).split(/\s+/)[0] : "—",
        label: "primary",
        insight: ai?.compatibilityRead || ai?.personA?.examples || ai?.mismatch || "Your love language read is ready.",
        title: "How You Show Up",
      };
    }
    case "energy": {
      const scores = [ai?.personA?.netScore, ai?.personB?.netScore].map(Number).filter(Number.isFinite);
      const avg = scores.length ? Math.round((scores.reduce((sum, n) => sum + n, 0) / scores.length) * 10) : null;
      return {
        stat: avg != null ? `${avg}%` : "—",
        label: "positive",
        insight: ai?.compatibility || ai?.personA?.goodNews || ai?.mostEnergising || "Your energy read is ready.",
        title: "The Energy Between You",
      };
    }
    case "toxicity":
      return {
        stat: ai?.chatHealthScore != null ? `${ai.chatHealthScore}/10` : (chatHealthLabel(ai?.chatHealthScore) || math.toxicityLevel || "—"),
        label: "health",
        insight: ai?.verdict || ai?.conflictPattern || "Your red flags read is ready.",
        title: "What Feels Off",
      };
    case "accounta": {
      const a = ai?.personA;
      const b = ai?.personB;
      const lead = [a, b].filter(Boolean).sort((left, right) => (Number(right?.score) || 0) - (Number(left?.score) || 0))[0];
      return {
        stat: lead?.name ? shortDisplayName(lead.name) : `${a?.kept || 0}/${b?.kept || 0}`,
        label: "steady",
        insight: ai?.overallVerdict || lead?.detail || ai?.followThroughPattern || "Your accountability read is ready.",
        title: "Promises & Follow-Through",
      };
    }
    case "growth":
      return {
        stat: control(ai?.trajectory) || "—",
        label: "trajectory",
        insight: ai?.arcSummary || ai?.trajectoryDetail || "Your growth read is ready.",
        title: "The Arc",
      };
    default:
      return { stat:"—", label:"read", insight:"Your report is ready.", title:reportTypeMeta(row?.report_type).label };
  }
}

function shortDisplayName(name) {
  return String(name || "—").trim().split(/\s+/)[0] || "—";
}

export function PackResultsBuffer({ rows, pack, onClose, onOpenReport }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const da = getDA(theme);
  const orderedRows = [...(rows || [])].sort((a, b) => {
    const ai = pack.reports.indexOf(a.report_type);
    const bi = pack.reports.indexOf(b.report_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const runDate = orderedRows[0]?.created_at;
  const firstRow = orderedRows[0] || {};
  const participantLabel = (() => {
    const names = Array.isArray(firstRow?.names) ? firstRow.names.filter(Boolean) : [];
    const namesTitle = compactNamesLabel(names);
    if (namesTitle) return namesTitle;
    const displayTitle = firstRow?.result_data?.runMetadata?.displayTitle || firstRow?.math_data?.display_title || firstRow?.math_data?.displayTitle || "";
    return String(displayTitle || "").replace(/,\s*combined\b/i, "").trim();
  })();
  const titleNode = (
    <div style={{ display:"flex", flexDirection:"column", gap:5, minWidth:0 }}>
      <span style={{ display:"block", fontSize:participantLabel.length > 24 ? 23 : 27, lineHeight:1.04, fontWeight:900, letterSpacing:-1, overflowWrap:"anywhere" }}>
        {participantLabel || pack.name}
      </span>
    </div>
  );
  const daysAgo = (() => {
    const diff = Math.floor((new Date() - new Date(runDate)) / 864e5);
    if (!Number.isFinite(diff) || diff <= 0) return "today";
    if (diff === 1) return "1 day ago";
    return `${diff} days ago`;
  })();

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hidePill palette={{ ...PAL.upload, accent:pack.accent }}>
      <div style={{ alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))", padding:"0 20px calc(96px + env(safe-area-inset-bottom, 0px))", minHeight:0, overflowY:"auto", overscrollBehavior:"contain" }}>
        <div style={getStickyHeaderStyle(theme === "light", { pullTop: 0 })}>
          <ScreenHeader back={onClose} titleNode={titleNode} />
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {orderedRows.map(row => {
            const rt = reportTypeMeta(row.report_type);
            const pal = PAL[rt.palette] || PAL.upload;
            const styleMap = isLight ? REPORT_BUFFER_STYLE_LIGHT : REPORT_BUFFER_STYLE;
            const style = styleMap[row.report_type] || styleMap.general;
            const dimText  = isLight ? da.faint   : "rgba(255,255,255,0.32)";
            const bodyText = isLight ? da.muted   : "rgba(255,255,255,0.65)";
            const divider  = isLight ? `${pal.accent}22` : "rgba(255,255,255,0.08)";
            const chevronBg    = isLight ? `${pal.accent}12` : "rgba(255,255,255,0.08)";
            const chevronBorder= isLight ? `${pal.accent}30` : "rgba(255,255,255,0.12)";
            const chevronColor = isLight ? pal.accent        : "rgba(255,255,255,0.40)";
            const preview = resultPreviewFields(row);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onOpenReport(row)}
                className="wc-btn"
                style={{ borderRadius:24, padding:20, cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", flexDirection:"column", flexShrink:0, background:style.bg, border:`1.5px solid ${style.border}`, color:da.text, textAlign:"left" }}
              >
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                    <SwatchIcon inner={pal.inner} accent={pal.accent} />
                    <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                      <div style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", width:"fit-content", background:style.pillBg, color:pal.accent, border:`1px solid ${style.pillBorder}` }}>
                        {rt.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background:chevronBg, border:`1px solid ${chevronBorder}`, display:"flex", alignItems:"center", justifyContent:"center", color:chevronColor, fontSize:14, marginTop:2 }}>›</div>
                </div>
                <div style={{ height:1, background:divider, marginBottom:14 }} />
                <div style={{ display:"flex", alignItems:"stretch", gap:12 }}>
                  <div style={{ display:"flex", flexDirection:"column", flexShrink:0, minWidth:52 }}>
                    <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1, color:pal.accent }}>{preview.stat}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:dimText, letterSpacing:"0.06em", textTransform:"uppercase", marginTop:3 }}>{preview.label}</div>
                  </div>
                  <div style={{ width:1, background:divider, alignSelf:"stretch" }} />
                  <div style={{ fontSize:13, fontWeight:500, fontStyle:"italic", color:bodyText, lineHeight:1.55, flex:1 }}>
                    "{cleanQuote(preview.insight, 120)}"
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop:24, textAlign:"center", fontSize:11, color:isLight ? da.faint : "rgba(255,255,255,0.20)", lineHeight:1.6, letterSpacing:"0.02em" }}>
          {orderedRows.length} reports · {pack.name} · run {daysAgo}
        </div>
      </div>
    </Shell>
  );
}

export function UpgradePlaceholder({ info, onBack, credits = null, userRole = "user", accessMode = "credits", onOpenPayment = () => {}, onBuyPacks = null }) {
  const t = useT();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const da = getDA(theme);
  const mode      = info?.accessMode || accessMode;
  const [buying, setBuying] = useState(false);

  const isPayments = mode === "payments";
  const isTester   = userRole === "tester";
  const canUnlockWithCredits = (isPayments || mode === "credits") && !isTester;
  const balance = parseCreditBalance(credits);
  const initialPackId = PACK_ORDER.find(id => PACK_DEFS[id].cost === info?.requiredCredits) || "vibe";
  const [selected, setSelected] = useState(() => (
    Object.fromEntries(PACK_ORDER.map(id => [id, id === initialPackId ? 1 : 0]))
  ));

  const selectedIds = PACK_ORDER.filter(id => (selected[id] || 0) > 0);
  const selectedItemCount = selectedIds.reduce((sum, id) => sum + (selected[id] || 0), 0);
  const selectedCreditTotal = selectedIds.reduce((sum, id) => sum + (PACK_DEFS[id].cost * (selected[id] || 0)), 0);
  const selectedSingleId = selectedItemCount === 1 ? selectedIds[0] : null;
  const selectedPack = selectedSingleId ? PACK_DEFS[selectedSingleId] : null;
  const selectedPacks = selectedIds.map(id => PACK_DEFS[id]).filter(Boolean);
  const selectedAccent = selectedPack?.accent || "#C4AAFF";
  const selectedFg = selectedPack?.fg || "#100630";
  const hasEnoughCredits = balance != null && selectedCreditTotal > 0 && balance >= selectedCreditTotal;
  const remainingAfterSelection = balance != null ? balance - selectedCreditTotal : null;
  const canBuySelectedPacks = typeof onBuyPacks === "function";
  const canUnlockSelection = Boolean(hasEnoughCredits && selectedPacks.length && canBuySelectedPacks && !buying);
  const packDescriptionText = (id) => (
    id === "vibe" ? "Connection style, affection, and energy." :
    id === "rf" ? "Tension patterns and accountability gaps." :
    id === "full" ? "All reports, one full relationship read at once." :
    "How the chat changed from start to now."
  );

  const changeQty = (id, delta) => {
    setSelected(prev => {
      const current = prev[id] || 0;
      return { ...prev, [id]: Math.max(0, Math.min(9, current + delta)) };
    });
  };

  const handlePrimary = async () => {
    if (!canUnlockSelection) return;
    setBuying(true);
    try {
      await onBuyPacks(selectedPacks, selectedCreditTotal);
    } finally {
      setBuying(false);
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hidePill>
      <div style={{
        alignSelf:"stretch", flex:1, display:"flex", flexDirection:"column", gap:10,
        margin:"-16px -20px calc(-24px - env(safe-area-inset-bottom, 0px))",
        padding:"0 20px 56px",
        minHeight:0,
        overflowY:"auto", overscrollBehavior:"contain",
      }}>
      <div style={getStickyHeaderStyle(theme === "light", { pullTop: 0, alpha: 0.94, blur: 8 })}>
      {canUnlockWithCredits && (
        <div style={{ position:"absolute", top:SCREEN_HEADER_CONTROL_TOP, right:20, minHeight:40, zIndex:12, display:"flex", alignItems:"center" }}>
          <div style={{
            height:34,
            boxSizing:"border-box",
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(var(--wc-p),0.16)",
            border:"1px solid rgba(var(--wc-p),0.32)",
            borderRadius:999,
            padding:"5px 7px 5px 10px",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <img src={coinIcon} alt="credits" style={{ width:16, height:16 }} />
              <span style={{ fontFamily:"'Nunito',sans-serif", fontSize:14, lineHeight:1, fontWeight:900, color:da.text }}>{balance != null ? balance : "—"}</span>
            </div>
            {isPayments && (
              <>
                <div style={{ width:1, height:14, background:isLight ? "rgba(31,24,78,0.16)" : "rgba(255,255,255,0.12)", margin:"0 1px" }} />
                <button
                  type="button"
                  onClick={() => onOpenPayment(null)}
                  className="wc-btn"
                  aria-label="Add Credits"
                  style={{
                    width:22, height:22, borderRadius:"50%",
                    background:isLight ? "rgba(31,24,78,0.08)" : "rgba(255,255,255,0.10)",
                    border:`1px solid ${isLight ? "rgba(31,24,78,0.20)" : "rgba(255,255,255,0.16)"}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:isLight ? "rgba(31,24,78,0.82)" : "rgba(255,255,255,0.82)",
                    fontSize:14, fontWeight:700, lineHeight:1,
                    padding:0, paddingBottom:2, flexShrink:0, cursor:"pointer",
                  }}
                >
                  +
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <ScreenHeader back={onBack} backLabel="Back to reports" title={canUnlockWithCredits ? "Unlock reads" : "More credits needed"} />
      </div>

      {canUnlockWithCredits ? (
        <>
          <Sub mt={2}>{isPayments ? t("Pick reads to unlock — leftover credits stay.") : t("Choose the reads you want to unlock with your available credits.")}</Sub>

          <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
            {PACK_ORDER.map(id => {
              const pack = PACK_DEFS[id];
              const qty = selected[id] || 0;
              const active = qty > 0;
              return (
                <div
                  key={id}
                  className="wc-btn"
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
                    background:active ? (isLight ? `${pack.accent}22` : pack.paymentSelectedBorder) : `${pack.accent}${isLight ? "14" : "12"}`,
                    border:active ? `1.5px solid ${pack.accent}${isLight ? "88" : "00"}` : `1.5px solid ${pack.accent}${isLight ? "55" : "45"}`,
                    borderRadius:active ? 18 : 22,
                    padding:"12px 14px",
                    color:da.text,
                    textAlign:"left",
                    cursor:"pointer",
                    opacity:active ? 1 : (isLight ? 1 : 0.86),
                  }}
                  onClick={() => !active && changeQty(id, 1)}
                >
                  <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                    <PackSwatch pack={pack} />
                    <div style={{ minWidth:0, flex:"1 1 auto" }}>
                      <div style={{ fontSize:14, fontWeight:900, color:da.text }}>{pack.name}</div>
                      <div style={{
                        fontSize:11,
                        color:active ? pack.accent : (isLight ? da.muted : "rgba(255,255,255,0.46)"),
                        lineHeight:1.35,
                      }}>
                        {packDescriptionText(id)}
                      </div>
                      <div style={{ fontSize:10, fontWeight:900, letterSpacing:"0.07em", textTransform:"uppercase", color:active ? pack.accent : (isLight ? da.faint : "rgba(255,255,255,0.32)"), marginTop:6 }}>
                        {pack.reports.length === 6 ? "All 6 reports" : `${pack.reports.length} ${pack.reports.length === 1 ? "report" : "reports"}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8, flexShrink:0, minWidth:active ? 106 : 78 }}>
                    {!active ? (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); changeQty(id, 1); }}
                        className="wc-btn"
                        style={{ border:"none", background:"transparent", padding:"8px 0", fontFamily:"'Nunito',sans-serif", fontSize:14, lineHeight:1, fontWeight:900, color:pack.accent, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}
                      >
                        <img src={coinIcon} alt="" style={{ width:16, height:16, filter:PACK_COIN_FILTER[id] }} />{pack.cost}
                      </button>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:5, border:`1px solid ${pack.accent}66`, background:isLight ? `${pack.accent}12` : "rgba(0,0,0,0.14)", borderRadius:999, padding:3 }}>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); changeQty(id, -1); }}
                          className="wc-btn"
                          aria-label={`Remove ${pack.name}`}
                          style={{ width:22, height:22, borderRadius:"50%", border:"none", background:isLight ? `${pack.accent}22` : "rgba(255,255,255,0.10)", color:isLight ? pack.accent : "rgba(255,255,255,0.82)", display:"flex", alignItems:"center", justifyContent:"center", padding:"0 0 2px 0", fontSize:15, fontWeight:800, cursor:"pointer" }}
                        >
                          -
                        </button>
                        <div style={{ width:20, textAlign:"center", fontSize:13, fontWeight:900, color:pack.accent }}>{qty}</div>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); changeQty(id, 1); }}
                          className="wc-btn"
                          aria-label={`Add ${pack.name}`}
                          style={{ width:22, height:22, borderRadius:"50%", border:"none", background:pack.accent, color:pack.fg || "#fff", display:"flex", alignItems:"center", justifyContent:"center", padding:0, paddingBottom:2, fontSize:15, fontWeight:900, cursor:"pointer" }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ width:"100%", background:"rgba(var(--wc-p),0.10)", border:"1px solid rgba(var(--wc-p),0.22)", borderRadius:18, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
            {selectedIds.length ? selectedIds.map(id => {
              const pack = PACK_DEFS[id];
              const qty = selected[id] || 0;
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div style={{ fontSize:13, color:pack.accent, fontWeight:800 }}>{pack.name}{qty > 1 ? ` x${qty}` : ""}</div>
                  <div style={{ fontSize:13, color:isLight ? da.muted : "rgba(255,255,255,0.66)", fontWeight:800, display:"flex", alignItems:"center", gap:4 }}><img src={coinIcon} alt="" style={{ width:13, height:13 }} />{pack.cost * qty}</div>
                </div>
              );
            }) : (
              <div style={{ fontSize:13, color:isLight ? da.faint : "rgba(255,255,255,0.24)" }}>Nothing selected yet</div>
            )}
            <div style={{ height:1, background:isLight ? "rgba(31,24,78,0.10)" : "rgba(255,255,255,0.07)", margin:"2px 0" }} />
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
              <div style={{ fontSize:14, fontWeight:900, color:da.text }}>Total</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:24, fontWeight:900, color:selectedPacks.length ? selectedAccent : da.text, display:"flex", alignItems:"center", gap:6 }}><img src={coinIcon} alt="" style={{ width:20, height:20 }} />{selectedCreditTotal}</div>
            </div>
            {remainingAfterSelection != null && (
              <div style={{ fontSize:12, color:remainingAfterSelection >= 0 ? (isLight ? da.muted : "rgba(255,255,255,0.44)") : "rgba(255,176,144,0.86)", textAlign:"right", fontWeight:800, display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4 }}>
                <img src={coinIcon} alt="" style={{ width:12, height:12 }} />
                {remainingAfterSelection >= 0 ? `${remainingAfterSelection} left after unlock` : `${Math.abs(remainingAfterSelection)} more needed`}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handlePrimary}
            disabled={!canUnlockSelection}
            className="wc-btn"
            style={{ width:"100%", padding:16, borderRadius:999, border:"none", fontSize:16, fontWeight:800, fontFamily:"'Nunito Sans',sans-serif", cursor:canUnlockSelection ? "pointer" : "default", background:canUnlockSelection ? selectedAccent : (isLight ? "rgba(31,24,78,0.08)" : "rgba(255,255,255,0.10)"), color:canUnlockSelection ? selectedFg : (isLight ? "rgba(31,24,78,0.35)" : "rgba(255,255,255,0.30)"), opacity:canUnlockSelection ? 1 : 0.72 }}
          >
            {buying ? "Unlocking..." : "Unlock"}
          </button>
          {!hasEnoughCredits && selectedCreditTotal > 0 && (
            <button
              type="button"
              onClick={() => isPayments ? onOpenPayment(selectedSingleId) : null}
              disabled={!isPayments}
              className="wc-btn"
              style={{ width:"100%", padding:14, borderRadius:999, background:isPayments ? "rgba(var(--wc-p),0.14)" : "rgba(var(--wc-p),0.06)", border:`1.5px solid ${isPayments ? "rgba(var(--wc-p),0.35)" : "rgba(var(--wc-p),0.16)"}`, color:isPayments ? "rgba(200,170,240,0.88)" : "rgba(200,170,240,0.35)", fontSize:14, fontWeight:700, fontFamily:"'Nunito Sans',sans-serif", cursor:isPayments ? "pointer" : "default", textAlign:"center" }}
            >
              {isPayments ? "Add Credits" : "Ask admin for more credits"}
            </button>
          )}
        </>
      ) : isTester ? (
        <Sub mt={2}>{t("You're in beta testing mode — credits are managed by the admin. Reach out to get more.")}</Sub>
      ) : (
        <Sub mt={2}>{info?.message || t("You need credits to run these reports. Ask an admin to add credits to your account.")}</Sub>
      )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SLIDE
// ─────────────────────────────────────────────────────────────────
// SLIDE_MS and SLIDE_EASE are defined above Shell, which consumes them.

// Slide is now a thin context provider only.
// Shell consumes SlideContext and animates its content area internally,
// keeping the chrome (background, progress bar, pill, close button) perfectly still.
export function Slide({ children, dir, id, animateIn = false }) {
  return (
    <SlideContext.Provider value={{ dir, id, animateIn }}>
      {children}
    </SlideContext.Provider>
  );
}

// Entry-only wrapper: fades in + scales from 0.93→1 (320ms ease-out).
// Use key={someId} on the parent to re-trigger on data changes.
export function FadeScale({ children }) {
  return (
    <div className="wc-fade-scale" style={{ animation: "wcFadeScaleIn 320ms ease-out both", willChange: "opacity, transform", width: "100%" }}>
      {children}
    </div>
  );
}

// Wraps a list of children and staggers each item in (55ms apart, 280ms ease-out).
// Pass key={listKey} on <StaggerList> to re-trigger when the list changes.
export function StaggerList({ children }) {
  const items = Array.isArray(children) ? children : (children ? [children] : []);
  return items.map((child, i) =>
    child ? (
      <div key={child?.key ?? i} className="wc-stagger-item" style={{ animation: `wcStaggerItemIn 280ms ${i * 55}ms ease-out both`, willChange: "opacity, transform" }}>
        {child}
      </div>
    ) : null
  );
}

export function SlidingSegmentedTabs({
  items,
  value,
  onChange,
  ariaLabel,
  compact = false,
  background: bgProp,
  activeBackground: activeBgProp,
  inactiveColor: inactiveColorProp,
  activeColor: activeColorProp,
  padding = 4,
}) {
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const background       = bgProp       ?? (isLight ? "rgba(31,24,78,0.08)" : "rgba(0,0,0,0.25)");
  const activeBackground = activeBgProp ?? (isLight ? "rgba(31,24,78,0.15)" : "rgba(255,255,255,0.18)");
  const inactiveColor    = inactiveColorProp ?? da.muted;
  const activeColor      = activeColorProp   ?? da.text;
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const activeIndex = Math.max(0, safeItems.findIndex(item => item.id === value));
  const count = Math.max(1, safeItems.length);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        position:"relative",
        display:"grid",
        gridTemplateColumns:`repeat(${count}, minmax(0, 1fr))`,
        background,
        borderRadius:999,
        padding,
        width:"calc(100% - 8px)",
        margin:"0 0 0 auto",
        overflow:"hidden",
      }}
    >
      <div
        aria-hidden="true"
        className="wc-segmented-indicator"
        style={{
          position:"absolute",
          top:padding,
          bottom:padding,
          left:padding,
          width:`calc((100% - ${padding * 2}px) / ${count})`,
          borderRadius:999,
          background:activeBackground,
          transform:`translateX(${activeIndex * 100}%)`,
          transition:`transform 240ms cubic-bezier(0.22, 1, 0.36, 1)`,
          willChange:"transform",
        }}
      />
      {safeItems.map(item => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item.id)}
            className="wc-btn"
            style={{
              position:"relative",
              zIndex:1,
              minWidth:0,
              border:"none",
              borderRadius:999,
              padding:compact ? "6px 0" : "10px 6px",
              fontSize:compact ? 12 : 14,
              fontWeight:700,
              cursor:"pointer",
              background:"transparent",
              color:active ? activeColor : inactiveColor,
              letterSpacing:compact ? 0 : 0.1,
              transition:"color 180ms ease, opacity 180ms ease",
              display:"flex",
              alignItems:"center",
              justifyContent:"center",
              gap:5,
            }}
          >
            {item.label}
            {item.suffix}
          </button>
        );
      })}
    </div>
  );
}

export function AuthPhaseFade({ phase, children }) {
  const previousPhaseRef = useRef(phase);
  const previousChildrenRef = useRef(children);
  const [exiting, setExiting] = useState(null);

  useLayoutEffect(() => {
    if (phase === previousPhaseRef.current) return;

    setExiting({
      phase: previousPhaseRef.current,
      children: previousChildrenRef.current,
    });
    previousPhaseRef.current = phase;
    previousChildrenRef.current = children;

    const t = setTimeout(() => setExiting(null), 220);
    return () => clearTimeout(t);
  }, [phase]);

  useLayoutEffect(() => {
    previousChildrenRef.current = children;
  }, [children]);

  return (
    <div style={{ position:"relative", width:"100%" }}>
      {exiting && (
        <div
          key={`exit-${exiting.phase}`}
          className="wc-auth-fade"
          style={{
            position:"absolute",
            inset:0,
            width:"100%",
            animation:"wcAuthFadeOut 180ms ease-out both",
            pointerEvents:"none",
          }}
        >
          {exiting.children}
        </div>
      )}
      <div
        key={`enter-${phase}`}
        className="wc-auth-fade"
        style={{
          width:"100%",
          animation:"wcAuthFadeIn 220ms 90ms ease-out both",
          pointerEvents: exiting ? "none" : "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// CREDITS
// ─────────────────────────────────────────────────────────────────
const OUT_OF_CREDITS_MESSAGE = "You've used all your credits. More coming soon — stay tuned.";

// ─────────────────────────────────────────────────────────────────
// AUTH + UPLOAD FRAME
// Single component for both "auth" and "upload" phases.
// BrandLockup is rendered in a persistent absolutely-positioned layer
// that never participates in auth phase transitions, so it stays
// completely still when the user signs in and the phase changes
// from "auth" to "upload".
// ─────────────────────────────────────────────────────────────────
export function AuthUploadFrame({
  phase,
  onParsed,
  onHistory,
  onAdmin,
  canAdmin,
  uploadError = "",
  uploadInfo = "",
  credits = null,
  quickReadAvailable = false,
  hideCredits = false,
  unlockedPackIds = {},
  accessMode = DEFAULT_ACCESS_MODE,
  firstRunQuickRead = false,
  onClearError,
  onUpgrade,
  onPayment,
  authPreview = null,
}) {
  const t = useT();
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";

  // ── Auth state ──────────────────────────────────────────────────
  const [authTab,      setAuthTab]      = useState("login");
  const [authEmail,    setAuthEmail]    = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authErr,      setAuthErr]      = useState("");
  const [authInfo,     setAuthInfo]     = useState("");
  const [authBusy,     setAuthBusy]     = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);

  const switchAuthTab = (newTab) => { setAuthTab(newTab); setAuthErr(""); setAuthInfo(""); };

  const authSubmit = async () => {
    if (!authEmail || !authPassword) { setAuthErr("Please fill in both fields."); return; }
    setAuthBusy(true); setAuthErr(""); setAuthInfo("");
    try {
      if (authTab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) setAuthErr(normalizeAuthError(error, "login"));
        else if (!staySignedIn) {
          try { sessionStorage.setItem("wrapchat_signout_on_close", "1"); } catch { /* ignore */ }
        } else {
          try { sessionStorage.removeItem("wrapchat_signout_on_close"); } catch { /* ignore */ }
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail, password: authPassword,
          options: { emailRedirectTo: getAuthConfirmationRedirectUrl() },
        });
        if (error) {
          setAuthErr(normalizeAuthError(error, "signup"));
        } else if (data?.user?.identities?.length === 0) {
          setAuthErr("This email is already registered. Log in instead.");
        } else {
          setAuthInfo("Check your email to confirm your account, then log in.");
        }
      }
    } catch { setAuthErr("Something went wrong. Please try again."); }
    setAuthBusy(false);
  };

  // Reset auth form whenever we return to the auth phase
  useEffect(() => {
    if (phase === "auth") {
      setAuthTab(authPreview?.tab || "login");
      setAuthEmail(authPreview?.email || "");
      setAuthPassword(authPreview?.password || "");
      setAuthErr(authPreview?.error || "");
      setAuthInfo(authPreview?.info || "");
      setAuthBusy(Boolean(authPreview?.busy));
      setStaySignedIn(authPreview?.staySignedIn !== false);
    }
  }, [phase, authPreview]);

  useEffect(() => {
    const handlePageHide = () => {
      try {
        if (sessionStorage.getItem("wrapchat_signout_on_close") === "1") {
          void supabase.auth.signOut();
          sessionStorage.removeItem("wrapchat_signout_on_close");
        }
      } catch {
        // Best effort only; password storage stays with the OS/browser.
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  // ── Upload state ────────────────────────────────────────────────
  const [uploadLocalErr, setUploadLocalErr] = useState("");
  const [uploadBusy,     setUploadBusy]     = useState(false);
  const uploadInputId = "wrapchat-upload-input";
  const showAdminEntry = Boolean(onAdmin) && canAdmin;
  const displayUploadErr = uploadLocalErr || uploadError;
  const isPaymentsMode = !hideCredits && accessMode === "payments";
  const hasUnlockedReads = Object.values(unlockedPackIds || {}).some(Boolean);
  const isTrialPending = isPaymentsMode && (quickReadAvailable || firstRunQuickRead);
  const displayInfo    = uploadInfo
    || (!hideCredits && !isPaymentsMode && credits === 0 && !hasUnlockedReads ? OUT_OF_CREDITS_MESSAGE : "");
  const showCreditPill = !hideCredits && !firstRunQuickRead && !isOpenMode(accessMode) && !isTrialPending && Number.isInteger(credits);
  const showOpenPill   = isOpenMode(accessMode) && !hideCredits;

  const handleUpload = async fileList => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    onClearError?.();
    setUploadBusy(true); setUploadLocalErr("");
    try {
      const file = files[0];
      const result = await processImportedChatFile(file);
      onParsed({
        platform: result.platform,
        sourceFormat: result.sourceFormat,
        parserId: result.parserId,
        payload: result.payload,
        summary: result.summary,
        fileName: file.name || null,
      });
    } catch (error) {
      setUploadLocalErr(String(error?.message || "Couldn't open this file. Please export the chat again and retry."));
      setUploadBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.25)",
    border: `1.5px solid ${isLight ? "rgba(31,24,78,0.12)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: 14,
    padding: "13px 16px",
    fontSize: 15,
    color: da.text,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} forceWaves={phase === "upload"}>
      {/* ── Upload-only absolute overlays ── */}
      {phase === "upload" && onHistory && (
        <div style={{ position:"absolute", top:SCREEN_HEADER_CONTROL_TOP, left:16, zIndex:5, animation:"wcAuthFadeIn 220ms 90ms ease-out both" }}>
          <button type="button" onClick={onHistory} className="wc-btn" aria-label="My Results"
            style={{ width:40, height:40, borderRadius:"50%", background: isLight ? "none" : "rgba(var(--wc-p),0.20)", border: isLight ? "none" : "1px solid rgba(var(--wc-p),0.38)", color: isLight ? "#7A90FF" : "rgba(220,200,255,0.85)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0, flexShrink:0 }}>
            <svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="1" y1="1.5" x2="15" y2="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="1" y1="12.5" x2="15" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
      {phase === "upload" && showCreditPill && (
        <div style={{ position:"absolute", top:SCREEN_HEADER_CONTROL_TOP, right:20, minHeight:40, zIndex:5, display:"flex", alignItems:"center", animation:"wcAuthFadeIn 220ms 90ms ease-out both" }}>
          <AnalysisDotsCounter credits={credits} activePackIds={unlockedPackIds} onAdd={onUpgrade || onPayment} hide={hideCredits} />
        </div>
      )}

      {/* ── Version label ── */}
      <div style={{ position:"absolute", left:20, right:20, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", fontSize:11, color:da.faint, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", pointerEvents:"none", zIndex:1 }}>
        {HOMEPAGE_VERSION_LABEL}
      </div>

      {/* ── Single flex column: logo is static, content animates below it ── */}
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", paddingTop:"calc(33% - 28px)", paddingLeft:24, paddingRight:24, boxSizing:"border-box", zIndex:1, overflow:"hidden" }}>
        {/* Logo section — identical in both phases, never inside FadeScale */}
        <div style={{ width:"100%", display:"flex", flexDirection:"column", alignItems:"center", paddingTop:130 }}>
          <BrandLockup
            logoSrc={wrapchatLogoTransparent}
            logoSize={72}
            subtitle={t("Your chats, unwrapped.")}
            subtitleMarginBottom={8}
          />
        </div>

        {/* Content section — auth form fades out while upload controls fade in. */}
        <div style={{ width:"100%", marginTop:14 }}>
          <AuthPhaseFade phase={phase}>
            <div style={{ width:"100%", display:"flex", flexDirection:"column", gap: phase === "auth" ? 10 : 12 }}>
              {phase === "auth" ? (
                <>
                  {/* Tab toggle */}
                  <SlidingSegmentedTabs
                    items={[{ id:"login", label:"Log in" }, { id:"signup", label:"Sign up" }]}
                    value={authTab}
                    onChange={switchAuthTab}
                    ariaLabel="Authentication tabs"
                  />
                  {/* Inputs */}
                  <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
                    <input
                      type="email" placeholder="Email" value={authEmail}
                      id="wrapchat-email"
                      name="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      onChange={e => setAuthEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && authSubmit()}
                      style={inputStyle}
                    />
                    <input
                      type="password" placeholder="Password" value={authPassword}
                      id="wrapchat-password"
                      name="password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete={authTab === "login" ? "current-password" : "new-password"}
                      onChange={e => setAuthPassword(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && authSubmit()}
                      style={inputStyle}
                    />
                  </div>
                  {authTab === "login" && (
                    <label style={{ display:"flex", alignItems:"center", gap:9, color:da.muted, fontSize:12, fontWeight:700, lineHeight:1.4 }}>
                      <input
                        type="checkbox"
                        checked={staySignedIn}
                        onChange={event => setStaySignedIn(event.target.checked)}
                        style={{ width:16, height:16, accentColor:PAL.upload.accent }}
                      />
                      Stay signed in on this device
                    </label>
                  )}
                  {authErr  && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{authErr}</div>}
                  {authInfo && <div style={{ fontSize:13, color:"#B0F4C8", background:"rgba(20,160,80,0.15)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{authInfo}</div>}
                  <PrimaryButton onClick={authSubmit} disabled={authBusy} color={PAL.upload.accent} textColor={PAL.upload.bg}>
                    {authBusy ? "…" : authTab === "login" ? "Log in" : "Create account"}
                  </PrimaryButton>
                  <div style={{ fontSize:11, color:da.faint, textAlign:"center" }}>Your chat is analysed by AI and never stored. Only results are saved.</div>
                </>
              ) : (
                <>
                  {showOpenPill && (
                    <div style={{ fontSize:12, fontWeight:700, color:"rgba(176,244,200,0.9)", background:"rgba(20,160,80,0.12)", border:"1px solid rgba(20,160,80,0.28)", borderRadius:999, padding:"7px 18px", textAlign:"center" }}>
                      Open testing · free reports
                    </div>
                  )}
                  {/* Upload drop zone */}
                  <label
                    htmlFor={uploadInputId}
                    onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
                    onDragOver={e => e.preventDefault()}
                    style={{ background: isLight ? "rgba(31,24,78,0.08)" : "rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", cursor:"pointer", width:"100%", transition:"background 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.background = isLight ? "rgba(31,24,78,0.14)" : "rgba(0,0,0,0.35)"}
                    onMouseLeave={e => e.currentTarget.style.background = isLight ? "rgba(31,24,78,0.08)" : "rgba(0,0,0,0.25)"}
                  >
                    <div style={{ fontSize:17, fontWeight:800, color:da.text, letterSpacing:-0.3 }}>{uploadBusy ? t("Reading your chat…") : t("Upload your chat")}</div>
                  </label>
                  <input id={uploadInputId} type="file" accept={IMPORT_ACCEPT_TYPES} style={{ display:"none" }} onChange={e => handleUpload(e.target.files)} />
                  {isTrialPending && (
                    <div style={{ fontSize:13, fontWeight:700, color:"rgba(232,236,255,0.95)", background:"rgba(122,144,255,0.14)", border:"1px solid rgba(122,144,255,0.34)", borderRadius:14, padding:"11px 16px", width:"100%", textAlign:"center", lineHeight:1.6 }}>
                      {t("You have 1 Quick Read available.")}
                    </div>
                  )}
                  {displayUploadErr && <div style={{ fontSize:13, color:"#FFB090", textAlign:"center", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%" }}>{displayUploadErr}</div>}
                  {displayInfo && (
                    <div style={{ fontSize:13, color: isLight ? "rgba(31,24,78,0.82)" : "rgba(255,255,255,0.82)", textAlign:"center", background:"rgba(var(--wc-p),0.22)", border:"1px solid rgba(var(--wc-p),0.38)", padding:"11px 16px", borderRadius:16, width:"100%", lineHeight:1.6 }}>
                      {displayInfo}
                    </div>
                  )}
                  <div style={{ fontSize:11, color:da.faint, textAlign:"center" }}>{t("Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.")}</div>
                  {showAdminEntry && (
                    <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", flexWrap:"wrap", width:"100%" }}>
                      <button onClick={onAdmin} className="wc-btn" style={{ background:"rgba(var(--wc-p),0.16)", border:"1px solid rgba(var(--wc-p),0.30)", borderRadius:999, color:"rgba(200,170,240,0.90)", fontSize:12, padding:"8px 14px", fontWeight:700, letterSpacing:0.1 }}>
                        Admin
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </AuthPhaseFade>
        </div>
      </div>
    </Shell>
  );
}

export function parseCreditBalance(value) {
  const candidate = (
    value && typeof value === "object" && !Array.isArray(value)
      ? (value.balance ?? value.new_balance ?? value.credit_balance ?? value.credits ?? null)
      : value
  );

  if (candidate == null) return null;

  const parsed = Number.parseInt(String(candidate), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function getUserCredits() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return null;

  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return parseCreditBalance(data);
}

export async function getUserProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return { balance: null, role: "user", quickReadAvailable: false, quickReadExpiresAt: null };

  const { data, error } = await supabase
    .from("credits")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  const balance = parseCreditBalance(data);
  const role = String(data?.role || "user").trim().toLowerCase();
  const quickReadExpiresAt = data?.quick_read_expires_at || null;
  const expiresAtMs = quickReadExpiresAt ? new Date(quickReadExpiresAt).getTime() : null;
  const quickReadExpired = Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
  const quickReadAvailable = data?.quick_read_available !== false && !data?.quick_read_used_at && !quickReadExpired;
  return { balance, role, quickReadAvailable, quickReadExpiresAt };
}

export async function initialiseUserCredits(userEmail = null) {
  const existingBalance = await getUserCredits();
  if (existingBalance !== null) return existingBalance;

  const { error } = await supabase.functions.invoke("initialise-credits", {
    body: { email: userEmail ?? null },
  });
  if (error) throw error;

  return await getUserCredits();
}

export async function consumeQuickReadTrial(userId) {
  if (!userId) return false;
  const { data, error } = await supabase.rpc("consume_quick_read_trial", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data === true;
}

export async function deleteCurrentAccount() {
  const { error } = await supabase.functions.invoke("delete-account");
  if (error) throw error;
  try {
    await supabase.auth.signOut();
  } catch {
    // The Edge Function already deleted the auth user; local cleanup continues below.
  }
}

// ─────────────────────────────────────────────────────────────────
// SAVE RESULT
// ─────────────────────────────────────────────────────────────────
export async function saveResult(type, result, mathData, bundleId = null, creditMeta = null) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const generatedAt = new Date().toISOString();
    const visibleNames = namesWithoutCurrentUser(mathData.names, user);
    const displayTitle = compactNamesLabel(visibleNames) || mathData.displayTitle || "WrapChat result";
    const datasetKind = mathData.datasetKind || "single";
    const sourceChatCount = mathData.sourceChatCount || 1;
    const registeredName = normalizeDisplayName(userProvidedDisplayName(user));
    const savedNames = !mathData.isGroup && Array.isArray(mathData.names) && mathData.names.length === 2 && registeredName
      ? (mathData.names.filter(name => normalizeDisplayName(name) !== registeredName).length
          ? mathData.names.filter(name => normalizeDisplayName(name) !== registeredName)
          : mathData.names)
      : (visibleNames.length ? visibleNames : mathData.names);
    const safeMathData = {
      ...mathData,
      ...(bundleId ? { bundle_id: bundleId } : {}),
      display_title: displayTitle,
      dataset_kind: datasetKind,
      source_chat_count: sourceChatCount,
      ...(creditMeta ? {
        credit_cost: creditMeta.creditCost,
        report_types: creditMeta.reportTypes,
        generated_at: generatedAt,
        ...(creditMeta.bundleName ? { bundle_name: creditMeta.bundleName } : {}),
      } : {}),
      evidenceTimeline: mathData.evidenceTimeline?.map(({ date, title }) => ({ date, title })) ?? [],
      redFlags: mathData.redFlags?.map(({ title }) => ({ title })) ?? [],
    };
    const { data, error } = await supabase.from("results").insert({
      user_id:     user.id,
      report_type: type,
      chat_type:   mathData.isGroup ? "group" : "duo",
      names:       savedNames,
      result_data: {
        ...result,
        runMetadata: {
          reportType: type,
          reportTypes: creditMeta?.reportTypes || [type],
          creditCost: creditMeta?.creditCost ?? getReportCreditCost(type),
          totalRunCreditCost: creditMeta?.totalRunCreditCost ?? (creditMeta?.creditCost ?? getReportCreditCost(type)),
          generatedAt,
          displayTitle,
          datasetKind,
          sourceChatCount,
          approvedMerges: mathData.combinedMeta?.approvedMerges || 0,
          participantAliases: mathData.participantAliases || {},
          ...(creditMeta?.bundleName ? { bundleName: creditMeta.bundleName } : {}),
        },
      },
      math_data:   safeMathData,
    }).select("*").single();
    if (error) return null;
    upsertCachedResult(user.id, data);
    return data;
  } catch { return null; /* silent — never interrupt the user flow */ }
}

export async function submitFeedback({ resultId, reportType, cardIndex, cardTitle, errorType, errorNote }) {
  try {
    if (!resultId || !reportType || !cardTitle || !errorType) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const sentiment = getFeedbackSentiment(errorType);
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      result_id: resultId,
      report_type: reportType,
      card_index: cardIndex,
      card_title: cardTitle,
      sentiment,
      error_type: errorType,
      error_note: String(errorNote || "").trim() || null,
    });
    return !error;
  } catch { /* silent — never interrupt the user flow */ }
  return false;
}

function pushSummaryRow(rows, label, value, max = null) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === "—" || text === "..." || text === "…") return;
  rows.push({ label, value: Number.isFinite(max) ? cleanQuote(text, max) : text });
}

function buildFeedbackSummary(feedbackRow, resultRow, viewLang = "en") {
  if (!feedbackRow || !resultRow) return [];
  const math = resultRow.math_data || {};
  const ai = resultRow.result_data || {};
  const rows = [];
  const card = Number(feedbackRow.card_index || 0);
  const isGroup = !!math.isGroup;
  const control = (value) => translateControlValue(viewLang, value);

  if (feedbackRow.report_type === "general") {
    if (!isGroup) {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghostName);
        pushSummaryRow(rows, "Reply times", `${math.names?.[0] || "A"} ${math.ghostAvg?.[0] || "—"} • ${math.names?.[1] || "B"} ${math.ghostAvg?.[1] || "—"}`, 90);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 5) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson || math.names?.[0]);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 14) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 15) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 16) {
        pushSummaryRow(rows, relReadTitle(ai.relationshipType, ai.relationshipSpecific), ai.relationshipSummary);
        pushSummaryRow(rows, "Detected relationship", ai.relationshipSpecific ? `${ai.relationshipSpecific}${ai.relationshipConfidence ? ` (${ai.relationshipConfidence} confidence)` : ""}` : "");
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= DUO_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    } else {
      if (card === 2) {
        pushSummaryRow(rows, "Ghost", math.ghost);
        pushSummaryRow(rows, "AI read", ai.ghostContext);
      } else if (card === 6) {
        pushSummaryRow(rows, "Hype person", math.hype);
        pushSummaryRow(rows, "Reason", ai.hypePersonReason);
      } else if (card === 7) {
        pushSummaryRow(rows, "Kindest", ai.kindestPerson);
        pushSummaryRow(rows, "Sweetest moment", ai.sweetMoment);
      } else if (card === 8) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Reason", ai.funniestReason);
      } else if (card === 13) {
        pushSummaryRow(rows, "Biggest topic", ai.biggestTopic);
        pushSummaryRow(rows, "Inside joke", ai.insideJoke);
      } else if (card === 14) {
        pushSummaryRow(rows, "Drama starter", ai.dramaStarter);
        pushSummaryRow(rows, "How", ai.dramaContext);
      } else if (card === 15) {
        pushSummaryRow(rows, "Most missed", ai.mostMissed);
      } else if (card === 16) {
        pushSummaryRow(rows, "Group dynamic", ai.groupDynamic);
        pushSummaryRow(rows, "Tense moment", ai.tensionMoment);
      } else if (card === 17) {
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      } else if (card >= GROUP_CASUAL_SCREENS + 1) {
        pushSummaryRow(rows, "Funniest", ai.funniestPerson);
        pushSummaryRow(rows, "Drama", ai.dramaStarter);
        pushSummaryRow(rows, "Vibe", ai.vibeOneLiner);
      }
    }
  } else if (feedbackRow.report_type === "toxicity") {
    if (card === 1 || card === 7) {
      pushSummaryRow(rows, "Health score", ai.chatHealthScore != null ? `${ai.chatHealthScore}/10` : "");
      pushSummaryRow(rows, "Verdict", ai.verdict);
    } else if (card === 2) {
      (ai.healthScores || []).slice(0, 3).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Scores" : " ", `${item.name}: ${item.score}/10 — ${item.detail}`, 120);
      });
    } else if (card === 3) {
      pushSummaryRow(rows, "Apologises more", ai.apologiesLeader?.name);
      pushSummaryRow(rows, "Their context", ai.apologiesLeader?.context);
      pushSummaryRow(rows, "Other context", ai.apologiesOther?.context);
    } else if (card === 4) {
      (ai.redFlagMoments || []).slice(0, 2).forEach((item, index) => {
        pushSummaryRow(rows, index === 0 ? "Flagged moment" : "Another", `${item.person || ""} ${item.date ? `• ${item.date}` : ""} ${item.description || ""} ${item.quote ? `— "${item.quote}"` : ""}`, 130);
      });
    } else if (card === 5) {
      pushSummaryRow(rows, "Conflict pattern", ai.conflictPattern);
    } else if (card === 6) {
      pushSummaryRow(rows, "Power holder", control(ai.powerHolder));
      pushSummaryRow(rows, "Dynamic", ai.powerBalance);
    }
  } else if (feedbackRow.report_type === "lovelang") {
    if (card === 1) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Language", control(ai.personA?.language));
      pushSummaryRow(rows, "Examples", ai.personA?.examples);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Language", control(ai.personB?.language));
      pushSummaryRow(rows, "Examples", ai.personB?.examples);
    } else if (card === 3) {
      pushSummaryRow(rows, "Mismatch", ai.mismatch);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most loving moment", ai.mostLovingMoment);
    } else if (card === 5) {
      pushSummaryRow(rows, "Compatibility", ai.compatibilityScore != null ? `${ai.compatibilityScore}/10` : "");
      pushSummaryRow(rows, "Read", ai.compatibilityRead);
    }
  } else if (feedbackRow.report_type === "growth") {
    if (card === 1) {
      pushSummaryRow(rows, "Early", ai.thenDepth);
      pushSummaryRow(rows, "Recent", ai.nowDepth);
      pushSummaryRow(rows, "Change", control(ai.depthChange));
    } else if (card === 2) {
      pushSummaryRow(rows, "Changed more", ai.whoChangedMore);
      pushSummaryRow(rows, "How", ai.whoChangedHow);
    } else if (card === 3) {
      pushSummaryRow(rows, "Appeared", ai.topicsAppeared);
      pushSummaryRow(rows, "Faded", ai.topicsDisappeared);
    } else if (card === 4) {
      pushSummaryRow(rows, "Trajectory", control(ai.trajectory));
      pushSummaryRow(rows, "Detail", ai.trajectoryDetail);
    } else if (card === 5) {
      pushSummaryRow(rows, "Arc", ai.arcSummary);
    }
  } else if (feedbackRow.report_type === "accounta") {
    if (card === 1) {
      pushSummaryRow(rows, "Promises", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.total || 0} • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.total || 0}`, 100);
      pushSummaryRow(rows, "Verdict", ai.overallVerdict);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Score", ai.personA?.score != null ? `${ai.personA.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personA?.detail);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Score", ai.personB?.score != null ? `${ai.personB.score}/10` : "");
      pushSummaryRow(rows, "Pattern", ai.personB?.detail);
    } else if (card === 4) {
      pushSummaryRow(rows, "Comparison", ai.comparison);
    } else if (card === 5) {
      pushSummaryRow(rows, "Pattern", ai.followThroughPattern);
      pushSummaryRow(rows, "Evidence", ai.evidenceQuality);
    } else if (card === 6) {
      pushSummaryRow(rows, "Broken promise", ai.notableBroken?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableBroken?.outcome);
    } else if (card === 7) {
      pushSummaryRow(rows, "Kept promise", ai.notableKept?.promise);
      pushSummaryRow(rows, "Outcome", ai.notableKept?.outcome);
    }
  } else if (feedbackRow.report_type === "energy") {
    if (card === 1 || card === 6) {
      pushSummaryRow(rows, "Scores", `${ai.personA?.name || math.names?.[0] || "A"} ${ai.personA?.netScore ?? "—"}/10 • ${ai.personB?.name || math.names?.[1] || "B"} ${ai.personB?.netScore ?? "—"}/10`, 100);
      pushSummaryRow(rows, "Compatibility", ai.compatibility);
    } else if (card === 2) {
      pushSummaryRow(rows, "Person", ai.personA?.name);
      pushSummaryRow(rows, "Positive", ai.personA?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personA?.venting);
    } else if (card === 3) {
      pushSummaryRow(rows, "Person", ai.personB?.name);
      pushSummaryRow(rows, "Positive", ai.personB?.goodNews);
      pushSummaryRow(rows, "Draining", ai.personB?.venting);
    } else if (card === 4) {
      pushSummaryRow(rows, "Most energising", ai.mostEnergising);
    } else if (card === 5) {
      pushSummaryRow(rows, "Most draining", ai.mostDraining);
    }
  }

  if (!rows.length) {
    pushSummaryRow(rows, "Reported card", feedbackRow.card_title);
    pushSummaryRow(rows, "Report type", feedbackRow.report_type);
  }

  return rows;
}

function adminControlPillStyle() {
  return {
    background:"rgba(255,255,255,0.08)",
    border:"1px solid rgba(255,255,255,0.18)",
    borderRadius:999,
    padding:"7px 16px",
    fontSize:13,
    fontWeight:700,
    color:"#fff",
    letterSpacing:0.1,
    whiteSpace:"nowrap",
  };
}

export function AdminFeedbackTab() {
  const [rows, setRows] = useState(null);
  const [resultsById, setResultsById] = useState({});
  const [err, setErr] = useState("");
  const [viewLangById, setViewLangById] = useState({});
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setErr("");
      const { data: feedbackRows, error: feedbackError } = await supabase
        .rpc("admin_list_feedback", { p_limit: 100 });

      if (!alive) return;
      if (feedbackError) {
        setErr("Couldn't load feedback right now.");
        setRows([]);
        return;
      }

      const list = feedbackRows || [];
      setRows(list);
      const resultIds = Array.from(new Set(list.map(item => item.result_id).filter(Boolean)));
      if (!resultIds.length) {
        setResultsById({});
        setViewLangById({});
        return;
      }

      const { data: results, error: resultsError } = await supabase
        .from("results")
        .select("*")
        .in("id", resultIds);

      if (!alive) return;
      if (resultsError) {
        setErr("Couldn't load the related result cards.");
        setResultsById({});
        return;
      }
      setResultsById(Object.fromEntries((results || []).map(row => [row.id, row])));
    };

    load();
    return () => { alive = false; };
  }, []);

  const exitEditing = () => {
    setEditing(false);
    setConfirmId(null);
  };

  const deleteFeedbackRow = async (id) => {
    if (!id) return;
    setDeletingId(id);
    setConfirmId(null);
    try {
      const { data, error } = await supabase.rpc("admin_delete_feedback", {
        p_feedback_id: String(id),
      });
      if (error || data !== true) {
        console.error("Admin feedback delete failed", error || data);
        setErr("Couldn't delete feedback right now.");
        setDeletingId(null);
        return;
      }
      setRows(prev => (prev || []).filter(row => row.id !== id));
      setViewLangById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error("Admin feedback delete threw", error);
      setErr("Couldn't delete feedback right now.");
    }
    setDeletingId(null);
  };

  const errorTypeColor = (type) => {
    switch (type) {
      case POSITIVE_FEEDBACK_OPTION:
        return { bg:"rgba(80,190,120,0.16)",  border:"rgba(80,190,120,0.32)",  text:"#7BE39A" };
      case "Events are mixing":  return { bg:"rgba(240,160,40,0.15)",  border:"rgba(240,160,40,0.3)",  text:"#F0A040" };
      case "Wrong person":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Didn't happen":      return { bg:"rgba(180,60,200,0.15)",  border:"rgba(180,60,200,0.3)",  text:"#C070E0" };
      case "Tone misread":       return { bg:"rgba(60,140,240,0.15)",  border:"rgba(60,140,240,0.3)",  text:"#60A0F0" };
      case "Overclaiming":       return { bg:"rgba(220,80,60,0.15)",   border:"rgba(220,80,60,0.3)",   text:"#E06060" };
      case "Missing context":    return { bg:"rgba(80,160,100,0.15)",  border:"rgba(80,160,100,0.3)",  text:"#60C080" };
      default:                   return { bg:"rgba(255,255,255,0.07)", border:"rgba(255,255,255,0.14)",text:"rgba(255,255,255,0.7)" };
    }
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Feedback
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <div
            style={adminControlPillStyle()}
          >
            {rows === null ? "Loading…" : `${rows.length} report${rows.length !== 1 ? "s" : ""}`}
          </div>
          {!!rows?.length && (
            <button
              type="button"
              onClick={() => editing ? exitEditing() : setEditing(true)}
              className="wc-btn"
              style={{
                background: editing ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 999,
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
                transition: "all 0.15s",
                letterSpacing: 0.1,
              }}
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {rows?.length > 0 && (
        !editing
          ? <div style={{ fontSize:12, color:"rgba(255,255,255,0.42)", lineHeight:1.6 }}>Latest feedback reports and the exact card content they referred to.</div>
          : <div style={{ fontSize:12, color:"rgba(255,255,255,0.42)", lineHeight:1.6 }}>Tap the × to delete a feedback report.</div>
      )}

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"32px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {rows?.length === 0 && !err && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"32px 20px", textAlign:"center" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>No feedback yet.</div>
        </div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, paddingRight:2, paddingBottom:4, alignSelf:"stretch" }}>
        {rows?.map(row => {
          const baseResultRow = resultsById[row.result_id];
          const resultData = baseResultRow?.result_data;
          const translatedLang = getStoredResultDisplayLanguage(resultData);
          const hasTranslation = translatedLang !== "en" && !!getStoredResultTranslations(resultData)?.[translatedLang];
          const selectedLang = hasTranslation ? (viewLangById[row.id] || translatedLang) : "en";
          const englishResultRow = baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, "en") }
            : baseResultRow;
          const translatedResultRow = hasTranslation && baseResultRow
            ? { ...baseResultRow, result_data: getDisplayResultData(baseResultRow.result_data, translatedLang) }
            : null;
          const englishSummaryRows = buildFeedbackSummary(row, englishResultRow, "en");
          const translatedSummaryRows = translatedResultRow ? buildFeedbackSummary(row, translatedResultRow, translatedLang) : [];
          const summaryRows = selectedLang === "en" || !translatedResultRow ? englishSummaryRows : translatedSummaryRows;
          const namesLabel = Array.isArray(baseResultRow?.names) && baseResultRow.names.length
            ? `${baseResultRow.names.slice(0, 3).join(", ")}${baseResultRow.names.length > 3 ? ` +${baseResultRow.names.length - 3}` : ""}`
            : "";
          const messageLabel = baseResultRow?.math_data?.totalMessages != null
            ? `${baseResultRow.math_data.totalMessages.toLocaleString()} msgs`
            : "";
          const submittedAt = row.created_at
            ? new Date(row.created_at).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" })
            : "Unknown";
          const tagStyle = errorTypeColor(row.error_type);
          const sentiment = row.sentiment === "positive" || row.error_type === POSITIVE_FEEDBACK_OPTION ? "positive" : "negative";
          const sentimentStyle = sentiment === "positive"
            ? { bg:"rgba(80,190,120,0.14)", border:"rgba(80,190,120,0.30)", text:"#7BE39A", label:"Positive" }
            : { bg:"rgba(224,90,80,0.13)", border:"rgba(224,90,80,0.28)", text:"#FF9A8F", label:"Negative" };
          const isDeleting = deletingId === row.id;
          const isConfirming = confirmId === row.id;

          return (
            <div
              key={row.id}
              style={{
                background:"rgba(255,255,255,0.04)",
                border:`1px solid ${isConfirming ? "rgba(220,50,50,0.42)" : "rgba(255,255,255,0.08)"}`,
                borderRadius:22,
                overflow:"hidden",
                flexShrink:0,
                position:"relative",
                transition:"border-color 0.15s",
              }}
            >
              {editing && !isConfirming && !isDeleting && (
                <button
                  type="button"
                  onClick={() => setConfirmId(row.id)}
                  className="wc-btn"
                  style={{
                    position:"absolute",
                    top:10,
                    right:10,
                    width:28,
                    height:28,
                    borderRadius:"50%",
                    background:"rgba(200,40,40,0.85)",
                    border:"1.5px solid rgba(255,100,100,0.5)",
                    color:"#fff",
                    fontSize:14,
                    fontWeight:800,
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    cursor:"pointer",
                    lineHeight:1,
                    padding:0,
                    transition:"all 0.15s",
                    zIndex:2,
                  }}
                  aria-label="Delete feedback"
                >
                  ×
                </button>
              )}

              {isDeleting && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(12,12,18,0.42)", zIndex:3 }}>
                  <Dots />
                </div>
              )}

              {isConfirming && !isDeleting && (
                <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, padding:"18px 20px", background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", zIndex:3, borderRadius:22 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center", lineHeight:1.45 }}>Delete this feedback report?</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
                    <button
                      type="button"
                      onClick={() => deleteFeedbackRow(row.id)}
                      className="wc-btn"
                      style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="wc-btn"
                      style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", transition:"all 0.15s" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* top strip */}
              <div style={{ padding:"14px 16px 12px", borderBottom:"1px solid rgba(255,255,255,0.06)", opacity: editing ? 0.68 : 1, transition:"opacity 0.15s" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>
                      {row.report_type} · card {row.card_index} · {submittedAt}
                    </div>
                    <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, lineHeight:1.2, marginBottom: namesLabel || messageLabel ? 5 : 0 }}>
                      {row.card_title || "Untitled card"}
                    </div>
                    {(namesLabel || messageLabel) && (
                      <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>
                        {[namesLabel, messageLabel].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, flexShrink:0 }}>
                    {hasTranslation && (
                      <div style={{ position:"relative", display:"inline-flex", alignItems:"center", padding:3, borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.05)" }}>
                        <div
                          style={{
                            position:"absolute",
                            top:3,
                            bottom:3,
                            left: selectedLang === "en" ? 3 : "calc(50% + 1.5px)",
                            width:"calc(50% - 3px)",
                            borderRadius:999,
                            background:"rgba(255,255,255,0.14)",
                            transition:"left 0.18s ease",
                          }}
                        />
                        {[
                          { code: "en", label: "English" },
                          { code: translatedLang, label: LANG_META[translatedLang] || translatedLang.toUpperCase() },
                        ].map(opt => (
                          <button
                            key={`${row.id}-${opt.code}`}
                            type="button"
                            onClick={() => setViewLangById(prev => ({ ...prev, [row.id]: opt.code }))}
                            className="wc-btn"
                            style={{
                              position:"relative",
                              zIndex:1,
                              minWidth:74,
                              border:"none",
                              background:"transparent",
                              color: selectedLang === opt.code ? "#fff" : "rgba(255,255,255,0.52)",
                              fontSize:11,
                              fontWeight:800,
                              letterSpacing:"0.04em",
                              padding:"7px 12px",
                              cursor:"pointer",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
                      <div style={{ background:sentimentStyle.bg, border:`1px solid ${sentimentStyle.border}`, borderRadius:999, padding:"4px 10px", fontSize:11, fontWeight:800, color:sentimentStyle.text, whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                        {sentimentStyle.label}
                      </div>
                      <div style={{ background:tagStyle.bg, border:`1px solid ${tagStyle.border}`, borderRadius:999, padding:"5px 11px", fontSize:12, fontWeight:700, color:tagStyle.text, whiteSpace:"nowrap" }}>
                        {row.error_type || "Other"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* body */}
              <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:10, opacity: editing ? 0.68 : 1, transition:"opacity 0.15s" }}>
                {/* user's note */}
                {row.error_note && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:5 }}>Note</div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.82)", lineHeight:1.6 }}>{row.error_note}</div>
                  </div>
                )}

                {/* model output */}
                {summaryRows.length > 0 && (
                  <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px 14px" }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.09em", textTransform:"uppercase", color:"rgba(255,255,255,0.35)", marginBottom:8 }}>What was shown</div>
                    {translatedResultRow ? (
                      <div style={{ display:"grid" }}>
                        {[
                          { code: "en", rows: englishSummaryRows },
                          { code: translatedLang, rows: translatedSummaryRows },
                        ].map(group => (
                          <div
                            key={`${row.id}-${group.code}`}
                            style={{
                              gridArea:"1 / 1",
                              display:"flex",
                              flexDirection:"column",
                              gap:7,
                              opacity: selectedLang === group.code ? 1 : 0,
                              visibility: selectedLang === group.code ? "visible" : "hidden",
                              pointerEvents: selectedLang === group.code ? "auto" : "none",
                            }}
                          >
                            {group.rows.map((item, index) => (
                              <div key={`${group.code}-${item.label}-${index}`}>
                                <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                                <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                        {summaryRows.map((item, index) => (
                          <div key={`${item.label}-${index}`}>
                            <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:2 }}>{item.label}</div>
                            <div style={{ fontSize:13, color:"#fff", lineHeight:1.55, fontWeight:500 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!row.error_note && !summaryRows.length && (
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", fontStyle:"italic" }}>No note or saved output for this card.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function AdminUsersTab({ accessMode = DEFAULT_ACCESS_MODE }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busyById, setBusyById] = useState({});
  const [amountById, setAmountById] = useState({});
  const [noticeById, setNoticeById] = useState({});
  const canAdjustCredits = accessMode === ACCESS_MODES.CREDITS;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setErr("");
      const { data, error } = await supabase.rpc("admin_list_user_credits");
      if (!alive) return;
      if (error) {
        console.error("Admin users load failed", error);
        setErr(error.message || "Couldn't load users right now.");
        setRows([]);
        return;
      }
      setRows((data || []).map(row => ({
        user_id: row.user_id,
        email: row.email || "No email",
        balance: Number.parseInt(String(row.balance ?? 0), 10) || 0,
        hasConfirmationStatus: Object.prototype.hasOwnProperty.call(row, "email_confirmed_at"),
        emailConfirmedAt: row.email_confirmed_at || null,
      })));
    };

    load();
    return () => { alive = false; };
  }, []);

  const setAmount = (userId, value) => {
    setAmountById(prev => ({ ...prev, [userId]: value }));
  };

  const adjustCredits = async (userId, delta) => {
    if (!canAdjustCredits) {
      setNoticeById(prev => ({ ...prev, [userId]: "Switch to Credit Beta to adjust user credits." }));
      return;
    }

    const rawValue = amountById[userId] ?? "1";
    const amount = Number.parseInt(String(rawValue), 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      setNoticeById(prev => ({ ...prev, [userId]: "Enter a positive amount." }));
      return;
    }

    setBusyById(prev => ({ ...prev, [userId]: delta < 0 ? "remove" : "add" }));
    setNoticeById(prev => ({ ...prev, [userId]: "" }));

    const { data, error } = await supabase.rpc("admin_add_credits", {
      p_user_id: userId,
      p_amount: delta < 0 ? -amount : amount,
    });

    if (error) {
      console.error("Admin credit update failed", error);
      setNoticeById(prev => ({ ...prev, [userId]: error.message || "Couldn't update credits right now." }));
      setBusyById(prev => ({ ...prev, [userId]: "" }));
      return;
    }

    const updatedBalance = Number.parseInt(String(data ?? 0), 10) || 0;
    setRows(prev => (prev || []).map(row => (
      row.user_id === userId
        ? { ...row, balance: updatedBalance }
        : row
    )));
    setAmountById(prev => ({ ...prev, [userId]: "1" }));
    setNoticeById(prev => ({ ...prev, [userId]: delta < 0 ? "Removed." : "Added." }));
    setBusyById(prev => ({ ...prev, [userId]: "" }));
  };

  const resendActivationEmail = async (userId, email) => {
    if (!email || email === "No email") {
      setNoticeById(prev => ({ ...prev, [userId]: "This user has no email address." }));
      return;
    }

    setBusyById(prev => ({ ...prev, [userId]: "resend" }));
    setNoticeById(prev => ({ ...prev, [userId]: "" }));

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: getAuthConfirmationRedirectUrl(),
      },
    });

    if (error) {
      console.error("Activation email resend failed", error);
      setNoticeById(prev => ({ ...prev, [userId]: error.message || "Couldn't resend activation email right now." }));
      setBusyById(prev => ({ ...prev, [userId]: "" }));
      return;
    }

    setNoticeById(prev => ({ ...prev, [userId]: "Activation email sent." }));
    setBusyById(prev => ({ ...prev, [userId]: "" }));
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Users
        </div>
        <div style={adminControlPillStyle()}>
          {rows === null ? "Loading…" : `${rows.length} user${rows.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"32px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {!canAdjustCredits && (
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.72)", background:"rgba(160,138,240,0.12)", border:"1px solid rgba(160,138,240,0.24)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>
          Switch to Credit Beta to adjust user credits.
        </div>
      )}
      {rows?.length === 0 && !err && (
        <div style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"32px 20px", textAlign:"center" }}>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.6 }}>No users yet.</div>
        </div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, paddingRight:2, paddingBottom:4, alignSelf:"stretch" }}>
        {rows?.map(row => {
          const inputValue = amountById[row.user_id] ?? "1";
          const notice = noticeById[row.user_id] || "";
          const busyAction = busyById[row.user_id] || "";
          const busy = !!busyAction;
          const isEmailConfirmed = !!row.emailConfirmedAt;
          const canResendActivation = row.hasConfirmationStatus && row.email !== "No email" && !isEmailConfirmed;

          return (
            <div key={row.user_id} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.2, lineHeight:1.35, wordBreak:"break-word" }}>{row.email}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginTop:5 }}>
                    Current credits: {row.balance}{row.hasConfirmationStatus ? ` · ${isEmailConfirmed ? "Email confirmed" : "Email not confirmed"}` : ""}
                  </div>
                </div>
                <div style={adminControlPillStyle()}>
                  {row.balance} credit{row.balance === 1 ? "" : "s"}
                </div>
              </div>

              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={inputValue}
                  disabled={!canAdjustCredits || busy}
                  onChange={e => setAmount(row.user_id, e.target.value)}
                  style={{
                    width:88,
                    background: isLight ? "rgba(31,24,78,0.06)" : "rgba(0,0,0,0.22)",
                    border: isLight ? "1px solid rgba(31,24,78,0.14)" : "1px solid rgba(255,255,255,0.12)",
                    borderRadius:12,
                    padding:"10px 12px",
                    fontSize:14,
                    color:da.text,
                    outline:"none",
                    fontFamily:"inherit",
                    opacity:!canAdjustCredits ? 0.45 : 1,
                  }}
                />
                <button
                  type="button"
                  onClick={() => adjustCredits(row.user_id, 1)}
                  disabled={busy || !canAdjustCredits}
                  className="wc-btn"
                  style={{
                    background:"rgba(255,255,255,0.10)",
                    border:"1px solid rgba(255,255,255,0.16)",
                    borderRadius:999,
                    color:"#fff",
                    fontSize:12,
                    cursor:busy || !canAdjustCredits ? "default" : "pointer",
                    padding:"10px 14px",
                    fontWeight:700,
                    letterSpacing:0.1,
                    opacity:busy || !canAdjustCredits ? 0.6 : 1,
                  }}
                >
                  {busyAction === "add" ? "Adding…" : "Add credits"}
                </button>
                <button
                  type="button"
                  onClick={() => adjustCredits(row.user_id, -1)}
                  disabled={busy || !canAdjustCredits}
                  className="wc-btn"
                  style={{
                    background:"rgba(255,255,255,0.06)",
                    border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:999,
                    color:"#fff",
                    fontSize:12,
                    cursor:busy || !canAdjustCredits ? "default" : "pointer",
                    padding:"10px 14px",
                    fontWeight:700,
                    letterSpacing:0.1,
                    opacity:busy || !canAdjustCredits ? 0.6 : 1,
                  }}
                >
                  {busyAction === "remove" ? "Removing…" : "Remove credits"}
                </button>
                {canResendActivation && (
                  <button
                    type="button"
                    onClick={() => resendActivationEmail(row.user_id, row.email)}
                    disabled={busy}
                    className="wc-btn"
                    style={{
                      background:"rgba(176,244,200,0.12)",
                      border:"1px solid rgba(176,244,200,0.24)",
                      borderRadius:999,
                      color:"#DDFBE6",
                      fontSize:12,
                      cursor:busy ? "default" : "pointer",
                      padding:"10px 14px",
                      fontWeight:700,
                      letterSpacing:0.1,
                      opacity:busy ? 0.6 : 1,
                    }}
                  >
                    {busyAction === "resend" ? "Sending…" : "Resend activation email"}
                  </button>
                )}
                {notice && (
                  <div style={{ fontSize:12, color:notice === "Added." || notice === "Removed." || notice === "Activation email sent." ? "rgba(176,244,200,0.9)" : "#FFB090" }}>
                    {notice}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const ACCESS_MODE_OPTIONS = [
  {
    id: ACCESS_MODES.OPEN,
    label: "Open Testing",
    description: "Everyone can run reports without using credits. Best for internal QA only.",
  },
  {
    id: ACCESS_MODES.CREDITS,
    label: "Credit Beta",
    description: "Users need manually assigned credits. Best for controlled beta access.",
  },
  {
    id: ACCESS_MODES.PAYMENTS,
    label: "Payment Launch",
    description: "Users can use Quick Read or purchased credits. Payment integration can plug in later.",
  },
];

export function AdminAccessModeTab({ accessMode, onAccessModeChange }) {
  const [mode, setMode] = useState(accessMode || DEFAULT_ACCESS_MODE);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setErr("");
      try {
        const current = await getAccessMode({ throwOnError: true });
        if (!alive) return;
        setMode(current);
        onAccessModeChange?.(current);
      } catch (error) {
        if (!alive) return;
        console.error("Admin access mode load failed", error);
        setErr("Couldn't load access mode. The app falls back to Credit Beta.");
        setMode(DEFAULT_ACCESS_MODE);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [onAccessModeChange]);

  const updateMode = async (nextMode) => {
    if (busy || nextMode === mode) return;
    setBusy(true);
    setErr("");
    setNotice("");
    try {
      const savedMode = await setAccessMode(nextMode);
      setMode(savedMode);
      onAccessModeChange?.(savedMode);
      setNotice(`Access mode set to ${getAccessModeLabel(savedMode)}.`);
    } catch (error) {
      console.error("Admin access mode update failed", error);
      setErr(error.message || "Couldn't update access mode.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1 }}>
          Access Mode
        </div>
        <div style={adminControlPillStyle()}>
          {loading ? "Loading…" : getAccessModeLabel(mode)}
        </div>
      </div>

      <div style={{ fontSize:13, color:"rgba(255,255,255,0.55)", lineHeight:1.6, width:"100%" }}>
        This global setting controls who can run reports without redeploying the app.
      </div>

      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>
      )}
      {notice && (
        <div style={{ fontSize:13, color:"rgba(176,244,200,0.9)", background:"rgba(20,160,80,0.12)", border:"1px solid rgba(20,160,80,0.26)", padding:"10px 14px", borderRadius:14, width:"100%", textAlign:"center", lineHeight:1.5 }}>{notice}</div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        {ACCESS_MODE_OPTIONS.map(option => {
          const active = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => updateMode(option.id)}
              disabled={busy || loading}
              className="wc-btn"
              style={{
                width:"100%",
                display:"flex",
                flexDirection:"column",
                gap:6,
                textAlign:"left",
                borderRadius:18,
                padding:"14px 16px",
                background: active ? "rgba(160,138,240,0.16)" : "rgba(255,255,255,0.04)",
                border: active ? `1.5px solid ${PAL.upload.accent}` : "1px solid rgba(255,255,255,0.10)",
                color:"#fff",
                cursor:busy || loading ? "wait" : "pointer",
                opacity:busy || loading ? 0.7 : 1,
                transition:"all 0.18s",
              }}
            >
              <div style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <span style={{ fontSize:15, fontWeight:850, letterSpacing:-0.2 }}>{option.label}</span>
                <span style={{
                  width:20,
                  height:20,
                  borderRadius:"50%",
                  border:active ? "none" : "1.5px solid rgba(255,255,255,0.22)",
                  background:active ? PAL.upload.accent : "transparent",
                  color:active ? PAL.upload.bg : "transparent",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontSize:11,
                  fontWeight:900,
                  flexShrink:0,
                }}>
                  ✓
                </span>
              </div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.52)", lineHeight:1.55 }}>
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

const PREVIEW_USER = {
  id: "preview-user",
  email: "preview@wrapchat.app",
  user_metadata: {
    full_name: "You",
    display_name: "You",
    has_onboarded: true,
    terms_accepted: true,
    quick_read_intro_seen: false,
  },
};

const PREVIEW_MATH = {
  isGroup: false,
  names: ["You", "Mina"],
  msgCounts: [1842, 1597],
  mediaCounts: [72, 54],
  voiceCounts: [18, 11],
  linkCounts: [31, 19],
  topWords: ["okay", "today", "come", "wait", "miss", "home"],
  topBigrams: ["good morning", "call me", "see you"],
  spiritEmoji: ["😭", "😂", "❤️"],
  totalMessages: 3439,
  streak: 42,
  topMonths: [["Apr", 612]],
  ghostName: "Mina",
  ghostAvg: ["18m", "41m"],
  ghostEqual: false,
  convStarter: "You",
  convStarterPct: "61%",
  convKiller: "Mina",
  displayTitle: "You & Mina",
};

const PREVIEW_GROUP_MATH = {
  ...PREVIEW_MATH,
  isGroup: true,
  names: ["You", "Mina", "Deniz", "Aylin", "Can"],
  msgCounts: [1842, 1597, 912, 640, 318],
  mediaCounts: [72, 54, 33, 18, 9],
  voiceCounts: [18, 11, 6, 4, 2],
  linkCounts: [31, 19, 14, 8, 3],
  totalMessages: 5309,
  mainChar: "You",
  ghost: "Can",
  convStarter: "Mina",
  convKiller: "Deniz",
  displayTitle: "Weekend Crew",
};

const PREVIEW_AI_QUICK_READ = {
  vibe: "Warm, fast, and a little chaotic in a way that feels familiar. There is a lot of checking in, tiny updates, and playful recovery after small tension.",
  pattern: "You tend to restart the rhythm when the chat goes quiet. Mina answers with more detail once the conversation has an obvious emotional lane.",
  takeaway: "The chat works best when the topic is specific. Vague check-ins fade quickly, but plans, jokes, and honest reactions pull both people back in.",
};

const PREVIEW_RESULT_ROWS = [
  {
    id: "preview-general",
    user_id: "preview-user",
    report_type: "general",
    chat_type: "duo",
    names: ["You", "Mina"],
    created_at: "2026-05-18T12:00:00.000Z",
    math_data: { ...PREVIEW_MATH, bundle_id: "preview-full-pack", bundle_pack_id: "full" },
    result_data: {
      relationshipType: "partner",
      vibeOneLiner: "This chat has a soft daily-life intimacy with occasional little sparks of avoidance.",
      relationshipSummary: "You both keep returning to the thread, even after the rhythm gets uneven.",
      runMetadata: { displayTitle: "You & Mina", sourceChatCount: 2, datasetKind: "combined" },
    },
  },
  {
    id: "preview-love",
    user_id: "preview-user",
    report_type: "lovelang",
    chat_type: "duo",
    names: ["You", "Mina"],
    created_at: "2026-05-18T12:00:00.000Z",
    math_data: { ...PREVIEW_MATH, bundle_id: "preview-full-pack", bundle_pack_id: "full" },
    result_data: {
      compatibilityScore: 8,
      compatibilityRead: "You show care through availability; Mina shows it through practical memory and small acts.",
      personA: { name: "You", language: "quality time", examples: "Frequent check-ins and quick follow-ups." },
      personB: { name: "Mina", language: "acts of service", examples: "Remembering details and solving tiny problems." },
    },
  },
  {
    id: "preview-growth",
    user_id: "preview-user",
    report_type: "growth",
    chat_type: "duo",
    names: ["You", "Mina"],
    created_at: "2026-05-12T10:00:00.000Z",
    math_data: PREVIEW_MATH,
    result_data: {
      trajectory: "deepening",
      arcSummary: "The early chat was mostly logistics. The recent chat has more emotional shorthand and less explaining.",
      trajectoryDetail: "More callbacks, more repair, and more shared context appear later in the export.",
    },
  },
  {
    id: "preview-toxic",
    user_id: "preview-user",
    report_type: "toxicity",
    chat_type: "duo",
    names: ["You", "Mina"],
    created_at: "2026-05-03T09:00:00.000Z",
    math_data: PREVIEW_MATH,
    result_data: {
      chatHealthScore: 7,
      verdict: "Mostly healthy, but conflict gets indirect when one person feels ignored.",
      conflictPattern: "Small delays turn into tone checks instead of direct requests.",
    },
  },
];

const PREVIEW_DUPLICATE_DATASET = {
  mergeState: {
    approved: [],
    suggestions: [
      {
        id: "mina-duplicate",
        participantA: { displayName: "Mina", phone: "+90 555 0101" },
        participantB: { displayName: "Mina K.", phone: "+90 555 0101" },
      },
    ],
  },
};

const PREVIEW_PARTICIPANT_MISMATCH = {
  rows: [
    { chatId: "chat-1", label: "Main chat", otherName: "Mina", fileName: "WhatsApp Chat with Mina.txt" },
    { chatId: "chat-2", label: "Extra chat", otherName: "Selin", fileName: "WhatsApp Chat with Selin.txt" },
  ],
};

const PREVIEW_PROFILE_WARNING = {
  userName: "Ozge",
  participants: ["Mina", "Mina K."],
};

export function PreviewAuthConfirmed({ status = "success" }) {
  const ok = status === "success";
  const { theme } = useTheme();
  const da = getDA(theme);
  return (
    <Shell sec="upload" prog={0} total={0} scrollable={false} hidePill hideProgressBar>
      <BrandLockup logoSrc={wrapchatLogoTransparent} logoSize={62} subtitle="Your chats, unwrapped." subtitleMarginBottom={8} />
      <div style={{ width:"100%", background:"rgba(var(--wc-p),0.12)", border:"1px solid rgba(var(--wc-p),0.24)", borderRadius:24, padding:"28px 22px", textAlign:"center" }}>
        <div style={{ fontSize:ok ? 30 : 26, fontWeight:900, color:da.text, letterSpacing:-1, lineHeight:1.08 }}>
          {ok ? "Account activated." : "Link expired or invalid."}
        </div>
        <div style={{ marginTop:10, fontSize:14, color:da.muted, lineHeight:1.65 }}>
          {ok ? "Your account has been successfully activated. You can now log in." : "This confirmation link has expired or has already been used. Sign in to your account or request a new link."}
        </div>
      </div>
      <PrimaryButton onClick={() => {}} color={ok ? PAL.growth.accent : PAL.upload.accent} textColor={ok ? PAL.growth.bg : PAL.upload.bg}>
        {ok ? "Log in to WrapChat" : "Go to WrapChat"}
      </PrimaryButton>
    </Shell>
  );
}

export function PreviewFrame({ children }) {
  return (
    <CloseResultsContext.Provider value={null}>
      <ShareResultsContext.Provider value={null}>
        <FeedbackContext.Provider value={null}>
          <SlideContext.Provider value={{ dir: "fade", id: 0, animateIn: false }}>
            <style>{`
              .wc-admin-preview-frame > .wc-root {
                width: min(420px, 100vw) !important;
                height: 100svh !important;
                margin: 0 !important;
                border-radius: 0 !important;
                box-shadow: none;
                pointer-events: none;
              }
            `}</style>
            <div
              className="wc-admin-preview-frame"
              style={{
                width:"100%",
                minHeight:"100svh",
                background:"transparent",
                display:"flex",
                justifyContent:"center",
                alignItems:"flex-start",
                overflow:"hidden",
                scrollSnapAlign:"start",
                scrollSnapStop:"always",
                flexShrink:0,
              }}
            >
              {children}
            </div>
          </SlideContext.Provider>
        </FeedbackContext.Provider>
      </ShareResultsContext.Provider>
    </CloseResultsContext.Provider>
  );
}

export function AdminPreviewLab({ header = null }) {
  const noop = () => {};
  const previewPages = [
    {
      id:"auth",
      title:"Auth",
      variations:[
        { id:"login", label:"Log in", render:() => <AuthUploadFrame phase="auth" onParsed={noop} /> },
        { id:"signup", label:"Sign up", render:() => <AuthUploadFrame phase="auth" onParsed={noop} authPreview={{ tab:"signup" }} /> },
        { id:"login-error", label:"Login error", render:() => <AuthUploadFrame phase="auth" onParsed={noop} authPreview={{ email:"preview@wrapchat.app", password:"password", error:"Email or password is incorrect." }} /> },
        { id:"check-email", label:"Check email", render:() => <AuthUploadFrame phase="auth" onParsed={noop} authPreview={{ tab:"signup", email:"preview@wrapchat.app", password:"password", info:"Check your email to confirm your account, then log in." }} /> },
        { id:"confirmed", label:"Confirmed", render:() => <PreviewAuthConfirmed status="success" /> },
        { id:"expired", label:"Expired link", render:() => <PreviewAuthConfirmed status="error" /> },
        { id:"admin-locked", label:"Admin locked", render:() => <AdminLocked onBack={noop} /> },
      ],
    },
    {
      id:"onboarding",
      title:"Onboarding",
      variations:[
        { id:"intro", label:"Intro", render:() => <OnboardingFlow step={0} next={noop} onOnboarded={noop} /> },
        { id:"export", label:"Export steps", render:() => <OnboardingFlow step={1} next={noop} onOnboarded={noop} /> },
        { id:"reports", label:"Reports", render:() => <OnboardingFlow step={2} next={noop} onOnboarded={noop} /> },
        { id:"language", label:"Language", render:() => <OnboardingFlow step={3} next={noop} onOnboarded={noop} /> },
        { id:"terms", label:"Terms", render:() => <TermsFlow onAccepted={noop} onLogout={noop} /> },
        { id:"profile-name", label:"Profile name", render:() => <ProfileNameSetup user={PREVIEW_USER} onSaved={noop} onLogout={noop} /> },
      ],
    },
    {
      id:"upload",
      title:"Upload",
      variations:[
        { id:"payment-quick", label:"Payment + Quick Read", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} credits={0} quickReadAvailable accessMode={ACCESS_MODES.PAYMENTS} onPayment={noop} /> },
        { id:"payment-used", label:"Payment used", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} credits={0} accessMode={ACCESS_MODES.PAYMENTS} uploadInfo="Your Quick Read has already been used. Credits are required for everything else." onPayment={noop} /> },
        { id:"credit-balance", label:"Credit balance", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} credits={160} unlockedPackIds={{ vibe:true }} accessMode={ACCESS_MODES.CREDITS} onUpgrade={noop} /> },
        { id:"zero-credits", label:"0 credits", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} credits={0} accessMode={ACCESS_MODES.CREDITS} onUpgrade={noop} /> },
        { id:"open-testing", label:"Open testing", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} accessMode={ACCESS_MODES.OPEN} /> },
        { id:"upload-error", label:"Upload error", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} credits={0} accessMode={ACCESS_MODES.PAYMENTS} uploadError="Couldn't open this file. Please export the chat again and retry." /> },
        { id:"first-run", label:"First run", render:() => <AuthUploadFrame phase="upload" onParsed={noop} onHistory={noop} firstRunQuickRead accessMode={ACCESS_MODES.PAYMENTS} /> },
      ],
    },
    {
      id:"setup",
      title:"Set Up Chat",
      variations:[
        { id:"relationship", label:"Relationship", render:() => <RelationshipSelect animKey="preview" onSelect={noop} onBack={noop} /> },
        { id:"too-short", label:"Too short", render:() => <TooShort onBack={noop} /> },
        { id:"duplicates", label:"Duplicate contacts", render:() => <DuplicateParticipantReview dataset={PREVIEW_DUPLICATE_DATASET} onContinue={noop} onBack={noop} /> },
        { id:"participant-mismatch", label:"Participant mismatch", render:() => <ParticipantMismatchReview mismatch={PREVIEW_PARTICIPANT_MISMATCH} onContinue={noop} onBack={noop} /> },
        { id:"name-mismatch", label:"Name mismatch", render:() => <ProfileNameMismatchReview warning={PREVIEW_PROFILE_WARNING} onContinue={noop} onBack={noop} /> },
      ],
    },
    {
      id:"pick-read",
      title:"Pick Read",
      variations:[
        { id:"quick-available", label:"Quick available", render:() => <PackSelect animKey="preview" math={PREVIEW_MATH} credits={0} accessMode={ACCESS_MODES.PAYMENTS} quickReadAvailable onRunPack={noop} onBack={noop} onRunQuickRead={noop} onOpenUnlock={noop} /> },
        { id:"some-unlocked", label:"Some unlocked", render:() => <PackSelect animKey="preview" math={PREVIEW_MATH} credits={80} accessMode={ACCESS_MODES.PAYMENTS} unlockedPackIds={{ vibe:true, growth:true }} onRunPack={noop} onBack={noop} onOpenUnlock={noop} /> },
        { id:"open-testing", label:"Open testing", render:() => <PackSelect animKey="preview" math={PREVIEW_MATH} accessMode={ACCESS_MODES.OPEN} onRunPack={noop} onBack={noop} onOpenUnlock={noop} /> },
        { id:"no-quick", label:"No Quick Read", render:() => <PackSelect animKey="preview" math={PREVIEW_MATH} credits={0} accessMode={ACCESS_MODES.PAYMENTS} onRunPack={noop} onBack={noop} onOpenUnlock={noop} /> },
        { id:"group", label:"Group chat", render:() => <PackSelect animKey="preview" math={PREVIEW_GROUP_MATH} credits={100} accessMode={ACCESS_MODES.PAYMENTS} quickReadAvailable onRunPack={noop} onBack={noop} onRunQuickRead={noop} onOpenUnlock={noop} /> },
      ],
    },
    {
      id:"unlock",
      title:"Unlock",
      variations:[
        { id:"not-enough", label:"Not enough", render:() => <UpgradePlaceholder info={{ accessMode:ACCESS_MODES.PAYMENTS, requiredCredits:getPackCreditCost("full"), backPhase:"select" }} credits={60} accessMode={ACCESS_MODES.PAYMENTS} onBack={noop} onOpenPayment={noop} onBuyPacks={noop} /> },
        { id:"enough", label:"Enough credits", render:() => <UpgradePlaceholder info={{ accessMode:ACCESS_MODES.PAYMENTS, requiredCredits:getPackCreditCost("vibe"), backPhase:"select" }} credits={220} accessMode={ACCESS_MODES.PAYMENTS} onBack={noop} onOpenPayment={noop} onBuyPacks={noop} /> },
        { id:"credit-beta", label:"Credit beta", render:() => <UpgradePlaceholder info={{ accessMode:ACCESS_MODES.CREDITS, requiredCredits:getPackCreditCost("rf"), backPhase:"select" }} credits={40} accessMode={ACCESS_MODES.CREDITS} onBack={noop} onBuyPacks={noop} /> },
      ],
    },
    {
      id:"credits",
      title:"Add Credits",
      variations:[
        { id:"low", label:"Low balance", render:() => <PaymentScreen preselect="full" credits={0} userId="preview-user" onBack={noop} onPaymentComingSoon={noop} onPurchaseCredits={noop} /> },
        { id:"existing", label:"Existing balance", render:() => <PaymentScreen preselect="vibe" credits={160} userId="preview-user" onBack={noop} onPaymentComingSoon={noop} onPurchaseCredits={noop} /> },
      ],
    },
    {
      id:"quick-read",
      title:"Quick Read",
      variations:[
        { id:"intro", label:"Intro", render:() => <QuickReadIntro user={PREVIEW_USER} onContinue={noop} /> },
        { id:"buffer", label:"Buffer", render:() => <Loading math={PREVIEW_MATH} reportType="trial_report" reportTypes={["trial_report"]} /> },
        { id:"snapshot", label:"Snapshot", render:() => <TrialReportScreen s={PREVIEW_MATH} ai={PREVIEW_AI_QUICK_READ} aiLoading={false} step={0} back={noop} next={noop} /> },
        { id:"ai-read", label:"AI read", render:() => <TrialReportScreen s={PREVIEW_MATH} ai={PREVIEW_AI_QUICK_READ} aiLoading={false} step={5} back={noop} next={noop} /> },
        { id:"summary", label:"Summary", render:() => <TrialReportScreen s={PREVIEW_MATH} ai={PREVIEW_AI_QUICK_READ} aiLoading={false} step={7} back={noop} next={noop} /> },
        { id:"unlock-explainer", label:"Unlock explainer", render:() => <TrialReportScreen s={PREVIEW_MATH} ai={PREVIEW_AI_QUICK_READ} aiLoading={false} step={8} back={noop} next={noop} /> },
        { id:"pricing", label:"Pricing", render:() => <TrialFinale back={noop} credits={0} userId="preview-user" onPaymentComingSoon={noop} onPurchaseCredits={noop} /> },
      ],
    },
    {
      id:"my-results",
      title:"My Results",
      variations:[
        { id:"empty", label:"Empty", render:() => <MyResults currentUser={PREVIEW_USER} previewRows={[]} onBack={noop} onRestoreResult={noop} onSettings={noop} /> },
        { id:"filled", label:"Filled", render:() => <MyResults currentUser={PREVIEW_USER} previewRows={PREVIEW_RESULT_ROWS} onBack={noop} onRestoreResult={noop} onSettings={noop} /> },
      ],
    },
    {
      id:"settings",
      title:"Settings",
      variations:[
        { id:"default", label:"Default", render:() => <SettingsScreen onBack={noop} onAccountDeleted={noop} onLogout={noop} onUserUpdated={noop} reportLang="en" onReportLangChange={noop} previewUser={PREVIEW_USER} /> },
      ],
    },
  ];

  const readInitialSelection = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pageParam = params.get("previewPage");
      const variationParam = params.get("previewVariation");
      const legacyPreview = params.get("preview");
      if (pageParam) return { pageId:pageParam, variationId:variationParam || "" };
      for (const page of previewPages) {
        const match = page.variations.find(item => item.id === legacyPreview || `${page.id}-${item.id}` === legacyPreview);
        if (match) return { pageId:page.id, variationId:match.id };
      }
    } catch {
      // Ignore malformed URLs.
    }
    return { pageId:"auth", variationId:"login" };
  };

  const initialSelection = readInitialSelection();
  const [pageId, setPageId] = useState(initialSelection.pageId);
  const [variationId, setVariationId] = useState(initialSelection.variationId);
  const selectedPage = previewPages.find(page => page.id === pageId) || previewPages[0];
  const selectedVariation = selectedPage.variations.find(item => item.id === variationId) || selectedPage.variations[0];

  const updateUrl = (nextPageId, nextVariationId) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("previewPage", nextPageId);
      url.searchParams.set("previewVariation", nextVariationId);
      url.searchParams.delete("preview");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // URL persistence is helpful, not required.
    }
  };

  const selectPage = (nextPageId) => {
    const nextPage = previewPages.find(page => page.id === nextPageId) || previewPages[0];
    const nextVariationId = nextPage.variations[0]?.id || "";
    setPageId(nextPage.id);
    setVariationId(nextVariationId);
    updateUrl(nextPage.id, nextVariationId);
  };

  const selectVariation = (nextVariationId) => {
    setVariationId(nextVariationId);
    updateUrl(selectedPage.id, nextVariationId);
  };

  return (
    <>
      <div style={{ width:"100%", minHeight:"100svh", display:"flex", flexDirection:"column", justifyContent:"flex-start", gap:12, flexShrink:0, padding:`calc(${SHELL_SAFE_TOP} + 16px) 20px calc(24px + env(safe-area-inset-bottom, 0px))`, scrollSnapAlign:"start", scrollSnapStop:"always" }}>
        {header}
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:2, flexShrink:0 }}>
          {previewPages.map(page => {
            const active = page.id === selectedPage.id;
            return (
              <button key={page.id} type="button" onClick={() => selectPage(page.id)} className="wc-btn" style={{ border:`1px solid ${active ? PAL.upload.accent : "rgba(255,255,255,0.12)"}`, background:active ? "rgba(122,144,255,0.20)" : "rgba(255,255,255,0.05)", color:active ? "#fff" : "rgba(255,255,255,0.62)", borderRadius:999, padding:"8px 12px", fontSize:12, fontWeight:850, cursor:"pointer", whiteSpace:"nowrap" }}>
                {page.title}
              </button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:7, overflowX:"auto", paddingBottom:2, flexShrink:0 }}>
          {selectedPage.variations.map(item => {
            const active = item.id === selectedVariation.id;
            return (
              <button key={item.id} type="button" onClick={() => selectVariation(item.id)} className="wc-btn" style={{ border:`1px solid ${active ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.10)"}`, background:active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)", color:active ? "#fff" : "rgba(255,255,255,0.54)", borderRadius:999, padding:"7px 10px", fontSize:11, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <PreviewFrame>
        {selectedVariation.render()}
      </PreviewFrame>
    </>
  );
}

export function AdminPanel({ onBack, accessMode, onAccessModeChange }) {
  const [tab, setTab] = useState("feedback");
  const tabs = [
    { id: "feedback", label: "Feedback" },
    { id: "users", label: "Users" },
    { id: "settings", label: "Settings" },
    { id: "preview", label: "Preview" },
  ];
  const adminHeader = (
    <>
      <ScreenHeader back={onBack} title="Admin" />

      {!ADMIN_EMAILS.length && (
        <div style={{ fontSize:12, color:"#FFB090", background:"rgba(200,60,20,0.15)", border:"1px solid rgba(200,60,20,0.3)", padding:"10px 14px", borderRadius:14, width:"100%", lineHeight:1.6 }}>
          Set <code>VITE_ADMIN_EMAIL</code> in <code>.env</code> to unlock admin access.
        </div>
      )}

      <SlidingSegmentedTabs
        items={tabs}
        value={tab}
        onChange={setTab}
        ariaLabel="Admin tabs"
      />
    </>
  );

  return (
    <Shell sec="upload" prog={0} total={0} scrollable={tab === "preview"} contentAlign="start" snapScroll={tab === "preview"} hidePill={tab === "preview"}>
      {tab !== "preview" && (
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, flexShrink:0 }}>
          {adminHeader}
        </div>
      )}

      {tab !== "preview" && (
        <div style={{ ...SCREEN_BODY_SCROLL_STYLE, gap:12, alignSelf:"stretch" }}>
          {tab === "feedback" && <AdminFeedbackTab />}
          {tab === "users" && <AdminUsersTab accessMode={accessMode} />}
          {tab === "settings" && <AdminAccessModeTab accessMode={accessMode} onAccessModeChange={onAccessModeChange} />}
        </div>
      )}
      {tab === "preview" && <AdminPreviewLab header={adminHeader} />}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// MY RESULTS
// ─────────────────────────────────────────────────────────────────
export function MyResults({ onBack, onRestoreResult, initialBundleId = null, onSettings = null, drawerMode = false, currentUser = null, previewRows = null }) {
  const { theme } = useTheme();
  const da = getDA(theme);
  const isLight = theme === "light";
  const isPreview = Array.isArray(previewRows);
  const cachedRows = !isPreview && currentUser?.id ? readUserDataCache(currentUser.id).results.rows : null;
  const [rows,           setRows]           = useState(() => isPreview ? previewRows : (cachedRows || null));
  const [err,            setErr]            = useState("");
  const [currentUserName, setCurrentUserName] = useState(() => currentUser ? userProvidedDisplayName(currentUser) : "");
  const [editing,        setEditing]        = useState(false);
  const [confirmId,      setConfirmId]      = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [bundleView,     setBundleView]     = useState(initialBundleId); // null | string (bundle_id)
  const [confirmBundle,  setConfirmBundle]  = useState(null);
  const [deletingBundle, setDeletingBundle] = useState(null);
  const [nameView,       setNameView]       = useState(null); // null | string (participant name)
  const [confirmNameId,  setConfirmNameId]  = useState(null); // null | string
  const [deletingName,   setDeletingName]   = useState(null); // null | string
  const [viewMode,       setViewMode]       = useState(() => {
    try { return localStorage.getItem("wrapchat_results_view") || "names"; } catch { return "names"; }
  });

  useEffect(() => {
    if (isPreview) {
      setRows(previewRows);
      setCurrentUserName(currentUser ? userProvidedDisplayName(currentUser) : "You");
      setErr("");
      return undefined;
    }
    let alive = true;
    const load = async () => {
      const user = currentUser || (await supabase.auth.getUser()).data?.user || null;
      if (!alive) return;
      if (!user) {
        setRows([]);
        return;
      }

      setCurrentUserName(userProvidedDisplayName(user));
      const cached = readUserDataCache(user.id).results.rows;
      const hadCachedRows = Array.isArray(cached);
      if (hadCachedRows) setRows(cached);

      const { data, error } = await requestOnce(`results:${user.id}`, () => supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }));

      if (!alive) return;
      if (error) {
        if (!hadCachedRows) setRows([]);
        setErr("Couldn't load results. Try again.");
        return;
      }

      const freshRows = data || [];
      cacheUserResults(user.id, freshRows);
      setErr("");
      setRows(prev => sameCachedValue(prev, freshRows) ? prev : freshRows);
    };

    load();
    return () => { alive = false; };
  }, [currentUser, isPreview, previewRows]);

  useEffect(() => {
    if (bundleView && rows && !rows.some(r => r.math_data?.bundle_id === bundleView)) {
      queueMicrotask(() => setBundleView(null));
    }
  }, [rows, bundleView]);

  const exitEditing = () => { setEditing(false); setConfirmId(null); setConfirmBundle(null); setConfirmNameId(null); };

  const handleDelete = async (id) => {
    setDeletingId(id);
    setConfirmId(null);
    try {
      const { error } = await supabase.from("results").delete().eq("id", id);
      if (!error) {
        setRows(prev => prev.filter(r => r.id !== id));
        removeCachedResults(currentUser?.id, id);
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingId(null);
  };

  const handleDeleteBundle = async (bid, bundleRows) => {
    setDeletingBundle(bid);
    setConfirmBundle(null);
    const ids = bundleRows.map(r => r.id);
    try {
      const { error } = await supabase.from("results").delete().in("id", ids);
      if (!error) {
        setRows(prev => prev.filter(r => !ids.includes(r.id)));
        removeCachedResults(currentUser?.id, ids);
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingBundle(null);
  };

  const handleDeleteName = async (name, group) => {
    setDeletingName(name);
    setConfirmNameId(null);
    const ids = [];
    group.items.forEach(item => {
      if (item.type === 'single') ids.push(item.row.id);
      else item.rows.forEach(r => ids.push(r.id));
    });
    const uniqueIds = [...new Set(ids)];
    try {
      const { error } = await supabase.from("results").delete().in("id", uniqueIds);
      if (!error) {
        setRows(prev => prev.filter(r => !uniqueIds.includes(r.id)));
        removeCachedResults(currentUser?.id, uniqueIds);
      } else {
        setErr("Couldn't delete. Try again.");
      }
    } catch {
      setErr("Couldn't delete. Try again.");
    }
    setDeletingName(null);
  };

  const shortName = (name, fallback = "—") => String(name || fallback).trim().split(/\s+/)[0] || fallback;

  const rankedPeople = (people, scoreKey) => people
    .filter(Boolean)
    .map(person => ({
      ...person,
      previewScore: Number(person?.[scoreKey]),
    }))
    .filter(person => Number.isFinite(person.previewScore))
    .sort((a, b) => b.previewScore - a.previewScore);

  const energyKeyword = (person, lang) => {
    const type = String(person?.type || "").toLowerCase();
    if (type === "net positive") return translateControlValue(lang, "net positive") || "positive";
    if (type === "net draining") return translateControlValue(lang, "net draining") || "draining";
    if (type === "mixed") return translateControlValue(lang, "mixed") || "mixed";
    if (person?.previewScore >= 7) return "positive";
    if (person?.previewScore <= 4) return "draining";
    return "mixed";
  };

  const accountabilityKeyword = (person) => {
    const kept = Number(person?.kept) || 0;
    const broken = Number(person?.broken) || 0;
    if (person?.previewScore >= 8 && kept >= broken) return "reliable";
    if (broken > kept) return "follow-through";
    if (person?.previewScore >= 6) return "steady";
    return "mixed";
  };

  const participantPreview = (people, scoreKey, keywordFor) => {
    const ranked = rankedPeople(people, scoreKey).slice(0, 2);
    if (!ranked.length) return "—";
    return ranked
      .map(person => `${shortName(person.name)} ${person.previewScore}/10 ${keywordFor(person)}`)
      .join(" • ");
  };

  const headline = (row) => {
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const ai   = getDisplayResultData(row.result_data, displayLang);
    const math = row.math_data   || {};
    switch (row.report_type) {
      case "general":  return `${(math.totalMessages || 0).toLocaleString()} messages`;
      case "toxicity": return chatHealthLabel(ai.chatHealthScore) || math.toxicityLevel || "—";
      case "lovelang": return ai.compatibilityScore != null ? `${ai.compatibilityScore}/10 compatibility` : "—";
      case "growth":   return translateControlValue(displayLang, ai.trajectory) || "—";
      case "accounta": return participantPreview([ai.personA, ai.personB], "score", accountabilityKeyword);
      case "energy":   return participantPreview([ai.personA, ai.personB], "netScore", person => energyKeyword(person, displayLang));
      default:         return "—";
    }
  };

  const formatDate = (dateStr) => {
    const d    = new Date(dateStr);
    const now  = new Date();
    const diff = Math.floor((now - d) / 864e5);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7)  return d.toLocaleDateString("en-US", { weekday:"short" });
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  };

  const resultDisplayTitle = (row) =>
    String(
      row?.result_data?.runMetadata?.displayTitle ||
      row?.math_data?.display_title ||
      row?.math_data?.displayTitle ||
      ""
    ).replace(/,\s*combined\b/i, "").trim();

  const duoNamesForCurrentUser = (row) => {
    if (row?.chat_type !== "duo" || !Array.isArray(row.names)) return null;
    const normalizedUser = normalizeDisplayName(currentUserName);
    const names = row.names.map(name => String(name || "").trim()).filter(Boolean);
    if (!names.length) return [];
    if (!normalizedUser) return names;
    const otherNames = names.filter(name => normalizeDisplayName(name) !== normalizedUser);
    return otherNames.length ? otherNames : names;
  };

  const namesLabel = (names) => {
    if (!Array.isArray(names) || !names.length) return "—";
    return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  };

  const rowNames = (row) => {
    const duoNames = duoNamesForCurrentUser(row);
    if (duoNames) return namesLabel(duoNames);
    const savedNames = Array.isArray(row?.names)
      ? namesWithoutCurrentUser(row.names, { user_metadata: { full_name: currentUserName } })
      : [];
    return namesLabel(savedNames) || resultDisplayTitle(row) || "—";
  };

  const datasetBadge = (row) => {
    const count = row?.result_data?.runMetadata?.sourceChatCount || row?.math_data?.source_chat_count || row?.math_data?.sourceChatCount || 1;
    const kind = row?.result_data?.runMetadata?.datasetKind || row?.math_data?.dataset_kind || row?.math_data?.datasetKind || "single";
    return kind === "combined" && count > 1 ? `Combined · ${count} chats` : "";
  };

  // Shared swatch for a single report card
  const makeSwatchEl = (pal) => <SwatchIcon inner={pal.inner} accent={pal.accent} />;

  // Shared text block for a single report card
  const makeTextEl = (pal, rt, row, dateLabel, stat) => (
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:pal.accent, marginBottom:5 }}>
        {rt?.label || row.report_type} · {dateLabel}
      </div>
      <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, color:da.text, lineHeight:1.2 }}>
        {rowNames(row)}
      </div>
      {datasetBadge(row) && (
        <div style={{ fontSize:11, fontWeight:700, color:da.faint, marginTop:4 }}>{datasetBadge(row)}</div>
      )}
      {stat !== "—" && (
        <div style={{ fontSize:12, fontWeight:600, color:pal.accent, marginTop:4 }}>{stat}</div>
      )}
    </div>
  );

  // Bundle palette — visually distinct from per-report-type colors
  const BUNDLE_PAL = { bg:"#160F38", inner:"#2E1F70", accent:"#C4B0FF" };
  // Name palette — for participant name cards in Names view
  const NAME_PAL = { bg:"#111648", inner:"rgba(122,144,255,0.26)", accent:"#7A90FF" };
  const RESULTS_CARD_BG = "rgba(var(--wc-p),0.22)";

  // ── Compute display items (singles + bundles) ──
  const displayItems = (() => {
    if (!rows) return [];
    const bundleMap = new Map();
    const items = [];
    rows.forEach(row => {
      const bid = row.math_data?.bundle_id;
      if (bid) {
        if (!bundleMap.has(bid)) bundleMap.set(bid, []);
        bundleMap.get(bid).push(row);
      } else {
        items.push({ type:"single", row, created_at: row.created_at });
      }
    });
    bundleMap.forEach((bundleRows, bid) => {
      if (bundleRows.length <= 1) {
        items.push({ type:"single", row: bundleRows[0], created_at: bundleRows[0].created_at });
      } else {
        items.push({ type:"bundle", bundleId: bid, rows: bundleRows, created_at: bundleRows[0].created_at });
      }
    });
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items;
  })();

  const changeViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("wrapchat_results_view", mode);
    } catch {
      // Ignore storage failures; the in-memory view switch still works.
    }
  };

  // ── Compute names-grouped items (for Names mode) ──
  const nameItems = (() => {
    if (!rows) return [];
    const nameMap = new Map();
    displayItems.forEach(item => {
      const itemNames = item.type === "single"
        ? (duoNamesForCurrentUser(item.row) || (Array.isArray(item.row.names) ? item.row.names : []))
        : (duoNamesForCurrentUser(item.rows[0]) || (Array.isArray(item.rows[0]?.names) ? item.rows[0].names : []));
      itemNames.forEach(rawName => {
        const name = String(rawName || "").trim();
        if (!name) return;
        if (!nameMap.has(name)) nameMap.set(name, { name, items: [], latestDate: new Date(0) });
        const entry = nameMap.get(name);
        entry.items.push(item);
        const d = new Date(item.created_at);
        if (d > entry.latestDate) entry.latestDate = d;
      });
    });
    return Array.from(nameMap.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  })();

  const reportLabelFor = (type) => REPORT_TYPES.find(rt => rt.id === type)?.label || type;

  const packReportLabels = (pack, itemRows) => {
    const types = pack?.reports?.length ? pack.reports : itemRows.map(row => row.report_type);
    return [...new Set(types)].map(reportLabelFor).join(" · ");
  };

  const renderPackResultCard = (item) => {
    const itemRows = item.type === "bundle" ? item.rows : [item.row];
    const firstRow = itemRows[0];
    const pack = item.type === "bundle"
      ? (packForSavedRows(itemRows) || PACK_DEFS.full)
      : (firstRow?.report_type === "growth" ? PACK_DEFS.growth : null);
    const rt = firstRow ? REPORT_TYPES.find(r => r.id === firstRow.report_type) : null;
    const fallbackPal = PAL[rt?.palette] || PAL.upload;
    const cardAccent = pack?.listAccent || pack?.accent || fallbackPal.accent;
    const cardBg = RESULTS_CARD_BG;
    const key = item.type === "bundle" ? item.bundleId : firstRow.id;
    const packOrReportName = pack?.name || rt?.label || firstRow.report_type;
    const participantName = rowNames(firstRow);
    const subline = item.type === "bundle" && pack?.reports?.length > 1
      ? packReportLabels(pack, itemRows)
      : null;
    const dateLabel = formatDate(item.created_at);
    const isDeleting = item.type === "bundle" ? deletingBundle === item.bundleId : deletingId === firstRow.id;
    const isConfirming = item.type === "bundle" ? confirmBundle === item.bundleId : confirmId === firstRow.id;
    const onOpen = () => {
      if (editing || isDeleting || isConfirming) return;
      if (pack?.id === "growth" || item.type === "single") onRestoreResult(firstRow);
      else if (drawerMode) onBack?.(item.bundleId);
      else setBundleView(item.bundleId);
    };

    return (
      <div key={key}
        onClick={onOpen}
        style={{
          display:"flex", alignItems:"center", gap:16, boxSizing:"border-box",
          background:cardBg, border:isConfirming ? "1.5px solid rgba(220,50,50,0.55)" : "1.5px solid transparent",
          borderRadius:18, padding:"16px 18px",
          color:da.text, width:"100%", position:"relative",
          textAlign:"left", transition:"border-color 0.18s",
          cursor: editing || isDeleting || isConfirming ? "default" : "pointer",
        }}
      >
        <div style={{
          display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0,
          opacity: isDeleting || isConfirming ? 0.3 : 1,
          transform:"translateX(0)",
          transition:"opacity 0.22s",
          pointerEvents:"none",
        }}>
          {pack ? (
            <PackSwatch pack={pack} />
          ) : (
            <SwatchIcon inner={fallbackPal.inner} accent={fallbackPal.accent} />
          )}
          <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:4 }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"flex-start", gap:8, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:900, letterSpacing:-0.25, color:da.text, lineHeight:1.15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0, flex:"0 1 auto" }}>
                {packOrReportName}
              </div>
              <div style={{
                fontSize:11, fontWeight:800, color:da.muted, flexShrink:0,
              }}>
                {dateLabel}
              </div>
            </div>
            <div style={{ fontSize:13, fontWeight:800, letterSpacing:-0.15, color:isLight ? "rgba(31,24,78,0.75)" : "rgba(255,255,255,0.86)", lineHeight:1.18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {participantName}
            </div>
            {subline && (
              <div style={{ fontSize:12, fontWeight:600, color:cardAccent, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {subline}
              </div>
            )}
          </div>
        </div>
        <div style={{
          width:24, fontSize:20, color:da.faint, flexShrink:0, lineHeight:1,
          textAlign:"center",
          opacity: editing || isDeleting || isConfirming ? 0 : 1,
          transition:"opacity 0.2s ease",
          pointerEvents:"none",
        }}>›</div>
        <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? setConfirmBundle(item.bundleId) : setConfirmId(firstRow.id); }} className="wc-btn"
          style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
            background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
            color:"#fff", fontSize:14, fontWeight:800,
            display:"flex", alignItems:"center", justifyContent:"center", padding:0,
            opacity: editing && !isDeleting && !isConfirming ? 1 : 0,
            transition:"opacity 0.2s",
            pointerEvents: editing && !isDeleting && !isConfirming ? "auto" : "none",
            cursor:"pointer" }}
          aria-label={item.type === "bundle" ? "Delete pack" : "Delete result"}>×</button>
        {isDeleting && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots color="rgba(255,255,255,0.4)" /></div>}
        {isConfirming && !isDeleting && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
            background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>
              {item.type === "bundle" ? `Delete all ${itemRows.length} reports?` : "Delete this result?"}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? handleDeleteBundle(item.bundleId, itemRows) : handleDelete(firstRow.id); }} className="wc-btn"
                style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>
                {item.type === "bundle" ? "Delete all" : "Delete"}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); item.type === "bundle" ? setConfirmBundle(null) : setConfirmId(null); }} className="wc-btn"
                style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Bundle detail view ──
  if (bundleView) {
    if (rows === null) {
      return drawerMode ? (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
      ) : (
        <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
          <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
        </Shell>
      );
    }
    const bRows = rows.filter(r => r.math_data?.bundle_id === bundleView);
    const pack = packForSavedRows(bRows) || PACK_DEFS.full;
    return (
      <PackResultsBuffer
        rows={bRows}
        pack={pack}
        onClose={() => { exitEditing(); setBundleView(null); }}
        onOpenReport={(row) => {
          if (!editing && deletingId !== row.id && confirmId !== row.id) {
            onRestoreResult(row, { origin: "bundle", bundleId: bundleView });
          }
        }}
      />
    );
  }

  // ── Name detail view ──
  if (nameView) {
    const nameGroup = nameItems.find(g => g.name === nameView);
    if (!nameGroup || rows === null) {
      const loadEl = <div style={{ flex:1, display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>;
      return drawerMode ? loadEl : <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>{loadEl}</Shell>;
    }
    const allNameRows = [];
    nameGroup.items.forEach(item => {
      if (item.type === 'single') allNameRows.push(item.row);
      else item.rows.forEach(r => allNameRows.push(r));
    });
    allNameRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const totalReports = allNameRows.length;
    const nameDetailContent = (
      <div style={{
        ...SCREEN_CONTENT_STYLE,
        position:"relative",
      }}>
        <div style={SCREEN_HEADER_BLOCK_STYLE}>
          <ScreenHeader back={() => { exitEditing(); setNameView(null); }} titleNode={nameView} topOffset={0} />
          <div style={{ fontSize:13, color:da.faint, marginTop:6, fontWeight:600, textAlign:"center" }}>
            {totalReports} report{totalReports !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", minHeight:0,
          padding:`0 0 calc(80px + env(safe-area-inset-bottom, 0px))`,
          display:"flex", flexDirection:"column", gap:10 }}>
          {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
          {allNameRows.map(row => {
              const rt = reportTypeMeta(row.report_type);
              const pal = PAL[rt.palette] || PAL.upload;
              const styleMap = isLight ? REPORT_BUFFER_STYLE_LIGHT : REPORT_BUFFER_STYLE;
              const style = styleMap[row.report_type] || styleMap.general;
              const dimText  = isLight ? da.faint   : "rgba(255,255,255,0.32)";
              const bodyText = isLight ? da.muted   : "rgba(255,255,255,0.65)";
              const divider  = isLight ? `${pal.accent}22` : "rgba(255,255,255,0.08)";
              const chevronBg    = isLight ? `${pal.accent}12` : "rgba(255,255,255,0.08)";
              const chevronBorder= isLight ? `${pal.accent}30` : "rgba(255,255,255,0.12)";
              const chevronColor = isLight ? pal.accent        : "rgba(255,255,255,0.40)";
              const preview = resultPreviewFields(row);
              const isDeleting   = deletingId === row.id;
              const isConfirming = confirmId   === row.id;
              return (
                <div key={row.id}
                  onClick={() => { if (!editing && !isDeleting && !isConfirming) onRestoreResult(row); }}
                  style={{
                    borderRadius:24, padding:20, position:"relative", overflow:"hidden",
                    display:"flex", flexDirection:"column", flexShrink:0, boxSizing:"border-box",
                    background:style.bg,
                    border:isConfirming ? "1.5px solid rgba(220,50,50,0.55)" : `1.5px solid ${style.border}`,
                    color:da.text, width:"100%", textAlign:"left", transition:"border-color 0.18s",
                    cursor: editing || isDeleting || isConfirming ? "default" : "pointer",
                  }}
                >
                  <div style={{
                    display:"flex", flexDirection:"column",
                    opacity: isDeleting || isConfirming ? 0.3 : 1,
                    transform:"translateX(0)",
                    transition:"opacity 0.22s",
                    pointerEvents:"none",
                  }}>
                    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                        <SwatchIcon inner={pal.inner} accent={pal.accent} />
                        <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                          <div style={{ borderRadius:999, padding:"3px 10px", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", width:"fit-content", background:style.pillBg, color:pal.accent, border:`1px solid ${style.pillBorder}` }}>
                            {rt.label}
                          </div>
                        </div>
                      </div>
                      <div style={{
                        width:28, height:28, borderRadius:"50%", flexShrink:0,
                        background:chevronBg, border:`1px solid ${chevronBorder}`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        color:chevronColor, fontSize:14, marginTop:2,
                        opacity: editing || isDeleting || isConfirming ? 0 : 1,
                        transition:"opacity 0.2s ease",
                      }}>›</div>
                    </div>
                    <div style={{ height:1, background:divider, marginBottom:14 }} />
                    <div style={{ display:"flex", alignItems:"stretch", gap:12 }}>
                      <div style={{ display:"flex", flexDirection:"column", flexShrink:0, minWidth:52 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:26, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1, color:pal.accent }}>{preview.stat}</div>
                        <div style={{ fontSize:10, fontWeight:700, color:dimText, letterSpacing:"0.06em", textTransform:"uppercase", marginTop:3 }}>{preview.label}</div>
                      </div>
                      <div style={{ width:1, background:divider, alignSelf:"stretch" }} />
                      <div style={{ fontSize:13, fontWeight:500, fontStyle:"italic", color:bodyText, lineHeight:1.55, flex:1 }}>
                        "{cleanQuote(preview.insight, 120)}"
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmId(row.id); }} className="wc-btn"
                    style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
                      background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
                      color:"#fff", fontSize:14, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                      opacity: editing && !isDeleting && !isConfirming ? 1 : 0,
                      transition:"opacity 0.2s",
                      pointerEvents: editing && !isDeleting && !isConfirming ? "auto" : "none",
                      cursor:"pointer" }}
                    aria-label="Delete result">×</button>
                  {isDeleting && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots color="rgba(255,255,255,0.4)" /></div>}
                  {isConfirming && !isDeleting && (
                    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                      alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
                      background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>Delete this result?</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }} className="wc-btn"
                          style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>Delete</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmId(null); }} className="wc-btn"
                          style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
          })}
        </div>
        {allNameRows.length > 0 && (
          <button type="button" onClick={() => editing ? exitEditing() : setEditing(true)} className="wc-btn"
            aria-label={editing ? "Done editing" : "Edit results"}
            style={{ position:"absolute", bottom:"calc(20px + env(safe-area-inset-bottom, 0px))", right:20,
              width:48, height:48, borderRadius:"50%",
              background: editing ? PAL.upload.accent : "rgba(var(--wc-p),0.22)",
              border:`1px solid ${editing ? PAL.upload.accent : "rgba(var(--wc-p),0.38)"}`,
              color: editing ? PAL.upload.bg : da.text,
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,0.35)", cursor:"pointer", zIndex:10 }}>
            {editing
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            }
          </button>
        )}
      </div>
    );
    return drawerMode ? nameDetailContent : (
      <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
        {nameDetailContent}
      </Shell>
    );
  }

  const mainInnerContent = (
    <div style={{
      ...SCREEN_CONTENT_STYLE,
      position:"relative",
    }}>
      {/* Fixed header */}
      <div style={SCREEN_HEADER_BLOCK_STYLE}>
        <ScreenHeader
          back={() => { exitEditing(); onBack(); }}
          title="My Results"
          topOffset={0}
          action={onSettings ? (
            <button type="button" onClick={onSettings} className="wc-btn" aria-label="Settings"
              style={{ background:"rgba(var(--wc-p),0.16)", border:"1px solid rgba(var(--wc-p),0.32)", borderRadius:999, color:isLight ? "#7A90FF" : "rgba(200,170,240,0.85)", width:34, height:34, padding:0, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
              <GearIcon />
            </button>
          ) : null}
        />
        {rows?.length > 0 && (
          <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:da.faint, flexShrink:0 }}>Sort by</div>
            <div style={{ flex:1 }}>
              <SlidingSegmentedTabs
                compact
                padding={3}
                items={[{ id:"reports", label:"Results" }, { id:"names", label:"Names" }]}
                value={viewMode}
                onChange={(mode) => { exitEditing(); changeViewMode(mode); }}
                ariaLabel="Sort results by"
                background={isLight ? "rgba(31,24,78,0.08)" : "rgba(var(--wc-p),0.12)"}
              />
            </div>
          </div>
        )}
      </div>
        {/* Floating edit FAB */}
        {rows?.length > 0 && (
          <button
            type="button"
            onClick={() => editing ? exitEditing() : setEditing(true)}
            className="wc-btn"
            aria-label={editing ? "Done editing" : "Edit results"}
            style={{
              position:"absolute",
              bottom:"calc(20px + env(safe-area-inset-bottom, 0px))",
              right:20,
              width:48, height:48,
              borderRadius:"50%",
              background: editing ? PAL.upload.accent : "rgba(var(--wc-p),0.22)",
              border:`1px solid ${editing ? PAL.upload.accent : "rgba(var(--wc-p),0.38)"}`,
              color: editing ? PAL.upload.bg : da.text,
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 4px 20px rgba(0,0,0,0.35)",
              cursor:"pointer",
              zIndex:10,
            }}
          >
            {editing
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            }
          </button>
        )}

        {viewMode === "reports" && (
        <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain", minHeight:0,
          padding:`4px 0 calc(80px + env(safe-area-inset-bottom, 0px))`,
          display:"flex", flexDirection:"column", gap:10 }}>
          {rows === null && !err && (
            <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
          )}
          {err && (
            <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
          )}
          {rows?.length === 0 && (
            <div style={{ fontSize:14, color:da.faint, textAlign:"center", padding:"32px 0", lineHeight:1.7 }}>
              No saved results yet.<br/>Run an analysis to see it here.
            </div>
          )}
          <StaggerList key={displayItems.length}>
            {displayItems.map(item => renderPackResultCard(item))}
          </StaggerList>
        </div>
        )}
        {viewMode === "names" && (
          <div style={{ flex:1, overflowY:"auto", overscrollBehavior:"contain", minHeight:0,
            padding:`4px 0 calc(80px + env(safe-area-inset-bottom, 0px))`,
            display:"flex", flexDirection:"column", gap:10 }}>
            {rows === null && !err && (
              <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
            )}
            {err && (
              <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
            )}
            {rows?.length === 0 && (
              <div style={{ fontSize:14, color:da.faint, textAlign:"center", padding:"32px 0", lineHeight:1.7 }}>
                No saved results yet.<br/>Run an analysis to see it here.
              </div>
            )}
            <StaggerList key={nameItems.length}>
            {nameItems.map(group => {
              const allGroupRows = [];
              group.items.forEach(item => {
                if (item.type === 'single') allGroupRows.push(item.row);
                else item.rows.forEach(r => allGroupRows.push(r));
              });
              const totalReports = allGroupRows.length;
              const isConfirmingName = confirmNameId === group.name;
              const isDeletingName   = deletingName   === group.name;
              const nameSwatchEl = (
                <SwatchIcon inner={NAME_PAL.inner} accent={NAME_PAL.accent} />
              );
              const nameTextEl = (
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:NAME_PAL.accent, marginBottom:5 }}>
                    {totalReports} report{totalReports !== 1 ? "s" : ""}
                  </div>
                  <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, color:da.text, lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {group.name}
                  </div>
                </div>
              );
              return (
                <div key={group.name}
                  onClick={() => { if (!editing && !isDeletingName && !isConfirmingName) setNameView(group.name); }}
                  style={{
                    display:"flex", alignItems:"center", gap:16, boxSizing:"border-box",
                    background:RESULTS_CARD_BG, border:isConfirmingName ? "1.5px solid rgba(220,50,50,0.55)" : "1.5px solid transparent",
                    borderRadius:18, padding:"16px 18px",
                    color:da.text, width:"100%", position:"relative",
                    textAlign:"left", transition:"border-color 0.18s",
                    cursor: editing || isDeletingName || isConfirmingName ? "default" : "pointer",
                  }}
                >
                  <div style={{
                    display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0,
                    opacity: isDeletingName || isConfirmingName ? 0.3 : 1,
                    transform:"translateX(0)",
                    transition:"opacity 0.22s",
                    pointerEvents:"none",
                  }}>
                    {nameSwatchEl}{nameTextEl}
                  </div>
                  <div style={{
                    width:24, fontSize:20, color:da.faint, flexShrink:0, lineHeight:1,
                    textAlign:"center",
                    opacity: editing || isDeletingName || isConfirmingName ? 0 : 1,
                    transition:"opacity 0.2s ease",
                    pointerEvents:"none",
                  }}>›</div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmNameId(group.name); }} className="wc-btn"
                    style={{ position:"absolute", top:10, right:10, width:28, height:28, borderRadius:"50%",
                      background:"rgba(200,40,40,0.85)", border:"1.5px solid rgba(255,100,100,0.5)",
                      color:"#fff", fontSize:14, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", padding:0,
                      opacity: editing && !isDeletingName && !isConfirmingName ? 1 : 0,
                      transition:"opacity 0.2s",
                      pointerEvents: editing && !isDeletingName && !isConfirmingName ? "auto" : "none",
                      cursor:"pointer" }}
                    aria-label="Delete all for name">×</button>
                  {isDeletingName && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:20 }}><Dots color="rgba(255,255,255,0.4)" /></div>}
                  {isConfirmingName && !isDeletingName && (
                    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                      alignItems:"center", justifyContent:"center", gap:10, borderRadius:20, padding:"12px 18px",
                      background:"rgba(10,10,16,0.82)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", textAlign:"center" }}>Delete all {totalReports} reports for {group.name}?</div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteName(group.name, group); }} className="wc-btn"
                          style={{ background:"rgba(200,40,40,0.9)", border:"1px solid rgba(255,100,100,0.4)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:800, color:"#fff" }}>Delete all</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmNameId(null); }} className="wc-btn"
                          style={{ background:"rgba(255,255,255,0.10)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:999, padding:"7px 18px", fontSize:13, fontWeight:700, color:"#fff" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </StaggerList>
          </div>
        )}
      </div>
  );
  return drawerMode ? (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" }}>
      {mainInnerContent}
    </div>
  ) : (
    <Shell sec="upload" prog={0} total={0} contentAlign="start" hideProgressBar>
      {mainInnerContent}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// QUIZ CHALLENGE — data helpers
// ─────────────────────────────────────────────────────────────────

export async function fetchQuizChallenge(quizId) {
  try {
    const { data, error } = await supabase
      .from("quiz_challenges")
      .select("id, quiz_data, result_id, created_at")
      .eq("id", quizId)
      .single();
    if (error || !data) return null;
    return data;
  } catch { return null; }
}

export async function createQuizChallenge(resultId, mathData, signaturePhrase) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const quizData = {
      names:           mathData.names          || [],
      isGroup:         mathData.isGroup        || false,
      msgCounts:       mathData.msgCounts      || [],
      ghostName:       mathData.ghostName      || "",
      ghostAvg:        mathData.ghostAvg       || [],
      spiritEmoji:     mathData.spiritEmoji    || [],
      signatureWord:   mathData.signatureWord  || [],
      signaturePhrase: Array.isArray(signaturePhrase) ? signaturePhrase : [],
      streak:          mathData.streak         || 0,
      topWords:        (mathData.topWords      || []).slice(0, 6),
      totalMessages:   mathData.totalMessages  || 0,
    };
    const { data, error } = await supabase
      .from("quiz_challenges")
      .insert({ result_id: resultId || null, created_by: user.id, quiz_data: quizData })
      .select("id")
      .single();
    if (error || !data) return null;
    return `${window.location.origin}/quiz/${data.id}`;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────
// CHAT MEMORY QUIZ — standalone screen (no Shell chrome)
// ─────────────────────────────────────────────────────────────────

const QUIZ_SCORE_LABELS = ["Did you even read these messages? 😅", "A few lucky guesses.", "Getting warmer.", "Pretty solid.", "You know this chat well.", "You know this chat inside out. 🎯"];

function QuizOptionButton({ label, state, layout, onClick }) {
  const isGrid = layout === "grid";
  let bg     = "rgba(255,255,255,0.07)";
  let border = "1.5px solid rgba(255,255,255,0.14)";
  let color  = "rgba(255,255,255,0.88)";
  if (state === "correct")         { bg = "rgba(80,220,120,0.18)"; border = "1.5px solid rgba(80,220,120,0.55)"; color = "#fff"; }
  if (state === "wrong")           { bg = "rgba(255,80,80,0.15)";  border = "1.5px solid rgba(255,80,80,0.45)";  color = "#fff"; }
  if (state === "correct-other")   { bg = "rgba(80,220,120,0.09)"; border = "1.5px solid rgba(80,220,120,0.30)"; color = "rgba(255,255,255,0.55)"; }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== "idle"}
      className="wc-btn"
      style={{
        padding: isGrid ? "18px 8px" : "14px 18px",
        borderRadius: isGrid ? 16 : 999,
        border,
        background: bg,
        color,
        fontSize: isGrid ? 28 : 15,
        fontWeight: isGrid ? 400 : 700,
        cursor: state !== "idle" ? "default" : "pointer",
        fontFamily: "inherit",
        textAlign: "center",
        transition: "background 0.22s, border-color 0.22s",
        lineHeight: 1.3,
      }}
    >
      {label}
    </button>
  );
}

export function ChatMemoryQuiz({ quizId, onJoin }) {
  const t = useT();
  const [quizPhase, setQuizPhase] = useState("loading");
  const [quizRow,   setQuizRow]   = useState(null);
  const [questions, setQuestions] = useState([]);
  const [step,      setStep]      = useState(0);
  const [picked,    setPicked]    = useState(null);
  const [locked,    setLocked]    = useState(false);
  const [score,     setScore]     = useState(0);

  useEffect(() => {
    if (!quizId) { setQuizPhase("error"); return; }
    fetchQuizChallenge(quizId).then(row => {
      if (!row) { setQuizPhase("error"); return; }
      setQuizRow(row);
      setQuestions(buildQuizQuestions(row.quiz_data || {}));
      setQuizPhase("intro");
    });
  }, [quizId]);

  function handlePick(option) {
    if (locked) return;
    const q = questions[step];
    const correct = option === q.correct;
    setPicked(option);
    setLocked(true);
    if (correct) setScore(s => s + 1);
    setTimeout(() => {
      if (step + 1 >= questions.length) {
        setQuizPhase("score");
      } else {
        setStep(s => s + 1);
        setPicked(null);
        setLocked(false);
      }
    }, 1200);
  }

  // Finale palette — matches General Wrapped summary page
  const BG      = "#5E1228";
  const ACCENT  = "#F08EBF";
  const INNER   = "rgba(255,255,255,0.09)";
  const BORDER  = "rgba(255,255,255,0.12)";
  const PRIMARY = "#fff";
  const DIM     = "rgba(255,255,255,0.55)";
  const DIMMER  = "rgba(255,255,255,0.35)";

  // Stable outer shell — top-anchored so layout never shifts between phases
  const shell = {
    minHeight: "100dvh",
    background: BG,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 20px 56px",
    boxSizing: "border-box",
  };
  // Fixed-width column — always the same horizontal footprint
  const col = {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    gap: 20,
    paddingTop: 52,
  };

  // Shared wordmark header
  const wordmark = (
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:DIMMER, textAlign:"center" }}>
      WrapChat
    </div>
  );

  // Shared CTA button
  const ctaBtn = (label, onClick) => (
    <button type="button" onClick={onClick} className="wc-btn" style={{
      width:"100%", padding:"16px 20px", borderRadius:999,
      background:ACCENT, border:"none", color:BG,
      fontSize:16, fontWeight:800, cursor:"pointer",
      fontFamily:"inherit", letterSpacing:0.1,
    }}>
      {label}
    </button>
  );

  const names = quizRow?.quiz_data?.names || [];
  const total = quizRow?.quiz_data?.totalMessages || 0;

  // ── Loading ──
  if (quizPhase === "loading") {
    return (
      <div style={shell}>
        <div style={col}>
          {wordmark}
          <div style={{ textAlign:"center", color:DIM, fontSize:14, paddingTop:40 }}>Loading…</div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (quizPhase === "error" || !questions.length) {
    return (
      <div style={shell}>
        <div style={col}>
          {wordmark}
          <div style={{ background:INNER, border:`1px solid ${BORDER}`, borderRadius:24, padding:"28px 24px", textAlign:"center", display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ fontSize:20, fontWeight:800, color:PRIMARY }}>Quiz not found</div>
            <div style={{ fontSize:14, color:DIM, lineHeight:1.6 }}>This link may have expired or been removed.</div>
          </div>
          {ctaBtn(t("Try WrapChat"), onJoin)}
        </div>
      </div>
    );
  }

  // ── Intro ──
  if (quizPhase === "intro") {
    return (
      <div style={shell}>
        <div style={col}>
          {wordmark}
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:26, fontWeight:800, color:PRIMARY, lineHeight:1.25, letterSpacing:-0.5 }}>
              {names.join(" & ")}
            </div>
            {total > 0 && (
              <div style={{ fontSize:13, color:DIMMER, marginTop:6 }}>
                {total.toLocaleString()} messages analysed
              </div>
            )}
          </div>
          <div style={{ background:INNER, border:`1px solid ${BORDER}`, borderRadius:24, padding:"24px 22px", textAlign:"center", display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:20, fontWeight:800, color:PRIMARY, lineHeight:1.35 }}>
              Think you know this chat?
            </div>
            <div style={{ fontSize:14, color:DIM, lineHeight:1.6 }}>
              {questions.length} questions · takes about a minute
            </div>
          </div>
          {ctaBtn("Start the quiz →", () => setQuizPhase("question"))}
        </div>
      </div>
    );
  }

  // ── Question ──
  if (quizPhase === "question") {
    const q = questions[step];
    const isGrid = q.layout === "grid";
    const progress = (step + 1) / questions.length;
    return (
      <div style={shell}>
        <div style={col}>
          {wordmark}
          {/* Progress bar */}
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ fontSize:11, fontWeight:700, color:DIMMER, textAlign:"center", letterSpacing:"0.04em" }}>
              {step + 1} / {questions.length}
            </div>
            <div style={{ width:"100%", height:4, background:"rgba(255,255,255,0.12)", borderRadius:999 }}>
              <div style={{ width:`${progress * 100}%`, height:"100%", background:ACCENT, borderRadius:999, transition:"width 0.35s cubic-bezier(.4,0,.2,1)" }} />
            </div>
          </div>
          {/* Question card */}
          <div style={{ background:INNER, border:`1px solid ${BORDER}`, borderRadius:24, padding:"24px 22px", display:"flex", flexDirection:"column", gap:20 }}>
            <div style={{ fontSize:20, fontWeight:800, color:PRIMARY, textAlign:"center", lineHeight:1.35, letterSpacing:-0.3 }}>
              {q.text}
            </div>
            <div style={{
              display: isGrid ? "grid" : "flex",
              gridTemplateColumns: isGrid ? "1fr 1fr" : undefined,
              flexDirection: isGrid ? undefined : "column",
              gap: 10,
            }}>
              {q.options.map(option => {
                let state = "idle";
                if (locked) {
                  if (option === q.correct) state = picked === option ? "correct" : "correct-other";
                  else if (option === picked) state = "wrong";
                }
                return (
                  <QuizOptionButton
                    key={option}
                    label={option}
                    state={state}
                    layout={q.layout}
                    onClick={() => handlePick(option)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Score ──
  const labelIndex = Math.min(Math.floor((score / questions.length) * QUIZ_SCORE_LABELS.length), QUIZ_SCORE_LABELS.length - 1);
  return (
    <div style={shell}>
      <div style={col}>
        {wordmark}
        {/* Score */}
        <div style={{ background:INNER, border:`1px solid ${BORDER}`, borderRadius:24, padding:"32px 24px", textAlign:"center", display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:72, fontWeight:900, color:PRIMARY, lineHeight:1, letterSpacing:-3 }}>
            {score}<span style={{ fontSize:36, color:DIMMER, fontWeight:700 }}>/{questions.length}</span>
          </div>
          <div style={{ fontSize:15, color:DIM, lineHeight:1.55 }}>
            {QUIZ_SCORE_LABELS[labelIndex]}
          </div>
        </div>
        {/* Teaser */}
        {total > 0 && (
          <div style={{ background:INNER, border:`1px solid ${BORDER}`, borderRadius:20, padding:"16px 20px", textAlign:"center" }}>
            <div style={{ fontSize:13, color:DIM, lineHeight:1.6 }}>
              This chat has <strong style={{ color:PRIMARY }}>{total.toLocaleString()}</strong> messages between {names.join(" and ")}. Curious what your own chat reveals?
            </div>
          </div>
        )}
        {ctaBtn("Analyse your own chat — free", onJoin)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────
