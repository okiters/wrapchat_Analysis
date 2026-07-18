import { useState, useEffect, useLayoutEffect, useRef, createContext } from "react";
import { DA, getDA, ThemeContext, useTheme, PrimaryButton, GhostButton, BackIcon, ForwardIcon, setAppSafeAreaColor } from "./theme.jsx";
import { supabase } from "./supabase";
import { MIN_MESSAGES } from "./import/normalizedSchema";
import {
  buildCombinedDataset, buildDatasetFromParsedChat,
  detectOtherParticipantMismatches, toAnalysisMessagesFromDataset,
} from "./import/datasetBuilder";
import { applyApprovedMerges, normalizeDisplayName } from "./utils/identityMerge";
import {
  cacheUnlockedPacks, cacheUserCredits, cacheUserProfile, cacheUserResults,
  readUserDataCache, removeCachedResults, requestOnce, sameCachedValue, upsertCachedResult,
} from "./userDataCache";
import BrandLockup, { wrapchatLogoTransparent } from "./BrandLockup";
import AiDebugPanel from "../analysis-test/AiDebugPanel.jsx";
import {
  ACCESS_MODES, DEFAULT_ACCESS_MODE, getAccessMode, getAccessModeLabel, isOpenMode, setAccessMode,
} from "./accessMode";
import {
  CREDIT_BUNDLES, QUICK_READ_TRIAL_CONFIG, REPORT_PACKS, REPORT_PACK_ORDER,
  canUserRunReports, deductCreditsAmount, estimateAnalysesLeft, getCreditBundleById,
  getBundleMatch, getPackCreditCost, getReportCreditCost, getTotalCreditCostBundled,
  consumeReportPack, getUnlockedReportPacks, simulateCreditPurchase, unlockReportPacks,
} from "./reportCredits";
import {
  buildDebugAnalysisExport, createAiDebugFileName, createAiRawDebugFileName,
  downloadTextFile, downloadJsonFile, prepareConnectionDigestRequest,
  prepareCoreAnalysisARequest, prepareGrowthDigestRequest,
  prepareCoreAnalysisBRequest, prepareRiskDigestRequest, serializeDebugAnalysisExport,
} from "../analysis-test/aiDebugHelpers.js";
import { deriveTrialReport } from "./trialReport";

// ── i18n ──
import {
  LANG_META, UILanguageContext, useUILanguage, useT, useControlT,
  translateUI, normalizeUiLangCode, normalizeUiLangPref, resolveUiLang,
  isReliableDetectedLanguage, LANG_CONFIDENCE_MIN, detectLanguage,
} from "./i18n/translations";

// ── Analysis ──
import {
  capLargeGroup, localStats, userProvidedDisplayName, hasUserProvidedDisplayName,
  quickReadDaysLeft, quickReadExpiryLabel, getAuthConfirmationRedirectUrl,
  namesWithoutCurrentUser, compactNamesLabel, getParticipantDisplayTitle,
  detectParticipantConsistencyMismatch, detectDuoProfileNameMismatch,
  applyAutomaticParticipantMerges, getReviewableMergeSuggestions,
  DUO_CASUAL_SCREENS, GROUP_CASUAL_SCREENS, peekResolvedRelationshipContext,
  LOCAL_STATS_VERSION, buildRelationshipLine,
} from "./analysis/localMath";
import { userFacingAnalysisError, callAnalysis } from "./analysis/claudeClient";
import {
  aiAnalysis, aiToxicityAnalysis, aiLoveLangAnalysis, aiGrowthAnalysis,
  aiAccountaAnalysis, aiEnergyAnalysis, generateCoreAnalysisA, generateConnectionDigest,
  generateGrowthDigest, generateCoreAnalysisB, generateRiskDigest, generateTrialDigest,
  buildSampleText, buildStoredResultData, getStoredResultTranslations,
  getStoredResultDisplayLanguage, translateResultOverlay, REPORT_PIPELINES,
  CORE_ANALYSIS_CACHE_VERSION, getAnalysisFamilyCacheKey, formatForAI,
  getDisplayResultData, buildCoreASystemPrompt, CORE_ANALYSIS_VERSION,
  hasMeaningfulAnalysisResult, CORE_A_MAX_TOKENS, CORE_B_MAX_TOKENS, HOMEPAGE_VERSION,
} from "./analysis/aiAnalysis";

// ── UI ──
import {
  CloseResultsContext, ShareResultsContext, FeedbackContext,
  PAL, PACK_DEFS, PACK_ORDER, REPORT_TYPES, CREDIT_PACKS,
  reportTypeMeta, packForReports, packForSavedRows, normalizeSelectedReportTypes,
  buildShareCanvas, canShareFiles, downloadBlob, canvasToBlob,
  chatHealthLabel, getReportLaunchSec, prepaintReportLaunchSurface,
  SHELL_DRAWER_PADDING,
  SCREEN_CONTENT_STYLE,
  LEGAL_VERSION, TERMS_OF_SERVICE_TEXT, PRIVACY_POLICY_TEXT,
  SharePicker, Shell,
} from "./ui/Shell";
import {
  DuoScreen, GroupScreen, TrialReportScreen, CreditPackGrid, PricingCostOverview,
  TrialFinale, ToxicityReportScreen, LoveLangReportScreen, GrowthReportScreen,
  PromiseMomentCard, AccountaReportScreen, EnergyReportScreen, PremiumFinale, Finale,
  RelationshipSelect, Auth, OnboardingFlow, TermsFlow, ProfileNameSetup, QuickReadIntro,
  TooShort, DuplicateParticipantReview, ParticipantMismatchReview, ProfileNameMismatchReview,
  AdminLocked, Upload, Loading, SettingsScreen, PackSelect, PaymentScreen, PackResultsBuffer,
  UpgradePlaceholder, PostPurchaseBuffer, Slide, FadeScale, StaggerList, SlidingSegmentedTabs, AuthPhaseFade,
  AuthUploadFrame, AdminPanel, MyResults, ScoreRing,
  getUserProfile, initialiseUserCredits, consumeQuickReadTrial,
  deleteCurrentAccount, saveResult, submitFeedback,
  getUserCredits, postAuthPhaseForUser, shouldShowQuickReadIntro, parseCreditBalance,
  ENERGY_SCREENS, getEnergyScreenCount, FeedbackSheet,
  TRIAL_SCREENS, TOXICITY_SCREENS, LOVELANG_SCREENS, getLovelangScreenCount, GROWTH_SCREENS, ACCOUNTA_SCREENS,
  ChatMemoryQuiz, fetchQuizChallenge,
} from "./screens/Screens";

function isAdminUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

// Should a failed report generation be retried once? Only transient hiccups
// (timeouts, server blips, garbled/cut-off answers) are worth an immediate
// retry. "Out of credits" and "slow down" won't recover on retry, so we let
// those fail through. Matches the same signals userFacingAnalysisError reads.
function isRetryableAnalysisError(error) {
  const debug = error?.debug && typeof error.debug === "object" ? error.debug : null;
  const text = [
    error?.message,
    debug?.provider_error_message,
    debug?.provider_error_type,
    debug?.error,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text) return true; // an unlabelled throw is usually a transient blip
  // Never retry these — an immediate retry cannot fix them.
  if (/no_entitlement|rate_limited|rate_limit|too many requests|billing|quota|balance|credit|api_key|not set|invalid_request|model|not_found/.test(text)) {
    return false;
  }
  // Retry these — a second attempt very often succeeds.
  return /timed out|timeout|parse_failed|malformed|invalid_response_shape|output_limit_reached|empty|502|503|504|overloaded|failed to fetch|networkerror|load failed|edge function error 5/.test(text);
}

