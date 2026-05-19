import { useEffect, useState } from "react";
import App from "./App";
import ImportRoute from "./ImportRoute";
import AuthConfirmedPage from "./AuthConfirmedPage";

function createImportToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Root() {
  const getCurrentPath = () => {
    if (window.location.protocol === "wrapchat:" && window.location.hostname === "auth") {
      return `/auth${window.location.pathname}`;
    }
    return window.location.pathname;
  };
  const [path, setPath] = useState(getCurrentPath);
  const [pendingImportedChat, setPendingImportedChat] = useState(null);

  useEffect(() => {
    const handleNavigation = () => setPath(getCurrentPath());
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  const goHome = () => {
    window.history.replaceState({}, "", "/");
    setPath("/");
  };

  if (path === "/auth/confirmed") {
    return <AuthConfirmedPage />;
  }

  if (path === "/import") {
    return (
      <ImportRoute
        onComplete={payload => {
          setPendingImportedChat({ id: createImportToken(), payload });
          goHome();
        }}
        onCancel={goHome}
      />
    );
  }

  return (
    <App
      pendingImportedChat={pendingImportedChat}
      onPendingImportedChatConsumed={token => {
        setPendingImportedChat(current => (current?.id === token ? null : current));
      }}
    />
  );
}
