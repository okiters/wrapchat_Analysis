import { useCallback, useEffect, useRef, useState } from "react";
import BrandLockup from "./BrandLockup";
import { processImportedChatFile } from "./import/fileProcessing";
import {
  clearSharedFileFromServiceWorker,
  requestSharedFileFromServiceWorker,
  subscribeToShareTargetEvents,
} from "./import/shareTargetClient";
import { Shell, LoadingMosaic, PrimaryButton, GhostButton, BackIcon, DA, PAL } from "./theme.jsx";

const pal = PAL.upload;

function UploadFallback({ onFile, busy }) {
  const inputId = "wrapchat-import-input";
  return (
    <>
      <label
        htmlFor={inputId}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          onFile(event.dataTransfer.files?.[0] || null);
        }}
        style={{
          display: "block",
          width: "100%",
          borderRadius: 24,
          border: `1px dashed ${pal.accent}60`,
          background: `${pal.accent}10`,
          padding: "28px 18px",
          textAlign: "center",
          cursor: busy ? "default" : "pointer",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: "#fff" }}>
          {busy ? "Opening your chat..." : "Choose your chat export"}
        </div>
        <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>
          Share your chat export here, or drop the file on this card.
        </div>
      </label>
      <input
        id={inputId}
        type="file"
        accept=".txt,.zip,text/plain,application/zip"
        style={{ display: "none" }}
        onChange={event => onFile(event.target.files?.[0] || null)}
      />
    </>
  );
}

export default function ImportRoute({ onComplete, onCancel }) {
  const [statusText, setStatusText] = useState("Opening your chat...");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [summary, setSummary] = useState(null);
  const completionTimerRef = useRef(null);
  const startedRef = useRef(false);

  const processFile = useCallback(async (file, source = "manual") => {
    if (!file || startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError("");
    setSummary(null);

    try {
      const result = await processImportedChatFile(file, {
        onStatus: update => setStatusText(update.message),
      });

      setSummary(result.summary);
      setStatusText(`Found ${result.summary.messageCount.toLocaleString()} messages with ${result.summary.participantLabel}.`);
      setBusy(false);
      if (source === "shared") await clearSharedFileFromServiceWorker();

      completionTimerRef.current = window.setTimeout(() => {
        onComplete({
          payload: result.payload,
          summary: result.summary,
          fileName: file?.name || null,
        });
      }, 900);
    } catch (processingError) {
      if (source === "shared") await clearSharedFileFromServiceWorker();
      setError(String(processingError?.message || "We couldn't open that chat."));
      setBusy(false);
      startedRef.current = false;
      setStatusText("Opening your chat...");
    }
  }, [onComplete]);

  useEffect(() => {
    let active = true;

    const tryPendingShare = async () => {
      const sharedFile = await requestSharedFileFromServiceWorker();
      if (!active) return;
      if (sharedFile) {
        processFile(sharedFile, "shared");
      } else {
        setBusy(false);
        setStatusText("Opening your chat...");
      }
    };

    tryPendingShare();

    const unsubscribe = subscribeToShareTargetEvents(async event => {
      if (event?.type === "WRAPCHAT_SHARE_READY" && !startedRef.current) {
        const sharedFile = await requestSharedFileFromServiceWorker();
        if (sharedFile) processFile(sharedFile, "shared");
      }
    });

    return () => {
      active = false;
      unsubscribe();
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, [processFile]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100svh", background: DA.bg }}>
      <Shell sec="upload" bg={pal.bg}>
        <BrandLockup
          titleSize={42}
          titleLetterSpacing={-2.4}
          subtitle="Your chat, ready to read."
        />

        <div style={{
          width: "100%",
          borderRadius: 24,
          background: `${pal.accent}15`,
          border: `1px solid ${pal.accent}40`,
          padding: "22px 18px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: "#fff" }}>
            {statusText}
          </div>
          {busy && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
              <LoadingMosaic />
            </div>
          )}

          {summary && (
            <div style={{ marginTop: 18, textAlign: "left", lineHeight: 1.75 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: pal.accent, fontWeight: 700 }}>
                Chat found
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{summary.participantLabel}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>
                {summary.messageCount.toLocaleString()} messages
              </div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)" }}>{summary.dateRangeLabel}</div>
            </div>
          )}
        </div>

        {!busy && !summary && (
          <>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.62)", lineHeight: 1.7, textAlign: "center" }}>
              If sharing didn&apos;t bring the export in automatically, you can choose it here instead.
            </div>
            <UploadFallback onFile={file => processFile(file, "manual")} busy={busy} />
          </>
        )}

        {error && (
          <div style={{
            background: "rgba(200,60,20,0.18)",
            border: "1px solid rgba(255,160,120,0.2)",
            color: "#ffcfbf",
            borderRadius: 18,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.6,
            width: "100%",
          }}>
            {error}
          </div>
        )}

        <GhostButton onClick={onCancel}><BackIcon size={11} /> Back to WrapChat</GhostButton>
      </Shell>
    </div>
  );
}
