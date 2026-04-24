import { supabase } from "./supabase";

export const ACCESS_MODES = Object.freeze({
  OPEN: "open",
  CREDITS: "credits",
  PAYMENTS: "payments",
});

export const DEFAULT_ACCESS_MODE = ACCESS_MODES.CREDITS;

const VALID_ACCESS_MODES = new Set(Object.values(ACCESS_MODES));

export function normalizeAccessMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  return VALID_ACCESS_MODES.has(normalized) ? normalized : DEFAULT_ACCESS_MODE;
}

export async function getAccessMode({ throwOnError = false } = {}) {
  try {
    const { data, error } = await supabase.rpc("get_access_mode");
    if (error) throw error;
    return normalizeAccessMode(data);
  } catch (error) {
    if (throwOnError) throw error;
    console.error("Access mode fetch failed", error);
    return DEFAULT_ACCESS_MODE;
  }
}

export async function setAccessMode(mode) {
  const nextMode = normalizeAccessMode(mode);
  const { data, error } = await supabase.rpc("admin_set_access_mode", {
    p_mode: nextMode,
  });
  if (error) throw error;
  return normalizeAccessMode(data);
}

export function isOpenMode(mode) {
  return normalizeAccessMode(mode) === ACCESS_MODES.OPEN;
}

export function isCreditMode(mode) {
  return normalizeAccessMode(mode) === ACCESS_MODES.CREDITS;
}

export function isPaymentMode(mode) {
  return normalizeAccessMode(mode) === ACCESS_MODES.PAYMENTS;
}

export function getAccessModeLabel(mode) {
  switch (normalizeAccessMode(mode)) {
    case ACCESS_MODES.OPEN:
      return "Open Testing";
    case ACCESS_MODES.PAYMENTS:
      return "Payment Launch";
    case ACCESS_MODES.CREDITS:
    default:
      return "Credit Beta";
  }
}

export function checkReportAccess({ isAdmin = false, accessMode, credits = null, neededCredits = 1 }) {
  const mode = normalizeAccessMode(accessMode);
  const needed = Math.max(Number.parseInt(String(neededCredits), 10) || 0, 0);
  const balance = Number.isInteger(credits) ? credits : null;

  if (isAdmin || isOpenMode(mode) || needed <= 0) {
    return { allowed: true, mode, neededCredits: needed, credits: balance, message: "" };
  }

  if ((isCreditMode(mode) || isPaymentMode(mode)) && balance != null && balance >= needed) {
    return { allowed: true, mode, neededCredits: needed, credits: balance, message: "" };
  }

  const message = isPaymentMode(mode)
    ? "Your free trial or paid credits are used up. Add credits to run more reports."
    : needed > 1
      ? `You need ${needed} credits to run these reports.`
      : "You need 1 credit to run this report.";

  return { allowed: false, mode, neededCredits: needed, credits: balance, message };
}