const ADMIN_EMAILS = Array.from(new Set(
  String(import.meta.env.VITE_ADMIN_EMAILS || import.meta.env.VITE_ADMIN_EMAIL || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
));



function getQuizIdFromUrl() {
  const m = window.location.pathname.match(/^\/quiz\/([a-zA-Z0-9-]+)$/);
  return m ? m[1] : null;
}

export default function App({ pendingImportedChat = null, onPendingImportedChatConsumed = () => {} }) {
  const [quizId,           setQuizId]           = useState(() => getQuizIdFromUrl());
  const [phase,            setPhase]            = useState(() => getQuizIdFromUrl() ? "quiz" : "auth");
  const [authedUser,       setAuthedUser]       = useState(null);
  const [credits,          setCredits]          = useState(null);
  const [quickReadAvailable, setQuickReadAvailable] = useState(false);
  const [quickReadExpiresAt, setQuickReadExpiresAt] = useState(null);
  const [userRole,         setUserRole]         = useState("user");
  const [accessMode,       setAccessModeState]  = useState(DEFAULT_ACCESS_MODE);
  const [messages,         setMessages]         = useState(null);
  const [math,             setMath]             = useState(null);
  const [ai,               setAi]               = useState(null);
  const [connectionDigest, setConnectionDigest] = useState(null);
  const [connectionDigestKey, setConnectionDigestKey] = useState("");
  const [coreAnalysisA,    setCoreAnalysisA]    = useState(null);
  const [coreAnalysisAKey, setCoreAnalysisAKey] = useState("");
  const [coreAnalysisB,    setCoreAnalysisB]    = useState(null);
  const [coreAnalysisBKey, setCoreAnalysisBKey] = useState("");
  const [aiLoading,        setAiLoading]        = useState(false);
  const [reportType,       setReportType]       = useState(null);
  const [selectedReportTypes, setSelectedReportTypes] = useState([]);
  const [loadingReportIndex, setLoadingReportIndex] = useState(0);
  const [relationshipType, setRelationshipType] = useState(null);
  const [reportLang,       setReportLang]       = useState("auto");  // explicit report/output language, or auto from chat
  const [detectedLang,     setDetectedLang]     = useState(null);  // { code, label, confidence }
  const [uiLangPref,       setUiLangPref]       = useState("en");
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("wrapchat_theme") || "dark"; } catch { return "dark"; } });
  const toggleTheme = () => setTheme(t => { const next = t === "dark" ? "light" : "dark"; try { localStorage.setItem("wrapchat_theme", next); } catch {} return next; });
  const [step,             setStep]             = useState(0);
  const [dir,              setDir]              = useState("fwd");
  const [sid,              setSid]              = useState(0);
  const [resultsOrigin,    setResultsOrigin]    = useState("upload"); // "upload" | "history"
  const [reportRouteState, setReportRouteState] = useState(null);
  const [historyBundleView, setHistoryBundleView] = useState(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [settingsReturnTarget, setSettingsReturnTarget] = useState("upload");
  const [sessionCompletedBundles, setSessionCompletedBundles] = useState({});
  const [unlockedPackIds, setUnlockedPackIds] = useState({});
  const [paymentPreselect, setPaymentPreselect] = useState(null);
  const [paymentBackPhase, setPaymentBackPhase] = useState("select");
  const [bufferTarget,     setBufferTarget]     = useState("select");
  const [paymentToast, setPaymentToast] = useState("");
  const [shareBusy,        setShareBusy]        = useState(false);
  const [sharePicker,      setSharePicker]      = useState(false);
  const [currentResultId,  setCurrentResultId]  = useState(null);
  const [feedbackTarget,   setFeedbackTarget]   = useState(null);
  const [feedbackChoice,   setFeedbackChoice]   = useState("");
  const [feedbackNote,     setFeedbackNote]     = useState("");
  const [feedbackBusy,     setFeedbackBusy]     = useState(false);
  const [feedbackThanks,   setFeedbackThanks]   = useState(false);
  const [uploadError,      setUploadError]      = useState("");
  const [uploadInfo,       setUploadInfo]       = useState("");
  const [pendingParsedInput,  setPendingParsedInput]  = useState(null);
  const [pendingSkipRelationship, setPendingSkipRelationship] = useState(false);
  const [upgradeInfo,      setUpgradeInfo]      = useState(null);
  const [analysisError,    setAnalysisError]    = useState("");
  const [importMeta,       setImportMeta]       = useState({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
  const [,                 setActiveDataset]    = useState(null);
  const [pendingDataset,   setPendingDataset]   = useState(null);
  const [participantMismatch, setParticipantMismatch] = useState(null);
  const [profileNameMismatch, setProfileNameMismatch] = useState(null);
  const [debugExportJson,  setDebugExportJson]  = useState("");
  const [debugRelType,     setDebugRelType]     = useState(null);
  const [debugRawText,     setDebugRawText]     = useState("");
  const [debugRawLabel,    setDebugRawLabel]    = useState("");
  const [debugRawBusy,     setDebugRawBusy]     = useState(false);
  const consumedImportRef   = useRef(null);
  const resolvedUiLang = resolveUiLang(uiLangPref, detectedLang?.code);
  const reportContentLang = reportLang === "auto"
    ? (isReliableDetectedLanguage(detectedLang) ? normalizeUiLangCode(detectedLang?.code) : "en")
    : normalizeUiLangCode(reportLang);
  const authedIsAdmin = isAdminUser(authedUser);
  const firstRunQuickReadActive = Boolean(
    authedUser
      && !authedIsAdmin
      && accessMode === "payments"
      && authedUser?.user_metadata?.quick_read_intro_completed !== true
      && (quickReadAvailable || credits == null)
  );

  useEffect(() => {
    setUiLangPref(normalizeUiLangPref(authedUser?.user_metadata?.ui_language));
  }, [authedUser]);

  useEffect(() => {
    // The public quiz page owns the page chrome (finale maroon); this theme
    // default must not overwrite it — App's effect runs after the child's.
    if (phase === "quiz" && quizId) return;
    const da = getDA(theme);
    setAppSafeAreaColor(da.bg);
    document.documentElement.style.setProperty(
      "--wc-scrollbar",
      theme === "light" ? "rgba(31,24,78,0.15)" : "rgba(255,255,255,0.15)"
    );
    document.documentElement.style.setProperty(
      "--wc-p",
      theme === "light" ? "122,144,255" : "127,91,176"
    );
  }, [theme, phase, quizId]);

  useEffect(() => {
    let cancelled = false;

    if (!authedUser) {
      setCredits(null);
      setQuickReadAvailable(false);
      setQuickReadExpiresAt(null);
      setUserRole("user");
      setUnlockedPackIds({});
      setUploadInfo("");
      return undefined;
    }

    if (authedIsAdmin) {
      setCredits(null);
      setQuickReadAvailable(false);
      setQuickReadExpiresAt(null);
      setUserRole("user");
      setUnlockedPackIds({});
      setUploadInfo("");
      return undefined;
    }

    const cached = readUserDataCache(authedUser.id);
    const cachedProfile = cached.profile || null;
    const cachedUnlocks = cached.unlockedPackIds || {};
    if (cachedProfile) {
      setCredits(cachedProfile.balance ?? null);
      setQuickReadAvailable(Boolean(cachedProfile.quickReadAvailable));
      setQuickReadExpiresAt(cachedProfile.quickReadExpiresAt || null);
      setUserRole(cachedProfile.role || "user");
      setUnlockedPackIds(cachedUnlocks);
      if (typeof cachedProfile.balance === "number" && cachedProfile.balance > 0) setUploadInfo("");
    }

    (async () => {
      try {
        const [{ balance, role, quickReadAvailable: hasQuickRead, quickReadExpiresAt: quickReadExpiry }, packUnlocks] = await Promise.all([
          requestOnce(`profile:${authedUser.id}`, getUserProfile),
          requestOnce(`unlocks:${authedUser.id}`, () => getUnlockedReportPacks(authedUser.id)),
        ]);
        if (cancelled) return;
        const nextProfile = { balance, role, quickReadAvailable: hasQuickRead, quickReadExpiresAt: quickReadExpiry };
        cacheUserProfile(authedUser.id, nextProfile);
        cacheUnlockedPacks(authedUser.id, packUnlocks);
        setCredits(prev => prev === balance ? prev : balance);
        setQuickReadAvailable(prev => prev === hasQuickRead ? prev : hasQuickRead);
        setQuickReadExpiresAt(prev => prev === quickReadExpiry ? prev : quickReadExpiry);
        setUserRole(prev => prev === role ? prev : role);
        setUnlockedPackIds(prev => sameCachedValue(prev, packUnlocks) ? prev : packUnlocks);
        if (typeof balance === "number" && balance > 0) setUploadInfo("");
      } catch (error) {
        if (cancelled) return;
        console.error("Credits or unlocks load failed", error);
        if (!cachedProfile) {
          setCredits(null);
          setQuickReadAvailable(false);
          setQuickReadExpiresAt(null);
          setUserRole("user");
          setUnlockedPackIds({});
        }
      }
    })();

    return () => { cancelled = true; };
  }, [authedIsAdmin, authedUser]);

  const updateUiLangPref = async (pref) => {
    const nextPref = normalizeUiLangPref(pref);
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), ui_language: nextPref } }
        : prev
    ));
    try {
      const { data } = await supabase.auth.updateUser({ data: { ui_language: nextPref } });
      if (data?.user) setAuthedUser(data.user);
    } catch {
      // Silent: preference changes should never interrupt the user flow.
    }
  };

  // Keep a ref so the visibilitychange handler always sees the current phase
  // without being re-registered on every render.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Batch-scoped core cache. The React-state caches below (connectionDigest
  // etc.) are read through a closure frozen at render time, so within a single
  // multi-report run their setters never update the values the running loop
  // sees — meaning reports that SHOULD share a core (general + lovelang, or
  // toxicity + accounta) each regenerated it instead. That doubled the API
  // cost AND created two independent failure points, so a transient hiccup on
  // one call silently dropped one of the pair from the bundle. A ref updates
  // synchronously and is readable in the next loop iteration, so shared-core
  // reports now truly share one generation (atomic: both succeed or both fail).
  const batchCoreCacheRef = useRef({});

  useEffect(() => {
    if (!feedbackThanks) return undefined;
    const t = setTimeout(() => setFeedbackThanks(false), 2000);
    return () => clearTimeout(t);
  }, [feedbackThanks]);

  useEffect(() => {
    if (!messages?.length) return;
    if (math?.analysisVersion === LOCAL_STATS_VERSION) return;

    try {
      const refreshed = localStats(messages);
      if (!refreshed) return;
      refreshed.cappedGroup = math?.cappedGroup ?? refreshed.cappedGroup;
      refreshed.originalParticipantCount = math?.originalParticipantCount ?? refreshed.originalParticipantCount;
      setMath(refreshed);
      setCurrentResultId(null);
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } catch (error) {
      console.error("Local stats refresh failed", error);
    }
  }, [math, messages]);

  // When the tab becomes visible again while stuck on the loading screen,
  // check if a result was already saved (e.g. the fetch completed in the
  // background) and restore it without asking the user to re-upload.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current !== "loading") return;
      if (selectedReportTypes.length > 1) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setAuthedUser(user);

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;

      const displayLang = getStoredResultDisplayLanguage(data.result_data);
      const sourceLang = normalizeUiLangCode(data.result_data?.sourceLanguage || displayLang);
      const displayResult = getDisplayResultData(data.result_data, displayLang);
      const canReuseCore = data.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;

      setAi(displayResult || {});
      if (canReuseCore && data.result_data?.coreAnalysis?.part === "connection") {
        const cacheFamily = data.report_type === "energy" ? "connection:energy" : "connection";
        setConnectionDigest(data.result_data.coreAnalysis);
        setConnectionDigestKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      } else if (canReuseCore && (data.result_data?.coreAnalysis?.part === "growth" || data.result_data?.coreAnalysis?.part === "a")) {
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(data.result_data.coreAnalysis);
        setCoreAnalysisAKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, "growth", sourceLang));
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      } else if (canReuseCore && (data.result_data?.coreAnalysis?.part === "risk" || data.result_data?.coreAnalysis?.part === "b")) {
        const cacheFamily = data.report_type === "accounta" ? "risk:accountability" : "risk";
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(data.result_data.coreAnalysis);
        setCoreAnalysisBKey(getAnalysisFamilyCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
      } else {
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
      }
      setMath(data.math_data || null);
      setReportType(data.report_type || null);
      setSelectedReportTypes(data.report_type ? [data.report_type] : []);
      setLoadingReportIndex(0);
      setCurrentResultId(data.id || null);
      setRelationshipType(displayResult?.relationshipType ?? null);
      setReportLang(displayLang);
      setAiLoading(false);
      setStep(0);
      setDir("fwd");
      setResultsOrigin("upload");
      setReportRouteState(null);
      setHistoryBundleView(null);
      setPhase("results");
      setSid(s => s + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [selectedReportTypes.length]); // registered once per batch-mode shape — reads phase via phaseRef

  // Check for an existing session on mount and listen for auth changes
  useEffect(() => {
    // Quiz mode bypasses auth routing entirely — the quiz is public
    if (quizId) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthedUser(session?.user || null);
      if (session?.user) {
        setStep(0);
        setDir("fade");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthedUser(session?.user || null);
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      if (session?.user) {
        if (event === "SIGNED_IN" && phaseRef.current === "auth") {
          setStep(0);
          setDir("fwd");
          const nextPhase = postAuthPhaseForUser(session.user);
          setPhase(nextPhase);
          // auth→upload stays inside AuthUploadFrame — AuthPhaseFade handles the
          // content swap internally, so Shell must NOT slide/fade the logo.
          if (nextPhase !== "upload") setSid(s => s + 1);
        }
      } else if (event === "SIGNED_OUT") {
        setStep(0);
        setDir("fwd");
        setPhase("auth");
        setSid(s => s + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authedUser) {
      setAccessModeState(DEFAULT_ACCESS_MODE);
      return;
    }

    let alive = true;
    requestOnce("access-mode", getAccessMode)
      .then(mode => {
        if (alive) setAccessModeState(mode);
      })
      .catch(error => {
        console.error("Access mode refresh failed", error);
        if (alive) setAccessModeState(DEFAULT_ACCESS_MODE);
      });

    return () => { alive = false; };
  }, [authedUser]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const handleAccountDeleted = () => {
    setAuthedUser(null);
    setCredits(null);
    setQuickReadAvailable(false);
    setQuickReadExpiresAt(null);
    setUserRole("user");
    setMessages(null);
    setMath(null);
    setAi(null);
    setConnectionDigest(null);
    setConnectionDigestKey("");
    setCoreAnalysisA(null);
    setCoreAnalysisAKey("");
    setCoreAnalysisB(null);
    setCoreAnalysisBKey("");
    setAiLoading(false);
    setReportType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setRelationshipType(null);
    setReportLang("auto");
    setDetectedLang(null);
    setStep(0);
    setDir("fade");
    setResultsOrigin("upload");
    setReportRouteState(null);
    setHistoryBundleView(null);
    setHistoryDrawerOpen(false);
    setSettingsReturnTarget("upload");
    setSessionCompletedBundles({});
    setUnlockedPackIds({});
    setPaymentPreselect(null);
    setPaymentBackPhase("select");
    setPaymentToast("");
    setShareBusy(false);
    setSharePicker(false);
    setCurrentResultId(null);
    setFeedbackTarget(null);
    setFeedbackChoice("");
    setFeedbackNote("");
    setFeedbackBusy(false);
    setFeedbackThanks(false);
    setUploadError("");
    setUploadInfo("");
    setUpgradeInfo(null);
    setAnalysisError("");
    setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
    setActiveDataset(null);
    setPendingDataset(null);
    setParticipantMismatch(null);
    setProfileNameMismatch(null);
    setDebugExportJson("");
    setDebugRelType(null);
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRawBusy(false);
    setPhase("auth");
    setSid(s => s + 1);
  };

  // Called when onboarding completes → proceed to terms acceptance
  const onOnboarded = (pref = "en") => {
    const nextPref = normalizeUiLangPref(pref);
    const userEmail = authedUser?.email || null;
    setUiLangPref(nextPref);
    setAuthedUser(prev => (
      prev
        ? { ...prev, user_metadata: { ...(prev.user_metadata || {}), has_onboarded: true, ui_language: nextPref } }
        : prev
    ));
    setStep(0);
    setDir("fwd");
    setPhase("terms");
    setSid(s => s + 1);

    void (async () => {
      try {
        const balance = await initialiseUserCredits(userEmail);
        setCredits(balance);
        cacheUserCredits(authedUser?.id, balance);
        const profile = await getUserProfile();
        setQuickReadAvailable(profile.quickReadAvailable);
        setQuickReadExpiresAt(profile.quickReadExpiresAt || null);
        setUserRole(profile.role);
        if (authedUser?.id) cacheUserProfile(authedUser.id, profile);
        if (authedUser?.id) {
          const packUnlocks = await getUnlockedReportPacks(authedUser.id);
          setUnlockedPackIds(packUnlocks);
          cacheUnlockedPacks(authedUser.id, packUnlocks);
        }
      } catch (error) {
        console.error("Initial credits setup failed", error);
      }
    })();
  };

  // Called when terms are accepted → proceed to upload
  const onAcceptedTerms = () => {
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setReportRouteState(null);
    setHistoryBundleView(null);
    setStep(0);
    setDir("fade");
    setPhase(hasUserProvidedDisplayName(authedUser) ? (shouldShowQuickReadIntro(authedUser) ? "quickReadIntro" : "upload") : "profileName");
    setSid(s => s + 1);
  };

  const onProfileNameSaved = (updatedUser) => {
    const nextUser = updatedUser || authedUser;
    if (updatedUser) setAuthedUser(updatedUser);
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setStep(0);
    setDir("fade");
    setPhase(shouldShowQuickReadIntro(nextUser) ? "quickReadIntro" : "upload");
    setSid(s => s + 1);
  };

  const onQuickReadIntroContinue = (updatedUser) => {
    if (updatedUser) setAuthedUser(updatedUser);
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setStep(0);
    setDir("fade");
    setPhase("upload");
    setSid(s => s + 1);
  };

  // Result cards cross-fade (old items fade out, next card builds in with the
  // opener choreography); other flows keep their directional slide.
  const go      = d => { setDir(phase === "results" ? "fade" : d); setSid(s => s+1); setStep(s => d==="fwd" ? s+1 : s-1); };
  const back    = () => go("bk");
  const next    = () => go("fwd");
  const restart = () => {
    setPhase("upload"); setMessages(null); setMath(null); setAi(null);
    setConnectionDigest(null); setConnectionDigestKey("");
    setCoreAnalysisA(null); setCoreAnalysisAKey("");
    setCoreAnalysisB(null); setCoreAnalysisBKey("");
    setAiLoading(false); setReportType(null); setRelationshipType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setCurrentResultId(null);
    setReportRouteState(null);
    setHistoryBundleView(null);
    setSessionCompletedBundles({});
    setPaymentPreselect(null);
    setPaymentBackPhase("select");
    setPaymentToast("");
    setFeedbackTarget(null); setFeedbackChoice(""); setFeedbackNote(""); setFeedbackBusy(false); setFeedbackThanks(false);
    setReportLang("auto"); setDetectedLang(null);
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
    setActiveDataset(null);
    setPendingDataset(null);
    setParticipantMismatch(null);
    setProfileNameMismatch(null);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRelType(null);
    setStep(0); setDir("fade"); setSid(s => s+1);
  };

  const resetImportDerivedState = () => {
    setUploadError("");
    setUploadInfo("");
    setAnalysisError("");
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setDebugRelType(null);
    setSelectedReportTypes([]);
    setLoadingReportIndex(0);
    setSessionCompletedBundles({});
  };

  const openPayment = (packId = null, backPhase = "select") => {
    setPaymentPreselect(packId);
    setPaymentBackPhase(backPhase || "select");
    setPaymentToast("");
    setDir("fwd");
    setPhase("payment");
    setSid(s => s + 1);
  };

  const openUnlockReads = (packId = null, backPhase = "select") => {
    const pack = packId ? PACK_DEFS[packId] : null;
    setUpgradeInfo({
      requiredCredits: pack?.cost ?? null,
      availableCredits: credits,
      accessMode,
      backPhase: backPhase || "select",
    });
    setAnalysisError("");
    setDir("fwd");
    setPhase("upgrade");
    setSid(s => s + 1);
  };

  // packs is an expanded list — one entry per unit bought, duplicates allowed
  // (buying the same pack 3x = three entries). Packs are consumable stock, so
  // owning one never blocks buying another; the DB increments quantity.
  const buyPacksWithCredits = async (packs) => {
    const selectedPacks = (Array.isArray(packs) ? packs : []).filter(pack => pack?.id && Array.isArray(pack.reports));
    if (!selectedPacks.length) return;
    const amount = selectedPacks.reduce((sum, pack) => sum + pack.cost, 0);

    let availableCredits = credits;
    try {
      availableCredits = await getUserCredits();
      setCredits(availableCredits);
      cacheUserCredits(authedUser?.id, availableCredits);
    } catch (error) {
      console.error("Credit check failed", error);
      setAnalysisError("Couldn't check your credits right now. Try again.");
      return;
    }

    if (availableCredits == null || availableCredits < amount) {
      setCredits(availableCredits);
      cacheUserCredits(authedUser?.id, availableCredits);
      setAnalysisError(`You need ${amount} credits to unlock ${selectedPacks.length === 1 ? "this read" : "these reads"}.`);
      return;
    }

    try {
      const unlockState = await unlockReportPacks(authedUser?.id, selectedPacks.map(pack => pack.id));
      setCredits(unlockState.balance);
      setUnlockedPackIds(unlockState.unlockedPackIds);
      cacheUserCredits(authedUser?.id, unlockState.balance);
      cacheUnlockedPacks(authedUser?.id, unlockState.unlockedPackIds);
    } catch (error) {
      console.error("Pack unlock credit deduction failed", error);
      setAnalysisError("Couldn't unlock these reads right now. Try again.");
      return;
    }

    setAnalysisError("");
    setUploadInfo("");
    setBufferTarget(upgradeInfo?.backPhase || (messages?.length && math ? "select" : "upload"));
    setUpgradeInfo(null);
    setDir("fwd");
    setPhase("unlockBuffer");
    setSid(s => s + 1);
  };

  const closePayment = () => {
    const target = paymentBackPhase || upgradeInfo?.backPhase || "select";
    setPaymentPreselect(null);
    setPaymentToast("");
    setAnalysisError("");
    setDir("bk");
    setPhase(target);
    setSid(s => s + 1);
  };

  const showPaymentComingSoon = () => {
    setPaymentToast("Payment coming soon");
    window.setTimeout(() => setPaymentToast(""), 1800);
  };

  const purchaseCredits = async (bundle) => {
    if (!bundle?.id || !authedUser?.id) return;
    const previousBalance = credits;
    const optimisticBalance = Number.isInteger(previousBalance)
      ? previousBalance + bundle.credits
      : null;
    if (optimisticBalance != null) {
      setCredits(optimisticBalance);
      cacheUserCredits(authedUser.id, optimisticBalance);
    }
    try {
      const nextBalance = await simulateCreditPurchase(authedUser.id, bundle.id);
      setCredits(nextBalance);
      cacheUserCredits(authedUser.id, nextBalance);
      setBufferTarget(paymentBackPhase || upgradeInfo?.backPhase || "select");
      setPaymentPreselect(null);
      setPaymentToast("");
      setDir("fwd");
      setPhase("creditsBuffer");
      setSid(s => s + 1);
    } catch (error) {
      console.error("Credit purchase failed", error);
      if (Number.isInteger(previousBalance)) {
        setCredits(previousBalance);
        cacheUserCredits(authedUser.id, previousBalance);
      }
      setPaymentToast("Couldn't add credits right now");
      window.setTimeout(() => setPaymentToast(""), 1800);
    }
  };

  const continueWithDataset = (dataset, { skipMismatch = false, skipRelationship = false } = {}) => {
    const mismatch = skipMismatch ? null : detectParticipantConsistencyMismatch(dataset, authedUser);
    if (mismatch) {
      setPendingDataset(dataset);
      setParticipantMismatch(mismatch);
      setDir("fwd");
      setPhase("participantMismatch");
      setSid(s => s + 1);
      return;
    }

    const msgs = toAnalysisMessagesFromDataset(dataset);
    const tooShort = msgs.length < MIN_MESSAGES;
    const summary = {
      participants: dataset.participants.map(participant => participant.displayName),
      participantLabel: getParticipantDisplayTitle(dataset, null, authedUser),
      messageCount: msgs.length,
      dateRange: dataset.sourceChats?.[0]?.dateRange || [msgs[0]?.date || null, msgs.at(-1)?.date || null],
      dateRangeLabel: dataset.sourceChats?.length > 1 ? `${dataset.sourceChats.length} chats combined` : undefined,
    };
    const fileName = dataset.sourceChats?.[0]?.fileName || null;

    setImportMeta({
      fileName,
      summary,
      rawProcessedPayload: { messages: msgs, tooShort },
      tooShort,
      dataset: {
        datasetId: dataset.datasetId,
        datasetKind: dataset.datasetKind,
        sourceChatCount: dataset.combinedMeta?.sourceChatCount || 1,
        displayTitle: getParticipantDisplayTitle(dataset, null, authedUser),
      },
    });
    if (tooShort) {
      setDir("fwd");
      setPhase("tooshort");
      setSid(s => s + 1);
      return;
    }
    // Yield to the browser's render cycle so "Reading your chat…" appears
    // before the heavy synchronous computation blocks the main thread.
    setTimeout(() => {
      try {
        const { messages: cappedMsgs, cappedGroup, originalParticipantCount } = capLargeGroup(msgs);
        const m = localStats(cappedMsgs);
        if (m) {
          m.cappedGroup = cappedGroup;
          m.originalParticipantCount = originalParticipantCount;
          m.datasetId = dataset.datasetId;
          m.datasetKind = dataset.datasetKind;
          m.sourceChatCount = dataset.combinedMeta?.sourceChatCount || 1;
          m.displayTitle = getParticipantDisplayTitle(dataset, m, authedUser);
          m.participantAliases = dataset.participantAliases;
          m.mergeState = dataset.mergeState;
          m.sourceChats = dataset.sourceChats;
          m.combinedMeta = dataset.combinedMeta;
        }
        const detected = detectLanguage(cappedMsgs);
        setDetectedLang(detected);
        setMessages(cappedMsgs);
        setMath(m);
        setActiveDataset(dataset);
        setPendingDataset(null);
        setParticipantMismatch(null);
        setProfileNameMismatch(null);
        setAi(null);
        setConnectionDigest(null);
        setConnectionDigestKey("");
        setCoreAnalysisA(null);
        setCoreAnalysisAKey("");
        setCoreAnalysisB(null);
        setCoreAnalysisBKey("");
        setRelationshipType(null);
        setSelectedReportTypes([]);
        setLoadingReportIndex(0);
        setCurrentResultId(null);
        setReportRouteState(null);
        setHistoryBundleView(null);
        setDebugRelType(null);
        const nameWarning = detectDuoProfileNameMismatch(m, authedUser);
        const nextPhase = m?.isGroup ? "select" : (skipRelationship ? "select" : "relationship");
        setDir("fwd");
        if (nameWarning) {
          setProfileNameMismatch({ ...nameWarning, nextPhase });
          setPhase("profileNameMismatch");
        } else {
          setPhase(nextPhase);
        }
        setSid(s => s+1);
      } catch (error) {
        console.error("Post-parse analysis failed", error);
        setMessages(null);
        setMath(null);
        setDetectedLang(null);
        setImportMeta({ fileName: null, summary: null, rawProcessedPayload: null, tooShort: false });
        setActiveDataset(null);
        setPendingDataset(null);
        setParticipantMismatch(null);
        setProfileNameMismatch(null);
        setUploadError("Couldn't finish reading this chat. Try exporting again or using a shorter date range.");
        setDir("fade");
        setPhase("upload");
        setSid(s => s + 1);
      }
    }, 0);
  };

  // Step 1: file parsed → normalize identity, review merges, then compute stats
  const onParsed = (parsedInput) => {
    resetImportDerivedState();
    setPendingSkipRelationship(false);
    try {
      const isMultiUpload = Array.isArray(parsedInput?.parsedChats);
      const rawDataset = isMultiUpload
        ? buildCombinedDataset(parsedInput.parsedChats)
        : buildDatasetFromParsedChat(parsedInput);
      const dataset = applyAutomaticParticipantMerges(rawDataset);
      if (!isMultiUpload) setPendingParsedInput(parsedInput);
      else setPendingParsedInput(null);
      if (getReviewableMergeSuggestions(dataset).length) {
        setPendingDataset(dataset);
        setParticipantMismatch(null);
        setDir("fwd");
        setPhase("mergeReview");
        setSid(s => s + 1);
        return;
      }
      continueWithDataset(dataset);
    } catch (error) {
      console.error("Dataset preparation failed", error);
      setUploadError(String(error?.message || "Couldn't finish reading this chat. Try exporting again or using a shorter date range."));
      setDir("fade");
      setPhase("upload");
      setSid(s => s + 1);
    }
  };

  const onMergeReviewContinue = (approvedIds) => {
    const dataset = pendingDataset;
    if (!dataset) {
      setPhase("upload");
      return;
    }
    const mergedDataset = applyApprovedMerges(dataset, approvedIds, dataset.mergeState?.suggestions || []);
    const skip = pendingSkipRelationship;
    setPendingSkipRelationship(false);
    continueWithDataset(mergedDataset, { skipRelationship: skip });
  };

  const onParticipantMismatchContinue = () => {
    if (!pendingDataset) {
      setPhase("upload");
      return;
    }
    const skip = pendingSkipRelationship;
    setPendingSkipRelationship(false);
    continueWithDataset(pendingDataset, { skipMismatch: true, skipRelationship: skip });
  };

  const onProfileNameMismatchContinue = () => {
    const nextPhase = profileNameMismatch?.nextPhase || (math?.isGroup ? "select" : "relationship");
    setProfileNameMismatch(null);
    setDir("fwd");
    setPhase(nextPhase);
    setSid(s => s + 1);
  };

  useEffect(() => {
    if (!pendingImportedChat?.id || !pendingImportedChat.payload) return;
    if (consumedImportRef.current === pendingImportedChat.id) return;
    if (!authedUser || phase !== "upload") return;

    consumedImportRef.current = pendingImportedChat.id;
    onParsed(pendingImportedChat.payload);
    onPendingImportedChatConsumed(pendingImportedChat.id);
  }, [authedUser, onPendingImportedChatConsumed, pendingImportedChat, phase]);

  const generatePipelineResult = async (type, relType, contentLang = reportContentLang) => {
    const pipeline = REPORT_PIPELINES[type];
    const lang = normalizeUiLangCode(contentLang);

    if (pipeline?.strategy === "trial") {
      return await generateTrialDigest(messages, math, relType, lang);
    }

    if (pipeline?.strategy !== "family") return {};

    const family = pipeline.family || "connection";
    const cacheFamily =
      type === "energy" && family === "connection" ? "connection:energy" :
      type === "accounta" && family === "risk" ? "risk:accountability" :
      family;
    const cacheKey = getAnalysisFamilyCacheKey(math, relType, cacheFamily, lang);

    // Ref cache first (survives across loop iterations in the same batch, which
    // the frozen-closure state reads below cannot), then the React-state cache
    // (survives across separate runs), then generate.
    let core = batchCoreCacheRef.current[cacheKey] || null;

    if (!core && family === "connection") {
      core = connectionDigestKey === cacheKey ? connectionDigest : null;
      if (!core) {
        core = await generateConnectionDigest(messages, math, relType, lang, { energyFocus: type === "energy" });
        setConnectionDigest(core);
        setConnectionDigestKey(cacheKey);
      }
    } else if (!core && family === "growth") {
      core = coreAnalysisAKey === cacheKey ? coreAnalysisA : null;
      if (!core) {
        core = await generateGrowthDigest(messages, math, relType, lang);
        setCoreAnalysisA(core);
        setCoreAnalysisAKey(cacheKey);
      }
    } else if (!core && family === "risk") {
      core = coreAnalysisBKey === cacheKey ? coreAnalysisB : null;
      if (!core) {
        core = await generateRiskDigest(messages, math, relType, lang, { accountabilityFocus: type === "accounta" });
        setCoreAnalysisB(core);
        setCoreAnalysisBKey(cacheKey);
      }
    }
    if (core) batchCoreCacheRef.current[cacheKey] = core;

    const derived = pipeline.derive(core, math, relType);
    if (!hasMeaningfulAnalysisResult(type, derived)) {
      // Log quality warning but return the partial result so the frontend can still render.
      // Cards with empty AI fields will show placeholder "—" values rather than aborting entirely.
      console.warn(`[generatePipelineResult] low-quality result for "${type}" — rendering partial`);
    }
    return derived;
  };

  const restoreGeneratedResult = (type, result, savedId = null) => {
    const displayLang = result ? getStoredResultDisplayLanguage(result) : "en";
    if (!result) return false;
    prepaintReportLaunchSurface(type);
    setReportType(type);
    setSelectedReportTypes([type]);
    setLoadingReportIndex(0);
    setAi(getDisplayResultData(result, displayLang));
    setCurrentResultId(savedId || null);
    setAiLoading(false);
    setResultsOrigin("upload");
    setReportRouteState(null);
    setHistoryBundleView(null);
    if (typeof window !== "undefined") {
      window.history.pushState({ wrapchatPhase: "results" }, "", window.location.href);
    }
    setDir("fwd");
    setPhase("results");
    setStep(0);
    setSid(s => s + 1);
    return true;
  };

  const deductCreditsBatch = async (types, mode = accessMode, amountOverride = null) => {
    const selectedTypes = normalizeSelectedReportTypes(Array.isArray(types) ? types : [types]).filter(type => type && type !== QUICK_READ_TRIAL_CONFIG.reportId);
    if (authedIsAdmin || isOpenMode(mode) || !selectedTypes.length) return;
    try {
      const completedPack = packForReports(selectedTypes) || (selectedTypes.length === 1 && selectedTypes[0] === "growth" ? PACK_DEFS.growth : null);
      if (completedPack) {
        const unlockState = await unlockReportPacks(authedUser?.id, [completedPack.id]);
        setCredits(unlockState.balance);
        setUnlockedPackIds(unlockState.unlockedPackIds);
        cacheUserCredits(authedUser?.id, unlockState.balance);
        cacheUnlockedPacks(authedUser?.id, unlockState.unlockedPackIds);
        return;
      }

      const parsedOverride = parseCreditBalance(amountOverride);
      const amount = parsedOverride != null ? parsedOverride : getTotalCreditCostBundled(selectedTypes);
      const nextBalance = await deductCreditsAmount(authedUser?.id, amount);
      setCredits(nextBalance);
      cacheUserCredits(authedUser?.id, nextBalance);
    } catch (error) {
      console.error("Credit deduction failed", error);
      throw error;
    }
  };

  const failBackToSelection = (message) => {
    const fallbackPhase = math?.isGroup ? "select" : "relationship";
    setAnalysisError(message);
    setAiLoading(false);
    setDir("bk");
    setPhase(fallbackPhase);
    setStep(0);
    setSid(s => s + 1);
  };

  // Run AI analysis with the selected report type(s) and relationship type
  const runAnalysis = async (types, relType, options = {}) => {
    const selectedTypes = normalizeSelectedReportTypes(Array.isArray(types) ? types : [types]).filter(Boolean);
    const isQuickReadRun = selectedTypes.length === 1 && selectedTypes[0] === QUICK_READ_TRIAL_CONFIG.reportId;
    const contentLang = reportContentLang;
    const creditCostOverride = parseCreditBalance(options?.creditCostOverride);
    const bundleNameOverride = String(options?.bundleNameOverride || "").trim();
    const skipCreditDeduction = Boolean(options?.skipCreditDeduction);
    const consumePackIds = Array.isArray(options?.consumePackIds) ? options.consumePackIds.filter(Boolean) : [];
    setAnalysisError("");
    if (!selectedTypes.length) {
      setAnalysisError("Choose at least one report.");
      return;
    }

    let activeAccessMode = accessMode;
    try {
      activeAccessMode = await requestOnce("access-mode:strict", () => getAccessMode({ throwOnError: true }));
      setAccessModeState(activeAccessMode);
    } catch (error) {
      console.error("Access mode check failed", error);
      activeAccessMode = DEFAULT_ACCESS_MODE;
      setAccessModeState(DEFAULT_ACCESS_MODE);
    }

    if (isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode) && !quickReadAvailable) {
      const message = "Your Quick Read has already been used. Credits are required for everything else.";
      setUpgradeInfo({
        message,
        requiredCredits: PACK_DEFS.growth.cost,
        availableCredits: credits,
        accessMode: activeAccessMode,
        backPhase: "select",
      });
      setAnalysisError(message);
      setStep(0);
      setDir("bk");
      setPhase("upgrade");
      setSid(s => s + 1);
      return;
    }

    let verifiedCreditBalance = credits;
    if (!isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode) && !skipCreditDeduction) {
      let availableCredits = credits;
      try {
        availableCredits = await getUserCredits();
        verifiedCreditBalance = availableCredits;
        setCredits(availableCredits);
        cacheUserCredits(authedUser?.id, availableCredits);
      } catch (error) {
        console.error("Credit check failed", error);
        availableCredits = null;
        if (credits == null) setCredits(null);
      }

      const access = creditCostOverride != null
        ? {
            allowed: availableCredits != null && availableCredits >= creditCostOverride,
            requiredCredits: creditCostOverride,
            availableCredits,
            message: activeAccessMode === "payments"
              ? "You need more credits to unlock this read."
              : `You need ${creditCostOverride} credits to run ${selectedTypes.length === 1 ? "this report" : "these reports"}.`,
          }
        : canUserRunReports({
            ...authedUser,
            role: authedIsAdmin ? "admin" : authedUser?.role,
            credits: availableCredits,
          }, selectedTypes, activeAccessMode);

      if (!access.allowed) {
        setUpgradeInfo({
          message: access.message,
          requiredCredits: access.requiredCredits,
          availableCredits,
          accessMode: activeAccessMode,
          backPhase: "select",
        });
        setAnalysisError(access.message);
        setStep(0);
        setDir("bk");
        setPhase("upgrade");
        setSid(s => s + 1);
        return;
      }
    }

    const runCreditCost = creditCostOverride != null ? creditCostOverride : getTotalCreditCostBundled(selectedTypes);
    const optimisticCreditStart = verifiedCreditBalance;
    const shouldOptimisticallyDecrement = !isQuickReadRun
      && !authedIsAdmin
      && !isOpenMode(activeAccessMode)
      && !skipCreditDeduction
      && runCreditCost > 0
      && Number.isInteger(verifiedCreditBalance);
    const matchedBundle = getBundleMatch(selectedTypes);
    const bundleName = bundleNameOverride
      || (matchedBundle?.label
      ?? (selectedTypes.length > 1
        ? selectedTypes.map(type => REPORT_TYPES.find(r => r.id === type)?.label || type).join(" + ")
        : null));

    setUploadInfo("");
    setUpgradeInfo(null);
    setStep(0);
    setDir("fwd");
    prepaintReportLaunchSurface(selectedTypes[0]);
    setPhase("loading");
    setSid(s => s+1);
    setAiLoading(true);
    setAi(null);
    setSelectedReportTypes(selectedTypes);
    setLoadingReportIndex(0);
    setCurrentResultId(null);
    setReportRouteState(null);
    setHistoryBundleView(null);
    if (shouldOptimisticallyDecrement) {
      const optimisticBalance = Math.max(verifiedCreditBalance - runCreditCost, 0);
      setCredits(optimisticBalance);
      cacheUserCredits(authedUser?.id, optimisticBalance);
    }
    const bundleId = selectedTypes.length > 1 ? crypto.randomUUID() : null;
    // Fresh per-batch core cache — never carry a core from a previous run or a
    // different chat into this one.
    batchCoreCacheRef.current = {};
    const generatedRuns = [];
    const failedTypes = [];
    let firstAnalysisError = null;

    for (let index = 0; index < selectedTypes.length; index += 1) {
      const type = selectedTypes[index];
      setReportType(type);
      setLoadingReportIndex(index);

      try {
        let canonicalResult;
        try {
          // eslint-disable-next-line no-await-in-loop
          canonicalResult = await generatePipelineResult(type, relType, contentLang);
        } catch (firstError) {
          // One retry, but only for transient hiccups (timeouts, server blips,
          // garbled answers). Never for "out of credits" or "slow down" — those
          // won't recover on an immediate retry and would just waste the call.
          if (!isRetryableAnalysisError(firstError)) throw firstError;
          console.warn(`Report "${type}" hiccupped, retrying once…`, firstError?.message || firstError);
          // eslint-disable-next-line no-await-in-loop
          canonicalResult = await generatePipelineResult(type, relType, contentLang);
        }
        let translationOverlay = null;
        if (type === "trial_report" && contentLang !== "en") {
          try {
            // eslint-disable-next-line no-await-in-loop
            translationOverlay = await translateResultOverlay(type, canonicalResult, contentLang);
          } catch (translationError) {
            console.error(`Translation failed for report "${type}" [lang=${contentLang}]`, translationError);
          }
        }
        const sourceLang = type === "trial_report" ? "en" : contentLang;
        const resultLang = translationOverlay ? contentLang : sourceLang;
        const result = buildStoredResultData(canonicalResult, resultLang, translationOverlay, sourceLang);
        if (!result) {
          failedTypes.push(type);
          continue;
        }
        generatedRuns.push({ type, result });
      } catch (error) {
        console.error(`Analysis failed for report "${type}" [lang=${contentLang}]`, error);
        if (!firstAnalysisError) firstAnalysisError = error;
        failedTypes.push(type);
      }
    }

    if (!generatedRuns.length) {
      if (shouldOptimisticallyDecrement) {
        setCredits(optimisticCreditStart);
        cacheUserCredits(authedUser?.id, optimisticCreditStart);
      }
      failBackToSelection(failedTypes.length ? userFacingAnalysisError(firstAnalysisError || new Error("Batch analysis failed.")) : "The AI analysis didn't return a usable result. Please try again.");
      return;
    }

    // Charge before anything is persisted — a failed deduction must not leave
    // free reports sitting in history.
    if (!skipCreditDeduction) {
      try {
        await deductCreditsBatch(generatedRuns.map(run => run.type), activeAccessMode, runCreditCost);
      } catch {
        if (shouldOptimisticallyDecrement) {
          setCredits(optimisticCreditStart);
          cacheUserCredits(authedUser?.id, optimisticCreditStart);
        }
        failBackToSelection("Couldn't complete your unlock. No credits were used and nothing was saved. Please try again.");
        return;
      }
    }

    const successfulRuns = [];
    for (const run of generatedRuns) {
      const creditMeta = {
        reportTypes: selectedTypes,
        creditCost: getReportCreditCost(run.type),
        totalRunCreditCost: runCreditCost,
        bundleName,
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const saved = await saveResult(run.type, run.result, math, bundleId, creditMeta);
        successfulRuns.push({ ...run, savedId: saved?.id || null });
      } catch (error) {
        // The user already paid — keep the result usable in this session even
        // if persistence failed.
        console.error(`Saving report "${run.type}" failed`, error);
        successfulRuns.push({ ...run, savedId: null });
      }
    }
    if (consumePackIds.length && authedUser?.id && !authedIsAdmin) {
      try {
        let updatedUnlocks = unlockedPackIds;
        for (const packId of consumePackIds) {
          updatedUnlocks = await consumeReportPack(authedUser.id, packId);
        }
        setUnlockedPackIds(updatedUnlocks);
        cacheUnlockedPacks(authedUser.id, updatedUnlocks);
      } catch (error) {
        console.error("Pack consume failed", error);
      }
    }
    if (isQuickReadRun && !authedIsAdmin && !isOpenMode(activeAccessMode)) {
      try {
        await consumeQuickReadTrial(authedUser?.id);
        setQuickReadAvailable(false);
        void supabase.auth.updateUser({
          data: {
            quick_read_intro_completed: true,
            quick_read_intro_completed_at: new Date().toISOString(),
          },
        }).then(({ data }) => {
          if (data?.user) setAuthedUser(data.user);
        });
        cacheUserProfile(authedUser?.id, {
          ...(readUserDataCache(authedUser?.id).profile || {}),
          quickReadAvailable: false,
          quickReadExpiresAt,
        });
      } catch (error) {
        console.error("Quick Read entitlement update failed", error);
      }
    }

    const completedPack = packForReports(successfulRuns.map(run => run.type));
    if (completedPack) {
      setSessionCompletedBundles(prev => ({
        ...prev,
        [completedPack.id]: completedPack.id === "growth"
          ? { savedId: successfulRuns[0]?.savedId || null }
          : { savedIds: successfulRuns.map(run => run.savedId).filter(Boolean) },
      }));
    }

    if (successfulRuns.length === 1) {
      const only = successfulRuns[0];
      restoreGeneratedResult(only.type, only.result, only.savedId);
      return;
    }

    setAiLoading(false);
    setResultsOrigin("history");
    setReportRouteState(null);
    setHistoryBundleView(bundleId);
    setDir("fwd");
    setPhase("history");
    setStep(0);
    setSid(s => s + 1);
  };

  // Step 2: user toggles one or more reports, then runs them together
  const onToggleReport = (type) => {
    setAnalysisError("");
    setSelectedReportTypes(prev => {
      const next = prev.includes(type)
        ? prev.filter(item => item !== type)
        : [...prev, type];
      return normalizeSelectedReportTypes(next);
    });
  };

  const onSelectBundle = (reportTypes) => {
    setAnalysisError("");
    setSelectedReportTypes(normalizeSelectedReportTypes(reportTypes));
  };

  const onRunSelectedReports = () => {
    setAnalysisError("");
    runAnalysis(selectedReportTypes, math?.isGroup ? null : relationshipType);
  };

  const onRunPack = (pack) => {
    if (!pack?.reports?.length) return;
    const owned = Boolean(unlockedPackIds?.[pack.id]);
    setAnalysisError("");
    setSelectedReportTypes(pack.reports);
    runAnalysis(pack.reports, math?.isGroup ? null : relationshipType, owned ? {
      skipCreditDeduction: true,
      creditCostOverride: 0,
      bundleNameOverride: pack.name,
      consumePackIds: [pack.id],
    } : {});
  };

  const onRunQuickRead = () => {
    if (!quickReadAvailable) {
      setAnalysisError("Your free Quick Read is no longer available.");
      return;
    }
    setAnalysisError("");
    setSelectedReportTypes([QUICK_READ_TRIAL_CONFIG.reportId]);
    runAnalysis([QUICK_READ_TRIAL_CONFIG.reportId], math?.isGroup ? null : relationshipType);
  };

  // Step 3 (duo only): user picks relationship type → then choose report type
  const buildCombinedAndContinue = (relType, extraParsedChats) => {
    setRelationshipType(relType);
    setDebugRelType(relType);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    setAnalysisError("");
    const allParsedChats = [pendingParsedInput, ...extraParsedChats].filter(Boolean);
    setPendingParsedInput(null);
    try {
      const dataset = applyAutomaticParticipantMerges(buildCombinedDataset(allParsedChats));
      if (getReviewableMergeSuggestions(dataset).length) {
        setPendingDataset(dataset);
        setParticipantMismatch(null);
        setPendingSkipRelationship(true);
        setDir("fwd");
        setPhase("mergeReview");
        setSid(s => s + 1);
        return;
      }
      continueWithDataset(dataset, { skipRelationship: true });
    } catch (error) {
      console.error("Combined dataset preparation failed", error);
      setAnalysisError(String(error?.message || "Couldn't combine the chats. Try exporting again."));
      setDir("fade");
      setPhase("relationship");
      setSid(s => s + 1);
    }
  };

  const onSelectRelationship = (relType, extraParsedChats = []) => {
    setAnalysisError("");
    setDebugRelType(relType);
    setDebugExportJson("");
    setDebugRawText("");
    setDebugRawLabel("");
    if (extraParsedChats.length > 0 && pendingParsedInput) {
      buildCombinedAndContinue(relType, extraParsedChats);
      return;
    }
    setRelationshipType(relType);
    setDir("fwd");
    setPhase("select");
    setSid(s => s+1);
  };

  const buildAdminAiDebugRequests = () => {
    if (!messages?.length || !math) return null;

    const contentLang = reportContentLang;
    const selectedRelationshipType = math.isGroup ? null : (relationshipType || debugRelType || null);
    if (!math.isGroup && !selectedRelationshipType) return null;

    const relationshipContext = !math.isGroup
      ? peekResolvedRelationshipContext(messages, math.names || [], selectedRelationshipType)
      : null;

    const connectionRequest = prepareConnectionDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt: buildCoreASystemPrompt,
      buildRelationshipLine,
      buildSampleText,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_A_MAX_TOKENS,
    });

    const growthRequest = prepareGrowthDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt: buildCoreASystemPrompt,
      buildRelationshipLine,
      formatForAI,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_A_MAX_TOKENS,
    });

    const riskRequest = prepareRiskDigestRequest({
      messages,
      math,
      relationshipType: selectedRelationshipType,
      chatLang: contentLang,
      relationshipContext,
      buildAnalystSystemPrompt: buildCoreASystemPrompt,
      buildRelationshipLine,
      buildSampleText,
      coreAnalysisVersion: CORE_ANALYSIS_VERSION,
      maxTokens: CORE_B_MAX_TOKENS,
    });

    return {
      selectedRelationshipType,
      relationshipContext,
      connectionRequest,
      growthRequest,
      riskRequest,
    };
  };

  const buildLocalAiDebugExport = () => {
    const debugRequests = buildAdminAiDebugRequests();
    if (!debugRequests) return "";
    const {
      selectedRelationshipType,
      relationshipContext,
      connectionRequest,
      growthRequest,
      riskRequest,
    } = debugRequests;

    const exportPayload = buildDebugAnalysisExport({
      fileName: importMeta.fileName,
      rawProcessedPayload: importMeta.rawProcessedPayload,
      messages,
      math,
      detectedLanguage: detectedLang,
      relationshipType: selectedRelationshipType,
      relationshipContext,
      relationshipLine: connectionRequest.relationshipLine || growthRequest.relationshipLine || riskRequest.relationshipLine || "",
      tooShort: importMeta.tooShort,
      summary: importMeta.summary,
      analysisVersions: {
        localStats: LOCAL_STATS_VERSION,
        coreAnalysis: CORE_ANALYSIS_VERSION,
        analysisCacheVersion: CORE_ANALYSIS_CACHE_VERSION,
        homepageVersion: HOMEPAGE_VERSION,
      },
      requests: {
        connection: connectionRequest,
        growth: growthRequest,
        risk: riskRequest,
      },
    });

    const jsonText = serializeDebugAnalysisExport(exportPayload);
    setDebugExportJson(jsonText);
    return jsonText;
  };

  const copyLocalAiDebugExport = async () => {
    const jsonText = debugExportJson || buildLocalAiDebugExport();
    if (!jsonText) return;
    try {
      await navigator.clipboard.writeText(jsonText);
    } catch (error) {
      console.error("Debug JSON copy failed", error);
    }
  };

  const downloadLocalAiDebugExport = () => {
    const jsonText = debugExportJson || buildLocalAiDebugExport();
    if (!jsonText) return;
    downloadJsonFile(jsonText, createAiDebugFileName(importMeta.fileName));
  };

  const runRawAiDebugExport = async (pipeline = "coreA") => {
    const debugRequests = buildAdminAiDebugRequests();
    if (!debugRequests) return;

    const normalizedPipeline = pipeline === "coreB" ? "risk" : (pipeline === "growth" ? "growth" : "connection");
    const request = normalizedPipeline === "risk"
      ? debugRequests.riskRequest
      : normalizedPipeline === "growth"
        ? debugRequests.growthRequest
        : debugRequests.connectionRequest;
    const label = normalizedPipeline === "risk"
      ? "Risk Raw Output"
      : normalizedPipeline === "growth"
        ? "Growth Raw Output"
        : "Connection Raw Output";

    setDebugRawBusy(true);
    setDebugRawLabel(label);
    try {
      const rawText = await callAnalysis(request.pipeline, request.payload, { rawText: true });
      setDebugRawText(rawText);
    } catch (error) {
      console.error(`[${label}] export failed`, error);
      setDebugRawText(String(error?.message || "Raw debug export failed."));
    } finally {
      setDebugRawBusy(false);
    }
  };

  const copyRawAiDebugExport = async () => {
    if (!debugRawText) return;
    try {
      await navigator.clipboard.writeText(debugRawText);
    } catch (error) {
      console.error("Raw debug text copy failed", error);
    }
  };

  const downloadRawAiDebugExport = () => {
    if (!debugRawText) return;
    const pipeline = /risk/i.test(debugRawLabel)
      ? "risk"
      : /growth/i.test(debugRawLabel)
        ? "growth"
        : "connection";
    downloadTextFile(debugRawText, createAiRawDebugFileName(importMeta.fileName, pipeline));
  };

  const closeResults = () => {
    const fromHist = resultsOrigin === "history";
    const bundleOriginId = fromHist && reportRouteState?.origin === "bundle"
      ? reportRouteState.bundleId : null;
    setReportRouteState(null);
    setDir("fade");
    setSid(s => s + 1);
    if (bundleOriginId) {
      setHistoryBundleView(bundleOriginId);
      setHistoryDrawerOpen(false);
      setPhase("history");
    } else {
      setPhase("upload");
      setHistoryBundleView(null);
      if (fromHist) setHistoryDrawerOpen(true);
    }
  };

  const navigateBack = () => {
    if (sharePicker || feedbackTarget || phase === "auth" || phase === "loading") return;
    if (phase === "results") {
      if (step > 0) back();
      else closeResults();
      return;
    }
    if (phase === "select") {
      setAnalysisError("");
      setDir(math?.isGroup ? "fade" : "bk");
      setPhase(math?.isGroup ? "upload" : "relationship");
      setSid(s => s + 1);
      return;
    }
    if (phase === "relationship") {
      setAnalysisError("");
      setDir("fade");
      setPhase("upload");
      setSid(s => s + 1);
      return;
    }
    if (phase === "upgrade") {
      setAnalysisError("");
      setDir("bk");
      setPhase(upgradeInfo?.backPhase || "select");
      setSid(s => s + 1);
      return;
    }
    if (phase === "payment") {
      closePayment();
      return;
    }
    if (phase === "settings") {
      setDir("fade");
      setHistoryBundleView(null);
      if (settingsReturnTarget === "history") {
        setPhase("history");
        setHistoryDrawerOpen(false);
      } else if (settingsReturnTarget === "historyDrawer") {
        setPhase("upload");
        setHistoryDrawerOpen(true);
      } else {
        setPhase("upload");
        setHistoryDrawerOpen(false);
      }
      setSettingsReturnTarget("upload");
      setSid(s => s + 1);
      return;
    }
    if (["history", "admin", "settings", "tooshort"].includes(phase)) {
      setDir("fade");
      if (phase === "history") setHistoryBundleView(null);
      setPhase("upload");
      setSid(s => s + 1);
    }
  };

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const edgeWidth = 28;

    const onTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (!touch || touch.clientX > edgeWidth) return;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchEnd = (event) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx > 72 && Math.abs(dx) > Math.abs(dy) * 1.6) navigateBack();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [phase, step, math, sharePicker, feedbackTarget, resultsOrigin, reportRouteState, upgradeInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== "results") return undefined;
    window.addEventListener("popstate", navigateBack);
    return () => window.removeEventListener("popstate", navigateBack);
  }, [phase, step, resultsOrigin, reportRouteState]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFeedback = (target) => {
    setFeedbackTarget(target);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const closeFeedback = (force = false) => {
    if (feedbackBusy && !force) return;
    setFeedbackTarget(null);
    setFeedbackChoice("");
    setFeedbackNote("");
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackTarget || !feedbackChoice || feedbackBusy) return;
    setFeedbackBusy(true);
    const ok = await submitFeedback({
      resultId: feedbackTarget.resultId,
      reportType: feedbackTarget.reportType,
      cardIndex: feedbackTarget.cardIndex,
      cardTitle: feedbackTarget.cardTitle,
      errorType: feedbackChoice,
      errorNote: feedbackNote,
    });
    setFeedbackBusy(false);
    closeFeedback(true);
    if (ok) setFeedbackThanks(true);
  };

  const getSummaryShareScreen = () => {
    if (!math) return null;
    const noop = () => {};
    if (reportType === "toxicity")
      return <ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={TOXICITY_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "lovelang")
      return <LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={LOVELANG_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "growth")
      return <GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={GROWTH_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "accounta")
      return <AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={ACCOUNTA_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    if (reportType === "energy")
      return <EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={ENERGY_SCREENS - 1} back={noop} next={noop} resultId={null} />;
    const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
    const total = contentCount + 1;
    return (
      <Finale
        s={math}
        ai={ai}
        aiLoading={aiLoading}
        restart={noop}
        back={noop}
        prog={total}
        total={total}
        mode="casual"
        resultId={currentResultId}
      />
    );
  };

  const captureScreen = async (type, filename) => {
    if (shareBusy) return;
    setShareBusy(true);
    setSharePicker(false);
    let blob = null;
    try {
      const canvas = await buildShareCanvas(type, wrapchatLogoTransparent);
      if (!canvas) return;
      blob = await canvasToBlob(canvas);
      const file = typeof File === "function"
        ? new File([blob], filename, { type: "image/png" })
        : null;
      if (file && canShareFiles([file])) {
        await navigator.share({ files: [file], title: "WrapChat" });
      } else {
        downloadBlob(blob, filename);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        if (blob) downloadBlob(blob, filename);
        console.error("Screen capture failed", error);
      }
    } finally {
      setShareBusy(false);
    }
  };

  const wrap = child => (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
    <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
      <ShareResultsContext.Provider value={{ onShare: () => setSharePicker(true), busy: shareBusy }}>
        <FeedbackContext.Provider value={{ openFeedback }}>
          <>
            <div style={{ width:"min(420px, 100vw)", margin:"0 auto", overflow:"hidden" }}>
              <Slide dir={dir} id={sid}>
                <CloseResultsContext.Provider value={closeResults}>
                  {child}
                </CloseResultsContext.Provider>
              </Slide>
            </div>
            <div
              aria-hidden="true"
              data-share-capture="summary"
              style={{
                position:"fixed",
                top:0,
                left:-10000,
                width:"min(420px, 100vw)",
                pointerEvents:"none",
                zIndex:-1,
              }}
            >
              <CloseResultsContext.Provider value={null}>
                {getSummaryShareScreen()}
              </CloseResultsContext.Provider>
            </div>
            <SharePicker
              open={sharePicker}
              busy={shareBusy}
              onCard={() => captureScreen("card", `wrapchat-${reportType || "general"}-card.png`)}
              onSummary={() => captureScreen("summary", `wrapchat-${reportType || "general"}-summary.png`)}
              onClose={() => setSharePicker(false)}
            />
            <FeedbackSheet
              open={!!feedbackTarget}
              target={feedbackTarget}
              selected={feedbackChoice}
              note={feedbackNote}
              submitting={feedbackBusy}
              onSelect={setFeedbackChoice}
              onNoteChange={setFeedbackNote}
              onSubmit={handleSubmitFeedback}
              onClose={closeFeedback}
            />
            {feedbackThanks && (
              <div style={{ position:"fixed", left:"50%", bottom:32, transform:"translateX(-50%)", zIndex:210, background:"rgba(20,20,28,0.96)", border:"1px solid rgba(255,255,255,0.14)", color:"#fff", padding:"11px 20px", borderRadius:999, fontSize:13, fontWeight:700, letterSpacing:"0.02em", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:15 }}>✓</span> {translateUI(resolvedUiLang, "Got it, thank you.")}
              </div>
            )}
          </>
        </FeedbackContext.Provider>
      </ShareResultsContext.Provider>
    </UILanguageContext.Provider>
    </ThemeContext.Provider>
  );

  const withUiLanguage = (node) => (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <UILanguageContext.Provider value={{ uiLang: resolvedUiLang, uiLangPref, updateUiLangPref }}>
        {node}
      </UILanguageContext.Provider>
    </ThemeContext.Provider>
  );

  const pushReportHistoryEntry = () => {
    if (typeof window === "undefined") return;
    window.history.pushState({ wrapchatPhase: "results" }, "", window.location.href);
  };

  const onRestoreResult = (row, routeState = null) => {
    const nextRouteState = routeState?.origin === "bundle" && routeState.bundleId
      ? { origin: "bundle", bundleId: routeState.bundleId }
      : null;
    prepaintReportLaunchSurface(row.report_type);
    setMath(row.math_data);
    const displayLang = getStoredResultDisplayLanguage(row.result_data);
    const sourceLang = normalizeUiLangCode(row.result_data?.sourceLanguage || displayLang);
    const canReuseCore = row.result_data?.analysisCacheVersion === CORE_ANALYSIS_CACHE_VERSION;
    setAi(getDisplayResultData(row.result_data, displayLang));
    if (canReuseCore && row.result_data?.coreAnalysis?.part === "connection") {
      const cacheFamily = row.report_type === "energy" ? "connection:energy" : "connection";
      setConnectionDigest(row.result_data.coreAnalysis);
      setConnectionDigestKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } else if (canReuseCore && (row.result_data?.coreAnalysis?.part === "growth" || row.result_data?.coreAnalysis?.part === "a")) {
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(row.result_data.coreAnalysis);
      setCoreAnalysisAKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, "growth", sourceLang));
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    } else if (canReuseCore && (row.result_data?.coreAnalysis?.part === "risk" || row.result_data?.coreAnalysis?.part === "b")) {
      const cacheFamily = row.report_type === "accounta" ? "risk:accountability" : "risk";
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(row.result_data.coreAnalysis);
      setCoreAnalysisBKey(getAnalysisFamilyCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null, cacheFamily, sourceLang));
    } else {
      setConnectionDigest(null);
      setConnectionDigestKey("");
      setCoreAnalysisA(null);
      setCoreAnalysisAKey("");
      setCoreAnalysisB(null);
      setCoreAnalysisBKey("");
    }
    setReportType(row.report_type);
    setSelectedReportTypes(row.report_type ? [row.report_type] : []);
    setLoadingReportIndex(0);
    setCurrentResultId(row.id || null);
    setReportRouteState(nextRouteState);
    setHistoryBundleView(null);
    setHistoryDrawerOpen(false);
    setRelationshipType(row.result_data?.relationshipType ?? null);
    setReportLang(displayLang);
    setAiLoading(false);
    setStep(0);
    setDir("fwd");
    setResultsOrigin("history");
    setPhase("results");
    pushReportHistoryEntry();
    setSid(s => s + 1);
  };

  // auth and upload share AuthUploadFrame so BrandLockup is never inside the
  // animated region — it persists perfectly still when the phase changes.
  if (phase === "auth" || phase === "upload") return withUiLanguage(
    <>
      <Slide dir={dir} id={sid}>
        <AuthUploadFrame
          phase={phase}
          onParsed={onParsed}
          onHistory={() => { setHistoryBundleView(null); setHistoryDrawerOpen(true); }}
          onAdmin={() => { setDir("fwd"); setPhase("admin"); setSid(s => s+1); }}
          canAdmin={authedIsAdmin}
          uploadError={uploadError}
          uploadInfo={uploadInfo}
          credits={credits}
          unlockedPackIds={unlockedPackIds}
          quickReadAvailable={quickReadAvailable}
          hideCredits={authedIsAdmin}
          accessMode={accessMode}
          firstRunQuickRead={firstRunQuickReadActive}
          onClearError={() => setUploadError("")}
          onUpgrade={() => { setUpgradeInfo({ availableCredits: credits, accessMode, backPhase: "upload" }); setDir("fwd"); setPhase("upgrade"); setSid(s => s+1); }}
          onPayment={() => openPayment(null, "upload")}
        />
      </Slide>
      {/* My Results slide-in drawer — upload phase only */}
      {phase === "upload" && (
        <div style={{ position:"fixed", inset:0, zIndex:120, pointerEvents: historyDrawerOpen ? "all" : "none" }}>
          <div
            onClick={() => { setHistoryBundleView(null); setHistoryDrawerOpen(false); }}
            style={{
              position:"absolute", inset:0,
              background:"rgba(0,0,0,0.52)",
              backdropFilter:"blur(3px)", WebkitBackdropFilter:"blur(3px)",
              opacity: historyDrawerOpen ? 1 : 0,
              transition:"opacity 0.28s ease",
              pointerEvents: historyDrawerOpen ? "all" : "none",
            }}
          />
          <div style={{
            position:"absolute", top:0, left:0, bottom:0,
            width:"100%",
            padding:SHELL_DRAWER_PADDING,
            transform: historyDrawerOpen ? "translateX(0)" : "translateX(-100%)",
            transition:"transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
            background:getDA(theme).bg,
            display:"flex", flexDirection:"column",
            overflow:"hidden",
            boxSizing:"border-box",
          }}>
            <MyResults
              currentUser={authedUser}
              drawerMode={true}
              initialBundleId={historyBundleView}
              onBack={(bundleId) => { if (bundleId) { setHistoryBundleView(bundleId); setHistoryDrawerOpen(false); setDir("fwd"); setPhase("history"); setSid(s => s+1); } else { setHistoryBundleView(null); setHistoryDrawerOpen(false); } }}
              onRestoreResult={(row, routeState) => { setHistoryDrawerOpen(false); onRestoreResult(row, routeState); }}
              onSettings={() => { setSettingsReturnTarget("historyDrawer"); setHistoryDrawerOpen(false); setDir("fwd"); setPhase("settings"); setSid(s => s+1); }}
            />
          </div>
        </div>
      )}
    </>
  );
  if (phase === "onboarding") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <OnboardingFlow step={step} next={next} onOnboarded={onOnboarded} />
    </Slide>)
  );
  if (phase === "terms") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <TermsFlow onAccepted={onAcceptedTerms} onLogout={logout} />
    </Slide>)
  );
  if (phase === "profileName") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <ProfileNameSetup user={authedUser} onSaved={onProfileNameSaved} onLogout={logout} />
    </Slide>)
  );
  if (phase === "quickReadIntro") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      <QuickReadIntro user={authedUser} onContinue={onQuickReadIntroContinue} />
    </Slide>)
  );
  if (phase === "admin") return (
    withUiLanguage(<Slide dir={dir} id={sid}>
      {isAdminUser(authedUser)
        ? <AdminPanel
            onBack={navigateBack}
            onLogout={logout}
            accessMode={accessMode}
            onAccessModeChange={setAccessModeState}
          />
        : <AdminLocked onBack={navigateBack} />}
    </Slide>)
  );
  if (phase === "settings") return withUiLanguage(
    <Slide dir={dir} id={sid} animateIn>
      <SettingsScreen
        onBack={navigateBack}
        onAccountDeleted={handleAccountDeleted}
        onLogout={logout}
        onUserUpdated={setAuthedUser}
        reportLang={reportLang}
        onReportLangChange={code => {
          setAnalysisError("");
          setReportLang(code);
          setCoreAnalysisA(null);
          setCoreAnalysisAKey("");
          setCoreAnalysisB(null);
          setCoreAnalysisBKey("");
        }}
      />
    </Slide>
  );
  if (phase === "history")  return withUiLanguage(<Slide dir={dir} id={sid}><MyResults currentUser={authedUser} initialBundleId={historyBundleView} onBack={navigateBack} onRestoreResult={onRestoreResult} onSettings={() => { setSettingsReturnTarget("history"); setDir("fwd"); setPhase("settings"); setSid(s => s+1); }} /></Slide>);
  if (phase === "tooshort") return withUiLanguage(<Slide dir={dir} id={sid}><TooShort onBack={navigateBack} /></Slide>);
  if (phase === "mergeReview") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <DuplicateParticipantReview
        dataset={pendingDataset}
        onContinue={onMergeReviewContinue}
        onBack={() => { setPendingDataset(null); setDir("bk"); setPhase("upload"); setSid(s => s + 1); }}
      />
    </Slide>
  );
  if (phase === "participantMismatch") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <ParticipantMismatchReview
        mismatch={participantMismatch}
        onContinue={onParticipantMismatchContinue}
        onBack={() => { setParticipantMismatch(null); setPendingDataset(null); setDir("bk"); setPhase("upload"); setSid(s => s + 1); }}
      />
    </Slide>
  );
  if (phase === "profileNameMismatch") return withUiLanguage(
    <Slide dir={dir} id={sid}>
      <ProfileNameMismatchReview
        warning={profileNameMismatch}
        onContinue={onProfileNameMismatchContinue}
        onBack={() => { setProfileNameMismatch(null); setDir("bk"); setPhase("upload"); setSid(s => s + 1); }}
      />
    </Slide>
  );
	  if (phase === "upgrade") return withUiLanguage(<Slide dir={dir} id={sid} animateIn><UpgradePlaceholder info={upgradeInfo} credits={credits} userRole={userRole} accessMode={accessMode} onBack={navigateBack} onOpenPayment={(packId) => openPayment(packId, "upgrade")} onBuyPacks={buyPacksWithCredits} /></Slide>);
	  if (phase === "unlockBuffer" || phase === "creditsBuffer") return withUiLanguage(
	    <Slide dir={dir} id={sid} animateIn>
	      <PostPurchaseBuffer
	        variant={phase === "creditsBuffer" ? "credits" : "unlock"}
	        onContinue={() => { setDir("fwd"); setPhase(bufferTarget); setSid(s => s + 1); }}
	      />
	    </Slide>
	  );
	  if (phase === "payment") return withUiLanguage(
	    <Slide dir={dir} id={sid} animateIn>
	      <div style={{ position:"relative" }}>
	        <PaymentScreen
	          preselect={paymentPreselect}
	          credits={credits}
	          userId={authedUser?.id || null}
	          onBack={closePayment}
	          onPaymentComingSoon={showPaymentComingSoon}
	          onPurchaseCredits={purchaseCredits}
	        />
	        {paymentToast && (
	          <div style={{ position:"fixed", left:"50%", bottom:32, transform:"translateX(-50%)", zIndex:220, background:"rgba(20,20,28,0.96)", border:"1px solid rgba(255,255,255,0.14)", color:"#fff", padding:"11px 20px", borderRadius:999, fontSize:13, fontWeight:800, letterSpacing:"0.01em", boxShadow:"0 8px 32px rgba(0,0,0,0.4)", whiteSpace:"nowrap" }}>
	            {paymentToast}
	          </div>
	        )}
	      </div>
	    </Slide>
	  );
	  if (phase === "select") return withUiLanguage(
	    <PackSelect
	      animKey={sid}
	      math={math}
	      onRunPack={onRunPack}
	      onBack={navigateBack}
	      error={analysisError}
	      unlockedPackIds={unlockedPackIds}
	      credits={credits}
	      accessMode={accessMode}
	      hideCredits={authedIsAdmin}
	      quickReadAvailable={quickReadAvailable}
	      quickReadExpiresAt={quickReadExpiresAt}
	      onRunQuickRead={onRunQuickRead}
	      onOpenUnlock={(packId) => openUnlockReads(packId, "select")}
	    />
	  );
  if (phase === "relationship") return withUiLanguage(
    <RelationshipSelect
      animKey={sid}
      onSelect={onSelectRelationship}
      onBack={navigateBack}
      error={analysisError}
      showDebugPanel={authedIsAdmin && !math?.isGroup}
      debugJson={debugExportJson}
      debugRawText={debugRawText}
      debugRawLabel={debugRawLabel}
      debugRawBusy={debugRawBusy}
      debugRelationshipType={relationshipType || debugRelType}
      onDebugRelationshipTypeChange={value => { setDebugRelType(value); setDebugExportJson(""); setDebugRawText(""); setDebugRawLabel(""); }}
      onDebugExport={buildLocalAiDebugExport}
      onDebugCopy={copyLocalAiDebugExport}
      onDebugDownload={downloadLocalAiDebugExport}
      onDebugRunRawCoreA={() => runRawAiDebugExport("coreA")}
      onDebugRunRawCoreB={() => runRawAiDebugExport("coreB")}
      onDebugCopyRaw={copyRawAiDebugExport}
      onDebugDownloadRaw={downloadRawAiDebugExport}
    />
  );
  // ── Quiz mode — fully public, bypasses all auth/report routing ──
  if (phase === "quiz" && quizId) {
    return withUiLanguage(
      <ChatMemoryQuiz
        quizId={quizId}
        onJoin={() => {
          setQuizId(null);
          window.history.pushState({}, "", "/");
          setStep(0); setDir("fwd");
          setPhase("auth");
          setSid(s => s + 1);
        }}
      />
    );
  }

  if (phase === "loading") return withUiLanguage(<Loading math={math} reportType={reportType} reportTypes={selectedReportTypes} loadingIndex={loadingReportIndex} />);

  // ── Trial report routing ──
  if (reportType === "trial_report") {
    if (step <= TRIAL_SCREENS) return wrap(<TrialReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} />);
    return wrap(
      <TrialFinale
        s={math}
        restart={restart}
        back={navigateBack}
        credits={credits}
        userId={authedUser?.id || null}
        onPaymentComingSoon={showPaymentComingSoon}
        onPurchaseCredits={purchaseCredits}
      />
    );
  }

  // ── Premium report routing ──
  const fromHistory = resultsOrigin === "history";
  if (reportType === "toxicity") {
    if (step < TOXICITY_SCREENS) return wrap(<ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "lovelang") {
    if (step < getLovelangScreenCount(ai, aiLoading)) return wrap(<LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "growth") {
    if (step < GROWTH_SCREENS) return wrap(<GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "accounta") {
    if (step < ACCOUNTA_SCREENS) return wrap(<AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }
  if (reportType === "energy") {
    if (step < getEnergyScreenCount(ai, aiLoading)) return wrap(<EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} resultId={currentResultId} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={navigateBack} reportType={reportType} resultId={currentResultId} fromHistory={fromHistory} />);
  }

  // ── General Wrapped (existing casual analysis) ──
  const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
  const total = contentCount + 1;
  let screen;
  if (step < contentCount) {
    screen = math.isGroup
      ? <GroupScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} mode="casual" resultId={currentResultId} />
      : <DuoScreen   s={math} ai={ai} aiLoading={aiLoading} step={step} back={navigateBack} next={next} mode="casual" relationshipType={relationshipType} resultId={currentResultId} />;
  } else {
    screen = <Finale s={math} ai={ai} aiLoading={aiLoading} restart={restart} back={navigateBack} prog={total} total={total} mode="casual" resultId={currentResultId} fromHistory={fromHistory} />;
  }
  return wrap(screen);
}
