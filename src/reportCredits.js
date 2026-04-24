import { supabase } from "./supabase";
import { isOpenMode } from "./accessMode";

// Credit pricing is intentionally centralized here.
// These values are relative estimates based on current API shape:
// - each report uses one major Claude family call when run standalone
// - growth/risk-heavy reports send broader context or ask for denser output
// - same-family reports reuse the cached core digest during bundled runs, so
//   bundles and family-aware pricing reflect the actual compute saving.
// Adjust these after production token/cost logs are available.
export const reportCredits = Object.freeze({
  general:      2,
  toxicity:     2,
  lovelang:     1,
  growth:       2,
  accounta:     2,
  energy:       2,
  trial_report: 1,
});

const DEFAULT_REPORT_CREDIT_COST = 2;

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

// Add-on price for each extra report within the same family (beyond the first).
const FAMILY_ADDON_COST = 1;

// Named bundles — fixed prices reflecting shared-compute savings.
// cost is always less than the sum of individual reportCredits values.
export const BUNDLES = Object.freeze({
  connection: Object.freeze({
    id: "connection",
    label: "Vibe Bundle",
    reports: Object.freeze(["general", "lovelang", "energy"]),
    cost: 4,   // vs 5 à la carte (2 + 1 + 2)
  }),
  tension: Object.freeze({
    id: "tension",
    label: "Red Flags Bundle",
    reports: Object.freeze(["toxicity", "accounta"]),
    cost: 3,   // vs 4 à la carte (2 + 2)
  }),
  full: Object.freeze({
    id: "full",
    label: "Full Suite",
    reports: Object.freeze(["general", "lovelang", "energy", "toxicity", "accounta", "growth"]),
    cost: 8,   // vs 11 à la carte
  }),
});

export function getReportCreditCost(reportType) {
  const cost = reportCredits[String(reportType || "")];
  return Number.isInteger(cost) && cost > 0 ? cost : DEFAULT_REPORT_CREDIT_COST;
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

// Bundle-aware total: named bundle price if matched, otherwise family-aware discount
// (first report per family = full price, each additional same-family report = FAMILY_ADDON_COST).
export function getTotalCreditCostBundled(selectedReportTypes = []) {
  const uniqueTypes = Array.from(new Set(
    (Array.isArray(selectedReportTypes) ? selectedReportTypes : [selectedReportTypes]).filter(Boolean)
  ));
  if (uniqueTypes.length <= 1) return getTotalCreditCost(uniqueTypes);

  const bundle = getBundleMatch(uniqueTypes);
  if (bundle) return bundle.cost;

  // Family-aware fallback: anchor (highest individual cost in family) = full price,
  // each additional same-family report = FAMILY_ADDON_COST.
  const familySeen = new Set();
  return uniqueTypes.reduce((total, type) => {
    const family = REPORT_FAMILY[type] || type;
    if (familySeen.has(family)) return total + FAMILY_ADDON_COST;
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
    ? "Your free trial or paid credits are used up. Add credits to run more reports."
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
