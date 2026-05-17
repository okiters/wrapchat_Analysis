import { supabase } from "./supabase";
import { isOpenMode } from "./accessMode";

export const QUICK_READ_TRIAL_CONFIG = Object.freeze({
  reportId: "trial_report",
  label: "Quick Read",
  creditCost: 0,
});

export const CREDIT_BUNDLES = Object.freeze([
  Object.freeze({ id: "starter", label: "Starter", credits: 100, price: 1.99, priceLabel: "€1.99" }),
  Object.freeze({ id: "plus", label: "Plus", credits: 250, price: 3.99, priceLabel: "€3.99", recommended: true }),
  Object.freeze({ id: "all_access", label: "All Access", credits: 450, price: 7.99, priceLabel: "€7.99" }),
]);

export const REPORT_PACKS = Object.freeze({
  growth: Object.freeze({
    id: "growth",
    bundleId: null,
    label: "Growth Report",
    shortDescription: "Standalone temporal analysis",
    reports: Object.freeze(["growth"]),
    reportLabels: Object.freeze(["Growth"]),
    cost: 45,
  }),
  rf: Object.freeze({
    id: "rf",
    bundleId: "tension",
    label: "Red Flags Pack",
    shortDescription: "Toxicity · Accountability",
    reports: Object.freeze(["toxicity", "accounta"]),
    reportLabels: Object.freeze(["Toxicity", "Accountability"]),
    cost: 80,
  }),
  vibe: Object.freeze({
    id: "vibe",
    bundleId: "connection",
    label: "Vibe Pack",
    shortDescription: "General Wrapped · Love Language · Energy",
    reports: Object.freeze(["general", "lovelang", "energy"]),
    reportLabels: Object.freeze(["General Wrapped", "Love Language", "Energy"]),
    cost: 95,
  }),
  full: Object.freeze({
    id: "full",
    bundleId: "full",
    label: "Full Read",
    shortDescription: "All 6 reports",
    reports: Object.freeze(["general", "lovelang", "energy", "toxicity", "accounta", "growth"]),
    reportLabels: Object.freeze(["General Wrapped", "Love Language", "Energy", "Toxicity", "Accountability", "Growth"]),
    cost: 210,
  }),
});

export const REPORT_PACK_ORDER = Object.freeze(["vibe", "rf", "full", "growth"]);

export const PACK_CREDIT_COSTS = Object.freeze(
  Object.fromEntries(Object.values(REPORT_PACKS).map(pack => [pack.id, pack.cost]))
);

// Standalone report runs are not exposed in the current pack-first UI. If an
// older path asks for a single report, charge the cheapest defined pack that
// unlocks that report so no legacy 1/2-credit prices leak back in.
export const reportCredits = Object.freeze({
  general:      REPORT_PACKS.vibe.cost,
  toxicity:     REPORT_PACKS.rf.cost,
  lovelang:     REPORT_PACKS.vibe.cost,
  growth:       REPORT_PACKS.growth.cost,
  accounta:     REPORT_PACKS.rf.cost,
  energy:       REPORT_PACKS.vibe.cost,
  trial_report: QUICK_READ_TRIAL_CONFIG.creditCost,
});

const DEFAULT_REPORT_CREDIT_COST = REPORT_PACKS.growth.cost;

// Which shared AI digest each report is built from.
// Reports in the same family share one API call when run together.
const REPORT_FAMILY = Object.freeze({
  general:      "connection",
  lovelang:     "connection",
  energy:       "connection",
  toxicity:     "risk",
  accounta:     "risk",
  growth:       "growth",
  trial_report: "trial",
});

// Named bundles and saved-result bundle matching.
export const BUNDLES = Object.freeze({
  connection: Object.freeze({
    id: "connection",
    label: "Vibe Pack",
    reports: REPORT_PACKS.vibe.reports,
    cost: REPORT_PACKS.vibe.cost,
  }),
  tension: Object.freeze({
    id: "tension",
    label: "Red Flags Pack",
    reports: REPORT_PACKS.rf.reports,
    cost: REPORT_PACKS.rf.cost,
  }),
  full: Object.freeze({
    id: "full",
    label: "Full Read",
    reports: REPORT_PACKS.full.reports,
    cost: REPORT_PACKS.full.cost,
  }),
});

export function getPackCreditCost(packId) {
  const cost = PACK_CREDIT_COSTS[String(packId || "")];
  return Number.isInteger(cost) && cost >= 0 ? cost : null;
}

export function getAffordablePacks(balance) {
  const parsed = Number.parseInt(String(balance), 10);
  if (!Number.isInteger(parsed)) return [];
  return REPORT_PACK_ORDER.map(id => REPORT_PACKS[id]).filter(pack => parsed >= pack.cost);
}

export function estimateAnalysesLeft(balance) {
  const parsed = Number.parseInt(String(balance), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed / REPORT_PACKS.growth.cost);
}

export function getCreditBundleById(bundleId) {
  return CREDIT_BUNDLES.find(bundle => bundle.id === bundleId) || null;
}

export function getReportCreditCost(reportType) {
  const cost = reportCredits[String(reportType || "")];
  return Number.isInteger(cost) && cost >= 0 ? cost : DEFAULT_REPORT_CREDIT_COST;
}

