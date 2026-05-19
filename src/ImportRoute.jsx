import { useCallback, useEffect, useRef, useState } from "react";
import BrandLockup, { wrapchatLogoTransparent } from "./BrandLockup";
import { processImportedChatFile } from "./import/fileProcessing";
import { IMPORT_ACCEPT_TYPES } from "./import/normalizedSchema";
import {
  clearSharedFileFromNative,
  clearSharedFileFromServiceWorker,
  requestSharedFileFromNative,
  requestSharedFileFromServiceWorker,
  subscribeToShareTargetEvents,
} from "./import/shareTargetClient";
import { Shell, GhostButton, BackIcon, DA, PAL } from "./theme.jsx";

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
        accept={IMPORT_ACCEPT_TYPES}
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
  const startedRef = useRef(false);

  const processFile = useCallback(async (file, source = "manual") => {
    if (!file || startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError("");
    setStatusText("Reading your chat...");

    try {
      const result = await processImportedChatFile(file, {
        onStatus: update => setStatusText(update.message),
      });

      if (source === "shared") await clearSharedFileFromServiceWorker();
      if (source === "native") clearSharedFileFromNative();

      onComplete({
        platform: result.platform,
        sourceFormat: result.sourceFormat,
        parserId: result.parserId,
        payload: result.payload,
        summary: result.summary,
        fileName: file?.name || null,
      });
    } catch (processingError) {
      if (source === "shared") await clearSharedFileFromServiceWorker();
      if (source === "native") clearSharedFileFromNative();
      setError(String(processingError?.message || "We couldn't open that chat."));
      setBusy(false);
      startedRef.current = false;
      setStatusText("Opening your chat...");
    }
  }, [onComplete]);

  useEffect(() => {
    let active = true;

    const tryPendingShare = async () => {
      const nativeFile = await requestSharedFileFromNative();
      if (!active) return;
      if (nativeFile) {
        processFile(nativeFile, "native");
        return;
      }

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
      } else if (event?.source === "native" && event.file && !startedRef.current) {
        processFile(event.file, "native");
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [processFile]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100svh", background: DA.bg }}>
      <Shell sec="upload" bg={pal.bg} scrollable={false} forceWaves>
        <div style={{ position:"absolute", top:"calc(33% + 4px)", left:0, right:0, transform:"translateY(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"0 24px", zIndex:1 }}>
          <BrandLockup
            logoSrc={wrapchatLogoTransparent}
            logoSize={72}
            subtitle="Your chats, unwrapped."
            subtitleMarginBottom={8}
          />
        </div>

        <div style={{ position:"absolute", top:"calc(33% + 109px)", left:24, right:24, display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", width:"100%" }}>
            <div style={{ fontSize:17, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>
              {busy ? "Reading your chat..." : statusText}
            </div>
          </div>

          {!busy && (
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

          {!busy && <GhostButton onClick={onCancel}><BackIcon size={11} /> Back to WrapChat</GhostButton>}
        </div>
      </Shell>
    </div>
  );
}
