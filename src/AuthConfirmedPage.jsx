import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { Shell, Heading, Sub, PrimaryButton, DA, PAL, Geo } from "./theme.jsx";
import BrandLockup from "./BrandLockup.jsx";

function goToApp() {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function LoadingView() {
  return (
    <Shell bg={DA.bg}>
      <BrandLockup logoSize={56} titleSize={36} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "rgba(255,255,255,0.4)",
            display: "inline-block",
            animation: `blink 1.4s ${i * 0.16}s infinite ease-in-out`,
          }} />
        ))}
      </div>
    </Shell>
  );
}

function SuccessView() {
  return (
    <Shell bg={DA.bg} geos={<>
      <Geo shape="sq-r"  size={100} color={DA.teal}   top={40}    right={-28} rotate={22}  opacity={0.12} />
      <Geo shape="circle" size={64} color={DA.purple} bottom={120} left={-20}              opacity={0.14} />
      <Geo shape="sq-r"  size={48} color={DA.teal}   bottom={240} right={16}  rotate={-10} opacity={0.10} />
    </>}>
      <BrandLockup logoSize={56} titleSize={36} />

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <div className="wc-fu" style={{
          fontFamily: DA.dp, fontWeight: 900, fontSize: 42,
          color: DA.text, letterSpacing: "-0.025em", lineHeight: 1.05,
        }}>
          You're in.
        </div>
        <div className="wc-fu2" style={{
          fontFamily: DA.bp, fontSize: 15, color: DA.muted, lineHeight: 1.55,
        }}>
          Your account is confirmed. Welcome to WrapChat.
        </div>
      </div>

      <div className="wc-fu3" style={{ width: "100%", marginTop: 4 }}>
        <PrimaryButton onClick={goToApp} color={DA.teal} textColor={DA.bg}>
          Continue to WrapChat
        </PrimaryButton>
      </div>
    </Shell>
  );
}

function ErrorView() {
  return (
    <Shell bg={DA.bg}>
      <BrandLockup logoSize={56} titleSize={36} />

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <div className="wc-fu" style={{
          fontFamily: DA.dp, fontWeight: 900, fontSize: 28,
          color: DA.text, letterSpacing: "-0.02em", lineHeight: 1.1,
        }}>
          Link expired or invalid.
        </div>
        <div className="wc-fu2" style={{
          fontFamily: DA.bp, fontSize: 14, color: DA.muted, lineHeight: 1.55,
        }}>
          This confirmation link has expired or has already been used. Sign in to your account or request a new link.
        </div>
      </div>

      <div className="wc-fu3" style={{ width: "100%", marginTop: 4 }}>
        <PrimaryButton onClick={goToApp} color={PAL.upload.accent} textColor={PAL.upload.bg}>
          Go to WrapChat
        </PrimaryButton>
      </div>
    </Shell>
  );
}

export default function AuthConfirmedPage() {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let timeout;

    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const isValidFlow =
      params.has("code") ||
      params.has("token_hash") ||
      hash.includes("access_token=");

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setStatus("success");
        return;
      }
      if (!isValidFlow) {
        setStatus("error");
        return;
      }
      // Valid token in URL — wait for SDK to exchange it
      timeout = setTimeout(() => {
        setStatus(s => (s === "loading" ? "error" : s));
      }, 8000);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setStatus("success");
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (status === "loading") return <LoadingView />;
  if (status === "error")   return <ErrorView />;
  return <SuccessView />;
}
