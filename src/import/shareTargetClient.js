const SHARE_REQUEST = "WRAPCHAT_SHARE_REQUEST";
const SHARE_FILE = "WRAPCHAT_SHARE_FILE";
const SHARE_READY = "WRAPCHAT_SHARE_READY";
const SHARE_CLEAR = "WRAPCHAT_SHARE_CLEAR";
const NATIVE_SHARE_EVENT = "wrapchat:native-share";

function base64ToBlob(base64, mimeType = "application/octet-stream") {
  const binary = window.atob(base64 || "");
  const chunks = [];
  const chunkSize = 8192;

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }
    chunks.push(bytes);
  }

  return new Blob(chunks, { type: mimeType });
}

function nativePayloadToFile(payload) {
  if (!payload || payload.kind === "error") return null;
  if (payload.kind !== "file" || !payload.base64) return null;

  const mimeType = payload.mimeType || "application/octet-stream";
  const name = payload.name || "shared-chat";
  const blob = base64ToBlob(payload.base64, mimeType);
  return new File([blob], name, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

async function getActiveServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return null;
  return navigator.serviceWorker.controller || registration.active || registration.waiting || null;
}

export function subscribeToShareTargetEvents(listener) {
  const cleanups = [];

  const handleServiceWorkerMessage = event => {
    const type = event.data?.type;
    if (type === SHARE_READY || type === SHARE_FILE) listener(event.data);
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    cleanups.push(() => navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage));
  }

  const handleNativeShare = event => {
    const file = nativePayloadToFile(event.detail);
    if (file) listener({ type: SHARE_FILE, file, source: "native" });
  };

  window.addEventListener(NATIVE_SHARE_EVENT, handleNativeShare);
  cleanups.push(() => window.removeEventListener(NATIVE_SHARE_EVENT, handleNativeShare));

  return () => cleanups.forEach(cleanup => cleanup());
}

export async function requestSharedFileFromServiceWorker(timeoutMs = 1500) {
  const worker = await getActiveServiceWorker();
  if (!worker) return null;

  return new Promise(resolve => {
    let settled = false;

    const cleanup = () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };

    const finish = file => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file || null);
    };

    const handleMessage = event => {
      if (event.data?.type !== SHARE_FILE) return;
      finish(event.data.file || null);
    };

    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);
    navigator.serviceWorker.addEventListener("message", handleMessage);
    worker.postMessage({ type: SHARE_REQUEST });
  });
}

export async function clearSharedFileFromServiceWorker() {
  const worker = await getActiveServiceWorker();
  if (!worker) return;
  worker.postMessage({ type: SHARE_CLEAR });
}

export async function requestSharedFileFromNative() {
  const payload = window.__wrapchatNativeSharePayload || null;
  const file = nativePayloadToFile(payload);
  if (!file) return null;
  window.__wrapchatNativeSharePayload = null;
  return file;
}

export function clearSharedFileFromNative() {
  window.__wrapchatNativeSharePayload = null;
}
