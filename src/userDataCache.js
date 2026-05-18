const CACHE_VERSION = 1;
const CACHE_PREFIX = `wrapchat:user-data:v${CACHE_VERSION}:`;
const inFlight = new Map();

function storageKey(userId) {
  return `${CACHE_PREFIX}${userId}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCache(cache) {
  return {
    version: CACHE_VERSION,
    updatedAt: cache?.updatedAt || null,
    profile: cache?.profile || null,
    unlockedPackIds: cache?.unlockedPackIds || {},
    results: {
      rows: Array.isArray(cache?.results?.rows) ? cache.results.rows : null,
      updatedAt: cache?.results?.updatedAt || null,
    },
  };
}

export function readUserDataCache(userId) {
  if (!userId || !canUseStorage()) return normalizeCache(null);
  const parsed = safeParse(window.localStorage.getItem(storageKey(userId)));
  return normalizeCache(parsed);
}

export function writeUserDataCache(userId, patch) {
  if (!userId || !canUseStorage()) return normalizeCache(null);
  const current = readUserDataCache(userId);
  const next = normalizeCache({
    ...current,
    ...patch,
    results: {
      ...current.results,
      ...(patch?.results || {}),
    },
    updatedAt: new Date().toISOString(),
  });
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Storage can fail in private browsing or quota pressure. The app should
    // keep working with in-memory React state when that happens.
  }
  return next;
}

export function cacheUserProfile(userId, profile) {
  if (!profile || typeof profile !== "object") return readUserDataCache(userId);
  return writeUserDataCache(userId, { profile });
}

export function cacheUserCredits(userId, balance) {
  const parsed = Number.parseInt(String(balance), 10);
  if (!Number.isInteger(parsed)) return readUserDataCache(userId);
  const current = readUserDataCache(userId);
  return cacheUserProfile(userId, {
    ...(current.profile || {}),
    balance: parsed,
  });
}

export function cacheUnlockedPacks(userId, unlockedPackIds) {
  return writeUserDataCache(userId, { unlockedPackIds: unlockedPackIds || {} });
}

export function cacheUserResults(userId, rows) {
  return writeUserDataCache(userId, {
    results: {
      rows: Array.isArray(rows) ? rows : [],
      updatedAt: new Date().toISOString(),
    },
  });
}

export function upsertCachedResult(userId, row) {
  if (!row?.id) return readUserDataCache(userId);
  const current = readUserDataCache(userId);
  const rows = Array.isArray(current.results.rows) ? current.results.rows : [];
  const nextRows = [row, ...rows.filter(item => item?.id !== row.id)]
    .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0));
  return cacheUserResults(userId, nextRows);
}

export function removeCachedResults(userId, ids) {
  const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
  if (!idSet.size) return readUserDataCache(userId);
  const current = readUserDataCache(userId);
  if (!Array.isArray(current.results.rows)) return current;
  return cacheUserResults(userId, current.results.rows.filter(row => !idSet.has(row?.id)));
}

export function sameCachedValue(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

export function requestOnce(key, fetcher) {
  if (!key || typeof fetcher !== "function") return Promise.resolve(null);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = Promise.resolve()
    .then(fetcher)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}