// Standalone sum — used for showing original price before discount.
export function getTotalCreditCost(selectedReportTypes = []) {
  const uniqueTypes = Array.from(new Set(Array.isArray(selectedReportTypes) ? selectedReportTypes : [selectedReportTypes]));
  return uniqueTypes.filter(Boolean).reduce((total, type) => total + getReportCreditCost(type), 0);
}

// Returns the matching named bundle if the selection exactly matches one, otherwise null.
export function getBundleMatch(selectedTypes = []) {
  const set = new Set(selectedTypes.filter(Boolean));
  if (set.size < 2) return null;
  for (const bundle of Object.values(BUNDLES)) {
    if (bundle.reports.length === set.size && bundle.reports.every(r => set.has(r))) {
      return bundle;
    }
  }
  return null;
}

// Bundle-aware total: named pack price if matched, otherwise the cheapest pack
// covering the selected report set.
export function getTotalCreditCostBundled(selectedReportTypes = []) {
  const uniqueTypes = Array.from(new Set(
    (Array.isArray(selectedReportTypes) ? selectedReportTypes : [selectedReportTypes]).filter(Boolean)
  ));
  if (uniqueTypes.length <= 1) return getTotalCreditCost(uniqueTypes);

  const bundle = getBundleMatch(uniqueTypes);
  if (bundle) return bundle.cost;

  const matchingPack = REPORT_PACK_ORDER
    .map(id => REPORT_PACKS[id])
    .filter(pack => uniqueTypes.every(type => pack.reports.includes(type)))
    .sort((a, b) => a.cost - b.cost)[0];
  if (matchingPack) return matchingPack.cost;

  const familySeen = new Set();
  return uniqueTypes.reduce((total, type) => {
    const family = REPORT_FAMILY[type] || type;
    if (familySeen.has(family)) return total;
    familySeen.add(family);
    return total + getReportCreditCost(type);
  }, 0);
}

function userIsAdmin(user) {
  const role = String(user?.role || user?.app_metadata?.role || "").trim().toLowerCase();
  return role === "admin";
}

function getUserCreditBalance(user) {
  const candidate = user?.credits ?? user?.balance ?? user?.credit_balance ?? null;
  const parsed = Number.parseInt(String(candidate), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function canUserRunReports(user, selectedReportTypes = [], accessMode = "credits") {
  const requiredCredits = getTotalCreditCostBundled(selectedReportTypes);
  const credits = getUserCreditBalance(user);

  if (userIsAdmin(user) || isOpenMode(accessMode) || requiredCredits <= 0) {
    return { allowed: true, requiredCredits, availableCredits: credits, message: "" };
  }

  if (credits != null && credits >= requiredCredits) {
    return { allowed: true, requiredCredits, availableCredits: credits, message: "" };
  }

  const message = accessMode === "payments"
    ? "You need more credits to unlock this read."
    : `You need ${requiredCredits} credits to run ${selectedReportTypes.length === 1 ? "this report" : "these reports"}.`;

  return { allowed: false, requiredCredits, availableCredits: credits, message };
}

export async function deductCreditsForRun(userId, selectedReportTypes = []) {
  const amount = getTotalCreditCostBundled(selectedReportTypes);
  if (!userId || amount <= 0) return null;

  const { data, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw error;

  const parsed = Number.parseInt(String(data ?? 0), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

// Deducts an explicit amount — use when the cost has already been computed bundled.
export async function deductCreditsAmount(userId, amount) {
  if (!userId || amount <= 0) return null;

  const { data, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (error) throw error;

  const parsed = Number.parseInt(String(data ?? 0), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function packIdsToMap(packIds = []) {
  return Object.fromEntries(
    (Array.isArray(packIds) ? packIds : [])
      .map(id => String(id || "").trim())
      .filter(Boolean)
      .map(id => [id, true])
  );
}

export async function getUnlockedReportPacks(userId) {
  if (!userId) return {};
  const { data, error } = await supabase.rpc("get_report_unlocks", {
    p_user_id: userId,
  });
  if (error) throw error;
  return packIdsToMap(data);
}

export async function unlockReportPacks(userId, packIds = []) {
  const normalizedPackIds = (Array.isArray(packIds) ? packIds : [packIds])
    .map(id => String(id || "").trim())
    .filter(Boolean);
  if (!userId || !normalizedPackIds.length) {
    return { balance: null, chargedCredits: 0, unlockedPackIds: {} };
  }

  const { data, error } = await supabase.rpc("unlock_report_packs", {
    p_user_id: userId,
    p_pack_ids: normalizedPackIds,
  });
  if (error) throw error;

  const balance = Number.parseInt(String(data?.balance ?? 0), 10);
  const chargedCredits = Number.parseInt(String(data?.charged_credits ?? 0), 10);
  return {
    balance: Number.isInteger(balance) ? balance : null,
    chargedCredits: Number.isInteger(chargedCredits) ? chargedCredits : 0,
    unlockedPackIds: packIdsToMap(data?.unlocked_pack_ids),
  };
}

export async function simulateCreditPurchase(userId, bundleId) {
  if (!userId || !bundleId) return null;
  const { data, error } = await supabase.rpc("simulate_credit_purchase", {
    p_user_id: userId,
    p_bundle_id: bundleId,
  });
  if (error) throw error;

  const parsed = Number.parseInt(String(data ?? 0), 10);
  return Number.isInteger(parsed) ? parsed : null;
}
